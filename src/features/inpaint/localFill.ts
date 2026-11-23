import { softResultMask, selectionCoverage } from '../ai/generativeFill';
import { createImage, NO_CROP } from '../document/factory';
import { layerToDocument } from '../document/operations';
import { sourceSize } from '../image-editing/pipeline';
import { blankCanvas, getImageLayer, makeMask, sourceRaster } from '../masks/maskActions';
import { maskResolution, visibleRect } from '../masks/maskSpace';
import { useAreaSelection } from '../selection/selectionStore';
import { importImageBlob, loadAssetImage } from '../../services/assets';
import { renderRegion } from '../../services/export';
import { loadRaster, putRaster } from '../../services/rasters';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { ImageLayer, ImageSource, LayerMask } from '../../types/document';
import { applyMat, centerMatrix, invert } from '../../utils/geometry';
import { contentAwareFill, useLocalTools } from './contentAwareFill';

/**
 * The two things content-aware fill is used for. Neither calls a service or a model:
 *
 *  - filling a selection from its surroundings (removing an object), which adds a new masked layer
 *    and leaves everything underneath alone, and
 *  - expanding an image past its edges, which gives the layer a larger picture whose new border is
 *    built from the picture itself. The original stays in Uploads and the step can be undone.
 */

const notify = (text: string) => useUiStore.getState().notify(text);
const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** Longer side, in pixels, of the area a selection fill is computed at. */
const FILL_MAX_SIDE = 1400;
/** Size limits for an expanded image. */
export const EXPAND_MAX_AREA = 6_000_000;
export const EXPAND_MAX_SIDE = 4096;

/** Fills the selected area from what surrounds it. Resolves to the new layer's id, or null. */
export async function contentAwareFillSelection(): Promise<string | null> {
  const tools = useLocalTools.getState();
  if (tools.job) return null;
  const { bounds, mask } = useAreaSelection.getState();
  if (!mask || !bounds) {
    notify('Select the area to fill first.');
    return null;
  }
  const { doc } = useEditorStore.getState();
  // The selection plus about as much again on every side to copy from, kept inside the canvas.
  const margin = Math.max(96, Math.max(bounds.width, bounds.height));
  const x0 = Math.max(0, Math.floor(bounds.x - margin));
  const y0 = Math.max(0, Math.floor(bounds.y - margin));
  const x1 = Math.min(doc.width, Math.ceil(bounds.x + bounds.width + margin));
  const y1 = Math.min(doc.height, Math.ceil(bounds.y + bounds.height + margin));
  const rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const scale = Math.min(2, FILL_MAX_SIDE / Math.max(rect.width, rect.height));
  const width = Math.max(1, Math.round(rect.width * scale));
  const height = Math.max(1, Math.round(rect.height * scale));

  const report = (message: string, progress: number | null = null) => useLocalTools.getState().set({ job: { layerId: null, kind: 'fill', message, progress } });
  report('Preparing the area…');
  try {
    const rendered = await renderRegion(rect, scale);
    const picture = blankCanvas(width, height);
    const ctx = picture.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(rendered, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const coverage = selectionCoverage(rect, width, height).getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
    const hole = new Uint8Array(width * height);
    let missing = 0;
    for (let i = 0; i < hole.length; i++) {
      if (coverage[i * 4 + 3] > 24) {
        hole[i] = 1;
        missing++;
      }
    }
    if (missing > hole.length * 0.9) throw new Error('Almost the whole canvas is selected, so there is nothing left to fill it from. Select a smaller area.');
    const layerMask = softResultMask(rect, width, height);

    report('Filling from the surroundings…', 0);
    const { image: filled, milliseconds } = await contentAwareFill(image, hole, (f) => report(`Filling from the surroundings… ${percent(f)}`, f));
    ctx.putImageData(filled, 0, 0);
    const blob = await toBlob(picture);
    if (!blob) throw new Error('The filled image could not be created.');
    const asset = await importImageBlob(blob, 'Content-aware fill', 'image/png');
    const editor = useEditorStore.getState();
    if (editor.doc.id !== doc.id) throw new Error('Another project was opened before the fill was ready. The image is in Uploads.');
    const layer: ImageLayer = {
      ...createImage({ kind: 'asset', assetId: asset.id }, 'Content-aware fill', asset.width, asset.height, doc.width, doc.height),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      masks: [makeMask(layerMask)],
    };
    editor.addLayers([layer]);
    useLocalTools.getState().set({ lastRun: { kind: 'fill', milliseconds, width, height } });
    notify('Filled from the surroundings, as a new layer masked to the selection. Nothing underneath was changed.');
    return layer.id;
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The fill failed.');
    return null;
  } finally {
    useLocalTools.getState().set({ job: null });
  }
}

/** How far to grow a layer on each side, in the layer's own pixels and orientation. */
export interface Sides {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What it takes for this layer to cover the whole canvas (all zero when it already does). */
export function sidesToCoverCanvas(layer: ImageLayer): Sides | null {
  const { doc } = useEditorStore.getState();
  const toDoc = layerToDocument(doc.layers, layer.id);
  if (!toDoc) return null;
  const toLayer = invert(toDoc);
  const corners = [applyMat(toLayer, 0, 0), applyMat(toLayer, doc.width, 0), applyMat(toLayer, doc.width, doc.height), applyMat(toLayer, 0, doc.height)];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const grow = (v: number) => Math.max(0, Math.ceil(v - 0.01));
  return {
    left: grow(-Math.min(...xs)),
    top: grow(-Math.min(...ys)),
    right: grow(Math.max(...xs) - layer.width),
    bottom: grow(Math.max(...ys) - layer.height),
  };
}

/**
 * Grows an image layer past its edges and builds the new border from the image itself.
 * The part of the image that is showing (its crop) stays exactly where it is on the canvas.
 */
export async function expandImageLayer(layerId: string, sides: Sides): Promise<boolean> {
  const tools = useLocalTools.getState();
  if (tools.job) return false;
  const layer = getImageLayer(layerId);
  if (!layer) return false;
  if (layer.locked) {
    notify(`“${layer.name}” is locked.`);
    return false;
  }
  const grow = { left: Math.max(0, sides.left), top: Math.max(0, sides.top), right: Math.max(0, sides.right), bottom: Math.max(0, sides.bottom) };
  if (grow.left + grow.top + grow.right + grow.bottom < 1) {
    notify('Enter how far to expand on at least one side.');
    return false;
  }

  const report = (message: string, progress: number | null = null) => useLocalTools.getState().set({ job: { layerId, kind: 'expand', message, progress } });
  report('Preparing the image…');
  try {
    if (layer.source.kind === 'asset') await loadAssetImage(layer.source.assetId);
    if (layer.source.kind === 'raster') await loadRaster(layer.source.rasterId);
    const source = sourceRaster(layer.source);
    if (!source) throw new Error('The image for this layer could not be loaded.');
    const dims = sourceSize(source);
    const visible = visibleRect(dims.width, dims.height, layer.crop);
    // Source pixels per layer pixel.
    const kx = visible.width / layer.width;
    const ky = visible.height / layer.height;
    const fullW = visible.width + (grow.left + grow.right) * kx;
    const fullH = visible.height + (grow.top + grow.bottom) * ky;
    const fit = Math.min(1, Math.sqrt(EXPAND_MAX_AREA / (fullW * fullH)), EXPAND_MAX_SIDE / Math.max(fullW, fullH));
    const width = Math.max(1, Math.round(fullW * fit));
    const height = Math.max(1, Math.round(fullH * fit));
    const ix = Math.round(grow.left * kx * fit);
    const iy = Math.round(grow.top * ky * fit);
    const iw = Math.max(1, Math.min(width - ix, Math.round(visible.width * fit)));
    const ih = Math.max(1, Math.min(height - iy, Math.round(visible.height * fit)));

    const picture = blankCanvas(width, height);
    const ctx = picture.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, visible.x, visible.y, visible.width, visible.height, ix, iy, iw, ih);
    const image = ctx.getImageData(0, 0, width, height);
    const hole = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const inside = y >= iy && y < iy + ih;
      for (let x = 0; x < width; x++) if (!inside || x < ix || x >= ix + iw) hole[y * width + x] = 1;
    }

    report('Building the new area from the image…', 0);
    const { image: filled, milliseconds } = await contentAwareFill(image, hole, (f) => report(`Building the new area from the image… ${percent(f)}`, f));
    ctx.putImageData(filled, 0, 0);

    let nextSource: ImageSource;
    if (layer.source.kind === 'raster') {
      // A paint layer stays a paint layer.
      nextSource = { kind: 'raster', rasterId: putRaster(picture), width, height };
    } else {
      report('Saving the expanded image…');
      const blob = await toBlob(picture);
      if (!blob) throw new Error('The expanded image could not be created.');
      const asset = await importImageBlob(blob, `${layer.name} (expanded)`, 'image/png');
      nextSource = { kind: 'asset', assetId: asset.id };
    }

    // Masks cover the source image, which has just grown: the old mask keeps its place, the new border is revealed.
    const masks: LayerMask[] = [];
    for (const mask of layer.masks) {
      const old = await loadRaster(mask.rasterId);
      if (!old) throw new Error('The layer’s mask could not be loaded.');
      const size = maskResolution(width, height);
      const canvas = blankCanvas(size.width, size.height, '#ffffff');
      const mctx = canvas.getContext('2d')!;
      const part = visibleRect(old.width, old.height, layer.crop);
      const sx = size.width / width;
      const sy = size.height / height;
      mctx.clearRect(ix * sx, iy * sy, iw * sx, ih * sy);
      mctx.imageSmoothingQuality = 'high';
      mctx.drawImage(old, part.x, part.y, part.width, part.height, ix * sx, iy * sy, iw * sx, ih * sy);
      // Feather is a fraction of the source's longer side; keep it the same width in pixels.
      const feather = (mask.feather * Math.max(dims.width, dims.height) * fit) / Math.max(width, height);
      masks.push({ ...mask, rasterId: putRaster(canvas), width: size.width, height: size.height, feather });
    }

    // The shape of a fade covers the source image too: it keeps its place, the new border lies outside it.
    let fade = layer.fade ?? null;
    if (fade?.shape) {
      const old = await loadRaster(fade.shape.rasterId);
      if (!old) throw new Error('The shape of the layer’s fade could not be loaded.');
      const size = maskResolution(width, height);
      const canvas = blankCanvas(size.width, size.height);
      const sctx = canvas.getContext('2d')!;
      const part = visibleRect(old.width, old.height, layer.crop);
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(old, part.x, part.y, part.width, part.height, (ix * size.width) / width, (iy * size.height) / height, (iw * size.width) / width, (ih * size.height) / height);
      fade = { ...fade, shape: { rasterId: putRaster(canvas), width: size.width, height: size.height } };
    }
    if (fade?.paint) {
      const old = await loadRaster(fade.paint.rasterId);
      if (!old) throw new Error('The painting of the layer’s fade could not be loaded.');
      const size = maskResolution(width, height);
      const canvas = blankCanvas(size.width, size.height);
      const pctx = canvas.getContext('2d')!;
      const part = visibleRect(old.width, old.height, layer.crop);
      pctx.imageSmoothingQuality = 'high';
      pctx.drawImage(old, part.x, part.y, part.width, part.height, (ix * size.width) / width, (iy * size.height) / height, (iw * size.width) / width, (ih * size.height) / height);
      fade = { ...fade, paint: { rasterId: putRaster(canvas), width: size.width, height: size.height } };
    }

    const current = getImageLayer(layerId);
    if (!current || current.source !== layer.source || current.crop !== layer.crop || (current.fade ?? null) !== (layer.fade ?? null)) throw new Error('The layer changed while it was being expanded. Nothing was applied.');
    const newWidth = current.width + grow.left + grow.right;
    const newHeight = current.height + grow.top + grow.bottom;
    // The box grows in the layer's own orientation, so its centre moves along the layer's axes.
    const centre = applyMat(centerMatrix(current), (grow.right - grow.left) / 2, (grow.bottom - grow.top) / 2);
    useEditorStore.getState().updateLayers([layerId], {
      source: nextSource,
      crop: NO_CROP,
      width: newWidth,
      height: newHeight,
      x: centre.x - newWidth / 2,
      y: centre.y - newHeight / 2,
      masks,
      ...(fade?.shape || fade?.paint ? { fade } : {}),
    });
    useLocalTools.getState().set({ lastRun: { kind: 'expand', milliseconds, width, height } });
    notify(
      fit < 1
        ? `Expanded. The image was reduced to ${width} × ${height} px to stay within the size limit; the original is in Uploads.`
        : 'Expanded. The new area was built from the image itself; the original is still in Uploads.',
    );
    return true;
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The image could not be expanded.');
    return false;
  } finally {
    useLocalTools.getState().set({ job: null });
  }
}
