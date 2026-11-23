import { useEffect } from 'react';
import { createDocument } from '../document/factory';
import { collectDocumentRasterIds } from '../document/operations';
import { collectGarbage, persistRasters, pinRasters } from '../../services/rasters';
import { deleteAsset, refreshAssetLibrary, useAssetLibrary } from '../../services/assets';
import { renderThumbnail } from '../../services/export';
import { projectRepository } from '../../services/storage/projectRepository';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { ProjectDocument } from '../../types/document';
import { uid } from '../../utils/misc';

const LAST_PROJECT_KEY = 'prysm:last-project';
const AUTOSAVE_DELAY_MS = 700;

let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();

/** Persists the open document now (and its thumbnail). Saves are serialised so they never interleave. */
export function saveNow(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const doc = useEditorStore.getState().doc;
  useUiStore.getState().set({ saveStatus: 'saving' });
  saving = saving.then(async () => {
    try {
      // Only capture a thumbnail when the canvas still shows the document being saved.
      const current = useEditorStore.getState().doc.id === doc.id;
      // Mask and paint bitmaps must be on disk before a document that points at them.
      await persistRasters(collectDocumentRasterIds(doc));
      await projectRepository.save(doc, current ? await renderThumbnail() : null);
      localStorage.setItem(LAST_PROJECT_KEY, useEditorStore.getState().doc.id);
      if (useEditorStore.getState().doc === doc) useUiStore.getState().set({ saveStatus: 'saved' });
    } catch (err) {
      console.error('Saving failed', err);
      useUiStore.getState().set({ saveStatus: 'error' });
    }
  });
  return saving;
}

function scheduleSave() {
  useUiStore.getState().set({ saveStatus: 'unsaved' });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
}

async function flushPending() {
  if (timer) await saveNow();
  await saving;
}

export async function openProject(id: string): Promise<boolean> {
  await flushPending();
  const doc = await projectRepository.load(id);
  if (!doc) return false;
  pinRasters(collectDocumentRasterIds(doc));
  useEditorStore.getState().loadDocument(doc);
  localStorage.setItem(LAST_PROJECT_KEY, id);
  useUiStore.getState().set({
    saveStatus: 'saved',
    editingTextId: null,
    maskEditLayerId: null,
    fadePaintLayerId: null,
    maskViewLayerId: null,
    maskBypassLayerId: null,
  });
  return true;
}

export async function newProject(name: string, width: number, height: number) {
  await flushPending();
  const doc = createDocument(name, width, height);
  useEditorStore.getState().loadDocument(doc);
  await saveNow();
}

export async function duplicateProject(id: string) {
  await flushPending();
  const doc = await projectRepository.load(id);
  if (!doc) return;
  const copy: ProjectDocument = { ...doc, id: uid('p'), name: `${doc.name} copy`, createdAt: Date.now() };
  const source = (await projectRepository.list()).find((p) => p.id === id);
  await projectRepository.save(copy, source?.thumbnail ?? null);
}

export async function renameProject(id: string, name: string) {
  if (useEditorStore.getState().doc.id === id) {
    useEditorStore.getState().setDocument({ name });
    await saveNow();
    return;
  }
  const doc = await projectRepository.load(id);
  if (doc) await projectRepository.save({ ...doc, name }, null);
}

/** Deletes a project. If it was open, the most recent remaining project (or a blank one) takes its place. */
export async function deleteProject(id: string) {
  await flushPending();
  await projectRepository.remove(id);
  if (useEditorStore.getState().doc.id === id) {
    const [next] = await projectRepository.list();
    if (!next || !(await openProject(next.id))) await newProject('Untitled design', 1080, 1080);
  }
  await removeUnusedRasters();
}

/** Deletes stored mask / paint bitmaps that no saved project references any more. */
export function removeUnusedRasters(): Promise<number> {
  if (timer) void saveNow();
  // Runs in the save queue: a save writes bitmaps before the document that references them,
  // so collecting between those two steps would delete bitmaps that are about to be needed.
  const run = saving.then(async () => collectGarbage(await projectRepository.referencedRasterIds()));
  saving = run.then(
    () => {},
    () => {},
  );
  return run;
}

/** Removes uploaded images that no saved project references any more. */
export async function removeUnusedAssets() {
  await flushPending();
  const used = await projectRepository.referencedAssetIds();
  const unused = useAssetLibrary.getState().assets.filter((a) => !used.has(a.id));
  for (const asset of unused) await deleteAsset(asset.id);
  return unused.length;
}

/** Restores the last open project on startup and autosaves every document change afterwards. */
export function useProjectPersistence(onReady: () => void) {
  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    (async () => {
      void refreshAssetLibrary();
      const last = localStorage.getItem(LAST_PROJECT_KEY);
      const restored = last ? await openProject(last).catch(() => false) : false;
      if (cancelled) return;
      if (!restored) {
        const [recent] = await projectRepository.list().catch(() => []);
        if (!recent || !(await openProject(recent.id))) {
          useEditorStore.getState().loadDocument(createDocument('Untitled design', 1080, 1080));
          await saveNow();
        }
      }
      if (cancelled) return;
      // Bitmaps left behind by earlier sessions' undo history are no longer reachable.
      void removeUnusedRasters().catch(() => {});
      unsubscribe = useEditorStore.subscribe((state, prev) => {
        if (state.doc === prev.doc) return;
        if (state.doc.layers !== prev.doc.layers || state.doc.selections !== prev.doc.selections) pinRasters(collectDocumentRasterIds(state.doc));
        scheduleSave();
      });
      onReady();
    })();

    const flush = () => {
      if (timer) void saveNow();
    };
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
