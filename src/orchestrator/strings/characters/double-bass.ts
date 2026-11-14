/**
 * The Double Bass's character (Strings V1, Stage 6) — data and small pure
 * rules.
 *
 * The Double Bass is not the Cello an octave lower and not a part that
 * marks every chord root. It is the heaviest voice of the five: it speaks
 * slowly, it moves by step and by the leaps that carry harmony, and it is
 * most telling when it enters, stands, or leaves. When the Cello moves the
 * Double Bass tends to stand; when the Cello sings the Double Bass takes
 * the bass line over.
 *
 * Everything here is an orchestration judgement stated once. Nothing has
 * been calibrated by listening.
 */
import type { Articulation } from '../../../shared/schema/types';

/** What the Double Bass can be doing in a stretch. Possibilities, not quotas. */
export type DoubleBassRole =
  | 'tacet'
  /** Long tones on the bass of the harmony. */
  | 'foundation'
  /** The bass of the harmony on the bar, its fifth (or octave) answering in the middle of it; separate bows. */
  | 'root-fifth'
  /** A bass line of its own: the harmony's bass where a chord begins, passing and connecting notes between. */
  | 'moving'
  /** The same support, plucked. */
  | 'plucked'
  /** The bass of the goal chord, struck with the arrival and let go. */
  | 'arrival'
  /** The theme's head in notes twice as long, answered from the bottom of the ensemble. */
  | 'response';

export interface DoubleBassCell {
  readonly id: string;
  readonly name: string;
  /** Note lengths in beats, filling a stretch of harmony of that many beats. */
  readonly lengths: readonly number[];
}

/** Rhythms of a moving bass, by the length in beats of the harmony they fill. No note is shorter than a beat. */
export const DOUBLE_BASS_MOVING_CELLS: Readonly<Record<number, readonly DoubleBassCell[]>> = {
  4: [
    { id: 'stand-walk', name: 'a minim, two crotchets', lengths: [2, 1, 1] },
    { id: 'long-lead', name: 'a dotted minim and a crotchet that leads on', lengths: [3, 1] },
    { id: 'walk', name: 'four crotchets', lengths: [1, 1, 1, 1] },
    { id: 'walk-stand', name: 'two crotchets, a minim', lengths: [1, 1, 2] },
  ],
  3: [
    { id: 'stand-step', name: 'a minim and a crotchet', lengths: [2, 1] },
    { id: 'three', name: 'three crotchets', lengths: [1, 1, 1] },
  ],
  2: [
    { id: 'two', name: 'two crotchets', lengths: [1, 1] },
    { id: 'one', name: 'a minim', lengths: [2] },
  ],
};

export const DOUBLE_BASS = {
  role: 'basses',
  /**
   * Lowest note written (E1, MIDI 28): the open E string, and the floor the
   * classic desk has always kept. The export profile states a lower playable
   * key (see the capability table); nothing below E1 is written until that
   * key has been heard.
   */
  floor: 28,
  /**
   * Highest note written (C3, MIDI 48). The profile states no upper limit
   * for the Bass Ensemble patch; this ceiling is a conservative choice, not
   * a verified limit.
   */
  ceiling: 48,
  /** The register where a bass tone sits best (E1–G2). */
  bestRegister: [28, 43] as readonly [number, number],
  /** No bowed note is shorter than this many beats: the string speaks slowly. */
  minBowedBeats: 1,
  /** Bowed sound without a lifted bow for longer than this (beats) is a finding. */
  maxUnbrokenBeats: 32,
  /** The longest single tone (beats) before the bow is changed. */
  longestToneBeats: 8,
  pizzLengthBeats: 0.25,
  /** At or above this energy (0..1) a long foundation tone is played tremolo, if the instrument has the keyswitch. */
  tremoloFromEnergy: 0.85,
  /** At or above this energy the bar's note of a root-and-fifth bass is given the accented stroke, if the instrument has the keyswitch. */
  marcatoFromEnergy: 0.72,
  /** Below this energy the Double Bass does not enter under a theme that is heard for the first time. */
  openingEnergy: 0.62,
  /** Below this energy it does not pluck under a texture the Cello has left. */
  pluckEnergy: 0.6,
  /** From this energy a bass the Cello shares becomes root-and-fifth; below it, long tones. */
  pulseEnergy: 0.55,
  /** How much softer than a leading voice each role is played (MIDI velocity). */
  level: { tacet: 0, response: -1, moving: -4, arrival: -4, 'root-fifth': -5, plucked: -6, foundation: -8 } as Readonly<Record<DoubleBassRole, number>>,
  /** The stroke each role asks for. A role whose stroke the instrument cannot trigger is declined, not approximated. */
  articulation: { foundation: 'sustain', 'root-fifth': 'sustain', moving: 'legato', response: 'legato', arrival: 'sustain', plucked: 'pizz' } as Readonly<Record<Exclude<DoubleBassRole, 'tacet'>, Articulation>>,
} as const;

/**
 * What a move costs, by size in semitones (lower is preferred; null = not
 * made). A bass moves by step and by fourth, fifth and octave; thirds are
 * detail; the tritone and the sixth are rare; sevenths are not bass moves.
 */
export function doubleBassMove(semitones: number): number | null {
  switch (Math.abs(semitones)) {
    case 0: return 1.5;
    case 1: case 2: return 0;
    case 3: case 4: return 0.6;
    case 5: case 7: return 0.3;
    case 6: return 2;
    case 8: case 9: return 1.6;
    case 12: return 0.7;
    default: return null;
  }
}
