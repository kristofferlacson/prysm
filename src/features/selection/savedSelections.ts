import { loadRaster, putRaster } from '../../services/rasters';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { SavedSelection } from '../../types/document';
import { uid } from '../../utils/misc';
import { combineSelection, selectionGrid, useAreaSelection, type SelectionMode } from './selectionStore';

/**
 * Saved selections: named copies of a selection kept with the project (like an alpha channel).
 * Saving, renaming and deleting one are ordinary undoable document changes; loading one only
 * changes the current selection.
 */

const notify = (text: string) => useUiStore.getState().notify(text);

function copyOf(source: HTMLCanvasElement, width = source.width, height = source.height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Stores the current selection in the project. Returns its id, or null when nothing is selected. */
export function saveCurrentSelection(): string | null {
  const { mask } = useAreaSelection.getState();
  if (!mask) {
    notify('Nothing is selected. Draw a selection first.');
    return null;
  }
  const editor = useEditorStore.getState();
  const taken = new Set(editor.doc.selections.map((s) => s.name));
  let n = editor.doc.selections.length + 1;
  while (taken.has(`Selection ${n}`)) n++;
  const saved: SavedSelection = { id: uid('s'), name: `Selection ${n}`, rasterId: putRaster(copyOf(mask)), width: mask.width, height: mask.height };
  editor.commit((doc) => ({ ...doc, selections: [...doc.selections, saved] }));
  return saved.id;
}

/** Makes a saved selection the current one, or combines it with the current one. */
export async function loadSavedSelection(id: string, mode: SelectionMode = 'new') {
  const saved = useEditorStore.getState().doc.selections.find((s) => s.id === id);
  if (!saved) return false;
  const raster = await loadRaster(saved.rasterId);
  if (!raster) {
    notify('That saved selection could not be loaded.');
    return false;
  }
  // It was saved for the canvas as it was then; if the canvas has been resized since, it is stretched to fit.
  const grid = selectionGrid();
  combineSelection(copyOf(raster, grid.width, grid.height), mode);
  return true;
}

export function renameSavedSelection(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  useEditorStore.getState().commit(
    (doc) => (doc.selections.some((s) => s.id === id && s.name !== trimmed) ? { ...doc, selections: doc.selections.map((s) => (s.id === id ? { ...s, name: trimmed } : s)) } : doc),
    { coalesce: `rename-selection:${id}` },
  );
}

export function deleteSavedSelection(id: string) {
  useEditorStore.getState().commit((doc) => ({ ...doc, selections: doc.selections.filter((s) => s.id !== id) }));
}
