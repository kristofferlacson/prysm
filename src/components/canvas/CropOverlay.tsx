import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { dragCrop, fullSize, presetRatio, stopCropping, type CropHandle } from '../../features/crop/crop';
import { findLayer, layerToDocument } from '../../features/document/operations';
import { sourceSize } from '../../features/image-editing/pipeline';
import { sourceRaster } from '../../features/masks/maskActions';
import { useEditorStore } from '../../stores/editorStore';
import { useUiStore } from '../../stores/uiStore';
import type { CropInsets } from '../../types/document';
import { multiply, type Mat } from '../../utils/geometry';

const HANDLES: { id: CropHandle; x: number; y: number; cursor: string }[] = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

/**
 * Cropping on the canvas. While a layer is being cropped, the whole original picture is shown
 * faintly around it, with a frame that can be dragged by its corners, its sides or its middle.
 *
 * The frame lives in the layer's own space (a CSS matrix places it), so rotated, flipped and
 * grouped layers need no special handling: a drag is converted back into the picture's axes.
 */
export function CropOverlay({ onPan }: { onPan: (evt: MouseEvent) => void }) {
  const { cropLayerId, cropPreset, zoom, pan } = useUiStore(useShallow((s) => ({ cropLayerId: s.cropLayerId, cropPreset: s.cropPreset, zoom: s.zoom, pan: s.pan })));
  const layers = useEditorStore((s) => s.doc.layers);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const found = cropLayerId ? findLayer(layers, cropLayerId) : null;
  const layer = found?.type === 'image' ? found : null;
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ handle: CropHandle; x: number; y: number; crop: CropInsets; inverse: [number, number, number, number]; step: string } | null>(null);
  const drags = useRef(0);

  // Cropping ends by itself when the layer goes away or something else is selected.
  const stillSelected = !!layer && selectedIds.length === 1 && selectedIds[0] === layer.id;
  useEffect(() => {
    if (cropLayerId && !stillSelected) stopCropping(true);
  }, [cropLayerId, stillSelected]);

  // The faint picture of everything outside the frame.
  const source = layer?.source;
  useEffect(() => {
    const canvas = ghostRef.current;
    const pixels = source ? sourceRaster(source) : null;
    if (!canvas || !pixels) return;
    const size = sourceSize(pixels);
    const k = Math.min(1, 1024 / Math.max(size.width, size.height));
    canvas.width = Math.max(1, Math.round(size.width * k));
    canvas.height = Math.max(1, Math.round(size.height * k));
    canvas.getContext('2d')!.drawImage(pixels, 0, 0, canvas.width, canvas.height);
  }, [source, cropLayerId]);

  if (!layer || !stillSelected) return null;
  const toDoc = layerToDocument(layers, layer.id);
  if (!toDoc) return null;
  const full = fullSize(layer);
  const { crop } = layer;
  // Full-picture units (origin at the uncropped picture's corner) -> screen pixels.
  const m: Mat = multiply(multiply([zoom, 0, 0, zoom, pan.x, pan.y], toDoc), [1, 0, 0, 1, -crop.left * full.width, -crop.top * full.height]);
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
  const px = (n: number) => n / scale;
  const x0 = crop.left * full.width;
  const y0 = crop.top * full.height;
  const w = layer.width;
  const h = layer.height;
  const ratio = presetRatio(layer, cropPreset);
  const unitRatio = ratio ? ratio * (full.height / full.width) : null;

  const begin = (handle: CropHandle) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const det = m[0] * m[3] - m[1] * m[2] || 1;
    drag.current = { handle, x: e.clientX, y: e.clientY, crop, inverse: [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det], step: `crop-drag-${++drags.current}` };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const sx = e.clientX - d.x;
    const sy = e.clientY - d.y;
    // Screen movement -> movement along the picture's own axes, as a fraction of its size.
    const dx = (d.inverse[0] * sx + d.inverse[2] * sy) / full.width;
    const dy = (d.inverse[1] * sx + d.inverse[3] * sy) / full.height;
    useEditorStore.getState().setCrop(layer.id, dragCrop(d.crop, d.handle, dx, dy, unitRatio), d.step);
  };
  const end = () => {
    drag.current = null;
  };

  const hole = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x0}px ${y0}px, ${x0}px ${y0 + h}px, ${x0 + w}px ${y0 + h}px, ${x0 + w}px ${y0}px, ${x0}px ${y0}px)`;
  const size = px(11);

  return (
    <div
      data-testid="crop-overlay"
      className="absolute inset-0 z-10 touch-none overflow-hidden"
      onPointerDown={(e) => e.button === 1 && onPan(e.nativeEvent)}
      onDoubleClick={() => stopCropping(true)}
    >
      <div className="absolute left-0 top-0" style={{ width: full.width, height: full.height, transformOrigin: '0 0', transform: `matrix(${m.join(',')})` }}>
        <canvas ref={ghostRef} className="absolute inset-0 h-full w-full" style={{ opacity: 0.35, clipPath: hole }} />
        <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)', clipPath: hole }} />
        <div
          data-testid="crop-frame"
          className="absolute"
          style={{ left: x0, top: y0, width: w, height: h, outline: `${px(1.5)}px solid #ffffff`, boxShadow: `0 0 0 ${px(2.5)}px rgba(0,0,0,0.55)`, cursor: 'move' }}
          onPointerDown={begin('move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {[1 / 3, 2 / 3].map((t) => (
            <div key={t} className="pointer-events-none absolute inset-0">
              <div className="absolute top-0 h-full" style={{ left: `${t * 100}%`, width: px(1), background: 'rgba(255,255,255,0.35)' }} />
              <div className="absolute left-0 w-full" style={{ top: `${t * 100}%`, height: px(1), background: 'rgba(255,255,255,0.35)' }} />
            </div>
          ))}
          {HANDLES.map((handle) => (
            <div
              key={handle.id}
              data-crop-handle={handle.id}
              className="absolute rounded-sm"
              style={{
                left: handle.x * w - size / 2,
                top: handle.y * h - size / 2,
                width: size,
                height: size,
                background: '#ffffff',
                boxShadow: `0 0 0 ${px(1.5)}px #3ddc97`,
                cursor: handle.cursor,
              }}
              onPointerDown={begin(handle.id)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
