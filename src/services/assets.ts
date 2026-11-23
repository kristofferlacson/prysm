import { useEffect, useReducer } from 'react';
import { create } from 'zustand';
import { uid } from '../utils/misc';
import { dbDelete, dbGet, dbGetAll, dbPut } from './storage/db';

/** Uploaded images: originals are stored untouched as blobs and referenced from documents by id. */

export interface AssetRecord {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  createdAt: number;
  blob: Blob;
}

export type AssetMeta = Omit<AssetRecord, 'blob'> & { url: string };

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

const images = new Map<string, HTMLImageElement>();
const urls = new Map<string, string>();
const loading = new Map<string, Promise<HTMLImageElement | null>>();
const missing = new Set<string>();

interface AssetLibraryState {
  assets: AssetMeta[];
  loaded: boolean;
}
export const useAssetLibrary = create<AssetLibraryState>()(() => ({ assets: [], loaded: false }));

async function decode(blob: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return { img, url };
}

function register(rec: AssetRecord, img: HTMLImageElement, url: string): AssetMeta {
  images.set(rec.id, img);
  urls.set(rec.id, url);
  const { blob: _blob, ...meta } = rec;
  return { ...meta, url };
}

export const imageSize = (img: HTMLImageElement) => ({
  width: img.naturalWidth || img.width || 512,
  height: img.naturalHeight || img.height || 512,
});

export const getAssetUrl = (id: string) => urls.get(id) ?? null;

/** The decoded image for an asset, if it has been loaded already. */
export const getAssetImage = (id: string) => images.get(id) ?? null;

export async function importImageFile(file: File): Promise<AssetMeta> {
  const mime = file.type || (file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '');
  if (!ACCEPTED_IMAGE_TYPES.includes(mime)) throw new Error(`Unsupported file type: ${file.name}`);
  return importImageBlob(file, file.name.replace(/\.[^.]+$/, '') || 'Image', mime);
}

/** Stores image data produced inside the editor (for example a layer with its mask applied) as a new asset. */
export async function importImageBlob(blob: Blob, name: string, mime = blob.type): Promise<AssetMeta> {
  const { img, url } = await decode(blob);
  const rec: AssetRecord = {
    id: uid('a'),
    name,
    mime,
    ...imageSize(img),
    createdAt: Date.now(),
    blob,
  };
  await dbPut('assets', rec);
  const meta = register(rec, img, url);
  useAssetLibrary.setState((s) => ({ assets: [meta, ...s.assets] }));
  return meta;
}

export function loadAssetImage(id: string): Promise<HTMLImageElement | null> {
  const cached = images.get(id);
  if (cached) return Promise.resolve(cached);
  let p = loading.get(id);
  if (!p) {
    p = (async () => {
      try {
        const rec = await dbGet<AssetRecord>('assets', id);
        if (!rec) {
          missing.add(id);
          return null;
        }
        const { img, url } = await decode(rec.blob);
        register(rec, img, url);
        return img;
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

export async function refreshAssetLibrary() {
  const records = await dbGetAll<AssetRecord>('assets');
  const metas: AssetMeta[] = [];
  for (const rec of records.sort((a, b) => b.createdAt - a.createdAt)) {
    let url = urls.get(rec.id);
    if (!url) {
      url = URL.createObjectURL(rec.blob);
      urls.set(rec.id, url);
    }
    const { blob: _blob, ...meta } = rec;
    metas.push({ ...meta, url });
  }
  useAssetLibrary.setState({ assets: metas, loaded: true });
}

export async function deleteAsset(id: string) {
  await dbDelete('assets', id);
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  images.delete(id);
  useAssetLibrary.setState((s) => ({ assets: s.assets.filter((a) => a.id !== id) }));
}

export type AssetImageState = { image: HTMLImageElement | null; status: 'loading' | 'ready' | 'missing' };

/** Resolves an asset id to a decoded image, loading it from storage on first use. */
export function useAssetImage(id: string | null): AssetImageState {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!id || images.has(id) || missing.has(id)) return;
    let live = true;
    loadAssetImage(id).then(() => live && bump());
    return () => {
      live = false;
    };
  }, [id]);
  const image = id ? (images.get(id) ?? null) : null;
  return { image, status: image ? 'ready' : id && missing.has(id) ? 'missing' : 'loading' };
}
