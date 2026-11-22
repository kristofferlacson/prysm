import { useUiStore } from '../stores/uiStore';

export type FontCategory = 'Sans' | 'Serif' | 'Display' | 'Handwriting' | 'Mono';

export interface FontDef {
  family: string;
  category: FontCategory;
  weights: number[];
  /** 'google' fonts are fetched from Google Fonts on first use; 'system' fonts ship with the OS. */
  source: 'google' | 'system';
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
  g('Righteous', 'Display'),
  g('Bungee', 'Display'),
  g('Monoton', 'Display'),
  g('Permanent Marker', 'Display'),
  sys('Impact', 'Display'),
  g('Pacifico', 'Handwriting'),
  g('Dancing Script', 'Handwriting', [400, 500, 600, 700]),
  g('Caveat', 'Handwriting', [400, 500, 600, 700]),
  g('Lobster', 'Handwriting'),
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
