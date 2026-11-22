import type { ShapeLayer, Stroke } from '../../types/document';
import { ColorInput, Row, Section, SliderRow, Switch } from '../ui/controls';
import { FillEditor } from './FillEditor';
import type { Update } from './PropertiesPanel';

const DEFAULT_STROKE: Stroke = { color: '#1d1e22', width: 4 };

export function StrokeSection({
  title,
  stroke,
  max = 60,
  onChange,
}: {
  title: string;
  stroke: Stroke | null;
  max?: number;
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
        </>
      ) : (
        <p className="text-faint">Off</p>
      )}
    </Section>
  );
}

export function ShapeProperties({ layer, update }: { layer: ShapeLayer; update: Update }) {
  const open = layer.shape === 'line' || layer.shape === 'arrow';
  return (
    <>
      {!open && (
        <Section title="Fill">
          <FillEditor fill={layer.fill} allowNone onChange={(fill) => update({ fill }, 'fill')} />
        </Section>
      )}
      <StrokeSection title="Stroke" stroke={layer.stroke} onChange={(stroke, key) => update({ stroke }, key)} />
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
