/** New, non-overwriting package. With installed dependencies use vite-node.
 * Dependency-free audit: CRESCODE_AUDIT_CODEC=1 node --no-warnings --loader
 * ./scripts/strings-orchestration-native-loader.mjs scripts/strings-orchestration-v1-audition.ts NEW_DIR
 * This opt-in runs the REAL production compose and export/profile functions,
 * with an audit-only SMF encoder replacing the unavailable midi-file codec.
 * No dependency installation; no claim to have run Vitest/typecheck/build. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { composeAllTracks } from '../src/orchestrator/compose';
import { buildMergedMidi } from '../src/export/midi';
import { chunksForTrack } from '../src/export/profile';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { projectEndTick } from '../src/shared/schema/meter';
import { type Project, type Track } from '../src/shared/schema';
import { fingerprintCells, composeStringCell, fingerprintResult, loadFingerprintDocument, stringCellId, isStringTrack } from '../tests/strings-v1-support';
import { makeProject, run, orchestration, assertIsolation, assertRealized, assertPlanAndRejection, assertHistoricalMaterial, assertHistoricalHandoff, edgeProjects } from './strings-orchestration-checks';

const out = path.resolve(process.argv[2] ?? 'evaluation/strings-orchestration-v1/audition');
assert(!existsSync(out), `Refusing to overwrite ${out}`); mkdirSync(out, { recursive: true });
const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const profile = EXPORT_PROFILES.find((p) => p.id === 'uvi-orchestral-suite')!.profile;
const json = (file: string, value: unknown) => { const dest = path.join(out, file); mkdirSync(path.dirname(dest), { recursive: true }); writeFileSync(dest, JSON.stringify(value, null, 2) + '\n'); };
const golden = loadFingerprintDocument();
let goldenTracks = 0;
for (const c of fingerprintCells()) {
  const { project, result } = composeStringCell(c, 'classic');
  const fingerprint = fingerprintResult(project, result);
  assert.deepEqual(fingerprint, golden.cells[stringCellId(c)], `classic fingerprint ${stringCellId(c)}: includes exported byte hash`);
  goldenTracks += Object.keys(fingerprint.strings).length;
}
console.log(`PASS 60 classic golden cells, ${goldenTracks} string exports (notes/CC/export bytes/conductor/nonstrings)`);
const files: { file: string; bytes: number; sha256: string; chunks: { role: string; name: string; notes: number; noteHash: string; channel: number }[] }[] = [];
const saveMidi = (file: string, p: Project, tracks: Track[]) => {
  const data = buildMergedMidi(p, tracks, profile);
  const end = projectEndTick(p);
  const chunks = tracks.flatMap((t) => chunksForTrack(p, t, profile)).filter((c) => !c.fileOnly);
  const expected = chunks.map((c) => ({ role: tracks.find((t) => t.id === c.trackId)!.role, name: c.name, channel: Math.max(1, Math.min(16, c.channel)),
    notes: c.notes.filter((n) => Math.round(n.startTick + n.durationTicks) > Math.max(0, Math.round(n.startTick)) && Math.round(n.startTick) < end).length,
    noteHash: sha(c.notes.map((n) => [Math.max(0, Math.round(n.startTick)), Math.min(end, Math.round(n.startTick + n.durationTicks)), n.pitch, Math.max(1, Math.min(127, Math.round(n.velocity))), Math.max(1, Math.min(16, c.channel))])
      .filter(([s, e]) => e > s).map((n) => n.join(':')).sort().join(';')) }));
  const dest = path.join(out, file); mkdirSync(path.dirname(dest), { recursive: true }); writeFileSync(dest, data);
  files.push({ file, bytes: data.length, sha256: sha(data), chunks: expected });
};
const excerpt = (p: Project, tracks: Track[], from: number, to: number): Project => {
  const bars = Math.ceil((to - from) / (p.timeSignature.numerator * 960 * 4 / p.timeSignature.denominator));
  return { ...p, name: `${p.name} excerpt ${from / 960}-${to / 960} quarter beats`,
    sections: [{ id: 'excerpt', name: 'Excerpt', startBar: 1, lengthBars: bars }],
    chords: p.chords.filter((c) => c.startTick < to && c.startTick + c.durationTicks > from).map((c) => ({ ...c, startTick: Math.max(from, c.startTick) - from, durationTicks: Math.min(to, c.startTick + c.durationTicks) - Math.max(from, c.startTick) })),
    tracks: tracks.map((t) => ({ ...t, notes: t.notes.filter((n) => n.startTick < to && n.startTick + n.durationTicks > from).map((n) => ({ ...n, startTick: Math.max(from, n.startTick) - from, durationTicks: Math.min(to, n.startTick + n.durationTicks) - Math.max(from, n.startTick) })),
      cc: (t.cc ?? []).map((l) => ({ ...l, points: [{ tick: 0, value: [...l.points].reverse().find((pt) => pt.tick <= from)?.value ?? l.points[0]?.value ?? 0 }, ...l.points.filter((pt) => pt.tick > from && pt.tick < to).map((pt) => ({ ...pt, tick: pt.tick - from }))] })) })) };
};
const cases = [
  ...Array.from({ length: 8 }, (_, i) => ({ tag: `symphony-dorian-seed${i + 1}-take0`, p: makeProject(i + 1), seed: i + 1 })),
  { tag: 'symphony-dorian-seed11-take0', p: makeProject(11), seed: 11 },
  ...[1, 2, 3].map((take) => ({ tag: `symphony-dorian-seed1-take${take}`, p: makeProject(1, take), seed: 1 })),
  ...(['chamber', 'cinematic', 'hybridstudio'] as const).map((template) => ({ tag: `${template}-dorian-seed1`, p: makeProject(1, 0, template), seed: 1 })),
  { tag: 'long-40bars', p: makeProject(1, 0, 'symphony', 'three-chorus-40bars'), seed: 1 },
  ...edgeProjects(),
];
const summary: unknown[] = [];
for (const { tag, p, seed } of cases) {
  const before = JSON.stringify(p), r = run(p, seed), o = orchestration(r), source = r.stringsDiagnostics.v1!.composition!;
  assertIsolation(p, r, seed);
  if (o.plan) assertRealized(p, r);
  const repeat = run(p, seed); assert.deepEqual(repeat, r); assert.deepEqual(repeat.stringsDiagnostics, r.stringsDiagnostics);
  assert.equal(JSON.stringify(p), before, 'production input immutability');
  if (/^symphony-dorian-seed\d+-take0$/.test(tag)) assertHistoricalMaterial(r, seed);
  if (tag === 'symphony-dorian-seed1-take0') { assertPlanAndRejection(p, r); assertHistoricalHandoff(p, seed); }
  const actual: Project = { ...p, tracks: r.tracks, orchestration: r.orchestration };
  const strings = r.tracks.filter(isStringTrack);
  saveMidi(`${tag}/01_full__uvi.mid`, actual, r.tracks.filter((t) => t.notes.length > 0));
  saveMidi(`${tag}/02_strings__uvi.mid`, actual, strings);
  for (const t of strings) saveMidi(`${tag}/desk_${t.role}__uvi.mid`, actual, [t]);
  const end = projectEndTick(p);
  const opening = excerpt(actual, strings, 0, Math.min(end, 8 * 960)); saveMidi(`${tag}/03_opening__uvi.mid`, opening, opening.tracks);
  if (end > 40 * 960) { const transition = excerpt(actual, strings, 24 * 960, 40 * 960); saveMidi(`${tag}/04_transition__uvi.mid`, transition, transition.tracks); }
  saveMidi(`${tag}/05_lower_interaction__uvi.mid`, actual, strings.filter((t) => ['violas', 'cellosBasses', 'basses'].includes(t.role)));
  const evidence = { tag, seed, storedTake: p.orchestration?.take ?? 0, producedTake: r.orchestration.take, mode: p.mode, key: p.key, meter: p.timeSignature, endTick: end,
    codec: process.env.CRESCODE_AUDIT_CODEC === '1' ? 'audit-only SMF encoder; actual compose/export/profile functions; classic golden byte equality checked' : 'installed midi-file',
    sections: p.sections, chords: p.chords, sourceSelection: source.selection, theme: source.theme, phrases: source.phrases, orchestration: o, tracks: strings,
    checks: { repeat: true, immutableInput: true, nonstringsEqualClassic: true, pianoInputScoreEventsDiagnosticsEqualClassic: true, conductorAndConsumedStringsEqualClassic: true, rosterEqualClassic: true } };
  json(`${tag}/evidence.json`, evidence);
  summary.push({ tag, seed, storedTake: p.orchestration?.take ?? 0, producedTake: r.orchestration.take, accepted: o.accepted, reason: o.reason, opening: o.plan?.opening ?? null, desks: o.desks,
    rejectedContributions: o.contributions.filter((c) => c.status === 'rejected').length, withheld: o.plan?.withheld ?? [], chordSymbols: p.chords.map((c) => c.symbol) });
  console.log(tag, o.accepted ? 'ACCEPTED' : 'CLASSIC FALLBACK', o.plan?.opening.foreground ?? 'no thematic opening', o.desks.map((d) => `${d.role}:${d.state}/${d.notes}`).join(', '));
}
json('matrix.json', summary); json('midi-manifest.json', files);
json('verification.json', { classicGoldenCells: 60, classicGoldenTrackExports: goldenTracks, productionCases: cases.length, repeats: cases.length, isolation: cases.length,
  immutableInputs: cases.length, priorV2MaterialComparisons: 9, adversarialRegisterAndSupportingRejection: true, priorV2AndLegacyHandoff: true, midiFiles: files.length,
  codec: process.env.CRESCODE_AUDIT_CODEC === '1' ? 'audit-only encoder; NOT installed midi-file' : 'installed midi-file',
  standardVitestTypecheckBuild: 'must be reported separately; not implied by this harness' });
writeFileSync(path.join(out, 'SHA256SUMS'), files.map((f) => `${f.sha256}  ${f.file}`).join('\n') + '\n');
console.log(`PASS ${cases.length} production cases + exact repeats + adjacent protection; ${files.length} MIDI files. Run independent Python measurements next.`);
