import { RefreshCw, X } from 'lucide-react';
import { DEFAULT_ADJUSTMENTS, NO_CROP } from '../../features/document/factory';
import { EFFECT_MAP } from '../../features/effects/effects';
import { getGenerator } from '../../features/generators/render';
import { ADJUSTMENT_SPECS, isNeutral } from '../../features/image-editing/adjustments';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { CropInsets, ImageLayer } from '../../types/document';
import { ColorInput, Row, Section, SliderRow, TextButton } from '../ui/controls';
import type { Update } from './PropertiesPanel';
import { StrokeSection } from './ShapeProperties';

const CROP_SIDES: { key: keyof CropInsets; label: string; opposite: keyof CropInsets }[] = [
  { key: 'left', label: 'Left', opposite: 'right' },
  { key: 'right', label: 'Right', opposite: 'left' },
  { key: 'top', label: 'Top', opposite: 'bottom' },
  { key: 'bottom', label: 'Bottom', opposite: 'top' },
];

function ResetLink({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="text-[11px] text-dim hover:text-ink disabled:invisible">
      {children}
    </button>
  );
}

export function ImageProperties({ layer, update }: { layer: ImageLayer; update: Update }) {
  const { source, crop, adjustments, effects } = layer;
  const generator = source.kind === 'generated' ? getGenerator(source.generator) : null;
  const cropped = CROP_SIDES.some((s) => crop[s.key] > 0);
  const edited = cropped || !isNeutral(adjustments) || effects.length > 0;

  const setCrop = (next: CropInsets) => useEditorStore.getState().setCrop(layer.id, next);

  return (
    <>
      {source.kind === 'generated' && generator && (
        <Section title={generator.kind === 'background' ? 'Background' : generator.kind === 'overlay' ? 'Overlay' : 'Texture'}>
          {source.colors.map((color, i) => (
            <Row key={i} label={`Colour ${i + 1}`}>
              <ColorInput
                label={`Palette colour ${i + 1}`}
                value={color}
                onChange={(c) =>
                  update({ source: { ...source, colors: source.colors.map((x, j) => (j === i ? c : x)) } }, `palette-${i}`)
                }
              />
            </Row>
          ))}
          <TextButton
            className="w-full"
            onClick={() => update({ source: { ...source, seed: Math.floor(Math.random() * 1e9) } })}
          >
            <RefreshCw size={12} /> Generate a new variation
          </TextButton>
        </Section>
      )}

      <Section title="Crop" defaultOpen={cropped} action={<ResetLink disabled={!cropped} onClick={() => setCrop(NO_CROP)}>Reset</ResetLink>}>
        {CROP_SIDES.map((side) => (
          <SliderRow
            key={side.key}
            label={side.label}
            value={Math.round(crop[side.key] * 100)}
            min={0}
            max={Math.max(0, Math.round(95 - crop[side.opposite] * 100))}
            onChange={(v) => setCrop({ ...crop, [side.key]: v / 100 })}
          />
        ))}
        <p className="text-faint">Percent trimmed from each side. The original image is kept.</p>
      </Section>

      <Section
        title="Adjustments"
        action={
          <ResetLink disabled={isNeutral(adjustments)} onClick={() => update({ adjustments: DEFAULT_ADJUSTMENTS })}>
            Reset all
          </ResetLink>
        }
      >
        {ADJUSTMENT_SPECS.map((spec) => (
          <SliderRow
            key={spec.key}
            label={spec.label}
            value={adjustments[spec.key]}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            defaultValue={DEFAULT_ADJUSTMENTS[spec.key]}
            onChange={(v) => update({ adjustments: { ...adjustments, [spec.key]: v } }, `adjust-${spec.key}`)}
          />
        ))}
      </Section>

      <Section title="Effects">
        {effects.map((fx, i) => {
          const def = EFFECT_MAP.get(fx.type);
          if (!def) return null;
          return (
            <div key={fx.type} className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <SliderRow
                  label={def.label}
                  value={Math.round(fx.amount * 100)}
                  min={0}
                  max={100}
                  onChange={(v) =>
                    update({ effects: effects.map((e, j) => (j === i ? { ...e, amount: v / 100 } : e)) }, `effect-${fx.type}`)
                  }
                />
              </div>
              <button
                type="button"
                title={`Remove ${def.label}`}
                aria-label={`Remove ${def.label}`}
                onClick={() => update({ effects: effects.filter((_, j) => j !== i) })}
                className="text-faint hover:text-danger"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        {!effects.length && <p className="text-faint">No effects applied.</p>}
        <TextButton className="w-full" onClick={() => useUiStore.getState().set({ sidebarTab: 'effects' })}>
          Browse effects
        </TextButton>
      </Section>

      <Section title="Frame" defaultOpen={layer.cornerRadius > 0}>
        <SliderRow
          label="Corners"
          value={layer.cornerRadius}
          min={0}
          max={Math.round(Math.min(layer.width, layer.height) / 2)}
          defaultValue={0}
          onChange={(cornerRadius) => update({ cornerRadius }, 'corner')}
        />
      </Section>
      <StrokeSection title="Border" stroke={layer.stroke} onChange={(stroke, key) => update({ stroke }, key)} />

      <div className="border-b border-line p-3">
        <TextButton
          className="w-full"
          disabled={!edited}
          onClick={() => {
            // Crop changes the layer box, so it goes through setCrop; both steps undo together.
            if (cropped) setCrop(NO_CROP);
            update({ adjustments: DEFAULT_ADJUSTMENTS, effects: [] }, 'crop');
          }}
        >
          Restore original image
        </TextButton>
      </div>
    </>
  );
}
