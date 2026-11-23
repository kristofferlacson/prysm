/**
 * Text warp: bending editable text into a shape. Geometry is verified against the warp formulas
 * in exported pixels, not just by checking that the document changed.
 */
import { fmt, helpers, launch, makeReporter, near, openEditor, rgbNear, state, toScreen, waitForSaved } from './harness.mjs';

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);
const props = page.locator('[data-testid="properties-panel"]');
const shape = () => props.getByLabel('Warp shape');
const past = async () => (await state(page)).past;

/** Measures the ink (opaque pixels) of an exported image: bounding box, per-column extent, polar extent. */
const analyse = (buffer, centre = null) =>
  page.evaluate(
    async ({ b64, centre }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none' });
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const top = new Array(c.width).fill(-1);
      const bottom = new Array(c.width).fill(-1);
      // Coverage-weighted measurements locate ink to a fraction of a pixel.
      const len = new Array(c.width).fill(0);
      const mid = new Array(c.width).fill(0);
      const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      const polar = { rMin: Infinity, rMax: -Infinity, aMin: Infinity, aMax: -Infinity };
      let ink = 0;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const alpha = data[(y * c.width + x) * 4 + 3];
          len[x] += alpha / 255;
          mid[x] += (alpha / 255) * (y + 0.5);
          if (alpha <= 128) continue;
          ink++;
          if (top[x] < 0) top[x] = y;
          bottom[x] = y;
          if (x < box.left) box.left = x;
          if (x > box.right) box.right = x;
          if (y < box.top) box.top = y;
          if (y > box.bottom) box.bottom = y;
          if (centre) {
            const dx = x + 0.5 - centre.x;
            const dy = centre.y - (y + 0.5);
            const r = Math.hypot(dx, dy);
            const a = Math.atan2(dx, dy);
            if (r < polar.rMin) polar.rMin = r;
            if (r > polar.rMax) polar.rMax = r;
            if (a < polar.aMin) polar.aMin = a;
            if (a > polar.aMax) polar.aMax = a;
          }
        }
      }
      for (let x = 0; x < c.width; x++) if (len[x]) mid[x] /= len[x];
      return { width: c.width, height: c.height, top, bottom, len, mid, box, polar, ink };
    },
    { b64: buffer.toString('base64'), centre },
  );

/** Average number of half-transparent pixels per glyph edge along one row: how soft the edges are. */
const softness = (buffer, y, upscale = 1) =>
  page.evaluate(
    async ({ b64, y, upscale }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none' });
      const c = document.createElement('canvas');
      c.width = bmp.width * upscale;
      c.height = bmp.height * upscale;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const row = ctx.getImageData(0, Math.round(y * upscale), c.width, 1).data;
      let partial = 0;
      let edges = 0;
      let inside = false;
      for (let x = 0; x < c.width; x++) {
        const a = row[x * 4 + 3];
        if (a > 40 && a < 215) partial++;
        if (a > 128 !== inside) {
          inside = !inside;
          edges++;
        }
      }
      return { partial, edges, perEdge: edges ? partial / edges : 0 };
    },
    { b64: buffer.toString('base64'), y, upscale },
  );

/** Like softness, but down one column: how many half-transparent pixels each top or bottom edge takes. */
const softColumn = (buffer, x) =>
  page.evaluate(
    async ({ b64, x }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none' });
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const col = ctx.getImageData(x, 0, 1, c.height).data;
      let partial = 0;
      let edges = 0;
      let inside = false;
      for (let y = 0; y < c.height; y++) {
        const a = col[y * 4 + 3];
        if (a > 40 && a < 215) partial++;
        if (a > 128 !== inside) {
          inside = !inside;
          edges++;
        }
      }
      return { partial, edges, perEdge: edges ? partial / edges : 0 };
    },
    { b64: buffer.toString('base64'), x },
  );

const clear = (opts = {}) => h.exportPng([], { transparent: true, ...opts });
const hump = (v) => 1 - (2 * v - 1) ** 2;
/** Columns well inside a full-height stem of the letter H in the flat text (not on a stem's edge). */
const stemColumns = (a) => {
  const tallest = Math.max(...a.top.map((y, x) => (y < 0 ? 0 : a.bottom[x] - y)));
  const full = a.top.map((y, x) => y >= 0 && a.bottom[x] - y >= tallest * 0.97);
  return full.map((ok, x) => (ok && full[x - 2] && full[x - 1] && full[x + 1] && full[x + 2] ? x : -1)).filter((x) => x >= 0);
};

let T; // the text layer
let flat; // analysis of the unwarped export
let stems;
let flat2; // the same at 2x, where the browser's whole-pixel text positioning matters least
let stems2;
const W = 700;
const X = 50;
const Y = 200;

await section('Setup', async () => {
  await page.locator('[data-testid="canvas-size"]').click();
  await h.setField('Canvas width', 800);
  await h.setField('Canvas height', 600);
  await h.openTab('text');
  await page.getByRole('button', { name: 'Add a heading' }).click();
  T = (await h.layers()).at(-1);
  await h.patch(T.id, { text: 'HHHHHHHH', fontSize: 100, width: W, x: X, y: Y, align: 'center', fill: { type: 'solid', color: '#ff0000' } });
  await page.evaluate(() => document.fonts.ready);
  await h.settle(500);
  T = await h.layerById(T.id);
  t.check('a new text layer has no warp', T.warp === null && (await state(page)).doc.schemaVersion === 6);
  flat = await analyse((await clear()).buffer);
  stems = stemColumns(flat);
  flat2 = await analyse((await clear({ scale: '2×' })).buffer);
  stems2 = stemColumns(flat2);
  t.check('(the flat text is measurable)', stems.length > 40 && flat.ink > 5000, `${stems.length} stem columns, text box ${T.width}x${T.height}`);
});

await section('Choose a warp shape', async () => {
  await h.selectRow(T.id);
  const order = await props.locator('section > div:first-child').allTextContents();
  t.check('Warp sits directly under Typography', order.indexOf('Warp') === order.indexOf('Typography') + 1, order.join(' > '));
  t.check('the text properties offer a Warp section', (await shape().inputValue()) === 'none');
  const options = await shape().locator('option').allTextContents();
  t.check('nine shapes plus None are offered', options.length === 10 && options.includes('Arc') && options.includes('Flag'), options.join(', '));
  const before = await past();
  await shape().selectOption('arch');
  let l = await h.layerById(T.id);
  t.check('choosing a shape stores it on the layer', l.warp?.style === 'arch' && l.warp.bend === 0.5 && (await past()) === before + 1, JSON.stringify(l.warp));
  t.check('the text itself is unchanged', l.text === 'HHHHHHHH' && l.fontSize === 100 && l.width === W);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  t.check('undo removes the warp', (await h.layerById(T.id)).warp === null);
  await page.keyboard.press('Control+Shift+z');
  t.check('redo restores it', (await h.layerById(T.id)).warp?.style === 'arch');
});

await section('Arch: every column shifts by the formula', async () => {
  const l = await h.layerById(T.id);
  const a = await analyse((await clear()).buffer);
  // Arch moves each column vertically by -bend * 0.6 * h * (hump(x) - 0.5) and leaves x alone.
  const compare = (warped, reference, columns, scale) => {
    let worst = 0;
    let bias = 0;
    let lengthChange = 0;
    for (const x of columns) {
      const expected = reference.mid[x] - 0.5 * 0.6 * l.height * scale * (hump(((x + 0.5) / scale - X) / W) - 0.5);
      worst = Math.max(worst, Math.abs(warped.mid[x] - expected));
      bias += (warped.mid[x] - expected) / columns.length;
      lengthChange = Math.max(lengthChange, Math.abs(warped.len[x] - reference.len[x]));
    }
    return { worst, bias, lengthChange, text: `worst error ${worst.toFixed(3)} px, mean error ${bias.toFixed(3)} px, length change up to ${lengthChange.toFixed(3)} px over ${columns.length} columns` };
  };
  const a2 = await analyse((await clear({ scale: '2×' })).buffer);
  const fine = compare(a2, flat2, stems2, 2);
  t.check('at 2× every stem follows the arch formula to a fraction of a pixel', fine.worst <= 0.35 && Math.abs(fine.bias) <= 0.1 && fine.lengthChange <= 0.35, fine.text);
  // At 1× the browser places unwarped text on whole pixel rows, so the two can sit up to half a pixel apart.
  const coarse = compare(a, flat, stems, 1);
  t.check('at 1× it is within the half pixel of whole-row text positioning', coarse.worst <= 0.75 && Math.abs(coarse.bias) <= 0.55 && coarse.lengthChange <= 0.5, coarse.text);
  t.check('the horizontal extent is unchanged', near(a.box.left, flat.box.left, 1) && near(a.box.right, flat.box.right, 1), `${a.box.left}-${a.box.right} vs ${flat.box.left}-${flat.box.right}`);
  const rise = flat.top[stems[Math.floor(stems.length / 2)]] - a.top[stems[Math.floor(stems.length / 2)]];
  t.check('the middle rises and the ends drop', rise > 12 && a.top[stems[0]] > flat.top[stems[0]] + 5, `middle +${rise}px, left end ${flat.top[stems[0]] - a.top[stems[0]]}px`);
});

await section('Bend and distortion controls', async () => {
  await h.selectRow(T.id);
  const before = await past();
  await h.setField('Bend value', -100, props);
  let l = await h.layerById(T.id);
  t.check('bend is editable from -100 to 100', l.warp.bend === -1 && (await past()) === before + 1);
  let a = await analyse((await clear()).buffer);
  const mid = stems[Math.floor(stems.length / 2)];
  const expected = flat.top[mid] + 1 * 0.6 * l.height * (hump((mid + 0.5 - X) / W) - 0.5);
  t.check('a negative bend arches the other way', near(a.top[mid], expected, 1.2), `${a.top[mid]} vs ${expected.toFixed(1)}`);

  await h.setField('Bend value', 0, props);
  a = await analyse((await clear()).buffer);
  t.check('bend 0 is exactly the flat text', a.ink === flat.ink && a.box.top === flat.box.top && a.box.left === flat.box.left, `${a.ink} vs ${flat.ink} ink pixels`);

  await h.setField('Horizontal value', 60, props);
  l = await h.layerById(T.id);
  a = await analyse((await clear()).buffer);
  const left = stems[0];
  const right = stems.at(-1);
  const hl = a.bottom[left] - a.top[left];
  const hr = a.bottom[right] - a.top[right];
  const fl = flat.bottom[left] - flat.top[left];
  const kl = 1 + 0.6 * 0.9 * ((2 * (left + 0.5 - X)) / W - 1);
  const kr = 1 + 0.6 * 0.9 * ((2 * (right + 0.5 - X)) / W - 1);
  t.check('horizontal distortion tapers the text height across its width', near(hl, fl * kl, 2) && near(hr, fl * kr, 2), `left ${hl} (expect ${(fl * kl).toFixed(1)}), right ${hr} (expect ${(fl * kr).toFixed(1)})`);
  await h.setField('Horizontal value', 0, props);
  await h.setField('Vertical value', 50, props);
  a = await analyse((await clear()).buffer);
  t.check('vertical distortion changes the width from top to bottom', a.box.right - a.box.left > flat.box.right - flat.box.left + 20, `${a.box.right - a.box.left} vs ${flat.box.right - flat.box.left}`);
  await h.setField('Vertical value', 0, props);
});

await section('Arc: text wraps around a true circle', async () => {
  await h.selectRow(T.id);
  await shape().selectOption('arc');
  await h.setField('Bend value', 50, props);
  const l = await h.layerById(T.id);
  const R = W / (0.5 * Math.PI);
  const centre = { x: X + W / 2, y: Y + l.height / 2 + R };
  const a = await analyse((await clear()).buffer, centre);
  // Ink that sat between flat.box.top and flat.box.bottom must now lie between two radii.
  const rOuter = R - (flat.box.top - Y - l.height / 2);
  const rInner = R - (flat.box.bottom + 1 - Y - l.height / 2);
  t.check('ink lies between the two predicted radii', near(a.polar.rMax, rOuter, 1.5) && near(a.polar.rMin, rInner, 1.5), `r ${a.polar.rMin.toFixed(1)}..${a.polar.rMax.toFixed(1)} vs ${rInner.toFixed(1)}..${rOuter.toFixed(1)}`);
  const aLeft = (flat.box.left - X - W / 2) / R;
  const aRight = (flat.box.right + 1 - X - W / 2) / R;
  t.check('the text spans the predicted angle', near(a.polar.aMin, aLeft, 0.006) && near(a.polar.aMax, aRight, 0.006), `${a.polar.aMin.toFixed(4)}..${a.polar.aMax.toFixed(4)} rad vs ${aLeft.toFixed(4)}..${aRight.toFixed(4)}`);
  // A 50% bend wraps the 700 px box around a quarter circle; the letters cover their share of it.
  const inkShare = (flat.box.right + 1 - flat.box.left) / W;
  const sweep = (a.polar.aMax - a.polar.aMin) * (180 / Math.PI);
  t.check('a 50% bend wraps the text box around a quarter circle', near(sweep, 90 * inkShare, 0.6), `letters sweep ${sweep.toFixed(1)}° = ${(inkShare * 100).toFixed(0)}% of 90°`);

  // The editor shows what the export contains.
  const inkPoint = [X + W / 2 + rOuter * Math.sin(aLeft + 0.01) * 0.985, centre.y - rOuter * Math.cos(aLeft + 0.01) * 0.985];
  const emptyPoint = [X + W / 2, Y - 60];
  const file = (await h.exportPng([inkPoint, emptyPoint])).pixels;
  const screen = await h.screenPixels([inkPoint, emptyPoint]);
  t.check('the editor canvas matches the export', rgbNear(screen[0], file[0], 12) && rgbNear(screen[1], file[1], 4) && rgbNear(file[0], [255, 0, 0], 12), `${screen.map(fmt).join(' ')} vs ${file.map(fmt).join(' ')}`);
});

await section('Every preset shape renders', async () => {
  await h.selectRow(T.id);
  const seen = new Map();
  for (const style of ['arc', 'arc-lower', 'arc-upper', 'arch', 'bulge', 'flag', 'rise', 'squeeze']) {
    await shape().selectOption(style);
    const a = await analyse((await clear()).buffer);
    seen.set(style, `${a.box.left},${a.box.top},${a.box.right},${a.box.bottom},${a.ink}`);
    if (a.ink < flat.ink * 0.4) t.check(`${style} keeps the text visible`, false, `${a.ink} ink pixels`);
  }
  t.check('each shape produces a different picture', new Set(seen.values()).size === 8 && ![...seen.values()].includes(`${flat.box.left},${flat.box.top},${flat.box.right},${flat.box.bottom},${flat.ink}`), [...seen.entries()].map(([k, v]) => `${k}:${v}`).join(' | '));
});

await section('Sharp at every export size', async () => {
  await h.selectRow(T.id);
  await shape().selectOption('arch');
  const one = await clear();
  const two = await clear({ scale: '2×' });
  const a1 = await analyse(one.buffer);
  const a2 = await analyse(two.buffer);
  t.check('a 2× export is the same picture at twice the size', near(a2.box.left, a1.box.left * 2, 3) && near(a2.box.right, a1.box.right * 2 + 1, 3) && near(a2.box.top, a1.box.top * 2, 3) && near(a2.box.bottom, a1.box.bottom * 2 + 1, 3), JSON.stringify(a2.box));
  const row = Math.round((a1.box.top + a1.box.bottom) / 2);
  const native = await softness(two.buffer, row * 2);
  const enlarged = await softness(one.buffer, row, 2);
  t.check('2× is drawn at 2×, not enlarged from the 1× picture', native.edges >= 8 && native.perEdge < enlarged.perEdge * 0.75, `${native.perEdge.toFixed(2)} soft px per edge vs ${enlarged.perEdge.toFixed(2)} when enlarged`);
});

await section('Custom shape: drag points on the canvas', async () => {
  await h.selectRow(T.id);
  const archInk = await analyse((await clear()).buffer);
  const before = await past();
  await props.getByRole('button', { name: 'Edit shape on canvas' }).click();
  let l = await h.layerById(T.id);
  t.check('"Edit shape on canvas" switches to the custom envelope: a 16-point patch', l.warp.style === 'custom' && l.warp.mesh?.length === 32 && (await past()) === before + 1);
  const fitted = await analyse((await clear()).buffer);
  let worst = 0;
  for (const x of stems) worst = Math.max(worst, Math.abs(fitted.top[x] - archInk.top[x]));
  t.check('switching to Custom keeps the shape that was on the canvas', worst <= 1.5, `worst difference ${worst.toFixed(2)} px`);

  // Drag the top-left corner up and to the left.
  const mesh = l.warp.mesh;
  const from = await toScreen(page, X + mesh[0] * W, Y + mesh[1] * l.height);
  const v = await page.evaluate(() => window.__prysm.ui.getState().zoom);
  const history = await past();
  await h.drag(from, { x: from.x - 40 * v, y: from.y - 30 * v });
  l = await h.layerById(T.id);
  const dx = l.warp.mesh[0] - mesh[0];
  const dy = l.warp.mesh[1] - mesh[1];
  t.check('dragging a corner moves that point of the patch', near(dx * W, -40, 1.5) && near(dy * l.height, -30, 1.5), `moved ${(dx * W).toFixed(1)}, ${(dy * l.height).toFixed(1)} px`);
  const followers = [1, 4, 5].every((p) => near(l.warp.mesh[p * 2] - mesh[p * 2], dx, 1e-6) && near(l.warp.mesh[p * 2 + 1] - mesh[p * 2 + 1], dy, 1e-6));
  const others = [2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].every((p) => l.warp.mesh[p * 2] === mesh[p * 2] && l.warp.mesh[p * 2 + 1] === mesh[p * 2 + 1]);
  t.check('its tangent handles travel with it; the rest stays put', followers && others);
  t.check('a drag is one undo step', (await past()) === history + 1, `${(await past()) - history} steps`);
  t.check('the layer itself did not move', l.x === X && l.y === Y && l.width === W);
  const dragged = await analyse((await clear()).buffer);
  t.check('the text follows the dragged corner', dragged.box.left < fitted.box.left - 15 && near(dragged.box.right, fitted.box.right, 2), `left edge ${fitted.box.left} -> ${dragged.box.left}`);

  // Drag an edge handle (the first tangent handle on the bottom edge) downwards.
  const m2 = l.warp.mesh;
  const hFrom = await toScreen(page, X + m2[13 * 2] * W, Y + m2[13 * 2 + 1] * l.height);
  await h.drag(hFrom, { x: hFrom.x, y: hFrom.y + 50 * v });
  l = await h.layerById(T.id);
  t.check('dragging an edge handle bends that edge', near((l.warp.mesh[27] - m2[27]) * l.height, 50, 1.5) && l.warp.mesh[24] === m2[24] && l.warp.mesh[25] === m2[25], `handle moved ${((l.warp.mesh[27] - m2[27]) * l.height).toFixed(1)} px, corner unchanged`);
  const bent = await analyse((await clear()).buffer);
  t.check('the bottom of the text bulges down', bent.box.bottom > dragged.box.bottom + 4, `${dragged.box.bottom} -> ${bent.box.bottom}`);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  t.check('both drags undo', (await h.layerById(T.id)).warp.mesh.every((n, i) => n === mesh[i]));
  await page.keyboard.press('Control+Shift+z');

  await props.getByRole('button', { name: 'Reset shape' }).click();
  l = await h.layerById(T.id);
  const reset = await analyse((await clear()).buffer);
  t.check('Reset shape returns to the flat text', l.warp.style === 'custom' && reset.ink === flat.ink && reset.box.top === flat.box.top, `${reset.ink} vs ${flat.ink} ink pixels`);
  await page.keyboard.press('Control+z');
});

await section('Warped text stays an editable text layer', async () => {
  await h.selectRow(T.id);
  await shape().selectOption('arch');
  let l = await h.layerById(T.id);
  const c = await toScreen(page, l.x + l.width / 2, l.y + l.height / 2);
  await page.mouse.dblclick(c.x, c.y);
  const editor = page.locator('[data-testid="text-editor"]');
  await editor.waitFor();
  await editor.fill('HHHH');
  const host = await page.locator('[data-testid="canvas-host"]').boundingBox();
  await page.mouse.click(host.x + 12, host.y + 12);
  await editor.waitFor({ state: 'detached' });
  l = await h.layerById(T.id);
  t.check('double-click edits the words; the warp is kept', l.text === 'HHHH' && l.warp?.style === 'arch' && l.type === 'text', `${l.text} / ${l.warp?.style}`);
  const edited = await analyse((await clear()).buffer);
  t.check('the new words are drawn through the same warp', edited.ink < flat.ink * 0.7 && edited.ink > flat.ink * 0.3 && edited.box.left > flat.box.left + 50, `${edited.ink} ink pixels`);

  await h.selectRow(T.id);
  await h.setField('Font size', 80, props);
  await props.getByRole('button', { name: 'Italic' }).click();
  await h.settle(300);
  l = await h.layerById(T.id);
  const restyled = await analyse((await clear()).buffer);
  t.check('font changes apply to warped text', l.fontSize === 80 && l.italic && l.warp?.style === 'arch' && restyled.box.bottom - restyled.box.top < edited.box.bottom - edited.box.top, `ink height ${edited.box.bottom - edited.box.top} -> ${restyled.box.bottom - restyled.box.top}`);
  await props.getByRole('button', { name: 'Italic' }).click();
  await h.patch(T.id, { text: 'HHHHHHHH', fontSize: 100 });
  await h.settle(300);
});

await section('Move, resize and rotate', async () => {
  await h.selectRow(T.id);
  let l = await h.layerById(T.id);
  const c = await toScreen(page, l.x + l.width / 2, l.y + l.height / 2);
  const zoom = await page.evaluate(() => window.__prysm.ui.getState().zoom);
  await h.drag(c, { x: c.x + 30 * zoom, y: c.y + 60 * zoom });
  let moved = await h.layerById(T.id);
  t.check('dragging moves warped text', near(moved.x - l.x, 30, 6) && near(moved.y - l.y, 60, 6) && moved.warp?.style === 'arch', `dx=${(moved.x - l.x).toFixed(1)} dy=${(moved.y - l.y).toFixed(1)}`);
  await h.patch(T.id, { x: X, y: Y });
  l = await h.layerById(T.id);

  // The selection frame follows the warped outline: for this arch it is 15% of the height taller on each side.
  const corner = await toScreen(page, l.x + l.width, l.y + l.height * 1.15);
  await h.drag(corner, { x: corner.x - 140 * zoom, y: corner.y - 140 * zoom * ((l.height * 1.3) / l.width) });
  const resized = await h.layerById(T.id);
  const k = resized.width / l.width;
  t.check('a corner handle scales the text and its warp together', k < 0.9 && near(resized.fontSize / l.fontSize, k, 0.02) && resized.scaleX === 1 && resized.warp?.bend === 0.5, `width x${k.toFixed(3)}, font size ${l.fontSize} -> ${resized.fontSize}`);
  const small = await analyse((await clear()).buffer);
  t.check('the picture scales with it', near((small.box.right - small.box.left) / (flat.box.right - flat.box.left), k, 0.03), `ink width ratio ${((small.box.right - small.box.left) / (flat.box.right - flat.box.left)).toFixed(3)}`);
  await page.keyboard.press('Control+z');

  // Centred vertically so the turned text still fits on the 600 px canvas.
  await h.patch(T.id, { y: 240 });
  const upright = await analyse((await clear()).buffer);
  await h.setField('Rotation', 90, props);
  const turned = await analyse((await clear()).buffer);
  const uw = upright.box.right - upright.box.left;
  const uh = upright.box.bottom - upright.box.top;
  t.check('rotation turns the warped text about its box centre', near(turned.box.bottom - turned.box.top, uw, 2) && near(turned.box.right - turned.box.left, uh, 2), `${uw}x${uh} -> ${turned.box.right - turned.box.left}x${turned.box.bottom - turned.box.top}`);
  const cx = (turned.box.left + turned.box.right) / 2;
  const cy = (turned.box.top + turned.box.bottom) / 2;
  t.check('(pivot is the box centre)', near(cx, X + W / 2, 20) && near(cy, 240 + 60, 3), `ink centre ${cx}, ${cy}`);
  await h.setField('Rotation', 0, props);
  await h.patch(T.id, { y: Y });
});

await section('Blending, opacity, shadow and clipping', async () => {
  // A green rectangle under the left half of the text.
  await h.openTab('elements');
  await page.getByTitle('Rectangle', { exact: true }).click();
  const R = (await h.layers()).at(-1);
  await h.patch(R.id, { x: 0, y: 0, width: 400, height: 600, fill: { type: 'solid', color: '#00ff00' } });
  await page.evaluate((id) => window.__prysm.editor.getState().reorderSelected('back'), R.id);
  const a = await analyse((await clear()).buffer);
  const l = await h.layerById(T.id);
  // Points in the middle of a stem: one over the rectangle, one over the empty canvas.
  const mid = (x) => [x + 0.5, (a.top[x] + a.bottom[x]) / 2];
  const stemsNow = stems.filter((x) => a.top[x] >= 0);
  const overRect = mid(stemsNow.filter((x) => x < 380)[5]);
  const overEmpty = mid(stemsNow.filter((x) => x > 420).at(-6));
  await h.selectRow(T.id);
  let px = (await h.exportPng([overRect, overEmpty], { transparent: true })).pixels;
  t.check('(sample points are on the text)', rgbNear(px[0], [255, 0, 0]) && rgbNear(px[1], [255, 0, 0]), px.map(fmt).join(' '));
  await props.getByLabel('Blend mode', { exact: true }).selectOption('multiply');
  px = (await h.exportPng([overRect, overEmpty], { transparent: true })).pixels;
  t.check('blend modes act on warped text', rgbNear(px[0], [0, 0, 0]) && rgbNear(px[1], [255, 0, 0]), px.map(fmt).join(' '));
  await props.getByLabel('Blend mode', { exact: true }).selectOption('normal');
  await h.patch(T.id, { opacity: 0.5 });
  px = (await h.exportPng([overRect, overEmpty], { transparent: true })).pixels;
  t.check('opacity acts on warped text', rgbNear(px[0], [128, 128, 0], 3) && near(px[1][3], 128, 2), px.map(fmt).join(' '));
  await h.patch(T.id, { opacity: 1 });

  await h.patch(T.id, { shadow: { color: '#0000ff', blur: 0, offsetX: 0, offsetY: 40, opacity: 1 } });
  const below = [overEmpty[0], overEmpty[1] + 40 + (a.bottom[Math.floor(overEmpty[0])] - a.top[Math.floor(overEmpty[0])]) / 2 - 4];
  px = (await h.exportPng([below], { transparent: true })).pixels;
  t.check('the drop shadow follows the warped letters', rgbNear(px[0], [0, 0, 255]) && px[0][3] === 255, fmt(px[0]));
  await h.patch(T.id, { shadow: null });

  await props.getByRole('switch', { name: 'Clip to layer below' }).click();
  px = (await h.exportPng([overRect, overEmpty], { transparent: true })).pixels;
  t.check('warped text can be clipped to the layer below', (await h.layerById(T.id)).clip && rgbNear(px[0], [255, 0, 0]) && px[1][3] === 0, px.map(fmt).join(' '));
  await props.getByRole('switch', { name: 'Clip to layer below' }).click();
  await page.evaluate((id) => window.__prysm.editor.getState().deleteLayers([id]), R.id);
  t.check('(layer height is still the text height)', near(l.height, 120, 1), `${l.height}`);
});

await section('Duplicate, group, save and reopen', async () => {
  await h.selectRow(T.id);
  await page.keyboard.press('Escape');
  await h.selectRow(T.id);
  await page.keyboard.press('Control+d');
  let ls = await h.layers();
  const copy = ls.at(-1);
  t.check('a duplicate keeps the warp', ls.length === 2 && copy.id !== T.id && copy.warp?.style === 'arch' && copy.warp.bend === 0.5);
  await h.selectRow(copy.id);
  await h.setField('Bend value', -40, props);
  ls = await h.layers();
  t.check('the copies are independent', ls.find((x) => x.id === T.id).warp.bend === 0.5 && ls.find((x) => x.id === copy.id).warp.bend === -0.4);
  await page.evaluate((id) => window.__prysm.editor.getState().deleteLayers([id]), copy.id);

  const before = await analyse((await clear()).buffer);
  await waitForSaved(page);
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.evaluate(() => document.fonts.ready);
  await h.settle(900);
  const l = (await h.layers())[0];
  t.check('the warp is saved with the project', l.id === T.id && l.warp?.style === 'arch' && l.warp.bend === 0.5 && l.text === 'HHHHHHHH');
  const after = await analyse((await clear()).buffer);
  t.check('a reopened project exports the same picture', after.ink === before.ink && JSON.stringify(after.box) === JSON.stringify(before.box), `${after.ink} vs ${before.ink} ink pixels`);
});

await section('Projects saved before warp existed', async () => {
  await waitForSaved(page);
  const id = (await state(page)).doc.id;
  await page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('prysm');
        open.onsuccess = () => {
          const tx = open.result.transaction('projects', 'readwrite');
          const store = tx.objectStore('projects');
          const get = store.get(id);
          get.onsuccess = () => {
            const rec = get.result;
            rec.doc = { ...rec.doc, schemaVersion: 2, layers: rec.doc.layers.map(({ warp, ...rest }) => rest) };
            store.put(rec);
          };
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    id,
  );
  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  await page.evaluate(() => document.fonts.ready);
  await h.settle(900);
  const s = await state(page);
  t.check('an older project opens with unwarped text and is upgraded', s.doc.schemaVersion === 6 && s.doc.layers[0].warp === null && s.doc.layers[0].text === 'HHHHHHHH', `schema ${s.doc.schemaVersion}, warp ${JSON.stringify(s.doc.layers[0].warp)}`);
  const a = await analyse((await clear()).buffer);
  t.check('and draws as plain text', a.ink === flat.ink, `${a.ink} vs ${flat.ink}`);
});

await section('Heavily stretched text stays crisp', async () => {
  // Pull the text five times taller without changing its width: the case that used to show steps.
  await h.selectRow(T.id);
  const mesh = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) mesh.push(j / 3, -2 + (i / 3) * 5);
  await h.patch(T.id, { warp: { style: 'custom', bend: 0, horizontal: 0, vertical: 0, mesh } });
  await h.settle(300);
  const tall = await analyse((await clear()).buffer);
  const flatHeight = flat.box.bottom - flat.box.top;
  t.check('(the text is five times taller)', near((tall.box.bottom - tall.box.top) / flatHeight, 5, 0.15), `${flatHeight} -> ${tall.box.bottom - tall.box.top} px`);
  // Down a column through a stem, the ink should begin and end within about a pixel, as it does unstretched.
  const edgeWidth = (a) =>
    stems.reduce((sum, x) => sum + (a.len[x] - (a.bottom[x] - a.top[x] + 1)), 0) / stems.length;
  const before = Math.abs(edgeWidth(flat));
  const after = Math.abs(edgeWidth(tall));
  const hard = stems.filter((x) => tall.top[x] >= 0).length;
  const soft = await softColumn((await clear()).buffer, stems[Math.floor(stems.length / 2)]);
  t.check('stretched edges are as sharp as unstretched ones', hard === stems.length && soft.perEdge <= 2.2, `${soft.perEdge.toFixed(2)} soft pixels per edge down a stem (${soft.edges} edges); coverage error ${after.toFixed(2)} vs ${before.toFixed(2)} px`);
  await h.patch(T.id, { warp: { style: 'arch', bend: 0.5, horizontal: 0, vertical: 0 } });
  await h.settle(200);
});

await section('Without WebGL', async () => {
  await h.selectRow(T.id);
  await shape().selectOption('arch');
  const gl = await analyse((await clear()).buffer);
  t.check('this browser normally uses WebGL', (await page.evaluate(() => window.__prysm.warp.meshBackend())) === 'webgl2');
  await page.evaluate(() => window.__prysm.warp.forceCanvas2d(true));
  // Any change redraws the warp; this one goes through the Canvas 2D path.
  await h.setField('Bend value', 49, props);
  await h.setField('Bend value', 50, props);
  const backend = await page.evaluate(() => window.__prysm.warp.meshBackend());
  const soft = await analyse((await clear()).buffer);
  let worst = 0;
  for (const x of stems) worst = Math.max(worst, Math.abs(soft.mid[x] - gl.mid[x]));
  t.check('the fallback renderer draws the same shape', backend === 'canvas2d' && worst <= 0.5 && near(soft.ink / gl.ink, 1, 0.02), `${backend}, worst difference ${worst.toFixed(2)} px, ink ratio ${(soft.ink / gl.ink).toFixed(4)}`);
  await page.evaluate(() => window.__prysm.warp.forceCanvas2d(false));
});

t.check('no browser errors or native dialogs', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
