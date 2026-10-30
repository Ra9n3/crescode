/**
 * Chord-lane gesture e2e (headless Chromium via Playwright).
 *   npx playwright install chromium-headless-shell   (once)
 *   npm run build && node scripts/e2e-chord-gesture.mjs
 *
 * Covers the Smart Chord Suggestion interaction that vitest cannot reach:
 * the double-click interception on the native chord lane, the false-start
 * conversion of a double-click's first manual chord, the chord editor panel
 * (open / rename / close), the too-small-gap warning toast and the undo
 * step boundaries around every write.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  — ${info}` : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForSelector('[data-testid="chord-lane"]');

const st = (fn) => page.evaluate(fn);
await st(() => { const s = window.crescodeTest.store.getState(); s.edit((p) => ({ ...p, chords: [] })); });
const ppt = await st(() => window.crescodeTest.store.getState().pxPerTick);

const laneBox = async () => await page.locator('[data-testid="chord-lane"]').boundingBox();
const xFor = (box, tick) => box.x + tick * ppt + 3;
const dblclickTick = async (tick) => { const b = await laneBox(); await page.mouse.dblclick(xFor(b, tick), b.y + b.height / 2); await page.waitForTimeout(200); };

// A. Double-click on empty space: the first click's manual chord becomes ONE Smart clip.
await dblclickTick(5760);
let res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const lane = s.project.tracks.find((t) => t.role === 'chords');
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  return {
    smart: s.project.chords.filter((c) => c.id.startsWith('sch_')).map((c) => ({ ...c })),
    manual: s.project.chords.filter((c) => !c.id.startsWith('sch_')).length,
    editorOpen: s.suggestionClipId !== null,
    editorVisible: !!document.querySelector('[data-testid="chord-editor"]'),
    placeholder: lane.notes.map((n) => ({ ...n })),
    selectedIsClip: s.selectedChordId === s.suggestionClipId,
    tonicSymbol: NAMES[s.project.key],
  };
});
check('Double-click empty lane creates one Smart clip (false start converted)',
  res.smart.length === 1 && res.manual === 0 &&
  res.smart[0].startTick === 5760 && res.smart[0].durationTicks === 3840 &&
  res.smart[0].symbol === res.tonicSymbol,
  JSON.stringify(res.smart));
check('…editor panel opens and selection follows', res.editorOpen && res.editorVisible && res.selectedIsClip);
check('…root-note placeholder sits on the Chords track',
  res.placeholder.length === 1 && res.placeholder[0].pitch === 48 + (await st(() => window.crescodeTest.store.getState().project.key)) &&
  res.placeholder[0].startTick === 5760 && res.placeholder[0].durationTicks === 3840);

// B. Double-click the existing clip: editor reopens, nothing is created.
await dblclickTick(5960);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { smart: s.project.chords.filter((c) => c.id.startsWith('sch_')).length, manual: s.project.chords.filter((c) => !c.id.startsWith('sch_')).length, open: s.suggestionClipId !== null };
});
check('Double-click existing clip reopens the editor without creating', res.smart === 1 && res.manual === 0 && res.open);

// C. Rename through the editor — bounds preserved, one undo step.
await page.fill('[data-testid="chord-editor-symbol"]', 'Dm7');
await page.press('[data-testid="chord-editor-symbol"]', 'Enter');
await page.waitForTimeout(150);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const c = s.project.chords.find((x) => x.id.startsWith('sch_'));
  return { sym: c.symbol, start: c.startTick, len: c.durationTicks, steps: s.past.length };
});
check('Editor rename updates the symbol and preserves position/length', res.sym === 'Dm7' && res.start === 5760 && res.len === 3840, JSON.stringify(res));

// D. Ctrl+Z reverts exactly the rename (Tab leaves the remounted input).
await page.keyboard.press('Tab');
await page.keyboard.press('Control+z');
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return s.project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null;
});
check('Undo after rename reverts to the placeholder symbol', res === 'D', String(res));

// E. Too-small gap: non-destructive warning, nothing created, false start restored.
await st(() => { const s = window.crescodeTest.store.getState(); s.edit((p) => ({ ...p, chords: [...p.chords, { id: 'a1', symbol: 'C', startTick: 38400, durationTicks: 3840 }, { id: 'a2', symbol: 'F', startTick: 43100, durationTicks: 3840 }] })); });
await page.evaluate(() => { document.getElementById('arranger-scroll').scrollLeft = 2200; });
await dblclickTick(42900);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { smart: s.project.chords.filter((c) => c.id.startsWith('sch_')).length, total: s.project.chords.length, toast: s.toasts.at(-1)?.kind };
});
check('Too-small gap warns non-destructively (nothing created, false start restored)', res.toast === 'warn' && res.smart === 1 && res.total === 4, JSON.stringify(res));

// F. Escape closes the editor.
await page.keyboard.press('Escape');
res = await st(() => window.crescodeTest.store.getState().suggestionClipId);
check('Escape closes the chord editor', res === null);

// G. The failed conversion left no extra undo step: two undos remove the false start and the a1/a2 edit, the Smart clip stays.
await page.keyboard.press('Control+z');
await page.keyboard.press('Control+z');
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { smart: s.project.chords.filter((c) => c.id.startsWith('sch_')).length, total: s.project.chords.length };
});
check('Failed gestures leave clean undo history', res.smart === 1 && res.total === 1, JSON.stringify(res));

check('No uncaught page errors', errors.length === 0, errors.slice(0, 2).join(';'));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `${results.length}/${results.length} passed` : `${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
