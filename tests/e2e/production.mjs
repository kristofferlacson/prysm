/**
 * Sanity check of the production build (npm run build && npm run preview), where the test hook
 * does not exist: the bundled worker and WebAssembly runtime must load and run, and masks must render.
 *
 *   PRYSM_URL=http://localhost:4173 node tests/e2e/production.mjs
 */
import { launch, makeReporter, removeBackground, BASE_URL } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text()}`));
await page.goto(`${BASE_URL}/#/editor`);
await page.waitForSelector('[data-testid="canvas-host"] canvas');
t.check('the test hook is not present in production', await page.evaluate(() => typeof window.__prysm === 'undefined'));

// A picture with an unmistakable subject. (A random texture, used here before, sometimes has
// nothing the model considers a subject, and the run then correctly reports that instead of a mask.)
const picture = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 480;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#cfd6dd';
  ctx.fillRect(0, 0, 640, 480);
  const g = ctx.createRadialGradient(280, 200, 20, 320, 240, 150);
  g.addColorStop(0, '#ffb347');
  g.addColorStop(1, '#c2410c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(320, 240, 150, 0, Math.PI * 2);
  ctx.fill();
  return c.toDataURL('image/png');
});
await page.locator('[data-tab="uploads"]').click();
await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'ball.png', mimeType: 'image/png', buffer: Buffer.from(picture.split(',')[1], 'base64') });
await page.locator('[data-testid="layer-row"]').first().click();
const props = page.locator('[data-testid="properties-panel"]');
// The panel is in its default, tabbed view here: a photo opens on Adjust, and background removal is under Cut out.
t.check('the right-hand panel opens on the photo’s Adjust tab', (await page.locator('[data-inspector-tab="adjust"]').getAttribute('aria-selected')) === 'true');
await page.locator('[data-inspector-tab="cutout"]').click();
// The dialog: the suggestion is worked out by the bundled worker, and Apply stores it.
await removeBackground(page, props);
const status = page.locator('[data-testid="bg-removal-status"]');
await page.waitForFunction(() => ['done', 'error'].includes(document.querySelector('[data-testid="bg-removal-status"]')?.dataset.phase), null, { timeout: 180000 });
const phase = await status.getAttribute('data-phase');
t.check('background removal runs in the production build', phase === 'done', (await status.innerText()).slice(0, 90));
t.check('the result is a mask in the layers panel', (await page.locator('[data-testid="mask-thumb"]').count()) === 1);

await page.keyboard.press('b');
t.check('paint tools work in the production build', (await page.locator('[data-testid="paint-target"]').getAttribute('data-kind')) === 'new-paint' || (await page.locator('[data-testid="paint-target"]').count()) === 1);
t.check('no console or page errors', errors.length === 0, errors.slice(0, 4).join(' | '));
const failed = t.summary();
await browser.close();
process.exit(failed ? 1 : 0);
