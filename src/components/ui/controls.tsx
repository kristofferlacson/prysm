import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { ChevronDown, ChevronRight, CircleHelp, Pipette, RotateCcw } from 'lucide-react';
import { GUIDE_MAP, SECTION_HELP } from '../../features/guide/guide';
import { rememberColor, useRecentColors } from '../../stores/colorStore';
import { useUiStore } from '../../stores/uiStore';
import { hsvToRgb, PALETTE, rgbToHex, rgbToHsv } from '../../utils/color';
import { openGuide } from '../../stores/uiStore';
import { clamp, round } from '../../utils/geometry';
import { hexToRgb } from '../../utils/misc';
import { Popover, windowBox } from './Popover';

/** Form controls shared by the panels. */

export function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
  className = '',
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 ${
        active ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-hover hover:text-ink disabled:hover:bg-transparent'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** A small "?" that opens the guide at the entry explaining this part of the interface. */
export function HelpLink({ topic }: { topic: string }) {
  const entry = GUIDE_MAP.get(topic);
  if (!entry) return null;
  return (
    <button
      type="button"
      data-help={topic}
      aria-label="Open the guide for this"
      title={`How to: ${entry.title}`}
      onClick={() => openGuide(topic)}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink"
    >
      <CircleHelp size={12} />
    </button>
  );
}

/**
 * Decides which sections are shown: the right-hand panel sets it to the sections of its current
 * tab. Null (the default) shows every section.
 */
export const SectionFilter = createContext<((title: string) => boolean) | null>(null);

/** Shows its content wherever the section with this title is shown (for things that sit beside a section, not in one). */
export function WithSection({ title, children }: { title: string; children: ReactNode }) {
  const filter = useContext(SectionFilter);
  return filter && !filter(title) ? null : <>{children}</>;
}

/** The request to reveal a section that was acted on last, so each one is acted on once. */
let revealed = 0;

export function Section({
  title,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const filter = useContext(SectionFilter);
  const reveal = useUiStore((s) => s.reveal);
  const ref = useRef<HTMLElement>(null);
  const shown = !filter || filter(title);

  // Asked to be brought into view (see revealSection): unfold, scroll there, and flash what was asked for.
  useEffect(() => {
    if (!shown || !reveal || reveal.section !== title || revealed === reveal.n || Date.now() - reveal.at > 1500) return;
    revealed = reveal.n;
    setOpen(true);
    const { item, n } = reveal;
    window.setTimeout(() => {
      const section = ref.current;
      if (!section) return;
      const entry = item ? section.querySelector<HTMLElement>(`[data-reveal="${CSS.escape(item)}"]`) : null;
      const target = entry ?? section;
      target.scrollIntoView({ block: entry ? 'center' : 'start', behavior: 'smooth' });
      target.dataset.revealed = String(n);
      target.classList.remove('reveal-flash');
      // Restart the animation when the same thing is revealed twice in a row.
      void target.offsetWidth;
      target.classList.add('reveal-flash');
    }, 60);
  }, [reveal, title, shown]);

  if (!shown) return null;
  return (
    <section ref={ref} data-section={title} className="border-b border-line">
      <div className="flex h-10 items-center pr-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex h-full flex-1 items-center gap-1.5 pl-3 text-left text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-ink"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {SECTION_HELP[title] && <HelpLink topic={SECTION_HELP[title]} />}
        {action}
      </div>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2.5">
      <span className="w-[88px] shrink-0 truncate text-dim">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  prefix,
  label,
  disabled,
  className = '',
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const v = parseFloat(text);
    if (!Number.isNaN(v)) onChange(clamp(v, min, max));
    setDraft(null);
  };
  return (
    <label
      className={`flex h-7 min-w-0 items-center rounded bg-raised px-2 focus-within:outline focus-within:outline-1 focus-within:outline-accent ${
        disabled ? 'opacity-50' : ''
      } ${className}`}
    >
      {prefix && <span className="mr-1 text-[10px] text-faint">{prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label ?? prefix}
        disabled={disabled}
        value={draft ?? String(round(value, 2))}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => draft !== null && commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            onChange(clamp(round(value + dir * step * (e.shiftKey ? 10 : 1), 4), min, max));
            setDraft(null);
          }
        }}
        className="w-full min-w-0 bg-transparent text-ink outline-none"
      />
    </label>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (v: number) => void;
}) {
  const changed = defaultValue !== undefined && value !== defaultValue;
  return (
    <div className="flex min-h-7 items-center gap-2.5">
      <span className={`w-[88px] shrink-0 truncate ${changed ? 'text-ink' : 'text-dim'}`}>{label}</span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        className="min-w-0 flex-1"
      />
      <NumberInput value={value} onChange={onChange} min={min} max={max} step={step} label={`${label} value`} className="w-[52px]" />
      {defaultValue !== undefined && (
        <button
          type="button"
          title={`Reset ${label.toLowerCase()}`}
          aria-label={`Reset ${label.toLowerCase()}`}
          disabled={!changed}
          onClick={() => onChange(defaultValue)}
          className="text-faint hover:text-ink disabled:invisible"
        >
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

interface EyeDropperApi {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}

/** Where the picker stands: hue, saturation and brightness, and the colour they make. */
interface Picked {
  h: number;
  s: number;
  v: number;
  hex: string;
}

/** Greys and black have no hue of their own, so the slider keeps the one it had. */
function pickedFrom(hex: string, hue = 0): Picked {
  const [h, s, v] = rgbToHsv(...hexToRgb(hex));
  return { h: s && v ? h : hue, s, v, hex };
}

/** Reports where in an element the pointer is, 0–1 on each axis, for as long as it is held down. */
function track(scale: number, onMove: (x: number, y: number) => void) {
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const box = windowBox(e.currentTarget, scale);
    onMove(clamp((e.clientX - box.left) / (box.right - box.left), 0, 1), clamp((e.clientY - box.top) / (box.bottom - box.top), 0, 1));
  };
  return {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      at(e);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
    },
  };
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** Arrow keys move a picker handle; they are kept from the editor, where they would nudge the layer. */
function arrows(onStep: (dx: number, dy: number) => void) {
  return (e: KeyboardEvent) => {
    const step = ARROWS[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.shiftKey ? 5 : 1;
    onStep(step[0] * k, step[1] * k);
  };
}

const HANDLE = 'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]';
const HEADING = 'pb-1 text-[10px] font-semibold uppercase tracking-wide text-dim';

/**
 * The colour picker for one colour control: a square of every shade of the chosen hue, a hue
 * slider, RGB values, a screen eyedropper, a palette of ready-made colours and the recent ones.
 */
function ColorTools({
  anchor,
  value,
  label,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLElement | null>;
  value: string;
  label: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const scale = useUiStore((s) => s.uiScale);
  const recent = useRecentColors((s) => s.colors);
  const current = (HEX.test(value) ? value : '#000000').toLowerCase();
  const [picked, setPicked] = useState(() => pickedFrom(current));
  // The colour was changed somewhere else (hex field, a swatch, undo): the handles follow it.
  if (picked.hex !== current) setPicked(pickedFrom(current, picked.h));
  const [r, g, b] = hexToRgb(current);
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperApi }).EyeDropper;

  const move = (h: number, s: number, v: number) => {
    const hex = rgbToHex(...hsvToRgb(h, s, v));
    setPicked({ h, s, v, hex });
    if (hex !== current) onPick(hex);
  };
  const channel = (name: string, v: number, set: (n: number) => string) => (
    <NumberInput prefix={name[0].toUpperCase()} label={`${label} ${name}`} value={v} min={0} max={255} onChange={(n) => onPick(set(n))} />
  );
  const swatch = (c: string, recentOne: boolean) => (
    <button
      key={c}
      type="button"
      {...(recentOne ? { 'data-recent-color': c } : { 'data-swatch': c })}
      title={c.toUpperCase()}
      aria-label={`Use ${c}`}
      onClick={() => onPick(c)}
      className={`aspect-square rounded-sm border ${c === current ? 'border-accent outline outline-1 outline-accent' : 'border-line hover:border-ink'}`}
      style={{ background: c }}
    />
  );
  const pure = `hsl(${picked.h} 100% 50%)`;

  return (
    <Popover anchor={anchor} onClose={onClose} testId="color-tools" className="w-60 space-y-2.5 p-2.5">
      <div
        role="slider"
        tabIndex={0}
        data-testid="color-square"
        aria-label={`${label} saturation and brightness`}
        aria-valuenow={Math.round(picked.s * 100)}
        aria-valuetext={`Saturation ${Math.round(picked.s * 100)}%, brightness ${Math.round(picked.v * 100)}%`}
        className="relative h-32 cursor-crosshair touch-none rounded"
        style={{ backgroundColor: pure, backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)' }}
        {...track(scale, (x, y) => move(picked.h, x, 1 - y))}
        onKeyDown={arrows((dx, dy) => move(picked.h, clamp(picked.s + dx / 50, 0, 1), clamp(picked.v + dy / 50, 0, 1)))}
      >
        <span className={`${HANDLE} h-3.5 w-3.5`} style={{ left: `${picked.s * 100}%`, top: `${(1 - picked.v) * 100}%`, background: current }} />
      </div>
      <div
        role="slider"
        tabIndex={0}
        data-testid="color-hue"
        aria-label={`${label} hue`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(picked.h)}
        className="relative mx-1.5 h-3 cursor-pointer touch-none rounded-full"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
        {...track(scale, (x) => move(x * 360, picked.s, picked.v))}
        onKeyDown={arrows((dx, dy) => move(clamp(picked.h + (dx + dy) * 2, 0, 360), picked.s, picked.v))}
      >
        <span className={`${HANDLE} top-1/2 h-4 w-4`} style={{ left: `${picked.h / 3.6}%`, background: pure }} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {channel('red', r, (n) => rgbToHex(n, g, b))}
        {channel('green', g, (n) => rgbToHex(r, n, b))}
        {channel('blue', b, (n) => rgbToHex(r, g, n))}
      </div>
      {EyeDropper && (
        <button
          type="button"
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded bg-raised text-ink hover:bg-hover"
          onClick={async () => {
            try {
              onPick((await new EyeDropper().open()).sRGBHex.toLowerCase());
            } catch {
              // Cancelled with Escape.
            }
          }}
        >
          <Pipette size={12} /> Pick a colour from the screen
        </button>
      )}
      <div>
        <div className={HEADING}>Colours</div>
        <div data-testid="color-palette" className="grid grid-cols-10 gap-1">
          {PALETTE.map((c) => swatch(c, false))}
        </div>
      </div>
      <div>
        <div className={HEADING}>Recent colours</div>
        {recent.length ? <div className="grid grid-cols-10 gap-1">{recent.map((c) => swatch(c, true))}</div> : <p className="text-faint">Colours you choose appear here.</p>}
      </div>
    </Popover>
  );
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [tools, setTools] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const name = label ?? 'Colour';
  const pick = (v: string) => {
    onChange(v);
    rememberColor(v);
  };
  const commit = (text: string) => {
    let v = text.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    if (HEX.test(v)) pick(v.toLowerCase());
    setDraft(null);
  };
  return (
    <div ref={rootRef} className="flex min-w-0 flex-1 items-center gap-1.5">
      <button
        type="button"
        title={`${name}: open the colour picker`}
        aria-label={name}
        aria-expanded={tools}
        onClick={() => setTools(!tools)}
        className="h-7 w-7 shrink-0 rounded border border-line"
        style={{ background: HEX.test(value) ? value : '#000000' }}
      />
      <input
        type="text"
        aria-label={`${name} hex`}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== null && commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          }
        }}
        className="h-7 w-full min-w-0 rounded bg-raised px-2 uppercase text-ink outline-none focus:outline focus:outline-1 focus:outline-accent"
      />
      <button
        type="button"
        title={`${name}: colour picker, ready-made colours, eyedropper`}
        aria-label={`More options for ${name.toLowerCase()}`}
        aria-expanded={tools}
        onClick={() => setTools(!tools)}
        className={`flex h-7 w-4 shrink-0 items-center justify-center rounded ${tools ? 'text-accent' : 'text-faint hover:text-ink'}`}
      >
        <ChevronDown size={12} />
      </button>
      {tools && <ColorTools anchor={rootRef} value={value} label={name} onPick={pick} onClose={() => setTools(false)} />}
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={String(value)}
      onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}
      className="h-7 w-full min-w-0 rounded bg-raised px-1.5 text-ink outline-none focus:outline focus:outline-1 focus:outline-accent"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-full rounded bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-6 flex-1 rounded-sm text-[11px] ${
            o.value === value ? 'bg-hover text-ink' : 'text-dim hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-hover'}`}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? 'left-3.5' : 'left-0.5'}`}
      />
    </button>
  );
}

export function TextButton({
  children,
  onClick,
  disabled,
  primary,
  label,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  /** Names the button when it may be showing only an icon. */
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors disabled:opacity-40 ${
        primary ? 'bg-accent text-accent-ink hover:brightness-110' : 'bg-raised text-ink hover:bg-hover'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Honest marker for functionality that is planned but not built. */
export function NotImplemented({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="m-3 rounded border border-dashed border-line p-3 text-dim">
      <div className="mb-1 flex items-center gap-2 font-semibold text-ink">
        {title}
        <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-dim">
          Not implemented
        </span>
      </div>
      <div className="space-y-1.5 leading-relaxed">{children}</div>
    </div>
  );
}
