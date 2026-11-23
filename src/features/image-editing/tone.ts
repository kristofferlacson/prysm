import type { CurveChannel, CurvePoint, Curves, Levels } from '../../types/document';

/**
 * Levels and curves: the two "advanced" tone controls. Both are functions from an input value to an
 * output value (0..255), so both end up as 256-entry lookup tables that the adjustment pass applies
 * together with exposure, contrast and the rest at no extra cost per pixel.
 */

export const DEFAULT_LEVELS: Levels = { black: 0, white: 255, gamma: 1, outBlack: 0, outWhite: 255 };
export const IDENTITY_CURVE: CurvePoint[] = [
  [0, 0],
  [255, 255],
];
export const DEFAULT_CURVES: Curves = { rgb: IDENTITY_CURVE, r: IDENTITY_CURVE, g: IDENTITY_CURVE, b: IDENTITY_CURVE };
export const CURVE_CHANNELS: CurveChannel[] = ['rgb', 'r', 'g', 'b'];

export const isDefaultLevels = (l: Levels | null | undefined) =>
  !l || (l.black === 0 && l.white === 255 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 255);

export const isIdentityCurve = (points: CurvePoint[]) => points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 255 && points[1][1] === 255;

export const isDefaultCurves = (c: Curves | null | undefined) => !c || CURVE_CHANNELS.every((ch) => isIdentityCurve(c[ch]));

/** Input black / white points and midtone gamma, then the output range. */
export function levelsLut(l: Levels): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, l.white - l.black);
  const inv = 1 / Math.max(0.05, l.gamma);
  for (let i = 0; i < 256; i++) {
    let v = (i - l.black) / span;
    v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, inv);
    lut[i] = Math.round(l.outBlack + v * (l.outWhite - l.outBlack));
  }
  return lut;
}

/**
 * A smooth curve through the control points that never overshoots between them (monotone cubic,
 * Fritsch-Carlson). Left of the first point and right of the last, the curve is flat.
 */
export function curveLut(points: CurvePoint[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n === 0) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  if (n === 1) return lut.fill(pts[0][1]);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(Math.max(1e-6, pts[i + 1][0] - pts[i][0]));
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    if (x <= pts[0][0]) {
      lut[x] = pts[0][1];
      continue;
    }
    if (x >= pts[n - 1][0]) {
      lut[x] = pts[n - 1][1];
      continue;
    }
    while (seg < n - 2 && x > pts[seg + 1][0]) seg++;
    const h = dx[seg];
    const t = (x - pts[seg][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    lut[x] = Math.round((2 * t3 - 3 * t2 + 1) * pts[seg][1] + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * pts[seg + 1][1] + (t3 - t2) * h * m[seg + 1]);
  }
  return lut;
}

/**
 * The combined per-channel tables for levels and curves, or null when neither changes anything.
 * Order: levels, then the RGB curve, then the channel's own curve.
 */
export function toneLuts(levels: Levels | null | undefined, curves: Curves | null | undefined): [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray] | null {
  const useLevels = !isDefaultLevels(levels);
  const useCurves = !isDefaultCurves(curves);
  if (!useLevels && !useCurves) return null;
  const base = useLevels ? levelsLut(levels!) : null;
  const master = useCurves ? curveLut(curves!.rgb) : null;
  return (['r', 'g', 'b'] as const).map((ch) => {
    const own = useCurves ? curveLut(curves![ch]) : null;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = base ? base[i] : i;
      if (master) v = master[v];
      if (own) v = own[v];
      lut[i] = v;
    }
    return lut;
  }) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
}

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Luminance. */
  l: Uint32Array;
  /** Tallest bar of each, for scaling a drawing. */
  peak: { r: number; g: number; b: number; l: number };
}

/** Counts how many pixels of an image have each value, per channel, from a small copy of the image. */
export function histogramOf(source: CanvasImageSource, width: number, height: number): Histogram {
  const k = Math.min(1, 256 / Math.max(width, height, 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * k));
  canvas.height = Math.max(1, Math.round(height * k));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    l[(data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) >> 8]++;
  }
  // The extremes are often a spike (pure black or white areas) that would flatten everything else.
  const peakOf = (h: Uint32Array) => {
    let max = 1;
    for (let i = 1; i < 255; i++) if (h[i] > max) max = h[i];
    return max;
  };
  return { r, g, b, l, peak: { r: peakOf(r), g: peakOf(g), b: peakOf(b), l: peakOf(l) } };
}

/** Black and white points that clip the darkest and lightest half percent of the image ("auto levels"). */
export function autoLevels(h: Histogram): Pick<Levels, 'black' | 'white'> {
  let total = 0;
  for (let i = 0; i < 256; i++) total += h.l[i];
  const clip = total * 0.005;
  let black = 0;
  let white = 255;
  for (let sum = 0; black < 254; black++) {
    sum += h.l[black];
    if (sum > clip) break;
  }
  for (let sum = 0; white > black + 1; white--) {
    sum += h.l[white];
    if (sum > clip) break;
  }
  return { black, white };
}
