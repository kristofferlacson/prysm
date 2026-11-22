import { useEffect, useMemo, useState } from 'react';
import { generatorsOfKind, generatorThumbnail } from '../../../features/generators/render';
import type { GeneratorDef, GeneratorKind } from '../../../features/generators/types';
import { Chips, libraryItemProps, PanelShell, tileClass } from './shared';

/** Thumbnails are rendered one per task so opening a panel never blocks the interface. */
function GeneratorTile({ def }: { def: GeneratorDef }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSrc(generatorThumbnail(def)), 0);
    return () => clearTimeout(t);
  }, [def]);
  return (
    <button
      type="button"
      title={`${def.name} — click to add, or drag onto the canvas`}
      data-generator={def.id}
      {...libraryItemProps({ kind: 'generator', id: def.id })}
      className={`${tileClass} aspect-square`}
    >
      {src ? (
        <img src={src} alt={def.name} draggable={false} className="h-full w-full object-cover" />
      ) : (
        <span className="block h-full w-full animate-pulse bg-hover" />
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{def.name}</span>
    </button>
  );
}

export function GeneratorGrid({ kind, query = '', category = 'All' }: { kind: GeneratorKind; query?: string; category?: string }) {
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return generatorsOfKind(kind).filter(
      (g) =>
        (category === 'All' || g.category === category) &&
        (!q || g.name.toLowerCase().includes(q) || g.tags.some((t) => t.includes(q)) || g.category.toLowerCase().includes(q)),
    );
  }, [kind, query, category]);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 p-3">
        {items.map((def) => (
          <GeneratorTile key={def.id} def={def} />
        ))}
      </div>
      {!items.length && <p className="px-3 pb-3 text-faint">Nothing matches “{query}”.</p>}
    </>
  );
}

const COPY: Record<'texture' | 'overlay', { title: string; placeholder: string; hint: string }> = {
  texture: {
    title: 'Textures',
    placeholder: 'Search textures',
    hint: 'Textures are added as full-canvas layers with a suggested blend mode. Change the blend, opacity, colours or variation in the properties panel. Lock a texture in the Layers panel to click through it to the layers below.',
  },
  overlay: {
    title: 'Overlays',
    placeholder: 'Search overlays',
    hint: 'Overlays are layers too: move, scale, rotate and re-blend them like any image. Lock one in the Layers panel to click through it.',
  },
};

export function GeneratorPanel({ kind }: { kind: 'texture' | 'overlay' }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const categories = useMemo(() => ['All', ...new Set(generatorsOfKind(kind).map((g) => g.category))], [kind]);
  const copy = COPY[kind];
  return (
    <PanelShell title={copy.title} query={query} onQuery={setQuery} placeholder={copy.placeholder}>
      <Chips value={category} options={categories} onChange={setCategory} />
      <GeneratorGrid kind={kind} query={query} category={category} />
      <p className="px-3 pb-3 text-faint">{copy.hint}</p>
    </PanelShell>
  );
}
