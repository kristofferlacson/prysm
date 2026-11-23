/** Screenshots of the selection tools for a visual check (not a pass/fail suite). */
import { join } from 'node:path';
import { helpers, launch, openEditor, OUTPUT_DIR, toScreen } from './harness.mjs';

const browser = await launch();
const { context, page } = await openEditor(browser, { fresh: true });
const h = helpers(page);

await h.openTab('templates');
await page.locator('[data-template]').first().click();
await h.settle(1500);
const confirm = page.locator('[data-testid="confirm-dialog"]');
if (await confirm.count()) await h.confirm(true);
await h.settle(1500);

await page.keyboard.press('m');
const { width, height } = await page.evaluate(() => window.__prysm.editor.getState().doc);
const a = await toScreen(page, width * 0.2, height * 0.25);
const b = await toScreen(page, width * 0.7, height * 0.6);
await h.drag(a, b);
await page.keyboard.press('m');
await page.keyboard.down('Shift');
const c = await toScreen(page, width * 0.55, height * 0.5);
const d = await toScreen(page, width * 0.95, height * 0.9);
await h.drag(c, d);
await page.keyboard.up('Shift');
await h.settle(400);
await page.screenshot({ path: join(OUTPUT_DIR, 'selection-marquee.png') });

await page.keyboard.press('w');
await h.settle(300);
await page.screenshot({ path: join(OUTPUT_DIR, 'selection-wand.png') });

await h.openTab('ai');
await h.settle(500);
await page.screenshot({ path: join(OUTPUT_DIR, 'selection-ai-panel.png') });

await h.viewOption((menu) => menu.getByRole('button', { name: 'Large', exact: true }).click());
await h.settle(400);
await page.screenshot({ path: join(OUTPUT_DIR, 'selection-large-ui.png') });

await context.close();
await browser.close();
