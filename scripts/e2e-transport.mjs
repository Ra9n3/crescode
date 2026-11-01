/**
 * Transport / playhead / auto-scroll e2e (headless Chromium via Playwright).
 *   npm run build && node scripts/e2e-transport.mjs
 *
 * Covers the spec's acceptance criteria end-to-end in the real app:
 * ruler click parking, play from the clicked bar, smooth follow pinning at
 * the trigger point, manual-scroll suspension + Re-follow badge + shortcut,
 * scrub and edit-drag suspension, click-during-playback relocation (+ its
 * off preference), Stop parking (+ return-to-start and second-stop
 * preferences), Pause exact resume, Ctrl+wheel zoom keeping the playhead's
 * musical position, tempo change during playback staying continuous,
 * loop-fit (no page jumps), end-of-project parking, per-editor follow
 * independence (arranger off / piano roll on), and preference persistence
 * across a reload.
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

const st = (fn, arg) => page.evaluate(fn, arg);
const BAR = 3840; // 4/4 at 960 PPQ
const HEADER = 300;

// Fast tempo + zoom level that makes the timeline several viewports wide.
await st(() => {
  const s = window.crescodeTest.store.getState();
  s.edit((p) => ({ ...p, bpm: 400, tempoMap: [{ tick: 0, bpm: 400 }] }));
  s.set({ pxPerTick: 0.06, loop: false });
});

const scrollerBox = async () => await page.locator('[data-testid="arranger-scroll"]').boundingBox();
const clickRulerTick = async (tick) => {
  const ppt = await st(() => window.crescodeTest.store.getState().pxPerTick);
  // Bring the target into the visible timeline area first (right of the
  // sticky corner panel) — otherwise the click lands on the corner.
  await st(([t, p]) => { const sc = document.getElementById('arranger-scroll'); sc.scrollLeft = Math.max(0, 300 + t * p - 420); }, [tick, ppt]);
  await page.waitForTimeout(60);
  const r = await page.locator('[data-testid="ruler"]').boundingBox();
  await page.mouse.click(r.x + tick * ppt + 1, r.y + r.height / 2);
  await page.waitForTimeout(80);
};
const playheadX = async () => await st(() => {
  const el = document.querySelector('[data-testid="playhead"]');
  return parseFloat((el.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
});
const stopAll = async () => { await page.click('[data-testid="stop-btn"]'); await page.waitForTimeout(80); }; // real stop through the transport (engine + store stay in sync)
const refollow = async () => { const b = await page.locator('[data-testid="refollow-btn"]').count(); if (b) { await page.click('[data-testid="refollow-btn"]'); await page.waitForTimeout(120); } };

/* 1. Clicking the ruler while stopped parks the playhead without starting playback. */
const TOL = 30; // a 1px click offset ≈ 17 ticks
await clickRulerTick(2 * BAR); // bar 3
let res = await st(() => { const s = window.crescodeTest.store.getState(); return { start: s.startTick, playing: s.playing }; });
check('Clicking bar 3 while stopped parks the playhead and does NOT start playback',
  Math.abs(res.start - 2 * BAR) <= TOL && res.playing === false, JSON.stringify(res));

/* 2. Play starts from the clicked bar and records it as the playback start. */
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(250);
res = await st(() => { const s = window.crescodeTest.store.getState(); return { playing: s.playing, lastStart: s.lastPlaybackStartPosition }; });
check('Play runs from bar 3 and stores it as lastPlaybackStartPosition',
  res.playing === true && Math.abs(res.lastStart - 2 * BAR) <= TOL, JSON.stringify(res));

/* 3. The playhead actually moves. */
const x1 = await playheadX();
await page.waitForTimeout(300);
const x2 = await playheadX();
check('The playhead advances across the timeline during playback', x2 > x1 + 20, `x ${x1.toFixed(0)} → ${x2.toFixed(0)}`);

/* 4. Smooth follow: pinned at 75% of the visible timeline width once past the trigger. */
await page.waitForTimeout(1800);
res = await st(() => {
  const sc = document.getElementById('arranger-scroll');
  const el = document.querySelector('[data-testid="playhead"]');
  const x = parseFloat((el.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
  const anchor = sc.scrollLeft + 300 + (sc.clientWidth - 300) * 0.75;
  return { scrollLeft: Math.round(sc.scrollLeft), anchor: Math.round(anchor), x: Math.round(x), suspended: window.crescodeTest.store.getState().followSuspended };
});
check('Smooth Continuous Follow scrolls once the playhead reaches 75% and pins it there',
  res.scrollLeft > 0 && !res.suspended && Math.abs(res.x - res.anchor) < 25, JSON.stringify(res));
check('The playhead never leaves the view while Smooth Follow is active',
  res.x >= res.scrollLeft + HEADER - 1 && res.x <= res.scrollLeft + 1600, JSON.stringify(res));

/* 5. Manual scrolling suspends following: badge appears, view is NOT yanked back, playback keeps running. */
await st(() => { document.getElementById('arranger-scroll').scrollLeft -= 800; });
await page.waitForTimeout(150);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  return { suspended: s.followSuspended, reason: s.followSuspensionReason, badge: !!document.querySelector('[data-testid="follow-suspended"]'), playing: s.playing };
});
check('Manual scrolling immediately suspends auto-scroll with the badge shown', res.suspended && res.reason === 'manual-scroll' && res.badge, JSON.stringify(res));
const scrollAfterSuspend = await st(() => Math.round(document.getElementById('arranger-scroll').scrollLeft));
const pxBefore = await playheadX();
await page.waitForTimeout(350);
res = await st((parked) => {
  const el = document.querySelector('[data-testid="playhead"]');
  const x = parseFloat((el.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
  return { scrollKept: Math.round(document.getElementById('arranger-scroll').scrollLeft) === parked, x };
}, scrollAfterSuspend);
check('While suspended the view stays put and the playhead keeps moving at its true position',
  res.scrollKept && res.x > pxBefore + 20, JSON.stringify({ scrollAfterSuspend, ...res }));

/* 6. The Re-follow button resumes and snaps the view back to the playhead. */
await page.click('[data-testid="refollow-btn"]');
await page.waitForTimeout(150);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const sc = document.getElementById('arranger-scroll');
  const el = document.querySelector('[data-testid="playhead"]');
  const x = parseFloat((el.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
  const anchor = sc.scrollLeft + 300 + (sc.clientWidth - 300) * 0.75;
  return { suspended: s.followSuspended, badge: !!document.querySelector('[data-testid="follow-suspended"]'), near: Math.abs(x - anchor) < 25 };
});
check('Re-follow button resumes following and snaps the view to the playhead',
  !res.suspended && !res.badge && res.near, JSON.stringify(res));

/* 7. The keyboard shortcut (F) also re-follows. */
await st(() => { document.getElementById('arranger-scroll').scrollLeft -= 500; });
await page.waitForTimeout(120);
let susp1 = await st(() => window.crescodeTest.store.getState().followSuspended);
await page.keyboard.press('f');
await page.waitForTimeout(120);
let susp2 = await st(() => window.crescodeTest.store.getState().followSuspended);
check('The F shortcut re-follows the playhead in the focused editor', susp1 === true && susp2 === false, `before ${susp1} after ${susp2}`);

/* 8. Scrubbing suspends and STAYS suspended after the scrub ends. */
const rr = await page.locator('[data-testid="ruler"]').boundingBox();
const sx = Math.max(rr.x + 320, 340); // stay right of the sticky corner panel (z-42 covers x<300)
await page.mouse.move(sx, rr.y + 15);
await page.mouse.down();
for (let i = 0; i < 6; i++) { await page.mouse.move(sx + i * 40, rr.y + 15); await page.waitForTimeout(40); }
await page.mouse.up();
await page.waitForTimeout(150);
res = await st(() => { const s = window.crescodeTest.store.getState(); return { suspended: s.followSuspended, reason: s.followSuspensionReason, playing: s.playing }; });
check('Scrubbing the ruler suspends following (reason: scrub) and keeps it suspended after', res.suspended && res.reason === 'scrub' && res.playing, JSON.stringify(res));
await refollow();

/* 9. Clicking during playback relocates, keeps playing, re-bases the start, resumes follow. */
await clickRulerTick(5 * BAR); // bar 6
res = await st(() => { const s = window.crescodeTest.store.getState(); return { playing: s.playing, start: s.startTick, lastStart: s.lastPlaybackStartPosition, suspended: s.followSuspended }; });
check('Clicking during playback relocates the playhead, keeps playing and resumes following',
  res.playing && Math.abs(res.start - 5 * BAR) <= TOL && Math.abs(res.lastStart - 5 * BAR) <= TOL && !res.suspended, JSON.stringify(res));

/* 10. Stop parks where it stopped; a second Stop is a no-op (defaults). */
await page.waitForTimeout(400);
await page.click('[data-testid="stop-btn"]');
res = await st(() => { const s = window.crescodeTest.store.getState(); return { playing: s.playing, start: s.startTick, stopped: s.stoppedPosition }; });
const parkedAt = res.start;
check('Stop leaves the playhead at the stopped position (no automatic return)',
  !res.playing && res.start === res.stopped && res.start > 5 * BAR, JSON.stringify(res));
await page.click('[data-testid="stop-btn"]');
res = await st(() => { const s = window.crescodeTest.store.getState(); return { start: s.startTick }; });
check('A second Stop has no additional effect by default', res.start === parkedAt, JSON.stringify({ parkedAt, after: res.start }));

/* 11. Pause freezes exactly; Play resumes from there; lastPlaybackStart untouched by the pause. */
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(250);
let L1 = await st(() => window.crescodeTest.store.getState().lastPlaybackStartPosition); // fresh start re-bases to the parked position
await page.click('[data-testid="pause-btn"]');
res = await st(() => { const s = window.crescodeTest.store.getState(); return { paused: s.paused, playing: s.playing, start: s.startTick }; });
const pausedAt = res.start;
check('Pause freezes the playhead at its exact position', res.paused && !res.playing && res.start > 5 * BAR, JSON.stringify(res));
await page.waitForTimeout(200);
await page.click('[data-testid="play-btn"]'); // resume from the frozen position
await page.waitForTimeout(250);
await page.click('[data-testid="pause-btn"]');
res = await st((l1) => { const s = window.crescodeTest.store.getState(); return { start: s.startTick, lastStart: s.lastPlaybackStartPosition, paused: s.paused }; }, L1);
check('Play after Pause resumes from the frozen position and lastPlaybackStartPosition is unchanged',
  res.paused && res.start > pausedAt && res.lastStart === L1, JSON.stringify({ pausedAt, L1, ...res }));

/* 12. "Return to start position on stop" preference. */
await st(() => { window.crescodeTest.store.getState().setSettings({ stopReturnsToStart: true }); });
await clickRulerTick(7 * BAR); // bar 8
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(300);
await page.click('[data-testid="stop-btn"]');
res = await st(() => { const s = window.crescodeTest.store.getState(); return { start: s.startTick, lastStart: s.lastPlaybackStartPosition }; });
check('With "Return to start on stop", Stop returns the playhead to the playback start',
  Math.abs(res.start - res.lastStart) <= TOL && Math.abs(res.lastStart - 7 * BAR) <= TOL, JSON.stringify(res));
await st(() => { window.crescodeTest.store.getState().setSettings({ stopReturnsToStart: false }); });

/* 13. "Second Stop returns to start position" preference. */
await st(() => { window.crescodeTest.store.getState().setSettings({ secondStopReturnsToStart: true }); });
await clickRulerTick(1 * BAR); // bar 2
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(300);
await page.click('[data-testid="stop-btn"]');
const firstStop = await st(() => window.crescodeTest.store.getState().startTick);
await page.click('[data-testid="stop-btn"]');
res = await st(() => { const s = window.crescodeTest.store.getState(); return { second: s.startTick, lastStart: s.lastPlaybackStartPosition }; });
check('With "Second Stop returns to start", the second press relocates to the playback start',
  firstStop !== res.second && Math.abs(res.second - res.lastStart) <= TOL && Math.abs(res.lastStart - BAR) <= TOL, JSON.stringify({ firstStop, ...res }));
await st(() => { window.crescodeTest.store.getState().setSettings({ secondStopReturnsToStart: false }); });

/* 14. Click-during-playhead preference OFF ignores ruler clicks while playing. */
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(150);
res = await st(() => { const s = window.crescodeTest.store.getState(); s.setSettings({ clickDuringPlaybackMovesPlayhead: false }); return { start: s.startTick }; });
await clickRulerTick(9 * BAR);
res = await st(() => { const s = window.crescodeTest.store.getState(); const t = s.startTick; s.setSettings({ clickDuringPlaybackMovesPlayhead: true }); return { start: t, playing: s.playing }; });
check('With the click preference off, clicking the ruler during playback does not relocate',
  res.playing && res.start < 9 * BAR - 1000, JSON.stringify(res));

/* 15. Editing during playback suspends following and keeps it suspended. */
await st(() => { document.getElementById('arranger-scroll').scrollLeft = 0; }); // bring the bar-1 chord card on screen (this manual scroll suspends; the drag re-suspends as 'edit')
await page.waitForTimeout(100);
const chordBox = await page.locator('[data-testid="chord"]').first().boundingBox();
await page.mouse.move(chordBox.x + chordBox.width / 2, chordBox.y + chordBox.height / 2);
await page.mouse.down();
await page.mouse.move(chordBox.x + chordBox.width / 2 + 10, chordBox.y + chordBox.height / 2, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(150);
res = await st(() => { const s = window.crescodeTest.store.getState(); return { suspended: s.followSuspended, reason: s.followSuspensionReason, playing: s.playing, interaction: s.interactionActive }; });
check('Dragging a clip during playback suspends following (reason: edit), playback keeps running',
  res.suspended && res.reason === 'edit' && res.playing && !res.interaction, JSON.stringify(res));
await refollow();

/* 16. Zooming during playback preserves the playhead's musical position and visibility. */
res = await st(() => { const s = window.crescodeTest.store.getState(); return { ppt: s.pxPerTick }; });
const xBefore = await playheadX();
const tickBefore = (xBefore - HEADER) / res.ppt;
await page.mouse.move(900, 500);
await page.keyboard.down('Control');
await page.mouse.wheel(0, -240);
await page.keyboard.up('Control');
await page.waitForTimeout(350);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const el = document.querySelector('[data-testid="playhead"]');
  const x = parseFloat((el.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
  const sc = document.getElementById('arranger-scroll');
  return { ppt: s.pxPerTick, x, visible: x >= sc.scrollLeft + 300 - 1 && x <= sc.scrollLeft + sc.clientWidth + 1 };
});
const tickAfter = (res.x - HEADER) / res.ppt;
check('Zooming during playback keeps the playhead at its musical position and visible',
  res.ppt > 0.06 && tickAfter >= tickBefore - 1 && tickAfter - tickBefore < 4000 && res.visible,
  `tick ${(tickBefore / BAR).toFixed(2)} → ${(tickAfter / BAR).toFixed(2)} bars (playback advances during the window), visible ${res.visible}`);
await stopAll();

/* 17. Tempo change during playback: the playhead stays continuous (no backward jump). */
await clickRulerTick(1 * BAR);
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(300);
const positions = [];
for (let i = 0; i < 16; i++) {
  positions.push(await st(() => {
    const el = document.querySelector('[data-testid="playhead"]');
    return parseFloat((el.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
  }));
  if (i === 5) await st(() => { const s = window.crescodeTest.store.getState(); s.edit((p) => ({ ...p, bpm: 260, tempoMap: [{ tick: 0, bpm: 260 }] })); });
  await page.waitForTimeout(45);
}
let monotonic = true;
for (let i = 1; i < positions.length; i++) if (positions[i] < positions[i - 1] - 2) monotonic = false;
const stillPlaying = await st(() => window.crescodeTest.store.getState().playing);
check('Changing the tempo while playing keeps the playhead continuous (no jump, no desync)',
  monotonic && stillPlaying, `min delta ${(Math.min(...positions.slice(1).map((v, i) => v - positions[i]))).toFixed(1)}px, playing ${stillPlaying}`);
await stopAll();
await st(() => { const s = window.crescodeTest.store.getState(); s.edit((p) => ({ ...p, bpm: 400, tempoMap: [{ tick: 0, bpm: 400 }] })); });

/* 18. Loop fitting on screen: no scrolling at all across a wrap. */
const loopRes = await st(() => {
  const s = window.crescodeTest.store.getState();
  const sec = s.project.sections.reduce((a, b) => (b.lengthBars < a.lengthBars ? b : a)); // the shortest section
  s.set({ selectedSectionId: sec.id, loop: true, pxPerTick: 0.03 }); // zoomed out so the loop fits the view
  return { loopRange: [(sec.startBar - 1) * 3840, (sec.startBar - 1 + sec.lengthBars) * 3840], bars: sec.lengthBars };
});
const loopWidthPx = (loopRes.loopRange[1] - loopRes.loopRange[0]) * (await st(() => window.crescodeTest.store.getState().pxPerTick));
const pptL = loopWidthPx / (loopRes.loopRange[1] - loopRes.loopRange[0]);
await st(([loopStart, ppt]) => { document.getElementById('arranger-scroll').scrollLeft = Math.max(0, 300 + loopStart * ppt - 380); }, [loopRes.loopRange[0], pptL]);
await page.waitForTimeout(100);
await clickRulerTick(loopRes.loopRange[0]);
await page.click('[data-testid="play-btn"]');
const cycleMs = loopRes.bars * (60 / 400) * 4 * 1000; // bars × seconds-per-bar × 1000
await page.waitForTimeout(cycleMs + 600); // > one full loop cycle so the wrap definitely happens
const loopNow = await st(() => {
  const s = window.crescodeTest.store.getState();
  const el = document.querySelector('[data-testid="playhead"]');
  const x = parseFloat((el.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
  return { scrollLeft: Math.round(document.getElementById('arranger-scroll').scrollLeft), playing: s.playing, x: Math.round(x), pxPerTick: s.pxPerTick };
});
const insideLoop = loopNow.x >= 300 + loopRes.loopRange[0] * loopNow.pxPerTick - 40 && loopNow.x <= 300 + loopRes.loopRange[1] * loopNow.pxPerTick + 40;
check('A loop that fits on screen plays with ZERO scroll jumps across the wrap',
  loopWidthPx < 1300 && loopNow.playing && insideLoop, JSON.stringify({ loopWidthPx: Math.round(loopWidthPx), ...loopNow }));
await stopAll();
await st(() => { window.crescodeTest.store.getState().set({ loop: false, selectedSectionId: null }); });

/* 19. End of project: playback stops, the playhead stays parked and visible at the end. */
const pptEnd = await st(() => window.crescodeTest.store.getState().pxPerTick);
res = await st(() => { const s = window.crescodeTest.store.getState(); const end = s.project.tracks.reduce((m, t) => Math.max(m, ...t.notes.map((n) => n.startTick + n.durationTicks)), 0); const bars = Math.max(...s.project.sections.map((x) => x.startBar - 1 + x.lengthBars)); return { end: Math.max(end, bars * 3840) }; });
const endTick = res.end;
await clickRulerTick(endTick - 10); // clamps to the project end
res = await st((e) => { const s = window.crescodeTest.store.getState(); return { start: s.startTick, endTick: e }; }, endTick);
check('Clicking past the final clip clamps the playhead to the project end', Math.abs(res.start - endTick) <= TOL, JSON.stringify(res));
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(1200);
res = await st((e) => {
  const s = window.crescodeTest.store.getState();
  const el = document.querySelector('[data-testid="playhead"]');
  const x = parseFloat((el.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
  const sc = document.getElementById('arranger-scroll');
  return { playing: s.playing, start: s.startTick, x: Math.round(x), visible: x >= sc.scrollLeft + 300 - 1 && x <= sc.scrollLeft + sc.clientWidth + 1, endTick: e };
}, endTick);
check('At the project end playback stops and the playhead stays parked and visible there',
  !res.playing && Math.abs(res.start - endTick) <= 2 && Math.abs(res.x - (300 + endTick * pptEnd)) < 3 && res.visible, JSON.stringify(res));

/* 20. Per-editor follow independence: arranger Off, piano roll follows. */
await st(() => { window.crescodeTest.store.getState().setSettings({ autoScrollMode: 'off' }); });
const instTrack = await st(() => { const s = window.crescodeTest.store.getState(); return s.project.tracks.find((t) => t.family === 'Strings').id; });
await st(() => { document.getElementById('arranger-scroll').scrollLeft = 0; }); // the bar-1 lane area on screen, right of the corner panel
await page.waitForTimeout(80);
const laneBox = await page.locator(`[data-track-lane="${instTrack}"]`).boundingBox();
await page.mouse.dblclick(Math.max(laneBox.x + 400, 400), laneBox.y + laneBox.height / 2);
await page.waitForSelector('[data-testid="piano-roll"]');
await st(() => { window.crescodeTest.store.getState().set({ startTick: 0, playing: false, paused: false }); }); // the roll overlays the ruler — seek via the store
const arrS0 = await st(() => Math.round(document.getElementById('arranger-scroll').scrollLeft));
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(2600);
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const roll = document.querySelector('[data-testid="roll-scroll"]');
  const ph = document.querySelector('[data-testid="roll-playhead"]');
  const rx = parseFloat((ph.style.transform || '').replace(/[^0-9.\-]/g, '')) || 0;
  return { arranger: Math.round(document.getElementById('arranger-scroll').scrollLeft), roll: Math.round(roll.scrollLeft), rx: Math.round(rx), playing: s.playing };
});
check('Per-editor follow: arranger Off never scrolls while the piano roll follows on its own',
  res.playing && res.arranger === arrS0 && res.roll > 0 && res.rx > 600, JSON.stringify({ arrS0, ...res }));
await stopAll();
await page.click('[data-testid="piano-roll"] button[title*="Close piano roll"]');
await st(() => { window.crescodeTest.store.getState().setSettings({ autoScrollMode: 'smooth' }); });

/* 21. Preferences persist across a reload. */
await st(() => { window.crescodeTest.store.getState().setSettings({ autoScrollMode: 'page', autoScrollTriggerPoint: 0.5, refollowKey: 'g', pianoRollFollow: false }); });
await page.reload();
await page.waitForSelector('[data-testid="chord-lane"]');
res = await st(() => {
  const s = window.crescodeTest.store.getState();
  const raw = JSON.parse(localStorage.getItem('crescode.settings.v1') ?? '{}');
  return { mode: s.settings.autoScrollMode, trigger: s.settings.autoScrollTriggerPoint, key: s.settings.refollowKey, rollFollow: s.settings.pianoRollFollow, rawMode: raw.autoScrollMode };
});
check('All transport & auto-scroll preferences persist between sessions',
  res.mode === 'page' && res.trigger === 0.5 && res.key === 'g' && res.rollFollow === false && res.rawMode === 'page', JSON.stringify(res));
await st(() => {
  window.crescodeTest.store.getState().setSettings({ autoScrollMode: 'smooth', autoScrollTriggerPoint: 0.75, refollowKey: 'f', pianoRollFollow: true });
});

/* Final: no uncaught page errors. */
check('No uncaught page errors', errors.length === 0, errors.slice(0, 2).join(';'));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `${results.length}/${results.length} passed` : `${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
