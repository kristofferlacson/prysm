/**
 * Finding your way around: the right-hand panel in its default, tabbed view, on a laptop-sized
 * window. What is selected decides the tabs; what you add or start opens its own settings; and
 * common tasks are carried out from start to finish through the tabs.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, state, toScreen, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true, tabs: true, viewport: { width: 1366, height: 768 } });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const inspector = page.locator('[data-testid="inspector"]');
const props = page.locator('[data-testid="properties-panel"]');
const bar = page.locator('[data-testid="inspector-tabs"]');
const tab = (id) => page.locator(`[data-inspector-tab="${id}"]`);
const go = async (id) => {
  await tab(id).click();
  await h.settle(150);
};
const tabIds = () => bar.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.dataset.inspectorTab));
const active = async () => ((await bar.count()) ? bar.locator('[aria-selected="true"]').getAttribute('data-inspector-tab') : null);
const sections = () => inspector.locator('[data-section]').evaluateAll((els) => els.map((e) => e.dataset.section));
const scroll = () => inspector.evaluate((el) => ({ height: el.scrollHeight, visible: el.clientHeight, top: el.scrollTop }));
/** True when the element lies inside the visible part of the panel, below its tab bar. */
const inView = (locator) =>
  locator.first().evaluate((el) => {
    const panel = document.querySelector('[data-testid="inspector"]').getBoundingClientRect();
    const tabs = document.querySelector('[data-testid="inspector-tabs"]');
    const top = tabs ? tabs.getBoundingClientRect().bottom : panel.top;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top >= top - 1 && r.bottom <= panel.bottom + 1;
  });
const slide = async (scope, label, value) => {
  await scope.getByLabel(label, { exact: true }).fill(String(value));
  await h.settle(250);
};
const pixels = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const dragDoc = async (from, to) => h.drag(await toScreen(page, from[0], from[1]), await toScreen(page, to[0], to[1]), 8);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let photo;
let heading;
let all;

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  await page.keyboard.press('Escape');
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 420;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#406080';
    ctx.fillRect(0, 0, 320, 420);
    ctx.fillStyle = '#c08040';
    ctx.fillRect(320, 0, 320, 420);
    return c.toDataURL('image/png');
  });
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 1);
  photo = (await h.layers())[0];
  await h.patch(photo.id, { x: 80, y: 90, width: 640, height: 420 });
  await h.selectRow(photo.id);
  await h.settle(400);
  t.check('(a photo is on an 800 x 600 canvas)', photo.type === 'image');
});

await section('A photo: a few tabs instead of one long list', async () => {
  t.check('the panel offers Adjust, Effects, Cut out, Layout, Style and All', same(await tabIds(), ['adjust', 'effects', 'cutout', 'layout', 'style', 'all']), (await tabIds()).join(' '));
  t.check('it opens on Adjust, the settings most specific to a photo', (await active()) === 'adjust' && (await bar.getAttribute('data-kind')) === 'image');
  const per = {};
  const heights = {};
  for (const id of ['adjust', 'effects', 'cutout', 'layout', 'style']) {
    await go(id);
    per[id] = await sections();
    heights[id] = (await scroll()).height;
  }
  t.check('Adjust holds the light and colour settings', same(per.adjust, ['Adjustments', 'Levels', 'Curves']), per.adjust.join(', '));
  t.check('Effects holds the effects', same(per.effects, ['Effects']), per.effects.join(', '));
  t.check('Cut out holds the mask (with background removal) and the fade', same(per.cutout, ['Mask', 'Fade']) && (await go('cutout'), await props.getByRole('button', { name: 'Remove background' }).isVisible()), per.cutout.join(', '));
  t.check('Layout holds position, size, order and crop', same(per.layout, ['Arrange', 'Position & size', 'Crop', 'Expand', 'Upscale']), per.layout.join(', '));
  t.check('Style holds opacity and blending, corners, border and shadow', same(per.style, ['Blending', 'Frame', 'Border', 'Drop shadow']), per.style.join(', '));
  await go('all');
  all = await sections();
  const union = Object.values(per).flat();
  t.check('every setting is in exactly one tab: together the tabs hold what “All” lists, nothing twice, nothing missing', union.length === all.length && new Set(union).size === union.length && all.every((s) => union.includes(s)), `${union.length} in tabs, ${all.length} in All`);
  const full = (await scroll()).height;
  const tallest = Math.max(...Object.values(heights));
  t.check('each tab is a fraction of the single list (less scrolling)', tallest <= full * 0.5, `the single list is ${full}px tall; the tallest tab ${tallest}px; ${Object.entries(heights).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const before = await bar.boundingBox();
  await inspector.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await h.settle(200);
  const after = await bar.boundingBox();
  t.check('the tabs stay in place while the list scrolls', (await scroll()).top > 100 && near(before.y, after.y, 1));
  // The tabs are above the list, not floating over it: a control scrolled to the very top must still be clickable.
  const covered = await inspector.evaluate((el) => {
    const tabs = document.querySelector('[data-testid="inspector-tabs"]').getBoundingClientRect();
    const bad = [];
    for (const sectionEl of el.querySelectorAll('[data-section]')) {
      sectionEl.scrollIntoView({ block: 'start' });
      const head = sectionEl.querySelector('button');
      const r = head.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (r.top < tabs.bottom - 1 || !head.contains(hit)) bad.push(sectionEl.dataset.section);
    }
    return bad;
  });
  t.check('whatever is scrolled to the top of the list is below the tabs, never underneath them', covered.length === 0, covered.join(', ') || '15 sections scrolled to the top, each still clickable');
  t.check('the layer’s name and type stay at the top of every tab', /photo/.test(await props.innerText()) && /Image/.test(await props.innerText()));
  await go('adjust');
});

await section('What you add opens its own settings', async () => {
  await go('layout');
  await h.openTab('effects');
  const bloom = props.locator('[data-effect-row="bloom"]');
  await page.locator('[data-effect="bloom"]').click();
  await h.settle(900);
  t.check('adding an effect on the left opens the Effects tab on the right', (await active()) === 'effects');
  t.check('with the new effect’s slider in view and highlighted', (await inView(bloom)) && !!(await bloom.getAttribute('data-revealed')) && (await bloom.evaluate((el) => el.classList.contains('reveal-flash'))));
  await slide(bloom, 'Bloom', 80);
  t.check('and it can be adjusted right there', (await h.layerById(photo.id)).effects[0].amount === 0.8);
  t.check('the Effects panel on the left says where the settings are', (await page.getByText(/Its settings open on the right, under Effects/).count()) === 1);
  await go('style');
  await page.locator('[data-effect="light-streaks"]').click();
  await h.settle(900);
  const streaks = props.locator('[data-effect-row="light-streaks"]');
  t.check('a second effect, added from another tab, brings the panel back to Effects on that effect', (await active()) === 'effects' && (await inView(streaks)) && (await inView(streaks.getByLabel('Direction', { exact: true }))));
  await go('layout');
  await page.locator('[data-look="noir"]').click();
  await h.settle(900);
  t.check('so does a look', (await active()) === 'effects' && (await inView(props.locator('[data-effect-row="noir"]'))));
  await page.locator('[data-look="noir"]').click();

  // In the single list the tab does not change: the list scrolls to the effect instead.
  await go('all');
  await inspector.evaluate((el) => el.scrollTo(0, 0));
  await page.locator('[data-effect="pixelate"]').click();
  await h.settle(1100);
  t.check('in “All” the list scrolls to the new effect instead', (await active()) === 'all' && (await scroll()).top > 100 && (await inView(props.locator('[data-effect-row="pixelate"]'))), JSON.stringify(await scroll()));
  await page.locator('[data-effect="pixelate"]').click();
  await go('adjust');

  await page.evaluate(() => window.__prysm.ui.getState().set({ sidebarTab: null }));
  await h.selectRow(photo.id);
  await page.keyboard.press('c');
  await h.settle(900);
  t.check('C (crop) opens Layout with the crop settings unfolded and in view', (await active()) === 'layout' && (await inView(props.getByRole('button', { name: 'Done cropping', exact: true }))));
  await page.keyboard.press('Escape');
  await go('adjust');
});

await section('Selecting an area has its own tab', async () => {
  await page.keyboard.press('m');
  await h.settle(300);
  t.check('a selection tool adds a Select tab and opens it', same(await tabIds(), ['selection', 'adjust', 'effects', 'cutout', 'layout', 'style', 'all']) && (await active()) === 'selection');
  const clipped = await bar.locator('[role="tab"] span').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 0.5 || el.getBoundingClientRect().width > el.parentElement.getBoundingClientRect().width + 0.5).map((el) => el.textContent));
  t.check('all seven tab names fit: none is cut short or spills out of its tab', clipped.length === 0, clipped.join(', '));
  t.check('which shows the selection commands and nothing else', (await page.locator('[data-testid="selection-panel"]').isVisible()) && (await props.count()) === 0);
  await dragDoc([200, 150], [600, 450]);
  await h.settle(300);
  await go('adjust');
  t.check('the layer’s own tabs are one click away while selecting', (await props.isVisible()) && same(await sections(), ['Adjustments', 'Levels', 'Curves']));
  await go('selection');
  await page.locator('[data-testid="selection-panel"]').getByRole('button', { name: 'Fade along selection', exact: true }).click();
  await h.settle(900);
  const use = props.getByRole('button', { name: 'Use the selection', exact: true });
  t.check('“Fade along selection” opens Cut out on the fade it just made', (await active()) === 'cutout' && (await inView(use)) && !!(await h.layerById(photo.id)).fade?.shape);
  await go('selection');
  await page.locator('[data-testid="selection-panel"]').getByRole('button', { name: 'Deselect', exact: true }).click();
  await page.keyboard.press('v');
  await h.settle(300);
  t.check('with nothing selected and the Move tool, the Select tab is gone and the panel is back where it was', same(await tabIds(), ['adjust', 'effects', 'cutout', 'layout', 'style', 'all']) && (await active()) === 'cutout');
  await props.getByRole('switch', { name: 'Fade', exact: true }).click();
  await go('adjust');
});

await section('Every kind of layer has its own tabs', async () => {
  await h.openTab('text');
  await page.getByRole('button', { name: 'Add a heading' }).click();
  await h.settle(900);
  heading = (await h.layers()).at(-1);
  t.check('new text opens on its Text tab', same(await tabIds(), ['text', 'effects', 'layout', 'style', 'all']) && (await active()) === 'text' && same(await sections(), ['Typography', 'Text colour', 'Outline']), (await sections()).join(', '));
  await go('effects');
  t.check('text effects, warp and text on a path are under Effects', same(await sections(), ['Warp', 'Text on a path', 'Text effects']), (await sections()).join(', '));
  await go('layout');
  const layout = await sections();
  await go('style');
  t.check('Layout and Style mean the same for every kind of layer', same(layout, ['Arrange', 'Position & size']) && same(await sections(), ['Blending', 'Drop shadow']), `${layout.join(', ')} | ${(await sections()).join(', ')}`);

  await h.openTab('elements');
  await page.locator('[title="Rectangle"]').first().click();
  await h.settle(500);
  const rect = (await h.layers()).at(-1);
  t.check('a shape opens on its Shape tab', same(await tabIds(), ['shape', 'layout', 'style', 'all']) && (await active()) === 'shape' && same(await sections(), ['Fill', 'Stroke', 'Geometry']), (await sections()).join(', '));

  await h.openTab('textures');
  await page.locator('[data-generator]').first().click();
  await h.settle(900);
  const texture = (await h.layers()).at(-1);
  t.check('a texture opens on Style: its colours and how it mixes with what is underneath', (await bar.getAttribute('data-kind')) === 'generated' && (await active()) === 'style' && (await sections()).includes('Texture') && (await sections()).includes('Blending'), (await sections()).join(', '));

  await h.selectRow(photo.id);
  await h.selectRow(heading.id, ['Control']);
  await h.settle(200);
  t.check('several layers together: Layout and Style', same(await tabIds(), ['layout', 'style', 'all']) && same(await sections(), ['Arrange']), (await sections()).join(', '));
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  await h.settle(200);
  t.check('nothing selected: the canvas settings, with no tabs needed', (await bar.count()) === 0 && same(await sections(), ['Size', 'Background']), (await sections()).join(', '));
  await page.keyboard.press('m');
  await h.settle(200);
  t.check('nothing selected, with a selection tool: Select and Canvas', same(await tabIds(), ['selection', 'canvas', 'all']) && (await active()) === 'selection');
  await page.keyboard.press('v');
  await page.evaluate(([a, b]) => window.__prysm.editor.getState().deleteLayers([a, b]), [rect.id, texture.id]);
});

await section('The panel remembers where you were', async () => {
  await h.selectRow(photo.id);
  await go('style');
  await h.selectRow(heading.id);
  await h.settle(200);
  await go('effects');
  await h.selectRow(photo.id);
  await h.settle(200);
  const onPhoto = await active();
  await h.selectRow(heading.id);
  await h.settle(200);
  t.check('going back to a photo returns to the photo’s tab, and back to text to the text’s', onPhoto === 'style' && (await active()) === 'effects', `${onPhoto} / ${await active()}`);
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(900);
  await h.selectRow(photo.id);
  await h.settle(200);
  t.check('the choice is remembered after reopening', (await active()) === 'style');
  // A layer that was just added opens on its own main tab, even if that kind was left on another one.
  await h.selectRow(heading.id);
  await h.settle(200);
  const left = await active();
  await h.openTab('text');
  await page.getByRole('button', { name: 'Add a subheading' }).click();
  await h.settle(700);
  const added = (await h.layers()).at(-1);
  t.check('text that has just been added opens on Text, although text was left on Effects', left === 'effects' && (await active()) === 'text' && added.id !== heading.id, `${left} -> ${await active()}`);
  await page.evaluate((id) => window.__prysm.editor.getState().deleteLayers([id]), added.id);
  await page.evaluate(() => window.__prysm.ui.getState().set({ sidebarTab: null }));
  await h.selectRow(photo.id);
  await h.settle(200);
  await go('all');
  t.check('“All” shows every section in one list, as before', same(await sections(), all), (await sections()).join(', '));
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(900);
  await h.selectRow(photo.id);
  await h.settle(200);
  t.check('and “All” is remembered too, for those who prefer the single list', (await active()) === 'all');
  await go('adjust');
});

await section('Common tasks from start to finish, through the tabs', async () => {
  await h.selectRow(photo.id);
  await page.evaluate((id) => window.__prysm.editor.getState().updateLayers([id], { effects: [] }), photo.id);
  const before = await pixels([[200, 300], [600, 300]]);

  // Brighten a photo.
  await go('adjust');
  await slide(props, 'Brightness', 40);
  let px = await pixels([[200, 300]]);
  t.check('brighten a photo: Adjust, Brightness', (await h.layerById(photo.id)).adjustments.brightness === 40 && px[0][0] > before[0][0] + 20, `${fmt(before[0])} -> ${fmt(px[0])}`);
  await slide(props, 'Brightness', 0);

  // Add an effect and tune it.
  await h.openTab('effects');
  await page.locator('[data-effect="vignette"]').click();
  await h.settle(900);
  await slide(props.locator('[data-effect-row="vignette"]'), 'Vignette', 100);
  px = await pixels([[90, 100], [400, 300]]);
  t.check('add an effect and tune it: click it on the left, set it on the right', (await active()) === 'effects' && px[0][0] + px[0][1] + px[0][2] < (before[0][0] + before[0][1] + before[0][2]) * 0.7, `corner ${fmt(px[0])}, before ${fmt(before[0])}`);
  await props.getByRole('button', { name: 'Remove Vignette' }).click();
  await page.evaluate(() => window.__prysm.ui.getState().set({ sidebarTab: null }));

  // Fade one side away.
  await go('cutout');
  await props.getByRole('switch', { name: 'Fade', exact: true }).click();
  await h.settle(400);
  px = await pixels([[200, 300], [712, 300]]);
  t.check('fade one side of a photo: Cut out, Fade', px[0][3] === 255 && px[1][3] <= 3, `${px[0][3]} ${px[1][3]}`);
  await props.getByRole('switch', { name: 'Fade', exact: true }).click();

  // See-through.
  await go('style');
  await slide(props, 'Opacity', 50);
  px = await pixels([[200, 300]]);
  t.check('make a layer see-through: Style, Opacity', near(px[0][3], 128, 3), String(px[0][3]));
  await slide(props, 'Opacity', 100);

  // Move and crop.
  await go('layout');
  await h.setField('X position', 100, props);
  await props.getByRole('button', { name: 'Crop', exact: true }).click();
  await slide(props, 'Left', 50);
  let l = await h.layerById(photo.id);
  px = await pixels([[300, 300], [500, 300]]);
  t.check('place and crop a photo: Layout, Position & size and Crop', near(l.crop.left, 0.5, 0.01) && near(l.width, 320, 2) && px[0][3] === 0 && px[1][3] === 255, `${l.x},${l.y} ${l.width} wide, crop ${l.crop.left}`);

  // Text: size, then an effect.
  await h.selectRow(heading.id);
  await go('text');
  await h.setField('Font size', 90, props);
  await go('effects');
  await props.getByRole('switch', { name: 'Glow' }).click();
  await h.settle(300);
  l = await h.layerById(heading.id);
  t.check('style a heading: Text for its size, Effects for a glow', l.fontSize === 90 && !!l.effects.glow);

  // A shape.
  await h.openTab('elements');
  await page.locator('[title="Rectangle"]').first().click();
  await h.settle(400);
  const rect = (await h.layers()).at(-1);
  await slide(props, 'Corners', 24);
  await go('style');
  await props.getByRole('switch', { name: 'Drop shadow', exact: true }).click();
  l = await h.layerById(rect.id);
  t.check('round a shape’s corners and give it a shadow: Shape, then Style', l.cornerRadius === 24 && !!l.shadow);
  t.check('every step above was undoable: the history has grown', (await state(page)).past > 8);
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
