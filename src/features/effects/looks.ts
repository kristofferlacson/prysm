import type { Adjustments, EffectInstance } from '../../types/document';
import { DEFAULT_ADJUSTMENTS } from '../document/factory';

/**
 * A look is a ready-made combination of adjustments and effects: a finished grade in one click.
 * Applying one only sets those values on the layer, so every slider stays editable afterwards
 * and the original image is untouched.
 */
export interface Look {
  id: string;
  name: string;
  category: 'Cinematic' | 'Vintage' | 'Artistic';
  adjustments: Partial<Adjustments>;
  effects: EffectInstance[];
}

export const LOOKS: Look[] = [
  { id: 'blockbuster', name: 'Blockbuster', category: 'Cinematic', adjustments: { contrast: 12, saturation: 8 }, effects: [{ type: 'teal-orange', amount: 0.75 }, { type: 'vignette', amount: 0.35 }] },
  { id: 'thriller', name: 'Thriller', category: 'Cinematic', adjustments: { contrast: 18, exposure: -8, temperature: -18 }, effects: [{ type: 'bleach-bypass', amount: 0.7 }, { type: 'vignette', amount: 0.5 }] },
  { id: 'golden-hour', name: 'Golden hour', category: 'Cinematic', adjustments: { temperature: 28, saturation: 14, highlights: -10 }, effects: [{ type: 'glow', amount: 0.4 }, { type: 'spotlight', amount: 0.35 }] },
  { id: 'midnight', name: 'Midnight', category: 'Cinematic', adjustments: { temperature: -35, exposure: -12, contrast: 10 }, effects: [{ type: 'split-tone', amount: 0.6, colors: ['#0b1f4d', '#7fd4ff'] }, { type: 'vignette', amount: 0.55 }] },
  { id: 'noir', name: 'Film noir', category: 'Cinematic', adjustments: { contrast: 22 }, effects: [{ type: 'noir', amount: 1 }, { type: 'vignette', amount: 0.5 }, { type: 'noise', amount: 0.18 }] },
  { id: 'seventies', name: 'Seventies', category: 'Vintage', adjustments: { temperature: 22, saturation: -12, contrast: -6 }, effects: [{ type: 'faded', amount: 0.5 }, { type: 'vignette', amount: 0.35 }, { type: 'noise', amount: 0.14 }] },
  { id: 'polaroid', name: 'Instant film', category: 'Vintage', adjustments: { contrast: -8, highlights: 10 }, effects: [{ type: 'cross-process', amount: 0.55 }, { type: 'faded', amount: 0.3 }] },
  { id: 'old-print', name: 'Old print', category: 'Vintage', adjustments: {}, effects: [{ type: 'old-photo', amount: 0.85 }, { type: 'vignette', amount: 0.4 }] },
  { id: 'summer-slide', name: 'Summer slide', category: 'Vintage', adjustments: { saturation: 22, contrast: 8 }, effects: [{ type: 'retro', amount: 0.6 }, { type: 'glow', amount: 0.25 }] },
  { id: 'painted', name: 'Painted', category: 'Artistic', adjustments: { saturation: 18 }, effects: [{ type: 'oil-paint', amount: 0.6 }] },
  { id: 'pop-poster', name: 'Pop poster', category: 'Artistic', adjustments: { saturation: 30, contrast: 14 }, effects: [{ type: 'posterize', amount: 0.65 }, { type: 'halftone', amount: 0.2 }] },
  { id: 'duotone-ink', name: 'Two-ink print', category: 'Artistic', adjustments: { contrast: 12 }, effects: [{ type: 'duotone', amount: 1, colors: ['#1b1464', '#ff5f6d'] }, { type: 'noise', amount: 0.12 }] },
  { id: 'cyber', name: 'Cyber', category: 'Artistic', adjustments: { saturation: 26, tint: 18 }, effects: [{ type: 'rgb-split', amount: 0.35 }, { type: 'glitch', amount: 0.3 }] },
  { id: 'luminous', name: 'Luminous', category: 'Artistic', adjustments: { grayscale: 100, contrast: 24 }, effects: [{ type: 'bloom', amount: 0.4 }, { type: 'light-streaks', amount: 0.6 }, { type: 'noise', amount: 0.14 }] },
  { id: 'dream', name: 'Dream', category: 'Artistic', adjustments: { exposure: 8, saturation: 10 }, effects: [{ type: 'glow', amount: 0.7 }, { type: 'split-tone', amount: 0.35, colors: ['#7b5cff', '#ffd1e8'] }] },
];

export const lookAdjustments = (look: Look): Adjustments => ({ ...DEFAULT_ADJUSTMENTS, ...look.adjustments });

const sameEffects = (a: EffectInstance[], b: EffectInstance[]) =>
  a.length === b.length && a.every((e, i) => e.type === b[i].type && e.amount === b[i].amount && (e.colors ?? []).join() === (b[i].colors ?? []).join());

/** True when a layer's adjustments and effects are exactly what the look sets. */
export function hasLook(look: Look, adjustments: Adjustments, effects: EffectInstance[]) {
  const target = lookAdjustments(look);
  return (Object.keys(target) as (keyof Adjustments)[]).every((k) => adjustments[k] === target[k]) && sameEffects(effects, look.effects);
}
