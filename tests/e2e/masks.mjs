/**
 * Milestone 2, stages 1-2 and 4: layer masks, painting on masks, paint layers, brush and eraser.
 * Everything is driven through the real interface and verified on exported pixels.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, toScreen, view, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);

const ui = () => page.evaluate(() => {
  const s = window.__prysm.ui.getState();
  return { tool: s.tool, maskEdit: s.maskEditLayerId, maskView: s.maskViewLayerId, toast: s.toast?.text ?? null };
});
const props = page.locator('[data-testid="properties-panel"]');
const options = page.locator('[data-testid="tool-options"]');
const setBrush = async (label, value) => h.setField(label, value, options);
const alphaAt = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const rasterKeys = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('prysm');
        open.onsuccess = () => {
          const req = open.result.transaction('rasters').objectStore('rasters').getAllKeys();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
        };
      }),
  );

async function uploadTestImages() {
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
    ctx.fillRect(0, 0, 200, 200);
    return [a.toDataURL('image/png'), b.toDataURL('image/png')];
  });
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles(
    urls.map((u, i) => ({ name: i ? 'green.png' : 'halves.png', mimeType: 'image/png', buffer: Buffer.from(u.split(',')[1], 'base64') })),
  );
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 2);
}

let A; // 400x300 red|blue image
let B; // 200x200 green image

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  await uploadTestImages();
  [A, B] = await h.layers();
  await h.patch(A.id, { x: 200, y: 150 });
  await h.patch(B.id, { x: 20, y: 380 });
  t.check('two images on an 800x600 canvas', A.width === 400 && B.width === 200);
});

await section('Add a mask', async () => {
  await h.selectRow(A.id);
  const before = (await state(page)).past;
  await props.getByRole('button', { name: 'Add layer mask' }).click();
  const a = await h.layerById(A.id);
  const mask = a.masks[0];
  t.check('the layer has its own mask', a.masks.length === 1 && mask.enabled && mask.origin === 'manual');
  t.check('mask density follows the source aspect, at least 1024 px on the long side', mask.width === 1024 && mask.height === 768, `${mask.width}x${mask.height}`);
  t.check('adding a mask is one undo step', (await state(page)).past === before + 1);
  t.check('the editor switches to editing the mask', (await ui()).maskEdit === A.id);
  t.check('a banner states that the mask is being edited', await page.locator('[data-testid="mask-edit-banner"]').isVisible());
  t.check('the layers panel shows a mask thumbnail', (await page.locator(`[data-layer-id="${A.id}"] [data-testid="mask-thumb"]`).count()) === 1);
  t.check('the mask thumbnail is marked as the edit target', (await page.locator(`[data-layer-id="${A.id}"] [data-testid="mask-thumb"]`).getAttribute('aria-pressed')) === 'true');
  const px = await alphaAt([[300, 225], [500, 225]]);
  t.check('a new mask reveals the whole image', rgbNear(px[0], [255, 0, 0]) && px[0][3] === 255 && rgbNear(px[1], [0, 0, 255]), px.map(fmt).join(' '));
});

await section('Paint black and white on the mask', async () => {
  await page.keyboard.press('b');
  t.check('B selects the brush', (await ui()).tool === 'brush');
  t.check('tool options state the stroke edits the mask', (await page.locator('[data-testid="paint-target"]').getAttribute('data-kind')) === 'mask');
  await setBrush('Size', 80);
  await setBrush('Hardness', 100);

  // The brush outline follows the pointer at the brush's on-canvas size.
  const mid = await toScreen(page, 300, 225);
  await page.mouse.move(mid.x, mid.y);
  const { zoom } = await view(page);
  const ring = await page.locator('[data-testid="brush-cursor"] > div').boundingBox();
  t.check('the cursor previews the brush size', near(ring.width, 80 * zoom, 2.5) && near(ring.x + ring.width / 2, mid.x, 2), `ring ${ring.width.toFixed(1)}px, expected ${(80 * zoom).toFixed(1)}px`);

  const before = await state(page);
  const maskBefore = before.doc.layers[0].masks[0].rasterId;
  await h.stroke([[250, 225], [350, 225]]);
  let a = await h.layerById(A.id);
  t.check('a stroke stores a new mask bitmap', a.masks[0].rasterId !== maskBefore);
  t.check('a stroke is one undo step', (await state(page)).past === before.past + 1);
  t.check('the image source is untouched', JSON.stringify(a.source) === JSON.stringify(A.source));

  let px = await alphaAt([[300, 225], [300, 165], [500, 225]]);
  t.check('black on the mask makes pixels transparent, not black', px[0][3] === 0, fmt(px[0]));
  t.check('pixels outside the stroke are unchanged', rgbNear(px[1], [255, 0, 0]) && px[1][3] === 255 && px[2][3] === 255, `${fmt(px[1])} ${fmt(px[2])}`);
  const flat = (await h.exportPng([[300, 225]])).pixels;
  t.check('concealed areas show what is underneath', rgbNear(flat[0], [255, 255, 255]), fmt(flat[0]));

  // Paint white to bring part of it back.
  await page.keyboard.press('x');
  await h.stroke([[250, 225], [290, 225]]);
  px = await alphaAt([[270, 225], [345, 225]]);
  t.check('white on the mask reveals the image again', rgbNear(px[0], [255, 0, 0]) && px[0][3] === 255, fmt(px[0]));
  t.check('the rest of the hidden stroke stays hidden', px[1][3] === 0, fmt(px[1]));

  // Grey: a half-opacity hide stroke over the blue half.
  await page.keyboard.press('x');
  await setBrush('Opacity', 50);
  await h.stroke([[460, 225], [540, 225]]);
  px = await alphaAt([[500, 225]]);
  t.check('a 50% stroke gives partial transparency (grey)', near(px[0][3], 128, 6) && px[0][2] > 240, fmt(px[0]));
  // Going over the same place within one stroke must not exceed the stroke opacity.
  await page.keyboard.press('Control+z');
  await h.stroke([[460, 225], [540, 225], [460, 225], [540, 225]]);
  px = await alphaAt([[500, 225]]);
  t.check('opacity caps coverage within a single stroke', near(px[0][3], 128, 6), fmt(px[0]));
  await setBrush('Opacity', 100);
});

await section('Undo and redo mask edits', async () => {
  const before = (await h.layerById(A.id)).masks[0].rasterId;
  await page.keyboard.press('Control+z');
  let px = await alphaAt([[500, 225]]);
  t.check('undo removes the last stroke', px[0][3] === 255 && (await h.layerById(A.id)).masks[0].rasterId !== before, fmt(px[0]));
  await page.keyboard.press('Control+Shift+z');
  px = await alphaAt([[500, 225]]);
  t.check('redo restores it', near(px[0][3], 128, 6) && (await h.layerById(A.id)).masks[0].rasterId === before, fmt(px[0]));
});

await section('Invert, disable, view and compare', async () => {
  await page.keyboard.press('v');
  await props.getByRole('button', { name: 'Invert', exact: true }).click();
  await h.settle(200);
  let px = await alphaAt([[345, 225], [300, 165], [500, 225]]);
  t.check('invert swaps hidden and revealed areas', px[0][3] === 255 && rgbNear(px[0], [255, 0, 0]) && px[1][3] === 0, `${fmt(px[0])} ${fmt(px[1])}`);
  t.check('invert keeps grey values grey', near(px[2][3], 127, 6), fmt(px[2]));
  await page.keyboard.press('Control+z');
  px = await alphaAt([[345, 225], [300, 165]]);
  t.check('invert can be undone', px[0][3] === 0 && px[1][3] === 255);

  await props.getByRole('switch', { name: 'Mask enabled' }).click();
  px = await alphaAt([[345, 225]]);
  t.check('disabling the mask shows the whole image', px[0][3] === 255 && rgbNear(px[0], [255, 0, 0]) && (await h.layerById(A.id)).masks[0].enabled === false, fmt(px[0]));
  await props.getByRole('switch', { name: 'Mask enabled' }).click();
  px = await alphaAt([[345, 225]]);
  t.check('re-enabling the mask hides it again', px[0][3] === 0);

  // View the mask itself: black where hidden, white where revealed, grey between.
  await props.getByRole('switch', { name: 'Show mask' }).click();
  let screen = await h.screenPixels([[345, 225], [300, 165], [500, 225]]);
  t.check('show mask displays the mask in greyscale', rgbNear(screen[0], [0, 0, 0]) && rgbNear(screen[1], [255, 255, 255]) && near(screen[2][0], 128, 8) && near(screen[2][0], screen[2][2], 2), screen.map(fmt).join(' '));
  px = await alphaAt([[345, 225], [300, 165]]);
  t.check('exports ignore the mask view', px[0][3] === 0 && rgbNear(px[1], [255, 0, 0]));
  await props.getByRole('switch', { name: 'Show mask' }).click();

  // Hold-to-compare shows the unmasked original while the button is held.
  // The properties panel scrolls; make sure the button is actually on screen before pressing it.
  await page.locator('[data-testid="mask-compare"]').scrollIntoViewIfNeeded();
  const compare = await page.locator('[data-testid="mask-compare"]').boundingBox();
  await page.mouse.move(compare.x + 20, compare.y + 10);
  await page.mouse.down();
  await h.settle(150);
  const shot = await page.locator('[data-testid="canvas-host"]').screenshot();
  const v = await view(page);
  const held = (await h.decode(shot, 'image/png', [[v.pan.x + 345 * v.zoom, v.pan.y + 225 * v.zoom]])).pixels;
  await page.mouse.up();
  await h.settle(150);
  screen = await h.screenPixels([[345, 225]]);
  t.check('hold to compare shows the original, then the masked result', rgbNear(held[0], [255, 0, 0]) && rgbNear(screen[0], [255, 255, 255]), `held ${fmt(held[0])} released ${fmt(screen[0])}`);
});

await section('Masks follow move, resize, rotation, flip and crop', async () => {
  // The hidden dash sits at source pixels x 100..150, y 35..115 (document 300..350, 185..265).
  await h.selectRow(A.id);
  await h.setField('X position', 300);
  await h.setField('Y position', 200);
  let px = await alphaAt([[445, 275], [345, 225]]);
  t.check('mask moves with the layer', px[0][3] === 0 && px[1][3] === 255, `${fmt(px[0])} ${fmt(px[1])}`);

  await h.setField('X position', 0);
  await h.setField('Y position', 0);
  await h.setField('Width', 800);
  px = await alphaAt([[290, 150], [290, 300]]);
  t.check('mask scales with the layer', px[0][3] === 0 && px[1][3] === 255 && (await h.layerById(A.id)).height === 600, `${fmt(px[0])} ${fmt(px[1])}`);

  await h.setField('Width', 400);
  await h.setField('X position', 200);
  await h.setField('Y position', 150);
  await h.setField('Rotation', 180);
  px = await alphaAt([[455, 375], [345, 225]]);
  t.check('mask rotates with the layer', px[0][3] === 0 && px[1][3] === 255, `${fmt(px[0])} ${fmt(px[1])}`);
  await h.setField('Rotation', 0);

  await props.getByRole('button', { name: 'Flip horizontally' }).click();
  px = await alphaAt([[455, 225], [300, 400]]);
  t.check('mask flips with the layer', px[0][3] === 0 && px[1][3] === 255, `${fmt(px[0])} ${fmt(px[1])}`);
  // Painting on a flipped layer still lands under the pointer.
  await page.keyboard.press('b');
  await h.stroke([[540, 400], [560, 400]]);
  px = await alphaAt([[550, 400], [250, 400]]);
  t.check('strokes on a flipped layer land under the pointer', px[0][3] === 0 && px[1][3] === 255, `${fmt(px[0])} ${fmt(px[1])}`);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('v');
  await props.getByRole('button', { name: 'Flip horizontally' }).click();

  await props.getByRole('button', { name: 'Crop' }).click();
  await props.getByLabel('Left', { exact: true }).fill('20');
  const cropped = await h.layerById(A.id);
  px = await alphaAt([[345, 225], [290, 225], [300, 165]]);
  t.check('mask stays aligned when the layer is cropped', near(cropped.x, 280) && px[0][3] === 0 && rgbNear(px[1], [255, 0, 0]) && px[2][3] === 255, `x=${cropped.x} ${px.map(fmt).join(' ')}`);
  // Painting on a cropped layer: a small brush, so a mapping error would miss the probe.
  await page.keyboard.press('b');
  await setBrush('Size', 20);
  await h.stroke([[500, 400], [520, 400]]);
  await page.keyboard.press('v');
  await props.getByLabel('Left', { exact: true }).fill('0');
  px = await alphaAt([[525, 400], [345, 225], [470, 400]]);
  t.check('strokes on a cropped layer stay put when the crop is removed', px[0][3] === 0 && px[1][3] === 0 && px[2][3] === 255, px.map(fmt).join(' '));
});

await section('Edge softness, reset and delete', async () => {
  await h.selectRow(A.id);
  await props.getByLabel('Feather', { exact: true }).fill('60');
  let a = await h.layerById(A.id);
  // The hidden dash's top edge is at document y = 185; sample just inside and outside it.
  let px = await alphaAt([[360, 190], [360, 180], [202, 152], [598, 448]]);
  t.check('edge softness is stored on the mask', a.masks[0].feather > 0);
  t.check('edge softness feathers mask edges', px[0][3] > 20 && px[0][3] < 235 && px[1][3] > 20 && px[1][3] < 250, `${fmt(px[0])} ${fmt(px[1])}`);
  t.check('softening does not fade the outer edge of the layer', px[2][3] >= 250 && px[3][3] >= 250, `${fmt(px[2])} ${fmt(px[3])}`);
  await props.getByLabel('Feather', { exact: true }).fill('0');

  await props.getByRole('button', { name: 'Reset', exact: true }).click();
  await h.settle(200);
  px = await alphaAt([[345, 225], [500, 225]]);
  a = await h.layerById(A.id);
  t.check('reset reveals everything but keeps the mask', a.masks.length === 1 && px[0][3] === 255 && px[1][3] === 255);
  await page.keyboard.press('Control+z');
  px = await alphaAt([[345, 225]]);
  t.check('reset can be undone', px[0][3] === 0);

  await props.getByRole('button', { name: 'Delete mask' }).click();
  a = await h.layerById(A.id);
  px = await alphaAt([[345, 225]]);
  t.check('deleting the mask restores the full image', a.masks.length === 0 && px[0][3] === 255 && rgbNear(px[0], [255, 0, 0]));
  t.check('mask editing ends when the mask is gone', (await ui()).maskEdit === null && !(await page.locator('[data-testid="mask-edit-banner"]').count()));
  await page.keyboard.press('Control+z');
  t.check('deleting a mask can be undone', (await h.layerById(A.id)).masks.length === 1);
});

await section('Eraser: non-destructive erase and restore', async () => {
  await h.selectRow(B.id);
  const before = (await state(page)).past;
  await page.keyboard.press('e');
  t.check('E selects the eraser', (await ui()).tool === 'eraser');
  t.check('eraser on an unmasked image announces it will add a mask', (await page.locator('[data-testid="paint-target"]').getAttribute('data-kind')) === 'auto-mask');
  await setBrush('Size', 60);
  await setBrush('Hardness', 100);
  await h.stroke([[80, 480], [160, 480]]);
  const toast = (await ui()).toast ?? '';
  let b = await h.layerById(B.id);
  let px = await alphaAt([[120, 480], [120, 420]]);
  t.check('erasing an image adds a mask instead of deleting pixels', b.masks.length === 1 && b.source.kind === 'asset' && b.source.assetId === B.source.assetId);
  t.check('erased pixels become transparent', px[0][3] === 0 && rgbNear(px[1], [0, 200, 0]), `${fmt(px[0])} ${fmt(px[1])}`);
  t.check('the user is told a mask was added', /mask/i.test(toast), toast);
  t.check('mask + first stroke are a single undo step', (await state(page)).past === before + 1);

  await options.getByRole('button', { name: 'Restore', exact: true }).click();
  await h.stroke([[80, 480], [120, 480]]);
  px = await alphaAt([[100, 480], [170, 480]]);
  t.check('restore mode brings erased pixels back', rgbNear(px[0], [0, 200, 0]) && px[0][3] === 255 && px[1][3] === 0, `${fmt(px[0])} ${fmt(px[1])}`);
  await options.getByRole('button', { name: 'Erase', exact: true }).click();

  // Soft eraser: partial transparency towards the edge of the stroke.
  await setBrush('Hardness', 0);
  await h.stroke([[60, 540], [180, 540]]);
  px = await alphaAt([[120, 540], [120, 515]]);
  t.check('a soft eraser fades towards its edge', px[0][3] < 20 && px[1][3] > 20 && px[1][3] < 245, `${fmt(px[0])} ${fmt(px[1])}`);
  await setBrush('Hardness', 100);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  b = await h.layerById(B.id);
  t.check('undoing back removes the automatic mask too', b.masks.length === 0 && (await ui()).maskEdit === null);
  await page.keyboard.press('Control+Shift+z');

  // With nothing selected the eraser has nothing to act on and says so.
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  const layersBefore = JSON.stringify(await h.layers());
  await h.stroke([[700, 100], [720, 100]]);
  t.check('eraser with nothing selected changes nothing and explains why', JSON.stringify(await h.layers()) === layersBefore && /select/i.test((await ui()).toast ?? ''));
});

let paintId;

await section('Paint layers: brush and eraser', async () => {
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  t.check('with nothing selected the brush announces a new paint layer', (await page.locator('[data-testid="paint-target"]').getAttribute('data-kind')) === 'new-paint');
  await setBrush('Size', 40);
  await setBrush('Hardness', 100);
  await h.setField('Brush colour hex', '#ffcc00', options);
  const before = await state(page);
  await h.stroke([[650, 60], [760, 60], [760, 120]]);
  let s = await state(page);
  const paint = s.doc.layers[s.doc.layers.length - 1];
  paintId = paint.id;
  t.check('the stroke created a paint layer on top', s.doc.layers.length === before.doc.layers.length + 1 && paint.source.kind === 'raster' && paint.width === 800);
  t.check('the new paint layer is selected', s.selectedIds.join() === paint.id);
  t.check('layer + first stroke are a single undo step', s.past === before.past + 1);
  let px = await alphaAt([[700, 60], [760, 90], [700, 100]]);
  t.check('the brush paints its colour', rgbNear(px[0], [255, 204, 0]) && px[0][3] === 255 && rgbNear(px[1], [255, 204, 0]), `${fmt(px[0])} ${fmt(px[1])}`);
  t.check('unpainted areas stay transparent', px[2][3] === 0, fmt(px[2]));

  // A second stroke goes onto the same layer.
  await h.setField('Brush colour hex', '#00aaff', options);
  await h.stroke([[650, 150], [760, 150]]);
  s = await state(page);
  px = await alphaAt([[700, 150]]);
  t.check('further strokes paint on the selected paint layer', s.doc.layers.length === before.doc.layers.length + 1 && rgbNear(px[0], [0, 170, 255]), fmt(px[0]));

  // Opacity and flow.
  await setBrush('Opacity', 40);
  await h.stroke([[650, 200], [760, 200]]);
  px = await alphaAt([[700, 200]]);
  t.check('brush opacity limits coverage', near(px[0][3], 102, 6), fmt(px[0]));
  await setBrush('Opacity', 100);
  await setBrush('Flow', 20);
  await h.stroke([[650, 250], [760, 250]]);
  px = await alphaAt([[700, 250]]);
  const onePass = px[0][3];
  await h.stroke([[650, 250], [760, 250]]);
  px = await alphaAt([[700, 250]]);
  t.check('low flow builds up over repeated passes', onePass > 15 && onePass < 200 && px[0][3] > onePass + 15, `one pass ${onePass}, two passes ${px[0][3]}`);
  await setBrush('Flow', 100);

  // Smooth strokes: a fast zig-zag with few pointer samples should still be a continuous line.
  await setBrush('Smoothing', 60);
  await h.stroke([[420, 500], [480, 470], [540, 500], [600, 470]], 2);
  px = await alphaAt([[450, 485], [510, 485], [570, 485]]);
  t.check('sparse pointer samples still give a continuous stroke', px.every((p) => p[3] > 200), px.map(fmt).join(' '));

  // Eraser removes paint; undo brings it back.
  await page.keyboard.press('e');
  t.check('eraser on a paint layer edits the paint', (await page.locator('[data-testid="paint-target"]').getAttribute('data-kind')) === 'paint');
  await setBrush('Size', 30);
  await h.stroke([[700, 40], [700, 80]]);
  px = await alphaAt([[700, 60], [660, 60]]);
  t.check('the eraser removes paint', px[0][3] === 0 && px[1][3] === 255, `${fmt(px[0])} ${fmt(px[1])}`);
  await page.keyboard.press('Control+z');
  px = await alphaAt([[700, 60]]);
  t.check('undo restores erased paint', px[0][3] === 255 && rgbNear(px[0], [255, 204, 0]));

  // Paint layers are ordinary layers: move them and the paint follows; they can be masked too.
  await page.keyboard.press('v');
  await h.setField('X position', -100);
  px = await alphaAt([[600, 60], [700, 60]]);
  t.check('paint moves with its layer', rgbNear(px[0], [255, 204, 0]) && px[1][3] === 0, `${fmt(px[0])} ${fmt(px[1])}`);
  await h.setField('X position', 0);
  await props.getByRole('button', { name: 'Add layer mask' }).click();
  await page.keyboard.press('b');
  await h.stroke([[650, 60], [680, 60]]);
  const painted = await h.layerById(paintId);
  px = await alphaAt([[665, 60], [730, 60]]);
  t.check('a paint layer can have its own mask', painted.masks.length === 1 && px[0][3] === 0 && px[1][3] === 255, `${fmt(px[0])} ${fmt(px[1])}`);
  await props.getByRole('switch', { name: 'Mask enabled' }).click();
  px = await alphaAt([[665, 60]]);
  t.check('the paint under the mask is still there', px[0][3] === 255 && rgbNear(px[0], [255, 204, 0]));
  await props.getByRole('switch', { name: 'Mask enabled' }).click();
  await page.keyboard.press('v');
});

await section('Layers panel: choosing image or mask', async () => {
  const row = page.locator(`[data-layer-id="${A.id}"]`);
  await row.locator('[data-testid="layer-thumb"]').click();
  let u = await ui();
  t.check('clicking the image thumbnail targets the image', u.maskEdit === null && (await state(page)).selectedIds.join() === A.id);
  await row.locator('[data-testid="mask-thumb"]').click();
  u = await ui();
  t.check('clicking the mask thumbnail targets the mask', u.maskEdit === A.id);
  await row.locator('[data-testid="mask-thumb"]').click({ modifiers: ['Shift'] });
  t.check('Shift+click on the mask thumbnail toggles the mask', (await h.layerById(A.id)).masks[0].enabled === false);
  await row.locator('[data-testid="mask-thumb"]').click({ modifiers: ['Shift'] });
  await h.selectRow(B.id);
  u = await ui();
  t.check('selecting another layer leaves mask editing', u.maskEdit === null);
  await page.locator('[data-testid="layers-panel"]').getByRole('button', { name: 'New paint layer' }).click();
  const ls = await h.layers();
  t.check('a paint layer can be added from the layers panel', ls[ls.length - 1].source?.kind === 'raster' && ls.length === 4);
  await page.keyboard.press('Control+z');
});

let savedDoc;
let reference;

await section('Save, reopen and storage', async () => {
  const pts = [[345, 225], [300, 165], [510, 400], [120, 480], [700, 60], [665, 60]];
  reference = await alphaAt(pts);
  await waitForSaved(page);
  savedDoc = (await state(page)).doc;
  const referenced = new Set();
  const walk = (ls) => ls.forEach((l) => { if (l.source?.kind === 'raster') referenced.add(l.source.rasterId); (l.masks ?? []).forEach((m) => referenced.add(m.rasterId)); if (l.children) walk(l.children); });
  walk(savedDoc.layers);
  let keys = await rasterKeys();
  t.check('every bitmap the project uses is stored', [...referenced].every((id) => keys.includes(id)), `${referenced.size} referenced, ${keys.length} stored`);

  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n, savedDoc.layers.length);
  await h.settle(1200);
  const restored = (await state(page)).doc;
  const strip = (d) => JSON.stringify({ ...d, updatedAt: 0 });
  t.check('document with masks and paint is identical after refresh', strip(restored) === strip(savedDoc));
  const px = await alphaAt(pts);
  t.check('masks and paint render identically after reopening', px.every((p, i) => near(p[3], reference[i][3], 2) && rgbNear(p, reference[i], 2)), px.map(fmt).join(' '));
  keys = await rasterKeys();
  t.check('bitmaps left over from undo history are cleaned up on startup', keys.length === referenced.size, `${keys.length} stored, ${referenced.size} referenced`);

  // Still editable after reopening.
  await h.selectRow(A.id);
  await page.locator(`[data-layer-id="${A.id}"] [data-testid="mask-thumb"]`).click();
  await page.keyboard.press('b');
  await options.getByRole('button', { name: 'Reveal (white)' }).click();
  await setBrush('Size', 80);
  await setBrush('Opacity', 100);
  await h.stroke([[300, 225], [350, 225]]);
  const after = await alphaAt([[345, 225]]);
  t.check('a reopened mask can still be edited', after[0][3] === 255 && rgbNear(after[0], [255, 0, 0]), fmt(after[0]));
  await page.keyboard.press('Control+z');
  await options.getByRole('button', { name: 'Hide (black)' }).click();
  await page.keyboard.press('v');
});

await section('Apply a mask, and recover the original', async () => {
  await h.selectRow(A.id);
  await h.openTab('uploads');
  const assetsBefore = await page.locator('[data-testid="sidebar-panel"] img').count();
  const before = await h.layerById(A.id);
  await props.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.waitForFunction((id) => window.__prysm.editor.getState().doc.layers.find((l) => l.id === id).masks.length === 0, A.id);
  const applied = await h.layerById(A.id);
  let px = await alphaAt([[345, 225], [300, 165]]);
  t.check('apply bakes the mask into a new image', applied.source.assetId !== before.source.assetId && applied.masks.length === 0 && px[0][3] === 0 && rgbNear(px[1], [255, 0, 0]), `${fmt(px[0])} ${fmt(px[1])}`);
  t.check('the original upload is still in the library', (await page.locator('[data-testid="sidebar-panel"] img').count()) === assetsBefore + 1);
  await page.keyboard.press('Control+z');
  const undone = await h.layerById(A.id);
  t.check('applying can be undone back to original + mask', undone.source.assetId === before.source.assetId && undone.masks.length === 1);
  await props.getByRole('button', { name: 'Delete mask' }).click();
  px = await alphaAt([[345, 225], [510, 400], [300, 165]]);
  t.check('with the mask deleted every original pixel is back', px.every((p) => p[3] === 255) && rgbNear(px[0], [255, 0, 0]) && rgbNear(px[1], [0, 0, 255]), px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');
});

await section('Duplicated layers and older projects', async () => {
  // A duplicate has an independent mask.
  await page.keyboard.press('v');
  await h.selectRow(A.id);
  await page.keyboard.press('Control+d');
  const copy = (await state(page)).selectedIds[0];
  let c = await h.layerById(copy);
  const a = await h.layerById(A.id);
  t.check('a duplicated layer gets its own mask', c.masks.length === 1 && c.masks[0].id !== a.masks[0].id && c.masks[0].rasterId === a.masks[0].rasterId);
  await page.locator(`[data-layer-id="${copy}"] [data-testid="mask-thumb"]`).click();
  await props.getByRole('button', { name: 'Invert', exact: true }).click();
  await h.settle(300);
  c = await h.layerById(copy);
  t.check('editing the copy\'s mask leaves the original\'s alone', c.masks[0].rasterId !== a.masks[0].rasterId && (await h.layerById(A.id)).masks[0].rasterId === a.masks[0].rasterId);
  await page.keyboard.press('Delete');

  // A project saved before masks and clipping existed (schema 1) must still open.
  await waitForSaved(page);
  const expectedLayers = (await h.layers()).length;
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('prysm');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('projects', 'readwrite');
          const store = tx.objectStore('projects');
          const id = window.__prysm.editor.getState().doc.id;
          const get = store.get(id);
          get.onsuccess = () => {
            const rec = get.result;
            const strip = (layers) =>
              layers.map((l) => {
                const { clip, masks, ...old } = l;
                if (old.children) old.children = strip(old.children);
                return old;
              });
            // Paint layers did not exist either, so an old project has only asset-backed images.
            rec.doc = { ...rec.doc, schemaVersion: 1, layers: strip(rec.doc.layers.filter((l) => l.source?.kind !== 'raster')) };
            store.put(rec);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.waitForFunction(() => window.__prysm?.editor.getState().doc.layers.length > 0);
  await h.settle(800);
  const doc = (await state(page)).doc;
  t.check('a project saved by the previous version opens and is upgraded', doc.schemaVersion === 6 && doc.layers.length === expectedLayers - 1 && doc.layers.every((l) => l.clip === false && (l.type !== 'image' || Array.isArray(l.masks))), `schema ${doc.schemaVersion}, ${doc.layers.length} layers`);
  const px = await alphaAt([[345, 225], [120, 420]]);
  t.check('its images render as before', rgbNear(px[0], [255, 0, 0]) && rgbNear(px[1], [0, 200, 0]), px.map(fmt).join(' '));
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
