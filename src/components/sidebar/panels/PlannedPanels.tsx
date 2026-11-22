import { NotImplemented } from '../../ui/controls';
import { PanelShell } from './shared';

/** Features that depend on external services. They are described here rather than faked. */

export function PhotosPanel() {
  return (
    <PanelShell title="Photos">
      <NotImplemented title="Stock photo search">
        <p>Searching a stock library needs a provider API (for example Unsplash or Pexels) and an API key held on a server.</p>
        <p>Until that integration exists, add your own pictures from the Uploads tab.</p>
      </NotImplemented>
    </PanelShell>
  );
}

const AI_TOOLS: { name: string; needs: string }[] = [
  { name: 'Background removal', needs: 'A segmentation model (in-browser ONNX/WASM model or a hosted API) plus the layer-mask system. First item of Milestone 2.' },
  { name: 'Smart subject selection', needs: 'The same segmentation model, feeding the selection tools.' },
  { name: 'Object removal & generative fill', needs: 'A hosted inpainting model behind a server endpoint.' },
  { name: 'Image expansion', needs: 'A hosted outpainting model behind a server endpoint.' },
  { name: 'Image upscaling & enhancement', needs: 'A super-resolution model (hosted, or WebGPU in the browser).' },
  { name: 'Image generation', needs: 'A text-to-image API called from a server so the key never reaches the browser.' },
];

export function AiPanel() {
  return (
    <PanelShell title="AI tools">
      <p className="px-3 pt-3 text-dim">
        None of these tools work yet. Each needs a real model or service, listed below, and none are simulated.
      </p>
      {AI_TOOLS.map((tool) => (
        <NotImplemented key={tool.name} title={tool.name}>
          <p>{tool.needs}</p>
        </NotImplemented>
      ))}
    </PanelShell>
  );
}
