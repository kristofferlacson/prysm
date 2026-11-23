import { create } from 'zustand';
import { sourceSize, type RasterSource } from '../image-editing/pipeline';
import { blankCanvas, getImageLayer, setMaskBitmap } from '../masks/maskActions';
import { loadRaster } from '../../services/rasters';
import { useUiStore } from '../../stores/uiStore';
import type { ModelId } from './models';
import { detectObjectModel, objectAt, prepareObjects, refineWithObjects, type ObjectCandidate, type ObjectHit } from './objectSelect';
import { buildCoverage, findSubject, loadLayerPixels, megabytes, nextPaint, useBackgroundRemoval, type Report } from './removeBackground';
import { tidySeam } from './tidy';

/**
 * The "Remove background" dialog: selecting things in the picture, and saying whether the
 * selection is what stays or what goes.
 *
 * Opening it on a layer starts a session. The session holds one bitmap, the selection, in the
 * layer's source space (see maskSpace.ts): opaque where the picture is selected. It starts as the
 * automatic suggestion (the subject), or on a layer that already has a cut-out as that cut-out.
 * A click on a thing adds that thing to the selection and leaves a point where it was clicked; a
 * click in "take away" mode removes the thing from it. The brush and the whole-picture commands
 * change it too. Every change is a step that can be undone. Nothing touches the document until
 * Apply, which stores the selection (kept) or its opposite (removed) as the layer's mask in one
 * undoable step; Cancel discards the session.
 */

export type RemovalTool = 'pick' | 'brush';
/** What a click or a stroke does to the selection. */
export type SelectMode = 'add' | 'subtract';
/** What happens to the selection when it is applied: it is what stays, or what goes. */
export type Outcome = 'keep' | 'remove';
export type RemovalView = 'selection' | 'result' | 'original';
/** Which of the object finder's candidates a click takes. */
export type ObjectDetail = 'auto' | 'smaller' | 'larger';

/** Where the picture was clicked, in fractions of its width and height, and what the click did. */
export interface SelectionPoint {
  fx: number;
  fy: number;
  mode: SelectMode;
}

export interface ObjectsStatus {
  state: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  message: string;
  /** 0..1 while downloading, otherwise null. */
  progress: number | null;
}

interface RemovalDialogState {
  layerId: string | null;
  /** 'failed' means the picture cannot be worked on at all; `error` says why. */
  phase: 'opening' | 'ready' | 'failed';
  error: string | null;
  /** Something the user should know that does not stop them (for example: no subject was found). */
  notice: string | null;
  /** The automatic suggestion is being worked out; the picture cannot be edited meanwhile. */
  detecting: boolean;
  /** The layer already had a cut-out, which is what the session started from. */
  reedit: boolean;
  objects: ObjectsStatus;
  /** A click on an object is being worked out. */
  busy: boolean;
  tool: RemovalTool;
  mode: SelectMode;
  outcome: Outcome;
  view: RemovalView;
  /** Brush width in thousandths of the picture's longer side (roughly). */
  brushSize: number;
  detail: ObjectDetail;
  canUndo: boolean;
  canRedo: boolean;
  /** The selection differs from what the session started with. */
  changed: boolean;
  /** Share of the picture that is selected, 0..1. */
  selected: number;
  /** Points placed by clicking, in the step that is showing. */
  points: number;
  /** How many times the automatic suggestion has finished (found something or not) since the dialog opened. */
  suggestions: number;
  /** Bumped whenever the picture in the dialog needs to be drawn again. */
  revision: number;
  set: (patch: Partial<Omit<RemovalDialogState, 'set'>>) => void;
}

const IDLE: ObjectsStatus = { state: 'idle', message: '', progress: null };

export const useRemovalDialog = create<RemovalDialogState>()((set) => ({
  layerId: null,
  phase: 'opening',
  error: null,
  notice: null,
  detecting: false,
  reedit: false,
  objects: IDLE,
  busy: false,
  tool: 'pick',
  mode: 'add',
  outcome: 'keep',
  view: 'selection',
  brushSize: 40,
  detail: 'auto',
  canUndo: false,
  canRedo: false,
  changed: false,
  selected: 0,
  points: 0,
  suggestions: 0,
  revision: 0,
  set: (patch) => set(patch),
}));

export const BRUSH_MIN = 4;
export const BRUSH_MAX = 300;

/** Share of the picture that applying would remove, given how much is selected and what happens to it. */
export const removedShare = (selected: number, outcome: Outcome) => (outcome === 'keep' ? 1 - selected : selected);

/** The object the pointer is over, shown before it is clicked. */
export interface Hover {
  fx: number;
  fy: number;
  hit: ObjectHit;
  /** The chosen candidate as a small soft mask (opaque = inside), or null when nothing was found. */
  shape: HTMLCanvasElement | null;
  /** What a click here would do. */
  mode: SelectMode;
}

/** One state of the selection: its alpha, and the points that were clicked to get there. */
interface Step {
  alpha: Uint8Array;
  points: SelectionPoint[];
}

interface Session {
  layerId: string;
  /** Identifies the picture for the object finder, which remembers the ones it has analysed. */
  key: string;
  /** The layer's original pixels, or a smaller copy of them when they are very large (see workingCopy). */
  source: RasterSource;
  /** Size of the selection bitmap (the layer's mask resolution). */
  width: number;
  height: number;
  selection: HTMLCanvasElement;
  /** `steps[cursor]` is what is showing. */
  steps: Step[];
  cursor: number;
  /** What the session started with, for Reset and for knowing whether anything changed. */
  opening: Uint8Array;
  /** The latest automatic suggestion and what to report if it is applied exactly as it is. */
  suggestion: { alpha: Uint8Array; applied: string } | null;
  hover: Hover | null;
  hoverWanted: { fx: number; fy: number; mode: SelectMode } | null;
  hoverRunning: boolean;
  stroke: { x: number; y: number; erase: boolean; size: number } | null;
}

let session: Session | null = null;

/** Where the picture is on the screen (window pixels), filled in by the dialog. For tests and the guide's recordings. */
export const stageProbe: { current: (() => { x: number; y: number; width: number; height: number } | null) | null } = { current: null };

/** The open session's picture, selection and points, for the dialog to draw. */
export function currentSession() {
  const s = session;
  return s ? { source: s.source, selection: s.selection, width: s.width, height: s.height, hover: s.hover, points: s.steps[s.cursor].points } : null;
}

const get = () => useRemovalDialog.getState();
const alive = (s: Session) => session === s;
const bump = () => get().set({ revision: get().revision + 1 });
const report: (layerId: string) => Report =
  (layerId) =>
  (phase, message, progress = null) =>
    useBackgroundRemoval.getState().set({ job: { layerId, phase, message, progress } });

// ---------- the selection bitmap and its history ----------

const context = (canvas: HTMLCanvasElement) => canvas.getContext('2d', { willReadFrequently: true })!;

/** Longer side of the picture the dialog works with. Masks are never finer than this (see maskSpace.ts). */
const WORKING_MAX = 2048;

/**
 * The picture as the dialog shows it and analyses it. A 24-megapixel photo would be scaled down
 * again for every redraw and every click; a copy at the size that is actually used is made once.
 */
function workingCopy(source: RasterSource): RasterSource {
  const { width, height } = sourceSize(source);
  const k = WORKING_MAX / Math.max(width, height);
  if (k >= 1) return source;
  const copy = blankCanvas(Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k)));
  const ctx = copy.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, copy.width, copy.height);
  return copy;
}

function alphaOf(canvas: HTMLCanvasElement) {
  const { data } = context(canvas).getImageData(0, 0, canvas.width, canvas.height);
  const alpha = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return alpha;
}

function paintAlpha(canvas: HTMLCanvasElement, alpha: Uint8Array) {
  const ctx = context(canvas);
  const image = ctx.createImageData(canvas.width, canvas.height);
  image.data.fill(255);
  for (let i = 0; i < alpha.length; i++) image.data[i * 4 + 3] = alpha[i];
  ctx.putImageData(image, 0, 0);
}

/** Replaces the selection with a bitmap of any size (it is scaled to fit). */
function setSelection(s: Session, bitmap: HTMLCanvasElement) {
  const ctx = context(s.selection);
  ctx.clearRect(0, 0, s.width, s.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, s.width, s.height);
}

/** Tells the dialog where the session stands now. */
function publish(s: Session) {
  const { alpha, points } = s.steps[s.cursor];
  let selected = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > 127) selected++;
  get().set({
    canUndo: s.cursor > 0,
    canRedo: s.cursor < s.steps.length - 1,
    changed: alpha !== s.opening,
    selected: selected / alpha.length,
    points: points.length,
    revision: get().revision + 1,
  });
}

/** Records a new step: the selection as it is now (or as given), and the points that go with it. */
function commit(s: Session, points: SelectionPoint[], alpha: Uint8Array = alphaOf(s.selection)) {
  s.steps.length = s.cursor + 1;
  s.steps.push({ alpha, points });
  // A step is one byte per mask pixel (up to about 3 MB); keep roughly 96 MB of them at most.
  const limit = Math.min(40, Math.max(8, Math.floor(96_000_000 / alpha.length)));
  while (s.steps.length > limit) s.steps.shift();
  s.cursor = s.steps.length - 1;
  s.hover = null;
  publish(s);
}

function show(s: Session, cursor: number) {
  s.cursor = cursor;
  paintAlpha(s.selection, s.steps[cursor].alpha);
  s.hover = null;
  publish(s);
}

/** Whether the session can be edited right now. */
function editable(s: Session | null): s is Session {
  const st = get();
  return !!s && st.phase === 'ready' && !st.detecting && !st.busy;
}

export function undoRemoval() {
  if (editable(session) && !session.stroke && session.cursor > 0) show(session, session.cursor - 1);
}

export function redoRemoval() {
  if (editable(session) && !session.stroke && session.cursor < session.steps.length - 1) show(session, session.cursor + 1);
}

/** Back to what the dialog opened with (itself a step, so it can be undone). */
export function resetRemoval() {
  const s = session;
  if (!editable(s) || s.steps[s.cursor].alpha === s.opening) return;
  paintAlpha(s.selection, s.opening);
  commit(s, [], s.opening);
}

/** Selects the whole picture, nothing, or the opposite of what is selected. The points no longer describe it, so they go. */
export function setWholePicture(to: 'all' | 'none' | 'invert') {
  const s = session;
  if (!editable(s)) return;
  const current = s.steps[s.cursor].alpha;
  const next = new Uint8Array(current.length);
  if (to === 'all') next.fill(255);
  else if (to === 'invert') for (let i = 0; i < next.length; i++) next[i] = 255 - current[i];
  paintAlpha(s.selection, next);
  commit(s, [], next);
}

// ---------- opening, the automatic suggestion, the object finder ----------

/** Opens the dialog for an image layer. */
export async function openRemovalDialog(layerId: string) {
  const running = useBackgroundRemoval.getState().job;
  if (running && running.phase !== 'done' && running.phase !== 'error') return;
  session = null;
  // The dialog shows itself while `layerId` is set (see BackgroundRemovalDialog).
  get().set({
    layerId,
    phase: 'opening',
    error: null,
    notice: null,
    detecting: false,
    reedit: false,
    objects: IDLE,
    busy: false,
    tool: 'pick',
    mode: 'add',
    outcome: 'keep',
    canUndo: false,
    canRedo: false,
    changed: false,
    selected: 0,
    points: 0,
    suggestions: 0,
  });
  const stillOpening = () => get().layerId === layerId && get().phase === 'opening' && !session;

  let s: Session;
  try {
    report(layerId)('preparing', 'Preparing the image…');
    const { layer, source, size } = await loadLayerPixels(layerId);
    const existing = layer.masks[0]?.origin === 'background-removal' ? layer.masks[0] : null;
    const cutOut = existing ? await loadRaster(existing.rasterId) : null;
    if (existing && !cutOut) throw new Error('The mask data could not be loaded.');
    if (!stillOpening()) return;

    // Nothing is selected to begin with; the suggestion (or the existing cut-out) fills it in.
    const selection = blankCanvas(size.width, size.height);
    context(selection).clearRect(0, 0, size.width, size.height);
    s = {
      layerId,
      key: JSON.stringify(layer.source),
      source: workingCopy(source),
      width: size.width,
      height: size.height,
      selection,
      steps: [],
      cursor: 0,
      opening: new Uint8Array(0),
      suggestion: null,
      hover: null,
      hoverWanted: null,
      hoverRunning: false,
      stroke: null,
    };
    if (cutOut) setSelection(s, cutOut);
    s.opening = alphaOf(selection);
    s.steps = [{ alpha: s.opening, points: [] }];
    session = s;
    get().set({
      phase: 'ready',
      reedit: !!cutOut,
      notice: cutOut ? 'This is the cut-out as you left it: what is kept is selected. Change it here, or press Automatic to find the subject again.' : null,
    });
    publish(s);
    if (cutOut) useBackgroundRemoval.getState().set({ job: null });
  } catch (err) {
    if (get().layerId !== layerId) return;
    const message = err instanceof Error ? err.message : 'The image could not be opened.';
    get().set({ phase: 'failed', error: message });
    report(layerId)('error', message);
    return;
  }
  // The dialog is drawn first; reading the picture for the two models comes after, one at a time.
  await nextPaint();
  if (!alive(s)) return;
  if (!get().reedit) void suggest(s, true);
  // Each model has the picture read for it on the main thread (about a tenth of a second each).
  // Spaced apart, neither is felt; back to back they add up to a hitch.
  await new Promise((resolve) => setTimeout(resolve, get().reedit ? 0 : 350));
  if (alive(s)) void startObjects(s);
}

/** What can be done with a cut-out once it is applied. */
const AFTERWARDS = 'The original is intact: press “Edit background removal” to change what is kept, touch up the mask with the brush or eraser, or hold Compare.';

/**
 * Works out the automatic suggestion and makes it the selection. As the session's first state it
 * becomes what Reset returns to; later (the Automatic button) it is an ordinary step.
 */
async function suggest(s: Session, opening: boolean) {
  const tell = report(s.layerId);
  /** The dialog was closed while the model was still running: its answer is dropped and the status cleared. */
  const abandon = () => {
    const job = useBackgroundRemoval.getState().job;
    if (job?.layerId === s.layerId && job.phase !== 'error') useBackgroundRemoval.getState().set({ job: null });
  };
  get().set({ detecting: true, notice: null });
  s.hover = null;
  const started = performance.now();
  try {
    const { mask, model, milliseconds, threads, downloaded, plain } = await findSubject(s.layerId, tell);
    if (!alive(s)) return abandon();
    setSelection(s, mask);
    const alpha = alphaOf(s.selection);
    if (opening) {
      s.opening = alpha;
      s.steps = [{ alpha, points: [] }];
      s.cursor = 0;
    } else {
      commit(s, [], alpha);
    }
    // The suggestion is the subject, which is what stays.
    get().set({ outcome: 'keep' });
    if (plain) {
      const hex = '#' + plain.colour.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      tell('done', `The artwork on the plain background (${hex}) is selected; areas of that colour enclosed by the artwork are part of it.`);
      get().set({ notice: `A plain background (${hex}) was found, and everything but it is selected. For a photo, set Method to “Find the subject” in the AI tools tab.` });
      s.suggestion = {
        alpha,
        applied: `Removed the plain background (${hex}) around the picture; areas of that colour enclosed by the artwork were kept. The original is intact. If this is a photo and you want the subject cut out instead, set Method to “Find the subject” in the AI tools tab.`,
      };
    } else {
      const totalMs = performance.now() - started;
      useBackgroundRemoval.getState().set({ lastRun: { model: model.id as ModelId, inferenceMs: milliseconds, totalMs, threads } });
      const took = `${(totalMs / 1000).toFixed(1)} s${downloaded ? ' (including the one-time model download)' : ''}`;
      tell('done', `The subject was found in ${took}.`);
      s.suggestion = { alpha, applied: `Background removed in ${took}. ${AFTERWARDS}` };
    }
  } catch (err) {
    if (!alive(s)) return abandon();
    const message = err instanceof Error ? err.message : 'The subject could not be found.';
    tell('error', message);
    get().set({ notice: `${message.replace(' Try the brush on a mask instead.', '')} Nothing is selected yet: click the things you want.` });
  } finally {
    if (alive(s)) {
      get().set({ detecting: false, suggestions: get().suggestions + 1 });
      publish(s);
    }
  }
}

/** Finds the subject again with the current settings (AI tools tab) and replaces the selection with it. */
export function suggestAgain() {
  if (editable(session)) void suggest(session, false);
}

/** Gets the object finder ready for this picture, in the background. */
async function startObjects(s: Session) {
  const tell = (objects: ObjectsStatus) => alive(s) && get().set({ objects });
  /** Without the object finder the brush still works, so the dialog moves to it. */
  const withoutObjects = (state: 'unavailable' | 'error', message: string) => {
    if (!alive(s)) return;
    get().set({ objects: { state, message, progress: null }, ...(get().tool === 'pick' ? { tool: 'brush' as const } : {}) });
  };
  tell({ state: 'loading', message: 'Getting the object finder ready…', progress: null });
  if (!(await detectObjectModel())) {
    withoutObjects('unavailable', 'Clicking objects needs a model that is not installed on this server (run “npm run setup:ai”). The brush works without it.');
    return;
  }
  try {
    await nextPaint();
    if (!alive(s)) return;
    await prepareObjects(s.key, s.source, (phase, loaded = 0, total = 0) => {
      if (phase === 'downloading') {
        tell({ state: 'loading', message: `Downloading the object finder (${megabytes(loaded)} of ${megabytes(total)})…`, progress: total ? Math.min(1, loaded / total) : null });
      } else {
        tell({ state: 'loading', message: phase === 'initialising' ? 'Starting the object finder…' : 'Finding the objects in the picture…', progress: null });
      }
    });
    tell({ state: 'ready', message: '', progress: null });
  } catch (err) {
    withoutObjects('error', `${err instanceof Error ? err.message : 'The object finder could not be started.'} The brush still works.`);
  }
}

// ---------- clicking objects ----------

function choose(hit: ObjectHit, detail: ObjectDetail): ObjectCandidate | null {
  const found = hit.candidates.filter((c) => c.area > 0.0004);
  if (!found.length) return null;
  if (detail === 'smaller') return found[0];
  if (detail === 'larger') return found[found.length - 1];
  return found.reduce((best, c) => (c.score > best.score ? c : best));
}

/**
 * The model's answer spread over this many units either side of its edge. A wide, gentle ramp
 * scales up to a smooth outline; RAMP_SHARPEN then makes that outline crisp again.
 */
const RAMP = 8;
const RAMP_SHARPEN = 4;

/**
 * A candidate as a small mask: opaque inside the object. `ramp` keeps the model's own gradual
 * edge (for building the real mask); without it the edge is a narrow step (for showing), so that
 * places the model is unsure about are either in or out, not half-tinted.
 */
function shapeOf(hit: ObjectHit, candidate: ObjectCandidate, ramp = false) {
  const canvas = blankCanvas(hit.width, hit.height);
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(hit.width, hit.height);
  image.data.fill(255);
  for (let i = 0; i < candidate.logits.length; i++) {
    const v = candidate.logits[i];
    image.data[i * 4 + 3] = ramp ? Math.round(Math.min(1, Math.max(0, 0.5 + v / (2 * RAMP))) * 255) : Math.round(Math.min(1, Math.max(0, 0.5 + v / 3)) * 255);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** How close two points must be to count as the same spot (as a fraction of the picture). */
const SAME_SPOT = 0.004;
const sameSpot = (a: { fx: number; fy: number }, b: { fx: number; fy: number }) => Math.abs(a.fx - b.fx) < SAME_SPOT && Math.abs(a.fy - b.fy) < SAME_SPOT;

/**
 * A click on the picture: the thing at that point is added to the selection (or taken out of it),
 * and a point is left where the click was. `override` does one or the other regardless of the
 * current mode. The point is in fractions of the picture's width and height.
 */
export async function pickObject(fx: number, fy: number, override?: SelectMode) {
  const s = session;
  if (!editable(s) || get().objects.state !== 'ready' || fx < 0 || fy < 0 || fx > 1 || fy > 1) return;
  const mode = override ?? get().mode;
  get().set({ busy: true });
  try {
    const hit = s.hover && sameSpot(s.hover, { fx, fy }) ? s.hover.hit : await objectAt(s.key, fx, fy);
    const candidate = choose(hit, get().detail);
    if (!alive(s)) return;
    if (!candidate) {
      useUiStore.getState().notify('No object was found at that spot. Try the brush there instead.');
      return;
    }
    const refine = useBackgroundRemoval.getState().refineEdges ? refineWithObjects : null;
    const shape = await buildCoverage(shapeOf(hit, candidate, true), s.source, s.width, s.height, refine, { sharpen: RAMP_SHARPEN, guide: 'contrast', reach: 1.6 });
    if (!alive(s)) return;
    const object = alphaOf(shape);
    const current = s.steps[s.cursor];
    const next = new Uint8Array(current.alpha);
    if (mode === 'add') for (let i = 0; i < next.length; i++) next[i] = Math.max(next[i], object[i]);
    else for (let i = 0; i < next.length; i++) next[i] = Math.min(next[i], 255 - object[i]);
    // Where the object's outline and the old one did not quite meet, a hairline is left: clear it.
    tidySeam(next, object, s.width, s.height, mode === 'add' ? 'keep' : 'remove', Math.max(2, Math.round(Math.max(s.width, s.height) * 0.004)));
    paintAlpha(s.selection, next);
    commit(s, [...current.points, { fx, fy, mode }], next);
  } catch (err) {
    if (alive(s)) useUiStore.getState().notify(err instanceof Error ? err.message : 'That object could not be selected.');
  } finally {
    if (alive(s)) get().set({ busy: false });
  }
}

/**
 * Shows which object the pointer is over (null = the pointer has left the picture). Only the most
 * recent request is worked on, so the highlight keeps up with the pointer.
 */
export function hoverObject(point: { fx: number; fy: number; mode: SelectMode } | null) {
  const s = session;
  if (!s) return;
  if (!point || !editable(s) || s.stroke || get().objects.state !== 'ready' || get().tool !== 'pick') {
    s.hoverWanted = null;
    if (s.hover) {
      s.hover = null;
      bump();
    }
    return;
  }
  s.hoverWanted = point;
  if (s.hover && sameSpot(s.hover, point)) {
    // Same object; only what a click would do may have changed (the mode, or Shift or Alt).
    if (point.mode !== s.hover.mode) {
      s.hover = { ...s.hover, mode: point.mode };
      bump();
    }
    return;
  }
  if (!s.hoverRunning) void runHover(s);
}

async function runHover(s: Session) {
  s.hoverRunning = true;
  try {
    while (alive(s) && s.hoverWanted && !(s.hover && sameSpot(s.hover, s.hoverWanted))) {
      const want = s.hoverWanted;
      const hit = await objectAt(s.key, want.fx, want.fy);
      // The pointer may have left, or a click may have changed the picture, while this was worked out.
      if (!alive(s) || !s.hoverWanted || get().busy || get().detecting) break;
      const candidate = choose(hit, get().detail);
      s.hover = { fx: want.fx, fy: want.fy, hit, shape: candidate ? shapeOf(hit, candidate) : null, mode: s.hoverWanted.mode };
      bump();
    }
  } catch {
    // A highlight that cannot be worked out is simply not shown; a click reports the reason.
  } finally {
    s.hoverRunning = false;
  }
}

/** Forgets the highlight (it was worked out for a setting that has just changed). */
export function clearHover() {
  if (session?.hover) {
    session.hover = null;
    bump();
  }
}

/** Changes how much a click takes. */
export function setObjectDetail(detail: ObjectDetail) {
  get().set({ detail });
  clearHover();
}

// ---------- the brush ----------

function line(s: Session, x0: number, y0: number, x1: number, y1: number) {
  const stroke = s.stroke!;
  const ctx = context(s.selection);
  ctx.save();
  ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
  ctx.fillStyle = ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x1, y1, stroke.size / 2, 0, Math.PI * 2);
  ctx.fill();
  if (x0 !== x1 || y0 !== y1) {
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}

/** Brush width in selection pixels. */
export const brushWidth = (size: number, width: number, height: number) => (size * Math.max(width, height)) / 1024;

/** Starts a stroke that adds to the selection or takes away from it. Returns false when no stroke was started. */
export function beginStroke(fx: number, fy: number, override?: SelectMode) {
  const s = session;
  if (!editable(s) || get().tool !== 'brush' || s.stroke) return false;
  s.hover = null;
  s.stroke = { x: fx * s.width, y: fy * s.height, erase: (override ?? get().mode) === 'subtract', size: brushWidth(get().brushSize, s.width, s.height) };
  line(s, s.stroke.x, s.stroke.y, s.stroke.x, s.stroke.y);
  bump();
  return true;
}

export function extendStroke(fx: number, fy: number) {
  const s = session;
  if (!s?.stroke) return;
  const x = fx * s.width;
  const y = fy * s.height;
  line(s, s.stroke.x, s.stroke.y, x, y);
  s.stroke.x = x;
  s.stroke.y = y;
  bump();
}

export function endStroke() {
  const s = session;
  if (!s?.stroke) return;
  s.stroke = null;
  commit(s, s.steps[s.cursor].points);
}

// ---------- leaving ----------

/** Stores the selection (kept) or its opposite (removed) as the layer's mask, in one undo step, and closes the dialog. */
export function applyRemoval() {
  const s = session;
  if (!editable(s) || s.stroke) return;
  const { layerId } = s;
  if (!getImageLayer(layerId)) {
    closeRemovalDialog();
    report(layerId)('error', 'The layer was removed before the result was applied.');
    return;
  }
  const { alpha } = s.steps[s.cursor];
  const { outcome } = get();
  // What stays: the selection, or everything but it.
  const kept = outcome === 'keep' ? alpha : alpha.map((v) => 255 - v);
  // A canvas of its own: once it is a mask it must never change again.
  const mask = blankCanvas(s.width, s.height);
  paintAlpha(mask, kept);
  // The suggestion applied exactly as it came says what it was; anything else is the user's own choice.
  const message = outcome === 'keep' && s.suggestion?.alpha === alpha ? s.suggestion.applied : `${outcome === 'keep' ? 'Kept what you selected and removed the rest' : 'Removed what you selected'}. ${AFTERWARDS}`;
  setMaskBitmap(layerId, mask, 'background-removal');
  closeRemovalDialog();
  report(layerId)('done', message);
}

/** Closes the dialog without changing the layer. */
export function closeRemovalDialog() {
  const { layerId } = get();
  session = null;
  get().set({ layerId: null, phase: 'opening', error: null, notice: null, detecting: false, busy: false, objects: IDLE });
  // A suggestion that was not applied is not a result; a reason for failing stays readable.
  const job = useBackgroundRemoval.getState().job;
  if (job && job.layerId === layerId && job.phase !== 'error') useBackgroundRemoval.getState().set({ job: null });
}
