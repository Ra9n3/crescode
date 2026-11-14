/**
 * The Viola's character (Strings V1, Stage 4) — data and small pure rules.
 *
 * The Viola is not written as a lower violin. What is stated here is what
 * makes its writing its own: where it sits, how it moves there, the rhythms
 * it speaks in, how it breathes, which bow strokes it asks for in which
 * role, when it varies a pattern, and when it declines to play.
 *
 * Everything here is an orchestration judgement stated once. Nothing has
 * been calibrated by listening.
 */
import type { Articulation } from '../../../shared/schema/types';

/** What the Viola can be doing in a stretch. Possibilities, not quotas. */
export type ViolaRole = 'tacet' | 'inner-line' | 'pulse' | 'arrival' | 'reply';

/** A one-bar rhythm: [start, length] in beats. Written for four beats in a bar. */
export interface RhythmCell {
  readonly id: string;
  readonly name: string;
  readonly notes: readonly (readonly [number, number])[];
  /** Set when the rhythm is taken from the theme. */
  readonly derived?: 'theme-tail' | 'theme-head';
}

/**
 * Bowed inner movement. The Viola tends to speak AFTER the beat the upper
 * voices attack on, to hold where they move and to move where they hold;
 * its runs are short and end on a long note.
 */
export const VIOLA_LINE_CELLS: readonly RhythmCell[] = [
  { id: 'after-beat', name: 'enters after the downbeat, two quavers in the middle', notes: [[1, 1], [2, 0.5], [2.5, 0.5], [3, 1]] },
  { id: 'long-short-long', name: 'dotted crotchet, quaver, minim', notes: [[0, 1.5], [1.5, 0.5], [2, 2]] },
  { id: 'held-then-run', name: 'a minim, then a run of four quavers', notes: [[0, 2], [2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]] },
  { id: 'upbeat-run', name: 'three quavers after a quaver rest, into a minim', notes: [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2]] },
  { id: 'syncopated', name: 'crotchet, quaver, a note held across the middle of the bar, crotchet', notes: [[0, 1], [1, 0.5], [1.5, 1.5], [3, 1]] },
  { id: 'two-halves', name: 'two minims', notes: [[0, 2], [2, 2]] },
  { id: 'after-beat-held', name: 'enters on the second beat and holds', notes: [[1, 1], [2, 2]] },
];
/** The plainer alternative: half-bar notes and one entrance after the beat. */
export const VIOLA_PLAIN_CELL_IDS: readonly string[] = ['two-halves', 'after-beat-held'];

/**
 * Plucked accompaniment. A grounded cell begins with the bass of the chord
 * on the downbeat (used when no lower string sounds in the bar); an
 * afterbeat cell leaves the downbeat to whoever has it.
 */
export const VIOLA_PULSE_CELLS: readonly (RhythmCell & { readonly grounded: boolean; readonly sparse: boolean })[] = [
  { id: 'ground-3', name: 'bass on one, then the off-beats of two and of three and beat four', notes: [[0, 0.5], [1.5, 0.5], [2.5, 0.5], [3, 0.5]], grounded: true, sparse: false },
  { id: 'ground-2', name: 'bass on one, the off-beat of two, beat four', notes: [[0, 0.5], [1.5, 0.5], [3, 0.5]], grounded: true, sparse: false },
  { id: 'ground-1', name: 'bass on one and the off-beat of three', notes: [[0, 0.5], [2.5, 0.5]], grounded: true, sparse: true },
  { id: 'after-4', name: 'the four off-beats', notes: [[0.5, 0.5], [1.5, 0.5], [2.5, 0.5], [3.5, 0.5]], grounded: false, sparse: false },
  { id: 'after-pairs', name: 'beat two and its off-beat, beat four and its off-beat', notes: [[1, 0.5], [1.5, 0.5], [3, 0.5], [3.5, 0.5]], grounded: false, sparse: false },
  { id: 'after-2', name: 'the off-beats of two and of four', notes: [[1.5, 0.5], [3.5, 0.5]], grounded: false, sparse: true },
];

export const VIOLA = {
  role: 'violas',
  /** Sounding MIDI. Below `slowBelow` (the C string) the instrument speaks slowly; above `foregroundAbove` it is penetrating and is kept for the foreground. */
  slowBelow: 55,
  foregroundAbove: 72,
  /** The highest a plucked accompaniment note goes. */
  pulseCeiling: 62,
  /** The Viola stays at least this far below the lowest violin note sounding with it (semitones). */
  clearance: 3,
  /** Room needed under the violins for a part to be worth writing (semitones between its floor and its ceiling). */
  minRoom: 8,
  /** Bowed notes sounding without a rest for longer than this (beats) are one bow too many: the line must breathe. */
  maxUnbrokenBeats: 8,
  /** Rest needed between a plucked note and a bowed one (beats): the hand has to come back to the bow. */
  arcoPreparationBeats: 1,
  /** How long a plucked note is written (beats). */
  pizzLengthBeats: 0.25,
  /** How long a plucked note counts as sounding when the voices are judged together (beats). */
  pizzRingBeats: 0.5,
  /** How much softer than a leading voice each role is played (MIDI velocity). */
  level: { tacet: 0, reply: 0, 'inner-line': -6, pulse: -10, arrival: -12 } as Readonly<Record<ViolaRole, number>>,
  /** The bow stroke each role asks for. A role whose stroke the instrument cannot trigger is declined, not approximated. */
  articulation: { 'inner-line': 'legato', reply: 'legato', arrival: 'sustain', pulse: 'pizz' } as Readonly<Record<Exclude<ViolaRole, 'tacet'>, Articulation>>,
} as const;

/**
 * What a melodic move costs in a bowed line, by size in scale steps
 * (lower is preferred; null = the Viola does not make this move). Steps and
 * thirds are its way of moving; a fourth or fifth is an event; a sixth is
 * rare; a repeated note is a held breath, used sparingly.
 */
export function violaLineMove(steps: number): number | null {
  switch (Math.abs(steps)) {
    case 0: return 1;
    case 1: return 0;
    case 2: return 0.3;
    case 3: return 0.8;
    case 4: return 1.2;
    case 5: return 1.8;
    case 7: return 2.4;
    default: return null;
  }
}

/** The same for a plucked figure, which is a broken chord: it wants thirds to fifths, not steps. */
export function violaPulseMove(steps: number): number | null {
  switch (Math.abs(steps)) {
    case 0: return 1.5;
    case 1: return 1;
    case 2: case 3: case 4: return 0;
    case 5: return 0.5;
    case 7: return 0.8;
    default: return null;
  }
}
