import { create } from 'zustand';
import { stageRefs } from '../components/canvas/stageRegistry';
import { cloneLayer } from '../features/document/factory';
import { migrateLayers } from '../features/document/migrate';
import { collectRasterIds, findLayers } from '../features/document/operations';
import { useEditorStore } from '../stores/editorStore';
import type { Layer } from '../types/document';
import { boxBounds, unionRects, type Point } from '../utils/geometry';
import { uid } from '../utils/misc';
import { persistRasters } from './rasters';
import { dbDelete, dbGetAll, dbPut } from './storage/db';

/**
 * "My assets": layers the user saved to reuse in any project (a logo lock-up, a styled heading,
 * a badge built from several layers). A saved asset is a copy of the layers themselves, so it
 * comes back fully editable. It is stored in this browser next to the projects.
 */
export interface SavedDesign {
  id: string;
  name: string;
  /** Top-level layers, positioned relative to the top-left of their combined bounds. */
  layers: Layer[];
  width: number;
  height: number;
  thumbnail: string | null;
  createdAt: number;
}

export const useDesignLibrary = create<{ items: SavedDesign[]; loaded: boolean }>(() => ({ items: [], loaded: false }));

export async function refreshDesignLibrary() {
  const items = (await dbGetAll<SavedDesign>('library')).map((d) => ({ ...d, layers: migrateLayers(d.layers) }));
  useDesignLibrary.setState({ items: items.sort((a, b) => b.createdAt - a.createdAt), loaded: true });
}

/** A small picture of the given layers as they look on the canvas now. */
function thumbnailOf(ids: string[], maxSide = 240): string | null {
  const { stage, viewport } = stageRefs;
  if (!stage || !viewport) return null;
  const view = { x: viewport.x(), y: viewport.y(), scaleX: viewport.scaleX(), scaleY: viewport.scaleY() };
  try {
    viewport.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
    const parts = ids
      .map((id) => stage.findOne(`#${id}`))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map((node) => ({ node, rect: node.getClientRect() }))
      .filter((p) => p.rect.width > 0 && p.rect.height > 0);
    if (!parts.length) return null;
    const all = unionRects(parts.map((p) => p.rect));
    const k = Math.min(1, maxSide / Math.max(all.width, all.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(all.width * k));
    canvas.height = Math.max(1, Math.round(all.height * k));
    const ctx = canvas.getContext('2d')!;
    for (const { node, rect } of parts) {
      ctx.drawImage(node.toCanvas({ pixelRatio: k }), (Math.floor(rect.x) - all.x) * k, (Math.floor(rect.y) - all.y) * k);
    }
    return canvas.toDataURL('image/webp', 0.85);
  } catch {
    return null;
  } finally {
    viewport.setAttrs(view);
  }
}

/** Saves the selected layers as a reusable asset. Returns null when nothing is selected. */
export async function saveSelectionToLibrary(name?: string): Promise<SavedDesign | null> {
  const { doc, selectedIds } = useEditorStore.getState();
  // Keep the canvas stacking order, whatever order the layers were clicked in.
  const picked = findLayers(doc.layers, selectedIds);
  const selected = doc.layers.filter((l) => picked.includes(l)).concat(picked.filter((l) => !doc.layers.includes(l)));
  if (!selected.length) return null;
  const bounds = unionRects(selected.map((l) => boxBounds(l)));
  // Bitmaps used by masks and paint layers must outlive the project they were made in.
  await persistRasters(collectRasterIds(selected));
  const design: SavedDesign = {
    id: uid('d'),
    name: name?.trim() || (selected.length === 1 ? selected[0].name : `${selected.length} layers`),
    layers: selected.map((l) => ({ ...cloneLayer(l), x: l.x - bounds.x, y: l.y - bounds.y, clip: selected.indexOf(l) === 0 ? false : l.clip })),
    width: bounds.width,
    height: bounds.height,
    thumbnail: thumbnailOf(selected.map((l) => l.id)),
    createdAt: Date.now(),
  };
  await dbPut('library', design);
  await refreshDesignLibrary();
  return design;
}

/** Puts a fresh, independent copy of a saved asset on the canvas and selects it. */
export function insertSavedDesign(id: string, at?: Point) {
  const design = useDesignLibrary.getState().items.find((d) => d.id === id);
  if (!design) return false;
  const editor = useEditorStore.getState();
  const { width: W, height: H } = editor.doc;
  const cx = at?.x ?? W / 2;
  const cy = at?.y ?? H / 2;
  const copies = design.layers.map((l) => cloneLayer(l, Math.round(cx - design.width / 2), Math.round(cy - design.height / 2)));
  editor.addLayers(copies);
  editor.select(copies.map((l) => l.id));
  return true;
}

export async function deleteSavedDesign(id: string) {
  await dbDelete('library', id);
  await refreshDesignLibrary();
}

export async function renameSavedDesign(id: string, name: string) {
  const design = useDesignLibrary.getState().items.find((d) => d.id === id);
  if (!design || !name.trim()) return;
  await dbPut('library', { ...design, name: name.trim() });
  await refreshDesignLibrary();
}
