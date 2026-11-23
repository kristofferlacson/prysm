import { createSession, download, ort, threads } from './ortRuntime';
import { guidedFilter } from './refine';

/**
 * Runs a salient-object segmentation network with ONNX Runtime (WebAssembly) off the main thread,
 * so the editor stays responsive while a model downloads and runs.
 */

export interface SegmentRequest {
  kind: 'segment';
  id: number;
  modelUrl: string;
  inputSize: number;
  /** Normalised image, channel-first (1 x 3 x size x size). */
  input: Float32Array;
}

/** Edge refinement (guided filter) is pure number crunching, so it runs here too. */
export interface RefineRequest {
  kind: 'refine';
  id: number;
  guide: Float32Array;
  mask: Float32Array;
  width: number;
  height: number;
  radius: number;
  eps: number;
}

export type WorkerRequest = SegmentRequest | RefineRequest;

export type SegmentResponse =
  | { id: number; type: 'progress'; phase: 'download'; loaded: number; total: number }
  | { id: number; type: 'progress'; phase: 'initialise' | 'run' }
  | { id: number; type: 'result'; prediction: Float32Array; milliseconds: number; threads: number }
  | { id: number; type: 'refined'; mask: Float32Array }
  | { id: number; type: 'error'; message: string };

const scope = self as unknown as {
  postMessage(message: SegmentResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const sessions = new Map<string, Promise<ort.InferenceSession>>();

function session(url: string, id: number) {
  let pending = sessions.get(url);
  if (!pending) {
    pending = (async () => {
      const bytes = await download(url, (loaded, total) => scope.postMessage({ id, type: 'progress', phase: 'download', loaded, total }));
      scope.postMessage({ id, type: 'progress', phase: 'initialise' });
      return createSession(bytes);
    })();
    sessions.set(url, pending);
    // A failed load must not poison later attempts.
    pending.catch(() => sessions.delete(url));
  }
  return pending;
}

scope.onmessage = async (event) => {
  const request = event.data;
  const { id } = request;
  if (request.kind === 'refine') {
    try {
      const mask = guidedFilter(request.guide, request.mask, request.width, request.height, request.radius, request.eps);
      scope.postMessage({ id, type: 'refined', mask }, [mask.buffer]);
    } catch (err) {
      scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  const { modelUrl, inputSize, input } = request;
  try {
    const model = await session(modelUrl, id);
    scope.postMessage({ id, type: 'progress', phase: 'run' });
    const started = performance.now();
    const tensor = new ort.Tensor('float32', input, [1, 3, inputSize, inputSize]);
    const outputs = await model.run({ [model.inputNames[0]]: tensor });
    // These networks return several side outputs; the first is the fused, full-resolution prediction.
    const data = outputs[model.outputNames[0]].data as Float32Array;
    const prediction = new Float32Array(data);
    scope.postMessage(
      { id, type: 'result', prediction, milliseconds: performance.now() - started, threads },
      [prediction.buffer],
    );
  } catch (err) {
    scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
