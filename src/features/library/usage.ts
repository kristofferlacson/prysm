import { create } from 'zustand';
import { getGenerator } from '../generators/render';
import { getGraphic } from './graphics';
import { getIcon } from './icons';

/**
 * One description of every library asset, whatever draws it, plus what the user did with it:
 * favourites and recently used. Assets are identified by a stable id ('texture/grunge',
 * 'sticker/heart', 'icon/star'), which is also what documents store.
 */
export type AssetKind = 'texture' | 'overlay' | 'background' | 'graphic' | 'icon';

export interface AssetInfo {
  id: string;
  name: string;
  category: string;
  kind: AssetKind;
  /** How the asset is made, which is also why it can be redistributed. */
  source: string;
  licence: string;
}

const OWN = { source: 'Drawn by code in this project', licence: 'Original work, no third-party rights' };
const LUCIDE = { source: 'Lucide icon set (lucide.dev)', licence: 'ISC License, © Lucide Icons and Contributors' };

export const iconAssetId = (name: string) => `icon/${name}`;

export function assetInfo(id: string): AssetInfo | null {
  if (id.startsWith('icon/')) {
    const icon = getIcon(id.slice(5));
    return icon ? { id, name: icon.label, category: icon.category, kind: 'icon', ...LUCIDE } : null;
  }
  const generator = getGenerator(id);
  if (generator) return { id, name: generator.name, category: generator.category, kind: generator.kind, ...OWN };
  const graphic = getGraphic(id);
  return graphic ? { id, name: graphic.name, category: graphic.category, kind: 'graphic', ...OWN } : null;
}

/** Tooltip text for a tile: what it is, where it comes from, how to use it. */
export function assetTitle(id: string, fallback: string) {
  const info = assetInfo(id);
  return info ? `${info.name} — ${info.category}\n${info.licence}\nClick to add, or drag onto the canvas` : fallback;
}

const KEY = 'prysm.library';
const MAX_RECENT = 18;

function load(): { recent: string[]; favourites: string[] } {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { recent: list(stored.recent), favourites: list(stored.favourites) };
  } catch {
    return { recent: [], favourites: [] };
  }
}

export const useLibraryUsage = create<{ recent: string[]; favourites: string[] }>(() => load());

function store(next: { recent: string[]; favourites: string[] }) {
  useLibraryUsage.setState(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing: kept for this visit only.
  }
}

/** Notes that an asset was just put on the canvas. Most recent first. */
export function recordUse(id: string) {
  const s = useLibraryUsage.getState();
  store({ ...s, recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, MAX_RECENT) });
}

export function toggleFavourite(id: string) {
  const s = useLibraryUsage.getState();
  store({ ...s, favourites: s.favourites.includes(id) ? s.favourites.filter((f) => f !== id) : [id, ...s.favourites] });
}
