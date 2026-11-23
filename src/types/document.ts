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
  /** Line style for shape outlines. Absent = solid. */
  dash?: 'solid' | 'dashed' | 'dotted';
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
 * The bitmap is a coverage map in SOURCE SPACE: it spans the unit square of the layer's uncropped
 * source image, whatever its own pixel size (see features/masks/maskSpace.ts). That one definition
 * is what keeps it aligned through move, resize, rotation, flips, cropping and export at any scale.
 * Coverage is stored in the alpha channel: opaque = reveal (white), transparent = conceal (black),
 * anything between = partial transparency (grey).
 */
export interface LayerMask {
  id: string;
  rasterId: string;
  /** Sampling density of the bitmap. Independent of the source's size and of the layer's size on canvas. */
  width: number;
  height: number;
  enabled: boolean;
  /** Edge softness as a fraction of the source image's longer side. 0 = crisp. */
  feather: number;
  origin: 'manual' | 'background-removal';
}

/** Input range (black and white points, midtone gamma) and output range, all on a 0..255 scale. */
export interface Levels {
  black: number;
  white: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

/** One control point of a tone curve: [input, output], both 0..255. */
export type CurvePoint = [number, number];
export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';
/** A tone curve for all channels together and one for each channel, each sorted by input. */
export type Curves = Record<CurveChannel, CurvePoint[]>;

export interface Adjustments {
  /** Absent or null = unchanged. (Optional so that layers saved before these existed stay valid.) */
  levels?: Levels | null;
  curves?: Curves | null;
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
  | 'noise'
  | 'teal-orange'
  | 'bleach-bypass'
  | 'cross-process'
  | 'split-tone'
  | 'spotlight'
  | 'bulge'
  | 'pinch'
  | 'swirl'
  | 'ripple'
  | 'oil-paint'
  | 'emboss'
  | 'vibrance'
  | 'colorize'
  | 'motion-blur'
  | 'bloom'
  | 'light-streaks';

export interface EffectInstance {
  type: EffectType;
  /** 0..1 */
  amount: number;
  /** For effects with a choice of colours (duotone, split toning). Falls back to the effect's defaults. */
  colors?: string[];
  /** For directional effects (motion blur), in degrees. Falls back to the effect's default. */
  angle?: number;
  /** false = kept in the stack with its settings, but not applied. */
  enabled?: boolean;
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

/** Where a fade eats into the image from: a side, a corner, or all round (an oval). */
export type FadeFrom = 'top-left' | 'top' | 'top-right' | 'left' | 'around' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

/**
 * A gradual transparency on an image, in the box of what is visible of it (after cropping).
 * It is made of parts (sides, corners, all round, one free direction, one shape) that multiply.
 * Distances are measured inwards from where each part starts, as a share of the box (for the
 * shape: of the way from its outline to its deepest point).
 */
export interface Fade {
  from: FadeFrom[];
  /** A straight fade towards any direction, in degrees (0 = the image fades away to the right, 90 = downwards). */
  angle: number | null;
  /** A shape drawn by the user: the image shows inside it and fades at its outline. A bitmap in the layer's source space, like a mask. */
  shape: { rasterId: string; width: number; height: number } | null;
  /**
   * Brush strokes: where the user painted, the image fades (by as much as was painted). A bitmap in
   * the layer's source space, like a mask. It is not affected by `start` and `reach`.
   */
  paint?: { rasterId: string; width: number; height: number } | null;
  /** The image is fully faded up to here… */
  start: number;
  /** …and untouched from here on. */
  reach: number;
  /** How transparent the fully faded part is: 1 = gone, less = only softened. */
  strength: number;
  /** Swap what is kept and what is faded. */
  invert: boolean;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  /** Absent or null = no fade. */
  fade?: Fade | null;
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

export const WARP_STYLES = ['arc', 'arc-lower', 'arc-upper', 'arch', 'bulge', 'flag', 'rise', 'squeeze', 'custom'] as const;
/** 'shape' is not a preset: it is set by "Fit text to this shape" and carries the outline it follows. */
export type WarpStyle = (typeof WARP_STYLES)[number] | 'shape';

/**
 * A non-destructive envelope distortion of a text layer. The text stays editable: the warp is a
 * mapping of the text box onto a curved shape, applied when the layer is drawn
 * (see features/text-warp/warp.ts). Everything is relative to the text box, so the shape
 * follows the layer when it is resized or the text changes.
 */
export interface TextWarp {
  /**
   * 'shape' only: the outline the text fills, as its top and bottom edge at evenly spaced positions
   * across the text's width. Values are in units of the text's width, measured down from the top
   * of the text box, so the shape scales with the layer.
   */
  shape?: { top: number[]; bottom: number[] };
  style: WarpStyle;
  /** -1..1. How strongly the preset shape bends. Unused by 'custom'. */
  bend: number;
  /** -1..1. Perspective-like taper across the width / the height. Unused by 'custom'. */
  horizontal: number;
  vertical: number;
  /**
   * 'custom' only: the 16 control points of a bicubic Bézier patch, row by row from the top-left,
   * as x,y pairs in units of the text box (0,0 = top-left corner, 1,1 = bottom-right).
   */
  mesh?: number[];
}

/** Soft light around the letters. Sizes are fractions of the font size, so they scale with the text. */
export interface TextGlow {
  color: string;
  /** 0..1 */
  size: number;
  /** 0..1 */
  strength: number;
}

/** A solid block behind the letters that makes them look three-dimensional (the "retro" look). */
export interface TextExtrude {
  color: string;
  /** Fraction of the font size. */
  depth: number;
  /** Direction the block extends in, degrees clockwise from "right". */
  angle: number;
}

/** A lit edge and a shaded edge inside the letters: with a gradient fill this reads as metal. */
export interface TextBevel {
  /** 0..1 */
  depth: number;
}

/** Worn, printed-by-hand look: specks and patches are knocked out of the letters. */
export interface TextDistress {
  /** 0..1, how much is worn away. */
  amount: number;
  /** 0..1, fine grit to coarse patches. */
  scale: number;
  seed: number;
}

/** A filled panel behind the text block. Padding is a fraction of the font size; radius 0 = square, 1 = pill. */
export interface TextBackdrop {
  color: string;
  padding: number;
  radius: number;
}

/**
 * Non-destructive text effects. They are drawn after the warp, like layer styles, so a glow
 * follows the bent outline. Any of them can be changed or switched off at any time.
 */
/**
 * The text is cut in two along a horizontal line; the lower part drops down and grows, and a
 * slanted band joins the two cut edges, as if the word were folded towards the viewer.
 */
export interface TextFold {
  /** Where the cut is, as a fraction of the text's height from its top (0..1). */
  position: number;
  /** How far the lower part drops, as a fraction of the font size. */
  drop: number;
  /** How much larger the lower part is: 0 = the same size, 0.25 = a quarter larger. */
  spread: number;
  /** The band's tone relative to the text: above 0 lighter, below 0 darker (-1..1). */
  shade: number;
}

export interface TextEffects {
  /** Absent on text saved before the effect existed. */
  fold?: TextFold | null;
  glow: TextGlow | null;
  extrude: TextExtrude | null;
  bevel: TextBevel | null;
  distress: TextDistress | null;
  /** Absent in projects saved before it existed; treated as null. */
  backdrop?: TextBackdrop | null;
}

/**
 * A line the text runs along, letter by letter, each letter turned to follow it (unlike a warp,
 * the letters themselves are not distorted).
 * - 'curve': a cubic Bézier, as x,y pairs for start, two control points and end, in units of the
 *   text box (0,0 = top-left, 1,1 = bottom-right). The points are dragged on the canvas.
 * - 'circle': around the circle whose diameter is the box width, centred on the box. `flip`
 *   puts the text along the bottom, reading left to right, instead of over the top.
 */
export type TextPathSpec = { kind: 'curve'; points: number[] } | { kind: 'circle'; flip: boolean };

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
  warp: TextWarp | null;
  /** Stacks the letters one per line, top to bottom. The text itself is stored unchanged. */
  vertical?: boolean;
  /** Replaces the warp when set: text follows a path instead of filling an envelope. */
  path: TextPathSpec | null;
  effects: TextEffects;
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'star' | 'line' | 'arrow' | 'icon' | 'graphic';

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
  /** shape 'icon': name of a line icon from the built-in set. Drawn with `stroke`. */
  icon?: string;
  /** shape 'graphic': id of a code-drawn vector graphic (sticker, frame, illustration). */
  graphic?: string;
  /** shape 'graphic': its palette, one entry per colour slot of the graphic. */
  colors?: string[];
}

export interface GroupLayer extends LayerBase {
  type: 'group';
  children: Layer[];
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | GroupLayer;
export type LayerType = Layer['type'];

/** A selection kept with the project under a name (what other editors call an alpha channel). */
export interface SavedSelection {
  id: string;
  name: string;
  /** Coverage bitmap in the raster store, covering the whole canvas. */
  rasterId: string;
  width: number;
  height: number;
}

export interface ProjectDocument {
  id: string;
  schemaVersion: 6;
  name: string;
  width: number;
  height: number;
  /** null = transparent canvas */
  background: Fill | null;
  /** Bottom-most layer first. */
  layers: Layer[];
  selections: SavedSelection[];
  createdAt: number;
  updatedAt: number;
}

type UnionKeys<T> = T extends unknown ? keyof T : never;
type PropOf<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;
type AllLayerProps = { [K in UnionKeys<Layer>]?: PropOf<Layer, K> };
/** A partial update that may target any layer type. */
export type LayerPatch = Omit<AllLayerProps, 'id' | 'type'>;
