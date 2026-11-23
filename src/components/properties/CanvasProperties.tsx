import { useShallow } from 'zustand/react/shallow';
import { CANVAS_PRESETS } from '../../features/projects/presets';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import { NumberInput, Section, Select } from '../ui/controls';
import { FillEditor } from './FillEditor';

/**
 * Shown when nothing is selected: the properties of the design itself (size and background).
 * How the editor looks (rulers, grid, interface size) lives in the View menu in the top bar.
 */
export function CanvasProperties() {
  const { width, height, background } = useEditorStore(
    useShallow((s) => ({ width: s.doc.width, height: s.doc.height, background: s.doc.background })),
  );
  const setDocument = useEditorStore.getState().setDocument;
  const preset = CANVAS_PRESETS.find((p) => p.width === width && p.height === height);

  const resize = (w: number, h: number) => {
    setDocument({ width: Math.round(w), height: Math.round(h) }, { coalesce: 'canvas-size' });
    useUiStore.getState().fitToScreen(w, h);
  };

  return (
    <div data-testid="canvas-properties">
      <div className="flex h-11 items-center border-b border-line px-4 text-[13px] font-semibold">Canvas</div>
      <Section title="Size">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberInput prefix="W" label="Canvas width" value={width} min={16} max={12000} onChange={(w) => resize(w, height)} />
          <NumberInput prefix="H" label="Canvas height" value={height} min={16} max={12000} onChange={(h) => resize(width, h)} />
        </div>
        <Select
          label="Size preset"
          value={preset?.id ?? 'custom'}
          options={[{ value: 'custom', label: 'Custom size' }, ...CANVAS_PRESETS.map((p) => ({ value: p.id, label: `${p.name} — ${p.width} × ${p.height}` }))]}
          onChange={(id) => {
            const p = CANVAS_PRESETS.find((x) => x.id === id);
            if (p) resize(p.width, p.height);
          }}
        />
        <p className="text-faint">Resizing changes the canvas only; layers keep their position and size.</p>
      </Section>
      <Section title="Background">
        <FillEditor
          fill={background}
          allowNone
          noneLabel="Clear"
          onChange={(fill) => setDocument({ background: fill }, { coalesce: 'canvas-background' })}
        />
      </Section>
    </div>
  );
}
