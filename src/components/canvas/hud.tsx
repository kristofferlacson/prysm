import { NumberInput } from '../ui/controls';

/** Small controls for the bars that float over the canvas. */

export const HUD_BAR = 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-panel/95 px-2.5 py-1.5 shadow-lg shadow-black/40';

export function HudField({ label, value, min, max, onChange, wide }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; wide?: boolean }) {
  return (
    <label className="flex items-center gap-1.5 text-dim">
      {label}
      <input type="range" aria-label={`${label} slider`} min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className={wide ? 'w-24' : 'w-14'} />
      <NumberInput label={label} value={value} min={min} max={max} onChange={onChange} className="w-11" />
    </label>
  );
}
