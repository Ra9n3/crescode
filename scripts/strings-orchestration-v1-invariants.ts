/** Extra native assertions; does not substitute for the Vitest runner. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { composeAllTracks } from '../src/orchestrator/compose';
import { buildMergedMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isStringTrack } from '../tests/strings-v1-support';
import { composeStringsV1Voice } from '../src/orchestrator/strings/composition';
import { planPhrases } from '../src/orchestrator/strings/phrases/plan';
import { planOrchestration } from '../src/orchestrator/strings/orchestration/plan';
import { makeProject, run, orchestration, realizationInput, assertIsolation, assertRealized, assertHistoricalHandoff, edgeProjects } from './strings-orchestration-checks';
const out = process.argv[2] ?? 'evaluation/strings-orchestration-v1/audition';
const matrix = JSON.parse(readFileSync(`${out}/matrix.json`, 'utf8')) as { tag: string; opening: { foreground: string | null } | null }[];
const load = (tag: string) => JSON.parse(readFileSync(`${out}/${tag}/evidence.json`, 'utf8'));
const seeds = Array.from({ length: 8 }, (_, i) => load(`symphony-dorian-seed${i + 1}-take0`));
const openings = new Set(seeds.map((e) => e.orchestration.plan.opening.foreground));
for (const role of ['violins1', 'violins2', 'violas', 'cellosBasses', null]) assert(openings.has(role));
assert(seeds.some((e) => new Set(e.orchestration.plan.contributions.filter((c: { duty: string }) => c.duty === 'foreground').map((c: { role: string }) => c.role)).size > 1));
const takes = [seeds[0], ...[1, 2, 3].map((t) => load(`symphony-dorian-seed1-take${t}`))];
assert.equal(new Set(takes.map((e) => JSON.stringify(e.theme))).size, 4);
assert.equal(new Set(takes.map((e) => JSON.stringify(e.tracks))).size, 4);
assert.equal(seeds[5].sourceSelection.chosen.role, 'violins2');
assert.equal(seeds[2].orchestration.plan.opening.foreground, 'violins2');
assert.notDeepEqual(load('generated-dorian').chords, load('generated-aeolian').chords);
assertHistoricalHandoff(makeProject(6), 6);
const archivedByteEquality: number[] = [];
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 11]) {
  const p = makeProject(seed), r = composeAllTracks(p, { seed, stringsComposition: 'v1', stringsDevelopment: 'identity-v2' });
  const data = buildMergedMidi({ ...p, tracks: r.tracks }, r.tracks.filter(isStringTrack), EXPORT_PROFILES.find((p) => p.id === 'uvi-orchestral-suite')!.profile);
  assert.deepEqual(Buffer.from(data), readFileSync(`evaluation/strings-identity-v2/audition/symphony-dorian-16bars-seed${seed}-take0/02_strings__uvi.mid`), 'direct archived full byte equality, not just a truncated hash');
  archivedByteEquality.push(seed);
}
const p = makeProject(), r = run(p, 1), source = r.stringsDiagnostics.v1!.composition!;
assert.deepEqual(composeAllTracks(p, { seed: 1 }).tracks, composeAllTracks(p, { seed: 1, stringsComposition: 'classic' }).tracks, 'UI/default remains classic');
assert.deepEqual(composeAllTracks(p, { seed: 1, stringsComposition: 'v1', stringsDevelopment: 'ensemble-v1' }).tracks, r.tracks);
const input = realizationInput(p, r), frame = { ...source.frame!, harmony: input.understanding.harmony };
const quietPlan = planOrchestration({ ...input, arc: input.arc.map((a) => ({ ...a, target: a.target * 0.1 })) }, frame, source.theme!, source.phrases);
assert.notDeepEqual(quietPlan.contributions, source.orchestrationPlan!.contributions, 'frozen theme responds to energy context, not a seed menu');
const allSilent = composeStringsV1Voice({ ...input, arc: input.arc.map((a) => ({ ...a, nearSilence: true })) });
assert.equal(allSilent.written, false); assert.equal(allSilent.windows.length, 0);
const clipped = planPhrases({ frame, theme: source.theme!, identity: source.identity!, structure: input.understanding.structure, windows: [{ startTick: 480, endTick: 3600 }, { startTick: 9000, endTick: 14000 }] });
assert.equal(clipped.phrases.length + clipped.silentWindows.length, 2);
for (const ph of clipped.phrases) for (const n of ph.notes) assert(n.tick >= ph.window.startTick && n.tick + n.duration <= ph.window.endTick && n.duration >= frame.beatTicks / 2);
const lowerOnly = makeProject(); lowerOnly.tracks = lowerOnly.tracks.map((t) => ({ ...t, locked: t.role === 'violins1' || t.role === 'violins2' }));
const low = run(lowerOnly, 1); assertIsolation(lowerOnly, low, 1); assertRealized(lowerOnly, low); assert(orchestration(low).accepted);
assert.equal(low.stringsDiagnostics.v1!.composition!.written, false, 'source preview unavailability must remain honest even when lower ensemble succeeds');
for (const { tag, p, seed } of edgeProjects()) {
  const r = run(p, seed), o = orchestration(r);
  assert.equal(o.accepted, !(tag.startsWith('fallback-') || tag === 'meter-6-8'), tag);
  if (tag === 'locked-violin1') assert.deepEqual(r.tracks.find((t) => t.role === 'violins1'), p.tracks.find((t) => t.role === 'violins1'));
}
const report = { matrixCases: matrix.length, openingPoliciesRealized: [...openings], fixedSeedTakeMaterialAndTrackUniqueness: 4, sourceAndRealizedViolinII: true, actualGeneratedModeChordsDiffer: true,
  explicitOldV2AndLegacySeed6: true, archivedStringMidiFullByteEqualitySeeds: archivedByteEquality, implicitDefaultClassic: true, explicitEnsembleEqualsV1Default: true, frozenMaterialContextResponse: true,
  allSilentWindows: { reason: allSilent.reason, windows: allSilent.windows.length }, clippedPickupWindows: { phrases: clipped.phrases.length, rejected: clipped.silentWindows.length },
  lowerOnlyEnsembleWithUnavailablePreview: { accepted: orchestration(low).accepted, sourcePreviewWritten: low.stringsDiagnostics.v1!.composition!.written, desks: orchestration(low).desks },
  expectedEdgeFallbackPolicy: true, humanListeningConfirmed: false };
writeFileSync(`${out}/native-invariants.json`, JSON.stringify(report, null, 2) + '\n');
console.log('PASS extra native invariants: opening/role diversity, fixed-seed takes, prior V2/legacy seed6, classic default, frozen-material context, silent/pickup windows, lower-only ensemble, expected edge fallback policy');
