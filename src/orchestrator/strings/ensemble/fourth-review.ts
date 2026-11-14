/**
 * Four voices together (Strings V1, Stage 5) — the review of the Cello
 * against the two violins and the Viola as they stand, and against the
 * (classic) Double Bass where one sounds.
 *
 * It only reads. Every finding names the Cello stretch it falls in; the
 * caller answers by writing that stretch again one level plainer. No
 * finding can be answered by changing another instrument: nothing here
 * returns their notes.
 *
 * FINDINGS
 *   the two-voice conflicts of Stage 3, for each of the three pairs
 *                     (clash, unresolved dissonance, resolution doubled,
 *                     parallel perfect, direct octave, parallel run,
 *                     crossing — the last not against the Viola while the
 *                     Cello has the theme);
 *   own-line          a Cello gesture is not sound as a line;
 *   out-of-range      under C2 (the keyswitch zone begins below it) or over
 *                     the ceiling;
 *   too-close         a bass note within a minor third of the lowest note
 *                     above it;
 *   under-double-bass / against-double-bass
 *                     the Cello goes under the Double Bass, or holds a
 *                     semitone against it;
 *   shadowing         more than 60 % of a moving stretch's notes off the
 *                     downbeat begin with one and the same upper voice;
 *   doubling          a held third or seventh of the chord that an upper
 *                     voice is holding too;
 *   slow-string       a quaver under G2;
 *   no-breath         more than sixteen beats of bowed notes without a rest;
 *   no-bow-time       a bowed note too soon after a plucked one;
 *   no-contribution   one single bowed note is all that is left of a line.
 *
 * FACTS (never findings): how often the Cello is the lowest voice and how
 * often it carries the chord's bass there, how its notes begin against the
 * others, the time it spends in each role, its register, what it shares
 * with the Viola.
 */
import { CELLO } from '../characters/cello';
import { chordAt, judgeLine, type TonalFrame } from '../material/line';
import type { CelloNote } from '../writers/cello';
import { judgeTogether, soundingPitch, type ConflictKind, type MotionCount, type SoundingNote } from './counterpoint';
import type { FourthPlan } from './fourth-plan';

export type FourthFindingKind = ConflictKind | 'own-line' | 'out-of-range' | 'too-close' | 'under-double-bass' | 'against-double-bass' | 'shadowing' | 'doubling' | 'slow-string' | 'no-breath' | 'no-bow-time' | 'no-contribution';
export type FourthAgainst = 'first' | 'second' | 'viola' | 'double-bass';

export interface FourthFinding {
  readonly span: number | null;
  readonly tick: number;
  readonly kind: FourthFindingKind;
  readonly against: FourthAgainst | null;
  readonly text: string;
}

export interface FourthPairFacts {
  readonly motion: MotionCount;
  readonly sharedOnsets: number;
  /** Time sounding together by the interval between them (beats). */
  readonly together: { readonly thirdsAndSixths: number; readonly fifthsAndOctaves: number; readonly unisonsAndOctaves: number; readonly dissonant: number };
  readonly rhythm: { readonly barsTogether: number; readonly sameRhythm: number };
}

export interface FourthFacts {
  readonly notes: { readonly cello: number; readonly bowed: number; readonly plucked: number; readonly thematic: number };
  /** Beats of the piece: the Cello sounding, silent, all four voices, the Cello alone. */
  readonly beats: { readonly total: number; readonly celloSounds: number; readonly celloSilent: number; readonly allFour: number; readonly celloAlone: number };
  /** Cello note beginnings by how many upper voices begin a note at the same moment. */
  readonly onsets: { readonly cello: number; readonly alone: number; readonly withOne: number; readonly withTwo: number; readonly withThree: number };
  /** Beats in which the Cello is the lowest string sounding / is above the Viola / sounds over a Double Bass. */
  readonly place: { readonly lowestVoice: number; readonly aboveViola: number; readonly overDoubleBass: number };
  /** First beats of a chord on which the Cello plays while it is the floor, and on how many it has the chord's bass. */
  readonly bass: { readonly chordStarts: number; readonly onChordBass: number };
  readonly withFirst: FourthPairFacts;
  readonly withSecond: FourthPairFacts;
  readonly withViola: FourthPairFacts;
  readonly register: readonly [number, number] | null;
  readonly nearestAbove: number | null;
  readonly roleBeats: Readonly<Record<string, number>>;
}

export interface FourthReview {
  readonly findings: readonly FourthFinding[];
  readonly facts: FourthFacts;
}

export interface FourthReviewInput {
  readonly frame: TonalFrame;
  readonly plan: FourthPlan;
  readonly first: readonly SoundingNote[];
  readonly second: readonly SoundingNote[];
  readonly viola: readonly SoundingNote[];
  readonly cello: readonly CelloNote[];
  readonly range: readonly [number, number];
  readonly doubleBassTopIn: (from: number, to: number) => number | null;
  readonly doubleBassPcsIn: (from: number, to: number) => readonly number[];
  readonly endTick: number;
}

export const CELLO_SHADOWING_SHARE = 0.6;
const mod = (n: number, m: number): number => ((n % m) + m) % m;

export function reviewFourthVoice(input: FourthReviewInput): FourthReview {
  const { frame, plan, cello } = input;
  const beat = frame.beatTicks;
  const bar = frame.barTicks;
  const pitch = (n: Pick<SoundingNote, 'step' | 'alter'>): number => soundingPitch(frame, n);
  const findings: FourthFinding[] = [];
  const spanAt = (tick: number): number | null => cello.find((n) => n.tick <= tick && tick < n.tick + n.duration)?.span
    ?? plan.spans.find((s) => s.startTick <= tick && tick < s.endTick)?.index ?? null;
  const beatName = (tick: number): string => `bar ${Math.floor(tick / bar) + 1} beat ${Math.round(((tick % bar) / beat + 1) * 100) / 100}`;
  const uppers: readonly (readonly ['first' | 'second' | 'viola', readonly SoundingNote[]])[] = [['first', input.first], ['second', input.second], ['viola', input.viola]];
  const label = (name: string): string => (name === 'viola' ? 'the Viola' : `the ${name} voice`);
  const bass = cello.filter((n) => n.role !== 'theme');
  const themed = cello.filter((n) => n.role === 'theme');

  // pairs
  const pairs = uppers.map(([name, line]) => {
    const whole = judgeTogether(frame, cello, line, { side: null });
    const conflicts = [
      ...judgeTogether(frame, bass, line, { side: 'below' }).conflicts,
      ...judgeTogether(frame, themed, line, { side: name === 'viola' ? null : 'below' }).conflicts,
    ];
    const seen = new Set<string>();
    for (const conflict of conflicts) {
      const key = `${conflict.kind}@${conflict.tick}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ span: spanAt(conflict.tick), tick: conflict.tick, kind: conflict.kind, against: name, text: `with ${label(name)} — ${conflict.text}` });
    }
    return { name, line, whole };
  });

  // own line: every bowed gesture
  let gesture: CelloNote[] = [];
  const closeGesture = (): void => {
    if (gesture.length) {
      const judged = judgeLine(frame, gesture, { finalStable: true });
      for (const problem of judged.problems) {
        const at = gesture[Math.min(problem.index, gesture.length - 1)];
        findings.push({ span: at.span, tick: at.tick, kind: 'own-line', against: null, text: `the Cello's own line at ${beatName(at.tick)}: ${problem.text}` });
      }
    }
    gesture = [];
  };
  for (const n of cello) {
    if (n.role === 'plucked-bass') { closeGesture(); continue; }
    gesture.push(n);
    if (n.breathAfter) closeGesture();
  }
  closeGesture();

  // place
  let nearest: number | null = null;
  for (const n of cello) {
    const p = pitch(n);
    const end = n.tick + n.duration;
    if (p < input.range[0] || p > input.range[1]) findings.push({ span: n.span, tick: n.tick, kind: 'out-of-range', against: null, text: `${beatName(n.tick)}: MIDI ${p} is outside what the Cello is written for (${input.range[0]}–${input.range[1]})` });
    const over = uppers.flatMap(([, line]) => line.filter((v) => v.tick < end && v.tick + v.duration > n.tick)).map(pitch);
    if (over.length) {
      const distance = Math.min(...over) - p;
      nearest = nearest === null ? distance : Math.min(nearest, distance);
      if (n.role !== 'theme' && distance < CELLO.clearance) findings.push({ span: n.span, tick: n.tick, kind: 'too-close', against: null, text: `${beatName(n.tick)}: the bass is only ${distance} semitones under the lowest note above it` });
    }
    const top = input.doubleBassTopIn(n.tick, end);
    if (top !== null && p < top) findings.push({ span: n.span, tick: n.tick, kind: 'under-double-bass', against: 'double-bass', text: `${beatName(n.tick)}: the Cello (MIDI ${p}) is under the Double Bass (MIDI ${top})` });
    if (n.duration >= beat && input.doubleBassPcsIn(n.tick, end).some((pc) => { const ic = mod(p - pc, 12); return ic === 1 || ic === 11; })) {
      findings.push({ span: n.span, tick: n.tick, kind: 'against-double-bass', against: 'double-bass', text: `${beatName(n.tick)}: the Cello holds a semitone against the Double Bass` });
    }
    if (n.role !== 'plucked-bass' && n.duration <= beat / 2 && p < CELLO.heavyBelow && n.role !== 'theme') findings.push({ span: n.span, tick: n.tick, kind: 'slow-string', against: null, text: `${beatName(n.tick)}: a quaver on the lowest string (MIDI ${p}) does not speak in time` });
    // a held third or seventh that an upper voice is holding too
    const chord = chordAt(frame, n.tick);
    if (chord && n.role !== 'theme' && n.role !== 'plucked-bass' && n.duration >= 2 * beat) {
      const above = mod(p - chord.fact.rootPc, 12);
      if (above !== 0 && above !== 7 && mod(p, 12) !== mod(chord.fact.bassPc, 12)) {
        for (const [name, line] of uppers) {
          const held = line.find((v) => v.tick <= n.tick && v.tick + v.duration >= end && mod(pitch(v) - p, 12) === 0);
          if (held) findings.push({ span: n.span, tick: n.tick, kind: 'doubling', against: name, text: `${beatName(n.tick)}: the Cello holds a note that is neither root, fifth nor bass of the chord and that ${label(name)} is holding too` });
        }
      }
    }
  }

  // per stretch
  for (const span of plan.spans) {
    const own = cello.filter((n) => n.span === span.index);
    if (own.length === 0) continue;
    const moving = own.filter((n) => n.role === 'bass-line' || n.role === 'foundation');
    if (own.every((n) => n.role !== 'plucked-bass' && n.role !== 'arrival') && own.length === 1 && own[0].duration < 2 * beat) {
      findings.push({ span: span.index, tick: own[0].tick, kind: 'no-contribution', against: null, text: `${beatName(own[0].tick)}: one short note is all that is left of the stretch; it adds nothing` });
    }
    const off = moving.filter((n) => n.tick % bar !== 0);
    for (const [name, line] of uppers) {
      const shared = off.filter((n) => line.some((v) => v.tick === n.tick)).length;
      if (off.length >= 4 && shared / off.length > CELLO_SHADOWING_SHARE) findings.push({ span: span.index, tick: own[0].tick, kind: 'shadowing', against: name, text: `${shared} of the Cello's ${off.length} notes off the downbeat begin with ${label(name)}: it shadows that voice's rhythm` });
    }
  }

  // breath and bow
  let unbroken = 0;
  let unbrokenFrom: CelloNote | null = null;
  let reported = false;
  cello.forEach((n, i) => {
    const before = cello[i - 1];
    if (n.role === 'plucked-bass') { unbroken = 0; unbrokenFrom = null; reported = false; return; }
    if (before && before.role === 'plucked-bass' && n.tick - before.tick < (CELLO.arcoPreparationBeats + CELLO.pizzLengthBeats) * beat) {
      findings.push({ span: n.span, tick: n.tick, kind: 'no-bow-time', against: null, text: `${beatName(n.tick)}: no time to take the bow up after the plucked note before it` });
    }
    if (!before || before.role === 'plucked-bass' || before.breathAfter || before.tick + before.duration !== n.tick) { unbroken = 0; unbrokenFrom = n; reported = false; }
    if (n.role !== 'arrival') unbroken += n.duration / beat;
    if (unbroken > CELLO.maxUnbrokenBeats + 4 && !reported) {
      reported = true;
      const from: CelloNote = unbrokenFrom ?? n;
      findings.push({ span: n.span, tick: from.tick, kind: 'no-breath', against: null, text: `from ${beatName(from.tick)}: more than ${CELLO.maxUnbrokenBeats + 4} beats of bowed notes without a rest` });
    }
  });

  // facts
  const beatsTotal = Math.round(input.endTick / beat);
  const inBeat = <T extends { tick: number; duration: number }>(line: readonly T[], b: number): T[] => line.filter((n) => n.tick < (b + 1) * beat && n.tick + n.duration > b * beat);
  const beats = { total: beatsTotal, celloSounds: 0, celloSilent: 0, allFour: 0, celloAlone: 0 };
  const place = { lowestVoice: 0, aboveViola: 0, overDoubleBass: 0 };
  const roleBeats: Record<string, number> = {};
  for (let b = 0; b < beatsTotal; b++) {
    const c = inBeat(cello, b);
    const others = uppers.map(([, line]) => inBeat(line, b));
    if (c.length === 0) { beats.celloSilent++; continue; }
    beats.celloSounds++;
    if (others.every((o) => o.length > 0)) beats.allFour++;
    if (others.every((o) => o.length === 0)) beats.celloAlone++;
    roleBeats[c[0].role] = (roleBeats[c[0].role] ?? 0) + 1;
    const low = Math.min(...c.map(pitch));
    const overBass = input.doubleBassTopIn(b * beat, (b + 1) * beat) !== null;
    if (overBass) place.overDoubleBass++;
    if (!overBass && others.flat().every((n) => pitch(n) >= low)) place.lowestVoice++;
    if (others[2].some((v) => pitch(v) < Math.max(...c.map(pitch)))) place.aboveViola++;
  }
  const onsets = { cello: cello.length, alone: 0, withOne: 0, withTwo: 0, withThree: 0 };
  for (const n of cello) {
    const k = uppers.filter(([, line]) => line.some((v) => v.tick === n.tick)).length;
    if (k === 0) onsets.alone++; else if (k === 1) onsets.withOne++; else if (k === 2) onsets.withTwo++; else onsets.withThree++;
  }
  const bassFacts = { chordStarts: 0, onChordBass: 0 };
  for (const chord of frame.harmony.chords) {
    const n = cello.find((c) => c.tick === chord.fact.startTick && c.isFloor);
    if (!n) continue;
    bassFacts.chordStarts++;
    if (mod(pitch(n), 12) === mod(chord.fact.bassPc, 12)) bassFacts.onChordBass++;
  }
  const r = (x: number): number => Math.round(x * 100) / 100;
  const pairFacts = (line: readonly SoundingNote[], whole: ReturnType<typeof judgeTogether>): FourthPairFacts => {
    const together = { thirdsAndSixths: 0, fifthsAndOctaves: 0, unisonsAndOctaves: 0, dissonant: 0 };
    for (const v of whole.verticals) {
      const long = (v.endTick - v.tick) / beat;
      if (mod(v.semitones, 12) === 0) together.unisonsAndOctaves += long;
      if (v.quality === 'imperfect') together.thirdsAndSixths += long;
      else if (v.quality === 'perfect') together.fifthsAndOctaves += long;
      else together.dissonant += long;
    }
    let barsTogether = 0;
    let sameRhythm = 0;
    for (let b = 0; b * bar < input.endTick; b++) {
      const mine = cello.filter((n) => Math.floor(n.tick / bar) === b).map((n) => n.tick % bar);
      const theirs = line.filter((n) => Math.floor(n.tick / bar) === b).map((n) => n.tick % bar);
      if (!mine.length || !theirs.length) continue;
      barsTogether++;
      if (mine.join() === theirs.join()) sameRhythm++;
    }
    return {
      motion: whole.motion, sharedOnsets: cello.filter((n) => line.some((v) => v.tick === n.tick)).length,
      together: { thirdsAndSixths: r(together.thirdsAndSixths), fifthsAndOctaves: r(together.fifthsAndOctaves), unisonsAndOctaves: r(together.unisonsAndOctaves), dissonant: r(together.dissonant) },
      rhythm: { barsTogether, sameRhythm },
    };
  };
  return {
    findings: findings.sort((x, y) => x.tick - y.tick),
    facts: {
      notes: { cello: cello.length, bowed: cello.filter((n) => n.role !== 'plucked-bass').length, plucked: cello.filter((n) => n.role === 'plucked-bass').length, thematic: themed.length },
      beats, onsets, place, bass: bassFacts,
      withFirst: pairFacts(input.first, pairs[0].whole), withSecond: pairFacts(input.second, pairs[1].whole), withViola: pairFacts(input.viola, pairs[2].whole),
      register: cello.length ? [Math.min(...cello.map(pitch)), Math.max(...cello.map(pitch))] : null,
      nearestAbove: nearest, roleBeats,
    },
  };
}
