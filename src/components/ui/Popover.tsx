import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useUiStore } from '../../stores/uiStore';

/** Space kept between a popover and the edge of the window. */
const MARGIN = 8;
/** Space between a popover and the control it belongs to. */
const GAP = 4;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * An element's box in real window pixels. Browsers that predate the standard `zoom` report boxes
 * inside a zoomed panel in that panel's own units, so those are scaled back up.
 */
export function windowBox(el: Element, scale: number): Box {
  const r = el.getBoundingClientRect();
  const k = 'currentCSSZoom' in el ? 1 : scale;
  return { left: r.left * k, top: r.top * k, right: r.right * k, bottom: r.bottom * k };
}

/** True once the control has been scrolled out of the panel that holds it. */
function scrolledAway(anchor: HTMLElement, box: Box, scale: number) {
  for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const clip = windowBox(el, scale);
    if (box.bottom <= clip.top || box.top >= clip.bottom || box.right <= clip.left || box.left >= clip.right) return true;
  }
  return false;
}

/**
 * A floating panel that belongs to a control: colour tools, font list, top bar menus.
 *
 * It is drawn above the whole page instead of inside the panel that holds the control, so a
 * scrolling panel or a narrow column can never cut it off. It opens below the control, or above
 * it, or beside it: the first of those where all of it can be seen. It is nudged sideways to stay
 * inside the window, and scrolls inside itself only when the window is too small for all of it.
 *
 * Closes on a click outside it, on Escape (which then does not reach the editor's shortcuts), and
 * when its control is scrolled out of view.
 */
export function Popover({
  anchor,
  onClose,
  align = 'end',
  className = '',
  testId,
  children,
}: {
  /** The control the popover belongs to. Clicks inside it do not close the popover. */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Which edge of the control to line up with, or `stretch` to take the control's width. */
  align?: 'start' | 'end' | 'stretch';
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const scale = useUiStore((s) => s.uiScale);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ left: 0, top: 0 });
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const position = () => {
      const el = ref.current;
      const target = anchor.current;
      if (!el || !target) return;
      const a = windowBox(target, scale);
      if (scrolledAway(target, a, scale)) return close.current();

      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const inner = el.firstElementChild as HTMLElement;
      // The outer element is not scaled, so its size is already in window pixels.
      const width = align === 'stretch' ? a.right - a.left : el.getBoundingClientRect().width;
      // Its full height, even while it is being held shorter than that.
      const height = (inner.scrollHeight + inner.offsetHeight - inner.clientHeight) * scale;
      const below = vh - a.bottom - GAP - MARGIN;
      const above = a.top - GAP - MARGIN;
      const window_ = vh - 2 * MARGIN;
      const leftSide = a.left - GAP - MARGIN >= width;
      const rightSide = vw - a.right - GAP - MARGIN >= width;
      const left = Math.round(Math.max(MARGIN, Math.min(align === 'end' ? a.right - width : a.left, vw - MARGIN - width)));
      const under: CSSProperties = { left, top: Math.round(a.bottom + GAP) };
      const over: CSSProperties = { left, bottom: Math.round(vh - a.top + GAP) };

      let next: CSSProperties;
      let room: number;
      if (height <= below + 0.5) [next, room] = [under, below];
      else if (height <= above + 0.5) [next, room] = [over, above];
      else if (height <= window_ + 0.5 && (leftSide || rightSide)) {
        // Too tall for either: beside the control, where all of it can be seen at once.
        const top = Math.round(Math.max(MARGIN, Math.min(a.top, vh - MARGIN - height)));
        [next, room] = [{ left: Math.round(leftSide ? a.left - GAP - width : a.right + GAP), top }, window_];
      } else if (above > below) [next, room] = [over, above];
      else [next, room] = [under, below];

      next.width = align === 'stretch' ? width : 'max-content';
      setPlace((prev) => (prev.left === next.left && prev.top === next.top && prev.bottom === next.bottom && prev.width === next.width ? prev : next));
      setMaxHeight(Math.max(80, Math.ceil(room)));
    };

    position();
    const onScroll = (e: Event) => !(e.target instanceof Node && ref.current?.contains(e.target)) && position();
    const observer = new ResizeObserver(position);
    if (ref.current) observer.observe(ref.current);
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, align, scale]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor]);

  return createPortal(
    <div ref={ref} className="fixed z-[55]" style={place}>
      <div
        data-testid={testId}
        className={`overflow-y-auto rounded-md border border-line bg-panel shadow-xl shadow-black/50 ${className}`}
        style={{ zoom: scale, maxHeight: maxHeight === undefined ? undefined : maxHeight / scale }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
