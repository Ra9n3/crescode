/**
 * Strings V1, Stage 6 — the Double Bass as a FIFTH independently composed
 * voice.
 *
 * The two violins, the Viola and the Cello are finished when this runs
 * (Stages 2 to 5). They are read here and never changed: nothing in this
 * file returns a note of theirs, and the review answers every finding by
 * lowering the Double Bass's own alternative.
 *
 *   plan together     `planFifthVoice` gives the Double Bass a role per
 *                     stretch from what the four voices do there;
 *   compose apart     `composeDoubleBass` writes it, with the Double Bass's
 *                     own character (`../characters/double-bass`);
 *   review together   `reviewFifthVoice` reads the five voices; a stretch
 *                     with a finding is written again one level plainer
 *                     (preferred → plainer → silent). Every pass lowers one
 *                     stretch by one level and levels never rise, so the
 *                     loop ends after at most two passes per stretch.
 *
 * THE TRACK. The Double Bass is written onto the Double Basses desk the
 * classic pipeline has already created (Symphony, Cinematic, Hybrid
 * Studio). This stage never creates a track: a band without that desk
 * (Chamber, and Sonata and Vocal Backing, which keep their classic Cello)
 * gets no Double Bass, and the reason is reported.
 *
 * THE OLD SPLIT. The classic desk is filled by splitting the classic Cello
 * line (octave doubles and the notes under the Cello's floor). That split
 * runs earlier, on classic notes only, because every other family is
 * written against the classic strings. It never sees a V1 note: the notes
 * composed here REPLACE the desk's classic notes and controller lanes
 * wholesale, at the very end, and nothing is derived from them afterwards.
 * So the desk holds either the classic split's notes or the composed
 * Double Bass, never both.
 *
 * WHEN NO DOUBLE BASS IS WRITTEN (the desk keeps what it had, the reason is
 * reported): the Cello was not composed; the band has no Double Basses
 * desk; the desk is locked; the export cannot trigger any stroke the roles
 * need; the Double Bass found nothing sound to play; or the review could
 * not be cleared.
 *
 * EXPRESSION. The dynamic lanes are the Double Bass's own: CC1 and CC11 are
 * drawn from its gestures around the level the piece's energy gives each
 * bar — a line grows to its goal, a long tone swells late and fades, an
 * arrival is struck and let go. The shared pass supplies only the lanes
 * that are not dynamics. Note joins come from the shared legato pass; the
 * shared timing pass has no entry for the desk's role and is not applied.
 */
import type { CcLane, CcPoint, Note } from '../../../shared/schema/types';
import { projectBars } from '../../../shared/schema/meter';
import { overlapLegato } from '../../expression/legato';
import { buildCcLanes, finalizeLane } from '../../expression/cc';
import { buildInstrumentCapabilities, triggerableArticulations } from '../characters/capabilities';
import { DOUBLE_BASS, type DoubleBassRole } from '../characters/double-bass';
import type { StringsV1Composition, StringsV1VoiceInput } from '../composition';
import type { TonalFrame } from '../material/line';
import type { StringsV1Ensemble } from './compose';
import { soundingPitch, type SoundingNote } from './counterpoint';
import type { FifthOthers, Heard } from './fifth-hearing';
import { planFifthVoice, type FifthPlan } from './fifth-plan';
import { reviewFifthVoice, type FifthFacts, type FifthFinding } from './fifth-review';
import type { StringsV1FourthVoice } from './fourth';
import type { StringsV1ThirdVoice } from './third';
import {
  DOUBLE_BASS_LEVEL_NAMES, composeDoubleBass, doubleBassGestures, doubleBassGoal, writeDoubleBassVoice,
  type DoubleBassLevel, type DoubleBassNote, type DoubleBassSpanWriting, type DoubleBassThematicEntry, type DoubleBassWrittenNote,
} from '../writers/double-bass';

export const DOUBLE_BASS_TRACK_ROLE = 'basses';

export interface FifthReviewPass {
  readonly pass: number;
  readonly findings: readonly FifthFinding[];
  readonly action: string | null;
}

export interface DoubleBassExpression {
  /** One entry per bowed gesture: where it begins, where its goal lies, where it ends, and the curve it was given. */
  readonly gestures: readonly { readonly startTick: number; readonly goalTick: number; readonly endTick: number; readonly role: string; readonly shape: string; readonly notes: number; readonly depth: number }[];
  readonly ownLanes: readonly number[];
  readonly sharedLanes: readonly number[];
}

export interface DoubleBassInstrument {
  readonly trackId: string;
  readonly name: string;
  readonly role: string;
  /** The range this stage writes in. */
  readonly range: readonly [number, number];
  /** What the export profile states: its lowest playable key and its keyswitch zone. */
  readonly profilePlayableLow: number | null;
  readonly keyswitchZone: { readonly low: number; readonly high: number } | null;
  readonly triggerable: readonly string[];
  readonly notTriggerable: readonly string[];
  /** Limits and behaviour of the patch that the profile does not settle. */
  readonly uncertain: readonly string[];
}

export interface StringsV1FifthVoice {
  readonly written: boolean;
  readonly reason: string | null;
  readonly doubleBass: DoubleBassInstrument | null;
  readonly plan: FifthPlan | null;
  readonly writing: readonly DoubleBassSpanWriting[];
  readonly thematic: readonly DoubleBassThematicEntry[];
  readonly review: { readonly passes: readonly FifthReviewPass[]; readonly unresolved: readonly FifthFinding[]; readonly facts: FifthFacts | null };
  readonly line: readonly DoubleBassNote[];
  readonly voiceNotes: readonly DoubleBassWrittenNote[];
  readonly expression: DoubleBassExpression | null;
  /** The notes on the desk's track: what is exported. */
  readonly notes: readonly Note[];
  readonly cc: readonly CcLane[];
  /** The classic desk's notes (the old split's) that the composed part replaced. */
  readonly replacedClassicNotes: readonly Note[];
}

export interface FifthVoiceExtras {
  /** The Double Basses desk as the classic pipeline left it; null when the band has none. */
  readonly desk: { readonly trackId: string; readonly name: string; readonly role: string; readonly locked: boolean; readonly notes: readonly Note[] } | null;
}

/** How deep each role's gesture curve is, on the controller scale. */
export const DOUBLE_BASS_GESTURE_DEPTH: Readonly<Record<Exclude<DoubleBassRole, 'tacet'>, number>> = { response: 10, moving: 8, arrival: 7, foundation: 6, 'root-fifth': 5, plucked: 0 };
/** The controller level at energy 0 and at energy 1, before the gesture's own curve: a little under the Cello's. */
export const DOUBLE_BASS_CC_LEVEL: readonly [number, number] = [26, 80];
const CC11_LIFT = 5;
/** Where in a long tone its swell peaks (share of its length): late, as a heavy string does. */
const LONG_TONE_PEAK = 0.55;

const smooth = (t: number): number => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
/** A small, stable offset in −2..+2 from the note's own position and pitch. */
const velocityJitter = (seed: number, n: Note): number => {
  let h = (seed ^ 0x51ed270b) >>> 0;
  for (const p of [n.startTick, n.pitch, n.durationTicks]) { h ^= p + 0x9e3779b9; h = Math.imul(h, 16777619); h ^= h >>> 15; }
  return ((h >>> 0) % 5) - 2;
};

export function composeStringsV1DoubleBass(input: StringsV1VoiceInput, first: StringsV1Composition, duo: StringsV1Ensemble, third: StringsV1ThirdVoice, fourth: StringsV1FourthVoice, extras: FifthVoiceExtras): StringsV1FifthVoice {
  const nothing = (reason: string, partial: Partial<StringsV1FifthVoice> = {}): StringsV1FifthVoice => ({
    written: false, reason, doubleBass: null, plan: null, writing: [], thematic: [], review: { passes: [], unresolved: [], facts: null },
    line: [], voiceNotes: [], expression: null, notes: [], cc: [], replacedClassicNotes: [], ...partial,
  });
  if (!first.written || !first.trackId || !first.theme || !first.frame) return nothing('no first voice was written: there is nothing to write against');
  if (!duo.plan || !duo.primary) return nothing(`the two-violin plan does not exist (${duo.reason ?? 'no reason given'})`);
  if (!third.written || !third.viola) return nothing(`the Viola was not composed (${third.reason ?? 'no reason given'}): this stage adds the Double Bass to four composed voices only`);
  if (!fourth.written || !fourth.cello || !fourth.plan) return nothing(`the Cello was not composed (${fourth.reason ?? 'no reason given'}): this stage adds the Double Bass to four composed voices only, so the desk keeps its classic part`);
  const desk = extras.desk;
  if (!desk) return nothing('the band has no Double Basses desk: this stage writes onto the existing desk and never creates a track');
  if (desk.role !== DOUBLE_BASS_TRACK_ROLE) return nothing(`${desk.name}: not a Double Basses desk (role "${desk.role}")`);
  if (desk.locked) return nothing('the Double Basses desk is locked: its notes are kept');
  if ([first.trackId, duo.companion?.trackId, third.viola.trackId, fourth.cello.trackId].includes(desk.trackId)) return nothing('the Double Basses desk already carries one of the composed voices');

  const capabilities = buildInstrumentCapabilities('doubleBass');
  const triggerable: readonly string[] = triggerableArticulations(capabilities);
  const needed = [...new Set<string>([...Object.values(DOUBLE_BASS.articulation), 'marcato', 'tremolo'])];
  if (!triggerable.includes('sustain') && !triggerable.includes('legato')) return nothing(`Double Bass: the export has a keyswitch for none of ${needed.join(', ')}`);
  const range: [number, number] = [Math.max(DOUBLE_BASS.floor, capabilities.playableLow ?? DOUBLE_BASS.floor, (capabilities.keyswitchZone?.high ?? -1) + 1), DOUBLE_BASS.ceiling];
  const doubleBass: DoubleBassInstrument = {
    trackId: desk.trackId, name: 'Double Bass', role: desk.role, range,
    profilePlayableLow: capabilities.playableLow ?? null,
    keyswitchZone: capabilities.keyswitchZone ?? null,
    triggerable: needed.filter((a) => triggerable.includes(a)),
    // strokes the brief names that this instrument has no keyswitch of its own for: never written
    notTriggerable: ['staccato', 'spiccato', 'detache', 'portato'].filter((a) => !triggerable.includes(a)),
    uncertain: [
      `the profile states no upper limit for the patch; nothing above MIDI ${DOUBLE_BASS.ceiling} is written (a conservative choice, not a verified limit)`,
      `the profile states a playable low of MIDI ${capabilities.playableLow ?? 'unknown'}; nothing below MIDI ${DOUBLE_BASS.floor} (E1, the classic desk's floor) is written until the lower keys have been heard`,
      `whether the patch sounds at written pitch or an octave lower is ${capabilities.soundingPitch} (profile transposition ${capabilities.transposeSemitones}); the notes are written where the classic desk writes them`,
      ...capabilities.unverified,
    ],
  };

  const frame: TonalFrame = { ...first.frame, harmony: input.understanding.harmony };
  const heard = (line: readonly SoundingNote[]): Heard[] => line.map((n) => ({ tick: n.tick, duration: n.duration, pitch: soundingPitch(frame, n), chordTone: n.function === 'chord-tone' }));
  const others: FifthOthers = { first: heard(duo.primaryLine), second: duo.written ? heard(duo.line) : [], viola: heard(third.line), cello: heard(fourth.line) };
  const endTick = projectBars(input.project) * frame.barTicks;
  const energyByBar = input.arc.map((a) => a.target);

  // plan together
  const head = first.theme.notes.slice(0, first.theme.headCount);
  const headTicks = (first.theme.notes[first.theme.headCount]?.tick ?? first.theme.lengthTicks) - (head[0]?.tick ?? 0);
  const plan = planFifthVoice({
    barTicks: frame.barTicks, duo: duo.plan,
    cello: fourth.plan.spans.map((s) => ({ span: s.index, role: s.role, played: !!fourth.writing.find((w) => w.span === s.index)?.played })),
    energyByBar, doubleBass: { trackId: desk.trackId, name: 'Double Bass' },
    responseTicks: 2 * headTicks, triggerable,
  });

  // compose apart, review together
  const levels: DoubleBassLevel[] = plan.spans.map(() => 0);
  const passes: FifthReviewPass[] = [];
  const write = () => composeDoubleBass({ frame, theme: first.theme!, plan, others, range, levels, energyByBar, seed: input.seed });
  const read = (notes: readonly DoubleBassNote[]) => reviewFifthVoice({ frame, plan, others, bass: notes, range, keyswitchZone: capabilities.keyswitchZone ?? null, endTick });
  let result = write();
  let review = read(result.notes);
  const limit = 2 * plan.spans.length;
  for (let pass = 1; pass <= limit + 1; pass++) {
    const placed = review.findings.filter((f) => f.span !== null && levels[f.span] < 2);
    if (placed.length === 0) {
      passes.push({ pass, findings: review.findings, action: null });
      break;
    }
    const span = placed[0].span!;
    // an arrival tone has no plainer form: it is left out
    levels[span] = (plan.spans[span].role === 'arrival' ? 2 : levels[span] + 1) as DoubleBassLevel;
    passes.push({ pass, findings: review.findings, action: `stretch ${span + 1} (${plan.spans[span].role}) written again as '${DOUBLE_BASS_LEVEL_NAMES[levels[span]]}' because of: ${placed[0].text}` });
    result = write();
    review = read(result.notes);
  }
  const base = { doubleBass, plan, writing: result.spans, thematic: result.thematic, review: { passes, unresolved: review.findings, facts: review.facts }, line: result.notes };
  if (result.notes.length === 0) return nothing('the Double Bass found nothing to play in any stretch (silent by plan, or silenced by the review): the desk keeps its classic part', base);
  if (review.findings.length > 0) return nothing(`the review could not clear ${review.findings.length} finding(s) by simplifying the Double Bass: the desk keeps its classic part`, base);

  // the notes the instrument plays
  const voiceNotes = writeDoubleBassVoice({ frame, notes: result.notes, energyByBar, triggerable });
  const written: Note[] = voiceNotes.map((w) => ({ ...w.note, velocity: Math.max(1, Math.min(127, w.note.velocity + velocityJitter(input.seed, w.note))) }));
  const overlapped = overlapLegato({ project: input.project, sections: input.sections, notesByTrackId: { [desk.trackId]: written } });
  const notes = overlapped[desk.trackId] ?? written;
  const shared = buildCcLanes({
    project: input.project, template: input.template, sections: input.sections, arc: input.arc,
    notesByTrackId: { [desk.trackId]: notes },
    carrierByBar: input.carrierByBar.map(() => first.trackId),
  })[desk.trackId] ?? [];

  // the Double Bass's own dynamic curves
  const energyAt = (tick: number): number => {
    const position = tick / frame.barTicks - 0.5;
    const i = Math.floor(position);
    const value = (b: number): number => Math.max(0, Math.min(1, energyByBar[Math.max(0, Math.min(energyByBar.length - 1, b))] ?? 0.5));
    return value(i) + (value(i + 1) - value(i)) * (position - i);
  };
  const arcAt = (tick: number): number => DOUBLE_BASS_CC_LEVEL[0] + (DOUBLE_BASS_CC_LEVEL[1] - DOUBLE_BASS_CC_LEVEL[0]) * energyAt(tick);
  const gestureOf = doubleBassGestures(result.notes);
  const gestureIds = [...new Set(gestureOf.filter((g) => g >= 0))];
  const cc1: CcPoint[] = [{ tick: 0, value: arcAt(0) }];
  const cc11: CcPoint[] = [{ tick: 0, value: arcAt(0) + CC11_LIFT }];
  const gestures: { startTick: number; goalTick: number; endTick: number; role: string; shape: string; notes: number; depth: number }[] = [];
  const stepTicks = frame.beatTicks;
  for (const id of gestureIds) {
    const members = result.notes.filter((_, i) => gestureOf[i] === id);
    const start = members[0].tick;
    const last = members[members.length - 1];
    const end = last.tick + last.duration;
    const role = (members.some((n) => n.role === 'response') ? 'response' : members.find((n) => n.role !== 'arrival')?.role ?? members[0].role) as Exclude<DoubleBassRole, 'tacet'>;
    const depth = DOUBLE_BASS_GESTURE_DEPTH[role] ?? 5;
    const level = DOUBLE_BASS.level[role] / 2;
    let goal: number;
    let shape: string;
    let curve: (tick: number) => number;
    if (members.length === 1 && role === 'arrival') {
      // struck and let go: the level is highest as the note speaks and falls through its whole length
      goal = start;
      shape = 'struck, then a long diminuendo';
      curve = (tick) => depth - (2 * depth + 4) * smooth((tick - start) / Math.max(1, end - start));
    } else if (members.length === 1 || role === 'foundation') {
      // long tones: one slow swell over the whole gesture, peaking late
      goal = start + Math.round((end - start) * LONG_TONE_PEAK);
      shape = 'one slow swell, peaking late';
      curve = (tick) => (tick <= goal ? -depth + 2 * depth * smooth((tick - start) / Math.max(1, goal - start)) : depth - 2 * depth * smooth((tick - goal) / Math.max(1, end - goal)));
    } else {
      // a line: it grows to its goal note and falls away after it; an arrival at its end is the goal
      const arrival = members.findIndex((n) => n.role === 'arrival');
      const goalNote = arrival >= 0 ? members[arrival] : members[doubleBassGoal(frame, members)];
      goal = goalNote.tick;
      shape = arrival >= 0 ? 'grows into the arrival, then lets go' : 'grows to its goal, falls away after it';
      curve = (tick) => (tick <= goal ? -depth + 2 * depth * smooth(goal === start ? 1 : (tick - start) / (goal - start)) : depth - (2 * depth + 3) * smooth((tick - goal) / Math.max(1, end - goal)));
    }
    cc1.push({ tick: Math.max(0, start - 1), value: arcAt(start) + level + curve(start) });
    cc11.push({ tick: Math.max(0, start - 1), value: arcAt(start) + level + CC11_LIFT + 1.2 * curve(start) });
    for (let tick = start; tick < end; tick += stepTicks) {
      cc1.push({ tick, value: arcAt(tick) + level + curve(tick) });
      cc11.push({ tick, value: arcAt(start) + level + CC11_LIFT + 1.2 * curve(tick) });
    }
    cc1.push({ tick: end, value: arcAt(end) + level + curve(end) });
    cc11.push({ tick: end, value: arcAt(start) + level + CC11_LIFT + 1.2 * curve(end) });
    gestures.push({ startTick: start, goalTick: goal, endTick: end, role, shape, notes: members.length, depth });
  }
  // plucked notes: the bow is not on the string; the lanes rest on the piece's level
  for (const n of result.notes.filter((x) => x.role === 'plucked')) {
    cc1.push({ tick: n.tick, value: arcAt(n.tick) });
    cc11.push({ tick: n.tick, value: arcAt(n.tick) + CC11_LIFT });
  }
  const own = [finalizeLane(1, cc1, endTick), finalizeLane(11, cc11, endTick)];
  const cc: CcLane[] = [...own, ...shared.filter((l) => l.cc !== 1 && l.cc !== 11)];

  return {
    written: true, reason: null, ...base, voiceNotes,
    expression: { gestures, ownLanes: [1, 11], sharedLanes: shared.filter((l) => l.cc !== 1 && l.cc !== 11).map((l) => l.cc) },
    notes, cc, replacedClassicNotes: desk.notes.map((n) => ({ ...n })),
  };
}
