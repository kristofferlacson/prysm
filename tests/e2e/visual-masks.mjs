/** Screenshots of the mask and paint interface for visual review. */
import { join } from 'node:path';
import { helpers, launch, openEditor, OUTPUT_DIR, state } from './harness.mjs';

const browser = await launch();
const { page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const shot = (name) => page.screenshot({ path: join(OUTPUT_DIR, `visual-${name}.png`) });

await h.openTab('backgrounds');
await page.locator('[data-generator="background/abstract-gradient"]').click();
await h.openTab('textures');
await page.locator('[data-generator="texture/oil-paint"]').click();
const layer = (await state(page)).doc.layers[1];
await h.patch(layer.id, { blendMode: 'normal', x: 140, y: 140, width: 800, height: 800 });
await page.locator('[data-testid="properties-panel"]').getByRole('button', { name: 'Add layer mask' }).click();
await page.keyboard.press('b');
await h.setField('Size', 140, page.locator('[data-testid="tool-options"]'));
await h.setField('Hardness', 30, page.locator('[data-testid="tool-options"]'));
await h.stroke([[250, 300], [500, 450], [800, 300], [700, 700], [350, 780]], 6);
await page.mouse.move(700, 500);
await shot('mask-painting');
await page.keyboard.press('v');
await page.locator('[data-testid="properties-panel"]').getByRole('switch', { name: 'Show mask' }).click();
await page.waitForTimeout(300);
await shot('mask-view');
console.log('errors:', errors);
await browser.close();
