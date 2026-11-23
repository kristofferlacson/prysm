import { create } from 'zustand';
import { useUiStore } from '../stores/uiStore';
import { dbDelete, dbGetAll, dbPut } from './storage/db';

export type FontCategory = 'Sans' | 'Serif' | 'Display' | 'Handwriting' | 'Mono' | 'Decorative' | 'Uploaded';

export interface FontDef {
  family: string;
  category: FontCategory;
  weights: number[];
  /** 'google' fonts are fetched from Google Fonts on first use; 'system' fonts ship with the OS; 'uploaded' ones were added by the user. */
  source: 'google' | 'system' | 'uploaded';
}

const g = (family: string, category: FontCategory, weights: number[] = [400]): FontDef => ({
  family,
  category,
  weights,
  source: 'google',
});
const sys = (family: string, category: FontCategory): FontDef => ({
  family,
  category,
  weights: [400, 700],
  source: 'system',
});

export const FONTS: FontDef[] = [
  g('Inter', 'Sans', [400, 500, 600, 700, 800, 900]),
  g('Roboto', 'Sans', [300, 400, 500, 700, 900]),
  g('Montserrat', 'Sans', [300, 400, 500, 600, 700, 800, 900]),
  g('Poppins', 'Sans', [300, 400, 500, 600, 700, 800, 900]),
  g('Open Sans', 'Sans', [300, 400, 600, 700, 800]),
  g('Lato', 'Sans', [300, 400, 700, 900]),
  g('Raleway', 'Sans', [300, 400, 500, 600, 700, 800]),
  g('Oswald', 'Sans', [300, 400, 500, 600, 700]),
  g('Work Sans', 'Sans', [300, 400, 500, 600, 700, 800]),
  sys('Arial', 'Sans'),
  sys('Verdana', 'Sans'),
  g('Playfair Display', 'Serif', [400, 500, 600, 700, 800, 900]),
  g('Merriweather', 'Serif', [300, 400, 700, 900]),
  g('Lora', 'Serif', [400, 500, 600, 700]),
  g('Cormorant Garamond', 'Serif', [300, 400, 500, 600, 700]),
  g('Libre Baskerville', 'Serif', [400, 700]),
  g('DM Serif Display', 'Serif'),
  sys('Georgia', 'Serif'),
  sys('Times New Roman', 'Serif'),
  g('Bebas Neue', 'Display'),
  g('Anton', 'Display'),
  g('Abril Fatface', 'Display'),
  g('Archivo Black', 'Display'),
  g('Alfa Slab One', 'Display'),
  g('Righteous', 'Decorative'),
  g('Bungee', 'Decorative'),
  g('Monoton', 'Decorative'),
  g('Permanent Marker', 'Decorative'),
  sys('Impact', 'Display'),
  g('Pacifico', 'Handwriting'),
  g('Dancing Script', 'Handwriting', [400, 500, 600, 700]),
  g('Caveat', 'Handwriting', [400, 500, 600, 700]),
  g('Lobster', 'Decorative'),
  g('Great Vibes', 'Handwriting'),
  g('Satisfy', 'Handwriting'),
  g('Space Mono', 'Mono', [400, 700]),
  g('JetBrains Mono', 'Mono', [300, 400, 500, 700, 800]),
  g('Roboto Mono', 'Mono', [300, 400, 500, 700]),
  sys('Courier New', 'Mono'),
];

const FALLBACK: Record<FontCategory, string> = {
  Sans: 'sans-serif',
  Serif: 'serif',
  Display: 'sans-serif',
  Handwriting: 'cursive',
  Mono: 'monospace',
  Decorative: 'sans-serif',
  Uploaded: 'sans-serif',
};

const byFamily = new Map(FONTS.map((f) => [f.family, f]));
const requested = new Set<string>();

export const getFont = (family: string) => byFamily.get(family);

/** CSS font-family value with a generic fallback, used by both the canvas and the DOM. */
export function fontStack(family: string) {
  const def = byFamily.get(family);
  return `${family}, ${def ? FALLBACK[def.category] : 'sans-serif'}`;
}

function stylesheetUrl(def: FontDef) {
  const name = def.family.replace(/ /g, '+');
  const single = def.weights.length === 1 && def.weights[0] === 400;
  return `https://fonts.googleapis.com/css2?family=${name}${single ? '' : `:wght@${def.weights.join(';')}`}&display=swap`;
}

/** Loads a font family (stylesheet + the specific face) and notifies text layers to re-measure. */
export async function ensureFont(family: string, weight = 400, italic = false) {
  const def = byFamily.get(family);
  if (!def || def.source !== 'google') return;
  if (!requested.has(family)) {
    requested.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheetUrl(def);
    document.head.appendChild(link);
    await new Promise<void>((resolve) => {
      link.onload = () => resolve();
      link.onerror = () => resolve();
    });
  }
  try {
    await document.fonts.load(`${italic ? 'italic ' : ''}${weight} 32px "${family}"`);
  } catch {
    // Offline or blocked: the generic fallback stays in use.
  }
  useUiStore.setState((s) => ({ fontVersion: s.fontVersion + 1 }));
}

export function nearestWeight(family: string, weight: number) {
  const weights = byFamily.get(family)?.weights ?? [400, 700];
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0]);
}

// ---------------------------------------------------------------------------------------------
// Uploaded fonts. The file is kept in this browser (IndexedDB) and registered with the page on
// every start, so text set in it renders the same on the canvas and in exports. A project
// opened where the font is missing falls back to a generic face without losing the font's name.
// ---------------------------------------------------------------------------------------------

interface StoredFont {
  id: string;
  family: string;
  fileName: string;
  data: ArrayBuffer;
  addedAt: number;
}

export const FONT_FILE_TYPES = ['.ttf', '.otf', '.woff', '.woff2'];
const MAX_FONT_BYTES = 12 * 1024 * 1024;

export const useUploadedFonts = create<{ fonts: FontDef[] }>(() => ({ fonts: [] }));

/** Built-in fonts followed by the user's own. */
export const allFonts = () => [...FONTS, ...useUploadedFonts.getState().fonts];

async function register(font: StoredFont) {
  const face = new FontFace(font.family, font.data);
  await face.load();
  document.fonts.add(face);
  const def: FontDef = { family: font.family, category: 'Uploaded', weights: [400, 700], source: 'uploaded' };
  byFamily.set(font.family, def);
  useUploadedFonts.setState((s) => ({ fonts: [...s.fonts.filter((f) => f.family !== font.family), def] }));
}

/** Registers every stored font. Called once when the editor starts. */
export async function loadUploadedFonts() {
  try {
    const stored = await dbGetAll<StoredFont>('fonts');
    for (const font of stored.sort((a, b) => a.addedAt - b.addedAt)) await register(font).catch(() => {});
    if (stored.length) useUiStore.setState((s) => ({ fontVersion: s.fontVersion + 1 }));
  } catch {
    // Storage unavailable: built-in fonts still work.
  }
}

/** Adds a font file to the font list. Throws a readable message if the file cannot be used. */
export async function uploadFont(file: File): Promise<string> {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!FONT_FILE_TYPES.includes(ext)) throw new Error('Use a TTF, OTF, WOFF or WOFF2 font file.');
  if (file.size > MAX_FONT_BYTES) throw new Error('That font file is larger than 12 MB.');
  const base = file.name.slice(0, file.name.lastIndexOf('.')).replace(/[-_]+/g, ' ').replace(/[^\w ]/g, '').trim() || 'Uploaded font';
  // A built-in family of the same name keeps its name; the upload is told apart.
  let family = base;
  for (let n = 2; byFamily.has(family) && byFamily.get(family)!.source !== 'uploaded'; n++) family = `${base} ${n}`;
  const font: StoredFont = { id: family, family, fileName: file.name, data: await file.arrayBuffer(), addedAt: Date.now() };
  try {
    await register(font);
  } catch {
    throw new Error('That file could not be read as a font.');
  }
  await dbPut('fonts', font);
  useUiStore.setState((s) => ({ fontVersion: s.fontVersion + 1 }));
  return family;
}

export async function removeUploadedFont(family: string) {
  await dbDelete('fonts', family);
  for (const face of document.fonts) if (face.family.replace(/["']/g, '') === family) document.fonts.delete(face);
  byFamily.delete(family);
  useUploadedFonts.setState((s) => ({ fonts: s.fonts.filter((f) => f.family !== family) }));
  useUiStore.setState((s) => ({ fontVersion: s.fontVersion + 1 }));
}
