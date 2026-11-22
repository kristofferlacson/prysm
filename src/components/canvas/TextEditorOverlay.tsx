import { useLayoutEffect, useRef } from 'react';
import { findLayer } from '../../features/document/operations';
import { fontStack } from '../../services/fonts';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { TextLayer } from '../../types/document';
import { stageRefs } from './stageRegistry';

/** In-place text editing: a textarea laid exactly over the text node while the node itself is hidden. */
export function TextEditorOverlay() {
  const id = useUiStore((s) => s.editingTextId);
  const layer = useEditorStore((s) => (id ? findLayer(s.doc.layers, id) : null));
  if (!id || !layer || layer.type !== 'text') return null;
  return <Editor key={id} layer={layer} />;
}

function Editor({ layer }: { layer: TextLayer }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Subscribing keeps the textarea glued to the node while the view zooms or pans.
  useUiStore((s) => s.zoom);
  useUiStore((s) => s.pan);

  const node = stageRefs.stage?.findOne(`#${layer.id}`);
  const t = node?.getAbsoluteTransform().decompose();

  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    fit();
    el.focus();
    el.select();
  }, []);
  useLayoutEffect(fit);

  const finish = () => {
    const editor = useEditorStore.getState();
    useUiStore.getState().set({ editingTextId: null });
    if (!ref.current?.value.trim()) editor.deleteLayers([layer.id]);
  };

  if (!t) return null;
  const color = layer.fill.type === 'solid' ? layer.fill.color : (layer.fill.stops[0]?.color ?? '#000000');

  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      defaultValue={layer.text}
      spellCheck={false}
      onInput={(e) => {
        fit();
        useEditorStore.getState().updateLayers([layer.id], { text: e.currentTarget.value }, { coalesce: 'text' });
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
      style={{
        position: 'absolute',
        left: t.x,
        top: t.y,
        width: layer.width,
        transformOrigin: '0 0',
        transform: `rotate(${t.rotation}deg) scale(${t.scaleX}, ${t.scaleY})`,
        fontFamily: fontStack(layer.fontFamily),
        fontSize: layer.fontSize,
        fontWeight: layer.fontWeight,
        fontStyle: layer.italic ? 'italic' : 'normal',
        textDecoration: layer.underline ? 'underline' : 'none',
        lineHeight: layer.lineHeight,
        letterSpacing: layer.letterSpacing,
        textAlign: layer.align,
        color,
        caretColor: color,
        padding: 0,
        margin: 0,
        border: 'none',
        outline: '1px dashed #3ddc97',
        outlineOffset: 2,
        background: 'transparent',
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
      }}
    />
  );
}
