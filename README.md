# Prysm

A browser-based graphic design and image editor: a layered canvas with real blending, non-destructive image
editing and masking, selection tools, in-browser background removal and subject selection, painting, a built-in
procedural texture library, editable text, optional generative AI through a small server that keeps the API key
out of the browser, and projects that reopen exactly as you left them.

"Prysm" is a working name.

**Status: the core editor, masking / painting / background removal / clipping, the creative tools, and the
selection tools are complete and tested. The generative AI tools are built and tested end to end against a
stand-in for the provider, but have not been run against the real provider (no API key was available).** See
[What is not implemented](#what-is-not-implemented) before relying on anything.

## Run it

```bash
npm install
npm run setup:ai   # once: downloads the background-removal, object-finding and upscaling models (about 68 MB) into public/models
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run server     # optional: the AI server (see "Generative AI" below); also serves dist/ if it exists
```

Requires Node 20+. No backend, accounts or API keys are needed for the editor itself: projects, uploads, masks and
paint are stored in the browser (IndexedDB). Only generative fill, object removal and image generation need the
AI server and a provider key; without them those three controls are disabled and say so. Web fonts are fetched from Google Fonts on first use, so text falls back to system fonts
when offline. Everything except background removal works without `setup:ai`; without it that one feature reports
that the model is missing (and without the object-finding model, its dialog still works with the brushes).

## Test it

The tests drive the real editor in a browser (mouse, keyboard, file input, downloads) and check both the document
state and exported pixels. They use an installed Edge or Chrome through `playwright-core`; nothing is downloaded.

```bash
npm run dev          # terminal 1
npm run test:e2e     # terminal 2 — 1161 checks across eighteen suites (needs port 8787 free)
npm run guide:demos  # optional: re-records the guide's demonstration videos from the running editor
npm run test:perf    # large images, many masked layers, long undo chains (18 checks, prints timings)
npm run test:visual  # optional: writes screenshots to tests/e2e/output/
```

Every suite except `navigation.mjs` opens the editor with the right-hand panel on its "All" tab (every section in
one list), so a test can reach any control directly and says what the control does, not where it is. Where things
are, and how the panel follows what you do, is what `navigation.mjs` tests, in the default tabbed view on a
1366 × 768 window. `production.mjs` also goes through the tabs.

| Suite | Covers |
|---|---|
| `milestone1.mjs` | Canvas, upload, move/resize/rotate, text, shapes, selection, grouping, layer order, shortcuts, undo/redo, all 16 blend modes against the W3C formulas, adjustments, effects, crop, textures, backgrounds, save → refresh → reopen, PNG/JPG/WebP export, templates, project management, zoom/pan |
| `interactions.mjs` | Multi-selection drag and resize, snapping, align/distribute, transforms through groups, text resize handles, full-resolution export |
| `library.mjs` | Every generator at full size, every effect on a real layer, SVG / drag-and-drop / clipboard import, group opacity, hidden layers |
| `masks.mjs` | Add / paint / invert / disable / view / compare / feather / reset / apply / delete masks; masks through move, resize, rotation, flip and crop; brush and eraser settings; paint layers; undo/redo; storage and clean-up; opening a project saved before masks existed |
| `mask-geometry.mjs` | The mask coordinate system: the same picture at 300 px, 1200 px and 4800 px gets the same mask edges (located to sub-pixel accuracy in exported files) after move, resize, rotation, flip and crop, at 0.5× / 2× / 3× export, on screen, with feathering, inside transformed groups, and from background removal |
| `background-removal.mjs` | The real models end to end. The dialog: the suggestion as a selection, progress, responsiveness, nothing changed until Apply; clicking objects to add them to the selection and take them away (modes, Shift / Alt, a point per click, undo and redo), the brush, select all / clear / invert / reset, the selection kept or removed, the three views, cancelling, re-editing a cut-out, no outline left by a removed object. Then the resulting mask, refinement with brush and eraser on the canvas, model switching, missing models (the subject finder and the object finder), unusable images, save/reopen |
| `clipping.mjs` | Clip to shape, text, masked image and group; with opacity and blend modes on both sides; move, hide, release, undo; save/reopen; transparent export |
| `compositing.mjs` | Mask coverage × opacity × all 16 blend modes against the reference formulas; clipping + mask + blend; groups; whole-image comparison of exports across scales, formats, zoom levels, editor overlays, undo/redo and save/reopen |
| `text-warp.mjs` | Text warp: every preset against its formula in exported pixels (to 0.02 px at 2×), true circular arcs, bend and distortion, dragging the custom envelope's points, editing / restyling / moving / resizing / rotating warped text, blend modes, opacity, shadow and clipping on it, sharpness at 2×, save/reopen, projects saved before warp existed, and the renderer used when WebGL is unavailable |
| `ui.mjs` | Interface size (Compact / Comfortable / Large): control sizes, no clipped labels or overflow, pointer accuracy on the canvas at each size, persistence; the editor's own confirm dialog for replacing a design and deleting a project (Cancel, Escape, Enter, shortcuts held meanwhile), and that no browser dialog ever appears |
| `milestone3.mjs` | Text effects (glow, 3D depth, metallic shine, distress) measured in exported pixels; text on a curve and around a circle; effect styles; icons and code-drawn graphics as vector layers (recolour, resize, opacity, shadow, stretch); "My assets" across projects and reloads; the 11 new image effects, custom duotone inks, looks; pattern backgrounds; composition guides, safe-margin and equal-spacing snapping; hiding and resizing panels; the nine new templates; save/reopen; projects saved before Milestone 3 |
| `creative-tools.mjs` | Effect stack (switch off, reorder, undo, save); vibrance, colorize, motion blur; Bloom and Light streaks on a picture with one white, one grey and black areas (light spills from the bright part only; far and dark areas unchanged; strength; direction; the picture underneath stays as it was; save and reopen) and the Luminous look; the added textures and overlays and the full texture workflow; text background, vertical text, uploaded fonts across a reload; recent colours, RGB values; favourites, recent assets, licence details, lazily drawn previews; dashed and dotted outlines; PDF export (structure, page size, embedded image); the added templates |
| `selection.mjs` | Marquee (rectangle, ellipse), lasso, magic wand (tolerance, contiguous, one layer or all), add / subtract / intersect, select all / invert / deselect, feather / expand / contract, the moving outline; selection to mask, hide area, copy and cut to a new layer (incl. rotated layers), fill, painting kept inside a selection, select layer, select subject with the real model |
| `editing.mjs` | Levels (black / white points, midtones, output range, Auto, histogram) and curves (adding, dragging and removing points, per-channel curves, end points) against the expected tone values in exported pixels; the vignette colour; crop shapes; cropping on the canvas (sides, corners, moving the frame, held shapes, Enter / Esc / C, rotated layers); background removal on a plain backdrop (a logo on white and on a colour, as PNG and JPEG: backdrop gone everywhere, enclosed white kept, clean edges, forcing either method); background blur (subject sharp, background detail gone, no halo, blur still adjustable); blend-mode shortcuts (Screen and Multiply on a silhouette picture, several layers, nothing selected); folded text (size and band measured in exported pixels, its sliders, retyping, save and reopen, the FOLDED style); Fade (from a side: solid, half-way and gone at the expected places; several sides at once; one and several corners; all round; any angle; where it begins and stops; strength; reversed; along a shape drawn with the marquee, which moves with the layer, is cut by a crop, combines with sides, with a mask and with a blend mode; live on the canvas; save and reopen; a project saved with the earlier straight or oval fade opens looking the same; "Fade along selection"; painting the fade (from an image without a fade; a stroke fades where it passes and nowhere else; brush Opacity; eraser and Alt bring the image back; Strength, Reverse, sides, crop and Expand with painting; the four ways of leaving the mode; save and reopen; "Clear painting")); text in the shape of a layer (the letters reach the outline of an ellipse and of a cut-out picture column by column, retyping, save and reopen) |
| `home-guide.mjs` | The home page (start from a size, a template or a recent project; back and forward; reload) and the guide (search, topics, "show me", F1, the "?" links). Also checks the guide against the interface: every button or label it quotes must exist in the source, and every topic must have a demonstration video that loads, plays, changes as it plays, and has captions in order |
| `navigation.mjs` | The right-hand panel in its default tabbed view on a laptop-sized window: the tabs of a photo, text, a shape, a texture, several layers, the canvas, and of an area selection; every section in exactly one tab and nothing missing against "All"; each tab at most half the height of the single list; the tab bar staying put and never covering what is scrolled to; adding an effect or a look, pressing C, and "Fade along selection" each opening the right tab on the right control, in view and highlighted; the same in "All" by scrolling; a new layer opening on its own main tab; the tab remembered per kind of layer and across reloads; and seven common tasks done from start to finish through the tabs and checked in the document and in exported pixels |
| `local-tools.mjs` | The tools that need no AI service. Content-aware fill: an object removed from a striped wall and from a gradient, the stripes and gradient continuing through, undo. Expand: fill the canvas in one click, chosen sides, rotated / cropped / masked / paint layers, the original pixels staying put. Upscale with the real model: 4× and 2×, sharper than plain enlargement, no tile seams, transparency, cancel, save and reopen. Polygonal lasso (double-click, Enter, first corner, Backspace, Escape, Shift). Saved selections (save, load, add, rename, delete, undo, reopen, resized canvas) and upgrading a project from the previous format |
| `ai.mjs` | The AI server against a local stand-in for the provider (no real provider is called): offline / no key / ready states in the interface, generative fill (the picture, mask, prompt and key that reach the provider; the masked result layer; undo, save, reopen), object removal, image generation, provider errors, the key never reaching the browser, input validation, CORS, rate limiting, path traversal |
| `performance.mjs` | A 24-megapixel photo, 30-stroke undo chain, nine masked layers |
| `production.mjs` | The built app (`npm run preview`): worker, WebAssembly and masks without the test hook |

The tests wipe the `prysm` IndexedDB database for the test browser's throwaway profile, not your own browser's.

## How it works

**The document is the source of truth.** A project is a plain, serialisable `ProjectDocument`: canvas size,
background fill and a tree of layers (`image`, `text`, `shape`, `group`). It lives in a Zustand store, is never
mutated in place, and is what gets saved. Konva only draws it. When you drag or resize on the canvas, the result is
read back from the Konva node once, written into the document, and the canvas re-renders from that.

**Undo/redo** stores previous documents. Updates share unchanged layers structurally, so a history entry costs
almost nothing. Rapid edits with the same key (a slider drag, typing, nudging) collapse into one step.

**Pixels the document owns live in the raster store.** Masks and paint layers are bitmaps, and bitmaps do not
belong in an undo history. So every such bitmap is an immutable *raster* with an id (`services/rasters.ts`); the
document only holds the id. A brush stroke, an invert or a background removal creates a new raster and points the
document at it, which makes every pixel edit an ordinary undoable document change. Each raster is also encoded to
PNG, so old undo states can drop their canvas from memory (a 48-megapixel budget) and be decoded again on demand,
and rasters referenced by a saved project are written to IndexedDB. Rasters nothing references are deleted on the
next start.

**Image editing is a non-destructive pipeline.** An image layer stores a source reference plus crop, adjustments,
effects and masks. `features/image-editing` turns those into the bitmap Konva draws:

```
source (upload | generated texture | paint raster)
   -> crop -> colour adjustments -> effects          cached
   -> masks                                          cheap; repeated on every painted frame
```

The original is never modified. The editor renders at up to 1600 px for speed; export re-renders from the original
at up to 4096 px.

**Masks live in source space.** A `LayerMask` is a coverage bitmap that spans the unit square of the layer's
*uncropped source image*: (0,0) is the source's top-left corner, (1,1) its bottom-right. The bitmap's own pixel
size is only a sampling density. Everything follows from that one definition, which lives in
`features/masks/maskSpace.ts` and is the only place the mapping is written down:

- Move, resize, rotate, flip: the layer's transform carries image and mask together; the mask is not touched.
- Crop: selects the same sub-rectangle of the image and of the mask.
- Resolution: a mask's density is independent of the image's (between 1024 and 2048 px on the longer side), so a
  small image shown large still gets smooth mask edges and a 24-megapixel photo's mask stays light.
- Feather is a fraction of the *source's* longer side, so it is a property of the image: it does not change when
  the layer is cropped, and it scales with the layer.
- Preview, full-quality export and every export scale agree, because nothing is expressed in output pixels.

Measured by `mask-geometry.mjs`: the same stroke on a 300 px, a 1200 px and a 4800 px copy of a picture gives mask
edges within 0.6 px of each other and of where the pointer was; a 320 px and a 1920 px copy of a photo get
background-removal cut-outs that differ by 0.05 px.

Coverage is stored in the alpha channel — opaque reveals, transparent conceals, in between is partial — and shown to
the user as the familiar white / black / grey. `masks` is a list on the layer (coverage multiplies), so more than
one mask per layer needs no model change; the interface currently manages the first.

**Painting.** The brush and eraser (`features/paint`) never edit a stored bitmap. A stroke draws evenly spaced,
stabilised dabs into a stroke buffer, composites `base + buffer × opacity` into a working copy for the changed
rectangle only, and shows that copy live through a paint session. When the stroke ends the copy becomes a new
raster. What a stroke edits is decided in one place (`resolvePaintTarget`) and always shown in the tool bar:

| Tool | Selected layer | Edits |
|---|---|---|
| Brush | mask is the edit target | the mask (white reveals, black hides; X swaps) |
| Brush | a paint layer | the paint |
| Brush | anything else / nothing | a new paint layer, created for the stroke |
| Eraser | an image with a mask | the mask (hide, or restore) |
| Eraser | an image without a mask | a mask added automatically, so no pixel is destroyed |
| Eraser | a paint layer | the paint (undo restores it) |

**Background removal** runs a salient-object segmentation network in a Web Worker with ONNX Runtime
(WebAssembly). The image is resized to the network's input, the prediction is scaled up, snapped to edges in the
photo with a guided filter, and stored as the layer's mask. Nothing is uploaded, the layer's pixels are untouched,
and the result is refined, compared, disabled or undone like any other mask.

**Blending and clipping are real compositing.** Every layer draws into a single Konva layer inside a clipped
artboard, so a blend mode composites against the actual pixels beneath it. Groups with opacity or a blend mode use
Konva's isolated groups. A clipping mask is a per-layer flag, "clip to the layer below": a base and the layers
clipped to it render inside one isolated group, clipped layers with `source-atop`. A clipped layer that also has a
blend mode is first cut to the base's shape in its own isolated group and then blended, because a canvas blend mode
on its own would paint outside the base. Export draws the same nodes, so the file matches the screen.

**Text warp is a mapping, not a redraw of the letters.** A text layer may carry a `warp`: a preset shape with a
bend amount, or a 4 × 4 Bézier patch whose edge points are dragged on the canvas (`features/text-warp`). The text
is first set flat by the same Konva text node used for unwarped text, so fonts, wrapping, gradients and outlines are
identical; that image is then stretched over a fine triangle mesh whose vertices the warp has moved. WebGL 2 does
the resampling (a Canvas 2D path covers browsers without it). The flat image is made at the size it will be seen
at — the zoom on screen, the export scale in a file — and supersampled by a whole factor where the warp enlarges
it. The layer stays a text layer: double-click still edits the words, and everything that applies to text applies
after the warp (blend mode, opacity, shadow, clipping). Everything in a warp is relative to the text box, so it
follows the layer when it is resized.

**Text effects and text on a path build on the same picture.** A text layer that needs more than plain vector
text (a path, a warp, or any effect) is drawn by `features/text-warp/renderText.ts`: the text is set flat or
along its path, warped if it has a warp, and then given its effects, all at the size it is shown or exported at.
Effects are settings on the layer (`effects: { glow, extrude, bevel, distress }`), sized as fractions of the font
size, and they work on the finished outline, so a glow follows warped or curved text. Text on a path uses Konva's
glyph placement (`path: curve | circle`); a curve's four points are dragged on the canvas.

**Icons and graphics are vector layers, not images.** They are shape layers (`shape: 'icon' | 'graphic'`). An
icon is one SVG path stroked straight onto the canvas (157 icons from Lucide, converted by
`scripts/build-icons.mjs`). A graphic — sticker, frame, illustration, geometric element — is a drawing routine
in `features/library/graphics` with a palette of colour slots; it is drawn into its own picture at display size so
that opacity, blending and shadows treat it as one object. Both recolour and resize without loss.

**Looks are values, not filters baked in.** A look (`features/effects/looks.ts`) sets a layer's adjustments and
effects in one undo step. Afterwards every slider is still there, and removing the look restores the original.

**The interface scales as a whole.** Bars, panels and dialogs are laid out once at a compact size and scaled with
CSS `zoom` (`.ui-scale`, three sizes in the top bar's View menu). The canvas is never scaled this way, so pointer
positions on it stay exact. Questions ("replace this design?", "delete this project?") are asked in the editor's
own dialog (`askConfirm`), never the browser's.

**Textures, overlays and generated backgrounds are code, not files** (`features/generators`): seeded drawing
routines stored in the document as a recipe.

**Persistence sits behind an interface.** `ProjectRepository` is implemented on IndexedDB today; a Supabase
implementation can replace it. Documents carry a schema version (now 6; v5 added saved selections, v6 turned an image's fade into a set of parts) and are migrated on load (v1 → v2 added masks and
clipping; v2 → v3 added text warp; v3 → v4 added text effects and text paths). "My assets" live in their own
IndexedDB store and keep the images and bitmaps they use from being cleaned up.

### Layout

```
src/
  types/document.ts            The document model: layers, fills, effects, crop, masks, clip, text warp
  stores/                      editorStore (document, selection, history), uiStore (view), toolStore (brush, paint session)
  features/
    document/                  Layer factories, pure tree operations, schema migration
    image-editing/             Adjustments, the render pipeline (incl. mask compositing), the hook that feeds Konva
    masks/                     maskSpace (the coordinate system), mask operations, edit-target guard
    paint/                     Brush tip, stroke smoothing, paint controller
    text-warp/                 Warp shapes, text paths, text effects, mesh renderer (WebGL 2 / Canvas 2D), renderText
    library/                   insert.ts (one entry point for "put this on the canvas"), icons, graphics/ (code-drawn art),
                               usage.ts (asset details and licence, favourites, recently used)
    effects/                   The 36 raster effects and the looks
    background-removal/        Model registry, worker, edge refinement, the removal flow
    selection/                 The area selection (a coverage bitmap in document space), magic wand, conversion to
                               and from layer space, and the commands that use a selection
    ai/                        Client for the AI server, generative fill / object removal / image generation
    inpaint/                   Content-aware fill (PatchMatch) in a worker; filling a selection; expanding an image
    upscale/                   The Real-ESRGAN upscaler in a worker (tiled), and the layer command
    crop/                      Crop shapes and the geometry of dragging a crop frame
    guide/                     The in-app guide: one how-to entry per feature, and which entry each panel links to
    inspector/                 How the right-hand panel is organised: the tabs of each kind of selection, and which
                               tab every section belongs to
    generators/                Noise, plus texture / overlay / background generators
    projects/                  Autosave, open/new/duplicate/delete, clean-up
    templates/                 Starter layouts
  services/
    rasters.ts                 Immutable bitmap store for masks and paint
    assets.ts                  Uploaded image store
    designLibrary.ts           "My assets": saved, reusable layers
    fonts.ts                   Built-in font list, loading, and uploaded fonts
    storage/                   IndexedDB wrapper and the ProjectRepository
    fonts.ts, export.ts
  components/
    canvas/                    Stage, layer nodes and clipping groups, paint overlay, HUD, text editor, warp handles, rulers
    editor/, sidebar/, properties/, layers/, dialogs/, ui/
server/                        The AI server: holds the provider key, validates and forwards requests (no dependencies)
scripts/setup-ai.mjs           Downloads and verifies the segmentation models
scripts/build-icons.mjs        Regenerates the icon data from the installed Lucide package
scripts/build-guide-demos.mjs  Records the guide's demonstration videos from the running editor
```

## What works

### Finding your way around: the right-hand panel

The panel on the right shows the settings of whatever is selected. It used to be one list of up to fifteen
sections (about five screens on a laptop), so the control for something you had just added was usually far out
of sight. It is now organised so that one group of related settings is on screen at a time and the panel goes to
what you are working on by itself.

- **Tabs by kind of layer.** A photo: Adjust (adjustments, levels, curves), Effects, Cut out (mask with background
  removal, fade), Layout (arrange, position and size, crop, expand, upscale) and Style (opacity and blending,
  corners, border, shadow). Text: Text (typography, colour, outline), Effects (text effects, warp, text on a
  path), Layout, Style. A shape: Shape, Layout, Style. A texture or overlay opens on Style, where its colours and
  blending are. Several layers, or a group: Layout and Style. Layout and Style hold the same things for every
  kind. Every section is in exactly one tab; the tab bar stays in place while a tab scrolls.
- **What you add opens its own settings.** Adding an effect or a look from the left opens the Effects tab on that
  effect, scrolled into view and highlighted for a moment; C opens Layout on Crop; "Fade along selection" and
  "Paint the fade" open Cut out on Fade; choosing a layer's mask opens Cut out on Mask; a layer that has just been
  added opens on its own main tab. (`revealSection` in `stores/uiStore.ts`; anything new that has settings in
  the panel should call it.)
- **Select tab.** While a selection tool is active or an area is selected, a Select tab holds everything that can
  be done with the selection, instead of that being stacked on top of the layer's settings. It opens by itself
  when a selection tool is picked and goes away with the selection.
- **All.** The last tab shows every section in one list, as before, for those who prefer it; there, adding
  something scrolls the list to it instead of changing tab.
- **Remembered.** The tab last used for each kind of layer is kept (in this browser), so going from a photo to
  text and back returns to where you were.
- The wording around the editor names the tab where it used to say "on the right": the guide's steps, the hints in
  the Effects, Elements, Text and AI tools panels, and the demonstrations, which were recorded again in the new
  layout. A new guide entry, "Finding your way around", explains the whole screen.

Nothing was removed or renamed: every section, control and label is the one it was, saved projects are untouched
(the layout is not part of a project), and `features/inspector/inspector.ts` is the one place that says which
section goes where.

### Home page and guide

- The app opens on a **home page** (`#/`): continue the open design, start a new one from a size or a template
  (a template now starts its own project), or reopen a recent project. The Prysm logo in the editor's top bar
  goes back to it; the editor's address is `#/editor`, so reloading and the browser's Back button behave.
- **Guide** (the "?" in the top bar, F1, or "How to use it" on the home page): a searchable how-to for every
  feature, written as numbered steps in the interface's own words, with shortcuts and a "show me" button that
  picks up the tool or opens the panel. Every side panel and every section of the right-hand panel has a small
  "?" that opens the guide at its entry. A test fails if the guide quotes a button or label that no longer exists.
- **Demonstrations**: every guide entry plays a short **recording of the editor doing the task**: the pointer moves
  to each control and clicks it, sliders travel, keys that are pressed are shown, and a caption follows the action.
  It plays by itself and loops; it can be paused, stepped from caption to caption, scrubbed, and enlarged to fill
  the window. The recordings are real: `npm run guide:demos` drives the editor through all 51 tasks with
  Playwright, records each one, trims it to the demonstration itself and compresses it (WebM / VP9) into
  `public/guide/`. Run it again (all topics, or `npm run guide:demos -- crop mask`) when the interface changes.

### Blending images with Fade, and text in the shape of a picture

- **Fade** (Image properties): the image becomes gradually transparent so it melts into whatever is underneath.
  This is the direct way to blend two photos into one. A fade is built from parts, and any number of them can be
  on at once: each of the four sides, each of the four corners (a curved fade around that corner), "all round" (an
  oval that keeps the middle), one straight fade at any angle ("Any direction"), and one shape of your own. Where
  parts overlap they multiply. Three sliders apply to all of them, measured inwards from the side, corner or
  outline: "Begins at" (up to here the image is fully faded), "Reaches to" (from here on it is untouched) and
  Strength (how transparent the faded part gets: 100 is gone, less only softens it). Reverse swaps what is kept
  and what is faded.
  - *Your own shape:* draw it with any selection tool (marquee, lasso, polygon, magic wand, Select subject) and
    press "Use the selection" (or "Fade along selection" in the Selection panel). The image shows inside the shape
    and fades at its outline; for the shape, the sliders are a share of the way from the outline to its deepest
    point, so a small shape and a large one fade alike. The shape is stored with the layer in the layer's own
    space, like a mask (it moves, turns, scales and is cropped with it, and Expand keeps it in place), so the
    selection is not needed afterwards.
  - *Painted by hand:* "Paint the fade" picks up the brush and from then on a stroke fades the image where it
    passes, by as much as the brush's Opacity; the eraser, or the brush with Alt held, brings the image back.
    Size, Hardness, Opacity and Flow are the ordinary brush settings, so a soft brush at a low Opacity builds
    the fade up like shading. A bar over the canvas says that the fade is being painted; "Done painting", Done
    in that bar, Esc, or selecting another layer ends it. The strokes are stored with the layer in its own
    space, like a mask, as one more part of the fade: they combine with sides, corners and a shape, Strength and
    Reverse apply to them, "Begins at" and "Reaches to" do not. "Clear painting" removes them. An image without
    a fade can start straight from "Paint the fade", which gives it a fade made of painting only.
  - It is a setting on the layer: no pixels change and it can be switched off. It is applied after the layer's
    mask, before the blend mode and opacity, and it is measured across what is visible of the image, so it follows
    a crop. Canvas, saved projects and exports all draw it from the same code.
  - Projects saved with the first version of Fade (one straight line or one oval) are converted when opened and
    look the same.
- **Bloom** and **Light streaks** (Effects → Lighting): light that comes from the bright parts of a picture only.
  Bloom takes everything above a middle brightness, blurs it at two widths and adds it back, so the light spills
  over its surroundings and burns out towards white while the dark parts stay dark (the existing Glow softens
  the whole picture instead). Light streaks smears the same bright parts along a direction and adds only the
  light that has travelled, so the picture stays sharp underneath. Both are ordinary effects in the layer's
  stack (strength, on/off, order, removable; Light streaks also has a Direction). The **Luminous** look sets
  black and white, Bloom, Light streaks and grain in one click. Together with the Light rays overlay, Levels
  and Noise this covers the "glowing subject on a dark poster" recipe.
- **Fit text to this shape** (Text → Warp → "Shape of another layer"): the text is stretched to fill the outline of
  another layer (a cut-out photo, a shape, an icon, a sticker), so a word takes the shape of a picture. The other
  layer is reduced to its top and bottom edge at 160 positions across its width; the letters are spread across the
  width and stretched between those two edges. Only the two curves are stored, in units of the text's width, so
  the result scales with the layer, and the text stays text: retyped words fill the same shape, always on one line.

### Folded text and blend shortcuts

- **Fold** (Text effects, and the FOLDED style in the Text tab): the word is cut along a horizontal line, the lower
  part drops and grows, and each stroke the cut passes through is joined to its other half by a slanted strip in a
  lighter or darker tone of the text's own colour. Cut at, Drop, Spread and Band tone are sliders; the text stays
  text, and glow, 3D depth and the background panel follow the folded shape.
- **Blend-mode shortcuts**: Alt + Shift + a letter sets the blend mode of the selected layers, with the letters
  Photoshop uses (N normal, M multiply, S screen, O overlay, F soft light, H hard light, K darken, G lighten,
  D colour dodge, B colour burn, E difference, X exclusion, U hue, T saturation, C colour, Y luminosity). Screen on
  a black-on-white picture shows the layer below through its black ("blend on white"); Multiply keeps the black
  and drops the white ("blend on black").

### Background removal: two methods

Background removal now chooses between two ways of finding the background (AI tools tab → Method):

- **Plain background** (logos, icons, illustrations, product shots): when the border of the picture is one colour,
  exactly that colour is removed, starting from the edges. Areas of the same colour enclosed by the artwork (the
  white of an eye, the inside of a letter) are part of the artwork and are kept, and the edge is softened by one
  pixel in proportion to how far each rim pixel is from the backdrop colour, so there is no fringe. It is instant
  and needs no model.
- **Find the subject** (photos): the segmentation model, as before.
- **Automatic** (the default) uses the first when at least 95% of the picture's border is within 12 levels of one
  colour, and the model otherwise. The reason for this: the model is trained on photographs, and on flat artwork
  it guesses a soft outline and leaves patches of the backdrop behind.

"Select subject" and "Blur background" use the same choice.

### Background removal: choosing what is removed

"Remove background" does not apply its result straight away. It opens a dialog with the picture, in which things
are **selected by clicking them**: what is selected is tinted green and outlined, and a point marks every click.
It opens with the automatic result (the subject) already selected. Nothing in the design changes until Apply.

- **Click objects**: a click selects the whole thing under the pointer and adds it to the selection. Pointing at a
  thing first shows what the click would take. Clicking several things, or several parts of one thing, builds the
  selection up. **Take away** (or Alt held) makes a click remove a thing from the selection instead; Shift always
  adds. "Less / Object / More" chooses how much one click takes when a thing has parts.
- **The selection is: Kept / Removed**. Kept removes everything else (cut the subject out); Removed removes only
  what is selected (take one thing out of the picture).
- **Brush** paints the selection by hand (add or take away) where clicking does not get it right, with a size
  slider (`[` and `]`).
- **Whole picture**: Automatic (find the subject again), Invert, Select all, and Clear (start from nothing and
  click only the things wanted).
- **Undo / Redo** (Ctrl+Z, Ctrl+Shift+Z) for every step in the dialog, points included, and **Reset** back to what
  it opened with.
- **Selection / Result / Original** views; mouse wheel to zoom, Space or the middle button to drag the view.
- **Apply** stores the choice as the layer's mask in one undo step; **Cancel** (after asking, if anything was
  changed) leaves the layer exactly as it was. The photo's own pixels are never touched.
- A layer that already has a cut-out shows **Edit background removal**: the dialog opens with that cut-out as the
  selection (including touch-ups made to the mask on the canvas since) without running the model again.

How it works: the dialog holds one selection bitmap in the layer's source space and every action produces a new
one (history is one byte per mask pixel per step, plus the points). Clicking uses a second model, a compressed
"Segment Anything" (see "Models that run in the browser"): it studies the picture once when the dialog opens, in
its own worker (about 10 s; the suggestion and the brush are usable meanwhile, and the three most recent
pictures are remembered), and then answers each pointer position in about 0.2 s. Each click is answered on its
own and the answers are combined (added to the selection, or cut out of it), which is why several clicks on one
figure add up to the whole figure. An answer is 256 px across, so it is scaled up as a gradual ramp and then
sharpened, and its edge is snapped to the picture with the same guided filter the suggestion uses, guided by the
colour difference between the object and its surroundings rather than by brightness alone. Where a clicked
object's outline and the existing selection's outline do not quite meet, the hairline that would be left (a
ghost outline of a thing taken away, a seam around a thing added) is cleared by a small opening / closing
limited to a band along the object's outline. If the object model is not installed, the dialog says so and works
with the suggestion and the brush.

### Tone, crop and background blur

- **Levels**: black point, white point and midtones over the picture's histogram, an output range, and Auto.
- **Curves**: a tone curve for RGB and for each channel; click to add a point, drag it, double-click to remove it.
  Levels and curves are stored with the layer's other adjustments and applied in the same single pass.
- **Crop**: shapes (1:1, 4:5, 3:4, 2:3, 9:16, 5:4, 4:3, 3:2, 16:9, the picture's own) and cropping **on the
  canvas** (C): drag the frame's corners, sides or middle, with the trimmed part shown faintly; Enter keeps it,
  Esc restores the crop it had. Works on rotated, flipped and grouped layers.
- **Blur background**: finds the subject (in the browser), keeps it sharp on its own masked layer and puts a
  blurred background layer underneath. The background is the photo with the subject closed over, so there is no
  halo, and the blur is an ordinary effect that can be turned up, down or off afterwards.
- **Vignette** has a colour: black darkens the edges, white lightens them.

### Milestone 1

- **Canvas** — custom size and presets, zoom, pan, rulers, grid, transparency checkerboard.
- **Objects** — images, text and shapes; drag, resize, rotate, flip, duplicate, copy/paste, delete, lock, hide,
  opacity; multi-select; group/ungroup; z-order; align and distribute; snapping with guides; nudging.
- **Images** — PNG, JPG, WebP, SVG by picker, drag-and-drop or paste. Crop, 13 adjustments, border, rounded
  corners, drop shadow, restore original.
- **Blending** — all 16 modes, verified numerically.
- **Effects** — 20 one-click effects, stackable, adjustable, removable.
- **Textures / overlays / backgrounds** — 35 + 14 + 10, generated; recolour and re-roll.
- **Text** — on-canvas editing, 39 fonts, gradient fill, outline, shadow.
- **Shapes**, **projects** (autosave, restore, thumbnails), **export** (PNG / JPG / WebP, 0.5×–4×, transparency),
  **templates**.

### Milestone 2 (this part)

- **Layer masks** on image layers (uploads, textures, paint layers): add, delete, enable / disable, invert, reset,
  feather, view in greyscale, hold-to-compare, apply (bake into a new image). Image and mask thumbnails in the
  layers panel; the outlined one is the edit target, and a banner over the canvas says so while a mask is being
  edited.
- **Brush and eraser** — size, hardness, opacity (per-stroke cap), flow (build-up), smoothing, colour; a cursor
  ring at the true brush size; `B`, `E`, `X`, `[`, `]`. Pen pressure changes the size.
- **Paint layers** — created by painting with nothing paintable selected, or from the layers panel. They are image
  layers, so they can be moved, blended, adjusted, given effects and masked.
- **Background removal** — three models (below), edge refinement, progress and error reporting, entirely in the
  browser.
- **Clipping masks** — clip any layer (image, texture, paint, shape, text, group) to the layer below; several
  layers can share a base; works with opacity and blend modes on both the base and the clipped layers.

### Added after Milestone 2

- **Text warp** — Arc, Arc lower, Arc upper, Arch, Bulge, Flag, Rise and Squeeze with bend, horizontal and
  vertical distortion; and a Custom envelope edited by dragging four corners and eight tangent handles on the
  canvas. Switching to Custom starts from the shape already on the canvas. Non-destructive: the text stays
  editable and the warp can be changed, reset or removed at any time.
- **Interface size** — Compact, Comfortable (default, 120 %) and Large (140 %), in the View menu in the top bar
  (with rulers and grid); remembered per browser.
- **In-app confirmation dialog** in place of the browser's.

### Milestone 3: creative tools

Every item below is an ordinary layer or a setting on one: it can be moved, faded, blended, masked or clipped,
changed later and removed, and nothing alters the pixels of another layer.

- **Textures and overlays** — 39 textures (paper and print, grunge and distressed, materials, digital and artistic,
  including cardboard, dirt, distressed edges and dithering) and 18 overlays (lighting, atmosphere, film, particles,
  including VHS, stars, sunlight and abstract light shapes). Each is added as its own layer with a suggested blend
  mode; opacity, blend, colours, adjustments, masks, position and rotation all apply.
- **Text effects** — background panel, glow, 3D depth, metallic shine and distress, each with its own controls; six
  effect styles (Neon, Gold, Chrome, Retro 3D, Stamped, Soft glow) alongside outline, gradient and shadow.
  Vertical text. Fill text with an image or texture by clipping that layer to the text.
- **Fonts** — 39 built-in families in seven groups, plus your own: upload TTF, OTF, WOFF or WOFF2 files, which are
  kept in this browser and used on the canvas and in exports.
- **Text on a path** — along a curve whose points are dragged on the canvas, or around a circle (above or below).
- **Library** — 157 line icons, 14 stickers, 14 frames, 8 illustrations, 10 geometric elements, all vector and
  recolourable; six more pattern backgrounds; **My assets**, where any selection can be saved and reused in every
  project.
- **Effects** — 36 in all: colour grading (vibrance, colorize, teal & orange, split tone and duotone with your own
  colours, bleach bypass, cross process), spotlight, motion blur with a direction, ripple, bulge, pinch, swirl, oil
  paint and emboss are new. Each effect in a layer's stack can be switched off without losing its settings, moved
  earlier or later, and removed. **Looks** apply a finished grade in one click (15: cinematic, vintage, artistic).
- **Templates** — 18: posters, album covers, social posts and a story, banners, thumbnails, flyers, an invitation,
  a certificate and a wallpaper.
- **Library** — every tile shows the asset's name, category and licence; star an asset to keep it under
  Favourites; Recent lists what you used last. Previews are drawn only for tiles on screen.
- **Colour** — every colour control offers recently used colours, RGB values and (in Chrome and Edge) an
  eyedropper that picks from anywhere on screen. Shape outlines can be solid, dashed or dotted.
- **Export** — PDF, as a one-page picture of the design at the canvas's size.
- **Composition** — rule of thirds, centre lines and safe margins (View menu); layers snap to them, and to the
  position that makes the gaps to their neighbours equal.
- **Workspace** — roomier panels, a draggable divider between properties and layers, and Ctrl+\ to hide both
  panels.

### Selection tools

- **Marquee** (M; M again switches rectangle / ellipse), **lasso** (L) and **magic wand** (W) select an area of
  the canvas. Shift adds, Alt subtracts, Shift+Alt intersects; the same modes are in the bar over the canvas,
  with feather for the marquee and lasso, and tolerance, contiguous and "all layers / this layer" for the wand.
- **Select all** (Ctrl+A with a selection tool), **Invert** (Ctrl+Shift+I), **Deselect** (Ctrl+D, or click with a
  selection tool), **Expand / Contract / Feather** by an amount, **Select layer** (the outline of whatever the
  selected layer draws) and **Select subject** (the background-removal model, giving a selection instead of a
  mask). The selected area is shown with a moving outline that stays one pixel wide at any zoom.
- A selection is used through the **Selection panel** on the right, and never changes an image's own pixels:
  **Mask to selection** and **Hide area** (also Delete) edit the layer's mask; **Copy to layer** (Ctrl+J) and
  **Cut to layer** (Ctrl+Shift+J) make a new masked layer; **Fill** adds a colour layer; and the **brush and
  eraser only land inside the selection**. Rotated, flipped, cropped and grouped layers are handled by the same
  transforms that place them on the canvas.
- The selection is one bitmap in canvas space (up to 2048 px on the longer side). It is working state, like the
  zoom: it is not saved with the project and is not an undo step, but everything done *with* it is.

### Without any AI service

These run entirely in the browser. No server, account, key or subscription; nothing is uploaded.

- **Remove an object** — select it and press **Content-aware fill** (Selection panel). The area is rebuilt from its
  surroundings and arrives as a new layer masked to the selection, so nothing underneath changes. This is the
  classical PatchMatch technique (the idea behind "content-aware fill" in other editors), not a neural network: it
  continues what is around the selection.
- **Expand an image** — Image properties → Expand. **Fill the canvas** grows the picture just far enough to cover
  the canvas in one click; or enter how far to grow each side. The new border is built from the picture itself by
  the same technique; what was there stays exactly where it was. The layer gets a new, larger picture (the original
  stays in Uploads, and it is one undo step). Works on rotated, flipped, cropped and masked layers and on paint
  layers.
- **Upscale an image** — Image properties → Upscale, 2× or 4×, with the Real-ESRGAN "general x4 v3" network
  (5 MB, BSD-3-Clause) running on your computer. The layer keeps its place, crop, mask and adjustments and gets a
  larger, sharper picture. Progress, time left and Cancel are shown; the original stays in Uploads.
- **Polygonal lasso** — Lasso → Polygon: click from corner to corner; double-click, Enter or a click on the first
  corner closes the shape, Backspace removes the last corner, Escape abandons it.
- **Saved selections** — Selection panel → Save selection. They are stored with the project (document format 5),
  can be renamed and deleted (with undo), and are loaded with the current mode, so a saved selection can also be
  added to, subtracted from or intersected with the current one.
- Also local, from earlier: background removal and **Select subject**.

Measured on the development machine: content-aware fill of a selection, under 1 s; expanding a 300 × 216 picture to
800 × 600, about 6 s; upscaling takes about 0.13 ms per source pixel (160 × 120 in under 3 s; 512 × 512 is
estimated at about 30 s; 1024 × 1024 at about 2 minutes), the same for 2× and 4×.

### Generative AI

Only creating something *new* from a description needs a hosted model. If you never set this up, everything above
still works.

Generative fill, object removal and image generation use a hosted image model. Its API key must not be in a web
page, so the editor talks to `server/index.mjs`, a small dependency-free Node server that holds the key:

```bash
cp .env.example .env    # then put your OpenAI API key and image model in .env
npm run server          # http://127.0.0.1:8787; the dev server proxies /api to it
```

- **Generative fill**: select an area, describe what should be there. **Remove object**: select it, one click.
  The editor renders the design around the selection, sends it with a mask of the selection, and adds the answer
  as a **new image layer masked to the selection**. Nothing underneath changes; the layer can be re-masked,
  moved, blended or deleted, and the whole thing is one undo step.
- **Generate an image** (AI tab): a description and a shape; the result is an ordinary image layer and upload.
- The server checks every request (PNG data only, known sizes, prompt length, body size), limits requests per
  minute, allows cross-origin calls only from the editor's own origins, never returns the key and never fetches
  URLs on a client's behalf. `.env` is git-ignored.
- **Tested against a stand-in, not the real provider.** No API key was available while building this, so the
  whole path is verified against a local server that speaks the provider's documented protocol (`ai.mjs`). The
  adapter in `server/providers.mjs` follows OpenAI's image API reference as read in November 2026 (JSON body,
  `images[].image_url` and `mask.image_url` as data URLs, `b64_json` in the answer, transparent mask pixels
  marking the area to repaint). The first real request with your key is the remaining check; if the provider
  rejects it, the error it returns is shown in the editor. Set `OPENAI_IMAGE_MODEL` to a model your account has.
- These tools send your description and the visible part of the design around the selection to the provider, and
  are billed to the key's account. Everything else in the editor stays in the browser.

Shortcuts: Ctrl+Z / Ctrl+Shift+Z, Ctrl+C / X / V / D, Delete, Ctrl+G / Ctrl+Shift+G, Ctrl+Alt+G (clip), Ctrl+A,
Ctrl+] / [, Ctrl+I (invert mask), arrows, Ctrl+S, V / H / B / E, X, [ / ], Space; M / L / W, Ctrl+Shift+I,
Ctrl+J / Ctrl+Shift+J for selections; Enter, Backspace and Escape while drawing a polygon; C to crop the selected
image (Enter keeps, Escape cancels); F1 for the guide. With an area selected, Ctrl+D deselects it (otherwise it duplicates the
layer), and with a selection tool active Delete hides the selected area instead of deleting the layer. None fire
while typing or mid-stroke.

## Models that run in the browser

Self-hosted under `public/models` (git-ignored; `npm run setup:ai` downloads them and checks each against a pinned
SHA-256).

**Upscaling:** Real-ESRGAN `realesr-general-x4v3` (Xintao Wang et al., [github.com/xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN)),
4.9 MB, BSD-3-Clause; the licence text is shipped next to it as `public/models/LICENSE-Real-ESRGAN.txt`. It is the
official weights exported to ONNX unchanged (the export was checked tensor by tensor against the official
`.pth`), downloaded from a pinned commit of `huggingface.co/vlad-grig/realesr-general-x4v3-onnx`. It always
works at 4×; 2× is that result averaged down. The picture is processed in 128 px tiles, each given 16 px of its
neighbours, so memory stays around 150 MB and no seams show. The larger Real-ESRGAN x4plus network and
transformer upscalers (SwinIR, Swin2SR) were ruled out as far too slow without a GPU.

**Background removal and subject selection:** ONNX exports published with the
[rembg](https://github.com/danielgatis/rembg) project.

| Name in the app | Model | Size | Input | Licence | Time* | Notes |
|---|---|---|---|---|---|---|
| Fast | U²-Net-P | 4.6 MB | 320 px | Apache-2.0 | ~2 s | Fine for a clear subject on a simple background |
| **Balanced** (default) | "silueta" (reduced U²-Net) | 44 MB | 320 px | Apache-2.0 | ~3.5 s | Better on busy scenes |
| Detailed (`setup:ai -- --all`) | IS-Net general use | 179 MB | 1024 px | Apache-2.0 | ~15 s | Sharpest edges; large and slow |

\* Inference only, one WebAssembly thread, on the development machine (8 logical cores, headless Edge). The first
run of each model also downloads it; afterwards it is cached by the browser and kept loaded for the session.

Considered and rejected: BRIA RMBG 1.4 / 2.0 (best size-to-quality, but non-commercial licence), the
`@imgly/background-removal` package and the community IS-Net build on Hugging Face (AGPL), BiRefNet (MIT and
excellent, but 200 MB+ and impractical without WebGPU), MODNet and MediaPipe selfie segmentation (people only).

**Clicking objects in the background-removal dialog:** SlimSAM-77 (Zigeng Chen et al., a pruned and distilled
Segment Anything model, Apache-2.0), as the 8-bit ONNX export published by Xenova
(`huggingface.co/Xenova/slimsam-77-uniform`, pinned to one commit): an image encoder (8.9 MB, 1024 px input,
about 10 s per picture on one WebAssembly thread) and a prompt decoder (4.9 MB, about 0.2 s per point). The
full-precision export of the same model (40 MB) was measured too: the same speed and, on the test pictures, masks
of nearly the same size and score, so the smaller one is used.

Runtime: `onnxruntime-web` 1.31 (MIT). It adds a 14.8 MB WebAssembly file to the build (3.9 MB gzipped), loaded
only when background removal is first used. Requirements: any current browser with WebAssembly; roughly 150–400 MB
of memory while a model runs (more for Detailed). These are salient-object models: they find one main subject and
are not hair-level matting.

## What is not implemented

Labelled "Not implemented" in the interface where relevant. None of it is simulated.

| Area | Missing |
|---|---|
| Selections | Magnetic lasso; quick-selection brush; moving or transforming a selection outline; selections in undo history |
| Retouching | Clone stamp, blur brush, gradient tool, eyedropper |
| Masks | Several masks per layer in the interface (the model allows it); masks directly on text, shapes and groups (clip them instead); vector masks |
| AI | Providers other than OpenAI; a run against the real provider (see "Generative AI"); face restoration, denoising and other enhancement beyond upscaling |
| Text | Paths drawn freehand or with more than one curve, per-letter styling, effects on shapes; a pen tool for drawing your own shapes; assigning each letter its own hand-cut piece of a silhouette (text shaped to a layer follows the layer's top and bottom outline, not cuts drawn through it) |
| Assets | Stock photos (needs a provider API and a server-held key); importing your own SVG as editable vectors |
| Export | SVG; PDF with selectable text or vector shapes (the PDF holds an image); selected layers only |
| Colour | Alpha in colour pickers (so no gradient opacity); saved, named palettes |
| Backgrounds | Scale and spacing controls for patterns and textures (they fill the layer at a fixed density; they do not tile) |
| Templates | Rendered previews on the cards (they show a colour sketch) |
| Object selection | Click-to-select any object as a *selection* on the canvas (clicking objects exists inside the background-removal dialog, where it edits the cut-out); "Select subject" finds the one main subject. Dragging a box around an object, or naming it in words |
| Cloud | Accounts, cloud storage, sharing, version history, collaboration |

## Known limitations

- The tabs organise the right-hand panel only. The left panel (what can be added), the tool row and the Layers
  panel are laid out as before. There is no search for a setting by name, and no floating toolbar next to the
  selected layer.
- The Adjust tab of a photo is still about two screens tall on a 768 px high window (twelve sliders, then Levels
  and Curves); the other tabs fit in one or nearly one.
- A layer that has just been added always opens on its main tab, which includes a duplicate (it is a new layer),
  so duplicating a photo while on Style returns the panel to Adjust.
- Which tab was last used is stored in the browser, per kind of layer, not per project or per layer.

- Masks are bitmaps, not vectors: between 1024 and 2048 px on their longer side. On photos larger than that, and
  in exports far beyond that size, mask edges are scaled up smoothly rather than re-drawn. A mask keeps the density
  it was created with (it is not resampled when the layer is later enlarged).
- Warped text is drawn as a picture of the text at the size it is shown or exported at (up to 4096 px on a side),
  so beyond roughly 4× that it softens. At 1× it can sit up to half a pixel from where the same text is drawn
  unwarped, because browsers place unwarped text on whole pixel rows. Its side handles are replaced by corner
  handles (set the wrap width in the properties panel), its click area is the bounding box of the warped shape, and
  the custom envelope's points do not follow the layer until a drag of the layer itself is released. Warp applies
  to text layers only, not to images or shapes.
- Content-aware fill and Expand copy from the picture; they do not understand it. Sky, grass, water, walls, fabric
  and gradients continue convincingly. Distinct things (clouds, faces, text, buildings, anything that should end
  at a particular place) are smeared or repeated, and an expansion can look like a second cloud or a second shoreline
  where the old edge was. For those, use generative fill, or paint and mask by hand. Results are computed at up to
  1400 px across for a selection and 6 megapixels for an expansion; a larger expansion is scaled down, with a notice.
- Expand works on what is showing: a cropped layer is expanded from its crop and the cropped-away part is dropped
  (the original stays in Uploads). On a masked layer the new border is revealed.
- Upscaling is offered up to 4096 px on the longer side (2× up to a 2048 px source, 4× up to 1024 px), because the
  editor never draws an image larger than that. It runs on one processor thread; photos only, not paint layers or
  generated textures. Transparency is enlarged the ordinary way, so the edge of a cut-out is smooth rather than
  model-sharpened. It restores edges and texture; it does not recover detail that was never there.
- Text shaped to a layer follows that layer's top and bottom edge only: holes inside the shape, and parts that
  overhang (a shape that is not a single span from top to bottom at some position), are bridged. The outline is
  taken once, when "Fit text to this shape" is pressed; moving or changing the other layer afterwards does not
  update the text until it is fitted again. It needs the text at the top level (not inside a group).
- Bloom and Light streaks go by brightness alone: they cannot tell a lamp from a white wall, so a picture that is
  light all over glows all over. Fine dark detail inside a bright area is flooded by Bloom. On a cut-out the
  light stays inside the cut-out's outline (an effect never paints into the transparent part of its layer); for
  light that spills past it, put the Glow or Light rays overlay above it.
- A painted fade is stored at the resolution of a layer mask, and is not affected by "Begins at" and "Reaches
  to". There is no separate tool for painting shadows: a shadow is painted on a paint layer (black brush, low
  Opacity, blend mode Multiply).
- Fade applies to image layers (photos, paint layers, textures), not to text or shapes, and it is set with buttons,
  sliders and the brush, not by dragging handles on the canvas. All parts of one fade share the same "Begins at", "Reaches
  to" and Strength; a layer has at most one free direction and one shape. Sides and corners are those of the
  layer's own box, so they turn and flip with the layer. A shape taken from a soft (feathered) selection uses its
  half-way line as the outline, and the fade along a shape is worked out on a grid of at most 512 px, so very
  fine detail in the outline is smoothed on large images.
- Selection edges are as fine as the selection bitmap: one canvas pixel up to 2048 px, coarser on larger canvases.
  The magic wand compares what is drawn on screen (preview quality), at that same resolution. "Select layer" follows
  the layer's opacity, so a half-transparent layer gives a half-strength selection. Mask commands need an image or
  paint layer; text and shapes can be selected from and filled over, but not masked.
- Generative fill sends a square or 3:2 area between about 1 and 1.5 megapixels, whatever the canvas size, so a
  fill over a very large area is enlarged when it comes back. It sees the whole design (all visible layers) and
  its result sits on top of them. Current image models treat the mask as guidance, so the result layer's own mask
  is what keeps the change inside your selection.
- The AI server keeps its rate limit in memory and has no accounts: anyone who can reach it can spend the key's
  quota, so keep it on localhost or put it behind your own authentication before exposing it.
- The interface size uses CSS `zoom`, which needs Chrome / Edge 128+, Safari, or Firefox 126+.
- Text with effects or on a path is, like warped text, a picture made at display or export size; its side handles
  become corner handles. Text on a path is a single line (line breaks become spaces), and a gradient runs across
  the whole line rather than each letter. Effects are drawn over one another in a fixed order (distress, shine, 3D
  depth, glow). The drop shadow falls from the text together with its glow and 3D block.
- Graphics other than most frames stretch like an image when their box leaves its natural proportions. Icons keep
  theirs. Image effects, masks and adjustments do not apply to icons, graphics or text.
- My assets, uploaded fonts, favourites and recent colours are stored in this browser only, like projects. A
  project opened where an uploaded font is missing keeps the font's name and falls back to a generic face.
- The eyedropper uses the browser's EyeDropper API, which Firefox and Safari do not have; the button is hidden
  there.
- Vertical text stacks upright letters; it is not a rotated or East Asian vertical layout.
- Oil paint works on a copy of at most 720 px, so its dabs do not get finer on a larger export.
- Snapping to guides and to equal spacing applies when dragging a single top-level layer, and equal spacing looks
  only at the nearest neighbour on each side.
- Paint layers are created at the canvas size (up to 2048 px) and do not grow if the canvas is enlarged later.
- Round brush tips only. Soft brushes build up where dabs overlap, so a 0 % hardness stroke is somewhat firmer than
  a single dab. "Restore" applies to masks; on a paint layer the eraser removes paint and undo brings it back.
- Clicking objects in the background-removal dialog is as good as the object model, and it has so far been
  checked on drawn test pictures (solid things on a textured wall), not on a set of real photographs; the brushes
  are there for whatever it gets wrong. It needs about 10 s per picture before the first click (one thread), each
  click is answered on its own (one of three candidates) and combined with the rest, so points do not refine
  one another the way they do in tools that feed all points to the model together; a point cannot be moved or
  deleted except by Undo; and the dialog works on at most 2048 px of the picture, like the mask itself. The history inside the
  dialog (up to 40 steps) is discarded when it closes; the applied result is one step in the editor's history.
- Background removal uses one WebAssembly thread. Multi-threading needs a cross-origin-isolated page (COOP/COEP
  headers) and WebGPU would be faster still; neither is set up.
- A clipped layer with a blend mode draws its base twice. Deleting a base makes the layers that were clipped to it
  clip to the next layer down. A clipped layer is still clickable across its whole box.
- A full-canvas texture, overlay or paint layer on top catches clicks. Lock it in the Layers panel to click through.
- Snapping applies when dragging a single layer. While cropping on the canvas the faint picture of the trimmed
  part is the original, without the layer's adjustments and effects.
- Plain-background removal goes by colour: a part of the subject that is the backdrop's colour and touches the
  backdrop (a white shirt against a white wall) is removed with it. Switch Method to "Find the subject" for those,
  or paint the part back on the mask. A backdrop with a gradient or texture is not treated as plain.
- The guide's demonstrations are recorded at one window size and the default interface size, and are not
  re-recorded automatically when the interface changes (run `npm run guide:demos`). They are WebM (VP9) video,
  which current Chrome, Edge and Firefox play and Safari plays from version 16.4; they have no sound. Recording
  needs Playwright's video helper once: `npx playwright-core install ffmpeg` (about 1.6 MB, kept in Playwright's
  own cache folder). Two entries (generative fill and image generation) show the controls and the setup steps
  rather than a result, because recording a result would need a paid provider key.
- Background blur finds one main subject and needs a browser that can blur on a canvas (Chrome, Edge, Firefox).
  The background layer is at most 1600 px across, which is enough because it is only ever shown blurred.
- Curves have up to as many points as you add but one curve per channel; there is no eyedropper for setting black,
  white or grey points from the picture, and the histogram shows the original picture, not the adjusted one.
- Effects and adjustments apply to image layers, not to text or shapes.
- Stretching a group non-uniformly and then ungrouping cannot preserve the skew of rotated children.
- Colour pickers have no alpha channel. Layers-panel dragging reorders within one level only.
- Image processing and texture generation run on the main thread (about 80–100 ms per slider update on a 2400 px
  photo). Starting or finishing a stroke on a 2048 px mask can take up to ~200 ms without GPU acceleration.
- Undo history is per session (100 steps). Up to about 190 MB of decoded mask / paint bitmaps are kept in memory;
  older ones are kept as PNG and decoded when needed.
- The editor is built for mouse and keyboard. Painting uses pointer events (so a pen works), but the rest of the
  interface has no touch gestures and nothing has been tested on a tablet.

## Suggested next steps

1. Run generative fill, object removal and image generation against the real provider with a real key, and tune
   prompts, context size and edge blending on actual results.
2. Multiple masks per layer in the interface, and masks on text / shape / group layers via isolated groups.
3. On-canvas crop handles; snapping while resizing.
4. Move the image pipeline and generators to a worker; thread or WebGPU the segmentation model.
5. PDF export, SVG import as vector layers, text on a freehand path, warp for images.
6. Supabase: accounts and cloud projects behind the existing repository interface.
