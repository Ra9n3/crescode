/**
 * Rhythmic texture for the strings realization.
 *
 * The historical realization wrote ONE note per harmony span for every
 * accompanying voice. Measured on three-chorus-40bars / chamber that gave
 * violas and cellos a single 3840-tick duration for 100% of their notes while
 * violins1 led at 480. The result reads as a pad under a tune: correct
 * harmony, no rhythmic life, and the Director's `pulse` / `accent` roles were
 * silently ignored because the branch that should have produced them never
 * looked at the role.
 *
 * This module answers one question -- how should this voice move through this
 * span? -- from musical context rather than from a fixed pattern:
 *
 *   - section function and energy decide the texture (a verse is restrained,
 *     a climax drives, a cadence resolves);
 *   - the voice's role decides what it is allowed to do (`pulse` insists on
 *     repetition, a `pad` insists on sustain);
 *   - a stable rotation varies the figure between spans so the piece is not
 *     one ostinato from bar 1 to bar 40.
 *
 * Every figure is expressed in BEATS and snapped to the caller's beat grid, so
 * a 3/4 input does not silently produce fragments the meter cannot express.
 */
import type { MusicalRole, PhraseFunction, Tick } from '../ir';

/** Musical character a span should carry. */
export interface TextureContext {
  readonly role: MusicalRole;
  readonly phraseFunction: PhraseFunction;
  /** 0..1 energy of the bar the span starts in. */
  readonly energy: number;
  /** 1 for the first span of a section, 2 for the second, ... */
  readonly spanOrdinal: number;
  /**
   * How many string voices sound in this texture. A two-part texture has no
   * middle to fill, so a subdividing bass leaves the lead exposed against a
   * moving line and every extra bass attack is another chance to collide with
   * the tune. Measured on three-chorus-40bars/sonata: adding rhythmic bass
   * notes there took octave doublings from 18 to 35, all of them lead+bass.
   * Sparse textures therefore keep the foundation sustained.
   */
  readonly voiceCount: number;
}

/**
 * One rhythmic cell: sounding length in beats, then rest in beats.
 * `rest: 0` means the next cell begins immediately (legato).
 */
export interface RhythmicCell {
  readonly beats: number;
  readonly rest: number;
}

const SUSTAIN: RhythmicCell[] = [{ beats: 4, rest: 0 }];

/**
 * Picks the rhythmic figure for one harmony span.
 *
 * Returns cells measured in beats; the caller converts to ticks and clamps to
 * the span. A single sustained cell means "hold for the span", which is the
 * honest answer for a pad or a span too short to subdivide.
 */
export function rhythmicFigureFor(context: TextureContext): RhythmicCell[] {
  const { role, phraseFunction, energy, spanOrdinal, voiceCount } = context;

  // A pad is a sustained harmonic floor: subdividing it contradicts the role.
  if (role === 'pad') return SUSTAIN;

  // The bass foundation may move, but must not become an ostinato unless the
  // passage is genuinely driving.
  if (role === 'bass') {
    // Two voices and no middle: the bass is the only support under the tune.
    // Moving it buys no texture and costs collisions.
    if (voiceCount <= 2) return SUSTAIN;
    if (energy >= 0.72 && phraseFunction !== 'cadence') {
      return rotate([
        [{ beats: 2, rest: 0 }],
        [{ beats: 1, rest: 1 }],
        [{ beats: 2, rest: 0 }, { beats: 1, rest: 1 }],
      ], spanOrdinal);
    }
    return SUSTAIN;
  }

  // A Director-assigned pulse is an ostinato by definition. Ignoring this role
  // was a defect, not a simplification.
  if (role === 'pulse') {
    return rotate([
      [{ beats: 1, rest: 0 }],
      [{ beats: 0.5, rest: 0.5 }],
      [{ beats: 1, rest: 0.5 }],
    ], spanOrdinal);
  }

  // Accents are short, separated hits.
  if (role === 'accent') {
    return rotate([
      [{ beats: 0.5, rest: 1.5 }],
      [{ beats: 0.5, rest: 0.5 }],
    ], spanOrdinal);
  }

  // Sparse textures stay sustained for EVERY role, not just the bass.
  //
  // A two- or three-voice string texture has no middle section to carry the
  // harmony: when an inner voice subdivides, the chord tones it was sustaining
  // disappear between attacks and the vertical sonority becomes ambiguous.
  // Measured on three-chorus-40bars/vocalbacking (violins2 + violas + cellos,
  // no lead), subdividing the viola made the Piano engine -- which reads this
  // part as its harmonic context -- drop three of its own notes. That is a real
  // loss of information, not a formatting difference.
  //
  // A four-voice section has enough redundancy to move; three does not.
  if (voiceCount <= 3) return SUSTAIN;

  // Inner voices: what rhythmic support means depends on the phrase function.
  switch (phraseFunction) {
    case 'climax':
      // Drive, but articulate it: the separated variant is what makes a climax
      // read as accented rather than merely loud.
      return rotate([
        [{ beats: 1, rest: 0.5 }, { beats: 1, rest: 0.5 }],
        [{ beats: 1, rest: 0 }, { beats: 1, rest: 0 }],
        [{ beats: 2, rest: 0.5 }],
      ], spanOrdinal);
    case 'transition':
      // Build: movement is introduced gradually, never at full density.
      return rotate([
        [{ beats: 1, rest: 0.5 }, { beats: 1, rest: 0.5 }],
        [{ beats: 2, rest: 0 }, { beats: 1, rest: 0 }],
        [{ beats: 2, rest: 1 }],
      ], spanOrdinal);
    case 'cadence':
      // Resolve: fewer attacks, longer notes, then a real breath.
      return rotate([
        [{ beats: 2, rest: 1 }, { beats: 1, rest: 0 }],
        [{ beats: 4, rest: 0 }],
        [{ beats: 2, rest: 0 }],
      ], spanOrdinal);
    case 'sustain':
      return SUSTAIN;
    case 'consequent':
      // The answer is a touch more active than the antecedent it answers.
      return rotate([
        [{ beats: 1, rest: 0.5 }, { beats: 1, rest: 0.5 }],
        [{ beats: 2, rest: 0 }, { beats: 1, rest: 0 }],
      ], spanOrdinal);
    default:
      // Antecedent and anything unclassified: restrained, energy-scaled.
      if (energy >= 0.62) {
        return rotate([
          [{ beats: 1, rest: 0.5 }, { beats: 1, rest: 0.5 }],
          [{ beats: 2, rest: 0 }, { beats: 1, rest: 0 }],
        ], spanOrdinal);
      }
      return rotate([
        [{ beats: 2, rest: 1 }],
        [{ beats: 2, rest: 0 }],
      ], spanOrdinal);
  }
}

function rotate<T>(options: readonly T[], ordinal: number): T {
  if (!options.length) throw new Error('rhythmic figure set must not be empty');
  // `ordinal` is 1-based (1 = the first span of the section). Index from 0, or
  // the first option is unreachable and a two-option set always answers with
  // its second figure -- which silently removed every `rest > 0` variant and
  // with it the separated articulation it should have produced.
  const index = ordinal - 1;
  return options[((index % options.length) + options.length) % options.length];
}

/**
 * Expands a figure across a span, returning concrete { start, end } slices.
 *
 * Guarantees the realization depends on:
 *  - no slice is empty or inverted;
 *  - no slice crosses the span boundary;
 *  - a tail shorter than one beat is absorbed into the previous slice rather
 *    than emitted as a fragment;
 *  - the first slice starts at the span start, so the harmony is audible on
 *    the chord change.
 */
export function expandFigure(
  figure: readonly RhythmicCell[],
  spanStart: Tick,
  lengthTicks: Tick,
  beatTicks: Tick,
): { start: Tick; end: Tick }[] {
  if (lengthTicks <= 0) return [];
  const out: { start: Tick; end: Tick }[] = [];
  const spanEnd = spanStart + lengthTicks;
  let cursor = spanStart;
  let index = 0;
  let guard = 0;
  while (cursor < spanEnd && guard++ < 512) {
    const cell = figure[index % figure.length];
    const soundTicks = Math.max(1, Math.round(cell.beats * beatTicks));
    const restTicks = Math.max(0, Math.round(cell.rest * beatTicks));
    const end = Math.min(spanEnd, cursor + soundTicks);
    if (end > cursor) out.push({ start: cursor, end });
    if (figure.length === 1 && cell.rest === 0 && soundTicks >= lengthTicks) break;
    cursor = Math.min(spanEnd, end + restTicks);
    index++;
  }
  if (!out.length) return [{ start: spanStart, end: spanEnd }];

  const last = out[out.length - 1];
  const tail = spanEnd - last.end;
  if (tail > 0 && tail < beatTicks) {
    out[out.length - 1] = { start: last.start, end: spanEnd };
  }
  return out;
}

/**
 * How far a repeated figure should shift, in scale steps, on each repetition.
 * `0` keeps an ostinato on one pitch (correct for a pedal); alternating small
 * steps let a repeated inner figure circle rather than climb out of register.
 */
export function pitchStepForRepetition(index: number, role: MusicalRole): number {
  if (role === 'pulse') return 0;
  if (index === 0) return 0;
  const pattern = [0, 1, -1, 1];
  return pattern[index % pattern.length];
}
