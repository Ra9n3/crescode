/**
 * Layer 2 — Composition Intelligence.
 *
 * Generates actual musical material: motifs, their development, and the phrase
 * structure they live in. This layer knows nothing about instruments — it
 * speaks scale degrees and rhythm, and leaves realization to the families.
 *
 * All randomness comes from a seeded stream, so the same seed and inputs
 * always produce the same music.
 */
import { scalePitchClasses } from '../../shared/schema/modes';
import type { Project } from '../../shared/schema/types';
import type {
  FormSection,
  HarmonicSpan,
  MeterGrid,
  Motif,
  MotifStatement,
  DevelopmentOp,
  Phrase,
  PhraseCue,
  PhraseFunction,
  Tick,
} from '../ir';

/* ---------------------------------------------------------------- rng */

/** Mulberry32, duplicated here so the new engine owns its own determinism. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------- motifs */

/**
 * Motif shapes are drawn from a small set of rhythmic characters, each with a
 * distinct musical identity. A seed picks among them and varies intervals, so
 * different seeds give genuinely different subjects rather than pitch noise.
 */
const RHYTHM_CELLS: readonly { name: string; durations: readonly number[] }[] = [
  { name: 'anacrusis', durations: [0.5, 0.5, 1, 2] },
  { name: 'long-short', durations: [2, 0.5, 0.5] },
  { name: 'arch', durations: [1, 1, 1, 1] },
  { name: 'dotted', durations: [1.5, 0.5, 1, 1] },
  { name: 'pickup-run', durations: [0.25, 0.25, 0.5, 1, 2] },
];

/**
 * Generates the piece's primary motif: a contour that rises and falls with a
 * clear apex, because a motif a listener can name needs a shape, not a
 * random walk.
 */
export function generateMotif(
  _project: Project,
  rng: () => number,
  beatTicks: number,
  originBar: number,
): Motif {
  const cell = RHYTHM_CELLS[Math.floor(rng() * RHYTHM_CELLS.length)];
  // Diatonic degrees, NOT wrapped to 0..size-1. Wrapping erased contour: an
  // ascending line 0..6..0 stored as 0,6,5,4 reads as a falling fifth, which
  // then produced 9-semitone "leaps" that were really octave wraparounds.
  const degrees: number[] = [];
  let degree = 0;
  const apex = 2 + Math.floor(rng() * 2); // 2..3 scale steps up
  for (let index = 0; index < cell.durations.length; index++) {
    if (index === 0) {
      degree = 0;
    } else if (index <= apex) {
      degree += rng() < 0.78 ? 1 : 2; // mostly step, occasionally a small leap
    } else {
      degree -= rng() < 0.8 ? 1 : 2;
    }
    degrees.push(degree);
  }
  const durations = cell.durations.map((factor) => Math.round(factor * beatTicks));
  return {
    id: `motif-${cell.name}-${originBar}`,
    degrees,
    durations,
    lengthTicks: durations.reduce((sum, value) => sum + value, 0),
    originBar,
  };
}

export function generateCounterMotif(
  _project: Project,
  rng: () => number,
  beatTicks: number,
  originBar: number,
): Motif {
  const cell = RHYTHM_CELLS[Math.floor(rng() * RHYTHM_CELLS.length)];
  // Diatonic degrees, unwrapped — see generateMotif.
  const degrees: number[] = [];
  let degree = 0;
  for (let index = 0; index < cell.durations.length; index++) {
    if (index > 0) degree += rng() < 0.62 ? -1 : 1;
    degrees.push(degree);
  }
  const durations = cell.durations.map((factor) => Math.round(factor * beatTicks));
  return {
    id: `motif2-${cell.name}-${originBar}`,
    degrees,
    durations,
    lengthTicks: durations.reduce((sum, value) => sum + value, 0),
    originBar,
  };
}

/* ------------------------------------------------------- development */

/**
 * States a motif at a position, applying one development operation. The
 * operation is recorded so development is auditable rather than opaque.
 */
export function stateMotif(
  motif: Motif,
  op: DevelopmentOp,
  startTick: Tick,
  degreesShift: number,
  sequence: number,
): MotifStatement {
  const scaled = motif.durations.map((d) => (op === 'augment' ? d * 2 : d));
  const length = scaled.reduce((sum, value) => sum + value, 0);
  const note = describeOp(op, degreesShift);
  return {
    id: `${motif.id}-s${sequence}`,
    motifId: motif.id,
    op,
    note,
    startTick,
    endTick: startTick + length,
    degreesShift,
  };
}

function describeOp(op: DevelopmentOp, shift: number): string {
  switch (op) {
    case 'identity': return 'stated plainly';
    case 'transpose': return `sequenced ${shift > 0 ? 'up' : 'down'} ${Math.abs(shift)} scale step(s)`;
    case 'invert': return 'inverted';
    case 'fragment': return 'fragmented (first half only)';
    case 'augment': return 'augmented (durations doubled)';
    case 'displace': return 'rhythmically displaced';
    case 'reorchestrate': return 'same shape, new colour';
  }
}

/**
 * Renders a statement into scale degrees, applying the transformation.
 * Returns the degrees the family engine will voice.
 */
export function statementDegrees(motif: Motif, statement: MotifStatement, scaleSize: number): number[] {
  // Degrees stay DIATONIC and unwrapped through every transformation. Wrapping
  // to 0..size-1 erased contour: an ascending 0,1,2,3 became a descending
  // 0,6,5,4 when "inverted", and the melodic line then contained octave-sized
  // jumps that were wraparound artefacts rather than musical gestures.
  switch (statement.op) {
    case 'invert': {
      // Mirror the intervals, not the pitch classes.
      const out: number[] = [motif.degrees[0] ?? 0];
      for (let index = 1; index < motif.degrees.length; index++) {
        const interval = signedInterval(motif.degrees[index - 1], motif.degrees[index], scaleSize);
        out.push(out[out.length - 1] - interval);
      }
      return out;
    }
    case 'fragment':
      return motif.degrees.slice(0, Math.max(2, Math.ceil(motif.degrees.length / 2)));
    case 'transpose':
    case 'displace':
    case 'reorchestrate':
    case 'augment':
    case 'identity':
      return motif.degrees.map((d) => d + statement.degreesShift);
  }
}

/**
 * The interval from `from` to `to` measured the way the motif actually moves.
 * Degrees are stored wrapped (0..size-1), so a step from 6 to 0 is conventionally
 * +1 (up a second through the octave) while 0 to 6 is -1. Choosing the smaller
 * absolute step keeps inversions faithful to the melody the listener hears.
 */
function signedInterval(from: number, to: number, size: number): number {
  const raw = to - from;
  const wrapped = ((raw % size) + size) % size;
  // Prefer the direction with the smaller interval; a sixth vs a second.
  return wrapped > size / 2 ? wrapped - size : wrapped;
}

export function statementDurations(motif: Motif, statement: MotifStatement): readonly Tick[] {
  const base = statement.op === 'augment' ? motif.durations.map((d) => d * 2) : [...motif.durations];
  if (statement.op === 'fragment') return base.slice(0, Math.max(2, Math.ceil(base.length / 2)));
  return base;
}

/**
 * Fits a scale degree to the harmony while preserving the motif's contour.
 *
 * Only used on strong beats: a non-chord tone on a weak beat is a passing or
 * neighbour note, which is ordinary melodic writing. Forcing every note onto a
 * chord tone turns a melody into an arpeggio and collapsed adjacent motif
 * steps onto one pitch (measured at 44% of adjacent pairs before this rule).
 */
export function fitDegreeToHarmony(
  project: Project,
  span: HarmonicSpan,
  degree: number,
  /** Direction the melody is currently moving (+1 rising, -1 falling, 0 none). */
  direction: number = 0,
  /** The degree immediately before this one, so contour is preserved. */
  previousDegree: number | null = null,
): { degree: number; pitchClass: number; chordTone: boolean } {
  const scale = scalePitchClasses(project.key, project.mode);
  const size = scale.length;
  const pcOf = (d: number): number => scale[((d % size) + size) % size];
  const basePc = pcOf(degree);
  if (span.pitchClasses.includes(basePc)) {
    return { degree, pitchClass: basePc, chordTone: true };
  }
  const previousPc = previousDegree === null ? null : pcOf(previousDegree);
  const previousDirection = previousDegree === null ? 0 : Math.sign(degree - previousDegree);
  const candidates: { degree: number; pitchClass: number; cost: number }[] = [];
  for (let delta = 1; delta <= size; delta++) {
    for (const sign of [1, -1]) {
      const candidateDegree = degree + sign * delta;
      const candidatePc = pcOf(candidateDegree);
      if (!span.pitchClasses.includes(candidatePc)) continue;
      let cost = delta;
      if (direction !== 0) cost += sign === Math.sign(direction) ? 0 : 2;
      if (previousPc !== null && candidatePc === previousPc) cost += 6;
      if (previousDirection !== 0 && sign !== previousDirection) cost += 1;
      candidates.push({ degree: candidateDegree, pitchClass: candidatePc, cost });
    }
  }
  if (!candidates.length) return { degree, pitchClass: basePc, chordTone: false };
  candidates.sort((a, b) => a.cost - b.cost);
  const best = candidates[0];
  return { degree: best.degree, pitchClass: best.pitchClass, chordTone: true };
}

/* ----------------------------------------------------------- phrases */

/**
 * Builds phrase structure over the form. Long sections split into
 * antecedent/consequent pairs; short ones stay single phrases. Each phrase is
 * FILLED with developed statements rather than dotted with two and abandoned —
 * a phrase that stops halfway reads as a hole.
 */
export function buildPhrases(
  sections: readonly FormSection[],
  grid: MeterGrid,
  primary: Motif,
  secondary: Motif,
  rng: () => number,
): { phrases: Phrase[]; statements: MotifStatement[] } {
  const phrases: Phrase[] = [];
  const statements: MotifStatement[] = [];
  let sequence = 0;

  // §13.2 criterion 3: antecedent/consequent pairing ACROSS a section boundary.
  // Choose the boundary deterministically — the LAST section boundary whose left
  // section has at least two phrases and whose right section opens a new phrase.
  // The left section's final phrase becomes the antecedent; the right section's
  // first phrase becomes its consequence, built from the SAME motif by
  // fragmentation. Nothing else about the form, timing or harmony moves.
  const crossBoundary = pickCrossSectionPair(sections);
  const antecedentPhraseId = crossBoundary ? `phrase-${crossBoundary.left.id}-${crossBoundary.leftIndex}` : null;
  const consequencePhraseId = crossBoundary ? `phrase-${crossBoundary.right.id}-0` : null;
  // The motif the antecedent actually used. The consequence MUST answer that
  // motif, not merely "the primary one": the antecedent of a long section is
  // often the secondary cell, and answering with the wrong cell is not an answer.
  let antecedentMotifId: string | null = null;

  for (const section of sections) {
    const bars = section.lengthBars;
    const beat = grid.beatTicks;
    const barTicks = grid.barTicks;
    const pairCount = bars >= 4 ? 2 : 1;
    const phraseBars = Math.max(1, Math.floor(bars / pairCount));
    for (let index = 0; index < pairCount; index++) {
      const startBar = section.startBar + index * phraseBars;
      const endBar = index === pairCount - 1 ? section.startBar + bars : startBar + phraseBars;
      const startTick = (startBar - 1) * barTicks;
      const endTick = Math.min(section.endTick, (endBar - 1) * barTicks);
      let fn = phraseFunctionFor(section, index, pairCount);
      const thisPhraseId = `phrase-${section.id}-${index}`;
      const isAntecedent = thisPhraseId === antecedentPhraseId;
      const isConsequence = thisPhraseId === consequencePhraseId;
      if (isAntecedent) fn = 'antecedent';
      if (isConsequence) fn = 'consequent';
      const cues: PhraseCue[] = [
        { kind: 'phrase-start', tick: startTick },
        { kind: 'phrase-end', tick: endTick },
      ];
      if (index === 0) cues.push({ kind: 'section-enter', tick: startTick });

      // Draw the default plan for EVERY phrase, including the consequence, so
      // the RNG stream is identical to before this feature existed. Skipping the
      // draw shifted every later phrase's transposition and changed material
      // nowhere near the pair (it pushed the dorian lead down into the inner
      // voices and created 64 voice crossings). The consequence then overrides
      // the plan: it answers by fragmenting the antecedent's motif first, which
      // is what makes the derivation audible as an answer rather than a
      // restatement.
      const ops: DevelopmentOp[] = isConsequence
        ? ['fragment', 'invert', 'transpose']
        : opsForPhrase(fn, index, rng);
      const statementIds: string[] = [];
      // The counterline is built separately from the lead's statements. Reusing
      // the lead's list meant both voices had identical onsets and durations,
      // so the "counter" sat at unison or the octave 84% of the time: doubling,
      // not counterpoint.
      const counterStatementIds: string[] = [];
      let counterCursor = -1;
      let cursor = startTick;
      const inherited: Motif | null = isConsequence && antecedentMotifId
        ? ([primary, secondary].find((candidate) => candidate.id === antecedentMotifId) ?? primary)
        : null;
      const motif: Motif = inherited
        ?? (index === 0 ? primary : (rng() < 0.55 ? primary : secondary));
      let opIndex = 0;
      let guard = 0;
      while (cursor < endTick && guard < 24) {
        guard++;
        const op = ops[opIndex % ops.length];
        const shift = op === 'transpose'
          ? (rng() < 0.5 ? 1 : -1) * (1 + Math.floor(rng() * 2))
          : 0;
        // Once the plan cycles, alternate to the contrasting motif so a long
        // phrase is not one idea hammered flat.
        const source = opIndex >= ops.length ? secondary : motif;
        let statement = stateMotif(source, op, cursor, shift, sequence);
        if (statement.endTick > endTick) {
          statement = stateMotif(source, 'fragment', cursor, shift, sequence);
        }
        if (statement.endTick > endTick) {
          const other = source === primary ? secondary : primary;
          statement = stateMotif(other, 'fragment', cursor, shift, sequence);
        }
        if (statement.endTick > endTick) break;
        sequence++;
        statements.push(statement);
        statementIds.push(statement.id);
        cursor = statement.endTick;
        opIndex++;
        if (cursor + beat < endTick) cursor += beat;
      }
      if (isAntecedent) {
        const firstStatement = statementIds.length ? statements.find((candidate) => candidate.id === statementIds[0]) : null;
        antecedentMotifId = firstStatement ? firstStatement.motifId : motif.id;
      }
      if (counterCursor < 0) counterCursor = startTick;
      let counterOpIndex = 0;
      let counterGuard = 0;
      while (counterCursor < endTick && counterGuard < 12) {
        counterGuard++;
        // The counterline speaks the contrasting idea, so it is recognisably a
        // different line rather than a copy of the lead.
        const op = ['identity', 'invert', 'augment', 'fragment'] as const;
        const counterOp = op[counterOpIndex % op.length];
        let counterStatement = stateMotif(secondary, counterOp, counterCursor, 0, sequence);
        if (counterStatement.endTick > endTick) {
          counterStatement = stateMotif(secondary, 'fragment', counterCursor, 0, sequence);
        }
        if (counterStatement.endTick > endTick) break;
        sequence++;
        statements.push(counterStatement);
        counterStatementIds.push(counterStatement.id);
        counterCursor = counterStatement.endTick + beat;
        counterOpIndex++;
      }
      phrases.push({
        id: thisPhraseId,
        sectionId: section.id,
        startTick,
        endTick,
        startBar,
        function: fn,
        statementIds,
        counterStatementIds,
        answersPhraseId: isConsequence ? antecedentPhraseId : null,
        cues,
      });
    }
  }
  return { phrases, statements };
}

/**
 * Chooses the section boundary that will carry the antecedent/consequent pair.
 *
 * The antecedent is the LAST phrase of its section (it hands over) and the
 * consequence is the FIRST phrase of the next section (it answers). That is the
 * arrangement a listener hears as a question followed by an answer across the
 * seam. Section boundaries, phrase counts and tick ranges are untouched: this
 * only decides which existing phrase pair gets the relationship.
 *
 * Deterministic: no RNG, and the scan order is fixed, so a given form always
 * produces the same pair. Sections must be long enough to contain two phrases on
 * the left and at least one on the right.
 */
export function pickCrossSectionPair(
  sections: readonly FormSection[],
): { left: FormSection; right: FormSection; leftIndex: number } | null {
  let best: { left: FormSection; right: FormSection; leftIndex: number; score: number } | null = null;
  for (let index = 1; index < sections.length; index++) {
    const left = sections[index - 1];
    const right = sections[index];
    if (!left || !right) continue;
    if (left.startTick >= left.endTick || right.startTick >= right.endTick) continue;
    const leftPairCount = left.lengthBars >= 4 ? 2 : 1;
    const rightPairCount = right.lengthBars >= 4 ? 2 : 1;
    // Both sides need two phrases: the left section's closing phrase hands over,
    // and the right section's opening phrase answers it. One-phrase sections
    // would make the "answer" the whole section rather than a phrase in it.
    if (leftPairCount < 2 || rightPairCount < 2) continue;
    // Score by SUBSTANCE ON BOTH SIDES, weighting the CONSEQUENCE. The answer
    // needs room to develop the motif through more than one transformation; a
    // two-bar consequence can only state a fragment, which is reuse rather than
    // development. The antecedent's bar count breaks ties, and equal scores go to
    // the later boundary. Fully deterministic: no RNG, fixed scan order.
    const leftPhraseBars =
      left.lengthBars - (leftPairCount - 1) * Math.max(1, Math.floor(left.lengthBars / leftPairCount));
    const rightPhraseBars = Math.max(1, Math.floor(right.lengthBars / rightPairCount));
    const score = rightPhraseBars * 2 + leftPhraseBars;
    if (!best || score >= best.score) {
      best = { left, right, leftIndex: leftPairCount - 1, score };
    }
  }
  return best ? { left: best.left, right: best.right, leftIndex: best.leftIndex } : null;
}

function phraseFunctionFor(
  section: FormSection,
  index: number,
  pairCount: number,
): PhraseFunction {
  if (section.function === 'closing') return index === pairCount - 1 ? 'cadence' : 'consequent';
  if (section.function === 'culmination') return index === pairCount - 1 ? 'climax' : 'antecedent';
  if (section.function === 'contrast') return 'sustain';
  if (pairCount === 1) return section.function === 'opening' ? 'antecedent' : 'consequent';
  return index === 0 ? 'antecedent' : 'consequent';
}

/**
 * The development plan per phrase: repetition with meaningful change.
 * An opening states, a consequent answers transformed, a climax augments,
 * a closing fragments and settles.
 */
function opsForPhrase(fn: PhraseFunction, _index: number, rng: () => number): DevelopmentOp[] {
  switch (fn) {
    case 'antecedent':
      return rng() < 0.65 ? ['identity', 'transpose'] : ['identity', 'invert'];
    case 'consequent':
      return rng() < 0.6 ? ['fragment', 'transpose'] : ['invert', 'transpose'];
    case 'climax':
      return ['augment', 'transpose'];
    case 'cadence':
      return ['fragment', 'identity'];
    case 'transition':
      return ['displace'];
    case 'sustain':
      return ['identity'];
  }
}
