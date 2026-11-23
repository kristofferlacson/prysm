import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ChevronDown, Italic, Search, Spline, TextAlignCenter, TextAlignEnd, TextAlignStart, Underline, Upload, X } from 'lucide-react';
import { DEFAULT_TEXT_EFFECTS } from '../../features/text-warp/textEffects';
import { PATH_LABELS, pathChoice, pathFromChoice, type PathChoice } from '../../features/text-warp/textPath';
import { DEFAULT_BEND, identityMesh, isIdentityWarp, meshFromWarp, WARP_LABELS } from '../../features/text-warp/warp';
import { ensureFont, FONT_FILE_TYPES, FONTS, fontStack, getFont, nearestWeight, removeUploadedFont, uploadFont, useUploadedFonts, type FontCategory } from '../../services/fonts';
import { useUiStore } from '../../stores/uiStore';
import { WARP_STYLES, type TextAlign, type TextEffects, type TextLayer, type TextWarp, type WarpStyle } from '../../types/document';
import { ColorInput, IconButton, NumberInput, Row, Section, Select, SliderRow, Switch, TextButton } from '../ui/controls';
import { Popover } from '../ui/Popover';
import { FillEditor } from './FillEditor';
import { FitToShape } from './FitToShape';
import type { Update } from './PropertiesPanel';
import { StrokeSection } from './ShapeProperties';

const CATEGORIES: (FontCategory | 'All')[] = ['All', 'Sans', 'Serif', 'Display', 'Handwriting', 'Decorative', 'Mono', 'Uploaded'];
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
  const fileRef = useRef<HTMLInputElement>(null);
  const uploaded = useUploadedFonts((s) => s.fonts);

  const addFont = async (file: File | undefined) => {
    if (!file) return;
    try {
      const family = await uploadFont(file);
      onPick(family);
      setCategory('Uploaded');
      useUiStore.getState().notify(`Added the font “${family}”. It is stored in this browser.`);
    } catch (err) {
      useUiStore.getState().notify(err instanceof Error ? err.message : 'That font could not be added.');
    }
  };

  useEffect(() => {
    if (!open) return;
    // Previews render each family in its own typeface.
    FONTS.forEach((f) => void ensureFont(f.family));
  }, [open]);

  const fonts = useMemo(
    () =>
      [...FONTS, ...uploaded].filter(
        (f) =>
          (category === 'All' || f.category === category) && f.family.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [query, category, uploaded],
  );

  return (
    <div ref={rootRef}>
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
        <Popover anchor={rootRef} onClose={() => setOpen(false)} align="stretch" testId="font-menu">
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
              <li key={f.family} className="group relative">
                {f.source === 'uploaded' && (
                  <button
                    type="button"
                    title={`Remove the uploaded font ${f.family}`}
                    aria-label={`Remove the uploaded font ${f.family}`}
                    onClick={() => void removeUploadedFont(f.family)}
                    className="absolute right-1 top-1.5 hidden h-5 w-5 items-center justify-center rounded text-faint hover:text-danger group-hover:flex"
                  >
                    <X size={12} />
                  </button>
                )}
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
            {!fonts.length && (
              <li className="px-2 py-3 text-faint">{category === 'Uploaded' && !query ? 'No uploaded fonts yet.' : `No fonts match “${query}”.`}</li>
            )}
          </ul>
          <div className="border-t border-line p-1.5">
            <input
              ref={fileRef}
              data-testid="font-upload-input"
              type="file"
              accept={FONT_FILE_TYPES.join(',')}
              className="hidden"
              onChange={(e) => {
                void addFont(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()} className="flex h-7 w-full items-center justify-center gap-1.5 rounded bg-raised text-ink hover:bg-hover">
              <Upload size={12} /> Upload a font…
            </button>
            <p className="px-1 pt-1.5 text-[10px] leading-snug text-faint">TTF, OTF, WOFF or WOFF2. Only upload fonts you have the right to use.</p>
          </div>
        </Popover>
      )}
    </div>
  );
}

const WARP_OPTIONS: { value: WarpStyle | 'none'; label: string }[] = [
  { value: 'none', label: 'None' },
  ...WARP_STYLES.map((style) => ({ value: style, label: WARP_LABELS[style] })),
];

/** Bends the text into a shape. The text itself stays editable; the warp can be changed or removed at any time. */
function WarpSection({ layer, update }: { layer: TextLayer; update: Update }) {
  const warp = layer.warp;
  const setStyle = (style: WarpStyle | 'none') => {
    if (style === 'none') return update({ warp: null });
    // Set by "Fit text to this shape", which supplies the outline; it cannot be picked bare.
    if (style === 'shape') return;
    if (style === 'custom') {
      // Start from the shape that is already on the canvas rather than flattening the text.
      return update({ path: null, warp: { style, bend: 0, horizontal: 0, vertical: 0, mesh: meshFromWarp(warp, layer.width, layer.height) } });
    }
    const previous = warp && warp.style !== 'custom' && warp.style !== 'shape' ? warp : null;
    update({
      path: null,
      warp: { style, bend: previous?.bend || DEFAULT_BEND, horizontal: previous?.horizontal ?? 0, vertical: previous?.vertical ?? 0 },
    });
  };
  const set = (patch: Partial<TextWarp>, key: string) => warp && update({ warp: { ...warp, ...patch } }, `warp-${key}`);
  const percent = (v: number) => Math.round(v * 100);

  return (
    <Section title="Warp">
      <Row label="Shape">
        <Select
          label="Warp shape"
          value={warp?.style ?? 'none'}
          options={warp?.style === 'shape' ? [...WARP_OPTIONS, { value: 'shape', label: WARP_LABELS.shape }] : WARP_OPTIONS}
          onChange={setStyle}
        />
      </Row>
      {warp?.style === 'shape' && (
        <>
          <p className="leading-relaxed text-ink">The text fills the outline of another layer. Retype it and the new words fill the same shape.</p>
          <TextButton className="w-full" onClick={() => update({ warp: null })}>
            Remove warp
          </TextButton>
        </>
      )}
      {warp && warp.style !== 'custom' && warp.style !== 'shape' && (
        <>
          <SliderRow label="Bend" value={percent(warp.bend)} min={-100} max={100} defaultValue={percent(DEFAULT_BEND)} onChange={(v) => set({ bend: v / 100 }, 'bend')} />
          <SliderRow label="Horizontal" value={percent(warp.horizontal)} min={-100} max={100} defaultValue={0} onChange={(v) => set({ horizontal: v / 100 }, 'horizontal')} />
          <SliderRow label="Vertical" value={percent(warp.vertical)} min={-100} max={100} defaultValue={0} onChange={(v) => set({ vertical: v / 100 }, 'vertical')} />
        </>
      )}
      {warp?.style !== 'custom' && (
        <TextButton className="w-full" onClick={() => setStyle('custom')}>
          <Spline size={13} /> Edit shape on canvas
        </TextButton>
      )}
      {warp?.style === 'custom' && (
        <>
          <p className="leading-relaxed text-ink">
            Drag the points around the text on the canvas.
          </p>
          <p className="leading-relaxed text-faint">
            White squares move a corner. Blue dots bend the edge next to that corner.
          </p>
          <div className="flex gap-1.5">
            <TextButton className="flex-1" disabled={isIdentityWarp(warp)} onClick={() => update({ warp: { ...warp, mesh: identityMesh() } })}>
              Reset shape
            </TextButton>
            <TextButton className="flex-1" onClick={() => update({ warp: null })}>
              Remove warp
            </TextButton>
          </div>
        </>
      )}
      {!warp && <p className="leading-relaxed text-faint">Pick a ready-made shape above, or edit the shape yourself by dragging points around the text. The text stays editable.</p>}
      <FitToShape layer={layer} />
    </Section>
  );
}

const PATH_OPTIONS = (Object.keys(PATH_LABELS) as PathChoice[]).map((value) => ({ value, label: PATH_LABELS[value] }));

/** Sets the text along a line, letter by letter. Unlike a warp, the letters keep their shape. */
function PathSection({ layer, update }: { layer: TextLayer; update: Update }) {
  const choice = pathChoice(layer.path);
  return (
    <Section title="Text on a path">
      <Row label="Path">
        <Select
          label="Text path"
          value={choice}
          options={PATH_OPTIONS}
          // A path and a warp are two ways of shaping the same text; choosing one replaces the other.
          onChange={(next) => update(next === 'none' ? { path: null } : { path: pathFromChoice(next, layer.path), warp: null })}
        />
      </Row>
      {choice === 'curve' && <p className="leading-relaxed text-faint">Drag the points on the canvas. White squares are the ends of the line; blue dots bend it.</p>}
      {(choice === 'circle' || choice === 'circle-bottom') && (
        <p className="leading-relaxed text-faint">The circle is as wide as the text box. Change the Width above or the font size to fit the words around it.</p>
      )}
      {choice === 'none' && <p className="leading-relaxed text-faint">Run the words along a curve or around a circle. Each letter turns to follow the line.</p>}
    </Section>
  );
}

function EffectBlock({ label, on, onToggle, children }: { label: string; on: boolean; onToggle: (on: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <label className="flex min-h-7 cursor-pointer items-center justify-between">
        <span className={on ? 'font-medium text-ink' : 'text-dim'}>{label}</span>
        <Switch label={label} checked={on} onChange={onToggle} />
      </label>
      {on && <div className="space-y-2.5 border-l border-line pl-3">{children}</div>}
    </div>
  );
}

/** Background, glow, 3D block, fold, metallic bevel and distress. Each is a setting on the text, not a change to it. */
function TextEffectsSection({ layer, update }: { layer: TextLayer; update: Update }) {
  const fx = layer.effects;
  const set = <K extends keyof TextEffects>(key: K, value: TextEffects[K], coalesce?: string) =>
    update({ effects: { ...fx, [key]: value } }, coalesce ? `fx-${key}-${coalesce}` : undefined);
  const pct = (v: number) => Math.round(v * 100);
  return (
    <Section title="Text effects">
      <EffectBlock label="Background" on={!!fx.backdrop} onToggle={(on) => set('backdrop', on ? { ...DEFAULT_TEXT_EFFECTS.backdrop } : null)}>
        {fx.backdrop && (
          <>
            <Row label="Colour">
              <ColorInput label="Background colour" value={fx.backdrop.color} onChange={(color) => set('backdrop', { ...fx.backdrop!, color }, 'color')} />
            </Row>
            <SliderRow label="Padding" value={pct(fx.backdrop.padding)} min={0} max={150} onChange={(v) => set('backdrop', { ...fx.backdrop!, padding: v / 100 }, 'padding')} />
            <SliderRow label="Corners" value={pct(fx.backdrop.radius)} min={0} max={100} onChange={(v) => set('backdrop', { ...fx.backdrop!, radius: v / 100 }, 'radius')} />
          </>
        )}
      </EffectBlock>
      <EffectBlock label="Glow" on={!!fx.glow} onToggle={(on) => set('glow', on ? { ...DEFAULT_TEXT_EFFECTS.glow } : null)}>
        {fx.glow && (
          <>
            <Row label="Colour">
              <ColorInput label="Glow colour" value={fx.glow.color} onChange={(color) => set('glow', { ...fx.glow!, color }, 'color')} />
            </Row>
            <SliderRow label="Size" value={pct(fx.glow.size)} min={1} max={100} onChange={(v) => set('glow', { ...fx.glow!, size: v / 100 }, 'size')} />
            <SliderRow label="Strength" value={pct(fx.glow.strength)} min={1} max={100} onChange={(v) => set('glow', { ...fx.glow!, strength: v / 100 }, 'strength')} />
          </>
        )}
      </EffectBlock>
      <EffectBlock label="3D depth" on={!!fx.extrude} onToggle={(on) => set('extrude', on ? { ...DEFAULT_TEXT_EFFECTS.extrude } : null)}>
        {fx.extrude && (
          <>
            <Row label="Colour">
              <ColorInput label="Depth colour" value={fx.extrude.color} onChange={(color) => set('extrude', { ...fx.extrude!, color }, 'color')} />
            </Row>
            <SliderRow label="Depth" value={pct(fx.extrude.depth)} min={1} max={60} onChange={(v) => set('extrude', { ...fx.extrude!, depth: v / 100 }, 'depth')} />
            <SliderRow label="Angle" value={fx.extrude.angle} min={0} max={360} onChange={(angle) => set('extrude', { ...fx.extrude!, angle }, 'angle')} />
          </>
        )}
      </EffectBlock>
      <EffectBlock label="Fold" on={!!fx.fold} onToggle={(on) => set('fold', on ? { ...DEFAULT_TEXT_EFFECTS.fold } : null)}>
        {fx.fold && (
          <>
            <SliderRow label="Cut at" value={pct(fx.fold.position)} min={10} max={90} onChange={(v) => set('fold', { ...fx.fold!, position: v / 100 }, 'position')} />
            <SliderRow label="Drop" value={pct(fx.fold.drop)} min={2} max={150} onChange={(v) => set('fold', { ...fx.fold!, drop: v / 100 }, 'drop')} />
            <SliderRow label="Spread" value={pct(fx.fold.spread)} min={0} max={100} onChange={(v) => set('fold', { ...fx.fold!, spread: v / 100 }, 'spread')} />
            <SliderRow label="Band tone" value={pct(fx.fold.shade)} min={-100} max={100} onChange={(v) => set('fold', { ...fx.fold!, shade: v / 100 }, 'shade')} />
          </>
        )}
      </EffectBlock>
      <EffectBlock label="Metallic shine" on={!!fx.bevel} onToggle={(on) => set('bevel', on ? { ...DEFAULT_TEXT_EFFECTS.bevel } : null)}>
        {fx.bevel && <SliderRow label="Shine" value={pct(fx.bevel.depth)} min={1} max={100} onChange={(v) => set('bevel', { depth: v / 100 }, 'depth')} />}
      </EffectBlock>
      <EffectBlock label="Distress" on={!!fx.distress} onToggle={(on) => set('distress', on ? { ...DEFAULT_TEXT_EFFECTS.distress } : null)}>
        {fx.distress && (
          <>
            <SliderRow label="Wear" value={pct(fx.distress.amount)} min={1} max={100} onChange={(v) => set('distress', { ...fx.distress!, amount: v / 100 }, 'amount')} />
            <SliderRow label="Grain size" value={pct(fx.distress.scale)} min={0} max={100} onChange={(v) => set('distress', { ...fx.distress!, scale: v / 100 }, 'scale')} />
            <TextButton className="w-full" onClick={() => set('distress', { ...fx.distress!, seed: fx.distress!.seed + 1 })}>
              New wear pattern
            </TextButton>
          </>
        )}
      </EffectBlock>
    </Section>
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
          <IconButton label="Vertical text (one letter per line)" active={!!layer.vertical} onClick={() => update({ vertical: !layer.vertical })}>
            <ArrowDownAZ size={15} />
          </IconButton>
        </div>
        <SliderRow label="Letter spacing" value={layer.letterSpacing} min={-10} max={80} step={0.5} defaultValue={0} onChange={(letterSpacing) => update({ letterSpacing }, 'letter-spacing')} />
        <SliderRow label="Line height" value={layer.lineHeight} min={0.6} max={3} step={0.05} defaultValue={1.2} onChange={(lineHeight) => update({ lineHeight }, 'line-height')} />
        <Row label="Content">
          <span className="truncate text-faint">Double-click the text on the canvas to edit it.</span>
        </Row>
      </Section>
      <WarpSection layer={layer} update={update} />
      <PathSection layer={layer} update={update} />
      <Section title="Text colour">
        <FillEditor fill={layer.fill} onChange={(fill) => fill && update({ fill }, 'fill')} />
      </Section>
      <StrokeSection title="Outline" stroke={layer.stroke} max={40} onChange={(stroke, key) => update({ stroke }, key)} />
      <TextEffectsSection layer={layer} update={update} />
    </>
  );
}
