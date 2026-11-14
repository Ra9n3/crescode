/**
 * Strings V1, Stage 5 — audition material and evidence for the Cello as a
 * fourth voice.
 *
 *   npx vite-node scripts/strings-v1-stage5-audition.ts [template] [fixture] [seed] [take]
 *   (defaults: chamber dorian-16bars 1 0; STRINGS_V1_OUT=<dir> changes the output folder)
 *
 * Composes the case through the ordinary production path (classic, and
 * Strings V1) and writes eight numbered MIDI files through the shipped UVI
 * export profile, plus evidence.md and README.md. "Stage 4" here means: the
 * V1 arrangement with the Cello track put back to its classic part — which
 * is exactly what Stage 4 produced. Where the kept Stage 4 record
 * (evaluation/strings-v1-stage4/audition) holds the same case, every Stage 4
 * file written here is compared with it byte for byte and the result is
 * stated; that folder is only read.
 *
 * It renders no audio and makes no statement about how anything sounds.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseMidi } from 'midi-file';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type Note, type Project, type Track } from '../src/shared/schema';
import { buildInstrumentCapabilities } from '../src/orchestrator/strings/characters/capabilities';
import { CELLO, CELLO_BASS_CELLS, CELLO_FOUNDATION_CELLS, CELLO_PLUCKED_CELLS } from '../src/orchestrator/strings/characters/cello';
import type { StringsV1Composition } from '../src/orchestrator/strings/composition';
import type { StringsV1Ensemble } from '../src/orchestrator/strings/ensemble/compose';
import { intervalName, soundingPitch } from '../src/orchestrator/strings/ensemble/counterpoint';
import { CELLO_GESTURE_DEPTH, type StringsV1FourthVoice } from '../src/orchestrator/strings/ensemble/fourth';
import type { StringsV1ThirdVoice } from '../src/orchestrator/strings/ensemble/third';
import { composeStringCell, type StringFixtureKey, type StringTemplateKey } from '../tests/strings-v1-support';

const template = (process.argv[2] ?? 'chamber') as StringTemplateKey;
const fixture = (process.argv[3] ?? 'dorian-16bars') as StringFixtureKey;
const seed = Number(process.argv[4] ?? 1);
const take = Number(process.argv[5] ?? 0);
const out = process.env.STRINGS_V1_OUT ?? path.join(process.cwd(), 'evaluation', 'strings-v1-stage5', 'audition');
const stage4Dir = path.join(process.cwd(), 'evaluation', 'strings-v1-stage4', 'audition');
const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Note names with middle C = C4 (MIDI 60), as in the Stage 4 evidence. UVI's own key labels call MIDI 60 "C3"; MIDI numbers are always given beside the names. */
const name = (pitch: number): string => `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
const sha1 = (data: Uint8Array): string => createHash('sha1').update(data).digest('hex');

const cell = { template, fixture, seed, take };
const classic = composeStringCell(cell, 'classic');
const v1 = composeStringCell(cell, 'v1');
const diagnostics = (v1.result as unknown as { stringsDiagnostics: { v1: { composition: StringsV1Composition; ensemble: StringsV1Ensemble; viola: StringsV1ThirdVoice; cello: StringsV1FourthVoice } } }).stringsDiagnostics.v1;
const { composition, ensemble, viola, cello } = diagnostics;
const tag = `${template}-${fixture}-seed${seed}-take${take}`;
if (!composition.written || !composition.trackId || !composition.frame || !ensemble.written || !ensemble.companion || !viola.written || !viola.viola || !cello.cello) {
  console.error(`nothing to audition: first voice ${composition.written}, second voice ${ensemble.written} (${ensemble.reason}), Viola ${viola.written} (${viola.reason}), Cello: ${cello.reason}`);
  process.exit(1);
}
// The folder evaluation/strings-v1-stage5/audition is the kept Stage 5 record (it was auditioned): never written again.
// Since Stage 6 the Double Basses desk is composed too, so "Stage 5" can no longer be produced by this script for bands with a desk.
if (path.resolve(out) === path.resolve(process.cwd(), 'evaluation', 'strings-v1-stage5', 'audition') && existsSync(out)) {
  console.error('evaluation/strings-v1-stage5/audition is the kept Stage 5 record and is not overwritten. Set STRINGS_V1_OUT to another folder; scripts/strings-v1-stage6-audition.ts rebuilds the Stage 5 files and compares them with that record byte for byte.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const frame = composition.frame;
const bar = frame.barTicks;
const beat = frame.beatTicks;
const at = (tick: number): string => `bar ${Math.floor(tick / bar) + 1} beat ${Math.round(((tick % bar) / beat + 1) * 100) / 100}`;
const beatsOf = (ticks: number): number => Math.round((ticks / beat) * 100) / 100;
const pitch = (n: { step: number; alter: number }): number => soundingPitch({ ...frame, harmony: [] } as never, n);
const playable = (tracks: Track[]): Track[] => tracks.filter((t) => isInstrumentTrack(t) && t.notes.length > 0);
const violaId = viola.viola.trackId;
const celloId = cello.cello.trackId;
const firstId = composition.trackId;
const secondId = ensemble.companion.trackId;
const themeName = ensemble.primary!.name;
const otherName = ensemble.companion.name;
const violinOne = [firstId, secondId].find((id) => v1.result.tracks.find((t) => t.id === id)?.role === 'violins1')!;
const violinTwo = [firstId, secondId].find((id) => id !== violinOne)!;

// Stage 5 = the V1 result. Stage 4 = the same with the Cello track as classic left it.
const stage5Tracks = v1.result.tracks;
const classicCello = classic.result.tracks.find((t) => t.id === celloId)!;
const stage4Tracks = stage5Tracks.map((t) => (t.id === celloId ? classicCello : t));
const stage5: Project = { ...v1.project, tracks: stage5Tracks };
const stage4: Project = { ...v1.project, tracks: stage4Tracks };
const only = (tracks: Track[], ids: readonly string[]): Track[] => playable(tracks).filter((t) => ids.includes(t.id));
const who = (id: string): string => (id === firstId ? 'carries the theme' : 'the second voice');

const files: { file: string; data: Uint8Array; what: string; stage4File: string | null }[] = [];
const put = (file: string, data: Uint8Array, what: string, stage4File: string | null = null): void => {
  writeFileSync(path.join(out, `${tag}__${file}`), data);
  files.push({ file: `${tag}__${file}`, data, what, stage4File: stage4File ? `${tag}__${stage4File}` : null });
};
put('1_stage4_violin-i-alone__uvi.mid', buildPerTrackMidi(stage4, only(stage4Tracks, [violinOne]), PROFILE)[0].data, `Stage 4 (accepted): Violin I alone (${who(violinOne)})`, '1_stage3_violin-i-alone__uvi.mid');
put('2_stage4_violin-ii-alone__uvi.mid', buildPerTrackMidi(stage4, only(stage4Tracks, [violinTwo]), PROFILE)[0].data, `Stage 4 (accepted): Violin II alone (${who(violinTwo)})`, '2_stage3_violin-ii-alone__uvi.mid');
put('3_stage4_viola-alone__uvi.mid', buildPerTrackMidi(stage4, only(stage4Tracks, [violaId]), PROFILE)[0].data, 'Stage 4 (accepted): the Viola alone', '3_stage4_viola-alone__uvi.mid');
if (cello.written) put('4_stage5_cello-alone__uvi.mid', buildPerTrackMidi(stage5, only(stage5Tracks, [celloId]), PROFILE)[0].data, 'Stage 5: the new Cello alone');
put('5_stage4_three-voices__uvi.mid', buildMergedMidi(stage4, only(stage4Tracks, [violinOne, violinTwo, violaId]), PROFILE), 'Stage 4 (accepted): Violin I, Violin II and Viola, nothing else', '5_stage4_three-voices__uvi.mid');
if (cello.written) put('6_stage5_four-voices__uvi.mid', buildMergedMidi(stage5, only(stage5Tracks, [violinOne, violinTwo, violaId, celloId]), PROFILE), 'Stage 5: Violin I, Violin II, Viola and the new Cello, nothing else');
put('7_stage4_full__uvi.mid', buildMergedMidi(stage4, playable(stage4Tracks), PROFILE), 'Stage 4 (accepted): the full arrangement (three composed voices; Cello and everything else classic)', '7_stage4_full__uvi.mid');
put('8_stage5_full__uvi.mid', buildMergedMidi(stage5, playable(stage5Tracks), PROFILE), 'Stage 5: the full arrangement (four composed voices; Double Bass, where the band has one, and everything else classic)');

/* ---------------- evidence ---------------- */
const L: string[] = [];
L.push(`# Strings V1 Stage 5 — the Cello as a fourth voice: evidence (${tag})`, '', 'Generated by `scripts/strings-v1-stage5-audition.ts`. **Nothing here was listened to.** Every statement below is read from the composed data or from the exported files; none of it says how the passage sounds. Note names use middle C = C4 (MIDI 60); MIDI numbers are given beside them.', '');
L.push(`Cello written: **${cello.written}**${cello.reason ? ` — ${cello.reason}` : ''}`, '');
L.push(`Theme (first voice, Stage 2): **${themeName}** (\`${firstId}\`). Second voice (Stage 3): **${otherName}** (\`${secondId}\`). Third voice (Stage 4): **Viola** (\`${violaId}\`). Fourth voice (Stage 5): **Cello** (\`${celloId}\`). Double Bass desk: ${cello.doubleBass.trackId ? `\`${cello.doubleBass.trackId}\`, ${cello.doubleBass.notes} classic notes, not changed` : '**none in this band**'}.`, '');

L.push('## 1. Files', '', '| file | bytes | SHA-1 | content | same bytes as the kept Stage 4 file |', '|---|---|---|---|---|');
let keptCompared = 0;
let keptSame = 0;
for (const f of files) {
  let same = '— (new in Stage 5)';
  if (f.stage4File) {
    const kept = path.join(stage4Dir, f.stage4File);
    if (existsSync(kept)) {
      keptCompared++;
      const equal = Buffer.compare(readFileSync(kept), Buffer.from(f.data)) === 0;
      if (equal) keptSame++;
      same = equal ? `**yes** — \`${f.stage4File}\`` : `**NO** — differs from \`${f.stage4File}\``;
    } else same = 'no kept Stage 4 file for this case';
  }
  L.push(`| \`${f.file}\` | ${f.data.length} | \`${sha1(f.data)}\` | ${f.what} | ${same} |`);
}
const strip = (tracks: Track[], ids: readonly string[]): string => JSON.stringify(tracks.filter((t) => !ids.includes(t.id)));
const again = composeStringCell(cell, 'v1').result.tracks;
const deskV1 = stage5Tracks.find((t) => t.role === 'basses');
const deskClassic = classic.result.tracks.find((t) => t.role === 'basses');
L.push('', `- Stage 4 files compared with the kept record: ${keptCompared}; identical: **${keptSame}**`,
  `- every track of the Stage 5 arrangement except the Cello equals the Stage 4 arrangement (notes and controllers): **${strip(stage5Tracks, [celloId]) === strip(stage4Tracks, [celloId])}** (by construction: Stage 4 is rebuilt here by putting the classic Cello back)`,
  `- every track except the two violins, the Viola and the Cello equals the classic arrangement: **${strip(stage5Tracks, [firstId, secondId, violaId, celloId]) === strip(classic.result.tracks, [firstId, secondId, violaId, celloId])}**`,
  `- Double Bass desk: ${deskV1 || deskClassic ? `equal to the classic desk (notes and controllers): **${JSON.stringify(deskV1) === JSON.stringify(deskClassic)}**` : 'the band has none; no track with the role `basses` exists in either arrangement'}`,
  `- Cello notes carrying a \`layer\` mark (which the export would route to the Double Bass part): **${cello.notes.filter((n) => n.layer !== undefined).length}**`,
  `- composing the same case a second time gives the same tracks: **${JSON.stringify(again) === JSON.stringify(stage5Tracks)}**`, '');

/* instrument facts */
const caps = buildInstrumentCapabilities('cello');
L.push('## 2. The instrument, as the shipped export profile describes it', '',
  'Read from `src/export/profiles/uvi-orchestral-suite.json` through `buildInstrumentCapabilities(\'cello\')`. **None of it was checked against the UVI patch itself**: the keys, the zone and the playable low note are what the profile says, not what was heard.', '',
  '```json', JSON.stringify(caps, null, 1), '```', '',
  `Written range used by the Cello voice: ${name(cello.cello.range[0])}–${name(cello.cello.range[1])} (MIDI ${cello.cello.range[0]}–${cello.cello.range[1]}). Strokes the Cello may write (each has a keyswitch of its own in the profile): ${cello.cello.triggerable.join(', ')}. Never written: ${cello.cello.notTriggerable.join(', ')} — staccato and spiccato have no key of their own in the profile (it would substitute marcato), and the marcato key is marked unverified.`, '');

/* character */
L.push('## 3. The Cello\'s character (`characters/cello.ts`)', '',
  `- range written: MIDI ${CELLO.floor}–${CELLO.ceiling}; below MIDI ${CELLO.heavyBelow} no quavers (the lowest string speaks slowly); bass roles no higher than MIDI ${CELLO.bassCeiling}, preferably MIDI ${CELLO.bassRegister[0]}–${CELLO.bassRegister[1]}; thematic material preferably MIDI ${CELLO.singingRegister[0]}–${CELLO.singingRegister[1]}`,
  `- a bass moves by step, fourth, fifth and octave; thirds in passing; no sixths or sevenths. Thematic material keeps the theme's own intervals`,
  `- at least ${CELLO.clearance} semitones under the lowest note above it in a bass role; a part needs ${CELLO.minRoom} semitones of room or the Cello is silent`,
  `- bowed notes for more than ${CELLO.maxUnbrokenBeats} beats without a rest are penalised (more than ${CELLO.maxUnbrokenBeats + 4} is a review finding); ${CELLO.arcoPreparationBeats} beat of rest between a plucked and a bowed note`,
  `- loudness relative to a leading voice (MIDI velocity): ${Object.entries(CELLO.level).filter(([k]) => k !== 'tacet').map(([k, v]) => `${k} ${v}`).join(', ')}`,
  `- stroke per role: ${Object.entries(CELLO.articulation).map(([k, v]) => `${k} → ${v}`).join(', ')}; a long tone standing alone → sustain; a long foundation tone at energy ≥ ${CELLO.tremoloFromEnergy} → tremolo`,
  `- foundation rhythms: ${CELLO_FOUNDATION_CELLS.map((c) => c.name).join('; ')}`,
  `- moving-bass rhythms: ${CELLO_BASS_CELLS.map((c) => c.name).join('; ')}`,
  `- plucked rhythms: ${CELLO_PLUCKED_CELLS.map((c) => c.name).join('; ')}`,
  `- depth of the dynamic curve per gesture (controller steps): ${Object.entries(CELLO_GESTURE_DEPTH).map(([k, v]) => `${k} ${v}`).join(', ')}`, '');

if (cello.plan) {
  L.push('## 4. The plan (made from the three finished upper voices, before any Cello note existed)', '', '| # | from | to | role | first voice here | second voice here | Viola here | highest bass note allowed | Cello is the floor | asked of the Cello | why |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of cello.plan.spans) L.push(`| ${s.index + 1} | ${at(s.startTick)} | ${at(s.endTick)} | **${s.role}${s.thematic ? ` (${s.thematic})` : ''}** | ${s.firstVoice} | ${s.secondVoice} | ${s.viola} | ${s.ceiling === null ? '—' : `${name(s.ceiling)} (${s.ceiling})`} | ${s.isFloor ? 'yes' : 'no (Double Bass below)'} | ${s.intention} | ${s.reason} |`);
  L.push('', '## 5. What the Cello decided, stretch by stretch', '');
  for (const s of cello.plan.spans) {
    const w = cello.writing.find((x) => x.span === s.index);
    if (!w) continue;
    L.push(`**${s.index + 1}. ${at(s.startTick)} – ${at(s.endTick)}: ${s.role}** — ${w.played ? `plays (${w.level} alternative)` : 'silent'}`, '', `- ${w.decision}`);
    if (w.material) L.push(`- material: ${w.material}`);
    if (w.rhythm.length) L.push(`- rhythm, bar by bar: ${w.rhythm.join(' | ')}`);
    if (w.weighed) L.push(`- weighed (lower is better): ${Object.entries(w.weighed).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const turned = Object.entries(w.rejections);
    if (turned.length) L.push(`- candidates turned down: ${turned.map(([k, v]) => `${k} ×${v}`).join('; ')}`);
    L.push('');
  }
}

/* thematic */
const theme = composition.theme!;
L.push('## 6. Thematic material in the Cello', '',
  `The theme (${themeName}): moves in scale steps ${JSON.stringify(theme.identity.intervals)}, in semitones ${JSON.stringify(theme.identity.semitoneIntervals)}; note lengths in beats ${JSON.stringify(theme.identity.rhythm)}; contour \`${theme.identity.contour}\`; its leap: ${theme.identity.leap.name} from note ${theme.identity.leap.fromIndex + 1}; head = notes 1–${theme.headCount}.`, '');
if (cello.thematic.length === 0) L.push('**The Cello took no thematic material in this case.**', '');
for (const t of cello.thematic) {
  const notes = cello.voiceNotes.filter((w) => w.source.span === t.span && w.source.role === 'theme');
  const semis = notes.slice(1).map((w, i) => w.note.pitch - notes[i].note.pitch);
  const from = notes[0]?.source.themeIndex ?? 0;
  const sameIntervals = JSON.stringify(t.intervals) === JSON.stringify(t.themeIntervals);
  L.push(`- **${at(t.startTick)}: ${t.kind === 'statement' ? 'the whole theme' : t.kind === 'head' ? 'the theme\'s head' : 'the theme\'s close'}** (theme notes ${from + 1}–${from + notes.length}), ${t.shift === 0 ? 'at pitch' : `${Math.abs(t.shift)} scale steps ${t.shift < 0 ? 'lower' : 'higher'}`}: ${notes.map((w) => `${name(w.note.pitch)} (${w.note.pitch})`).join(' ')}`,
    `  - moves in scale steps: Cello ${JSON.stringify(t.intervals)}, theme ${JSON.stringify(t.themeIntervals)} — ${sameIntervals ? 'identical' : `**not identical**: ${t.moved.map((m) => `note ${m.index + 1} moved ${m.how}`).join(', ')} to fit the harmony there`}`,
    `  - moves in semitones: Cello ${JSON.stringify(semis)}, theme ${JSON.stringify(theme.identity.semitoneIntervals.slice(from, from + notes.length - 1))}`,
    `  - note lengths in beats: Cello ${JSON.stringify(t.rhythmBeats)}, theme ${JSON.stringify(t.themeRhythmBeats)} — ${JSON.stringify(t.rhythmBeats) === JSON.stringify(t.themeRhythmBeats) ? 'identical' : 'not identical'}`,
    `  - how the harmony was met: ${t.strategy}; features of the theme that did not survive: ${t.preferredLost.length ? t.preferredLost.join('; ') : 'none'}`,
    `  - ${t.candidatesTried} transpositions and placements tried, ${t.candidatesSound} sound against all three upper voices`);
}
L.push('');

const F = viola.firstLine;
const S = viola.secondLine;
const V = viola.line;
const soundingIn = <T extends { tick: number; duration: number }>(line: readonly T[], tick: number): T | undefined => line.find((p) => p.tick <= tick && p.tick + p.duration > tick);
const chords = (v1.result as unknown as { stringsDiagnostics: { v1: { understanding: { harmony: { chords: { fact: { symbol: string; startTick: number; endTick: number } }[] } } } } }).stringsDiagnostics.v1.understanding.harmony.chords;
L.push('## 7. Every Cello note against the three upper voices', '', `| stretch | role | where | chord | note | MIDI | beats | velocity | stroke | function | ${themeName} | interval | ${otherName} | interval | Viola | interval | lowest voice | begins with | shaping |`, '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const w of cello.voiceNotes) {
  const n = w.source;
  const col = (line: readonly { tick: number; duration: number; step: number; alter: number }[]): string => { const x = soundingIn(line, n.tick); return x ? `${name(pitch(x))} | ${intervalName(pitch(x) - w.note.pitch)}${pitch(x) < w.note.pitch ? ' (below the Cello)' : ''}` : '— | '; };
  const others = [F, S, V].map((line) => soundingIn(line, n.tick)).filter((x): x is NonNullable<typeof x> => !!x).map(pitch);
  const withWhom = [F.some((p) => p.tick === n.tick) ? themeName : null, S.some((p) => p.tick === n.tick) ? otherName : null, V.some((p) => p.tick === n.tick) ? 'Viola' : null].filter(Boolean).join(' + ') || '—';
  const chord = chords.find((c) => c.fact.startTick <= n.tick && n.tick < c.fact.endTick)?.fact.symbol ?? '—';
  L.push(`| ${n.span + 1} | ${n.role}${n.themeIndex !== null ? ` (theme note ${n.themeIndex + 1})` : ''} | ${at(n.tick)} | ${chord} | ${name(w.note.pitch)} | ${w.note.pitch} | ${beatsOf(w.note.durationTicks)} | ${w.note.velocity} | ${w.note.articulation} | ${n.function} | ${col(F)} | ${col(S)} | ${col(V)} | ${others.every((p) => p >= w.note.pitch) ? 'Cello' : 'not the Cello'} | ${withWhom} | ${w.shaping.join('; ')} |`);
}
L.push('');

const facts = cello.review.facts;
if (facts) {
  const pair = (label: string, p: typeof facts.withFirst): string => `- with ${label}: ${p.sharedOnsets} Cello notes begin together with one of its notes; motion — contrary ${p.motion.contrary}, oblique ${p.motion.oblique}, similar ${p.motion.similar}, parallel ${p.motion.parallel}; sounding together (beats) — thirds and sixths ${p.together.thirdsAndSixths}, fifths and octaves ${p.together.fifthsAndOctaves} (of which unisons and octaves ${p.together.unisonsAndOctaves}), dissonant ${p.together.dissonant}; bars in which both play ${p.rhythm.barsTogether}, with the same rhythm ${p.rhythm.sameRhythm}`;
  L.push('## 8. Four voices, measured (counts, not a verdict)', '',
    `- Cello notes: ${facts.notes.cello} (${facts.notes.bowed} bowed, ${facts.notes.plucked} plucked), of which thematic ${facts.notes.thematic}`,
    `- beats (of ${facts.beats.total}): the Cello sounds in ${facts.beats.celloSounds}, is silent in ${facts.beats.celloSilent}; all four voices sound in ${facts.beats.allFour}; the Cello without any upper voice in ${facts.beats.celloAlone}`,
    `- beats per role: ${Object.entries(facts.roleBeats).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `- place: lowest string voice in ${facts.place.lowestVoice} beats, above the Viola in ${facts.place.aboveViola}, over a sounding Double Bass in ${facts.place.overDoubleBass}`,
    `- first beats of a chord on which the Cello plays as the floor: ${facts.bass.chordStarts}; on the chord's bass note: ${facts.bass.onChordBass}`,
    `- Cello note beginnings: ${facts.onsets.alone} alone, ${facts.onsets.withOne} with one upper voice, ${facts.onsets.withTwo} with two, ${facts.onsets.withThree} with all three`,
    pair(themeName, facts.withFirst), pair(otherName, facts.withSecond), pair('the Viola', facts.withViola),
    `- Cello register: ${facts.register ? `${name(facts.register[0])}–${name(facts.register[1])} (MIDI ${facts.register[0]}–${facts.register[1]})` : '—'}; nearest note above a Cello note: ${facts.nearestAbove ?? '—'} semitones (negative = the Cello is above the Viola there)`, '');
}
L.push('## 9. Review of the four voices', '');
for (const p of cello.review.passes) L.push(`- pass ${p.pass}: ${p.findings.length} finding(s)${p.findings.length ? ` — ${p.findings.map((f) => `${f.kind} (${f.text})`).join('; ')}` : ''}${p.action ? `. Action: ${p.action}` : ''}`);
L.push('', cello.review.unresolved.length ? `**Unresolved after the last pass: ${cello.review.unresolved.length}**` : '**Unresolved after the last pass: none by the rules the review knows.** That is a statement about those rules, not about how it sounds.', '');

/* expression */
if (cello.expression) {
  L.push('## 10. Expression', '', `Controller lanes on the Cello track: ${cello.cc.map((l) => `CC${l.cc} (${l.points.length} points)`).join(', ')}. The Cello's own: CC${cello.expression.ownLanes.join(', CC')}; from the shared pass: CC${cello.expression.sharedLanes.join(', CC')}. The export profile writes CC ${caps.controllersWritten.join(', CC')} for the Cello${caps.controllersNotWritten.length ? ` and leaves out CC${caps.controllersNotWritten.join(', CC')}` : ''}.`, '',
    '| gesture | from | goal | to | role | notes | depth | CC1 at start / goal / end | CC11 at start / goal / end | velocities |', '|---|---|---|---|---|---|---|---|---|---|');
  const lane = (cc: number, tick: number): number | string => {
    const points = cello.cc.find((l) => l.cc === cc)?.points ?? [];
    let value: number | string = '—';
    for (const p of points) if (p.tick <= tick) value = p.value;
    return value;
  };
  cello.expression.gestures.forEach((g, i) => {
    const vel = cello.voiceNotes.filter((w) => w.source.tick >= g.startTick && w.source.tick < g.endTick && w.gesture >= 0).map((w) => w.note.velocity);
    L.push(`| ${i + 1} | ${at(g.startTick)} | ${at(g.goalTick)} | ${at(g.endTick)} | ${g.role} | ${g.notes} | ${g.depth} | ${lane(1, g.startTick)} / ${lane(1, g.goalTick)} / ${lane(1, g.endTick)} | ${lane(11, g.startTick)} / ${lane(11, g.goalTick)} / ${lane(11, g.endTick)} | ${vel.join(' ')} |`);
  });
  const strokes = new Map<string, number>();
  for (const n of cello.notes) strokes.set(n.articulation ?? 'none', (strokes.get(n.articulation ?? 'none') ?? 0) + 1);
  L.push('', `Strokes written: ${[...strokes].map(([k, v]) => `${k} ×${v}`).join(', ')}. Strokes the character has but this case did not call for: ${['legato', 'sustain', 'pizz', 'tremolo'].filter((a) => !strokes.has(a)).join(', ') || 'none'}.`, '');
}

/* classic cello it replaced */
const describe = (notes: readonly Note[]): string => notes.map((n) => `${at(Math.round(n.startTick / (beat / 4)) * (beat / 4)).replace('bar ', '').replace(' beat ', '.')}:${name(n.pitch)}`).join(' ');
L.push('## 11. The classic Cello part it replaced', '', `${cello.replacedClassicNotes.length} notes (${[...new Set(cello.replacedClassicNotes.map((n) => n.articulation ?? 'none'))].join(', ')}): ${describe(cello.replacedClassicNotes)}`, '', `Stage 5 Cello: ${cello.notes.length} notes: ${describe(cello.voiceNotes.map((w) => w.note))}`, '');

/* export read-back */
L.push('## 12. Export read-back', '');
const zone = caps.keyswitchZone;
const readback: string[] = [];
for (const f of files) {
  const parsed = parseMidi(Buffer.from(f.data));
  const rows: string[] = [];
  for (const t of parsed.tracks) {
    let trackName = '';
    let channel: number | null = null;
    const ons: number[] = [];
    const ccs = new Map<number, number>();
    for (const e of t) {
      if (e.type === 'trackName') trackName = e.text;
      if (e.type === 'noteOn' && e.velocity > 0) { ons.push(e.noteNumber); channel = e.channel + 1; }
      if (e.type === 'controller') ccs.set(e.controllerType, (ccs.get(e.controllerType) ?? 0) + 1);
    }
    if (!ons.length) continue;
    const isCello = /cello/i.test(trackName);
    const inZone = zone && isCello ? ons.filter((p) => p >= zone.low && p <= zone.high) : [];
    const music = zone && isCello ? ons.filter((p) => p > zone.high) : ons;
    const row = `"${trackName}" ch ${channel}: ${ons.length} note-ons${isCello ? `, of which ${inZone.length} in the keyswitch zone (MIDI ${[...new Set(inZone)].sort((x, y) => x - y).join(', ') || 'none'}) and ${music.length} musical notes (MIDI ${Math.min(...music)}–${Math.max(...music)})` : ''}; controllers ${[...ccs].sort((x, y) => x[0] - y[0]).map(([k, v]) => `CC${k} ×${v}`).join(', ') || 'none'}`;
    rows.push(`  - ${row}`);
    if (isCello && f.file.includes('4_stage5_cello-alone')) readback.push(row);
  }
  L.push(`- \`${f.file}\`: format ${parsed.header.format}, ${parsed.header.ticksPerBeat} ticks per beat`, ...rows);
}
L.push('');
const celloFile = files.find((f) => f.file.includes('4_stage5_cello-alone'));
const keySequence: string[] = [];
if (celloFile && zone) {
  const parsed = parseMidi(Buffer.from(celloFile.data));
  for (const t of parsed.tracks) { let abs = 0; for (const e of t) { abs += e.deltaTime; if (e.type === 'noteOn' && e.velocity > 0 && e.noteNumber >= zone.low && e.noteNumber <= zone.high) keySequence.push(`${at(abs)} (tick ${abs}): MIDI ${e.noteNumber}, velocity ${e.velocity}`); } }
  L.push('Keyswitch notes in the Cello file, in order:', '', ...keySequence.map((x) => `- ${x}`), '');
  const musical = cello.notes.map((n) => n.pitch);
  L.push(`Cello musical notes: lowest MIDI ${Math.min(...musical)} (${name(Math.min(...musical))}), highest MIDI ${Math.max(...musical)} (${name(Math.max(...musical))}); keyswitch zone MIDI ${zone.low}–${zone.high}; musical notes inside the zone: **${musical.filter((p) => p >= zone.low && p <= zone.high).length}**; below the profile's playable low (MIDI ${caps.playableLow}): **${musical.filter((p) => caps.playableLow !== null && p < caps.playableLow).length}**`, '');
}

/* roll */
const rollNotes: [string, readonly Note[]][] = [['1', only(stage5Tracks, [violinOne])[0]?.notes ?? []], ['2', only(stage5Tracks, [violinTwo])[0]?.notes ?? []], ['V', viola.voiceNotes.map((w) => w.note)], ['C', cello.voiceNotes.map((w) => w.note)]];
const all = rollNotes.flatMap(([, n]) => n);
if (all.length) {
  const half = beat / 2;
  const cols = Math.ceil(Math.max(...all.map((n) => n.startTick + n.durationTicks)) / half);
  const perBar = bar / half;
  L.push('## 13. The four voices on one roll', '', 'One column = half a beat. `1` / `2` / `V` / `C` = Violin I / Violin II / Viola / Cello begins (lower case = plucked); `-` = held; `#` = two voices on the same pitch.', '', '```');
  let header = '     ';
  for (let c = 0; c < cols; c++) header += c % perBar === 0 ? String(c / perBar + 1).padEnd(perBar + 1).slice(0, perBar + 1) : '';
  L.push(header);
  for (let p = Math.max(...all.map((n) => n.pitch)); p >= Math.min(...all.map((n) => n.pitch)); p--) {
    let row = `${name(p).padEnd(4)} `;
    for (let c = 0; c < cols; c++) {
      if (c % perBar === 0) row += '|';
      const hits: string[] = [];
      for (const [mark, notes] of rollNotes) {
        const n = notes.find((x) => x.pitch === p && Math.round(x.startTick / half) <= c && x.startTick + x.durationTicks > c * half + beat / 8);
        if (n) hits.push(Math.round(n.startTick / half) === c ? (n.articulation === 'pizz' ? mark.toLowerCase() : mark) : '-');
      }
      row += hits.length > 1 ? '#' : hits[0] ?? '.';
    }
    if (/[12VvCc#-]/.test(row.slice(5))) L.push(row);
  }
  L.push('```', '');
}
writeFileSync(path.join(out, `${tag}__evidence.md`), `${L.join('\n')}\n`);

/* ---------------- README ---------------- */
const channelOf = (id: string): string => {
  const data = buildPerTrackMidi(stage5, only(stage5Tracks, [id]), PROFILE)[0]?.data;
  if (!data) return '—';
  for (const t of parseMidi(Buffer.from(data)).tracks) for (const e of t) if (e.type === 'noteOn') return String(e.channel + 1);
  return '—';
};
const strokesUsed = [...new Set(cello.notes.map((n) => n.articulation ?? 'none'))];
const keyOf = (a: string): string => { const k = caps.articulations.find((x) => x.articulation === a); return k?.keyMidi !== undefined && k?.keyMidi !== null ? `MIDI ${k.keyMidi}` : 'no key'; };
const R: string[] = [];
R.push('# Strings V1 — Stage 5: the Cello as a fourth voice', '', `Audition package for **${template} / ${fixture} / seed ${seed} / take ${take}**. Eight MIDI files exported through the shipped UVI Orchestral Suite profile (format 1, ${parseMidi(Buffer.from(files[0].data)).header.ticksPerBeat} ticks per beat). Nothing in this package was listened to before it was sent; it is for you to judge.`, '',
  '## What is Stage 4 and what is Stage 5', '',
  '- **Stage 4** files are the accepted three-voice state: Violin I, Violin II and Viola composed by Strings V1; the Cello is still the classic part. They are rebuilt here and compared byte for byte with the package you auditioned.',
  '- **Stage 5** files differ from Stage 4 in **one track only: the Cello**. Violin I, Violin II and Viola are the same notes and controllers.',
  `- Double Bass: ${cello.doubleBass.trackId ? `the classic desk (${cello.doubleBass.notes} notes) is in the full files, unchanged` : 'this band (Chamber) has no Double Bass track; none was created and none is in any file'}.`, '',
  '## Suggested order', '',
  '| # | file | what it is | SHA-1 |', '|---|---|---|---|');
for (const f of files) R.push(`| ${f.file.split('__')[1].split('_')[0]} | \`${f.file}\` | ${f.what} | \`${sha1(f.data)}\` |`);
R.push('',
  '1. Files 1–3: the three accepted voices alone, as a reminder.',
  '2. File 4: the Cello alone — does it stand as a line of its own?',
  '3. File 5, then file 6: the same passage without and with the Cello.',
  '4. File 7, then file 8: the full arrangement with the classic Cello, then with the composed one.', '',
  '## Tracks and channels', '',
  `| track | channel | voice |`, '|---|---|---|',
  `| Violin I | ${channelOf(violinOne)} | ${who(violinOne)} |`,
  `| Violin II | ${channelOf(violinTwo)} | ${who(violinTwo)} |`,
  `| Viola | ${channelOf(violaId)} | third voice (Stage 4) |`,
  `| Cello | ${channelOf(celloId)} | fourth voice (Stage 5) |`, '',
  `**The theme is carried by ${themeName}.**`, '',
  '## Keyswitches and controllers on the Cello channel', '',
  `Keyswitch zone per the profile: MIDI ${zone?.low}–${zone?.high}; lowest playable note MIDI ${caps.playableLow}. Strokes this file uses: ${strokesUsed.map((a) => `${a} (${keyOf(a)})`).join(', ')}. Keyswitch notes are sent at velocity 100 shortly before the note they apply to.`, '',
  ...keySequence.map((x) => `- ${x}`), '',
  `Read back from file 4: ${readback[0] ?? '—'}.`, '',
  '**Unverified:** the keys, the zone and the playable range are what the export profile states. They were not checked against the UVI patch in this stage; every articulation is marked "not auditioned" in the capability table. If the Cello sounds wrong in a way that looks like a wrong key, that is the first thing to suspect.', '',
  '## What the Cello does in this case', '');
if (cello.plan) {
  R.push('| bars | role | what it plays |', '|---|---|---|');
  for (const s of cello.plan.spans) {
    const w = cello.writing.find((x) => x.span === s.index);
    R.push(`| ${at(s.startTick)} – ${at(s.endTick)} | ${s.role} | ${w?.played ? w.material ?? 'plays' : `silent — ${w?.decision ?? ''}`} |`);
  }
}
R.push('', `Thematic entries: ${cello.thematic.length ? cello.thematic.map((t) => `${at(t.startTick)} (${t.kind})`).join(', ') : 'none'}. Details, every note against the other voices, the review and the measurements are in \`${tag}__evidence.md\`.`, '',
  '## Comparison with the Stage 4 package', '',
  `${keptCompared} Stage 4 files compared with the kept Stage 4 record, ${keptSame} byte-identical.`, '');
writeFileSync(path.join(out, 'README.md'), `${R.join('\n')}\n`);

console.log(`written ${files.length} MIDI files, ${tag}__evidence.md and README.md to ${out}`);
console.log(`Stage 4 files compared with the kept record: ${keptCompared}, identical: ${keptSame}`);
for (const f of files) console.log(`${sha1(f.data)}  ${f.data.length}  ${f.file}`);
