import type { Adjustments, EffectType } from '../../types/document';
import { DEFAULT_ADJUSTMENTS } from '../document/factory';
import { applyAdjustments, type SliderAdjustment } from '../image-editing/adjustments';
import { mulberry32 } from '../generators/noise';
import { hexToRgb } from '../../utils/misc';

/**
 * Raster effects. Each one edits the working canvas in place and scales with
 * image size, so the preview and the full-resolution export look the same.
 */

type Ctx = CanvasRenderingContext2D;
export type EffectFn = (canvas: HTMLCanvasElement, ctx: Ctx, amount: number, seed: number, colors?: string[], angle?: number) => void;

export interface EffectDef {
  type: EffectType;
  label: string;
  category: 'Basic' | 'Colour grade' | 'Vintage' | 'Artistic' | 'Print' | 'Digital' | 'Lighting' | 'Distortion';
  defaultAmount: number;
  /** Present when the effect's colours can be chosen; these are the defaults. */
  colors?: string[];
  /** Present when the effect has a direction; this is the default, in degrees. */
  angle?: number;
  apply: EffectFn;
}

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

function copyOf(canvas: HTMLCanvasElement) {
  const c = makeCanvas(canvas.width, canvas.height);
  ctx2d(c).drawImage(canvas, 0, 0);
  return c;
}

function editPixels(canvas: HTMLCanvasElement, ctx: Ctx, fn: (d: Uint8ClampedArray, w: number, h: number) => void) {
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  fn(img.data, canvas.width, canvas.height);
  ctx.putImageData(img, 0, 0);
}

/** Runs compositing that would otherwise paint into transparent areas, then restores the original alpha. */
function keepAlpha(canvas: HTMLCanvasElement, ctx: Ctx, fn: (original: HTMLCanvasElement) => void) {
  const original = copyOf(canvas);
  ctx.save();
  fn(original);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(original, 0, 0);
  ctx.restore();
}

function boxBlurPass(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, r: number, horizontal: boolean) {
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const lineStep = horizontal ? w * 4 : 4;
  const div = r + r + 1;
  for (let line = 0; line < lines; line++) {
    for (let ch = 0; ch < 4; ch++) {
      const base = line * lineStep + ch;
      let acc = src[base] * (r + 1);
      for (let i = 1; i <= r; i++) acc += src[base + Math.min(i, len - 1) * step];
      for (let i = 0; i < len; i++) {
        dst[base + i * step] = acc / div;
        acc += src[base + Math.min(i + r + 1, len - 1) * step] - src[base + Math.max(i - r, 0) * step];
      }
    }
  }
}

/** Gaussian-like blur: three box passes on a downscaled, alpha-premultiplied copy with clamped edges. */
export function blurCanvas(canvas: HTMLCanvasElement, ctx: Ctx, radius: number) {
  if (radius < 0.5) return;
  const factor = Math.max(1, Math.floor(radius / 5));
  const small = makeCanvas(canvas.width / factor, canvas.height / factor);
  const sctx = ctx2d(small);
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  const r = Math.max(1, Math.round(radius / factor / 1.7));
  editPixels(small, sctx, (d, w, h) => {
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      d[i] *= a;
      d[i + 1] *= a;
      d[i + 2] *= a;
    }
    const tmp = new Uint8ClampedArray(d.length);
    for (let pass = 0; pass < 3; pass++) {
      boxBlurPass(d, tmp, w, h, r, true);
      boxBlurPass(tmp, d, w, h, r, false);
    }
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a > 0 && a < 255) {
        const k = 255 / a;
        d[i] *= k;
        d[i + 1] *= k;
        d[i + 2] *= k;
      }
    }
  });
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

interface ColorPreset {
  adjust: Partial<Adjustments>;
  /** Lifts blacks towards grey (0..1). */
  fade?: number;
  shadowTint?: [number, number, number];
  highlightTint?: [number, number, number];
}

function colorPreset(preset: ColorPreset): EffectFn {
  return (canvas, ctx, amount) => {
    const adj: Adjustments = { ...DEFAULT_ADJUSTMENTS };
    for (const key of Object.keys(preset.adjust) as SliderAdjustment[]) {
      const target = preset.adjust[key] as number;
      adj[key] = DEFAULT_ADJUSTMENTS[key] + (target - DEFAULT_ADJUSTMENTS[key]) * amount;
    }
    const fade = (preset.fade ?? 0) * amount * 255;
    const st = preset.shadowTint;
    const ht = preset.highlightTint;
    editPixels(canvas, ctx, (d) => {
      applyAdjustments(d, adj);
      if (!fade && !st && !ht) return;
      for (let i = 0; i < d.length; i += 4) {
        const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 65280;
        const s = (1 - l) * (1 - l) * amount;
        const h = l * l * amount;
        for (let c = 0; c < 3; c++) {
          let v = d[i + c];
          v += fade * (1 - v / 255);
          if (st) v += st[c] * s;
          if (ht) v += ht[c] * h;
          d[i + c] = v;
        }
      }
    });
  };
}

const dim = (c: HTMLCanvasElement) => Math.max(c.width, c.height);

const blur: EffectFn = (canvas, ctx, amount) => blurCanvas(canvas, ctx, amount * dim(canvas) * 0.03);

const sharpen: EffectFn = (canvas, ctx, amount) => {
  const soft = copyOf(canvas);
  blurCanvas(soft, ctx2d(soft), Math.max(1.5, dim(canvas) * 0.0025));
  const s = ctx2d(soft).getImageData(0, 0, soft.width, soft.height).data;
  const k = amount * 2.5;
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      d[i] += (d[i] - s[i]) * k;
      d[i + 1] += (d[i + 1] - s[i + 1]) * k;
      d[i + 2] += (d[i + 2] - s[i + 2]) * k;
    }
  });
};

const pixelate: EffectFn = (canvas, ctx, amount) => {
  const size = Math.max(2, amount * dim(canvas) * 0.06);
  const small = makeCanvas(canvas.width / size, canvas.height / size);
  const sctx = ctx2d(small);
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  ctx.save();
  ctx.globalCompositeOperation = 'copy';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  ctx.restore();
};

const noise: EffectFn = (canvas, ctx, amount, seed) => {
  const rand = mulberry32(seed);
  const strength = amount * 110;
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand() - 0.5) * strength;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
  });
};

const VIGNETTE_COLORS = ['#000000'];

/** Fades the edges towards a colour: black darkens them (the classic look), white lightens them. */
const vignette: EffectFn = (canvas, ctx, amount, _seed, colors) => {
  const [vr, vg, vb] = hexToRgb(colors?.[0] ?? VIGNETTE_COLORS[0]);
  editPixels(canvas, ctx, (d, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    for (let y = 0; y < h; y++) {
      const dy = (y - cy) / cy;
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / cx;
        const dist = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
        let t = (dist - 0.3) / 0.7;
        t = t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
        const mix = t * amount;
        const k = 1 - mix;
        const i = (y * w + x) * 4;
        d[i] = d[i] * k + vr * mix;
        d[i + 1] = d[i + 1] * k + vg * mix;
        d[i + 2] = d[i + 2] * k + vb * mix;
      }
    }
  });
};

const DUOTONE_COLORS = ['#1c165c', '#ffc478'];

const duotone: EffectFn = (canvas, ctx, amount, _seed, colors) => {
  const dark = hexToRgb(colors?.[0] ?? DUOTONE_COLORS[0]);
  const light = hexToRgb(colors?.[1] ?? DUOTONE_COLORS[1]);
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 65280;
      for (let c = 0; c < 3; c++) {
        const target = dark[c] + (light[c] - dark[c]) * l;
        d[i + c] += (target - d[i + c]) * amount;
      }
    }
  });
};

const posterize: EffectFn = (canvas, ctx, amount) => {
  const levels = Math.round(14 - amount * 11);
  const step = 255 / (levels - 1);
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(d[i] / step) * step;
      d[i + 1] = Math.round(d[i + 1] / step) * step;
      d[i + 2] = Math.round(d[i + 2] / step) * step;
    }
  });
};

const photocopy: EffectFn = (canvas, ctx, amount, seed) => {
  const rand = mulberry32(seed);
  const k = 1 + amount * 9;
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 65280;
      const v = ((l - 0.5) * k + 0.5 + (rand() - 0.5) * 0.35 * amount) * 255;
      const out = v < 0 ? 0 : v > 255 ? 255 : v;
      for (let c = 0; c < 3; c++) d[i + c] += (out - d[i + c]) * Math.min(1, amount * 2);
    }
  });
};

const rgbSplit: EffectFn = (canvas, ctx, amount) => {
  const shift = Math.max(1, Math.round(amount * dim(canvas) * 0.02));
  editPixels(canvas, ctx, (d, w, h) => {
    const src = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = (row + x) * 4;
        d[i] = src[(row + Math.min(w - 1, x + shift)) * 4];
        d[i + 2] = src[(row + Math.max(0, x - shift)) * 4 + 2];
      }
    }
  });
};

const glitch: EffectFn = (canvas, ctx, amount, seed) => {
  const rand = mulberry32(seed);
  const { width: w, height: h } = canvas;
  const src = copyOf(canvas);
  rgbSplit(canvas, ctx, amount * 0.5, seed);
  const bands = Math.round(4 + amount * 22);
  for (let i = 0; i < bands; i++) {
    const y = Math.floor(rand() * h);
    const bh = Math.max(1, Math.floor(rand() * h * 0.07));
    const dx = Math.round((rand() - 0.5) * w * 0.22 * amount);
    ctx.clearRect(0, y, w, bh);
    ctx.drawImage(src, 0, y, w, bh, dx, y, w, bh);
    ctx.drawImage(src, 0, y, w, bh, dx + (dx > 0 ? -w : w), y, w, bh);
  }
};

const wave: EffectFn = (canvas, ctx, amount) => {
  const { width: w, height: h } = canvas;
  const src = copyOf(canvas);
  const amp = amount * dim(canvas) * 0.03;
  ctx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    const dx = Math.round(Math.sin((y / h) * Math.PI * 12) * amp);
    ctx.drawImage(src, 0, y, w, 1, dx, y, w, 1);
    if (dx !== 0) ctx.drawImage(src, 0, y, w, 1, dx + (dx > 0 ? -w : w), y, w, 1);
  }
};

const glow: EffectFn = (canvas, ctx, amount) => {
  keepAlpha(canvas, ctx, (original) => {
    const soft = copyOf(original);
    blurCanvas(soft, ctx2d(soft), dim(canvas) * 0.02);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(1, amount);
    ctx.drawImage(soft, 0, 0);
  });
};

const sketch: EffectFn = (canvas, ctx, amount) => {
  keepAlpha(canvas, ctx, (original) => {
    const gray = copyOf(original);
    const gctx = ctx2d(gray);
    editPixels(gray, gctx, (d) => applyAdjustments(d, { ...DEFAULT_ADJUSTMENTS, grayscale: 100 }));
    const inverted = copyOf(gray);
    const ictx = ctx2d(inverted);
    editPixels(inverted, ictx, (d) => applyAdjustments(d, { ...DEFAULT_ADJUSTMENTS, invert: 100 }));
    blurCanvas(inverted, ictx, Math.max(2, dim(canvas) * 0.006));
    gctx.globalCompositeOperation = 'color-dodge';
    gctx.drawImage(inverted, 0, 0);
    ctx.globalAlpha = amount;
    ctx.drawImage(gray, 0, 0);
  });
};

const halftone: EffectFn = (canvas, ctx, amount) => {
  const { width: w, height: h } = canvas;
  const cell = Math.max(3, dim(canvas) * (0.005 + amount * 0.02));
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const small = makeCanvas(cols, rows);
  const sctx = ctx2d(small);
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, cols, rows);
  const s = sctx.getImageData(0, 0, cols, rows).data;
  keepAlpha(canvas, ctx, () => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111111';
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        const l = (s[i] * 54 + s[i + 1] * 183 + s[i + 2] * 19) / 65280;
        const radius = cell * 0.72 * Math.sqrt(1 - l);
        if (radius < 0.3) continue;
        const cx = (c + (r % 2 ? 0.5 : 0)) * cell + cell / 2;
        const cy = r * cell + cell / 2;
        ctx.moveTo(cx + radius, cy);
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  });
};

/** Tints the shadows towards one colour and the highlights towards another, keeping mid-tones. */
function splitTone(d: Uint8ClampedArray, shadow: number[], highlight: number[], strength: number) {
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 65280;
    const ws = (1 - l) * (1 - l) * strength;
    const wh = l * l * strength;
    for (let c = 0; c < 3; c++) d[i + c] += (shadow[c] - 128) * ws + (highlight[c] - 128) * wh;
  }
}

const SPLIT_COLORS = ['#1f4f8f', '#ffb86b'];

const splitToneEffect: EffectFn = (canvas, ctx, amount, _seed, colors) => {
  const shadow = hexToRgb(colors?.[0] ?? SPLIT_COLORS[0]);
  const highlight = hexToRgb(colors?.[1] ?? SPLIT_COLORS[1]);
  editPixels(canvas, ctx, (d) => splitTone(d, shadow, highlight, amount * 0.9));
};

/** The blockbuster grade: cool shadows, warm highlights, a little more contrast. */
const tealOrange: EffectFn = (canvas, ctx, amount) => {
  editPixels(canvas, ctx, (d) => {
    splitTone(d, [0, 120, 150], [255, 160, 80], amount * 0.75);
    const k = 1 + amount * 0.18;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = (d[i + c] - 128) * k + 128;
  });
};

/** Silver left in the film: low saturation, hard contrast. */
const bleachBypass: EffectFn = (canvas, ctx, amount) => {
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 256;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c];
        // Overlay of the luminance on the colour, then pulled halfway to grey.
        const over = l < 128 ? (2 * v * l) / 255 : 255 - (2 * (255 - v) * (255 - l)) / 255;
        d[i + c] = v + ((over + (l - over) * 0.45) - v) * amount;
      }
    }
  });
};

/** Slide film developed in the wrong chemistry: punchy reds and greens, yellow highlights, crushed blues. */
const crossProcess: EffectFn = (canvas, ctx, amount) => {
  const curve = (v: number) => 255 * (v / 255) * (v / 255) * (3 - (2 * v) / 255);
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      d[i] += (curve(d[i]) * 1.04 - d[i]) * amount;
      d[i + 1] += (curve(d[i + 1]) * 0.98 + 8 - d[i + 1]) * amount;
      d[i + 2] += (60 + d[i + 2] * 0.55 - d[i + 2]) * amount;
    }
  });
};

/** A pool of light in the upper middle of the picture that falls away into shadow. */
const spotlight: EffectFn = (canvas, ctx, amount) => {
  editPixels(canvas, ctx, (d, w, h) => {
    const cx = w / 2;
    const cy = h * 0.42;
    const reach = Math.hypot(w, h) * 0.55;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let t = Math.hypot(x - cx, y - cy) / reach;
        t = t > 1 ? 1 : t * t * (3 - 2 * t);
        const k = 1 + amount * (0.45 * (1 - t) - 0.8 * t);
        const i = (y * w + x) * 4;
        d[i] *= k;
        d[i + 1] *= k;
        d[i + 2] *= k;
      }
    }
  });
};

/**
 * Moves pixels: for every output pixel, `source` says where in the original to read from
 * (bilinear). Positions outside the picture read its edge.
 */
function displace(canvas: HTMLCanvasElement, ctx: Ctx, source: (x: number, y: number, out: [number, number]) => void) {
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h).data;
  const img = ctx.createImageData(w, h);
  const dst = img.data;
  const at: [number, number] = [0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      at[0] = x;
      at[1] = y;
      source(x, y, at);
      const sx = Math.min(w - 1.001, Math.max(0, at[0]));
      const sy = Math.min(h - 1.001, Math.max(0, at[1]));
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const a = (y0 * w + x0) * 4;
      const b = a + 4;
      const c = a + w * 4;
      const e = c + 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        dst[o + k] = (src[a + k] * (1 - fx) + src[b + k] * fx) * (1 - fy) + (src[c + k] * (1 - fx) + src[e + k] * fx) * fy;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Bulge, pinch and swirl act inside the largest circle that fits the picture. */
function lens(canvas: HTMLCanvasElement, ctx: Ctx, bend: (r: number, angle: number) => [number, number]) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(cx, cy);
  displace(canvas, ctx, (x, y, out) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy) / radius;
    if (r >= 1 || r === 0) return;
    const [r2, a2] = bend(r, Math.atan2(dy, dx));
    out[0] = cx + Math.cos(a2) * r2 * radius;
    out[1] = cy + Math.sin(a2) * r2 * radius;
  });
}

const bulge: EffectFn = (canvas, ctx, amount) => lens(canvas, ctx, (r, a) => [Math.pow(r, 1 + amount * 1.4), a]);
const pinch: EffectFn = (canvas, ctx, amount) => lens(canvas, ctx, (r, a) => [Math.pow(r, 1 / (1 + amount * 1.4)), a]);
const swirl: EffectFn = (canvas, ctx, amount) => lens(canvas, ctx, (r, a) => [r, a + amount * 3.2 * (1 - r) * (1 - r)]);

const ripple: EffectFn = (canvas, ctx, amount) => {
  const size = dim(canvas);
  const length = size * 0.022;
  const height = amount * size * 0.014;
  displace(canvas, ctx, (x, y, out) => {
    out[0] = x + Math.sin(y / length) * height;
    out[1] = y + Math.sin(x / length) * height;
  });
};

/**
 * Painterly smoothing (a Kuwahara filter): each pixel takes the average colour of whichever
 * neighbouring quadrant is calmest, which flattens texture into dabs but keeps edges.
 * Summed-area tables make each quadrant a constant-time lookup; the filter runs on a copy of
 * at most 720 px, which is also what gives the brush-sized look on large photos.
 */
const oilPaint: EffectFn = (canvas, ctx, amount) => {
  const k = Math.min(1, 720 / dim(canvas));
  const small = makeCanvas(canvas.width * k, canvas.height * k);
  const sctx = ctx2d(small);
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  const img = sctx.getImageData(0, 0, small.width, small.height);
  const d = img.data;
  const w = small.width;
  const h = small.height;
  const W = w + 1;
  const tables = [0, 1, 2, 3, 4].map(() => new Float64Array(W * (h + 1)));
  for (let y = 0; y < h; y++) {
    const row = [0, 0, 0, 0, 0];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 256;
      row[0] += d[i];
      row[1] += d[i + 1];
      row[2] += d[i + 2];
      row[3] += l;
      row[4] += l * l;
      const t = (y + 1) * W + x + 1;
      for (let c = 0; c < 5; c++) tables[c][t] = tables[c][t - W] + row[c];
    }
  }
  const sum = (c: number, x0: number, y0: number, x1: number, y1: number) =>
    tables[c][y1 * W + x1] - tables[c][y0 * W + x1] - tables[c][y1 * W + x0] + tables[c][y0 * W + x0];
  const r = Math.round(2 + amount * 6);
  const out = new Uint8ClampedArray(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let best = Infinity;
      let br = 0, bg = 0, bb = 0;
      for (let q = 0; q < 4; q++) {
        const x0 = Math.max(0, q % 2 ? x : x - r);
        const x1 = Math.min(w, (q % 2 ? x + r : x) + 1);
        const y0 = Math.max(0, q > 1 ? y : y - r);
        const y1 = Math.min(h, (q > 1 ? y + r : y) + 1);
        const n = (x1 - x0) * (y1 - y0);
        const mean = sum(3, x0, y0, x1, y1) / n;
        const variance = sum(4, x0, y0, x1, y1) / n - mean * mean;
        if (variance < best) {
          best = variance;
          br = sum(0, x0, y0, x1, y1) / n;
          bg = sum(1, x0, y0, x1, y1) / n;
          bb = sum(2, x0, y0, x1, y1) / n;
        }
      }
      const i = (y * w + x) * 4;
      out[i] = br;
      out[i + 1] = bg;
      out[i + 2] = bb;
      out[i + 3] = d[i + 3];
    }
  }
  d.set(out);
  sctx.putImageData(img, 0, 0);
  keepAlpha(canvas, ctx, () => {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  });
};

/** Grey relief lit from the top-left, mixed over the picture. */
const emboss: EffectFn = (canvas, ctx, amount) => {
  const step = Math.max(1, Math.round(dim(canvas) * 0.0015));
  editPixels(canvas, ctx, (d, w, h) => {
    const src = new Uint8ClampedArray(d);
    const lum = (x: number, y: number) => {
      const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
      return (src[i] * 54 + src[i + 1] * 183 + src[i + 2] * 19) / 256;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 128 + (lum(x - step, y - step) - lum(x + step, y + step)) * 1.6;
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) d[i + c] += (v - d[i + c]) * amount;
      }
    }
  });
};

/** Saturation for the colours that lack it: muted tones are lifted, already vivid ones are left alone. */
const vibrance: EffectFn = (canvas, ctx, amount) => {
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      const k = 1 + amount * 1.4 * (1 - (max - min) / 255);
      const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 256;
      for (let c = 0; c < 3; c++) d[i + c] = l + (d[i + c] - l) * k;
    }
  });
};

const COLORIZE_COLORS = ['#3b82f6'];

/** Replaces every colour with shades of one, keeping light and dark. */
const colorize: EffectFn = (canvas, ctx, amount, _seed, colors) => {
  const tint = hexToRgb(colors?.[0] ?? COLORIZE_COLORS[0]);
  editPixels(canvas, ctx, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 65280;
      for (let c = 0; c < 3; c++) {
        const target = l < 0.5 ? tint[c] * 2 * l : 255 - (255 - tint[c]) * 2 * (1 - l);
        d[i + c] += (target - d[i + c]) * amount;
      }
    }
  });
};

/** The streak a moving camera or subject leaves: the picture averaged with shifted copies of itself along one direction. */
const motionBlur: EffectFn = (canvas, ctx, amount, _seed, _colors, angle = 0) => {
  const reach = amount * dim(canvas) * 0.05;
  const steps = Math.min(40, Math.ceil(reach));
  if (steps < 1) return;
  const src = copyOf(canvas);
  const a = (angle * Math.PI) / 180;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // A running average: the k-th copy is drawn at opacity 1/k, which weights all copies equally.
  let k = 1;
  for (let i = -steps; i <= steps; i++, k++) {
    ctx.globalAlpha = 1 / k;
    const t = (i / steps) * reach;
    ctx.drawImage(src, Math.cos(a) * t, Math.sin(a) * t);
  }
  ctx.restore();
};

/** A copy of the picture that keeps only its light parts: everything darker than `from` is black, everything lighter than `to` is kept whole. */
function highlightsOf(canvas: HTMLCanvasElement, from: number, to: number) {
  const out = copyOf(canvas);
  editPixels(out, ctx2d(out), (d) => {
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) / 65280;
      const t = Math.min(1, Math.max(0, (l - from) / (to - from)));
      const k = t * t * (3 - 2 * t);
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
    }
  });
  return out;
}

/** Adds light to the picture: the source is drawn on top additively, `gain` times over (fractions allowed). */
function addLight(canvas: HTMLCanvasElement, ctx: Ctx, light: HTMLCanvasElement, gain: number) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingQuality = 'high';
  for (let g = gain; g > 0.01; g -= 1) {
    ctx.globalAlpha = Math.min(1, g);
    ctx.drawImage(light, 0, 0, canvas.width, canvas.height);
  }
}

/** Glow that comes from the light parts only: they spill over their surroundings and burn out towards white, the dark parts stay dark. */
const bloom: EffectFn = (canvas, ctx, amount) => {
  keepAlpha(canvas, ctx, (original) => {
    const light = highlightsOf(original, 0.42, 0.82);
    const radius = dim(canvas) * (0.012 + amount * 0.03);
    // A tight glow close to the light, and a wide faint one around it.
    const wide = copyOf(light);
    blurCanvas(light, ctx2d(light), radius);
    blurCanvas(wide, ctx2d(wide), radius * 3);
    addLight(canvas, ctx, light, amount * 2);
    addLight(canvas, ctx, wide, amount * 1.6);
  });
};

/** The light parts smeared into streaks along one direction and laid over the picture, which stays sharp underneath. */
const lightStreaks: EffectFn = (canvas, ctx, amount, _seed, _colors, angle = 20) => {
  keepAlpha(canvas, ctx, (original) => {
    const reach = (0.03 + amount * 0.2) * dim(canvas);
    // Worked out on a reduced copy, one pixel per step, so a long streak is smooth and stays quick.
    const factor = Math.max(1, Math.ceil(reach / 28));
    const small = makeCanvas(canvas.width / factor, canvas.height / factor);
    const sctx = ctx2d(small);
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(highlightsOf(original, 0.5, 0.88), 0, 0, small.width, small.height);
    const streak = makeCanvas(small.width, small.height);
    const kctx = ctx2d(streak);
    const steps = Math.max(1, Math.round(reach / factor));
    const a = (angle * Math.PI) / 180;
    // A running average: the k-th copy is drawn at opacity 1/k, which weights all copies equally.
    let k = 1;
    for (let i = -steps; i <= steps; i++, k++) {
      kctx.globalAlpha = 1 / k;
      kctx.drawImage(small, Math.cos(a) * i, Math.sin(a) * i);
    }
    // Only the light that has travelled is added: where the picture is already light the streak is taken
    // back out, so the bright parts keep their detail instead of burning out to a white patch.
    const source = sctx.getImageData(0, 0, small.width, small.height).data;
    editPixels(streak, kctx, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.max(0, d[i] - source[i] * 0.9);
        d[i + 1] = Math.max(0, d[i + 1] - source[i + 1] * 0.9);
        d[i + 2] = Math.max(0, d[i + 2] - source[i + 2] * 0.9);
      }
    });
    // Spreading the light thins it, so it is added back several times over.
    addLight(canvas, ctx, streak, 1 + amount * 3.5);
  });
};

export const EFFECTS: EffectDef[] = [
  { type: 'blur', label: 'Blur', category: 'Basic', defaultAmount: 0.25, apply: blur },
  { type: 'sharpen', label: 'Sharpen', category: 'Basic', defaultAmount: 0.4, apply: sharpen },
  { type: 'motion-blur', label: 'Motion blur', category: 'Basic', defaultAmount: 0.4, angle: 0, apply: motionBlur },
  {
    type: 'retro',
    label: 'Retro',
    category: 'Vintage',
    defaultAmount: 0.8,
    apply: colorPreset({
      adjust: { saturation: -18, contrast: 12, temperature: 28 },
      fade: 0.1,
      shadowTint: [18, 4, 38],
      highlightTint: [22, 12, -14],
    }),
  },
  {
    type: 'film',
    label: 'Film',
    category: 'Vintage',
    defaultAmount: 0.8,
    apply: colorPreset({
      adjust: { contrast: 14, saturation: -8 },
      fade: 0.06,
      shadowTint: [-6, 14, 22],
      highlightTint: [20, 10, -10],
    }),
  },
  {
    type: 'sepia-tone',
    label: 'Sepia',
    category: 'Vintage',
    defaultAmount: 0.9,
    apply: colorPreset({ adjust: { sepia: 100, contrast: 6 } }),
  },
  {
    type: 'faded',
    label: 'Faded',
    category: 'Vintage',
    defaultAmount: 0.8,
    apply: colorPreset({ adjust: { contrast: -22, saturation: -24, brightness: 4 }, fade: 0.2 }),
  },
  {
    type: 'old-photo',
    label: 'Old photo',
    category: 'Vintage',
    defaultAmount: 0.8,
    apply: (canvas, ctx, amount, seed) => {
      colorPreset({ adjust: { sepia: 85, contrast: -8 }, fade: 0.12 })(canvas, ctx, amount, seed);
      vignette(canvas, ctx, amount * 0.6, seed);
      noise(canvas, ctx, amount * 0.25, seed);
    },
  },
  {
    type: 'noir',
    label: 'Noir',
    category: 'Vintage',
    defaultAmount: 1,
    apply: colorPreset({ adjust: { grayscale: 100, contrast: 38 } }),
  },
  { type: 'sketch', label: 'Sketch', category: 'Artistic', defaultAmount: 1, apply: sketch },
  { type: 'posterize', label: 'Posterize', category: 'Artistic', defaultAmount: 0.6, apply: posterize },
  { type: 'halftone', label: 'Halftone', category: 'Print', defaultAmount: 0.3, apply: halftone },
  { type: 'duotone', label: 'Duotone', category: 'Colour grade', defaultAmount: 1, colors: DUOTONE_COLORS, apply: duotone },
  { type: 'vibrance', label: 'Vibrance', category: 'Colour grade', defaultAmount: 0.6, apply: vibrance },
  { type: 'colorize', label: 'Colorize', category: 'Colour grade', defaultAmount: 1, colors: COLORIZE_COLORS, apply: colorize },
  { type: 'teal-orange', label: 'Teal & orange', category: 'Colour grade', defaultAmount: 0.7, apply: tealOrange },
  { type: 'split-tone', label: 'Split tone', category: 'Colour grade', defaultAmount: 0.6, colors: SPLIT_COLORS, apply: splitToneEffect },
  { type: 'bleach-bypass', label: 'Bleach bypass', category: 'Colour grade', defaultAmount: 0.8, apply: bleachBypass },
  { type: 'cross-process', label: 'Cross process', category: 'Colour grade', defaultAmount: 0.7, apply: crossProcess },
  { type: 'oil-paint', label: 'Oil paint', category: 'Artistic', defaultAmount: 0.5, apply: oilPaint },
  { type: 'emboss', label: 'Emboss', category: 'Artistic', defaultAmount: 0.8, apply: emboss },
  { type: 'photocopy', label: 'Photocopy', category: 'Print', defaultAmount: 0.6, apply: photocopy },
  { type: 'glitch', label: 'Glitch', category: 'Digital', defaultAmount: 0.5, apply: glitch },
  { type: 'pixelate', label: 'Pixelate', category: 'Digital', defaultAmount: 0.3, apply: pixelate },
  { type: 'rgb-split', label: 'RGB split', category: 'Digital', defaultAmount: 0.3, apply: rgbSplit },
  { type: 'glow', label: 'Glow', category: 'Lighting', defaultAmount: 0.6, apply: glow },
  { type: 'bloom', label: 'Bloom', category: 'Lighting', defaultAmount: 0.5, apply: bloom },
  { type: 'light-streaks', label: 'Light streaks', category: 'Lighting', defaultAmount: 0.5, angle: 20, apply: lightStreaks },
  { type: 'vignette', label: 'Vignette', category: 'Lighting', defaultAmount: 0.6, colors: VIGNETTE_COLORS, apply: vignette },
  { type: 'spotlight', label: 'Spotlight', category: 'Lighting', defaultAmount: 0.7, apply: spotlight },
  { type: 'wave', label: 'Wave', category: 'Distortion', defaultAmount: 0.3, apply: wave },
  { type: 'ripple', label: 'Ripple', category: 'Distortion', defaultAmount: 0.5, apply: ripple },
  { type: 'bulge', label: 'Bulge', category: 'Distortion', defaultAmount: 0.5, apply: bulge },
  { type: 'pinch', label: 'Pinch', category: 'Distortion', defaultAmount: 0.5, apply: pinch },
  { type: 'swirl', label: 'Swirl', category: 'Distortion', defaultAmount: 0.4, apply: swirl },
  { type: 'noise', label: 'Noise', category: 'Distortion', defaultAmount: 0.3, apply: noise },
];

export const EFFECT_MAP = new Map(EFFECTS.map((e) => [e.type, e]));
