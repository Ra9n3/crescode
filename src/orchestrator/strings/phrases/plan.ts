/**
 * Phrase planning (Strings V1, Stage 2) — the smallest planner that gives
 * one voice a phrase with a beginning, a direction, a high point and an
 * ending. Not yet a general planner: one theme, one voice.
 *
 * A phrase lives in a WINDOW (a stretch of bars the voice may sound in).
 * Its length follows the window and the harmony; nothing here asks for
 * four or eight bars. Inside the window the planner looks for a GOAL — the
 * strongest harmonic arrival near the window's end, read from the
 * structural proposal as evidence — and builds toward it:
 *
 *   statement     the theme, adapted to the harmony where it stands
 *   restatement   the theme again over the next harmony (only when the
 *                 window leaves room for it and for a development)
 *   development   the theme's head alone, restated higher bar by bar: the
 *                 last statement carries the phrase's high point
 *   approach      stepwise motion, only where a gap remains before the goal
 *   ending        one held note on the goal chord: the tonic when the goal
 *                 is a tonic chord (closed), else an open chord tone
 *
 * All positions are ticks; the goal may fall inside a bar. Every joined
 * line is judged by the line rules, and a window whose material cannot be
 * adapted soundly is left silent, with the reason.
 */
import type { StructuralProposal } from '../understanding/structure';
import { adaptMaterial, type Adaptation } from '../material/adapt';
import { chordAt, judgeLine, pitchClassOf, type LineNote, type NoteFunction, type TonalFrame } from '../material/line';
import { THEME_BARS, type Theme } from '../material/theme';

export type SegmentKind = 'statement' | 'restatement' | 'development' | 'approach' | 'ending';

export interface PhraseNote extends LineNote {
  readonly function: NoteFunction;
  readonly segment: SegmentKind;
  /** 0..1 — where the note stands on the phrase's way to its high point and back. */
  readonly intensity: number;
  /** A bow change and a breath follow this note. */
  readonly breathAfter: boolean;
}

export interface PhraseSegment {
  readonly kind: SegmentKind;
  readonly startTick: number;
  readonly endTick: number;
  readonly noteCount: number;
  /** How the material was fitted; null for approach and ending notes (composed, not adapted). */
  readonly adaptation: Pick<Adaptation, 'strategy' | 'shift' | 'moved' | 'preferredLost' | 'tried'> | null;
  readonly description: string;
}

export interface PhrasePlan {
  readonly index: number;
  readonly window: { readonly startTick: number; readonly endTick: number };
  /** Stated above the theme's home position because the stretch is more energetic. */
  readonly lifted: boolean;
  /** First note's start and last note's end. */
  readonly startTick: number;
  readonly endTick: number;
  readonly goal: { readonly tick: number; readonly chord: string; readonly evidence: string; readonly ending: 'closed' | 'open' };
  readonly climax: { readonly tick: number; readonly step: number };
  readonly segments: readonly PhraseSegment[];
  readonly notes: readonly PhraseNote[];
  readonly landmarks: readonly { readonly tick: number; readonly label: string }[];
  /** Silence left between the last note and the window's end. */
  readonly breathTicks: number;
}

export interface PhrasePlanningResult {
  readonly phrases: readonly PhrasePlan[];
  readonly silentWindows: readonly { readonly startTick: number; readonly endTick: number; readonly reason: string }[];
}

export interface PhraseInput {
  readonly frame: TonalFrame;
  readonly theme: Theme;
  readonly structure: StructuralProposal;
  /** Bar-aligned stretches the voice may sound in, in order. */
  /** `energy` (0..1) is the stretch's mean place in the song's energy arc, when known. */
  readonly windows: readonly { readonly startTick: number; readonly endTick: number; readonly energy?: number }[];
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;
const SEQUENCE_SHIFTS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7];
/** How much more energetic than the first window a stretch must be for its phrase to be stated higher. */
const LIFT_MARGIN = 0.1;
/** How many continuations survive each development bar. */
const DEVELOPMENT_PATHS_KEPT = 4;
/** The widest a phrase may spread, in scale steps (an octave and a fourth). */
const MAX_PHRASE_SPAN = 10;

/** Transpositions offered for a whole theme: with the harmony's root first, then at pitch, then the nearest others. */
function themeShifts(withRoot: number, upward: boolean): number[] {
  // Upward: the nearest transpositions above first, then below. Used for a phrase in a more
  // energetic stretch than the theme's home, and for a restatement (a line that says its theme
  // again goes on from where it was, it does not start again lower).
  return [...new Set(upward ? [withRoot, 0, 1, 2, 3, 4, -1, -2, -3] : [withRoot, 0, 1, -1, 2, -2, 3, -3])];
}

function describe(a: Adaptation): string {
  const where = a.shift === 0 ? 'at pitch' : `${a.shift > 0 ? 'up' : 'down'} ${Math.abs(a.shift)} scale step${Math.abs(a.shift) === 1 ? '' : 's'}`;
  const how = a.strategy === 'literal' ? 'as composed'
    : a.strategy === 'transposition' ? `transposed ${where}`
      : a.strategy === 'reinterpretation' ? 'the same notes, reinterpreted by the new harmony'
        : a.strategy === 'stepwise-moves' ? `${where}, ${a.moved.length} note${a.moved.length === 1 ? '' : 's'} moved`
          : `${where}, head kept, tail recomposed`;
  return how;
}

/** The scale steps between two pitch classes' roots, folded to −3..+3. */
function rootShift(frame: TonalFrame, fromTick: number, toTick: number): number {
  const degreeOf = (tick: number): number | null => chordAt(frame, tick)?.reading.rootDegree ?? null;
  const from = degreeOf(fromTick);
  const to = degreeOf(toTick);
  if (from === null || to === null) return 0;
  const up = mod(to - from, 7);
  return up > 3 ? up - 7 : up;
}

/** Fills [fromTick, toTick) with notes on the beat that walk from `previous` to just above `target`. Null when no sound walk exists. */
function approach(frame: TonalFrame, fromTick: number, toTick: number, before: readonly LineNote[], target: LineNote): LineNote[] | null {
  const slots: { tick: number; duration: number }[] = [];
  for (let tick = fromTick; tick < toTick; tick += frame.beatTicks) slots.push({ tick, duration: Math.min(frame.beatTicks, toTick - tick) });
  if (slots.length === 0) return [];
  if (slots.length > 6) return null;
  const previous = before[before.length - 1];
  let best: { notes: LineNote[]; cost: number } | null = null;
  const walk = (i: number, notes: LineNote[]): void => {
    if (i === slots.length) {
      const judged = judgeLine(frame, [...before.slice(-3), ...notes, target], { finalStable: true });
      if (judged.problems.some((p) => p.index >= Math.max(0, Math.min(3, before.length) - 1))) return;
      const last = notes[notes.length - 1];
      const arrival = last.step - target.step;
      const cost = (arrival === 1 ? 0 : arrival === -1 ? 2 : 6)
        + notes.filter((n, k) => k > 0 && Math.sign(n.step - notes[k - 1].step) !== Math.sign(target.step - previous.step || -1)).length;
      if (!best || cost < best.cost) best = { notes, cost };
      return;
    }
    const from = i === 0 ? previous.step : notes[i - 1].step;
    for (const move of [-1, 1, -2, 2]) walk(i + 1, [...notes, { ...slots[i], step: from + move, alter: 0 }]);
  };
  walk(0, []);
  return best ? (best as { notes: LineNote[] }).notes : null;
}

export function planPhrases(input: PhraseInput): PhrasePlanningResult {
  const { frame, theme, structure } = input;
  const bar = frame.barTicks;
  const themeTicks = THEME_BARS * bar;
  const head = theme.notes.slice(0, theme.headCount);
  const phrases: PhrasePlan[] = [];
  const silentWindows: { startTick: number; endTick: number; reason: string }[] = [];

  for (const window of input.windows) {
    const silent = (reason: string): void => { silentWindows.push({ startTick: window.startTick, endTick: window.endTick, reason }); };
    const lifted = (window.energy ?? 0) > (input.windows[0]?.energy ?? 0) + LIFT_MARGIN;
    if (window.endTick - window.startTick < themeTicks) { silent('the window is shorter than the theme'); continue; }

    // the statement: the theme where the phrase begins
    const statement = adaptMaterial({
      frame, material: theme.notes, headCount: theme.headCount, leapIndex: theme.identity.leap.fromIndex, homeTick: theme.home.startTick,
      targetTick: window.startTick, shifts: themeShifts(rootShift(frame, theme.home.startTick, window.startTick), lifted), before: [], after: [], finalStable: true,
    });
    if (!statement.ok) { silent(`the theme cannot be stated here: ${statement.reasons.join(' | ')}`); continue; }

    const segments: PhraseSegment[] = [];
    const line: { note: LineNote; function: NoteFunction; segment: SegmentKind; breathAfter: boolean }[] = [];
    const push = (kind: SegmentKind, notes: readonly LineNote[], functions: readonly NoteFunction[], adaptation: Adaptation | null, description: string, breath: boolean): void => {
      if (notes.length === 0) return;
      segments.push({
        kind, startTick: notes[0].tick, endTick: notes[notes.length - 1].tick + notes[notes.length - 1].duration, noteCount: notes.length,
        adaptation: adaptation ? { strategy: adaptation.strategy, shift: adaptation.shift, moved: adaptation.moved, preferredLost: adaptation.preferredLost, tried: adaptation.tried } : null,
        description,
      });
      notes.forEach((note, i) => line.push({ note, function: functions[i], segment: kind, breathAfter: breath && i === notes.length - 1 }));
    };
    const fixed = (): LineNote[] => line.map((l) => l.note);
    push('statement', statement.notes, statement.functions, statement, `the theme: ${describe(statement)}`, true);

    // the goal: the strongest arrival in the window's last two bars, after the statement
    const afterStatement = window.startTick + themeTicks;
    const arrivals = structure.arrivals.filter((a) => a.tick >= afterStatement && a.tick < window.endTick && a.tick >= window.endTick - 2 * bar);
    const arrival = arrivals.reduce<(typeof arrivals)[number] | null>((best, a) => (!best || a.strength >= best.strength ? a : best), null);
    const lastChord = [...frame.harmony.chords].reverse().find((c) => c.fact.startTick >= afterStatement && c.fact.startTick < window.endTick);
    const goalTick = arrival?.tick ?? lastChord?.fact.startTick ?? null;

    let climax = { tick: 0, step: -Infinity };
    let goalInfo: PhrasePlan['goal'];
    let failed: string | null = null;
    if (goalTick === null) {
      // the window holds the theme and nothing else: the theme's own last note ends the phrase
      const last = statement.notes[statement.notes.length - 1];
      const chord = chordAt(frame, last.tick)!;
      goalInfo = { tick: last.tick, chord: chord.fact.symbol, evidence: 'no harmony after the theme in this window: the theme\'s own last note', ending: chord.reading.isTonicRoot && mod(last.step, 7) === 0 ? 'closed' : 'open' };
    } else {
      const goalChord = chordAt(frame, goalTick)!;
      const closed = goalChord.reading.isTonicRoot;
      // the ending note: the tonic for a closed ending; else the key's fifth or second degree where the chord holds it, else the chord's fifth
      const chordDegrees = [0, 1, 2, 3, 4, 5, 6].filter((d) => goalChord.fact.pitchClasses.includes(pitchClassOf(frame, { step: d, alter: 0 })));
      const fifthOfChord = chordDegrees.find((d) => pitchClassOf(frame, { step: d, alter: 0 }) === (goalChord.fact.rootPc + 7) % 12);
      const degree = closed ? 0 : chordDegrees.includes(4) ? 4 : chordDegrees.includes(1) ? 1 : fifthOfChord ?? chordDegrees[0];
      if (degree === undefined) failed = `no scale note belongs to the goal chord ${goalChord.fact.symbol}`;
      const goalPc = pitchClassOf(frame, { step: degree ?? 0, alter: 0 });
      // held until a beat before the window closes, at most a bar, and not into a chord it does not belong to
      const breathBefore = window.endTick - frame.beatTicks;
      let goalEnd = Math.min(goalTick + bar, Math.max(breathBefore, goalTick + frame.beatTicks));
      for (const c of frame.harmony.chords) {
        if (c.fact.startTick > goalTick && c.fact.startTick < goalEnd && !c.fact.pitchClasses.includes(goalPc)) goalEnd = c.fact.startTick;
      }
      const goalAt = (step: number): LineNote => ({ tick: goalTick, duration: goalEnd - goalTick, step, alter: 0 });
      /** The octaves the ending may take: decided with the line that reaches it, not before. */
      const goalSteps = (): number[] => {
        const steps = fixed().map((n) => n.step);
        const top = Math.max(...steps);
        const low = Math.min(...steps);
        return [-14, -7, 0, 7, 14].map((o) => (degree ?? 0) + o).filter((g) => g >= top - MAX_PHRASE_SPAN && g <= low + MAX_PHRASE_SPAN);
      };
      /** How well a last note leads into an ending note: a step down is the strongest close, then a step up, then a third. */
      const arrivalCost = (lastStep: number, goalStep: number): number => {
        const move = lastStep - goalStep;
        return move === 1 ? 0 : move === -1 ? 3 : Math.abs(move) === 2 ? 5 : move === 0 ? 8 : 8 + Math.abs(move) * 2;
      };
      goalInfo = {
        tick: goalTick, chord: goalChord.fact.symbol, ending: closed ? 'closed' : 'open',
        evidence: arrival ? `${arrival.kind} arrival (strength ${arrival.strength}): ${arrival.rule}` : 'the last chord of the window (no arrival is read here)',
      };

      // room between the statement and the goal's bar
      const goalBarStart = Math.floor(goalTick / bar) * bar;
      const between = Math.max(0, Math.round((goalBarStart - afterStatement) / bar));
      let cursor = afterStatement;
      if (!failed && between >= THEME_BARS + 1) {
        const again = adaptMaterial({
          frame, material: theme.notes, headCount: theme.headCount, leapIndex: theme.identity.leap.fromIndex, homeTick: theme.home.startTick,
          targetTick: cursor, shifts: themeShifts(Math.max(0, rootShift(frame, theme.home.startTick, cursor)), true), before: fixed(), after: [], finalStable: true,
        });
        if (again.ok) {
          push('restatement', again.notes, again.functions, again, `the theme again over the next harmony: ${describe(again)}`, true);
          cursor += themeTicks;
        }
        // a rejected restatement is not forced: the development takes its bars
      }
      // development: the head alone, each statement higher than the last; the final one leads into the ending.
      // The bars are chosen together (a few best continuations are kept per bar), so that no bar
      // paints the next one into a corner.
      const developmentBars = Math.round((goalBarStart - cursor) / bar);
      let goalStep: number | null = null;
      interface Piece { kind: 'development' | 'approach'; notes: readonly LineNote[]; functions: readonly NoteFunction[]; adaptation: Adaptation | null; description: string }
      interface Path { pieces: Piece[]; rank: number; goal: number | null }
      let paths: Path[] = [{ pieces: [], rank: 0, goal: null }];
      const committed = fixed();
      for (let i = 0; i < developmentBars && paths.length; i++) {
        const isLast = i === developmentBars - 1 && goalTick === goalBarStart;
        const tick = cursor + i * bar;
        const next: Path[] = [];
        for (const path of paths) {
          const soFar = [...committed, ...path.pieces.flatMap((piece) => piece.notes)];
          const steps = soFar.map((n) => n.step);
          const top = Math.max(...steps);
          const low = Math.min(...steps);
          const previous = soFar[soFar.length - 1];
          const goals: (number | null)[] = isLast
            ? [-14, -7, 0, 7, 14].map((o) => (degree ?? 0) + o).filter((g) => g >= top - MAX_PHRASE_SPAN && g <= low + MAX_PHRASE_SPAN)
            : [null];
          const rankOf = (notes: readonly LineNote[], goal: number | null): number => {
            const fragmentTop = Math.max(...notes.map((n) => n.step));
            return (fragmentTop > top ? 0 : 20) // each statement reaches higher
              + (fragmentTop - low > MAX_PHRASE_SPAN ? 40 : 0) // inside the phrase's span
              + Math.max(0, fragmentTop - top - 3) * 2 // climbing, not jumping
              + Math.max(0, Math.abs(notes[0].step - previous.step) - 2) * 3 // joined to what came before
              + (goal === null ? 0 : arrivalCost(notes[notes.length - 1].step, goal) + (goal >= fragmentTop ? 6 : 0)); // the ending is a release, not the high point
          };
          let any = false;
          for (const goal of goals) {
            for (const shift of SEQUENCE_SHIFTS) {
              const result = adaptMaterial({
                frame, material: head, headCount: head.length, leapIndex: theme.identity.leap.fromIndex < head.length - 1 ? theme.identity.leap.fromIndex : -1, homeTick: theme.home.startTick,
                targetTick: tick, shifts: [shift], before: soFar, after: goal === null ? [] : [goalAt(goal)], finalStable: false,
              });
              if (!result.ok) continue;
              any = true;
              next.push({
                pieces: [...path.pieces, { kind: 'development', notes: result.notes, functions: result.functions, adaptation: result, description: `the head alone: ${describe(result)}` }],
                rank: path.rank + rankOf(result.notes, goal) + result.moved.length * 4, // a moved note costs more than a plain transposition
                goal,
              });
            }
          }
          if (!any) {
            // the head does not fit this bar on this path: plain stepwise motion instead
            for (const goal of goals) {
              const walked = approach(frame, tick, tick + bar, soFar, goal === null ? { tick: tick + bar, duration: frame.beatTicks, step: previous.step, alter: 0 } : goalAt(goal));
              if (!walked || walked.length === 0) continue;
              const functions = judgeLine(frame, [...soFar.slice(-1), ...walked], { finalStable: false }).functions.slice(1);
              next.push({
                pieces: [...path.pieces, { kind: 'approach', notes: walked, functions, adaptation: null, description: 'stepwise motion (the head does not fit this harmony)' }],
                rank: path.rank + 30 + (goal === null ? 0 : arrivalCost(walked[walked.length - 1].step, goal)),
                goal,
              });
            }
          }
        }
        paths = next.map((path, order) => ({ path, order })).sort((x, y) => x.path.rank - y.path.rank || x.order - y.order).slice(0, DEVELOPMENT_PATHS_KEPT).map((x) => x.path);
      }
      if (developmentBars > 0) {
        if (paths.length === 0) failed = `no development reaches the goal at tick ${goalTick} from the statement`;
        else {
          for (const piece of paths[0].pieces) push(piece.kind, piece.notes, piece.functions, piece.adaptation, piece.description, false);
          goalStep = paths[0].goal;
          cursor += developmentBars * bar;
        }
      }
      // a goal inside its bar: walk the remaining beats
      if (!failed && cursor < goalTick) {
        let walked: LineNote[] | null = null;
        const last = fixed()[fixed().length - 1];
        for (const g of goalSteps().sort((x, y) => Math.abs(x - last.step) - Math.abs(y - last.step))) {
          walked = approach(frame, cursor, goalTick, fixed(), goalAt(g));
          if (walked) { goalStep = g; break; }
        }
        if (!walked) failed = `no stepwise approach reaches the goal at tick ${goalTick}`;
        else push('approach', walked, judgeLine(frame, [...fixed().slice(-1), ...walked, goalAt(goalStep!)], { finalStable: true }).functions.slice(1, 1 + walked.length), null, 'stepwise approach to a goal inside the bar', false);
      }
      if (!failed) {
        if (goalStep === null) {
          // nothing leads into the ending: the octave nearest the last note
          const last = fixed()[fixed().length - 1];
          goalStep = goalSteps().sort((x, y) => Math.abs(x - last.step) - Math.abs(y - last.step) || x - y)[0] ?? (degree ?? 0);
        }
        // material that runs straight into the ending keeps no breath before it
        const lastLine = line[line.length - 1];
        const lastKind = segments[segments.length - 1].kind;
        if (lastLine.note.tick + lastLine.note.duration === goalTick && lastKind !== 'statement' && lastKind !== 'restatement') {
          line[line.length - 1] = { ...lastLine, breathAfter: false };
        }
        push('ending', [goalAt(goalStep)], ['chord-tone'], null, closed ? 'the tonic, held: a closed ending' : `an open ending on scale degree ${mod(goalStep, 7) + 1}, held`, true);
      }
    }
    if (failed) { silent(failed); continue; }

    // the whole phrase, judged once more as one line
    const whole = judgeLine(frame, fixed(), { finalStable: true });
    if (!whole.ok) { silent(`the joined phrase is not sound: ${whole.problems.map((p) => `note ${p.index} ${p.text}`).join('; ')}`); continue; }

    const notes = fixed();
    notes.forEach((n) => { if (n.step > climax.step) climax = { tick: n.tick, step: n.step }; });
    const startTick = notes[0].tick;
    const endTick = notes[notes.length - 1].tick + notes[notes.length - 1].duration;
    // intensity: up to the high point, down to the end
    const intensityAt = (tick: number): number => (tick <= climax.tick
      ? 0.4 + 0.6 * (climax.tick === startTick ? 1 : (tick - startTick) / (climax.tick - startTick))
      : 1 - 0.7 * ((tick - climax.tick) / Math.max(1, notes[notes.length - 1].tick - climax.tick)));
    const landmarks = [
      { tick: startTick, label: 'phrase begins: the theme' },
      ...segments.slice(1).map((s) => ({ tick: s.startTick, label: `${s.kind}: ${s.description}` })),
      { tick: climax.tick, label: 'high point' },
      { tick: endTick, label: 'phrase ends' },
    ].sort((a, b) => a.tick - b.tick);
    phrases.push({
      index: phrases.length,
      window: { startTick: window.startTick, endTick: window.endTick },
      lifted,
      startTick,
      endTick,
      goal: goalInfo!,
      climax,
      segments,
      notes: line.map((l) => ({ ...l.note, function: whole.functions[line.indexOf(l)] ?? l.function, segment: l.segment, intensity: Math.round(intensityAt(l.note.tick) * 1000) / 1000, breathAfter: l.breathAfter })),
      landmarks,
      breathTicks: window.endTick - endTick,
    });
  }
  return { phrases, silentWindows };
}
