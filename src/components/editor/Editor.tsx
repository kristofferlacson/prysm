import { useState } from 'react';
import { useProjectPersistence } from '../../features/projects/projects';
import { useUiStore } from '../../stores/uiStore';
import { CanvasStage } from '../canvas/CanvasStage';
import { Ruler, RULER_SIZE } from '../canvas/Rulers';
import { ExportDialog } from '../dialogs/ExportDialog';
import { ProjectsDialog } from '../dialogs/ProjectsDialog';
import { LayersPanel } from '../layers/LayersPanel';
import { PropertiesPanel } from '../properties/PropertiesPanel';
import { Sidebar } from '../sidebar/Sidebar';
import { Logo, TopBar } from './TopBar';
import { useShortcuts } from './useShortcuts';

export function Editor() {
  const [ready, setReady] = useState(false);
  useProjectPersistence(() => setReady(true));
  useShortcuts();
  const showRulers = useUiStore((s) => s.showRulers);
  const dialog = useUiStore((s) => s.dialog);
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
    <div className="flex h-full flex-col" data-testid="editor">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
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
        <aside className="flex w-[272px] shrink-0 flex-col border-l border-line bg-panel">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PropertiesPanel />
          </div>
          <div className="h-[32%] min-h-[150px] shrink-0 border-t border-line">
            <LayersPanel />
          </div>
        </aside>
      </div>
      {dialog === 'export' && <ExportDialog onClose={closeDialog} />}
      {dialog === 'projects' && <ProjectsDialog onClose={closeDialog} />}
    </div>
  );
}
