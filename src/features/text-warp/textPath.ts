import type { TextLayer, TextPathSpec } from '../../types/document';

/** Text on a path: the line the letters follow, and the edits made by dragging its points. */

export type PathChoice = 'none' | 'curve' | 'circle' | 'circle-bottom';

export const PATH_LABELS: Record<PathChoice, string> = {
  none: 'None',
  curve: 'Curve (drag points)',
  circle: 'Circle, text on top',
  'circle-bottom': 'Circle, text below',
};

export const pathChoice = (path: TextPathSpec | null): PathChoice =>
  !path ? 'none' : path.kind === 'curve' ? 'curve' : path.flip ? 'circle-bottom' : 'circle';

/** A gentle arch across the text box: a sensible curve to start dragging from. */
export const defaultCurve = (): number[] => [0, 0.85, 0.3, -0.7, 0.7, -0.7, 1, 0.85];

export function pathFromChoice(choice: PathChoice, current: TextPathSpec | null): TextPathSpec | null {
  switch (choice) {
    case 'none':
      return null;
    case 'curve':
      return current?.kind === 'curve' ? current : { kind: 'curve', points: defaultCurve() };
    case 'circle':
      return { kind: 'circle', flip: false };
    case 'circle-bottom':
      return { kind: 'circle', flip: true };
  }
}

const validCurve = (points: number[] | undefined): points is number[] =>
  Array.isArray(points) && points.length === 8 && points.every((v) => Number.isFinite(v));

export const curvePoints = (path: TextPathSpec): number[] =>
  path.kind === 'curve' && validCurve(path.points) ? path.points : defaultCurve();

/** SVG path data for the layer's path, in the layer's own pixels. */
export function pathData(layer: Pick<TextLayer, 'width' | 'height' | 'path'>): string {
  const { width: w, height: h, path } = layer;
  if (!path) return '';
  if (path.kind === 'circle') {
    const r = w / 2;
    const cx = w / 2;
    const cy = h / 2;
    // A full turn that starts opposite the text, so centred text sits at the top (or the bottom).
    return path.flip
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy + r} A ${r} ${r} 0 1 0 ${cx} ${cy - r}`
      : `M ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r}`;
  }
  const p = curvePoints(path);
  const x = (i: number) => p[i * 2] * w;
  const y = (i: number) => p[i * 2 + 1] * h;
  return `M ${x(0)} ${y(0)} C ${x(1)} ${y(1)} ${x(2)} ${y(2)} ${x(3)} ${y(3)}`;
}

/**
 * Moves point `index` of a curve (0 = start, 1 and 2 = control points, 3 = end) by (dx, dy) box
 * units. An end point carries its control point with it, so the curve keeps its shape there.
 */
export function moveCurvePoint(points: number[], index: number, dx: number, dy: number): number[] {
  const next = [...points];
  const moved = index === 0 ? [0, 1] : index === 3 ? [3, 2] : [index];
  for (const i of moved) {
    next[i * 2] += dx;
    next[i * 2 + 1] += dy;
  }
  return next;
}
