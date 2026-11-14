/**
 * Strings V1, Stage 4 — audition material and evidence for the Viola as a
 * third voice.
 *
 *   npx vite-node scripts/strings-v1-stage4-audition.ts [template] [fixture] [seed] [take]
 *   (defaults: chamber dorian-16bars 1 0; STRINGS_V1_OUT=<dir> changes the output folder)
 *
 * Composes the case through the ordinary production path (classic, and
 * Strings V1) and writes seven numbered MIDI files through the shipped UVI
 * export profile, plus evidence.md. "Stage 3" here means: the V1
 * arrangement with the Viola track put back to its classic part — which is
 * exactly what Stage 3 produced. Where the kept Stage 3 record
 * (evaluation/strings-v1-stage3/audition) holds the same case, every Stage 3
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
import { VIOLA, VIOLA_LINE_CELLS, VIOLA_PULSE_CELLS } from '../src/orchestrator/strings/characters/viola';
import type { StringsV1Composition } from '../src/orchestrator/strings/composition';
import type { StringsV1Ensemble } from '../src/orchestrator/strings/ensemble/compose';
import { intervalName, soundingPitch } from '../src/orchestrator/strings/ensemble/counterpoint';
import type { StringsV1ThirdVoice } from '../src/orchestrator/strings/ensemble/third';
import { composeStringCell, type StringFixtureKey, type StringTemplateKey } from '../tests/strings-v1-support';

const template = (process.argv[2] ?? 'chamber') as StringTemplateKey;
const fixture = (process.argv[3] ?? 'dorian-16bars') as StringFixtureKey;
const seed = Number(process.argv[4] ?? 1);
const take = Number(process.argv[5] ?? 0);
const out = process.env.STRINGS_V1_OUT ?? path.join(process.cwd(), 'evaluation', 'strings-v1-stage4', 'audition');
const stage3Dir = path.join(process.cwd(), 'evaluation', 'strings-v1-stage3', 'audition');
const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const name = (pitch: number): string => `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
const sha1 = (data: Uint8Array): string => createHash('sha1').update(data).digest('hex');

const cell = { template, fixture, seed, take };
const classic = composeStringCell(cell, 'classic');
const v1 = composeStringCell(cell, 'v1');
const diagnostics = (v1.result as unknown as { stringsDiagnostics: { v1: { composition: StringsV1Composition; ensemble: StringsV1Ensemble; viola: StringsV1ThirdVoice } } }).stringsDiagnostics.v1;
const { composition, ensemble, viola } = diagnostics;
const tag = `${template}-${fixture}-seed${seed}-take${take}`;
if (!composition.written || !composition.trackId || !composition.frame || !ensemble.written || !ensemble.companion || !viola.viola) {
  console.error(`nothing to audition: first voice ${composition.written}, second voice ${ensemble.written} (${ensemble.reason}), Viola: ${viola.reason}`);
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
const firstId = composition.trackId;
const secondId = ensemble.companion.trackId;
const themeName = ensemble.primary!.name;
const otherName = ensemble.companion.name;
const violinOne = [firstId, secondId].find((id) => v1.result.tracks.find((t) => t.id === id)?.role === 'violins1')!;
const violinTwo = [firstId, secondId].find((id) => id !== violinOne)!;

// The folder evaluation/strings-v1-stage4/audition is the kept Stage 4 record (it was auditioned): never written again.
if (path.resolve(out) === path.resolve(process.cwd(), 'evaluation', 'strings-v1-stage4', 'audition') && existsSync(out)) {
  console.error('evaluation/strings-v1-stage4/audition is the kept Stage 4 record and is not overwritten. Set STRINGS_V1_OUT to another folder; scripts/strings-v1-stage5-audition.ts rebuilds the Stage 4 files and compares them with that record byte for byte.');
  process.exit(1);
}
// Stage 4 = the V1 result with the Cello track as classic left it (since Stage 5 the V1 result also carries a
// composed Cello). Stage 3 = the same with the Viola track as classic left it, too.
const stage5CelloId = (v1.result as unknown as { stringsDiagnostics: { v1: { cello?: { written: boolean; cello: { trackId: string } | null } | null } } }).stringsDiagnostics.v1.cello;
const classicCelloTrack = stage5CelloId?.written && stage5CelloId.cello ? classic.result.tracks.find((t) => t.id === stage5CelloId.cello!.trackId) : undefined;
const stage4Tracks = v1.result.tracks.map((t) => (classicCelloTrack && t.id === classicCelloTrack.id ? classicCelloTrack : t));
const classicViola = classic.result.tracks.find((t) => t.id === violaId)!;
const stage3Tracks = stage4Tracks.map((t) => (t.id === violaId ? classicViola : t));
const stage4: Project = { ...v1.project, tracks: stage4Tracks };
const stage3: Project = { ...v1.project, tracks: stage3Tracks };
const only = (tracks: Track[], ids: readonly string[]): Track[] => playable(tracks).filter((t) => ids.includes(t.id));

const files: { file: string; data: Uint8Array; what: string; stage3File: string | null }[] = [];
const put = (file: string, data: Uint8Array, what: string, stage3File: string | null = null): void => {
  writeFileSync(path.join(out, `${tag}__${file}`), data);
  files.push({ file: `${tag}__${file}`, data, what, stage3File });
};
const s3 = (suffix: string): string => `${tag}__${suffix}`;
const slugOf = (id: string): string => (id === violinOne ? 'violini' : 'violinii');
put('1_stage3_violin-i-alone__uvi.mid', buildPerTrackMidi(stage3, only(stage3Tracks, [violinOne]), PROFILE)[0].data, `Stage 3: Violin I alone (${violinOne === firstId ? 'carries the theme' : 'the second voice'})`, s3(`${violinOne === firstId ? '3' : '2'}_stage3-v1_${slugOf(violinOne)}-alone__uvi.mid`));
put('2_stage3_violin-ii-alone__uvi.mid', buildPerTrackMidi(stage3, only(stage3Tracks, [violinTwo]), PROFILE)[0].data, `Stage 3: Violin II alone (${violinTwo === firstId ? 'carries the theme' : 'the second voice'})`, s3(`${violinTwo === firstId ? '3' : '2'}_stage3-v1_${slugOf(violinTwo)}-alone__uvi.mid`));
if (viola.written) put('3_stage4_viola-alone__uvi.mid', buildPerTrackMidi(stage4, only(stage4Tracks, [violaId]), PROFILE)[0].data, 'Stage 4: the new Viola alone');
put('4_stage3_two-violins__uvi.mid', buildMergedMidi(stage3, only(stage3Tracks, [violinOne, violinTwo]), PROFILE), 'Stage 3: the two violins together, nothing else', s3('4_stage3-v1_both-violins__uvi.mid'));
if (viola.written) put('5_stage4_three-voices__uvi.mid', buildMergedMidi(stage4, only(stage4Tracks, [violinOne, violinTwo, violaId]), PROFILE), 'Stage 4: Violin I, Violin II and the new Viola, nothing else');
put('6_stage3_full__uvi.mid', buildMergedMidi(stage3, playable(stage3Tracks), PROFILE), 'Stage 3: the full arrangement (two composed violins; Viola, Cello and everything else classic)', s3('6_stage3-v1_full__uvi.mid'));
put('7_stage4_full__uvi.mid', buildMergedMidi(stage4, playable(stage4Tracks), PROFILE), 'Stage 4: the full arrangement (two composed violins and the composed Viola; Cello and everything else classic)');

/* ---------------- evidence ---------------- */
const L: string[] = [];
L.push(`# Strings V1 Stage 4 — the Viola as a third voice: evidence (${tag})`, '', 'Generated by `scripts/strings-v1-stage4-audition.ts`. **Nothing here was listened to.** Every statement below is read from the notes and the export, not from sound.', '');
L.push(`Viola written: **${viola.written}**${viola.reason ? ` — ${viola.reason}` : ''}`, '');
L.push(`Theme (first voice, Stage 2): **${themeName}** (\`${firstId}\`). Second voice (Stage 3): **${otherName}** (\`${secondId}\`). Third voice (Stage 4): **Viola** (\`${violaId}\`).`, '');

L.push('## 1. Files', '', '| file | bytes | SHA-1 | content | same bytes as the kept Stage 3 file |', '|---|---|---|---|---|');
for (const f of files) {
  let same = '— (new in Stage 4)';
  if (f.stage3File) {
    const kept = path.join(stage3Dir, f.stage3File);
    same = existsSync(kept) ? (Buffer.compare(readFileSync(kept), Buffer.from(f.data)) === 0 ? `**yes** — \`${f.stage3File}\`` : `**NO** — differs from \`${f.stage3File}\``) : 'no kept Stage 3 file for this case';
  }
  L.push(`| \`${f.file}\` | ${f.data.length} | \`${sha1(f.data)}\` | ${f.what} | ${same} |`);
}
const stripViola = (tracks: Track[]): string => JSON.stringify(tracks.filter((t) => t.id !== violaId));
L.push('', `- every track of the Stage 4 arrangement except the Viola equals the Stage 3 arrangement (notes and controllers): **${stripViola(stage4Tracks) === stripViola(stage3Tracks)}** (by construction: Stage 3 here is Stage 4 with the classic Viola put back)`,
  `- every track except the two violins and the Viola equals the classic arrangement: **${JSON.stringify(stage4Tracks.filter((t) => ![firstId, secondId, violaId].includes(t.id))) === JSON.stringify(classic.result.tracks.filter((t) => ![firstId, secondId, violaId].includes(t.id)))}**`,
  `- composing the same case a second time gives the same tracks: **${JSON.stringify(composeStringCell(cell, 'v1').result.tracks.map((t) => (classicCelloTrack && t.id === classicCelloTrack.id ? classicCelloTrack : t))) === JSON.stringify(stage4Tracks)}**`, '');

/* instrument facts */
const caps = buildInstrumentCapabilities('viola');
const part = (PROFILE as unknown as { parts: Record<string, { channel?: number; keyswitches?: Record<string, unknown>; playableLow?: number; keyswitchZone?: { low: number; high: number } }> }).parts;
L.push('## 2. The instrument, as the shipped export profile describes it', '',
  `Read from \`src/export/profiles/uvi-orchestral-suite.json\` through \`buildInstrumentCapabilities('viola')\`. None of it was checked against the UVI patch itself.`, '',
  '```json', JSON.stringify(caps, null, 1), '```', '',
  `Raw profile part: \`${JSON.stringify(Object.entries(part).find(([k]) => /viola/i.test(k)) ?? null)}\``, '',
  `Written range used by the Viola voice: ${name(viola.viola.range[0])}–${name(viola.viola.range[1])} (MIDI ${viola.viola.range[0]}–${viola.viola.range[1]}); singing register ${name(viola.viola.singing[0])}–${name(viola.viola.singing[1])}. Strokes the roles ask for and the export can trigger with a keyswitch of this instrument's own: ${viola.viola.triggerable.join(', ')}.`, '');

/* character */
L.push('## 3. The Viola\'s character (`characters/viola.ts`)', '',
  `- below ${name(VIOLA.slowBelow)} quick notes are discouraged (the low string speaks slowly); above ${name(VIOLA.foregroundAbove)} only in the foreground; plucked notes no higher than ${name(VIOLA.pulseCeiling)}`,
  `- at least ${VIOLA.clearance} semitones under the lowest violin note sounding with it; a part needs ${VIOLA.minRoom} semitones of room or the Viola is silent`,
  `- bowed notes for more than ${VIOLA.maxUnbrokenBeats} beats without a rest are penalised (more than ${VIOLA.maxUnbrokenBeats + 4} is a review finding); ${VIOLA.arcoPreparationBeats} beat of rest between a plucked and a bowed note`,
  `- loudness relative to a leading voice (MIDI velocity): ${Object.entries(VIOLA.level).filter(([k]) => k !== 'tacet').map(([k, v]) => `${k} ${v}`).join(', ')}`,
  `- stroke per role: ${Object.entries(VIOLA.articulation).map(([k, v]) => `${k} → ${v}`).join(', ')}`,
  `- bowed rhythms: ${VIOLA_LINE_CELLS.map((c) => c.name).join('; ')}; plus the theme's own rhythms (its close; its close and its opening a beat late)`,
  `- plucked rhythms: ${VIOLA_PULSE_CELLS.map((c) => `${c.name}${c.grounded ? ' [grounded]' : ''}`).join('; ')}`, '');

if (viola.plan) {
  L.push('## 4. The plan (made from both violins, before any Viola note existed)', '', '| # | from | to | role | first voice here | second voice here | room: highest note allowed | lowest string voice | asked of the Viola | rule |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const s of viola.plan.spans) L.push(`| ${s.index + 1} | ${at(s.startTick)} | ${at(s.endTick)} | **${s.role}** | ${s.firstVoice} | ${s.secondVoice} | ${s.ceiling === null ? '—' : name(s.ceiling)} | ${s.lowestString ? 'yes' : 'no'} | ${s.intention} | ${s.reason} |`);
  L.push('', '## 5. What the Viola decided, stretch by stretch', '');
  for (const s of viola.plan.spans) {
    const w = viola.writing.find((x) => x.span === s.index);
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

const F = viola.firstLine;
const S = viola.secondLine;
const sounding = (line: typeof F, tick: number) => line.find((p) => p.tick <= tick && p.tick + p.duration > tick);
L.push('## 6. Every Viola note against both violins', '', `| stretch | role | where | note | MIDI | beats | velocity | stroke | function | ${themeName} sounding | interval | ${otherName} sounding | interval | begins with | shaping |`, '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const w of viola.voiceNotes) {
  const n = w.source;
  const a = sounding(F, n.tick);
  const b = sounding(S, n.tick);
  const withWhom = [F.some((p) => p.tick === n.tick) ? themeName : null, S.some((p) => p.tick === n.tick) ? otherName : null].filter(Boolean).join(' + ') || '—';
  L.push(`| ${n.span + 1} | ${n.role} | ${at(n.tick)} | ${name(w.note.pitch)} | ${w.note.pitch} | ${beatsOf(w.note.durationTicks)} | ${w.note.velocity} | ${w.note.articulation} | ${n.function} | ${a ? name(pitch(a)) : '—'} | ${a ? intervalName(pitch(a) - w.note.pitch) : ''} | ${b ? name(pitch(b)) : '—'} | ${b ? intervalName(pitch(b) - w.note.pitch) : ''} | ${withWhom} | ${w.shaping.join('; ')} |`);
}
L.push('');

const facts = viola.review.facts;
if (facts) {
  const pair = (label: string, p: typeof facts.withFirst): string => `- with ${label}: ${p.sharedOnsets} Viola notes begin together with one of its notes; motion — contrary ${p.motion.contrary}, oblique ${p.motion.oblique}, similar ${p.motion.similar}, parallel ${p.motion.parallel}; sounding together (beats) — thirds and sixths ${p.together.thirdsAndSixths}, fourths/fifths/octaves ${p.together.fifthsAndOctaves} (of which unisons and octaves ${p.together.unisonsAndOctaves}), seconds/sevenths/tritones ${p.together.dissonant}; same rhythm in ${p.rhythm.sameRhythm} of ${p.rhythm.barsTogether} bars where both play`;
  L.push('## 7. Three voices, measured (counts, not a verdict)', '',
    `- notes: ${themeName} ${facts.notes.first}, ${otherName} ${facts.notes.second}, Viola ${facts.notes.viola} (${facts.notes.bowed} bowed, ${facts.notes.plucked} plucked)`,
    `- beats (of ${facts.beats.total}): the Viola sounds in ${facts.beats.violaSounds}, is silent in ${facts.beats.violaSilent}; all three voices sound in ${facts.beats.allThree}; the Viola without either violin in ${facts.beats.violaAlone}`,
    `- beats per role: ${Object.entries(facts.roleBeats).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `- Viola note beginnings: ${facts.onsets.alone} alone, ${facts.onsets.withOne} together with one violin, ${facts.onsets.withBoth} together with both`,
    pair(themeName, facts.withFirst), pair(otherName, facts.withSecond),
    `- registers (lowest–highest): ${themeName} ${facts.registers.first ? `${name(facts.registers.first[0])}–${name(facts.registers.first[1])}` : '—'}, ${otherName} ${facts.registers.second ? `${name(facts.registers.second[0])}–${name(facts.registers.second[1])}` : '—'}, Viola ${facts.registers.viola ? `${name(facts.registers.viola[0])}–${name(facts.registers.viola[1])}` : '—'}; nearest the Viola comes to a violin sounding with it: ${facts.nearestViolin} semitones`, '');
}
L.push('## 8. Review of the three voices', '');
for (const p of viola.review.passes) L.push(`- pass ${p.pass}: ${p.findings.length} finding(s)${p.findings.length ? ` — ${p.findings.map((f) => `${f.kind} (${f.text})`).join('; ')}` : ''}${p.action ? `. Action: ${p.action}` : ''}`);
L.push('', viola.review.unresolved.length ? `**Unresolved after the last pass: ${viola.review.unresolved.length}**` : '**Unresolved after the last pass: none by the rules the review knows.** That is a statement about those rules, not about how it sounds.', '');

/* classic viola it replaced */
const describe = (notes: readonly Note[]): string => notes.map((n) => `${at(Math.round(n.startTick / (beat / 4)) * (beat / 4)).replace('bar ', '').replace(' beat ', '.')}:${name(n.pitch)}`).join(' ');
L.push('## 9. The classic Viola part it replaced', '', `${viola.replacedClassicNotes.length} notes (${[...new Set(viola.replacedClassicNotes.map((n) => n.articulation ?? 'none'))].join(', ')}): ${describe(viola.replacedClassicNotes)}`, '', `Stage 4 Viola: ${viola.notes.length} notes (${[...new Set(viola.notes.map((n) => n.articulation ?? 'none'))].join(', ')}).`, '');

/* export read-back */
L.push('## 10. Export read-back', '');
const zone = caps.keyswitchZone;
for (const f of files) {
  const parsed = parseMidi(Buffer.from(f.data));
  const rows: string[] = [];
  for (const t of parsed.tracks) {
    let trackName = '';
    let channel: number | null = null;
    const ons: number[] = [];
    const ccs = new Map<number, number>();
    let programs = 0;
    for (const e of t) {
      if (e.type === 'trackName') trackName = e.text;
      if (e.type === 'noteOn' && e.velocity > 0) { ons.push(e.noteNumber); channel = e.channel + 1; }
      if (e.type === 'controller') ccs.set(e.controllerType, (ccs.get(e.controllerType) ?? 0) + 1);
      if (e.type === 'programChange') programs++;
    }
    if (!ons.length) continue;
    const isViola = /viola/i.test(trackName);
    const inZone = zone && isViola ? ons.filter((p) => p >= zone.low && p <= zone.high) : [];
    const music = zone && isViola ? ons.filter((p) => p > zone.high) : ons;
    rows.push(`  - "${trackName}" ch ${channel}: ${ons.length} note-ons${isViola ? `, of which ${inZone.length} in the keyswitch zone (${[...new Set(inZone)].sort((x, y) => x - y).map((p) => `${p}`).join(', ') || 'none'}) and ${music.length} musical notes (${name(Math.min(...music))}–${name(Math.max(...music))}, MIDI ${Math.min(...music)}–${Math.max(...music)})` : ''}; controllers ${[...ccs.entries()].map(([k, v]) => `CC${k}×${v}`).join(', ') || 'none'}; program changes ${programs}`);
  }
  L.push(`- \`${f.file}\`: format ${parsed.header.format}, ${parsed.header.ticksPerBeat} ticks per beat`, ...rows);
}
L.push('');
// keyswitch sequence of the viola file
const violaFile = files.find((f) => f.file.includes('3_stage4_viola-alone'));
if (violaFile && zone) {
  const parsed = parseMidi(Buffer.from(violaFile.data));
  const seq: string[] = [];
  for (const t of parsed.tracks) { let abs = 0; for (const e of t) { abs += e.deltaTime; if (e.type === 'noteOn' && e.velocity > 0 && e.noteNumber >= zone.low && e.noteNumber <= zone.high) seq.push(`${at(abs)} (tick ${abs}): MIDI ${e.noteNumber}, velocity ${e.velocity}`); } }
  L.push('Keyswitch notes in the Viola file, in order:', '', ...seq.map((x) => `- ${x}`), '');
  const musical = viola.notes.map((n) => n.pitch);
  L.push(`Viola musical notes: lowest MIDI ${Math.min(...musical)} (${name(Math.min(...musical))}), highest MIDI ${Math.max(...musical)} (${name(Math.max(...musical))}); keyswitch zone MIDI ${zone.low}–${zone.high}; musical notes inside the zone: **${musical.filter((p) => p >= zone.low && p <= zone.high).length}**; below the profile's playable low (${caps.playableLow}): **${musical.filter((p) => caps.playableLow !== null && p < caps.playableLow).length}**.`, '');
}

/* roll */
const rollNotes: [string, readonly Note[]][] = [['1', only(stage4Tracks, [violinOne])[0]?.notes ?? []], ['2', only(stage4Tracks, [violinTwo])[0]?.notes ?? []], ['V', viola.voiceNotes.map((w) => w.note)]];
const all = rollNotes.flatMap(([, n]) => n);
if (all.length) {
  const half = beat / 2;
  const cols = Math.ceil(Math.max(...all.map((n) => n.startTick + n.durationTicks)) / half);
  const perBar = bar / half;
  L.push('## 11. The three voices on one roll', '', 'One column = half a beat. `1` / `2` / `V` = Violin I / Violin II / Viola begins (lower case `v` = plucked); `-` = held; `#` = two voices on the same pitch.', '', '```');
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
        if (n) hits.push(Math.round(n.startTick / half) === c ? (mark === 'V' && n.articulation === 'pizz' ? 'v' : mark) : '-');
      }
      row += hits.length > 1 ? '#' : hits[0] ?? '.';
    }
    if (/[12Vv#-]/.test(row.slice(5))) L.push(row);
  }
  L.push('```', '');
}
writeFileSync(path.join(out, `${tag}__evidence.md`), `${L.join('\n')}\n`);
console.log(`written ${files.length} MIDI files and ${tag}__evidence.md to ${out}`);
for (const f of files) console.log(`${sha1(f.data)}  ${f.data.length}  ${f.file}`);
