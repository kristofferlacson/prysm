import { getGraphic } from '../../features/library/graphics';
import { defaultIconStroke } from '../../features/library/icons';
import type { ShapeLayer, Stroke } from '../../types/document';
import { ColorInput, Row, Section, Segmented, SliderRow, Switch, TextButton } from '../ui/controls';
import { FillEditor } from './FillEditor';
import type { Update } from './PropertiesPanel';

const DEFAULT_STROKE: Stroke = { color: '#1d1e22', width: 4 };

export function StrokeSection({
  title,
  stroke,
  max = 60,
  styles = false,
  onChange,
}: {
  title: string;
  stroke: Stroke | null;
  max?: number;
  /** Offer solid / dashed / dotted (shape outlines). */
  styles?: boolean;
  onChange: (stroke: Stroke | null, key?: string) => void;
}) {
  return (
    <Section
      key={stroke ? 'on' : 'off'}
      title={title}
      defaultOpen={!!stroke}
      action={<Switch label={title} checked={!!stroke} onChange={(on) => onChange(on ? DEFAULT_STROKE : null)} />}
    >
      {stroke ? (
        <>
          <Row label="Colour">
            <ColorInput label={`${title} colour`} value={stroke.color} onChange={(color) => onChange({ ...stroke, color }, 'stroke-color')} />
          </Row>
          <SliderRow label="Thickness" value={stroke.width} min={0} max={max} step={0.5} onChange={(width) => onChange({ ...stroke, width }, 'stroke-width')} />
          {styles && (
            <div data-testid="stroke-style">
              <Segmented
                value={stroke.dash ?? 'solid'}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'dashed', label: 'Dashed' },
                  { value: 'dotted', label: 'Dotted' },
                ]}
                onChange={(dash) => onChange({ ...stroke, dash })}
              />
            </div>
          )}
        </>
      ) : (
        <p className="text-faint">Off</p>
      )}
    </Section>
  );
}

export function ShapeProperties({ layer, update }: { layer: ShapeLayer; update: Update }) {
  if (layer.shape === 'icon') {
    const stroke = layer.stroke ?? { color: '#1d1e22', width: defaultIconStroke(Math.min(layer.width, layer.height)) };
    return (
      <Section title="Icon">
        <Row label="Colour">
          <ColorInput label="Icon colour" value={stroke.color} onChange={(color) => update({ stroke: { ...stroke, color } }, 'icon-color')} />
        </Row>
        <SliderRow label="Line weight" value={stroke.width} min={0.5} max={Math.max(12, Math.round(Math.min(layer.width, layer.height) / 4))} step={0.5} onChange={(width) => update({ stroke: { ...stroke, width } }, 'icon-weight')} />
      </Section>
    );
  }
  if (layer.shape === 'graphic') {
    const def = getGraphic(layer.graphic ?? '');
    const colors = (def?.colors ?? []).map((c, i) => layer.colors?.[i] ?? c);
    return (
      <Section title="Colours">
        {colors.map((color, i) => (
          <Row key={i} label={`Colour ${i + 1}`}>
            <ColorInput
              label={`Graphic colour ${i + 1}`}
              value={color}
              onChange={(next) => update({ colors: colors.map((c, k) => (k === i ? next : c)) }, `graphic-color-${i}`)}
            />
          </Row>
        ))}
        {def ? (
          <TextButton className="w-full" disabled={colors.every((c, i) => c === def.colors[i])} onClick={() => update({ colors: [...def.colors] })}>
            Original colours
          </TextButton>
        ) : (
          <p className="text-danger">This graphic is not part of this version of the editor.</p>
        )}
      </Section>
    );
  }
  const open = layer.shape === 'line' || layer.shape === 'arrow';
  return (
    <>
      {!open && (
        <Section title="Fill">
          <FillEditor fill={layer.fill} allowNone onChange={(fill) => update({ fill }, 'fill')} />
        </Section>
      )}
      <StrokeSection title="Stroke" stroke={layer.stroke} styles onChange={(stroke, key) => update({ stroke }, key)} />
      {(layer.shape === 'rect' || layer.shape === 'polygon' || layer.shape === 'star') && (
        <Section title="Geometry">
          {layer.shape === 'rect' && (
            <SliderRow
              label="Corners"
              value={layer.cornerRadius}
              min={0}
              max={Math.round(Math.min(layer.width, layer.height) / 2)}
              defaultValue={0}
              onChange={(cornerRadius) => update({ cornerRadius }, 'corner')}
            />
          )}
          {layer.shape !== 'rect' && (
            <SliderRow
              label={layer.shape === 'star' ? 'Points' : 'Sides'}
              value={layer.sides}
              min={3}
              max={16}
              onChange={(sides) => update({ sides }, 'sides')}
            />
          )}
          {layer.shape === 'star' && (
            <SliderRow
              label="Inner radius"
              value={Math.round(layer.innerRadius * 100)}
              min={10}
              max={95}
              onChange={(v) => update({ innerRadius: v / 100 }, 'inner')}
            />
          )}
        </Section>
      )}
    </>
  );
}
