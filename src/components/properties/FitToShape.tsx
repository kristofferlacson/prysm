import { useState } from 'react';
import { Shapes } from 'lucide-react';
import { fitTextToShape } from '../../features/text-warp/fitToShape';
import { useEditorStore } from '../../stores/editorStore';
import type { TextLayer } from '../../types/document';
import { Row, Select, TextButton } from '../ui/controls';

/** Shapes the text to the outline of another layer: a word in the shape of a picture. */
export function FitToShape({ layer }: { layer: TextLayer }) {
  const layers = useEditorStore((s) => s.doc.layers);
  const targets = layers.filter((l) => l.id !== layer.id && l.visible);
  const [picked, setPicked] = useState('');
  // By default the layer just under the text, which is usually the picture it was placed on.
  const index = layers.findIndex((l) => l.id === layer.id);
  const below = layers.slice(0, Math.max(0, index)).filter((l) => l.visible).at(-1);
  const target = targets.some((t) => t.id === picked) ? picked : (below?.id ?? targets.at(-1)?.id ?? '');
  const shaped = layer.warp?.style === 'shape';
  return (
    <div data-testid="fit-to-shape" className="space-y-2.5 border-t border-line pt-3">
      <div className="font-medium text-ink">Shape of another layer</div>
      {targets.length ? (
        <>
          <Row label="Layer">
            <Select label="Layer to take the shape from" value={target} options={targets.map((t) => ({ value: t.id, label: t.name }))} onChange={setPicked} />
          </Row>
          <TextButton primary={!shaped} className="w-full" onClick={() => fitTextToShape(layer.id, target)}>
            <Shapes size={13} /> {shaped ? 'Fit to this shape again' : 'Fit text to this shape'}
          </TextButton>
        </>
      ) : (
        <p className="leading-relaxed text-faint">Add a picture, shape, icon or sticker to the design first. The text can then take its shape.</p>
      )}
      <p className="leading-relaxed text-faint">
        Stretches the text to fill the outline of that layer, so the word itself takes the shape of the picture. Works best with bold fonts and a cut-out or
        a solid shape. The text stays text.
      </p>
    </div>
  );
}
