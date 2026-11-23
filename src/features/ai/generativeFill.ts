import { createImage } from '../document/factory';
import { blankCanvas, makeMask } from '../masks/maskActions';
import { maskResolution } from '../masks/maskSpace';
import { useAreaSelection } from '../selection/selectionStore';
import { importImageBlob } from '../../services/assets';
import { renderRegion } from '../../services/export';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { ImageLayer } from '../../types/document';
import { clamp, type Rect } from '../../utils/geometry';
import { aiEdit, aiGenerate, checkAiService, useAiService } from './aiService';

/**
 * Generative fill and object removal.
 *
 * The area around the selection is rendered, sent (through the Prysm server) to the image model
 * together with a mask of the selection, and the answer comes back as a NEW image layer that sits
 * exactly over that area and is masked to the selection. Nothing underneath is altered, so the
 * result can be hidden, re-masked, moved, blended or deleted like any other layer.
 */

const REMOVE_PROMPT =
  'Remove whatever is in the masked area and fill it in with the surrounding background so the result looks natural and seamless. Do not add any new objects, text or people.';

export interface FillPlan {
  /** The part of the canvas that is sent, in document units. May reach past the canvas when the selection is wider than any supported shape. */
  rect: Rect;
  /** Pixel size it is sent at. */
  width: number;
  height: number;
}

/**
 * Chooses what to send: the selection plus some surroundings for context, in one of the shapes the
 * model accepts, kept inside the canvas whenever the selection allows it.
 */
export function planFill(bounds: Rect, docWidth: number, docHeight: number, sizes: string[]): FillPlan {
  const margin = Math.max(48, 0.35 * Math.max(bounds.width, bounds.height));
  const needW = bounds.width + margin * 2;
  const needH = bounds.height + margin * 2;
  let best: (FillPlan & { score: number }) | null = null;
  for (const size of sizes) {
    const [width, height] = size.split('x').map(Number);
    if (!(width > 0 && height > 0)) continue;
    const aspect = width / height;
    let w = Math.max(needW, needH * aspect);
    const largestInside = Math.min(docWidth, docHeight * aspect);
    const smallestHolding = Math.max(bounds.width, bounds.height * aspect);
    let outside = false;
    if (w > largestInside) {
      if (smallestHolding <= largestInside) w = largestInside;
      else {
        w = smallestHolding;
        outside = true;
      }
    }
    const h = w / aspect;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const x = w <= docWidth ? clamp(cx - w / 2, 0, docWidth - w) : (docWidth - w) / 2;
    const y = h <= docHeight ? clamp(cy - h / 2, 0, docHeight - h) : (docHeight - h) / 2;
    const score = (outside ? 1e12 : 0) + w * h;
    if (!best || score < best.score) best = { rect: { x, y, width: w, height: h }, width, height, score };
  }
  if (!best) throw new Error('The AI server did not report any image size it can work with.');
  return { rect: best.rect, width: best.width, height: best.height };
}

/** The selection as seen through a rectangle of the canvas (document units), drawn into a canvas of the given size. */
export function selectionCoverage(rect: Rect, width: number, height: number) {
  const { mask } = useAreaSelection.getState();
  const { doc } = useEditorStore.getState();
  const out = blankCanvas(width, height);
  if (!mask) return out;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const sx = width / rect.width;
  const sy = height / rect.height;
  ctx.setTransform(sx, 0, 0, sy, -rect.x * sx, -rect.y * sy);
  ctx.drawImage(mask, 0, 0, doc.width, doc.height);
  return out;
}

/** The mask the model receives: opaque everywhere it must keep, fully transparent where it may paint. */
function providerMask(plan: FillPlan) {
  const coverage = selectionCoverage(plan.rect, plan.width, plan.height);
  const ctx = coverage.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, plan.width, plan.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const selected = data[i + 3] > 24;
    data[i] = data[i + 1] = data[i + 2] = 0;
    data[i + 3] = selected ? 0 : 255;
  }
  ctx.putImageData(image, 0, 0);
  return coverage;
}

/**
 * The layer mask for the result: the selection, with a soft edge that starts at the selection's
 * border and fades outwards, so the new pixels cover the whole selected area and blend into what
 * surrounds it.
 */
export function softResultMask(rect: Rect, pixelWidth: number, pixelHeight: number) {
  const size = maskResolution(pixelWidth, pixelHeight);
  const coverage = selectionCoverage(rect, size.width, size.height);
  const soft = blankCanvas(size.width, size.height);
  const ctx = soft.getContext('2d', { willReadFrequently: true })!;
  if (typeof ctx.filter === 'string') ctx.filter = `blur(${Math.max(1.5, size.width * 0.004)}px)`;
  ctx.drawImage(coverage, 0, 0);
  ctx.filter = 'none';
  const image = ctx.getImageData(0, 0, size.width, size.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.min(255, data[i + 3] * 2);
  }
  ctx.putImageData(image, 0, 0);
  return soft;
}

async function dataUrlToBlob(url: string) {
  return (await fetch(url)).blob();
}

const notify = (text: string) => useUiStore.getState().notify(text);

async function ensureReady() {
  const availability = await checkAiService();
  if (availability === 'ready') return true;
  notify(availability === 'unconfigured' ? 'The AI server has no provider key yet. See the AI tab for how to set it up.' : 'The AI server is not running. See the AI tab for how to start it.');
  return false;
}

/**
 * Repaints the selected area from a description (`prompt`), or, with no prompt, removes what is
 * there. Resolves to the id of the new layer, or null when nothing was added.
 */
export async function generativeFill(prompt: string | null): Promise<string | null> {
  const service = useAiService.getState();
  if (service.job) return null;
  const { bounds, mask } = useAreaSelection.getState();
  if (!mask || !bounds) {
    notify('Select the area to work on first.');
    return null;
  }
  const removing = prompt === null;
  const text = removing ? REMOVE_PROMPT : prompt.trim();
  if (!text) {
    notify('Describe what should appear in the selected area.');
    return null;
  }
  if (!(await ensureReady())) return null;

  const docId = useEditorStore.getState().doc.id;
  service.set({ job: removing ? 'Removing the selected object…' : 'Generating the fill…' });
  try {
    const { doc } = useEditorStore.getState();
    const plan = planFill(bounds, doc.width, doc.height, useAiService.getState().sizes);
    const rendered = await renderRegion(plan.rect, plan.width / plan.rect.width);
    // The model gets an opaque picture: transparent canvas is sent as white.
    const picture = blankCanvas(plan.width, plan.height, '#ffffff');
    picture.getContext('2d')!.drawImage(rendered, 0, 0, plan.width, plan.height);
    const layerMask = softResultMask(plan.rect, plan.width, plan.height);

    const result = await aiEdit({
      image: picture.toDataURL('image/png'),
      mask: providerMask(plan).toDataURL('image/png'),
      prompt: text,
      size: `${plan.width}x${plan.height}`,
    });

    const name = removing ? 'Object removal' : 'Generative fill';
    const asset = await importImageBlob(await dataUrlToBlob(result), name, 'image/png');
    const editor = useEditorStore.getState();
    if (editor.doc.id !== docId) throw new Error('Another project was opened before the result arrived. The image is in Uploads.');
    const layer: ImageLayer = {
      ...createImage({ kind: 'asset', assetId: asset.id }, name, asset.width, asset.height, doc.width, doc.height),
      x: plan.rect.x,
      y: plan.rect.y,
      width: plan.rect.width,
      height: plan.rect.height,
      masks: [makeMask(layerMask)],
    };
    editor.addLayers([layer]);
    notify(`${name} added as a new layer, masked to the selection. Nothing underneath was changed.`);
    return layer.id;
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The AI request failed.');
    return null;
  } finally {
    useAiService.getState().set({ job: null });
  }
}

/** Creates an image from a description and adds it to the design as a new layer. */
export async function generateImage(prompt: string, size: string): Promise<string | null> {
  const service = useAiService.getState();
  if (service.job) return null;
  const text = prompt.trim();
  if (!text) {
    notify('Describe the image you want first.');
    return null;
  }
  if (!(await ensureReady())) return null;
  const docId = useEditorStore.getState().doc.id;
  service.set({ job: 'Generating the image…' });
  try {
    const result = await aiGenerate({ prompt: text, size });
    const asset = await importImageBlob(await dataUrlToBlob(result), text.slice(0, 40), 'image/png');
    const editor = useEditorStore.getState();
    if (editor.doc.id !== docId) throw new Error('Another project was opened before the image arrived. It is in Uploads.');
    const layer = createImage({ kind: 'asset', assetId: asset.id }, text.slice(0, 40), asset.width, asset.height, editor.doc.width, editor.doc.height);
    editor.addLayers([layer]);
    return layer.id;
  } catch (err) {
    notify(err instanceof Error ? err.message : 'The AI request failed.');
    return null;
  } finally {
    useAiService.getState().set({ job: null });
  }
}
