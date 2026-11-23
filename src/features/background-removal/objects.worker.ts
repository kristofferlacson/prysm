import { OBJECT_MODEL } from './models';
import { createSession, download, ort } from './ortRuntime';
import { guidedFilter } from './refine';

/**
 * Finds the object under a point, off the main thread.
 *
 * This is a "segment anything" network in two parts. The encoder looks at the whole picture once
 * (slow: several seconds) and produces a description of it. The decoder then answers "which object
 * is at this point?" from that description in a fraction of a second, as often as it is asked. So
 * a picture is analysed once when the dialog opens, and every click after that is quick.
 */

/** The network's square input, and the size of the masks it answers with. */
const OBJECT_INPUT = OBJECT_MODEL.inputSize;
const MASK_SIDE = 256;

export interface EncodeRequest {
  kind: 'encode';
  id: number;
  /** Identifies the picture, so that asking again for the same one costs nothing. */
  key: string;
  encoderUrl: string;
  decoderUrl: string;
  /** Size of both files together, for the progress bar. */
  totalBytes: number;
  /** Normalised picture, channel-first (1 x 3 x 1024 x 1024), in the top-left corner, zero elsewhere. */
  input: Float32Array;
  /** The part of the square the picture occupies. */
  validWidth: number;
  validHeight: number;
}

export interface DecodeRequest {
  kind: 'decode';
  id: number;
  key: string;
  /** The point, in pixels of the network's input square. */
  x: number;
  y: number;
}

export interface ObjectRefineRequest {
  kind: 'refine';
  id: number;
  guide: Float32Array;
  mask: Float32Array;
  width: number;
  height: number;
  radius: number;
  eps: number;
}

export type ObjectsRequest = EncodeRequest | DecodeRequest | ObjectRefineRequest;

export type ObjectsResponse =
  | { id: number; type: 'progress'; phase: 'download'; loaded: number; total: number }
  | { id: number; type: 'progress'; phase: 'initialise' | 'run' }
  | { id: number; type: 'encoded'; milliseconds: number }
  /** Three candidate masks for the point (a part, the object, a larger whole), as logits: above 0 is inside. */
  | { id: number; type: 'decoded'; masks: Float32Array; width: number; height: number; scores: number[]; milliseconds: number }
  | { id: number; type: 'refined'; mask: Float32Array }
  | { id: number; type: 'error'; message: string };

const scope = self as unknown as {
  postMessage(message: ObjectsResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ObjectsRequest>) => void) | null;
};

interface Models {
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
}

interface Picture {
  embeddings: ort.Tensor;
  positions: ort.Tensor;
  validWidth: number;
  validHeight: number;
}

let models: Promise<Models> | null = null;
/** The pictures analysed most recently (each is about 8 MB), so reopening one is instant. */
const pictures = new Map<string, Picture>();
const KEPT_PICTURES = 3;

function loadModels(request: EncodeRequest) {
  if (!models) {
    const { id, encoderUrl, decoderUrl, totalBytes } = request;
    const loaded = [0, 0];
    const report = (index: number) => (bytes: number) => {
      loaded[index] = bytes;
      const sum = loaded[0] + loaded[1];
      scope.postMessage({ id, type: 'progress', phase: 'download', loaded: sum, total: Math.max(totalBytes, sum) });
    };
    models = (async () => {
      const [encoderBytes, decoderBytes] = await Promise.all([download(encoderUrl, report(0)), download(decoderUrl, report(1))]);
      scope.postMessage({ id, type: 'progress', phase: 'initialise' });
      return { encoder: await createSession(encoderBytes), decoder: await createSession(decoderBytes) };
    })();
    // A failed load must not poison later attempts.
    models.catch(() => (models = null));
  }
  return models;
}

async function encode(request: EncodeRequest) {
  const { id, key } = request;
  const known = pictures.get(key);
  if (known) {
    // Move it to the end: it is the most recently used again.
    pictures.delete(key);
    pictures.set(key, known);
    scope.postMessage({ id, type: 'encoded', milliseconds: 0 });
    return;
  }
  const { encoder } = await loadModels(request);
  scope.postMessage({ id, type: 'progress', phase: 'run' });
  const started = performance.now();
  const input = new ort.Tensor('float32', request.input, [1, 3, OBJECT_INPUT, OBJECT_INPUT]);
  const output = await encoder.run({ [encoder.inputNames[0]]: input });
  pictures.set(key, {
    embeddings: output.image_embeddings,
    positions: output.image_positional_embeddings,
    validWidth: request.validWidth,
    validHeight: request.validHeight,
  });
  while (pictures.size > KEPT_PICTURES) pictures.delete(pictures.keys().next().value!);
  scope.postMessage({ id, type: 'encoded', milliseconds: performance.now() - started });
}

async function decode(request: DecodeRequest) {
  const { id, key, x, y } = request;
  const picture = pictures.get(key);
  if (!picture || !models) throw new Error('This picture has not been analysed yet.');
  const { decoder } = await models;
  const started = performance.now();
  const output = await decoder.run({
    input_points: new ort.Tensor('float32', new Float32Array([x, y]), [1, 1, 1, 2]),
    // 1 marks a point that is inside the object.
    input_labels: new ort.Tensor('int64', new BigInt64Array([1n]), [1, 1, 1]),
    image_embeddings: picture.embeddings,
    image_positional_embeddings: picture.positions,
  });
  const all = output.pred_masks.data as Float32Array;
  const count = output.pred_masks.dims[2];
  // The masks cover the whole input square; only the part the picture occupies is of interest.
  const width = Math.max(1, Math.min(MASK_SIDE, Math.round((MASK_SIDE * picture.validWidth) / OBJECT_INPUT)));
  const height = Math.max(1, Math.min(MASK_SIDE, Math.round((MASK_SIDE * picture.validHeight) / OBJECT_INPUT)));
  const masks = new Float32Array(count * width * height);
  for (let m = 0; m < count; m++) {
    for (let row = 0; row < height; row++) {
      const from = m * MASK_SIDE * MASK_SIDE + row * MASK_SIDE;
      masks.set(all.subarray(from, from + width), m * width * height + row * width);
    }
  }
  const scores = Array.from(output.iou_scores.data as Float32Array);
  scope.postMessage({ id, type: 'decoded', masks, width, height, scores, milliseconds: performance.now() - started }, [masks.buffer]);
}

async function handle(request: ObjectsRequest) {
  try {
    if (request.kind === 'encode') await encode(request);
    else if (request.kind === 'decode') await decode(request);
    else {
      const mask = guidedFilter(request.guide, request.mask, request.width, request.height, request.radius, request.eps);
      scope.postMessage({ id: request.id, type: 'refined', mask }, [mask.buffer]);
    }
  } catch (err) {
    scope.postMessage({ id: request.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

// One request at a time, in the order they arrive.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event) => {
  queue = queue.then(() => handle(event.data));
};
