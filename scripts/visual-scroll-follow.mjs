/**
 * Visual check: popup floats ABOVE the track headers and stays attached to
 * its chord while the arranger is scrolled (user-reported clipping scenario).
 *   node scripts/visual-scroll-follow.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.goto(url);
await page.waitForSelector('[data-testid="chord-lane"]');

const st = (fn) => page.evaluate(fn);
await st(() => { const s = window.crescodeTest.store.getState(); s.edit((p) => ({ ...p, chords: [] })); });
const ppt = await st(() => window.crescodeTest.store.getState().pxPerTick);

const laneBox = async () => await page.locator('[data-testid="chord-lane"]').boundingBox();
const dblclickTick = async (tick) => {
  const b = await laneBox();
  await page.mouse.dblclick(b.x + tick * ppt + 3, b.y + b.height / 2);
  await page.waitForTimeout(250);
};

// One chord far enough right that the timeline overflows horizontally. Scroll
// it into view first, then open the picker on it.
await st(() => { document.getElementById('arranger-scroll').scrollLeft = 900; });
await page.waitForTimeout(150);
await dblclickTick(28800);
await page.waitForTimeout(200);

// Reproduce the report: scroll the chord far left (behind the header column)
// and up, so the popup would be clipped if the headers stacked above it.
const before = await st(() => {
  const sc = document.getElementById('arranger-scroll');
  return { sl: sc.scrollLeft, sw: sc.scrollWidth, cw: sc.clientWidth, chords: window.crescodeTest.store.getState().project.chords.map((c) => ({ id: c.id, st: c.startTick })) };
});
console.log('BEFORE-REPOS', JSON.stringify(before));
await st(() => {
  const sc = document.getElementById('arranger-scroll');
  const s = window.crescodeTest.store.getState();
  const clip = s.project.chords[0];
  const lane = document.querySelector('[data-testid="chord-lane"]');
  const lr = lane.getBoundingClientRect();
  // horizontal: put the chord's anchor at x = 60px (inside the header column)
  const anchorX = lr.left + clip.startTick * s.pxPerTick;
  sc.scrollLeft = Math.max(0, sc.scrollLeft + anchorX - 60);
  // vertical: put the chord lane ~110px from the top (just under the ruler)
  sc.scrollTop = Math.max(0, lr.top + sc.scrollTop - 110);
  return { setLeft: sc.scrollLeft, maxLeft: sc.scrollWidth - sc.clientWidth };
});
await page.waitForTimeout(250);

const geo = await st(() => {
  const ed = document.querySelector('[data-testid="chord-editor"]')?.getBoundingClientRect();
  const lane = document.querySelector('[data-testid="chord-lane"]').getBoundingClientRect();
  const header = document.querySelector('[data-track-header]')?.getBoundingClientRect();
  const s = window.crescodeTest.store.getState();
  const clip = s.project.chords[0];
  return {
    clipStart: clip.startTime,
    scrollLeft: document.getElementById('arranger-scroll').scrollLeft,
    scrollTop: document.getElementById('arranger-scroll').scrollTop,
    anchorX: lane.left + clip.startTick * s.pxPerTick,
    editor: ed ? { left: ed.left, top: ed.top, z: getComputedStyle(document.querySelector('[data-testid="chord-editor"]')).zIndex } : null,
    laneLeft: lane.left,
    headerZ: header ? getComputedStyle(document.querySelector('[data-track-header]')).zIndex : null,
    headerRight: header ? header.right : null,
  };
});
console.log('GEO', JSON.stringify(geo, null, 1));

await page.screenshot({ path: '/tmp/visual-scroll-follow.png', clip: { x: 0, y: 0, width: 900, height: 640 } });

// Second shot: mid-scroll smoothness — scroll again and capture immediately.
await st(() => { document.getElementById('arranger-scroll').scrollTop += 160; });
await page.waitForTimeout(120);
await page.screenshot({ path: '/tmp/visual-scroll-follow-2.png', clip: { x: 0, y: 0, width: 900, height: 640 } });

await browser.close();
console.log('saved /tmp/visual-scroll-follow.png, /tmp/visual-scroll-follow-2.png');
