import { Plus, X } from 'lucide-react';
import type { Fill, GradientStop } from '../../types/document';
import { fillToCss } from '../../utils/misc';
import { ColorInput, NumberInput, Segmented, SliderRow } from '../ui/controls';

type FillKind = 'none' | Fill['type'];

function convert(fill: Fill | null, kind: FillKind): Fill | null {
  if (kind === 'none') return null;
  const base = fill?.type === 'solid' ? fill.color : (fill?.stops[0]?.color ?? '#3ddc97');
  const stops: GradientStop[] =
    fill && fill.type !== 'solid'
      ? fill.stops
      : [
          { offset: 0, color: base },
          { offset: 1, color: '#6ea8ff' },
        ];
  if (kind === 'solid') return { type: 'solid', color: base };
  if (kind === 'linear') return { type: 'linear', angle: fill?.type === 'linear' ? fill.angle : 90, stops };
  return { type: 'radial', stops };
}

/** Editor for solid, linear-gradient and radial-gradient fills. */
export function FillEditor({
  fill,
  onChange,
  allowNone,
  noneLabel = 'None',
  name,
}: {
  fill: Fill | null;
  onChange: (fill: Fill | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  /** What is being filled, when two fill editors can be on screen at once: "Background" names its controls "Background colour", "Background stop 1 colour"… */
  name?: string;
}) {
  const stopName = (i: number) => `${name ? `${name} stop` : 'Stop'} ${i + 1}`;
  const kind: FillKind = fill?.type ?? 'none';
  const options: { value: FillKind; label: string }[] = [
    ...(allowNone ? [{ value: 'none' as const, label: noneLabel }] : []),
    { value: 'solid', label: 'Solid' },
    { value: 'linear', label: 'Linear' },
    { value: 'radial', label: 'Radial' },
  ];

  const setStops = (stops: GradientStop[]) => {
    if (fill && fill.type !== 'solid') onChange({ ...fill, stops });
  };

  return (
    <div className="space-y-2">
      <Segmented value={kind} options={options} onChange={(k) => k !== kind && onChange(convert(fill, k))} />
      {fill?.type === 'solid' && <ColorInput value={fill.color} onChange={(color) => onChange({ type: 'solid', color })} label={name ? `${name} colour` : 'Fill colour'} />}
      {fill && fill.type !== 'solid' && (
        <>
          <div className="h-4 rounded border border-line" style={{ background: fillToCss({ type: 'linear', angle: 0, stops: fill.stops }) }} />
          {fill.stops.map((stop, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <ColorInput
                value={stop.color}
                label={`${stopName(i)} colour`}
                onChange={(color) => setStops(fill.stops.map((s, j) => (j === i ? { ...s, color } : s)))}
              />
              <NumberInput
                value={Math.round(stop.offset * 100)}
                min={0}
                max={100}
                prefix="%"
                label={`${stopName(i)} position`}
                className="w-14"
                onChange={(v) => setStops(fill.stops.map((s, j) => (j === i ? { ...s, offset: v / 100 } : s)))}
              />
              <button
                type="button"
                title="Remove stop"
                aria-label={`Remove ${stopName(i).toLowerCase()}`}
                disabled={fill.stops.length <= 2}
                onClick={() => setStops(fill.stops.filter((_, j) => j !== i))}
                className="text-faint hover:text-ink disabled:invisible"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setStops([...fill.stops, { offset: 0.5, color: '#ffffff' }])}
            className="flex items-center gap-1 text-dim hover:text-ink"
          >
            <Plus size={12} /> Add colour stop
          </button>
          {fill.type === 'linear' && (
            <SliderRow label="Angle" value={fill.angle} min={0} max={360} onChange={(angle) => onChange({ ...fill, angle })} />
          )}
        </>
      )}
    </div>
  );
}
