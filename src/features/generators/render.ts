import type { ImageSource } from '../../types/document';
import { BACKGROUNDS } from './backgrounds';
import { OVERLAYS } from './overlays';
import { TEXTURES } from './textures';
import { createGen, type GeneratorDef, type GeneratorKind } from './types';

export const GENERATORS: GeneratorDef[] = [...TEXTURES, ...OVERLAYS, ...BACKGROUNDS];
const byId = new Map(GENERATORS.map((g) => [g.id, g]));

export const getGenerator = (id: string) => byId.get(id);
export const generatorsOfKind = (kind: GeneratorKind) => GENERATORS.filter((g) => g.kind === kind);

type GeneratedSource = Extract<ImageSource, { kind: 'generated' }>;

const CACHE_LIMIT = 24;
const cache = new Map<string, HTMLCanvasElement>();
const thumbs = new Map<string, string>();

function draw(def: GeneratorDef, width: number, height: number, seed: number, colors: string[]) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Fall back to the default palette for any colour the document does not specify.
  const palette = def.colors.map((c, i) => colors[i] ?? c);
  def.draw(createGen(ctx, width, height, seed, palette));
  return canvas;
}

/** Renders (and caches) the bitmap a generated image layer describes. Deterministic for a given source. */
export function renderGenerated(source: GeneratedSource): HTMLCanvasElement | null {
  const def = byId.get(source.generator);
  if (!def) return null;
  const key = `${source.generator}|${source.seed}|${source.width}x${source.height}|${source.colors.join(',')}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const canvas = draw(def, source.width, source.height, source.seed, source.colors);
  cache.set(key, canvas);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return canvas;
}

/** Small preview used by the asset panels. */
export function generatorThumbnail(def: GeneratorDef, size = 168): string {
  let url = thumbs.get(def.id);
  if (!url) {
    const canvas = draw(def, size, size, 7, def.colors);
    // Previews of transparent / light-emitting assets need a backdrop to be readable.
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = def.blend === 'screen' ? '#000000' : '#f4f4f2';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(canvas, 0, 0);
    url = out.toDataURL('image/webp', 0.85);
    thumbs.set(def.id, url);
  }
  return url;
}
