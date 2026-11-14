/**
 * The Double Bass writer (Strings V1, Stage 6) — composes the fifth voice
 * from its plan, against the four finished voices, which it reads and never
 * changes.
 *
 * It writes sounding pitches directly: the Double Bass's material is the
 * bass of each chord and the notes that connect one bass to the next, so
 * its craft is stated in chords and semitones rather than in the scale
 * steps a melody is written in.
 *
 * What it will not write, at any level:
 *   - a note outside its range, or above the lowest note the other voices
 *     sound with it where a note under them exists;
 *   - a chord's first note that is not the harmony's bass (the thematic
 *     response excepted, which is checked note by note);
 *   - a note foreign to the chord anywhere but on a weak beat, a beat long,
 *     reached and left by step;
 *   - a semitone held against a chord tone of another voice;
 *   - fifths or octaves in parallel with another voice, where it has a
 *     choice of note (the Cello's octave is allowed and weighed against);
 *   - a bowed note shorter than a beat.
 *
 * Every stretch has three levels: preferred, plainer, silent. The review
 * lowers a stretch's level; it never raises one.
 */
import type { Articulation, Note } from '../../../shared/schema/types';
import { DOUBLE_BASS, DOUBLE_BASS_MOVING_CELLS, doubleBassMove, type DoubleBassRole } from '../characters/double-bass';
import { chordAt, localScale, type TonalFrame } from '../material/line';
import type { Theme } from '../material/theme';
import type { HarmonicChord } from '../understanding/harmony';
import { clashOf, lowestHeard, mod12, parallelOf, type FifthOthers } from '../ensemble/fifth-hearing';
import type { FifthPlan, FifthSpan } from '../ensemble/fifth-plan';

export type DoubleBassLevel = 0 | 1 | 2;
export const DOUBLE_BASS_LEVEL_NAMES = ['preferred', 'plainer', 'silent'] as const;

export type BassFunction = 'chord-bass' | 'chord-tone' | 'passing' | 'appoggiatura';

export interface DoubleBassNote {
  readonly tick: number;
  readonly duration: number;
  readonly pitch: number;
  readonly span: number;
  /** What the note is doing (a stretch planned as one role may be written as a plainer one). */
  readonly role: DoubleBassRole;
  readonly function: BassFunction;
  /** A rest follows, or the bow is lifted before a different manner begins. */
  readonly breathAfter: boolean;
  /** The rhythm the note belongs to; null for arrivals and thematic notes. */
  readonly cell: string | null;
  /** Index of the theme note this note states; null when the note is not thematic. */
  readonly themeIndex: number | null;
}

export interface DoubleBassThematicEntry {
  readonly span: number;
  readonly tick: number;
  readonly kind: 'head-in-augmentation';
  /** Note lengths are the theme's, multiplied by this. */
  readonly factor: number;
  /** The theme head's moves in scale steps, and the moves written. */
  readonly themeSteps: readonly number[];
  readonly writtenSteps: readonly number[];
  /** How many of the head's notes are stated, of how many. */
  readonly notesOfHead: number;
  readonly headLength: number;
  readonly themeBeats: readonly number[];
  readonly writtenBeats: readonly number[];
  readonly pitches: readonly number[];
  readonly functions: readonly BassFunction[];
}

export interface DoubleBassSpanWriting {
  readonly span: number;
  readonly role: DoubleBassRole;
  /** What was written, when the planned role could not be. */
  readonly wrote: DoubleBassRole;
  readonly level: typeof DOUBLE_BASS_LEVEL_NAMES[number];
  readonly played: boolean;
  readonly decision: string;
  readonly rhythm: readonly string[];
  readonly notes: readonly DoubleBassNote[];
  readonly rejections: Readonly<Record<string, number>>;
}

export interface DoubleBassInput {
  readonly frame: TonalFrame;
  readonly theme: Theme;
  readonly plan: FifthPlan;
  readonly others: FifthOthers;
  readonly range: readonly [number, number];
  readonly levels: readonly DoubleBassLevel[];
  readonly energyByBar: readonly number[];
  readonly seed: number;
}

export interface DoubleBassResult {
  readonly notes: readonly DoubleBassNote[];
  readonly spans: readonly DoubleBassSpanWriting[];
  readonly thematic: readonly DoubleBassThematicEntry[];
}

interface Draft { tick: number; duration: number; pitch: number; role: DoubleBassRole; fn: BassFunction; cell: string | null; themeIndex: number | null }
interface Segment { readonly tick: number; readonly end: number; readonly chord: HarmonicChord }

/** A small, stable number in [0, 1) from a few integers: breaks ties differently from take to take, never randomly. */
const jitter = (...parts: number[]): number => {
  let h = 2166136261;
  for (const p of parts) { h ^= (p | 0) + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return ((h >>> 0) % 1000) / 1000;
};

export function composeDoubleBass(input: DoubleBassInput): DoubleBassResult {
  const { frame, others, range } = input;
  const beat = frame.beatTicks;
  const bar = frame.barTicks;
  const [low, high] = range;

  const segmentsOf = (from: number, to: number): Segment[] => {
    const cuts = new Set<number>([from, to]);
    for (let t = Math.ceil(from / bar) * bar; t < to; t += bar) if (t > from) cuts.add(t);
    for (const c of frame.harmony.chords) if (c.fact.startTick > from && c.fact.startTick < to) cuts.add(c.fact.startTick);
    const sorted = [...cuts].sort((a, b) => a - b);
    const out: Segment[] = [];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const chord = chordAt(frame, sorted[i]);
      if (chord) out.push({ tick: sorted[i], end: sorted[i + 1], chord });
    }
    return out;
  };
  /** The highest pitch a note may take there: the instrument's ceiling, or the lowest note sounding above (a unison is allowed). */
  const roof = (tick: number, duration: number): number => Math.min(high, lowestHeard(frame, others, tick, duration) ?? high);
  const isChordTone = (chord: HarmonicChord, pitch: number): boolean => chord.fact.pitchClasses.includes(mod12(pitch));
  const registerCost = (pitch: number): number => (pitch > DOUBLE_BASS.bestRegister[1] ? 0.25 * (pitch - DOUBLE_BASS.bestRegister[1]) : 0);
  /** The pitch for a given pitch class: under the roof where one exists, near the note before, in the register that carries. */
  const place = (pc: number, near: number | null, top: number): number => {
    const all: number[] = [];
    for (let p = low; p <= high; p++) if (mod12(p) === pc) all.push(p);
    const under = all.filter((p) => p <= top);
    const pool = under.length ? under : all.slice(0, 1);
    const from = near ?? 34;
    return [...pool].sort((a, b) => (Math.abs(a - from) + 2 * registerCost(a)) - (Math.abs(b - from) + 2 * registerCost(b)) || a - b)[0];
  };
  /**
   * The same, where the note before is known: an octave that would run in parallel fifths or octaves with another
   * voice, or make a leap a bass does not make, is passed over; null when no octave is left.
   */
  const placeAfter = (pc: number, before: Draft | null, tick: number, top: number, count: (why: string) => void): number | null => {
    const joined = before && before.tick + before.duration === tick ? before : null;
    if (!joined) {
      let any = false;
      for (let p = low; p <= Math.min(high, top); p++) if (mod12(p) === pc) any = true;
      if (!any) { count('no octave of the bass lies under the lowest note sounding with it'); return null; }
      return place(pc, before?.pitch ?? null, top);
    }
    const all: number[] = [];
    for (let p = low; p <= Math.min(high, top); p++) if (mod12(p) === pc) all.push(p);
    if (!all.length) { count('no octave of the bass lies under the lowest note sounding with it'); return null; }
    const faulty = (p: number): 0 | 1 | 2 => {
      const parallel = parallelOf(others, joined.tick, joined.pitch, tick, p);
      if (!parallel || (parallel.interval === 'octaves' && parallel.against === 'cello')) return 0;
      return parallel.against === 'first' ? 2 : 1;
    };
    const reachable = all.filter((p) => doubleBassMove(p - joined.pitch) !== null);
    const clean = reachable.filter((p) => faulty(p) === 0);
    // the harmony's own bass may run in parallel with an inner voice where no other octave is free; never with the leading voice
    const given = reachable.filter((p) => faulty(p) === 1);
    if (!clean.length && given.length) count('the harmony\'s bass runs in parallel with an inner voice: no other octave was free');
    const sound = clean.length ? clean : given;
    if (!sound.length) { count('a bass that could only be reached in parallel with the leading voice, or by a leap a bass does not make'); return null; }
    return [...sound].sort((a, b) => (Math.abs(a - joined.pitch) + 2 * registerCost(a)) - (Math.abs(b - joined.pitch) + 2 * registerCost(b)) || a - b)[0];
  };
  const scalePitches = (chord: HarmonicChord): number[] => {
    const pcs = localScale(frame, chord);
    const out: number[] = [];
    for (let p = low; p <= high; p++) if (pcs.has(mod12(p)) || chord.fact.pitchClasses.includes(mod12(p))) out.push(p);
    return out;
  };
  const energyAt = (tick: number): number => Math.max(0, Math.min(1, input.energyByBar[Math.min(input.energyByBar.length - 1, Math.floor(tick / bar))] ?? 0.5));
  const celloAttacks = new Set(others.cello.map((n) => n.tick));

  /* long tones: the bass of every chord; the same bass is held on, up to the longest tone */
  const foundation = (from: number, to: number, near: Draft | null, plain: boolean, role: DoubleBassRole, rejections: Record<string, number>): Draft[] => {
    const count = (why: string): void => { rejections[why] = (rejections[why] ?? 0) + 1; };
    const out: Draft[] = [];
    let before: Draft | null = near;
    for (const seg of segmentsOf(from, to)) {
      const length = seg.end - seg.tick;
      const pc = seg.chord.fact.bassPc;
      const last = out[out.length - 1];
      if (last && last.tick + last.duration === seg.tick && mod12(last.pitch) === pc && last.duration + length <= DOUBLE_BASS.longestToneBeats * beat && last.pitch <= roof(seg.tick, length)) {
        last.duration += length;
        continue;
      }
      // the plainer form leaves a harmony shorter than a minim to the voices above
      if (plain && length < 2 * beat) continue;
      if (length < DOUBLE_BASS.minBowedBeats * beat) continue;
      const pitch = placeAfter(pc, before, seg.tick, roof(seg.tick, length), count);
      // a bass that could only be reached in parallel with another voice is left to the voices above
      if (pitch === null) { count('a chord left to the voices above'); continue; }
      const note: Draft = { tick: seg.tick, duration: length, pitch, role, fn: 'chord-bass', cell: 'long', themeIndex: null };
      out.push(note);
      before = note;
    }
    return out;
  };

  /** The scale note a step from the target, on the side the line comes from. */
  const approach = (chord: HarmonicChord, target: number, from: number, tick: number): number | null => {
    const scale = scalePitches(chord);
    const above = scale.filter((p) => p > target && p - target <= 2).sort((a, b) => a - b)[0];
    const below = scale.filter((p) => p < target && target - p <= 2).sort((a, b) => b - a)[0];
    const order = from > target ? [above, below] : [below, above];
    for (const p of order) {
      if (p === undefined || p > roof(tick, beat) || p === from) continue;
      if (clashOf(frame, others, { tick, duration: beat, pitch: p, isChordBass: false, chordTone: isChordTone(chord, p) })) continue;
      if (!isChordTone(chord, p) && Math.abs(p - from) > 2) continue;
      return p;
    }
    return null;
  };
  const nextBass = (segments: readonly Segment[], i: number, to: number, near: number): number | null => {
    const next = segments[i + 1]?.chord ?? chordAt(frame, to);
    if (!next) return null;
    const tick = segments[i + 1]?.tick ?? to;
    return place(next.fact.bassPc, near, roof(tick, beat));
  };

  /* root and fifth: the bass on the bar, its fifth (or octave) in the middle of it; now and then a step that leads on */
  const rootFifth = (span: FifthSpan, from: number, to: number, near: Draft | null, plucked: boolean, sparse: boolean, rejections: Record<string, number>): Draft[] => {
    const count = (why: string): void => { rejections[why] = (rejections[why] ?? 0) + 1; };
    const out: Draft[] = [];
    const role: DoubleBassRole = plucked ? 'plucked' : 'root-fifth';
    const segments = segmentsOf(from, to);
    let before: number | null = near?.pitch ?? null;
    segments.forEach((seg, i) => {
      const length = seg.end - seg.tick;
      const beats = length / beat;
      // plucked notes ring out and are not joined: only a bowed bass is checked against the note before
      const joined: Draft | null = plucked ? null : out[out.length - 1] ?? near;
      const found = placeAfter(seg.chord.fact.bassPc, joined ?? (before === null ? null : { tick: -1, duration: 0, pitch: before, role, fn: 'chord-bass', cell: null, themeIndex: null }), seg.tick, roof(seg.tick, Math.min(length, 2 * beat)), count);
      if (found === null) { count('a chord left to the voices above'); return; }
      const root = found;
      if (sparse) {
        if (seg.tick % bar === 0) { out.push({ tick: seg.tick, duration: plucked ? beat : length, pitch: root, role, fn: 'chord-bass', cell: 'bar', themeIndex: null }); before = root; }
        return;
      }
      if (beats < 4 || !Number.isInteger(beats)) {
        if (length >= beat) { out.push({ tick: seg.tick, duration: plucked ? beat : length, pitch: root, role, fn: 'chord-bass', cell: 'bass', themeIndex: null }); before = root; }
        return;
      }
      const half = seg.tick + 2 * beat;
      const rootPc = seg.chord.fact.rootPc;
      const top = roof(half, 2 * beat);
      // the answer in the middle of the bar: the fifth where the chord has one over its own root, else the octave
      const answers: number[] = [];
      if (seg.chord.fact.bassPc === rootPc && seg.chord.fact.pitchClasses.includes(mod12(rootPc + 7))) answers.push(root - 5, root + 7);
      answers.push(root + 12, root - 12);
      const answer = answers.find((p) => p >= low && p <= top
        && !clashOf(frame, others, { tick: half, duration: 2 * beat, pitch: p, isChordBass: false, chordTone: true })
        && !parallelOf(others, seg.tick, root, half, p));
      const target = nextBass(segments, i, to, answer ?? root);
      // every other bar, where the next bass lies a third or more away, the last beat leads on by step
      const leads = target !== null && Math.abs(target - root) >= 3 && (i + span.index + Math.floor(jitter(input.seed, seg.tick) * 2)) % 2 === 0;
      const lead = leads && target !== null ? approach(seg.chord, target, answer ?? root, seg.end - beat) : null;
      const cell = lead !== null ? 'bass-answer-lead' : answer !== undefined ? 'bass-answer' : 'bass-rest';
      out.push({ tick: seg.tick, duration: plucked ? beat : 2 * beat, pitch: root, role, fn: 'chord-bass', cell, themeIndex: null });
      before = root;
      if (answer !== undefined) {
        out.push({ tick: half, duration: plucked ? beat : lead !== null ? beat : 2 * beat, pitch: answer, role, fn: 'chord-tone', cell, themeIndex: null });
        before = answer;
      }
      if (lead !== null) {
        out.push({ tick: seg.end - beat, duration: beat, pitch: lead, role, fn: isChordTone(seg.chord, lead) ? 'chord-tone' : 'passing', cell, themeIndex: null });
        before = lead;
      }
    });
    return out;
  };

  /* a moving bass: the harmony's bass where a chord begins, and between two basses the best line the rules allow */
  const moving = (from: number, to: number, nearNote: Draft | null, rejections: Record<string, number>): { notes: Draft[]; rhythm: string[] } | null => {
    const reject = (why: string): void => { rejections[why] = (rejections[why] ?? 0) + 1; };
    const near = nearNote?.pitch ?? null;
    const segments = segmentsOf(from, to);
    if (!segments.length) return null;
    interface Slot { tick: number; duration: number; anchor: boolean; strong: boolean; chord: HarmonicChord; cell: string }
    const slots: Slot[] = [];
    const rhythm: string[] = [];
    let lastCell = '';
    for (const seg of segments) {
      const beats = (seg.end - seg.tick) / beat;
      const cells = Number.isInteger(beats) ? DOUBLE_BASS_MOVING_CELLS[beats] : undefined;
      if (!cells) {
        if (seg.end - seg.tick >= beat) slots.push({ tick: seg.tick, duration: seg.end - seg.tick, anchor: true, strong: true, chord: seg.chord, cell: 'long' });
        rhythm.push('one note');
        lastCell = 'long';
        continue;
      }
      // the rhythm: the one that strikes least together with the Cello (the first note apart), is not the bar before again, and suits the energy
      const energy = energyAt(seg.tick);
      const scored = cells.map((cell, order) => {
        let together = 0;
        let t = seg.tick;
        cell.lengths.forEach((l, k) => { if (k > 0 && celloAttacks.has(t)) together++; t += l * beat; });
        const busy = cell.lengths.length / beats;
        return { cell, score: together + (cell.id === lastCell ? 0.7 : 0) + Math.abs(busy - (0.35 + 0.6 * energy)) + 0.3 * jitter(input.seed, seg.tick, order) };
      }).sort((a, b) => a.score - b.score);
      const chosen = scored[0].cell;
      rhythm.push(chosen.name);
      lastCell = chosen.id;
      let t = seg.tick;
      chosen.lengths.forEach((l, k) => {
        const offset = (t - Math.floor(t / bar) * bar) / beat;
        slots.push({ tick: t, duration: l * beat, anchor: k === 0, strong: k === 0 || (frame.beatsPerBar % 2 === 0 && offset === frame.beatsPerBar / 2), chord: seg.chord, cell: chosen.id });
        t += l * beat;
      });
    }
    if (!slots.length) return null;
    // the note after the stretch, where a chord goes on: the line is led into it
    const after = chordAt(frame, to);
    const afterPitch = (prev: number): number | null => (after ? place(after.fact.bassPc, prev, roof(to, beat)) : null);

    const candidates = slots.map((slot) => {
      const top = roof(slot.tick, slot.duration);
      if (slot.anchor) {
        const pc = slot.chord.fact.bassPc;
        const all: number[] = [];
        for (let p = low; p <= high; p++) if (mod12(p) === pc) all.push(p);
        const under = all.filter((p) => p <= top);
        if (!under.length) reject('no octave of the bass lies under the lowest note sounding with it');
        return under;
      }
      return scalePitches(slot.chord).filter((p) => {
        if (p > top) { reject('above the lowest note sounding with it'); return false; }
        const tone = isChordTone(slot.chord, p);
        if (!tone && (slot.strong || slot.duration > beat)) { reject('foreign to the chord on a strong beat or longer than a beat'); return false; }
        if (clashOf(frame, others, { tick: slot.tick, duration: slot.duration, pitch: p, isChordBass: false, chordTone: tone })) { reject('a semitone held against a chord tone of another voice'); return false; }
        return true;
      });
    });
    // best line: cost so far and the choice before, per slot and candidate
    const INF = Number.POSITIVE_INFINITY;
    const cost: number[][] = candidates.map((c) => c.map(() => INF));
    const back: number[][] = candidates.map((c) => c.map(() => -1));
    const tone = (i: number, p: number): boolean => slots[i].anchor || isChordTone(slots[i].chord, p);
    candidates[0].forEach((p, k) => {
      const parallel = nearNote ? parallelOf(others, nearNote.tick, nearNote.pitch, slots[0].tick, p) : null;
      cost[0][k] = registerCost(p) + (near === null ? Math.abs(p - 34) * 0.05 : (doubleBassMove(p - near) ?? 3)) + (parallel && (parallel.interval === 'fifths' || parallel.against !== 'cello') ? 4 : 0);
    });
    for (let i = 1; i < slots.length; i++) {
      candidates[i].forEach((p, k) => {
        candidates[i - 1].forEach((q, j) => {
          if (cost[i - 1][j] === INF) return;
          const move = doubleBassMove(p - q);
          if (move === null) { reject('a leap the bass does not make'); return; }
          const step = Math.abs(p - q) <= 2 && p !== q;
          if (!tone(i - 1, q) && !step) { reject('a passing note not left by step'); return; }
          if (!tone(i, p) && !step) { reject('a passing note not reached by step'); return; }
          const parallel = parallelOf(others, slots[i - 1].tick, q, slots[i].tick, p);
          let extra = 0;
          if (parallel) {
            const celloOctave = parallel.interval === 'octaves' && parallel.against === 'cello';
            // a note the Double Bass chooses never runs in parallel; the harmony's own bass may, with an inner voice, at a price
            if (!celloOctave && (!slots[i].anchor || parallel.against === 'first')) { reject(`parallel ${parallel.interval} with another voice`); return; }
            extra += celloOctave ? (slots[i].anchor ? 0.2 : 1) : 2.5;
          }
          // the same pitch class as the Cello, struck together with it: the octave doubling this voice is not for
          if (!slots[i].anchor && others.cello.some((n) => n.tick === slots[i].tick && mod12(n.pitch) === mod12(p))) extra += 0.6;
          // a note foreign to the chord is the detail that makes the line a line: no cost of its own
          const total = cost[i - 1][j] + move + registerCost(p) + extra + (slots[i].anchor ? 0 : 0.05 * jitter(input.seed, slots[i].tick, p));
          if (total < cost[i][k]) { cost[i][k] = total; back[i][k] = j; }
        });
      });
    }
    const lastIndex = slots.length - 1;
    let best = -1;
    let bestCost = INF;
    candidates[lastIndex].forEach((p, k) => {
      if (cost[lastIndex][k] === INF) return;
      const next = afterPitch(p);
      let total = cost[lastIndex][k];
      if (next !== null) {
        const move = doubleBassMove(next - p);
        const step = Math.abs(next - p) <= 2 && next !== p;
        if (!tone(lastIndex, p) && !step) return;
        const parallel = parallelOf(others, slots[lastIndex].tick, p, to, next);
        if (parallel && !(parallel.interval === 'octaves' && parallel.against === 'cello')) { reject(`parallel ${parallel.interval} with another voice into the next stretch`); total += 4; }
        total += move === null ? 3 : move;
      } else if (!tone(lastIndex, p)) return;
      if (total < bestCost) { bestCost = total; best = k; }
    });
    if (best < 0) { reject('no line connects the basses of this stretch'); return null; }
    const chosen: number[] = new Array(slots.length).fill(0);
    for (let i = lastIndex, k = best; i >= 0; i--) { chosen[i] = candidates[i][k]; k = back[i][k]; }
    return {
      rhythm,
      notes: slots.map((slot, i) => ({
        tick: slot.tick, duration: slot.duration, pitch: chosen[i], role: 'moving' as DoubleBassRole,
        fn: (slot.anchor ? 'chord-bass' : isChordTone(slot.chord, chosen[i]) ? 'chord-tone' : 'passing') as BassFunction,
        cell: slot.cell, themeIndex: null,
      })),
    };
  };

  /* the thematic response: the theme's head, its moves kept, its notes twice as long */
  const FACTOR = 2;
  const head = input.theme.notes.slice(0, input.theme.headCount);
  const headSteps = head.slice(1).map((n, i) => n.step - head[i].step);
  const headPlain = head.length >= 3 && head.every((n) => n.alter === 0);
  const scalePcs = frame.scale.map((s) => mod12(frame.key + s));
  /** The pitch a number of scale steps from another; null when the start is not a note of the scale. */
  const stepsFrom = (pitch: number, steps: number): number | null => {
    let degree = scalePcs.indexOf(mod12(pitch));
    if (degree < 0) return null;
    let p = pitch;
    for (let k = 0; k < Math.abs(steps); k++) {
      const next = (degree + (steps > 0 ? 1 : 6)) % 7;
      const d = steps > 0 ? mod12(scalePcs[next] - scalePcs[degree]) : -mod12(scalePcs[degree] - scalePcs[next]);
      p += d;
      degree = next;
    }
    return p;
  };
  const response = (from: number, to: number, count: number, rejections: Record<string, number>): { notes: Draft[]; entry: Omit<DoubleBassThematicEntry, 'span'> } | null => {
    const reject = (why: string): void => { rejections[why] = (rejections[why] ?? 0) + 1; };
    if (!headPlain) { reject('the theme\'s head has a chromatic note or fewer than three notes'); return null; }
    const steps = headSteps.slice(0, count - 1);
    const lengths = head.slice(0, count).map((n, i) => FACTOR * ((head[i + 1]?.tick ?? input.theme.notes[head.length]?.tick ?? n.tick + n.duration) - n.tick));
    const total = lengths.reduce((a, b) => a + b, 0);
    if (lengths.some((l) => l < DOUBLE_BASS.minBowedBeats * beat)) { reject('a note shorter than a beat even in augmentation'); return null; }
    let best: { notes: Draft[]; functions: BassFunction[]; score: number } | null = null;
    for (let start = Math.ceil(from / bar) * bar; start + total <= to; start += bar) {
      const chord = chordAt(frame, start);
      if (!chord) continue;
      for (let first = low; first <= high; first++) {
        if (mod12(first) !== chord.fact.bassPc) continue;
        const pitches: number[] = [first];
        for (const s of steps) { const p = stepsFrom(pitches[pitches.length - 1], s); if (p === null) break; pitches.push(p); }
        if (pitches.length !== count) { reject('the first note is not a note of the scale'); continue; }
        if (pitches.some((p) => p < low || p > high)) { reject('out of range'); continue; }
        const notes: Draft[] = [];
        const functions: BassFunction[] = [];
        let tick = start;
        let ok = true;
        let score = registerCost(Math.max(...pitches));
        for (let i = 0; i < pitches.length && ok; i++) {
          const c = chordAt(frame, tick);
          const p = pitches[i];
          if (!c) { reject('no harmony under a note'); ok = false; break; }
          const tone = isChordTone(c, p);
          const isBass = mod12(p) === c.fact.bassPc;
          // a note foreign to the chord is the theme's own leaning note: it must fall by step onto a chord tone
          const nextChord = i + 1 < pitches.length ? chordAt(frame, tick + lengths[i]) : undefined;
          const leans = !tone && i + 1 < pitches.length && pitches[i] - pitches[i + 1] > 0 && pitches[i] - pitches[i + 1] <= 2 && !!nextChord && isChordTone(nextChord, pitches[i + 1]);
          if (!tone && !leans) { reject('a note foreign to the chord that does not resolve by step'); ok = false; break; }
          // a held note must stay a chord tone when the harmony changes under it
          for (const later of frame.harmony.chords) {
            if (later.fact.startTick > tick && later.fact.startTick < tick + lengths[i] && tone && !isChordTone(later, p)) { reject('held across a change of harmony it does not belong to'); ok = false; }
          }
          if (!ok) break;
          if (p > roof(tick, lengths[i])) { reject('above the lowest note sounding with it'); ok = false; break; }
          if (clashOf(frame, others, { tick, duration: lengths[i], pitch: p, isChordBass: isBass, chordTone: tone })) { reject('a semitone held against a chord tone of another voice'); ok = false; break; }
          if (i > 0 && parallelOf(others, tick - lengths[i - 1], pitches[i - 1], tick, p)) { reject('parallel fifths or octaves with another voice'); ok = false; break; }
          if (!isBass) score += tone ? 0.5 : 0.8;
          functions.push(isBass ? 'chord-bass' : tone ? 'chord-tone' : 'appoggiatura');
          notes.push({ tick, duration: lengths[i], pitch: p, role: 'response', fn: functions[i], cell: null, themeIndex: i });
          tick += lengths[i];
        }
        if (!ok) continue;
        score += (start - from) / bar * 0.2;
        if (!best || score < best.score) best = { notes, functions, score };
      }
    }
    if (!best) return null;
    return {
      notes: best.notes,
      entry: {
        tick: best.notes[0].tick, kind: 'head-in-augmentation', factor: FACTOR,
        themeSteps: headSteps, writtenSteps: steps, notesOfHead: count, headLength: head.length,
        themeBeats: lengths.map((l) => l / FACTOR / beat), writtenBeats: lengths.map((l) => l / beat),
        pitches: best.notes.map((n) => n.pitch), functions: best.functions,
      },
    };
  };

  /* the stretches */
  const drafts: { span: number; notes: Draft[] }[] = [];
  const spans: DoubleBassSpanWriting[] = [];
  const thematic: DoubleBassThematicEntry[] = [];
  let lastNote: Draft | null = null;
  for (const span of input.plan.spans) {
    const level = input.levels[span.index] ?? 0;
    const from = span.startTick;
    const to = Math.min(span.endTick, span.mustEndBy);
    const near: Draft | null = lastNote && lastNote.tick + lastNote.duration === from ? lastNote : null;
    const rejections: Record<string, number> = {};
    let notes: Draft[] = [];
    let wrote: DoubleBassRole = span.role;
    let decision = '';
    let rhythm: string[] = [];
    if (span.role === 'tacet') decision = 'silent by plan';
    else if (level === 2) { decision = 'silenced by the review'; wrote = 'tacet'; }
    else if (to - from < beat) { decision = 'the stretch is shorter than a beat'; wrote = 'tacet'; }
    else if (span.role === 'arrival') {
      const chord = chordAt(frame, from);
      if (!chord) { decision = 'no harmony at the arrival'; wrote = 'tacet'; }
      else {
        // the arrival tone ends where the harmony leaves it
        let end = to;
        const count = (why: string): void => { rejections[why] = (rejections[why] ?? 0) + 1; };
        const top = roof(from, Math.min(to - from, 2 * beat));
        const pitch = placeAfter(chord.fact.bassPc, near, from, top, count) ?? place(chord.fact.bassPc, near?.pitch ?? null, top);
        for (const c of frame.harmony.chords) if (c.fact.startTick > from && c.fact.startTick < end && !c.fact.pitchClasses.includes(mod12(pitch))) end = c.fact.startTick;
        if (near !== null && lastNote && lastNote.role === 'arrival' && lastNote.pitch === pitch && lastNote.duration + (end - from) <= 2 * DOUBLE_BASS.longestToneBeats * beat) {
          lastNote.duration += end - from;
          decision = 'the arrival tone goes on';
          spans.push({ span: span.index, role: span.role, wrote, level: DOUBLE_BASS_LEVEL_NAMES[level], played: true, decision, rhythm, notes: [], rejections });
          continue;
        }
        notes = [{ tick: from, duration: end - from, pitch, role: 'arrival', fn: 'chord-bass', cell: null, themeIndex: null }];
        decision = `the bass of ${chord.fact.symbol}, held ${Math.round(((end - from) / beat) * 100) / 100} beats`;
      }
    } else if (level === 1) {
      if (span.role === 'plucked') { notes = rootFifth(span, from, to, near, true, true, rejections); wrote = 'plucked'; decision = 'plainer: plucked on the bar only'; rhythm = ['the bar\'s first beat']; }
      else { notes = foundation(from, to, near, true, 'foundation', rejections); wrote = 'foundation'; decision = span.role === 'foundation' ? 'plainer: long tones, short harmonies left out' : `plainer: long tones instead of ${span.role}`; rhythm = ['long tones']; }
    } else if (span.role === 'foundation') {
      notes = foundation(from, to, near, false, 'foundation', rejections);
      decision = 'long tones on the bass of every chord';
      rhythm = ['long tones'];
    } else if (span.role === 'root-fifth' || span.role === 'plucked') {
      notes = rootFifth(span, from, to, near, span.role === 'plucked', false, rejections);
      decision = span.role === 'plucked' ? 'the bass plucked on the bar, answered in the middle of it' : 'the bass on the bar, its fifth or octave in the middle of it';
      rhythm = [...new Set(notes.map((n) => n.cell ?? ''))];
    } else if (span.role === 'moving') {
      const line = moving(from, to, near, rejections);
      if (line) { notes = line.notes; rhythm = line.rhythm; decision = 'a line connecting the basses of the chords'; }
      else { notes = foundation(from, to, near, false, 'foundation', rejections); wrote = 'foundation'; decision = 'no moving line was sound here: long tones instead'; rhythm = ['long tones']; }
    } else if (span.role === 'response') {
      // the whole head first; failing that, its opening leap and the step that answers it
      const answer = response(from, to, head.length, rejections) ?? (head.length > 3 ? response(from, to, 3, rejections) : null);
      if (answer) {
        const start = answer.notes[0].tick;
        const last = answer.notes[answer.notes.length - 1];
        const end = last.tick + last.duration;
        const before = start > from ? foundation(from, start, near, false, 'foundation', rejections) : [];
        const afterNotes = end < to ? foundation(end, to, last, false, 'foundation', rejections) : [];
        notes = [...before, ...answer.notes, ...afterNotes];
        thematic.push({ span: span.index, ...answer.entry });
        decision = `${answer.entry.notesOfHead === answer.entry.headLength ? 'the theme\'s head' : `the first ${answer.entry.notesOfHead} notes of the theme's head`} in notes twice as long, from bar ${Math.floor(start / bar) + 1}`;
        rhythm = ['the theme\'s head, doubled'];
      } else {
        notes = foundation(from, to, near, false, 'foundation', rejections);
        wrote = 'foundation';
        decision = 'the theme\'s head fitted nowhere in this stretch: long tones instead';
        rhythm = ['long tones'];
      }
    }
    if (notes.length === 0 && wrote !== 'tacet' && span.role !== 'tacet') { decision = decision ? `${decision}; nothing could be written` : 'nothing could be written'; }
    drafts.push({ span: span.index, notes });
    spans.push({ span: span.index, role: span.role, wrote: notes.length ? wrote : 'tacet', level: DOUBLE_BASS_LEVEL_NAMES[level], played: notes.length > 0, decision, rhythm, notes: [], rejections });
    if (notes.length) lastNote = notes[notes.length - 1];
  }

  // a step that leads on needs a note to lead to: one that is not followed (or was not reached) by step is left out,
  // and a bowed note before it is held through instead
  const all = drafts.flatMap((d) => d.notes.map((n) => ({ ...n, span: d.span }))).sort((a, b) => a.tick - b.tick);
  const dropped = new Set<number>();
  all.forEach((n, i) => {
    if (n.fn !== 'passing') return;
    const before = all[i - 1];
    const after = all[i + 1];
    const step = (a: number, b: number): boolean => a !== b && Math.abs(a - b) <= 2;
    const ok = !!before && !dropped.has(i - 1) && before.tick + before.duration === n.tick && step(before.pitch, n.pitch) && !!after && after.tick === n.tick + n.duration && step(n.pitch, after.pitch);
    if (ok) return;
    dropped.add(i);
    if (before && !dropped.has(i - 1) && before.tick + before.duration === n.tick && before.role !== 'plucked') before.duration += n.duration;
    const writing = spans.find((w) => w.span === n.span);
    if (writing) (writing.rejections as Record<string, number>)['a leading step with no note to lead to: left out'] = (writing.rejections['a leading step with no note to lead to: left out'] ?? 0) + 1;
  });
  // the finished line: where the bow lifts
  const flat = all.filter((_, i) => !dropped.has(i));
  const notes: DoubleBassNote[] = flat.map((n, i) => {
    const next = flat[i + 1];
    const gap = !next || next.tick > n.tick + n.duration;
    const changes = !!next && next.role !== n.role && next.role !== 'arrival' && n.role !== 'arrival';
    return { tick: n.tick, duration: n.duration, pitch: n.pitch, span: n.span, role: n.role, function: n.fn, breathAfter: gap || changes, cell: n.cell, themeIndex: n.themeIndex };
  });
  return { notes, spans: spans.map((s) => ({ ...s, notes: notes.filter((n) => n.span === s.span) })), thematic };
}

/* ------------------------------------------------------------------ */
/* the notes the instrument plays                                      */
/* ------------------------------------------------------------------ */

export interface DoubleBassWrittenNote {
  readonly note: Note;
  readonly source: DoubleBassNote;
  /** Index of the bowed gesture the note belongs to; -1 for a plucked note. */
  readonly gesture: number;
  readonly shaping: readonly string[];
}

export interface DoubleBassVoiceInput {
  readonly frame: TonalFrame;
  readonly notes: readonly DoubleBassNote[];
  /** Energy 0..1 per bar (index bar − 1). */
  readonly energyByBar: readonly number[];
  /** Strokes the instrument can trigger with a keyswitch of its own. */
  readonly triggerable: readonly string[];
}

const VELOCITY: readonly [number, number] = [30, 112];
const BAR_WEIGHT = 3;
const ARRIVAL_ACCENT = 5;
const RESPONSE_ENTRY = 4;
const PASSING_LIGHTER = 3;
const LINE_GROWTH = 5;
const ACCENTED_STROKE = 3;

/** Bowed gestures: runs of notes with no lifted bow between them; -1 for plucked notes. */
export function doubleBassGestures(notes: readonly DoubleBassNote[]): number[] {
  const out: number[] = [];
  let g = -1;
  notes.forEach((n, i) => {
    if (n.role === 'plucked') { out.push(-1); return; }
    const before = notes[i - 1];
    if (!before || before.role === 'plucked' || before.breathAfter || before.tick + before.duration !== n.tick) g++;
    out.push(g);
  });
  return out;
}

/** The goal of a gesture: of a thematic one, its highest note; of a bass line, the last note that begins a bar. */
export function doubleBassGoal(frame: TonalFrame, gesture: readonly DoubleBassNote[]): number {
  if (gesture.some((n) => n.role === 'response')) {
    const thematic = gesture.map((n, i) => ({ n, i })).filter(({ n }) => n.role === 'response');
    return thematic.reduce((a, b) => (b.n.pitch > a.n.pitch ? b : a)).i;
  }
  for (let i = gesture.length - 1; i >= 0; i--) if (gesture[i].tick % frame.barTicks === 0) return i;
  return gesture.length - 1;
}

export function writeDoubleBassVoice(input: DoubleBassVoiceInput): DoubleBassWrittenNote[] {
  const { frame, notes } = input;
  const beat = frame.beatTicks;
  const gestureOf = doubleBassGestures(notes);
  const can = (a: string): boolean => input.triggerable.includes(a);
  return notes.map((source, i) => {
    const shaping: string[] = [];
    const role = source.role as Exclude<DoubleBassRole, 'tacet'>;
    let articulation: Articulation = DOUBLE_BASS.articulation[role];
    const energy = Math.max(0, Math.min(1, input.energyByBar[Math.min(input.energyByBar.length - 1, Math.floor(source.tick / frame.barTicks))] ?? 0.5));
    let velocity = 44 + 34 * energy + DOUBLE_BASS.level[role];
    shaping.push(`${-DOUBLE_BASS.level[role]} softer than a leading voice (${role})`);
    let duration = source.duration;
    const onBar = source.tick % frame.barTicks === 0;
    const next = notes[i + 1];
    const joined = !!next && !source.breathAfter && next.tick === source.tick + source.duration && next.role !== 'plucked';
    if (role === 'plucked') {
      duration = Math.round(DOUBLE_BASS.pizzLengthBeats * beat);
      if (onBar) { velocity += BAR_WEIGHT; shaping.push('marks the bar'); }
      shaping.push('plucked: written short, left to ring');
    } else if (role === 'arrival') {
      velocity += ARRIVAL_ACCENT;
      shaping.push('the arrival is struck, then let go (see the controller curve)');
      const lift = Math.min(beat / 2, Math.round(duration / 4));
      duration -= lift;
    } else {
      const members = notes.map((n, k) => ({ n, k })).filter(({ k }) => gestureOf[k] === gestureOf[i]);
      const gesture = members.map((m) => m.n);
      const at = members.findIndex((m) => m.k === i);
      if ((role === 'moving' || role === 'response') && gesture.length >= 3) {
        const goal = doubleBassGoal(frame, gesture);
        const shape = at <= goal ? (goal === 0 ? 0 : -LINE_GROWTH + LINE_GROWTH * (at / goal)) : -LINE_GROWTH * 0.6 * ((at - goal) / Math.max(1, gesture.length - 1 - goal));
        velocity += shape;
        shaping.push(at === goal ? 'the goal of the line' : at < goal ? `grows towards the goal (${Math.round(shape)})` : `falls away from the goal (${Math.round(shape)})`);
      }
      if (source.themeIndex === 0) { velocity += RESPONSE_ENTRY; shaping.push('the thematic entry is marked'); }
      if (source.function === 'passing') { velocity -= PASSING_LIGHTER; shaping.push('a passing note: lighter'); }
      else if (source.function === 'appoggiatura') { velocity += 2; shaping.push('leaned on (the theme\'s own dissonance)'); }
      else if (onBar && source.function === 'chord-bass') { velocity += BAR_WEIGHT; shaping.push('carries the bar\'s harmony'); }
      if (role === 'root-fifth') {
        if (onBar && energy >= DOUBLE_BASS.marcatoFromEnergy && can('marcato')) {
          articulation = 'marcato';
          velocity += ACCENTED_STROKE;
          shaping.push(`accented stroke on the bar at energy ${Math.round(energy * 100) / 100}`);
        }
        const lift = Math.round(Math.min(beat / 4, duration / 4));
        duration -= lift;
        shaping.push('separate bows');
      } else if (role === 'foundation') {
        if (source.duration >= 2 * beat && energy >= DOUBLE_BASS.tremoloFromEnergy && can('tremolo')) {
          articulation = 'tremolo';
          shaping.push(`tremolo: a long tone at energy ${Math.round(energy * 100) / 100}`);
        } else if (joined && can('legato')) {
          articulation = 'legato';
          shaping.push('joined to the next tone');
        } else shaping.push('a long tone, plain bow');
        if (!joined) { const lift = Math.min(beat / 2, Math.round(duration / 4)); duration -= lift; shaping.push(`bow lifts ${lift} ticks early`); }
      } else if (!joined) {
        const lift = source.duration >= 2 * beat ? beat / 2 : Math.round(source.duration / 4);
        duration -= lift;
        shaping.push(`bow lifts ${lift} ticks early`);
      } else shaping.push('slurred into the next note');
    }
    return {
      note: { pitch: source.pitch, startTick: source.tick, durationTicks: Math.max(1, Math.round(duration)), velocity: Math.max(VELOCITY[0], Math.min(VELOCITY[1], Math.round(velocity))), articulation },
      source, gesture: gestureOf[i], shaping,
    };
  });
}
