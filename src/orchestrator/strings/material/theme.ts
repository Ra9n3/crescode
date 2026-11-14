/**
 * Theme generation (Strings V1, Stage 2) — one theme with a stated identity.
 *
 * A theme is two bars: a HEAD (the first bar — the hook) and a TAIL. It is
 * searched, not drawn: every head the small grammar below allows is tried
 * against the harmony of the theme's home, then every tail that continues
 * it, and each complete candidate is judged by the line rules and scored
 * for the things that make a tune recognisable:
 *
 *   - one characteristic rising leap, filled by step afterwards;
 *   - a rhythm with a long note and a short one (never all equal);
 *   - at least one dissonance that leans on the harmony and resolves;
 *   - a single high point that is neither the first nor the last note;
 *   - the mode's own colour note, where the mode has one.
 *
 * A candidate made only of chord tones is rejected: the theme's identity
 * is its intervals, rhythm and dissonances, not a list of chord tones.
 *
 * Deterministic: the seed only breaks near-ties between candidates.
 */
import { mulberry32 } from '../../../engine/generate';
import { chordAt, judgeLine, metricWeight, pitchClassOf, semitonesOf, type LineNote, type NoteFunction, type TonalFrame } from './line';

export interface ThemeNote extends LineNote {
  readonly inHead: boolean;
  readonly function: NoteFunction;
}

export interface ThemeIdentity {
  /** Diatonic moves between consecutive notes (+1 = a step up). */
  readonly intervals: readonly number[];
  readonly semitoneIntervals: readonly number[];
  /** Durations in beats. */
  readonly rhythm: readonly number[];
  /** One sign per move. */
  readonly contour: string;
  /** The leap that names the theme: between note `fromIndex` and the next. */
  readonly leap: { readonly fromIndex: number; readonly steps: number; readonly semitones: number; readonly name: string };
  readonly apexIndex: number;
  /** Dissonances and where each resolves. */
  readonly dissonances: readonly { readonly index: number; readonly kind: NoteFunction; readonly resolvesToIndex: number; readonly direction: 'down' | 'up' }[];
  /** The mode's characteristic note where the theme holds it. */
  readonly colourTone: { readonly index: number; readonly pitchClass: number; readonly reason: string } | null;
  readonly chromatic: readonly { readonly index: number; readonly kind: string }[];
  readonly character: string;
  /** Must survive every adaptation. */
  readonly protectedFeatures: readonly string[];
  /** Kept when the harmony allows; an adaptation reports their loss. */
  readonly preferredFeatures: readonly string[];
}

export interface Theme {
  readonly id: string;
  /** Notes with ticks relative to the theme's start. */
  readonly notes: readonly ThemeNote[];
  readonly lengthTicks: number;
  readonly headCount: number;
  readonly identity: ThemeIdentity;
  readonly home: { readonly startTick: number; readonly endTick: number; readonly chords: readonly string[] };
  readonly score: number;
  readonly scoreParts: Readonly<Record<string, number>>;
  readonly candidatesJudged: number;
}

export type ThemeResult = { readonly ok: true; readonly theme: Theme } | { readonly ok: false; readonly reason: string };

/** Bars per theme. */
export const THEME_BARS = 2;

/** The rhythm vocabulary, in beats, per beats-in-a-bar. A metre without an entry has no theme (reported, never guessed). */
export const THEME_RHYTHMS: Readonly<Record<number, { readonly heads: readonly (readonly number[])[]; readonly tails: readonly (readonly number[])[] }>> = {
  4: {
    heads: [[1.5, 0.5, 1, 1], [1, 0.5, 0.5, 2], [1.5, 0.5, 2], [1, 1, 1.5, 0.5], [2, 1, 1]],
    tails: [[1, 1, 2], [1.5, 0.5, 2], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2], [2, 2]],
  },
  3: {
    heads: [[1.5, 0.5, 1], [1, 0.5, 0.5, 1], [2, 1], [1, 1, 1]],
    tails: [[1, 2], [0.5, 0.5, 2], [1.5, 0.5, 1], [3]],
  },
};

const INTERVAL_NAMES: Readonly<Record<number, string>> = { 3: 'minor third', 4: 'major third', 5: 'fourth', 7: 'fifth', 8: 'minor sixth', 9: 'major sixth', 12: 'octave' };
const HEAD_MOVES = [-2, -1, 1, 2] as const;
const HEAD_LEAPS = [3, 4, 5] as const;
const TAIL_MOVES = [-2, -1, 1, 2] as const;
const HEADS_KEPT = 16;

/** The scale degree (0-indexed) that tells this mode from plain major or minor; null for those two. */
export function colourDegreeOf(scale: readonly number[]): number | null {
  const reference = scale[2] === 4 ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const index = scale.findIndex((s, i) => s !== reference[i]);
  return index < 0 ? null : index;
}

function sequences<T>(options: readonly T[], length: number): T[][] {
  let out: T[][] = [[]];
  for (let i = 0; i < length; i++) out = out.flatMap((s) => options.map((o) => [...s, o]));
  return out;
}

function lineFrom(startTick: number, firstStep: number, moves: readonly number[], rhythm: readonly number[], beat: number): LineNote[] {
  const notes: LineNote[] = [];
  let tick = startTick;
  let step = firstStep;
  rhythm.forEach((beats, i) => {
    if (i > 0) step += moves[i - 1];
    notes.push({ tick, duration: Math.round(beats * beat), step, alter: 0 });
    tick += Math.round(beats * beat);
  });
  return notes;
}

interface Scored { readonly notes: LineNote[]; readonly functions: readonly NoteFunction[]; readonly headCount: number; readonly score: number; readonly parts: Record<string, number> }

function scoreTheme(frame: TonalFrame, notes: LineNote[], functions: readonly NoteFunction[], headCount: number): { score: number; parts: Record<string, number> } | null {
  const n = notes.length;
  const moves = notes.slice(1).map((x, i) => x.step - notes[i].step);
  const dissonant = functions.map((f) => f !== 'chord-tone');
  const ratio = dissonant.filter(Boolean).length / n;
  if (ratio === 0) return null; // a list of chord tones is not a theme
  const steps = notes.map((x) => x.step);
  const top = Math.max(...steps);
  const range = top - Math.min(...steps);
  if (range < 4 || range > 8) return null;
  const parts: Record<string, number> = {};
  // the leaning dissonance
  const appoggiatura = functions.findIndex((f, i) => (f === 'appoggiatura' || f === 'suspension') && i < n - 1);
  parts.dissonance = appoggiatura < 0 ? 0 : moves[appoggiatura] === -1 ? 3 : 1.5;
  // a dissonance leans; held for longer than a beat and a half it stops leaning and starts to sit
  parts.dissonanceLength = notes.some((x, i) => dissonant[i] && x.duration > frame.beatTicks * 1.5) ? -1.5 : 0;
  parts.dissonanceShare = ratio >= 0.2 && ratio <= 0.45 ? 2 : ratio < 0.15 ? -3 : 0;
  // the mode's colour
  const colour = colourDegreeOf(frame.scale);
  const colourIndex = colour === null ? -1 : notes.findIndex((x) => ((x.step % 7) + 7) % 7 === colour && x.alter === 0);
  parts.colour = colourIndex < 0 ? 0 : 1.5 + (notes[colourIndex].duration >= frame.beatTicks ? 1 : 0);
  // one high point, inside the theme
  const apexes = steps.filter((s) => s === top).length;
  const apex = steps.indexOf(top);
  parts.apex = (apexes === 1 ? 1.5 : 0) + (apex >= 1 && apex <= n - 3 ? 1 : 0);
  // the leap is filled by step in the other direction
  const leapAt = moves.findIndex((m) => m >= 3);
  parts.gapFill = (moves[leapAt + 1] === -1 ? 0.75 : 0) + (moves[leapAt + 1] === -1 && moves[leapAt + 2] === -1 ? 0.75 : 0);
  parts.leap = moves[leapAt] >= 4 ? 0.5 : 0;
  // rhythm
  const durations = notes.map((x) => x.duration);
  parts.rhythm = (new Set(durations).size >= 3 ? 1 : 0)
    + (durations.slice(0, headCount).join() !== durations.slice(headCount, headCount * 2).join() ? 0.5 : 0);
  parts.range = range >= 5 ? 1 : 0;
  // the last note: the third or fifth of its chord leaves the theme open to continue
  const last = notes[n - 1];
  const lastChord = chordAt(frame, last.tick)!;
  const lastPc = pitchClassOf(frame, last);
  const lastInterval = (lastPc - lastChord.fact.rootPc + 12) % 12;
  parts.ending = lastInterval === 0 ? 0 : lastInterval === 10 || lastInterval === 11 ? 0.5 : 1;
  // the first note: root or fifth of the first chord is a firm place to begin
  const firstChord = chordAt(frame, notes[0].tick)!;
  const firstInterval = (pitchClassOf(frame, notes[0]) - firstChord.fact.rootPc + 12) % 12;
  parts.opening = firstInterval === 0 || firstInterval === 7 ? 1 : firstInterval === 3 || firstInterval === 4 ? 0.5 : 0;
  // the tail continues by step and reaches its last note by step
  parts.joins = (Math.abs(moves[headCount - 1]) === 1 ? 0.5 : 0) + (Math.abs(moves[n - 2]) === 1 ? 0.5 : 0);
  // no see-saw between two notes, and the tail does not climb back to the high point
  const seesaw = steps.some((s, i) => i >= 3 && s === steps[i - 2] && steps[i - 1] === steps[i - 3]);
  parts.seesaw = seesaw ? -1.5 : 0;
  parts.tailBelowApex = steps.slice(headCount).some((s) => s >= top) ? -1 : 0;
  const turns = moves.slice(1).filter((m, i) => Math.sign(m) !== Math.sign(moves[i])).length;
  parts.shape = turns >= 2 && turns <= 3 ? 1 : turns > 4 ? -1.5 : 0;
  parts.stepwise = moves.filter((m) => Math.abs(m) === 1).length / moves.length >= 0.55 ? 1 : 0;
  // the head should not simply be repeated as the tail's start
  parts.strongStart = metricWeight(frame, notes[0].tick) === 'strong' ? 0.5 : 0;
  return { score: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

function characterOf(identity: Pick<ThemeIdentity, 'dissonances' | 'leap' | 'rhythm' | 'contour'>): string {
  const words: string[] = [];
  words.push(identity.rhythm.some((r) => r >= 2) && identity.rhythm.filter((r) => r <= 0.5).length <= 2 ? 'lyrical' : 'flowing');
  if (identity.dissonances.some((d) => d.kind === 'appoggiatura' || d.kind === 'suspension')) words.push('leaning');
  words.push(identity.leap.semitones >= 7 ? 'wide-reaching' : 'compact');
  return words.join(', ');
}

/** Describes a finished line as a theme. Also used to re-describe an adapted theme. */
export function describeTheme(frame: TonalFrame, notes: readonly LineNote[], functions: readonly NoteFunction[]): ThemeIdentity {
  const moves = notes.slice(1).map((x, i) => x.step - notes[i].step);
  const semis = notes.slice(1).map((x, i) => semitonesOf(frame, x) - semitonesOf(frame, notes[i]));
  const leapAt = Math.max(0, moves.findIndex((m) => Math.abs(m) >= 3));
  const steps = notes.map((x) => x.step);
  const colour = colourDegreeOf(frame.scale);
  const colourIndex = colour === null ? -1 : notes.findIndex((x) => ((x.step % 7) + 7) % 7 === colour && x.alter === 0);
  const dissonances = functions
    .map((kind, index) => ({ kind, index }))
    .filter((d) => d.kind !== 'chord-tone' && d.kind !== 'pending' && d.index < notes.length - 1)
    .map((d) => ({ ...d, resolvesToIndex: d.index + 1, direction: (moves[d.index] < 0 ? 'down' : 'up') as 'down' | 'up' }));
  const base = {
    intervals: moves,
    semitoneIntervals: semis,
    rhythm: notes.map((x) => x.duration / frame.beatTicks),
    contour: moves.map((m) => (m > 0 ? '+' : m < 0 ? '-' : '=')).join(''),
    leap: { fromIndex: leapAt, steps: moves[leapAt] ?? 0, semitones: Math.abs(semis[leapAt] ?? 0), name: `rising ${INTERVAL_NAMES[Math.abs(semis[leapAt] ?? 0)] ?? `${Math.abs(semis[leapAt] ?? 0)} semitones`}` },
    apexIndex: steps.indexOf(Math.max(...steps)),
    dissonances,
  };
  return {
    ...base,
    colourTone: colourIndex < 0 ? null : { index: colourIndex, pitchClass: pitchClassOf(frame, notes[colourIndex]), reason: 'the scale degree that tells this mode from plain major or minor' },
    chromatic: notes.map((x, index) => ({ x, index })).filter(({ x }) => x.alter !== 0).map(({ index }) => ({ index, kind: functions[index] === 'chromatic-neighbour' ? 'chromatic lower neighbour' : 'chromatic inflection' })),
    character: characterOf(base),
    protectedFeatures: [
      'the rhythm of the head (the first bar)',
      `the ${base.leap.name.replace('rising ', '')} leap up between notes ${leapAt + 1} and ${leapAt + 2} (its size in scale steps)`,
      'the direction of every move in the head',
    ],
    preferredFeatures: [
      'the rhythm of the tail',
      'the direction of every move in the tail',
      ...(dissonances.length ? [`the dissonance on note ${dissonances[0].index + 1} and its resolution ${dissonances[0].direction} by step`] : []),
      ...(colourIndex >= 0 ? [`the mode's colour note on note ${colourIndex + 1}`] : []),
    ],
  };
}

export interface ThemeInput {
  readonly frame: TonalFrame;
  /** Where the theme is first stated: it is composed against the harmony here. */
  readonly homeTick: number;
  readonly seed: number;
}

export function generateTheme(input: ThemeInput): ThemeResult {
  const { frame, homeTick } = input;
  const vocabulary = THEME_RHYTHMS[frame.beatsPerBar];
  if (!vocabulary) return { ok: false, reason: `no theme rhythm vocabulary for ${frame.beatsPerBar} beats in a bar` };
  if (frame.scale.length !== 7) return { ok: false, reason: 'the mode does not have seven notes' };
  const lengthTicks = THEME_BARS * frame.barTicks;
  const first = chordAt(frame, homeTick);
  if (!first || !chordAt(frame, homeTick + lengthTicks - 1)) return { ok: false, reason: `no harmony under the theme's home (ticks ${homeTick}-${homeTick + lengthTicks})` };
  const rng = mulberry32((input.seed ^ 0x51ed270b) >>> 0);
  const starts = [0, 1, 2, 3, 4, 5, 6].filter((s) => first.fact.pitchClasses.includes(pitchClassOf(frame, { step: s, alter: 0 })));

  // heads: exactly one rising leap; the other moves are steps and thirds
  interface Head { notes: LineNote[]; rank: number }
  const heads: Head[] = [];
  for (const rhythm of vocabulary.heads) {
    const moveCount = rhythm.length - 1;
    for (let leapAt = 0; leapAt < moveCount; leapAt++) {
      for (const leap of HEAD_LEAPS) {
        for (const others of sequences(HEAD_MOVES, moveCount - 1)) {
          const moves = [...others.slice(0, leapAt), leap, ...others.slice(leapAt)];
          for (const start of starts) {
            const notes = lineFrom(homeTick, start, moves, rhythm, frame.beatTicks);
            const judged = judgeLine(frame, notes, { finalStable: false });
            if (!judged.ok) continue;
            // a head is ranked by what it already shows: a filled leap, a dissonance, variety
            const filled = moves[leapAt + 1] === -1 ? 1 : 0;
            const dissonant = judged.functions.filter((f) => f !== 'chord-tone').length;
            heads.push({ notes, rank: filled * 2 + Math.min(2, dissonant) + new Set(rhythm).size * 0.5 + (leap >= 4 ? 0.5 : 0) + rng() * 0.6 });
          }
        }
      }
    }
  }
  if (heads.length === 0) return { ok: false, reason: `no head fits the harmony at tick ${homeTick} (${first.fact.symbol})` };
  heads.sort((a, b) => b.rank - a.rank);

  let judgedCount = heads.length;
  let best: Scored | null = null;
  for (const head of heads.slice(0, HEADS_KEPT)) {
    const lastHead = head.notes[head.notes.length - 1];
    for (const rhythm of vocabulary.tails) {
      for (const moves of sequences(TAIL_MOVES, rhythm.length)) {
        const tail = lineFrom(homeTick + frame.barTicks, lastHead.step + moves[0], moves.slice(1), rhythm, frame.beatTicks);
        const notes = [...head.notes, ...tail];
        judgedCount++;
        const judged = judgeLine(frame, notes, { finalStable: true });
        if (!judged.ok) continue;
        const scored = scoreTheme(frame, notes, judged.functions, head.notes.length);
        if (!scored) continue;
        const score = scored.score + rng() * 0.3;
        if (!best || score > best.score) best = { notes, functions: judged.functions, headCount: head.notes.length, score, parts: scored.parts };
      }
    }
  }
  if (!best) return { ok: false, reason: `no complete theme satisfies the line rules over the home harmony at tick ${homeTick}` };

  // one chromatic lower neighbour, where a short off-beat note rises a whole tone into the root or fifth of its chord
  let notes = best.notes;
  let functions = best.functions;
  for (let i = 0; i < notes.length - 1; i++) {
    const note = notes[i];
    const next = notes[i + 1];
    const chord = chordAt(frame, note.tick)!;
    const nextChord = chordAt(frame, next.tick)!;
    const nextPc = pitchClassOf(frame, next);
    if (note.duration > frame.beatTicks / 2 || metricWeight(frame, note.tick) === 'strong') continue;
    if (semitonesOf(frame, next) - semitonesOf(frame, note) !== 2) continue;
    if (nextPc !== nextChord.fact.rootPc && nextPc !== (nextChord.fact.rootPc + 7) % 12) continue;
    // not against a chord that holds the natural note
    if (chord.fact.pitchClasses.includes(pitchClassOf(frame, note))) continue;
    const raised = notes.map((x, j) => (j === i ? { ...x, alter: 1 } : x));
    const judged = judgeLine(frame, raised, { finalStable: true });
    if (!judged.ok) continue;
    notes = raised;
    functions = judged.functions;
    break;
  }

  const relative: ThemeNote[] = notes.map((x, i) => ({ ...x, tick: x.tick - homeTick, inHead: i < best!.headCount, function: functions[i] }));
  const chords = frame.harmony.chords.filter((c) => c.fact.startTick < homeTick + lengthTicks && c.fact.endTick > homeTick).map((c) => c.fact.symbol);
  return {
    ok: true,
    theme: {
      id: `theme-${(input.seed >>> 0).toString(16)}-${homeTick}`,
      notes: relative,
      lengthTicks,
      headCount: best.headCount,
      identity: describeTheme(frame, notes, functions),
      home: { startTick: homeTick, endTick: homeTick + lengthTicks, chords },
      score: Math.round(best.score * 1000) / 1000,
      scoreParts: best.parts,
      candidatesJudged: judgedCount,
    },
  };
}
