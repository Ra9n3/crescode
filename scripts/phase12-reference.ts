/**
 * Phase 12 reference capture (run at the PRE-CHANGE HEAD 4523385).
 * Captures, for all 120 golden105 corpus runs, the export digests the phase
 * must preserve:
 *   - plain  : the no-profile merged file + every per-track file (must stay
 *              byte-identical — the plain export path is not touched);
 *   - profile: the string/brass profile output — the per-track files of the
 *              nine string/brass patch parts (byte digests) and the merged
 *              file's string/brass track slice (semantic digest: name,
 *              channel, notes, cc per track named exactly a string/brass
 *              patch name). The profile GAINS parts in this phase, so only
 *              the string/brass slices are pinned.
 *   npx vite-node scripts/phase12-reference.ts
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { buildMergedMidi, buildPerTrackMidi, exportableTracks, parseMidiFile } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const shaText = (s: string): string => createHash('sha256').update(s).digest('hex');

const STRING_BRASS_PATCHES = [
  'Violins 1 Ensemble', 'Violins 2 Ensemble', 'Viola Ensemble', 'Cello Ensemble', 'Bass Ensemble',
  'French Horn Ensemble', 'Trombone Ensemble', 'Trumpet Ensemble', 'Tuba solo',
];

const three = JSON.parse(readFileSync(new URL('../fixtures/three-chorus-40bars.json', import.meta.url), 'utf8'));
const dorian = JSON.parse(readFileSync(new URL('../fixtures/dorian-16bars.json', import.meta.url), 'utf8'));
const profile = EXPORT_PROFILES[0].profile;

const compose = (doc: unknown, templateId: string, take: number): Project => {
  const p = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { ...p, tracks: result.tracks } as Project;
};

const runs: Record<string, unknown> = {};
for (const [templateId, doc] of [
  ['ensemble.chamber', three], ['ensemble.sonata', three], ['ensemble.vocalbacking', three],
  ['ensemble.symphony', three], ['ensemble.cinematic', three], ['ensemble.hybridstudio', three],
  ['ensemble.chamber', dorian], ['ensemble.sonata', dorian], ['ensemble.vocalbacking', dorian],
  ['ensemble.symphony', dorian], ['ensemble.cinematic', dorian], ['ensemble.hybridstudio', dorian],
] as const) {
  const short = templateId.replace('ensemble.', '');
  const fixTag = doc === three ? 'three' : 'dorian';
  for (let take = 1; take <= 10; take++) {
    const project = compose(doc, templateId, take);
    const tracks = exportableTracks(project, 'all');
    // plain export
    const plainMerged = sha(buildMergedMidi(project, tracks, null));
    const plainPer = buildPerTrackMidi(project, tracks, null);
    const plainPerDigest = shaText(plainPer.map((f) => f.fileName + '\u0000').join('') + plainPer.map((f) => Buffer.from(f.data).toString('base64')).join('\u0001'));
    // profile export (strings + brass at this HEAD)
    const profMerged = buildMergedMidi(project, tracks, profile);
    const parsed = parseMidiFile(profMerged);
    const slice = parsed.tracks.filter((t) => STRING_BRASS_PATCHES.includes(t.name))
      .map((t) => JSON.stringify({ name: t.name, channel: t.channel, notes: t.notes, cc: t.cc }));
    const profMergedSliceDigest = shaText(slice.join('\u0001'));
    const profPer = buildPerTrackMidi(project, tracks, profile).filter((f) => STRING_BRASS_PATCHES.some((p) => f.fileName.endsWith(` ${p}.mid`)));
    const profPerDigest = shaText(profPer.map((f) => f.fileName + '\u0000').join('') + profPer.map((f) => Buffer.from(f.data).toString('base64')).join('\u0001'));
    runs[`${short}-${fixTag}-t${take}`] = {
      plain: { merged: plainMerged, perTrack: plainPerDigest, files: plainPer.length },
      profile: { mergedSlice: profMergedSliceDigest, perTrack: profPerDigest, files: profPer.length },
    };
  }
  console.log(`${short} ${fixTag}: 10 takes captured`);
}

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'phase12-export-reference.json');
writeFileSync(out, JSON.stringify({ capturedAt: '4523385 (pre-change HEAD)', profileId: profile.id, runs }, null, 1));
console.log(`reference written: tests/phase12-export-reference.json (${Object.keys(runs).length} runs)`);
