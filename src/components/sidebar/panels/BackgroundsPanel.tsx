import { useState } from 'react';
import { useEditorStore } from '../../../stores/editorStore';
import type { Fill } from '../../../types/document';
import { fillToCss } from '../../../utils/misc';
import { GeneratorGrid } from './GeneratorPanel';
import { Heading, PanelShell } from './shared';

const SOLIDS = [
  '#ffffff', '#f4f1ea', '#e8e9ec', '#1d1e22', '#000000', '#0b132b', '#264653', '#2a9d8f',
  '#3ddc97', '#e9c46a', '#f4a261', '#e76f51', '#e63946', '#ff7eb3', '#6a5cff', '#118ab2',
];

const lin = (angle: number, ...colors: string[]): Fill => ({
  type: 'linear',
  angle,
  stops: colors.map((color, i) => ({ offset: i / (colors.length - 1), color })),
});
const rad = (...colors: string[]): Fill => ({
  type: 'radial',
  stops: colors.map((color, i) => ({ offset: i / (colors.length - 1), color })),
});

const GRADIENTS: { name: string; fill: Fill }[] = [
  { name: 'Sunset', fill: lin(90, '#ff5e62', '#ffb347') },
  { name: 'Ocean', fill: lin(45, '#2193b0', '#6dd5ed') },
  { name: 'Aurora', fill: lin(135, '#00c9a7', '#845ec2') },
  { name: 'Peach', fill: lin(90, '#ffecd2', '#fcb69f') },
  { name: 'Midnight', fill: lin(90, '#0f2027', '#203a43', '#2c5364') },
  { name: 'Candy', fill: lin(0, '#f953c6', '#b91d73') },
  { name: 'Lime', fill: lin(45, '#d4fc79', '#96e6a1') },
  { name: 'Dusk', fill: lin(90, '#2c3e50', '#fd746c') },
  { name: 'Spotlight', fill: rad('#ffffff', '#c9d6ff') },
  { name: 'Ember', fill: rad('#ffb347', '#e4572e', '#14110f') },
  { name: 'Deep space', fill: rad('#3a4a7a', '#0b1026') },
  { name: 'Mint glow', fill: rad('#e0fff4', '#3ddc97') },
];

export function BackgroundsPanel() {
  const [query, setQuery] = useState('');
  const current = useEditorStore((s) => s.doc.background);
  const setBackground = (fill: Fill | null) => useEditorStore.getState().setDocument({ background: fill });
  const q = query.trim().toLowerCase();
  const gradients = GRADIENTS.filter((g) => !q || g.name.toLowerCase().includes(q) || g.fill.type.includes(q));

  return (
    <PanelShell title="Backgrounds" query={query} onQuery={setQuery} placeholder="Search backgrounds">
      {!q && (
        <>
          <Heading>Solid colours</Heading>
          <div className="grid grid-cols-8 gap-1.5 px-3">
            <button
              type="button"
              title="Transparent"
              aria-label="Transparent background"
              onClick={() => setBackground(null)}
              className={`checker aspect-square rounded border ${current === null ? 'border-accent' : 'border-line'}`}
            />
            {SOLIDS.slice(0, 15).map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={`Background ${color}`}
                onClick={() => setBackground({ type: 'solid', color })}
                className={`aspect-square rounded border ${
                  current?.type === 'solid' && current.color === color ? 'border-accent' : 'border-line'
                }`}
                style={{ background: color }}
              />
            ))}
          </div>
        </>
      )}
      {gradients.length > 0 && (
        <>
          <Heading>Gradients</Heading>
          <div className="grid grid-cols-4 gap-1.5 px-3">
            {gradients.map((g) => (
              <button
                key={g.name}
                type="button"
                title={`${g.name} (${g.fill.type})`}
                aria-label={`${g.name} gradient`}
                onClick={() => setBackground(g.fill)}
                className="aspect-square rounded border border-line hover:border-accent/60"
                style={{ background: fillToCss(g.fill) }}
              />
            ))}
          </div>
          {!q && (
            <p className="px-3 pt-2 text-faint">
              For a custom colour or gradient, deselect everything and edit Background in the Canvas panel on the right.
            </p>
          )}
        </>
      )}
      <Heading>Generated backgrounds</Heading>
      <GeneratorGrid kind="background" query={query} />
      <p className="px-3 pb-3 text-faint">
        Generated backgrounds are placed as the bottom layer, with editable colours. To use your own image, add it from Uploads and send it to the back.
      </p>
    </PanelShell>
  );
}
