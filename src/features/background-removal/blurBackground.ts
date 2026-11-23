import { cloneLayer } from '../document/factory';
import { mapLists } from '../document/operations';
import { sourceSize } from '../image-editing/pipeline';
import { blankCanvas, getImageLayer, makeMask, sourceRaster } from '../masks/maskActions';
import { importImageBlob } from '../../services/assets';
import { useEditorStore } from '../../stores/editorStore';
import type { ImageLayer, Layer } from '../../types/document';
import { findSubject, useBackgroundRemoval, type RemovalJob } from './removeBackground';

/**
 * Background blur ("portrait" look): the subject stays sharp, everything behind it is blurred.
 *
 * It is built from ordinary layers so it stays editable. The layer keeps the subject (through a
 * mask, exactly like background removal), and a new layer underneath carries the background with a
 * Blur effect whose strength can be changed, or which can be swapped for any other effect.
 *
 * Simply blurring the photo under the subject would smear the subject's colours outwards into a
 * halo. So the background layer gets a "plate": the photo with the subject cut out and the gap
 * closed over from its surroundings. The plate is never seen sharp, only blurred, so a smooth
 * closing of the gap is all it needs.
 */

/** Longer side of the background plate. It is only ever shown blurred, so it need not be large. */
const PLATE_MAX = 1600;
/** Strength of the Blur effect the background starts with (it can be changed in the layer's effects). */
const BLUR_AMOUNT = 0.6;

function blurred(source: HTMLCanvasElement, radius: number) {
  const out = blankCanvas(source.width, source.height);
  const ctx = out.getContext('2d')!;
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(source, 0, 0);
  return out;
}

/** The picture without its subject: the subject is cut out and the gap is closed from the outside in. */
function backgroundPlate(source: CanvasImageSource, width: number, height: number, subject: HTMLCanvasElement) {
  const k = Math.min(1, PLATE_MAX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const unit = Math.max(w, h) / 1024;

  // The subject's coverage, grown a little so no edge pixels of the subject are left behind.
  const cover = blankCanvas(w, h);
  const cctx = cover.getContext('2d')!;
  cctx.drawImage(subject, 0, 0, w, h);
  const grown = blurred(cover, 4 * unit);
  const gctx = grown.getContext('2d')!;
  for (let i = 0; i < 5; i++) gctx.drawImage(grown, 0, 0);

  const cut = blankCanvas(w, h);
  const ctx = cut.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(grown, 0, 0);
  ctx.drawImage(grown, 0, 0);

  // Blurring a picture with a hole in it spreads the surrounding colours into the hole (and only
  // those: transparent pixels carry no colour). Wider and wider blurs are slipped underneath until
  // the gap is closed, so the middle of a large gap gets the average of everything around it.
  const plate = blankCanvas(w, h);
  const pctx = plate.getContext('2d')!;
  pctx.drawImage(cut, 0, 0);
  pctx.globalCompositeOperation = 'destination-over';
  for (const radius of [6, 14, 30, 60, 120, 240]) {
    const layer = blurred(cut, radius * unit);
    for (let i = 0; i < 3; i++) pctx.drawImage(layer, 0, 0);
  }
  // Whatever is still open (a subject filling the frame) takes the picture's average colour.
  const one = blankCanvas(1, 1);
  const octx = one.getContext('2d', { willReadFrequently: true })!;
  octx.drawImage(cut, 0, 0, 1, 1);
  const [r, g, b, a] = octx.getImageData(0, 0, 1, 1).data;
  if (a > 0) {
    pctx.fillStyle = `rgb(${r},${g},${b})`;
    pctx.fillRect(0, 0, w, h);
  }
  // A picture that was transparent somewhere (a cut-out) stays transparent there.
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(source, 0, 0, w, h);
  return plate;
}

/** Keeps the subject of an image layer sharp and blurs what is behind it. Reports progress like background removal. */
export async function blurLayerBackground(layerId: string) {
  const busy = useBackgroundRemoval.getState().job;
  if (busy && busy.phase !== 'done' && busy.phase !== 'error') return;
  const report = (phase: RemovalJob['phase'], message: string, progress: number | null = null) =>
    useBackgroundRemoval.getState().set({ job: { layerId, phase, message, progress } });
  try {
    if (typeof document.createElement('canvas').getContext('2d')!.filter !== 'string') {
      throw new Error('This browser cannot blur on a canvas, which background blur needs. Use Chrome, Edge or Firefox.');
    }
    const { mask } = await findSubject(layerId, report);
    report('refining', 'Building the background…');
    const layer = getImageLayer(layerId);
    const pixels = layer && sourceRaster(layer.source);
    if (!layer || !pixels) throw new Error('The layer was removed before the result was ready.');
    const { width, height } = sourceSize(pixels);
    const plate = backgroundPlate(pixels, width, height, mask);
    const blob = await new Promise<Blob | null>((resolve) => plate.toBlob(resolve, 'image/webp', 0.92));
    if (!blob) throw new Error('The background could not be created.');
    const asset = await importImageBlob(blob, `${layer.name} (background)`, blob.type || 'image/png');

    const current = getImageLayer(layerId);
    if (!current || current.source !== layer.source) throw new Error('The layer changed while its background was being prepared.');
    // Same place, size, crop and colour adjustments as the photo; no mask; blurred.
    const background: ImageLayer = {
      ...(cloneLayer(current) as ImageLayer),
      name: `${current.name} (blurred background)`,
      source: { kind: 'asset', assetId: asset.id },
      masks: [],
      shadow: null,
      stroke: null,
      clip: false,
      effects: [...current.effects.filter((e) => e.type !== 'blur'), { type: 'blur', amount: BLUR_AMOUNT }],
    };
    const subjectMask = makeMask(mask, 'background-removal');
    useEditorStore.getState().commit(
      (doc) => ({
        ...doc,
        layers: mapLists(doc.layers, (list) => {
          const index = list.findIndex((l) => l.id === layerId);
          if (index < 0) return list;
          const next = [...list];
          next[index] = { ...(next[index] as ImageLayer), masks: [subjectMask] } as Layer;
          next.splice(index, 0, background);
          return next;
        }),
      }),
      {},
      [layerId],
    );
    report('done', 'Background blurred. The subject is this layer (masked); the layer below is the background, with a Blur effect you can adjust or remove.');
  } catch (err) {
    report('error', err instanceof Error ? err.message : 'The background could not be blurred.');
  }
}
