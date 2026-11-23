import type { SidebarTab, Tool } from '../../stores/uiStore';

/**
 * The in-app guide: one short, task-shaped entry per feature. Each says where the feature is and
 * what to press, in the words the interface itself uses, so the steps can be followed literally.
 * "show" takes the reader to the right tool or panel when they close the guide.
 */

export interface GuideTopic {
  id: string;
  title: string;
  category: GuideCategory;
  /** One sentence: what this is for. */
  summary: string;
  steps: string[];
  tips?: string[];
  shortcuts?: { keys: string; does: string }[];
  /** Words people might search for that are not in the title. */
  keywords?: string;
  show?: { tool?: Tool; tab?: SidebarTab; label: string };
  /** Needs something the editor cannot provide by itself. */
  needs?: string;
}

export const GUIDE_CATEGORIES = [
  'Getting started',
  'Layers',
  'Images',
  'Colour and tone',
  'Cut-outs and masks',
  'Selections',
  'Remove, expand, upscale',
  'Text',
  'Library',
  'Generative AI',
  'Export',
] as const;
export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

export const GUIDE: GuideTopic[] = [
  // ---------- Getting started ----------
  {
    id: 'start',
    title: 'Start a design',
    category: 'Getting started',
    summary: 'Begin from a blank canvas of the right size, or from a template.',
    steps: [
      'On the home page, pick a size under “Start a new design”, or a template under “Start from a template”.',
      'Inside the editor, the same choices are in Projects (top right) → New project, and in the Templates tab on the left.',
      'The design opens in the editor: the canvas in the middle, things to add on the left, settings for whatever is selected on the right, and layers at the bottom right (see “Finding your way around”).',
    ],
    tips: ['Click the Prysm logo at the top left at any time to come back to the home page. Your design is saved automatically.'],
    keywords: 'new blank size preset template home',
    show: { tab: 'templates', label: 'Open Templates' },
  },
  {
    id: 'find-your-way',
    title: 'Finding your way around',
    category: 'Getting started',
    summary: 'Where things are: what to add on the left, tools at the top, and the settings of whatever is selected on the right.',
    steps: [
      'Left: everything you can add (templates, elements, text, uploads, photos, backgrounds, textures, overlays, effects). Click something and it is placed on the canvas and selected.',
      'Top: the tools (Move, Hand, Brush, Eraser and the selection tools), undo and redo, zoom, and Export.',
      'Right: the settings of whatever is selected, in a few tabs. A photo has Adjust, Effects, Cut out, Layout and Style; text has Text, Effects, Layout and Style; a shape has Shape, Layout and Style. Layout and Style hold the same things for every kind of layer.',
      'When you add or start something, the panel opens its settings for you: add an effect and the Effects tab opens on that effect, highlighted for a moment; press C and Layout opens on Crop.',
      'While a selection tool is active a Select tab appears, with everything that can be done with the selected area.',
      'Prefer one long list? The last tab, All, shows every setting at once. The panel remembers the tab you used last for each kind of layer.',
      'Below the settings are the layers. Drag the line between the two to give either more room.',
    ],
    tips: ['The small question mark next to a section opens this guide at the page about it.', 'Ctrl + \\ hides both side panels and gives the canvas the whole window.'],
    shortcuts: [{ keys: 'Ctrl + \\', does: 'Hide or show the side panels' }],
    keywords: 'interface layout navigate navigation panel panels tabs where find settings properties inspector confusing lost overview tour',
  },
  {
    id: 'canvas',
    title: 'Canvas size and background',
    category: 'Getting started',
    summary: 'Change the size of the design and what is behind everything.',
    steps: [
      'Click the canvas size in the top bar (for example “1080 × 1080”), or click an empty part of the canvas so nothing is selected.',
      'On the right, under Size, type a width and height or choose a preset. Layers keep their position and size.',
      'Under Background, choose Clear (transparent), Solid, Linear or Radial, and set the colours.',
    ],
    keywords: 'resize document dimensions transparent gradient colour',
  },
  {
    id: 'navigate',
    title: 'Zoom, pan and guides',
    category: 'Getting started',
    summary: 'Move around the canvas and switch helpers on and off.',
    steps: [
      'Zoom: hold Ctrl and turn the mouse wheel, or use the − and + buttons in the top bar. Click the percentage to return to 100%.',
      'Pan: turn the wheel (Shift + wheel goes sideways), or hold Space and drag, or use the Hand tool.',
      'Open View options (the sliders icon in the top bar) for rulers, the grid, rule-of-thirds / centre / safe-margin guides, and the size of the interface.',
    ],
    shortcuts: [
      { keys: 'Ctrl + 0', does: 'Fit the canvas to the screen' },
      { keys: 'Ctrl + 1', does: 'Zoom to 100%' },
      { keys: 'Space + drag', does: 'Pan' },
      { keys: 'Ctrl + \\', does: 'Hide or show the side panels' },
    ],
    keywords: 'hand rulers grid interface size bigger buttons thirds',
    show: { tool: 'hand', label: 'Use the Hand tool' },
  },
  {
    id: 'projects',
    title: 'Saving and projects',
    category: 'Getting started',
    summary: 'Designs save themselves; open, duplicate or delete them from Projects.',
    steps: [
      'There is no save button to remember: the word next to the project name shows “Saved” once your last change is stored.',
      'Click the project name in the top bar to rename it.',
      'Click Projects (top right), or use “Recent projects” on the home page, to open, duplicate or delete a design or start a new one.',
    ],
    tips: ['Projects, uploads and fonts are stored in this browser on this computer. Clearing the browser’s site data removes them, and they do not appear in another browser.'],
    shortcuts: [{ keys: 'Ctrl + S', does: 'Save right now' }],
    keywords: 'autosave open rename duplicate delete storage',
  },
  {
    id: 'undo',
    title: 'Undo and redo',
    category: 'Getting started',
    summary: 'Every change to a design can be stepped back.',
    steps: ['Press Ctrl + Z to undo and Ctrl + Shift + Z (or Ctrl + Y) to redo, or use the two arrows next to the project name.', 'Up to 100 steps are kept while the editor is open.'],
    shortcuts: [
      { keys: 'Ctrl + Z', does: 'Undo' },
      { keys: 'Ctrl + Shift + Z', does: 'Redo' },
    ],
    keywords: 'history mistake revert',
  },

  // ---------- Layers ----------
  {
    id: 'layers',
    title: 'Work with layers',
    category: 'Layers',
    summary: 'Everything on the canvas is a layer: an image, a piece of text, a shape or a group.',
    steps: [
      'Click a layer on the canvas, or its row in the Layers panel (bottom right), to select it. Shift-click to select several.',
      'Drag a row up or down in the Layers panel to change what is in front. The top row is in front.',
      'Use the eye to hide a layer and the padlock to lock it. Double-click a name to rename it.',
      'The icons at the top of the Layers panel add a paint layer, clip, group, ungroup, duplicate and delete.',
    ],
    shortcuts: [
      { keys: 'Ctrl + D', does: 'Duplicate' },
      { keys: 'Delete', does: 'Delete' },
      { keys: 'Ctrl + G / Ctrl + Shift + G', does: 'Group / ungroup' },
      { keys: 'Ctrl + ] / Ctrl + [', does: 'Bring forward / send backward' },
    ],
    keywords: 'order stack hide lock rename group duplicate delete front back',
  },
  {
    id: 'arrange',
    title: 'Move, resize, rotate and align',
    category: 'Layers',
    summary: 'Place things exactly.',
    steps: [
      'With the Move tool, drag a layer to move it, drag a corner handle to resize it, and drag the round handle above it to rotate it.',
      'Pink lines appear when an edge or centre lines up with the canvas or with another layer, and the layer snaps to them.',
      'For exact numbers open the Layout tab on the right: Position & size has them, and under Arrange are the align, distribute, order and flip buttons.',
    ],
    shortcuts: [
      { keys: 'Arrow keys', does: 'Nudge by 1 px (Shift: 10 px)' },
      { keys: 'V', does: 'Move tool' },
    ],
    keywords: 'position scale flip distribute centre snap transform',
    show: { tool: 'move', label: 'Use the Move tool' },
  },
  {
    id: 'blend',
    title: 'Opacity and blending images',
    category: 'Layers',
    summary: 'Make a layer see-through, or mix it with the layers underneath.',
    steps: [
      'Put one image above another (drag its row higher in the Layers panel).',
      'Select the upper one. On the right, open the Style tab and, under Blending, lower Opacity to let the layer below show through.',
      'Choose a Blend mode to mix them: Multiply darkens, Screen lightens, Overlay and Soft Light add contrast, and so on.',
      'Two classics for a black-and-white picture over a photo: Screen makes its white stay white and lets the photo show through its black (a photo inside a silhouette); Multiply does the reverse, keeping the black and dropping the white.',
      'With the layer selected, Alt + Shift + a letter sets the mode from the keyboard: M Multiply, S Screen, O Overlay, N Normal.',
      'For a soft transition between two photos, switch on Fade for the upper one (see “Fade an image into another”), or add a layer mask and paint it with a soft brush (see “Layer masks”).',
    ],
    shortcuts: [
      { keys: 'Alt + Shift + N', does: 'Normal' },
      { keys: 'Alt + Shift + M', does: 'Multiply (keeps the dark, drops the white)' },
      { keys: 'Alt + Shift + S', does: 'Screen (keeps the light, drops the black)' },
      { keys: 'Alt + Shift + O / F / H', does: 'Overlay / Soft light / Hard light' },
      { keys: 'Alt + Shift + K / G', does: 'Darken / Lighten' },
      { keys: 'Alt + Shift + D / B', does: 'Colour dodge / Colour burn' },
      { keys: 'Alt + Shift + E / X', does: 'Difference / Exclusion' },
      { keys: 'Alt + Shift + U / T / C / Y', does: 'Hue / Saturation / Colour / Luminosity' },
    ],
    keywords: 'transparency transparent fade double exposure multiply screen overlay merge two images blend on white blend on black silhouette shortcut',
  },
  {
    id: 'fade',
    title: 'Fade an image into another',
    category: 'Layers',
    summary: 'Make part of an image gradually transparent, from any sides or corners or along a shape you draw, so two pictures blend softly into one.',
    steps: [
      'Put the two images on top of each other, overlapping, and select the upper one.',
      'On the right, open the Cut out tab and switch on Fade. The image fades from the right at first, and the one underneath shows through.',
      'The nine buttons choose where it fades from: the four sides, the four corners, and the middle one for all round. Press as many as you like; press one again to remove it.',
      '“Begins at” is how far in the image is completely faded, and “Reaches to” is where the fade stops and the image is untouched. Move them apart for a longer, softer blend.',
      'Strength sets how transparent the faded part becomes: 100 fades it away completely, a low value only softens it.',
      'For a straight fade at an angle, switch on “Any direction” and turn Direction.',
      'To fade along your own shape, draw it over the image with a selection tool (Marquee, Lasso, Magic wand, or “Select subject”) and press “Fade along selection” in the Select tab (or “Use the selection” under Fade). The image shows inside the shape and fades at its outline.',
      'To choose by hand which parts fade, press “Paint the fade” and brush over them (see “Paint where an image fades”).',
    ],
    tips: [
      'Fade is a setting, not an edit: switch it off and the whole image is back. Cropping, masks and blend modes keep working with it.',
      'Reverse swaps what is kept and what is faded: with a shape, the inside fades and the rest stays.',
      'The shape is kept with the layer, so the selection can be dropped afterwards. “Remove shape” takes it away again, and sides or corners can be added to it.',
    ],
    keywords: 'transparent transparency gradient blend two images merge soft edge fade out double exposure composite seamless corner corners side sides oval vignette shape outline strength feather',
  },
  {
    id: 'fade-paint',
    title: 'Paint where an image fades',
    category: 'Layers',
    summary: 'Brush over the parts of an image that should fade away, as softly or as strongly as you like.',
    steps: [
      'Select the image. On the right, open the Cut out tab, then Fade, and press “Paint the fade”. The brush is picked up for you, and a bar over the canvas says that you are painting the fade.',
      'Brush over the parts that should fade. They become transparent and whatever is underneath shows through.',
      'In the bar above the canvas, Size sets how wide the brush is, Hardness how soft its edge is, and Opacity how much one stroke fades. A soft brush at a low Opacity builds the fade up a little with every stroke, like shading.',
      'Faded too much? Switch to the Eraser (E), or hold Alt while brushing, and paint the image back.',
      'Press “Done painting” (or Esc) when you are finished.',
    ],
    tips: [
      'Nothing is erased: the painting is part of the layer’s Fade. “Clear painting” removes it, and switching Fade off brings the whole image back.',
      'Painting combines with the sides, corners and shape of the same Fade (see “Fade an image into another”), and Strength applies to it too.',
      'To paint a shadow instead of a fade: add a paint layer above the image (see “Paint”), brush with black at a low Opacity, and set that layer’s blend mode to Multiply.',
    ],
    shortcuts: [
      { keys: 'B', does: 'Brush: fades the image' },
      { keys: 'E', does: 'Eraser: brings the image back' },
      { keys: 'Alt + drag', does: 'Bring the image back while brushing' },
      { keys: 'Esc', does: 'Finish painting' },
    ],
    keywords: 'paint brush fade manual by hand transparent soft erase shading shadow gradient part parts choose dodge burn',
  },
  {
    id: 'clip',
    title: 'Clipping masks',
    category: 'Layers',
    summary: 'Show a layer only inside the shape of the layer below it: a photo inside text, a texture inside a shape.',
    steps: [
      'Put the layer that gives the shape (text, a shape, a cut-out image) underneath, and the layer to show inside it directly above.',
      'Select the upper layer and switch on Clip under Blending (Style tab), or press Ctrl + Alt + G.',
      'Move or resize either layer freely; switch Clip off to release it.',
    ],
    shortcuts: [{ keys: 'Ctrl + Alt + G', does: 'Clip to the layer below / release' }],
    keywords: 'image inside text shape frame fill text with photo',
  },

  // ---------- Images ----------
  {
    id: 'upload',
    title: 'Add your images',
    category: 'Images',
    summary: 'Bring in photos and graphics (PNG, JPG, WebP, SVG).',
    steps: [
      'Open the Uploads tab on the left and choose files, or simply drag image files from your computer onto the canvas.',
      'You can also copy an image anywhere and press Ctrl + V in the editor.',
      'Uploaded images stay in the Uploads tab, so they can be added again to any design.',
    ],
    keywords: 'import photo picture paste drag drop',
    show: { tab: 'uploads', label: 'Open Uploads' },
  },
  {
    id: 'crop',
    title: 'Crop an image',
    category: 'Images',
    summary: 'Trim an image freely or to a set shape. Nothing is thrown away: the crop can be changed later.',
    steps: [
      'Select the image and press C, or open Crop in the Layout tab on the right and press “Crop on canvas”.',
      'Drag the corners or sides of the frame, or drag inside it to slide it over the picture. The trimmed part is shown faintly.',
      'To hold a shape, choose one under Shape (1:1, 4:5, 16:9, 9:16 and others; “Original” is the picture’s own shape).',
      'Press Enter or Done to keep it, Esc or Cancel to go back. “Whole picture” removes the crop.',
    ],
    tips: ['The sliders in the Crop section trim each side by a percentage, if you prefer numbers.'],
    shortcuts: [
      { keys: 'C', does: 'Crop the selected image' },
      { keys: 'Enter / Esc', does: 'Keep / cancel' },
    ],
    keywords: 'trim aspect ratio square preset resize cut',
  },
  {
    id: 'frame',
    title: 'Rounded corners, borders and shadows',
    category: 'Images',
    summary: 'Finish an image with a frame.',
    steps: ['Select the image.', 'On the right, in the Style tab: Frame rounds the corners, Border adds an outline (solid, dashed or dotted), and Drop shadow adds a shadow with its own colour, blur and offset.'],
    keywords: 'radius outline stroke shadow circle photo',
  },
  {
    id: 'effects',
    title: 'Effects and looks',
    category: 'Images',
    summary: 'Blur, sharpen, stylise or colour-grade an image. Effects stack and stay editable.',
    steps: [
      'Select an image and open the Effects tab on the left.',
      'Click a Look for a finished colour grade in one step, or click any effect to add it.',
      'The panel on the right opens its Effects tab on the effect you just added, with its own strength slider. The small buttons next to it switch it off, move it earlier or later, or remove it.',
      'Effects with colours or a direction (Duotone, Split tone, Vignette, Motion blur, Light streaks) show those controls there too.',
    ],
    tips: ['Effects apply to image layers. To use one on text or a shape, clip an image or texture to it instead.'],
    keywords: 'filter filters look grade pixelate glitch oil paint sketch halftone noise',
    show: { tab: 'effects', label: 'Open Effects' },
  },
  {
    id: 'light-effects',
    title: 'Glowing highlights and light streaks',
    category: 'Images',
    summary: 'Make the light parts of a picture glow, and pull them out into streaks of light.',
    steps: [
      'Select the image and open the Effects tab on the left.',
      'Click “Bloom”. The light parts of the picture spill over their surroundings and burn out towards white; the dark parts stay dark. Its slider on the right sets how strong the glow is.',
      'Click “Light streaks”. The light is smeared into streaks along one direction and laid over the picture, which stays sharp underneath.',
      'Turn the streaks with Direction, and set how far they reach with the effect’s own slider.',
      'For the whole poster look in one click, choose the “Luminous” look: black and white, Bloom, Light streaks and a little grain.',
    ],
    tips: [
      'Both work from the light parts only, so they are strongest on a bright subject against a dark background. If the whole picture glows, darken its background first with Levels or Contrast.',
      'For beams of light across the picture, add the “Light rays” overlay from the Overlays tab.',
      'To bend the picture itself, the Distortion effects are in the same tab: Wave, Ripple, Bulge, Pinch and Swirl. Motion blur streaks the whole picture, not only its light.',
    ],
    keywords: 'glow glowing bloom shine light streak streaks rays motion blur highlights luminous ethereal poster distortion distort smear neon',
    show: { tab: 'effects', label: 'Open Effects' },
  },
  {
    id: 'blur-sharpen',
    title: 'Blur and sharpen',
    category: 'Images',
    summary: 'Soften an image, add motion, or bring out detail.',
    steps: [
      'Select the image and open the Effects tab.',
      'Blur softens the whole image (a Gaussian-style blur). Motion blur streaks it in one direction: set the direction with its Direction slider on the right.',
      'Sharpen brings out edges and fine detail. Keep it modest; too much adds halos.',
      'To blur only what is behind the subject, use “Blur background” instead (next entry).',
    ],
    keywords: 'gaussian soften focus crisp detail',
    show: { tab: 'effects', label: 'Open Effects' },
  },
  {
    id: 'blur-background',
    title: 'Blur the background',
    category: 'Images',
    summary: 'Keep the subject sharp and blur everything behind it, like a portrait lens.',
    steps: [
      'Select a photo with one clear subject.',
      'On the right, in the Cut out tab under Mask, press “Blur background”. It finds the subject in your browser; the first run downloads a small model.',
      'You get two layers: the photo, now showing only the subject, and a blurred background underneath.',
      'To change how blurry it is, select the background layer and move the Blur slider in its Effects tab. Remove the effect to get the plain background back.',
    ],
    tips: ['Because the background is its own layer, you can also darken it, desaturate it, or swap it for something else entirely.'],
    keywords: 'portrait bokeh depth of field focus subject',
  },
  {
    id: 'duotone',
    title: 'Duotone and colour treatments',
    category: 'Images',
    summary: 'Recolour a photo with two colours of your choice, or tint it.',
    steps: [
      'Select the image, open the Effects tab and click Duotone.',
      'In the Effects tab on the right, set the two colours: the first replaces the dark tones, the second the light tones. The slider blends between the original and the duotone.',
      'Split tone tints shadows and highlights more subtly; Colorize gives the whole image one hue; Grayscale and Sepia are sliders under Adjustments (Adjust tab).',
    ],
    keywords: 'two colour tint monochrome spotify black and white',
    show: { tab: 'effects', label: 'Open Effects' },
  },
  {
    id: 'vignette',
    title: 'Vignette',
    category: 'Images',
    summary: 'Darken or lighten the edges of an image to draw the eye to the middle.',
    steps: [
      'Select the image, open the Effects tab and click Vignette.',
      'In the Effects tab on the right, the slider sets how strong it is.',
      'Its colour decides the direction: black (the default) darkens the edges, white lightens them, and any other colour tints them.',
    ],
    keywords: 'edges corners darken lighten fade',
    show: { tab: 'effects', label: 'Open Effects' },
  },

  // ---------- Colour and tone ----------
  {
    id: 'adjust',
    title: 'Brightness, contrast, saturation and exposure',
    category: 'Colour and tone',
    summary: 'The everyday corrections for a photo.',
    steps: [
      'Select the image. On the right, the Adjust tab has Adjustments at the top.',
      'Brightness and Exposure make it lighter or darker (Exposure works like a camera setting and affects bright areas more). Contrast separates lights from darks. Saturation makes colours stronger or weaker.',
      'Highlights and Shadows recover detail in just the bright or just the dark areas.',
      'The small arrow next to a slider resets that one; “Reset all” resets them together. The original image is never changed.',
    ],
    keywords: 'lighten darken vivid dull gamma highlights shadows correction',
  },
  {
    id: 'hue',
    title: 'Hue, temperature and tint',
    category: 'Colour and tone',
    summary: 'Change colours, or correct a colour cast.',
    steps: [
      'Select the image and open the Adjust tab on the right.',
      'Hue rotates every colour around the colour wheel (blue becomes purple, then red…).',
      'Temperature moves the whole picture warmer (towards orange) or cooler (towards blue). Tint moves it between green and magenta.',
      'For stronger colour without clipping skin tones, add the Vibrance effect from the Effects tab.',
    ],
    keywords: 'colour change warm cool white balance cast recolour vibrance',
  },
  {
    id: 'levels',
    title: 'Levels',
    category: 'Colour and tone',
    summary: 'Set where black and white begin, using the picture’s histogram.',
    steps: [
      'Select the image and open Levels in the Adjust tab on the right. The graph shows how many pixels the picture has of each tone, dark on the left.',
      'If the graph does not reach the left or right edge, the picture is flat. Move Black point up to where the graph starts and White point down to where it ends. Auto does this for you.',
      'Midtones makes the middle lighter (above 1) or darker (below 1) without moving black or white.',
      'Output black and Output white limit the darkest and lightest tones, for a faded look.',
    ],
    keywords: 'histogram black point white point gamma auto contrast faded',
  },
  {
    id: 'curves',
    title: 'Curves',
    category: 'Colour and tone',
    summary: 'The most precise tone control: decide how bright every tone becomes.',
    steps: [
      'Select the image and open Curves in the Adjust tab on the right. Left to right is the picture’s tones from dark to light; height is how bright each one becomes.',
      'Click the line to add a point and drag it: up lightens those tones, down darkens them. Double-click a point to remove it.',
      'A gentle S (lower the darks, raise the lights) adds contrast. Dragging an end point limits the darkest or lightest tone.',
      'Switch from RGB to Red, Green or Blue to change one colour channel, for colour grading.',
    ],
    tips: ['Levels and curves work together with the Adjustments sliders: levels are applied first, then curves.'],
    keywords: 'tone curve s-curve channel rgb contrast grading',
  },

  // ---------- Cut-outs and masks ----------
  {
    id: 'remove-background',
    title: 'Remove a background',
    category: 'Cut-outs and masks',
    summary: 'Cut the subject out of a photo, or click the things you want yourself. It runs in your browser; the photo is not uploaded.',
    steps: [
      'Select the photo. On the right, in the Cut out tab under Mask, press “Remove background” (also in the AI tools tab). A dialog opens with the subject already selected: it is tinted green and outlined.',
      'A plain backdrop (a logo or graphic on one colour) is found exactly, by its colour, and everything but it is selected. For a photo, a small model finds the subject (its first run downloads the model).',
      'To select something else as well, click it. With “Click objects”, a click selects the whole thing under the pointer and leaves a point there. Click more things, or more parts of one thing, until the green covers what you want.',
      'To take a thing out of the selection, set “Take away” (or hold Alt) and click it. “Less” and “More” make a click take a smaller part or a larger whole, and the “Brush” paints the selection by hand where clicking does not get it right.',
      'Under “The selection is”, choose “Kept” (everything else is removed) or “Removed” (only the selection goes). “Result” shows the cut-out as it will be.',
      'Press “Apply”. The background is hidden with a mask; the photo itself is intact, so disabling or deleting the mask gets everything back.',
      'To change your choice later, select the photo and press “Edit background removal”: the dialog opens on the cut-out as you left it.',
    ],
    tips: [
      'To pick things from scratch, press Clear: nothing is selected, and each click adds the thing you click.',
      'Clicking objects becomes available a few seconds after the dialog opens, while the picture is analysed (the first time also downloads a small model). The brush works straight away.',
      'In the dialog the mouse wheel zooms and holding Space while dragging moves the view. Ctrl + Z undoes a step. Shift adds and Alt takes away for as long as it is held.',
      'If the suggestion treats a logo as a photo or the other way round, cancel, open the AI tools tab, set Method to “Find the subject (photos)” or “Plain background (logos)”, and press the button again.',
      'After applying, “Hold to compare with original” shows the photo without the mask, and the Brush and Eraser still work on the mask for fine touch-ups: black hides and white reveals.',
    ],
    keywords: 'cutout cut out transparent subject isolate object choose keep click select which',
    show: { tab: 'ai', label: 'Open AI tools' },
  },
  {
    id: 'replace-background',
    title: 'Replace a background',
    category: 'Cut-outs and masks',
    summary: 'Put a colour, a gradient or another picture behind a cut-out.',
    steps: [
      'Remove the background first (previous entry).',
      'For a colour or gradient: click an empty part of the canvas and set Background on the right, or pick one in the Backgrounds tab.',
      'For a picture: add it from Uploads, then drag its row below the cut-out in the Layers panel.',
      'For a texture or pattern: use the Backgrounds or Textures tab, then drag that row below the cut-out.',
    ],
    keywords: 'swap change backdrop behind',
    show: { tab: 'backgrounds', label: 'Open Backgrounds' },
  },
  {
    id: 'mask',
    title: 'Layer masks (hide and reveal)',
    category: 'Cut-outs and masks',
    summary: 'Hide parts of an image without erasing anything.',
    steps: [
      'Select the image. On the right, in the Cut out tab under Mask, press “Add layer mask”.',
      'Press “Paint mask” (or B). Paint on the image: black hides, white reveals. X switches between the two.',
      'Use a low Hardness for soft edges. The Feather slider softens the whole mask.',
      'Show mask displays it in greyscale; “Hold to compare with original” shows the layer without it while pressed. Invert swaps hidden and shown; Delete mask removes it.',
    ],
    tips: ['“Apply” bakes the mask into a new image. It is the one step here that changes pixels, and it can be undone.'],
    shortcuts: [
      { keys: 'B', does: 'Brush' },
      { keys: 'X', does: 'Switch between hide and reveal' },
      { keys: '[ / ]', does: 'Smaller / larger brush' },
      { keys: 'Ctrl + I', does: 'Invert the mask being edited' },
    ],
    keywords: 'hide reveal non-destructive feather invert',
    show: { tool: 'brush', label: 'Use the Brush' },
  },
  {
    id: 'eraser',
    title: 'Eraser',
    category: 'Cut-outs and masks',
    summary: 'Rub out parts of an image by hand. It works through a mask, so anything erased can be brought back.',
    steps: [
      'Select an image and press E, or click the Eraser in the top bar.',
      'Drag over what you want gone. The first stroke adds a mask to the layer automatically.',
      'Set Size, Hardness and Opacity in the bar above the canvas.',
      'To bring something back, switch the bar from Erase to Restore, or hold Alt while erasing.',
    ],
    shortcuts: [
      { keys: 'E', does: 'Eraser' },
      { keys: 'Alt', does: 'Restore instead of erase, while held' },
    ],
    keywords: 'erase rub out delete part manual',
    show: { tool: 'eraser', label: 'Use the Eraser' },
  },
  {
    id: 'paint',
    title: 'Paint',
    category: 'Cut-outs and masks',
    summary: 'Draw freehand on its own layer.',
    steps: [
      'Press B, or click the Brush in the top bar. With nothing paintable selected, the first stroke creates a paint layer.',
      'Choose the colour, Size, Hardness, Opacity, Flow and Smoothing in the bar above the canvas.',
      'A paint layer is a normal layer: move it, blend it, mask it, erase from it.',
    ],
    keywords: 'draw brush freehand sketch',
    show: { tool: 'brush', label: 'Use the Brush' },
  },

  // ---------- Selections ----------
  {
    id: 'select',
    title: 'Select an area',
    category: 'Selections',
    summary: 'Mark part of the canvas to work on: a rectangle, an ellipse, a freehand or straight-edged shape, or an area of one colour.',
    steps: [
      'Marquee (M): drag a rectangle. Press M again, or choose Ellipse in the bar, for an ellipse.',
      'Lasso (L): drag around the area. Switch to Polygon in the bar to click from corner to corner instead; double-click, press Enter or click the first corner to close it.',
      'Magic wand (W): click a colour to select the connected area of it. Tolerance sets how similar colours must be; switch Contiguous off to select that colour everywhere.',
      'Hold Shift to add to the selection, Alt to take away from it, both to keep only the overlap.',
      'The moving outline shows what is selected. Click once with a selection tool, or press Ctrl + D, to deselect.',
    ],
    shortcuts: [
      { keys: 'M / L / W', does: 'Marquee / lasso / magic wand' },
      { keys: 'Ctrl + A', does: 'Select the whole canvas (with a selection tool active)' },
      { keys: 'Ctrl + Shift + I', does: 'Invert the selection' },
      { keys: 'Ctrl + D', does: 'Deselect' },
    ],
    keywords: 'marquee lasso polygon magic wand rectangle ellipse area marching ants',
    show: { tool: 'marquee', label: 'Use the Marquee' },
  },
  {
    id: 'select-subject',
    title: 'Select an object',
    category: 'Selections',
    summary: 'Let the editor find the main subject, or pick an object out by hand.',
    steps: [
      'Select the photo, pick any selection tool (M, L or W), then press “Select subject” in the Select tab on the right. It finds the main subject and selects it.',
      'For another object, use the magic wand on its colour (Shift-click to add more), or trace it with the lasso.',
      '“Select layer” selects the exact outline of whatever the selected layer draws: a cut-out, text, a shape.',
      'Tidy the result with Expand, Contract and Feather in the same panel.',
    ],
    tips: ['“Select subject” finds one main subject per photo. It cannot yet pick an arbitrary object by clicking on it.'],
    keywords: 'object subject person auto select automatic',
    show: { tool: 'marquee', label: 'Use a selection tool' },
  },
  {
    id: 'use-selection',
    title: 'Use a selection',
    category: 'Selections',
    summary: 'Mask, cut out, copy or fill the selected area.',
    steps: [
      'Make a selection and select one image layer. The Select tab on the right shows what you can do.',
      '“Mask to selection” shows the layer only inside the selection; “Hide area” (or Delete) hides the selected part.',
      '“Copy to layer” (Ctrl + J) and “Cut to layer” (Ctrl + Shift + J) put the selected part on a layer of its own.',
      '“Fill” adds a layer of the chosen colour in the selected shape.',
      'While something is selected, the Brush and Eraser only affect the inside of the selection.',
    ],
    tips: ['All of these work through masks or new layers: the image’s own pixels are never changed.'],
    keywords: 'cut copy paste fill mask from selection delete area',
    show: { tool: 'marquee', label: 'Use a selection tool' },
  },
  {
    id: 'saved-selections',
    title: 'Save a selection for later',
    category: 'Selections',
    summary: 'Keep a selection with the project and bring it back any time.',
    steps: [
      'With an area selected, press “Save selection” in the Selection panel.',
      'Saved selections are listed there whenever a selection tool is active. Click the name to rename one.',
      'Press Load to select it again. With the mode set to Add, Subtract or Intersect, it is combined with the current selection instead.',
    ],
    keywords: 'store reuse alpha channel load',
    show: { tool: 'marquee', label: 'Use a selection tool' },
  },

  // ---------- Remove, expand, upscale ----------
  {
    id: 'magic-eraser',
    title: 'Remove an object (magic eraser)',
    category: 'Remove, expand, upscale',
    summary: 'Make something disappear by filling it in from its surroundings. Runs on your computer, no AI service.',
    steps: [
      'Select the area around the unwanted thing with the lasso or marquee. Leave a little margin around it, and include its shadow.',
      'In the Select tab on the right, press “Content-aware fill”.',
      'A new layer covers the area with a continuation of what surrounds it. The layers underneath are untouched: delete the new layer to undo the removal.',
      'Press Ctrl + D to deselect.',
    ],
    tips: [
      'It works best when the surroundings are simple: sky, grass, sand, water, walls, fabric.',
      'It continues what is there; it cannot invent what was hidden. For that, use “Remove object” under AI in the same panel (needs the AI server).',
    ],
    keywords: 'erase object content aware fill inpaint remove person blemish unwanted heal',
    show: { tool: 'lasso', label: 'Use the Lasso' },
  },
  {
    id: 'expand',
    title: 'Expand an image',
    category: 'Remove, expand, upscale',
    summary: 'Make a picture larger than it was shot, to fill a canvas of another shape. Runs on your computer.',
    steps: [
      'Select the image and open Expand in the Layout tab on the right.',
      'Press “Fill the canvas” to grow it just far enough to cover the whole canvas, or type how far to grow each side and press “Expand sides”.',
      'The new area is built from the picture itself. What was already there does not move.',
    ],
    tips: ['Sky, ground, water and textures extend well. Distinct things at the edge (clouds, people, buildings) are smeared or repeated; crop or cover those parts.', 'The original stays in Uploads, and the step can be undone.'],
    keywords: 'outpaint extend bigger wider uncrop canvas fill borders',
  },
  {
    id: 'upscale',
    title: 'Upscale an image',
    category: 'Remove, expand, upscale',
    summary: 'Make a small picture larger and sharper with a model that runs on your computer.',
    steps: [
      'Select an uploaded image and open Upscale in the Layout tab on the right. It shows the current size.',
      'Press 2× or 4×. Progress and the time left are shown; Cancel stops it.',
      'The layer keeps its place, crop, mask and adjustments and gets the larger picture. The original stays in Uploads.',
    ],
    tips: ['Time depends on the size of the picture you start from: a few seconds for a thumbnail, a couple of minutes for a 1000 px photo.', 'It is offered up to 4096 px on the longer side.'],
    keywords: 'enlarge resolution sharpen bigger enhance super resolution quality',
  },

  // ---------- Text ----------
  {
    id: 'text',
    title: 'Add and edit text',
    category: 'Text',
    summary: 'Headings, body text and ready-made styles.',
    steps: [
      'Open the Text tab on the left and click a heading, subheading or body text, or one of the text styles.',
      'Double-click the text on the canvas to type. Click outside it when you are done.',
      'With the text selected, Typography in the Text tab on the right sets the font, size, weight, alignment, letter spacing and line height. Drag the side handles to change where lines wrap.',
    ],
    keywords: 'type font heading title caption size bold italic align spacing',
    show: { tab: 'text', label: 'Open Text' },
  },
  {
    id: 'text-style',
    title: 'Colour, outline and text effects',
    category: 'Text',
    summary: 'Gradients, outlines, shadows, glow, 3D, metallic and distressed text.',
    steps: [
      'Select the text. On the right, in the Text tab: Text colour sets a solid colour or a gradient, and Outline adds a stroke. Drop shadow is in the Style tab.',
      'Text effects has switches for Background (a panel behind the text), Glow, 3D depth, Fold, Metallic shine and Distress, each with its own controls.',
      'For a finished look in one click, use the Effect styles in the Text tab (Neon, Gold, Chrome, Retro 3D, Stamped, Soft glow).',
      'To fill text with a photo or texture, put the image above the text and clip it (see “Clipping masks”).',
    ],
    keywords: 'gradient stroke shadow glow neon gold chrome 3d metallic grunge highlight background',
    show: { tab: 'text', label: 'Open Text' },
  },
  {
    id: 'text-fold',
    title: 'Folded text',
    category: 'Text',
    summary: 'Cut a word in two and fold the lower half towards you, joined by a slanted band: a stepped, typographic 3D look.',
    steps: [
      'Select a text layer. Bold, tall, condensed fonts such as Anton or Bebas Neue work best.',
      'Open the Effects tab on the right and, under Text effects, switch on Fold. (Or click the FOLDED style in the Text tab to start from a finished one.)',
      'Cut at sets where the word is sliced. Drop sets how far the lower part comes down, and Spread how much larger it gets.',
      'Band tone makes the strip between the two halves lighter or darker than the text.',
      'The text stays text: change the words, the font or the colour and the fold follows. A gradient fill carries through the band.',
    ],
    tips: ['Combine it with 3D depth or Glow from the same section: they follow the folded shape.'],
    keywords: 'slice split step stair perspective stretch typographic illustrator fold 3d',
    show: { tab: 'text', label: 'Open Text' },
  },
  {
    id: 'text-shape',
    title: 'Warp text and put it on a path',
    category: 'Text',
    summary: 'Arcs, flags, bulges, circles and your own shapes.',
    steps: [
      'Select the text and open Warp in the Effects tab on the right. Choose a style (Arc, Arch, Bulge, Flag, Rise, Squeeze…) and set Bend.',
      'For any shape you like, choose Custom and press “Edit shape on canvas”, then drag the points around the text.',
      'To run text along a line instead, open “Text on a path” and choose a curve (drag its points on the canvas) or a circle.',
      'The vertical-text button in Typography stacks the letters top to bottom.',
    ],
    keywords: 'curve arc circle bend envelope distort vertical',
    show: { tab: 'text', label: 'Open Text' },
  },
  {
    id: 'text-in-shape',
    title: 'Shape text like a picture (text logo)',
    category: 'Text',
    summary: 'Make a word take the shape of an image, a cut-out or an icon: the letters stretch to fill its outline.',
    steps: [
      'Add the picture whose shape you want: a cut-out (remove its background first), a shape, an icon or a sticker.',
      'Add your text and select it. Bold fonts fill a shape best.',
      'Open Warp in the Effects tab on the right. Under “Shape of another layer”, choose that layer and press “Fit text to this shape”.',
      'The text is moved over the picture and stretched to fill its outline. Hide the picture’s layer (the eye in the Layers panel) to leave just the word, or keep it underneath in another colour.',
      'Retype the text, change its font or colour: it keeps filling the same shape. Drag a corner to resize the whole thing.',
    ],
    tips: [
      'It follows the top and bottom edge of the shape. A shape with a simple outline (a fish, a leaf, a heart, a car) reads best; holes inside the shape are ignored.',
      'A photo with its background still on is a rectangle, so remove the background first.',
    ],
    keywords: 'logo shape envelope silhouette fit text inside shape wordmark shark illustrator make with top object',
    show: { tab: 'text', label: 'Open Text' },
  },
  {
    id: 'fonts',
    title: 'Use your own fonts',
    category: 'Text',
    summary: 'Upload a font file and use it like the built-in ones.',
    steps: ['Select a text layer and open the font list in Typography.', 'At the bottom of the list, upload a TTF, OTF, WOFF or WOFF2 file. It is then listed under the Uploaded group.', 'The font is kept in this browser and is used on the canvas and in exports.'],
    tips: ['Only upload fonts you have the right to use.'],
    keywords: 'custom typeface ttf otf brand',
  },

  // ---------- Library ----------
  {
    id: 'elements',
    title: 'Shapes, icons and graphics',
    category: 'Library',
    summary: 'Shapes, 157 icons, stickers, frames, illustrations and geometric decorations, all recolourable.',
    steps: [
      'Open the Elements tab and click (or drag) anything onto the canvas. Use the search box or the category chips to find it.',
      'With it selected, set its colours, outline and, for shapes, corners and sides on the right.',
      'Click the star on a tile to keep it under Favourites; Recent lists what you used last.',
      'To reuse something of your own, select the layers and press “Save selection to My assets” in the Elements tab.',
    ],
    keywords: 'rectangle circle star arrow line icon sticker badge frame illustration favourite my assets',
    show: { tab: 'elements', label: 'Open Elements' },
  },
  {
    id: 'textures',
    title: 'Textures and overlays',
    category: 'Library',
    summary: 'Paper, grain, grunge, light leaks, dust and more, each as its own editable layer.',
    steps: [
      'Open the Textures or Overlays tab and click one. It is added as a layer over the design with a suitable blend mode.',
      'On the right, in the Style tab, change its colours, opacity and blend mode, or regenerate it for a different pattern.',
      'To keep it off part of the design, add a layer mask and paint it away there. To keep it inside one layer, clip it to that layer.',
    ],
    keywords: 'grunge paper grain noise halftone light leak dust scratches film',
    show: { tab: 'textures', label: 'Open Textures' },
  },
  {
    id: 'backgrounds',
    title: 'Backgrounds',
    category: 'Library',
    summary: 'Solid colours, gradients and generated patterns behind the design.',
    steps: ['Open the Backgrounds tab.', 'Click a solid colour or gradient to set the canvas background, or a generated background to add it as a layer at the bottom.', 'For any colour or gradient of your own, click an empty part of the canvas and use Background on the right.'],
    keywords: 'gradient pattern colour backdrop',
    show: { tab: 'backgrounds', label: 'Open Backgrounds' },
  },
  {
    id: 'templates',
    title: 'Templates',
    category: 'Library',
    summary: 'Finished layouts for posters, covers, social posts, thumbnails, flyers, cards and more. Every part stays editable.',
    steps: [
      'On the home page, pick one under “Start from a template” to begin a new project with it.',
      'Inside the editor, open the Templates tab and click one. It replaces the current design (you are asked first, and Ctrl + Z brings the old one back).',
      'Double-click any text to change it; select any element to restyle, move or delete it.',
    ],
    keywords: 'layout preset poster cover thumbnail flyer invitation certificate',
    show: { tab: 'templates', label: 'Open Templates' },
  },

  // ---------- Generative AI ----------
  {
    id: 'generative-fill',
    title: 'Generative fill and AI object removal',
    category: 'Generative AI',
    summary: 'Replace an area with something you describe, or remove an object and have the background invented.',
    needs: 'Needs the Prysm AI server and a provider key (see the AI tools tab). Everything else in the editor works without it.',
    steps: [
      'Select the area to change with a selection tool.',
      'In the Select tab on the right, under AI, describe what should appear and press “Generative fill”, or press “Remove object”.',
      'The result arrives as a new layer masked to your selection; nothing underneath is changed.',
    ],
    tips: ['These send your description and the visible part of the design around the selection to the AI provider.', 'To remove something without any AI service, use “Content-aware fill” instead.'],
    keywords: 'ai inpaint replace describe prompt',
    show: { tab: 'ai', label: 'Open AI tools' },
  },
  {
    id: 'generate-image',
    title: 'Generate an image from a description',
    category: 'Generative AI',
    summary: 'Create a new picture from words.',
    needs: 'Needs the Prysm AI server and a provider key (see the AI tools tab).',
    steps: ['Open the AI tools tab.', 'Under “Generate an image”, describe the picture, choose Square, Wide or Tall, and press “Generate image”.', 'It is added as a normal image layer and kept in Uploads.'],
    keywords: 'ai text to image create prompt',
    show: { tab: 'ai', label: 'Open AI tools' },
  },

  // ---------- Export ----------
  {
    id: 'export',
    title: 'Export your design',
    category: 'Export',
    summary: 'Save the finished design as PNG, JPG, WebP or PDF.',
    steps: [
      'Press Export (top right).',
      'Choose the format: PNG for graphics and transparency, JPG for photos and small files, WebP for the web, PDF for printing or sharing.',
      'Choose the size (1× is the canvas size; 2× and above give more pixels). For PNG and WebP, “Transparent background” leaves out the canvas background.',
      'Press the Export button; the file downloads.',
    ],
    keywords: 'download save png jpg jpeg webp pdf print transparent resolution',
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    category: 'Export',
    summary: 'The keys worth knowing.',
    steps: ['Tools: V move, H hand, B brush, E eraser, M marquee, L lasso, W magic wand, C crop.', 'Shortcuts do nothing while you are typing in a field or editing text.'],
    shortcuts: [
      { keys: 'Ctrl + Z / Ctrl + Shift + Z', does: 'Undo / redo' },
      { keys: 'Ctrl + C / X / V', does: 'Copy / cut / paste layers' },
      { keys: 'Ctrl + D', does: 'Duplicate (or deselect, when an area is selected)' },
      { keys: 'Ctrl + G / Ctrl + Shift + G', does: 'Group / ungroup' },
      { keys: 'Ctrl + Alt + G', does: 'Clip to the layer below' },
      { keys: 'Alt + Shift + M / S / O / N', does: 'Blend mode: Multiply / Screen / Overlay / Normal (more under “Opacity and blending images”)' },
      { keys: 'Ctrl + J / Ctrl + Shift + J', does: 'Copy / cut the selected area to a new layer' },
      { keys: 'Ctrl + Shift + I', does: 'Invert the selection' },
      { keys: 'Ctrl + 0 / Ctrl + 1', does: 'Fit to screen / 100%' },
      { keys: 'Ctrl + \\', does: 'Hide or show the panels' },
      { keys: '[ / ]', does: 'Brush size' },
      { keys: 'X', does: 'Mask brush: hide / reveal' },
      { keys: 'F1', does: 'Open this guide' },
    ],
    keywords: 'keys hotkeys keyboard',
  },
];

export const GUIDE_MAP = new Map(GUIDE.map((topic) => [topic.id, topic]));

/** Topics matching a search, best first: title matches, then keywords and summary, then steps. */
export function searchGuide(query: string): GuideTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return GUIDE;
  const scored = GUIDE.map((topic) => {
    const title = topic.title.toLowerCase();
    const near = `${topic.keywords ?? ''} ${topic.summary} ${topic.category}`.toLowerCase();
    const body = `${topic.steps.join(' ')} ${(topic.tips ?? []).join(' ')}`.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (title.includes(word)) score += 5;
      else if (near.includes(word)) score += 3;
      else if (body.includes(word)) score += 1;
      else return { topic, score: 0 };
    }
    return { topic, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.topic);
}

/** Which guide entry explains each sidebar panel and each section of the right-hand panel (by its title). */
export const PANEL_HELP: Record<string, string> = {
  Templates: 'templates',
  Elements: 'elements',
  Text: 'text',
  Uploads: 'upload',
  Backgrounds: 'backgrounds',
  Textures: 'textures',
  Overlays: 'textures',
  Effects: 'effects',
  'AI tools': 'remove-background',
};

export const SECTION_HELP: Record<string, string> = {
  Size: 'canvas',
  Background: 'canvas',
  Arrange: 'arrange',
  'Position & size': 'arrange',
  Blending: 'blend',
  'Drop shadow': 'frame',
  Frame: 'frame',
  Border: 'frame',
  Mask: 'mask',
  Fade: 'fade',
  Crop: 'crop',
  Adjustments: 'adjust',
  Levels: 'levels',
  Curves: 'curves',
  Effects: 'effects',
  Expand: 'expand',
  Upscale: 'upscale',
  Texture: 'textures',
  Overlay: 'textures',
  Typography: 'text',
  'Text colour': 'text-style',
  Outline: 'text-style',
  'Text effects': 'text-style',
  Warp: 'text-shape',
  'Text on a path': 'text-shape',
  Fill: 'elements',
  Stroke: 'elements',
  Geometry: 'elements',
  Icon: 'elements',
  Colours: 'elements',
  Select: 'select',
  'Saved selections': 'saved-selections',
  Adjust: 'select-subject',
  'Use on layer': 'use-selection',
  'Fill and remove': 'magic-eraser',
  AI: 'generative-fill',
};
