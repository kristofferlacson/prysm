import { useEffect, useMemo, useState } from 'react';
import { generatorsOfKind, generatorThumbnail } from '../../../features/generators/render';
import type { GeneratorDef, GeneratorKind } from '../../../features/generators/types';
import { assetTitle, useLibraryUsage } from '../../../features/library/usage';
import { Chips, FavouriteButton, libraryItemProps, PanelShell, tileClass, useSeen } from './shared';

/** A thumbnail is drawn only once its tile is on screen, one per task, so a panel never blocks the interface. */
export function GeneratorTile({ def }: { def: GeneratorDef }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!seen) return;
    const t = setTimeout(() => setSrc(generatorThumbnail(def)), 0);
    return () => clearTimeout(t);
  }, [def, seen]);
  return (
    <div ref={ref} className="group/tile relative">
      <button
        type="button"
        title={assetTitle(def.id, def.name)}
        data-generator={def.id}
        {...libraryItemProps({ kind: 'generator', id: def.id })}
        className={`${tileClass} block aspect-square w-full`}
      >
        {src ? (
          <img src={src} alt={def.name} draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="block h-full w-full animate-pulse bg-hover" />
        )}
        <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{def.name}</span>
      </button>
      <FavouriteButton id={def.id} name={def.name} />
    </div>
  );
}

export function GeneratorGrid({ kind, query = '', category = 'All' }: { kind: GeneratorKind; query?: string; category?: string }) {
  const { recent, favourites } = useLibraryUsage();
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = generatorsOfKind(kind).filter(
      (g) =>
        (category === 'All' || g.category === category || (category === 'Favourites' && favourites.includes(g.id)) || (category === 'Recent' && recent.includes(g.id))) &&
        (!q || g.name.toLowerCase().includes(q) || g.tags.some((t) => t.includes(q)) || g.category.toLowerCase().includes(q)),
    );
    // Most recently used first.
    return category === 'Recent' ? list.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)) : list;
  }, [kind, query, category, recent, favourites]);
  const empty =
    category === 'Favourites' && !query ? 'No favourites yet. Hover an item and click its star.' : category === 'Recent' && !query ? 'Nothing used yet.' : `Nothing matches “${query}”.`;
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 p-4">
        {items.map((def) => (
          <GeneratorTile key={def.id} def={def} />
        ))}
      </div>
      {!items.length && <p className="px-4 pb-3 text-faint">{empty}</p>}
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
  const categories = useMemo(() => ['All', 'Favourites', 'Recent', ...new Set(generatorsOfKind(kind).map((g) => g.category))], [kind]);
  const copy = COPY[kind];
  return (
    <PanelShell title={copy.title} query={query} onQuery={setQuery} placeholder={copy.placeholder}>
      <Chips value={category} options={categories} onChange={setCategory} />
      <GeneratorGrid kind={kind} query={query} category={category} />
      <p className="px-4 pb-4 leading-relaxed text-faint">{copy.hint}</p>
    </PanelShell>
  );
}
