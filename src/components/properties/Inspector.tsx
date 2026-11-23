import { useEffect, useMemo, useRef } from 'react';
import { CircleDashed, Move, Palette, Rows3, Scissors, Shapes, SlidersHorizontal, Sparkles, SquareDashed, Type, type LucideIcon } from 'lucide-react';
import { hasSection, KIND_TABS, kindOf, sectionTab, TAB_HINT, TAB_LABEL, type InspectorTab } from '../../features/inspector/inspector';
import { useAreaSelection } from '../../features/selection/selectionStore';
import { useEditorStore, useSelectedLayers } from '../../stores/editorStore';
import type { Layer } from '../../types/document';
import { isSelectTool, setInspectorTab, useUiStore } from '../../stores/uiStore';
import { SectionFilter } from '../ui/controls';
import { PropertiesPanel } from './PropertiesPanel';
import { SelectionPanel } from './SelectionPanel';

const ICON: Record<InspectorTab, LucideIcon> = {
  selection: SquareDashed,
  adjust: SlidersHorizontal,
  effects: Sparkles,
  cutout: Scissors,
  layout: Move,
  style: Palette,
  text: Type,
  shape: Shapes,
  canvas: CircleDashed,
  all: Rows3,
};

function collectIds(layers: Layer[], out: Set<string>) {
  for (const layer of layers) {
    out.add(layer.id);
    if (layer.type === 'group') collectIds(layer.children, out);
  }
  return out;
}

/** A request to show a section counts only while it is fresh: it must not fire again minutes later. */
const FRESH = 1500;

/**
 * The panel on the right: the settings of whatever is selected, one group of them at a time.
 *
 * Tabs choose the group. They follow what the user does: picking a selection tool opens the
 * selection's own tab, and adding or starting something (an effect, a crop, a fade) opens the tab
 * that holds its settings. The tab last used for each kind of layer is remembered.
 */
export function Inspector() {
  const selected = useSelectedLayers();
  const tool = useUiStore((s) => s.tool);
  const stored = useUiStore((s) => s.inspectorTabs);
  const onSelection = useUiStore((s) => s.inspectorOnSelection);
  const reveal = useUiStore((s) => s.reveal);
  const hasArea = useAreaSelection((s) => !!s.bounds);
  const handled = useRef(0);

  const kind = kindOf(selected);
  const selecting = isSelectTool(tool) || hasArea;
  const layerTabs = KIND_TABS[kind];
  const tabs: InspectorTab[] = selecting ? ['selection', ...layerTabs] : layerTabs;
  const bar = tabs.length > 1;
  const pref = stored[kind];
  const all = bar && pref === 'all';
  const base = pref && pref !== 'all' && layerTabs.includes(pref) ? pref : layerTabs[0];
  const active: InspectorTab = all ? 'all' : selecting && onSelection ? 'selection' : base;

  // Picking a selection tool, or selecting an area, brings up what can be done with the selection.
  const selectTool = isSelectTool(tool);
  useEffect(() => {
    if (selectTool || hasArea) useUiStore.getState().set({ inspectorOnSelection: true });
  }, [selectTool, hasArea]);

  // A layer that has just been added opens on its own main tab, whatever tab its kind was left on:
  // new text shows its font and size, a new texture its colours.
  const layers = useEditorStore((s) => s.doc.layers);
  const known = useRef<Set<string> | null>(null);
  const only = selected.length === 1 ? selected[0].id : null;
  useEffect(() => {
    const before = known.current;
    known.current = collectIds(layers, new Set());
    if (before && only && !before.has(only) && pref && pref !== 'all' && pref !== layerTabs[0]) setInspectorTab(kind, layerTabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, only]);

  // Something asked for a section to be shown: open the tab it lives in.
  useEffect(() => {
    if (!reveal || handled.current === reveal.n || Date.now() - reveal.at > FRESH) return;
    // The layer it is about may only just be getting selected: wait for a selection that has the section.
    if (!hasSection(reveal.section, kind)) return;
    handled.current = reveal.n;
    if (!all) setInspectorTab(kind, sectionTab(reveal.section, kind));
  }, [reveal, kind, all]);

  const filter = useMemo(() => (active === 'all' || kind === 'canvas' ? null : (title: string) => sectionTab(title, kind) === active), [active, kind]);

  return (
    <>
      {bar && (
        <div role="tablist" aria-label="Settings" data-testid="inspector-tabs" data-kind={kind} className="flex shrink-0 items-stretch border-b border-line bg-panel px-1 py-1">
          {[...tabs, 'all' as const].map((tab) => {
            const Icon = ICON[tab];
            const on = tab === active;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={on}
                data-inspector-tab={tab}
                title={TAB_HINT[tab]}
                onClick={() => (tab === 'selection' ? useUiStore.getState().set({ inspectorOnSelection: true, ...(all ? { inspectorTabs: { ...stored, [kind]: base } } : {}) }) : setInspectorTab(kind, tab))}
                className={`flex min-w-0 flex-col items-center gap-0.5 rounded-md py-1 text-[10.5px] leading-tight tracking-tight transition-colors ${tab === 'all' ? 'w-7 flex-none' : 'flex-1'} ${
                  on ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-hover hover:text-ink'
                }`}
              >
                <Icon size={14} />
                <span className="max-w-full whitespace-nowrap">{TAB_LABEL[tab]}</span>
              </button>
            );
          })}
        </div>
      )}
      {/* Only this part scrolls; the tabs above it stay put and never cover what is scrolled to. */}
      <div data-testid="inspector" className="min-h-0 flex-1 overflow-y-auto">
      {(active === 'selection' || active === 'all' || !bar) && (
        <SectionFilter.Provider value={null}>
          <SelectionPanel />
        </SectionFilter.Provider>
      )}
      {active !== 'selection' && (
        <SectionFilter.Provider value={filter}>
          <PropertiesPanel />
        </SectionFilter.Provider>
      )}
      </div>
    </>
  );
}
