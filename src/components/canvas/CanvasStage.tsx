import { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer as KLayer, Line, Rect, Shape, Stage, Transformer } from 'react-konva';
import Konva from 'konva';
import { useShallow } from 'zustand/react/shallow';
import { findLayers } from '../../features/document/operations';
import { insertImageFiles, insertLibraryItem, LIBRARY_MIME, type LibraryItem } from '../../features/library/insert';
import { useEditorStore } from '../../stores/editorStore';
import { isPaintTool, useUiStore } from '../../stores/uiStore';
import { rectsIntersect, type Point, type Rect as Box } from '../../utils/geometry';
import { CanvasHud } from './CanvasHud';
import { commitNodeTransforms } from './interaction';
import { fillProps } from './konvaProps';
import { LayerNode } from './LayerNode';
import { PaintOverlay } from './PaintOverlay';
import { stageRefs } from './stageRegistry';
import { TextEditorOverlay } from './TextEditorOverlay';

const ACCENT = '#3ddc97';
const TEXT_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right'];

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
          {doc.layers.map((layer) => (
            <LayerNode key={layer.id} layer={layer} topLevel />
          ))}
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
  const { zoom, pan, guides, showGrid, viewport, editingTextId, painting } = useUiStore(
    useShallow((s) => ({
      painting: isPaintTool(s.tool),
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
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  });

  const single = selected.length === 1 ? selected[0] : null;
  const step = gridStep(zoom);

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
      <Transformer
        ref={trRef}
        rotateEnabled={!painting}
        resizeEnabled={!painting}
        flipEnabled={false}
        ignoreStroke
        keepRatio={single?.type !== 'shape'}
        enabledAnchors={single?.type === 'text' ? TEXT_ANCHORS : undefined}
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
    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      const ui = useUiStore.getState();
      if (evt.ctrlKey || evt.metaKey) {
        const rect = host.getBoundingClientRect();
        ui.zoomAt(ui.zoom * Math.exp(-evt.deltaY * 0.0022), { x: evt.clientX - rect.left, y: evt.clientY - rect.top });
      } else {
        const dx = evt.shiftKey ? evt.deltaY : evt.deltaX;
        const dy = evt.shiftKey ? 0 : evt.deltaY;
        ui.set({ pan: { x: ui.pan.x - dx, y: ui.pan.y - dy } });
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
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
    if (target.hasName('layer') && target.getClassName() === 'Text') {
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
      <PaintOverlay onPan={startPan} />
      <CanvasHud />
    </div>
  );
}
