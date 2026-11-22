import type { Fill } from '../types/document';

export const uid = (prefix = 'l') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function fillToCss(fill: Fill | null): string {
  if (!fill) return 'transparent';
  if (fill.type === 'solid') return fill.color;
  const stops = fill.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
  // CSS angles are measured clockwise from "up"; ours from "right".
  return fill.type === 'linear' ? `linear-gradient(${fill.angle + 90}deg, ${stops})` : `radial-gradient(circle, ${stops})`;
}

export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export const nextFrames = (count = 2) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  });
