import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { BookmarkPlus, X } from 'lucide-react';
import { createShape } from '../../../features/document/factory';
import { GRAPHICS, type GraphicDef } from '../../../features/library/graphics';
import { ICONS } from '../../../features/library/iconData';
import type { LibraryItem } from '../../../features/library/insert';
import { assetTitle, iconAssetId, useLibraryUsage } from '../../../features/library/usage';
import { deleteSavedDesign, refreshDesignLibrary, saveSelectionToLibrary, useDesignLibrary } from '../../../services/designLibrary';
import { useEditorStore } from '../../../stores/editorStore';
import { useUiStore } from '../../../stores/uiStore';
import type { ShapeKind, ShapeLayer } from '../../../types/document';
import { isOpenShape, traceShape } from '../../canvas/konvaProps';
import { TextButton } from '../../ui/controls';
import { Chips, FavouriteButton, Heading, libraryItemProps, PanelShell, tileClass, useSeen } from './shared';

interface ElementDef {
  label: string;
  category: 'Shapes' | 'Lines' | 'Frames';
  shape: ShapeKind;
  overrides?: Partial<ShapeLayer>;
}

const frame = { fill: null, stroke: { color: '#1d1e22', width: 10 } };

const ELEMENTS: ElementDef[] = [
  { label: 'Rectangle', category: 'Shapes', shape: 'rect' },
  { label: 'Rounded rectangle', category: 'Shapes', shape: 'rect', overrides: { cornerRadius: 48, name: 'Rounded rectangle' } },
  { label: 'Circle', category: 'Shapes', shape: 'ellipse' },
  { label: 'Triangle', category: 'Shapes', shape: 'triangle' },
  { label: 'Pentagon', category: 'Shapes', shape: 'polygon', overrides: { sides: 5, name: 'Pentagon' } },
  { label: 'Hexagon', category: 'Shapes', shape: 'polygon', overrides: { sides: 6, name: 'Hexagon' } },
  { label: 'Octagon', category: 'Shapes', shape: 'polygon', overrides: { sides: 8, name: 'Octagon' } },
  { label: 'Star', category: 'Shapes', shape: 'star' },
  { label: 'Four-point star', category: 'Shapes', shape: 'star', overrides: { sides: 4, innerRadius: 0.35, name: 'Four-point star' } },
  { label: 'Burst', category: 'Shapes', shape: 'star', overrides: { sides: 14, innerRadius: 0.78, name: 'Burst' } },
  { label: 'Line', category: 'Lines', shape: 'line' },
  { label: 'Arrow', category: 'Lines', shape: 'arrow' },
  { label: 'Square frame', category: 'Frames', shape: 'rect', overrides: { ...frame, name: 'Square frame' } },
  { label: 'Rounded frame', category: 'Frames', shape: 'rect', overrides: { ...frame, cornerRadius: 48, name: 'Rounded frame' } },
  { label: 'Circle frame', category: 'Frames', shape: 'ellipse', overrides: { ...frame, name: 'Circle frame' } },
  { label: 'Hexagon frame', category: 'Frames', shape: 'polygon', overrides: { ...frame, name: 'Hexagon frame' } },
];

const CATEGORIES = ['All', 'Favourites', 'Recent', 'My assets', 'Shapes', 'Icons', 'Stickers', 'Frames', 'Illustrations', 'Geometric', 'Lines'] as const;
type Category = (typeof CATEGORIES)[number];

/** Draws the element with the same outline code the canvas uses, so the preview is exact. */
function ShapePreview({ def }: { def: ElementDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const size = 96;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const open = isOpenShape(def.shape);
    const layer: ShapeLayer = {
      ...createShape(def.shape, 240, 240, def.overrides),
      width: 64,
      height: open ? 16 : 64,
      cornerRadius: def.overrides?.cornerRadius ? 14 : 0,
    };
    ctx.translate((size - layer.width) / 2, (size - layer.height) / 2);
    traceShape(ctx as unknown as Konva.Context, layer);
    if (layer.fill) {
      ctx.fillStyle = '#c9ccd3';
      ctx.fill();
    } else {
      ctx.strokeStyle = '#c9ccd3';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = open ? 'round' : 'miter';
      ctx.stroke();
    }
  }, [def]);
  return <canvas ref={ref} className="h-12 w-12" />;
}

/** The graphic drawn by its own code, in its default colours. */
function GraphicPreview({ def }: { def: GraphicDef }) {
  const [ref, seen] = useSeen<HTMLCanvasElement>();
  useEffect(() => {
    if (!seen) return;
    const canvas = ref.current!;
    const box = 144;
    const w = def.aspect >= 1 ? box : box * def.aspect;
    const h = def.aspect >= 1 ? box / def.aspect : box;
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    def.draw(ctx, canvas.width, canvas.height, def.colors);
  }, [def, seen, ref]);
  return <canvas ref={ref} className="max-h-full max-w-full" />;
}

const matches = (q: string, ...words: string[]) => !q || words.some((w) => w.toLowerCase().includes(q));

function MyAssets({ query }: { query: string }) {
  const items = useDesignLibrary((s) => s.items);
  const hasSelection = useEditorStore((s) => s.selectedIds.length > 0);
  const shown = items.filter((d) => matches(query, d.name));
  useEffect(() => {
    void refreshDesignLibrary();
  }, []);
  return (
    <div data-testid="my-assets" className="px-4 pb-1">
      <TextButton
        className="w-full"
        disabled={!hasSelection}
        onClick={async () => {
          const saved = await saveSelectionToLibrary();
          if (saved) useUiStore.getState().notify(`Saved “${saved.name}” to My assets. It is available in every project.`);
        }}
      >
        <BookmarkPlus size={13} /> Save selection to My assets
      </TextButton>
      {!items.length && (
        <p className="pt-2.5 leading-relaxed text-faint">
          Select one or more layers and save them here to reuse them in any project. They stay fully editable.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2.5 pt-2.5">
        {shown.map((d) => (
          <div key={d.id} data-saved-design={d.id} className={`${tileClass} group checker aspect-square`}>
            <button type="button" title={d.name} {...libraryItemProps({ kind: 'saved', id: d.id })} className="flex h-full w-full items-center justify-center p-1.5">
              {d.thumbnail ? <img src={d.thumbnail} alt={d.name} draggable={false} className="max-h-full max-w-full object-contain" /> : <span className="bg-panel px-1 text-faint">{d.name}</span>}
            </button>
            <button
              type="button"
              title={`Remove ${d.name} from My assets`}
              aria-label={`Remove ${d.name} from My assets`}
              onClick={() => void deleteSavedDesign(d.id)}
              className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded bg-panel/90 text-dim hover:text-danger group-hover:flex"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ElementsPanel() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const q = query.trim().toLowerCase();
  const { recent, favourites } = useLibraryUsage();
  // Favourites and Recent are filters over the same library, not separate places.
  const picked = category === 'Favourites' ? favourites : category === 'Recent' ? recent : null;
  const show = (c: Category) => category === 'All' || category === c || (picked !== null && c !== 'My assets');
  const keep = (id: string) => !picked || picked.includes(id);

  const shapes = useMemo(() => (picked ? [] : ELEMENTS.filter((e) => matches(q, e.label, e.category))), [q, picked]);
  const graphics = useMemo(() => GRAPHICS.filter((g) => keep(g.id) && matches(q, g.name, g.category, ...g.tags)), [q, picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const icons = useMemo(() => ICONS.filter((i) => keep(iconAssetId(i.name)) && matches(q, i.label, i.name, i.category)), [q, picked]); // eslint-disable-line react-hooks/exhaustive-deps

  const shapeTiles = (list: ElementDef[]) => (
    <div className="grid grid-cols-3 gap-2.5 px-4">
      {list.map((def) => (
        <button
          key={def.label}
          type="button"
          title={def.label}
          {...libraryItemProps({ kind: 'shape', shape: def.shape, overrides: def.overrides })}
          className={`${tileClass} flex aspect-square items-center justify-center`}
        >
          <ShapePreview def={def} />
        </button>
      ))}
    </div>
  );
  const graphicTiles = (list: GraphicDef[]) => (
    <div className="grid grid-cols-3 gap-2.5 px-4">
      {list.map((def) => (
        <div key={def.id} className="group/tile relative">
          <button
            type="button"
            title={assetTitle(def.id, def.name)}
            data-graphic={def.id}
            {...libraryItemProps({ kind: 'graphic', id: def.id } as LibraryItem)}
            className={`${tileClass} flex aspect-square w-full items-center justify-center bg-[#e9e9e6] p-2`}
          >
            <GraphicPreview def={def} />
          </button>
          <FavouriteButton id={def.id} name={def.name} />
        </div>
      ))}
    </div>
  );

  const sections: { title: Category; body: React.ReactNode; count: number }[] = [
    { title: 'My assets', body: <MyAssets query={q} />, count: 1 },
    { title: 'Shapes', body: shapeTiles(shapes.filter((s) => s.category === 'Shapes')), count: shapes.filter((s) => s.category === 'Shapes').length },
    { title: 'Stickers', body: graphicTiles(graphics.filter((g) => g.category === 'Stickers')), count: graphics.filter((g) => g.category === 'Stickers').length },
    {
      title: 'Frames',
      body: (
        <div className="space-y-2.5">
          {graphicTiles(graphics.filter((g) => g.category === 'Frames'))}
          {shapeTiles(shapes.filter((s) => s.category === 'Frames'))}
        </div>
      ),
      count: graphics.filter((g) => g.category === 'Frames').length + shapes.filter((s) => s.category === 'Frames').length,
    },
    { title: 'Illustrations', body: graphicTiles(graphics.filter((g) => g.category === 'Illustrations')), count: graphics.filter((g) => g.category === 'Illustrations').length },
    { title: 'Geometric', body: graphicTiles(graphics.filter((g) => g.category === 'Geometric')), count: graphics.filter((g) => g.category === 'Geometric').length },
    { title: 'Lines', body: shapeTiles(shapes.filter((s) => s.category === 'Lines')), count: shapes.filter((s) => s.category === 'Lines').length },
    {
      title: 'Icons',
      body: (
        <div className="grid grid-cols-5 gap-1.5 px-4">
          {icons.map((icon) => (
            <div key={icon.name} className="group/tile relative">
              <button
                type="button"
                title={`Icon: ${assetTitle(iconAssetId(icon.name), icon.label)}`}
                data-icon={icon.name}
                {...libraryItemProps({ kind: 'icon', name: icon.name })}
                className={`${tileClass} flex aspect-square w-full items-center justify-center text-ink`}
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={icon.d} />
                </svg>
              </button>
              <FavouriteButton id={iconAssetId(icon.name)} name={icon.label} />
            </div>
          ))}
        </div>
      ),
      count: icons.length,
    },
  ];
  const visible = sections.filter((s) => show(s.title) && (s.count > 0 || s.title === category));
  const none = picked ? (category === 'Favourites' ? 'No favourites yet. Hover an item and click its star.' : 'Nothing used yet. Items you add appear here.') : `Nothing matches “${query}”.`;

  return (
    <PanelShell title="Elements" query={query} onQuery={setQuery} placeholder="Search shapes, icons, stickers…">
      <Chips value={category} options={[...CATEGORIES]} onChange={setCategory} />
      <div className="pb-4">
        {visible.map((s) => (
          <section key={s.title} data-element-section={s.title}>
            <Heading>{s.title}</Heading>
            {s.body}
          </section>
        ))}
        {!visible.some((s) => s.title !== 'My assets') && <p className="px-4 pt-3 text-faint">{none}</p>}
      </div>
      <p className="px-4 pb-4 leading-relaxed text-faint">
        Click to add, or drag onto the canvas. Everything here is a vector layer: resize it freely and recolour it in the Shape tab on the right. Icons are from the Lucide set (ISC licence).
      </p>
    </PanelShell>
  );
}
