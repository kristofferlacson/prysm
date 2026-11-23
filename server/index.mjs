/**
 * Prysm AI server.
 *
 * The one job of this process is to hold the AI provider's API key. The editor (a static web app)
 * never sees the key: it calls /api/ai/* here, and this server adds the key and forwards the
 * request to the provider.
 *
 *   npm run server          start on http://localhost:8787 (the Vite dev server proxies /api to it)
 *
 * Configuration comes from environment variables or a .env file next to package.json
 * (see .env.example). It has no dependencies: Node 20 or newer is enough.
 *
 * If a production build exists in dist/, it is served too, so one process can host the whole app.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.mjs';
import { createProvider } from './providers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Reads KEY=VALUE lines from .env. Real environment variables win. */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadEnvFile(join(ROOT, '.env'));

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const MAX_BODY_BYTES = 40 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2000;
const REQUESTS_PER_MINUTE = Number(process.env.AI_REQUESTS_PER_MINUTE ?? 12);
const MAX_CONCURRENT = 2;
/** Browser origins allowed to call the API directly. Same-origin and proxied requests need none. */
const ALLOWED_ORIGINS = (process.env.AI_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const provider = createProvider(process.env);

// ---------- request plumbing ----------

function send(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolvePromise, reject) => {
    if (!(req.headers['content-type'] ?? '').includes('application/json')) {
      reject(new HttpError(415, 'Send the request as JSON.'));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'The image is too large to send.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'The request was not valid JSON.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'The request was interrupted.')));
  });
}

const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= REQUESTS_PER_MINUTE) {
    hits.set(ip, recent);
    throw new HttpError(429, 'Too many AI requests in a short time. Wait a minute and try again.');
  }
  recent.push(now);
  hits.set(ip, recent);
}

let running = 0;

// ---------- validation ----------

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

function requirePrompt(value) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'Describe what you want first.');
  if (value.length > MAX_PROMPT_CHARS) throw new HttpError(400, `The description is too long (limit ${MAX_PROMPT_CHARS} characters).`);
  return value.trim();
}

function requireSize(value) {
  if (!provider.sizes.includes(value)) throw new HttpError(400, `Unsupported image size. Use one of: ${provider.sizes.join(', ')}.`);
  return value;
}

function requirePng(value, name) {
  if (typeof value !== 'string' || !PNG_DATA_URL.test(value)) throw new HttpError(400, `The ${name} must be a PNG image.`);
  return value;
}

// ---------- API ----------

function status() {
  // Deliberately says nothing about the key beyond whether one is set.
  return {
    ok: true,
    configured: provider.configured,
    provider: provider.name,
    model: provider.model,
    sizes: provider.sizes,
    requestsPerMinute: REQUESTS_PER_MINUTE,
  };
}

async function handleApi(req, res, path) {
  if (path === '/api/ai/status' && req.method === 'GET') {
    send(res, 200, status());
    return;
  }
  if (req.method !== 'POST' || (path !== '/api/ai/edit' && path !== '/api/ai/generate')) {
    throw new HttpError(404, 'Unknown API route.');
  }
  if (!provider.configured) {
    throw new HttpError(503, 'No AI provider key is set on the server. Add it to the .env file and restart the server.');
  }
  rateLimit(req.socket.remoteAddress ?? 'unknown');
  const body = await readJson(req);
  const prompt = requirePrompt(body.prompt);
  const size = requireSize(body.size);
  if (running >= MAX_CONCURRENT) throw new HttpError(429, 'The server is busy with other AI requests. Try again in a moment.');
  running++;
  try {
    const image =
      path === '/api/ai/edit'
        ? await provider.edit({ image: requirePng(body.image, 'image'), mask: requirePng(body.mask, 'mask'), prompt, size })
        : await provider.generate({ prompt, size });
    send(res, 200, { image });
  } finally {
    running--;
  }
}

// ---------- static files (only when a production build exists) ----------

const DIST = join(ROOT, 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, path) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
  if (!existsSync(join(DIST, 'index.html'))) throw new HttpError(404, 'Not found. (No production build: run "npm run build", or use the Vite dev server.)');
  let file = normalize(join(DIST, decodeURIComponent(path)));
  // Never serve anything outside dist/, whatever the URL says.
  if (file !== DIST && !file.startsWith(DIST + sep)) throw new HttpError(403, 'Forbidden.');
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // Like other single-page hosts (and Vite's preview), unknown paths get the app itself. The editor
    // relies on this when it probes for optional files such as models that are not installed.
    file = join(DIST, 'index.html');
  }
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const size = statSync(file).size;
  // Browsers ask for parts of a video (to seek in it): answer a byte range when one is requested.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

// ---------- server ----------

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const origin = req.headers.origin;
  const cors = origin && ALLOWED_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  try {
    if (path.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
        return;
      }
      for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
      await handleApi(req, res, path);
    } else {
      serveStatic(req, res, path);
    }
  } catch (err) {
    const known = err instanceof HttpError;
    if (!known) console.error('[prysm-server]', err);
    if (!res.headersSent) send(res, known ? err.status : 500, { error: known ? err.message : 'The server hit an unexpected error.' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Prysm AI server on http://${HOST}:${PORT}`);
  console.log(provider.configured ? `Provider: ${provider.name} (${provider.model}). The key stays on this server.` : 'No provider key set: AI requests will be refused. See .env.example.');
});
