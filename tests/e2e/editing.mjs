/**
 * Image editing controls added after the selection tools: levels, curves, the vignette colour,
 * crop shapes and cropping on the canvas, and background blur.
 * Driven through the real interface and measured on exported pixels.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, removeBackground, rgbNear, state, toScreen, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const pixels = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const grey = (p, v, tol = 3) => near(p[0], v, tol) && near(p[1], v, tol) && near(p[2], v, tol);
const layer = async () => (await h.layers())[0];
const ui = () => page.evaluate(() => ({ crop: window.__prysm.ui.getState().cropLayerId, preset: window.__prysm.ui.getState().cropPreset }));

async function upload(name, draw, size, mime = 'image/png') {
  const url = await page.evaluate(
    ({ draw, size, mime }) => {
      const c = document.createElement('canvas');
      c.width = size[0];
      c.height = size[1];
      new Function('ctx', 'w', 'h', draw)(c.getContext('2d'), c.width, c.height);
      return c.toDataURL(mime, 0.8);
    },
    { draw, size, mime },
  );
  const before = (await h.layers()).length;
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name, mimeType: mime, buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before);
  const ls = await h.layers();
  return ls[ls.length - 1];
}
/** Opens a collapsible section of the properties panel and returns it. */
async function openSection(title) {
  const header = props.getByRole('button', { name: title, exact: true });
  const body = header.locator('xpath=ancestor::section[1]');
  if ((await body.locator(':scope > div').count()) < 2) await header.click();
  return body;
}
const slide = async (scope, label, value) => {
  await scope.getByLabel(label, { exact: true }).fill(String(value));
  await h.settle(250);
};

// Four bands, 100 px each: grey 64, grey 128, grey 192, and a red. On the canvas at 200..600 x 150..450.
const BANDS = `[['#404040'], ['#808080'], ['#c0c0c0'], ['#c83c28']].forEach(([c], i) => { ctx.fillStyle = c; ctx.fillRect(i * w / 4, 0, w / 4, h); });`;
const AT = { g64: [250, 300], g128: [350, 300], g192: [450, 300], red: [550, 300] };
let bands;

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  bands = await upload('bands.png', BANDS, [400, 300]);
  await h.patch(bands.id, { x: 200, y: 150 });
  await h.selectRow(bands.id);
  const px = await pixels(Object.values(AT));
  t.check('the test picture has known tones', grey(px[0], 64) && grey(px[1], 128) && grey(px[2], 192) && rgbNear(px[3], [200, 60, 40]), px.map(fmt).join(' '));
});

await section('Levels', async () => {
  const levels = await openSection('Levels');
  const histogram = await levels.locator('[data-testid="levels-histogram"] path').first().getAttribute('d');
  t.check('a histogram of the picture is drawn', histogram.length > 500 && /L64 /.test(histogram));
  const before = await state(page);
  await slide(levels, 'Black point', 64);
  let px = await pixels([AT.g64, AT.g128, AT.g192]);
  t.check('the black point maps that tone to black and stretches the rest', grey(px[0], 0) && grey(px[1], 85) && grey(px[2], 171), px.map(fmt).join(' '));
  t.check('it is one undo step and stored on the layer', (await state(page)).past === before.past + 1 && (await layer()).adjustments.levels.black === 64);
  await slide(levels, 'White point', 192);
  px = await pixels([AT.g64, AT.g128, AT.g192]);
  t.check('the white point maps that tone to white', grey(px[0], 0) && grey(px[1], 128) && grey(px[2], 255), px.map(fmt).join(' '));
  await slide(levels, 'Midtones', 2);
  px = await pixels([AT.g128]);
  t.check('midtones brighten the middle without moving the ends', grey(px[0], 180), fmt(px[0]));
  await slide(levels, 'Output black', 50);
  await slide(levels, 'Output white', 200);
  px = await pixels([AT.g64, AT.g128, AT.g192]);
  t.check('the output range limits how dark and how light the result gets', grey(px[0], 50) && grey(px[1], 156) && grey(px[2], 200), px.map(fmt).join(' '));

  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(900);
  await h.selectRow(bands.id);
  px = await pixels([AT.g128]);
  t.check('levels are saved with the project', grey(px[0], 156) && (await layer()).adjustments.levels.gamma === 2, fmt(px[0]));

  const again = await openSection('Levels');
  await again.getByRole('button', { name: 'Reset', exact: true }).click();
  px = await pixels([AT.g64, AT.g128, AT.g192]);
  t.check('Reset returns the picture to its own tones', grey(px[0], 64) && grey(px[1], 128) && grey(px[2], 192) && (await layer()).adjustments.levels === null, px.map(fmt).join(' '));
  await again.getByRole('button', { name: 'Auto', exact: true }).click();
  await h.settle(250);
  const auto = (await layer()).adjustments.levels;
  px = await pixels([AT.g64, AT.g192]);
  t.check('Auto finds where the picture’s tones begin and end', near(auto.black, 64, 2) && near(auto.white, 192, 2) && px[0][0] <= 3 && px[1][0] >= 252, `black ${auto.black}, white ${auto.white}`);
  await again.getByRole('button', { name: 'Reset', exact: true }).click();
});

await section('Curves', async () => {
  const curves = await openSection('Curves');
  const editor = curves.locator('[data-testid="curves-editor"]');
  const at = async (x, y) => {
    await editor.scrollIntoViewIfNeeded();
    const box = await editor.boundingBox();
    return { x: box.x + (x / 255) * box.width, y: box.y + (1 - y / 255) * box.height };
  };
  const points = () => editor.locator('[data-curve-point]').evaluateAll((els) => els.map((e) => e.dataset.value.split(',').map(Number)));
  t.check('the curve starts as a straight line with two end points', JSON.stringify(await points()) === '[[0,0],[255,255]]');

  // Press on the line at the middle and drag up: a new point, lifted.
  const before = await state(page);
  await h.drag(await at(128, 128), await at(128, 200), 6);
  let pts = await points();
  const mid = pts[1];
  t.check('pressing on the line adds a point and dragging moves it', pts.length === 3 && near(mid[0], 128, 3) && near(mid[1], 200, 4), JSON.stringify(pts));
  let px = await pixels([AT.g64, AT.g128, AT.g192]);
  t.check('lifting the middle brightens the midtones and keeps black and white fixed', near(px[1][0], mid[1], 6) && px[0][0] > 64 && px[0][0] < px[1][0] && px[2][0] > 192, px.map(fmt).join(' '));
  t.check('the drag is one undo step', (await state(page)).past === before.past + 1, `${before.past} -> ${(await state(page)).past}`);

  // Red only.
  await curves.getByRole('button', { name: 'Red', exact: true }).click();
  t.check('each channel has its own curve', (await editor.getAttribute('data-channel')) === 'r' && (await points()).length === 2);
  const grey128 = px[1];
  await h.drag(await at(128, 128), await at(128, 60), 6);
  px = await pixels([AT.g128]);
  t.check('the red curve changes red and leaves green and blue alone', px[0][0] < grey128[0] - 25 && near(px[0][1], grey128[1], 2) && near(px[0][2], grey128[2], 2), `${fmt(px[0])} from ${fmt(grey128)}`);
  await editor.locator('[data-curve-point="1"]').dblclick();
  px = await pixels([AT.g128]);
  t.check('double-clicking a point removes it', (await points()).length === 2 && near(px[0][0], grey128[0], 2), fmt(px[0]));
  await editor.locator('[data-curve-point="0"]').dblclick();
  t.check('the end points cannot be removed', (await points()).length === 2);

  // The right end pulled down: nothing gets brighter than half.
  await curves.getByRole('button', { name: 'RGB', exact: true }).click();
  await curves.getByRole('button', { name: 'Reset RGB', exact: true }).click();
  await h.drag(await at(255, 255), await at(255, 128), 6);
  pts = await points();
  px = await pixels([AT.g64, AT.g128, AT.g192]);
  const top = pts[1][1];
  t.check('lowering the white end caps the brightness', near(top, 128, 4) && near(px[1][0], (128 * top) / 255, 4) && near(px[2][0], (192 * top) / 255, 4), `${JSON.stringify(pts)} ${px.map(fmt).join(' ')}`);
  t.check('a point cannot be dragged past its neighbour', pts[1][0] === 255 && pts[0][0] === 0);
  await curves.getByRole('button', { name: 'Reset all', exact: true }).click();
  px = await pixels([AT.g128]);
  t.check('Reset all removes every curve', grey(px[0], 128) && (await layer()).adjustments.curves === null, fmt(px[0]));

  // Levels and curves together, with a basic adjustment: all of them apply.
  const levels = await openSection('Levels');
  await slide(levels, 'Black point', 64);
  await h.drag(await at(128, 128), await at(128, 64), 6);
  px = await pixels([AT.g128]);
  t.check('levels and curves combine (levels first, then the curve)', px[0][0] < 60 && (await layer()).adjustments.levels.black === 64 && (await layer()).adjustments.curves.rgb.length === 3, fmt(px[0]));
  await props.getByRole('button', { name: 'Restore original image' }).click();
  px = await pixels([AT.g64, AT.g128]);
  t.check('“Restore original image” clears levels and curves too', grey(px[0], 64) && grey(px[1], 128), px.map(fmt).join(' '));
});

await section('Vignette colour', async () => {
  await h.openTab('effects');
  await page.locator('[data-effect="vignette"]').click();
  await h.settle(300);
  // Corner and centre of the picture, in the grey 64 and grey 128 bands: use one tone, the 128 band, top and middle.
  let px = await pixels([[350, 156], [350, 300], [205, 155]]);
  t.check('a vignette darkens the edges by default', px[0][0] < px[1][0] - 5 && px[2][0] < 60, px.map(fmt).join(' '));
  const before = px;
  await h.setField('Vignette colour 1 hex', '#ffffff', props);
  await h.settle(400);
  px = await pixels([[350, 156], [350, 300], [205, 155]]);
  t.check('with a white vignette the edges get lighter instead', px[0][0] > px[1][0] + 5 && px[2][0] > 100 && near(px[1][0], before[1][0], 3), `${px.map(fmt).join(' ')} (was ${before.map(fmt).join(' ')})`);
  await props.getByRole('button', { name: 'Remove Vignette' }).click();
});

await section('Crop shapes', async () => {
  const crop = await openSection('Crop');
  const shape = crop.getByLabel('Crop shape', { exact: true });
  await shape.selectOption('1:1');
  let l = await layer();
  t.check('1:1 crops to a centred square', near(l.width, 300, 0.01) && near(l.height, 300, 0.01) && near(l.crop.left, 0.125, 0.001) && near(l.crop.right, 0.125, 0.001) && l.crop.top === 0, `${l.width}x${l.height} ${JSON.stringify(l.crop)}`);
  let px = await pixels([AT.g128, AT.g192, [240, 300], [560, 300]]);
  t.check('what remains has not moved; the trimmed parts are gone', grey(px[0], 128) && grey(px[1], 192) && px[2][3] === 0 && px[3][3] === 0, px.map(fmt).join(' '));
  await shape.selectOption('16:9');
  l = await layer();
  t.check('16:9 uses the full width', near(l.width, 400, 0.01) && near(l.height, 225, 0.01) && near(l.width / l.height, 16 / 9, 0.001), `${l.width}x${l.height}`);
  await shape.selectOption('9:16');
  l = await layer();
  t.check('9:16 uses the full height', near(l.height, 300, 0.01) && near(l.width / l.height, 9 / 16, 0.001), `${l.width}x${l.height}`);
  await shape.selectOption('original');
  l = await layer();
  t.check('Original restores the picture’s own shape', near(l.width, 400, 0.01) && near(l.height, 300, 0.01));
  await shape.selectOption('free');
});

await section('Cropping on the canvas', async () => {
  const crop = await openSection('Crop');
  await crop.getByRole('button', { name: 'Crop on canvas', exact: true }).click();
  const overlay = page.locator('[data-testid="crop-overlay"]');
  const bar = page.locator('[data-testid="crop-bar"]');
  t.check('crop mode shows the frame, its handles and a bar', (await overlay.isVisible()) && (await bar.isVisible()) && (await overlay.locator('[data-crop-handle]').count()) === 8 && (await ui()).crop === bands.id);
  const handle = async (id) => {
    const box = await overlay.locator(`[data-crop-handle="${id}"]`).boundingBox();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const dragBy = async (id, dx, dy) => {
    const from = id === 'move' ? await toScreen(page, ...frameCentre(await layer())) : await handle(id);
    const { zoom } = await page.evaluate(() => ({ zoom: window.__prysm.ui.getState().zoom }));
    await h.drag(from, { x: from.x + dx * zoom, y: from.y + dy * zoom }, 6);
  };
  const frameCentre = (l) => [l.x + l.width / 2, l.y + l.height / 2];

  const before = await state(page);
  await dragBy('e', -100, 0);
  let l = await layer();
  t.check('dragging the right side trims the right', near(l.width, 300, 1.5) && near(l.crop.right, 0.25, 0.005) && l.crop.left === 0 && near(l.x, 200, 0.01), `${l.width}x${l.height} ${JSON.stringify(l.crop)}`);
  t.check('a drag is one undo step', (await state(page)).past === before.past + 1, `${before.past} -> ${(await state(page)).past}`);
  await dragBy('nw', 50, 30);
  l = await layer();
  t.check('dragging a corner trims two sides', near(l.crop.left, 0.125, 0.005) && near(l.crop.top, 0.1, 0.005) && near(l.x, 250, 1.5) && near(l.y, 180, 1.5), `${l.x},${l.y} ${JSON.stringify(l.crop)}`);
  await dragBy('move', 60, 0);
  l = await layer();
  t.check('dragging inside the frame moves it over the picture', near(l.crop.left, 0.125 + 0.15, 0.006) && near(l.width, 250, 2) && near(l.crop.right, 0.25 - 0.15, 0.006), JSON.stringify(l.crop));
  await dragBy('move', 400, 0);
  l = await layer();
  t.check('the frame stops at the edge of the picture', near(l.crop.right, 0, 0.001) && near(l.width, 250, 2), JSON.stringify(l.crop));
  let px = await pixels([[550, 300], [300, 300]]);
  t.check('the canvas shows the crop while it is being made', rgbNear(px[0], [200, 60, 40]) && px[1][3] === 0, px.map(fmt).join(' '));

  // A shape chosen in the bar holds the frame to it.
  await bar.getByLabel('Crop shape', { exact: true }).selectOption('1:1');
  l = await layer();
  t.check('choosing a shape in the bar reshapes the frame', near(l.width, l.height, 0.01), `${l.width}x${l.height}`);
  await dragBy('se', -60, -10);
  l = await layer();
  t.check('with a shape chosen, a corner drag keeps the shape', near(l.width, l.height, 0.5) && l.width < 300, `${l.width}x${l.height}`);
  await bar.getByRole('button', { name: 'Whole picture', exact: true }).click();
  l = await layer();
  t.check('“Whole picture” removes the crop', Object.values(l.crop).every((v) => v === 0) && near(l.width, 400, 0.01));
  await bar.getByLabel('Crop shape', { exact: true }).selectOption('free');

  await dragBy('w', 100, 0);
  await page.keyboard.press('Enter');
  l = await layer();
  t.check('Enter keeps the crop and leaves crop mode', (await ui()).crop === null && (await overlay.count()) === 0 && near(l.crop.left, 0.25, 0.005));
  await page.keyboard.press('c');
  t.check('C starts cropping the selected image', (await ui()).crop === bands.id && (await overlay.isVisible()));
  await dragBy('s', 0, -100);
  t.check('the crop changes while dragging', near((await layer()).crop.bottom, 1 / 3, 0.01));
  await page.keyboard.press('Escape');
  l = await layer();
  t.check('Escape puts the crop back as it was and leaves crop mode', (await ui()).crop === null && l.crop.bottom === 0 && near(l.crop.left, 0.25, 0.005), JSON.stringify(l.crop));
  await page.keyboard.press('c');
  await page.keyboard.press('Delete');
  t.check('other keys do nothing while cropping (the layer is not deleted)', (await h.layers()).length === 1);
  await bar.getByRole('button', { name: 'Whole picture', exact: true }).click();
  await bar.getByRole('button', { name: 'Done', exact: true }).click();

  // Rotated a quarter turn: the picture's right side now faces down the canvas.
  await h.patch(bands.id, { rotation: 90 });
  await h.settle(200);
  await page.keyboard.press('c');
  const east = await handle('e');
  const centre = await toScreen(page, 400, 300);
  t.check('on a rotated layer the frame is rotated with it', east.y > centre.y + 50 && near(east.x, centre.x, 3), `handle at ${east.x.toFixed(0)},${east.y.toFixed(0)}`);
  await dragBy('e', 0, -100);
  l = await layer();
  px = await pixels([[400, 250], [400, 420]]);
  t.check('dragging it trims the side it is on', near(l.width, 300, 2) && near(l.crop.right, 0.25, 0.006) && px[0][3] === 255 && px[1][3] === 0, `${l.width}x${l.height} ${px.map(fmt).join(' ')}`);
  await page.keyboard.press('Escape');
  await h.patch(bands.id, { rotation: 0 });

  // Selecting something else ends cropping.
  await page.keyboard.press('c');
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  await h.settle(200);
  t.check('deselecting the layer ends cropping', (await ui()).crop === null && (await overlay.count()) === 0);
  await page.evaluate(() => {
    const e = window.__prysm.editor.getState();
    e.deleteLayers(e.doc.layers.map((l) => l.id));
  });
});

await section('Background removal on a plain backdrop (logos and graphics)', async () => {
  // A logo: a red body with a black outline and an enclosed white eye, two separate wings, on a backdrop colour.
  const logo = (backdrop) => `
    ctx.fillStyle = '${backdrop}'; ctx.fillRect(0, 0, w, h);
    const blob = (x, y, rx, ry, fill, line) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = line; ctx.strokeStyle = '#111111'; ctx.stroke(); };
    blob(70, 170, 35, 70, '#d92525', 6); blob(330, 170, 35, 70, '#d92525', 6);
    blob(200, 160, 80, 90, '#d92525', 6);
    blob(200, 150, 30, 35, '${backdrop}', 4);`;
  // On the canvas (picture at 200,150): body, enclosed eye, the gap between a wing and the body, a wing, and corners.
  const BODY = [400, 245];
  const EYE = [400, 300];
  const GAP = [312, 320];
  const WING = [270, 320];
  const OUTSIDE = [[205, 155], [595, 155], [205, 445], [595, 445], [400, 165], [312, 250], [488, 320], [400, 430]];
  const job = () => page.evaluate(() => window.__prysm.backgroundRemoval.getState().job);
  const remove = async () => {
    await removeBackground(page, props);
    await h.settle(400);
  };
  const cleanup = () =>
    page.evaluate(() => {
      const e = window.__prysm.editor.getState();
      e.deleteLayers(e.doc.layers.map((l) => l.id));
    });

  const white = await upload('logo.png', logo('#ffffff'), [400, 300]);
  await h.patch(white.id, { x: 200, y: 150 });
  await h.selectRow(white.id);
  const started = Date.now();
  await remove();
  const done = await job();
  t.check('a plain backdrop is recognised and removed by its colour', done.phase === 'done' && /plain background \(#ffffff\)/.test(done.message), done.message.slice(0, 90));
  t.check('it is immediate (no model involved)', Date.now() - started < 4000, `${Date.now() - started} ms`);
  let px = await pixels([BODY, EYE, WING, GAP, ...OUTSIDE]);
  t.check('the artwork is kept, in its own colours', rgbNear(px[0], [217, 37, 37], 4) && px[0][3] === 255 && rgbNear(px[2], [217, 37, 37], 4) && px[2][3] === 255, `${fmt(px[0])} ${fmt(px[2])}`);
  t.check('white enclosed by the artwork is kept (it is part of the logo)', rgbNear(px[1], [255, 255, 255], 2) && px[1][3] === 255, fmt(px[1]));
  t.check('the backdrop is gone everywhere outside it, including between the parts', px.slice(3).every((p) => p[3] === 0), px.slice(3).map((p) => p[3]).join(' '));

  // Across the left edge of the body, one row: backdrop, a pixel or two of soft edge, then the outline. No white fringe.
  const row = [];
  for (let x = 312; x <= 330; x++) row.push([x, 310]);
  px = await pixels(row);
  const soft = px.filter((p) => p[3] > 0 && p[3] < 255).length;
  const fringe = px.filter((p) => p[3] > 140 && p[0] > 190 && p[1] > 190 && p[2] > 190).length;
  const rising = px.every((p, i) => i === 0 || p[3] >= px[i - 1][3]);
  t.check('edges are clean: a short soft step, no leftover fringe of the backdrop', soft >= 1 && soft <= 3 && fringe === 0 && rising && px[0][3] === 0 && px[px.length - 1][3] === 255, `alpha along the row: ${px.map((p) => p[3]).join(' ')}`);
  const l = (await h.layers())[0];
  t.check('it is a mask on the layer (undoable, refinable); the image is untouched', l.masks.length === 1 && JSON.stringify(l.source) === JSON.stringify(white.source));
  await cleanup();

  // The same logo saved as a JPEG (noisy edges) on a coloured backdrop.
  const green = await upload('logo.jpg', logo('#2e8b57'), [400, 300], 'image/jpeg');
  await h.patch(green.id, { x: 200, y: 150 });
  await h.selectRow(green.id);
  await remove();
  px = await pixels([BODY, EYE, GAP, ...OUTSIDE]);
  t.check('a coloured backdrop and JPEG noise are handled the same way', (await job()).phase === 'done' && px[0][3] === 255 && px[0][0] > 180 && px[1][3] === 255 && px[1][1] > 110 && px.slice(2).every((p) => p[3] === 0), px.map((p) => p[3]).join(' '));

  // The method can be forced either way from the AI tools tab.
  await page.keyboard.press('Control+z');
  await h.openTab('ai');
  const method = page.getByLabel('Background removal method', { exact: true });
  await method.selectOption('subject');
  await h.selectRow(green.id);
  await remove();
  const forced = await job();
  t.check('“Find the subject” uses the model even on a plain backdrop', forced.phase === 'error' || /Background removed in/.test(forced.message), forced.message.slice(0, 80));
  if (forced.phase === 'done') await page.keyboard.press('Control+z');
  await method.selectOption('plain');
  await h.selectRow(green.id);
  await remove();
  t.check('“Plain background” removes the backdrop colour without consulting the model', /plain background/.test((await job()).message));
  await method.selectOption('auto');
  await cleanup();
});

await section('Background blur', async () => {
  const photo = await upload(
    'ball.png',
    `
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#8c8478'); g.addColorStop(1, '#5f5a52');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = 'rgba(' + (rnd() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (0.02 + rnd() * 0.05) + ')'; ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 26, 1 + rnd() * 3); }
  for (let y = 60; y < h; y += 96) { ctx.fillStyle = 'rgba(30,25,20,0.35)'; ctx.fillRect(0, y, w, 3); }
  const ball = (x, y, r) => { const s = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r); s.addColorStop(0, '#ffb08a'); s.addColorStop(0.35, '#e23a22'); s.addColorStop(1, '#6e0d08'); ctx.fillStyle = s; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  ball(400, 150, 58); ball(300, 255, 135);
`,
    [640, 480],
  );
  await h.patch(photo.id, { x: 80, y: 60 });
  await h.selectRow(photo.id);
  await h.settle(300);
  // A dark line crosses the background at canvas y = 216..218; compare it with the wall just above it.
  const lineAt = [[130, 217], [130, 206], [700, 217], [700, 206]];
  const contrast = (px) => (Math.abs(px[0][0] - px[1][0]) + Math.abs(px[2][0] - px[3][0])) / 2;
  const sharp = await pixels([...lineAt, [380, 315]]);
  const history = await state(page);
  await props.locator('[data-testid="bg-blur"]').getByRole('button', { name: 'Blur background' }).click();
  await page.waitForFunction(() => ['done', 'error'].includes(window.__prysm.backgroundRemoval.getState().job?.phase), null, { timeout: 180000 });
  await h.settle(500);
  const job = await page.evaluate(() => window.__prysm.backgroundRemoval.getState().job);
  const after = await state(page);
  const [background, subject] = after.doc.layers;
  t.check('it finishes and says what it did', job.phase === 'done' && /blur/i.test(job.message), job.message);
  t.check('the photo keeps the subject through a mask; a background layer is added underneath', after.doc.layers.length === 2 && subject.id === photo.id && subject.masks.length === 1 && background.masks.length === 0 && /blurred background/.test(background.name));
  t.check('the background sits exactly under the photo and carries an adjustable Blur effect', background.x === subject.x && background.y === subject.y && background.width === subject.width && background.height === subject.height && background.effects.some((e) => e.type === 'blur' && e.amount > 0));
  t.check('it is one undo step and the photo itself is untouched', after.past === history.past + 1 && JSON.stringify(subject.source) === JSON.stringify(photo.source));

  const blurredPx = await pixels([...lineAt, [380, 315], [222, 315], [380, 150]]);
  t.check('the background has lost its detail', contrast(sharp) > 12 && contrast(blurredPx) < contrast(sharp) * 0.35, `line contrast ${contrast(sharp).toFixed(1)} -> ${contrast(blurredPx).toFixed(1)}`);
  t.check('the subject is as sharp and as red as before', rgbNear(blurredPx[4], sharp[4], 4) && blurredPx[4][0] > 150, `${fmt(blurredPx[4])} vs ${fmt(sharp[4])}`);
  // Just left of the large ball and just above it: background, and it must not have picked up the ball's red.
  const halo = [blurredPx[5], blurredPx[6]];
  t.check('no halo of the subject’s colour around it', halo.every((p) => p[3] === 255 && p[0] < p[2] + 45), halo.map(fmt).join(' '));

  // The blur is an ordinary effect on an ordinary layer: turn it down and the wall's detail is back.
  await page.evaluate((id) => window.__prysm.editor.getState().updateLayers([id], (l) => ({ effects: l.effects.map((e) => (e.type === 'blur' ? { ...e, amount: 0 } : e)) })), background.id);
  await h.settle(500);
  const unblurred = await pixels(lineAt);
  t.check('with the blur turned down, the background’s own detail is still there', contrast(unblurred) > contrast(sharp) * 0.7, `line contrast ${contrast(unblurred).toFixed(1)}`);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await h.settle(300);
  const undone = await state(page);
  t.check('undo removes the background layer and the mask', undone.doc.layers.length === 1 && undone.doc.layers[0].masks.length === 0);
});

await section('Blend mode shortcuts', async () => {
  await page.evaluate(() => {
    const e = window.__prysm.editor.getState();
    e.deleteLayers(e.doc.layers.map((l) => l.id));
  });
  // A photo-like colour field, and over it a black shape on a white card (a "silhouette" picture).
  const under = await upload('colour.png', `ctx.fillStyle = '#e07020'; ctx.fillRect(0, 0, w, h);`, [400, 300]);
  const over = await upload('silhouette.png', `ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 100, 0, 7); ctx.fill();`, [400, 300]);
  await h.patch(under.id, { x: 200, y: 150 });
  await h.patch(over.id, { x: 200, y: 150 });
  await h.selectRow(over.id);
  const inside = [400, 300];
  const card = [230, 180];
  const before = await state(page);
  await page.keyboard.press('Alt+Shift+S');
  await h.settle(300);
  let l = await h.layerById(over.id);
  let px = await pixels([inside, card]);
  t.check('Alt + Shift + S sets Screen: the white stays white and the picture below shows through the black', l.blendMode === 'screen' && rgbNear(px[0], [224, 112, 32], 4) && rgbNear(px[1], [255, 255, 255], 2), `${l.blendMode} ${px.map(fmt).join(' ')}`);
  t.check('it is one undo step and says what it did', (await state(page)).past === before.past + 1 && /Blend mode: Screen/.test(await page.evaluate(() => window.__prysm.ui.getState().toast?.text ?? '')));
  await page.keyboard.press('Alt+Shift+M');
  await h.settle(300);
  l = await h.layerById(over.id);
  px = await pixels([inside, card]);
  t.check('Alt + Shift + M sets Multiply: the black stays black and the white disappears', l.blendMode === 'multiply' && rgbNear(px[0], [0, 0, 0], 2) && rgbNear(px[1], [224, 112, 32], 4), `${l.blendMode} ${px.map(fmt).join(' ')}`);
  await page.keyboard.press('Alt+Shift+O');
  t.check('Alt + Shift + O sets Overlay', (await h.layerById(over.id)).blendMode === 'overlay');
  await page.keyboard.press('Alt+Shift+N');
  t.check('Alt + Shift + N returns to Normal', (await h.layerById(over.id)).blendMode === 'normal');
  await h.selectRow(under.id, ['Control']);
  await page.keyboard.press('Alt+Shift+Y');
  t.check('with several layers selected, all of them change', (await h.layers()).every((x) => x.blendMode === 'luminosity'));
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  const untouched = await state(page);
  await page.keyboard.press('Alt+Shift+M');
  t.check('with nothing selected it changes nothing and says to select a layer', (await state(page)).past === untouched.past && /Select a layer/.test(await page.evaluate(() => window.__prysm.ui.getState().toast?.text ?? '')));
  await page.evaluate(() => {
    const e = window.__prysm.editor.getState();
    e.deleteLayers(e.doc.layers.map((x) => x.id));
  });
});

await section('Folded text', async () => {
  await h.openTab('text');
  await page.getByRole('button', { name: 'Add a heading' }).click();
  const [text] = await h.layers();
  await h.patch(text.id, { text: 'HHHH', fontFamily: 'Anton', fontWeight: 400, fontSize: 200, x: 100, y: 120, width: 600, align: 'center', fill: { type: 'solid', color: '#000000' } });
  await h.selectRow(text.id);
  await h.settle(1500);
  const plain = await h.stats((await h.exportPng([], { transparent: true })).buffer, { match: [115, 115, 115], tolerance: 16 });
  const effects = await openSection('Text effects');
  const before = await state(page);
  await effects.getByRole('switch', { name: 'Fold' }).click();
  await h.settle(900);
  let l = await h.layerById(text.id);
  t.check('switching on Fold stores the effect on the text, in one undo step', !!l.effects.fold && l.effects.fold.position === 0.5 && (await state(page)).past === before.past + 1 && l.text === 'HHHH');
  const folded = await h.stats((await h.exportPng([], { transparent: true })).buffer, { match: [115, 115, 115], tolerance: 16 });
  const tall0 = plain.box.bottom - plain.box.top;
  const tall1 = folded.box.bottom - folded.box.top;
  const wide0 = plain.box.right - plain.box.left;
  const wide1 = folded.box.right - folded.box.left;
  // Lower half grows by 30% and drops by 0.4 x 200 px.
  t.check('the lower half drops and grows: the word gets taller and wider', near(tall1 - tall0, 80 + (tall0 / 2) * 0.3, 14) && near(wide1 / wide0, 1.3, 0.05) && folded.box.top === plain.box.top, `height ${tall0} -> ${tall1}, width ${wide0} -> ${wide1}`);
  t.check('a lighter band joins the two halves', plain.matched < 50 && folded.matched > 4000, `${plain.matched} -> ${folded.matched} band-coloured pixels`);
  // Down the middle of the first stem: text colour, then the band, then text colour again.
  const x = plain.box.left + 12;
  const column = await pixels([[x, plain.box.top + 20], [x, plain.box.top + tall0 / 2 + 40], [folded.box.left + 16, folded.box.bottom - 20]]);
  t.check('top of the letters, band and enlarged bottom are where they should be', rgbNear(column[0], [0, 0, 0], 6) && column[0][3] === 255 && column[2][3] === 255 && rgbNear(column[2], [0, 0, 0], 6), column.map(fmt).join(' '));

  await effects.getByLabel('Drop', { exact: true }).fill('100');
  await effects.getByLabel('Spread', { exact: true }).fill('0');
  await effects.getByLabel('Band tone', { exact: true }).fill('-50');
  await h.settle(900);
  const changed = await h.stats((await h.exportPng([], { transparent: true })).buffer);
  l = await h.layerById(text.id);
  t.check('Drop, Spread and Band tone change it', near(changed.box.bottom - changed.box.top - tall0, 200, 14) && near((changed.box.right - changed.box.left) / wide0, 1, 0.03) && l.effects.fold.shade === -0.5, `height ${changed.box.bottom - changed.box.top}, width ${changed.box.right - changed.box.left}`);
  await h.patch(text.id, { text: 'HH' });
  await h.settle(900);
  const retyped = await h.stats((await h.exportPng([], { transparent: true })).buffer);
  t.check('the text stays editable: new words are folded the same way', retyped.box.right - retyped.box.left < wide0 * 0.7 && near(retyped.box.bottom - retyped.box.top, changed.box.bottom - changed.box.top, 6));
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1500);
  t.check('the fold is saved with the project', (await h.layers())[0].effects.fold?.drop === 1);
  await h.selectRow(text.id);
  const again = await openSection('Text effects');
  await again.getByRole('switch', { name: 'Fold' }).click();
  await h.settle(700);
  const off = await h.stats((await h.exportPng([], { transparent: true })).buffer);
  t.check('switching it off returns the plain text', (await h.layers())[0].effects.fold === null && near(off.box.bottom - off.box.top, tall0, 3));
  await h.openTab('text');
  await page.locator('[data-text-style]').filter({ hasText: 'FOLDED' }).first().click();
  await h.settle(900);
  const styled = (await h.layers()).at(-1);
  t.check('the FOLDED style in the Text tab adds folded text in one click', !!styled.effects.fold && styled.fontFamily === 'Anton');
});

const clearAll = () =>
  page.evaluate(() => {
    const e = window.__prysm.editor.getState();
    e.deleteLayers(e.doc.layers.map((x) => x.id));
  });
/** For each x, the first and last opaque row of an exported PNG (null where the column is empty). */
const columns = (buffer, xs) =>
  page.evaluate(
    async ({ b64, xs }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none' });
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return xs.map((x) => {
        const d = ctx.getImageData(x, 0, 1, c.height).data;
        let top = -1;
        let bottom = -1;
        for (let y = 0; y < c.height; y++) {
          if (d[y * 4 + 3] <= 128) continue;
          if (top < 0) top = y;
          bottom = y;
        }
        return top < 0 ? null : [top, bottom];
      });
    },
    { b64: buffer.toString('base64'), xs },
  );

await section('Fade: an image that becomes transparent', async () => {
  await clearAll();
  await page.evaluate(() => window.__prysm.selection.getState().set({ mode: 'new', marqueeShape: 'rect', feather: 0 }));
  const under = await upload('blue.png', `ctx.fillStyle = '#1040c0'; ctx.fillRect(0, 0, w, h);`, [400, 300]);
  const over = await upload('red.png', `ctx.fillStyle = '#d02020'; ctx.fillRect(0, 0, w, h);`, [400, 300]);
  await h.patch(under.id, { x: 200, y: 150, visible: false });
  await h.patch(over.id, { x: 200, y: 150 });
  await h.selectRow(over.id);
  const alpha = async (points) => (await pixels(points)).map((q) => q[3]);
  const fadeOf = async () => (await h.layerById(over.id)).fade;
  const dragDoc = async (from, to) => h.drag(await toScreen(page, from[0], from[1]), await toScreen(page, to[0], to[1]), 8);
  const selectionPanel = page.locator('[data-testid="selection-panel"]');
  const reverseFade = async () => {
    await (await openSection('Fade')).getByRole('switch', { name: 'Reverse the fade' }).click();
    await h.settle(400);
  };
  const fadeSwitch = props.getByRole('switch', { name: 'Fade', exact: true });
  let before = await state(page);
  await fadeSwitch.click();
  await h.settle(400);
  let l = await h.layerById(over.id);
  t.check(
    'switching on Fade stores it on the layer, in one undo step; the image is not changed',
    JSON.stringify(l.fade) === JSON.stringify({ from: ['right'], angle: null, shape: null, paint: null, start: 0.1, reach: 0.7, strength: 1, invert: false }) && (await state(page)).past === before.past + 1 && JSON.stringify(l.source) === JSON.stringify(over.source),
    JSON.stringify(l.fade),
  );
  // Across the middle of the picture, measured inwards from the right: gone for the first 10%, half-way at 40%, solid from 70%.
  const row = [220, 300, 380, 440, 500, 540, 570, 596].map((x) => [x, 300]);
  let px = await pixels(row);
  let a = px.map((q) => q[3]);
  t.check('it fades from the right: solid, then smoothly less, then gone', a[0] === 255 && a[1] === 255 && near(a[3], 128, 14) && a[6] <= 3 && a[7] === 0 && a.every((v, i) => i === 0 || v <= a[i - 1]), a.join(' '));
  t.check('its colour is unchanged where it still shows', rgbNear(px[0], [208, 32, 32], 3) && rgbNear(px[3], [208, 32, 32], 6), `${fmt(px[0])} ${fmt(px[3])}`);
  const screen = await h.screenPixels([[220, 300], [590, 300]]);
  t.check('the canvas shows it straight away', rgbNear(screen[0], [208, 32, 32], 6) && rgbNear(screen[1], [255, 255, 255], 6), screen.map(fmt).join(' '));

  await h.patch(under.id, { visible: true });
  await h.settle(300);
  px = await pixels([[220, 300], [590, 300], [440, 300]]);
  t.check('with another image underneath, the two blend into one', rgbNear(px[0], [208, 32, 32], 3) && rgbNear(px[1], [16, 64, 192], 3) && px[2][0] > 70 && px[2][0] < 160 && px[2][2] > 80, px.map(fmt).join(' '));
  await h.patch(under.id, { visible: false });
  await h.selectRow(over.id);

  const fade = await openSection('Fade');
  const part = (label) => fade.getByRole('button', { name: `Fade from ${label}`, exact: true });
  const press = async (label) => {
    await part(label).click();
    await h.settle(300);
  };
  t.check('nine places to fade from are offered: four sides, four corners, all round', (await fade.locator('[data-testid="fade-from"] button').count()) === 9 && (await part('the right').getAttribute('aria-pressed')) === 'true' && (await part('the top').getAttribute('aria-pressed')) === 'false');

  // Several sides at once.
  before = await state(page);
  await press('the top');
  a = await alpha([[220, 440], [400, 160], [590, 440], [220, 300]]);
  t.check('a second side is added to the first: here the right and the top', a[0] === 255 && a[1] <= 3 && a[2] <= 3 && near(a[3], 189, 16) && JSON.stringify((await fadeOf()).from) === '["right","top"]' && (await state(page)).past === before.past + 1, a.join(' '));
  t.check('the panel says what the fade is made of', /Fades from the top and the right\./.test(await fade.locator('[data-testid="fade-summary"]').innerText()), await fade.locator('[data-testid="fade-summary"]').innerText());
  await press('the right');
  await press('the top');
  a = await alpha([[590, 160], [220, 440]]);
  t.check('with every part switched off the image is whole, and the panel asks where to fade from', a[0] === 255 && a[1] === 255 && (await fadeOf()).from.length === 0 && /Choose where the image fades from/.test(await fade.innerText()), a.join(' '));

  // Corners.
  await press('the top left corner');
  a = await alpha([[222, 166], [590, 160], [210, 440], [580, 435], [313, 235]]);
  t.check('a corner fades only that corner, in a curve', a[0] <= 3 && a[1] === 255 && a[2] === 255 && a[3] === 255 && near(a[4], 128, 16), a.join(' '));
  await press('the bottom right corner');
  a = await alpha([[222, 166], [578, 434], [400, 300], [590, 160], [210, 440]]);
  t.check('several corners can fade at once', a[0] <= 3 && a[1] <= 3 && a[2] === 255 && a[3] === 255 && a[4] === 255, a.join(' '));
  await press('the top left corner');
  await press('the bottom right corner');

  // All round.
  await press('all round (an oval)');
  a = await alpha([[400, 300], [203, 300], [400, 153], [597, 300], [204, 154], [520, 300]]);
  t.check('“all round” keeps the middle and fades every side and corner', a[0] === 255 && a.slice(1, 5).every((v) => v <= 6) && near(a[5], 128, 16), a.join(' '));
  await fade.getByRole('switch', { name: 'Reverse the fade' }).click();
  await h.settle(300);
  a = await alpha([[400, 300], [203, 300]]);
  t.check('Reverse fades what was kept instead (here, the middle)', a[0] <= 3 && a[1] >= 250, a.join(' '));
  await fade.getByRole('switch', { name: 'Reverse the fade' }).click();
  await press('all round (an oval)');

  // Any direction.
  await fade.getByRole('switch', { name: 'Fade towards any direction' }).click();
  await h.settle(300);
  a = await alpha([[590, 440], [210, 160]]);
  t.check('“Any direction” adds a straight fade at an angle (first towards the bottom right)', a[0] <= 3 && a[1] === 255 && (await fadeOf()).angle === 45, a.join(' '));
  await slide(fade, 'Direction', 180);
  a = await alpha([[580, 300], [215, 300]]);
  t.check('Direction turns it to any angle (here, towards the left)', a[0] === 255 && a[1] <= 3, a.join(' '));

  // Where it begins, where it stops, how strong it is.
  await slide(fade, 'Begins at', 0);
  await slide(fade, 'Reaches to', 100);
  a = await alpha([[400, 300], [590, 300], [210, 300]]);
  t.check('from 0 to 100 the fade spans the whole image', near(a[0], 128, 12) && a[1] > 245 && a[2] < 10, a.join(' '));
  await slide(fade, 'Begins at', 50);
  await slide(fade, 'Reaches to', 60);
  a = await alpha([[380, 300], [450, 300]]);
  t.check('“Begins at” and “Reaches to” set where the fade begins and where it stops', a[0] <= 3 && a[1] >= 252, a.join(' '));
  await slide(fade, 'Begins at', 80);
  l = await h.layerById(over.id);
  t.check('the two cannot cross: moving one past the other pushes it along', l.fade.start === 0.8 && near(l.fade.reach, 0.82, 0.001), `${l.fade.start} ${l.fade.reach}`);
  await slide(fade, 'Strength', 50);
  a = await alpha([[210, 300], [590, 300]]);
  t.check('Strength 50 leaves the faded part half visible', near(a[0], 128, 4) && a[1] === 255, a.join(' '));
  await slide(fade, 'Strength', 10);
  a = await alpha([[210, 300]]);
  t.check('a low strength only softens it', near(a[0], 230, 4), a.join(' '));
  await slide(fade, 'Strength', 0);
  a = await alpha([[210, 300]]);
  t.check('at strength 0 nothing fades, and the fade is still there to turn up again', a[0] === 255 && (await fadeOf()).strength === 0, a.join(' '));
  await slide(fade, 'Strength', 100);
  await fade.getByRole('switch', { name: 'Fade towards any direction' }).click();
  await slide(fade, 'Begins at', 0);
  await slide(fade, 'Reaches to', 50);

  // Along a shape the user draws: a 200 px square in the middle of the picture.
  t.check('without a selection the panel explains how to draw a shape', /draw it over the image with a selection tool/.test(await fade.locator('[data-testid="fade-shape-hint"]').innerText()));
  await fade.getByRole('button', { name: 'Use the selection', exact: true }).click();
  t.check('“Use the selection” with nothing selected changes nothing and says why', (await fadeOf()).shape === null && /Nothing is selected/.test(await page.locator('[data-testid="toast"]').innerText()));
  await page.keyboard.press('m');
  await dragDoc([300, 200], [500, 400]);
  await h.settle(300);
  before = await state(page);
  await fade.getByRole('button', { name: 'Use the selection', exact: true }).click();
  await h.settle(500);
  l = await h.layerById(over.id);
  a = await alpha([[400, 300], [360, 300], [325, 300], [303, 300], [250, 300], [560, 420]]);
  t.check('the image shows inside the drawn shape and fades at its outline', a[0] === 255 && a[1] === 255 && near(a[2], 128, 24) && a[3] <= 10 && a[4] === 0 && a[5] === 0, a.join(' '));
  t.check('the shape is stored with the layer, in one undo step', !!l.fade.shape?.rasterId && l.fade.from.length === 0 && l.fade.angle === null && (await state(page)).past === before.past + 1, JSON.stringify(l.fade));
  await selectionPanel.getByRole('button', { name: 'Deselect', exact: true }).click();
  await page.keyboard.press('v');
  await h.settle(300);
  a = await alpha([[400, 300], [250, 300]]);
  t.check('it no longer needs the selection', a[0] === 255 && a[1] === 0, a.join(' '));
  await slide(fade, 'Reaches to', 100);
  a = await alpha([[400, 300], [350, 300]]);
  t.check('“Reaches to” works on the shape too: at 100 only its deepest point is untouched', a[0] >= 250 && near(a[1], 128, 24), a.join(' '));
  await slide(fade, 'Reaches to', 50);
  await h.patch(over.id, { x: 300 });
  await h.settle(300);
  a = await alpha([[500, 300], [400, 300]]);
  t.check('the shape moves with the layer', a[0] === 255 && a[1] <= 3, a.join(' '));
  await h.patch(over.id, { x: 200 });

  // Together with crop, mask and blend.
  await page.evaluate((id) => window.__prysm.editor.getState().setCrop(id, { left: 0.25, top: 0, right: 0, bottom: 0 }), over.id);
  await h.settle(300);
  a = await alpha([[250, 300], [305, 300], [400, 300], [520, 300]]);
  t.check('cropping into the shape cuts it straight; the rest of it fades as before', a[0] === 0 && a[1] === 255 && a[2] === 255 && a[3] === 0, a.join(' '));
  await page.evaluate((id) => window.__prysm.editor.getState().setCrop(id, { left: 0, top: 0, right: 0, bottom: 0 }), over.id);
  await h.settle(300);
  await press('the left');
  a = await alpha([[400, 300], [360, 300]]);
  t.check('sides can be added to the shape', a[0] === 255 && a[1] > 195 && a[1] < 245 && (await fadeOf()).shape !== null, a.join(' '));
  await press('the left');
  await page.keyboard.press('m');
  await dragDoc([380, 280], [420, 320]);
  await h.settle(300);
  await selectionPanel.getByRole('button', { name: 'Hide area', exact: true }).click();
  await h.settle(500);
  await selectionPanel.getByRole('button', { name: 'Deselect', exact: true }).click();
  await page.keyboard.press('v');
  a = await alpha([[400, 300], [360, 300], [250, 300]]);
  t.check('a mask and the fade both apply', a[0] === 0 && a[1] === 255 && a[2] === 0 && (await h.layerById(over.id)).masks.length === 1, a.join(' '));
  await h.patch(under.id, { visible: true });
  await h.patch(over.id, { blendMode: 'multiply' });
  await h.settle(400);
  px = await pixels([[360, 300], [250, 300], [400, 300]]);
  t.check('a blend mode applies to what the fade leaves', rgbNear(px[0], [13, 8, 24], 4) && rgbNear(px[1], [16, 64, 192], 3) && rgbNear(px[2], [16, 64, 192], 3), px.map(fmt).join(' '));
  await h.patch(over.id, { blendMode: 'normal' });
  await h.patch(under.id, { visible: false });
  await h.selectRow(over.id);

  await waitForSaved(page);
  const shapeId = (await fadeOf()).shape.rasterId;
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1200);
  a = await alpha([[360, 300], [250, 300], [400, 300]]);
  t.check('the fade and its shape are saved with the project', a[0] === 255 && a[1] === 0 && a[2] === 0 && (await fadeOf()).shape.rasterId === shapeId && (await fadeOf()).reach === 0.5, a.join(' '));
  await h.selectRow(over.id);
  const reopened = await openSection('Fade');
  await reopened.getByRole('button', { name: 'Remove shape', exact: true }).click();
  await h.settle(300);
  a = await alpha([[250, 300], [360, 300]]);
  t.check('“Remove shape” takes the shape away again', a[0] === 255 && a[1] === 255 && (await fadeOf()).shape === null, a.join(' '));

  // A project saved while a fade was one straight line or one oval.
  await waitForSaved(page);
  const id = (await state(page)).doc.id;
  await page.evaluate(
    ([id, overId, underId]) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('prysm');
        open.onsuccess = () => {
          const tx = open.result.transaction('projects', 'readwrite');
          const store = tx.objectStore('projects');
          const get = store.get(id);
          get.onsuccess = () => {
            const rec = get.result;
            rec.doc = {
              ...rec.doc,
              schemaVersion: 5,
              layers: rec.doc.layers.map((l) =>
                l.id === overId
                  ? { ...l, masks: [], fade: { kind: 'linear', angle: 0, start: 0.3, end: 0.9, invert: false } }
                  : l.id === underId
                    ? { ...l, fade: { kind: 'radial', angle: 0, start: 0.3, end: 1.2, invert: false } }
                    : l,
              ),
            };
            store.put(rec);
          };
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [id, over.id, under.id],
  );
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1200);
  const doc = (await state(page)).doc;
  l = await h.layerById(over.id);
  a = await alpha(row);
  t.check('a project with an earlier straight fade opens, is upgraded, and looks the same', doc.schemaVersion === 6 && l.fade.angle === 0 && near(l.fade.start, 0.1, 1e-9) && near(l.fade.reach, 0.7, 1e-9) && a[0] === 255 && a[1] === 255 && near(a[3], 128, 14) && a[6] <= 3 && a[7] === 0, `schema ${doc.schemaVersion} ${JSON.stringify(l.fade)} ${a.join(' ')}`);
  await h.patch(over.id, { visible: false });
  await h.patch(under.id, { visible: true });
  await h.settle(400);
  a = await alpha([[400, 300], [203, 300], [204, 154]]);
  const oval = (await h.layerById(under.id)).fade;
  t.check('an earlier fade “to the edges” is converted too, with edges that were not quite gone', JSON.stringify(oval.from) === '["around"]' && near(oval.start, -0.2, 1e-9) && a[0] === 255 && near(a[1], 37, 12) && a[2] <= 3, `${JSON.stringify(oval)} ${a.join(' ')}`);
  await h.patch(under.id, { visible: false, fade: null });
  await h.patch(over.id, { visible: true });

  await h.selectRow(over.id);
  await props.getByRole('switch', { name: 'Fade', exact: true }).click();
  await h.settle(300);
  a = await alpha([[220, 300], [590, 300]]);
  t.check('switching it off brings the whole image back', a[0] === 255 && a[1] === 255 && (await fadeOf()) === null, a.join(' '));

  // Painted by hand: the brush fades, the eraser brings back.
  await page.evaluate(() => {
    const tools = window.__prysm.tools.getState();
    tools.setBrush({ size: 80, hardness: 1, opacity: 1, flow: 1, smoothing: 0 });
    tools.setEraser({ size: 40, hardness: 1, opacity: 1, flow: 1, smoothing: 0 });
  });
  const mode = () => page.evaluate(() => ({ tool: window.__prysm.ui.getState().tool, painting: window.__prysm.ui.getState().fadePaintLayerId }));
  const banner = page.locator('[data-testid="fade-paint-banner"]');
  const target = page.locator('[data-testid="paint-target"]');
  const paintButton = async () => (await openSection('Fade')).getByRole('button', { name: 'Paint the fade', exact: true });
  before = await state(page);
  await (await paintButton()).click();
  await h.settle(300);
  l = await h.layerById(over.id);
  let m = await mode();
  t.check('on an image without a fade, “Paint the fade” switches one on that is painting only, and picks up the brush', !!l.fade && l.fade.from.length === 0 && l.fade.angle === null && !l.fade.paint && m.tool === 'brush' && m.painting === over.id && (await state(page)).past === before.past + 1, JSON.stringify(l.fade));
  t.check('the canvas says that the brush now paints the fade', (await banner.isVisible()) && (await target.getAttribute('data-kind')) === 'fade' && /fades the image/.test(await target.innerText()), await target.innerText());
  before = await state(page);
  await h.stroke([[260, 300], [540, 300]]);
  await h.settle(400);
  a = await alpha([[400, 300], [400, 330], [400, 350], [400, 200], [210, 300]]);
  l = await h.layerById(over.id);
  t.check('a brush stroke fades the image where it passes, and nowhere else', a[0] === 0 && a[1] <= 3 && a[2] === 255 && a[3] === 255 && a[4] === 255, a.join(' '));
  t.check('it is one undo step, kept as painting on the fade; the image itself is unchanged', (await state(page)).past === before.past + 1 && !!l.fade.paint?.rasterId && JSON.stringify(l.source) === JSON.stringify(over.source), JSON.stringify(l.fade));
  const live = await h.screenPixels([[400, 300], [400, 200]]);
  t.check('the canvas shows it', rgbNear(live[0], [255, 255, 255], 6) && rgbNear(live[1], [208, 32, 32], 6), live.map(fmt).join(' '));
  await page.evaluate(() => window.__prysm.tools.getState().setBrush({ opacity: 0.5 }));
  await h.stroke([[260, 410], [540, 410]]);
  await h.settle(400);
  a = await alpha([[400, 410]]);
  t.check('the brush’s Opacity sets how much a stroke fades (50 leaves half)', near(a[0], 128, 8), a.join(' '));
  await page.evaluate(() => window.__prysm.tools.getState().setBrush({ opacity: 1 }));

  await page.keyboard.press('e');
  await h.settle(200);
  t.check('with the eraser the bar says it brings the image back', (await mode()).tool === 'eraser' && /brings the image back/.test(await target.innerText()), await target.innerText());
  await h.stroke([[400, 260], [400, 340]]);
  await h.settle(400);
  a = await alpha([[400, 300], [300, 300]]);
  t.check('the eraser brings the image back where it passes', a[0] === 255 && a[1] === 0, a.join(' '));
  await page.keyboard.press('b');
  await page.keyboard.down('Alt');
  await h.stroke([[300, 280], [300, 320]]);
  await page.keyboard.up('Alt');
  await h.settle(400);
  a = await alpha([[300, 300], [500, 300]]);
  t.check('so does the brush with Alt held', a[0] === 255 && a[1] === 0, a.join(' '));

  // Together with the rest of the fade, and with a crop.
  let painted = await openSection('Fade');
  t.check('the panel lists the painting as part of the fade', /Fades from where you painted\./.test(await painted.locator('[data-testid="fade-summary"]').innerText()), await painted.locator('[data-testid="fade-summary"]').innerText());
  await slide(painted, 'Strength', 50);
  a = await alpha([[500, 300]]);
  t.check('Strength applies to the painting too', near(a[0], 128, 4), a.join(' '));
  await slide(painted, 'Strength', 100);
  await painted.getByRole('switch', { name: 'Reverse the fade' }).click();
  await h.settle(300);
  a = await alpha([[500, 300], [400, 200]]);
  t.check('reversed, only what was painted stays', a[0] === 255 && a[1] === 0, a.join(' '));
  await painted.getByRole('switch', { name: 'Reverse the fade' }).click();
  await painted.getByRole('button', { name: 'Fade from the right', exact: true }).click();
  await h.settle(300);
  a = await alpha([[590, 200], [500, 300], [260, 200]]);
  t.check('sides and painting combine', a[0] <= 3 && a[1] === 0 && a[2] === 255, a.join(' '));
  await painted.getByRole('button', { name: 'Fade from the right', exact: true }).click();
  await page.evaluate((id) => window.__prysm.editor.getState().setCrop(id, { left: 0.25, top: 0, right: 0, bottom: 0 }), over.id);
  await h.settle(300);
  a = await alpha([[250, 300], [500, 300], [400, 200]]);
  t.check('after a crop the painting is still on the same part of the picture', a[0] === 0 && a[1] === 0 && a[2] === 255, a.join(' '));
  await page.evaluate((id) => window.__prysm.editor.getState().setCrop(id, { left: 0, top: 0, right: 0, bottom: 0 }), over.id);
  await h.settle(300);

  // Leaving the mode.
  await painted.getByRole('button', { name: 'Done painting', exact: true }).click();
  m = await mode();
  a = await alpha([[500, 300]]);
  t.check('“Done painting” returns to the Move tool and keeps what was painted', m.tool === 'move' && m.painting === null && (await banner.count()) === 0 && a[0] === 0, JSON.stringify(m));
  await (await paintButton()).click();
  await banner.getByRole('button', { name: 'Done', exact: true }).click();
  t.check('so does Done in the bar over the canvas', (await mode()).painting === null);
  await (await paintButton()).click();
  await page.keyboard.press('Escape');
  t.check('and Escape', (await mode()).painting === null);
  await (await paintButton()).click();
  await h.selectRow(under.id);
  t.check('selecting another layer ends it too, so a stroke can never land on the wrong fade', (await mode()).painting === null);
  await page.keyboard.press('v');
  await h.selectRow(over.id);

  await waitForSaved(page);
  const paintId = (await fadeOf()).paint.rasterId;
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1200);
  a = await alpha([[500, 300], [400, 200]]);
  t.check('the painting is saved with the project', a[0] === 0 && a[1] === 255 && (await fadeOf()).paint.rasterId === paintId, a.join(' '));
  await h.selectRow(over.id);
  painted = await openSection('Fade');
  await painted.getByRole('button', { name: 'Clear painting', exact: true }).click();
  await h.settle(300);
  a = await alpha([[500, 300]]);
  t.check('“Clear painting” removes it', a[0] === 255 && (await fadeOf()).paint === null, a.join(' '));
  await props.getByRole('switch', { name: 'Fade', exact: true }).click();
  await h.settle(300);

  // The same from the Selection panel, starting with no fade at all.
  await page.keyboard.press('m');
  await dragDoc([20, 20], [120, 120]);
  await h.settle(300);
  await selectionPanel.getByRole('button', { name: 'Fade along selection', exact: true }).click();
  await h.settle(300);
  t.check('a selection beside the image is refused, with the reason', (await fadeOf()) === null && /does not touch/.test(await page.locator('[data-testid="toast"]').innerText()));
  await dragDoc([300, 200], [500, 400]);
  await h.settle(300);
  before = await state(page);
  await selectionPanel.getByRole('button', { name: 'Fade along selection', exact: true }).click();
  await h.settle(500);
  a = await alpha([[400, 300], [310, 300], [250, 300]]);
  l = await h.layerById(over.id);
  t.check('“Fade along selection” switches the fade on with that shape, in one undo step', a[0] === 255 && a[1] <= 3 && a[2] === 0 && !!l.fade?.shape && l.fade.from.length === 0 && (await state(page)).past === before.past + 1, a.join(' '));
  await page.keyboard.press('Control+z');
  await h.settle(300);
  a = await alpha([[250, 300]]);
  t.check('and undo removes it', a[0] === 255 && !(await fadeOf()));

  // Expanding the picture replaces its image; the shape has to stay where it was drawn.
  await selectionPanel.getByRole('button', { name: 'Fade along selection', exact: true }).click();
  await h.settle(300);
  await selectionPanel.getByRole('button', { name: 'Deselect', exact: true }).click();
  await page.keyboard.press('v');
  await page.evaluate(() => window.__prysm.tools.getState().setBrush({ size: 20, hardness: 1, opacity: 1, flow: 1, smoothing: 0 }));
  await (await paintButton()).click();
  await h.stroke([[385, 300], [415, 300]]);
  await h.settle(300);
  await banner.getByRole('button', { name: 'Done', exact: true }).click();
  const shapeBefore = (await fadeOf()).shape.rasterId;
  const paintBefore = (await fadeOf()).paint.rasterId;
  const expand = await openSection('Expand');
  await expand.getByRole('button', { name: 'Fill the canvas', exact: true }).click();
  await page.waitForFunction((id) => window.__prysm.local.getState().job === null && window.__prysm.editor.getState().doc.layers.find((x) => x.id === id).width === 800, over.id, { timeout: 120000 });
  await h.settle(800);
  l = await h.layerById(over.id);
  a = await alpha([[400, 322], [310, 300], [250, 300], [100, 100], [700, 500], [400, 300]]);
  t.check('after Expand the shape is where it was, and the new border lies outside it', l.width === 800 && l.height === 600 && l.fade.shape.rasterId !== shapeBefore && a[0] === 255 && a[1] <= 3 && a[2] === 0 && a[3] === 0 && a[4] === 0, `${l.width}x${l.height} ${a.join(' ')}`);
  t.check('and so is what was painted', l.fade.paint.rasterId !== paintBefore && a[5] <= 3, a.join(' '));
  await reverseFade();
  a = await alpha([[400, 322], [250, 300], [100, 100], [400, 300]]);
  t.check('reversed, the expanded picture shows everywhere but inside the shape (and where it was painted)', a[0] <= 3 && a[1] === 255 && a[2] === 255 && a[3] === 255, a.join(' '));
  await clearAll();
});

await section('Text in the shape of a layer', async () => {
  await h.openTab('elements');
  await page.locator('[title="Circle"]').first().click();
  const [ellipse] = await h.layers();
  await h.patch(ellipse.id, { x: 200, y: 150, width: 400, height: 300 });
  await h.openTab('text');
  await page.getByRole('button', { name: 'Add a heading' }).click();
  const text = (await h.layers()).at(-1);
  await h.patch(text.id, { text: 'IIIIIIII', fontFamily: 'Anton', fontWeight: 400, fontSize: 80, fill: { type: 'solid', color: '#000000' } });
  await h.selectRow(text.id);
  await h.settle(1200);
  const warp = await openSection('Warp');
  const fit = warp.locator('[data-testid="fit-to-shape"]');
  t.check('the layer under the text is offered as the shape to follow', (await fit.getByLabel('Layer to take the shape from').inputValue()) === ellipse.id);
  const before = await state(page);
  await fit.getByRole('button', { name: 'Fit text to this shape' }).click();
  await h.settle(1200);
  let l = await h.layerById(text.id);
  t.check('fitting stores the outline on the text as a warp, in one undo step; the text is still text', l.warp?.style === 'shape' && l.warp.shape.top.length === 160 && l.warp.shape.bottom.length === 160 && l.text === 'IIIIIIII' && (await state(page)).past === before.past + 1);
  t.check('the text is moved and sized over the shape', near(l.x, 200, 3) && near(l.y, 150, 3) && near(l.width, 400, 4) && l.rotation === 0, `${l.x.toFixed(1)},${l.y.toFixed(1)} ${l.width.toFixed(1)} wide`);
  t.check('the Warp section says what it is', (await warp.getByLabel('Warp shape', { exact: true }).inputValue()) === 'shape' && /fills the outline of another layer/.test(await warp.innerText()));

  // With the ellipse hidden, the letters alone must trace it: every stroke runs from its top edge to its bottom edge.
  await h.patch(ellipse.id, { visible: false });
  await h.settle(600);
  const xs = [];
  for (let x = 215; x <= 585; x += 5) xs.push(x);
  const shot = await h.exportPng([], { transparent: true });
  const cols = await columns(shot.buffer, xs);
  const edge = (x) => 150 * Math.sqrt(Math.max(0, 1 - ((x - 400) / 200) ** 2));
  let inked = 0;
  let onShape = 0;
  cols.forEach((c, i) => {
    if (!c) return;
    inked++;
    if (Math.abs(c[0] - (300 - edge(xs[i]))) <= 9 && Math.abs(c[1] - (300 + edge(xs[i]))) <= 9) onShape++;
  });
  const box = (await h.stats(shot.buffer)).box;
  t.check('the letters fill the shape from edge to edge', inked > 25 && onShape / inked > 0.9, `${onShape} of ${inked} letter columns reach the outline at top and bottom`);
  t.check('the word spans the whole shape', near(box.left, 200, 8) && near(box.right, 600, 8) && near(box.top, 150, 8) && near(box.bottom, 450, 8), JSON.stringify(box));

  await h.patch(text.id, { text: 'III' });
  await h.settle(1200);
  const retyped = (await h.stats((await h.exportPng([], { transparent: true })).buffer)).box;
  t.check('retyped text fills the same shape', near(retyped.left, 200, 12) && near(retyped.right, 600, 12) && near(retyped.top, 150, 10) && near(retyped.bottom, 450, 10), JSON.stringify(retyped));

  // A cut-out picture: a triangle on a transparent background, pointing right.
  const tri = await upload('wedge.png', `ctx.fillStyle = '#208040'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, h / 2); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();`, [400, 300]);
  await h.patch(tri.id, { x: 100, y: 100, width: 600, height: 400 });
  await h.patch(text.id, { text: 'IIIIIIII' });
  await h.selectRow(text.id);
  const again = await openSection('Warp');
  await again.getByLabel('Layer to take the shape from').selectOption(tri.id);
  await again.getByRole('button', { name: 'Fit to this shape again' }).click();
  await h.settle(1200);
  await h.patch(tri.id, { visible: false });
  await h.settle(600);
  const wedge = await columns((await h.exportPng([], { transparent: true })).buffer, xs.map((x) => Math.round(100 + ((x - 215) / 370) * 560 + 15)));
  const heights = wedge.filter(Boolean).map((c) => c[1] - c[0]);
  t.check('it follows the outline of a picture too: tall where the picture is tall, short where it narrows', heights.length > 20 && heights[0] > 330 && heights.at(-1) < 90 && heights.every((v, i) => i === 0 || v <= heights[i - 1] + 6), `heights from ${heights[0]} down to ${heights.at(-1)}`);

  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1500);
  t.check('the shaped text is saved with the project', (await h.layerById(text.id)).warp?.style === 'shape');
  await h.selectRow(text.id);
  const last = await openSection('Warp');
  await last.getByRole('button', { name: 'Remove warp', exact: true }).click();
  t.check('“Remove warp” returns plain text', (await h.layerById(text.id)).warp === null);
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  await clearAll();
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
