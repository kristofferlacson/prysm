import { useMemo, useState } from 'react';
import { TEMPLATES, type Template } from '../../../features/templates/templates';
import { useEditorStore } from '../../../stores/editorStore';
import { askConfirm, useUiStore } from '../../../stores/uiStore';
import { Chips, PanelShell, tileClass } from './shared';

async function applyTemplate(t: Template) {
  if (useEditorStore.getState().doc.layers.length) {
    const ok = await askConfirm({
      title: 'Replace this design?',
      message: `“${t.name}” will replace the canvas size, background and every layer of the current design. You can undo this with Ctrl+Z.`,
      confirmLabel: 'Replace design',
    });
    if (!ok) return;
  }
  const editor = useEditorStore.getState();
  editor.replaceContent({ width: t.width, height: t.height, ...t.build() });
  useUiStore.getState().fitToScreen(t.width, t.height);
}

export function TemplatesPanel() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const categories = useMemo(() => ['All', ...new Set(TEMPLATES.map((t) => t.category))], []);
  const q = query.trim().toLowerCase();
  const shown = TEMPLATES.filter(
    (t) => (category === 'All' || t.category === category) && (!q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)),
  );
  return (
    <PanelShell title="Templates" query={query} onQuery={setQuery} placeholder="Search templates">
      <Chips value={category} options={categories} onChange={setCategory} />
      <div className="grid grid-cols-2 gap-2 p-3">
        {shown.map((t) => (
          <button key={t.id} type="button" data-template={t.id} onClick={() => void applyTemplate(t)} className={`${tileClass} flex flex-col`}>
            <span className="flex h-24 w-full items-center justify-center bg-bg p-2">
              <span
                className="block max-h-full max-w-full rounded-sm shadow shadow-black/40"
                style={{ background: t.preview, aspectRatio: `${t.width} / ${t.height}`, height: t.height >= t.width ? '100%' : undefined, width: t.width > t.height ? '100%' : undefined }}
              />
            </span>
            <span className="px-2 pb-0.5 pt-1.5 font-medium text-ink">{t.name}</span>
            <span className="px-2 pb-2 text-[10px] text-faint">
              {t.width} × {t.height}
            </span>
          </button>
        ))}
      </div>
      {!shown.length && <p className="px-3 text-faint">No templates match “{query}”.</p>}
      <p className="px-3 pb-3 text-faint">
        Applying a template replaces the canvas size, background and layers. Every element stays editable. Cards show a colour sketch, not a rendered preview.
      </p>
    </PanelShell>
  );
}
