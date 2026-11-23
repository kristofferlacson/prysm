import { layerToDocument } from '../document/operations';
import { layerToBitmap } from '../masks/maskSpace';
import { useEditorStore } from '../../stores/editorStore';
import type { ImageLayer } from '../../types/document';
import { invert, multiply } from '../../utils/geometry';
import { selectionGrid, useAreaSelection } from './selectionStore';

/**
 * Conversions between the two bitmap spaces: the selection lives in document space, layer masks
 * and paint live in each layer's source space (maskSpace.ts). Both directions go through the
 * layer's transform, so rotation, flips, groups and crops are handled by the same matrices that
 * place the layer on the canvas.
 */

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** The current selection, redrawn as a source-space bitmap of the given size for this layer. */
export function selectionInLayerSpace(layer: ImageLayer, width: number, height: number): HTMLCanvasElement | null {
  const { mask } = useAreaSelection.getState();
  const { doc } = useEditorStore.getState();
  const toDoc = layerToDocument(doc.layers, layer.id);
  if (!mask || !toDoc) return null;
  const m = multiply(layerToBitmap(layer, width, height), invert(toDoc));
  const out = canvasOf(width, height);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(mask, 0, 0, doc.width, doc.height);
  return out;
}

/** A source-space coverage bitmap of this layer, redrawn in document space as a selection shape. */
export function layerBitmapToSelection(layer: ImageLayer, bitmap: HTMLCanvasElement): HTMLCanvasElement | null {
  const { doc } = useEditorStore.getState();
  const toDoc = layerToDocument(doc.layers, layer.id);
  if (!toDoc) return null;
  const grid = selectionGrid();
  const out = canvasOf(grid.width, grid.height);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const toLayer = multiply([grid.scale, 0, 0, grid.scale, 0, 0], toDoc);
  ctx.setTransform(toLayer[0], toLayer[1], toLayer[2], toLayer[3], toLayer[4], toLayer[5]);
  // Only the part of the image the crop leaves visible can be selected.
  ctx.beginPath();
  ctx.rect(0, 0, layer.width, layer.height);
  ctx.clip();
  const m = multiply(toLayer, invert(layerToBitmap(layer, bitmap.width, bitmap.height)));
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(bitmap, 0, 0);
  return out;
}
