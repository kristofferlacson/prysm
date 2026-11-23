import type Konva from 'konva';
import type { BlendMode, Fill, Shadow, ShapeLayer, Stroke } from '../../types/document';
import { clamp, deg2rad } from '../../utils/geometry';

/** Translation of document values into Konva node attributes. */

export const compositeOperation = (mode: BlendMode) =>
  (mode === 'normal' ? 'source-over' : mode) as GlobalCompositeOperation;

export function fillProps(fill: Fill | null, w: number, h: number): Record<string, unknown> {
  if (!fill) return { fillEnabled: false };
  if (fill.type === 'solid') return { fillEnabled: true, fill: fill.color, fillPriority: 'color' };
  const stops = [...fill.stops]
    .sort((a, b) => a.offset - b.offset)
    .flatMap((s) => [clamp(s.offset, 0, 1), s.color]);
  if (fill.type === 'linear') {
    const r = deg2rad(fill.angle);
    const dx = Math.cos(r);
    const dy = Math.sin(r);
    const half = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    return {
      fillEnabled: true,
      fillPriority: 'linear-gradient',
      fillLinearGradientStartPoint: { x: w / 2 - dx * half, y: h / 2 - dy * half },
      fillLinearGradientEndPoint: { x: w / 2 + dx * half, y: h / 2 + dy * half },
      fillLinearGradientColorStops: stops,
    };
  }
  return {
    fillEnabled: true,
    fillPriority: 'radial-gradient',
    fillRadialGradientStartPoint: { x: w / 2, y: h / 2 },
    fillRadialGradientEndPoint: { x: w / 2, y: h / 2 },
    fillRadialGradientStartRadius: 0,
    fillRadialGradientEndRadius: Math.hypot(w, h) / 2,
    fillRadialGradientColorStops: stops,
  };
}

export function shadowProps(shadow: Shadow | null) {
  if (!shadow) return { shadowEnabled: false };
  return {
    shadowEnabled: true,
    shadowColor: shadow.color,
    shadowBlur: shadow.blur,
    shadowOffsetX: shadow.offsetX,
    shadowOffsetY: shadow.offsetY,
    shadowOpacity: shadow.opacity,
  };
}

export function strokeProps(stroke: Stroke | null) {
  if (!stroke || stroke.width <= 0) return { strokeEnabled: false };
  return { strokeEnabled: true, stroke: stroke.color, strokeWidth: stroke.width };
}

/** Dash pattern for a shape outline, scaled to its thickness. Dotted lines need round caps to become dots. */
export function dashProps(stroke: Stroke | null): { dash?: number[]; dashEnabled: boolean; lineCap?: 'round' | 'butt' } {
  const w = stroke?.width ?? 0;
  if (!stroke || w <= 0 || !stroke.dash || stroke.dash === 'solid') return { dashEnabled: false };
  return stroke.dash === 'dashed' ? { dashEnabled: true, dash: [w * 3, w * 2] } : { dashEnabled: true, dash: [0.001, w * 2], lineCap: 'round' };
}

export const isOpenShape = (shape: ShapeLayer['shape']) => shape === 'line' || shape === 'arrow';

/** Traces a shape layer's outline inside its width x height box. */
export function traceShape(ctx: Konva.Context, l: ShapeLayer) {
  const { width: w, height: h } = l;
  const cx = w / 2;
  const cy = h / 2;
  ctx.beginPath();
  switch (l.shape) {
    case 'rect': {
      const r = Math.min(l.cornerRadius, w / 2, h / 2);
      if (r > 0) {
        ctx.moveTo(r, 0);
        ctx.arcTo(w, 0, w, h, r);
        ctx.arcTo(w, h, 0, h, r);
        ctx.arcTo(0, h, 0, 0, r);
        ctx.arcTo(0, 0, w, 0, r);
      } else {
        ctx.rect(0, 0, w, h);
      }
      break;
    }
    case 'ellipse':
      ctx.ellipse(cx, cy, cx, cy, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(cx, 0);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      break;
    case 'polygon':
    case 'star': {
      const n = Math.max(3, Math.round(l.sides));
      const points = l.shape === 'star' ? n * 2 : n;
      for (let i = 0; i < points; i++) {
        const k = l.shape === 'star' && i % 2 ? l.innerRadius : 1;
        const a = -Math.PI / 2 + (i / points) * Math.PI * 2;
        const x = cx + Math.cos(a) * cx * k;
        const y = cy + Math.sin(a) * cy * k;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      break;
    }
    case 'icon':
    case 'graphic':
      // Drawn by their own code; their outline (for hit testing and clipping) is the box.
      ctx.rect(0, 0, w, h);
      break;
    case 'line':
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      break;
    case 'arrow': {
      const head = Math.min(w * 0.5, Math.max(12, (l.stroke?.width ?? 2) * 4));
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.moveTo(w - head, cy - head * 0.6);
      ctx.lineTo(w, cy);
      ctx.lineTo(w - head, cy + head * 0.6);
      break;
    }
  }
  if (!isOpenShape(l.shape)) ctx.closePath();
}
