/**
 * Mask coordinate system validation.
 *
 * The same picture is loaded at three very different resolutions (so its mask has three different
 * sampling densities), placed in the same box, and painted with the same stroke. Mask edges are then
 * located to sub-pixel accuracy in exported files and compared with where geometry says they must be:
 * after moving, resizing, rotating, flipping and cropping the layer, at several export scales, with
 * feathering, and against what the editor shows on screen.
 */
import { helpers, launch, makeReporter, near, openEditor, removeBackground, view } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const options = page.locator('[data-testid="tool-options"]');

// ---------- measuring ----------

/** Alpha along a vertical or horizontal line of the exported PNG, sampled at every pixel. */
async function alphaLine(axis, at, from, to, scale = 1) {
  const label = { 0.5: '0.5×', 1: '1×', 2: '2×', 3: '3×' }[scale];
  const points = [];
  for (let v = Math.round(from * scale); v <= Math.round(to * scale); v++) {
    points.push(axis === 'x' ? [v, Math.round(at * scale)] : [Math.round(at * scale), v]);
  }
  const out = await h.exportPng(points, { transparent: true, scale: label });
  return { values: out.pixels.map((p) => p[3]), origin: Math.round(from * scale), scale };
}

/** Positions (document units) where the values cross `level`, interpolated between pixel centres. */
function crossings({ values, origin, scale }, level = 127.5) {
  const out = [];
  for (let i = 0; i < values.length - 1; i++) {
    const a = values[i];
    const b = values[i + 1];
    if ((a - level) * (b - level) < 0) out.push((origin + i + 0.5 + (level - a) / (b - a)) / scale);
  }
  return out;
}

const edges = async (axis, at, from, to, scale = 1) => crossings(await alphaLine(axis, at, from, to, scale));
const show = (list) => `[${list.map((v) => v.toFixed(2)).join(', ')}]`;
const matches = (found, expected, tol) => found.length === expected.length && found.every((v, i) => near(v, expected[i], tol));

/** Width of a soft edge: distance between its 25% and 75% alpha points around `near`. */
function transitionWidth(line, around) {
  const pick = (level) => crossings(line, level).sort((a, b) => Math.abs(a - around) - Math.abs(b - around))[0];
  return Math.abs(pick(191.25) - pick(63.75));
}

async function uploadPicture(width, height) {
  const url = await page.evaluate(
    ({ width, height }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, width / 2, height);
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(width / 2, 0, width / 2, height);
      return c.toDataURL('image/png');
    },
    { width, height },
  );
  const before = (await h.layers()).length;
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: `picture-${width}.png`, mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before, { timeout: 60000 });
  return (await h.layers()).at(-1);
}

// The layer's box, and a hide stroke from (300,250) to (500,250) with an 80 px hard brush.
const BOX = { x: 200, y: 100, width: 600, height: 400 };
const R = 40 * 0.99; // a hard tip reaches half coverage at 99% of its radius
const TOP = 250 - R;
const BOTTOM = 250 + R;
const LEFT = 300 - R;
const RIGHT = 500 + R;

const results = [];

await page.locator('[data-testid="canvas-size"]').click();
await h.setField('Canvas width', 1200);
await h.setField('Canvas height', 800);

for (const [w, hgt] of [[300, 200], [1200, 800], [4800, 3200]]) {
  const tag = `${w}x${hgt}`;
  const r = { tag };
  results.push(r);

  await section(`Source ${tag}`, async () => {
    const layer = await uploadPicture(w, hgt);
    await h.patch(layer.id, BOX);
    await h.selectRow(layer.id);
    await props.getByRole('button', { name: 'Add layer mask' }).click();
    const mask = (await h.layerById(layer.id)).masks[0];
    r.mask = `${mask.width}x${mask.height}`;
    const longer = Math.max(mask.width, mask.height);
    t.check(`${tag}: mask density is chosen independently of the image (${r.mask})`, longer >= 1024 && longer <= 2048 && near(mask.width / mask.height, 1.5, 0.01));

    await page.keyboard.press('b');
    await options.getByRole('button', { name: 'Hide (black)' }).click();
    await h.setField('Size', 80, options);
    await h.setField('Hardness', 100, options);
    await h.setField('Opacity', 100, options);
    await h.setField('Smoothing', 0, options);
    await h.stroke([[300, 250], [500, 250]], 16);
    await page.keyboard.press('v');

    // 1. The stroke is where the pointer was.
    r.vertical = await edges('y', 400, 180, 320);
    r.horizontal = await edges('x', 250, 220, 580);
    t.check(`${tag}: mask edges are where the brush was (vertical)`, matches(r.vertical, [TOP, BOTTOM], 1.5), `${show(r.vertical)} expected ${show([TOP, BOTTOM])}`);
    t.check(`${tag}: mask edges are where the brush was (horizontal)`, matches(r.horizontal, [LEFT, RIGHT], 1.5), `${show(r.horizontal)} expected ${show([LEFT, RIGHT])}`);

    // 2. On screen, at the editor's preview resolution and current zoom.
    await page.keyboard.press('Escape');
    const v = await view(page);
    const column = [];
    for (let y = 180; y <= 320; y += 0.5) column.push([400, y]);
    const screen = await h.screenPixels(column);
    // Red image (G = 0) against the white canvas (G = 255) where the mask hides it.
    const onScreen = crossings({ values: screen.map((p) => 255 - p[1]), origin: 0, scale: 1 }).map((i) => 180 + (i - 0.5) / 2);
    t.check(`${tag}: the editor shows the same edges as the export`, matches(onScreen, r.vertical, 1.5 / v.zoom + 0.5), `screen ${show(onScreen)} export ${show(r.vertical)} (zoom ${v.zoom.toFixed(2)})`);
    await h.selectRow(layer.id);

    // 3. Move by an odd offset.
    await h.patch(layer.id, { x: BOX.x + 137, y: BOX.y + 59 });
    let found = await edges('y', 537, 239, 379);
    t.check(`${tag}: edges move exactly with the layer`, matches(found, [TOP + 59, BOTTOM + 59], 1.5), show(found));

    // 4. Resize to 1.5x from a different origin.
    await h.patch(layer.id, { x: 100, y: 50, width: 900, height: 600 });
    const scaled = (v0) => 50 + ((v0 - BOX.y) / BOX.height) * 600;
    found = await edges('y', 400, 150, 420);
    t.check(`${tag}: edges scale with the layer`, matches(found, [scaled(TOP), scaled(BOTTOM)], 2), `${show(found)} expected ${show([scaled(TOP), scaled(BOTTOM)])}`);
    await h.patch(layer.id, BOX);

    // 5. Rotate 90 degrees clockwise about the centre (500,300): (dx,dy) -> (-dy,dx).
    await h.patch(layer.id, { rotation: 90 });
    found = await edges('x', 300, 440, 660);
    const rotated = [500 - (BOTTOM - 300), 500 - (TOP - 300)];
    t.check(`${tag}: edges rotate with the layer`, matches(found, rotated, 1.5), `${show(found)} expected ${show(rotated)}`);
    await h.patch(layer.id, { rotation: 0 });

    // 6. Flip horizontally about x = 500.
    await props.getByRole('button', { name: 'Flip horizontally' }).click();
    found = await edges('x', 250, 420, 780);
    const flipped = [1000 - RIGHT, 1000 - LEFT];
    t.check(`${tag}: edges flip with the layer`, matches(found, flipped, 1.5), `${show(found)} expected ${show(flipped)}`);
    await props.getByRole('button', { name: 'Flip horizontally' }).click();

    // 7. Crop: the remaining pixels, and their mask, stay exactly where they were.
    await props.getByRole('button', { name: 'Crop' }).click();
    await props.getByLabel('Left', { exact: true }).fill('15');
    await props.getByLabel('Top', { exact: true }).fill('10');
    const cropped = await h.layerById(layer.id);
    found = await edges('y', 400, 180, 320);
    const across = await edges('x', 250, 300, 580);
    t.check(`${tag}: cropping keeps the mask aligned`, near(cropped.x, 290, 0.01) && near(cropped.y, 140, 0.01) && matches(found, r.vertical, 0.75) && matches(across, [RIGHT], 1.5), `${show(found)} / ${show(across)}`);
    await props.getByLabel('Left', { exact: true }).fill('0');
    await props.getByLabel('Top', { exact: true }).fill('0');

    // 8. Export scale: positions scale, they do not drift.
    r.scales = {};
    for (const s of [0.5, 2, 3]) {
      r.scales[s] = await edges('y', 400, 180, 320, s);
      t.check(`${tag}: edges are in the same place in a ${s}x export`, matches(r.scales[s], r.vertical, Math.max(0.75, 1 / s)), `${show(r.scales[s])} vs ${show(r.vertical)}`);
    }

    // 9. Feather is defined on the image, not on the render: 2% of the source's longer side = 12 px here.
    await props.getByLabel('Feather', { exact: true }).fill('50');
    const feather = (await h.layerById(layer.id)).masks[0].feather;
    const sigma = feather * BOX.width;
    let line = await alphaLine('y', 400, 150, 350);
    r.featherWidth = transitionWidth(line, TOP);
    r.featherCentre = crossings(line)[0];
    t.check(`${tag}: feather width matches its definition`, near(r.featherWidth, 1.349 * sigma, 2.5), `${r.featherWidth.toFixed(2)} px, expected ${(1.349 * sigma).toFixed(2)} (sigma ${sigma.toFixed(1)})`);
    t.check(`${tag}: feathering does not move the edge`, near(r.featherCentre, TOP, 1.5), r.featherCentre.toFixed(2));

    // Cropping must not change the feather, even right next to the crop edge.
    const before = await alphaLine('y', 330, 150, 350);
    await props.getByLabel('Left', { exact: true }).fill('20');
    const after = await alphaLine('y', 330, 150, 350);
    const worst = Math.max(...after.values.map((value, i) => Math.abs(value - before.values[i])));
    const width = transitionWidth(await alphaLine('y', 400, 150, 350), TOP);
    t.check(`${tag}: cropping does not change the feather`, near(width, r.featherWidth, 1) && worst <= 6, `width ${width.toFixed(2)} vs ${r.featherWidth.toFixed(2)}; largest alpha change 10 px from the crop edge: ${worst}`);
    await props.getByLabel('Left', { exact: true }).fill('0');

    // ... and it scales with the layer.
    await h.patch(layer.id, { x: 0, y: 0, width: 1200, height: 800 });
    line = await alphaLine('y', 400, 150, 450);
    const big = transitionWidth(line, (TOP - BOX.y) * 2);
    t.check(`${tag}: feather scales with the layer`, near(big, r.featherWidth * 2, 3), `${big.toFixed(2)} vs 2 x ${r.featherWidth.toFixed(2)}`);

    await page.keyboard.press('Delete');
  });
}

await section('The three resolutions agree with each other', async () => {
  const spread = (pick) => {
    const all = results.map(pick);
    return Math.max(...all[0].map((_, i) => Math.max(...all.map((a) => a[i])) - Math.min(...all.map((a) => a[i]))));
  };
  console.log(results.map((r) => `      ${r.tag.padEnd(10)} mask ${r.mask.padEnd(10)} edges ${show(r.vertical)} ${show(r.horizontal)} feather ${r.featherWidth.toFixed(2)}`).join('\n'));
  t.check('edge positions agree across source resolutions', spread((r) => [...r.vertical, ...r.horizontal]) <= 1.5, `largest difference ${spread((r) => [...r.vertical, ...r.horizontal]).toFixed(2)} px`);
  t.check('feather width agrees across source resolutions', spread((r) => [r.featherWidth]) <= 1.5, `largest difference ${spread((r) => [r.featherWidth]).toFixed(2)} px`);
  t.check('export-scale results agree across source resolutions', spread((r) => [...r.scales[0.5], ...r.scales[2], ...r.scales[3]]) <= 2, `largest difference ${spread((r) => [...r.scales[0.5], ...r.scales[2], ...r.scales[3]]).toFixed(2)} px`);
});

await section('Masks inside transformed groups', async () => {
  // A masked layer inside a rotated, scaled group: the stroke must still land under the pointer.
  const layer = await uploadPicture(1200, 800);
  await h.patch(layer.id, { x: 300, y: 200, width: 450, height: 300, rotation: 20 });
  await h.openTab('elements');
  await page.getByTitle('Rectangle', { exact: true }).click();
  const rect = (await h.layers()).at(-1);
  await h.patch(rect.id, { x: 800, y: 500, width: 100, height: 100 });
  await h.selectRow(layer.id);
  await h.selectRow(rect.id, ['Shift']);
  await page.keyboard.press('Control+g');
  const group = (await h.layers()).at(-1);
  await h.patch(group.id, { rotation: -35, scaleX: 1.3, scaleY: 1.3 });
  await h.selectRow(layer.id);
  await props.getByRole('button', { name: 'Add layer mask' }).click();
  await page.keyboard.press('b');
  await h.setField('Size', 60, options);
  // Find a point that is on the image, then paint there.
  const probe = [560, 400];
  let px = (await h.exportPng([probe], { transparent: true })).pixels[0];
  t.check('the probe point is on the image before painting', px[3] === 255, `[${px}]`);
  await h.stroke([[probe[0] - 20, probe[1]], [probe[0] + 20, probe[1]]], 6);
  await page.keyboard.press('v');
  const col = await edges('y', probe[0], probe[1] - 60, probe[1] + 60);
  t.check('a stroke on a layer inside a rotated, scaled group lands under the pointer', matches(col, [probe[1] - 30 * 0.99, probe[1] + 30 * 0.99], 1.5), show(col));
  await h.selectRow(group.id);
  await page.keyboard.press('Delete');
});

await section('Background removal is resolution independent too', async () => {
  const installed = await page.evaluate(async () => {
    const res = await fetch('/models/silueta.onnx', { method: 'HEAD' });
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  });
  if (!installed) {
    t.check('segmentation model installed (npm run setup:ai)', false);
    return;
  }
  const draw = `
    const u = w / 640;
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#8c8478'); g.addColorStop(1, '#5f5a52');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let y = 60; y < 480; y += 96) { ctx.fillStyle = 'rgba(30,25,20,0.35)'; ctx.fillRect(0, y * u, w, 3 * u); }
    const ball = (x, y, r) => { const s = ctx.createRadialGradient((x - r * 0.35) * u, (y - r * 0.4) * u, r * 0.05 * u, x * u, y * u, r * u); s.addColorStop(0, '#ffb08a'); s.addColorStop(0.35, '#e23a22'); s.addColorStop(1, '#6e0d08'); ctx.fillStyle = s; ctx.beginPath(); ctx.arc(x * u, y * u, r * u, 0, Math.PI * 2); ctx.fill(); };
    ball(300, 250, 150);`;
  const runs = [];
  for (const [w, hgt] of [[320, 240], [1920, 1440]]) {
    const url = await page.evaluate(({ draw, w, hgt }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = hgt;
      new Function('ctx', 'w', 'h', draw)(c.getContext('2d'), w, hgt);
      return c.toDataURL('image/png');
    }, { draw, w, hgt });
    const before = (await h.layers()).length;
    await h.openTab('uploads');
    await page.locator('[data-testid="upload-input"]').setInputFiles({ name: `ball-${w}.png`, mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
    await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before);
    const layer = (await h.layers()).at(-1);
    await h.patch(layer.id, { x: 200, y: 100, width: 800, height: 600 });
    await h.selectRow(layer.id);
    await page.evaluate(() => window.__prysm.backgroundRemoval.getState().set({ job: null }));
    await removeBackground(page, props);
    const phase = await page.evaluate(() => window.__prysm.backgroundRemoval.getState().job.phase);
    const mask = (await h.layerById(layer.id)).masks[0];
    // The ball: centre (575, 412.5), radius 187.5 in document units.
    const row = phase === 'done' ? await edges('x', 412, 330, 820) : [];
    const colm = phase === 'done' ? await edges('y', 575, 170, 650) : [];
    runs.push({ w, phase, mask: mask ? `${mask.width}x${mask.height}` : '-', row, colm });
    await page.keyboard.press('Delete');
  }
  console.log(runs.map((r) => `      source ${String(r.w).padEnd(5)} mask ${r.mask.padEnd(10)} subject edges x ${show(r.row)} y ${show(r.colm)}`).join('\n'));
  t.check('both resolutions produce a mask', runs.every((r) => r.phase === 'done' && r.row.length === 2 && r.colm.length === 2));
  const expectedRow = [575 - 187.5, 575 + 187.5];
  const expectedCol = [412.5 - 187.5, 412.5 + 187.5];
  t.check('the generated mask follows the subject outline', runs.every((r) => matches(r.row, expectedRow, 7) && matches(r.colm, expectedCol, 7)), `expected x ${show(expectedRow)} y ${show(expectedCol)}`);
  const drift = Math.max(...runs[0].row.map((v, i) => Math.abs(v - runs[1].row[i])), ...runs[0].colm.map((v, i) => Math.abs(v - runs[1].colm[i])));
  t.check('a 320 px and a 1920 px copy of the photo get the same cut-out (within 6 px of 800)', drift <= 6, `largest difference ${drift.toFixed(2)} px`);
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
