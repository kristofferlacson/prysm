import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Brush, LoaderCircle, Maximize, MousePointerClick, Redo2, RotateCcw, Undo2, WandSparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import {
  applyRemoval,
  beginStroke,
  BRUSH_MAX,
  BRUSH_MIN,
  brushWidth,
  clearHover,
  closeRemovalDialog,
  currentSession,
  endStroke,
  extendStroke,
  hoverObject,
  pickObject,
  redoRemoval,
  removedShare,
  resetRemoval,
  setObjectDetail,
  setWholePicture,
  stageProbe,
  suggestAgain,
  undoRemoval,
  useRemovalDialog,
  type ObjectDetail,
  type Outcome,
  type RemovalTool,
  type RemovalView,
  type SelectMode,
} from '../../features/background-removal/removalSession';
import { useBackgroundRemoval } from '../../features/background-removal/removeBackground';
import { askConfirm, useUiStore } from '../../stores/uiStore';
import { clamp } from '../../utils/geometry';
import { isEditableTarget } from '../../utils/misc';
import { IconButton, Row, Segmented, SliderRow, TextButton } from '../ui/controls';
import { windowBox } from '../ui/Popover';
import { Modal } from './Modal';

/** The selection: its tint, its outline, and the points that were clicked to make it. */
const SELECT_FILL = '#3ddc97';
const SELECT_EDGE = '#b6ffdc';
const ADD_POINT = '#17b26a';
/** Taking away from the selection. */
const SUBTRACT = '#ff5252';
const MAX_ZOOM = 12;

interface Point {
  x: number;
  y: number;
}

/** Where the picture is drawn on the stage canvas, in that canvas's pixels. */
function place(canvas: HTMLCanvasElement, picture: { width: number; height: number }, view: { zoom: number; cx: number; cy: number }) {
  const fit = Math.min(canvas.width / picture.width, canvas.height / picture.height) * 0.94;
  const w = picture.width * fit * view.zoom;
  const h = picture.height * fit * view.zoom;
  return { x: canvas.width / 2 - view.cx * w, y: canvas.height / 2 - view.cy * h, w, h };
}

let checker: HTMLCanvasElement | null = null;
/** The grey and white squares that stand for "nothing here". */
function checkerTile() {
  if (checker) return checker;
  checker = document.createElement('canvas');
  checker.width = checker.height = 20;
  const ctx = checker.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 20, 20);
  ctx.fillStyle = '#d5d6da';
  ctx.fillRect(0, 0, 10, 10);
  ctx.fillRect(10, 10, 10, 10);
  return checker;
}

/** Shift adds and Alt takes away for as long as it is held, whatever the mode is set to. */
const held = (e: { shiftKey: boolean; altKey: boolean }): SelectMode | undefined => (e.altKey ? 'subtract' : e.shiftKey ? 'add' : undefined);

/**
 * The picture, with the selection shown on it in green: tinted, outlined, and with a point
 * wherever it was clicked. Clicking and painting happen here; the wheel zooms, and Space or the
 * middle button drags the view.
 */
function Stage() {
  const scale = useUiStore((s) => s.uiScale);
  const { revision, view, tool, mode, outcome, brushSize, busy, detecting, objectsReady } = useRemovalDialog(
    useShallow((s) => ({
      revision: s.revision,
      view: s.view,
      tool: s.tool,
      mode: s.mode,
      outcome: s.outcome,
      brushSize: s.brushSize,
      busy: s.busy,
      detecting: s.detecting,
      objectsReady: s.objects.state === 'ready',
    })),
  );
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<HTMLCanvasElement[]>([]);
  const camera = useRef({ zoom: 1, cx: 0.5, cy: 0.5 });
  const pointer = useRef<Point | null>(null);
  const drag = useRef<{ kind: 'pan' | 'stroke'; x: number; y: number } | null>(null);
  /** Shift or Alt, while held. */
  const override = useRef<SelectMode | undefined>(undefined);
  const frame = useRef(0);
  const [space, setSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const [zoom, setZoom] = useState(1);

  /** A pointer position in the canvas's own pixels. */
  const at = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const canvas = canvasRef.current!;
      const box = windowBox(canvas, scale);
      return {
        x: ((e.clientX - box.left) / Math.max(1, box.right - box.left)) * canvas.width,
        y: ((e.clientY - box.top) / Math.max(1, box.bottom - box.top)) * canvas.height,
      };
    },
    [scale],
  );

  /** The same position as fractions of the picture's width and height. */
  const fraction = (p: Point) => {
    const s = currentSession();
    const canvas = canvasRef.current;
    if (!s || !canvas) return null;
    const r = place(canvas, s, camera.current);
    return { fx: (p.x - r.x) / r.w, fy: (p.y - r.y) / r.h };
  };
  const inside = (f: { fx: number; fy: number }) => f.fx >= 0 && f.fx <= 1 && f.fy >= 0 && f.fy <= 1;
  /** What a click or a stroke would do right now. */
  const effective = (): SelectMode => override.current ?? useRemovalDialog.getState().mode;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = currentSession();
    if (!s) return;
    const st = useRemovalDialog.getState();
    const r = place(canvas, s, camera.current);
    const dpr = window.devicePixelRatio || 1;
    /** A cleared working canvas the size of the stage. */
    const layer = (index: number) => {
      const c = (scratch.current[index] ??= document.createElement('canvas'));
      if (c.width !== canvas.width || c.height !== canvas.height) {
        c.width = canvas.width;
        c.height = canvas.height;
      }
      const lctx = c.getContext('2d')!;
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, c.width, c.height);
      lctx.imageSmoothingQuality = 'high';
      return lctx;
    };
    /**
     * A shape (opaque = inside) drawn over the picture as a tint with an outline around it.
     * Uses both working canvases.
     */
    const outlined = (shape: CanvasImageSource, fill: string, edge: string, opacity: number) => {
      const tint = layer(0);
      tint.fillStyle = fill;
      tint.fillRect(r.x, r.y, r.w, r.h);
      tint.globalCompositeOperation = 'destination-in';
      tint.drawImage(shape, r.x, r.y, r.w, r.h);
      // The outline: the shape nudged in every direction, minus the shape itself.
      const rim = layer(1);
      const o = Math.max(2, Math.round(1.5 * dpr));
      for (const [dx, dy] of [[o, 0], [-o, 0], [0, o], [0, -o], [o, o], [-o, o], [o, -o], [-o, -o]]) rim.drawImage(scratch.current[0], dx, dy);
      rim.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 3; i++) rim.drawImage(scratch.current[0], 0, 0);
      rim.globalCompositeOperation = 'source-in';
      rim.fillStyle = edge;
      rim.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = opacity;
      ctx.drawImage(scratch.current[0], 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(scratch.current[1], 0, 0);
    };
    ctx.imageSmoothingQuality = 'high';

    // Transparency shows as a checkerboard, as it does on the canvas.
    ctx.fillStyle = ctx.createPattern(checkerTile(), 'repeat')!;
    ctx.fillRect(r.x, r.y, r.w, r.h);

    if (st.view === 'result') {
      // What applying would leave: the selection, or everything but it.
      const cut = layer(0);
      cut.drawImage(s.source, r.x, r.y, r.w, r.h);
      cut.globalCompositeOperation = st.outcome === 'keep' ? 'destination-in' : 'destination-out';
      cut.drawImage(s.selection, r.x, r.y, r.w, r.h);
      ctx.drawImage(scratch.current[0], 0, 0);
    } else {
      ctx.drawImage(s.source, r.x, r.y, r.w, r.h);
      if (st.view === 'selection') outlined(s.selection, SELECT_FILL, SELECT_EDGE, 0.42);
    }

    // The thing under the pointer, before it is clicked: what would be added, or taken away.
    const hover = s.hover;
    if (hover?.shape && st.tool === 'pick' && !st.busy && !st.detecting) {
      if (hover.mode === 'add') outlined(hover.shape, SELECT_FILL, '#ffffff', 0.22);
      else outlined(hover.shape, SUBTRACT, SUBTRACT, 0.38);
    }

    // A point wherever the picture was clicked.
    if (st.view === 'selection') {
      const radius = 5.5 * dpr;
      for (const point of s.points) {
        const x = r.x + point.fx * r.w;
        const y = r.y + point.fy * r.h;
        ctx.beginPath();
        ctx.arc(x, y, radius + 1.5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = point.mode === 'add' ? ADD_POINT : SUBTRACT;
        ctx.fill();
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
    }

    // The brush, at its true size.
    const p = pointer.current;
    if (p && st.tool === 'brush' && drag.current?.kind !== 'pan' && !st.detecting) {
      const radius = (brushWidth(st.brushSize, s.width, s.height) * (r.w / s.width)) / 2;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = (override.current ?? st.mode) === 'add' ? SELECT_FILL : SUBTRACT;
      ctx.stroke();
    }
  }, []);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // Whatever changes what is shown: the selection, the view, the tool, the brush.
  useEffect(schedule, [schedule, revision, view, tool, mode, outcome, brushSize, busy, detecting]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The canvas has as many pixels as the screen shows it with.
  useEffect(() => {
    const host = hostRef.current!;
    const canvas = canvasRef.current!;
    const resize = () => {
      const box = windowBox(host, scale);
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round((box.right - box.left) * dpr));
      const h = Math.max(1, Math.round((box.bottom - box.top) * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, [draw, scale]);

  const zoomAt = useCallback(
    (to: number, anchor?: Point) => {
      const s = currentSession();
      const canvas = canvasRef.current;
      if (!s || !canvas) return;
      const v = camera.current;
      const p = anchor ?? { x: canvas.width / 2, y: canvas.height / 2 };
      const before = place(canvas, s, v);
      const fx = (p.x - before.x) / before.w;
      const fy = (p.y - before.y) / before.h;
      v.zoom = clamp(to, 1, MAX_ZOOM);
      const after = place(canvas, s, v);
      // The point under the pointer stays under the pointer.
      v.cx = v.zoom === 1 ? 0.5 : clamp(fx - (p.x - canvas.width / 2) / after.w, 0, 1);
      v.cy = v.zoom === 1 ? 0.5 : clamp(fy - (p.y - canvas.height / 2) / after.h, 0, 1);
      setZoom(v.zoom);
      schedule();
    },
    [schedule],
  );

  // The wheel zooms. (React's own wheel handler cannot stop the page from scrolling.)
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(camera.current.zoom * Math.exp(-e.deltaY * 0.0015), at(e));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [at, zoomAt]);

  // Where the picture is on the screen, for the end-to-end tests and the guide's recordings.
  useEffect(() => {
    stageProbe.current = () => {
      const s = currentSession();
      const canvas = canvasRef.current;
      if (!s || !canvas) return null;
      const box = windowBox(canvas, scale);
      const k = (box.right - box.left) / canvas.width;
      const r = place(canvas, s, camera.current);
      return { x: box.left + r.x * k, y: box.top + r.y * k, width: r.w * k, height: r.h * k };
    };
    return () => {
      stageProbe.current = null;
    };
  }, [scale]);

  /** Works out again what is under the pointer (the mode, or Shift or Alt, has changed). */
  const rehover = useCallback(() => {
    const p = pointer.current;
    const f = p && fraction(p);
    if (f && inside(f) && !drag.current) hoverObject({ ...f, mode: effective() });
    schedule();
    // `fraction` and `effective` read only refs and the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);
  useEffect(rehover, [rehover, mode]);

  // Keys: undo and redo, brush size, Space to drag the view, Shift to add and Alt to take away.
  useEffect(() => {
    const modifiers = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' && e.key !== 'Alt') return;
      override.current = held(e);
      rehover();
    };
    const onDown = (e: KeyboardEvent) => {
      if (useUiStore.getState().confirm || isEditableTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoRemoval();
        else undoRemoval();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redoRemoval();
      } else if (!mod && key === ' ') {
        e.preventDefault();
        setSpace(true);
      } else if (!mod && (key === '[' || key === ']')) {
        const st = useRemovalDialog.getState();
        st.set({ brushSize: clamp(Math.round(key === ']' ? st.brushSize * 1.2 + 1 : st.brushSize / 1.2 - 1), BRUSH_MIN, BRUSH_MAX) });
      } else if (e.key === 'Alt') {
        // Alt on its own would move the keyboard to the browser's menu.
        e.preventDefault();
      }
      modifiers(e);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpace(false);
      if (e.key === 'Alt') e.preventDefault();
      modifiers(e);
    };
    const onBlur = () => {
      setSpace(false);
      override.current = undefined;
    };
    document.addEventListener('keydown', onDown);
    document.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onDown);
      document.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [rehover]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    pointer.current = p;
    override.current = held(e);
    if (e.button === 1 || (e.button === 0 && space)) {
      e.preventDefault();
      drag.current = { kind: 'pan', ...p };
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
      hoverObject(null);
      return;
    }
    if (e.button !== 0) return;
    const f = fraction(p);
    if (!f) return;
    if (tool === 'pick') {
      if (inside(f)) void pickObject(f.fx, f.fy, override.current);
    } else if (beginStroke(f.fx, f.fy, override.current)) {
      drag.current = { kind: 'stroke', ...p };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = at(e);
    const grabbed = drag.current;
    if (grabbed?.kind === 'pan') {
      const s = currentSession();
      const canvas = canvasRef.current;
      if (s && canvas) {
        const r = place(canvas, s, camera.current);
        camera.current.cx = clamp(camera.current.cx - (p.x - grabbed.x) / r.w, 0, 1);
        camera.current.cy = clamp(camera.current.cy - (p.y - grabbed.y) / r.h, 0, 1);
      }
      grabbed.x = p.x;
      grabbed.y = p.y;
      pointer.current = p;
      schedule();
      return;
    }
    pointer.current = p;
    const f = fraction(p);
    if (grabbed?.kind === 'stroke') {
      // Every position the pointer passed through since the last event, for a smooth line.
      const passed = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const step of passed.length ? passed : [e.nativeEvent]) {
        const g = fraction(at(step));
        if (g) extendStroke(g.fx, g.fy);
      }
      return;
    }
    override.current = held(e);
    if (tool === 'pick') hoverObject(f && inside(f) ? { ...f, mode: effective() } : null);
    else schedule();
  };

  const release = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const grabbed = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (grabbed?.kind === 'stroke') endStroke();
    if (grabbed?.kind === 'pan') setPanning(false);
    schedule();
  };

  const onPointerLeave = () => {
    if (drag.current) return;
    pointer.current = null;
    hoverObject(null);
    schedule();
  };

  const cursor = panning ? 'grabbing' : space ? 'grab' : busy ? 'progress' : tool === 'pick' ? (objectsReady && !detecting ? 'pointer' : 'default') : 'none';
  const hover = currentSession()?.hover;
  const hint = tool !== 'pick' || detecting || busy || !hover?.shape ? null : { mode: hover.mode, text: hover.mode === 'add' ? 'Click to select this' : 'Click to take this out of the selection' };

  return (
    <div ref={hostRef} className="relative min-w-0 flex-1 overflow-hidden bg-bg">
      <canvas
        ref={canvasRef}
        data-testid="removal-stage"
        aria-label="The picture. Click a thing in it to select that thing."
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={onPointerLeave}
        // The middle button drags the view; without this the browser would start its own scrolling.
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      />
      <div className="absolute left-2 top-2 w-[236px] rounded-md bg-panel/90 shadow-lg shadow-black/40" data-testid="removal-view">
        <Segmented<RemovalView>
          value={view}
          options={[
            { value: 'selection', label: 'Selection' },
            { value: 'result', label: 'Result' },
            { value: 'original', label: 'Original' },
          ]}
          onChange={(v) => useRemovalDialog.getState().set({ view: v })}
        />
      </div>
      <div className="absolute right-2 top-2 flex items-center rounded-md bg-panel/90 shadow-lg shadow-black/40">
        <IconButton label="Zoom out" disabled={zoom <= 1} onClick={() => zoomAt(camera.current.zoom / 1.5)}>
          <ZoomOut size={14} />
        </IconButton>
        <span className="w-10 text-center tabular-nums text-dim" data-testid="removal-zoom">
          {Math.round(zoom * 100)}%
        </span>
        <IconButton label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomAt(camera.current.zoom * 1.5)}>
          <ZoomIn size={14} />
        </IconButton>
        <IconButton label="Fit the picture" disabled={zoom <= 1} onClick={() => zoomAt(1)}>
          <Maximize size={14} />
        </IconButton>
      </div>
      {view === 'selection' && (
        <div
          data-testid="removal-legend"
          className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-panel/90 px-2.5 py-1 text-dim shadow-lg shadow-black/40"
        >
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SELECT_FILL }} /> Green is selected, and will be {outcome === 'keep' ? 'kept' : 'removed'}
        </div>
      )}
      {hint && (
        <div
          data-testid="removal-hint"
          data-mode={hint.mode}
          className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-panel/95 px-3 py-1 font-medium shadow-lg shadow-black/40"
          style={{ color: hint.mode === 'add' ? SELECT_FILL : SUBTRACT }}
        >
          {hint.text}
        </div>
      )}
    </div>
  );
}

function ToolButton({ id, active, disabled, icon, label, hint }: { id: RemovalTool; active: boolean; disabled?: boolean; icon: ReactNode; label: string; hint: string }) {
  return (
    <button
      type="button"
      data-removal-tool={id}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => {
        useRemovalDialog.getState().set({ tool: id });
        hoverObject(null);
      }}
      className={`flex w-full items-start gap-2 rounded-md border p-2 text-left transition-colors disabled:opacity-40 ${
        active ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover disabled:hover:bg-transparent'
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${active ? 'text-accent' : 'text-dim'}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium text-ink">{label}</span>
        <span className="block leading-snug text-faint">{hint}</span>
      </span>
    </button>
  );
}

function Progress({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <div className="mt-1 h-1 overflow-hidden rounded bg-hover">
      <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

const HEADING = 'text-[11px] font-semibold uppercase tracking-wide text-dim';

/** How much room the picture can have, given the window (in the dialog's own units). */
function useStageHeight() {
  const scale = useUiStore((s) => s.uiScale);
  const measure = useCallback(() => clamp(Math.floor(window.innerHeight / scale) - 172, 240, 580), [scale]);
  const [height, setHeight] = useState(measure);
  useEffect(() => {
    const onResize = () => setHeight(measure());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);
  return height;
}

/**
 * Background removal with a say in it: click the things in the picture to select them (they turn
 * green, with a point where each click landed), then say whether the selection is what stays or
 * what goes. It opens with the automatic suggestion already selected.
 *
 * It shows itself while a session is open, so opening and closing it does not redraw the editor
 * behind it (which, with a picture being read at the same moment, would be a visible hitch).
 */
export function BackgroundRemovalDialog() {
  const open = useRemovalDialog((s) => s.layerId !== null);
  return open ? <RemovalDialog /> : null;
}

function RemovalDialog() {
  const { phase, error, notice, detecting, reedit, objects, busy, tool, mode, outcome, brushSize, detail, canUndo, canRedo, changed, selected, points, suggestions } = useRemovalDialog(
    useShallow((s) => ({
      phase: s.phase,
      error: s.error,
      notice: s.notice,
      detecting: s.detecting,
      reedit: s.reedit,
      objects: s.objects,
      busy: s.busy,
      tool: s.tool,
      mode: s.mode,
      outcome: s.outcome,
      brushSize: s.brushSize,
      detail: s.detail,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      changed: s.changed,
      selected: s.selected,
      points: s.points,
      suggestions: s.suggestions,
    })),
  );
  const job = useBackgroundRemoval((s) => s.job);
  const height = useStageHeight();

  const cancel = useCallback(async () => {
    const st = useRemovalDialog.getState();
    if (
      (st.changed || st.outcome === 'remove') &&
      !(await askConfirm({
        title: 'Discard your changes?',
        message: 'What you selected here will be lost. The image itself stays as it is.',
        confirmLabel: 'Discard',
        danger: true,
      }))
    ) {
      return;
    }
    closeRemovalDialog();
  }, []);

  // While the dialog is open the keyboard is its own: nothing typed here reaches the editor's
  // shortcuts (which listen on the window), and Escape cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape' && !isEditableTarget(e.target)) void cancel();
    };
    const onPaste = (e: ClipboardEvent) => e.stopPropagation();
    document.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, [cancel]);

  const ready = phase === 'ready';
  const idle = ready && !detecting && !busy;
  const nothing = selected < 0.0005;
  const everything = selected > 0.9995;
  const removed = removedShare(selected, outcome);
  const canApply = idle && !nothing && !everything && (!reedit || changed || outcome === 'remove');
  const working = phase === 'opening' || detecting;
  const state = phase === 'failed' ? 'failed' : working ? 'working' : 'ready';
  const percent = selected > 0 && selected < 0.01 ? 'less than 1%' : `${Math.round(selected * 100)}%`;
  const summary = nothing
    ? 'Nothing is selected yet. Click a thing in the picture to select it.'
    : everything
      ? 'The whole picture is selected. Take things away, or press Clear and start from nothing.'
      : outcome === 'keep'
        ? `The selection (${percent} of the picture) is kept; everything else is removed.`
        : `The selection (${percent} of the picture) is removed; everything else is kept.`;
  const pickOff = !ready || objects.state === 'unavailable' || objects.state === 'error';

  return (
    <Modal title="Remove background" onClose={() => void cancel()} width={980}>
      <div
        data-testid="removal-dialog"
        data-state={state}
        data-reedit={reedit}
        data-objects={objects.state}
        data-suggestions={suggestions}
        data-outcome={outcome}
        data-points={points}
        data-removed={removed.toFixed(4)}
      >
        <div className="flex" style={{ height }}>
          <div className="relative flex min-w-0 flex-1">
            {phase === 'failed' ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
                <p className="max-w-[420px] leading-relaxed text-danger" role="alert">
                  {error}
                </p>
                <TextButton onClick={closeRemovalDialog}>Close</TextButton>
              </div>
            ) : (
              <Stage />
            )}
            {working && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/70" role="status">
                <LoaderCircle size={22} className="animate-spin text-accent" />
                <div className="w-[300px] max-w-full px-4 text-center text-ink">
                  {job?.message ?? 'Preparing the image…'}
                  <Progress value={job?.progress ?? null} />
                </div>
              </div>
            )}
          </div>

          <aside className="w-[264px] shrink-0 space-y-3 overflow-y-auto border-l border-line p-3" data-testid="removal-tools">
            <div className="space-y-1.5">
              <ToolButton id="pick" active={tool === 'pick'} disabled={pickOff} icon={<MousePointerClick size={14} />} label="Click objects" hint="Click a thing to select all of it." />
              <ToolButton id="brush" active={tool === 'brush'} disabled={!ready} icon={<Brush size={14} />} label="Brush" hint="Paint the selection by hand." />
            </div>

            {ready && objects.state !== 'ready' && objects.message && (
              <div
                role="status"
                data-testid="removal-objects-status"
                className={`rounded border border-line p-2 leading-relaxed ${objects.state === 'loading' ? 'text-dim' : 'text-danger'}`}
              >
                {objects.state === 'loading' && <LoaderCircle size={11} className="mr-1.5 inline animate-spin" />}
                {objects.message}
                {objects.state === 'loading' && <span className="block text-faint">Clicking objects works once this is done.</span>}
                <Progress value={objects.progress} />
              </div>
            )}

            <div className="space-y-1.5">
              <Row label={tool === 'pick' ? 'A click will' : 'A stroke will'}>
                <div className="w-full" data-testid="removal-mode">
                  <Segmented<SelectMode>
                    value={mode}
                    options={[
                      { value: 'add', label: 'Add' },
                      { value: 'subtract', label: 'Take away' },
                    ]}
                    onChange={(v) => {
                      useRemovalDialog.getState().set({ mode: v });
                      clearHover();
                    }}
                  />
                </div>
              </Row>
              {tool === 'pick' ? (
                <Row label="It takes">
                  <Segmented<ObjectDetail>
                    value={detail}
                    options={[
                      { value: 'smaller', label: 'Less' },
                      { value: 'auto', label: 'Object' },
                      { value: 'larger', label: 'More' },
                    ]}
                    onChange={setObjectDetail}
                  />
                </Row>
              ) : (
                <SliderRow label="Brush size" value={brushSize} min={BRUSH_MIN} max={BRUSH_MAX} onChange={(v) => useRemovalDialog.getState().set({ brushSize: v })} />
              )}
              <p className="text-faint">Alt takes away and Shift adds, while held.</p>
            </div>

            <div className="space-y-1.5 border-t border-line pt-3">
              <div className={HEADING}>The selection is</div>
              <div data-testid="removal-outcome">
                <Segmented<Outcome>
                  value={outcome}
                  options={[
                    { value: 'keep', label: 'Kept' },
                    { value: 'remove', label: 'Removed' },
                  ]}
                  onChange={(v) => useRemovalDialog.getState().set({ outcome: v })}
                />
              </div>
            </div>

            <div className="space-y-1.5 border-t border-line pt-3">
              <div className={HEADING}>Whole picture</div>
              <div className="grid grid-cols-2 gap-1.5">
                <TextButton disabled={!idle} onClick={suggestAgain}>
                  <WandSparkles size={12} /> Automatic
                </TextButton>
                <TextButton disabled={!idle} onClick={() => setWholePicture('invert')}>
                  Invert
                </TextButton>
                <TextButton disabled={!idle || everything} onClick={() => setWholePicture('all')}>
                  Select all
                </TextButton>
                <TextButton disabled={!idle || nothing} onClick={() => setWholePicture('none')}>
                  Clear
                </TextButton>
              </div>
            </div>

            <div className="flex items-center gap-1.5 border-t border-line pt-3">
              <TextButton className="flex-1" disabled={!idle || !canUndo} onClick={undoRemoval}>
                <Undo2 size={12} /> Undo
              </TextButton>
              <TextButton className="flex-1" disabled={!idle || !canRedo} onClick={redoRemoval}>
                <Redo2 size={12} /> Redo
              </TextButton>
              <TextButton className="flex-1" disabled={!idle || !changed} onClick={resetRemoval}>
                <RotateCcw size={12} /> Reset
              </TextButton>
            </div>
          </aside>
        </div>

        <div className="flex items-center gap-3 border-t border-line p-3">
          <div role="status" data-testid="removal-status" className="min-w-0 flex-1 leading-snug">
            {ready && !detecting && (
              <>
                <div className={nothing || everything ? 'text-dim' : 'text-ink'} data-testid="removal-summary">
                  {summary}
                </div>
                {notice && (
                  <div className="text-dim" data-testid="removal-notice">
                    {notice}
                  </div>
                )}
              </>
            )}
          </div>
          <TextButton onClick={() => void cancel()}>Cancel</TextButton>
          <TextButton primary disabled={!canApply} onClick={applyRemoval}>
            {busy ? <LoaderCircle size={12} className="animate-spin" /> : null} Apply
          </TextButton>
        </div>
      </div>
    </Modal>
  );
}
