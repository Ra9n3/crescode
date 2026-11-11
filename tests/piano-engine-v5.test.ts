import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, type PianoComposerPlan } from '../src/orchestrator/keys/piano-composer';
import type { PianoAnalysisTrack, PianoAnalysisTrackCompositionState } from '../src/orchestrator/keys/analysis';
import type { PianoEngineInput } from '../src/orchestrator/keys/piano-engine';
import { realizePianoPlanWithAudit } from '../src/orchestrator/keys/piano-realizer';
import { isInstrumentTrack, projectFromFixture, type Project } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';

const PPQ = 960;
const BAR_TICKS = PPQ * 4;

function productionInput() {
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed: 19, density: 1, moments: false });
  const targetTrack = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  if (!targetTrack) throw new Error('The fixture has no Piano track.');
  return { project, input: result.pianoEngineInput, targetTrack };
}

function withQuietBar(input: PianoEngineInput, quietBar: number, nearSilence: boolean): PianoEngineInput {
  return {
    ...input,
    context: {
      ...input.context,
      energy: input.context.energy.map((entry) => ({
        ...entry,
        target: entry.bar === quietBar ? 0 : 0.65,
        nearSilence: entry.bar === quietBar && nearSilence,
      })),
      moments: [],
      fillWindows: [],
      layerInformation: {
        ...input.context.layerInformation,
        perBar: input.context.layerInformation.perBar.map((entry) => ({ ...entry, layers: [] })),
      },
    },
    // Isolate the quiet-bar rule from lead/mix evidence; no notes are inferred.
    analysis: { tracks: [] },
  };
}

function withoutSuspensions(plan: PianoComposerPlan): PianoComposerPlan {
  return {
    ...plan,
    harmonicEvents: plan.harmonicEvents.map((event) => ({ ...event, suspension: null })),
  };
}

describe('Piano Engine V5 production behavior', () => {
  it('uses only Composer-visible orchestration evidence and never infers an unannotated lead', () => {
    const { input } = productionInput();
    const window = input.context.barWindows[0];
    const state = (values: Partial<PianoAnalysisTrackCompositionState>): PianoAnalysisTrackCompositionState => ({
      locked: false,
      muted: false,
      soloed: false,
      inBand: true,
      mixerAudible: true,
      composerVisible: true,
      ...values,
    });
    const makeTrack = (
      id: string,
      role: string,
      pitch: number,
      compositionState: PianoAnalysisTrackCompositionState,
    ): PianoAnalysisTrack => ({
      id,
      name: id,
      family: 'Strings',
      role,
      notes: [{ pitch, startTick: window.startTick + 60, durationTicks: 180, velocity: 82 }],
      compositionState,
    });
    const visibleLockedOutOfBand = makeTrack('locked-visible', 'cellosBasses', 60, state({
      locked: true, inBand: false,
    }));
    const visibleUnannotatedHigh = makeTrack('unannotated-high', 'violins1', 127, state({}));
    const hiddenByMute = makeTrack('muted', 'violins2', 80, state({
      muted: true, mixerAudible: false, composerVisible: false,
    }));
    const hiddenBySolo = makeTrack('solo-excluded', 'violas', 82, state({
      mixerAudible: false, composerVisible: false,
    }));
    const hiddenOutOfBand = makeTrack('out-of-band', 'flutes', 84, state({
      inBand: false, composerVisible: false,
    }));
    const stateInput: PianoEngineInput = {
      ...input,
      context: {
        ...input.context,
        moments: [],
        fillWindows: [],
        layerInformation: {
          ...input.context.layerInformation,
          perBar: input.context.layerInformation.perBar.map((entry) => ({ ...entry, layers: [] })),
        },
      },
      analysis: {
        tracks: [visibleLockedOutOfBand, visibleUnannotatedHigh, hiddenByMute, hiddenBySolo, hiddenOutOfBand],
      },
    };
    const analyzer = analyzePianoInput(stateInput);
    const plan = composePianoPlan(stateInput, analyzer);
    const firstEvent = plan.harmonicEvents[0];

    expect(firstEvent.orchestration.activeTrackIds).toEqual(['locked-visible', 'unannotated-high']);
    expect(firstEvent.orchestration.explicitLeadTrackIds).toEqual([]);
    expect(firstEvent.orchestration.analyzerEvidence).toBe('available');
    expect(analyzer.interpretations.leadPassages.candidates).toEqual([]);
  });
});

describe('Piano Engine V5 explicit leave-space plans', () => {
  it('does not advertise motif attacks inside a fully reserved leave-space phrase', () => {
    const { input: production } = productionInput();
    const input: PianoEngineInput = {
      ...production,
      context: {
        ...production.context,
          layerInformation: {
          ...production.context.layerInformation,
          perBar: production.context.layerInformation.perBar.map((entry) => ({ ...entry, layers: [] })),
        },
      },
    };
    const plan = composePianoPlan(input, analyzePianoInput(input));
    const reservedPhrases = plan.phrases.filter((phrase) => plan.fillDecisions.some((fill) =>
      fill.target.toLowerCase() === 'piano'
      && fill.decision === 'leave-space'
      && fill.startTick <= phrase.startTick && fill.endTick >= phrase.endTick));

    expect(reservedPhrases.length).toBeGreaterThan(0);
    for (const phrase of reservedPhrases) {
      expect(phrase.rhythmicPlan.motifCells, phrase.id).toEqual([]);
      expect(phrase.rhythmicPlan.syncopation, phrase.id).toBeNull();
    }
    expect(reservedPhrases.some((phrase) => phrase.motif.operation !== 'withhold-under-lead'
      && phrase.dynamics.sourceEnergy.trajectory.some((point) => !point.nearSilence))).toBe(true);
  });
});

describe('Piano Engine V5 reprise variation', () => {
  it('recalls the established motif with a different phrase surface in repeated sections', () => {
    const { input } = productionInput();
    const repriseInput: PianoEngineInput = {
      ...input,
      context: {
        ...input.context,
        moments: [],
        fillWindows: [],
        layerInformation: {
          ...input.context.layerInformation,
          perBar: input.context.layerInformation.perBar.map((entry) => ({ ...entry, layers: [] })),
        },
      },
      analysis: { tracks: [] },
    };
    const plan = composePianoPlan(repriseInput, analyzePianoInput(repriseInput));
    const reprise = plan.phrases.find((phrase) => phrase.function === 'reprise');
    expect(reprise).toBeDefined();
    const repriseSection = plan.sectionIntentions.find((section) => section.sectionId === reprise!.sectionId);
    expect(repriseSection?.occurrence).toBeGreaterThan(1);
    const originalSection = plan.sectionIntentions.find((section) =>
      section.name === repriseSection!.name && section.occurrence === 1);
    expect(originalSection).toBeDefined();
    const originalStatement = plan.phrases.find((phrase) =>
      phrase.sectionId === originalSection!.sectionId && phrase.function === 'statement');

    expect(originalStatement).toBeDefined();
    expect(originalStatement!.motif.operation).toBe('introduce');
    expect(reprise!.motif.operation).toBe('fragmented-recall');
    expect(reprise!.motif.operation).not.toBe(originalStatement!.motif.operation);
    expect(reprise!.rhythmicPlan.motifCells?.some((cell) => cell.variation === 'fragment')).toBe(true);
    expect(reprise!.rhythmicPlan.motifCells).not.toEqual(originalStatement!.rhythmicPlan.motifCells);
  });
});

describe('Piano Engine V5 localized quiet-bar suppression', () => {
  it('isolates a supplied quiet bar while preserving phrase and note writing on adjacent bars', () => {
    const { project, input, targetTrack } = productionInput();
    const quietBarNumber = 6;
    const quietBar = input.context.barWindows.find((bar) => bar.bar === quietBarNumber)!;
    const quietInput = withQuietBar(input, quietBarNumber, true);
    const ordinaryZeroTargetInput = withQuietBar(input, quietBarNumber, false);
    const quietPlan = composePianoPlan(quietInput, analyzePianoInput(quietInput));
    const ordinaryPlan = composePianoPlan(ordinaryZeroTargetInput, analyzePianoInput(ordinaryZeroTargetInput));
    const quietPhrase = quietPlan.phrases.find((phrase) => phrase.startTick === quietBar.startTick);

    expect(quietPhrase).toBeDefined();
    expect(quietPhrase).toMatchObject({
      startTick: quietBar.startTick,
      endTick: quietBar.endTick,
      boundaryEvidence: expect.arrayContaining(['energy-near-silence:start', 'energy-near-silence:end']),
    });
    expect(quietPlan.phrases.some((phrase) => phrase.startTick === quietBar.startTick - BAR_TICKS
      && phrase.endTick === quietBar.startTick)).toBe(true);
    expect(quietPlan.phrases.some((phrase) => phrase.startTick === quietBar.endTick
      && phrase.endTick > quietBar.endTick)).toBe(true);
    expect(quietPlan.attackRestrictions).toContainEqual(expect.objectContaining({
      bar: quietBarNumber,
      startTick: quietBar.startTick,
      endTick: quietBar.endTick,
      reason: 'near-silence-zero-energy',
    }));
    expect(ordinaryPlan.attackRestrictions).toEqual([]);

    const quietRealization = realizePianoPlanWithAudit({
      plan: withoutSuspensions(quietPlan),
      targetTrack,
      projectEndTick: projectEndTick(project),
    });
    const ordinaryRealization = realizePianoPlanWithAudit({
      plan: withoutSuspensions(ordinaryPlan),
      targetTrack,
      projectEndTick: projectEndTick(project),
    });
    const startsInside = (note: { startTick: number }) =>
      note.startTick >= quietBar.startTick && note.startTick < quietBar.endTick;
    expect(quietRealization.notes.filter(startsInside)).toEqual([]);
    expect(ordinaryRealization.notes.filter(startsInside).length).toBeGreaterThan(0);
    for (const adjacentBar of [quietBarNumber - 1, quietBarNumber + 1]) {
      const adjacent = input.context.barWindows.find((bar) => bar.bar === adjacentBar)!;
      expect(quietRealization.notes.some((note) =>
        note.startTick >= adjacent.startTick && note.startTick < adjacent.endTick)).toBe(true);
    }
  });
});
