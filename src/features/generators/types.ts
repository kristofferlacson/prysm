import type { BlendMode } from '../../types/document';
import { hexToRgb } from '../../utils/misc';
import { makeNoise, mulberry32 } from './noise';

export type GeneratorKind = 'texture' | 'overlay' | 'background';
export type RGB = [number, number, number];

/** Drawing context handed to a generator. All sizes should be expressed relative to `s` so output is resolution independent. */
export interface Gen {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Short side in pixels. */
  s: number;
  /** One "design pixel" at a 1000px short side. */
  u: number;
  rand: () => number;
  n: ReturnType<typeof makeNoise>;
  colors: string[];
  rgb: RGB[];
  /**
   * Fills the canvas per pixel. `x`/`y` are in short-side units (0..1 across the short side);
   * write r,g,b,a (0..255) into `o`. Alpha defaults to 255.
   */
  pixels(fn: (x: number, y: number, o: number[]) => void): void;
  /** 0 at the canvas centre, 1 at the corners. */
  edge(x: number, y: number): number;
}

export interface GeneratorDef {
  id: string;
  name: string;
  kind: GeneratorKind;
  category: string;
  tags: string[];
  /** Suggested blending when dropped onto a design. */
  blend: BlendMode;
  opacity: number;
  /** Editable palette. Empty when the generator has no recolourable parts. */
  colors: string[];
  draw(g: Gen): void;
}

export function createGen(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, colors: string[]): Gen {
  const s = Math.min(w, h);
  return {
    ctx,
    w,
    h,
    s,
    u: s / 1000,
    rand: mulberry32(seed ^ 0x9e3779b9),
    n: makeNoise(seed),
    colors,
    rgb: colors.map(hexToRgb),
    pixels(fn) {
      const img = ctx.createImageData(w, h);
      const d = img.data;
      const o = [0, 0, 0, 255];
      let i = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          o[3] = 255;
          fn(x / s, y / s, o);
          d[i++] = o[0];
          d[i++] = o[1];
          d[i++] = o[2];
          d[i++] = o[3];
        }
      }
      ctx.putImageData(img, 0, 0);
    },
    edge(x, y) {
      const dx = (x * s) / w - 0.5;
      const dy = (y * s) / h - 0.5;
      return Math.min(1, Math.sqrt(dx * dx + dy * dy) / 0.7071);
    },
  };
}

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function mixInto(o: number[], a: RGB, b: RGB, t: number, gain = 1, add = 0) {
  o[0] = (a[0] + (b[0] - a[0]) * t) * gain + add;
  o[1] = (a[1] + (b[1] - a[1]) * t) * gain + add;
  o[2] = (a[2] + (b[2] - a[2]) * t) * gain + add;
}
