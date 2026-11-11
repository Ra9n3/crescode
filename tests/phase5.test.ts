import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, type PianoComposerPlan } from '../src/orchestrator/keys/piano-composer';
import type { PianoAnalysis, PianoAnalysisTrack } from '../src/orchestrator/keys/analysis';
import type {
  PianoBarWindow,
  PianoEnergyBar,
  PianoEngineInput,
  PianoLayerInformation,
  PianoRelevantMoment,
  PianoTemplateRule,
} from '../src/orchestrator/keys/piano-engine';
import type { SpineSection } from '../src/orchestrator/spine';
import { projectFromFixture } from '../src/shared/schema';
import type { Project } from '../src/shared/schema/types';

const BAR_4_4 = 3840;
const EMPTY_ANALYSIS: PianoAnalysis = { tracks: [] };
const TEMPLATE_IDS = [
  'ensemble.chamber',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.cinematic',
  'ensemble.hybridstudio',
] as const;
type ComposerTemplateId = (typeof TEMPLATE_IDS)[number];

const RULES_BY_TEMPLATE: Record<ComposerTemplateId, readonly PianoTemplateRule[]> = {
  'ensemble.chamber': [
    { type: 'octaveDoubling', policy: 'climaxOnly', energyThreshold: 0.55, severity: 'soft', source: 'template.rules' },
    { type: 'fillGating', fills: 'piano', duringRestsOf: 'Strings', minGapTicks: 480, severity: 'hard', source: 'template.rules' },
  ],
  'ensemble.sonata': [
    { type: 'octaveDoubling', policy: 'forbidden', severity: 'hard', source: 'template.rules' },
    { type: 'fillGating', fills: 'piano', duringRestsOf: 'violins1', minGapTicks: 480, severity: 'hard', source: 'template.rules' },
  ],
  'ensemble.vocalbacking': [
    { type: 'octaveDoubling', policy: 'forbidden', severity: 'hard', source: 'template.rules' },
  ],
  'ensemble.cinematic': [
    { type: 'octaveDoubling', policy: 'allowed', severity: 'none', source: 'template.rules' },
  ],
  'ensemble.hybridstudio': [
    { type: 'octaveDoubling', policy: 'allowed', severity: 'none', source: 'template.rules' },
  ],
};

function buildSourceInput(): PianoEngineInput {
  const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  return composeAllTracks(project, { seed: 17 }).pianoEngineInput;
}

const sourceInput = buildSourceInput();

function inputWithContext(
  input: PianoEngineInput,
  patch: Partial<PianoEngineInput['context']>,
  analysis: PianoAnalysis = input.analysis,
): PianoEngineInput {
  return { context: { ...input.context, ...patch }, analysis };
}

function inputForTemplate(id: ComposerTemplateId): PianoEngineInput {
  return inputWithContext(sourceInput, {
    template: { id, pianoEligible: true },
    rules: RULES_BY_TEMPLATE[id],
  }, EMPTY_ANALYSIS);
}

function fourBarDevelopmentInput(): PianoEngineInput {
  const sectionId = 'phase5-study';
  const sections: SpineSection[] = [{
    id: sectionId,
    name: 'Study',
    index: 0,
    occurrence: 1,
    startBar: 1,
    lengthBars: 4,
    startTick: 0,
    endTick: BAR_4_4 * 4,
  }];
  const barWindows: PianoBarWindow[] = Array.from({ length: 4 }, (_, index) => ({
    bar: index + 1,
    startTick: index * BAR_4_4,
    endTick: (index + 1) * BAR_4_4,
    sectionId,
    sectionName: 'Study',
  }));
  const harmony = sourceInput.context.harmony.slice(0, 4).map((chord, index) => ({
    ...chord,
    id: `phase5-chord-${index + 1}`,
    startTick: index * BAR_4_4,
    endTick: (index + 1) * BAR_4_4,
  }));
  const energy: PianoEnergyBar[] = [
    { bar: 1, target: 0.2, nearSilence: false },
    { bar: 2, target: 0.8, nearSilence: false },
    { bar: 3, target: 0.35, nearSilence: true },
    { bar: 4, target: 0.7, nearSilence: false },
  ];
  const moments: PianoRelevantMoment[] = [{
    kind: 'soli',
    startBar: 2,
    endBar: 2,
    startTick: BAR_4_4,
    endTick: BAR_4_4 * 2,
    participantRoles: ['violins1'],
    shape: 'breath',
  }];
  const layerInformation: PianoLayerInformation = {
    ...sourceInput.context.layerInformation,
    perBar: barWindows.map(({ bar }) => ({ bar, layers: [] })),
  };
  return {
    context: {
      ...sourceInput.context,
      template: { id: 'ensemble.chamber', pianoEligible: true },
      sections,
      barWindows,
      harmony,
      energy,
      layerInformation,
      moments,
      fillWindows: [{ target: 'piano', startTick: 9000, endTick: 10000 }],
    },
    analysis: EMPTY_ANALYSIS,
  };
}

function noHarmonyInput(): PianoEngineInput {
  return inputWithContext(sourceInput, {
    template: { id: 'ensemble.chamber', pianoEligible: true },
    sections: [],
    barWindows: [],
    harmony: [],
    energy: [],
    moments: [],
    fillWindows: [],
  }, EMPTY_ANALYSIS);
}

function pitchClass(value: number): number {
  return ((value % 12) + 12) % 12;
}

function circularDistance(a: number, b: number): number {
  const distance = Math.abs(pitchClass(a) - pitchClass(b));
  return Math.min(distance, 12 - distance);
}

function planFor(input: PianoEngineInput): PianoComposerPlan {
  return composePianoPlan(input, analyzePianoInput(input));
}

describe('Piano Composer Phase 5 intention planning', () => {
  it('is seed-deterministic, reproduces creative choices, and changes them when only the composition seed changes', () => {
    const input = inputWithContext(sourceInput, { template: { id: 'ensemble.chamber', pianoEligible: true } }, EMPTY_ANALYSIS);
    const first = planFor(input);
    const repeated = planFor(input);

    expect(JSON.stringify(repeated)).toBe(JSON.stringify(first));
    expect(first.seed).toBe(input.context.seed);
    expect(first.containsMidiNotes).toBe(false);

    const alternateSeedInput = inputWithContext(input, { seed: input.context.seed + 1 }, EMPTY_ANALYSIS);
    const alternate = planFor(alternateSeedInput);
    expect(alternate.seed).toBe(input.context.seed + 1);
    expect(alternate.motif?.rhythmicWeights).not.toEqual(first.motif?.rhythmicWeights);
  });

  it('gives Chamber, Sonata, Vocal Backing, Cinematic, and Hybrid Studio distinct musical identities while copying policy rules separately', () => {
    const plans = new Map<ComposerTemplateId, PianoComposerPlan>();
    for (const id of TEMPLATE_IDS) {
      const input = inputForTemplate(id);
      const plan = planFor(input);
      plans.set(id, plan);
      expect(plan.template.id).toBe(id);
      expect(plan.template.style.identity).toBe(({
        'ensemble.chamber': 'chamber-counterpoint',
        'ensemble.sonata': 'sonata-dialogue',
        'ensemble.vocalbacking': 'vocal-space',
        'ensemble.cinematic': 'cinematic-expanse',
        'ensemble.hybridstudio': 'hybrid-pulse-and-color',
      } as const)[id]);
      expect(plan.templateConstraints.octaveDoubling).toBe(
        input.context.rules.find((rule) => rule.type === 'octaveDoubling')?.policy ?? 'not-specified',
      );
      expect(plan.templateConstraints.pianoFillGatingRules).toEqual(
        input.context.rules.filter((rule) => rule.type === 'fillGating'),
      );
      expect(plan.templateConstraints.fillSource).toBe('explicit-conductor-windows-only');
      expect(plan.containsMidiNotes).toBe(false);
    }

    const identities = TEMPLATE_IDS.map((id) => plans.get(id)!.template.style.identity);
    const rhythms = TEMPLATE_IDS.map((id) => plans.get(id)!.template.style.rhythmicCharacter);
    expect(new Set(identities).size).toBe(TEMPLATE_IDS.length);
    expect(new Set(rhythms).size).toBe(TEMPLATE_IDS.length);
    expect(plans.get('ensemble.chamber')!.template.style.leftHandRegister).toBe('bass');
    expect(plans.get('ensemble.sonata')!.template.style.rhythmicCharacter).toBe('speech-like');
    expect(plans.get('ensemble.vocalbacking')!.template.style.preferredRightHandVoices).toBe(2);
    expect(plans.get('ensemble.cinematic')!.template.style.preferredRightHandVoices).toBe(4);
    expect(plans.get('ensemble.hybridstudio')!.template.style.rhythmicCharacter).toBe('syncopated');

    const vocalEvent = plans.get('ensemble.vocalbacking')!.harmonicEvents.find((event) => event.chord.symbol === 'Dm9')!;
    const cinematicEvent = plans.get('ensemble.cinematic')!.harmonicEvents.find((event) => event.chord.symbol === 'Dm9')!;
    expect(vocalEvent.voicing.rightHandPitchClasses.length).toBeLessThan(cinematicEvent.voicing.rightHandPitchClasses.length);
    expect(cinematicEvent.voicing.selectedExtensionPitchClasses.length).toBeGreaterThan(0);
  });

  it('keeps every selected voicing inside resolved harmony and develops a chord-relative motif with a genuine stepwise resolution', () => {
    const input = fourBarDevelopmentInput();
    const plan = planFor(input);

    expect(plan.harmonicEvents).toHaveLength(input.context.harmony.length);
    for (const event of plan.harmonicEvents) {
      const available = event.chord.availablePitchClasses;
      const rightHand = event.voicing.rightHandPitchClasses;
      expect(new Set(rightHand).size).toBe(rightHand.length);
      expect(rightHand.every((tone) => available.includes(tone))).toBe(true);
      expect(event.voicing.selectedExtensionPitchClasses.every((tone) =>
        available.includes(tone) && rightHand.includes(tone))).toBe(true);
      expect(event.voicing.omittedChordPitchClasses.every((tone) => available.includes(tone))).toBe(true);
      expect(event.chord.rootPitchClass).toBe(pitchClass(input.context.harmony.find((chord) => chord.id === event.chord.id)!.parsed.root));
      const sourceChord = input.context.harmony.find((chord) => chord.id === event.chord.id)!;
      if (sourceChord.parsed.bass !== null) {
        expect(event.voicing.leftHandBassPitchClass).toBe(pitchClass(sourceChord.parsed.bass));
      } else {
        expect(available).toContain(event.voicing.leftHandBassPitchClass);
      }
    }

    const motif = plan.motif!;
    const [origin, next] = input.context.harmony;
    const originTones = origin.parsed.pitchClasses.map(pitchClass);
    const nextTones = next.parsed.pitchClasses.map(pitchClass);
    const anchor = motif.tones.find((tone) => tone.position === 0)!;
    const target = motif.tones.find((tone) => tone.position === 1)!;
    const neighbor = motif.tones.find((tone) => tone.position === 2)!;
    const resolution = motif.tones.find((tone) => tone.position === 3)!;
    expect(motif.originChordId).toBe(origin.id);
    expect(originTones).toContain(anchor.pitchClass);
    expect(nextTones).toContain(target.pitchClass);
    expect(nextTones).toContain(resolution.pitchClass);
    expect(motif.rhythmicWeights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    expect(motif.intervalContour).toHaveLength(3);
    if (motif.tensionResolution.kind === 'chromatic-neighbor') {
      expect(nextTones).not.toContain(neighbor.pitchClass);
      expect(motif.tensionResolution.position).toBe(2);
      expect(motif.tensionResolution.resolvesAt).toBe(3);
      expect(circularDistance(neighbor.pitchClass, resolution.pitchClass)).toBeLessThanOrEqual(2);
      expect(neighbor.function).toBe('chromatic-neighbor');
      expect(resolution.function).toBe('resolution');
    } else {
      expect(neighbor.function).toBe('chord-tone');
      expect(resolution.function).toBe('chord-tone');
    }
  });

  it('uses common tones and minimum pitch-class motion to lead adjacent voicings instead of resetting each chord', () => {
    const input = inputWithContext(sourceInput, { template: { id: 'ensemble.chamber', pianoEligible: true } }, EMPTY_ANALYSIS);
    const events = planFor(input).harmonicEvents;
    expect(events.length).toBeGreaterThan(3);
    expect(events[0].voiceLeading).toMatchObject({ fromChordId: null, totalSemitoneMotion: null, strategy: 'opening-voicing' });

    let retainedTransitions = 0;
    for (let index = 1; index < events.length; index++) {
      const previous = events[index - 1];
      const current = events[index];
      const expectedCommon = current.voicing.rightHandPitchClasses
        .filter((tone) => previous.voicing.rightHandPitchClasses.includes(tone));
      expect(current.voiceLeading.fromChordId).toBe(previous.chord.id);
      expect(current.voiceLeading.commonPitchClasses).toEqual(expectedCommon);
      expect(current.voiceLeading.totalSemitoneMotion).not.toBeNull();
      expect(current.voiceLeading.totalSemitoneMotion!).toBeGreaterThanOrEqual(0);
      expect(current.voiceLeading.bassSemitoneMotion).toBeGreaterThanOrEqual(0);
      expect(current.voiceLeading.bassSemitoneMotion).toBeLessThanOrEqual(6);
      if (expectedCommon.length) {
        retainedTransitions++;
        expect(current.voiceLeading.strategy).toBe('retain-common-tones');
      } else if (current.voiceLeading.totalSemitoneMotion! <= 5) {
        expect(current.voiceLeading.strategy).toBe('stepwise-revoicing');
      } else {
        expect(current.voiceLeading.strategy).toBe('intentional-reframe');
      }
    }
    expect(retainedTransitions).toBeGreaterThan(0);
  });

  it('develops phrases from source boundaries, energy turns, moments, and explicit fills, then shapes an arrival and ending', () => {
    const input = fourBarDevelopmentInput();
    const plan = planFor(input);

    expect(plan.sectionIntentions).toHaveLength(1);
    expect(plan.sectionIntentions[0].startTick).toBe(0);
    expect(plan.sectionIntentions[0].endTick).toBe(BAR_4_4 * 4);
    expect(plan.phrases.length).toBeGreaterThanOrEqual(5);
    for (const phrase of plan.phrases) {
      expect(phrase.dynamics.peak).toBeGreaterThanOrEqual(phrase.dynamics.entry);
      expect(phrase.dynamics.peak).toBeGreaterThanOrEqual(phrase.dynamics.exit);
    }
    expect(plan.phrases[0].boundaryEvidence).toContain('section-entry');
    expect(plan.phrases.some((phrase) => phrase.boundaryEvidence.includes('moment:soli:start'))).toBe(true);
    expect(plan.phrases.some((phrase) => phrase.boundaryEvidence.includes('explicit-fill-window:start'))).toBe(true);
    expect(plan.phrases.some((phrase) => phrase.boundaryEvidence.includes('existing-energy-arc-turn'))).toBe(true);
    expect(plan.phrases[0].motif.operation).toBe('introduce');
    expect(plan.phrases.some((phrase) => phrase.function === 'contrast')).toBe(true);
    expect(plan.phrases[plan.phrases.length - 1].function).toBe('arrival');
    expect(plan.phrases[plan.phrases.length - 1].motif.operation).toBe('fragment-to-landing');
    expect(new Set(plan.phrases.map((phrase) => phrase.motif.operation)).size).toBeGreaterThan(1);

    const breathingPhrase = plan.phrases.find((phrase) => phrase.dynamics.sourceEnergy.nearSilence)!;
    expect(breathingPhrase.dynamics.shape).toBe('suspended-breath');
    expect(breathingPhrase.intendedDensity).toBe('very-sparse');
    expect(breathingPhrase.dynamics.sourceEnergy.entryTarget).not.toBeNull();
    expect(plan.harmonicEvents.at(-1)!.structuralRole).toBe('arrival');
    expect(plan.harmonicEvents[0].orchestration.analyzerEvidence).toBe('partial');
    expect(plan.ending).toMatchObject({
      availability: 'available',
      chordId: input.context.harmony.at(-1)!.id,
      tick: input.context.harmony.at(-1)!.endTick,
      cadenceInference: false,
    });
    expect(plan.structuralEvents.some((event) => event.kind === 'conductor-emphasis')).toBe(true);
    expect(plan.structuralEvents.some((event) => event.kind === 'release-after-near-silence')).toBe(true);
    expect(plan.structuralEvents.some((event) => event.kind === 'final-landing')).toBe(true);

    const multiSectionPlan = planFor(inputWithContext(sourceInput, {
      template: { id: 'ensemble.chamber', pianoEligible: true },
    }, EMPTY_ANALYSIS));
    expect(multiSectionPlan.sectionIntentions.map((section) => section.function)).toEqual(['opening', 'closing']);
    expect(multiSectionPlan.structuralEvents.some((event) => event.kind === 'section-transition')).toBe(true);

    const suspendedFinal = sourceInput.context.harmony.find((chord) => chord.symbol.includes('sus'))!;
    const suspendedInput = inputWithContext(input, {
      harmony: [
        ...input.context.harmony.slice(0, -1),
        { ...suspendedFinal, id: 'phase5-suspended-final', startTick: BAR_4_4 * 3, endTick: BAR_4_4 * 4 },
      ],
    }, EMPTY_ANALYSIS);
    const suspendedPlan = planFor(suspendedInput);
    expect(suspendedPlan.ending.intention).toBe('leave-color-open');
    expect(suspendedPlan.ending.reason).toMatch(/preserve its open color/);
  });

  it('uses Analyzer lead/activity evidence to yield, and exposes evidence missingness instead of treating it as silence', () => {
    const base = fourBarDevelopmentInput();
    const lead: PianoAnalysisTrack = {
      id: 'written-violin-lead',
      name: 'Written violin lead',
      family: 'Strings',
      role: 'violins1',
      notes: [{ pitch: 76, startTick: 120, durationTicks: 600, velocity: 84 }],
    };
    const leadInput = inputWithContext(base, {
      layerInformation: {
        ...base.context.layerInformation,
        perBar: [{
          bar: 1,
          layers: [{ layer: 'lead', trackIds: [lead.id], source: 'strings' }],
        }],
      },
    }, { tracks: [lead] });
    const leadReport = analyzePianoInput(leadInput);
    const leadPlan = composePianoPlan(leadInput, leadReport);
    const firstEvent = leadPlan.harmonicEvents[0];
    expect(leadReport.interpretations.leadPassages.candidates).toHaveLength(1);
    expect(firstEvent.orchestration.explicitLeadTrackIds).toContain(lead.id);
    expect(firstEvent.orchestration.activeTrackIds).toContain(lead.id);
    expect(firstEvent.orchestration.analyzerEvidence).toBe('available');
    expect(firstEvent.orchestration.interaction).toBe('leave-space');
    expect(firstEvent.orchestration.leadResponse?.mode).toBe('silence');
    expect(firstEvent.hands.right.motion).toBe('yield');
    expect(firstEvent.hands.right.density).toBe('very-sparse');

    const momentEvent = leadPlan.harmonicEvents.find((event) => event.chord.startTick === BAR_4_4)!;
    expect(momentEvent.orchestration.momentKinds).toContain('soli');
    expect(momentEvent.orchestration.interaction).toBe('yield-to-spotlight');
    expect(momentEvent.hands.right.motion).toBe('yield');

    const missingInput = inputWithContext(base, {
      barWindows: [],
      energy: [],
      moments: [],
      fillWindows: [{ target: 'piano', startTick: 100, endTick: 500 }],
    }, EMPTY_ANALYSIS);
    const missingPlan = planFor(missingInput);
    expect(missingPlan.harmonicEvents[0].orchestration.analyzerEvidence).toBe('unavailable');
    expect(missingPlan.harmonicEvents[0].orchestration.interaction).toBe('unavailable');
    expect(missingPlan.fillDecisions[0]).toMatchObject({
      decision: 'activity-evidence-unavailable',
      observedWrittenActivity: { availability: 'unavailable', activeTrackIds: [], onsetCount: 0 },
      mandatory: false,
    });
    expect(missingPlan.fillDecisions[0].rationale).toMatch(/do not infer a rest/);
  });

  it('honors exact unusual source tick windows and handles empty or ineligible inputs without inventing piano material', () => {
    const sectionId = 'seven-eight-section';
    const bars: PianoBarWindow[] = [
      { bar: 1, startTick: 0, endTick: 3360, sectionId, sectionName: '7/8' },
      { bar: 2, startTick: 3360, endTick: 6720, sectionId, sectionName: '7/8' },
    ];
    const section: SpineSection = {
      id: sectionId,
      name: '7/8',
      index: 0,
      occurrence: 1,
      startBar: 1,
      lengthBars: 2,
      startTick: 0,
      endTick: 6720,
    };
    const harmony = sourceInput.context.harmony.slice(0, 2).map((chord, index) => ({
      ...chord,
      startTick: index * 3360,
      endTick: (index + 1) * 3360,
    }));
    const sevenEightInput = inputWithContext(sourceInput, {
      template: { id: 'ensemble.chamber', pianoEligible: true },
      sections: [section],
      barWindows: bars,
      harmony,
      energy: [
        { bar: 1, target: 0.4, nearSilence: false },
        { bar: 2, target: 0.6, nearSilence: false },
      ],
      moments: [],
      fillWindows: [],
    }, EMPTY_ANALYSIS);
    const sevenEightPlan = planFor(sevenEightInput);
    expect(sevenEightPlan.phrases).toHaveLength(1);
    expect(sevenEightPlan.phrases[0]).toMatchObject({ startTick: 0, endTick: 6720 });
    expect(sevenEightPlan.harmonicEvents.map((event) => [event.chord.startTick, event.chord.endTick])).toEqual([
      [0, 3360], [3360, 6720],
    ]);

    const emptyPlan = planFor(noHarmonyInput());
    expect(emptyPlan.status).toBe('insufficient-harmony');
    expect(emptyPlan.motif).toBeNull();
    expect(emptyPlan.phrases).toEqual([]);
    expect(emptyPlan.harmonicEvents).toEqual([]);
    expect(emptyPlan.ending.intention).toBe('unavailable');

    const adaptiveInput = inputWithContext(sourceInput, {
      template: { id: 'ensemble.custom-adaptive', pianoEligible: true },
      rules: [],
    }, EMPTY_ANALYSIS);
    expect(planFor(adaptiveInput).template.style.identity).toBe('adaptive-spacious');

    const ineligibleInput = inputWithContext(sourceInput, {
      template: { id: 'ensemble.symphony', pianoEligible: false },
      rules: [],
    }, EMPTY_ANALYSIS);
    const ineligible = planFor(ineligibleInput);
    expect(ineligible.status).toBe('ineligible');
    expect(ineligible.sectionIntentions).toEqual([]);
    expect(ineligible.phrases).toEqual([]);
    expect(ineligible.motif).toBeNull();
    expect(ineligible.harmonicEvents).toEqual([]);
    expect(ineligible.fillDecisions).toEqual([]);
    expect(ineligible.ending.reason).toMatch(/piano ineligible/);
  });

  it('deep-freezes only its own plan and does not mutate or freeze caller input, Analyzer output, or other instruments', () => {
    const mutableInput = JSON.parse(JSON.stringify(fourBarDevelopmentInput())) as PianoEngineInput;
    const activeOtherInstrument: PianoAnalysisTrack = {
      id: 'read-only-oboe',
      name: 'Read-only oboe',
      family: 'Woodwinds',
      role: 'oboes',
      notes: [{ pitch: 71, startTick: 80, durationTicks: 240, velocity: 72 }],
    };
    const input = { ...mutableInput, analysis: { tracks: [activeOtherInstrument] } };
    const inputBefore = JSON.stringify(input);
    const contextRulesBefore = JSON.stringify(input.context.rules);
    const firstContextRule = input.context.rules[0];
    expect(Object.isFrozen(firstContextRule)).toBe(false);

    const report = analyzePianoInput(input);
    const reportBefore = JSON.stringify(report);
    const plan = composePianoPlan(input, report);

    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(JSON.stringify(input.context.rules)).toBe(contextRulesBefore);
    expect(JSON.stringify(report)).toBe(reportBefore);
    expect(Object.isFrozen(firstContextRule)).toBe(false);
    expect(plan.templateConstraints.pianoFillGatingRules[0]).not.toBe(firstContextRule);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.harmonicEvents[0].voicing.rightHandPitchClasses)).toBe(true);
    expect(plan.harmonicEvents[0].orchestration.activeTrackIds).toContain(activeOtherInstrument.id);
    expect(plan).not.toHaveProperty('tracks');
    expect(JSON.stringify(plan)).not.toMatch(/"(?:notes|velocity|midiNote)"\s*:/i);
    expect(input.analysis.tracks[0].notes[0]).toEqual({
      pitch: 71,
      startTick: 80,
      durationTicks: 240,
      velocity: 72,
    });
  });
});
