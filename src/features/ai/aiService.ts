import { create } from 'zustand';

/**
 * Client for the Prysm AI server (server/index.mjs). The browser only ever talks to /api/ai/* on
 * its own origin; the provider's API key lives on that server and is never sent here.
 */

/** offline: no server answers. unconfigured: the server runs but has no provider key. */
export type AiAvailability = 'checking' | 'offline' | 'unconfigured' | 'ready';

interface AiServiceState {
  availability: AiAvailability;
  provider: string | null;
  model: string | null;
  sizes: string[];
  /** What the service is doing right now, for the interface. */
  job: string | null;
  set: (patch: Partial<Pick<AiServiceState, 'availability' | 'provider' | 'model' | 'sizes' | 'job'>>) => void;
}

export const useAiService = create<AiServiceState>()((set) => ({
  availability: 'checking',
  provider: null,
  model: null,
  sizes: [],
  job: null,
  set: (patch) => set(patch),
}));

export const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI' };

let checking: Promise<AiAvailability> | null = null;

/** Asks the server whether AI requests can be served. Safe to call often. */
export function checkAiService(): Promise<AiAvailability> {
  checking ??= (async () => {
    let availability: AiAvailability = 'offline';
    try {
      const response = await fetch('/api/ai/status', { headers: { Accept: 'application/json' } });
      const body = response.ok && (response.headers.get('content-type') ?? '').includes('json') ? await response.json() : null;
      if (body?.ok) {
        availability = body.configured ? 'ready' : 'unconfigured';
        useAiService.getState().set({ provider: body.provider ?? null, model: body.model ?? null, sizes: Array.isArray(body.sizes) ? body.sizes : [] });
      }
    } catch {
      // Network error: treated as no server.
    }
    useAiService.getState().set({ availability });
    checking = null;
    return availability;
  })();
  return checking;
}

async function post(path: string, body: unknown): Promise<string> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('The AI server could not be reached.');
  }
  const payload = (response.headers.get('content-type') ?? '').includes('json') ? await response.json().catch(() => null) : null;
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `The AI server answered with an error (${response.status}).`);
  if (typeof payload?.image !== 'string' || !payload.image.startsWith('data:image/')) throw new Error('The AI server answered without an image.');
  return payload.image;
}

export interface AiEditRequest {
  /** PNG data URL of the area being worked on. */
  image: string;
  /** PNG data URL of the same size; fully transparent pixels mark what may be repainted. */
  mask: string;
  prompt: string;
  /** One of the sizes the server reports, e.g. "1024x1024". */
  size: string;
}

export const aiEdit = (request: AiEditRequest) => post('/api/ai/edit', request);
export const aiGenerate = (request: { prompt: string; size: string }) => post('/api/ai/generate', request);
