import type { Adjustments, CropInsets, EffectInstance } from '../../types/document';
import { blurCanvas, EFFECT_MAP, makeCanvas } from '../effects/effects';
import { applyAdjustments, isNeutral } from './adjustments';

export type RasterSource = HTMLImageElement | HTMLCanvasElement;

export const PREVIEW_MAX_DIM = 1600;
export const FULL_MAX_DIM = 4096;

export function sourceSize(src: RasterSource) {
  if (src instanceof HTMLImageElement) {
    return { width: src.naturalWidth || src.width || 512, height: src.naturalHeight || src.height || 512 };
  }
  return { width: src.width, height: src.height };
}

/**
 * Non-destructive render of an image layer: crop -> colour adjustments -> effects.
 * The source is never modified; the result is a new canvas (or the source itself when nothing applies).
 */
export function renderImage(
  src: RasterSource,
  crop: CropInsets,
  adjustments: Adjustments,
  effects: EffectInstance[],
  maxDim: number,
  seed: number,
): RasterSource {
  const { width: sw, height: sh } = sourceSize(src);
  const cropped = crop.left > 0 || crop.top > 0 || crop.right > 0 || crop.bottom > 0;
  const neutral = isNeutral(adjustments);
  const active = effects.filter((e) => e.amount > 0 && EFFECT_MAP.has(e.type));
  if (!cropped && neutral && !active.length && Math.max(sw, sh) <= maxDim) return src;

  const cx = crop.left * sw;
  const cy = crop.top * sh;
  const cw = Math.max(1, sw * (1 - crop.left - crop.right));
  const ch = Math.max(1, sh * (1 - crop.top - crop.bottom));
  const scale = Math.min(1, maxDim / Math.max(cw, ch));
  const canvas = makeCanvas(cw * scale, ch * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);

  if (!neutral) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyAdjustments(img.data, adjustments);
    ctx.putImageData(img, 0, 0);
  }
  for (const fx of active) EFFECT_MAP.get(fx.type)!.apply(canvas, ctx, fx.amount, seed);
  return canvas;
}

export interface MaskInput {
  /** Coverage bitmap spanning the whole uncropped source (alpha = how much of the layer shows). */
  canvas: HTMLCanvasElement;
  /** Edge softness as a fraction of the longer output side. */
  feather: number;
}

let filterSupport: boolean | null = null;
function supportsCanvasFilter() {
  if (filterSupport === null) {
    const ctx = document.createElement('canvas').getContext('2d');
    filterSupport = !!ctx && typeof ctx.filter === 'string';
  }
  return filterSupport;
}

/** The visible (cropped) part of a mask scaled to w x h, with its edge softened. */
function featheredMask(mask: MaskInput, crop: CropInsets, w: number, h: number) {
  const { canvas } = mask;
  const sx = crop.left * canvas.width;
  const sy = crop.top * canvas.height;
  const sw = Math.max(1, canvas.width * (1 - crop.left - crop.right));
  const sh = Math.max(1, canvas.height * (1 - crop.top - crop.bottom));
  const radius = mask.feather * Math.max(w, h);
  const pad = Math.ceil(radius * 2);
  // Pad with a stretched copy so the blur has something to sample beyond the border;
  // otherwise softening would also fade the outer edge of the layer.
  const padded = makeCanvas(w + pad * 2, h + pad * 2);
  const pctx = padded.getContext('2d')!;
  pctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, padded.width, padded.height);
  pctx.clearRect(pad, pad, w, h);
  pctx.drawImage(canvas, sx, sy, sw, sh, pad, pad, w, h);
  if (supportsCanvasFilter()) {
    const blurred = makeCanvas(padded.width, padded.height);
    const bctx = blurred.getContext('2d')!;
    bctx.filter = `blur(${radius}px)`;
    bctx.drawImage(padded, 0, 0);
    return { canvas: blurred, pad };
  }
  blurCanvas(padded, pctx, radius * 2);
  return { canvas: padded, pad };
}

/**
 * Applies layer masks to an already processed (and cropped) image: the result keeps the image's
 * colours and multiplies its alpha by each mask's coverage. `image` may be null to get the bare
 * coverage (white where revealed). Pass `out` to reuse a canvas between frames.
 */
export function composeMasks(
  image: RasterSource | null,
  masks: MaskInput[],
  crop: CropInsets,
  width: number,
  height: number,
  out?: HTMLCanvasElement,
): HTMLCanvasElement {
  const canvas = out ?? document.createElement('canvas');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'copy';
  if (image) {
    ctx.drawImage(image, 0, 0, width, height);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.globalCompositeOperation = 'destination-in';
  for (const mask of masks) {
    if (mask.feather > 0) {
      const soft = featheredMask(mask, crop, width, height);
      ctx.drawImage(soft.canvas, soft.pad, soft.pad, width, height, 0, 0, width, height);
    } else {
      const m = mask.canvas;
      ctx.drawImage(
        m,
        crop.left * m.width,
        crop.top * m.height,
        Math.max(1, m.width * (1 - crop.left - crop.right)),
        Math.max(1, m.height * (1 - crop.top - crop.bottom)),
        0,
        0,
        width,
        height,
      );
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Greyscale view of a layer's masks: white = revealed, black = concealed. */
export function renderMaskView(masks: MaskInput[], crop: CropInsets, width: number, height: number, out?: HTMLCanvasElement) {
  const coverage = composeMasks(null, masks, crop, width, height);
  const canvas = out ?? document.createElement('canvas');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(coverage, 0, 0);
  return canvas;
}
