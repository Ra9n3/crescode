/** Byte comparisons with the audited HEAD using the installed midi-file.
 * No worktree/reset/temp source copies and no generated MIDI files. */
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const program = `
import { createHash } from 'node:crypto';
import { projectFromFixture } from './src/shared/schema/index.ts';
import { composeAllTracks } from './src/orchestrator/compose.ts';
import { buildMergedMidi, buildPerTrackMidi } from './src/export/midi.ts';
import { EXPORT_PROFILES } from './src/export/profiles/index.ts';
import { readFileSync } from 'node:fs';
const digest = (x) => createHash('sha256').update(x).digest('hex');
const cases = [];
for (const template of ['symphony','cinematic','hybridstudio','chamber','sonata','vocalbacking']) {
 for (const stringsComposition of ['classic','v1']) {
  const p = projectFromFixture(JSON.parse(readFileSync('fixtures/dorian-16bars.json','utf8')));
  p.ensemble = { templateId: 'ensemble.' + template, overrides: {}, pins: {} }; p.orchestration = { take: 0 };
  const r = composeAllTracks(p, { seed: 3, stringsComposition });
  const out = { ...p, tracks: r.tracks, orchestration: r.orchestration };
  const exports = [];
  for (const profile of [null, EXPORT_PROFILES[0].profile]) {
   exports.push(digest(buildMergedMidi(out, r.tracks, profile)));
   exports.push(digest(JSON.stringify(buildPerTrackMidi(out,r.tracks,profile).map(f=>[f.fileName,digest(f.data)]))));
  }
  cases.push({ template, stringsComposition, result: digest(JSON.stringify(r)), tracks: digest(JSON.stringify(r.tracks)), exports });
 }
}
console.log(JSON.stringify(cases));
`;
function run(baseline) {
  return JSON.parse(execFileSync(process.execPath, ['--no-warnings', '--experimental-loader', './scripts/winds-stage1-baseline-loader.mjs', '--input-type=module', '-e', program], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CRESCODE_WIND_BASELINE: baseline ? '1' : '0', CRESCODE_AUDIT_CODEC: '0' },
  }));
}
const baseline = run(true), current = run(false);
assert.deepEqual(current, baseline, 'Classic/default output diverged from the audited HEAD');
console.log(JSON.stringify({ baseline: '96c7756c6484f85d3937d20a070818fa568d4d80', codec: 'installed midi-file', cases: current.length,
  assertions: 'complete enumerable Compose All results, all tracks/CC, merged MIDI and per-track MIDI (plain + UVI) byte-identical', results: current }, null, 2));
