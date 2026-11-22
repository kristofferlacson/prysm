import { useEffect, useReducer } from 'react';
import { uid } from '../utils/misc';
import { dbDelete, dbGet, dbKeys, dbPut } from './storage/db';

/**
 * Store for document-owned bitmaps: layer masks and paint layers.
 *
 * Rasters are immutable. Editing one (a brush stroke, an invert) registers a new raster and the
 * document switches to its id, which is what makes pixel edits undoable without copying pixels
 * into the document. Each raster is also encoded to PNG so that:
 *  - old undo states can drop their canvas from memory and be decoded again on demand, and
 *  - rasters referenced by a saved project can be written to IndexedDB.
 */

interface RasterRecord {
  id: string;
  width: number;
  height: number;
  blob: Blob;
}

interface Entry {
  id: string;
  width: number;
  height: number;
  canvas: HTMLCanvasElement | null;
  blob: Blob | null;
  encoding: Promise<Blob | null> | null;
  persisted: boolean;
  used: number;
}

/** Decoded canvases kept in memory, in pixels (~4 bytes each). Pinned rasters do not count against eviction. */
const MEMORY_BUDGET_PX = 48_000_000;

const entries = new Map<string, Entry>();
const loading = new Map<string, Promise<HTMLCanvasElement | null>>();
const missing = new Set<string>();
const thumbs = new Map<string, string>();
let pinned = new Set<string>();
let clock = 0;

function encode(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function trim() {
  let total = 0;
  for (const e of entries.values()) if (e.canvas) total += e.width * e.height;
  if (total <= MEMORY_BUDGET_PX) return;
  const evictable = [...entries.values()]
    .filter((e) => e.canvas && e.blob && !pinned.has(e.id))
    .sort((a, b) => a.used - b.used);
  for (const e of evictable) {
    if (total <= MEMORY_BUDGET_PX) break;
    e.canvas = null;
    total -= e.width * e.height;
  }
}

/** Registers a finished canvas as a new raster. The canvas must not be modified afterwards. */
export function putRaster(canvas: HTMLCanvasElement): string {
  const entry: Entry = {
    id: uid('r'),
    width: canvas.width,
    height: canvas.height,
    canvas,
    blob: null,
    encoding: null,
    persisted: false,
    used: ++clock,
  };
  entry.encoding = encode(canvas).then((blob) => {
    entry.blob = blob;
    entry.encoding = null;
    trim();
    return blob;
  });
  entries.set(entry.id, entry);
  return entry.id;
}

/** The decoded canvas if it is in memory right now. */
export function getRaster(id: string): HTMLCanvasElement | null {
  const entry = entries.get(id);
  if (!entry?.canvas) return null;
  entry.used = ++clock;
  return entry.canvas;
}

async function decode(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/** Resolves a raster to a canvas, decoding it from memory or loading it from storage when needed. */
export function loadRaster(id: string): Promise<HTMLCanvasElement | null> {
  const ready = getRaster(id);
  if (ready) return Promise.resolve(ready);
  let p = loading.get(id);
  if (!p) {
    p = (async () => {
      try {
        let entry = entries.get(id);
        let blob = entry?.blob ?? (entry?.encoding ? await entry.encoding : null);
        if (!blob) {
          const rec = await dbGet<RasterRecord>('rasters', id);
          if (!rec) {
            missing.add(id);
            return null;
          }
          blob = rec.blob;
          entry = { id, width: rec.width, height: rec.height, canvas: null, blob, encoding: null, persisted: true, used: 0 };
          entries.set(id, entry);
        }
        const canvas = await decode(blob);
        entry = entries.get(id)!;
        entry.canvas = canvas;
        entry.used = ++clock;
        trim();
        return canvas;
      } catch {
        missing.add(id);
        return null;
      } finally {
        loading.delete(id);
      }
    })();
    loading.set(id, p);
  }
  return p;
}

/** Rasters the open document uses. They are never evicted from memory. */
export function pinRasters(ids: Iterable<string>) {
  pinned = new Set(ids);
}

/** Writes the given rasters to IndexedDB (once each). Called before a project that references them is saved. */
export async function persistRasters(ids: Iterable<string>) {
  for (const id of ids) {
    const entry = entries.get(id);
    if (!entry || entry.persisted) continue;
    const blob = entry.blob ?? (entry.encoding ? await entry.encoding : null);
    if (!blob) throw new Error('A layer bitmap could not be encoded for saving.');
    await dbPut<RasterRecord>('rasters', { id, width: entry.width, height: entry.height, blob });
    entry.persisted = true;
  }
}

/** Deletes stored rasters that no saved project references. In-memory copies (undo history) are unaffected. */
export async function collectGarbage(referenced: Set<string>) {
  const keys = (await dbKeys('rasters')) as string[];
  let removed = 0;
  for (const id of keys) {
    if (referenced.has(id)) continue;
    await dbDelete('rasters', id);
    const entry = entries.get(id);
    if (entry) entry.persisted = false;
    removed++;
  }
  return removed;
}

/** Small data-URL preview. Masks are shown as greyscale (white = reveal) on black. */
export function rasterThumbnail(id: string, kind: 'mask' | 'image', size = 56): string | null {
  const key = `${id}:${kind}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  const canvas = getRaster(id);
  if (!canvas) return null;
  const k = size / Math.max(canvas.width, canvas.height);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * k));
  out.height = Math.max(1, Math.round(canvas.height * k));
  const ctx = out.getContext('2d')!;
  if (kind === 'mask') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  const url = out.toDataURL('image/png');
  thumbs.set(key, url);
  if (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!);
  return url;
}

export type RasterState = { canvas: HTMLCanvasElement | null; status: 'loading' | 'ready' | 'missing' };

const stateOf = (id: string): RasterState => {
  const canvas = getRaster(id);
  return { canvas, status: canvas ? 'ready' : missing.has(id) ? 'missing' : 'loading' };
};

/** Resolves raster ids to canvases, loading any that are not in memory and re-rendering when they arrive. */
export function useRasters(ids: string[]): RasterState[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const key = ids.join(',');
  useEffect(() => {
    let live = true;
    for (const id of ids) {
      if (!getRaster(id) && !missing.has(id)) void loadRaster(id).then(() => live && bump());
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ids.map(stateOf);
}

export function useRaster(id: string | null): RasterState {
  return useRasters(id ? [id] : [])[0] ?? { canvas: null, status: 'missing' };
}
