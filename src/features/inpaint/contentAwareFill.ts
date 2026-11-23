import { create } from 'zustand';
import type { FillRequest, FillResponse } from './inpaint.worker';

/**
 * Client side of the content-aware fill worker, plus the state the interface shows while it runs.
 * Everything happens in this browser: no image is uploaded and no service is called.
 */

export interface FillJob {
  /** The layer being worked on, when the job belongs to one. */
  layerId: string | null;
  kind: 'fill' | 'expand' | 'upscale';
  message: string;
  progress: number | null;
}

interface LocalToolsState {
  job: FillJob | null;
  /** How long the last run took, for the interface and the tests. */
  lastRun: { kind: FillJob['kind']; milliseconds: number; width: number; height: number } | null;
  set: (patch: Partial<Pick<LocalToolsState, 'job' | 'lastRun'>>) => void;
}

export const useLocalTools = create<LocalToolsState>()((set) => ({
  job: null,
  lastRun: null,
  set: (patch) => set(patch),
}));

interface Pending {
  resolve: (result: { rgba: Uint8ClampedArray; milliseconds: number }) => void;
  reject: (error: Error) => void;
  onProgress: (fraction: number) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./inpaint.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<FillResponse>) => {
    const message = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    if (message.type === 'progress') {
      entry.onProgress(message.fraction);
      return;
    }
    pending.delete(message.id);
    if (message.type === 'error') entry.reject(new Error(message.message));
    else entry.resolve({ rgba: message.rgba, milliseconds: message.milliseconds });
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The fill engine could not start in this browser.');
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/**
 * Fills the pixels of `image` marked in `hole` (non-zero = missing) from the rest of the image.
 * Resolves to a new ImageData; pixels outside the hole are unchanged.
 */
export async function contentAwareFill(image: ImageData, hole: Uint8Array, onProgress: (fraction: number) => void = () => {}) {
  const id = nextId++;
  const request: FillRequest = { id, width: image.width, height: image.height, rgba: new Uint8ClampedArray(image.data), hole };
  const { rgba, milliseconds } = await new Promise<{ rgba: Uint8ClampedArray; milliseconds: number }>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage(request, [request.rgba.buffer, request.hole.buffer]);
  });
  return { image: new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, image.width, image.height), milliseconds };
}
