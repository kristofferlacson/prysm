import type { Adjustments, CropInsets, EffectInstance } from '../../types/document';
import { blurCanvas, EFFECT_MAP, makeCanvas } from '../effects/effects';
import { featherRadius, visibleRect } from '../masks/maskSpace';
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
  const active = effects.filter((e) => e.enabled !== false && e.amount > 0 && EFFECT_MAP.has(e.type));
  if (!cropped && neutral && !active.length && Math.max(sw, sh) <= maxDim) return src;

  const visible = visibleRect(sw, sh, crop);
  const cx = visible.x;
  const cy = visible.y;
  const cw = Math.max(1, visible.width);
  const ch = Math.max(1, visible.height);
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
  for (const fx of active) EFFECT_MAP.get(fx.type)!.apply(canvas, ctx, fx.amount, seed, fx.colors, fx.angle);
  return canvas;
}

export interface MaskInput {
  /** Coverage bitmap spanning the whole uncropped source (alpha = how much of the layer shows). */
  canvas: HTMLCanvasElement;
  /** Edge softness as a fraction of the source's longer side (see maskSpace.ts). */
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

/**
 * The visible part of a mask rendered at w x h with its edges softened.
 *
 * The blur is defined in source space, so it must see the mask as it really is around the visible
 * region: content the crop hides still shapes the soft edge next to it. Only beyond the edge of the
 * source itself, where there is no mask, is the edge value extended. That makes the result
 * independent of the crop: cropping a feathered layer never changes how the remaining part looks.
 */
function featheredMask(mask: MaskInput, crop: CropInsets, w: number, h: number) {
  const { canvas } = mask;
  const visible = visibleRect(canvas.width, canvas.height, crop);
  const radius = featherRadius(mask.feather, crop, w, h);
  // A Gaussian reaches about three radii; padding less than that lets the canvas edge bleed in.
  const pad = Math.ceil(radius * 3) + 1;
  const kx = w / visible.width;
  const ky = h / visible.height;
  // The source-space region needed (visible part plus the blur's reach), limited to the bitmap.
  const x0 = Math.max(0, visible.x - pad / kx);
  const y0 = Math.max(0, visible.y - pad / ky);
  const x1 = Math.min(canvas.width, visible.x + visible.width + pad / kx);
  const y1 = Math.min(canvas.height, visible.y + visible.height + pad / ky);

  const padded = makeCanvas(w + pad * 2, h + pad * 2);
  const pctx = padded.getContext('2d')!;
  // Underlay: that region stretched over the whole padded canvas, standing in for "the edge value,
  // extended" wherever the padding reaches past the source.
  pctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, padded.width, padded.height);
  const dx = pad + (x0 - visible.x) * kx;
  const dy = pad + (y0 - visible.y) * ky;
  const dw = (x1 - x0) * kx;
  const dh = (y1 - y0) * ky;
  pctx.clearRect(dx, dy, dw, dh);
  pctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, dx, dy, dw, dh);
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
      const visible = visibleRect(mask.canvas.width, mask.canvas.height, crop);
      ctx.drawImage(mask.canvas, visible.x, visible.y, visible.width, visible.height, 0, 0, width, height);
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
