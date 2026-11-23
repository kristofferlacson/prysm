import { stageRefs } from '../components/canvas/stageRegistry';
import { useEditorStore } from '../stores/editorStore';
import { useUiStore } from '../stores/uiStore';
import { nextFrames } from '../utils/misc';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf';

/** CSS pixels per inch: how document pixels are turned into a physical page size. */
const PX_PER_INCH = 96;

/**
 * A one-page PDF holding the design as a JPEG image. The page is the document's size at 96 pixels
 * per inch; the export scale sets how many image pixels fill it (2x = 192 dpi). This is a picture
 * of the design in a PDF, suitable for printing and sharing: text is not selectable.
 */
export function pdfFromJpeg(jpeg: Uint8Array, imageWidth: number, imageHeight: number, docWidth: number, docHeight: number): Blob {
  const w = +((docWidth / PX_PER_INCH) * 72).toFixed(2);
  const h = +((docHeight / PX_PER_INCH) * 72).toFixed(2);
  const enc = new TextEncoder();
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const parts: (string | Uint8Array)[] = [
    '%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream\nendobj\n',
    `5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
  ];
  // The cross-reference table lists the byte offset of each object, so sizes are counted in bytes.
  const chunks = parts.map((part) => (typeof part === 'string' ? enc.encode(part) : part));
  const offsets: number[] = [];
  let at = 0;
  chunks.forEach((chunk, i) => {
    if ([1, 2, 3, 4, 7].includes(i)) offsets.push(at);
    at += chunk.length;
  });
  const xref = `xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
  return new Blob([...chunks, enc.encode(xref)] as BlobPart[], { type: 'application/pdf' });
}

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
    ui.set({ renderQuality: 'full', exportScale: scale });
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

/**
 * Renders one rectangle of the design (document units) at `pixelRatio` output pixels per document
 * pixel, from the original images. Parts of the rectangle outside the canvas come out transparent.
 */
export async function renderRegion(rect: { x: number; y: number; width: number; height: number }, pixelRatio: number) {
  const { viewport, artboard } = stageRefs;
  if (!viewport || !artboard) throw new Error('The canvas is not ready yet.');
  const ui = useUiStore.getState();
  ui.set({ renderQuality: 'full', exportScale: pixelRatio });
  await nextFrames(2);
  const view = { x: viewport.x(), y: viewport.y(), scaleX: viewport.scaleX(), scaleY: viewport.scaleY() };
  try {
    viewport.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
    return artboard.toCanvas({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, pixelRatio });
  } finally {
    viewport.setAttrs(view);
    useUiStore.getState().set({ renderQuality: 'preview' });
  }
}

/**
 * Renders a single layer (with everything inside it) on a transparent canvas the size of the
 * document, as it is positioned in the design. Used to sample or select one layer's pixels.
 */
export function renderLayerAlone(layerId: string, scale: number): HTMLCanvasElement | null {
  const { viewport, stage } = stageRefs;
  const node = stage?.findOne(`#${layerId}`);
  if (!viewport || !node) return null;
  const { doc } = useEditorStore.getState();
  const view = { x: viewport.x(), y: viewport.y(), scaleX: viewport.scaleX(), scaleY: viewport.scaleY() };
  try {
    viewport.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
    return node.toCanvas({ x: 0, y: 0, width: doc.width, height: doc.height, pixelRatio: scale });
  } finally {
    viewport.setAttrs(view);
  }
}

export async function exportDocument(opts: ExportOptions): Promise<Blob> {
  const { doc } = useEditorStore.getState();
  const scale = Math.min(opts.scale, maxExportScale(doc.width, doc.height));
  const transparent = opts.transparent && opts.format !== 'jpeg' && opts.format !== 'pdf';
  // Text being edited is hidden on the canvas; finish the edit so it is part of the export.
  if (useUiStore.getState().editingTextId) useUiStore.getState().set({ editingTextId: null });
  // "Show mask" and "compare" are ways of looking at a layer, not part of the design.
  const { maskViewLayerId, maskBypassLayerId } = useUiStore.getState();
  if (maskViewLayerId || maskBypassLayerId) useUiStore.getState().set({ maskViewLayerId: null, maskBypassLayerId: null });
  let canvas: HTMLCanvasElement;
  try {
    canvas = await renderDocument(scale, { transparent, fullQuality: true });
  } finally {
    if (maskViewLayerId) useUiStore.getState().set({ maskViewLayerId });
  }

  if (opts.format === 'jpeg' || opts.format === 'pdf') {
    // JPEG (also used inside the PDF) has no alpha channel: flatten onto white so transparent areas do not turn black.
    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    canvas = flat;
  }

  if (opts.format === 'pdf') {
    const jpeg = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The browser could not encode the image.'))), 'image/jpeg', opts.quality),
    );
    return pdfFromJpeg(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height, doc.width, doc.height);
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
