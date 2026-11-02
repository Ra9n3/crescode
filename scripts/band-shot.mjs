/** Visual probe: screenshot the track-header column with the band IN/OUT chips. */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(url);
await page.waitForSelector('[data-track-header]');
await page.click('[data-testid=compose-all]');
await page.waitForTimeout(300);
// flip the 4th band track OUT so both states are visible
const probe = await page.evaluate(() => {
  const s = window.crescodeTest.store.getState();
  const t = s.project.tracks.filter((t) => t.family !== 'Structure' && t.family !== 'Audio')[3];
  return t.id;
});
await page.click(`[data-track-header="${probe}"] [data-testid=band-btn]`);
await page.waitForTimeout(200);
await page.locator('#arranger-scroll').scrollIntoViewIfNeeded().catch(() => {});
const col = page.locator('[data-track-header]').first();
const box = await col.boundingBox();
await page.screenshot({ path: '/tmp/render/band-header.png', clip: { x: 0, y: Math.max(0, box.y - 40), width: 310, height: 560 } });
await browser.close();
console.log('shot saved');
