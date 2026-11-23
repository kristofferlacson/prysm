/**
 * Content-aware fill: rebuilds a missing part of a picture out of the rest of that picture.
 *
 * This is the classical, model-free technique (PatchMatch, Barnes et al. 2009, inside the coarse-to-fine
 * scheme of Wexler et al.): every small patch that touches the hole looks for the most similar patch
 * elsewhere in the image, and each missing pixel becomes a blend of what those matching patches say
 * it should be. It starts on a tiny version of the picture, where the hole is a few pixels wide and
 * the overall structure is easy to get right, and carries the matches up to full size.
 *
 * It continues textures, gradients and simple structure (sky, grass, walls, water, fabric, stripes).
 * It cannot invent things that are not in the picture: it has no idea what a face or a car is.
 *
 * Pure function over typed arrays, so it runs in a worker and is deterministic for a given seed.
 */

/** Patch radius: patches are 7 x 7 pixels. */
const R = 3;
const PATCH = (2 * R + 1) * (2 * R + 1) * 4;
/** Levels with more pixels than this inherit their matches from the level below instead of searching again. */
const SEARCH_BUDGET = 520_000;
/**
 * How a patch's say in the blend falls off with its mismatch (mean squared difference per channel).
 *
 * While the layout is being worked out, on the small levels, the fall-off is gentle
 * (exp(-mismatch / FALLOFF)): many patches are averaged, which keeps gradients smooth and stops a
 * few lucky random matches from planting the wrong content. On the two finest levels, which only
 * add detail, it is steep (1 / (mismatch + SOFTEN)^SHARPNESS): in texture the best matches decide,
 * which keeps it crisp, while in smooth areas every match is near-perfect and they still blend evenly.
 */
const FALLOFF = 2 * 18 * 18;
const SOFTEN = 150;
const SHARPNESS = 4;
const FAR = 0x7fffffff;
/**
 * Preference for nearby material. Deep inside a large hole any self-consistent content looks equally
 * "right" to patch matching, so sky can end up under grass. Each patch therefore pays a little for
 * copying from far away from the nearest real pixels. It is deliberately small (the equivalent of 4
 * levels per channel a third of the picture away): enough to break ties in favour of what is close,
 * never enough to outvote a patch that actually matches better, such as the right row of a gradient.
 */
const DISTANCE_COST = PATCH * 4 * 4;

interface Level {
  w: number;
  h: number;
  /** Premultiplied RGBA. */
  px: Uint8ClampedArray;
  /** 1 = missing. */
  hole: Uint8Array;
}

interface Analysis {
  /** 1 where the patch around the pixel touches the hole: these are the patches that need a match. */
  near: Uint8Array;
  /** 1 where the patch around the pixel is complete (inside the image, no hole): these can be copied from. */
  valid: Uint8Array;
  sources: Int32Array;
  targets: Int32Array;
  /** For every pixel, the nearest pixel that is not missing (itself, when it is known). */
  anchor: Int32Array;
  /** Cost per squared pixel of distance between a patch's anchor and where it copies from. */
  farCost: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Halves the picture. A pixel is missing if any of the four it stands for is; its colour is the average of the known ones. */
function downsample(a: Level): Level {
  const w = Math.ceil(a.w / 2);
  const h = Math.ceil(a.h / 2);
  const px = new Uint8ClampedArray(w * h * 4);
  const hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let al = 0;
      let missing = 0;
      for (let dy = 0; dy < 2; dy++) {
        const sy = Math.min(a.h - 1, y * 2 + dy);
        for (let dx = 0; dx < 2; dx++) {
          const i = sy * a.w + Math.min(a.w - 1, x * 2 + dx);
          if (a.hole[i]) {
            missing = 1;
            continue;
          }
          n++;
          r += a.px[i * 4];
          g += a.px[i * 4 + 1];
          b += a.px[i * 4 + 2];
          al += a.px[i * 4 + 3];
        }
      }
      const j = y * w + x;
      hole[j] = missing;
      if (n) {
        px[j * 4] = r / n;
        px[j * 4 + 1] = g / n;
        px[j * 4 + 2] = b / n;
        px[j * 4 + 3] = al / n;
      }
    }
  }
  return { w, h, px, hole };
}

function analyse(l: Level): Analysis {
  const { w, h, hole } = l;
  const n = w * h;
  // "Is there a hole pixel within R?" as two sliding-window passes.
  const rowAny = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    let count = 0;
    const row = y * w;
    for (let x = 0; x < Math.min(R, w); x++) count += hole[row + x];
    for (let x = 0; x < w; x++) {
      if (x + R < w) count += hole[row + x + R];
      if (x - R - 1 >= 0) count -= hole[row + x - R - 1];
      rowAny[row + x] = count > 0 ? 1 : 0;
    }
  }
  const near = new Uint8Array(n);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y < Math.min(R, h); y++) count += rowAny[y * w + x];
    for (let y = 0; y < h; y++) {
      if (y + R < h) count += rowAny[(y + R) * w + x];
      if (y - R - 1 >= 0) count -= rowAny[(y - R - 1) * w + x];
      near[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  const valid = new Uint8Array(n);
  let sourceCount = 0;
  let targetCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (near[i]) targetCount++;
      else if (x >= R && y >= R && x < w - R && y < h - R) {
        valid[i] = 1;
        sourceCount++;
      }
    }
  }
  const sources = new Int32Array(sourceCount);
  const targets = new Int32Array(targetCount);
  for (let i = 0, s = 0, t = 0; i < n; i++) {
    if (valid[i]) sources[s++] = i;
    else if (near[i]) targets[t++] = i;
  }
  return { near, valid, sources, targets, anchor: nearestKnown(l), farCost: (DISTANCE_COST * 9) / (Math.max(w, h) * Math.max(w, h)) };
}

/**
 * Nearest known pixel for every pixel (by straight-line distance, to within a pixel or so): each
 * pixel takes over the best candidate of its neighbours in two sweeps, down-right then up-left.
 */
function nearestKnown(l: Level) {
  const { w, h, hole } = l;
  const anchor = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) if (!hole[i]) anchor[i] = i;
  const consider = (i: number, x: number, y: number, j: number, best: number) => {
    const a = anchor[j];
    if (a < 0) return best;
    const dx = (a % w) - x;
    const dy = ((a / w) | 0) - y;
    const d = dx * dx + dy * dy;
    if (d < best) {
      anchor[i] = a;
      return d;
    }
    return best;
  };
  const own = (i: number, x: number, y: number) => {
    const a = anchor[i];
    if (a < 0) return Infinity;
    const dx = (a % w) - x;
    const dy = ((a / w) | 0) - y;
    return dx * dx + dy * dy;
  };
  for (let round = 0; round < 2; round++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hole[i]) continue;
        let best = own(i, x, y);
        if (x > 0) best = consider(i, x, y, i - 1, best);
        if (y > 0) {
          best = consider(i, x, y, i - w, best);
          if (x > 0) best = consider(i, x, y, i - w - 1, best);
          if (x < w - 1) best = consider(i, x, y, i - w + 1, best);
        }
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (!hole[i]) continue;
        let best = own(i, x, y);
        if (x < w - 1) best = consider(i, x, y, i + 1, best);
        if (y < h - 1) {
          best = consider(i, x, y, i + w, best);
          if (x < w - 1) best = consider(i, x, y, i + w + 1, best);
          if (x > 0) best = consider(i, x, y, i + w - 1, best);
        }
      }
    }
  }
  // A picture that is all hole has no anchors; the caller has already refused that case.
  return anchor;
}

/** A first guess for the smallest level: colours spread inwards from the rim of the hole, ring by ring. */
function diffuse(l: Level) {
  const { w, h, px, hole } = l;
  const known = new Uint8Array(w * h);
  const queued = new Uint8Array(w * h);
  let ring: number[] = [];
  const offer = (i: number) => {
    if (!known[i] && !queued[i]) {
      queued[i] = 1;
      ring.push(i);
    }
  };
  const around = (i: number, visit: (j: number) => void) => {
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) visit(ny * w + nx);
      }
    }
  };
  for (let i = 0; i < w * h; i++) known[i] = hole[i] ? 0 : 1;
  for (let i = 0; i < w * h; i++) if (known[i]) around(i, offer);
  while (ring.length) {
    const current = ring;
    ring = [];
    const colours = new Float32Array(current.length * 4);
    current.forEach((i, k) => {
      let n = 0;
      around(i, (j) => {
        if (!known[j]) return;
        n++;
        for (let c = 0; c < 4; c++) colours[k * 4 + c] += px[j * 4 + c];
      });
      for (let c = 0; c < 4; c++) colours[k * 4 + c] /= Math.max(1, n);
    });
    current.forEach((i, k) => {
      for (let c = 0; c < 4; c++) px[i * 4 + c] = colours[k * 4 + c];
      known[i] = 1;
    });
    for (const i of current) around(i, offer);
  }
}

/** Squared difference between the patch around `t` and the (complete) patch around `q`; gives up once past `limit`. */
function patchDistance(l: Level, t: number, q: number, limit: number) {
  const { w, h, px } = l;
  const tx = t % w;
  const ty = (t / w) | 0;
  const qx = q % w;
  const qy = (q / w) | 0;
  const x0 = tx < R ? -tx : -R;
  const x1 = tx + R >= w ? w - 1 - tx : R;
  let d = 0;
  for (let dy = -R; dy <= R; dy++) {
    const y = ty + dy;
    if (y < 0 || y >= h) continue;
    let a = (y * w + tx + x0) * 4;
    let b = ((qy + dy) * w + qx + x0) * 4;
    for (let dx = x0; dx <= x1; dx++, a += 4, b += 4) {
      const d0 = px[a] - px[b];
      const d1 = px[a + 1] - px[b + 1];
      const d2 = px[a + 2] - px[b + 2];
      const d3 = px[a + 3] - px[b + 3];
      d += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
    }
    if (d > limit) return FAR;
  }
  return d;
}

/** What it costs patch `t` to copy from `q`: how different they look, plus the preference for nearby material. */
function matchCost(l: Level, a: Analysis, t: number, q: number, limit: number) {
  const from = a.anchor[t];
  const dx = (q % l.w) - (from % l.w);
  const dy = ((q / l.w) | 0) - ((from / l.w) | 0);
  const far = Math.round(a.farCost * (dx * dx + dy * dy));
  if (far > limit) return FAR;
  const d = patchDistance(l, t, q, limit - far);
  return d === FAR ? FAR : d + far;
}

/** One PatchMatch sweep: good matches spread to neighbours, and each patch also tries its luck at random. */
function matchPass(l: Level, a: Analysis, nnf: Int32Array, dist: Int32Array, rng: () => number, iteration: number, randomSearch = true) {
  const { w, h } = l;
  const { targets, valid } = a;
  for (let k = 0; k < targets.length; k++) dist[targets[k]] = matchCost(l, a, targets[k], nnf[targets[k]], FAR - 1);
  const reverse = (iteration & 1) === 1;
  const step = reverse ? 1 : -1;
  const reach = Math.max(w, h);
  for (let k = 0; k < targets.length; k++) {
    const t = targets[reverse ? targets.length - 1 - k : k];
    const x = t % w;
    const y = (t / w) | 0;
    let best = dist[t];
    let match = nnf[t];

    // The neighbour already visited in this sweep probably matches the patch one step over from ours.
    const nx = x + step;
    if (nx >= 0 && nx < w) {
      const from = nnf[t + step];
      if (from >= 0) {
        const cand = from - step;
        const cx = (from % w) - step;
        if (cx >= R && cx < w - R && valid[cand] && cand !== match) {
          const d = matchCost(l, a, t, cand, best);
          // Ties go to the neighbour's choice: coherent regions copy better than a patchwork.
          if (d <= best) {
            best = d;
            match = cand;
          }
        }
      }
    }
    const ny = y + step;
    if (ny >= 0 && ny < h) {
      const from = nnf[t + step * w];
      if (from >= 0) {
        const cand = from - step * w;
        if (cand >= 0 && cand < w * h && valid[cand] && cand !== match) {
          const d = matchCost(l, a, t, cand, best);
          if (d <= best) {
            best = d;
            match = cand;
          }
        }
      }
    }

    for (let radius = randomSearch ? reach : 0; radius >= 1; radius = Math.floor(radius / 2)) {
      const mx = match % w;
      const my = (match / w) | 0;
      const cx = Math.min(w - 1 - R, Math.max(R, mx + Math.round((rng() * 2 - 1) * radius)));
      const cy = Math.min(h - 1 - R, Math.max(R, my + Math.round((rng() * 2 - 1) * radius)));
      const cand = cy * w + cx;
      if (!valid[cand] || cand === match) continue;
      const d = matchCost(l, a, t, cand, best - 1);
      if (d < best) {
        best = d;
        match = cand;
      }
    }
    nnf[t] = match;
    dist[t] = best;
  }
}

/** Every missing pixel becomes the blend of what the matched patches covering it propose. */
function vote(l: Level, a: Analysis, nnf: Int32Array, dist: Int32Array | null, rank: Int32Array, holeCount: number, crisp = false) {
  const { w, h, px, hole } = l;
  const acc = new Float32Array(holeCount * 5);
  const { targets } = a;
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k];
    const q = nnf[t];
    const tx = t % w;
    const ty = (t / w) | 0;
    const qx = q % w;
    const qy = (q / w) | 0;
    const mismatch = dist ? dist[t] / PATCH : 0;
    const weight = !dist ? 1 : crisp ? Math.max(1e-30, 1 / Math.pow(mismatch + SOFTEN, SHARPNESS)) : Math.max(1e-6, Math.exp(-mismatch / FALLOFF));
    for (let dy = -R; dy <= R; dy++) {
      const y = ty + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -R; dx <= R; dx++) {
        const x = tx + dx;
        if (x < 0 || x >= w) continue;
        const i = y * w + x;
        if (!hole[i]) continue;
        const o = rank[i] * 5;
        const s = ((qy + dy) * w + qx + dx) * 4;
        acc[o] += weight * px[s];
        acc[o + 1] += weight * px[s + 1];
        acc[o + 2] += weight * px[s + 2];
        acc[o + 3] += weight * px[s + 3];
        acc[o + 4] += weight;
      }
    }
  }
  for (let i = 0; i < w * h; i++) {
    if (!hole[i]) continue;
    const o = rank[i] * 5;
    const total = acc[o + 4];
    if (total <= 0) continue;
    px[i * 4] = acc[o] / total;
    px[i * 4 + 1] = acc[o + 1] / total;
    px[i * 4 + 2] = acc[o + 2] / total;
    px[i * 4 + 3] = acc[o + 3] / total;
  }
}

/**
 * Evens out the seam between the filled area and the picture around it.
 *
 * Copied patches can be a shade lighter or darker than what they end up next to (think of a sky
 * that is darker towards the top). The step at the rim of the hole is measured, and a correction
 * that equals it at the rim and varies as smoothly as possible across the hole (a harmonic
 * "membrane") is added to the filled pixels. Detail is untouched; only the tone shifts.
 *
 * A step at the rim is only an error if the material that was copied did not have that step itself:
 * where a stripe or an edge of the picture legitimately crosses the rim, the copied patch has the
 * same edge in the same place and nothing is corrected. So the step across the rim is compared with
 * the step between the same two positions in the patch the pixel was copied from.
 */
function harmonise(l: Level, nnf: Int32Array) {
  const { w, h, px, hole } = l;
  const f = Math.max(1, Math.ceil(Math.max(w, h) / 160));
  const cw = Math.ceil(w / f);
  const ch = Math.ceil(h / f);
  const n = cw * ch;
  // A step larger than this is a real edge in the picture, not a tone mismatch.
  const LIMIT = 96;
  const inHole = new Uint8Array(n);
  const fixed = new Uint8Array(n);
  const off = new Float32Array(n * 3);
  const count = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!hole[i]) continue;
      const c = ((y / f) | 0) * cw + ((x / f) | 0);
      inHole[c] = 1;
      const q = nnf[i];
      if (q < 0) continue;
      let k = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      // For each known neighbour: (step across the rim) - (the same step in the copied material).
      const step = (j: number, d: number) => {
        const sj = (q + d) * 4;
        const si = q * 4;
        k++;
        r += px[j * 4] - px[i * 4] - (px[sj] - px[si]);
        g += px[j * 4 + 1] - px[i * 4 + 1] - (px[sj + 1] - px[si + 1]);
        b += px[j * 4 + 2] - px[i * 4 + 2] - (px[sj + 2] - px[si + 2]);
      };
      if (x > 0 && !hole[i - 1]) step(i - 1, -1);
      if (x < w - 1 && !hole[i + 1]) step(i + 1, 1);
      if (y > 0 && !hole[i - w]) step(i - w, -w);
      if (y < h - 1 && !hole[i + w]) step(i + w, w);
      if (!k) continue;
      off[c * 3] += r / k;
      off[c * 3 + 1] += g / k;
      off[c * 3 + 2] += b / k;
      count[c]++;
    }
  }
  let anchors = 0;
  for (let c = 0; c < n; c++) {
    if (!count[c]) continue;
    fixed[c] = 1;
    anchors++;
    for (let k = 0; k < 3; k++) off[c * 3 + k] /= count[c];
    // Limited as a whole colour, not channel by channel, so a capped correction keeps its hue.
    const largest = Math.max(Math.abs(off[c * 3]), Math.abs(off[c * 3 + 1]), Math.abs(off[c * 3 + 2]));
    if (largest > LIMIT) for (let k = 0; k < 3; k++) off[c * 3 + k] *= LIMIT / largest;
  }
  if (!anchors) return;

  const neighbours = (c: number, visit: (j: number) => void) => {
    const x = c % cw;
    const y = (c / cw) | 0;
    if (x > 0) visit(c - 1);
    if (x < cw - 1) visit(c + 1);
    if (y > 0) visit(c - cw);
    if (y < ch - 1) visit(c + cw);
  };
  // A first guess spread ring by ring from the rim, then relaxed until it is smooth.
  const settled = new Uint8Array(fixed);
  let ring: number[] = [];
  for (let c = 0; c < n; c++) if (fixed[c]) neighbours(c, (j) => inHole[j] && !settled[j] && ring.push(j));
  while (ring.length) {
    const current = [...new Set(ring)].filter((c) => !settled[c]);
    ring = [];
    const values = new Float32Array(current.length * 3);
    current.forEach((c, i) => {
      let k = 0;
      neighbours(c, (j) => {
        if (!settled[j]) return;
        k++;
        for (let ch3 = 0; ch3 < 3; ch3++) values[i * 3 + ch3] += off[j * 3 + ch3];
      });
      for (let ch3 = 0; ch3 < 3; ch3++) values[i * 3 + ch3] /= Math.max(1, k);
    });
    current.forEach((c, i) => {
      for (let ch3 = 0; ch3 < 3; ch3++) off[c * 3 + ch3] = values[i * 3 + ch3];
      settled[c] = 1;
    });
    for (const c of current) neighbours(c, (j) => inHole[j] && !settled[j] && ring.push(j));
  }
  const OVER = 1.85;
  for (let it = 0; it < 300; it++) {
    for (let c = 0; c < n; c++) {
      if (!inHole[c] || fixed[c]) continue;
      let k = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      neighbours(c, (j) => {
        if (!inHole[j]) return;
        k++;
        r += off[j * 3];
        g += off[j * 3 + 1];
        b += off[j * 3 + 2];
      });
      if (!k) continue;
      off[c * 3] += OVER * (r / k - off[c * 3]);
      off[c * 3 + 1] += OVER * (g / k - off[c * 3 + 1]);
      off[c * 3 + 2] += OVER * (b / k - off[c * 3 + 2]);
    }
  }
  // Cells outside the hole borrow their neighbours' value, so the correction is not diluted at the rim when it is sampled.
  for (let pass = 0; pass < 2; pass++) {
    const extra: [number, number, number, number][] = [];
    for (let c = 0; c < n; c++) {
      if (inHole[c]) continue;
      let k = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      neighbours(c, (j) => {
        if (!inHole[j]) return;
        k++;
        r += off[j * 3];
        g += off[j * 3 + 1];
        b += off[j * 3 + 2];
      });
      if (k) extra.push([c, r / k, g / k, b / k]);
    }
    for (const [c, r, g, b] of extra) {
      off[c * 3] = r;
      off[c * 3 + 1] = g;
      off[c * 3 + 2] = b;
      inHole[c] = 1;
    }
  }

  for (let y = 0; y < h; y++) {
    const gy = Math.min(ch - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = Math.floor(gy);
    const y1 = Math.min(ch - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!hole[i]) continue;
      const gx = Math.min(cw - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = Math.floor(gx);
      const x1 = Math.min(cw - 1, x0 + 1);
      const fx = gx - x0;
      const alpha = px[i * 4 + 3] / 255;
      for (let k = 0; k < 3; k++) {
        const top = off[(y0 * cw + x0) * 3 + k] * (1 - fx) + off[(y0 * cw + x1) * 3 + k] * fx;
        const bottom = off[(y1 * cw + x0) * 3 + k] * (1 - fx) + off[(y1 * cw + x1) * 3 + k] * fx;
        // Premultiplied colour can never exceed its alpha.
        px[i * 4 + k] = Math.min(px[i * 4 + 3], Math.max(0, px[i * 4 + k] + (top * (1 - fy) + bottom * fy) * alpha));
      }
    }
  }
}

/**
 * Fills the pixels marked in `holeMask` (non-zero = missing) of a straight-alpha RGBA picture.
 * Returns a new RGBA array; pixels outside the hole are returned exactly as they came in.
 * Throws when there is nothing complete enough in the picture to copy from.
 */
export function fillHoles(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  holeMask: Uint8Array,
  onProgress: (fraction: number) => void = () => {},
  seed = 1,
): Uint8ClampedArray {
  const n = width * height;
  const hole = new Uint8Array(n);
  let missing = 0;
  for (let i = 0; i < n; i++) {
    if (holeMask[i]) {
      hole[i] = 1;
      missing++;
    }
  }
  const out = new Uint8ClampedArray(rgba);
  if (!missing) return out;

  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    if (hole[i]) continue;
    const a = rgba[i * 4 + 3];
    px[i * 4] = (rgba[i * 4] * a) / 255;
    px[i * 4 + 1] = (rgba[i * 4 + 1] * a) / 255;
    px[i * 4 + 2] = (rgba[i * 4 + 2] * a) / 255;
    px[i * 4 + 3] = a;
  }

  const levels: Level[] = [{ w: width, h: height, px, hole }];
  const info: Analysis[] = [analyse(levels[0])];
  if (!info[0].sources.length) throw new Error('There is not enough picture around this area to fill it from.');
  while (levels.length < 10) {
    const last = levels[levels.length - 1];
    if (Math.min(last.w, last.h) < 4 * (2 * R + 1)) break;
    const next = downsample(last);
    const analysis = analyse(next);
    if (analysis.sources.length < 24) break;
    levels.push(next);
    info.push(analysis);
  }

  const rng = mulberry32(seed);
  const total = levels.reduce((sum, l) => sum + l.w * l.h, 0);
  let done = 0;
  let coarse: Int32Array | null = null;
  let coarseW = 0;

  for (let li = levels.length - 1; li >= 0; li--) {
    const level = levels[li];
    const a = info[li];
    // The preference for nearby material matters while the layout is decided; the two finest levels
    // only add detail to a layout that is already right, so they are freer to look further afield.
    const crisp = li <= 1;
    if (crisp) a.farCost *= 0.3;
    const size = level.w * level.h;
    const { w, h } = level;
    const pick = () => a.sources[Math.min(a.sources.length - 1, Math.floor(rng() * a.sources.length))];

    const rank = new Int32Array(size).fill(-1);
    let holeCount = 0;
    for (let i = 0; i < size; i++) if (level.hole[i]) rank[i] = holeCount++;

    const nnf = new Int32Array(size).fill(-1);
    if (!coarse) {
      for (let k = 0; k < a.targets.length; k++) nnf[a.targets[k]] = pick();
      diffuse(level);
    } else {
      // Carry each match up: the same place in the picture, at twice the resolution.
      for (let k = 0; k < a.targets.length; k++) {
        const t = a.targets[k];
        const x = t % w;
        const y = (t / w) | 0;
        const c = coarse[(y >> 1) * coarseW + (x >> 1)];
        let match = -1;
        if (c >= 0) {
          const qx = Math.min(w - 1 - R, Math.max(R, (c % coarseW) * 2 + (x & 1)));
          const qy = Math.min(h - 1 - R, Math.max(R, ((c / coarseW) | 0) * 2 + (y & 1)));
          if (a.valid[qy * w + qx]) match = qy * w + qx;
        }
        nnf[t] = match >= 0 ? match : pick();
      }
      vote(level, a, nnf, null, rank, holeCount);
    }

    const dist = new Int32Array(size);
    if (size <= SEARCH_BUDGET || !coarse) {
      const passes = size < 20_000 ? 8 : size < 110_000 ? 5 : 3;
      for (let it = 0; it < passes; it++) {
        matchPass(level, a, nnf, dist, rng, it);
        vote(level, a, nnf, dist, rank, holeCount, crisp);
        onProgress(Math.min(0.99, (done + (size * (it + 1)) / passes) / total));
      }
    } else {
      // Too many pixels to search again. The matches carried up from below are refined by letting
      // good ones spread to their neighbours (once in each direction), then blended by how well they fit.
      matchPass(level, a, nnf, dist, rng, 0, false);
      onProgress(Math.min(0.99, (done + size * 0.4) / total));
      matchPass(level, a, nnf, dist, rng, 1, false);
      vote(level, a, nnf, dist, rank, holeCount, crisp);
    }
    done += size;
    onProgress(Math.min(0.99, done / total));
    coarse = nnf;
    coarseW = w;
  }

  if (coarse) harmonise(levels[0], coarse);

  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue;
    const a = px[i * 4 + 3];
    out[i * 4 + 3] = a;
    if (a > 0) {
      out[i * 4] = (px[i * 4] * 255) / a;
      out[i * 4 + 1] = (px[i * 4 + 1] * 255) / a;
      out[i * 4 + 2] = (px[i * 4 + 2] * 255) / a;
    } else {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 0;
    }
  }
  onProgress(1);
  return out;
}
