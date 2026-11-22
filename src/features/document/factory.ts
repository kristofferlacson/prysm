import type {
  Adjustments,
  BlendMode,
  CropInsets,
  GroupLayer,
  ImageLayer,
  ImageSource,
  Layer,
  LayerBase,
  ProjectDocument,
  ShapeKind,
  ShapeLayer,
  TextLayer,
} from '../../types/document';
import { uid } from '../../utils/misc';

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  exposure: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  gamma: 1,
  grayscale: 0,
  sepia: 0,
  invert: 0,
};

export const NO_CROP: CropInsets = { left: 0, top: 0, right: 0, bottom: 0 };

export function baseLayer(name: string, x: number, y: number, width: number, height: number): LayerBase {
  return {
    id: uid(),
    name,
    x,
    y,
    width,
    height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    visible: true,
    locked: false,
    blendMode: 'normal',
    shadow: null,
    clip: false,
  };
}

export function createDocument(name: string, width: number, height: number): ProjectDocument {
  const now = Date.now();
  return {
    id: uid('p'),
    schemaVersion: 2,
    name,
    width,
    height,
    background: { type: 'solid', color: '#ffffff' },
    layers: [],
    createdAt: now,
    updatedAt: now,
  };
}

const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  polygon: 'Polygon',
  star: 'Star',
  line: 'Line',
  arrow: 'Arrow',
};

export function createShape(kind: ShapeKind, docW: number, docH: number, overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  const size = Math.round(Math.min(docW, docH) * 0.28);
  const isLine = kind === 'line' || kind === 'arrow';
  const width = isLine ? Math.round(size * 1.4) : size;
  const height = isLine ? 24 : size;
  return {
    ...baseLayer(SHAPE_NAMES[kind], Math.round((docW - width) / 2), Math.round((docH - height) / 2), width, height),
    type: 'shape',
    shape: kind,
    fill: isLine ? null : { type: 'solid', color: '#3ddc97' },
    stroke: isLine ? { color: '#1d1e22', width: Math.max(2, Math.round(size / 40)) } : null,
    cornerRadius: 0,
    sides: kind === 'star' ? 5 : 6,
    innerRadius: 0.45,
    ...overrides,
  };
}

export type TextPreset = 'heading' | 'subheading' | 'body';

export function createText(preset: TextPreset, docW: number, docH: number, overrides: Partial<TextLayer> = {}): TextLayer {
  const unit = Math.min(docW, docH);
  const spec = {
    heading: { text: 'Add a heading', size: unit * 0.09, weight: 800 },
    subheading: { text: 'Add a subheading', size: unit * 0.05, weight: 600 },
    body: { text: 'Add a little bit of body text', size: unit * 0.03, weight: 400 },
  }[preset];
  const fontSize = Math.max(10, Math.round(spec.size));
  const content = overrides.text ?? spec.text;
  const spacing = overrides.letterSpacing ?? 0;
  const width = Math.round(Math.min(docW * 0.9, (fontSize * 0.68 + spacing) * content.length + fontSize * 0.4));
  const height = Math.round(fontSize * 1.2);
  return {
    ...baseLayer(content, Math.round((docW - width) / 2), Math.round((docH - height) / 2), width, height),
    type: 'text',
    text: spec.text,
    fontFamily: 'Inter',
    fontSize,
    fontWeight: spec.weight,
    italic: false,
    underline: false,
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    fill: { type: 'solid', color: '#1d1e22' },
    stroke: null,
    ...overrides,
  };
}

export function createImage(
  source: ImageSource,
  name: string,
  naturalW: number,
  naturalH: number,
  docW: number,
  docH: number,
  fit: 'contain' | 'cover' = 'contain',
): ImageLayer {
  const scale =
    fit === 'cover'
      ? Math.max(docW / naturalW, docH / naturalH)
      : Math.min(1, (docW * 0.8) / naturalW, (docH * 0.8) / naturalH);
  const width = Math.round(naturalW * scale);
  const height = Math.round(naturalH * scale);
  return {
    ...baseLayer(name, Math.round((docW - width) / 2), Math.round((docH - height) / 2), width, height),
    type: 'image',
    source,
    crop: NO_CROP,
    adjustments: DEFAULT_ADJUSTMENTS,
    effects: [],
    cornerRadius: 0,
    stroke: null,
    masks: [],
  };
}

/** A procedurally generated image (texture, overlay, background) that covers the whole canvas. */
export function createGeneratedImage(
  generator: string,
  name: string,
  colors: string[],
  docW: number,
  docH: number,
  blendMode: BlendMode = 'normal',
  opacity = 1,
): ImageLayer {
  const k = 1024 / Math.max(docW, docH);
  const source: ImageSource = {
    kind: 'generated',
    generator,
    seed: Math.floor(Math.random() * 1e9),
    width: Math.max(64, Math.round(docW * k)),
    height: Math.max(64, Math.round(docH * k)),
    colors,
  };
  return { ...createImage(source, name, docW, docH, docW, docH, 'cover'), blendMode, opacity };
}

export function createGroup(children: Layer[], x: number, y: number, width: number, height: number): GroupLayer {
  return { ...baseLayer('Group', x, y, width, height), type: 'group', children };
}

/** Deep copy with fresh ids. */
export function cloneLayer(layer: Layer, dx = 0, dy = 0): Layer {
  const copy = { ...layer, id: uid(), x: layer.x + dx, y: layer.y + dy } as Layer;
  if (copy.type === 'group') copy.children = copy.children.map((c) => cloneLayer(c));
  return copy;
}
