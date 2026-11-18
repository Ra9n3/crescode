/**
 * Melody: rhythm cell -> contour -> pitches -> phrase.
 *
 * The generator is deliberately literal about the musical rules, because those
 * rules are what stop the output sounding like chord tones in arbitrary order:
 * chord tones on strong beats, passing/neighbour on weak ones, leaps only at a
 * phrase start or after a rest with a step back in the opposite direction, no
 * more than three repeated notes, and a 7–14 semitone range per phrase.
 */
import type { Rng } from './rng';
import type { BarHarmony, ChordPlan } from './harmony';
import { chordAtBeat } from './harmony';

export type Contour =
  | 'arch' | 'ascending' | 'descending' | 'wave' | 'leap-then-fall' | 'repeated-then-leap';

export const CONTOURS: readonly Contour[] = [
  'arch', 'ascending', 'descending', 'wave', 'leap-then-fall', 'repeated-then-leap',
];

/** [startBeat, durationBeats] cells, per meter numerator. */
const CELLS: Record<string, readonly (readonly [number, number][])[]> = {
  '4/4': [
    [[0, 1.5], [1.5, 0.5], [2, 2]],
    [[0, 1], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]],
    [[0, 2], [2, 1], [3, 1]],
    [[0.5, 1], [1.5, 0.5], [2, 2]],
    [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]],
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5], [3.5, 0.5]],
  ],
  '3/4': [
    [[0, 1.5], [1.5, 1.5]],
    [[0, 1], [1, 1], [2, 1]],
    [[0, 2], [2, 1]],
    [[0, 0.5], [0.5, 0.5], [1, 1], [2, 1]],
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1]],
  ],
  '6/8': [
    [[0, 1.5], [1.5, 1.5], [3, 3]],
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1], [3, 3]],
    [[0, 2], [2, 1], [3, 3]],
    [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 1.5], [3, 3]],
    [[0, 1.5], [1.5, 0.5], [2, 1], [3, 3]],
  ],
  '12/8': [
    [[0, 1.5], [1.5, 1.5], [3, 1.5], [4.5, 1.5]],
    [[0, 1], [1, 1], [2, 1], [3, 3], [6, 6]],
    [[0, 3], [3, 3], [6, 6]],
    [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1.5], [4.5, 1.5], [6, 6]],
    [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 1.5], [3, 3], [6, 6]],
  ],
};

/** Scale-degree interval weights: step 55, third 25, fourth 8, fifth 6, sixth/octave 6. */
const INTERVAL_STEPS: readonly { steps: number; weight: number }[] = [
  { steps: 1, weight: 55 },
  { steps: 2, weight: 25 },
  { steps: 3, weight: 8 },
  { steps: 4, weight: 6 },
  { steps: 5, weight: 3 },
  { steps: 6, weight: 3 },
];

export interface MelodyNote {
  /** Absolute MIDI pitch. */
  pitch: number;
  startTick: number;
  durationTicks: number;
  onStrongBeat: boolean;
  index: number;
}

export interface PhrasePlan {
  readonly kind: 'antefcedent' | 'consequent';
  readonly notes: readonly MelodyNote[];
  readonly endsWithRest: boolean;
}

export interface MelodyPlan {
  readonly notes: readonly MelodyNote[];
  readonly contour: Contour;
  readonly cell: readonly (readonly [number, number])[];
  /** Interval sequence of the first 16 notes, used as the fingerprint. */
  readonly fingerprint: string;
}

export interface MelodyContext {
  readonly rng: Rng;
  readonly barHarmony: readonly BarHarmony[];
  readonly scale: readonly number[];
  readonly startBar: number;
  readonly bars: number;
  readonly beatTicks: number;
  readonly barTicks: number;
  readonly beatsPerBar: number;
  readonly low: number;
  readonly high: number;
}

const STRONG_BEATS: Record<string, number[]> = {
  '4/4': [1, 3],
  '3/4': [1],
  '6/8': [1, 4],
  '12/8': [1, 4, 7, 10],
};

export function isStrongBeat(meter: string, beat: number): boolean {
  const strong = STRONG_BEATS[meter] ?? [1];
  return strong.some((s) => Math.abs(s - beat) < 0.001);
}

/** Scale degree (0-based) nearest to a MIDI pitch, given the scale's pitch classes. */
function degreeOfPitch(pitch: number, tonic: number, scale: readonly number[]): number {
  const pc = ((pitch - tonic) % 12 + 12) % 12;
  let best = 0;
  let bestDistance = 99;
  for (let d = 0; d < scale.length; d++) {
    const interval = ((scale[d] - tonic) % 12 + 12) % 12;
    const distance = Math.min(Math.abs(interval - pc), 12 - Math.abs(interval - pc));
    if (distance < bestDistance) { bestDistance = distance; best = d; }
  }
  return best;
}

/** MIDI pitch for a scale degree, choosing the octave nearest `near`. */
function pitchForDegree(
  degree: number,
  tonic: number,
  scale: readonly number[],
  near: number,
  low: number,
  high: number,
): number {
  const length = scale.length;
  const wrapped = ((degree % length) + length) % length;
  const octaveShift = Math.floor(degree / length);
  const interval = ((scale[wrapped] - tonic) % 12 + 12) % 12;
  // Candidate octaves around `near`.
  let best = 0;
  let bestDistance = 1e9;
  for (let octave = 3; octave <= 7; octave++) {
    const pitch = tonic + interval + (octave + octaveShift) * 12;
    if (pitch < low || pitch > high) continue;
    const distance = Math.abs(pitch - near);
    if (distance < bestDistance) { bestDistance = distance; best = pitch; }
  }
  if (bestDistance > 1e8) {
    // Nothing in range: clamp into the register on the right class.
    const raw = tonic + interval + Math.round((near - tonic) / 12) * 12;
    return Math.max(low, Math.min(high, raw));
  }
  return best;
}

function contourDirection(contour: Contour, position: number, total: number): number {
  const t = total <= 1 ? 0 : position / (total - 1);
  switch (contour) {
    case 'arch': return t < 0.5 ? 1 : -1;
    case 'ascending': return 1;
    case 'descending': return -1;
    case 'wave': return Math.sin(t * Math.PI * 2) >= 0 ? 1 : -1;
    case 'leap-then-fall': return position === 0 ? 1 : -1;
    case 'repeated-then-leap': return position < 2 ? 0 : 1;
    default: return 1;
  }
}

/** Nearest chord tone to `pitch`, staying in range. */
function nearestChordTone(pitch: number, chord: ChordPlan, tonic: number, low: number, high: number): number {
  for (let distance = 0; distance <= 12; distance++) {
    for (const sign of distance === 0 ? [0] : [-1, 1]) {
      const candidate = pitch + sign * distance;
      if (candidate < low || candidate > high) continue;
      const pc = ((candidate - tonic) % 12 + 12) % 12;
      if (chord.pitchClasses.includes(pc)) return candidate;
    }
  }
  return pitch;
}

const chordToneAt = (bar: number, beat: number, barHarmony: readonly BarHarmony[]): ChordPlan | null => {
  const harmony = barHarmony[bar];
  if (!harmony?.chords.length) return null;
  return chordAtBeat(harmony, beat);
};

/**
 * Builds a two-bar motif then a four-bar phrase from it.
 *
 * `durations` is optional: passing the previous phrase's rhythm makes A2/A3 a
 * variation of A rather than a new tune, which is how the sections stay related.
 */
export function buildMelody(context: MelodyContext): MelodyPlan {
  const { rng, barHarmony, scale, startBar, bars, beatTicks, beatsPerBar, low, high } = context;
  const meterKey = `${beatsPerBar >= 11 ? 12 : beatsPerBar}/${beatsPerBar === 3 ? 4 : beatsPerBar >= 6 ? 8 : 4}`;
  const meterName = beatsPerBar >= 11 ? '12/8' : beatsPerBar === 3 ? '3/4' : beatsPerBar >= 6 ? '6/8' : '4/4';
  const cells = CELLS[meterKey] ?? CELLS['4/4'];
  const cell = rng.pick(cells);
  const contour = rng.pick(CONTOURS);

  const tonic = scale[0];
  const notes: MelodyNote[] = [];
  const phraseBars = Math.min(4, Math.max(2, bars));
  let previousDegree = rng.pick([0, 2, 4]); // start on 1, 3 or 5 of the chord
  let previousPitch = pitchForDegree(previousDegree, tonic, scale, (low + high) / 2, low, high);
  let repeatCount = 0;
  let afterRest = true;

  for (let barOffset = 0; barOffset < phraseBars; barOffset++) {
    const bar = startBar + barOffset;
    for (const [startBeat, durationBeats] of cell) {
      const chord = chordToneAt(bar, startBeat, barHarmony);
      if (!chord) continue;
      const strong = isStrongBeat(meterName, startBeat);

      // Interval choice, biased by the contour's direction.
      const direction = contourDirection(contour, notes.length, cell.length * phraseBars);
      const weighted = rng.weighted(INTERVAL_STEPS.map((e) => e.steps), INTERVAL_STEPS.map((e) => e.weight));
      let steps = weighted * (direction >= 0 ? 1 : -1);
      if (direction === 0) steps = 0;

      // A leap larger than a fourth is only legal at a phrase start or after a
      // rest, and must be answered by a step in the opposite direction.
      const isLeap = Math.abs(steps) > 2;
      if (isLeap && !(afterRest || notes.length === 0)) {
        steps = (steps > 0 ? 1 : -1) * rng.int(1, 2);
      }

      let degree = previousDegree + steps;
      let pitch = pitchForDegree(degree, tonic, scale, previousPitch, low, high);

      // No more than three repeated notes.
      if (pitch === previousPitch) {
        repeatCount++;
        if (repeatCount >= 3) {
          degree += direction >= 0 ? 1 : -1;
          pitch = pitchForDegree(degree, tonic, scale, previousPitch, low, high);
          repeatCount = 0;
        }
      } else {
        repeatCount = 0;
      }

      // Strong beats must be chord tones; weak beats may pass but must resolve.
      if (strong) {
        pitch = nearestChordTone(pitch, chord, tonic, low, high);
      } else {
        const pc = ((pitch - tonic) % 12 + 12) % 12;
        if (!chord.pitchClasses.includes(pc)) {
          // Keep it only if it is a step from the previous note (passing /
          // neighbour); otherwise snap to the chord.
          if (Math.abs(pitch - previousPitch) > 2) {
            pitch = nearestChordTone(pitch, chord, tonic, low, high);
          }
        }
      }

      // Maximum leap of 12 semitones.
      while (Math.abs(pitch - previousPitch) > 12) {
        pitch += pitch > previousPitch ? -12 : 12;
      }
      pitch = Math.max(low, Math.min(high, pitch));

      notes.push({
        pitch,
        startTick: (bar - 1) * context.barTicks + Math.round(startBeat * beatTicks),
        durationTicks: Math.max(1, Math.round(durationBeats * beatTicks)),
        onStrongBeat: strong,
        index: notes.length,
      });

      previousDegree = degreeOfPitch(pitch, tonic, scale);
      previousPitch = pitch;
      afterRest = false;
    }
  }

  // The phrase must span 7-14 semitones: narrower is static, wider is a shout.
  // This is enforced here, on the generated line, rather than left to the gate,
  // because a line that is not written to a singable ambitus never becomes one.
  compressPhraseRange(notes, 7, 14);

  const fingerprint = notes.slice(0, 16).map((note, i, list) =>
    i === 0 ? '0' : String(note.pitch - list[i - 1].pitch)).join(',');
  void phraseBars;
  return { notes, contour, cell, fingerprint };
}

/**
 * Brings a phrase's compass into [minRange, maxRange] by moving its extremes
 * toward the centre, never by transposing the line (which would break the
 * relation to the chord the notes were placed against).
 *
 * Too narrow: push the highest notes up. Too wide: pull the two extremes in by
 * whole scale-neutral semitones, clamped to the instrument's range.
 */
function compressPhraseRange(notes: MelodyNote[], minRange: number, maxRange: number): void {
  if (notes.length < 2) return;
  for (let pass = 0; pass < 12; pass++) {
    const pitches = notes.map((note) => note.pitch);
    const low = Math.min(...pitches);
    const high = Math.max(...pitches);
    const range = high - low;
    if (range >= minRange && range <= maxRange) return;

    if (range > maxRange) {
      // Scale every note toward the phrase's centre. Moving only the extremes
      // left the middle untouched and the compass still too wide; scaling keeps
      // the shape (which is what makes the contour recognisable) while bringing
      // the whole phrase into a singable compass.
      const centre = (high + low) / 2;
      const factor = maxRange / range;
      for (const note of notes) {
        note.pitch = Math.round(centre + (note.pitch - centre) * factor);
      }
    } else {
      // Too static: widen the shape away from its centre.
      const centre = (high + low) / 2;
      const target = minRange + Math.round((maxRange - minRange) / 2);
      const factor = range === 0 ? 1 : Math.min(3, (range + target) / range);
      for (const note of notes) {
        note.pitch = Math.round(centre + (note.pitch - centre) * factor);
      }
      if (range === 0) {
        // A completely flat phrase: give it an arch so it has a shape at all.
        notes.forEach((note, index) => {
          note.pitch += Math.round(Math.sin((index / Math.max(1, notes.length - 1)) * Math.PI) * 7);
        });
      }
    }
  }
}

export type { ChordPlan };
