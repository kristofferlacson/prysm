import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Group, Image as KImage, Shape, Text } from 'react-konva';
import type Konva from 'konva';
import { findPath, resizeFromTopLeft } from '../../features/document/operations';
import { useLayerImage } from '../../features/image-editing/useLayerImage';
import { getGraphic } from '../../features/library/graphics';
import { defaultIconStroke, drawIcon } from '../../features/library/icons';
import { needsPicture, renderStyledText, textAttrs } from '../../features/text-warp/renderText';
import { ensureFont } from '../../services/fonts';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { GroupLayer, ImageLayer, Layer, ShapeLayer, TextLayer } from '../../types/document';
import { onLayerDragEnd, onLayerDragMove, onLayerTransform, onTextTransform } from './interaction';
import { compositeOperation, dashProps, fillProps, isOpenShape, shadowProps, strokeProps, traceShape } from './konvaProps';

type Composite = GlobalCompositeOperation;

interface NodeProps<T extends Layer> {
  layer: T;
  topLevel: boolean;
  /**
   * Overrides how the node is composited. Clipping groups use this: the layer's own blend mode
   * is then applied by a wrapper so that it acts on the clipped result.
   */
  composite?: Composite;
  /**
   * A ghost is a second drawing of a layer used only for its shape (to cut a clipped layer down
   * to its base). It has no identity: it cannot be found, selected, hit or dragged.
   */
  ghost?: boolean;
  /** Replaces the layer's own opacity (a clipping base is drawn solid; its opacity fades the whole group). */
  opacity?: number;
}

/** Attributes shared by every layer node. Position is the box centre so rotation and flips pivot there. */
function useCommonProps(layer: Layer, { topLevel, composite, ghost, opacity }: Omit<NodeProps<Layer>, 'layer'>) {
  const selected = useEditorStore((s) => s.selectedIds.includes(layer.id));
  const transform = {
    x: layer.x + layer.width / 2,
    y: layer.y + layer.height / 2,
    offsetX: layer.width / 2,
    offsetY: layer.height / 2,
    rotation: layer.rotation,
    scaleX: layer.scaleX,
    scaleY: layer.scaleY,
    visible: layer.visible,
    globalCompositeOperation: composite ?? compositeOperation(layer.blendMode),
  };
  if (ghost) {
    return {
      ...transform,
      name: `ghost ghost-${layer.id}`,
      // A cutting ghost (one with a composite override) must be fully opaque to cut cleanly.
      opacity: composite ? 1 : (opacity ?? layer.opacity),
      listening: false,
      draggable: false,
    };
  }
  return {
    ...transform,
    id: layer.id,
    name: 'layer',
    opacity: opacity ?? layer.opacity,
    listening: !layer.locked,
    // Children of a group move with the group unless they were selected directly.
    draggable: !layer.locked && (topLevel || selected),
    onDragMove: onLayerDragMove,
    onDragEnd: onLayerDragEnd,
    onTransform: onLayerTransform,
  };
}

const ImageNode = memo(function ImageNode({ layer, ...placement }: NodeProps<ImageLayer>) {
  const ref = useRef<Konva.Image>(null);
  const { ghost } = placement;
  const common = useCommonProps(layer, placement);
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
    : ghost
      ? {}
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
      {...shadowProps(ghost ? null : layer.shadow)}
    />
  );
});

/** A line icon: one vector path stroked straight onto the canvas, so it is sharp at any size. */
const IconNode = memo(function IconNode({ layer, ...placement }: NodeProps<ShapeLayer>) {
  const common = useCommonProps(layer, placement);
  const color = layer.stroke?.color ?? '#1d1e22';
  const weight = layer.stroke?.width ?? defaultIconStroke(Math.min(layer.width, layer.height));
  return (
    <Shape
      {...common}
      width={layer.width}
      height={layer.height}
      {...shadowProps(placement.ghost ? null : layer.shadow)}
      sceneFunc={(ctx) => {
        drawIcon(ctx._context, layer.icon, layer.width, layer.height, color, weight);
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        ctx.rect(0, 0, layer.width, layer.height);
        ctx.closePath();
        ctx.fillStrokeShape(shape);
      }}
    />
  );
});

const MAX_GRAPHIC = 4096;

/**
 * A code-drawn graphic (sticker, frame, illustration). It is drawn once into its own picture at
 * the size it is seen at, so its overlapping parts fade, blend and cast a shadow as one object.
 */
const GraphicNode = memo(function GraphicNode({ layer, ...placement }: NodeProps<ShapeLayer>) {
  const ref = useRef<Konva.Shape>(null);
  const common = useCommonProps(layer, placement);
  const density = useRenderDensity(layer, placement.topLevel);
  const picture = useMemo(() => {
    const def = getGraphic(layer.graphic ?? '');
    if (!def) return null;
    const d = Math.min(density, MAX_GRAPHIC / layer.width, MAX_GRAPHIC / layer.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(layer.width * d));
    canvas.height = Math.max(1, Math.round(layer.height * d));
    const ctx = canvas.getContext('2d')!;
    // Missing or extra palette entries fall back to the graphic's own colours.
    const colors = def.colors.map((c, i) => layer.colors?.[i] ?? c);
    ctx.scale(canvas.width / layer.width, canvas.height / layer.height);
    def.draw(ctx, layer.width, layer.height, colors);
    return canvas;
  }, [layer.graphic, layer.colors, layer.width, layer.height, density]);
  useLayoutEffect(() => {
    ref.current?.getLayer()?.batchDraw();
  }, [picture]);
  return (
    <Shape
      ref={ref}
      {...common}
      width={layer.width}
      height={layer.height}
      {...shadowProps(placement.ghost ? null : layer.shadow)}
      sceneFunc={(ctx) => {
        if (picture) ctx.drawImage(picture, 0, 0, layer.width, layer.height);
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        ctx.rect(0, 0, layer.width, layer.height);
        ctx.closePath();
        ctx.fillStrokeShape(shape);
      }}
    />
  );
});

const ShapeNode = memo(function ShapeNode(props: NodeProps<ShapeLayer>) {
  if (props.layer.shape === 'icon') return <IconNode {...props} />;
  if (props.layer.shape === 'graphic') return <GraphicNode {...props} />;
  return <BasicShapeNode {...props} />;
});

const BasicShapeNode = memo(function BasicShapeNode({ layer, ...placement }: NodeProps<ShapeLayer>) {
  const { ghost } = placement;
  const common = useCommonProps(layer, placement);
  const fill = useMemo(() => fillProps(layer.fill, layer.width, layer.height), [layer.fill, layer.width, layer.height]);
  const open = isOpenShape(layer.shape);
  return (
    <Shape
      {...common}
      width={layer.width}
      height={layer.height}
      {...fill}
      {...strokeProps(layer.stroke)}
      {...shadowProps(ghost ? null : layer.shadow)}
      lineCap={open ? 'round' : 'butt'}
      lineJoin={open ? 'round' : 'miter'}
      {...dashProps(layer.stroke)}
      hitStrokeWidth={open ? Math.max(18, layer.stroke?.width ?? 0) : 'auto'}
      sceneFunc={(ctx, shape) => {
        traceShape(ctx, layer);
        ctx.fillStrokeShape(shape);
      }}
    />
  );
});

/** Rounds a pixel density up to the next half power of two, so zooming re-renders warped text only now and then. */
const densityStep = (d: number) => 2 ** (Math.ceil(Math.log2(Math.max(0.05, d)) * 2) / 2);

/**
 * Some layers are drawn as a picture made by code (warped or styled text, vector graphics). The
 * picture has to be made at the size it will be seen at: the zoom on screen, or the export scale
 * while a file is being written. Returns output pixels per layer unit.
 */
function useRenderDensity(layer: Layer, topLevel: boolean) {
  const view = useUiStore((s) =>
    s.renderQuality === 'full' ? s.exportScale : densityStep(s.zoom * (window.devicePixelRatio || 1)),
  );
  // Text inside scaled groups is drawn larger than its own size says.
  const ancestors = useEditorStore((s) => {
    if (topLevel) return 1;
    const path = findPath(s.doc.layers, layer.id) ?? [];
    return path.slice(0, -1).reduce((k, g) => k * Math.max(Math.abs(g.scaleX), Math.abs(g.scaleY)), 1);
  });
  return view * ancestors;
}

/** Text on a path, through a warp or with effects. Same layer, same properties; only the last drawing step differs. */
const StyledTextNode = memo(function StyledTextNode({ layer, ...placement }: NodeProps<TextLayer>) {
  const ref = useRef<Konva.Shape>(null);
  const { ghost } = placement;
  const common = useCommonProps(layer, placement);
  const editing = useUiStore((s) => s.editingTextId === layer.id);
  const fontVersion = useUiStore((s) => s.fontVersion);
  const density = useRenderDensity(layer, placement.topLevel);

  useEffect(() => {
    void ensureFont(layer.fontFamily, layer.fontWeight, layer.italic);
  }, [layer.fontFamily, layer.fontWeight, layer.italic]);

  // A path is laid out in the text box, so its picture depends on the box height as well.
  const pathHeight = layer.path ? layer.height : 0;
  // Only what changes the picture is listed: moving, rotating or fading the layer reuses it.
  const warped = useMemo(
    () => renderStyledText(layer, density),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      layer.text, layer.width, layer.fontFamily, layer.fontSize, layer.fontWeight, layer.italic, layer.underline,
      layer.align, layer.lineHeight, layer.letterSpacing, layer.fill, layer.stroke, layer.warp, layer.path, layer.effects,
      pathHeight, density, fontVersion,
    ],
  );
  const box = { x: 0, y: 0, width: layer.width, height: layer.height };
  const bounds = warped?.bounds ?? box;
  const outline = warped?.outline ?? box;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Selection handles, marquee selection and hit testing all follow the warped outline.
    node.getSelfRect = () => outline;
    node.getLayer()?.batchDraw();
    const textHeight = warped?.textHeight;
    if (ghost || textHeight == null) return;
    if (Math.abs(textHeight - layer.height) > 0.5) {
      useEditorStore.getState().updateLayers([layer.id], (l) => resizeFromTopLeft(l, l.width, textHeight), { history: false });
    }
  });

  return (
    <Shape
      ref={ref}
      {...common}
      opacity={editing && !ghost ? 0 : common.opacity}
      width={layer.width}
      height={layer.height}
      {...shadowProps(ghost ? null : layer.shadow)}
      sceneFunc={(ctx) => {
        if (warped) ctx.drawImage(warped.canvas, bounds.x, bounds.y, bounds.width, bounds.height);
      }}
      hitFunc={(ctx, shape) => {
        ctx.beginPath();
        ctx.rect(outline.x, outline.y, outline.width, outline.height);
        ctx.closePath();
        ctx.fillStrokeShape(shape);
      }}
    />
  );
});

const TextNode = memo(function TextNode(props: NodeProps<TextLayer>) {
  // A warp that changes nothing (bend 0, untouched custom points) keeps the crisp vector text.
  return needsPicture(props.layer) ? <StyledTextNode {...props} /> : <PlainTextNode {...props} />;
});

const PlainTextNode = memo(function PlainTextNode({ layer, ...placement }: NodeProps<TextLayer>) {
  const ref = useRef<Konva.Text>(null);
  const measuredFontVersion = useRef(0);
  const { ghost } = placement;
  const common = useCommonProps(layer, placement);
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
    if (ghost) return;
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
      opacity={editing && !ghost ? 0 : common.opacity}
      {...textAttrs(layer)}
      {...fill}
      {...shadowProps(ghost ? null : layer.shadow)}
      onTransform={ghost ? undefined : onTextTransform}
    />
  );
});

const GroupNode = memo(function GroupNode({ layer, ...placement }: NodeProps<GroupLayer>) {
  const { ghost } = placement;
  const common = useCommonProps(layer, placement);
  // `isolated` composites the children first, so opacity, blend mode and clipping act on the group as one image.
  const isolated = layer.opacity < 1 || layer.blendMode !== 'normal' || !!placement.composite;
  return (
    <Group {...common} isolated={isolated}>
      <LayerList layers={layer.children} topLevel={false} ghost={ghost} />
    </Group>
  );
});

export const LayerNode = memo(function LayerNode(props: NodeProps<Layer>) {
  const { layer, ...rest } = props;
  switch (layer.type) {
    case 'image':
      return <ImageNode layer={layer} {...rest} />;
    case 'shape':
      return <ShapeNode layer={layer} {...rest} />;
    case 'text':
      return <TextNode layer={layer} {...rest} />;
    case 'group':
      return <GroupNode layer={layer} {...rest} />;
  }
});

/**
 * Renders sibling layers bottom to top. A layer followed by clipped layers becomes a clipping group:
 *
 *   isolated group (carries the base's blend mode and opacity; hidden when the base is hidden)
 *     base                        drawn solid into the group's own buffer
 *     clipped layer, normal       drawn with source-atop: only where the base has pixels
 *     clipped layer, blended      isolated group carrying that blend mode:
 *                                   the layer, then a ghost of the base with destination-in
 *
 * The second form is needed because a canvas blend mode by itself also paints outside the base;
 * cutting the layer to the base's shape first lets it blend with the base and stay inside it.
 */
export const LayerList = memo(function LayerList({ layers, topLevel, ghost }: { layers: Layer[]; topLevel: boolean; ghost?: boolean }) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < layers.length; ) {
    const base = layers[i];
    let end = i + 1;
    while (end < layers.length && layers[end].clip) end++;
    const clipped = layers.slice(i + 1, end);
    i = end;
    if (!clipped.length) {
      out.push(<LayerNode key={base.id} layer={base} topLevel={topLevel} ghost={ghost} />);
      continue;
    }
    out.push(
      <Group
        key={`clip-${base.id}`}
        isolated
        visible={base.visible}
        opacity={base.opacity}
        globalCompositeOperation={compositeOperation(base.blendMode)}
      >
        <LayerNode layer={base} topLevel={topLevel} composite="source-over" opacity={1} ghost={ghost} />
        {clipped.map((layer) =>
          layer.blendMode === 'normal' ? (
            <LayerNode key={layer.id} layer={layer} topLevel={topLevel} composite="source-atop" ghost={ghost} />
          ) : (
            <Group key={layer.id} isolated globalCompositeOperation={compositeOperation(layer.blendMode)}>
              <LayerNode layer={layer} topLevel={topLevel} composite="source-over" ghost={ghost} />
              <LayerNode layer={base} topLevel={topLevel} composite="destination-in" ghost />
            </Group>
          ),
        )}
      </Group>,
    );
  }
  return <>{out}</>;
});
