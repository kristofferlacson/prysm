import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { GUIDE, GUIDE_CATEGORIES, GUIDE_MAP, searchGuide, type GuideTopic } from '../../features/guide/guide';
import { showEditor, useUiStore } from '../../stores/uiStore';
import { GuideDemo } from './GuideDemo';
import { Modal } from './Modal';

function TopicButton({ topic, active, onPick }: { topic: GuideTopic; active: boolean; onPick: (id: string) => void }) {
  return (
    <button
      type="button"
      data-guide-topic={topic.id}
      aria-current={active}
      onClick={() => onPick(topic.id)}
      className={`block w-full truncate rounded px-2.5 py-1.5 text-left ${active ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-raised hover:text-ink'}`}
    >
      {topic.title}
    </button>
  );
}

/**
 * The guide: how to do each thing in the editor, step by step. Opened from the "?" in the top bar,
 * from the home page, from F1, and from the small "?" next to a panel or section title (which
 * opens it at the matching entry).
 */
export function GuideDialog() {
  const guide = useUiStore((s) => s.guide);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  // Opening the guide at a topic shows that topic, whatever was being read last time.
  useEffect(() => {
    if (guide) {
      setPicked(guide.topic);
      setQuery('');
    }
  }, [guide]);
  const results = useMemo(() => searchGuide(query), [query]);
  if (!guide) return null;

  const close = () => useUiStore.getState().set({ guide: null });
  const topic = (picked && GUIDE_MAP.get(picked)) || results[0] || GUIDE[0];
  const show = () => {
    if (!topic.show) return;
    const ui = useUiStore.getState();
    ui.set({ guide: null, panelsHidden: false, ...(topic.show.tool ? { tool: topic.show.tool } : {}), ...(topic.show.tab ? { sidebarTab: topic.show.tab } : {}) });
    showEditor();
  };

  return (
    <Modal title="Guide: how to do things in Prysm" onClose={close} width={1120}>
      <div data-testid="guide" className="flex h-[min(720px,78vh)]">
        <div className="flex w-[280px] shrink-0 flex-col border-r border-line">
          <label className="m-3 flex h-8 shrink-0 items-center gap-2 rounded-md bg-raised px-2.5 focus-within:outline focus-within:outline-1 focus-within:outline-accent">
            <Search size={12} className="text-faint" />
            <input
              autoFocus
              aria-label="Search the guide"
              placeholder="What do you want to do?"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
              }}
              className="w-full bg-transparent outline-none placeholder:text-faint"
            />
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {query.trim() ? (
              <>
                {results.map((t) => (
                  <TopicButton key={t.id} topic={t} active={t.id === topic.id} onPick={setPicked} />
                ))}
                {!results.length && <p className="px-2.5 py-2 text-faint">Nothing in the guide matches “{query}”. Try a simpler word, such as “crop” or “background”.</p>}
              </>
            ) : (
              GUIDE_CATEGORIES.map((category) => (
                <div key={category} className="mb-2">
                  <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{category}</div>
                  {GUIDE.filter((t) => t.category === category).map((t) => (
                    <TopicButton key={t.id} topic={t} active={t.id === topic.id} onPick={setPicked} />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <article data-testid="guide-topic" data-topic={topic.id} className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">{topic.category}</div>
          <h3 className="mt-1 text-[19px] font-semibold tracking-tight">{topic.title}</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-dim">{topic.summary}</p>
          {topic.needs && <p className="mt-3 rounded border border-line bg-raised px-3 py-2 leading-relaxed text-dim">{topic.needs}</p>}

          <ol className="mt-5 space-y-3">
            {topic.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{i + 1}</span>
                <span className="text-[13px] leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          <GuideDemo topic={topic.id} />

          {topic.tips && (
            <div className="mt-5 space-y-1.5 rounded border border-line p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-faint">Good to know</div>
              {topic.tips.map((tip, i) => (
                <p key={i} className="leading-relaxed text-dim">
                  {tip}
                </p>
              ))}
            </div>
          )}

          {topic.shortcuts && (
            <div className="mt-5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">Shortcuts</div>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
                {topic.shortcuts.map((s) => (
                  <div key={s.keys} className="contents">
                    <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-sans text-[11px] text-ink">{s.keys}</kbd>
                    <span className="text-dim">{s.does}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {topic.show && (
            <button type="button" data-testid="guide-show" onClick={show} className="mt-6 flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-[13px] font-semibold text-accent-ink hover:brightness-110">
              {topic.show.label} <ArrowRight size={15} />
            </button>
          )}
        </article>
      </div>
    </Modal>
  );
}
