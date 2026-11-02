/** Debug probe: replicate the smoke's exact sequence up to the picker. */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto(url);
await page.waitForSelector('[data-track-header]');
const st = (fn) => page.evaluate(fn);

await page.click('[data-testid=compose-all]');
const band = await st(() => {
  const s = window.crescodeTest.store.getState();
  const t = s.project.tracks.find((t) => t.family !== 'Structure' && t.family !== 'Audio' && !t.locked && t.notes.length > 0);
  return t ? { id: t.id, role: t.role, notes: t.notes.length } : null;
});
await page.evaluate((b) => { window.crescodeTest.bandProbeId = b.id; window.crescodeTest.bandRole = b.role; }, band);
await page.click(`[data-track-header="${band.id}"] [data-testid=band-btn]`);
await st(() => window.crescodeTest.store.getState().undo());

// toast state right before the picker click
const preToast = await page.evaluate(() => document.body.innerHTML.includes('toast'));
console.log('toast in DOM before picker click:', preToast);

await page.click('[data-testid=compose-options]');
await page.waitForTimeout(300);
const found = await st(() => ({
  rows: document.querySelectorAll('[data-testid^=band-option]').length,
  panel: !!document.querySelector('.panel-raised.absolute'),
}));
console.log('after caret click:', JSON.stringify(found));
console.log('errors:', errors.slice(0, 5));
await browser.close();
