import { useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  FlipHorizontal2,
  FlipVertical2,
  Group as GroupIcon,
  Link2,
  Ungroup,
  Unlink2,
} from 'lucide-react';
import { canClip, canGroup, canUngroup, useEditorStore, useSelectedLayers } from '../../stores/editorStore';
import { BLEND_MODES, type BlendMode, type Layer, type LayerPatch, type Shadow } from '../../types/document';
import { round } from '../../utils/geometry';
import { ColorInput, IconButton, NumberInput, Row, Section, Select, SliderRow, Switch } from '../ui/controls';
import { CanvasProperties } from './CanvasProperties';
import { ImageProperties } from './ImageProperties';
import { ShapeProperties } from './ShapeProperties';
import { TextProperties } from './TextProperties';

export type Update = (patch: LayerPatch | ((l: Layer) => LayerPatch), key?: string) => void;

const TYPE_LABEL: Record<Layer['type'], string> = { image: 'Image', text: 'Text', shape: 'Shape', group: 'Group' };

const BLEND_OPTIONS = BLEND_MODES.map((m) => ({
  value: m,
  label: m.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => (dash ? ' ' : '') + c.toUpperCase()),
}));

const DEFAULT_SHADOW: Shadow = { color: '#000000', blur: 18, offsetX: 0, offsetY: 8, opacity: 0.35 };

function ArrangeSection({ count }: { count: number }) {
  const editor = useEditorStore.getState();
  const groupable = useEditorStore((s) => canGroup(s.doc, s.selectedIds));
  const ungroupable = useEditorStore((s) => canUngroup(s.doc, s.selectedIds));
  return (
    <Section title="Arrange">
      <div className="flex items-center justify-between">
        <IconButton label={count > 1 ? 'Align left edges' : 'Align to canvas left'} onClick={() => editor.alignSelected('left')}>
          <AlignStartVertical size={15} />
        </IconButton>
        <IconButton label="Align horizontal centres" onClick={() => editor.alignSelected('hcenter')}>
          <AlignCenterVertical size={15} />
        </IconButton>
        <IconButton label={count > 1 ? 'Align right edges' : 'Align to canvas right'} onClick={() => editor.alignSelected('right')}>
          <AlignEndVertical size={15} />
        </IconButton>
        <IconButton label={count > 1 ? 'Align top edges' : 'Align to canvas top'} onClick={() => editor.alignSelected('top')}>
          <AlignStartHorizontal size={15} />
        </IconButton>
        <IconButton label="Align vertical centres" onClick={() => editor.alignSelected('vcenter')}>
          <AlignCenterHorizontal size={15} />
        </IconButton>
        <IconButton label={count > 1 ? 'Align bottom edges' : 'Align to canvas bottom'} onClick={() => editor.alignSelected('bottom')}>
          <AlignEndHorizontal size={15} />
        </IconButton>
        <IconButton label="Distribute horizontally (3+ layers)" disabled={count < 3} onClick={() => editor.distributeSelected('x')}>
          <AlignHorizontalSpaceAround size={15} />
        </IconButton>
        <IconButton label="Distribute vertically (3+ layers)" disabled={count < 3} onClick={() => editor.distributeSelected('y')}>
          <AlignVerticalSpaceAround size={15} />
        </IconButton>
      </div>
      <div className="flex items-center justify-between">
        <IconButton label="Bring to front" onClick={() => editor.reorderSelected('front')}>
          <ArrowUpToLine size={15} />
        </IconButton>
        <IconButton label="Bring forward" onClick={() => editor.reorderSelected('forward')}>
          <ArrowUp size={15} />
        </IconButton>
        <IconButton label="Send backward" onClick={() => editor.reorderSelected('backward')}>
          <ArrowDown size={15} />
        </IconButton>
        <IconButton label="Send to back" onClick={() => editor.reorderSelected('back')}>
          <ArrowDownToLine size={15} />
        </IconButton>
        <IconButton label="Flip horizontally" onClick={() => editor.flipSelected('x')}>
          <FlipHorizontal2 size={15} />
        </IconButton>
        <IconButton label="Flip vertically" onClick={() => editor.flipSelected('y')}>
          <FlipVertical2 size={15} />
        </IconButton>
        <IconButton label="Group (Ctrl+G)" disabled={!groupable} onClick={() => editor.groupSelected()}>
          <GroupIcon size={15} />
        </IconButton>
        <IconButton label="Ungroup (Ctrl+Shift+G)" disabled={!ungroupable} onClick={() => editor.ungroupSelected()}>
          <Ungroup size={15} />
        </IconButton>
      </div>
    </Section>
  );
}

function TransformSection({ layer, update }: { layer: Layer; update: Update }) {
  const [locked, setLocked] = useState(layer.type === 'image');
  const isGroup = layer.type === 'group';
  const isText = layer.type === 'text';
  // Groups keep their children's coordinates and resize through scale; leaf layers resize their box.
  const w = layer.width * (isGroup ? Math.abs(layer.scaleX) : 1);
  const h = layer.height * (isGroup ? Math.abs(layer.scaleY) : 1);

  const resize = (nextW: number, nextH: number) => {
    if (isGroup) {
      update({
        scaleX: (Math.sign(layer.scaleX) || 1) * (nextW / layer.width),
        scaleY: (Math.sign(layer.scaleY) || 1) * (nextH / layer.height),
      }, 'size');
    } else if (isText) {
      update({ width: nextW }, 'size');
    } else {
      update({ width: nextW, height: nextH }, 'size');
    }
  };

  return (
    <Section title="Position & size">
      <div className="grid grid-cols-2 gap-1.5">
        <NumberInput prefix="X" label="X position" value={layer.x} onChange={(x) => update({ x }, 'x')} />
        <NumberInput prefix="Y" label="Y position" value={layer.y} onChange={(y) => update({ y }, 'y')} />
        <NumberInput
          prefix="W"
          label="Width"
          value={w}
          min={1}
          onChange={(v) => resize(v, locked && !isText ? round((v / w) * h) : h)}
        />
        <div className="flex items-center gap-1">
          <NumberInput
            prefix="H"
            label="Height"
            value={h}
            min={1}
            disabled={isText}
            onChange={(v) => resize(locked ? round((v / h) * w) : w, v)}
            className="flex-1"
          />
          {!isText && (
            <IconButton label={locked ? 'Unlock aspect ratio' : 'Lock aspect ratio'} active={locked} onClick={() => setLocked(!locked)} className="!h-6 !w-6">
              {locked ? <Link2 size={13} /> : <Unlink2 size={13} />}
            </IconButton>
          )}
        </div>
        <NumberInput
          prefix="°"
          label="Rotation"
          value={layer.rotation}
          min={-360}
          max={360}
          onChange={(rotation) => update({ rotation }, 'rotation')}
        />
      </div>
    </Section>
  );
}

function AppearanceSection({ layer, update }: { layer: Layer; update: Update }) {
  const clippable = useEditorStore((s) => canClip(s.doc, s.selectedIds));
  return (
    <Section title="Blending">
      <SliderRow
        label="Opacity"
        value={Math.round(layer.opacity * 100)}
        min={0}
        max={100}
        defaultValue={100}
        onChange={(v) => update({ opacity: v / 100 }, 'opacity')}
      />
      <Row label="Blend mode">
        <Select<BlendMode>
          label="Blend mode"
          value={layer.blendMode}
          options={BLEND_OPTIONS}
          onChange={(blendMode) => update({ blendMode })}
        />
      </Row>
      <Row label="Clip">
        <Switch
          label="Clip to layer below"
          checked={layer.clip}
          onChange={() => (clippable || layer.clip) && useEditorStore.getState().toggleClipSelected()}
        />
        <span className="text-faint">
          {layer.clip ? 'Shown only inside the layer below' : clippable ? 'Show only inside the layer below' : 'Needs a layer underneath'}
        </span>
      </Row>
    </Section>
  );
}

function ShadowSection({ layer, update }: { layer: Layer; update: Update }) {
  const shadow = layer.shadow;
  const set = (patch: Partial<Shadow>, key: string) => update({ shadow: { ...(shadow ?? DEFAULT_SHADOW), ...patch } }, `shadow-${key}`);
  return (
    <Section
      key={shadow ? 'on' : 'off'}
      title="Drop shadow"
      defaultOpen={!!shadow}
      action={<Switch label="Drop shadow" checked={!!shadow} onChange={(on) => update({ shadow: on ? DEFAULT_SHADOW : null })} />}
    >
      {shadow ? (
        <>
          <Row label="Colour">
            <ColorInput label="Shadow colour" value={shadow.color} onChange={(color) => set({ color }, 'color')} />
          </Row>
          <SliderRow label="Opacity" value={Math.round(shadow.opacity * 100)} min={0} max={100} onChange={(v) => set({ opacity: v / 100 }, 'opacity')} />
          <SliderRow label="Blur" value={shadow.blur} min={0} max={120} onChange={(blur) => set({ blur }, 'blur')} />
          <SliderRow label="Offset X" value={shadow.offsetX} min={-100} max={100} onChange={(offsetX) => set({ offsetX }, 'x')} />
          <SliderRow label="Offset Y" value={shadow.offsetY} min={-100} max={100} onChange={(offsetY) => set({ offsetY }, 'y')} />
        </>
      ) : (
        <p className="text-faint">Off</p>
      )}
    </Section>
  );
}

export function PropertiesPanel() {
  const selected = useSelectedLayers();
  if (!selected.length) return <CanvasProperties />;

  const ids = selected.map((l) => l.id);
  const first = selected[0];
  const single = selected.length === 1 ? first : null;
  const update: Update = (patch, key) =>
    useEditorStore.getState().updateLayers(ids, patch, key ? { coalesce: key } : undefined);

  return (
    <div data-testid="properties-panel">
      <div className="flex h-11 items-center justify-between border-b border-line px-4 text-[13px]">
        <span className="truncate font-semibold">{single ? single.name : `${selected.length} layers selected`}</span>
        {single && <span className="ml-2 shrink-0 text-faint">{TYPE_LABEL[single.type]}</span>}
      </div>
      <ArrangeSection count={selected.length} />
      {single && <TransformSection key={single.id} layer={single} update={update} />}
      <AppearanceSection layer={first} update={update} />
      {single?.type === 'text' && <TextProperties layer={single} update={update} />}
      {single?.type === 'shape' && <ShapeProperties layer={single} update={update} />}
      {single?.type === 'image' && <ImageProperties layer={single} update={update} />}
      {single && single.type !== 'group' && <ShadowSection layer={single} update={update} />}
    </div>
  );
}
