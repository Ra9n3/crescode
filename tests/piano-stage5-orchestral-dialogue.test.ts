import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { hashString } from '../src/engine/generate';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import {
  composePianoPlan,
  composePianoScore,
  type PianoComposerPlan,
  type PianoPhraseIntention,
} from '../src/orchestrator/keys/piano-composer';
import { validatePianoScorePlayability } from '../src/orchestrator/keys/piano-playability';
import type { PianoAnalysisTrack, PianoAnalysisTrackCompositionState } from '../src/orchestrator/keys/analysis';
import type { PianoEngineInput, PianoLeadWindow } from '../src/orchestrator/keys/piano-engine';
import type { PianoScore } from '../src/orchestrator/keys/piano-score';
import { isInstrumentTrack, projectFromFixture, type Project, type Track } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';
import { PPQ } from '../src/shared/schema/types';

const TEMPLATE_IDS = [
  'ensemble.chamber',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.cinematic',
  'ensemble.hybridstudio',
] as const;
type TemplateId = (typeof TEMPLATE_IDS)[number];

interface ProductionSample {
  readonly project: Project;
  readonly piano: Track;
  readonly input: PianoEngineInput;
}

interface LeadScenario {
  readonly input: PianoEngineInput;
  readonly phrase: PianoPhraseIntention;
  readonly leadId: string;
  readonly leadTrack: PianoAnalysisTrack;
  readonly harmonyChord: PianoEngineInput['context']['harmony'][number];
}

const samples = new Map<string, ProductionSample>();
const visibleState: PianoAnalysisTrackCompositionState = {
  locked: false,
  muted: false,
  soloed: false,
  inBand: true,
  mixerAudible: true,
  composerVisible: true,
};

function productionSample(templateId: TemplateId, seed = 17): ProductionSample {
  const key = `${templateId}:${seed}`;
  const cached = samples.get(key);
  if (cached) return cached;
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed, density: 1, moments: false });
  const piano = result.tracks.find((track) => isInstrumentTrack(track)
    && track.family === 'Keys' && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} did not create an unlocked Piano target.`);
  const sample = { project, piano, input: result.pianoEngineInput };
  samples.set(key, sample);
  return sample;
}

function seededInput(input: PianoEngineInput, userSeed: number): PianoEngineInput {
  const previous = input.context.generationIdentity;
  const normalizedSeed = Math.trunc(userSeed);
  const key = [
    previous.algorithm,
    `orchestrationSeed=${previous.orchestrationSeed >>> 0}`,
    `userSeed=${normalizedSeed}`,
    `take=${previous.take}`,
    `density=${previous.density.toFixed(3)}`,
  ].join('|');
  const generationIdentity = {
    ...previous,
    key,
    userSeed: normalizedSeed,
    seed: hashString(key),
  };
  return {
    ...input,
    context: { ...input.context, generationIdentity, seed: generationIdentity.seed },
  };
}

function pianoOnlyInput(sample: ProductionSample, userSeed = 17): PianoEngineInput {
  const seeded = seededInput(sample.input, userSeed);
  return {
    ...seeded,
    context: {
      ...seeded.context,
      moments: [],
      fillWindows: [],
      leadWindows: [],
      layerInformation: {
        ...seeded.context.layerInformation,
        perBar: seeded.context.layerInformation.perBar.map((bar) => ({ ...bar, layers: [] })),
      },
    },
    analysis: { tracks: [] },
  };
}

function developmentPhrase(plan: PianoComposerPlan): PianoPhraseIntention {
  const phrase = plan.phrases.find((candidate) =>
    (candidate.function === 'development' || candidate.function === 'contrast' || candidate.function === 'reprise')
    && candidate.endTick - candidate.startTick >= 2 * PPQ);
  if (phrase) return phrase;
  const fallback = plan.phrases.find((candidate) => candidate.endTick - candidate.startTick >= 2 * PPQ
    && candidate.function !== 'arrival' && candidate.function !== 'release'
    && candidate.function !== 'statement-and-landing');
  if (!fallback) throw new Error('The fixture must supply a non-cadential Piano phrase for lead interaction.');
  return fallback;
}

function upperPitchForPitchClass(pitchClass: number): number {
  for (let pitch = 84; pitch <= 96; pitch++) {
    if (((pitch % 12) + 12) % 12 === pitchClass) return pitch;
  }
  return pitchClass + 72;
}

function trackWithNotes(
  id: string,
  family: PianoAnalysisTrack['family'],
  role: string,
  notes: PianoAnalysisTrack['notes'],
): PianoAnalysisTrack {
  return {
    id,
    name: id,
    family,
    role,
    notes,
    compositionState: visibleState,
  };
}

function leadScenario(
  sample: ProductionSample,
  userSeed: number,
  makeLeadNotes: (phrase: PianoPhraseIntention, input: PianoEngineInput, chord: LeadScenario['harmonyChord']) => PianoAnalysisTrack['notes'],
  makeOtherTracks: (phrase: PianoPhraseIntention, input: PianoEngineInput) => readonly PianoAnalysisTrack[] = () => [],
): LeadScenario {
  const baseInput = pianoOnlyInput(sample, userSeed);
  const basePlan = composePianoPlan(baseInput, analyzePianoInput(baseInput));
  const phrase = developmentPhrase(basePlan);
  const harmonyChord = baseInput.context.harmony.find((chord) =>
    chord.startTick >= phrase.startTick && chord.endTick <= phrase.endTick
      && chord.endTick - chord.startTick >= PPQ * 2)
    ?? baseInput.context.harmony.find((chord) => chord.startTick < phrase.endTick
      && chord.endTick > phrase.startTick && chord.endTick - chord.startTick >= PPQ * 2);
  if (!harmonyChord) throw new Error('The fixture must supply a two-beat resolved chord inside a Piano phrase.');

  const leadId = 'stage5-explicit-clarinet-lead';
  const leadNotes = makeLeadNotes(phrase, baseInput, harmonyChord);
  const leadTrack = trackWithNotes(leadId, 'Woodwinds', 'clarinets', leadNotes);
  const leadWindow: PianoLeadWindow = {
    trackId: leadId,
    family: 'Woodwinds',
    startTick: phrase.startTick,
    endTick: phrase.endTick,
    source: 'winds-plan',
  };
  const energy = baseInput.context.energy.map((barEnergy) => {
    const bar = baseInput.context.barWindows.find((candidate) => candidate.bar === barEnergy.bar);
    return bar && bar.startTick < phrase.endTick && bar.endTick > phrase.startTick
      ? { ...barEnergy, target: Math.max(0.76, barEnergy.target), nearSilence: false }
      : barEnergy;
  });
  const input: PianoEngineInput = {
    ...baseInput,
    context: {
      ...baseInput.context,
      energy,
      leadWindows: [leadWindow],
      moments: [],
      fillWindows: [],
      layerInformation: {
        ...baseInput.context.layerInformation,
        perBar: baseInput.context.layerInformation.perBar.map((bar) => ({ ...bar, layers: [] })),
      },
    },
    analysis: { tracks: [leadTrack, ...makeOtherTracks(phrase, baseInput)] },
  };
  return { input, phrase, leadId, leadTrack, harmonyChord };
}

function planAndScore(sample: ProductionSample, input: PianoEngineInput) {
  const analyzer = analyzePianoInput(input);
  const plan = composePianoPlan(input, analyzer);
  const score = composePianoScore(input, plan, sample.piano, projectEndTick(sample.project));
  return { analyzer, plan, score };
}

function unitRandom(seed: number, label: string): number {
  let hash = (seed ^ 0x811c9dc5) >>> 0;
  for (let index = 0; index < label.length; index++) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash += 0x6d2b79f5;
  let value = hash;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function scoreSignature(score: PianoScore): string {
  return score.events.map((event) => [event.pitch, event.startTick, event.durationTicks,
    event.voiceId, event.techniqueIntent].join(':')).join('|');
}

describe('Piano Stage 5 orchestral dialogue and intelligent accompaniment', () => {
  it('projects real Compose All lead assignments and writes only a single lower chord-tone under them', () => {
    const sample = productionSample('ensemble.sonata', 17);
    expect(sample.input.context.leadWindows.length).toBeGreaterThan(0);
    expect(sample.input.context.leadWindows.every((window) =>
      ['strings-layer', 'brass-plan', 'winds-plan'].includes(window.source))).toBe(true);

    const { analyzer, plan, score } = planAndScore(sample, sample.input);
    const candidates = analyzer.interpretations.leadPassages.candidates;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((candidate) => sample.input.context.leadWindows.some((window) =>
      window.trackId === candidate.instrument.id && window.source === candidate.source))).toBe(true);

    const supported = plan.harmonicEvents.filter((event) =>
      event.orchestration.leadResponse?.mode === 'restrained-accompaniment');
    expect(supported.length).toBeGreaterThan(0);
    expect(score.events.length).toBeGreaterThan(0);
    const supportedChordIds = new Set(supported.map((event) => event.chord.id));
    const supportNotes = score.events.filter((event) => event.harmonicContext.chordIds
      .some((chordId) => supportedChordIds.has(chordId)));
    expect(supportNotes.length).toBeGreaterThan(0);
    expect(supportNotes.every((event) => event.hand === 'left'
      && event.voiceId === 'lh.support'
      && event.harmonicContext.pitchClasses.includes(event.pitch % 12))).toBe(true);
    expect(score.events.some((event) => event.voiceId === 'rh.melody'
      && plan.harmonicEvents.some((harmonicEvent) =>
        harmonicEvent.orchestration.explicitLeadTrackIds.length > 0
        && event.startTick >= harmonicEvent.chord.startTick
        && event.startTick < harmonicEvent.chord.endTick))).toBe(false);
  });

  it('observes explicit lead-plan note, rhythm, register, and gap facts without treating rests as piano commands', () => {
    const sample = productionSample('ensemble.sonata');
    const scenario = leadScenario(sample, 29, (phrase, _input, chord) => [
      {
        pitch: upperPitchForPitchClass(chord.parsed.pitchClasses[0]),
        startTick: Math.max(phrase.startTick, chord.startTick) + PPQ / 4,
        durationTicks: PPQ / 4,
        velocity: 74,
      },
    ]);
    const { analyzer } = planAndScore(sample, scenario.input);
    const candidate = analyzer.interpretations.leadPassages.candidates
      .find((passage) => passage.instrument.id === scenario.leadId);

    expect(candidate).toBeDefined();
    expect(candidate).toMatchObject({
      source: 'winds-plan',
      instrument: { family: 'Woodwinds', role: 'clarinets' },
      mandatoryPianoInstruction: false,
      pitchRange: {
        lowestPitch: scenario.leadTrack.notes[0].pitch,
        highestPitch: scenario.leadTrack.notes[0].pitch,
      },
    });
    expect(candidate!.rhythm.onsetTicks).toContain(scenario.leadTrack.notes[0].startTick);
    expect(candidate!.gapWindows.some((gap) => gap.startTick > scenario.phrase.startTick
      && gap.durationTicks >= PPQ)).toBe(true);
    expect(analyzer.interpretations.responseOpportunities.availability).toBe('unavailable');
    expect(analyzer.interpretations.responseOpportunities.reason).toMatch(/only the Composer selects a response/);
  });

  it('supports a solo high-register lead with quiet lower chord tones and no Piano melody doubling', () => {
    const sample = productionSample('ensemble.sonata');
    const scenario = leadScenario(sample, 31, (phrase) => [{
      pitch: 84,
      startTick: phrase.startTick,
      durationTicks: phrase.endTick - phrase.startTick,
      velocity: 72,
    }]);
    const { plan, score } = planAndScore(sample, scenario.input);
    const supportedEvents = plan.harmonicEvents.filter((event) =>
      event.orchestration.leadResponse?.mode === 'restrained-accompaniment');
    const supportedChordIds = new Set(supportedEvents.map((event) => event.chord.id));
    const accompaniment = score.events.filter((event) => event.harmonicContext.chordIds
      .some((chordId) => supportedChordIds.has(chordId)));

    expect(plan.template.style.identity).toBe('sonata-dialogue');
    expect(supportedEvents.length).toBeGreaterThan(0);
    expect(supportedEvents.every((event) => event.orchestration.leadResponse?.harmonyCompatibility === 'supplied-chord-tones')).toBe(true);
    expect(accompaniment.length).toBeGreaterThan(0);
    expect(accompaniment.every((event) => event.hand === 'left'
      && event.pitch <= 84 - 7
      && event.harmonicContext.pitchClasses.includes(event.pitch % 12))).toBe(true);
    for (const event of accompaniment) {
      expect(event.harmonicContext.pitchClasses).toContain(event.pitch % 12);
    }
    const notesPerChord = new Map<string, number>();
    for (const event of accompaniment) {
      const chordId = event.harmonicContext.chordIds[0];
      notesPerChord.set(chordId, (notesPerChord.get(chordId) ?? 0) + 1);
    }
    expect([...notesPerChord.values()].every((count) => count <= 2)).toBe(true);
    expect(score.events.some((event) => event.phraseId === scenario.phrase.id
      && event.voiceId === 'rh.melody')).toBe(false);
    expect(score.rests.some((rest) => rest.phraseId === scenario.phrase.id
      && rest.voiceId === 'rh.melody')).toBe(true);
    expect(validatePianoScorePlayability(score, {
      lowestNote: sample.piano.lowestNote,
      highestNote: sample.piano.highestNote,
    }).violations).toEqual([]);
  });

  it('places at most one complementary answer in a real lead gap, in the selected harmony and a separate register', () => {
    const sample = productionSample('ensemble.sonata');
    const base = pianoOnlyInput(sample, 1);
    const basePlan = composePianoPlan(base, analyzePianoInput(base));
    const phrase = developmentPhrase(basePlan);
    const chord = base.context.harmony.find((item) => item.startTick >= phrase.startTick
      && item.endTick <= phrase.endTick && item.endTick - item.startTick >= 2 * PPQ)
      ?? base.context.harmony.find((item) => item.startTick < phrase.endTick
        && item.endTick > phrase.startTick && item.endTick - item.startTick >= 2 * PPQ);
    if (!chord) throw new Error('No long resolved chord span is available for the lead-gap fixture.');
    const userSeed = Array.from({ length: 128 }, (_, index) => index + 1).find((seed) => {
      const identity = seededInput(base, seed).context.generationIdentity;
      const candidateId = `stage5-explicit-clarinet-lead:${phrase.startTick}-${phrase.endTick}:winds-plan`;
      return unitRandom(identity.seed, `lead-gap-answer:${candidateId}:${chord.id}`) < 0.28;
    });
    if (userSeed === undefined) throw new Error('The deterministic response fixture needs a seed in the search window.');
    const scenario = leadScenario(sample, userSeed, (selectedPhrase, _input, selectedChord) => [{
      pitch: upperPitchForPitchClass(selectedChord.parsed.pitchClasses[0]),
      startTick: Math.max(selectedPhrase.startTick, selectedChord.startTick) + PPQ / 4,
      durationTicks: PPQ / 4,
      velocity: 76,
    }]);
    const { plan, score } = planAndScore(sample, scenario.input);
    const answerEvents = plan.harmonicEvents.filter((event) =>
      event.orchestration.leadResponse?.mode === 'answer-in-gap');
    const answerChordIds = new Set(answerEvents.map((event) => event.chord.id));
    const answers = score.events.filter((event) => event.techniqueIntent === 'independent-counterline'
      && event.noteRoleTag === 'answer'
      && event.harmonicContext.chordIds.some((chordId) => answerChordIds.has(chordId)));

    expect(answerEvents.length).toBe(1);
    expect(answers).toHaveLength(1);
    const response = answerEvents[0].orchestration.leadResponse!;
    expect(response.selectedGap).not.toBeNull();
    expect(answers[0].startTick).toBeGreaterThanOrEqual(response.selectedGap!.startTick);
    expect(answers[0].startTick + answers[0].durationTicks).toBeLessThanOrEqual(response.selectedGap!.endTick);
    expect(answers[0].pitch).toBeLessThanOrEqual(response.leadPitchRange!.lowestPitch - 7);
    expect(answers[0].harmonicContext.pitchClasses).toContain(answers[0].pitch % 12);
    const leadChordIds = new Set(plan.harmonicEvents.filter((event) =>
      event.orchestration.explicitLeadTrackIds.includes(scenario.leadId)).map((event) => event.chord.id));
    const answersDuringLead = score.events.filter((event) => event.techniqueIntent === 'independent-counterline'
      && event.noteRoleTag === 'answer'
      && event.harmonicContext.chordIds.some((chordId) => leadChordIds.has(chordId)));
    expect(answersDuringLead).toHaveLength(1);
    expect(validatePianoScorePlayability(score, {
      lowestNote: sample.piano.lowestNote,
      highestNote: sample.piano.highestNote,
    }).violations).toEqual([]);
  });

  it('chooses silence for register overlap or crowded activity rather than forcing a response', () => {
    const sample = productionSample('ensemble.chamber');
    const lowLead = leadScenario(sample, 37, (phrase) => [{
      pitch: 54,
      startTick: phrase.startTick,
      durationTicks: phrase.endTick - phrase.startTick,
      velocity: 70,
    }]);
    const lowResult = planAndScore(sample, lowLead.input);
    const lowLeadEvents = lowResult.plan.harmonicEvents.filter((event) =>
      event.orchestration.explicitLeadTrackIds.includes(lowLead.leadId));
    expect(lowLeadEvents.length).toBeGreaterThan(0);
    expect(lowLeadEvents.every((event) => event.orchestration.leadResponse?.mode === 'silence')).toBe(true);
    const lowChordIds = new Set(lowLeadEvents.map((event) => event.chord.id));
    expect(lowResult.score.events.some((event) => event.harmonicContext.chordIds
      .some((chordId) => lowChordIds.has(chordId)))).toBe(false);

    const crowded = leadScenario(sample, 41, (phrase) => [{
      pitch: 84,
      startTick: phrase.startTick,
      durationTicks: phrase.endTick - phrase.startTick,
      velocity: 72,
    }], (phrase) => Array.from({ length: 4 }, (_, index) => trackWithNotes(
      `stage5-crowd-${index}`,
      'Strings',
      `violins${index + 1}`,
      [{
        pitch: 76 + index,
        startTick: phrase.startTick + index * 30,
        durationTicks: phrase.endTick - phrase.startTick,
        velocity: 68,
      }],
    )));
    const crowdedResult = planAndScore(sample, crowded.input);
    const crowdedEvents = crowdedResult.plan.harmonicEvents.filter((event) =>
      event.orchestration.explicitLeadTrackIds.includes(crowded.leadId));
    expect(crowdedEvents.length).toBeGreaterThan(0);
    expect(crowdedEvents.every((event) => event.orchestration.leadResponse?.mode === 'silence')).toBe(true);
    const crowdedChordIds = new Set(crowdedEvents.map((event) => event.chord.id));
    expect(crowdedResult.score.events.some((event) => event.harmonicContext.chordIds
      .some((chordId) => crowdedChordIds.has(chordId)))).toBe(false);
  });

  it('retains standalone Piano writing, all five template identities, deterministic seeds, and playability', () => {
    const signatures = new Set<string>();
    const identities = new Set<string>();
    for (const [index, templateId] of TEMPLATE_IDS.entries()) {
      const sample = productionSample(templateId, 17);
      const standalone = pianoOnlyInput(sample, 11 + index);
      const { plan, score } = planAndScore(sample, standalone);
      identities.add(plan.template.style.identity);
      expect(plan.harmonicEvents.every((event) => event.orchestration.leadResponse?.mode === 'none')).toBe(true);
      expect(score.events.some((event) => event.voiceId === 'rh.melody')).toBe(true);
      expect(score.events.length).toBeGreaterThan(0);
      expect(validatePianoScorePlayability(score, {
        lowestNote: sample.piano.lowestNote,
        highestNote: sample.piano.highestNote,
      }).violations).toEqual([]);
      if (templateId === 'ensemble.chamber') signatures.add(scoreSignature(score));
    }
    expect(identities.size).toBe(TEMPLATE_IDS.length);

    const chamber = productionSample('ensemble.chamber');
    const alternateSeeds = [11, 29, 47].map((seed) => {
      const input = pianoOnlyInput(chamber, seed);
      return planAndScore(chamber, input).score;
    });
    expect(new Set(alternateSeeds.map(scoreSignature)).size).toBeGreaterThan(1);
    const replay = planAndScore(chamber, pianoOnlyInput(chamber, 29)).score;
    expect(scoreSignature(replay)).toBe(scoreSignature(alternateSeeds[1]));
  });
});
