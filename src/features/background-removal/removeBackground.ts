import { create } from 'zustand';
import { sourceSize, type RasterSource } from '../image-editing/pipeline';
import { blankCanvas, getImageLayer, maskSize, sourceRaster } from '../masks/maskActions';
import { loadAssetImage } from '../../services/assets';
import { loadRaster } from '../../services/rasters';
import { MODELS, type ModelId, type SegmentationModel } from './models';
import { plainBackgroundMask } from './plainBackground';
import type { RefineRequest, SegmentRequest, SegmentResponse } from './segment.worker';

/**
 * How the background is found.
 *  - 'auto': a picture on a plain backdrop (a logo, an illustration, a product shot) has exactly that
 *    backdrop removed; anything else goes to the subject-finding network.
 *  - 'subject': always the network (for photographs).
 *  - 'plain': always remove the backdrop colour found around the picture's edges.
 */
export type RemovalMethod = 'auto' | 'subject' | 'plain';

/**
 * Background removal: the background is found (a plain backdrop by its colour, anything else by a
 * segmentation network that predicts which pixels belong to the subject), and the
 * result becomes the layer's mask. Nothing is uploaded and the layer's pixels are not changed, so
 * the result can be refined with the brush, compared with the original, disabled or undone.
 *
 * This file finds the background. Choosing what to do with the answer (which objects to keep, which
 * to remove) happens in the dialog: see removalSession.ts.
 */

export interface RemovalJob {
  layerId: string;
  phase: 'preparing' | 'downloading' | 'initialising' | 'running' | 'refining' | 'done' | 'error';
  message: string;
  /** 0..1 while downloading, otherwise null. */
  progress: number | null;
}

interface RemovalState {
  job: RemovalJob | null;
  method: RemovalMethod;
  model: ModelId;
  /** Models whose files are present on this server. null until checked. */
  available: ModelId[] | null;
  /** Snap mask edges to edges in the photo (recommended). */
  refineEdges: boolean;
  /** Timing of the most recent run, for display and tests. */
  lastRun: { model: ModelId; inferenceMs: number; totalMs: number; threads: number } | null;
  set: (patch: Partial<Pick<RemovalState, 'job' | 'method' | 'model' | 'refineEdges' | 'lastRun' | 'available'>>) => void;
}

export const useBackgroundRemoval = create<RemovalState>()((set) => ({
  job: null,
  method: 'auto',
  model: 'silueta',
  available: null,
  refineEdges: true,
  lastRun: null,
  set: (patch) => set(patch),
}));

let detection: Promise<ModelId[]> | null = null;

/**
 * Checks which model files this server actually has, and falls back to the best one present
 * if the selected model is missing. Safe to call repeatedly.
 */
export function detectModels(): Promise<ModelId[]> {
  detection ??= (async () => {
    const found: ModelId[] = [];
    for (const id of Object.keys(MODELS) as ModelId[]) {
      try {
        const response = await fetch(MODELS[id].url, { method: 'HEAD' });
        // Dev servers answer unknown paths with the app's HTML, so the type matters too.
        if (response.ok && !(response.headers.get('content-type') ?? '').includes('text/html')) found.push(id);
      } catch {
        // Offline or blocked: treated as unavailable.
      }
    }
    const state = useBackgroundRemoval.getState();
    const preferred: ModelId[] = ['silueta', 'u2netp', 'isnet-general-use'];
    const model = found.includes(state.model) ? state.model : (preferred.find((id) => found.includes(id)) ?? state.model);
    state.set({ available: found, model });
    return found;
  })();
  return detection;
}

export const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;

// ---------- worker plumbing ----------

type WorkerResult = Extract<SegmentResponse, { type: 'result' | 'refined' }>;

interface Pending {
  resolve: (result: WorkerResult) => void;
  reject: (error: Error) => void;
  onProgress: (message: SegmentResponse & { type: 'progress' }) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<SegmentResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === 'progress') entry.onProgress(message);
    else {
      pending.delete(message.id);
      if (message.type === 'error') entry.reject(new Error(message.message));
      else entry.resolve(message);
    }
  };
  worker.onerror = (event) => {
    // The worker itself failed (for example WebAssembly is unavailable). Start fresh next time.
    const error = new Error(event.message || 'The segmentation engine could not start in this browser.');
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function send(request: SegmentRequest | RefineRequest, transfer: Transferable[], onProgress: Pending['onProgress'] = () => {}) {
  return new Promise<WorkerResult>((resolve, reject) => {
    pending.set(request.id, { resolve, reject, onProgress });
    getWorker().postMessage(request, transfer);
  });
}

async function segment(model: SegmentationModel, input: Float32Array, onProgress: Pending['onProgress']) {
  const request: SegmentRequest = { kind: 'segment', id: nextId++, modelUrl: model.url, inputSize: model.inputSize, input };
  const result = await send(request, [input.buffer], onProgress);
  if (result.type !== 'result') throw new Error('Unexpected reply from the segmentation engine.');
  return result;
}

const refineInWorker: RefineEdges = async (guide, mask, width, height, radius) => {
  const request: RefineRequest = { kind: 'refine', id: nextId++, guide, mask, width, height, radius, eps: 2e-4 };
  const result = await send(request, [guide.buffer, mask.buffer]);
  if (result.type !== 'refined') throw new Error('Unexpected reply from the segmentation engine.');
  return result.mask;
};

// ---------- pre- and post-processing ----------

/** Resizes the image to the network's square input and normalises it (channel-first float32). */
function prepareInput(source: RasterSource, model: SegmentationModel) {
  const size = model.inputSize;
  const canvas = blankCanvas(size, size, '#ffffff');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const area = size * size;
  let max = 1;
  for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i], data[i + 1], data[i + 2]);
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    for (let c = 0; c < 3; c++) input[c * area + i] = (data[i * 4 + c] / max - model.mean[c]) / model.std[c];
  }
  return input;
}

/** Snaps the edge of a soft mask to edges in the picture (see refine.ts). */
export type RefineEdges = (guide: Float32Array, mask: Float32Array, width: number, height: number, radius: number) => Promise<Float32Array>;

export interface CoverageOptions {
  /**
   * Steepens the mask's edge after it is scaled up (1 = leave it). For a small mask that stores a
   * wide, gentle ramp across its edge: scaled up and then steepened, that gives a much crisper
   * outline than a small mask that is already hard-edged.
   */
  sharpen?: number;
  /**
   * What the edge is moved onto. 'brightness' follows edges in the picture's brightness. 'contrast'
   * follows the difference in colour between what the mask covers and what surrounds it, which also
   * finds the edge of a thing that is as bright as its background but another colour.
   */
  guide?: 'brightness' | 'contrast';
  /** How far an edge may move, in cells of the small mask. */
  reach?: number;
}

/**
 * The picture reduced to the one number per pixel that best tells the inside of a mask from its
 * surroundings: each pixel's colour measured along the line from the surroundings' average colour
 * to the inside's. Null when the two are too alike for that to mean anything.
 */
function contrastGuide(pixels: Uint8ClampedArray, alpha: Float32Array, w: number, h: number) {
  let left = w;
  let top = h;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] <= 0.6) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  // "Surroundings" means near the mask, not the far side of the picture.
  const margin = Math.max(16, Math.round(Math.max(right - left, bottom - top) * 0.15));
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(w - 1, right + margin);
  bottom = Math.min(h - 1, bottom + margin);
  const inside = [0, 0, 0, 0];
  const outside = [0, 0, 0, 0];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const i = y * w + x;
      const sum = alpha[i] > 0.6 ? inside : alpha[i] < 0.4 ? outside : null;
      if (!sum) continue;
      sum[0] += pixels[i * 4];
      sum[1] += pixels[i * 4 + 1];
      sum[2] += pixels[i * 4 + 2];
      sum[3]++;
    }
  }
  if (!inside[3] || !outside[3]) return null;
  const d = [0, 1, 2].map((c) => inside[c] / inside[3] - outside[c] / outside[3]);
  if (Math.hypot(d[0], d[1], d[2]) < 10) return null;
  const n = w * h;
  const guide = new Float32Array(n);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = pixels[i * 4] * d[0] + pixels[i * 4 + 1] * d[1] + pixels[i * 4 + 2] * d[2];
    guide[i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-6)) return null;
  for (let i = 0; i < n; i++) guide[i] = (guide[i] - min) / range;
  return guide;
}

/**
 * Scales a small, soft mask (opaque = kept) up to a coverage bitmap at mask resolution, with a
 * firm edge. With `refine`, the edge is first moved onto the edges of the picture itself.
 */
export async function buildCoverage(
  small: HTMLCanvasElement,
  source: RasterSource,
  width: number,
  height: number,
  refine: RefineEdges | null,
  { sharpen = 1, guide: guideKind = 'brightness', reach = 2.5 }: CoverageOptions = {},
) {
  // Refinement runs at a working size of up to ~1 megapixel, then the result is scaled to the mask.
  const k = Math.min(1, 1024 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const work = blankCanvas(w, h);
  const wctx = work.getContext('2d', { willReadFrequently: true })!;
  wctx.imageSmoothingQuality = 'high';
  wctx.drawImage(small, 0, 0, w, h);

  const coverage = wctx.getImageData(0, 0, w, h);
  const n = w * h;
  let alpha: Float32Array = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = coverage.data[i * 4 + 3] / 255;
  if (sharpen !== 1) for (let i = 0; i < n; i++) alpha[i] = Math.min(1, Math.max(0, (alpha[i] - 0.5) * sharpen + 0.5));

  if (refine) {
    const guideCanvas = blankCanvas(w, h, '#ffffff');
    const gctx = guideCanvas.getContext('2d', { willReadFrequently: true })!;
    gctx.imageSmoothingQuality = 'high';
    gctx.drawImage(source, 0, 0, w, h);
    const pixels = gctx.getImageData(0, 0, w, h).data;
    let guide = guideKind === 'contrast' ? contrastGuide(pixels, alpha, w, h) : null;
    if (!guide) {
      guide = new Float32Array(n);
      for (let i = 0; i < n; i++) guide[i] = (pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114) / 255;
    }
    // Window about as wide as the upscaling blur, so the filter can move an edge onto the photo's edge.
    const radius = Math.max(2, Math.round((Math.max(w, h) / Math.max(small.width, small.height)) * reach));
    alpha = await refine(guide, alpha, w, h, radius);
  }

  for (let i = 0; i < n; i++) {
    // Firm up the result: push near-background to fully hidden and near-subject to fully shown.
    const v = (alpha[i] - 0.12) / 0.76;
    coverage.data[i * 4] = coverage.data[i * 4 + 1] = coverage.data[i * 4 + 2] = 255;
    coverage.data[i * 4 + 3] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  wctx.putImageData(coverage, 0, 0);
  if (w === width && h === height) return work;
  const out = blankCanvas(width, height);
  const octx = out.getContext('2d')!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(work, 0, 0, width, height);
  return out;
}

/**
 * Turns the network's prediction into a coverage bitmap at mask resolution.
 * Returns null when the prediction contains no usable subject / background split.
 */
async function buildMask(prediction: Float32Array, size: number, source: RasterSource, width: number, height: number, refine: boolean) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of prediction) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-6)) return null;

  const small = blankCanvas(size, size);
  const sctx = small.getContext('2d')!;
  const image = sctx.createImageData(size, size);
  let subject = 0;
  for (let i = 0; i < prediction.length; i++) {
    const v = (prediction[i] - min) / range;
    if (v > 0.5) subject++;
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255;
    image.data[i * 4 + 3] = Math.round(v * 255);
  }
  const share = subject / prediction.length;
  if (share < 0.003 || share > 0.997) return null;
  sctx.putImageData(image, 0, 0);
  return buildCoverage(small, source, width, height, refine ? refineInWorker : null);
}

// ---------- the user-facing operation ----------

/** Lets the browser draw what has changed so far before the next piece of work starts. */
export const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

export type Report = (phase: RemovalJob['phase'], message: string, progress?: number | null) => void;

/**
 * The layer's original pixels, loaded if they were not in memory, and the size its mask has.
 * Throws with a message for the user when the picture cannot be worked on.
 */
export async function loadLayerPixels(layerId: string) {
  const layer = getImageLayer(layerId);
  if (!layer) throw new Error('Select an image layer first.');
  // Make sure the original pixels are in memory (they may not be if the layer is hidden or just loaded).
  if (layer.source.kind === 'asset') await loadAssetImage(layer.source.assetId);
  if (layer.source.kind === 'raster') await loadRaster(layer.source.rasterId);
  const source = sourceRaster(layer.source);
  const size = maskSize(layer.source);
  if (!source || !size) throw new Error('The image for this layer could not be loaded.');
  const dims = sourceSize(source);
  if (Math.min(dims.width, dims.height) < 32) throw new Error('This image is too small to analyse (it needs to be at least 32 px on each side).');
  return { layer, source, size };
}

/**
 * Finds the main subject of an image layer and returns its coverage as a source-space bitmap
 * (see maskSpace.ts). Shared by background removal (which stores it as the layer's mask) and by
 * "select subject" (which turns it into a selection). Throws with a message for the user.
 */
export async function findSubject(layerId: string, report: Report) {
  await detectModels();
  const store = useBackgroundRemoval.getState();
  const model: SegmentationModel = MODELS[store.model];
  {
    report('preparing', 'Preparing the image…');
    const { source, size } = await loadLayerPixels(layerId);

    // A plain backdrop is removed by its colour: exact, instant, and it keeps enclosed areas of that colour.
    if (store.method !== 'subject') {
      const plain = plainBackgroundMask(source, size.width, size.height, store.method === 'plain');
      if (plain) return { mask: plain.mask, model, milliseconds: 0, threads: 0, downloaded: false, plain };
      if (store.method === 'plain') {
        throw new Error('No plain background was found around the edges of this image. Set Method to “Find the subject” (AI tools tab) for a photo.');
      }
    }

    // Reading the picture is the slow part on the main thread: let the screen catch up first.
    await nextPaint();
    let input: Float32Array;
    try {
      input = prepareInput(source, model);
    } catch {
      throw new Error('This image cannot be read by the browser, so it cannot be analysed.');
    }

    let downloaded = false;
    const { prediction, milliseconds, threads } = await segment(model, input, (message) => {
      if (message.phase === 'download') {
        downloaded = true;
        const total = message.total || model.bytes;
        report('downloading', `Downloading the ${model.label.toLowerCase()} model (${megabytes(message.loaded)} of ${megabytes(total)})…`, Math.min(1, message.loaded / total));
      } else if (message.phase === 'initialise') {
        report('initialising', 'Starting the model…');
      } else {
        report('running', 'Finding the subject…');
      }
    });

    report('refining', 'Refining the edges…');
    await nextPaint();
    const refine = useBackgroundRemoval.getState().refineEdges;
    const mask = await buildMask(prediction, model.inputSize, source, size.width, size.height, refine);
    if (!mask) throw new Error('No clear subject was found, so there is no background to remove. Try the brush on a mask instead.');

    // The layer may have been deleted or changed while the model was running.
    if (!getImageLayer(layerId)) throw new Error('The layer was removed before the result was ready.');
    return { mask, model, milliseconds, threads, downloaded, plain: null };
  }
}
