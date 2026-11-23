import { Circle, Group, Line, Rect } from 'react-konva';
import type Konva from 'konva';
import { layerToDocument } from '../../features/document/operations';
import { curvePoints, moveCurvePoint } from '../../features/text-warp/textPath';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { TextLayer } from '../../types/document';
import { applyMat, invert, multiply, type Mat } from '../../utils/geometry';

const ACCENT = '#3ddc97';

/**
 * Drag points for text on a curve: the two ends of the line (squares) and the two control points
 * that bend it (dots). Drawn in screen space so they stay the same size at any zoom.
 */
export function PathHandles({ layer }: { layer: TextLayer }) {
  const layers = useEditorStore((s) => s.doc.layers);
  const zoom = useUiStore((s) => s.zoom);
  const pan = useUiStore((s) => s.pan);
  const toDoc = layerToDocument(layers, layer.id);
  if (!toDoc || layer.path?.kind !== 'curve') return null;

  const points = curvePoints(layer.path);
  const toScreen: Mat = multiply([zoom, 0, 0, zoom, pan.x, pan.y], toDoc);
  const toBox = invert(toScreen);
  const at = (i: number) => applyMat(toScreen, points[i * 2] * layer.width, points[i * 2 + 1] * layer.height);

  const onDrag = (index: number) => (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    const box = applyMat(toBox, e.target.x(), e.target.y());
    const dx = box.x / layer.width - points[index * 2];
    const dy = box.y / layer.height - points[index * 2 + 1];
    if (!dx && !dy) return;
    useEditorStore.getState().updateLayers(
      [layer.id],
      (l) => (l.type === 'text' && l.path?.kind === 'curve' ? { path: { kind: 'curve', points: moveCurvePoint(points, index, dx, dy) } } : {}),
      { coalesce: `path-point-${index}` },
    );
  };

  const cursor = (value: string) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = value;
  };

  return (
    <Group name="path-handles">
      <Line listening={false} bezier points={[0, 1, 2, 3].flatMap((i) => [at(i).x, at(i).y])} stroke={ACCENT} strokeWidth={1} dash={[5, 4]} />
      {[
        [0, 1],
        [3, 2],
      ].map(([end, control]) => (
        <Line key={end} listening={false} points={[at(end).x, at(end).y, at(control).x, at(control).y]} stroke="#6ea8ff" strokeWidth={1} />
      ))}
      {[0, 1, 2, 3].map((i) => {
        const p = at(i);
        const shared = {
          name: `path-handle path-handle-${i}`,
          x: p.x,
          y: p.y,
          draggable: true,
          stroke: '#1d1e22',
          strokeWidth: 1,
          onDragMove: onDrag(i),
          onDragEnd: onDrag(i),
          onMouseEnter: cursor('move'),
          onMouseLeave: cursor(''),
        };
        return i === 0 || i === 3 ? (
          <Rect key={i} {...shared} width={11} height={11} offsetX={5.5} offsetY={5.5} cornerRadius={2} fill="#ffffff" hitStrokeWidth={10} />
        ) : (
          <Circle key={i} {...shared} radius={5} fill="#6ea8ff" hitStrokeWidth={12} />
        );
      })}
    </Group>
  );
}
