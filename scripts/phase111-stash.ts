/**
 * Phase 11.1 control stash (read-only): captures the composed bytes at the
 * CURRENT checkout — run it on a stashed (pre-change) tree at 63a82f8 to
 * produce the 11.1 baseline. Same payload as the golden captures (every
 * track, percussion included + the moments list), 6 templates ×
 * {three-chorus, dorian} × takes 1-10, moments on.
 *   git stash -q && npx vite-node scripts/phase111-stash.ts && git stash pop -q
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project, type Track } from '../src/shared/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.STASH_DIR ?? path.resolve(here, '..', '..', 'scratch', 'stash-63a82f8');
mkdirSync(outDir, { recursive: true });

const three = JSON.parse(readFileSync(new URL('../fixtures/three-chorus-40bars.json', import.meta.url), 'utf8'));
const dorian = JSON.parse(readFileSync(new URL('../fixtures/dorian-16bars.json', import.meta.url), 'utf8'));

const compose = (doc: unknown, templateId: string, take: number): { tracks: Track[]; moments: { kind: string; startBar: number; endBar: number }[] } => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return {
    tracks: result.tracks,
    moments: result.plan.moments.map((m) => ({ kind: m.kind, startBar: m.startBar, endBar: m.endBar })),
  };
};

let bytes = 0;
for (const [templateId, doc] of [
  ['ensemble.chamber', three], ['ensemble.sonata', three], ['ensemble.vocalbacking', three],
  ['ensemble.symphony', three], ['ensemble.cinematic', three], ['ensemble.hybridstudio', three],
  ['ensemble.chamber', dorian], ['ensemble.sonata', dorian], ['ensemble.vocalbacking', dorian],
  ['ensemble.symphony', dorian], ['ensemble.cinematic', dorian], ['ensemble.hybridstudio', dorian],
] as const) {
  const short = templateId.replace('ensemble.', '');
  const fixTag = doc === three ? 'three' : 'dorian';
  for (let take = 1; take <= 10; take++) {
    const { tracks, moments } = compose(doc, templateId, take);
    const payload = JSON.stringify({
      templateId, fixture: fixTag, take, moments,
      tracks: tracks.map((t) => ({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) })),
    });
    bytes += payload.length;
    writeFileSync(path.join(outDir, `${short}-${fixTag}-t${take}.json`), payload);
  }
  console.log(`${short} ${fixTag}: 10 takes captured`);
}

console.log(`control stash at ${outDir} — full-byte payload ≈ ${(bytes / 1e6).toFixed(1)} MB`);
