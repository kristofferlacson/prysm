/** Captures screenshots of the main surfaces for a visual review. Not an assertion suite. */
import { join } from 'node:path';
import { launch, openEditor, OUTPUT_DIR, state } from './harness.mjs';

const browser = await launch();
const { page, errors } = await openEditor(browser, { fresh: true });
const shot = (name) => page.screenshot({ path: join(OUTPUT_DIR, `visual-${name}.png`) });
const tab = (id) => page.locator(`[data-tab="${id}"]`).click();

await tab('templates');
await page.locator('[data-template="gig-poster"]').click();
await page.waitForTimeout(2500);
await page.keyboard.press('Escape');
await shot('template-poster');

await tab('textures');
await page.waitForSelector('[data-generator="texture/abstract-pattern"] img');
await page.waitForTimeout(500);
await shot('textures-panel');
await page.locator('[data-testid="sidebar-panel"] .overflow-y-auto').evaluate((el) => el.scrollTo(0, 99999));
await page.waitForTimeout(300);
await shot('textures-panel-2');

await tab('overlays');
await page.waitForSelector('[data-generator="overlay/glitch-bars"] img');
await page.waitForTimeout(500);
await shot('overlays-panel');

await tab('templates');
await page.locator('[data-template="album-cover"]').click();
await page.waitForTimeout(2500);
const text = (await state(page)).doc.layers.find((l) => l.type === 'text');
await page.locator(`[data-layer-id="${text.id}"]`).click();
await tab('text');
await page.waitForTimeout(800);
await shot('template-album-text-selected');

await tab('effects');
await page.waitForTimeout(1500);
await shot('effects-panel');

await tab('backgrounds');
await page.waitForSelector('[data-generator="background/abstract-shapes"] img');
await page.waitForTimeout(500);
await shot('backgrounds-panel');

console.log('errors:', errors);
await browser.close();
