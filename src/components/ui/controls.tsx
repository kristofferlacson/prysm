import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { clamp, round } from '../../utils/geometry';

/** Small, dense form controls shared by the panels. */

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
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-30 ${
        active ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-hover hover:text-ink disabled:hover:bg-transparent'
      } ${className}`}
    >
      {children}
    </button>
  );
}

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
  return (
    <section className="border-b border-line">
      <div className="flex h-8 items-center pr-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex h-full flex-1 items-center gap-1 pl-2 text-left text-[11px] font-semibold uppercase tracking-wide text-dim hover:text-ink"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center gap-2">
      <span className="w-[72px] shrink-0 truncate text-dim">{label}</span>
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
      className={`flex h-6 min-w-0 items-center rounded bg-raised px-1.5 focus-within:outline focus-within:outline-1 focus-within:outline-accent ${
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
    <div className="flex min-h-6 items-center gap-2">
      <span className={`w-[72px] shrink-0 truncate ${changed ? 'text-ink' : 'text-dim'}`}>{label}</span>
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
      <NumberInput value={value} onChange={onChange} min={min} max={max} step={step} label={`${label} value`} className="w-12" />
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

export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    let v = text.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    if (HEX.test(v)) onChange(v.toLowerCase());
    setDraft(null);
  };
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="h-6 w-6 shrink-0 overflow-hidden rounded border border-line">
        <input
          type="color"
          aria-label={label ?? 'Colour'}
          value={HEX.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
      <input
        type="text"
        aria-label={`${label ?? 'Colour'} hex`}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== null && commit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          }
        }}
        className="h-6 w-full min-w-0 rounded bg-raised px-1.5 uppercase text-ink outline-none focus:outline focus:outline-1 focus:outline-accent"
      />
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
      className="h-6 w-full min-w-0 rounded bg-raised px-1 text-ink outline-none focus:outline focus:outline-1 focus:outline-accent"
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
          className={`h-5 flex-1 rounded-sm text-[11px] ${
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
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 items-center justify-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors disabled:opacity-40 ${
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
