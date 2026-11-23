import { visibleRect } from '../masks/maskSpace';
import type { CropInsets, Fade, FadeFrom } from '../../types/document';

/**
 * Fade: an image that gradually becomes transparent, so it melts into whatever is behind it.
 *
 * A fade is built from any number of parts, and each part eats into the image from somewhere:
 * from a side, from a corner, from all round (an oval), from any direction, or from the outline of
 * a shape the user defined, or wherever the user brushed over the image. Where several parts overlap
 * they multiply, so a fade from the left and from the top is simply both at once.
 *
 * All parts share three settings, measured inwards from where the part starts (the edge, the
 * corner, the shape's outline):
 *   start     how much is already fully faded before the image begins to appear,
 *   reach     how far in the fade goes; beyond it the image is untouched,
 *   strength  how transparent the fully faded part is (1 = gone, less = only softened).
 *
 * It is a setting on the layer, not a change to its pixels, and everything is expressed in the
 * layer's own visible box (after cropping), so "from the right" means the right of what you see.
 */

export const DEFAULT_FADE: Fade = { from: ['right'], angle: null, shape: null, paint: null, start: 0.1, reach: 0.7, strength: 1, invert: false };

/** The nine places a fade can come from, laid out as they sit around the image. */
export const FADE_GRID: { from: FadeFrom; label: string }[] = [
  { from: 'top-left', label: 'the top left corner' },
  { from: 'top', label: 'the top' },
  { from: 'top-right', label: 'the top right corner' },
  { from: 'left', label: 'the left' },
  { from: 'around', label: 'all round (an oval)' },
  { from: 'right', label: 'the right' },
  { from: 'bottom-left', label: 'the bottom left corner' },
  { from: 'bottom', label: 'the bottom' },
  { from: 'bottom-right', label: 'the bottom right corner' },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** `start` may be a little negative in fades converted from the first version: an oval whose corners were not quite gone. */
const clampStart = (v: number) => Math.min(1, Math.max(-0.5, v));

/** True when the fade has no part, so there is nothing to fade from. */
export const isEmptyFade = (fade: Fade) => !fade.from.length && fade.angle === null && !fade.shape && !fade.paint;

interface OldFade {
  kind: 'linear' | 'radial';
  angle: number;
  start: number;
  end: number;
  invert: boolean;
}

/**
 * Brings a fade saved by the first version of the feature (one straight line or one oval, measured
 * from the solid side) to the current form. It looks exactly the same afterwards.
 */
export function normalizeFade(value: unknown): Fade | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<Fade> & Partial<OldFade>;
  if (Array.isArray(v.from)) {
    return {
      from: v.from,
      angle: typeof v.angle === 'number' ? v.angle : null,
      shape: v.shape ?? null,
      paint: v.paint ?? null,
      start: clampStart(v.start ?? DEFAULT_FADE.start),
      reach: clamp01(v.reach ?? DEFAULT_FADE.reach),
      strength: clamp01(v.strength ?? 1),
      invert: !!v.invert,
    };
  }
  if (v.kind !== 'linear' && v.kind !== 'radial') return null;
  const start = v.start ?? 0.3;
  const end = v.end ?? 0.9;
  if (v.kind === 'radial') {
    // It was solid out to `start` and gone by `end`, measured from the middle (1 = an edge).
    return { from: ['around'], angle: null, shape: null, start: clampStart(1 - end), reach: clamp01(1 - start), strength: 1, invert: !!v.invert };
  }
  const angle = ((v.angle ?? 0) % 360 + 360) % 360;
  // "Inverted" was the same fade pointing the other way.
  return v.invert
    ? { from: [], angle: (angle + 180) % 360, shape: null, start: clamp01(start), reach: clamp01(end), strength: 1, invert: false }
    : { from: [], angle, shape: null, start: clamp01(1 - end), reach: clamp01(1 - start), strength: 1, invert: false };
}

/**
 * Colour stops for one part: fully faded up to `start`, eased up to solid at `reach`, solid beyond.
 * `at` turns an inward distance into a position along the gradient (0..1).
 */
function addRamp(gradient: CanvasGradient, fade: Fade, at: (inward: number) => number) {
  const start = clampStart(fade.start);
  const reach = Math.max(start + 0.01, clamp01(fade.reach));
  const steps = 8;
  // Smooth at both ends, so the fade has no visible beginning or end.
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    gradient.addColorStop(clamp01(at(start + (reach - start) * t)), `rgba(255,255,255,${t * t * (3 - 2 * t)})`);
  }
}

const scratch: Record<string, HTMLCanvasElement> = {};
function canvasFor(name: string, w: number, h: number) {
  const c = (scratch[name] ??= document.createElement('canvas'));
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  return c;
}

/** One-dimensional squared distance transform (Felzenszwalb & Huttenlocher). */
function distance1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

interface Distances {
  key: string;
  data: Float32Array;
  /** The distance at the shape's deepest point. */
  deepest: number;
}
const distances = new WeakMap<HTMLCanvasElement, Distances>();

/** For every pixel inside the shape, how far it is from the shape's outline (0 outside it). In pixels of a w x h grid. */
function insideDistance(shape: HTMLCanvasElement, crop: CropInsets, w: number, h: number): Distances {
  const key = `${w}x${h}|${crop.left},${crop.top},${crop.right},${crop.bottom}`;
  const cached = distances.get(shape);
  if (cached?.key === key) return cached;
  const small = canvasFor('shape', w, h);
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.clearRect(0, 0, w, h);
  sctx.imageSmoothingQuality = 'high';
  const visible = visibleRect(shape.width, shape.height, crop);
  sctx.drawImage(shape, visible.x, visible.y, visible.width, visible.height, 0, 0, w, h);
  const alpha = sctx.getImageData(0, 0, w, h).data;
  const FAR = 1e12;
  const grid = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) grid[i] = alpha[i * 4 + 3] >= 128 ? FAR : 0;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    distance1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const data = new Float32Array(w * h);
  let deepest = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
    distance1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) {
      const value = Math.sqrt(d[x]);
      data[y * w + x] = value;
      if (value > deepest) deepest = value;
    }
  }
  const result = { key, data, deepest };
  distances.set(shape, result);
  return result;
}

/**
 * How much of the image shows at each pixel for the "shape" part: faded at and beyond the shape's
 * outline, solid deep inside it. Distances are a share of the way from the outline to the shape's
 * deepest point, so a small shape and a large one fade alike and something of it always shows.
 */
function shapeCover(shape: HTMLCanvasElement, crop: CropInsets, fade: Fade, w: number, h: number) {
  const { data: dist, deepest } = insideDistance(shape, crop, w, h);
  const start = clamp01(fade.start) * deepest;
  const reach = Math.max(start + 0.5, clamp01(fade.reach) * deepest);
  const canvas = canvasFor('shape-cover', w, h);
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(w, h);
  for (let i = 0; i < dist.length; i++) {
    const t = clamp01((dist[i] - start) / (reach - start));
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255;
    image.data[i * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

const CORNER: Partial<Record<FadeFrom, [number, number]>> = { 'top-left': [0, 0], 'top-right': [1, 0], 'bottom-left': [0, 1], 'bottom-right': [1, 1] };

/**
 * Multiplies the transparency of everything on the canvas by the fade. The canvas is the layer's
 * visible box. `shape` and `paint` are the bitmaps of the fade's shape and of its brush strokes (in
 * the layer's source space, like a mask), when it has them and they are loaded.
 */
export function applyFade(canvas: HTMLCanvasElement, fade: Fade, shape: HTMLCanvasElement | null, crop: CropInsets, paint: HTMLCanvasElement | null = null) {
  const strength = clamp01(fade.strength);
  const shaped = !!fade.shape && !!shape;
  if (strength <= 0 || (!fade.from.length && fade.angle === null && !shaped && !paint)) return;
  // The fade is smooth, so it is worked out on a small copy and stretched over the image…
  const k = Math.min(1, 512 / Math.max(canvas.width, canvas.height));
  const sw = Math.max(2, Math.round(canvas.width * k));
  const sh = Math.max(2, Math.round(canvas.height * k));
  // …except brush strokes, which can have a crisp edge: with painting it is worked out at the image's own size.
  const w = paint ? canvas.width : sw;
  const h = paint ? canvas.height : sh;
  const cover = canvasFor('cover', w, h);
  const c = cover.getContext('2d')!;
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'destination-in';
  c.imageSmoothingQuality = 'high';

  for (const from of fade.from) {
    c.save();
    if (from === 'around') {
      // Inward distance is measured from the middle of an edge (radius 1) towards the centre.
      c.translate(w / 2, h / 2);
      c.scale(w / 2, h / 2);
      const gradient = c.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
      addRamp(gradient, fade, (inward) => (1 - inward) / Math.SQRT2);
      c.fillStyle = gradient;
      c.fillRect(-1, -1, 2, 2);
    } else if (CORNER[from]) {
      const [cx, cy] = CORNER[from]!;
      c.translate(cx * w, cy * h);
      c.scale(cx ? -w : w, cy ? -h : h);
      const gradient = c.createRadialGradient(0, 0, 0, 0, 0, Math.SQRT2);
      addRamp(gradient, fade, (inward) => inward / Math.SQRT2);
      c.fillStyle = gradient;
      c.fillRect(0, 0, 1, 1);
    } else {
      const gradient =
        from === 'left' ? c.createLinearGradient(0, 0, w, 0) : from === 'right' ? c.createLinearGradient(w, 0, 0, 0) : from === 'top' ? c.createLinearGradient(0, 0, 0, h) : c.createLinearGradient(0, h, 0, 0);
      addRamp(gradient, fade, (inward) => inward);
      c.fillStyle = gradient;
      c.fillRect(0, 0, w, h);
    }
    c.restore();
  }
  if (fade.angle !== null) {
    // The image fades away towards this direction: measured inwards from the far end of the box.
    const a = (fade.angle * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const length = Math.abs(w * dx) + Math.abs(h * dy);
    const gradient = c.createLinearGradient(w / 2 + (dx * length) / 2, h / 2 + (dy * length) / 2, w / 2 - (dx * length) / 2, h / 2 - (dy * length) / 2);
    addRamp(gradient, fade, (inward) => inward);
    c.fillStyle = gradient;
    c.fillRect(0, 0, w, h);
  }
  if (shaped) c.drawImage(shapeCover(shape!, crop, fade, sw, sh), 0, 0, w, h);
  if (paint) {
    // Painted = faded, by as much as was painted.
    const visible = visibleRect(paint.width, paint.height, crop);
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(paint, visible.x, visible.y, visible.width, visible.height, 0, 0, w, h);
  }

  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  if (strength >= 1) {
    // Reversed: what was kept is faded and what was faded is kept.
    ctx.globalCompositeOperation = fade.invert ? 'destination-out' : 'destination-in';
    ctx.drawImage(cover, 0, 0, canvas.width, canvas.height);
  } else {
    // Strength: the fully faded part keeps (1 - strength) of the image.
    const result = canvasFor('result', w, h);
    const r = result.getContext('2d')!;
    r.globalCompositeOperation = 'copy';
    r.fillStyle = '#ffffff';
    if (fade.invert) {
      r.globalAlpha = 1;
      r.fillRect(0, 0, w, h);
      r.globalCompositeOperation = 'destination-out';
      r.globalAlpha = strength;
      r.drawImage(cover, 0, 0);
    } else {
      r.globalAlpha = 1 - strength;
      r.fillRect(0, 0, w, h);
      r.globalCompositeOperation = 'lighter';
      r.globalAlpha = strength;
      r.drawImage(cover, 0, 0);
    }
    r.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(result, 0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}
