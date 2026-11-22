/**
 * Interaction details beyond the main Milestone 1 flow: multi-selection drags, snapping,
 * text resize handles, transforms through groups, full-resolution export and responsiveness.
 */
import { readFileSync } from 'node:fs';
import { launch, makeReporter, near, openEditor, state, toScreen, view } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });

const layers = async () => (await state(page)).doc.layers;
const layerById = async (id) => (await layers()).find((l) => l.id === id);
const settle = (ms = 120) => page.waitForTimeout(ms);
const selectRow = (id, modifiers = []) => page.locator(`[data-layer-id="${id}"]`).click({ modifiers });
const patch = (id, p) => page.evaluate(([id, p]) => window.__prysm.editor.getState().updateLayers([id], p), [id, p]);

async function setField(label, value) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.press('Enter');
}

async function drag(from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
  await settle();
}

async function section(name, fn) {
  console.log(`\n# ${name}`);
  try {
    await fn();
  } catch (err) {
    t.check(`${name}: completed without throwing`, false, String(err.message).split('\n')[0]);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

/** World-space corners of a layer, following the same centre-pivot convention as the editor. */
function corners(l, parent = null) {
  const r = (l.rotation * Math.PI) / 180;
  const cx = l.x + l.width / 2;
  const cy = l.y + l.height / 2;
  let pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const px = (sx * l.width * l.scaleX) / 2;
    const py = (sy * l.height * l.scaleY) / 2;
    return [cx + px * Math.cos(r) - py * Math.sin(r), cy + px * Math.sin(r) + py * Math.cos(r)];
  });
  if (parent) {
    const pr = (parent.rotation * Math.PI) / 180;
    const pcx = parent.x + parent.width / 2;
    const pcy = parent.y + parent.height / 2;
    pts = pts.map(([x, y]) => {
      const lx = (x - parent.width / 2) * parent.scaleX;
      const ly = (y - parent.height / 2) * parent.scaleY;
      return [pcx + lx * Math.cos(pr) - ly * Math.sin(pr), pcy + lx * Math.sin(pr) + ly * Math.cos(pr)];
    });
  }
  return pts;
}
const sameCorners = (a, b, tol = 0.6) => {
  // Order-independent: every corner of a has a matching corner in b.
  return a.every(([x, y]) => b.some(([u, v]) => near(x, u, tol) && near(y, v, tol)));
};

let rect;
let circle;

await section('Setup', async () => {
  await page.getByTitle('Rectangle', { exact: true }).click();
  await page.getByTitle('Circle', { exact: true }).click();
  [rect, circle] = await layers();
  await patch(rect.id, { x: 100, y: 120, width: 200, height: 140 });
  await patch(circle.id, { x: 600, y: 500, width: 180, height: 180 });
  rect = await layerById(rect.id);
  circle = await layerById(circle.id);
  t.check('two shapes placed', rect.x === 100 && circle.x === 600);
});

await section('Multi-selection drag', async () => {
  await selectRow(rect.id);
  await selectRow(circle.id, ['Shift']);
  const history = (await state(page)).past;
  const { zoom } = await view(page);
  const from = await toScreen(page, rect.x + 100, rect.y + 70);
  await drag(from, { x: from.x + 90, y: from.y + 60 });
  const r2 = await layerById(rect.id);
  const c2 = await layerById(circle.id);
  const dx = 90 / zoom;
  const dy = 60 / zoom;
  t.check('both selected layers move together', near(r2.x - rect.x, dx, 1.5) && near(c2.x - circle.x, dx, 1.5) && near(r2.y - rect.y, dy, 1.5) && near(c2.y - circle.y, dy, 1.5), `rect ${(r2.x - rect.x).toFixed(1)},${(r2.y - rect.y).toFixed(1)} circle ${(c2.x - circle.x).toFixed(1)},${(c2.y - circle.y).toFixed(1)}`);
  t.check('a multi-layer drag is a single undo step', (await state(page)).past === history + 1);
  await page.keyboard.press('Control+z');
  const r3 = await layerById(rect.id);
  const c3 = await layerById(circle.id);
  t.check('undo restores every moved layer', r3.x === rect.x && c3.x === circle.x && r3.y === rect.y && c3.y === circle.y);

  // Scale both through the shared transformer box.
  const box = { x: rect.x, y: rect.y, right: circle.x + circle.width, bottom: circle.y + circle.height };
  const corner = await toScreen(page, box.right, box.bottom);
  await drag(corner, { x: corner.x - 80, y: corner.y - 80 });
  const r4 = await layerById(rect.id);
  const c4 = await layerById(circle.id);
  t.check('resizing a multi-selection scales each layer', r4.width < rect.width - 5 && c4.width < circle.width - 5 && r4.scaleX === 1, `rect ${rect.width}->${r4.width.toFixed(1)} circle ${circle.width}->${c4.width.toFixed(1)}`);
  await page.keyboard.press('Control+z');
});

await section('Snapping and alignment', async () => {
  await page.keyboard.press('Escape');
  // Drag the rectangle so its centre lands a few pixels from the canvas centre: it should snap exactly.
  const { zoom } = await view(page);
  const from = await toScreen(page, rect.x + 100, rect.y + 70);
  const target = await toScreen(page, 540 + 3 / 1, 540 - 3 / 1);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((target.x - from.x) * i) / 12, from.y + ((target.y - from.y) * i) / 12);
  const guides = await page.evaluate(() => window.__prysm.ui.getState().guides.length);
  await page.mouse.up();
  await settle();
  const snapped = await layerById(rect.id);
  t.check('guides appear while dragging near the canvas centre', guides === 2, `${guides} guides`);
  t.check('dragging near the canvas centre snaps to it', near(snapped.x + 100, 540, 0.01) && near(snapped.y + 70, 540, 0.01), `centre ${snapped.x + 100},${snapped.y + 70} (zoom ${zoom.toFixed(2)})`);
  t.check('guides clear after the drag', (await page.evaluate(() => window.__prysm.ui.getState().guides.length)) === 0);

  // Snap to another layer's edge.
  const cFrom = await toScreen(page, circle.x + 90, circle.y + 90);
  const cTo = await toScreen(page, snapped.x + 200 + 90 + 4, 800);
  await drag(cFrom, cTo);
  const c2 = await layerById(circle.id);
  t.check('layers snap to the edges of other layers', near(c2.x, snapped.x + 200, 0.01), `circle.x=${c2.x} rect right=${snapped.x + 200}`);

  // Align and distribute.
  await page.getByTitle('Triangle', { exact: true }).click();
  const tri = (await layers())[2];
  await patch(tri.id, { x: 900, y: 40, width: 100, height: 100 });
  await patch(rect.id, { x: 50, y: 300 });
  await patch(circle.id, { x: 300, y: 600 });
  await selectRow(rect.id);
  await page.getByRole('button', { name: 'Align to canvas left' }).click();
  t.check('a single layer aligns to the canvas', (await layerById(rect.id)).x === 0);
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Align top edges' }).click();
  let ls = await layers();
  t.check('multiple layers align to their shared bounds', ls.every((l) => l.y === 40), ls.map((l) => l.y).join(','));
  await page.getByRole('button', { name: /Distribute horizontally/ }).click();
  ls = await layers();
  const [a, b, c] = [...ls].sort((p, q) => p.x - q.x);
  const gap1 = b.x - (a.x + a.width);
  const gap2 = c.x - (b.x + b.width);
  t.check('distribute makes the gaps equal', near(gap1, gap2, 0.01), `gaps ${gap1.toFixed(2)} / ${gap2.toFixed(2)}`);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
});

await section('Transforms through groups', async () => {
  await patch(rect.id, { x: 200, y: 200, width: 200, height: 100, rotation: 30 });
  await patch(circle.id, { x: 500, y: 300, width: 160, height: 160, rotation: 0 });
  const tri = (await layers())[2];
  await page.keyboard.press('Escape');
  await selectRow(rect.id);
  await selectRow(circle.id, ['Shift']);
  const r0 = await layerById(rect.id);
  const before = corners(r0);
  await page.keyboard.press('Control+g');
  let group = (await layers()).find((l) => l.type === 'group');
  t.check('grouping keeps a rotated child in place', sameCorners(before, corners(group.children.find((c) => c.id === rect.id), group)));

  // Rotate and scale the group, then ungroup: children must land exactly where they were drawn.
  await setField('Rotation', 40);
  await page.getByRole('button', { name: 'Lock aspect ratio' }).click();
  await setField('Width', group.width * 1.5);
  group = (await layers()).find((l) => l.type === 'group');
  t.check('group resize is stored as scale', near(group.scaleX, 1.5, 0.01) && near(group.scaleY, 1.5, 0.01) && group.rotation === 40);
  const expectedRect = corners(group.children.find((c) => c.id === rect.id), group);
  const expectedCircle = corners(group.children.find((c) => c.id === circle.id), group);
  await page.keyboard.press('Control+Shift+g');
  const r1 = await layerById(rect.id);
  const c1 = await layerById(circle.id);
  // Uniform scale keeps shapes rectangular, so the round trip is exact.
  t.check('ungrouping a rotated, scaled group preserves child geometry', sameCorners(expectedRect, corners(r1), 0.8) && sameCorners(expectedCircle, corners(c1), 0.8), `rect rot=${r1.rotation.toFixed(1)} w=${r1.width.toFixed(1)}`);
  t.check('ungrouped children carry the combined rotation', near(r1.rotation, 70, 0.1) && near(r1.width, 300, 0.5));

  // A child selected inside a group can be edited on its own.
  await selectRow(r1.id);
  await selectRow(c1.id, ['Shift']);
  await page.keyboard.press('Control+g');
  group = (await layers()).find((l) => l.type === 'group');
  await selectRow(c1.id);
  await setField('Width', 90);
  group = (await layers()).find((l) => l.type === 'group');
  t.check('a child inside a group stays individually editable', near(group.children.find((c) => c.id === c1.id).width, 90));
  await page.keyboard.press('Delete');
  group = (await layers()).find((l) => l.type === 'group');
  t.check('deleting a child keeps the group', group?.children.length === 1);
  await selectRow(group.id);
  await page.keyboard.press('Delete');
  await selectRow(tri.id);
  await page.keyboard.press('Delete');
  t.check('canvas cleared', (await layers()).length === 0);
});

await section('Text resize handles', async () => {
  await page.locator('[data-tab="text"]').click();
  await page.getByRole('button', { name: 'Add a heading' }).click();
  await settle(700);
  let text = (await layers())[0];
  const fontSize = text.fontSize;
  // Side handle: narrows the wrap width, keeps the font size, text grows taller.
  const right = await toScreen(page, text.x + text.width, text.y + text.height / 2);
  const { zoom } = await view(page);
  await drag(right, { x: right.x - (text.width * zoom) / 2, y: right.y });
  await settle(200);
  const narrow = await layerById(text.id);
  t.check('side handle changes wrap width, not font size', narrow.fontSize === fontSize && near(narrow.width, text.width / 2, 6), `w ${text.width}->${narrow.width.toFixed(1)}`);
  t.check('text reflows onto more lines', narrow.height > text.height * 1.5, `h ${text.height}->${narrow.height.toFixed(1)}`);
  t.check('reflow keeps the top-left corner in place', near(narrow.x, text.x, 1) && near(narrow.y, text.y, 1));

  // Corner handle: scales the font.
  const corner = await toScreen(page, narrow.x + narrow.width, narrow.y + narrow.height);
  await drag(corner, { x: corner.x + 80, y: corner.y + 80 });
  await settle(200);
  const big = await layerById(text.id);
  t.check('corner handle scales the font size', big.fontSize > fontSize * 1.1 && big.scaleX === 1 && big.scaleY === 1, `font ${fontSize}->${big.fontSize}`);

  // Emptying a text layer removes it.
  const c = await toScreen(page, big.x + big.width / 2, big.y + big.height / 2);
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.locator('[data-testid="text-editor"]');
  await editor.waitFor();
  await editor.fill('');
  await editor.press('Escape');
  await editor.waitFor({ state: 'detached' });
  t.check('an emptied text layer is removed', (await layers()).length === 0);
});

await section('Full-resolution export and responsiveness', async () => {
  // A 2400px image with 1px stripes: any downscaled render would turn the stripes grey.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1200;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 2400, 1200);
    ctx.fillStyle = '#000000';
    for (let x = 0; x < 2400; x += 2) ctx.fillRect(x, 0, 1, 1200);
    return c.toDataURL('image/png');
  });
  await page.locator('[data-testid="canvas-size"]').click();
  await setField('Canvas width', 2400);
  await setField('Canvas height', 1200);
  await page.locator('[data-tab="uploads"]').click();
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'stripes.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 1);
  const img = (await layers())[0];
  await patch(img.id, { x: 0, y: 0, width: 2400, height: 1200 });
  // An adjustment forces the image through the processing pipeline.
  await page.getByLabel('Contrast', { exact: true }).fill('10');

  // Responsiveness: time for a slider change to reach the screen on a large image.
  const ms = await page.evaluate(async (id) => {
    const store = window.__prysm.editor;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const samples = [];
    for (let i = 0; i < 6; i++) {
      const layer = store.getState().doc.layers[0];
      const t0 = performance.now();
      store.getState().updateLayers([id], { adjustments: { ...layer.adjustments, brightness: i * 5 } }, { coalesce: 'perf' });
      await frame();
      samples.push(performance.now() - t0);
    }
    store.getState().updateLayers([id], { adjustments: { ...store.getState().doc.layers[0].adjustments, brightness: 0 } });
    return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  }, img.id);
  t.check('adjusting a 2400px image stays interactive (median < 150 ms per update)', ms < 150, `${ms.toFixed(0)} ms`);

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.locator('[data-testid="export-dialog"]');
  await dlg.getByRole('button', { name: 'PNG', exact: true }).click();
  await dlg.getByRole('button', { name: '1×', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Export PNG' }).click()]);
  const buffer = readFileSync(await download.path());
  const out = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const row = ctx.getImageData(1000, 600, 8, 1).data;
    return { width: bmp.width, height: bmp.height, row: Array.from({ length: 8 }, (_, i) => row[i * 4]) };
  }, buffer.toString('base64'));
  const contrast = Math.min(...[0, 2, 4, 6].map((i) => Math.abs(out.row[i] - out.row[i + 1])));
  t.check('export renders images at full resolution, not the preview size', out.width === 2400 && contrast > 200, `${out.width}x${out.height}, stripe row ${out.row.join(',')}`);
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'detached' });
  const quality = await page.evaluate(() => window.__prysm.ui.getState().renderQuality);
  t.check('editor returns to preview quality after export', quality === 'preview');
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
