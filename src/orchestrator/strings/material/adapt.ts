/**
 * Harmonic adaptation (Strings V1, Stage 2) — fitting existing material to
 * new harmony without losing what makes it recognisable.
 *
 * The four strategies, tried in this order; the first sound result wins:
 *   1. TRANSPOSITION — the complete material moved by whole scale steps
 *      (the shifts the caller offers; 0 over unchanged harmony is a
 *      literal restatement).
 *   2. REINTERPRETATION — the same pitches, valid in a new harmonic
 *      meaning (shift 0 over different harmony).
 *   3. STEPWISE MOVES — the fewest notes moved by one scale step or
 *      inflected by a semitone; protected features may not change.
 *   4. TAIL REWRITE — the head kept exactly, the tail recomposed on its
 *      own rhythm.
 *
 * Protected, in every strategy: the rhythm, the direction of every move in
 * the head, and the size (in scale steps) of the characteristic leap.
 * When no strategy gives a sound line the adaptation is REJECTED, with
 * reasons: material is never forced through harmony that does not take it.
 */
import { chordAt, judgeLine, localScale, pitchClassOf, shiftLine, type LineNote, type NoteFunction, type TonalFrame } from './line';

export type AdaptationStrategy = 'literal' | 'transposition' | 'reinterpretation' | 'stepwise-moves' | 'tail-rewrite';

export interface AdaptRequest {
  readonly frame: TonalFrame;
  /** Notes with ticks relative to the material's start. */
  readonly material: readonly LineNote[];
  /** Notes of the head (protected); equal to the material's length for a fragment. */
  readonly headCount: number;
  /** Index of the note the characteristic leap starts from; -1 when the material has none. */
  readonly leapIndex: number;
  /** Where the material was composed (to recognise unchanged harmony); null when unknown. */
  readonly homeTick: number | null;
  readonly targetTick: number;
  /** Transpositions in scale steps the caller accepts, most wanted first. */
  readonly shifts: readonly number[];
  /** Notes already fixed before and after (absolute ticks): the joins are judged too. */
  readonly before: readonly LineNote[];
  readonly after: readonly LineNote[];
  /** When nothing follows: must the last note be a chord tone? */
  readonly finalStable: boolean;
  /** The caller's preference among sound results: lower is better. Default: the order of `shifts`. */
  readonly rank?: (notes: readonly LineNote[]) => number;
}

export interface Adaptation {
  readonly ok: true;
  /** Absolute ticks. */
  readonly notes: readonly LineNote[];
  readonly functions: readonly NoteFunction[];
  readonly strategy: AdaptationStrategy;
  readonly shift: number;
  readonly moved: readonly { readonly index: number; readonly how: string }[];
  /** Preferred (not protected) features that did not survive. */
  readonly preferredLost: readonly string[];
  /** What was tried before the winning strategy, and why it failed. */
  readonly tried: readonly string[];
}

export interface AdaptationRejected {
  readonly ok: false;
  readonly reasons: readonly string[];
}

const TAIL_MOVES = [-2, -1, 1, 2] as const;
const MAX_MOVED_NOTES = 3;

function sameHarmony(frame: TonalFrame, a: number, b: number, length: number): boolean {
  const view = (from: number): string => frame.harmony.chords
    .filter((c) => c.fact.startTick < from + length && c.fact.endTick > from)
    .map((c) => `${Math.max(0, c.fact.startTick - from)}:${[...c.fact.pitchClasses].sort().join('.')}:${c.fact.bassPc}`)
    .join('|');
  return view(a) === view(b);
}

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, chosen: number[]): void => {
    if (chosen.length === k) { out.push(chosen); return; }
    for (let i = start; i < n; i++) walk(i + 1, [...chosen, i]);
  };
  walk(0, []);
  return out;
}

export function adaptMaterial(request: AdaptRequest): Adaptation | AdaptationRejected {
  const { frame, material, headCount, leapIndex, targetTick } = request;
  const length = material.length ? material[material.length - 1].tick + material[material.length - 1].duration : 0;
  const context = request.before.slice(-3);
  const follow = request.after.slice(0, 1);
  const tried: string[] = [];

  /** Judges candidate notes together with their neighbours; only problems from the join onwards count. */
  const judge = (notes: readonly LineNote[]): { ok: boolean; functions: NoteFunction[]; why: string } => {
    const line = [...context, ...notes, ...follow];
    const judged = judgeLine(frame, line, { finalStable: follow.length > 0 ? true : request.finalStable });
    const from = Math.max(0, context.length - 1);
    const problems = judged.problems.filter((p) => p.index >= from);
    return { ok: problems.length === 0, functions: judged.functions.slice(context.length, context.length + notes.length), why: problems.map((p) => p.text).join('; ') };
  };
  const original = material.map((n, i) => (i === 0 ? 0 : n.step - material[i - 1].step));
  /** Protected features hold: head directions and the size of the leap. */
  const protectedHold = (notes: readonly LineNote[]): boolean => {
    for (let i = 1; i < Math.min(headCount, notes.length); i++) {
      if (Math.sign(notes[i].step - notes[i - 1].step) !== Math.sign(original[i])) return false;
    }
    return leapIndex < 0 || leapIndex + 1 >= notes.length || notes[leapIndex + 1].step - notes[leapIndex].step === original[leapIndex + 1];
  };
  const rankOf = (notes: readonly LineNote[], shiftOrder: number): number => (request.rank ? request.rank(notes) : shiftOrder);
  const baseFunctions = judgeLine(frame, shiftLine(material, request.homeTick ?? targetTick, 0), { finalStable: false }).functions;
  const lost = (notes: readonly LineNote[], functions: readonly NoteFunction[]): string[] => {
    const out: string[] = [];
    const tailTurned = notes.some((n, i) => i >= headCount && Math.sign(n.step - notes[i - 1].step) !== Math.sign(original[i]));
    if (tailTurned) out.push('the direction of a move in the tail');
    if (request.homeTick !== null) {
      baseFunctions.forEach((f, i) => {
        if ((f === 'appoggiatura' || f === 'suspension') && functions[i] === 'chord-tone') out.push(`the dissonance on note ${i + 1} (now a chord tone)`);
      });
    }
    return out;
  };
  const done = (notes: readonly LineNote[], functions: readonly NoteFunction[], strategy: AdaptationStrategy, shift: number, moved: Adaptation['moved']): Adaptation =>
    ({ ok: true, notes, functions, strategy, shift, moved, preferredLost: lost(notes, functions), tried });

  // 1 and 2: the complete material, moved by whole scale steps (or not at all)
  const sound: { notes: LineNote[]; functions: NoteFunction[]; shift: number; rank: number }[] = [];
  request.shifts.forEach((shift, order) => {
    const notes = shiftLine(material, targetTick, shift);
    const judged = judge(notes);
    if (judged.ok) sound.push({ notes, functions: judged.functions, shift, rank: rankOf(notes, order) });
    else tried.push(`${shift === 0 ? 'at pitch' : `transposed ${shift > 0 ? '+' : ''}${shift} steps`}: ${judged.why}`);
  });
  if (sound.length) {
    // transposition is tried before reinterpretation: among sound results a moved one wins a tie
    sound.sort((a, b) => a.rank - b.rank || (a.shift === 0 ? 1 : 0) - (b.shift === 0 ? 1 : 0));
    const best = sound[0];
    const literal = best.shift === 0 && request.homeTick !== null && sameHarmony(frame, request.homeTick, targetTick, length);
    return done(best.notes, best.functions, best.shift !== 0 ? 'transposition' : literal ? 'literal' : 'reinterpretation', best.shift, []);
  }

  // 3: the fewest notes moved by one step, or inflected by a semitone
  for (let count = 1; count <= Math.min(MAX_MOVED_NOTES, material.length); count++) {
    const found: { notes: LineNote[]; functions: NoteFunction[]; shift: number; rank: number; moved: Adaptation['moved'] }[] = [];
    request.shifts.forEach((shift, order) => {
      const base = shiftLine(material, targetTick, shift);
      const optionsOf = (note: LineNote): { note: LineNote; how: string }[] => {
        const options = [
          { note: { ...note, step: note.step - 1, alter: 0 }, how: 'down a step' },
          { note: { ...note, step: note.step + 1, alter: 0 }, how: 'up a step' },
        ];
        const chord = chordAt(frame, note.tick);
        for (const alter of [-1, 1]) {
          const inflected = { ...note, alter: note.alter + alter };
          if (chord && inflected.alter >= -1 && inflected.alter <= 1 && localScale(frame, chord).has(pitchClassOf(frame, inflected)) && chord.fact.pitchClasses.includes(pitchClassOf(frame, inflected))) {
            options.push({ note: inflected, how: alter < 0 ? 'lowered a semitone into the chord' : 'raised a semitone into the chord' });
          }
        }
        return options;
      };
      for (const indexes of combinations(base.length, count)) {
        const walk = (k: number, notes: LineNote[], moved: { index: number; how: string }[]): void => {
          if (k === indexes.length) {
            if (!protectedHold(notes)) return;
            const judged = judge(notes);
            if (judged.ok) found.push({ notes, functions: judged.functions, shift, rank: rankOf(notes, order), moved });
            return;
          }
          const index = indexes[k];
          for (const option of optionsOf(base[index])) {
            walk(k + 1, notes.map((n, i) => (i === index ? option.note : n)), [...moved, { index, how: option.how }]);
          }
        };
        walk(0, base, []);
      }
    });
    if (found.length) {
      // fewest notes first (this loop), then the caller's preference, then inflections before steps, then later notes before earlier ones
      const cost = (f: (typeof found)[number]): number => f.moved.reduce((sum, m) => sum + (m.how.includes('semitone') ? 0 : 1) + (m.index < headCount ? 2 : 0), 0);
      found.sort((a, b) => a.rank - b.rank || cost(a) - cost(b) || b.moved[0].index - a.moved[0].index);
      const best = found[0];
      return done(best.notes, best.functions, 'stepwise-moves', best.shift, best.moved);
    }
  }
  tried.push(`no ${MAX_MOVED_NOTES} or fewer unprotected moves give a sound line`);

  // 4: the head kept, the tail recomposed on its own rhythm
  const tailCount = material.length - headCount;
  if (tailCount > 0) {
    let best: { notes: LineNote[]; functions: NoteFunction[]; shift: number; score: number } | null = null;
    request.shifts.forEach((shift, order) => {
      const base = shiftLine(material, targetTick, shift);
      const head = base.slice(0, headCount);
      let tails: number[][] = [[]];
      for (let i = 0; i < tailCount; i++) tails = tails.flatMap((t) => TAIL_MOVES.map((m) => [...t, m]));
      for (const moves of tails) {
        let step = head[head.length - 1].step;
        const notes = [...head, ...base.slice(headCount).map((n, i) => ({ ...n, step: (step += moves[i]), alter: 0 }))];
        const judged = judge(notes);
        if (!judged.ok) continue;
        // closest to the original tail: same directions, least total displacement
        const agree = moves.filter((m, i) => Math.sign(m) === Math.sign(original[headCount + i])).length;
        const displacement = notes.reduce((sum, n, i) => sum + Math.abs(n.step - base[i].step), 0);
        const score = rankOf(notes, order) * 100 - agree * 3 + displacement;
        if (!best || score < best.score) best = { notes, functions: judged.functions, shift, score };
      }
    });
    if (best) {
      const b = best as { notes: LineNote[]; functions: NoteFunction[]; shift: number };
      return done(b.notes, b.functions, 'tail-rewrite', b.shift, b.notes.map((_, index) => ({ index, how: 'tail recomposed' })).slice(headCount));
    }
    tried.push('no recomposed tail gives a sound line after the protected head');
  }
  return { ok: false, reasons: tried };
}
