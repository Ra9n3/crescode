import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import {
  composePianoPlan,
  composePianoScore,
  type PianoComposerPlan,
  type PianoPhraseIntention,
  type PianoTemplateIdentity,
  type PianoTextureKind,
} from '../src/orchestrator/keys/piano-composer';
import { validatePianoScorePlayability } from '../src/orchestrator/keys/piano-playability';
import type { PianoScore } from '../src/orchestrator/keys/piano-score';
import { projectFromFixture, isInstrumentTrack, type Project, type Track } from '../src/shared/schema';
import { PPQ } from '../src/shared/schema/types';
import { projectEndTick } from '../src/shared/schema/meter';

const TEMPLATE_IDS = [
  'ensemble.chamber',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.cinematic',
  'ensemble.hybridstudio',
] as const;
type TemplateId = (typeof TEMPLATE_IDS)[number];

interface ComposerSample {
  readonly project: Project;
  readonly piano: Track;
  readonly input: ReturnType<typeof composeAllTracks>['pianoEngineInput'];
  readonly plan: PianoComposerPlan;
  readonly score: PianoScore;
}

const sampleCache = new Map<string, ComposerSample>();

function composerSample(templateId: TemplateId, seed: number, fixture: unknown = threeChorus): ComposerSample {
  const fixtureKey = fixture === dorian ? 'dorian' : 'three-chorus';
  const key = `${templateId}:${seed}:${fixtureKey}`;
  const cached = sampleCache.get(key);
  if (cached) return cached;

  const project = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} composition returned no Piano target.`);
  const productionInput = result.pianoEngineInput;
  const input = {
    ...productionInput,
    context: {
      ...productionInput.context,
      leadWindows: [],
      layerInformation: {
        ...productionInput.context.layerInformation,
        perBar: productionInput.context.layerInformation.perBar.map((bar) => ({ ...bar, layers: [] })),
      },
    },
    analysis: { tracks: [] },
  };
  const plan = composePianoPlan(input, analyzePianoInput(input));
  const score = composePianoScore(input, plan, piano, projectEndTick(project));
  const sample = { project, piano, input, plan, score };
  sampleCache.set(key, sample);
  return sample;
}

function scoreSignature(score: PianoScore): string {
  return JSON.stringify(score.events.map((event) => [
    event.voiceId,
    event.pitch,
    event.startTick,
    event.durationTicks,
    event.techniqueIntent,
    event.dynamicIntent.velocity,
  ]));
}

function plannedMotifTicks(phrase: PianoPhraseIntention, onlyPosition?: 0 | 1 | 2 | 3): number[] {
  const cells = phrase.rhythmicPlan.motifCells ?? [];
  const grid = Math.max(1, phrase.rhythmicPlan.gridTicks ?? PPQ / 2);
  const cellTicks = Math.max(1, phrase.rhythmicPlan.cellTicks ?? 2 * PPQ);
  const weights = phrase.rhythmicPlan.weights.length === 4
    ? phrase.rhythmicPlan.weights : [0.25, 0.25, 0.25, 0.25];
  const safeWeights = weights.map((weight) => Number.isFinite(weight) && weight > 0 ? weight : 0);
  const total = safeWeights.reduce((sum, weight) => sum + weight, 0) || 1;
  const normalized = safeWeights.map((weight) => weight / total);
  const offsets = [0, normalized[0], normalized[0] + normalized[1], normalized[0] + normalized[1] + normalized[2]];
  const ticks: number[] = [];
  for (const cell of cells) {
    const start = phrase.startTick + cell.startOffsetTicks;
    const end = Math.min(phrase.endTick, start + cellTicks);
    const span = end - start;
    if (span <= 0) continue;
    const firstGrid = Math.ceil(start / grid) * grid;
    const lastGrid = Math.floor((end - 1) / grid) * grid;
    for (const position of cell.positions) {
      if (onlyPosition !== undefined && position !== onlyPosition) continue;
      const displacement = phrase.rhythmicPlan.syncopation?.displacedPosition === position
        ? phrase.rhythmicPlan.syncopation.offsetTicks : 0;
      const quantized = Math.round((start + offsets[position] * span + displacement) / grid) * grid;
      ticks.push(Math.max(firstGrid, Math.min(lastGrid, quantized)));
    }
  }
  return [...new Set(ticks)];
}

function forcedTexturePlan(
  plan: PianoComposerPlan,
  textureKind: PianoTextureKind,
  identity: PianoTemplateIdentity,
  patch: {
    readonly fillDecision?: PianoComposerPlan['fillDecisions'][number];
    readonly attackRestriction?: PianoComposerPlan['attackRestrictions'][number];
  } = {},
): { readonly plan: PianoComposerPlan; readonly phrase: PianoPhraseIntention } {
  const phrase = plan.phrases.find((candidate) => candidate.endTick - candidate.startTick >= 8 * PPQ);
  if (!phrase) throw new Error('The score-level regression fixture needs a phrase of at least two bars.');
  const purpose: PianoPhraseIntention['texture']['purpose'] = textureKind === 'sparse-sustained'
    ? 'preserve-space'
    : textureKind === 'broken-chords' ? 'connect-harmony'
      : textureKind === 'arpeggiated' ? 'build-motion'
        : textureKind === 'melody-accompaniment' ? 'carry-melody'
          : textureKind === 'block-chords' ? 'mark-arrival'
            : textureKind === 'contrapuntal-dialogue' ? 'exchange-voices' : 'punctuate-phrase';
  const phrases = plan.phrases.map((candidate) => candidate.id !== phrase.id ? candidate : {
    ...candidate,
    intendedDensity: 'broad' as const,
    texture: {
      ...candidate.texture,
      kind: textureKind,
      purpose,
      leftHandRole: 'Composer-planned harmonic foundation and independent response.',
      rightHandRole: 'Composer-planned subject with chord-tone inner movement.',
    },
  });
  const harmonicEvents = plan.harmonicEvents.map((event) => event.phraseId !== phrase.id ? event : {
    ...event,
    hands: {
      left: { ...event.hands.left, motion: 'change-with-harmony' as const },
      right: { ...event.hands.right, density: 'broad' as const, motion: 'motif-led' as const },
    },
    orchestration: {
      ...event.orchestration,
      explicitLeadTrackIds: [],
      interaction: 'support-moment' as const,
    },
    dynamicIntent: { ...event.dynamicIntent, sourceEnergyNearSilence: false },
  });
  const forcedPlan: PianoComposerPlan = {
    ...plan,
    template: { ...plan.template, style: { ...plan.template.style, identity } },
    phrases,
    harmonicEvents,
    fillDecisions: patch.fillDecision ? [...plan.fillDecisions, patch.fillDecision] : plan.fillDecisions,
    attackRestrictions: patch.attackRestriction
      ? [...plan.attackRestrictions, patch.attackRestriction] : plan.attackRestrictions,
  };
  return { plan: forcedPlan, phrase };
}

function noUnisonOverlap(score: PianoScore): boolean {
  for (let index = 0; index < score.events.length; index++) {
    const left = score.events[index];
    for (let otherIndex = index + 1; otherIndex < score.events.length; otherIndex++) {
      const right = score.events[otherIndex];
      if (left.pitch !== right.pitch) continue;
      const overlap = left.startTick < right.startTick + right.durationTicks
        && right.startTick < left.startTick + left.durationTicks;
      if (overlap) return false;
    }
  }
  return true;
}

describe('Piano Engine Stage 3 musical development and coordinated writing', () => {
  it('is deterministic for identical inputs, varies by generation seed, and retains template identity', () => {
    const sameInput = composerSample('ensemble.chamber', 11);
    const repeatedPlan = composePianoPlan(sameInput.input, analyzePianoInput(sameInput.input));
    const repeatedScore = composePianoScore(
      sameInput.input, sameInput.plan, sameInput.piano, projectEndTick(sameInput.project),
    );
    expect(JSON.stringify(repeatedPlan)).toBe(JSON.stringify(sameInput.plan));
    expect(JSON.stringify(repeatedScore)).toBe(JSON.stringify(sameInput.score));

    const seedScores = [11, 29, 47].map((seed) => composerSample('ensemble.chamber', seed));
    expect(new Set(seedScores.map(({ score }) => scoreSignature(score))).size).toBeGreaterThan(1);
    for (const sample of seedScores) {
      expect(sample.score.generationIdentity.seed).toBe(sample.input.context.seed);
      expect(sample.score.events.length).toBeGreaterThan(0);
      expect(sample.score.events.every((event) => event.pitch >= sample.piano.lowestNote
        && event.pitch <= sample.piano.highestNote
        && event.startTick + event.durationTicks <= sample.score.projectEndTick)).toBe(true);
      expect(validatePianoScorePlayability(sample.score, {
        lowestNote: sample.piano.lowestNote,
        highestNote: sample.piano.highestNote,
      }).violations).toEqual([]);
    }

    const templateSamples = TEMPLATE_IDS.map((templateId) => composerSample(templateId, 11));
    expect(new Set(templateSamples.map(({ plan }) => plan.template.style.identity)).size).toBe(TEMPLATE_IDS.length);
    expect(new Set(templateSamples.map(({ score }) => scoreSignature(score))).size).toBeGreaterThan(1);
    for (const sample of templateSamples) {
      expect(sample.score.templateId).toBe(sample.plan.template.id);
      expect(sample.plan.template.eligible).toBe(true);
      expect(sample.score.events.every((event) => event.pitch >= sample.piano.lowestNote
        && event.pitch <= sample.piano.highestNote
        && event.startTick + event.durationTicks <= sample.score.projectEndTick)).toBe(true);
      expect(validatePianoScorePlayability(sample.score, {
        lowestNote: sample.piano.lowestNote,
        highestNote: sample.piano.highestNote,
      }).violations).toEqual([]);
    }
  });

  it('develops the shared motif in Composer score events with rhythmic/contour variety and coordinated hands', () => {
    const { plan, score, piano } = composerSample('ensemble.chamber', 17, dorian);
    expect(plan.motif).not.toBeNull();
    const melody = score.events.filter((event) => event.voiceId === 'rh.melody')
      .sort((a, b) => a.startTick - b.startTick);
    expect(melody.length).toBeGreaterThan(6);
    expect(new Set(melody.map((event) => event.pitch)).size).toBeGreaterThan(3);
    const intervals = melody.slice(1).map((event, index) => event.pitch - melody[index].pitch);
    expect(intervals.some((interval) => interval > 0)).toBe(true);
    expect(intervals.some((interval) => interval < 0)).toBe(true);
    expect(new Set(melody.slice(1).map((event, index) => event.startTick - melody[index].startTick)).size)
      .toBeGreaterThan(1);

    const operations = new Set(plan.phrases.map((phrase) => phrase.motif.operation)
      .filter((operation) => operation !== 'unavailable' && operation !== 'withhold-under-lead'));
    expect(operations.size).toBeGreaterThan(1);
    const plannedStarts = new Set(plan.phrases.flatMap((phrase) => plannedMotifTicks(phrase)));
    const endingChordId = plan.ending.chordId;
    expect(melody.every((event) => plannedStarts.has(event.startTick)
      || (event.musicalRole === 'cadence' && endingChordId !== null
        && event.harmonicContext.chordIds.includes(endingChordId)))).toBe(true);

    const left = score.events.filter((event) => event.hand === 'left');
    const right = score.events.filter((event) => event.hand === 'right');
    const leftOnsets = new Set(left.map((event) => event.startTick));
    const rightOnsets = new Set(right.map((event) => event.startTick));
    expect([...leftOnsets].some((tick) => rightOnsets.has(tick))).toBe(true);
    expect([...rightOnsets].some((tick) => !leftOnsets.has(tick))).toBe(true);
    expect(score.events.some((event) => event.voiceId === 'lh.bass' && event.noteRoleTag === 'anchor')).toBe(true);
    const innerEvents = score.events.filter((event) => event.voiceId === 'rh.inner');
    expect(new Set(innerEvents.map((event) => event.pitch)).size).toBeGreaterThan(1);

    const plannedNeighborTicks = new Set(plan.phrases.flatMap((phrase) => plannedMotifTicks(phrase, 2)));
    for (const event of score.events) {
      expect(event.pitch).toBeGreaterThanOrEqual(piano.lowestNote);
      expect(event.pitch).toBeLessThanOrEqual(piano.highestNote);
      expect(event.startTick + event.durationTicks).toBeLessThanOrEqual(score.projectEndTick);
      expect(event.harmonicContext.chordIds.length).toBeGreaterThan(0);
      if (event.musicalRole === 'suspension'
        || event.harmonicContext.pitchClasses.includes(event.pitch % 12)) continue;
      const plannedChromaticNeighbor = event.voiceId === 'rh.melody'
        && plannedNeighborTicks.has(event.startTick)
        && plan.motif?.tensionResolution.kind === 'chromatic-neighbor'
        && plan.motif.tones.some((tone) => tone.position === 2 && tone.function === 'chromatic-neighbor')
        && melody.some((candidate) => candidate.phraseId === event.phraseId
          && candidate.startTick > event.startTick
          && Math.abs(candidate.pitch - event.pitch) <= 2
          && candidate.harmonicContext.pitchClasses.includes(candidate.pitch % 12));
      expect(plannedChromaticNeighbor,
        `${event.voiceId} off-chord pitch ${event.pitch} has an explicit motif plan and chord-tone resolution`).toBe(true);
    }
    for (const tension of score.events.filter((event) => event.gestureIntent === 'prepared-tension')) {
      const resolution = score.events.find((event) => event.voiceId === tension.voiceId
        && event.gestureIntent === 'stepwise-resolution'
        && event.startTick >= tension.startTick + tension.durationTicks
        && event.phraseId !== null);
      expect(resolution).toBeDefined();
      expect(Math.abs(resolution!.pitch - tension.pitch)).toBeLessThanOrEqual(2);
    }

    const phraseTextures = new Set(plan.phrases.map((phrase) => phrase.texture.kind));
    expect(phraseTextures.size).toBeGreaterThan(1);
    expect(noUnisonOverlap(score)).toBe(true);
    const playability = validatePianoScorePlayability(score, {
      lowestNote: piano.lowestNote,
      highestNote: piano.highestNote,
    });
    expect(playability.violations).toEqual([]);
  });

  it('writes broken chords, arpeggiation, dialogue, hybrid pulse, and reserved flourishes into the score', () => {
    const sample = composerSample('ensemble.chamber', 17, dorian);
    const basePhrase = sample.plan.phrases.find((phrase) => phrase.endTick - phrase.startTick >= 8 * PPQ)!;
    const fillDecision: PianoComposerPlan['fillDecisions'][number] = {
      target: 'piano',
      startTick: basePhrase.startTick + PPQ,
      endTick: basePhrase.startTick + 4 * PPQ,
      sectionId: basePhrase.sectionId,
      decision: 'consider-brief-gesture',
      observedWrittenActivity: { availability: 'available', activeTrackIds: [], onsetCount: 0 },
      rationale: 'Stage 3 score regression reservation.',
      mandatory: false,
    };
    const patternCases: Array<{
      readonly kind: PianoTextureKind;
      readonly identity: PianoTemplateIdentity;
      readonly technique: PianoScore['events'][number]['techniqueIntent'];
      readonly fill?: boolean;
    }> = [
      { kind: 'broken-chords', identity: 'chamber-counterpoint', technique: 'broken-chord-accompaniment' },
      { kind: 'arpeggiated', identity: 'cinematic-expanse', technique: 'arpeggiated-chord-accompaniment' },
      { kind: 'contrapuntal-dialogue', identity: 'sonata-dialogue', technique: 'independent-counterline' },
      { kind: 'arpeggiated', identity: 'hybrid-pulse-and-color', technique: 'pulsed-bass-pattern' },
      { kind: 'short-flourishes', identity: 'sonata-dialogue', technique: 'staccato-fill-gesture', fill: true },
    ];

    for (const pattern of patternCases) {
      const forced = forcedTexturePlan(sample.plan, pattern.kind, pattern.identity,
        pattern.fill ? { fillDecision } : {});
      const score = composePianoScore(sample.input, forced.plan, sample.piano, projectEndTick(sample.project));
      const plannedPatternEvents = score.events.filter((event) => event.phraseId === forced.phrase.id
        && event.techniqueIntent === pattern.technique);
      expect(plannedPatternEvents.length, `${pattern.identity} ${pattern.kind} must reach score notes`).toBeGreaterThan(0);
      expect(plannedPatternEvents.every((event) => event.startTick >= forced.phrase.startTick
        && event.startTick < forced.phrase.endTick)).toBe(true);
      expect(noUnisonOverlap(score)).toBe(true);
      expect(validatePianoScorePlayability(score, {
        lowestNote: sample.piano.lowestNote,
        highestNote: sample.piano.highestNote,
      }).violations).toEqual([]);

      if (pattern.kind === 'short-flourishes') {
        expect(plannedPatternEvents.every((event) => event.startTick >= fillDecision.startTick
          && event.startTick < fillDecision.endTick)).toBe(true);
        expect(plannedPatternEvents.every((event) => event.articulation === 'staccato')).toBe(true);
      }
    }

    const restrictedStart = basePhrase.startTick + PPQ;
    const restrictedEnd = basePhrase.startTick + 2 * PPQ;
    const restriction = {
      bar: 1,
      startTick: restrictedStart,
      endTick: restrictedEnd,
      reason: 'near-silence-zero-energy' as const,
      rationale: 'A Composer regression gate forbids new accompaniment onsets here.',
    };
    const forcedPulse = forcedTexturePlan(sample.plan, 'arpeggiated', 'hybrid-pulse-and-color', {
      attackRestriction: restriction,
      fillDecision: {
        target: 'piano', startTick: restrictedStart, endTick: restrictedEnd,
        sectionId: basePhrase.sectionId, decision: 'leave-space',
        observedWrittenActivity: { availability: 'available', activeTrackIds: [], onsetCount: 0 },
        rationale: 'Explicit leave-space regression gate.', mandatory: false,
      },
    });
    const gatedScore = composePianoScore(
      sample.input, forcedPulse.plan, sample.piano, projectEndTick(sample.project),
    );
    expect(gatedScore.events.some((event) => event.startTick >= restrictedStart && event.startTick < restrictedEnd
      && event.voiceId !== 'rh.suspension')).toBe(false);
  });
});
