import type Konva from 'konva';
import { findLayer, isTopLevel } from '../../features/document/operations';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore, type Guide } from '../../stores/uiStore';
import type { Layer, LayerPatch } from '../../types/document';
import { boxBounds, round } from '../../utils/geometry';
import { stageRefs } from './stageRegistry';

/** Reads a Konva node's live transform back into document values. */
function readNode(layer: Layer, node: Konva.Node): LayerPatch {
  const sx = node.scaleX();
  const sy = node.scaleY();
  // Text height is measured by Konva; every other size comes from the document.
  const w = layer.type === 'text' ? node.width() : layer.width;
  const h = layer.type === 'text' ? node.height() : layer.height;
  const center = node.getTransform().point({ x: w / 2, y: h / 2 });
  const rotation = round(node.rotation(), 2);

  if (layer.type === 'group') {
    return {
      x: round(center.x - layer.width / 2),
      y: round(center.y - layer.height / 2),
      rotation,
      scaleX: sx,
      scaleY: sy,
    };
  }
  const width = Math.max(1, round(w * Math.abs(sx)));
  const height = Math.max(1, round(h * Math.abs(sy)));
  const patch: LayerPatch = {
    x: round(center.x - width / 2),
    y: round(center.y - height / 2),
    width,
    height,
    rotation,
    scaleX: Math.sign(sx) || 1,
    scaleY: Math.sign(sy) || 1,
  };
  if (layer.type === 'text' && Math.abs(Math.abs(sy) - 1) > 1e-4) {
    patch.fontSize = Math.max(1, round(layer.fontSize * Math.abs(sy)));
  }
  return patch;
}

/** Writes the current canvas position/size of every selected node into the document as one undo step. */
export function commitNodeTransforms() {
  const stage = stageRefs.stage;
  if (!stage) return;
  const { doc, selectedIds, updateEach } = useEditorStore.getState();
  const patches = new Map<string, LayerPatch>();
  for (const id of selectedIds) {
    const layer = findLayer(doc.layers, id);
    const node = stage.findOne(`#${id}`);
    if (layer && node && !layer.locked) patches.set(id, readNode(layer, node));
  }
  updateEach(patches);
}

const SNAP_PX = 6;

function nearest(targets: number[], edges: number[], threshold: number) {
  let best = threshold;
  let delta = 0;
  let position: number | null = null;
  for (const t of targets) {
    for (const e of edges) {
      const d = t - e;
      if (Math.abs(d) < best) {
        best = Math.abs(d);
        delta = d;
        position = t;
      }
    }
  }
  return { delta, position };
}

/** Snaps a dragged top-level node to the canvas edges/centre and to other layers, and publishes guide lines. */
export function snapDraggedNode(node: Konva.Node) {
  const { doc, selectedIds } = useEditorStore.getState();
  const ui = useUiStore.getState();
  const layer = findLayer(doc.layers, node.id());
  if (!layer || selectedIds.length !== 1 || !isTopLevel(doc.layers, layer.id)) {
    if (ui.guides.length) ui.set({ guides: [] });
    return;
  }
  const live = { ...layer, x: node.x() - layer.width / 2, y: node.y() - layer.height / 2 };
  const b = boxBounds(live);
  const xs = [0, doc.width / 2, doc.width];
  const ys = [0, doc.height / 2, doc.height];
  for (const other of doc.layers) {
    if (other.id === layer.id || !other.visible) continue;
    const ob = boxBounds(other);
    xs.push(ob.x, ob.x + ob.width / 2, ob.x + ob.width);
    ys.push(ob.y, ob.y + ob.height / 2, ob.y + ob.height);
  }
  const threshold = SNAP_PX / ui.zoom;
  const sx = nearest(xs, [b.x, b.x + b.width / 2, b.x + b.width], threshold);
  const sy = nearest(ys, [b.y, b.y + b.height / 2, b.y + b.height], threshold);
  const guides: Guide[] = [];
  if (sx.position !== null) {
    node.x(node.x() + sx.delta);
    guides.push({ orientation: 'v', position: sx.position });
  }
  if (sy.position !== null) {
    node.y(node.y() + sy.delta);
    guides.push({ orientation: 'h', position: sy.position });
  }
  if (guides.length || ui.guides.length) ui.set({ guides });
}

export function onLayerDragMove(e: Konva.KonvaEventObject<DragEvent>) {
  e.cancelBubble = true;
  if (e.evt?.ctrlKey || e.evt?.metaKey) {
    if (useUiStore.getState().guides.length) useUiStore.getState().set({ guides: [] });
    return;
  }
  snapDraggedNode(e.target);
}

export function onLayerDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
  e.cancelBubble = true;
  if (useUiStore.getState().guides.length) useUiStore.getState().set({ guides: [] });
  commitNodeTransforms();
}

/** Side handles on text change the wrap width instead of stretching the glyphs. */
export function onTextTransform(e: Konva.KonvaEventObject<Event>) {
  const node = e.target as Konva.Text;
  const anchor = stageRefs.transformer?.getActiveAnchor();
  if (anchor !== 'middle-left' && anchor !== 'middle-right') return;
  const width = Math.max(20, node.width() * Math.abs(node.scaleX()));
  node.setAttrs({ width, scaleX: Math.sign(node.scaleX()) || 1, offsetX: width / 2 });
}
