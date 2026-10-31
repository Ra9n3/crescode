/**
 * Chord-lane gesture e2e (headless Chromium via Playwright).
 *   npx playwright install chromium-headless-shell   (once)
 *   npm run build && node scripts/e2e-chord-gesture.mjs
 *
 * Covers the Smart Chord Suggestion interaction that vitest cannot reach:
 * the double-click interception on the native chord lane, the false-start
 * conversion of a double-click's first manual chord, the chord editor panel
 * (open / rename / close), the too-small-gap warning toast and the undo
 * step boundaries around every write — plus the floating overlay itself:
 * the colored suggestion grid, search/color filters, the bass/extension
 * dropdowns with their live preview, the "Apply Smart Chord" transaction
 * (close/minimize preference) and the non-destructive drift guard — plus
 * text-based chord entry & renaming: the inline input at the clip, the
 * triad-only autocomplete, the ambiguous-sus choice, key normalization
 * (Dbm7 → C#m7 in D major) and the unrecognized-user-MIDI confirm.
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

// H. The floating overlay: suggestion grid, colors, search, live preview.
await page.evaluate(() => { document.getElementById('arranger-scroll').scrollLeft = 0; }); // E scrolled away
await page.waitForTimeout(120);
await dblclickTick(5960);
await page.waitForTimeout(200);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const overlay = document.querySelector('[data-testid="chord-suggestions"]');
  return {
    open: s.suggestionClipId !== null,
    chords: s.project.chords.map((c) => ({ id: c.id.slice(0, 6), symbol: c.symbol, start: c.startTick })),
    editor: !!document.querySelector('[data-testid="chord-editor"]'),
    overlay: !!overlay,
    overlayText: overlay ? overlay.textContent.slice(0, 120) : null,
    cards: [...document.querySelectorAll('[data-testid^="suggestion-card-"]')].length,
    colors: [...new Set([...document.querySelectorAll('[data-testid^="suggestion-card-"]')].map((c) => c.dataset.color))],
  };
});
check('Overlay renders the suggestion grid, every card in a spec color band',
  res.open && res.cards >= 6 && res.colors.every((c) => ['green', 'yellow', 'red'].includes(c)),
  JSON.stringify(res));

// I. Search filter narrows the grid; clearing restores it.
const fullCount = res.cards;
await page.fill('[data-testid="suggestion-search"]', 'm7');
await page.waitForTimeout(120);
const filtered = await st(() => [...document.querySelectorAll('[data-testid^="suggestion-card-"]')].map((c) => ({ s: c.dataset.spelling, q: c.dataset.quality })));
check('Search filters the grid (m7 → only m7 shapes, fewer cards)',
  filtered.length >= 1 && filtered.length < fullCount && filtered.every((c) => (c.s + c.q).includes('m7')),
  JSON.stringify(filtered));
await page.fill('[data-testid="suggestion-search"]', '');
await page.waitForTimeout(120);

// J. Color filter shows only that band (or nothing).
await page.click('[data-testid="suggestion-filter-red"]');
await page.waitForTimeout(120);
res = await st(() => [...document.querySelectorAll('[data-testid^="suggestion-card-"]')].map((c) => c.dataset.color));
check('Color filter narrows to one band', res.every((c) => c === 'red'), JSON.stringify(res));
await page.click('[data-testid="suggestion-filter-all"]');
await page.waitForTimeout(120);

// K. Selecting a triad card re-targets the live preview; extension and bass
//    dropdowns recalculate name + MIDI notes immediately.
const triad = await st(() => {
  const cards = [...document.querySelectorAll('[data-testid^="suggestion-card-"]')];
  const c = cards.find((x) => x.dataset.quality === 'major' || x.dataset.quality === 'minor');
  return { idx: cards.indexOf(c), spelling: c?.dataset.spelling ?? null };
});
await page.click(`[data-testid="suggestion-card-${triad.idx}"]`);
await page.waitForTimeout(120);
res = await st(() => document.querySelector('[data-testid="suggestion-preview"]')?.dataset.name ?? '');
check('Clicking a suggestion card re-targets the preview', res === triad.spelling, `${res} vs ${triad.spelling}`);

const beforeExt = await st(() => document.querySelector('[data-testid="suggestion-preview"]')?.dataset.name ?? '');
await page.selectOption('[data-testid="suggestion-extension"]', '7');
await page.waitForTimeout(120);
res = await st(() => document.querySelector('[data-testid="suggestion-preview"]')?.dataset.name ?? '');
check('Extension dropdown recalculates the chord immediately (triad + 7)', res === `${beforeExt}7`, `${beforeExt} → ${res}`);

const bassVal = await st(() => {
  const sel = document.querySelector('[data-testid="suggestion-bass"]');
  return [...sel.options].find((o) => o.value.startsWith('pc:'))?.value ?? null;
});
let appliedName = res;
if (bassVal !== null) {
  await page.selectOption('[data-testid="suggestion-bass"]', bassVal);
  await page.waitForTimeout(120);
  appliedName = await st(() => document.querySelector('[data-testid="suggestion-preview"]')?.dataset.name ?? '');
  check('Bass dropdown composes a slash chord', appliedName.includes('/'), appliedName);
}

// L. Apply: one "Apply Smart Chord" undo step writes voicing + name, preserves
//    bounds, closes the overlay (default preference).
const preApply = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { steps: s.past.length };
});
await page.click('[data-testid="apply-chord"]');
await page.waitForTimeout(250);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const c = s.project.chords.find((x) => x.id.startsWith('sch_'));
  const lane = s.project.tracks.find((t) => t.role === 'chords');
  return {
    open: s.suggestionClipId !== null,
    symbol: c?.symbol ?? null, start: c?.startTick, len: c?.durationTicks,
    notes: lane.notes.map((n) => n.pitch),
    steps: s.past.length,
  };
});
check('Apply writes the voicing + name in one undo step, preserves bounds, closes',
  !res.open && res.symbol === appliedName && res.start === 5760 && res.len === 3840 &&
  res.notes.length >= 3 && res.steps === preApply.steps + 1 &&
  res.notes.every((p) => p >= 36 && p <= 84) &&
  new Set(res.notes.map((p) => p % 12)).size === res.notes.length,
  JSON.stringify(res));

// M. Apply-mode "minimize": the overlay collapses but stays open.
await st(() => window.crescodeTest.store.getState().setSettings({ smartChordApply: 'minimize' }));
await dblclickTick(5960);
await page.click('[data-testid="suggestion-card-0"]');
await page.waitForTimeout(120);
await page.click('[data-testid="apply-chord"]');
await page.waitForTimeout(250);
res = await st(() => ({
  open: window.crescodeTest.store.getState().suggestionClipId !== null,
  gridVisible: !!document.querySelector('[data-testid="suggestion-grid"]'),
}));
check('Apply with the minimize preference collapses the overlay but keeps it open', res.open && !res.gridVisible, JSON.stringify(res));

// N. Non-destructive guard: a clip moved since the overlay opened warns and
//    is never overwritten.
await page.click('[data-testid="chord-editor-minimize"]'); // expand again
await page.waitForTimeout(120);
const preDrift = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { steps: s.past.length, symbol: s.project.chords.find((c) => c.id.startsWith('sch_')).symbol };
});
await st(() => {
  const s = window.crescodeTest.store.getState();
  s.edit((p) => ({ ...p, chords: p.chords.map((c) => (c.id.startsWith('sch_') ? { ...c, startTick: c.startTick + 960 } : c)) }));
});
await page.waitForTimeout(200);
await page.click('[data-testid="suggestion-card-0"]');
await page.waitForTimeout(120);
await page.click('[data-testid="apply-chord"]');
await page.waitForTimeout(250);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return {
    toast: s.toasts.at(-1)?.kind ?? null,
    steps: s.past.length,
    symbol: s.project.chords.find((c) => c.id.startsWith('sch_')).symbol,
  };
});
check('Apply on a moved clip warns non-destructively (no overwrite, no undo step)',
  res.toast === 'warn' && res.steps === preDrift.steps + 1 && res.symbol === preDrift.symbol,
  JSON.stringify(res));
await page.keyboard.press('Escape');

// O. Text entry & renaming: double-click an existing chord name → the inline
//    input opens AT the clip, preloaded with the current chord name, alongside
//    the Smart Chord panel; no clip is created.
const schStart = await st(() => window.crescodeTest.store.getState().project.chords.find((c) => c.id.startsWith('sch_'))?.startTick ?? 0);
await dblclickTick(schStart + 240);
let renameInfo = await st(() => {
  const s = window.crescodeTest.store.getState();
  return {
    inline: !!document.querySelector('[data-testid="chord-rename-input"]'),
    value: document.querySelector('[data-testid="chord-rename-input"]')?.value ?? null,
    editorOpen: s.suggestionClipId !== null,
    clips: s.project.chords.length,
    sym: s.project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null,
  };
});
check('Double-click a chord name opens the inline text input, preloaded, no new clip',
  renameInfo.inline && renameInfo.value === renameInfo.sym && renameInfo.editorOpen && renameInfo.clips === 1,
  JSON.stringify(renameInfo));

// P. Triad-only autocomplete: a bare root suggests only triads — no 7ths/9ths/sus.
await page.fill('[data-testid="chord-rename-input"]', 'C');
let opts = await st(() => [...document.querySelectorAll('[data-testid^="chord-rename-option-"]')].map((o) => o.dataset.symbol));
check('Autocomplete for a bare root is triad-only (C, Cm, Cdim, Caug)',
  opts.includes('C') && opts.includes('Cm') && opts.includes('Cdim') && opts.includes('Caug') &&
  opts.every((s) => !/[796]|sus|add|maj7/.test(s)) && opts[0] === 'C',
  JSON.stringify(opts));
await page.fill('[data-testid="chord-rename-input"]', 'Cm7');
opts = await st(() => [...document.querySelectorAll('[data-testid^="chord-rename-option-"]')].map((o) => o.dataset.symbol));
check('Typing an extension marker opens the relevant extensions (Cm7 → Cm7, Cm7b5)',
  opts.join(',') === 'Cm7,Cm7b5', JSON.stringify(opts));

// Q. Invalid text: inline validation message, Enter never modifies the clip.
const preInvalid = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { sym: s.project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null, steps: s.past.length };
});
await page.fill('[data-testid="chord-rename-input"]', 'Xq');
await page.press('[data-testid="chord-rename-input"]', 'Enter');
await page.waitForTimeout(150);
let inv = await st(() => ({
  err: !!document.querySelector('[data-testid="chord-rename-error"]'),
  open: !!document.querySelector('[data-testid="chord-rename-input"]'),
  sym: window.crescodeTest.store.getState().project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null,
  steps: window.crescodeTest.store.getState().past.length,
}));
check('Invalid text shows an inline message and never modifies the clip',
  inv.err && inv.open && inv.sym === preInvalid.sym && inv.steps === preInvalid.steps, JSON.stringify(inv));

// R. Ambiguous text ("Csus"): both readings offered; choosing one renames +
//    rewrites the MIDI in exactly one undo step, bounds preserved.
await page.fill('[data-testid="chord-rename-input"]', 'Csus');
opts = await st(() => [...document.querySelectorAll('[data-testid^="chord-rename-option-"]')].map((o) => o.dataset.symbol));
check('Ambiguous "Csus" offers both readings (sus4 grammar default first)',
  opts.join(',') === 'Csus4,Csus2', JSON.stringify(opts));
const preChoose = await st(() => {
  const s = window.crescodeTest.store.getState();
  const c = s.project.chords.find((x) => x.id.startsWith('sch_'));
  return { steps: s.past.length, start: c.startTick, len: c.durationTicks };
});
await page.click('[data-testid="chord-rename-option-1"]'); // Csus2
await page.waitForTimeout(200);
let chosen = await st(() => {
  const s = window.crescodeTest.store.getState();
  const c = s.project.chords.find((x) => x.id.startsWith('sch_'));
  const lane = s.project.tracks.find((t) => t.role === 'chords');
  return {
    sym: c.symbol, start: c.startTick, len: c.durationTicks,
    // notes of THIS clip's window only (the drift-test move left older notes outside it)
    pcs: lane.notes.filter((n) => n.startTick >= c.startTick && n.startTick < c.startTick + c.durationTicks).map((n) => n.pitch % 12).sort((a, b) => a - b),
    steps: s.past.length,
    inlineClosed: !document.querySelector('[data-testid="chord-rename-input"]'),
  };
});
check('Choosing a reading renames + rewrites MIDI in one undo step, bounds preserved',
  chosen.sym === 'Csus2' && chosen.pcs.join(',') === '0,2,7' &&
  chosen.start === preChoose.start && chosen.len === preChoose.len &&
  chosen.steps === preChoose.steps + 1 && chosen.inlineClosed,
  JSON.stringify(chosen));

// S. Enharmonic normalization on commit: "Dbm7" in D major lands as C#m7.
await dblclickTick(schStart + 240);
await page.fill('[data-testid="chord-rename-input"]', 'Dbm7');
await page.press('[data-testid="chord-rename-input"]', 'Enter');
await page.waitForTimeout(200);
const norm = await st(() => window.crescodeTest.store.getState().project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null);
check('Typed "Dbm7" is normalized to C#m7 in D major (pitch class unchanged)', norm === 'C#m7', String(norm));

// T. Substantial user MIDI the analyzer cannot read → warn, never auto-replace.
await st(() => {
  const s = window.crescodeTest.store.getState();
  const c = s.project.chords.find((x) => x.id.startsWith('sch_'));
  s.edit((p) => ({
    ...p,
    tracks: p.tracks.map((t) => (t.role === 'chords'
      ? { ...t, notes: [60, 61, 62, 63].map((pitch) => ({ pitch, startTick: c.startTick, durationTicks: c.durationTicks, velocity: 100 })) }
      : t)),
  }));
});
await page.waitForTimeout(150);
await dblclickTick(schStart + 240);
await page.fill('[data-testid="chord-rename-input"]', 'C');
await page.press('[data-testid="chord-rename-input"]', 'Enter');
await page.waitForTimeout(150);
const preConfirm = await st(() => ({
  warn: !!document.querySelector('[data-testid="chord-rename-warn"]'),
  sym: window.crescodeTest.store.getState().project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null,
  steps: window.crescodeTest.store.getState().past.length,
}));
check('Unrecognized user MIDI warns before replacing (nothing modified yet)',
  preConfirm.warn && preConfirm.sym === 'C#m7', JSON.stringify(preConfirm));
await page.click('[data-testid="chord-rename-confirm"]');
await page.waitForTimeout(200);
const confirmed = await st(() => {
  const s = window.crescodeTest.store.getState();
  const c = s.project.chords.find((x) => x.id.startsWith('sch_'));
  const lane = s.project.tracks.find((t) => t.role === 'chords');
  return { sym: c.symbol, notes: lane.notes.filter((n) => n.startTick >= c.startTick && n.startTick < c.startTick + c.durationTicks).map((n) => n.pitch), steps: s.past.length };
});
check('Confirming replaces user MIDI with the typed chord in one undo step',
  confirmed.sym === 'C' && confirmed.notes.join(',') === '60,64,67' &&
  confirmed.steps === preConfirm.steps + 1,
  JSON.stringify(confirmed));
await page.keyboard.press('Escape');

check('No uncaught page errors', errors.length === 0, errors.slice(0, 2).join(';'));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `${results.length}/${results.length} passed` : `${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
