/**
 * Strings V1 Stage 4 — the Viola as a third independently composed voice:
 * its character, the plan made from both violins, the writing, the
 * three-voice review, the export, and the isolation of everything else
 * (above all the two Stage 3 violins, which must stay exactly as they were).
 * Structural checks only: nothing here says how the music sounds.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import type { ComposeResult } from '../src/orchestrator/compose';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type Note, type Track } from '../src/shared/schema';
import { buildInstrumentCapabilities, triggerableArticulations } from '../src/orchestrator/strings/characters/capabilities';
import { VIOLA, VIOLA_LINE_CELLS, VIOLA_PULSE_CELLS, violaLineMove, violaPulseMove } from '../src/orchestrator/strings/characters/viola';
import { judgeTogether, soundingPitch } from '../src/orchestrator/strings/ensemble/counterpoint';
import type { StringsV1ThirdVoice } from '../src/orchestrator/strings/ensemble/third';
import { planThirdVoice } from '../src/orchestrator/strings/ensemble/third-plan';
import { SHADOWING_SHARE, reviewThirdVoice } from '../src/orchestrator/strings/ensemble/third-review';
import { judgeLine } from '../src/orchestrator/strings/material/line';
import { composeViola, type ViolaLevel, type ViolaNote } from '../src/orchestrator/strings/writers/viola';
import { STRING_FIXTURES, STRING_TEMPLATES, composeStringCell, fingerprintCells, isStringTrack, projectForStringCell, composeOptionsFor, type StringCell } from './strings-v1-support';
import { composeAllTracks } from '../src/orchestrator/compose';

const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const MAIN: StringCell = { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0 };
/** The reference case as exported at the end of Stage 3 (evaluation/strings-v1-stage3/audition). */
const STAGE3 = {
  violinOneAlone: '24958f6acf22d7dfeaa5f3fa4d25b6c9e2df047e',
  violinTwoAlone: '42d9ab3391774ea0cd0b1803def8f5640b19329a',
  bothViolins: '1ff16d23649aa2dd66f6311f423c2697ad6c79b7',
  full: 'a3390a5396217ce0f1216acf233381c2eeca2924',
};
const BAR = 3840;
const BEAT = 960;

const sha1 = (data: Uint8Array): string => createHash('sha1').update(data).digest('hex');
const v1Of = (r: ComposeResult) => r.stringsDiagnostics.v1!;
const violaOf = (r: ComposeResult): StringsV1ThirdVoice => v1Of(r).viola!;
const playable = (tracks: readonly Track[]): Track[] => tracks.filter((t) => isInstrumentTrack(t) && t.notes.length > 0);
const notesOf = (r: ComposeResult, id: string): Note[] => (r.tracks.find((t) => t.id === id) as unknown as { notes: Note[] }).notes;

const main = composeStringCell(MAIN, 'v1');
const mainClassic = composeStringCell(MAIN, 'classic');
const viola = violaOf(main.result);
const first = v1Of(main.result).composition!;
const duet = v1Of(main.result).ensemble!;
const frame = { ...first.frame!, harmony: v1Of(main.result).understanding.harmony };
const pitch = (n: { step: number; alter: number }): number => soundingPitch(frame, n);
const caps = buildInstrumentCapabilities('viola');

/** Cells across templates, fixtures, seeds and takes. */
const CELLS: StringCell[] = [
  MAIN,
  { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 1 },
  { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 3 },
  { template: 'chamber', fixture: 'multi-chorus-16bars', seed: 2, take: 0 },
  { template: 'cinematic', fixture: 'three-chorus-40bars', seed: 1, take: 0 },
  { template: 'symphony', fixture: 'multi-chorus-16bars', seed: 1, take: 0 },
  { template: 'symphony', fixture: 'dorian-16bars', seed: 1, take: 0 },
  { template: 'hybridstudio', fixture: 'dorian-16bars', seed: 3, take: 2 },
];
const runs = CELLS.map((cell) => ({ cell, label: `${cell.template}/${cell.fixture}/seed${cell.seed}/take${cell.take}`, v1: composeStringCell(cell, 'v1').result, classic: composeStringCell(cell, 'classic').result }));
const writtenRuns = runs.filter((r) => violaOf(r.v1).written);

describe('the Viola\'s character', () => {
  it('is its own description, not the violin\'s: register thresholds, rhythms that speak after the beat, plucked figures', () => {
    expect(VIOLA.role).toBe('violas');
    expect(VIOLA.slowBelow).toBeGreaterThan(caps.playableLow!);
    expect(VIOLA.foregroundAbove).toBeLessThan(79);
    // most bowed rhythms do not begin every note on a beat the bar is counted in
    const offBeat = VIOLA_LINE_CELLS.filter((c) => c.notes[0][0] > 0 || c.notes.some(([at]) => at % 1 !== 0));
    expect(offBeat.length).toBeGreaterThan(VIOLA_LINE_CELLS.length / 2);
    for (const cell of [...VIOLA_LINE_CELLS, ...VIOLA_PULSE_CELLS]) {
      for (const [at, length] of cell.notes) expect(at + length, cell.id).toBeLessThanOrEqual(4);
      cell.notes.forEach(([at], i) => { if (i) expect(at, cell.id).toBeGreaterThanOrEqual(cell.notes[i - 1][0] + (cell.id.startsWith('ground') || cell.id.startsWith('after-') && VIOLA_PULSE_CELLS.some((c) => c.id === cell.id) ? 0.5 : cell.notes[i - 1][1])); });
    }
    expect(VIOLA_PULSE_CELLS.filter((c) => c.grounded).every((c) => c.notes[0][0] === 0)).toBe(true);
    expect(VIOLA_PULSE_CELLS.filter((c) => !c.grounded).every((c) => c.notes[0][0] > 0)).toBe(true);
  });
  it('moves by step and third when bowed, by third to fifth when plucked, and refuses a seventh either way', () => {
    expect(violaLineMove(1)).toBeLessThan(violaLineMove(3)!);
    expect(violaLineMove(2)).toBeLessThan(violaLineMove(4)!);
    expect(violaLineMove(6)).toBeNull();
    expect(violaPulseMove(2)).toBeLessThan(violaPulseMove(1)!);
    expect(violaPulseMove(6)).toBeNull();
  });
  it('asks only for strokes the export profile gives this instrument a keyswitch for', () => {
    const triggerable = triggerableArticulations(caps);
    for (const stroke of Object.values(VIOLA.articulation)) expect(triggerable, stroke).toContain(stroke);
    // the profile has no staccato keyswitch for the Viola; the character does not use it
    expect(triggerable).not.toContain('staccato');
    expect(Object.values(VIOLA.articulation)).not.toContain('staccato');
    // spiccato has a key in the profile, but the profile marks it unverified: not used
    expect(caps.articulations.find((a) => a.articulation === 'spiccato')?.keyUnverified).toBe(true);
    expect(Object.values(VIOLA.articulation)).not.toContain('spiccato');
  });
});

describe('three-voice planning', () => {
  const plan = viola.plan!;
  it('gives one stretch per stretch of the two-violin plan, each with a role, an intention and the rule that decided it', () => {
    expect(plan.spans.map((s) => [s.startTick, s.endTick])).toEqual(duet.plan!.spans.map((s) => [s.startTick, s.endTick]));
    for (const s of plan.spans) {
      expect(s.reason).toMatch(/^rule \d — /);
      expect(s.intention.length).toBeGreaterThan(0);
      expect(s.secondVoice).toMatch(/Violin/);
    }
  });
  it('plans the reference case: silent for the first theme and under the low countermelody, a line of its own, an arrival, a plucked figure, a line again', () => {
    expect(plan.spans.map((s) => s.role)).toEqual(['tacet', 'tacet', 'inner-line', 'arrival', 'arrival', 'pulse', 'pulse', 'pulse', 'inner-line', 'arrival']);
    expect(plan.spans[0].reason).toMatch(/heard for the first time/);
    expect(plan.spans[1].reason).toMatch(/crowd/);
  });
  it('does not give the Viola one permanent role, and plans silence', () => {
    for (const r of writtenRuns) {
      const roles = new Set(violaOf(r.v1).plan!.spans.map((s) => s.role));
      expect(roles.has('tacet'), r.label).toBe(true);
      expect(roles.size, r.label).toBeGreaterThanOrEqual(3);
    }
  });
  it('is made from the violins alone: it is the same whatever the Viola later writes, and it reads what the second voice did', () => {
    const lower = () => false;
    const input = {
      frame, duo: duet.plan!, first: viola.firstLine, second: viola.secondLine,
      secondVoice: duet.plan!.spans.map((s) => { const w = duet.writing.find((x) => x.span === s.index); return { span: s.index, relationship: s.relationship, played: !!w?.played, side: w?.side ?? null }; }),
      viola: { trackId: 'x', name: 'Viola', range: [48, 79] as const, singing: [53, 76] as const }, triggerable: ['legato', 'sustain', 'pizz'], lowerStringsSoundIn: lower,
    };
    const a = planThirdVoice(input);
    expect(a.spans.map((s) => s.role)).toEqual(plan.spans.map((s) => s.role));
    // had the second voice stayed silent under the restatement, the inner register would be free
    const silentSecond = planThirdVoice({ ...input, second: [], secondVoice: input.secondVoice.map((w) => ({ ...w, played: false, side: null })) });
    expect(silentSecond.spans[1].role).toBe('pulse');
  });
  it('declines a role whose stroke the instrument cannot trigger instead of approximating it', () => {
    const input = {
      frame, duo: duet.plan!, first: viola.firstLine, second: viola.secondLine,
      secondVoice: duet.plan!.spans.map((s) => { const w = duet.writing.find((x) => x.span === s.index); return { span: s.index, relationship: s.relationship, played: !!w?.played, side: w?.side ?? null }; }),
      viola: { trackId: 'x', name: 'Viola', range: [48, 79] as const, singing: [53, 76] as const }, lowerStringsSoundIn: () => false,
    };
    const noPizz = planThirdVoice({ ...input, triggerable: ['legato', 'sustain'] });
    expect(noPizz.spans.some((s) => s.role === 'pulse')).toBe(false);
    expect(noPizz.spans.filter((s) => /no pizzicato keyswitch/.test(s.reason)).length).toBeGreaterThan(0);
    const noLegato = planThirdVoice({ ...input, triggerable: ['pizz', 'sustain'] });
    expect(noLegato.spans.some((s) => s.role === 'inner-line' || s.role === 'arrival')).toBe(false);
  });
});

describe('the written Viola', () => {
  it('is written on the Viola track, replaces the classic part, and plays less than half of the reference piece', () => {
    expect(viola.written).toBe(true);
    expect(viola.viola!.role).toBe('violas');
    expect(notesOf(main.result, viola.viola!.trackId)).toEqual(viola.notes);
    expect(viola.notes).not.toEqual(notesOf(mainClassic.result, viola.viola!.trackId));
    expect(viola.replacedClassicNotes).toEqual(notesOf(mainClassic.result, viola.viola!.trackId));
    const facts = viola.review.facts!;
    expect(facts.beats.violaSilent).toBeGreaterThan(facts.beats.violaSounds);
  });
  it('records for every stretch whether it played and why, and is silent wherever the plan said tacet', () => {
    for (const r of writtenRuns) {
      const v = violaOf(r.v1);
      expect(v.writing.length, r.label).toBe(v.plan!.spans.length);
      for (const s of v.plan!.spans) {
        const w = v.writing[s.index];
        expect(w.decision.length, r.label).toBeGreaterThan(0);
        if (s.role === 'tacet') {
          expect(w.played, r.label).toBe(false);
          expect(v.line.some((n) => n.tick < s.endTick && n.tick + n.duration > s.startTick && n.span === s.index), r.label).toBe(false);
        }
        expect(w.notes.every((n) => n.span === s.index), r.label).toBe(true);
      }
    }
  });
  it('stays inside what the instrument plays, clear of the keyswitch zone, and under both violins', () => {
    for (const r of writtenRuns) {
      const v = violaOf(r.v1);
      const f = { ...v1Of(r.v1).composition!.frame!, harmony: v1Of(r.v1).understanding.harmony };
      for (const n of v.notes) {
        expect(n.pitch, r.label).toBeGreaterThanOrEqual(caps.playableLow!);
        expect(n.pitch, r.label).toBeGreaterThan(caps.keyswitchZone!.high);
        expect(n.pitch, r.label).toBeLessThanOrEqual(v.viola!.range[1]);
      }
      for (const n of v.line) {
        if (n.role === 'reply') continue;
        const over = [...v.firstLine, ...v.secondLine].filter((x) => x.tick < n.tick + n.duration && x.tick + x.duration > n.tick).map((x) => soundingPitch(f, x));
        if (over.length) expect(Math.min(...over) - soundingPitch(f, n), `${r.label} tick ${n.tick}`).toBeGreaterThanOrEqual(VIOLA.clearance);
      }
    }
  });
  it('is one line: no two of its notes begin together, and a bowed note is never repeated under one bow', () => {
    for (const r of writtenRuns) {
      const line = violaOf(r.v1).line;
      line.forEach((n, i) => {
        if (!i) return;
        const before = line[i - 1];
        expect(n.tick, r.label).toBeGreaterThanOrEqual(before.tick + before.duration);
        if (n.role !== 'pulse' && before.role !== 'pulse' && !before.breathAfter) expect([n.step, n.alter], `${r.label} tick ${n.tick}`).not.toEqual([before.step, before.alter]);
      });
    }
  });
  it('writes each role with its own stroke: legato lines, a sustained arrival, a plucked figure', () => {
    for (const r of writtenRuns) {
      for (const w of violaOf(r.v1).voiceNotes) {
        expect(w.note.articulation, r.label).toBe(VIOLA.articulation[w.source.role as 'pulse']);
        if (w.source.role === 'pulse') expect(w.note.durationTicks, r.label).toBe(VIOLA.pizzLengthBeats * BEAT);
      }
    }
    expect(new Set(viola.notes.map((n) => n.articulation))).toEqual(new Set(['legato', 'sustain', 'pizz']));
  });
  it('leaves the hand time to take the bow up after plucking', () => {
    for (const r of writtenRuns) {
      const line = violaOf(r.v1).line;
      line.forEach((n, i) => {
        const before = line[i - 1];
        if (before && before.role === 'pulse' && n.role !== 'pulse') expect(n.tick - before.tick, r.label).toBeGreaterThanOrEqual((VIOLA.arcoPreparationBeats + VIOLA.pizzRingBeats) * BEAT);
      });
    }
  });
  it('breathes: bowed gestures end with a lifted bow, and none runs longer than the review allows', () => {
    for (const r of writtenRuns) {
      const v = violaOf(r.v1);
      let unbroken = 0;
      v.line.forEach((n, i) => {
        const before = v.line[i - 1];
        if (n.role === 'pulse') { unbroken = 0; return; }
        if (!before || before.role === 'pulse' || before.breathAfter || before.tick + before.duration !== n.tick) unbroken = 0;
        if (n.role !== 'arrival') unbroken += n.duration / BEAT;
        expect(unbroken, r.label).toBeLessThanOrEqual(VIOLA.maxUnbrokenBeats + 4);
      });
      for (const w of v.voiceNotes) if (w.source.role !== 'pulse' && w.source.breathAfter) expect(w.note.durationTicks, r.label).toBeLessThan(w.source.duration);
    }
  });
  it('shapes loudness by role: a plucked figure and an arrival sit under the line, and every note stays under a leading voice', () => {
    expect(VIOLA.level.arrival).toBeLessThan(VIOLA.level.pulse);
    expect(VIOLA.level.pulse).toBeLessThan(VIOLA.level['inner-line']);
    const arrival = viola.voiceNotes.find((w) => w.source.role === 'arrival')!;
    const lineBefore = viola.voiceNotes.filter((w) => w.source.role === 'inner-line' && w.source.tick < arrival.source.tick);
    expect(arrival.note.velocity).toBeLessThan(Math.min(...lineBefore.map((w) => w.note.velocity)));
    for (const w of viola.voiceNotes) expect(w.shaping.length).toBeGreaterThan(0);
    // the first plucked note of a bar is the strongest of its bar
    const pulse = viola.voiceNotes.filter((w) => w.source.role === 'pulse');
    for (const w of pulse) {
      const sameBar = pulse.filter((x) => Math.floor(x.source.tick / BAR) === Math.floor(w.source.tick / BAR));
      expect(sameBar[0].note.velocity).toBe(Math.max(...sameBar.map((x) => x.note.velocity)));
    }
  });
  it('carries controller lanes the profile writes (CC1, CC11) on its own track', () => {
    const lanes = viola.cc.map((l) => l.cc);
    expect(lanes).toContain(1);
    expect(lanes).toContain(11);
  });
});

describe('independence and compatibility', () => {
  it('is sound as a line of its own, gesture by gesture', () => {
    for (const r of writtenRuns) {
      const v = violaOf(r.v1);
      const f = { ...v1Of(r.v1).composition!.frame!, harmony: v1Of(r.v1).understanding.harmony };
      let gesture: ViolaNote[] = [];
      const close = (): void => { if (gesture.length) expect(judgeLine(f, gesture, { finalStable: true }).problems, r.label).toEqual([]); gesture = []; };
      for (const n of v.line) { if (n.role === 'pulse') { close(); continue; } gesture.push(n); if (n.breathAfter) close(); }
      close();
    }
  });
  it('breaks no two-voice rule against either violin', () => {
    for (const r of writtenRuns) {
      const v = violaOf(r.v1);
      const f = { ...v1Of(r.v1).composition!.frame!, harmony: v1Of(r.v1).understanding.harmony };
      const below = v.line.filter((n) => n.role !== 'reply');
      expect(judgeTogether(f, below, v.firstLine, { side: 'below' }).conflicts, r.label).toEqual([]);
      expect(judgeTogether(f, below, v.secondLine, { side: 'below' }).conflicts, r.label).toEqual([]);
    }
  });
  it('does not copy either violin: no bar of the reference case has a violin\'s rhythm and pitch classes, and most of its notes begin alone or with one violin only', () => {
    const facts = viola.review.facts!;
    expect(facts.withSecond.rhythm.sameRhythm).toBe(0);
    expect(facts.withFirst.rhythm.sameRhythm).toBeLessThanOrEqual(1);
    expect(facts.onsets.withBoth).toBeLessThan(facts.onsets.viola / 4);
    expect(facts.onsets.alone).toBeGreaterThanOrEqual(facts.onsets.withBoth);
    for (const line of [viola.firstLine, viola.secondLine]) {
      for (let b = 0; b < 16; b++) {
        const mine = viola.line.filter((n) => Math.floor(n.tick / BAR) === b).map((n) => `${n.tick % BAR}:${pitch(n) % 12}`).join();
        const theirs = line.filter((n) => Math.floor(n.tick / BAR) === b).map((n) => `${n.tick % BAR}:${pitch(n) % 12}`).join();
        if (mine) expect(mine).not.toBe(theirs);
      }
    }
  });
  it('never shadows a violin through a bowed stretch, in any case', () => {
    for (const r of writtenRuns) {
      const v = violaOf(r.v1);
      for (const s of v.plan!.spans.filter((x) => x.role === 'inner-line')) {
        const own = v.line.filter((n) => n.span === s.index);
        if (own.length < 4) continue;
        for (const line of [v.firstLine, v.secondLine]) expect(own.filter((n) => line.some((x) => x.tick === n.tick)).length / own.length, r.label).toBeLessThanOrEqual(SHADOWING_SHARE);
      }
    }
  });
  it('does not go under the lower strings', () => {
    for (const r of writtenRuns) {
      const v = violaOf(r.v1);
      const lower = r.classic.tracks.filter((t) => ['cellos', 'cellosBasses', 'basses'].includes(t.role)).flatMap((t) => (t as unknown as { notes: Note[] }).notes);
      for (const w of v.voiceNotes) {
        const end = w.source.tick + w.source.duration;
        const under = lower.filter((n) => n.startTick < end && n.startTick + n.durationTicks > w.source.tick).map((n) => n.pitch);
        if (under.length) expect(w.note.pitch, `${r.label} tick ${w.source.tick}`).toBeGreaterThanOrEqual(Math.max(...under));
      }
    }
  });
});

describe('three-voice review', () => {
  const base = { frame, plan: viola.plan!, first: viola.firstLine, second: viola.secondLine, range: [48, 79] as const, lowerStringsTopIn: () => null, endTick: 16 * BAR };
  it('finds nothing in the passage it accepted, and every pass lowered exactly one stretch by one step towards silence', () => {
    for (const r of writtenRuns) {
      const v = violaOf(r.v1);
      expect(v.review.unresolved, r.label).toEqual([]);
      expect(v.review.passes.length, r.label).toBeLessThanOrEqual(2 * v.plan!.spans.length + 1);
      expect(v.review.passes[v.review.passes.length - 1].action, r.label).toBeNull();
      for (const p of v.review.passes.slice(0, -1)) expect(p.action, r.label).toMatch(/written again as '(plainer|silent)'/);
    }
  });
  it('corrected the reference case by leaving out a doubled last note, not by touching a violin', () => {
    expect(viola.review.passes[0].findings.map((f) => f.kind)).toEqual(['doubling']);
    expect(viola.review.passes[0].action).toMatch(/stretch 10 \(arrival\) written again as 'silent'/);
    expect(viola.writing[9].played).toBe(false);
    expect(viola.firstLine).toEqual(duet.primaryLine);
    expect(viola.secondLine).toEqual(duet.line);
  });
  it('names a Viola that sits on top of a violin, one that doubles a held note, and one that shadows a voice', () => {
    // a copy of the second voice's low countermelody: too close, and in unison
    const copied: ViolaNote[] = viola.secondLine.filter((n) => n.tick < 5 * BAR).map((n) => ({ ...n, span: 1, role: 'inner-line', breathAfter: false, cell: null }));
    const kinds = new Set(reviewThirdVoice({ ...base, viola: copied }).findings.map((f) => f.kind));
    expect(kinds.has('too-close')).toBe(true);
    expect(kinds.has('shadowing') || kinds.has('doubling')).toBe(true);
    // the first voice an octave lower, note for note
    const octave: ViolaNote[] = viola.firstLine.filter((n) => n.tick >= 4 * BAR && n.tick < 6 * BAR).map((n) => ({ ...n, step: n.step - 7, span: 2, role: 'inner-line', breathAfter: false, cell: null }));
    const found = reviewThirdVoice({ ...base, viola: octave }).findings;
    expect(found.some((f) => f.kind === 'shadowing' && f.against === 'first')).toBe(true);
    expect(found.some((f) => f.kind === 'parallel-perfect' || f.kind === 'parallel-run')).toBe(true);
  });
  it('names a note outside the instrument and a note under the lower strings', () => {
    const low: ViolaNote[] = [{ tick: 4 * BAR, duration: BEAT, step: -15, alter: 0, function: 'chord-tone', span: 2, role: 'inner-line', breathAfter: true, cell: null }];
    expect(reviewThirdVoice({ ...base, viola: low }).findings.map((f) => f.kind)).toContain('out-of-range');
    const fine = viola.line.filter((n) => n.span === 2);
    expect(reviewThirdVoice({ ...base, viola: fine, lowerStringsTopIn: () => 70 }).findings.map((f) => f.kind)).toContain('below-lower-strings');
  });
  it('is answered only by simplifying the Viola: plainer is plainer, silent is silent', () => {
    const write = (levels: ViolaLevel[]) => composeViola({
      frame, theme: first.theme!, plan: viola.plan!, first: viola.firstLine, second: viola.secondLine, range: [48, 79], singing: [53, 76], levels,
      intensityAt: () => 0.6, lowerStringsSoundIn: () => true, lowerStringsTopIn: () => null,
    });
    const spans = viola.plan!.spans;
    const preferred = write(spans.map(() => 0));
    const plainer = write(spans.map(() => 1));
    const silent = write(spans.map(() => 2));
    expect(silent.notes).toEqual([]);
    expect(silent.spans.every((w) => !w.played)).toBe(true);
    expect(plainer.notes.length).toBeLessThan(preferred.notes.length);
    expect(plainer.notes.filter((n) => n.role === 'inner-line').every((n) => n.duration >= BEAT)).toBe(true);
    // lowering one stretch leaves the stretches of the other phrase as they were
    const one = write(spans.map((_, i) => (i === 8 ? 2 : 0)));
    expect(one.notes.filter((n) => n.span < 5)).toEqual(preferred.notes.filter((n) => n.span < 5));
    expect(one.notes.some((n) => n.span === 8)).toBe(false);
  });
});

describe('determinism', () => {
  it('gives the same Viola for the same template, fixture, seed and take', { timeout: 120_000 }, () => {
    for (const cell of [MAIN, CELLS[3], CELLS[4]]) {
      const a = composeStringCell(cell, 'v1').result;
      const b = composeStringCell(cell, 'v1').result;
      expect(JSON.stringify(violaOf(b))).toBe(JSON.stringify(violaOf(a)));
      expect(b.tracks).toEqual(a.tracks);
    }
  });
  it('changes with the take, because the violins it answers change', () => {
    expect(violaOf(runs[1].v1).notes).not.toEqual(viola.notes);
  });
});

describe('silence and declining', () => {
  it('writes no Viola, and keeps the classic part, where the two-violin plan does not exist', { timeout: 120_000 }, () => {
    for (const template of ['sonata', 'vocalbacking'] as const) {
      const cell: StringCell = { template, fixture: 'dorian-16bars', seed: 1, take: 0 };
      const v1 = composeStringCell(cell, 'v1').result;
      const classic = composeStringCell(cell, 'classic').result;
      const v = violaOf(v1);
      expect(v.written, template).toBe(false);
      expect(v.reason, template).toMatch(/two-violin plan does not exist|no first voice|no unlocked Viola/);
      for (const t of classic.tracks.filter((x) => x.role === 'violas')) expect(v1.tracks.find((x) => x.id === t.id), template).toEqual(t);
    }
  });
  it('writes no Viola when the Viola track is locked, and leaves that track untouched', () => {
    const project = projectForStringCell(MAIN);
    const before = project.tracks.find((t) => t.role === 'violas')!;
    before.locked = true;
    const snapshot = JSON.stringify(before);
    const result = composeAllTracks(project, composeOptionsFor(MAIN, 'v1'));
    const v = violaOf(result);
    expect(v.written).toBe(false);
    expect(v.reason).toMatch(/no unlocked Viola track/);
    expect(JSON.stringify(result.tracks.find((t) => t.role === 'violas'))).toBe(snapshot);
  });
  it('never writes a Viola in classic mode', () => {
    expect(mainClassic.result.stringsDiagnostics.v1).toBeNull();
  });
});

describe('Stage 3 violins preserved', () => {
  const project = { ...main.project, tracks: main.result.tracks };
  const violinOne = playable(main.result.tracks).filter((t) => t.role === 'violins1');
  const violinTwo = playable(main.result.tracks).filter((t) => t.role === 'violins2');
  it('exports each violin of the reference case byte for byte as Stage 3 did', () => {
    expect(sha1(buildPerTrackMidi(project, violinOne, PROFILE)[0].data)).toBe(STAGE3.violinOneAlone);
    expect(sha1(buildPerTrackMidi(project, violinTwo, PROFILE)[0].data)).toBe(STAGE3.violinTwoAlone);
    expect(sha1(buildMergedMidi(project, [...violinOne, ...violinTwo].sort((a, b) => main.result.tracks.indexOf(a) - main.result.tracks.indexOf(b)), PROFILE))).toBe(STAGE3.bothViolins);
  });
  it('gives the Stage 3 full arrangement back, byte for byte, when the classic Viola (and, since Stage 5, the classic Cello) is put back', () => {
    const classicViola = mainClassic.result.tracks.find((t) => t.role === 'violas')!;
    const celloId = v1Of(main.result).cello?.written ? v1Of(main.result).cello!.cello!.trackId : null;
    const classicCello = mainClassic.result.tracks.find((t) => t.id === celloId);
    const tracks = main.result.tracks.map((t) => (t.role === 'violas' ? classicViola : t.id === celloId && classicCello ? classicCello : t));
    expect(sha1(buildMergedMidi({ ...main.project, tracks }, playable(tracks), PROFILE))).toBe(STAGE3.full);
  });
  it('leaves both violins as the first-voice and second-voice steps returned them, in every case', () => {
    for (const r of runs) {
      const c = v1Of(r.v1).composition!;
      const e = v1Of(r.v1).ensemble!;
      if (c.written) expect(notesOf(r.v1, c.trackId!), r.label).toEqual(c.notes);
      if (e.written) expect(notesOf(r.v1, e.companion!.trackId), r.label).toEqual(e.notes);
    }
  });
});

describe('isolation', () => {
  it('changes the Viola track and nothing else relative to Stage 3 (Stage 5 adds the Cello, Stage 6 the Double Bass): every other family equals classic', { timeout: 600_000 }, () => {
    for (const template of STRING_TEMPLATES) {
      for (const fixture of STRING_FIXTURES) {
        const cell = { template, fixture, seed: 1, take: 2 };
        const classic = composeStringCell(cell, 'classic').result;
        const v1 = composeStringCell(cell, 'v1').result;
        const label = `${template}/${fixture}`;
        const c = v1Of(v1).composition!;
        const e = v1Of(v1).ensemble!;
        const v = violaOf(v1);
        // Stage 5: the Cello's track is composed too
        const fourth = v1Of(v1).cello;
        const ids = [c.trackId, e.written ? e.companion!.trackId : null, v.written ? v.viola!.trackId : null, fourth?.written ? fourth.cello!.trackId : null,
          // Stage 6: and the Double Bass desk, when the Double Bass was written
          v1.stringsDiagnostics.v1!.doubleBass?.written ? v1.stringsDiagnostics.v1!.doubleBass.doubleBass!.trackId : null];
        expect(v1.tracks.filter((t) => !ids.includes(t.id)), label).toEqual(classic.tracks.filter((t) => !ids.includes(t.id)));
        expect(v1.tracks.filter((t) => !isStringTrack(t)), label).toEqual(classic.tracks.filter((t) => !isStringTrack(t)));
        // Stage 6: the Double Bass is composed where the band has a desk; where it was not written the desk is the classic one
        if (!v1.stringsDiagnostics.v1!.doubleBass?.written) expect(v1.tracks.filter((t) => t.role === 'basses'), label).toEqual(classic.tracks.filter((t) => t.role === 'basses'));
        if (!fourth?.written) expect(v1.tracks.filter((t) => ['cellos', 'cellosBasses'].includes(t.role) && t.id !== c.trackId), label).toEqual(classic.tracks.filter((t) => ['cellos', 'cellosBasses'].includes(t.role) && t.id !== c.trackId));
        expect(v1.pianoScore.events, label).toEqual(classic.pianoScore.events);
        expect(v1.plan, label).toEqual(classic.plan);
        expect(v1.stringsDiagnostics.consumed, label).toEqual(classic.stringsDiagnostics.consumed);
        // (the Stage 2 selection may itself have put the first voice on the Viola; then that track is the first voice's)
        if (!v.written) expect(v1.tracks.filter((t) => t.role === 'violas' && t.id !== c.trackId), label).toEqual(classic.tracks.filter((t) => t.role === 'violas' && t.id !== c.trackId));
      }
    }
  });
  it('either clears every finding or keeps the classic Viola, on every fingerprint cell', { timeout: 900_000 }, () => {
    let written = 0;
    for (const cell of fingerprintCells()) {
      const v = violaOf(composeStringCell(cell, 'v1').result);
      if (v.written) { written++; expect(v.review.unresolved, JSON.stringify(cell)).toEqual([]); }
      else expect(v.reason, JSON.stringify(cell)).toBeTruthy();
    }
    expect(written).toBeGreaterThan(0);
  });
});

describe('export of the Viola', () => {
  const project = { ...main.project, tracks: main.result.tracks };
  const track = playable(main.result.tracks).filter((t) => t.role === 'violas');
  const parsed = parseMidi(Buffer.from(buildPerTrackMidi(project, track, PROFILE)[0].data));
  const events = parsed.tracks.flatMap((t) => { let abs = 0; return t.map((e) => { abs += e.deltaTime; return { ...e, abs }; }); });
  const ons = events.filter((e) => e.type === 'noteOn' && (e as { velocity: number }).velocity > 0) as unknown as { noteNumber: number; channel: number; abs: number }[];
  const zone = caps.keyswitchZone!;
  const keyOf = (a: string): number => caps.articulations.find((x) => x.articulation === a)!.keyMidi!;
  it('reads its keyswitches from the profile: legato D0 = 26, sustain C0 = 24, pizzicato F0 = 29', () => {
    expect([keyOf('legato'), keyOf('sustain'), keyOf('pizz')]).toEqual([26, 24, 29]);
    expect([zone.low, zone.high, caps.playableLow]).toEqual([24, 47, 48]);
  });
  it('exports on channel 3 with exactly those keyswitch notes in the zone, in the order the roles change, and no musical note in the zone', () => {
    expect(new Set(ons.map((e) => e.channel + 1))).toEqual(new Set([3]));
    const switches = ons.filter((e) => e.noteNumber >= zone.low && e.noteNumber <= zone.high);
    expect(switches.map((e) => e.noteNumber)).toEqual([26, 24, 29, 26]);
    const musical = ons.filter((e) => e.noteNumber > zone.high);
    expect(musical.length).toBe(viola.notes.length);
    expect(Math.min(...musical.map((e) => e.noteNumber))).toBeGreaterThanOrEqual(48);
    expect(viola.notes.every((n) => n.pitch > zone.high)).toBe(true);
    // every keyswitch precedes the first note it applies to
    for (const s of switches) expect(musical.some((m) => m.abs > s.abs)).toBe(true);
  });
  it('writes only the controllers the profile writes for the part, and no program change', () => {
    const ccs = new Set(events.filter((e) => e.type === 'controller').map((e) => (e as unknown as { controllerType: number }).controllerType));
    for (const cc of ccs) expect(caps.controllersWritten).toContain(cc);
    expect(ccs.has(1) && ccs.has(11)).toBe(true);
    expect(events.some((e) => e.type === 'programChange')).toBe(false);
  });
});
