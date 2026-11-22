import { useEffect } from 'react';
import type { TextPreset } from '../../../features/document/factory';
import type { LibraryItem } from '../../../features/library/insert';
import { ensureFont, fontStack } from '../../../services/fonts';
import type { TextLayer } from '../../../types/document';
import { fillToCss } from '../../../utils/misc';
import { Heading, libraryItemProps, PanelShell, tileClass } from './shared';

const BASICS: { preset: TextPreset; label: string; className: string }[] = [
  { preset: 'heading', label: 'Add a heading', className: 'text-[20px] font-extrabold' },
  { preset: 'subheading', label: 'Add a subheading', className: 'text-[15px] font-semibold' },
  { preset: 'body', label: 'Add a little bit of body text', className: 'text-[12px]' },
];

interface StyleDef {
  label: string;
  preset: TextPreset;
  overrides: Partial<TextLayer>;
}

const STYLES: StyleDef[] = [
  { label: 'BIG NEWS', preset: 'heading', overrides: { text: 'BIG NEWS', fontFamily: 'Anton', fontWeight: 400, letterSpacing: 2 } },
  { label: 'Elegant serif', preset: 'heading', overrides: { text: 'Elegant serif', fontFamily: 'Playfair Display', fontWeight: 700, italic: true } },
  { label: 'Handwritten note', preset: 'heading', overrides: { text: 'Handwritten note', fontFamily: 'Caveat', fontWeight: 700 } },
  { label: 'MONO LABEL', preset: 'subheading', overrides: { text: 'MONO LABEL', fontFamily: 'Space Mono', fontWeight: 700, letterSpacing: 8 } },
  {
    label: 'Gradient',
    preset: 'heading',
    overrides: {
      text: 'Gradient',
      fontFamily: 'Montserrat',
      fontWeight: 900,
      fill: { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ff5e62' }, { offset: 1, color: '#ffb347' }] },
    },
  },
  {
    label: 'OUTLINE',
    preset: 'heading',
    overrides: { text: 'OUTLINE', fontFamily: 'Archivo Black', fontWeight: 400, fill: { type: 'solid', color: '#ffffff' }, stroke: { color: '#1d1e22', width: 6 } },
  },
  {
    label: 'Shadow pop',
    preset: 'heading',
    overrides: {
      text: 'Shadow pop',
      fontFamily: 'Poppins',
      fontWeight: 800,
      fill: { type: 'solid', color: '#ffd166' },
      shadow: { color: '#ef476f', blur: 0, offsetX: 6, offsetY: 6, opacity: 1 },
    },
  },
  { label: 'Retro script', preset: 'heading', overrides: { text: 'Retro script', fontFamily: 'Pacifico', fontWeight: 400, fill: { type: 'solid', color: '#e4572e' } } },
];

function StyleTile({ def }: { def: StyleDef }) {
  const o = def.overrides;
  useEffect(() => {
    if (o.fontFamily) void ensureFont(o.fontFamily, o.fontWeight);
  }, [o.fontFamily, o.fontWeight]);
  const item: LibraryItem = { kind: 'text', preset: def.preset, overrides: { ...o, name: def.label } };
  const gradient = o.fill && o.fill.type !== 'solid';
  return (
    <button type="button" {...libraryItemProps(item)} className="flex h-16 items-center justify-center overflow-hidden rounded border border-line bg-[#f4f4f2] px-2 transition-colors hover:border-accent/60">
      <span
        className="truncate text-[19px] leading-none"
        style={{
          fontFamily: fontStack(o.fontFamily ?? 'Inter'),
          fontWeight: o.fontWeight,
          fontStyle: o.italic ? 'italic' : 'normal',
          letterSpacing: o.letterSpacing ? o.letterSpacing / 3 : undefined,
          color: gradient ? 'transparent' : o.fill?.type === 'solid' ? o.fill.color : '#1d1e22',
          backgroundImage: gradient ? fillToCss(o.fill!) : undefined,
          backgroundClip: gradient ? 'text' : undefined,
          WebkitBackgroundClip: gradient ? 'text' : undefined,
          WebkitTextStroke: o.stroke ? `1.5px ${o.stroke.color}` : undefined,
          textShadow: o.shadow ? `2px 2px 0 ${o.shadow.color}` : undefined,
        }}
      >
        {def.label}
      </span>
    </button>
  );
}

export function TextPanel() {
  return (
    <PanelShell title="Text">
      <div className="space-y-2 p-3">
        {BASICS.map((b) => (
          <button
            key={b.preset}
            type="button"
            {...libraryItemProps({ kind: 'text', preset: b.preset })}
            className={`${tileClass} block w-full px-3 py-2.5 ${b.className}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      <Heading>Text styles</Heading>
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        {STYLES.map((s) => (
          <StyleTile key={s.label} def={s} />
        ))}
      </div>
      <p className="px-3 pb-3 text-faint">
        Double-click text on the canvas to edit it. Curved text, text on a path and warping are planned for Milestone 2.
      </p>
    </PanelShell>
  );
}
