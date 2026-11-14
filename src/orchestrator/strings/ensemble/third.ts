/**
 * Strings V1, Stage 4 — the Viola as a THIRD independently composed voice.
 *
 * The two violins are finished when this runs (Stage 2's first voice,
 * Stage 3's second). They are read here and never changed: nothing in this
 * file returns a violin note, and the review answers every finding by
 * lowering the Viola's own alternative.
 *
 *   plan together     `planThirdVoice` gives the Viola a role per stretch
 *                     from what both violins do there;
 *   compose apart     `composeViola` writes it, with the Viola's own
 *                     character (`../characters/viola`);
 *   review together   `reviewThirdVoice` reads the three voices; a stretch
 *                     with a finding is written again one level plainer
 *                     (preferred → plainer → silent). Every pass lowers one
 *                     stretch by one level and levels never rise, so the
 *                     loop ends after at most two passes per stretch.
 *
 * WHEN NO VIOLA IS WRITTEN (its classic part stays, the reason is
 * reported): no first voice on a violin; no unlocked Viola track; the
 * export cannot trigger any of the strokes the roles need; or the Viola
 * found nothing sound to play anywhere.
 *
 * ISOLATION. As in Stages 2 and 3: composed after the whole classic
 * pipeline, the voice REPLACES the notes and controller lanes of the Viola
 * track only. The lower strings (Cello, Double Bass) are still classic; the
 * Viola reads their final notes so as not to go under them, and so as to
 * know when it is the lowest string voice.
 */
import type { CcLane, Note } from '../../../shared/schema/types';
import { projectBars } from '../../../shared/schema/meter';
import { STRING_PROFILE_BY_ROLE } from '../../profiles/strings';
import { humanizeStrings } from '../../expression/humanize';
import { overlapLegato } from '../../expression/legato';
import { buildCcLanes } from '../../expression/cc';
import { STRING_INSTRUMENT_IDS, STRING_INSTRUMENT_SOURCES, buildInstrumentCapabilities, triggerableArticulations } from '../characters/capabilities';
import { VIOLA } from '../characters/viola';
import { VOICE_CHARACTER_BY_ROLE } from '../characters/voices';
import type { StringsV1Composition, StringsV1VoiceInput } from '../composition';
import type { TonalFrame } from '../material/line';
import type { StringsV1Ensemble } from './compose';
import type { SoundingNote } from './counterpoint';
import { planThirdVoice, type ThirdPlan } from './third-plan';
import { reviewThirdVoice, type ThirdFacts, type ThirdFinding } from './third-review';
import { VIOLA_LEVEL_NAMES, composeViola, writeViolaVoice, type ViolaLevel, type ViolaNote, type ViolaSpanWriting, type ViolaWrittenNote } from '../writers/viola';

export const VIOLA_ROLE = 'violas';
/** Roles whose classic notes count as "lower strings" for the Viola. */
export const LOWER_STRING_ROLES: readonly string[] = ['cellos', 'cellosBasses', 'basses'];

export interface ThirdReviewPass {
  readonly pass: number;
  readonly findings: readonly ThirdFinding[];
  readonly action: string | null;
}

export interface StringsV1ThirdVoice {
  readonly written: boolean;
  readonly reason: string | null;
  readonly viola: { readonly trackId: string; readonly name: string; readonly role: string; readonly range: readonly [number, number]; readonly singing: readonly [number, number]; readonly keyswitchZone: { readonly low: number; readonly high: number } | null; readonly triggerable: readonly string[] } | null;
  readonly plan: ThirdPlan | null;
  readonly writing: readonly ViolaSpanWriting[];
  readonly review: { readonly passes: readonly ThirdReviewPass[]; readonly unresolved: readonly ThirdFinding[]; readonly facts: ThirdFacts | null };
  /** The two violins as the Viola heard them (sounding steps). */
  readonly firstLine: readonly SoundingNote[];
  readonly secondLine: readonly SoundingNote[];
  readonly line: readonly ViolaNote[];
  readonly voiceNotes: readonly ViolaWrittenNote[];
  /** The notes on the track after humanize and legato overlap: what is exported. */
  readonly notes: readonly Note[];
  readonly cc: readonly CcLane[];
  readonly replacedClassicNotes: readonly Note[];
}

const nothing = (reason: string, partial: Partial<StringsV1ThirdVoice> = {}): StringsV1ThirdVoice => ({
  written: false, reason, viola: null, plan: null, writing: [], review: { passes: [], unresolved: [], facts: null },
  firstLine: [], secondLine: [], line: [], voiceNotes: [], notes: [], cc: [], replacedClassicNotes: [], ...partial,
});

export function composeStringsV1Viola(input: StringsV1VoiceInput, first: StringsV1Composition, duo: StringsV1Ensemble): StringsV1ThirdVoice {
  if (!first.written || !first.trackId || !first.theme || !first.frame || first.octave === null) return nothing('no first voice was written: there is nothing to write against');
  if (!duo.plan || !duo.primary) return nothing(`the two-violin plan does not exist (${duo.reason ?? 'no reason given'}): this stage adds the Viola to the two violins only`);
  const track = input.voiceTracks.find((t) => t.role === VIOLA_ROLE);
  if (!track) return nothing('the band has no unlocked Viola track');
  if (track.id === first.trackId || track.id === duo.companion?.trackId) return nothing('the Viola track already carries one of the two composed voices');
  const reserved = input.reservedTrackIds.find((r) => r.trackId === track.id);
  if (reserved) return nothing(`${track.name}: ${reserved.reason}`);
  const profile = STRING_PROFILE_BY_ROLE.get(track.role);
  const character = VOICE_CHARACTER_BY_ROLE.get(track.role);
  const instrument = STRING_INSTRUMENT_IDS.find((id) => STRING_INSTRUMENT_SOURCES[id].role === track.role);
  if (!profile || !character || !instrument) return nothing(`${track.name}: no string profile, character or export part for role "${track.role}"`);
  const capabilities = buildInstrumentCapabilities(instrument);
  const triggerable = triggerableArticulations(capabilities);
  const needed = [...new Set(Object.values(VIOLA.articulation))];
  if (!needed.some((a) => triggerable.includes(a))) return nothing(`${character.name}: the export has a keyswitch for none of ${needed.join(', ')}`);
  const range: [number, number] = [Math.max(profile.comfortable[0], capabilities.playableLow ?? profile.comfortable[0]), profile.comfortable[1]];
  const viola = { trackId: track.id, name: character.name, role: track.role, range, singing: character.singing, keyswitchZone: capabilities.keyswitchZone ?? null, triggerable: needed.filter((a) => triggerable.includes(a)) };

  const frame: TonalFrame = { ...first.frame, harmony: input.understanding.harmony };
  const firstLine = duo.primaryLine;
  const secondLine: readonly SoundingNote[] = duo.written ? duo.line : [];
  const endTick = projectBars(input.project) * frame.barTicks;

  // the lower strings, as the classic pipeline left them
  const lower = Object.entries(input.classicNotesByTrackId)
    .filter(([id]) => LOWER_STRING_ROLES.includes(input.voiceTracks.find((t) => t.id === id)?.role ?? ''))
    .flatMap(([, notes]) => notes);
  const lowerIn = (from: number, to: number): readonly Note[] => lower.filter((n) => n.startTick < to && n.startTick + n.durationTicks > from);
  const lowerStringsSoundIn = (from: number, to: number): boolean => lowerIn(from, to).length > 0;
  const lowerStringsTopIn = (from: number, to: number): number | null => {
    const inside = lowerIn(from, to);
    return inside.length ? Math.max(...inside.map((n) => n.pitch)) : null;
  };

  // plan together
  const plan = planThirdVoice({
    frame, duo: duo.plan,
    secondVoice: duo.plan.spans.map((s) => {
      const writing = duo.written ? duo.writing.find((w) => w.span === s.index) : undefined;
      return { span: s.index, relationship: s.relationship, played: !!writing?.played, side: writing?.side ?? null };
    }),
    first: firstLine, second: secondLine, viola, triggerable, lowerStringsSoundIn,
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
  const levels: ViolaLevel[] = plan.spans.map(() => 0);
  const passes: ThirdReviewPass[] = [];
  const write = () => composeViola({ frame, theme: first.theme!, plan, first: firstLine, second: secondLine, range, singing: character.singing, levels, intensityAt, lowerStringsSoundIn, lowerStringsTopIn });
  const read = (notes: readonly ViolaNote[]) => reviewThirdVoice({ frame, plan, first: firstLine, second: secondLine, viola: notes, range, lowerStringsTopIn, endTick });
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
    levels[span] = (plan.spans[span].role === 'arrival' ? 2 : levels[span] + 1) as ViolaLevel;
    passes.push({ pass, findings: review.findings, action: `stretch ${span + 1} (${plan.spans[span].role}) written again as '${VIOLA_LEVEL_NAMES[levels[span]]}' because of: ${placed[0].text}` });
    result = write();
    review = read(result.notes);
  }
  const base = { viola, plan, writing: result.spans, review: { passes, unresolved: review.findings, facts: review.facts }, firstLine, secondLine, line: result.notes };
  if (result.notes.length === 0) return nothing('the Viola found nothing sound to play in any stretch: its classic part is kept', base);
  if (review.findings.length > 0) return nothing(`the review could not clear ${review.findings.length} finding(s) by simplifying the Viola: its classic part is kept`, base);

  // the notes the instrument plays
  const voiceNotes = writeViolaVoice({ frame, notes: result.notes, energyByBar: input.arc.map((a) => a.target), primaryIntensityAt: intensityAt });
  const written = voiceNotes.map((w) => ({ ...w.note }));

  // the same expression passes the classic strings get, for this one track; it hears the violins as written
  const others = Object.entries(input.classicNotesByTrackId)
    .filter(([id]) => id !== track.id)
    .map(([id, notes]) => ({
      role: input.voiceTracks.find((t) => t.id === id)?.role ?? '',
      notes: (id === first.trackId ? first.notes : duo.written && id === duo.companion?.trackId ? duo.notes : notes).map((n) => ({ ...n })),
    }));
  const humanized = humanizeStrings({ project: input.project, template: input.template, sections: input.sections, notesByTrackId: { [track.id]: written }, otherNotes: others });
  const overlapped = overlapLegato({ project: input.project, sections: input.sections, notesByTrackId: { [track.id]: humanized[track.id] ?? written } });
  const notes = overlapped[track.id] ?? humanized[track.id] ?? written;
  // the Viola carries the tune only in the bars where it answers
  const leadBars = new Set(result.notes.filter((n) => n.role === 'reply').map((n) => Math.floor(n.tick / frame.barTicks)));
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
