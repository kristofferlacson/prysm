import { sourceSize, type RasterSource } from '../image-editing/pipeline';
import { blankCanvas } from '../masks/maskActions';
import { OBJECT_MODEL } from './models';
import type { DecodeRequest, EncodeRequest, ObjectRefineRequest, ObjectsRequest, ObjectsResponse } from './objects.worker';
import type { RefineEdges } from './removeBackground';

/**
 * "Click an object": the main-thread side of objects.worker.ts.
 *
 * A picture is prepared once (prepareObjects), after which objectAt answers, for any point, with
 * the object found there. Nothing is uploaded: the model runs in this browser.
 */

let availability: Promise<boolean> | null = null;

/** Whether the object model's two files are on this server. Checked once. */
export function detectObjectModel(): Promise<boolean> {
  availability ??= (async () => {
    for (const url of [OBJECT_MODEL.encoderUrl, OBJECT_MODEL.decoderUrl]) {
      try {
        const response = await fetch(url, { method: 'HEAD' });
        // Dev servers answer unknown paths with the app's HTML, so the type matters too.
        if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return false;
      } catch {
        return false;
      }
    }
    return true;
  })();
  return availability;
}

// ---------- worker plumbing ----------

type Progress = Extract<ObjectsResponse, { type: 'progress' }>;
type Result = Exclude<ObjectsResponse, { type: 'progress' | 'error' }>;

interface Pending {
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
  onProgress: (message: Progress) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** Pictures the worker has analysed, in the order it will forget them (it keeps the last three). */
let prepared: string[] = [];

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./objects.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<ObjectsResponse>) => {
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
    const error = new Error(event.message || 'The object finder could not start in this browser.');
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    prepared = [];
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function send(request: ObjectsRequest, transfer: Transferable[], onProgress: Pending['onProgress'] = () => {}) {
  return new Promise<Result>((resolve, reject) => {
    pending.set(request.id, { resolve, reject, onProgress });
    getWorker().postMessage(request, transfer);
  });
}

// ---------- the operations ----------

/** The picture inside the network's square input: scaled to fit, top-left, the rest left at zero. */
function prepareInput(source: RasterSource) {
  const side = OBJECT_MODEL.inputSize;
  const { width, height } = sourceSize(source);
  const k = side / Math.max(width, height);
  const validWidth = Math.max(1, Math.min(side, Math.round(width * k)));
  const validHeight = Math.max(1, Math.min(side, Math.round(height * k)));
  // Transparent parts are shown to the network as white.
  const canvas = blankCanvas(validWidth, validHeight, '#ffffff');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, validWidth, validHeight);
  const { data } = ctx.getImageData(0, 0, validWidth, validHeight);
  const area = side * side;
  const input = new Float32Array(3 * area);
  for (let y = 0; y < validHeight; y++) {
    for (let x = 0; x < validWidth; x++) {
      const from = (y * validWidth + x) * 4;
      const to = y * side + x;
      for (let c = 0; c < 3; c++) input[c * area + to] = (data[from + c] / 255 - OBJECT_MODEL.mean[c]) / OBJECT_MODEL.std[c];
    }
  }
  return { input, validWidth, validHeight };
}

export type ObjectsProgress = (phase: 'downloading' | 'initialising' | 'running', loaded?: number, total?: number) => void;

const sizes = new Map<string, { validWidth: number; validHeight: number }>();

/**
 * Analyses a picture so that objectAt can be asked about it. `key` identifies the picture: asking
 * again for one of the last few costs nothing. The first call also downloads the model.
 */
export async function prepareObjects(key: string, source: RasterSource, onProgress: ObjectsProgress) {
  let prep: ReturnType<typeof prepareInput>;
  try {
    prep = prepareInput(source);
  } catch {
    throw new Error('This image cannot be read by the browser, so its objects cannot be found.');
  }
  const request: EncodeRequest = {
    kind: 'encode',
    id: nextId++,
    key,
    encoderUrl: OBJECT_MODEL.encoderUrl,
    decoderUrl: OBJECT_MODEL.decoderUrl,
    totalBytes: OBJECT_MODEL.encoderBytes + OBJECT_MODEL.decoderBytes,
    input: prep.input,
    validWidth: prep.validWidth,
    validHeight: prep.validHeight,
  };
  const result = await send(request, [prep.input.buffer], (message) => {
    if (message.phase === 'download') onProgress('downloading', message.loaded, message.total);
    else onProgress(message.phase === 'initialise' ? 'initialising' : 'running');
  });
  if (result.type !== 'encoded') throw new Error('Unexpected reply from the object finder.');
  sizes.set(key, { validWidth: prep.validWidth, validHeight: prep.validHeight });
  prepared = [...prepared.filter((k) => k !== key), key].slice(-3);
  for (const known of [...sizes.keys()]) if (!prepared.includes(known)) sizes.delete(known);
  return { milliseconds: result.milliseconds };
}

/** One candidate for "the object at this point". */
export interface ObjectCandidate {
  /** Row by row; above 0 is inside the object. */
  logits: Float32Array;
  /** Share of the picture it covers, 0..1. */
  area: number;
  /** The network's own estimate of how good this mask is. */
  score: number;
}

export interface ObjectHit {
  width: number;
  height: number;
  /** From the smallest to the largest: typically a part, the object, and a larger whole. */
  candidates: ObjectCandidate[];
  milliseconds: number;
}

/** The object at a point of a prepared picture. `fx`, `fy` are fractions of its width and height. */
export async function objectAt(key: string, fx: number, fy: number): Promise<ObjectHit> {
  const size = sizes.get(key);
  if (!size) throw new Error('This picture has not been analysed yet.');
  const request: DecodeRequest = { kind: 'decode', id: nextId++, key, x: fx * size.validWidth, y: fy * size.validHeight };
  const result = await send(request, []);
  if (result.type !== 'decoded') throw new Error('Unexpected reply from the object finder.');
  const { width, height, masks, scores } = result;
  const n = width * height;
  const candidates: ObjectCandidate[] = scores.map((score, i) => {
    const logits = masks.subarray(i * n, (i + 1) * n);
    let inside = 0;
    for (let p = 0; p < n; p++) if (logits[p] > 0) inside++;
    return { logits, area: inside / n, score };
  });
  candidates.sort((a, b) => a.area - b.area);
  return { width, height, candidates, milliseconds: result.milliseconds };
}

/** Edge refinement in the object worker, so it never waits behind the subject-finding model. */
export const refineWithObjects: RefineEdges = async (guide, mask, width, height, radius) => {
  const request: ObjectRefineRequest = { kind: 'refine', id: nextId++, guide, mask, width, height, radius, eps: 2e-4 };
  const result = await send(request, [guide.buffer, mask.buffer]);
  if (result.type !== 'refined') throw new Error('Unexpected reply from the object finder.');
  return result.mask;
};
