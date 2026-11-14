/** Early listening gate. Run with the installed serializer, never a substitute:
 * node --no-warnings --experimental-loader ./scripts/strings-orchestration-native-loader.mjs scripts/winds-stage2-audition.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseMidi } from 'midi-file';
import { projectFromFixture } from '../src/shared/schema/index.ts';
import { isInstrumentTrack } from '../src/shared/schema/types.ts';
import { transformProjectMode } from '../src/engine/suggestion/transpose.ts';
import { composeAllTracks } from '../src/orchestrator/compose.ts';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi.ts';
import { EXPORT_PROFILES } from '../src/export/profiles/index.ts';
import { reconcileWindExport } from '../src/orchestrator/winds/production.ts';
import { WIND_PARTS } from '../src/orchestrator/winds/profile.ts';

const root = 'evaluation/woodwinds-v1-stage2/early-audition';
const specs = [
  { id: '01-lyrical-dorian', fixture: 'dorian-16bars', template: 'symphony', seed: 1, take: 1, purpose: 'Lyrical foreground, reed answers and four-player contrast' },
  { id: '02-dialogue-dorian', fixture: 'three-chorus-40bars', template: 'hybridstudio', seed: 1, take: 1, purpose: 'Longer repeated sections, flute/clarinet dialogue and continuation; oboe/bassoon out of template band' },
  { id: '03-low-support', fixture: 'multi-chorus-16bars', template: 'cinematic', seed: 3, take: 1, purpose: 'Independent bassoon tenor gestures and rhythmic support against orchestral bass' },
  { id: '04-lyrical-aeolian', fixture: 'dorian-16bars', template: 'symphony', mode: 'Aeolian', seed: 1, take: 1, purpose: 'Existing mode-to-chord transformation to Aeolian, borrowed harmony retained' },
  { id: '01-lyrical-dorian', fixture: 'dorian-16bars', template: 'symphony', seed: 7, take: 1, purpose: 'Alternative displayed seed; compare assignments, contour and rhythmic placement' },
  { id: '02-dialogue-dorian', fixture: 'three-chorus-40bars', template: 'hybridstudio', seed: 1, take: 2, purpose: 'Alternative produced take with unchanged displayed seed' },
];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const put = (path, bytes) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, bytes); };
const json = (path, x) => put(path, JSON.stringify(x, null, 2) + '\n');
const stats = () => ({ folded: {}, droppedHardRange: {}, droppedDoubling: {}, winds: [] });
const catalog = [];
for (const spec of specs) {
  let p = projectFromFixture(JSON.parse(readFileSync(`fixtures/${spec.fixture}.json`, 'utf8')));
  if (spec.mode) p = transformProjectMode(p, spec.mode).project;
  p.name = spec.id;
  p.ensemble = { templateId: `ensemble.${spec.template}`, overrides: {}, pins: {} };
  p.orchestration = { take: spec.take - 1 };
  const opts = { seed: spec.seed, stringsComposition: 'v1', windsComposition: 'v1' };
  const r = composeAllTracks(p, opts), baseline = composeAllTracks(p, { ...opts, windsComposition: 'classic' });
  const nonwinds = r.tracks.filter((t) => t.family !== 'Woodwinds');
  assert.deepEqual(nonwinds, baseline.tracks.filter((t) => t.family !== 'Woodwinds'), 'non-wind output/CC changed');
  assert.equal(r.windDiagnostics.route, 'v1-final');
  assert.equal(r.orchestration.take, spec.take);
  const produced = { ...p, tracks: r.tracks, orchestration: r.orchestration };
  const slug = `${spec.id}__seed-${spec.seed}__take-${spec.take}`;
  const dir = join(root, slug);
  json(join(dir, 'input-project.json'), p);
  json(join(dir, 'produced-project.json'), produced);
  const winds = r.tracks.filter((t) => r.windDiagnostics.ownership.ownedTrackIds.includes(t.id));
  const scopeEvidence = {};
  const mapping = r.tracks.filter(isInstrumentTrack).map((t) => ({ id: t.id, role: t.role, name: t.name, plainChannel: t.midiChannel, notes: t.notes.length,
    profileParts: EXPORT_PROFILES[0].profile.parts.filter((part) => part.source.role === t.role).map((part) => ({ patch: part.patch, channel: part.channel, fileScope: part.fileScope ?? 'merged-and-per-track' })) }));
  for (const [label, profile] of [['plain', null], ['uvi', EXPORT_PROFILES[0].profile]]) {
    const prefix = join(dir, label, `${slug}__${label}`), mergedStats = stats(), partStats = stats();
    const full = buildMergedMidi(produced, r.tracks.filter(isInstrumentTrack), profile, mergedStats);
    assert.equal(parseMidi(full).header.ticksPerBeat, 960);
    put(`${prefix}__full-orchestra.mid`, full);
    put(`${prefix}__winds-only.mid`, buildMergedMidi(produced, winds, profile));
    put(`${prefix}__nonwind-reference.mid`, buildMergedMidi(produced, nonwinds.filter(isInstrumentTrack), profile));
    for (const part of WIND_PARTS) {
      const track = r.tracks.find((t) => t.role === part);
      // Empty/out-of-band players intentionally get valid conductor-only or
      // empty-track MIDI, not substitute material or a legacy fallback.
      put(`${prefix}__${part}.mid`, buildMergedMidi(produced, track ? [track] : [], profile));
    }
    const files = buildPerTrackMidi(produced, r.tracks.filter(isInstrumentTrack), profile, partStats);
    for (const [i, f] of files.entries()) {
      parseMidi(f.data);
      put(join(dir, label, 'orchestral-parts', `${slug}__${label}__${String(i + 1).padStart(2, '0')}__${f.fileName}`), f.data);
    }
    const reconciled = reconcileWindExport(r.windDiagnostics, [...mergedStats.winds, ...partStats.winds]);
    for (const row of reconciled.filter((j) => r.windDiagnostics.ownership.ownedTrackIds.includes(j.trackId))) {
      assert.equal(row.state, 'observed');
      for (const job of row.jobs) for (const scope of job.scopes) assert.ok(['exported', 'not-retained'].includes(scope.state), JSON.stringify({ slug, label, job }));
    }
    for (const row of mergedStats.winds) {
      const parsed = parseMidi(full);
      const track = r.tracks.find((t) => t.id === row.trackId);
      const patch = profile?.parts.find((p) => p.source.role === track.role)?.patch ?? track.name;
      const midiTrack = parsed.tracks.find((tr) => tr.some((e) => e.type === 'trackName' && e.text === patch));
      const ons = midiTrack?.filter((e) => e.type === 'noteOn' && e.velocity > 0).length ?? 0;
      assert.equal(ons, row.serializedSoundingNotes + row.serializedKeyswitches);
      assert.equal(row.serializedSoundingNotes, track.notes.length);
    }
    scopeEvidence[label] = { merged: mergedStats, perTrack: partStats, reconciled, perTrackFiles: files.length };
  }
  const ensemble = r.windDiagnostics.plan.ensemble;
  let designed = 0, retainedDesigned = 0;
  for (const phrase of ensemble.phrases) {
    const t = winds.find((t) => t.role === phrase.part);
    designed += phrase.notes.length;
    retainedDesigned += phrase.notes.filter((n) => t.notes.some((m) => m.pitch === n.pitch && m.startTick === n.startTick && m.durationTicks === n.durationTicks)).length;
  }
  const bassoon = winds.find((t) => t.role === 'bassoons');
  const cello = r.tracks.find((t) => t.role === 'cellosBasses');
  const independentBassoon = bassoon?.notes.filter((n) => !cello?.notes.some((m) => m.startTick === n.startTick && m.durationTicks === n.durationTicks && (m.pitch - n.pitch) % 12 === 0)).length ?? 0;
  const item = { ...spec, slug, mode: p.mode, bars: Math.max(...p.sections.map((s) => s.startBar + s.lengthBars - 1)),
    stringsComposition: 'v1', windVersion: r.windDiagnostics.identity.version,
    nonWindExact: true, nonWindSha256: sha(JSON.stringify(nonwinds)), designedNotes: designed, retainedDesignedNotes: retainedDesigned,
    independentBassoonNotesNotExactCelloCopies: independentBassoon,
    windParts: r.windDiagnostics.parts.map((part) => ({ part: part.part, state: part.state, retainedNotes: part.retainedNotes, reason: part.reason })),
    phraseEntries: ensemble.phrases.map((ph) => ({ bar: ph.bar, part: ph.part, duty: ph.duty, relatedTo: ph.relatedTo, notes: ph.notes.length })), mapping };
  json(join(dir, 'evidence.json'), { ...item, diagnostics: r.windDiagnostics, exports: scopeEvidence });
  catalog.push(item);
  console.log(slug, `designed/retained ${designed}/${retainedDesigned}`, item.windParts.map((p) => `${p.part}:${p.retainedNotes}`).join(' '), `independent bassoon ${independentBassoon}`);
}
json(join(root, 'catalog.json'), catalog);
json(join(root, 'BUILD.json'), {
  path: 'actual production Compose All; installed midi-file; no alternate codec',
  sourceSha256: Object.fromEntries([
    'src/orchestrator/winds/ensemble.ts', 'src/orchestrator/winds/identity.ts',
    'src/orchestrator/winds/production.ts', 'src/orchestrator/winds/plan.ts',
    'src/orchestrator/winds/render.ts', 'src/orchestrator/compose.ts',
    'src/export/midi.ts', 'src/export/profile.ts', 'src/export/wind-audit.ts',
    'src/export/profiles/uvi-orchestral-suite.json', 'scripts/winds-stage2-audition.mjs',
    ...[...new Set(specs.map((s) => `fixtures/${s.fixture}.json`))],
  ].map((path) => [path, sha(readFileSync(path))])),
});
const readmePath = join(root, 'README.md');
if (existsSync(readmePath)) {
  const total = catalog.reduce((n, c) => n + c.designedNotes, 0);
  const bassoonCounts = catalog.filter((c) => c.independentBassoonNotesNotExactCelloCopies > 0).map((c) => c.independentBassoonNotesNotExactCelloCopies);
  put(readmePath, readFileSync(readmePath, 'utf8')
    .replace(/All \*\*\d+ designed phrase notes\*\*/, `All **${total} designed phrase notes**`)
    .replace(/Bassoon has \d+, \d+, \d+ and \d+ retained notes/, `Bassoon has ${bassoonCounts.slice(0, -1).join(', ')} and ${bassoonCounts.at(-1)} retained notes`));
}
json(join(root, 'uvi-profile-reference.json'), EXPORT_PROFILES[0].profile);
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const rows = walk(root).filter((p) => !p.endsWith('/SHA256SUMS')).sort().map((p) => `${sha(readFileSync(p))}  ${relative(root, p)}`);
put(join(root, 'SHA256SUMS'), rows.join('\n') + '\n');
console.log(`Wrote ${rows.length + 1} package files; ${walk(root).filter((p) => p.endsWith('.mid')).length} MIDI files. README is maintained alongside generated evidence.`);
