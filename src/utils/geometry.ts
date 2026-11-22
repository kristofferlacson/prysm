export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Box extends Rect {
  rotation: number;
  scaleX: number;
  scaleY: number;
}

/** 2D affine matrix [a, b, c, d, e, f] (canvas convention). */
export type Mat = [number, number, number, number, number, number];

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const round = (v: number, places = 2) => {
  const p = 10 ** places;
  return Math.round(v * p) / p;
};
export const deg2rad = (d: number) => (d * Math.PI) / 180;

export function multiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMat(m: Mat, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Maps coordinates relative to the box centre into parent coordinates. */
export function centerMatrix(b: Box): Mat {
  const r = deg2rad(b.rotation);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos * b.scaleX, sin * b.scaleX, -sin * b.scaleY, cos * b.scaleY, b.x + b.width / 2, b.y + b.height / 2];
}

export function decompose(m: Mat) {
  const [a, b, c, d, e, f] = m;
  const r = Math.hypot(a, b);
  if (r === 0) return { x: e, y: f, rotation: 0, scaleX: 0, scaleY: Math.hypot(c, d) };
  const rotation = (Math.atan2(b, a) * 180) / Math.PI;
  return { x: e, y: f, rotation, scaleX: r, scaleY: (a * d - b * c) / r };
}

export function boxCorners(b: Box): Point[] {
  const m = centerMatrix(b);
  const hw = b.width / 2;
  const hh = b.height / 2;
  return [applyMat(m, -hw, -hh), applyMat(m, hw, -hh), applyMat(m, hw, hh), applyMat(m, -hw, hh)];
}

/** Axis-aligned bounds of a rotated/scaled box. */
export function boxBounds(b: Box): Rect {
  const pts = boxCorners(b);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionRects(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function rectsIntersect(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, 0, 0];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

/** Maps a box's own coordinates (origin at its top-left corner) into its parent's coordinates. */
export function boxMatrix(b: Box): Mat {
  return multiply(centerMatrix(b), [1, 0, 0, 1, -b.width / 2, -b.height / 2]);
}
