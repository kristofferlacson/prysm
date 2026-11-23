/** Captures a contact sheet of the Milestone 3 templates and the Elements panel. Not an assertion suite. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { helpers, launch, openEditor, OUTPUT_DIR } from './harness.mjs';

const browser = await launch();
const { page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const ids = ['neon-night', 'retro-fest', 'album-gold', 'story-sale', 'insta-launch', 'channel-banner', 'web-banner', 'thumb-challenge', 'flyer-market'];
const only = process.argv[2];
const shots = [];
await h.openTab('templates');
for (const id of only ? [only] : ids) {
  await page.locator(`[data-template="${id}"]`).click();
  const dlg = page.locator('[data-testid="confirm-dialog"]');
  if (await dlg.count()) await dlg.locator('button').last().click();
  await page.evaluate(() => document.fonts.ready);
  await h.settle(2200);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+\\');
  await h.settle(500);
  shots.push((await page.locator('[data-testid="canvas-host"]').screenshot()).toString('base64'));
  await page.keyboard.press('Control+\\');
  await h.settle(200);
}
const sheet = await page.evaluate(async (shots) => {
  const cols = Math.min(3, shots.length);
  const rows = Math.ceil(shots.length / cols);
  const bitmaps = await Promise.all(shots.map((b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }))));
  const cw = shots.length === 1 ? bitmaps[0].width : 620;
  const ch = Math.round((cw * bitmaps[0].height) / bitmaps[0].width);
  const c = document.createElement('canvas');
  c.width = cols * cw;
  c.height = rows * ch;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  bitmaps.forEach((b, i) => ctx.drawImage(b, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch));
  return c.toDataURL('image/png').split(',')[1];
}, shots);
writeFileSync(join(OUTPUT_DIR, only ? `visual-m3-${only}.png` : 'visual-m3-templates.png'), Buffer.from(sheet, 'base64'));

if (!only) {
  await h.openTab('elements');
  await h.settle(800);
  await page.screenshot({ path: join(OUTPUT_DIR, 'visual-m3-elements.png') });
  await page.locator('[data-testid="sidebar-panel"] .overflow-y-auto').evaluate((el) => el.scrollTo(0, 1500));
  await h.settle(400);
  await page.screenshot({ path: join(OUTPUT_DIR, 'visual-m3-elements-2.png') });
  await h.openTab('effects');
  await h.settle(2500);
  await page.screenshot({ path: join(OUTPUT_DIR, 'visual-m3-effects.png') });
}
console.log('errors:', errors);
await browser.close();
