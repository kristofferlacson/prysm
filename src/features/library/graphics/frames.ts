import { art, circle, definer, fill, leaf, poly, rng, rrect, stroke, TAU, type Ctx, type Pt } from './helpers';
import type { GraphicDef } from './types';

const frame = definer('Frames');

/**
 * Most frames are drawn in real box units rather than a stretched design space, so a border keeps an
 * even weight when the frame is resized to a different proportion. `u` is 1% of the box's short side.
 */
const framed =
  (paint: (ctx: Ctx, w: number, h: number, u: number, c: string[]) => void): GraphicDef['draw'] =>
  (ctx, w, h, colors) => {
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    paint(ctx, w, h, Math.min(w, h) / 100, colors);
    ctx.restore();
  };

/** Rectangle path inset by d from every edge of the box. */
function inset(ctx: Ctx, w: number, h: number, d: number, r = 0) {
  if (r) rrect(ctx, d, d, w - 2 * d, h - 2 * d, r);
  else ctx.rect(d, d, w - 2 * d, h - 2 * d);
}

/** One corner ornament in local units: origin at the corner, both axes running inward along the edges. */
function flourish(ctx: Ctx, c: string[]) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const mirror of [false, true]) {
    ctx.save();
    if (mirror) ctx.transform(0, 1, 1, 0, 0, 0);
    // Edge line that rolls into a scroll.
    ctx.beginPath();
    ctx.moveTo(40, 5);
    ctx.lineTo(21, 5);
    for (let i = 1; i <= 48; i++) {
      const t = i / 48;
      const a = -Math.PI / 2 - t * TAU * 1.35;
      const r = 5.2 * (1 - 0.74 * t);
      ctx.lineTo(21 + Math.cos(a) * r, 10.2 + Math.sin(a) * r);
    }
    // A smaller counter-scroll hanging under the line.
    ctx.moveTo(34, 5);
    for (let i = 1; i <= 36; i++) {
      const t = i / 36;
      const a = -Math.PI / 2 + t * TAU * 1.1;
      const r = 2.9 * (1 - 0.7 * t);
      ctx.lineTo(34 + Math.cos(a) * r, 7.9 + Math.sin(a) * r);
    }
    stroke(ctx, c[0], 0.9);
    ctx.beginPath();
    leaf(ctx, 27, 5, 32, 1.2, 0.2);
    circle(ctx, 42.5, 5, 0.9);
    fill(ctx, c[1]);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(13, 13, 9.5, Math.PI, Math.PI * 1.5);
  stroke(ctx, c[0], 0.9);
  ctx.beginPath();
  leaf(ctx, 4.2, 4.2, 14.5, 14.5, 0.17);
  circle(ctx, 2.6, 2.6, 0.9);
  fill(ctx, c[1]);
}

export const FRAMES: GraphicDef[] = [
  frame('frame/double-line', 'Double line', ['border', 'double', 'line', 'classic', 'minimal'], 0.8, ['#1f1f2e'],
    framed((ctx, w, h, u, c) => {
      ctx.beginPath();
      inset(ctx, w, h, 2.2 * u);
      stroke(ctx, c[0], 1.6 * u);
      ctx.beginPath();
      inset(ctx, w, h, 5.4 * u);
      stroke(ctx, c[0], 0.55 * u);
    })),

  frame('frame/bold-inline', 'Bold with inner line', ['border', 'thick', 'bold', 'inline', 'poster'], 1, ['#1d3557', '#e63946'],
    framed((ctx, w, h, u, c) => {
      ctx.beginPath();
      inset(ctx, w, h, 2.75 * u);
      stroke(ctx, c[0], 5.5 * u);
      ctx.beginPath();
      inset(ctx, w, h, 8.4 * u);
      stroke(ctx, c[1], 0.9 * u);
    })),

  // 0.85 makes the window square: side margins and top are 6% of the width, the bottom 20% of the height.
  frame('frame/polaroid', 'Instant photo', ['polaroid', 'photo', 'instant', 'snapshot', 'retro'], 0.85, ['#fdfcf7', '#d5cfc1'],
    framed((ctx, w, h, u, c) => {
      const m = w * 0.06;
      const photo = [m, m, w - 2 * m, h * 0.8 - m] as const;
      ctx.beginPath();
      inset(ctx, w, h, 0, 1.6 * u);
      ctx.rect(...photo);
      fill(ctx, c[0], 'evenodd');
      ctx.beginPath();
      inset(ctx, w, h, 0.25 * u, 1.4 * u);
      ctx.rect(...photo);
      stroke(ctx, c[1], 0.5 * u);
    })),

  frame('frame/film-strip', 'Film strip', ['film', 'strip', 'cinema', 'movie', 'photo', 'negative'], 2.6, ['#17171c'],
    art(260, 100, (ctx, c) => {
      ctx.beginPath();
      rrect(ctx, 0, 0, 260, 100, 2);
      for (let i = 0; i < 20; i++) {
        rrect(ctx, 3 + i * 13, 5, 7, 8.5, 1.6);
        rrect(ctx, 3 + i * 13, 86.5, 7, 8.5, 1.6);
      }
      for (let i = 0; i < 3; i++) rrect(ctx, 8 + i * 84, 20, 76, 60, 2);
      fill(ctx, c[0], 'evenodd');
    })),

  frame('frame/corner-brackets', 'Corner brackets', ['corners', 'brackets', 'crop', 'focus', 'minimal'], 1, ['#1f1f2e'],
    framed((ctx, w, h, u, c) => {
      const d = 3 * u;
      const arm = 17 * u;
      ctx.beginPath();
      for (const [x, y, sx, sy] of [[d, d, 1, 1], [w - d, d, -1, 1], [w - d, h - d, -1, -1], [d, h - d, 1, -1]]) {
        ctx.moveTo(x + sx * arm, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * arm);
      }
      stroke(ctx, c[0], 2.4 * u);
    })),

  frame('frame/ornate-corners', 'Ornate corners', ['ornate', 'corners', 'flourish', 'vintage', 'wedding', 'elegant'], 0.8, ['#9c7a3c', '#c9a659'],
    framed((ctx, w, h, u, c) => {
      for (const [sx, sy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        ctx.save();
        ctx.translate(sx > 0 ? 0 : w, sy > 0 ? 0 : h);
        ctx.scale(sx * u, sy * u);
        flourish(ctx, c);
        ctx.restore();
      }
      // Hairlines joining the corners along each edge.
      const d = 5 * u;
      const gap = 45.5 * u;
      ctx.beginPath();
      for (const y of [d, h - d]) {
        ctx.moveTo(gap, y);
        ctx.lineTo(w - gap, y);
      }
      for (const x of [d, w - d]) {
        ctx.moveTo(x, gap);
        ctx.lineTo(x, h - gap);
      }
      stroke(ctx, c[0], 0.9 * u);
    })),

  frame('frame/rounded-dashed', 'Rounded dashed', ['dashed', 'rounded', 'border', 'coupon', 'cut out'], 1.25, ['#ff6b6b'],
    framed((ctx, w, h, u, c) => {
      const d = 3 * u;
      const r = 9 * u;
      // Fit a whole number of dashes around the outline so the pattern closes without a seam.
      const length = 2 * (w + h - 4 * d) - 8 * r + TAU * r;
      const period = length / Math.max(4, Math.round(length / (9 * u)));
      ctx.setLineDash([period * 0.5, period * 0.5]);
      ctx.lineCap = 'round';
      ctx.beginPath();
      inset(ctx, w, h, d, r);
      stroke(ctx, c[0], 1.8 * u);
    })),

  frame('frame/circle-ring', 'Circle ring', ['circle', 'ring', 'round', 'portrait', 'badge'], 1, ['#264653', '#e9c46a'],
    framed((ctx, w, h, u, c) => {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2 - 2.2 * u, h / 2 - 2.2 * u, 0, 0, TAU);
      stroke(ctx, c[0], 4.4 * u);
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2 - 6.6 * u, h / 2 - 6.6 * u, 0, 0, TAU);
      stroke(ctx, c[1], 1.1 * u);
    })),

  frame('frame/ticket', 'Ticket', ['ticket', 'coupon', 'voucher', 'notched', 'admit'], 1.8, ['#d62828', '#003049'],
    framed((ctx, w, h, u, c) => {
      const d = 2 * u;
      const r = 6 * u;
      const half = Math.PI / 2;
      // Scooped corners and a bite out of each short side; every arc curves into the frame.
      ctx.beginPath();
      ctx.moveTo(d + r, d);
      ctx.lineTo(w - d - r, d);
      ctx.arc(w - d, d, r, Math.PI, half, true);
      ctx.lineTo(w - d, h / 2 - r);
      ctx.arc(w - d, h / 2, r, -half, half, true);
      ctx.lineTo(w - d, h - d - r);
      ctx.arc(w - d, h - d, r, -half, Math.PI, true);
      ctx.lineTo(d + r, h - d);
      ctx.arc(d, h - d, r, 0, -half, true);
      ctx.lineTo(d, h / 2 + r);
      ctx.arc(d, h / 2, r, half, -half, true);
      ctx.lineTo(d, d + r);
      ctx.arc(d, d, r, half, 0, true);
      ctx.closePath();
      stroke(ctx, c[0], 2 * u);
      ctx.setLineDash([2.4 * u, 1.8 * u]);
      ctx.beginPath();
      inset(ctx, w, h, 12 * u);
      stroke(ctx, c[1], 0.7 * u);
    })),

  frame('frame/torn-paper', 'Torn paper', ['torn', 'paper', 'ripped', 'scrapbook', 'collage', 'rough'], 1.25, ['#f3ead7', '#cbbd9d'],
    framed((ctx, w, h, u, c) => {
      const rand = rng(41);
      const base = 3.4 * u;
      // The number of tears follows the box proportion only, so the edge is the same at every size.
      const nx = Math.max(8, Math.round(w / (1.9 * u)));
      const ny = Math.max(8, Math.round(h / (1.9 * u)));
      const along = () => (rand() - 0.5) * 1.2 * u;
      // A slow drift plus fine jitter: long ragged runs with small fibres on top.
      let drift = 0;
      const depth = () => {
        drift = drift * 0.72 + (rand() - 0.5) * 1.9 * u;
        return Math.max(0.4 * u, base + drift + (rand() - 0.5) * 1.5 * u);
      };
      const pts: Pt[] = [];
      for (let i = 0; i < nx; i++) pts.push([base + ((w - 2 * base) * i) / nx + along(), depth()]);
      for (let i = 0; i < ny; i++) pts.push([w - depth(), base + ((h - 2 * base) * i) / ny + along()]);
      for (let i = 0; i < nx; i++) pts.push([w - base - ((w - 2 * base) * i) / nx + along(), h - depth()]);
      for (let i = 0; i < ny; i++) pts.push([depth(), h - base - ((h - 2 * base) * i) / ny + along()]);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      poly(ctx, pts);
      inset(ctx, w, h, 12 * u);
      fill(ctx, c[0], 'evenodd');
      ctx.beginPath();
      inset(ctx, w, h, 12 * u);
      stroke(ctx, c[1], 0.5 * u);
    })),
];
