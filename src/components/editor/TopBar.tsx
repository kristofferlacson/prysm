import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  Brush,
  Check,
  CircleHelp,
  CircleUserRound,
  CloudOff,
  Download,
  Eraser,
  FolderOpen,
  Hand,
  Lasso,
  LoaderCircle,
  Maximize,
  MousePointer2,
  Redo2,
  SlidersHorizontal,
  SquareDashed,
  WandSparkles,
  TriangleAlert,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../stores/editorStore';
import { openGuide, showHome, UI_SCALES, useUiStore, type SaveStatus } from '../../stores/uiStore';
import { IconButton, Segmented, Switch, TextButton } from '../ui/controls';
import { Popover } from '../ui/Popover';

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 5 27 25H5z" fill="none" stroke="#e8e9ec" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 5v20" stroke="#3ddc97" strokeWidth="2" />
      <path d="M16 15 27 25" stroke="#ffb347" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 15 5 25" stroke="#6ea8ff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Save failed',
};

/**
 * How much the top bar gives up so that all of it fits the window: 0 nothing, 1 its text labels,
 * 2 also the zoom buttons (Ctrl+wheel and the shortcuts still zoom), 3 also the save status and
 * the canvas size (clicking an empty part of the canvas opens the same settings). Widths are in
 * the bar's own units, so the same steps apply at every interface size. In a window narrower
 * than the last step the bar scrolls sideways instead of pushing its end off the screen.
 */
function useCompactLevel(ref: RefObject<HTMLElement | null>) {
  const [level, setLevel] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setLevel(COMPACT_WIDTHS.filter((w) => el.clientWidth < w).length);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return level;
}
const COMPACT_WIDTHS = [1220, 1010, 900];

function SaveIndicator({ compact }: { compact: boolean }) {
  const status = useUiStore((s) => s.saveStatus);
  return (
    <span
      data-testid="save-status"
      data-status={status}
      title={`${compact ? `${SAVE_LABEL[status]}. ` : ''}Projects are saved automatically in this browser`}
      className={`flex items-center gap-1 text-[11px] ${status === 'error' ? 'text-danger' : 'text-faint'}`}
    >
      {status === 'saved' && <Check size={12} />}
      {status === 'saving' && <LoaderCircle size={12} className="animate-spin" />}
      {status === 'error' && <TriangleAlert size={12} />}
      {status === 'unsaved' && compact && <span className="h-1.5 w-1.5 rounded-full bg-faint" />}
      {!compact && SAVE_LABEL[status]}
    </span>
  );
}

function ProjectName() {
  const name = useEditorStore((s) => s.doc.name);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() && draft.trim() !== name) {
      useEditorStore.getState().setDocument({ name: draft.trim() });
    }
    setDraft(null);
  };
  return (
    <input
      aria-label="Project name"
      value={draft ?? name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="h-8 w-48 min-w-[72px] shrink truncate rounded bg-transparent px-2 text-[13px] font-medium text-ink outline-none hover:bg-raised focus:bg-raised focus:outline focus:outline-1 focus:outline-accent"
    />
  );
}

/**
 * How the editor itself looks: rulers, grid and the size of the interface. None of this is part
 * of a design or of any layer, so it sits with the other view controls instead of in a properties panel.
 */
function ViewMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { showGrid, showRulers, uiScale, panelsHidden, composition } = useUiStore(
    useShallow((s) => ({ showGrid: s.showGrid, showRulers: s.showRulers, uiScale: s.uiScale, panelsHidden: s.panelsHidden, composition: s.composition })),
  );
  const guide = (key: keyof typeof composition, label: string, name: string) => (
    <label className="flex cursor-pointer items-center justify-between">
      <span>{label}</span>
      <Switch label={name} checked={composition[key]} onChange={(v) => useUiStore.getState().set({ composition: { ...composition, [key]: v } })} />
    </label>
  );
  const ui = useUiStore.getState();
  return (
    <div ref={ref}>
      <IconButton label="View options" active={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={15} />
      </IconButton>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} testId="view-menu" className="w-60">
          <div className="space-y-2.5 p-3">
            <label className="flex cursor-pointer items-center justify-between">
              <span>Rulers</span>
              <Switch label="Show rulers" checked={showRulers} onChange={(v) => ui.set({ showRulers: v })} />
            </label>
            <label className="flex cursor-pointer items-center justify-between">
              <span>Grid</span>
              <Switch label="Show grid" checked={showGrid} onChange={(v) => ui.set({ showGrid: v })} />
            </label>
            <label className="flex cursor-pointer items-center justify-between">
              <span>
                Panels <span className="text-faint">(Ctrl+\)</span>
              </span>
              <Switch label="Show panels" checked={!panelsHidden} onChange={(v) => ui.set({ panelsHidden: !v })} />
            </label>
          </div>
          <div className="space-y-2.5 border-t border-line p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-dim">Composition guides</div>
            {guide('thirds', 'Rule of thirds', 'Show rule of thirds')}
            {guide('center', 'Centre lines', 'Show centre lines')}
            {guide('margins', 'Safe margins', 'Show safe margins')}
            <p className="leading-relaxed text-faint">Layers snap to the guides that are on. Guides are never exported.</p>
          </div>
          <div data-testid="interface-size" className="space-y-1.5 border-t border-line p-3">
            <div>Interface size</div>
            <Segmented
              value={String(uiScale)}
              options={UI_SCALES.map((o) => ({ value: String(o.value), label: o.label }))}
              onChange={(v) => ui.setUiScale(Number(v))}
            />
            <p className="leading-relaxed text-faint">Makes the panels, buttons and text bigger or smaller. The canvas has its own zoom.</p>
          </div>
        </Popover>
      )}
    </div>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <IconButton label="Account" active={open} onClick={() => setOpen(!open)}>
        <CircleUserRound size={17} />
      </IconButton>
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} testId="account-menu" className="w-64 p-3">
          <div className="flex items-center gap-2 font-semibold">
            <CloudOff size={14} className="text-dim" /> Local workspace
          </div>
          <p className="mt-1.5 leading-relaxed text-dim">
            You are not signed in. Projects and uploads are stored in this browser only.
          </p>
          <p className="mt-1.5 leading-relaxed text-faint">
            Accounts, cloud storage and sharing are not implemented yet (Milestone 3, Supabase).
          </p>
        </Popover>
      )}
    </div>
  );
}

/** Only this part of the bar depends on the active tool. */
function ToolButtons() {
  const tool = useUiStore((s) => s.tool);
  const ui = useUiStore.getState();
  return (
    <>
      <IconButton label="Move tool (V)" active={tool === 'move'} onClick={() => ui.set({ tool: 'move' })}>
        <MousePointer2 size={15} />
      </IconButton>
      <IconButton label="Hand tool (H) — or hold Space" active={tool === 'hand'} onClick={() => ui.set({ tool: 'hand' })}>
        <Hand size={15} />
      </IconButton>
      <IconButton label="Brush (B) — paints on a mask or a paint layer" active={tool === 'brush'} onClick={() => ui.set({ tool: 'brush' })}>
        <Brush size={15} />
      </IconButton>
      <IconButton label="Eraser (E) — hides pixels through a mask, never deletes the image" active={tool === 'eraser'} onClick={() => ui.set({ tool: 'eraser' })}>
        <Eraser size={15} />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Marquee (M) — select a rectangle or an ellipse of the canvas" active={tool === 'marquee'} onClick={() => ui.set({ tool: 'marquee' })}>
        <SquareDashed size={15} />
      </IconButton>
      <IconButton label="Lasso (L) — select a freehand area" active={tool === 'lasso'} onClick={() => ui.set({ tool: 'lasso' })}>
        <Lasso size={15} />
      </IconButton>
      <IconButton label="Magic wand (W) — select an area of similar colour" active={tool === 'wand'} onClick={() => ui.set({ tool: 'wand' })}>
        <WandSparkles size={15} />
      </IconButton>
    </>
  );
}

/** The zoom read-out changes on every wheel step, so it is kept apart from the rest of the bar. */
function ZoomLevel() {
  const zoom = useUiStore((s) => s.zoom);
  return (
    <button
      type="button"
      data-testid="zoom-level"
      title="Reset zoom to 100% (Ctrl+1)"
      onClick={() => useUiStore.getState().zoomAt(1)}
      className="h-8 w-12 rounded text-center text-[12px] tabular-nums text-dim hover:bg-hover hover:text-ink"
    >
      {Math.round(zoom * 100)}%
    </button>
  );
}

export function TopBar() {
  const { canUndo, canRedo, width, height } = useEditorStore(
    useShallow((s) => ({ canUndo: s.past.length > 0, canRedo: s.future.length > 0, width: s.doc.width, height: s.doc.height })),
  );
  const editor = useEditorStore.getState();
  const ui = useUiStore.getState();
  const ref = useRef<HTMLElement>(null);
  const compact = useCompactLevel(ref);

  return (
    <header
      ref={ref}
      data-compact={compact}
      className="ui-scale flex h-12 shrink-0 items-center gap-1.5 overflow-x-auto overflow-y-hidden border-b border-line bg-panel px-3 [scrollbar-width:none]"
    >
      <button type="button" data-testid="home-link" title="Home page" aria-label="Home page" onClick={showHome} className="flex h-8 shrink-0 items-center gap-2 rounded-md pl-1 pr-2 hover:bg-hover">
        <Logo />
        {compact < 1 && <span className="text-[14px] font-bold tracking-tight">Prysm</span>}
      </button>
      <span className="h-5 w-px bg-line" />
      <ProjectName />
      <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={editor.undo}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={editor.redo}>
        <Redo2 size={15} />
      </IconButton>
      {compact < 3 && (
        <span className="ml-1 shrink-0">
          <SaveIndicator compact={compact > 0} />
        </span>
      )}

      <div className="flex-1" />

      <ToolButtons />
      <span className="mx-1.5 h-5 w-px bg-line" />
      {compact < 2 && (
        <IconButton label="Zoom out (Ctrl+−)" onClick={() => ui.zoomAt(useUiStore.getState().zoom / 1.25)}>
          <ZoomOut size={15} />
        </IconButton>
      )}
      <ZoomLevel />
      {compact < 2 && (
        <IconButton label="Zoom in (Ctrl++)" onClick={() => ui.zoomAt(useUiStore.getState().zoom * 1.25)}>
          <ZoomIn size={15} />
        </IconButton>
      )}
      <IconButton label="Fit canvas to screen (Ctrl+0)" onClick={() => ui.fitToScreen(width, height)}>
        <Maximize size={15} />
      </IconButton>
      <ViewMenu />
      <IconButton label="Guide: how to do things (F1)" onClick={() => openGuide()}>
        <CircleHelp size={15} />
      </IconButton>
      {compact < 3 && (
        <button
          type="button"
          data-testid="canvas-size"
          title="Canvas settings"
          onClick={() => editor.clearSelection()}
          className="h-8 shrink-0 whitespace-nowrap rounded px-2 text-[12px] tabular-nums text-dim hover:bg-hover hover:text-ink"
        >
          {width} × {height}
        </button>
      )}
      <span className="mx-1.5 h-5 w-px bg-line" />
      <TextButton label="Projects" className="shrink-0" onClick={() => ui.set({ dialog: 'projects' })}>
        <FolderOpen size={13} /> {compact < 1 && 'Projects'}
      </TextButton>
      <TextButton label="Export" primary className="shrink-0" onClick={() => ui.set({ dialog: 'export' })}>
        <Download size={13} /> {compact < 1 && 'Export'}
      </TextButton>
      <AccountMenu />
    </header>
  );
}
