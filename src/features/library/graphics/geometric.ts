import { art, circle, definer, fill, poly, rng, stroke, TAU, type Ctx, type Pt } from './helpers';
import type { GraphicDef } from './types';

const geometric = definer('Geometric');

/** Short zigzag of `bumps` peaks centred on the origin. */
function zig(ctx: Ctx, bumps: number, step: number, amp: number) {
  const pts: Pt[] = [];
  for (let i = 0; i <= bumps * 2; i++) pts.push([(i - bumps) * step, i % 2 ? -amp : amp]);
  poly(ctx, pts, false);
}

/** Wavy line of `humps` alternating arcs, centred on the origin. */
function wave(ctx: Ctx, humps: number, step: number, amp: number) {
  const x0 = (-humps * step) / 2;
  ctx.moveTo(x0, 0);
  for (let i = 0; i < humps; i++) {
    ctx.quadraticCurveTo(x0 + (i + 0.5) * step, i % 2 ? amp * 2 : -amp * 2, x0 + (i + 1) * step, 0);
  }
}

const triangle = (ctx: Ctx, r: number) => poly(ctx, [[0, -r], [r * 0.87, r * 0.5], [-r * 0.87, r * 0.5]]);

/** The confetti scatter, placed by hand so the pieces never collide: kind, x, y, size, turn in degrees, colour slot. */
type Piece = ['disc' | 'ring' | 'tri' | 'tri-line' | 'zig' | 'wave' | 'plus', number, number, number, number, number];
const CONFETTI: Piece[] = [
  ['disc', 19, 20, 8.5, 0, 0], ['disc', 80, 73, 6, 0, 1], ['ring', 63, 17, 6.5, 0, 2], ['ring', 12, 62, 4, 0, 3],
  ['tri', 41, 30, 9, 14, 1], ['tri', 24, 84, 8.5, -22, 2], ['tri-line', 87, 22, 7, 38, 3], ['tri-line', 58, 86, 7.5, 190, 0],
  ['zig', 64, 47, 5, -24, 3], ['wave', 30, 54, 6.5, 28, 0], ['wave', 89, 48, 6, 70, 2], ['plus', 44, 71, 5, 20, 3],
  ['disc', 8, 40, 2.2, 0, 0], ['disc', 50, 10, 2.2, 0, 0], ['disc', 72, 62, 2.2, 0, 0],
  ['disc', 92, 92, 2.2, 0, 3], ['disc', 6, 94, 2.2, 0, 3], ['disc', 78, 8, 2.2, 0, 3],
];

export const GEOMETRIC: GraphicDef[] = [
  geometric('geometric/concentric-circles', 'Concentric circles', ['circles', 'rings', 'target', 'concentric', 'round'], 1, ['#264653', '#e76f51'],
    art(100, 100, (ctx, c) => {
      [45.5, 36, 26.5, 17].forEach((r, i) => {
        ctx.beginPath();
        circle(ctx, 50, 50, r);
        stroke(ctx, c[i % 2], 4.6);
      });
      ctx.beginPath();
      circle(ctx, 50, 50, 9);
      fill(ctx, c[0]);
    })),

  geometric('geometric/half-circle-stack', 'Half-circle stack', ['half circle', 'semicircle', 'arch', 'stack', 'boho'], 2 / 3, ['#e76f51', '#f4a261', '#2a9d8f'],
    art(100, 150, (ctx, c) => {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(50, 49 + i * 50, 47, Math.PI, 0);
        ctx.closePath();
        fill(ctx, c[i]);
      }
    })),

  geometric('geometric/dot-grid', 'Dot grid', ['dots', 'grid', 'halftone', 'pattern', 'points'], 1, ['#1f1f2e'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      for (let i = 0; i < 25; i++) circle(ctx, 10 + (i % 5) * 20, 10 + Math.floor(i / 5) * 20, 4.6);
      fill(ctx, c[0]);
    })),

  geometric('geometric/diagonal-stripes', 'Diagonal stripes', ['stripes', 'diagonal', 'hatch', 'lines', 'pattern'], 1, ['#3a86ff'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      ctx.rect(3, 3, 94, 94);
      ctx.clip();
      ctx.beginPath();
      for (let k = -102; k < 100; k += 13) {
        ctx.moveTo(k, 102);
        ctx.lineTo(k + 104, -2);
      }
      ctx.lineCap = 'butt';
      stroke(ctx, c[0], 4.6);
    })),

  geometric('geometric/chevron-stack', 'Chevron stack', ['chevron', 'arrows', 'down', 'stack', 'direction'], 1, ['#ff6b35', '#1f1f2e'],
    art(100, 100, (ctx, c) => {
      for (let i = 0; i < 4; i++) {
        const y = 5 + i * 18.5;
        ctx.beginPath();
        poly(ctx, [[10, y], [50, y + 24], [90, y], [90, y + 10.5], [50, y + 34.5], [10, y + 10.5]]);
        fill(ctx, c[i % 2]);
      }
    })),

  geometric('geometric/zigzag-line', 'Zigzag line', ['zigzag', 'line', 'divider', 'wave', 'memphis'], 4, ['#ef476f'],
    art(400, 100, (ctx, c) => {
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.translate(200, 50);
      zig(ctx, 4, 46, 30);
      stroke(ctx, c[0], 10);
    })),

  geometric('geometric/squiggle-line', 'Squiggle line', ['squiggle', 'wavy', 'line', 'divider', 'wave'], 4, ['#118ab2'],
    art(400, 100, (ctx, c) => {
      ctx.beginPath();
      ctx.translate(200, 50);
      wave(ctx, 8, 46.5, 27);
      stroke(ctx, c[0], 10);
    })),

  geometric('geometric/memphis-confetti', 'Memphis confetti', ['memphis', 'confetti', 'party', '80s', 'shapes', 'scatter'], 1,
    ['#ff5d8f', '#ffd23f', '#3bceac', '#2b2d42'],
    art(100, 100, (ctx, c) => {
      for (const [kind, x, y, size, deg, slot] of CONFETTI) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((deg * Math.PI) / 180);
        ctx.beginPath();
        if (kind === 'disc' || kind === 'ring') circle(ctx, 0, 0, size);
        else if (kind === 'tri' || kind === 'tri-line') triangle(ctx, size);
        else if (kind === 'zig') zig(ctx, 2, size, size * 0.72);
        else if (kind === 'wave') wave(ctx, 4, size, size * 0.37);
        else {
          poly(ctx, [[-size, 0], [size, 0]], false);
          poly(ctx, [[0, -size], [0, size]], false);
        }
        if (kind === 'disc' || kind === 'tri') fill(ctx, c[slot]);
        else stroke(ctx, c[slot], 2.6);
        ctx.restore();
      }
    })),

  geometric('geometric/triangle-grid', 'Triangle grid', ['triangles', 'grid', 'mosaic', 'pattern', 'tessellation'], 1, ['#264653', '#2a9d8f', '#e9c46a'],
    art(100, 100, (ctx, c) => {
      const rand = rng(108);
      const b = 24;
      let slot = 0;
      // Four rows of seven interlocking triangles, each pulled in a little so the grid lines show through.
      for (let i = 0; i < 28; i++) {
        const col = i % 7;
        const x = 2 + col * (b / 2);
        const top = 2 + Math.floor(i / 7) * b;
        const up = col % 2 === 0;
        const cy = top + (up ? b * (2 / 3) : b / 3);
        const pts: Pt[] = up ? [[x, top + b], [x + b / 2, top], [x + b, top + b]] : [[x, top], [x + b, top], [x + b / 2, top + b]];
        // Never the same colour twice in a row.
        slot = (slot + 1 + Math.floor(rand() * 2)) % 3;
        ctx.beginPath();
        poly(ctx, pts.map(([px, py]): Pt => [x + b / 2 + (px - x - b / 2) * 0.84, cy + (py - cy) * 0.84]));
        fill(ctx, c[slot]);
      }
    })),

  geometric('geometric/sunburst-lines', 'Sunburst lines', ['sunburst', 'rays', 'radial', 'burst', 'lines'], 1, ['#f77f00'],
    art(100, 100, (ctx, c) => {
      ctx.beginPath();
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * TAU;
        const outer = i % 2 ? 37 : 47;
        ctx.moveTo(50 + Math.cos(a) * 16, 50 + Math.sin(a) * 16);
        ctx.lineTo(50 + Math.cos(a) * outer, 50 + Math.sin(a) * outer);
      }
      stroke(ctx, c[0], 2.4);
    })),
];
