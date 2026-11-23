/** Colour maths for the colour picker. Channels are 0–255, hue is 0–360, the rest 0–1. */

export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Hue, saturation and brightness: the two axes of the picker's square plus its hue slider. */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

function hslToHex(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return rgbToHex(f(0), f(8), f(4));
}

const HUES = [0, 22, 42, 58, 95, 150, 185, 212, 255, 310];
const SHADES: [number, number][] = [
  [0.95, 0.86],
  [0.9, 0.72],
  [0.88, 0.56],
  [0.8, 0.42],
  [0.72, 0.27],
];

/**
 * The ready-made colours offered by every colour control: a row of greys from black to white, then
 * ten hues from pale to dark. Ten to a row.
 */
export const PALETTE: string[] = [
  ...Array.from({ length: 10 }, (_, i) => {
    const v = Math.round((i / 9) * 255);
    return rgbToHex(v, v, v);
  }),
  ...SHADES.flatMap(([s, l]) => HUES.map((h) => hslToHex(h, s, l))),
];
