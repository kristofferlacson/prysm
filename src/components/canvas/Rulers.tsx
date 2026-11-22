import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';

export const RULER_SIZE = 20;

function tickStep(zoom: number) {
  return [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => s * zoom >= 64) ?? 10000;
}

/** A ruler in artboard units that tracks the current zoom and pan. */
export function Ruler({ orientation }: { orientation: 'h' | 'v' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { zoom, pan, viewport } = useUiStore(useShallow((s) => ({ zoom: s.zoom, pan: s.pan, viewport: s.viewport })));
  const extent = useEditorStore((s) => (orientation === 'h' ? s.doc.width : s.doc.height));
  const length = orientation === 'h' ? viewport.w : viewport.h;
  const offset = orientation === 'h' ? pan.x : pan.y;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !length) return;
    const dpr = window.devicePixelRatio || 1;
    const w = orientation === 'h' ? length : RULER_SIZE;
    const h = orientation === 'h' ? RULER_SIZE : length;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    // Draw as if horizontal; the vertical ruler is the same drawing rotated.
    if (orientation === 'v') {
      ctx.translate(0, length);
      ctx.rotate(-Math.PI / 2);
      ctx.translate(length, 0);
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = '#17181b';
    ctx.fillRect(0, 0, length, RULER_SIZE);
    ctx.fillStyle = '#22242a';
    ctx.fillRect(offset, 0, extent * zoom, RULER_SIZE);

    const step = tickStep(zoom);
    const minor = step / (step * zoom >= 100 ? 10 : 5);
    const first = Math.floor(-offset / zoom / minor) * minor;
    const last = (length - offset) / zoom;
    ctx.strokeStyle = '#4a4d56';
    ctx.fillStyle = '#8f939c';
    ctx.font = '9px Inter, system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = first; v <= last; v += minor) {
      const x = Math.round(offset + v * zoom) + 0.5;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      ctx.moveTo(x, RULER_SIZE);
      ctx.lineTo(x, major ? 4 : RULER_SIZE - 5);
      if (major) {
        if (orientation === 'v') {
          ctx.save();
          ctx.translate(x + 3, 11);
          ctx.scale(-1, 1);
          ctx.textAlign = 'right';
          ctx.fillText(String(Math.round(v)), 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(String(Math.round(v)), x + 3, 11);
        }
      }
    }
    ctx.stroke();
  }, [orientation, zoom, offset, length, extent]);

  return (
    <canvas
      ref={ref}
      className="block"
      style={orientation === 'h' ? { width: length, height: RULER_SIZE } : { width: RULER_SIZE, height: length }}
    />
  );
}
