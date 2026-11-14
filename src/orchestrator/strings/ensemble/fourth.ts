/**
 * Strings V1, Stage 5 — the Cello as a FOURTH independently composed voice.
 *
 * The two violins and the Viola are finished when this runs (Stages 2, 3
 * and 4). They are read here and never changed: nothing in this file
 * returns a note of theirs, and the review answers every finding by
 * lowering the Cello's own alternative.
 *
 *   plan together     `planFourthVoice` gives the Cello a role per stretch
 *                     from what the three upper voices do there;
 *   compose apart     `composeCello` writes it, with the Cello's own
 *                     character (`../characters/cello`);
 *   review together   `reviewFourthVoice` reads the four voices; a stretch
 *                     with a finding is written again one level plainer
 *                     (preferred → plainer → silent). Every pass lowers one
 *                     stretch by one level and levels never rise, so the
 *                     loop ends after at most two passes per stretch.
 *
 * WHEN NO CELLO IS WRITTEN (its classic part stays, the reason is
 * reported): no first voice; no two-violin plan; no composed Viola; no
 * unlocked Cello track; the classic Cello track still carries notes marked
 * for the Double Bass; the export cannot trigger any stroke the roles need;
 * or the Cello found nothing sound to play anywhere.
 *
 * THE DOUBLE BASS. Stage 5 neither composes nor changes it. Where the band
 * has a separate Double Basses desk, the classic pipeline has already
 * derived it from the classic Cello line before this runs; its notes are
 * passed in read-only (`doubleBass`) and are a constraint: the Cello never
 * goes under them or holds a semitone against them. Cello notes written
 * here carry no `layer`, so no export routes them to the Double Bass part,
 * and none is copied to the desk.
 *
 * ISOLATION. The voice REPLACES the notes and controller lanes of the Cello
 * track only.
 *
 * EXPRESSION. Timing and note joins come from the same passes the other
 * strings get (`humanizeStrings`, `overlapLegato`). The dynamic lanes are
 * the Cello's own: CC1 and CC11 are drawn from each of the Cello's gestures
 * (growing to the gesture's goal, falling away after it) around the level
 * the piece's energy gives that bar. The shared pass supplies only the
 * lanes that are not dynamics (CC7 balance, CC68, CC74).
 */
import type { CcLane, CcPoint, Note } from '../../../shared/schema/types';
import { projectBars } from '../../../shared/schema/meter';
import { humanizeStrings } from '../../expression/humanize';
import { overlapLegato } from '../../expression/legato';
import { buildCcLanes, finalizeLane } from '../../expression/cc';
import { STRING_INSTRUMENT_SOURCES, buildInstrumentCapabilities, triggerableArticulations } from '../characters/capabilities';
import { CELLO, type CelloRole } from '../characters/cello';
import type { StringsV1Composition, StringsV1VoiceInput } from '../composition';
import type { TonalFrame } from '../material/line';
import type { StringsV1Ensemble } from './compose';
import type { SoundingNote } from './counterpoint';
import { planFourthVoice, type FourthPlan } from './fourth-plan';
import { reviewFourthVoice, type FourthFacts, type FourthFinding } from './fourth-review';
import type { StringsV1ThirdVoice } from './third';
import { CELLO_LEVEL_NAMES, celloGestures, composeCello, gestureGoal, writeCelloVoice, type CelloLevel, type CelloNote, type CelloSpanWriting, type CelloThematicEntry, type CelloWrittenNote } from '../writers/cello';

export const CELLO_TRACK_ROLES: readonly string[] = ['cellosBasses', 'cellos'];

export interface FourthReviewPass {
  readonly pass: number;
  readonly findings: readonly FourthFinding[];
  readonly action: string | null;
}

export interface CelloExpression {
  /** One entry per bowed gesture: where it begins, where its goal lies, where it ends, and the curve it was given. */
  readonly gestures: readonly { readonly startTick: number; readonly goalTick: number; readonly endTick: number; readonly role: string; readonly notes: number; readonly depth: number }[];
  /** Which lanes are the Cello's own and which come from the shared pass. */
  readonly ownLanes: readonly number[];
  readonly sharedLanes: readonly number[];
}

export interface StringsV1FourthVoice {
  readonly written: boolean;
  readonly reason: string | null;
  readonly cello: { readonly trackId: string; readonly name: string; readonly role: string; readonly range: readonly [number, number]; readonly keyswitchZone: { readonly low: number; readonly high: number } | null; readonly triggerable: readonly string[]; readonly notTriggerable: readonly string[] } | null;
  /** The Double Bass as this stage found it: the desk's track (or null) and how many notes it holds. Never changed here. */
  readonly doubleBass: { readonly trackId: string | null; readonly notes: number };
  readonly plan: FourthPlan | null;
  readonly writing: readonly CelloSpanWriting[];
  readonly thematic: readonly CelloThematicEntry[];
  readonly review: { readonly passes: readonly FourthReviewPass[]; readonly unresolved: readonly FourthFinding[]; readonly facts: FourthFacts | null };
  readonly line: readonly CelloNote[];
  readonly voiceNotes: readonly CelloWrittenNote[];
  readonly expression: CelloExpression | null;
  /** The notes on the track after humanize and legato overlap: what is exported. */
  readonly notes: readonly Note[];
  readonly cc: readonly CcLane[];
  readonly replacedClassicNotes: readonly Note[];
}

export interface FourthVoiceExtras {
  /** The Double Basses desk as the classic pipeline left it; null when the band has none. */
  readonly doubleBass: { readonly trackId: string; readonly notes: readonly Note[] } | null;
}

/** How deep each role's gesture curve is, on the controller scale. */
export const CELLO_GESTURE_DEPTH: Readonly<Record<Exclude<CelloRole, 'tacet'>, number>> = { theme: 12, 'bass-line': 8, foundation: 5, arrival: 5, 'plucked-bass': 0 };
/** The controller level at energy 0 and at energy 1, before the gesture's own curve. */
const CC_LEVEL: readonly [number, number] = [30, 86];
/** CC11 sits this far above CC1 at rest (the shared pass's own relation). */
const CC11_LIFT = 6;
/** After its goal a gesture falls this much further than it rose. */
const RELEASE_EXTRA = 4;

const smooth = (t: number): number => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

export function composeStringsV1Cello(input: StringsV1VoiceInput, first: StringsV1Composition, duo: StringsV1Ensemble, third: StringsV1ThirdVoice, extras: FourthVoiceExtras): StringsV1FourthVoice {
  const doubleBass = { trackId: extras.doubleBass?.trackId ?? null, notes: extras.doubleBass?.notes.length ?? 0 };
  const nothing = (reason: string, partial: Partial<StringsV1FourthVoice> = {}): StringsV1FourthVoice => ({
    written: false, reason, cello: null, doubleBass, plan: null, writing: [], thematic: [], review: { passes: [], unresolved: [], facts: null },
    line: [], voiceNotes: [], expression: null, notes: [], cc: [], replacedClassicNotes: [], ...partial,
  });
  if (!first.written || !first.trackId || !first.theme || !first.frame || first.octave === null) return nothing('no first voice was written: there is nothing to write against');
  if (!duo.plan || !duo.primary) return nothing(`the two-violin plan does not exist (${duo.reason ?? 'no reason given'}): this stage adds the Cello to the three upper voices only`);
  if (!third.written || !third.viola || !third.plan) return nothing(`the Viola was not composed (${third.reason ?? 'no reason given'}): this stage adds the Cello to three composed voices only`);
  const track = input.voiceTracks.find((t) => CELLO_TRACK_ROLES.includes(t.role));
  if (!track) return nothing('the band has no unlocked Cello track');
  if (track.id === first.trackId || track.id === duo.companion?.trackId || track.id === third.viola.trackId) return nothing('the Cello track already carries one of the composed voices');
  const classic = input.classicNotesByTrackId[track.id] ?? [];
  if (classic.some((n) => n.layer === 'cb')) return nothing('the classic Cello track still carries notes marked for the Double Bass: replacing it would take them away from the Double Bass, so its classic part is kept');
  if (extras.doubleBass && extras.doubleBass.trackId === track.id) return nothing('the Cello track is the Double Bass desk');
  const capabilities = buildInstrumentCapabilities('cello');
  if (STRING_INSTRUMENT_SOURCES.cello.role !== track.role && track.role !== 'cellos') return nothing(`${track.name}: no export part for role "${track.role}"`);
  const triggerable: readonly string[] = triggerableArticulations(capabilities);
  const needed = [...new Set<string>([...Object.values(CELLO.articulation), 'tremolo'])];
  if (!Object.values(CELLO.articulation).some((a) => triggerable.includes(a))) return nothing(`Cello: the export has a keyswitch for none of ${needed.join(', ')}`);
  const range: [number, number] = [Math.max(CELLO.floor, capabilities.playableLow ?? CELLO.floor, (capabilities.keyswitchZone?.high ?? -1) + 1), CELLO.ceiling];
  const cello = {
    trackId: track.id, name: 'Cello', role: track.role, range, keyswitchZone: capabilities.keyswitchZone ?? null,
    triggerable: needed.filter((a) => triggerable.includes(a)),
    // strokes the brief names that this instrument has no keyswitch of its own for: never written
    notTriggerable: ['staccato', 'spiccato', 'marcato'].filter((a) => !triggerable.includes(a) || a === 'marcato'),
  };

  const frame: TonalFrame = { ...first.frame, harmony: input.understanding.harmony };
  const firstLine = duo.primaryLine;
  const secondLine: readonly SoundingNote[] = duo.written ? duo.line : [];
  const violaLine: readonly SoundingNote[] = third.line;
  const endTick = projectBars(input.project) * frame.barTicks;

  // the Double Bass, as the classic pipeline left it
  const desk = extras.doubleBass?.notes ?? [];
  const deskIn = (from: number, to: number): readonly Note[] => desk.filter((n) => n.startTick < to && n.startTick + n.durationTicks > from);
  // the desk's notes are humanized: a note that merely touches the window's edge does not count
  const EDGE = Math.round(frame.beatTicks / 8);
  const doubleBassTopIn = (from: number, to: number): number | null => {
    const inside = deskIn(from + EDGE, to - EDGE);
    return inside.length ? Math.max(...inside.map((n) => n.pitch)) : null;
  };
  const doubleBassPcsIn = (from: number, to: number): readonly number[] => [...new Set(deskIn(from + EDGE, to - EDGE).map((n) => ((n.pitch % 12) + 12) % 12))];

  // plan together
  const plan = planFourthVoice({
    frame, duo: duo.plan,
    upper: duo.plan.spans.map((s) => {
      const second = duo.written ? duo.writing.find((w) => w.span === s.index) : undefined;
      const viola = third.writing.find((w) => w.span === s.index);
      const violaPlan = third.plan!.spans.find((p) => p.index === s.index);
      return { span: s.index, secondPlayed: !!second?.played, violaRole: violaPlan?.role ?? 'tacet', violaPlayed: !!viola?.played, violaIsFloor: !!violaPlan?.lowestString };
    }),
    first: firstLine, second: secondLine, viola: violaLine, cello,
    themeTicks: first.theme.lengthTicks,
    headTicks: first.theme.notes[first.theme.headCount]?.tick ?? first.theme.lengthTicks,
    triggerable,
    doubleBassSoundsIn: (from, to) => doubleBassTopIn(from, to) !== null,
  });

  const intensityAt = (tick: number): number => {
    for (const phrase of first.phrases) {
      if (tick < phrase.startTick || tick >= phrase.window.endTick) continue;
      let value = phrase.notes[0]?.intensity ?? 0.6;
      for (const n of phrase.notes) if (n.tick <= tick) value = n.intensity;
      return value;
    }
    return 0.6;
  };

  // compose apart, review together
  const levels: CelloLevel[] = plan.spans.map(() => 0);
  const passes: FourthReviewPass[] = [];
  const write = () => composeCello({ frame, theme: first.theme!, plan, first: firstLine, second: secondLine, viola: violaLine, range, levels, intensityAt, doubleBassTopIn, doubleBassPcsIn });
  const read = (notes: readonly CelloNote[]) => reviewFourthVoice({ frame, plan, first: firstLine, second: secondLine, viola: violaLine, cello: notes, range, doubleBassTopIn, doubleBassPcsIn, endTick });
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
    // a held arrival note has no plainer form: it is left out
    levels[span] = (plan.spans[span].role === 'arrival' ? 2 : levels[span] + 1) as CelloLevel;
    passes.push({ pass, findings: review.findings, action: `stretch ${span + 1} (${plan.spans[span].role}) written again as '${CELLO_LEVEL_NAMES[levels[span]]}' because of: ${placed[0].text}` });
    result = write();
    review = read(result.notes);
  }
  const base = { cello, plan, writing: result.spans, thematic: result.thematic, review: { passes, unresolved: review.findings, facts: review.facts }, line: result.notes };
  if (result.notes.length === 0) return nothing('the Cello found nothing sound to play in any stretch: its classic part is kept', base);
  if (review.findings.length > 0) return nothing(`the review could not clear ${review.findings.length} finding(s) by simplifying the Cello: its classic part is kept`, base);

  // the notes the instrument plays
  const energyByBar = input.arc.map((a) => a.target);
  const voiceNotes = writeCelloVoice({ frame, notes: result.notes, energyByBar, primaryIntensityAt: intensityAt, triggerable });
  const written = voiceNotes.map((w) => ({ ...w.note }));

  // the same timing and joining passes the other strings get, for this one track; it hears the upper voices as written
  const others = Object.entries(input.classicNotesByTrackId)
    .filter(([id]) => id !== track.id)
    .map(([id, notes]) => ({
      role: input.voiceTracks.find((t) => t.id === id)?.role ?? '',
      notes: (id === first.trackId ? first.notes : duo.written && id === duo.companion?.trackId ? duo.notes : id === third.viola!.trackId ? third.notes : notes).map((n) => ({ ...n })),
    }));
  const humanized = humanizeStrings({ project: input.project, template: input.template, sections: input.sections, notesByTrackId: { [track.id]: written }, otherNotes: others });
  const overlapped = overlapLegato({ project: input.project, sections: input.sections, notesByTrackId: { [track.id]: humanized[track.id] ?? written } });
  const notes = overlapped[track.id] ?? humanized[track.id] ?? written;
  const leadBars = new Set(result.notes.filter((n) => n.role === 'theme').map((n) => Math.floor(n.tick / frame.barTicks)));
  const shared = buildCcLanes({
    project: input.project, template: input.template, sections: input.sections, arc: input.arc,
    notesByTrackId: { [track.id]: notes },
    carrierByBar: input.carrierByBar.map((_, i) => (leadBars.has(i) ? track.id : first.trackId)),
  })[track.id] ?? [];

  // the Cello's own dynamic curves. Their level is the energy of the piece bar by bar (the conductor's arc, read
  // directly — not the shared controller lane, whose four-bar arch belongs to the classic phrasing); their shape
  // is drawn from the Cello's own gestures.
  const energyAt = (tick: number): number => {
    const position = tick / frame.barTicks - 0.5;
    const i = Math.floor(position);
    const value = (b: number): number => Math.max(0, Math.min(1, energyByBar[Math.max(0, Math.min(energyByBar.length - 1, b))] ?? 0.5));
    return value(i) + (value(i + 1) - value(i)) * (position - i);
  };
  const arcAt = (tick: number): number => CC_LEVEL[0] + (CC_LEVEL[1] - CC_LEVEL[0]) * energyAt(tick);
  const gestureOf = celloGestures(result.notes);
  const gestureIds = [...new Set(gestureOf.filter((g) => g >= 0))];
  const cc1: CcPoint[] = [{ tick: 0, value: arcAt(0) }];
  const cc11: CcPoint[] = [{ tick: 0, value: arcAt(0) + CC11_LIFT }];
  const gestures: { startTick: number; goalTick: number; endTick: number; role: string; notes: number; depth: number }[] = [];
  const half = Math.round(frame.beatTicks / 2);
  for (const id of gestureIds) {
    const members = result.notes.filter((_, i) => gestureOf[i] === id);
    const start = members[0].tick;
    const last = members[members.length - 1];
    const end = last.tick + last.duration;
    const goalNote = members[gestureGoal(frame, members)];
    // a single held note swells a little after it speaks and then fades; a line grows to its goal
    const goal = members.length === 1 ? start + Math.min(frame.beatTicks, Math.round((end - start) / 3)) : goalNote.tick;
    const role = members.some((n) => n.role === 'theme') ? 'theme' : members.length === 1 ? members[0].role : members.find((n) => n.role !== 'arrival')?.role ?? members[0].role;
    const depth = CELLO_GESTURE_DEPTH[role as Exclude<CelloRole, 'tacet'>] ?? 4;
    const level = CELLO.level[role as CelloRole] ?? 0;
    const curve = (tick: number): number => (tick <= goal
      ? -depth + 2 * depth * smooth(goal === start ? 1 : (tick - start) / (goal - start))
      : depth - (2 * depth + RELEASE_EXTRA) * smooth((tick - goal) / Math.max(1, end - goal)));
    const restLevel = arcAt(start) + level / 2;
    cc1.push({ tick: Math.max(0, start - 1), value: arcAt(start) + level / 2 - depth });
    cc11.push({ tick: Math.max(0, start - 1), value: restLevel + CC11_LIFT - depth });
    for (let tick = start; tick <= end; tick += half) {
      cc1.push({ tick, value: arcAt(tick) + level / 2 + curve(tick) });
      cc11.push({ tick, value: restLevel + CC11_LIFT + 1.3 * curve(tick) });
    }
    cc1.push({ tick: end, value: arcAt(end) + level / 2 + curve(end) });
    cc11.push({ tick: end, value: restLevel + CC11_LIFT + 1.3 * curve(end) });
    gestures.push({ startTick: start, goalTick: goal, endTick: end, role, notes: members.length, depth });
  }
  // plucked notes: the bow is not on the string; the lanes rest on the shared arc
  for (const n of result.notes.filter((x) => x.role === 'plucked-bass')) {
    cc1.push({ tick: n.tick, value: arcAt(n.tick) });
    cc11.push({ tick: n.tick, value: arcAt(n.tick) + CC11_LIFT });
  }
  const own = [finalizeLane(1, cc1, endTick), finalizeLane(11, cc11, endTick)];
  const cc: CcLane[] = [...own, ...shared.filter((l) => l.cc !== 1 && l.cc !== 11)];

  return {
    written: true, reason: null, doubleBass, ...base, voiceNotes,
    expression: { gestures, ownLanes: [1, 11], sharedLanes: shared.filter((l) => l.cc !== 1 && l.cc !== 11).map((l) => l.cc) },
    notes, cc, replacedClassicNotes: classic.map((n) => ({ ...n })),
  };
}
