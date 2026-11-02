/** Visual probe: screenshot the Settings → Band pins section and a pinned
 *  track-header chip. Run after `npm run build` (serves dist/index.html). */
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

// pin Violas out and Harp in, then open Settings
await page.evaluate(() => {
  const s = window.crescodeTest.store.getState();
  window.crescodeTest.violasId = s.project.tracks.find((x) => x.role === 'violas').id;
  s.setBandPin('violas', 'out');
  s.setBandPin('harp', 'in');
});
await page.click('[aria-label="Settings"]');
await page.locator('[data-testid=pin-row-violas]').scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
const modal = page.locator('.fixed.inset-0.z-50 > div');
await modal.screenshot({ path: '/tmp/render/pins-settings.png' });
// scroll the modal content so the KEYS group + hint line are in view
await page.evaluate(() => document.querySelector('[data-testid=pin-row-harp]')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(150);
await modal.screenshot({ path: '/tmp/render/pins-settings-bottom.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// the pinned header chip (Violas row) with its OUT state + pin marker
await page.locator('#arranger-scroll').scrollIntoViewIfNeeded().catch(() => {});
const col = page.locator('[data-track-header]').first();
const box = await col.boundingBox();
await page.screenshot({ path: '/tmp/render/pins-header.png', clip: { x: 0, y: Math.max(0, box.y - 40), width: 310, height: 560 } });
await browser.close();
console.log('shots saved');
