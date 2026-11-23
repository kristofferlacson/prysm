import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer as KLayer, Line, Rect, Shape, Stage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useShallow } from 'zustand/react/shallow';
import { findLayer, findLayers } from '../../features/document/operations';
import { needsPicture } from '../../features/text-warp/renderText';
import { insertImageFiles, insertLibraryItem, LIBRARY_MIME, type LibraryItem } from '../../features/library/insert';
import { useEditorStore } from '../../stores/editorStore';
import { isPaintTool, isSelectTool, SAFE_MARGIN, useUiStore } from '../../stores/uiStore';
import { rectsIntersect, type Point, type Rect as Box } from '../../utils/geometry';
import { CanvasHud } from './CanvasHud';
import { CropOverlay } from './CropOverlay';
import { commitNodeTransforms } from './interaction';
import { fillProps } from './konvaProps';
import { LayerList } from './LayerNode';
import { PaintOverlay } from './PaintOverlay';
import { PathHandles } from './PathHandles';
import { SelectionOverlay } from './SelectionOverlay';
import { stageRefs } from './stageRegistry';
import { TextEditorOverlay } from './TextEditorOverlay';
import { WarpHandles } from './WarpHandles';

const ACCENT = '#3ddc97';
const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const TEXT_ANCHORS = [...CORNER_ANCHORS, 'middle-left', 'middle-right'];

function makeChecker() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#d5d6da';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  return c;
}

/** Transparency checkerboard and drop shadow under the artboard. Lives on its own layer so it never reaches exports. */
function Backdrop() {
  const { width, height } = useEditorStore(useShallow((s) => ({ width: s.doc.width, height: s.doc.height })));
  const { zoom, pan } = useUiStore(useShallow((s) => ({ zoom: s.zoom, pan: s.pan })));
  const checker = useMemo(makeChecker, []);
  return (
    <KLayer listening={false}>
      <Group x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}>
        <Rect
          width={width}
          height={height}
          fillPatternImage={checker as unknown as HTMLImageElement}
          fillPatternScaleX={1 / zoom}
          fillPatternScaleY={1 / zoom}
          shadowColor="#000000"
          shadowBlur={28}
          shadowOpacity={0.55}
          shadowOffsetY={6}
        />
      </Group>
    </KLayer>
  );
}

/** The design itself: one Konva layer so every blend mode composites against the real pixels below it. */
function DocumentContent() {
  const doc = useEditorStore((s) => s.doc);
  const { zoom, pan, interactive } = useUiStore(
    useShallow((s) => ({ zoom: s.zoom, pan: s.pan, interactive: s.tool === 'move' && !s.spaceHeld })),
  );
  const background = useMemo(
    () => fillProps(doc.background, doc.width, doc.height),
    [doc.background, doc.width, doc.height],
  );
  return (
    <KLayer listening={interactive}>
      <Group
        ref={(node) => {
          stageRefs.viewport = node;
        }}
        x={pan.x}
        y={pan.y}
        scaleX={zoom}
        scaleY={zoom}
      >
        <Group
          ref={(node) => {
            stageRefs.artboard = node;
          }}
          clipX={0}
          clipY={0}
          clipWidth={doc.width}
          clipHeight={doc.height}
        >
          <Rect
            ref={(node) => {
              stageRefs.background = node;
            }}
            name="background"
            width={doc.width}
            height={doc.height}
            {...background}
          />
          <LayerList layers={doc.layers} topLevel />
        </Group>
      </Group>
    </KLayer>
  );
}

function gridStep(zoom: number) {
  return [5, 10, 20, 50, 100, 200, 500, 1000].find((s) => s * zoom >= 22) ?? 2000;
}

/** Selection handles, grid, snap guides and the marquee: drawn at screen scale above the design. */
function Overlay({ marquee }: { marquee: Box | null }) {
  const trRef = useRef<Konva.Transformer>(null);
  const layers = useEditorStore((s) => s.doc.layers);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const { width, height } = useEditorStore(useShallow((s) => ({ width: s.doc.width, height: s.doc.height })));
  const { zoom, pan, guides, spacingMarks, composition, showGrid, viewport, editingTextId, painting } = useUiStore(
    useShallow((s) => ({
      // Brush, eraser and the selection tools own the pointer: layer handles are shown but not active.
      painting: isPaintTool(s.tool) || isSelectTool(s.tool) || !!s.cropLayerId,
      spacingMarks: s.spacingMarks,
      composition: s.composition,
      zoom: s.zoom,
      pan: s.pan,
      guides: s.guides,
      showGrid: s.showGrid,
      viewport: s.viewport,
      editingTextId: s.editingTextId,
    })),
  );
  const selected = useMemo(() => findLayers(layers, selectedIds), [layers, selectedIds]);

  // Runs after every commit of the Konva tree, so the nodes it looks up always match the document.
  useEffect(() => {
    const tr = trRef.current;
    const stage = tr?.getStage();
    if (!tr || !stage) return;
    stageRefs.transformer = tr;
    const nodes = selected
      .filter((l) => !l.locked && l.visible && l.id !== editingTextId)
      .map((l) => stage.findOne(`#${l.id}`))
      .filter((n): n is Konva.Node => !!n);
    // Re-attaching is costly (listeners, caches). Only do it when the nodes really differ;
    // on pan, zoom and ordinary edits the frame just needs to follow them.
    const current = tr.nodes();
    if (current.length !== nodes.length || current.some((n, i) => n !== nodes[i])) tr.nodes(nodes);
    else tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  });

  const single = selected.length === 1 ? selected[0] : null;
  const step = gridStep(zoom);
  // Shaped or styled text scales as a whole; its wrap width is set in the properties panel.
  const anchors = single?.type !== 'text' ? undefined : needsPicture(single) ? CORNER_ANCHORS : TEXT_ANCHORS;
  const editableText =
    single?.type === 'text' && single.visible && !single.locked && !painting && single.id !== editingTextId ? single : null;
  const customWarp = editableText && !editableText.path && editableText.warp?.style === 'custom' ? editableText : null;
  const curvePath = editableText?.path?.kind === 'curve' ? editableText : null;

  return (
    <KLayer listening={!painting}>
      {showGrid && (
        <Shape
          listening={false}
          stroke="rgba(120,130,150,0.35)"
          strokeWidth={1}
          sceneFunc={(ctx, shape) => {
            ctx.beginPath();
            for (let x = step; x < width; x += step) {
              const sx = Math.round(pan.x + x * zoom) + 0.5;
              ctx.moveTo(sx, pan.y);
              ctx.lineTo(sx, pan.y + height * zoom);
            }
            for (let y = step; y < height; y += step) {
              const sy = Math.round(pan.y + y * zoom) + 0.5;
              ctx.moveTo(pan.x, sy);
              ctx.lineTo(pan.x + width * zoom, sy);
            }
            ctx.strokeShape(shape);
          }}
        />
      )}
      <Rect
        listening={false}
        x={pan.x}
        y={pan.y}
        width={width * zoom}
        height={height * zoom}
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1}
      />
      {(composition.thirds || composition.center || composition.margins) && (
        <Shape
          name="composition-guides"
          listening={false}
          sceneFunc={(ctx) => {
            const c = ctx._context;
            const X = (x: number) => Math.round(pan.x + x * zoom) + 0.5;
            const Y = (y: number) => Math.round(pan.y + y * zoom) + 0.5;
            const line = (x1: number, y1: number, x2: number, y2: number) => {
              c.moveTo(X(x1), Y(y1));
              c.lineTo(X(x2), Y(y2));
            };
            // Each line is drawn dark then light, so it shows on any artwork.
            const stroke = (color: string, dash: number[]) => {
              for (const [style, offset] of [['rgba(0,0,0,0.45)', 1], [color, 0]] as const) {
                c.save();
                c.translate(offset, offset);
                c.strokeStyle = style;
                c.lineWidth = 1;
                c.setLineDash(dash);
                c.stroke();
                c.restore();
              }
            };
            if (composition.thirds) {
              c.beginPath();
              for (const k of [1 / 3, 2 / 3]) {
                line(width * k, 0, width * k, height);
                line(0, height * k, width, height * k);
              }
              stroke('rgba(255,255,255,0.75)', []);
            }
            if (composition.center) {
              c.beginPath();
              line(width / 2, 0, width / 2, height);
              line(0, height / 2, width, height / 2);
              stroke('rgba(61,220,151,0.9)', [6, 5]);
            }
            if (composition.margins) {
              const m = Math.min(width, height) * SAFE_MARGIN;
              c.beginPath();
              c.rect(X(m), Y(m), Math.round((width - 2 * m) * zoom), Math.round((height - 2 * m) * zoom));
              stroke('rgba(110,168,255,0.95)', [3, 4]);
            }
          }}
        />
      )}
      {guides.map((g, i) =>
        g.orientation === 'v' ? (
          <Line
            key={i}
            listening={false}
            points={[pan.x + g.position * zoom, 0, pan.x + g.position * zoom, viewport.h]}
            stroke="#ff4d8d"
            strokeWidth={1}
          />
        ) : (
          <Line
            key={i}
            listening={false}
            points={[0, pan.y + g.position * zoom, viewport.w, pan.y + g.position * zoom]}
            stroke="#ff4d8d"
            strokeWidth={1}
          />
        ),
      )}
      {spacingMarks.map((m, i) => {
        const x1 = pan.x + m.x1 * zoom;
        const y1 = pan.y + m.y1 * zoom;
        const x2 = pan.x + m.x2 * zoom;
        const y2 = pan.y + m.y2 * zoom;
        const horizontal = Math.abs(y2 - y1) < 0.5;
        const tick = 5;
        // A measuring mark: the gap itself with a short stop at each end.
        const ends = horizontal ? [x1, y1 - tick, x1, y1 + tick, x1, y1, x2, y2, x2, y2 - tick, x2, y2 + tick] : [x1 - tick, y1, x1 + tick, y1, x1, y1, x2, y2, x2 - tick, y2, x2 + tick, y2];
        return <Line key={`gap-${i}`} name="spacing-mark" listening={false} points={ends} stroke="#ff4d8d" strokeWidth={1} />;
      })}
      <Transformer
        ref={trRef}
        rotateEnabled={!painting}
        resizeEnabled={!painting}
        flipEnabled={false}
        ignoreStroke
        keepRatio={single?.type !== 'shape' || single.shape === 'icon'}
        enabledAnchors={anchors}
        rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
        rotationSnapTolerance={4}
        anchorSize={9}
        anchorCornerRadius={2}
        anchorStroke={ACCENT}
        anchorFill="#ffffff"
        borderStroke={ACCENT}
        rotateAnchorOffset={26}
        boundBoxFunc={(oldBox, newBox) =>
          Math.abs(newBox.width) < 6 || Math.abs(newBox.height) < 6 ? oldBox : newBox
        }
        onTransformEnd={commitNodeTransforms}
      />
      {customWarp && <WarpHandles layer={customWarp} />}
      {curvePath && <PathHandles layer={curvePath} />}
      {marquee && (
        <Rect
          listening={false}
          x={marquee.x}
          y={marquee.y}
          width={marquee.width}
          height={marquee.height}
          fill="rgba(61,220,151,0.12)"
          stroke={ACCENT}
          strokeWidth={1}
        />
      )}
    </KLayer>
  );
}

export function CanvasStage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [panning, setPanning] = useState(false);
  const docId = useEditorStore((s) => s.doc.id);
  const docSize = useEditorStore((s) => `${s.doc.width}x${s.doc.height}`);
  const { viewport, handMode } = useUiStore(
    useShallow((s) => ({ viewport: s.viewport, handMode: s.tool === 'hand' || s.spaceHeld })),
  );
  const ready = viewport.w > 0 && viewport.h > 0;

  useEffect(() => {
    const host = hostRef.current!;
    const ro = new ResizeObserver(() => {
      useUiStore.getState().set({ viewport: { w: host.clientWidth, h: host.clientHeight } });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    stageRefs.stage = stageRef.current;
    return () => {
      stageRefs.stage = null;
    };
  });

  // Wheel pans, Ctrl+wheel zooms. Listening on the host (not the stage) keeps this working
  // while the paint overlay covers the stage, and a non-passive listener can stop page zoom.
  useEffect(() => {
    const host = hostRef.current!;
    // A trackpad or a free-spinning wheel sends several events per frame. They are added up and
    // applied once per frame, so the view is laid out and drawn once instead of once per event.
    let panX = 0;
    let panY = 0;
    let zoomFactor = 1;
    let anchor: Point | null = null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const ui = useUiStore.getState();
      if (zoomFactor !== 1) ui.zoomAt(ui.zoom * zoomFactor, anchor ?? undefined);
      if (panX || panY) {
        const { pan } = useUiStore.getState();
        ui.set({ pan: { x: pan.x - panX, y: pan.y - panY } });
      }
      panX = panY = 0;
      zoomFactor = 1;
    };
    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      if (evt.ctrlKey || evt.metaKey) {
        const rect = host.getBoundingClientRect();
        zoomFactor *= Math.exp(-evt.deltaY * 0.0022);
        anchor = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
      } else {
        panX += evt.shiftKey ? evt.deltaY : evt.deltaX;
        panY += evt.shiftKey ? 0 : evt.deltaY;
      }
      if (!frame) frame = requestAnimationFrame(apply);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Frame the artboard whenever a different project is opened or the canvas is resized.
  useEffect(() => {
    if (!ready) return;
    const { doc } = useEditorStore.getState();
    useUiStore.getState().fitToScreen(doc.width, doc.height);
  }, [docId, docSize, ready]);

  const localPoint = (clientX: number, clientY: number): Point => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startPan = (evt: MouseEvent) => {
    evt.preventDefault();
    const start = { x: evt.clientX, y: evt.clientY };
    const origin = useUiStore.getState().pan;
    setPanning(true);
    const move = (ev: MouseEvent) =>
      useUiStore.getState().set({ pan: { x: origin.x + ev.clientX - start.x, y: origin.y + ev.clientY - start.y } });
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setPanning(false);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startMarquee = (evt: MouseEvent, additive: boolean) => {
    const origin = localPoint(evt.clientX, evt.clientY);
    let box: Box = { ...origin, width: 0, height: 0 };
    const move = (ev: MouseEvent) => {
      const p = localPoint(ev.clientX, ev.clientY);
      box = {
        x: Math.min(origin.x, p.x),
        y: Math.min(origin.y, p.y),
        width: Math.abs(p.x - origin.x),
        height: Math.abs(p.y - origin.y),
      };
      setMarquee(box);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setMarquee(null);
      const stage = stageRef.current;
      if (!stage || (box.width < 3 && box.height < 3)) return;
      const editor = useEditorStore.getState();
      const hits = editor.doc.layers
        .filter((l) => l.visible && !l.locked)
        .filter((l) => {
          const node = stage.findOne(`#${l.id}`);
          return !!node && rectsIntersect(box, node.getClientRect({ skipShadow: true, skipStroke: true }));
        })
        .map((l) => l.id);
      editor.select(additive ? [...new Set([...editor.selectedIds, ...hits])] : hits);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = stageRef.current!;
    const evt = e.evt;
    const ui = useUiStore.getState();
    if (ui.tool === 'hand' || ui.spaceHeld || evt.button === 1) {
      startPan(evt);
      return;
    }
    if (evt.button !== 0) return;
    const target = e.target;
    if (target.getParent() instanceof Konva.Transformer) return;

    const editor = useEditorStore.getState();
    const additive = evt.shiftKey || evt.ctrlKey || evt.metaKey;
    if (target === stage || target.hasName('background')) {
      if (!additive) editor.clearSelection();
      startMarquee(evt, additive);
      return;
    }

    // Layers under the pointer, innermost first. Prefer one that is already selected (so a selected
    // child of a group stays in control); otherwise select the outermost, i.e. the whole group.
    const chain: string[] = [];
    for (let n: Konva.Node | null = target; n && n !== stage; n = n.getParent()) {
      if (n.hasName('layer')) chain.push(n.id());
    }
    if (!chain.length) return;
    const alreadySelected = chain.find((id) => editor.selectedIds.includes(id));
    const pick = alreadySelected ?? chain[chain.length - 1];
    if (additive) editor.toggleSelect(pick);
    else if (!alreadySelected) editor.select([pick]);
  };

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const target = e.target;
    if (target.hasName('layer') && findLayer(useEditorStore.getState().doc.layers, target.id())?.type === 'text') {
      useEditorStore.getState().select([target.id()]);
      useUiStore.getState().set({ editingTextId: target.id() });
    }
  };


  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const { zoom, pan } = useUiStore.getState();
    const p = localPoint(e.clientX, e.clientY);
    const at = { x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom };
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      void insertImageFiles(files, at);
      return;
    }
    const payload = e.dataTransfer.getData(LIBRARY_MIME);
    if (payload) insertLibraryItem(JSON.parse(payload) as LibraryItem, at);
  };

  return (
    <div
      ref={hostRef}
      data-testid="canvas-host"
      className="absolute inset-0 overflow-hidden bg-bg"
      style={{ cursor: panning ? 'grabbing' : handMode ? 'grab' : 'default' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {ready && (
        <Stage
          ref={stageRef}
          width={viewport.w}
          height={viewport.h}
          onMouseDown={onMouseDown}
          onDblClick={onDblClick}
        >
          <Backdrop />
          <DocumentContent />
          <Overlay marquee={marquee} />
        </Stage>
      )}
      <TextEditorOverlay />
      <SelectionOverlay onPan={startPan} />
      <CropOverlay onPan={startPan} />
      <PaintOverlay onPan={startPan} />
      <CanvasHud />
    </div>
  );
}
