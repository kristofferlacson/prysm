import type { CropInsets } from '../../types/document';
import type { Mat } from '../../utils/geometry';

/**
 * SOURCE SPACE — the one coordinate system for layer masks and paint.
 *
 * Every bitmap attached to an image layer (a mask, or a paint layer's pixels) covers the unit
 * square of the layer's *source image*: (0,0) is the source's top-left corner and (1,1) its
 * bottom-right, before any cropping. The bitmap's own pixel size is only its sampling density.
 *
 * Consequences, all of which follow from the definition rather than from special cases:
 *  - Moving, resizing, rotating or flipping the layer does not touch the mask: the layer's
 *    transform carries image and mask together.
 *  - Cropping selects the same sub-rectangle of the image and of the mask.
 *  - A mask may have any resolution, including one that differs from the image's. A 300 px photo
 *    can carry a 1024 px mask; a 24-megapixel photo carries a 2048 px one.
 *  - The same document renders the same at preview size, at full export size and at any export
 *    scale, because nothing is expressed in output pixels.
 *
 * Anything that needs this mapping must get it from here, so there is exactly one definition.
 */

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Cropped = { crop: CropInsets };
type Boxed = Cropped & { width: number; height: number };

/** The part of a source-space bitmap that the crop leaves visible, in that bitmap's pixels. */
export function visibleRect(bitmapWidth: number, bitmapHeight: number, crop: CropInsets): PixelRect {
  return {
    x: crop.left * bitmapWidth,
    y: crop.top * bitmapHeight,
    width: Math.max(1e-6, bitmapWidth * (1 - crop.left - crop.right)),
    height: Math.max(1e-6, bitmapHeight * (1 - crop.top - crop.bottom)),
  };
}

/**
 * Maps the layer's own box (document units, origin at the box's top-left corner) to pixels of a
 * source-space bitmap. The box shows only the cropped part of the source, hence the offset.
 */
export function layerToBitmap(layer: Boxed, bitmapWidth: number, bitmapHeight: number): Mat {
  const visible = visibleRect(bitmapWidth, bitmapHeight, layer.crop);
  return [visible.width / layer.width, 0, 0, visible.height / layer.height, visible.x, visible.y];
}

/**
 * Feather is stored as a fraction of the source's longer side, so it is a property of the image,
 * not of how the image happens to be cropped or rendered. This converts it to a blur radius in
 * pixels for a render of the visible region at `outWidth` x `outHeight`.
 */
export function featherRadius(feather: number, crop: CropInsets, outWidth: number, outHeight: number) {
  if (feather <= 0) return 0;
  // Size the whole, uncropped source would have at this render's scale.
  const fullWidth = outWidth / Math.max(1e-6, 1 - crop.left - crop.right);
  const fullHeight = outHeight / Math.max(1e-6, 1 - crop.top - crop.bottom);
  return feather * Math.max(fullWidth, fullHeight);
}

export const MASK_MIN_DIM = 1024;
export const MASK_MAX_DIM = 2048;

/**
 * Sampling density for a new mask. It follows the source's aspect ratio, is never coarser than
 * 1024 px on the longer side (so a small image shown large still gets smooth mask edges) and
 * never finer than 2048 px (so a huge photo's mask stays light).
 */
export function maskResolution(sourceWidth: number, sourceHeight: number) {
  const longer = Math.max(sourceWidth, sourceHeight, 1);
  const target = Math.min(MASK_MAX_DIM, Math.max(MASK_MIN_DIM, longer));
  const k = target / longer;
  return { width: Math.max(1, Math.round(sourceWidth * k)), height: Math.max(1, Math.round(sourceHeight * k)) };
}
