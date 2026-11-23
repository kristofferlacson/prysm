/**
 * Milestone 2, stage 5: clipping masks, and how they combine with opacity, blend modes and layer masks.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, toScreen, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const clear = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const flat = async (points) => (await h.exportPng(points)).pixels;
const clipSwitch = () => props.getByRole('switch', { name: 'Clip to layer below' });
const setBlend = (mode) => props.getByLabel('Blend mode', { exact: true }).selectOption(mode);
const setOpacity = (value) => props.getByLabel('Opacity', { exact: true }).first().fill(String(value));

async function uploadSolid(name, color, size) {
  const url = await page.evaluate(
    ({ color, size }) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      return c.toDataURL('image/png');
    },
    { color, size },
  );
  const before = (await h.layers()).length;
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before);
  return (await h.layers()).at(-1);
}

const RED = [255, 0, 0];
const GREEN = [0, 200, 0];
const IN = [450, 300]; // inside the ellipse and the image
const OUT = [650, 300]; // inside the image, outside the ellipse
const BASE = [250, 300]; // inside the ellipse only

let E; // red ellipse, the clipping base
let G; // green image, clipped to it

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  await h.openTab('elements');
  await page.getByTitle('Circle', { exact: true }).click();
  E = (await h.layers()).at(-1);
  await h.patch(E.id, { x: 150, y: 100, width: 400, height: 400, fill: { type: 'solid', color: '#ff0000' } });
  G = await uploadSolid('green.png', '#00c800', 300);
  await h.patch(G.id, { x: 400, y: 200 });
  const px = await clear([IN, OUT, BASE]);
  t.check('before clipping the image is fully visible', rgbNear(px[0], GREEN) && rgbNear(px[1], GREEN) && px[1][3] === 255 && rgbNear(px[2], RED), px.map(fmt).join(' '));
});

await section('Clip an image to a shape', async () => {
  await h.selectRow(G.id);
  const before = (await state(page)).past;
  await clipSwitch().click();
  const g = await h.layerById(G.id);
  t.check('the clip relationship is stored on the layer', g.clip === true && (await state(page)).past === before + 1);
  t.check('the layers panel marks the clipped layer', (await page.locator(`[data-layer-id="${G.id}"]`).getAttribute('data-clipped')) === 'true');
  let px = await clear([IN, OUT, BASE]);
  t.check('the image shows only inside the shape', rgbNear(px[0], GREEN) && px[0][3] === 255 && px[1][3] === 0 && rgbNear(px[2], RED), px.map(fmt).join(' '));
  const screen = await h.screenPixels([IN, OUT]);
  t.check('the editor canvas matches the export', rgbNear(screen[0], GREEN, 4) && rgbNear(screen[1], [255, 255, 255], 4), screen.map(fmt).join(' '));

  // Edge of the base: antialiased, never the clipped layer's full box.
  px = await clear([[548, 300], [552, 300]]);
  t.check('the clip follows the curved edge of the base', px[0][3] > 200 && px[1][3] < 60, px.map(fmt).join(' '));
});

await section('Clipping with opacity and blend modes', async () => {
  await setOpacity(50);
  let px = await clear([IN, OUT]);
  t.check('clipped layer opacity blends with the base inside the clip', rgbNear(px[0], [128, 100, 0], 4) && px[0][3] === 255 && px[1][3] === 0, px.map(fmt).join(' '));
  await setOpacity(100);

  const failures = [];
  const expected = { multiply: [0, 0, 0], screen: [255, 200, 0], difference: [255, 200, 0], darken: [0, 0, 0], lighten: [255, 200, 0] };
  for (const [mode, rgb] of Object.entries(expected)) {
    await setBlend(mode);
    px = await clear([IN, OUT, BASE]);
    if (!rgbNear(px[0], rgb, 4) || px[0][3] !== 255) failures.push(`${mode}: inside ${fmt(px[0])} expected [${rgb}]`);
    if (px[1][3] !== 0) failures.push(`${mode}: leaks outside the base ${fmt(px[1])}`);
    if (!rgbNear(px[2], RED)) failures.push(`${mode}: base changed ${fmt(px[2])}`);
  }
  t.check('blend modes act on the base and stay inside the clip', failures.length === 0, failures.join(' | '));

  // Base opacity fades the whole clipping group.
  await setBlend('multiply');
  await h.selectRow(E.id);
  await setOpacity(50);
  px = await clear([IN, BASE, OUT]);
  t.check('base opacity applies to the whole clipping group', near(px[0][3], 128, 4) && rgbNear(px[0], [0, 0, 0], 6) && near(px[1][3], 128, 4) && px[2][3] === 0, px.map(fmt).join(' '));
  await setOpacity(100);

  // Base blend mode blends the finished group with what lies underneath.
  await h.selectRow(G.id);
  await setBlend('normal');
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Fill colour hex', '#60a0c8');
  await h.selectRow(E.id);
  await setBlend('multiply');
  px = await flat([IN, BASE, OUT]);
  t.check('base blend mode blends the group with the layers below', rgbNear(px[0], [0, 125, 0], 4) && rgbNear(px[1], [96, 0, 0], 4) && rgbNear(px[2], [96, 160, 200], 3), px.map(fmt).join(' '));
  await setBlend('normal');
});

await section('Moving, hiding, releasing and undo', async () => {
  // Drag the base with the mouse while the clipped layer has a blend mode (the two-pass path).
  await h.selectRow(G.id);
  await setBlend('multiply');
  await page.keyboard.press('Escape');
  const before = await h.layerById(E.id);
  const grab = await toScreen(page, 250, 300);
  const drop = await toScreen(page, 350, 300);
  await h.drag(grab, drop, 14);
  const moved = await h.layerById(E.id);
  t.check('the base can be dragged on its own', near(moved.x - before.x, 100, 12) && (await h.layerById(G.id)).x === 400, `dx=${(moved.x - before.x).toFixed(1)}`);
  await h.patch(E.id, { x: 250, y: 100 });
  let px = await clear([[630, 300], [690, 300], [450, 300]]);
  t.check('the clip region follows the base', px[0][3] === 255 && px[1][3] === 0 && rgbNear(px[2], [0, 0, 0], 4), px.map(fmt).join(' '));
  await h.patch(E.id, { x: 150, y: 100 });
  await h.selectRow(G.id);
  await setBlend('normal');

  // Hiding the base hides everything clipped to it.
  await page.locator(`[data-layer-id="${E.id}"]`).getByRole('button', { name: 'Hide layer' }).click();
  px = await clear([IN, BASE]);
  t.check('hiding the base hides the clipped layers too', px[0][3] === 0 && px[1][3] === 0, px.map(fmt).join(' '));
  await page.locator(`[data-layer-id="${E.id}"]`).getByRole('button', { name: 'Show layer' }).click();

  // Release with the layers panel button, then undo / redo.
  await h.selectRow(G.id);
  await page.locator('[data-testid="layers-panel"]').getByRole('button', { name: /Clip to the layer below/ }).click();
  px = await clear([OUT]);
  t.check('releasing shows the whole layer again', (await h.layerById(G.id)).clip === false && px[0][3] === 255 && rgbNear(px[0], GREEN), fmt(px[0]));
  await page.keyboard.press('Control+z');
  px = await clear([OUT]);
  t.check('undo restores the clip', (await h.layerById(G.id)).clip === true && px[0][3] === 0);
  await page.keyboard.press('Control+Shift+z');
  t.check('redo releases it again', (await h.layerById(G.id)).clip === false);
  await page.keyboard.press('Control+Alt+g');
  t.check('Ctrl+Alt+G toggles clipping', (await h.layerById(G.id)).clip === true);

  // The bottom layer has nothing to clip to.
  await h.selectRow(E.id);
  await clipSwitch().click();
  t.check('the bottom layer cannot be clipped', (await h.layerById(E.id)).clip === false);
});

let T;

await section('Clip an image to text', async () => {
  await h.openTab('text');
  await page.getByRole('button', { name: 'Add a heading' }).click();
  T = (await h.layers()).at(-1);
  await h.patch(T.id, { text: 'HHH', fontSize: 230, fontWeight: 900, x: 100, y: 160, width: 600, align: 'center' });
  await page.locator('[data-testid="properties-panel"]').getByRole('button', { name: 'Send backward' }).click();
  let ls = await h.layers();
  t.check('the text sits directly below the image', ls.map((l) => l.id).join() === [E.id, T.id, G.id].join());
  await h.patch(G.id, { x: 100, y: 100, width: 600, height: 400 });
  await h.settle(1200);
  const text = await h.layerById(T.id);
  const grid = [];
  for (let y = text.y + 20; y < text.y + text.height - 20; y += 14) for (let x = 110; x < 690; x += 14) grid.push([x, y]);
  const px = await clear(grid);
  const green = px.filter((p) => p[3] > 200 && rgbNear(p, GREEN, 6)).length / px.length;
  const emptyOrOther = px.filter((p) => p[3] < 40 || rgbNear(p, RED, 6)).length / px.length;
  t.check('the image fills the letters and nothing else', green > 0.2 && green < 0.8 && green + emptyOrOther > 0.9, `${(green * 100).toFixed(0)}% image, ${(emptyOrOther * 100).toFixed(0)}% empty or other layers`);
  const outside = await clear([[110, 110], [690, 490]]);
  t.check('outside the text the image is hidden', outside.every((p) => p[3] < 20 || rgbNear(p, RED, 6)), outside.map(fmt).join(' '));

  // The text stays editable text while it is a clipping base.
  await h.patch(T.id, { text: 'III' });
  await h.settle(400);
  const narrower = (await clear(grid)).filter((p) => p[3] > 200 && rgbNear(p, GREEN, 6)).length / grid.length;
  t.check('editing the text changes the clip', narrower < green - 0.1, `${(green * 100).toFixed(0)}% -> ${(narrower * 100).toFixed(0)}%`);
  await h.selectRow(T.id);
  await page.keyboard.press('Delete');
});

await section('Clipping to a masked image, several clipped layers, clipped groups', async () => {
  // G becomes a base (not clipped). A layer mask hides a band of it; shapes clipped to G must respect that.
  await h.selectRow(G.id);
  if ((await h.layerById(G.id)).clip) await clipSwitch().click();
  await h.patch(G.id, { x: 100, y: 100, width: 600, height: 400 });
  await props.getByRole('button', { name: 'Add layer mask' }).click();
  await page.keyboard.press('b');
  const options = page.locator('[data-testid="tool-options"]');
  await options.getByRole('button', { name: 'Hide (black)' }).click();
  await h.setField('Size', 80, options);
  await h.setField('Hardness', 100, options);
  await h.setField('Opacity', 100, options);
  await h.stroke([[150, 300], [650, 300]]);
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');

  await h.openTab('elements');
  await page.getByTitle('Rectangle', { exact: true }).click();
  const S = (await h.layers()).at(-1);
  await h.patch(S.id, { x: 50, y: 50, width: 400, height: 500, fill: { type: 'solid', color: '#0000ff' } });
  await h.selectRow(S.id);
  await clipSwitch().click();
  let px = await clear([[200, 200], [200, 300], [70, 200], [550, 200]]);
  t.check('a layer clipped to a masked image respects the mask', rgbNear(px[0], [0, 0, 255]) && px[0][3] === 255 && rgbNear(px[1], RED) && px[2][3] === 0 && rgbNear(px[3], GREEN), px.map(fmt).join(' '));

  await page.getByTitle('Circle', { exact: true }).click();
  const C = (await h.layers()).at(-1);
  await h.patch(C.id, { x: 350, y: 50, width: 300, height: 300, fill: { type: 'solid', color: '#ffff00' } });
  await h.selectRow(C.id);
  await clipSwitch().click();
  px = await clear([[500, 180], [500, 300], [500, 70], [200, 200]]);
  t.check('several layers can be clipped to the same base', rgbNear(px[0], [255, 255, 0]) && rgbNear(px[1], RED) && px[2][3] === 0 && rgbNear(px[3], [0, 0, 255]), px.map(fmt).join(' '));

  // A group clipped as one object.
  await h.selectRow(S.id);
  await page.keyboard.press('Delete');
  await h.selectRow(C.id);
  await page.keyboard.press('Delete');
  await page.getByTitle('Rectangle', { exact: true }).click();
  const r1 = (await h.layers()).at(-1);
  await page.getByTitle('Rectangle', { exact: true }).click();
  const r2 = (await h.layers()).at(-1);
  await h.patch(r1.id, { x: 20, y: 120, width: 300, height: 100, fill: { type: 'solid', color: '#ff00ff' } });
  await h.patch(r2.id, { x: 20, y: 380, width: 760, height: 100, fill: { type: 'solid', color: '#00ffff' } });
  await h.selectRow(r1.id);
  await h.selectRow(r2.id, ['Shift']);
  await page.keyboard.press('Control+g');
  await clipSwitch().click();
  const group = (await h.layers()).at(-1);
  px = await clear([[200, 170], [50, 170], [400, 430], [750, 430]]);
  t.check('a group can be clipped as a single object', group.type === 'group' && group.clip && rgbNear(px[0], [255, 0, 255]) && px[1][3] === 0 && rgbNear(px[2], [0, 255, 255]) && px[3][3] === 0, px.map(fmt).join(' '));
});

await section('Save and reopen', async () => {
  const pts = [[200, 170], [50, 170], [400, 430], [750, 430], [400, 300], [400, 200]];
  const reference = await flat(pts);
  await waitForSaved(page);
  const saved = (await state(page)).doc;
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n, saved.layers.length);
  await h.settle(1200);
  const restored = (await state(page)).doc;
  const strip = (d) => JSON.stringify({ ...d, updatedAt: 0 });
  t.check('clip relationships survive save and reopen', strip(restored) === strip(saved) && restored.layers.some((l) => l.clip));
  const px = await flat(pts);
  t.check('the clipped composition renders identically after reopening', px.every((p, i) => rgbNear(p, reference[i], 3)), px.map(fmt).join(' '));
  const clearPx = await clear([[50, 170], [750, 430]]);
  t.check('transparent PNG export keeps clipped-away areas empty', clearPx.every((p) => p[3] === 0), clearPx.map(fmt).join(' '));
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
