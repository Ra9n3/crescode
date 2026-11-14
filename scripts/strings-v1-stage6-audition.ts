/**
 * Strings V1, Stage 6 — audition material and evidence for the Double Bass
 * as a fifth voice.
 *
 *   npx vite-node scripts/strings-v1-stage6-audition.ts
 *   npx vite-node scripts/strings-v1-stage6-audition.ts <template> <fixture> <seed> <take>   (one case only)
 *   (STRINGS_V1_OUT=<dir> changes the output folder; STRINGS_V1_COVERAGE=0 skips the coverage table)
 *
 * Composes each case through the ordinary production path (classic, and
 * Strings V1) and writes, per case, up to ten numbered MIDI files through
 * the shipped UVI export profile plus evidence.md; then README.md and
 * coverage.md for the package.
 *
 * "Stage 5" here means: the V1 arrangement with the Double Basses desk put
 * back to its classic part — which is exactly what Stage 5 produced, since
 * Stage 6 changes nothing but that desk. Where the kept Stage 4 and Stage 5
 * records (evaluation/strings-v1-stage{4,5}/audition) hold the same case,
 * the rebuilt files are compared with them byte for byte and the result is
 * stated; those folders are only read.
 *
 * It renders no audio and makes no statement about how anything sounds.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseMidi } from 'midi-file';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type CcLane, type Note, type Project, type Track } from '../src/shared/schema';
import { buildInstrumentCapabilities } from '../src/orchestrator/strings/characters/capabilities';
import { DOUBLE_BASS } from '../src/orchestrator/strings/characters/double-bass';
import { intervalName, soundingPitch } from '../src/orchestrator/strings/ensemble/counterpoint';
import { DOUBLE_BASS_CC_LEVEL, DOUBLE_BASS_GESTURE_DEPTH } from '../src/orchestrator/strings/ensemble/fifth';
import { FIFTH_AGAINST, FIFTH_VOICE_NAMES, type FifthAgainst, type Heard } from '../src/orchestrator/strings/ensemble/fifth-hearing';
import { DOUBLE_BASS_MONOTONY_BARS, DOUBLE_BASS_SHADOWING_SHARE, DOUBLE_BASS_UNISON_SHARE } from '../src/orchestrator/strings/ensemble/fifth-review';
import { STRING_FIXTURES, STRING_TEMPLATES, composeStringCell, type StringCell, type StringFixtureKey, type StringTemplateKey } from '../tests/strings-v1-support';

const out = process.env.STRINGS_V1_OUT ?? path.join(process.cwd(), 'evaluation', 'strings-v1-stage6', 'audition');
const stage4Dir = path.join(process.cwd(), 'evaluation', 'strings-v1-stage4', 'audition');
const stage5Dir = path.join(process.cwd(), 'evaluation', 'strings-v1-stage5', 'audition');
const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const caps = buildInstrumentCapabilities('doubleBass');
const zone = caps.keyswitchZone!;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Note names with middle C = C4 (MIDI 60), as in the earlier evidence. UVI's own key labels call MIDI 60 "C3"; MIDI numbers are always given beside the names. */
const name = (pitch: number): string => `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
const sha1 = (data: Uint8Array): string => createHash('sha1').update(data).digest('hex');
const playable = (tracks: readonly Track[]): Track[] => tracks.filter((t) => isInstrumentTrack(t) && t.notes.length > 0);
type Playing = Track & { notes: Note[]; cc: CcLane[] };

const CASES: StringCell[] = process.argv[2]
  ? [{ template: process.argv[2] as StringTemplateKey, fixture: (process.argv[3] ?? 'dorian-16bars') as StringFixtureKey, seed: Number(process.argv[4] ?? 1), take: Number(process.argv[5] ?? 0) }]
  : [
    { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0 },
    { template: 'symphony', fixture: 'dorian-16bars', seed: 1, take: 0 },
    { template: 'cinematic', fixture: 'dorian-16bars', seed: 1, take: 1 },
    { template: 'hybridstudio', fixture: 'dorian-16bars', seed: 1, take: 0 },
  ];
mkdirSync(out, { recursive: true });

interface CaseSummary { tag: string; cell: StringCell; written: boolean; reason: string | null; files: { file: string; data: Uint8Array; what: string }[]; themeOn: string; kept: string[]; roles: string; notes: number; channel: string; plan: string[]; item: Record<string, string | null> }
const summaries: CaseSummary[] = [];

for (const cell of CASES) {
  const tag = `${cell.template}-${cell.fixture}-seed${cell.seed}-take${cell.take}`;
  const dir = path.join(out, tag);
  mkdirSync(dir, { recursive: true });
  const classic = composeStringCell(cell, 'classic');
  const v1 = composeStringCell(cell, 'v1');
  const context = v1.result.stringsDiagnostics.v1!;
  const { composition, ensemble, viola, cello } = { composition: context.composition!, ensemble: context.ensemble!, viola: context.viola!, cello: context.cello! };
  const bass = context.doubleBass!;
  if (!composition.written || !ensemble.written || !viola.written || !cello.written) {
    console.error(`${tag}: nothing to audition — the four upper voices are not all composed (Cello: ${cello.reason})`);
    continue;
  }
  const frame = { ...composition.frame!, harmony: context.understanding.harmony };
  const bar = frame.barTicks;
  const beat = frame.beatTicks;
  const at = (tick: number): string => `bar ${Math.floor(tick / bar) + 1} beat ${Math.round(((tick % bar) / beat + 1) * 100) / 100}`;
  const beats = (ticks: number): number => Math.round((ticks / beat) * 100) / 100;
  const firstId = composition.trackId!;
  const secondId = ensemble.companion!.trackId;
  const violaId = viola.viola!.trackId;
  const celloId = cello.cello!.trackId;
  const violinOne = [firstId, secondId].find((id) => v1.result.tracks.find((t) => t.id === id)?.role === 'violins1')!;
  const violinTwo = [firstId, secondId].find((id) => id !== violinOne)!;
  const who = (id: string): string => (id === firstId ? 'carries the theme' : 'the second voice');
  const deskV1 = v1.result.tracks.find((t) => t.role === 'basses') as Playing | undefined;
  const deskClassic = classic.result.tracks.find((t) => t.role === 'basses') as Playing | undefined;
  const deskId = deskV1?.id ?? null;

  // Stage 6 = the V1 result. Stage 5 = the same with the desk as classic left it.
  const stage6Tracks = v1.result.tracks;
  const stage5Tracks = stage6Tracks.map((t) => (deskId && t.id === deskId && deskClassic ? deskClassic : t));
  const stage6: Project = { ...v1.project, tracks: stage6Tracks };
  const stage5: Project = { ...v1.project, tracks: stage5Tracks };
  const only = (tracks: readonly Track[], ids: readonly string[]): Track[] => playable(tracks).filter((t) => ids.includes(t.id));

  const files: { file: string; data: Uint8Array; what: string; kept: [string, string] | null }[] = [];
  const item: Record<string, string | null> = { threeVoices: null, fourVoices: null, bassAlone: null, fiveVoices: null, stage5Full: null, stage6Full: null };
  const put = (file: string, data: Uint8Array, what: string, kept: [string, string] | null = null, key: string | null = null): void => {
    writeFileSync(path.join(dir, `${tag}__${file}`), data);
    files.push({ file: `${tag}__${file}`, data, what, kept: kept ? [kept[0], `${tag}__${kept[1]}`] : null });
    if (key) item[key] = `${tag}__${file}`;
  };
  put('01_violin-i-alone__uvi.mid', buildPerTrackMidi(stage6, only(stage6Tracks, [violinOne]), PROFILE)[0].data, `Violin I alone (${who(violinOne)}) — as accepted`, [stage5Dir, '1_stage4_violin-i-alone__uvi.mid']);
  put('02_violin-ii-alone__uvi.mid', buildPerTrackMidi(stage6, only(stage6Tracks, [violinTwo]), PROFILE)[0].data, `Violin II alone (${who(violinTwo)}) — as accepted`, [stage5Dir, '2_stage4_violin-ii-alone__uvi.mid']);
  put('03_viola-alone__uvi.mid', buildPerTrackMidi(stage6, only(stage6Tracks, [violaId]), PROFILE)[0].data, 'Viola alone — as accepted', [stage5Dir, '3_stage4_viola-alone__uvi.mid']);
  put('04_cello-alone__uvi.mid', buildPerTrackMidi(stage6, only(stage6Tracks, [celloId]), PROFILE)[0].data, 'Cello alone (Stage 5) — as accepted', [stage5Dir, '4_stage5_cello-alone__uvi.mid']);
  if (bass.written && deskId) put('05_stage6_double-bass-alone__uvi.mid', buildPerTrackMidi(stage6, only(stage6Tracks, [deskId]), PROFILE)[0].data, '**Stage 6: the new Double Bass alone**', null, 'bassAlone');
  put('06_stage4_three-voices__uvi.mid', buildMergedMidi(stage6, only(stage6Tracks, [violinOne, violinTwo, violaId]), PROFILE), '**Stage 4 three voices**: Violin I, Violin II, Viola, nothing else', [stage4Dir, '5_stage4_three-voices__uvi.mid'], 'threeVoices');
  put('07_stage5_four-voices__uvi.mid', buildMergedMidi(stage6, only(stage6Tracks, [violinOne, violinTwo, violaId, celloId]), PROFILE), '**Stage 5 four voices**: the three above and the Cello, nothing else', [stage5Dir, '6_stage5_four-voices__uvi.mid'], 'fourVoices');
  if (bass.written && deskId) put('08_stage6_five-voices__uvi.mid', buildMergedMidi(stage6, only(stage6Tracks, [violinOne, violinTwo, violaId, celloId, deskId]), PROFILE), '**Stage 6 five voices**: the four above and the new Double Bass, nothing else', null, 'fiveVoices');
  put('09_stage5_full__uvi.mid', buildMergedMidi(stage5, playable(stage5Tracks), PROFILE), `**Stage 5 full**: the whole arrangement with four composed voices${deskId ? ' and the classic Double Bass (the old split)' : ''}`, [stage5Dir, '8_stage5_full__uvi.mid'], 'stage5Full');
  put('10_stage6_full__uvi.mid', buildMergedMidi(stage6, playable(stage6Tracks), PROFILE), `**Stage 6 full**: the whole arrangement${bass.written ? ' with five composed voices' : ' — this band has no Double Bass, so this is the Stage 5 arrangement'}`, null, 'stage6Full');

  /* ---------------- evidence ---------------- */
  const L: string[] = [];
  L.push(`# Strings V1 Stage 6 — the Double Bass as a fifth voice: evidence (${tag})`, '',
    'Generated by `scripts/strings-v1-stage6-audition.ts`. **Nothing here was listened to.** Every statement below is read from the composed data or from the exported files; none of it says how the passage sounds. Note names use middle C = C4 (MIDI 60); UVI labels the same key C3.', '',
    `Double Bass written: **${bass.written}**${bass.reason ? ` — ${bass.reason}` : ''}`, '',
    `Theme (first voice): **${ensemble.primary!.name}** (\`${firstId}\`). Second voice: **${ensemble.companion!.name}** (\`${secondId}\`). Viola: \`${violaId}\`. Cello: \`${celloId}\`. Double Basses desk: ${deskId ? `\`${deskId}\` ("${deskV1!.name}")` : 'none in this band'}.`, '');

  L.push('## 1. Files', '', '| file | bytes | SHA-1 | content | same bytes as the kept record |', '|---|---|---|---|---|');
  const keptLines: string[] = [];
  for (const f of files) {
    let same = '— (new in Stage 6)';
    if (f.kept) {
      const kept = path.join(f.kept[0], f.kept[1]);
      const label = `${path.basename(path.dirname(f.kept[0]))}/${f.kept[1].split('__').slice(1).join('__')}`;
      if (existsSync(kept)) {
        const equal = Buffer.compare(readFileSync(kept), Buffer.from(f.data)) === 0;
        same = equal ? `**yes** — \`${label}\`` : `**NO** — differs from \`${label}\``;
        keptLines.push(`${f.file.split('__')[1]} vs ${label}: ${equal ? 'identical' : 'DIFFERENT'}`);
      } else same = 'no kept file for this case';
    }
    L.push(`| \`${f.file}\` | ${f.data.length} | \`${sha1(f.data)}\` | ${f.what} | ${same} |`);
  }
  const strip = (tracks: readonly Track[], ids: readonly (string | null)[]): string => JSON.stringify(tracks.filter((t) => !ids.includes(t.id)));
  const again = composeStringCell(cell, 'v1').result.tracks;
  const five = [firstId, secondId, violaId, celloId, deskId];
  L.push('',
    `- every track of the Stage 6 arrangement except the Double Basses desk equals the Stage 5 arrangement (notes and controllers): **${strip(stage6Tracks, [deskId]) === strip(stage5Tracks, [deskId])}** (by construction: Stage 5 is rebuilt here by putting the classic desk back)`,
    `- the composed tracks are what their own stages returned — Violin I/II: **${JSON.stringify((stage6Tracks.find((t) => t.id === firstId) as Playing).notes) === JSON.stringify(composition.notes) && JSON.stringify((stage6Tracks.find((t) => t.id === secondId) as Playing).notes) === JSON.stringify(ensemble.notes)}**, Viola: **${JSON.stringify((stage6Tracks.find((t) => t.id === violaId) as Playing).notes) === JSON.stringify(viola.notes)}**, Cello (notes and controllers): **${JSON.stringify((stage6Tracks.find((t) => t.id === celloId) as Playing).notes) === JSON.stringify(cello.notes) && JSON.stringify((stage6Tracks.find((t) => t.id === celloId) as Playing).cc) === JSON.stringify(cello.cc)}**`,
    `- every track except the composed voices equals the classic arrangement: **${strip(stage6Tracks, five) === strip(classic.result.tracks, five)}**`,
    `- the track list (ids, roles, names, order) equals the classic one — no track added or removed: **${JSON.stringify(stage6Tracks.map((t) => [t.id, t.role, t.name])) === JSON.stringify(classic.result.tracks.map((t) => [t.id, t.role, t.name]))}**`,
    `- composing the same case a second time gives the same tracks: **${JSON.stringify(again) === JSON.stringify(stage6Tracks)}**`, '');

  const summary: CaseSummary = { tag, cell, written: bass.written, reason: bass.reason, files, themeOn: ensemble.primary!.name, kept: keptLines, roles: '', notes: bass.notes.length, channel: '—', plan: [], item };
  summaries.push(summary);

  if (!bass.written || !bass.plan || !deskV1 || !deskClassic) {
    L.push('## 2. The Double Bass', '', `Not written: ${bass.reason}`, '',
      deskId ? 'The desk keeps the classic part.' : 'No track with the role `basses` exists in the classic or in the V1 arrangement of this band; Stage 6 creates none. Files 05 and 08 therefore do not exist for this case, and file 10 has the same bytes as file 09: ' + `**${sha1(files.find((f) => f.file.includes('__09_'))!.data) === sha1(files.find((f) => f.file.includes('__10_'))!.data)}**.`, '');
    writeFileSync(path.join(dir, `${tag}__evidence.md`), `${L.join('\n')}\n`);
    continue;
  }

  const heardOf = (line: readonly { tick: number; duration: number; step: number; alter: number; function: string }[]): Heard[] => line.map((n) => ({ tick: n.tick, duration: n.duration, pitch: soundingPitch(frame, n), chordTone: n.function === 'chord-tone' }));
  const others: Record<FifthAgainst, Heard[]> = { first: heardOf(ensemble.primaryLine), second: heardOf(ensemble.line), viola: heardOf(viola.line), cello: heardOf(cello.line) };
  const soundingAt = (voice: FifthAgainst, tick: number): Heard | undefined => others[voice].find((o) => o.tick <= tick && tick < o.tick + o.duration);
  const facts = bass.review.facts!;
  const instrument = bass.doubleBass!;

  L.push('## 2. The instrument, as the shipped export profile states it', '',
    `- part: "${caps.patch}" (profile \`${caps.profileId}\`, part \`${caps.partId}\`, index ${caps.partIndex}); track role \`${caps.trackRole}\``,
    `- keyswitch zone MIDI ${zone.low}–${zone.high}; lowest playable key MIDI ${caps.playableLow} (${name(caps.playableLow!)}); upper limit: **not stated by the profile**`,
    `- range this stage writes in: MIDI ${instrument.range[0]}–${instrument.range[1]} (${name(instrument.range[0])}–${name(instrument.range[1])}); preferred register MIDI ${DOUBLE_BASS.bestRegister[0]}–${DOUBLE_BASS.bestRegister[1]}`,
    `- strokes with a keyswitch of their own: ${caps.articulations.filter((a) => a.trigger === 'own-keyswitch' || a.articulation === 'sustain').map((a) => `${a.articulation} = MIDI ${a.keyMidi}`).join(', ')}`,
    `- strokes the profile only substitutes (never written by this stage): ${caps.articulations.filter((a) => a.trigger === 'other-articulation' || (a.trigger === 'sustain-default' && a.articulation !== 'sustain')).map((a) => `${a.articulation} → ${a.sounds}`).join(', ')}`,
    `- controllers the export writes: ${caps.controllersWritten.map((c) => `CC${c}`).join(', ')}; lanes the export drops for this part: ${caps.controllersNotWritten.map((c) => `CC${c}`).join(', ') || 'none'}`,
    `- transposition in the profile: ${caps.transposeSemitones}; sounding pitch: **${caps.soundingPitch}**`, '',
    'Not settled by the profile, and not verified against the UVI patch:', '', ...instrument.uncertain.map((u) => `- ${u}`), '');

  L.push('## 3. The plan: one intention per stretch, made together with the other voices', '', '| # | bars | energy | first voice | Cello | Double Bass role | intention | why |', '|---|---|---|---|---|---|---|---|');
  for (const s of bass.plan.spans) L.push(`| ${s.index + 1} | ${at(s.startTick)} – ${at(s.endTick)} | ${s.energy} | ${s.firstVoice} | ${s.cello} | **${s.role}** | ${s.intention} | ${s.reason} |`);
  const planned: Record<string, number> = {};
  for (const s of bass.plan.spans) planned[s.role] = (planned[s.role] ?? 0) + 1;
  L.push('', `Roles planned: ${Object.entries(planned).map(([r, n]) => `${r} ×${n}`).join(', ')}.`, '');

  L.push('## 4. The writing: what each stretch became', '', '| # | planned | written | level | notes | rhythm | decision | passed over while writing |', '|---|---|---|---|---|---|---|---|');
  for (const w of bass.writing) L.push(`| ${w.span + 1} | ${w.role} | ${w.played ? w.wrote : 'silent'} | ${w.level} | ${w.notes.length} | ${w.rhythm.join(', ') || '—'} | ${w.decision} | ${Object.entries(w.rejections).map(([k, n]) => `${k} ×${n}`).join('; ') || '—'} |`);
  L.push('');
  summary.plan = bass.writing.map((w) => `| ${at(bass.plan!.spans[w.span].startTick)} – ${at(bass.plan!.spans[w.span].endTick)} | ${w.role} | ${w.played ? `${w.wrote}: ${w.decision}` : `silent — ${w.decision}`} |`);
  summary.roles = facts.rolesWritten.join(', ');
  if (bass.thematic.length) {
    L.push('### Thematic entries', '');
    for (const t of bass.thematic) L.push(`- ${at(t.tick)}: the first ${t.notesOfHead} of the head's ${t.headLength} notes in notes ${t.factor}× as long. Theme steps ${JSON.stringify(t.themeSteps)}, written steps ${JSON.stringify(t.writtenSteps)}; theme beats ${JSON.stringify(t.themeBeats)}, written beats ${JSON.stringify(t.writtenBeats)}; pitches ${t.pitches.map((p) => `${name(p)} (${p})`).join(', ')}; functions ${t.functions.join(', ')}.`);
    L.push('');
  } else L.push('Thematic entries: none in this case.', '');

  L.push('## 5. Every note, against each of the four voices', '',
    'The columns for the other voices show what sounds in that voice at the moment the Double Bass note begins, and the interval above the Double Bass. `·` = that voice is silent there. `*` = that voice attacks at the same moment.', '',
    '| at | note | MIDI | beats | role | function | stroke | vel | Cello | Viola | second voice | first voice |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  bass.line.forEach((n, i) => {
    const played = bass.notes[i];
    const cellOf = (voice: FifthAgainst): string => { const o = soundingAt(voice, n.tick); return o ? `${name(o.pitch)} ${intervalName(o.pitch - n.pitch)}${o.tick === n.tick ? '*' : ''}` : '·'; };
    L.push(`| ${at(n.tick)} | ${name(n.pitch)} | ${n.pitch} | ${beats(n.duration)} | ${n.role} | ${n.function}${n.themeIndex !== null ? ` (theme ${n.themeIndex + 1})` : ''} | ${played?.articulation ?? '—'} | ${played?.velocity ?? '—'} | ${cellOf('cello')} | ${cellOf('viola')} | ${cellOf('second')} | ${cellOf('first')} |${n.breathAfter ? ' ’' : ''}`);
  });
  L.push('', '’ after a row = the bow is lifted after that note.', '');

  L.push('## 6. The five-voice review', '', `Passes: ${bass.review.passes.length}. Findings left at the end: **${bass.review.unresolved.length}**.`, '');
  for (const p of bass.review.passes) L.push(`- pass ${p.pass}: ${p.findings.length} finding(s)${p.findings.length ? ` — ${p.findings.slice(0, 3).map((f) => `[${f.kind}] ${f.text}`).join('; ')}${p.findings.length > 3 ? '; …' : ''}` : ''}. ${p.action ? `**Action:** ${p.action}` : 'Nothing to answer: the review ends.'}`);
  L.push('', 'The review can only write a Double Bass stretch plainer or leave it silent; it never changes another voice. Thresholds: shadowing above ' + `${DOUBLE_BASS_SHADOWING_SHARE} both ways, unison with the Cello above ${DOUBLE_BASS_UNISON_SHARE} of a stretch (4 beats or more), ${DOUBLE_BASS_MONOTONY_BARS} identical bars in a moving stretch, more than ${DOUBLE_BASS.maxUnbrokenBeats} beats without a lifted bow.`, '',
    '| measurement | value |', '|---|---|',
    `| notes | ${facts.notes} |`,
    `| lowest / highest | ${name(facts.lowest!)} (${facts.lowest}) / ${name(facts.highest!)} (${facts.highest}) |`,
    `| sounding / silent beats | ${facts.soundingBeats} / ${facts.silentBeats} |`,
    `| share of its sounding time in which it is the lowest voice | ${facts.lowestVoiceShare} |`,
    `| chords it attacks at their beginning / of those, on the harmony's own bass | ${facts.chordStartsAttacked} / ${facts.chordStartsOnBass} |`,
    `| passing notes / thematic notes | ${facts.passingNotes} / ${facts.thematicNotes} |`,
    `| roles written | ${facts.rolesWritten.join(', ')} |`,
    `| rhythms | ${facts.rhythms.join(', ')} |`,
    `| longest stretch without a lifted bow (beats) | ${facts.longestUnbrokenBeats} |`,
    `| share of long notes that are an octave under the Cello | ${facts.celloOctaveShare} |`,
    `| parallel octaves with the Cello (counted, allowed: the two bass instruments) | ${facts.parallelOctavesWithCello} |`,
    `| most attacks of the five voices inside one beat | ${facts.mostAttacksInABeat} |`, '',
    '| against | attacks together | same pitch class (share of time) | unison (share of time) | that voice below the Double Bass |', '|---|---|---|---|---|',
    ...FIFTH_AGAINST.map((v) => `| ${FIFTH_VOICE_NAMES[v]} | ${facts.pairs[v].attacksTogether} | ${facts.pairs[v].samePitchClassShare} | ${facts.pairs[v].unisonShare} | ${facts.pairs[v].belowShare} |`), '');
  L.push(`Parallels kept on the harmony's own bass against an inner voice (recorded, not answered — the only other choice is to leave the chord without its bass): ${facts.parallelsOnTheHarmonysBass.length ? '' : '**none**'}`, '', ...facts.parallelsOnTheHarmonysBass.map((t) => `- ${t}`), '');

  L.push('## 7. Range and keyswitch-zone safety', '');
  const pitches = deskV1.notes.map((n) => n.pitch);
  L.push(`- notes on the desk: ${pitches.length}; lowest MIDI ${Math.min(...pitches)}, highest MIDI ${Math.max(...pitches)}`,
    `- notes inside the keyswitch zone (MIDI ${zone.low}–${zone.high}): **${pitches.filter((p) => p >= zone.low && p <= zone.high).length}**`,
    `- notes below the lowest playable key (MIDI ${caps.playableLow}): **${pitches.filter((p) => p < caps.playableLow!).length}**`,
    `- notes outside the written range MIDI ${instrument.range[0]}–${instrument.range[1]}: **${pitches.filter((p) => p < instrument.range[0] || p > instrument.range[1]).length}**`,
    `- notes above the preferred register (MIDI ${DOUBLE_BASS.bestRegister[1]}): ${pitches.filter((p) => p > DOUBLE_BASS.bestRegister[1]).length}`,
    `- for comparison, the classic desk in this case: ${deskClassic.notes.length} notes, MIDI ${Math.min(...deskClassic.notes.map((n) => n.pitch))}–${Math.max(...deskClassic.notes.map((n) => n.pitch))}`, '');

  L.push('## 8. Controllers', '');
  const lane = (lanes: readonly CcLane[], cc: number): CcLane | undefined => lanes.find((l) => l.cc === cc);
  const span = (l: CcLane | undefined): string => (l ? `${l.points.length} points, ${Math.min(...l.points.map((p) => p.value))}–${Math.max(...l.points.map((p) => p.value))}` : 'none');
  L.push(`Own curves: ${bass.expression!.ownLanes.map((c) => `CC${c}`).join(', ')} (base level ${DOUBLE_BASS_CC_LEVEL[0]} at energy 0 to ${DOUBLE_BASS_CC_LEVEL[1]} at energy 1; gesture depth by role: ${Object.entries(DOUBLE_BASS_GESTURE_DEPTH).map(([r, d]) => `${r} ${d}`).join(', ')}). Lanes taken from the shared pass: ${bass.expression!.sharedLanes.map((c) => `CC${c}`).join(', ') || 'none'} (of these the export writes only what the profile lists, see section 9).`, '',
    '| lane | Double Bass (Stage 6) | Cello (Stage 5) | classic desk | same points as the Cello | same points as the classic desk |', '|---|---|---|---|---|---|');
  for (const cc of [1, 11]) L.push(`| CC${cc} | ${span(lane(bass.cc, cc))} | ${span(lane(cello.cc, cc))} | ${span(lane(deskClassic.cc, cc))} | ${JSON.stringify(lane(bass.cc, cc)?.points) === JSON.stringify(lane(cello.cc, cc)?.points)} | ${JSON.stringify(lane(bass.cc, cc)?.points) === JSON.stringify(lane(deskClassic.cc, cc)?.points)} |`);
  L.push('', '| gesture | from | goal | to | role | notes | depth | shape | CC1 at start → goal → end |', '|---|---|---|---|---|---|---|---|---|');
  const cc1 = lane(bass.cc, 1)!;
  const valueAt = (tick: number): number => { let v = cc1.points[0].value; for (const p of cc1.points) { if (p.tick > tick) break; v = p.value; } return v; };
  bass.expression!.gestures.forEach((g, i) => L.push(`| ${i + 1} | ${at(g.startTick)} | ${at(g.goalTick)} | ${at(g.endTick)} | ${g.role} | ${g.notes} | ${g.depth} | ${g.shape} | ${valueAt(g.startTick)} → ${valueAt(g.goalTick)} → ${valueAt(g.endTick)} |`));
  const strokes: Record<string, number> = {};
  for (const n of bass.notes) strokes[n.articulation ?? 'none'] = (strokes[n.articulation ?? 'none'] ?? 0) + 1;
  L.push('', `Velocities: ${Math.min(...bass.notes.map((n) => n.velocity))}–${Math.max(...bass.notes.map((n) => n.velocity))} (${new Set(bass.notes.map((n) => n.velocity)).size} different values). Strokes: ${Object.entries(strokes).map(([a, n]) => `${a} ×${n}`).join(', ')}. Note lengths as written: ${Math.min(...bass.notes.map((n) => beats(n.durationTicks)))}–${Math.max(...bass.notes.map((n) => beats(n.durationTicks)))} beats.`, '');

  L.push('## 9. The exported file, read back', '');
  const readBack = (data: Uint8Array) => {
    const ev = parseMidi(Buffer.from(data)).tracks.flat() as unknown as { type: string; channel?: number; noteNumber?: number; velocity?: number; controllerType?: number; text?: string }[];
    const on = ev.filter((e) => e.type === 'noteOn' && (e.velocity ?? 0) > 0);
    const count = (list: (number | undefined)[]): string => { const m = new Map<number, number>(); for (const x of list) m.set(x!, (m.get(x!) ?? 0) + 1); return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k} ×${n}`).join(', ') || 'none'; };
    return {
      names: [...new Set(ev.filter((e) => e.type === 'trackName').map((e) => e.text))].join(', '),
      channels: [...new Set(ev.filter((e) => e.channel !== undefined).map((e) => e.channel! + 1))].join(', '),
      sounding: on.filter((e) => e.noteNumber! > zone.high).length,
      low: Math.min(...on.filter((e) => e.noteNumber! > zone.high).map((e) => e.noteNumber!)),
      high: Math.max(...on.map((e) => e.noteNumber!)),
      switches: count(on.filter((e) => e.noteNumber! <= zone.high).map((e) => e.noteNumber)),
      controllers: count(ev.filter((e) => e.type === 'controller').map((e) => e.controllerType)),
    };
  };
  const mine = readBack(files.find((f) => f.file.includes('__05_'))!.data);
  const theirs = readBack(buildPerTrackMidi(stage5, only(stage5Tracks, [deskId!]), PROFILE)[0].data);
  summary.channel = mine.channels;
  L.push('| | Stage 6 Double Bass (file 05) | classic desk, same export |', '|---|---|---|',
    `| part name in the file | ${mine.names} | ${theirs.names} |`,
    `| MIDI channel | ${mine.channels} | ${theirs.channels} |`,
    `| sounding notes | ${mine.sounding} (desk holds ${deskV1.notes.length}) | ${theirs.sounding} |`,
    `| lowest / highest sounding key | ${mine.low} / ${mine.high} | ${theirs.low} / ${theirs.high} |`,
    `| keyswitch notes (key ×count) | ${mine.switches} | ${theirs.switches} |`,
    `| controllers (number ×events) | ${mine.controllers} | ${theirs.controllers} |`, '');
  const mergedParts = (project: Project, tracks: readonly Track[]): string[] => parseMidi(Buffer.from(buildMergedMidi(project, playable(tracks), PROFILE))).tracks.map((t) => {
    const list = t as unknown as { type: string; channel?: number; text?: string }[];
    return `${list.find((e) => e.type === 'trackName')?.text}@${[...new Set(list.filter((e) => e.channel !== undefined).map((e) => e.channel! + 1))].join('/')}`;
  }).filter((p) => !p.endsWith('@'));
  const parts6 = mergedParts(stage6, stage6Tracks);
  L.push(`Parts in the full Stage 6 file (name@channel): ${parts6.join(' · ')}`, '',
    `- same parts on the same channels as the Stage 5 full file: **${JSON.stringify(parts6) === JSON.stringify(mergedParts(stage5, stage5Tracks))}**`,
    `- parts named "${caps.patch}": **${parts6.filter((p) => p.startsWith(caps.patch)).length}**`, '');

  L.push('## 10. Hand-off to the existing desk; the old Cello/Bass split', '');
  const composedKeys = new Set(bass.line.map((n) => `${n.tick}:${n.pitch}`));
  const classicKeys = new Set(deskClassic.notes.map((n) => `${n.startTick}:${n.pitch}`));
  const { notes: _a, cc: _b, ...keptDesk } = deskV1 as unknown as Record<string, unknown>;
  const { notes: _c, cc: _d, ...keptClassicDesk } = deskClassic as unknown as Record<string, unknown>;
  L.push(`- the desk is the track the classic pipeline created (\`${deskId}\`); everything about it except notes and controllers equals the classic desk: **${JSON.stringify(keptDesk) === JSON.stringify(keptClassicDesk)}**`,
    `- tracks with the role \`basses\` in the arrangement: **${stage6Tracks.filter((t) => t.role === 'basses').length}**`,
    `- notes on the desk: ${deskV1.notes.length}; of these, composed by Stage 6: **${deskV1.notes.filter((n) => composedKeys.has(`${n.startTick}:${n.pitch}`)).length}**; two notes beginning at the same moment: **${deskV1.notes.length - new Set(deskV1.notes.map((n) => n.startTick)).size}**`,
    `- the old split wrote ${bass.replacedClassicNotes.length} notes onto the desk; they were replaced as a whole. Composed notes that happen to have a classic note's start and pitch: ${deskV1.notes.filter((n) => classicKeys.has(`${n.startTick}:${n.pitch}`)).length} of ${deskV1.notes.length}`,
    `- notes marked for the export to route to another part (\`layer\`): desk **${deskV1.notes.filter((n) => n.layer !== undefined).length}**, Cello **${cello.notes.filter((n) => n.layer !== undefined).length}**`,
    `- the Cello track holds the composed Cello and not the split's cello half: **${JSON.stringify((stage6Tracks.find((t) => t.id === celloId) as Playing).notes) === JSON.stringify(cello.notes)}**`, '');

  L.push('## 11. Limits of this evidence', '',
    '- Nothing was rendered or heard. Keys, zone, range, channel and controllers are the export profile\'s statements and the bytes of the exported file — not a check against the UVI patch itself.',
    `- The upper limit (MIDI ${DOUBLE_BASS.ceiling}) and the floor (MIDI ${DOUBLE_BASS.floor}) are cautious choices; the profile gives no ceiling and allows keys down to MIDI ${caps.playableLow}.`,
    '- Whether the patch sounds an octave below the written key is not stated by the profile. If it does not, the Double Bass sits where the Cello\'s lowest fifth sits and the two will be closer than a real section would be.',
    '- The Cello was composed in Stage 5 against the classic desk and is not composed again; where it was planned "over the Double Bass" it now stands over a different Double Bass. The review checks the new Double Bass against the Cello as written.',
    '- Long held foundation tones are not counted as monotony; only repeated moving bars are.', '');
  writeFileSync(path.join(dir, `${tag}__evidence.md`), `${L.join('\n')}\n`);
}

/* ---------------- coverage ---------------- */
const C: string[] = ['# Strings V1 Stage 6 — template and take coverage', '', 'Every template × fixture, seed 1, takes 0–3, composed through the production path. Read from the composed data; nothing was listened to.', '',
  '| template | fixture | take | Double Bass | notes | range (MIDI) | roles written | review passes | findings left | thematic notes | parallels kept on the harmony\'s bass | upper four voices as their stages returned them |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
let coverageWritten = 0;
let coverageCells = 0;
let coverageUnresolved = 0;
if (process.env.STRINGS_V1_COVERAGE !== '0' && !process.argv[2]) {
  for (const template of STRING_TEMPLATES) for (const fixture of STRING_FIXTURES) for (const take of [0, 1, 2, 3]) {
    const r = composeStringCell({ template, fixture, seed: 1, take }, 'v1').result;
    const context = r.stringsDiagnostics.v1!;
    const b = context.doubleBass;
    coverageCells++;
    const notesOf = (id: string | null | undefined): string => JSON.stringify((r.tracks.find((t) => t.id === id) as Playing | undefined)?.notes ?? null);
    const kept = !context.cello?.written ? '—' : String(notesOf(context.composition!.trackId) === JSON.stringify(context.composition!.notes) && (!context.ensemble!.written || notesOf(context.ensemble!.companion!.trackId) === JSON.stringify(context.ensemble!.notes)) && notesOf(context.viola!.viola!.trackId) === JSON.stringify(context.viola!.notes) && notesOf(context.cello.cello!.trackId) === JSON.stringify(context.cello.notes));
    if (b?.written) {
      coverageWritten++;
      const f = b.review.facts!;
      coverageUnresolved += b.review.unresolved.length;
      C.push(`| ${template} | ${fixture} | ${take} | written | ${f.notes} | ${f.lowest}–${f.highest} | ${f.rolesWritten.join(', ')} | ${b.review.passes.length} | ${b.review.unresolved.length} | ${f.thematicNotes} | ${f.parallelsOnTheHarmonysBass.length} | ${kept} |`);
    } else C.push(`| ${template} | ${fixture} | ${take} | not written: ${b?.reason ?? 'no fifth voice attempted'} | — | — | — | — | — | — | — | ${kept} |`);
  }
  C.push('', `Cells: ${coverageCells}. Double Bass written: ${coverageWritten}. Findings left in written cells: ${coverageUnresolved}.`, '');
  writeFileSync(path.join(out, 'coverage.md'), `${C.join('\n')}\n`);
}

/* ---------------- README ---------------- */
const R: string[] = [];
const ref = summaries[0];
R.push('# Strings V1 — Stage 6: the Double Bass as a fifth voice', '',
  'Audition package. MIDI files exported through the shipped UVI Orchestral Suite profile. **Nothing in this package was listened to before it was sent**; it is for you to judge. What is stated below is read from the composed data and from the bytes of the files.', '',
  '## Read this first: the reference case has no Double Bass', '',
  'The reference case of Stages 2–5 is **Chamber / D Dorian / 16 bars / seed 1 / take 0**. The Chamber band has no Double Bass track, and this stage does not invent one. For that case the package therefore holds the Stage 4 and Stage 5 material again (byte-identical with what you auditioned) and nothing new: Stage 6 full equals Stage 5 full.', '',
  'The Double Bass is in the three bands that have a desk — **Symphony, Cinematic, Hybrid Studio** — on the same piece (D Dorian, 16 bars, seed 1). Those three folders are where to listen. Sonata and Vocal Backing stay classic.', '',
  '## Cases', '', '| folder | Double Bass | theme on | roles written | notes | channel |', '|---|---|---|---|---|---|');
for (const s of summaries) R.push(`| \`${s.tag}/\` | ${s.written ? 'written' : `none — ${s.reason}`} | ${s.themeOn} | ${s.roles || '—'} | ${s.written ? s.notes : '—'} | ${s.channel} |`);
R.push('', '## The six things to compare, per case', '', '| | ' + summaries.map((s) => s.cell.template).join(' | ') + ' |', `|---|${summaries.map(() => '---').join('|')}|`);
const rows: [string, string][] = [['Stage 4 three voices', 'threeVoices'], ['Stage 5 four voices', 'fourVoices'], ['Stage 6 Double Bass alone', 'bassAlone'], ['Stage 6 five voices', 'fiveVoices'], ['Stage 5 full', 'stage5Full'], ['Stage 6 full', 'stage6Full']];
for (const [label, key] of rows) R.push(`| **${label}** | ${summaries.map((s) => (s.item[key] ? `file ${s.item[key]!.split('__')[1].slice(0, 2)}` : '— (no Double Bass)')).join(' | ')} |`);
R.push('', 'In every folder the files are numbered the same way:', '',
  '| # | file | what it is |', '|---|---|---|',
  '| 01–04 | `…__01_violin-i-alone` … `…__04_cello-alone` | the four accepted voices, one track each |',
  '| 05 | `…__05_stage6_double-bass-alone` | **the new Double Bass alone** (not in the Chamber folder) |',
  '| 06 | `…__06_stage4_three-voices` | Violin I, Violin II, Viola |',
  '| 07 | `…__07_stage5_four-voices` | the same with the Cello |',
  '| 08 | `…__08_stage6_five-voices` | the same with the new Double Bass (not in the Chamber folder) |',
  '| 09 | `…__09_stage5_full` | the whole arrangement, Double Bass = the old Cello/Bass split |',
  '| 10 | `…__10_stage6_full` | the whole arrangement, Double Bass = the composed fifth voice |', '',
  'Files 09 and 10 differ in one track only: the Double Bass. Files 07 and 08 differ by that track being added.', '',
  '## Suggested order (in a Symphony, Cinematic or Hybrid Studio folder)', '',
  '1. File 05: the Double Bass alone. Is it a part, with rests and a shape, or a row of roots?',
  '2. File 07, then 08: four voices without and with it. Does it carry the ensemble from below without thickening it, and can it be told from the Cello?',
  '3. File 09, then 10: the full arrangement with the old split, then with the composed part.',
  '4. `cinematic-…-take1`: bars 11–12 — the Double Bass answers with the first three notes of the theme\'s head in notes twice as long. The other two cases planned the same answer and did not write it (the evidence says why).', '',
  '## Loading', '',
  `One part per track; the Double Bass goes to the "${caps.patch}" part on MIDI channel ${summaries.find((s) => s.written)?.channel ?? '—'} (the channel and part the classic Double Bass already used — nothing about the track was changed). Keyswitches per the profile: sustain = MIDI 12, legato = 14, pizzicato = 17, tremolo = 19, marcato = 21 (zone MIDI ${zone.low}–${zone.high}). Controllers written: CC1, CC11 (own curves) and CC7.`, '',
  '**Unverified against the UVI patch:** the keys, the zone, the playable range, and whether the patch sounds at the written key or an octave lower. The profile states no upper limit; nothing above MIDI ' + `${DOUBLE_BASS.ceiling} (${name(DOUBLE_BASS.ceiling)}) or below MIDI ${DOUBLE_BASS.floor} (${name(DOUBLE_BASS.floor)}) is written. If a note sounds like a wrong articulation or does not sound at all, a wrong key is the first thing to suspect.`, '');
for (const s of summaries.filter((x) => x.written)) {
  R.push(`## What the Double Bass does — ${s.cell.template}, take ${s.cell.take}`, '', '| bars | planned | what it plays |', '|---|---|---|', ...s.plan, '');
}
R.push('## Comparison with the kept Stage 4 and Stage 5 packages', '', `Reference case (\`${ref.tag}\`), rebuilt now and compared byte for byte with the kept folders (which were only read):`, '', ...ref.kept.map((k) => `- ${k}`), '',
  'The other cases have no kept record to compare with.', '',
  '## Evidence', '', 'Each folder has `…__evidence.md`: files and hashes, the instrument as the profile states it, the plan and roles, what each stretch became and why, every note against each of the four voices, the review and its findings, range and keyswitch-zone safety, controller output, the exported file read back, the hand-off to the existing desk, and the limits of the evidence. `coverage.md` lists every template × fixture × take 0–3.', '');
writeFileSync(path.join(out, 'README.md'), `${R.join('\n')}\n`);

for (const s of summaries) { console.log(`${s.tag}: Double Bass ${s.written ? 'written' : `not written (${s.reason})`}`); for (const k of s.kept) console.log(`   ${k}`); for (const f of s.files) console.log(`   ${sha1(f.data)}  ${f.data.length}  ${f.file}`); }
if (coverageCells) console.log(`coverage: ${coverageCells} cells, Double Bass written in ${coverageWritten}, findings left ${coverageUnresolved}`);
