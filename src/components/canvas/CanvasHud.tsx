import { Brush, Eraser, Eye, EyeOff, Layers2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { findLayer } from '../../features/document/operations';
import { setMaskEditing } from '../../features/masks/maskActions';
import { resolvePaintTarget, type PaintTarget } from '../../features/paint/paintController';
import { useEditorStore } from '../../stores/editorStore';
import { useToolStore, type BrushSettings } from '../../stores/toolStore';
import { isPaintTool, useUiStore } from '../../stores/uiStore';
import { ColorInput, NumberInput, Segmented } from '../ui/controls';

function Field({
  label,
  value,
  min,
  max,
  onChange,
  wide,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  wide?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5 text-dim">
      {label}
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={wide ? 'w-24' : 'w-14'}
      />
      <NumberInput label={label} value={value} min={min} max={max} onChange={onChange} className="w-11" />
    </label>
  );
}

function targetLabel(target: PaintTarget) {
  switch (target.kind) {
    case 'mask':
      return `Mask of “${target.layer.name}”`;
    case 'paint':
      return `“${target.layer.name}”`;
    case 'new-paint':
      return 'A new paint layer';
    case 'auto-mask':
      return `New mask on “${target.layer.name}”`;
    case 'none':
      return target.reason;
  }
}

/** Brush / eraser settings, shown while a paint tool is active. Always states what a stroke will edit. */
function ToolOptions() {
  const tool = useUiStore((s) => s.tool) as 'brush' | 'eraser';
  const { brush, eraser, color, maskValue, eraserRestore } = useToolStore(
    useShallow((s) => ({ brush: s.brush, eraser: s.eraser, color: s.color, maskValue: s.maskValue, eraserRestore: s.eraserRestore })),
  );
  // Subscribing keeps the target description current as selection, layers or mask mode change.
  useEditorStore(useShallow((s) => ({ ids: s.selectedIds, layers: s.doc.layers })));
  useUiStore((s) => s.maskEditLayerId);
  const tools = useToolStore.getState();
  const settings = tool === 'brush' ? brush : eraser;
  const set = (patch: Partial<BrushSettings>) => (tool === 'brush' ? tools.setBrush(patch) : tools.setEraser(patch));
  const target = resolvePaintTarget(tool);
  const onMask = target.kind === 'mask' || target.kind === 'auto-mask';
  const Icon = tool === 'brush' ? Brush : Eraser;

  return (
    <div data-testid="tool-options" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-panel/95 px-2.5 py-1.5 shadow-lg shadow-black/40">
      <span className="flex items-center gap-1.5 font-semibold text-ink">
        <Icon size={13} /> {tool === 'brush' ? 'Brush' : 'Eraser'}
      </span>
      <span data-testid="paint-target" data-kind={target.kind} className={`max-w-[220px] truncate rounded px-1.5 py-0.5 ${target.kind === 'none' ? 'bg-danger/15 text-danger' : onMask ? 'bg-accent/15 text-accent' : 'bg-raised text-dim'}`}>
        {target.kind === 'none' ? targetLabel(target) : `Edits: ${targetLabel(target)}`}
      </span>
      <Field label="Size" value={Math.round(settings.size)} min={1} max={800} wide onChange={(size) => set({ size })} />
      <Field label="Hardness" value={Math.round(settings.hardness * 100)} min={0} max={100} onChange={(v) => set({ hardness: v / 100 })} />
      <Field label="Opacity" value={Math.round(settings.opacity * 100)} min={1} max={100} onChange={(v) => set({ opacity: v / 100 })} />
      <Field label="Flow" value={Math.round(settings.flow * 100)} min={1} max={100} onChange={(v) => set({ flow: v / 100 })} />
      <Field label="Smoothing" value={Math.round(settings.smoothing * 100)} min={0} max={100} onChange={(v) => set({ smoothing: v / 100 })} />
      {tool === 'brush' && onMask && (
        <div className="w-44" title="What the brush paints on the mask (X swaps)">
          <Segmented
            value={maskValue}
            options={[
              { value: 'conceal', label: 'Hide (black)' },
              { value: 'reveal', label: 'Reveal (white)' },
            ]}
            onChange={(v) => tools.set({ maskValue: v })}
          />
        </div>
      )}
      {tool === 'brush' && !onMask && (
        <div className="flex w-28 items-center">
          <ColorInput label="Brush colour" value={color} onChange={(c) => tools.set({ color: c })} />
        </div>
      )}
      {tool === 'eraser' && onMask && (
        <div className="w-40" title="Erase hides pixels through the mask; Restore brings them back (hold Alt to swap)">
          <Segmented
            value={eraserRestore ? 'restore' : 'erase'}
            options={[
              { value: 'erase', label: 'Erase' },
              { value: 'restore', label: 'Restore' },
            ]}
            onChange={(v) => tools.set({ eraserRestore: v === 'restore' })}
          />
        </div>
      )}
    </div>
  );
}

/** Persistent reminder that edits go to the mask, not the image. */
function MaskEditBanner() {
  const layerId = useUiStore((s) => s.maskEditLayerId);
  const viewing = useUiStore((s) => !!layerId && s.maskViewLayerId === layerId);
  const layer = useEditorStore((s) => (layerId ? findLayer(s.doc.layers, layerId) : null));
  if (!layerId || !layer) return null;
  return (
    <div data-testid="mask-edit-banner" className="flex items-center gap-2 rounded-md border border-accent/50 bg-panel/95 px-2.5 py-1.5 shadow-lg shadow-black/40">
      <Layers2 size={13} className="text-accent" />
      <span className="text-ink">
        Editing the <b className="text-accent">mask</b> of “{layer.name}”
      </span>
      <span className="text-faint">white reveals · black hides · the image itself is untouched</span>
      <button
        type="button"
        onClick={() => useUiStore.getState().set({ maskViewLayerId: viewing ? null : layerId })}
        className="flex items-center gap-1 rounded bg-raised px-1.5 py-0.5 text-dim hover:text-ink"
      >
        {viewing ? <EyeOff size={12} /> : <Eye size={12} />} {viewing ? 'Show image' : 'Show mask'}
      </button>
      <button type="button" onClick={() => setMaskEditing(null)} className="rounded bg-accent px-2 py-0.5 font-medium text-accent-ink">
        Done
      </button>
    </div>
  );
}

function Toast() {
  const toast = useUiStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div role="status" data-testid="toast" className="rounded-md border border-line bg-panel px-3 py-1.5 text-ink shadow-lg shadow-black/40">
      {toast.text}
    </div>
  );
}

/** Floating controls over the canvas. */
export function CanvasHud() {
  const paintTool = useUiStore((s) => isPaintTool(s.tool));
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex flex-col items-center gap-1.5 px-2">
        <div className="pointer-events-auto">
          <MaskEditBanner />
        </div>
        {paintTool && (
          <div className="pointer-events-auto max-w-full">
            <ToolOptions />
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
        <Toast />
      </div>
    </>
  );
}
