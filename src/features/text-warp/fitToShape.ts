import Konva from 'konva';
import { findLayer, isTopLevel } from '../document/operations';
import { renderLayerAlone } from '../../services/export';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { TextLayer } from '../../types/document';
import { textAttrs } from './renderText';

/**
 * "Text in the shape of a picture": the text is warped so that it fills the outline of another
 * layer (a cut-out photo, a shape, an icon, a sticker), which turns a word into a logo.
 *
 * The other layer is reduced to two curves: for every position across its width, where its outline
 * starts at the top and where it ends at the bottom. The text is then stretched between those two
 * curves, so tall parts of the shape get tall letters and narrow parts get short ones. Only the
 * curves are stored (on the text's warp), in units of the text's width, so the result scales with
 * the layer and the text stays text: retype it and the new word fills the same shape.
 */

/** How many positions across the shape are measured. */
const SAMPLES = 160;

const notify = (text: string) => useUiStore.getState().notify(text);

/** Layers a text could be shaped to: every other visible top-level layer. */
export function shapeTargets(textId: string) {
  const { doc } = useEditorStore.getState();
  return doc.layers.filter((l) => l.id !== textId && l.visible).map((l) => ({ id: l.id, name: l.name }));
}

/** Width of the text set on one line at its current size. */
function singleLineWidth(layer: TextLayer) {
  const node = new Konva.Text({ ...textAttrs(layer), width: undefined, wrap: 'none' });
  try {
    return Math.max(1, node.getTextWidth());
  } finally {
    node.destroy();
  }
}

/** Shapes a text layer to the outline of another layer. Returns true when it was applied. */
export function fitTextToShape(textId: string, targetId: string): boolean {
  const { doc } = useEditorStore.getState();
  const text = findLayer(doc.layers, textId);
  const target = findLayer(doc.layers, targetId);
  if (text?.type !== 'text' || !target) return false;
  if (!isTopLevel(doc.layers, textId)) {
    notify('Move the text out of its group first: shaping works on text that is not inside a group.');
    return false;
  }
  if (!text.text.trim()) {
    notify('Type some text first.');
    return false;
  }

  const scale = Math.min(1, 1200 / Math.max(doc.width, doc.height));
  const rendered = renderLayerAlone(targetId, scale);
  if (!rendered) {
    notify(`“${target.name}” is hidden or still loading.`);
    return false;
  }
  const w = Math.max(1, Math.round(doc.width * scale));
  const h = Math.max(1, Math.round(doc.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(rendered, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const solid = (x: number, y: number) => data[(y * w + x) * 4 + 3] > 96;

  // Top and bottom of the shape in every pixel column, and the shape's extent.
  const tops = new Int32Array(w).fill(-1);
  const bottoms = new Int32Array(w).fill(-1);
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let x = 0; x < w; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      if (!solid(x, y)) continue;
      if (top < 0) top = y;
      bottom = y;
    }
    if (top < 0) continue;
    tops[x] = top;
    bottoms[x] = bottom + 1;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (top < y0) y0 = top;
    if (bottom + 1 > y1) y1 = bottom + 1;
  }
  if (x1 - x0 < 8 || y1 - y0 < 8) {
    notify(`“${target.name}” has no shape on the canvas to follow (it is empty, or lies outside the canvas).`);
    return false;
  }

  // A gap in the middle of the shape (two separate parts) takes its values from either side.
  const column = (values: Int32Array, x: number) => {
    if (values[x] >= 0) return values[x];
    let left = x;
    let right = x;
    while (left > x0 && values[left] < 0) left--;
    while (right < x1 && values[right] < 0) right++;
    if (values[left] < 0) return values[right];
    if (values[right] < 0) return values[left];
    const t = (x - left) / Math.max(1, right - left);
    return values[left] * (1 - t) + values[right] * t;
  };
  const span = x1 - x0;
  const width = (span + 1) / scale;
  const sample = (values: Int32Array) => {
    const raw: number[] = [];
    for (let i = 0; i < SAMPLES; i++) raw.push(column(values, Math.round(x0 + (i / (SAMPLES - 1)) * span)));
    // Averaged over neighbours, so the steps of the pixel grid do not show up as a jagged edge.
    return raw.map((_, i) => {
      const a = raw[Math.max(0, i - 1)];
      const b = raw[i];
      const c = raw[Math.min(SAMPLES - 1, i + 1)];
      // In units of the text's width, measured down from the top of the shape.
      return +(((a + 2 * b + c) / 4 - y0) / scale / width).toFixed(5);
    });
  };
  const top = sample(tops);
  const bottom = sample(bottoms).map((v, i) => Math.max(v, top[i] + 0.004));

  // The text is set on one line that just fills the shape's width; the warp does the rest.
  const fontSize = Math.max(4, Math.round(((text.fontSize * width) / singleLineWidth(text)) * 0.985 * 100) / 100);
  useEditorStore.getState().updateLayers([textId], {
    x: x0 / scale,
    y: y0 / scale,
    width,
    fontSize,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    path: null,
    vertical: false,
    warp: { style: 'shape', bend: 0, horizontal: 0, vertical: 0, shape: { top, bottom } },
  });
  notify(`The text now fills the shape of “${target.name}”. Hide that layer to leave only the text, or keep it underneath in another colour.`);
  return true;
}
