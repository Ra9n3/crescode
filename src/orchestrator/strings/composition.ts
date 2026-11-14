/**
 * Strings V1 composition (Stage 2) — ONE independently composed string
 * voice: a theme, phrases built from it, an instrument chosen for it, and
 * the notes that instrument plays.
 *
 * What this stage does not do: the other string tracks keep their classic
 * parts untouched; there is no ensemble planning, no second voice.
 *
 * ISOLATION. The voice is composed and shaped on its own, after the whole
 * classic pipeline has finished, and then REPLACES the chosen track's
 * classic notes and controller lanes. No other track's notes are handed to
 * a pass together with the V1 notes, so no other track can change.
 * The voice gets the same expression passes the classic strings get
 * (humanize, legato overlap, controller lanes), called for this one track.
 */
import type { CcLane, Note, Project, Track } from '../../shared/schema/types';
import { MODES } from '../../shared/schema/modes';
import { barTicks, beatTicks, projectBars } from '../../shared/schema/meter';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import type { ArcBar } from '../spine/energyArc';
import type { SpineSection } from '../spine';
import { STRING_PROFILE_BY_ROLE } from '../profiles/strings';
import { humanizeStrings } from '../expression/humanize';
import { overlapLegato } from '../expression/legato';
import { buildCcLanes } from '../expression/cc';
import { hashString } from '../../engine/generate';
import type { StringsUnderstanding } from './understanding';
import { STRING_INSTRUMENT_IDS, STRING_INSTRUMENT_SOURCES, buildInstrumentCapabilities, triggerableArticulations } from './characters/capabilities';
import { VOICE_CHARACTER_BY_ROLE } from './characters/voices';
import type { TonalFrame } from './material/line';
import { generateTheme, THEME_BARS, type Theme } from './material/theme';
import { planPhrases, type PhrasePlan } from './phrases/plan';
import { selectInstrument, type Selection, type SelectionCandidate } from './writers/select';
import { pitchAtOctave0, writeVoice, type WrittenNote } from './writers/voice';

export interface StringsV1VoiceInput {
  readonly project: Project;
  readonly template: EnsembleTemplate | null;
  readonly sections: SpineSection[];
  readonly arc: ArcBar[];
  readonly understanding: StringsUnderstanding;
  /** The composition seed of this take. */
  readonly seed: number;
  /** Unlocked string tracks of the band (the tracks the classic strings wrote). */
  readonly voiceTracks: readonly Track[];
  /** Tracks that must keep their classic part (e.g. a cello whose notes feed a separate bass desk). */
  readonly reservedTrackIds: readonly { readonly trackId: string; readonly reason: string }[];
  /** The classic layer per bar and track, and the classic tune carrier per bar. */
  readonly assignment: readonly { readonly bar: number; readonly byTrack: Readonly<Record<string, string>> }[];
  readonly carrierByBar: readonly (string | null)[];
  /** The FINAL classic notes per string track. Read only. */
  readonly classicNotesByTrackId: Readonly<Record<string, readonly Note[]>>;
}

export interface StringsV1Composition {
  /** False when nothing was replaced: every string track keeps its classic part. */
  readonly written: boolean;
  /** Why nothing was written; null when written. */
  readonly reason: string | null;
  readonly theme: Theme | null;
  readonly frame: Pick<TonalFrame, 'key' | 'scale' | 'barTicks' | 'beatTicks' | 'beatsPerBar'> | null;
  readonly windows: readonly { readonly startTick: number; readonly endTick: number; readonly energy: number }[];
  readonly phrases: readonly PhrasePlan[];
  readonly silentWindows: readonly { readonly startTick: number; readonly endTick: number; readonly reason: string }[];
  readonly selection: Selection | null;
  readonly trackId: string | null;
  readonly octave: number | null;
  /** The voice as written, before the expression passes (grid positions). */
  readonly voiceNotes: readonly WrittenNote[];
  readonly gestures: readonly string[];
  /** The notes on the track after humanize and legato overlap: what is exported. */
  readonly notes: readonly Note[];
  readonly cc: readonly CcLane[];
  /** The classic part this voice replaced (a copy, for comparison only). */
  readonly replacedClassicNotes: readonly Note[];
}

const nothing = (reason: string, partial: Partial<StringsV1Composition> = {}): StringsV1Composition => ({
  written: false, reason, theme: null, frame: null, windows: [], phrases: [], silentWindows: [], selection: null, trackId: null, octave: null,
  voiceNotes: [], gestures: [], notes: [], cc: [], replacedClassicNotes: [], ...partial,
});

/** The stretches the voice may sound in: each section, without the bars the conductor keeps near-silent. */
function soundingWindows(sections: readonly SpineSection[], arc: readonly ArcBar[], bar: number, bars: number): { startTick: number; endTick: number; energy: number }[] {
  const windows: { startTick: number; endTick: number; energy: number }[] = [];
  for (const section of [...sections].sort((a, b) => a.startBar - b.startBar)) {
    let run: number[] = [];
    const close = (): void => {
      if (run.length) {
        const energy = run.reduce((sum, b) => sum + Math.max(0, Math.min(1, arc[b - 1]?.target ?? 0.5)), 0) / run.length;
        windows.push({ startTick: (run[0] - 1) * bar, endTick: run[run.length - 1] * bar, energy: Math.round(energy * 1000) / 1000 });
      }
      run = [];
    };
    for (let b = section.startBar; b < section.startBar + section.lengthBars && b <= bars; b++) {
      if (arc[b - 1]?.nearSilence) close(); else run.push(b);
    }
    close();
  }
  return windows;
}

export function composeStringsV1Voice(input: StringsV1VoiceInput): StringsV1Composition {
  const { project, understanding } = input;
  const bar = barTicks(project.timeSignature);
  const beat = beatTicks(project.timeSignature);
  const bars = projectBars(project);
  if (bar % beat !== 0) return nothing(`the metre ${project.timeSignature.numerator}/${project.timeSignature.denominator} has no whole number of beats in a bar`);
  const scale = MODES[project.mode];
  if (!scale || scale.length !== 7) return nothing(`the mode "${project.mode}" is not a seven-note scale: the line rules do not cover it`);
  if (understanding.harmony.chords.length === 0) return nothing('the project has no chords: a theme needs harmony to be composed against');
  const frame: TonalFrame = { key: project.key, scale, barTicks: bar, beatTicks: beat, beatsPerBar: bar / beat, harmony: understanding.harmony };
  const frameFacts = { key: frame.key, scale: frame.scale, barTicks: bar, beatTicks: beat, beatsPerBar: frame.beatsPerBar };

  const windows = soundingWindows(input.sections, input.arc, bar, bars);
  const home = windows.find((w) => w.endTick - w.startTick >= THEME_BARS * bar);
  if (!home) return nothing(`no stretch of ${THEME_BARS} sounding bars exists for a theme`, { frame: frameFacts, windows });

  const themed = generateTheme({ frame, homeTick: home.startTick, seed: (input.seed ^ hashString('strings-v1:theme')) >>> 0 });
  if (!themed.ok) return nothing(`no theme: ${themed.reason}`, { frame: frameFacts, windows });
  const theme = themed.theme;

  const planned = planPhrases({ frame, theme, structure: understanding.structure, windows });
  const base = { theme, frame: frameFacts, windows, phrases: planned.phrases, silentWindows: planned.silentWindows };
  if (planned.phrases.length === 0) return nothing(`no phrase could be built from the theme: ${planned.silentWindows.map((w) => w.reason).join(' | ')}`, base);

  // the instrument: every unlocked string track of the band is examined
  const capabilities = STRING_INSTRUMENT_IDS.map((id) => ({ id, role: STRING_INSTRUMENT_SOURCES[id].role }));
  const reserved = new Map(input.reservedTrackIds.map((r) => [r.trackId, r.reason]));
  const candidates: SelectionCandidate[] = [];
  const skipped: string[] = [];
  for (const track of input.voiceTracks) {
    const profile = STRING_PROFILE_BY_ROLE.get(track.role);
    const character = VOICE_CHARACTER_BY_ROLE.get(track.role);
    const instrument = capabilities.find((c) => c.role === track.role);
    if (reserved.has(track.id)) { skipped.push(`${track.name}: ${reserved.get(track.id)}`); continue; }
    if (!profile || !character || !instrument) { skipped.push(`${track.name}: no string profile, character or export part for role "${track.role}"`); continue; }
    const caps = buildInstrumentCapabilities(instrument.id);
    candidates.push({
      trackId: track.id, role: track.role, name: character.name, comfortable: profile.comfortable, playableLow: caps.playableLow,
      singing: character.singing, character: character.character, triggerable: triggerableArticulations(caps),
      classicLayers: input.assignment.map((a) => a.byTrack[track.id] ?? 'tacet'),
    });
  }
  const allNotes = planned.phrases.flatMap((p) => p.notes);
  const selection = selectInstrument({
    candidates,
    line: {
      notes: allNotes.map((n) => ({ tick: n.tick, duration: n.duration, pitchAtOctave0: pitchAtOctave0(frame, n) })),
      bars: [...new Set(allNotes.flatMap((n) => { const out: number[] = []; for (let b = Math.floor(n.tick / bar); b * bar < n.tick + n.duration; b++) out.push(b + 1); return out; }))],
    },
    carrierByBar: input.carrierByBar,
    classicNotesByTrackId: input.classicNotesByTrackId,
  });
  const chosen = selection.chosen;
  if (!chosen || chosen.octave === null) {
    return nothing(`${selection.reason}${skipped.length ? ` (not examined: ${skipped.join('; ')})` : ''}`, { ...base, selection });
  }
  const candidate = candidates.find((c) => c.trackId === chosen.trackId)!;

  const voice = writeVoice({
    frame, phrases: planned.phrases, octave: chosen.octave, triggerable: candidate.triggerable,
    energyByBar: input.arc.map((a) => a.target),
  });
  const written = voice.notes.map((w) => ({ ...w.note }));

  // the same expression passes the classic strings get, for this one track
  const others = Object.entries(input.classicNotesByTrackId)
    .filter(([id]) => id !== chosen.trackId)
    .map(([id, notes]) => ({ role: input.voiceTracks.find((t) => t.id === id)?.role ?? '', notes: notes.map((n) => ({ ...n })) }));
  const humanized = humanizeStrings({ project, template: input.template, sections: input.sections, notesByTrackId: { [chosen.trackId]: written }, otherNotes: others });
  const overlapped = overlapLegato({ project, sections: input.sections, notesByTrackId: { [chosen.trackId]: humanized[chosen.trackId] ?? written } });
  const notes = overlapped[chosen.trackId] ?? humanized[chosen.trackId] ?? written;
  const lanes = buildCcLanes({
    project, template: input.template, sections: input.sections, arc: input.arc,
    notesByTrackId: { [chosen.trackId]: notes },
    // the composed voice is the tune on its track wherever it sounds
    carrierByBar: input.carrierByBar.map((carrier, i) => (selection.chosen && notes.some((n) => Math.floor(n.startTick / bar) === i) ? chosen.trackId : carrier)),
  });

  return {
    written: true, reason: null, ...base, selection, trackId: chosen.trackId, octave: chosen.octave,
    voiceNotes: voice.notes, gestures: voice.gestures, notes, cc: lanes[chosen.trackId] ?? [],
    replacedClassicNotes: (input.classicNotesByTrackId[chosen.trackId] ?? []).map((n) => ({ ...n })),
  };
}
