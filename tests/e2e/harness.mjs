import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE_URL = process.env.PRYSM_URL ?? 'http://localhost:5173';
export const OUTPUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'output');
mkdirSync(OUTPUT_DIR, { recursive: true });

/** Launches an installed browser (Edge, then Chrome) so no browser download is needed. */
export async function launch() {
  let lastError;
  for (const channel of ['msedge', 'chrome']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** The right-hand panel set to "All" for every kind of selection: every section in one list. */
export const ALL_SECTIONS = JSON.stringify({ image: 'all', generated: 'all', text: 'all', shape: 'all', group: 'all', multi: 'all', canvas: 'all' });

/**
 * Opens the editor. The suites that test what a control does (not where it is) run with the
 * right-hand panel set to "All", its single-list view, so any control can be reached directly;
 * `tabs: true` leaves the panel in its default tabbed view (navigation.mjs tests that).
 */
export async function openEditor(browser, { fresh = false, tabs = false, viewport = { width: 1720, height: 960 } } = {}) {
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  if (!tabs) {
    // Set before every load, so it also holds after a test clears storage or reloads the page.
    await context.addInitScript((value) => {
      try {
        localStorage.setItem('prysm.inspectorTabs', value);
      } catch {
        // Storage is unavailable on the blank start page.
      }
    }, ALL_SECTIONS);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  // The editor asks its questions in its own dialog. A browser dialog appearing is a defect.
  page.on('dialog', (dialog) => {
    errors.push(`native browser dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  // The address "#/editor" opens the editor; without it the app starts on its home page.
  await page.goto(`${BASE_URL}/#/editor`);
  if (fresh) {
    await page.evaluate(async () => {
      localStorage.clear();
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('prysm');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    });
    await page.reload();
  }
  await page.waitForSelector('[data-testid="editor"]');
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  return { context, page, errors };
}

/** Reads document state through the dev-only test hook. */
export const state = (page) =>
  page.evaluate(() => {
    const s = window.__prysm.editor.getState();
    return { doc: s.doc, selectedIds: s.selectedIds, past: s.past.length, future: s.future.length };
  });

export const view = (page) =>
  page.evaluate(() => {
    const s = window.__prysm.ui.getState();
    return { zoom: s.zoom, pan: s.pan, saveStatus: s.saveStatus };
  });

/** Converts a document coordinate to a page coordinate for real mouse input. */
export async function toScreen(page, x, y) {
  const box = await page.locator('[data-testid="canvas-host"]').boundingBox();
  const v = await view(page);
  return { x: box.x + v.pan.x + x * v.zoom, y: box.y + v.pan.y + y * v.zoom };
}

export async function waitForSaved(page) {
  await page.waitForFunction(() => window.__prysm.ui.getState().saveStatus === 'saved', null, { timeout: 15000 });
}

export function makeReporter() {
  const results = [];
  return {
    results,
    check(name, condition, detail = '') {
      results.push({ name, ok: !!condition, detail });
      console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
    },
    summary() {
      const failed = results.filter((r) => !r.ok);
      console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
      return failed.length;
    },
  };
}

export const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

/** Common UI-driving helpers bound to a page. */
export function helpers(page) {
  const h = {
    settle: (ms = 120) => page.waitForTimeout(ms),
    layers: async () => (await state(page)).doc.layers,
    layerById: async (id) => (await h.layers()).find((l) => l.id === id),
    selectRow: (id, modifiers = []) => page.locator(`[data-layer-id="${id}"]`).click({ modifiers }),
    patch: (id, p) => page.evaluate(([id, p]) => window.__prysm.editor.getState().updateLayers([id], p), [id, p]),
    async openTab(id) {
      const tab = page.locator(`[data-tab="${id}"]`);
      if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
    },
    async setField(label, value, scope = page) {
      const field = scope.getByLabel(label, { exact: true });
      await field.fill(String(value));
      await field.press('Enter');
    },
    async drag(from, to, steps = 10) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      }
      await page.mouse.up();
      await h.settle();
    },
    /** A brush / eraser stroke through document-space points. */
    async stroke(points, steps = 8) {
      const first = await toScreen(page, points[0][0], points[0][1]);
      await page.mouse.move(first.x, first.y);
      await page.mouse.down();
      for (let i = 1; i < points.length; i++) {
        const a = await toScreen(page, points[i - 1][0], points[i - 1][1]);
        const b = await toScreen(page, points[i][0], points[i][1]);
        for (let k = 1; k <= steps; k++) await page.mouse.move(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
      }
      await page.mouse.up();
      await h.settle(150);
    },
    /** Decodes an encoded image in the browser and samples pixels. */
    decode: (buffer, mime, points) =>
      page.evaluate(
        async ({ b64, mime, points }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bytes], { type: mime }), { premultiplyAlpha: 'none' });
          const c = document.createElement('canvas');
          c.width = bmp.width;
          c.height = bmp.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(bmp, 0, 0);
          return {
            width: bmp.width,
            height: bmp.height,
            pixels: points.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data)),
          };
        },
        { b64: buffer.toString('base64'), mime, points },
      ),
    /** Exports a PNG through the Export dialog and samples it. */
    async exportPng(points = [], { transparent = false, scale = '1×' } = {}) {
      const { readFileSync } = await import('node:fs');
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const dlg = page.locator('[data-testid="export-dialog"]');
      await dlg.getByRole('button', { name: 'PNG', exact: true }).click();
      await dlg.getByRole('button', { name: scale, exact: true }).click();
      const sw = dlg.getByRole('switch', { name: 'Transparent background' });
      if ((await sw.getAttribute('aria-checked')) !== String(transparent)) await sw.click();
      const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: 'Export PNG' }).click()]);
      const buffer = readFileSync(await download.path());
      await page.waitForSelector('[data-testid="export-dialog"]', { state: 'detached' });
      return { buffer, ...(await h.decode(buffer, 'image/png', points)) };
    },
    /** Samples what the editor canvas currently shows at document coordinates. */
    async screenPixels(points) {
      await page.mouse.move(4, 4);
      const shot = await page.locator('[data-testid="canvas-host"]').screenshot();
      const v = await view(page);
      return (await h.decode(shot, 'image/png', points.map(([x, y]) => [v.pan.x + x * v.zoom, v.pan.y + y * v.zoom]))).pixels;
    },
    /**
     * Measures an exported PNG: where the opaque pixels ("ink") are, a signature of the whole
     * picture, and optionally how the ink lies around a centre and how many pixels match a colour.
     */
    stats: (buffer, { centre = null, match = null, tolerance = 12 } = {}) =>
      page.evaluate(
        async ({ b64, centre, match, tolerance }) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none' });
          const c = document.createElement('canvas');
          c.width = bmp.width;
          c.height = bmp.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(bmp, 0, 0);
          const { data } = ctx.getImageData(0, 0, c.width, c.height);
          const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
          const polar = { rMin: Infinity, rMax: -Infinity };
          let ink = 0, soft = 0, matched = 0, lighter = 0, darker = 0, sumY = 0, signature = 0, colours = new Set();
          for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
              const i = (y * c.width + x) * 4;
              const a = data[i + 3];
              signature = (signature + (data[i] * 3 + data[i + 1] * 5 + data[i + 2] * 7 + a * 11) * ((x % 251) + 1) * ((y % 241) + 1)) % 2147483647;
              if (a > 8 && a <= 128) soft++;
              if (a <= 128) continue;
              ink++;
              sumY += y;
              if ((x + y * 7) % 97 === 0) colours.add((data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4));
              if (x < box.left) box.left = x;
              if (x > box.right) box.right = x;
              if (y < box.top) box.top = y;
              if (y > box.bottom) box.bottom = y;
              if (match && Math.abs(data[i] - match[0]) <= tolerance && Math.abs(data[i + 1] - match[1]) <= tolerance && Math.abs(data[i + 2] - match[2]) <= tolerance) matched++;
              if (a > 250 && data[i + 1] > 70 && data[i + 2] > 70) lighter++;
              if (a > 250 && data[i] < 185 && data[i + 1] < 30) darker++;
              if (centre) {
                const r = Math.hypot(x + 0.5 - centre.x, y + 0.5 - centre.y);
                if (r < polar.rMin) polar.rMin = r;
                if (r > polar.rMax) polar.rMax = r;
              }
            }
          }
          return { width: c.width, height: c.height, ink, soft, matched, lighter, darker, meanY: ink ? sumY / ink : 0, box, polar, signature, colours: colours.size };
        },
        { b64: buffer.toString('base64'), centre, match, tolerance },
      ),
    /** Changes a setting in the top bar's View menu (rulers, grid, interface size) and closes the menu again. */
    async viewOption(act) {
      const menu = page.locator('[data-testid="view-menu"]');
      if (!(await menu.count())) await page.getByRole('button', { name: 'View options' }).click();
      await act(menu);
      await page.keyboard.press('Escape');
      await menu.waitFor({ state: 'detached' });
    },
    /** Answers the editor's confirm dialog. */
    async confirm(accept = true) {
      const dlg = page.locator('[data-testid="confirm-dialog"]');
      await dlg.waitFor();
      await (accept ? dlg.locator('button').last() : dlg.getByRole('button', { name: 'Cancel' })).click();
      await dlg.waitFor({ state: 'detached' });
    },
    async section(t, name, fn) {
      console.log(`\n# ${name}`);
      try {
        await fn();
      } catch (err) {
        t.check(`${name}: completed without throwing`, false, String(err.message).split('\n')[0]);
        await page.keyboard.press('Escape').catch(() => {});
      }
    },
  };
  return h;
}

/**
 * Removes a background the way a user does: "Remove background" opens the dialog, the automatic
 * suggestion appears, and Apply stores it. When there is nothing to apply (no subject was found,
 * the model is missing, the picture cannot be worked on) the dialog is cancelled instead, and the
 * reason stays in the background-removal job. Uses only what is on the page, so it also works on a
 * production build.
 *
 * On a layer that already has a cut-out the dialog opens with that cut-out; `again` (the default)
 * then presses Automatic, so the subject is found afresh as on a first run.
 */
export async function removeBackground(page, scope = page, { apply = true, again = true, timeout = 180000 } = {}) {
  await scope.locator('[data-testid="bg-removal"] button').click();
  const dialog = page.locator('[data-testid="removal-dialog"]');
  await dialog.waitFor();
  await page.waitForSelector('[data-testid="removal-dialog"]:not([data-state="working"])', { timeout });
  if (again && (await dialog.getAttribute('data-reedit')) === 'true') {
    const before = Number(await dialog.getAttribute('data-suggestions'));
    await dialog.getByRole('button', { name: 'Automatic', exact: true }).click();
    await page.waitForFunction(
      (n) => {
        const el = document.querySelector('[data-testid="removal-dialog"]');
        return !!el && Number(el.dataset.suggestions) > n && el.dataset.state !== 'working';
      },
      before,
      { timeout },
    );
  }
  const state = await dialog.getAttribute('data-state');
  const button = dialog.getByRole('button', { name: 'Apply', exact: true });
  const applied = apply && state === 'ready' && (await button.isEnabled());
  await (applied ? button : dialog.getByRole('button', { name: 'Cancel', exact: true })).click();
  await dialog.waitFor({ state: 'detached' });
  return { state, applied };
}

export const rgbNear = (a, b, tol = 3) => near(a[0], b[0], tol) && near(a[1], b[1], tol) && near(a[2], b[2], tol);
export const fmt = (px) => `[${px.slice(0, 4).join(',')}]`;
