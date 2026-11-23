import { createImage } from '../document/factory';
import { findLayer, layerToDocument } from '../document/operations';
import { addMask, blankCanvas, maskSize } from '../masks/maskActions';
import { layerToBitmap } from '../masks/maskSpace';
import { selectionInLayerSpace } from '../selection/selectionSpace';
import { getRaster, putRaster } from '../../services/rasters';
import { useEditorStore } from '../../stores/editorStore';
import { useToolStore, type BrushSettings } from '../../stores/toolStore';
import { useUiStore } from '../../stores/uiStore';
import type { ImageLayer } from '../../types/document';
import { applyMat, invert, multiply, type Mat, type Point, type Rect } from '../../utils/geometry';
import { brushTip, dabAlpha, dabSpacing, StrokePath } from './brush';

/**
 * Brush and eraser strokes on raster data: layer masks, paint layers, and the painted part of a fade.
 *
 * A stroke never edits a stored bitmap. It works on a copy that the canvas displays live through
 * the tool store's paint session; when the stroke ends the copy becomes a new raster and the
 * document is pointed at it, which is a single undoable change.
 */

export const PAINT_MAX_DIM = 2048;

export type PaintTool = 'brush' | 'eraser';

export type PaintTarget =
  | { kind: 'mask'; layer: ImageLayer; reveal: boolean }
  | { kind: 'paint'; layer: ImageLayer; erase: boolean }
  /** The layer's fade is being painted: strokes fade the image, erasing brings it back. */
  | { kind: 'fade'; layer: ImageLayer; erase: boolean }
  /** Brush with nothing paintable selected: a paint layer is created for the stroke. */
  | { kind: 'new-paint' }
  /** Eraser on an image without a mask: a mask is added so the erase stays non-destructive. */
  | { kind: 'auto-mask'; layer: ImageLayer }
  | { kind: 'none'; reason: string };

/** Works out what a stroke with the given tool would edit right now. Has no side effects. */
export function resolvePaintTarget(tool: PaintTool, invertErase = false): PaintTarget {
  const { doc, selectedIds } = useEditorStore.getState();
  const ui = useUiStore.getState();
  const tools = useToolStore.getState();
  const selected = selectedIds.length === 1 ? findLayer(doc.layers, selectedIds[0]) : null;
  const image = selected?.type === 'image' ? selected : null;
  if (image && (image.locked || !image.visible)) {
    return { kind: 'none', reason: `“${image.name}” is ${image.locked ? 'locked' : 'hidden'}.` };
  }
  if (image?.fade && ui.fadePaintLayerId === image.id) return { kind: 'fade', layer: image, erase: (tool === 'eraser') !== invertErase };
  const editingMask = !!image && ui.maskEditLayerId === image.id && image.masks.length > 0;

  if (tool === 'brush') {
    if (editingMask) return { kind: 'mask', layer: image, reveal: tools.maskValue === 'reveal' };
    if (image?.source.kind === 'raster') return { kind: 'paint', layer: image, erase: false };
    return { kind: 'new-paint' };
  }
  if (!image) return { kind: 'none', reason: 'Select an image or paint layer to erase.' };
  if (editingMask) return { kind: 'mask', layer: image, reveal: tools.eraserRestore !== invertErase };
  if (image.source.kind === 'raster') return { kind: 'paint', layer: image, erase: true };
  if (image.masks.length) return { kind: 'mask', layer: image, reveal: tools.eraserRestore !== invertErase };
  return { kind: 'auto-mask', layer: image };
}

interface ActiveStroke {
  layerId: string;
  maskId: string | null;
  /** The stroke goes to the layer's fade. */
  fade: boolean;
  base: HTMLCanvasElement;
  buffer: HTMLCanvasElement;
  working: HTMLCanvasElement;
  /** Document coordinates -> raster pixels. */
  toRaster: Mat;
  erase: boolean;
  tip: HTMLCanvasElement;
  settings: BrushSettings;
  alpha: number;
  path: StrokePath;
  lastPoint: Point;
  pressure: number;
  dirty: Rect | null;
  frame: number | null;
  /** Fold the stroke into the undo step that created its layer or mask. */
  amend: boolean;
  /** The area selection in this bitmap's space: when set, the stroke only lands inside it. */
  clip: HTMLCanvasElement | null;
}

let active: ActiveStroke | null = null;
let scratch: HTMLCanvasElement | null = null;
let clipScratch: HTMLCanvasElement | null = null;

export const isPainting = () => active !== null;

function strokeBuffer(width: number, height: number) {
  if (!scratch || scratch.width !== width || scratch.height !== height) scratch = blankCanvas(width, height);
  else scratch.getContext('2d')!.clearRect(0, 0, width, height);
  return scratch;
}

function createPaintLayer(): ImageLayer {
  const { doc, addLayers } = useEditorStore.getState();
  const k = Math.min(1, PAINT_MAX_DIM / Math.max(doc.width, doc.height));
  const width = Math.max(1, Math.round(doc.width * k));
  const height = Math.max(1, Math.round(doc.height * k));
  const rasterId = putRaster(blankCanvas(width, height));
  const count = doc.layers.filter((l) => l.type === 'image' && l.source.kind === 'raster').length;
  const layer: ImageLayer = {
    ...createImage({ kind: 'raster', rasterId, width, height }, `Paint layer ${count + 1}`, width, height, doc.width, doc.height),
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
  };
  addLayers([layer]);
  return layer;
}

/** Adds an empty paint layer on top of the design and selects it. */
export function addPaintLayer() {
  const layer = createPaintLayer();
  useUiStore.getState().set({ maskEditLayerId: null, maskViewLayerId: null });
  return layer.id;
}

function stamp(st: ActiveStroke, p: Point, pressure: number) {
  const size = st.settings.size * (0.25 + 0.75 * pressure);
  const r = size / 2;
  const ctx = st.buffer.getContext('2d')!;
  const m = st.toRaster;
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.globalAlpha = st.alpha;
  ctx.drawImage(st.tip, p.x - r, p.y - r, size, size);

  // Grow the dirty region by this dab's footprint in raster space.
  const corners = [applyMat(m, p.x - r, p.y - r), applyMat(m, p.x + r, p.y - r), applyMat(m, p.x + r, p.y + r), applyMat(m, p.x - r, p.y + r)];
  const x0 = Math.floor(Math.min(...corners.map((c) => c.x))) - 2;
  const y0 = Math.floor(Math.min(...corners.map((c) => c.y))) - 2;
  const x1 = Math.ceil(Math.max(...corners.map((c) => c.x))) + 2;
  const y1 = Math.ceil(Math.max(...corners.map((c) => c.y))) + 2;
  if (!st.dirty) st.dirty = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  else {
    const nx = Math.min(st.dirty.x, x0);
    const ny = Math.min(st.dirty.y, y0);
    st.dirty = {
      x: nx,
      y: ny,
      width: Math.max(st.dirty.x + st.dirty.width, x1) - nx,
      height: Math.max(st.dirty.y + st.dirty.height, y1) - ny,
    };
  }
}

/** Rebuilds the changed part of the working canvas (base + stroke at the stroke's opacity) and shows it. */
function flush(st: ActiveStroke) {
  st.frame = null;
  if (!st.dirty) return;
  const x = Math.max(0, st.dirty.x);
  const y = Math.max(0, st.dirty.y);
  const w = Math.min(st.working.width, st.dirty.x + st.dirty.width) - x;
  const h = Math.min(st.working.height, st.dirty.y + st.dirty.height) - y;
  st.dirty = null;
  if (w <= 0 || h <= 0) return;
  const ctx = st.working.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(st.base, x, y, w, h, x, y, w, h);
  ctx.globalAlpha = st.settings.opacity;
  ctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
  if (st.clip) {
    // Keep only the part of the stroke that falls inside the selection.
    clipScratch ??= document.createElement('canvas');
    if (clipScratch.width < w || clipScratch.height < h) {
      clipScratch.width = Math.max(clipScratch.width, w);
      clipScratch.height = Math.max(clipScratch.height, h);
    }
    const cctx = clipScratch.getContext('2d')!;
    cctx.globalCompositeOperation = 'source-over';
    cctx.clearRect(0, 0, w, h);
    cctx.drawImage(st.buffer, x, y, w, h, 0, 0, w, h);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(st.clip, x, y, w, h, 0, 0, w, h);
    ctx.drawImage(clipScratch, 0, 0, w, h, x, y, w, h);
  } else {
    ctx.drawImage(st.buffer, x, y, w, h, x, y, w, h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  useToolStore.setState((s) => (s.session ? { session: { ...s.session, version: s.session.version + 1 } } : s));
}

function schedule(st: ActiveStroke) {
  if (st.frame === null) st.frame = requestAnimationFrame(() => active === st && flush(st));
}

/**
 * Starts a stroke at a document-space point. Returns false (with a message to the user) when there
 * is nothing the tool can edit.
 */
export function beginStroke(tool: PaintTool, point: Point, pressure = 1, invertErase = false): boolean {
  if (active) endStroke();
  const ui = useUiStore.getState();
  const tools = useToolStore.getState();
  let target = resolvePaintTarget(tool, invertErase);
  let amend = false;

  if (target.kind === 'none') {
    ui.notify(target.reason);
    return false;
  }
  if (target.kind === 'new-paint') {
    target = { kind: 'paint', layer: createPaintLayer(), erase: false };
    ui.set({ maskEditLayerId: null, maskViewLayerId: null });
    amend = true;
  } else if (target.kind === 'auto-mask') {
    const mask = addMask(target.layer.id);
    if (!mask) return false;
    const layer = findLayer(useEditorStore.getState().doc.layers, target.layer.id) as ImageLayer;
    ui.set({ maskEditLayerId: layer.id });
    ui.notify('Added a mask so erasing hides pixels without deleting them.');
    target = { kind: 'mask', layer, reveal: false };
    amend = true;
  }

  const { layer } = target;
  const mask = target.kind === 'mask' ? layer.masks[0] : null;
  // Keep the interface honest about what is being edited.
  if (mask && ui.maskEditLayerId !== layer.id) ui.set({ maskEditLayerId: layer.id });
  const onFade = target.kind === 'fade';
  let base: HTMLCanvasElement | null;
  if (onFade) {
    // The first stroke starts from nothing painted, at the resolution a mask of this image would have.
    const painted = layer.fade?.paint;
    const size = painted ? null : maskSize(layer.source);
    base = painted ? getRaster(painted.rasterId) : size ? blankCanvas(size.width, size.height) : null;
  } else {
    const rasterId = mask ? mask.rasterId : layer.source.kind === 'raster' ? layer.source.rasterId : null;
    base = rasterId ? getRaster(rasterId) : null;
  }
  const toDoc = layerToDocument(useEditorStore.getState().doc.layers, layer.id);
  if (!base || !toDoc) {
    ui.notify('That layer is still loading. Try again in a moment.');
    return false;
  }

  // Document -> the layer's own box -> the bitmap's pixels (source space; see maskSpace.ts).
  const toRaster = multiply(layerToBitmap(layer, base.width, base.height), invert(toDoc));

  const settings = tool === 'brush' ? tools.brush : tools.eraser;
  const erase = target.kind === 'mask' ? !target.reveal : target.erase;
  const working = blankCanvas(base.width, base.height);
  working.getContext('2d')!.drawImage(base, 0, 0);

  active = {
    layerId: layer.id,
    maskId: mask?.id ?? null,
    fade: onFade,
    base,
    buffer: strokeBuffer(base.width, base.height),
    working,
    toRaster,
    erase,
    // Masks and fades store coverage only, so their strokes are always drawn in white.
    tip: brushTip(target.kind !== 'paint' || erase ? '#ffffff' : tools.color, settings.hardness),
    settings,
    alpha: dabAlpha(settings.flow),
    path: new StrokePath(dabSpacing(settings.size, settings.hardness), settings.smoothing),
    lastPoint: point,
    pressure,
    dirty: null,
    frame: null,
    amend,
    clip: selectionInLayerSpace(layer, base.width, base.height),
  };
  useToolStore.setState({
    session: { layerId: layer.id, target: mask ? 'mask' : onFade ? 'fade' : 'content', maskId: mask?.id ?? null, canvas: working, version: 0 },
  });
  for (const p of active.path.add(point)) stamp(active, p, pressure);
  schedule(active);
  return true;
}

export function extendStroke(points: Point[], pressure = 1) {
  const st = active;
  if (!st || !points.length) return;
  for (const point of points) {
    for (const p of st.path.add(point)) stamp(st, p, pressure);
  }
  st.lastPoint = points[points.length - 1];
  st.pressure = pressure;
  schedule(st);
}

/** Finishes the stroke and commits the result to the document as one undo step. */
export function endStroke() {
  const st = active;
  if (!st) return;
  for (const p of st.path.end(st.lastPoint)) stamp(st, p, st.pressure);
  if (st.frame !== null) cancelAnimationFrame(st.frame);
  flush(st);
  active = null;
  st.buffer.getContext('2d')!.setTransform(1, 0, 0, 1, 0, 0);

  const rasterId = putRaster(st.working);
  const editor = useEditorStore.getState();
  editor.updateLayers(
    [st.layerId],
    (l) => {
      if (l.type !== 'image') return {};
      if (st.fade) return l.fade ? { fade: { ...l.fade, paint: { rasterId, width: st.working.width, height: st.working.height } } } : {};
      if (st.maskId) return { masks: l.masks.map((m) => (m.id === st.maskId ? { ...m, rasterId } : m)) };
      return l.source.kind === 'raster' ? { source: { ...l.source, rasterId } } : {};
    },
    { amend: st.amend },
  );
  useToolStore.setState({ session: null });
}

/** Abandons the stroke without changing the document. */
export function cancelStroke() {
  const st = active;
  if (!st) return;
  if (st.frame !== null) cancelAnimationFrame(st.frame);
  active = null;
  st.buffer.getContext('2d')!.setTransform(1, 0, 0, 1, 0, 0);
  useToolStore.setState({ session: null });
}
