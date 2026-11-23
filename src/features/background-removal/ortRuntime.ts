/// <reference types="vite/client" />
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

/**
 * ONNX Runtime (WebAssembly) as the workers in this folder use it: where its WebAssembly file is,
 * how many threads it may use, and how a model file is fetched with progress.
 */

// Threads need SharedArrayBuffer, which browsers only allow on cross-origin-isolated pages.
const isolated = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated;
export const threads = isolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1;
ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = threads;
ort.env.wasm.proxy = false;

export { ort };

/** Fetches a model file, reporting how much has arrived a few times a second. */
export async function download(url: string, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const response = await fetch(url);
  const type = response.headers.get('content-type') ?? '';
  // A dev server answers unknown paths with the app's HTML page, so check the type as well as the status.
  if (!response.ok || type.includes('text/html')) {
    throw new Error(`The model file ${url} was not found. Run "npm run setup:ai" to download it.`);
  }
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress(bytes.length, bytes.length);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    // A fast connection delivers hundreds of chunks a second; a few updates a second is plenty.
    const now = performance.now();
    if (now - reported > 120) {
      reported = now;
      onProgress(loaded, total);
    }
  }
  onProgress(loaded, total || loaded);
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function createSession(bytes: Uint8Array) {
  return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}
