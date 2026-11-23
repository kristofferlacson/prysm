import type { Layer } from '../../types/document';

/**
 * How the panel on the right is organised.
 *
 * It shows the settings of whatever is selected, split into a few tabs so that only one group of
 * related settings is on screen at a time. Which tabs exist depends on what is selected; each
 * section of the panel belongs to exactly one tab. "All" shows every section in one list.
 */

/** What is selected, as far as the panel's layout is concerned. */
export type InspectorKind = 'image' | 'generated' | 'text' | 'shape' | 'group' | 'multi' | 'canvas';

export type InspectorTab = 'selection' | 'adjust' | 'effects' | 'cutout' | 'layout' | 'style' | 'text' | 'shape' | 'canvas' | 'all';

export const TAB_LABEL: Record<InspectorTab, string> = {
  selection: 'Select',
  adjust: 'Adjust',
  effects: 'Effects',
  cutout: 'Cut out',
  layout: 'Layout',
  style: 'Style',
  text: 'Text',
  shape: 'Shape',
  canvas: 'Canvas',
  all: 'All',
};

/** One line on what each tab holds, shown as its tooltip. */
export const TAB_HINT: Record<InspectorTab, string> = {
  selection: 'The selected area: refine it, save it, use it on a layer',
  adjust: 'Light and colour: adjustments, levels, curves',
  effects: 'Effects applied to this layer, and their settings',
  cutout: 'Hide parts of the image: background removal, mask, fade',
  layout: 'Position, size, alignment, order, crop',
  style: 'Opacity, blend mode, shadow, corners, border',
  text: 'Font, size, spacing, colour, outline',
  shape: 'Fill, stroke and shape settings',
  canvas: 'Size and background of the design',
  all: 'Every setting in one list',
};

/** The tabs for each kind of selection, most specific first. The first one is shown by default. */
export const KIND_TABS: Record<InspectorKind, InspectorTab[]> = {
  image: ['adjust', 'effects', 'cutout', 'layout', 'style'],
  // Textures, overlays and generated backgrounds: their colours and how they mix come first.
  generated: ['style', 'adjust', 'effects', 'cutout', 'layout'],
  text: ['text', 'effects', 'layout', 'style'],
  shape: ['shape', 'layout', 'style'],
  group: ['layout', 'style'],
  multi: ['layout', 'style'],
  canvas: ['canvas'],
};

/** Which tab each section of the panel lives in, by the section's title. */
const SECTION_TAB: Record<string, InspectorTab> = {
  Arrange: 'layout',
  'Position & size': 'layout',
  Crop: 'layout',
  Expand: 'layout',
  Upscale: 'layout',

  Blending: 'style',
  'Drop shadow': 'style',
  Frame: 'style',
  Border: 'style',
  Texture: 'style',
  Overlay: 'style',
  Background: 'style',

  Adjustments: 'adjust',
  Levels: 'adjust',
  Curves: 'adjust',

  Effects: 'effects',
  'Text effects': 'effects',
  Warp: 'effects',
  'Text on a path': 'effects',

  Mask: 'cutout',
  Fade: 'cutout',

  Typography: 'text',
  'Text colour': 'text',
  Outline: 'text',

  Icon: 'shape',
  Colours: 'shape',
  Fill: 'shape',
  Stroke: 'shape',
  Geometry: 'shape',
};

/** The tab a section is shown in for this kind of selection. A section nobody placed goes to the first tab, so it can never be lost. */
export function sectionTab(title: string, kind: InspectorKind): InspectorTab {
  const tab = SECTION_TAB[title];
  return tab && KIND_TABS[kind].includes(tab) ? tab : KIND_TABS[kind][0];
}

/** True when this kind of selection has a section with that title at all. */
export function hasSection(title: string, kind: InspectorKind) {
  const tab = SECTION_TAB[title];
  return !!tab && KIND_TABS[kind].includes(tab);
}

export function kindOf(selected: Layer[]): InspectorKind {
  if (!selected.length) return 'canvas';
  if (selected.length > 1) return 'multi';
  const layer = selected[0];
  if (layer.type === 'image') return layer.source.kind === 'generated' ? 'generated' : 'image';
  return layer.type;
}

const KEY = 'prysm.inspectorTabs';

/** The tab last used for each kind of selection, remembered between visits. */
export function storedInspectorTabs(): Partial<Record<InspectorKind, InspectorTab>> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: Partial<Record<InspectorKind, InspectorTab>> = {};
    for (const kind of Object.keys(KIND_TABS) as InspectorKind[]) {
      const tab = value?.[kind];
      if (tab === 'all' || (typeof tab === 'string' && KIND_TABS[kind].includes(tab as InspectorTab))) out[kind] = tab as InspectorTab;
    }
    return out;
  } catch {
    return {};
  }
}

export function storeInspectorTabs(tabs: Partial<Record<InspectorKind, InspectorTab>>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    // Private browsing: the choice simply lasts for this visit.
  }
}
