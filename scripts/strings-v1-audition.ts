/**
 * Strings V1 audition material and evidence (Stage 2 first voice, Stage 3 second voice).
 *
 *   npx vite-node scripts/strings-v1-audition.ts [template] [fixture] [seed] [take]
 *   (defaults: chamber dorian-16bars 1 0; STRINGS_V1_OUT=<dir> changes the output folder)
 *
 * Composes the same song twice through the ordinary production path —
 * classic strings and Strings V1 — and writes, through the existing export:
 *   - MIDI files (shipped UVI profile, and plain files without keyswitches
 *     that any MIDI player can play);
 *   - evidence.md: the theme, the phrases, the instrument selection, every
 *     note of the voice, a piano-roll view and the comparison with the
 *     classic part it replaced.
 * Stage 3 adds, for the same case and through the same export:
 *   - six numbered files for listening (see section 9 of evidence.md): the
 *     first voice alone as Stage 2 wrote it, each violin alone, both violins,
 *     the classic full arrangement and the Stage 3 full arrangement;
 *   - the two-voice evidence: the relationship planned for every stretch,
 *     why the second voice entered or stayed silent, how each of its notes
 *     stands to the first voice, and what the review found.
 * The default folder is the Stage 3 one; the Stage 2 folder
 * (evaluation/strings-v1-stage2/audition) is the kept Stage 2 record and is
 * only read, to compare the first voice with it byte for byte.
 * It renders no audio and makes no statement about how anything sounds.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseMidi } from 'midi-file';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type Note, type Project, type Track } from '../src/shared/schema';
import type { StringsV1Composition } from '../src/orchestrator/strings/composition';
import type { StringsV1Ensemble } from '../src/orchestrator/strings/ensemble/compose';
import { intervalName, soundingPitch } from '../src/orchestrator/strings/ensemble/counterpoint';
import { COMPANION_WEIGHTS, RELATIONSHIP_LEVEL } from '../src/orchestrator/strings/writers/companion';
import { composeStringCell, isStringTrack, noteKey, type StringFixtureKey, type StringTemplateKey } from '../tests/strings-v1-support';

const template = (process.argv[2] ?? 'chamber') as StringTemplateKey;
const fixture = (process.argv[3] ?? 'dorian-16bars') as StringFixtureKey;
const seed = Number(process.argv[4] ?? 1);
const take = Number(process.argv[5] ?? 0);
const out = process.env.STRINGS_V1_OUT ?? path.join(process.cwd(), 'evaluation', 'strings-v1-stage3', 'audition');
// Since Stage 4 the V1 arrangement also contains the composed Viola, so this script no longer
// reproduces the Stage 3 files. The kept Stage 2 and Stage 3 records are never written over;
// the Stage 4 material is made by scripts/strings-v1-stage4-audition.ts.
if (/strings-v1-stage[23][\\/]audition$/.test(path.resolve(out)) && existsSync(out)) {
  console.error(`refusing to write into the kept record ${out}; set STRINGS_V1_OUT to another folder`);
  process.exit(1);
}
const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const name = (pitch: number): string => `${NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

const cell = { template, fixture, seed, take };
const classic = composeStringCell(cell, 'classic');
const v1 = composeStringCell(cell, 'v1');
const diagnostics = (v1.result as unknown as { stringsDiagnostics: { v1: { composition: StringsV1Composition; ensemble: StringsV1Ensemble } } }).stringsDiagnostics.v1;
const composition = diagnostics.composition;
const ensemble = diagnostics.ensemble;
const tag = `${template}-${fixture}-seed${seed}-take${take}`;
mkdirSync(out, { recursive: true });

const projectWith = (project: Project, tracks: Track[]): Project => ({ ...project, tracks });
const playable = (tracks: Track[]): Track[] => tracks.filter((t) => isInstrumentTrack(t) && t.notes.length > 0);
const files: { file: string; bytes: number; what: string }[] = [];
const write = (file: string, data: Uint8Array, what: string): void => { writeFileSync(path.join(out, file), data); files.push({ file, bytes: data.length, what }); };

for (const [side, run] of [['classic', classic], ['v1', v1]] as const) {
  const project = projectWith(run.project, run.result.tracks);
  const all = playable(run.result.tracks);
  const strings = all.filter(isStringTrack);
  write(`${tag}__${side}__full__uvi.mid`, buildMergedMidi(project, all, PROFILE), `${side}: every track, shipped UVI export profile (keyswitches)`);
  write(`${tag}__${side}__full__plain.mid`, buildMergedMidi(project, all, null), `${side}: every track, no profile (no keyswitches) — for any MIDI player`);
  write(`${tag}__${side}__strings__plain.mid`, buildMergedMidi(project, strings, null), `${side}: string tracks only, no profile`);
  if (composition.trackId) {
    const voice = all.filter((t) => t.id === composition.trackId);
    write(`${tag}__${side}__voice-only__plain.mid`, buildMergedMidi(project, voice, null), `${side}: the selected track alone, no profile`);
    for (const f of buildPerTrackMidi(project, voice, PROFILE)) write(`${tag}__${side}__voice-only__uvi__${f.fileName}`, f.data, `${side}: the selected track alone, per-track UVI export`);
  }
}

/* ---------------- evidence ---------------- */
const L: string[] = [];
const bar = composition.frame?.barTicks ?? 3840;
const beat = composition.frame?.beatTicks ?? 960;
const at = (tick: number): string => `bar ${Math.floor(tick / bar) + 1} beat ${Math.round(((tick % bar) / beat + 1) * 100) / 100}`;
L.push(`# Strings V1 — evidence (${tag})`, '', 'Generated by `scripts/strings-v1-audition.ts`. Nothing here was judged by ear.', '');
L.push(`Voice written: **${composition.written}**${composition.reason ? ` — ${composition.reason}` : ''}`, '');
if (composition.written && composition.theme && composition.selection?.chosen && composition.trackId) {
  const theme = composition.theme;
  const track = v1.result.tracks.find((t) => t.id === composition.trackId)!;
  const octave = composition.octave ?? 0;
  const key = composition.frame!.key;
  const scale = composition.frame!.scale;
  const pitchOf = (n: { step: number; alter: number }): number => 60 + key + 12 * Math.floor(n.step / 7) + scale[((n.step % 7) + 7) % 7] + n.alter + 12 * octave;
  L.push('## 1. Instrument', '', `Chosen: **${composition.selection.chosen.name}** (track \`${composition.trackId}\`, "${track.name}"), line placed ${octave >= 0 ? '+' : ''}${octave} octave(s).`, '', composition.selection.reason, '');
  L.push('| instrument | suitable | line range | in singing register | competing classic tune | another voice within a third | score | classic part it would replace | why not |', '|---|---|---|---|---|---|---|---|---|');
  for (const e of composition.selection.evaluations) L.push(`| ${e.name} | ${e.suitable ? 'yes' : 'no'} | ${e.range ? `${name(e.range[0])}–${name(e.range[1])}` : '—'} | ${Math.round(e.registerFit * 100)}% | ${Math.round(e.competition * 100)}% | ${Math.round(e.masking * 100)}% | ${e.score} | ${e.replaces} | ${e.unsuitable.join('; ') || ''} |`);
  L.push('', '## 2. Theme', '', `Composed over ${theme.home.chords.join(' → ')} (ticks ${theme.home.startTick}–${theme.home.endTick}); ${theme.candidatesJudged} candidates judged.`, '');
  L.push('| # | note | beats | part | function |', '|---|---|---|---|---|');
  theme.notes.forEach((n, i) => L.push(`| ${i + 1} | ${name(pitchOf(n))} | ${n.duration / beat} | ${n.inHead ? 'head' : 'tail'} | ${n.function} |`));
  const id = theme.identity;
  L.push('', `- intervals (scale steps): ${id.intervals.join(', ')} — semitones: ${id.semitoneIntervals.join(', ')}`, `- rhythm (beats): ${id.rhythm.join(', ')}`, `- contour: \`${id.contour}\`; high point on note ${id.apexIndex + 1}`,
    `- characteristic leap: ${id.leap.name}, from note ${id.leap.fromIndex + 1}`,
    `- dissonances: ${id.dissonances.map((d) => `note ${d.index + 1} (${d.kind}) resolves ${d.direction} to note ${d.resolvesToIndex + 1}`).join('; ') || 'none'}`,
    `- mode colour: ${id.colourTone ? `note ${id.colourTone.index + 1} — ${id.colourTone.reason}` : 'not present'}`,
    `- chromatic notes: ${id.chromatic.map((c) => `note ${c.index + 1} (${c.kind})`).join('; ') || 'none'}`,
    `- character: ${id.character}`, `- protected: ${id.protectedFeatures.join('; ')}`, `- preferred: ${id.preferredFeatures.join('; ')}`, '');
  L.push('## 3. Phrases', '');
  for (const p of composition.phrases) {
    L.push(`### Phrase ${p.index + 1}: ticks ${p.startTick}–${p.endTick} (${at(p.startTick)} to ${at(p.endTick)}), ${Math.round(((p.endTick - p.startTick) / bar) * 100) / 100} bars`, '',
      `- window ${p.window.startTick}–${p.window.endTick}; ${p.lifted ? 'stated above the theme\'s home position (more energetic stretch)' : 'stated at the theme\'s home position'}`,
      `- goal: tick ${p.goal.tick} (${at(p.goal.tick)}) on ${p.goal.chord}, ${p.goal.ending} ending — ${p.goal.evidence}`,
      `- high point: tick ${p.climax.tick} (${at(p.climax.tick)})`, `- silence after the last note, inside the window: ${p.breathTicks} ticks`, '', '| landmark tick | where | what |', '|---|---|---|');
    for (const m of p.landmarks) L.push(`| ${m.tick} | ${at(m.tick)} | ${m.label} |`);
    L.push('', '| segment | ticks | fitting | notes moved | preferred features lost | tried before and rejected |', '|---|---|---|---|---|---|');
    for (const s of p.segments) {
      L.push(`| ${s.kind} | ${s.startTick}–${s.endTick} | ${s.description} | ${s.adaptation?.moved.map((m) => `note ${m.index + 1} ${m.how}`).join('; ') || ''} | ${s.adaptation?.preferredLost.join('; ') || ''} | ${s.adaptation?.tried.length ? `${s.adaptation.tried.length} rejected: ${s.adaptation.tried.map((t) => t.split(':')[0]).join(', ')}` : ''} |`);
    }
    L.push('');
  }
  if (composition.silentWindows.length) L.push('Windows left silent:', ...composition.silentWindows.map((w) => `- ${w.startTick}–${w.endTick}: ${w.reason}`), '');
  L.push('## 4. Gestures', '', ...composition.gestures.map((g) => `- ${g}`), '');
  L.push('## 5. Every note of the voice (as written, on the grid)', '', '| phrase | segment | tick | where | note | MIDI | beats | velocity | articulation | function | shaping |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const w of composition.voiceNotes) L.push(`| ${w.phrase + 1} | ${w.source.segment} | ${w.note.startTick} | ${at(w.note.startTick)} | ${name(w.note.pitch)} | ${w.note.pitch} | ${Math.round((w.note.durationTicks / beat) * 100) / 100} | ${w.note.velocity} | ${w.note.articulation} | ${w.source.function} | ${w.shaping.join('; ')} |`);
  L.push('', `After the shared expression passes (humanize, legato overlap) the track holds ${composition.notes.length} notes; controller lanes: ${composition.cc.map((l) => `CC${l.cc} (${l.points.length} points)`).join(', ')}.`, '');

  const roll = (notes: readonly Note[], title: string): void => {
    L.push(`### ${title}`, '', '```');
    if (notes.length === 0) { L.push('(no notes)', '```', ''); return; }
    const cols = Math.ceil(Math.max(...notes.map((n) => n.startTick + n.durationTicks)) / (beat / 2));
    const lo = Math.min(...notes.map((n) => n.pitch));
    const hi = Math.max(...notes.map((n) => n.pitch));
    const perBar = bar / (beat / 2);
    let header = '     ';
    for (let c = 0; c < cols; c++) header += c % perBar === 0 ? String(c / perBar + 1).padEnd(perBar + 1).slice(0, perBar + 1) : '';
    L.push(header);
    for (let pitch = hi; pitch >= lo; pitch--) {
      let row = `${name(pitch).padEnd(4)} `;
      for (let c = 0; c < cols; c++) {
        if (c % perBar === 0) row += '|';
        const tick = c * (beat / 2);
        const sounding = notes.find((n) => n.pitch === pitch && Math.round(n.startTick / (beat / 2)) <= c && n.startTick + n.durationTicks > tick + beat / 8);
        row += sounding ? (Math.round(sounding.startTick / (beat / 2)) === c ? 'o' : '=') : '.';
      }
      if (/[o=]/.test(row)) L.push(row);
    }
    L.push('```', '');
  };
  L.push('## 6. Piano roll (one column = half a beat; `o` = note begins, `=` = held)', '');
  roll(composition.voiceNotes.map((w) => w.note), `Strings V1 voice on ${composition.selection.chosen.name}`);
  roll(composition.replacedClassicNotes, `The classic part it replaced (${composition.selection.chosen.name})`);

  const classicNotes = composition.replacedClassicNotes;
  const stats = (notes: readonly Note[]): string => {
    if (!notes.length) return 'no notes';
    const pitches = new Set(notes.map((n) => n.pitch)).size;
    const cells = new Map<string, number>();
    const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
    for (let b = 0; b * bar < Math.max(...notes.map((n) => n.startTick)) + 1; b++) {
      const inBar = sorted.filter((n) => Math.floor(n.startTick / bar) === b);
      if (!inBar.length) continue;
      const shape = inBar.map((n) => `${Math.round(((n.startTick % bar) / beat) * 2) / 2}:${n.pitch - inBar[0].pitch}`).join(' ');
      cells.set(shape, (cells.get(shape) ?? 0) + 1);
    }
    const repeated = [...cells.values()].filter((v) => v > 1).reduce((a, v) => a + v, 0);
    return `${notes.length} notes, ${name(Math.min(...notes.map((n) => n.pitch)))}–${name(Math.max(...notes.map((n) => n.pitch)))}, ${pitches} different pitches, ${cells.size} different one-bar shapes (rhythm + intervals) over ${[...cells.values()].reduce((a, v) => a + v, 0)} sounding bars, ${repeated} bars use a shape that occurs more than once`;
  };
  L.push('## 7. Compared with the classic part', '', `- classic: ${stats(classicNotes)}`, `- V1: ${stats(composition.voiceNotes.map((w) => w.note))}`,
    `- notes shared exactly (timing, pitch, velocity, articulation): ${composition.notes.filter((n) => classicNotes.some((c) => noteKey(c) === noteKey(n))).length}`, '');
}

/* ---------------- Stage 3: the two violins ---------------- */
const STAGE2_DIR = path.join(process.cwd(), 'evaluation', 'strings-v1-stage2', 'audition');
const sha1 = (data: Uint8Array): string => createHash('sha1').update(data).digest('hex');
const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');
const stage3: string[] = [];
if (composition.written && composition.trackId && composition.frame) {
  const frame = composition.frame;
  const v1Project = projectWith(v1.project, v1.result.tracks);
  const classicProject = projectWith(classic.project, classic.result.tracks);
  const v1All = playable(v1.result.tracks);
  const firstTrack = v1All.filter((t) => t.id === composition.trackId);
  const firstName = slug(composition.selection?.chosen?.name ?? 'first voice');
  const secondId = ensemble.written ? ensemble.companion!.trackId : null;
  const secondTrack = v1All.filter((t) => t.id === secondId);
  const secondName = slug(ensemble.companion?.name ?? 'second voice');
  const listen: { file: string; what: string; sha: string }[] = [];
  const put = (file: string, data: Uint8Array, what: string): void => { write(file, data, what); listen.push({ file, what, sha: sha1(data) }); };
  // 1. the first voice alone, rebuilt from what the first-voice step itself returned (its notes and controller lanes), not from the finished arrangement
  const stage2Track = firstTrack.map((t) => (isInstrumentTrack(t) ? { ...t, notes: [...composition.notes], cc: [...composition.cc] } : t));
  const stage2File = buildPerTrackMidi(v1Project, stage2Track, PROFILE)[0];
  put(`${tag}__1_stage2-v1_${firstName}-alone__uvi.mid`, stage2File.data, `the first voice (${composition.selection?.chosen?.name}) alone, exactly as the Stage 2 step wrote it — UVI profile`);
  if (secondTrack.length) put(`${tag}__2_stage3-v1_${secondName}-alone__uvi.mid`, buildPerTrackMidi(v1Project, secondTrack, PROFILE)[0].data, `Stage 3: the new second voice (${ensemble.companion!.name}) alone — UVI profile`);
  const stage3First = buildPerTrackMidi(v1Project, firstTrack, PROFILE)[0];
  put(`${tag}__3_stage3-v1_${firstName}-alone__uvi.mid`, stage3First.data, `Stage 3: ${composition.selection?.chosen?.name} alone, taken from the finished Stage 3 arrangement — UVI profile`);
  if (secondTrack.length) {
    const both = v1All.filter((t) => t.id === composition.trackId || t.id === secondId);
    put(`${tag}__4_stage3-v1_both-violins__uvi.mid`, buildMergedMidi(v1Project, both, PROFILE), 'Stage 3: the two violins together, nothing else — UVI profile');
    write(`${tag}__4_stage3-v1_both-violins__plain.mid`, buildMergedMidi(v1Project, both, null), 'the same two violins without a profile (no keyswitches) — for any MIDI player');
  }
  put(`${tag}__5_classic_full__uvi.mid`, buildMergedMidi(classicProject, playable(classic.result.tracks), PROFILE), 'classic: every track — UVI profile');
  put(`${tag}__6_stage3-v1_full__uvi.mid`, buildMergedMidi(v1Project, v1All, PROFILE), 'Stage 3 V1: every track — UVI profile');

  const S = stage3;
  const beatsOf = (ticks: number): number => Math.round((ticks / beat) * 100) / 100;
  S.push('## 9. Stage 3 — the two violins', '', '### 9.1 Files to listen to', '', '| # | file | content | sha1 |', '|---|---|---|---|');
  listen.forEach((f) => S.push(`| ${f.file.split('__')[1].slice(0, 1)} | \`${f.file}\` | ${f.what} | \`${f.sha.slice(0, 12)}\` |`));
  S.push('');
  // the first voice against the kept Stage 2 record, and against the finished arrangement
  const kept = path.join(STAGE2_DIR, `${tag}__v1__voice-only__uvi__${stage2File.fileName}`);
  S.push('### 9.2 Is the first voice what Stage 2 wrote?', '');
  S.push(`- file 1 and file 3 are byte-identical: **${sha1(stage2File.data) === sha1(stage3First.data)}** (the second voice's step did not touch the first voice's track).`);
  if (existsSync(kept)) {
    const record = readFileSync(kept);
    S.push(`- file 1 against the kept Stage 2 record \`${path.relative(process.cwd(), kept)}\` (sha1 \`${sha1(record).slice(0, 12)}\`, ${record.length} bytes): byte-identical **${sha1(record) === sha1(stage2File.data)}**.`);
  } else S.push(`- no kept Stage 2 record for this case (\`${path.relative(process.cwd(), kept)}\` does not exist), so nothing to compare with.`);
  const others = (run: typeof v1, ids: (string | null)[]): string => JSON.stringify(run.result.tracks.filter((t) => !ids.includes(t.id)));
  S.push(`- every track other than the two violins equals classic (notes and controllers): **${others(v1, [composition.trackId, secondId]) === others(classic, [composition.trackId, secondId])}**.`);
  const repeat = composeStringCell(cell, 'v1');
  S.push(`- composing the same case a second time gives the same tracks: **${JSON.stringify(repeat.result.tracks) === JSON.stringify(v1.result.tracks)}**.`, '');

  S.push('### 9.3 Second voice', '', `Written: **${ensemble.written}**${ensemble.reason ? ` — ${ensemble.reason}` : ''}`, '');
  if (ensemble.plan && ensemble.companion && ensemble.primary) {
    const P = ensemble.primaryLine;
    const pitch = (n: { step: number; alter: number }): number => soundingPitch(frame, n);
    S.push(`First voice: **${ensemble.primary.name}** (\`${ensemble.primary.trackId}\`). Second voice: **${ensemble.companion.name}** (\`${ensemble.companion.trackId}\`), range ${name(ensemble.companion.range[0])}–${name(ensemble.companion.range[1])}, singing register ${name(ensemble.companion.singing[0])}–${name(ensemble.companion.singing[1])}.`, '');
    S.push('Which violin carries which voice follows from the first voice\'s instrument selection (section 1): the second voice is always the other violin.', '');
    S.push('### 9.4 The plan (made before any note of the second voice existed)', '', ...ensemble.plan.phraseNotes.map((n) => `- ${n}`), '',
      '| # | phrase | from | to | relationship | foreground | first voice here | asked of the second voice | rule |', '|---|---|---|---|---|---|---|---|---|');
    for (const s of ensemble.plan.spans) S.push(`| ${s.index + 1} | ${s.phrase + 1} | ${at(s.startTick)} | ${at(s.endTick)} | **${s.relationship}** | ${s.foreground === 'primary' ? ensemble.primary.name : ensemble.companion.name} | ${s.primaryDescription} | ${s.intention} | ${s.reason} |`);
    S.push('', '### 9.5 What the second voice decided, stretch by stretch', '');
    for (const s of ensemble.plan.spans) {
      const w = ensemble.writing.find((x) => x.span === s.index);
      if (!w) continue;
      S.push(`**${s.index + 1}. ${at(s.startTick)} – ${at(s.endTick)}: ${s.relationship}** — ${w.played ? `plays (${w.level} alternative), ${w.side} the first voice` : `silent (${w.level} alternative)`}`, '', `- ${w.decision}`);
      if (w.played) {
        S.push(`- material: ${w.material}`);
        if (w.motion) S.push(`- against the first voice: ${w.sharedOnsets} of ${w.notes.length} notes begin together with one of its notes; motion between the voices — contrary ${w.motion.contrary}, oblique ${w.motion.oblique}, similar ${w.motion.similar}, parallel ${w.motion.parallel}`);
        if (w.weighed) S.push(`- weighed (lower is better): ${Object.entries(w.weighed).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${Math.round(v * 1000) / 1000}`).join(', ') || 'nothing counted against it'}`);
        if (w.runnersUp.length) S.push(`- next best, not chosen: ${w.runnersUp.map((u) => `${u.notes.map((n) => name(pitch(n))).join(' ')} (${u.side}; ${u.material}; weight ${Math.round(u.total * 1000) / 1000})`).join(' · ')}`);
      }
      const turned = Object.entries(w.rejections);
      if (turned.length) S.push(`- candidates turned down: ${turned.map(([k, v]) => `${k} ×${v}`).join('; ')}`);
      S.push('');
    }
    S.push('### 9.6 Every note of the second voice against the first', '', '| stretch | relationship | where | note | beats | velocity | function | first voice sounding when it begins | interval | begins together | first voice during it |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const w of ensemble.voiceNotes) {
      const n = w.source;
      const under = P.find((p) => p.tick <= n.tick && p.tick + p.duration > n.tick);
      const during = P.filter((p) => p.tick < n.tick + n.duration && p.tick + p.duration > n.tick);
      S.push(`| ${n.span + 1} | ${n.relationship} | ${at(n.tick)} | ${name(pitch(n))} | ${beatsOf(n.duration)} | ${w.note.velocity} | ${n.function} | ${under ? name(pitch(under)) : '— (rest)'} | ${under ? `${intervalName(pitch(n) - pitch(under))} ${pitch(n) >= pitch(under) ? 'above' : 'below'}` : '—'} | ${P.some((p) => p.tick === n.tick) ? 'yes' : 'no'} | ${during.map((p) => name(pitch(p))).join(' ') || 'silent'} |`);
    }
    S.push('', `Loudness: the second voice is written relative to a leading voice — ${Object.entries(RELATIONSHIP_LEVEL).filter(([k]) => k !== 'listening').map(([k, v]) => `${k} ${v}`).join(', ')} (MIDI velocity). Weights used when choosing between sound candidates: ${Object.entries(COMPANION_WEIGHTS).map(([k, v]) => `${k} ${v}`).join(', ')}. Neither set was tuned by ear.`, '');
    const facts = ensemble.review.facts;
    if (facts) {
      S.push('### 9.7 Independence, measured (these are counts, not a verdict)', '',
        `- notes: first voice ${facts.notes.primary}, second voice ${facts.notes.companion}`,
        `- beats (of ${facts.beats.total}): first voice alone ${facts.beats.primaryOnly}, second voice alone ${facts.beats.companionOnly}, both ${facts.beats.both}, neither ${facts.beats.neither}`,
        `- rhythm: ${facts.onsets.together} of the second voice's ${facts.onsets.companion} notes begin together with a note of the first; in ${facts.rhythm.sameRhythm} of the ${facts.rhythm.barsTogether} bars where both play, the two rhythms are the same`,
        `- contour, beat by beat where both sound: same direction ${facts.contour.same}, opposite ${facts.contour.opposite}, one holds while the other moves ${facts.contour.oneHolds}, both hold ${facts.contour.bothHold}`,
        `- motion between consecutive vertical intervals: contrary ${facts.motion.contrary}, oblique ${facts.motion.oblique}, similar ${facts.motion.similar}, parallel ${facts.motion.parallel}`,
        `- time sounding together by interval (beats): thirds and sixths ${facts.together.thirdsAndSixths}, fourths, fifths and octaves ${facts.together.fifthsAndOctaves}, seconds, sevenths and tritones ${facts.together.dissonant}`, '');
    }
    S.push('### 9.8 Review of the two voices together', '');
    for (const p of ensemble.review.passes) S.push(`- pass ${p.pass}: ${p.findings.length} finding(s)${p.findings.length ? ` — ${p.findings.map((f) => `${at(f.tick)}: ${f.kind} (${f.text})`).join('; ')}` : ''}${p.action ? `. Action: ${p.action}` : ''}`);
    S.push('', ensemble.review.unresolved.length ? `**Unresolved after the last pass (${ensemble.review.unresolved.length}):**` : '**Unresolved after the last pass: none by the rules the review knows.** That is a statement about those rules, not about how the passage sounds.',
      ...ensemble.review.unresolved.map((f) => `- ${at(f.tick)}: ${f.kind} — ${f.text}`), '');
    // the two voices on one roll
    const A = composition.voiceNotes.map((w) => w.note);
    const B = ensemble.voiceNotes.map((w) => w.note);
    const allNotes = [...A, ...B];
    if (allNotes.length) {
      const half = beat / 2;
      const cols = Math.ceil(Math.max(...allNotes.map((n) => n.startTick + n.durationTicks)) / half);
      const perBar = bar / half;
      const hi = Math.max(...allNotes.map((n) => n.pitch));
      const lo = Math.min(...allNotes.map((n) => n.pitch));
      const a = slug(ensemble.primary.name).endsWith('i') && !slug(ensemble.primary.name).endsWith('ii') ? '1' : '2';
      const b = a === '1' ? '2' : '1';
      S.push(`### 9.9 Both voices on one roll (one column = half a beat; \`${a}\`/\`${b}\` = Violin ${a === '1' ? 'I' : 'II'}/Violin ${b === '1' ? 'I' : 'II'} begins, \`-\`/\`~\` = held, \`#\` = both on the same pitch)`, '', '```');
      let header = '     ';
      for (let c = 0; c < cols; c++) header += c % perBar === 0 ? String(c / perBar + 1).padEnd(perBar + 1).slice(0, perBar + 1) : '';
      S.push(header);
      const cellOf = (notes: readonly Note[], p: number, c: number): 'on' | 'held' | null => {
        const n = notes.find((x) => x.pitch === p && Math.round(x.startTick / half) <= c && x.startTick + x.durationTicks > c * half + beat / 8);
        return n ? (Math.round(n.startTick / half) === c ? 'on' : 'held') : null;
      };
      for (let p = hi; p >= lo; p--) {
        let row = `${name(p).padEnd(4)} `;
        for (let c = 0; c < cols; c++) {
          if (c % perBar === 0) row += '|';
          const x = cellOf(A, p, c);
          const y = cellOf(B, p, c);
          row += x && y ? '#' : x ? (x === 'on' ? a : '-') : y ? (y === 'on' ? b : '~') : '.';
        }
        if (/[12#~-]/.test(row.slice(5))) S.push(row);
      }
      S.push('```', '');
    }
  }
}
L.push('## 8. Exported files', '', '| file | bytes | content |', '|---|---|---|');
for (const f of files) L.push(`| ${f.file} | ${f.bytes} | ${f.what} |`);
if (composition.trackId) {
  const check = files.find((f) => f.file.includes('__v1__voice-only__plain'));
  if (check) {
    const parsed = parseMidi(Buffer.from(buildMergedMidi(projectWith(v1.project, v1.result.tracks), playable(v1.result.tracks).filter((t) => t.id === composition.trackId), null)));
    const ons = parsed.tracks.flatMap((t) => t.filter((e) => e.type === 'noteOn' && (e as { velocity: number }).velocity > 0));
    const ccs = parsed.tracks.flatMap((t) => t.filter((e) => e.type === 'controller'));
    L.push('', `Read back from \`${check.file}\`: format ${parsed.header.format}, ${parsed.header.ticksPerBeat} ticks per beat, ${parsed.tracks.length} tracks, ${ons.length} note-on events, ${ccs.length} controller events.`);
  }
  const uvi = buildPerTrackMidi(projectWith(v1.project, v1.result.tracks), playable(v1.result.tracks).filter((t) => t.id === composition.trackId), PROFILE);
  for (const f of uvi) {
    const parsed = parseMidi(Buffer.from(f.data));
    const ons = parsed.tracks.flatMap((t) => t.filter((e) => e.type === 'noteOn' && (e as { velocity: number }).velocity > 0)) as unknown as { noteNumber: number }[];
    const voicePitches = new Set(composition.notes.map((n) => n.pitch));
    const switches = ons.filter((e) => !voicePitches.has(e.noteNumber));
    L.push(`UVI per-track file \`${f.fileName}\`: ${ons.length} note-on events, of which ${switches.length} lie outside the voice's pitches (keyswitches: ${[...new Set(switches.map((e) => name(e.noteNumber)))].join(', ') || 'none'}).`);
  }
}
if (stage3.length) L.push('', ...stage3);
writeFileSync(path.join(out, `${tag}__evidence.md`), `${L.join('\n')}\n`);
console.log(`written ${files.length} MIDI files and ${tag}__evidence.md to ${out}`);
console.log(`second voice written: ${ensemble.written}${ensemble.reason ? ` (${ensemble.reason})` : ''}; track ${ensemble.companion?.trackId ?? '—'}`);
console.log(`voice written: ${composition.written}${composition.reason ? ` (${composition.reason})` : ''}; track ${composition.trackId ?? '—'}`);
