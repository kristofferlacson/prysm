import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { checkAiService, PROVIDER_LABEL, useAiService } from '../../../features/ai/aiService';
import { generateImage } from '../../../features/ai/generativeFill';
import { MODELS, type ModelId } from '../../../features/background-removal/models';
import { detectModels, useBackgroundRemoval, type RemovalMethod } from '../../../features/background-removal/removeBackground';
import { useSelectedLayers } from '../../../stores/editorStore';
import { BackgroundRemovalControl } from '../../properties/BackgroundRemovalControl';
import { Row, Segmented, Select, Switch, TextButton } from '../../ui/controls';
import { Heading, PanelShell } from './shared';

const megabytes = (bytes: number) => `${Math.round(bytes / 1_048_576)} MB`;

/** Tools that need no server, account or subscription: they run on this computer. */
const LOCAL_TOOLS: { name: string; where: string; what: string }[] = [
  { name: 'Remove an object', where: 'Select tab (right) → Content-aware fill', what: 'Select it; the area is rebuilt from its surroundings as a new layer.' },
  { name: 'Expand an image', where: 'Layout tab (right) → Expand', what: 'Grow a picture past its edges, or to fill the canvas in one click.' },
  { name: 'Upscale an image', where: 'Layout tab (right) → Upscale', what: 'Make a picture 2× or 4× larger and sharper with the Real-ESRGAN model.' },
  { name: 'Select the subject', where: 'Select tab (right) → Select subject', what: 'Turn the main subject of a photo into a selection.' },
];

const SHAPES = [
  { value: '1024x1024', label: 'Square' },
  { value: '1536x1024', label: 'Wide' },
  { value: '1024x1536', label: 'Tall' },
];

/** The tools that run on a hosted model, reached through the Prysm AI server. */
function GenerativeCard() {
  const { availability, provider, model, sizes, job } = useAiService(
    useShallow((s) => ({ availability: s.availability, provider: s.provider, model: s.model, sizes: s.sizes, job: s.job })),
  );
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  useEffect(() => {
    void checkAiService();
  }, []);
  const ready = availability === 'ready';
  const where = provider ? (PROVIDER_LABEL[provider] ?? provider) : 'the AI provider';
  const shapes = SHAPES.filter((s) => !sizes.length || sizes.includes(s.value));

  return (
    <div className="space-y-2.5 px-3 pb-3" data-testid="ai-generative">
      <div data-testid="ai-service-status" data-availability={availability} className="rounded border border-line p-2 leading-relaxed">
        {availability === 'checking' && <span className="text-dim">Checking for the AI server…</span>}
        {ready && (
          <span className="text-dim">
            <b className="text-accent">Connected.</b> Requests go to {where}
            {model ? ` (${model})` : ''} through your Prysm server. The API key stays on that server.
          </span>
        )}
        {(availability === 'offline' || availability === 'unconfigured') && (
          <div className="space-y-1.5 text-dim">
            <div className="font-semibold text-ink">{availability === 'offline' ? 'The AI server is not running' : 'The AI server has no provider key'}</div>
            <p>These tools use a hosted image model. Its API key must stay on a server, so the editor talks to a small one that ships with Prysm:</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>
                Copy <code>.env.example</code> to <code>.env</code> and put your OpenAI API key in it.
              </li>
              <li>
                Run <code>npm run server</code>{availability === 'unconfigured' ? ' again' : ''}.
              </li>
            </ol>
            <TextButton onClick={() => void checkAiService()} className="w-full">
              Check again
            </TextButton>
          </div>
        )}
      </div>

      <p className="leading-relaxed text-dim">
        Only creating something <i>new</i> from a description needs a hosted model. Removing objects, expanding and upscaling work without one (above).
      </p>
      <div className="space-y-1.5">
        <div className="font-semibold text-ink">Generative fill &amp; object removal</div>
        <p className="leading-relaxed text-dim">
          Select an area with the marquee, lasso or magic wand, then choose <b>Generative fill</b> or <b>Remove object</b> in the Select tab on the right. The
          result arrives as a new layer masked to your selection; nothing underneath is changed.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="font-semibold text-ink">Generate an image</div>
        <textarea
          aria-label="Image description"
          placeholder="Describe the image you want"
          value={prompt}
          maxLength={2000}
          rows={3}
          disabled={!ready || !!job}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full resize-none rounded border border-line bg-raised px-2 py-1.5 text-ink outline-none focus:border-accent disabled:opacity-50"
        />
        <Segmented value={size} options={shapes} onChange={setSize} />
        <TextButton primary className="w-full" disabled={!ready || !!job || !prompt.trim()} onClick={() => void generateImage(prompt, size)}>
          {job ? <LoaderCircle size={13} className="animate-spin" /> : <Sparkles size={13} />} {job ?? 'Generate image'}
        </TextButton>
        {!ready && availability !== 'checking' && <p className="text-faint">Available once the AI server is set up (above).</p>}
      </div>
      <p className="leading-relaxed text-faint">
        Privacy: these tools send your description and, for fill and removal, the visible part of your design around the selection to {where}. Usage is billed
        to the account the key belongs to.
      </p>
    </div>
  );
}

function BackgroundRemovalCard() {
  const selected = useSelectedLayers();
  const { method, model, available, refineEdges, lastRun } = useBackgroundRemoval(
    useShallow((s) => ({ method: s.method, model: s.model, available: s.available, refineEdges: s.refineEdges, lastRun: s.lastRun })),
  );
  const store = useBackgroundRemoval.getState();
  const layer = selected.length === 1 && selected[0].type === 'image' ? selected[0] : null;
  const info = MODELS[model];

  useEffect(() => {
    void detectModels();
  }, []);

  const options = (Object.keys(MODELS) as ModelId[]).map((id) => ({
    value: id,
    label: `${MODELS[id].label} — ${megabytes(MODELS[id].bytes)}${available && !available.includes(id) ? ' (not installed)' : ''}`,
  }));

  return (
    <div className="space-y-2 px-3 pb-3" data-testid="ai-background-removal">
      <p className="text-dim">
        Finds the main subject and suggests hiding everything else. In the dialog that opens you choose what stays and what goes, by clicking the things in
        the picture or painting, before anything is applied. It runs entirely in your browser: the image is not uploaded anywhere, and the original pixels
        are kept.
      </p>
      {layer ? (
        <BackgroundRemovalControl layer={layer} />
      ) : (
        <p className="rounded bg-raised px-2 py-1.5 text-dim">Select one image layer to remove its background.</p>
      )}
      <Row label="Method">
        <Select<RemovalMethod>
          label="Background removal method"
          value={method}
          options={[
            { value: 'auto', label: 'Automatic' },
            { value: 'subject', label: 'Find the subject (photos)' },
            { value: 'plain', label: 'Plain background (logos)' },
          ]}
          onChange={(v) => store.set({ method: v })}
        />
      </Row>
      <p className="leading-relaxed text-faint">
        Automatic removes a plain backdrop by its colour (exact edges, and enclosed areas of that colour are kept) and uses the model below for everything
        else.
      </p>
      <Row label="Model">
        <Select label="Segmentation model" value={model} options={options} onChange={(id) => store.set({ model: id })} />
      </Row>
      <Row label="Refine">
        <Switch label="Refine edges" checked={refineEdges} onChange={(v) => store.set({ refineEdges: v })} />
        <span className="text-faint">Snap the mask to edges in the photo</span>
      </Row>
      <div className="rounded border border-line p-2 leading-relaxed text-faint">
        <div className="text-dim">{info.note}</div>
        <div>
          {megabytes(info.bytes)} download on first use, then cached · input {info.inputSize} px
        </div>
        <div>{info.source}</div>
        <div>Licence: {info.license}</div>
        {available && !available.includes(model) && (
          <div className="mt-1 text-danger">
            This model is not installed on this server. Run <code>npm run setup:ai{model === 'isnet-general-use' ? ' -- --all' : ''}</code>.
          </div>
        )}
        {lastRun && (
          <div className="mt-1 text-dim" data-testid="bg-last-run">
            Last run: {(lastRun.totalMs / 1000).toFixed(1)} s ({MODELS[lastRun.model].label}, {lastRun.threads} thread{lastRun.threads === 1 ? '' : 's'})
          </div>
        )}
      </div>
      <p className="text-faint">Needs a browser with WebAssembly (all current browsers). Large models use a few hundred MB of memory while running.</p>
    </div>
  );
}

export function AiPanel() {
  return (
    <PanelShell title="AI tools">
      <Heading>Background removal</Heading>
      <BackgroundRemovalCard />
      <Heading>More that runs in your browser</Heading>
      <div className="space-y-2 px-3 pb-3" data-testid="ai-local-tools">
        <p className="leading-relaxed text-dim">No server, account or subscription: these work on your computer, and nothing is uploaded.</p>
        {LOCAL_TOOLS.map((tool) => (
          <div key={tool.name} className="rounded border border-line p-2 leading-relaxed">
            <div className="font-semibold text-ink">{tool.name}</div>
            <div className="text-dim">{tool.what}</div>
            <div className="text-faint">{tool.where}</div>
          </div>
        ))}
      </div>
      <Heading>Generative AI</Heading>
      <GenerativeCard />

    </PanelShell>
  );
}
