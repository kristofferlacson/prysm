import type { Layer, ProjectDocument } from '../../types/document';

export const CURRENT_SCHEMA = 2;

function migrateLayer(layer: Layer): Layer {
  const next = { ...layer, clip: layer.clip ?? false } as Layer;
  if (next.type === 'image') next.masks = next.masks ?? [];
  if (next.type === 'group') next.children = next.children.map(migrateLayer);
  return next;
}

/**
 * Brings a stored document up to the current schema.
 * v1 -> v2: layers gain `clip`; image layers gain `masks`.
 */
export function migrateDocument(doc: ProjectDocument): ProjectDocument {
  if ((doc.schemaVersion as number) >= CURRENT_SCHEMA) return doc;
  return { ...doc, schemaVersion: CURRENT_SCHEMA, layers: doc.layers.map(migrateLayer) };
}
