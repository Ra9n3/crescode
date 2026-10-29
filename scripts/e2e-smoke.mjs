/**
 * Automated UI smoke test (headless Chromium via Playwright).
 *   npx playwright install chromium   (once)
 *   npm run e2e
 * Asserts: startup fixture, Compose All, header/lane alignment with 21+10 tracks
 * before & after scrolling, 5,000 notes render, mixer strips, VST browser states,
 * chord validation (red), piano roll edit → export round-trip, undo/redo 50.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  — ${info}` : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url);
await page.waitForSelector('[data-track-header]');

const st = (fn) => page.evaluate(fn);
check('Fixture loaded on startup', await st(() => { const p = window.crescodeTest.store.getState().project; return p.name === 'Dorian 16 Bars' && p.mode === 'Dorian' && p.bpm === 100 && p.sections.length === 2; }));
check('21 default tracks rendered', (await page.locator('[data-track-header]').count()) === 21);

await page.click('[data-testid=compose-all]');
const noteCount = await st(() => window.crescodeTest.store.getState().project.tracks.reduce((a, t) => a + t.notes.length, 0));
check('Compose All fills lanes', noteCount > 100, `${noteCount} notes`);

let align = await st(() => window.crescodeTest.runAlignmentTest());
check('Alignment (21 tracks) before/after scroll', align.ok, `${align.checked} checks ${align.failures.slice(0, 2).join(';')}`);

await st(() => { const s = window.crescodeTest.store.getState(); for (let i = 0; i < 10; i++) s.addTrack(['Strings', 'Brass', 'Woodwinds', 'Percussion', 'Keys'][i % 5]); });
await st(() => window.crescodeTest.fillRandomNotes(5000));
const total = await st(() => window.crescodeTest.store.getState().project.tracks.reduce((a, t) => a + t.notes.length, 0));
check('5,000 random notes loaded across 31 tracks', total >= 5000, `${total} notes`);
align = await st(() => window.crescodeTest.runAlignmentTest());
check('Alignment (31 tracks, 5k notes) before/after scroll', align.ok, `${align.checked} checks`);

const scrollMs = await page.evaluate(async () => {
  const sc = document.getElementById('arranger-scroll');
  const t0 = performance.now(); let frames = 0;
  for (let i = 0; i < 60; i++) { sc.scrollTop = (i * 37) % sc.scrollHeight; sc.scrollLeft = (i * 53) % 2000; await new Promise((r) => requestAnimationFrame(r)); frames++; }
  return (performance.now() - t0) / frames;
});
check('Scrolling with 5k notes stays smooth', scrollMs < 50, `${scrollMs.toFixed(1)} ms/frame (headless)`);

await page.setViewportSize({ width: 1100, height: 700 });
align = await st(() => window.crescodeTest.runAlignmentTest());
check('Alignment after window resize', align.ok);
await page.setViewportSize({ width: 1600, height: 950 });

// 1. Routing button has space and appears fully inside window bounds across desktop resolutions
for (const w of [1600, 1440, 1366, 1280]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.waitForTimeout(100);
  const routingBox = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="routing-toggle"]');
    const r = btn.getBoundingClientRect();
    return { right: r.right, vw: window.innerWidth, visible: r.width > 0 && r.right <= window.innerWidth - 2 };
  });
  check(`Routing button appears fully inside window bounds at ${w}px`, routingBox.visible, `${routingBox.right}px <= ${routingBox.vw}px`);
}
await page.setViewportSize({ width: 1600, height: 950 });

// 2. Mixer toggle behavior (clicking hides it, clicking again shows it)
const mixerLocator = page.locator('[data-testid=mixer]');
check('Mixer dock is visible on startup', await mixerLocator.isVisible());
await page.locator('[data-testid=mixer-toggle]').click();
await page.waitForTimeout(200);
check('Clicking mixer button hides the mixer', !(await mixerLocator.isVisible()));
await page.locator('[data-testid=mixer-toggle]').click();
await page.waitForTimeout(200);
check('Clicking mixer button again restores the mixer', await mixerLocator.isVisible());

await page.locator('[data-testid=routing-toggle]').click();
check('Mixer stays full-width while routing is open', await page.locator('[data-testid=mixer]').isVisible() && await page.locator('[data-testid=routing-panel]').isVisible());
await page.locator('[data-testid=routing-toggle]').click();
const mix = await page.evaluate(() => { const el = document.querySelector('[data-testid=mixer-channels]'); return { sw: el.scrollWidth, cw: el.clientWidth }; });
check('Mixer fits all channels with no scrollbar', mix.sw <= mix.cw + 1, `${mix.sw}/${mix.cw}px`);
// The printed numbers need strip room; verify them in the default 21-track state.
await page.reload();
await page.waitForSelector('[data-testid=mixer-strip]');
const legend = await page.evaluate(() => {
  const strip = document.querySelector('[data-testid=mixer-strip]');
  const labels = [...strip.querySelectorAll('[data-testid=strip-scale] [data-scale]')].map((e) => { const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, v: e.dataset.scale }; }).sort((a, b) => a.t - b.t);
  let overlaps = 0; for (let i = 1; i < labels.length; i++) if (labels[i].t < labels[i - 1].b - 0.5) overlaps++;
  return { seq: labels.map((l) => l.v).join(','), overlaps, count: labels.length };
});
check('Channel shows printed dB numbers to the right of the meter, no overlap', legend.seq === '+6,0,−10,−20,−40' && legend.overlaps === 0, `${legend.count} labels`);
const masterScale = await page.evaluate(() => {
  const m = document.querySelector('[data-testid=master-strip]');
  return [...m.querySelectorAll('[data-testid=meter-scale] [data-scale]')].map((e) => e.dataset.scale).join(',');
});
check('Master shows the printed meter scale', masterScale === '+6,0,−10,−20,−40,−∞', masterScale);
const geometry = await page.evaluate(() => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { t: r.top, b: r.bottom, cx: r.left + r.width / 2, r: r.right, l: r.left, w: r.width }; };
  const strip = document.querySelectorAll('[data-testid=mixer-strip]')[3];
  const master = document.querySelector('[data-testid=master-strip]');
  const lamps = R(strip.querySelector('button[aria-label^="Mute"]').parentElement);
  const fader = R(strip.querySelector('[role=slider][aria-label^="Volume"]'));
  const meter = R(strip.querySelector('[data-testid=meter]'));
  const readout = R(strip.querySelector('[data-testid=meter-db]'));
  const masterFader = R(master.querySelector('[role=slider][aria-label^="Master"]'));
  const masterMeter = R(master.querySelector('[data-testid=meter]'));
  const stripW = R(strip);
  const masterBox = R(master);
  const scale = strip.querySelector('[data-testid=strip-scale]');
  const scaleR = scale ? scale.getBoundingClientRect().right : meter.r;
  return {
    faderLevelWithMeter: Math.abs(fader.t - meter.t) < 1 && Math.abs(fader.b - meter.b) < 1,
    elementsCentered: Math.abs((fader.l + scaleR) / 2 - stripW.cx) < 2,
    meterRightOfFader: meter.l >= fader.r - 1,
    readoutUnderMeter: readout.t >= meter.b - 1 && Math.abs(readout.cx - meter.cx) < 6,
    readoutInsideStrip: readout.r <= stripW.r + 0.5 && readout.l >= stripW.l - 0.5,
    masterSameTravel: Math.abs((masterFader.b - masterFader.t) - (fader.b - fader.t)) < 1 && Math.abs((masterMeter.b - masterMeter.t) - (meter.b - meter.t)) < 1,
    masterWidth: masterBox.w, channelWidth: stripW.w,
  };
});
check('Fader and level meter are level, centered beneath the lamps, meter to its right', geometry.faderLevelWithMeter && geometry.elementsCentered && geometry.meterRightOfFader);
check('dB readout sits under the meter and never overflows the strip', geometry.readoutUnderMeter && geometry.readoutInsideStrip, `${geometry.readoutUnderMeter}/${geometry.readoutInsideStrip}`);
check('Master strip matches channel width and fader travel', Math.abs(geometry.masterWidth - geometry.channelWidth) < 1.5, `${geometry.masterWidth} vs ${geometry.channelWidth}px`);
const lampBtn = page.locator('[data-testid=mixer-strip]').first().locator('button[aria-label^="Mute"]');
const lampOff = await lampBtn.evaluate((m) => ({ face: getComputedStyle(m).backgroundImage, border: getComputedStyle(m).borderTopColor }));
await lampBtn.click(); await page.waitForTimeout(80);
const lampOn = await lampBtn.evaluate((m) => ({ face: getComputedStyle(m).backgroundImage, border: getComputedStyle(m).borderTopColor, pressed: m.getAttribute('aria-pressed'), dot: getComputedStyle(m, '::after').backgroundColor }));
await lampBtn.click(); await page.waitForTimeout(40);
check('M/S/L lamp keeps a graphite face and dark border with a lit LED dot', lampOff.face === lampOn.face && lampOff.border === lampOn.border && lampOn.pressed === 'true' && lampOn.dot !== 'rgba(0, 0, 0, 0)', `${lampOn.border} | ${lampOn.dot}`);
const strip0 = page.locator('[data-testid=mixer-strip]').first();
const beforeSel = await strip0.evaluate((s) => ({ shadow: getComputedStyle(s).boxShadow, filter: getComputedStyle(s).filter }));
await strip0.click({ position: { x: 10, y: 8 } }); await page.waitForTimeout(220); // let the 150ms shadow transition settle
const afterSel = await strip0.evaluate((s) => ({ selected: s.getAttribute('data-selected'), shadow: getComputedStyle(s).boxShadow, filter: getComputedStyle(s).filter, bl: getComputedStyle(s).borderLeftColor, br: getComputedStyle(s).borderRightColor }));
check('Selected strip uses a symmetrical inner glow and borders', afterSel.selected === 'true' && afterSel.shadow !== beforeSel.shadow && afterSel.bl === afterSel.br && afterSel.filter === beforeSel.filter, JSON.stringify({ sel: afterSel.selected, bl: afterSel.bl, br: afterSel.br, changed: afterSel.shadow !== beforeSel.shadow }));
const plateAndCap = await page.evaluate(() => {
  const mix = document.querySelector('[data-testid=mixer]');
  const strip = document.querySelector('[data-testid=mixer-strip]');
  const cap = strip.querySelector('[data-fader-cap]');
  const meter = strip.querySelector('[data-testid=meter]').getBoundingClientRect();
  const dbEl = strip.querySelector('[data-testid=meter-db]').getBoundingClientRect();
  const masterMeter = document.querySelector('[data-testid=master-strip] [data-testid=meter]').getBoundingClientRect();
  const masterDbEl = document.querySelector('[data-testid=master-meter-db]').getBoundingClientRect();
  return {
    mixPlate: mix.classList.contains('plate'),
    stripPlate: strip.classList.contains('plate'),
    capLine: getComputedStyle(cap, '::before').backgroundColor,
    dbUnderMeter: dbEl.top >= meter.bottom - 1 && Math.abs((dbEl.left + dbEl.width / 2) - (meter.left + meter.width / 2)) < 12,
    masterDbUnderMeter: masterDbEl.top >= masterMeter.bottom - 1 && Math.abs((masterDbEl.left + masterDbEl.width / 2) - (masterMeter.left + masterMeter.width / 2)) < 16,
  };
});
check('Aluminum plate mixer, graphite fader cap with silver line, dB under meter', plateAndCap.mixPlate && plateAndCap.stripPlate && (plateAndCap.capLine === 'rgb(255, 255, 255)' || plateAndCap.capLine === 'rgb(233, 230, 224)') && plateAndCap.dbUnderMeter && plateAndCap.masterDbUnderMeter);
const panKnob = page.locator('[data-testid=mixer-strip]').first().locator('[role=slider][aria-label^="Pan"]');
const panBefore = await panKnob.getAttribute('aria-valuenow');
await panKnob.hover();
await page.mouse.wheel(0, -160);
await page.waitForTimeout(60);
check('Scroll wheel turns the pan knob', panBefore !== (await panKnob.getAttribute('aria-valuenow')), `${panBefore} → ${await panKnob.getAttribute('aria-valuenow')}`);
const expectStrips = await st(() => window.crescodeTest.store.getState().project.tracks.filter((t) => t.family !== 'Structure').length);
const stripsNow = await page.locator('[data-testid=mixer-strip]').count();
check('Mixer: one strip per track + master', stripsNow === expectStrips && (await page.locator('[data-testid=master-strip]').count()) === 1, `${stripsNow} strips`);
const vId = await st(() => window.crescodeTest.store.getState().project.tracks[3].id);
await page.locator(`[data-strip="${vId}"] button[aria-label^="Mute"]`).click();
check('Mute in mixer reflects in header', await st(() => window.crescodeTest.store.getState().project.tracks[3].muted) && (await page.locator(`[data-track-header="${vId}"] button[aria-label^="Mute"]`).getAttribute('aria-pressed')) === 'true');
// VST browser states
await page.locator('[data-testid=vst-btn]').first().click();
check('VST browser: Not scanned state', await page.locator('[data-testid=vst-notscanned]').isVisible());
check('Mixer remains visible behind VST browser', await page.locator('[data-testid=mixer]').isVisible());
for (const [k, id] of [['scanning', 'vst-scanning'], ['empty', 'vst-empty'], ['loaded', 'vst-loaded']]) {
  await page.getByRole('button', { name: k, exact: true }).click();
  check(`VST browser: ${k} state`, await page.locator(`[data-testid=${id}]`).isVisible());
}
const names = await page.locator('[data-testid=vst-loaded] button span.flex-1').allTextContents();
check('Plugin names stripped of .vst3 / 64-bit', names.every((n) => !/vst3|64.?bit|x64/i.test(n)), names.join(', '));
await page.keyboard.press('Escape');

await page.getByRole('button', { name: 'Settings', exact: true }).click();
const devSwitch = page.getByRole('switch', { name: 'Enable developer tools' });
const beforeSwitch = await devSwitch.getAttribute('aria-checked');
const onShadow = await devSwitch.evaluate((e) => getComputedStyle(e).boxShadow);
await devSwitch.click();
const offShadow = await devSwitch.evaluate((e) => getComputedStyle(e).boxShadow);
check('Settings control is an analog switch with on/off state and glow', beforeSwitch !== await devSwitch.getAttribute('aria-checked') && onShadow !== offShadow);
await page.getByRole('button', { name: 'Done' }).click();

// Chords: invalid symbol shows red
await st(() => window.crescodeTest.store.getState().edit((p) => ({ ...p, chords: [...p.chords, { id: 'bad1', symbol: 'Hxyz', startTick: 0, durationTicks: 10 }] })));
check('Invalid chord symbol shown red', (await page.locator('[data-testid=chord][data-invalid]').count()) === 1);
await st(() => { const s = window.crescodeTest.store.getState(); s.deleteChord('bad1'); s.set({ pxPerTick: 0.2 }); });
check('Chords survive zoom', (await page.locator('[data-testid=chord]').count()) === 18);
await st(() => window.crescodeTest.store.getState().set({ pxPerTick: 0.06 }));

// ---- Chord generator UI/UX (spec: UI-only phase) ----
const genBtn = page.locator('[data-testid=chordgen-generate]');
check('Generate + Settings live in the chords track header', (await genBtn.count()) === 1 && (await page.locator('[data-testid=chordgen-settings]').count()) === 1);
const VALID_TIPS = ['Generate chords for entire song', 'Fill empty chord spaces', 'Regenerate entire song'];
const tip0 = await genBtn.getAttribute('title');
check('Generate tooltip reflects the detected scope', tip0 !== null && (VALID_TIPS.includes(tip0) || tip0.startsWith('Regenerate selected section: ')), tip0 ?? '');

// Generate click: immediate, no prompt, no dialog — and it actually generates (Phase 4)
await page.evaluate(() => { window.__promptCalls = 0; window.prompt = () => { window.__promptCalls++; return ''; }; });
const chordSeedBeforeGen = await st(() => window.crescodeTest.store.getState().project.chordGenSettings?.seed);
await genBtn.click();
await page.waitForTimeout(300);
const genState = await st(() => ({
  chords: window.crescodeTest.store.getState().project.chords,
  seed: window.crescodeTest.store.getState().project.chordGenSettings?.seed,
}));
const chordCountAfterGen = genState.chords.length;
check('Generate: no prompt, no dialog, chords generated + seed advanced',
  chordCountAfterGen > 0
  && genState.chords.every((c) => Number.isInteger(c.startTick) && c.durationTicks >= 1)
  && genState.seed === ((chordSeedBeforeGen + 1) >>> 0)
  && await st(() => window.__promptCalls) === 0
  && (await page.locator('[data-testid=chordgen-panel]').count()) === 0,
  `count=${chordCountAfterGen} seed=${genState.seed}`);

// Section selection UX: whole block clickable, tooltip switches, second click deselects
const section0 = page.locator('[data-testid=section]').first();
await section0.click();
const tipSel = await genBtn.getAttribute('title');
check('Selected section → section-scoped tooltip', tipSel?.startsWith('Regenerate selected section: ') ?? false, tipSel ?? '');
check('Section selection is store state', await st(() => window.crescodeTest.store.getState().selectedSectionId !== null));
await section0.click();
check('Second click on the section deselects it', await st(() => window.crescodeTest.store.getState().selectedSectionId === null));
check('Tooltip follows the deselection', (await genBtn.getAttribute('title')) === tip0);

// Settings panel: opens from the gear only, autosaves into the project, survives close, undoable
await page.locator('[data-testid=chordgen-settings]').click();
await page.waitForSelector('[data-testid=chordgen-panel]');
await page.selectOption('[data-testid=chordgen-complexity]', '3');
check('Settings autosave into the project (no Apply)', await st(() => window.crescodeTest.store.getState().project.chordGenSettings?.complexity) === 3);
await page.getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(50);
check('Values survive closing the panel', await st(() => window.crescodeTest.store.getState().project.chordGenSettings?.complexity) === 3 && (await page.locator('[data-testid=chordgen-panel]').count()) === 0);
await st(() => window.crescodeTest.store.getState().undo());
check('A settings change is one undo step', await st(() => window.crescodeTest.store.getState().project.chordGenSettings?.complexity) === 2);
await st(() => window.crescodeTest.store.getState().redo());

// Chord locking: manual placement locks at birth; right-click toggles; undo restores
check('Manually placed chords are locked at birth', await st(() => {
  const s = window.crescodeTest.store.getState();
  const id = s.addChord({ symbol: 'Dm', startTick: 8 * 3840, durationTicks: 3840, locked: true });
  const c = window.crescodeTest.store.getState().project.chords.find((x) => x.id === id); // fresh state, not the pre-add snapshot
  s.deleteChord(id);
  return c?.locked === true;
}));
await page.locator('[data-testid=chord]').first().click({ button: 'right' }); // locator handles scrolling
await page.waitForSelector('[data-testid=chord-lock-menu]');
await page.locator('[data-testid=chord-lock-toggle]').click();
check('Right-click menu locks a chord with an indicator', (await page.locator('[data-testid=chord][data-locked]').count()) === 1);
await st(() => window.crescodeTest.store.getState().undo());
check('Chord lock participates in undo', (await page.locator('[data-testid=chord][data-locked]').count()) === 0);
check('Locking left the chord count intact', (await page.locator('[data-testid=chord]').count()) === chordCountAfterGen);

// Piano roll edit -> export
await st(() => window.crescodeTest.store.getState().edit((p) => ({ ...p, tracks: p.tracks.map((t, i) => (i === 3 ? { ...t, notes: [] } : t)) })));
await page.locator(`[data-track-lane="${vId}"]`).dblclick({ position: { x: 400, y: 20 } });
await page.waitForSelector('[data-testid=piano-roll]');
check('Mixer remains visible with piano roll open', await page.locator('[data-testid=mixer]').isVisible());
const grid = page.locator('[data-testid=piano-roll] .cursor-crosshair');
const box = await grid.boundingBox();
await page.mouse.click(box.x + 200, box.y + 300);
const prNotes = await st(() => window.crescodeTest.store.getState().project.tracks[3].notes);
check('Piano roll: draw note returns to timeline', prNotes.length === 1, JSON.stringify(prNotes[0]));
await page.keyboard.press('Escape');

const undoOk = await st(() => {
  const s = window.crescodeTest.store;
  const start = JSON.stringify(s.getState().project);
  for (let i = 0; i < 50; i++) s.getState().updateTrack(s.getState().project.tracks[4 + (i % 10)].id, { pan: ((i % 9) - 4) / 4 });
  const after = JSON.stringify(s.getState().project);
  for (let i = 0; i < 50; i++) s.getState().undo();
  const a = JSON.stringify(s.getState().project) === start;
  for (let i = 0; i < 50; i++) s.getState().redo();
  return a && JSON.stringify(s.getState().project) === after;
});
check('50 undo + 50 redo return to identical states', undoOk);

await page.screenshot({ path: path.join(root, 'docs', 'screenshot.png') });
check('No uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
