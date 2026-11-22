import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useStrictMode as setKonvaStrictMode } from 'react-konva';
import { Editor } from './components/editor/Editor';
import { useEditorStore } from './stores/editorStore';
import { useUiStore } from './stores/uiStore';
import './index.css';

// The document is the source of truth: after every render, Konva nodes are reset to the
// values React was given, even if a drag or transform changed them on the canvas.
setKonvaStrictMode(true);

if (import.meta.env.DEV) {
  // Lets the end-to-end tests assert on document state. Not present in production builds.
  (window as unknown as Record<string, unknown>).__prysm = { editor: useEditorStore, ui: useUiStore };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Editor />
  </StrictMode>,
);
