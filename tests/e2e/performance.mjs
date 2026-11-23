/**
 * Milestone 2 stress tests: a 24-megapixel photo, many masked layers, long undo chains.
 * Thresholds are deliberately loose (this runs in a headless browser without GPU acceleration);
 * the measured numbers are printed so regressions are visible.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, removeBackground, state, toScreen } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const options = page.locator('[data-testid="tool-options"]');
const stats = () => page.evaluate(() => window.__prysm.rasterStats());
const heapMb = () => page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576));
const alphaAt = async (points) => (await h.exportPng(points, { transparent: true })).pixels;

/** Starts measuring: longest main-thread stall, and how often the canvas was refreshed with new paint. */
const startProbe = () =>
  page.evaluate(() => {
    const probe = (window.__probe = { maxGap: 0, frames: 0, started: performance.now(), last: performance.now() });
    clearInterval(window.__probeTimer);
    window.__probeTimer = setInterval(() => {
      const now = performance.now();
      probe.maxGap = Math.max(probe.maxGap, now - probe.last);
      probe.last = now;
    }, 4);
    window.__probeUnsub?.();
    let version = -1;
    window.__probeUnsub = window.__prysm.tools.subscribe((s) => {
      if (s.session && s.session.version !== version) {
        version = s.session.version;
        probe.frames++;
      }
    });
  });
const stopProbe = () =>
  page.evaluate(() => {
    clearInterval(window.__probeTimer);
    window.__probeUnsub?.();
    const p = window.__probe;
    return { maxGap: Math.round(p.maxGap), frames: p.frames, seconds: (performance.now() - p.started) / 1000 };
  });

async function uploadGenerated(name, width, height, type = 'image/jpeg') {
  const b64 = await page.evaluate(
    async ({ width, height, type }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#2b5c9e');
      g.addColorStop(0.5, '#f2a65a');
      g.addColorStop(1, '#27473d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `hsla(${(i * 47) % 360}, 70%, 55%, 0.5)`;
        ctx.beginPath();
        ctx.arc(((i * 7919) % width), ((i * 104729) % height), 40 + (i % 9) * 30, 0, Math.PI * 2);
        ctx.fill();
      }
      const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(s);
    },
    { width, height, type },
  );
  const before = (await h.layers()).length;
  await h.openTab('uploads');
  const started = Date.now();
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name, mimeType: type, buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before, { timeout: 60000 });
  return { layer: (await h.layers()).at(-1), ms: Date.now() - started, megabytes: (b64.length * 0.75) / 1048576 };
}

let big;

await section('A 24-megapixel photo', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 1600);
  await h.setField('Canvas height', 1200);
  const up = await uploadGenerated('large.jpg', 6000, 4000);
  big = up.layer;
  console.log(`      upload + decode ${up.ms} ms (${up.megabytes.toFixed(1)} MB JPEG), heap ${await heapMb()} MB`);
  t.check('a 6000x4000 image imports', big.type === 'image' && big.width > 0, `${big.width}x${big.height} on canvas`);
  await h.patch(big.id, { x: 0, y: 0, width: 1600, height: 1067 });

  await h.selectRow(big.id);
  await startProbe();
  await props.getByRole('button', { name: 'Add layer mask' }).click();
  let probe = await stopProbe();
  const mask = (await h.layerById(big.id)).masks[0];
  t.check('its mask is capped at 2048 px so it stays light', Math.max(mask.width, mask.height) === 2048, `${mask.width}x${mask.height}`);
  t.check('adding the mask does not stall the editor (< 300 ms)', probe.maxGap < 300, `${probe.maxGap} ms`);

  // A long, large-brush stroke across the whole image.
  await page.keyboard.press('b');
  await options.getByRole('button', { name: 'Hide (black)' }).click();
  await h.setField('Size', 300, options);
  await h.setField('Hardness', 50, options);
  await startProbe();
  await h.stroke([[100, 200], [1500, 300], [200, 600], [1500, 800], [100, 1000]], 30);
  probe = await stopProbe();
  const fps = probe.frames / probe.seconds;
  console.log(`      300px stroke on a 2048px mask: ${probe.frames} canvas updates in ${probe.seconds.toFixed(1)} s (${fps.toFixed(0)}/s), longest stall ${probe.maxGap} ms`);
  t.check('painting a large mask keeps updating smoothly (longest stall < 250 ms)', probe.maxGap < 250 && probe.frames > 20, `${probe.maxGap} ms, ${probe.frames} updates`);

  const px = await alphaAt([[800, 250], [150, 400]]);
  t.check('the stroke hides the right pixels at full export quality', px[0][3] < 10 && px[1][3] === 255, px.map(fmt).join(' '));
  await page.keyboard.press('v');

  // Export at 2x: 3200 x 2400, image re-rendered from the 24 MP original.
  const started = Date.now();
  const out = await h.exportPng([[1600, 500]], { transparent: true, scale: '2×' });
  console.log(`      2x export (3200x2400) ${Date.now() - started} ms, heap ${await heapMb()} MB`);
  t.check('a 2x export of the masked photo works', out.width === 3200 && out.height === 2400 && out.pixels[0][3] < 10, `${out.width}x${out.height} ${fmt(out.pixels[0])}`);
});

await section('Background removal on the 24-megapixel photo', async () => {
  await h.selectRow(big.id);
  await startProbe();
  await removeBackground(page, props, { timeout: 240000 });
  const probe = await stopProbe();
  const job = await page.evaluate(() => window.__prysm.backgroundRemoval.getState());
  console.log(`      ${job.job.phase}: total ${job.lastRun ? Math.round(job.lastRun.totalMs) : '-'} ms, longest stall ${probe.maxGap} ms`);
  // An abstract pattern may legitimately have no subject; either outcome must be clean and quick.
  t.check('a very large image is handled without freezing (longest stall < 400 ms)', ['done', 'error'].includes(job.job.phase) && probe.maxGap < 400, `${job.job.phase}, ${probe.maxGap} ms`);
  if (job.job.phase === 'done') await page.keyboard.press('Control+z');
});

await section('Thirty strokes: memory stays bounded and every one can be undone', async () => {
  await h.selectRow(big.id);
  await page.locator(`[data-layer-id="${big.id}"] [data-testid="mask-thumb"]`).click();
  // Start from a clean mask so the probes below are unambiguous.
  await props.getByRole('button', { name: 'Reset', exact: true }).click();
  await h.settle(300);
  await page.keyboard.press('b');
  await h.setField('Size', 60, options);
  await h.setField('Hardness', 100, options);
  const start = await stats();
  const pastBefore = (await state(page)).past;
  for (let i = 0; i < 30; i++) {
    const y = 80 + i * 30;
    await h.stroke([[1300, y], [1560, y]], 3);
  }
  await h.settle(1500);
  const after = await stats();
  const decodedMb = (after.decodedPixels * 4) / 1048576;
  console.log(`      rasters: ${after.total} stored (${(after.encodedBytes / 1048576).toFixed(1)} MB as PNG), ${after.decoded} decoded = ${decodedMb.toFixed(0)} MB of canvases, heap ${await heapMb()} MB`);
  t.check('each stroke is its own undo step', (await state(page)).past === pastBefore + 30);
  t.check('decoded bitmaps stay within the memory budget', after.decodedPixels <= after.budgetPixels + 2048 * 1366 * 2, `${(after.decodedPixels / 1e6).toFixed(1)} MP decoded, budget ${(after.budgetPixels / 1e6).toFixed(0)} MP`);
  t.check('old undo states are kept only as compact PNGs', after.decoded < after.total && after.total >= start.total + 30, `${after.decoded} of ${after.total} decoded`);

  let px = await alphaAt([[1400, 80], [1400, 950]]);
  t.check('all thirty strokes are in the result', px[0][3] === 0 && px[1][3] === 0, px.map(fmt).join(' '));
  const started = Date.now();
  for (let i = 0; i < 30; i++) await page.keyboard.press('Control+z');
  await h.settle(1500);
  console.log(`      30 undos ${Date.now() - started} ms`);
  px = await alphaAt([[1400, 80], [1400, 950]]);
  t.check('undoing all thirty restores evicted bitmaps correctly', px[0][3] === 255 && px[1][3] === 255 && (await state(page)).past === pastBefore, px.map(fmt).join(' '));
  for (let i = 0; i < 30; i++) await page.keyboard.press('Control+Shift+z');
  await h.settle(1500);
  px = await alphaAt([[1400, 80], [1400, 950]]);
  t.check('redoing them all works too', px[0][3] === 0 && px[1][3] === 0, px.map(fmt).join(' '));
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
});

await section('Eight masked layers', async () => {
  const ids = [];
  for (let i = 0; i < 8; i++) {
    const { layer } = await uploadGenerated(`layer-${i}.jpg`, 1600, 1200);
    await h.patch(layer.id, { x: 60 + i * 150, y: 60 + (i % 3) * 180, width: 480, height: 360, rotation: i * 9 - 30, blendMode: i % 2 ? 'multiply' : 'normal' });
    await h.selectRow(layer.id);
    await props.getByRole('button', { name: 'Add layer mask' }).click();
    await page.keyboard.press('b');
    await h.setField('Size', 90, options);
    const c = [60 + i * 150 + 240, 60 + (i % 3) * 180 + 180];
    await h.stroke([[c[0] - 60, c[1]], [c[0] + 60, c[1]]], 4);
    await page.keyboard.press('v');
    ids.push(layer.id);
  }
  const ls = await h.layers();
  t.check('eight masked, rotated, blended layers plus the photo', ls.filter((l) => l.masks?.length).length === 9, `${ls.length} layers`);

  // Drag one of them across the stack.
  await page.keyboard.press('Escape');
  await h.selectRow(ids[3]);
  const layer = await h.layerById(ids[3]);
  const from = await toScreen(page, layer.x + 60, layer.y + 300);
  await startProbe();
  await h.drag(from, { x: from.x + 220, y: from.y + 90 }, 30);
  let probe = await stopProbe();
  const moved = await h.layerById(ids[3]);
  console.log(`      dragging a masked layer over 8 others: longest stall ${probe.maxGap} ms`);
  t.check('dragging stays responsive with many masked layers (< 250 ms)', probe.maxGap < 250 && !near(moved.x, layer.x, 5), `${probe.maxGap} ms`);

  // Paint on one mask while the others are on screen.
  await page.locator(`[data-layer-id="${ids[5]}"] [data-testid="mask-thumb"]`).click();
  await page.keyboard.press('b');
  const target = await h.layerById(ids[5]);
  await startProbe();
  await h.stroke([[target.x + 100, target.y + 100], [target.x + 380, target.y + 260]], 20);
  probe = await stopProbe();
  console.log(`      painting one mask among 9: ${probe.frames} updates in ${probe.seconds.toFixed(1)} s, longest stall ${probe.maxGap} ms`);
  t.check('painting stays responsive with many masked layers (< 250 ms)', probe.maxGap < 250 && probe.frames > 8, `${probe.maxGap} ms`);
  await page.keyboard.press('v');

  const started = Date.now();
  const out = await h.exportPng([[10, 1190]], { transparent: true });
  const s = await stats();
  console.log(`      export of the full composition ${Date.now() - started} ms; rasters ${s.total} stored, ${s.decoded} decoded (${((s.decodedPixels * 4) / 1048576).toFixed(0)} MB), heap ${await heapMb()} MB`);
  t.check('the composition exports', out.width === 1600 && out.height === 1200);
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
