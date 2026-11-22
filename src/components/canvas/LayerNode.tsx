import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Group, Image as KImage, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import { resizeFromTopLeft } from '../../features/document/operations';
import { useLayerImage } from '../../features/image-editing/useLayerImage';
import { ensureFont, fontStack } from '../../services/fonts';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { GroupLayer, ImageLayer, Layer, ShapeLayer, TextLayer } from '../../types/document';
import { onLayerDragEnd, onLayerDragMove, onTextTransform } from './interaction';
import { compositeOperation, fillProps, isOpenShape, shadowProps, strokeProps, traceShape } from './konvaProps';

interface NodeProps<T extends Layer> {
  layer: T;
  topLevel: boolean;
}

/** Attributes shared by every layer node. Position is the box centre so rotation and flips pivot there. */
function useCommonProps(layer: Layer, topLevel: boolean) {
  const selected = useEditorStore((s) => s.selectedIds.includes(layer.id));
  return {
    id: layer.id,
    name: 'layer',
    x: layer.x + layer.width / 2,
    y: layer.y + layer.height / 2,
    offsetX: layer.width / 2,
    offsetY: layer.height / 2,
    rotation: layer.rotation,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    opacity: layer.opacity,
    visible: layer.visible,
    listening: !layer.locked,
    globalCompositeOperation: compositeOperation(layer.blendMode),
    // Children of a group move with the group unless they were selected directly.
    draggable: !layer.locked && (topLevel || selected),
    onDragMove: onLayerDragMove,
    onDragEnd: onLayerDragEnd,
  };
}

const ImageNode = memo(function ImageNode({ layer, topLevel }: NodeProps<ImageLayer>) {
  const ref = useRef<Konva.Image>(null);
  const common = useCommonProps(layer, topLevel);
  const { image, status } = useLayerImage(layer);
  // The mask stage reuses its output canvas, so the image prop can be the same object with new
  // pixels (every painted frame, for instance). Konva only redraws when told to.
  useLayoutEffect(() => {
    ref.current?.getLayer()?.batchDraw();
  });
  // Without pixels (still loading, or the asset is gone) the same node draws a placeholder,
  // so the layer stays visible and selectable.
  const placeholder = image
    ? strokeProps(layer.stroke ? { ...layer.stroke, width: layer.stroke.width * 2 } : null)
    : { fill: status === 'missing' ? '#5a2f33' : '#3a3d44', stroke: '#8a8d96', strokeWidth: 1, dash: [6, 4] };
  return (
    <KImage
      ref={ref}
      {...common}
      image={image ?? undefined}
      width={layer.width}
      height={layer.height}
      cornerRadius={Math.min(layer.cornerRadius, layer.width / 2, layer.height / 2)}
      {...placeholder}
      {...shadowProps(layer.shadow)}
    />
  );
});

const ShapeNode = memo(function ShapeNode({ layer, topLevel }: NodeProps<ShapeLayer>) {
  const common = useCommonProps(layer, topLevel);
  const fill = useMemo(() => fillProps(layer.fill, layer.width, layer.height), [layer.fill, layer.width, layer.height]);
  const open = isOpenShape(layer.shape);
  return (
    <Shape
      {...common}
      width={layer.width}
      height={layer.height}
      {...fill}
      {...strokeProps(layer.stroke)}
      {...shadowProps(layer.shadow)}
      lineCap={open ? 'round' : 'butt'}
      lineJoin={open ? 'round' : 'miter'}
      hitStrokeWidth={open ? Math.max(18, layer.stroke?.width ?? 0) : 'auto'}
      sceneFunc={(ctx, shape) => {
        traceShape(ctx, layer);
        ctx.fillStrokeShape(shape);
      }}
    />
  );
});

const TextNode = memo(function TextNode({ layer, topLevel }: NodeProps<TextLayer>) {
  const ref = useRef<Konva.Text>(null);
  const measuredFontVersion = useRef(0);
  const common = useCommonProps(layer, topLevel);
  const editing = useUiStore((s) => s.editingTextId === layer.id);
  const fontVersion = useUiStore((s) => s.fontVersion);
  const fill = useMemo(() => fillProps(layer.fill, layer.width, layer.height), [layer.fill, layer.width, layer.height]);

  useEffect(() => {
    void ensureFont(layer.fontFamily, layer.fontWeight, layer.italic);
  }, [layer.fontFamily, layer.fontWeight, layer.italic]);

  // Text height is derived from its content. Keep the document in step with what Konva measures,
  // anchoring the top-left corner so text grows downwards.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (measuredFontVersion.current !== fontVersion) {
      measuredFontVersion.current = fontVersion;
      (node as unknown as { _setTextData?: () => void })._setTextData?.();
      node.getLayer()?.batchDraw();
    }
    const height = node.height();
    if (Math.abs(height - layer.height) > 0.5) {
      useEditorStore
        .getState()
        .updateLayers([layer.id], (l) => resizeFromTopLeft(l, l.width, height), { history: false });
    }
  });

  return (
    <Text
      ref={ref}
      {...common}
      opacity={editing ? 0 : layer.opacity}
      width={layer.width}
      text={layer.text}
      fontFamily={fontStack(layer.fontFamily)}
      fontSize={layer.fontSize}
      fontStyle={`${layer.italic ? 'italic ' : ''}${layer.fontWeight}`}
      textDecoration={layer.underline ? 'underline' : ''}
      align={layer.align}
      lineHeight={layer.lineHeight}
      letterSpacing={layer.letterSpacing}
      {...fill}
      {...strokeProps(layer.stroke)}
      {...shadowProps(layer.shadow)}
      lineJoin="round"
      fillAfterStrokeEnabled
      onTransform={onTextTransform}
    />
  );
});

const GroupNode = memo(function GroupNode({ layer, topLevel }: NodeProps<GroupLayer>) {
  const common = useCommonProps(layer, topLevel);
  // `isolated` composites the children first, so group opacity and blend mode apply to the group as one image.
  const isolated = layer.opacity < 1 || layer.blendMode !== 'normal';
  return (
    <Group {...common} isolated={isolated}>
      {layer.children.map((child) => (
        <LayerNode key={child.id} layer={child} topLevel={false} />
      ))}
    </Group>
  );
});

export const LayerNode = memo(function LayerNode({ layer, topLevel }: NodeProps<Layer>) {
  switch (layer.type) {
    case 'image':
      return <ImageNode layer={layer} topLevel={topLevel} />;
    case 'shape':
      return <ShapeNode layer={layer} topLevel={topLevel} />;
    case 'text':
      return <TextNode layer={layer} topLevel={topLevel} />;
    case 'group':
      return <GroupNode layer={layer} topLevel={topLevel} />;
  }
});
