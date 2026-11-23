/** Screenshots of the in-browser tools on a photo-like picture, for a visual check (not a pass/fail suite). */
import { join } from 'node:path';
import { helpers, launch, openEditor, OUTPUT_DIR, toScreen } from './harness.mjs';

const browser = await launch();
const { context, page } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const idle = () => page.waitForFunction(() => window.__prysm.local.getState().job === null, null, { timeout: 300000 });
const shot = async (name) => {
  await page.mouse.move(5, 5);
  await h.settle(500);
  await page.locator('[data-testid="canvas-host"]').screenshot({ path: join(OUTPUT_DIR, name) });
};

// A landscape: graded sky with clouds, hills, textured grass, a path, and a red ball with a shadow.
const SCENE = `
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6); sky.addColorStop(0, '#3f7fd0'); sky.addColorStop(1, '#cfe3f5'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.6);
  for (let i = 0; i < 9; i++) { const x = rnd() * w, y = rnd() * h * 0.35 + 10, r = 18 + rnd() * 30; const g = ctx.createRadialGradient(x, y, 2, x, y, r * 2); g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r * 2.2, r, 0, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#5d7f8f'; ctx.beginPath(); ctx.moveTo(0, h * 0.6); for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * 0.52 - Math.sin(x / 70) * 18 - Math.sin(x / 23) * 6); ctx.lineTo(w, h * 0.62); ctx.lineTo(0, h * 0.62); ctx.fill();
  const grass = ctx.createLinearGradient(0, h * 0.58, 0, h); grass.addColorStop(0, '#6f9a4a'); grass.addColorStop(1, '#3f6a2a'); ctx.fillStyle = grass; ctx.fillRect(0, h * 0.58, w, h * 0.42);
  for (let i = 0; i < 9000; i++) { const x = rnd() * w, y = h * 0.58 + rnd() * h * 0.42; ctx.strokeStyle = 'rgba(' + (rnd() < 0.5 ? '20,50,10' : '170,210,110') + ',' + (0.15 + rnd() * 0.3) + ')'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rnd() * 4 - 2, y - 3 - rnd() * 6); ctx.stroke(); }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.83, 46, 10, 0, 0, 7); ctx.fill();
  const ball = ctx.createRadialGradient(w * 0.53, h * 0.72, 4, w * 0.55, h * 0.75, 40); ball.addColorStop(0, '#ffb08a'); ball.addColorStop(0.4, '#e23a22'); ball.addColorStop(1, '#6e0d08'); ctx.fillStyle = ball; ctx.beginPath(); ctx.arc(w * 0.55, h * 0.75, 38, 0, 7); ctx.fill();
`;
const url = await page.evaluate((draw) => {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 420;
  new Function('ctx', 'w', 'h', draw)(c.getContext('2d'), c.width, c.height);
  return c.toDataURL('image/png');
}, SCENE);

await page.locator('[data-testid="canvas-size"]').click();
await h.setField('Canvas width', 1000);
await h.setField('Canvas height', 700);
await h.openTab('uploads');
await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'scene.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 1);
const [scene] = await h.layers();
await h.patch(scene.id, { x: 180, y: 140 });
await page.evaluate(() => window.__prysm.ui.getState().set({ panelsHidden: false }));
await shot('local-1-original.png');

// Remove the ball (and its shadow) with content-aware fill.
await page.keyboard.press('m');
const a = await toScreen(page, 180 + 640 * 0.55 - 60, 140 + 420 * 0.75 - 50);
const b = await toScreen(page, 180 + 640 * 0.55 + 62, 140 + 420 * 0.75 + 52);
await h.drag(a, b);
await page.locator('[data-testid="selection-panel"]').getByRole('button', { name: 'Content-aware fill', exact: true }).click();
await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 2, null, { timeout: 120000 });
await idle();
await page.keyboard.press('Control+d');
await page.keyboard.press('v');
await shot('local-2-object-removed.png');
console.log('fill', await page.evaluate(() => window.__prysm.local.getState().lastRun));

// Expand the original photo to fill the canvas.
await page.evaluate(() => {
  const e = window.__prysm.editor.getState();
  e.deleteLayers([e.doc.layers[1].id]);
});
await h.selectRow(scene.id);
const props = page.locator('[data-testid="properties-panel"]');
await props.getByRole('button', { name: 'Expand', exact: true }).click();
await props.getByRole('button', { name: 'Fill the canvas', exact: true }).click();
await page.waitForFunction((src) => JSON.stringify(window.__prysm.editor.getState().doc.layers[0].source) !== src, JSON.stringify(scene.source), { timeout: 180000 });
await idle();
await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
await shot('local-3-expanded.png');
console.log('expand', await page.evaluate(() => window.__prysm.local.getState().lastRun));
await page.keyboard.press('Control+z');

// Upscale a small crop of the scene 4x and show it next to plain enlargement.
const small = await page.evaluate((draw) => {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 420;
  new Function('ctx', 'w', 'h', draw)(c.getContext('2d'), c.width, c.height);
  const d = document.createElement('canvas');
  d.width = 200;
  d.height = 130;
  d.getContext('2d').drawImage(c, 250, 230, 200, 130, 0, 0, 200, 130);
  return d.toDataURL('image/png');
}, SCENE);
await page.evaluate(() => {
  const e = window.__prysm.editor.getState();
  e.deleteLayers(e.doc.layers.map((l) => l.id));
});
for (const name of ['plain.png', 'upscaled.png']) {
  const before = (await h.layers()).length;
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(small.split(',')[1], 'base64') });
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before);
}
const [plain, up] = await h.layers();
await h.patch(plain.id, { x: 10, y: 190, width: 480, height: 312 });
await h.patch(up.id, { x: 510, y: 190, width: 480, height: 312 });
await h.selectRow(up.id);
await props.getByRole('button', { name: 'Upscale', exact: true }).click();
await props.getByRole('button', { name: /^4× to/ }).click();
await page.waitForFunction((id) => window.__prysm.editor.getState().doc.layers[1].source.assetId !== id, up.source.assetId, { timeout: 300000 });
await idle();
await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
await shot('local-4-upscale-left-plain-right-model.png');
console.log('upscale', await page.evaluate(() => window.__prysm.local.getState().lastRun));

await context.close();
await browser.close();
