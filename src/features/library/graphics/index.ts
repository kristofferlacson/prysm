import { FRAMES } from './frames';
import { GEOMETRIC } from './geometric';
import { ILLUSTRATIONS } from './illustrations';
import { STICKERS } from './stickers';
import type { GraphicDef } from './types';

export type { GraphicCategory, GraphicDef } from './types';

/** Every code-drawn graphic, in panel order. */
export const GRAPHICS: GraphicDef[] = [...STICKERS, ...FRAMES, ...ILLUSTRATIONS, ...GEOMETRIC];

export const GRAPHIC_MAP = new Map(GRAPHICS.map((g) => [g.id, g]));

export function getGraphic(id: string): GraphicDef | undefined {
  return GRAPHIC_MAP.get(id);
}
