import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { wandAt } from '../../features/selection/selectionActions';
import {
  clearSelectionArea,
  selectEllipse,
  selectPolygon,
  selectRect,
  useAreaSelection,
  type SelectionMode,
} from '../../features/selection/selectionStore';
import { useEditorStore } from '../../stores/editorStore';
import { isSelectTool, useUiStore } from '../../stores/uiStore';
import type { Point } from '../../utils/geometry';

const STRIPE = 8;

/** Diagonal black and white stripes: the "marching ants" are this pattern showing through the outline. */
function makeStripes() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = STRIPE;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(STRIPE, STRIPE);
  for (let y = 0; y < STRIPE; y++) {
    for (let x = 0; x < STRIPE; x++) {
      const v = (x + y) % STRIPE < STRIPE / 2 ? 0 : 255;
      const i = (y * STRIPE + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Draws the moving outline of the selection at screen resolution, so it is one screen pixel wide at
 * any zoom. The outline is the selection's hard-edged shape grown by a pixel with the shape itself
 * cut out; it is rebuilt only when the selection or the view changes, and the animation just
 * slides the stripe pattern underneath it.
 */
function useMarchingAnts(canvasRef: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const fill = document.createElement('canvas');
    const ring = document.createElement('canvas');
    const pattern = ctx.createPattern(makeStripes(), 'repeat')!;
    let dirty = true;
    let raf = 0;
    let last = 0;
    let offset = 0;

    const rebuild = () => {
      const { zoom, pan, viewport } = useUiStore.getState();
      const { outline } = useAreaSelection.getState();
      const { doc } = useEditorStore.getState();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(viewport.w * dpr));
      const h = Math.max(1, Math.round(viewport.h * dpr));
      for (const c of [canvas, fill, ring]) {
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
      }
      canvas.dataset.active = outline ? 'true' : 'false';
      if (!outline) {
        ctx.clearRect(0, 0, w, h);
        return false;
      }
      const f = fill.getContext('2d')!;
      f.clearRect(0, 0, w, h);
      // Zoomed in, selection pixels are shown as the squares they are; zoomed out, they are averaged.
      f.imageSmoothingEnabled = doc.width * zoom * dpr < outline.width;
      f.drawImage(outline, Math.round(pan.x * dpr), Math.round(pan.y * dpr), Math.round(doc.width * zoom * dpr), Math.round(doc.height * zoom * dpr));
      const r = ring.getContext('2d')!;
      r.globalCompositeOperation = 'source-over';
      r.clearRect(0, 0, w, h);
      const t = Math.max(1, Math.round(dpr));
      for (const [dx, dy] of [[-t, 0], [t, 0], [0, -t], [0, t]]) r.drawImage(fill, dx, dy);
      r.globalCompositeOperation = 'destination-out';
      r.drawImage(fill, 0, 0);
      return true;
    };

    const paint = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pattern.setTransform(new DOMMatrix().translate(offset, 0));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(ring, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    };

    const frame = (time: number) => {
      raf = 0;
      if (dirty) {
        dirty = false;
        // Nothing selected: the canvas is cleared and the animation stops until there is.
        if (!rebuild()) return;
        paint();
      } else if (time - last >= 90) {
        last = time;
        offset = (offset + 1) % STRIPE;
        paint();
      }
      raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const offUi = useUiStore.subscribe((s, p) => {
      if (s.zoom !== p.zoom || s.pan !== p.pan || s.viewport !== p.viewport) kick();
    });
    const offSelection = useAreaSelection.subscribe((s, p) => {
      if (s.version !== p.version) kick();
    });
    kick();
    return () => {
      offUi();
      offSelection();
      cancelAnimationFrame(raf);
    };
  }, [canvasRef]);
}

interface Drag {
  kind: 'marquee' | 'lasso';
  mode: SelectionMode;
  /** Pointer positions relative to the overlay, in screen pixels. */
  start: Point;
  last: Point;
  /** The lasso's path so far, in document units. */
  points: Point[];
  trail: string;
}

/**
 * The selection outline (always shown while something is selected) and, while a selection tool is
 * active, the surface that takes its pointer input. Shift adds to the selection, Alt subtracts,
 * both together intersect; otherwise the mode chosen in the options bar applies.
 */
export function SelectionOverlay({ onPan }: { onPan: (evt: MouseEvent) => void }) {
  const { tool, spaceHeld } = useUiStore(useShallow((s) => ({ tool: s.tool, spaceHeld: s.spaceHeld })));
  const active = isSelectTool(tool);
  const polygonTool = useAreaSelection((s) => s.lassoMode === 'polygon') && tool === 'lasso';
  /** A polygon being clicked out corner by corner (document units). */
  const poly = useRef<{ mode: SelectionMode; points: Point[] } | null>(null);
  const lastPress = useRef({ time: 0, x: 0, y: 0 });
  const antsRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<SVGPathElement>(null);
  const lightRef = useRef<SVGPathElement>(null);
  const drag = useRef<Drag | null>(null);
  useMarchingAnts(antsRef);

  const preview = (d: string) => {
    darkRef.current?.setAttribute('d', d);
    lightRef.current?.setAttribute('d', d);
  };
  useEffect(() => {
    if (!active) drag.current = null;
  }, [active]);

  const drawPolygon = (cursor: Point | null) => {
    const p = poly.current;
    if (rootRef.current) rootRef.current.dataset.polygonPoints = String(p?.points.length ?? 0);
    if (!p) {
      preview('');
      return;
    }
    const { pan, zoom } = useUiStore.getState();
    const corners = p.points.map((q) => ({ x: pan.x + q.x * zoom, y: pan.y + q.y * zoom }));
    let d = corners.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${q.y}`).join('');
    if (cursor) d += `L${cursor.x} ${cursor.y}`;
    // A small square marks the first corner: clicking it closes the shape.
    d += `M${corners[0].x - 4} ${corners[0].y - 4}h8v8h-8Z`;
    preview(d);
  };
  const endPolygon = (commit: boolean) => {
    const p = poly.current;
    poly.current = null;
    drawPolygon(null);
    if (commit && p && p.points.length >= 3) selectPolygon(p.points, p.mode);
  };
  // Leaving the polygon lasso abandons a shape in progress.
  useEffect(() => {
    if (!polygonTool && poly.current) endPolygon(false);
  });
  // While a polygon is being drawn, Enter closes it, Backspace steps back and Escape abandons it.
  // The keys are taken before the editor's own shortcuts see them.
  useEffect(() => {
    if (!polygonTool) return;
    const onKey = (e: KeyboardEvent) => {
      const p = poly.current;
      if (!p) return;
      if (e.key === 'Enter') endPolygon(true);
      else if (e.key === 'Escape') endPolygon(false);
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        p.points.pop();
        if (p.points.length) drawPolygon(null);
        else endPolygon(false);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = rootRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const toDoc = (p: Point): Point => {
    const { pan, zoom } = useUiStore.getState();
    return { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
  };

  const shapePath = (a: Point, b: Point) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (useAreaSelection.getState().marqueeShape === 'rect') return `M${x} ${y}h${w}v${h}h${-w}Z`;
    const rx = w / 2;
    const ry = h / 2;
    return `M${x} ${y + ry}a${rx} ${ry} 0 1 0 ${w} 0a${rx} ${ry} 0 1 0 ${-w} 0Z`;
  };

  const finish = () => {
    const d = drag.current;
    drag.current = null;
    preview('');
    if (!d) return;
    const moved = Math.hypot(d.last.x - d.start.x, d.last.y - d.start.y) >= 3 || d.points.length > 6;
    if (!moved) {
      // A plain click with a selection tool clears the selection, as in other editors.
      if (d.mode === 'new') clearSelectionArea();
      return;
    }
    if (d.kind === 'lasso') {
      selectPolygon(d.points, d.mode);
      return;
    }
    const a = toDoc(d.start);
    const b = toDoc(d.last);
    const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
    if (useAreaSelection.getState().marqueeShape === 'rect') selectRect(rect, d.mode);
    else selectEllipse(rect, d.mode);
  };

  return (
    <>
      <canvas ref={antsRef} data-testid="selection-outline" className="pointer-events-none absolute inset-0 z-[5] h-full w-full" />
      {active && (
        <div
          ref={rootRef}
          data-testid="selection-overlay"
          className="absolute inset-0 z-10 touch-none"
          style={{ pointerEvents: spaceHeld ? 'none' : 'auto', cursor: 'crosshair' }}
          onPointerDown={(e) => {
            if (e.button === 1) {
              onPan(e.nativeEvent);
              return;
            }
            if (e.button !== 0) return;
            e.preventDefault();
            const chosen = useAreaSelection.getState().mode;
            const mode: SelectionMode = e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : chosen;
            const local = toLocal(e);
            if (tool === 'wand') {
              void wandAt(toDoc(local), mode);
              return;
            }
            if (polygonTool) {
              const p = poly.current;
              if (!p) {
                lastPress.current = { time: e.timeStamp, x: local.x, y: local.y };
                poly.current = { mode, points: [toDoc(local)] };
                drawPolygon(local);
                return;
              }
              const { pan, zoom } = useUiStore.getState();
              const first = { x: pan.x + p.points[0].x * zoom, y: pan.y + p.points[0].y * zoom };
              const onFirst = p.points.length >= 3 && Math.hypot(local.x - first.x, local.y - first.y) <= 10;
              // The second press of a double-click closes the shape instead of adding a corner.
              // (Pointer events carry no click count, so the double press is recognised here.)
              const previous = lastPress.current;
              const double = e.timeStamp - previous.time < 400 && Math.hypot(local.x - previous.x, local.y - previous.y) < 5;
              lastPress.current = { time: e.timeStamp, x: local.x, y: local.y };
              if (onFirst || double) endPolygon(true);
              else {
                p.points.push(toDoc(local));
                drawPolygon(local);
              }
              return;
            }
            drag.current = {
              kind: tool === 'lasso' ? 'lasso' : 'marquee',
              mode,
              start: local,
              last: local,
              points: [toDoc(local)],
              trail: `M${local.x} ${local.y}`,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (poly.current) {
              drawPolygon(toLocal(e));
              return;
            }
            const d = drag.current;
            if (!d) return;
            const local = toLocal(e);
            if (d.kind === 'marquee') {
              d.last = local;
              preview(shapePath(d.start, local));
              return;
            }
            if (Math.hypot(local.x - d.last.x, local.y - d.last.y) < 2) return;
            d.last = local;
            d.points.push(toDoc(local));
            d.trail += `L${local.x} ${local.y}`;
            preview(d.trail);
          }}
          onPointerUp={finish}
          onPointerCancel={() => {
            drag.current = null;
            preview('');
          }}
        >
          <svg className="pointer-events-none absolute inset-0 h-full w-full" data-testid="selection-preview">
            <path ref={darkRef} fill="none" stroke="rgba(0,0,0,0.85)" strokeWidth={1} />
            <path ref={lightRef} fill="none" stroke="#ffffff" strokeWidth={1} strokeDasharray="4 4" />
          </svg>
        </div>
      )}
    </>
  );
}
