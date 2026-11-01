/**
 * Visual check: changing the global MODE re-renders the chord track while the
 * Smart Chord popup is open — diatonic chords re-derive for the new mode
 * (C Ionian → C Aeolian: C→Cm, Dm→Ddim, G7→Gm7), notes follow each chord's
 * root, the popup stays truthful and suggestions re-rank in the new mode.
 *   node scripts/visual-mode-change.mjs
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
await st(() => {
  const s = window.crescodeTest.store.getState();
  s.edit((p) => ({
    ...p, key: 0, mode: 'Ionian',
    chords: [
      { id: 'k1', symbol: 'C', startTick: 1920, durationTicks: 1920 },
      { id: 'k2', symbol: 'Dm', startTick: 3840, durationTicks: 1920 },
      { id: 'k3', symbol: 'G7', startTick: 5760, durationTicks: 1920 },
    ],
    tracks: p.tracks.map((t) => (t.role === 'chords' ? { ...t, notes: [{ pitch: 48, startTick: 1920, durationTicks: 1920, velocity: 100 }] } : t)),
  }));
});
await page.waitForTimeout(150);

// Open the Smart Chord popup on the first chord.
const ppt = await st(() => window.crescodeTest.store.getState().pxPerTick);
const b = await page.locator('[data-testid="chord-lane"]').boundingBox();
await page.mouse.dblclick(b.x + 1920 * ppt + 3, b.y + b.height / 2);
await page.waitForTimeout(250);

await page.screenshot({ path: '/tmp/visual-mode-before.png', clip: { x: 0, y: 0, width: 1100, height: 420 } });

// Change the mode Ionian → Aeolian while the popup is open.
await page.selectOption('[data-testid="mode-select"]', 'Aeolian');
await page.waitForTimeout(400);

const after = await st(() => {
  const s = window.crescodeTest.store.getState();
  return {
    mode: s.project.mode,
    symbols: ['k1', 'k2', 'k3'].map((id) => s.project.chords.find((c) => c.id === id)?.symbol),
    lanePitch: s.project.tracks.find((t) => t.role === 'chords')?.notes[0]?.pitch,
    popupOpen: s.suggestionClipId !== null,
    popupField: document.querySelector('[data-testid="chord-editor-symbol"]')?.value ?? null,
  };
});
console.log('AFTER', JSON.stringify(after));
await page.screenshot({ path: '/tmp/visual-mode-after.png', clip: { x: 0, y: 0, width: 1100, height: 420 } });

await browser.close();
console.log('saved /tmp/visual-mode-before.png, /tmp/visual-mode-after.png');
