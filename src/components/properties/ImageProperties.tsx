import { ArrowDown, ArrowUp, Eye, EyeOff, RefreshCw, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { applyCropPreset, CROP_PRESETS, startCropping, stopCropping } from '../../features/crop/crop';
import { DEFAULT_ADJUSTMENTS, NO_CROP } from '../../features/document/factory';
import { EFFECT_MAP } from '../../features/effects/effects';
import { getGenerator } from '../../features/generators/render';
import { ADJUSTMENT_SPECS, isNeutral } from '../../features/image-editing/adjustments';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { CropInsets, ImageLayer } from '../../types/document';
import { ColorInput, Row, Section, Select, SliderRow, TextButton, WithSection } from '../ui/controls';
import { FadeSection } from './FadeSection';
import { ExpandSection, UpscaleSection } from './LocalImageTools';
import { MaskProperties } from './MaskProperties';
import type { Update } from './PropertiesPanel';
import { StrokeSection } from './ShapeProperties';
import { CurvesSection, LevelsSection } from './ToneProperties';

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
  const paint = source.kind === 'raster';
  const { cropping, cropPreset } = useUiStore(useShallow((s) => ({ cropping: s.cropLayerId === layer.id, cropPreset: s.cropPreset })));

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

      <MaskProperties layer={layer} />
      <FadeSection layer={layer} update={update} />

      <Section title="Crop" defaultOpen={cropped} action={<ResetLink disabled={!cropped} onClick={() => setCrop(NO_CROP)}>Reset</ResetLink>}>
        <span className="block" title="Drag a crop frame on the picture itself (C)">
          <TextButton primary={!cropping} className="w-full" onClick={() => (cropping ? stopCropping(true) : startCropping(layer.id))}>
            {cropping ? 'Done cropping' : 'Crop on canvas'}
          </TextButton>
        </span>
        <Row label="Shape">
          <Select label="Crop shape" value={cropPreset} options={CROP_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onChange={(id) => applyCropPreset(layer.id, id)} />
        </Row>
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

      <LevelsSection layer={layer} update={update} />
      <CurvesSection layer={layer} update={update} />

      <Section title="Effects">
        {effects.map((fx, i) => {
          const def = EFFECT_MAP.get(fx.type);
          if (!def) return null;
          const off = fx.enabled === false;
          const fxColors = def.colors?.map((c, k) => fx.colors?.[k] ?? c);
          const patch = (next: Partial<typeof fx>, key?: string) =>
            update({ effects: effects.map((e, j) => (j === i ? { ...e, ...next } : e)) }, key ? `effect-${fx.type}-${key}` : undefined);
          const move = (to: number) => {
            const next = [...effects];
            next.splice(to, 0, next.splice(i, 1)[0]);
            update({ effects: next });
          };
          const tool = 'flex h-6 w-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';
          return (
            <div key={fx.type} data-effect-row={fx.type} data-reveal={fx.type} data-enabled={!off} className={`-mx-2 space-y-1.5 px-2 py-1 ${off ? 'opacity-50' : ''}`}>
              <SliderRow label={def.label} value={Math.round(fx.amount * 100)} min={0} max={100} onChange={(v) => patch({ amount: v / 100 }, 'amount')} />
              {def.angle !== undefined && (
                <SliderRow label="Direction" value={fx.angle ?? def.angle} min={0} max={180} onChange={(angle) => patch({ angle }, 'angle')} />
              )}
              {fxColors?.map((color, k) => (
                <Row key={k} label={fxColors.length > 1 ? `Colour ${k + 1}` : 'Colour'}>
                  <ColorInput
                    label={`${def.label} colour ${k + 1}`}
                    value={color}
                    onChange={(next) => patch({ colors: fxColors.map((c, m) => (m === k ? next : c)) }, `color-${k}`)}
                  />
                </Row>
              ))}
              <div className="flex items-center justify-end gap-1">
                <button type="button" className={tool} title={`${off ? 'Turn on' : 'Turn off'} ${def.label}`} aria-label={`${off ? 'Turn on' : 'Turn off'} ${def.label}`} onClick={() => patch({ enabled: off })}>
                  {off ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button type="button" className={tool} disabled={i === 0} title={`Apply ${def.label} earlier`} aria-label={`Apply ${def.label} earlier`} onClick={() => move(i - 1)}>
                  <ArrowUp size={13} />
                </button>
                <button type="button" className={tool} disabled={i === effects.length - 1} title={`Apply ${def.label} later`} aria-label={`Apply ${def.label} later`} onClick={() => move(i + 1)}>
                  <ArrowDown size={13} />
                </button>
                <button type="button" className={`${tool} hover:!text-danger`} title={`Remove ${def.label}`} aria-label={`Remove ${def.label}`} onClick={() => update({ effects: effects.filter((_, j) => j !== i) })}>
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {effects.length > 1 && <p className="leading-relaxed text-faint">Effects are applied from top to bottom; the arrows change the order.</p>}
        {!effects.length && <p className="text-faint">No effects applied.</p>}
        <TextButton className="w-full" onClick={() => useUiStore.getState().set({ sidebarTab: 'effects' })}>
          Browse effects
        </TextButton>
      </Section>

      <ExpandSection layer={layer} />
      {source.kind === 'asset' && <UpscaleSection layer={layer} />}

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

      <WithSection title="Adjustments">
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
          {paint ? 'Remove crop, adjustments and effects' : 'Restore original image'}
        </TextButton>
      </div>
      </WithSection>
    </>
  );
}
