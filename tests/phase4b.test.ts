import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import type { PianoAnalysis, PianoAnalysisTrackCompositionState } from '../src/orchestrator/keys/analysis';
import type { PianoBarWindow, PianoEngineInput, PianoLayerInformation, PianoRelevantMoment } from '../src/orchestrator/keys/piano-engine';
import { projectFromFixture } from '../src/shared/schema';
import type { Note, Project, TrackFamily } from '../src/shared/schema/types';
import type { SpineSection } from '../src/orchestrator/spine';

const BAR_TICKS_7_8 = 3360;

function makeProject7Over8(): Project {
  const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
  project.timeSignature = { numerator: 7, denominator: 8 };
  project.sections = [
    { id: 'section-a', name: 'A', startBar: 1, lengthBars: 1 },
    { id: 'section-b', name: 'B', startBar: 2, lengthBars: 2 },
  ];
  project.chords = [
    { id: 'chord-a', symbol: 'Dm7', startTick: 0, durationTicks: BAR_TICKS_7_8 },
    { id: 'chord-b', symbol: 'G7', startTick: BAR_TICKS_7_8, durationTicks: BAR_TICKS_7_8 },
    { id: 'chord-c', symbol: 'A7', startTick: BAR_TICKS_7_8 * 2, durationTicks: BAR_TICKS_7_8 },
  ];
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  return project;
}

const sourceResult = composeAllTracks(makeProject7Over8(), { seed: 13, moments: false });
const sourceInput = sourceResult.pianoEngineInput;

interface SyntheticTrack {
  readonly id: string;
  readonly name: string;
  readonly family: TrackFamily;
  readonly role: string;
  readonly notes: readonly Note[];
}

interface InputOverrides {
  readonly barWindows?: readonly PianoBarWindow[];
  readonly sections?: readonly SpineSection[];
  readonly harmony?: PianoEngineInput['context']['harmony'];
  readonly moments?: readonly PianoRelevantMoment[];
  readonly fillWindows?: PianoEngineInput['context']['fillWindows'];
  readonly layerPerBar?: PianoLayerInformation['perBar'];
  readonly tracks?: readonly SyntheticTrack[];
}

function makeTrack(
  id: string,
  family: TrackFamily,
  role: string,
  notes: readonly { pitch: number; startTick: number; durationTicks: number }[],
  name = id,
): SyntheticTrack {
  return {
    id,
    name,
    family,
    role,
    notes: notes.map((note) => ({ ...note, velocity: 80 })),
  };
}

function makeInput(overrides: InputOverrides = {}): PianoEngineInput {
  const bars = overrides.barWindows ?? sourceInput.context.barWindows;
  const sections = overrides.sections ?? sourceInput.context.sections;
  const harmony = overrides.harmony ?? sourceInput.context.harmony;
  const moments = overrides.moments ?? sourceInput.context.moments;
  const fillWindows = overrides.fillWindows ?? sourceInput.context.fillWindows;
  const layerPerBar = overrides.layerPerBar ?? sourceInput.context.layerInformation.perBar;
  const context = Object.freeze({
    ...sourceInput.context,
    barWindows: Object.freeze(bars.map((bar) => Object.freeze({ ...bar }))),
    sections: Object.freeze(sections.map((section) => Object.freeze({ ...section }))),
    harmony: Object.freeze(harmony.map((span) => Object.freeze({ ...span }))),
    moments: Object.freeze(moments.map((moment) => Object.freeze({
      ...moment,
      ...(moment.participantRoles ? { participantRoles: Object.freeze([...moment.participantRoles]) } : {}),
    }))),
    fillWindows: Object.freeze(fillWindows.map((window) => Object.freeze({ ...window }))),
    layerInformation: Object.freeze({
      ...sourceInput.context.layerInformation,
      perBar: Object.freeze(layerPerBar.map((bar) => Object.freeze({
        bar: bar.bar,
        layers: Object.freeze(bar.layers.map((layer) => Object.freeze({
          ...layer,
          trackIds: Object.freeze([...layer.trackIds]),
        }))),
      }))),
    }),
  });
  const analysis: PianoAnalysis = Object.freeze({
    tracks: Object.freeze((overrides.tracks ?? []).map((track) => Object.freeze({
      id: track.id,
      name: track.name,
      family: track.family,
      role: track.role,
      notes: Object.freeze(track.notes.map((note) => Object.freeze({ ...note }))),
    }))),
  });
  return Object.freeze({ context, analysis });
}

function section(
  id: string,
  name: string,
  index: number,
  startBar: number,
  lengthBars: number,
  startTick: number,
  endTick: number,
): SpineSection {
  return { id, name, index, occurrence: 1, startBar, lengthBars, startTick, endTick };
}

const simpleSections: readonly SpineSection[] = [
  section('section-a', 'A', 0, 1, 1, 0, BAR_TICKS_7_8),
  section('section-b', 'B', 1, 2, 2, BAR_TICKS_7_8, BAR_TICKS_7_8 * 3),
];

describe('Piano Engine Phase 4B minimal musical Analyzer', () => {
  it('copies exact conductor bar windows for unusual 7/8 meter without reconstructing them', () => {
    expect(sourceInput.context.barWindows).toEqual(sourceResult.plan.bars.map((bar) => ({
      bar: bar.bar,
      startTick: bar.startTick,
      endTick: bar.endTick,
      sectionId: bar.sectionId,
      sectionName: bar.sectionName,
    })));
    expect(sourceInput.context.barWindows.map((bar) => bar.endTick - bar.startTick)).toEqual([
      BAR_TICKS_7_8,
      BAR_TICKS_7_8,
      BAR_TICKS_7_8,
    ]);
    expect(sourceInput.context.barWindows[1].startTick).toBe(sourceResult.plan.bars[1].startTick);
    expect(sourceInput.context.barWindows[1].endTick).toBe(sourceResult.plan.bars[1].endTick);
  });

  it('assigns notes at exact half-open source boundaries to the correct 7/8 bar', () => {
    const [first, second, third] = sourceInput.context.barWindows;
    const input = makeInput({
      barWindows: [first, second, third],
      tracks: [makeTrack('boundary', 'Strings', 'violins1', [
        { pitch: 60, startTick: first.endTick - 1, durationTicks: 2 },
        { pitch: 64, startTick: second.startTick, durationTicks: 8 },
        { pitch: 67, startTick: third.startTick, durationTicks: 8 },
        { pitch: 72, startTick: third.endTick, durationTicks: 8 },
      ])],
    });

    const observed = analyzePianoInput(input).observedFacts.instruments[0];
    expect(observed.byBar.map(({ bar, startTick, endTick, onsetNoteCount }) => ({
      bar, startTick, endTick, onsetNoteCount,
    }))).toEqual([
      { bar: first.bar, startTick: first.startTick, endTick: first.endTick, onsetNoteCount: 1 },
      { bar: second.bar, startTick: second.startTick, endTick: second.endTick, onsetNoteCount: 1 },
      { bar: third.bar, startTick: third.startTick, endTick: third.endTick, onsetNoteCount: 1 },
    ]);
    expect(observed.unassignedBarOnsetNoteCount).toBe(1);
  });

  it('reports onset counts/distribution, duration-union occupancy, absolute pitch, and MIDI-octave register', () => {
    const input = makeInput({
      barWindows: sourceInput.context.barWindows.slice(0, 1),
      sections: simpleSections.slice(0, 1),
      tracks: [makeTrack('metrics', 'Strings', 'violins1', [
        { pitch: 48, startTick: 100, durationTicks: 500 },
        { pitch: 60, startTick: 300, durationTicks: 500 },
        { pitch: 72, startTick: 100, durationTicks: 100 },
      ])],
    });
    const bar = analyzePianoInput(input).observedFacts.instruments[0].byBar[0];

    expect(bar.onsetNoteCount).toBe(3);
    expect(bar.activeNoteCount).toBe(3);
    expect(bar.onsetDistribution).toEqual([
      { offsetTicks: 100, normalizedPosition: 100 / BAR_TICKS_7_8, noteCount: 2 },
      { offsetTicks: 300, normalizedPosition: 300 / BAR_TICKS_7_8, noteCount: 1 },
    ]);
    expect(bar.absolutePitchDistribution).toEqual([
      { pitch: 48, noteCount: 1 },
      { pitch: 60, noteCount: 1 },
      { pitch: 72, noteCount: 1 },
    ]);
    expect(bar.registerDistribution).toEqual([
      { midiOctave: 3, noteCount: 1 },
      { midiOctave: 4, noteCount: 1 },
      { midiOctave: 5, noteCount: 1 },
    ]);
    expect(bar.lowestPitch).toBe(48);
    expect(bar.highestPitch).toBe(72);
    expect(bar.meanPitch).toBe(60);
    // [100, 600] and [300, 800] overlap; the union is 700 ticks, not 1,100.
    expect(bar.durationUnionTicks).toBe(700);
    expect(bar.windowTicks).toBe(BAR_TICKS_7_8);
    expect(bar.occupancyRatio).toBe(700 / BAR_TICKS_7_8);
  });

  it('reports activity/register changes across bars and sections and relates activity to resolved harmony, moments, and fills', () => {
    const input = makeInput({
      sections: simpleSections,
      tracks: [makeTrack('strings', 'Strings', 'violins1', [
        { pitch: 48, startTick: 100, durationTicks: 100 },
        { pitch: 60, startTick: BAR_TICKS_7_8, durationTicks: 100 },
        { pitch: 72, startTick: BAR_TICKS_7_8 * 2, durationTicks: 100 },
      ])],
      moments: [{
        kind: 'soli', startBar: 2, endBar: 2,
        startTick: BAR_TICKS_7_8, endTick: BAR_TICKS_7_8 * 2,
        participantRoles: ['violins1'],
      }],
      fillWindows: [{ target: 'piano', startTick: BAR_TICKS_7_8 * 2, endTick: BAR_TICKS_7_8 * 3 }],
    });
    const report = analyzePianoInput(input);
    const observed = report.observedFacts.instruments[0];

    expect(observed.barTransitions).toHaveLength(2);
    expect(observed.barTransitions[0].activityChange.onsetNoteCount).toBe(0);
    expect(observed.barTransitions[0].registerChange.meanPitchDelta).toBe(12);
    expect(observed.sectionTransitions).toHaveLength(1);
    expect(observed.sectionTransitions[0]).toMatchObject({
      fromSectionId: 'section-a',
      toSectionId: 'section-b',
      activityChange: { onsetNoteCount: 1 },
      registerChange: { availability: 'available', meanPitchDelta: 18, meanMidiOctaveDelta: 1.5 },
    });

    expect(observed.relationships.harmony.availability).toBe('available');
    expect(observed.relationships.harmony.spans[0].chord.id).toBe('chord-a');
    expect(observed.relationships.harmony.spans[0].activity.onsetNoteCount).toBe(1);
    expect(observed.relationships.harmony.spans[0].byBar[0].bar).toBe(1);
    expect(observed.relationships.moments.availability).toBe('partial');
    expect(observed.relationships.moments.items[0].moment.kind).toBe('soli');
    expect(observed.relationships.moments.items[0].activity.onsetNoteCount).toBe(1);
    expect(observed.relationships.fillWindows.items[0].window.target).toBe('piano');
    expect(observed.relationships.fillWindows.items[0].activity.onsetNoteCount).toBe(1);
    expect(report.existingContextFacts.moments.omittedKinds).toEqual(['divisi', 'imitation']);
  });

  it('handles empty tracks and explicitly reports missing section, harmony, moment, and layer evidence', () => {
    const input = makeInput({
      sections: [],
      harmony: [],
      moments: [],
      fillWindows: [],
      layerPerBar: [],
      tracks: [makeTrack('empty', 'Keys', 'harp', [])],
    });
    const report = analyzePianoInput(input);
    const observed = report.observedFacts.instruments[0];

    expect(observed.byBar).toHaveLength(3);
    expect(observed.byBar.every((bar) => bar.onsetNoteCount === 0
      && bar.activeNoteCount === 0
      && bar.durationUnionTicks === 0
      && bar.occupancyRatio === 0)).toBe(true);
    expect(observed.bySection).toEqual([]);
    expect(observed.relationships.harmony.availability).toBe('unavailable');
    expect(observed.relationships.harmony.spans).toEqual([]);
    expect(observed.relationships.moments.items).toEqual([]);
    expect(observed.relationships.fillWindows.items).toEqual([]);
    expect(report.existingContextFacts.sections.availability).toBe('unavailable');
    expect(report.existingContextFacts.harmony.availability).toBe('unavailable');
    expect(report.existingContextFacts.energy.availability).toBe('available');
    expect(report.existingContextFacts.moments.availability).toBe('partial');
    expect(report.interpretations.leadPassages.candidates).toEqual([]);
    expect(report.interpretations.responseOpportunities.availability).toBe('unavailable');
    expect(report.interpretations.phraseOpportunities.availability).toBe('unavailable');

    const noInstruments = analyzePianoInput(makeInput({ tracks: [] }));
    expect(noInstruments.observedFacts.instrumentCount).toBe(0);
    expect(noInstruments.observedFacts.instruments).toEqual([]);
  });

  it('qualifies lead candidates with explicit annotation and written activity, never highest pitch or a rest alone', () => {
    const windows = sourceInput.context.barWindows;
    const input = makeInput({
      tracks: [
        makeTrack('annotated-lead', 'Strings', 'violins1', [
          { pitch: 60, startTick: windows[1].startTick + 20, durationTicks: 100 },
          { pitch: 62, startTick: windows[2].startTick + 20, durationTicks: 100 },
        ]),
        makeTrack('highest-unannotated', 'Brass', 'trumpets', [
          { pitch: 127, startTick: windows[1].startTick + 10, durationTicks: 100 },
          { pitch: 127, startTick: windows[2].startTick + 10, durationTicks: 100 },
        ]),
      ],
      layerPerBar: [
        { bar: windows[1].bar, layers: [{ layer: 'lead', trackIds: ['annotated-lead'], source: 'strings' }] },
        { bar: windows[2].bar, layers: [{ layer: 'lead', trackIds: ['annotated-lead'], source: 'strings' }] },
      ],
    });
    const interpretations = analyzePianoInput(input).interpretations;

    expect(interpretations.leadPassages.candidates).toHaveLength(1);
    expect(interpretations.leadPassages.candidates[0]).toMatchObject({
      kind: 'potentialLeadPassage',
      instrument: { id: 'annotated-lead', family: 'Strings', role: 'violins1' },
      startBar: 2,
      endBar: 3,
      confidence: {
        level: 'high',
        scope: 'explicit orchestration plan plus written activity',
      },
      mandatoryPianoInstruction: false,
    });
    expect(interpretations.leadPassages.candidates[0].evidence.map((item) => item.source)).toEqual([
      'PianoEngineContext.leadWindows (strings-layer)',
      'PianoAnalysis.tracks[].notes',
    ]);
    expect(interpretations.leadPassages.candidates[0].limitations.join(' ')).toMatch(/does not claim exact loudness or prescribe piano behavior/);
    expect(interpretations.leadPassages.unavailableFamilies).toContain('Brass');
    expect(interpretations.responseOpportunities.candidates).toEqual([]);
    expect(interpretations.responseOpportunities.reason).toMatch(/a rest alone is not evidence/);
    expect(interpretations.mandatoryPianoInstructions).toEqual([]);
  });

  it('requires explicit lead labels and Composer-visible written activity after mute/solo/band gates', () => {
    const windows = sourceInput.context.barWindows;
    const activeNotes = [
      { pitch: 60, startTick: windows[1].startTick + 20, durationTicks: 100 },
      { pitch: 62, startTick: windows[2].startTick + 20, durationTicks: 100 },
    ];
    const base = makeInput({
      tracks: [
        makeTrack('muted-lead', 'Strings', 'violins1', activeNotes),
        makeTrack('solo-excluded-lead', 'Strings', 'violins2', activeNotes),
        makeTrack('out-of-band-lead', 'Strings', 'violas', activeNotes),
        makeTrack('locked-out-of-band-lead', 'Strings', 'cellosBasses', activeNotes),
        makeTrack('highest-unannotated', 'Strings', 'violins1', [
          { pitch: 127, startTick: windows[1].startTick + 10, durationTicks: 100 },
          { pitch: 127, startTick: windows[2].startTick + 10, durationTicks: 100 },
        ]),
      ],
      layerPerBar: [
        { bar: windows[1].bar, layers: [{ layer: 'lead', trackIds: ['muted-lead', 'solo-excluded-lead'], source: 'strings' }] },
        { bar: windows[2].bar, layers: [{ layer: 'lead', trackIds: ['out-of-band-lead', 'locked-out-of-band-lead'], source: 'strings' }] },
      ],
    });
    const state = (values: Partial<PianoAnalysisTrackCompositionState>): PianoAnalysisTrackCompositionState => ({
      locked: false,
      muted: false,
      soloed: false,
      inBand: true,
      mixerAudible: true,
      composerVisible: true,
      ...values,
    });
    const states: Record<string, PianoAnalysisTrackCompositionState> = {
      'muted-lead': state({ muted: true, mixerAudible: false, composerVisible: false }),
      'solo-excluded-lead': state({ mixerAudible: false, composerVisible: false }),
      'out-of-band-lead': state({ inBand: false, composerVisible: false }),
      'locked-out-of-band-lead': state({ locked: true, inBand: false }),
      'highest-unannotated': state({ inBand: false, composerVisible: false }),
    };
    const input: PianoEngineInput = {
      ...base,
      analysis: {
        tracks: base.analysis.tracks.map((track) => ({
          ...track,
          compositionState: states[track.id],
        })),
      },
    };
    const candidates = analyzePianoInput(input).interpretations.leadPassages.candidates;

    expect(candidates.map((candidate) => candidate.instrument.id)).toEqual(['locked-out-of-band-lead']);
    expect(candidates[0].limitations.join(' ')).toMatch(/mute\/solo\/lock\/band gate/);
    expect(candidates.some((candidate) => candidate.instrument.id === 'highest-unannotated')).toBe(false);
  });

  it('is deterministic, preserves its input, and leaves harp as frozen read-only context', () => {
    const before = JSON.stringify(sourceInput);
    const harp = sourceInput.analysis.tracks.find((track) => track.role === 'harp');
    expect(harp).toBeDefined();
    expect(Object.isFrozen(harp)).toBe(true);
    expect(Object.isFrozen(harp!.notes)).toBe(true);
    expect(sourceInput.analysis.tracks.some((track) => track.role === 'piano')).toBe(false);

    const first = analyzePianoInput(sourceInput);
    const second = analyzePianoInput(sourceInput);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(sourceInput)).toBe(before);
    expect(first.observedFacts.instruments.find((item) => item.instrument.role === 'harp')?.instrument).toEqual({
      id: harp!.id,
      name: harp!.name,
      family: 'Keys',
      role: 'harp',
    });
    expect(first.observedFacts.instruments.some((item) => item.instrument.role === 'piano')).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
