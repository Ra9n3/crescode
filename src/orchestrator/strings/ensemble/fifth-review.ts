/**
 * The five-voice review (Strings V1, Stage 6) — reads the finished Double
 * Bass against the four voices above it and against the harmony, and says
 * what is wrong with the Double Bass. It changes nothing: every finding
 * names a stretch of the Double Bass, and the caller answers it by writing
 * that stretch plainer or leaving it out. No finding can be answered by
 * touching another voice.
 *
 * WHAT COUNTS AS DOUBLING. Two things are told apart:
 *   - long tones an octave under the Cello's bass are the oldest use of the
 *     instrument: reported as a fact (`celloOctaveShare`), never a finding;
 *   - a Double Bass that moves, plucks or pulses in the Cello's rhythm on
 *     the Cello's notes adds a register and no voice: a finding
 *     (`cello-shadow`);
 *   - the same pitch as the Cello for most of a stretch adds nothing at
 *     all: a finding (`cello-unison`), whatever the manner.
 */
import { DOUBLE_BASS, doubleBassMove } from '../characters/double-bass';
import { chordAt, type TonalFrame } from '../material/line';
import type { DoubleBassNote } from '../writers/double-bass';
import { FIFTH_AGAINST, FIFTH_VOICE_NAMES, clashOf, mod12, overlapTicks, parallelOf, type FifthAgainst, type FifthOthers } from './fifth-hearing';
import type { FifthPlan } from './fifth-plan';

export type FifthFindingKind =
  | 'out-of-range' | 'keyswitch-zone' | 'above-voice' | 'clash' | 'not-the-bass' | 'against-harmony' | 'untreated-dissonance'
  | 'parallel-fifths' | 'parallel-octaves' | 'cello-shadow' | 'cello-unison' | 'too-short' | 'no-breath' | 'monotony' | 'bass-leap';

export interface FifthFinding {
  readonly kind: FifthFindingKind;
  /** The stretch of the Double Bass the finding lies in; null when it cannot be placed. */
  readonly span: number | null;
  readonly tick: number;
  readonly against: FifthAgainst | 'harmony' | 'itself';
  readonly text: string;
}

export interface FifthPairFacts {
  /** Share of the Double Bass's attacks that fall together with an attack of this voice. */
  readonly attacksTogether: number;
  /** Share of the Double Bass's sounding time in which this voice sounds the same pitch class. */
  readonly samePitchClassShare: number;
  /** Share of the Double Bass's sounding time in which this voice sounds the very same pitch. */
  readonly unisonShare: number;
  /** Share of the Double Bass's sounding time in which this voice sounds below it. */
  readonly belowShare: number;
}

export interface FifthFacts {
  readonly notes: number;
  readonly lowest: number | null;
  readonly highest: number | null;
  readonly soundingBeats: number;
  readonly silentBeats: number;
  /** Share of its sounding time in which the Double Bass is the lowest voice (a unison counts). */
  readonly lowestVoiceShare: number;
  /** Chords that begin while the Double Bass attacks, and how many of those attacks are the chord's bass. */
  readonly chordStartsAttacked: number;
  readonly chordStartsOnBass: number;
  readonly passingNotes: number;
  readonly thematicNotes: number;
  readonly rolesWritten: readonly string[];
  readonly rhythms: readonly string[];
  readonly longestUnbrokenBeats: number;
  /** Parallel octaves or unisons with the Cello (the old orchestral doubling): counted, not a finding. */
  readonly parallelOctavesWithCello: number;
  /**
   * Parallel fifths or octaves between the harmony's own bass (the first note of a chord) and an inner voice.
   * The Double Bass has no other note there; they are recorded, not answered. With the leading voice, or on a note
   * the Double Bass chose freely, the same thing is a finding.
   */
  readonly parallelsOnTheHarmonysBass: readonly string[];
  /** Share of the Double Bass's long tones (foundation, arrival) that lie an octave or two under the Cello's note. */
  readonly celloOctaveShare: number;
  /** The most attacks the five voices make inside one beat. */
  readonly mostAttacksInABeat: number;
  readonly pairs: Readonly<Record<FifthAgainst, FifthPairFacts>>;
}

export interface FifthReview {
  readonly findings: readonly FifthFinding[];
  readonly facts: FifthFacts;
}

export interface FifthReviewInput {
  readonly frame: TonalFrame;
  readonly plan: FifthPlan;
  readonly others: FifthOthers;
  readonly bass: readonly DoubleBassNote[];
  readonly range: readonly [number, number];
  readonly keyswitchZone: { readonly low: number; readonly high: number } | null;
  readonly endTick: number;
}

/** Above this share of a stretch's attacks struck with the Cello on the Cello's pitch class — in both directions — the Double Bass is the Cello's shadow. */
export const DOUBLE_BASS_SHADOWING_SHARE = 0.6;
/** Above this share of a stretch's sounding time on the Cello's very pitch, the Double Bass adds nothing. */
export const DOUBLE_BASS_UNISON_SHARE = 0.5;
/** This many bars in a row with the same notes in the same rhythm, in a manner that is meant to move, is mechanical. */
export const DOUBLE_BASS_MONOTONY_BARS = 4;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Note name with middle C = C4, and the MIDI number. */
export const bassPitchName = (pitch: number): string => `${NAMES[mod12(pitch)]}${Math.floor(pitch / 12) - 1} (${pitch})`;

export function reviewFifthVoice(input: FifthReviewInput): FifthReview {
  const { frame, others, bass } = input;
  const beat = frame.beatTicks;
  const bar = frame.barTicks;
  const findings: FifthFinding[] = [];
  const where = (tick: number): string => `bar ${Math.floor(tick / bar) + 1} beat ${round2((tick % bar) / beat + 1)}`;
  const add = (kind: FifthFindingKind, n: { span: number | null; tick: number }, against: FifthFinding['against'], text: string): void => {
    findings.push({ kind, span: n.span, tick: n.tick, against, text: `${where(n.tick)}: ${text}` });
  };
  const bowed = (n: DoubleBassNote): boolean => n.role !== 'plucked';
  const givenParallels: string[] = [];

  bass.forEach((n, i) => {
    const before = bass[i - 1];
    const after = bass[i + 1];
    const joinedBefore = !!before && before.tick + before.duration === n.tick;
    const joinedAfter = !!after && n.tick + n.duration === after.tick;
    const chord = chordAt(frame, n.tick);
    const tone = !!chord && chord.fact.pitchClasses.includes(mod12(n.pitch));
    const isBass = !!chord && mod12(n.pitch) === chord.fact.bassPc;

    // the instrument
    if (input.keyswitchZone && n.pitch >= input.keyswitchZone.low && n.pitch <= input.keyswitchZone.high) add('keyswitch-zone', n, 'itself', `${bassPitchName(n.pitch)} lies in the keyswitch zone ${input.keyswitchZone.low}–${input.keyswitchZone.high}: it would switch the stroke instead of sounding`);
    else if (n.pitch < input.range[0] || n.pitch > input.range[1]) add('out-of-range', n, 'itself', `${bassPitchName(n.pitch)} is outside the range written (${input.range[0]}–${input.range[1]})`);
    if (bowed(n) && n.duration < DOUBLE_BASS.minBowedBeats * beat) add('too-short', n, 'itself', `a bowed note of ${round2(n.duration / beat)} beats: the string does not speak that fast`);
    if (joinedBefore && doubleBassMove(n.pitch - before.pitch) === null) add('bass-leap', n, 'itself', `a leap of ${Math.abs(n.pitch - before.pitch)} semitones from ${bassPitchName(before.pitch)}: not a move a bass makes`);

    // the harmony
    if (chord) {
      const startsChord = chord.fact.startTick === n.tick;
      if (startsChord && n.role !== 'response' && !isBass) add('not-the-bass', n, 'harmony', `${bassPitchName(n.pitch)} begins ${chord.fact.symbol}, whose bass is ${NAMES[chord.fact.bassPc]}`);
      if (tone) {
        for (const later of frame.harmony.chords) {
          if (later.fact.startTick > n.tick && later.fact.startTick < n.tick + n.duration && !later.fact.pitchClasses.includes(mod12(n.pitch))) add('against-harmony', n, 'harmony', `${bassPitchName(n.pitch)} is held into ${later.fact.symbol}, which it does not belong to`);
        }
      } else if (n.function === 'appoggiatura') {
        const afterChord = after ? chordAt(frame, after.tick) : undefined;
        const resolves = joinedAfter && n.pitch - after.pitch > 0 && n.pitch - after.pitch <= 2 && !!afterChord && afterChord.fact.pitchClasses.includes(mod12(after.pitch));
        if (!resolves) add('untreated-dissonance', n, 'harmony', `${bassPitchName(n.pitch)} leans on ${chord.fact.symbol} and does not fall by step onto a chord tone`);
      } else {
        const step = (a: number, b: number): boolean => a !== b && Math.abs(a - b) <= 2;
        const weak = n.tick % bar !== 0 && !(frame.beatsPerBar % 2 === 0 && n.tick % bar === (frame.beatsPerBar / 2) * beat);
        if (!(weak && n.duration <= beat && joinedBefore && joinedAfter && step(before.pitch, n.pitch) && step(n.pitch, after.pitch))) add('untreated-dissonance', n, 'harmony', `${bassPitchName(n.pitch)} is foreign to ${chord.fact.symbol} and is not a passing note (weak beat, a beat long, reached and left by step)`);
      }
    }

    // the other voices
    for (const voice of FIFTH_AGAINST) {
      const under = others[voice].find((o) => o.pitch < n.pitch && overlapTicks(o, n.tick, n.duration) >= beat);
      if (under) add('above-voice', n, voice, `${bassPitchName(n.pitch)} sounds above ${FIFTH_VOICE_NAMES[voice]}'s ${bassPitchName(under.pitch)} for a beat or more`);
    }
    const clash = clashOf(frame, others, { tick: n.tick, duration: n.duration, pitch: n.pitch, isChordBass: isBass, chordTone: tone });
    if (clash) add('clash', n, clash.against, `${bassPitchName(n.pitch)} is held a semitone (or its octave) against ${FIFTH_VOICE_NAMES[clash.against]}'s ${bassPitchName(clash.pitch)}`);
    if (joinedBefore) {
      const parallel = parallelOf(others, before.tick, before.pitch, n.tick, n.pitch);
      if (parallel && !(parallel.interval === 'octaves' && parallel.against === 'cello')) {
        const text = `parallel ${parallel.interval} with ${FIFTH_VOICE_NAMES[parallel.against]} from ${where(before.tick)}`;
        // the harmony's own bass, where a chord begins, against an inner voice: the Double Bass has no other note to
        // give. Recorded, not answered — answering it would take the bass of the chord away.
        const given = isBass && !!chord && chord.fact.startTick === n.tick && parallel.against !== 'first';
        if (given) givenParallels.push(`${where(n.tick)}: ${text} (the harmony's bass; kept)`);
        else add(parallel.interval === 'fifths' ? 'parallel-fifths' : 'parallel-octaves', n, parallel.against, text);
      }
    }
  });

  // breath: bowed sound with no lifted bow
  let run = 0;
  let longest = 0;
  bass.forEach((n, i) => {
    if (!bowed(n)) { run = 0; return; }
    run += n.duration;
    longest = Math.max(longest, run);
    if (run > DOUBLE_BASS.maxUnbrokenBeats * beat) { add('no-breath', n, 'itself', `${round2(run / beat)} beats of bowed sound without a lifted bow`); run = 0; }
    const next = bass[i + 1];
    if (n.breathAfter || !next || next.tick !== n.tick + n.duration) run = 0;
  });

  // per stretch: the Cello's shadow, the Cello's unison, mechanical repetition
  for (const span of input.plan.spans) {
    const mine = bass.filter((n) => n.span === span.index);
    if (!mine.length) continue;
    const first = mine[0];
    const active = mine.filter((n) => n.role !== 'foundation' && n.role !== 'arrival');
    if (active.length >= 3) {
      const from = active[0].tick;
      const last = active[active.length - 1];
      const to = last.tick + last.duration;
      const cello = others.cello.filter((o) => o.tick >= from && o.tick < to);
      const together = active.filter((n) => cello.some((o) => o.tick === n.tick && mod12(o.pitch) === mod12(n.pitch))).length;
      const theirs = cello.filter((o) => active.some((n) => n.tick === o.tick)).length;
      if (cello.length >= 3 && together / active.length > DOUBLE_BASS_SHADOWING_SHARE && theirs / cello.length > DOUBLE_BASS_SHADOWING_SHARE) {
        add('cello-shadow', first, 'cello', `stretch ${span.index + 1}: ${together} of ${active.length} notes are struck with the Cello on the Cello's note, and ${theirs} of the Cello's ${cello.length} are struck with the Double Bass: a shadow, not a voice`);
      }
    }
    let sounding = 0;
    let unison = 0;
    for (const n of mine) {
      sounding += n.duration;
      for (const o of others.cello) if (o.pitch === n.pitch) unison += Math.max(0, overlapTicks(o, n.tick, n.duration));
    }
    if (unison >= 4 * beat && unison / sounding > DOUBLE_BASS_UNISON_SHARE) add('cello-unison', first, 'cello', `stretch ${span.index + 1}: ${round2(unison / beat)} of ${round2(sounding / beat)} beats are the Cello's very pitch`);
    if (active.length) {
      const byBar = new Map<number, string>();
      for (const n of active) { const b = Math.floor(n.tick / bar); byBar.set(b, `${byBar.get(b) ?? ''}|${n.tick % bar}:${n.duration}:${n.pitch}`); }
      const bars = [...byBar.keys()].sort((a, b) => a - b);
      let same = 1;
      for (let k = 1; k < bars.length; k++) {
        same = bars[k] === bars[k - 1] + 1 && byBar.get(bars[k]) === byBar.get(bars[k - 1]) ? same + 1 : 1;
        if (same === DOUBLE_BASS_MONOTONY_BARS) { add('monotony', { span: span.index, tick: bars[k] * bar }, 'itself', `${DOUBLE_BASS_MONOTONY_BARS} bars in a row with the same notes in the same rhythm`); break; }
      }
    }
  }

  // facts
  const total = bass.reduce((a, n) => a + n.duration, 0);
  const share = (ticks: number): number => (total ? round2(ticks / total) : 0);
  const pairs = Object.fromEntries(FIFTH_AGAINST.map((voice) => {
    let samePc = 0; let unison = 0; let below = 0;
    for (const n of bass) for (const o of others[voice]) {
      const shared = Math.max(0, overlapTicks(o, n.tick, n.duration));
      if (!shared) continue;
      if (mod12(o.pitch) === mod12(n.pitch)) samePc += shared;
      if (o.pitch === n.pitch) unison += shared;
      if (o.pitch < n.pitch) below += shared;
    }
    const attacks = new Set(others[voice].map((o) => o.tick));
    return [voice, { attacksTogether: bass.length ? round2(bass.filter((n) => attacks.has(n.tick)).length / bass.length) : 0, samePitchClassShare: share(samePc), unisonShare: share(unison), belowShare: share(below) }];
  })) as Record<FifthAgainst, FifthPairFacts>;
  let notLowest = 0;
  for (const n of bass) {
    // ticks of this note during which some voice sounds below it (voices may overlap: take the union roughly, by beat slices)
    for (let t = n.tick; t < n.tick + n.duration; t += Math.round(beat / 2)) {
      const slice = Math.min(Math.round(beat / 2), n.tick + n.duration - t);
      if (FIFTH_AGAINST.some((v) => others[v].some((o) => o.pitch < n.pitch && overlapTicks(o, t, slice) > 0))) notLowest += slice;
    }
  }
  const chordStarts = frame.harmony.chords.filter((c) => bass.some((n) => n.tick === c.fact.startTick));
  const onBass = chordStarts.filter((c) => bass.some((n) => n.tick === c.fact.startTick && mod12(n.pitch) === c.fact.bassPc)).length;
  let parallelOctaves = 0;
  bass.forEach((n, i) => {
    const before = bass[i - 1];
    if (!before || before.tick + before.duration !== n.tick) return;
    const p = parallelOf({ first: [], second: [], viola: [], cello: others.cello }, before.tick, before.pitch, n.tick, n.pitch);
    if (p && p.interval === 'octaves') parallelOctaves++;
  });
  const long = bass.filter((n) => n.role === 'foundation' || n.role === 'arrival');
  let longTicks = 0; let longOctave = 0;
  for (const n of long) {
    longTicks += n.duration;
    for (const o of others.cello) if (o.pitch > n.pitch && mod12(o.pitch) === mod12(n.pitch)) longOctave += Math.max(0, overlapTicks(o, n.tick, n.duration));
  }
  const attacksPerBeat = new Map<number, number>();
  for (const tick of [...bass.map((n) => n.tick), ...FIFTH_AGAINST.flatMap((v) => others[v].map((o) => o.tick))]) {
    const b = Math.floor(tick / beat);
    attacksPerBeat.set(b, (attacksPerBeat.get(b) ?? 0) + 1);
  }
  const facts: FifthFacts = {
    notes: bass.length,
    lowest: bass.length ? Math.min(...bass.map((n) => n.pitch)) : null,
    highest: bass.length ? Math.max(...bass.map((n) => n.pitch)) : null,
    soundingBeats: round2(total / beat),
    silentBeats: round2((input.endTick - total) / beat),
    lowestVoiceShare: total ? round2(1 - notLowest / total) : 0,
    chordStartsAttacked: chordStarts.length,
    chordStartsOnBass: onBass,
    passingNotes: bass.filter((n) => n.function === 'passing').length,
    thematicNotes: bass.filter((n) => n.themeIndex !== null).length,
    rolesWritten: [...new Set(bass.map((n) => n.role))],
    rhythms: [...new Set(bass.map((n) => n.cell).filter((c): c is string => c !== null))],
    longestUnbrokenBeats: round2(longest / beat),
    parallelOctavesWithCello: parallelOctaves,
    parallelsOnTheHarmonysBass: givenParallels,
    celloOctaveShare: longTicks ? round2(longOctave / longTicks) : 0,
    mostAttacksInABeat: attacksPerBeat.size ? Math.max(...attacksPerBeat.values()) : 0,
    pairs,
  };
  return { findings, facts };
}
