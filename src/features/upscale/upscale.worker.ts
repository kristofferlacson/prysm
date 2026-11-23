/// <reference types="vite/client" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

/**
 * Runs the super-resolution network (Real-ESRGAN, compact "general x4 v3") with ONNX Runtime
 * (WebAssembly) off the main thread. The picture is processed in tiles so memory stays small and
 * progress can be reported; each tile is given some of its neighbours' pixels so no seams show.
 */

export interface UpscaleRequest {
  id: number;
  modelUrl: string;
  width: number;
  height: number;
  /** Straight RGBA. Alpha is ignored here; the caller scales it separately. */
  rgba: Uint8ClampedArray;
  /** 1 keeps the network's 4x output; 2 averages it down to 2x. */
  reduce: 1 | 2;
}

export type UpscaleResponse =
  | { id: number; type: 'progress'; phase: 'download'; loaded: number; total: number }
  | { id: number; type: 'progress'; phase: 'initialise' }
  | { id: number; type: 'progress'; phase: 'run'; done: number; total: number }
  | { id: number; type: 'result'; rgba: Uint8ClampedArray; width: number; height: number; milliseconds: number }
  | { id: number; type: 'error'; message: string };

const scope = self as unknown as {
  postMessage(message: UpscaleResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<UpscaleRequest>) => void) | null;
  crossOriginIsolated?: boolean;
};

const SCALE = 4;
/** Tile size and the border of neighbouring pixels each tile is given, in input pixels. */
const TILE = 128;
const BORDER = 16;

ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
ort.env.wasm.proxy = false;

let loaded: { url: string; session: Promise<ort.InferenceSession> } | null = null;

async function download(url: string, id: number) {
  const response = await fetch(url);
  const type = response.headers.get('content-type') ?? '';
  // A dev server answers unknown paths with the app's HTML page, so check the type as well as the status.
  if (!response.ok || type.includes('text/html')) throw new Error('The upscaling model is not installed. Run "npm run setup:ai" to download it.');
  const total = Number(response.headers.get('content-length')) || 0;
  const bytes = new Uint8Array(await response.arrayBuffer());
  scope.postMessage({ id, type: 'progress', phase: 'download', loaded: bytes.length, total: total || bytes.length });
  return bytes;
}

function session(url: string, id: number) {
  if (loaded?.url === url) return loaded.session;
  const pending = (async () => {
    const bytes = await download(url, id);
    scope.postMessage({ id, type: 'progress', phase: 'initialise' });
    return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  })();
  loaded = { url, session: pending };
  pending.catch(() => {
    loaded = null;
  });
  return pending;
}

scope.onmessage = async (event) => {
  const { id, modelUrl, width, height, rgba, reduce } = event.data;
  try {
    const model = await session(modelUrl, id);
    const started = performance.now();
    const factor = SCALE / reduce;
    const outW = width * factor;
    const outH = height * factor;
    const out = new Uint8ClampedArray(outW * outH * 4);
    const columns = Math.ceil(width / TILE);
    const rows = Math.ceil(height / TILE);
    const total = columns * rows;
    let done = 0;
    scope.postMessage({ id, type: 'progress', phase: 'run', done, total });

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        // The tile itself, and the larger piece of the picture the network sees around it.
        const x0 = column * TILE;
        const y0 = row * TILE;
        const x1 = Math.min(width, x0 + TILE);
        const y1 = Math.min(height, y0 + TILE);
        const px0 = Math.max(0, x0 - BORDER);
        const py0 = Math.max(0, y0 - BORDER);
        const px1 = Math.min(width, x1 + BORDER);
        const py1 = Math.min(height, y1 + BORDER);
        const pw = px1 - px0;
        const ph = py1 - py0;
        const area = pw * ph;
        const input = new Float32Array(3 * area);
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const s = ((py0 + y) * width + px0 + x) * 4;
            const d = y * pw + x;
            input[d] = rgba[s] / 255;
            input[area + d] = rgba[s + 1] / 255;
            input[2 * area + d] = rgba[s + 2] / 255;
          }
        }
        const result = await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, ph, pw]) });
        const data = result[model.outputNames[0]].data as Float32Array;
        const bigW = pw * SCALE;
        const bigArea = bigW * ph * SCALE;

        // Copy the tile's own part of the answer (averaging 2 x 2 when the target is 2x).
        const tw = (x1 - x0) * factor;
        const th = (y1 - y0) * factor;
        const ox = (x0 - px0) * SCALE;
        const oy = (y0 - py0) * SCALE;
        for (let y = 0; y < th; y++) {
          for (let x = 0; x < tw; x++) {
            const d = ((y0 * factor + y) * outW + x0 * factor + x) * 4;
            for (let c = 0; c < 3; c++) {
              const plane = c * bigArea;
              let v: number;
              if (reduce === 1) v = data[plane + (oy + y) * bigW + ox + x];
              else {
                const i = plane + (oy + y * 2) * bigW + ox + x * 2;
                v = (data[i] + data[i + 1] + data[i + bigW] + data[i + bigW + 1]) / 4;
              }
              // The network's output can stray slightly outside 0..1; the clamped array takes care of it.
              out[d + c] = v * 255;
            }
            out[d + 3] = 255;
          }
        }
        done++;
        scope.postMessage({ id, type: 'progress', phase: 'run', done, total });
      }
    }
    scope.postMessage({ id, type: 'result', rgba: out, width: outW, height: outH, milliseconds: performance.now() - started }, [out.buffer]);
  } catch (err) {
    scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
