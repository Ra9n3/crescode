/** New, non-overwriting Studio One package using the Stage 6 UVI export path.
 * Run: npx vite-node scripts/strings-identity-v2-audition.ts [NEW_OUTPUT_DIR]
 * No Drive writes, no audio rendering, no historical package writes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseMidi } from 'midi-file';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { buildMergedMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type Project, type Track } from '../src/shared/schema';
import { writeVoice } from '../src/orchestrator/strings/writers/voice';
import { projectForStringCell, isStringTrack, type StringCell } from '../tests/strings-v1-support';

const out = path.resolve(process.argv[2] ?? 'evaluation/strings-identity-v2/audition');
assert(!existsSync(out), `Refusing to overwrite ${out}; choose a NEW directory`);
mkdirSync(out, { recursive: true });
const profile = EXPORT_PROFILES.find((p) => p.id === 'uvi-orchestral-suite')!.profile;
const digest = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const files: { file: string; bytes: number; sha256: string; instrumentTracks: number; noteOns: number }[] = [];
const cases: { cell: StringCell; project: Project; result: ComposeResult }[] = [];
const cells: StringCell[] = [
  ...Array.from({ length: 8 }, (_, i) => ({ template: 'symphony' as const, fixture: 'dorian-16bars' as const, seed: i + 1, take: 0 })),
  { template: 'symphony', fixture: 'dorian-16bars', seed: 11, take: 0 },
  ...[1, 2, 3].map((take) => ({ template: 'symphony' as const, fixture: 'dorian-16bars' as const, seed: 1, take })),
  ...(['chamber', 'cinematic', 'hybridstudio'] as const).map((template) => ({ template, fixture: 'dorian-16bars' as const, seed: 1, take: 0 })),
  ...(['multi-chorus-16bars', 'three-chorus-40bars'] as const).map((fixture) => ({ template: 'symphony' as const, fixture, seed: 1, take: 0 })),
];
const saveMidi = (file: string, p: Project, tracks: Track[], uvi = true) => {
  const data = buildMergedMidi(p, tracks, uvi ? profile : null);
  const midi = parseMidi(data);
  // These files contain only normal string profile parts, no fileOnly parts.
  assert.equal(midi.tracks.length, tracks.length + 1, `${file}: missing/duplicate exported part`);
  const names = midi.tracks.slice(1).map((t) => t.find((e) => e.type === 'trackName'));
  assert.equal(names.length, tracks.length);
  const noteOns = midi.tracks.flat().filter((e) => e.type === 'noteOn' && e.velocity > 0).length;
  assert(noteOns > 0);
  const dest = path.join(out, file);
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, data);
  files.push({ file, bytes: data.length, sha256: digest(data), instrumentTracks: tracks.length, noteOns });
};
const evidence: unknown[] = [];
const rows: string[] = [];
for (const cell of cells) {
  const p = projectForStringCell(cell);
  // Do NOT use composeStringCell: that helper explicitly reconstructs legacy.
  const r = composeAllTracks(p, { seed: cell.seed, stringsComposition: 'v1' });
  const classic = composeAllTracks(p, { seed: cell.seed, stringsComposition: 'classic' });
  const again = composeAllTracks(p, { seed: cell.seed, stringsComposition: 'v1' });
  assert.deepEqual(r, again, 'repeat production result');
  assert.deepEqual(r.stringsDiagnostics, again.stringsDiagnostics, 'repeat diagnostics');
  assert.deepEqual(r.pianoEngineInput, classic.pianoEngineInput, 'Piano consumed input isolation');
  assert.deepEqual(r.tracks.filter((t) => !isStringTrack(t)), classic.tracks.filter((t) => !isStringTrack(t)), 'nonstrings isolation');
  assert.deepEqual(r.tracks.map((t) => [t.id, t.role, t.name]), classic.tracks.map((t) => [t.id, t.role, t.name]), 'track roster');
  assert.equal(new Set(r.tracks.map((t) => t.id)).size, r.tracks.length);
  const d = r.stringsDiagnostics.v1!, c = d.composition!;
  assert(c.written, c.reason ?? 'primary absent');
  const tag = `${cell.template}-${cell.fixture}-seed${cell.seed}-take${cell.take}`;
  const actual: Project = { ...p, tracks: r.tracks };
  const primary = r.tracks.filter((t) => t.id === c.trackId);
  const strings = r.tracks.filter((t) => isStringTrack(t) && isInstrumentTrack(t));
  saveMidi(`${tag}/01_primary__uvi.mid`, actual, primary);
  saveMidi(`${tag}/02_strings__uvi.mid`, actual, strings);
  saveMidi(`${tag}/03_primary__plain.mid`, actual, primary, false);
  // Raw head/home only: compare the idea before all developmental decisions.
  const homeNotes = c.theme!.notes.map((n) => ({ ...n, tick: n.tick + c.theme!.home.startTick, segment: 'statement' as const, breathAfter: false, intensity: 0.6 }));
  const themePhrase = { ...c.phrases[0], notes: homeNotes, startTick: c.theme!.home.startTick, endTick: c.theme!.home.endTick, climax: { tick: homeNotes[c.theme!.identity.apexIndex].tick, step: homeNotes[c.theme!.identity.apexIndex].step } };
  const written = writeVoice({ frame: { ...c.frame!, harmony: d.understanding.harmony }, phrases: [themePhrase], octave: c.octave!, triggerable: ['legato', 'sustain'], energyByBar: r.plan.bars.map((b) => b.energyTarget) });
  const solo = primary.map((t) => ({ ...t, notes: written.notes.map((n) => n.note), cc: [] }));
  saveMidi(`${tag}/04_theme_home__uvi.mid`, actual, solo);
  const voices = Object.fromEntries([['primary', c], ['companion', d.ensemble!], ['viola', d.viola!], ['cello', d.cello!], ['doubleBass', d.doubleBass!]].map(([name, v]) => [name, { written: (v as typeof c).written, reason: (v as typeof c).reason }]));
  const details = { cell, producedTake: r.orchestration.take, identity: c.identity, theme: c.theme, windows: c.windows, phrases: c.phrases, silentWindows: c.silentWindows, selection: c.selection, voices, ensemblePlan: d.ensemble!.plan, violaPlan: d.viola!.plan, celloPlan: d.cello!.plan, bassPlan: d.doubleBass!.plan, primaryGrid: c.voiceNotes, tracks: strings, checks: { repeat: true, nonstringsEqualClassic: true, pianoInputEqualClassic: true, rosterEqualClassic: true } };
  writeFileSync(path.join(out, tag, 'evidence.json'), JSON.stringify(details, null, 2));
  const f = c.frame!, at = (t: number) => `${(t / f.barTicks + 1).toFixed(3)}`;
  const phraseRows = c.phrases.map((ph) => `| ${at(ph.startTick)}–${at(ph.endTick)} | ${ph.development?.strategy} | ${ph.segments.map((s) => s.operation).join(' → ')} | ${ph.goal.chord}, ${ph.goal.ending} |`).join('\n');
  writeFileSync(path.join(out, tag, 'evidence.md'), `# ${tag}\n\nNot listened to. Stored take ${cell.take}; produced take ${r.orchestration.take}. Displayed seed ${cell.seed}.\n\nTheme scale-step intervals: ${JSON.stringify(c.theme!.identity.intervals)}\n\nRhythm in beats: ${JSON.stringify(c.theme!.identity.rhythm)}; contour ${c.theme!.identity.contour}; apex note ${c.theme!.identity.apexIndex + 1}.\n\n| Start–end (bar positions) | Journey | Actual operations/repairs | Arrival |\n|---|---|---|---|\n${phraseRows}\n\nVoice availability (false retains classic; it is NOT a newly composed V2 voice):\n\n\`\`\`json\n${JSON.stringify(voices, null, 2)}\n\`\`\`\n\nSee evidence.json for exact symbolic intentions, repair decisions, final notes/CC, writer plans and isolation checks.\n`);
  rows.push(`| ${tag} | ${c.theme!.identity.intervals.join(', ')} | ${c.theme!.identity.rhythm.join(', ')} | ${c.phrases.length} | ${Object.entries(voices).filter(([, v]) => !v.written).map(([k, v]) => `${k}: ${v.reason}`).join('; ') || 'all present desks written'} |`);
  evidence.push({ tag, ...details, tracks: undefined, primaryGrid: undefined });
  cases.push({ cell, project: p, result: r });
  console.log(tag, 'primary', c.trackId, 'phrases', c.phrases.length, 'voices', JSON.stringify(voices));
}
// Deliberately isolated writer experiment: FREEZE all symbolic pitches,
// durations, boundaries, octave and articulation availability. Change ONLY
// template energy targets supplied to the unchanged primary writer. Not a
// production Compose All result or a separate compositional style/mood.
const base = cases[0], bd = base.result.stringsDiagnostics.v1!, bc = bd.composition!;
const fixed: unknown[] = [];
for (const entry of cases.filter((x) => x.cell.seed === 1 && x.cell.take === 0 && x.cell.fixture === 'dorian-16bars')) {
  const track = entry.result.tracks.find((t) => t.role === base.result.tracks.find((t) => t.id === bc.trackId)!.role)!;
  assert(track, 'fixed material primary must exist in this roster');
  const energy = entry.result.plan.bars.map((b) => b.energyTarget);
  const voice = writeVoice({ frame: { ...bc.frame!, harmony: bd.understanding.harmony }, phrases: bc.phrases, octave: bc.octave!, triggerable: ['legato', 'sustain'], energyByBar: energy });
  const notes = voice.notes.map((n) => n.note);
  const t = { ...track, notes, cc: [] };
  saveMidi(`fixed-material-energy-control/${entry.cell.template}__primary__uvi.mid`, entry.project, [t]);
  fixed.push({ template: entry.cell.template, frozenSource: 'symphony-dorian-16bars-seed1-take0', energy, notes });
}
writeFileSync(path.join(out, 'fixed-material-energy-control', 'evidence.json'), JSON.stringify(fixed, null, 2));
writeFileSync(path.join(out, 'matrix.json'), JSON.stringify(evidence, null, 2));
writeFileSync(path.join(out, 'midi-manifest.json'), JSON.stringify(files, null, 2));
writeFileSync(path.join(out, 'README.md'), `# Strings V1 — identity and development V2\n\n**Studio One MIDI audition; not listened to, not audio, not musical approval.**\n\n## Suggested listening order\n1. Compare Symphony seeds 1, 2, 5, 6, 8 and 11, take 0: file 04 (theme only), then 01 (primary development). Listen for descending/repeated-note/ascending and wider-leap openings, different rhythmic gait, peak placement and returns.\n2. Compare file 01 across the eight consecutive seeds (plus seed 11, a repeated-opening control), then file 02 (full string band). Are these recognizably different ideas, and does each journey remain related to its own theme?\n3. Fix seed 1: compare take 0/1/2/3. Folder take is the STORED request; evidence also gives the incremented produced take.\n4. Compare Chamber, Cinematic, Hybrid Studio and Symphony at seed 1/take 0. Normal production identity includes template: these compare BOTH new composition and roster/energy. They do not prove template-specific musical style.\n5. Separately, fixed-material-energy-control freezes the Symphony seed-1 phrases and octave and calls the accepted writer with each template's energy targets. These are primary-only, no humanization or CC; any change here is writer energy, NOT new thematic identity. Identical controls are valid.\n6. Longer/repeated form: multi-chorus-16bars and three-chorus-40bars, file 01 then 02. Check whether a long form develops instead of cycling indiscriminately.\n\n## Import into Studio One\nUse the same UVI Orchestral Suite setup as Stage 6. Open/import ONE MIDI at a time at song origin, preserving the file tempo and meter; do not layer files 01–04. Files are Type 1, conductor plus one part per present string instrument. Route each named part to the same existing UVI desk/channel used by the accepted packages. UVI keyswitches are low notes: do not play them as musical notes or transpose them. Existing profile and mappings are unchanged. CC1/11/7 are retained in the production primary/full-strings files. File 03 is plain MIDI without keyswitch conversion, useful for inspecting notes or another sound source (not the UVI articulation comparison). File 04 is an isolated writer realization of just the home theme, without the production expression passes.\n\nThe script parses every MIDI and verifies expected part counts. See midi-manifest.json for actual SHA256/byte sizes/counts, not as evidence of musical diversity. Each evidence.json holds actual final notes/CC and symbolic theme/phrase evidence.\n\n## Controls and known limits\nAll main seed controls share D Dorian harmony, tempo, project, Symphony template and stored take 0. Exact repeated production runs, nonstring output equality to classic, Piano consumed-input equality and track roster equality are asserted for EVERY case. No new tracks are invented. A rejected writer keeps its classic part: this is stated below and in per-case evidence, not silently counted as a new V2 voice. The accepted lower voices still own their existing role schedules/search policies and can reject richer material. No supported mood input exists; no mood comparison is claimed.\n\n| Case | Actual theme intervals (scale steps) | Rhythm (beats) | Phrases | Limits |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n## Listening questions\nDoes the initial idea stay memorable after inversion/fragmentation/augmentation? Are breaths, joins, climaxes and cadences convincing? Does the second voice support rather than compete? Do lower voices still sound repetitive despite the richer upstream line? Does a retained classic part clash? These require human listening in Studio One/UVI; data checks cannot answer them.\n`);
console.log(`Wrote ${files.length} validated MIDI files to ${out}`);
