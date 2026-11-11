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
  readonly result: ReturnType<typeof composeAllTracks>;
}

interface ProductionSampleOptions {
  readonly sections?: readonly Project['sections'][number][];
  readonly moments?: boolean;
  readonly humanize?: boolean;
}

const STRUCTURAL_SECTION_LAYOUT: readonly Project['sections'][number][] = [
  { id: 'sec_intro', name: 'Intro', startBar: 1, lengthBars: 4 },
  { id: 'sec_verse', name: 'Verse', startBar: 5, lengthBars: 4 },
  { id: 'sec_prechorus', name: 'Pre-Chorus', startBar: 9, lengthBars: 4 },
  { id: 'sec_chorus', name: 'Chorus', startBar: 13, lengthBars: 8 },
  { id: 'sec_bridge', name: 'Bridge', startBar: 21, lengthBars: 4 },
  { id: 'sec_outro', name: 'Outro', startBar: 25, lengthBars: 4 },
  { id: 'sec_breakdown', name: 'Breakdown', startBar: 29, lengthBars: 4 },
  { id: 'sec_build', name: 'Build', startBar: 33, lengthBars: 4 },
  { id: 'sec_theme', name: 'Theme', startBar: 37, lengthBars: 2 },
  { id: 'sec_interlude', name: 'Interlude', startBar: 39, lengthBars: 2 },
];

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

function productionSample(
  templateId: TemplateId,
  seed = 17,
  options: ProductionSampleOptions = {},
): ProductionSample {
  const sectionKey = options.sections?.map((section) =>
    `${section.id}:${section.name}:${section.startBar}+${section.lengthBars}`).join(',') ?? 'fixture-sections';
  const key = `${templateId}:${seed}:${sectionKey}:moments=${options.moments ?? false}:humanize=${options.humanize ?? false}`;
  const cached = samples.get(key);
  if (cached) return cached;
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  if (options.sections) project.sections = options.sections.map((section) => ({ ...section }));
  const result = composeAllTracks(project, {
    seed,
    density: 1,
    moments: options.moments ?? false,
    ...(options.humanize === undefined ? {} : { humanize: options.humanize }),
  });
  const piano = result.tracks.find((track) => isInstrumentTrack(track)
    && track.family === 'Keys' && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} did not create an unlocked Piano target.`);
  const sample = { project, piano, input: result.pianoEngineInput, result };
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
  it('projects real Compose All lead assignments and writes lower chord-tone support beneath them', () => {
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

  it('yields only when the lead occupies the Piano support range; upper-register crowding leaves room below', () => {
    const sample = productionSample('ensemble.chamber');
    const lowLead = leadScenario(sample, 37, (phrase) => [{
      pitch: 42,
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

    const middleLead = leadScenario(sample, 39, (phrase) => [{
      pitch: 59,
      startTick: phrase.startTick,
      durationTicks: phrase.endTick - phrase.startTick,
      velocity: 70,
    }]);
    const middleResult = planAndScore(sample, middleLead.input);
    const middleLeadEvents = middleResult.plan.harmonicEvents.filter((event) =>
      event.orchestration.explicitLeadTrackIds.includes(middleLead.leadId));
    expect(middleLeadEvents.length).toBeGreaterThan(0);
    expect(middleLeadEvents.every((event) =>
      event.orchestration.leadResponse?.mode === 'restrained-accompaniment')).toBe(true);

    const crowded = leadScenario(sample, 41, (phrase) => [{
      pitch: 84,
      startTick: phrase.startTick,
      durationTicks: phrase.endTick - phrase.startTick,
      velocity: 72,
    }], (phrase) => [
      ...Array.from({ length: 4 }, (_, index) => trackWithNotes(
        `stage5-crowd-${index}`,
        'Strings',
        `violins${index + 1}`,
        [{
          pitch: 76 + index,
          startTick: phrase.startTick + index * 30,
          durationTicks: phrase.endTick - phrase.startTick,
          velocity: 68,
        }],
      )),
      trackWithNotes('stage5-low-foundation', 'Strings', 'cellosBasses', [{
        pitch: 32,
        startTick: phrase.startTick,
        durationTicks: phrase.endTick - phrase.startTick,
        velocity: 64,
      }]),
    ]);
    const crowdedResult = planAndScore(sample, crowded.input);
    const crowdedEvents = crowdedResult.plan.harmonicEvents.filter((event) =>
      event.orchestration.explicitLeadTrackIds.includes(crowded.leadId));
    expect(crowdedEvents.length).toBeGreaterThan(0);
    expect(crowdedEvents.every((event) =>
      event.orchestration.leadResponse?.mode === 'restrained-accompaniment')).toBe(true);
    const crowdedChordIds = new Set(crowdedEvents.map((event) => event.chord.id));
    const lowerSupport = crowdedResult.score.events.filter((event) =>
      event.harmonicContext.chordIds.some((chordId) => crowdedChordIds.has(chordId)));
    expect(lowerSupport.length).toBeGreaterThan(0);
    expect(lowerSupport.every((event) => event.hand === 'left' && event.pitch <= 84 - 7)).toBe(true);
    const chordById = new Map(crowdedResult.plan.harmonicEvents.map((event) => [event.chord.id, event.chord]));
    expect(lowerSupport.every((event) => {
      const chord = chordById.get(event.harmonicContext.chordIds[0]);
      return chord !== undefined && event.startTick >= chord.startTick + PPQ;
    })).toBe(true);
    expect(crowdedResult.score.events.some((event) => event.phraseId === crowded.phrase.id
      && event.voiceId === 'rh.melody')).toBe(false);
  });

  it('keeps lead accompaniment below the written part across templates, registers, and seeds', () => {
    const identities = new Set<string>();
    for (const templateId of TEMPLATE_IDS) {
      const sample = productionSample(templateId, 17);
      for (const { seed, pitch } of [{ seed: 11, pitch: 59 }, { seed: 29, pitch: 84 }]) {
        const scenario = leadScenario(sample, seed, (phrase) => [{
          pitch,
          startTick: phrase.startTick,
          durationTicks: phrase.endTick - phrase.startTick,
          velocity: 72,
        }]);
        const first = planAndScore(sample, scenario.input);
        const replay = planAndScore(sample, scenario.input);
        identities.add(first.plan.template.style.identity);
        const leadEvents = first.plan.harmonicEvents.filter((event) =>
          event.orchestration.explicitLeadTrackIds.includes(scenario.leadId));
        expect(leadEvents.length).toBeGreaterThan(0);
        expect(leadEvents.every((event) =>
          event.orchestration.leadResponse?.mode === 'restrained-accompaniment')).toBe(true);
        const leadChordIds = new Set(leadEvents.map((event) => event.chord.id));
        const accompaniment = first.score.events.filter((event) => event.voiceId === 'lh.support'
          && event.harmonicContext.chordIds.some((chordId) => leadChordIds.has(chordId)));
        expect(accompaniment.length,
          `${templateId} seed=${seed} pitch=${pitch} modes=${leadEvents.map((event) => event.orchestration.leadResponse?.mode).join(',')}`)
          .toBeGreaterThan(0);
        expect(accompaniment.every((event) => event.hand === 'left'
          && event.pitch <= pitch - 7
          && event.harmonicContext.pitchClasses.includes(event.pitch % 12)),
        `${templateId} seed=${seed} pitch=${pitch} accompaniment=${JSON.stringify(accompaniment.map((event) => ({
          pitch: event.pitch, hand: event.hand, voiceId: event.voiceId, startTick: event.startTick,
          durationTicks: event.durationTicks, chordIds: event.harmonicContext.chordIds,
          pitchClasses: event.harmonicContext.pitchClasses,
        })))}`).toBe(true);
        expect(first.score.events.some((event) => event.voiceId === 'rh.melody'
          && event.startTick < scenario.phrase.endTick
          && event.startTick + event.durationTicks > scenario.phrase.startTick)).toBe(false);
        expect(scoreSignature(replay.score)).toBe(scoreSignature(first.score));
      }
    }
    expect(identities.size).toBe(TEMPLATE_IDS.length);
  });

  it('respects Piano fill and supplied near-silence gaps without abandoning the surrounding section', () => {
    const sample = productionSample('ensemble.sonata');
    const scenario = leadScenario(sample, 43, (phrase) => [{
      pitch: 84,
      startTick: phrase.startTick,
      durationTicks: phrase.endTick - phrase.startTick,
      velocity: 72,
    }]);
    const reservedChordId = scenario.harmonyChord.id;
    const withFill: PianoEngineInput = {
      ...scenario.input,
      context: {
        ...scenario.input.context,
        fillWindows: [{
          target: 'piano',
          startTick: scenario.harmonyChord.startTick,
          endTick: scenario.harmonyChord.endTick,
        }],
      },
    };
    const fillResult = planAndScore(sample, withFill);
    const reservedEvent = fillResult.plan.harmonicEvents.find((event) => event.chord.id === reservedChordId);
    expect(reservedEvent?.orchestration.leadResponse?.mode).toBe('silence');
    expect(reservedEvent?.orchestration.leadResponse?.rationale).toContain('fill reservation');
    expect(fillResult.score.events.some((event) => event.harmonicContext.chordIds.includes(reservedChordId))).toBe(false);
    const surroundingChordIds = new Set(fillResult.plan.harmonicEvents
      .filter((event) => event.chord.id !== reservedChordId
        && event.orchestration.explicitLeadTrackIds.includes(scenario.leadId))
      .map((event) => event.chord.id));
    expect(fillResult.plan.harmonicEvents.some((event) => surroundingChordIds.has(event.chord.id)
      && event.orchestration.leadResponse?.mode === 'restrained-accompaniment')).toBe(true);
    expect(fillResult.score.events.some((event) => event.harmonicContext.chordIds
      .some((chordId) => surroundingChordIds.has(chordId)))).toBe(true);

    const quietBar = scenario.input.context.barWindows.find((bar) =>
      scenario.harmonyChord.startTick >= bar.startTick && scenario.harmonyChord.startTick < bar.endTick);
    if (!quietBar) throw new Error('The selected harmony must belong to a supplied bar window.');
    const withQuietBar: PianoEngineInput = {
      ...scenario.input,
      context: {
        ...scenario.input.context,
        energy: scenario.input.context.energy.map((energy) => energy.bar === quietBar.bar
          ? { ...energy, target: 0, nearSilence: true }
          : energy),
      },
    };
    const quietResult = planAndScore(sample, withQuietBar);
    const quietLeadEvent = quietResult.plan.harmonicEvents.find((event) =>
      event.chord.id === reservedChordId);
    expect(quietLeadEvent?.orchestration.leadResponse?.mode).toBe('silence');
    expect(quietLeadEvent?.orchestration.leadResponse?.rationale).toContain('near-silence');
    expect(quietResult.score.events.some((event) => event.startTick >= quietBar.startTick
      && event.startTick < quietBar.endTick)).toBe(false);
    expect(quietResult.score.events.some((event) => event.startTick < quietBar.startTick
      || event.startTick >= quietBar.endTick)).toBe(true);
  });

  it('audits every supported structural archetype in Compose → Analyzer → Composer → Realizer, preserving template personalities', () => {
    const eligibleIdentities = new Map<TemplateId, string>();
    for (const templateId of TEMPLATE_IDS) {
      for (const seed of [11, 17, 29]) {
        const sample = productionSample(templateId, seed, {
          sections: STRUCTURAL_SECTION_LAYOUT,
          moments: true,
          humanize: true,
        });
        const { input, result } = sample;
        expect(input.context.template.pianoEligible).toBe(true);
        const analyzer = analyzePianoInput(input);
        const plan = composePianoPlan(input, analyzer);
        eligibleIdentities.set(templateId, plan.template.style.identity);
        expect(scoreSignature(result.pianoScore)).toBe(scoreSignature(planAndScore(sample, input).score));

        for (const section of input.context.sections) {
          const scoreEvents = result.pianoScore.events.filter((event) => event.sectionId === section.id);
          const realizedEvents = result.pianoRealizedScoreEvents.filter((event) =>
            event.source.sectionId === section.id);
          const finalNotes = sample.piano.notes.filter((note) =>
            note.startTick >= section.startTick && note.startTick < section.endTick);
          expect(realizedEvents.length).toBe(scoreEvents.length);
          expect(finalNotes.length).toBe(realizedEvents.length);

          const leadEvents = plan.harmonicEvents.filter((event) =>
            event.sectionIds.includes(section.id) && event.orchestration.explicitLeadTrackIds.length > 0);
          for (const leadEvent of leadEvents) {
            const response = leadEvent.orchestration.leadResponse;
            if (response?.mode !== 'restrained-accompaniment' && response?.mode !== 'answer-in-gap') continue;
            const notes = result.pianoScore.events.filter((event) => event.voiceId === 'lh.support'
              && event.startTick >= leadEvent.chord.startTick && event.startTick < leadEvent.chord.endTick);
            expect(notes.length,
              `${templateId} seed=${seed} section=${section.name} chord=${leadEvent.chord.id} response=${response.mode} range=${response.leadPitchRange?.lowestPitch}-${response.leadPitchRange?.highestPitch}`)
              .toBeGreaterThan(0);
            expect(notes.every((event) => event.hand === 'left'
              && event.pitch <= (response.leadPitchRange?.lowestPitch ?? event.pitch) - 7
              && event.harmonicContext.pitchClasses.includes(event.pitch % 12)),
            `${templateId} seed=${seed} section=${section.name} notes=${JSON.stringify(notes.map((event) => ({
              pitch: event.pitch, hand: event.hand, voiceId: event.voiceId, startTick: event.startTick,
              durationTicks: event.durationTicks, chordIds: event.harmonicContext.chordIds,
              pitchClasses: event.harmonicContext.pitchClasses,
            })))}`).toBe(true);
            expect(result.pianoScore.events.some((event) => event.voiceId === 'rh.melody'
              && event.startTick < leadEvent.chord.endTick
              && event.startTick + event.durationTicks > leadEvent.chord.startTick)).toBe(false);
          }
        }

        const verse = input.context.sections.find((section) => section.name === 'Verse');
        const chorus = input.context.sections.find((section) => section.name === 'Chorus');
        expect(verse).toBeDefined();
        expect(chorus).toBeDefined();
        expect(result.pianoScore.events.some((event) => event.sectionId === verse!.id)).toBe(true);
        expect(result.pianoScore.events.some((event) => event.sectionId === chorus!.id)).toBe(true);

        if (templateId === 'ensemble.hybridstudio') {
          expect(result.pianoScore.events.some((event) => event.sectionId === verse!.id
            || event.sectionId === chorus!.id)).toBe(true);
        }
        if (templateId === 'ensemble.cinematic') {
          expect(result.pianoScore.events.some((event) => event.sectionId === verse!.id)).toBe(true);
        }
        if (templateId === 'ensemble.vocalbacking') {
          for (const section of [verse!, chorus!]) {
            const voices = new Set(result.pianoScore.events.filter((event) => event.sectionId === section.id)
              .map((event) => event.voiceId));
            expect(voices.has('lh.support')).toBe(true);
            expect(voices.size).toBeGreaterThan(1);
          }
        }
        if (templateId === 'ensemble.sonata' || templateId === 'ensemble.chamber') {
          const intro = input.context.sections.find((section) => section.name === 'Intro');
          if (!intro) throw new Error('The supported section audit must contain an Intro.');
          const voices = new Set(result.pianoScore.events.filter((event) => event.sectionId === intro.id)
            .map((event) => event.voiceId));
          expect(voices.has('lh.bass')).toBe(true);
          expect(voices.has('rh.melody')).toBe(true);
          expect(voices.size).toBeGreaterThan(2);
        }
      }
    }
    expect(eligibleIdentities.size).toBe(TEMPLATE_IDS.length);
    expect(new Set(eligibleIdentities.values()).size).toBe(TEMPLATE_IDS.length);

    for (const seed of [11, 17, 29]) {
      const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
      project.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} };
      project.orchestration = { take: 0 };
      project.sections = STRUCTURAL_SECTION_LAYOUT.map((section) => ({ ...section }));
      const result = composeAllTracks(project, { seed, density: 1, humanize: true, moments: true });
      const { pianoEngineInput: input } = result;
      const plan = composePianoPlan(input, analyzePianoInput(input));
      expect(input.context.template.pianoEligible).toBe(false);
      expect(plan.harmonicEvents).toHaveLength(0);
      expect(result.pianoScore.events).toHaveLength(0);
      expect(result.pianoRealizedScoreEvents).toHaveLength(0);
      const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
      expect(piano && isInstrumentTrack(piano) ? piano.notes : []).toHaveLength(0);
    }
  }, 30_000);

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
