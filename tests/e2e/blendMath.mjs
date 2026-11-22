/** Reference blend formulas from the W3C Compositing and Blending spec, for opaque source over opaque backdrop. */

const screen = (s, d) => s + d - s * d;
const hardLight = (s, d) => (s <= 0.5 ? d * 2 * s : screen(d, 2 * s - 1));

const separable = {
  normal: (s) => s,
  multiply: (s, d) => s * d,
  screen,
  overlay: (s, d) => hardLight(d, s),
  darken: (s, d) => Math.min(s, d),
  lighten: (s, d) => Math.max(s, d),
  'color-dodge': (s, d) => (d === 0 ? 0 : s === 1 ? 1 : Math.min(1, d / (1 - s))),
  'color-burn': (s, d) => (d === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - d) / s)),
  'hard-light': hardLight,
  'soft-light': (s, d) => {
    if (s <= 0.5) return d - (1 - 2 * s) * d * (1 - d);
    const g = d <= 0.25 ? ((16 * d - 12) * d + 4) * d : Math.sqrt(d);
    return d + (2 * s - 1) * (g - d);
  },
  difference: (s, d) => Math.abs(s - d),
  exclusion: (s, d) => s + d - 2 * s * d,
};

const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const sat = (c) => Math.max(...c) - Math.min(...c);

function clipColor(c) {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n));
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l));
  return out;
}

const setLum = (c, l) => {
  const d = l - lum(c);
  return clipColor(c.map((v) => v + d));
};

function setSat(c, s) {
  const order = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [min, mid, max] = order;
  const out = [0, 0, 0];
  if (c[max] > c[min]) {
    out[mid] = ((c[mid] - c[min]) * s) / (c[max] - c[min]);
    out[max] = s;
  }
  return out;
}

const nonSeparable = {
  hue: (s, d) => setLum(setSat(s, sat(d)), lum(d)),
  saturation: (s, d) => setLum(setSat(d, sat(s)), lum(d)),
  color: (s, d) => setLum(s, lum(d)),
  luminosity: (s, d) => setLum(d, lum(s)),
};

/** Expected 8-bit RGB when `src` is drawn over `dst` with the given blend mode and opacity. */
export function blend(mode, src, dst, opacity = 1) {
  const s = src.map((v) => v / 255);
  const d = dst.map((v) => v / 255);
  const mixed = separable[mode] ? s.map((v, i) => separable[mode](v, d[i])) : nonSeparable[mode](s, d);
  return mixed.map((v, i) => Math.round((d[i] + (v - d[i]) * opacity) * 255));
}

export const BLEND_MODES = [...Object.keys(separable), ...Object.keys(nonSeparable)];
