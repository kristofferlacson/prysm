import type { Point } from '../../utils/geometry';
import { hexToRgb } from '../../utils/misc';

const TIP_SIZE = 128;
const tips = new Map<string, HTMLCanvasElement>();

/** A round brush tip: solid out to `hardness` of the radius, then a smooth falloff to transparent. */
export function brushTip(color: string, hardness: number): HTMLCanvasElement {
  const h = Math.min(0.98, Math.max(0, hardness));
  const key = `${color}|${h.toFixed(2)}`;
  let tip = tips.get(key);
  if (!tip) {
    tip = document.createElement('canvas');
    tip.width = tip.height = TIP_SIZE;
    const ctx = tip.getContext('2d')!;
    const [r, g, b] = hexToRgb(color);
    const half = TIP_SIZE / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      // Cosine falloff reads as a soft, natural edge and accumulates smoothly between dabs.
      const alpha = 0.5 + 0.5 * Math.cos(Math.PI * k);
      grad.addColorStop(h + (1 - h) * k, `rgba(${r},${g},${b},${alpha})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TIP_SIZE, TIP_SIZE);
    tips.set(key, tip);
    if (tips.size > 64) tips.delete(tips.keys().next().value!);
  }
  return tip;
}

/** Distance between dabs, in the same units as the brush size. Soft brushes need denser dabs to look smooth. */
export function dabSpacing(size: number, hardness: number) {
  // At 12% of the diameter the scallops a hard round tip leaves along the stroke's sides are
  // about a third of a pixel deep on an 80 px brush: below what is visible.
  return Math.max(0.5, size * (0.06 + 0.06 * hardness));
}

/** Per-dab alpha so that overlapping dabs build up to roughly `flow` in a single pass. */
export function dabAlpha(flow: number) {
  return flow >= 1 ? 1 : 1 - Math.pow(1 - Math.max(0.01, flow), 1 / 4);
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Turns raw pointer samples into evenly spaced dab positions along a smooth curve.
 * Input is stabilised (the stroke trails the pointer slightly) and consecutive points are joined
 * with quadratic curves through their midpoints, so fast or jittery movement still gives round strokes.
 */
export class StrokePath {
  private last: Point | null = null; // last stabilised point
  private pen: Point | null = null; // where the curve has been drawn up to
  private carry = 0;

  constructor(
    private spacing: number,
    private smoothing: number,
  ) {}

  /** Adds a pointer sample and returns the dabs to draw for it. */
  add(raw: Point): Point[] {
    if (!this.last) {
      this.last = { ...raw };
      this.pen = { ...raw };
      return [{ ...raw }];
    }
    const follow = 1 - Math.min(0.95, Math.max(0, this.smoothing)) * 0.85;
    const p = { x: this.last.x + (raw.x - this.last.x) * follow, y: this.last.y + (raw.y - this.last.y) * follow };
    const out: Point[] = [];
    const target = mid(this.last, p);
    this.curveTo(this.last, target, out);
    this.last = p;
    return out;
  }

  /** Finishes the stroke at the pointer's final position. */
  end(raw: Point): Point[] {
    const out: Point[] = [];
    if (!this.last || !this.pen) return out;
    this.curveTo(this.last, raw, out);
    // Dabs are placed at fixed intervals, so the last one usually falls short of the release
    // point by part of an interval. Close the gap: a stroke ends exactly where the pointer did.
    if (this.carry > this.spacing * 0.05) {
      out.push({ ...raw });
      this.carry = 0;
    }
    return out;
  }

  /** Quadratic curve from the current pen position to `to`, bending towards `control`. */
  private curveTo(control: Point, to: Point, out: Point[]) {
    const from = this.pen!;
    const length = Math.hypot(control.x - from.x, control.y - from.y) + Math.hypot(to.x - control.x, to.y - control.y);
    const steps = Math.max(1, Math.ceil(length / Math.max(0.5, this.spacing / 2)));
    let px = from.x;
    let py = from.y;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const x = u * u * from.x + 2 * u * t * control.x + t * t * to.x;
      const y = u * u * from.y + 2 * u * t * control.y + t * t * to.y;
      let seg = Math.hypot(x - px, y - py);
      while (this.carry + seg >= this.spacing && seg > 0) {
        const k = (this.spacing - this.carry) / seg;
        px += (x - px) * k;
        py += (y - py) * k;
        out.push({ x: px, y: py });
        seg = Math.hypot(x - px, y - py);
        this.carry = 0;
      }
      this.carry += seg;
      px = x;
      py = y;
    }
    this.pen = { ...to };
  }
}
