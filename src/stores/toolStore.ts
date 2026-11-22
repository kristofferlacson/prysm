import { create } from 'zustand';

export interface BrushSettings {
  /** Diameter in document pixels. */
  size: number;
  /** 0 = fully soft edge, 1 = hard edge. */
  hardness: number;
  /** Maximum coverage a single stroke can build up to. */
  opacity: number;
  /** Coverage added by each brush dab; low flow builds up gradually. */
  flow: number;
  /** 0 = follow the pointer exactly, 1 = heavily stabilised. */
  smoothing: number;
}

/**
 * A stroke in progress. While it exists, the canvas shows `canvas` in place of the stored raster
 * for the given layer, so painting is visible live without touching the document until the stroke ends.
 */
export interface PaintSession {
  layerId: string;
  target: 'mask' | 'content';
  /** Set when target is 'mask'. */
  maskId: string | null;
  canvas: HTMLCanvasElement;
  version: number;
}

interface ToolState {
  brush: BrushSettings;
  eraser: BrushSettings;
  /** Brush colour on paint layers. */
  color: string;
  /** What the brush paints when the target is a mask: white (reveal) or black (conceal). */
  maskValue: 'reveal' | 'conceal';
  /** Eraser on a mask normally conceals; in restore mode it reveals the image again. */
  eraserRestore: boolean;
  session: PaintSession | null;

  setBrush: (patch: Partial<BrushSettings>) => void;
  setEraser: (patch: Partial<BrushSettings>) => void;
  set: (patch: Partial<Pick<ToolState, 'color' | 'maskValue' | 'eraserRestore' | 'session'>>) => void;
}

const DEFAULTS: BrushSettings = { size: 60, hardness: 0.8, opacity: 1, flow: 1, smoothing: 0.4 };

export const useToolStore = create<ToolState>()((set) => ({
  brush: { ...DEFAULTS },
  eraser: { ...DEFAULTS },
  color: '#e4572e',
  maskValue: 'conceal',
  eraserRestore: false,
  session: null,

  setBrush: (patch) => set((s) => ({ brush: { ...s.brush, ...patch } })),
  setEraser: (patch) => set((s) => ({ eraser: { ...s.eraser, ...patch } })),
  set: (patch) => set(patch),
}));
