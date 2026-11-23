/**
 * Selection tools: marquee (rectangle, ellipse), lasso, magic wand, subject selection, and what a
 * selection is used for (layer masks, copies, fills, constrained painting).
 * Driven through the real interface; selections are measured on their coverage bitmap and their
 * effect on exported pixels.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, toScreen, view, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);

const tool = () => page.evaluate(() => window.__prysm.ui.getState().tool);
const options = page.locator('[data-testid="selection-options"]');
const actions = page.locator('[data-testid="selection-actions"]');
const panel = page.locator('[data-testid="selection-panel"]');

/** The selection as the editor holds it, plus how selected a list of document points is. */
const sel = (points = []) =>
  page.evaluate((points) => {
    const s = window.__prysm.selection.getState();
    const { doc } = window.__prysm.editor.getState();
    if (!s.mask) return { active: false, coverage: 0, bounds: null, at: points.map(() => 0), mode: s.mode, shape: s.marqueeShape };
    const k = s.mask.width / doc.width;
    const ctx = s.mask.getContext('2d', { willReadFrequently: true });
    return {
      active: true,
      coverage: s.coverage,
      bounds: s.bounds,
      at: points.map(([x, y]) => ctx.getImageData(Math.floor(x * k), Math.floor(y * k), 1, 1).data[3] / 255),
      mode: s.mode,
      shape: s.marqueeShape,
    };
  }, points);

/** Pixels of the moving outline: how many are drawn, and a signature that changes as it animates. */
const outline = () =>
  page.evaluate(() => {
    const c = document.querySelector('[data-testid="selection-outline"]');
    const { data } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    let drawn = 0;
    let signature = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 128) {
        drawn++;
        signature = (signature + (data[i] + 1) * ((i / 4) % 9973)) % 2147483647;
      }
    }
    return { drawn, signature, active: c.dataset.active, dpr: c.width / c.clientWidth };
  });

async function dragDoc(from, to, modifiers = [], steps = 8) {
  const a = await toScreen(page, from[0], from[1]);
  const b = await toScreen(page, to[0], to[1]);
  for (const m of modifiers) await page.keyboard.down(m);
  await h.drag(a, b, steps);
  for (const m of modifiers) await page.keyboard.up(m);
}
async function clickDoc(point, modifiers = []) {
  const p = await toScreen(page, point[0], point[1]);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of modifiers) await page.keyboard.up(m);
  await h.settle(250);
}
/** Draws a path through document points with the active tool. */
async function path(points) {
  const first = await toScreen(page, points[0][0], points[0][1]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i++) {
    const a = await toScreen(page, points[i - 1][0], points[i - 1][1]);
    const b = await toScreen(page, points[i][0], points[i][1]);
    for (let k = 1; k <= 12; k++) await page.mouse.move(a.x + ((b.x - a.x) * k) / 12, a.y + ((b.y - a.y) * k) / 12);
  }
  await page.mouse.up();
  await h.settle();
}
const alphaAt = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const AREA = 800 * 600;
const share = (pixels) => pixels / AREA;
const boundsNear = (b, x, y, w, hgt, tol = 2) => !!b && near(b.x, x, tol) && near(b.y, y, tol) && near(b.width, w, tol) && near(b.height, hgt, tol);
const describe = (s) => (s.bounds ? `${s.bounds.x.toFixed(0)},${s.bounds.y.toFixed(0)} ${s.bounds.width.toFixed(0)}x${s.bounds.height.toFixed(0)}, ${(s.coverage * 100).toFixed(2)}%` : 'nothing selected');

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

let A; // 400x300, left half red, right half blue, at (200,150)
let B; // 200x200 green, at (20,380)

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  A = await upload('halves.png', `ctx.fillStyle='#ff0000';ctx.fillRect(0,0,w/2,h);ctx.fillStyle='#0000ff';ctx.fillRect(w/2,0,w/2,h);`, [400, 300]);
  B = await upload('green.png', `ctx.fillStyle='#00c800';ctx.fillRect(0,0,w,h);`, [200, 200]);
  await h.patch(A.id, { x: 200, y: 150 });
  await h.patch(B.id, { x: 20, y: 380 });
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  t.check('two images on an 800x600 canvas', A.width === 400 && B.width === 200);
});

await section('Tools and shortcuts', async () => {
  for (const [label, id] of [['Marquee', 'marquee'], ['Lasso', 'lasso'], ['Magic wand', 'wand']]) {
    await page.getByRole('button', { name: new RegExp(`^${label} \\(`) }).click();
    t.check(`the ${label.toLowerCase()} button selects the tool`, (await tool()) === id);
  }
  await page.keyboard.press('v');
  t.check('no selection controls while nothing is selected and no selection tool is active', (await options.count()) === 0 && (await panel.count()) === 0);
  await page.keyboard.press('m');
  t.check('M selects the marquee and shows its options and the selection panel', (await tool()) === 'marquee' && (await options.isVisible()) && (await panel.isVisible()) && (await actions.count()) === 0);
  await page.keyboard.press('m');
  t.check('M again switches to the ellipse', (await sel()).shape === 'ellipse');
  await page.keyboard.press('m');
  t.check('and back to the rectangle', (await sel()).shape === 'rect');
  await page.keyboard.press('l');
  t.check('L selects the lasso', (await tool()) === 'lasso');
  await page.keyboard.press('w');
  t.check('W selects the magic wand', (await tool()) === 'wand');
  await page.keyboard.press('Escape');
  t.check('Escape with nothing selected returns to the move tool', (await tool()) === 'move');
});

await section('Rectangle marquee', async () => {
  const before = await state(page);
  await page.keyboard.press('m');
  await dragDoc([250, 200], [450, 350]);
  let s = await sel([[350, 275], [240, 190], [460, 360]]);
  t.check('dragging selects that rectangle', boundsNear(s.bounds, 250, 200, 200, 150) && near(s.coverage, share(200 * 150), 0.002), describe(s));
  t.check('inside is selected, outside is not', s.at[0] === 1 && s.at[1] === 0 && s.at[2] === 0, s.at.join(' '));
  t.check('the panel shows the size of the selection', /^20[01] × 15[01] px$/.test((await page.locator('[data-testid="selection-size"]').innerText()).trim()), await page.locator('[data-testid="selection-size"]').innerText());
  const after = await state(page);
  t.check('selecting does not change the document or its history', after.past === before.past && after.doc.layers.length === before.doc.layers.length);

  // The outline: a one-pixel ring around the selection that keeps moving.
  await h.settle(200);
  const { zoom } = await view(page);
  const o1 = await outline();
  const perimeter = 2 * (200 + 150) * zoom * o1.dpr * Math.max(1, Math.round(o1.dpr));
  t.check('an outline is drawn around the selection', o1.active === 'true' && o1.drawn > perimeter * 0.7 && o1.drawn < perimeter * 1.5, `${o1.drawn} px drawn, perimeter about ${Math.round(perimeter)}`);
  await h.settle(350);
  const o2 = await outline();
  t.check('the outline animates', o2.signature !== o1.signature && near(o2.drawn, o1.drawn, o1.drawn * 0.05));
  await page.keyboard.press('Control+=');
  await h.settle(250);
  const o3 = await outline();
  t.check('the outline follows the zoom and stays one pixel wide', near(o3.drawn / o1.drawn, 1.25, 0.12), `${o1.drawn} -> ${o3.drawn}`);
  await page.keyboard.press('Control+0');
  await h.settle(200);

  await dragDoc([500, 400], [600, 500], ['Shift']);
  s = await sel([[550, 450], [350, 275]]);
  t.check('Shift adds to the selection', near(s.coverage, share(200 * 150 + 100 * 100), 0.002) && s.at[0] === 1 && s.at[1] === 1, describe(s));
  await dragDoc([300, 225], [400, 325], ['Alt']);
  s = await sel([[350, 275], [270, 210]]);
  t.check('Alt subtracts from it', near(s.coverage, share(200 * 150 + 100 * 100 - 100 * 100), 0.002) && s.at[0] === 0 && s.at[1] === 1, describe(s));
  await dragDoc([200, 150], [300, 600], ['Shift', 'Alt']);
  s = await sel([[270, 210], [550, 450]]);
  t.check('Shift+Alt keeps only the overlap', boundsNear(s.bounds, 250, 200, 50, 150) && s.at[0] === 1 && s.at[1] === 0, describe(s));

  await options.getByRole('button', { name: 'Add', exact: true }).click();
  await dragDoc([600, 100], [700, 200]);
  s = await sel([[650, 150], [270, 210]]);
  t.check('the Add mode does the same without a key held', s.at[0] === 1 && s.at[1] === 1 && near(s.coverage, share(50 * 150 + 100 * 100), 0.002), describe(s));
  await options.getByRole('button', { name: 'New', exact: true }).click();

  await clickDoc([100, 100]);
  t.check('a click without dragging deselects', !(await sel()).active && (await actions.count()) === 0);
  t.check('with nothing selected the outline is cleared', (await outline()).drawn === 0);
});

await section('Select all, invert, deselect', async () => {
  await page.keyboard.press('Control+a');
  let s = await sel();
  t.check('Ctrl+A with a selection tool selects the whole canvas', near(s.coverage, 1, 0.001) && (await state(page)).selectedIds.length === 0, describe(s));
  await dragDoc([100, 100], [300, 250]);
  await page.keyboard.press('Control+Shift+I');
  s = await sel([[200, 175], [600, 400]]);
  t.check('Ctrl+Shift+I inverts the selection', near(s.coverage, 1 - share(200 * 150), 0.002) && s.at[0] === 0 && s.at[1] === 1, describe(s));
  await actions.getByRole('button', { name: 'Invert', exact: true }).click();
  s = await sel([[200, 175]]);
  t.check('the Invert button does the same', near(s.coverage, share(200 * 150), 0.002) && s.at[0] === 1, describe(s));

  await h.selectRow(B.id);
  const layersBefore = (await h.layers()).length;
  await page.keyboard.press('Control+d');
  t.check('Ctrl+D deselects the area and leaves the layers alone', !(await sel()).active && (await h.layers()).length === layersBefore);
  await page.keyboard.press('Control+d');
  t.check('with no area selected, Ctrl+D still duplicates the layer', (await h.layers()).length === layersBefore + 1);
  await page.keyboard.press('Control+z');
  t.check('and that is undone as before', (await h.layers()).length === layersBefore);

  await dragDoc([100, 100], [300, 250]);
  await actions.getByRole('button', { name: 'Deselect', exact: true }).click();
  t.check('the Deselect button clears the selection', !(await sel()).active);
  await dragDoc([100, 100], [300, 250]);
  await page.keyboard.press('Escape');
  t.check('Escape clears the selection first and keeps the tool', !(await sel()).active && (await tool()) === 'marquee');
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
});

await section('Ellipse and lasso', async () => {
  await options.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await dragDoc([200, 100], [600, 500]);
  let s = await sel([[400, 300], [215, 115], [400, 110]]);
  t.check('the ellipse marquee selects an ellipse', near(s.coverage, share(Math.PI * 200 * 200), 0.004) && s.at[0] === 1 && s.at[1] === 0 && s.at[2] === 1, describe(s));
  await options.getByRole('button', { name: 'Rectangle', exact: true }).click();

  await page.keyboard.press('l');
  await path([[300, 100], [500, 400], [100, 400], [300, 100]]);
  s = await sel([[300, 300], [150, 150], [450, 150]]);
  t.check('the lasso selects the area drawn around', near(s.coverage, share(0.5 * 400 * 300), 0.006) && s.at[0] === 1 && s.at[1] === 0 && s.at[2] === 0, describe(s));
  await path([[280, 280], [320, 280], [320, 320], [280, 320], [280, 280]].map(([x, y]) => [x, y]));
  s = await sel([[300, 300]]);
  t.check('a new lasso replaces the selection', near(s.coverage, share(40 * 40), 0.002) && s.at[0] === 1, describe(s));
  await page.keyboard.press('Control+d');
});

await section('Soft edges and refining', async () => {
  await page.keyboard.press('m');
  await h.setField('Feather', 20, options);
  await dragDoc([200, 150], [600, 450]);
  let s = await sel([[400, 300], [200, 300], [130, 300], [270, 300]]);
  t.check('feather gives the selection a soft edge', s.at[0] === 1 && s.at[1] > 0.35 && s.at[1] < 0.65 && s.at[2] === 0 && s.at[3] === 1, s.at.map((v) => v.toFixed(2)).join(' '));
  await h.setField('Feather', 0, options);

  await dragDoc([300, 200], [500, 350]);
  await actions.getByRole('button', { name: 'Expand', exact: true }).click();
  s = await sel();
  t.check('Expand moves the edge outwards by the amount', boundsNear(s.bounds, 292, 192, 216, 166, 3), describe(s));
  await h.setField('Refine amount', 20, actions);
  await actions.getByRole('button', { name: 'Contract', exact: true }).click();
  s = await sel();
  t.check('Contract moves it inwards', boundsNear(s.bounds, 312, 212, 176, 126, 4), describe(s));
  await actions.getByRole('button', { name: 'Feather', exact: true }).click();
  s = await sel([[400, 275], [312, 275], [250, 275]]);
  t.check('Feather softens the edge of an existing selection', s.at[0] === 1 && s.at[1] > 0.3 && s.at[1] < 0.7 && s.at[2] === 0, s.at.map((v) => v.toFixed(2)).join(' '));
  await h.setField('Refine amount', 8, actions);
  await page.keyboard.press('Control+d');
});

await section('Magic wand', async () => {
  await page.keyboard.press('w');
  await clickDoc([300, 300]);
  let s = await sel([[300, 300], [500, 300], [100, 100]]);
  t.check('a click selects the connected area of that colour', boundsNear(s.bounds, 200, 150, 200, 300) && near(s.coverage, share(200 * 300), 0.003) && s.at[0] === 1 && s.at[1] === 0 && s.at[2] === 0, describe(s));
  await clickDoc([500, 300], ['Shift']);
  s = await sel([[300, 300], [500, 300]]);
  t.check('Shift+click adds another colour area', near(s.coverage, share(400 * 300), 0.004) && s.at[0] === 1 && s.at[1] === 1, describe(s));
  await clickDoc([300, 300], ['Alt']);
  s = await sel([[300, 300], [500, 300]]);
  t.check('Alt+click subtracts one', near(s.coverage, share(200 * 300), 0.004) && s.at[0] === 0 && s.at[1] === 1, describe(s));

  await h.setField('Tolerance', 255, options);
  await clickDoc([300, 300]);
  t.check('at full tolerance everything matches', near((await sel()).coverage, 1, 0.001));
  await h.setField('Tolerance', 0, options);
  await clickDoc([300, 300]);
  t.check('at zero tolerance only the exact colour matches', near((await sel()).coverage, share(200 * 300), 0.003), describe(await sel()));
  await h.setField('Tolerance', 32, options);

  // A tall image splits the white background into a left and a right part.
  await h.patch(A.id, { x: 300, y: 0, width: 200, height: 600 });
  await h.settle(200);
  await clickDoc([700, 300]);
  s = await sel([[700, 300], [250, 100]]);
  t.check('contiguous: only the connected part of the background', near(s.coverage, share(300 * 600), 0.003) && s.at[0] === 1 && s.at[1] === 0, describe(s));
  await options.getByRole('switch', { name: 'Contiguous' }).click();
  await clickDoc([700, 300]);
  s = await sel([[700, 300], [250, 100], [100, 450]]);
  t.check('not contiguous: every area of that colour', near(s.coverage, share(300 * 600 + 300 * 600 - 200 * 200), 0.004) && s.at[1] === 1 && s.at[2] === 0, describe(s));
  await options.getByRole('switch', { name: 'Contiguous' }).click();
  await h.patch(A.id, { x: 200, y: 150, width: 400, height: 300 });
  await h.settle(200);

  // Sampling one layer ignores what is around and under it.
  await h.selectRow(B.id);
  await options.getByRole('button', { name: 'This layer', exact: true }).click();
  await clickDoc([120, 480]);
  s = await sel([[120, 480], [300, 300]]);
  t.check('“This layer” selects from the selected layer only', boundsNear(s.bounds, 20, 380, 200, 200) && s.at[0] === 1 && s.at[1] === 0, describe(s));
  await clickDoc([700, 100]);
  s = await sel([[700, 100], [300, 300], [120, 480]]);
  t.check('clicking outside that layer selects the empty area around it', near(s.coverage, 1 - share(200 * 200), 0.003) && s.at[1] === 1 && s.at[2] === 0, describe(s));
  await options.getByRole('button', { name: 'All layers', exact: true }).click();

  await panel.getByRole('button', { name: 'Select layer', exact: true }).click();
  s = await sel([[120, 480], [300, 300]]);
  t.check('“Select layer” selects what the layer draws', boundsNear(s.bounds, 20, 380, 200, 200) && near(s.coverage, share(200 * 200), 0.002), describe(s));
  await page.keyboard.press('Control+d');
});

await section('Selection to layer mask', async () => {
  await page.keyboard.press('m');
  await h.selectRow(A.id);
  await dragDoc([250, 200], [450, 350]);
  t.check('the panel names the layer the commands act on', /halves/.test(await page.locator('[data-testid="selection-target"]').innerText()));
  const before = await state(page);
  await actions.getByRole('button', { name: 'Mask to selection', exact: true }).click();
  await h.settle(300);
  let a = await h.layerById(A.id);
  t.check('the layer gets a mask', a.masks.length === 1 && a.masks[0].enabled);
  t.check('the image itself is untouched', JSON.stringify(a.source) === JSON.stringify(A.source));
  t.check('it is one undo step', (await state(page)).past === before.past + 1);
  let px = await alphaAt([[300, 250], [430, 330], [220, 170], [500, 400]]);
  t.check('the layer shows only inside the selection', rgbNear(px[0], [255, 0, 0]) && px[0][3] === 255 && rgbNear(px[1], [0, 0, 255]) && px[2][3] === 0 && px[3][3] === 0, px.map(fmt).join(' '));
  t.check('the selection is still there afterwards', (await sel()).active);

  // A second selection narrows the same mask.
  await dragDoc([300, 225], [350, 275]);
  await actions.getByRole('button', { name: 'Hide area', exact: true }).click();
  await h.settle(300);
  px = await alphaAt([[325, 250], [270, 220], [430, 330]]);
  t.check('“Hide area” cuts a hole in the existing mask', px[0][3] === 0 && rgbNear(px[1], [255, 0, 0]) && px[1][3] === 255 && rgbNear(px[2], [0, 0, 255]), px.map(fmt).join(' '));
  a = await h.layerById(A.id);
  t.check('still one mask on the layer', a.masks.length === 1);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await h.settle(200);
  t.check('undo twice removes the mask again', (await h.layerById(A.id)).masks.length === 0);

  // Delete with a selection tool clears the area, not the layer.
  await dragDoc([200, 150], [400, 450]);
  const count = (await h.layers()).length;
  await page.keyboard.press('Delete');
  await h.settle(300);
  px = await alphaAt([[300, 300], [500, 300]]);
  t.check('Delete hides the selected area through a mask', (await h.layers()).length === count && px[0][3] === 0 && rgbNear(px[1], [0, 0, 255]) && px[1][3] === 255, px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');
  await h.settle(200);

  // The selection is in canvas space; the mask is in the image's own space. A rotated layer shows the difference.
  await h.patch(A.id, { rotation: 30 });
  await h.settle(200);
  await dragDoc([350, 250], [450, 350]);
  await actions.getByRole('button', { name: 'Mask to selection', exact: true }).click();
  await h.settle(300);
  px = await alphaAt([[400, 300], [360, 340], [300, 300], [470, 300], [400, 230]]);
  t.check('on a rotated layer the mask still matches the selection on the canvas', px[0][3] === 255 && px[1][3] === 255 && px[2][3] === 0 && px[3][3] === 0 && px[4][3] === 0, px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');
  await h.patch(A.id, { rotation: 0 });
  await h.settle(200);

  await h.selectRow(B.id);
  await h.selectRow(A.id, ['Control']);
  t.check('with two layers selected the layer commands are disabled and say why', (await actions.getByRole('button', { name: 'Mask to selection', exact: true }).isDisabled()) && /No image layer/.test(await page.locator('[data-testid="selection-target"]').innerText()));
  await page.keyboard.press('Control+d');
});

await section('Copy and cut to a new layer', async () => {
  await h.selectRow(A.id);
  await dragDoc([350, 200], [450, 300]);
  const reference = await alphaAt([[400, 250], [300, 300], [500, 400]]);
  const before = await state(page);
  await page.keyboard.press('Control+j');
  await h.settle(300);
  let ls = await h.layers();
  const copy = ls.find((l) => /\(selection\)$/.test(l.name));
  t.check('Ctrl+J copies the selected area to a new layer', !!copy && ls.length === before.doc.layers.length + 1 && (await state(page)).past === before.past + 1);
  t.check('the copy sits directly above the original and is selected', ls.findIndex((l) => l.id === copy.id) === ls.findIndex((l) => l.id === A.id) + 1 && (await state(page)).selectedIds[0] === copy.id);
  t.check('the original has no mask (nothing was removed from it)', (await h.layerById(A.id)).masks.length === 0);
  await h.patch(A.id, { visible: false });
  await h.settle(200);
  let px = await alphaAt([[375, 250], [425, 250], [300, 300], [500, 400]]);
  t.check('the copy holds just the selected pixels', rgbNear(px[0], [255, 0, 0]) && px[0][3] === 255 && rgbNear(px[1], [0, 0, 255]) && px[2][3] === 0 && px[3][3] === 0, px.map(fmt).join(' '));
  await h.patch(A.id, { visible: true });
  await page.keyboard.press('Control+z'); // visible
  await page.keyboard.press('Control+z'); // hidden
  await page.keyboard.press('Control+z'); // the copy
  await h.settle(200);
  t.check('undo removes the copy', (await h.layers()).length === before.doc.layers.length);

  await h.selectRow(A.id);
  await actions.getByRole('button', { name: 'Cut to layer', exact: true }).click();
  await h.settle(300);
  ls = await h.layers();
  const cut = ls.find((l) => /\(selection\)$/.test(l.name));
  t.check('“Cut to layer” is one undo step', !!cut && (await state(page)).past === before.past + 1);
  px = await alphaAt([[400, 250], [300, 300], [500, 400]]);
  t.check('the design looks the same after cutting', px.every((p, i) => rgbNear(p, reference[i]) && p[3] === reference[i][3]), px.map(fmt).join(' '));
  await h.patch(cut.id, { visible: false });
  await h.settle(200);
  px = await alphaAt([[400, 250], [300, 300]]);
  t.check('the original now has a hole where the selection was', px[0][3] === 0 && rgbNear(px[1], [255, 0, 0]) && px[1][3] === 255, px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await h.settle(200);
  t.check('undo restores the original', (await h.layers()).length === before.doc.layers.length && (await h.layerById(A.id)).masks.length === 0);
  await page.keyboard.press('Control+d');
});

await section('Fill and painting inside a selection', async () => {
  await page.evaluate(() => window.__prysm.tools.getState().set({ color: '#00ffff' }));
  await options.getByRole('button', { name: 'Ellipse', exact: true }).click();
  await dragDoc([600, 20], [760, 140]);
  const before = await state(page);
  await actions.getByRole('button', { name: 'Fill', exact: true }).click();
  await h.settle(300);
  let ls = await h.layers();
  const fill = ls[ls.length - 1];
  t.check('Fill adds a new layer and leaves the others alone', fill.name === 'Fill' && fill.source.kind === 'raster' && ls.length === before.doc.layers.length + 1 && (await state(page)).past === before.past + 1);
  let px = await alphaAt([[680, 80], [605, 25], [300, 300]]);
  t.check('the colour fills the selected shape only', rgbNear(px[0], [0, 255, 255]) && px[0][3] === 255 && px[1][3] === 0 && rgbNear(px[2], [255, 0, 0]), px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');
  await options.getByRole('button', { name: 'Rectangle', exact: true }).click();

  // The brush only lands inside the selection.
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  await dragDoc([300, 200], [400, 300]);
  await page.keyboard.press('b');
  await h.setField('Size', 40, page.locator('[data-testid="tool-options"]'));
  await h.setField('Hardness', 100, page.locator('[data-testid="tool-options"]'));
  await h.stroke([[250, 250], [550, 250]]);
  px = await alphaAt([[350, 250], [270, 250], [500, 250]]);
  t.check('a brush stroke is kept inside the selection', rgbNear(px[0], [0, 255, 255]) && rgbNear(px[1], [255, 0, 0]) && rgbNear(px[2], [0, 0, 255]), px.map(fmt).join(' '));
  t.check('the selection commands stay available while painting', await actions.isVisible());
  await page.keyboard.press('Control+z');
  await page.keyboard.press('m');
  await page.keyboard.press('Control+d');
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
});

await section('Text and shapes', async () => {
  await h.openTab('elements');
  await page.locator('[data-shape="ellipse"], [title="Ellipse"], [title="Circle"]').first().click();
  await h.settle(300);
  const ls = await h.layers();
  const shape = ls[ls.length - 1];
  t.check('a shape was added for the test', shape.type === 'shape', shape.type);
  await page.keyboard.press('m');
  await panel.getByRole('button', { name: 'Select layer', exact: true }).click();
  const s = await sel([[shape.x + shape.width / 2, shape.y + shape.height / 2], [shape.x + 3, shape.y + 3]]);
  t.check('“Select layer” follows the outline of a shape', s.active && s.at[0] === 1 && s.at[1] === 0 && near(s.coverage, share((Math.PI * shape.width * shape.height) / 4), 0.004), describe(s));
  t.check('masking is offered for image layers only, and the bar says so', (await actions.getByRole('button', { name: 'Mask to selection', exact: true }).isDisabled()) && (await actions.getByRole('button', { name: 'Fill', exact: true }).isEnabled()));
  await page.evaluate((id) => window.__prysm.editor.getState().deleteLayers([id]), shape.id);
  await page.keyboard.press('Control+d');
});

await section('Select subject', async () => {
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
  await h.settle(300);
  await page.keyboard.press('m');
  const before = await state(page);
  await panel.getByRole('button', { name: 'Select subject' }).click();
  await page.waitForFunction(() => window.__prysm.selection.getState().busy === null && !!window.__prysm.selection.getState().mask, null, { timeout: 180000 });
  const s = await sel([[380, 315], [480, 210], [95, 75], [705, 525]]);
  // Two discs: about 22% of the photo, which is 64% of the canvas.
  t.check('the subject is selected and the background is not', s.at[0] > 0.9 && s.at[1] > 0.7 && s.at[2] === 0 && s.at[3] === 0 && s.coverage > 0.09 && s.coverage < 0.2, `${describe(s)} | ${s.at.map((v) => v.toFixed(2)).join(' ')}`);
  const after = await state(page);
  t.check('selecting the subject adds no mask and no undo step', after.past === before.past && (await h.layerById(photo.id)).masks.length === 0);
  await actions.getByRole('button', { name: 'Copy to layer', exact: true }).click();
  await h.settle(400);
  await h.patch(photo.id, { visible: false });
  await h.patch(A.id, { visible: false });
  await h.patch(B.id, { visible: false });
  await h.settle(300);
  const px = await alphaAt([[380, 315], [95, 75], [705, 525]]);
  t.check('the selected subject can be lifted onto its own layer', px[0][3] > 235 && px[0][0] > 150 && px[1][3] === 0 && px[2][3] === 0, px.map(fmt).join(' '));
  for (let i = 0; i < 4; i++) await page.keyboard.press('Control+z');
  await h.settle(200);
  await page.evaluate((id) => window.__prysm.editor.getState().deleteLayers([id]), photo.id);
  await page.keyboard.press('Control+d');
});

await section('Lifetime of a selection', async () => {
  await page.keyboard.press('m');
  await dragDoc([100, 100], [300, 250]);
  t.check('a selection is active', (await sel()).active);
  await page.keyboard.press('v');
  t.check('it survives switching tools, and its commands stay available', (await sel()).active && (await actions.isVisible()) && (await options.count()) === 0);
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 900);
  t.check('resizing the canvas ends it', !(await sel()).active);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('m');
  await dragDoc([100, 100], [300, 250]);
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(800);
  const doc = (await state(page)).doc;
  t.check('a selection is not saved with the project; the design reopens intact', !(await sel()).active && doc.schemaVersion === 6 && doc.layers.length === 2 && doc.width === 800, `${doc.layers.length} layers, ${doc.width} wide`);
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
