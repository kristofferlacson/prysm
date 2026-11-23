import { fadeAlongSelection } from '../../features/image-editing/fadeActions';
import { useState } from 'react';
import { LoaderCircle, Trash2, WandSparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { fillSelection, maskLayerWithSelection, selectionTarget, selectionToNewLayer, selectLayerPixels, selectSubject } from '../../features/selection/selectionActions';
import { useLocalTools } from '../../features/inpaint/contentAwareFill';
import { contentAwareFillSelection } from '../../features/inpaint/localFill';
import { deleteSavedSelection, loadSavedSelection, renameSavedSelection, saveCurrentSelection } from '../../features/selection/savedSelections';
import { clearSelectionArea, featherSelection, growSelection, invertSelection, selectWholeCanvas, useAreaSelection } from '../../features/selection/selectionStore';
import { useEditorStore } from '../../stores/editorStore';
import { useToolStore } from '../../stores/toolStore';
import { isSelectTool, useUiStore } from '../../stores/uiStore';
import { ColorInput, IconButton, NumberInput, Row, Section, TextButton } from '../ui/controls';
import { AiSelectionActions } from './AiSelectionActions';
import { LocalJobStatus } from './LocalImageTools';

/** Selections kept with the project. Loading one follows the mode chosen for the tools (new, add, subtract, intersect). */
function SavedSelections({ canSave }: { canSave: boolean }) {
  const saved = useEditorStore((s) => s.doc.selections);
  const mode = useAreaSelection((s) => s.mode);
  if (!saved.length && !canSave) return null;
  return (
    <Section title="Saved selections">
      {saved.map((item) => (
        <div key={item.id} data-saved-selection={item.id} className="flex items-center gap-1.5">
          <input
            aria-label="Saved selection name"
            defaultValue={item.name}
            key={item.name}
            onBlur={(e) => renameSavedSelection(item.id, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-7 min-w-0 flex-1 rounded bg-raised px-2 text-ink outline-none focus:outline focus:outline-1 focus:outline-accent"
          />
          <span title={mode === 'new' ? 'Make this the selection' : `Load it using the “${mode}” mode`}>
            <TextButton className="!h-7 !px-2" onClick={() => void loadSavedSelection(item.id, mode)}>
              Load
            </TextButton>
          </span>
          <IconButton label={`Delete saved selection ${item.name}`} onClick={() => deleteSavedSelection(item.id)} className="!h-7 !w-7">
            <Trash2 size={13} />
          </IconButton>
        </div>
      ))}
      <span className="block" title={canSave ? 'Keep the current selection with this project' : 'Select an area first'}>
        <TextButton className="w-full" disabled={!canSave} onClick={() => saveCurrentSelection()}>
          Save selection
        </TextButton>
      </span>
      {saved.length === 0 && <p className="leading-relaxed text-faint">Saved selections are stored with the project and can be loaded again later.</p>}
    </Section>
  );
}

/**
 * Everything that can be done with an area selection. Shown at the top of the right-hand panel
 * while a selection tool is active or something is selected.
 */
export function SelectionPanel() {
  const tool = useUiStore((s) => s.tool);
  const { bounds, refineAmount, busy, mode } = useAreaSelection(useShallow((s) => ({ bounds: s.bounds, refineAmount: s.refineAmount, busy: s.busy, mode: s.mode })));
  // Keeps the layer commands honest about which layer they would act on.
  const { ids } = useEditorStore(useShallow((s) => ({ ids: s.selectedIds, layers: s.doc.layers })));
  const color = useToolStore((s) => s.color);
  const [working, setWorking] = useState(false);
  const localBusy = useLocalTools((s) => !!s.job);
  if (!isSelectTool(tool) && !bounds) return null;

  const single = ids.length === 1 ? ids[0] : null;
  const target = selectionTarget();
  const needsLayer = target.layer ? undefined : target.reason;
  const store = useAreaSelection.getState();
  const run = (action: () => Promise<unknown>) => async () => {
    setWorking(true);
    try {
      await action();
    } finally {
      setWorking(false);
    }
  };
  const layerButton = (label: string, title: string, action: () => Promise<unknown>) => (
    <span title={needsLayer ?? title}>
      <TextButton className="w-full" disabled={!target.layer || working} onClick={run(action)}>
        {label}
      </TextButton>
    </span>
  );

  return (
    <div data-testid="selection-panel" className="border-b-2 border-line">
      <div className="flex h-11 items-center justify-between border-b border-line px-4 text-[13px]">
        <span className="font-semibold">Selection</span>
        {bounds ? (
          <span data-testid="selection-size" className="tabular-nums text-faint" title="Size of the selected area">
            {Math.round(bounds.width)} × {Math.round(bounds.height)} px
          </span>
        ) : (
          <span className="text-faint">Nothing selected</span>
        )}
      </div>

      <Section title="Select">
        {!bounds && <p className="leading-relaxed text-dim">Drag on the canvas to select an area. Hold Shift to add to the selection, Alt to take away from it.</p>}
        <div className="grid grid-cols-2 gap-1.5">
          <span title="Select the whole canvas (Ctrl+A)">
            <TextButton className="w-full" onClick={selectWholeCanvas}>
              Select all
            </TextButton>
          </span>
          <span title={single ? 'Select everything the selected layer draws: the shape of a cut-out, a piece of text, a shape' : 'Select one layer in the Layers panel first'}>
            <TextButton className="w-full" disabled={!single} onClick={() => single && selectLayerPixels(single, mode)}>
              Select layer
            </TextButton>
          </span>
        </div>
        <span className="block" title={target.layer ? `Finds the main subject of “${target.layer.name}” in your browser and selects it` : target.reason}>
          <TextButton className="w-full" disabled={!target.layer || !!busy} onClick={() => void selectSubject(mode)}>
            {busy ? <LoaderCircle size={13} className="animate-spin" /> : <WandSparkles size={13} />} Select subject
          </TextButton>
        </span>
        {busy && (
          <p data-testid="selection-busy" className="text-dim">
            {busy}
          </p>
        )}
      </Section>

      <SavedSelections canSave={!!bounds} />

      {bounds && (
        <div data-testid="selection-actions">
          <Section title="Adjust">
            <div className="grid grid-cols-2 gap-1.5">
              <span title="Deselect (Ctrl+D)">
                <TextButton className="w-full" onClick={clearSelectionArea}>
                  Deselect
                </TextButton>
              </span>
              <span title="Select everything else instead (Ctrl+Shift+I)">
                <TextButton className="w-full" onClick={invertSelection}>
                  Invert
                </TextButton>
              </span>
            </div>
            <Row label="Amount (px)">
              <NumberInput label="Refine amount" value={refineAmount} min={1} max={500} onChange={(v) => store.set({ refineAmount: v })} />
            </Row>
            <div className="grid grid-cols-3 gap-1.5">
              <span title="Move the edge outwards by the amount">
                <TextButton className="w-full !px-1" onClick={() => growSelection(refineAmount)}>
                  Expand
                </TextButton>
              </span>
              <span title="Move the edge inwards by the amount">
                <TextButton className="w-full !px-1" onClick={() => growSelection(-refineAmount)}>
                  Contract
                </TextButton>
              </span>
              <span title="Soften the edge by the amount">
                <TextButton className="w-full !px-1" onClick={() => featherSelection(refineAmount)}>
                  Feather
                </TextButton>
              </span>
            </div>
          </Section>

          <Section title="Use on layer">
            <div
              data-testid="selection-target"
              title={needsLayer}
              className={`truncate rounded px-2 py-1 ${target.layer ? 'bg-accent/15 text-accent' : 'bg-raised text-dim'}`}
            >
              {target.layer ? `Layer: “${target.layer.name}”` : 'No image layer selected'}
            </div>
            {!target.layer && <p className="leading-relaxed text-faint">{target.reason}</p>}
            <div className="grid grid-cols-2 gap-1.5">
              {layerButton('Mask to selection', 'Show this layer only inside the selection, using its mask', () => maskLayerWithSelection(false))}
              {layerButton('Hide area', 'Hide the selected part of this layer with its mask (Delete)', () => maskLayerWithSelection(true))}
              {layerButton('Copy to layer', 'Copy the selected part of this layer to a new layer (Ctrl+J)', () => selectionToNewLayer(false))}
              {layerButton('Cut to layer', 'Move the selected part of this layer to a new layer (Ctrl+Shift+J)', () => selectionToNewLayer(true))}
            </div>
            <div className="grid">{layerButton('Fade along selection', 'Keep this layer inside the selection and let it fade out softly at the selection’s edge (adjust it under Fade)', async () => target.layer && fadeAlongSelection(target.layer.id))}</div>
            <p className="leading-relaxed text-faint">These work through the layer’s mask and its fade. The image itself is never changed.</p>
          </Section>

          <Section title="Fill and remove">
            <span className="block" title="Fill the selected area with what surrounds it. Runs in your browser; no AI service.">
              <TextButton primary className="w-full" disabled={localBusy} onClick={() => void contentAwareFillSelection()}>
                Content-aware fill
              </TextButton>
            </span>
            <LocalJobStatus kind="fill" />
            <p className="leading-relaxed text-faint">
              Removes what is selected by continuing its surroundings over it, as a new layer. Runs in your browser; best on simple backgrounds.
            </p>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ColorInput label="Fill colour" value={color} onChange={(c) => useToolStore.getState().set({ color: c })} />
              </div>
              <span title="Add a new layer filled with this colour inside the selection">
                <TextButton onClick={() => fillSelection(color)}>Fill</TextButton>
              </span>
            </div>
          </Section>

          <Section title="AI">
            <AiSelectionActions />
          </Section>
        </div>
      )}
    </div>
  );
}
