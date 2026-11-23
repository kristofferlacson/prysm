import { memo, useState } from 'react';
import {
  Brush,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
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
import { getGenerator, generatorThumbnail } from '../../features/generators/render';
import { setMaskEditing, setMaskEnabled } from '../../features/masks/maskActions';
import { addPaintLayer } from '../../features/paint/paintController';
import { useAssetLibrary } from '../../services/assets';
import { rasterThumbnail, useRasters } from '../../services/rasters';
import { canClip, canGroup, canUngroup, useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { ImageLayer, Layer } from '../../types/document';
import { IconButton } from '../ui/controls';

const TYPE_ICON = { image: ImageIcon, text: Type, shape: Shapes, group: Folder } as const;

function Thumb({
  src,
  label,
  active,
  struck,
  checker,
  testId,
  onClick,
}: {
  src: string | null;
  label: string;
  active: boolean;
  struck?: boolean;
  checker?: boolean;
  testId: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`relative h-[22px] w-[22px] shrink-0 overflow-hidden rounded-sm border ${checker ? 'checker' : 'bg-black'} ${
        active ? 'border-accent outline outline-1 outline-accent' : 'border-line'
      }`}
    >
      {src && <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />}
      {struck && <span className="absolute inset-0 bg-[linear-gradient(to_top_right,transparent_45%,#ff6b6b_45%,#ff6b6b_55%,transparent_55%)]" />}
    </button>
  );
}

/**
 * Image and mask previews for an image layer. The outlined one is the current edit target,
 * which is how the panel shows whether brushes and erasers touch the mask or the pixels.
 */
function ImageThumbs({ layer }: { layer: ImageLayer }) {
  const { source } = layer;
  const mask = layer.masks[0];
  const selected = useEditorStore((s) => s.selectedIds.length === 1 && s.selectedIds[0] === layer.id);
  const editingMask = useUiStore((s) => s.maskEditLayerId === layer.id);
  const assetUrl = useAssetLibrary((s) => (source.kind === 'asset' ? s.assets.find((a) => a.id === source.assetId)?.url : undefined));
  // Subscribing re-renders the row when a bitmap finishes loading.
  useRasters([...(source.kind === 'raster' ? [source.rasterId] : []), ...(mask ? [mask.rasterId] : [])]);

  let content: string | null = assetUrl ?? null;
  if (source.kind === 'generated') {
    const def = getGenerator(source.generator);
    content = def ? generatorThumbnail(def) : null;
  } else if (source.kind === 'raster') {
    content = rasterThumbnail(source.rasterId, 'image');
  }
  const editor = useEditorStore.getState();

  return (
    <>
      <Thumb
        testId="layer-thumb"
        src={content}
        checker
        label={mask ? 'Edit the image (not its mask)' : layer.name}
        active={selected && !!mask && !editingMask}
        onClick={() => {
          editor.select([layer.id]);
          setMaskEditing(null);
        }}
      />
      {mask && (
        <Thumb
          testId="mask-thumb"
          src={rasterThumbnail(mask.rasterId, 'mask')}
          struck={!mask.enabled}
          label={`Layer mask${mask.enabled ? '' : ' (disabled)'} — click to edit it, Shift+click to turn it ${mask.enabled ? 'off' : 'on'}, Alt+click to view it`}
          active={selected && editingMask}
          onClick={(e) => {
            editor.select([layer.id]);
            if (e.shiftKey) setMaskEnabled(layer.id, !mask.enabled);
            else if (e.altKey) {
              const ui = useUiStore.getState();
              ui.set({ maskViewLayerId: ui.maskViewLayerId === layer.id ? null : layer.id });
            } else setMaskEditing(layer.id);
          }}
        />
      )}
    </>
  );
}

interface DropTarget {
  id: string;
  place: 'above' | 'below';
}

const LayerRow = memo(function LayerRow({
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
        className={`group relative flex h-8 items-center gap-1.5 pr-1.5 ${
          selected ? 'bg-accent/15 text-ink' : 'text-dim hover:bg-hover'
        } ${layer.visible ? '' : 'opacity-50'}`}
        data-clipped={layer.clip || undefined}
        style={{ paddingLeft: 10 + depth * 14 + (layer.clip ? 10 : 0) }}
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
        {layer.clip && <CornerDownRight size={12} className="shrink-0 text-accent" aria-label="Clipped to the layer below" />}
        {layer.type === 'image' ? <ImageThumbs layer={layer} /> : <Icon size={13} className="shrink-0" />}
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
});

export function LayersPanel() {
  const layers = useEditorStore((s) => s.doc.layers);
  const hasSelection = useEditorStore((s) => s.selectedIds.length > 0);
  const groupable = useEditorStore((s) => canGroup(s.doc, s.selectedIds));
  const ungroupable = useEditorStore((s) => canUngroup(s.doc, s.selectedIds));
  const clippable = useEditorStore((s) => canClip(s.doc, s.selectedIds));
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const editor = useEditorStore.getState();

  return (
    <div data-testid="layers-panel" className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line pl-4 pr-1.5">
        <span className="font-semibold">Layers</span>
        <div className="flex items-center">
          <IconButton label="New paint layer" onClick={() => addPaintLayer()}>
            <Brush size={14} />
          </IconButton>
          <IconButton label="Clip to the layer below / release (Ctrl+Alt+G)" disabled={!clippable} onClick={editor.toggleClipSelected}>
            <CornerDownRight size={14} />
          </IconButton>
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
