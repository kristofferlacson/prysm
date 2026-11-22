import { useEffect } from 'react';
import { insertImageFiles } from '../../features/library/insert';
import { saveNow } from '../../features/projects/projects';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import { isEditableTarget } from '../../utils/misc';

/** Global keyboard shortcuts. Nothing fires while the user is typing in a field or editing text on the canvas. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const ui = useUiStore.getState();
      if (ui.dialog) return;
      const editor = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (key === ' ') {
        e.preventDefault();
        if (!ui.spaceHeld) ui.set({ spaceHeld: true });
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
            editor.duplicateSelected();
            return;
          case 'g':
            e.preventDefault();
            if (e.shiftKey) editor.ungroupSelected();
            else editor.groupSelected();
            return;
          case 'a':
            e.preventDefault();
            editor.selectAll();
            return;
          case 's':
            e.preventDefault();
            void saveNow();
            return;
          case ']':
            e.preventDefault();
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

      switch (key) {
        case 'delete':
        case 'backspace':
          e.preventDefault();
          editor.deleteSelected();
          break;
        case 'escape':
          editor.clearSelection();
          break;
        case 'v':
          ui.set({ tool: 'move' });
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
      if (isEditableTarget(e.target) || useUiStore.getState().dialog) return;
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
