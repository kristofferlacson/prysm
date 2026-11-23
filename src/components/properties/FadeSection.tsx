import { Brush } from 'lucide-react';
import type { CSSProperties } from 'react';
import { DEFAULT_FADE, FADE_GRID } from '../../features/image-editing/fade';
import { clearFadePaint, fadeAlongSelection, removeFadeShape, startFadePainting, stopFadePainting } from '../../features/image-editing/fadeActions';
import { useAreaSelection } from '../../features/selection/selectionStore';
import { useUiStore } from '../../stores/uiStore';
import type { Fade, FadeFrom, ImageLayer } from '../../types/document';
import { Row, Section, SliderRow, Switch, TextButton } from '../ui/controls';
import type { Update } from './PropertiesPanel';

const pct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100);

/** A tiny picture of each part: solid where the image stays, clear where it fades. */
const SWATCH: Record<FadeFrom, string> = {
  'top-left': 'radial-gradient(circle at 0% 0%, transparent 15%, currentColor 95%)',
  top: 'linear-gradient(to bottom, transparent 10%, currentColor 80%)',
  'top-right': 'radial-gradient(circle at 100% 0%, transparent 15%, currentColor 95%)',
  left: 'linear-gradient(to right, transparent 10%, currentColor 80%)',
  around: 'radial-gradient(closest-side, currentColor 35%, transparent 100%)',
  right: 'linear-gradient(to left, transparent 10%, currentColor 80%)',
  'bottom-left': 'radial-gradient(circle at 0% 100%, transparent 15%, currentColor 95%)',
  bottom: 'linear-gradient(to top, transparent 10%, currentColor 80%)',
  'bottom-right': 'radial-gradient(circle at 100% 100%, transparent 15%, currentColor 95%)',
};

/** "the right, the top left corner and a shape" */
function describe(fade: Fade) {
  const parts = FADE_GRID.filter((g) => fade.from.includes(g.from)).map((g) => g.label);
  if (fade.angle !== null) parts.push('a direction');
  if (fade.shape) parts.push('a shape');
  if (fade.paint) parts.push('where you painted');
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Lets an image fade out gradually, so it melts into what is behind it. */
export function FadeSection({ layer, update }: { layer: ImageLayer; update: Update }) {
  const fade = layer.fade ?? null;
  const selected = useAreaSelection((s) => !!s.mask);
  const painting = useUiStore((s) => s.fadePaintLayerId === layer.id);
  const set = (patch: Partial<Fade>, key?: string) => fade && update({ fade: { ...fade, ...patch } }, key && `fade-${key}`);
  const toggle = (from: FadeFrom) => fade && set({ from: fade.from.includes(from) ? fade.from.filter((f) => f !== from) : [...fade.from, from] });
  const parts = fade && describe(fade);
  return (
    <Section
      key={fade ? 'on' : 'off'}
      title="Fade"
      defaultOpen={!!fade}
      action={<Switch label="Fade" checked={!!fade} onChange={(on) => update({ fade: on ? DEFAULT_FADE : null })} />}
    >
      {fade ? (
        <>
          <div className="flex items-start gap-3">
            <div className="grid shrink-0 grid-cols-3 gap-1" role="group" aria-label="Fade from" data-testid="fade-from">
              {FADE_GRID.map((g) => {
                const on = fade.from.includes(g.from);
                return (
                  <button
                    key={g.from}
                    type="button"
                    aria-pressed={on}
                    aria-label={`Fade from ${g.label}`}
                    title={`Fade from ${g.label}`}
                    onClick={() => toggle(g.from)}
                    className={`flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
                      on ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-raised text-dim hover:bg-hover hover:text-ink'
                    }`}
                  >
                    <span className="h-5 w-5 rounded-[3px]" style={{ background: SWATCH[g.from] } as CSSProperties} />
                  </button>
                );
              })}
            </div>
            <p className="min-w-0 leading-relaxed text-dim" data-testid="fade-summary">
              {parts ? (
                <>
                  Fades from <span className="text-ink">{parts}</span>. Press a side, a corner or the middle to add or remove it.
                </>
              ) : (
                'Choose where the image fades from: press a side, a corner, or the middle for all round.'
              )}
            </p>
          </div>

          <Row label="Any direction">
            <Switch label="Fade towards any direction" checked={fade.angle !== null} onChange={(on) => set({ angle: on ? 45 : null })} />
            <span className="text-faint">A straight fade at an angle you set</span>
          </Row>
          {fade.angle !== null && <SliderRow label="Direction" value={Math.round(fade.angle)} min={0} max={359} onChange={(angle) => set({ angle }, 'angle')} />}

          <div className="text-dim">Your own shape</div>
          <div className={`grid gap-1.5 ${fade.shape ? 'grid-cols-2' : ''}`} data-testid="fade-shape">
            <TextButton className="!px-1" onClick={() => fadeAlongSelection(layer.id)}>
              Use the selection
            </TextButton>
            {fade.shape && (
              <TextButton className="!px-1" onClick={() => removeFadeShape(layer.id)}>
                Remove shape
              </TextButton>
            )}
          </div>
          <p className="leading-relaxed text-faint" data-testid="fade-shape-hint">
            {fade.shape
              ? 'The image shows inside your shape and fades at its outline. The shape stays with the layer.'
              : selected
                ? 'The image will show inside the selected area and fade at its outline.'
                : 'To fade along your own shape, draw it over the image with a selection tool (marquee, lasso, magic wand), then press “Use the selection”.'}
          </p>

          <div className="text-dim">Paint it yourself</div>
          <div className={`grid gap-1.5 ${fade.paint ? 'grid-cols-2' : ''}`} data-testid="fade-paint">
            <TextButton className={`!px-1 ${painting ? '!bg-accent/15 !text-accent' : ''}`} onClick={() => (painting ? stopFadePainting() : startFadePainting(layer.id))}>
              <Brush size={13} /> {painting ? 'Done painting' : 'Paint the fade'}
            </TextButton>
            {fade.paint && (
              <TextButton className="!px-1" onClick={() => clearFadePaint(layer.id)}>
                Clear painting
              </TextButton>
            )}
          </div>
          <p className="leading-relaxed text-faint" data-testid="fade-paint-hint">
            {painting
              ? 'Brush over the parts that should fade; the eraser, or holding Alt, brings them back. Size, Hardness and Opacity are in the bar above the canvas: a soft brush at a low opacity builds the fade up a little with every stroke.'
              : 'Brush over the image to choose exactly which parts fade, and how much.'}
          </p>

          <SliderRow label="Begins at" value={pct(fade.start)} min={0} max={98} defaultValue={pct(DEFAULT_FADE.start)} onChange={(v) => set({ start: v / 100, reach: Math.max(fade.reach, v / 100 + 0.02) }, 'start')} />
          <SliderRow label="Reaches to" value={pct(fade.reach)} min={2} max={100} defaultValue={pct(DEFAULT_FADE.reach)} onChange={(v) => set({ reach: v / 100, start: Math.min(fade.start, v / 100 - 0.02) }, 'reach')} />
          <SliderRow label="Strength" value={pct(fade.strength)} min={0} max={100} defaultValue={100} onChange={(v) => set({ strength: v / 100 }, 'strength')} />
          <Row label="Reverse">
            <Switch label="Reverse the fade" checked={fade.invert} onChange={(invert) => set({ invert })} />
            <span className="text-faint">Fade what was kept instead</span>
          </Row>
          <p className="leading-relaxed text-faint">
            Measured inwards from each side, corner or outline: the image is fully faded up to “Begins at” and untouched beyond “Reaches to” (painting is not
            affected by these two). Strength sets how transparent the faded part gets, from a light softening to nothing left.
          </p>
        </>
      ) : (
        <>
          <p className="leading-relaxed text-dim">
            Makes the image gradually transparent from any sides or corners, all round, along a shape you draw, or wherever you brush over it, so it blends softly
            into whatever is behind it.
          </p>
          <TextButton className="w-full" onClick={() => startFadePainting(layer.id)}>
            <Brush size={13} /> Paint the fade
          </TextButton>
        </>
      )}
    </Section>
  );
}
