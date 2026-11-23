import type { GraphicCategory, GraphicDef } from './types';

export type Ctx = CanvasRenderingContext2D;
export type Pt = readonly [number, number];
export const TAU = Math.PI * 2;

/** Tiny seeded generator (mulberry32): the same seed always yields the same sequence in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the per-category constructor used by each graphics file. */
export const definer =
  (category: GraphicCategory) =>
  (id: string, name: string, tags: string[], aspect: number, colors: string[], draw: GraphicDef['draw']): GraphicDef => ({
    id,
    name,
    category,
    tags,
    aspect,
    colors,
    draw,
  });

/**
 * Wraps a painter written for a fixed vw × vh design space so it fills any box. The painter never
 * sees real pixels, which is what keeps a graphic identical at every size.
 */
export function art(vw: number, vh: number, paint: (ctx: Ctx, c: string[]) => void): GraphicDef['draw'] {
  return (ctx, w, h, colors) => {
    ctx.save();
    ctx.scale(w / vw, h / vh);
    ctx.setLineDash([]);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    paint(ctx, colors);
    ctx.restore();
  };
}

export function fill(ctx: Ctx, color: string | CanvasGradient, rule: CanvasFillRule = 'nonzero') {
  ctx.fillStyle = color;
  ctx.fill(rule);
}

export function stroke(ctx: Ctx, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Path helpers add a sub-path to the current path; the caller decides when to beginPath / fill / stroke.

export function circle(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.moveTo(cx + r, cy);
  ctx.arc(cx, cy, r, 0, TAU);
}

export function poly(ctx: Ctx, pts: readonly Pt[], close = true) {
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (close) ctx.closePath();
}

/** Closed polygon with every corner rounded to radius r. */
export function roundPoly(ctx: Ctx, pts: readonly Pt[], r: number) {
  const n = pts.length;
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    ctx.arcTo(pts[i][0], pts[i][1], m[0], m[1], r);
  }
  ctx.closePath();
}

export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  roundPoly(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r);
}

/** Closed smooth curve through the midpoints of a control polygon (soft blobs). */
export function smooth(ctx: Ctx, pts: readonly Pt[]) {
  const n = pts.length;
  const mid = (i: number): Pt => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const start = mid(n - 1);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(i);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}

/** Star / burst polygon: `points` tips at `outer`, valleys at `inner`, first tip pointing up. */
export function star(ctx: Ctx, cx: number, cy: number, outer: number, inner: number, points: number, rot = -Math.PI / 2) {
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const r = i % 2 ? inner : outer;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/** n small dots evenly spaced on a circle. */
export function ring(ctx: Ctx, cx: number, cy: number, r: number, n: number, dot: number) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    circle(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, dot);
  }
}

/** Almond leaf from base (x0,y0) to tip (x1,y1); `bulge` is its half-width as a fraction of its length. */
export function leaf(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, bulge: number) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const nx = -(y1 - y0) * bulge * 2;
  const ny = (x1 - x0) * bulge * 2;
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx + nx, my + ny, x1, y1);
  ctx.quadraticCurveTo(mx - nx, my - ny, x0, y0);
  ctx.closePath();
}
