import { useEffect } from 'react';
import { findLayer } from '../document/operations';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';

/**
 * Mask editing and mask view only make sense for the one selected layer that has a mask.
 * As soon as that stops being true (selection moves, the mask is deleted or undone, the layer is
 * removed) the editor drops back to editing the image, so the two can never be confused.
 */
export function useMaskEditGuard() {
  useEffect(
    () =>
      useEditorStore.subscribe((s) => {
        const ui = useUiStore.getState();
        // The same goes for painting a fade: only on the one selected image, and only while it has a fade.
        if (ui.fadePaintLayerId) {
          const layer = findLayer(s.doc.layers, ui.fadePaintLayerId);
          const selected = s.selectedIds.length === 1 && s.selectedIds[0] === ui.fadePaintLayerId;
          if (!selected || layer?.type !== 'image' || !layer.fade) ui.set({ fadePaintLayerId: null });
        }
        const ids = [ui.maskEditLayerId, ui.maskViewLayerId, ui.maskBypassLayerId].filter((id): id is string => !!id);
        if (!ids.length) return;
        const stale = ids.some((id) => {
          const layer = findLayer(s.doc.layers, id);
          const selected = s.selectedIds.length === 1 && s.selectedIds[0] === id;
          return !selected || layer?.type !== 'image' || layer.masks.length === 0;
        });
        if (stale) ui.set({ maskEditLayerId: null, maskViewLayerId: null, maskBypassLayerId: null });
      }),
    [],
  );
}
