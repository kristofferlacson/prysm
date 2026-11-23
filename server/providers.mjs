/**
 * AI provider adapters. Each one turns the editor's two requests into the provider's API:
 *
 *   edit({ image, mask, prompt, size })   image and mask are PNG data URLs of the same size;
 *                                          fully transparent mask pixels mark the area to repaint
 *   generate({ prompt, size })
 *
 * Both resolve to a PNG data URL. The API key is read here, on the server, and is never returned.
 *
 * Only OpenAI's image API is implemented. OPENAI_BASE_URL can point the same adapter at a
 * compatible gateway (and is how the tests run it against a local stand-in).
 */

import { HttpError } from './errors.mjs';

const TIMEOUT_MS = 180_000;

function describeFailure(status, payload) {
  const code = payload?.error?.code ?? '';
  const detail = typeof payload?.error?.message === 'string' ? payload.error.message.slice(0, 300) : '';
  if (status === 401 || status === 403) return 'The AI provider rejected the server’s API key. Check the key in the server’s .env file.';
  if (code === 'moderation_blocked' || code === 'content_policy_violation') return 'The AI provider’s safety system declined this request. Try a different description or area.';
  if (status === 429) return detail ? `The AI provider is limiting requests: ${detail}` : 'The AI provider is limiting requests (rate limit or quota). Try again later.';
  if (status === 404) return `The AI provider does not know the model or route in use${detail ? `: ${detail}` : '.'} Check OPENAI_IMAGE_MODEL.`;
  return `The AI provider returned an error (${status})${detail ? `: ${detail}` : '.'}`;
}

function openai(env) {
  const key = (env.OPENAI_API_KEY ?? '').trim();
  const base = (env.OPENAI_BASE_URL ?? 'https://api.openai.com').replace(/\/+$/, '');
  const model = (env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-sunburst').trim();

  async function call(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new HttpError(502, err?.name === 'AbortError' ? 'The AI provider took too long to answer.' : 'The server could not reach the AI provider.');
    } finally {
      clearTimeout(timer);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new HttpError(response.status === 429 ? 429 : 502, describeFailure(response.status, payload));
    const b64 = payload?.data?.[0]?.b64_json;
    if (typeof b64 !== 'string' || !b64) throw new HttpError(502, 'The AI provider answered without an image.');
    return `data:image/png;base64,${b64}`;
  }

  return {
    name: 'openai',
    model,
    configured: key.length > 0,
    sizes: ['1024x1024', '1536x1024', '1024x1536'],
    edit: ({ image, mask, prompt, size }) =>
      call('/v1/images/edits', { model, prompt, images: [{ image_url: image }], mask: { image_url: mask }, size, n: 1, output_format: 'png' }),
    generate: ({ prompt, size }) => call('/v1/images/generations', { model, prompt, size, n: 1, output_format: 'png' }),
  };
}

export function createProvider(env) {
  return openai(env);
}
