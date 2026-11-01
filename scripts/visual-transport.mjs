/** Visual check: playhead follow, suspension badge, controls, settings (screenshots to /tmp). */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(url);
await page.waitForSelector('[data-testid="chord-lane"]');
const st = (fn, arg) => page.evaluate(fn, arg);

await st(() => { const s = window.crescodeTest.store.getState(); s.edit((p) => ({ ...p, bpm: 400, tempoMap: [{ tick: 0, bpm: 400 }] })); s.set({ pxPerTick: 0.06, startTick: 7680 }); });
await page.screenshot({ path: '/tmp/transport-1-idle.png' });

// Smooth follow in action
await page.click('[data-testid="play-btn"]');
await page.waitForTimeout(2300);
await page.screenshot({ path: '/tmp/transport-2-follow.png' });

// Manual scroll → suspension badge
await st(() => { document.getElementById('arranger-scroll').scrollLeft -= 900; });
await page.waitForTimeout(250);
await page.screenshot({ path: '/tmp/transport-3-suspended.png' });

// Status bar follow controls
await page.locator('[data-testid="autoscroll-mode"]').selectOption('stationary').catch(() => {});
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/transport-4-statusbar.png', clip: { x: 0, y: 880, width: 1600, height: 70 } });
await page.locator('[data-testid="autoscroll-mode"]').selectOption('smooth').catch(() => {});
await st(() => { const s = window.crescodeTest.store.getState(); if (s.followSuspended) { s.set({ followSuspended: false, followSuspensionReason: null }); } s.set({ playing: false, paused: false }); });

// Settings dialog: transport section
await page.locator('button[title="Settings"]').click();
await page.waitForTimeout(300);
const modal = page.locator('.fixed.inset-0.z-50 > div, [role="dialog"]').first();
await page.evaluate(() => { const m = document.querySelector('.fixed.inset-0.z-50'); const inner = m && m.querySelector('div'); if (inner) inner.scrollTop = inner.scrollHeight; });
await page.waitForTimeout(200);
await page.screenshot({ path: '/tmp/transport-5-settings.png' });

await browser.close();
console.log('screenshots written');
