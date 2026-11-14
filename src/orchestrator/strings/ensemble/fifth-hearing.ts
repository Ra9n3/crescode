/**
 * What the Double Bass hears (Strings V1, Stage 6): the four finished
 * voices as sounding pitches, and the small judgements both the writer and
 * the review make against them. Reading only — nothing here returns a note
 * of another voice.
 */
import type { TonalFrame } from '../material/line';

export interface Heard {
  readonly tick: number;
  readonly duration: number;
  readonly pitch: number;
  /** False when the voice's own writer treated the note as a dissonance (passing, leaning, suspended). */
  readonly chordTone: boolean;
}

export type FifthAgainst = 'first' | 'second' | 'viola' | 'cello';
export const FIFTH_AGAINST: readonly FifthAgainst[] = ['first', 'second', 'viola', 'cello'];
export const FIFTH_VOICE_NAMES: Readonly<Record<FifthAgainst, string>> = { first: 'the first voice', second: 'the second voice', viola: 'the Viola', cello: 'the Cello' };
export type FifthOthers = Readonly<Record<FifthAgainst, readonly Heard[]>>;

export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

export const overlapTicks = (a: { tick: number; duration: number }, tick: number, duration: number): number =>
  Math.min(a.tick + a.duration, tick + duration) - Math.max(a.tick, tick);

/** The lowest pitch any of the four voices sounds for at least a quarter of a beat inside the window; null when none does. */
export function lowestHeard(frame: TonalFrame, others: FifthOthers, tick: number, duration: number): number | null {
  let low: number | null = null;
  const need = Math.min(Math.round(frame.beatTicks / 4), duration);
  for (const voice of FIFTH_AGAINST) for (const o of others[voice]) {
    if (overlapTicks(o, tick, duration) < need) continue;
    if (low === null || o.pitch < low) low = o.pitch;
  }
  return low;
}

export interface BassCandidate {
  readonly tick: number;
  readonly duration: number;
  readonly pitch: number;
  /** The harmony's own bass note: whatever it meets above is the chord's. */
  readonly isChordBass: boolean;
  readonly chordTone: boolean;
}

/**
 * A semitone (or minor ninth, or major seventh) held against a chord tone
 * of another voice. Not a clash: the harmony's own bass; a major seventh
 * over a chord tone (the chord's own seventh); another voice's treated
 * dissonance; a passing note of a beat or less that the other voice does
 * not attack together with.
 */
export function clashOf(frame: TonalFrame, others: FifthOthers, c: BassCandidate): { readonly against: FifthAgainst; readonly pitch: number; readonly tick: number } | null {
  if (c.isChordBass) return null;
  for (const voice of FIFTH_AGAINST) for (const o of others[voice]) {
    const shared = overlapTicks(o, c.tick, c.duration);
    if (shared < frame.beatTicks) continue;
    const d = mod12(o.pitch - c.pitch);
    if (d !== 1 && d !== 11) continue;
    if (!o.chordTone) continue;
    if (c.chordTone && d === 11) continue;
    if (c.duration > frame.beatTicks || o.tick === c.tick) return { against: voice, pitch: o.pitch, tick: Math.max(o.tick, c.tick) };
  }
  return null;
}

/**
 * Parallel perfect intervals: the Double Bass and another voice both move
 * to a new note at the same moment, in the same direction, and stand a
 * fifth (or an octave or unison) apart before and after.
 */
export function parallelOf(others: FifthOthers, prevTick: number, prevPitch: number, tick: number, pitch: number): { readonly against: FifthAgainst; readonly interval: 'fifths' | 'octaves' } | null {
  const move = pitch - prevPitch;
  if (move === 0) return null;
  for (const voice of FIFTH_AGAINST) {
    const now = others[voice].find((o) => o.tick === tick);
    if (!now) continue;
    const before = others[voice].find((o) => o !== now && o.tick <= prevTick && prevTick < o.tick + o.duration);
    if (!before) continue;
    const theirs = now.pitch - before.pitch;
    if (theirs === 0 || Math.sign(theirs) !== Math.sign(move)) continue;
    const a = mod12(before.pitch - prevPitch);
    const b = mod12(now.pitch - pitch);
    if (a !== b) continue;
    if (a === 7) return { against: voice, interval: 'fifths' };
    if (a === 0) return { against: voice, interval: 'octaves' };
  }
  return null;
}
