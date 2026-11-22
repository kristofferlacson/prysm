import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { beginStroke, cancelStroke, endStroke, extendStroke, isPainting } from '../../features/paint/paintController';
import { useToolStore } from '../../stores/toolStore';
import { isPaintTool, useUiStore } from '../../stores/uiStore';
import type { Point } from '../../utils/geometry';

/**
 * Captures pointer input for the brush and eraser and shows the brush outline.
 * It sits above the Konva stage only while a paint tool is active, so the move tool is unaffected.
 */
export function PaintOverlay({ onPan }: { onPan: (evt: MouseEvent) => void }) {
  const { tool, spaceHeld, zoom } = useUiStore(useShallow((s) => ({ tool: s.tool, spaceHeld: s.spaceHeld, zoom: s.zoom })));
  const size = useToolStore((s) => (tool === 'eraser' ? s.eraser.size : s.brush.size));
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const active = isPaintTool(tool);

  // Leaving the tool mid-stroke (shortcut, panel click) must not leave a stroke hanging.
  useEffect(() => {
    if (!active && isPainting()) endStroke();
  }, [active]);
  useEffect(() => () => cancelStroke(), []);

  if (!active) return null;
  const diameter = Math.max(3, size * zoom);

  const toDoc = (clientX: number, clientY: number): Point => {
    const rect = rootRef.current!.getBoundingClientRect();
    const { pan, zoom: z } = useUiStore.getState();
    return { x: (clientX - rect.left - pan.x) / z, y: (clientY - rect.top - pan.y) / z };
  };

  const moveCursor = (clientX: number, clientY: number) => {
    const el = cursorRef.current;
    if (!el) return;
    const rect = rootRef.current!.getBoundingClientRect();
    el.style.transform = `translate(${clientX - rect.left}px, ${clientY - rect.top}px)`;
    el.style.opacity = '1';
  };

  const pressureOf = (e: PointerEvent | React.PointerEvent) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1);

  return (
    <div
      ref={rootRef}
      data-testid="paint-overlay"
      className="absolute inset-0 z-10 touch-none"
      style={{ pointerEvents: spaceHeld ? 'none' : 'auto', cursor: diameter > 10 ? 'none' : 'crosshair' }}
      onPointerDown={(e) => {
        if (e.button === 1) {
          onPan(e.nativeEvent);
          return;
        }
        if (e.button !== 0) return;
        e.preventDefault();
        moveCursor(e.clientX, e.clientY);
        if (beginStroke(tool as 'brush' | 'eraser', toDoc(e.clientX, e.clientY), pressureOf(e), e.altKey)) {
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        moveCursor(e.clientX, e.clientY);
        if (!isPainting()) return;
        const native = e.nativeEvent;
        const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
        const events = samples.length ? samples : [native];
        extendStroke(
          events.map((ev) => toDoc(ev.clientX, ev.clientY)),
          pressureOf(e),
        );
      }}
      onPointerUp={() => endStroke()}
      onPointerCancel={() => endStroke()}
      onPointerLeave={() => {
        if (cursorRef.current) cursorRef.current.style.opacity = '0';
      }}
    >
      <div
        ref={cursorRef}
        data-testid="brush-cursor"
        className="pointer-events-none absolute left-0 top-0 opacity-0"
        style={{ width: 0, height: 0 }}
      >
        <div
          className="absolute rounded-full border border-white"
          style={{
            width: diameter,
            height: diameter,
            left: -diameter / 2,
            top: -diameter / 2,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(0,0,0,0.7)',
          }}
        />
      </div>
    </div>
  );
}
