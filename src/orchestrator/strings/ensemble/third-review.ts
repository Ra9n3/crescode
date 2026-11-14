/**
 * Review for three voices (Strings V1, Stage 4) — reads the finished
 * passage with the Viola in it and names what is wrong, stretch by stretch.
 * It changes nothing itself, and nothing it finds is ever answered by
 * touching a violin: the caller lowers the Viola's alternative in the
 * stretch (preferred → plainer → silent) and has the Viola written again.
 *
 * What is read:
 *   pairs        every two-voice rule of `judgeTogether`, Viola against the
 *                first voice and Viola against the second, over the whole
 *                passage (also across the joins between stretches);
 *   own line     each bowed gesture as a line of its own;
 *   place        the Viola stays under both violins by its clearance, above
 *                the lower strings, and inside what the instrument plays;
 *   shadowing    a bowed stretch in which most of the Viola's notes begin
 *                with a violin note is not an independent voice;
 *   doubling     a long bowed note on the pitch class a violin holds;
 *   breath       a note past the tick its stretch must end by; a bowed
 *                passage longer than one breath; too little time to take
 *                the bow up again after plucking;
 *   contribution a bowed stretch left with a single note says nothing.
 *
 * The facts are counted for the report. They are not targets.
 */
import { VIOLA } from '../characters/viola';
import { judgeLine, type TonalFrame } from '../material/line';
import type { ViolaNote } from '../writers/viola';
import { judgeTogether, soundingPitch, type ConflictKind, type MotionCount, type SoundingNote } from './counterpoint';
import type { ThirdPlan } from './third-plan';

export type ThirdFindingKind = ConflictKind | 'own-line' | 'too-close' | 'below-lower-strings' | 'out-of-range' | 'shadowing' | 'doubling' | 'no-breath' | 'no-bow-time' | 'no-contribution';

export interface ThirdFinding {
  readonly span: number | null;
  readonly tick: number;
  readonly kind: ThirdFindingKind;
  /** The voice the finding is with; null when it concerns the Viola alone. */
  readonly against: 'first' | 'second' | 'lower-strings' | null;
  readonly text: string;
}

export interface PairFacts {
  readonly motion: MotionCount;
  /** Viola notes beginning together with a note of this voice. */
  readonly sharedOnsets: number;
  /** Time sounding together by the interval between them (beats). */
  readonly together: { readonly thirdsAndSixths: number; readonly fifthsAndOctaves: number; readonly unisonsAndOctaves: number; readonly dissonant: number };
  /** Bars in which both play, and in how many the rhythms are the same. */
  readonly rhythm: { readonly barsTogether: number; readonly sameRhythm: number };
}

export interface ThirdFacts {
  readonly notes: { readonly first: number; readonly second: number; readonly viola: number; readonly bowed: number; readonly plucked: number };
  /** Beats of the piece by how many of the three voices sound. */
  readonly beats: { readonly total: number; readonly violaSounds: number; readonly violaSilent: number; readonly allThree: number; readonly violaAlone: number };
  /** Viola note beginnings: alone, with one violin, with both. */
  readonly onsets: { readonly viola: number; readonly alone: number; readonly withOne: number; readonly withBoth: number };
  readonly withFirst: PairFacts;
  readonly withSecond: PairFacts;
  /** Lowest and highest sounding pitch of each voice. */
  readonly registers: { readonly first: readonly [number, number] | null; readonly second: readonly [number, number] | null; readonly viola: readonly [number, number] | null };
  /** Smallest distance from a Viola note to the lowest violin note sounding with it (semitones); null when they never sound together. */
  readonly nearestViolin: number | null;
  /** Beats the Viola spends in each role. */
  readonly roleBeats: Readonly<Record<string, number>>;
}

export interface ThirdReview {
  readonly findings: readonly ThirdFinding[];
  readonly facts: ThirdFacts;
}

export interface ThirdReviewInput {
  readonly frame: TonalFrame;
  readonly plan: ThirdPlan;
  readonly first: readonly SoundingNote[];
  readonly second: readonly SoundingNote[];
  readonly viola: readonly ViolaNote[];
  readonly range: readonly [number, number];
  /** Highest pitch of the lower strings sounding between two ticks; null when none. */
  readonly lowerStringsTopIn: (from: number, to: number) => number | null;
  readonly endTick: number;
}

/** A bowed stretch is shadowing a violin when more than this share of its notes begin with one. */
export const SHADOWING_SHARE = 0.6;

export function reviewThirdVoice(input: ThirdReviewInput): ThirdReview {
  const { frame, plan, first, second, viola } = input;
  const beat = frame.beatTicks;
  const bar = frame.barTicks;
  const pitch = (n: Pick<SoundingNote, 'step' | 'alter'>): number => soundingPitch(frame, n);
  const findings: ThirdFinding[] = [];
  const spanAt = (tick: number): number | null => {
    const note = viola.find((n) => n.tick <= tick && tick < n.tick + n.duration);
    if (note) return note.span;
    return plan.spans.find((s) => s.startTick <= tick && tick < s.endTick)?.index ?? null;
  };
  const beatName = (tick: number): string => `bar ${Math.floor(tick / bar) + 1} beat ${Math.round(((tick % bar) / beat + 1) * 100) / 100}`;
  const violins: readonly (readonly [ 'first' | 'second', readonly SoundingNote[]])[] = [['first', first], ['second', second]];
  const below = viola.filter((n) => n.role !== 'reply');
  const replies = viola.filter((n) => n.role === 'reply');

  // pairs
  const pairs = violins.map(([name, line]) => {
    const whole = judgeTogether(frame, viola, line, { side: null });
    const under = judgeTogether(frame, below, line, { side: 'below' });
    const seen = new Set<string>();
    for (const conflict of [...under.conflicts, ...judgeTogether(frame, replies, line, { side: null }).conflicts]) {
      const key = `${conflict.kind}@${conflict.tick}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ span: spanAt(conflict.tick), tick: conflict.tick, kind: conflict.kind, against: name, text: `with the ${name} voice — ${conflict.text}` });
    }
    return { name, line, whole };
  });

  // own line: every bowed gesture
  let gesture: ViolaNote[] = [];
  const closeGesture = (): void => {
    if (gesture.length) {
      const judged = judgeLine(frame, gesture, { finalStable: true });
      for (const problem of judged.problems) {
        const at = gesture[Math.min(problem.index, gesture.length - 1)];
        findings.push({ span: at.span, tick: at.tick, kind: 'own-line', against: null, text: `the Viola's own line at ${beatName(at.tick)}: ${problem.text}` });
      }
    }
    gesture = [];
  };
  for (const n of viola) {
    if (n.role === 'pulse') { closeGesture(); continue; }
    gesture.push(n);
    if (n.breathAfter) closeGesture();
  }
  closeGesture();

  // place
  let nearest: number | null = null;
  for (const n of viola) {
    const p = pitch(n);
    if (p < input.range[0] || p > input.range[1]) findings.push({ span: n.span, tick: n.tick, kind: 'out-of-range', against: null, text: `${beatName(n.tick)}: MIDI ${p} is outside what the instrument is written for (${input.range[0]}–${input.range[1]})` });
    const over = violins.flatMap(([, line]) => line.filter((v) => v.tick < n.tick + n.duration && v.tick + v.duration > n.tick)).map(pitch);
    if (over.length) {
      const distance = Math.min(...over) - p;
      nearest = nearest === null ? distance : Math.min(nearest, distance);
      if (n.role !== 'reply' && distance < VIOLA.clearance) findings.push({ span: n.span, tick: n.tick, kind: 'too-close', against: null, text: `${beatName(n.tick)}: only ${distance} semitones under the lowest violin note; the inner register is crowded` });
    }
    const lower = input.lowerStringsTopIn(n.tick, n.tick + n.duration);
    if (lower !== null && p < lower) findings.push({ span: n.span, tick: n.tick, kind: 'below-lower-strings', against: 'lower-strings', text: `${beatName(n.tick)}: the Viola (MIDI ${p}) is under the lower strings (MIDI ${lower})` });
  }

  // per stretch
  for (const span of plan.spans) {
    const own = viola.filter((n) => n.span === span.index);
    if (own.length === 0) continue;
    for (const n of own) {
      if (n.tick + n.duration > span.mustEndBy && n.role !== 'arrival') findings.push({ span: span.index, tick: n.tick, kind: 'no-breath', against: null, text: `${beatName(n.tick)}: the note runs past the breath at the end of its stretch` });
    }
    if (span.role === 'inner-line') {
      if (own.length < 2) findings.push({ span: span.index, tick: own[0].tick, kind: 'no-contribution', against: null, text: `${beatName(own[0].tick)}: a single note is all that is left of the line; it adds nothing` });
      for (const [name, line] of violins) {
        const shared = own.filter((n) => line.some((v) => v.tick === n.tick)).length;
        if (own.length >= 4 && shared / own.length > SHADOWING_SHARE) findings.push({ span: span.index, tick: own[0].tick, kind: 'shadowing', against: name, text: `${shared} of the Viola's ${own.length} notes begin with the ${name} voice: it shadows that voice instead of moving on its own` });
      }
    }
    for (const n of own) {
      if (n.role === 'pulse' || n.duration < 2 * beat) continue;
      for (const [name, line] of violins) {
        const held = line.find((v) => v.tick <= n.tick && v.tick + v.duration >= n.tick + n.duration && (pitch(v) - pitch(n)) % 12 === 0);
        if (held) findings.push({ span: span.index, tick: n.tick, kind: 'doubling', against: name, text: `${beatName(n.tick)}: the Viola holds the note the ${name} voice is holding, an octave apart or in unison` });
      }
    }
  }

  // breath and bow
  let unbroken = 0;
  let unbrokenFrom: ViolaNote | null = null;
  let reported = false;
  viola.forEach((n, i) => {
    const before = viola[i - 1];
    if (n.role === 'pulse') { unbroken = 0; unbrokenFrom = null; reported = false; return; }
    if (before && before.role === 'pulse' && n.tick - before.tick < (VIOLA.arcoPreparationBeats + VIOLA.pizzLengthBeats) * beat) {
      findings.push({ span: n.span, tick: n.tick, kind: 'no-bow-time', against: null, text: `${beatName(n.tick)}: no time to take the bow up after the plucked note before it` });
    }
    if (!before || before.role === 'pulse' || before.breathAfter || before.tick + before.duration !== n.tick) { unbroken = 0; unbrokenFrom = n; reported = false; }
    // the arrival note is the end of the breath, not part of its length
    if (n.role !== 'arrival') unbroken += n.duration / beat;
    if (unbroken > VIOLA.maxUnbrokenBeats + 4 && !reported) {
      reported = true;
      findings.push({ span: n.span, tick: (unbrokenFrom ?? n).tick, kind: 'no-breath', against: null, text: `from ${beatName((unbrokenFrom ?? n).tick)}: more than ${VIOLA.maxUnbrokenBeats + 4} beats of bowed notes without a rest` });
    }
  });

  // facts
  const beatsTotal = Math.round(input.endTick / beat);
  const soundsAt = (line: readonly SoundingNote[], b: number): boolean => line.some((n) => n.tick < (b + 1) * beat && n.tick + n.duration > b * beat);
  const beats = { total: beatsTotal, violaSounds: 0, violaSilent: 0, allThree: 0, violaAlone: 0 };
  const roleBeats: Record<string, number> = {};
  for (let b = 0; b < beatsTotal; b++) {
    const v = soundsAt(viola, b);
    const f = soundsAt(first, b);
    const s = soundsAt(second, b);
    if (v) beats.violaSounds++; else beats.violaSilent++;
    if (v && f && s) beats.allThree++;
    if (v && !f && !s) beats.violaAlone++;
    if (v) {
      const role = viola.find((n) => n.tick < (b + 1) * beat && n.tick + n.duration > b * beat)!.role;
      roleBeats[role] = (roleBeats[role] ?? 0) + 1;
    }
  }
  const onsets = { viola: viola.length, alone: 0, withOne: 0, withBoth: 0 };
  for (const n of viola) {
    const k = violins.filter(([, line]) => line.some((v) => v.tick === n.tick)).length;
    if (k === 0) onsets.alone++; else if (k === 1) onsets.withOne++; else onsets.withBoth++;
  }
  const pairFacts = (line: readonly SoundingNote[], whole: ReturnType<typeof judgeTogether>): PairFacts => {
    const together = { thirdsAndSixths: 0, fifthsAndOctaves: 0, unisonsAndOctaves: 0, dissonant: 0 };
    for (const v of whole.verticals) {
      const beatsLong = (v.endTick - v.tick) / beat;
      const ic = ((v.semitones % 12) + 12) % 12;
      if (ic === 0) together.unisonsAndOctaves += beatsLong;
      if (v.quality === 'imperfect') together.thirdsAndSixths += beatsLong;
      else if (v.quality === 'perfect') together.fifthsAndOctaves += beatsLong;
      else together.dissonant += beatsLong;
    }
    let barsTogether = 0;
    let sameRhythm = 0;
    for (let b = 0; b * bar < input.endTick; b++) {
      const mine = viola.filter((n) => Math.floor(n.tick / bar) === b).map((n) => n.tick % bar);
      const theirs = line.filter((n) => Math.floor(n.tick / bar) === b).map((n) => n.tick % bar);
      if (!mine.length || !theirs.length) continue;
      barsTogether++;
      if (mine.join() === theirs.join()) sameRhythm++;
    }
    const r = (x: number): number => Math.round(x * 100) / 100;
    return {
      motion: whole.motion, sharedOnsets: viola.filter((n) => line.some((v) => v.tick === n.tick)).length,
      together: { thirdsAndSixths: r(together.thirdsAndSixths), fifthsAndOctaves: r(together.fifthsAndOctaves), unisonsAndOctaves: r(together.unisonsAndOctaves), dissonant: r(together.dissonant) },
      rhythm: { barsTogether, sameRhythm },
    };
  };
  const span = (line: readonly SoundingNote[]): readonly [number, number] | null => (line.length ? [Math.min(...line.map(pitch)), Math.max(...line.map(pitch))] : null);
  return {
    findings: findings.sort((x, y) => x.tick - y.tick),
    facts: {
      notes: { first: first.length, second: second.length, viola: viola.length, bowed: viola.filter((n) => n.role !== 'pulse').length, plucked: viola.filter((n) => n.role === 'pulse').length },
      beats, onsets,
      withFirst: pairFacts(first, pairs[0].whole), withSecond: pairFacts(second, pairs[1].whole),
      registers: { first: span(first), second: span(second), viola: span(viola) },
      nearestViolin: nearest, roleBeats,
    },
  };
}
