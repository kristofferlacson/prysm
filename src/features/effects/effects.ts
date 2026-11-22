import type { Adjustments, EffectType } from '../../types/document';
import { DEFAULT_ADJUSTMENTS } from '../document/factory';
import { applyAdjustments } from '../image-editing/adjustments';
import { mulberry32 } from '../generators/noise';

/**
 * Raster effects. Each one edits the working canvas in place and scales with
 * image size, so the preview and the full-resolution export look the same.
 */

type Ctx = CanvasRenderingContext2D;
export type EffectFn = (canvas: HTMLCanvasElement, ctx: Ctx, amount: number, seed: number) => void;

export interface EffectDef {
  type: EffectType;
  label: string;
  category: 'Basic' | 'Vintage' | 'Artistic' | 'Print' | 'Digital' | 'Lighting' | 'Distortion';
  defaultAmount: number;
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
    for (const key of Object.keys(preset.adjust) as (keyof Adjustments)[]) {
      const target = preset.adjust[key]!;
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

const vignette: EffectFn = (canvas, ctx, amount) => {
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
        const k = 1 - t * amount;
        const i = (y * w + x) * 4;
        d[i] *= k;
        d[i + 1] *= k;
        d[i + 2] *= k;
      }
    }
  });
};

const duotone: EffectFn = (canvas, ctx, amount) => {
  const dark = [28, 22, 92];
  const light = [255, 196, 120];
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

export const EFFECTS: EffectDef[] = [
  { type: 'blur', label: 'Blur', category: 'Basic', defaultAmount: 0.25, apply: blur },
  { type: 'sharpen', label: 'Sharpen', category: 'Basic', defaultAmount: 0.4, apply: sharpen },
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
  { type: 'duotone', label: 'Duotone', category: 'Print', defaultAmount: 1, apply: duotone },
  { type: 'photocopy', label: 'Photocopy', category: 'Print', defaultAmount: 0.6, apply: photocopy },
  { type: 'glitch', label: 'Glitch', category: 'Digital', defaultAmount: 0.5, apply: glitch },
  { type: 'pixelate', label: 'Pixelate', category: 'Digital', defaultAmount: 0.3, apply: pixelate },
  { type: 'rgb-split', label: 'RGB split', category: 'Digital', defaultAmount: 0.3, apply: rgbSplit },
  { type: 'glow', label: 'Glow', category: 'Lighting', defaultAmount: 0.6, apply: glow },
  { type: 'vignette', label: 'Vignette', category: 'Lighting', defaultAmount: 0.6, apply: vignette },
  { type: 'wave', label: 'Wave', category: 'Distortion', defaultAmount: 0.3, apply: wave },
  { type: 'noise', label: 'Noise', category: 'Distortion', defaultAmount: 0.3, apply: noise },
];

export const EFFECT_MAP = new Map(EFFECTS.map((e) => [e.type, e]));
