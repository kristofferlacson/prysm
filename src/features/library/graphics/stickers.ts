import { art, circle, definer, fill, poly, ring, rng, roundPoly, smooth, star, stroke, TAU, type Ctx, type Pt } from './helpers';
import type { GraphicDef } from './types';

const sticker = definer('Stickers');

/** Rounded speech balloon with its tail, as one outline. */
function balloon(ctx: Ctx) {
  const x0 = 6;
  const y0 = 7;
  const x1 = 115;
  const y1 = 70;
  const r = 17;
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x1, y0, x1, y1, r);
  ctx.arcTo(x1, y1, x0, y1, r);
  ctx.lineTo(58, y1);
  ctx.lineTo(27, 91);
  ctx.lineTo(34, y1);
  ctx.arcTo(x0, y1, x0, y0, r);
  ctx.arcTo(x0, y0, x1, y0, r);
  ctx.closePath();
}

/** Four-point sparkle with pinched, concave sides. */
function sparkle(ctx: Ctx, cx: number, cy: number, r: number) {
  const k = r * 0.13;
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + k, cy - k, cx + r, cy);
  ctx.quadraticCurveTo(cx + k, cy + k, cx, cy + r);
  ctx.quadraticCurveTo(cx - k, cy + k, cx - r, cy);
  ctx.quadraticCurveTo(cx - k, cy - k, cx, cy - r);
  ctx.closePath();
}

/** Irregular comic burst: tips and valleys wander a little, always the same way for a given seed. */
function burst(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, spikes: number, depth: number, seed: number) {
  const rand = rng(seed);
  const pts: Pt[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = ((i + (rand() - 0.5) * 0.45) / (spikes * 2)) * TAU - Math.PI / 2;
    const k = i % 2 ? depth + rand() * 0.07 : 0.82 + rand() * 0.18;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  poly(ctx, pts);
}

const BOLT: Pt[] = [[41, 4], [9, 54], [30, 54], [20, 91], [58, 38], [38, 38], [53, 4]];

export const STICKERS: GraphicDef[] = [
  sticker('sticker/sale-burst', 'Sale burst', ['sale', 'badge', 'starburst', 'offer', 'promo'], 1, ['#ff5a36', '#fff3df'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      star(ctx, 50, 50, 47, 39.5, 18);
      fill(ctx, c[0]);
      stroke(ctx, c[0], 2);
      ctx.beginPath();
      circle(ctx, 50, 50, 33.5);
      stroke(ctx, c[1], 1.5);
      ctx.beginPath();
      ring(ctx, 50, 50, 30, 44, 0.65);
      fill(ctx, c[1]);
    })),

  sticker('sticker/scallop-seal', 'Scalloped seal', ['seal', 'badge', 'stamp', 'award', 'label'], 1, ['#1f6f5c', '#f6e7c1'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      circle(ctx, 50, 50, 42);
      ring(ctx, 50, 50, 42, 20, 6.9);
      fill(ctx, c[0]);
      ctx.beginPath();
      circle(ctx, 50, 50, 37);
      stroke(ctx, c[1], 1.3);
      ctx.beginPath();
      circle(ctx, 50, 50, 30);
      stroke(ctx, c[1], 0.7);
      ctx.beginPath();
      ring(ctx, 50, 50, 33.5, 36, 0.8);
      fill(ctx, c[1]);
    })),

  sticker('sticker/ribbon-banner', 'Ribbon banner', ['ribbon', 'banner', 'title', 'label', 'award'], 3, ['#e63946', '#b9283a', '#7c1626'],
    art(300, 100, (ctx, c) => {
      for (const flip of [false, true]) {
        const x = (v: number) => (flip ? 300 - v : v);
        ctx.beginPath();
        poly(ctx, [[x(5), 32], [x(64), 32], [x(64), 90], [x(5), 90], [x(22), 61]]);
        fill(ctx, c[1]);
        ctx.beginPath();
        poly(ctx, [[x(42), 70], [x(64), 70], [x(64), 90]]);
        fill(ctx, c[2]);
      }
      ctx.fillStyle = c[0];
      ctx.fillRect(42, 11, 216, 59);
    })),

  sticker('sticker/speech-bubble', 'Speech bubble', ['speech', 'bubble', 'talk', 'quote', 'comic'], 1.25, ['#ffffff', '#1f1f2e', '#7c5cff'],
    art(125, 100, (ctx, c) => {
      ctx.save();
      ctx.translate(4.5, 4.5);
      ctx.beginPath();
      balloon(ctx);
      fill(ctx, c[2]);
      stroke(ctx, c[2], 2.6);
      ctx.restore();
      ctx.beginPath();
      balloon(ctx);
      fill(ctx, c[0]);
      stroke(ctx, c[1], 2.6);
    })),

  sticker('sticker/thought-bubble', 'Thought bubble', ['thought', 'bubble', 'cloud', 'think', 'comic'], 1.25, ['#eef6ff', '#27408b'],
    art(125, 100, (ctx, c) => {
      // Stroking every puff and then filling them all leaves an outline only around the outside of the cloud.
      ctx.beginPath();
      for (const [x, y, r] of [[41, 40, 19], [64, 31, 22], [89, 41, 19], [80, 56, 19], [55, 57, 19], [31, 53, 15], [32, 84, 6], [19, 92.5, 3.3]]) {
        circle(ctx, x, y, r);
      }
      stroke(ctx, c[1], 5);
      fill(ctx, c[0]);
    })),

  sticker('sticker/curved-arrow', 'Curved arrow', ['arrow', 'pointer', 'hand drawn', 'doodle', 'direction'], 1.6, ['#1f1f2e'],
    art(160, 100, (ctx, c) => {
      const bend: Pt = [118, -17];
      const tip: Pt = [144, 76];
      ctx.beginPath();
      ctx.moveTo(10, 86);
      ctx.bezierCurveTo(20, 1, bend[0], bend[1], tip[0], tip[1]);
      // Two slightly unequal barbs give the head a drawn-by-hand feel.
      const back = Math.atan2(bend[1] - tip[1], bend[0] - tip[0]);
      for (const [turn, len] of [[-0.62, 27], [0.5, 23]]) {
        const a = back + turn;
        ctx.moveTo(tip[0], tip[1]);
        ctx.quadraticCurveTo(
          tip[0] + Math.cos(a + turn * 0.25) * len * 0.5,
          tip[1] + Math.sin(a + turn * 0.25) * len * 0.5,
          tip[0] + Math.cos(a) * len,
          tip[1] + Math.sin(a) * len,
        );
      }
      stroke(ctx, c[0], 5.5);
    })),

  sticker('sticker/heart', 'Heart', ['heart', 'love', 'like', 'valentine'], 1, ['#ff3b6b', '#ffd0dc'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      ctx.moveTo(50, 91);
      ctx.bezierCurveTo(18, 68, 5, 49, 5, 32);
      ctx.bezierCurveTo(5, 18, 16, 8, 29, 8);
      ctx.bezierCurveTo(38, 8, 46, 13, 50, 21);
      ctx.bezierCurveTo(54, 13, 62, 8, 71, 8);
      ctx.bezierCurveTo(84, 8, 95, 18, 95, 32);
      ctx.bezierCurveTo(95, 49, 82, 68, 50, 91);
      ctx.closePath();
      fill(ctx, c[0]);
      ctx.beginPath();
      ctx.moveTo(15.5, 33);
      ctx.quadraticCurveTo(15.5, 19.5, 28, 18);
      stroke(ctx, c[1], 3.6);
    })),

  sticker('sticker/sparkle-cluster', 'Sparkle cluster', ['sparkle', 'star', 'shine', 'magic', 'twinkle'], 1, ['#ffc531', '#ff8a3d'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      sparkle(ctx, 41, 58, 37);
      fill(ctx, c[0]);
      ctx.beginPath();
      sparkle(ctx, 79, 23, 18);
      sparkle(ctx, 84, 82, 10);
      circle(ctx, 14, 16, 2.6);
      fill(ctx, c[1]);
    })),

  sticker('sticker/lightning-bolt', 'Lightning bolt', ['lightning', 'bolt', 'flash', 'energy', 'power'], 0.7, ['#ffd60a', '#1f1f2e'],
    art(70, 100, (ctx, c) => {
      ctx.beginPath();
      poly(ctx, BOLT.map(([x, y]): Pt => [x + 4, y + 4]));
      fill(ctx, c[1]);
      stroke(ctx, c[1], 2.6);
      ctx.beginPath();
      poly(ctx, BOLT);
      fill(ctx, c[0]);
      stroke(ctx, c[1], 2.6);
    })),

  sticker('sticker/pow-burst', 'Comic burst', ['comic', 'burst', 'pow', 'explosion', 'pop art'], 1.2, ['#ffd400', '#ff4d2e', '#1b1b1f'],
    art(120, 100, (ctx, c) => {
      ctx.beginPath();
      burst(ctx, 60.5, 50.5, 54, 44, 13, 0.62, 7);
      fill(ctx, c[2]);
      stroke(ctx, c[2], 2.2);
      ctx.beginPath();
      burst(ctx, 55.5, 45.5, 54, 44, 13, 0.62, 7);
      fill(ctx, c[0]);
      stroke(ctx, c[2], 2.2);
      ctx.beginPath();
      burst(ctx, 55.5, 45.5, 32, 25, 11, 0.68, 19);
      fill(ctx, c[1]);
      stroke(ctx, c[2], 1.6);
    })),

  sticker('sticker/price-tag', 'Price tag', ['price', 'tag', 'label', 'sale', 'shop'], 1.6, ['#f2b134', '#3a2e1f'],
    art(160, 100, (ctx, c) => {
      ctx.translate(-1, 4.5);
      ctx.beginPath();
      roundPoly(ctx, [[12, 52], [42, 18], [153, 18], [153, 86], [42, 86]], 7);
      circle(ctx, 40, 52, 6);
      fill(ctx, c[0], 'evenodd');
      ctx.beginPath();
      circle(ctx, 40, 52, 8.6);
      stroke(ctx, c[1], 2);
      ctx.save();
      ctx.setLineDash([3, 2.6]);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      roundPoly(ctx, [[60, 27], [144, 27], [144, 77], [60, 77]], 4);
      stroke(ctx, c[1], 1);
      ctx.restore();
      // A loop of string threaded through the hole.
      ctx.beginPath();
      ctx.moveTo(38, 51);
      ctx.bezierCurveTo(14, 44, 2, 14, 16, 7);
      ctx.bezierCurveTo(30, 0, 38, 30, 39.5, 50);
      stroke(ctx, c[1], 1.8);
    })),

  sticker('sticker/ticket-stub', 'Ticket stub', ['ticket', 'stub', 'coupon', 'admit', 'event'], 2, ['#3d5a80', '#f7ede2', '#ee6c4d'],
    art(200, 100, (ctx, c) => {
      const tear = 142;
      const notch = 7;
      ctx.beginPath();
      ctx.moveTo(11, 7);
      ctx.lineTo(tear - notch, 7);
      ctx.arc(tear, 7, notch, Math.PI, 0, true);
      ctx.arcTo(196, 7, 196, 93, 7);
      ctx.arcTo(196, 93, 4, 93, 7);
      ctx.lineTo(tear + notch, 93);
      ctx.arc(tear, 93, notch, 0, Math.PI, true);
      ctx.arcTo(4, 93, 4, 7, 7);
      ctx.arcTo(4, 7, 196, 7, 7);
      ctx.closePath();
      fill(ctx, c[0]);
      ctx.beginPath();
      roundPoly(ctx, [[12, 15], [tear - 12, 15], [tear - 12, 85], [12, 85]], 3);
      stroke(ctx, c[1], 1);
      ctx.beginPath();
      ctx.moveTo(tear, 20);
      ctx.lineTo(tear, 80);
      ctx.setLineDash([3.2, 3.3]);
      ctx.lineCap = 'butt';
      stroke(ctx, c[1], 1.3);
      ctx.beginPath();
      star(ctx, 170, 51, 13, 5.4, 5);
      fill(ctx, c[2]);
    })),

  sticker('sticker/sun', 'Sun', ['sun', 'summer', 'sunny', 'weather', 'rays'], 1, ['#ffb703', '#fb8500'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const tip = i % 2 ? 39 : 47;
        const half = 0.11;
        ctx.moveTo(50 + Math.cos(a - half) * 28, 50 + Math.sin(a - half) * 28);
        ctx.lineTo(50 + Math.cos(a) * tip, 50 + Math.sin(a) * tip);
        ctx.lineTo(50 + Math.cos(a + half) * 28, 50 + Math.sin(a + half) * 28);
        ctx.closePath();
      }
      fill(ctx, c[1]);
      stroke(ctx, c[1], 1.6);
      ctx.beginPath();
      circle(ctx, 50, 50, 22.5);
      fill(ctx, c[0]);
    })),

  sticker('sticker/paint-splat', 'Paint splat', ['paint', 'splat', 'splash', 'blob', 'ink'], 1, ['#7b2cbf', '#c77dff'],
    art(100, 100, (ctx, c) => {
      const rand = rng(23);
      const pts: Pt[] = [];
      const n = 22;
      for (let i = 0; i < n; i++) {
        const a = ((i + (rand() - 0.5) * 0.5) / n) * TAU;
        const r = i % 2 ? 19 + rand() * 6 : 30 + rand() * 17;
        pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
      }
      ctx.beginPath();
      smooth(ctx, pts);
      for (let i = 0; i < 6; i++) {
        const a = ((i + rand() * 0.7) / 6) * TAU;
        const d = 38 + rand() * 6;
        circle(ctx, 50 + Math.cos(a) * d, 50 + Math.sin(a) * d, 1.6 + rand() * 2.4);
      }
      fill(ctx, c[0]);
      ctx.beginPath();
      ctx.arc(50, 50, 14, Math.PI * 1.08, Math.PI * 1.42);
      stroke(ctx, c[1], 3.4);
    })),
];
