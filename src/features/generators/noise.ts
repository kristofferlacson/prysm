/** Seeded randomness and coherent noise used by the procedural generators and effects. */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Voronoi {
  /** Distance to the nearest and second-nearest feature points. */
  d1: number;
  d2: number;
  /** Stable random value (0..1) of the nearest cell. */
  id: number;
  /** Vector from the sample to the nearest feature point. */
  vx: number;
  vy: number;
}

export function makeNoise(seed: number) {
  const rand = mulberry32(seed);
  const values = new Float32Array(256);
  const perm = new Uint8Array(512);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < 256; i++) {
    values[i] = rand();
    perm[i] = perm[i + 256] = order[i];
  }
  const lattice = (x: number, y: number) => values[perm[(x & 255) + perm[y & 255]]];

  /** Smooth value noise, 0..1. */
  function noise(x: number, y: number) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = lattice(xi, yi);
    const b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1);
    const d = lattice(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Fractal noise, 0..1. */
  function fbm(x: number, y: number, octaves = 5) {
    let amp = 0.5;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x, y);
      norm += amp;
      amp *= 0.5;
      x = x * 2 + 17.3;
      y = y * 2 + 9.1;
    }
    return sum / norm;
  }

  const cell: Voronoi = { d1: 0, d2: 0, id: 0, vx: 0, vy: 0 };
  /** Cellular noise. Returns a shared object that is overwritten on every call. */
  function voronoi(x: number, y: number): Voronoi {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let d1 = 99;
    let d2 = 99;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = xi + ox;
        const cy = yi + oy;
        const px = cx + lattice(cx, cy) - x;
        const py = cy + lattice(cx + 37, cy + 91) - y;
        const dd = px * px + py * py;
        if (dd < d1) {
          d2 = d1;
          d1 = dd;
          cell.id = lattice(cx + 11, cy + 53);
          cell.vx = px;
          cell.vy = py;
        } else if (dd < d2) {
          d2 = dd;
        }
      }
    }
    cell.d1 = Math.sqrt(d1);
    cell.d2 = Math.sqrt(d2);
    return cell;
  }

  return { noise, fbm, voronoi };
}

export const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
