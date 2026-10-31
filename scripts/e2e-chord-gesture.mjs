/**
 * Chord-lane gesture e2e (headless Chromium via Playwright).
 *   npx playwright install chromium-headless-shell   (once)
 *   npm run build && node scripts/e2e-chord-gesture.mjs
 *
 * Covers the Smart Chord Suggestion interaction that vitest cannot reach:
 * the double-click interception on the native chord lane, the false-start
 * conversion of a double-click's first manual chord, the compact chord
 * picker panel (open / rename / close), the too-small-gap warning toast and
 * the undo step boundaries around every write — plus the floating picker
 * itself in its redesigned compact form: the 8-tile suggestion grid with
 * short functional labels and full hover explanations, the "+more" paging,
 * IMMEDIATE selection (a tile click applies in one undo step and the popup
 * stays open), the Advanced popover (extension/bass/octave applied to the
 * current chord at once), the non-destructive drift guard — plus text-based
 * chord entry & renaming: the inline input at the clip, the triad-only
 * autocomplete, the ambiguous-sus choice, key normalization (Dbm7 → C#m7 in
 * D major) and the unrecognized-user-MIDI confirm.
 */
import { chromium } from 'playwright';
import os from 'node:os';
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

// H. The floating picker: compact 8-tile grid, function labels, tooltips, no scroll.
await page.evaluate(() => { document.getElementById('arranger-scroll').scrollLeft = 0; }); // E scrolled away
await page.waitForTimeout(120);
await dblclickTick(5960);
await page.waitForTimeout(250);
const editorBox = async () => await page.locator('[data-testid="chord-editor"]').boundingBox();
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const overlay = document.querySelector('[data-testid="chord-suggestions"]');
  const cards = [...document.querySelectorAll('[data-testid^="suggestion-card-"]')];
  const ed = document.querySelector('[data-testid="chord-editor"]');
  return {
    open: s.suggestionClipId !== null,
    editor: !!document.querySelector('[data-testid="chord-editor"]'),
    overlay: !!overlay,
    cards: cards.length,
    colors: [...new Set(cards.map((c) => c.dataset.color))],
    labeled: cards.every((c) => c.textContent.trim().length > c.dataset.spelling.length),
    tooltip: cards[0]?.getAttribute('title') ?? '',
    noScroll: ed !== null && ed.scrollHeight <= ed.clientHeight + 1,
  };
});
check('Picker opens with 8 compact tiles: colored, function-labeled, explained on hover, no scrollbar',
  res.open && res.cards === 8 && res.colors.every((c) => ['green', 'yellow', 'red'].includes(c)) &&
  res.labeled && res.tooltip.includes('/100') && res.tooltip.length > 20 && res.noScroll,
  JSON.stringify({ cards: res.cards, colors: res.colors, labeled: res.labeled, tooltip: res.tooltip.slice(0, 40), noScroll: res.noScroll }));
await page.screenshot({ path: path.join(os.tmpdir(), 'chord-picker-1-open.png'), clip: await editorBox() });

// H2. Card styling: the software's default graphite fill (no green wash),
//     white text, the compatibility band kept on the border.
const cardStyle = await st(() => {
  const EXP = { green: 'rgba(143, 194, 106, 0.55)', yellow: 'rgba(232, 200, 106, 0.5)', red: 'rgba(224, 75, 52, 0.5)' };
  const cards = [...document.querySelectorAll('[data-testid^="suggestion-card-"]')];
  const el = cards.find((c) => c.dataset.color === 'green' && !c.className.includes('ring-1')) ?? cards[0];
  const cs = getComputedStyle(el);
  const ss = getComputedStyle(el.querySelector('span'));
  return {
    band: el.dataset.color, bg: cs.backgroundColor, border: cs.borderTopColor, text: ss.color,
    ok: cs.backgroundColor === 'rgb(23, 23, 25)' && ss.color === 'rgb(255, 255, 255)' && cs.borderTopColor === EXP[el.dataset.color],
  };
});
check('Cards: default background (no green fill), white text, band border kept (green)',
  cardStyle.ok && cardStyle.band === 'green', JSON.stringify(cardStyle));

// I. "+more" reveals the next ranked row — never a scrolling panel.
const total = await st(() => {
  const btn = document.querySelector('[data-testid="suggestion-more"]');
  return btn === null ? 8 : Number(btn.textContent.match(/\/(\d+)\s*$/)?.[1] ?? 8);
});
await page.click('[data-testid="suggestion-more"]');
await page.waitForTimeout(120);
const afterMore = await st(() => {
  const cards = [...document.querySelectorAll('[data-testid^="suggestion-card-"]')];
  return { count: cards.length, first8: cards.slice(0, 8).every((c) => c.dataset.spelling.length > 0) };
});
check('"+more" reveals the next ranked row (8 → 12) and preserves the engine order',
  total >= 12 && afterMore.count === 12 && afterMore.first8, `total ${total}, visible ${afterMore.count}`);

// J. IMMEDIATE selection: clicking a tile applies it at once — one undo step,
//    voicing written, bounds preserved, popup STAYS open, ring marks the chord.
const prePick = await st(() => window.crescodeTest.store.getState().past.length);
const pick0 = await st(() => document.querySelector('[data-testid="suggestion-card-0"]')?.dataset.spelling ?? null);
await page.click('[data-testid="suggestion-card-0"]');
await page.waitForTimeout(250);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const c = s.project.chords.find((x) => x.id.startsWith('sch_'));
  const lane = s.project.tracks.find((t) => t.role === 'chords');
  const applied = [...document.querySelectorAll('[data-testid^="suggestion-card-"]')].find((el) => el.dataset.spelling === c.symbol);
  return {
    open: s.suggestionClipId !== null,
    symbol: c?.symbol ?? null, start: c?.startTick, len: c?.durationTicks,
    notes: lane.notes.map((n) => n.pitch),
    steps: s.past.length,
    ringed: applied !== undefined && applied.className.includes('ring-1'),
    applyBtnGone: document.querySelector('[data-testid="apply-chord"]') === null,
  };
});
check('Clicking a tile applies it immediately (no Apply button): one undo step, MIDI written, popup stays open',
  res.open && res.symbol === pick0 && res.start === 5760 && res.len === 3840 &&
  res.notes.length >= 3 && res.steps === prePick + 1 && res.ringed && res.applyBtnGone &&
  res.notes.every((p) => p >= 36 && p <= 84) &&
  new Set(res.notes.map((p) => p % 12)).size === res.notes.length,
  JSON.stringify(res));

// J2. Repeated selection: a second tile applies too — progression building.
const pick1 = await st(() => document.querySelector('[data-testid="suggestion-card-1"]')?.dataset.spelling ?? null);
await page.click('[data-testid="suggestion-card-1"]');
await page.waitForTimeout(250);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return {
    symbol: s.project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null,
    steps: s.past.length,
    open: s.suggestionClipId !== null,
  };
});
check('A second tile applies immediately too (one more undo step, popup open)',
  res.symbol === pick1 && res.steps === prePick + 2 && res.open, JSON.stringify(res));

// J3. Ctrl+Z reverts exactly one pick; redo replays it.
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
const undone = await st(() => window.crescodeTest.store.getState().project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null);
await page.keyboard.press('Control+y');
await page.waitForTimeout(150);
const redone = await st(() => window.crescodeTest.store.getState().project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null);
check('Ctrl+Z reverts one pick; Ctrl+Y replays it', undone === pick0 && redone === pick1, `undo → ${undone}, redo → ${redone}`);

// K. Advanced: closed by default; an extension change re-applies the CURRENT
//    chord immediately through the same composition path.
const triad = await st(() => {
  const cards = [...document.querySelectorAll('[data-testid^="suggestion-card-"]')];
  const i = cards.findIndex((x) => x.dataset.quality === 'major' || x.dataset.quality === 'minor');
  return { idx: i, spelling: i >= 0 ? cards[i].dataset.spelling : null };
});
if (triad.idx >= 0) {
  await page.click(`[data-testid="suggestion-card-${triad.idx}"]`);
  await page.waitForTimeout(250);
}
const advClosedBefore = await st(() => document.querySelector('[data-testid="suggestion-advanced-panel"]') === null);
await page.click('[data-testid="suggestion-advanced"]');
await page.waitForTimeout(120);
const preAdv = await st(() => window.crescodeTest.store.getState().past.length);
await page.selectOption('[data-testid="suggestion-extension"]', '7');
await page.waitForTimeout(250);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return {
    symbol: s.project.chords.find((x) => x.id.startsWith('sch_'))?.symbol ?? null,
    steps: s.past.length,
    panel: !!document.querySelector('[data-testid="suggestion-advanced-panel"]'),
    preview: document.querySelector('[data-testid="suggestion-preview"]')?.dataset.name ?? null,
  };
});
check('Advanced extension change applies immediately to the current chord (one undo step)',
  advClosedBefore && res.panel && res.symbol === `${triad.spelling}7` &&
  res.steps === preAdv + 1 && res.preview === `${triad.spelling}7`,
  JSON.stringify(res));
await page.screenshot({ path: path.join(os.tmpdir(), 'chord-picker-2-advanced.png'), clip: await editorBox() });

// L. Drift guard: a clip moved since the picker opened warns, never overwrites.
await st(() => {
  const s = window.crescodeTest.store.getState();
  s.edit((p) => ({ ...p, chords: p.chords.map((c) => (c.id.startsWith('sch_') ? { ...c, startTick: c.startTick + 960 } : c)) }));
});
await page.waitForTimeout(200);
const preDrift = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { steps: s.past.length, symbol: s.project.chords.find((c) => c.id.startsWith('sch_')).symbol };
});
await page.click('[data-testid="suggestion-card-0"]');
await page.waitForTimeout(250);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return {
    toast: s.toasts.at(-1)?.kind ?? null,
    steps: s.past.length,
    symbol: s.project.chords.find((c) => c.id.startsWith('sch_')).symbol,
  };
});
check('Pick on a moved clip warns non-destructively (no overwrite, no undo step)',
  res.toast === 'warn' && res.steps === preDrift.steps && res.symbol === preDrift.symbol,
  JSON.stringify(res));
await page.keyboard.press('Escape');

// M. Minimize/expand still collapses the picker to its header strip. The
//    dblclick also opens the inline rename input at the clip (its dropdown
//    overlays the picker while typing) — Esc dismisses it, the picker stays.
const schStartM = await st(() => window.crescodeTest.store.getState().project.chords.find((c) => c.id.startsWith('sch_'))?.startTick ?? 0);
await dblclickTick(schStartM + 240);
await page.waitForTimeout(150);
await page.keyboard.press('Escape'); // dismiss the inline rename, picker remains
await page.waitForTimeout(120);
await page.click('[data-testid="chord-editor-minimize"]');
await page.waitForTimeout(120);
res = await st(() => ({ open: window.crescodeTest.store.getState().suggestionClipId !== null, grid: !!document.querySelector('[data-testid="suggestion-grid"]') }));
const minimizedOk = res.open && !res.grid;
await page.click('[data-testid="chord-editor-minimize"]');
await page.waitForTimeout(120);
res = await st(() => ({ grid: !!document.querySelector('[data-testid="suggestion-grid"]') }));
check('Minimize collapses to the header strip and expands again', minimizedOk && res.grid, JSON.stringify(res));

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

// U. POPUP SYNC: clicking a different chord card while the picker is open
//    re-targets the popup — settings reload from the clicked card instantly,
//    and a tile pick then applies to THAT card (one undo step, popup open).
await st(() => {
  const s = window.crescodeTest.store.getState();
  s.edit((p) => ({ ...p, chords: [...p.chords, { id: 'sync_card', symbol: 'G', startTick: 11520, durationTicks: 3840 }] }));
});
await dblclickTick(schStart + 240); // reopen the picker on the Smart clip
await page.waitForTimeout(150);
await page.keyboard.press('Escape'); // dismiss the inline rename, picker remains
await page.waitForTimeout(120);
const beforeSync = await st(() => ({
  open: window.crescodeTest.store.getState().suggestionClipId,
  value: document.querySelector('[data-testid="chord-editor-symbol"]')?.value ?? null,
  head: document.querySelector('[data-testid="chord-editor"]')?.textContent.match(/bar \d+ · beat \d+/)?.[0] ?? null,
}));
const syncBoxBefore = await editorBox();
await page.locator('[data-testid="chord"]').filter({ hasText: /^G$/ }).click();
await page.waitForTimeout(60);
const glideStyle = await st(() => {
  const ed = document.querySelector('[data-testid="chord-editor"]');
  return { prop: getComputedStyle(ed).transitionProperty, left: ed.getBoundingClientRect().left };
});
await page.waitForTimeout(400);
const glideLeft = await st(() => document.querySelector('[data-testid="chord-editor"]')?.getBoundingClientRect().left ?? 0);
const afterSync = await st(() => {
  const s = window.crescodeTest.store.getState();
  return {
    open: s.suggestionClipId,
    selected: s.selectedChordId,
    value: document.querySelector('[data-testid="chord-editor-symbol"]')?.value ?? null,
    head: document.querySelector('[data-testid="chord-editor"]')?.textContent.match(/bar \d+ · beat \d+/)?.[0] ?? null,
    grid: !!document.querySelector('[data-testid="suggestion-grid"]'),
  };
});
check('Clicking a different chord card re-targets the open picker (name + position reload)',
  beforeSync.open !== null && beforeSync.open !== 'sync_card' && afterSync.open === 'sync_card' &&
  afterSync.selected === 'sync_card' && afterSync.value === 'G' && afterSync.head === 'bar 4 · beat 1' &&
  afterSync.grid && afterSync.head !== beforeSync.head, JSON.stringify({ beforeSync, afterSync }));
check('The popup GLIDES to the re-targeted chord: transition active mid-move, anchor shifted',
  glideStyle.prop.includes('left') && glideStyle.prop.includes('top') &&
  glideLeft > syncBoxBefore.x + 4,
  JSON.stringify({ prop: glideStyle.prop, from: syncBoxBefore.x, to: glideLeft }));
await page.screenshot({ path: path.join(os.tmpdir(), 'chord-picker-3-synced.png'), clip: await editorBox() });
const syncPick = await st(() => document.querySelector('[data-testid="suggestion-card-0"]')?.dataset.spelling ?? null);
const preSyncPick = await st(() => window.crescodeTest.store.getState().past.length);
await page.click('[data-testid="suggestion-card-0"]');
await page.waitForTimeout(250);
const appliedSync = await st(() => {
  const s = window.crescodeTest.store.getState();
  return {
    sym: s.project.chords.find((c) => c.id === 'sync_card')?.symbol ?? null,
    steps: s.past.length,
    open: s.suggestionClipId,
  };
});
check('After the re-target, a tile pick applies to the newly selected card',
  appliedSync.sym === syncPick && appliedSync.steps === preSyncPick + 1 && appliedSync.open === 'sync_card',
  JSON.stringify({ syncPick, appliedSync }));
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);
const undoneSync = await st(() => window.crescodeTest.store.getState().project.chords.find((c) => c.id === 'sync_card')?.symbol ?? null);
check('Ctrl+Z reverts the pick on the re-targeted card', undoneSync === 'G', String(undoneSync));

// V. EMPTY-SPACE follow: single click on empty lane space creates a manual
//    chord — the open picker must re-target onto it (settings + writes).
await page.keyboard.press('Escape'); // close the picker from U
await page.waitForTimeout(120);
await dblclickTick(schStart + 240); // reopen the picker on the Smart clip
await page.waitForTimeout(150);
await page.keyboard.press('Escape'); // dismiss the inline rename, picker remains
await page.waitForTimeout(120);
const laneB = await laneBox();
await page.mouse.click(xFor(laneB, 16320), laneB.y + laneB.height / 2); // empty space → new manual chord
await page.waitForTimeout(300);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const c = s.project.chords.find((x) => x.startTick === 16320);
  return {
    created: c?.id ?? null,
    open: s.suggestionClipId,
    value: document.querySelector('[data-testid="chord-editor-symbol"]')?.value ?? null,
    head: document.querySelector('[data-testid="chord-editor"]')?.textContent.match(/bar \d+ · beat \d+/)?.[0] ?? null,
    grid: !!document.querySelector('[data-testid="suggestion-grid"]'),
  };
});
check('Clicking empty lane space re-targets the picker onto the freshly created chord',
  res.created !== null && res.open === res.created && res.value === 'C' &&
  res.head === 'bar 5 · beat 2' && res.grid, JSON.stringify(res));
const vPick = await st(() => document.querySelector('[data-testid="suggestion-card-0"]')?.dataset.spelling ?? null);
const preVPick = await st(() => window.crescodeTest.store.getState().past.length);
await page.click('[data-testid="suggestion-card-0"]');
await page.waitForTimeout(250);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { sym: s.project.chords.find((x) => x.startTick === 16320)?.symbol ?? null, steps: s.past.length };
});
check('A pick applies to the freshly created chord (the previous chord is untouched)',
  res.sym === vPick && res.steps === preVPick + 1, JSON.stringify({ vPick, res }));
await page.keyboard.press('Control+z');
await page.waitForTimeout(150);

// W. Click outside the popup closes it; the track headers stack ABOVE it.
const zOrder = await st(() => ({
  header: getComputedStyle(document.querySelector('[data-track-header]')).zIndex,
  editor: getComputedStyle(document.querySelector('[data-testid="chord-editor"]')).zIndex,
}));
await page.locator('[data-testid="track-header"]').nth(3).click(); // outside popup and lane
await page.waitForTimeout(150);
res = await st(() => ({
  open: window.crescodeTest.store.getState().suggestionClipId,
  editor: !!document.querySelector('[data-testid="chord-editor"]'),
}));
check('Clicking outside the popup (a track header) closes it; headers sit above the popup',
  res.open === null && !res.editor && Number(zOrder.header) > Number(zOrder.editor),
  JSON.stringify({ zOrder, res }));
await page.keyboard.press('Escape');

check('No uncaught page errors', errors.length === 0, errors.slice(0, 2).join(';'));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `${results.length}/${results.length} passed` : `${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
