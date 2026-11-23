/**
 * Magic wand: selects pixels whose colour is close to the clicked one.
 *
 * `tolerance` is the largest difference allowed in any one channel (0..255), so 0 selects one exact
 * colour and 255 selects everything. Transparency counts as a channel: a transparent area is
 * "a colour" that can be selected, and it never bleeds into opaque pixels of any colour.
 */
export function wandSelect(image: ImageData, seedX: number, seedY: number, tolerance: number, contiguous: boolean): HTMLCanvasElement {
  const { width, height, data } = image;
  const out = new ImageData(width, height);
  const result = out.data;
  const seed = (seedY * width + seedX) * 4;
  const sr = data[seed];
  const sg = data[seed + 1];
  const sb = data[seed + 2];
  const sa = data[seed + 3];

  const matches = (i: number) => {
    const a = data[i + 3];
    if (Math.abs(a - sa) > tolerance) return false;
    // Two fully transparent pixels match whatever colour happens to be stored under them.
    if (a === 0 && sa === 0) return true;
    return Math.abs(data[i] - sr) <= tolerance && Math.abs(data[i + 1] - sg) <= tolerance && Math.abs(data[i + 2] - sb) <= tolerance;
  };
  const mark = (i: number) => {
    result[i] = result[i + 1] = result[i + 2] = result[i + 3] = 255;
  };

  if (!contiguous) {
    for (let i = 0; i < data.length; i += 4) if (matches(i)) mark(i);
  } else {
    // Scanline flood fill: each stack entry is a pixel whose whole run is filled at once.
    const seen = new Uint8Array(width * height);
    const stack: number[] = [seedY * width + seedX];
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p]) continue;
      const y = (p / width) | 0;
      let x0 = p - y * width;
      let x1 = x0;
      const row = y * width;
      while (x0 > 0 && !seen[row + x0 - 1] && matches((row + x0 - 1) * 4)) x0--;
      while (x1 < width - 1 && !seen[row + x1 + 1] && matches((row + x1 + 1) * 4)) x1++;
      for (let x = x0; x <= x1; x++) {
        seen[row + x] = 1;
        mark((row + x) * 4);
      }
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= height) continue;
        const nrow = ny * width;
        let inRun = false;
        for (let x = x0; x <= x1; x++) {
          const ok = !seen[nrow + x] && matches((nrow + x) * 4);
          if (ok && !inRun) stack.push(nrow + x);
          inRun = ok;
        }
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
  return canvas;
}
