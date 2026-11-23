import { Aperture, WandSparkles } from 'lucide-react';
import { blurLayerBackground } from '../../features/background-removal/blurBackground';
import { openRemovalDialog } from '../../features/background-removal/removalSession';
import { useBackgroundRemoval } from '../../features/background-removal/removeBackground';
import type { ImageLayer } from '../../types/document';
import { TextButton } from '../ui/controls';

/**
 * Button + live status for background removal on one layer. Used in the properties panel and the AI panel.
 * The button opens the dialog in which what is kept and removed is chosen; a layer that already has
 * a cut-out opens with that cut-out, to change it.
 */
export function BackgroundRemovalControl({ layer }: { layer: ImageLayer }) {
  const job = useBackgroundRemoval((s) => s.job);
  const mine = job?.layerId === layer.id ? job : null;
  const busy = !!job && job.phase !== 'error' && job.phase !== 'done';
  const cutOut = layer.masks[0]?.origin === 'background-removal';

  return (
    <div className="space-y-1.5">
      <div data-testid="bg-removal">
        <TextButton primary className="w-full" disabled={busy} onClick={() => void openRemovalDialog(layer.id)}>
          <WandSparkles size={12} /> {mine && busy ? 'Working…' : cutOut ? 'Edit background removal' : 'Remove background'}
        </TextButton>
      </div>
      <div data-testid="bg-blur" title="Keep the subject sharp and blur what is behind it. Adds a blurred background layer underneath; the blur stays adjustable.">
        <TextButton className="w-full" disabled={busy} onClick={() => void blurLayerBackground(layer.id)}>
          <Aperture size={12} /> Blur background
        </TextButton>
      </div>
      {mine && (
        <div
          role="status"
          data-testid="bg-removal-status"
          data-phase={mine.phase}
          className={mine.phase === 'error' ? 'text-danger' : mine.phase === 'done' ? 'text-accent' : 'text-dim'}
        >
          {mine.message}
          {busy && mine.progress !== null && (
            <div className="mt-1 h-1 overflow-hidden rounded bg-hover">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(mine.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
