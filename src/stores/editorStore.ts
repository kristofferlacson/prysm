import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { CropInsets, Fill, ImageLayer, Layer, LayerPatch, ProjectDocument } from '../types/document';
import { cloneLayer, createDocument } from '../features/document/factory';
import {
  alignDelta,
  distributeOffsets,
  duplicateLayers,
  findLayer,
  findLayers,
  groupLayers,
  isTopLevel,
  mapLayers,
  moveLayer,
  patchLayer,
  removeLayers,
  reorderLayers,
  ungroupLayers,
  type AlignMode,
  type ReorderDirection,
} from '../features/document/operations';
import { boxBounds, deg2rad, unionRects } from '../utils/geometry';

const HISTORY_LIMIT = 100;
const COALESCE_WINDOW_MS = 800;

interface HistoryEntry {
  doc: ProjectDocument;
  selectedIds: string[];
}

export interface CommitOptions {
  /** Consecutive commits with the same key inside a short window collapse into one undo step. */
  coalesce?: string;
  /** false = apply without creating an undo step (derived values such as measured text height). */
  history?: boolean;
  /** Fold this change into the previous undo step regardless of timing (e.g. a layer created for a stroke). */
  amend?: boolean;
}

type PatchInput = LayerPatch | ((layer: Layer) => LayerPatch);

interface EditorState {
  doc: ProjectDocument;
  selectedIds: string[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  clipboard: Layer[];
  lastKey: string | null;
  lastTime: number;

  loadDocument: (doc: ProjectDocument) => void;
  commit: (recipe: (doc: ProjectDocument) => ProjectDocument, opts?: CommitOptions, selectedIds?: string[]) => void;
  setDocument: (patch: Partial<Pick<ProjectDocument, 'name' | 'width' | 'height' | 'background'>>, opts?: CommitOptions) => void;
  replaceContent: (content: { width: number; height: number; background: Fill | null; layers: Layer[] }) => void;

  addLayers: (layers: Layer[], opts?: { atBottom?: boolean }) => void;
  updateLayers: (ids: string[], patch: PatchInput, opts?: CommitOptions) => void;
  updateEach: (patches: Map<string, LayerPatch>, opts?: CommitOptions) => void;
  deleteLayers: (ids: string[]) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  cutSelected: () => void;
  paste: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  reorderSelected: (dir: ReorderDirection) => void;
  moveLayer: (dragId: string, targetId: string, place: 'above' | 'below') => void;
  alignSelected: (mode: AlignMode) => void;
  distributeSelected: (axis: 'x' | 'y') => void;
  nudgeSelected: (dx: number, dy: number) => void;
  flipSelected: (axis: 'x' | 'y') => void;
  setCrop: (id: string, crop: CropInsets) => void;

  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  undo: () => void;
  redo: () => void;
}

export const useEditorStore = create<EditorState>()((set, get) => {
  const commit: EditorState['commit'] = (recipe, opts = {}, selectedIds) => {
    const s = get();
    const next = recipe(s.doc);
    const selection = selectedIds ? { selectedIds } : {};
    if (next === s.doc) {
      if (selectedIds) set(selection);
      return;
    }
    if (opts.history === false) {
      set({ doc: next, ...selection });
      return;
    }
    const now = Date.now();
    const merge =
      s.past.length > 0 &&
      (opts.amend || (!!opts.coalesce && s.lastKey === opts.coalesce && now - s.lastTime < COALESCE_WINDOW_MS));
    set({
      doc: next,
      past: merge ? s.past : [...s.past.slice(-(HISTORY_LIMIT - 1)), { doc: s.doc, selectedIds: s.selectedIds }],
      future: [],
      lastKey: opts.coalesce ?? null,
      lastTime: now,
      ...selection,
    });
  };

  const withLayers = (fn: (layers: Layer[]) => Layer[]) => (doc: ProjectDocument) => {
    const layers = fn(doc.layers);
    return layers === doc.layers ? doc : { ...doc, layers };
  };

  const selectedTopLevel = () => {
    const { doc, selectedIds } = get();
    return doc.layers.filter((l) => selectedIds.includes(l.id));
  };

  return {
    doc: createDocument('Untitled design', 1080, 1080),
    selectedIds: [],
    past: [],
    future: [],
    clipboard: [],
    lastKey: null,
    lastTime: 0,

    loadDocument: (doc) => set({ doc, selectedIds: [], past: [], future: [], lastKey: null }),
    commit,

    setDocument: (patch, opts) => commit((doc) => ({ ...doc, ...patch }), opts),

    replaceContent: (content) =>
      commit((doc) => ({ ...doc, ...content, layers: content.layers.map((l) => cloneLayer(l)) }), {}, []),

    addLayers: (layers, opts) => {
      if (!layers.length) return;
      commit(
        withLayers((list) => (opts?.atBottom ? [...layers, ...list] : [...list, ...layers])),
        {},
        layers.map((l) => l.id),
      );
    },

    updateLayers: (ids, patch, opts) => {
      if (!ids.length) return;
      const key = opts?.coalesce ? `${opts.coalesce}:${ids.join(',')}` : undefined;
      commit(
        withLayers((layers) =>
          mapLayers(layers, new Set(ids), (l) => patchLayer(l, typeof patch === 'function' ? patch(l) : patch)),
        ),
        { ...opts, coalesce: key },
      );
    },

    updateEach: (patches, opts) => {
      if (!patches.size) return;
      commit(
        withLayers((layers) => mapLayers(layers, new Set(patches.keys()), (l) => patchLayer(l, patches.get(l.id)!))),
        opts,
      );
    },

    deleteLayers: (ids) => {
      const remove = new Set(ids);
      commit(
        withLayers((layers) => removeLayers(layers, remove)),
        {},
        get().selectedIds.filter((id) => !remove.has(id)),
      );
    },

    deleteSelected: () => get().deleteLayers(get().selectedIds),

    duplicateSelected: () => {
      const { doc, selectedIds } = get();
      if (!selectedIds.length) return;
      const result = duplicateLayers(doc.layers, new Set(selectedIds), 24);
      commit(() => ({ ...doc, layers: result.layers }), {}, result.newIds);
    },

    copySelected: () => {
      const { doc, selectedIds } = get();
      const layers = findLayers(doc.layers, selectedIds);
      if (layers.length) set({ clipboard: layers });
    },

    cutSelected: () => {
      get().copySelected();
      get().deleteSelected();
    },

    paste: () => {
      const { clipboard } = get();
      if (!clipboard.length) return;
      const copies = clipboard.map((l) => cloneLayer(l, 24, 24));
      // Offset the clipboard itself so repeated pastes cascade.
      set({ clipboard: clipboard.map((l) => ({ ...l, x: l.x + 24, y: l.y + 24 })) });
      get().addLayers(copies);
    },

    groupSelected: () => {
      const { doc, selectedIds } = get();
      const result = groupLayers(doc.layers, new Set(selectedIds));
      if (result) commit(() => ({ ...doc, layers: result.layers }), {}, [result.groupId]);
    },

    ungroupSelected: () => {
      const { doc, selectedIds } = get();
      const result = ungroupLayers(doc.layers, new Set(selectedIds));
      if (result.childIds.length) commit(() => ({ ...doc, layers: result.layers }), {}, result.childIds);
    },

    reorderSelected: (dir) => commit(withLayers((layers) => reorderLayers(layers, new Set(get().selectedIds), dir))),

    moveLayer: (dragId, targetId, place) => commit(withLayers((layers) => moveLayer(layers, dragId, targetId, place))),

    alignSelected: (mode) => {
      const { doc } = get();
      const layers = selectedTopLevel();
      if (!layers.length) return;
      const frame =
        layers.length === 1
          ? { x: 0, y: 0, width: doc.width, height: doc.height }
          : unionRects(layers.map(boxBounds));
      const patches = new Map<string, LayerPatch>();
      for (const l of layers) {
        const { dx, dy } = alignDelta(boxBounds(l), frame, mode);
        patches.set(l.id, { x: l.x + dx, y: l.y + dy });
      }
      get().updateEach(patches);
    },

    distributeSelected: (axis) => {
      const layers = selectedTopLevel();
      if (layers.length < 3) return;
      const offsets = distributeOffsets(
        layers.map((l) => ({ id: l.id, bounds: boxBounds(l) })),
        axis,
      );
      const patches = new Map<string, LayerPatch>();
      for (const l of layers) patches.set(l.id, { [axis]: l[axis] + (offsets.get(l.id) ?? 0) });
      get().updateEach(patches);
    },

    nudgeSelected: (dx, dy) => {
      const { doc, selectedIds } = get();
      const ids = findLayers(doc.layers, selectedIds)
        .filter((l) => !l.locked)
        .map((l) => l.id);
      get().updateLayers(ids, (l) => ({ x: l.x + dx, y: l.y + dy }), { coalesce: 'nudge' });
    },

    flipSelected: (axis) =>
      get().updateLayers(get().selectedIds, (l) => (axis === 'x' ? { scaleX: -l.scaleX } : { scaleY: -l.scaleY })),

    setCrop: (id, crop) => {
      const layer = findLayer(get().doc.layers, id);
      if (!layer || layer.type !== 'image') return;
      const old = layer.crop;
      const fullW = layer.width / (1 - old.left - old.right);
      const fullH = layer.height / (1 - old.top - old.bottom);
      const width = fullW * (1 - crop.left - crop.right);
      const height = fullH * (1 - crop.top - crop.bottom);
      // Keep the remaining pixels where they were: shift the box centre in the layer's own axes.
      const lx = (fullW * (crop.left - old.left - (crop.right - old.right))) / 2;
      const ly = (fullH * (crop.top - old.top - (crop.bottom - old.bottom))) / 2;
      const r = deg2rad(layer.rotation);
      const sx = lx * layer.scaleX;
      const sy = ly * layer.scaleY;
      const cx = layer.x + layer.width / 2 + sx * Math.cos(r) - sy * Math.sin(r);
      const cy = layer.y + layer.height / 2 + sx * Math.sin(r) + sy * Math.cos(r);
      const patch: Partial<ImageLayer> = { crop, width, height, x: cx - width / 2, y: cy - height / 2 };
      get().updateLayers([id], patch, { coalesce: 'crop' });
    },

    select: (ids) => set({ selectedIds: ids }),
    toggleSelect: (id) =>
      set((s) => ({
        selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id],
      })),
    selectAll: () => set((s) => ({ selectedIds: s.doc.layers.filter((l) => l.visible && !l.locked).map((l) => l.id) })),
    clearSelection: () => set((s) => (s.selectedIds.length ? { selectedIds: [] } : s)),

    undo: () => {
      const s = get();
      const entry = s.past[s.past.length - 1];
      if (!entry) return;
      set({
        doc: entry.doc,
        selectedIds: entry.selectedIds.filter((id) => findLayer(entry.doc.layers, id)),
        past: s.past.slice(0, -1),
        future: [...s.future, { doc: s.doc, selectedIds: s.selectedIds }],
        lastKey: null,
      });
    },

    redo: () => {
      const s = get();
      const entry = s.future[s.future.length - 1];
      if (!entry) return;
      set({
        doc: entry.doc,
        selectedIds: entry.selectedIds.filter((id) => findLayer(entry.doc.layers, id)),
        past: [...s.past, { doc: s.doc, selectedIds: s.selectedIds }],
        future: s.future.slice(0, -1),
        lastKey: null,
      });
    },
  };
});

/** Layers currently selected, in selection order. */
export function useSelectedLayers(): Layer[] {
  return useEditorStore(useShallow((s) => findLayers(s.doc.layers, s.selectedIds)));
}

export function canGroup(doc: ProjectDocument, selectedIds: string[]) {
  return selectedIds.length > 1 && selectedIds.every((id) => isTopLevel(doc.layers, id));
}

export function canUngroup(doc: ProjectDocument, selectedIds: string[]) {
  return findLayers(doc.layers, selectedIds).some((l) => l.type === 'group');
}
