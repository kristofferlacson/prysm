import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Italic, Search, TextAlignCenter, TextAlignEnd, TextAlignStart, Underline } from 'lucide-react';
import { ensureFont, FONTS, fontStack, getFont, nearestWeight, type FontCategory } from '../../services/fonts';
import type { TextAlign, TextLayer } from '../../types/document';
import { IconButton, NumberInput, Row, Section, Select, SliderRow } from '../ui/controls';
import { FillEditor } from './FillEditor';
import type { Update } from './PropertiesPanel';
import { StrokeSection } from './ShapeProperties';

const CATEGORIES: (FontCategory | 'All')[] = ['All', 'Sans', 'Serif', 'Display', 'Handwriting', 'Mono'];
const WEIGHT_NAMES: Record<number, string> = {
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

function FontPicker({ value, onPick }: { value: string; onPick: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | 'All'>('All');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Previews render each family in its own typeface.
    FONTS.forEach((f) => void ensureFont(f.family));
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const fonts = useMemo(
    () =>
      FONTS.filter(
        (f) =>
          (category === 'All' || f.category === category) && f.family.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, category],
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Font family"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-7 w-full items-center justify-between rounded bg-raised px-2 text-left text-[13px] hover:bg-hover"
        style={{ fontFamily: fontStack(value) }}
      >
        <span className="truncate">{value}</span>
        <ChevronDown size={13} className="shrink-0 text-dim" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-8 z-30 rounded border border-line bg-panel shadow-xl shadow-black/50">
          <label className="flex h-8 items-center gap-1.5 border-b border-line px-2">
            <Search size={12} className="text-faint" />
            <input
              autoFocus
              aria-label="Search fonts"
              placeholder="Search fonts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent outline-none placeholder:text-faint"
            />
          </label>
          <div className="flex flex-wrap gap-1 border-b border-line p-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded px-1.5 py-0.5 text-[11px] ${c === category ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-hover'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {fonts.map((f) => (
              <li key={f.family}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(f.family);
                    setOpen(false);
                  }}
                  className={`flex h-8 w-full items-center px-2 text-left text-[15px] hover:bg-hover ${
                    f.family === value ? 'text-accent' : 'text-ink'
                  }`}
                  style={{ fontFamily: fontStack(f.family) }}
                >
                  {f.family}
                </button>
              </li>
            ))}
            {!fonts.length && <li className="px-2 py-3 text-faint">No fonts match “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TextProperties({ layer, update }: { layer: TextLayer; update: Update }) {
  const weights = getFont(layer.fontFamily)?.weights ?? [400, 700];
  return (
    <>
      <Section title="Typography">
        <FontPicker
          value={layer.fontFamily}
          onPick={(fontFamily) => update({ fontFamily, fontWeight: nearestWeight(fontFamily, layer.fontWeight) })}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <NumberInput prefix="Size" label="Font size" value={layer.fontSize} min={1} max={2000} onChange={(fontSize) => update({ fontSize }, 'font-size')} />
          <Select
            label="Font weight"
            value={layer.fontWeight}
            options={weights.map((w) => ({ value: w, label: WEIGHT_NAMES[w] ?? String(w) }))}
            onChange={(fontWeight) => update({ fontWeight })}
          />
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Align left" active={layer.align === 'left'} onClick={() => update({ align: 'left' as TextAlign })}>
            <TextAlignStart size={15} />
          </IconButton>
          <IconButton label="Align centre" active={layer.align === 'center'} onClick={() => update({ align: 'center' as TextAlign })}>
            <TextAlignCenter size={15} />
          </IconButton>
          <IconButton label="Align right" active={layer.align === 'right'} onClick={() => update({ align: 'right' as TextAlign })}>
            <TextAlignEnd size={15} />
          </IconButton>
          <span className="mx-1 h-4 w-px bg-line" />
          <IconButton label="Italic" active={layer.italic} onClick={() => update({ italic: !layer.italic })}>
            <Italic size={15} />
          </IconButton>
          <IconButton label="Underline" active={layer.underline} onClick={() => update({ underline: !layer.underline })}>
            <Underline size={15} />
          </IconButton>
        </div>
        <SliderRow label="Letter spacing" value={layer.letterSpacing} min={-10} max={80} step={0.5} defaultValue={0} onChange={(letterSpacing) => update({ letterSpacing }, 'letter-spacing')} />
        <SliderRow label="Line height" value={layer.lineHeight} min={0.6} max={3} step={0.05} defaultValue={1.2} onChange={(lineHeight) => update({ lineHeight }, 'line-height')} />
        <Row label="Content">
          <span className="truncate text-faint">Double-click the text on the canvas to edit it.</span>
        </Row>
      </Section>
      <Section title="Text colour">
        <FillEditor fill={layer.fill} onChange={(fill) => fill && update({ fill }, 'fill')} />
      </Section>
      <StrokeSection title="Outline" stroke={layer.stroke} max={40} onChange={(stroke, key) => update({ stroke }, key)} />
    </>
  );
}
