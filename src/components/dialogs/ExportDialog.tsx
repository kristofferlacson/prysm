import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadBlob, exportDocument, maxExportScale, type ExportFormat } from '../../services/export';
import { useEditorStore } from '../../stores/editorStore';
import { NotImplemented, NumberInput, Row, Segmented, SliderRow, Switch, TextButton } from '../ui/controls';
import { Modal } from './Modal';

const EXTENSION: Record<ExportFormat, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditorStore((s) => s.doc);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(92);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = maxExportScale(doc.width, doc.height);
  const effective = Math.min(scale, limit);
  const outW = Math.round(doc.width * effective);
  const outH = Math.round(doc.height * effective);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await exportDocument({ format, scale: effective, quality: quality / 100, transparent });
      const safeName = doc.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'design';
      downloadBlob(blob, `${safeName}.${EXTENSION[format]}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Export design" onClose={onClose} width={400}>
      <div className="space-y-3 p-4" data-testid="export-dialog">
        <Row label="Format">
          <Segmented<ExportFormat>
            value={format}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
              { value: 'webp', label: 'WebP' },
            ]}
            onChange={setFormat}
          />
        </Row>
        <Row label="Size">
          <Segmented
            value={String(scale)}
            options={[0.5, 1, 2, 3, 4].map((s) => ({ value: String(s), label: `${s}×` }))}
            onChange={(v) => setScale(Number(v))}
          />
        </Row>
        <Row label="Width (px)">
          <NumberInput
            label="Export width"
            value={outW}
            min={16}
            max={Math.floor(doc.width * limit)}
            onChange={(w) => setScale(w / doc.width)}
          />
          <span className="shrink-0 text-faint" data-testid="export-dimensions">
            {outW} × {outH} px
          </span>
        </Row>
        {scale > limit && <p className="text-faint">Limited to {outW} × {outH} px, the largest size this browser can render reliably.</p>}
        {format !== 'png' && <SliderRow label="Quality" value={quality} min={10} max={100} onChange={setQuality} />}
        {format !== 'jpeg' && (
          <Row label="Transparent">
            <Switch label="Transparent background" checked={transparent} onChange={setTransparent} />
            <span className="text-faint">Leave out the canvas background</span>
          </Row>
        )}
        {error && <p className="text-danger">{error}</p>}
        <TextButton primary className="w-full" disabled={busy} onClick={() => void run()}>
          <Download size={13} /> {busy ? 'Rendering…' : `Export ${EXTENSION[format].toUpperCase()}`}
        </TextButton>
        <p className="text-faint">The whole canvas is exported at full image quality, independent of the current zoom.</p>
      </div>
      <NotImplemented title="PDF, SVG and selection-only export">
        <p>Planned for Milestone 2.</p>
      </NotImplemented>
    </Modal>
  );
}
