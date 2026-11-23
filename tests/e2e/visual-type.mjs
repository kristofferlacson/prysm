/** Captures screenshots of text effects and text on a path for a visual review. Not an assertion suite. */
import { join } from 'node:path';
import { helpers, launch, openEditor, OUTPUT_DIR, state } from './harness.mjs';

const browser = await launch();
const { page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const canvasShot = (name) => page.locator('[data-testid="canvas-host"]').screenshot({ path: join(OUTPUT_DIR, `visual-type-${name}.png`) });

await page.locator('[data-testid="canvas-size"]').click();
await page.locator('[data-testid="canvas-properties"]').getByRole('button', { name: 'Solid' }).click();
await page.evaluate(() => window.__prysm.editor.getState().setDocument({ background: { type: 'solid', color: '#1b1d24' } }));
await h.openTab('text');
const styles = ['Neon', 'GOLD', 'CHROME', 'RETRO 3D', 'STAMPED', 'Soft glow'];
for (let i = 0; i < styles.length; i++) {
  await page.locator(`[data-text-style="${styles[i]}"]`).click();
  const l = (await state(page)).doc.layers.at(-1);
  await h.patch(l.id, { x: 90 + (i % 2) * 480, y: 80 + Math.floor(i / 2) * 200, fontSize: 96, width: 440 });
}
await page.evaluate(() => document.fonts.ready);
await h.settle(1200);
await page.keyboard.press('Escape');
await canvasShot('effect-styles');

// Text on a path.
await page.getByRole('button', { name: 'Add a subheading' }).click();
let t = (await state(page)).doc.layers.at(-1);
await h.patch(t.id, { text: 'TEXT THAT FOLLOWS A CURVE', x: 140, y: 760, width: 800, fontSize: 56, fill: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ff5e62' }, { offset: 1, color: '#ffd166' }] } });
await h.selectRow(t.id);
const props = page.locator('[data-testid="properties-panel"]');
await props.getByLabel('Text path').selectOption('curve');
await h.settle(500);
await canvasShot('curve');
await page.screenshot({ path: join(OUTPUT_DIR, 'visual-type-curve-window.png') });

await page.getByRole('button', { name: 'Add a subheading' }).click();
t = (await state(page)).doc.layers.at(-1);
await h.patch(t.id, { text: 'AROUND THE CIRCLE · AROUND THE CIRCLE · ', x: 640, y: 660, width: 300, fontSize: 34, fill: { type: 'solid', color: '#ffffff' } });
await h.selectRow(t.id);
await props.getByLabel('Text path').selectOption('circle');
await h.settle(500);
await page.keyboard.press('Escape');
await canvasShot('paths');

console.log('errors:', errors);
await browser.close();
