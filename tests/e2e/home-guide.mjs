/**
 * The home page and the in-app guide: getting into a design from a size, a template or a recent
 * project; moving between home and the editor; and finding instructions for a feature (search,
 * topics, "show me", the "?" links in panels). Also checks the guide against the interface it
 * describes: every button or label it quotes must exist in the source.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BASE_URL, helpers, launch, makeReporter, openEditor, state, waitForSaved } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { GUIDE, GUIDE_CATEGORIES, PANEL_HELP, SECTION_HELP } = await import(pathToFileURL(join(ROOT, 'src/features/guide/guide.ts')).href);
const { DEMOS } = await import(pathToFileURL(join(ROOT, 'src/features/guide/demos.ts')).href);

const t = makeReporter();
const browser = await launch();
const { context, page, errors } = await openEditor(browser, { fresh: true });
const h = helpers(page);
const section = (name, fn) => h.section(t, name, fn);

const home = page.locator('[data-testid="home"]');
const guide = page.locator('[data-testid="guide"]');
const topic = page.locator('[data-testid="guide-topic"]');
const ui = () => page.evaluate(() => ({ home: window.__prysm.ui.getState().home, guide: window.__prysm.ui.getState().guide, tool: window.__prysm.ui.getState().tool, tab: window.__prysm.ui.getState().sidebarTab, hash: location.hash }));
const projectCount = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('prysm');
        open.onsuccess = () => {
          const req = open.result.transaction('projects').objectStore('projects').count();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
        };
      }),
  );

await section('The guide matches the interface', async () => {
  const ids = GUIDE.map((g) => g.id);
  t.check('every topic has a unique id, a category, a summary and at least two steps', new Set(ids).size === ids.length && GUIDE.every((g) => GUIDE_CATEGORIES.includes(g.category) && g.summary.length > 10 && g.steps.length >= 2), `${GUIDE.length} topics`);
  const dangling = [...Object.values(PANEL_HELP), ...Object.values(SECTION_HELP)].filter((id) => !ids.includes(id));
  t.check('every “?” link points at a topic that exists', dangling.length === 0, dangling.join(', '));

  // Everything the guide puts in “quotes” is something to click or read in the interface, so it must be there.
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !path.endsWith(join('guide', 'guide.ts'))) files.push(readFileSync(path, 'utf8'));
    }
  };
  walk(join(ROOT, 'src'));
  const source = files.join('\n');
  const quoted = new Set();
  for (const g of GUIDE) for (const text of [...g.steps, ...(g.tips ?? [])]) for (const m of text.matchAll(/“([^”]+)”/g)) quoted.add(m[1]);
  // Examples of what the interface shows (a size, a status), not fixed labels.
  const examples = new Set(['1080 × 1080', 'Saved']);
  // A quote may also name another entry of the guide (“see Clipping masks”).
  const titles = GUIDE.map((g) => g.title);
  const missing = [...quoted].filter((q) => !examples.has(q) && !source.includes(q) && !titles.some((title) => title.startsWith(q)));
  t.check('every button or label the guide quotes exists in the interface', quoted.size > 25 && missing.length === 0, missing.length ? `not found: ${missing.join(' | ')}` : `${quoted.size} quoted labels checked`);
  // Demonstrations: a recording of the editor per topic (made by "npm run guide:demos").
  const without = GUIDE.filter((g) => !DEMOS[g.id]).map((g) => g.id);
  t.check('every topic has a demonstration', without.length === 0, without.join(', '));
  const demos = Object.entries(DEMOS);
  const onDisk = readdirSync(join(ROOT, 'public', 'guide'));
  const lost = demos.filter(([, d]) => !onDisk.includes(d.file) || statSync(join(ROOT, 'public', 'guide', d.file)).size < 20000).map(([id]) => id);
  const orphans = onDisk.filter((f) => !demos.some(([, d]) => d.file === f));
  const megabytes = demos.reduce((sum, [, d]) => sum + (onDisk.includes(d.file) ? statSync(join(ROOT, 'public', 'guide', d.file)).size : 0), 0) / 1048576;
  t.check('every demonstration is a video file that exists, and none is left over', lost.length === 0 && orphans.length === 0 && demos.every(([, d]) => d.file.endsWith('.webm')), `${demos.length} videos, ${megabytes.toFixed(1)} MB; missing: ${lost.join(', ') || 'none'}; unused: ${orphans.join(', ') || 'none'}`);
  const timing = demos.filter(([, d]) => !(d.end - d.start >= 6 && d.end - d.start <= 60) || d.steps.length < 2 || d.steps.some((st, i) => st.caption.length < 8 || st.at < d.start - 0.01 || st.at > d.end || (i > 0 && st.at <= d.steps[i - 1].at))).map(([id]) => id);
  t.check('each runs between 6 and 60 seconds with at least two captions, in order, inside the clip', timing.length === 0, timing.join(', '));
  const sectionTitles = Object.keys(SECTION_HELP).filter((title) => !source.includes(`title="${title}"`) && !source.includes(`'${title}'`) && !source.includes(`title={`));
  t.check('the sections that carry a “?” exist', sectionTitles.length === 0, sectionTitles.join(', '));
});

await section('Home page', async () => {
  await page.goto(`${BASE_URL}/#/`);
  await home.waitFor();
  t.check('without “#/editor” in the address the app opens on its home page', (await ui()).home === true);
  const text = await home.innerText();
  t.check('it says what the app is', /PRYSM/.test(text) && /Your ideas\. Your canvas\./.test(text) && /A creative space for image editing and graphic design\./.test(text) && /CREATIVE TOOLS · IMAGE EDITING · DESIGN/.test(text));
  t.check('the picture is drawn by the app (a vector prism)', (await home.locator('svg[role="img"] path').count()) >= 3);
  t.check('it offers sizes, templates and what you can do', (await home.locator('[data-home-preset]').count()) === 11 && (await home.locator('[data-home-template]').count()) === 8 && (await home.locator('[data-home-topic]').count()) === 12);
  t.check('with nothing made yet there is no “Continue” button', (await home.locator('[data-testid="home-continue"]').count()) === 0);

  await home.locator('[data-home-preset="youtube"]').click();
  await home.waitFor({ state: 'detached' });
  let s = await state(page);
  t.check('choosing a size opens the editor with a canvas of that size', s.doc.width === 1280 && s.doc.height === 720 && (await ui()).hash === '#/editor' && (await page.locator('[data-testid="editor"]').isVisible()));
  await waitForSaved(page);
  t.check('the untouched blank project is reused, not left behind', (await projectCount()) === 1, `${await projectCount()} projects`);

  await h.openTab('elements');
  await page.locator('[title="Rectangle"]').first().click();
  await h.settle(300);
  await waitForSaved(page);
  await page.locator('[data-testid="home-link"]').click();
  await home.waitFor();
  t.check('the logo in the top bar goes back to the home page', (await ui()).home === true && (await ui()).hash === '#/');
  t.check('now it offers to continue the open design', /Continue “Untitled design”/.test(await home.locator('[data-testid="home-continue"]').innerText()));
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  s = await state(page);
  t.check('keys pressed on the home page do not touch the design behind it', s.doc.layers.length === 1 && s.past === 1);

  await page.goBack();
  await home.waitFor({ state: 'detached' });
  t.check('the browser’s Back button returns to the editor', (await ui()).home === false);
  await page.goForward();
  await home.waitFor();
  t.check('and Forward returns to the home page', (await ui()).home === true);

  const first = (await state(page)).doc.id;
  const recent = home.locator(`[data-home-project="${first}"]`);
  await recent.waitFor();
  t.check('the design is listed under recent projects with a preview', (await recent.locator('img').count()) === 1 && /1280 × 720/.test(await recent.innerText()));

  await home.locator('[data-home-template="gig-poster"]').click();
  await home.waitFor({ state: 'detached' });
  await h.settle(500);
  s = await state(page);
  t.check('a template starts a new project with that design, ready to edit', s.doc.id !== first && s.doc.name === 'Gig poster' && s.doc.width === 1800 && s.doc.layers.length > 3 && s.past === 0, `${s.doc.name}, ${s.doc.layers.length} layers, ${s.past} undo steps`);
  await waitForSaved(page);
  t.check('the earlier design was kept as its own project', (await projectCount()) === 2);

  await page.locator('[data-testid="home-link"]').click();
  await home.locator(`[data-home-project="${first}"]`).click();
  await home.waitFor({ state: 'detached' });
  await h.settle(500);
  s = await state(page);
  t.check('a recent project opens from the home page', s.doc.id === first && s.doc.layers.length === 1 && s.doc.width === 1280);

  await page.reload();
  await page.waitForSelector('[data-testid="canvas-host"] canvas');
  t.check('reloading inside the editor stays in the editor', (await ui()).home === false && (await home.count()) === 0);
  await page.locator('[data-testid="home-link"]').click();
  await home.locator('[data-testid="home-open-editor"]').click();
  t.check('“Open the editor” leaves the home page', (await ui()).home === false);
});

await section('Guide', async () => {
  await page.locator('[data-testid="home-link"]').click();
  await home.locator('[data-testid="home-guide"]').click();
  await guide.waitFor();
  t.check('the guide opens from the home page, listing every topic by category', (await guide.locator('[data-guide-topic]').count()) === GUIDE.length && (await guide.innerText()).includes('GETTING STARTED'.slice(0, 7)) , `${await guide.locator('[data-guide-topic]').count()} of ${GUIDE.length}`);
  t.check('a topic shows numbered steps', (await topic.locator('ol li').count()) >= 2 && (await topic.locator('h3').innerText()).length > 3);

  const search = guide.getByLabel('Search the guide');
  await search.fill('crop');
  t.check('searching finds the feature by name', (await guide.locator('[data-guide-topic]').first().innerText()) === 'Crop an image' && (await topic.getAttribute('data-topic')) === 'crop');
  await search.fill('remove person');
  t.check('and by what you want to do, in your own words', (await topic.getAttribute('data-topic')) === 'magic-eraser', await topic.getAttribute('data-topic'));
  await search.fill('portrait bokeh');
  t.check('including words that are not in the title', (await topic.getAttribute('data-topic')) === 'blur-background');
  await search.fill('zzqqxx');
  t.check('a search with no match says so', /Nothing in the guide matches/.test(await guide.innerText()));
  await search.fill('');

  await guide.locator('[data-guide-topic="curves"]').click();
  const curves = await topic.innerText();
  t.check('choosing a topic shows its instructions', (await topic.getAttribute('data-topic')) === 'curves' && /Click the line to add a point/.test(curves) && /Good to know/i.test(curves));
  // The demonstration: a recording of the editor doing it, which plays by itself.
  const demo = topic.locator('[data-testid="guide-demo"]');
  const caption = demo.locator('[data-testid="guide-demo-caption"]');
  const video = () =>
    page.evaluate(() => {
      const v = document.querySelector('[data-testid="guide-demo"] video');
      return { time: v.currentTime, paused: v.paused, width: v.videoWidth, ready: v.readyState, shown: v.getBoundingClientRect().width };
    });
  await page.waitForFunction(() => document.querySelector('[data-testid="guide-demo"] video')?.readyState >= 2, null, { timeout: 20000 });
  const spec = DEMOS.curves;
  const first = await video();
  await page.waitForFunction((t0) => document.querySelector('[data-testid="guide-demo"] video').currentTime > t0 + 1, first.time, { timeout: 10000 });
  const later = await video();
  t.check('a topic shows a moving demonstration that plays by itself', later.width > 600 && !later.paused && later.time > first.time + 1, `${later.width} px wide, at ${later.time.toFixed(1)} s`);
  t.check('with a caption for the step being shown', /step \d of/i.test(await demo.innerText()) && spec.steps.some((st) => st.caption === undefined) === false && spec.steps.map((st) => st.caption).includes((await caption.innerText()).trim()));

  // It moves: the picture at one moment differs from the picture a little later.
  const frame = () =>
    page.evaluate(() => {
      const v = document.querySelector('[data-testid="guide-demo"] video');
      const c = document.createElement('canvas');
      c.width = 272;
      c.height = 160;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      return Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    });
  const one = await frame();
  await h.settle(2500);
  const two = await frame();
  let changed = 0;
  for (let i = 0; i < one.length; i += 4) if (Math.abs(one[i] - two[i]) + Math.abs(one[i + 1] - two[i + 1]) + Math.abs(one[i + 2] - two[i + 2]) > 40) changed++;
  t.check('the picture really changes as it plays', changed > 60, `${changed} of ${one.length / 4} sampled pixels differ after 2.5 s`);

  await demo.getByRole('button', { name: 'Pause the demonstration' }).click();
  const paused = await video();
  await h.settle(700);
  t.check('it can be paused', (await video()).paused && Math.abs((await video()).time - paused.time) < 0.05);
  await demo.getByRole('button', { name: 'Next step of the demonstration' }).click();
  await h.settle(300);
  const stepped = await video();
  const index = Number(await demo.getAttribute('data-step'));
  t.check('and stepped from caption to caption', spec.steps.some((st) => Math.abs(st.at - stepped.time) < 0.3) && (await caption.innerText()).trim() === spec.steps[index].caption, `at ${stepped.time.toFixed(2)} s, step ${index + 1}`);
  await demo.getByRole('button', { name: 'Play the demonstration from the start' }).click();
  await h.settle(300);
  t.check('“from the start” goes back to the beginning', Math.abs((await video()).time - spec.start) < 0.6 && (await caption.innerText()).trim() === spec.steps[0].caption);
  await demo.getByRole('button', { name: 'Play the demonstration', exact: true }).click();
  await demo.getByRole('button', { name: 'Enlarge the demonstration' }).click();
  await h.settle(400);
  const large = await video();
  t.check('it can be enlarged to fill the window', (await demo.getAttribute('data-large')) === 'true' && large.shown > 1000 && !large.paused, `${Math.round(large.shown)} px wide`);
  await page.keyboard.press('Escape');
  await h.settle(300);
  t.check('Escape leaves the enlarged view and keeps the guide open', (await demo.getAttribute('data-large')) === 'false' && (await guide.isVisible()) && (await ui()).guide !== null);

  // Every other topic's recording loads and plays too.
  const broken = [];
  for (const g of GUIDE) {
    await guide.locator(`[data-guide-topic="${g.id}"]`).click();
    const ok = await page
      .waitForFunction(
        (file) => {
          const v = document.querySelector('[data-testid="guide-demo"] video');
          return !!v && v.src.includes(file) && v.readyState >= 2 && v.videoWidth > 600 && !v.error;
        },
        DEMOS[g.id]?.file ?? 'none',
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!ok) broken.push(g.id);
  }
  t.check('the recording of every topic loads in the guide', broken.length === 0, broken.join(', ') || `${GUIDE.length} recordings`);
  await guide.locator('[data-guide-topic="curves"]').click();

  await guide.locator('[data-guide-topic="generative-fill"]').click();
  t.check('a feature that needs setup says so up front', /Needs the Prysm AI server/.test(await topic.innerText()));
  await guide.locator('[data-guide-topic="shortcuts"]').click();
  t.check('shortcuts are listed', (await topic.locator('kbd').count()) >= 10);

  await guide.locator('[data-guide-topic="select"]').click();
  await topic.locator('[data-testid="guide-show"]').click();
  await guide.waitFor({ state: 'detached' });
  let now = await ui();
  t.check('“show me” closes the guide and the home page and picks up the tool', now.guide === null && now.home === false && now.tool === 'marquee');
  await page.keyboard.press('v');

  await page.getByRole('button', { name: /^Guide: how to do things/ }).click();
  await guide.waitFor();
  t.check('the “?” in the top bar opens the guide in the editor', (await ui()).guide !== null);
  await page.keyboard.press('b');
  t.check('keys pressed while the guide is open do not reach the editor', (await ui()).tool === 'move');
  await guide.locator('[data-guide-topic="textures"]').click();
  await topic.locator('[data-testid="guide-show"]').click();
  now = await ui();
  t.check('“show me” can open the panel a feature lives in', now.guide === null && now.tab === 'textures');
  await page.keyboard.press('F1');
  await guide.waitFor();
  t.check('F1 opens the guide', true);
  await page.keyboard.press('Escape');
  await guide.waitFor({ state: 'detached' });
  t.check('Escape closes it', (await ui()).guide === null);

  // The "?" next to panel and section titles opens the guide at the right entry.
  await page.locator('[data-testid="sidebar"] [data-help="textures"], [data-help="textures"]').first().click();
  await guide.waitFor();
  t.check('the “?” on a side panel opens its entry', (await topic.getAttribute('data-topic')) === 'textures');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__prysm.editor.getState().clearSelection());
  await page.locator('[data-help="canvas"]').first().click();
  await guide.waitFor();
  t.check('the “?” on a section of the right-hand panel opens its entry', (await topic.getAttribute('data-topic')) === 'canvas');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__prysm.editor.getState().selectAll());
  const helps = await page.locator('[data-testid="properties-panel"] [data-help]').evaluateAll((els) => els.map((e) => e.dataset.help));
  t.check('a selected shape’s sections each carry a “?”', helps.includes('arrange') && helps.includes('blend') && helps.includes('elements') && helps.includes('frame'), helps.join(', '));

  await page.locator('[data-testid="home-link"]').click();
  await home.locator('[data-home-topic="upscale"]').click();
  await guide.waitFor();
  t.check('a card on the home page opens the guide at that feature', (await topic.getAttribute('data-topic')) === 'upscale' && (await ui()).home === true);
  await page.keyboard.press('Escape');
});

t.check('no console or page errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = t.summary();
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
