/**
 * Phase 4B: deterministic, read-only musical observations for Piano Engine.
 * This analyzes the Phase 4A snapshot and exact source windows only. It does
 * not plan notes, alter tracks, infer audibility, or generate piano actions.
 */
import type { Note } from '../../shared/schema/types';
import type { MomentKind } from '../conductor/moments';
import type { ResolvedChord, SpineSection } from '../spine';
import type { DeepReadonly, PianoAnalysisTrack, PianoAnalysisTrackCompositionState } from './analysis';
import type {
  PianoBarWindow,
  PianoEnergyBar,
  PianoEngineInput,
  PianoFillWindow,
  PianoLayerInformation,
  PianoLeadWindow,
  PianoRelevantMoment,
  PianoMomentKind,
} from './piano-engine';

type NoteView = Pick<Note, 'pitch' | 'startTick' | 'durationTicks'>;
export type PianoAnalyzerAvailability = 'available' | 'partial' | 'unavailable';

export interface PianoInstrumentIdentity {
  readonly id: string;
  readonly name: string;
  readonly family: PianoAnalysisTrack['family'];
  readonly role: string;
}

export interface PianoOnsetPosition {
  /** Exact tick offset from the start of the source window. */
  readonly offsetTicks: number;
  /** Offset divided by source-window length; no beat or meter is inferred. */
  readonly normalizedPosition: number;
  readonly noteCount: number;
}

export interface PianoPitchCount {
  readonly pitch: number;
  readonly noteCount: number;
}

export interface PianoRegisterCount {
  /** MIDI octave, where pitch 60 is in octave 4 (floor(pitch / 12) - 1). */
  readonly midiOctave: number;
  readonly noteCount: number;
}

/** Note-onset distributions plus overlap and union-duration observations. */
export interface PianoIntervalActivity {
  /** Notes whose start tick is inside this half-open window. */
  readonly onsetNoteCount: number;
  /** Distinct note events with a positive-duration overlap with this window. */
  readonly activeNoteCount: number;
  readonly onsetDistribution: readonly PianoOnsetPosition[];
  /** Exact absolute MIDI-pitch histogram of note onsets. */
  readonly absolutePitchDistribution: readonly PianoPitchCount[];
  /** Fixed MIDI-octave histogram of note onsets, not instrument-range normalized. */
  readonly registerDistribution: readonly PianoRegisterCount[];
  readonly lowestPitch: number | null;
  readonly highestPitch: number | null;
  readonly meanPitch: number | null;
  readonly meanMidiOctave: number | null;
  /** Union of all clipped note intervals; overlapping durations count once. */
  readonly durationUnionTicks: number;
  readonly windowTicks: number;
  readonly occupancyRatio: number;
}

export interface PianoBarActivity extends PianoIntervalActivity {
  readonly bar: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly sectionId: string;
  readonly sectionName: string;
}

export interface PianoSectionActivity extends PianoIntervalActivity {
  readonly sectionId: string;
  readonly sectionName: string;
  readonly sectionIndex: number;
  readonly occurrence: number;
  readonly startBar: number;
  readonly lengthBars: number;
  readonly startTick: number;
  readonly endTick: number;
}

export interface PianoActivityDelta {
  readonly onsetNoteCount: number;
  readonly activeNoteCount: number;
  readonly durationUnionTicks: number;
  readonly occupancyRatio: number;
}

export type PianoRegisterChange =
  | {
      readonly availability: 'available';
      readonly meanPitchDelta: number;
      readonly meanMidiOctaveDelta: number;
      readonly lowestPitchDelta: number;
      readonly highestPitchDelta: number;
    }
  | {
      readonly availability: 'unavailable';
      readonly meanPitchDelta: null;
      readonly meanMidiOctaveDelta: null;
      readonly lowestPitchDelta: null;
      readonly highestPitchDelta: null;
      readonly reason: string;
    };

export interface PianoBarTransition {
  readonly fromBar: number;
  readonly toBar: number;
  readonly fromSectionId: string;
  readonly toSectionId: string;
  readonly activityChange: PianoActivityDelta;
  readonly registerChange: PianoRegisterChange;
}

export interface PianoSectionTransition {
  readonly fromSectionId: string;
  readonly toSectionId: string;
  readonly fromSectionName: string;
  readonly toSectionName: string;
  readonly activityChange: PianoActivityDelta;
  readonly registerChange: PianoRegisterChange;
}

export interface PianoChordSpanFact {
  readonly id: string;
  readonly symbol: string;
  readonly startTick: number;
  readonly endTick: number;
}

export interface PianoChordActivityRelationship {
  readonly chord: PianoChordSpanFact;
  /** Temporal overlap only; no note-to-chord correctness is inferred. */
  readonly activity: PianoIntervalActivity;
  readonly byBar: readonly {
    readonly bar: number;
    readonly startTick: number;
    readonly endTick: number;
    readonly activity: PianoIntervalActivity;
  }[];
}

export interface PianoMomentActivityRelationship {
  readonly moment: PianoRelevantMoment;
  readonly activity: PianoIntervalActivity;
}

export interface PianoFillActivityRelationship {
  readonly window: PianoFillWindow;
  readonly activity: PianoIntervalActivity;
}

export interface PianoInstrumentObservedFacts {
  readonly instrument: PianoInstrumentIdentity;
  /** Production mixer/band gate; absent for synthetic legacy inputs. */
  readonly compositionState?: PianoAnalysisTrackCompositionState;
  readonly byBar: readonly PianoBarActivity[];
  readonly bySection: readonly PianoSectionActivity[];
  readonly barTransitions: readonly PianoBarTransition[];
  readonly sectionTransitions: readonly PianoSectionTransition[];
  /** Onsets that fall outside all source-provided bar windows. */
  readonly unassignedBarOnsetNoteCount: number;
  /** Onsets that fall outside all supplied section spans. */
  readonly unassignedSectionOnsetNoteCount: number;
  readonly relationships: {
    readonly harmony: {
      readonly availability: PianoAnalyzerAvailability;
      readonly sourceScope: 'resolved chord spans supplied by Phase 4A';
      readonly spans: readonly PianoChordActivityRelationship[];
      readonly unavailableReason?: string;
    };
    readonly moments: {
      readonly availability: 'partial';
      readonly sourceScope: 'tutti, soli, and unison annotations supplied by Phase 4A';
      readonly items: readonly PianoMomentActivityRelationship[];
    };
    readonly fillWindows: {
      readonly availability: 'available';
      readonly sourceScope: 'piano/Keys-targeted reservations supplied by Phase 4A';
      readonly items: readonly PianoFillActivityRelationship[];
    };
  };
}

export interface PianoSectionContextFact {
  readonly id: string;
  readonly name: string;
  readonly index: number;
  readonly occurrence: number;
  readonly startBar: number;
  readonly lengthBars: number;
  readonly startTick: number;
  readonly endTick: number;
}

export interface PianoExistingContextFacts {
  readonly barWindows: {
    readonly availability: 'available' | 'unavailable';
    readonly source: 'ConductorPlan.bars[].startTick/endTick';
    readonly items: readonly PianoBarWindow[];
    readonly unavailableReason?: string;
  };
  readonly sections: {
    readonly availability: 'available' | 'unavailable';
    readonly source: 'sectionMap(project)';
    readonly items: readonly PianoSectionContextFact[];
    readonly unavailableReason?: string;
  };
  readonly harmony: {
    readonly availability: 'available' | 'unavailable';
    readonly source: 'chordSpans(project), resolved spans only';
    readonly items: readonly PianoChordSpanFact[];
    readonly unavailableReason?: string;
  };
  readonly energy: {
    readonly availability: 'available' | 'unavailable';
    readonly source: 'existing per-bar energy arc';
    readonly items: readonly PianoEnergyBar[];
    readonly unavailableReason?: string;
  };
  readonly layers: {
    readonly availability: 'partial';
    readonly source: 'ConductorPlan.bars[].layers';
    readonly annotatedFamilies: readonly string[];
    readonly perBar: PianoLayerInformation['perBar'];
    readonly totalCapacity: null;
    readonly totalOccupiedLayers: null;
    readonly unavailableReason: string;
  };
  readonly moments: {
    readonly availability: 'partial';
    readonly source: 'ConductorPlan.moments, Phase 4A projection';
    readonly suppliedKinds: readonly PianoMomentKind[];
    readonly omittedKinds: readonly Extract<MomentKind, 'divisi' | 'imitation'>[];
    readonly items: readonly PianoRelevantMoment[];
    readonly unavailableReason: string;
  };
  readonly fillWindows: {
    readonly availability: 'available';
    readonly source: 'ConductorPlan.fills, piano/Keys targets only';
    readonly items: readonly PianoFillWindow[];
  };
}

export interface PianoLeadNoteObservation {
  readonly pitch: number;
  readonly startTick: number;
  readonly durationTicks: number;
}

export interface PianoLeadGapObservation {
  readonly startTick: number;
  readonly endTick: number;
  readonly durationTicks: number;
}

export interface PianoLeadPassageCandidate {
  readonly id: string;
  readonly kind: 'potentialLeadPassage';
  readonly source: PianoLeadWindow['source'];
  readonly instrument: PianoInstrumentIdentity;
  readonly startBar: number;
  readonly endBar: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly activity: {
    readonly onsetNoteCount: number;
    readonly activeNoteCount: number;
    readonly durationUnionTicks: number;
    readonly occupancyRatio: number;
  };
  /** Exact written note facts and rests observed inside the explicit lead window. */
  readonly observedNotes: readonly PianoLeadNoteObservation[];
  readonly gapWindows: readonly PianoLeadGapObservation[];
  readonly rhythm: {
    readonly onsetTicks: readonly number[];
    readonly meanInterOnsetTicks: number | null;
    readonly medianInterOnsetTicks: number | null;
  };
  readonly pitchRange: {
    readonly lowestPitch: number;
    readonly highestPitch: number;
    readonly meanPitch: number;
  } | null;
  readonly confidence: {
    readonly level: 'high';
    /** Confidence applies to the explicit plan label and written overlap only. */
    readonly scope: 'explicit orchestration plan plus written activity';
    readonly basis: string;
  };
  readonly evidence: readonly {
    readonly source: string;
    readonly fact: string;
  }[];
  /** Candidates are contextual observations, never piano commands. */
  readonly mandatoryPianoInstruction: false;
  readonly limitations: readonly string[];
}

export interface PianoAnalyzerReport {
  readonly observedFacts: {
    readonly barAssignmentAvailability: 'available' | 'unavailable';
    readonly instrumentCount: number;
    readonly instruments: readonly PianoInstrumentObservedFacts[];
    readonly method: readonly string[];
  };
  readonly existingContextFacts: PianoExistingContextFacts;
  readonly interpretations: {
    readonly leadPassages: {
      readonly availability: 'partial';
      readonly candidates: readonly PianoLeadPassageCandidate[];
      readonly annotatedFamilies: readonly string[];
      readonly unavailableFamilies: readonly string[];
      readonly limitation: string;
    };
    readonly responseOpportunities: {
      readonly availability: 'unavailable';
      readonly candidates: readonly [];
      readonly reason: string;
    };
    readonly phraseOpportunities: {
      readonly availability: 'unavailable';
      readonly candidates: readonly [];
      readonly reason: string;
    };
    readonly mandatoryPianoInstructions: readonly [];
  };
}

function midiOctave(pitch: number): number {
  return Math.floor(pitch / 12) - 1;
}

function durationUnionTicks(notes: readonly NoteView[], startTick: number, endTick: number): number {
  if (endTick <= startTick) return 0;
  const intervals = notes
    .filter((note) => Number.isFinite(note.startTick)
      && Number.isFinite(note.durationTicks)
      && note.durationTicks > 0
      && note.startTick < endTick
      && note.startTick + note.durationTicks > startTick)
    .map((note) => ({
      start: Math.max(startTick, note.startTick),
      end: Math.min(endTick, note.startTick + note.durationTicks),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!intervals.length) return 0;

  let union = 0;
  let currentStart = intervals[0].start;
  let currentEnd = intervals[0].end;
  for (const interval of intervals.slice(1)) {
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
    } else {
      union += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  return union + currentEnd - currentStart;
}

function intervalActivity(
  notes: readonly NoteView[],
  startTick: number,
  endTick: number,
): PianoIntervalActivity {
  const windowTicks = Math.max(0, endTick - startTick);
  const onsets = notes.filter((note) => Number.isFinite(note.startTick)
    && note.startTick >= startTick
    && note.startTick < endTick);
  const active = notes.filter((note) => Number.isFinite(note.startTick)
    && Number.isFinite(note.durationTicks)
    && note.durationTicks > 0
    && note.startTick < endTick
    && note.startTick + note.durationTicks > startTick);

  const onsetsByTick = new Map<number, number>();
  const pitches = new Map<number, number>();
  const registers = new Map<number, number>();
  for (const note of onsets) {
    onsetsByTick.set(note.startTick - startTick, (onsetsByTick.get(note.startTick - startTick) ?? 0) + 1);
    pitches.set(note.pitch, (pitches.get(note.pitch) ?? 0) + 1);
    const octave = midiOctave(note.pitch);
    registers.set(octave, (registers.get(octave) ?? 0) + 1);
  }
  const sortedPitches = [...pitches.keys()].sort((a, b) => a - b);
  const sortedRegisters = [...registers.keys()].sort((a, b) => a - b);
  const meanPitch = onsets.length
    ? onsets.reduce((sum, note) => sum + note.pitch, 0) / onsets.length
    : null;
  const meanMidiOctave = onsets.length
    ? onsets.reduce((sum, note) => sum + midiOctave(note.pitch), 0) / onsets.length
    : null;
  const unionTicks = durationUnionTicks(notes, startTick, endTick);

  return {
    onsetNoteCount: onsets.length,
    activeNoteCount: active.length,
    onsetDistribution: [...onsetsByTick.keys()].sort((a, b) => a - b).map((offsetTicks) => ({
      offsetTicks,
      normalizedPosition: windowTicks > 0 ? offsetTicks / windowTicks : 0,
      noteCount: onsetsByTick.get(offsetTicks)!,
    })),
    absolutePitchDistribution: sortedPitches.map((pitch) => ({ pitch, noteCount: pitches.get(pitch)! })),
    registerDistribution: sortedRegisters.map((octave) => ({ midiOctave: octave, noteCount: registers.get(octave)! })),
    lowestPitch: sortedPitches.length ? sortedPitches[0] : null,
    highestPitch: sortedPitches.length ? sortedPitches[sortedPitches.length - 1] : null,
    meanPitch,
    meanMidiOctave,
    durationUnionTicks: unionTicks,
    windowTicks,
    occupancyRatio: windowTicks > 0 ? unionTicks / windowTicks : 0,
  };
}

function trackIdentity(track: PianoAnalysisTrack): PianoInstrumentIdentity {
  return { id: track.id, name: track.name, family: track.family, role: track.role };
}

function activityDelta(from: PianoIntervalActivity, to: PianoIntervalActivity): PianoActivityDelta {
  return {
    onsetNoteCount: to.onsetNoteCount - from.onsetNoteCount,
    activeNoteCount: to.activeNoteCount - from.activeNoteCount,
    durationUnionTicks: to.durationUnionTicks - from.durationUnionTicks,
    occupancyRatio: to.occupancyRatio - from.occupancyRatio,
  };
}

function registerChange(from: PianoIntervalActivity, to: PianoIntervalActivity): PianoRegisterChange {
  if (from.meanPitch === null || to.meanPitch === null
    || from.meanMidiOctave === null || to.meanMidiOctave === null
    || from.lowestPitch === null || to.lowestPitch === null
    || from.highestPitch === null || to.highestPitch === null) {
    return {
      availability: 'unavailable',
      meanPitchDelta: null,
      meanMidiOctaveDelta: null,
      lowestPitchDelta: null,
      highestPitchDelta: null,
      reason: 'At least one side has no note onsets, so a register change cannot be measured.',
    };
  }
  return {
    availability: 'available',
    meanPitchDelta: to.meanPitch - from.meanPitch,
    meanMidiOctaveDelta: to.meanMidiOctave - from.meanMidiOctave,
    lowestPitchDelta: to.lowestPitch - from.lowestPitch,
    highestPitchDelta: to.highestPitch - from.highestPitch,
  };
}

function copyMoment(moment: PianoRelevantMoment): PianoRelevantMoment {
  return {
    kind: moment.kind,
    startBar: moment.startBar,
    endBar: moment.endBar,
    startTick: moment.startTick,
    endTick: moment.endTick,
    ...(moment.participantRoles ? { participantRoles: [...moment.participantRoles] } : {}),
    ...(moment.shape ? { shape: moment.shape } : {}),
  };
}

function copyLayerInformation(layers: PianoLayerInformation): PianoExistingContextFacts['layers'] {
  return {
    availability: layers.availability,
    source: layers.source,
    annotatedFamilies: [...layers.annotatedFamilies],
    perBar: layers.perBar.map((bar) => ({
      bar: bar.bar,
      layers: bar.layers.map((layer) => ({
        layer: layer.layer,
        trackIds: [...layer.trackIds],
        source: layer.source,
      })),
    })),
    totalCapacity: null,
    totalOccupiedLayers: null,
    unavailableReason: layers.unavailableReason,
  };
}

function existingContextFacts(input: PianoEngineInput): PianoExistingContextFacts {
  const context = input.context;
  const bars = context.barWindows.map((bar) => ({ ...bar }));
  const sections: PianoSectionContextFact[] = context.sections.map((section) => ({
    id: section.id,
    name: section.name,
    index: section.index,
    occurrence: section.occurrence,
    startBar: section.startBar,
    lengthBars: section.lengthBars,
    startTick: section.startTick,
    endTick: section.endTick,
  }));
  const chords: PianoChordSpanFact[] = context.harmony.map((chord) => ({
    id: chord.id,
    symbol: chord.symbol,
    startTick: chord.startTick,
    endTick: chord.endTick,
  }));
  const energy: PianoEnergyBar[] = context.energy.map((bar) => ({
    bar: bar.bar,
    target: bar.target,
    nearSilence: bar.nearSilence,
  }));
  const moments = context.moments.map(copyMoment);
  const fills = context.fillWindows.map((window) => ({ ...window }));

  return {
    barWindows: bars.length
      ? { availability: 'available', source: 'ConductorPlan.bars[].startTick/endTick', items: bars }
      : {
          availability: 'unavailable',
          source: 'ConductorPlan.bars[].startTick/endTick',
          items: bars,
          unavailableReason: 'No source-provided conductor bar windows were supplied; bar assignment is not reconstructed.',
        },
    sections: sections.length
      ? { availability: 'available', source: 'sectionMap(project)', items: sections }
      : {
          availability: 'unavailable',
          source: 'sectionMap(project)',
          items: sections,
          unavailableReason: 'No section spans were supplied.',
        },
    harmony: chords.length
      ? { availability: 'available', source: 'chordSpans(project), resolved spans only', items: chords }
      : {
          availability: 'unavailable',
          source: 'chordSpans(project), resolved spans only',
          items: chords,
          unavailableReason: 'No resolved chord spans were supplied; this does not distinguish an empty chord list from spans omitted by the resolver.',
        },
    energy: energy.length
      ? { availability: 'available', source: 'existing per-bar energy arc', items: energy }
      : {
          availability: 'unavailable',
          source: 'existing per-bar energy arc',
          items: energy,
          unavailableReason: 'No per-bar energy annotations were supplied; targets are not recalculated.',
        },
    layers: copyLayerInformation(context.layerInformation),
    moments: {
      availability: 'partial',
      source: 'ConductorPlan.moments, Phase 4A projection',
      suppliedKinds: ['tutti', 'soli', 'unison'],
      omittedKinds: ['divisi', 'imitation'],
      items: moments,
      unavailableReason: 'Phase 4A supplies only tutti, soli, and unison; divisi/imitation and their richer lead/answer fields are unavailable here.',
    },
    fillWindows: {
      availability: 'available',
      source: 'ConductorPlan.fills, piano/Keys targets only',
      items: fills,
    },
  };
}

function barActivity(track: PianoAnalysisTrack, window: PianoBarWindow): PianoBarActivity {
  return {
    bar: window.bar,
    startTick: window.startTick,
    endTick: window.endTick,
    sectionId: window.sectionId,
    sectionName: window.sectionName,
    ...intervalActivity(track.notes, window.startTick, window.endTick),
  };
}

function sectionActivity(track: PianoAnalysisTrack, section: DeepReadonly<SpineSection>): PianoSectionActivity {
  return {
    sectionId: section.id,
    sectionName: section.name,
    sectionIndex: section.index,
    occurrence: section.occurrence,
    startBar: section.startBar,
    lengthBars: section.lengthBars,
    startTick: section.startTick,
    endTick: section.endTick,
    ...intervalActivity(track.notes, section.startTick, section.endTick),
  };
}

function barTransitions(bars: readonly PianoBarActivity[]): PianoBarTransition[] {
  const sorted = [...bars].sort((a, b) => a.bar - b.bar || a.startTick - b.startTick);
  const transitions: PianoBarTransition[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1];
    const to = sorted[i];
    if (to.bar !== from.bar + 1) continue;
    transitions.push({
      fromBar: from.bar,
      toBar: to.bar,
      fromSectionId: from.sectionId,
      toSectionId: to.sectionId,
      activityChange: activityDelta(from, to),
      registerChange: registerChange(from, to),
    });
  }
  return transitions;
}

function sectionTransitions(sections: readonly PianoSectionActivity[]): PianoSectionTransition[] {
  const sorted = [...sections].sort((a, b) => a.sectionIndex - b.sectionIndex);
  const transitions: PianoSectionTransition[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1];
    const to = sorted[i];
    transitions.push({
      fromSectionId: from.sectionId,
      toSectionId: to.sectionId,
      fromSectionName: from.sectionName,
      toSectionName: to.sectionName,
      activityChange: activityDelta(from, to),
      registerChange: registerChange(from, to),
    });
  }
  return transitions;
}

function chordRelationships(
  track: PianoAnalysisTrack,
  bars: readonly PianoBarWindow[],
  harmony: readonly DeepReadonly<ResolvedChord>[],
): PianoChordActivityRelationship[] {
  return harmony.map((chord) => {
    const byBar = bars.flatMap((bar) => {
      const startTick = Math.max(bar.startTick, chord.startTick);
      const endTick = Math.min(bar.endTick, chord.endTick);
      if (endTick <= startTick) return [];
      return [{
        bar: bar.bar,
        startTick,
        endTick,
        activity: intervalActivity(track.notes, startTick, endTick),
      }];
    });
    return {
      chord: { id: chord.id, symbol: chord.symbol, startTick: chord.startTick, endTick: chord.endTick },
      activity: intervalActivity(track.notes, chord.startTick, chord.endTick),
      byBar,
    };
  });
}

function momentRelationships(
  track: PianoAnalysisTrack,
  moments: readonly PianoRelevantMoment[],
): PianoMomentActivityRelationship[] {
  return moments.map((moment) => ({
    moment: copyMoment(moment),
    activity: intervalActivity(track.notes, moment.startTick, moment.endTick),
  }));
}

function fillRelationships(
  track: PianoAnalysisTrack,
  windows: readonly PianoFillWindow[],
): PianoFillActivityRelationship[] {
  return windows.map((window) => ({
    window: { ...window },
    activity: intervalActivity(track.notes, window.startTick, window.endTick),
  }));
}

function unassignedOnsetCount(
  notes: readonly NoteView[],
  windows: readonly { readonly startTick: number; readonly endTick: number }[],
): number {
  return notes.filter((note) => !windows.some((window) => window.endTick > window.startTick
    && note.startTick >= window.startTick
    && note.startTick < window.endTick)).length;
}

function observeTrack(
  track: PianoAnalysisTrack,
  input: PianoEngineInput,
): PianoInstrumentObservedFacts {
  const sortedBars = [...input.context.barWindows].sort((a, b) => a.bar - b.bar || a.startTick - b.startTick);
  const sortedSections = [...input.context.sections].sort((a, b) => a.index - b.index);
  const byBar = sortedBars.map((window) => barActivity(track, window));
  const bySection = sortedSections.map((section) => sectionActivity(track, section));
  const harmonyAvailable = input.context.harmony.length > 0;
  return {
    instrument: trackIdentity(track),
    ...(track.compositionState ? { compositionState: track.compositionState } : {}),
    byBar,
    bySection,
    barTransitions: barTransitions(byBar),
    sectionTransitions: sectionTransitions(bySection),
    unassignedBarOnsetNoteCount: unassignedOnsetCount(track.notes, sortedBars),
    unassignedSectionOnsetNoteCount: unassignedOnsetCount(track.notes, sortedSections),
    relationships: {
      harmony: {
        availability: harmonyAvailable ? 'available' : 'unavailable',
        sourceScope: 'resolved chord spans supplied by Phase 4A',
        spans: chordRelationships(track, sortedBars, input.context.harmony),
        ...(!harmonyAvailable
          ? { unavailableReason: 'No resolved chord spans are available to relate to written activity.' }
          : {}),
      },
      moments: {
        availability: 'partial',
        sourceScope: 'tutti, soli, and unison annotations supplied by Phase 4A',
        items: momentRelationships(track, input.context.moments),
      },
      fillWindows: {
        availability: 'available',
        sourceScope: 'piano/Keys-targeted reservations supplied by Phase 4A',
        items: fillRelationships(track, input.context.fillWindows),
      },
    },
  };
}

interface LeadEvidenceRow {
  readonly track: PianoAnalysisTrack;
  readonly window: PianoBarWindow;
  readonly source: PianoLeadWindow['source'];
}

function leadGapWindows(
  notes: readonly PianoLeadNoteObservation[],
  startTick: number,
  endTick: number,
): PianoLeadGapObservation[] {
  const intervals = notes
    .map((note) => ({
      start: Math.max(startTick, note.startTick),
      end: Math.min(endTick, note.startTick + note.durationTicks),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const gaps: PianoLeadGapObservation[] = [];
  let cursor = startTick;
  for (const interval of intervals) {
    if (interval.start > cursor) gaps.push({ startTick: cursor, endTick: interval.start, durationTicks: interval.start - cursor });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < endTick) gaps.push({ startTick: cursor, endTick, durationTicks: endTick - cursor });
  return gaps;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function leadPassageCandidates(input: PianoEngineInput): PianoLeadPassageCandidate[] {
  const bars = [...input.context.barWindows].sort((a, b) => a.bar - b.bar || a.startTick - b.startTick);
  const tracksById = new Map(input.analysis.tracks.map((track) => [track.id, track] as const));
  const rowsByWindow = new Map<string, LeadEvidenceRow>();
  const addWindow = (trackId: string, source: PianoLeadWindow['source'], startTick: number, endTick: number) => {
    const track = tracksById.get(trackId);
    if (!track || track.compositionState?.composerVisible === false || endTick <= startTick) return;
    for (const bar of bars) {
      if (bar.startTick >= endTick || bar.endTick <= startTick) continue;
      const window = {
        ...bar,
        startTick: Math.max(bar.startTick, startTick),
        endTick: Math.min(bar.endTick, endTick),
      };
      const key = `${trackId}:${window.startTick}:${window.endTick}`;
      if (!rowsByWindow.has(key)) rowsByWindow.set(key, { track, window, source });
    }
  };

  for (const leadWindow of input.context.leadWindows ?? []) {
    const track = tracksById.get(leadWindow.trackId);
    if (!track || track.family !== leadWindow.family) continue;
    addWindow(leadWindow.trackId, leadWindow.source, leadWindow.startTick, leadWindow.endTick);
  }
  // Preserve compatibility with legacy/synthetic callers that provide only
  // the original strings-layer projection and no consolidated lead windows.
  for (const bar of bars) {
    const annotation = input.context.layerInformation.perBar.find((item) => item.bar === bar.bar);
    for (const trackId of annotation?.layers.filter((slot) => slot.layer === 'lead').flatMap((slot) => slot.trackIds) ?? []) {
      addWindow(trackId, 'strings-layer', bar.startTick, bar.endTick);
    }
  }

  const evidenceRows = [...rowsByWindow.values()]
    .sort((a, b) => a.track.id.localeCompare(b.track.id)
      || a.source.localeCompare(b.source)
      || a.window.sectionId.localeCompare(b.window.sectionId)
      || a.window.startTick - b.window.startTick);
  const groups: LeadEvidenceRow[][] = [];
  for (const row of evidenceRows) {
    const previousGroup = groups[groups.length - 1];
    const previous = previousGroup?.[previousGroup.length - 1];
    if (previous
      && previous.track.id === row.track.id
      && previous.source === row.source
      && previous.window.sectionId === row.window.sectionId
      && previous.window.endTick === row.window.startTick) {
      previousGroup.push(row);
    } else {
      groups.push([row]);
    }
  }

  return groups.flatMap((group): PianoLeadPassageCandidate[] => {
    const first = group[0];
    const last = group[group.length - 1];
    const startTick = first.window.startTick;
    const endTick = last.window.endTick;
    const observedNotes = first.track.notes
      .filter((note) => Number.isFinite(note.pitch)
        && Number.isFinite(note.startTick)
        && Number.isFinite(note.durationTicks)
        && note.durationTicks > 0
        && note.startTick < endTick
        && note.startTick + note.durationTicks > startTick)
      .map((note) => ({ pitch: note.pitch, startTick: note.startTick, durationTicks: note.durationTicks }))
      .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    if (!observedNotes.length) return [];

    const activity = intervalActivity(first.track.notes, startTick, endTick);
    const onsetTicks = [...new Set(observedNotes
      .filter((note) => note.startTick >= startTick && note.startTick < endTick)
      .map((note) => note.startTick))].sort((a, b) => a - b);
    const interOnsetIntervals = onsetTicks.slice(1).map((tick, index) => tick - onsetTicks[index]);
    const pitchRange = observedNotes.length ? {
      lowestPitch: Math.min(...observedNotes.map((note) => note.pitch)),
      highestPitch: Math.max(...observedNotes.map((note) => note.pitch)),
      meanPitch: observedNotes.reduce((sum, note) => sum + note.pitch, 0) / observedNotes.length,
    } : null;
    const sourceFact = first.source === 'strings-layer'
      ? `The Conductor assigns a strings lead layer to ${first.track.id}`
      : first.source === 'brass-plan'
        ? `The brass planner assigns the lead voice to ${first.track.id}`
        : `The winds planner assigns the lead voice to ${first.track.id}`;
    const id = `${first.track.id}:${startTick}-${endTick}:${first.source}`;
    return [{
      id,
      kind: 'potentialLeadPassage',
      source: first.source,
      instrument: trackIdentity(first.track),
      startBar: first.window.bar,
      endBar: last.window.bar,
      startTick,
      endTick,
      sectionId: first.window.sectionId,
      sectionName: first.window.sectionName,
      activity: {
        onsetNoteCount: activity.onsetNoteCount,
        activeNoteCount: activity.activeNoteCount,
        durationUnionTicks: activity.durationUnionTicks,
        occupancyRatio: activity.occupancyRatio,
      },
      observedNotes,
      gapWindows: leadGapWindows(observedNotes, startTick, endTick),
      rhythm: {
        onsetTicks,
        meanInterOnsetTicks: interOnsetIntervals.length
          ? interOnsetIntervals.reduce((sum, value) => sum + value, 0) / interOnsetIntervals.length : null,
        medianInterOnsetTicks: median(interOnsetIntervals),
      },
      pitchRange,
      confidence: {
        level: 'high',
        scope: 'explicit orchestration plan plus written activity',
        basis: `${sourceFact} in the supplied lead window, and Composer-visible written notes overlap it; the Analyzer does not infer leadership from pitch or activity alone.`,
      },
      evidence: [
        {
          source: `PianoEngineContext.leadWindows (${first.source})`,
          fact: `${sourceFact} in bars ${first.window.bar}-${last.window.bar}; the window is copied from the existing family plan.`,
        },
        {
          source: 'PianoAnalysis.tracks[].notes',
          fact: `${activity.onsetNoteCount} note onset(s), ${activity.durationUnionTicks} ticks of union activity, and ${leadGapWindows(observedNotes, startTick, endTick).length} exact temporal gap(s) are observed inside the planned window.`,
        },
      ],
      mandatoryPianoInstruction: false,
      limitations: [
        'This explicit-plan candidate follows the available mute/solo/lock/band gate; it does not claim exact loudness or prescribe piano behavior.',
        'Onsets, pitch range, and gaps are raw written-event observations; only the Composer judges accompaniment or response suitability.',
      ],
    }];
  });
}

function freezeOutput<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeOutput(child);
    Object.freeze(value);
  }
  return value;
}

/** Analyze a PianoEngineInput without mutation, random draws, or note generation. */
export function analyzePianoInput(input: PianoEngineInput): PianoAnalyzerReport {
  const instruments = input.analysis.tracks.map((track) => observeTrack(track, input));
  const leadCandidates = leadPassageCandidates(input);
  const annotatedFamilies: string[] = [...new Set([
    ...input.context.layerInformation.annotatedFamilies,
    ...leadCandidates.map((candidate) => candidate.instrument.family),
  ])];
  const presentFamilies = [...new Set(input.analysis.tracks.map((track) => track.family))];
  const annotatedFamilySet = new Set(annotatedFamilies);
  const unavailableFamilies = presentFamilies.filter((family) => !annotatedFamilySet.has(family));
  const contextFacts = existingContextFacts(input);

  return freezeOutput({
    observedFacts: {
      barAssignmentAvailability: input.context.barWindows.length > 0 ? 'available' : 'unavailable',
      instrumentCount: input.analysis.tracks.length,
      instruments,
      method: [
        'Written MIDI facts are kept separate from production mute/solo/lock/band state; Composer visibility uses those exact gates but does not claim full audibility, volume, or time-varying CC7.',
        'Bar assignment uses only the exact ConductorPlan.bars startTick/endTick projection; windows are half-open and are never reconstructed from meter or note events.',
        'Onset positions are exact tick offsets and normalized window positions, not inferred beats.',
        'Activity counts note onsets and distinct overlapping note events; occupancy is the union of clipped note durations, so overlapping intervals count once.',
        'Pitch histograms use note onsets; register bins are fixed MIDI octaves and are not normalized to instrument ranges, which are unavailable in PianoAnalysis.',
        'Harmony, moment, and fill relationships report temporal overlap only and do not judge harmonic correctness, response, or musical suitability.',
        'Lead candidates use only explicit strings/brass/winds plan windows plus Composer-visible written notes; exact lead-note pitches, onsets, durations, and gaps are observations, not response recommendations.',
      ],
    },
    existingContextFacts: contextFacts,
    interpretations: {
      leadPassages: {
        availability: 'partial',
        candidates: leadCandidates,
        annotatedFamilies,
        unavailableFamilies,
        limitation: 'Only explicit strings-layer or brass/winds planner lead windows plus overlapping written activity on a Composer-visible track can support a lead candidate; raw pitch or activity alone never promotes a track to lead evidence.'
      },
      responseOpportunities: {
        availability: 'unavailable',
        candidates: [],
        reason: 'The Analyzer reports exact rests and timing around explicit lead windows but does not decide whether a Piano answer is suitable; a rest alone is not evidence of response suitability. Piano/Keys fill reservations remain context facts, not response claims; only the Composer selects a response.'
      },
      phraseOpportunities: {
        availability: 'unavailable',
        candidates: [],
        reason: 'No general phrase boundaries are supplied or detected. Existing section boundaries are not treated as phrase boundaries.',
      },
      mandatoryPianoInstructions: [],
    },
  });
}
