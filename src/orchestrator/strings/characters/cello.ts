/**
 * The Cello's character (Strings V1, Stage 5) — data and small pure rules.
 *
 * The Cello is not written as a lower Viola and not as a bass part that is
 * always there. It has three registers that behave differently, a bass
 * manner and a singing manner, and it carries the floor of the harmony only
 * when it is in fact the lowest voice sounding.
 *
 * Everything here is an orchestration judgement stated once. Nothing has
 * been calibrated by listening.
 */
import type { Articulation } from '../../../shared/schema/types';

/** What the Cello can be doing in a stretch. Possibilities, not quotas. */
export type CelloRole =
  | 'tacet'
  /** Long bass tones, led by step where the harmony allows: the floor under a thin texture. */
  | 'foundation'
  /** A bass that moves in its own rhythm, connecting the harmonies by passing notes. */
  | 'bass-line'
  /** The same bass, plucked and sparse. */
  | 'plucked-bass'
  /** The theme itself, entered in imitation in the tenor register. */
  | 'theme'
  /** The bass of the goal chord, reached with the first voice and held. */
  | 'arrival';

export interface CelloCell {
  readonly id: string;
  readonly name: string;
  /** [start, length] in beats, for four beats in a bar. */
  readonly notes: readonly (readonly [number, number])[];
  /** Used only where the bass has half a bar: before a thematic entry ('before-entry') or after one ('after-entry'). */
  readonly only?: 'before-entry' | 'after-entry';
}

/** Bass tones: the bar is one note, two, or a long note and a note that leads on. */
export const CELLO_FOUNDATION_CELLS: readonly CelloCell[] = [
  { id: 'whole', name: 'one note', notes: [[0, 4]] },
  { id: 'long-lead', name: 'a dotted minim and a crotchet that leads on', notes: [[0, 3], [3, 1]] },
  { id: 'halves', name: 'two minims', notes: [[0, 2], [2, 2]] },
  { id: 'lift', name: 'a dotted minim, then the bow lifts', notes: [[0, 3]] },
];
/** A moving bass: the downbeat stands, the rest of the bar walks, runs or leans towards the next. */
export const CELLO_BASS_CELLS: readonly CelloCell[] = [
  { id: 'walk', name: 'four crotchets', notes: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  { id: 'stand-walk', name: 'a minim, two crotchets', notes: [[0, 2], [2, 1], [3, 1]] },
  { id: 'dotted', name: 'dotted crotchet, quaver, minim', notes: [[0, 1.5], [1.5, 0.5], [2, 2]] },
  { id: 'stand-run', name: 'a minim, then four quavers running on', notes: [[0, 2], [2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]] },
  { id: 'walk-stand', name: 'two crotchets, a minim', notes: [[0, 1], [1, 1], [2, 2]] },
  { id: 'lean', name: 'a dotted minim and two quavers that lead on', notes: [[0, 3], [3, 0.5], [3.5, 0.5]] },
  { id: 'walk-lift', name: 'a minim and a crotchet, then the bow lifts', notes: [[0, 2], [2, 1]] },
  { id: 'stand', name: 'a minim: the bass is given, then the Cello leaves it', notes: [[0, 2]], only: 'before-entry' },
  { id: 'return', name: 'a minim on the third beat: the bass is taken up again', notes: [[2, 2]], only: 'after-entry' },
  { id: 'return-walk', name: 'two crotchets from the third beat: the bass is taken up again', notes: [[2, 1], [3, 1]], only: 'after-entry' },
];
/** The plainer alternative of either. */
export const CELLO_PLAIN_CELL_IDS: readonly string[] = ['whole', 'halves', 'lift'];
/** Plucked bass: the downbeat, and one or two notes that answer it. */
export const CELLO_PLUCKED_CELLS: readonly (CelloCell & { readonly sparse: boolean })[] = [
  { id: 'one-three', name: 'beats one and three', notes: [[0, 0.5], [2, 0.5]], sparse: false },
  { id: 'one-three-four', name: 'beats one, three and four', notes: [[0, 0.5], [2, 0.5], [3, 0.5]], sparse: false },
  { id: 'one', name: 'beat one', notes: [[0, 0.5]], sparse: true },
];

export const CELLO = {
  role: 'cellosBasses',
  /** Lowest note of the Cello line (C2). Below it is the Double Bass desk's register; the export profile's playable low is checked against it. */
  floor: 36,
  /** Highest note this stage writes (A4): the top of the A string's singing stretch. */
  ceiling: 69,
  /** Below this (G2) the C string speaks slowly: no quavers, and leaps are the bass's own (fourths, fifths, octaves). */
  heavyBelow: 43,
  /** From here up (G3) the instrument sings: steps, thirds and the expressive sixth. */
  tenorFrom: 55,
  /** A bass tone sits best between these (D2–A3). */
  bassRegister: [38, 57] as readonly [number, number],
  /** A singing line sits best between these (D3–G4). */
  singingRegister: [50, 67] as readonly [number, number],
  /** The Cello stays at least this far below the lowest bowed voice sounding with it (semitones). */
  clearance: 3,
  /** Room needed under the other voices for a part to be worth writing (semitones). */
  minRoom: 7,
  /** Bowed notes sounding without a lifted bow for longer than this (beats) are penalised. */
  maxUnbrokenBeats: 12,
  /** Rest needed between a plucked note and a bowed one (beats). */
  arcoPreparationBeats: 1,
  pizzLengthBeats: 0.25,
  pizzRingBeats: 0.5,
  /** At or above this energy (0..1) a long foundation tone is played tremolo, if the instrument has the keyswitch. */
  tremoloFromEnergy: 0.8,
  /** A bass role is written no higher than this (C4). */
  bassCeiling: 60,
  /** How much softer than a leading voice each role is played (MIDI velocity). */
  level: { tacet: 0, theme: -2, 'bass-line': -6, foundation: -10, 'plucked-bass': -8, arrival: -8 } as Readonly<Record<CelloRole, number>>,
  /** The bow stroke each role asks for. A role whose stroke the instrument cannot trigger is declined, not approximated. */
  articulation: { foundation: 'legato', 'bass-line': 'legato', theme: 'legato', arrival: 'sustain', 'plucked-bass': 'pizz' } as Readonly<Record<Exclude<CelloRole, 'tacet'>, Articulation>>,
} as const;

/**
 * What a move costs in the bass manner, by size in scale steps and by the
 * register it starts in (lower is preferred; null = not made). A bass moves
 * by step, and by fourth, fifth and octave — the leaps that carry harmony;
 * thirds are passing detail; sixths and sevenths are not bass moves.
 */
export function celloBassMove(steps: number, fromPitch: number): number | null {
  const heavy = fromPitch < CELLO.heavyBelow;
  switch (Math.abs(steps)) {
    case 0: return 1.2;
    case 1: return 0;
    case 2: return heavy ? 0.8 : 0.4;
    case 3: return 0.3;
    case 4: return 0.3;
    case 5: return 1.6;
    case 7: return heavy ? 0.6 : 0.9;
    default: return null;
  }
}

/** The same in the singing manner (tenor): steps and thirds, the sixth as an expressive event, the fourth and fifth plainly. */
export function celloSingingMove(steps: number): number | null {
  switch (Math.abs(steps)) {
    case 0: return 1.2;
    case 1: return 0;
    case 2: return 0.3;
    case 3: return 0.7;
    case 4: return 0.9;
    case 5: return 1.2;
    case 7: return 2;
    default: return null;
  }
}
