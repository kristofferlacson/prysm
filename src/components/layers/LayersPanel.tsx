import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  Group as GroupIcon,
  Image as ImageIcon,
  Lock,
  LockOpen,
  Shapes,
  Trash2,
  Type,
  Ungroup,
} from 'lucide-react';
import { canGroup, canUngroup, useEditorStore } from '../../stores/editorStore';
import type { Layer } from '../../types/document';
import { IconButton } from '../ui/controls';

const TYPE_ICON = { image: ImageIcon, text: Type, shape: Shapes, group: Folder } as const;

interface DropTarget {
  id: string;
  place: 'above' | 'below';
}

function LayerRow({
  layer,
  depth,
  dragId,
  drop,
  setDragId,
  setDrop,
}: {
  layer: Layer;
  depth: number;
  dragId: string | null;
  drop: DropTarget | null;
  setDragId: (id: string | null) => void;
  setDrop: (d: DropTarget | null) => void;
}) {
  const selected = useEditorStore((s) => s.selectedIds.includes(layer.id));
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const Icon = TYPE_ICON[layer.type];
  const editor = useEditorStore.getState();

  const rename = (name: string) => {
    setRenaming(false);
    if (name.trim() && name !== layer.name) editor.updateLayers([layer.id], { name: name.trim() });
  };

  const marker = drop?.id === layer.id ? drop.place : null;

  return (
    <>
      <div
        data-testid="layer-row"
        data-layer-id={layer.id}
        draggable={!renaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', layer.id);
          setDragId(layer.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDrop(null);
        }}
        onDragOver={(e) => {
          if (!dragId || dragId === layer.id) return;
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          // The list shows the top-most layer first, so the upper half of a row means "above" in z-order.
          setDrop({ id: layer.id, place: e.clientY < rect.top + rect.height / 2 ? 'above' : 'below' });
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId && drop) editor.moveLayer(dragId, drop.id, drop.place);
          setDragId(null);
          setDrop(null);
        }}
        onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? editor.toggleSelect(layer.id) : editor.select([layer.id]))}
        onDoubleClick={() => setRenaming(true)}
        className={`group relative flex h-7 items-center gap-1 pr-1 ${
          selected ? 'bg-accent/15 text-ink' : 'text-dim hover:bg-hover'
        } ${layer.visible ? '' : 'opacity-50'}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {marker && (
          <span className={`pointer-events-none absolute left-0 right-0 h-0.5 bg-accent ${marker === 'above' ? 'top-0' : 'bottom-0'}`} />
        )}
        {layer.type === 'group' ? (
          <button
            type="button"
            aria-label={open ? 'Collapse group' : 'Expand group'}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
            className="text-faint hover:text-ink"
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3" />
        )}
        <Icon size={13} className="shrink-0" />
        {renaming ? (
          <input
            autoFocus
            aria-label="Layer name"
            defaultValue={layer.name}
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="h-5 min-w-0 flex-1 rounded bg-bg px-1 text-ink outline outline-1 outline-accent"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate">{layer.name}</span>
        )}
        <button
          type="button"
          title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={(e) => {
            e.stopPropagation();
            editor.updateLayers([layer.id], { locked: !layer.locked });
          }}
          className={`flex h-6 w-5 items-center justify-center hover:text-ink ${
            layer.locked ? 'text-ink' : 'text-faint opacity-0 group-hover:opacity-100'
          }`}
        >
          {layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
        </button>
        <button
          type="button"
          title={layer.visible ? 'Hide layer' : 'Show layer'}
          aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
          onClick={(e) => {
            e.stopPropagation();
            editor.updateLayers([layer.id], { visible: !layer.visible });
          }}
          className="flex h-6 w-5 items-center justify-center text-faint hover:text-ink"
        >
          {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
      {layer.type === 'group' &&
        open &&
        [...layer.children]
          .reverse()
          .map((child) => (
            <LayerRow key={child.id} layer={child} depth={depth + 1} dragId={dragId} drop={drop} setDragId={setDragId} setDrop={setDrop} />
          ))}
    </>
  );
}

export function LayersPanel() {
  const layers = useEditorStore((s) => s.doc.layers);
  const hasSelection = useEditorStore((s) => s.selectedIds.length > 0);
  const groupable = useEditorStore((s) => canGroup(s.doc, s.selectedIds));
  const ungroupable = useEditorStore((s) => canUngroup(s.doc, s.selectedIds));
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const editor = useEditorStore.getState();

  return (
    <div data-testid="layers-panel" className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line pl-3 pr-1">
        <span className="font-semibold">Layers</span>
        <div className="flex items-center">
          <IconButton label="Group (Ctrl+G)" disabled={!groupable} onClick={editor.groupSelected}>
            <GroupIcon size={14} />
          </IconButton>
          <IconButton label="Ungroup (Ctrl+Shift+G)" disabled={!ungroupable} onClick={editor.ungroupSelected}>
            <Ungroup size={14} />
          </IconButton>
          <IconButton label="Duplicate (Ctrl+D)" disabled={!hasSelection} onClick={editor.duplicateSelected}>
            <Copy size={14} />
          </IconButton>
          <IconButton label="Delete (Del)" disabled={!hasSelection} onClick={editor.deleteSelected}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" onClick={(e) => e.target === e.currentTarget && editor.clearSelection()}>
        {[...layers].reverse().map((layer) => (
          <LayerRow key={layer.id} layer={layer} depth={0} dragId={dragId} drop={drop} setDragId={setDragId} setDrop={setDrop} />
        ))}
        {!layers.length && (
          <p className="px-3 py-4 text-faint">No layers yet. Add shapes, text or images from the left panel.</p>
        )}
      </div>
    </div>
  );
}
