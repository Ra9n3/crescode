/**
 * Harmony: scale-degree progressions with real cadences.
 *
 * A chord is a scale degree plus a quality that the MODE actually produces, so
 * a Phrygian piece does not accidentally borrow a major IV. The exception the
 * spec calls for is deliberate: the dominant is major in harmonic minor and at
 * cadences in the minor modes, which is what makes those cadences cadence.
 */
import type { ModeName } from '../../shared/schema/types';
import { MODES } from '../../shared/schema/modes';
import type { Rng } from './rng';
import type { FormSectionPlan } from './form';

export interface ChordPlan {
  readonly degree: number;      // 0-based scale degree
  readonly semitone: number;    // absolute semitone above the tonic (may be chromatic)
  readonly pitchClasses: readonly number[]; // 0..11 absolute pitch classes
  readonly isCadence: boolean;
  readonly borrowed: boolean;
  readonly startBeat: number;   // beat within the bar
  readonly beats: number;       // length in beats
}

export interface BarHarmony {
  readonly chords: readonly ChordPlan[];
}

const MAJOR_POOLS: readonly (readonly number[])[] = [
  [0, 4, 5, 3],   // I V vi IV
  [0, 5, 3, 4],   // I vi IV V
  [5, 3, 0, 4],   // vi IV I V
  [0, 2, 3, 4],   // I iii IV V
  [0, 3, 5, 4],   // I IV vi V
  [0, 4, 3, 0],   // I V IV I
  [0, 5, 1, 4],   // I vi ii V
  [3, 0, 4, 5],   // IV I V vi
  [0, 10, 3, 0],  // I bVII IV I
  [0, 2, 5, 3],   // I iii vi IV
];

const MINOR_POOLS: readonly (readonly number[])[] = [
  [0, 8, 2, 10],  // i bVI bIII bVII
  [0, 3, 4, 0],   // i iv v i
  [0, 10, 8, 4],  // i bVII bVI V
  [0, 8, 3, 4],   // i bVI iv V
  [0, 3, 10, 2],  // i iv bVII bIII
  [0, 2, 10, 3],  // i bIII bVII iv
  [0, 4, 8, 10],  // i v bVI bVII
  [8, 10, 0, 0],  // bVI bVII i i
];

const isMinorish = (mode: ModeName): boolean =>
  mode === 'Aeolian' || mode === 'Dorian' || mode === 'Phrygian' || mode === 'Harmonic Minor';

/** The scale the piece is built on, as absolute pitch classes. */
export function scaleFor(tonic: number, mode: ModeName): number[] {
  return (MODES[mode] ?? MODES.Ionian).map((interval) => (tonic + interval) % 12);
}

/**
 * Quality for a chord built on `semitone` above the tonic, following the mode.
 * The dominant is major in harmonic minor and at minor cadences.
 */
function qualityFor(
  semitone: number,
  mode: ModeName,
  scale: readonly number[],
  cadence: boolean,
): number[] {
  const minorish = isMinorish(mode);
  // The two modal borrowings the spec asks for.
  if (!minorish && semitone === 5) return [0, 3, 7];       // borrowed iv in major
  if (minorish && semitone === 1) return [0, 4, 7];        // bII (Neapolitan) in minor

  const rootPc = scale.length ? scale[0] : 0;
  void rootPc;
  // Dominant: major when the mode is harmonic minor, and at any minor cadence.
  if (minorish && semitone === 7 && (mode === 'Harmonic Minor' || cadence)) {
    return [0, 4, 7, 11];
  }

  // Otherwise derive the triad from the scale's own degrees.
  const rootIndex = scale.findIndex((pc) => pc === ((rootPcSafe(scale, semitone)) % 12));
  if (rootIndex < 0) return [0, 4, 7];
  const third = (scale[(rootIndex + 2) % 7] - scale[rootIndex] + 12) % 12;
  const fifth = (scale[(rootIndex + 4) % 7] - scale[rootIndex] + 12) % 12;
  const seventh = (scale[(rootIndex + 6) % 7] - scale[rootIndex] + 12) % 12;
  const quality = [0, third, fifth];
  // A dominant seventh only where the mode supplies a minor seventh above it.
  if ((cadence || mode === 'Harmonic Minor') && semitone === 7) quality.push(seventh);
  return quality;
}

const rootPcSafe = (scale: readonly number[], semitone: number): number =>
  (scale[0] + semitone) % 12;

function chordAt(
  tonic: number,
  mode: ModeName,
  scale: readonly number[],
  semitone: number,
  cadence: boolean,
  borrowed: boolean,
  startBeat: number,
  beats: number,
): ChordPlan {
  const root = (tonic + semitone) % 12;
  const intervals = qualityFor(semitone, mode, scale, cadence);
  return {
    degree: Math.max(0, Math.min(6, scale.findIndex((pc) => pc === root))),
    semitone,
    pitchClasses: intervals.map((interval) => (root + interval) % 12),
    isCadence: cadence,
    borrowed,
    startBeat,
    beats,
  };
}

export interface HarmonyPlan {
  readonly bars: readonly BarHarmony[];
  /** Absolute pitch classes of the mode, for the melody. */
  readonly scale: readonly number[];
}

/**
 * Builds one chord (energy < 0.6) or two chords (>= 0.6) per bar, with cadences
 * at the end of every 4-bar phrase and the tonic as a whole note at the end.
 */
export function buildHarmony(
  rng: Rng,
  sections: readonly FormSectionPlan[],
  tonic: number,
  mode: ModeName,
  meterNumerator: number,
  totalBars: number,
): HarmonyPlan {
  const scale = scaleFor(tonic, mode);
  const minorish = isMinorish(mode);
  const pools = minorish ? MINOR_POOLS : MAJOR_POOLS;
  const bars: BarHarmony[] = [];

  let previousPoolIndex = -1;
  for (const section of sections) {
    // Each section takes a different pool from the one before it.
    let poolIndex = rng.int(0, pools.length - 1);
    if (pools.length > 1 && poolIndex === previousPoolIndex) {
      poolIndex = (poolIndex + 1 + rng.int(0, pools.length - 2)) % pools.length;
    }
    previousPoolIndex = poolIndex;
    const pool = [...pools[poolIndex]];

    // B and Bridge must not start on the tonic.
    if ((section.kind === 'B' || section.kind === 'B2' || section.kind === 'Bridge')
      && pool[0] === 0) {
      const replacement = [5, 3, 8].find((degree) => degree !== pool[0]);
      if (replacement !== undefined) pool[0] = replacement;
    }

    const twoPerBar = section.energy >= 0.6;
    for (let local = 0; local < section.bars; local++) {
      const barIndex = section.startBar - 1 + local;
      const isLastBarOfPiece = barIndex === totalBars - 1;
      const chords: ChordPlan[] = [];

      if (isLastBarOfPiece) {
        // The final bar is the tonic as a whole note.
        chords.push(chordAt(tonic, mode, scale, 0, true, false, 0, meterNumerator));
      } else if (twoPerBar && meterNumerator >= 4) {
        const half = meterNumerator / 2;
        for (let slot = 0; slot < 2; slot++) {
          const degree = pool[(local * 2 + slot) % pool.length];
          const cadence = local % 4 === 3 && slot === 1;
          chords.push(chordAt(tonic, mode, scale, degree, cadence, false, slot * half, half));
        }
      } else {
        // One chord per bar, cycling the pool so the progression is heard.
        const degree = pool[local % pool.length];
        // Cadence at the end of a 4-bar phrase: half at odd phrases (V), full
        // at even phrases (V -> I, or bVII -> I in modal writing).
        const phraseEnd = local % 4 === 3;
        let semitone = degree;
        let cadence = false;
        if (phraseEnd) {
          const phraseIndex = Math.floor(local / 4);
          const oddPhrase = phraseIndex % 2 === 0; // phrase 1, 3, ... end on V
          if (oddPhrase) {
            semitone = 7; // half cadence
            cadence = true;
          } else {
            semitone = 7; // full cadence starts the bar on V ...
            cadence = true;
          }
        }
        chords.push(chordAt(tonic, mode, scale, semitone, cadence, false, 0, meterNumerator));
        if (phraseEnd && local % 8 === 7) {
          // ... and resolves to the tonic later in the same bar.
          const tonicHalf = meterNumerator / 2;
          chords[0] = chordAt(tonic, mode, scale, 7, true, false, 0, tonicHalf);
          chords.push(chordAt(tonic, mode, scale, 0, true, false, tonicHalf, tonicHalf));
        }
      }

      // Climax has a 40% chance of one borrowed chord.
      if (section.kind === 'Climax' && rng.chance(0.4)) {
        const slot = rng.int(0, chords.length - 1);
        const borrowedSemitone = minorish ? 1 : 5;
        chords[slot] = chordAt(tonic, mode, scale, borrowedSemitone, false, true,
          chords[slot].startBeat, chords[slot].beats);
      }

      bars.push({ chords });
    }
  }

  // A chord held for more than 4 bars (outside the Intro) is a stuck harmony;
  // the spec asks for its third bar to move a fourth above.
  return { bars: breakStuckChords(bars, sections, tonic, mode, scale), scale };
}

function breakStuckChords(
  bars: readonly BarHarmony[],
  sections: readonly FormSectionPlan[],
  tonic: number,
  mode: ModeName,
  scale: readonly number[],
): BarHarmony[] {
  const out = bars.map((bar) => ({ chords: [...bar.chords] }));
  let run = 1;
  for (let i = 1; i < out.length; i++) {
    const previous = out[i - 1].chords[0];
    const current = out[i].chords[0];
    if (previous && current && previous.semitone === current.semitone) {
      run++;
      if (run > 4) {
        // Move this bar a fourth above (5 semitones) — but only outside Intro.
        const barNumber = i + 1;
        const inIntro = sections.some(
          (section) => section.kind === 'Intro'
            && barNumber >= section.startBar
            && barNumber < section.startBar + section.bars,
        );
        if (!inIntro) {
          const target = out[i].chords[0];
          out[i] = {
            chords: [
              chordAt(tonic, mode, scale, (target.semitone + 5) % 12, false, false,
                target.startBeat, target.beats),
              ...out[i].chords.slice(1),
            ],
          };
        }
        run = 1;
      }
    } else {
      run = 1;
    }
  }
  return out;
}

/** The chord sounding at a given beat within a bar. */
export function chordAtBeat(bar: BarHarmony, beat: number): ChordPlan {
  for (const chord of bar.chords) {
    if (beat >= chord.startBeat && beat < chord.startBeat + chord.beats) return chord;
  }
  return bar.chords[bar.chords.length - 1];
}
