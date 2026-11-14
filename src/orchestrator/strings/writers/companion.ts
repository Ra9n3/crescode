/**
 * The second voice's writer (Strings V1, Stage 3) — composes one voice that
 * listens to another. It is handed the ensemble plan (a relationship and an
 * intention per stretch) and the first voice's line, and decides for
 * itself, stretch by stretch:
 *
 *   whether to play   a stretch planned as 'listening' stays silent; in any
 *                     other stretch the voice plays only if it finds a line
 *                     that is sound on its own AND with the first voice;
 *   what material     the theme's head (imitation), the head or tail in
 *                     doubled note values, upright or turned upside down
 *                     (countermelody), the theme's opening (response), or
 *                     held chord tones (support);
 *   where to enter    the transposition and with it the register: above or
 *                     below the first voice, wherever the line is cleanest;
 *   how to end        on a stable note, with a breath, or — only for an
 *                     imitation that the next stretch continues — open.
 *
 * Every candidate is judged by the same line rules as the first voice
 * (`judgeLine`) and by the two-voice rules (`judgeTogether`). Among the
 * sound candidates the choice is made by stated weights below; they are
 * judgements, not measurements, and nothing has been calibrated by ear.
 *
 * ALTERNATIVES. Each stretch can be written at three levels: 'preferred'
 * (the planned relationship's own material), 'plainer' (a simpler form of
 * it, where one exists), 'silent'. The writer starts at the level it is
 * told; the ensemble review lowers a stretch's level when the finished
 * passage shows a conflict there.
 *
 * Deterministic: no random draw is made here; ties keep the first candidate.
 */
import type { Articulation, Note } from '../../../shared/schema/types';
import { chordAt, judgeLine, localScale, pitchClassOf, type LineNote, type TonalFrame } from '../material/line';
import type { Theme } from '../material/theme';
import { judgeTogether, soundingPitch, type MotionCount, type SoundingNote } from '../ensemble/counterpoint';
import type { EnsemblePlan, Relationship, RelationshipSpan } from '../ensemble/plan';
import { VOICE_VELOCITY } from './voice';

export type AlternativeLevel = 0 | 1 | 2;
export const ALTERNATIVE_NAMES = ['preferred', 'plainer', 'silent'] as const;

export interface CompanionNote extends SoundingNote {
  readonly span: number;
  readonly relationship: Relationship;
  /** The bow lifts after this note. */
  readonly breathAfter: boolean;
}

export interface SpanWriting {
  readonly span: number;
  readonly relationship: Relationship;
  readonly level: typeof ALTERNATIVE_NAMES[number];
  readonly played: boolean;
  /** Why the voice entered, or why it stayed silent. */
  readonly decision: string;
  /** The material chosen, in words; null when silent. */
  readonly material: string | null;
  readonly side: 'above' | 'below' | null;
  readonly notes: readonly CompanionNote[];
  /** Candidates examined, and how many were sound alone and together. */
  readonly considered: number;
  readonly sound: number;
  /** Why candidates were turned down: reason → how many. */
  readonly rejections: Readonly<Record<string, number>>;
  /** The chosen candidate's weighed parts (lower is better); null when silent. */
  readonly weighed: Readonly<Record<string, number>> | null;
  readonly motion: MotionCount | null;
  readonly sharedOnsets: number;
  /** The next-best sound candidates that were not chosen (at most three), for the record. */
  readonly runnersUp: readonly { readonly material: string; readonly total: number; readonly side: 'above' | 'below' | null; readonly notes: readonly SoundingNote[] }[];
}

export interface CompanionInput {
  readonly frame: TonalFrame;
  readonly theme: Theme;
  readonly plan: EnsemblePlan;
  /** The first voice, in sounding steps, in time order. */
  readonly primary: readonly SoundingNote[];
  /** Per phrase of the first voice: its high point as a sounding pitch. */
  readonly phrases: readonly { readonly index: number; readonly climaxTick: number; readonly climaxPitch: number }[];
  /** Writing window and singing register of the instrument that plays this voice (sounding MIDI). */
  readonly range: readonly [number, number];
  readonly singing: readonly [number, number];
  /** The level each stretch is written at (index = span index). */
  readonly levels: readonly AlternativeLevel[];
}

export interface CompanionResult {
  readonly spans: readonly SpanWriting[];
  readonly notes: readonly CompanionNote[];
}

/** How sound candidates are weighed against each other (lower total wins). Judgements, not measurements. */
export const COMPANION_WEIGHTS = {
  /** Per share of sounding time outside the instrument's singing register. */
  outsideSinging: 6,
  /** Per share of this voice's notes that begin together with a note of the first voice. */
  sharedOnsets: 4,
  /** Per share of moves made in the same direction as the first voice. */
  sameDirection: 3,
  /** Per note of the theme's material that had to be moved by a step. */
  movedNote: 2,
  /** Per place in the writer's order of preference among materials. */
  materialOrder: 1.5,
  /** Per moment an octave or unison with the first voice begins. */
  doubling: 2,
  /** Per moment the voices are more than an octave and a fifth apart. */
  wide: 0.5,
  /**
   * Per semitone the line rises above the first voice's high point of the
   * phrase: a voice that is not leading does not take the phrase's highest
   * note away from the voice that is.
   */
  aboveHighPoint: 1,
  /** Per scale step beyond a fifth between this stretch's first note and the voice's previous note. */
  joinLeap: 0.5,
  /** Taken off per share of time together spent in thirds and sixths. */
  thirdsAndSixths: 2,
} as const;

interface Candidate {
  readonly notes: readonly LineNote[];
  readonly label: string;
  readonly order: number;
  readonly moved: number;
  readonly finalStable: boolean;
}

interface Weighed {
  readonly candidate: Candidate;
  readonly notes: readonly SoundingNote[];
  readonly side: 'above' | 'below' | null;
  readonly total: number;
  readonly parts: Record<string, number>;
  readonly motion: MotionCount;
  readonly sharedOnsets: number;
}

/** Where a plain line of chord tones stands in the countermelody's order of preference: after every form of the theme. */
const PLAIN_LINE_ORDER = 4;
/** The longest a note may sound against its chord, in beats: the theme's own longest lean. */
const LONGEST_LEAN_BEATS = 1.5;

const mod = (n: number, m: number): number => ((n % m) + m) % m;
const round = (n: number): number => Math.round(n * 1000) / 1000;

export function composeCompanion(input: CompanionInput): CompanionResult {
  const { frame, theme, plan, primary } = input;
  const beat = frame.beatTicks;
  const bar = frame.barTicks;
  const pitch = (n: Pick<LineNote, 'step' | 'alter'>): number => soundingPitch(frame, n);
  const head = theme.notes.slice(0, theme.headCount).map((n) => ({ tick: n.tick, duration: n.duration, step: n.step, alter: 0 }));
  const headTicks = theme.headCount < theme.notes.length ? theme.notes[theme.headCount].tick : theme.lengthTicks;
  const tail = theme.notes.slice(theme.headCount).map((n) => ({ tick: n.tick - headTicks, duration: n.duration, step: n.step, alter: 0 }));
  const leapIndex = theme.identity.leap.fromIndex < head.length - 1 ? theme.identity.leap.fromIndex : -1;
  const barOf = (tick: number): string => {
    const b = Math.floor(tick / bar) + 1;
    const inBar = (tick % bar) / beat + 1;
    return inBar === 1 ? `bar ${b}` : `bar ${b} beat ${Math.round(inBar * 100) / 100}`;
  };

  /** A note over a chord that inflects the scale takes the inflected note (B becomes B flat over B flat major). */
  const inflect = (note: LineNote): LineNote => {
    const chord = chordAt(frame, note.tick);
    if (!chord) return note;
    const scale = localScale(frame, chord);
    if (scale.has(pitchClassOf(frame, note))) return note;
    for (const alter of [-1, 1]) if (scale.has(pitchClassOf(frame, { ...note, alter }))) return { ...note, alter };
    return note;
  };
  const place = (material: readonly LineNote[], tick: number, shift: number, moves: readonly number[] | null = null): LineNote[] =>
    material.map((n, i) => inflect({ tick: n.tick + tick, duration: n.duration, step: n.step + shift + (moves ? moves[i] : 0), alter: 0 }));
  /** Every transposition (in scale steps) at which the material lies inside the instrument's writing window. */
  const shiftsFor = (material: readonly LineNote[]): number[] => {
    const out: number[] = [];
    for (let shift = -21; shift <= 28; shift++) {
      const pitches = material.map((n) => pitch({ step: n.step + shift, alter: 0 }));
      if (Math.min(...pitches) >= input.range[0] - 1 && Math.max(...pitches) <= input.range[1] + 1) out.push(shift);
    }
    return out;
  };
  /**
   * The material as composed, and with one or two notes moved by a scale step. Protected, as in every
   * adaptation of the theme: the rhythm, the direction of every move, and the size of the leap.
   */
  const variantsOf = (material: readonly LineNote[], leap: number): number[][] => {
    const n = material.length;
    const original = material.map((note, i) => (i === 0 ? 0 : note.step - material[i - 1].step));
    const holds = (moves: readonly number[]): boolean => {
      for (let i = 1; i < n; i++) {
        const move = original[i] + moves[i] - moves[i - 1];
        if (Math.sign(move) !== Math.sign(original[i])) return false;
        if (leap >= 0 && i === leap + 1 && move !== original[i]) return false;
      }
      return true;
    };
    const out: number[][] = [new Array<number>(n).fill(0)];
    for (let i = 0; i < n; i++) for (const d of [-1, 1]) { const m = new Array<number>(n).fill(0); m[i] = d; if (holds(m)) out.push(m); }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (const d of [-1, 1]) for (const e of [-1, 1]) {
      const m = new Array<number>(n).fill(0); m[i] = d; m[j] = e; if (holds(m)) out.push(m);
    }
    return out;
  };
  const doubled = (material: readonly LineNote[]): LineNote[] => material.map((n) => ({ ...n, tick: n.tick * 2, duration: n.duration * 2 }));
  const inverted = (material: readonly LineNote[]): LineNote[] => material.map((n) => ({ ...n, step: 2 * material[0].step - n.step }));
  const lengthOf = (material: readonly LineNote[]): number => material[material.length - 1].tick + material[material.length - 1].duration;
  const fromText = (notes: readonly LineNote[]): string => {
    const first = pitch(notes[0]);
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return `from ${names[mod(first, 12)]}${Math.floor(first / 12) - 1}`;
  };
  /** How long a note sounds over chords it does not belong to. */
  const dissonantTicks = (note: LineNote): number => frame.harmony.chords.reduce((sum, chord) => {
    const overlap = Math.min(note.tick + note.duration, chord.fact.endTick) - Math.max(note.tick, chord.fact.startTick);
    return overlap > 0 && !chord.fact.pitchClasses.includes(pitchClassOf(frame, note)) ? sum + overlap : sum;
  }, 0);

  const written: CompanionNote[] = [];
  const spans: SpanWriting[] = [];

  for (const span of plan.spans) {
    const level = input.levels[span.index] ?? 0;
    const silent = (decision: string, considered = 0, rejections: Record<string, number> = {}): void => {
      spans.push({
        span: span.index, relationship: span.relationship, level: ALTERNATIVE_NAMES[level], played: false, decision, material: null, side: null,
        notes: [], considered, sound: 0, rejections, weighed: null, motion: null, sharedOnsets: 0, runnersUp: [],
      });
    };
    if (span.relationship === 'listening') { silent(`silent by plan: ${span.reason}`); continue; }
    if (level === 2) { silent('silent: the ensemble review withdrew this stretch after a conflict'); continue; }

    const next = plan.spans[span.index + 1];
    const flowsOn = span.relationship === 'imitation' && !!next && next.relationship !== 'listening' && next.startTick === span.endTick && (input.levels[next.index] ?? 0) < 2;
    const phrase = input.phrases.find((p) => p.index === span.phrase);
    const previous = written[written.length - 1];

    /* ---------------- the candidates this relationship offers ---------------- */
    const candidates: Candidate[] = [];
    const offer = (material: readonly LineNote[], leap: number, tick: number, label: string, order: number, finalStable: boolean, extend?: (notes: LineNote[]) => LineNote[][]): void => {
      for (const shift of shiftsFor(material)) {
        for (const moves of variantsOf(material, leap)) {
          const moved = moves.filter((m) => m !== 0).length;
          const base = place(material, tick, shift, moves);
          for (const notes of extend ? extend(base) : [base]) {
            candidates.push({ notes, label: `${label}, ${fromText(notes)}${moved ? `, ${moved} note${moved === 1 ? '' : 's'} moved by a step` : ''}`, order, moved, finalStable });
          }
        }
      }
    };
    const room = span.mustEndBy - span.startTick;

    if (span.relationship === 'imitation') {
      if (level === 0 && room >= headTicks) offer(head, leapIndex, span.startTick, 'the theme\'s head', 0, !flowsOn);
      if (level === 1 && leapIndex >= 0 && room >= head[leapIndex + 1].tick + beat) {
        const opening = head.slice(0, leapIndex + 2).map((n, i, all) => (i === all.length - 1 ? { ...n, duration: Math.min(room, bar) - n.tick } : n));
        offer(opening, leapIndex, span.startTick, 'the theme\'s opening leap alone, its second note held', 0, true);
      }
    } else if (span.relationship === 'countermelody') {
      // a plain line is always among the candidates; at the plainer level it is the only one
      for (const side of ['above', 'below'] as const) {
        const line = heldLine(span, 2 * beat, side, { tie: 1, step: 0, third: 1, contrary: 1.5 });
        if (line) candidates.push({ notes: line, label: `a plain line of half-bar notes ${side} the first voice, moving by step between chord tones`, order: level === 0 ? PLAIN_LINE_ORDER : 0, moved: 0, finalStable: true });
      }
      if (level === 0) {
        const materials: [LineNote[], number, string][] = [
          [doubled(head), leapIndex, 'the theme\'s head in doubled note values'],
          [inverted(doubled(head)), leapIndex, 'the theme\'s head in doubled note values, turned upside down'],
          [doubled(tail), -1, 'the theme\'s tail in doubled note values'],
          [inverted(doubled(tail)), -1, 'the theme\'s tail in doubled note values, turned upside down'],
        ];
        materials.forEach(([material, leap, label], order) => { if (material.length && lengthOf(material) <= room) offer(material, leap, span.startTick, label, order, true); });
      }
    } else if (span.relationship === 'support') {
      if (level === 0) {
        for (const side of ['below', 'above'] as const) {
          const line = heldLine(span, bar, side, { tie: 0, step: 1, third: 2.5, contrary: 0 });
          if (line) candidates.push({ notes: line, label: `held chord tones ${side} the first voice`, order: side === 'below' ? 0 : 1, moved: 0, finalStable: true });
        }
      }
    } else if (span.relationship === 'response') {
      if (level === 0) {
        // the whole head and a note to land on, when the room allows
        if (room >= headTicks + beat) {
          const landing = Math.min(2 * beat, room - headTicks);
          offer(head, leapIndex, span.startTick, 'the theme\'s head and a note to land on', 0, true, (base) => {
            const last = base[base.length - 1];
            return [-2, -1, 1, 2].map((move) => [...base, inflect({ tick: span.startTick + headTicks, duration: landing, step: last.step + move, alter: 0 })]);
          });
        }
        // the theme's opening through the note after its leap
        const upTo = Math.min(head.length - 1, leapIndex + 2);
        if (leapIndex >= 0 && room >= head[upTo].tick + beat) {
          const opening = head.slice(0, upTo + 1).map((n, i, all) => (i === all.length - 1 ? { ...n, duration: Math.min(2 * beat, room - n.tick) } : n));
          offer(opening, leapIndex, span.startTick, 'the theme\'s opening: its leap and the step that answers it', 1, true);
        }
      } else if (leapIndex >= 0 && room >= head[leapIndex + 1].tick + beat) {
        const opening = head.slice(0, leapIndex + 2).map((n, i, all) => (i === all.length - 1 ? { ...n, duration: Math.min(2 * beat, room - n.tick) } : n));
        offer(opening, leapIndex, span.startTick, 'the theme\'s leap alone', 0, true);
      }
    }

    /* ---------------- judged alone and together, then weighed ---------------- */
    const rejections: Record<string, number> = {};
    const reject = (why: string): null => { rejections[why] = (rejections[why] ?? 0) + 1; return null; };
    const weigh = (candidate: Candidate): Weighed | null => {
      const notes = candidate.notes;
      const start = notes[0].tick;
      const end = notes[notes.length - 1].tick + notes[notes.length - 1].duration;
      const pitches = notes.map(pitch);
      if (Math.min(...pitches) < input.range[0] || Math.max(...pitches) > input.range[1]) return reject('outside the instrument\'s writing window');
      if (start < span.startTick || end > span.mustEndBy) return reject('does not fit the stretch');
      const context = previous && !previous.breathAfter && previous.tick + previous.duration === start ? written.slice(-3) : [];
      const judged = judgeLine(frame, [...context, ...notes], { finalStable: candidate.finalStable });
      const from = Math.max(0, context.length - 1);
      const problem = judged.problems.find((p) => p.index >= from);
      if (problem) return reject(`its own line is not sound (${problem.text.replace(/ over .*$| into .*$| at tick .*$| of \d+ semitones$/, '')})`);
      const sounding: SoundingNote[] = notes.map((n, i) => ({ ...n, function: judged.functions[context.length + i] }));
      // long notes are this voice's own habit, so two rules the theme never needed are stated here:
      // a note does not lean on its harmony for longer than the theme's longest lean, and a long note begins as a chord tone
      for (const n of sounding) {
        if (dissonantTicks(n) > LONGEST_LEAN_BEATS * beat) return reject('a note sounds against its chord for longer than the theme ever leans');
        if (n.duration >= 2 * beat && n.function !== 'chord-tone') return reject('a long note does not begin as a chord tone');
      }
      const around = primary.filter((n) => n.tick + n.duration > start - bar && n.tick < end + bar);
      const lead = context.length ? [context[context.length - 1]] : [];
      const together = judgeTogether(frame, [...lead, ...sounding], around, { side: null });
      const conflict = together.conflicts.find((c) => c.tick >= start);
      if (conflict) return reject(`with the first voice: ${conflict.kind}`);
      const own = together.verticals.filter((v) => v.tick >= start);
      const signs = new Set(own.filter((v) => v.semitones !== 0).map((v) => Math.sign(v.semitones)));
      if (signs.size > 1) return reject('with the first voice: crossing');
      const side = signs.size === 0 ? null : signs.has(1) ? 'above' as const : 'below' as const;

      const total = notes.reduce((sum, n) => sum + n.duration, 0);
      const outside = notes.reduce((sum, n, i) => sum + (pitches[i] < input.singing[0] || pitches[i] > input.singing[1] ? n.duration : 0), 0) / total;
      const moves = together.motion.contrary + together.motion.oblique + together.motion.similar + together.motion.parallel;
      const shared = notes.filter((n) => around.some((p) => p.tick === n.tick)).length;
      const togetherTicks = own.reduce((sum, v) => sum + (v.endTick - v.tick), 0);
      const sweet = own.reduce((sum, v) => sum + (v.quality === 'imperfect' ? v.endTick - v.tick : 0), 0);
      const doublings = own.filter((v) => Math.abs(v.semitones) % 12 === 0 && (v.tick === notes[v.a - lead.length]?.tick || around[v.b].tick === v.tick)).length;
      const wide = own.filter((v) => Math.abs(v.semitones) > 19).length;
      const above = phrase ? Math.max(0, Math.max(...pitches) - phrase.climaxPitch) : 0;
      const join = previous && start - (previous.tick + previous.duration) <= bar ? Math.max(0, Math.abs(notes[0].step - previous.step) - 4) : 0;
      const parts = {
        outsideSinging: round(COMPANION_WEIGHTS.outsideSinging * outside),
        sharedOnsets: round(COMPANION_WEIGHTS.sharedOnsets * (shared / notes.length)),
        sameDirection: round(COMPANION_WEIGHTS.sameDirection * (moves ? (together.motion.similar + together.motion.parallel) / moves : 0)),
        movedNotes: COMPANION_WEIGHTS.movedNote * candidate.moved,
        materialOrder: COMPANION_WEIGHTS.materialOrder * candidate.order,
        doubling: COMPANION_WEIGHTS.doubling * doublings,
        wide: COMPANION_WEIGHTS.wide * wide,
        aboveHighPoint: round(COMPANION_WEIGHTS.aboveHighPoint * above),
        joinLeap: COMPANION_WEIGHTS.joinLeap * join,
        thirdsAndSixths: round(-COMPANION_WEIGHTS.thirdsAndSixths * (togetherTicks ? sweet / togetherTicks : 0)),
      };
      return { candidate, notes: sounding, side, total: round(Object.values(parts).reduce((sum, v) => sum + v, 0)), parts, motion: together.motion, sharedOnsets: shared };
    };

    const ranked: Weighed[] = [];
    for (const candidate of candidates) {
      const weighed = weigh(candidate);
      if (weighed) ranked.push(weighed);
    }
    // lowest weight first; an exact tie keeps the order the candidates were offered in;
    // two routes to the same notes are one candidate (the cheaper route is kept)
    const seen = new Set<string>();
    const order = ranked.map((weighed, at) => ({ weighed, at })).sort((x, y) => x.weighed.total - y.weighed.total || x.at - y.at).map((x) => x.weighed)
      .filter((w) => { const key = w.notes.map((n) => `${n.tick}:${n.duration}:${n.step}:${n.alter}`).join(','); if (seen.has(key)) return false; seen.add(key); return true; });
    const sound = order.length;
    const best: Weighed | null = order[0] ?? null;
    if (!best) {
      const top = Object.entries(rejections).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 3).map(([why, count]) => `${why} ×${count}`);
      silent(
        candidates.length === 0
          ? `silent by the writer's decision: no ${ALTERNATIVE_NAMES[level]} material fits this stretch`
          : `silent by the writer's decision: none of ${candidates.length} candidates was sound alone and with the first voice (${top.join('; ')})`,
        candidates.length, rejections,
      );
      continue;
    }
    const chosen = best;
    const before = written[written.length - 1];
    const joins = !!before && !before.breathAfter && before.tick + before.duration === chosen.notes[0].tick;
    const breath = (span.relationship === 'countermelody' || span.relationship === 'imitation') && !flowsOn;
    const notes: CompanionNote[] = chosen.notes.map((n, i) => ({ ...n, span: span.index, relationship: span.relationship, breathAfter: breath && i === chosen.notes.length - 1 }));
    written.push(...notes);
    spans.push({
      span: span.index, relationship: span.relationship, level: ALTERNATIVE_NAMES[level], played: true,
      decision: `enters at ${barOf(notes[0].tick)}${span.entrance ? ' after a silence' : joins ? ', going on from the stretch before' : ' after a breath'}: ${candidates.length} candidates examined, ${sound} sound alone and with the first voice; this one weighed least`,
      material: chosen.candidate.label, side: chosen.side, notes, considered: candidates.length, sound, rejections, weighed: chosen.parts, motion: chosen.motion, sharedOnsets: chosen.sharedOnsets,
      runnersUp: order.slice(1, 4).map((w) => ({ material: w.candidate.label, total: w.total, side: w.side, notes: w.notes })),
    });
  }

  // a held support note that stays the same into the next stretch is one note
  const merged: CompanionNote[] = [];
  for (const note of written) {
    const last = merged[merged.length - 1];
    if (last && last.relationship === 'support' && note.relationship === 'support' && last.step === note.step && last.alter === note.alter && last.tick + last.duration === note.tick) {
      merged[merged.length - 1] = { ...last, duration: last.duration + note.duration };
    } else merged.push(note);
  }
  return { spans, notes: merged };

  /**
   * A line of held chord tones through a stretch, on one side of the first voice: one note per chord
   * (and at least one per `grain`), chosen together so that the whole line moves as little — or, for a
   * plain countermelody, as smoothly — as the costs ask. Null when a stretch has a slot no chord tone fits.
   */
  function heldLine(span: RelationshipSpan, grain: number, side: 'above' | 'below', costs: { tie: number; step: number; third: number; contrary: number }): LineNote[] | null {
    const cuts = new Set<number>([span.startTick, span.mustEndBy]);
    for (let tick = Math.ceil(span.startTick / grain) * grain; tick < span.mustEndBy; tick += grain) cuts.add(tick);
    for (const chord of frame.harmony.chords) if (chord.fact.startTick > span.startTick && chord.fact.startTick < span.mustEndBy) cuts.add(chord.fact.startTick);
    const edges = [...cuts].sort((x, y) => x - y);
    // a slot shorter than a beat joins the one before it
    const slots: { tick: number; duration: number }[] = [];
    for (let i = 0; i + 1 < edges.length; i++) {
      const duration = edges[i + 1] - edges[i];
      if (duration < beat && slots.length) slots[slots.length - 1].duration += duration;
      else slots.push({ tick: edges[i], duration });
    }
    if (slots.length === 0) return null;
    interface Node { step: number; alter: number; cost: number; from: number; total: number }
    const layers: Node[][] = [];
    for (const slot of slots) {
      const over = primary.filter((n) => n.tick < slot.tick + slot.duration && n.tick + n.duration > slot.tick);
      const chords = frame.harmony.chords.filter((c) => c.fact.startTick < slot.tick + slot.duration && c.fact.endTick > slot.tick);
      const low = over.length ? Math.min(...over.map(pitch)) : null;
      const high = over.length ? Math.max(...over.map(pitch)) : null;
      const nodes: Node[] = [];
      for (let step = -14; step <= 28; step++) {
        const note = inflect({ tick: slot.tick, duration: slot.duration, step, alter: 0 });
        const p = pitch(note);
        if (p < input.range[0] || p > input.range[1]) continue;
        if (chords.length === 0 || !chords.every((c) => c.fact.pitchClasses.includes(mod(p, 12)))) continue;
        if (low !== null && high !== null) {
          if (side === 'below' && (p > low - 3 || p < low - 16)) continue;
          if (side === 'above' && (p < high + 3 || p > high + 16)) continue;
        }
        const together = judgeTogether(frame, [{ ...note, function: 'chord-tone' }], over, { side });
        if (!together.ok) continue;
        const ticks = together.verticals.reduce((sum, v) => sum + (v.endTick - v.tick), 0);
        const sweet = together.verticals.reduce((sum, v) => sum + (v.quality === 'imperfect' ? v.endTick - v.tick : 0), 0);
        const doublings = together.verticals.filter((v) => Math.abs(v.semitones) % 12 === 0).length;
        const outside = p < input.singing[0] || p > input.singing[1] ? 1 : 0;
        // a held note stays near the voice it accompanies: every semitone beyond a sixth from it counts a little
        const gap = low !== null && high !== null ? Math.max(0, (side === 'below' ? low - p : p - high) - 9) : 0;
        nodes.push({ step: note.step, alter: note.alter, cost: doublings * 1.5 + outside * 1 + gap * 0.15 - (ticks ? sweet / ticks : 0) * 2, from: -1, total: 0 });
      }
      if (nodes.length === 0) return null;
      layers.push(nodes);
    }
    layers[0].forEach((node) => { node.total = node.cost; });
    for (let i = 1; i < layers.length; i++) {
      const slot = slots[i];
      const before = slots[i - 1];
      const over = primary.filter((n) => n.tick < slot.tick + slot.duration && n.tick + n.duration > before.tick);
      const here = primary.filter((n) => n.tick < slot.tick + slot.duration && n.tick + n.duration > slot.tick);
      const direction = here.length > 1 ? Math.sign(pitch(here[here.length - 1]) - pitch(here[0])) : 0;
      for (const node of layers[i]) {
        let bestTotal = Number.POSITIVE_INFINITY;
        let bestFrom = -1;
        layers[i - 1].forEach((prior, k) => {
          if (!Number.isFinite(prior.total)) return;
          const move = node.step - prior.step;
          const size = Math.abs(move);
          if (size > 4) return;
          let cost = size === 0 ? (node.alter === prior.alter ? costs.tie : costs.step) : size === 1 ? costs.step : size === 2 ? costs.third : size === 3 ? 5 : 8;
          if (costs.contrary && move !== 0 && Math.sign(move) === direction) cost += costs.contrary;
          if (size > 0) {
            const pair = judgeTogether(frame, [
              { tick: before.tick, duration: before.duration, step: prior.step, alter: prior.alter, function: 'chord-tone' },
              { tick: slot.tick, duration: slot.duration, step: node.step, alter: node.alter, function: 'chord-tone' },
            ], over, { side });
            if (!pair.ok) return;
          }
          const total = prior.total + cost + node.cost;
          if (total < bestTotal - 1e-9) { bestTotal = total; bestFrom = k; }
        });
        node.total = bestTotal;
        node.from = bestFrom;
      }
    }
    let at = -1;
    layers[layers.length - 1].forEach((node, k) => { if (Number.isFinite(node.total) && (at < 0 || node.total < layers[layers.length - 1][at].total - 1e-9)) at = k; });
    if (at < 0) return null;
    const line: LineNote[] = [];
    for (let i = layers.length - 1; i >= 0; i--) {
      const node = layers[i][at];
      line.unshift({ tick: slots[i].tick, duration: slots[i].duration, step: node.step, alter: node.alter });
      at = node.from;
    }
    // equal neighbours are one held note
    const tied: LineNote[] = [];
    for (const note of line) {
      const last = tied[tied.length - 1];
      if (last && last.step === note.step && last.alter === note.alter) tied[tied.length - 1] = { ...last, duration: last.duration + note.duration };
      else tied.push(note);
    }
    return tied;
  }
}

/* ------------------------------------------------------------------ */
/* from the composed line to the notes the instrument plays            */
/* ------------------------------------------------------------------ */

export interface CompanionWrittenNote {
  readonly note: Note;
  readonly source: CompanionNote;
  readonly shaping: readonly string[];
}

/** How much softer than a leading voice each relationship is played (MIDI velocity). */
export const RELATIONSHIP_LEVEL: Readonly<Record<Relationship, number>> = { listening: 0, response: 0, imitation: -4, countermelody: -8, support: -14 };
const LEAN = 4;
const RELEASE = 4;

export interface CompanionVoiceInput {
  readonly frame: TonalFrame;
  readonly notes: readonly CompanionNote[];
  /** Energy 0..1 per bar (index bar − 1). */
  readonly energyByBar: readonly number[];
  /** The first voice's place in its phrase (0..1) at a tick; the second voice breathes with it. */
  readonly primaryIntensityAt: (tick: number) => number;
  readonly triggerable: readonly string[];
}

export function writeCompanionVoice(input: CompanionVoiceInput): CompanionWrittenNote[] {
  const { frame } = input;
  const connected: Articulation = input.triggerable.includes('legato') ? 'legato' : 'sustain';
  const held: Articulation = input.triggerable.includes('sustain') ? 'sustain' : connected;
  return input.notes.map((source, i) => {
    const shaping: string[] = [];
    const energy = Math.max(0, Math.min(1, input.energyByBar[Math.floor(source.tick / frame.barTicks)] ?? 0.5));
    // a voice in the foreground stands at the middle of the phrase's range; otherwise it follows the first voice
    const intensity = source.relationship === 'response' ? 0.6 : input.primaryIntensityAt(source.tick);
    let velocity = 46 + 34 * energy + 16 * (intensity - 0.6) + RELATIONSHIP_LEVEL[source.relationship];
    if (RELATIONSHIP_LEVEL[source.relationship] !== 0) shaping.push(`${-RELATIONSHIP_LEVEL[source.relationship]} softer than a leading voice (${source.relationship})`);
    const previous = input.notes[i - 1];
    if (source.function === 'appoggiatura' || source.function === 'suspension') {
      velocity += LEAN;
      shaping.push('leaned on (accented dissonance)');
    } else if (previous && previous.tick + previous.duration === source.tick && (previous.function === 'appoggiatura' || previous.function === 'suspension')) {
      velocity -= RELEASE;
      shaping.push('released (resolution)');
    }
    let duration = source.duration;
    const next = input.notes[i + 1];
    if (source.breathAfter) {
      const lift = source.duration >= 2 * frame.beatTicks ? frame.beatTicks / 2 : Math.round(source.duration / 4);
      duration -= lift;
      shaping.push(`bow lifts ${lift} ticks early`);
    } else if (next && next.tick === source.tick + source.duration && source.relationship !== 'support') {
      shaping.push('slurred into the next note');
    }
    return {
      note: {
        pitch: soundingPitch(frame, source),
        startTick: source.tick,
        durationTicks: duration,
        velocity: Math.max(VOICE_VELOCITY[0], Math.min(VOICE_VELOCITY[1], Math.round(velocity))),
        articulation: source.relationship === 'support' ? held : connected,
      },
      source,
      shaping,
    };
  });
}
