import { stageRefs } from '../components/canvas/stageRegistry';
import { useEditorStore } from '../stores/editorStore';
import { useUiStore } from '../stores/uiStore';
import { nextFrames } from '../utils/misc';

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export interface ExportOptions {
  format: ExportFormat;
  /** Output pixels per document pixel. */
  scale: number;
  /** 0..1, used by JPEG and WebP. */
  quality: number;
  /** Omit the canvas background (PNG / WebP). */
  transparent: boolean;
}

const MAX_SIDE = 16384;
const MAX_AREA = 120_000_000;

/** Largest export scale the browser can reliably allocate for this document. */
export function maxExportScale(width: number, height: number) {
  return Math.min(MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)));
}

/**
 * Renders the artboard to a canvas at `scale`, independent of the on-screen zoom.
 * It draws the same Konva nodes the editor shows, so blending, effects and textures match the screen.
 */
export async function renderDocument(scale: number, opts: { transparent?: boolean; fullQuality?: boolean } = {}) {
  const { viewport, artboard, background } = stageRefs;
  if (!viewport || !artboard || !background) throw new Error('The canvas is not ready yet.');
  const ui = useUiStore.getState();

  if (opts.fullQuality) {
    // Image layers re-render from their originals at full resolution before the capture.
    ui.set({ renderQuality: 'full' });
    await nextFrames(2);
  }
  const { doc } = useEditorStore.getState();
  const view = { x: viewport.x(), y: viewport.y(), scaleX: viewport.scaleX(), scaleY: viewport.scaleY() };
  const backgroundVisible = background.visible();
  try {
    viewport.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
    if (opts.transparent) background.visible(false);
    const rendered = artboard.toCanvas({ x: 0, y: 0, width: doc.width, height: doc.height, pixelRatio: scale });
    const width = Math.round(doc.width * scale);
    const height = Math.round(doc.height * scale);
    if (rendered.width === width && rendered.height === height) return rendered;
    const exact = document.createElement('canvas');
    exact.width = width;
    exact.height = height;
    exact.getContext('2d')!.drawImage(rendered, 0, 0, width, height);
    return exact;
  } finally {
    background.visible(backgroundVisible);
    viewport.setAttrs(view);
    if (opts.fullQuality) useUiStore.getState().set({ renderQuality: 'preview' });
  }
}

export async function exportDocument(opts: ExportOptions): Promise<Blob> {
  const { doc } = useEditorStore.getState();
  const scale = Math.min(opts.scale, maxExportScale(doc.width, doc.height));
  const transparent = opts.transparent && opts.format !== 'jpeg';
  // Text being edited is hidden on the canvas; finish the edit so it is part of the export.
  if (useUiStore.getState().editingTextId) useUiStore.getState().set({ editingTextId: null });
  let canvas = await renderDocument(scale, { transparent, fullQuality: true });

  if (opts.format === 'jpeg') {
    // JPEG has no alpha channel: flatten onto white so transparent areas do not turn black.
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    canvas = flat;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the image.'))),
      `image/${opts.format}`,
      opts.format === 'png' ? undefined : opts.quality,
    );
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Small preview stored with the project for the project browser. */
export async function renderThumbnail(maxSide = 360): Promise<string | null> {
  try {
    const { doc } = useEditorStore.getState();
    const canvas = await renderDocument(Math.min(1, maxSide / Math.max(doc.width, doc.height)));
    return canvas.toDataURL('image/webp', 0.8);
  } catch {
    return null;
  }
}
