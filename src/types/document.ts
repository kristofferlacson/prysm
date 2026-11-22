/**
 * The project document is the single source of truth for a design.
 * The canvas renders it; nothing is read back from rendered pixels.
 */

export const BLEND_MODES = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface GradientStop {
  offset: number;
  color: string;
}

export type Fill =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: GradientStop[] }
  | { type: 'radial'; stops: GradientStop[] };

export interface Shadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

export interface Stroke {
  color: string;
  width: number;
}

export interface LayerBase {
  id: string;
  name: string;
  /** Top-left of the unrotated box, in parent coordinates. Rotation and flips pivot on the box centre. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  blendMode: BlendMode;
  shadow: Shadow | null;
  /**
   * Clipping mask: when true this layer is only visible where the nearest unclipped layer
   * below it (its clipping base) has pixels. Consecutive clipped layers share one base.
   */
  clip: boolean;
}

/**
 * A non-destructive layer mask. The pixel data lives in the raster store and is referenced by id,
 * so every edit produces a new immutable bitmap and undo/redo simply swaps ids.
 *
 * The bitmap is a coverage map in the layer's source-image space (it spans the whole uncropped
 * source), which keeps it aligned through move, resize, rotation, flips and cropping.
 * Coverage is stored in the alpha channel: opaque = reveal (white), transparent = conceal (black),
 * anything between = partial transparency (grey).
 */
export interface LayerMask {
  id: string;
  rasterId: string;
  width: number;
  height: number;
  enabled: boolean;
  /** Edge softness as a fraction of the mask's longer side. 0 = crisp. */
  feather: number;
  origin: 'manual' | 'background-removal';
}

export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  exposure: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  gamma: number;
  grayscale: number;
  sepia: number;
  invert: number;
}

export type EffectType =
  | 'blur'
  | 'sharpen'
  | 'retro'
  | 'film'
  | 'sepia-tone'
  | 'faded'
  | 'old-photo'
  | 'noir'
  | 'sketch'
  | 'posterize'
  | 'halftone'
  | 'duotone'
  | 'photocopy'
  | 'glitch'
  | 'pixelate'
  | 'rgb-split'
  | 'glow'
  | 'vignette'
  | 'wave'
  | 'noise';

export interface EffectInstance {
  type: EffectType;
  /** 0..1 */
  amount: number;
}

/** Fractions (0..1) of the source image trimmed from each side. */
export interface CropInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type ImageSource =
  | { kind: 'asset'; assetId: string }
  | { kind: 'generated'; generator: string; seed: number; width: number; height: number; colors: string[] }
  /** Editable pixels owned by the document (paint layers), stored in the raster store. */
  | { kind: 'raster'; rasterId: string; width: number; height: number };

export interface ImageLayer extends LayerBase {
  type: 'image';
  source: ImageSource;
  crop: CropInsets;
  adjustments: Adjustments;
  effects: EffectInstance[];
  cornerRadius: number;
  stroke: Stroke | null;
  /** Applied in order after crop, adjustments and effects. Their coverage multiplies. */
  masks: LayerMask[];
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  lineHeight: number;
  letterSpacing: number;
  fill: Fill;
  stroke: Stroke | null;
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'line' | 'arrow';

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: ShapeKind;
  fill: Fill | null;
  stroke: Stroke | null;
  cornerRadius: number;
  /** polygon sides / star points */
  sides: number;
  /** star inner radius as a fraction of the outer radius */
  innerRadius: number;
}

export interface GroupLayer extends LayerBase {
  type: 'group';
  children: Layer[];
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | GroupLayer;
export type LayerType = Layer['type'];

export interface ProjectDocument {
  id: string;
  schemaVersion: 2;
  name: string;
  width: number;
  height: number;
  /** null = transparent canvas */
  background: Fill | null;
  /** Bottom-most layer first. */
  layers: Layer[];
  createdAt: number;
  updatedAt: number;
}

type UnionKeys<T> = T extends unknown ? keyof T : never;
type AllLayerProps = { [K in UnionKeys<Layer>]?: Extract<Layer, Record<K, unknown>>[K] };
/** A partial update that may target any layer type. */
export type LayerPatch = Omit<AllLayerProps, 'id' | 'type'>;
