/**
 * A vector graphic drawn by code: a sticker, frame, illustration or geometric element.
 * Graphics are original artwork (nothing is downloaded or traced), are drawn with vector canvas
 * calls only so they stay sharp at any size, and expose a small palette the user can recolour.
 */
export type GraphicCategory = 'Stickers' | 'Frames' | 'Illustrations' | 'Geometric';

export interface GraphicDef {
  /** Stable id stored in documents, e.g. 'sticker/sale-burst'. Never rename once shipped. */
  id: string;
  name: string;
  category: GraphicCategory;
  /** Lower-case search words. */
  tags: string[];
  /** Natural width / height. A layer is created with this proportion. */
  aspect: number;
  /** Default palette. `draw` receives a palette of the same length. */
  colors: string[];
  /**
   * Draws the graphic inside the box (0,0)-(w,h). Rules:
   * - vector calls only (paths, fills, strokes, gradients); no pixel access, no images, no text;
   * - deterministic: the same arguments always give the same picture (no Math.random);
   * - every dimension is relative to w / h, so the result is identical at any size;
   * - leaves the context's transform and state as it found them (wrap in save/restore);
   * - frames leave their middle transparent.
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, colors: string[]): void;
}
