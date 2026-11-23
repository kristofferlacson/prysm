import type { BlendMode } from '../../types/document';
import { rgba } from '../../utils/misc';
import { smoothstep } from './noise';
import { clamp01, mix, mixInto, type Gen, type GeneratorDef } from './types';

const TAU = Math.PI * 2;

function tex(
  id: string,
  name: string,
  category: string,
  blend: BlendMode,
  opacity: number,
  colors: string[],
  tags: string,
  draw: (g: Gen) => void,
): GeneratorDef {
  return { id: `texture/${id}`, name, kind: 'texture', category, blend, opacity, colors, tags: tags.split(' '), draw };
}

function fill(g: Gen, color: string) {
  g.ctx.fillStyle = color;
  g.ctx.fillRect(0, 0, g.w, g.h);
}

/** Short hair-like strokes scattered over the canvas. */
function fibres(g: Gen, count: number, color: string, length = 22) {
  const { ctx, w, h, u, rand } = g;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.5, u * 0.8);
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = rand() * TAU;
    const len = u * length * (0.4 + rand());
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 + (rand() - 0.5) * len * 0.5,
      y + Math.sin(a) * len * 0.5 + (rand() - 0.5) * len * 0.5,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    ctx.stroke();
  }
}

function specks(g: Gen, count: number, color: string, minR: number, maxR: number, maxAlpha = 1) {
  const { ctx, w, h, u, rand } = g;
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = maxAlpha * (0.2 + 0.8 * rand());
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h, u * mix(minR, maxR, rand() ** 3), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawScratches(g: Gen, count: number, color: string) {
  const { ctx, w, h, u, rand } = g;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const len = h * (0.05 + rand() ** 2 * 0.9);
    const lean = (rand() - 0.5) * len * 0.12;
    ctx.globalAlpha = 0.08 + rand() * 0.55;
    ctx.lineWidth = Math.max(0.5, u * (0.4 + rand() * 1.1));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + lean * 0.2 + (rand() - 0.5) * u * 14, y + len / 2, x + lean, y + len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Many short directional dabs following a noise flow field, like thick paint. */
function paintDabs(g: Gen, count: number, length: number, width: number, cap: CanvasLineCap) {
  const { ctx, w, h, s, rand, n, colors } = g;
  ctx.lineCap = cap;
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const a = n.fbm((x / s) * 1.6, (y / s) * 1.6, 3) * TAU * 2;
    const len = s * length * (0.6 + rand() * 0.8);
    const lw = s * width * (0.6 + rand() * 0.8);
    const pick = Math.floor(clamp01(n.fbm((x / s) * 2.2 + 4, (y / s) * 2.2 + 8, 3) * 1.5 - 0.25 + (rand() - 0.5) * 0.3) * colors.length);
    const color = colors[Math.min(colors.length - 1, pick)];
    const dx = Math.cos(a) * len;
    const dy = Math.sin(a) * len;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
    // Raised edge highlight and shadow give the dab some body.
    const nx = (-dy / len) * lw * 0.32;
    const ny = (dx / len) * lw * 0.32;
    ctx.lineWidth = Math.max(0.6, lw * 0.14);
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x + nx, y + ny);
    ctx.lineTo(x + dx + nx, y + dy + ny);
    ctx.stroke();
    ctx.strokeStyle = '#000000';
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(x - nx, y - ny);
    ctx.lineTo(x + dx - nx, y + dy - ny);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export const TEXTURES: GeneratorDef[] = [
  // ---------- Surface ----------
  tex('paper', 'Paper', 'Surface', 'multiply', 1, ['#f3efe6'], 'paper clean white grain', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      const v = 1 + (g.n.fbm(x * 3, y * 3, 4) - 0.5) * 0.12;
      const grain = (g.rand() - 0.5) * 14;
      o[0] = c[0] * v + grain;
      o[1] = c[1] * v + grain;
      o[2] = c[2] * v + grain;
    });
    fibres(g, 380, 'rgba(110,90,70,0.10)');
  }),
  tex('old-paper', 'Old paper', 'Surface', 'multiply', 1, ['#dcc79e', '#7a5a2e'], 'paper aged stained parchment', (g) => {
    const [a, b] = g.rgb;
    g.pixels((x, y, o) => {
      const mottle = g.n.fbm(x * 2.2, y * 2.2, 5) - 0.5;
      const blot = smoothstep(0.56, 0.8, g.n.fbm(x * 5 + 9, y * 5 + 3, 4));
      const t = clamp01(blot * 0.45 + g.edge(x, y) ** 2.4 * 0.7 + mottle * 0.4);
      mixInto(o, a, b, t, 1, (g.rand() - 0.5) * 14);
    });
    fibres(g, 240, 'rgba(70,45,20,0.12)');
  }),
  tex('crumpled-paper', 'Crumpled paper', 'Surface', 'multiply', 1, ['#eeeae2'], 'paper crumpled wrinkled folds', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      let shade = 0;
      for (const scale of [3.5, 8]) {
        const warp = g.n.fbm(x * 2 + scale, y * 2, 3) * 0.6;
        const v = g.n.voronoi(x * scale + warp, y * scale + warp);
        const a = v.id * TAU;
        const facet = (v.id - 0.5) * 0.16 + (v.vx * Math.cos(a) + v.vy * Math.sin(a)) * 0.3;
        const crease = smoothstep(0, 0.07, v.d2 - v.d1);
        shade += (facet - (1 - crease) * 0.12) * (scale < 5 ? 1 : 0.5);
      }
      const k = 1 + shade * 0.75;
      const grain = (g.rand() - 0.5) * 8;
      o[0] = c[0] * k + grain;
      o[1] = c[1] * k + grain;
      o[2] = c[2] * k + grain;
    });
  }),
  tex('concrete', 'Concrete', 'Surface', 'multiply', 1, ['#a3a29d'], 'concrete cement wall grey', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      const v = 0.78 + g.n.fbm(x * 4, y * 4, 6) * 0.36 + g.n.fbm(x * 42, y * 42, 2) * 0.12;
      const r = g.rand();
      const speck = r < 0.004 ? -45 : r > 0.997 ? 30 : (r - 0.5) * 16;
      o[0] = c[0] * v + speck;
      o[1] = c[1] * v + speck;
      o[2] = c[2] * v + speck;
    });
  }),
  tex('metal', 'Brushed metal', 'Surface', 'overlay', 1, ['#b9bdc4'], 'metal brushed steel aluminium', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      const streak = g.n.fbm(x * 1.2, y * 240, 3) - 0.5;
      const sheen = Math.sin(y * 7 + g.n.fbm(x * 1.5, y * 1.5, 3) * 3) * 0.12;
      const v = 1 + streak * 0.42 + sheen;
      const grain = (g.rand() - 0.5) * 8;
      o[0] = c[0] * v + grain;
      o[1] = c[1] * v + grain;
      o[2] = c[2] * v + grain;
    });
  }),
  tex('wood', 'Wood', 'Surface', 'multiply', 1, ['#c1935c', '#6b4222'], 'wood grain plank timber', (g) => {
    const [a, b] = g.rgb;
    g.pixels((x, y, o) => {
      const rings = Math.abs(Math.sin((y * 7 + g.n.fbm(x * 1.1, y * 4.5, 4) * 2.4) * Math.PI));
      const grain = g.n.fbm(x * 1.4, y * 170, 2);
      mixInto(o, b, a, clamp01(rings ** 0.6 * 0.72 + grain * 0.38), 1, (g.rand() - 0.5) * 8);
    });
  }),
  tex('marble', 'Marble', 'Surface', 'multiply', 1, ['#f2f0ec', '#6f7480'], 'marble stone veins luxury', (g) => {
    const [a, b] = g.rgb;
    g.pixels((x, y, o) => {
      const t = x * 3 + y * 1.6 + g.n.fbm(x * 3, y * 3, 6) * 4.2;
      const vein = (1 - Math.abs(Math.sin(t * Math.PI))) ** 7;
      const cloud = g.n.fbm(x * 2 + 5, y * 2, 4) - 0.5;
      mixInto(o, a, b, clamp01(vein * 0.85 + cloud * 0.28));
    });
  }),
  tex('fabric', 'Fabric', 'Surface', 'multiply', 1, ['#8f9bb0'], 'fabric cloth textile weave', (g) => {
    const [c] = g.rgb;
    const f = 120 * Math.PI;
    g.pixels((x, y, o) => {
      const weave = Math.abs(Math.sin(x * f)) * Math.abs(Math.sin(y * f));
      const twill = Math.sin((x + y) * f * 0.5) * 0.06;
      const v = 0.74 + weave * 0.3 + twill + (g.n.fbm(x * 6, y * 6, 3) - 0.5) * 0.18;
      o[0] = c[0] * v;
      o[1] = c[1] * v;
      o[2] = c[2] * v;
    });
  }),
  tex('canvas', 'Canvas', 'Surface', 'multiply', 1, ['#e8e0cf'], 'canvas linen artist weave', (g) => {
    const [c] = g.rgb;
    const f = 75 * Math.PI;
    g.pixels((x, y, o) => {
      const wx = Math.abs(Math.sin(x * f + g.n.noise(y * 30, 1) * 0.8));
      const wy = Math.abs(Math.sin(y * f + g.n.noise(x * 30, 7) * 0.8));
      const v = 0.8 + Math.max(wx, wy) * 0.22 - Math.min(wx, wy) * 0.1 + (g.rand() - 0.5) * 0.05;
      o[0] = c[0] * v;
      o[1] = c[1] * v;
      o[2] = c[2] * v;
    });
  }),
  tex('stone', 'Stone', 'Surface', 'multiply', 1, ['#958b7e', '#3b3733'], 'stone rock cracked wall', (g) => {
    const [a, b] = g.rgb;
    g.pixels((x, y, o) => {
      const warp = g.n.fbm(x * 3, y * 3, 3) * 0.7;
      const v = g.n.voronoi(x * 5 + warp, y * 5 + warp);
      const crack = 1 - smoothstep(0, 0.07, v.d2 - v.d1);
      const body = g.n.fbm(x * 6, y * 6, 6) - 0.5;
      mixInto(o, a, b, clamp01(crack * 0.8 + body * 0.7), 0.9 + v.id * 0.2, (g.rand() - 0.5) * 10);
    });
  }),

  // ---------- Artistic ----------
  tex('watercolor', 'Watercolor', 'Artistic', 'multiply', 1, ['#3a86c8', '#e86a92', '#f2c14e'], 'watercolor wash paint soft', (g) => {
    const [a, b, c] = g.rgb;
    g.pixels((x, y, o) => {
      const field = g.n.fbm(x * 1.6 + 1, y * 1.6, 5);
      const wash = smoothstep(0.4, 0.5, field);
      const rim = 1 - smoothstep(0, 0.07, Math.abs(field - 0.46));
      const t = g.n.fbm(x * 1.1 + 7, y * 1.1 + 3, 3) * 1.6 - 0.3;
      if (t < 0.5) mixInto(o, a, b, clamp01(t * 2));
      else mixInto(o, b, c, clamp01((t - 0.5) * 2));
      const granulation = g.n.fbm(x * 70, y * 70, 2);
      o[3] = clamp01(wash * (0.5 + granulation * 0.25 + rim * 0.3)) * 255;
    });
  }),
  tex('oil-paint', 'Oil paint', 'Artistic', 'normal', 1, ['#1d3557', '#457b9d', '#a8dadc', '#f1faee'], 'oil paint impasto strokes thick', (g) => {
    fill(g, g.colors[0]);
    paintDabs(g, 1500, 0.07, 0.022, 'round');
  }),
  tex('acrylic', 'Acrylic', 'Artistic', 'normal', 1, ['#ef476f', '#ffd166', '#06d6a0', '#118ab2'], 'acrylic paint bold strokes', (g) => {
    fill(g, g.colors[0]);
    paintDabs(g, 420, 0.2, 0.06, 'butt');
  }),
  tex('ink', 'Ink', 'Artistic', 'multiply', 1, ['#101014'], 'ink blot black splatter wash', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      const field = g.n.fbm(x * 2.2, y * 2.2, 6) + (g.n.fbm(x * 34, y * 34, 2) - 0.5) * 0.05;
      o[0] = c[0];
      o[1] = c[1];
      o[2] = c[2];
      o[3] = smoothstep(0.55, 0.6, field) * (0.82 + g.n.fbm(x * 9, y * 9, 2) * 0.18) * 255;
    });
    specks(g, 260, g.colors[0], 0.6, 7, 0.9);
  }),
  tex('brush-strokes', 'Brush strokes', 'Artistic', 'normal', 1, ['#1c1c1c'], 'brush strokes dry paint bristle', (g) => {
    const { ctx, w, h, s, u, rand } = g;
    ctx.strokeStyle = g.colors[0];
    ctx.lineCap = 'round';
    for (let stroke = 0; stroke < 6; stroke++) {
      const y0 = h * (0.1 + 0.8 * rand());
      const x0 = w * 0.04 + rand() * w * 0.15;
      const len = w * (0.5 + 0.4 * rand());
      const thick = s * (0.05 + 0.08 * rand());
      const tilt = (rand() - 0.5) * s * 0.12;
      const bend = (rand() - 0.5) * s * 0.1;
      for (let b = 0; b < 90; b++) {
        const off = (rand() - 0.5) * thick;
        ctx.globalAlpha = 0.12 + 0.5 * rand();
        ctx.lineWidth = u * (0.8 + 2.4 * rand());
        ctx.setLineDash([s * (0.08 + 0.6 * rand()), s * 0.03 * rand() * (b % 3)]);
        ctx.beginPath();
        ctx.moveTo(x0 + rand() * s * 0.05, y0 + off);
        ctx.quadraticCurveTo(x0 + len / 2, y0 + off + bend, x0 + len - rand() * s * 0.12, y0 + off + tilt);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }),
  tex('paint-splashes', 'Paint splashes', 'Artistic', 'normal', 1, ['#e63946', '#ffb703', '#219ebc'], 'paint splash splatter drops', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    for (let i = 0; i < 9; i++) {
      const cx = rand() * w;
      const cy = rand() * h;
      const R = s * (0.04 + rand() * 0.11);
      ctx.fillStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.92;
      const pts: [number, number][] = [];
      for (let k = 0; k < 22; k++) {
        const a = (k / 22) * TAU;
        const r = R * (0.65 + rand() * 0.7 + (rand() < 0.2 ? rand() * 0.9 : 0));
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      ctx.beginPath();
      pts.forEach(([x, y], k) => {
        const [nx, ny] = pts[(k + 1) % pts.length];
        if (k === 0) ctx.moveTo((x + nx) / 2, (y + ny) / 2);
        const [ax, ay] = pts[(k + 2) % pts.length];
        ctx.quadraticCurveTo(nx, ny, (nx + ax) / 2, (ny + ay) / 2);
      });
      ctx.fill();
      for (let d = 0; d < 26; d++) {
        const a = rand() * TAU;
        const dist = R * (1.15 + rand() ** 2 * 2.4);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, R * (0.03 + 0.16 * rand() ** 3), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }),
  tex('charcoal', 'Charcoal', 'Artistic', 'multiply', 1, ['#1a1a1a'], 'charcoal smudge drawing dark', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      const tooth = g.n.fbm(x * 95, y * 95, 2);
      const smear = g.n.fbm((x + y) * 3, (x - y) * 44, 3);
      const cover = smoothstep(0.34, 0.68, g.n.fbm(x * 1.5, y * 1.5, 4));
      o[0] = c[0];
      o[1] = c[1];
      o[2] = c[2];
      o[3] = clamp01(cover * (0.3 + smear * 0.75) * (tooth > 0.42 ? 1 : 0.28)) * 255;
    });
  }),
  tex('pencil', 'Pencil', 'Artistic', 'multiply', 1, ['#3a3a3a'], 'pencil hatching graphite sketch', (g) => {
    const { ctx, w, h, s, u, rand } = g;
    ctx.strokeStyle = g.colors[0];
    ctx.lineWidth = Math.max(0.5, u * 0.9);
    ctx.lineCap = 'round';
    for (let i = 0; i < 1700; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const a = -Math.PI / 4 + (rand() - 0.5) * 0.32;
      const len = s * (0.04 + rand() * 0.22);
      ctx.globalAlpha = 0.05 + rand() * 0.22;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }),
  tex('pastel', 'Pastel', 'Artistic', 'normal', 1, ['#f6bd60', '#f28482', '#84a59d', '#f7ede2'], 'pastel chalk soft colour', (g) => {
    const [a, b, c, d] = g.rgb;
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    g.pixels((x, y, o) => {
      const t1 = smoothstep(0.3, 0.7, g.n.fbm(x * 1.3, y * 1.3, 3));
      const t2 = smoothstep(0.3, 0.7, g.n.fbm(x * 1.3 + 5, y * 1.3 + 9, 3));
      mixInto(p, a, b, t1);
      mixInto(q, c, d, t1);
      const chalk = 0.88 + g.n.fbm(x * 130, y * 130, 2) * 0.22;
      o[0] = mix(p[0], q[0], t2) * chalk;
      o[1] = mix(p[1], q[1], t2) * chalk;
      o[2] = mix(p[2], q[2], t2) * chalk;
    });
  }),

  // ---------- Vintage & distressed ----------
  tex('grunge', 'Grunge', 'Vintage', 'multiply', 0.9, ['#1b1713'], 'grunge dirty distressed worn', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      const big = g.n.fbm(x * 2.5, y * 2.5, 6);
      const fine = g.n.fbm(x * 15, y * 15, 4);
      o[0] = c[0];
      o[1] = c[1];
      o[2] = c[2];
      o[3] = smoothstep(0.5, 0.74, big * 0.65 + fine * 0.42 + g.edge(x, y) * 0.16) * 235;
    });
  }),
  tex('dust', 'Dust', 'Vintage', 'screen', 1, ['#ffffff'], 'dust specks hair film dirt', (g) => {
    fill(g, '#000000');
    specks(g, 620, g.colors[0], 0.4, 2.6, 0.9);
    fibres(g, 26, rgba(g.colors[0], 0.5), 60);
  }),
  tex('scratches', 'Scratches', 'Vintage', 'screen', 0.9, ['#ffffff'], 'scratches film scratched lines', (g) => {
    fill(g, '#000000');
    drawScratches(g, 85, g.colors[0]);
  }),
  tex('film-grain', 'Film grain', 'Vintage', 'overlay', 0.8, [], 'film grain analog noise', (g) => {
    g.pixels((_x, _y, o) => {
      const v = 128 + (g.rand() + g.rand() + g.rand() - 1.5) * 72;
      o[0] = v;
      o[1] = v;
      o[2] = v;
    });
  }),
  tex('noise', 'Noise', 'Vintage', 'overlay', 0.6, [], 'noise colour static grain', (g) => {
    g.pixels((_x, _y, o) => {
      o[0] = 128 + (g.rand() - 0.5) * 150;
      o[1] = 128 + (g.rand() - 0.5) * 150;
      o[2] = 128 + (g.rand() - 0.5) * 150;
    });
  }),
  tex('photocopy', 'Photocopy', 'Vintage', 'multiply', 1, [], 'photocopy xerox toner zine', (g) => {
    g.pixels((x, y, o) => {
      const speck = g.rand() < 0.012 ? 0 : 1;
      const streak = g.n.fbm(x * 0.5, y * 95, 2) > 0.71 ? 0.72 : 1;
      const blotch = smoothstep(0.62, 0.8, g.n.fbm(x * 8, y * 8, 3)) * 0.55;
      const v = clamp01(speck * streak - g.edge(x, y) ** 3 * 0.65 - blotch) * 255;
      o[0] = v;
      o[1] = v;
      o[2] = v;
    });
  }),
  tex('halftone', 'Halftone', 'Vintage', 'multiply', 0.85, ['#111111'], 'halftone dots print comic', (g) => {
    const { ctx, w, h, s } = g;
    const cell = s / 46;
    const diag = Math.hypot(w, h);
    ctx.fillStyle = g.colors[0];
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    for (let y = -diag / 2; y < diag / 2; y += cell) {
      for (let x = -diag / 2; x < diag / 2; x += cell) {
        const k = clamp01((y + diag / 2) / diag + (g.n.fbm(x / s + 9, y / s + 9, 3) - 0.5) * 0.8);
        const r = cell * 0.62 * Math.sqrt(k);
        if (r < 0.35) continue;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
    }
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }),
  tex('newspaper', 'Newspaper print', 'Vintage', 'multiply', 1, ['#d9d4c7', '#2b2b2b'], 'newspaper print newsprint columns', (g) => {
    const { ctx, w, h, s, rand } = g;
    const [paper] = g.rgb;
    g.pixels((x, y, o) => {
      const v = 0.94 + g.n.fbm(x * 3, y * 3, 3) * 0.1 + (g.rand() - 0.5) * 0.06;
      o[0] = paper[0] * v;
      o[1] = paper[1] * v;
      o[2] = paper[2] * v;
    });
    ctx.fillStyle = g.colors[1];
    const margin = s * 0.05;
    const cols = Math.max(2, Math.round(w / (s * 0.24)));
    const gutter = s * 0.025;
    const colW = (w - margin * 2 - gutter * (cols - 1)) / cols;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(margin, margin, (w - margin * 2) * (0.5 + rand() * 0.4), s * 0.045);
    ctx.fillRect(margin, margin + s * 0.065, w - margin * 2, s * 0.004);
    ctx.globalAlpha = 0.42;
    const lineH = s * 0.0125;
    for (let c = 0; c < cols; c++) {
      const x0 = margin + c * (colW + gutter);
      for (let y = margin + s * 0.09; y < h - margin; y += lineH) {
        if (rand() < 0.04) {
          y += lineH;
          continue;
        }
        let x = x0;
        const end = x0 + colW * (rand() < 0.1 ? 0.4 + rand() * 0.5 : 1);
        while (x < end) {
          const word = Math.min(end - x, s * (0.008 + rand() * 0.03));
          ctx.fillRect(x, y, word, lineH * 0.42);
          x += word + s * 0.006;
        }
      }
    }
    ctx.globalAlpha = 1;
  }),
  tex('vintage-paper', 'Vintage paper', 'Vintage', 'multiply', 1, ['#ecdfc3', '#9c6b3a'], 'vintage paper foxing antique folded', (g) => {
    const { ctx, w, h, u } = g;
    const [a, b] = g.rgb;
    g.pixels((x, y, o) => {
      const fox = smoothstep(0.74, 0.88, g.n.fbm(x * 19, y * 19, 3)) * 0.5;
      const t = clamp01(fox + g.edge(x, y) ** 3 * 0.55 + (g.n.fbm(x * 2, y * 2, 4) - 0.5) * 0.3);
      mixInto(o, a, b, t, 1, (g.rand() - 0.5) * 10);
    });
    for (const [x1, y1, x2, y2] of [
      [w / 2, 0, w / 2, h],
      [0, h / 2, w, h / 2],
    ]) {
      ctx.lineWidth = u * 2;
      ctx.strokeStyle = 'rgba(90,60,30,0.16)';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,250,235,0.3)';
      ctx.beginPath();
      ctx.moveTo(x1 + u * 2, y1 + u * 2);
      ctx.lineTo(x2 + u * 2, y2 + u * 2);
      ctx.stroke();
    }
  }),
  tex('faded-print', 'Faded print', 'Vintage', 'screen', 0.8, ['#f4efe6'], 'faded washed sun bleached print', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      const patch = smoothstep(0.35, 0.75, g.n.fbm(x * 1.8, y * 1.8, 5)) * 0.6;
      const k = clamp01(patch + g.edge(x, y) * 0.25 + (g.rand() - 0.5) * 0.08);
      o[0] = c[0] * k;
      o[1] = c[1] * k;
      o[2] = c[2] * k;
    });
  }),

  // ---------- Digital ----------
  tex('glitch', 'Glitch', 'Digital', 'screen', 1, ['#ff004c', '#00e5ff', '#ffffff', '#39ff14'], 'glitch digital error bars', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    fill(g, '#000000');
    for (let i = 0; i < 46; i++) {
      const bh = s * (0.003 + rand() ** 2 * 0.06);
      const y = rand() * h;
      const bw = w * (0.08 + rand() * 0.9);
      const x = rand() * (w - bw * 0.5) - bw * 0.2;
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
      ctx.globalAlpha = 0.25 + rand() * 0.65;
      if (rand() < 0.3) {
        const block = bh * (0.6 + rand());
        for (let bx = x; bx < x + bw; bx += block * 1.6) if (rand() < 0.7) ctx.fillRect(bx, y, block, bh);
      } else {
        ctx.fillRect(x, y, bw, bh);
      }
    }
    ctx.globalAlpha = 1;
  }),
  tex('pixel-pattern', 'Pixel pattern', 'Digital', 'normal', 1, ['#22223b', '#4a4e69', '#9a8c98', '#f2e9e4'], 'pixel mosaic blocks 8bit', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    const cell = s / 24;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const t = g.n.fbm((x / s) * 3, (y / s) * 3, 3) + (rand() - 0.5) * 0.35;
        ctx.fillStyle = colors[Math.min(colors.length - 1, Math.floor(clamp01(t * 1.4 - 0.2) * colors.length))];
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cell), Math.ceil(cell));
      }
    }
  }),
  tex('rgb-distortion', 'RGB distortion', 'Digital', 'screen', 0.9, [], 'rgb distortion crt subpixel chroma', (g) => {
    const stripe = Math.max(1, g.s / 320);
    g.pixels((x, y, o) => {
      const shift = Math.sin(y * 26 + g.n.fbm(x, y * 4, 2) * 8) * 0.02;
      const px = Math.floor(((x + shift) * g.s) / stripe);
      const ch = ((px % 3) + 3) % 3;
      const level = (0.35 + 0.65 * g.n.fbm(x * 2 + shift * 20, y * 2, 4)) * 255;
      o[0] = ch === 0 ? level : level * 0.12;
      o[1] = ch === 1 ? level : level * 0.12;
      o[2] = ch === 2 ? level : level * 0.12;
    });
  }),
  tex('scanlines', 'Scanlines', 'Digital', 'multiply', 0.7, ['#000000'], 'scanlines crt tv lines retro', (g) => {
    const { ctx, w, h, s } = g;
    const pitch = Math.max(2, s / 170);
    ctx.fillStyle = rgba(g.colors[0], 0.5);
    for (let y = 0; y < h; y += pitch) ctx.fillRect(0, Math.round(y), w, Math.max(1, pitch * 0.45));
  }),
  tex('digital-noise', 'Digital noise', 'Digital', 'screen', 0.6, ['#00e5ff', '#ff2bd6'], 'digital noise static blocks data', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    fill(g, '#000000');
    const cell = Math.max(2, s / 95);
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const r = rand();
        if (r < 0.5) continue;
        if (r > 0.97) ctx.fillStyle = colors[rand() < 0.5 ? 0 : 1];
        else {
          const v = Math.floor(rand() * 255);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
        }
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cell * (rand() < 0.1 ? 4 : 1)), Math.ceil(cell));
      }
    }
  }),
  tex('abstract-pattern', 'Abstract pattern', 'Digital', 'normal', 1, ['#0b132b', '#5bc0be'], 'abstract pattern waves arcs geometric', (g) => {
    const { ctx, w, h, s } = g;
    fill(g, g.colors[0]);
    const R = s / 9;
    ctx.strokeStyle = g.colors[1];
    ctx.lineWidth = Math.max(1, R * 0.07);
    let row = 0;
    for (let y = 0; y < h + R * 1.5; y += R / 2, row++) {
      for (let x = (row % 2) * R - R; x < w + R; x += R * 2) {
        ctx.fillStyle = g.colors[0];
        ctx.beginPath();
        ctx.arc(x, y, R, Math.PI, 0);
        ctx.fill();
        for (let k = 1; k <= 4; k++) {
          ctx.globalAlpha = 0.35 + k * 0.16;
          ctx.beginPath();
          ctx.arc(x, y, (R * k) / 4.2, Math.PI, 0);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }),
  tex('cardboard', 'Cardboard', 'Surface', 'multiply', 1, ['#b8946a'], 'cardboard box corrugated kraft paper', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      // Faint corrugation ridges, long paper fibres and the odd darker fleck.
      const ridge = Math.sin(y * 150) * 0.035;
      const fibre = (g.n.fbm(x * 60, y * 3, 3) - 0.5) * 0.16;
      const v = 0.9 + ridge + fibre + (g.n.fbm(x * 3, y * 3, 4) - 0.5) * 0.2;
      const r = g.rand();
      const fleck = r < 0.003 ? -38 : (r - 0.5) * 12;
      o[0] = c[0] * v + fleck;
      o[1] = c[1] * v + fleck;
      o[2] = c[2] * v + fleck;
    });
  }),
  tex('dirt', 'Dirt', 'Vintage', 'multiply', 0.85, ['#4a3a28'], 'dirt smudge stain grime dirty', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      // White where clean (multiply leaves the design alone), stained where the noise pools.
      const smudge = smoothstep(0.52, 0.78, g.n.fbm(x * 3.2, y * 3.2, 5));
      const grit = g.n.fbm(x * 70, y * 70, 2) > 0.72 ? 0.5 : 0;
      const speck = g.rand() < 0.0025 ? 0.9 : 0;
      const k = clamp01(smudge * 0.75 + grit * smudge + speck);
      o[0] = 255 + (c[0] - 255) * k;
      o[1] = 255 + (c[1] - 255) * k;
      o[2] = 255 + (c[2] - 255) * k;
    });
  }),
  tex('distressed-edges', 'Distressed edges', 'Vintage', 'multiply', 1, ['#2a2018'], 'distressed worn edges border aged frame', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      // Clean in the middle; towards the border the wear eats in unevenly.
      const edge = g.edge(x, y);
      const rough = g.n.fbm(x * 9, y * 9, 5) * 0.55 + g.n.fbm(x * 48, y * 48, 2) * 0.2;
      const k = smoothstep(0.62, 0.98, edge * 0.82 + rough * edge);
      o[0] = 255 + (c[0] - 255) * k;
      o[1] = 255 + (c[1] - 255) * k;
      o[2] = 255 + (c[2] - 255) * k;
    });
  }),
  tex('dithering', 'Dithering', 'Digital', 'overlay', 0.6, ['#101014', '#f2f2ee'], 'dither dithering bayer 1-bit retro pixel', (g) => {
    // Ordered (Bayer) dithering of a soft tonal field: only two colours, shade made from the pattern.
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const cell = Math.max(1, Math.round(g.s / 320));
    const [dark, light] = g.rgb;
    g.pixels((x, y, o) => {
      const px = Math.floor((x * g.s) / cell);
      const py = Math.floor((y * g.s) / cell);
      const tone = clamp01(g.n.fbm((px * cell) / g.s * 2.2, (py * cell) / g.s * 2.2, 4) * 1.5 - 0.25);
      const on = tone > (bayer[(py % 4) * 4 + (px % 4)] + 0.5) / 16;
      const c = on ? light : dark;
      o[0] = c[0];
      o[1] = c[1];
      o[2] = c[2];
    });
  }),
];
