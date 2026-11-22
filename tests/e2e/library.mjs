/**
 * Asset library and import coverage: every built-in generator at full size, every effect on a real layer,
 * SVG / drag-and-drop / clipboard import, plus a few rendering rules (group opacity, hidden layers).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, makeReporter, near, openEditor, OUTPUT_DIR, state, toScreen, view } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });

const layers = async () => (await state(page)).doc.layers;
const settle = (ms = 120) => page.waitForTimeout(ms);
const patch = (id, p) => page.evaluate(([id, p]) => window.__prysm.editor.getState().updateLayers([id], p), [id, p]);
const openTab = async (id) => {
  const tab = page.locator(`[data-tab="${id}"]`);
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
};

async function section(name, fn) {
  console.log(`\n# ${name}`);
  try {
    await fn();
  } catch (err) {
    t.check(`${name}: completed without throwing`, false, String(err.message).split('\n')[0]);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function exportPixels(points, transparent = false) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dlg = page.locator('[data-testid="export-dialog"]');
  await dlg.getByRole('button', { name: 'PNG', exact: true }).click();
  await dlg.getByRole('button', { name: '1×', exact: true }).click();
  const sw = dlg.getByRole('switch', { name: 'Transparent background' });
  if ((await sw.getAttribute('aria-checked')) !== String(transparent)) await sw.click();
  const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Export PNG' }).click()]);
  const b64 = readFileSync(await download.path()).toString('base64');
  await page.waitForSelector('[data-testid="export-dialog"]', { state: 'detached' });
  return page.evaluate(
    async ({ b64, points }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      return points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    },
    { b64, points },
  );
}

const rgbNear = (a, b, tol = 3) => near(a[0], b[0], tol) && near(a[1], b[1], tol) && near(a[2], b[2], tol);

await section('Every built-in generator renders at full size', async () => {
  for (const [tab, kind] of [['textures', 'texture'], ['overlays', 'overlay'], ['backgrounds', 'background']]) {
    await openTab(tab);
    await page.waitForSelector(`[data-generator^="${kind}/"] img`);
    const ids = await page.locator(`[data-generator^="${kind}/"]`).evaluateAll((els) => els.map((e) => e.dataset.generator));
    const failures = [];
    let slowest = { id: '', ms: 0 };
    for (const id of ids) {
      const started = Date.now();
      await page.locator(`[data-generator="${id}"]`).click();
      // Wait for the full-size bitmap to be generated and drawn, then confirm the layer exists.
      const ok = await page.evaluate(async (generator) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const { doc, selectedIds } = window.__prysm.editor.getState();
        const layer = doc.layers.find((l) => l.id === selectedIds[0]);
        return layer?.source?.generator === generator ? 'ok' : 'layer missing';
      }, id);
      const ms = Date.now() - started;
      if (ms > slowest.ms) slowest = { id, ms };
      if (ok !== 'ok') failures.push(`${id}: ${ok}`);
      await page.keyboard.press('Delete');
    }
    t.check(`${ids.length} ${kind} generators add a layer without errors`, failures.length === 0 && errors.length === 0, failures.concat(errors.slice(0, 3)).join(' | ') || `slowest ${slowest.id} ${slowest.ms} ms`);
  }
  t.check('canvas is empty again', (await layers()).length === 0);
});

await section('Generated layers produce real pixels', async () => {
  await openTab('textures');
  await page.locator('[data-generator="texture/marble"]').click();
  await page.getByLabel('Blend mode', { exact: true }).selectOption('normal');
  const grid = [];
  for (let y = 100; y < 1080; y += 220) for (let x = 100; x < 1080; x += 220) grid.push([x, y]);
  const px = await exportPixels(grid);
  const distinct = new Set(px.map((p) => p.slice(0, 3).join(','))).size;
  t.check('a texture exports varied, opaque pixels', distinct > 5 && px.every((p) => p[3] === 255), `${distinct} distinct colours in ${px.length} samples`);

  // Recolouring a generated layer re-renders it with the new palette.
  await page.getByLabel('Palette colour 1 hex').fill('#ff0000');
  await page.getByLabel('Palette colour 1 hex').press('Enter');
  await page.getByLabel('Palette colour 2 hex').fill('#ff0000');
  await page.getByLabel('Palette colour 2 hex').press('Enter');
  const red = await exportPixels(grid.slice(0, 6));
  t.check('texture colours are editable', red.every((p) => p[0] > 200 && p[1] < 60 && p[2] < 60), red.map((p) => p.slice(0, 3).join(',')).join(' '));
  await page.keyboard.press('Delete');
});

await section('Every effect applies to a real layer', async () => {
  await openTab('backgrounds');
  await page.locator('[data-generator="background/geometric"]').click();
  await openTab('effects');
  const types = await page.locator('[data-effect]').evaluateAll((els) => els.map((e) => e.dataset.effect));
  const base = await exportPixels([[300, 300], [540, 540], [800, 700], [150, 900]]);
  const unchanged = [];
  for (const type of types) {
    await page.locator(`[data-effect="${type}"]`).click();
    const px = await exportPixels([[300, 300], [540, 540], [800, 700], [150, 900]]);
    if (px.every((p, i) => rgbNear(p, base[i], 1))) unchanged.push(type);
    await page.locator(`[data-effect="${type}"]`).click();
  }
  // Blur/sharpen/wave/glow sample flat triangle interiors and may legitimately leave these points alone.
  const mustChange = unchanged.filter((e) => !['blur', 'sharpen', 'wave', 'glow', 'rgb-split', 'pixelate', 'glitch'].includes(e));
  t.check(`${types.length} effects render without errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  t.check('colour and tone effects change the exported pixels', mustChange.length === 0, `unchanged: ${unchanged.join(', ') || 'none'}`);
  const after = await exportPixels([[300, 300], [540, 540]]);
  t.check('removing effects restores the original pixels', after.every((p, i) => rgbNear(p, base[i], 1)));
  await page.keyboard.press('Delete');
});

await section('Import: SVG, drag-and-drop and clipboard', async () => {
  await openTab('uploads');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#ff00ff"/><circle cx="150" cy="100" r="60" fill="#00ffff"/></svg>`;
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'badge.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 1);
  let ls = await layers();
  t.check('SVG uploads become image layers at their intrinsic size', ls[0].width === 300 && ls[0].height === 200, `${ls[0].width}x${ls[0].height}`);
  await patch(ls[0].id, { x: 100, y: 100 });
  const px = await exportPixels([[110, 110], [250, 200]]);
  t.check('SVG renders its vector content', rgbNear(px[0], [255, 0, 255]) && rgbNear(px[1], [0, 255, 255]), px.map((p) => p.join(',')).join(' '));

  // Unsupported files are rejected with a message instead of failing silently.
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await page.getByText(/Could not import: notes.txt/).waitFor();
  t.check('unsupported file types are rejected with a message', (await layers()).length === 1);

  // Drop an image file straight onto the canvas: it lands where it was dropped.
  const at = await toScreen(page, 700, 800);
  await page.evaluate(async ({ x, y }) => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    c.getContext('2d').fillRect(0, 0, 120, 80);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
    const host = document.querySelector('[data-testid="canvas-host"]');
    host.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  }, at);
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 2);
  ls = await layers();
  const dropped = ls[1];
  t.check('a dropped file is placed at the drop point', near(dropped.x + dropped.width / 2, 700, 1) && near(dropped.y + dropped.height / 2, 800, 1), `centre ${dropped.x + 60},${dropped.y + 40}`);

  // Paste an image from the clipboard.
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.getContext('2d').fillRect(0, 0, 64, 64);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 3);
  t.check('an image pasted from the clipboard becomes a layer', (await layers())[2].type === 'image');

  // Assets that no project uses can be cleaned up; ones in use are kept.
  await page.keyboard.press('Delete');
  await page.getByRole('button', { name: 'Remove images no project uses' }).click();
  await page.getByText(/Removed 1 unused image/).waitFor();
  const remaining = await page.locator('[data-testid="sidebar-panel"] img').count();
  t.check('unused uploads can be removed without touching used ones', remaining === 2, `${remaining} assets left`);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
});

await section('Rendering rules: group opacity, hidden layers, styles', async () => {
  await openTab('elements');
  await page.getByTitle('Rectangle', { exact: true }).click();
  await page.getByTitle('Rectangle', { exact: true }).click();
  let ls = await layers();
  const red = { type: 'solid', color: '#ff0000' };
  await patch(ls[0].id, { x: 100, y: 100, width: 300, height: 300, fill: red });
  await patch(ls[1].id, { x: 250, y: 250, width: 300, height: 300, fill: red });
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await page.getByLabel('Opacity', { exact: true }).first().fill('50');
  let px = await exportPixels([[150, 150], [300, 300], [500, 500]]);
  // An isolated group fades as one image, so the overlap is not darker than the rest.
  t.check('group opacity applies to the group as a whole', px.every((p) => rgbNear(p, [255, 128, 128])), px.map((p) => p.slice(0, 3).join(',')).join(' '));

  const group = (await layers())[0];
  await page.locator(`[data-layer-id="${group.id}"]`).getByRole('button', { name: 'Hide layer' }).first().click();
  px = await exportPixels([[300, 300]]);
  t.check('hidden layers are left out of the export', rgbNear(px[0], [255, 255, 255]), px[0].join(','));
  await page.keyboard.press('Control+a');
  await page.locator(`[data-layer-id="${group.id}"]`).click();
  await page.keyboard.press('Delete');

  // Styled text + shape + image styling, captured for visual review.
  await openTab('text');
  for (const name of ['Gradient', 'OUTLINE', 'Shadow pop']) {
    await page.locator('[data-testid="sidebar-panel"]').getByRole('button', { name, exact: true }).click();
  }
  ls = await layers();
  await patch(ls[0].id, { x: 80, y: 80 });
  await patch(ls[1].id, { x: 80, y: 260 });
  await patch(ls[2].id, { x: 80, y: 440 });
  await openTab('elements');
  await page.getByTitle('Star', { exact: true }).click();
  ls = await layers();
  await patch(ls[3].id, {
    x: 640,
    y: 80,
    width: 320,
    height: 320,
    fill: { type: 'linear', angle: 45, stops: [{ offset: 0, color: '#6a5cff' }, { offset: 1, color: '#3ddc97' }] },
    stroke: { color: '#1d1e22', width: 8 },
    shadow: { color: '#000000', blur: 30, offsetX: 0, offsetY: 16, opacity: 0.4 },
  });
  await openTab('backgrounds');
  await page.locator('[data-generator="background/sunburst"]').click();
  ls = await layers();
  await patch(ls[0].id, { x: 560, y: 560, width: 440, height: 440, cornerRadius: 60, stroke: { color: '#1d1e22', width: 10 }, shadow: { color: '#000000', blur: 30, offsetX: 0, offsetY: 16, opacity: 0.4 } });
  await page.keyboard.press('Control+]');
  await settle(1500);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(OUTPUT_DIR, 'visual-styles.png') });
  px = await exportPixels([[800, 240]]);
  t.check('gradient fills render', px[0][3] === 255 && !rgbNear(px[0], [255, 255, 255], 10), px[0].join(','));
});

await section('Holding Space pans the canvas', async () => {
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  const before = await view(page);
  const count = (await layers()).length;
  await page.mouse.move(host.x + 400, host.y + 400);
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(host.x + 470, host.y + 430, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const after = await view(page);
  const s = await state(page);
  t.check('space + drag pans without moving or selecting layers', near(after.pan.x - before.pan.x, 70) && near(after.pan.y - before.pan.y, 30) && s.selectedIds.length === 0 && s.doc.layers.length === count);
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
