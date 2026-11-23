import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, FolderOpen, Plus } from 'lucide-react';
import { GUIDE_MAP } from '../../features/guide/guide';
import { CANVAS_PRESETS } from '../../features/projects/presets';
import { newProject, openProject } from '../../features/projects/projects';
import { TEMPLATES, type Template } from '../../features/templates/templates';
import { projectRepository, type ProjectSummary } from '../../services/storage/projectRepository';
import { useEditorStore } from '../../stores/editorStore';
import { openGuide, showEditor, useUiStore } from '../../stores/uiStore';
import { Logo } from '../editor/TopBar';

/**
 * The home page's picture: a glass prism with a band of spectrum crossing it. Drawn here as vector
 * shapes (it is the editor's own triangle mark, enlarged), so it is sharp at any size and belongs
 * to the project rather than to a stock library.
 */
function PrismArt() {
  return (
    <svg viewBox="0 0 800 380" role="img" aria-label="A glass prism crossed by a band of spectrum light" className="block h-full w-full" preserveAspectRatio="xMidYMid slice">
      <defs>
        <radialGradient id="prism-glow" cx="50%" cy="78%" r="70%">
          <stop offset="0" stopColor="#1b2130" />
          <stop offset="1" stopColor="#07080b" />
        </radialGradient>
        <linearGradient id="prism-spectrum" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5d6c" />
          <stop offset="0.2" stopColor="#ffb347" />
          <stop offset="0.4" stopColor="#f5e663" />
          <stop offset="0.6" stopColor="#3ddc97" />
          <stop offset="0.8" stopColor="#6ea8ff" />
          <stop offset="1" stopColor="#b48cff" />
        </linearGradient>
        <linearGradient id="prism-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="0.62" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="prism-beam-mask">
          <rect x="-300" y="-60" width="1400" height="120" fill="url(#prism-fade)" />
        </mask>
        <linearGradient id="prism-left" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id="prism-right" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.08" />
        </linearGradient>
        <filter id="prism-soft" x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
        <filter id="prism-softer" x="-20%" y="-300%" width="140%" height="700%">
          <feGaussianBlur stdDeviation="22" />
        </filter>
      </defs>
      <rect width="800" height="380" fill="url(#prism-glow)" />
      {/* The band of light, running up from the lower left, through the prism, to the upper right. */}
      <g transform="translate(400 262) rotate(-27)">
        <g mask="url(#prism-beam-mask)">
          <rect x="-300" y="-30" width="1400" height="60" fill="url(#prism-spectrum)" filter="url(#prism-softer)" opacity="0.4" />
          <rect x="-300" y="-8" width="1400" height="16" fill="url(#prism-spectrum)" filter="url(#prism-soft)" />
        </g>
      </g>
      {/* The prism: two faces meeting on a centre edge. */}
      <path d="M400 96 L230 400 L400 400 Z" fill="url(#prism-left)" />
      <path d="M400 96 L570 400 L400 400 Z" fill="url(#prism-right)" />
      <path d="M400 96 L230 400 M400 96 L570 400 M400 96 L400 400" fill="none" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="1.4" />
      <path d="M400 252 L514 400" fill="none" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="1.2" />
    </svg>
  );
}

const when = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(time).toLocaleDateString();
};

/** What the editor can do, as doors into the guide. */
const HIGHLIGHTS = ['remove-background', 'magic-eraser', 'blur-background', 'expand', 'upscale', 'curves', 'select', 'clip', 'text-shape', 'textures', 'effects', 'export'];
const HOME_TEMPLATES = ['gig-poster', 'album-cover', 'social-quote', 'youtube-thumb', 'event-flyer', 'neon-night', 'invitation', 'certificate'];

const heading = 'mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-dim';
const card = 'rounded-lg border border-line bg-panel text-left transition-colors hover:border-accent/60 hover:bg-raised';

/**
 * The home page: what Prysm is, and the ways into it — carry on with the open design, start a new
 * one from a size or a template, reopen a recent project, or learn how something is done.
 */
export function Home() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const current = useEditorStore((s) => s.doc);
  const saveStatus = useUiStore((s) => s.saveStatus);

  // The list is read again whenever a save completes, so the open design's thumbnail is current.
  useEffect(() => {
    if (saveStatus !== 'saved') return;
    let cancelled = false;
    void projectRepository.list().then((list) => !cancelled && setProjects([...list].sort((a, b) => b.updatedAt - a.updatedAt)));
    return () => {
      cancelled = true;
    };
  }, [saveStatus]);

  const run = (action: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      showEditor();
    } finally {
      setBusy(false);
    }
  };
  /** A fresh design of this size. An untouched blank project is reused rather than left behind as clutter. */
  const start = async (name: string, width: number, height: number, template?: Template) => {
    const editor = useEditorStore.getState();
    if (editor.doc.layers.length === 0 && editor.past.length === 0) editor.setDocument({ name, width, height }, { history: false });
    else await newProject(name, width, height);
    if (template) {
      useEditorStore.getState().replaceContent({ width, height, ...template.build() });
      // The template is the starting point of this project, not a step to undo back past.
      useEditorStore.setState({ past: [], future: [] });
    }
  };

  const templates = HOME_TEMPLATES.map((id) => TEMPLATES.find((t) => t.id === id)).filter((t): t is Template => !!t);
  const recent = (projects ?? []).slice(0, 8);
  const hasWork = current.layers.length > 0;

  return (
    <div data-testid="home" className="ui-scale fixed inset-0 z-40 overflow-y-auto bg-bg text-ink">
      <header className="mx-auto flex h-14 max-w-[1080px] items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-[15px] font-bold tracking-tight">Prysm</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" data-testid="home-guide" onClick={() => openGuide()} className="flex h-8 items-center gap-1.5 rounded-md px-3 text-dim hover:bg-raised hover:text-ink">
            <BookOpen size={14} /> How to use it
          </button>
          <button type="button" data-testid="home-open-editor" onClick={showEditor} className="flex h-8 items-center gap-1.5 rounded-md bg-raised px-3 font-medium hover:bg-hover">
            Open the editor <ArrowRight size={14} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] space-y-12 px-6 pb-16">
        <section className="overflow-hidden rounded-2xl border border-line bg-panel">
          <div className="px-6 pb-7 pt-9 text-center">
            <div className="text-[22px] font-extrabold tracking-[0.18em]">PRYSM</div>
            <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-tight">Your ideas. Your canvas.</h1>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-dim">A creative space for image editing and graphic design.</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              {hasWork && (
                <button type="button" data-testid="home-continue" onClick={showEditor} className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-ink hover:brightness-110">
                  Continue “{current.name}” <ArrowRight size={15} />
                </button>
              )}
              <a href="#home-sizes" className={`flex h-10 items-center gap-2 rounded-md px-4 text-[13px] font-semibold ${hasWork ? 'bg-raised hover:bg-hover' : 'bg-accent text-accent-ink hover:brightness-110'}`}>
                <Plus size={15} /> Start a new design
              </a>
              <button type="button" onClick={() => useUiStore.getState().set({ dialog: 'projects' })} className="flex h-10 items-center gap-2 rounded-md bg-raised px-4 text-[13px] font-semibold hover:bg-hover">
                <FolderOpen size={15} /> All projects
              </button>
            </div>
          </div>
          <div className="h-[300px] border-t border-line">
            <PrismArt />
          </div>
          <div className="border-t border-line py-3 text-center text-[11px] tracking-[0.16em] text-dim">CREATIVE TOOLS · IMAGE EDITING · DESIGN</div>
        </section>

        <section id="home-sizes" className="scroll-mt-6">
          <h2 className={heading}>Start a new design</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {CANVAS_PRESETS.map((preset) => (
              <button key={preset.id} type="button" data-home-preset={preset.id} disabled={busy} onClick={run(() => start('Untitled design', preset.width, preset.height))} className={`${card} flex items-center gap-3 p-3`}>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-bg">
                  <span
                    className="block rounded-[2px] border border-dim/70"
                    style={{ width: preset.width >= preset.height ? 30 : (30 * preset.width) / preset.height, height: preset.height >= preset.width ? 30 : (30 * preset.height) / preset.width }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{preset.name}</span>
                  <span className="block text-[11px] tabular-nums text-faint">
                    {preset.width} × {preset.height}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {recent.length > 0 && (
          <section>
            <h2 className={heading}>Recent projects</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {recent.map((project) => (
                <button key={project.id} type="button" data-home-project={project.id} disabled={busy} onClick={run(async () => void (await openProject(project.id)))} className={`${card} overflow-hidden`}>
                  <span className="flex h-32 items-center justify-center bg-bg p-2">
                    {project.thumbnail ? <img src={project.thumbnail} alt="" className="max-h-full max-w-full rounded-sm shadow shadow-black/50" /> : <span className="text-faint">No preview</span>}
                  </span>
                  <span className="block px-3 pb-2.5 pt-2">
                    <span className="block truncate font-medium">{project.name}</span>
                    <span className="block text-[11px] text-faint">
                      {project.width} × {project.height} · {when(project.updatedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className={heading}>Start from a template</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {templates.map((t) => (
              <button key={t.id} type="button" data-home-template={t.id} disabled={busy} onClick={run(() => start(t.name, t.width, t.height, t))} className={`${card} overflow-hidden`}>
                <span className="flex h-32 items-center justify-center bg-bg p-3">
                  <span
                    className="block max-h-full max-w-full rounded-sm shadow shadow-black/50"
                    style={{ background: t.preview, aspectRatio: `${t.width} / ${t.height}`, height: t.height >= t.width ? '100%' : undefined, width: t.width > t.height ? '100%' : undefined }}
                  />
                </span>
                <span className="block px-3 pb-2.5 pt-2">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block text-[11px] text-faint">
                    {t.category} · {t.width} × {t.height}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint">Cards show a colour sketch of each template. More are in the Templates tab of the editor.</p>
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className={`${heading} !mb-0`}>What you can do, and how</h2>
            <button type="button" onClick={() => openGuide()} className="text-[12px] text-accent hover:underline">
              See the whole guide
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {HIGHLIGHTS.map((id) => {
              const topic = GUIDE_MAP.get(id);
              if (!topic) return null;
              return (
                <button key={id} type="button" data-home-topic={id} onClick={() => openGuide(id)} className={`${card} p-3.5`}>
                  <span className="block font-medium">{topic.title}</span>
                  <span className="mt-1 block leading-relaxed text-dim">{topic.summary}</span>
                </button>
              );
            })}
          </div>
        </section>

        <footer className="border-t border-line pt-5 text-[11px] leading-relaxed text-faint">
          Your projects, uploads and fonts are stored in this browser, on this computer. Background removal, object removal, expanding and upscaling run here too; nothing is uploaded.
          Only the optional generative AI tools send anything anywhere.
        </footer>
      </main>
    </div>
  );
}
