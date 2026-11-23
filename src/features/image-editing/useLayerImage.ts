import { useMemo, useRef } from 'react';
import type { ImageLayer } from '../../types/document';
import { useAssetImage } from '../../services/assets';
import { useRaster, useRasters } from '../../services/rasters';
import { useToolStore } from '../../stores/toolStore';
import { useUiStore } from '../../stores/uiStore';
import { hashString } from '../../utils/misc';
import { renderGenerated } from '../generators/render';
import { applyFade, isEmptyFade } from './fade';
import {
  composeMasks,
  FULL_MAX_DIM,
  PREVIEW_MAX_DIM,
  renderImage,
  renderMaskView,
  sourceSize,
  type MaskInput,
  type RasterSource,
} from './pipeline';

export interface LayerImage {
  image: RasterSource | null;
  status: 'loading' | 'ready' | 'missing';
}

/**
 * Resolves an image layer to the raster the canvas should draw:
 *
 *   source (asset | generated | raster)  ->  crop, adjustments, effects  ->  masks
 *
 * Each stage is memoised separately, so painting on a mask only repeats the last (cheap) step.
 * A stroke in progress substitutes its working canvas for the stored raster it is editing.
 */
export function useLayerImage(layer: ImageLayer): LayerImage {
  const { source, masks, crop } = layer;
  const session = useToolStore((s) => (s.session?.layerId === layer.id ? s.session : null));
  const liveContent = session?.target === 'content' ? session : null;
  const liveMask = session?.target === 'mask' ? session : null;
  // A brush stroke on the fade, while it is being drawn.
  const liveFade = session?.target === 'fade' ? session : null;
  const fade = layer.fade && layer.fade.strength > 0 && (liveFade || !isEmptyFade(layer.fade)) ? layer.fade : null;
  const fadeShape = useRaster(fade?.shape?.rasterId ?? null);
  const fadePaint = useRaster(fade?.paint?.rasterId ?? null);
  const asset = useAssetImage(source.kind === 'asset' ? source.assetId : null);
  const raster = useRaster(source.kind === 'raster' ? source.rasterId : null);
  const maskRasters = useRasters(masks.map((m) => m.rasterId));
  const quality = useUiStore((s) => s.renderQuality);
  const viewMask = useUiStore((s) => s.maskViewLayerId === layer.id);
  const bypassMask = useUiStore((s) => s.maskBypassLayerId === layer.id);
  const output = useRef<HTMLCanvasElement | null>(null);

  const base = useMemo<RasterSource | null>(() => {
    if (liveContent) return liveContent.canvas;
    if (source.kind === 'generated') return renderGenerated(source);
    return source.kind === 'raster' ? raster.canvas : asset.image;
  }, [source, asset.image, raster.canvas, liveContent]);

  // Paint layers are drawn at their own resolution so a stroke never triggers a resample.
  const maxDim = quality === 'full' ? FULL_MAX_DIM : source.kind === 'raster' ? FULL_MAX_DIM : PREVIEW_MAX_DIM;

  const processed = useMemo(
    () => (base ? renderImage(base, crop, layer.adjustments, layer.effects, maxDim, hashString(layer.id)) : null),
    // `liveContent.version` changes on every painted frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, crop, layer.adjustments, layer.effects, maxDim, layer.id, liveContent?.version],
  );

  const maskKey = maskRasters.map((r) => r.status).join(',');
  const image = useMemo(() => {
    if (!processed) return null;
    const inputs: MaskInput[] = [];
    let pending = false;
    masks.forEach((mask, i) => {
      if (!mask.enabled && !viewMask) return;
      const canvas = liveMask?.maskId === mask.id ? liveMask.canvas : maskRasters[i]?.canvas;
      if (canvas) inputs.push({ canvas, feather: mask.feather });
      else if (maskRasters[i]?.status === 'loading') pending = true;
    });
    // Never flash the unmasked image while a mask is still being loaded.
    if (pending || (fade?.shape && !fadeShape.canvas && fadeShape.status === 'loading')) return null;
    if (fade?.paint && !liveFade && !fadePaint.canvas && fadePaint.status === 'loading') return null;
    const { width, height } = sourceSize(processed);
    output.current ??= document.createElement('canvas');
    if (viewMask && masks.length) return renderMaskView(inputs, crop, width, height, output.current);
    const unmasked = !inputs.length || bypassMask;
    if (unmasked && !fade) return processed;
    // Masks first, then the fade: both only ever change how much of the image shows.
    const result = composeMasks(processed, unmasked ? [] : inputs, crop, width, height, output.current);
    if (fade) applyFade(result, fade, fadeShape.canvas, crop, liveFade ? liveFade.canvas : fadePaint.canvas);
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processed, masks, maskKey, crop, viewMask, bypassMask, fade, fadeShape.canvas, fadeShape.status, fadePaint.canvas, fadePaint.status, liveFade?.version, liveFade?.canvas, liveMask?.version, liveMask?.canvas]);

  const sourceStatus = source.kind === 'asset' ? asset.status : source.kind === 'raster' ? raster.status : 'missing';
  return { image, status: image ? 'ready' : base ? 'loading' : sourceStatus };
}
