import { Circle, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { layerToDocument } from '../../features/document/operations';
import { CORNER_POINTS, EDGE_CURVES, HANDLE_LINES, HANDLE_POINTS, identityMesh, moveHandle } from '../../features/text-warp/warp';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { TextLayer } from '../../types/document';
import { applyMat, invert, multiply, type Mat } from '../../utils/geometry';

const ACCENT = '#3ddc97';

/**
 * Drag points for a custom text warp: the four corners of the envelope and the two tangent
 * handles on each side of every corner. Drawn in screen space so they stay the same size at any zoom.
 */
export function WarpHandles({ layer }: { layer: TextLayer }) {
  const layers = useEditorStore((s) => s.doc.layers);
  const zoom = useUiStore((s) => s.zoom);
  const pan = useUiStore((s) => s.pan);
  const toDoc = layerToDocument(layers, layer.id);
  if (!toDoc || !layer.warp) return null;

  const mesh = layer.warp.mesh?.length === 32 ? layer.warp.mesh : identityMesh();
  // Text box pixels -> screen pixels, and back for drags.
  const toScreen: Mat = multiply([zoom, 0, 0, zoom, pan.x, pan.y], toDoc);
  const toBox = invert(toScreen);
  const at = (point: number) => applyMat(toScreen, mesh[point * 2] * layer.width, mesh[point * 2 + 1] * layer.height);

  const onDrag = (point: number) => (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    const current = useEditorStore.getState();
    const box = applyMat(toBox, e.target.x(), e.target.y());
    const dx = box.x / layer.width - mesh[point * 2];
    const dy = box.y / layer.height - mesh[point * 2 + 1];
    if (!dx && !dy) return;
    current.updateLayers(
      [layer.id],
      (l) => (l.type === 'text' && l.warp ? { warp: { ...l.warp, mesh: moveHandle(mesh, point, dx, dy) } } : {}),
      { coalesce: `warp-point-${point}` },
    );
  };

  return (
    <Group name="warp-handles">
      {EDGE_CURVES.map((curve, i) => (
        <Line
          key={`edge-${i}`}
          listening={false}
          bezier
          points={curve.flatMap((p) => [at(p).x, at(p).y])}
          stroke={ACCENT}
          strokeWidth={1}
          dash={[5, 4]}
        />
      ))}
      {HANDLE_LINES.map(([corner, handle]) => (
        <Line
          key={`tangent-${corner}-${handle}`}
          listening={false}
          points={[at(corner).x, at(corner).y, at(handle).x, at(handle).y]}
          stroke="#6ea8ff"
          strokeWidth={1}
        />
      ))}
      {HANDLE_POINTS.map((point) => {
        const p = at(point);
        const shared = {
          name: `warp-handle warp-handle-${point}`,
          x: p.x,
          y: p.y,
          draggable: true,
          stroke: '#1d1e22',
          strokeWidth: 1,
          onDragMove: onDrag(point),
          onDragEnd: onDrag(point),
          onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = 'move';
          },
          onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
            const stage = e.target.getStage();
            if (stage) stage.container().style.cursor = '';
          },
        };
        return CORNER_POINTS.includes(point) ? (
          <Rect key={point} {...shared} width={11} height={11} offsetX={5.5} offsetY={5.5} cornerRadius={2} fill="#ffffff" hitStrokeWidth={10} />
        ) : (
          <Circle key={point} {...shared} radius={5} fill="#6ea8ff" hitStrokeWidth={12} />
        );
      })}
    </Group>
  );
}
