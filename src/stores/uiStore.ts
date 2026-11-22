import { create } from 'zustand';
import { clamp, type Point } from '../utils/geometry';

export type SidebarTab =
  | 'templates'
  | 'elements'
  | 'text'
  | 'uploads'
  | 'photos'
  | 'backgrounds'
  | 'textures'
  | 'overlays'
  | 'effects'
  | 'ai';

export type Tool = 'move' | 'hand' | 'brush' | 'eraser';
export const isPaintTool = (tool: Tool) => tool === 'brush' || tool === 'eraser';
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
export type DialogName = 'export' | 'projects' | null;

export interface Guide {
  orientation: 'v' | 'h';
  /** Position in artboard coordinates. */
  position: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

interface UiState {
  sidebarTab: SidebarTab | null;
  tool: Tool;
  spaceHeld: boolean;
  zoom: number;
  pan: Point;
  viewport: { w: number; h: number };
  showGrid: boolean;
  showRulers: boolean;
  guides: Guide[];
  editingTextId: string | null;
  /** 'full' re-renders image layers at source resolution for export. */
  renderQuality: 'preview' | 'full';
  saveStatus: SaveStatus;
  /** Bumped whenever a web font finishes loading so text can re-measure. */
  fontVersion: number;
  dialog: DialogName;
  /** Layer whose mask (rather than its pixels) is the current edit target. */
  maskEditLayerId: string | null;
  /** Layer currently displayed as its greyscale mask. */
  maskViewLayerId: string | null;
  /** Layer whose masks are temporarily ignored (before/after comparison). */
  maskBypassLayerId: string | null;
  /** Short, self-dismissing message shown over the canvas. */
  toast: { id: number; text: string } | null;

  set: (patch: Partial<UiState>) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  zoomAt: (zoom: number, anchor?: Point) => void;
  fitToScreen: (docW: number, docH: number) => void;
  notify: (text: string) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  sidebarTab: 'elements',
  tool: 'move',
  spaceHeld: false,
  zoom: 1,
  pan: { x: 0, y: 0 },
  viewport: { w: 0, h: 0 },
  showGrid: false,
  showRulers: true,
  guides: [],
  editingTextId: null,
  renderQuality: 'preview',
  saveStatus: 'saved',
  fontVersion: 0,
  dialog: null,
  maskEditLayerId: null,
  maskViewLayerId: null,
  maskBypassLayerId: null,
  toast: null,

  set: (patch) => set(patch),
  setSidebarTab: (tab) => set((s) => ({ sidebarTab: s.sidebarTab === tab ? null : tab })),

  zoomAt: (zoom, anchor) => {
    const s = get();
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    const a = anchor ?? { x: s.viewport.w / 2, y: s.viewport.h / 2 };
    const k = next / s.zoom;
    set({ zoom: next, pan: { x: a.x - (a.x - s.pan.x) * k, y: a.y - (a.y - s.pan.y) * k } });
  },

  fitToScreen: (docW, docH) => {
    const { w, h } = get().viewport;
    if (!w || !h) return;
    const margin = 56;
    const zoom = clamp(Math.min((w - margin * 2) / docW, (h - margin * 2) / docH), MIN_ZOOM, 4);
    set({ zoom, pan: { x: (w - docW * zoom) / 2, y: (h - docH * zoom) / 2 } });
  },

  notify: (text) => {
    const id = Date.now();
    set({ toast: { id, text } });
    setTimeout(() => get().toast?.id === id && set({ toast: null }), 4200);
  },
}));
