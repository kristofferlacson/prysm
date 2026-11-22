import { useCallback, useEffect, useState } from 'react';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { CANVAS_PRESETS } from '../../features/projects/presets';
import { deleteProject, duplicateProject, newProject, openProject, renameProject, saveNow } from '../../features/projects/projects';
import { projectRepository, type ProjectSummary } from '../../services/storage/projectRepository';
import { useEditorStore } from '../../stores/editorStore';
import { NumberInput, Select, TextButton } from '../ui/controls';
import { Modal } from './Modal';

function formatWhen(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function NewProjectForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('Untitled design');
  const [presetId, setPresetId] = useState('square');
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  return (
    <div className="border-b border-line p-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">New project</h3>
      <div className="grid grid-cols-[1fr_1fr_88px_88px_auto] items-center gap-2">
        <input
          aria-label="New project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-6 min-w-0 rounded bg-raised px-1.5 outline-none focus:outline focus:outline-1 focus:outline-accent"
        />
        <Select
          label="Canvas preset"
          value={presetId}
          options={[{ value: 'custom', label: 'Custom size' }, ...CANVAS_PRESETS.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={(id) => {
            setPresetId(id);
            const p = CANVAS_PRESETS.find((x) => x.id === id);
            if (p) {
              setWidth(p.width);
              setHeight(p.height);
            }
          }}
        />
        <NumberInput prefix="W" label="New canvas width" value={width} min={16} max={12000} onChange={(v) => { setWidth(Math.round(v)); setPresetId('custom'); }} />
        <NumberInput prefix="H" label="New canvas height" value={height} min={16} max={12000} onChange={(v) => { setHeight(Math.round(v)); setPresetId('custom'); }} />
        <TextButton
          primary
          onClick={async () => {
            await newProject(name.trim() || 'Untitled design', width, height);
            onCreated();
          }}
        >
          <Plus size={13} /> Create
        </TextButton>
      </div>
    </div>
  );
}

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const currentId = useEditorStore((s) => s.doc.id);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const refresh = useCallback(async () => setProjects(await projectRepository.list()), []);

  useEffect(() => {
    // Make sure the open project (and its thumbnail) is current before listing.
    void saveNow().then(refresh);
  }, [refresh]);

  return (
    <Modal title="Projects" onClose={onClose} width={760}>
      <NewProjectForm onCreated={onClose} />
      <div className="p-4" data-testid="project-list">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-dim">Recent projects</h3>
        {projects === null && <p className="text-faint">Loading…</p>}
        {projects?.length === 0 && <p className="text-faint">No saved projects yet.</p>}
        <div className="grid grid-cols-3 gap-3">
          {projects?.map((p) => (
            <div
              key={p.id}
              data-testid="project-card"
              className={`overflow-hidden rounded border bg-raised ${p.id === currentId ? 'border-accent' : 'border-line'}`}
            >
              <button
                type="button"
                title={`Open ${p.name}`}
                aria-label={`Open ${p.name}`}
                onClick={async () => {
                  if (p.id !== currentId) await openProject(p.id);
                  onClose();
                }}
                className="checker flex h-32 w-full items-center justify-center"
              >
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="bg-panel px-2 py-1 text-faint">No preview</span>
                )}
              </button>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  {renamingId === p.id ? (
                    <input
                      autoFocus
                      aria-label="Project name"
                      defaultValue={p.name}
                      onFocus={(e) => e.target.select()}
                      onBlur={async (e) => {
                        const name = e.target.value.trim();
                        setRenamingId(null);
                        if (name && name !== p.name) {
                          await renameProject(p.id, name);
                          await refresh();
                        }
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      className="h-5 w-full rounded bg-bg px-1 outline outline-1 outline-accent"
                    />
                  ) : (
                    <div className="truncate font-medium">{p.name}</div>
                  )}
                  <div className="truncate text-[10px] text-faint">
                    {p.width} × {p.height} · {p.id === currentId ? 'open now' : formatWhen(p.updatedAt)}
                  </div>
                </div>
                <button type="button" title="Rename" aria-label={`Rename ${p.name}`} onClick={() => setRenamingId(p.id)} className="p-1 text-faint hover:text-ink">
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  title="Duplicate"
                  aria-label={`Duplicate ${p.name}`}
                  onClick={async () => {
                    await duplicateProject(p.id);
                    await refresh();
                  }}
                  className="p-1 text-faint hover:text-ink"
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  title="Delete"
                  aria-label={`Delete ${p.name}`}
                  onClick={async () => {
                    if (!window.confirm(`Delete “${p.name}”? This cannot be undone.`)) return;
                    await deleteProject(p.id);
                    await refresh();
                  }}
                  className="p-1 text-faint hover:text-danger"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-faint">
          Projects are saved automatically in this browser (IndexedDB). Version history and cloud sync are not implemented yet.
        </p>
      </div>
    </Modal>
  );
}
