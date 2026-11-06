/**
 * Dev-server probe: reproduces the user's exact flow against `vite` (npm run
 * dev) — NOT the built bundle. The production build statically replaces
 * `process.env.*`, which is how the SUPDBG crash shipped invisible to the
 * unit suite (Node) and the e2e smokes (build); the dev server serves the
 * literal expression and the browser throws "process is not defined".
 *
 *   node scripts/dev-probe.mjs
 *
 * Spawns `vite --port 5199 --strictPort`, picks symphony/cinematic/chamber
 * through the band picker with the panel open (the reported flow), clicks
 * Compose All and reads the last toast.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = 5199;
const DEV_URL = `http://localhost:${PORT}/`;
const BANDS = process.argv[2] ? [process.argv[2]] : ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.chamber'];

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });
vite.stdout.on('data', () => {});
vite.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(DEV_URL); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error('vite dev server did not come up');
};

let failed = 0;
try {
  await waitForServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  await page.goto(DEV_URL);
  await page.waitForSelector('[data-track-header]');
  for (const band of BANDS) {
    await page.evaluate(() => document.querySelector('.fixed.inset-0')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await page.click('[data-testid=compose-options]');
    await page.click(`[data-testid="band-option-${band}"]`);
    await page.click('[data-testid=compose-all]');
    const res = await page.evaluate(() => {
      const s = window.crescodeTest.store.getState();
      return {
        toast: s.toasts.length ? s.toasts[s.toasts.length - 1].text : '',
        notes: s.project.tracks.reduce((a, t) => a + t.notes.length, 0),
      };
    });
    const ok = res.toast.startsWith('Composed in') && res.notes > 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${band}  — ${JSON.stringify(res)}`);
  }
  await browser.close();
} finally {
  vite.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
