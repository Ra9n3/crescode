/**
 * Melodic lines against harmony (Strings V1, Stage 2) — the shared craft
 * every piece of string material is checked with. Skills, not decisions.
 *
 * A line note is a scale step (0 = the tonic of a reference octave, 7 = the
 * tonic above) with an optional chromatic alteration in semitones. Octaves
 * are decided later, by the instrument that plays the line.
 *
 * `judgeLine` states whether a line is sound over the harmonic map, and
 * what each note is doing: a chord tone, or a dissonance with a name and a
 * resolution. A line that only held chord tones would pass, but so does a
 * line that leans, passes and suspends — the rules say how, not how much.
 */
import type { HarmonicChord, HarmonicMap } from '../understanding/harmony';

export interface LineNote {
  readonly tick: number;
  readonly duration: number;
  /** Diatonic scale step; 0 = tonic of the reference octave. */
  readonly step: number;
  /** Chromatic alteration in semitones (0 = the scale's own note). */
  readonly alter: number;
}

export interface TonalFrame {
  readonly key: number;
  /** The seven semitone offsets of the mode. */
  readonly scale: readonly number[];
  readonly barTicks: number;
  readonly beatTicks: number;
  readonly beatsPerBar: number;
  readonly harmony: HarmonicMap;
}

export type NoteFunction =
  | 'chord-tone' | 'appoggiatura' | 'suspension' | 'passing' | 'neighbour' | 'leaning' | 'chromatic-neighbour' | 'pending';

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** Semitones above the reference tonic. */
export function semitonesOf(frame: TonalFrame, note: Pick<LineNote, 'step' | 'alter'>): number {
  return 12 * Math.floor(note.step / 7) + frame.scale[mod(note.step, 7)] + note.alter;
}

export function pitchClassOf(frame: TonalFrame, note: Pick<LineNote, 'step' | 'alter'>): number {
  return mod(frame.key + semitonesOf(frame, note), 12);
}

/** The chord sounding at a tick; undefined where the project has no harmony. */
export function chordAt(frame: TonalFrame, tick: number): HarmonicChord | undefined {
  return frame.harmony.chords.find((c) => c.fact.startTick <= tick && tick < c.fact.endTick);
}

/**
 * The scale as the chord inflects it: a chord tone outside the mode
 * replaces the mode's notes a semitone either side of it while that chord
 * sounds (over B♭maj7 in D Dorian, B♭ replaces B).
 */
export function localScale(frame: TonalFrame, chord: HarmonicChord): Set<number> {
  const pcs = new Set(frame.scale.map((s) => mod(frame.key + s, 12)));
  const chordPcs = new Set(chord.fact.pitchClasses.map((pc) => mod(pc, 12)));
  const foreign = [...chordPcs].filter((pc) => !pcs.has(pc));
  for (const pc of foreign) {
    // a neighbour that is itself a chord tone stays
    for (const neighbour of [mod(pc + 1, 12), mod(pc - 1, 12)]) if (!chordPcs.has(neighbour)) pcs.delete(neighbour);
    pcs.add(pc);
  }
  return pcs;
}

export type MetricWeight = 'strong' | 'beat' | 'off';

export function metricWeight(frame: TonalFrame, tick: number): MetricWeight {
  const offset = mod(tick, frame.barTicks);
  if (offset % frame.beatTicks !== 0) return 'off';
  const beat = offset / frame.beatTicks;
  return beat === 0 || (frame.beatsPerBar === 4 && beat === 2) ? 'strong' : 'beat';
}

export interface LineJudgement {
  readonly ok: boolean;
  readonly problems: readonly { readonly index: number; readonly text: string }[];
  /** One per note. */
  readonly functions: readonly NoteFunction[];
}

export interface JudgeOptions {
  /** The last note must be a chord tone (a line that ends here). When false, a final dissonance is 'pending': the caller joins more notes. */
  readonly finalStable: boolean;
}

/**
 * The rules.
 *   - every note belongs to the local scale, except a short off-beat
 *     chromatic neighbour that rises a semitone into a chord tone;
 *   - a note that is not a chord tone must move by step to a chord tone;
 *   - an unaccented dissonance reached by leap must fall by step (a leaning note);
 *   - a note held into a chord it does not belong to must fall by step
 *     into that chord (a suspension);
 *   - no tritone leap, no leap wider than an octave, no seventh.
 */
export function judgeLine(frame: TonalFrame, notes: readonly LineNote[], options: JudgeOptions): LineJudgement {
  const problems: { index: number; text: string }[] = [];
  const functions: NoteFunction[] = [];
  notes.forEach((note, i) => {
    const prev = notes[i - 1];
    const next = notes[i + 1];
    const chord = chordAt(frame, note.tick);
    if (!chord) {
      problems.push({ index: i, text: `no harmony at tick ${note.tick}` });
      functions.push('pending');
      return;
    }
    if (prev) {
      const leap = Math.abs(semitonesOf(frame, note) - semitonesOf(frame, prev));
      if (leap === 6 || leap === 10 || leap === 11 || leap > 12) problems.push({ index: i, text: `unsingable leap of ${leap} semitones` });
    }
    const pc = pitchClassOf(frame, note);
    const isChordTone = chord.fact.pitchClasses.includes(pc);
    const nextChord = next ? chordAt(frame, next.tick) : undefined;
    const nextIsChordTone = !!next && !!nextChord && nextChord.fact.pitchClasses.includes(pitchClassOf(frame, next));
    const stepTo = next ? next.step - note.step : 0;
    const semisTo = next ? semitonesOf(frame, next) - semitonesOf(frame, note) : 0;

    // a note held into a later chord
    let suspended = false;
    for (const later of frame.harmony.chords) {
      if (later.fact.startTick <= note.tick || later.fact.startTick >= note.tick + note.duration) continue;
      const overlap = Math.min(note.tick + note.duration, later.fact.endTick) - later.fact.startTick;
      if (overlap < frame.beatTicks || later.fact.pitchClasses.includes(pc)) continue;
      if (next && stepTo === -1 && nextIsChordTone) suspended = true;
      else problems.push({ index: i, text: `held into ${later.fact.symbol} without belonging to it or falling by step` });
    }

    if (!localScale(frame, chord).has(pc)) {
      const short = note.duration <= frame.beatTicks / 2 && metricWeight(frame, note.tick) !== 'strong';
      if (short && next && semisTo === 1 && nextIsChordTone) functions.push('chromatic-neighbour');
      else {
        problems.push({ index: i, text: `outside the scale over ${chord.fact.symbol}` });
        functions.push('pending');
      }
      return;
    }
    if (isChordTone) {
      functions.push(suspended ? 'suspension' : 'chord-tone');
      return;
    }
    if (!next) {
      if (options.finalStable) problems.push({ index: i, text: `the line ends on a dissonance over ${chord.fact.symbol}` });
      functions.push('pending');
      return;
    }
    if (Math.abs(stepTo) !== 1 || !nextIsChordTone) {
      problems.push({ index: i, text: `dissonance over ${chord.fact.symbol} does not resolve by step` });
      functions.push('pending');
      return;
    }
    const accented = metricWeight(frame, note.tick) === 'strong' || note.duration >= frame.beatTicks;
    const approach = prev ? note.step - prev.step : 0;
    if (accented) functions.push('appoggiatura');
    else if (prev && Math.abs(approach) === 1) functions.push(Math.sign(approach) === Math.sign(stepTo) ? 'passing' : 'neighbour');
    else if (stepTo === -1) functions.push('leaning');
    else {
      problems.push({ index: i, text: `unaccented dissonance reached by leap does not fall` });
      functions.push('pending');
    }
  });
  return { ok: problems.length === 0, problems, functions };
}

/** Moves a line in time and by whole scale steps. */
export function shiftLine<T extends LineNote>(notes: readonly T[], tickOffset: number, steps: number): T[] {
  return notes.map((n) => ({ ...n, tick: n.tick + tickOffset, step: n.step + steps }));
}
