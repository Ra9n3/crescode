/**
 * The Viola's notes (Strings V1, Stage 4) — composed apart from the violins,
 * against them as they stand.
 *
 * For every stretch the plan gave a role, the writer builds its own
 * candidates, turns down every one that is not sound as a line or not sound
 * against EITHER violin (the two-voice rules of Stage 3, applied to each
 * pair), and keeps the one its character prefers. Each stretch has three
 * alternatives — preferred, plainer, silent — and the review may ask for a
 * lower one. Nothing here changes a violin note.
 *
 *   inner-line  a bowed line. The rhythm is chosen bar by bar from the
 *               Viola's own cells and from the theme's rhythms, by where the
 *               violins attack and hold; the pitches are searched under the
 *               violins with the Viola's own way of moving.
 *   arrival     the last note of such a line: a chord tone reached together
 *               with the first voice's goal, held.
 *   pulse       a plucked broken chord. Grounded on the chord's bass when no
 *               lower string sounds, otherwise on the off-beats.
 *   reply       the theme's closing gesture in the foreground, where the
 *               second voice left an open ending unanswered.
 */
import type { Articulation, Note } from '../../../shared/schema/types';
import { VIOLA, VIOLA_LINE_CELLS, VIOLA_PLAIN_CELL_IDS, VIOLA_PULSE_CELLS, violaLineMove, violaPulseMove, type RhythmCell, type ViolaRole } from '../characters/viola';
import { judgeTogether, soundingPitch, type SoundingNote } from '../ensemble/counterpoint';
import type { ThirdPlan, ThirdSpan } from '../ensemble/third-plan';
import { chordAt, judgeLine, localScale, pitchClassOf, type LineNote, type NoteFunction, type TonalFrame } from '../material/line';
import type { Theme } from '../material/theme';
import { VOICE_VELOCITY } from './voice';

export type ViolaLevel = 0 | 1 | 2;
export const VIOLA_LEVEL_NAMES = ['preferred', 'plainer', 'silent'] as const;

export interface ViolaNote extends SoundingNote {
  readonly span: number;
  readonly role: ViolaRole;
  /** A rest follows: the bow lifts (or, plucked, the note simply rings out). */
  readonly breathAfter: boolean;
  /** The rhythm cell the note belongs to; null for an arrival or a reply. */
  readonly cell: string | null;
}

export interface ViolaSpanWriting {
  readonly span: number;
  readonly role: ViolaRole;
  readonly level: typeof VIOLA_LEVEL_NAMES[number];
  readonly played: boolean;
  /** Why the Viola entered, or why it stayed silent. */
  readonly decision: string;
  /** What it plays, in words; null when silent. */
  readonly material: string | null;
  /** The rhythm chosen for each bar of the stretch. */
  readonly rhythm: readonly string[];
  readonly notes: readonly ViolaNote[];
  /** Complete candidates examined, and how many were sound alone and against both violins. */
  readonly considered: number;
  readonly sound: number;
  readonly rejections: Readonly<Record<string, number>>;
  /** What counted for and against the chosen candidate (lower is better); null when silent. */
  readonly weighed: Readonly<Record<string, number>> | null;
}

export interface ViolaInput {
  readonly frame: TonalFrame;
  readonly theme: Theme;
  readonly plan: ThirdPlan;
  readonly first: readonly SoundingNote[];
  readonly second: readonly SoundingNote[];
  readonly range: readonly [number, number];
  readonly singing: readonly [number, number];
  /** Per stretch of the plan: which alternative to write. */
  readonly levels: readonly ViolaLevel[];
  /** The first voice's place in its phrase (0..1) at a tick. */
  readonly intensityAt: (tick: number) => number;
  readonly lowerStringsSoundIn: (from: number, to: number) => boolean;
  /** Highest pitch of the lower strings sounding between two ticks; null when none. The Viola does not go under it. */
  readonly lowerStringsTopIn: (from: number, to: number) => number | null;
}

export interface ViolaResult {
  readonly notes: readonly ViolaNote[];
  readonly spans: readonly ViolaSpanWriting[];
}

/** How many rhythm sequences are carried from bar to bar, and how many pitch paths from note to note. */
const RHYTHMS_KEPT = 6;
const PATHS_KEPT = 28;
/** How many complete candidates of one rhythm are checked in full before the rhythm is given up. */
const CANDIDATES_CHECKED = 28;

const mod = (n: number, m: number): number => ((n % m) + m) % m;
const round = (n: number): number => Math.round(n * 1000) / 1000;

interface Slot {
  readonly tick: number;
  readonly duration: number;
  readonly span: number;
  readonly role: ViolaRole;
  readonly cell: string | null;
  readonly bar: number;
  /** First note of its bar's figure. */
  readonly firstOfBar: boolean;
  /** Plucked, and the bar is grounded: this note is the chord's bass. */
  readonly grounded: boolean;
  /** The theme's interval from the note before, when the cell is taken from the theme. */
  readonly themeMove: number | null;
  readonly breathAfter: boolean;
}

interface Path {
  readonly notes: readonly { readonly step: number; readonly alter: number }[];
  readonly cost: number;
  readonly parts: Readonly<Record<string, number>>;
}

interface Chosen {
  readonly slots: readonly Slot[];
  readonly notes: readonly ViolaNote[];
  readonly total: number;
  readonly parts: Readonly<Record<string, number>>;
  readonly rhythm: readonly string[];
}

export function composeViola(input: ViolaInput): ViolaResult {
  const { frame, theme, plan, first, second } = input;
  const beat = frame.beatTicks;
  const bar = frame.barTicks;
  const pitch = (n: Pick<LineNote, 'step' | 'alter'>): number => soundingPitch(frame, n);
  const violins = [first, second];
  const soundingAt = (line: readonly SoundingNote[], tick: number): SoundingNote | undefined => line.find((n) => n.tick <= tick && tick < n.tick + n.duration);
  const onsetAt = (line: readonly SoundingNote[], tick: number): boolean => line.some((n) => n.tick === tick);
  const lowestViolin = (from: number, to: number): number | null => {
    const inside = violins.flatMap((line) => line.filter((n) => n.tick < to && n.tick + n.duration > from)).map(pitch);
    return inside.length ? Math.min(...inside) : null;
  };
  const barName = (tick: number): string => {
    const b = Math.floor(tick / bar) + 1;
    const inBar = (tick % bar) / beat + 1;
    return inBar === 1 ? `bar ${b}` : `bar ${b} beat ${Math.round(inBar * 100) / 100}`;
  };

  /** Every note of the local scale between two pitches, as line notes. */
  const pitchesAt = (tick: number, low: number, high: number): { step: number; alter: number; pitch: number; pc: number; chordTone: boolean }[] => {
    const chord = chordAt(frame, tick);
    if (!chord) return [];
    const scale = localScale(frame, chord);
    const out = new Map<number, { step: number; alter: number; pitch: number; pc: number; chordTone: boolean }>();
    for (let step = -28; step <= 28; step++) {
      const plainPc = pitchClassOf(frame, { step, alter: 0 });
      for (const alter of scale.has(plainPc) ? [0] : [-1, 1]) {
        const pc = pitchClassOf(frame, { step, alter });
        if (!scale.has(pc)) continue;
        const p = pitch({ step, alter });
        if (p < low || p > high || out.has(p)) continue;
        out.set(p, { step, alter, pitch: p, pc, chordTone: chord.fact.pitchClasses.includes(pc) });
      }
    }
    return [...out.values()].sort((x, y) => x.pitch - y.pitch);
  };

  /* ------------------------------------------------------------------ */
  /* judging                                                             */
  /* ------------------------------------------------------------------ */

  const lineNotes = (slots: readonly Slot[], notes: Path['notes']): LineNote[] => notes.map((n, i) => ({ tick: slots[i].tick, duration: slots[i].duration, step: n.step, alter: n.alter }));

  /** A partial path is dropped as soon as something that later notes cannot repair is wrong with it. */
  const hopeless = (slots: readonly Slot[], notes: Path['notes'], window: readonly (readonly SoundingNote[])[]): boolean => {
    const line = lineNotes(slots, notes);
    const last = line.length - 1;
    const judged = judgeLine(frame, line, { finalStable: false });
    if (judged.problems.some((p) => p.index < last || /leap|outside the scale/.test(p.text))) return true;
    const sounding: SoundingNote[] = line.map((n, i) => ({ ...n, function: judged.functions[i] }));
    for (const violin of window) {
      const together = judgeTogether(frame, sounding, violin, { side: 'below' });
      if (together.conflicts.some((c) => c.tick < line[last].tick || c.kind === 'crossing' || c.kind === 'clash')) return true;
    }
    return false;
  };

  /** The full judgement of a complete candidate: every gesture sound alone, the whole sound against each violin. */
  const judgeComplete = (slots: readonly Slot[], notes: Path['notes'], window: readonly (readonly SoundingNote[])[], plucked: boolean): { functions: NoteFunction[] } | { reason: string } => {
    const line = lineNotes(slots, notes);
    const functions: NoteFunction[] = [];
    let from = 0;
    for (let i = 0; i < line.length; i++) {
      const closes = i === line.length - 1 || (!plucked && slots[i].breathAfter);
      if (!closes) continue;
      const judged = judgeLine(frame, line.slice(from, i + 1), { finalStable: true });
      if (!judged.ok) return { reason: `its own line is not sound (${judged.problems[0].text.replace(/ over .*$| of \d+ semitones$/, '')})` };
      functions.push(...judged.functions);
      from = i + 1;
    }
    const sounding: SoundingNote[] = line.map((n, i) => ({ ...n, function: functions[i] }));
    for (let v = 0; v < window.length; v++) {
      const together = judgeTogether(frame, sounding, window[v], { side: 'below' });
      if (!together.ok) return { reason: `with the ${v === 0 ? 'first' : 'second'} voice: ${together.conflicts[0].kind}` };
    }
    return { functions };
  };

  /* ------------------------------------------------------------------ */
  /* pitches                                                             */
  /* ------------------------------------------------------------------ */

  const searchPitches = (slots: readonly Slot[], plucked: boolean, rejections: Record<string, number>, counts: { considered: number; sound: number }): { path: Path; functions: NoteFunction[] } | null => {
    if (slots.length === 0) return null;
    const from = slots[0].tick;
    const to = slots[slots.length - 1].tick + slots[slots.length - 1].duration;
    const window = violins.map((line) => line.filter((n) => n.tick < to && n.tick + n.duration > from));
    let paths: Path[] = [{ notes: [], cost: 0, parts: {} }];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const chord = chordAt(frame, slot.tick);
      if (!chord) return null;
      const lowest = lowestViolin(slot.tick, slot.tick + slot.duration);
      const cap = slot.role === 'reply' ? input.singing[1] : plucked ? VIOLA.pulseCeiling : VIOLA.foregroundAbove;
      const high = Math.min(input.range[1], cap, lowest === null ? cap : lowest - VIOLA.clearance);
      const under = input.lowerStringsTopIn(slot.tick, slot.tick + slot.duration);
      const options = pitchesAt(slot.tick, Math.max(input.range[0], under ?? input.range[0]), high).filter((o) => (!plucked && slot.role !== 'arrival') || o.chordTone)
        .filter((o) => !slot.grounded || o.pc === mod(chord.fact.bassPc, 12));
      const soundingPcs = new Set(violins.map((line) => soundingAt(line, slot.tick)).filter((n): n is SoundingNote => !!n).map((n) => mod(pitch(n), 12)));
      const next: Path[] = [];
      for (const path of paths) {
        const prev = path.notes[i - 1];
        const before = path.notes[i - 2];
        const prevSlot = slots[i - 1];
        for (const option of options) {
          const parts: Record<string, number> = { ...path.parts };
          const add = (name: string, value: number): void => { if (value !== 0) parts[name] = (parts[name] ?? 0) + value; };
          if (prev) {
            const steps = option.step - prev.step;
            const semis = Math.abs(option.pitch - pitch(prev));
            if (semis === 6 || semis === 10 || semis === 11 || semis > 12) continue;
            const newFigure = plucked && slot.firstOfBar;
            const move = plucked ? (newFigure ? (Math.abs(steps) <= 7 ? 0 : null) : violaPulseMove(steps)) : violaLineMove(steps);
            if (move === null) continue;
            // under one bow a note is not said twice running (two overlapping notes of one pitch do not survive a keyboard instrument either)
            if (!plucked && steps === 0 && !prevSlot.breathAfter) continue;
            // going back and forth between two notes is not a line
            if (!plucked && before && before.step === option.step && before.alter === option.alter) {
              const third = path.notes[i - 3];
              add('movement', third && third.step === prev.step ? 2.5 : 0.7);
            }
            // after a rest a bowed line may begin again from anywhere near
            add('movement', !plucked && prevSlot.breathAfter ? move / 2 : move);
            if (!plucked && before && !prevSlot.breathAfter) {
              const earlier = prev.step - before.step;
              if (Math.abs(earlier) >= 3 && !(Math.abs(steps) <= 1 && Math.sign(steps) !== Math.sign(earlier))) add('movement', 1); // a leap not answered by a step back
            }
            if (plucked && !newFigure && steps < 0) add('movement', 0.3); // a broken chord rises
            if (plucked && !newFigure) {
              const same = path.notes.slice(0, i).some((n, k) => slots[k].bar === slot.bar && n.step === option.step && n.alter === option.alter);
              if (same) add('movement', 0.4);
            }
            if (slot.themeMove !== null && steps === slot.themeMove) add('thematic', -0.5);
            // against a violin that moves at the same moment
            for (const line of violins) {
              if (!onsetAt(line, slot.tick)) continue;
              const now = soundingAt(line, slot.tick);
              const then = soundingAt(line, slot.tick - 1);
              if (!now || !then || steps === 0) continue;
              const theirs = Math.sign(pitch(now) - pitch(then));
              if (theirs !== 0) add('withViolins', theirs === Math.sign(steps) ? 0.4 : -0.3);
            }
          }
          if (!option.chordTone) add('harmony', 0.5);
          else if (!soundingPcs.has(option.pc)) add('harmony', -0.3); // a chord tone the violins are not sounding
          if (slot.role === 'arrival') {
            const above = mod(option.pc - chord.fact.rootPc, 12);
            add('harmony', above === 3 || above === 4 ? -0.6 : above === 7 ? -0.2 : above === 0 ? 0 : 0.3);
          }
          for (const line of violins) {
            const theirs = soundingAt(line, slot.tick);
            if (!theirs) continue;
            const ic = mod(pitch(theirs) - option.pitch, 12);
            if (ic === 0) add('doubling', plucked ? (onsetAt(line, slot.tick) ? 1.2 : 0.6) : slot.duration >= beat ? 1.5 : 0.5);
            else if (ic === 3 || ic === 4 || ic === 8 || ic === 9) add('withViolins', plucked ? 0 : -0.4);
            else if (ic === 5) add('withViolins', 0.2);
            else if (ic !== 7) add('withViolins', 0.5);
          }
          if (!plucked) {
            if (option.pitch < input.singing[0] || option.pitch > input.singing[1]) add('register', 0.5);
            if (slot.duration <= beat / 2 && option.pitch < VIOLA.slowBelow) add('register', 0.8); // the low string speaks slowly
          }
          const notes = [...path.notes, { step: option.step, alter: option.alter }];
          if (hopeless(slots.slice(0, i + 1), notes, window)) continue;
          next.push({ notes, cost: Object.values(parts).reduce((a, b) => a + b, 0), parts });
        }
      }
      next.sort((x, y) => x.cost - y.cost);
      paths = next.slice(0, PATHS_KEPT);
      if (paths.length === 0) { rejections['no path under the violins is sound as far as this rhythm goes'] = (rejections['no path under the violins is sound as far as this rhythm goes'] ?? 0) + 1; return null; }
    }
    let best: { path: Path; functions: NoteFunction[] } | null = null;
    for (const path of paths.slice(0, CANDIDATES_CHECKED)) {
      counts.considered++;
      const judged = judgeComplete(slots, path.notes, window, plucked);
      if ('reason' in judged) { rejections[judged.reason] = (rejections[judged.reason] ?? 0) + 1; continue; }
      counts.sound++;
      if (!best) best = { path, functions: judged.functions };
    }
    return best;
  };

  const toNotes = (slots: readonly Slot[], path: Path, functions: readonly NoteFunction[]): ViolaNote[] => slots.map((slot, i) => ({
    tick: slot.tick, duration: slot.duration, step: path.notes[i].step, alter: path.notes[i].alter, function: functions[i],
    span: slot.span, role: slot.role, breathAfter: slot.breathAfter, cell: slot.cell,
  }));

  /* ------------------------------------------------------------------ */
  /* rhythm                                                              */
  /* ------------------------------------------------------------------ */

  const fourBeats = frame.beatsPerBar === 4;
  const headTicks = theme.headCount < theme.notes.length ? theme.notes[theme.headCount].tick : theme.lengthTicks;
  const derivedCell = (id: string, name: string, derived: 'theme-tail' | 'theme-head', source: readonly { tick: number; duration: number; step: number }[], offsetBeats: number): (RhythmCell & { moves: (number | null)[] }) | null => {
    if (source.length < 2) return null;
    const origin = source[0].tick;
    const notes: [number, number][] = [];
    const moves: (number | null)[] = [];
    source.forEach((n, i) => {
      const start = (n.tick - origin) / beat + offsetBeats;
      if (start >= frame.beatsPerBar) return;
      notes.push([start, Math.min(n.duration / beat, frame.beatsPerBar - start)]);
      moves.push(i === 0 ? null : n.step - source[i - 1].step);
    });
    return notes.length >= 2 ? { id, name, notes, derived, moves } : null;
  };
  const tail = theme.notes.slice(theme.headCount);
  const head = theme.notes.slice(0, theme.headCount);
  const lineCells: (RhythmCell & { moves?: (number | null)[] })[] = fourBeats
    ? [
      ...VIOLA_LINE_CELLS,
      ...[
        tail.length && tail[tail.length - 1].tick + tail[tail.length - 1].duration - headTicks <= bar ? derivedCell('theme-tail', 'the rhythm of the theme\'s close', 'theme-tail', tail, 0) : null,
        derivedCell('theme-tail-late', 'the rhythm of the theme\'s close, a beat late', 'theme-tail', tail, 1),
        derivedCell('theme-head-late', 'the rhythm of the theme\'s opening, a beat late', 'theme-head', head, 1),
      ].filter((c): c is RhythmCell & { moves: (number | null)[] } => c !== null),
    ]
    : [
      { id: 'one-note', name: 'one note a bar', notes: [[0, frame.beatsPerBar]] },
      { id: 'after-beat-held', name: 'enters on the second beat and holds', notes: [[1, frame.beatsPerBar - 1]] },
    ];
  const plainIds = new Set(fourBeats ? VIOLA_PLAIN_CELL_IDS : ['one-note', 'after-beat-held']);
  const pulseCells = fourBeats ? VIOLA_PULSE_CELLS : [
    { id: 'ground-1', name: 'bass on one', notes: [[0, 0.5]] as [number, number][], grounded: true, sparse: true },
    { id: 'after-2', name: 'the second beat', notes: [[1, 0.5]] as [number, number][], grounded: false, sparse: true },
  ];

  /** How a one-bar rhythm sits against the violins: lower is better. */
  const rhythmAgainstViolins = (barTick: number, onsets: readonly number[], excuseDownbeat: boolean): { shared: number; fills: number } => {
    let shared = 0;
    let fills = 0;
    for (const tick of onsets) {
      if (excuseDownbeat && tick === barTick) continue;
      const attacks = violins.filter((line) => onsetAt(line, tick)).length;
      shared += attacks + (attacks === 2 ? 0.5 : 0);
      if (attacks === 0 && violins.some((line) => soundingAt(line, tick))) fills++;
    }
    return { shared, fills };
  };

  /* ------------------------------------------------------------------ */
  /* units                                                               */
  /* ------------------------------------------------------------------ */

  const written: ViolaNote[] = [];
  const writings = new Map<number, ViolaSpanWriting>();
  const silent = (span: ThirdSpan, level: ViolaLevel, decision: string, considered = 0, rejections: Record<string, number> = {}): void => {
    writings.set(span.index, { span: span.index, role: span.role, level: VIOLA_LEVEL_NAMES[level], played: false, decision, material: null, rhythm: [], notes: [], considered, sound: 0, rejections, weighed: null });
  };
  const levelOf = (span: ThirdSpan): ViolaLevel => input.levels[span.index] ?? 0;

  /** A bowed line over one or more adjacent stretches, with its arrival when one follows. */
  const composeLine = (lineSpans: readonly ThirdSpan[], arrivalSpans: readonly ThirdSpan[]): void => {
    const start = lineSpans[0].startTick;
    const end = lineSpans[lineSpans.length - 1].endTick;
    const spanAt = (tick: number): ThirdSpan => lineSpans.find((s) => s.startTick <= tick && tick < s.endTick) ?? lineSpans[lineSpans.length - 1];
    const rejections: Record<string, number> = {};
    const counts = { considered: 0, sound: 0 };

    // the arrival note, when the line has somewhere to arrive
    let arrival: Slot | null = null;
    const arrivalLevel = arrivalSpans.length ? levelOf(arrivalSpans[0]) : 2;
    if (arrivalSpans.length && arrivalLevel < 2 && arrivalSpans[0].startTick === end) {
      const goal = soundingAt(first, end);
      const until = Math.min(arrivalSpans[arrivalSpans.length - 1].mustEndBy, goal ? goal.tick + goal.duration : end + 2 * beat);
      if (until - end >= beat) {
        arrival = { tick: end, duration: until - end, span: arrivalSpans[0].index, role: 'arrival', cell: null, bar: Math.floor(end / bar), firstOfBar: true, grounded: false, themeMove: null, breathAfter: true };
      }
    }

    // rhythm, bar by bar: keep the best few sequences
    interface Sequence { cells: (RhythmCell & { moves?: (number | null)[] })[]; score: number; unbroken: number; slots: Slot[] }
    let sequences: Sequence[] = [{ cells: [], score: 0, unbroken: 0, slots: [] }];
    const firstBar = Math.floor(start / bar);
    const lastBar = Math.floor((end - 1) / bar);
    for (let b = firstBar; b <= lastBar; b++) {
      const barTick = b * bar;
      const span = spanAt(Math.max(barTick, start));
      const level = levelOf(span);
      const intensity = input.intensityAt(barTick + bar / 2);
      const options = lineCells.filter((c) => level === 0 || plainIds.has(c.id));
      const next: Sequence[] = [];
      for (const sequence of sequences) {
        for (const cell of options) {
          const placed = cell.notes.map(([at, length], k) => ({ tick: barTick + at * beat, duration: length * beat, k })).filter((n) => n.tick >= start && n.tick + n.duration <= end);
          if (placed.length !== cell.notes.length) continue;
          const onsets = placed.map((n) => n.tick);
          const against = rhythmAgainstViolins(barTick, onsets, false);
          const before = sequence.cells[sequence.cells.length - 1];
          const earlier = sequence.cells[sequence.cells.length - 2];
          const startsOnDownbeat = placed[0].tick === barTick;
          const continues = startsOnDownbeat && sequence.slots.length > 0;
          const sounding = placed.reduce((sum, n) => sum + n.duration, 0) / beat;
          const unbroken = continues ? sequence.unbroken + sounding : sounding;
          let score = sequence.score
            + against.shared
            - 0.75 * against.fills
            + 0.5 * Math.abs(placed.length - (2 + 3 * intensity))
            + (sequence.slots.length === 0 && startsOnDownbeat ? 0.5 : 0) // the Viola speaks after the others
            - (cell.derived ? 0.5 : 0);
          if (before && before.id === cell.id) score += earlier && earlier.id === cell.id ? 2 : -0.5; // a pattern said twice is a pattern; three times is a habit
          if (unbroken > VIOLA.maxUnbrokenBeats) score += 3; // it has to breathe
          // a line with nowhere to arrive ends on a note long enough to be an ending
          if (b === lastBar && !arrival && placed[placed.length - 1].duration < 1.5 * beat) score += 2;
          const slots: Slot[] = placed.map((n, i) => ({
            tick: n.tick, duration: n.duration, span: spanAt(n.tick).index, role: 'inner-line' as const, cell: cell.id, bar: b, firstOfBar: i === 0, grounded: false,
            themeMove: cell.moves ? cell.moves[n.k] : null, breathAfter: false,
          }));
          next.push({ cells: [...sequence.cells, cell], score, unbroken, slots: [...sequence.slots, ...slots] });
        }
      }
      next.sort((x, y) => x.score - y.score);
      sequences = next.slice(0, RHYTHMS_KEPT);
    }

    let best: Chosen | null = null;
    for (const sequence of sequences) {
      if (sequence.slots.length === 0) continue;
      const all = arrival ? [...sequence.slots, arrival] : sequence.slots;
      const slots = all.map((slot, i) => ({ ...slot, breathAfter: i === all.length - 1 || all[i + 1].tick > slot.tick + slot.duration }));
      const found = searchPitches(slots, false, rejections, counts);
      if (!found) continue;
      const parts = { ...found.path.parts, rhythm: round(sequence.score) };
      const total = found.path.cost + sequence.score;
      if (!best || total < best.total - 1e-9) best = { slots, notes: toNotes(slots, found.path, found.functions), total, parts, rhythm: sequence.cells.map((c) => c.name) };
    }

    if (!best) {
      const reason = Object.entries(rejections).map(([k, v]) => `${k} ×${v}`).join('; ') || 'no rhythm fits the stretch';
      for (const span of lineSpans) silent(span, levelOf(span), `silent by the writer's decision: no line was sound alone and against both violins (${reason})`, counts.considered, rejections);
      for (const span of arrivalSpans) silent(span, levelOf(span), 'silent: there is no line to arrive from');
      return;
    }
    written.push(...best.notes);
    const weighed = Object.fromEntries(Object.entries(best.parts).map(([k, v]) => [k, round(v)]));
    const derived = [...new Set(best.notes.map((n) => lineCells.find((c) => c.id === n.cell)).filter((c) => c?.derived).map((c) => c!.name))];
    for (const span of lineSpans) {
      const notes = best.notes.filter((n) => n.span === span.index);
      const firstBarOfSpan = Math.floor(span.startTick / bar);
      const rhythm = best.rhythm.slice(firstBarOfSpan - firstBar, Math.floor((span.endTick - 1) / bar) - firstBar + 1);
      writings.set(span.index, {
        span: span.index, role: span.role, level: VIOLA_LEVEL_NAMES[levelOf(span)], played: notes.length > 0,
        decision: `enters at ${barName(notes[0]?.tick ?? span.startTick)}: ${counts.considered} complete candidates examined over ${sequences.length} rhythms, ${counts.sound} sound alone and against both violins; the one its character weighs least was kept`,
        material: `a bowed line${levelOf(span) === 1 ? ' (the plainer alternative: half-bar notes)' : ''}${derived.length ? `, using ${derived.join(' and ')}` : ''}`,
        rhythm, notes, considered: counts.considered, sound: counts.sound, rejections, weighed,
      });
    }
    arrivalSpans.forEach((span, i) => {
      const notes = best!.notes.filter((n) => n.span === span.index);
      if (i === 0 && notes.length) {
        writings.set(span.index, {
          span: span.index, role: 'arrival', level: VIOLA_LEVEL_NAMES[levelOf(span)], played: true,
          decision: `arrives at ${barName(notes[0].tick)} with the first voice, as the last note of the line before it`,
          material: 'a held chord tone', rhythm: [], notes, considered: counts.considered, sound: counts.sound, rejections: {}, weighed,
        });
      } else if (i > 0 && arrival && arrival.tick + arrival.duration > span.startTick) {
        writings.set(span.index, {
          span: span.index, role: 'arrival', level: VIOLA_LEVEL_NAMES[levelOf(span)], played: true,
          decision: 'the arrival note goes on sounding', material: 'the held chord tone, continued', rhythm: [], notes: [], considered: 0, sound: 0, rejections: {}, weighed: null,
        });
      } else {
        silent(span, levelOf(span), arrivalLevel >= 2 ? 'silent: the review asked for the arrival to be left out' : 'silent: no room for a held note here');
      }
    });
  };

  /** A plucked figure over one or more adjacent stretches. `bowedAt`: when the next bowed note begins, if any. */
  const composePulse = (pulseSpans: readonly ThirdSpan[], bowedAt: number | null): void => {
    const rejections: Record<string, number> = {};
    const counts = { considered: 0, sound: 0 };
    const slots: Slot[] = [];
    const rhythmBySpan = new Map<number, string[]>();
    let before: string | null = null;
    let run = 0;
    for (const span of pulseSpans) {
      const level = levelOf(span);
      if (level >= 2) { before = null; run = 0; continue; }
      for (let b = Math.floor(span.startTick / bar); b * bar < span.endTick; b++) {
        const barTick = b * bar;
        const grounded = !input.lowerStringsSoundIn(barTick, barTick + bar);
        const intensity = input.intensityAt(barTick + bar / 2);
        let chosen: { cell: typeof pulseCells[number]; onsets: number[]; score: number } | null = null;
        for (const cell of pulseCells) {
          if (cell.grounded !== grounded || (level === 1 && !cell.sparse)) continue;
          const onsets = cell.notes.map(([at]) => barTick + at * beat)
            .filter((tick) => tick >= span.startTick && tick + VIOLA.pizzRingBeats * beat <= Math.min(span.endTick, span.mustEndBy))
            // the hand needs a beat to come back to the bow
            .filter((tick) => bowedAt === null || tick + (VIOLA.pizzRingBeats + VIOLA.arcoPreparationBeats) * beat <= bowedAt);
          if (onsets.length === 0 || (grounded && onsets[0] !== barTick)) continue;
          const against = rhythmAgainstViolins(barTick, onsets, grounded);
          const score: number = against.shared
            + 0.5 * Math.abs(onsets.length - (2 + 2 * intensity))
            + (before === cell.id ? (run >= 4 ? 1 : -1) : 0); // an ostinato keeps its pattern; after four bars it varies
          if (!chosen || score < chosen.score - 1e-9) chosen = { cell, onsets, score };
        }
        if (!chosen) { before = null; run = 0; continue; }
        run = before === chosen.cell.id ? run + 1 : 1;
        before = chosen.cell.id;
        rhythmBySpan.set(span.index, [...(rhythmBySpan.get(span.index) ?? []), `${chosen.cell.name}${chosen.onsets.length < chosen.cell.notes.length ? ' (cut short)' : ''}`]);
        chosen.onsets.forEach((tick, i) => slots.push({
          tick, duration: VIOLA.pizzRingBeats * beat, span: span.index, role: 'pulse', cell: chosen!.cell.id, bar: b, firstOfBar: i === 0, grounded: grounded && i === 0, themeMove: null, breathAfter: true,
        }));
      }
    }
    const found = slots.length ? searchPitches(slots, true, rejections, counts) : null;
    if (!found) {
      const reason = Object.entries(rejections).map(([k, v]) => `${k} ×${v}`).join('; ') || 'no figure fits';
      for (const span of pulseSpans) silent(span, levelOf(span), levelOf(span) >= 2 ? 'silent: the review asked for this stretch to be left out' : `silent by the writer's decision: no plucked figure was sound against both violins (${reason})`, counts.considered, rejections);
      return;
    }
    const notes = toNotes(slots, found.path, found.functions);
    written.push(...notes);
    const weighed = Object.fromEntries(Object.entries(found.path.parts).map(([k, v]) => [k, round(v)]));
    for (const span of pulseSpans) {
      const own = notes.filter((n) => n.span === span.index);
      if (own.length === 0) { silent(span, levelOf(span), levelOf(span) >= 2 ? 'silent: the review asked for this stretch to be left out' : 'silent: no plucked note fits this stretch'); continue; }
      const grounded = slots.some((s) => s.span === span.index && s.grounded);
      writings.set(span.index, {
        span: span.index, role: 'pulse', level: VIOLA_LEVEL_NAMES[levelOf(span)], played: true,
        decision: `plucks from ${barName(own[0].tick)}: ${counts.considered} complete figures examined, ${counts.sound} sound against both violins; ${grounded ? 'no lower string sounds, so each bar begins on the bass of its chord' : 'a lower string has the downbeats, so the figure keeps to the off-beats'}`,
        material: `a plucked broken chord${levelOf(span) === 1 ? ' (the plainer alternative: two notes a bar)' : ''}`,
        rhythm: rhythmBySpan.get(span.index) ?? [], notes: own, considered: counts.considered, sound: counts.sound, rejections, weighed,
      });
    }
  };

  /** The theme's closing gesture, in the foreground. */
  const composeReply = (span: ThirdSpan): void => {
    const level = levelOf(span);
    if (level >= 2) { silent(span, level, 'silent: the review asked for the answer to be left out'); return; }
    const source = level === 0 && tail.length >= 2 ? tail : head.slice(0, Math.min(head.length, 3));
    const origin = source[0].tick;
    const rejections: Record<string, number> = {};
    let considered = 0;
    let sound = 0;
    let best: { notes: ViolaNote[]; cost: number } | null = null;
    const window = violins.map((line) => line.filter((n) => n.tick < span.endTick && n.tick + n.duration > span.startTick));
    for (let shift = -14; shift <= 14; shift++) {
      const line: LineNote[] = [];
      let fits = true;
      for (const n of source) {
        const tick = span.startTick + n.tick - origin;
        const duration = Math.min(n.duration, Math.min(span.endTick, span.mustEndBy) - tick);
        if (duration < beat / 2) { fits = false; break; }
        const chord = chordAt(frame, tick);
        if (!chord) { fits = false; break; }
        const step = n.step + shift;
        const scale = localScale(frame, chord);
        const alter = [0, -1, 1].find((a) => scale.has(pitchClassOf(frame, { step, alter: a })));
        if (alter === undefined) { fits = false; break; }
        line.push({ tick, duration, step, alter });
      }
      if (!fits || line.length < 2) continue;
      const pitches = line.map(pitch);
      if (Math.min(...pitches) < input.range[0] || Math.max(...pitches) > input.range[1]) continue;
      considered++;
      const judged = judgeLine(frame, line, { finalStable: true });
      if (!judged.ok) { const r = 'its own line is not sound'; rejections[r] = (rejections[r] ?? 0) + 1; continue; }
      const sounding: SoundingNote[] = line.map((n, i) => ({ ...n, function: judged.functions[i] }));
      const conflict = window.map((violin) => judgeTogether(frame, sounding, violin, { side: null })).find((t) => !t.ok);
      if (conflict) { const r = `with a violin: ${conflict.conflicts[0].kind}`; rejections[r] = (rejections[r] ?? 0) + 1; continue; }
      sound++;
      const outside = pitches.filter((p) => p < input.singing[0] || p > input.singing[1]).length;
      const goal = soundingAt(first, span.startTick - 1) ?? soundingAt(first, span.startTick);
      const cost = 2 * outside + (goal ? Math.abs(pitches[0] - (pitch(goal) - 12)) / 4 : 0);
      if (!best || cost < best.cost - 1e-9) {
        best = { cost, notes: sounding.map((n, i) => ({ ...n, span: span.index, role: 'reply' as const, breathAfter: i === sounding.length - 1, cell: null })) };
      }
    }
    if (!best) { silent(span, level, `silent by the writer's decision: none of ${considered} placings of the answer was sound`, considered, rejections); return; }
    written.push(...best.notes);
    writings.set(span.index, {
      span: span.index, role: 'reply', level: VIOLA_LEVEL_NAMES[level], played: true,
      decision: `answers at ${barName(best.notes[0].tick)}: ${considered} placings examined, ${sound} sound; the one nearest the octave under the first voice's last note was kept`,
      material: level === 0 ? 'the theme\'s closing gesture' : 'the theme\'s opening, cut short', rhythm: [], notes: best.notes, considered, sound, rejections, weighed: { placing: round(best.cost) },
    });
  };

  // Bowed stretches are written first: a plucked figure before a bowed entrance
  // has to know when that entrance is, to leave the hand time to take the bow.
  const spans = plan.spans;
  for (const pass of ['bowed', 'plucked'] as const) for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if ((span.role === 'pulse') !== (pass === 'plucked')) continue;
    if (span.role === 'tacet') { silent(span, 0, `silent by plan: ${span.reason}`); continue; }
    if (span.role === 'inner-line') {
      let last = i;
      while (spans[last + 1] && spans[last + 1].role === 'inner-line' && spans[last + 1].startTick === spans[last].endTick) last++;
      const lineSpans = spans.slice(i, last + 1);
      let arrivalEnd = last;
      while (spans[arrivalEnd + 1] && spans[arrivalEnd + 1].role === 'arrival' && spans[arrivalEnd + 1].startTick === spans[arrivalEnd].endTick) arrivalEnd++;
      const arrivalSpans = spans.slice(last + 1, arrivalEnd + 1);
      const playing = lineSpans.filter((s) => levelOf(s) < 2);
      if (playing.length !== lineSpans.length) {
        // the review asked for (part of) the line to be left out: what remains must still be one adjacent run
        for (const s of lineSpans) if (levelOf(s) >= 2) silent(s, 2, 'silent: the review asked for this stretch to be left out');
        const tailRun: ThirdSpan[] = [];
        for (let k = lineSpans.length - 1; k >= 0 && levelOf(lineSpans[k]) < 2; k--) tailRun.unshift(lineSpans[k]);
        for (const s of playing) if (!tailRun.includes(s)) silent(s, levelOf(s), 'silent: the stretch after it was left out, and a line that stops in mid-air is worse than none');
        if (tailRun.length) composeLine(tailRun, arrivalSpans);
        else for (const s of arrivalSpans) silent(s, levelOf(s), 'silent: there is no line to arrive from');
      } else {
        composeLine(lineSpans, arrivalSpans);
      }
      i = arrivalEnd;
      continue;
    }
    if (span.role === 'pulse') {
      let last = i;
      while (spans[last + 1] && spans[last + 1].role === 'pulse' && spans[last + 1].startTick === spans[last].endTick) last++;
      const bowedNext = written.filter((n) => n.role !== 'pulse' && n.tick >= spans[last].endTick).sort((x, y) => x.tick - y.tick)[0];
      composePulse(spans.slice(i, last + 1), bowedNext ? bowedNext.tick : null);
      i = last;
      continue;
    }
    if (span.role === 'reply') { composeReply(span); continue; }
    silent(span, levelOf(span), 'silent: an arrival without a line before it');
  }

  written.sort((x, y) => x.tick - y.tick);
  return { notes: written, spans: spans.map((s) => writings.get(s.index)!) };
}

/* ------------------------------------------------------------------ */
/* the notes the instrument plays                                      */
/* ------------------------------------------------------------------ */

export interface ViolaWrittenNote {
  readonly note: Note;
  readonly source: ViolaNote;
  readonly shaping: readonly string[];
}

const LEAN = 4;
const RELEASE = 4;
/** The top of a bowed gesture is leaned into a little; its first note enters under the others. */
const GESTURE_PEAK = 3;
const GESTURE_ENTRY = -3;
/** The first plucked note of a bar marks it. */
const PULSE_BAR = 4;

export interface ViolaVoiceInput {
  readonly frame: TonalFrame;
  readonly notes: readonly ViolaNote[];
  /** Energy 0..1 per bar (index bar − 1). */
  readonly energyByBar: readonly number[];
  readonly primaryIntensityAt: (tick: number) => number;
}

export function writeViolaVoice(input: ViolaVoiceInput): ViolaWrittenNote[] {
  const { frame, notes } = input;
  const beat = frame.beatTicks;
  // bowed gestures: runs of connected notes
  const gestureOf: number[] = [];
  let g = -1;
  notes.forEach((n, i) => {
    const before = notes[i - 1];
    if (n.role === 'pulse' || !before || before.role === 'pulse' || before.breathAfter || before.tick + before.duration !== n.tick) g++;
    gestureOf.push(g);
  });
  return notes.map((source, i) => {
    const shaping: string[] = [];
    const role = source.role as Exclude<ViolaRole, 'tacet'>;
    const articulation: Articulation = VIOLA.articulation[role];
    const energy = Math.max(0, Math.min(1, input.energyByBar[Math.floor(source.tick / frame.barTicks)] ?? 0.5));
    const intensity = role === 'reply' ? 0.6 : input.primaryIntensityAt(source.tick);
    let velocity = 46 + 34 * energy + 16 * (intensity - 0.6) + VIOLA.level[role];
    if (VIOLA.level[role] !== 0) shaping.push(`${-VIOLA.level[role]} softer than a leading voice (${role})`);
    let duration = source.duration;
    if (role === 'pulse') {
      duration = Math.round(VIOLA.pizzLengthBeats * beat);
      const firstOfBar = !notes.some((n, k) => k < i && n.role === 'pulse' && Math.floor(n.tick / frame.barTicks) === Math.floor(source.tick / frame.barTicks));
      if (firstOfBar) { velocity += PULSE_BAR; shaping.push('marks the bar'); }
      shaping.push('plucked: written short, left to ring');
    } else {
      const gesture = notes.filter((_, k) => gestureOf[k] === gestureOf[i]);
      const before = notes[i - 1];
      if (source.function === 'appoggiatura' || source.function === 'suspension') {
        velocity += LEAN;
        shaping.push(`leaned on (${source.function})`);
      } else if (before && gestureOf[i - 1] === gestureOf[i] && (before.function === 'appoggiatura' || before.function === 'suspension')) {
        velocity -= RELEASE;
        shaping.push('released (resolution)');
      }
      if (gesture.length >= 3 && role !== 'arrival') {
        const top = Math.max(...gesture.map((n) => soundingPitch(frame, n)));
        if (gesture[0] === source) { velocity += GESTURE_ENTRY; shaping.push('enters under the others'); }
        else if (soundingPitch(frame, source) === top && gesture.find((n) => soundingPitch(frame, n) === top) === source) { velocity += GESTURE_PEAK; shaping.push('the top of the gesture'); }
      }
      if (role === 'arrival') shaping.push('held; plain bow, no slur');
      if (source.breathAfter) {
        const lift = source.duration >= 2 * beat ? beat / 2 : Math.round(source.duration / 4);
        duration -= lift;
        shaping.push(`bow lifts ${lift} ticks early`);
      } else if (role !== 'arrival') {
        shaping.push('slurred into the next note');
      }
    }
    return {
      note: {
        pitch: soundingPitch(frame, source),
        startTick: source.tick,
        durationTicks: duration,
        velocity: Math.max(VOICE_VELOCITY[0], Math.min(VOICE_VELOCITY[1], Math.round(velocity))),
        articulation,
      },
      source,
      shaping,
    };
  });
}
