import type { BlendMode } from '../../types/document';
import { rgba } from '../../utils/misc';
import { smoothstep } from './noise';
import { drawScratches } from './textures';
import { clamp01, type Gen, type GeneratorDef } from './types';

const TAU = Math.PI * 2;

function ov(
  id: string,
  name: string,
  category: string,
  blend: BlendMode,
  opacity: number,
  colors: string[],
  tags: string,
  draw: (g: Gen) => void,
): GeneratorDef {
  return { id: `overlay/${id}`, name, kind: 'overlay', category, blend, opacity, colors, tags: tags.split(' '), draw };
}

function black(g: Gen) {
  g.ctx.fillStyle = '#000000';
  g.ctx.fillRect(0, 0, g.w, g.h);
}

function radial(g: Gen, x: number, y: number, r: number, color: string, alpha: number, hardness = 0) {
  const { ctx } = g;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, rgba(color, alpha));
  if (hardness > 0) grad.addColorStop(hardness, rgba(color, alpha));
  grad.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function softParticles(g: Gen, count: number, minR: number, maxR: number) {
  const { w, h, u, rand, colors } = g;
  g.ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < count; i++) {
    const r = u * (minR + (maxR - minR) * rand() ** 4);
    radial(g, rand() * w, rand() * h, r, colors[i % colors.length], 0.15 + rand() * 0.6, 0.15);
  }
  g.ctx.globalCompositeOperation = 'source-over';
}

export const OVERLAYS: GeneratorDef[] = [
  ov('light-leak', 'Light leak', 'Light', 'screen', 1, ['#ff5e3a', '#ffb347', '#ff2d95'], 'light leak film warm analog', (g) => {
    const { w, h, s, rand, colors } = g;
    black(g);
    g.ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const left = rand() < 0.5;
      const x = left ? -w * 0.1 + rand() * w * 0.2 : w * (0.9 + rand() * 0.2);
      radial(g, x, rand() * h, s * (0.45 + rand() * 0.6), colors[i % colors.length], 0.35 + rand() * 0.4);
    }
    g.ctx.globalCompositeOperation = 'source-over';
  }),
  ov('lens-flare', 'Lens flare', 'Light', 'screen', 1, ['#fff4d6', '#7fb8ff'], 'lens flare sun optical', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    black(g);
    ctx.globalCompositeOperation = 'lighter';
    const fx = w * (0.2 + rand() * 0.25);
    const fy = h * (0.18 + rand() * 0.2);
    radial(g, fx, fy, s * 0.5, colors[0], 0.5);
    radial(g, fx, fy, s * 0.12, '#ffffff', 1, 0.2);
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(1, 0.035);
    radial(g, 0, 0, s * 0.95, colors[1], 0.85);
    ctx.restore();
    const dx = w / 2 - fx;
    const dy = h / 2 - fy;
    for (const [t, r, a] of [
      [0.5, 0.05, 0.22],
      [0.9, 0.025, 0.3],
      [1.35, 0.09, 0.14],
      [1.7, 0.04, 0.25],
      [2.05, 0.13, 0.1],
    ]) {
      radial(g, fx + dx * t, fy + dy * t, s * r, colors[t > 1 ? 1 : 0], a, 0.7);
    }
    ctx.globalCompositeOperation = 'source-over';
  }),
  ov('glow', 'Glow', 'Light', 'screen', 1, ['#ffd9a0'], 'glow soft light bloom', (g) => {
    black(g);
    radial(g, g.w / 2, g.h / 2, Math.hypot(g.w, g.h) * 0.55, g.colors[0], 0.9);
  }),
  ov('light-rays', 'Light rays', 'Light', 'screen', 1, ['#fff1c9'], 'light rays sun beams god', (g) => {
    const { ctx, w, h, rand } = g;
    black(g);
    ctx.globalCompositeOperation = 'lighter';
    const ox = -w * 0.05;
    const oy = -h * 0.08;
    const reach = Math.hypot(w, h) * 1.15;
    for (let i = 0; i < 46; i++) {
      const a = rand() * (Math.PI / 2);
      const spread = 0.008 + rand() ** 2 * 0.06;
      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, reach * (0.55 + rand() * 0.45));
      grad.addColorStop(0, rgba(g.colors[0], 0.1 + rand() * 0.16));
      grad.addColorStop(1, rgba(g.colors[0], 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(a - spread) * reach, oy + Math.sin(a - spread) * reach);
      ctx.lineTo(ox + Math.cos(a + spread) * reach, oy + Math.sin(a + spread) * reach);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }),
  ov('smoke', 'Smoke', 'Atmosphere', 'screen', 0.9, ['#ffffff'], 'smoke wisps haze', (g) => {
    const [c] = g.rgb;
    g.pixels((x, y, o) => {
      const q = g.n.fbm(x * 2, y * 2, 4);
      const r = g.n.fbm(x * 2 + q * 2.6 + 3, y * 2 + q * 2.6 + 7, 5);
      const v = smoothstep(0.38, 0.85, g.n.fbm(x * 1.6 + r * 2.2, y * 1.6 + r * 2.2, 5));
      o[0] = c[0] * v;
      o[1] = c[1] * v;
      o[2] = c[2] * v;
    });
  }),
  ov('fog', 'Fog', 'Atmosphere', 'screen', 0.85, ['#dfe8f0'], 'fog mist low haze', (g) => {
    const [c] = g.rgb;
    const hh = g.h / g.s;
    g.pixels((x, y, o) => {
      const drift = g.n.fbm(x * 1.1, y * 2.6, 5);
      const v = clamp01(smoothstep(0.25, 0.8, drift) * smoothstep(0.15, 0.95, y / hh) * 1.15);
      o[0] = c[0] * v;
      o[1] = c[1] * v;
      o[2] = c[2] * v;
    });
  }),
  ov('sparks', 'Sparks', 'Particles', 'screen', 1, ['#ffb347', '#ff5e1a'], 'sparks embers fire particles', (g) => {
    const { ctx, w, h, u, rand, colors } = g;
    black(g);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    // Glow is drawn as a wide faint stroke under each spark: far cheaper than canvas shadows.
    for (let i = 0; i < 240; i++) {
      const x = rand() * w;
      const y = h * (1 - rand() ** 1.6);
      const len = u * (10 + rand() ** 2 * 110);
      const a = -Math.PI / 2 + (rand() - 0.5) * 1.1;
      const color = colors[i % colors.length];
      const width = u * (1.6 + rand() * 3.6);
      const alpha = 0.4 + rand() * 0.6;
      for (const [k, opacity] of [[7, 0.06], [3.5, 0.14], [1, 1]]) {
        ctx.strokeStyle = rgba(color, alpha * opacity);
        ctx.lineWidth = width * k;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }),
  ov('bokeh', 'Bokeh', 'Particles', 'screen', 1, ['#ffd166', '#ef476f', '#06d6a0', '#ffffff'], 'bokeh lights blur circles', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    black(g);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 48; i++) {
      const r = s * (0.02 + rand() ** 2 * 0.085);
      const x = rand() * w;
      const y = rand() * h;
      const color = colors[i % colors.length];
      const alpha = 0.07 + rand() * 0.22;
      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgba(color, alpha * 0.9);
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }),
  ov('dust-particles', 'Dust particles', 'Particles', 'screen', 1, ['#fff3d6'], 'dust particles floating motes', (g) => {
    black(g);
    softParticles(g, 320, 1.5, 22);
  }),
  ov('film-scratches', 'Film scratches', 'Film', 'screen', 0.85, ['#ffffff'], 'film scratches damage old', (g) => {
    const { ctx, w, h, u, rand } = g;
    black(g);
    drawScratches(g, 46, g.colors[0]);
    ctx.fillStyle = g.colors[0];
    for (let i = 0; i < 180; i++) {
      ctx.globalAlpha = 0.2 + rand() * 0.7;
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, u * (0.5 + rand() ** 3 * 4), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }),
  ov('chromatic-fringe', 'Chromatic aberration', 'Film', 'screen', 0.8, ['#ff0040', '#00d0ff'], 'chromatic aberration fringe edges', (g) => {
    const { ctx, w, h, s } = g;
    black(g);
    ctx.globalCompositeOperation = 'lighter';
    const inset = s * 0.012;
    ctx.lineWidth = s * 0.05;
    for (const [color, off] of [
      [g.colors[0], -inset],
      [g.colors[1], inset],
    ] as const) {
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.52);
      grad.addColorStop(0, rgba(color, 0));
      grad.addColorStop(1, rgba(color, 0.75));
      ctx.fillStyle = grad;
      ctx.fillRect(off, off, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
  }),
  ov('blinds-shadow', 'Window shadow', 'Shadow', 'multiply', 0.8, ['#000000'], 'shadow window blinds stripes', (g) => {
    const { ctx, w, h, s } = g;
    const band = s * 0.11;
    const diag = Math.hypot(w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.42);
    for (let y = -diag; y < diag; y += band) {
      const grad = ctx.createLinearGradient(0, y, 0, y + band);
      grad.addColorStop(0, rgba(g.colors[0], 0));
      grad.addColorStop(0.3, rgba(g.colors[0], 0.5));
      grad.addColorStop(0.55, rgba(g.colors[0], 0.5));
      grad.addColorStop(0.85, rgba(g.colors[0], 0));
      ctx.fillStyle = grad;
      ctx.fillRect(-diag, y, diag * 2, band);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }),
  ov('vignette', 'Vignette', 'Shadow', 'normal', 1, ['#000000'], 'vignette dark edges frame', (g) => {
    const { ctx, w, h } = g;
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.55);
    grad.addColorStop(0, rgba(g.colors[0], 0));
    grad.addColorStop(1, rgba(g.colors[0], 0.85));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }),
  ov('glitch-bars', 'Glitch overlay', 'Film', 'screen', 0.9, ['#ff004c', '#00e5ff', '#ffffff'], 'glitch overlay bars digital', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    black(g);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rgba(colors[i % colors.length], 0.2 + rand() * 0.6);
      const bw = w * (0.15 + rand() * 0.85);
      ctx.fillRect(rand() * (w - bw * 0.6), rand() * h, bw, s * (0.002 + rand() ** 3 * 0.04));
    }
  }),
  ov('vhs', 'VHS distortion', 'Film', 'screen', 0.9, ['#ffffff', '#ff3b6b', '#35e0ff'], 'vhs tape tracking static retro video', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    black(g);
    // Fine scan lines, a noisy tracking band near the bottom, and thin colour-fringed tears.
    ctx.fillStyle = rgba(colors[0], 0.07);
    for (let y = 0; y < h; y += Math.max(2, s / 260)) ctx.fillRect(0, y, w, Math.max(1, s / 900));
    const band = h * (0.78 + rand() * 0.12);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rgba(colors[0], 0.1 + rand() * 0.55);
      ctx.fillRect(rand() * w, band + (rand() - 0.5) * s * 0.07, s * (0.005 + rand() * 0.09), s * 0.0025);
    }
    for (let i = 0; i < 9; i++) {
      const y = rand() * h;
      const x = rand() * w * 0.5;
      const len = w * (0.25 + rand() * 0.6);
      const t = s * (0.0015 + rand() * 0.004);
      ctx.fillStyle = rgba(colors[1], 0.55);
      ctx.fillRect(x - s * 0.006, y, len, t);
      ctx.fillStyle = rgba(colors[2], 0.55);
      ctx.fillRect(x + s * 0.006, y + t, len, t);
    }
  }),
  ov('stars', 'Stars', 'Particles', 'screen', 1, ['#ffffff', '#cfe3ff', '#ffe9b8'], 'stars night sky sparkle twinkle space', (g) => {
    const { ctx, w, h, u, rand, colors } = g;
    black(g);
    softParticles(g, 420, 0.8, 4.5);
    // A few bright stars with four-point flares.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = u * (10 + rand() * 26);
      const color = colors[i % colors.length];
      radial(g, x, y, r * 0.45, color, 0.9, 0.1);
      ctx.strokeStyle = rgba(color, 0.75);
      ctx.lineWidth = Math.max(1, u * 1.2);
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r);
      ctx.lineTo(x, y + r);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }),
  ov('light-shapes', 'Abstract light shapes', 'Light', 'screen', 0.9, ['#ff7a59', '#7b5cff', '#35e0ff'], 'abstract light shapes prism glow geometric', (g) => {
    const { ctx, w, h, s, rand, colors } = g;
    black(g);
    ctx.globalCompositeOperation = 'lighter';
    // Large soft-edged bars and discs of light, overlapping at angles.
    for (let i = 0; i < 6; i++) {
      const color = colors[i % colors.length];
      ctx.save();
      ctx.translate(rand() * w, rand() * h);
      ctx.rotate(rand() * Math.PI);
      const len = s * (0.5 + rand() * 0.7);
      const thick = s * (0.05 + rand() * 0.14);
      const grad = ctx.createLinearGradient(0, -thick, 0, thick);
      grad.addColorStop(0, rgba(color, 0));
      grad.addColorStop(0.5, rgba(color, 0.35 + rand() * 0.3));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(-len / 2, -thick, len, thick * 2);
      ctx.restore();
    }
    for (let i = 0; i < 4; i++) radial(g, rand() * w, rand() * h, s * (0.12 + rand() * 0.22), colors[i % colors.length], 0.3 + rand() * 0.25, 0.25);
    ctx.globalCompositeOperation = 'source-over';
  }),
  ov('sunlight', 'Sunlight', 'Light', 'screen', 0.95, ['#fff1c2', '#ffb95e'], 'sunlight sun warm glow corner golden hour', (g) => {
    const { ctx, w, h, s, colors } = g;
    black(g);
    ctx.globalCompositeOperation = 'lighter';
    // The sun just outside the top-left corner: a hot core, a wide warm wash, a few broad shafts.
    radial(g, w * 0.05, h * 0.02, Math.hypot(w, h) * 0.95, colors[1], 0.55);
    radial(g, w * 0.05, h * 0.02, s * 0.6, colors[0], 0.85, 0.08);
    for (let i = 0; i < 5; i++) {
      const a = 0.25 + i * 0.26;
      const reach = Math.hypot(w, h);
      const spread = 0.035 + (i % 2) * 0.02;
      const grad = ctx.createLinearGradient(w * 0.05, h * 0.02, w * 0.05 + Math.cos(a) * reach, h * 0.02 + Math.sin(a) * reach);
      grad.addColorStop(0, rgba(colors[0], 0.28));
      grad.addColorStop(1, rgba(colors[0], 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(w * 0.05, h * 0.02);
      ctx.lineTo(w * 0.05 + Math.cos(a - spread) * reach, h * 0.02 + Math.sin(a - spread) * reach);
      ctx.lineTo(w * 0.05 + Math.cos(a + spread) * reach, h * 0.02 + Math.sin(a + spread) * reach);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }),
];
