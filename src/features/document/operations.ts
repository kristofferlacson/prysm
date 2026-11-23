import type { GroupLayer, Layer, LayerPatch } from '../../types/document';
import { applyMat, boxBounds, boxMatrix, centerMatrix, decompose, multiply, unionRects, type Mat, type Rect } from '../../utils/geometry';
import { cloneLayer, createGroup } from './factory';

/** Pure, identity-preserving operations on the layer tree. Unchanged subtrees keep their object identity. */

export function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === 'group') {
      const hit = findLayer(l.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

export function findLayers(layers: Layer[], ids: string[]): Layer[] {
  return ids.map((id) => findLayer(layers, id)).filter((l): l is Layer => !!l);
}

/** Ids of every bitmap in the raster store that these layers reference (paint layers and masks). */
export function collectRasterIds(layers: Layer[], out = new Set<string>()): Set<string> {
  for (const l of layers) {
    if (l.type === 'image') {
      if (l.source.kind === 'raster') out.add(l.source.rasterId);
      for (const m of l.masks) out.add(m.rasterId);
      if (l.fade?.shape) out.add(l.fade.shape.rasterId);
      if (l.fade?.paint) out.add(l.fade.paint.rasterId);
    } else if (l.type === 'group') {
      collectRasterIds(l.children, out);
    }
  }
  return out;
}

/** Every bitmap a document keeps alive: its layers' masks and paint, and its saved selections. */
export function collectDocumentRasterIds(doc: { layers: Layer[]; selections?: { rasterId: string }[] }, out = new Set<string>()): Set<string> {
  collectRasterIds(doc.layers, out);
  for (const saved of doc.selections ?? []) out.add(saved.rasterId);
  return out;
}

export function isTopLevel(layers: Layer[], id: string) {
  return layers.some((l) => l.id === id);
}

export function patchLayer(layer: Layer, patch: LayerPatch): Layer {
  const src = layer as unknown as Record<string, unknown>;
  const p = patch as Record<string, unknown>;
  for (const k in p) {
    if (src[k] !== p[k]) return { ...layer, ...patch } as Layer;
  }
  return layer;
}

export function mapLayers(layers: Layer[], ids: Set<string>, fn: (l: Layer) => Layer): Layer[] {
  let changed = false;
  const out = layers.map((l) => {
    let next = ids.has(l.id) ? fn(l) : l;
    if (next.type === 'group') {
      const kids = mapLayers(next.children, ids, fn);
      if (kids !== next.children) next = { ...next, children: kids };
    }
    if (next !== l) changed = true;
    return next;
  });
  return changed ? out : layers;
}

/** Applies `fn` to every sibling list in the tree (top level and each group's children). */
export function mapLists(layers: Layer[], fn: (list: Layer[]) => Layer[]): Layer[] {
  let changed = false;
  const inner = layers.map((l) => {
    if (l.type !== 'group') return l;
    const kids = mapLists(l.children, fn);
    if (kids === l.children) return l;
    changed = true;
    return { ...l, children: kids };
  });
  const result = fn(changed ? inner : layers);
  return result;
}

export function removeLayers(layers: Layer[], ids: Set<string>): Layer[] {
  return mapLists(layers, (list) => {
    const kept = list.filter((l) => !ids.has(l.id) && !(l.type === 'group' && l.children.length === 0));
    return kept.length === list.length ? list : kept;
  });
}

export function duplicateLayers(layers: Layer[], ids: Set<string>, offset: number) {
  const newIds: string[] = [];
  const next = mapLists(layers, (list) => {
    if (!list.some((l) => ids.has(l.id))) return list;
    return list.flatMap((l) => {
      if (!ids.has(l.id)) return [l];
      const copy = cloneLayer(l, offset, offset);
      copy.name = l.name.endsWith(' copy') ? l.name : `${l.name} copy`;
      newIds.push(copy.id);
      return [l, copy];
    });
  });
  return { layers: next, newIds };
}

/** Folds a leaf layer's scale magnitude into its size so only flips remain in scaleX/scaleY. */
export function bakeScale(layer: Layer): Layer {
  if (layer.type === 'group') return layer;
  const ax = Math.abs(layer.scaleX);
  const ay = Math.abs(layer.scaleY);
  if (Math.abs(ax - 1) < 1e-6 && Math.abs(ay - 1) < 1e-6) return layer;
  const cx = layer.x + layer.width / 2;
  const cy = layer.y + layer.height / 2;
  const width = layer.width * ax;
  const height = layer.height * ay;
  const next = {
    ...layer,
    width,
    height,
    x: cx - width / 2,
    y: cy - height / 2,
    scaleX: Math.sign(layer.scaleX) || 1,
    scaleY: Math.sign(layer.scaleY) || 1,
  };
  if (next.type === 'text') next.fontSize = Math.max(1, Math.round(next.fontSize * ay * 100) / 100);
  return next;
}

export function groupLayers(layers: Layer[], ids: Set<string>): { layers: Layer[]; groupId: string } | null {
  const picked = layers.filter((l) => ids.has(l.id));
  if (picked.length < 2) return null;
  const b = unionRects(picked.map(boxBounds));
  const group = createGroup(
    picked.map((l) => ({ ...l, x: l.x - b.x, y: l.y - b.y })),
    b.x,
    b.y,
    b.width,
    b.height,
  );
  const topIndex = layers.reduce((acc, l, i) => (ids.has(l.id) ? i : acc), -1);
  const out: Layer[] = [];
  layers.forEach((l, i) => {
    if (i === topIndex) out.push(group);
    else if (!ids.has(l.id)) out.push(l);
  });
  return { layers: out, groupId: group.id };
}

function releaseChild(group: GroupLayer, child: Layer): Layer {
  const local = { ...child, x: child.x - group.width / 2, y: child.y - group.height / 2 };
  const d = decompose(multiply(centerMatrix(group), centerMatrix(local)));
  return bakeScale({
    ...child,
    x: d.x - child.width / 2,
    y: d.y - child.height / 2,
    rotation: d.rotation,
    scaleX: d.scaleX,
    scaleY: d.scaleY,
    opacity: child.opacity * group.opacity,
  });
}

export function ungroupLayers(layers: Layer[], ids: Set<string>) {
  const childIds: string[] = [];
  const next = mapLists(layers, (list) => {
    if (!list.some((l) => l.type === 'group' && ids.has(l.id))) return list;
    return list.flatMap((l) => {
      if (l.type !== 'group' || !ids.has(l.id)) return [l];
      const released = l.children.map((c) => releaseChild(l, c));
      childIds.push(...released.map((c) => c.id));
      return released;
    });
  });
  return { layers: next, childIds };
}

export type ReorderDirection = 'forward' | 'backward' | 'front' | 'back';

export function reorderLayers(layers: Layer[], ids: Set<string>, dir: ReorderDirection): Layer[] {
  return mapLists(layers, (list) => {
    if (!list.some((l) => ids.has(l.id))) return list;
    const out = [...list];
    if (dir === 'front' || dir === 'back') {
      const sel = out.filter((l) => ids.has(l.id));
      const rest = out.filter((l) => !ids.has(l.id));
      const merged = dir === 'front' ? [...rest, ...sel] : [...sel, ...rest];
      return merged.every((l, i) => l === list[i]) ? list : merged;
    }
    let changed = false;
    if (dir === 'forward') {
      for (let i = out.length - 2; i >= 0; i--) {
        if (ids.has(out[i].id) && !ids.has(out[i + 1].id)) {
          [out[i], out[i + 1]] = [out[i + 1], out[i]];
          changed = true;
        }
      }
    } else {
      for (let i = 1; i < out.length; i++) {
        if (ids.has(out[i].id) && !ids.has(out[i - 1].id)) {
          [out[i], out[i - 1]] = [out[i - 1], out[i]];
          changed = true;
        }
      }
    }
    return changed ? out : list;
  });
}

/** Moves `dragId` directly above or below `targetId` (z-order) when both share a parent. */
export function moveLayer(layers: Layer[], dragId: string, targetId: string, place: 'above' | 'below'): Layer[] {
  if (dragId === targetId) return layers;
  return mapLists(layers, (list) => {
    const drag = list.find((l) => l.id === dragId);
    if (!drag || !list.some((l) => l.id === targetId)) return list;
    const rest = list.filter((l) => l.id !== dragId);
    const idx = rest.findIndex((l) => l.id === targetId);
    rest.splice(place === 'above' ? idx + 1 : idx, 0, drag);
    return rest.every((l, i) => l === list[i]) ? list : rest;
  });
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignDelta(bounds: Rect, frame: Rect, mode: AlignMode) {
  switch (mode) {
    case 'left':
      return { dx: frame.x - bounds.x, dy: 0 };
    case 'hcenter':
      return { dx: frame.x + frame.width / 2 - (bounds.x + bounds.width / 2), dy: 0 };
    case 'right':
      return { dx: frame.x + frame.width - (bounds.x + bounds.width), dy: 0 };
    case 'top':
      return { dx: 0, dy: frame.y - bounds.y };
    case 'vcenter':
      return { dx: 0, dy: frame.y + frame.height / 2 - (bounds.y + bounds.height / 2) };
    case 'bottom':
      return { dx: 0, dy: frame.y + frame.height - (bounds.y + bounds.height) };
  }
}

/** Equal gaps between the bounds of 3+ layers along one axis. Returns per-layer offsets. */
export function distributeOffsets(items: { id: string; bounds: Rect }[], axis: 'x' | 'y') {
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = [...items].sort((a, b) => a.bounds[axis] - b.bounds[axis]);
  const first = sorted[0].bounds;
  const last = sorted[sorted.length - 1].bounds;
  const total = last[axis] + last[size] - first[axis];
  const used = sorted.reduce((sum, it) => sum + it.bounds[size], 0);
  const gap = (total - used) / (sorted.length - 1);
  const out = new Map<string, number>();
  let cursor = first[axis];
  for (const it of sorted) {
    out.set(it.id, cursor - it.bounds[axis]);
    cursor += it.bounds[size] + gap;
  }
  return out;
}

/** Centre of a layer after resizing it, keeping the visual top-left corner fixed. */
export function resizeFromTopLeft(layer: Layer, width: number, height: number) {
  const m = centerMatrix(layer);
  const topLeft = applyMat(m, -layer.width / 2, -layer.height / 2);
  const offset = applyMat([m[0], m[1], m[2], m[3], 0, 0], width / 2, height / 2);
  return { x: topLeft.x + offset.x - width / 2, y: topLeft.y + offset.y - height / 2, width, height };
}

/** True when the layer has a sibling beneath it, i.e. something it could be clipped to. */
export function hasLayerBelow(layers: Layer[], id: string): boolean {
  const index = layers.findIndex((l) => l.id === id);
  if (index >= 0) return index > 0;
  return layers.some((l) => l.type === 'group' && hasLayerBelow(l.children, id));
}

/** The chain of layers from the top level down to (and including) the layer with this id. */
export function findPath(layers: Layer[], id: string): Layer[] | null {
  for (const l of layers) {
    if (l.id === id) return [l];
    if (l.type === 'group') {
      const rest = findPath(l.children, id);
      if (rest) return [l, ...rest];
    }
  }
  return null;
}

/** Maps a layer's own coordinates (origin at its top-left) to document coordinates, through any parent groups. */
export function layerToDocument(layers: Layer[], id: string): Mat | null {
  const path = findPath(layers, id);
  if (!path) return null;
  return path.reduce<Mat>((m, l) => multiply(m, boxMatrix(l)), [1, 0, 0, 1, 0, 0]);
}
