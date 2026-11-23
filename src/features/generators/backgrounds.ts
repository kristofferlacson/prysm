import { rgba } from '../../utils/misc';
import { smoothstep } from './noise';
import { clamp01, mixInto, type Gen, type GeneratorDef } from './types';

const TAU = Math.PI * 2;

function bg(id: string, name: string, category: string, colors: string[], tags: string, draw: (g: Gen) => void): GeneratorDef {
  return {
    id: `background/${id}`,
    name,
    kind: 'background',
    category,
    blend: 'normal',
    opacity: 1,
    colors,
    tags: tags.split(' '),
    draw,
  };
}

function fill(g: Gen, color: string) {
  g.ctx.fillStyle = color;
  g.ctx.fillRect(0, 0, g.w, g.h);
}

function blob(g: Gen, x: number, y: number, r: number, color: string, alpha = 1) {
  const grad = g.ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, rgba(color, alpha));
  grad.addColorStop(1, rgba(color, 0));
  g.ctx.fillStyle = grad;
  g.ctx.fillRect(0, 0, g.w, g.h);
}

export const BACKGROUNDS: GeneratorDef[] = [
  bg('mesh-gradient', 'Mesh gradient', 'Gradient', ['#ff7eb3', '#7afcff', '#feff9c', '#6a5cff'], 'mesh gradient soft colourful', (g) => {
    const { w, h, rand, colors } = g;
    fill(g, colors[0]);
    const reach = Math.max(w, h);
    for (let i = 1; i < colors.length * 2; i++) {
      blob(g, rand() * w, rand() * h, reach * (0.45 + rand() * 0.4), colors[i % colors.length], 0.9);
    }
  }),
  bg('abstract-gradient', 'Abstract gradient', 'Gradient', ['#0f2027', '#2c5364', '#f7971e'], 'abstract gradient flow liquid', (g) => {
    const [a, b, c] = g.rgb;
    g.pixels((x, y, o) => {
      const warp = g.n.fbm(x * 0.9, y * 0.9, 4);
      const t = clamp01(g.n.fbm(x * 0.8 + warp * 1.8, y * 0.8 + warp * 1.8, 3) * 1.7 - 0.35);
      if (t < 0.5) mixInto(o, a, b, t * 2);
      else mixInto(o, b, c, (t - 0.5) * 2);
    });
  }),
  bg('blurred', 'Blurred lights', 'Gradient', ['#141e30', '#f953c6', '#12c2e9', '#f5af19'], 'blurred lights bokeh defocus', (g) => {
    const { w, h, s, rand, colors } = g;
    fill(g, colors[0]);
    g.ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 16; i++) {
      blob(g, rand() * w, rand() * h, s * (0.18 + rand() * 0.35), colors[1 + (i % (colors.length - 1))], 0.22 + rand() * 0.25);
    }
    g.ctx.globalCompositeOperation = 'source-over';
  }),
  bg('atmospheric', 'Atmospheric', 'Atmosphere', ['#0b1026', '#3a4a7a', '#f2a65a'], 'atmospheric sky dusk haze moody', (g) => {
    const [a, b, c] = g.rgb;
    const hh = g.h / g.s;
    g.pixels((x, y, o) => {
      const t = y / hh;
      const haze = smoothstep(0.3, 0.8, g.n.fbm(x * 1.4, y * 3.2, 5)) * 0.35;
      if (t < 0.6) mixInto(o, a, b, clamp01(t / 0.6 + haze * 0.5));
      else mixInto(o, b, c, clamp01((t - 0.6) / 0.4 + haze * 0.3));
      const grain = (g.rand() - 0.5) * 6;
      o[0] += grain;
      o[1] += grain;
      o[2] += grain;
    });
  }),
  bg('geometric', 'Geometric triangles', 'Pattern', ['#264653', '#2a9d8f', '#e9c46a'], 'geometric triangles low poly pattern', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    const cell = s / 7;
    const pick = () => colors[Math.floor(rand() * colors.length)];
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const flip = rand() < 0.5;
        const tris = flip
          ? [
              [x, y, x + cell, y, x, y + cell],
              [x + cell, y, x + cell, y + cell, x, y + cell],
            ]
          : [
              [x, y, x + cell, y, x + cell, y + cell],
              [x, y, x + cell, y + cell, x, y + cell],
            ];
        for (const t of tris) {
          ctx.fillStyle = pick();
          ctx.globalAlpha = 0.75 + rand() * 0.25;
          ctx.beginPath();
          ctx.moveTo(t[0], t[1]);
          ctx.lineTo(t[2], t[3]);
          ctx.lineTo(t[4], t[5]);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }),
  bg('dots', 'Dot grid', 'Pattern', ['#fdf6e3', '#e76f51'], 'dots polka grid pattern', (g) => {
    const { ctx, w, h, s } = g;
    fill(g, g.colors[0]);
    ctx.fillStyle = g.colors[1];
    const cell = s / 14;
    ctx.beginPath();
    let row = 0;
    for (let y = cell / 2; y < h + cell; y += cell * 0.87, row++) {
      for (let x = (row % 2 ? cell : cell / 2) - cell; x < w + cell; x += cell) {
        ctx.moveTo(x + cell * 0.2, y);
        ctx.arc(x, y, cell * 0.2, 0, TAU);
      }
    }
    ctx.fill();
  }),
  bg('chevron', 'Chevron', 'Pattern', ['#f4f1de', '#3d405b'], 'chevron zigzag herringbone pattern', (g) => {
    const { ctx, w, h, s } = g;
    fill(g, g.colors[0]);
    const pitch = s / 9;
    ctx.strokeStyle = g.colors[1];
    ctx.lineWidth = pitch * 0.32;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    for (let y = -pitch; y < h + pitch * 2; y += pitch * 0.8) {
      for (let x = -pitch, i = 0; x < w + pitch; x += pitch / 2, i++) {
        const py = y + (i % 2 ? -pitch * 0.25 : pitch * 0.25);
        if (i === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
    }
    ctx.stroke();
  }),
  bg('graph-grid', 'Grid', 'Pattern', ['#0f172a', '#334155', '#64748b'], 'grid graph paper lines blueprint pattern', (g) => {
    const { ctx, w, h, s } = g;
    fill(g, g.colors[0]);
    const cell = s / 16;
    const lines = (step: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let x = (w / 2) % step; x < w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = (h / 2) % step; y < h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    };
    lines(cell, g.colors[1], Math.max(1, s / 900));
    lines(cell * 4, g.colors[2], Math.max(1.5, s / 500));
  }),
  bg('checker', 'Checkerboard', 'Pattern', ['#fefae0', '#bc6c25'], 'checker checkerboard squares racing pattern', (g) => {
    const { ctx, w, h, s } = g;
    fill(g, g.colors[0]);
    ctx.fillStyle = g.colors[1];
    const cell = s / 10;
    for (let row = 0, y = 0; y < h; y += cell, row++) {
      for (let col = 0, x = 0; x < w; x += cell, col++) if ((row + col) % 2) ctx.fillRect(x, y, cell + 0.5, cell + 0.5);
    }
  }),
  bg('wave-lines', 'Wave lines', 'Pattern', ['#003049', '#669bbc'], 'waves lines flowing water pattern', (g) => {
    const { ctx, w, h, s } = g;
    fill(g, g.colors[0]);
    ctx.strokeStyle = g.colors[1];
    ctx.lineWidth = s / 160;
    const pitch = s / 18;
    const length = s / 3.2;
    ctx.beginPath();
    for (let y = -pitch; y < h + pitch * 2; y += pitch) {
      ctx.moveTo(-10, y);
      for (let x = 0; x <= w + 10; x += s / 80) ctx.lineTo(x, y + Math.sin((x / length) * TAU + (y / pitch) * 0.35) * pitch * 0.55);
    }
    ctx.stroke();
  }),
  bg('memphis', 'Memphis', 'Pattern', ['#fff8e7', '#ef476f', '#118ab2', '#ffd166', '#073b4c'], 'memphis confetti 80s shapes squiggle pattern', (g) => {
    const { ctx, w, h, s, rand } = g;
    fill(g, g.colors[0]);
    const cell = s / 6;
    ctx.lineCap = 'round';
    ctx.lineWidth = s / 110;
    for (let y = cell / 2; y < h + cell / 2; y += cell) {
      for (let x = cell / 2; x < w + cell / 2; x += cell) {
        const cx = x + (rand() - 0.5) * cell * 0.4;
        const cy = y + (rand() - 0.5) * cell * 0.4;
        const color = g.colors[1 + Math.floor(rand() * 4)];
        const r = cell * (0.14 + rand() * 0.12);
        const kind = rand();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rand() * TAU);
        ctx.fillStyle = ctx.strokeStyle = color;
        ctx.beginPath();
        if (kind < 0.25) {
          ctx.arc(0, 0, r, 0, TAU);
          ctx.fill();
        } else if (kind < 0.5) {
          ctx.moveTo(0, -r * 1.2);
          ctx.lineTo(r * 1.1, r * 0.8);
          ctx.lineTo(-r * 1.1, r * 0.8);
          ctx.closePath();
          ctx.fill();
        } else if (kind < 0.75) {
          for (let i = 0; i <= 4; i++) ctx.lineTo((i - 2) * r * 0.6, i % 2 ? -r * 0.45 : r * 0.45);
          ctx.stroke();
        } else {
          ctx.arc(0, 0, r, 0, TAU);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }),
  bg('rings', 'Concentric rings', 'Pattern', ['#2b2d42', '#ef233c', '#edf2f4'], 'rings concentric circles target retro pattern', (g) => {
    const { ctx, w, h } = g;
    fill(g, g.colors[0]);
    const reach = Math.hypot(w, h) * 0.62;
    const count = 14;
    for (let i = count; i >= 1; i--) {
      ctx.fillStyle = g.colors[i % 3];
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.58, (reach * i) / count, 0, TAU);
      ctx.fill();
    }
  }),
  bg('stripes', 'Diagonal stripes', 'Pattern', ['#1d3557', '#457b9d'], 'stripes diagonal lines pattern', (g) => {
    const { ctx, w, h, s } = g;
    fill(g, g.colors[0]);
    ctx.strokeStyle = g.colors[1];
    const pitch = s / 12;
    ctx.lineWidth = pitch * 0.5;
    ctx.beginPath();
    for (let x = -h; x < w + h; x += pitch) {
      ctx.moveTo(x, h);
      ctx.lineTo(x + h, 0);
    }
    ctx.stroke();
  }),
  bg('minimal', 'Minimal', 'Minimal', ['#f1ece4', '#e07a5f', '#3d405b'], 'minimal clean simple circle', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    fill(g, colors[0]);
    ctx.fillStyle = colors[1];
    ctx.beginPath();
    ctx.arc(w * (0.6 + rand() * 0.2), h * (0.3 + rand() * 0.15), s * 0.24, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = colors[2];
    ctx.lineWidth = Math.max(1, s * 0.004);
    ctx.beginPath();
    ctx.moveTo(w * 0.08, h * 0.78);
    ctx.lineTo(w * 0.92, h * 0.78);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w * 0.26, h * 0.62, s * 0.16, Math.PI, 0);
    ctx.stroke();
  }),
  bg('sunburst', 'Vintage sunburst', 'Vintage', ['#f4e3c1', '#d9a05b'], 'vintage sunburst rays retro', (g) => {
    const { ctx, w, h, colors } = g;
    fill(g, colors[0]);
    const reach = Math.hypot(w, h);
    const rays = 18;
    ctx.fillStyle = colors[1];
    ctx.translate(w / 2, h * 0.58);
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU;
      const half = Math.PI / rays / 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a - half) * reach, Math.sin(a - half) * reach);
      ctx.lineTo(Math.cos(a + half) * reach, Math.sin(a + half) * reach);
      ctx.closePath();
      ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const grad = ctx.createRadialGradient(w / 2, h * 0.58, 0, w / 2, h * 0.58, reach * 0.7);
    grad.addColorStop(0, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(60,30,0,0.28)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }),
  bg('abstract-shapes', 'Abstract shapes', 'Abstract', ['#fefae0', '#bc6c25', '#606c38', '#283618', '#dda15e'], 'abstract shapes organic blobs boho', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    fill(g, colors[0]);
    for (let i = 0; i < 9; i++) {
      const cx = rand() * w;
      const cy = rand() * h;
      const R = s * (0.1 + rand() * 0.2);
      ctx.fillStyle = colors[1 + (i % (colors.length - 1))];
      const kind = rand();
      ctx.beginPath();
      if (kind < 0.45) {
        const pts: [number, number][] = [];
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * TAU;
          const r = R * (0.6 + rand() * 0.6);
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        pts.forEach(([x, y], k) => {
          const [nx, ny] = pts[(k + 1) % pts.length];
          if (k === 0) ctx.moveTo((x + nx) / 2, (y + ny) / 2);
          const [ax, ay] = pts[(k + 2) % pts.length];
          ctx.quadraticCurveTo(nx, ny, (nx + ax) / 2, (ny + ay) / 2);
        });
      } else if (kind < 0.75) {
        ctx.arc(cx, cy, R * 0.7, 0, TAU);
      } else {
        ctx.arc(cx, cy, R, Math.PI, 0);
      }
      ctx.fill();
    }
  }),
];
