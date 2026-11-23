/**
 * Milestone 3: creative tools. Text effects, text on a path, the icon / graphic library and
 * "My assets", new effects and looks, pattern backgrounds, composition guides and spacing,
 * the new templates. Everything is driven through the interface and checked in exported pixels.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, toScreen, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const past = async () => (await state(page)).past;
const clear = (opts = {}) => h.exportPng([], { transparent: true, ...opts });
const stats = async (opts = {}, exportOpts = {}) => h.stats((await clear(exportOpts)).buffer, opts);
const zoomNow = () => page.evaluate(() => window.__prysm.ui.getState().zoom);
const remove = (id) => page.evaluate((id) => window.__prysm.editor.getState().deleteLayers([id]), id);
const fx = (name) => props.getByRole('switch', { name, exact: true });
const hex = (label, value) => h.setField(`${label} hex`, value, props);

let T; // a red text layer
let flat;
const X = 100;
const Y = 220;
const W = 600;

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  await h.openTab('text');
  await page.getByRole('button', { name: 'Add a heading' }).click();
  T = (await h.layers()).at(-1);
  await h.patch(T.id, { text: 'HHHH', fontSize: 100, width: W, x: X, y: Y, align: 'center', fill: { type: 'solid', color: '#ff0000' } });
  await page.evaluate(() => document.fonts.ready);
  await h.settle(500);
  T = await h.layerById(T.id);
  t.check('new text has no effects and no path', T.path === null && Object.values(T.effects).every((v) => v === null) && (await state(page)).doc.schemaVersion === 6);
  flat = await stats();
  t.check('(the flat text is measurable)', flat.ink > 3000 && flat.soft < flat.ink * 0.2, `${flat.ink} ink pixels`);
});

await section('Text effects: glow', async () => {
  await h.selectRow(T.id);
  const before = await past();
  await fx('Glow').click();
  let l = await h.layerById(T.id);
  t.check('Glow is a setting on the text layer, one undo step', l.effects.glow?.color === '#00e5ff' && l.type === 'text' && l.text === 'HHHH' && (await past()) === before + 1);
  const above = [[X + W / 2, flat.box.top - 10]];
  let px = (await h.exportPng(above, { transparent: true })).pixels[0];
  t.check('light spills outside the letters, in the glow colour', px[3] > 40 && px[0] < 80 && px[2] > 150, fmt(px));
  const glow = await stats();
  const inside = (await h.exportPng([[flat.box.left + 6, (flat.box.top + flat.box.bottom) / 2]], { transparent: true })).pixels[0];
  t.check('the letters themselves are unchanged', rgbNear(inside, [255, 0, 0], 2) && inside[3] === 255 && glow.soft > flat.soft * 3, `inside a letter ${fmt(inside)}; ${glow.soft} soft pixels vs ${flat.soft}`);
  await hex('Glow colour', '#ff00ff');
  px = (await h.exportPng(above, { transparent: true })).pixels[0];
  t.check('the glow colour can be changed', px[0] > 150 && px[1] < 80 && px[2] > 150, fmt(px));
  await h.setField('Size value', 5, props);
  px = (await h.exportPng(above, { transparent: true })).pixels[0];
  t.check('a small glow no longer reaches as far', px[3] < 30, fmt(px));
  await fx('Glow').click();
  const off = await stats();
  t.check('switching it off restores the plain text exactly', (await h.layerById(T.id)).effects.glow === null && off.signature === flat.signature);
});

await section('Text effects: 3D depth, shine and distress', async () => {
  await h.selectRow(T.id);
  await fx('3D depth').click();
  let l = await h.layerById(T.id);
  let a = await stats();
  const reach = 0.12 * 100 * Math.SQRT1_2;
  t.check('3D depth extends the letters down and to the right by the set depth', near(a.box.right - flat.box.right, reach, 2) && near(a.box.bottom - flat.box.bottom, reach, 2) && a.box.left === flat.box.left && a.box.top === flat.box.top, `right +${a.box.right - flat.box.right}, bottom +${a.box.bottom - flat.box.bottom} (expected ${reach.toFixed(1)})`);
  await h.setField('Angle value', 180, props);
  a = await stats();
  t.check('the angle turns the block', near(flat.box.left - a.box.left, 12, 2) && near(a.box.right, flat.box.right, 1), `left -${flat.box.left - a.box.left}`);
  const two = await stats({}, { scale: '2×' });
  t.check('effects scale with the export', near(two.box.left, a.box.left * 2, 3) && near(two.box.right, a.box.right * 2 + 1, 3), JSON.stringify(two.box));
  await fx('3D depth').click();

  await fx('Metallic shine').click();
  a = await stats();
  t.check('Metallic shine lights one edge and shades the other, inside the letters', a.lighter > 150 && a.darker > 150 && near(a.ink, flat.ink, flat.ink * 0.02), `${a.lighter} lit, ${a.darker} shaded pixels`);
  await fx('Metallic shine').click();

  await fx('Distress').click();
  l = await h.layerById(T.id);
  a = await stats();
  const worn = 1 - a.ink / flat.ink;
  // The default wear of 35% is calibrated to remove about a quarter of the ink (0.7 x 35%).
  t.check('Distress wears away the share of ink it is set to', near(worn, 0.245, 0.09) && a.box.left >= flat.box.left, `${(worn * 100).toFixed(1)}% removed (expected about 24.5%)`);
  await h.setField('Wear value', 90, props);
  const heavy = await stats();
  t.check('more wear removes more', heavy.ink < a.ink * 0.9, `${a.ink} -> ${heavy.ink}`);
  await h.setField('Wear value', 35, props);
  await props.getByRole('button', { name: 'New wear pattern' }).click();
  const rerolled = await stats();
  t.check('a new wear pattern differs but wears about as much', rerolled.signature !== a.signature && near(rerolled.ink / a.ink, 1, 0.2), `${a.ink} vs ${rerolled.ink}`);
  const twice = await stats();
  t.check('the same settings always give the same picture', twice.signature === rerolled.signature);

  // Still a text layer: edit the words with the effect on.
  const c = await toScreen(page, X + W / 2, Y + 60);
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.locator('[data-testid="text-editor"]');
  await editor.waitFor();
  await editor.fill('HH');
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  await page.mouse.click(host.x + 12, host.y + 12);
  await editor.waitFor({ state: 'detached' });
  l = await h.layerById(T.id);
  t.check('text with effects is still edited by double-click', l.text === 'HH' && l.effects.distress?.amount === 0.35);
  await h.patch(T.id, { text: 'HHHH', effects: { glow: null, extrude: null, bevel: null, distress: null } });
  await h.settle(200);
});

await section('Text on a path', async () => {
  await h.selectRow(T.id);
  await props.getByLabel('Warp shape').selectOption('arch');
  const before = await past();
  await props.getByLabel('Text path').selectOption('curve');
  let l = await h.layerById(T.id);
  t.check('choosing a path stores it and replaces the warp', l.path?.kind === 'curve' && l.path.points.length === 8 && l.warp === null && (await past()) === before + 1);
  let a = await stats();
  t.check('the letters follow the curve instead of a straight line', a.box.bottom - a.box.top > flat.box.bottom - flat.box.top + 25 && a.ink > flat.ink * 0.6, `ink height ${flat.box.bottom - flat.box.top} -> ${a.box.bottom - a.box.top}`);

  // Drag the first control point upwards.
  const pts = l.path.points;
  const from = await toScreen(page, X + pts[2] * W, Y + pts[3] * l.height);
  const zoom = await zoomNow();
  const history = await past();
  await h.drag(from, { x: from.x, y: from.y - 60 * zoom });
  l = await h.layerById(T.id);
  t.check('dragging a control point bends the path', near((l.path.points[3] - pts[3]) * l.height, -60, 2) && l.path.points[0] === pts[0] && l.path.points[7] === pts[7], `moved ${((l.path.points[3] - pts[3]) * l.height).toFixed(1)} px`);
  t.check('a drag is one undo step', (await past()) === history + 1);
  const bent = await stats();
  t.check('the text follows the new curve', bent.signature !== a.signature && bent.box.top < a.box.top);
  // Dragging an end moves its control point with it.
  const end = await toScreen(page, X + l.path.points[6] * W, Y + l.path.points[7] * l.height);
  const p0 = l.path.points;
  await h.drag(end, { x: end.x + 40 * zoom, y: end.y });
  l = await h.layerById(T.id);
  t.check('an end point carries its control point', near((l.path.points[6] - p0[6]) * W, 40, 2) && near(l.path.points[4] - p0[4], l.path.points[6] - p0[6], 1e-6) && l.path.points[2] === p0[2]);

  // Around a circle: the baseline sits on the circle whose diameter is the box width.
  await h.patch(T.id, { text: 'HHHHHHHHHH', fontSize: 40, width: 300, x: 250, y: 280 });
  await props.getByLabel('Text path').selectOption('circle');
  l = await h.layerById(T.id);
  const centre = { x: 250 + 150, y: 280 + l.height / 2 };
  a = await stats({ centre });
  t.check('circle: every letter stands on the circle, pointing outwards', l.path.kind === 'circle' && !l.path.flip && a.polar.rMin > 150 - 3 && a.polar.rMin < 150 + 4 && a.polar.rMax < 150 + 40 && a.meanY < centre.y, `ink radius ${a.polar.rMin.toFixed(1)}..${a.polar.rMax.toFixed(1)}, centred above`);
  await props.getByLabel('Text path').selectOption('circle-bottom');
  a = await stats({ centre });
  t.check('circle, text below: letters hang inside the bottom of the circle', a.polar.rMax < 150 + 4 && a.polar.rMax > 150 - 4 && a.polar.rMin > 150 - 40 && a.meanY > centre.y, `ink radius ${a.polar.rMin.toFixed(1)}..${a.polar.rMax.toFixed(1)}, centred below`);
  const screen = await h.screenPixels([[centre.x, centre.y]]);
  t.check('the middle of the circle is empty on screen too', rgbNear(screen[0], [255, 255, 255], 4), fmt(screen[0]));

  await fx('Glow').click();
  const glowing = await stats({ centre });
  t.check('effects apply to text on a path', glowing.soft > a.soft * 2 && (await h.layerById(T.id)).path.kind === 'circle');
  await fx('Glow').click();
  await props.getByLabel('Warp shape').selectOption('arc');
  l = await h.layerById(T.id);
  t.check('choosing a warp replaces the path', l.warp?.style === 'arc' && l.path === null);
  await props.getByLabel('Warp shape').selectOption('none');
});

await section('Effect styles', async () => {
  await h.openTab('text');
  const made = [];
  for (const [label, key] of [['Neon', 'glow'], ['GOLD', 'bevel'], ['RETRO 3D', 'extrude'], ['STAMPED', 'distress']]) {
    await page.locator(`[data-text-style="${label}"]`).click();
    const l = (await h.layers()).at(-1);
    made.push(l.id);
    if (!(l.type === 'text' && l.effects[key])) t.check(`${label} style sets ${key}`, false, JSON.stringify(l.effects));
  }
  const ls = await h.layers();
  t.check('Neon, Gold, Retro 3D and Stamped styles add ordinary text layers with effects', made.length === 4 && ls.filter((l) => made.includes(l.id)).every((l) => l.type === 'text'));
  for (const id of made) await remove(id);
});

let I; // icon
let S; // sticker
await section('Icons and graphics', async () => {
  await remove(T.id);
  await h.openTab('elements');
  const iconCount = await page.locator('[data-icon]').count();
  const graphicCount = await page.locator('[data-graphic]').count();
  t.check('the library offers icons, stickers, frames, illustrations and geometric elements', iconCount >= 150 && graphicCount === 42, `${iconCount} icons, ${graphicCount} graphics`);
  await page.locator('[data-icon="heart"]').click();
  I = (await h.layers()).at(-1);
  t.check('an icon is a vector shape layer', I.type === 'shape' && I.shape === 'icon' && I.icon === 'heart' && I.fill === null && I.stroke.width > 0 && I.width === I.height, JSON.stringify({ w: I.width, stroke: I.stroke }));
  let a = await stats({ match: [29, 30, 34] });
  t.check('it is drawn as a line icon in its colour', a.matched > 300 && a.ink < I.width * I.height * 0.5, `${a.matched} stroke pixels`);
  await h.selectRow(I.id);
  await hex('Icon colour', '#ff0000');
  a = await stats({ match: [255, 0, 0] });
  t.check('the icon can be recoloured', a.matched > 300 && (await h.layerById(I.id)).stroke.color === '#ff0000');
  const corner = await toScreen(page, I.x + I.width, I.y + I.height);
  const zoom = await zoomNow();
  await h.drag(corner, { x: corner.x + 80 * zoom, y: corner.y + 80 * zoom });
  const big = await h.layerById(I.id);
  t.check('resizing an icon scales its line weight with it', big.width > I.width + 40 && near(big.stroke.width / I.stroke.width, big.width / I.width, 0.05) && near(big.width, big.height, 1), `x${(big.width / I.width).toFixed(2)} size, x${(big.stroke.width / I.stroke.width).toFixed(2)} line`);
  const one = await stats();
  const two = await stats({}, { scale: '2×' });
  t.check('icons stay sharp when exported larger', two.soft / two.ink < (one.soft / one.ink) * 0.8, `soft edge share ${(one.soft / one.ink).toFixed(3)} at 1×, ${(two.soft / two.ink).toFixed(3)} at 2×`);
  await h.patch(I.id, { x: 40, y: 40, width: 120, height: 120 });

  await page.locator('[data-graphic="sticker/heart"]').click();
  S = (await h.layers()).at(-1);
  t.check('a sticker is a graphic layer with its own palette', S.shape === 'graphic' && S.graphic === 'sticker/heart' && S.colors.length >= 1, JSON.stringify(S.colors));
  await h.patch(S.id, { x: 300, y: 200 });
  await h.selectRow(S.id);
  await hex('Graphic colour 1', '#00ff00');
  a = await stats({ match: [0, 255, 0], tolerance: 4 });
  t.check('its colours can be changed', a.matched > 2000 && (await h.layerById(S.id)).colors[0] === '#00ff00', `${a.matched} green pixels`);
  await props.getByRole('button', { name: 'Original colours' }).click();
  t.check('and reset', (await h.layerById(S.id)).colors.join() === S.colors.join());
  await h.patch(S.id, { opacity: 0.5, shadow: { color: '#0000ff', blur: 0, offsetX: 0, offsetY: 300, opacity: 1 } });
  const half = (await h.exportPng([[300 + S.width / 2, 200 + S.height / 2], [300 + S.width / 2, 500 + S.height / 2 - 20]], { transparent: true })).pixels;
  t.check('opacity and shadow treat the graphic as one object', near(half[0][3], 128, 3) && half[1][2] > 200 && near(half[1][3], 128, 3), half.map(fmt).join(' '));
  await h.patch(S.id, { opacity: 1, shadow: null });

  await page.locator('[data-graphic="frame/double-line"]').click();
  const F = (await h.layers()).at(-1);
  // Put the frame on an empty part of the canvas, clear of the icon and the sticker.
  await h.patch(F.id, { x: 20, y: 300, width: 240, height: 280 });
  F.x = 20;
  F.y = 300;
  F.width = 240;
  F.height = 280;
  const mid = (await h.exportPng([[F.x + F.width / 2, F.y + F.height / 2], [F.x + 3, F.y + F.height / 2]], { transparent: true })).pixels;
  t.check('a frame leaves its middle open', F.graphic === 'frame/double-line' && mid[0][3] === 0 && mid[1][3] > 100, mid.map(fmt).join(' '));
  await h.patch(F.id, { width: 500, height: 200, x: 150, y: 380 });
  const wide = (await h.exportPng([[400, 480], [153, 480], [400, 383]], { transparent: true })).pixels;
  t.check('frames can be stretched to any proportion', wide[0][3] === 0 && wide[1][3] > 200 && wide[2][3] > 200, wide.map(fmt).join(' '));
  await remove(F.id);

  await page.getByLabel('Search shapes, icons, stickers…').fill('heart');
  await h.settle(200);
  const found = await page.locator('[data-icon], [data-graphic]').evaluateAll((els) => els.map((e) => e.dataset.icon ?? e.dataset.graphic));
  t.check('search finds icons and graphics by name', found.includes('heart') && found.includes('sticker/heart') && found.length < 12, found.join(', '));
  await page.getByLabel('Search shapes, icons, stickers…').fill('');
});

await section('My assets: reuse across projects', async () => {
  await h.selectRow(I.id);
  await h.selectRow(S.id, ['Shift']);
  await page.getByRole('button', { name: 'Save selection to My assets' }).click();
  const tiles = page.locator('[data-saved-design]');
  await tiles.first().waitFor();
  t.check('the selection is saved with a thumbnail', (await tiles.count()) === 1 && (await tiles.locator('img').count()) === 1);
  const original = (await h.layers()).filter((l) => [I.id, S.id].includes(l.id));
  await waitForSaved(page);

  await page.getByRole('button', { name: 'Projects' }).click();
  const dlg = page.getByRole('dialog', { name: 'Projects' });
  await dlg.getByLabel('New project name').fill('Second design');
  await dlg.getByRole('button', { name: 'Create' }).click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  t.check('(a new, empty project is open)', (await h.layers()).length === 0 && (await state(page)).doc.name === 'Second design');
  await h.openTab('elements');
  await page.locator('[data-saved-design] button').first().click();
  const copies = await h.layers();
  const dx = copies[1]?.x - copies[0]?.x;
  t.check('the asset is inserted into another project as editable layers', copies.length === 2 && copies[0].shape === 'icon' && copies[1].graphic === 'sticker/heart' && copies.every((c) => !original.some((o) => o.id === c.id)), copies.map((c) => c.shape).join(', '));
  t.check('with its layout and styling intact', near(dx, original[1].x - original[0].x, 1) && copies[0].stroke.color === '#ff0000' && (await state(page)).selectedIds.length === 2);
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.openTab('elements');
  await page.locator('[data-saved-design]').first().waitFor();
  t.check('My assets survive a reload', (await page.locator('[data-saved-design]').count()) === 1);
  await page.locator('[data-saved-design]').first().hover();
  await page.getByRole('button', { name: /Remove .* from My assets/ }).click();
  await page.locator('[data-saved-design]').first().waitFor({ state: 'detached' });
  t.check('an asset can be removed; layers already placed stay', (await page.locator('[data-saved-design]').count()) === 0 && (await h.layers()).length === 2);
});

let P; // a photo
await section('Effects: colour grading, lighting, distortion, artistic', async () => {
  for (const l of await h.layers()) await remove(l.id);
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
      ctx.fillStyle = `hsl(${i * 47} 80% ${30 + (i % 5) * 12}%)`;
      ctx.fillRect((i * 97) % 600, (i * 61) % 440, 44, 44);
    }
    return c.toDataURL('image/png');
  });
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 1);
  P = (await h.layers())[0];
  await h.selectRow(P.id);
  const base = await stats();
  await h.openTab('effects');
  const fresh = ['teal-orange', 'split-tone', 'bleach-bypass', 'cross-process', 'spotlight', 'ripple', 'bulge', 'pinch', 'swirl', 'oil-paint', 'emboss'];
  const broken = [];
  const signatures = new Set([base.signature]);
  for (const type of fresh) {
    await page.locator(`[data-effect="${type}"]`).click();
    const a = await stats();
    if (a.signature === base.signature || a.ink !== base.ink || a.colours < 8) broken.push(`${type}(${a.ink}/${base.ink}, ${a.colours} colours)`);
    signatures.add(a.signature);
    await page.locator(`[data-effect="${type}"]`).click();
  }
  t.check('each of the 11 new effects changes the picture and keeps its shape', broken.length === 0 && signatures.size === fresh.length + 1, broken.join(' ') || `${signatures.size - 1} distinct results`);
  const restored = await stats();
  t.check('removing an effect restores the original exactly', restored.signature === base.signature && (await h.layerById(P.id)).effects.length === 0);
  t.check('at least 31 effects are offered (the exact count is checked in creative-tools.mjs)', (await page.locator('[data-effect]').count()) >= 31, `${await page.locator('[data-effect]').count()}`);

  // Duotone with chosen inks: black to white is a plain greyscale.
  await page.locator('[data-effect="duotone"]').click();
  await h.selectRow(P.id);
  await hex('Duotone colour 1', '#000000');
  await hex('Duotone colour 2', '#ffffff');
  const pts = [[P.x + 30, P.y + 30], [P.x + P.width / 2, P.y + P.height / 2], [P.x + P.width - 30, P.y + P.height - 30]];
  let px = (await h.exportPng(pts, { transparent: true })).pixels;
  const fxNow = (await h.layerById(P.id)).effects[0];
  t.check('duotone uses the two chosen colours', fxNow.colors.join() === '#000000,#ffffff' && px.every((q) => near(q[0], q[1], 3) && near(q[1], q[2], 3)) && px[0][0] < px[2][0], px.map(fmt).join(' '));
  await hex('Duotone colour 1', '#ff0000');
  px = (await h.exportPng(pts, { transparent: true })).pixels;
  t.check('changing an ink recolours the shadows', px[0][0] > px[0][1] + 60, fmt(px[0]));
  await page.locator('[data-effect="duotone"]').click();
});

await section('Looks', async () => {
  await h.selectRow(P.id);
  const base = await stats();
  t.check('15 looks are offered', (await page.locator('[data-look]').count()) === 15);
  const before = await past();
  await page.locator('[data-look="blockbuster"]').click();
  let l = await h.layerById(P.id);
  t.check('a look sets adjustments and effects in one undo step', l.adjustments.contrast === 12 && l.effects.map((e) => e.type).join() === 'teal-orange,vignette' && (await past()) === before + 1);
  t.check('the tile shows it is applied', (await page.locator('[data-look="blockbuster"]').getAttribute('aria-pressed')) === 'true');
  const graded = await stats();
  t.check('the picture is graded', graded.signature !== base.signature && graded.ink === base.ink);
  await h.setField('Teal & orange value', 30, props);
  l = await h.layerById(P.id);
  t.check('every part of a look stays adjustable', l.effects[0].amount === 0.3 && (await page.locator('[data-look="blockbuster"]').getAttribute('aria-pressed')) === 'false');
  await page.locator('[data-look="noir"]').click();
  l = await h.layerById(P.id);
  t.check('another look replaces it', l.effects[0].type === 'noir' && l.adjustments.contrast === 22);
  await page.locator('[data-look="noir"]').click();
  l = await h.layerById(P.id);
  const plain = await stats();
  t.check('clicking the active look removes it; the original is untouched', l.effects.length === 0 && l.adjustments.contrast === 0 && plain.signature === base.signature);
});

await section('Pattern backgrounds', async () => {
  await h.openTab('backgrounds');
  const failed = [];
  for (const id of ['chevron', 'graph-grid', 'checker', 'wave-lines', 'memphis', 'rings']) {
    await page.locator(`[data-generator="background/${id}"]`).click();
    const ls = await h.layers();
    const a = await stats();
    if (!(ls[0].source?.generator === `background/${id}` && a.colours >= 2 && a.ink === 800 * 600)) failed.push(`${id}(${a.colours})`);
    await remove(ls[0].id);
  }
  t.check('six new patterns are added behind the design as editable layers', failed.length === 0, failed.join(' '));
});

await section('Composition guides and spacing', async () => {
  await remove(P.id);
  await h.openTab('elements');
  const rect = async (x, y, w = 100, hgt = 100) => {
    await page.getByTitle('Rectangle', { exact: true }).click();
    const l = (await h.layers()).at(-1);
    await h.patch(l.id, { x, y, width: w, height: hgt });
    return l.id;
  };
  const A = await rect(40, 250);
  const C = await rect(600, 250);
  const B = await rect(290, 250);
  await page.keyboard.press('Escape');
  const file = await stats();
  const shot = async () => {
    await page.mouse.move(4, 4);
    return h.stats(await page.locator('[data-testid="canvas-host"]').screenshot(), { match: [61, 220, 151], tolerance: 40 });
  };
  const before = await shot();
  await h.viewOption(async (menu) => {
    await menu.getByRole('switch', { name: 'Show rule of thirds' }).click();
    await menu.getByRole('switch', { name: 'Show centre lines' }).click();
    await menu.getByRole('switch', { name: 'Show safe margins' }).click();
  });
  const after = await shot();
  // The centre lines are drawn in the accent colour; the others change the picture as well.
  t.check('thirds, centre lines and safe margins are drawn over the canvas', after.signature !== before.signature && after.matched > before.matched + 300, `${after.matched - before.matched} accent-coloured pixels added`);
  t.check('guides are never exported', (await stats()).signature === file.signature);

  // Safe margin: 6% of the shorter side = 36 px. Drag A so its left edge lands 4 px from it.
  const zoom = await zoomNow();
  let l = await h.layerById(A);
  let c = await toScreen(page, l.x + 50, l.y + 50);
  await h.drag(c, { x: c.x - 8 * zoom, y: c.y + 140 * zoom });
  l = await h.layerById(A);
  t.check('layers snap to the safe margin', l.x === 36, `x=${l.x}`);
  await h.patch(A, { x: 40, y: 250 });

  // Equal spacing: between A (40..140) and C (600..700) the even position for B is x = 320.
  l = await h.layerById(B);
  c = await toScreen(page, l.x + 50, l.y + 50);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + ((27 * i) / 8) * zoom, c.y);
  const live = await page.evaluate(() => window.__prysm.ui.getState().spacingMarks.length);
  await page.mouse.up();
  await h.settle();
  l = await h.layerById(B);
  t.check('a layer snaps to equal gaps between its neighbours', near(l.x, 320, 0.01) && near(l.x - 140, 600 - (l.x + 100), 0.01), `x=${l.x}, gaps ${l.x - 140} and ${600 - (l.x + 100)}`);
  t.check('the two equal gaps are marked while dragging, then cleared', live === 2 && (await page.evaluate(() => window.__prysm.ui.getState().spacingMarks.length)) === 0, `${live} marks`);
  await h.viewOption(async (menu) => {
    await menu.getByRole('switch', { name: 'Show rule of thirds' }).click();
    await menu.getByRole('switch', { name: 'Show centre lines' }).click();
    await menu.getByRole('switch', { name: 'Show safe margins' }).click();
  });
  for (const id of [A, B, C]) await remove(id);
});

await section('Workspace', async () => {
  const host = page.locator('[data-testid="canvas-host"]');
  const wide = (await host.boundingBox()).width;
  await page.keyboard.press('Control+\\');
  await h.settle(200);
  const full = (await host.boundingBox()).width;
  t.check('Ctrl+\\ hides both panels to give the canvas the window', full > wide + 500 && (await page.locator('[data-testid="layers-panel"]').count()) === 0, `${Math.round(wide)} -> ${Math.round(full)} px`);
  await page.keyboard.press('Control+\\');
  await h.settle(200);
  const layers = page.locator('[data-testid="layers-panel"]');
  const h0 = (await layers.boundingBox()).height;
  const divider = await page.locator('[data-testid="layers-divider"]').boundingBox();
  await h.drag({ x: divider.x + 60, y: divider.y + 3 }, { x: divider.x + 60, y: divider.y - 140 });
  const h1 = (await layers.boundingBox()).height;
  t.check('the divider resizes the layers panel', h1 > h0 + 100, `${Math.round(h0)} -> ${Math.round(h1)} px`);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  t.check('and the split is remembered', near((await page.locator('[data-testid="layers-panel"]').boundingBox()).height, h1, 6));
});

await section('Templates', async () => {
  await h.openTab('templates');
  const count = await page.locator('[data-template]').count();
  t.check('at least 15 templates across posters, covers, social, banners, thumbnails and flyers', count >= 15, `${count}`);
  const problems = [];
  for (const id of ['neon-night', 'retro-fest', 'album-gold', 'story-sale', 'insta-launch', 'channel-banner', 'web-banner', 'thumb-challenge', 'flyer-market']) {
    await page.locator(`[data-template="${id}"]`).click();
    const dlg = page.locator('[data-testid="confirm-dialog"]');
    await h.settle(150);
    if (await dlg.count()) await dlg.locator('button').last().click();
    await h.settle(500);
    const s = await state(page);
    const texts = s.doc.layers.filter((l) => l.type === 'text');
    const shapes = s.doc.layers.filter((l) => l.type === 'shape' && (l.shape === 'graphic' || l.shape === 'icon'));
    if (s.doc.layers.length < 5 || texts.length < 2 || shapes.length < 1) problems.push(`${id}(${s.doc.layers.length} layers)`);
  }
  t.check('each new template builds an editable design from text, graphics and textures', problems.length === 0, problems.join(' '));
  await page.evaluate(() => document.fonts.ready);
  await h.settle(1500);
  const s = await state(page);
  const heading = s.doc.layers.find((l) => l.type === 'text' && l.effects.distress);
  const a = await h.stats((await h.exportPng([])).buffer);
  t.check('a template exports with its effects', !!heading && a.colours > 6 && a.width === 1240 && a.height === 1748, `${a.colours} colour groups`);
  await page.keyboard.press('Control+z');
  t.check('applying a template can be undone', (await state(page)).doc.layers.some((l) => l.type === 'shape') && (await state(page)).past > 0);
});

await section('Save, reopen and older projects', async () => {
  for (const l of await h.layers()) await remove(l.id);
  await h.openTab('text');
  await page.locator('[data-text-style="RETRO 3D"]').click();
  let l = (await h.layers()).at(-1);
  await h.selectRow(l.id);
  await props.getByLabel('Text path').selectOption('curve');
  await h.openTab('elements');
  await page.locator('[data-icon="star"]').click();
  await page.locator('[data-graphic="sticker/sun"]').click();
  await page.evaluate(() => document.fonts.ready);
  await h.settle(600);
  await page.keyboard.press('Escape');
  const before = await stats();
  const saved = await h.layers();
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.evaluate(() => document.fonts.ready);
  await h.settle(1200);
  const ls = await h.layers();
  t.check('text effects, paths, icons and graphics are saved with the project', ls.length === 3 && ls[0].effects.extrude && ls[0].path?.kind === 'curve' && ls[1].icon === 'star' && ls[2].graphic === 'sticker/sun' && ls[0].id === saved[0].id);
  const after = await stats();
  t.check('a reopened project exports the same picture', after.signature === before.signature, `${after.ink} vs ${before.ink} ink pixels`);

  const id = (await state(page)).doc.id;
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
            rec.doc = { ...rec.doc, schemaVersion: 3, layers: rec.doc.layers.map(({ path, effects, ...rest }) => rest) };
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
  await h.settle(800);
  const s = await state(page);
  const text = s.doc.layers[0];
  t.check('a project saved before Milestone 3 opens and is upgraded', s.doc.schemaVersion === 6 && text.path === null && text.effects.glow === null && text.effects.extrude === null && s.doc.layers.length === 3, `schema ${s.doc.schemaVersion}`);
});

t.check('no browser errors or native dialogs', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
