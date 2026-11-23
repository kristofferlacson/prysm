import { useLocalTools } from '../inpaint/contentAwareFill';
import { getImageLayer } from '../masks/maskActions';
import { getAssetImage, imageSize, importImageBlob, loadAssetImage } from '../../services/assets';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { ImageLayer } from '../../types/document';
import type { UpscaleRequest, UpscaleResponse } from './upscale.worker';

/**
 * Upscaling with a super-resolution network that runs in this browser: no service, no account,
 * and the image is not uploaded. The layer is given a larger, sharper copy of its picture; its
 * place on the canvas, its crop, mask and adjustments stay as they are, the original stays in
 * Uploads, and the step can be undone.
 */

export const UPSCALE_MODEL = {
  label: 'Real-ESRGAN general x4 v3',
  url: '/models/realesr-general-x4v3.onnx',
  bytes: 4_866_420,
  license: 'BSD-3-Clause (Xintao Wang, 2021); licence text in /models/LICENSE-Real-ESRGAN.txt',
  source: 'github.com/xinntao/Real-ESRGAN, official weights exported to ONNX unchanged',
};

/** Images are never rendered above this size (see the image pipeline), so there is no point going past it. */
export const UPSCALE_MAX_SIDE = 4096;
export type UpscaleFactor = 2 | 4;

/** Seconds per input pixel on a typical laptop, one thread. Replaced by a measurement after the first run. */
let secondsPerPixel = 1.3e-4;

let installed: Promise<boolean> | null = null;
/** Whether this server has the model file (it is downloaded by "npm run setup:ai"). */
export function upscalerInstalled(): Promise<boolean> {
  installed ??= (async () => {
    try {
      const response = await fetch(UPSCALE_MODEL.url, { method: 'HEAD' });
      return response.ok && !(response.headers.get('content-type') ?? '').includes('text/html');
    } catch {
      return false;
    }
  })();
  return installed;
}

export interface UpscaleOption {
  factor: UpscaleFactor;
  width: number;
  height: number;
  /** Rough time on this computer, in seconds. */
  seconds: number;
}

/** What this layer can be upscaled to, or why it cannot. */
export function upscaleOptions(layer: ImageLayer): { options: UpscaleOption[]; size: { width: number; height: number } | null; reason: string | null } {
  if (layer.source.kind !== 'asset') return { options: [], size: null, reason: 'Upscaling works on photos and other uploaded images, not on paint layers or generated textures.' };
  const image = getAssetImage(layer.source.assetId);
  if (!image) return { options: [], size: null, reason: 'The image is still loading.' };
  const size = imageSize(image);
  const longer = Math.max(size.width, size.height);
  const options = ([2, 4] as UpscaleFactor[])
    .filter((factor) => longer * factor <= UPSCALE_MAX_SIDE)
    .map((factor) => ({ factor, width: size.width * factor, height: size.height * factor, seconds: size.width * size.height * secondsPerPixel }));
  const reason = options.length ? null : `This image is already ${size.width} × ${size.height} px. The editor never draws an image larger than ${UPSCALE_MAX_SIDE} px, so there is nothing to gain.`;
  return { options, size, reason };
}

let worker: Worker | null = null;
let active: { id: number; resolve: (r: Extract<UpscaleResponse, { type: 'result' }>) => void; reject: (e: Error) => void; onProgress: (m: Extract<UpscaleResponse, { type: 'progress' }>) => void } | null = null;
let nextId = 1;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./upscale.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<UpscaleResponse>) => {
    const message = event.data;
    if (!active || message.id !== active.id) return;
    if (message.type === 'progress') active.onProgress(message);
    else {
      const job = active;
      active = null;
      if (message.type === 'error') job.reject(new Error(message.message));
      else job.resolve(message);
    }
  };
  worker.onerror = (event) => {
    active?.reject(new Error(event.message || 'The upscaling engine could not start in this browser.'));
    active = null;
    worker?.terminate();
    worker = null;
  };
  return worker;
}

class Cancelled extends Error {}

/** Stops an upscale in progress. The layer is left as it was. */
export function cancelUpscale() {
  if (!active) return;
  // The network cannot be interrupted mid-tile, so the worker is discarded; the next run starts a new one.
  worker?.terminate();
  worker = null;
  active.reject(new Cancelled('Upscaling was cancelled. Nothing was changed.'));
  active = null;
}

const duration = (seconds: number) => (seconds < 90 ? `${Math.max(1, Math.round(seconds))} s` : `${Math.round(seconds / 60)} min`);
export const describeDuration = duration;

export async function upscaleLayer(layerId: string, factor: UpscaleFactor): Promise<boolean> {
  if (useLocalTools.getState().job) return false;
  const notify = (text: string) => useUiStore.getState().notify(text);
  const layer = getImageLayer(layerId);
  if (!layer || layer.source.kind !== 'asset') return false;
  if (layer.locked) {
    notify(`“${layer.name}” is locked.`);
    return false;
  }
  const report = (message: string, progress: number | null = null) => useLocalTools.getState().set({ job: { layerId, kind: 'upscale', message, progress } });
  report('Preparing the image…');
  try {
    const image = await loadAssetImage(layer.source.assetId);
    if (!image) throw new Error('The image for this layer could not be loaded.');
    const { width, height } = imageSize(image);
    if (Math.max(width, height) * factor > UPSCALE_MAX_SIDE) throw new Error('This image is too large for that factor.');
    if (!(await upscalerInstalled())) throw new Error('The upscaling model is not installed on this server. Run "npm run setup:ai".');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0, width, height);
    const input = ctx.getImageData(0, 0, width, height);
    let transparent = false;
    for (let i = 3; i < input.data.length; i += 4) {
      if (input.data[i] < 255) {
        transparent = true;
        break;
      }
    }

    const id = nextId++;
    const started = performance.now();
    const request: UpscaleRequest = { id, modelUrl: UPSCALE_MODEL.url, width, height, rgba: input.data, reduce: factor === 4 ? 1 : 2 };
    const result = await new Promise<Extract<UpscaleResponse, { type: 'result' }>>((resolve, reject) => {
      active = {
        id,
        resolve,
        reject,
        onProgress: (m) => {
          if (m.phase === 'download') report('Downloading the upscaling model (5 MB, once)…');
          else if (m.phase === 'initialise') report('Starting the model…');
          else {
            const fraction = m.done / m.total;
            const elapsed = (performance.now() - started) / 1000;
            const left = m.done ? (elapsed / m.done) * (m.total - m.done) : width * height * secondsPerPixel;
            report(`Upscaling… ${Math.round(fraction * 100)}% (about ${duration(left)} left)`, fraction);
          }
        },
      };
      getWorker().postMessage(request, [request.rgba.buffer]);
    });
    secondsPerPixel = result.milliseconds / 1000 / (width * height);

    report('Saving the larger image…', 1);
    const big = document.createElement('canvas');
    big.width = result.width;
    big.height = result.height;
    const bctx = big.getContext('2d', { willReadFrequently: true })!;
    const pixels = new ImageData(result.rgba as Uint8ClampedArray<ArrayBuffer>, result.width, result.height);
    if (transparent) {
      // The network only knows colour. Transparency is enlarged the ordinary way and put back.
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(image, 0, 0, result.width, result.height);
      const alpha = bctx.getImageData(0, 0, result.width, result.height).data;
      for (let i = 3; i < alpha.length; i += 4) pixels.data[i] = alpha[i];
    }
    bctx.putImageData(pixels, 0, 0);
    // WebP keeps a 16-megapixel result to a few MB; browsers that cannot write it fall back to PNG.
    const blob = await new Promise<Blob | null>((resolve) => big.toBlob(resolve, 'image/webp', 0.95));
    if (!blob) throw new Error('The larger image could not be created.');
    const asset = await importImageBlob(blob, `${layer.name} (${factor}× upscaled)`, blob.type || 'image/png');

    const current = getImageLayer(layerId);
    if (!current || current.source !== layer.source) throw new Error('The layer changed while it was being upscaled. The larger image is in Uploads.');
    useEditorStore.getState().updateLayers([layerId], { source: { kind: 'asset', assetId: asset.id } });
    useLocalTools.getState().set({ lastRun: { kind: 'upscale', milliseconds: result.milliseconds, width: result.width, height: result.height } });
    notify(`Upscaled to ${result.width} × ${result.height} px in ${duration(result.milliseconds / 1000)}. The original is still in Uploads.`);
    return true;
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The image could not be upscaled.');
    return false;
  } finally {
    useLocalTools.getState().set({ job: null });
  }
}
