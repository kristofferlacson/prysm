import { useMemo, useRef, useState } from 'react';
import { sourceSize } from '../../features/image-editing/pipeline';
import {
  autoLevels,
  CURVE_CHANNELS,
  curveLut,
  DEFAULT_CURVES,
  DEFAULT_LEVELS,
  histogramOf,
  IDENTITY_CURVE,
  isDefaultCurves,
  isDefaultLevels,
  isIdentityCurve,
  type Histogram,
} from '../../features/image-editing/tone';
import { sourceRaster } from '../../features/masks/maskActions';
import { useAssetImage } from '../../services/assets';
import { useRaster } from '../../services/rasters';
import type { CurveChannel, CurvePoint, Curves, ImageLayer, Levels } from '../../types/document';
import { Section, Segmented, SliderRow, TextButton } from '../ui/controls';
import type { Update } from './PropertiesPanel';

const CHANNEL_LABEL: Record<CurveChannel, string> = { rgb: 'RGB', r: 'Red', g: 'Green', b: 'Blue' };
const CHANNEL_COLOR: Record<CurveChannel, string> = { rgb: '#e8e9ec', r: '#ff6b6b', g: '#3ddc97', b: '#6ea8ff' };

/** The spread of tones in the layer's original picture (before any adjustment). */
function useHistogram(layer: ImageLayer): Histogram | null {
  const { source } = layer;
  // Subscribing to the loaders re-renders this once the pixels are in memory.
  const asset = useAssetImage(source.kind === 'asset' ? source.assetId : null);
  const raster = useRaster(source.kind === 'raster' ? source.rasterId : null);
  return useMemo(() => {
    const pixels = sourceRaster(source);
    if (!pixels) return null;
    const { width, height } = sourceSize(pixels);
    try {
      return histogramOf(pixels, width, height);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, asset.status, raster.status]);
}

/** The histogram as an SVG path in a 0..255 by 0..100 box (taller = more pixels of that tone). */
function histogramPath(h: Histogram | null, channel: CurveChannel) {
  if (!h) return '';
  const key = channel === 'rgb' ? 'l' : channel;
  const data = h[key];
  const peak = h.peak[key];
  let d = 'M0 100';
  for (let i = 0; i < 256; i++) d += `L${i} ${(100 - Math.min(1, data[i] / peak) * 100).toFixed(1)}`;
  return `${d}L255 100Z`;
}

function ResetLink({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="text-[11px] text-dim hover:text-ink disabled:invisible">
      {children}
    </button>
  );
}

/** Black point, white point and midtones, over the picture's histogram. */
export function LevelsSection({ layer, update }: { layer: ImageLayer; update: Update }) {
  const histogram = useHistogram(layer);
  const stored = layer.adjustments.levels ?? null;
  const levels = stored ?? DEFAULT_LEVELS;
  const set = (patch: Partial<Levels>, key: string) => {
    const next = { ...levels, ...patch };
    update({ adjustments: { ...layer.adjustments, levels: isDefaultLevels(next) ? null : next } }, `levels-${key}`);
  };
  return (
    <Section
      title="Levels"
      defaultOpen={!isDefaultLevels(stored)}
      action={
        <ResetLink disabled={isDefaultLevels(stored)} onClick={() => update({ adjustments: { ...layer.adjustments, levels: null } })}>
          Reset
        </ResetLink>
      }
    >
      <svg data-testid="levels-histogram" viewBox="0 0 255 100" preserveAspectRatio="none" className="h-16 w-full rounded bg-raised">
        <path d={histogramPath(histogram, 'rgb')} fill="rgba(232,233,236,0.45)" />
        {/* Everything left of the black point becomes black; everything right of the white point becomes white. */}
        <rect x={0} y={0} width={levels.black} height={100} fill="rgba(0,0,0,0.45)" />
        <rect x={levels.white} y={0} width={255 - levels.white} height={100} fill="rgba(0,0,0,0.45)" />
        <line x1={levels.black} x2={levels.black} y1={0} y2={100} stroke="#3ddc97" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={levels.white} x2={levels.white} y1={0} y2={100} stroke="#3ddc97" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <SliderRow label="Black point" value={levels.black} min={0} max={levels.white - 2} defaultValue={0} onChange={(v) => set({ black: v }, 'black')} />
      <SliderRow label="Midtones" value={levels.gamma} min={0.2} max={3} step={0.01} defaultValue={1} onChange={(v) => set({ gamma: v }, 'gamma')} />
      <SliderRow label="White point" value={levels.white} min={levels.black + 2} max={255} defaultValue={255} onChange={(v) => set({ white: v }, 'white')} />
      <SliderRow label="Output black" value={levels.outBlack} min={0} max={255} defaultValue={0} onChange={(v) => set({ outBlack: v }, 'out-black')} />
      <SliderRow label="Output white" value={levels.outWhite} min={0} max={255} defaultValue={255} onChange={(v) => set({ outWhite: v }, 'out-white')} />
      <span className="block" title="Set the black and white points to where the picture's tones actually begin and end">
        <TextButton className="w-full" disabled={!histogram} onClick={() => histogram && set(autoLevels(histogram), 'auto')}>
          Auto
        </TextButton>
      </span>
      <p className="leading-relaxed text-faint">
        The graph shows how many pixels the picture has of each tone, dark on the left. Move the black and white points in to where the graph starts and ends
        to use the full range.
      </p>
    </Section>
  );
}

/** A tone curve per channel, edited by dragging points. */
export function CurvesSection({ layer, update }: { layer: ImageLayer; update: Update }) {
  const histogram = useHistogram(layer);
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  /** Counts gestures, so that adding a point and dragging it are one undo step and the next drag is another. */
  const gesture = useRef(0);
  const stored = layer.adjustments.curves ?? null;
  const curves = stored ?? DEFAULT_CURVES;
  const points = curves[channel];
  const lut = useMemo(() => curveLut(points), [points]);

  const commit = (next: CurvePoint[], key: string) => {
    const all: Curves = { ...curves, [channel]: next };
    update({ adjustments: { ...layer.adjustments, curves: isDefaultCurves(all) ? null : all } }, `curves-${key}`);
  };
  /** Pointer position as a tone value pair: input (left to right) and output (bottom to top). */
  const valueAt = (e: React.PointerEvent): CurvePoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 255);
    const y = Math.round((1 - (e.clientY - rect.top) / rect.height) * 255);
    return [Math.min(255, Math.max(0, x)), Math.min(255, Math.max(0, y))];
  };
  const movePoint = (index: number, [x, y]: CurvePoint) => {
    // A point stays between its neighbours, so the curve always reads left to right.
    const low = index === 0 ? 0 : points[index - 1][0] + 2;
    const high = index === points.length - 1 ? 255 : points[index + 1][0] - 2;
    const next = points.map((p, i) => (i === index ? ([Math.min(high, Math.max(low, x)), y] as CurvePoint) : p));
    commit(next, `drag-${channel}-${gesture.current}`);
  };

  let path = '';
  for (let i = 0; i < 256; i++) path += `${i ? 'L' : 'M'}${i} ${255 - lut[i]}`;

  return (
    <Section
      title="Curves"
      defaultOpen={!isDefaultCurves(stored)}
      action={
        <ResetLink disabled={isDefaultCurves(stored)} onClick={() => update({ adjustments: { ...layer.adjustments, curves: null } })}>
          Reset all
        </ResetLink>
      }
    >
      <Segmented<CurveChannel> value={channel} options={CURVE_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} onChange={setChannel} />
      <svg
        ref={svgRef}
        data-testid="curves-editor"
        data-channel={channel}
        viewBox="0 0 255 255"
        className="aspect-square w-full touch-none rounded bg-raised"
        style={{ overflow: 'visible' }}
        onPointerDown={(e) => {
          // A press on empty space adds a point there and starts dragging it.
          if (e.button !== 0 || (e.target as Element).hasAttribute('data-curve-point')) return;
          const [x, y] = valueAt(e);
          const at = points.findIndex((p) => p[0] >= x);
          const index = at < 0 ? points.length : at;
          if (points.some((p) => Math.abs(p[0] - x) < 3)) return;
          const next = [...points.slice(0, index), [x, y] as CurvePoint, ...points.slice(index)];
          gesture.current++;
          commit(next, `drag-${channel}-${gesture.current}`);
          dragging.current = index;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => dragging.current !== null && movePoint(dragging.current, valueAt(e))}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
        onDoubleClick={(e) => {
          // While a point is pressed the editor holds the pointer, so the double-click arrives here:
          // find the point under it. The two end points define the curve's range and stay.
          const rect = svgRef.current!.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 255;
          const y = (1 - (e.clientY - rect.top) / rect.height) * 255;
          const index = points.findIndex((p) => Math.abs(p[0] - x) < 9 && Math.abs(p[1] - y) < 9);
          if (index > 0 && index < points.length - 1) commit(points.filter((_, k) => k !== index), `remove-${channel}-${points.length}`);
        }}
      >
        <path d={histogramPath(histogram, channel)} fill={CHANNEL_COLOR[channel]} opacity={0.3} transform="scale(1 2.55)" />
        {[64, 128, 191].map((v) => (
          <g key={v} stroke="rgba(255,255,255,0.08)" strokeWidth={1} vectorEffect="non-scaling-stroke">
            <line x1={v} x2={v} y1={0} y2={255} vectorEffect="non-scaling-stroke" />
            <line x1={0} x2={255} y1={v} y2={v} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        <line x1={0} y1={255} x2={255} y2={0} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={path} fill="none" stroke={CHANNEL_COLOR[channel]} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <circle
            key={i}
            data-curve-point={i}
            data-value={`${p[0]},${p[1]}`}
            cx={p[0]}
            cy={255 - p[1]}
            r={5.5}
            fill="#14161b"
            stroke={CHANNEL_COLOR[channel]}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            className="cursor-grab"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              gesture.current++;
              dragging.current = i;
              svgRef.current!.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>
      <div className="flex items-center justify-between">
        <span className="text-faint">
          {CHANNEL_LABEL[channel]} · {points.length} points
        </span>
        <ResetLink disabled={isIdentityCurve(points)} onClick={() => commit(IDENTITY_CURVE, `reset-${channel}`)}>
          {`Reset ${CHANNEL_LABEL[channel]}`}
        </ResetLink>
      </div>
      <p className="leading-relaxed text-faint">
        Left to right is the picture’s tones from dark to light; height is how bright each becomes. Click the line to add a point, drag it up to lighten or down
        to darken, double-click a point to remove it. An S shape adds contrast.
      </p>
    </Section>
  );
}
