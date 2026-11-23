import { stopFadePainting } from '../../features/image-editing/fadeActions';
import { useEffect } from 'react';
import { startCropping, stopCropping } from '../../features/crop/crop';
import { findLayer } from '../../features/document/operations';
import { insertImageFiles } from '../../features/library/insert';
import { invertMask, setMaskEditing } from '../../features/masks/maskActions';
import { isPainting } from '../../features/paint/paintController';
import { saveNow } from '../../features/projects/projects';
import { maskLayerWithSelection, selectionTarget, selectionToNewLayer } from '../../features/selection/selectionActions';
import { clearSelectionArea, invertSelection, selectWholeCanvas, useAreaSelection } from '../../features/selection/selectionStore';
import { useToolStore } from '../../stores/toolStore';
import { useEditorStore } from '../../stores/editorStore';
import { isPaintTool, isSelectTool, openGuide, useUiStore } from '../../stores/uiStore';
import type { BlendMode } from '../../types/document';
import { isEditableTarget } from '../../utils/misc';

/** Alt + Shift + a letter sets the blend mode of the selected layers (the same letters as in Photoshop). */
const BLEND_KEYS: Record<string, BlendMode> = {
  KeyN: 'normal',
  KeyM: 'multiply',
  KeyS: 'screen',
  KeyO: 'overlay',
  KeyF: 'soft-light',
  KeyH: 'hard-light',
  KeyK: 'darken',
  KeyG: 'lighten',
  KeyD: 'color-dodge',
  KeyB: 'color-burn',
  KeyE: 'difference',
  KeyX: 'exclusion',
  KeyU: 'hue',
  KeyT: 'saturation',
  KeyC: 'color',
  KeyY: 'luminosity',
};
const blendLabel = (mode: BlendMode) => mode.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => (dash ? ' ' : '') + c.toUpperCase());

/** Global keyboard shortcuts. Nothing fires while the user is typing in a field or editing text on the canvas. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      // A stroke in progress owns the layer it is editing; shortcuts wait until it is finished.
      if (isPainting() && e.key !== ' ') return;
      const ui = useUiStore.getState();
      if (e.key === 'F1') {
        e.preventDefault();
        if (!ui.guide) openGuide();
        return;
      }
      // The home page and the guide sit over the editor: its shortcuts must not act on the design behind them.
      if (ui.dialog || ui.confirm || ui.home || ui.guide) return;
      const editor = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const area = useAreaSelection.getState();
      const selecting = isSelectTool(ui.tool);

      if (key === ' ') {
        e.preventDefault();
        if (!ui.spaceHeld) ui.set({ spaceHeld: true });
        return;
      }

      if (e.altKey && e.shiftKey && !mod && BLEND_KEYS[e.code]) {
        e.preventDefault();
        if (!editor.selectedIds.length) {
          ui.notify('Select a layer first to change its blend mode.');
          return;
        }
        const blendMode = BLEND_KEYS[e.code];
        editor.updateLayers(editor.selectedIds, { blendMode });
        ui.notify(`Blend mode: ${blendLabel(blendMode)}`);
        return;
      }

      if (mod) {
        switch (key) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) editor.redo();
            else editor.undo();
            return;
          case 'y':
            e.preventDefault();
            editor.redo();
            return;
          case 'c':
            editor.copySelected();
            return;
          case 'x':
            e.preventDefault();
            editor.cutSelected();
            return;
          case 'd':
            e.preventDefault();
            // With an area selected this is "deselect", as in other editors; otherwise it duplicates layers.
            if (area.mask) clearSelectionArea();
            else editor.duplicateSelected();
            return;
          case 'j':
            if (area.mask && selectionTarget().layer) {
              e.preventDefault();
              void selectionToNewLayer(e.shiftKey);
            }
            return;
          case 'g':
            e.preventDefault();
            if (e.altKey) editor.toggleClipSelected();
            else if (e.shiftKey) editor.ungroupSelected();
            else editor.groupSelected();
            return;
          case 'a':
            e.preventDefault();
            if (selecting) selectWholeCanvas();
            else editor.selectAll();
            return;
          case 'i':
            if (e.shiftKey && (area.mask || selecting)) {
              e.preventDefault();
              invertSelection();
            } else if (ui.maskEditLayerId) {
              e.preventDefault();
              void invertMask(ui.maskEditLayerId);
            }
            return;
          case 's':
            e.preventDefault();
            void saveNow();
            return;
          case '\\':
            e.preventDefault();
            ui.set({ panelsHidden: !ui.panelsHidden });
            return;
          case ']':
            e.preventDefault();
            if (e.altKey) return;
            editor.reorderSelected(e.shiftKey ? 'front' : 'forward');
            return;
          case '[':
            e.preventDefault();
            editor.reorderSelected(e.shiftKey ? 'back' : 'backward');
            return;
          case '0':
            e.preventDefault();
            ui.fitToScreen(editor.doc.width, editor.doc.height);
            return;
          case '1':
            e.preventDefault();
            ui.zoomAt(1);
            return;
          case '=':
          case '+':
            e.preventDefault();
            ui.zoomAt(ui.zoom * 1.25);
            return;
          case '-':
            e.preventDefault();
            ui.zoomAt(ui.zoom / 1.25);
            return;
        }
        return;
      }

      // While cropping, Enter keeps the crop and Escape puts the old one back; nothing else is in reach.
      if (ui.cropLayerId) {
        if (key === 'enter') stopCropping(true);
        else if (key === 'escape') stopCropping(false);
        return;
      }

      switch (key) {
        case 'c': {
          const only = editor.selectedIds.length === 1 ? findLayer(editor.doc.layers, editor.selectedIds[0]) : null;
          if (only?.type === 'image') startCropping(only.id);
          break;
        }
        case 'delete':
        case 'backspace':
          e.preventDefault();
          // While selecting an area, Delete clears that area of the layer (through its mask), not the layer.
          if (selecting && area.mask) void maskLayerWithSelection(true);
          else editor.deleteSelected();
          break;
        case 'escape':
          if (selecting) {
            if (area.mask) clearSelectionArea();
            else ui.set({ tool: 'move' });
          } else if (ui.fadePaintLayerId) stopFadePainting();
          else if (ui.maskEditLayerId) setMaskEditing(null);
          else if (isPaintTool(ui.tool)) ui.set({ tool: 'move' });
          else editor.clearSelection();
          break;
        case 'b':
          ui.set({ tool: 'brush' });
          break;
        case 'e':
          ui.set({ tool: 'eraser' });
          break;
        case 'x': {
          const tools = useToolStore.getState();
          tools.set({ maskValue: tools.maskValue === 'reveal' ? 'conceal' : 'reveal' });
          break;
        }
        case '[':
        case ']': {
          if (!isPaintTool(ui.tool)) break;
          const tools = useToolStore.getState();
          const current = ui.tool === 'brush' ? tools.brush.size : tools.eraser.size;
          const next = Math.min(800, Math.max(1, Math.round(key === ']' ? current * 1.2 + 1 : current / 1.2 - 1)));
          if (ui.tool === 'brush') tools.setBrush({ size: next });
          else tools.setEraser({ size: next });
          break;
        }
        case 'v':
          ui.set({ tool: 'move' });
          break;
        case 'm':
          // Pressing M on the marquee switches between rectangle and ellipse.
          if (ui.tool === 'marquee') area.set({ marqueeShape: area.marqueeShape === 'rect' ? 'ellipse' : 'rect' });
          ui.set({ tool: 'marquee' });
          break;
        case 'l':
          ui.set({ tool: 'lasso' });
          break;
        case 'w':
          ui.set({ tool: 'wand' });
          break;
        case 'h':
          ui.set({ tool: 'hand' });
          break;
        case 'arrowleft':
        case 'arrowright':
        case 'arrowup':
        case 'arrowdown': {
          if (!editor.selectedIds.length) break;
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          editor.nudgeSelected(
            key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0,
            key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0,
          );
          break;
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') useUiStore.getState().set({ spaceHeld: false });
    };

    // Paste goes through the clipboard event so images copied from other apps work too.
    const onPaste = (e: ClipboardEvent) => {
      const state = useUiStore.getState();
      if (isEditableTarget(e.target) || state.dialog || state.confirm || state.home || state.guide) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (files.length) void insertImageFiles(files);
      else useEditorStore.getState().paste();
    };

    const onBlur = () => useUiStore.getState().set({ spaceHeld: false });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
