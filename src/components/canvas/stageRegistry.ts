import type Konva from 'konva';

/** Live Konva nodes that services outside the React tree (export, thumbnails, transform commits) need to reach. */
export const stageRefs: {
  stage: Konva.Stage | null;
  viewport: Konva.Group | null;
  artboard: Konva.Group | null;
  background: Konva.Rect | null;
  transformer: Konva.Transformer | null;
} = { stage: null, viewport: null, artboard: null, background: null, transformer: null };
