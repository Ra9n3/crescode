/**
 * The Cello's notes (Strings V1, Stage 5) — composed apart from the three
 * upper voices, against them as they stand.
 *
 * For every stretch the plan gave a role, the writer builds its own
 * candidates, turns down every one that is not sound as a line or not sound
 * against ANY of the three upper voices (the two-voice rules of Stage 3,
 * applied to each pair), and keeps the one its character prefers. Each
 * stretch has three alternatives — preferred, plainer, silent — and the
 * review may ask for a lower one. Nothing here changes another voice.
 *
 *   foundation    long bass tones. On the first beat of a chord the Cello,
 *                 when it is the floor, takes the chord's bass.
 *   bass-line     the same floor, moving: rhythm chosen bar by bar from the
 *                 Cello's own cells by where the upper voices attack and
 *                 hold; pitches searched with the bass's way of moving
 *                 (steps, fourths, fifths, octaves; no quavers on the C
 *                 string's lowest notes).
 *   plucked-bass  the bass, plucked: the downbeat and one or two answers.
 *   theme         the theme itself, adapted to the harmony where it enters
 *                 by the same skill the first voice uses (`adaptMaterial`:
 *                 the leap and the directions of the head are protected),
 *                 at a transposition that puts it in the Cello's register
 *                 under the violins. It may rise above the Viola. What is
 *                 left of the stretch goes on as a bass.
 *   arrival       the bass of the goal chord, reached with the first voice
 *                 and held.
 *
 * THE DOUBLE BASS is not written here. Where the (classic) desk sounds, the
 * Cello never goes under it and never sounds a semitone against it, and it
 * is no longer bound to the chord's bass note.
 *
 * Deterministic: no random draw is made; ties keep the first candidate.
 */
import type { Articulation, Note } from '../../../shared/schema/types';
import { CELLO, CELLO_BASS_CELLS, CELLO_FOUNDATION_CELLS, CELLO_PLAIN_CELL_IDS, CELLO_PLUCKED_CELLS, celloBassMove, type CelloCell, type CelloRole } from '../characters/cello';
import { judgeTogether, soundingPitch, type SoundingNote } from '../ensemble/counterpoint';
import type { FourthPlan, FourthSpan } from '../ensemble/fourth-plan';
import { adaptMaterial } from '../material/adapt';
import { chordAt, judgeLine, localScale, pitchClassOf, type LineNote, type NoteFunction, type TonalFrame } from '../material/line';
import type { Theme } from '../material/theme';
import { VOICE_VELOCITY } from './voice';

export type CelloLevel = 0 | 1 | 2;
export const CELLO_LEVEL_NAMES = ['preferred', 'plainer', 'silent'] as const;
export type UpperVoiceName = 'first' | 'second' | 'viola';

export interface CelloNote extends SoundingNote {
  readonly span: number;
  readonly role: CelloRole;
  /** A rest follows: the bow lifts (or, plucked, the note simply rings out). */
  readonly breathAfter: boolean;
  /** The rhythm cell the note belongs to; null for thematic notes and arrivals. */
  readonly cell: string | null;
  /** Index of the theme note this note states; null when the note is not thematic. */
  readonly themeIndex: number | null;
  /** True when no Double Bass sounds under the note. */
  readonly isFloor: boolean;
}

export interface CelloThematicEntry {
  readonly span: number;
  /** What the Cello actually took: the whole theme, its head, or its close. */
  readonly kind: 'statement' | 'head' | 'tail';
  readonly startTick: number;
  /** Transposition of the theme in scale steps, and how the harmony was met. */
  readonly shift: number;
  readonly strategy: string;
  readonly moved: readonly { readonly index: number; readonly how: string }[];
  readonly preferredLost: readonly string[];
  /** The diatonic moves of the entry, to compare with the theme's own. */
  readonly intervals: readonly number[];
  readonly themeIntervals: readonly number[];
  readonly rhythmBeats: readonly number[];
  readonly themeRhythmBeats: readonly number[];
  readonly candidatesTried: number;
  readonly candidatesSound: number;
}

export interface CelloSpanWriting {
  readonly span: number;
  readonly role: CelloRole;
  readonly level: typeof CELLO_LEVEL_NAMES[number];
  readonly played: boolean;
  readonly decision: string;
  readonly material: string | null;
  readonly rhythm: readonly string[];
  readonly notes: readonly CelloNote[];
  readonly considered: number;
  readonly sound: number;
  readonly rejections: Readonly<Record<string, number>>;
  readonly weighed: Readonly<Record<string, number>> | null;
}

export interface CelloInput {
  readonly frame: TonalFrame;
  readonly theme: Theme;
  readonly plan: FourthPlan;
  readonly first: readonly SoundingNote[];
  readonly second: readonly SoundingNote[];
  readonly viola: readonly SoundingNote[];
  readonly range: readonly [number, number];
  readonly levels: readonly CelloLevel[];
  /** The first voice's place in its phrase (0..1) at a tick. */
  readonly intensityAt: (tick: number) => number;
  /** Highest pitch of the Double Bass sounding between two ticks; null when none. */
  readonly doubleBassTopIn: (from: number, to: number) => number | null;
  /** Pitch classes the Double Bass sounds between two ticks. */
  readonly doubleBassPcsIn: (from: number, to: number) => readonly number[];
}

export interface CelloResult {
  readonly notes: readonly CelloNote[];
  readonly spans: readonly CelloSpanWriting[];
  readonly thematic: readonly CelloThematicEntry[];
}

const RHYTHMS_KEPT = 5;
const PATHS_KEPT = 22;
const CANDIDATES_CHECKED = 22;

const mod = (n: number, m: number): number => ((n % m) + m) % m;
const round = (n: number): number => Math.round(n * 1000) / 1000;

interface Slot {
  readonly tick: number;
  readonly duration: number;
  readonly span: number;
  readonly role: Exclude<CelloRole, 'tacet' | 'theme'>;
  readonly cell: string | null;
  readonly bar: number;
  readonly firstOfBar: boolean;
  /** The first beat of a bar or of a chord: the note that says what the harmony is. */
  readonly strong: boolean;
  readonly isFloor: boolean;
  readonly breathAfter: boolean;
}

interface Path {
  readonly notes: readonly { readonly step: number; readonly alter: number }[];
  readonly cost: number;
  readonly parts: Readonly<Record<string, number>>;
}

export function composeCello(input: CelloInput): CelloResult {
  const { frame, theme, plan } = input;
  const beat = frame.beatTicks;
  const bar = frame.barTicks;
  const fourBeats = frame.beatsPerBar === 4;
  const pitch = (n: Pick<LineNote, 'step' | 'alter'>): number => soundingPitch(frame, n);
  const uppers: readonly { name: UpperVoiceName; line: readonly SoundingNote[] }[] = [
    { name: 'first', line: input.first }, { name: 'second', line: input.second }, { name: 'viola', line: input.viola },
  ];
  const soundingAt = (line: readonly SoundingNote[], tick: number): SoundingNote | undefined => line.find((n) => n.tick <= tick && tick < n.tick + n.duration);
  const onsetAt = (line: readonly SoundingNote[], tick: number): boolean => line.some((n) => n.tick === tick);
  const lowestUpper = (from: number, to: number): number | null => {
    const inside = uppers.flatMap((u) => u.line.filter((n) => n.tick < to && n.tick + n.duration > from)).map(pitch);
    return inside.length ? Math.min(...inside) : null;
  };
  const barName = (tick: number): string => {
    const b = Math.floor(tick / bar) + 1;
    const inBar = (tick % bar) / beat + 1;
    return inBar === 1 ? `bar ${b}` : `bar ${b} beat ${Math.round(inBar * 100) / 100}`;
  };
  const pitchesAt = (tick: number, low: number, high: number): { step: number; alter: number; pitch: number; pc: number; chordTone: boolean }[] => {
    const chord = chordAt(frame, tick);
    if (!chord) return [];
    const scale = localScale(frame, chord);
    const out = new Map<number, { step: number; alter: number; pitch: number; pc: number; chordTone: boolean }>();
    for (let step = -35; step <= 14; step++) {
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
  /** A note against the Double Bass: never under it, never a semitone (or its octaves) against it. */
  const againstDoubleBass = (p: number, from: number, to: number): string | null => {
    const top = input.doubleBassTopIn(from, to);
    if (top !== null && p < top) return 'under the Double Bass';
    if (to - from >= beat && input.doubleBassPcsIn(from, to).some((pc) => { const ic = mod(p - pc, 12); return ic === 1 || ic === 11; })) return 'a semitone against the Double Bass';
    return null;
  };

  /* ------------------------------ judging ------------------------------ */

  type Window = readonly { name: UpperVoiceName; line: readonly SoundingNote[]; side: 'below' | null }[];
  const windowOf = (from: number, to: number, thematic: boolean): Window => uppers.map((u) => ({
    name: u.name, line: u.line.filter((n) => n.tick < to && n.tick + n.duration > from),
    // a bass stays under everybody; the theme stays under the violins and may rise above the Viola
    side: thematic && u.name === 'viola' ? null : 'below' as const,
  }));
  const lineNotes = (slots: readonly Slot[], notes: Path['notes']): LineNote[] => notes.map((n, i) => ({ tick: slots[i].tick, duration: slots[i].duration, step: n.step, alter: n.alter }));

  const hopeless = (slots: readonly Slot[], notes: Path['notes'], window: Window): boolean => {
    const line = lineNotes(slots, notes);
    const last = line.length - 1;
    const judged = judgeLine(frame, line, { finalStable: false });
    if (judged.problems.some((p) => p.index < last || /leap|outside the scale/.test(p.text))) return true;
    const sounding: SoundingNote[] = line.map((n, i) => ({ ...n, function: judged.functions[i] }));
    for (const voice of window) {
      const together = judgeTogether(frame, sounding, voice.line, { side: voice.side });
      if (together.conflicts.some((c) => c.tick < line[last].tick || c.kind === 'crossing' || c.kind === 'clash')) return true;
    }
    return false;
  };
  const judgeAgainst = (sounding: readonly SoundingNote[], window: Window): string | null => {
    for (const voice of window) {
      const together = judgeTogether(frame, sounding, voice.line, { side: voice.side });
      if (!together.ok) return `with the ${voice.name === 'viola' ? 'Viola' : `${voice.name} voice`}: ${together.conflicts[0].kind}`;
    }
    return null;
  };
  const judgeComplete = (slots: readonly Slot[], notes: Path['notes'], window: Window, plucked: boolean): { functions: NoteFunction[] } | { reason: string } => {
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
    const reason = judgeAgainst(line.map((n, i) => ({ ...n, function: functions[i] })), window);
    return reason ? { reason } : { functions };
  };

  /* ------------------------------ pitches ------------------------------ */

  /** What a bass note costs for the harmony it stands under. */
  const harmonyCost = (slot: Slot, option: { pc: number; chordTone: boolean }, rootPc: number, bassPc: number): number | null => {
    const above = mod(option.pc - rootPc, 12);
    if (slot.role === 'arrival' || slot.strong || slot.role === 'plucked-bass') {
      if (!option.chordTone) return null;
      if (slot.isFloor) {
        if (option.pc === bassPc) return 0;
        if (slot.role === 'arrival' || (slot.role === 'plucked-bass' && slot.firstOfBar)) return null;
        if (!slot.strong) return above === 7 ? 0.1 : above === 0 ? 0.2 : 0.4;
        // the floor of the harmony: the chord's bass; its root under a slash chord; rarely the third; hardly ever anything else
        return above === 0 ? 0.6 : above === 3 || above === 4 ? 1 : above === 7 ? 2 : 3;
      }
      return above === 0 || above === 3 || above === 4 || above === 7 ? 0 : 0.6;
    }
    return option.chordTone ? 0 : slot.role === 'foundation' ? 1 : 0.35;
  };

  const searchPitches = (slots: readonly Slot[], plucked: boolean, lead: { step: number; alter: number } | null, rejections: Record<string, number>, counts: { considered: number; sound: number }): { path: Path; functions: NoteFunction[] } | null => {
    if (slots.length === 0) return null;
    const from = slots[0].tick;
    const to = slots[slots.length - 1].tick + slots[slots.length - 1].duration;
    const window = windowOf(from, to, false);
    const reject = (why: string): void => { rejections[why] = (rejections[why] ?? 0) + 1; };
    let paths: Path[] = [{ notes: [], cost: 0, parts: {} }];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const end = slot.tick + slot.duration;
      const chord = chordAt(frame, slot.tick);
      if (!chord) return null;
      const lowest = lowestUpper(slot.tick, end);
      const high = Math.min(input.range[1], CELLO.bassCeiling, lowest === null ? CELLO.bassCeiling : lowest - CELLO.clearance);
      const options = pitchesAt(slot.tick, input.range[0], high).filter((o) => againstDoubleBass(o.pitch, slot.tick, end) === null);
      const rootPc = mod(chord.fact.rootPc, 12);
      const bassPc = mod(chord.fact.bassPc, 12);
      const next: Path[] = [];
      for (const path of paths) {
        const prev = path.notes[i - 1] ?? (i === 0 ? lead ?? undefined : undefined);
        const before = path.notes[i - 2];
        const prevSlot = slots[i - 1];
        const afterBreath = i === 0 || prevSlot.breathAfter;
        for (const option of options) {
          const harmony = harmonyCost(slot, option, rootPc, bassPc);
          if (harmony === null) continue;
          const parts: Record<string, number> = { ...path.parts };
          const add = (name: string, value: number): void => { if (value !== 0) parts[name] = (parts[name] ?? 0) + value; };
          add('harmony', harmony);
          if (prev) {
            const steps = option.step - prev.step;
            const semis = Math.abs(option.pitch - pitch(prev));
            if (semis === 6 || semis === 10 || semis === 11 || semis > 12) continue;
            const move = celloBassMove(steps, pitch(prev));
            if (move === null) continue;
            // under one bow a note is not said twice running
            if (!plucked && steps === 0 && !afterBreath) continue;
            if (!plucked && before && before.step === option.step && before.alter === option.alter) {
              const third = path.notes[i - 3];
              add('movement', third && third.step === prev.step ? 2.5 : 0.7); // back and forth between two notes is not a line
            }
            add('movement', afterBreath || plucked ? move / 2 : move);
            if (!plucked && before && !afterBreath) {
              const earlier = prev.step - before.step;
              // a bass leap of a fourth or fifth is a harmonic move and needs no answer; a third or an octave does
              if ((Math.abs(earlier) === 2 || Math.abs(earlier) >= 5) && Math.abs(steps) >= 2 && Math.sign(steps) === Math.sign(earlier)) add('movement', 0.8);
            }
            // against an upper voice that moves at the same moment: a bass goes the other way
            if (steps !== 0) {
              for (const u of uppers) {
                if (!onsetAt(u.line, slot.tick)) continue;
                const now = soundingAt(u.line, slot.tick);
                const then = soundingAt(u.line, slot.tick - 1);
                if (!now || !then) continue;
                const theirs = Math.sign(pitch(now) - pitch(then));
                if (theirs !== 0) add('withOthers', theirs === Math.sign(steps) ? 0.3 : -0.3);
              }
            }
          }
          // doubling: the root may be doubled anywhere; a held third or seventh doubled in the bass thickens the chord
          if (slot.duration >= beat) {
            const above = mod(option.pc - rootPc, 12);
            if (above !== 0 && above !== 7) {
              for (const u of uppers) {
                const theirs = soundingAt(u.line, slot.tick);
                if (theirs && mod(pitch(theirs) - option.pitch, 12) === 0) add('doubling', 0.6);
              }
            }
          }
          if (option.pitch < CELLO.bassRegister[0] || option.pitch > CELLO.bassRegister[1]) add('register', 0.4);
          if (!plucked && slot.duration <= beat / 2 && option.pitch < CELLO.heavyBelow) add('register', 1.5); // the C string speaks slowly
          if (lowest !== null && lowest - option.pitch > 28) add('spacing', 0.5); // a hole under the others
          const notes = [...path.notes, { step: option.step, alter: option.alter }];
          if (hopeless(slots.slice(0, i + 1), notes, window)) continue;
          next.push({ notes, cost: Object.values(parts).reduce((a, b) => a + b, 0), parts });
        }
      }
      next.sort((x, y) => x.cost - y.cost);
      paths = next.slice(0, PATHS_KEPT);
      if (paths.length === 0) { reject('no path under the upper voices is sound as far as this rhythm goes'); return null; }
    }
    for (const path of paths.slice(0, CANDIDATES_CHECKED)) {
      counts.considered++;
      const judged = judgeComplete(slots, path.notes, window, plucked);
      if ('reason' in judged) { reject(judged.reason); continue; }
      counts.sound++;
      return { path, functions: judged.functions };
    }
    return null;
  };

  const toNotes = (slots: readonly Slot[], path: Path, functions: readonly NoteFunction[]): CelloNote[] => slots.map((slot, i) => ({
    tick: slot.tick, duration: slot.duration, step: path.notes[i].step, alter: path.notes[i].alter, function: functions[i],
    span: slot.span, role: slot.role, breathAfter: slot.breathAfter, cell: slot.cell, themeIndex: null, isFloor: slot.isFloor,
  }));

  /* ------------------------------ rhythm ------------------------------- */

  const foundationCells: readonly CelloCell[] = fourBeats ? CELLO_FOUNDATION_CELLS : [{ id: 'whole', name: 'one note', notes: [[0, frame.beatsPerBar]] }];
  const bassCells: readonly CelloCell[] = fourBeats ? CELLO_BASS_CELLS : [
    { id: 'whole', name: 'one note', notes: [[0, frame.beatsPerBar]] },
    { id: 'stand-lead', name: 'a long note and a beat that leads on', notes: [[0, frame.beatsPerBar - 1], [frame.beatsPerBar - 1, 1]] },
  ];
  const plainCells: readonly CelloCell[] = fourBeats ? CELLO_FOUNDATION_CELLS.filter((c) => CELLO_PLAIN_CELL_IDS.includes(c.id)) : [{ id: 'whole', name: 'one note', notes: [[0, frame.beatsPerBar]] }];
  const pluckedCells = fourBeats ? CELLO_PLUCKED_CELLS : [{ id: 'one', name: 'beat one', notes: [[0, 0.5]] as [number, number][], sparse: true }];
  const strongAt = (tick: number): boolean => tick % bar === 0 || chordAt(frame, tick)?.fact.startTick === tick;
  const floorAt = (from: number, to: number): boolean => input.doubleBassTopIn(from, to) === null;

  const written: CelloNote[] = [];
  const thematic: CelloThematicEntry[] = [];
  const writings = new Map<number, CelloSpanWriting>();
  const levelOf = (span: FourthSpan): CelloLevel => input.levels[span.index] ?? 0;
  const silent = (span: FourthSpan, decision: string, considered = 0, rejections: Record<string, number> = {}): void => {
    writings.set(span.index, { span: span.index, role: span.role, level: CELLO_LEVEL_NAMES[levelOf(span)], played: false, decision, material: null, rhythm: [], notes: [], considered, sound: 0, rejections, weighed: null });
  };
  const record = (span: FourthSpan, notes: readonly CelloNote[], decision: string, material: string, rhythm: readonly string[], counts: { considered: number; sound: number }, rejections: Record<string, number>, weighed: Record<string, number> | null): void => {
    writings.set(span.index, { span: span.index, role: span.role, level: CELLO_LEVEL_NAMES[levelOf(span)], played: notes.length > 0, decision, material, rhythm, notes, considered: counts.considered, sound: counts.sound, rejections, weighed });
  };

  /* ------------------------------ the theme ---------------------------- */

  interface ThemeFound { notes: CelloNote[]; entry: CelloThematicEntry; endTick: number; cost: number; label: string }
  type Material = 'statement' | 'head' | 'tail';
  const MATERIAL_NAMES: Readonly<Record<Material, string>> = { statement: 'the whole theme', head: 'the theme\'s head', tail: 'the theme\'s close' };
  /** What was asked for first, then what is left of it: a statement that fits nowhere becomes the head, the head the close. */
  const composeTheme = (span: FourthSpan, asked: 'fragment' | 'statement', rejections: Record<string, number>): ThemeFound | null => {
    for (const kind of (asked === 'statement' ? ['statement', 'head', 'tail'] : ['head', 'tail']) as Material[]) {
      const found = composeThematic(span, kind, rejections);
      if (found) return found;
    }
    return null;
  };
  const composeThematic = (span: FourthSpan, kind: Material, rejections: Record<string, number>): ThemeFound | null => {
    const from = kind === 'tail' ? theme.headCount : 0;
    const count = (kind === 'head' ? theme.headCount : theme.notes.length) - from;
    if (count < 2) return null;
    const origin = theme.notes[from].tick;
    const material: LineNote[] = theme.notes.slice(from, from + count).map((n) => ({ tick: n.tick - origin, duration: n.duration, step: n.step, alter: n.alter }));
    const last = material[material.length - 1];
    const length = last.tick + last.duration;
    const leapAt = theme.identity.leap.fromIndex - from;
    const leapIndex = leapAt >= 0 && leapAt + 1 < count ? leapAt : -1;
    const headCount = kind === 'tail' ? count : Math.min(theme.headCount, count);
    const reject = (why: string): void => { const key = `${MATERIAL_NAMES[kind]}: ${why}`; rejections[key] = (rejections[key] ?? 0) + 1; };
    let best: ThemeFound | null = null;
    let tried = 0;
    let sound = 0;
    for (let delay = 0; span.startTick + delay + length <= Math.min(span.mustEndBy, span.endTick); delay += 2 * beat) {
      const target = span.startTick + delay;
      const window = windowOf(target, target + length, true);
      for (let shift = -35; shift <= 7; shift++) {
        const plain = material.map((n) => pitch({ step: n.step + shift, alter: n.alter }));
        if (Math.min(...plain) < input.range[0] - 2 || Math.max(...plain) > input.range[1] + 2) continue;
        tried++;
        const adapted = adaptMaterial({ frame, material, headCount, leapIndex, homeTick: theme.home.startTick + origin, targetTick: target, shifts: [shift], before: [], after: [], finalStable: true });
        if (!adapted.ok) { reject('the theme cannot be made to fit the harmony there without losing what protects it'); continue; }
        const pitches = adapted.notes.map(pitch);
        if (Math.min(...pitches) < input.range[0] || Math.max(...pitches) > input.range[1]) { reject('outside the Cello\'s range'); continue; }
        if (adapted.notes.some((n, i) => againstDoubleBass(pitches[i], n.tick, n.tick + n.duration) !== null)) { reject('under or against the Double Bass'); continue; }
        const sounding: SoundingNote[] = adapted.notes.map((n, i) => ({ ...n, function: adapted.functions[i] }));
        const reason = judgeAgainst(sounding, window);
        if (reason) { reject(reason); continue; }
        // unison with the Viola, or a second from it while both hold, is crowding even in the foreground
        const crowded = sounding.some((n, i) => input.viola.some((v) => v.tick < n.tick + n.duration && v.tick + v.duration > n.tick && Math.abs(pitch(v) - pitches[i]) <= 2 && Math.min(n.duration, v.duration) >= beat));
        if (crowded) { reject('within a tone of a note the Viola holds'); continue; }
        // the same pitch as a violin for a beat or more: the Cello would disappear into it
        const merged = sounding.some((n, i) => [input.first, input.second].some((line) => line.some((v) => v.tick < n.tick + n.duration && v.tick + v.duration > n.tick && pitch(v) === pitches[i] && Math.min(n.tick + n.duration, v.tick + v.duration) - Math.max(n.tick, v.tick) >= beat)));
        if (merged) { reject('in unison with a violin'); continue; }
        if (pitches.some((p, i) => i > 0 && p === pitches[i - 1])) { reject('the adaptation repeats a note under one bow'); continue; }
        sound++;
        const parts: Record<string, number> = {};
        const add = (name: string, value: number): void => { if (value !== 0) parts[name] = round((parts[name] ?? 0) + value); };
        add('changed', adapted.moved.length + 0.5 * adapted.preferredLost.length);
        add('register', 0.4 * pitches.reduce((sum, p) => sum + Math.max(0, CELLO.singingRegister[0] - p, p - CELLO.singingRegister[1]), 0) / pitches.length);
        for (const voice of window) {
          if (voice.line.length === 0) continue;
          const together = judgeTogether(frame, sounding, voice.line, { side: null });
          const total = together.verticals.reduce((sum, v) => sum + (v.endTick - v.tick), 0);
          const sweet = together.verticals.filter((v) => v.quality === 'imperfect').reduce((sum, v) => sum + (v.endTick - v.tick), 0);
          if (total > 0) add('withOthers', -0.6 * (sweet / total));
          if (voice.name !== 'viola' && together.sharedOnsets / sounding.length > 0.6) add('shadowing', 2);
          add('withOthers', 0.15 * (together.motion.parallel + together.motion.similar) - 0.15 * together.motion.contrary);
        }
        const over = sounding.filter((n, i) => input.viola.some((v) => v.tick < n.tick + n.duration && v.tick + v.duration > n.tick && pitch(v) < pitches[i])).length;
        add('aboveViola', 0.1 * over);
        // a thematic note that is the lowest note sounding is heard as the bass: it should be one the chord can stand on
        sounding.forEach((n, i) => {
          if (n.duration < beat || n.tick % beat !== 0) return;
          const low = lowestUpper(n.tick, n.tick + n.duration);
          const chord = chordAt(frame, n.tick);
          if (!chord || (low !== null && low < pitches[i]) || input.doubleBassTopIn(n.tick, n.tick + n.duration) !== null) return;
          const above = mod(pitches[i] - chord.fact.rootPc, 12);
          if (above !== 0 && above !== 7 && mod(pitches[i], 12) !== mod(chord.fact.bassPc, 12)) add('asBass', 0.4);
        });
        // its habit of variation: it does not say the same thing twice in the same place
        if (thematic.some((t) => t.kind === kind && t.shift === adapted.shift)) add('saidBefore', 0.5);
        add('late', 0.15 * (delay / beat));
        const cost = Object.values(parts).reduce((a, b) => a + b, 0);
        if (best && cost >= best.cost - 1e-9) continue;
        const intervals = adapted.notes.slice(1).map((n, i) => n.step - adapted.notes[i].step);
        best = {
          cost, endTick: target + length,
          label: `${MATERIAL_NAMES[kind]} from ${barName(target)}, ${shift === 0 ? 'at pitch' : `${Math.abs(shift)} scale steps ${shift < 0 ? 'lower' : 'higher'}`} (${adapted.strategy}${adapted.moved.length ? `, ${adapted.moved.length} note(s) moved` : ''})`,
          notes: sounding.map((n, i) => ({ ...n, span: span.index, role: 'theme' as const, breathAfter: i === sounding.length - 1, cell: null, themeIndex: from + i, isFloor: floorAt(n.tick, n.tick + n.duration) })),
          entry: {
            span: span.index, kind, startTick: target, shift: adapted.shift, strategy: adapted.strategy, moved: adapted.moved, preferredLost: adapted.preferredLost,
            intervals, themeIntervals: theme.identity.intervals.slice(from, from + count - 1),
            rhythmBeats: adapted.notes.map((n) => n.duration / beat), themeRhythmBeats: theme.identity.rhythm.slice(from, from + count),
            candidatesTried: 0, candidatesSound: 0,
          },
        };
      }
    }
    if (best) best.entry = { ...best.entry, candidatesTried: tried, candidatesSound: sound };
    else if (tried === 0) reject('no transposition puts the theme inside the Cello\'s range in this stretch');
    return best;
  };

  /* ------------------------------ a bowed bass ------------------------- */

  interface LinePart { span: FourthSpan; from: number; to: number; role: 'foundation' | 'bass-line'; plain: boolean }
  interface LineFound { notes: CelloNote[]; rhythm: string[]; firstBar: number; parts: Record<string, number>; counts: { considered: number; sound: number }; rhythms: number }
  /** A bowed bass over adjacent parts, with its arrival when one follows. */
  const composeLine = (parts: readonly LinePart[], arrivalSpan: FourthSpan | null, lead: { step: number; alter: number } | null, rejections: Record<string, number>): LineFound | null => {
    const counts = { considered: 0, sound: 0 };
    const start = parts.length ? parts[0].from : arrivalSpan!.startTick;
    const end = parts.length ? parts[parts.length - 1].to : arrivalSpan!.startTick;
    const partAt = (tick: number): LinePart => parts.find((p) => p.from <= tick && tick < p.to) ?? parts[parts.length - 1];

    let arrival: Slot | null = null;
    if (arrivalSpan && arrivalSpan.startTick === end) {
      const goal = soundingAt(input.first, end);
      const until = Math.min(arrivalSpan.mustEndBy, goal ? goal.tick + goal.duration : end + 2 * beat);
      if (until - end >= beat) arrival = { tick: end, duration: until - end, span: arrivalSpan.index, role: 'arrival', cell: null, bar: Math.floor(end / bar), firstOfBar: true, strong: true, isFloor: floorAt(end, until), breathAfter: true };
    }

    interface Sequence { cells: CelloCell[]; score: number; unbroken: number; slots: Slot[] }
    let sequences: Sequence[] = [{ cells: [], score: 0, unbroken: 0, slots: [] }];
    const firstBar = Math.floor(start / bar);
    const lastBar = parts.length ? Math.floor((end - 1) / bar) : firstBar - 1;
    for (let b = firstBar; b <= lastBar; b++) {
      const barTick = b * bar;
      const part = partAt(Math.max(barTick, start));
      const intensity = input.intensityAt(barTick + bar / 2);
      const half = barTick + bar / 2;
      const options = (start > barTick || end < barTick + bar ? bassCells : part.plain ? plainCells : part.role === 'foundation' ? foundationCells : bassCells)
        .filter((c) => !c.only || (c.only === 'before-entry' ? end === half && start <= barTick : start === half && end >= barTick + bar));
      const partEndsHere = part.to <= barTick + bar && part !== parts[parts.length - 1];
      const next: Sequence[] = [];
      for (const sequence of sequences) {
        for (const cell of options) {
          const placed = cell.notes.map(([at, length]) => ({ tick: barTick + at * beat, duration: length * beat })).filter((n) => n.tick >= start && n.tick + n.duration <= end);
          if (placed.length !== cell.notes.length) continue;
          let shared = 0;
          let fills = 0;
          for (const n of placed) {
            if (n.tick === barTick) continue; // a bass shares the downbeat with everybody; that is its place
            const attacks = uppers.filter((u) => onsetAt(u.line, n.tick)).length;
            shared += attacks >= 2 ? 1.5 : attacks;
            if (attacks === 0 && uppers.some((u) => soundingAt(u.line, n.tick))) fills++;
          }
          const before = sequence.cells[sequence.cells.length - 1];
          const earlier = sequence.cells[sequence.cells.length - 2];
          const sounding = placed.reduce((sum, n) => sum + n.duration, 0) / beat;
          const lifts = sounding < frame.beatsPerBar;
          const unbroken = sequence.slots.length > 0 && !(before && before.notes.reduce((s, [, l]) => s + l, 0) < frame.beatsPerBar) ? sequence.unbroken + sounding : sounding;
          const wanted = part.role === 'foundation' ? 1.3 : 2.2 + 2.6 * intensity;
          let score = sequence.score + 0.8 * shared - 0.6 * fills + 0.5 * Math.abs(placed.length - wanted);
          if (before && before.id === cell.id) score += earlier && earlier.id === cell.id ? 2 : part.role === 'foundation' ? 0 : -0.3;
          if (unbroken > CELLO.maxUnbrokenBeats) score += 3; // it has to breathe
          if (lifts) score += partEndsHere ? -0.4 : b === lastBar ? (arrival ? 3 : -0.3) : 0.6; // the bow lifts where one thing ends and another begins
          if (b === lastBar && !arrival && placed[placed.length - 1].duration < beat) score += 2;
          const slots: Slot[] = placed.map((n, i) => ({
            tick: n.tick, duration: n.duration, span: partAt(n.tick).span.index, role: partAt(n.tick).role, cell: cell.id, bar: b, firstOfBar: i === 0,
            // the first note of a bar's figure says what the harmony is, also when the figure begins on the third beat
            strong: strongAt(n.tick) || i === 0, isFloor: floorAt(n.tick, n.tick + n.duration), breathAfter: false,
          }));
          next.push({ cells: [...sequence.cells, cell], score, unbroken, slots: [...sequence.slots, ...slots] });
        }
      }
      next.sort((x, y) => x.score - y.score);
      sequences = next.slice(0, RHYTHMS_KEPT);
    }

    let best: (LineFound & { total: number }) | null = null;
    for (const sequence of sequences) {
      const all = arrival ? [...sequence.slots, arrival] : sequence.slots;
      if (all.length === 0) continue;
      const slots = all.map((slot, i) => ({ ...slot, breathAfter: i === all.length - 1 || all[i + 1].tick > slot.tick + slot.duration }));
      const found = searchPitches(slots, false, lead, rejections, counts);
      if (!found) continue;
      const total = found.path.cost + sequence.score;
      if (!best || total < best.total - 1e-9) best = { notes: toNotes(slots, found.path, found.functions), rhythm: sequence.cells.map((c) => c.name), firstBar, parts: { ...found.path.parts, rhythm: round(sequence.score) }, counts, rhythms: sequences.length, total };
    }
    if (best) best.counts = counts;
    return best;
  };

  /* ------------------------------ units -------------------------------- */

  const spans = plan.spans;
  const bowedBass = (s: FourthSpan): boolean => s.role === 'foundation' || s.role === 'bass-line' || s.role === 'theme';
  const describeLine = (found: LineFound, span: FourthSpan, part: LinePart | null, extra: string): void => {
    const notes = found.notes.filter((n) => n.span === span.index && n.role !== 'arrival');
    const b0 = Math.floor((part ? part.from : span.startTick) / bar);
    const rhythm = found.rhythm.slice(b0 - found.firstBar, Math.floor(((part ? part.to : span.endTick) - 1) / bar) - found.firstBar + 1);
    const weighed = Object.fromEntries(Object.entries(found.parts).map(([k, v]) => [k, round(v)]));
    const role = part?.role ?? span.role;
    record(span, [...(writings.get(span.index)?.notes ?? []), ...notes],
      `${extra}${notes.length ? `the bass enters at ${barName(notes[0].tick)}` : 'no bass note falls in this stretch'}: ${found.counts.considered} complete candidates examined over ${found.rhythms} rhythms, ${found.counts.sound} sound alone and against all three upper voices; the one its character weighs least was kept`,
      `${writings.get(span.index)?.material ? `${writings.get(span.index)!.material}; then ` : ''}${role === 'foundation' ? 'long bass tones' : 'a moving bass'}${part?.plain ? ' (the plainer alternative: whole- and half-bar notes)' : ''}`,
      rhythm, found.counts, { ...(writings.get(span.index)?.rejections ?? {}) }, weighed);
  };

  let i = 0;
  while (i < spans.length) {
    const span = spans[i];
    if (span.role === 'tacet') { silent(span, `silent by plan: ${span.reason}`); i++; continue; }
    if (span.role === 'arrival') { silent(span, 'silent: an arrival without a line before it'); i++; continue; }

    if (span.role === 'plucked-bass') {
      const level = levelOf(span);
      if (level === 2) { silent(span, 'silent: the review withdrew this stretch after a finding'); i++; continue; }
      const next = spans[i + 1];
      const bowedNext = !!next && next.startTick === span.endTick && next.role !== 'tacet' && next.role !== 'plucked-bass' && levelOf(next) < 2;
      const rejections: Record<string, number> = {};
      const counts = { considered: 0, sound: 0 };
      const slots: Slot[] = [];
      const names: string[] = [];
      for (let b = Math.floor(span.startTick / bar); b * bar < span.endTick; b++) {
        const barTick = b * bar;
        const lastBar = (b + 1) * bar >= span.endTick;
        let chosen: { cell: typeof pluckedCells[number]; score: number; placed: { tick: number; duration: number }[] } | null = null;
        for (const cell of pluckedCells) {
          if (level === 1 && !cell.sparse) continue;
          const placed = cell.notes.map(([at]) => ({ tick: barTick + at * beat, duration: Math.round(CELLO.pizzRingBeats * beat) })).filter((n) => n.tick >= span.startTick && n.tick + n.duration <= span.mustEndBy);
          if (placed.length === 0) continue;
          // the bow must be back in the hand before a bowed entry
          if (lastBar && bowedNext && placed[placed.length - 1].tick + CELLO.pizzLengthBeats * beat > span.endTick - CELLO.arcoPreparationBeats * beat) continue;
          const shared = placed.filter((n) => n.tick !== barTick).reduce((sum, n) => sum + uppers.filter((u) => onsetAt(u.line, n.tick)).length, 0);
          const score = shared + 0.5 * Math.abs(placed.length - (1.5 + 1.5 * input.intensityAt(barTick + bar / 2)));
          if (!chosen || score < chosen.score - 1e-9) chosen = { cell, score, placed };
        }
        if (!chosen) continue;
        names.push(chosen.cell.name);
        chosen.placed.forEach((n, k) => slots.push({ tick: n.tick, duration: n.duration, span: span.index, role: 'plucked-bass', cell: chosen!.cell.id, bar: b, firstOfBar: k === 0 && n.tick === barTick, strong: strongAt(n.tick), isFloor: floorAt(n.tick, n.tick + n.duration), breathAfter: true }));
      }
      const found = searchPitches(slots, true, null, rejections, counts);
      if (!found) silent(span, `silent by the writer's decision: no plucked bass was sound against the upper voices (${Object.entries(rejections).map(([k, v]) => `${k} ×${v}`).join('; ') || 'no figure fits the stretch'})`, counts.considered, rejections);
      else {
        const notes = toNotes(slots, found.path, found.functions);
        written.push(...notes);
        record(span, notes, `plucks from ${barName(notes[0].tick)}: ${counts.considered} candidates examined, ${counts.sound} sound`, `the bass, plucked${level === 1 ? ' (the plainer alternative: the downbeat only)' : ''}`, names, counts, rejections, Object.fromEntries(Object.entries(found.path.parts).map(([k, v]) => [k, round(v)])));
      }
      i++;
      continue;
    }

    // a run of adjacent bowed stretches, and the arrival that may follow it
    let j = i;
    while (j + 1 < spans.length && bowedBass(spans[j + 1]) && spans[j + 1].startTick === spans[j].endTick && spans[j + 1].phrase === span.phrase) j++;
    const run = spans.slice(i, j + 1);
    const after = spans[j + 1];
    const arrivals: FourthSpan[] = [];
    let k = j + 1;
    while (k < spans.length && spans[k].role === 'arrival' && spans[k].startTick === spans[k - 1].endTick) { arrivals.push(spans[k]); k++; }
    const arrivalSpan = arrivals.length && levelOf(arrivals[0]) < 2 && after.startTick === run[run.length - 1].endTick ? arrivals[0] : null;

    // cut the run into pieces: thematic entries are written first and stand; the bass is written between them
    interface Piece { parts: LinePart[]; themeBefore: CelloNote[] | null }
    const pieces: Piece[] = [{ parts: [], themeBefore: null }];
    for (const s of run) {
      const level = levelOf(s);
      if (level === 2) { silent(s, 'silent: the review withdrew this stretch after a finding'); pieces.push({ parts: [], themeBefore: null }); continue; }
      if (s.role === 'theme' && level === 0) {
        const rejections: Record<string, number> = {};
        const found = composeTheme(s, s.thematic ?? 'fragment', rejections);
        if (found) {
          written.push(...found.notes);
          thematic.push(found.entry);
          const first = found.notes[0];
          // whatever came before stops for the entry; the bass picks up at the next bar line after it
          const halfBar = bar / 2;
          const until = fourBeats ? Math.floor(first.tick / halfBar) * halfBar : Math.floor(first.tick / bar) * bar;
          if (until > s.startTick) pieces[pieces.length - 1].parts.push({ span: s, from: s.startTick, to: until, role: 'bass-line', plain: false });
          const resume = fourBeats ? Math.ceil(found.endTick / halfBar) * halfBar : Math.ceil(found.endTick / bar) * bar;
          record(s, found.notes, `enters with thematic material at ${barName(first.tick)}: ${found.entry.candidatesTried} transpositions and placements tried, ${found.entry.candidatesSound} sound against all three upper voices; the one that changes the theme least and sits best was kept`, found.label, [], { considered: found.entry.candidatesTried, sound: found.entry.candidatesSound }, rejections, { total: round(found.cost) });
          pieces.push({ parts: resume < s.endTick ? [{ span: s, from: resume, to: s.endTick, role: 'bass-line', plain: false }] : [], themeBefore: found.notes });
          continue;
        }
        const why = Object.entries(rejections).map(([r, v]) => `${r} ×${v}`).join('; ');
        writings.set(s.index, { span: s.index, role: s.role, level: CELLO_LEVEL_NAMES[level], played: false, decision: `the thematic entry was declined by the writer (${why}); `, material: null, rhythm: [], notes: [], considered: 0, sound: 0, rejections, weighed: null });
      }
      pieces[pieces.length - 1].parts.push({ span: s, from: s.startTick, to: s.endTick, role: s.role === 'foundation' ? 'foundation' : 'bass-line', plain: level === 1 && s.role !== 'theme' });
    }

    let arrived = false;
    pieces.forEach((piece, p) => {
      const isLast = p === pieces.length - 1;
      const endsAtArrival = isLast && arrivalSpan !== null && (piece.parts.length ? piece.parts[piece.parts.length - 1].to : piece.themeBefore ? run[run.length - 1].endTick : -1) === arrivalSpan.startTick;
      if (piece.parts.length === 0 && !(endsAtArrival && piece.themeBefore)) return;
      const rejections: Record<string, number> = {};
      const leadNote = piece.themeBefore ? piece.themeBefore[piece.themeBefore.length - 1] : null;
      const attempt = (withArrival: boolean): LineFound | null => composeLine(piece.parts, withArrival ? arrivalSpan : null, leadNote ? { step: leadNote.step, alter: leadNote.alter } : null, rejections);
      let found = attempt(endsAtArrival);
      let withArrival = endsAtArrival;
      if (!found && endsAtArrival && piece.parts.length) { found = attempt(false); withArrival = false; }
      const why = Object.entries(rejections).map(([r, v]) => `${r} ×${v}`).join('; ') || 'no rhythm fits the stretch';
      if (!found) {
        for (const part of piece.parts) {
          const had = writings.get(part.span.index);
          if (had?.played) continue;
          silent(part.span, `${had?.decision ?? ''}silent by the writer's decision: no bass was sound alone and against all three upper voices (${why})`, 0, rejections);
        }
        return;
      }
      written.push(...found.notes);
      const seen = new Set<number>();
      for (const part of piece.parts) {
        if (seen.has(part.span.index)) continue;
        seen.add(part.span.index);
        describeLine(found, part.span, part, writings.get(part.span.index)?.played ? '' : writings.get(part.span.index)?.decision ?? '');
      }
      if (withArrival && arrivalSpan) {
        const note = found.notes.filter((n) => n.role === 'arrival');
        if (note.length) {
          arrived = true;
          record(arrivalSpan, note, `arrives at ${barName(note[0].tick)} with the first voice`, 'the bass of the goal chord, held', [], found.counts, {}, Object.fromEntries(Object.entries(found.parts).map(([key, v]) => [key, round(v)])));
        }
      }
    });
    for (const s of run) if (!writings.has(s.index)) silent(s, 'silent: nothing was left to write in this stretch');
    arrivals.forEach((a, n) => {
      if (n === 0 && arrived) return;
      silent(a, n > 0 && arrived ? 'the arrival note goes on sounding from the stretch before' : levelOf(a) === 2 ? 'silent: the review withdrew the arrival after a finding' : 'silent: no arrival note was sound, or there was no line to arrive from');
    });
    i = k;
  }

  written.sort((x, y) => x.tick - y.tick);
  // a note is followed by a rest wherever the next one does not begin as it ends
  const notes = written.map((n, at) => ({ ...n, breathAfter: n.breathAfter || at === written.length - 1 || written[at + 1].tick > n.tick + n.duration }));
  return { notes, spans: spans.map((s) => ({ ...writings.get(s.index)!, notes: notes.filter((n) => n.span === s.index) })), thematic };
}

/* ------------------------------------------------------------------ */
/* the notes the instrument plays                                      */
/* ------------------------------------------------------------------ */

export interface CelloWrittenNote {
  readonly note: Note;
  readonly source: CelloNote;
  /** Index of the bowed gesture the note belongs to; -1 for a plucked note. */
  readonly gesture: number;
  readonly shaping: readonly string[];
}

const LEAN = 4;
const RELEASE = 4;
/** A bowed gesture grows towards its goal note by this much and enters this far under it. */
const GESTURE_GROWTH = 6;
/** A thematic entry announces itself. */
const THEME_ENTRY = 3;
const PLUCKED_BAR = 4;
/** A note that carries the bar's harmony is given a little weight. */
const BASS_DOWNBEAT = 2;

export interface CelloVoiceInput {
  readonly frame: TonalFrame;
  readonly notes: readonly CelloNote[];
  /** Energy 0..1 per bar (index bar − 1). */
  readonly energyByBar: readonly number[];
  readonly primaryIntensityAt: (tick: number) => number;
  /** Strokes the instrument can trigger with a keyswitch of its own. */
  readonly triggerable: readonly string[];
}

/** The goal of a bowed gesture: the highest note of a thematic one; of a bass, its last strong note. */
export function gestureGoal(frame: TonalFrame, gesture: readonly CelloNote[]): number {
  if (gesture.some((n) => n.role === 'theme')) {
    const pitches = gesture.map((n) => soundingPitch(frame, n));
    return pitches.indexOf(Math.max(...pitches));
  }
  let goal = gesture.length - 1;
  for (let i = gesture.length - 1; i >= 0; i--) if (gesture[i].tick % frame.barTicks === 0) { goal = i; break; }
  return goal;
}

/** Bowed gestures: runs of connected notes; -1 for plucked notes. */
export function celloGestures(notes: readonly CelloNote[]): number[] {
  const out: number[] = [];
  let g = -1;
  notes.forEach((n, i) => {
    if (n.role === 'plucked-bass') { out.push(-1); return; }
    const before = notes[i - 1];
    if (!before || before.role === 'plucked-bass' || before.breathAfter || before.tick + before.duration !== n.tick) g++;
    out.push(g);
  });
  return out;
}

export function writeCelloVoice(input: CelloVoiceInput): CelloWrittenNote[] {
  const { frame, notes } = input;
  const beat = frame.beatTicks;
  const gestureOf = celloGestures(notes);
  return notes.map((source, i) => {
    const shaping: string[] = [];
    const role = source.role as Exclude<CelloRole, 'tacet'>;
    let articulation: Articulation = CELLO.articulation[role];
    const energy = Math.max(0, Math.min(1, input.energyByBar[Math.floor(source.tick / frame.barTicks)] ?? 0.5));
    const intensity = role === 'theme' ? 0.6 : input.primaryIntensityAt(source.tick);
    let velocity = 46 + 34 * energy + 16 * (intensity - 0.6) + CELLO.level[role];
    if (CELLO.level[role] !== 0) shaping.push(`${-CELLO.level[role]} softer than a leading voice (${role})`);
    let duration = source.duration;
    if (role === 'plucked-bass') {
      duration = Math.round(CELLO.pizzLengthBeats * beat);
      if (source.tick % frame.barTicks === 0) { velocity += PLUCKED_BAR; shaping.push('marks the bar'); }
      shaping.push('plucked: written short, left to ring');
    } else {
      const members = notes.map((n, k) => ({ n, k })).filter(({ k }) => gestureOf[k] === gestureOf[i]);
      const gesture = members.map((m) => m.n);
      const at = members.findIndex((m) => m.k === i);
      const before = at > 0 ? gesture[at - 1] : null;
      if (gesture.length >= 3 && role !== 'arrival') {
        const goal = gestureGoal(frame, gesture);
        // grow to the goal, fall away after it
        const shape = at <= goal ? (goal === 0 ? 0 : -GESTURE_GROWTH + GESTURE_GROWTH * (at / goal)) : -GESTURE_GROWTH * 0.6 * ((at - goal) / Math.max(1, gesture.length - 1 - goal));
        velocity += shape;
        shaping.push(at === goal ? 'the goal of the gesture' : at < goal ? `grows towards the goal (${Math.round(shape)})` : `falls away from the goal (${Math.round(shape)})`);
      }
      if (role === 'theme' && (i === 0 || notes[i - 1].role !== 'theme' || notes[i - 1].breathAfter)) { velocity += THEME_ENTRY; shaping.push('the thematic entry is marked'); }
      if (source.function === 'appoggiatura' || source.function === 'suspension') { velocity += LEAN; shaping.push(`leaned on (${source.function})`); }
      else if (before && (before.function === 'appoggiatura' || before.function === 'suspension')) { velocity -= RELEASE; shaping.push('released (resolution)'); }
      else if (role !== 'theme' && role !== 'arrival' && source.tick % frame.barTicks === 0 && source.isFloor) { velocity += BASS_DOWNBEAT; shaping.push('carries the bar\'s harmony'); }
      // the stroke: connected notes are slurred; a long tone standing alone is bowed plainly; a long floor at high energy shimmers
      const alone = gesture.length === 1;
      if (role === 'foundation' && source.duration >= 2 * beat && energy >= CELLO.tremoloFromEnergy && input.triggerable.includes('tremolo')) {
        articulation = 'tremolo';
        shaping.push(`tremolo: a long floor tone at energy ${Math.round(energy * 100) / 100}`);
      } else if (role !== 'arrival' && alone && source.duration >= 2 * beat && input.triggerable.includes('sustain')) {
        articulation = 'sustain';
        shaping.push('a long tone standing alone: plain bow');
      }
      if (role === 'arrival') shaping.push('held; plain bow, no slur');
      if (source.breathAfter) {
        const lift = source.duration >= 2 * beat ? beat / 2 : Math.round(source.duration / 4);
        duration -= lift;
        shaping.push(`bow lifts ${lift} ticks early`);
      } else if (articulation === 'legato') shaping.push('slurred into the next note');
    }
    return {
      note: { pitch: soundingPitch(frame, source), startTick: source.tick, durationTicks: duration, velocity: Math.max(VOICE_VELOCITY[0], Math.min(VOICE_VELOCITY[1], Math.round(velocity))), articulation },
      source, gesture: gestureOf[i], shaping,
    };
  });
}
