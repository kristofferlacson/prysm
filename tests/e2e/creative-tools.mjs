/**
 * Milestone 3, detailed brief: effect management (on/off, order), the added effects, textures and
 * overlays, text background / vertical text / uploaded fonts, colour tools, favourites and recent
 * assets, lazy previews, dashed outlines, PDF export and the added templates.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const past = async () => (await state(page)).past;
const clear = (opts = {}) => h.exportPng([], { transparent: true, ...opts });
const stats = async (opts = {}) => h.stats((await clear()).buffer, opts);
const remove = (id) => page.evaluate((id) => window.__prysm.editor.getState().deleteLayers([id]), id);
const hex = (label, value) => h.setField(`${label} hex`, value, props);
const effect = (type) => page.locator(`[data-effect="${type}"]`);

let P;
await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 640, 480);
    g.addColorStop(0, '#103060');
    g.addColorStop(0.5, '#d08040');
    g.addColorStop(1, '#f8f0c0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 640, 480);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `hsl(${i * 47} 55% ${30 + (i % 5) * 12}%)`;
      ctx.fillRect((i * 97) % 600, (i * 61) % 440, 44, 44);
    }
    return c.toDataURL('image/png');
  });
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 1);
  P = (await h.layers())[0];
  t.check('(a photo is on the canvas)', P.type === 'image');
});

await section('Effect stack: switch off, reorder, undo', async () => {
  await h.selectRow(P.id);
  const base = await stats();
  await h.openTab('effects');
  await effect('posterize').click();
  const posterOnly = await stats();
  await effect('blur').click();
  const both = await stats();
  let l = await h.layerById(P.id);
  t.check('two effects are stacked in the order they were added', l.effects.map((e) => e.type).join() === 'posterize,blur' && both.signature !== posterOnly.signature);

  const before = await past();
  await props.getByRole('button', { name: 'Turn off Blur' }).click();
  l = await h.layerById(P.id);
  let a = await stats();
  t.check('an effect can be switched off and keeps its settings', l.effects[1].enabled === false && l.effects[1].amount > 0 && a.signature === posterOnly.signature && (await past()) === before + 1);
  t.check('the row shows it is off', (await props.locator('[data-effect-row="blur"]').getAttribute('data-enabled')) === 'false');
  await props.getByRole('button', { name: 'Turn on Blur' }).click();
  a = await stats();
  t.check('and switched back on', a.signature === both.signature);

  await props.getByRole('button', { name: 'Apply Blur earlier' }).click();
  l = await h.layerById(P.id);
  const swapped = await stats();
  t.check('reordering changes the order they are applied in', l.effects.map((e) => e.type).join() === 'blur,posterize' && swapped.signature !== both.signature && swapped.signature !== base.signature);
  t.check('the first effect cannot move earlier, the last cannot move later', (await props.getByRole('button', { name: 'Apply Blur earlier' }).isDisabled()) && (await props.getByRole('button', { name: 'Apply Posterize later' }).isDisabled()));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  t.check('undo restores the previous order', (await h.layerById(P.id)).effects.map((e) => e.type).join() === 'posterize,blur' && (await stats()).signature === both.signature);
  await page.keyboard.press('Control+Shift+z');
  await h.selectRow(P.id);
  await props.getByRole('button', { name: 'Turn off Posterize' }).click();
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(700);
  l = (await h.layers())[0];
  t.check('order and on/off state are saved with the project', l.effects.map((e) => `${e.type}:${e.enabled !== false}`).join() === 'blur:true,posterize:false');
  await h.selectRow(P.id);
  await props.getByRole('button', { name: 'Remove Blur' }).click();
  await props.getByRole('button', { name: 'Remove Posterize' }).click();
  t.check('removing every effect restores the original', (await stats()).signature === base.signature);
});

await section('Added effects: vibrance, colorize, motion blur', async () => {
  await h.selectRow(P.id);
  const base = await stats();
  await h.openTab('effects');
  t.check('36 effects are offered', (await page.locator('[data-effect]').count()) === 36, `${await page.locator('[data-effect]').count()}`);
  await effect('vibrance').click();
  const vivid = await stats();
  await effect('vibrance').click();
  t.check('vibrance changes the picture', vivid.signature !== base.signature && vivid.ink === base.ink);

  await effect('colorize').click();
  await hex('Colorize colour 1', '#ff0000');
  const pts = [[P.x + 40, P.y + 40], [P.x + P.width / 2, P.y + P.height / 2], [P.x + P.width - 40, P.y + P.height - 40]];
  const px = (await h.exportPng(pts, { transparent: true })).pixels;
  t.check('colorize turns every colour into shades of the chosen one', px.every((q) => q[0] >= q[1] && near(q[1], q[2], 4)), px.map(fmt).join(' '));
  await effect('colorize').click();

  await effect('motion-blur').click();
  const across = await stats();
  await h.setField('Direction value', 90, props);
  const down = await stats();
  const l = await h.layerById(P.id);
  t.check('motion blur has a direction, and changing it changes the result', l.effects[0].angle === 90 && across.signature !== base.signature && down.signature !== across.signature);
  await effect('motion-blur').click();
});

await section('Light from the highlights: bloom and light streaks', async () => {
  // A black picture with a white square in the middle and a dark grey square in a corner.
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(150, 100, 100, 100);
    ctx.fillStyle = '#606060';
    ctx.fillRect(20, 20, 60, 60);
    return c.toDataURL('image/png');
  });
  await h.patch(P.id, { visible: false });
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'light.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 2);
  const L = (await h.layers())[1];
  await h.patch(L.id, { x: 200, y: 150, width: 400, height: 300 });
  await h.selectRow(L.id);
  await h.openTab('effects');
  // On the canvas: the white square is 350..450 x 250..350, the grey one 220..280 x 170..230.
  const sample = async () => (await h.exportPng([[400, 300], [460, 300], [400, 240], [220, 400], [290, 200], [250, 200], [490, 300], [400, 215]], { transparent: true })).pixels;
  const plain = await sample();
  t.check('(the test picture: white, black and dark grey)', plain[0][0] === 255 && plain[1][0] === 0 && plain[5][0] === 96, plain.map(fmt).join(' '));

  const before = await past();
  await effect('bloom').click();
  let px = await sample();
  let l = await h.layerById(L.id);
  t.check('Bloom is added as an effect on the layer, in one undo step', l.effects.length === 1 && l.effects[0].type === 'bloom' && (await past()) === before + 1);
  t.check('the light part spills over its surroundings', px[1][0] > 20 && px[2][0] > 20 && px[0][0] === 255, px.map(fmt).join(' '));
  t.check('what is far from it stays black, and a dark tone gives off no glow', px[3][0] <= 4 && px[4][0] <= 4 && near(px[5][0], 96, 3), px.map(fmt).join(' '));
  t.check('the picture stays opaque', px.every((q) => q[3] === 255));
  const mild = px[1][0];
  await h.setField('Bloom value', 100, props);
  px = await sample();
  t.check('its slider sets how strong the glow is', px[1][0] > mild + 15, `${mild} -> ${px[1][0]}`);
  await effect('bloom').click();
  px = await sample();
  t.check('removing it restores the picture', (await h.layerById(L.id)).effects.length === 0 && px[1][0] === 0 && px[2][0] === 0);

  await effect('light-streaks').click();
  await h.setField('Direction value', 0, props);
  px = await sample();
  l = await h.layerById(L.id);
  t.check('Light streaks pull the light out along a direction (here sideways, not upwards)', l.effects[0].type === 'light-streaks' && l.effects[0].angle === 0 && px[6][0] > 30 && px[7][0] <= 6, px.map(fmt).join(' '));
  t.check('the picture underneath stays sharp: the white square and the grey one are as they were', px[0][0] === 255 && near(px[5][0], 96, 3) && px[3][0] <= 4, px.map(fmt).join(' '));
  await h.setField('Direction value', 90, props);
  px = await sample();
  t.check('Direction turns the streaks (now up and down, not sideways)', px[7][0] > 30 && px[6][0] <= 6, px.map(fmt).join(' '));
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(900);
  px = await sample();
  t.check('it is saved with the project', px[7][0] > 30 && (await h.layerById(L.id)).effects[0].angle === 90);
  await h.selectRow(L.id);
  await h.openTab('effects');
  await effect('light-streaks').click();

  await page.locator('[data-look="luminous"]').click();
  await h.settle(300);
  l = await h.layerById(L.id);
  px = await sample();
  t.check('the Luminous look combines them: black and white, bloom, streaks and grain', l.effects.map((e) => e.type).join() === 'bloom,light-streaks,noise' && l.adjustments.grayscale === 100 && px[1][0] > 20 && (await page.locator('[data-look="luminous"]').getAttribute('aria-pressed')) === 'true', l.effects.map((e) => e.type).join());
  await remove(L.id);
  await h.patch(P.id, { visible: true });
  await h.selectRow(P.id);
});

await section('Added textures and overlays; the texture workflow', async () => {
  const failed = [];
  for (const [tab, ids] of [['textures', ['texture/cardboard', 'texture/dirt', 'texture/distressed-edges', 'texture/dithering']], ['overlays', ['overlay/vhs', 'overlay/stars', 'overlay/light-shapes', 'overlay/sunlight']]]) {
    await h.openTab(tab);
    for (const id of ids) {
      await page.locator(`[data-generator="${id}"]`).click();
      const l = (await h.layers()).at(-1);
      await page.evaluate((keep) => window.__prysm.editor.getState().updateLayers([keep], { visible: false }), P.id);
      await h.patch(l.id, { blendMode: 'normal', opacity: 1 });
      const a = await stats();
      if (!(l.source?.generator === id && a.colours >= 2 && a.ink === 800 * 600)) failed.push(`${id}(${a.colours})`);
      await remove(l.id);
      await page.evaluate((keep) => window.__prysm.editor.getState().updateLayers([keep], { visible: true }), P.id);
    }
  }
  t.check('four more textures and four more overlays render as layers', failed.length === 0, failed.join(' '));

  // The workflow from the brief, on one texture: add, fade, blend, mask, move, duplicate, remove, reopen.
  await h.openTab('textures');
  await page.locator('[data-generator="texture/grunge"]').click();
  let G = (await h.layers()).at(-1);
  const photoOnly = (await h.layers())[0];
  await h.selectRow(G.id);
  await props.getByLabel('Opacity', { exact: true }).first().fill('60');
  await props.getByLabel('Blend mode', { exact: true }).selectOption('soft-light');
  await props.getByRole('button', { name: 'Add layer mask' }).click();
  await h.patch(G.id, { x: G.x + 40, y: G.y + 20, rotation: 8 });
  G = await h.layerById(G.id);
  t.check('a texture is a layer: opacity, blend mode, mask, position and rotation all apply', G.opacity === 0.6 && G.blendMode === 'soft-light' && G.masks.length === 1 && G.rotation === 8);
  t.check('the photo underneath is untouched', JSON.stringify((await h.layers())[0]) === JSON.stringify(photoOnly));
  await h.selectRow(G.id);
  await page.keyboard.press('Control+d');
  let ls = await h.layers();
  t.check('it can be duplicated', ls.length === 3 && ls[2].source.generator === 'texture/grunge' && ls[2].id !== G.id);
  await page.keyboard.press('Delete');
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(700);
  ls = await h.layers();
  t.check('and removed; the rest survives save and reopen', ls.length === 2 && ls[1].id === G.id && ls[1].blendMode === 'soft-light' && ls[1].masks.length === 1);
  await remove(G.id);
});

let T;
await section('Text: background, vertical, uploaded fonts', async () => {
  await remove(P.id);
  await h.openTab('text');
  await page.getByRole('button', { name: 'Add a heading' }).click();
  T = (await h.layers()).at(-1);
  await h.patch(T.id, { text: 'HHHH', fontSize: 80, width: 400, x: 200, y: 250, align: 'center', fill: { type: 'solid', color: '#ff0000' } });
  await page.evaluate(() => document.fonts.ready);
  await h.settle(500);
  const flat = await stats();
  await h.selectRow(T.id);
  await props.getByRole('switch', { name: 'Background', exact: true }).click();
  let l = await h.layerById(T.id);
  // Default padding is 30% of the font size = 24 px around the 400 x 96 text block.
  const inPad = [[200 - 12, 250 + 48], [200 + 200, 250 - 12], [200 - 40, 250 + 48]];
  let px = (await h.exportPng(inPad, { transparent: true })).pixels;
  t.check('a background panel is drawn behind the text, padded around it', l.effects.backdrop?.color === '#ffd166' && rgbNear(px[0], [255, 209, 102], 3) && rgbNear(px[1], [255, 209, 102], 3) && px[2][3] === 0, px.map(fmt).join(' '));
  await h.setField('Padding value', 60, props);
  px = (await h.exportPng(inPad, { transparent: true })).pixels;
  t.check('padding is adjustable', px[2][3] === 255, fmt(px[2]));
  const inside = (await h.exportPng([[flat.box.left + 5, (flat.box.top + flat.box.bottom) / 2]], { transparent: true })).pixels[0];
  t.check('the text is drawn over it, unchanged', rgbNear(inside, [255, 0, 0], 3), fmt(inside));
  await props.getByRole('switch', { name: 'Background', exact: true }).click();
  t.check('removing the background restores the plain text', (await stats()).signature === flat.signature);

  await props.getByRole('button', { name: /Vertical text/ }).click();
  await h.settle(300);
  l = await h.layerById(T.id);
  let a = await stats();
  t.check('vertical text stacks the letters; the words themselves are unchanged', l.vertical === true && l.text === 'HHHH' && a.box.bottom - a.box.top > (flat.box.bottom - flat.box.top) * 3 && a.box.right - a.box.left < (flat.box.right - flat.box.left) / 2, `${a.box.right - a.box.left} x ${a.box.bottom - a.box.top}`);
  await props.getByRole('button', { name: /Vertical text/ }).click();
  await h.settle(300);

  const fontFile = 'C:/Windows/Fonts/consola.ttf';
  if (!existsSync(fontFile)) {
    t.check('(font upload: Consolas not found on this machine; not tested)', true);
    return;
  }
  await props.getByRole('button', { name: 'Font family' }).click();
  const chips = await page.locator('[data-testid="font-menu"] button').filter({ hasText: /^(Decorative|Uploaded)$/ }).allTextContents();
  t.check('fonts are grouped, including Decorative and Uploaded', chips.includes('Decorative') && chips.includes('Uploaded'), chips.join(', '));
  await page.locator('[data-testid="font-upload-input"]').setInputFiles({ name: 'consola.ttf', mimeType: 'font/ttf', buffer: readFileSync(fontFile) });
  await page.waitForFunction((id) => window.__prysm.editor.getState().doc.layers.some((x) => x.id === id && x.fontFamily === 'consola'), T.id);
  await h.settle(500);
  a = await stats();
  const loaded = await page.evaluate(() => document.fonts.check('32px "consola"'));
  t.check('an uploaded font is applied to the text and changes how it is drawn', loaded && a.signature !== flat.signature && a.ink > 500, `${a.ink} ink pixels`);
  await page.keyboard.press('Escape');
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.waitForFunction(() => document.fonts.check('32px "consola"'));
  await h.settle(900);
  const again = await stats();
  t.check('the font is still there after a reload, and the text exports the same', (await h.layers()).at(-1).fontFamily === 'consola' && again.signature === a.signature);
});

await section('Colour tools: recent colours, RGB, eyedropper', async () => {
  await h.openTab('elements');
  await page.locator('[data-icon="star"]').click();
  const I = (await h.layers()).at(-1);
  await h.selectRow(I.id);
  await hex('Icon colour', '#123456');
  await h.settle(700);
  await hex('Icon colour', '#abcdef');
  await h.settle(700);
  await props.getByRole('button', { name: 'More options for icon colour' }).click();
  const tools = page.locator('[data-testid="color-tools"]');
  await tools.waitFor();
  const recent = await tools.locator('[data-recent-color]').evaluateAll((els) => els.map((e) => e.dataset.recentColor));
  t.check('colours that were used are offered again, newest first', recent[0] === '#abcdef' && recent[1] === '#123456', recent.join(', '));
  t.check('RGB values are shown', (await tools.getByLabel('Icon colour red').inputValue()) === '171' && (await tools.getByLabel('Icon colour blue').inputValue()) === '239');
  await h.setField('Icon colour green', 0, tools);
  t.check('and editable', (await h.layerById(I.id)).stroke.color === '#ab00ef');
  await tools.locator('[data-recent-color="#123456"]').click();
  t.check('a recent colour is applied with one click', (await h.layerById(I.id)).stroke.color === '#123456');
  const supported = await page.evaluate(() => 'EyeDropper' in window);
  t.check('the screen eyedropper is offered where the browser has one', (await tools.getByRole('button', { name: /Pick a colour from the screen/ }).count()) === (supported ? 1 : 0), `EyeDropper API ${supported ? 'present' : 'absent'} (picking itself cannot be automated)`);
  await page.keyboard.press('Escape');
  t.check('Escape closes the colour tools without touching the selection', (await tools.count()) === 0 && (await state(page)).selectedIds.join() === I.id);
  await remove(I.id);
});

await section('Library: favourites, recent, details, lazy previews', async () => {
  await h.openTab('textures');
  const tiles = page.locator('[data-generator]');
  const total = await tiles.count();
  await h.settle(600);
  const drawn = await page.locator('[data-generator] img').count();
  t.check('previews are drawn only for tiles that are on screen', total === 39 && drawn > 0 && drawn < total, `${drawn} of ${total} drawn on opening`);
  await tiles.last().scrollIntoViewIfNeeded();
  await page.locator('[data-generator] img').nth(drawn).waitFor();
  t.check('and for the rest as they scroll into view', (await page.locator('[data-generator] img').count()) > drawn);
  const title = await page.locator('[data-generator="texture/grunge"]').getAttribute('title');
  t.check('a tile states what the asset is and its licence', title.includes('Grunge') && title.includes('Vintage') && /Original work/.test(title), title.replace(/\n/g, ' | '));

  await page.locator('[data-generator="texture/marble"]').hover();
  await page.locator('[data-favourite="texture/marble"]').click();
  await page.getByRole('button', { name: 'Favourites', exact: true }).click();
  let shown = await page.locator('[data-generator]').evaluateAll((els) => els.map((e) => e.dataset.generator));
  t.check('a starred texture appears under Favourites', shown.join() === 'texture/marble');
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  shown = await page.locator('[data-generator]').evaluateAll((els) => els.map((e) => e.dataset.generator));
  t.check('Recent lists what was added, newest first', shown[0] === 'texture/grunge' && shown.includes('texture/dithering') && !shown.includes('texture/marble'), shown.join(', '));

  await h.openTab('elements');
  await page.locator('[data-icon="rocket"]').hover();
  await page.locator('[data-favourite="icon/rocket"]').click();
  await page.locator('[data-graphic="sticker/sun"]').click();
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.openTab('elements');
  await page.getByRole('button', { name: 'Favourites', exact: true }).click();
  const favIcons = await page.locator('[data-icon]').evaluateAll((els) => els.map((e) => e.dataset.icon));
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  const recentGraphics = await page.locator('[data-graphic]').evaluateAll((els) => els.map((e) => e.dataset.graphic));
  t.check('favourites and recent items are remembered across reloads', favIcons.join() === 'rocket' && recentGraphics.includes('sticker/sun'), `favourites: ${favIcons.join()}; recent: ${recentGraphics.join()}`);
  const iconTitle = await page.locator('[data-icon="star"]').getAttribute('title');
  t.check('third-party assets carry their licence', /ISC License/.test(iconTitle), iconTitle.replace(/\n/g, ' | '));
  await page.getByRole('button', { name: 'All', exact: true }).click();
});

await section('Shape outline styles', async () => {
  for (const l of await h.layers()) await remove(l.id);
  await h.openTab('elements');
  await page.getByTitle('Rectangle', { exact: true }).click();
  const R = (await h.layers()).at(-1);
  await h.patch(R.id, { x: 100, y: 150, width: 600, height: 300, fill: null, stroke: { color: '#000000', width: 10 } });
  await h.selectRow(R.id);
  const row = Array.from({ length: 560 }, (_, i) => [120 + i, 150]);
  const runs = async () => {
    const px = (await h.exportPng(row, { transparent: true })).pixels;
    let n = 0;
    for (let i = 1; i < px.length; i++) if (px[i][3] > 128 !== px[i - 1][3] > 128) n++;
    return n;
  };
  const solid = await runs();
  await page.locator('[data-testid="stroke-style"]').getByRole('button', { name: 'Dashed' }).click();
  const dashed = await runs();
  await page.locator('[data-testid="stroke-style"]').getByRole('button', { name: 'Dotted' }).click();
  const dotted = await runs();
  t.check('an outline can be solid, dashed or dotted', solid === 0 && dashed >= 16 && dotted > dashed && (await h.layerById(R.id)).stroke.dash === 'dotted', `${solid} / ${dashed} / ${dotted} gaps along the top edge`);
});

await section('PDF export', async () => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.locator('[data-testid="export-dialog"]');
  await dlg.getByRole('button', { name: 'PDF', exact: true }).click();
  await dlg.getByRole('button', { name: '2×', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Export PDF' }).click()]);
  const pdf = readFileSync(await download.path());
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'detached' });
  const text = pdf.toString('latin1');
  t.check('the file is a PDF named after the project', text.startsWith('%PDF-1.4') && text.trimEnd().endsWith('%%EOF') && download.suggestedFilename().endsWith('.pdf'), download.suggestedFilename());
  // 800 x 600 px at 96 px per inch = 600 x 450 pt.
  t.check('its one page is the canvas at 96 px per inch', /\/MediaBox \[0 0 600 450\]/.test(text) && /\/Count 1/.test(text));
  const xref = Number(text.match(/startxref\n(\d+)/)?.[1]);
  const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  t.check('its cross-reference table points at every object', text.slice(xref, xref + 4) === 'xref' && offsets.length === 5 && offsets.every((o, i) => text.slice(o, o + 7) === `${i + 1} 0 obj`), offsets.join(', '));
  const start = text.indexOf('stream\n', offsets[3]) + 7;
  const length = Number(text.slice(offsets[3], start).match(/\/Length (\d+)/)[1]);
  const image = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    return { width: bmp.width, height: bmp.height, edge: Array.from(ctx.getImageData(800, 300, 1, 1).data), fill: Array.from(ctx.getImageData(800, 600, 1, 1).data) };
  }, pdf.subarray(start, start + length).toString('base64'));
  t.check('the embedded picture is the design at the chosen scale', image.width === 1600 && image.height === 1200 && /\/Width 1600 \/Height 1200/.test(text) && image.edge[0] < 60 && image.fill[0] > 240, `${image.width}x${image.height}, outline ${fmt(image.edge)}, inside ${fmt(image.fill)}`);
});

await section('Added templates', async () => {
  await h.openTab('templates');
  const cats = await page.locator('[data-testid="sidebar-panel"] button[aria-pressed]').allTextContents();
  t.check('18 templates, now with invitations, certificates and wallpapers', (await page.locator('[data-template]').count()) === 18 && ['Invitation', 'Certificate', 'Wallpaper'].every((c) => cats.includes(c)), cats.join(', '));
  const problems = [];
  for (const id of ['invitation', 'certificate', 'wallpaper']) {
    await page.locator(`[data-template="${id}"]`).click();
    await h.settle(150);
    const dlg = page.locator('[data-testid="confirm-dialog"]');
    if (await dlg.count()) await dlg.locator('button').last().click();
    await h.settle(500);
    const s = await state(page);
    if (s.doc.layers.length < 5 || s.doc.layers.filter((l) => l.type === 'text').length < 1) problems.push(`${id}(${s.doc.layers.length})`);
  }
  t.check('each builds an editable design', problems.length === 0, problems.join(' '));
  await page.evaluate(() => document.fonts.ready);
  await h.settle(1500);
  const a = await h.stats((await h.exportPng([])).buffer);
  t.check('the wallpaper exports at 1920 × 1080 with its overlays and glow', a.width === 1920 && a.height === 1080 && a.colours > 6, `${a.colours} colour groups`);
});

t.check('no browser errors or native dialogs', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
