/**
 * AI server and the tools that use it: generative fill, object removal, image generation.
 *
 * No real provider is called. The Prysm server (server/index.mjs) is started here with a made-up
 * key and pointed at a local stand-in that speaks the provider's protocol and records what it is
 * sent. That proves everything on our side of the wire: the editor never receives the key, the
 * request carries the right picture, mask and prompt, and the answer becomes an editable layer.
 * What it cannot prove is how the real model behaves; that needs a real key.
 *
 * Needs port 8787 free (stop "npm run server" first) and the dev server running.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, toScreen, waitForSaved } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = 'http://127.0.0.1:8787';
const STUB_PORT = 8899;
const KEY = 'sk-test-prysm-secret-0123456789';
const MODEL = 'test-image-model';
const MAGENTA = [255, 0, 255];

// ---------- a stand-in for the provider ----------

function solidPng(width, height, [r, g, b]) {
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x++) row.set([r, g, b, 255], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngSize = (dataUrl) => {
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

const received = [];
let stubMode = 'ok';
const stub = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      // Recorded as null.
    }
    received.push({ path: req.url, method: req.method, authorization: req.headers.authorization ?? null, contentType: req.headers['content-type'] ?? null, body });
    const json = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (stubMode === 'unauthorized') return json(401, { error: { message: `Incorrect API key provided: ${KEY.slice(0, 12)}***`, type: 'invalid_request_error', code: 'invalid_api_key' } });
    if (stubMode === 'moderation') return json(400, { error: { type: 'image_generation_user_error', code: 'moderation_blocked' } });
    const [w, h] = String(body?.size ?? '1024x1024').split('x').map(Number);
    return json(200, { created: 0, data: [{ b64_json: solidPng(w, h, MAGENTA).toString('base64') }] });
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, '127.0.0.1', resolve));

// ---------- the Prysm server ----------

let child = null;
async function serverAnswers() {
  try {
    return (await fetch(`${SERVER}/api/ai/status`)).ok;
  } catch {
    return false;
  }
}
async function startServer(env) {
  child = spawn(process.execPath, ['server/index.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '8787', OPENAI_API_KEY: '', OPENAI_BASE_URL: `http://127.0.0.1:${STUB_PORT}`, OPENAI_IMAGE_MODEL: MODEL, ...env }, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await serverAnswers()); i++) await new Promise((r) => setTimeout(r, 100));
}
async function stopServer() {
  if (!child) return;
  const done = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await done;
  child = null;
  for (let i = 0; i < 40 && (await serverAnswers()); i++) await new Promise((r) => setTimeout(r, 100));
}
const post = async (path, body, headers = {}) => {
  const response = await fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
};

if (await serverAnswers()) {
  console.log('FAIL  port 8787 is already in use: stop the running Prysm server ("npm run server") before this suite.');
  stub.close();
  process.exit(1);
}

// ---------- the editor ----------

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const apiBodies = [];
page.on('response', async (response) => {
  if (!response.url().includes('/api/')) return;
  apiBodies.push(await response.text().catch(() => ''));
});

const panel = page.locator('[data-testid="selection-panel"]');
const aiBox = page.locator('[data-testid="ai-selection"]');
const aiCard = page.locator('[data-testid="ai-generative"]');
const availability = () => page.evaluate(() => window.__prysm.ai.getState().availability);
const toast = () => page.evaluate(() => window.__prysm.ui.getState().toast?.text ?? '');
const idle = () => page.waitForFunction(() => window.__prysm.ai.getState().job === null, null, { timeout: 30000 });
const alphaAt = async (points) => (await h.exportPng(points, { transparent: true })).pixels;
const decodeAt = (dataUrl, points) => h.decode(Buffer.from(dataUrl.split(',')[1], 'base64'), 'image/png', points);
async function dragDoc(from, to) {
  await h.drag(await toScreen(page, from[0], from[1]), await toScreen(page, to[0], to[1]));
}
async function recheck() {
  await h.openTab('ai');
  const button = aiCard.getByRole('button', { name: 'Check again' });
  if (await button.count()) await button.click();
  else await page.evaluate(() => window.__prysm.ai.getState().set({ availability: 'checking' }));
  await h.settle(500);
}

let A;

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 200, 300);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(200, 0, 200, 300);
    return c.toDataURL('image/png');
  });
  await h.openTab('uploads');
  await page.locator('[data-testid="upload-input"]').setInputFiles({ name: 'halves.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') });
  await page.waitForFunction(() => window.__prysm.editor.getState().doc.layers.length === 1);
  [A] = await h.layers();
  await h.patch(A.id, { x: 200, y: 150 });
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  await page.keyboard.press('m');
  await dragDoc([300, 200], [500, 400]);
  t.check('an image and a selection to work on', A.width === 400 && (await panel.isVisible()));
});

await section('Without the AI server', async () => {
  await h.settle(400);
  t.check('the editor reports the AI server as not running', (await availability()) === 'offline' && (await aiBox.getAttribute('data-availability')) === 'offline');
  t.check('generative fill and object removal are disabled, not simulated', (await aiBox.getByRole('button', { name: 'Generative fill' }).isDisabled()) && (await aiBox.getByRole('button', { name: 'Remove object' }).isDisabled()) && (await aiBox.getByLabel('Describe the fill').isDisabled()));
  t.check('the panel says why', /not running/.test(await aiBox.innerText()));
  await aiBox.locator('[data-testid="ai-setup-link"]').click();
  t.check('the setup link opens the AI tab with instructions', (await aiCard.isVisible()) && /npm run server/.test(await aiCard.innerText()) && /\.env/.test(await aiCard.innerText()));
  t.check('image generation is disabled too', (await aiCard.getByRole('button', { name: 'Generate image' }).isDisabled()) && (await aiCard.getByLabel('Image description').isDisabled()));
  t.check('a missing server causes no errors in the page', errors.length === 0, errors.slice(0, 3).join(' | '));
});

await section('Server without a provider key', async () => {
  await startServer({});
  const status = await (await fetch(`${SERVER}/api/ai/status`)).json();
  t.check('the status says no key is configured', status.ok === true && status.configured === false, JSON.stringify(status));
  const refused = await post('/api/ai/generate', { prompt: 'a cat', size: '1024x1024' });
  t.check('requests are refused with an explanation', refused.status === 503 && /key/i.test(refused.body?.error ?? ''), `${refused.status} ${refused.body?.error}`);
  t.check('nothing was sent to the provider', received.length === 0);
  await recheck();
  t.check('the editor shows the server as running but not configured', (await availability()) === 'unconfigured' && /no provider key/.test(await aiCard.innerText()));
  t.check('the tools stay disabled', await aiBox.getByRole('button', { name: 'Remove object' }).isDisabled());
  await stopServer();
});

await section('Server with a key', async () => {
  await startServer({ OPENAI_API_KEY: KEY });
  const response = await fetch(`${SERVER}/api/ai/status`);
  const text = await response.text();
  const status = JSON.parse(text);
  t.check('the status reports the provider and model', status.configured === true && status.provider === 'openai' && status.model === MODEL && status.sizes.length === 3, text);
  t.check('the status does not contain the key', !text.includes(KEY) && !text.includes(KEY.slice(0, 10)) && !Object.keys(status).some((k) => /key|secret|token/i.test(k)));
  await recheck();
  t.check('the editor shows the tools as connected', (await availability()) === 'ready' && /Connected/.test(await aiCard.innerText()) && (await aiCard.innerText()).includes(MODEL));
  t.check('the tools are enabled', (await aiBox.getByRole('button', { name: 'Remove object' }).isEnabled()) && (await aiBox.getByLabel('Describe the fill').isEnabled()));
  t.check('generative fill waits for a description', await aiBox.getByRole('button', { name: 'Generative fill' }).isDisabled());
});

let fillLayer;

await section('Generative fill', async () => {
  const before = await state(page);
  await aiBox.getByLabel('Describe the fill').fill('a field of sunflowers');
  await aiBox.getByRole('button', { name: 'Generative fill' }).click();
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, before.doc.layers.length, { timeout: 30000 });
  await idle();
  await h.settle(300);

  const request = received[received.length - 1];
  t.check('one request reached the provider, on the image edit route', received.length === 1 && request.path === '/v1/images/edits' && request.method === 'POST');
  t.check('the server added the key; the request is JSON', request.authorization === `Bearer ${KEY}` && /application\/json/.test(request.contentType ?? ''));
  t.check('it carries the model and the description', request.body?.model === MODEL && request.body?.prompt === 'a field of sunflowers', `${request.body?.model} | ${request.body?.prompt}`);
  const image = request.body?.images?.[0]?.image_url ?? '';
  const mask = request.body?.mask?.image_url ?? '';
  const size = request.body?.size;
  const imageSize = image ? pngSize(image) : null;
  const maskSize = mask ? pngSize(mask) : null;
  t.check('picture and mask are PNGs of the requested size', size === '1024x1024' && imageSize?.width === 1024 && imageSize?.height === 1024 && maskSize?.width === 1024 && maskSize?.height === 1024, `${size} image ${JSON.stringify(imageSize)} mask ${JSON.stringify(maskSize)}`);

  // The selection (300..500, 200..400) plus surroundings is the square 230..570 x 130..470.
  const toSent = ([x, y]) => [((x - 230) / 340) * 1024, ((y - 130) / 340) * 1024];
  const sent = await decodeAt(image, [toSent([350, 300]), toSent([450, 300]), toSent([250, 140])]);
  t.check('the picture is the design around the selection', rgbNear(sent.pixels[0], [255, 0, 0], 6) && rgbNear(sent.pixels[1], [0, 0, 255], 6) && rgbNear(sent.pixels[2], [255, 255, 255], 6), sent.pixels.map(fmt).join(' '));
  const sentMask = await decodeAt(mask, [toSent([400, 300]), toSent([310, 210]), toSent([250, 300]), toSent([540, 440])]);
  t.check('the mask is transparent exactly where the selection is', sentMask.pixels[0][3] === 0 && sentMask.pixels[1][3] === 0 && sentMask.pixels[2][3] === 255 && sentMask.pixels[3][3] === 255, sentMask.pixels.map((p) => p[3]).join(' '));

  const after = await state(page);
  fillLayer = after.doc.layers[after.doc.layers.length - 1];
  t.check('the result is a new image layer on top, selected', fillLayer.name === 'Generative fill' && fillLayer.type === 'image' && fillLayer.source.kind === 'asset' && after.selectedIds[0] === fillLayer.id);
  t.check('it sits exactly over the area that was sent', near(fillLayer.x, 230, 1) && near(fillLayer.y, 130, 1) && near(fillLayer.width, 340, 1) && near(fillLayer.height, 340, 1), `${fillLayer.x},${fillLayer.y} ${fillLayer.width}x${fillLayer.height}`);
  t.check('it is masked to the selection', fillLayer.masks.length === 1 && fillLayer.masks[0].enabled);
  t.check('it is one undo step, and the layer underneath is untouched', after.past === before.past + 1 && JSON.stringify(after.doc.layers[0]) === JSON.stringify(before.doc.layers[0]));
  let px = await alphaAt([[400, 300], [320, 220], [250, 300], [540, 300], [100, 100]]);
  t.check('the new pixels show inside the selection only', rgbNear(px[0], MAGENTA) && rgbNear(px[1], MAGENTA) && rgbNear(px[2], [255, 0, 0]) && rgbNear(px[3], [0, 0, 255]) && px[4][3] === 0, px.map(fmt).join(' '));
  t.check('the description is cleared for the next one', (await aiBox.getByLabel('Describe the fill').inputValue()) === '');

  // It is an ordinary layer: switching its mask off reveals the whole generated picture.
  await page.evaluate((id) => window.__prysm.editor.getState().updateLayers([id], (l) => ({ masks: l.masks.map((m) => ({ ...m, enabled: false })) })), fillLayer.id);
  await h.settle(200);
  px = await alphaAt([[250, 300], [540, 440]]);
  t.check('with its mask off, the whole result is there to re-mask by hand', rgbNear(px[0], MAGENTA) && rgbNear(px[1], MAGENTA), px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');

  await page.keyboard.press('Control+z');
  await h.settle(200);
  px = await alphaAt([[400, 300]]);
  t.check('undo removes the fill', (await h.layers()).length === before.doc.layers.length && !rgbNear(px[0], MAGENTA), fmt(px[0]));
  await page.keyboard.press('Control+y');
  await h.settle(200);
  t.check('redo brings it back', (await h.layers()).length === before.doc.layers.length + 1);

  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await h.settle(1200);
  px = await alphaAt([[400, 300], [250, 300]]);
  t.check('the fill is saved with the project and reopens', (await h.layers()).length === before.doc.layers.length + 1 && rgbNear(px[0], MAGENTA) && rgbNear(px[1], [255, 0, 0]), px.map(fmt).join(' '));
});

await section('Object removal', async () => {
  await page.keyboard.press('l');
  const first = await toScreen(page, 220, 170);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const [x, y] of [[280, 170], [280, 260], [220, 260], [220, 170]]) {
    const p = await toScreen(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.mouse.up();
  await h.settle(300);
  await page.waitForFunction(() => window.__prysm.ai.getState().availability === 'ready');
  const count = (await h.layers()).length;
  const sentBefore = received.length;
  await aiBox.getByRole('button', { name: 'Remove object' }).click();
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, count, { timeout: 30000 });
  await idle();
  const request = received[received.length - 1];
  const ls = await h.layers();
  t.check('“Remove object” sends a removal instruction with the mask', received.length === sentBefore + 1 && request.path === '/v1/images/edits' && /remove/i.test(request.body?.prompt ?? '') && !!request.body?.mask?.image_url);
  t.check('the result is a masked layer named for what it does', ls[ls.length - 1].name === 'Object removal' && ls[ls.length - 1].masks.length === 1);
  const px = await alphaAt([[250, 215], [215, 300]]);
  t.check('only the selected area is replaced', rgbNear(px[0], MAGENTA) && rgbNear(px[1], [255, 0, 0]), px.map(fmt).join(' '));
  await page.keyboard.press('Control+d');
  await page.keyboard.press('v');
});

await section('Selections at the edge of the canvas and larger than any supported shape', async () => {
  // A strip down the right edge: the area sent is pushed back inside the canvas.
  await page.keyboard.press('m');
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  await dragDoc([600, 0], [800, 600]);
  await page.waitForFunction(() => window.__prysm.ai.getState().availability === 'ready');
  let count = (await h.layers()).length;
  await aiBox.getByLabel('Describe the fill').fill('more sky');
  await aiBox.getByRole('button', { name: 'Generative fill' }).click();
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, count, { timeout: 30000 });
  await idle();
  let ls = await h.layers();
  let made = ls[ls.length - 1];
  let request = received[received.length - 1];
  t.check('an edge selection is sent in the shape that fits it, kept inside the canvas', request.body?.size === '1024x1536' && near(made.x, 400, 1) && near(made.y, 0, 1) && near(made.width, 400, 1) && near(made.height, 600, 1), `${request.body?.size} at ${made.x},${made.y} ${made.width}x${made.height}`);
  let px = await alphaAt([[700, 300], [790, 590], [550, 300], [100, 100]]);
  t.check('it fills empty canvas up to the edge and nothing else (the way to extend an image)', rgbNear(px[0], MAGENTA) && rgbNear(px[1], MAGENTA) && rgbNear(px[2], [0, 0, 255]) && px[3][3] === 0, px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');

  // The whole 4:3 canvas fits none of the shapes: the nearest one is used and reaches past the canvas.
  await page.keyboard.press('Control+a');
  count = (await h.layers()).length;
  await aiBox.getByLabel('Describe the fill').fill('a new scene');
  await aiBox.getByRole('button', { name: 'Generative fill' }).click();
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, count, { timeout: 30000 });
  await idle();
  ls = await h.layers();
  made = ls[ls.length - 1];
  request = received[received.length - 1];
  const size = pngSize(request.body.images[0].image_url);
  t.check('a selection wider than any shape is sent whole, in the closest shape', request.body?.size === '1536x1024' && size.width === 1536 && near(made.x, -50, 1) && near(made.width, 900, 1) && near(made.height, 600, 1), `${request.body?.size} at ${made.x},${made.y} ${made.width}x${made.height}`);
  px = await alphaAt([[5, 5], [400, 300], [795, 595]]);
  t.check('and the result covers the whole canvas', px.every((p) => rgbNear(p, MAGENTA) && p[3] === 255), px.map(fmt).join(' '));
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('v');
});

await section('Image generation', async () => {
  await h.openTab('ai');
  const count = (await h.layers()).length;
  await aiCard.getByLabel('Image description').fill('a paper boat on a pond');
  await aiCard.getByRole('button', { name: 'Wide', exact: true }).click();
  await aiCard.getByRole('button', { name: 'Generate image' }).click();
  await page.waitForFunction((n) => window.__prysm.editor.getState().doc.layers.length === n + 1, count, { timeout: 30000 });
  await idle();
  const request = received[received.length - 1];
  t.check('the request goes to the generation route with the description and shape', request.path === '/v1/images/generations' && request.body?.prompt === 'a paper boat on a pond' && request.body?.size === '1536x1024' && request.body?.model === MODEL && request.authorization === `Bearer ${KEY}`);
  const ls = await h.layers();
  const made = ls[ls.length - 1];
  t.check('the image arrives as a normal image layer with the right proportions', made.type === 'image' && made.source.kind === 'asset' && near(made.width / made.height, 1.5, 0.01) && made.masks.length === 0, `${made.width}x${made.height}`);
  const assets = await page.evaluate(() => document.querySelectorAll('[data-testid="upload-input"]').length);
  t.check('the editor is still responsive afterwards', assets >= 0 && (await page.locator('[data-testid="editor"]').isVisible()));
  await page.keyboard.press('Control+z');
});

await section('Provider errors', async () => {
  const expected = errors.length;
  const count = (await h.layers()).length;
  stubMode = 'unauthorized';
  await aiCard.getByLabel('Image description').fill('anything');
  await aiCard.getByRole('button', { name: 'Generate image' }).click();
  await page.waitForFunction(() => /key/i.test(window.__prysm.ui.getState().toast?.text ?? ''), null, { timeout: 30000 });
  await idle();
  let message = await toast();
  t.check('a rejected key is explained, without quoting the key', /rejected/.test(message) && !message.includes('sk-') && (await h.layers()).length === count, message);
  stubMode = 'moderation';
  await aiCard.getByRole('button', { name: 'Generate image' }).click();
  await page.waitForFunction(() => /safety/i.test(window.__prysm.ui.getState().toast?.text ?? ''), null, { timeout: 30000 });
  await idle();
  message = await toast();
  t.check('a request the provider declines is explained', /safety/.test(message) && (await h.layers()).length === count, message);
  stubMode = 'ok';
  const unexpected = errors.slice(expected).filter((e) => !/Failed to load resource/.test(e));
  t.check('failures leave no layer and no page errors beyond the failed requests', unexpected.length === 0, unexpected.join(' | '));
  errors.length = expected;
});

await section('The key stays on the server', async () => {
  t.check('no API response seen by the browser contains the key', apiBodies.length > 3 && apiBodies.every((b) => !b.includes(KEY) && !b.includes(KEY.slice(0, 12))), `${apiBodies.length} responses checked`);
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|css|html)$/.test(name)) files.push(path);
    }
  };
  walk(join(ROOT, 'src'));
  files.push(join(ROOT, 'index.html'));
  const leaks = files.filter((f) => /OPENAI|API_KEY|process\.env|import\.meta\.env\.(?!DEV|PROD|MODE|BASE_URL)/.test(readFileSync(f, 'utf8')));
  t.check('the web app source never reads a key or a secret environment variable', leaks.length === 0, leaks.join(', '));
  const inPage = await page.evaluate((key) => document.documentElement.outerHTML.includes(key) || JSON.stringify(localStorage).includes(key), KEY);
  t.check('the key is not in the page or in browser storage', !inPage);
});

await section('Server input checks', async () => {
  // A fresh server, so the requests made so far do not count towards the rate limit being tested here.
  await stopServer();
  await startServer({ OPENAI_API_KEY: KEY });
  const tiny = `data:image/png;base64,${solidPng(16, 16, [0, 0, 0]).toString('base64')}`;
  const sent = received.length;
  let r = await post('/api/ai/generate', { prompt: 'x', size: '4096x4096' });
  t.check('an unsupported size is refused', r.status === 400 && /size/i.test(r.body?.error ?? ''), `${r.status} ${r.body?.error}`);
  r = await post('/api/ai/generate', { prompt: '   ', size: '1024x1024' });
  t.check('an empty description is refused', r.status === 400);
  r = await post('/api/ai/generate', { prompt: 'x'.repeat(2001), size: '1024x1024' });
  t.check('an over-long description is refused', r.status === 400 && /long/.test(r.body?.error ?? ''));
  r = await post('/api/ai/edit', { prompt: 'x', size: '1024x1024', image: 'data:text/html;base64,PGI+', mask: tiny });
  t.check('anything but a PNG is refused as the picture', r.status === 400 && /PNG/.test(r.body?.error ?? ''));
  r = await post('/api/ai/edit', { prompt: 'x', size: '1024x1024', image: tiny, mask: 'https://example.com/mask.png' });
  t.check('a URL is refused as the mask (the server does not fetch on request)', r.status === 400);
  r = await post('/api/ai/generate', '{not json');
  t.check('malformed JSON is refused', r.status === 400);
  r = await post('/api/ai/generate', 'prompt=x', { 'Content-Type': 'text/plain' });
  t.check('non-JSON bodies are refused', r.status === 415);
  r = await post('/api/ai/unknown', {});
  t.check('unknown routes are refused', r.status === 404);
  t.check('none of the refused requests reached the provider', received.length === sent, `${received.length - sent} sent`);

  let cors = await fetch(`${SERVER}/api/ai/status`, { headers: { Origin: 'https://evil.example' } });
  t.check('other websites get no cross-origin access', cors.headers.get('access-control-allow-origin') === null);
  cors = await fetch(`${SERVER}/api/ai/status`, { headers: { Origin: 'http://localhost:5173' } });
  t.check('the editor’s own origin is allowed', cors.headers.get('access-control-allow-origin') === 'http://localhost:5173');

  const traversal = await fetch(`${SERVER}/..%2f..%2fpackage.json`);
  const leaked = await traversal.text();
  t.check('files outside the built app cannot be read through the server', traversal.status >= 400 && !leaked.includes('"dependencies"'), `${traversal.status}`);
  const env = await fetch(`${SERVER}/.env`);
  t.check('the .env file is not served', env.status >= 400 || !(await env.text()).includes('OPENAI_API_KEY='), `${env.status}`);

  let limited = null;
  for (let i = 0; i < 20 && !limited; i++) {
    r = await post('/api/ai/generate', { prompt: 'x', size: '1024x1024' });
    if (r.status === 429) limited = r;
  }
  t.check('requests are rate limited', !!limited && /minute|moment/.test(limited.body?.error ?? ''), limited?.body?.error ?? 'never limited');
});

await section('Provider unreachable', async () => {
  await stopServer();
  await new Promise((resolve) => stub.close(resolve));
  await startServer({ OPENAI_API_KEY: KEY });
  const r = await post('/api/ai/generate', { prompt: 'x', size: '1024x1024' });
  t.check('an unreachable provider is reported as such', r.status === 502 && /reach/.test(r.body?.error ?? ''), `${r.status} ${r.body?.error}`);
  await stopServer();
});

t.check('no unexpected console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
await stopServer();
if (stub.listening) stub.close();
process.exit(failed ? 1 : 0);
