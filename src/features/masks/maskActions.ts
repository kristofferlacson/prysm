import { findLayer } from '../document/operations';
import { renderGenerated } from '../generators/render';
import { sourceSize, type RasterSource } from '../image-editing/pipeline';
import { getAssetImage, importImageBlob } from '../../services/assets';
import { getRaster, loadRaster, putRaster } from '../../services/rasters';
import { useEditorStore, type CommitOptions } from '../../stores/editorStore';
import { revealSection, useUiStore } from '../../stores/uiStore';
import type { ImageLayer, ImageSource, LayerMask } from '../../types/document';
import { NO_CROP } from '../document/factory';
import { featherRadius, maskResolution } from './maskSpace';
import { uid } from '../../utils/misc';

/**
 * Layer mask operations. Each one that changes mask pixels builds a new bitmap, registers it in the
 * raster store and points the document at it, so every operation is a normal undoable document change
 * and the layer's own pixels are never modified.
 */

export function getImageLayer(id: string): ImageLayer | null {
  const layer = findLayer(useEditorStore.getState().doc.layers, id);
  return layer?.type === 'image' ? layer : null;
}

/** The layer's original, unprocessed pixels (when they are in memory). */
export function sourceRaster(source: ImageSource): RasterSource | null {
  if (source.kind === 'asset') return getAssetImage(source.assetId);
  if (source.kind === 'generated') return renderGenerated(source);
  return getRaster(source.rasterId);
}

export function sourceDimensions(source: ImageSource) {
  if (source.kind !== 'asset') return { width: source.width, height: source.height };
  const img = getAssetImage(source.assetId);
  return img ? sourceSize(img) : null;
}

/** Sampling density for a new mask on this source (null while the source is still loading). */
export function maskSize(source: ImageSource) {
  const dims = sourceDimensions(source);
  return dims ? maskResolution(dims.width, dims.height) : null;
}

export function blankCanvas(width: number, height: number, fill?: string) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (fill) {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
  return canvas;
}

export function makeMask(canvas: HTMLCanvasElement, origin: LayerMask['origin'] = 'manual'): LayerMask {
  return {
    id: uid('m'),
    rasterId: putRaster(canvas),
    width: canvas.width,
    height: canvas.height,
    enabled: true,
    feather: 0,
    origin,
  };
}

function setMasks(layerId: string, masks: LayerMask[], opts?: CommitOptions) {
  useEditorStore.getState().updateLayers([layerId], { masks }, opts);
}

function patchMask(layer: ImageLayer, patch: Partial<LayerMask>, opts?: CommitOptions) {
  setMasks(
    layer.id,
    layer.masks.map((m, i) => (i === 0 ? { ...m, ...patch } : m)),
    opts,
  );
}

/** Adds a mask that reveals everything (white) or hides everything (black). Returns the new mask, or null. */
export function addMask(layerId: string, reveal = true, opts?: CommitOptions): LayerMask | null {
  const layer = getImageLayer(layerId);
  if (!layer) return null;
  if (layer.masks.length) return layer.masks[0];
  const size = maskSize(layer.source);
  if (!size) {
    useUiStore.getState().notify('The image is still loading. Try again in a moment.');
    return null;
  }
  const mask = makeMask(blankCanvas(size.width, size.height, reveal ? '#ffffff' : undefined));
  setMasks(layerId, [mask], opts);
  return mask;
}

/**
 * Replaces the layer's mask with the given coverage bitmap (used by background removal). A mask
 * that is being replaced passes on its feather, so editing a cut-out again keeps its soft edge.
 */
export function setMaskBitmap(layerId: string, canvas: HTMLCanvasElement, origin: LayerMask['origin']) {
  const layer = getImageLayer(layerId);
  if (!layer) return;
  setMasks(layerId, [{ ...makeMask(canvas, origin), feather: layer.masks[0]?.feather ?? 0 }]);
}

export function removeMask(layerId: string) {
  const ui = useUiStore.getState();
  if (ui.maskEditLayerId === layerId || ui.maskViewLayerId === layerId) {
    ui.set({ maskEditLayerId: null, maskViewLayerId: null });
  }
  setMasks(layerId, []);
}

export function setMaskEnabled(layerId: string, enabled: boolean) {
  const layer = getImageLayer(layerId);
  if (layer?.masks.length) patchMask(layer, { enabled });
}

export function setMaskFeather(layerId: string, feather: number) {
  const layer = getImageLayer(layerId);
  if (layer?.masks.length) patchMask(layer, { feather }, { coalesce: 'mask-feather' });
}

async function withMaskBitmap(layerId: string, edit: (current: HTMLCanvasElement) => HTMLCanvasElement) {
  const layer = getImageLayer(layerId);
  const mask = layer?.masks[0];
  if (!layer || !mask) return;
  const current = await loadRaster(mask.rasterId);
  if (!current) {
    useUiStore.getState().notify('The mask data could not be loaded.');
    return;
  }
  const next = edit(current);
  // The layer may have changed while the bitmap was loading.
  const latest = getImageLayer(layerId);
  if (latest?.masks[0]?.id !== mask.id) return;
  patchMask(latest, { rasterId: putRaster(next), width: next.width, height: next.height });
}

/**
 * Narrows a layer's mask with a coverage bitmap: 'intersect' keeps only what the bitmap covers,
 * 'subtract' hides what it covers. A layer without a mask gets one first, in the same undo step.
 * `build` receives the mask's pixel size and returns the coverage in source space.
 */
export async function combineMaskWith(
  layerId: string,
  op: 'intersect' | 'subtract',
  build: (width: number, height: number) => HTMLCanvasElement | null,
): Promise<boolean> {
  const layer = getImageLayer(layerId);
  if (!layer) return false;
  const existing = layer.masks[0];
  const size = existing ? null : maskSize(layer.source);
  const current = existing ? await loadRaster(existing.rasterId) : size ? blankCanvas(size.width, size.height, '#ffffff') : null;
  if (!current) {
    useUiStore.getState().notify(existing ? 'The mask data could not be loaded.' : 'The image is still loading. Try again in a moment.');
    return false;
  }
  const shape = build(current.width, current.height);
  if (!shape) return false;
  const out = blankCanvas(current.width, current.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(current, 0, 0);
  ctx.globalCompositeOperation = op === 'intersect' ? 'destination-in' : 'destination-out';
  ctx.drawImage(shape, 0, 0, out.width, out.height);
  const latest = getImageLayer(layerId);
  if (!latest) return false;
  if (existing) {
    if (latest.masks[0]?.id !== existing.id) return false;
    patchMask(latest, { rasterId: putRaster(out), width: out.width, height: out.height });
  } else {
    if (latest.masks.length) return false;
    setMasks(layerId, [makeMask(out)]);
  }
  return true;
}

/** Swaps revealed and concealed areas. */
export function invertMask(layerId: string) {
  return withMaskBitmap(layerId, (current) => {
    const out = blankCanvas(current.width, current.height, '#ffffff');
    const ctx = out.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(current, 0, 0);
    return out;
  });
}

/** Makes the mask reveal everything again, keeping the mask itself. */
export function resetMask(layerId: string) {
  return withMaskBitmap(layerId, (current) => blankCanvas(current.width, current.height, '#ffffff'));
}

/**
 * Bakes the mask into a new image: the concealed areas become real transparency and the mask is
 * removed. This is the one deliberately destructive mask operation, so the original stays in the
 * uploads library and the step can be undone.
 */
export async function applyMask(layerId: string) {
  const layer = getImageLayer(layerId);
  const mask = layer?.masks[0];
  if (!layer || !mask) return;
  const source = sourceRaster(layer.source);
  const coverage = await loadRaster(mask.rasterId);
  if (!source || !coverage) {
    useUiStore.getState().notify('The image or its mask is not loaded yet.');
    return;
  }
  const { width, height } = sourceSize(source);
  const baked = blankCanvas(width, height);
  const ctx = baked.getContext('2d')!;
  ctx.drawImage(source, 0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingQuality = 'high';
  const radius = featherRadius(mask.feather, NO_CROP, width, height);
  if (radius > 0 && typeof ctx.filter === 'string') ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(coverage, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => baked.toBlob(resolve, 'image/png'));
  if (!blob) {
    useUiStore.getState().notify('The masked image could not be created.');
    return;
  }
  const asset = await importImageBlob(blob, `${layer.name} (masked)`, 'image/png');
  if (getImageLayer(layerId)?.masks[0]?.id !== mask.id) return;
  const ui = useUiStore.getState();
  ui.set({ maskEditLayerId: null, maskViewLayerId: null });
  useEditorStore.getState().updateLayers([layerId], { source: { kind: 'asset', assetId: asset.id }, masks: [] });
}

/** Switches the edit target between a layer's pixels and its mask. */
export function setMaskEditing(layerId: string | null) {
  const ui = useUiStore.getState();
  if (layerId && ui.maskEditLayerId !== layerId) revealSection('Mask');
  ui.set({ maskEditLayerId: layerId, maskViewLayerId: layerId && ui.maskViewLayerId === layerId ? layerId : null, ...(layerId ? { fadePaintLayerId: null } : {}) });
}
