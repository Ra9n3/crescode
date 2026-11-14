/**
 * Strings V1 ensemble (Stage 3) — a SECOND independently composed voice
 * that knows the first.
 *
 * The first voice is the Stage 2 composition, taken as it is: nothing here
 * asks it to change, and nothing is handed back to it. Around it this file
 * does the three steps of the Strings V1 architecture, for two voices only:
 *
 *   plan together      `planEnsemble` states a relationship per stretch,
 *                      read from the first voice's phrases;
 *   compose apart      `composeCompanion` writes the second voice, making
 *                      its own decisions inside each stretch;
 *   review together    `reviewEnsemble` reads the passage; a stretch with a
 *                      finding is written again one level plainer
 *                      (preferred → plainer → silent). The loop is bounded:
 *                      every pass lowers one stretch by one level, so it
 *                      ends after at most two passes per stretch.
 *
 * WHICH INSTRUMENT. The second voice goes to the other violin: Violin I
 * when the first voice was given to Violin II, and the reverse. Nothing
 * here makes one of them the melody for good — the first voice's instrument
 * is chosen by the Stage 2 selection, take by take. When the first voice
 * is not on a violin, or the band has no other unlocked violin, no second
 * voice is written and the Stage 2 result stands (the reason is reported).
 *
 * ISOLATION. As in Stage 2: composed after the whole classic pipeline, the
 * voice REPLACES the notes and controller lanes of its one track. No other
 * track's notes share a pass with it.
 */
import type { CcLane, Note } from '../../../shared/schema/types';
import { projectBars } from '../../../shared/schema/meter';
import { STRING_PROFILE_BY_ROLE } from '../../profiles/strings';
import { humanizeStrings } from '../../expression/humanize';
import { overlapLegato } from '../../expression/legato';
import { buildCcLanes } from '../../expression/cc';
import { STRING_INSTRUMENT_IDS, STRING_INSTRUMENT_SOURCES, buildInstrumentCapabilities, triggerableArticulations } from '../characters/capabilities';
import { VOICE_CHARACTER_BY_ROLE } from '../characters/voices';
import type { StringsV1Composition, StringsV1VoiceInput } from '../composition';
import type { TonalFrame } from '../material/line';
import { soundingPitch, type SoundingNote } from './counterpoint';
import { planEnsemble, type EnsemblePlan } from './plan';
import { reviewEnsemble, type EnsembleFacts, type ReviewFinding } from './review';
import { ALTERNATIVE_NAMES, composeCompanion, writeCompanionVoice, type AlternativeLevel, type CompanionNote, type CompanionWrittenNote, type SpanWriting } from '../writers/companion';

/** The two roles this stage writes for. */
export const DUET_ROLES: readonly string[] = ['violins1', 'violins2'];

export interface ReviewPass {
  readonly pass: number;
  readonly findings: readonly ReviewFinding[];
  /** What was done about them; null when there was nothing to do. */
  readonly action: string | null;
}

export interface StringsV1Ensemble {
  /** False when no second voice replaced a classic part. */
  readonly written: boolean;
  /** Why not; null when written. */
  readonly reason: string | null;
  readonly primary: { readonly trackId: string; readonly name: string; readonly role: string } | null;
  readonly companion: { readonly trackId: string; readonly name: string; readonly role: string; readonly range: readonly [number, number]; readonly singing: readonly [number, number] } | null;
  readonly plan: EnsemblePlan | null;
  /** One entry per planned stretch: what the second voice decided there. */
  readonly writing: readonly SpanWriting[];
  readonly review: { readonly passes: readonly ReviewPass[]; readonly unresolved: readonly ReviewFinding[]; readonly facts: EnsembleFacts | null };
  /** The first voice in sounding steps (what the second voice listened to). */
  readonly primaryLine: readonly SoundingNote[];
  /** The second voice as composed (sounding steps), and as written for the instrument before the expression passes. */
  readonly line: readonly CompanionNote[];
  readonly voiceNotes: readonly CompanionWrittenNote[];
  /** The notes on the track after humanize and legato overlap: what is exported. */
  readonly notes: readonly Note[];
  readonly cc: readonly CcLane[];
  /** The classic part this voice replaced (a copy, for comparison only). */
  readonly replacedClassicNotes: readonly Note[];
}

const nothing = (reason: string, partial: Partial<StringsV1Ensemble> = {}): StringsV1Ensemble => ({
  written: false, reason, primary: null, companion: null, plan: null, writing: [], review: { passes: [], unresolved: [], facts: null },
  primaryLine: [], line: [], voiceNotes: [], notes: [], cc: [], replacedClassicNotes: [], ...partial,
});

export function composeStringsV1Companion(input: StringsV1VoiceInput, first: StringsV1Composition): StringsV1Ensemble {
  if (!first.written || !first.trackId || !first.theme || !first.frame || first.octave === null) return nothing('no first voice was written: there is nothing to answer');
  const primaryTrack = input.voiceTracks.find((t) => t.id === first.trackId);
  if (!primaryTrack) return nothing('the first voice\'s track is not among the band\'s string tracks');
  const primaryName = VOICE_CHARACTER_BY_ROLE.get(primaryTrack.role)?.name ?? primaryTrack.name;
  const primary = { trackId: primaryTrack.id, name: primaryName, role: primaryTrack.role };
  if (!DUET_ROLES.includes(primaryTrack.role)) {
    return nothing(`the first voice is on ${primaryName}: this stage writes a second voice only for the two violins`, { primary });
  }
  const otherRole = DUET_ROLES.find((role) => role !== primaryTrack.role)!;
  const track = input.voiceTracks.find((t) => t.role === otherRole);
  if (!track) return nothing(`the band has no unlocked ${VOICE_CHARACTER_BY_ROLE.get(otherRole)?.name ?? otherRole} track`, { primary });
  const reserved = input.reservedTrackIds.find((r) => r.trackId === track.id);
  if (reserved) return nothing(`${track.name}: ${reserved.reason}`, { primary });
  const profile = STRING_PROFILE_BY_ROLE.get(track.role);
  const character = VOICE_CHARACTER_BY_ROLE.get(track.role);
  const instrument = STRING_INSTRUMENT_IDS.find((id) => STRING_INSTRUMENT_SOURCES[id].role === track.role);
  if (!profile || !character || !instrument) return nothing(`${track.name}: no string profile, character or export part for role "${track.role}"`, { primary });
  const capabilities = buildInstrumentCapabilities(instrument);
  const triggerable = triggerableArticulations(capabilities);
  if (!triggerable.includes('legato')) return nothing(`${character.name}: the export has no legato keyswitch for this instrument`, { primary });
  const range: [number, number] = [Math.max(profile.comfortable[0], capabilities.playableLow ?? profile.comfortable[0]), profile.comfortable[1]];
  const companion = { trackId: track.id, name: character.name, role: track.role, range, singing: character.singing };

  const frame: TonalFrame = { ...first.frame, harmony: input.understanding.harmony };
  const octave = first.octave;
  // the first voice as it sounds
  const primaryLine: SoundingNote[] = first.phrases.flatMap((phrase) => phrase.notes.map((n) => ({ tick: n.tick, duration: n.duration, step: n.step + 7 * octave, alter: n.alter, function: n.function })));
  const phrases = first.phrases.map((phrase) => ({
    index: phrase.index, startTick: phrase.startTick, endTick: phrase.endTick, climaxTick: phrase.climax.tick,
    climaxPitch: soundingPitch(frame, { step: phrase.climax.step + 7 * octave, alter: 0 }),
  }));

  // plan together
  const plan = planEnsemble({ frame, theme: first.theme, phrases: first.phrases, primary, companion });
  const endTick = projectBars(input.project) * frame.barTicks;

  // compose apart, review together
  const levels: AlternativeLevel[] = plan.spans.map(() => 0);
  const passes: ReviewPass[] = [];
  let result = composeCompanion({ frame, theme: first.theme, plan, primary: primaryLine, phrases, range, singing: character.singing, levels });
  let review = reviewEnsemble({ frame, plan, primary: primaryLine, companion: result.notes, phrases, endTick });
  const limit = 2 * plan.spans.length;
  for (let pass = 1; pass <= limit; pass++) {
    const placed = review.findings.filter((f) => f.span !== null && levels[f.span] < 2).sort((x, y) => x.tick - y.tick);
    if (placed.length === 0) {
      passes.push({ pass, findings: review.findings, action: null });
      break;
    }
    const span = placed[0].span!;
    levels[span] = (levels[span] + 1) as AlternativeLevel;
    passes.push({ pass, findings: review.findings, action: `stretch ${span + 1} (${plan.spans[span].relationship}) written again as '${ALTERNATIVE_NAMES[levels[span]]}' because of: ${placed[0].text}` });
    result = composeCompanion({ frame, theme: first.theme, plan, primary: primaryLine, phrases, range, singing: character.singing, levels });
    review = reviewEnsemble({ frame, plan, primary: primaryLine, companion: result.notes, phrases, endTick });
  }
  const base = { primary, companion, plan, writing: result.spans, review: { passes, unresolved: review.findings, facts: review.facts }, primaryLine, line: result.notes };
  if (result.notes.length === 0) {
    return nothing('the second voice found nothing sound to play in any stretch: the classic part is kept', base);
  }

  // the notes the instrument plays
  const intensityAt = (tick: number): number => {
    for (const phrase of first.phrases) {
      if (tick < phrase.startTick || tick >= phrase.window.endTick) continue;
      let value = phrase.notes[0]?.intensity ?? 0.6;
      for (const n of phrase.notes) if (n.tick <= tick) value = n.intensity;
      return value;
    }
    return 0.6;
  };
  const voiceNotes = writeCompanionVoice({ frame, notes: result.notes, energyByBar: input.arc.map((a) => a.target), primaryIntensityAt: intensityAt, triggerable });
  const written = voiceNotes.map((w) => ({ ...w.note }));

  // the same expression passes the classic strings get, for this one track; it hears the first voice as written
  const others = Object.entries(input.classicNotesByTrackId)
    .filter(([id]) => id !== track.id)
    .map(([id, notes]) => ({ role: input.voiceTracks.find((t) => t.id === id)?.role ?? '', notes: (id === first.trackId ? first.notes : notes).map((n) => ({ ...n })) }));
  const humanized = humanizeStrings({ project: input.project, template: input.template, sections: input.sections, notesByTrackId: { [track.id]: written }, otherNotes: others });
  const overlapped = overlapLegato({ project: input.project, sections: input.sections, notesByTrackId: { [track.id]: humanized[track.id] ?? written } });
  const notes = overlapped[track.id] ?? humanized[track.id] ?? written;
  // the second voice carries the tune only in the bars where it answers
  const leadBars = new Set(result.notes.filter((n) => n.relationship === 'response').map((n) => Math.floor(n.tick / frame.barTicks)));
  const lanes = buildCcLanes({
    project: input.project, template: input.template, sections: input.sections, arc: input.arc,
    notesByTrackId: { [track.id]: notes },
    carrierByBar: input.carrierByBar.map((_, i) => (leadBars.has(i) ? track.id : first.trackId)),
  });

  return {
    written: true, reason: null, ...base, voiceNotes, notes, cc: lanes[track.id] ?? [],
    replacedClassicNotes: (input.classicNotesByTrackId[track.id] ?? []).map((n) => ({ ...n })),
  };
}
