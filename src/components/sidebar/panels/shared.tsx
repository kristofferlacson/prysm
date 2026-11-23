import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Search, Star } from 'lucide-react';
import { toggleFavourite, useLibraryUsage } from '../../../features/library/usage';
import { PANEL_HELP } from '../../../features/guide/guide';
import { insertLibraryItem, LIBRARY_MIME, type LibraryItem } from '../../../features/library/insert';
import { HelpLink } from '../../ui/controls';

export function PanelShell({
  title,
  query,
  onQuery,
  placeholder,
  children,
}: {
  title: string;
  query?: string;
  onQuery?: (q: string) => void;
  placeholder?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-2 text-[13px] font-semibold">
        {title}
        {PANEL_HELP[title] && <HelpLink topic={PANEL_HELP[title]} />}
      </div>
      {onQuery && (
        <label className="mx-4 mt-3.5 flex h-8 shrink-0 items-center gap-2 rounded-md bg-raised px-2.5 focus-within:outline focus-within:outline-1 focus-within:outline-accent">
          <Search size={12} className="text-faint" />
          <input
            aria-label={placeholder ?? 'Search'}
            placeholder={placeholder ?? 'Search'}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            className="w-full bg-transparent outline-none placeholder:text-faint"
          />
        </label>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-3">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={`rounded-full px-2.5 py-1 text-[11px] ${
            o === value ? 'bg-accent/15 text-accent' : 'bg-raised text-dim hover:text-ink'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return <h3 className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wide text-dim">{children}</h3>;
}

/** Props that let a tile be clicked to add it at the canvas centre, or dragged to a spot on the canvas. */
export function libraryItemProps(item: LibraryItem) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(item));
    },
    onClick: () => insertLibraryItem(item),
  };
}

export const tileClass =
  'group relative overflow-hidden rounded border border-line bg-raised text-left transition-colors hover:border-accent/60';

/**
 * True once the element has scrolled into view (and from then on). Tiles use it so a preview is
 * only drawn when someone can see it: opening a panel with a hundred assets draws the first few.
 */
export function useSeen<T extends Element>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen] as const;
}

/** Star in the corner of a tile. Shown on hover, and always once the asset is a favourite. */
export function FavouriteButton({ id, name }: { id: string; name: string }) {
  const on = useLibraryUsage((s) => s.favourites.includes(id));
  return (
    <button
      type="button"
      data-favourite={id}
      aria-pressed={on}
      title={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
      aria-label={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
      onClick={() => toggleFavourite(id)}
      className={`absolute right-1 top-1 z-10 h-5 w-5 items-center justify-center rounded bg-black/55 ${on ? 'flex text-[#ffd166]' : 'hidden text-white hover:text-[#ffd166] group-hover/tile:flex'}`}
    >
      <Star size={11} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}
