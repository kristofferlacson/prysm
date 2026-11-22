/**
 * Milestone 1 validation. Drives the real editor in a browser (mouse, keyboard, file input, downloads)
 * and checks both document state and exported pixels.
 *
 *   npm run dev            (in one terminal)
 *   npm run test:e2e       (in another)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blend, BLEND_MODES } from './blendMath.mjs';
import { launch, makeReporter, near, openEditor, OUTPUT_DIR, state, toScreen, view, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
let { context, page, errors } = await openEditor(browser, { fresh: true });

// ---------- helpers ----------

async function section(name, fn) {
  console.log(`\n# ${name}`);
  try {
    await fn();
  } catch (err) {
    t.check(`${name}: completed without throwing`, false, String(err.message).split('\n')[0]);
    await page.screenshot({ path: join(OUTPUT_DIR, `fail-${name.replace(/\W+/g, '-')}.png`) }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function openTab(id) {
  const tab = page.locator(`[data-tab="${id}"]`);
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
}

async function setField(label, value, scope = page) {
  const field = scope.getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.press('Enter');
}

const layers = async () => (await state(page)).doc.layers;
const layerById = async (id) => (await layers()).find((l) => l.id === id);
const selectRow = (id, modifiers = []) => page.locator(`[data-layer-id="${id}"]`).click({ modifiers });
const settle = (ms = 120) => page.waitForTimeout(ms);

async function drag(from, to, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
  await settle();
}

const centerOf = (l) => toScreen(page, l.x + l.width / 2, l.y + l.height / 2);

/** Decodes an encoded image inside the browser and samples pixels (document coordinates * scale). */
function decode(buffer, mime, points) {
  return page.evaluate(
    async ({ b64, mime, points }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return {
        width: bmp.width,
        height: bmp.height,
        pixels: points.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data)),
      };
    },
    { b64: buffer.toString('base64'), mime, points },
  );
}

/** Exports through the Export dialog exactly as a user would and returns the downloaded file. */
async function exportVia({ format = 'PNG', scale = '1×', transparent = false } = {}, points = []) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.locator('[data-testid="export-dialog"]');
  await dlg.getByRole('button', { name: format, exact: true }).click();
  await dlg.getByRole('button', { name: scale, exact: true }).click();
  if (format !== 'JPG') {
    const sw = dlg.getByRole('switch', { name: 'Transparent background' });
    if ((await sw.getAttribute('aria-checked')) !== String(transparent)) await sw.click();
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dlg.getByRole('button', { name: /^Export (PNG|JPG|WEBP)$/ }).click(),
  ]);
  const buffer = readFileSync(await download.path());
  const mime = { PNG: 'image/png', JPG: 'image/jpeg', WebP: 'image/webp' }[format];
  const decoded = await decode(buffer, mime, points);
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'detached' });
  return { buffer, name: download.suggestedFilename(), ...decoded };
}

const rgbNear = (a, b, tol = 3) => near(a[0], b[0], tol) && near(a[1], b[1], tol) && near(a[2], b[2], tol);
const fmt = (px) => `[${px.slice(0, 4).join(',')}]`;

async function makeTestImages() {
  const urls = await page.evaluate(() => {
    const a = document.createElement('canvas');
    a.width = 400;
    a.height = 300;
    let ctx = a.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 200, 300);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(200, 0, 200, 300);
    const b = document.createElement('canvas');
    b.width = b.height = 200;
    ctx = b.getContext('2d');
    ctx.fillStyle = '#00c800';
    ctx.beginPath();
    ctx.arc(100, 100, 80, 0, Math.PI * 2);
    ctx.fill();
    return [a.toDataURL('image/png'), b.toDataURL('image/png')];
  });
  return urls.map((u, i) => ({
    name: i === 0 ? 'halves.png' : 'circle.png',
    mimeType: 'image/png',
    buffer: Buffer.from(u.split(',')[1], 'base64'),
  }));
}

// ---------- tests ----------

let imgA;
let imgB;
let textId;
let rectId;

await section('Canvas: create a project with custom dimensions', async () => {
  await page.getByRole('button', { name: 'Projects' }).click();
  const dlg = page.getByRole('dialog', { name: 'Projects' });
  await dlg.getByLabel('New project name').fill('E2E design');
  await setField('New canvas width', 800, dlg);
  await setField('New canvas height', 600, dlg);
  await dlg.getByRole('button', { name: 'Create' }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  const { doc } = await state(page);
  t.check('new project has the requested size', doc.width === 800 && doc.height === 600, `${doc.width}x${doc.height}`);
  t.check('new project has the requested name', doc.name === 'E2E design');
  t.check('top bar shows canvas dimensions', (await page.locator('[data-testid="canvas-size"]').innerText()).includes('800 × 600'));
});

await section('Images: upload two files', async () => {
  await openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles(await makeTestImages());
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 2);
  const ls = await layers();
  [imgA, imgB] = ls;
  t.check('each upload became its own image layer', ls.every((l) => l.type === 'image' && l.source.kind === 'asset'));
  t.check('image A keeps its natural size', imgA.width === 400 && imgA.height === 300, `${imgA.width}x${imgA.height}`);
  t.check('layers panel lists both layers', (await page.locator('[data-testid="layer-row"]').count()) === 2);
  t.check('uploads panel lists both assets', (await page.locator('[data-testid="sidebar-panel"] img').count()) === 2);
});

await section('Canvas: move, resize and rotate with the mouse', async () => {
  // Move image B (top-most) by dragging it.
  const before = await layerById(imgB.id);
  const { zoom } = await view(page);
  const from = await centerOf(before);
  const history = (await state(page)).past;
  await drag(from, { x: from.x + 130, y: from.y - 70 });
  let after = await layerById(imgB.id);
  const tol = 8 / zoom;
  t.check('dragging moves the layer in the document', near(after.x - before.x, 130 / zoom, tol) && near(after.y - before.y, -70 / zoom, tol), `dx=${(after.x - before.x).toFixed(1)} dy=${(after.y - before.y).toFixed(1)}`);
  t.check('a drag is one undo step', (await state(page)).past === history + 1);
  t.check('dragging selects the layer', (await state(page)).selectedIds.join() === imgB.id);

  // Resize from the bottom-right handle; images keep their aspect ratio.
  const corner = await toScreen(page, after.x + after.width, after.y + after.height);
  await drag(corner, { x: corner.x + 60, y: corner.y + 60 });
  const resized = await layerById(imgB.id);
  t.check('corner handle resizes the layer', resized.width > after.width + 20, `${after.width} -> ${resized.width.toFixed(1)}`);
  t.check('image resize keeps aspect ratio', near(resized.width / resized.height, 1, 0.02));
  t.check('resize is stored as size, not scale', resized.scaleX === 1 && resized.scaleY === 1);
  t.check('resize keeps the opposite corner fixed', near(resized.x, after.x, 1.5) && near(resized.y, after.y, 1.5));

  // Rotate with the rotation handle above the top edge.
  const top = await toScreen(page, resized.x + resized.width / 2, resized.y);
  await drag({ x: top.x, y: top.y - 26 }, { x: top.x + 90, y: top.y + 10 });
  const rotated = await layerById(imgB.id);
  t.check('rotation handle rotates the layer', Math.abs(rotated.rotation) > 15, `rotation=${rotated.rotation}`);
  const c0 = { x: resized.x + resized.width / 2, y: resized.y + resized.height / 2 };
  const c1 = { x: rotated.x + rotated.width / 2, y: rotated.y + rotated.height / 2 };
  t.check('rotation pivots on the layer centre', near(c0.x, c1.x, 1.5) && near(c0.y, c1.y, 1.5));

  // Numeric input in the properties panel.
  await setField('Rotation', 0);
  await setField('X position', 40);
  await setField('Y position', 30);
  await setField('Width', 180);
  after = await layerById(imgB.id);
  t.check('properties panel edits position, size and rotation', after.rotation === 0 && after.x === 40 && after.y === 30 && near(after.width, 180) && near(after.height, 180), JSON.stringify({ x: after.x, y: after.y, w: after.width, h: after.height, r: after.rotation }));
});

await section('Text: add, edit on canvas', async () => {
  await openTab('text');
  await page.getByRole('button', { name: 'Add a heading' }).click();
  let ls = await layers();
  const text = ls[ls.length - 1];
  textId = text.id;
  t.check('text layer was added', text.type === 'text' && text.text === 'Add a heading');
  await settle(400);
  const c = await centerOf(await layerById(textId));
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.locator('[data-testid="text-editor"]');
  await editor.waitFor();
  await editor.fill('Hello Prysm');
  // Shortcuts must not fire while typing: Delete and Ctrl+A stay inside the textarea.
  await editor.press('Control+a');
  await editor.press('Delete');
  await editor.pressSequentially('Edited on canvas');
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  await page.mouse.click(host.x + 12, host.y + 12);
  await editor.waitFor({ state: 'detached' });
  ls = await layers();
  t.check('typing on the canvas updates the text layer', ls.find((l) => l.id === textId)?.text === 'Edited on canvas');
  t.check('typing did not trigger editor shortcuts', ls.length === 3);

  await selectRow(textId);
  await setField('Font size', 60);
  await page.getByRole('button', { name: 'Italic' }).click();
  await page.getByLabel('Font family').click();
  await page.getByLabel('Search fonts').fill('playfair');
  await page.getByRole('button', { name: 'Playfair Display' }).click();
  const styled = await layerById(textId);
  t.check('font family, size and style are editable', styled.fontFamily === 'Playfair Display' && styled.fontSize === 60 && styled.italic === true);
  await settle(600);
  const measured = await layerById(textId);
  t.check('text height follows its content', measured.height > 60 && measured.height < 200, `height=${measured.height}`);
});

await section('Shapes: add and style', async () => {
  await openTab('elements');
  await page.getByTitle('Rectangle', { exact: true }).click();
  const ls = await layers();
  const rect = ls[ls.length - 1];
  rectId = rect.id;
  t.check('shape layer was added and selected', rect.type === 'shape' && (await state(page)).selectedIds[0] === rect.id);
  await setField('Fill colour hex', '#f0641e');
  await page.getByLabel('Corners', { exact: true }).fill('20');
  const styled = await layerById(rectId);
  t.check('fill colour and corner radius are editable', styled.fill.color === '#f0641e' && styled.cornerRadius === 20);
  await page.getByRole('switch', { name: 'Stroke' }).click();
  t.check('stroke can be enabled', (await layerById(rectId)).stroke?.width > 0);
  await page.getByRole('switch', { name: 'Stroke' }).click();
});

await section('Selection, grouping and layer order', async () => {
  // Shift-click two layers on the canvas.
  await page.keyboard.press('Escape');
  const a = await layerById(imgB.id);
  const r = await layerById(rectId);
  const pa = await centerOf(a);
  const pr = await centerOf(r);
  await page.mouse.click(pa.x, pa.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(pr.x, pr.y);
  await page.keyboard.up('Shift');
  await settle();
  let s = await state(page);
  t.check('shift-click selects multiple layers', s.selectedIds.length === 2 && s.selectedIds.includes(imgB.id) && s.selectedIds.includes(rectId), s.selectedIds.join());

  // Marquee across the whole artboard.
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  await page.keyboard.press('Escape');
  await drag({ x: host.x + 8, y: host.y + 8 }, { x: host.x + host.width - 8, y: host.y + host.height - 8 });
  s = await state(page);
  t.check('marquee selects every layer it touches', s.selectedIds.length === s.doc.layers.length, `${s.selectedIds.length}/${s.doc.layers.length}`);

  // Group the image and the rectangle, then ungroup: positions must survive the round trip.
  await page.keyboard.press('Escape');
  await selectRow(imgB.id);
  await selectRow(rectId, ['Shift']);
  const beforeA = await layerById(imgB.id);
  const beforeR = await layerById(rectId);
  await page.keyboard.press('Control+g');
  s = await state(page);
  const group = s.doc.layers.find((l) => l.type === 'group');
  t.check('Ctrl+G groups the selection', !!group && group.children.length === 2 && s.doc.layers.length === 3);
  t.check('the group is selected', s.selectedIds.join() === group?.id);
  t.check('layers panel shows the group and its children', (await page.locator('[data-testid="layer-row"]').count()) === 5);

  // Moving the group moves its children.
  const gc = await centerOf(beforeR); // grab the group by one of its children
  await drag(gc, { x: gc.x + 50, y: gc.y + 40 });
  const moved = (await layers()).find((l) => l.type === 'group');
  t.check('dragging a group moves it as one object', moved.x !== group.x && moved.children[0].x === group.children[0].x);
  await page.keyboard.press('Control+z');

  await page.keyboard.press('Control+Shift+g');
  s = await state(page);
  const afterA = s.doc.layers.find((l) => l.id === imgB.id);
  const afterR = s.doc.layers.find((l) => l.id === rectId);
  t.check('Ctrl+Shift+G ungroups', !s.doc.layers.some((l) => l.type === 'group') && s.doc.layers.length === 4);
  t.check('ungrouping restores absolute positions', near(afterA.x, beforeA.x, 0.5) && near(afterA.y, beforeA.y, 0.5) && near(afterR.x, beforeR.x, 0.5) && near(afterR.y, beforeR.y, 0.5));

  // Stacking order.
  await selectRow(rectId);
  await page.getByRole('button', { name: 'Send to back' }).click();
  t.check('send to back moves the layer to the bottom', (await layers())[0].id === rectId);
  await page.keyboard.press('Control+]');
  t.check('Ctrl+] brings the layer forward one step', (await layers())[1].id === rectId);
  await page.getByRole('button', { name: 'Bring to front' }).click();
  let ls = await layers();
  t.check('bring to front moves the layer to the top', ls[ls.length - 1].id === rectId);

  // Drag-reorder inside the layers panel: drop the top row onto the bottom row.
  const rows = page.locator('[data-testid="layer-row"]');
  const bottomId = ls[0].id;
  await rows.first().dragTo(rows.last(), { targetPosition: { x: 40, y: 24 } });
  await settle();
  ls = await layers();
  t.check('dragging a row in the layers panel reorders layers', ls[0].id === rectId && ls[1].id === bottomId, ls.map((l) => l.name).join(' < '));
  await page.getByRole('button', { name: 'Bring to front' }).click();

  // Visibility and lock toggles.
  const row = page.locator(`[data-layer-id="${imgA.id}"]`);
  await row.getByRole('button', { name: 'Hide layer' }).click();
  t.check('visibility toggle hides the layer', (await layerById(imgA.id)).visible === false);
  await row.getByRole('button', { name: 'Show layer' }).click();
  await row.hover();
  await row.getByRole('button', { name: 'Lock layer' }).click();
  const lockedBefore = await layerById(imgA.id);
  const lp = await toScreen(page, lockedBefore.x + 20, lockedBefore.y + lockedBefore.height - 20);
  await page.keyboard.press('Escape');
  await drag(lp, { x: lp.x + 60, y: lp.y + 10 });
  const lockedAfter = await layerById(imgA.id);
  t.check('locked layers cannot be dragged', lockedAfter.locked && lockedAfter.x === lockedBefore.x && lockedAfter.y === lockedBefore.y);
  await row.getByRole('button', { name: 'Unlock layer' }).click();
});

await section('Keyboard shortcuts and undo/redo', async () => {
  await selectRow(rectId);
  const before = await layerById(rectId);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  let after = await layerById(rectId);
  t.check('arrow keys nudge by 1px, Shift by 10px', after.x === before.x + 1 && after.y === before.y + 10);

  await page.keyboard.press('Control+z');
  after = await layerById(rectId);
  t.check('Ctrl+Z undoes', after.x === before.x && after.y === before.y);
  await page.keyboard.press('Control+Shift+z');
  after = await layerById(rectId);
  t.check('Ctrl+Shift+Z redoes', after.x === before.x + 1 && after.y === before.y + 10);

  let count = (await layers()).length;
  await page.keyboard.press('Control+d');
  t.check('Ctrl+D duplicates', (await layers()).length === count + 1);
  await page.keyboard.press('Delete');
  t.check('Delete removes the selection', (await layers()).length === count);

  await selectRow(rectId);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await settle();
  const pasted = await layers();
  t.check('Ctrl+C / Ctrl+V pastes a copy', pasted.length === count + 1 && pasted[pasted.length - 1].id !== rectId && pasted[pasted.length - 1].type === 'shape');
  await page.keyboard.press('Delete');

  await page.keyboard.press('Control+a');
  count = (await layers()).length;
  t.check('Ctrl+A selects all layers', (await state(page)).selectedIds.length === count);

  // Shortcuts are ignored while a text field has focus.
  const name = page.getByLabel('Project name');
  await name.click();
  await name.press('Control+a');
  await name.press('Delete');
  await name.pressSequentially('Renamed design');
  await name.press('Enter');
  const s = await state(page);
  t.check('shortcuts do not fire inside text inputs', s.doc.layers.length === count);
  t.check('project can be renamed from the top bar', s.doc.name === 'Renamed design');
  await page.keyboard.press('Escape');
});

await section('Blend modes composite against the layers below', async () => {
  // Known colours: backdrop #60a0c8, source rectangle #f0641e covering the middle of the canvas.
  const SRC = [240, 100, 30];
  const DST = [96, 160, 200];
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="canvas-size"]').click();
  await setField('Fill colour hex', '#60a0c8');
  t.check('canvas background colour is editable', (await state(page)).doc.background.color === '#60a0c8');

  // Park the text where it cannot overlap the probe points.
  await selectRow(textId);
  await setField('X position', 20);
  await setField('Y position', 470);
  await selectRow(rectId);
  await page.getByLabel('Corners', { exact: true }).fill('0');
  const unlock = page.getByRole('button', { name: 'Unlock aspect ratio' });
  if (await unlock.count()) await unlock.click();
  await setField('X position', 500);
  await setField('Y position', 300);
  await setField('Width', 280);
  await setField('Height', 280);
  const probe = [640, 560]; // inside the rectangle, over bare background

  const failures = [];
  for (const mode of BLEND_MODES) {
    await page.getByLabel('Blend mode', { exact: true }).selectOption(mode);
    const out = await exportVia({}, [probe]);
    const expected = blend(mode, SRC, DST);
    if (!rgbNear(out.pixels[0], expected)) failures.push(`${mode}: got ${fmt(out.pixels[0])} expected [${expected}]`);
  }
  t.check(`all ${BLEND_MODES.length} blend modes match the reference formulas`, failures.length === 0, failures.join(' | '));

  // Blend mode combined with opacity.
  await page.getByLabel('Blend mode', { exact: true }).selectOption('multiply');
  await page.getByLabel('Opacity', { exact: true }).first().fill('50');
  let out = await exportVia({}, [probe]);
  let expected = blend('multiply', SRC, DST, 0.5);
  t.check('blend mode respects layer opacity', rgbNear(out.pixels[0], expected), `got ${fmt(out.pixels[0])} expected [${expected}]`);
  await page.getByLabel('Opacity', { exact: true }).first().fill('100');

  // Blend against another image rather than the background: move the rectangle over image A's red half.
  const a = await layerById(imgA.id);
  await setField('X position', a.x + 20);
  await setField('Y position', a.y + 150);
  await setField('Width', 120);
  await setField('Height', 120);
  const overRed = [a.x + 60, a.y + 200];
  out = await exportVia({}, [overRed]);
  expected = blend('multiply', SRC, [255, 0, 0]);
  t.check('blending uses the image underneath, not just the background', rgbNear(out.pixels[0], expected), `got ${fmt(out.pixels[0])} expected [${expected}]`);

  // Blend against a transparent canvas: nothing underneath means the source shows unchanged.
  out = await exportVia({ transparent: true }, [[790, 590]]);
  t.check('transparent export has empty pixels where nothing is drawn', out.pixels[0][3] === 0, fmt(out.pixels[0]));
  await page.getByLabel('Blend mode', { exact: true }).selectOption('normal');
});

await section('Image adjustments, effects and opacity', async () => {
  await selectRow(imgA.id);
  const a = await layerById(imgA.id);
  const red = [a.x + 100, a.y + 40];
  const blue = [a.x + 300, a.y + 40];
  const base = await exportVia({}, [red, blue]);
  t.check('unedited image exports its true colours', rgbNear(base.pixels[0], [255, 0, 0]) && rgbNear(base.pixels[1], [0, 0, 255]), `${fmt(base.pixels[0])} ${fmt(base.pixels[1])}`);

  await page.getByLabel('Brightness', { exact: true }).fill('40');
  await page.getByLabel('Saturation', { exact: true }).fill('-100');
  let l = await layerById(imgA.id);
  t.check('adjustment sliders update the layer', l.adjustments.brightness === 40 && l.adjustments.saturation === -100);
  let out = await exportVia({}, [red]);
  const [r, g, b] = out.pixels[0];
  t.check('saturation -100 produces a neutral grey', near(r, g, 3) && near(g, b, 3), fmt(out.pixels[0]));
  t.check('brightness +40 lifts the result', r > 54 + 30, fmt(out.pixels[0]));

  await page.getByRole('button', { name: 'Reset brightness' }).click();
  t.check('a single adjustment can be reset', (await layerById(imgA.id)).adjustments.brightness === 0);
  await page.getByRole('button', { name: 'Reset all' }).click();
  out = await exportVia({}, [red]);
  t.check('reset all restores the original pixels', rgbNear(out.pixels[0], [255, 0, 0]), fmt(out.pixels[0]));

  // Contrast and hue.
  await page.getByLabel('Hue', { exact: true }).fill('120');
  out = await exportVia({}, [red]);
  t.check('hue rotation changes the colour', out.pixels[0][1] > out.pixels[0][0], fmt(out.pixels[0]));
  await page.getByRole('button', { name: 'Reset all' }).click();

  // One-click effect from the Effects panel.
  await openTab('effects');
  await page.locator('[data-effect="noir"]').click();
  l = await layerById(imgA.id);
  t.check('effect is recorded on the layer', l.effects.length === 1 && l.effects[0].type === 'noir');
  out = await exportVia({}, [red]);
  t.check('noir effect renders monochrome', near(out.pixels[0][0], out.pixels[0][1], 3) && near(out.pixels[0][1], out.pixels[0][2], 3), fmt(out.pixels[0]));
  await page.locator('[data-effect="pixelate"]').click();
  await page.locator('[data-effect="vignette"]').click();
  t.check('effects stack', (await layerById(imgA.id)).effects.length === 3);
  await page.getByRole('button', { name: 'Restore original image' }).click();
  l = await layerById(imgA.id);
  out = await exportVia({}, [red, blue]);
  t.check('restore original removes all edits (non-destructive)', l.effects.length === 0 && rgbNear(out.pixels[0], [255, 0, 0]) && rgbNear(out.pixels[1], [0, 0, 255]));

  // Crop is non-destructive and keeps the remaining pixels in place.
  await page.getByRole('button', { name: 'Crop' }).click();
  await page.getByLabel('Left', { exact: true }).fill('25');
  l = await layerById(imgA.id);
  t.check('crop trims the layer box', near(l.width, 300) && near(l.x, a.x + 100), `x=${l.x} w=${l.width}`);
  out = await exportVia({}, [[a.x + 150, a.y + 40], blue, [a.x + 50, a.y + 40]]);
  t.check('cropped image keeps remaining pixels in place', rgbNear(out.pixels[0], [255, 0, 0]) && rgbNear(out.pixels[1], [0, 0, 255]) && rgbNear(out.pixels[2], [96, 160, 200]), out.pixels.map(fmt).join(' '));
  await page.getByRole('button', { name: 'Restore original image' }).click();
  l = await layerById(imgA.id);
  t.check('crop can be reset', near(l.width, 400) && near(l.x, a.x));

  // Opacity and transparency of an uploaded PNG.
  await page.getByLabel('Opacity', { exact: true }).first().fill('50');
  out = await exportVia({}, [red]);
  t.check('layer opacity blends with the background', rgbNear(out.pixels[0], [176, 80, 100], 4), fmt(out.pixels[0]));
  await page.getByLabel('Opacity', { exact: true }).first().fill('100');

  await selectRow(imgB.id);
  await setField('X position', 560);
  await setField('Y position', 40);
  const b2 = await layerById(imgB.id);
  out = await exportVia({}, [
    [b2.x + b2.width / 2, b2.y + b2.height / 2],
    [b2.x + 6, b2.y + 6],
  ]);
  t.check('PNG transparency is preserved', rgbNear(out.pixels[0], [0, 200, 0]) && rgbNear(out.pixels[1], [96, 160, 200]), out.pixels.map(fmt).join(' '));
  await page.getByRole('button', { name: 'Flip horizontally' }).click();
  t.check('flip is stored on the layer', (await layerById(imgB.id)).scaleX === -1);
});

await section('Textures, overlays and backgrounds', async () => {
  await page.keyboard.press('Escape');
  const before = await exportVia({}, [[700, 500], [720, 520], [740, 540], [760, 560]]);

  await openTab('textures');
  const panel = page.locator('[data-testid="sidebar-panel"]');
  await page.waitForSelector('[data-generator="texture/paper"] img');
  const total = await panel.locator('[data-generator]').count();
  t.check('texture library is populated', total >= 30, `${total} textures`);
  await panel.getByLabel('Search textures').fill('glitch');
  const filtered = await panel.locator('[data-generator]').count();
  t.check('texture search filters the library', filtered >= 1 && filtered < total, `${filtered} results`);
  await panel.getByLabel('Search textures').fill('');
  await panel.getByRole('button', { name: 'Vintage', exact: true }).click();
  t.check('texture category filter works', (await panel.locator('[data-generator]').count()) < total);
  await panel.getByRole('button', { name: 'All', exact: true }).click();

  await page.locator('[data-generator="texture/grunge"]').click();
  let ls = await layers();
  const tex = ls[ls.length - 1];
  t.check('texture is added as an editable layer', tex.type === 'image' && tex.source.kind === 'generated' && tex.blendMode === 'multiply' && tex.width === 800);
  const after = await exportVia({}, [[700, 500], [720, 520], [740, 540], [760, 560]]);
  const changed = after.pixels.some((p, i) => !rgbNear(p, before.pixels[i], 2));
  const darker = after.pixels.every((p, i) => p[0] <= before.pixels[i][0] + 1 && p[1] <= before.pixels[i][1] + 1);
  t.check('texture changes the rendered result', changed, after.pixels.map(fmt).join(' '));
  t.check('multiply texture only darkens', darker);

  // Texture layers accept the same controls: blend mode, opacity, a new variation.
  await page.getByLabel('Blend mode', { exact: true }).selectOption('overlay');
  await page.getByRole('button', { name: 'Generate a new variation' }).click();
  const varied = await layerById(tex.id);
  t.check('texture blend mode and variation are editable', varied.blendMode === 'overlay' && varied.source.seed !== tex.source.seed);

  // Drag an overlay from the panel onto the canvas.
  await openTab('overlays');
  await page.waitForSelector('[data-generator="overlay/light-leak"] img');
  await page.locator('[data-generator="overlay/light-leak"]').dragTo(page.locator('[data-testid="canvas-host"]'));
  await settle();
  ls = await layers();
  const overlay = ls[ls.length - 1];
  t.check('overlay can be dragged onto the canvas', overlay.source?.generator === 'overlay/light-leak' && overlay.blendMode === 'screen');

  // Backgrounds: gradient preset and generated background layer.
  await openTab('backgrounds');
  await page.getByRole('button', { name: 'Sunset gradient' }).click();
  let s = await state(page);
  t.check('gradient background is applied', s.doc.background.type === 'linear' && s.doc.background.stops.length === 2);
  await page.locator('[data-generator="background/mesh-gradient"]').click();
  ls = await layers();
  t.check('generated background is inserted as the bottom layer', ls[0].source?.generator === 'background/mesh-gradient');
  await page.keyboard.press('Delete');
  s = await state(page);
  t.check('deleting the background layer keeps the rest', s.doc.layers[0].source?.generator !== 'background/mesh-gradient');

  // Custom gradient editing.
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="canvas-size"]').click();
  await page.locator('[data-testid="canvas-properties"]').getByRole('button', { name: 'Radial' }).click();
  await setField('Stop 1 colour hex', '#ffffff');
  s = await state(page);
  t.check('custom gradients are editable', s.doc.background.type === 'radial' && s.doc.background.stops[0].color === '#ffffff');
  await page.locator('[data-testid="canvas-properties"]').getByRole('button', { name: 'Solid' }).click();
  await setField('Fill colour hex', '#60a0c8');
});

let savedDoc;

await section('Projects: autosave, refresh and reopen', async () => {
  await waitForSaved(page);
  savedDoc = (await state(page)).doc;
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n, savedDoc.layers.length);
  await settle(1500); // web fonts load and text re-measures
  const restored = (await state(page)).doc;
  const strip = (d) => JSON.stringify({ ...d, updatedAt: 0 });
  t.check('document is identical after a browser refresh', strip(restored) === strip(savedDoc), `layers ${restored.layers.length}/${savedDoc.layers.length}`);
  const text = restored.layers.find((l) => l.id === textId);
  t.check('text survives as editable text', text?.type === 'text' && text.text === 'Edited on canvas' && text.fontFamily === 'Playfair Display');
  t.check('blend modes and generated layers survive', restored.layers.some((l) => l.blendMode === 'overlay') && restored.layers.some((l) => l.source?.kind === 'generated'));

  // Still editable: double-click the text again.
  await settle(800);
  await page.locator('[data-layer-id]').first().waitFor();
  for (const l of restored.layers.filter((x) => x.source?.kind === 'generated')) {
    await page.locator(`[data-layer-id="${l.id}"]`).getByRole('button', { name: 'Hide layer' }).click();
  }
  const c = await centerOf(text);
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.locator('[data-testid="text-editor"]');
  await editor.waitFor();
  await editor.fill('Reopened and edited');
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  await page.mouse.click(host.x + 12, host.y + 12);
  await editor.waitFor({ state: 'detached' });
  t.check('reopened project can be edited again', (await layerById(textId)).text === 'Reopened and edited');
  await page.keyboard.press('Control+z');
});

await section('Export: formats, dimensions and fidelity', async () => {
  await page.keyboard.press('Escape');
  const a = await layerById(imgA.id);
  const pts = [
    [a.x + 100, a.y + 40],
    [a.x + 300, a.y + 40],
    [790, 590],
  ];
  const png = await exportVia({}, pts);
  t.check('PNG export has the canvas dimensions', png.width === 800 && png.height === 600, `${png.width}x${png.height}`);
  t.check('PNG file is named after the project', png.name === 'Renamed design.png', png.name);
  t.check('PNG signature is valid', png.buffer.subarray(1, 4).toString() === 'PNG');

  const png2 = await exportVia({ scale: '2×' }, pts.map(([x, y]) => [x * 2, y * 2]));
  t.check('2× export doubles the pixel dimensions', png2.width === 1600 && png2.height === 1200, `${png2.width}x${png2.height}`);
  t.check('2× export shows the same content', png2.pixels.every((p, i) => rgbNear(p, png.pixels[i], 4)));

  const jpg = await exportVia({ format: 'JPG' }, pts);
  t.check('JPG export has the canvas dimensions', jpg.width === 800 && jpg.height === 600);
  t.check('JPG file is a real JPEG', jpg.buffer[0] === 0xff && jpg.buffer[1] === 0xd8 && jpg.name.endsWith('.jpg'));
  t.check('JPG content matches PNG', jpg.pixels.every((p, i) => rgbNear(p, png.pixels[i], 12)), jpg.pixels.map(fmt).join(' '));

  const clear = await exportVia({ transparent: true }, pts);
  t.check('transparent PNG drops the background', clear.pixels[2][3] === 0 && clear.pixels[0][3] === 255, clear.pixels.map(fmt).join(' '));

  const webp = await exportVia({ format: 'WebP' }, pts);
  t.check('WebP export works', webp.width === 800 && webp.buffer.subarray(8, 12).toString() === 'WEBP');

  // Compare the export with what the editor shows on screen.
  await page.mouse.move(5, 5);
  const shot = await page.locator('[data-testid="canvas-host"]').screenshot();
  const v = await view(page);
  const screenPts = pts.slice(0, 2).map(([x, y]) => [v.pan.x + x * v.zoom, v.pan.y + y * v.zoom]);
  const screen = await decode(shot, 'image/png', screenPts);
  t.check('export matches the on-screen canvas', screen.pixels.every((p, i) => rgbNear(p, png.pixels[i], 6)), `${screen.pixels.map(fmt).join(' ')} vs ${png.pixels.slice(0, 2).map(fmt).join(' ')}`);
});

await section('Templates and project management', async () => {
  await openTab('templates');
  await page.locator('[data-template="social-quote"]').click();
  await settle(500);
  let s = await state(page);
  t.check('template replaces the design with editable layers', s.doc.width === 1080 && s.doc.layers.length >= 4 && s.doc.layers.some((l) => l.type === 'text'));
  await page.keyboard.press('Control+z');
  s = await state(page);
  t.check('applying a template can be undone', s.doc.width === 800 && s.doc.layers.some((l) => l.id === textId));

  await page.getByRole('button', { name: 'Projects' }).click();
  const dlg = page.getByRole('dialog', { name: 'Projects' });
  const cards = dlg.locator('[data-testid="project-card"]');
  await cards.first().waitFor();
  const count = await cards.count();
  t.check('recent projects are listed', count >= 2, `${count} projects`);
  t.check('projects have thumbnails', (await dlg.locator('[data-testid="project-card"] img').count()) >= 1);

  await dlg.getByRole('button', { name: 'Duplicate Renamed design' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="project-card"]').length === n + 1, count);
  t.check('a project can be duplicated', (await cards.count()) === count + 1);

  await dlg.getByRole('button', { name: 'Rename Renamed design copy' }).click();
  const input = dlg.getByLabel('Project name', { exact: true });
  await input.fill('Second copy');
  await input.press('Enter');
  await dlg.getByText('Second copy').waitFor();
  t.check('a project can be renamed', true);

  await dlg.getByRole('button', { name: 'Open Second copy' }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  s = await state(page);
  t.check('a different project can be opened', s.doc.name === 'Second copy' && s.doc.layers.length === savedDoc.layers.length);

  await page.getByRole('button', { name: 'Projects' }).click();
  await dlg.getByRole('button', { name: 'Delete Second copy' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="project-card"]').length === n, count);
  s = await state(page);
  t.check('deleting the open project opens another one', s.doc.name !== 'Second copy');
  await page.keyboard.press('Escape');
});

await section('View: zoom, pan, grid and rulers', async () => {
  await page.getByRole('button', { name: /Fit canvas/ }).click();
  const before = await view(page);
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  await page.mouse.move(host.x + host.width / 2, host.y + host.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await settle();
  let v = await view(page);
  t.check('Ctrl+wheel zooms in', v.zoom > before.zoom * 1.3, `${before.zoom.toFixed(2)} -> ${v.zoom.toFixed(2)}`);
  await page.mouse.wheel(0, 120);
  await settle();
  t.check('wheel pans the view', (await view(page)).pan.y === v.pan.y - 120);

  await page.getByRole('button', { name: /Hand tool/ }).click();
  v = await view(page);
  await drag({ x: host.x + 300, y: host.y + 300 }, { x: host.x + 360, y: host.y + 340 });
  const panned = await view(page);
  t.check('hand tool pans by dragging', near(panned.pan.x - v.pan.x, 60) && near(panned.pan.y - v.pan.y, 40));
  await page.getByRole('button', { name: /Move tool/ }).click();
  await page.getByRole('button', { name: /Fit canvas/ }).click();
  t.check('fit to screen restores the framing', near((await view(page)).zoom, before.zoom, 0.01));

  await page.keyboard.press('Escape');
  await page.locator('[data-testid="canvas-size"]').click();
  await page.getByRole('switch', { name: 'Show grid' }).click();
  await page.getByRole('switch', { name: 'Show rulers' }).click();
  t.check('grid and rulers can be toggled', await page.evaluate(() => { const s = window.__prysm.ui.getState(); return s.showGrid && !s.showRulers; }));
  await page.getByRole('switch', { name: 'Show rulers' }).click();
  await page.screenshot({ path: join(OUTPUT_DIR, 'final-with-grid.png') });
  await page.getByRole('switch', { name: 'Show grid' }).click();
});

await page.screenshot({ path: join(OUTPUT_DIR, 'final.png') });
t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));

const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
