/**
 * Strings V1 Stage 5 — the Cello as a fourth independently composed voice:
 * its character, the plan made from the three upper voices, the writing,
 * thematic participation, the four-voice review, expression, the export, the
 * Double Bass it must leave alone, and the isolation of everything else
 * (above all the three Stage 4 voices, which must stay exactly as they were).
 * Structural checks only: nothing here says how the music sounds.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import { composeAllTracks, type ComposeResult } from '../src/orchestrator/compose';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type Note, type Track } from '../src/shared/schema';
import { buildInstrumentCapabilities, triggerableArticulations } from '../src/orchestrator/strings/characters/capabilities';
import { CELLO, CELLO_BASS_CELLS, CELLO_FOUNDATION_CELLS, CELLO_PLUCKED_CELLS, celloBassMove, celloSingingMove } from '../src/orchestrator/strings/characters/cello';
import { VIOLA_LINE_CELLS } from '../src/orchestrator/strings/characters/viola';
import { judgeTogether, soundingPitch } from '../src/orchestrator/strings/ensemble/counterpoint';
import type { StringsV1FourthVoice } from '../src/orchestrator/strings/ensemble/fourth';
import { planFourthVoice, type FourthPlanInput } from '../src/orchestrator/strings/ensemble/fourth-plan';
import { CELLO_SHADOWING_SHARE, reviewFourthVoice } from '../src/orchestrator/strings/ensemble/fourth-review';
import { judgeLine } from '../src/orchestrator/strings/material/line';
import { celloGestures, composeCello, gestureGoal, writeCelloVoice, type CelloLevel, type CelloNote } from '../src/orchestrator/strings/writers/cello';
import { STRING_FIXTURES, STRING_TEMPLATES, composeOptionsFor, composeStringCell, isStringTrack, projectForStringCell, type StringCell } from './strings-v1-support';

const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const MAIN: StringCell = { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0 };
/** The reference case as exported at the end of Stage 4 (evaluation/strings-v1-stage4/audition), the package that was auditioned. */
const STAGE4 = {
  violinOneAlone: '24958f6acf22d7dfeaa5f3fa4d25b6c9e2df047e',
  violinTwoAlone: '42d9ab3391774ea0cd0b1803def8f5640b19329a',
  violaAlone: '5ae57a46678d1044f53c5e0aa854fb0a735962a1',
  threeVoices: '2b55b808e0d3a31821853597de89d0a131decac7',
  full: 'ba399480567a26e14ca8e8aca9d1ba8a73a0c9cf',
};
const BAR = 3840;
const BEAT = 960;
const CELLO_ROLES = ['cellos', 'cellosBasses'];

const sha1 = (data: Uint8Array): string => createHash('sha1').update(data).digest('hex');
const v1Of = (r: ComposeResult) => r.stringsDiagnostics.v1!;
const celloOf = (r: ComposeResult): StringsV1FourthVoice => v1Of(r).cello!;
const playable = (tracks: readonly Track[]): Track[] => tracks.filter((t) => isInstrumentTrack(t) && t.notes.length > 0);
const notesOf = (r: ComposeResult, id: string): Note[] => (r.tracks.find((t) => t.id === id) as unknown as { notes: Note[] }).notes;

const main = composeStringCell(MAIN, 'v1');
const mainClassic = composeStringCell(MAIN, 'classic');
const cello = celloOf(main.result);
const first = v1Of(main.result).composition!;
const duet = v1Of(main.result).ensemble!;
const viola = v1Of(main.result).viola!;
const frame = { ...first.frame!, harmony: v1Of(main.result).understanding.harmony };
const pitch = (n: { step: number; alter: number }): number => soundingPitch(frame, n);
const caps = buildInstrumentCapabilities('cello');
const noBass = { doubleBassTopIn: () => null, doubleBassPcsIn: () => [] as number[] };

/** Cells across templates (with and without a Double Bass desk), fixtures, seeds and takes. */
const CELLS: StringCell[] = [
  MAIN,
  { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 1 },
  { template: 'chamber', fixture: 'multi-chorus-16bars', seed: 2, take: 0 },
  { template: 'chamber', fixture: 'three-chorus-40bars', seed: 1, take: 0 },
  { template: 'cinematic', fixture: 'dorian-16bars', seed: 1, take: 0 },
  { template: 'symphony', fixture: 'multi-chorus-16bars', seed: 1, take: 0 },
  { template: 'hybridstudio', fixture: 'three-chorus-40bars', seed: 1, take: 0 },
];
const runs = CELLS.map((cell) => ({ cell, label: JSON.stringify(cell), v1: composeStringCell(cell, 'v1').result, classic: composeStringCell(cell, 'classic').result }));
const written = runs.filter((r) => celloOf(r.v1).written);

const planInput = (triggerable: readonly string[], doubleBass = false): FourthPlanInput => ({
  frame, duo: duet.plan!,
  upper: duet.plan!.spans.map((s) => {
    const w = duet.writing.find((x) => x.span === s.index);
    const p = viola.plan!.spans.find((x) => x.index === s.index);
    const vw = viola.writing.find((x) => x.span === s.index);
    return { span: s.index, secondPlayed: !!w?.played, violaRole: p?.role ?? 'tacet', violaPlayed: !!vw?.played, violaIsFloor: !!p?.lowestString };
  }),
  first: duet.primaryLine, second: duet.line, viola: viola.line,
  cello: { trackId: cello.cello!.trackId, name: 'Cello', range: cello.cello!.range },
  themeTicks: first.theme!.lengthTicks, headTicks: first.theme!.notes[first.theme!.headCount].tick,
  triggerable, doubleBassSoundsIn: () => doubleBass,
});
const write = (levels: CelloLevel[]) => composeCello({ frame, theme: first.theme!, plan: cello.plan!, first: duet.primaryLine, second: duet.line, viola: viola.line, range: cello.cello!.range, levels, intensityAt: () => 0.6, ...noBass });
const review = (notes: readonly CelloNote[], bass: { doubleBassTopIn: (a: number, b: number) => number | null; doubleBassPcsIn: (a: number, b: number) => readonly number[] } = noBass) =>
  reviewFourthVoice({ frame, plan: cello.plan!, first: duet.primaryLine, second: duet.line, viola: viola.line, cello: notes, range: cello.cello!.range, endTick: 16 * BAR, ...bass });

describe('the Cello\'s character', () => {
  it('is its own description, not the Viola\'s: three registers, a bass manner and a singing manner, its own rhythms', () => {
    expect(CELLO.floor).toBe(36);
    expect(CELLO.floor).toBeLessThan(CELLO.heavyBelow);
    expect(CELLO.heavyBelow).toBeLessThan(CELLO.tenorFrom);
    expect(CELLO.tenorFrom).toBeLessThan(CELLO.ceiling);
    expect(CELLO.singingRegister[1]).toBeGreaterThan(CELLO.bassCeiling);
    const violaCells = new Set(VIOLA_LINE_CELLS.map((c) => JSON.stringify(c.notes)));
    const own = [...CELLO_BASS_CELLS, ...CELLO_FOUNDATION_CELLS].filter((c) => !violaCells.has(JSON.stringify(c.notes)));
    expect(own.length).toBeGreaterThan(5);
    // a bass figure stands on the downbeat, except the two that take the bass up again after a thematic entry
    for (const c of [...CELLO_BASS_CELLS, ...CELLO_FOUNDATION_CELLS, ...CELLO_PLUCKED_CELLS]) expect(c.notes[0][0], c.id).toBe('only' in c && c.only === 'after-entry' ? 2 : 0);
  });
  it('moves like a bass in the bass (step, fourth, fifth, octave; no sixth or seventh) and like a melody when it sings', () => {
    expect(celloBassMove(1, 48)).toBe(0);
    expect(celloBassMove(3, 48)!).toBeLessThan(celloBassMove(2, 48)!);
    expect(celloBassMove(4, 48)!).toBeLessThan(celloBassMove(2, 48)!);
    expect(celloBassMove(7, 48)).not.toBeNull();
    expect(celloBassMove(6, 48)).toBeNull();
    expect(celloBassMove(2, 38)!).toBeGreaterThan(celloBassMove(2, 48)!); // thirds are heavier on the lowest string
    expect(celloSingingMove(2)!).toBeLessThan(celloSingingMove(3)!);
    expect(celloSingingMove(5)).not.toBeNull(); // the sixth is a melodic interval for a singing Cello
    expect(celloSingingMove(6)).toBeNull();
  });
  it('asks only for strokes the export profile gives this instrument a keyswitch of its own for, and never for staccato, spiccato or marcato', () => {
    const can = triggerableArticulations(caps) as readonly string[];
    for (const stroke of Object.values(CELLO.articulation)) expect(can, stroke).toContain(stroke);
    expect(can).toContain('tremolo');
    const strokes = new Set(Object.values(CELLO.articulation) as string[]);
    for (const never of ['staccato', 'spiccato', 'marcato']) expect(strokes.has(never)).toBe(false);
    for (const r of written) for (const n of celloOf(r.v1).notes) expect(['legato', 'sustain', 'pizz', 'tremolo'], r.label).toContain(n.articulation);
    expect(cello.cello!.notTriggerable).toEqual(['staccato', 'spiccato', 'marcato']);
  });
});

describe('four-voice planning', () => {
  const plan = cello.plan!;
  it('gives one stretch per stretch of the two-violin plan, each with a role, an intention, the rule that decided it and what the three upper voices do there', () => {
    expect(plan.spans.map((s) => [s.startTick, s.endTick])).toEqual(duet.plan!.spans.map((s) => [s.startTick, s.endTick]));
    for (const s of plan.spans) {
      expect(s.reason).toMatch(/^rule [1-5] — /);
      expect(s.intention.length).toBeGreaterThan(0);
      expect(s.firstVoice.length * s.secondVoice.length * s.viola.length).toBeGreaterThan(0);
    }
  });
  it('plans the reference case: a floor under the first theme, a moving bass, a thematic entry, an arrival; rest while the Viola plucks the bass; then again', () => {
    expect(plan.spans.map((s) => s.role)).toEqual(['foundation', 'bass-line', 'theme', 'arrival', 'arrival', 'tacet', 'tacet', 'bass-line', 'theme', 'arrival']);
    expect(plan.spans.filter((s) => s.role === 'theme').map((s) => s.thematic)).toEqual(['fragment', 'statement']);
    expect(plan.spans[5].reason).toMatch(/the Viola plucks the bass/);
  });
  it('does not give the Cello one permanent role, and plans silence, in every case', () => {
    for (const r of written) {
      const roles = new Set(celloOf(r.v1).plan!.spans.map((s) => s.role));
      expect(roles.size, r.label).toBeGreaterThanOrEqual(3);
    }
    expect(written.some((r) => celloOf(r.v1).plan!.spans.some((s) => s.role === 'tacet'))).toBe(true);
    expect(written.some((r) => celloOf(r.v1).plan!.spans.some((s) => s.role === 'plucked-bass'))).toBe(true);
  });
  it('is made from the upper voices alone, before any Cello note: the same input gives the plan the compose run used', () => {
    expect(planFourthVoice(planInput(cello.cello!.triggerable))).toEqual(plan);
  });
  it('reads the Viola: where the Viola does not pluck the bass under the known theme, the Cello is not told to rest for that reason', () => {
    const input = planInput(cello.cello!.triggerable);
    const other = planFourthVoice({ ...input, upper: input.upper.map((u) => ({ ...u, violaRole: 'tacet', violaPlayed: false })) });
    expect(other.spans[5].role).toBe('plucked-bass');
    expect(other.spans[5].viola).toBe('the Viola is silent');
  });
  it('knows whether it is the floor: under a sounding Double Bass every stretch says so', () => {
    expect(plan.spans.every((s) => s.isFloor)).toBe(true);
    const over = planFourthVoice(planInput(cello.cello!.triggerable, true));
    expect(over.spans.every((s) => !s.isFloor)).toBe(true);
    expect(over.spans[0].reason).toMatch(/Double Bass sounds underneath/);
  });
  it('declines a role whose stroke the instrument cannot trigger instead of approximating it', () => {
    const noLegato = planFourthVoice(planInput(['sustain', 'pizz']));
    expect(noLegato.spans.every((s) => !['foundation', 'bass-line', 'theme'].includes(s.role))).toBe(true);
    expect(noLegato.spans[0].reason).toMatch(/no legato keyswitch/);
    const input = planInput(['legato', 'sustain']);
    const noPizz = planFourthVoice({ ...input, upper: input.upper.map((u) => ({ ...u, violaRole: 'tacet', violaPlayed: false })) });
    expect(noPizz.spans.some((s) => s.role === 'plucked-bass')).toBe(false);
    expect(noPizz.spans[5].role).toBe('foundation');
  });
});

describe('the written Cello', () => {
  it('is written on the Cello track, replaces the classic part, and does not play all the time', () => {
    expect(cello.written).toBe(true);
    const track = main.result.tracks.find((t) => CELLO_ROLES.includes(t.role))!;
    expect(cello.cello!.trackId).toBe(track.id);
    expect(notesOf(main.result, track.id)).toEqual(cello.notes);
    expect(cello.replacedClassicNotes).toEqual(notesOf(mainClassic.result, track.id));
    const facts = cello.review.facts!;
    expect(facts.beats.celloSilent).toBeGreaterThanOrEqual(16);
    expect(facts.beats.celloSounds).toBeGreaterThan(facts.beats.celloSilent);
    for (const r of written) expect(celloOf(r.v1).review.facts!.beats.celloSilent, r.label).toBeGreaterThan(0);
  });
  it('records for every stretch whether it played and why, and is silent wherever the plan said tacet', () => {
    for (const r of written) {
      const c = celloOf(r.v1);
      expect(c.writing.length, r.label).toBe(c.plan!.spans.length);
      for (const w of c.writing) {
        expect(w.decision.length, r.label).toBeGreaterThan(0);
        expect(w.played, r.label).toBe(w.notes.length > 0);
        if (c.plan!.spans[w.span].role === 'tacet') expect(w.played, r.label).toBe(false);
      }
      expect(c.writing.flatMap((w) => w.notes).length, r.label).toBe(c.line.length);
    }
  });
  it('stays inside what the instrument plays (C2 upwards), clear of the keyswitch zone, and under both violins', () => {
    expect(cello.cello!.range[0]).toBe(36);
    expect(caps.keyswitchZone!.high).toBeLessThan(36);
    for (const r of written) {
      const c = celloOf(r.v1);
      const f = { ...v1Of(r.v1).composition!.frame!, harmony: v1Of(r.v1).understanding.harmony };
      for (const n of c.notes) {
        expect(n.pitch, r.label).toBeGreaterThanOrEqual(36);
        expect(n.pitch, r.label).toBeLessThanOrEqual(CELLO.ceiling);
      }
      for (const n of c.line) {
        const p = soundingPitch(f, n);
        for (const line of [v1Of(r.v1).ensemble!.primaryLine, v1Of(r.v1).ensemble!.line]) {
          for (const v of line) if (v.tick < n.tick + n.duration && v.tick + v.duration > n.tick) expect(p, `${r.label} tick ${n.tick}`).toBeLessThanOrEqual(soundingPitch(f, v));
        }
      }
    }
  });
  it('is under the Viola too in every bass role; only thematic notes may rise above it', () => {
    for (const r of written) {
      const c = celloOf(r.v1);
      const f = { ...v1Of(r.v1).composition!.frame!, harmony: v1Of(r.v1).understanding.harmony };
      for (const n of c.line.filter((x) => x.role !== 'theme')) {
        for (const v of v1Of(r.v1).viola!.line) if (v.tick < n.tick + n.duration && v.tick + v.duration > n.tick) expect(soundingPitch(f, n), `${r.label} tick ${n.tick}`).toBeLessThanOrEqual(soundingPitch(f, v) - CELLO.clearance);
      }
    }
  });
  it('is not confined to the bottom: in the reference case it rises above the Viola with the theme, and spans more than two octaves', () => {
    const facts = cello.review.facts!;
    expect(facts.place.aboveViola).toBeGreaterThan(0);
    expect(facts.register![1] - facts.register![0]).toBeGreaterThan(24);
    expect(facts.place.lowestVoice).toBeLessThan(facts.beats.celloSounds);
  });
  it('is one line: no two of its notes begin together or overlap on the grid, and a bowed note is never repeated under one bow', () => {
    for (const r of written) {
      const line = celloOf(r.v1).line;
      for (let i = 1; i < line.length; i++) {
        expect(line[i].tick, r.label).toBeGreaterThanOrEqual(line[i - 1].tick + line[i - 1].duration);
        const tied = line[i - 1].role !== 'plucked-bass' && line[i].role !== 'plucked-bass' && !line[i - 1].breathAfter;
        if (tied) expect(line[i].step === line[i - 1].step && line[i].alter === line[i - 1].alter, `${r.label} tick ${line[i].tick}`).toBe(false);
      }
    }
  });
  it('carries the chord\'s bass on almost every first beat of a chord where it is the floor', () => {
    const facts = cello.review.facts!;
    expect(facts.bass.chordStarts).toBeGreaterThanOrEqual(12);
    expect(facts.bass.onChordBass / facts.bass.chordStarts).toBeGreaterThanOrEqual(0.9);
  });
  it('does not play quavers on the lowest string', () => {
    for (const r of written) {
      const c = celloOf(r.v1);
      for (const w of c.voiceNotes) if (w.source.role !== 'plucked-bass' && w.source.role !== 'theme' && w.source.duration <= BEAT / 2) expect(w.note.pitch, r.label).toBeGreaterThanOrEqual(CELLO.heavyBelow);
    }
  });
  it('leaves the hand time to take the bow up after plucking', () => {
    for (const r of written) {
      const line = celloOf(r.v1).line;
      for (let i = 1; i < line.length; i++) {
        if (line[i - 1].role === 'plucked-bass' && line[i].role !== 'plucked-bass') expect(line[i].tick - line[i - 1].tick, r.label).toBeGreaterThanOrEqual((CELLO.arcoPreparationBeats + CELLO.pizzLengthBeats) * BEAT);
      }
    }
  });
  it('breathes: every bowed gesture ends with a lifted bow, and none runs longer than the review allows', () => {
    for (const r of written) {
      const c = celloOf(r.v1);
      const gestures = celloGestures(c.line);
      const lengths = new Map<number, number>();
      c.line.forEach((n, i) => { if (gestures[i] >= 0 && n.role !== 'arrival') lengths.set(gestures[i], (lengths.get(gestures[i]) ?? 0) + n.duration / BEAT); });
      for (const beats of lengths.values()) expect(beats, r.label).toBeLessThanOrEqual(CELLO.maxUnbrokenBeats + 4);
      c.voiceNotes.forEach((w) => { if (w.source.breathAfter && w.source.role !== 'plucked-bass') expect(w.note.durationTicks, r.label).toBeLessThan(w.source.duration); });
    }
  });
});

describe('thematic participation', () => {
  const theme = first.theme!;
  it('takes the theme\'s own notes, not its rhythm alone: every entry keeps the note lengths and the characteristic leap exactly', () => {
    expect(cello.thematic.length).toBe(2);
    for (const r of written) {
      const c = celloOf(r.v1);
      const t = v1Of(r.v1).composition!.theme!;
      for (const entry of c.thematic) {
        expect(entry.rhythmBeats, r.label).toEqual(entry.themeRhythmBeats);
        const notes = c.line.filter((n) => n.span === entry.span && n.role === 'theme');
        const from = notes[0].themeIndex!;
        expect(notes.map((n) => n.themeIndex), r.label).toEqual(notes.map((_, i) => from + i));
        const leap = t.identity.leap.fromIndex - from;
        if (leap >= 0 && leap + 1 < notes.length) expect(entry.intervals[leap], r.label).toBe(t.identity.leap.steps);
        // the directions of the head survive
        if (entry.kind !== 'tail') for (let i = 0; i < Math.min(t.headCount, notes.length) - 1; i++) expect(Math.sign(entry.intervals[i]), r.label).toBe(Math.sign(entry.themeIntervals[i]));
        // and what was changed is said
        const changed = entry.intervals.filter((v, i) => v !== entry.themeIntervals[i]).length;
        if (changed > 0) expect(entry.moved.length + (entry.strategy === 'reinterpretation' ? 1 : 0), r.label).toBeGreaterThan(0);
        if (entry.moved.length === 0 && entry.strategy !== 'tail-rewrite') expect(entry.intervals, r.label).toEqual(entry.themeIntervals);
      }
    }
  });
  it('states the head of the reference theme — the rising sixth and the descent — twice, the second time an octave lower', () => {
    const [a, b] = cello.thematic;
    expect([a.kind, b.kind]).toEqual(['head', 'head']);
    expect(a.intervals[0]).toBe(theme.identity.leap.steps);
    expect(theme.identity.leap.name).toMatch(/sixth/);
    expect(b.shift).toBe(a.shift - 7);
    const pitches = (span: number): number[] => cello.voiceNotes.filter((w) => w.source.span === span && w.source.role === 'theme').map((w) => w.note.pitch);
    expect(pitches(b.span)).toEqual(pitches(a.span).map((p) => p - 12));
  });
  it('enters after the upper voices have stated and restated the theme, never against its first statement', () => {
    for (const r of written) {
      const c = celloOf(r.v1);
      const duo = v1Of(r.v1).ensemble!.plan!;
      for (const entry of c.thematic) {
        const kinds = duo.spans[entry.span].primaryActivity;
        expect(kinds.includes('statement') || kinds.includes('restatement'), r.label).toBe(false);
      }
    }
  });
  it('says so when it declines: a stretch asked for the whole theme that got only the head records what was turned down', () => {
    const w = cello.writing[8];
    expect(cello.plan!.spans[8].thematic).toBe('statement');
    expect(cello.thematic.find((t) => t.span === 8)!.kind).toBe('head');
    expect(Object.keys(w.rejections).some((k) => k.startsWith('the whole theme:'))).toBe(true);
  });
  it('marks a thematic entry and gives it the deepest dynamic curve', () => {
    const entries = cello.voiceNotes.filter((w) => w.shaping.includes('the thematic entry is marked'));
    expect(entries.length).toBe(2);
    const g = cello.expression!.gestures;
    expect(Math.max(...g.map((x) => x.depth))).toBe(g.find((x) => x.role === 'theme')!.depth);
  });
});

describe('independence and compatibility', () => {
  it('is sound as a line of its own, gesture by gesture', () => {
    for (const r of written) {
      const c = celloOf(r.v1);
      const f = { ...v1Of(r.v1).composition!.frame!, harmony: v1Of(r.v1).understanding.harmony };
      let gesture: CelloNote[] = [];
      for (const n of c.line) {
        if (n.role === 'plucked-bass') continue;
        gesture.push(n);
        if (n.breathAfter) { expect(judgeLine(f, gesture, { finalStable: true }).problems, `${r.label} tick ${n.tick}`).toEqual([]); gesture = []; }
      }
    }
  });
  it('breaks no two-voice rule against either violin or the Viola', () => {
    for (const r of written) {
      const c = celloOf(r.v1);
      const f = { ...v1Of(r.v1).composition!.frame!, harmony: v1Of(r.v1).understanding.harmony };
      const bass = c.line.filter((n) => n.role !== 'theme');
      const themed = c.line.filter((n) => n.role === 'theme');
      const e = v1Of(r.v1).ensemble!;
      for (const line of [e.primaryLine, e.line]) {
        expect(judgeTogether(f, bass, line, { side: 'below' }).conflicts, r.label).toEqual([]);
        expect(judgeTogether(f, themed, line, { side: 'below' }).conflicts, r.label).toEqual([]);
      }
      expect(judgeTogether(f, bass, v1Of(r.v1).viola!.line, { side: 'below' }).conflicts, r.label).toEqual([]);
      expect(judgeTogether(f, themed, v1Of(r.v1).viola!.line, { side: null }).conflicts, r.label).toEqual([]);
    }
  });
  it('does not copy an upper voice: almost no bar shares a rhythm with one, and it is not a transposed Viola', () => {
    const facts = cello.review.facts!;
    for (const p of [facts.withFirst, facts.withSecond, facts.withViola]) expect(p.rhythm.sameRhythm).toBeLessThanOrEqual(2);
    expect(facts.withViola.motion.parallel).toBe(0);
    const violaPcs = viola.line.map((n) => `${n.tick}:${pitch(n) % 12}`);
    const same = cello.line.filter((n) => violaPcs.includes(`${n.tick}:${pitch(n) % 12}`)).length;
    expect(same / cello.line.length).toBeLessThan(0.25);
    expect(facts.onsets.alone).toBeGreaterThan(0);
    expect(facts.onsets.withThree).toBeLessThan(facts.onsets.cello / 4);
  });
  it('never shadows one upper voice through a moving stretch, in any case', () => {
    for (const r of written) expect(celloOf(r.v1).review.unresolved.filter((f) => f.kind === 'shadowing'), r.label).toEqual([]);
  });
  it('moves against the upper voices more often than with them', () => {
    const facts = cello.review.facts!;
    for (const p of [facts.withFirst, facts.withSecond, facts.withViola]) expect(p.motion.contrary + p.motion.oblique).toBeGreaterThan(p.motion.similar + p.motion.parallel);
  });
});

describe('articulation and expression', () => {
  it('chooses the stroke note by note: slurred lines, a plain bow for an arrival, plucked for the plucked bass', () => {
    for (const r of written) {
      for (const w of celloOf(r.v1).voiceNotes) {
        if (w.source.role === 'plucked-bass') expect(w.note.articulation, r.label).toBe('pizz');
        else if (w.source.role === 'arrival') expect(w.note.articulation, r.label).toBe('sustain');
        else expect(['legato', 'sustain', 'tremolo'], r.label).toContain(w.note.articulation);
        if (w.source.role === 'plucked-bass') expect(w.note.durationTicks, r.label).toBe(CELLO.pizzLengthBeats * BEAT);
      }
    }
    expect(new Set(cello.notes.map((n) => n.articulation))).toEqual(new Set(['legato', 'sustain']));
    expect(written.some((r) => celloOf(r.v1).notes.some((n) => n.articulation === 'pizz'))).toBe(true);
  });
  it('plays a long floor tone tremolo only at high energy and only if the instrument has the keyswitch', () => {
    const note: CelloNote = { tick: 0, duration: 4 * BEAT, step: -14, alter: 0, function: 'chord-tone', span: 0, role: 'foundation', breathAfter: true, cell: 'whole', themeIndex: null, isFloor: true };
    const at = (energy: number, triggerable: string[]) => writeCelloVoice({ frame, notes: [note], energyByBar: [energy], primaryIntensityAt: () => 0.6, triggerable })[0].note.articulation;
    expect(at(0.9, ['legato', 'sustain', 'tremolo'])).toBe('tremolo');
    expect(at(0.5, ['legato', 'sustain', 'tremolo'])).toBe('sustain');
    expect(at(0.9, ['legato', 'sustain'])).toBe('sustain');
    expect(at(0.5, ['legato'])).toBe('legato');
  });
  it('shapes each bowed gesture towards its goal: loudness grows to it and falls after it', () => {
    const gestures = celloGestures(cello.line);
    let shaped = 0;
    for (const id of new Set(gestures.filter((g) => g >= 0))) {
      const members = cello.voiceNotes.filter((_, i) => gestures[i] === id);
      if (members.length < 3) continue;
      const goal = gestureGoal(frame, members.map((m) => m.source));
      expect(members[goal].shaping.join(' ')).toMatch(/the goal of the gesture|held; plain bow/);
      if (goal > 0 && members[goal].source.role !== 'arrival') { expect(members[goal].note.velocity).toBeGreaterThan(members[0].note.velocity); shaped++; }
    }
    expect(shaped).toBeGreaterThanOrEqual(3);
  });
  it('has dynamic lanes of its own: CC1 and CC11 rise to each gesture\'s goal and fall to its end, and differ from the classic Cello\'s lanes', () => {
    expect(cello.expression!.ownLanes).toEqual([1, 11]);
    const classicTrack = mainClassic.result.tracks.find((t) => CELLO_ROLES.includes(t.role)) as unknown as { cc: { cc: number; points: { tick: number; value: number }[] }[] };
    for (const number of [1, 11]) {
      const lane = cello.cc.find((l) => l.cc === number)!;
      const at = (tick: number): number => { let v = lane.points[0].value; for (const p of lane.points) if (p.tick <= tick) v = p.value; return v; };
      expect(lane.points).not.toEqual(classicTrack.cc.find((l) => l.cc === number)!.points);
      for (const g of cello.expression!.gestures.filter((x) => x.notes >= 3)) {
        expect(at(g.goalTick), `CC${number} gesture at ${g.startTick}`).toBeGreaterThan(at(g.startTick));
        expect(at(g.goalTick), `CC${number} gesture at ${g.startTick}`).toBeGreaterThan(at(g.endTick));
      }
      for (const p of lane.points) { expect(p.value).toBeGreaterThanOrEqual(0); expect(p.value).toBeLessThanOrEqual(127); }
      expect(lane.points.length).toBeLessThanOrEqual(1024);
    }
    // the curve is the gesture's, not the bar's: two gestures at different places do not share one shape
    const cc1 = cello.cc.find((l) => l.cc === 1)!.points;
    expect(new Set(cc1.map((p) => p.value)).size).toBeGreaterThan(10);
  });
  it('keeps every note under a leading voice of the same bar, the thematic entries nearest to it', () => {
    const level = (role: string): number => { const v = cello.voiceNotes.filter((w) => w.source.role === role).map((w) => w.note.velocity); return v.reduce((a, b) => a + b, 0) / v.length; };
    expect(level('theme')).toBeGreaterThan(level('foundation'));
    expect(CELLO.level.theme).toBeGreaterThan(CELLO.level['bass-line']);
    expect(CELLO.level['bass-line']).toBeGreaterThan(CELLO.level.foundation);
  });
});

describe('four-voice review', () => {
  it('finds nothing in the passage it accepted, and every pass lowered exactly one stretch by one step towards silence', () => {
    for (const r of written) {
      const c = celloOf(r.v1);
      expect(c.review.unresolved, r.label).toEqual([]);
      expect(c.review.passes.length, r.label).toBeLessThanOrEqual(2 * c.plan!.spans.length + 1);
      expect(c.review.passes[c.review.passes.length - 1].action, r.label).toBeNull();
      for (const p of c.review.passes.slice(0, -1)) expect(p.action, r.label).toMatch(/written again as '(plainer|silent)'/);
    }
    expect(review(cello.line).findings).toEqual([]);
  });
  it('names a Cello that crosses a violin, one that crowds the note above it, one that leaves its range and a quaver on the lowest string', () => {
    const top = duet.primaryLine[0];
    const crossing = review([{ ...cello.line[0], step: top.step + 2, alter: 0 }, ...cello.line.slice(1)]);
    expect(crossing.findings.some((f) => f.kind === 'crossing' && f.against === 'first')).toBe(true);
    const close = review([{ ...cello.line[0], step: top.step - 1, alter: 0 }, ...cello.line.slice(1)]);
    expect(close.findings.some((f) => f.kind === 'too-close')).toBe(true);
    const low = review([{ ...cello.line[0], step: cello.line[0].step - 14 }, ...cello.line.slice(1)]);
    expect(low.findings.some((f) => f.kind === 'out-of-range')).toBe(true);
    const quick = cello.line.findIndex((n) => n.duration <= BEAT / 2 && n.role === 'bass-line');
    const slow = review(cello.line.map((n, i) => (i === quick ? { ...n, step: -13, alter: 0 } : n)));
    expect(slow.findings.some((f) => f.kind === 'slow-string')).toBe(true);
  });
  it('names a Cello that goes under the Double Bass or holds a semitone against it', () => {
    const p = pitch(cello.line[0]);
    const under = review(cello.line, { doubleBassTopIn: (from) => (from === 0 ? p + 2 : null), doubleBassPcsIn: () => [] });
    expect(under.findings.some((f) => f.kind === 'under-double-bass' && f.against === 'double-bass' && f.span === 0)).toBe(true);
    const against = review(cello.line, { doubleBassTopIn: () => null, doubleBassPcsIn: (from) => (from === 0 ? [(p + 1) % 12] : []) });
    expect(against.findings.some((f) => f.kind === 'against-double-bass')).toBe(true);
    expect(review(cello.line, { doubleBassTopIn: () => p - 12, doubleBassPcsIn: () => [p % 12] }).findings.filter((f) => f.against === 'double-bass').length).toBeLessThan(cello.line.length);
  });
  it('names a voice that shadows another, and a bowed line that never breathes', () => {
    const shadow = cello.plan!.spans[1];
    const theirs = duet.primaryLine.filter((n) => n.tick >= shadow.startTick && n.tick < shadow.endTick && n.tick % BAR !== 0).slice(0, 5);
    const copy: CelloNote[] = theirs.map((n, i) => ({ ...cello.line[3], tick: n.tick, duration: Math.min(n.duration, (theirs[i + 1]?.tick ?? n.tick + BEAT) - n.tick), step: -9 - (i % 2), alter: 0, span: 1, role: 'bass-line', breathAfter: i === theirs.length - 1 }));
    if (copy.length >= 4) expect(review(copy).findings.some((f) => f.kind === 'shadowing' && f.against === 'first')).toBe(true);
    expect(CELLO_SHADOWING_SHARE).toBe(0.6);
    const endless: CelloNote[] = Array.from({ length: 20 }, (_, i) => ({ ...cello.line[0], tick: i * BEAT, duration: BEAT, step: -14 + (i % 2), alter: 0, span: 0, role: 'bass-line' as const, breathAfter: i === 19 }));
    expect(review(endless).findings.some((f) => f.kind === 'no-breath')).toBe(true);
  });
  it('is answered only by simplifying the Cello: plainer is plainer, silent is silent, and nothing else is returned', () => {
    const levels = cello.plan!.spans.map(() => 0 as CelloLevel);
    const preferred = write(levels);
    const plain = write(levels.map((l, i) => (i === 1 ? 1 : l)) as CelloLevel[]);
    const silent = write(levels.map((l, i) => (i === 1 ? 2 : l)) as CelloLevel[]);
    const count = (r: ReturnType<typeof write>, span: number): number => r.notes.filter((n) => n.span === span).length;
    expect(count(plain, 1)).toBeLessThan(count(preferred, 1));
    expect(plain.notes.filter((n) => n.span === 1).every((n) => n.duration >= 2 * BEAT)).toBe(true);
    expect(count(silent, 1)).toBe(0);
    expect(silent.spans[1].decision).toMatch(/review withdrew/);
    // a thematic stretch asked to be plainer gives up the theme and keeps a bass
    const noTheme = write(levels.map((l, i) => (i === 2 ? 1 : l)) as CelloLevel[]);
    expect(noTheme.thematic.some((t) => t.span === 2)).toBe(false);
    expect(Object.keys(preferred).sort()).toEqual(['notes', 'spans', 'thematic']);
  });
  it('a review pass that lowered a stretch really happened somewhere, and the result has fewer findings than before it', () => {
    const cases = [{ template: 'cinematic', fixture: 'three-chorus-40bars', seed: 1, take: 0 }, { template: 'hybridstudio', fixture: 'three-chorus-40bars', seed: 1, take: 0 }] as StringCell[];
    let corrected = 0;
    for (const cell of cases) {
      const c = celloOf(composeStringCell(cell, 'v1').result);
      if (c.review.passes.length > 1) {
        corrected++;
        expect(c.review.passes[0].findings.length).toBeGreaterThan(0);
        expect(c.review.unresolved).toEqual([]);
      }
    }
    expect(corrected).toBeGreaterThan(0);
  }, 120_000);
});

describe('determinism', () => {
  it('gives the same Cello for the same template, fixture, seed and take', { timeout: 120_000 }, () => {
    for (const r of runs.slice(0, 3)) {
      const again = composeStringCell(r.cell, 'v1').result;
      expect(celloOf(again), r.label).toEqual(celloOf(r.v1));
      expect(again.tracks, r.label).toEqual(r.v1.tracks);
    }
  });
  it('changes with the take, because the voices it answers change', () => {
    expect(celloOf(runs[1].v1).notes).not.toEqual(cello.notes);
  });
});

describe('silence and declining', () => {
  it('writes no Cello, and keeps the classic part, where there are no three composed voices to join', { timeout: 120_000 }, () => {
    for (const template of ['sonata', 'vocalbacking'] as const) {
      const cell = { template, fixture: 'dorian-16bars' as const, seed: 1, take: 0 };
      const v1 = composeStringCell(cell, 'v1').result;
      const classic = composeStringCell(cell, 'classic').result;
      const c = celloOf(v1);
      expect(c.written, template).toBe(false);
      expect(c.reason, template).toMatch(/two-violin plan does not exist|Viola was not composed|no first voice/);
      const firstId = v1Of(v1).composition!.trackId;
      expect(v1.tracks.filter((t) => CELLO_ROLES.includes(t.role) && t.id !== firstId), template).toEqual(classic.tracks.filter((t) => CELLO_ROLES.includes(t.role) && t.id !== firstId));
    }
  });
  it('writes no Cello when the Cello track is locked, and leaves that track untouched', () => {
    const project = projectForStringCell(MAIN);
    const before = project.tracks.find((t) => CELLO_ROLES.includes(t.role))!;
    before.locked = true;
    const snapshot = JSON.stringify(before);
    const result = composeAllTracks(project, composeOptionsFor(MAIN, 'v1'));
    expect(celloOf(result).written).toBe(false);
    expect(celloOf(result).reason).toMatch(/no unlocked Cello track/);
    expect(JSON.stringify(result.tracks.find((t) => CELLO_ROLES.includes(t.role)))).toBe(snapshot);
  });
  it('never writes a Cello in classic mode', () => {
    expect(mainClassic.result.stringsDiagnostics.v1).toBeNull();
  });
  it('may decline inside a piece: a stretch the writer or the review left silent says why', () => {
    for (const r of written) for (const w of celloOf(r.v1).writing) if (!w.played) expect(w.decision, r.label).toMatch(/silent|goes on sounding|declined/);
  });
});

describe('Stage 4 voices preserved', () => {
  const project = { ...main.project, tracks: main.result.tracks };
  const byRole = (role: string): Track[] => playable(main.result.tracks).filter((t) => t.role === role);
  it('exports Violin I, Violin II and the Viola of the reference case byte for byte as Stage 4 did', () => {
    expect(sha1(buildPerTrackMidi(project, byRole('violins1'), PROFILE)[0].data)).toBe(STAGE4.violinOneAlone);
    expect(sha1(buildPerTrackMidi(project, byRole('violins2'), PROFILE)[0].data)).toBe(STAGE4.violinTwoAlone);
    expect(sha1(buildPerTrackMidi(project, byRole('violas'), PROFILE)[0].data)).toBe(STAGE4.violaAlone);
    expect(sha1(buildMergedMidi(project, playable(main.result.tracks).filter((t) => ['violins1', 'violins2', 'violas'].includes(t.role)), PROFILE))).toBe(STAGE4.threeVoices);
  });
  it('gives the Stage 4 full arrangement back, byte for byte, when the classic Cello is put back', () => {
    const classicCello = mainClassic.result.tracks.find((t) => CELLO_ROLES.includes(t.role))!;
    const tracks = main.result.tracks.map((t) => (CELLO_ROLES.includes(t.role) ? classicCello : t));
    expect(sha1(buildMergedMidi({ ...main.project, tracks }, playable(tracks), PROFILE))).toBe(STAGE4.full);
  });
  it('leaves all three upper voices as their own steps returned them, in every case', () => {
    for (const r of runs) {
      const c = v1Of(r.v1).composition!;
      const e = v1Of(r.v1).ensemble!;
      const v = v1Of(r.v1).viola!;
      if (c.written) expect(notesOf(r.v1, c.trackId!), r.label).toEqual(c.notes);
      if (e.written) expect(notesOf(r.v1, e.companion!.trackId), r.label).toEqual(e.notes);
      if (v.written) { expect(notesOf(r.v1, v.viola!.trackId), r.label).toEqual(v.notes); expect((r.v1.tracks.find((t) => t.id === v.viola!.trackId) as unknown as { cc: unknown }).cc, r.label).toEqual(v.cc); }
    }
  });
});

describe('the Double Bass', () => {
  const withDesk = written.filter((r) => r.v1.tracks.some((t) => t.role === 'basses'));
  // Stage 5 left the desk exactly classic. Since Stage 6 the Double Bass is composed onto that same desk, after the
  // Cello: the Cello still heard the classic desk (what its diagnostics count), the track is the same one, and only
  // its notes and controllers are the composed part's — or everything is classic where the Double Bass was not written.
  it('is there in the bands that have one, on the classic desk: same track, name, range; the Cello heard the classic part', () => {
    expect(withDesk.length).toBeGreaterThanOrEqual(3);
    for (const r of withDesk) {
      const desk = r.v1.tracks.filter((t) => t.role === 'basses');
      const classicDesk = r.classic.tracks.filter((t) => t.role === 'basses');
      expect(desk.length, r.label).toBe(1);
      const fifth = v1Of(r.v1).doubleBass;
      if (fifth?.written) {
        const { notes: _n, cc: _c, ...kept } = desk[0] as unknown as Record<string, unknown>;
        const { notes: _cn, cc: _cc, ...keptClassic } = classicDesk[0] as unknown as Record<string, unknown>;
        expect(kept, r.label).toEqual(keptClassic);
        expect(fifth.replacedClassicNotes, r.label).toEqual((classicDesk[0] as unknown as { notes: Note[] }).notes);
      } else expect(desk, r.label).toEqual(classicDesk);
      expect(celloOf(r.v1).doubleBass.trackId, r.label).toBe(desk[0].id);
      expect(celloOf(r.v1).doubleBass.notes, r.label).toBe((classicDesk[0] as unknown as { notes: Note[] }).notes.length);
    }
  });
  it('gets no track where the band has none', () => {
    expect(main.result.tracks.some((t) => t.role === 'basses')).toBe(false);
    expect(cello.doubleBass).toEqual({ trackId: null, notes: 0 });
    expect(main.result.tracks.map((t) => t.id)).toEqual(mainClassic.result.tracks.map((t) => t.id));
  });
  it('receives no Cello note: none carries a layer mark, and the composed Cello is not an octave copy of the desk', () => {
    for (const r of written) expect(celloOf(r.v1).notes.filter((n) => n.layer !== undefined), r.label).toEqual([]);
    for (const r of withDesk) {
      const desk = (r.v1.tracks.find((t) => t.role === 'basses') as unknown as { notes: Note[] }).notes;
      const c = celloOf(r.v1);
      const doubled = c.voiceNotes.filter((w) => desk.some((d) => Math.abs(d.startTick - w.note.startTick) < BEAT / 4 && (w.note.pitch - d.pitch) % 12 === 0)).length;
      expect(doubled / c.voiceNotes.length, r.label).toBeLessThan(0.6);
    }
  });
  it('is never gone under, and the Cello holds no semitone against it', () => {
    for (const r of withDesk) {
      const desk = (r.v1.tracks.find((t) => t.role === 'basses') as unknown as { notes: Note[] }).notes;
      for (const w of celloOf(r.v1).voiceNotes) {
        const from = w.source.tick + BEAT / 8;
        const to = w.source.tick + w.source.duration - BEAT / 8;
        for (const d of desk) {
          if (d.startTick < to && d.startTick + d.durationTicks > from) {
            expect(w.note.pitch, `${r.label} tick ${w.source.tick}`).toBeGreaterThanOrEqual(d.pitch);
            if (w.source.duration >= BEAT) expect([1, 11], `${r.label} tick ${w.source.tick}`).not.toContain((((w.note.pitch - d.pitch) % 12) + 12) % 12);
          }
        }
      }
    }
  });
  it('frees the Cello from the bass note: over a sounding desk the stretch is planned as not the floor', () => {
    expect(withDesk.some((r) => celloOf(r.v1).plan!.spans.some((s) => !s.isFloor && s.role !== 'tacet'))).toBe(true);
    expect(withDesk.some((r) => celloOf(r.v1).review.facts!.place.overDoubleBass > 0)).toBe(true);
  });
});

describe('isolation', () => {
  it('changes the Cello track and nothing else relative to Stage 4 (Stage 6 adds the Double Bass): every other family equals classic', { timeout: 900_000 }, () => {
    for (const template of STRING_TEMPLATES) {
      for (const fixture of STRING_FIXTURES) {
        const cell = { template, fixture, seed: 1, take: 2 };
        const classic = composeStringCell(cell, 'classic').result;
        const v1 = composeStringCell(cell, 'v1').result;
        const label = `${template}/${fixture}`;
        const c = v1Of(v1).composition!;
        const e = v1Of(v1).ensemble!;
        const v = v1Of(v1).viola!;
        const k = celloOf(v1);
        const ids = [c.trackId, e.written ? e.companion!.trackId : null, v.written ? v.viola!.trackId : null, k.written ? k.cello!.trackId : null,
          // Stage 6: and the Double Bass desk, when the Double Bass was written
          v1.stringsDiagnostics.v1!.doubleBass?.written ? v1.stringsDiagnostics.v1!.doubleBass.doubleBass!.trackId : null];
        expect(v1.tracks.filter((t) => !ids.includes(t.id)), label).toEqual(classic.tracks.filter((t) => !ids.includes(t.id)));
        expect(v1.tracks.filter((t) => !isStringTrack(t)), label).toEqual(classic.tracks.filter((t) => !isStringTrack(t)));
        // Stage 6: the Double Bass is composed where the band has a desk; where it was not written the desk is the classic one
        if (!v1.stringsDiagnostics.v1!.doubleBass?.written) expect(v1.tracks.filter((t) => t.role === 'basses'), label).toEqual(classic.tracks.filter((t) => t.role === 'basses'));
        expect(v1.tracks.map((t) => [t.id, t.role, t.name]), label).toEqual(classic.tracks.map((t) => [t.id, t.role, t.name]));
        expect(v1.pianoScore.events, label).toEqual(classic.pianoScore.events);
        expect(v1.plan, label).toEqual(classic.plan);
        expect(v1.stringsDiagnostics.consumed, label).toEqual(classic.stringsDiagnostics.consumed);
        if (!k.written) expect(v1.tracks.filter((t) => CELLO_ROLES.includes(t.role) && t.id !== c.trackId), label).toEqual(classic.tracks.filter((t) => CELLO_ROLES.includes(t.role) && t.id !== c.trackId));
        if (k.written) expect(k.review.unresolved, label).toEqual([]);
        else expect(k.reason, label).toBeTruthy();
      }
    }
  });
});

describe('export of the Cello', () => {
  const project = { ...main.project, tracks: main.result.tracks };
  const track = playable(main.result.tracks).filter((t) => CELLO_ROLES.includes(t.role));
  const data = buildPerTrackMidi(project, track, PROFILE)[0].data;
  const events = parseMidi(Buffer.from(data)).tracks.flat();
  const ons = events.filter((e) => e.type === 'noteOn' && e.velocity > 0) as { noteNumber: number; channel: number; velocity: number }[];
  const key = (a: string): number => caps.articulations.find((x) => x.articulation === a)!.keyMidi!;
  it('reads its keyswitches from the profile: sustain 12, legato 14, pizzicato 16, tremolo 19; zone 12–35; lowest playable note 36', () => {
    expect([key('sustain'), key('legato'), key('pizz'), key('tremolo')]).toEqual([12, 14, 16, 19]);
    expect(caps.keyswitchZone).toEqual({ low: 12, high: 35 });
    expect(caps.playableLow).toBe(36);
  });
  it('exports on channel 4 with only the legato and sustain keys in the zone, in the order the strokes change, and no musical note in the zone', () => {
    expect(new Set(ons.map((e) => e.channel + 1))).toEqual(new Set([4]));
    const zone = ons.filter((e) => e.noteNumber <= 35);
    expect(zone.map((e) => e.noteNumber)).toEqual([14, 12, 14, 12]);
    expect(zone.every((e) => e.noteNumber >= 12)).toBe(true);
    const music = ons.filter((e) => e.noteNumber > 35);
    expect(music.length).toBe(cello.notes.length);
    expect(Math.min(...music.map((e) => e.noteNumber))).toBeGreaterThanOrEqual(36);
  });
  it('sends the pizzicato key, and nothing the profile does not know, where the Cello plucks', () => {
    const r = written.find((x) => celloOf(x.v1).notes.some((n) => n.articulation === 'pizz'))!;
    const t = playable(r.v1.tracks).filter((x) => CELLO_ROLES.includes(x.role));
    const parsed = parseMidi(Buffer.from(buildPerTrackMidi({ ...projectForStringCell(r.cell), tracks: r.v1.tracks }, t, PROFILE)[0].data)).tracks.flat();
    const zone = (parsed.filter((e) => e.type === 'noteOn' && e.velocity > 0) as { noteNumber: number }[]).filter((e) => e.noteNumber <= 35).map((e) => e.noteNumber);
    expect(zone).toContain(16);
    for (const k of zone) expect([12, 14, 16, 19]).toContain(k);
  });
  it('writes only the controllers the profile writes for the part (CC1, CC7, CC11), and no program change', () => {
    const ccs = new Set((events.filter((e) => e.type === 'controller') as { controllerType: number }[]).map((e) => e.controllerType));
    expect([...ccs].sort((a, b) => a - b)).toEqual([1, 7, 11]);
    expect(events.some((e) => e.type === 'programChange')).toBe(false);
  });
  it('exports the Cello to the Cello part: with it, the full file has the same tracks and channels as the classic one', () => {
    const channels = (tracks: Track[], p: typeof project): string[] => parseMidi(Buffer.from(buildMergedMidi(p, playable(tracks), PROFILE))).tracks.map((t) => {
      const nameEvent = t.find((e) => e.type === 'trackName') as { text: string } | undefined;
      const on = t.find((e) => e.type === 'noteOn') as { channel: number } | undefined;
      return `${nameEvent?.text ?? ''}@${on ? on.channel + 1 : '-'}`;
    });
    expect(channels(main.result.tracks, project)).toEqual(channels(mainClassic.result.tracks, { ...mainClassic.project, tracks: mainClassic.result.tracks }));
  });
});
