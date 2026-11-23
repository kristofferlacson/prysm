import type { TextWarp, WarpStyle } from '../../types/document';

/**
 * Text warp geometry. A warp maps every point of the flat text box (pixels, origin at the box's
 * top-left corner) to where it is drawn. Presets are closed-form shapes driven by `bend`;
 * 'custom' is a bicubic Bézier patch whose control points the user drags on the canvas.
 */

export type WarpFn = (x: number, y: number) => [number, number];

export const WARP_LABELS: Record<WarpStyle, string> = {
  arc: 'Arc',
  'arc-lower': 'Arc lower',
  'arc-upper': 'Arc upper',
  arch: 'Arch',
  bulge: 'Bulge',
  flag: 'Flag',
  rise: 'Rise',
  squeeze: 'Squeeze',
  custom: 'Custom (drag points)',
  shape: 'Shape of a layer',
};

/** Where the letters themselves are inside the text box (the box also holds line spacing and side bearings). */
export interface InkBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const validShape = (shape: TextWarp['shape']): shape is NonNullable<TextWarp['shape']> =>
  !!shape && Array.isArray(shape.top) && shape.top.length >= 2 && shape.bottom?.length === shape.top.length && shape.top.every(Number.isFinite) && shape.bottom.every(Number.isFinite);

export const DEFAULT_BEND = 0.5;

/** The undistorted patch: control points on a regular 4 x 4 grid. */
export function identityMesh(): number[] {
  const mesh: number[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) mesh.push(j / 3, i / 3);
  return mesh;
}

const validMesh = (mesh: number[] | undefined): mesh is number[] =>
  Array.isArray(mesh) && mesh.length === 32 && mesh.every((v) => Number.isFinite(v));

/** True when the warp leaves the text exactly as it is, so the plain text renderer can be used. */
export function isIdentityWarp(warp: TextWarp | null): boolean {
  if (!warp) return true;
  if (warp.style === 'shape') return !validShape(warp.shape);
  if (warp.style === 'custom') {
    if (!validMesh(warp.mesh)) return true;
    const flat = identityMesh();
    return warp.mesh.every((v, i) => Math.abs(v - flat[i]) < 1e-6);
  }
  return warp.bend === 0 && warp.horizontal === 0 && warp.vertical === 0;
}

const bernstein = (t: number): [number, number, number, number] => {
  const u = 1 - t;
  return [u * u * u, 3 * t * u * u, 3 * t * t * u, t * t * t];
};

/** Evaluates the Bézier patch at (u, v), in the same box units as the control points. */
export function evalMesh(mesh: number[], u: number, v: number): [number, number] {
  const bu = bernstein(u);
  const bv = bernstein(v);
  let x = 0;
  let y = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const k = bv[i] * bu[j];
      x += k * mesh[(i * 4 + j) * 2];
      y += k * mesh[(i * 4 + j) * 2 + 1];
    }
  }
  return [x, y];
}

/** Parabola through 0 at both ends of the box and 1 in the middle. */
const hump = (t: number) => 1 - (2 * t - 1) * (2 * t - 1);
const smooth = (t: number) => {
  const s = Math.min(1, Math.max(0, t));
  return s * s * (3 - 2 * s);
};

function presetFn(style: Exclude<WarpStyle, 'custom' | 'shape'>, b: number, w: number, h: number): WarpFn {
  switch (style) {
    case 'arc': {
      // The whole box is wrapped around a circle; letters rotate with it. The sweep is capped so
      // the circle's centre always stays outside the text (otherwise the inner edge would fold).
      const limit = w / (0.75 * h);
      const sweep = Math.max(-limit, Math.min(limit, b * Math.PI));
      if (Math.abs(sweep) < 1e-4) return (x, y) => [x, y];
      const radius = w / sweep;
      const cy = h / 2 + radius;
      return (x, y) => {
        const a = (x - w / 2) / radius;
        const r = radius - (y - h / 2);
        return [w / 2 + r * Math.sin(a), cy - r * Math.cos(a)];
      };
    }
    case 'arc-lower':
      return (x, y) => [x, y + (y / h) * b * 0.6 * h * hump(x / w)];
    case 'arc-upper':
      return (x, y) => [x, y - (1 - y / h) * b * 0.6 * h * hump(x / w)];
    case 'arch':
      return (x, y) => [x, y - b * 0.6 * h * (hump(x / w) - 0.5)];
    case 'bulge':
      return (x, y) => [x, h / 2 + (y - h / 2) * Math.max(0.1, 1 + b * 0.8 * hump(x / w))];
    case 'flag':
      return (x, y) => [x, y - b * 0.35 * h * Math.sin((2 * Math.PI * x) / w)];
    case 'rise':
      return (x, y) => [x, y - b * 0.7 * h * (smooth(x / w) - 0.5)];
    case 'squeeze':
      return (x, y) => [w / 2 + (x - w / 2) * Math.max(0.1, 1 - b * 0.6 * hump(y / h)), y];
  }
}

/**
 * Fills a shape with the text: the letters' own extent (`ink`) is spread across the full width,
 * and at every position across it they are stretched from the shape's top edge to its bottom edge.
 */
function shapeFn(shape: NonNullable<TextWarp['shape']>, w: number, h: number, ink: InkBox | undefined): WarpFn {
  const { top, bottom } = shape;
  const last = top.length - 1;
  const left = ink?.left ?? 0;
  const upper = ink?.top ?? 0;
  const wide = Math.max(1e-6, (ink?.right ?? w) - left);
  const tall = Math.max(1e-6, (ink?.bottom ?? h) - upper);
  const at = (values: number[], u: number) => {
    const f = Math.min(1, Math.max(0, u)) * last;
    const i = Math.min(last - 1, Math.floor(f));
    return values[i] + (values[i + 1] - values[i]) * (f - i);
  };
  return (x, y) => {
    const u = (x - left) / wide;
    const v = (y - upper) / tall;
    const yTop = at(top, u) * w;
    const yBottom = at(bottom, u) * w;
    return [u * w, yTop + v * (yBottom - yTop)];
  };
}

/** The mapping for a warp applied to a text box of `w` x `h` pixels. `ink` is only used by the 'shape' style. */
export function warpFunction(warp: TextWarp, w: number, h: number, ink?: InkBox): WarpFn {
  if (warp.style === 'shape') return validShape(warp.shape) ? shapeFn(warp.shape, w, h, ink) : (x, y) => [x, y];
  if (warp.style === 'custom') {
    const mesh = validMesh(warp.mesh) ? warp.mesh : identityMesh();
    return (x, y) => {
      const [px, py] = evalMesh(mesh, x / w, y / h);
      return [px * w, py * h];
    };
  }
  const shape = presetFn(warp.style, warp.bend, w, h);
  const hd = warp.horizontal;
  const vd = warp.vertical;
  if (!hd && !vd) return shape;
  return (x, y) => {
    const [sx, sy] = shape(x, y);
    // One side of the box grows while the other shrinks, like tilting it away from the viewer.
    const tall = Math.max(0.05, 1 + hd * 0.9 * ((2 * x) / w - 1));
    const wide = Math.max(0.05, 1 + vd * 0.9 * ((2 * y) / h - 1));
    return [w / 2 + (sx - w / 2) * wide, h / 2 + (sy - h / 2) * tall];
  };
}

/** Bézier control values of the cubic that passes through f0..f3 at t = 0, 1/3, 2/3, 1. */
const fitCubic = (f0: number, f1: number, f2: number, f3: number): [number, number, number, number] => [
  f0,
  (-5 * f0 + 18 * f1 - 9 * f2 + 2 * f3) / 6,
  (2 * f0 - 9 * f1 + 18 * f2 - 5 * f3) / 6,
  f3,
];

/**
 * A patch that reproduces the current warp as closely as a bicubic patch can, so switching to
 * 'custom' starts from the shape already on the canvas instead of flattening the text.
 */
export function meshFromWarp(warp: TextWarp | null, w: number, h: number): number[] {
  if (!warp || isIdentityWarp(warp)) return identityMesh();
  if (warp.style === 'custom') return [...warp.mesh!];
  const fn = warpFunction(warp, w, h);
  // Sample the shape on the 4 x 4 grid, then solve for the control points that interpolate it.
  const grid: number[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const [x, y] = fn((j / 3) * w, (i / 3) * h);
      grid.push(x / w, y / h);
    }
  }
  const at = (g: number[], i: number, j: number, c: number) => g[(i * 4 + j) * 2 + c];
  const rows: number[] = new Array(32);
  for (let i = 0; i < 4; i++) {
    for (let c = 0; c < 2; c++) {
      const fit = fitCubic(at(grid, i, 0, c), at(grid, i, 1, c), at(grid, i, 2, c), at(grid, i, 3, c));
      for (let j = 0; j < 4; j++) rows[(i * 4 + j) * 2 + c] = fit[j];
    }
  }
  const mesh: number[] = new Array(32);
  for (let j = 0; j < 4; j++) {
    for (let c = 0; c < 2; c++) {
      const fit = fitCubic(at(rows, 0, j, c), at(rows, 1, j, c), at(rows, 2, j, c), at(rows, 3, j, c));
      for (let i = 0; i < 4; i++) mesh[(i * 4 + j) * 2 + c] = Math.round(fit[i] * 1e5) / 1e5;
    }
  }
  return mesh;
}

/** Control points on the edge of the patch: the ones shown as handles. */
export const HANDLE_POINTS = [0, 1, 2, 3, 4, 7, 8, 11, 12, 13, 14, 15];
export const CORNER_POINTS = [0, 3, 12, 15];
/** The four boundary curves, as control-point indices. */
export const EDGE_CURVES = [
  [0, 1, 2, 3],
  [12, 13, 14, 15],
  [0, 4, 8, 12],
  [3, 7, 11, 15],
];
/** Tangent lines drawn from each corner to its two neighbouring handles. */
export const HANDLE_LINES = [
  [0, 1],
  [0, 4],
  [3, 2],
  [3, 7],
  [12, 13],
  [12, 8],
  [15, 14],
  [15, 11],
];

/**
 * Which control points travel with a dragged handle. A corner carries its two tangent handles;
 * every handle carries the hidden interior point next to it, which keeps the surface smooth
 * without the user having to manage the four inner points.
 */
const FOLLOWERS: Record<number, number[]> = {
  0: [0, 1, 4, 5],
  3: [3, 2, 7, 6],
  12: [12, 13, 8, 9],
  15: [15, 14, 11, 10],
  1: [1, 5],
  2: [2, 6],
  4: [4, 5],
  8: [8, 9],
  7: [7, 6],
  11: [11, 10],
  13: [13, 9],
  14: [14, 10],
};

/** Moves handle `point` by (dx, dy) box units and returns the new patch. */
export function moveHandle(mesh: number[], point: number, dx: number, dy: number): number[] {
  const next = [...mesh];
  for (const p of FOLLOWERS[point] ?? []) {
    next[p * 2] += dx;
    next[p * 2 + 1] += dy;
  }
  return next;
}
