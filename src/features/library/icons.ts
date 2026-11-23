import { ICON_SIZE, ICONS, type IconDef } from './iconData';

/** Line icons as vector layers: looked up by name and stroked straight onto the canvas, sharp at any size. */

const byName = new Map(ICONS.map((icon) => [icon.name, icon]));
const paths = new Map<string, Path2D>();

export const getIcon = (name: string | undefined): IconDef | undefined => (name ? byName.get(name) : undefined);

function iconPath(icon: IconDef) {
  let path = paths.get(icon.name);
  if (!path) {
    path = new Path2D(icon.d);
    paths.set(icon.name, path);
  }
  return path;
}

/** Line weight an icon is designed for (2 units on its 24-unit grid), for an icon `size` pixels across. */
export const defaultIconStroke = (size: number) => Math.max(1, Math.round((size / ICON_SIZE) * 2 * 10) / 10);

/**
 * Strokes the icon centred in the box (0,0)-(w,h), keeping its proportions.
 * `lineWidth` is in the same units as w and h. The caller sets opacity, shadow and blending.
 */
export function drawIcon(ctx: CanvasRenderingContext2D, name: string | undefined, w: number, h: number, color: string, lineWidth: number) {
  const icon = getIcon(name);
  if (!icon) return false;
  const scale = Math.min(w, h) / ICON_SIZE;
  if (!(scale > 0)) return false;
  ctx.save();
  ctx.translate((w - ICON_SIZE * scale) / 2, (h - ICON_SIZE * scale) / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth / scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(iconPath(icon));
  ctx.restore();
  return true;
}
