/** Captures screenshots of text warp and the interface sizes for a visual review. Not an assertion suite. */
import { join } from 'node:path';
import { helpers, launch, openEditor, OUTPUT_DIR, state } from './harness.mjs';

const browser = await launch();
const { page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const shot = (name) => page.screenshot({ path: join(OUTPUT_DIR, `visual-warp-${name}.png`) });
const canvasShot = (name) => page.locator('[data-testid="canvas-host"]').screenshot({ path: join(OUTPUT_DIR, `visual-warp-${name}.png`) });

await shot('interface-comfortable');

await h.openTab('text');
await page.getByRole('button', { name: /Add a heading/ }).first().click();
await h.settle(600);
const text = (await state(page)).doc.layers.at(-1);
await h.patch(text.id, { text: 'MIRCHI HOT', width: 620, x: 230, fontSize: 120 });
await h.settle(400);
const props = page.locator('[data-testid="properties-panel"]');

for (const style of ['arc', 'arc-lower', 'arc-upper', 'arch', 'bulge', 'flag', 'rise', 'squeeze']) {
  await props.getByLabel('Warp shape').selectOption(style);
  await h.settle(300);
  await canvasShot(style);
}
await props.getByLabel('Warp shape').selectOption('arc');
await h.setField('Bend value', -70, props);
await h.settle(300);
await canvasShot('arc-negative');

await props.getByLabel('Warp shape').selectOption('custom');
await h.settle(300);
await canvasShot('custom-from-arc');
await shot('custom-full-window');

console.log('backend:', await page.evaluate(() => window.__prysm.warp.meshBackend()));
console.log('errors:', errors);
await browser.close();
