/**
 * Phase 8 brass baseline (run at the PRE-BRASS HEAD, moments ON — the user's
 * baseline definition: "the current HEAD after the Phase 7 fixes, composed
 * with moments on"). Captures, for takes 1–10 on three-chorus AND dorian:
 *  - chamber / sonata / vocalbacking (no brass roster): the FULL composed
 *    tracks as stable JSON — the byte-identical golden the brass phase is
 *    pinned against;
 *  - symphony / cinematic / hybridstudio (brass rosters): per-track SHA-256
 *    of every NON-brass track's (notes, cc) — the "texture draws unchanged"
 *    pin; brass tracks change by design and are hashed separately so the
 *    diff report can name what moved.
 *   npx vite-node scripts/make-golden-moments.ts
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project, type Track } from '../src/shared/schema';
import { readFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'tests', 'golden-moments');
mkdirSync(outDir, { recursive: true });

const three = JSON.parse(readFileSync(new URL('../fixtures/three-chorus-40bars.json', import.meta.url), 'utf8'));
const dorian = JSON.parse(readFileSync(new URL('../fixtures/dorian-16bars.json', import.meta.url), 'utf8'));

const compose = (doc: unknown, templateId: string, take: number): { tracks: Track[]; moments: { kind: string; startBar: number; endBar: number }[]; leads: { startBar: number; endBar: number }[] } => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return {
    tracks: result.tracks,
    moments: result.plan.moments.map((m) => ({ kind: m.kind, startBar: m.startBar, endBar: m.endBar })),
    leads: result.plan.brass.leads.map((l) => ({ startBar: l.startBar, endBar: l.endBar })),
  };
};

const BRASS = new Set(['horns', 'trumpets', 'trombones', 'tuba']);

let bytes = 0;
for (const [templateId, doc] of [
  ['ensemble.chamber', three], ['ensemble.sonata', three], ['ensemble.vocalbacking', three],
  ['ensemble.chamber', dorian], ['ensemble.sonata', dorian], ['ensemble.vocalbacking', dorian],
  ['ensemble.symphony', three], ['ensemble.cinematic', three], ['ensemble.hybridstudio', three],
  ['ensemble.symphony', dorian], ['ensemble.cinematic', dorian], ['ensemble.hybridstudio', dorian],
] as const) {
  const short = templateId.replace('ensemble.', '');
  const fixTag = doc === three ? 'three' : 'dorian';
  for (let take = 1; take <= 10; take++) {
    const { tracks, moments, leads } = compose(doc, templateId, take);
    const payload = JSON.stringify({
      templateId, fixture: fixTag, take, moments, leads,
      tracks: tracks.map((t) => ({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) })),
    });
    bytes += payload.length;
    writeFileSync(path.join(outDir, `${short}-${fixTag}-t${take}.json`), payload);
  }
  console.log(`${short}: 10 takes × full bytes captured`);
}

console.log(`baseline captured, full-byte payload ≈ ${(bytes / 1e6).toFixed(1)} MB`);
