import Konva from 'konva';
import { fillProps, strokeProps } from '../../components/canvas/konvaProps';
import { fontStack } from '../../services/fonts';
import type { Fill, TextLayer } from '../../types/document';
import { clamp, deg2rad, type Rect } from '../../utils/geometry';
import { maxSourceSize, meshBackend, renderMesh, type Mesh } from './meshRenderer';
import { applyTextEffects, hasTextEffects, type TextPicture } from './textEffects';
import { pathData } from './textPath';
import { isIdentityWarp, warpFunction, type InkBox } from './warp';

const MAX_OUTPUT = 4096;
/** Most times over that the flat text image is enlarged, per direction, to feed a stretching warp. */
const MAX_SUPERSAMPLE = 8;
/** Upper bound on the flat text image, in pixels. */
const MAX_SOURCE_AREA = 24_000_000;

/** How much the warp lengthens the text along its width and along its height, at its most stretched place. */
function warpStretch(fn: (x: number, y: number) => [number, number], srcW: number, srcH: number, pad: number, nx: number, ny: number) {
  let x = 1;
  let y = 1;
  const stepX = srcW / nx;
  const stepY = srcH / ny;
  let above: [number, number][] = [];
  for (let j = 0; j <= ny; j++) {
    const row: [number, number][] = [];
    for (let i = 0; i <= nx; i++) row.push(fn(i * stepX - pad, j * stepY - pad));
    for (let i = 0; i <= nx; i++) {
      if (i < nx) x = Math.max(x, Math.hypot(row[i + 1][0] - row[i][0], row[i + 1][1] - row[i][1]) / stepX);
      if (j > 0) y = Math.max(y, Math.hypot(row[i][0] - above[i][0], row[i][1] - above[i][1]) / stepY);
    }
    above = row;
  }
  return { x, y };
}

export interface StyledText {
  canvas: HTMLCanvasElement;
  /** Where the canvas sits, in the layer's own coordinates (origin at the text box's top-left). */
  bounds: Rect;
  /** Bounding box of the shaped text itself, without margins for outlines or glow: what selection frames. */
  outline: Rect;
  /** Height of the flat text block, which the document keeps as the layer's height. Null for text on a path. */
  textHeight: number | null;
}

interface Stage extends TextPicture {
  outline: Rect;
  textHeight: number | null;
}

/** The attributes that make a Konva text node look like the layer. Shared with the plain text renderer. */
export function textAttrs(layer: TextLayer) {
  return {
    width: layer.width,
    // Vertical text is the same words set one letter per line.
    text: layer.vertical ? [...layer.text.replace(/\s*\n\s*/g, ' ')].join('\n') : layer.text,
    fontFamily: fontStack(layer.fontFamily),
    fontSize: layer.fontSize,
    fontStyle: `${layer.italic ? 'italic ' : ''}${layer.fontWeight}`,
    textDecoration: layer.underline ? 'underline' : '',
    align: layer.align,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing,
    ...strokeProps(layer.stroke),
    lineJoin: 'round' as const,
    fillAfterStrokeEnabled: true,
  };
}

/** Text that follows a path or fills a warp envelope: its outline is no longer its box. */
export const isShapedText = (layer: TextLayer) => !!layer.path || !isIdentityWarp(layer.warp);

/**
 * Plain text is drawn as vector text. Anything beyond that (warp, path, effects) is drawn as a
 * picture of the text, made at the size it is shown or exported at.
 */
export const needsPicture = (layer: TextLayer) => !!layer.text && (isShapedText(layer) || hasTextEffects(layer.effects));

/** Room for outlines, italics and glyphs that overshoot the line box. */
const padding = (layer: TextLayer) => Math.ceil((layer.stroke?.width ?? 0) / 2 + layer.fontSize * 0.3);

function flatText(layer: TextLayer, density: number): Stage {
  const node = new Konva.Text(textAttrs(layer));
  try {
    const w = layer.width;
    const h = node.height();
    node.setAttrs(fillProps(layer.fill, w, h));
    const pad = padding(layer);
    const d = Math.min(density, MAX_OUTPUT / (w + pad * 2), MAX_OUTPUT / (h + pad * 2));
    const canvas = node.toCanvas({ x: -pad, y: -pad, width: w + pad * 2, height: h + pad * 2, pixelRatio: d });
    return {
      canvas,
      bounds: { x: -pad, y: -pad, width: canvas.width / d, height: canvas.height / d },
      density: d,
      outline: { x: 0, y: 0, width: w, height: h },
      textHeight: h,
    };
  } finally {
    node.destroy();
  }
}

function gradientOf(ctx: CanvasRenderingContext2D, fill: Exclude<Fill, { type: 'solid' }>, r: Rect) {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  let gradient: CanvasGradient;
  if (fill.type === 'linear') {
    const a = deg2rad(fill.angle);
    const half = (Math.abs(Math.cos(a)) * r.width + Math.abs(Math.sin(a)) * r.height) / 2;
    gradient = ctx.createLinearGradient(cx - Math.cos(a) * half, cy - Math.sin(a) * half, cx + Math.cos(a) * half, cy + Math.sin(a) * half);
  } else {
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(r.width, r.height) / 2);
  }
  for (const stop of [...fill.stops].sort((a, b) => a.offset - b.offset)) gradient.addColorStop(clamp(stop.offset, 0, 1), stop.color);
  return gradient;
}

/**
 * Letters set one by one along the layer's path, each turned to follow it. Konva places the
 * glyphs; a gradient fill is laid over the finished line (a per-letter gradient would restart
 * at every letter).
 */
function textOnPath(layer: TextLayer, density: number): Stage | null {
  const base = {
    data: pathData(layer),
    text: layer.text.replace(/\s*\n\s*/g, ' '),
    fontFamily: fontStack(layer.fontFamily),
    fontSize: layer.fontSize,
    fontStyle: `${layer.italic ? 'italic ' : ''}${layer.fontWeight}`,
    textDecoration: layer.underline ? 'underline' : '',
    letterSpacing: layer.letterSpacing,
    align: layer.align,
    textBaseline: 'alphabetic',
    lineJoin: 'round' as const,
  };
  const solid = layer.fill.type === 'solid' ? layer.fill.color : '#000000';
  const fillNode = new Konva.TextPath({ ...base, fill: solid });
  const strokeNode = layer.stroke && layer.stroke.width > 0 ? new Konva.TextPath({ ...base, fillEnabled: false, ...strokeProps(layer.stroke) }) : null;
  try {
    const rect = fillNode.getSelfRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const pad = Math.ceil((layer.stroke?.width ?? 0) / 2 + layer.fontSize * 0.75);
    const region = { x: Math.floor(rect.x - pad), y: Math.floor(rect.y - pad), width: Math.ceil(rect.width + pad * 2), height: Math.ceil(rect.height + pad * 2) };
    const d = Math.min(density, MAX_OUTPUT / region.width, MAX_OUTPUT / region.height);
    const canvas = fillNode.toCanvas({ ...region, pixelRatio: d });
    const ctx = canvas.getContext('2d')!;
    if (layer.fill.type !== 'solid') {
      ctx.save();
      ctx.globalCompositeOperation = 'source-in';
      ctx.setTransform(d, 0, 0, d, -region.x * d, -region.y * d);
      ctx.fillStyle = gradientOf(ctx, layer.fill, rect);
      ctx.fillRect(region.x, region.y, region.width, region.height);
      ctx.restore();
    }
    if (strokeNode) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'destination-over';
      ctx.drawImage(strokeNode.toCanvas({ ...region, pixelRatio: d }), 0, 0);
      ctx.restore();
    }
    return {
      canvas,
      bounds: { x: region.x, y: region.y, width: canvas.width / d, height: canvas.height / d },
      density: d,
      outline: rect,
      textHeight: null,
    };
  } finally {
    fillNode.destroy();
    strokeNode?.destroy();
  }
}

/**
 * The text stretched through its warp. It is first set flat by the same Konva text node the editor
 * uses for unwarped text, so fonts, wrapping, gradients, outlines and underlines are identical;
 * that image is then drawn over a fine grid whose vertices the warp function has moved.
 */
/** Where the letters are inside the text box, found on a small rendering of the flat text. */
function inkBox(node: Konva.Text, w: number, h: number, pad: number): InkBox {
  const k = Math.min(2, 520 / (w + pad * 2));
  const canvas = node.toCanvas({ x: -pad, y: -pad, width: w + pad * 2, height: h + pad * 2, pixelRatio: k });
  const { data } = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = canvas.width;
  let y0 = canvas.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] < 48) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { left: 0, top: 0, right: w, bottom: h };
  return { left: x0 / k - pad, top: y0 / k - pad, right: (x1 + 1) / k - pad, bottom: (y1 + 1) / k - pad };
}

function warpedText(layer: TextLayer, density: number): Stage | null {
  // Text shaped to a layer is always set on one line (per typed line): however long the words are,
  // they are stretched or squeezed to the shape's width instead of wrapping inside it.
  const shaped = layer.warp!.style === 'shape';
  const node = new Konva.Text(shaped ? { ...textAttrs(layer), width: undefined, wrap: 'none', align: 'left' } : textAttrs(layer));
  try {
    const w = layer.width;
    // Width of the flat text that is fed into the warp. Only differs from the layer's width for shaped text.
    const flatW = shaped ? Math.max(1, node.getTextWidth()) : w;
    const h = node.height();
    node.setAttrs(fillProps(layer.fill, flatW, h));
    const pad = padding(layer);
    const srcW = flatW + pad * 2;
    const srcH = h + pad * 2;
    // It fills the shape with its letters, not with its (larger) text box.
    const ink = shaped ? inkBox(node, flatW, h, pad) : undefined;
    const fn = warpFunction(layer.warp!, w, h, ink);
    const box = ink ?? { left: 0, top: 0, right: w, bottom: h };

    // The warp may stretch the text several times over in one direction. Both the grid and the
    // flat image are sized for the text as it will be drawn, not as it is typed.
    const stretch = warpStretch(fn, srcW, srcH, pad, 32, 12);
    // Grid over the padded text image. Cells are about 12 output pixels (coarser on the slow path).
    const cell = meshBackend() === 'webgl2' ? 12 : 28;
    const nx = Math.min(200, Math.max(16, Math.ceil((srcW * density * Math.min(stretch.x, MAX_SUPERSAMPLE)) / cell)));
    const ny = Math.min(120, Math.max(8, Math.ceil((srcH * density * Math.min(stretch.y, MAX_SUPERSAMPLE)) / cell)));
    const cols = nx + 1;
    const count = cols * (ny + 1);
    const warped = new Float32Array(count * 2);
    const uvs = new Float32Array(count * 2);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const k = (j * cols + i) * 2;
        const [x, y] = fn((i / nx) * srcW - pad, (j / ny) * srcH - pad);
        warped[k] = x;
        warped[k + 1] = y;
        uvs[k] = i / nx;
        uvs[k + 1] = j / ny;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!Number.isFinite(minX + minY + maxX + maxY)) return null;

    // The selection frame hugs the warped text box, not the margin around it.
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (let j = 0; j <= 8; j++) {
      for (let i = 0; i <= 32; i++) {
        const [x, y] = fn(box.left + (i / 32) * (box.right - box.left), box.top + (j / 8) * (box.bottom - box.top));
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }

    const boundsW = Math.max(1, maxX - minX);
    const boundsH = Math.max(1, maxY - minY);
    const outDensity = Math.min(density, MAX_OUTPUT / boundsW, MAX_OUTPUT / boundsH);
    const outW = Math.max(1, Math.ceil(boundsW * outDensity));
    const outH = Math.max(1, Math.ceil(boundsH * outDensity));
    const limit = maxSourceSize();
    // Where the warp enlarges the text, the flat image needs as many more pixels in that direction,
    // or the stretched edges show steps. Width and height are treated separately: text pulled five
    // times taller needs five times the rows but no extra columns.
    // The factor is a whole number because browsers snap a text baseline to whole pixels: a flat
    // image made at, say, 1.02x would sit up to a pixel away from where the same text is drawn
    // unwarped, while at 1x, 2x, 3x... it lands on exactly the same pixels.
    const factor = (v: number) => (v <= 1.001 ? 1 : Math.min(MAX_SUPERSAMPLE, Math.max(2, Math.ceil(v - 0.05))));
    let densityX = Math.min(outDensity * factor(stretch.x), limit / srcW);
    let densityY = Math.min(outDensity * factor(stretch.y), limit / srcH);
    const area = srcW * densityX * srcH * densityY;
    if (area > MAX_SOURCE_AREA) {
      const k = Math.sqrt(MAX_SOURCE_AREA / area);
      densityX *= k;
      densityY *= k;
    }
    node.scale({ x: densityX, y: densityY });
    const flat = node.toCanvas({ x: -pad * densityX, y: -pad * densityY, width: srcW * densityX, height: srcH * densityY, pixelRatio: 1 });

    // A canvas has whole-pixel dimensions, so the flat image covers very slightly less than the
    // padded box. Texture coordinates are corrected for that; otherwise the text would be drawn
    // a fraction of a percent too large.
    const uScale = (srcW * densityX) / flat.width;
    const vScale = (srcH * densityY) / flat.height;
    const positions = new Float32Array(count * 2);
    for (let k = 0; k < count * 2; k += 2) {
      positions[k] = (warped[k] - minX) * outDensity;
      positions[k + 1] = (warped[k + 1] - minY) * outDensity;
      uvs[k] *= uScale;
      uvs[k + 1] *= vScale;
    }
    const indices = new Uint16Array(nx * ny * 6);
    let n = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const c = a + cols;
        const e = c + 1;
        indices[n++] = a;
        indices[n++] = b;
        indices[n++] = c;
        indices[n++] = b;
        indices[n++] = e;
        indices[n++] = c;
      }
    }
    const mesh: Mesh = { positions, uvs, indices };
    return {
      canvas: renderMesh(flat, mesh, outW, outH),
      bounds: { x: minX, y: minY, width: outW / outDensity, height: outH / outDensity },
      density: outDensity,
      outline: { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
      textHeight: h,
    };
  } finally {
    node.destroy();
  }
}

/**
 * Draws a text layer that needs more than plain vector text: on a path or through a warp, then
 * with its effects. `density` is output pixels per layer unit: the editor passes the on-screen
 * scale and export passes the export scale, so the picture is made at the size it is seen at.
 */
export function renderStyledText(layer: TextLayer, density: number): StyledText | null {
  if (!layer.text) return null;
  const shaped = layer.path ? textOnPath(layer, density) : !isIdentityWarp(layer.warp) ? warpedText(layer, density) : flatText(layer, density);
  if (!shaped) return null;
  const styled = applyTextEffects(shaped, layer, shaped.outline);
  return { canvas: styled.canvas, bounds: styled.bounds, outline: styled.outline ?? shaped.outline, textHeight: shaped.textHeight };
}
