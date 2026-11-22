import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { EFFECTS, type EffectDef } from '../../../features/effects/effects';
import { useEditorStore, useSelectedLayers } from '../../../stores/editorStore';
import type { ImageLayer } from '../../../types/document';
import { Chips, PanelShell, tileClass } from './shared';

let sample: HTMLCanvasElement | null = null;

/** A small synthetic photo used to preview each effect with the real effect code. */
function sampleImage() {
  if (sample) return sample;
  const c = document.createElement('canvas');
  c.width = c.height = 120;
  const ctx = c.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, 120);
  sky.addColorStop(0, '#2b5c9e');
  sky.addColorStop(0.6, '#f2a65a');
  sky.addColorStop(1, '#f7d08a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 120, 120);
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(82, 52, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#27473d';
  ctx.beginPath();
  ctx.moveTo(0, 120);
  ctx.lineTo(0, 86);
  ctx.lineTo(34, 58);
  ctx.lineTo(62, 88);
  ctx.lineTo(84, 72);
  ctx.lineTo(120, 98);
  ctx.lineTo(120, 120);
  ctx.fill();
  sample = c;
  return c;
}

const previews = new Map<string, string>();

function effectPreview(def: EffectDef) {
  let url = previews.get(def.type);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = c.height = 120;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(sampleImage(), 0, 0);
    def.apply(c, ctx, def.defaultAmount, 7);
    url = c.toDataURL('image/webp', 0.85);
    previews.set(def.type, url);
  }
  return url;
}

function EffectTile({ def, active, disabled, onToggle }: { def: EffectDef; active: boolean; disabled: boolean; onToggle: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSrc(effectPreview(def)), 0);
    return () => clearTimeout(t);
  }, [def]);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      data-effect={def.type}
      title={disabled ? 'Select an image layer first' : active ? `Remove ${def.label}` : `Apply ${def.label}`}
      onClick={onToggle}
      className={`${tileClass} aspect-square disabled:opacity-50 ${active ? '!border-accent' : ''}`}
    >
      {src ? <img src={src} alt={def.label} draggable={false} className="h-full w-full object-cover" /> : <span className="block h-full w-full animate-pulse bg-hover" />}
      <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{def.label}</span>
      {active && (
        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink">
          <Check size={11} />
        </span>
      )}
    </button>
  );
}

export function EffectsPanel() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const images = useSelectedLayers().filter((l): l is ImageLayer => l.type === 'image');
  const categories = useMemo(() => ['All', ...new Set(EFFECTS.map((e) => e.category))], []);
  const q = query.trim().toLowerCase();
  const shown = EFFECTS.filter(
    (e) => (category === 'All' || e.category === category) && (!q || e.label.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)),
  );

  const toggle = (def: EffectDef) => {
    const everyHas = images.every((l) => l.effects.some((e) => e.type === def.type));
    useEditorStore.getState().updateLayers(
      images.map((l) => l.id),
      (l) => {
        const effects = (l as ImageLayer).effects;
        if (everyHas) return { effects: effects.filter((e) => e.type !== def.type) };
        return effects.some((e) => e.type === def.type) ? {} : { effects: [...effects, { type: def.type, amount: def.defaultAmount }] };
      },
    );
  };

  return (
    <PanelShell title="Effects" query={query} onQuery={setQuery} placeholder="Search effects">
      <p className={`mx-3 mt-3 rounded px-2 py-1.5 ${images.length ? 'bg-accent/10 text-accent' : 'bg-raised text-dim'}`}>
        {images.length
          ? `Click an effect to apply it to ${images.length === 1 ? `“${images[0].name}”` : `${images.length} images`}. Adjust intensity in the properties panel.`
          : 'Select an image, texture or overlay layer to apply effects.'}
      </p>
      <Chips value={category} options={categories} onChange={setCategory} />
      <div className="grid grid-cols-3 gap-2 p-3">
        {shown.map((def) => (
          <EffectTile
            key={def.type}
            def={def}
            disabled={!images.length}
            active={images.length > 0 && images.every((l) => l.effects.some((e) => e.type === def.type))}
            onToggle={() => toggle(def)}
          />
        ))}
      </div>
      <p className="px-3 pb-3 text-faint">
        Effects are non-destructive and stack in the order they are added. Effects on text and shapes, plus watercolor / oil-paint filters, are planned for Milestone 2.
      </p>
    </PanelShell>
  );
}
