import { fillHoles } from './patchMatch';

/** Runs content-aware fill off the main thread, so the editor stays responsive while it works. */

export interface FillRequest {
  id: number;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  hole: Uint8Array;
}

export type FillResponse =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'result'; rgba: Uint8ClampedArray; milliseconds: number }
  | { id: number; type: 'error'; message: string };

const post = (message: FillResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<FillRequest>) => {
  const { id, width, height, rgba, hole } = event.data;
  const started = performance.now();
  let last = 0;
  try {
    const out = fillHoles(width, height, rgba, hole, (fraction) => {
      // A few updates a second are plenty for a progress bar.
      const now = performance.now();
      if (now - last < 120 && fraction < 1) return;
      last = now;
      post({ id, type: 'progress', fraction });
    });
    post({ id, type: 'result', rgba: out, milliseconds: performance.now() - started }, [out.buffer]);
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : 'The fill failed.' });
  }
};
