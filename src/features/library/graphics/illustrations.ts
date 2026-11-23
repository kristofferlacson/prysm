import { art, circle, definer, fill, leaf, poly, rng, roundPoly, rrect, smooth, stroke, type Ctx, type Pt } from './helpers';
import type { GraphicDef } from './types';

const illustration = definer('Illustrations');

/** Tapered slit running from a rounded inner end out past the leaf edge. */
function slit(ctx: Ctx, ix: number, iy: number, ox: number, oy: number, wide: number) {
  const a = Math.atan2(oy - iy, ox - ix);
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  const r = 1.3;
  ctx.moveTo(ox + nx * wide, oy + ny * wide);
  ctx.lineTo(ix + nx * r, iy + ny * r);
  ctx.arc(ix, iy, r, a + Math.PI / 2, a - Math.PI / 2);
  ctx.lineTo(ox - nx * wide, oy - ny * wide);
  ctx.closePath();
}

/** A hill: a soft ridge line closed off along the bottom of the 100-unit square. */
function hill(ctx: Ctx, y0: number, curves: number[][]) {
  ctx.moveTo(0, y0);
  for (const [a, b, c, d, x, y] of curves) ctx.bezierCurveTo(a, b, c, d, x, y);
  ctx.lineTo(100, 100);
  ctx.lineTo(0, 100);
  ctx.closePath();
}

function pine(ctx: Ctx, x: number, y: number, s: number) {
  poly(ctx, [[x - 3.2 * s, y], [x, y - 7 * s], [x + 3.2 * s, y]]);
  poly(ctx, [[x - 2.5 * s, y - 4.2 * s], [x, y - 10.5 * s], [x + 2.5 * s, y - 4.2 * s]]);
  ctx.rect(x - 0.5 * s, y - 0.2, s, 2.4 * s);
}

type Roof = 'flat' | 'antenna' | 'step' | 'spire' | 'slant';
const GROUND = 93;
const TOWERS: [x: number, w: number, h: number, roof: Roof][] = [
  [3, 15, 30, 'flat'], [20, 14, 49, 'antenna'], [36, 20, 37, 'step'], [58, 13, 58, 'spire'], [73, 21, 43, 'slant'],
  [96, 17, 70, 'antenna'], [115, 20, 39, 'flat'], [137, 14, 55, 'step'], [153, 19, 33, 'slant'], [174, 12, 50, 'spire'],
  [187, 10, 26, 'flat'],
];

export const ILLUSTRATIONS: GraphicDef[] = [
  illustration('illustration/mountain-sun', 'Mountains and sun', ['mountain', 'sun', 'peak', 'landscape', 'outdoor', 'nature'], 1.25,
    ['#2f4858', '#5f8d9b', '#f6ae2d', '#f6f3ec'],
    art(125, 100, (ctx, c) => {
      ctx.beginPath();
      circle(ctx, 88, 25, 15);
      fill(ctx, c[2]);
      ctx.beginPath();
      poly(ctx, [[24, 92], [70, 26], [92, 56], [103, 45], [122, 92]]);
      fill(ctx, c[1]);
      ctx.beginPath();
      poly(ctx, [[3, 92], [40, 40], [56, 61], [66, 51], [97, 92]]);
      fill(ctx, c[0]);
      ctx.beginPath();
      poly(ctx, [[70, 26], [79.2, 38.6], [74, 36], [70, 41], [65.5, 36], [60.8, 39.2]]);
      poly(ctx, [[40, 40], [48.8, 51.5], [44, 49], [40.2, 54], [36, 49], [31.9, 51.4]]);
      fill(ctx, c[3]);
    })),

  illustration('illustration/layered-hills', 'Layered hills', ['hills', 'landscape', 'valley', 'nature', 'scenery', 'round'], 1,
    ['#fdebd0', '#f2b872', '#7fa99b', '#35605a'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      circle(ctx, 50, 50, 48);
      ctx.clip();
      ctx.fillStyle = c[0];
      ctx.fillRect(0, 0, 100, 100);
      ctx.beginPath();
      hill(ctx, 58, [[16, 42, 36, 40, 54, 52], [68, 61, 84, 56, 100, 44]]);
      fill(ctx, c[1]);
      ctx.beginPath();
      hill(ctx, 66, [[18, 68, 30, 56, 50, 61], [70, 66, 84, 78, 100, 68]]);
      fill(ctx, c[2]);
      ctx.beginPath();
      hill(ctx, 86, [[22, 72, 44, 86, 62, 83], [78, 80, 90, 74, 100, 78]]);
      pine(ctx, 27, 62.5, 1);
      pine(ctx, 36, 60.5, 0.72);
      pine(ctx, 72, 67.5, 0.85);
      fill(ctx, c[3]);
    })),

  illustration('illustration/potted-plant', 'Potted plant', ['plant', 'pot', 'houseplant', 'leaves', 'botanical', 'home'], 0.8,
    ['#d1603d', '#a8452a', '#2d6a4f', '#74c69d'],
    art(80, 100, (ctx, c) => {
      const tip = (deg: number, len: number): Pt => {
        const a = (deg * Math.PI) / 180;
        return [40 + Math.sin(a) * len, 64 - Math.cos(a) * len];
      };
      // Back leaves first, then the lighter pair in front; each gets a midrib in the other green.
      const leaves: [deg: number, len: number, tone: number][] = [[-64, 40, 2], [64, 40, 2], [0, 58, 2], [-31, 52, 3], [31, 52, 3]];
      for (const [deg, len, tone] of leaves) {
        const [x, y] = tip(deg, len);
        ctx.beginPath();
        leaf(ctx, 40, 64, x, y, 0.19);
        fill(ctx, c[tone]);
        ctx.beginPath();
        ctx.moveTo(40, 64);
        ctx.lineTo(...tip(deg, len * 0.82));
        stroke(ctx, c[5 - tone], 0.9);
      }
      ctx.beginPath();
      roundPoly(ctx, [[23, 66], [57, 66], [52.5, 96], [27.5, 96]], 3);
      fill(ctx, c[0]);
      ctx.beginPath();
      rrect(ctx, 19.5, 60.5, 41, 8.5, 2.2);
      fill(ctx, c[1]);
    })),

  illustration('illustration/monstera-leaf', 'Tropical leaf', ['leaf', 'tropical', 'monstera', 'jungle', 'botanical', 'plant'], 1,
    ['#1f7a5a', '#bfe3c0'],
    art(100, 100, (ctx, c) => {
      const side = (x: number, mirror: boolean) => (mirror ? 100 - x : x);
      ctx.beginPath();
      ctx.moveTo(50, 70);
      ctx.quadraticCurveTo(51, 86, 45, 97);
      stroke(ctx, c[0], 2.8);
      // Clip away the slits and holes, then fill the heart-shaped blade through what is left.
      ctx.save();
      ctx.beginPath();
      ctx.rect(-20, -20, 140, 140);
      for (const mirror of [false, true]) {
        for (const [ix, iy, ox, oy] of [[61, 25, 84, 0], [65, 39, 104, 22], [66, 53, 108, 55], [62, 66, 98, 92]]) {
          slit(ctx, side(ix, mirror), iy, side(ox, mirror), oy, 4.6);
        }
        for (const [x, y] of [[57.5, 33], [58.5, 47], [58, 60.5]]) {
          ctx.moveTo(side(x, mirror) + 2.7, y);
          ctx.ellipse(side(x, mirror), y, 2.7, 1.5, mirror ? 0.5 : -0.5, 0, Math.PI * 2);
        }
      }
      ctx.clip('evenodd');
      ctx.beginPath();
      ctx.moveTo(50, 75);
      ctx.bezierCurveTo(40, 93, 8, 86, 5, 55);
      ctx.bezierCurveTo(3, 27, 30, 8, 50, 4);
      ctx.bezierCurveTo(70, 8, 97, 27, 95, 55);
      ctx.bezierCurveTo(92, 86, 60, 93, 50, 75);
      ctx.closePath();
      fill(ctx, c[0]);
      ctx.restore();
      // Midrib and one vein down the middle of every lobe.
      ctx.beginPath();
      ctx.moveTo(50, 75);
      ctx.lineTo(50, 12);
      for (const mirror of [false, true]) {
        for (const [y, vx, vy] of [[24, 62, 13], [34, 78, 22], [47, 85, 40], [61, 85, 68], [72, 68, 82]]) {
          ctx.moveTo(50, y);
          ctx.quadraticCurveTo(side(50 + (vx - 50) * 0.5, mirror), y + (vy - y) * 0.35, side(vx, mirror), vy);
        }
      }
      stroke(ctx, c[1], 1);
    })),

  illustration('illustration/organic-blobs', 'Organic shapes', ['abstract', 'blob', 'organic', 'shapes', 'boho', 'modern'], 1.2,
    ['#e07a5f', '#f2cc8f', '#81b29a', '#3d405b'],
    art(120, 100, (ctx, c) => {
      ctx.beginPath();
      smooth(ctx, [[58, 52], [78, 30], [106, 36], [116, 62], [100, 92], [70, 90]]);
      fill(ctx, c[1]);
      ctx.beginPath();
      smooth(ctx, [[12, 36], [30, 6], [62, 4], [80, 30], [68, 62], [38, 72], [16, 60]]);
      fill(ctx, c[0]);
      ctx.beginPath();
      smooth(ctx, [[8, 76], [22, 58], [44, 66], [48, 88], [28, 100], [10, 92]]);
      fill(ctx, c[2]);
      ctx.beginPath();
      for (const r of [14, 20, 26]) {
        ctx.moveTo(86, 30 - r);
        ctx.arc(86, 30, r, -Math.PI / 2, 0);
      }
      stroke(ctx, c[3], 1.6);
      ctx.beginPath();
      for (let i = 0; i < 12; i++) circle(ctx, 78 + (i % 4) * 7, 62 + Math.floor(i / 4) * 7, 1.3);
      circle(ctx, 52, 78, 4.5);
      fill(ctx, c[3]);
    })),

  illustration('illustration/retro-sunset', 'Retro sunset', ['sunset', 'retro', 'sun', 'stripes', '80s', 'vaporwave'], 1,
    ['#ffd23f', '#ff7b54', '#c9184a'],
    art(100, 100, (ctx, c) => {
      const glow = ctx.createLinearGradient(0, 3, 0, 97);
      glow.addColorStop(0, c[0]);
      glow.addColorStop(0.55, c[1]);
      glow.addColorStop(1, c[2]);
      ctx.beginPath();
      circle(ctx, 50, 50, 47);
      ctx.clip();
      // Solid top half, then bands that thin out as the transparent stripes between them widen.
      ctx.beginPath();
      ctx.rect(0, 0, 100, 47);
      let y = 47;
      for (let i = 0; i < 6; i++) {
        y += 1.4 + i * 0.9;
        ctx.rect(0, y, 100, 8 - i);
        y += 8 - i;
      }
      fill(ctx, glow);
    })),

  illustration('illustration/city-skyline', 'City skyline', ['city', 'skyline', 'buildings', 'urban', 'night', 'silhouette'], 2,
    ['#22223b', '#9a8c98', '#f2e9e4'],
    art(200, 100, (ctx, c) => {
      ctx.beginPath();
      for (const [x, w, h] of [[10, 17, 42], [30, 20, 60], [54, 16, 47], [82, 24, 64], [110, 16, 80], [128, 18, 52], [146, 22, 66], [170, 20, 45]]) {
        ctx.rect(x, GROUND - h, w, h);
      }
      fill(ctx, c[1]);
      ctx.beginPath();
      for (const [x, w, h, roof] of TOWERS) {
        const top = GROUND - h;
        ctx.rect(x, top, w, h);
        if (roof === 'antenna') {
          ctx.rect(x + w / 2 - 3.5, top - 4, 7, 4);
          ctx.rect(x + w / 2 - 0.6, top - 14, 1.2, 10);
        } else if (roof === 'step') {
          ctx.rect(x + 3, top - 5, w - 6, 5);
          ctx.rect(x + 6, top - 9, w - 12, 4);
        } else if (roof === 'spire') {
          poly(ctx, [[x, top], [x + w / 2, top - 13], [x + w, top]]);
        } else if (roof === 'slant') {
          poly(ctx, [[x, top], [x + w, top - 8], [x + w, top]]);
        }
      }
      ctx.rect(0, GROUND, 200, 3);
      fill(ctx, c[0]);
      // Lit windows: a fixed scatter over each tower's window grid.
      const rand = rng(8);
      ctx.beginPath();
      for (const [x, w, h] of TOWERS) {
        const cols = Math.floor((w - 3) / 4.5);
        const left = x + (w - cols * 4.5 + 2) / 2;
        for (let row = 0; row < Math.floor((h - 6) / 6); row++) {
          for (let col = 0; col < cols; col++) {
            if (rand() < 0.5) ctx.rect(left + col * 4.5, GROUND - h + 4 + row * 6, 2.5, 3.2);
          }
        }
      }
      fill(ctx, c[2]);
    })),

  illustration('illustration/ocean-waves', 'Ocean waves', ['ocean', 'waves', 'sea', 'water', 'beach', 'summer'], 1.5,
    ['#bde0fe', '#5fb0e8', '#1d7fc4', '#0b3c7a'],
    art(150, 100, (ctx, c) => {
      ctx.beginPath();
      rrect(ctx, 2, 0, 146, 98, 9);
      ctx.clip();
      const span = 32;
      for (let i = 0; i < 4; i++) {
        const y = 4 + i * 23;
        ctx.beginPath();
        ctx.moveTo(-span, 100);
        ctx.lineTo(-span, y);
        // Each crest leans forward a little before dropping into the next trough.
        for (let x = -span + (i % 2 ? span / 2 : 0) - (i > 1 ? 9 : 0); x < 150; x += span) {
          ctx.lineTo(x, y);
          ctx.bezierCurveTo(x + span * 0.16, y + 15, x + span * 0.74, y + 17, x + span, y);
        }
        ctx.lineTo(190, 100);
        ctx.closePath();
        fill(ctx, c[i]);
      }
    })),
];
