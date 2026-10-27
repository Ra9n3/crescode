/**
 * Generation rules config — schema.
 *
 * The engine contains NO compositional logic. Everything musical is described
 * here and interpreted generically by src/engine/generate.ts. See README
 * "Writing your own rules" for a walkthrough.
 *
 * Units:
 *   - Rhythm step positions/lengths are expressed in the pattern's `unit`
 *     ('beat' = felt beat of the meter, 'quarter', 'eighth', 'sixteenth',
 *     'pulse' = the time-signature denominator, 'bar').
 *   - Register is a fraction of the track's range (0 = lowest, 1 = highest),
 *     or absolute MIDI numbers with `absolute: true`.
 */
import type { Note, Track } from '../shared/schema/types';
import type { ParsedChord } from '../shared/schema/chords';

/** Musical role names. Extensible: any string is allowed. */
export type PartRole = 'bass' | 'pad' | 'harmony' | 'melody' | 'counterMelody' | 'accent' | 'percussion' | (string & {});

export type RhythmUnit = 'beat' | 'quarter' | 'eighth' | 'sixteenth' | 'triplet8' | 'pulse' | 'bar';

export interface RhythmStep {
  /** Position from the cycle start, in `unit`s. */
  at: number;
  /** Length in `unit`s. */
  len: number;
  /** Added to velocity (can be negative). */
  accent?: number;
  /** Probability 0..1 this step plays (multiplied by densities). Default 1. */
  prob?: number;
}

export type RhythmSpec =
  | string // name of an entry in rules.patterns
  | {
      type: 'sustain';
      /** Where sustained notes are split: at chord changes, bars, both, beats, or once per section. */
      per?: 'chord' | 'bar' | 'chordOrBar' | 'beat' | 'section';
    }
  | {
      type: 'pattern';
      unit?: RhythmUnit;
      steps: RhythmStep[];
      /** Cycle length in units. Default: one bar. */
      cycle?: number;
      /** Restart the cycle each bar (default) or run continuously from the section start. */
      anchor?: 'bar' | 'section';
    };

export type PitchSource =
  | 'chord'      // all chord tones (slash bass included)
  | 'chordUpper' // chord tones without the slash bass
  | 'root'       // chord root
  | 'bass'       // slash bass, or root when there is none
  | 'scale'      // key + mode scale
  | 'fixed';     // a single fixed MIDI note (percussion)

export type Motion =
  | 'block'        // hold a voicing, voice-lead smoothly when the chord changes
  | 'arpeggioUp' | 'arpeggioDown' | 'arpeggioUpDown'
  | 'stepwise'     // melodic: move to a nearby candidate each step
  | 'random';

export interface PitchSpec {
  source: PitchSource;
  /** Optional subset of the source list by index (0 = first chord tone / scale degree 1). */
  degrees?: number[];
  /** Number of simultaneous notes. Default 1. */
  voices?: number;
  /** 'close' stacks adjacent candidates, 'open' skips one between voices. */
  spread?: 'close' | 'open';
  /** Register window. Fractions of the track range unless absolute. Default [0.3, 0.7]. */
  register?: [number, number];
  absolute?: boolean;
  motion?: Motion;
  /** For 'stepwise': maximum leap in semitones (default 5). */
  maxLeap?: number;
  /** For 'scale' sources: on beat 1 of a chord, snap to a chord tone. */
  chordToneOnStrongBeats?: boolean;
  /** Fixed MIDI note (source 'fixed'). Default: the track's lowestNote. */
  note?: number;
  /** Skip candidates that a locked track is sounding at the same tick (avoid unisons). */
  avoidLockedUnisons?: boolean;
}

export interface Articulation {
  /** Fraction of the step length actually sounded (0.05..1). Default 0.95. */
  legato?: number;
  /** Minimum note length in ticks. Default 30. */
  minTicks?: number;
}

export interface FillSpec {
  when: 'lastBarOfSection' | 'everyNBars' | 'firstBarOfSection';
  n?: number;
  rhythm: RhythmSpec;
  velocityOffset?: number;
}

export interface VariationSpec {
  /** Applied when this section name occurs for the 2nd+ time. */
  octaveShiftOnRepeat?: number;
  densityScaleOnRepeat?: number;
  velocityOffsetOnRepeat?: number;
  /** Use a different random stream per occurrence (default true). */
  reseedPerOccurrence?: boolean;
}

export interface PartContext {
  track: Track;
  section: ResolvedSection;
  part: PartRule;
  ctx: GenerationContext;
  rng: () => number;
  /** All MIDI pitches in [lo, hi] whose pitch class is in pcs, ascending. */
  candidates: (pcs: number[], lo: number, hi: number) => number[];
}

export interface PartRule {
  /** Free label, shown in the harness summary. */
  label?: string;
  /** Which tracks this part applies to (any match). */
  match: { roles?: string[]; families?: string[]; trackNames?: string[] };
  role: PartRole;
  pitch: PitchSpec;
  rhythm: RhythmSpec;
  velocity?: [number, number];
  velocityCurve?: 'flat' | 'crescendo' | 'diminuendo';
  density?: number;
  articulation?: Articulation;
  /** Extra copies at these semitone intervals (kept only if in range). */
  doubling?: number[];
  /** Instead of generating, copy another track's notes (generated or locked) for this section. */
  doubleOf?: { role: string; interval: number };
  fill?: FillSpec;
  /** Only play on these occurrences of the section (1-based). */
  occurrences?: number[];
  /** Hook: replace built-in generation entirely for this part. */
  custom?: (pc: PartContext) => Note[];
  /** Hook: post-process the part's notes (voicings, accents, fills...). */
  transform?: (notes: Note[], pc: PartContext) => Note[];
}

export interface SectionRules {
  density?: number;
  velocityScale?: number;
  parts: PartRule[];
  variation?: VariationSpec;
}

export interface GenerationRules {
  version: 1;
  description?: string;
  patterns: Record<string, RhythmSpec>;
  /**
   * Keyed by section name (case-insensitive). Lookup order:
   * exact name → name without trailing number ("Verse 2" → "Verse") → "*".
   */
  sections: Record<string, SectionRules>;
  humanize?: { maxVelocityDelta?: number; maxTimingMs?: number };
}

/* ---------- Context provided to rules/hooks by the engine ---------- */

export interface ResolvedChord { id: string; symbol: string; startTick: number; endTick: number; parsed: ParsedChord }

export interface ResolvedSection {
  id: string; name: string; ruleKey: string; index: number; occurrence: number;
  startBar: number; lengthBars: number; startTick: number; endTick: number;
}

export interface MeterInfo {
  numerator: number; denominator: number;
  barTicks: number; beatTicks: number; pulseTicks: number; beatOffsets: number[]; compound: boolean;
}

export interface GenerationContext {
  ppq: number;
  bpm: number;
  key: number;
  mode: string;
  scalePitchClasses: number[];
  meter: MeterInfo;
  endTick: number;
  bars: number;
  chords: ResolvedChord[];
  sections: ResolvedSection[];
  chordAt: (tick: number) => ResolvedChord;
  options: { seed: number; density: number; humanize: boolean; lockedTrackIds: string[] };
  /** Notes of locked tracks, keyed by track id and by role. */
  lockedNotes: { byTrackId: Record<string, Note[]>; byRole: Record<string, Note[]> };
  /** Notes generated so far in this run, keyed by role (filled in track order). */
  generatedByRole: Record<string, Note[]>;
}
