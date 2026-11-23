import { getImageLayer, maskSize } from '../masks/maskActions';
import { visibleRect } from '../masks/maskSpace';
import { selectionInLayerSpace } from '../selection/selectionSpace';
import { useAreaSelection } from '../selection/selectionStore';
import { putRaster } from '../../services/rasters';
import { useEditorStore } from '../../stores/editorStore';
import { revealSection, useUiStore } from '../../stores/uiStore';
import { DEFAULT_FADE } from './fade';

const notify = (text: string) => useUiStore.getState().notify(text);

/** True when the bitmap has something inside the part of the image the crop leaves visible. */
function touchesImage(shape: HTMLCanvasElement, crop: { left: number; top: number; right: number; bottom: number }) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 128;
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  const visible = visibleRect(shape.width, shape.height, crop);
  ctx.drawImage(shape, visible.x, visible.y, visible.width, visible.height, 0, 0, 128, 128);
  const data = ctx.getImageData(0, 0, 128, 128).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 24) return true;
  return false;
}

/**
 * Makes the layer's fade follow the current selection: the image shows inside the selected shape
 * and fades at its outline. The shape is kept with the layer (in its own space, like a mask), so
 * it moves, turns and scales with it and the selection itself is no longer needed.
 */
export function fadeAlongSelection(layerId: string): boolean {
  const layer = getImageLayer(layerId);
  if (!layer) return false;
  if (!useAreaSelection.getState().mask) {
    notify('Nothing is selected. Draw the shape with a selection tool first (marquee, lasso or magic wand).');
    return false;
  }
  const size = maskSize(layer.source);
  const shape = size && selectionInLayerSpace(layer, size.width, size.height);
  if (!size || !shape) {
    notify('That layer is still loading. Try again in a moment.');
    return false;
  }
  if (!touchesImage(shape, layer.crop)) {
    notify(`The selection does not touch “${layer.name}”. Draw it over the image.`);
    return false;
  }
  const fade = layer.fade ?? DEFAULT_FADE;
  useEditorStore.getState().updateLayers([layerId], {
    // The shape takes over from the sides; they can be switched on again to add to it.
    fade: { ...fade, from: [], angle: null, shape: { rasterId: putRaster(shape), width: size.width, height: size.height } },
  });
  revealSection('Fade');
  notify(`“${layer.name}” now fades along the selected shape. Adjust it under Fade on the right.`);
  return true;
}

/** Drops the shape from the layer's fade; its other parts stay. */
export function removeFadeShape(layerId: string) {
  const layer = getImageLayer(layerId);
  if (!layer?.fade?.shape) return;
  useEditorStore.getState().updateLayers([layerId], { fade: { ...layer.fade, shape: null } });
}

/**
 * Starts painting the layer's fade: from here on the brush fades the image where it passes and the
 * eraser brings it back. A layer without a fade gets one made of brush strokes only.
 */
export function startFadePainting(layerId: string) {
  const layer = getImageLayer(layerId);
  if (!layer) return;
  if (layer.locked || !layer.visible) {
    notify(`“${layer.name}” is ${layer.locked ? 'locked' : 'hidden'}.`);
    return;
  }
  const editor = useEditorStore.getState();
  if (!layer.fade) editor.updateLayers([layerId], { fade: { ...DEFAULT_FADE, from: [] } });
  if (editor.selectedIds.length !== 1 || editor.selectedIds[0] !== layerId) editor.select([layerId]);
  useUiStore.getState().set({ fadePaintLayerId: layerId, maskEditLayerId: null, maskViewLayerId: null, tool: 'brush' });
  revealSection('Fade');
}

/** Back to the ordinary tools. What was painted stays. */
export function stopFadePainting() {
  const ui = useUiStore.getState();
  if (!ui.fadePaintLayerId) return;
  ui.set({ fadePaintLayerId: null, tool: 'move' });
}

/** Removes everything painted on the layer's fade; its other parts stay. */
export function clearFadePaint(layerId: string) {
  const layer = getImageLayer(layerId);
  if (!layer?.fade?.paint) return;
  useEditorStore.getState().updateLayers([layerId], { fade: { ...layer.fade, paint: null } });
}
