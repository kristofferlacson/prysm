import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { checkAiService, PROVIDER_LABEL, useAiService } from '../../features/ai/aiService';
import { generativeFill } from '../../features/ai/generativeFill';
import { useUiStore } from '../../stores/uiStore';
import { TextButton } from '../ui/controls';

/**
 * Generative fill and object removal for the current selection. Both need the Prysm AI server;
 * when it is missing the controls are disabled and say why, rather than pretending to work.
 */
export function AiSelectionActions() {
  const { availability, job, provider } = useAiService(useShallow((s) => ({ availability: s.availability, job: s.job, provider: s.provider })));
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    void checkAiService();
  }, []);

  const ready = availability === 'ready';
  const where = provider ? (PROVIDER_LABEL[provider] ?? provider) : 'the AI provider';
  const why =
    availability === 'offline'
      ? 'These need the Prysm AI server, which is not running.'
      : availability === 'unconfigured'
        ? 'The AI server is running but has no provider key.'
        : availability === 'checking'
          ? 'Checking for the AI server…'
          : null;
  const fill = async () => {
    if (await generativeFill(prompt)) setPrompt('');
  };

  return (
    <div data-testid="ai-selection" data-availability={availability} className="space-y-2">
      <textarea
        aria-label="Describe the fill"
        placeholder="Describe what should appear in the selected area"
        value={prompt}
        maxLength={2000}
        rows={2}
        disabled={!ready || !!job}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void fill();
          }
        }}
        className="w-full resize-none rounded border border-line bg-raised px-2 py-1.5 text-ink outline-none focus:border-accent disabled:opacity-50"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <span title={why ?? 'Replace the selected area with what you described'}>
          <TextButton primary className="w-full !px-1" disabled={!ready || !!job || !prompt.trim()} onClick={() => void fill()}>
            <Sparkles size={13} /> Generative fill
          </TextButton>
        </span>
        <span title={why ?? 'Remove what is in the selected area and fill in the background'}>
          <TextButton className="w-full !px-1" disabled={!ready || !!job} onClick={() => void generativeFill(null)}>
            Remove object
          </TextButton>
        </span>
      </div>
      {job && (
        <p data-testid="ai-job" className="flex items-center gap-1.5 text-dim">
          <LoaderCircle size={13} className="animate-spin" /> {job}
        </p>
      )}
      {why && availability !== 'checking' && (
        <p className="leading-relaxed text-dim">
          {why}{' '}
          <button
            type="button"
            data-testid="ai-setup-link"
            className="text-accent underline"
            onClick={() => useUiStore.getState().set({ sidebarTab: 'ai', panelsHidden: false })}
          >
            How to set it up
          </button>
        </p>
      )}
      {ready && (
        <p className="leading-relaxed text-faint">
          Sends the visible area around the selection to {where} through your server. The result is added as a new layer, masked to the selection.
        </p>
      )}
    </div>
  );
}
