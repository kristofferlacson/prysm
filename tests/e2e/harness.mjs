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

export async function openEditor(browser, { fresh = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto(BASE_URL);
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
