import type { Layer, ProjectDocument } from '../../types/document';
import { migrateDocument, migrateLayers } from '../../features/document/migrate';
import { collectDocumentRasterIds, collectRasterIds } from '../../features/document/operations';
import { dbDelete, dbGet, dbGetAll, dbPut } from './db';

export interface ProjectRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  updatedAt: number;
  thumbnail: string | null;
  doc: ProjectDocument;
}

export type ProjectSummary = Omit<ProjectRecord, 'doc'>;

/**
 * Persistence boundary for projects. The editor only talks to this interface,
 * so a cloud implementation (e.g. Supabase) can replace the local one later.
 */
export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<ProjectDocument | null>;
  save(doc: ProjectDocument, thumbnail: string | null): Promise<void>;
  remove(id: string): Promise<void>;
  /** Asset ids referenced by every stored project. */
  referencedAssetIds(): Promise<Set<string>>;
  /** Raster ids (masks, paint layers) referenced by every stored project. */
  referencedRasterIds(): Promise<Set<string>>;
}

function collectAssetIds(layers: Layer[], out: Set<string>) {
  for (const l of layers) {
    if (l.type === 'image' && l.source.kind === 'asset') out.add(l.source.assetId);
    if (l.type === 'group') collectAssetIds(l.children, out);
  }
}

export const localProjectRepository: ProjectRepository = {
  async list() {
    const all = await dbGetAll<ProjectRecord>('projects');
    return all
      .map(({ doc: _doc, ...summary }) => summary)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async load(id) {
    const rec = await dbGet<ProjectRecord>('projects', id);
    return rec ? migrateDocument(rec.doc) : null;
  },

  async save(doc, thumbnail) {
    const updatedAt = Date.now();
    const existing = thumbnail === null ? await dbGet<ProjectRecord>('projects', doc.id) : undefined;
    await dbPut<ProjectRecord>('projects', {
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      updatedAt,
      thumbnail: thumbnail ?? existing?.thumbnail ?? null,
      doc: { ...doc, updatedAt },
    });
  },

  async remove(id) {
    await dbDelete('projects', id);
  },

  // Saved assets ("My assets") keep the images and bitmaps they use alive, just as projects do.
  async referencedAssetIds() {
    const all = await dbGetAll<ProjectRecord>('projects');
    const ids = new Set<string>();
    for (const rec of all) collectAssetIds(rec.doc.layers, ids);
    for (const saved of await dbGetAll<{ layers: Layer[] }>('library')) collectAssetIds(saved.layers, ids);
    return ids;
  },

  async referencedRasterIds() {
    const all = await dbGetAll<ProjectRecord>('projects');
    const ids = new Set<string>();
    for (const rec of all) collectDocumentRasterIds(migrateDocument(rec.doc), ids);
    for (const saved of await dbGetAll<{ layers: Layer[] }>('library')) collectRasterIds(migrateLayers(saved.layers), ids);
    return ids;
  },
};

export const projectRepository: ProjectRepository = localProjectRepository;
