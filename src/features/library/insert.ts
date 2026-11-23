import { createGeneratedImage, createImage, createShape, createText, type TextPreset } from '../document/factory';
import { getGenerator } from '../generators/render';
import { insertSavedDesign } from '../../services/designLibrary';
import { getGraphic } from './graphics';
import { defaultIconStroke, getIcon } from './icons';
import { iconAssetId, recordUse } from './usage';
import { importImageFile, type AssetMeta } from '../../services/assets';
import { useEditorStore } from '../../stores/editorStore';
import type { Layer, ShapeKind, ShapeLayer, TextLayer } from '../../types/document';
import type { Point } from '../../utils/geometry';

/** Anything the side panels can put on the canvas, by click or by drag-and-drop. */
export type LibraryItem =
  | { kind: 'shape'; shape: ShapeKind; overrides?: Partial<ShapeLayer> }
  | { kind: 'text'; preset: TextPreset; overrides?: Partial<TextLayer> }
  | { kind: 'asset'; asset: Pick<AssetMeta, 'id' | 'name' | 'width' | 'height'> }
  | { kind: 'generator'; id: string }
  | { kind: 'icon'; name: string }
  | { kind: 'graphic'; id: string }
  | { kind: 'saved'; id: string };

export const LIBRARY_MIME = 'application/x-prysm-item';

function centerOn<T extends Layer>(layer: T, at?: Point): T {
  return at ? { ...layer, x: Math.round(at.x - layer.width / 2), y: Math.round(at.y - layer.height / 2) } : layer;
}

export function insertLibraryItem(item: LibraryItem, at?: Point) {
  const { doc, addLayers } = useEditorStore.getState();
  const { width: W, height: H } = doc;
  switch (item.kind) {
    case 'shape':
      addLayers([centerOn(createShape(item.shape, W, H, item.overrides), at)]);
      break;
    case 'text':
      addLayers([centerOn(createText(item.preset, W, H, item.overrides), at)]);
      break;
    case 'asset': {
      const { asset } = item;
      addLayers([
        centerOn(createImage({ kind: 'asset', assetId: asset.id }, asset.name, asset.width, asset.height, W, H), at),
      ]);
      break;
    }
    case 'icon': {
      const icon = getIcon(item.name);
      if (!icon) return;
      const size = Math.round(Math.min(W, H) * 0.18);
      const base = createShape('icon', W, H, { name: icon.label, icon: icon.name, fill: null, stroke: { color: '#1d1e22', width: defaultIconStroke(size) } });
      addLayers([centerOn({ ...base, width: size, height: size }, at ?? { x: W / 2, y: H / 2 })]);
      recordUse(iconAssetId(icon.name));
      break;
    }
    case 'graphic': {
      const def = getGraphic(item.id);
      if (!def) return;
      // Frames start large enough to hold a picture; everything else starts as an accent.
      const long = Math.min(W, H) * (def.category === 'Frames' ? 0.7 : 0.34);
      const width = Math.round(def.aspect >= 1 ? long : long * def.aspect);
      const height = Math.round(def.aspect >= 1 ? long / def.aspect : long);
      const base = createShape('graphic', W, H, { name: def.name, graphic: def.id, colors: [...def.colors], fill: null, stroke: null });
      addLayers([centerOn({ ...base, width, height }, at ?? { x: W / 2, y: H / 2 })]);
      recordUse(def.id);
      break;
    }
    case 'saved':
      insertSavedDesign(item.id, at);
      break;
    case 'generator': {
      const def = getGenerator(item.id);
      if (!def) return;
      const layer = createGeneratedImage(def.id, def.name, def.colors, W, H, def.blend, def.opacity);
      // Backgrounds go underneath everything; textures and overlays sit on top of the current design.
      addLayers([layer], { atBottom: def.kind === 'background' });
      recordUse(def.id);
      break;
    }
  }
}

/** Imports image files into the asset store and places each one on the canvas. Returns files that were rejected. */
export async function insertImageFiles(files: File[], at?: Point): Promise<string[]> {
  const rejected: string[] = [];
  let offset = 0;
  for (const file of files) {
    try {
      const asset = await importImageFile(file);
      insertLibraryItem({ kind: 'asset', asset }, at ? { x: at.x + offset, y: at.y + offset } : undefined);
      offset += 24;
    } catch {
      rejected.push(file.name);
    }
  }
  return rejected;
}
