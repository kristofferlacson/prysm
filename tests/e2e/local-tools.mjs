/**
 * Tools that run entirely in the browser, with no AI service: content-aware fill (object removal),
 * image expansion, upscaling with the Real-ESRGAN model, the polygonal lasso and saved selections.
 * Driven through the real interface; results are measured on exported pixels and on the stored images.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, toScreen, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);

const panel = page.locator('[data-testid="selection-panel"]');
const options = page.locator('[data-testid="selection-options"]');
const props = page.locator('[data-testid="properties-panel"]');
const toast = () => page.evaluate(() => window.__prysm.ui.getState().toast?.text ?? '');
const idle = (timeout = 240000) => page.waitForFunction(() => window.__prysm.local.getState().job === null, null, { timeout });
const lastRun = () => page.evaluate(() => window.__prysm.local.getState().lastRun);
const alphaAt = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const sel = (points = []) =>
  page.evaluate((points) => {
    const s = window.__prysm.selection.getState();
    const { doc } = window.__prysm.editor.getState();
    if (!s.mask) return { active: false, coverage: 0, bounds: null, at: points.map(() => 0) };
    const k = s.mask.width / doc.width;
    const ctx = s.mask.getContext('2d', { willReadFrequently: true });
    return { active: true, coverage: s.coverage, bounds: s.bounds, at: points.map(([x, y]) => ctx.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data[3] / 255) };
  }, points);
const describe = (s) => (s.bounds ? `${s.bounds.x.toFixed(0)},${s.bounds.y.toFixed(0)} ${s.bounds.width.toFixed(0)}x${s.bounds.height.toFixed(0)}, ${(s.coverage * 100).toFixed(2)}%` : 'nothing selected');

async function dragDoc(from, to) {
  await h.drag(await toScreen(page, from[0], from[1]), await toScreen(page, to[0], to[1]));
}
async function clickDoc(point, opts = {}) {
  const p = await toScreen(page, point[0], point[1]);
  await page.mouse.click(p.x, p.y, opts);
  await h.settle(120);
}
async function upload(name, draw, size) {
  const url = await page.evaluate(
    ({ draw, size }) => {
      const c = document.createElement('canvas');
      c.width = size[0];
      c.height = size[1];
      new Function('ctx', 'w', 'h', draw)(c.getContext('2d'), c.width, c.height);
      return c.toDataURL('image/png');
    },
    { draw, size },
  );
  const before = (await h.layers()).length;
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before);
  const ls = await h.layers();
  return ls[ls.length - 1];
}
/** Size of the stored image behind an image layer, and pixels read from it at fractional positions. */
const assetOf = (layerId, points = []) =>
  page.evaluate(
    async ({ layerId, points }) => {
      const layer = window.__prysm.editor.getState().doc.layers.find((l) => l.id === layerId);
      if (layer.source.kind !== 'asset') return { kind: layer.source.kind, width: layer.source.width, height: layer.source.height, pixels: [] };
      const meta = window.__prysm.assets.getState().assets.find((a) => a.id === layer.source.assetId);
      const img = new Image();
      img.src = meta.url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return {
        kind: 'asset',
        id: meta.id,
        mime: meta.mime,
        width: c.width,
        height: c.height,
        pixels: points.map(([u, v]) => Array.from(ctx.getImageData(Math.min(c.width - 1, Math.floor(u * c.width)), Math.min(c.height - 1, Math.floor(v * c.height)), 1, 1).data)),
      };
    },
    { layerId, points },
  );
const openSection = async (title) => {
  const header = props.getByRole('button', { name: title, exact: true });
  const body = header.locator('xpath=ancestor::section[1]');
  if ((await body.locator(':scope > div').count()) < 2) await header.click();
  return body;
};
const removeAll = () =>
  page.evaluate(() => {
    const e = window.__prysm.editor.getState();
    e.deleteLayers(e.doc.layers.map((l) => l.id));
    window.__prysm.selection.getState().mask && window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
  });

// Horizontal stripes, 24 px period: rows 0-11 light, 12-23 dark.
const STRIPES = `for (let y = 0; y < h; y += 24) { ctx.fillStyle = '#e8d8a0'; ctx.fillRect(0, y, w, 12); ctx.fillStyle = '#305070'; ctx.fillRect(0, y + 12, w, 12); }`;
const LIGHT = [232, 216, 160];
const DARK = [48, 80, 112];
const isLight = (p, tol = 40) => rgbNear(p, LIGHT, tol);
const isDark = (p, tol = 40) => rgbNear(p, DARK, tol);

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  const model = await page.evaluate(async () => {
    const r = await fetch('/models/realesr-general-x4v3.onnx', { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  });
  t.check('the upscaling model is installed (npm run setup:ai)', model);
  const licence = await page.evaluate(async () => (await (await fetch('/models/LICENSE-Real-ESRGAN.txt')).text()).slice(0, 60));
  t.check('its licence text is shipped next to it', /BSD 3-Clause License/.test(licence), licence.replace(/\s+/g, ' '));
});

await section('Content-aware fill: removing an object', async () => {
  // Striped wall with a red box in the middle of it.
  const wall = await upload('wall.png', `${STRIPES} ctx.fillStyle = '#d01818'; ctx.fillRect(250, 150, 100, 100);`, [600, 400]);
  await h.patch(wall.id, { x: 100, y: 100 });
  await h.settle(200);
  // Box on canvas: 350..450 x 250..350. Light rows of the wall on canvas: y mod 24 in [4, 16) (offset 100).
  const before = await alphaAt([[400, 300]]);
  t.check('the object is there to begin with', rgbNear(before[0], [208, 24, 24], 6), fmt(before[0]));
  await page.keyboard.press('m');
  await dragDoc([335, 235], [465, 365]);
  const history = await state(page);
  await panel.getByRole('button', { name: 'Content-aware fill', exact: true }).click();
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, history.doc.layers.length, { timeout: 120000 });
  await idle();
  await h.settle(300);
  const after = await state(page);
  const fill = after.doc.layers[after.doc.layers.length - 1];
  const run = await lastRun();
  t.check('the fill arrives as a new masked image layer, in one undo step', fill.name === 'Content-aware fill' && fill.type === 'image' && fill.masks.length === 1 && after.past === history.past + 1);
  t.check('the layer underneath is untouched', JSON.stringify(after.doc.layers[0]) === JSON.stringify(history.doc.layers[0]));
  console.log(`      info: content-aware fill of a ${run.width} x ${run.height} px area took ${Math.round(run.milliseconds)} ms`);
  t.check('it ran in the browser in a few seconds', run.kind === 'fill' && run.milliseconds < 30000, `${Math.round(run.milliseconds)} ms`);

  // Sample a grid inside the old box: no red left, and each row carries the stripe colour of the wall around it.
  const points = [];
  for (let y = 256; y < 346; y += 6) for (const x of [360, 380, 400, 420, 440]) points.push([x, y]);
  const px = await alphaAt(points);
  const red = px.filter((p) => p[0] > 170 && p[1] < 90 && p[2] < 90).length;
  let right = 0;
  points.forEach(([, y], i) => {
    const phase = (((y - 100) % 24) + 24) % 24;
    // Skip rows within 2 px of a stripe edge, where the blend is legitimately in between.
    if (phase % 12 < 2 || phase % 12 > 9) return right++;
    if (phase < 12 ? isLight(px[i]) : isDark(px[i])) right++;
  });
  t.check('the object is gone', red === 0, `${red} of ${px.length} samples still red`);
  t.check('the stripes of the wall continue through where it was', right / points.length > 0.9, `${right} of ${points.length} samples match the stripe at their row`);
  const edge = await alphaAt([[300, 300], [500, 304], [400, 200]]);
  t.check('outside the selection nothing changed', isLight(edge[0], 4) && isDark(edge[1], 4) && isLight(edge[2], 4), edge.map(fmt).join(' '));

  await page.keyboard.press('Control+z');
  await h.settle(200);
  const undone = await alphaAt([[400, 300]]);
  t.check('undo brings the object back', rgbNear(undone[0], [208, 24, 24], 6), fmt(undone[0]));
  await page.keyboard.press('Control+d');

  // A smooth gradient: the filled area should carry the gradient on.
  await removeAll();
  const sky = await upload('sky.png', `const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#1040a0'); g.addColorStop(1, '#f0c080'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(300, 200, 40, 0, 7); ctx.fill();`, [600, 400]);
  await h.patch(sky.id, { x: 100, y: 100 });
  await h.settle(200);
  await page.evaluate(() => window.__prysm.selection.getState().set({ marqueeShape: 'ellipse' }));
  await dragDoc([350, 250], [450, 350]);
  const count = (await h.layers()).length;
  await panel.getByRole('button', { name: 'Content-aware fill', exact: true }).click();
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, count, { timeout: 120000 });
  await idle();
  await h.settle(300);
  const filled = await alphaAt([[400, 300], [400, 280], [400, 320], [250, 300], [250, 280], [250, 320]]);
  const close = [0, 1, 2].every((i) => rgbNear(filled[i], filled[i + 3], 14));
  t.check('on a gradient the fill matches the surroundings at the same height', close, filled.map(fmt).join(' '));
  await page.evaluate(() => window.__prysm.selection.getState().set({ marqueeShape: 'rect' }));
  await page.keyboard.press('Control+a');
  await panel.getByRole('button', { name: 'Content-aware fill', exact: true }).click();
  await page.waitForFunction(() => /nothing left/.test(window.__prysm.ui.getState().toast?.text ?? ''), null, { timeout: 30000 });
  t.check('selecting everything is refused with an explanation', (await h.layers()).length === count + 1, await toast());
  await idle();
  await page.keyboard.press('Control+d');
  await page.keyboard.press('v');
  await removeAll();
});

let wall;

await section('Expand: fill the canvas in one click', async () => {
  wall = await upload('small-wall.png', STRIPES, [300, 216]);
  await h.patch(wall.id, { x: 250, y: 192 });
  await h.settle(200);
  await h.selectRow(wall.id);
  // On canvas the image covers 250..550 x 192..408; light rows: (y - 192) mod 24 < 12.
  const inside = [[300, 200], [300, 212], [500, 400], [400, 300]];
  const reference = await alphaAt(inside);
  const history = await state(page);
  const expand = await openSection('Expand');
  await expand.getByRole('button', { name: 'Fill the canvas', exact: true }).click();
  await page.waitForFunction((src) => JSON.stringify(window.__prysm.editor.getState().doc.layers[0].source) !== src, JSON.stringify(wall.source), { timeout: 120000 });
  await idle();
  await h.settle(400);
  const after = await state(page);
  const grown = after.doc.layers[0];
  const run = await lastRun();
  console.log(`      info: expanding to ${run.width} x ${run.height} px took ${Math.round(run.milliseconds)} ms`);
  t.check('the layer now covers the canvas exactly', grown.x === 0 && grown.y === 0 && grown.width === 800 && grown.height === 600, `${grown.x},${grown.y} ${grown.width}x${grown.height}`);
  t.check('it is one undo step and stays one layer', after.past === history.past + 1 && after.doc.layers.length === 1);
  const stored = await assetOf(grown.id);
  t.check('the layer has a new, larger picture at the same pixel density', stored.kind === 'asset' && stored.width === 800 && stored.height === 600 && grown.source.assetId !== wall.source.assetId, `${stored.width}x${stored.height}`);
  const uploads = await page.evaluate((id) => window.__prysm.assets.getState().assets.some((a) => a.id === id), wall.source.assetId);
  t.check('the original image is still in Uploads', uploads);
  const same = await alphaAt(inside);
  t.check('the original part of the picture is pixel-identical and has not moved', same.every((p, i) => rgbNear(p, reference[i], 1) && p[3] === 255), same.map(fmt).join(' '));

  // Left and right of the image, the same rows must carry on. Above and below, the stripe rhythm must carry on.
  const sides = [];
  for (let y = 198; y < 400; y += 12) for (const x of [40, 140, 660, 760]) sides.push([x, y]);
  const sidePx = await alphaAt(sides);
  let ok = 0;
  sides.forEach(([, y], i) => {
    const light = (y - 192) % 24 < 12;
    if (light ? isLight(sidePx[i]) : isDark(sidePx[i])) ok++;
  });
  t.check('stripes continue to the left and right edges of the canvas', ok / sides.length > 0.92, `${ok} of ${sides.length}`);
  const above = [];
  for (let y = 6; y < 190; y += 12) for (const x of [300, 400, 500]) above.push([x, y]);
  for (let y = 414; y < 596; y += 12) for (const x of [300, 400, 500]) above.push([x, y]);
  const abovePx = await alphaAt(above);
  ok = 0;
  above.forEach(([, y], i) => {
    const light = ((((y - 192) % 24) + 24) % 24) < 12;
    if (light ? isLight(abovePx[i]) : isDark(abovePx[i])) ok++;
  });
  t.check('and above and below, in the same rhythm', ok / above.length > 0.85, `${ok} of ${above.length}`);
  const corners = await alphaAt([[2, 2], [797, 2], [2, 597], [797, 597]]);
  t.check('every corner of the canvas is filled', corners.every((p) => p[3] === 255 && (isLight(p, 60) || isDark(p, 60))), corners.map(fmt).join(' '));
  t.check('once it covers the canvas, the one-click button says so', (await expand.getByRole('button', { name: 'Fill the canvas', exact: true }).isDisabled()) && /already covers/.test(await expand.innerText()));

  await page.keyboard.press('Control+z');
  await h.settle(300);
  const back = (await h.layers())[0];
  t.check('undo restores the original picture, size and position', JSON.stringify(back.source) === JSON.stringify(wall.source) && back.x === 250 && back.y === 192 && back.width === 300 && back.height === 216);
});

await section('Expand: chosen sides, rotation, crop and mask', async () => {
  const expand = await openSection('Expand');
  t.check('Expand waits for an amount', await expand.getByRole('button', { name: 'Expand sides', exact: true }).isDisabled());
  await h.setField('Expand right', 120, expand);
  await expand.getByRole('button', { name: 'Expand sides', exact: true }).click();
  await page.waitForFunction((src) => JSON.stringify(window.__prysm.editor.getState().doc.layers[0].source) !== src, JSON.stringify(wall.source), { timeout: 120000 });
  await idle();
  await h.settle(300);
  let l = (await h.layers())[0];
  t.check('expanding one side grows the box on that side only', l.x === 250 && l.y === 192 && l.width === 420 && l.height === 216, `${l.x},${l.y} ${l.width}x${l.height}`);
  let px = await alphaAt([[600, 198], [600, 210], [660, 198], [660, 210], [680, 300]]);
  t.check('the new strip continues the rows', isLight(px[0]) && isDark(px[1]) && isLight(px[2]) && isDark(px[3]) && px[4][3] === 0, px.map(fmt).join(' '));
  t.check('the amounts are cleared afterwards', (await expand.getByLabel('Expand right', { exact: true }).inputValue()) === '0');
  await page.keyboard.press('Control+z');
  await h.settle(200);

  // Rotated a quarter turn: the image's own "right" points down the canvas, and what was there must not move.
  await h.patch(wall.id, { rotation: 90 });
  await h.settle(200);
  const fixed = [[400, 300], [400, 200], [330, 400]];
  const reference = await alphaAt(fixed);
  await h.setField('Expand right', 60, expand);
  await expand.getByRole('button', { name: 'Expand sides', exact: true }).click();
  await page.waitForFunction((src) => JSON.stringify(window.__prysm.editor.getState().doc.layers[0].source) !== src, JSON.stringify(wall.source), { timeout: 120000 });
  await idle();
  await h.settle(300);
  l = (await h.layers())[0];
  px = await alphaAt([...fixed, [400, 480], [400, 520]]);
  t.check('on a rotated layer the existing picture stays in place', fixed.every((_, i) => rgbNear(px[i], reference[i], 2)) && l.width === 360 && l.rotation === 90, `${l.x},${l.y} ${l.width}x${l.height} | ${px.map(fmt).join(' ')}`);
  t.check('and the new area appears on the side the image’s edge faces', px[3][3] === 255 && px[4][3] === 0, `${fmt(px[3])} ${fmt(px[4])}`);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await h.settle(200);

  // Cropped and masked: expansion works on what is showing, and the mask keeps its place.
  await page.evaluate((id) => window.__prysm.editor.getState().setCrop(id, { left: 0.25, top: 0, right: 0, bottom: 0 }), wall.id);
  await h.settle(200);
  let c = (await h.layers())[0];
  await page.keyboard.press('m');
  await dragDoc([c.x + c.width - 60, c.y], [c.x + c.width + 5, c.y + 60]);
  await panel.getByRole('button', { name: 'Hide area', exact: true }).click();
  await h.settle(300);
  await page.keyboard.press('Control+d');
  await page.keyboard.press('v');
  await h.selectRow(wall.id);
  c = (await h.layers())[0];
  const hidden = [c.x + c.width - 30, c.y + 30];
  const shown = [c.x + 30, c.y + 30];
  const before = await alphaAt([hidden, shown]);
  const expandAgain = await openSection('Expand');
  await h.setField('Expand left', 80, expandAgain);
  await expandAgain.getByRole('button', { name: 'Expand sides', exact: true }).click();
  await page.waitForFunction((src) => JSON.stringify(window.__prysm.editor.getState().doc.layers[0].source) !== src, JSON.stringify(c.source), { timeout: 120000 });
  await idle();
  await h.settle(300);
  l = (await h.layers())[0];
  px = await alphaAt([hidden, shown, [c.x - 40, c.y + 30], [c.x - 40, c.y + 30 + 12], [c.x - 90, c.y + 30]]);
  t.check('a cropped, masked layer expands from what is showing', near(l.width, c.width + 80, 0.01) && near(l.x, c.x - 80, 0.01) && Object.values(l.crop).every((v) => v === 0) && l.masks.length === 1, `${l.x},${l.y} ${l.width}x${l.height}`);
  t.check('the masked part stays hidden and the shown part stays put', before[0][3] === 0 && px[0][3] === 0 && rgbNear(px[1], before[1], 2), `${fmt(px[0])} ${fmt(px[1])}`);
  t.check('the new border is revealed and continues the rows', px[2][3] === 255 && px[3][3] === 255 && isLight(px[2]) !== isLight(px[3]) && px[4][3] === 0, `${fmt(px[2])} ${fmt(px[3])} ${fmt(px[4])}`);
  await removeAll();

  // A paint layer stays a paint layer.
  await page.keyboard.press('b');
  await h.stroke([[300, 300], [500, 300]]);
  await page.keyboard.press('v');
  const paint = (await h.layers())[0];
  await h.selectRow(paint.id);
  const paintExpand = await openSection('Expand');
  await h.setField('Expand bottom', 40, paintExpand);
  await paintExpand.getByRole('button', { name: 'Expand sides', exact: true }).click();
  await page.waitForFunction((id) => window.__prysm.editor.getState().doc.layers[0].source.rasterId !== id, paint.source.rasterId, { timeout: 120000 });
  await idle();
  l = (await h.layers())[0];
  t.check('a paint layer can be expanded and is still a paint layer', l.source.kind === 'raster' && l.height === paint.height + 40);
  await removeAll();
});

let photo;

await section('Upscale', async () => {
  // A small "photo": gradient, a disc and fine lines, 160 x 120 (two tiles wide).
  const PHOTO = `const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#204080'); g.addColorStop(1, '#f0d090'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#c02020'; ctx.beginPath(); ctx.arc(w * 0.3, h * 0.5, h * 0.25, 0, 7); ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(w * 0.55 + i * 9, h * 0.15); ctx.lineTo(w * 0.6 + i * 9, h * 0.85); ctx.stroke(); }`;
  photo = await upload('photo.png', PHOTO, [160, 120]);
  await h.selectRow(photo.id);
  const box = await h.layerById(photo.id);
  const upscale = await openSection('Upscale');
  await page.waitForFunction(() => /Now 160 × 120 px/.test(document.querySelector('[data-testid="upscale-size"]')?.textContent ?? ''));
  const two = upscale.getByRole('button', { name: /^2× to 320 × 240 px/ });
  const four = upscale.getByRole('button', { name: /^4× to 640 × 480 px/ });
  t.check('both sizes are offered with a time estimate', (await two.isEnabled()) && (await four.isEnabled()) && /about \d+ (s|min)/.test(await four.innerText()), (await four.innerText()).replace(/\s+/g, ' '));
  t.check('the model and its licence are named', /Real-ESRGAN/.test(await upscale.innerText()) && /BSD-3-Clause/.test(await upscale.innerText()));
  const samples = [[0.3, 0.5], [0.05, 0.05], [0.95, 0.95], [0.5, 0.5]];
  const original = await assetOf(photo.id, samples);
  const history = await state(page);

  await four.click();
  await page.waitForFunction((id) => window.__prysm.editor.getState().doc.layers[0].source.assetId !== id, photo.source.assetId, { timeout: 240000 });
  await idle();
  await h.settle(300);
  const run = await lastRun();
  console.log(`      info: upscaling 160 x 120 to ${run.width} x ${run.height} took ${(run.milliseconds / 1000).toFixed(1)} s`);
  const big = await assetOf(photo.id, samples);
  const after = await state(page);
  const l = after.doc.layers[0];
  t.check('the layer gets a picture four times the size', big.width === 640 && big.height === 480 && run.kind === 'upscale', `${big.width}x${big.height}`);
  t.check('its place, size and everything else on the canvas are unchanged', l.x === box.x && l.y === box.y && l.width === box.width && l.height === box.height && after.past === history.past + 1, `${l.x},${l.y} ${l.width}x${l.height} vs ${box.x},${box.y} ${box.width}x${box.height}; history ${history.past} -> ${after.past}`);
  t.check('the picture is the same picture', samples.every((_, i) => rgbNear(big.pixels[i], original.pixels[i], 14)), `${big.pixels.map(fmt).join(' ')} vs ${original.pixels.map(fmt).join(' ')}`);

  // Sharper than plain enlargement, and no seam where the two tiles meet (source x = 128, output x = 512).
  const measure = await page.evaluate(
    async ({ bigId, smallId }) => {
      const load = async (id) => {
        const meta = window.__prysm.assets.getState().assets.find((a) => a.id === id);
        const img = new Image();
        img.src = meta.url;
        await img.decode();
        return img;
      };
      const read = (img, w, h) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const big = read(await load(bigId), 640, 480);
      const plain = read(await load(smallId), 640, 480);
      const lum = (d, x, y) => d[(y * 640 + x) * 4] * 0.299 + d[(y * 640 + x) * 4 + 1] * 0.587 + d[(y * 640 + x) * 4 + 2] * 0.114;
      // Edge strength across the disc's rim: the steepest step between neighbouring pixels along a row.
      const steepest = (d) => {
        let best = 0;
        for (let x = 60; x < 140; x++) best = Math.max(best, Math.abs(lum(d, x + 1, 240) - lum(d, x, 240)));
        return best;
      };
      // Column-to-column change in a plain part of the picture (rows 400..470), at the tile joint and next to it.
      const step = (x) => {
        let sum = 0;
        for (let y = 400; y < 470; y++) sum += Math.abs(lum(big, x, y) - lum(big, x - 1, y));
        return sum / 70;
      };
      let difference = 0;
      for (let i = 0; i < big.length; i += 4) difference += Math.abs(big[i] - plain[i]) + Math.abs(big[i + 1] - plain[i + 1]) + Math.abs(big[i + 2] - plain[i + 2]);
      return { sharp: steepest(big), soft: steepest(plain), joint: step(512), beside: (step(500) + step(524)) / 2, mean: difference / (big.length / 4) / 3 };
    },
    { bigId: big.id, smallId: original.id },
  );
  t.check('edges are sharper than plain enlargement', measure.sharp > measure.soft * 1.3, `steepest step ${measure.sharp.toFixed(1)} vs ${measure.soft.toFixed(1)}`);
  t.check('it stays faithful to the original overall', measure.mean < 8, `mean difference ${measure.mean.toFixed(2)} of 255`);
  t.check('no seam where tiles meet', measure.joint < measure.beside + 1.5, `change at the joint ${measure.joint.toFixed(2)}, beside it ${measure.beside.toFixed(2)}`);

  await page.keyboard.press('Control+z');
  await h.settle(200);
  t.check('undo gives the layer its original picture back', (await h.layers())[0].source.assetId === photo.source.assetId, `${(await h.layers())[0].source.assetId} vs ${photo.source.assetId}; history ${(await state(page)).past}`);
  await page.keyboard.press('Control+y');
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1200);
  const reopened = await assetOf((await h.layers())[0].id);
  t.check('the upscaled picture is saved with the project', reopened.width === 640 && reopened.height === 480);
  await page.keyboard.press('Control+z');

  // 2x, with transparency.
  await removeAll();
  const cut = await upload('cutout.png', `ctx.fillStyle = '#20a040'; ctx.beginPath(); ctx.arc(w / 2, h / 2, h * 0.4, 0, 7); ctx.fill();`, [96, 96]);
  await h.selectRow(cut.id);
  const again = await openSection('Upscale');
  await again.getByRole('button', { name: /^2× to 192 × 192 px/ }).click();
  await page.waitForFunction((id) => window.__prysm.editor.getState().doc.layers[0].source.assetId !== id, cut.source.assetId, { timeout: 240000 });
  await idle();
  const twice = await assetOf(cut.id, [[0.5, 0.5], [0.03, 0.03], [0.97, 0.5]]);
  t.check('2× gives twice the size and keeps transparency', twice.width === 192 && twice.height === 192 && twice.pixels[0][3] === 255 && rgbNear(twice.pixels[0], [32, 160, 64], 16) && twice.pixels[1][3] === 0 && twice.pixels[2][3] === 0, twice.pixels.map(fmt).join(' '));
  await removeAll();

  // Too large to gain anything; and layers that are not photos.
  const wide = await upload('wide.png', `ctx.fillStyle = '#888'; ctx.fillRect(0, 0, w, h);`, [2100, 40]);
  await h.selectRow(wide.id);
  const large = await openSection('Upscale');
  t.check('an image that is already large is not offered an upscale, with the reason', (await large.getByRole('button', { name: /^[24]× to/ }).count()) === 0 && /nothing to gain/.test(await large.innerText()));
  await removeAll();
});

await section('Upscale: cancelling', async () => {
  const slow = await upload('slow.png', `const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#333'); g.addColorStop(1, '#ccc'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);`, [640, 512]);
  await h.selectRow(slow.id);
  const upscale = await openSection('Upscale');
  await upscale.getByRole('button', { name: /^4× to/ }).click();
  await page.waitForFunction(() => /Upscaling… \d+%/.test(window.__prysm.local.getState().job?.message ?? ''), null, { timeout: 60000 });
  t.check('progress and the time left are shown while it runs', /about \d+ (s|min) left/.test(await page.locator('[data-testid="local-job"]').innerText()), (await page.locator('[data-testid="local-job"]').innerText()).replace(/\s+/g, ' '));
  // The editor stays usable meanwhile: the layer can still be nudged.
  await upscale.getByRole('button', { name: 'Cancel', exact: true }).click();
  await idle(15000);
  const l = (await h.layers())[0];
  t.check('Cancel stops it and leaves the layer as it was', l.source.assetId === slow.source.assetId && /cancelled/i.test(await toast()), await toast());
  await removeAll();
  // The engine starts again cleanly after a cancel.
  const tiny = await upload('tiny.png', `ctx.fillStyle = '#4060c0'; ctx.fillRect(0, 0, w, h);`, [48, 48]);
  await h.selectRow(tiny.id);
  const again = await openSection('Upscale');
  await again.getByRole('button', { name: /^4× to 192 × 192 px/ }).click();
  await page.waitForFunction((id) => window.__prysm.editor.getState().doc.layers[0].source.assetId !== id, tiny.source.assetId, { timeout: 120000 });
  await idle();
  t.check('a later upscale works after a cancel', (await assetOf(tiny.id)).width === 192);
  await removeAll();
});

await section('Polygonal lasso', async () => {
  await page.keyboard.press('l');
  await options.getByRole('button', { name: 'Polygon', exact: true }).click();
  const overlay = page.locator('[data-testid="selection-overlay"]');
  const corners = () => overlay.getAttribute('data-polygon-points');
  for (const p of [[200, 100], [600, 100], [600, 500]]) await clickDoc(p);
  t.check('each click places a corner; nothing is selected yet', (await corners()) === '3' && !(await sel()).active);
  await clickDoc([200, 500], { clickCount: 2 });
  let s = await sel([[400, 300], [100, 300], [300, 110]]);
  t.check('a double-click places the last corner and closes the shape', (await corners()) === '0' && near(s.coverage, (400 * 400) / 480000, 0.004) && s.at[0] === 1 && s.at[1] === 0 && s.at[2] === 1, describe(s));

  for (const p of [[100, 100], [300, 100], [100, 300]]) await clickDoc(p);
  await page.keyboard.press('Enter');
  s = await sel([[150, 150], [280, 280]]);
  t.check('Enter closes the shape; a new shape replaces the selection', near(s.coverage, (0.5 * 200 * 200) / 480000, 0.003) && s.at[0] === 1 && s.at[1] === 0, describe(s));

  for (const p of [[500, 300], [700, 300], [700, 500], [500, 500]]) await clickDoc(p);
  await clickDoc([503, 302]);
  s = await sel([[600, 400], [150, 150]]);
  t.check('clicking the first corner closes the shape', near(s.coverage, (200 * 200) / 480000, 0.003) && s.at[0] === 1 && s.at[1] === 0, describe(s));

  for (const p of [[100, 400], [300, 400], [300, 550], [50, 50]]) await clickDoc(p);
  await page.keyboard.press('Backspace');
  t.check('Backspace removes the last corner', (await corners()) === '3');
  await page.keyboard.press('Enter');
  s = await sel([[250, 450], [60, 60], [600, 400]]);
  t.check('the removed corner is not part of the shape', near(s.coverage, (0.5 * 200 * 150) / 480000, 0.003) && s.at[0] === 1 && s.at[1] === 0, describe(s));

  for (const p of [[400, 100], [500, 100], [500, 200]]) await clickDoc(p);
  await page.keyboard.press('Escape');
  const kept = await sel([[250, 450]]);
  t.check('Escape abandons the shape and keeps the selection and the tool', (await corners()) === '0' && kept.at[0] === 1 && (await page.evaluate(() => window.__prysm.ui.getState().tool)) === 'lasso');

  await page.keyboard.down('Shift');
  await clickDoc([600, 50]);
  await page.keyboard.up('Shift');
  for (const p of [[700, 50], [700, 150]]) await clickDoc(p);
  await page.keyboard.press('Enter');
  s = await sel([[250, 450], [680, 80]]);
  t.check('Shift on the first corner adds the shape to the selection', s.at[0] === 1 && s.at[1] === 1, describe(s));

  for (const p of [[400, 100], [500, 100]]) await clickDoc(p);
  await page.keyboard.press('m');
  await page.keyboard.press('l');
  t.check('switching tools abandons a shape in progress', (await corners()) === '0');
  await options.getByRole('button', { name: 'Freehand', exact: true }).click();
  await page.keyboard.press('Control+d');
});

await section('Saved selections', async () => {
  await page.keyboard.press('m');
  t.check('nothing to save while nothing is selected', (await panel.getByRole('button', { name: 'Save selection', exact: true }).count()) === 0);
  await dragDoc([100, 100], [300, 250]);
  const history = await state(page);
  await panel.getByRole('button', { name: 'Save selection', exact: true }).click();
  let doc = (await state(page)).doc;
  t.check('saving stores the selection in the project, as one undo step', doc.selections.length === 1 && doc.selections[0].name === 'Selection 1' && (await state(page)).past === history.past + 1 && doc.schemaVersion === 6);
  await dragDoc([500, 300], [700, 500]);
  await panel.getByRole('button', { name: 'Save selection', exact: true }).click();
  doc = (await state(page)).doc;
  t.check('a second one gets its own name', doc.selections.length === 2 && doc.selections[1].name === 'Selection 2');
  const rows = panel.locator('[data-saved-selection]');
  await page.keyboard.press('Control+d');
  await rows.nth(0).getByRole('button', { name: 'Load', exact: true }).click();
  await h.settle(200);
  let s = await sel([[200, 175], [600, 400]]);
  t.check('loading brings the saved area back exactly', near(s.coverage, (200 * 150) / 480000, 0.001) && s.bounds.x === 100 && s.bounds.y === 100 && s.at[0] === 1 && s.at[1] === 0, describe(s));
  await options.getByRole('button', { name: 'Add', exact: true }).click();
  await rows.nth(1).getByRole('button', { name: 'Load', exact: true }).click();
  await h.settle(200);
  s = await sel([[200, 175], [600, 400]]);
  t.check('with the Add mode, loading adds to the current selection', near(s.coverage, (200 * 150 + 200 * 200) / 480000, 0.001) && s.at[0] === 1 && s.at[1] === 1, describe(s));
  await options.getByRole('button', { name: 'New', exact: true }).click();

  const name = rows.nth(0).getByLabel('Saved selection name');
  await name.fill('Sky');
  await name.press('Enter');
  t.check('a saved selection can be renamed', (await state(page)).doc.selections[0].name === 'Sky');

  await page.keyboard.press('Control+d');
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1000);
  await page.keyboard.press('m');
  doc = (await state(page)).doc;
  t.check('saved selections are stored with the project', doc.selections.length === 2 && doc.selections[0].name === 'Sky' && !(await sel()).active);
  await panel.locator('[data-saved-selection]').nth(1).getByRole('button', { name: 'Load', exact: true }).click();
  await page.waitForFunction(() => !!window.__prysm.selection.getState().mask);
  s = await sel([[600, 400], [200, 175]]);
  t.check('and load after reopening', near(s.coverage, (200 * 200) / 480000, 0.001) && s.at[0] === 1 && s.at[1] === 0, describe(s));

  // After the canvas is resized, a saved selection is fitted to the new canvas.
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 1600);
  await page.keyboard.press('m');
  await panel.locator('[data-saved-selection]').nth(0).getByRole('button', { name: 'Load', exact: true }).click();
  await page.waitForFunction(() => !!window.__prysm.selection.getState().mask);
  s = await sel();
  t.check('on a resized canvas it is stretched to fit', near(s.bounds.x, 200, 2) && near(s.bounds.width, 400, 3) && near(s.bounds.height, 150, 2), describe(s));
  await page.keyboard.press('Control+d');
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await page.keyboard.press('m');

  const before = await state(page);
  await panel.locator('[data-saved-selection]').nth(0).getByRole('button', { name: /^Delete saved selection/ }).click();
  t.check('deleting removes it', (await state(page)).doc.selections.length === 1 && (await state(page)).doc.selections[0].name === 'Selection 2');
  await page.keyboard.press('Control+z');
  t.check('and undo brings it back', (await state(page)).doc.selections.length === 2 && (await state(page)).past === before.past);
});

await section('Older projects', async () => {
  await waitForSaved(page);
  const id = (await state(page)).doc.id;
  // Rewrite the stored project as the previous version saved it: schema 4, no saved selections.
  await page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('prysm');
        open.onsuccess = () => {
          const tx = open.result.transaction('projects', 'readwrite');
          const store = tx.objectStore('projects');
          const get = store.get(id);
          get.onsuccess = () => {
            const rec = get.result;
            const { selections, ...rest } = rec.doc;
            rec.doc = { ...rest, schemaVersion: 4 };
            store.put(rec);
          };
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    id,
  );
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1000);
  const doc = (await state(page)).doc;
  t.check('a project saved before this version opens and is upgraded', doc.id === id && doc.schemaVersion === 6 && Array.isArray(doc.selections) && doc.selections.length === 0, `schema ${doc.schemaVersion}`);
  await page.keyboard.press('m');
  await dragDoc([100, 100], [300, 250]);
  await panel.getByRole('button', { name: 'Save selection', exact: true }).click();
  t.check('and can save selections from then on', (await state(page)).doc.selections.length === 1);
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
