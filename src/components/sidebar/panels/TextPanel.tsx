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
  /** Shown on a dark tile (light or glowing text). */
  dark?: boolean;
}

const NONE = { glow: null, extrude: null, bevel: null, distress: null };
const GOLD = [
  { offset: 0, color: '#fff3b0' },
  { offset: 0.35, color: '#f0b429' },
  { offset: 0.55, color: '#9a6700' },
  { offset: 0.7, color: '#ffd76a' },
  { offset: 1, color: '#8a5a00' },
];
const CHROME = [
  { offset: 0, color: '#ffffff' },
  { offset: 0.45, color: '#aab4c0' },
  { offset: 0.5, color: '#4a5563' },
  { offset: 0.62, color: '#dfe6ee' },
  { offset: 1, color: '#7f8b99' },
];

const EFFECT_STYLES: StyleDef[] = [
  {
    label: 'Neon',
    preset: 'heading',
    dark: true,
    overrides: {
      text: 'Neon',
      fontFamily: 'Pacifico',
      fontWeight: 400,
      fill: { type: 'solid', color: '#fff0fa' },
      stroke: { color: '#ff2d95', width: 2 },
      effects: { ...NONE, glow: { color: '#ff2d95', size: 0.45, strength: 0.9 } },
    },
  },
  {
    label: 'GOLD',
    preset: 'heading',
    dark: true,
    overrides: {
      text: 'GOLD',
      fontFamily: 'Playfair Display',
      fontWeight: 900,
      letterSpacing: 4,
      fill: { type: 'linear', angle: 90, stops: GOLD },
      effects: { ...NONE, bevel: { depth: 0.6 }, extrude: { color: '#4a2f00', depth: 0.04, angle: 60 } },
    },
  },
  {
    label: 'CHROME',
    preset: 'heading',
    dark: true,
    overrides: {
      text: 'CHROME',
      fontFamily: 'Archivo Black',
      fontWeight: 400,
      fill: { type: 'linear', angle: 90, stops: CHROME },
      stroke: { color: '#20262e', width: 2 },
      effects: { ...NONE, bevel: { depth: 0.75 } },
    },
  },
  {
    label: 'RETRO 3D',
    preset: 'heading',
    overrides: {
      text: 'RETRO 3D',
      fontFamily: 'Anton',
      fontWeight: 400,
      letterSpacing: 2,
      fill: { type: 'solid', color: '#ffd166' },
      stroke: { color: '#1d1e22', width: 4 },
      effects: { ...NONE, extrude: { color: '#ef476f', depth: 0.16, angle: 45 } },
    },
  },
  {
    label: 'STAMPED',
    preset: 'heading',
    overrides: {
      text: 'STAMPED',
      fontFamily: 'Anton',
      fontWeight: 400,
      letterSpacing: 6,
      fill: { type: 'solid', color: '#b3261e' },
      effects: { ...NONE, distress: { amount: 0.45, scale: 0.35, seed: 3 } },
    },
  },
  {
    label: 'FOLDED',
    preset: 'heading',
    overrides: {
      text: 'FOLDED',
      fontFamily: 'Anton',
      fontWeight: 400,
      fill: { type: 'solid', color: '#7a1218' },
      effects: { ...NONE, fold: { position: 0.5, drop: 0.4, spread: 0.3, shade: 0.45 } },
    },
  },
  {
    label: 'Soft glow',
    preset: 'heading',
    dark: true,
    overrides: {
      text: 'Soft glow',
      fontFamily: 'Montserrat',
      fontWeight: 800,
      fill: { type: 'solid', color: '#ffffff' },
      effects: { ...NONE, glow: { color: '#5eead4', size: 0.6, strength: 0.5 } },
    },
  },
];

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
  // The tile is a CSS sketch of the style; the canvas draws the real effect.
  const fx = o.effects;
  const shadows = [
    o.shadow ? `2px 2px 0 ${o.shadow.color}` : '',
    fx?.extrude ? [1, 2, 3].map((k) => `${k}px ${k}px 0 ${fx.extrude!.color}`).join(', ') : '',
    fx?.glow ? `0 0 5px ${fx.glow.color}, 0 0 12px ${fx.glow.color}` : '',
  ].filter(Boolean);
  return (
    <button
      type="button"
      data-text-style={def.label}
      {...libraryItemProps(item)}
      className={`flex h-16 items-center justify-center overflow-hidden rounded-md border border-line px-2 transition-colors hover:border-accent/60 ${def.dark ? 'bg-[#16171b]' : 'bg-[#f4f4f2]'}`}
    >
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
          textShadow: shadows.length ? shadows.join(', ') : undefined,
          opacity: fx?.distress ? 0.82 : undefined,
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
      <div className="space-y-2.5 p-4">
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
      <div className="grid grid-cols-2 gap-2.5 px-4 pb-2">
        {STYLES.map((s) => (
          <StyleTile key={s.label} def={s} />
        ))}
      </div>
      <Heading>Effect styles</Heading>
      <div className="grid grid-cols-2 gap-2.5 px-4 pb-4">
        {EFFECT_STYLES.map((s) => (
          <StyleTile key={s.label} def={s} />
        ))}
      </div>
      <p className="px-4 pb-4 leading-relaxed text-faint">
        Double-click text on the canvas to edit it. With a text selected, the Effects tab on the right can warp it, run it along a curve or a circle, and add glow, 3D depth, a fold, metallic shine or distress. All of it stays editable.
      </p>
    </PanelShell>
  );
}
