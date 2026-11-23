import { useEffect, useState } from 'react';
import { useLocalTools, type FillJob } from '../../features/inpaint/contentAwareFill';
import { expandImageLayer, sidesToCoverCanvas, type Sides } from '../../features/inpaint/localFill';
import { cancelUpscale, describeDuration, UPSCALE_MODEL, upscaleLayer, upscaleOptions, upscalerInstalled } from '../../features/upscale/upscale';
import { useAssetImage } from '../../services/assets';
import { useEditorStore } from '../../stores/editorStore';
import type { ImageLayer } from '../../types/document';
import { NumberInput, Section, TextButton } from '../ui/controls';

/** Live status of a job that runs in the browser (content-aware fill, expand, upscale). */
export function LocalJobStatus({ kind, layerId }: { kind: FillJob['kind']; layerId?: string }) {
  const job = useLocalTools((s) => s.job);
  if (!job || job.kind !== kind || (layerId && job.layerId !== layerId)) return null;
  return (
    <div role="status" data-testid="local-job" data-kind={kind} className="text-dim">
      {job.message}
      {job.progress !== null && (
        <div className="mt-1 h-1 overflow-hidden rounded bg-hover">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

const NO_SIDES: Sides = { left: 0, top: 0, right: 0, bottom: 0 };
const SIDE_FIELDS: { key: keyof Sides; prefix: string; label: string }[] = [
  { key: 'left', prefix: 'L', label: 'Expand left' },
  { key: 'right', prefix: 'R', label: 'Expand right' },
  { key: 'top', prefix: 'T', label: 'Expand top' },
  { key: 'bottom', prefix: 'B', label: 'Expand bottom' },
];

/** Grow the picture past its edges; the new area is built from the picture itself. */
export function ExpandSection({ layer }: { layer: ImageLayer }) {
  const [sides, setSides] = useState<Sides>(NO_SIDES);
  const busy = useLocalTools((s) => !!s.job);
  // The canvas size decides what "fill the canvas" means.
  useEditorStore((s) => `${s.doc.width}x${s.doc.height}`);
  const cover = sidesToCoverCanvas(layer);
  const coverNeeded = !!cover && cover.left + cover.top + cover.right + cover.bottom > 0;
  const any = sides.left + sides.top + sides.right + sides.bottom > 0;
  return (
    <Section title="Expand" defaultOpen={false}>
      <p className="leading-relaxed text-dim">
        Grows the picture past its edges and builds the new area out of the picture itself. It runs in your browser: no AI service, nothing uploaded.
      </p>
      <div className="grid grid-cols-2 gap-1.5" data-testid="expand-sides">
        {SIDE_FIELDS.map((f) => (
          <NumberInput key={f.key} prefix={f.prefix} label={f.label} value={sides[f.key]} min={0} max={4000} onChange={(v) => setSides({ ...sides, [f.key]: v })} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <span title="Expand by the amounts above (pixels, on the image’s own sides)">
          <TextButton className="w-full !px-1" disabled={busy || !any} onClick={() => void expandImageLayer(layer.id, sides).then((ok) => ok && setSides(NO_SIDES))}>
            Expand sides
          </TextButton>
        </span>
        <span title={coverNeeded ? 'Expand just far enough to cover the whole canvas' : 'This image already covers the canvas'}>
          <TextButton primary className="w-full !px-1" disabled={busy || !coverNeeded} onClick={() => cover && void expandImageLayer(layer.id, cover)}>
            Fill the canvas
          </TextButton>
        </span>
      </div>
      {!coverNeeded && <p className="text-faint">This image already covers the canvas.</p>}
      <LocalJobStatus kind="expand" layerId={layer.id} />
      <p className="leading-relaxed text-faint">
        Works best where the edges are sky, ground, walls, water or texture. It continues what is there; it cannot invent new objects. The original stays in Uploads.
      </p>
    </Section>
  );
}

/** Make the picture larger and sharper with the in-browser super-resolution model. */
export function UpscaleSection({ layer }: { layer: ImageLayer }) {
  const [hasModel, setHasModel] = useState<boolean | null>(null);
  useEffect(() => {
    void upscalerInstalled().then(setHasModel);
  }, []);
  const job = useLocalTools((s) => s.job);
  // Re-render once the image has loaded, so its size is known.
  useAssetImage(layer.source.kind === 'asset' ? layer.source.assetId : null);
  const { options, size, reason } = upscaleOptions(layer);
  const mine = job?.kind === 'upscale' && job.layerId === layer.id;
  return (
    <Section title="Upscale" defaultOpen={false}>
      <p className="leading-relaxed text-dim">
        Makes the picture larger and sharper with a small model that runs in your browser: no AI service, nothing uploaded.
      </p>
      {size && (
        <p data-testid="upscale-size" className="tabular-nums text-dim">
          Now {size.width} × {size.height} px
        </p>
      )}
      {reason && <p className="leading-relaxed text-faint">{reason}</p>}
      {options.map((o) => (
        <TextButton key={o.factor} className="w-full !justify-between" disabled={!!job || hasModel === false} onClick={() => void upscaleLayer(layer.id, o.factor)}>
          <span>
            {o.factor}× to {o.width} × {o.height} px
          </span>
          <span className="font-normal text-dim">about {describeDuration(o.seconds)}</span>
        </TextButton>
      ))}
      {hasModel === false && (
        <p className="leading-relaxed text-danger">
          The upscaling model is not installed on this server. Run <code>npm run setup:ai</code>.
        </p>
      )}
      <LocalJobStatus kind="upscale" layerId={layer.id} />
      {mine && (
        <TextButton className="w-full" onClick={cancelUpscale}>
          Cancel
        </TextButton>
      )}
      <p className="leading-relaxed text-faint">
        {UPSCALE_MODEL.label} (5 MB, downloaded once). {UPSCALE_MODEL.source}. Licence: {UPSCALE_MODEL.license}. Both sizes take the same time: the
        model always works at 4×.
      </p>
    </Section>
  );
}
