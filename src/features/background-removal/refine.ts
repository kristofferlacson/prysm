/**
 * Edge refinement for a low-resolution segmentation mask.
 *
 * The networks predict at 320 px (or 1024 px), so a mask scaled up to the photo is soft and only
 * roughly follows the subject. A guided filter (He et al., 2010) uses the photo itself as a guide:
 * within each small window the mask is modelled as a linear function of the image brightness, which
 * snaps mask edges onto real image edges while leaving flat regions alone.
 */

/** Mean over a (2r+1)^2 window, edges clamped. Separable running sums, O(n). */
function boxFilter(src: Float32Array, w: number, h: number, r: number, tmp: Float32Array, out: Float32Array) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let i = 1; i <= r; i++) acc += src[row + Math.min(i, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm;
      acc += src[row + Math.min(x + r + 1, w - 1)] - src[row + Math.max(x - r, 0)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = tmp[x] * (r + 1);
    for (let i = 1; i <= r; i++) acc += tmp[Math.min(i, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * norm;
      acc += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
    }
  }
}

/**
 * @param guide  image luminance, 0..1
 * @param mask   coverage, 0..1 (same size as guide)
 * @param radius window radius in pixels
 * @param eps    edge sensitivity: smaller values follow weaker image edges
 */
export function guidedFilter(guide: Float32Array, mask: Float32Array, w: number, h: number, radius: number, eps: number) {
  const n = w * h;
  const tmp = new Float32Array(n);
  const meanI = new Float32Array(n);
  const meanP = new Float32Array(n);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  const scratch = new Float32Array(n);

  boxFilter(guide, w, h, radius, tmp, meanI);
  boxFilter(mask, w, h, radius, tmp, meanP);
  for (let i = 0; i < n; i++) scratch[i] = guide[i] * guide[i];
  boxFilter(scratch, w, h, radius, tmp, a); // a = mean(I*I)
  for (let i = 0; i < n; i++) scratch[i] = guide[i] * mask[i];
  boxFilter(scratch, w, h, radius, tmp, b); // b = mean(I*p)

  for (let i = 0; i < n; i++) {
    const variance = a[i] - meanI[i] * meanI[i];
    const covariance = b[i] - meanI[i] * meanP[i];
    const k = covariance / (variance + eps);
    a[i] = k;
    b[i] = meanP[i] - k * meanI[i];
  }
  boxFilter(a, w, h, radius, tmp, meanI);
  boxFilter(b, w, h, radius, tmp, meanP);

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = meanI[i] * guide[i] + meanP[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}
