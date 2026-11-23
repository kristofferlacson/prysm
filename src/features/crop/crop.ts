import { revealSection } from '../../stores/uiStore';
import { findLayer } from '../document/operations';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { CropInsets, ImageLayer } from '../../types/document';

/**
 * Cropping an image layer. A crop is stored as the fraction trimmed from each side of the original
 * picture, so it never discards pixels; these helpers work in "full picture" units, where the
 * uncropped picture is the rectangle 0..1 by 0..1 and the crop is a rectangle inside it.
 */

export interface CropPreset {
  id: string;
  label: string;
  /** Width / height; null = any shape; 'original' = the picture's own shape. */
  ratio: number | 'original' | null;
}

export const CROP_PRESETS: CropPreset[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'original', label: 'Original', ratio: 'original' },
  { id: '1:1', label: '1:1 (square)', ratio: 1 },
  { id: '4:5', label: '4:5 (portrait post)', ratio: 4 / 5 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '9:16', label: '9:16 (story)', ratio: 9 / 16 },
  { id: '5:4', label: '5:4', ratio: 5 / 4 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9 (widescreen)', ratio: 16 / 9 },
];

/** The smallest a crop may be, as a fraction of the picture's width or height. */
export const MIN_CROP = 0.05;

/** Size of the whole, uncropped picture as the layer shows it (layer units). */
export function fullSize(layer: ImageLayer) {
  return {
    width: layer.width / Math.max(1e-6, 1 - layer.crop.left - layer.crop.right),
    height: layer.height / Math.max(1e-6, 1 - layer.crop.top - layer.crop.bottom),
  };
}

/** A preset's shape as width / height on the canvas for this layer, or null when it is free. */
export function presetRatio(layer: ImageLayer, presetId: string): number | null {
  const preset = CROP_PRESETS.find((p) => p.id === presetId);
  if (!preset || preset.ratio === null) return null;
  if (preset.ratio !== 'original') return preset.ratio;
  const full = fullSize(layer);
  return full.width / full.height;
}

/** The largest crop of the given shape that fits in the picture, centred where the current crop is. */
export function cropToRatio(layer: ImageLayer, ratio: number): CropInsets {
  const full = fullSize(layer);
  // The shape in "full picture" units: a ratio of 1 on a 2:1 picture is half as wide as it is tall there.
  const unit = ratio * (full.height / full.width);
  const w = Math.min(1, unit);
  const h = w / unit;
  const { crop } = layer;
  const cx = (crop.left + 1 - crop.right) / 2;
  const cy = (crop.top + 1 - crop.bottom) / 2;
  const left = Math.min(1 - w, Math.max(0, cx - w / 2));
  const top = Math.min(1 - h, Math.max(0, cy - h / 2));
  return { left, top, right: 1 - left - w, bottom: 1 - top - h };
}

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * A crop after dragging one of its handles by (dx, dy), in "full picture" units. With a ratio, the
 * shape is kept: corners resize from the opposite corner, sides from the middle of the opposite side.
 */
export function dragCrop(start: CropInsets, handle: CropHandle, dx: number, dy: number, unitRatio: number | null): CropInsets {
  let x0 = start.left;
  let y0 = start.top;
  let x1 = 1 - start.right;
  let y1 = 1 - start.bottom;
  if (handle === 'move') {
    const w = x1 - x0;
    const h = y1 - y0;
    x0 = Math.min(1 - w, Math.max(0, x0 + dx));
    y0 = Math.min(1 - h, Math.max(0, y0 + dy));
    return { left: x0, top: y0, right: 1 - x0 - w, bottom: 1 - y0 - h };
  }
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if (west) x0 = Math.min(x1 - MIN_CROP, Math.max(0, x0 + dx));
  if (east) x1 = Math.max(x0 + MIN_CROP, Math.min(1, x1 + dx));
  if (north) y0 = Math.min(y1 - MIN_CROP, Math.max(0, y0 + dy));
  if (south) y1 = Math.max(y0 + MIN_CROP, Math.min(1, y1 + dy));

  if (unitRatio) {
    // Fixed point: the opposite corner, or the middle of the opposite side.
    const ax = west ? x1 : east ? x0 : (x0 + x1) / 2;
    const ay = north ? y1 : south ? y0 : (y0 + y1) / 2;
    let w = x1 - x0;
    let h = y1 - y0;
    if (west || east) h = w / unitRatio;
    else w = h * unitRatio;
    // Room available around the fixed point in each direction the shape grows.
    const roomX = west ? ax : east ? 1 - ax : 2 * Math.min(ax, 1 - ax);
    const roomY = north ? ay : south ? 1 - ay : 2 * Math.min(ay, 1 - ay);
    const fit = Math.min(1, roomX / w, roomY / h);
    w *= fit;
    h *= fit;
    x0 = west ? ax - w : east ? ax : ax - w / 2;
    y0 = north ? ay - h : south ? ay : ay - h / 2;
    x1 = x0 + w;
    y1 = y0 + h;
  }
  return { left: x0, top: y0, right: 1 - x1, bottom: 1 - y1 };
}

/** The image layer being cropped on the canvas, if any. */
export function cropTarget(): ImageLayer | null {
  const id = useUiStore.getState().cropLayerId;
  const layer = id ? findLayer(useEditorStore.getState().doc.layers, id) : null;
  return layer?.type === 'image' ? layer : null;
}

/** Starts cropping a layer on the canvas. The crop it had is remembered so Cancel can put it back. */
export function startCropping(layerId: string) {
  const layer = findLayer(useEditorStore.getState().doc.layers, layerId);
  if (layer?.type !== 'image') return;
  if (layer.locked) {
    useUiStore.getState().notify(`“${layer.name}” is locked.`);
    return;
  }
  useEditorStore.getState().select([layerId]);
  revealSection('Crop');
  useUiStore.getState().set({ cropLayerId: layerId, cropBefore: layer.crop, tool: 'move', maskEditLayerId: null, fadePaintLayerId: null, editingTextId: null });
}

/** Leaves crop mode, keeping the crop (apply) or restoring the one it had on entry (cancel). */
export function stopCropping(apply: boolean) {
  const ui = useUiStore.getState();
  const { cropLayerId, cropBefore } = ui;
  if (!cropLayerId) return;
  if (!apply && cropBefore) useEditorStore.getState().setCrop(cropLayerId, cropBefore, 'crop-cancel');
  ui.set({ cropLayerId: null, cropBefore: null });
}

/** Applies a preset shape to a layer's crop. Returns the ratio in force (null = free). */
export function applyCropPreset(layerId: string, presetId: string) {
  const layer = findLayer(useEditorStore.getState().doc.layers, layerId);
  if (layer?.type !== 'image') return;
  useUiStore.getState().set({ cropPreset: presetId });
  const ratio = presetRatio(layer, presetId);
  if (ratio) useEditorStore.getState().setCrop(layerId, cropToRatio(layer, ratio), `crop-shape-${presetId}`);
}
