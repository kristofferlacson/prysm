import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { createShape } from '../../../features/document/factory';
import type { LibraryItem } from '../../../features/library/insert';
import type { ShapeKind, ShapeLayer } from '../../../types/document';
import { isOpenShape, traceShape } from '../../canvas/konvaProps';
import { NotImplemented } from '../../ui/controls';
import { Chips, libraryItemProps, PanelShell, tileClass } from './shared';

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

const CATEGORIES = ['All', 'Shapes', 'Lines', 'Frames'] as const;

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

export function ElementsPanel() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All');
  const items = useMemo(
    () =>
      ELEMENTS.filter(
        (e) => (category === 'All' || e.category === category) && e.label.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, category],
  );
  return (
    <PanelShell title="Elements" query={query} onQuery={setQuery} placeholder="Search elements">
      <Chips value={category} options={[...CATEGORIES]} onChange={setCategory} />
      <div className="grid grid-cols-3 gap-2 p-3">
        {items.map((def) => {
          const item: LibraryItem = { kind: 'shape', shape: def.shape, overrides: def.overrides };
          return (
            <button key={def.label} type="button" title={def.label} {...libraryItemProps(item)} className={`${tileClass} flex aspect-square items-center justify-center`}>
              <ShapePreview def={def} />
            </button>
          );
        })}
      </div>
      {!items.length && <p className="px-3 text-faint">No elements match “{query}”.</p>}
      <NotImplemented title="Icons, stickers & illustrations">
        <p>Needs a licensed SVG asset library and an SVG layer type. Planned for Milestone 2 alongside SVG support.</p>
      </NotImplemented>
    </PanelShell>
  );
}
