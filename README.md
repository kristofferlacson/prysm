# Prysm

A browser-based graphic design and image editor: a layered canvas with real blending, non-destructive image
editing, a built-in procedural texture library, editable text, and projects that reopen exactly as you left them.

"Prysm" is a working name.

**Status: Milestone 1 (core editor) is complete and tested. Milestones 2 and 3 are not started.**
See [What is not implemented](#what-is-not-implemented) before relying on anything.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

Requires Node 20+. No backend, accounts or API keys are needed: projects and uploads are stored in the browser
(IndexedDB). Web fonts are fetched from Google Fonts on first use, so text falls back to system fonts when offline.

## Test it

The tests drive the real editor in a browser (mouse, keyboard, file input, downloads) and check both the document
state and exported pixels. They use an installed Edge or Chrome through `playwright-core`; nothing is downloaded.

```bash
npm run dev          # terminal 1
npm run test:e2e     # terminal 2 — 159 checks across three suites
npm run test:visual  # optional: writes screenshots to tests/e2e/output/
```

| Suite | Covers |
|---|---|
| `tests/e2e/milestone1.mjs` | Canvas, upload, move/resize/rotate, text, shapes, selection, grouping, layer order, shortcuts, undo/redo, all 16 blend modes against the W3C formulas, adjustments, effects, crop, textures, backgrounds, save → refresh → reopen, PNG/JPG/WebP export, templates, project management, zoom/pan |
| `tests/e2e/interactions.mjs` | Multi-selection drag and resize, snapping, align/distribute, transforms through rotated and scaled groups, text resize handles, full-resolution export, slider responsiveness |
| `tests/e2e/library.mjs` | Every generator at full size, every effect on a real layer, SVG / drag-and-drop / clipboard import, group opacity, hidden layers |

The tests wipe the `prysm` IndexedDB database for `localhost:5173` in the test browser profile (a throwaway profile,
not your own browser).

## How it works

**The document is the source of truth.** A project is a plain, serialisable `ProjectDocument`: canvas size,
background fill and a tree of layers (`image`, `text`, `shape`, `group`). It lives in a Zustand store, is never
mutated in place, and is what gets saved. Konva only draws it. When you drag or resize on the canvas, the result is
read back from the Konva node once, written into the document, and the canvas re-renders from that.

**Undo/redo** stores previous documents. Because updates share unchanged layers structurally, a history entry costs
almost nothing. Rapid edits with the same key (a slider drag, typing, arrow-key nudges) collapse into one step.

**Blending is real compositing.** Every layer draws into a single Konva layer inside a clipped artboard group, so a
blend mode composites against the actual pixels beneath it (other images, textures, the background). Groups with
opacity or a blend mode use Konva's isolated groups, so they fade and blend as one image. Export draws the same
nodes, so the file matches the screen.

**Image editing is non-destructive.** An image layer stores its source reference plus crop, adjustments and an
effect list. `features/image-editing/pipeline.ts` turns those into a bitmap: crop → one-pass colour adjustments
(lookup tables + a combined colour matrix) → effects. The original is never modified. The editor renders at up to
1600 px for speed; export re-renders from the original at up to 4096 px.

**Textures, overlays and generated backgrounds are code, not files.** Each is a small seeded drawing routine
(`features/generators`). A texture layer stores the generator id, a seed and a palette, so it is original,
licence-free, recolourable, resolution independent and adds nothing to the saved project but a few numbers.

**Persistence sits behind an interface.** `ProjectRepository` is implemented on IndexedDB today. A Supabase
implementation can replace it without touching the editor. Uploaded files are stored untouched as blobs and
referenced by id.

### Layout

```
src/
  types/document.ts            The document model: every layer type, fills, effects, crop
  stores/editorStore.ts        Document, selection, history, clipboard and every editing action
  stores/uiStore.ts            View state: zoom, pan, tool, open panel, dialogs
  features/
    document/                  Layer factories and pure tree operations (group, reorder, align…)
    image-editing/             Adjustment maths, the render pipeline, the hook that feeds Konva
    effects/                   The 20 raster effects
    generators/                Noise, plus texture / overlay / background generators
    library/insert.ts          One entry point for "put this on the canvas" (click, drag, drop, paste)
    projects/                  Autosave, open/new/duplicate/delete, canvas size presets
    templates/                 Starter layouts built from ordinary layers
  services/
    storage/                   IndexedDB wrapper and the ProjectRepository
    assets.ts                  Uploaded image store and decode cache
    fonts.ts                   Font catalogue and on-demand loading
    export.ts                  Render the document to PNG / JPG / WebP, thumbnails
  components/
    canvas/                    Stage, layer nodes, transform read-back, snapping, text editor, rulers
    editor/                    Shell, top bar, keyboard shortcuts
    sidebar/                   The ten asset panels
    properties/                Context-sensitive property editors
    layers/                    Layers panel
    dialogs/                   Export and Projects
    ui/controls.tsx            Shared form controls
```

## What works (Milestone 1)

- **Canvas** — custom size and presets, zoom (Ctrl+wheel, buttons, Ctrl+0/1/±), pan (wheel, Space-drag, hand tool,
  middle mouse), rulers, optional grid, transparency checkerboard.
- **Objects** — images, text and shapes; drag, resize, rotate, flip, duplicate, copy/paste, delete, lock, hide,
  opacity; multi-select by Shift-click or marquee; group/ungroup; z-order; align and distribute; snapping to the
  canvas and to other layers with guides; arrow-key nudging.
- **Images** — PNG, JPG, WebP, SVG by file picker, drag-and-drop or clipboard paste. Crop (numeric), 13 adjustments
  with per-slider and global reset, border, rounded corners, drop shadow, restore original.
- **Blending** — all 16 modes, verified numerically against the reference formulas.
- **Effects** — 20 one-click effects with adjustable intensity, stackable, removable.
- **Textures / overlays / backgrounds** — 35 textures, 14 overlays, 10 generated backgrounds; searchable and
  filterable; added as editable layers with a suggested blend mode; recolour and re-roll variations. Solid,
  linear-gradient and radial-gradient canvas backgrounds with a custom gradient editor.
- **Text** — edit on the canvas, 39 fonts with search and categories, size, weight, italic, underline, alignment,
  letter spacing, line height, solid or gradient colour, outline, shadow. Side handles re-wrap, corner handles
  scale. Text stays text after saving.
- **Shapes** — rectangle, ellipse, triangle, polygon, star, line, arrow, frames; fill, gradient, stroke, corner
  radius, shadow.
- **Projects** — autosave, restore after refresh, new / open / rename / duplicate / delete, thumbnails.
- **Export** — PNG, JPG, WebP; 0.5×–4× or a custom width; quality; transparent background.
- **Templates** — six starter layouts made of editable layers.

Shortcuts: Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / X / V / D, Delete, Ctrl+G / Ctrl+Shift+G, Ctrl+A, Ctrl+] / [,
arrows (Shift = 10 px), Ctrl+S, V / H, Space. None fire while typing in a field.

## What is not implemented

These are labelled "Not implemented" in the interface. None of them are simulated.

| Area | Missing | Needs |
|---|---|---|
| AI | Background removal, subject selection, object removal, generative fill, expand, upscale, generate | A segmentation model in the browser or hosted APIs behind a server that holds the keys |
| Masks | Layer masks, clipping masks, erase/restore | A mask on the layer model and in the render pipeline |
| Tools | Selections (rectangle, ellipse, lasso, wand), brush, eraser, gradient, eyedropper, clone, blur brush | A raster layer type |
| Text | Curved text, text on a path, warping, neon / metallic / 3D presets, text background | |
| Assets | Stock photos, icons, stickers, illustrations | A provider API (photos); a licensed SVG set and an SVG layer type (icons) |
| Export | PDF, SVG, selected layers only | |
| Cloud | Accounts, cloud storage, sharing, version history, collaboration | Supabase |

## Known limitations

- A full-canvas texture or overlay on top catches clicks. Lock it in the Layers panel to click through.
- Crop uses sliders; there are no crop handles on the canvas yet.
- Snapping applies when dragging a single layer, not while resizing or dragging several.
- Effects and adjustments apply to image layers (including textures), not to text or shapes.
- Stretching a group non-uniformly and then ungrouping cannot preserve the skew of rotated children; they are
  approximated. Uniform scaling round-trips exactly.
- Colour pickers have no alpha channel; use layer opacity.
- Dragging rows in the Layers panel reorders within one level; it does not move layers into or out of groups.
- Image processing and texture generation run on the main thread. A slider update on a 2400 px photo takes roughly
  80–100 ms and the slowest texture about 0.7 s to generate. Workers or WebGL would be the next step.
- Undo history is per session (100 steps) and is not saved with the project. "Remove images no project uses" can
  leave an undo step pointing at a removed image, which then shows as a placeholder.
- Template cards show a colour sketch rather than a rendered preview.
- Mouse and keyboard only; no touch gestures.

## Suggested next steps (Milestone 2)

1. Layer masks in the document model and pipeline — the prerequisite for background removal, clipping masks and
   erase/restore.
2. In-browser background removal writing into that mask.
3. A raster paint layer with brush and eraser, then selection tools.
4. On-canvas crop handles; snapping while resizing.
5. Move the image pipeline and generators to a Web Worker.
6. PDF export, SVG import as vector layers, curved text.
