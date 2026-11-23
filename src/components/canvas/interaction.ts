import type Konva from 'konva';
import { findLayer, isTopLevel } from '../../features/document/operations';
import { useEditorStore } from '../../stores/editorStore';
import { SAFE_MARGIN, useUiStore, type Guide, type SpacingMark } from '../../stores/uiStore';
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
  // An icon's line weight is part of its drawing, so it grows and shrinks with the icon.
  if (layer.type === 'shape' && layer.shape === 'icon' && layer.stroke && Math.abs(Math.abs(sy) - 1) > 1e-4) {
    patch.stroke = { ...layer.stroke, width: Math.max(0.5, round(layer.stroke.width * Math.abs(sy), 1)) };
  }
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

function clearGuides() {
  const ui = useUiStore.getState();
  if (ui.guides.length || ui.spacingMarks.length) ui.set({ guides: [], spacingMarks: [] });
}

/**
 * Snaps a dragged top-level node and publishes what it snapped to:
 * - its edges and centre to the canvas edges and centre, to other layers, and to whichever
 *   composition guides are switched on (thirds, safe margins);
 * - if nothing closer applies, to the spot that makes the gaps to its neighbours on both sides equal.
 */
export function snapDraggedNode(node: Konva.Node) {
  const { doc, selectedIds } = useEditorStore.getState();
  const ui = useUiStore.getState();
  const layer = findLayer(doc.layers, node.id());
  if (!layer || selectedIds.length !== 1 || !isTopLevel(doc.layers, layer.id)) {
    clearGuides();
    return;
  }
  const live = { ...layer, x: node.x() - layer.width / 2, y: node.y() - layer.height / 2 };
  const b = boxBounds(live);
  const xs = [0, doc.width / 2, doc.width];
  const ys = [0, doc.height / 2, doc.height];
  if (ui.composition.thirds) {
    xs.push(doc.width / 3, (doc.width * 2) / 3);
    ys.push(doc.height / 3, (doc.height * 2) / 3);
  }
  if (ui.composition.margins) {
    const m = Math.min(doc.width, doc.height) * SAFE_MARGIN;
    xs.push(m, doc.width - m);
    ys.push(m, doc.height - m);
  }
  const others = doc.layers.filter((o) => o.id !== layer.id && o.visible).map((o) => boxBounds(o));
  for (const ob of others) {
    xs.push(ob.x, ob.x + ob.width / 2, ob.x + ob.width);
    ys.push(ob.y, ob.y + ob.height / 2, ob.y + ob.height);
  }
  const threshold = SNAP_PX / ui.zoom;
  const sx = nearest(xs, [b.x, b.x + b.width / 2, b.x + b.width], threshold);
  const sy = nearest(ys, [b.y, b.y + b.height / 2, b.y + b.height], threshold);
  const guides: Guide[] = [];
  const marks: SpacingMark[] = [];
  let dx = 0;
  let dy = 0;
  if (sx.position !== null) {
    dx = sx.delta;
    guides.push({ orientation: 'v', position: sx.position });
  } else {
    // Equal gaps to the nearest layer on the left and on the right (those level with this one).
    const level = others.filter((o) => o.y < b.y + b.height && o.y + o.height > b.y);
    const left = level.filter((o) => o.x + o.width <= b.x + threshold).sort((p, q) => q.x + q.width - (p.x + p.width))[0];
    const right = level.filter((o) => o.x >= b.x + b.width - threshold).sort((p, q) => p.x - q.x)[0];
    if (left && right) {
      const x = (left.x + left.width + right.x - b.width) / 2;
      if (Math.abs(x - b.x) < threshold && x >= left.x + left.width) {
        dx = x - b.x;
        const y = b.y + b.height / 2;
        marks.push({ x1: left.x + left.width, y1: y, x2: x, y2: y }, { x1: x + b.width, y1: y, x2: right.x, y2: y });
      }
    }
  }
  if (sy.position !== null) {
    dy = sy.delta;
    guides.push({ orientation: 'h', position: sy.position });
  } else {
    const level = others.filter((o) => o.x < b.x + b.width && o.x + o.width > b.x);
    const above = level.filter((o) => o.y + o.height <= b.y + threshold).sort((p, q) => q.y + q.height - (p.y + p.height))[0];
    const below = level.filter((o) => o.y >= b.y + b.height - threshold).sort((p, q) => p.y - q.y)[0];
    if (above && below) {
      const y = (above.y + above.height + below.y - b.height) / 2;
      if (Math.abs(y - b.y) < threshold && y >= above.y + above.height) {
        dy = y - b.y;
        const x = b.x + b.width / 2 + dx;
        marks.push({ x1: x, y1: above.y + above.height, x2: x, y2: y }, { x1: x, y1: y + b.height, x2: x, y2: below.y });
      }
    }
  }
  if (dx) node.x(node.x() + dx);
  if (dy) node.y(node.y() + dy);
  if (guides.length || marks.length || ui.guides.length || ui.spacingMarks.length) ui.set({ guides, spacingMarks: marks });
}

/**
 * Ghost copies of a layer (the shapes that cut clipped layers) are drawn from the document, which
 * only changes when a drag or transform ends. Until then they follow the live node directly.
 */
function syncGhosts(node: Konva.Node) {
  const stage = node.getStage();
  const id = node.id();
  if (!stage || !id) return;
  const ghosts = stage.find(`.ghost-${id}`);
  if (!ghosts.length) return;
  const attrs = {
    x: node.x(),
    y: node.y(),
    rotation: node.rotation(),
    scaleX: node.scaleX(),
    scaleY: node.scaleY(),
    offsetX: node.offsetX(),
    offsetY: node.offsetY(),
  };
  for (const ghost of ghosts) {
    ghost.setAttrs(attrs);
    if (node.getClassName() === 'Text') ghost.width(node.width());
  }
}

export function onLayerDragMove(e: Konva.KonvaEventObject<DragEvent>) {
  e.cancelBubble = true;
  if (e.evt?.ctrlKey || e.evt?.metaKey) {
    clearGuides();
  } else {
    snapDraggedNode(e.target);
  }
  syncGhosts(e.target);
}

export function onLayerTransform(e: Konva.KonvaEventObject<Event>) {
  syncGhosts(e.target);
}

export function onLayerDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
  e.cancelBubble = true;
  clearGuides();
  commitNodeTransforms();
}

/** Side handles on text change the wrap width instead of stretching the glyphs. */
export function onTextTransform(e: Konva.KonvaEventObject<Event>) {
  const node = e.target as Konva.Text;
  const anchor = stageRefs.transformer?.getActiveAnchor();
  if (anchor === 'middle-left' || anchor === 'middle-right') {
    const width = Math.max(20, node.width() * Math.abs(node.scaleX()));
    node.setAttrs({ width, scaleX: Math.sign(node.scaleX()) || 1, offsetX: width / 2 });
  }
  syncGhosts(node);
}
