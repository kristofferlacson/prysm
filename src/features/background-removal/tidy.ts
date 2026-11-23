/**
 * Tidying up after an object is added to or taken out of a cut-out.
 *
 * The object's outline comes from one model and the outline of what was already kept from another
 * (or from a brush), so the two never meet exactly. Taking an object out leaves a hairline of it
 * behind where its two outlines differ; putting one back leaves a hairline gap between it and
 * whatever it touches. Both are removed here, and only next to the object's own outline, so nothing
 * else in the picture is touched.
 */

/** One direction of an erosion: a cell stays 1 only if every cell within `r` along the line is 1. */
function erodeLines(src: Uint8Array, dst: Uint8Array, w: number, h: number, r: number, horizontal: boolean) {
  const length = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 1 : w;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w : line;
    // Zeros in the window around the current cell. Cells outside the bitmap count as 1.
    let zeros = 0;
    for (let i = 0; i <= Math.min(r, length - 1); i++) if (!src[base + i * step]) zeros++;
    for (let i = 0; i < length; i++) {
      dst[base + i * step] = zeros === 0 ? 1 : 0;
      const enter = i + r + 1;
      const leave = i - r;
      if (enter < length && !src[base + enter * step]) zeros++;
      if (leave >= 0 && !src[base + leave * step]) zeros--;
    }
  }
}

/** Shrinks the 1-area of a bitmap of 0s and 1s by `r` cells (a square neighbourhood). The outside counts as 1. */
export function erode(bits: Uint8Array, w: number, h: number, r: number) {
  const tmp = new Uint8Array(bits.length);
  const out = new Uint8Array(bits.length);
  erodeLines(bits, tmp, w, h, r, true);
  erodeLines(tmp, out, w, h, r, false);
  return out;
}

const inverted = (bits: Uint8Array) => {
  const out = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) out[i] = bits[i] ? 0 : 1;
  return out;
};

/** Grows the 1-area by `r` cells. The outside counts as 0. */
export function dilate(bits: Uint8Array, w: number, h: number, r: number) {
  return inverted(erode(inverted(bits), w, h, r));
}

/**
 * Cleans the seam an object leaves. `coverage` (alpha, 0..255, changed in place) already has the
 * object kept or removed; `object` is the object's own alpha at the same size.
 *
 *  - after removing: kept slivers thinner than about 2 * `thin` along the object's outline go too;
 *  - after keeping: removed gaps that thin along its outline are closed.
 */
export function tidySeam(coverage: Uint8Array, object: Uint8Array, width: number, height: number, action: 'keep' | 'remove', thin: number) {
  // Work only in the object's surroundings.
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (object[row + x] < 128) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return;
  const margin = thin * 5 + 2;
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);
  const w = right - left + 1;
  const h = bottom - top + 1;

  const kept = new Uint8Array(w * h);
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const from = (top + y) * width + left;
    for (let x = 0; x < w; x++) {
      kept[y * w + x] = coverage[from + x] > 127 ? 1 : 0;
      inside[y * w + x] = object[from + x] > 127 ? 1 : 0;
    }
  }
  // Near the object's outline, on either side of it.
  const outer = dilate(inside, w, h, thin * 2);
  const inner = erode(inside, w, h, thin * 2);

  /** Applies `value` to every cell near the object's outline for which `test` holds. */
  const along = (test: (i: number) => number | boolean, value: number) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (outer[i] && !inner[i] && test(i)) coverage[(top + y) * width + left + x] = value;
      }
    }
  };

  if (action === 'remove') {
    // Opening: what survives shrinking and growing back is solid, not a sliver. Everything along
    // the outline that is not solid, or the soft rim of something solid, goes: the slivers, and
    // the faint edge the object itself leaves behind.
    const solid = dilate(erode(kept, w, h, thin), w, h, thin);
    const nearSolid = dilate(solid, w, h, 1);
    along((i) => !nearSolid[i], 0);
  } else {
    // Closing: what is kept after growing and shrinking back had at most a hairline gap in it.
    // Along the outline, everything inside that (but not its outer rim, which stays soft) is kept:
    // the gaps, and the soft rims that faced each other across them.
    const closed = erode(dilate(kept, w, h, thin), w, h, thin);
    const deep = erode(closed, w, h, 1);
    along((i) => deep[i], 255);
  }
}
