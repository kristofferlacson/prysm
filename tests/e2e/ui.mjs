/**
 * Interface: size of the controls around the canvas, and the editor's own confirm dialog
 * (which replaced the browser's "localhost says" box).
 */
import { helpers, launch, makeReporter, near, openEditor, state, toScreen } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const confirmDialog = page.locator('[data-testid="confirm-dialog"]');
const undoButton = page.getByRole('button', { name: /^Undo/ });
const height = async (locator) => (await locator.boundingBox()).height;
const canvasWidth = async () => (await page.locator('[data-testid="canvas-host"]').boundingBox()).width;
const setSize = async (label) => {
  await h.viewOption((menu) => menu.getByRole('button', { name: label, exact: true }).click());
  await h.settle(250);
};

let R; // a rectangle used to check pointer accuracy and as "existing work"

await section('Interface size', async () => {
  t.check('the interface opens at the Comfortable size (120%)', near(await height(undoButton), 32 * 1.2, 0.6) && (await page.evaluate(() => window.__prysm.ui.getState().uiScale)) === 1.2, `toolbar buttons are ${(await height(undoButton)).toFixed(1)} px tall`);
  const fontSize = await page.locator('[data-tab="templates"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { box: `${Math.round(r.width)}x${Math.round(r.height)}`, clipped: el.scrollWidth > el.clientWidth };
  });
  const clipped = await page.locator('[data-tab]').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent));
  t.check('every library tab shows its whole label', clipped.length === 0, clipped.length ? `clipped: ${clipped.join(', ')}` : `tab buttons are ${fontSize.box} px`);
  t.check('nothing overflows the window', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight));

  // View settings are not properties of the design: they live in the top bar, not in the Canvas panel.
  await page.locator('[data-testid="canvas-size"]').click();
  const canvasPanel = page.locator('[data-testid="canvas-properties"]');
  const sections = await canvasPanel.locator('section').count();
  t.check('the Canvas panel holds only the design’s size and background', sections === 2 && (await canvasPanel.getByText('Interface size').count()) === 0 && (await canvasPanel.getByRole('switch').count()) === 0, `${sections} sections`);
  await page.getByRole('button', { name: 'View options' }).click();
  const menu = page.locator('[data-testid="view-menu"]');
  t.check('the View menu in the top bar offers rulers, grid and interface size', (await menu.getByRole('switch', { name: 'Show rulers' }).count()) === 1 && (await menu.getByRole('switch', { name: 'Show grid' }).count()) === 1 && (await menu.locator('[data-testid="interface-size"] button').count()) === 3);
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'View options' }).click();
  await page.mouse.click(700, 500);
  t.check('it closes on Escape and on a click elsewhere', (await menu.count()) === 0);

  await h.openTab('elements');
  await page.getByTitle('Rectangle', { exact: true }).click();
  R = (await h.layers()).at(-1);
  const history = (await state(page)).past;
  const comfortable = await canvasWidth();

  await setSize('Large');
  t.check('Large makes every control 40% bigger than Compact', near(await height(undoButton), 32 * 1.4, 0.6), `${(await height(undoButton)).toFixed(1)} px`);
  t.check('the canvas area gives up the room', (await canvasWidth()) < comfortable - 60, `${comfortable} -> ${await canvasWidth()} px`);
  t.check('panels still fit the window at Large', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  // The canvas is not scaled with the interface, so pointer positions must still be exact.
  await page.getByRole('button', { name: /Fit canvas/ }).click();
  await page.keyboard.press('Escape');
  let l = await h.layerById(R.id);
  let c = await toScreen(page, l.x + l.width / 2, l.y + l.height / 2);
  await page.mouse.click(c.x, c.y);
  t.check('clicking a layer on the canvas selects it at Large', (await state(page)).selectedIds.join() === R.id);
  const zoom = await page.evaluate(() => window.__prysm.ui.getState().zoom);
  await h.drag(c, { x: c.x + 100 * zoom, y: c.y - 50 * zoom });
  const moved = await h.layerById(R.id);
  t.check('dragging on the canvas is accurate at Large', near(moved.x - l.x, 100, 6) && near(moved.y - l.y, -50, 6), `dx=${(moved.x - l.x).toFixed(1)} dy=${(moved.y - l.y).toFixed(1)}`);
  await h.selectRow(R.id);
  await h.setField('X position', 123, page.locator('[data-testid="properties-panel"]'));
  t.check('panel fields work at Large', (await h.layerById(R.id)).x === 123);

  await setSize('Compact');
  t.check('Compact is the base size (32 px toolbar buttons)', near(await height(undoButton), 32, 0.6), `${(await height(undoButton)).toFixed(1)} px`);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  t.check('the chosen size is remembered after a reload', near(await height(undoButton), 32, 0.6) && (await page.evaluate(() => localStorage.getItem('prysm.uiScale'))) === '1');
  await setSize('Comfortable');
  t.check('the size is a view preference, not part of the design', near(await height(undoButton), 38.4, 0.6) && (await h.layers()).length === 1);
  t.check('(setup: history is intact before the reload)', history >= 1);
});

await section('Replacing a design asks in the editor, not the browser', async () => {
  await h.openTab('templates');
  const before = await state(page);
  await page.locator('[data-template="social-quote"]').click();
  await confirmDialog.waitFor();
  t.check('applying a template over existing work opens the editor’s dialog', (await confirmDialog.getAttribute('role')) === 'alertdialog' && (await confirmDialog.textContent()).includes('Quote post'), (await confirmDialog.textContent()).slice(0, 60));
  t.check('no browser dialog was shown', errors.filter((e) => e.includes('native browser dialog')).length === 0);
  t.check('the dialog matches the interface size', near(await height(confirmDialog.getByRole('button', { name: 'Cancel' })), 28 * 1.2, 0.6));

  // Shortcuts must not act on the design behind the question.
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+a');
  t.check('keyboard shortcuts are held while the question is open', (await h.layers()).length === before.doc.layers.length);

  await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
  await confirmDialog.waitFor({ state: 'detached' });
  let s = await state(page);
  t.check('Cancel keeps the design', s.doc.layers.length === before.doc.layers.length && s.doc.width === before.doc.width && s.past === before.past);

  await page.locator('[data-template="social-quote"]').click();
  await confirmDialog.waitFor();
  await page.keyboard.press('Escape');
  await confirmDialog.waitFor({ state: 'detached' });
  s = await state(page);
  t.check('Escape keeps the design', s.doc.layers.length === before.doc.layers.length && s.doc.width === before.doc.width);

  await page.locator('[data-template="social-quote"]').click();
  await confirmDialog.waitFor();
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press('Enter');
  await confirmDialog.waitFor({ state: 'detached' });
  await h.settle(400);
  s = await state(page);
  t.check('the confirm button has focus, so Enter replaces the design', focused === 'Replace design' && s.doc.width === 1080 && s.doc.layers.some((l) => l.type === 'text'), `focused: ${focused}`);
  await page.keyboard.press('Control+z');
  s = await state(page);
  t.check('and it can be undone, as the dialog says', s.doc.layers.length === before.doc.layers.length && s.doc.layers[0].id === R.id);

  await page.evaluate((id) => window.__prysm.editor.getState().deleteLayers([id]), R.id);
  await page.locator('[data-template="social-quote"]').click();
  await h.settle(400);
  t.check('an empty canvas takes a template without a question', (await confirmDialog.count()) === 0 && (await state(page)).doc.width === 1080);
});

await section('Deleting a project', async () => {
  await page.getByRole('button', { name: 'Projects' }).click();
  const dlg = page.getByRole('dialog', { name: 'Projects' });
  const cards = dlg.locator('[data-testid="project-card"]');
  await cards.first().waitFor();
  await dlg.getByRole('button', { name: 'Duplicate Untitled design' }).click();
  await dlg.getByRole('button', { name: 'Delete Untitled design copy' }).waitFor();
  const count = await cards.count();

  await dlg.getByRole('button', { name: 'Delete Untitled design copy' }).click();
  await confirmDialog.waitFor();
  t.check('deleting a project asks first, and says it cannot be undone', (await confirmDialog.textContent()).includes('cannot be undone') && (await confirmDialog.getByRole('button', { name: 'Delete project' }).count()) === 1);
  await page.keyboard.press('Escape');
  await confirmDialog.waitFor({ state: 'detached' });
  t.check('Escape answers the question only; Projects stays open', (await dlg.count()) === 1 && (await cards.count()) === count);

  await dlg.getByRole('button', { name: 'Delete Untitled design copy' }).click();
  await confirmDialog.getByRole('button', { name: 'Cancel' }).click();
  await h.settle(300);
  t.check('Cancel keeps the project', (await cards.count()) === count);

  await dlg.getByRole('button', { name: 'Delete Untitled design copy' }).click();
  await confirmDialog.getByRole('button', { name: 'Delete project' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="project-card"]').length === n - 1, count);
  t.check('confirming deletes it', (await cards.count()) === count - 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  t.check('Escape then closes Projects', true);
});

t.check('no browser errors or native dialogs', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
