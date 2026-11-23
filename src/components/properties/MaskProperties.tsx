import { Brush, Eraser, Layers2 } from 'lucide-react';
import {
  addMask,
  applyMask,
  invertMask,
  removeMask,
  resetMask,
  setMaskEditing,
  setMaskEnabled,
  setMaskFeather,
} from '../../features/masks/maskActions';
import { useUiStore } from '../../stores/uiStore';
import type { ImageLayer } from '../../types/document';
import { Row, Section, Segmented, SliderRow, Switch, TextButton } from '../ui/controls';
import { BackgroundRemovalControl } from './BackgroundRemovalControl';

const MAX_FEATHER = 0.04;

/** Mask controls for an image layer: add / remove, edit target, visibility, refinement. */
export function MaskProperties({ layer }: { layer: ImageLayer }) {
  const mask = layer.masks[0];
  const editing = useUiStore((s) => s.maskEditLayerId === layer.id);
  const viewing = useUiStore((s) => s.maskViewLayerId === layer.id);
  const ui = useUiStore.getState();

  const paintWith = (tool: 'brush' | 'eraser') => {
    setMaskEditing(layer.id);
    ui.set({ tool });
  };

  if (!mask) {
    return (
      <Section title="Mask">
        <p className="text-faint">A mask hides parts of the layer without deleting any pixels.</p>
        <TextButton
          className="w-full"
          onClick={() => {
            if (addMask(layer.id)) setMaskEditing(layer.id);
          }}
        >
          <Layers2 size={12} /> Add layer mask
        </TextButton>
        <BackgroundRemovalControl layer={layer} />
      </Section>
    );
  }

  return (
    <Section title="Mask" action={<Switch label="Mask enabled" checked={mask.enabled} onChange={(on) => setMaskEnabled(layer.id, on)} />}>
      <Row label="Editing">
        <Segmented
          value={editing ? 'mask' : 'image'}
          options={[
            { value: 'image', label: 'Image' },
            { value: 'mask', label: 'Mask' },
          ]}
          onChange={(v) => setMaskEditing(v === 'mask' ? layer.id : null)}
        />
      </Row>
      <div className="grid grid-cols-2 gap-1.5">
        <TextButton onClick={() => paintWith('brush')}>
          <Brush size={12} /> Paint mask
        </TextButton>
        <TextButton onClick={() => paintWith('eraser')}>
          <Eraser size={12} /> Eraser
        </TextButton>
      </div>
      <Row label="Show mask">
        <Switch label="Show mask" checked={viewing} onChange={(on) => ui.set({ maskViewLayerId: on ? layer.id : null })} />
        <span className="text-faint">View it in greyscale</span>
      </Row>
      <SliderRow
        label="Feather"
        value={Math.round((mask.feather / MAX_FEATHER) * 100)}
        min={0}
        max={100}
        defaultValue={0}
        onChange={(v) => setMaskFeather(layer.id, (v / 100) * MAX_FEATHER)}
      />
      <button
        type="button"
        data-testid="mask-compare"
        title="Hold to see the layer without its mask"
        onPointerDown={() => ui.set({ maskBypassLayerId: layer.id })}
        onPointerUp={() => ui.set({ maskBypassLayerId: null })}
        onPointerLeave={() => useUiStore.getState().maskBypassLayerId && ui.set({ maskBypassLayerId: null })}
        className="flex h-7 w-full items-center justify-center rounded bg-raised text-[12px] font-medium text-ink hover:bg-hover active:bg-accent/20"
      >
        Hold to compare with original
      </button>
      <div className="grid grid-cols-2 gap-1.5">
        <TextButton onClick={() => void invertMask(layer.id)}>Invert</TextButton>
        <TextButton onClick={() => void resetMask(layer.id)}>Reset</TextButton>
        <TextButton onClick={() => void applyMask(layer.id)}>Apply</TextButton>
        <TextButton onClick={() => removeMask(layer.id)}>Delete mask</TextButton>
      </div>
      <p className="text-faint">
        Apply bakes the mask into a new image (undoable; the original stays in Uploads). Delete discards the mask and shows the whole layer again.
      </p>
      <BackgroundRemovalControl layer={layer} />
    </Section>
  );
}
