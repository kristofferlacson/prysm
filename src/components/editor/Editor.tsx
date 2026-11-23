import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMaskEditGuard } from '../../features/masks/useMaskEditGuard';
import { useProjectPersistence } from '../../features/projects/projects';
import { followAddress, useUiStore } from '../../stores/uiStore';
import { CanvasStage } from '../canvas/CanvasStage';
import { Ruler, RULER_SIZE } from '../canvas/Rulers';
import { BackgroundRemovalDialog } from '../dialogs/BackgroundRemovalDialog';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { ExportDialog } from '../dialogs/ExportDialog';
import { GuideDialog } from '../dialogs/GuideDialog';
import { ProjectsDialog } from '../dialogs/ProjectsDialog';
import { Home } from '../home/Home';
import { LayersPanel } from '../layers/LayersPanel';
import { Inspector } from '../properties/Inspector';
import { Sidebar } from '../sidebar/Sidebar';
import { Logo, TopBar } from './TopBar';
import { useShortcuts } from './useShortcuts';

const LAYERS_SPLIT_KEY = 'prysm.layersSplit';

function storedSplit() {
  try {
    const v = Number(localStorage.getItem(LAYERS_SPLIT_KEY));
    return v >= 0.15 && v <= 0.75 ? v : 0.36;
  } catch {
    return 0.36;
  }
}

/** Properties above, layers below, with a divider that can be dragged to give either one more room. */
function RightPanel() {
  const ref = useRef<HTMLElement>(null);
  const [split, setSplit] = useState(storedSplit);
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const rect = ref.current!.getBoundingClientRect();
      setSplit(Math.min(0.75, Math.max(0.15, (rect.bottom - ev.clientY) / rect.height)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSplit((v) => {
        try {
          localStorage.setItem(LAYERS_SPLIT_KEY, String(v));
        } catch {
          // Not remembered in private browsing.
        }
        return v;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <aside ref={ref} className="ui-scale flex w-[300px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex min-h-0 flex-1 flex-col">
        <Inspector />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the layers panel"
        data-testid="layers-divider"
        onPointerDown={startDrag}
        className="h-1.5 shrink-0 cursor-row-resize border-t border-line bg-panel hover:bg-accent/40"
      />
      <div className="min-h-[120px] shrink-0" style={{ height: `${split * 100}%` }}>
        <LayersPanel />
      </div>
    </aside>
  );
}

export function Editor() {
  const [ready, setReady] = useState(false);
  useProjectPersistence(() => setReady(true));
  useShortcuts();
  useMaskEditGuard();
  const showRulers = useUiStore((s) => s.showRulers);
  const dialog = useUiStore((s) => s.dialog);
  const uiScale = useUiStore((s) => s.uiScale);
  const panelsHidden = useUiStore((s) => s.panelsHidden);
  const home = useUiStore((s) => s.home);
  useEffect(followAddress, []);
  const closeDialog = () => useUiStore.getState().set({ dialog: null });

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-dim">
        <Logo /> Opening your workspace…
      </div>
    );
  }

  const ruler = showRulers ? RULER_SIZE : 0;

  return (
    <div className="flex h-full flex-col" data-testid="editor" style={{ '--ui-scale': uiScale } as CSSProperties}>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {!panelsHidden && <Sidebar />}
        <main
          className="grid min-w-0 flex-1"
          style={{ gridTemplateColumns: `${ruler}px minmax(0, 1fr)`, gridTemplateRows: `${ruler}px minmax(0, 1fr)` }}
        >
          <div className="border-b border-r border-line bg-panel" />
          <div className="overflow-hidden border-b border-line">{showRulers && <Ruler orientation="h" />}</div>
          <div className="overflow-hidden border-r border-line">{showRulers && <Ruler orientation="v" />}</div>
          <div className="relative min-h-0 min-w-0">
            <CanvasStage />
          </div>
        </main>
        {!panelsHidden && <RightPanel />}
      </div>
      {home && <Home />}
      {dialog === 'export' && <ExportDialog onClose={closeDialog} />}
      {dialog === 'projects' && <ProjectsDialog onClose={closeDialog} />}
      <BackgroundRemovalDialog />
      <GuideDialog />
      <ConfirmDialog />
    </div>
  );
}
