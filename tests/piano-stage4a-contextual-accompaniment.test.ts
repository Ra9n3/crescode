import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScore } from '../src/orchestrator/keys/piano-composer';
import type { PianoAnalysisTrack } from '../src/orchestrator/keys/analysis';
import type { PianoEngineInput, PianoLayerSlot, PianoRelevantMoment } from '../src/orchestrator/keys/piano-engine';
import { validatePianoScorePlayability } from '../src/orchestrator/keys/piano-playability';
import type { PianoScore } from '../src/orchestrator/keys/piano-score';
import { isInstrumentTrack, projectFromFixture, type Note, type Project, type Track, type TrackFamily } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';

const sampleCache = new Map<string, {
  project: Project;
  input: PianoEngineInput;
  piano: Track;
}>();

function productionSample(templateId = 'ensemble.chamber', seed = 11) {
  const key = `${templateId}:${seed}`;
  const cached = sampleCache.get(key);
  if (cached) return cached;
  const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed, density: 0.85, moments: false });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} returned no Piano target.`);
  const sample = { project, input: result.pianoEngineInput, piano };
  sampleCache.set(key, sample);
  return sample;
}

function makeTrack(
  id: string,
  role: string,
  notes: readonly Note[],
  family: TrackFamily = 'Strings',
): PianoAnalysisTrack {
  return { id, name: id, role, family, notes };
}

function emptyTrack(id = 'silent-violas', role = 'violas'): PianoAnalysisTrack {
  return makeTrack(id, role, []);
}

function notesAcrossBars(
  input: PianoEngineInput,
  pitch: number,
  velocity = 78,
): Note[] {
  return input.context.barWindows.map((bar) => ({
    pitch,
    startTick: bar.startTick + Math.min(120, Math.floor((bar.endTick - bar.startTick) / 8)),
    durationTicks: Math.max(1, bar.endTick - bar.startTick - 240),
    velocity,
  }));
}

function controlledInput(
  source: PianoEngineInput,
  tracks: readonly PianoAnalysisTrack[],
  options: {
    readonly moments?: readonly PianoRelevantMoment[];
    readonly leadTrackId?: string;
    readonly harmony?: PianoEngineInput['context']['harmony'];
    readonly sections?: PianoEngineInput['context']['sections'];
  } = {},
): PianoEngineInput {
  const leadTrackId = options.leadTrackId;
  const perBar = source.context.layerInformation.perBar.map((bar): {
    bar: number;
    layers: readonly PianoLayerSlot[];
  } => ({
    bar: bar.bar,
    layers: leadTrackId
      ? [{ layer: 'lead', trackIds: [leadTrackId], source: 'strings' }]
      : [],
  }));
  return {
    ...source,
    context: {
      ...source.context,
      harmony: options.harmony ?? source.context.harmony,
      sections: options.sections ?? source.context.sections,
      moments: options.moments ?? [],
      fillWindows: [],
      layerInformation: { ...source.context.layerInformation, perBar },
    },
    analysis: { tracks },
  };
}

function writeScore(sample: ReturnType<typeof productionSample>, input = sample.input) {
  const analyzer = analyzePianoInput(input);
  const plan = composePianoPlan(input, analyzer);
  const score = composePianoScore(input, plan, sample.piano, projectEndTick(sample.project));
  return { analyzer, plan, score };
}

const SCORE_FIGURE_TECHNIQUES = new Set<PianoScore['events'][number]['techniqueIntent']>([
  'alberti-bass-accompaniment', 'walking-bass-line', 'rhythmic-ostinato',
]);

function scoreFigureEvents(score: PianoScore) {
  return score.events.filter((event) => SCORE_FIGURE_TECHNIQUES.has(event.techniqueIntent));
}

function assertScoreContract(sample: ReturnType<typeof productionSample>, score: PianoScore) {
  const endTick = projectEndTick(sample.project);
  expect(score.events.every((event) => Number.isInteger(event.pitch)
    && event.pitch >= sample.piano.lowestNote && event.pitch <= sample.piano.highestNote)).toBe(true);
  expect(score.events.every((event) => Number.isInteger(event.startTick)
    && event.startTick >= 0 && event.startTick < endTick
    && Number.isInteger(event.durationTicks) && event.durationTicks > 0
    && event.startTick + event.durationTicks <= endTick)).toBe(true);
  expect(score.events.every((event) => Number.isInteger(event.dynamicIntent.velocity)
    && event.dynamicIntent.velocity >= 1 && event.dynamicIntent.velocity <= 127)).toBe(true);

  for (const event of score.events) {
    if ((event.voiceId !== 'lh.bass' && event.voiceId !== 'lh.support' && event.voiceId !== 'rh.inner')
      || event.techniqueIntent === 'prepared-suspension'
      || event.techniqueIntent === 'stepwise-resolution') continue;
    expect(event.harmonicContext.pitchClasses, `${event.voiceId} at ${event.startTick}`)
      .toContain(event.pitch % 12);
  }
  expect(validatePianoScorePlayability(score, {
    lowestNote: sample.piano.lowestNote,
    highestNote: sample.piano.highestNote,
  }).violations).toEqual([]);
}

function activeNotesInWindow(score: PianoScore, startTick: number, endTick: number) {
  return score.events.filter((event) => event.startTick < endTick
    && event.startTick + event.durationTicks > startTick);
}

describe('Piano Stage 4A contextual accompaniment from finalized tracks', () => {
  it('uses the production Compose All snapshot and records exact chord-window activity without inferring a lead', () => {
    const sample = productionSample();
    expect(sample.input.analysis.tracks.length).toBeGreaterThan(0);
    expect(sample.input.analysis.tracks.some((track) => track.notes.length > 0)).toBe(true);

    const { plan, score } = writeScore(sample);
    expect(plan.status).toBe('composed');
    expect(plan.harmonicEvents.length).toBeGreaterThan(0);
    expect(plan.harmonicEvents.every((event) => event.orchestration.accompanimentActivity?.availability === 'available')).toBe(true);
    expect(plan.harmonicEvents.every((event) => event.orchestration.accompanimentActivity?.source === 'resolved-chord-overlap')).toBe(true);
    expect(plan.harmonicEvents.every((event) => event.orchestration.explicitLeadTrackIds.length === 0
      || event.orchestration.explicitLeadTrackIds.every((id) => sample.input.analysis.tracks.some((track) => track.id === id)))).toBe(true);
    assertScoreContract(sample, score);
  });

  it('keeps the explicit-lead rule ahead of first-phrase motif introduction and avoids note-for-note doubling', () => {
    const sample = productionSample('ensemble.chamber');
    const bars = sample.input.context.barWindows;
    const lead = makeTrack('annotated-violins1', 'violins1', notesAcrossBars(sample.input, 81));
    const input = controlledInput(sample.input, [lead], { leadTrackId: lead.id });
    const { plan, score } = writeScore(sample, input);
    const firstPhrase = plan.phrases[0];
    if (!firstPhrase) throw new Error('The production fixture needs a first phrase.');

    expect(plan.phrases.some((phrase) => phrase.motif.operation === 'withhold-under-lead')).toBe(true);
    expect(firstPhrase.motif.operation).toBe('withhold-under-lead');
    const firstPhraseEvents = plan.harmonicEvents.filter((event) => event.phraseId === firstPhrase.id);
    expect(firstPhraseEvents.length).toBeGreaterThan(0);
    expect(firstPhraseEvents.every((event) => event.orchestration.explicitLeadTrackIds.includes(lead.id))).toBe(true);
    const leadWindowEnd = bars[Math.min(bars.length - 1, 2)]?.endTick ?? firstPhrase.endTick;
    const pianoMelody = score.events.filter((event) => event.phraseId === firstPhrase.id && event.voiceId === 'rh.melody');
    expect(pianoMelody).toEqual([]);
    expect(activeNotesInWindow(score, firstPhrase.startTick, leadWindowEnd)
      .filter((event) => event.voiceId === 'rh.melody')).toEqual([]);
    expect(scoreFigureEvents({ ...score, events: activeNotesInWindow(score, firstPhrase.startTick, leadWindowEnd) })).toEqual([]);
    assertScoreContract(sample, score);
  });

  it('recognizes bass foundations from both bass roles and written low register, suppressing added bass patterns', () => {
    const sample = productionSample('ensemble.sonata');
    const emptyInput = controlledInput(sample.input, [emptyTrack()]);
    const open = writeScore(sample, emptyInput);
    const basses = makeTrack('written-basses', 'basses', notesAcrossBars(sample.input, 43));
    const bassInput = controlledInput(sample.input, [basses]);
    const underBass = writeScore(sample, bassInput);
    const firstEvent = underBass.plan.harmonicEvents[0];

    expect(open.plan.harmonicEvents[0].orchestration.accompanimentActivity)
      .toMatchObject({ availability: 'available', bassFoundationTrackIds: [] });
    expect(firstEvent.orchestration.accompanimentActivity?.availability).toBe('available');
    expect(firstEvent.orchestration.accompanimentActivity?.bassFoundationTrackIds).toContain(basses.id);
    expect(underBass.plan.harmonicEvents.some((event) => event.hands.left.motion === 'sparse-approach')).toBe(true);
    expect(scoreFigureEvents(underBass.score)).toEqual([]);
    expect(underBass.score.events.length).toBeLessThanOrEqual(open.score.events.length);
    assertScoreContract(sample, underBass.score);
  });

  it('treats sustained upper-register occupancy as crowded without turning it into a lead annotation', () => {
    const sample = productionSample('ensemble.chamber');
    const pitches = [72, 74, 76, 77, 79, 81, 83, 84];
    const notes = sample.input.context.barWindows.flatMap((bar) => pitches.map((pitch) => ({
      pitch,
      startTick: bar.startTick + 60,
      durationTicks: Math.max(1, bar.endTick - bar.startTick - 120),
      velocity: 76,
    })));
    const line = makeTrack('busy-violins2', 'violins2', notes);
    const input = controlledInput(sample.input, [line]);
    const crowded = writeScore(sample, input);

    expect(crowded.analyzer.interpretations.leadPassages.candidates).toEqual([]);
    expect(crowded.plan.harmonicEvents[0].orchestration.explicitLeadTrackIds).toEqual([]);
    expect(crowded.plan.harmonicEvents[0].orchestration.accompanimentActivity?.midUpperActivityTrackIds)
      .toContain(line.id);
    expect(crowded.plan.harmonicEvents[0].orchestration.accompanimentActivity?.activeNotesPerBar.pianoUpper)
      .toBeGreaterThanOrEqual(8);
    expect(crowded.plan.phrases.length).toBeGreaterThan(0);
    expect(crowded.plan.phrases.every((phrase) => phrase.texture.kind === 'sparse-sustained')).toBe(true);
    expect(crowded.score.events.length).toBeLessThanOrEqual(writeScore(sample, controlledInput(sample.input, [emptyTrack()])).score.events.length);
    assertScoreContract(sample, crowded.score);
  });

  it('yields at an explicit non-Piano spotlight without generating a counterline or a gap response', () => {
    const sample = productionSample('ensemble.chamber');
    const window = sample.input.context.barWindows[0];
    if (!window) throw new Error('The production fixture needs a source bar.');
    const solo = makeTrack('solo-viola', 'violas', notesAcrossBars(sample.input, 67));
    const moment: PianoRelevantMoment = {
      kind: 'soli',
      startBar: window.bar,
      endBar: window.bar,
      startTick: window.startTick,
      endTick: window.endTick,
      participantRoles: ['violas'],
    };
    const input = controlledInput(sample.input, [solo], { moments: [moment] });
    const { plan, score } = writeScore(sample, input);
    const momentEvents = plan.harmonicEvents.filter((event) =>
      event.chord.startTick < moment.endTick && moment.startTick < event.chord.endTick);
    const momentScore = activeNotesInWindow(score, moment.startTick, moment.endTick);

    expect(momentEvents.length).toBeGreaterThan(0);
    expect(momentEvents.every((event) => event.orchestration.interaction === 'yield-to-spotlight')).toBe(true);
    expect(momentScore.some((event) => event.techniqueIntent === 'independent-counterline')).toBe(false);
    expect(momentScore.some((event) => ['alberti-bass-accompaniment', 'walking-bass-line', 'rhythmic-ostinato']
      .includes(event.techniqueIntent))).toBe(false);
    assertScoreContract(sample, score);
  });

  it('keeps unknown activity unknown in standalone writing and never forces a minimum per section', () => {
    const sample = productionSample('ensemble.chamber');
    const standaloneInput = controlledInput(sample.input, []);
    const standalone = writeScore(sample, standaloneInput);
    expect(standalone.plan.harmonicEvents[0].orchestration.accompanimentActivity)
      .toMatchObject({ availability: 'partial', activeNotesPerBar: { pianoBass: null, total: null } });
    expect(standalone.plan.harmonicEvents[0].orchestration.activeTrackIds).toEqual([]);
    expect(standalone.score.events.length).toBeGreaterThan(0);
    expect(scoreFigureEvents(standalone.score)).toEqual([]);
    assertScoreContract(sample, standalone.score);

    const noHarmonyInput = controlledInput(sample.input, [], { harmony: [] });
    const noHarmony = writeScore(sample, noHarmonyInput);
    expect(noHarmony.plan.sectionIntentions.length).toBeGreaterThan(0);
    expect(noHarmony.plan.harmonicEvents).toEqual([]);
    expect(noHarmony.score.events).toEqual([]);
  });

  it('re-establishes accompaniment texture at each section and never requires an event quota', () => {
    const sample = productionSample('ensemble.sonata');
    const input = controlledInput(sample.input, [emptyTrack()]);
    const { plan, score } = writeScore(sample, input);
    const sectionsWithPhrases = plan.sectionIntentions.filter((section) => section.textureProgression.length > 0);

    expect(sectionsWithPhrases.length).toBeGreaterThan(1);
    expect(sectionsWithPhrases.every((section) => section.textureProgression[0].transitionFromPrevious === null
      && section.textureProgression[0].transition === 'establish')).toBe(true);
    expect(score.events.every((event) => event.sectionId === null
      || input.context.sections.some((section) => section.id === event.sectionId))).toBe(true);
    assertScoreContract(sample, score);
  });

  it('keeps template-specific vocabulary gates and seed-stable score events across Compose All templates', () => {
    const templates = [
      ['ensemble.cinematic', 'cinematic-expanse'],
      ['ensemble.hybridstudio', 'hybrid-pulse-and-color'],
      ['ensemble.vocalbacking', 'vocal-space'],
      ['ensemble.chamber', 'chamber-counterpoint'],
      ['ensemble.sonata', 'sonata-dialogue'],
    ] as const;
    for (const [templateId, identity] of templates) {
      const sample = productionSample(templateId, 11);
      const input = controlledInput(sample.input, [emptyTrack()]);
      const first = writeScore(sample, input);
      const again = writeScore(sample, input);
      expect(first.plan.template.style.identity).toBe(identity);
      expect(first.plan.status).toBe('composed');
      expect(first.score.events.length).toBeGreaterThan(0);
      expect(again.score.events).toEqual(first.score.events);
      assertScoreContract(sample, first.score);
      if (templateId === 'ensemble.cinematic' || templateId === 'ensemble.vocalbacking') {
        expect(scoreFigureEvents(first.score)).toEqual([]);
      }
    }

    const sample = productionSample('ensemble.chamber', 11);
    const baseInput = controlledInput(sample.input, [emptyTrack()]);
    const seedA = 11;
    const seedB = 29;
    const withSeed = (input: PianoEngineInput, seed: number): PianoEngineInput => ({
      ...input,
      context: {
        ...input.context,
        seed,
        generationIdentity: { ...input.context.generationIdentity, seed, userSeed: seed },
      },
    });
    const firstSeed = writeScore(sample, withSeed(baseInput, seedA));
    const repeatedSeed = writeScore(sample, withSeed(baseInput, seedA));
    const otherSeed = writeScore(sample, withSeed(baseInput, seedB));
    expect(firstSeed.plan.generationIdentity.seed).toBe(seedA);
    expect(otherSeed.plan.generationIdentity.seed).toBe(seedB);
    expect(repeatedSeed.score.events).toEqual(firstSeed.score.events);
    expect(otherSeed.score.events.every((event) => event.startTick + event.durationTicks <= projectEndTick(sample.project))).toBe(true);
    assertScoreContract(sample, otherSeed.score);
  });
});
