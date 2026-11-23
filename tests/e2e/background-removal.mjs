/**
 * Milestone 2, stage 3: in-browser background removal. Runs the real models (they must be
 * installed: `npm run setup:ai`): the one that finds the subject, and the one that finds the
 * object under a click in the dialog where what is kept and removed is chosen. Checks the dialog
 * and the mask it produces.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, removeBackground, rgbNear, state, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const options = page.locator('[data-testid="tool-options"]');
const alphaAt = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const job = () => page.evaluate(() => window.__prysm.backgroundRemoval.getState().job);
const lastRun = () => page.evaluate(() => window.__prysm.backgroundRemoval.getState().lastRun);

/** Records every phase the job goes through, and the longest stall of the main thread meanwhile. */
async function startRecording() {
  await page.evaluate(() => {
    window.__phases = [];
    window.__maxGap = 0;
    window.__during = '';
    window.__recording = true;
    window.__unsub?.();
    window.__unsub = window.__prysm.backgroundRemoval.subscribe((s) => {
      const phase = s.job?.phase;
      if (phase && window.__phases[window.__phases.length - 1] !== phase) window.__phases.push(phase);
    });
    // A timer measures whether the main thread is free; unlike animation frames it does not
    // depend on the (headless) browser deciding to draw.
    let last = performance.now();
    clearInterval(window.__timer);
    window.__timer = setInterval(() => {
      const now = performance.now();
      if (window.__recording && now - last > window.__maxGap) {
        window.__maxGap = now - last;
        window.__during = window.__phases[window.__phases.length - 1] ?? 'before the job started';
      }
      last = now;
    }, 8);
  });
}
const stopRecording = () =>
  page.evaluate(() => {
    window.__recording = false;
    return { phases: window.__phases, maxGap: window.__maxGap, during: window.__during };
  });
const dialog = page.locator('[data-testid="removal-dialog"]');
const applyButton = dialog.getByRole('button', { name: 'Apply', exact: true });
/** The dialog has finished opening (and finding the subject, on a first run). */
const settled = () => page.waitForSelector('[data-testid="removal-dialog"]:not([data-state="working"])', { timeout: 180000 });
const objectsReady = () => page.waitForSelector('[data-testid="removal-dialog"][data-objects="ready"]', { timeout: 180000 });
const removal = () =>
  page.evaluate(() => {
    const s = window.__prysm.removal.getState();
    return {
      phase: s.phase,
      selected: s.selected,
      // What applying would remove: everything but the selection, or the selection.
      removed: s.outcome === 'keep' ? 1 - s.selected : s.selected,
      outcome: s.outcome,
      mode: s.mode,
      points: s.points,
      changed: s.changed,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      tool: s.tool,
      reedit: s.reedit,
      objects: s.objects.state,
      notice: s.notice,
    };
  });
/** A point of the 640 x 480 photo as a place on the screen, inside the dialog. */
async function inDialog(x, y) {
  const box = await page.evaluate(() => window.__prysm.removalStage());
  return { x: box.x + (x / 640) * box.width, y: box.y + (y / 480) * box.height };
}
/** Points at a place in the dialog's picture and waits for the object there to light up. */
async function pointAt(x, y) {
  const p = await inDialog(x, y);
  await page.mouse.move(p.x - 4, p.y - 4);
  await page.mouse.move(p.x, p.y);
  await page.locator('[data-testid="removal-hint"]').waitFor({ timeout: 15000 });
  await h.settle(500);
  return page.locator('[data-testid="removal-hint"]').getAttribute('data-mode');
}
/** Chooses what a click or a stroke does: 'Add' or 'Take away'. */
const setMode = (name) => dialog.locator('[data-testid="removal-mode"]').getByRole('button', { name, exact: true }).click();
/** Chooses what happens to the selection: 'Kept' or 'Removed'. */
const setOutcome = (name) => dialog.locator('[data-testid="removal-outcome"]').getByRole('button', { name, exact: true }).click();
/** What the dialog's picture shows at points of the photo, with the pointer out of the way. */
async function stagePixels(points) {
  const stage = page.locator('[data-testid="removal-stage"]');
  const box = await stage.boundingBox();
  const at = [];
  for (const [x, y] of points) {
    const p = await inDialog(x, y);
    at.push([p.x - box.x, p.y - box.y]);
  }
  await page.mouse.move(box.x + 4, box.y + box.height - 4);
  await h.settle(250);
  return (await h.decode(await stage.screenshot(), 'image/png', at)).pixels;
}
/** Clicks an object in the dialog's picture and waits until the click has been worked out. */
async function clickObject(x, y, modifiers = []) {
  const p = await inDialog(x, y);
  await page.mouse.move(p.x, p.y);
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.click(p.x, p.y);
  for (const key of modifiers) await page.keyboard.up(key);
  await page.waitForFunction(() => !window.__prysm.removal.getState().busy);
  await h.settle(150);
}
async function dialogStroke(points) {
  const first = await inDialog(...points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const p = await inDialog(...point);
    await page.mouse.move(p.x, p.y, { steps: 8 });
  }
  await page.mouse.up();
  await h.settle(150);
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

// A "photo": a shaded red object on a textured, low-contrast background.
const SUBJECT = `
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#8c8478'); g.addColorStop(1, '#5f5a52');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = 'rgba(' + (rnd() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (0.02 + rnd() * 0.05) + ')'; ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 26, 1 + rnd() * 3); }
  for (let y = 60; y < h; y += 96) { ctx.fillStyle = 'rgba(30,25,20,0.35)'; ctx.fillRect(0, y, w, 3); }
  const ball = (x, y, r) => { const s = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r); s.addColorStop(0, '#ffb08a'); s.addColorStop(0.35, '#e23a22'); s.addColorStop(1, '#6e0d08'); ctx.fillStyle = s; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  ball(400, 150, 58); ball(300, 255, 135);
`;

let photo;

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  photo = await upload('ball.png', SUBJECT, [640, 480]);
  await h.patch(photo.id, { x: 80, y: 60 });
  const installed = await page.evaluate(async () => {
    const r = await fetch('/models/silueta.onnx', { method: 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  });
  t.check('the segmentation model is installed (npm run setup:ai)', installed);
});

// Document points: subject centre, small ball, and background corners.
const CENTER = [380, 315];
const SMALL = [480, 210];
const CORNERS = [[95, 75], [705, 75], [95, 525], [705, 525]];

await section('Remove the background', async () => {
  await h.selectRow(photo.id);
  const before = await state(page);
  await startRecording();
  await props.locator('[data-testid="bg-removal"] button').click();
  await dialog.waitFor();
  t.check('the button opens the dialog, which says what it is doing', ['working', 'ready'].includes(await dialog.getAttribute('data-state')) && (await dialog.locator('[role="status"]').count()) > 0);
  t.check('nothing can be applied while it is working', (await dialog.getAttribute('data-state')) !== 'working' || (await applyButton.isDisabled()));
  await settled();
  const rec = await stopRecording();
  const result = await job();
  t.check('the subject is found and offered as a suggestion', result.phase === 'done' && (await dialog.getAttribute('data-state')) === 'ready', result.message);
  const suggested = await removal();
  t.check('the suggestion selects the subject, to be kept (two discs are about 22% of the image)', suggested.selected > 0.14 && suggested.selected < 0.32 && suggested.outcome === 'keep' && suggested.points === 0 && !suggested.changed, `${(suggested.selected * 100).toFixed(1)}% selected`);
  const untouched = await state(page);
  t.check('the design is not changed until Apply', untouched.past === before.past && untouched.doc.layers[0].masks.length === 0);
  await applyButton.click();
  await dialog.waitFor({ state: 'detached' });
  const applied = await job();
  t.check('Apply closes the dialog and reports the result', applied.phase === 'done' && /Background removed in [\d.]+ s/.test(applied.message), applied.message);
  t.check('progress goes through download, run and refine', ['downloading', 'running', 'refining', 'done'].every((p) => rec.phases.includes(p)), rec.phases.join(' > '));
  t.check('the main thread stays free while the model downloads and runs (longest stall < 250 ms)', rec.maxGap < 250, `${Math.round(rec.maxGap)} ms, during “${rec.during}”`);

  const after = await state(page);
  const layer = after.doc.layers[0];
  const mask = layer.masks[0];
  t.check('the result is a layer mask, tagged as generated', layer.masks.length === 1 && mask.origin === 'background-removal' && mask.enabled);
  t.check('the mask follows the source aspect at mask density', mask.width === 1024 && mask.height === 768, `${mask.width}x${mask.height}`);
  t.check('the original image is untouched', JSON.stringify(layer.source) === JSON.stringify(photo.source));
  t.check('background removal is one undo step', after.past === before.past + 1);

  const px = await alphaAt([CENTER, SMALL, ...CORNERS]);
  t.check('the subject is kept, in its original colours', px[0][3] > 235 && px[0][0] > 150 && px[0][0] > px[0][2] * 2 && px[1][3] > 200, `${fmt(px[0])} ${fmt(px[1])}`);
  t.check('the background becomes transparent', px.slice(2).every((p) => p[3] < 20), px.slice(2).map(fmt).join(' '));

  // The mask should cover roughly the subject's area (two discs = about 22% of the image).
  const grid = [];
  for (let y = 70; y < 540; y += 20) for (let x = 90; x < 720; x += 20) grid.push([x, y]);
  const cover = (await alphaAt(grid)).filter((p) => p[3] > 128).length / grid.length;
  t.check('the mask covers about the subject area', cover > 0.14 && cover < 0.32, `${(cover * 100).toFixed(1)}% of the image kept`);
  const run = await lastRun();
  console.log(`      model ${run.model}, inference ${Math.round(run.inferenceMs)} ms, total ${Math.round(run.totalMs)} ms, ${run.threads} thread(s)`);
});

await section('Before / after, undo and redo', async () => {
  // The properties panel scrolls; make sure the button is actually on screen before pressing it.
  await page.locator('[data-testid="mask-compare"]').scrollIntoViewIfNeeded();
  const compare = await page.locator('[data-testid="mask-compare"]').boundingBox();
  await page.mouse.move(compare.x + 20, compare.y + 10);
  await page.mouse.down();
  await h.settle(200);
  const shot = await page.locator('[data-testid="canvas-host"]').screenshot();
  await page.mouse.up();
  const v = await page.evaluate(() => {
    const s = window.__prysm.ui.getState();
    return { zoom: s.zoom, pan: s.pan };
  });
  const held = (await h.decode(shot, 'image/png', [[v.pan.x + 95 * v.zoom, v.pan.y + 75 * v.zoom]])).pixels[0];
  const released = (await h.screenPixels([[95, 75]]))[0];
  t.check('hold to compare shows the original background, release shows the cut-out', held[0] > 60 && held[0] < 200 && rgbNear(released, [255, 255, 255]), `held ${fmt(held)} released ${fmt(released)}`);

  await page.keyboard.press('Control+z');
  let px = await alphaAt([CORNERS[0]]);
  t.check('undo brings the background back', (await h.layerById(photo.id)).masks.length === 0 && px[0][3] === 255, fmt(px[0]));
  await page.keyboard.press('Control+Shift+z');
  px = await alphaAt([CORNERS[0], CENTER]);
  t.check('redo removes it again', (await h.layerById(photo.id)).masks.length === 1 && px[0][3] < 20 && px[1][3] > 235);

  await props.getByRole('switch', { name: 'Mask enabled' }).click();
  px = await alphaAt([CORNERS[0]]);
  t.check('disabling the mask shows the untouched original', px[0][3] === 255);
  await props.getByRole('switch', { name: 'Mask enabled' }).click();
});

await section('Refine the result with brush and eraser', async () => {
  await props.getByRole('button', { name: 'Paint mask' }).click();
  t.check('"Paint mask" switches to the brush on the mask', (await page.locator('[data-testid="paint-target"]').getAttribute('data-kind')) === 'mask');
  await options.getByRole('button', { name: 'Reveal (white)' }).click();
  await h.setField('Size', 60, options);
  await h.setField('Hardness', 100, options);
  await h.stroke([[110, 500], [200, 500]]);
  let px = await alphaAt([[150, 500], CORNERS[0]]);
  t.check('painting white restores part of the background', px[0][3] === 255 && px[1][3] < 20, `${fmt(px[0])} ${fmt(px[1])}`);

  await page.keyboard.press('e');
  await h.setField('Size', 50, options);
  await h.setField('Hardness', 100, options);
  await h.stroke([[340, 315], [420, 315]]);
  px = await alphaAt([CENTER, [380, 380]]);
  t.check('the eraser hides part of the subject', px[0][3] === 0 && px[1][3] > 235, `${fmt(px[0])} ${fmt(px[1])}`);
  await options.getByRole('button', { name: 'Restore', exact: true }).click();
  await h.stroke([[340, 315], [420, 315]]);
  px = await alphaAt([CENTER]);
  t.check('restore brings the subject back', px[0][3] === 255, fmt(px[0]));
  await options.getByRole('button', { name: 'Erase', exact: true }).click();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  px = await alphaAt([[150, 500], CENTER]);
  t.check('each refinement is undoable', px[0][3] < 20 && px[1][3] > 235);
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
});

// In the photo: the small ball's free part, the big ball, and the wall.
const SMALL_BALL = [415, 125];
const BIG_BALL = [300, 290];
const WALL = [80, 400];

await section('Selecting what is kept and removed', async () => {
  await h.selectRow(photo.id);
  const before = await state(page);
  const maskBefore = before.doc.layers[0].masks[0].rasterId;
  t.check('a layer with a cut-out offers to edit it', /Edit background removal/.test(await props.locator('[data-testid="bg-removal"] button').innerText()));
  await startRecording();
  await props.locator('[data-testid="bg-removal"] button').click();
  await settled();
  let rec = await stopRecording();
  const opened = await removal();
  t.check('the dialog opens with the existing cut-out selected, without finding the subject again', opened.reedit && !opened.changed && opened.outcome === 'keep' && opened.points === 0 && rec.phases.every((p) => p === 'preparing') && near(opened.selected, 0.22, 0.08), `${rec.phases.join(' > ')} ${(opened.selected * 100).toFixed(1)}%`);
  t.check('there is nothing to apply until something is changed', await applyButton.isDisabled());

  // The editor's shortcuts do not act on the design behind the dialog.
  await page.keyboard.press('Delete');
  await page.keyboard.press('b');
  await page.keyboard.press('Control+z');
  const behind = await state(page);
  const toolBehind = await page.evaluate(() => window.__prysm.ui.getState().tool);
  t.check('keys pressed in the dialog do not reach the editor (Delete, B, Ctrl+Z)', behind.doc.layers.length === before.doc.layers.length && behind.past === before.past && behind.future === before.future && toolBehind === 'move', `${behind.doc.layers.length} layers, tool ${toolBehind}`);

  await startRecording();
  await objectsReady();
  rec = await stopRecording();
  t.check('the objects in the picture are found in the background, without freezing the page (longest stall < 250 ms)', rec.maxGap < 250, `${Math.round(rec.maxGap)} ms`);

  // The selection is shown in green, on the picture.
  const plain = await stagePixels([BIG_BALL, WALL]);
  await dialog.getByRole('button', { name: 'Original', exact: true }).click();
  const bare = await stagePixels([BIG_BALL, WALL]);
  await dialog.getByRole('button', { name: 'Selection', exact: true }).click();
  t.check('what is selected is tinted green; the rest of the picture is shown as it is', plain[0][1] - bare[0][1] > 40 && plain[0][0] < bare[0][0] && rgbNear(plain[1], bare[1], 4), `selected ${fmt(plain[0])} from ${fmt(bare[0])}; unselected ${fmt(plain[1])} from ${fmt(bare[1])}`);

  // Clicking adds the thing under the pointer; "Take away" removes it.
  t.check('pointing at a thing offers to select it', (await pointAt(...WALL)) === 'add');
  await setMode('Take away');
  t.check('in “Take away”, pointing at a thing offers to take it out', (await pointAt(...SMALL_BALL)) === 'subtract');
  await clickObject(...SMALL_BALL);
  const without = await removal();
  // The small ball's free part is about 2.5% of the picture.
  t.check('a click takes that object, and only it, out of the selection', opened.selected - without.selected > 0.012 && opened.selected - without.selected < 0.05 && without.changed && without.canUndo, `-${((opened.selected - without.selected) * 100).toFixed(2)}%`);
  let dot = (await stagePixels([SMALL_BALL]))[0];
  t.check('a point marks where it was clicked (red for taking away)', without.points === 1 && dot[0] > 200 && dot[1] < 130, `${without.points} point(s), ${fmt(dot)}`);
  t.check('a change can be applied', await applyButton.isEnabled());

  await page.keyboard.press('Control+z');
  let now = await removal();
  t.check('Ctrl+Z undoes the click and its point', near(now.selected, opened.selected, 0.0005) && now.points === 0 && !now.changed && now.canRedo && !now.canUndo, `${(now.selected * 100).toFixed(2)}%`);
  await page.keyboard.press('Control+Shift+z');
  now = await removal();
  t.check('Ctrl+Shift+Z redoes it', near(now.selected, without.selected, 0.0005) && now.points === 1 && now.changed);

  await setMode('Add');
  await clickObject(...SMALL_BALL);
  now = await removal();
  dot = (await stagePixels([SMALL_BALL]))[0];
  t.check('in “Add”, a click on the object selects it again, with a green point', near(now.selected, opened.selected, 0.006) && now.points === 2 && dot[1] > 150 && dot[0] < 90, `${(now.selected * 100).toFixed(2)}% against ${(opened.selected * 100).toFixed(2)}%, ${fmt(dot)}`);
  await clickObject(...SMALL_BALL, ['Alt']);
  t.check('Alt + click takes away without switching the mode', near((await removal()).selected, without.selected, 0.006) && (await removal()).mode === 'add');
  await setMode('Take away');
  await clickObject(...SMALL_BALL, ['Shift']);
  t.check('Shift + click adds without switching the mode', near((await removal()).selected, opened.selected, 0.006) && (await removal()).mode === 'subtract');
  await setMode('Add');

  // Building a selection from nothing, one click per thing.
  await dialog.getByRole('button', { name: 'Clear', exact: true }).click();
  now = await removal();
  t.check('Clear selects nothing and removes the points; there is nothing to apply', now.selected === 0 && now.points === 0 && (await applyButton.isDisabled()));
  await clickObject(...BIG_BALL);
  const big = await removal();
  // The big ball is about 18.6% of the picture.
  t.check('one click selects a whole object', big.selected > 0.15 && big.selected < 0.26 && big.points === 1, `${(big.selected * 100).toFixed(1)}%`);
  await clickObject(...SMALL_BALL);
  const both = await removal();
  t.check('clicking more things adds them: two clicks give both balls', both.selected >= big.selected - 0.001 && near(both.selected, opened.selected, 0.03) && both.points === 2, `${(both.selected * 100).toFixed(1)}% against ${(opened.selected * 100).toFixed(1)}% from the model`);

  // The brush.
  await dialog.locator('[data-removal-tool="brush"]').click();
  await h.setField('Brush size value', 60, dialog);
  await setMode('Take away');
  const beforeBrush = (await removal()).selected;
  await dialogStroke([[230, 290], [370, 290]]);
  const brushed = (await removal()).selected;
  t.check('the brush takes away what it is painted over', beforeBrush - brushed > 0.015, `-${((beforeBrush - brushed) * 100).toFixed(2)}%`);
  await setMode('Add');
  await dialogStroke([[230, 290], [370, 290]]);
  t.check('and adds it back', near((await removal()).selected, beforeBrush, 0.002) && (await removal()).points === 2);
  await dialog.locator('[data-removal-tool="pick"]').click();

  // The whole picture.
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click();
  t.check('with everything selected there is nothing to apply', (await removal()).selected === 1 && (await applyButton.isDisabled()));
  await dialog.getByRole('button', { name: 'Invert', exact: true }).click();
  t.check('Invert swaps what is selected', (await removal()).selected === 0);
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  now = await removal();
  t.check('Reset goes back to the cut-out the dialog opened with', near(now.selected, opened.selected, 0.0005) && !now.changed && now.points === 0);

  // Kept or removed, and the views.
  await dialog.getByRole('button', { name: 'Result', exact: true }).click();
  const kept = await stagePixels([BIG_BALL, WALL]);
  await setOutcome('Removed');
  const gone = await stagePixels([BIG_BALL, WALL]);
  now = await removal();
  t.check('“Kept” leaves the selection and removes the rest', kept[0][0] > 150 && kept[0][0] > kept[0][2] * 2 && kept[1][0] > 200 && kept[1][2] > 200, `ball ${fmt(kept[0])} wall ${fmt(kept[1])}`);
  t.check('“Removed” removes the selection and leaves the rest', gone[0][0] > 200 && gone[0][2] > 200 && rgbNear(gone[1], bare[1], 6) && near(now.removed, opened.selected, 0.0005), `ball ${fmt(gone[0])} wall ${fmt(gone[1])}`);
  t.check('choosing “Removed” is itself a change that can be applied', await applyButton.isEnabled());
  await setOutcome('Kept');
  await dialog.getByRole('button', { name: 'Selection', exact: true }).click();

  // Cancelling.
  await clickObject(...SMALL_BALL, ['Alt']);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await h.confirm(false);
  t.check('Cancel asks before throwing away changes, and can be called off', (await dialog.count()) === 1 && (await removal()).changed);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await h.confirm(true);
  await dialog.waitFor({ state: 'detached' });
  let after = await state(page);
  t.check('cancelling leaves the layer exactly as it was', after.past === before.past && after.doc.layers[0].masks[0].rasterId === maskBefore);
  await props.locator('[data-testid="bg-removal"] button').click();
  await settled();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  after = await state(page);
  t.check('Escape closes an unchanged dialog and leaves the layer selected', after.selectedIds.length === 1 && after.selectedIds[0] === photo.id && after.past === before.past);

  // Applying: the selection, less the small ball, is kept.
  await props.locator('[data-testid="bg-removal"] button').click();
  await settled();
  await objectsReady();
  await clickObject(...SMALL_BALL, ['Alt']);
  await applyButton.click();
  await dialog.waitFor({ state: 'detached' });
  after = await state(page);
  const mask = after.doc.layers[0].masks[0];
  t.check('Apply stores the choice as the layer mask, in one undo step', after.past === before.past + 1 && after.doc.layers[0].masks.length === 1 && mask.origin === 'background-removal' && mask.rasterId !== maskBefore);
  t.check('the original image is still untouched', JSON.stringify(after.doc.layers[0].source) === JSON.stringify(photo.source));
  // On the canvas the photo is at (80, 60).
  let px = await alphaAt([[80 + SMALL_BALL[0], 60 + SMALL_BALL[1]], CENTER, CORNERS[0]]);
  t.check('what was taken out of the selection is transparent in the export, what stayed in it is intact', px[0][3] < 20 && px[1][3] > 235 && px[2][3] < 20, px.map(fmt).join(' '));
  // No trace of the removed ball's outline: sample around where its edge was (centre 480,210 on the canvas, radius 58).
  const ring = [];
  for (let a = -150; a <= 30; a += 12) ring.push([480 + Math.cos((a * Math.PI) / 180) * 58, 210 + Math.sin((a * Math.PI) / 180) * 58]);
  const ghost = (await alphaAt(ring)).filter((p) => p[3] > 24).length;
  t.check('no outline of the removed object is left behind', ghost === 0, `${ghost} of ${ring.length} edge samples still show`);
  await page.keyboard.press('Control+z');
  px = await alphaAt([[80 + SMALL_BALL[0], 60 + SMALL_BALL[1]]]);
  t.check('undo brings the earlier cut-out back', px[0][3] > 200 && (await h.layerById(photo.id)).masks[0].rasterId === maskBefore, fmt(px[0]));

  // Applying with the selection removed: the two balls go, the wall stays.
  await props.locator('[data-testid="bg-removal"] button').click();
  await settled();
  await setOutcome('Removed');
  await applyButton.click();
  await dialog.waitFor({ state: 'detached' });
  px = await alphaAt([CENTER, CORNERS[0], CORNERS[3]]);
  t.check('with “Removed”, the selected things are cut out of the picture and the rest stays', px[0][3] < 20 && px[1][3] === 255 && px[2][3] === 255 && /Removed what you selected/.test((await job()).message), px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');
  t.check('and that is one undo step too', (await h.layerById(photo.id)).masks[0].rasterId === maskBefore);
});

await section('Models and repeat runs', async () => {
  await h.selectRow(photo.id);
  await h.openTab('ai');
  const panel = page.locator('[data-testid="ai-background-removal"]');
  await panel.waitFor();
  await startRecording();
  await removeBackground(page, panel);
  let rec = await stopRecording();
  t.check('a second run reuses the loaded model (no download)', (await job()).phase === 'done' && !rec.phases.includes('downloading'), rec.phases.join(' > '));
  const balanced = await lastRun();

  await panel.getByLabel('Segmentation model').selectOption('u2netp');
  await removeBackground(page, panel);
  const fast = await lastRun();
  const px = await alphaAt([CENTER, CORNERS[0], CORNERS[3]]);
  t.check('the Fast model also produces a usable cut-out', (await job()).phase === 'done' && fast.model === 'u2netp' && px[0][3] > 235 && px[1][3] < 30 && px[2][3] < 30, px.map(fmt).join(' '));
  console.log(`      Balanced ${Math.round(balanced.inferenceMs)} ms, Fast ${Math.round(fast.inferenceMs)} ms inference`);
  t.check('running again replaces the mask instead of stacking masks', (await h.layerById(photo.id)).masks.length === 1);

  await panel.getByRole('switch', { name: 'Refine edges' }).click();
  await removeBackground(page, panel);
  t.check('edge refinement can be turned off', (await job()).phase === 'done');
  await panel.getByRole('switch', { name: 'Refine edges' }).click();

  // A model that is not installed fails with instructions rather than hanging or faking a result.
  const maskBefore = (await h.layerById(photo.id)).masks[0].rasterId;
  await panel.getByLabel('Segmentation model').selectOption('isnet-general-use');
  await removeBackground(page, panel);
  const missing = await job();
  t.check('a missing model reports how to install it', missing.phase === 'error' && /setup:ai/.test(missing.message), missing.message);
  t.check('a failed run leaves the layer as it was', (await h.layerById(photo.id)).masks[0].rasterId === maskBefore);
  t.check('the button is usable again after an error', await panel.locator('[data-testid="bg-removal"] button').isEnabled());
  await panel.getByLabel('Segmentation model').selectOption('silueta');
});

await section('Images that cannot be processed', async () => {
  const tiny = await upload('tiny.png', `ctx.fillStyle = '#c00'; ctx.fillRect(0, 0, w, h);`, [16, 16]);
  await h.selectRow(tiny.id);
  let outcome = await removeBackground(page, props);
  let result = await job();
  t.check('the dialog says so and offers nothing to apply', outcome.state === 'failed' && !outcome.applied);
  t.check('an image that is too small is rejected with a reason', result.phase === 'error' && /too small/i.test(result.message), result.message);
  t.check('no mask is added when the run fails', (await h.layerById(tiny.id)).masks.length === 0);

  const flat = await upload('flat.png', `ctx.fillStyle = '#3a6ea5'; ctx.fillRect(0, 0, w, h);`, [300, 300]);
  await h.selectRow(flat.id);
  outcome = await removeBackground(page, props);
  result = await job();
  t.check('with no subject the dialog stays usable, with nothing removed', outcome.state === 'ready' && !outcome.applied);
  t.check('an image with no subject is reported, not silently masked', result.phase === 'error' && /subject/i.test(result.message) && (await h.layerById(flat.id)).masks.length === 0, result.message);
  await page.keyboard.press('Delete');
  await h.selectRow(tiny.id);
  await page.keyboard.press('Delete');
});

await section('Other layer kinds, save and reopen', async () => {
  // A generated texture is an image layer too.
  await h.openTab('textures');
  await page.locator('[data-generator="texture/paint-splashes"]').click();
  const tex = (await h.layers()).at(-1);
  await removeBackground(page, props);
  const result = await job();
  t.check('generated layers can be processed as well', result.phase === 'done' || /subject/i.test(result.message), `${result.phase}: ${result.message.slice(0, 60)}`);
  await h.selectRow(tex.id);
  await page.keyboard.press('Delete');

  const reference = await alphaAt([CENTER, ...CORNERS]);
  await waitForSaved(page);
  const saved = (await state(page)).doc;
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n, saved.layers.length);
  await h.settle(1200);
  const restored = (await state(page)).doc;
  const px = await alphaAt([CENTER, ...CORNERS]);
  t.check('the generated mask survives save and reopen', restored.layers[0].masks[0]?.origin === 'background-removal' && px.every((p, i) => near(p[3], reference[i][3], 2)), px.map(fmt).join(' '));
});

await section('Without the object finder', async () => {
  const other = await openEditor(browser);
  const p = other.page;
  // The model's files are "not on the server": requests for them get what this dev server gives
  // for any unknown path, the app's own page.
  await p.route('**/models/slimsam-*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Prysm</title>' }));
  const url = await p.evaluate((draw) => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    new Function('ctx', 'w', 'h', draw)(c.getContext('2d'), 640, 480);
    return c.toDataURL('image/png');
  }, SUBJECT);
  const count = await p.evaluate(() => window.__prysm.editor.getState().doc.layers.length);
  await p.locator('[data-tab="uploads"]').click();
  await p.locator('[data-testid="upload-input"]').setInputFiles({ name: 'ball.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await p.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, count);
  const layerId = await p.evaluate(() => window.__prysm.editor.getState().doc.layers.at(-1).id);
  await p.locator(`[data-layer-id="${layerId}"]`).click();
  await p.locator('[data-testid="properties-panel"] [data-testid="bg-removal"] button').click();
  const dlg = p.locator('[data-testid="removal-dialog"]');
  await p.waitForSelector('[data-testid="removal-dialog"]:not([data-state="working"])', { timeout: 180000 });
  await p.waitForSelector('[data-testid="removal-dialog"][data-objects="unavailable"]', { timeout: 30000 });
  const s = await p.evaluate(() => window.__prysm.removal.getState());
  t.check('a missing object model is explained, with how to install it', /setup:ai/.test(s.objects.message) && /setup:ai/.test(await dlg.locator('[data-testid="removal-objects-status"]').innerText()), s.objects.message);
  t.check('clicking objects is switched off and the brush is ready instead', s.tool === 'brush' && (await dlg.locator('[data-removal-tool="pick"]').isDisabled()));
  t.check('the automatic suggestion is still there', s.selected > 0.14 && s.selected < 0.32, `${(s.selected * 100).toFixed(1)}% selected`);
  await dlg.locator('[data-testid="removal-mode"]').getByRole('button', { name: 'Take away', exact: true }).click();
  const box = await p.evaluate(() => window.__prysm.removalStage());
  const spot = (x, y) => ({ x: box.x + (x / 640) * box.width, y: box.y + (y / 480) * box.height });
  const a = spot(230, 290);
  const b = spot(370, 290);
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b.x, b.y, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(200);
  const brushed = await p.evaluate(() => window.__prysm.removal.getState().selected);
  t.check('the brush works without it', s.selected - brushed > 0.01, `-${((s.selected - brushed) * 100).toFixed(2)}%`);
  await dlg.getByRole('button', { name: 'Apply', exact: true }).click();
  await dlg.waitFor({ state: 'detached' });
  t.check('and the result can be applied', (await p.evaluate((id) => window.__prysm.editor.getState().doc.layers.find((l) => l.id === id).masks.length, layerId)) === 1);
  t.check('no console or page errors without the object finder', other.errors.length === 0, other.errors.slice(0, 5).join(' | '));
  await other.context.close();
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
