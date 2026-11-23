import { Lasso, SquareDashed, WandSparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAreaSelection, type LassoMode, type MarqueeShape, type SelectionMode } from '../../features/selection/selectionStore';
import { isSelectTool, useUiStore } from '../../stores/uiStore';
import { Segmented, Switch } from '../ui/controls';
import { HUD_BAR, HudField } from './hud';

const TOOL_NAME = { marquee: 'Marquee', lasso: 'Lasso', wand: 'Magic wand' } as const;
const TOOL_ICON = { marquee: SquareDashed, lasso: Lasso, wand: WandSparkles } as const;

/**
 * Settings of the active selection tool, in one slim bar over the canvas (like the brush's).
 * What to do with a selection lives in the panel on the right, so the canvas stays clear.
 */
export function SelectionBar() {
  const tool = useUiStore((s) => s.tool);
  const { mode, marqueeShape, lassoMode, feather, tolerance, contiguous, sampleAll } = useAreaSelection(
    useShallow((s) => ({ mode: s.mode, marqueeShape: s.marqueeShape, lassoMode: s.lassoMode, feather: s.feather, tolerance: s.tolerance, contiguous: s.contiguous, sampleAll: s.sampleAll })),
  );
  if (!isSelectTool(tool)) return null;
  const kind = tool as keyof typeof TOOL_NAME;
  const store = useAreaSelection.getState();
  const Icon = TOOL_ICON[kind];
  return (
    <div className="pointer-events-auto max-w-full">
      <div data-testid="selection-options" className={HUD_BAR}>
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          <Icon size={13} /> {TOOL_NAME[kind]}
        </span>
        <div className="w-60" title="What a new shape does to the selection. Shift adds, Alt subtracts, Shift+Alt intersects.">
          <Segmented<SelectionMode>
            value={mode}
            options={[
              { value: 'new', label: 'New' },
              { value: 'add', label: 'Add' },
              { value: 'subtract', label: 'Subtract' },
              { value: 'intersect', label: 'Intersect' },
            ]}
            onChange={(v) => store.set({ mode: v })}
          />
        </div>
        {kind === 'marquee' && (
          <div className="w-36" title="Press M again to switch">
            <Segmented<MarqueeShape>
              value={marqueeShape}
              options={[
                { value: 'rect', label: 'Rectangle' },
                { value: 'ellipse', label: 'Ellipse' },
              ]}
              onChange={(v) => store.set({ marqueeShape: v })}
            />
          </div>
        )}
        {kind === 'lasso' && (
          <div className="w-36" title="Polygon: click from corner to corner. Double-click, press Enter or click the first corner to close; Backspace removes the last corner; Escape cancels.">
            <Segmented<LassoMode>
              value={lassoMode}
              options={[
                { value: 'freehand', label: 'Freehand' },
                { value: 'polygon', label: 'Polygon' },
              ]}
              onChange={(v) => store.set({ lassoMode: v })}
            />
          </div>
        )}
        {kind !== 'wand' && <HudField label="Feather" value={feather} min={0} max={200} onChange={(v) => store.set({ feather: v })} />}
        {kind === 'wand' && (
          <>
            <HudField label="Tolerance" value={tolerance} min={0} max={255} onChange={(v) => store.set({ tolerance: v })} />
            <label className="flex items-center gap-1.5 text-dim" title="On: only the connected area. Off: every matching pixel on the canvas.">
              Contiguous
              <Switch label="Contiguous" checked={contiguous} onChange={(v) => store.set({ contiguous: v })} />
            </label>
            <div className="w-40" title="Which pixels the wand compares">
              <Segmented
                value={sampleAll ? 'all' : 'layer'}
                options={[
                  { value: 'all', label: 'All layers' },
                  { value: 'layer', label: 'This layer' },
                ]}
                onChange={(v) => store.set({ sampleAll: v === 'all' })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
