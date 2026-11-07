/**
 * Phase 11.3 (read-only survey): the coverage list — for each of the six
 * templates, EVERY track in the composed project: id, name, family and the
 * writer (engine module / old generator only / both (module plus generator
 * phantom) / out-of-band-untouched), the track count per template and the
 * family groups. No source or golden changes; compose only.
 *   npx vite-node scripts/phase113-coverage.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { isInBand } from '../src/shared/schema/band';
import { BRASS_PARTS } from '../src/orchestrator/brass/profile';
import { WIND_PARTS } from '../src/orchestrator/winds/profile';
import { PERC_PARTS } from '../src/orchestrator/percussion/profile';
import { KEYS_PARTS } from '../src/orchestrator/keys/profile';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks } as Project, result };
};

const writerOf = (
  role: string,
  id: string,
  template: NonNullable<ReturnType<typeof resolveTemplate>>,
  ensemble: Project['ensemble'],
  stringsIds: Set<string>,
): { bucket: string; detail: string } => {
  if (role === 'basses') return { bucket: 'engine module', detail: 'basses desk (Phase 8.2) — engine-inserted; deliberately not in the roster so the governor caps never move' };
  if (!isInBand(role, ensemble, template)) return { bucket: 'out-of-band/untouched', detail: 'not in the roster; compose never touches it' };
  if (stringsIds.has(id)) return { bucket: 'engine module', detail: 'strings module' };
  if ((BRASS_PARTS as readonly string[]).includes(role)) {
    return { bucket: 'engine module', detail: 'brass module (the generator is excluded from writing brass since Phase 8)' };
  }
  if ((WIND_PARTS as readonly string[]).includes(role)) {
    return { bucket: 'both (module plus generator phantom)', detail: 'winds module owns the sound; the generator still writes the track as the phantom input to the window math, replaced at assembly' };
  }
  if ((PERC_PARTS as readonly string[]).includes(role)) {
    return { bucket: 'both (module plus generator phantom)', detail: 'percussion module owns the sound; generator phantom feeds the window math, replaced at assembly' };
  }
  if ((KEYS_PARTS as readonly string[]).includes(role)) {
    return { bucket: 'both (module plus generator phantom)', detail: 'keys module owns the sound; generator phantom feeds the window math, replaced at assembly' };
  }
  return { bucket: 'old generator only', detail: 'in band, no module roster' };
};

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const runs = (['three', 'dorian'] as const).map((tag) => {
    const doc = tag === 'three' ? threeChorus : dorian;
    const { project, result } = compose(doc, templateId, 1);
    return { tag, project, result };
  });
  const [a, b] = runs;
  const sameList = JSON.stringify(a.project.tracks.map((t) => [t.id, t.name, t.family, t.role]))
    === JSON.stringify(b.project.tracks.map((t) => [t.id, t.name, t.family, t.role]));
  console.log(`\n=== ${short} — ${a.project.tracks.length} tracks (three-chorus take 1; dorian list identical: ${sameList}) ===`);
  console.log(`${pad('id', 18)}${pad('name', 16)}${pad('family', 12)}${pad('writer', 36)}detail`);
  const groups: Record<string, number> = {};
  const writers: Record<string, number> = {};
  for (const t of a.project.tracks) {
    const { bucket, detail } = writerOf(t.role, t.id, template, a.project.ensemble, new Set(a.result.stringsTrackIds));
    const fam = t.family === 'Structure' || t.family === 'Audio' ? 'structure/chords/reference' : t.family;
    groups[fam] = (groups[fam] ?? 0) + 1;
    writers[bucket] = (writers[bucket] ?? 0) + 1;
    console.log(`${pad(t.id, 18)}${pad(t.name, 16)}${pad(fam, 12)}${pad(bucket, 36)}${detail}`);
  }
  const golden = JSON.parse(readFileSync(new URL(`../tests/golden103/${short}-three-t1.json`, import.meta.url), 'utf8'));
  const goldenIds = golden.tracks.map((t: { id: string }) => t.id).sort().join(',');
  const liveIds = a.project.tracks.map((t) => t.id).sort().join(',');
  console.log(`counts: total ${a.project.tracks.length} | ${Object.entries(groups).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`writers: ${Object.entries(writers).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
  console.log(`golden103 track-list match: ${goldenIds === liveIds ? 'yes' : `NO (${goldenIds})`}`);
}
