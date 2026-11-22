import type { DragEvent, ReactNode } from 'react';
import { Search } from 'lucide-react';
import { insertLibraryItem, LIBRARY_MIME, type LibraryItem } from '../../../features/library/insert';

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
      <div className="flex h-9 shrink-0 items-center border-b border-line px-3 font-semibold">{title}</div>
      {onQuery && (
        <label className="mx-3 mt-3 flex h-7 shrink-0 items-center gap-1.5 rounded bg-raised px-2 focus-within:outline focus-within:outline-1 focus-within:outline-accent">
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
    <div className="flex flex-wrap gap-1 px-3 pt-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={o === value}
          onClick={() => onChange(o)}
          className={`rounded-full px-2 py-0.5 text-[11px] ${
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
  return <h3 className="px-3 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-dim">{children}</h3>;
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
