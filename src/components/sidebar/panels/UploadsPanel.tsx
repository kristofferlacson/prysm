import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { insertImageFiles } from '../../../features/library/insert';
import { removeUnusedAssets } from '../../../features/projects/projects';
import { ACCEPTED_IMAGE_TYPES, useAssetLibrary } from '../../../services/assets';
import { TextButton } from '../../ui/controls';
import { libraryItemProps, PanelShell, tileClass } from './shared';

export function UploadsPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const assets = useAssetLibrary((s) => s.assets);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const rejected = await insertImageFiles(files);
    setBusy(false);
    setMessage(rejected.length ? `Could not import: ${rejected.join(', ')}. Use PNG, JPG, WebP or SVG.` : null);
  };

  const shown = assets.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <PanelShell title="Uploads" query={query} onQuery={setQuery} placeholder="Search uploads">
      <div className="p-3">
        <input
          ref={inputRef}
          data-testid="upload-input"
          type="file"
          multiple
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles(Array.from(e.dataTransfer.files));
          }}
          className="rounded border border-dashed border-line p-3 text-center"
        >
          <TextButton primary className="w-full" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload size={13} /> {busy ? 'Importing…' : 'Upload images'}
          </TextButton>
          <p className="mt-2 text-faint">PNG, JPG, WebP or SVG. You can also drop files here or straight onto the canvas.</p>
        </div>
        {message && <p className="mt-2 text-danger">{message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 px-3">
        {shown.map((asset) => (
          <button
            key={asset.id}
            type="button"
            title={`${asset.name} — ${asset.width} × ${asset.height}`}
            {...libraryItemProps({ kind: 'asset', asset: { id: asset.id, name: asset.name, width: asset.width, height: asset.height } })}
            className={`${tileClass} checker aspect-square`}
          >
            <img src={asset.url} alt={asset.name} draggable={false} className="h-full w-full object-contain" />
          </button>
        ))}
      </div>
      {!assets.length && <p className="px-3 text-faint">Images you upload are stored in this browser and appear here.</p>}
      {assets.length > 0 && (
        <div className="p-3">
          <TextButton
            className="w-full"
            onClick={async () => {
              const removed = await removeUnusedAssets();
              setMessage(removed ? `Removed ${removed} unused image${removed === 1 ? '' : 's'}.` : 'Every upload is used by a project.');
            }}
          >
            Remove images no project uses
          </TextButton>
        </div>
      )}
    </PanelShell>
  );
}
