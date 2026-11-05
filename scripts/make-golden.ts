/**
 * Phase 5.5: captures the byte-exact no-profile export of a composed project
 * with the CURRENT writer, as the golden pin for "no profile selected =
 * byte-identical to today's export". Run once per deliberate writer change.
 *   npx vite-node scripts/make-golden.ts
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { projectFromFixture, type Project } from '../src/shared/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'tests', 'golden');

const compose = (fixtureFile: string, templateId: string, take: number): Project => {
  const project: Project = projectFromFixture(JSON.parse(readFileSync(fixtureFile, 'utf8')));
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11, moments: false });
  return { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project;
};

const dorian = path.join(here, '..', 'fixtures', 'dorian-16bars.json');
const three = path.join(here, '..', 'fixtures', 'three-chorus-40bars.json');

mkdirSync(outDir, { recursive: true });
for (const [tag, fixture, template] of [
  ['dorian-cinematic', dorian, 'ensemble.cinematic'],
  ['three-symphony', three, 'ensemble.symphony'],
] as const) {
  const p = compose(fixture, template, 1);
  writeFileSync(path.join(outDir, `${tag}-merged.mid`), buildMergedMidi(p, p.tracks.filter((t) => t.family !== 'Structure' && t.family !== 'Audio')));
  for (const f of buildPerTrackMidi(p, p.tracks.filter((t) => t.family !== 'Structure' && t.family !== 'Audio'))) {
    writeFileSync(path.join(outDir, `${tag}-per-${f.fileName}`), f.data);
  }
  console.log(`${tag}: merged + per-track written`);
}
console.log('golden bytes captured');
