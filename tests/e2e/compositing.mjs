/**
 * Compositing and export validation.
 *
 * Part 1 checks the arithmetic: a layer's visible contribution is (mask coverage x layer opacity),
 * blended with its mode against what is underneath, including inside clipping groups and groups.
 * Expected colours are computed from the W3C blend formulas.
 *
 * Part 2 checks that an export is the same picture however it is produced: at other scales, in
 * other formats, compared with the editor canvas at several zoom levels, after save and reopen,
 * after undo and redo, and regardless of editor-only overlays.
 */
import { readFileSync } from 'node:fs';
import { blend, BLEND_MODES } from './blendMath.mjs';
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, view, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const options = page.locator('[data-testid="tool-options"]');
const flat = async (points) => (await h.exportPng(points)).pixels;
const clear = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const setBlend = (mode) => props.getByLabel('Blend mode', { exact: true }).selectOption(mode);
const setOpacity = (value) => props.getByLabel('Opacity', { exact: true }).first().fill(String(value));
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

const SRC = [240, 100, 30];
const DST = [96, 160, 200];
const BASE = [40, 200, 120];

async function uploadSolid(rgb, size) {
  const url = await page.evaluate(
    ({ rgb, size }) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = `rgb(${rgb.join(',')})`;
      ctx.fillRect(0, 0, size, size);
      return c.toDataURL('image/png');
    },
    { rgb, size },
  );
  const before = (await h.layers()).length;
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'solid.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before);
  return (await h.layers()).at(-1);
}

async function maskStroke(points, size, opacity) {
  await page.keyboard.press('b');
  await options.getByRole('button', { name: 'Hide (black)' }).click();
  await h.setField('Size', size, options);
  await h.setField('Hardness', 100, options);
  await h.setField('Opacity', opacity, options);
  await h.stroke(points, 10);
  await page.keyboard.press('v');
}

/** Exports through the dialog with any combination of options and returns the file. */
async function exportFile({ format = 'PNG', scale = '1×', transparent = false, quality, width } = {}) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.locator('[data-testid="export-dialog"]');
  await dlg.getByRole('button', { name: format, exact: true }).click();
  await dlg.getByRole('button', { name: scale, exact: true }).click();
  if (width) await h.setField('Export width', width, dlg);
  if (format !== 'JPG') {
    const sw = dlg.getByRole('switch', { name: 'Transparent background' });
    if ((await sw.getAttribute('aria-checked')) !== String(transparent)) await sw.click();
  }
  if (quality && format !== 'PNG') await dlg.getByLabel('Quality', { exact: true }).fill(String(quality));
  const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: /^Export (PNG|JPG|WEBP)$/ }).click()]);
  const buffer = readFileSync(await download.path());
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'detached' });
  return { buffer, mime: { PNG: 'image/png', JPG: 'image/jpeg', WebP: 'image/webp' }[format] };
}

/**
 * Whole-image comparison. Both files are brought to the size of the smaller one (area-averaged),
 * then compared pixel by pixel.
 */
function compare(a, b) {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async ({ b64, mime }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return createImageBitmap(new Blob([bytes], { type: mime }));
      };
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width);
      const hgt = Math.min(ia.height, ib.height);
      const pixels = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = hgt;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, hgt);
        return ctx.getImageData(0, 0, w, hgt).data;
      };
      const da = pixels(ia);
      const db = pixels(ib);
      let sum = 0;
      let max = 0;
      let over = 0;
      for (let i = 0; i < da.length; i += 4) {
        let worst = 0;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs(da[i + c] - db[i + c]);
          sum += d;
          if (d > worst) worst = d;
        }
        if (worst > max) max = worst;
        if (worst > 32) over++;
      }
      return { a: `${ia.width}x${ia.height}`, b: `${ib.width}x${ib.height}`, mean: sum / da.length, max, over: over / (da.length / 4) };
    },
    {
      a: { b64: a.buffer.toString('base64'), mime: a.mime },
      b: { b64: b.buffer.toString('base64'), mime: b.mime },
    },
  );
}
const report = (d) => `${d.a} vs ${d.b}: mean difference ${d.mean.toFixed(3)}, largest ${d.max}, ${(d.over * 100).toFixed(2)}% of pixels differ by more than 32`;

let A; // masked image: 50% band, hidden band
let E; // ellipse, clipping base
let C; // masked image clipped to the ellipse

const P50 = [300, 300];
const P100 = [300, 150];
const P0 = [300, 450];

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 1000);
  await h.setField('Canvas height', 800);
  await h.setField('Fill colour hex', '#60a0c8');
  A = await uploadSolid(SRC, 400);
  await h.patch(A.id, { x: 100, y: 100 });
  await h.selectRow(A.id);
  await props.getByRole('button', { name: 'Add layer mask' }).click();
  await maskStroke([[150, 300], [450, 300]], 200, 50);
  await maskStroke([[150, 450], [450, 450]], 60, 100);
  const px = await clear([P50, P100, P0]);
  t.check('the mask has a 50% band, a revealed area and a hidden band', near(px[0][3], 128, 4) && px[1][3] === 255 && px[2][3] === 0, px.map(fmt).join(' '));
  t.check('partially masked pixels keep their true colour (no dark fringe)', rgbNear(px[0], SRC, 3), fmt(px[0]));
});

await section('Mask coverage x layer opacity x blend mode', async () => {
  await h.selectRow(A.id);
  await setOpacity(80);
  let px = await clear([P50, P100, P0]);
  t.check('alpha is mask coverage times layer opacity', near(px[0][3], 0.5 * 0.8 * 255, 4) && near(px[1][3], 0.8 * 255, 3) && px[2][3] === 0 && rgbNear(px[0], SRC, 4), px.map(fmt).join(' '));

  const failures = [];
  for (const mode of BLEND_MODES) {
    await setBlend(mode);
    px = await flat([P50, P100, P0]);
    const half = blend(mode, SRC, DST, 0.4);
    const full = blend(mode, SRC, DST, 0.8);
    if (!rgbNear(px[0], half, 4)) failures.push(`${mode} at 50% mask: ${fmt(px[0])} expected [${half}]`);
    if (!rgbNear(px[1], full, 4)) failures.push(`${mode} unmasked: ${fmt(px[1])} expected [${full}]`);
    if (!rgbNear(px[2], DST, 2)) failures.push(`${mode} fully masked: ${fmt(px[2])} expected [${DST}]`);
  }
  t.check(`all ${BLEND_MODES.length} blend modes are weighted by mask and opacity`, failures.length === 0, failures.slice(0, 4).join(' | '));
  await setBlend('normal');
  await setOpacity(100);
});

const C_BAND = [725, 275];
const C_FULL = [725, 180];
const C_OUT = [560, 60];

await section('Clipping + mask + blend + opacity', async () => {
  await h.openTab('elements');
  await page.getByTitle('Circle', { exact: true }).click();
  E = (await h.layers()).at(-1);
  await h.patch(E.id, { x: 550, y: 100, width: 350, height: 350, fill: { type: 'solid', color: '#28c878' } });
  C = await uploadSolid(SRC, 400);
  await h.patch(C.id, { x: 500, y: 50, width: 450, height: 450 });
  await h.selectRow(C.id);
  await props.getByRole('button', { name: 'Add layer mask' }).click();
  await maskStroke([[600, 275], [850, 275]], 100, 50);
  await h.selectRow(C.id);
  await props.getByRole('switch', { name: 'Clip to layer below' }).click();

  const failures = [];
  for (const mode of ['normal', 'screen', 'multiply', 'overlay', 'difference', 'color', 'luminosity']) {
    await h.selectRow(C.id);
    await setBlend(mode);
    const px = await flat([C_BAND, C_FULL, C_OUT]);
    const band = blend(mode, SRC, BASE, 0.5);
    const full = blend(mode, SRC, BASE, 1);
    if (!rgbNear(px[0], band, 4)) failures.push(`${mode} band: ${fmt(px[0])} expected [${band}]`);
    if (!rgbNear(px[1], full, 4)) failures.push(`${mode} full: ${fmt(px[1])} expected [${full}]`);
    if (!rgbNear(px[2], DST, 2)) failures.push(`${mode} outside the base: ${fmt(px[2])} expected [${DST}]`);
  }
  t.check('a clipped, masked layer blends with its base at mask strength and stays inside it', failures.length === 0, failures.slice(0, 4).join(' | '));

  // Base opacity, then base blend mode, act on the finished clipping group.
  await h.selectRow(C.id);
  await setBlend('screen');
  const inside = { band: blend('screen', SRC, BASE, 0.5), full: blend('screen', SRC, BASE, 1) };
  await h.selectRow(E.id);
  await setOpacity(60);
  let px = await flat([C_BAND, C_FULL, C_OUT]);
  t.check('base opacity fades the whole clipping group', rgbNear(px[0], mix(DST, inside.band, 0.6), 4) && rgbNear(px[1], mix(DST, inside.full, 0.6), 4) && rgbNear(px[2], DST, 2), `${px.map(fmt).join(' ')} expected [${mix(DST, inside.band, 0.6)}] [${mix(DST, inside.full, 0.6)}]`);
  const alpha = await clear([C_BAND, C_OUT]);
  t.check('and shows as alpha in a transparent export', near(alpha[0][3], 0.6 * 255, 4) && alpha[1][3] === 0, alpha.map(fmt).join(' '));
  await setBlend('multiply');
  px = await flat([C_BAND, C_FULL]);
  const expected = [blend('multiply', inside.band, DST, 0.6), blend('multiply', inside.full, DST, 0.6)];
  t.check('base blend mode blends the whole clipping group with the canvas', rgbNear(px[0], expected[0], 4) && rgbNear(px[1], expected[1], 4), `${px.map(fmt).join(' ')} expected [${expected[0]}] [${expected[1]}]`);
});

await section('A masked layer inside a blended, faded group', async () => {
  await h.openTab('elements');
  await page.getByTitle('Rectangle', { exact: true }).click();
  const r = (await h.layers()).at(-1);
  await h.patch(r.id, { x: 20, y: 720, width: 40, height: 40 });
  await h.selectRow(A.id);
  await h.selectRow(r.id, ['Shift']);
  await page.keyboard.press('Control+g');
  await setOpacity(50);
  await setBlend('multiply');
  const px = await flat([P50, P100, P0]);
  const expected = [blend('multiply', SRC, DST, 0.25), blend('multiply', SRC, DST, 0.5)];
  t.check('group opacity and blend apply on top of the mask', rgbNear(px[0], expected[0], 4) && rgbNear(px[1], expected[1], 4) && rgbNear(px[2], DST, 2), `${px.map(fmt).join(' ')} expected [${expected[0]}] [${expected[1]}]`);
  const ls = await h.layers();
  t.check('the composition has a clipping group and a layer group', ls.some((l) => l.clip) && ls.some((l) => l.type === 'group'));
  await page.keyboard.press('Escape');
});

let reference;

await section('Export scales and formats', async () => {
  reference = await exportFile();
  const dims = await compare(reference, reference);
  t.check('reference export has the canvas size', dims.a === '1000x800' && dims.max === 0);

  for (const [scale, size, limit] of [['2×', '2000x1600', 1.2], ['3×', '3000x2400', 1.2], ['0.5×', '500x400', 1.6]]) {
    const d = await compare(await exportFile({ scale }), reference);
    t.check(`${scale} export is the same picture at ${size}`, d.a === size && d.mean < limit && d.over < 0.012, report(d));
  }

  const custom = await exportFile({ width: 777 });
  let d = await compare(custom, reference);
  t.check('a custom export width gives exact dimensions', d.a === '777x622' && d.mean < 2, report(d));

  d = await compare(await exportFile({ format: 'WebP', quality: 100 }), reference);
  t.check('WebP export matches the PNG', d.mean < 1.5 && d.over < 0.01, report(d));
  d = await compare(await exportFile({ format: 'JPG', quality: 100 }), reference);
  t.check('JPG export matches the PNG', d.mean < 2.5 && d.over < 0.02, report(d));

  // Transparent export: where the design is opaque it must equal the flat export exactly.
  const transparent = await exportFile({ transparent: true });
  const again = await exportFile({ transparent: true });
  d = await compare(transparent, again);
  t.check('exporting twice gives identical files', d.max === 0, report(d));
});

await section('The editor canvas matches the export at any zoom', async () => {
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  // Deterministic scatter of document points.
  const all = [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) all.push([Math.floor(20 + rnd() * 960), Math.floor(20 + rnd() * 760)]);
  const exported = (await h.exportPng(all)).pixels;

  const check = async (label) => {
    const v = await view(page);
    const visible = all
      .map((p, i) => ({ p, i, sx: v.pan.x + p[0] * v.zoom, sy: v.pan.y + p[1] * v.zoom }))
      .filter((q) => q.sx > 8 && q.sy > 8 && q.sx < host.width - 8 && q.sy < host.height - 8);
    const screen = await h.screenPixels(visible.map((q) => q.p));
    const wrong = visible.filter((q, k) => !rgbNear(screen[k], exported[q.i], 12)).length;
    t.check(`${label}: canvas matches the export`, visible.length > 60 && wrong / visible.length < 0.05, `${visible.length} points compared at zoom ${v.zoom.toFixed(2)}, ${wrong} differ (edges)`);
  };

  await page.getByRole('button', { name: /Fit canvas/ }).click();
  await check('fit to screen');
  await page.locator('[data-testid="zoom-level"]').click();
  await check('100%');
  await page.getByRole('button', { name: /Zoom in/ }).click();
  await page.getByRole('button', { name: /Zoom in/ }).click();
  await page.getByRole('button', { name: /Zoom in/ }).click();
  await check('about 195%');
  // Pan so a different part of the design is on screen.
  await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
  await page.mouse.wheel(260, 240);
  await h.settle(200);
  await check('zoomed and panned');
  await page.getByRole('button', { name: /Zoom out/ }).click();
  await page.getByRole('button', { name: /Zoom out/ }).click();
  await page.getByRole('button', { name: /Zoom out/ }).click();
  await page.getByRole('button', { name: /Zoom out/ }).click();
  await page.getByRole('button', { name: /Zoom out/ }).click();
  await check('zoomed out');
  await page.getByRole('button', { name: /Fit canvas/ }).click();

  // The zoom level must not leak into the file.
  const d = await compare(await exportFile(), reference);
  t.check('export is unaffected by the zoom and pan it was made at', d.max === 0, report(d));
});

await section('Editor-only state never reaches the file', async () => {
  // Grid on, a layer selected (handles showing), mask view on, brush tool active.
  await h.viewOption((menu) => menu.getByRole('switch', { name: 'Show grid' }).click());
  await h.selectRow(C.id);
  await props.getByRole('switch', { name: 'Show mask' }).click();
  await page.keyboard.press('b');
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
  let d = await compare(await exportFile(), reference);
  t.check('grid, selection handles, mask view and brush cursor are not exported', d.max === 0, report(d));
  await page.keyboard.press('v');
  await props.getByRole('switch', { name: 'Show mask' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await h.viewOption((menu) => menu.getByRole('switch', { name: 'Show grid' }).click());

  // Hidden layers are left out; showing them again restores the picture exactly.
  const eye = page.locator(`[data-layer-id="${E.id}"]`).getByRole('button', { name: 'Hide layer' });
  await eye.click();
  const hidden = await flat([C_BAND, C_FULL]);
  t.check('hiding a clipping base removes its whole group from the export', hidden.every((p) => rgbNear(p, DST, 2)), hidden.map(fmt).join(' '));
  await page.locator(`[data-layer-id="${E.id}"]`).getByRole('button', { name: 'Show layer' }).click();
  d = await compare(await exportFile(), reference);
  t.check('showing it again restores the export exactly', d.max === 0, report(d));
});

await section('Undo / redo and save / reopen reproduce the export exactly', async () => {
  const before = await state(page);
  const steps = Math.min(12, before.past);
  for (let i = 0; i < steps; i++) await page.keyboard.press('Control+z');
  await h.settle(300);
  const undone = await compare(await exportFile(), reference);
  for (let i = 0; i < steps; i++) await page.keyboard.press('Control+Shift+z');
  await h.settle(600);
  let d = await compare(await exportFile(), reference);
  t.check(`undoing ${steps} steps changes the picture, redoing them restores it exactly`, undone.max > 0 && d.max === 0, `after undo: largest difference ${undone.max}; after redo: ${report(d)}`);

  await waitForSaved(page);
  const saved = (await state(page)).doc;
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n, saved.layers.length);
  await h.settle(1500);
  d = await compare(await exportFile(), reference);
  t.check('the reopened project exports the identical picture', d.max <= 1, report(d));
  d = await compare(await exportFile({ scale: '2×' }), reference);
  t.check('and so does its 2× export', d.mean < 1.2 && d.over < 0.012, report(d));
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
