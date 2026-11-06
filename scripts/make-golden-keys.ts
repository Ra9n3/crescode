/**
 * Phase 11 keys baseline (run at the POST-10.2 HEAD — 894eefb, moments ON,
 * the user's baseline definition). Captures, for takes 1–10 on three-chorus
 * AND dorian, the FULL composed tracks as stable JSON for all six templates —
 * every track, percussion included (the user's baseline requirement):
 *  - every non-keys track in all six templates is the byte-identical pin
 *    (Phase 11 changes ONLY the harp and piano tracks);
 *  - the keys tracks themselves are the "before" side of the chorus-mean
 *    and below-floor comparisons.
 *   npx vite-node scripts/make-golden-keys.ts
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project, type Track } from '../src/shared/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'tests', 'golden102');
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
  console.log(`${short} ${fixTag}: 10 takes × full bytes captured`);
}

console.log(`post-10.2 baseline captured at HEAD, full-byte payload ≈ ${(bytes / 1e6).toFixed(1)} MB`);
