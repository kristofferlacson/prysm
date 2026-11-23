import type { RasterSource } from '../image-editing/pipeline';
import { blankCanvas } from '../masks/maskActions';

/**
 * Background removal for pictures on a plain backdrop: logos, icons, illustrations, product shots.
 *
 * A subject-finding network is the wrong tool for these. It was trained on photographs, so on flat
 * artwork it guesses a soft, blobby outline and leaves patches of the backdrop behind. But when the
 * backdrop is one colour, no guessing is needed: the background is exactly the area of that colour
 * that is connected to the edge of the picture. Areas of the same colour that are enclosed by the
 * artwork (the white of an eye, the inside of a letter) are part of the artwork and are kept.
 */

/**
 * How different a border pixel may be from the backdrop colour and still count as backdrop (per
 * channel, 0..255). Deliberately strict: it allows compression noise, but not the gentle gradient or
 * texture of a photographed wall or studio backdrop, which the subject-finding network handles better.
 */
const BORDER_TOLERANCE = 12;
/** How different a pixel may be and still be removed. A little wider, to take in compression noise. */
const FILL_TOLERANCE = 34;
/** Share of the picture's border that must be the backdrop colour for the backdrop to count as plain. */
const PLAIN_SHARE = 0.95;

export interface PlainBackground {
  /** Coverage bitmap: opaque where the picture is kept. */
  mask: HTMLCanvasElement;
  colour: [number, number, number];
  /** Share of the picture that was removed (0..1). */
  removed: number;
}

/**
 * Finds a plain backdrop and returns the mask that removes it, or null when the picture does not
 * have one (or when removing it would leave nothing, or change nothing). With `force`, the most
 * common border colour is used even if the border is not uniform.
 */
export function plainBackgroundMask(source: RasterSource, width: number, height: number, force = false): PlainBackground | null {
  const canvas = blankCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  const n = width * height;

  // The frame of pixels around the picture, two deep.
  const border: number[] = [];
  for (let y = 0; y < height; y++) {
    const edgeRow = y < 2 || y >= height - 2;
    for (let x = 0; x < width; x++) if (edgeRow || x < 2 || x >= width - 2) border.push(y * width + x);
  }
  const opaque = border.filter((i) => d[i * 4 + 3] >= 200);
  // A picture whose edges are already transparent has had its background removed.
  if (opaque.length < border.length * 0.5) return null;

  // Most common border colour (in coarse bins), then the average of the pixels around it.
  const bins = new Map<number, number>();
  for (const i of opaque) {
    const key = ((d[i * 4] >> 4) << 8) | ((d[i * 4 + 1] >> 4) << 4) | (d[i * 4 + 2] >> 4);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  let mode = 0;
  let most = 0;
  for (const [key, count] of bins) {
    if (count > most) {
      most = count;
      mode = key;
    }
  }
  const centre = [((mode >> 8) & 15) * 16 + 8, ((mode >> 4) & 15) * 16 + 8, (mode & 15) * 16 + 8];
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const i of opaque) {
    if (Math.abs(d[i * 4] - centre[0]) > 20 || Math.abs(d[i * 4 + 1] - centre[1]) > 20 || Math.abs(d[i * 4 + 2] - centre[2]) > 20) continue;
    r += d[i * 4];
    g += d[i * 4 + 1];
    b += d[i * 4 + 2];
    count++;
  }
  if (!count) return null;
  const colour: [number, number, number] = [r / count, g / count, b / count];

  // How far each pixel is from the backdrop colour. Transparent pixels count as backdrop.
  const dist = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] < 16) continue;
    dist[i] = Math.max(Math.abs(d[i * 4] - colour[0]), Math.abs(d[i * 4 + 1] - colour[1]), Math.abs(d[i * 4 + 2] - colour[2]));
  }
  let matching = 0;
  for (const i of opaque) if (dist[i] <= BORDER_TOLERANCE) matching++;
  if (!force && matching / opaque.length < PLAIN_SHARE) return null;

  // The background: everything of that colour that can be reached from the border.
  const background = new Uint8Array(n);
  const stack: number[] = [];
  for (const i of border) {
    if (!background[i] && dist[i] <= FILL_TOLERANCE) {
      background[i] = 1;
      stack.push(i);
    }
  }
  let removed = 0;
  while (stack.length) {
    const i = stack.pop()!;
    removed++;
    const x = i % width;
    const visit = (j: number) => {
      if (!background[j] && dist[j] <= FILL_TOLERANCE) {
        background[j] = 1;
        stack.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < n - width) visit(i + width);
  }
  const share = removed / n;
  if (share < 0.02 || share > 0.97) return null;

  // Coverage. The one-pixel rim of the artwork is a blend of artwork and backdrop (anti-aliasing):
  // it is kept in proportion to how far it has moved from the backdrop colour towards the artwork
  // next to it, which gives a smooth edge instead of a staircase with a fringe.
  const out = ctx.createImageData(width, height);
  const o = out.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = 255;
      if (background[i]) continue;
      let rim = false;
      let inner = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          if (background[j]) {
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) rim = true;
          } else if (dist[j] > inner) inner = dist[j];
        }
      }
      if (!rim) {
        o[i * 4 + 3] = 255;
        continue;
      }
      const a = dist[i] / Math.max(inner, FILL_TOLERANCE + 1);
      o[i * 4 + 3] = a >= 0.92 ? 255 : a <= 0.08 ? 0 : Math.round(a * 255);
    }
  }
  ctx.putImageData(out, 0, 0);
  return { mask: canvas, colour, removed: share };
}
