import type { TextEffects, TextFold, TextLayer } from '../../types/document';
import type { Rect } from '../../utils/geometry';
import { makeNoise, smoothstep } from '../generators/noise';

/**
 * Text effects: glow, 3D block, metallic bevel and distress. They work on the finished picture of
 * the text (after any warp or path), so they follow its real outline, and every size is a fraction
 * of the font size, so an effect looks the same when the layer is scaled or exported larger.
 */

export interface TextPicture {
  canvas: HTMLCanvasElement;
  /** Where the canvas sits in the layer's own coordinates. */
  bounds: Rect;
  /** Canvas pixels per layer unit. */
  density: number;
}

export const DEFAULT_TEXT_EFFECTS = {
  glow: { color: '#00e5ff', size: 0.35, strength: 0.6 },
  extrude: { color: '#1d1e22', depth: 0.12, angle: 45 },
  bevel: { depth: 0.5 },
  distress: { amount: 0.35, scale: 0.4, seed: 1 },
  backdrop: { color: '#ffd166', padding: 0.3, radius: 0.2 },
  fold: { position: 0.5, drop: 0.4, spread: 0.3, shade: 0.45 },
} as const;

export const hasTextEffects = (fx: TextEffects | undefined) => !!fx && !!(fx.glow || fx.extrude || fx.bevel || fx.distress || fx.backdrop || fx.fold);

function canvasOf(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** The picture's shape filled with one colour. */
function silhouette(source: HTMLCanvasElement, color: string) {
  const c = canvasOf(source.width, source.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Folds the picture of the text: everything above the cut stays, everything below it drops down and
 * is enlarged about the text's centre line, and the gap is bridged by the row of pixels at the cut,
 * repeated and widened step by step from the upper size to the lower one. Each stroke the cut goes
 * through therefore becomes a slanted strip joining its two halves. The strip is the text's own
 * colour (so gradients and textures carry through), lightened or darkened by `shade`.
 */
function foldText(text: HTMLCanvasElement, bounds: Rect, d: number, fold: TextFold, outline: Rect, fontSize: number) {
  const W = text.width;
  const H = text.height;
  const top = (outline.y - bounds.y) * d;
  const tall = outline.height * d;
  const cut = Math.round(Math.min(H - 1, Math.max(1, top + Math.min(0.95, Math.max(0.05, fold.position)) * tall)));
  const drop = Math.max(1, Math.round(Math.max(0, fold.drop) * fontSize * d));
  const scale = 1 + Math.max(0, fold.spread);
  const cx = (outline.x - bounds.x + outline.width / 2) * d;
  const left = Math.ceil(cx * (scale - 1)) + 1;
  const right = Math.ceil((W - cx) * (scale - 1)) + 1;
  const lower = H - cut;
  const out = canvasOf(W + left + right, cut + drop + Math.ceil(lower * scale) + 1);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';

  const band = canvasOf(out.width, drop);
  const bctx = band.getContext('2d')!;
  for (let row = 0; row < drop; row++) {
    const k = 1 + (scale - 1) * ((row + 0.5) / drop);
    // Slightly taller than one pixel, so neighbouring rows overlap instead of leaving hairlines.
    bctx.drawImage(text, 0, cut - 1, W, 1, left + cx - cx * k, row, W * k, 1.6);
  }
  if (fold.shade !== 0) {
    bctx.globalCompositeOperation = 'source-atop';
    bctx.globalAlpha = Math.min(1, Math.abs(fold.shade));
    bctx.fillStyle = fold.shade > 0 ? '#ffffff' : '#000000';
    bctx.fillRect(0, 0, band.width, band.height);
  }
  ctx.drawImage(band, 0, cut);
  ctx.drawImage(text, 0, 0, W, cut, left, 0, W, cut);
  ctx.drawImage(text, 0, cut, W, lower, left + cx - cx * scale, cut + drop, W * scale, lower * scale);

  const upper = (cut - top) / d;
  return {
    canvas: out,
    bounds: { x: bounds.x - left / d, y: bounds.y, width: out.width / d, height: out.height / d },
    // What the selection frame should now enclose.
    outline: {
      x: outline.x - (outline.width * (scale - 1)) / 2,
      y: outline.y,
      width: outline.width * scale,
      height: upper + drop / d + (outline.height - upper) * scale,
    },
  };
}

const TILE = 256;
const tiles = new Map<string, HTMLCanvasElement>();

/**
 * A seamless tile of wear: opaque where ink is knocked out. Coarse patches plus fine grit,
 * cut off at the level that removes a set share of the surface: 0.7 x `amount` of it.
 */
function wearTile(seed: number, amount: number) {
  const key = `${seed}|${amount.toFixed(3)}`;
  let tile = tiles.get(key);
  if (tile) return tile;
  tile = canvasOf(TILE, TILE);
  const ctx = tile.getContext('2d')!;
  const img = ctx.createImageData(TILE, TILE);
  const n = makeNoise(seed * 7919 + 13);
  // Sampled on a torus (four shifted copies blended) so the tile repeats without seams.
  const sample = (u: number, v: number) => {
    const at = (x: number, y: number) => 0.62 * n.fbm(x * 5, y * 5, 4) + 0.38 * n.noise(x * 34, y * 34);
    const a = at(u, v);
    const b = at(u - 1, v);
    const c = at(u, v - 1);
    const d = at(u - 1, v - 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const values = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) values[y * TILE + x] = sample(x / TILE, y / TILE);
  // The cut-off is read from the noise itself, so the share removed is the share asked for
  // whatever the noise's distribution happens to be.
  const sorted = Float32Array.from(values).sort();
  const share = Math.min(0.7, Math.max(0, amount * 0.7));
  const threshold = sorted[Math.min(sorted.length - 1, Math.floor((1 - share) * sorted.length))];
  for (let i = 0; i < values.length; i++) img.data[i * 4 + 3] = 255 * smoothstep(threshold - 0.02, threshold + 0.02, values[i]);
  ctx.putImageData(img, 0, 0);
  tiles.set(key, tile);
  if (tiles.size > 12) tiles.delete(tiles.keys().next().value!);
  return tile;
}

/**
 * Applies the layer's text effects to a picture of its text and returns the (larger) result.
 * When an effect changes the shape of the text itself (fold), the new outline is returned too.
 */
export function applyTextEffects(picture: TextPicture, layer: TextLayer, textOutline: Rect): TextPicture & { outline?: Rect } {
  const fx = layer.effects;
  if (!hasTextEffects(fx)) return picture;
  let { canvas: text, bounds } = picture;
  let outline = textOutline;
  const d = picture.density;
  const size = layer.fontSize;
  const tctx = text.getContext('2d')!;

  if (fx.distress && fx.distress.amount > 0) {
    const pattern = tctx.createPattern(wearTile(fx.distress.seed, fx.distress.amount), 'repeat');
    if (pattern) {
      // One tile spans between 0.5 and 3 font sizes, anchored to the text box so it does not swim.
      const tileSize = size * (0.5 + fx.distress.scale * 2.5) * d;
      pattern.setTransform(new DOMMatrix().translate(-bounds.x * d, -bounds.y * d).scale(tileSize / TILE));
      tctx.save();
      tctx.globalCompositeOperation = 'destination-out';
      tctx.fillStyle = pattern;
      tctx.fillRect(0, 0, text.width, text.height);
      tctx.restore();
    }
  }

  if (fx.bevel && fx.bevel.depth > 0) {
    // Light from the top-left: the rim facing it brightens, the opposite rim darkens.
    const offset = Math.max(1, size * 0.035 * (0.4 + fx.bevel.depth) * d);
    const rim = (color: string, dx: number, dy: number) => {
      const c = silhouette(text, color);
      const ctx = c.getContext('2d')!;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(text, dx, dy);
      return c;
    };
    const light = rim('#ffffff', offset, offset);
    const dark = rim('#000000', -offset, -offset);
    tctx.save();
    tctx.globalCompositeOperation = 'source-atop';
    tctx.globalAlpha = 0.25 + 0.6 * fx.bevel.depth;
    tctx.drawImage(light, 0, 0);
    tctx.globalAlpha = 0.2 + 0.45 * fx.bevel.depth;
    tctx.drawImage(dark, 0, 0);
    tctx.restore();
  }

  // Fold reshapes the text; glow, depth and the background panel then follow the folded shape.
  if (fx.fold) {
    const folded = foldText(text, bounds, d, fx.fold, outline, size);
    text = folded.canvas;
    bounds = folded.bounds;
    outline = folded.outline;
  }

  const glowRadius = fx.glow ? fx.glow.size * size * 0.9 * d : 0;
  const depth = fx.extrude ? fx.extrude.depth * size * d : 0;
  // The panel reaches `padding` beyond the text block, which may be more than the picture's own margin.
  const panel = fx.backdrop
    ? { x: outline.x - fx.backdrop.padding * size, y: outline.y - fx.backdrop.padding * size, width: outline.width + fx.backdrop.padding * size * 2, height: outline.height + fx.backdrop.padding * size * 2 }
    : null;
  const overhang = panel
    ? Math.max(0, bounds.x - panel.x, bounds.y - panel.y, panel.x + panel.width - (bounds.x + bounds.width), panel.y + panel.height - (bounds.y + bounds.height)) * d
    : 0;
  const margin = Math.ceil(Math.max(glowRadius * 2.4 + depth, overhang) + 2);
  const out = canvasOf(text.width + margin * 2, text.height + margin * 2);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(text, margin, margin);

  if (fx.extrude && depth >= 0.5) {
    const block = silhouette(text, fx.extrude.color);
    const a = (fx.extrude.angle * Math.PI) / 180;
    const steps = Math.ceil(depth);
    ctx.globalCompositeOperation = 'destination-over';
    for (let i = 1; i <= steps; i++) {
      const k = (i / steps) * depth;
      ctx.drawImage(block, margin + Math.cos(a) * k, margin + Math.sin(a) * k);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  if (fx.glow && glowRadius >= 0.5 && fx.glow.strength > 0) {
    // Only the shadow of the picture is drawn (the picture itself is parked off-canvas),
    // which gives a blurred, tinted copy of its outline.
    const halo = (radius: number) => {
      const c = canvasOf(out.width, out.height);
      const g = c.getContext('2d')!;
      g.shadowColor = fx.glow!.color;
      g.shadowBlur = radius * 2;
      g.shadowOffsetX = out.width * 2;
      g.drawImage(out, -out.width * 2, 0);
      return c;
    };
    // A tight, bright halo inside a wide, soft one: the way a lit tube looks.
    const wide = halo(glowRadius);
    const tight = halo(glowRadius * 0.3);
    ctx.globalCompositeOperation = 'destination-over';
    const passes = 1 + Math.round(fx.glow.strength * 3);
    ctx.globalAlpha = Math.min(1, 0.45 + fx.glow.strength * 0.55);
    for (let i = 0; i < passes; i++) ctx.drawImage(tight, 0, 0);
    for (let i = 0; i < passes; i++) ctx.drawImage(wide, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  if (panel && fx.backdrop) {
    // Underneath everything else, so a glow lies on the panel rather than around it.
    const x = (panel.x - bounds.x) * d + margin;
    const y = (panel.y - bounds.y) * d + margin;
    const w = panel.width * d;
    const h = panel.height * d;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = fx.backdrop.color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(1, Math.max(0, fx.backdrop.radius)) * Math.min(w, h) * 0.5);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  return {
    canvas: out,
    bounds: { x: bounds.x - margin / d, y: bounds.y - margin / d, width: out.width / d, height: out.height / d },
    density: d,
    outline,
  };
}
