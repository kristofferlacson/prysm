import { kindOf, sectionTab } from './features/inspector/inspector';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStrictMode as setKonvaStrictMode } from 'react-konva';
import { stageRefs } from './components/canvas/stageRegistry';
import { Editor } from './components/editor/Editor';
import { useAiService } from './features/ai/aiService';
import { stageProbe, useRemovalDialog } from './features/background-removal/removalSession';
import { useBackgroundRemoval } from './features/background-removal/removeBackground';
import { useLocalTools } from './features/inpaint/contentAwareFill';
import { useAreaSelection } from './features/selection/selectionStore';
import { forceCanvas2d, meshBackend } from './features/text-warp/meshRenderer';
import { loadUploadedFonts } from './services/fonts';
import { useAssetLibrary } from './services/assets';
import { rasterStats } from './services/rasters';
import { useEditorStore } from './stores/editorStore';
import { useToolStore } from './stores/toolStore';
import { useUiStore } from './stores/uiStore';
import './index.css';

// The document is the source of truth: after every render, Konva nodes are reset to the
// values React was given, even if a drag or transform changed them on the canvas.
setKonvaStrictMode(true);

if (import.meta.env.DEV) {
  // Lets the end-to-end tests assert on document state. Not present in production builds.
  (window as unknown as Record<string, unknown>).__prysm = {
    editor: useEditorStore,
    ui: useUiStore,
    tools: useToolStore,
    backgroundRemoval: useBackgroundRemoval,
    removal: useRemovalDialog,
    removalStage: () => stageProbe.current?.() ?? null,
    selection: useAreaSelection,
    inspector: { sectionTab, kindOf },
    ai: useAiService,
    local: useLocalTools,
    rasterStats,
    assets: useAssetLibrary,
    warp: { forceCanvas2d, meshBackend },
    stageRefs,
  };
}

void loadUploadedFonts();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Editor />
  </StrictMode>,
);
