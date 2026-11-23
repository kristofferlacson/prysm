import { findSubject } from '../background-removal/removeBackground';
import { cloneLayer, createImage } from '../document/factory';
import { findLayer, mapLists } from '../document/operations';
import { blankCanvas, combineMaskWith, getImageLayer, makeMask, maskSize } from '../masks/maskActions';
import { PAINT_MAX_DIM } from '../paint/paintController';
import { renderDocument, renderLayerAlone } from '../../services/export';
import { loadRaster, putRaster } from '../../services/rasters';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { ImageLayer, Layer, LayerMask } from '../../types/document';
import type { Point } from '../../utils/geometry';
import { uid } from '../../utils/misc';
import { wandSelect } from './magicWand';
import { layerBitmapToSelection, selectionInLayerSpace } from './selectionSpace';
import { combineSelection, selectionGrid, useAreaSelection, type SelectionMode } from './selectionStore';

/**
 * What a selection is used for. Every command here leaves the image's own pixels alone: an area is
 * hidden or isolated through the layer's mask, and anything new arrives as its own layer.
 */

const notify = (text: string) => useUiStore.getState().notify(text);

/** The one layer the selection commands act on, or the reason there is none. */
export function selectionTarget(): { layer: ImageLayer; reason?: undefined } | { layer?: undefined; reason: string } {
  const { doc, selectedIds } = useEditorStore.getState();
  if (selectedIds.length !== 1) return { reason: 'Select one image layer in the Layers panel first.' };
  const layer = findLayer(doc.layers, selectedIds[0]);
  if (!layer) return { reason: 'Select one image layer in the Layers panel first.' };
  if (layer.type !== 'image') return { reason: 'Masks work on image layers. Select an image or paint layer.' };
  if (layer.locked) return { reason: `“${layer.name}” is locked.` };
  return { layer };
}

function requireTarget(): ImageLayer | null {
  if (!useAreaSelection.getState().mask) {
    notify('Nothing is selected. Draw a selection first.');
    return null;
  }
  const target = selectionTarget();
  if (!target.layer) notify(target.reason);
  return target.layer ?? null;
}

/** Shows the layer only inside the selection (or, with `hide`, hides the selected part of it). */
export async function maskLayerWithSelection(hide = false) {
  const layer = requireTarget();
  if (!layer) return false;
  const ok = await combineMaskWith(layer.id, hide ? 'subtract' : 'intersect', (w, h) => selectionInLayerSpace(layer, w, h));
  if (ok) notify(hide ? `Hid the selected part of “${layer.name}” with its mask. The image itself is unchanged.` : `“${layer.name}” now shows only inside the selection. The image itself is unchanged.`);
  return ok;
}

/** Puts the selected part of the layer on a new layer above it. With `cut`, the original loses that part (through its mask). */
export async function selectionToNewLayer(cut = false) {
  const layer = requireTarget();
  if (!layer) return null;
  const existing = layer.masks[0];
  const size = existing ? null : maskSize(layer.source);
  const base = existing ? await loadRaster(existing.rasterId) : size ? blankCanvas(size.width, size.height, '#ffffff') : null;
  if (!base) {
    notify('That layer is still loading. Try again in a moment.');
    return null;
  }
  const shape = selectionInLayerSpace(layer, base.width, base.height);
  if (!shape || getImageLayer(layer.id)?.masks[0]?.id !== existing?.id) return null;

  const part = (op: GlobalCompositeOperation): LayerMask => {
    const canvas = blankCanvas(base.width, base.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = op;
    ctx.drawImage(shape, 0, 0);
    return existing ? { ...existing, id: uid('m'), rasterId: putRaster(canvas) } : makeMask(canvas);
  };
  const copy = { ...(cloneLayer(layer) as ImageLayer), name: `${layer.name} (selection)`, masks: [part('destination-in')] };
  const remainder = cut ? { ...part('destination-out'), id: existing?.id ?? uid('m') } : null;

  useEditorStore.getState().commit(
    (doc) => ({
      ...doc,
      layers: mapLists(doc.layers, (list) => {
        const index = list.findIndex((l) => l.id === layer.id);
        if (index < 0) return list;
        const next = [...list];
        if (remainder) next[index] = { ...(next[index] as ImageLayer), masks: [remainder] } as Layer;
        next.splice(index + 1, 0, copy);
        return next;
      }),
    }),
    {},
    [copy.id],
  );
  notify(cut ? 'Moved the selected area to a new layer.' : 'Copied the selected area to a new layer.');
  return copy.id;
}

/** Adds a new layer holding the given colour inside the selection. */
export function fillSelection(color: string) {
  const { mask } = useAreaSelection.getState();
  if (!mask) {
    notify('Nothing is selected. Draw a selection first.');
    return null;
  }
  const { doc, addLayers } = useEditorStore.getState();
  const k = Math.min(1, PAINT_MAX_DIM / Math.max(doc.width, doc.height));
  const width = Math.max(1, Math.round(doc.width * k));
  const height = Math.max(1, Math.round(doc.height * k));
  const canvas = blankCanvas(width, height, color);
  const ctx = canvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mask, 0, 0, width, height);
  const layer: ImageLayer = {
    ...createImage({ kind: 'raster', rasterId: putRaster(canvas), width, height }, 'Fill', width, height, doc.width, doc.height),
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
  };
  addLayers([layer]);
  return layer.id;
}

/** Magic wand click at a document point. */
export async function wandAt(point: Point, mode: SelectionMode) {
  const grid = selectionGrid();
  const settings = useAreaSelection.getState();
  const x = Math.floor(point.x * grid.scale);
  const y = Math.floor(point.y * grid.scale);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return;

  let rendered: HTMLCanvasElement | null;
  if (settings.sampleAll) {
    rendered = await renderDocument(grid.scale);
  } else {
    const { selectedIds } = useEditorStore.getState();
    if (selectedIds.length !== 1) {
      notify('Select the layer to sample, or set the wand to sample all layers.');
      return;
    }
    rendered = renderLayerAlone(selectedIds[0], grid.scale);
  }
  if (!rendered) {
    notify('The canvas is not ready yet.');
    return;
  }
  // Read through a canvas of exactly the selection's size, whatever size the render came back at.
  const exact = blankCanvas(grid.width, grid.height);
  const ctx = exact.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(rendered, 0, 0, grid.width, grid.height);
  const hard = wandSelect(ctx.getImageData(0, 0, grid.width, grid.height), x, y, settings.tolerance, settings.contiguous);
  // Half a pixel of softening so the edge is not a staircase once it becomes a mask.
  const smooth = blankCanvas(grid.width, grid.height);
  const sctx = smooth.getContext('2d')!;
  if (typeof sctx.filter === 'string') sctx.filter = 'blur(0.5px)';
  sctx.drawImage(hard, 0, 0);
  combineSelection(smooth, mode);
}

/** Selects everything the layer draws (its opaque pixels), as it sits on the canvas. */
export function selectLayerPixels(layerId: string, mode: SelectionMode = 'new') {
  const grid = selectionGrid();
  const rendered = renderLayerAlone(layerId, grid.scale);
  if (!rendered) {
    notify('That layer is hidden or still loading.');
    return;
  }
  const exact = blankCanvas(grid.width, grid.height);
  exact.getContext('2d')!.drawImage(rendered, 0, 0, grid.width, grid.height);
  combineSelection(exact, mode);
}

/** Finds the main subject of the selected image with the in-browser segmentation model and selects it. */
export async function selectSubject(mode: SelectionMode = 'new') {
  const store = useAreaSelection.getState();
  if (store.busy) return;
  const target = selectionTarget();
  if (!target.layer) {
    notify(target.reason);
    return;
  }
  const layer = target.layer;
  store.set({ busy: 'Finding the subject…' });
  try {
    const { mask } = await findSubject(layer.id, (_phase, message) => useAreaSelection.getState().set({ busy: message }));
    const current = getImageLayer(layer.id);
    const shape = current && layerBitmapToSelection(current, mask);
    if (!shape) throw new Error('The layer was removed before the result was ready.');
    combineSelection(shape, mode);
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The subject could not be found.');
  } finally {
    useAreaSelection.getState().set({ busy: null });
  }
}
