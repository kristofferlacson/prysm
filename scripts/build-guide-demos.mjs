/**
 * Records the guide's demonstrations: a short video of the real editor doing each task, with a
 * visible pointer, the keys that are pressed, and a caption for every step.
 *
 *   npm run dev                       (terminal 1)
 *   npm run guide:demos               (terminal 2)   all topics
 *   npm run guide:demos -- crop mask  only these topics
 *
 * Output: public/guide/<topic>.webm and src/features/guide/demos.ts (which part of each video to
 * play, and what the caption says when). Run it again whenever the interface changes.
 *
 * It uses an installed Edge or Chrome through playwright-core, a throwaway browser profile for each
 * topic, and Playwright's own video recorder ("npx playwright-core install ffmpeg", once).
 */
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'guide');
const TMP = join(tmpdir(), 'prysm-guide-recordings');
const BASE = process.env.PRYSM_URL ?? 'http://localhost:5173';
const VIEW = { width: 1360, height: 800 };
/** The videos are saved a little smaller than the window; they are shown smaller still in the guide. */
const VIDEO = { width: 1088, height: 640 };
const { GUIDE } = await import(pathToFileURL(join(ROOT, 'src/features/guide/guide.ts')).href);
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
/** --dry runs the demonstrations without keeping anything: a check that each one still works in the current interface. */
const dry = process.argv.includes('--dry');

mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
if (!only.length) for (const file of readdirSync(OUT)) if (/\.(webm|jpg)$/.test(file)) rmSync(join(OUT, file));

let browser;
for (const channel of ['msedge', 'chrome']) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    break;
  } catch {
    // Try the next browser.
  }
}
if (!browser) throw new Error('Edge or Chrome is needed to record the demonstrations.');

/** Playwright's own ffmpeg (the one that records), used again to trim and compress each recording. */
function findFfmpeg() {
  const home = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'ms-playwright') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright'));
  try {
    for (const dir of readdirSync(home).filter((d) => d.startsWith('ffmpeg-')).sort().reverse()) {
      for (const name of readdirSync(join(home, dir))) if (name.startsWith('ffmpeg')) return join(home, dir, name);
    }
  } catch {
    // Not installed where expected.
  }
  return null;
}
const ffmpeg = findFfmpeg();
if (!ffmpeg) console.log('ffmpeg was not found: recordings are kept as recorded (larger files).');

/** Runs in the page: a pointer that follows the mouse, a ripple on every click, and the keys pressed. */
const POINTER = `(() => {
  const make = () => {
    if (document.getElementById('demo-pointer') || !document.documentElement) return;
    const pointer = document.createElement('div');
    pointer.id = 'demo-pointer';
    pointer.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 2.5l14.5 8.2-6.4 1.7-2.6 6.3z" fill="#ffffff" stroke="#101216" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    pointer.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(680px,420px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.7))';
    const keys = document.createElement('div');
    keys.id = 'demo-keys';
    keys.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2147483646;pointer-events:none;padding:7px 14px;border-radius:8px;background:rgba(16,18,22,.92);border:1px solid #3ddc97;color:#fff;font:600 15px/1 system-ui,sans-serif;letter-spacing:.02em;opacity:0;transition:opacity .15s';
    document.documentElement.append(pointer, keys);
    let hide = 0;
    addEventListener('mousemove', (e) => { pointer.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('mousedown', (e) => {
      const ripple = document.createElement('div');
      ripple.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;left:' + (e.clientX - 16) + 'px;top:' + (e.clientY - 16) + 'px;width:32px;height:32px;border-radius:50%;border:2px solid #3ddc97;background:rgba(61,220,151,.25);transition:transform .45s ease-out,opacity .45s ease-out';
      document.documentElement.appendChild(ripple);
      requestAnimationFrame(() => { ripple.style.transform = 'scale(1.9)'; ripple.style.opacity = '0'; });
      setTimeout(() => ripple.remove(), 500);
    }, true);
    addEventListener('keydown', (e) => {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const t = e.target;
      // Typing into a field is shown by the field itself.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !e.ctrlKey && e.key.length === 1) return;
      const name = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key === 'Escape' ? 'Esc' : e.key;
      keys.textContent = (e.ctrlKey ? 'Ctrl + ' : '') + (e.shiftKey ? 'Shift + ' : '') + (e.altKey ? 'Alt + ' : '') + name;
      keys.style.opacity = '1';
      clearTimeout(hide);
      hide = setTimeout(() => { keys.style.opacity = '0'; }, 1100);
    }, true);
  };
  make();
  document.addEventListener('DOMContentLoaded', make);
})();`;

// ---------- state of the recording in progress ----------

let page;
let t0 = 0;
let marks = [];
let startAt = null;
let mouse = { x: 680, y: 420 };

const now = () => (Date.now() - t0) / 1000;
const hold = (ms = 400) => page.waitForTimeout(ms);
const E = (fn, arg) => page.evaluate(fn, arg);
const $ = (selector) => page.locator(selector);
const props = () => $('[data-testid="properties-panel"]');
const selectionPanel = () => $('[data-testid="selection-panel"]');
const button = (name, scope = page) => scope.getByRole('button', { name, exact: typeof name === 'string' });
const layers = () => E(() => window.__prysm.editor.getState().doc.layers);
const patch = (id, p) => E(([id, p]) => window.__prysm.editor.getState().updateLayers([id], p), [id, p]);
const select = (...ids) => E((ids) => window.__prysm.editor.getState().select(ids), ids);

/** The caption from here on. The first one also marks where the video starts being shown. */
async function say(caption) {
  if (startAt === null) startAt = Math.max(0, now() - 0.25);
  marks.push({ at: +now().toFixed(2), caption });
  await hold(750);
}

/** Moves the pointer smoothly, as a hand would. */
async function moveTo(x, y, ms = 520) {
  const from = { ...mouse };
  const steps = Math.max(6, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
    await page.waitForTimeout(13);
  }
  mouse = { x, y };
}
const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
async function boxOf(target) {
  await target.first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await target.first().boundingBox({ timeout: 5000 });
  if (!box) throw new Error('Nothing to point at');
  return box;
}
const ring = (box) =>
  E((b) => {
    document.querySelectorAll('.demo-ring').forEach((el) => el.remove());
    if (!b) return;
    const el = document.createElement('div');
    el.className = 'demo-ring';
    el.style.cssText = `position:fixed;left:${b.x - 4}px;top:${b.y - 4}px;width:${b.width + 8}px;height:${b.height + 8}px;border:2px solid #3ddc97;border-radius:8px;box-shadow:0 0 0 4px rgba(61,220,151,.28);z-index:2147483640;pointer-events:none`;
    document.body.appendChild(el);
  }, box);

/** Points at something (outlining it), then clicks it. */
async function click(target, { after = 550, outline = true } = {}) {
  const box = await boxOf(target);
  if (outline) await ring(box);
  const c = centre(box);
  await moveTo(c.x, c.y);
  await hold(160);
  await page.mouse.down();
  await page.mouse.up();
  await ring(null);
  await hold(after);
}
/** Points at something without clicking. */
async function point(target, ms = 900) {
  const box = await boxOf(target);
  await ring(box);
  const c = centre(box);
  await moveTo(c.x, c.y);
  await hold(ms);
  await ring(null);
}
async function toScreen(x, y) {
  const box = await $('[data-testid="canvas-host"]').boundingBox();
  const v = await E(() => ({ zoom: window.__prysm.ui.getState().zoom, pan: window.__prysm.ui.getState().pan }));
  return { x: box.x + v.pan.x + x * v.zoom, y: box.y + v.pan.y + y * v.zoom };
}
async function dragScreen(a, b, ms = 850) {
  await moveTo(a.x, a.y);
  await hold(120);
  await page.mouse.down();
  await moveTo(b.x, b.y, ms);
  await hold(120);
  await page.mouse.up();
  await hold(350);
}
/** Drags between two points of the design (canvas coordinates). */
const drag = async (from, to, ms) => dragScreen(await toScreen(...from), await toScreen(...to), ms);
async function clickDoc(x, y, opts = {}) {
  const p = await toScreen(x, y);
  await moveTo(p.x, p.y);
  await hold(140);
  await page.mouse.click(p.x, p.y, opts);
  await hold(500);
}
/** Draws a path through points of the design with the button held (lasso, brush). */
async function stroke(points, ms = 1400) {
  const first = await toScreen(...points[0]);
  await moveTo(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const s = await toScreen(...p);
    await moveTo(s.x, s.y, ms / points.length);
  }
  await page.mouse.up();
  await hold(350);
}
/** Moves a slider to a value the way a hand would: pointer on it, then the value travelling there. */
async function slide(target, to, { steps = 9 } = {}) {
  const box = await boxOf(target);
  await ring(box);
  const c = centre(box);
  await moveTo(c.x, c.y);
  const from = Number(await target.first().inputValue());
  for (let i = 1; i <= steps; i++) {
    const v = from + ((to - from) * i) / steps;
    await target.first().fill(String(Number.isInteger(to) && Number.isInteger(from) ? Math.round(v) : +v.toFixed(2)));
    await page.waitForTimeout(55);
  }
  await ring(null);
  await hold(500);
}
/** Picks an option of a drop-down. */
async function choose(target, value) {
  const box = await boxOf(target);
  await ring(box);
  const c = centre(box);
  await moveTo(c.x, c.y);
  await hold(250);
  await target.first().selectOption(value);
  await ring(null);
  await hold(650);
}
/** Clicks a field and types into it. */
async function type(target, text, { enter = true } = {}) {
  await click(target, { after: 150 });
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text, { delay: 55 });
  if (enter) await page.keyboard.press('Enter');
  await hold(550);
}
async function press(key, after = 650) {
  await page.keyboard.press(key);
  await hold(after);
}
/** Opens a tab of the right-hand panel (with the pointer, unless quiet), if it is not the one showing. */
async function tab(id, { quiet = false, after = 550 } = {}) {
  const target = $(`[data-inspector-tab="${id}"]`);
  if ((await target.getAttribute('aria-selected')) === 'true') return;
  if (quiet) {
    await target.click();
    await hold(200);
  } else await click(target, { after });
}
/** The sections of the Select tab; every other section belongs to a tab of the selected layer. */
const SELECTION_SECTIONS = new Set(['Select', 'Saved selections', 'Adjust', 'Use on layer', 'Fill and remove', 'AI']);
/** The tab of the right-hand panel that holds a section, for what is selected now. */
const tabOf = (title) =>
  SELECTION_SECTIONS.has(title)
    ? 'selection'
    : E((title) => {
        const p = window.__prysm;
        const s = p.editor.getState();
        const find = (list, id) => {
          for (const l of list) {
            if (l.id === id) return l;
            const inside = l.type === 'group' ? find(l.children, id) : null;
            if (inside) return inside;
          }
          return null;
        };
        return p.inspector.sectionTab(title, p.inspector.kindOf(s.selectedIds.map((id) => find(s.doc.layers, id)).filter(Boolean)));
      }, title);
/** Opens a section of the right-hand panel (with the pointer, unless quiet) and returns it. Its tab is opened first when it is on another one. */
async function section(title, scope = props(), { quiet = false } = {}) {
  const header = scope.getByRole('button', { name: title, exact: true });
  if (!(await header.count())) await tab(await tabOf(title), { quiet });
  const body = header.locator('xpath=ancestor::section[1]');
  await header.scrollIntoViewIfNeeded();
  if ((await body.locator(':scope > div').count()) < 2) {
    if (quiet) await header.click();
    else await click(header, { after: 400 });
  }
  return body;
}
const slider = (label, scope = props()) => scope.getByLabel(label, { exact: true });
const idle = (store, timeout = 240000) => page.waitForFunction((s) => (s === 'removal' ? ['done', 'error'].includes(window.__prysm.backgroundRemoval.getState().job?.phase) : window.__prysm.local.getState().job === null), store, { timeout });
/** Fits the canvas to its area, once the editor has caught up with the area's current size (a side panel may just have opened or closed). */
async function fit() {
  await page
    .waitForFunction(
      () => {
        const host = document.querySelector('[data-testid="canvas-host"]');
        const v = window.__prysm.ui.getState().viewport;
        return !!host && Math.abs(host.clientWidth - v.w) < 2 && Math.abs(host.clientHeight - v.h) < 2;
      },
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  await E(() => {
    const d = window.__prysm.editor.getState().doc;
    window.__prysm.ui.getState().fitToScreen(d.width, d.height);
  });
  await page.waitForTimeout(120);
}
/** Closes the left panel so the canvas has the room. */
async function closeSidebar() {
  await E(() => window.__prysm.ui.getState().set({ sidebarTab: null }));
  await hold(300);
  await fit();
  await hold(200);
}

/** Prepares the stage before the part of the recording that is shown: canvas size, background, which side panel is open. */
async function setup({ w = 1000, h = 700, background = { type: 'solid', color: '#ffffff' }, tab = null } = {}) {
  await E(
    ({ w, h, background, tab }) => {
      const p = window.__prysm;
      p.ui.getState().set({ sidebarTab: tab, tool: 'move' });
      p.editor.getState().setDocument({ width: w, height: h, background }, { history: false });
    },
    { w, h, background, tab },
  );
  await hold(300);
  await fit();
  await hold(200);
}

const PICTURES = {
  // A landscape with a red ball on the grass.
  scene: [
    640,
    420,
    `let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
     const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6); sky.addColorStop(0, '#3f7fd0'); sky.addColorStop(1, '#cfe3f5'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.6);
     for (let i = 0; i < 9; i++) { const x = rnd() * w, y = rnd() * h * 0.35 + 10, r = 18 + rnd() * 30; const g = ctx.createRadialGradient(x, y, 2, x, y, r * 2); g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r * 2.2, r, 0, 0, 7); ctx.fill(); }
     ctx.fillStyle = '#5d7f8f'; ctx.beginPath(); ctx.moveTo(0, h * 0.6); for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * 0.52 - Math.sin(x / 70) * 18 - Math.sin(x / 23) * 6); ctx.lineTo(w, h * 0.62); ctx.lineTo(0, h * 0.62); ctx.fill();
     const grass = ctx.createLinearGradient(0, h * 0.58, 0, h); grass.addColorStop(0, '#6f9a4a'); grass.addColorStop(1, '#3f6a2a'); ctx.fillStyle = grass; ctx.fillRect(0, h * 0.58, w, h * 0.42);
     for (let i = 0; i < 9000; i++) { const x = rnd() * w, y = h * 0.58 + rnd() * h * 0.42; ctx.strokeStyle = 'rgba(' + (rnd() < 0.5 ? '20,50,10' : '170,210,110') + ',' + (0.15 + rnd() * 0.3) + ')'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rnd() * 4 - 2, y - 3 - rnd() * 6); ctx.stroke(); }
     ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(w * 0.55, h * 0.83, 46, 10, 0, 0, 7); ctx.fill();
     const ball = ctx.createRadialGradient(w * 0.53, h * 0.72, 4, w * 0.55, h * 0.75, 40); ball.addColorStop(0, '#ffb08a'); ball.addColorStop(0.4, '#e23a22'); ball.addColorStop(1, '#6e0d08'); ctx.fillStyle = ball; ctx.beginPath(); ctx.arc(w * 0.55, h * 0.75, 38, 0, 7); ctx.fill();`,
  ],
  // A studio-style photo: two red balls in front of a textured wall.
  subject: [
    640,
    480,
    `const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#8c8478'); g.addColorStop(1, '#5f5a52'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
     let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
     for (let i = 0; i < 2600; i++) { ctx.fillStyle = 'rgba(' + (rnd() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (0.02 + rnd() * 0.05) + ')'; ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 26, 1 + rnd() * 3); }
     for (let y = 60; y < h; y += 96) { ctx.fillStyle = 'rgba(30,25,20,0.35)'; ctx.fillRect(0, y, w, 3); }
     const ball = (x, y, r) => { const s = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r); s.addColorStop(0, '#ffb08a'); s.addColorStop(0.35, '#e23a22'); s.addColorStop(1, '#6e0d08'); ctx.fillStyle = s; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
     ball(400, 150, 58); ball(300, 255, 135);`,
  ],
  // A pale moth on a dark background: bright subject, dark surroundings.
  moth: [
    560,
    640,
    `const bg = ctx.createRadialGradient(w * 0.55, h * 0.45, 30, w * 0.55, h * 0.45, h * 0.75); bg.addColorStop(0, '#2b2723'); bg.addColorStop(1, '#0c0b0a'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
     const wing = (draw, a, b) => { ctx.beginPath(); draw(); ctx.closePath(); const g = ctx.createLinearGradient(w * 0.45, h * 0.6, w * 0.8, h * 0.15); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fill(); };
     wing(() => { ctx.moveTo(w * 0.46, h * 0.58); ctx.bezierCurveTo(w * 0.3, h * 0.22, w * 0.62, h * 0.06, w * 0.84, h * 0.12); ctx.bezierCurveTo(w * 0.9, h * 0.36, w * 0.72, h * 0.52, w * 0.46, h * 0.58); }, '#b9b5ad', '#fbf9f4');
     wing(() => { ctx.moveTo(w * 0.46, h * 0.58); ctx.bezierCurveTo(w * 0.72, h * 0.56, w * 0.82, h * 0.72, w * 0.66, h * 0.86); ctx.bezierCurveTo(w * 0.54, h * 0.84, w * 0.47, h * 0.7, w * 0.46, h * 0.58); }, '#8f8b84', '#e9e6df');
     ctx.strokeStyle = 'rgba(70,66,60,0.55)'; ctx.lineWidth = 1.4;
     for (let i = 0; i < 11; i++) { const t = i / 10; ctx.beginPath(); ctx.moveTo(w * 0.46, h * 0.58); ctx.quadraticCurveTo(w * (0.48 + t * 0.2), h * (0.4 - t * 0.1), w * (0.42 + t * 0.44), h * (0.2 - t * 0.02 + t * t * 0.3)); ctx.stroke(); }
     for (let i = 0; i < 6; i++) { const t = i / 5; ctx.beginPath(); ctx.moveTo(w * 0.46, h * 0.58); ctx.lineTo(w * (0.76 - t * 0.2), h * (0.66 + t * 0.19)); ctx.stroke(); }
     ctx.fillStyle = '#4a443c'; ctx.save(); ctx.translate(w * 0.44, h * 0.62); ctx.rotate(0.5); ctx.beginPath(); ctx.ellipse(0, 0, 13, 62, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();`,
  ],
  // A logo on a plain white backdrop.
  logo: [
    480,
    360,
    `ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
     const blob = (x, y, rx, ry, fill, line) => { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = line; ctx.strokeStyle = '#111111'; ctx.stroke(); };
     blob(90, 200, 42, 84, '#d92525', 7); blob(390, 200, 42, 84, '#d92525', 7); blob(240, 190, 96, 108, '#d92525', 7); blob(240, 178, 36, 42, '#ffffff', 5);`,
  ],
};
/** Uploads one of the pictures above and places it (before the part of the recording that is shown). */
async function picture(kind, box, { flat = false, small = false } = {}) {
  const [w, h, draw] = PICTURES[kind];
  const url = await E(
    ({ w, h, draw, flat, small }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      new Function('ctx', 'w', 'h', draw)(ctx, w, h);
      if (flat) {
        // A dull, low-contrast version: everything squeezed into the middle tones.
        const image = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < image.data.length; i += 4) for (let k = 0; k < 3; k++) image.data[i + k] = 70 + image.data[i + k] * 0.42;
        ctx.putImageData(image, 0, 0);
      }
      if (!small) return c.toDataURL('image/png');
      const s = document.createElement('canvas');
      s.width = 180;
      s.height = 118;
      s.getContext('2d').drawImage(c, 240, 220, 240, 157, 0, 0, 180, 118);
      return s.toDataURL('image/png');
    },
    { w, h, draw, flat, small },
  );
  const before = (await layers()).length;
  const openTab = await E(() => window.__prysm.ui.getState().sidebarTab);
  await E(() => window.__prysm.ui.getState().set({ sidebarTab: 'uploads' }));
  await $('[data-testid="upload-input"]').setInputFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before);
  const layer = (await layers()).at(-1);
  await E((tab) => window.__prysm.ui.getState().set({ sidebarTab: tab }), openTab);
  await hold(300);
  await fit();
  if (box) await patch(layer.id, box);
  await hold(350);
  return (await layers()).at(-1);
}

const CENTRE = { x: 180, y: 140, width: 640, height: 420 };
const BALL = [180 + 640 * 0.55, 140 + 420 * 0.75];
const PHOTO = { x: 180, y: 110, width: 640, height: 480 };

// ---------- the demonstrations, one per guide topic ----------

const DEMOS = {
  async start() {
    await E(() => window.__prysm.ui.getState().set({ home: true }));
    await hold(500);
    await say('The app opens on the home page. Scroll down to “Start a new design”.');
    await $('[data-testid="home"]').evaluate((el) => el.scrollTo({ top: 560, behavior: 'smooth' }));
    await hold(1100);
    await say('Pick a size (or a template, further down).');
    await click($('[data-home-preset="portrait"]'), { after: 900 });
    await say('The editor opens with a blank canvas of that size: things to add on the left, settings on the right, layers at the bottom right.');
    await point($('[data-tab="elements"]'), 700);
    await point($('[data-testid="layers-panel"]'), 900);
  },
  async 'find-your-way'() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select();
    await hold(500);
    await say('On the left is everything you can add. Along the top are the tools, undo, zoom and Export.');
    await point($('[data-tab="elements"]'), 800);
    await point(page.getByRole('button', { name: /^Lasso \(/ }), 800);
    await say('On the right are the settings of whatever is selected, in a few tabs. A photo has Adjust, Effects, Cut out, Layout and Style.');
    await click($(`[data-layer-id="${photo.id}"]`), { after: 700 });
    await tab('cutout', { after: 800 });
    await tab('layout', { after: 800 });
    await tab('style', { after: 900 });
    await say('Add something and the panel opens its settings for you: here an effect, highlighted on the right.');
    await click($('[data-tab="effects"]'), { after: 300 });
    await fit();
    await hold(300);
    await click($('[data-effect="vignette"]'), { after: 1500 });
    await slide(props().locator('[data-effect-row="vignette"]').getByLabel('Vignette', { exact: true }), 95, { steps: 12 });
    await say('Prefer one long list? The last tab, All, shows every setting at once.');
    await tab('all', { after: 1500 });
    await tab('adjust', { after: 900 });
  },
  async canvas() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Click an empty part of the canvas so nothing is selected. The canvas settings appear on the right.');
    await clickDoc(60, 60);
    await say('Type a new width or height. Layers keep their position and size.');
    await type(page.getByLabel('Canvas width', { exact: true }), '1300');
    await fit();
    await hold(500);
    await say('Under Background, choose Clear, Solid, Linear or Radial and set the colours.');
    await click(button('Linear'), { after: 900 });
    await click(button('Radial'), { after: 1000 });
  },
  async navigate() {
    await setup();
    await picture('scene', CENTRE);
    await select();
    await say('View options (the sliders icon) has rulers, the grid and composition guides.');
    await click(button('View options'));
    await click(page.getByRole('switch', { name: 'Show rule of thirds' }));
    await click(page.getByRole('switch', { name: 'Show grid' }), { after: 800 });
    await press('Escape');
    await say('Zoom with Ctrl + mouse wheel, Ctrl + plus and minus, or the buttons in the top bar.');
    await press('Control+=');
    await press('Control+=');
    await say('Hold Space and drag to pan. Ctrl + 0 fits the canvas to the screen again.');
    const a = await toScreen(500, 350);
    await moveTo(a.x, a.y);
    await page.keyboard.down('Space');
    await hold(250);
    await dragScreen(a, { x: a.x - 170, y: a.y - 90 }, 900);
    await page.keyboard.up('Space');
    await press('Control+0', 900);
  },
  async projects() {
    await setup();
    await picture('scene', CENTRE);
    await select();
    await say('Designs save themselves. Click the name in the top bar to rename the project.');
    await type(page.getByLabel('Project name'), 'Summer poster');
    await page.waitForFunction(() => window.__prysm.ui.getState().saveStatus === 'saved', null, { timeout: 15000 });
    await point($('[data-testid="save-status"]'), 900);
    await say('Projects (top right) lists every design stored in this browser: open, duplicate or delete one, or start a new one.');
    await click(button(/Projects/), { after: 1800 });
    await press('Escape', 500);
  },
  async undo() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Make a change: here, the picture is moved.');
    await drag([500, 350], [330, 250]);
    await say('Ctrl + Z undoes it…');
    await press('Control+z', 1100);
    await say('…and Ctrl + Shift + Z redoes it. The two arrows next to the project name do the same.');
    await press('Control+Shift+z', 900);
    await click(button(/^Undo/), { after: 900 });
  },
  async layers() {
    await setup({ tab: 'elements' });
    await picture('scene', CENTRE);
    await $('[title="Circle"]').first().click();
    await $('[data-icon="star"]').click();
    const ls = await layers();
    await patch(ls[1].id, { x: 120, y: 90, width: 220, height: 220 });
    await patch(ls[2].id, { x: 690, y: 400, width: 200, height: 200 });
    await closeSidebar();
    await select();
    await hold(300);
    await say('Every image, text and shape is a row in the Layers panel. Click a row to select that layer.');
    await click($(`[data-layer-id="${ls[1].id}"]`));
    await click($(`[data-layer-id="${ls[0].id}"]`));
    await say('The eye hides a layer and shows it again.');
    const eye = $(`[data-layer-id="${ls[2].id}"]`).getByRole('button', { name: /Hide layer|Show layer/ });
    await click(eye, { after: 800 });
    await click(eye, { after: 700 });
    await say('Ctrl + [ and Ctrl + ] move the selected layer backward and forward; the icons at the top duplicate, group and delete.');
    await click($(`[data-layer-id="${ls[1].id}"]`), { after: 300 });
    await press('Control+[', 900);
    await press('Control+]', 900);
  },
  async arrange() {
    await setup({ tab: 'elements' });
    await $('[title="Rectangle"]').first().click();
    const [shape] = await layers();
    await patch(shape.id, { x: 140, y: 120, width: 300, height: 200 });
    await closeSidebar();
    await select(shape.id);
    await hold(300);
    await say('Drag a layer to move it.');
    await drag([290, 220], [520, 330]);
    await say('Drag a corner handle to resize it.');
    await drag([670, 430], [760, 490]);
    await say('For exact placement, open the Layout tab on the right. Arrange centres it on the canvas both ways.');
    await tab('layout');
    await click(button('Align horizontal centres'));
    await click(button('Align vertical centres'), { after: 1000 });
  },
  async blend() {
    await setup();
    await picture('scene', CENTRE);
    const top = await picture('subject', { x: 260, y: 120, width: 480, height: 360 });
    await select(top.id);
    await say('Select the upper of two images and open the Style tab. Lower Opacity to let the one below show through.');
    await tab('style');
    await slide(slider('Opacity'), 55);
    await slide(slider('Opacity'), 100);
    await say('Or choose a Blend mode to mix them: Multiply darkens the two together…');
    await choose(props().getByLabel('Blend mode', { exact: true }), 'multiply');
    await say('…Screen lightens them, and Overlay adds contrast.');
    await choose(props().getByLabel('Blend mode', { exact: true }), 'screen');
    await choose(props().getByLabel('Blend mode', { exact: true }), 'overlay');
    await say('From the keyboard: Alt + Shift + M is Multiply, Alt + Shift + S is Screen, Alt + Shift + N is Normal.');
    await press('Alt+Shift+M', 1100);
    await press('Alt+Shift+S', 1100);
    await press('Alt+Shift+N', 900);
  },
  async 'text-fold'() {
    await setup({ w: 1000, h: 800, tab: 'text' });
    await button('Add a heading').click();
    const [text] = await layers();
    await patch(text.id, { text: 'HELLO', fontFamily: 'Anton', fontWeight: 400, fontSize: 240, x: 100, y: 110, width: 800, align: 'center', fill: { type: 'solid', color: '#7a1218' } });
    await closeSidebar();
    await select(text.id);
    await hold(1200);
    await say('Select a text layer (bold, tall fonts work best), open the Effects tab and switch on Fold.');
    const effects = await section('Text effects');
    await click(effects.getByRole('switch', { name: 'Fold' }), { after: 1200 });
    await say('Drop sets how far the lower half comes down…');
    await slide(slider('Drop', effects), 75, { steps: 14 });
    await slide(slider('Drop', effects), 40, { steps: 10 });
    await say('…Spread how much larger it gets…');
    await slide(slider('Spread', effects), 70, { steps: 14 });
    await slide(slider('Spread', effects), 30, { steps: 10 });
    await say('…and Cut at where the word is sliced. Band tone lightens or darkens the strip in between.');
    await slide(slider('Cut at', effects), 30, { steps: 12 });
    await slide(slider('Cut at', effects), 55, { steps: 10 });
    await slide(slider('Band tone', effects), -40, { steps: 12 });
    await slide(slider('Band tone', effects), 45, { steps: 12 });
  },
  async fade() {
    await setup();
    await E(() => window.__prysm.selection.getState().set({ mode: 'new', lassoMode: 'freehand', feather: 0 }));
    await picture('scene', { x: 40, y: 140, width: 640, height: 420 });
    const top = await picture('subject', { x: 400, y: 140, width: 560, height: 420 });
    await select(top.id);
    await hold(600);
    await say('Two photos overlap. Select the upper one, open the Cut out tab and switch on Fade.');
    await tab('cutout');
    await click(props().getByRole('switch', { name: 'Fade', exact: true }), { after: 1100 });
    const fade = await section('Fade', props(), { quiet: true });
    const from = (label) => button(`Fade from ${label}`, fade);
    await say('The nine buttons choose where it fades from. With the left side, it melts into the photo underneath.');
    await click(from('the left'), { after: 700 });
    await click(from('the right'), { after: 1000 });
    await say('Sides and corners add up: press as many as you like, and press one again to remove it.');
    await click(from('the bottom right corner'), { after: 1300 });
    await click(from('the bottom right corner'), { after: 600 });
    await say('“Begins at” and “Reaches to” set where the fade begins and where it stops.');
    await slide(slider('Begins at', fade), 30, { steps: 10 });
    await slide(slider('Begins at', fade), 5, { steps: 8 });
    await slide(slider('Reaches to', fade), 45, { steps: 10 });
    await say('Strength sets how transparent it gets, from a light softening to nothing left.');
    await slide(slider('Strength', fade), 30, { steps: 10 });
    await slide(slider('Strength', fade), 100, { steps: 10 });
    await say('For a fade along your own shape, draw the shape with a selection tool, here the Lasso…');
    await click(page.getByRole('button', { name: /^Lasso \(/ }), { after: 500 });
    const loop = Array.from({ length: 26 }, (_, i) => [662 + Math.cos((i / 25) * Math.PI * 2) * 178, 352 + Math.sin((i / 25) * Math.PI * 2) * 168]);
    await stroke(loop, 1700);
    await say('…and press “Fade along selection” in the Select tab. The photo shows inside your shape and fades at its outline.');
    await click(button('Fade along selection', selectionPanel()), { after: 1400 });
    await slide(slider('Reaches to', fade), 30, { steps: 10 });
    await hold(700);
  },
  async 'fade-paint'() {
    await setup();
    await E(() => {
      const tools = window.__prysm.tools.getState();
      tools.setBrush({ size: 120, hardness: 0.1, opacity: 0.6, flow: 1, smoothing: 0.4 });
      tools.setEraser({ size: 80, hardness: 0.3, opacity: 1, flow: 1, smoothing: 0.4 });
    });
    await picture('scene', { x: 40, y: 140, width: 640, height: 420 });
    const top = await picture('subject', { x: 400, y: 140, width: 560, height: 420 });
    await select(top.id);
    await hold(600);
    await say('Select the upper photo, open the Cut out tab, then Fade, and press “Paint the fade”.');
    const fade = await section('Fade', props());
    await click(button('Paint the fade', fade), { after: 900 });
    await say('Now brush over the parts that should fade. The photo underneath shows through.');
    await stroke([[425, 170], [445, 300], [425, 430], [450, 540]], 1500);
    await stroke([[500, 180], [520, 330], [495, 520]], 1400);
    await say('A soft brush at a low Opacity builds the fade up a little with every stroke, like shading.');
    await stroke([[570, 170], [595, 250], [560, 200]], 1100);
    await stroke([[540, 520], [700, 545], [900, 525]], 1400);
    await stroke([[620, 540], [800, 550], [940, 500]], 1300);
    await say('Faded too much? Take the Eraser, or hold Alt, and paint the image back.');
    await click(page.getByRole('button', { name: /^Eraser \(/ }), { after: 500 });
    await stroke([[540, 300], [560, 380], [590, 440]], 1400);
    await say('Press “Done painting” when you are finished. Nothing was erased: it is a setting of the layer.');
    await click(button('Done painting', fade), { after: 1300 });
  },
  async 'light-effects'() {
    await setup({ w: 640, h: 700, tab: 'effects', background: { type: 'solid', color: '#0c0b0a' } });
    const photo = await picture('moth', { x: 40, y: 30, width: 560, height: 640 });
    await select(photo.id);
    await hold(600);
    await say('Select the image and open Effects. Bloom makes its light parts glow; the dark parts stay dark.');
    await click($('[data-effect="bloom"]'), { after: 1200 });
    await slide(props().locator('[data-effect-row="bloom"]').getByLabel('Bloom', { exact: true }), 75, { steps: 12 });
    await say('Light streaks pull that light out along one direction. The picture stays sharp underneath.');
    await click($('[data-effect="light-streaks"]'), { after: 1300 });
    const streaks = props().locator('[data-effect-row="light-streaks"]');
    await say('Direction turns the streaks, and the slider sets how far they reach.');
    await slide(streaks.getByLabel('Direction', { exact: true }), 110, { steps: 14 });
    await slide(streaks.getByLabel('Light streaks', { exact: true }), 85, { steps: 12 });
    await say('The Luminous look sets all of it in one click: black and white, Bloom, Light streaks and grain.');
    await click($('[data-look="luminous"]'), { after: 1700 });
  },
  async 'text-in-shape'() {
    await setup({ w: 1000, h: 700, tab: 'elements' });
    await $('[data-graphic="sticker/heart"]').click();
    const [heart] = await layers();
    await patch(heart.id, { x: 250, y: 110, width: 500, height: 460 });
    await E(() => window.__prysm.ui.getState().set({ sidebarTab: 'text' }));
    await hold(300);
    await button('Add a heading').click();
    const text = (await layers()).at(-1);
    await patch(text.id, { text: 'LOVE', fontFamily: 'Anton', fontWeight: 400, fontSize: 120, x: 330, y: 20, width: 340, align: 'center', fill: { type: 'solid', color: '#14121f' } });
    await closeSidebar();
    await select(text.id);
    await hold(900);
    await say('A picture and a word. Select the text, open the Effects tab and, in it, Warp.');
    const warp = await section('Warp');
    await say('Under “Shape of another layer”, choose the picture and press “Fit text to this shape”.');
    const fit = warp.locator('[data-testid="fit-to-shape"]');
    await point(fit.getByLabel('Layer to take the shape from'), 700);
    await click(button(/Fit text to this shape/, fit), { after: 1500 });
    await say('The word is stretched to fill the picture’s outline. Hide the picture to leave just the word.');
    const eye = $(`[data-layer-id="${heart.id}"]`).getByRole('button', { name: /Hide layer|Show layer/ });
    await click(eye, { after: 1500 });
    await say('It is still text: change its colour, font or words and it keeps the shape.');
    await select(text.id);
    await hold(300);
    await patch(text.id, { fill: { type: 'solid', color: '#d92545' } });
    await hold(1200);
    await patch(text.id, { text: 'HEART' });
    await hold(1800);
  },
  async clip() {
    await setup({ tab: 'text' });
    await button('Add a heading').click();
    const [text] = await layers();
    await patch(text.id, { text: 'SUMMER', fontSize: 190, fontWeight: 800, x: 60, y: 230, width: 880 });
    const photo = await picture('scene', { x: 60, y: 90, width: 880, height: 578 });
    await closeSidebar();
    await select(photo.id);
    await hold(300);
    await say('The text is underneath and the picture is directly above it. Select the picture and open the Style tab.');
    await tab('style');
    await point(props().getByRole('switch', { name: 'Clip to layer below' }), 700);
    await say('Switch on Clip: the picture now shows only inside the text.');
    await click(props().getByRole('switch', { name: 'Clip to layer below' }), { after: 1100 });
    await say('Both stay editable. Move the picture to choose which part shows.');
    await drag([500, 380], [440, 300]);
  },
  async upload() {
    await setup();
    await say('Open Uploads on the left.');
    await click($('[data-tab="uploads"]'));
    await say('Press “Upload images” and choose files, or drag files from your computer straight onto the canvas.');
    await point(button(/Upload images/), 900);
    await picture('scene', CENTRE);
    await E(() => window.__prysm.ui.getState().set({ sidebarTab: 'uploads' }));
    await hold(400);
    await fit();
    await say('The image lands on the canvas as a layer, and stays in Uploads to use again in any design.');
    await hold(1500);
  },
  async crop() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Select the image and press C (or “Crop on canvas” under Crop in the Layout tab).');
    await press('c', 900);
    const handle = async (id) => centre(await $(`[data-crop-handle="${id}"]`).boundingBox());
    await say('Drag the corners or sides of the frame. The part being trimmed is shown faintly.');
    let h = await handle('nw');
    await dragScreen(h, { x: h.x + 150, y: h.y + 120 });
    h = await handle('e');
    await dragScreen(h, { x: h.x - 60, y: h.y });
    await say('Drag inside the frame to slide it over the picture.');
    const frame = centre(await $('[data-testid="crop-frame"]').boundingBox());
    await dragScreen(frame, { x: frame.x - 70, y: frame.y - 40 });
    await say('Choose a shape to hold the frame to it: here, a square.');
    await choose($('[data-testid="crop-bar"]').getByLabel('Crop shape', { exact: true }), '1:1');
    await say('Press Enter or Done to keep it. Nothing is thrown away: crop again to bring the rest back.');
    await click(button('Done', $('[data-testid="crop-bar"]')), { after: 1100 });
  },
  async frame() {
    await setup({ background: { type: 'solid', color: '#e9e4d8' } });
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Select the image and open the Style tab. Frame rounds its corners.');
    const frame = await section('Frame');
    await slide(slider('Corners', frame), 70);
    await say('Border adds an outline.');
    await click(props().getByRole('switch', { name: 'Border' }), { after: 900 });
    await say('Drop shadow adds a shadow with its own colour, blur and offset.');
    await click(props().getByRole('switch', { name: 'Drop shadow' }), { after: 1300 });
  },
  async effects() {
    await setup({ tab: 'effects' });
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Select an image and open Effects. Looks are finished colour grades in one click.');
    await click($('[data-look]').nth(1), { after: 900 });
    await click($('[data-look]').nth(4), { after: 900 });
    await say('Below them is every single effect. Click one to add it.');
    await click($('[data-effect="halftone"]'), { after: 900 });
    await say('The panel on the right opens on the effect you added: its strength, and buttons to switch it off, reorder it or remove it.');
    await slide(props().locator('[data-effect-row="halftone"]').getByLabel('Halftone', { exact: true }), 30);
    await click(button('Turn off Halftone', props()), { after: 800 });
    await click(button('Turn on Halftone', props()), { after: 800 });
  },
  async 'blur-sharpen'() {
    await setup({ tab: 'effects' });
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Blur softens the whole image. Its slider opens on the right and sets how much.');
    await click($('[data-effect="blur"]'), { after: 700 });
    await slide(props().locator('[data-effect-row="blur"]').getByLabel('Blur', { exact: true }), 70);
    await click(button('Remove Blur', props()), { after: 500 });
    await say('Motion blur streaks it in one direction, set with Direction.');
    await click($('[data-effect="motion-blur"]'), { after: 700 });
    await slide(props().locator('[data-effect-row="motion-blur"]').getByLabel('Direction', { exact: true }), 60);
    await click(button('Remove Motion blur', props()), { after: 500 });
    await say('Sharpen brings out edges and fine detail instead.');
    await click($('[data-effect="sharpen"]'), { after: 700 });
    await slide(props().locator('[data-effect-row="sharpen"]').getByLabel('Sharpen', { exact: true }), 90);
  },
  async 'blur-background'() {
    await setup();
    const photo = await picture('subject', PHOTO);
    await select(photo.id);
    await say('Select a photo with one clear subject, open the Cut out tab and press “Blur background”.');
    await section('Mask');
    await click($('[data-testid="bg-blur"] button'), { after: 300 });
    await idle('removal');
    await hold(900);
    await say('The subject stays sharp on its own layer, and a blurred background layer is added underneath.');
    await point($('[data-layer-id]').nth(1), 900);
    await say('Select the background layer and move the Blur slider in its Effects tab to change how blurry it is.');
    await click($('[data-layer-id]').nth(1));
    const effects = await section('Effects');
    await slide(slider('Blur', effects), 100);
    await slide(slider('Blur', effects), 25);
    await slide(slider('Blur', effects), 60);
  },
  async duotone() {
    await setup({ tab: 'effects' });
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Select the image, open Effects and click Duotone.');
    await click($('[data-effect="duotone"]'), { after: 1000 });
    await say('Its settings open on the right. Of its two colours, the first replaces the dark tones and the second the light tones.');
    await type(props().getByLabel('Duotone colour 1 hex', { exact: true }), '#0b3d2e');
    await type(props().getByLabel('Duotone colour 2 hex', { exact: true }), '#ffe08a');
    await say('The slider blends between the original and the duotone.');
    await slide(props().locator('[data-effect-row="duotone"]').getByLabel('Duotone', { exact: true }), 45);
    await slide(props().locator('[data-effect-row="duotone"]').getByLabel('Duotone', { exact: true }), 100);
  },
  async vignette() {
    await setup({ tab: 'effects' });
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Select the image, open Effects and click Vignette. The edges darken.');
    await click($('[data-effect="vignette"]'), { after: 800 });
    await slide(props().locator('[data-effect-row="vignette"]').getByLabel('Vignette', { exact: true }), 95);
    await say('Its colour decides the direction. Change it to white and the edges lighten instead.');
    await type(props().getByLabel('Vignette colour 1 hex', { exact: true }), '#ffffff');
    await hold(900);
  },
  async adjust() {
    await setup();
    const photo = await picture('scene', CENTRE, { flat: true });
    await select(photo.id);
    const adjust = await section('Adjustments', props(), { quiet: true });
    await say('This photo is dull and flat. Select it: the Adjust tab on the right has Adjustments at the top.');
    await say('Contrast separates lights from darks.');
    await slide(slider('Contrast', adjust), 60);
    await say('Saturation makes the colours stronger.');
    await slide(slider('Saturation', adjust), 45);
    await say('Brightness and Exposure make it lighter or darker. The original image is never changed.');
    await slide(slider('Exposure', adjust), 14);
    await slide(slider('Brightness', adjust), 8);
  },
  async hue() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    const adjust = await section('Adjustments', props(), { quiet: true });
    await say('Temperature moves the whole picture warmer…');
    await slide(slider('Temperature', adjust), 80);
    await say('…or cooler.');
    await slide(slider('Temperature', adjust), -70);
    await slide(slider('Temperature', adjust), 0);
    await say('Hue rotates every colour around the colour wheel.');
    await slide(slider('Hue', adjust), 150, { steps: 16 });
    await slide(slider('Hue', adjust), 0, { steps: 10 });
  },
  async levels() {
    await setup();
    const photo = await picture('scene', CENTRE, { flat: true });
    await select(photo.id);
    await say('In the Adjust tab, open Levels. The graph shows the picture’s tones, dark on the left.');
    const levels = await section('Levels');
    await point(levels.locator('[data-testid="levels-histogram"]'), 1100);
    await say('This graph stops short of both ends, so the picture looks flat. Move Black point up to where it starts…');
    await slide(slider('Black point', levels), 70);
    await say('…and White point down to where it ends. (Auto does both.)');
    await slide(slider('White point', levels), 178);
    await say('Midtones lightens or darkens the middle without moving black or white.');
    await slide(slider('Midtones', levels), 1.3);
  },
  async curves() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('In the Adjust tab, open Curves. Left to right is dark to light; the line says how bright each tone becomes.');
    const curves = await section('Curves');
    const editor = curves.locator('[data-testid="curves-editor"]');
    await editor.scrollIntoViewIfNeeded();
    const at = async (x, y) => {
      const box = await editor.boundingBox();
      return { x: box.x + (x / 255) * box.width, y: box.y + (1 - y / 255) * box.height };
    };
    await say('Press on the line to add a point and drag it down to darken those tones…');
    await dragScreen(await at(70, 70), await at(74, 36));
    await say('…and another, dragged up, to lighten the bright tones. This S shape adds contrast.');
    await dragScreen(await at(185, 185), await at(182, 222));
    await say('Switch to Red, Green or Blue to change one colour channel.');
    await click(button('Blue', curves), { after: 500 });
    await dragScreen(await at(128, 128), await at(128, 175));
  },
  async 'remove-background'() {
    await setup({ background: { type: 'solid', color: '#8fd3b0' } });
    const photo = await picture('subject', PHOTO);
    await select(photo.id);
    const dialog = $('[data-testid="removal-dialog"]');
    const ready = () => page.waitForSelector('[data-testid="removal-dialog"]:not([data-state="working"])', { timeout: 240000 });
    const objects = () => page.waitForSelector('[data-testid="removal-dialog"][data-objects="ready"]', { timeout: 240000 });
    /** A point of the 640 x 480 photo, as a place on the screen inside the dialog. */
    const inPicture = async (x, y) => {
      const box = await E(() => window.__prysm.removalStage());
      return { x: box.x + (x / 640) * box.width, y: box.y + (y / 480) * box.height };
    };
    /** Points at a thing in the dialog's picture until it lights up, then clicks it. */
    const clickThing = async (x, y) => {
      const p = await inPicture(x, y);
      await moveTo(p.x - 30, p.y - 20);
      await moveTo(p.x, p.y, 300);
      await $('[data-testid="removal-hint"]').waitFor({ timeout: 15000 });
      await hold(1100);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForFunction(() => !window.__prysm.removal.getState().busy);
      await hold(900);
    };
    // Before the part that is shown: the models are downloaded and this picture is analysed once,
    // so the recording shows the dialog at the speed it has from the second use on.
    await section('Mask', props(), { quiet: true });
    await $('[data-testid="bg-removal"] button').click();
    await ready();
    await objects();
    await button('Cancel', dialog).click();
    await dialog.waitFor({ state: 'detached' });
    await hold(400);

    await say('Select the photo, open the Cut out tab and press “Remove background”.');
    await click($('[data-testid="bg-removal"] button'), { after: 300 });
    await ready();
    await objects();
    await hold(600);
    await say('The subject is already selected: tinted green and outlined. Green is what will be kept.');
    await hold(1700);
    await say('To choose things yourself, press Clear and click them. A click selects a whole thing and leaves a point.');
    await click(button('Clear', dialog), { after: 500 });
    await clickThing(415, 125);
    await clickThing(300, 290);
    await say('“Take away” and a click take a thing out of the selection again.');
    await click(button('Take away', dialog), { after: 300 });
    await clickThing(415, 125);
    await say('“Result” shows what you will get: the selection is kept…');
    await click(button('Result', dialog), { after: 1300 });
    await say('…or, with “Removed”, the selection is what goes.');
    await click(button('Removed', dialog), { after: 1500 });
    await click(button('Kept', dialog), { after: 900 });
    await say('Press “Apply”. The photo itself is untouched: the background is hidden by a mask.');
    await click(button('Apply', dialog), { after: 400 });
    await dialog.waitFor({ state: 'detached' });
    await hold(1400);
    await say('“Edit background removal” opens the dialog again on the cut-out as you left it.');
    await point($('[data-testid="bg-removal"] button'), 1300);
  },
  async 'replace-background'() {
    await setup({ background: null, tab: 'backgrounds' });
    const photo = await picture('subject', PHOTO);
    await select(photo.id);
    await section('Mask', props(), { quiet: true });
    // Background removal goes through its dialog: the suggestion is applied as it is.
    await $('[data-testid="bg-removal"] button').click();
    await page.waitForSelector('[data-testid="removal-dialog"]:not([data-state="working"])', { timeout: 240000 });
    await button('Apply', $('[data-testid="removal-dialog"]')).click();
    await $('[data-testid="removal-dialog"]').waitFor({ state: 'detached' });
    await select();
    await hold(500);
    await say('With the background removed, open Backgrounds and pick a colour…');
    await click(page.getByRole('button', { name: /^Background #/ }).nth(3), { after: 900 });
    await say('…or a gradient.');
    await click(page.getByRole('button', { name: / gradient$/ }).nth(1), { after: 900 });
    await click(page.getByRole('button', { name: / gradient$/ }).nth(4), { after: 1000 });
    await say('For a picture instead, add it from Uploads and drag its row below the cut-out in Layers.');
    await hold(1400);
  },
  async mask() {
    await setup({ background: { type: 'solid', color: '#f1ead9' } });
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Select the image, open the Cut out tab and press “Add layer mask”.');
    const mask = await section('Mask');
    await click(button(/Add layer mask/, mask));
    await say('Press “Paint mask” and paint: black hides the image there.');
    await click(button(/Paint mask/, props()));
    await E(() => window.__prysm.tools.getState().setBrush({ size: 150, hardness: 0.2 }));
    await stroke([[220, 190], [420, 170], [620, 200], [790, 180]]);
    await stroke([[230, 300], [250, 420], [300, 530]]);
    await say('Press X to switch to white, which reveals it again. Nothing is ever erased.');
    await press('x');
    await stroke([[430, 180], [600, 200]]);
  },
  async eraser() {
    await setup({ background: { type: 'solid', color: '#f1ead9' } });
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Select an image and press E for the Eraser.');
    await press('e');
    await E(() => window.__prysm.tools.getState().setEraser({ size: 120, hardness: 0.6 }));
    await say('Drag over what should go.');
    await stroke([[250, 220], [400, 250], [560, 230], [770, 200]]);
    await say('It works through a mask, so it can be undone. Switch the bar to Restore and drag to bring it back.');
    await click(button('Restore', $('[data-testid="tool-options"]')));
    await stroke([[250, 220], [400, 250], [520, 235]]);
  },
  async paint() {
    await setup();
    await say('Press B for the Brush and draw. The first stroke creates a paint layer.');
    await press('b');
    await E(() => {
      window.__prysm.tools.getState().setBrush({ size: 40, hardness: 0.9 });
      window.__prysm.tools.getState().set({ color: '#e4572e' });
    });
    await stroke([[200, 430], [300, 250], [400, 220], [470, 330], [560, 460], [680, 380], [800, 240]], 1800);
    await say('Size, Hardness, Opacity and the colour are in the bar above the canvas.');
    await type($('[data-testid="tool-options"]').getByLabel('Size', { exact: true }), '90');
    await type($('[data-testid="tool-options"]').getByLabel('Brush colour hex', { exact: true }), '#2a6fdb');
    await stroke([[220, 560], [420, 520], [620, 580], [800, 520]], 1400);
  },
  async select() {
    await setup();
    await picture('scene', CENTRE);
    await select();
    await say('Press M for the Marquee and drag a rectangle. The moving outline shows what is selected.');
    await press('m');
    await drag([280, 190], [520, 400]);
    await say('Hold Shift to add to the selection…');
    await page.keyboard.down('Shift');
    await drag([470, 330], [720, 520]);
    await page.keyboard.up('Shift');
    await say('…and Alt to take away from it.');
    await page.keyboard.down('Alt');
    await drag([340, 250], [460, 350]);
    await page.keyboard.up('Alt');
    await say('The Magic wand (W) selects an area of one colour with a click: here, the sky.');
    await press('w');
    await E(() => window.__prysm.selection.getState().set({ tolerance: 70 }));
    await clickDoc(640, 190);
    await say('Ctrl + D deselects.');
    await press('Control+d', 900);
  },
  async 'select-subject'() {
    await setup();
    const photo = await picture('subject', PHOTO);
    await select(photo.id);
    await say('Select the photo and pick a selection tool, such as the Marquee (M).');
    await press('m');
    await say('The Select tab opens on the right. Press “Select subject”.');
    await click(button(/Select subject/, selectionPanel()), { after: 300 });
    await page.waitForFunction(() => window.__prysm.selection.getState().busy === null && !!window.__prysm.selection.getState().mask, null, { timeout: 180000 });
    await hold(1100);
    await say('The main subject is selected. Expand, Contract and Feather tidy the edge.');
    const adjust = await section('Adjust', selectionPanel(), { quiet: true });
    await click(button('Expand', adjust), { after: 900 });
    await click(button('Feather', adjust), { after: 1000 });
  },
  async 'use-selection'() {
    await setup({ background: { type: 'solid', color: '#f1ead9' } });
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await press('m', 200);
    await E(() => window.__prysm.selection.getState().set({ marqueeShape: 'ellipse' }));
    await say('Select an area, with one image layer chosen. The Select tab on the right shows what can be done with it.');
    await drag([360, 180], [640, 400]);
    await say('“Copy to layer” lifts the selected part onto a layer of its own.');
    const use = await section('Use on layer', selectionPanel(), { quiet: true });
    await click(button('Copy to layer', use), { after: 900 });
    await press('Control+z', 700);
    await say('“Mask to selection” keeps only the selected part of the layer. “Hide area” does the opposite.');
    await select(photo.id);
    await hold(300);
    await click(button('Mask to selection', await section('Use on layer', selectionPanel(), { quiet: true })), { after: 1300 });
  },
  async 'saved-selections'() {
    await setup();
    await picture('scene', CENTRE);
    await press('m', 200);
    await say('Select an area, then press “Save selection”.');
    await drag([300, 200], [620, 420]);
    const saved = await section('Saved selections', selectionPanel(), { quiet: true });
    await click(button('Save selection', saved), { after: 900 });
    await say('It is kept with the project. Deselect…');
    await press('Control+d', 900);
    await say('…and press Load to get it back, even after closing and reopening the project.');
    await click(button('Load', selectionPanel()), { after: 1300 });
  },
  async 'magic-eraser'() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Press L for the Lasso and draw around the unwanted thing, with a little margin and including its shadow.');
    await press('l');
    const loop = Array.from({ length: 22 }, (_, i) => [BALL[0] + Math.cos((i / 21) * Math.PI * 2) * 78, BALL[1] + 8 + Math.sin((i / 21) * Math.PI * 2) * 62]);
    await stroke(loop, 1900);
    await say('Press “Content-aware fill” in the Select tab on the right.');
    const fill = await section('Fill and remove', selectionPanel(), { quiet: true });
    await click(button('Content-aware fill', fill), { after: 300 });
    await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 2, null, { timeout: 120000 });
    await idle('local');
    await hold(900);
    await say('The ball is gone, filled in from the grass around it. It runs on your computer, with no AI service.');
    await press('Control+d', 900);
    await say('The fill is a new layer, so the photo underneath is untouched. Hide it and the ball is back.');
    const eye = $('[data-layer-id]').first().getByRole('button', { name: /Hide layer|Show layer/ });
    await click(eye, { after: 1000 });
    await click(eye, { after: 900 });
  },
  async expand() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('This photo does not fill the canvas. Select it, open the Layout tab and, in it, Expand.');
    const expand = await section('Expand');
    await say('Press “Fill the canvas”.');
    await click(button('Fill the canvas', expand), { after: 300 });
    await page.waitForFunction((src) => JSON.stringify(window.__prysm.editor.getState().doc.layers[0].source) !== src, JSON.stringify(photo.source), { timeout: 180000 });
    await idle('local');
    await select();
    await hold(700);
    await say('The picture now covers the canvas. The new area was built from the picture itself, on your computer.');
    await hold(1800);
  },
  async upscale() {
    await setup();
    const small = await picture('scene', { x: 230, y: 173, width: 540, height: 354 }, { small: true });
    await select(small.id);
    await say('A small picture shown large looks soft. Select it, open the Layout tab and, in it, Upscale.');
    const upscale = await section('Upscale');
    await page.waitForFunction(() => /Now \d+ × \d+ px/.test(document.querySelector('[data-testid="upscale-size"]')?.textContent ?? ''));
    await say('Press 2× or 4×. It runs on your computer and shows its progress.');
    await click(button(/^4× to/, upscale), { after: 300 });
    await page.waitForFunction((id) => window.__prysm.editor.getState().doc.layers[0].source.assetId !== id, small.source.assetId, { timeout: 240000 });
    await idle('local');
    await hold(900);
    await say('The picture is rebuilt at four times the size: edges and texture are sharper. Undo and redo to compare.');
    await press('Control+z', 1300);
    await press('Control+Shift+z', 1300);
  },
  async text() {
    await setup();
    await say('Open Text on the left and click a heading, a subheading or body text.');
    await click($('[data-tab="text"]'));
    await click(button('Add a heading'), { after: 800 });
    await fit();
    const [text] = await layers();
    await say('Double-click the text on the canvas to type.');
    const at = await toScreen(text.x + text.width / 2, text.y + text.height / 2);
    await moveTo(at.x, at.y);
    await page.mouse.dblclick(at.x, at.y);
    await hold(500);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Hello there', { delay: 70 });
    await clickDoc(60, 60);
    await select(text.id);
    await hold(300);
    await say('With the text selected, the Text tab on the right sets the font, size, weight, alignment and spacing.');
    await point(await section('Typography', props(), { quiet: true }), 1500);
  },
  async 'text-style'() {
    await setup({ tab: 'text', background: { type: 'solid', color: '#14121f' } });
    await button('Add a heading').click();
    const [text] = await layers();
    await patch(text.id, { text: 'OPEN LATE', fontSize: 150, fontWeight: 800, x: 60, y: 250, width: 880, fill: { type: 'solid', color: '#ffffff' } });
    await select(text.id);
    await say('Select the text. Effect styles in the Text tab apply a finished look in one click.');
    const styles = $('[data-text-style]');
    await click(styles.nth(0), { after: 1100 });
    await select(text.id);
    await click(styles.nth(1), { after: 1100 });
    await select(text.id);
    await click(styles.nth(3), { after: 1100 });
    await select(text.id);
    await say('The Effects tab on the right has the individual switches: Background, Glow, 3D depth, Metallic shine, Distress.');
    const effects = await section('Text effects');
    await click(effects.getByRole('switch', { name: 'Glow' }), { after: 1100 });
  },
  async 'text-shape'() {
    await setup({ tab: 'text' });
    await button('Add a heading').click();
    const [text] = await layers();
    await patch(text.id, { text: 'ROUND THE BEND', fontSize: 96, fontWeight: 800, x: 100, y: 290, width: 800 });
    await closeSidebar();
    await select(text.id);
    await say('Select the text, open Warp in the Effects tab and choose a shape.');
    const warp = await section('Warp');
    await choose(warp.getByLabel('Warp shape', { exact: true }), 'arc');
    await say('Bend sets how strongly it curves.');
    await slide(slider('Bend', warp), -60, { steps: 14 });
    await slide(slider('Bend', warp), 70, { steps: 14 });
    await say('Other shapes: Flag, Bulge, Rise, Squeeze…');
    await choose(warp.getByLabel('Warp shape', { exact: true }), 'flag');
    await choose(warp.getByLabel('Warp shape', { exact: true }), 'bulge');
  },
  async fonts() {
    await setup({ tab: 'text' });
    await button('Add a heading').click();
    const [text] = await layers();
    await closeSidebar();
    await select(text.id);
    await section('Typography', props(), { quiet: true });
    await say('Select a text layer and open the font list at the top of the Text tab.');
    await click(props().getByLabel('Font family'), { after: 900 });
    await say('Choose from the built-in fonts by group…');
    const menu = $('[data-testid="font-menu"]');
    await click(button('Display', menu), { after: 700 });
    await click(button('Handwriting', menu), { after: 700 });
    await say('…or upload your own TTF, OTF, WOFF or WOFF2 file at the bottom of the list.');
    await point(menu.getByRole('button').last(), 1300);
    await press('Escape', 400);
  },
  async elements() {
    await setup();
    await say('Open Elements: shapes, icons, stickers, frames and illustrations.');
    await click($('[data-tab="elements"]'));
    await say('Click anything to add it to the canvas.');
    await click($('[title="Circle"]').first(), { after: 700 });
    await click($('[data-icon="star"]'), { after: 700 });
    await fit();
    const ls = await layers();
    await say('Drag it into place. With it selected, its colours and outline are in the Shape tab on the right.');
    const star = ls[1];
    await drag([star.x + star.width / 2, star.y + star.height / 2], [760, 220]);
    await type(props().getByLabel('Icon colour hex', { exact: true }), '#e4572e');
    await say('Point at a tile and click its star to keep it under Favourites.');
    await point($('[data-icon="heart"]'), 600);
    const star2 = $('[data-favourite]').first();
    if (await star2.boundingBox({ timeout: 1500 }).catch(() => null)) await click(star2, { after: 900 });
    else await hold(900);
  },
  async textures() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await say('Open Textures (or Overlays) and click one.');
    await click($('[data-tab="textures"]'));
    await fit();
    await click($('[data-generator]').nth(2), { after: 1200 });
    await say('It is added as its own layer over the design, so it can be changed or removed at any time.');
    await point($('[data-layer-id]').first(), 900);
    await say('The Style tab opens on the right. Lower its Opacity for a subtler effect, or change its blend mode.');
    await slide(slider('Opacity'), 45);
    await slide(slider('Opacity'), 85);
  },
  async backgrounds() {
    await setup();
    await say('Open Backgrounds.');
    await click($('[data-tab="backgrounds"]'));
    await fit();
    await say('Click a solid colour or a gradient to set the canvas background…');
    await click(page.getByRole('button', { name: /^Background #/ }).nth(5), { after: 800 });
    await click(page.getByRole('button', { name: / gradient$/ }).nth(2), { after: 900 });
    await say('…or a generated background, which is added as a layer at the bottom with its own colours.');
    await click($('[data-generator]').nth(1), { after: 1400 });
  },
  async templates() {
    await setup();
    await say('Open Templates and click one.');
    await click($('[data-tab="templates"]'));
    await click($('[data-template="gig-poster"]'), { after: 1600 });
    await say('The whole layout arrives as ordinary layers.');
    await point($('[data-testid="layers-panel"]'), 1100);
    await say('Select anything to move, restyle or delete it; double-click any text to change the words.');
    const ls = await layers();
    const text = ls.filter((l) => l.type === 'text').at(-1);
    await clickDoc(text.x + text.width / 2, text.y + text.height / 2);
    await hold(900);
  },
  async 'generative-fill'() {
    await setup();
    const photo = await picture('scene', CENTRE);
    await select(photo.id);
    await press('m', 200);
    await say('Select the area to change.');
    await drag([300, 170], [560, 300]);
    await say('Generative fill and Remove object are under AI in the Select tab. They need the Prysm AI server, and say so until it is set up.');
    const ai = await section('AI', selectionPanel(), { quiet: true });
    await point(ai, 1400);
    await say('“How to set it up” opens the AI tools tab, which has the two steps.');
    await click($('[data-testid="ai-setup-link"]'), { after: 600 });
    await $('[data-testid="ai-generative"]').scrollIntoViewIfNeeded();
    await point($('[data-testid="ai-service-status"]'), 1600);
  },
  async 'generate-image'() {
    await setup();
    await say('Open the AI tools tab.');
    await click($('[data-tab="ai"]'));
    await $('[data-testid="ai-generative"]').scrollIntoViewIfNeeded();
    await say('It shows whether the AI server is connected and, if not, the two steps to set it up.');
    await point($('[data-testid="ai-service-status"]'), 1500);
    await say('Once connected, describe a picture here, choose its shape and press “Generate image”.');
    await point($('[data-testid="ai-generative"]').getByLabel('Image description'), 1500);
  },
  async export() {
    await setup();
    await picture('scene', { x: 0, y: 0, width: 1000, height: 656 });
    await select();
    await say('Press Export (top right).');
    await click(button(/Export/), { after: 800 });
    const dialog = $('[data-testid="export-dialog"]');
    await say('Choose the format: PNG for graphics and transparency, JPG for photos, WebP for the web, PDF for print.');
    await click(button('JPG', dialog), { after: 600 });
    await click(button('PNG', dialog), { after: 600 });
    await say('Choose the size, then press the Export button. The file downloads.');
    await click(button('2×', dialog), { after: 700 });
    await point(button(/^Export (PNG|JPG)/, dialog), 1300);
    await press('Escape', 400);
  },
  async shortcuts() {
    await setup();
    await picture('scene', CENTRE);
    await select();
    await say('Each tool along the top has a key. H is the Hand…');
    await press('h', 800);
    await say('…B the Brush, E the Eraser…');
    await press('b', 800);
    await press('e', 800);
    await say('…M the Marquee, L the Lasso, W the Magic wand…');
    await press('m', 800);
    await press('l', 800);
    await press('w', 800);
    await say('…and V returns to the Move tool. F1 opens the guide.');
    await press('v', 1000);
  },
};

// ---------- record ----------

const results = {};
const failed = [];
for (const topic of GUIDE) {
  if (only.length && !only.includes(topic.id)) continue;
  const demo = DEMOS[topic.id];
  if (!demo) {
    failed.push(`${topic.id}: no demonstration written`);
    continue;
  }
  const context = await browser.newContext({ viewport: VIEW, recordVideo: { dir: TMP, size: VIDEO } });
  await context.addInitScript(POINTER);
  page = await context.newPage();
  t0 = Date.now();
  marks = [];
  startAt = null;
  mouse = { x: 680, y: 420 };
  let error = null;
  let endAt = 0;
  try {
    await page.goto(`${BASE}/#/editor`);
    await page.waitForSelector('[data-testid="canvas-host"] canvas');
    await page.mouse.move(mouse.x, mouse.y);
    await demo();
    await hold(1500);
    endAt = now();
  } catch (err) {
    error = String(err.message).split('\n')[0];
  }
  const video = page.video();
  await context.close();
  if (error || !marks.length) {
    failed.push(`${topic.id}: ${error ?? 'no captions'}`);
    console.log(`FAIL  ${topic.id}: ${error ?? 'no captions'}`);
    continue;
  }
  if (dry) {
    console.log(`ok    ${topic.id}  ${(endAt - startAt).toFixed(1)} s, ${marks.length} captions (dry run, not kept)`);
    continue;
  }
  const file = `${topic.id}.webm`;
  rmSync(join(OUT, file), { force: true });
  const raw = await video.path();
  if (ffmpeg) {
    // Keep only the demonstration itself (not the stage being set before it) and compress it:
    // the recorder writes about 2 MB per clip, this brings it to a few hundred KB.
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', startAt.toFixed(2), '-t', (endAt - startAt).toFixed(2), '-i', raw, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '37', '-deadline', 'good', '-cpu-used', '3', '-row-mt', '1', '-an', join(OUT, file)]);
    results[topic.id] = { file, start: 0, end: +(endAt - startAt).toFixed(2), steps: marks.map((m) => ({ at: +Math.max(0, m.at - startAt).toFixed(2), caption: m.caption })) };
  } else {
    renameSync(raw, join(OUT, file));
    results[topic.id] = { file, start: +startAt.toFixed(2), end: +endAt.toFixed(2), steps: marks };
  }
  startAt = results[topic.id].start;
  endAt = results[topic.id].end;
  console.log(`ok    ${topic.id}  ${(endAt - startAt).toFixed(1)} s, ${marks.length} captions, ${Math.round(statSync(join(OUT, file)).size / 1024)} KB`);
}
await browser.close();
rmSync(TMP, { recursive: true, force: true });

if (dry) {
  if (failed.length) console.log(['Would not record:', ...failed].join('\n  '));
  process.exit(failed.length ? 1 : 0);
}

// Keep the entries of topics that were not recorded in this run.
let existing = {};
if (only.length) {
  try {
    existing = (await import(`${pathToFileURL(join(ROOT, 'src/features/guide/demos.ts')).href}?t=${Date.now()}`)).DEMOS;
  } catch {
    // First run.
  }
}
const all = { ...existing, ...results };
const ordered = Object.fromEntries(GUIDE.filter((t) => all[t.id]?.file?.endsWith('.webm')).map((t) => [t.id, all[t.id]]));
writeFileSync(
  join(ROOT, 'src/features/guide/demos.ts'),
  `/**
 * Demonstrations for the guide: a short video of the editor doing each task.
 * GENERATED by scripts/build-guide-demos.mjs (npm run guide:demos), which drives the real editor
 * and records it into public/guide/. Do not edit by hand; run the script again instead.
 */
export interface Demo {
  /** File name under /guide/. */
  file: string;
  /** The part of the recording to play, in seconds (what comes before is the stage being set). */
  start: number;
  end: number;
  /** What the caption says from each moment on. */
  steps: { at: number; caption: string }[];
}

export const DEMOS: Record<string, Demo> = ${JSON.stringify(ordered, null, 2)};
`,
);
const size = Object.values(ordered).reduce((sum, d) => sum + statSync(join(OUT, d.file)).size, 0);
console.log(`\n${Object.keys(ordered).length} of ${GUIDE.length} topics have a demonstration; ${(size / 1048576).toFixed(1)} MB of video.`);
if (failed.length) {
  console.log(`Not recorded:\n  ${failed.join('\n  ')}`);
  process.exitCode = 1;
}
