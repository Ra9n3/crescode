/** Visual probe (Task 7 sweep): screenshot the band picker rows with project
 *  pins active in BOTH directions — Violas pinned out, Tuba pinned in — so
 *  the Chamber row shows "5 of 5 instruments · no Violas · + Tuba (project
 *  setting)" and the No band row shows "except your pins". Run after
 *  `npm run build` (serves dist/index.html). */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(url);
await page.waitForSelector('[data-track-header]');

// pins: one out, one in — both directions must show on the picker rows
await page.evaluate(() => {
  const s = window.crescodeTest.store.getState();
  s.setBandPin('violas', 'out');
  s.setBandPin('tuba', 'in');
});
await page.click('[data-testid=compose-options]');
await page.waitForTimeout(200);
const panel = page.locator('.panel-raised.absolute');
const text = await panel.textContent();
console.log('Chamber row:', text.match(/Chamber.{0,120}/)?.[0]);
console.log('No band row:', text.match(/No band.{0,120}/)?.[0]);
await panel.screenshot({ path: '/tmp/render/sweep-picker.png' });
await browser.close();
console.log('shots saved');
