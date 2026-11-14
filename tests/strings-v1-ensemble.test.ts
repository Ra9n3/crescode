/**
 * Strings V1 Stage 3 — two coordinated violin voices: the plan of
 * relationships, the second voice composed against the first, the review of
 * the two together, and the isolation of everything else (above all the
 * Stage 2 first voice, which must stay exactly as it was).
 * Structural checks only: nothing here says how the music sounds.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import type { ComposeResult } from '../src/orchestrator/compose';
import { buildMergedMidi, buildPerTrackMidi } from '../src/export/midi';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { isInstrumentTrack, type Track } from '../src/shared/schema';
import type { StringsV1Composition } from '../src/orchestrator/strings/composition';
import { DUET_ROLES, type StringsV1Ensemble } from '../src/orchestrator/strings/ensemble/compose';
import { judgeTogether, soundingPitch, type SoundingNote } from '../src/orchestrator/strings/ensemble/counterpoint';
import { planEnsemble } from '../src/orchestrator/strings/ensemble/plan';
import { reviewEnsemble } from '../src/orchestrator/strings/ensemble/review';
import { judgeLine } from '../src/orchestrator/strings/material/line';
import { STRING_FIXTURES, STRING_TEMPLATES, composeStringCell, isStringTrack, type StringCell } from './strings-v1-support';

const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const MAIN: StringCell = { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 0 };
/** The Stage 2 first voice of the reference case, as exported per track under the UVI profile (recorded at the end of Stage 2). */
const STAGE2_VIOLIN2_SHA1 = '42d9ab3391774ea0cd0b1803def8f5640b19329a';
const STAGE2_RECORD = path.join(process.cwd(), 'evaluation', 'strings-v1-stage2', 'audition', 'chamber-dorian-16bars-seed1-take0__v1__voice-only__uvi__05 Violins 2 Ensemble.mid');
const STAGE2_CLASSIC_FULL_SHA1_PREFIX = '52be32e25e69';

const sha1 = (data: Uint8Array | string): string => createHash('sha1').update(data).digest('hex');
const firstOf = (r: ComposeResult): StringsV1Composition => r.stringsDiagnostics.v1!.composition!;
const duetOf = (r: ComposeResult): StringsV1Ensemble => r.stringsDiagnostics.v1!.ensemble!;
const trackOf = (r: ComposeResult, id: string): Track & { notes: unknown[] } => r.tracks.find((t) => t.id === id) as never;
const playable = (r: ComposeResult): Track[] => r.tracks.filter((t) => isInstrumentTrack(t) && t.notes.length > 0);

const main = composeStringCell(MAIN, 'v1');
const mainClassic = composeStringCell(MAIN, 'classic');
const first = firstOf(main.result);
const duet = duetOf(main.result);
const frame = { ...first.frame!, harmony: main.result.stringsDiagnostics.v1!.understanding.harmony };
const BAR = 3840;
const BEAT = 960;

/** A handful of cells with both violins, used where one case is not enough. */
const DUET_CELLS: StringCell[] = [
  MAIN,
  { template: 'chamber', fixture: 'dorian-16bars', seed: 1, take: 1 },
  { template: 'chamber', fixture: 'multi-chorus-16bars', seed: 2, take: 0 },
  { template: 'cinematic', fixture: 'three-chorus-40bars', seed: 1, take: 0 },
  { template: 'symphony', fixture: 'multi-chorus-16bars', seed: 1, take: 0 },
  { template: 'hybridstudio', fixture: 'dorian-16bars', seed: 3, take: 2 },
];
const duetRuns = DUET_CELLS.map((cell) => ({ cell, v1: composeStringCell(cell, 'v1').result, classic: composeStringCell(cell, 'classic').result }));

describe('two-voice rules', () => {
  const note = (tick: number, step: number, duration = BEAT): SoundingNote => ({ tick, duration, step, alter: 0, function: 'chord-tone' });
  it('finds parallel fifths, and accepts the same notes in contrary motion', () => {
    // bar 1 is Dm7: D–A then F–C are two fifths in a row
    const parallel = judgeTogether(frame, [note(0, 4), note(BEAT, 6)], [note(0, 0), note(BEAT, 2)], { side: 'above' });
    expect(parallel.conflicts.map((c) => c.kind)).toContain('parallel-perfect');
    expect(parallel.ok).toBe(false);
    const contrary = judgeTogether(frame, [note(0, 4), note(BEAT, 2)], [note(0, 0), note(BEAT, 0 - 3)], { side: 'above' });
    expect(contrary.conflicts.map((c) => c.kind)).not.toContain('parallel-perfect');
  });
  it('finds a crossing when the voice planned above goes below', () => {
    const crossed = judgeTogether(frame, [note(0, 0)], [note(0, 4)], { side: 'above' });
    expect(crossed.conflicts.map((c) => c.kind)).toContain('crossing');
    expect(judgeTogether(frame, [note(0, 0)], [note(0, 4)], { side: 'below' }).conflicts.map((c) => c.kind)).not.toContain('crossing');
  });
  it('finds a second held between two notes that both claim to be stable', () => {
    const clash = judgeTogether(frame, [note(0, 3, 2 * BEAT)], [note(0, 2, 2 * BEAT)], { side: 'above' });
    expect(clash.ok).toBe(false);
  });
  it('counts motion between the voices', () => {
    const oblique = judgeTogether(frame, [note(0, 4, 2 * BEAT)], [note(0, 0), note(BEAT, 2)], { side: 'above' });
    expect(oblique.motion.oblique).toBe(1);
    expect(oblique.sharedOnsets).toBe(1);
  });
});

describe('relationship planning', () => {
  it('is made from the first voice alone, before any note of the second voice exists', () => {
    const plan = planEnsemble({ frame, theme: first.theme!, phrases: first.phrases, primary: duet.plan!.primary, companion: duet.plan!.companion });
    expect(plan).toEqual(duet.plan);
  });
  it('plans the reference case: listening, countermelody, an answered open ending, imitation, support', () => {
    const spans = duet.plan!.spans;
    expect(spans.map((s) => s.relationship)).toEqual(['listening', 'countermelody', 'listening', 'listening', 'response', 'listening', 'imitation', 'countermelody', 'support', 'support']);
    expect(spans.map((s) => [s.startTick / BEAT, s.endTick / BEAT])).toEqual([[0, 8], [8, 16], [16, 24], [24, 25], [25, 28], [32, 36], [36, 40], [40, 48], [48, 60], [60, 63]]);
    // only the answer puts the second voice in the foreground
    expect(spans.filter((s) => s.foreground === 'companion').map((s) => s.relationship)).toEqual(['response']);
    expect(duet.plan!.phraseNotes).toHaveLength(first.phrases.length);
  });
  it('keeps stretches in order, inside their phrase, with a reason and an intention each', () => {
    for (const { cell, v1 } of duetRuns) {
      const e = duetOf(v1);
      if (!e.plan) continue;
      const phrases = firstOf(v1).phrases;
      let previousEnd = 0;
      for (const s of e.plan.spans) {
        const label = `${cell.template}/${cell.fixture}/${cell.take} stretch ${s.index + 1}`;
        expect(s.startTick, label).toBeGreaterThanOrEqual(previousEnd);
        expect(s.endTick, label).toBeGreaterThan(s.startTick);
        expect(s.mustEndBy, label).toBeLessThanOrEqual(phrases[s.phrase].window.endTick);
        expect(s.startTick, label).toBeGreaterThanOrEqual(phrases[s.phrase].window.startTick);
        expect(s.reason.length, label).toBeGreaterThan(0);
        expect(s.intention.length, label).toBeGreaterThan(0);
        previousEnd = s.endTick;
      }
    }
  });
  it('never sets anything against the first statement of the theme, and answers only open endings', () => {
    for (const { v1 } of duetRuns) {
      const e = duetOf(v1);
      if (!e.plan) continue;
      const phrases = firstOf(v1).phrases;
      expect(e.plan.spans[0].relationship).toBe('listening');
      for (const s of e.plan.spans.filter((x) => x.relationship === 'response')) {
        const phrase = phrases[s.phrase];
        expect(phrase.goal.ending).toBe('open');
        // the answer follows the arrival: it never begins on it
        expect(s.startTick).toBeGreaterThan(phrase.goal.tick);
      }
    }
  });
});

describe('the second voice', () => {
  it('is written on the other violin, inside its range, from the plan', () => {
    for (const { v1 } of duetRuns) {
      const e = duetOf(v1);
      expect(e.written).toBe(true);
      expect(DUET_ROLES).toContain(e.primary!.role);
      expect(DUET_ROLES).toContain(e.companion!.role);
      expect(e.companion!.trackId).not.toBe(e.primary!.trackId);
      expect(e.primary!.trackId).toBe(firstOf(v1).trackId);
      for (const w of e.voiceNotes) {
        expect(w.note.pitch).toBeGreaterThanOrEqual(e.companion!.range[0]);
        expect(w.note.pitch).toBeLessThanOrEqual(e.companion!.range[1]);
        const span = e.plan!.spans[w.source.span];
        expect(w.source.relationship).toBe(span.relationship);
        expect(w.source.tick).toBeGreaterThanOrEqual(span.startTick);
        expect(w.source.tick + w.source.duration).toBeLessThanOrEqual(span.mustEndBy);
      }
    }
  });
  it('records, for every stretch, whether it played and why', () => {
    for (const { v1 } of duetRuns) {
      const e = duetOf(v1);
      expect(e.writing.map((w) => w.span)).toEqual(e.plan!.spans.map((s) => s.index));
      for (const w of e.writing) {
        expect(w.decision.length).toBeGreaterThan(0);
        expect(w.played).toBe(w.notes.length > 0);
        if (e.plan!.spans[w.span].relationship === 'listening') expect(w.played).toBe(false);
        if (w.played) { expect(w.material).not.toBeNull(); expect(w.sound).toBeGreaterThan(0); expect(w.sound).toBeLessThanOrEqual(w.considered); }
      }
    }
  });
  it('rests: it is silent in every listening stretch and does not play merely because it has a track', () => {
    for (const { v1 } of duetRuns) {
      const e = duetOf(v1);
      const listening = e.plan!.spans.filter((s) => s.relationship === 'listening');
      expect(listening.length).toBeGreaterThan(0);
      for (const s of listening) expect(e.line.filter((n) => n.tick < s.endTick && n.tick + n.duration > s.startTick)).toEqual([]);
      const facts = e.review.facts!;
      expect(facts.beats.primaryOnly).toBeGreaterThan(0);
      expect(facts.notes.companion).toBeLessThan(facts.notes.primary);
    }
  });
  it('is not a copy of the first voice and does not shadow it in parallel', () => {
    for (const { v1 } of duetRuns) {
      const e = duetOf(v1);
      const P = e.primaryLine;
      // no bar in which the two voices have the same rhythm AND keep one interval throughout
      const bars = new Set(e.line.map((n) => Math.floor(n.tick / BAR)));
      for (const bar of bars) {
        const a = P.filter((n) => Math.floor(n.tick / BAR) === bar);
        const b = e.line.filter((n) => Math.floor(n.tick / BAR) === bar);
        const sameRhythm = a.length === b.length && a.every((n, i) => n.tick === b[i].tick && n.duration === b[i].duration);
        if (!sameRhythm || a.length < 2) continue;
        const gaps = new Set(a.map((n, i) => n.step - b[i].step));
        expect(gaps.size, `bar ${bar + 1}`).toBeGreaterThan(1);
      }
      // and the two-voice rules hold over the whole passage (parallel perfect intervals, long parallel runs, crossings, clashes)
      expect(e.review.unresolved.filter((f) => f.kind === 'parallel-perfect' || f.kind === 'parallel-run')).toEqual([]);
    }
  });
  it('is sound as a line of its own, gesture by gesture', () => {
    const gestures: SoundingNote[][] = [];
    for (const n of duet.line) {
      const current = gestures[gestures.length - 1];
      const last = current?.[current.length - 1];
      if (!last || (last as typeof n).breathAfter || last.tick + last.duration !== n.tick) gestures.push([n]);
      else current.push(n);
    }
    expect(gestures.length).toBeGreaterThan(1);
    for (const g of gestures) expect(judgeLine(frame, g, { finalStable: true }).problems).toEqual([]);
  });
  it('uses the theme: the imitation is the head, interval for interval, and the answer is its opening', () => {
    const head = first.theme!.notes.filter((n) => n.inHead);
    const headSteps = head.slice(1).map((n, i) => n.step - head[i].step);
    const imitation = duet.writing.find((w) => w.relationship === 'imitation' && w.played)!;
    expect(imitation.notes.slice(1).map((n, i) => n.step - imitation.notes[i].step)).toEqual(headSteps);
    expect(imitation.notes.map((n) => n.duration)).toEqual(head.map((n) => n.duration));
    const answer = duet.writing.find((w) => w.relationship === 'response' && w.played)!;
    expect(answer.notes[1].step - answer.notes[0].step).toBe(headSteps[0]);
    // it enters one beat after the arrival, while the first voice holds or rests
    const goal = first.phrases[0].goal.tick;
    expect(answer.notes[0].tick).toBe(goal + BEAT);
    expect(duet.primaryLine.filter((n) => n.tick > goal && n.tick < answer.notes[answer.notes.length - 1].tick + BEAT)).toEqual([]);
  });
  it('is softer than the first voice where it accompanies, and never louder than the voice limits', () => {
    const firstVelocity = (tick: number): number | null => first.voiceNotes.find((w) => w.note.startTick <= tick && w.note.startTick + w.note.durationTicks > tick)?.note.velocity ?? null;
    for (const w of duet.voiceNotes) {
      expect(w.note.velocity).toBeGreaterThanOrEqual(38);
      expect(w.note.velocity).toBeLessThanOrEqual(100);
      if (w.source.relationship === 'support') {
        const lead = firstVelocity(w.source.tick);
        if (lead !== null) expect(w.note.velocity).toBeLessThan(lead);
      }
    }
  });
});

describe('the two voices together', () => {
  it('pass the review in the reference case, and the review is bounded everywhere', () => {
    expect(duet.review.unresolved).toEqual([]);
    for (const { v1 } of duetRuns) {
      const e = duetOf(v1);
      expect(e.review.passes.length).toBeGreaterThan(0);
      expect(e.review.passes.length).toBeLessThanOrEqual(2 * e.plan!.spans.length + 1);
      // the last pass is the one reported as unresolved
      expect(e.review.passes[e.review.passes.length - 1].findings).toEqual(e.review.unresolved);
    }
  });
  it('the review reports what it is given: the recorded findings are those of the final notes', () => {
    const again = reviewEnsemble({
      frame, plan: duet.plan!, primary: duet.primaryLine, companion: duet.line,
      phrases: first.phrases.map((p) => ({ index: p.index, startTick: p.window.startTick, endTick: p.window.endTick, climaxTick: p.climax.tick })),
      endTick: Math.max(...first.phrases.map((p) => p.window.endTick)),
    });
    expect(again.facts).toEqual(duet.review.facts);
    expect(again.findings.map((f) => f.kind)).toEqual(duet.review.unresolved.map((f) => f.kind));
  });
  it('do not reach their highest notes together where the first voice leads', () => {
    for (const phrase of first.phrases) {
      const inPhrase = duet.line.filter((n) => n.tick >= phrase.window.startTick && n.tick < phrase.window.endTick && n.relationship !== 'response');
      if (inPhrase.length === 0) continue;
      const top = Math.max(...inPhrase.map((n) => soundingPitch(frame, n)));
      const peaks = inPhrase.filter((n) => soundingPitch(frame, n) === top);
      for (const n of peaks) expect(n.tick <= phrase.climax.tick && n.tick + n.duration > phrase.climax.tick && n.tick === phrase.climax.tick).toBe(false);
    }
  });
});

describe('determinism and casting', () => {
  it('gives the same two voices for the same template, fixture, seed and take', { timeout: 60_000 }, () => {
    for (const cell of [MAIN, DUET_CELLS[1], DUET_CELLS[3]]) {
      const a = composeStringCell(cell, 'v1').result;
      const b = composeStringCell(cell, 'v1').result;
      expect(b.tracks).toEqual(a.tracks);
      expect(JSON.stringify(duetOf(b))).toBe(JSON.stringify(duetOf(a)));
      expect(firstOf(b).trackId).toBe(firstOf(a).trackId);
      expect(duetOf(b).companion!.trackId).toBe(duetOf(a).companion!.trackId);
    }
  });
  it('casts by take, not by chance: take 0 puts the theme on Violin II, take 1 on Violin I, every time', { timeout: 60_000 }, () => {
    // Compose All advances the take by one each press; the take changes the classic strings the selection reads.
    const cast = (take: number): [string, string] => {
      const r = composeStringCell({ ...MAIN, take }, 'v1').result;
      return [firstOf(r).trackId!, duetOf(r).companion!.trackId];
    };
    expect(cast(0)).toEqual(['trk_04_violins2', 'trk_03_violins1']);
    expect(cast(1)).toEqual(['trk_03_violins1', 'trk_04_violins2']);
    expect(cast(0)).toEqual(cast(0));
    expect(cast(1)).toEqual(cast(1));
  });
});

describe('Stage 2 first voice preserved', () => {
  const firstTrack = playable(main.result).filter((t) => t.id === first.trackId);
  const file = buildPerTrackMidi({ ...main.project, tracks: main.result.tracks }, firstTrack, PROFILE)[0];
  it('exports the reference Violin II byte for byte as Stage 2 did', () => {
    expect(first.trackId).toBe('trk_04_violins2');
    expect(file.fileName).toBe('05 Violins 2 Ensemble.mid');
    expect(file.data.length).toBe(759);
    expect(sha1(file.data)).toBe(STAGE2_VIOLIN2_SHA1);
    if (existsSync(STAGE2_RECORD)) expect(Buffer.compare(Buffer.from(file.data), readFileSync(STAGE2_RECORD))).toBe(0);
  });
  it('keeps its notes, velocities, timing, phrases and controllers as the first-voice step returned them', () => {
    const track = trackOf(main.result, first.trackId!) as unknown as { notes: unknown; cc: unknown };
    expect(track.notes).toEqual(first.notes);
    expect(track.cc).toEqual(first.cc);
    expect(first.notes).toHaveLength(54);
    expect(first.notes.map((n) => n.pitch).slice(0, 8)).toEqual([62, 71, 69, 67, 65, 67, 64, 62]);
    expect([Math.min(...first.notes.map((n) => n.velocity)), Math.max(...first.notes.map((n) => n.velocity))]).toEqual([49, 81]);
    expect(first.phrases.map((p) => [p.window.startTick, p.window.endTick, p.goal.tick, p.goal.ending, p.climax.tick])).toEqual([[0, 26880, 23040, 'open', 16320], [30720, 61440, 57600, 'closed', 54720]]);
    expect(first.theme!.notes.map((n) => [n.step, n.tick, n.duration])).toEqual([[0, 0, 960], [5, 960, 960], [4, 1920, 1440], [3, 3360, 480], [2, 3840, 960], [3, 4800, 480], [1, 5280, 480], [0, 5760, 1920]]);
  });
  it('holds in every cell: the first voice\'s track is exactly what its own step wrote', () => {
    for (const { v1 } of duetRuns) {
      const c = firstOf(v1);
      const track = trackOf(v1, c.trackId!) as unknown as { notes: unknown; cc: unknown };
      expect(track.notes).toEqual(c.notes);
      expect(track.cc).toEqual(c.cc);
    }
  });
});

describe('isolation', () => {
  it('classic mode has no V1 voices and exports the reference arrangement as before', () => {
    expect(mainClassic.result.stringsDiagnostics.v1).toBeNull();
    const data = buildMergedMidi({ ...mainClassic.project, tracks: mainClassic.result.tracks }, playable(mainClassic.result), PROFILE);
    expect(sha1(data).startsWith(STAGE2_CLASSIC_FULL_SHA1_PREFIX)).toBe(true);
  });
  it('changes the two violins (and, since Stage 4, the Viola; since Stage 5, the Cello; since Stage 6, the Double Bass) and nothing else: every other family equals classic', { timeout: 600_000 }, () => {
    for (const template of STRING_TEMPLATES) {
      for (const fixture of STRING_FIXTURES) {
        const cell = { template, fixture, seed: 1, take: 1 };
        const classic = composeStringCell(cell, 'classic').result;
        const v1 = composeStringCell(cell, 'v1').result;
        const e = duetOf(v1);
        // Stage 4: the Viola's track is the one further track V1 may write
        const third = v1.stringsDiagnostics.v1!.viola!;
        const violaId = third.written ? third.viola!.trackId : null;
        // Stage 5: and the Cello's track
        const fourth = v1.stringsDiagnostics.v1!.cello;
        const celloId = fourth?.written ? fourth.cello!.trackId : null;
        // Stage 6: and the Double Bass desk
        const bassId = v1.stringsDiagnostics.v1!.doubleBass?.written ? v1.stringsDiagnostics.v1!.doubleBass.doubleBass!.trackId : null;
        const ids = [firstOf(v1).trackId, e.written ? e.companion!.trackId : null, violaId, celloId, bassId];
        const label = `${template}/${fixture}`;
        expect(v1.tracks.filter((t) => !ids.includes(t.id)), label).toEqual(classic.tracks.filter((t) => !ids.includes(t.id)));
        for (const id of ids) if (id) expect(DUET_ROLES.includes(trackOf(v1, id).role) || id === firstOf(v1).trackId || id === violaId || id === celloId || id === bassId, label).toBe(true);
        if (violaId) expect(trackOf(v1, violaId).role, label).toBe('violas');
        expect(v1.tracks.filter((t) => !isStringTrack(t)), label).toEqual(classic.tracks.filter((t) => !isStringTrack(t)));
        expect(v1.pianoScore.events, label).toEqual(classic.pianoScore.events);
        expect(v1.plan, label).toEqual(classic.plan);
        expect(v1.stringsDiagnostics.consumed, label).toEqual(classic.stringsDiagnostics.consumed);
      }
    }
  });
  it('writes no second voice when the band has only one violin, and says why', () => {
    for (const template of ['sonata', 'vocalbacking'] as const) {
      const classic = composeStringCell({ ...MAIN, template }, 'classic').result;
      const v1 = composeStringCell({ ...MAIN, template }, 'v1').result;
      const e = duetOf(v1);
      expect(e.written).toBe(false);
      expect(e.reason).toMatch(/no unlocked Violin/);
      expect(e.notes).toEqual([]);
      const id = firstOf(v1).trackId;
      expect(v1.tracks.filter((t) => t.id !== id)).toEqual(classic.tracks.filter((t) => t.id !== id));
    }
  });
  it('replaces the classic part on the second voice\'s track: nothing is layered', () => {
    const track = trackOf(main.result, duet.companion!.trackId) as unknown as { notes: unknown; cc: unknown };
    expect(track.notes).toEqual(duet.notes);
    expect(track.cc).toEqual(duet.cc);
    expect(duet.notes).toHaveLength(duet.voiceNotes.length);
    expect(duet.replacedClassicNotes).toEqual(trackOf(mainClassic.result, duet.companion!.trackId).notes);
  });
});

describe('MIDI export of the two violins', () => {
  const project = { ...main.project, tracks: main.result.tracks };
  it('exports the second voice on its own channel with its keyswitch and controllers', () => {
    const track = playable(main.result).filter((t) => t.id === duet.companion!.trackId);
    const files = buildPerTrackMidi(project, track, PROFILE);
    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('04 Violins 1 Ensemble.mid');
    const parsed = parseMidi(Buffer.from(files[0].data));
    expect(parsed.header.ticksPerBeat).toBe(960);
    const events = parsed.tracks.flat();
    const ons = events.filter((e) => e.type === 'noteOn' && (e as { velocity: number }).velocity > 0) as unknown as { noteNumber: number; channel: number }[];
    expect(new Set(ons.map((e) => e.channel))).toEqual(new Set([0]));
    const pitches = new Set(duet.notes.map((n) => n.pitch));
    const sounding = ons.filter((e) => pitches.has(e.noteNumber));
    const switches = ons.filter((e) => !pitches.has(e.noteNumber));
    expect(sounding).toHaveLength(duet.notes.length);
    expect(switches.length).toBeGreaterThan(0);
    for (const s of switches) expect(s.noteNumber).toBeLessThan(duet.companion!.range[0]);
    const controllers = new Set((events.filter((e) => e.type === 'controller') as unknown as { controllerType: number }[]).map((e) => e.controllerType));
    expect(controllers.has(1)).toBe(true);
    expect(controllers.has(11)).toBe(true);
  });
  it('exports both violins together on two channels, each with all its notes', () => {
    const both = playable(main.result).filter((t) => t.id === first.trackId || t.id === duet.companion!.trackId);
    const parsed = parseMidi(Buffer.from(buildMergedMidi(project, both, null)));
    const ons = parsed.tracks.flat().filter((e) => e.type === 'noteOn' && (e as { velocity: number }).velocity > 0) as unknown as { channel: number }[];
    expect(ons).toHaveLength(first.notes.length + duet.notes.length);
    expect(new Set(ons.map((e) => e.channel)).size).toBe(2);
  });
});
