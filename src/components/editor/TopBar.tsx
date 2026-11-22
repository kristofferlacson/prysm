import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CircleUserRound,
  CloudOff,
  Download,
  FolderOpen,
  Hand,
  LoaderCircle,
  Maximize,
  MousePointer2,
  Redo2,
  TriangleAlert,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore, type SaveStatus } from '../../stores/uiStore';
import { IconButton, TextButton } from '../ui/controls';

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

function SaveIndicator() {
  const status = useUiStore((s) => s.saveStatus);
  return (
    <span
      data-testid="save-status"
      data-status={status}
      title="Projects are saved automatically in this browser"
      className={`flex items-center gap-1 text-[11px] ${status === 'error' ? 'text-danger' : 'text-faint'}`}
    >
      {status === 'saved' && <Check size={12} />}
      {status === 'saving' && <LoaderCircle size={12} className="animate-spin" />}
      {status === 'error' && <TriangleAlert size={12} />}
      {SAVE_LABEL[status]}
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
      className="h-7 w-48 truncate rounded bg-transparent px-2 text-[13px] font-medium text-ink outline-none hover:bg-raised focus:bg-raised focus:outline focus:outline-1 focus:outline-accent"
    />
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <IconButton label="Account" active={open} onClick={() => setOpen(!open)}>
        <CircleUserRound size={17} />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-64 rounded border border-line bg-panel p-3 shadow-xl shadow-black/50">
          <div className="flex items-center gap-2 font-semibold">
            <CloudOff size={14} className="text-dim" /> Local workspace
          </div>
          <p className="mt-1.5 leading-relaxed text-dim">
            You are not signed in. Projects and uploads are stored in this browser only.
          </p>
          <p className="mt-1.5 leading-relaxed text-faint">
            Accounts, cloud storage and sharing are not implemented yet (Milestone 3, Supabase).
          </p>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const { canUndo, canRedo, width, height } = useEditorStore(
    useShallow((s) => ({ canUndo: s.past.length > 0, canRedo: s.future.length > 0, width: s.doc.width, height: s.doc.height })),
  );
  const { zoom, tool } = useUiStore(useShallow((s) => ({ zoom: s.zoom, tool: s.tool })));
  const editor = useEditorStore.getState();
  const ui = useUiStore.getState();

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
      <div className="flex items-center gap-2 pl-1 pr-2">
        <Logo />
        <span className="text-[14px] font-bold tracking-tight">Prysm</span>
      </div>
      <span className="h-5 w-px bg-line" />
      <ProjectName />
      <IconButton label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={editor.undo}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={editor.redo}>
        <Redo2 size={15} />
      </IconButton>
      <span className="ml-1">
        <SaveIndicator />
      </span>

      <div className="flex-1" />

      <IconButton label="Move tool (V)" active={tool === 'move'} onClick={() => ui.set({ tool: 'move' })}>
        <MousePointer2 size={15} />
      </IconButton>
      <IconButton label="Hand tool (H) — or hold Space" active={tool === 'hand'} onClick={() => ui.set({ tool: 'hand' })}>
        <Hand size={15} />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <IconButton label="Zoom out (Ctrl+−)" onClick={() => ui.zoomAt(zoom / 1.25)}>
        <ZoomOut size={15} />
      </IconButton>
      <button
        type="button"
        data-testid="zoom-level"
        title="Reset zoom to 100% (Ctrl+1)"
        onClick={() => ui.zoomAt(1)}
        className="h-7 w-12 rounded text-center text-[12px] tabular-nums text-dim hover:bg-hover hover:text-ink"
      >
        {Math.round(zoom * 100)}%
      </button>
      <IconButton label="Zoom in (Ctrl++)" onClick={() => ui.zoomAt(zoom * 1.25)}>
        <ZoomIn size={15} />
      </IconButton>
      <IconButton label="Fit canvas to screen (Ctrl+0)" onClick={() => ui.fitToScreen(width, height)}>
        <Maximize size={15} />
      </IconButton>
      <button
        type="button"
        data-testid="canvas-size"
        title="Canvas settings"
        onClick={() => editor.clearSelection()}
        className="h-7 rounded px-2 text-[12px] tabular-nums text-dim hover:bg-hover hover:text-ink"
      >
        {width} × {height}
      </button>
      <span className="mx-1 h-5 w-px bg-line" />
      <TextButton onClick={() => ui.set({ dialog: 'projects' })}>
        <FolderOpen size={13} /> Projects
      </TextButton>
      <TextButton primary onClick={() => ui.set({ dialog: 'export' })}>
        <Download size={13} /> Export
      </TextButton>
      <AccountMenu />
    </header>
  );
}
