import { create } from 'zustand';
import { useEditorStore } from '../../stores/editorStore';
import type { Point, Rect } from '../../utils/geometry';

/**
 * AREA SELECTION — "which pixels of the canvas am I working on".
 *
 * This is separate from which *layers* are selected. It is a coverage bitmap in document space
 * (alpha = how selected a pixel is), so every tool that produces one (rectangle, ellipse, lasso,
 * magic wand, subject detection) and every command that consumes one (layer masks, fills, copies,
 * constrained painting, AI fill) meets at one representation.
 *
 * It is working state, like the zoom level: it is not saved with the project and is not part of
 * undo. What it is *used for* (a mask, a new layer) is an ordinary undoable document change.
 */

export type SelectionMode = 'new' | 'add' | 'subtract' | 'intersect';
export type MarqueeShape = 'rect' | 'ellipse';
/** Freehand: drag around the area. Polygon: click from corner to corner. */
export type LassoMode = 'freehand' | 'polygon';

export const SELECTION_MAX_DIM = 2048;

interface AreaSelectionState {
  /** Coverage in document space, or null when nothing is selected. Only the alpha channel matters. */
  mask: HTMLCanvasElement | null;
  /** The same area with a hard edge at 50%, used to draw the moving outline. */
  outline: HTMLCanvasElement | null;
  /** Extent of the selected area in document units. */
  bounds: Rect | null;
  /** Share of the canvas that is selected (0..1). */
  coverage: number;
  version: number;

  mode: SelectionMode;
  marqueeShape: MarqueeShape;
  lassoMode: LassoMode;
  /** Edge softness, in document pixels, given to shapes as they are drawn. */
  feather: number;
  /** Magic wand: how different a colour may be from the clicked one (0..255). */
  tolerance: number;
  /** Magic wand: only the connected region, or every matching pixel on the canvas. */
  contiguous: boolean;
  /** Magic wand: look at the whole design, or only at the selected layer. */
  sampleAll: boolean;
  /** Amount used by the expand, contract and feather commands, in document pixels. */
  refineAmount: number;
  busy: string | null;

  set: (patch: Partial<Pick<AreaSelectionState, 'mode' | 'marqueeShape' | 'lassoMode' | 'feather' | 'tolerance' | 'contiguous' | 'sampleAll' | 'refineAmount' | 'busy'>>) => void;
}

export const useAreaSelection = create<AreaSelectionState>()((set) => ({
  mask: null,
  outline: null,
  bounds: null,
  coverage: 0,
  version: 0,
  mode: 'new',
  marqueeShape: 'rect',
  lassoMode: 'freehand',
  feather: 0,
  tolerance: 32,
  contiguous: true,
  sampleAll: true,
  refineAmount: 8,
  busy: null,
  set: (patch) => set(patch),
}));

/** Pixel size of the selection bitmap for the open document, and how many of its pixels make one document pixel. */
export function selectionGrid() {
  const { width, height } = useEditorStore.getState().doc;
  const scale = Math.min(1, SELECTION_MAX_DIM / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale, docWidth: width, docHeight: height };
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Replaces the selection. Measures it, builds the outline, and treats "nothing selected" as no selection. */
export function setSelectionMask(mask: HTMLCanvasElement | null) {
  const state = useAreaSelection.getState();
  if (!mask) {
    if (state.mask) useAreaSelection.setState({ mask: null, outline: null, bounds: null, coverage: 0, version: state.version + 1 });
    return;
  }
  const { width, height } = mask;
  const ctx = mask.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const hard = new ImageData(width, height);
  const out = hard.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let total = 0;
  for (let y = 0, i = 3; y < height; y++) {
    for (let x = 0; x < width; x++, i += 4) {
      const a = data[i];
      if (a === 0) continue;
      total += a;
      if (a < 128) continue;
      out[i - 3] = out[i - 2] = out[i - 1] = out[i] = 255;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) {
    useAreaSelection.setState({ mask: null, outline: null, bounds: null, coverage: 0, version: state.version + 1 });
    return;
  }
  const outline = canvasOf(width, height);
  outline.getContext('2d')!.putImageData(hard, 0, 0);
  const { scale } = selectionGrid();
  useAreaSelection.setState({
    mask,
    outline,
    bounds: { x: minX / scale, y: minY / scale, width: (maxX - minX + 1) / scale, height: (maxY - minY + 1) / scale },
    coverage: total / 255 / (width * height),
    version: state.version + 1,
  });
}

/** Combines a freshly made shape with the current selection. */
export function combineSelection(shape: HTMLCanvasElement, mode: SelectionMode) {
  const current = useAreaSelection.getState().mask;
  if (mode === 'new' || !current) {
    // Subtracting from, or intersecting with, nothing leaves nothing.
    setSelectionMask(mode === 'new' || mode === 'add' ? shape : null);
    return;
  }
  const out = canvasOf(current.width, current.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(current, 0, 0);
  ctx.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  ctx.drawImage(shape, 0, 0, out.width, out.height);
  setSelectionMask(out);
}

/** Draws a filled shape (given in document units) into a new selection-sized bitmap, softened by `feather` document pixels. */
export function drawSelectionShape(draw: (ctx: CanvasRenderingContext2D) => void, feather = 0) {
  const grid = selectionGrid();
  const canvas = canvasOf(grid.width, grid.height);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(grid.scale, 0, 0, grid.scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  draw(ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return feather > 0 ? blurred(canvas, feather * grid.scale) : canvas;
}

function blurred(source: HTMLCanvasElement, radius: number) {
  const out = canvasOf(source.width, source.height);
  const ctx = out.getContext('2d')!;
  if (radius > 0 && typeof ctx.filter === 'string') ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(source, 0, 0);
  return out;
}

export function selectRect(rect: Rect, mode: SelectionMode, feather = useAreaSelection.getState().feather) {
  combineSelection(drawSelectionShape((ctx) => ctx.fillRect(rect.x, rect.y, rect.width, rect.height), feather), mode);
}

export function selectEllipse(rect: Rect, mode: SelectionMode, feather = useAreaSelection.getState().feather) {
  combineSelection(
    drawSelectionShape((ctx) => {
      ctx.beginPath();
      ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }, feather),
    mode,
  );
}

export function selectPolygon(points: Point[], mode: SelectionMode, feather = useAreaSelection.getState().feather) {
  if (points.length < 3) return;
  combineSelection(
    drawSelectionShape((ctx) => {
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill('evenodd');
    }, feather),
    mode,
  );
}

export function selectWholeCanvas() {
  const { docWidth, docHeight } = selectionGrid();
  setSelectionMask(drawSelectionShape((ctx) => ctx.fillRect(0, 0, docWidth, docHeight)));
}

export const clearSelectionArea = () => setSelectionMask(null);

export function invertSelection() {
  const current = useAreaSelection.getState().mask;
  if (!current) {
    selectWholeCanvas();
    return;
  }
  const out = canvasOf(current.width, current.height);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(current, 0, 0);
  setSelectionMask(out);
}

/** Softens the edge of the current selection by `amount` document pixels. */
export function featherSelection(amount: number) {
  const current = useAreaSelection.getState().mask;
  if (!current || amount <= 0) return;
  setSelectionMask(blurred(current, amount * selectionGrid().scale));
}

/**
 * Moves the edge of the selection outwards (positive) or inwards (negative) by `amount` document pixels.
 * The area is blurred and cut off at the level a straight edge reaches at that distance, which
 * rounds corners the way a real expand / contract does.
 */
export function growSelection(amount: number) {
  const current = useAreaSelection.getState().mask;
  if (!current || amount === 0) return;
  const radius = Math.abs(amount) * selectionGrid().scale;
  const soft = blurred(current, radius / 2);
  const ctx = soft.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, soft.width, soft.height);
  const data = image.data;
  // A blurred straight edge is at 2.3% two standard deviations outside it, and at 97.7% two inside.
  const cut = amount > 0 ? 0.0228 * 255 : 0.9772 * 255;
  for (let i = 3; i < data.length; i += 4) {
    const v = (data[i] - cut) / 6 + 0.5;
    data[i - 3] = data[i - 2] = data[i - 1] = 255;
    data[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
  ctx.putImageData(image, 0, 0);
  setSelectionMask(soft);
}

/** How selected a document point is (0..1). */
export function selectionAt(point: Point) {
  const { mask } = useAreaSelection.getState();
  if (!mask) return 0;
  const { scale } = selectionGrid();
  const x = Math.floor(point.x * scale);
  const y = Math.floor(point.y * scale);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return 0;
  return mask.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, 1, 1).data[3] / 255;
}

// A selection describes one document at one size. Opening another project or resizing the canvas ends it.
useEditorStore.subscribe((state, previous) => {
  if (state.doc.id !== previous.doc.id || state.doc.width !== previous.doc.width || state.doc.height !== previous.doc.height) {
    clearSelectionArea();
  }
});
