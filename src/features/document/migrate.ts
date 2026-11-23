import type { Layer, ProjectDocument } from '../../types/document';
import { normalizeFade } from '../image-editing/fade';
import { NO_TEXT_EFFECTS } from './factory';

export const CURRENT_SCHEMA = 6;

function migrateLayer(layer: Layer): Layer {
  const next = { ...layer, clip: layer.clip ?? false } as Layer;
  if (next.type === 'image') {
    next.masks = next.masks ?? [];
    if (next.fade) next.fade = normalizeFade(next.fade);
  }
  if (next.type === 'text') {
    next.warp = next.warp ?? null;
    next.path = next.path ?? null;
    next.effects = next.effects ?? NO_TEXT_EFFECTS;
  }
  if (next.type === 'group') next.children = next.children.map(migrateLayer);
  return next;
}

/** Brings loose layers (a saved asset) up to the current schema. Safe to run on current ones. */
export const migrateLayers = (layers: Layer[]) => layers.map(migrateLayer);

/**
 * Brings a stored document up to the current schema.
 * v1 -> v2: layers gain `clip`; image layers gain `masks`.
 * v2 -> v3: text layers gain `warp`.
 * v3 -> v4: text layers gain `path` and `effects`.
 * v4 -> v5: the document gains `selections` (saved selections).
 * v5 -> v6: a fade is a set of parts (sides, corners, a direction, a shape) instead of one line or oval.
 */
export function migrateDocument(doc: ProjectDocument): ProjectDocument {
  if ((doc.schemaVersion as number) >= CURRENT_SCHEMA) return doc;
  return { ...doc, schemaVersion: CURRENT_SCHEMA, layers: doc.layers.map(migrateLayer), selections: doc.selections ?? [] };
}
