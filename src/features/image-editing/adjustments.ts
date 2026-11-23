import type { Adjustments } from '../../types/document';
import { DEFAULT_ADJUSTMENTS } from '../document/factory';
import { isDefaultCurves, isDefaultLevels, toneLuts } from './tone';

/** The adjustments that are a single number (levels and curves have their own editors). */
export type SliderAdjustment = Exclude<keyof Adjustments, 'levels' | 'curves'>;

export interface AdjustmentSpec {
  key: SliderAdjustment;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const ADJUSTMENT_SPECS: AdjustmentSpec[] = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1 },
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, step: 1 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01 },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100, step: 1 },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1 },
  { key: 'invert', label: 'Invert', min: 0, max: 100, step: 1 },
];

export function isNeutral(a: Adjustments) {
  return ADJUSTMENT_SPECS.every((s) => a[s.key] === DEFAULT_ADJUSTMENTS[s.key]) && isDefaultLevels(a.levels) && isDefaultCurves(a.curves);
}

type M3 = number[]; // row-major 3x3

const mul3 = (a: M3, b: M3): M3 => {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
};

const saturationMatrix = (s: number): M3 => [
  0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
  0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
];

const hueMatrix = (deg: number): M3 => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
};

const sepiaMatrix = (amount: number): M3 => {
  const q = 1 - amount;
  return [
    0.393 + 0.607 * q, 0.769 - 0.769 * q, 0.189 - 0.189 * q,
    0.349 - 0.349 * q, 0.686 + 0.314 * q, 0.168 - 0.168 * q,
    0.272 - 0.272 * q, 0.534 - 0.534 * q, 0.131 + 0.869 * q,
  ];
};

/**
 * Applies all colour adjustments to RGBA pixel data in a single pass:
 * per-channel tone curve (exposure, white balance, brightness, contrast, gamma, then levels and curves) via lookup tables,
 * luminance-weighted highlights/shadows, a combined colour matrix (saturation, hue, grayscale, sepia), then invert.
 */
export function applyAdjustments(d: Uint8ClampedArray, a: Adjustments) {
  if (isNeutral(a)) return;

  const exposure = Math.pow(2, a.exposure / 50);
  const bright = (a.brightness / 100) * 0.5;
  const c = a.contrast / 100;
  const contrast = c >= 0 ? 1 + c * 1.5 : 1 + c * 0.9;
  const invGamma = 1 / Math.max(0.05, a.gamma);
  const temp = a.temperature / 100;
  const tint = a.tint / 100;
  const gains = [(1 + temp * 0.25) * (1 + tint * 0.1), 1 - tint * 0.2, (1 - temp * 0.25) * (1 + tint * 0.1)];

  const luts = gains.map((gain) => {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = (i / 255) * exposure * gain + bright;
      v = (v - 0.5) * contrast + 0.5;
      v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, invGamma);
      lut[i] = Math.round(v * 255);
    }
    return lut;
  });
  // Levels and curves are also value-to-value maps, so they are folded into the same tables.
  const tone3 = toneLuts(a.levels, a.curves);
  if (tone3) {
    luts.forEach((lut, channel) => {
      for (let i = 0; i < 256; i++) lut[i] = tone3[channel][lut[i]];
    });
  }
  const [lr, lg, lb] = luts;

  const sh = a.shadows / 100;
  const hi = a.highlights / 100;
  const useTone = sh !== 0 || hi !== 0;
  const tone = new Float32Array(256);
  if (useTone) {
    for (let i = 0; i < 256; i++) {
      const l = i / 255;
      // Weights peak in the lower / upper third and vanish at pure black and white.
      tone[i] = (sh * (1 - l) * (1 - l) * l + hi * l * l * (1 - l)) * 2 * 255;
    }
  }

  let m: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let useMatrix = false;
  if (a.saturation !== 0) {
    m = mul3(saturationMatrix(1 + a.saturation / 100), m);
    useMatrix = true;
  }
  if (a.hue !== 0) {
    m = mul3(hueMatrix(a.hue), m);
    useMatrix = true;
  }
  if (a.grayscale !== 0) {
    m = mul3(saturationMatrix(1 - a.grayscale / 100), m);
    useMatrix = true;
  }
  if (a.sepia !== 0) {
    m = mul3(sepiaMatrix(a.sepia / 100), m);
    useMatrix = true;
  }
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
  const inv = a.invert / 100;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r: number = lr[d[i]];
    let g: number = lg[d[i + 1]];
    let b: number = lb[d[i + 2]];
    if (useTone) {
      const t = tone[(r * 54 + g * 183 + b * 19) >> 8];
      r += t;
      g += t;
      b += t;
    }
    if (useMatrix) {
      const r2 = m0 * r + m1 * g + m2 * b;
      const g2 = m3 * r + m4 * g + m5 * b;
      b = m6 * r + m7 * g + m8 * b;
      r = r2;
      g = g2;
    }
    if (inv) {
      r = r < 0 ? 0 : r > 255 ? 255 : r;
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      b = b < 0 ? 0 : b > 255 ? 255 : b;
      r += (255 - 2 * r) * inv;
      g += (255 - 2 * g) * inv;
      b += (255 - 2 * b) * inv;
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
}
