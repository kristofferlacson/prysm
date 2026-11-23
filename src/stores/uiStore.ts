import { create } from 'zustand';
import { storedInspectorTabs, storeInspectorTabs, type InspectorKind, type InspectorTab } from '../features/inspector/inspector';
import type { CropInsets } from '../types/document';
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

export type Tool = 'move' | 'hand' | 'brush' | 'eraser' | 'marquee' | 'lasso' | 'wand';
export const isPaintTool = (tool: Tool) => tool === 'brush' || tool === 'eraser';
/** Tools that select an area of the canvas (as opposed to selecting layers). */
export const isSelectTool = (tool: Tool) => tool === 'marquee' || tool === 'lasso' || tool === 'wand';
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error';
export type DialogName = 'export' | 'projects' | null;

/** A yes/no question shown in the editor's own dialog. */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** The action destroys something and cannot be undone. */
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export const UI_SCALES = [
  { value: 1, label: 'Compact' },
  { value: 1.2, label: 'Comfortable' },
  { value: 1.4, label: 'Large' },
];
const UI_SCALE_KEY = 'prysm.uiScale';

function storedUiScale() {
  try {
    const v = Number(localStorage.getItem(UI_SCALE_KEY));
    return UI_SCALES.some((s) => s.value === v) ? v : 1.2;
  } catch {
    return 1.2;
  }
}

/** The address decides the first screen: "#/editor" opens the editor, anything else the home page. */
const EDITOR_HASH = '#/editor';
function startsAtHome() {
  try {
    return location.hash !== EDITOR_HASH;
  } catch {
    return true;
  }
}

export interface Guide {
  orientation: 'v' | 'h';
  /** Position in artboard coordinates. */
  position: number;
}

/** A gap between two layers that snapping has just made equal to another gap. Document coordinates. */
export interface SpacingMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Composition helpers drawn over the canvas (never exported). Layers snap to the ones that are on. */
export interface CompositionGuides {
  thirds: boolean;
  center: boolean;
  margins: boolean;
}

/** Safe margin as a fraction of the canvas's shorter side. */
export const SAFE_MARGIN = 0.06;

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
  spacingMarks: SpacingMark[];
  composition: CompositionGuides;
  editingTextId: string | null;
  /** 'full' re-renders image layers at source resolution for export. */
  renderQuality: 'preview' | 'full';
  /** Output pixels per document pixel of the export in progress (used while renderQuality is 'full'). */
  exportScale: number;
  /** Size of panels, buttons and text around the canvas, as a multiple of the compact layout. */
  uiScale: number;
  confirm: ConfirmRequest | null;
  /** Hides both side panels so the canvas gets the whole window. */
  panelsHidden: boolean;
  saveStatus: SaveStatus;
  /** Bumped whenever a web font finishes loading so text can re-measure. */
  fontVersion: number;
  dialog: DialogName;
  /** The home page is showing (over the editor, which stays loaded underneath). */
  home: boolean;
  /** The guide is open, at this topic (null = wherever it was). */
  guide: { topic: string | null } | null;
  /** Image layer being cropped on the canvas. */
  cropLayerId: string | null;
  /** The crop that layer had when cropping started, so it can be cancelled. */
  cropBefore: CropInsets | null;
  /** The shape the crop frame is held to (an id from CROP_PRESETS; 'free' = any). */
  cropPreset: string;
  /** Layer whose mask (rather than its pixels) is the current edit target. */
  maskEditLayerId: string | null;
  /** Layer whose fade is being painted: the brush fades the image, the eraser brings it back. */
  fadePaintLayerId: string | null;
  /** Layer currently displayed as its greyscale mask. */
  maskViewLayerId: string | null;
  /** Layer whose masks are temporarily ignored (before/after comparison). */
  maskBypassLayerId: string | null;
  /** Short, self-dismissing message shown over the canvas. */
  toast: { id: number; text: string } | null;
  /** The tab of the right-hand panel last used for each kind of selection. */
  inspectorTabs: Partial<Record<InspectorKind, InspectorTab>>;
  /** While an area is being selected, the panel shows the selection's own tab (until another tab is chosen). */
  inspectorOnSelection: boolean;
  /** A section of the right-hand panel that should be brought into view now (and, optionally, one item in it). */
  reveal: { section: string; item: string | null; n: number; at: number } | null;

  set: (patch: Partial<UiState>) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  zoomAt: (zoom: number, anchor?: Point) => void;
  fitToScreen: (docW: number, docH: number) => void;
  notify: (text: string) => void;
  setUiScale: (scale: number) => void;
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
  spacingMarks: [],
  composition: { thirds: false, center: false, margins: false },
  editingTextId: null,
  renderQuality: 'preview',
  exportScale: 1,
  uiScale: storedUiScale(),
  confirm: null,
  panelsHidden: false,
  saveStatus: 'saved',
  fontVersion: 0,
  dialog: null,
  home: startsAtHome(),
  guide: null,
  cropLayerId: null,
  cropBefore: null,
  cropPreset: 'free',
  maskEditLayerId: null,
  fadePaintLayerId: null,
  maskViewLayerId: null,
  maskBypassLayerId: null,
  toast: null,
  inspectorTabs: storedInspectorTabs(),
  inspectorOnSelection: false,
  reveal: null,

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

  setUiScale: (uiScale) => {
    try {
      localStorage.setItem(UI_SCALE_KEY, String(uiScale));
    } catch {
      // Private browsing: the choice simply lasts for this visit.
    }
    set({ uiScale });
  },

  notify: (text) => {
    const id = Date.now();
    set({ toast: { id, text } });
    setTimeout(() => get().toast?.id === id && set({ toast: null }), 4200);
  },
}));

/** Asks the user to confirm something. Resolves true only when they choose the confirm button. */
export function askConfirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useUiStore.getState().confirm?.resolve(false);
    useUiStore.setState({
      confirm: {
        ...request,
        resolve: (ok) => {
          useUiStore.setState({ confirm: null });
          resolve(ok);
        },
      },
    });
  });
}

/** Shows the home page. The open design stays loaded and keeps saving underneath. */
export function showHome() {
  if (location.hash !== '#/') history.pushState(null, '', '#/');
  useUiStore.setState({ home: true, cropLayerId: null, cropBefore: null, editingTextId: null });
}

/** Leaves the home page for the editor. */
export function showEditor() {
  if (location.hash !== EDITOR_HASH) history.pushState(null, '', EDITOR_HASH);
  useUiStore.setState({ home: false });
}

/** Keeps the screen in step with the browser's back and forward buttons. */
export function followAddress() {
  const sync = () => useUiStore.setState({ home: location.hash !== EDITOR_HASH });
  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  return () => {
    window.removeEventListener('popstate', sync);
    window.removeEventListener('hashchange', sync);
  };
}

/** Opens the guide, optionally at one topic. */
export function openGuide(topic: string | null = null) {
  useUiStore.setState({ guide: { topic } });
}

/** Chooses a tab of the right-hand panel for this kind of selection, and remembers it. */
export function setInspectorTab(kind: InspectorKind, tab: InspectorTab) {
  const inspectorTabs = { ...useUiStore.getState().inspectorTabs, [kind]: tab };
  storeInspectorTabs(inspectorTabs);
  useUiStore.setState({ inspectorTabs, inspectorOnSelection: false });
}

let reveals = 0;

/**
 * Brings a section of the right-hand panel into view: its tab is opened, the section is unfolded,
 * scrolled to and briefly highlighted. With `item`, one entry inside it is highlighted instead
 * (an effect that was just added). Called whenever the user adds or starts something whose settings
 * live in that panel, so they never have to look for them.
 */
export function revealSection(section: string, item: string | null = null) {
  useUiStore.setState({ reveal: { section, item, n: ++reveals, at: Date.now() } });
}
