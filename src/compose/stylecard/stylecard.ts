/**
 * The style card: everything that makes one Compose All click sound different
 * from the last. Each choice is drawn independently from its own distribution,
 * so the space of results is the product of all of them.
 */
import type { ModeName, TimeSignature } from '../../shared/schema/types';
import type { Rng } from './rng';

export type EnsembleKind = 'quartet' | 'quintet' | 'chamber' | 'full';

export type MoodName =
  | 'Cinematic Emotional' | 'Epic Heroic' | 'Tense Thriller' | 'Romantic Ballad'
  | 'Pastoral' | 'Baroque Dance' | 'Dark Mysterious' | 'Minimal Pulse' | 'Hopeful';

export interface Mood {
  readonly name: MoodName;
  readonly low: number;
  readonly high: number;
}

export const MOODS: readonly Mood[] = [
  { name: 'Cinematic Emotional', low: 60, high: 80 },
  { name: 'Epic Heroic', low: 90, high: 120 },
  { name: 'Tense Thriller', low: 100, high: 140 },
  { name: 'Romantic Ballad', low: 55, high: 75 },
  { name: 'Pastoral', low: 70, high: 95 },
  { name: 'Baroque Dance', low: 90, high: 130 },
  { name: 'Dark Mysterious', low: 50, high: 75 },
  { name: 'Minimal Pulse', low: 80, high: 110 },
  { name: 'Hopeful', low: 80, high: 105 },
];

/** Mode weights exactly as specified: 25/25/12/8/10/10/10. */
const MODE_TABLE: readonly { mode: ModeName; weight: number }[] = [
  { mode: 'Ionian', weight: 25 },
  { mode: 'Aeolian', weight: 25 },
  { mode: 'Dorian', weight: 12 },
  { mode: 'Phrygian', weight: 8 },
  { mode: 'Lydian', weight: 10 },
  { mode: 'Mixolydian', weight: 10 },
  { mode: 'Harmonic Minor', weight: 10 },
];

const METER_TABLE: readonly { meter: TimeSignature; weight: number }[] = [
  { meter: { numerator: 4, denominator: 4 }, weight: 50 },
  { meter: { numerator: 3, denominator: 4 }, weight: 20 },
  { meter: { numerator: 6, denominator: 8 }, weight: 15 },
  { meter: { numerator: 12, denominator: 8 }, weight: 15 },
];

export interface StyleCard {
  readonly ensemble: EnsembleKind;
  readonly tonic: number;
  readonly mode: ModeName;
  readonly meter: TimeSignature;
  readonly mood: Mood;
  readonly bpm: number;
}

export interface StyleOverrides {
  readonly tonic?: number | null;
  readonly mode?: ModeName | null;
  readonly bpm?: number | null;
  readonly meter?: TimeSignature | null;
}

export function drawStyleCard(rng: Rng, overrides: StyleOverrides = {}): StyleCard {
  const ensemble: EnsembleKind = rng.pick(['quartet', 'quintet', 'chamber', 'full'] as const);
  const tonic = overrides.tonic ?? rng.int(0, 11);
  const mode = overrides.mode ?? rng.weighted(MODE_TABLE.map((e) => e.mode), MODE_TABLE.map((e) => e.weight));
  const meter = overrides.meter ?? rng.weighted(METER_TABLE.map((e) => e.meter), METER_TABLE.map((e) => e.weight));
  const mood = rng.pick(MOODS);

  // Tempo is drawn inside the mood's range. A user-set BPM wins but is still
  // clamped into the mood range, so the mood and the tempo never contradict.
  const drawn = Math.round(rng.range(mood.low, mood.high));
  const wanted = overrides.bpm ?? drawn;
  const bpm = Math.max(mood.low, Math.min(mood.high, wanted));

  return { ensemble, tonic, mode, meter, mood, bpm };
}

/** Tracks the ensemble kind implies, in score order. */
export function tracksForEnsemble(kind: EnsembleKind): readonly string[] {
  switch (kind) {
    case 'quartet': return ['violins1', 'violins2', 'violas', 'cellosBasses'];
    case 'quintet': return ['violins1', 'violins2', 'violas', 'cellosBasses', 'basses'];
    case 'chamber': return ['violins1', 'violins2', 'violas', 'cellosBasses', 'basses', 'violins1Low'];
    case 'full': return ['violins1', 'violins2', 'violas', 'cellosBasses', 'basses', 'violins1Low'];
  }
}

/** Playing ranges in MIDI note numbers, from the spec. */
export const RANGES: Record<string, { low: number; high: number; leap: number }> = {
  violins1: { low: 55, high: 91, leap: 12 },
  violins2: { low: 55, high: 91, leap: 12 },
  violins1Low: { low: 43, high: 79, leap: 12 },
  violas: { low: 48, high: 81, leap: 12 },
  cellosBasses: { low: 36, high: 76, leap: 12 },
  basses: { low: 28, high: 55, leap: 7 },
};
