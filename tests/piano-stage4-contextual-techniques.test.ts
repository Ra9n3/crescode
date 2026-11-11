import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import {
  composePianoPlan,
  composePianoScore,
  type PianoComposerPlan,
  type PianoPhraseIntention,
  type PianoTextureKind,
} from '../src/orchestrator/keys/piano-composer';
import { validatePianoScorePlayability } from '../src/orchestrator/keys/piano-playability';
import { realizePianoPlanWithAudit } from '../src/orchestrator/keys/piano-realizer';
import type { PianoEngineInput } from '../src/orchestrator/keys/piano-engine';
import type { PianoScore } from '../src/orchestrator/keys/piano-score';
import { isInstrumentTrack, projectFromFixture, type Project, type Track } from '../src/shared/schema';
import { PPQ } from '../src/shared/schema/types';
import { projectEndTick } from '../src/shared/schema/meter';

const sampleCache = new Map<string, {
  project: Project;
  input: ReturnType<typeof composeAllTracks>['pianoEngineInput'];
  piano: Track;
  plan: PianoComposerPlan;
  score: PianoScore;
}>();

function composerSample(templateId: string, seed = 11) {
  const key = `${templateId}:${seed}`;
  const cached = sampleCache.get(key);
  if (cached) return cached;
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed, density: 1, moments: false });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.family === 'Keys' && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} returned no Piano target.`);
  const productionInput = result.pianoEngineInput;
  const input = {
    ...productionInput,
    context: {
      ...productionInput.context,
      layerInformation: {
        ...productionInput.context.layerInformation,
        perBar: productionInput.context.layerInformation.perBar.map((bar) => ({ ...bar, layers: [] })),
      },
    },
    analysis: { tracks: [] },
  };
  const plan = composePianoPlan(input, analyzePianoInput(input));
  const score = composePianoScore(input, plan, piano, projectEndTick(project));
  const sample = { project, input, piano, plan, score };
  sampleCache.set(key, sample);
  return sample;
}

function stableUnitRandom(seed: number, label: string): number {
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

function phraseForVocabulary(
  plan: PianoComposerPlan,
  band: readonly [number, number],
): PianoPhraseIntention {
  const phrase = plan.phrases.find((candidate) => {
    const roll = stableUnitRandom(plan.seed, `score-accompaniment-vocabulary:${candidate.id}`);
    return candidate.function !== 'release'
      && candidate.function !== 'arrival'
      && candidate.function !== 'statement-and-landing'
      && roll >= band[0] && roll < band[1]
      && plan.harmonicEvents.some((event) => event.phraseId === candidate.id
        && event.chord.endTick - event.chord.startTick >= 4 * PPQ);
  });
  if (!phrase) throw new Error(`No stable score-figure opportunity exists in selection band ${band.join('–')}.`);
  return phrase;
}

function contextualPhrasePlan(
  plan: PianoComposerPlan,
  phrase: PianoPhraseIntention,
  texture: PianoTextureKind,
  options: { busyBass?: boolean; lead?: boolean; occupancyKnown?: boolean } = {},
): PianoComposerPlan {
  const purpose: PianoPhraseIntention['texture']['purpose'] = texture === 'sparse-sustained'
    ? 'preserve-space'
    : texture === 'broken-chords' ? 'connect-harmony'
      : texture === 'arpeggiated' ? 'build-motion'
        : texture === 'melody-accompaniment' ? 'carry-melody'
          : texture === 'block-chords' ? 'mark-arrival'
            : texture === 'contrapuntal-dialogue' ? 'exchange-voices' : 'punctuate-phrase';
  const phrases = plan.phrases.map((candidate) => candidate.id !== phrase.id ? candidate : {
    ...candidate,
    function: 'development' as const,
    intendedDensity: 'moderate' as const,
    texture: { ...candidate.texture, kind: texture, purpose },
    motif: candidate.motif.operation === 'withhold-under-lead'
      ? { ...candidate.motif, operation: 'fragmented-recall' as const }
      : candidate.motif,
  });
  const harmonicEvents = plan.harmonicEvents.map((event) => event.phraseId !== phrase.id ? event : {
    ...event,
    hands: {
      ...event.hands,
      left: { ...event.hands.left, motion: 'change-with-harmony' as const },
      right: { ...event.hands.right, motion: 'motif-led' as const, density: 'moderate' as const },
    },
    orchestration: {
      ...event.orchestration,
      activeTrackIds: options.busyBass ? ['basses'] : [],
      activeRoles: options.busyBass ? ['basses'] : [],
      explicitLeadTrackIds: options.lead ? ['violins1'] : [],
      momentKinds: [],
      interaction: 'interweave' as const,
      analyzerEvidence: 'available' as const,
      registerOccupancy: {
        low: options.busyBass ? 5 : 0,
        middle: 0,
        high: 0,
        total: options.busyBass ? 5 : 0,
        availability: options.occupancyKnown === false ? 'unavailable' as const : 'available' as const,
      },
    },
    dynamicIntent: {
      ...event.dynamicIntent,
      intensity: 3 as const,
      sourceEnergyTarget: 0.8,
      sourceEnergyNearSilence: false,
    },
  });
  return {
    ...plan,
    phrases,
    harmonicEvents,
    fillDecisions: plan.fillDecisions.filter((fill) =>
      fill.endTick <= phrase.startTick || fill.startTick >= phrase.endTick),
    attackRestrictions: plan.attackRestrictions.filter((window) =>
      window.endTick <= phrase.startTick || window.startTick >= phrase.endTick),
  };
}

function scoreForPlan(
  sample: ReturnType<typeof composerSample>,
  plan: PianoComposerPlan,
  input = sample.input,
): PianoScore {
  return composePianoScore(input, plan, sample.piano, projectEndTick(sample.project));
}

function byChord(events: readonly PianoScore['events'][number][]) {
  const grouped = new Map<string, PianoScore['events'][number][]>();
  for (const event of events) {
    const chordId = event.harmonicContext.chordIds[0] ?? 'missing-chord';
    const group = grouped.get(chordId) ?? [];
    group.push(event);
    grouped.set(chordId, group);
  }
  return [...grouped.values()].map((group) => group.sort((a, b) => a.startTick - b.startTick));
}

function withoutUnisonOverlap(score: PianoScore): boolean {
  for (let index = 0; index < score.events.length; index++) {
    const current = score.events[index];
    for (const other of score.events.slice(index + 1)) {
      if (current.pitch !== other.pitch) continue;
      if (current.startTick < other.startTick + other.durationTicks
        && other.startTick < current.startTick + current.durationTicks) return false;
    }
  }
  return true;
}

function withMotifAnticipation(
  plan: PianoComposerPlan,
  phrase: PianoPhraseIntention,
): PianoComposerPlan {
  const cells = [...(phrase.rhythmicPlan.motifCells ?? [])];
  if (!cells.length) {
    cells.push({ startOffsetTicks: 0, positions: [0, 1, 3], variation: 'statement' });
  } else {
    cells[0] = { ...cells[0], positions: [0, 1, 3] };
  }
  const modifiedPhrase = {
    ...phrase,
    function: 'development' as const,
    intendedDensity: 'moderate' as const,
    texture: { ...phrase.texture, kind: 'melody-accompaniment' as const, purpose: 'carry-melody' as const },
    motif: { ...phrase.motif, operation: 'sequence-in-new-harmony' as const },
    rhythmicPlan: {
      ...phrase.rhythmicPlan,
      motifCells: cells,
      syncopation: {
        displacedPosition: 1 as const,
        offsetTicks: -480 as const,
        resolvesAtPosition: null,
        rationale: 'A controlled Composer regression displaces one actual motif event early.',
      },
    },
  };
  const contextual = contextualPhrasePlan(plan, phrase, 'melody-accompaniment');
  return {
    ...contextual,
    phrases: contextual.phrases.map((candidate) => candidate.id === phrase.id ? modifiedPhrase : candidate),
  };
}

function expectedQuantizedMotifTick(phrase: PianoPhraseIntention, position: 0 | 1 | 2 | 3, displacement: number): number {
  const cell = phrase.rhythmicPlan.motifCells?.[0];
  if (!cell) throw new Error('The anticipation test needs a Composer motif cell.');
  const grid = Math.max(1, phrase.rhythmicPlan.gridTicks ?? PPQ / 2);
  const sourceWeights = phrase.rhythmicPlan.weights.length === 4
    ? phrase.rhythmicPlan.weights : [0.25, 0.25, 0.25, 0.25];
  const safe = sourceWeights.map((weight) => Number.isFinite(weight) && weight > 0 ? weight : 0);
  const total = safe.reduce((sum, weight) => sum + weight, 0) || 1;
  const weights = safe.map((weight) => weight / total);
  const offsets = [0, weights[0], weights[0] + weights[1], weights[0] + weights[1] + weights[2]];
  const cellStart = phrase.startTick + cell.startOffsetTicks;
  const cellTicks = Math.max(1, phrase.rhythmicPlan.cellTicks ?? 2 * PPQ);
  const cellEnd = Math.min(phrase.endTick, cellStart + cellTicks);
  const first = Math.ceil(cellStart / grid) * grid;
  const last = Math.floor((cellEnd - 1) / grid) * grid;
  const raw = cellStart + offsets[position] * (cellEnd - cellStart) + displacement;
  return Math.max(first, Math.min(last, Math.round(raw / grid) * grid));
}

describe('Piano Stage 4 contextual score techniques', () => {
  it('writes Alberti, walking-bass, and repeated-note ostinato events only in compatible open contexts', () => {
    const cases: Array<{
      readonly templateId: string;
      readonly band: readonly [number, number];
      readonly texture: PianoTextureKind;
      readonly technique: 'alberti-bass-accompaniment' | 'walking-bass-line' | 'rhythmic-ostinato';
      readonly voiceId: 'lh.support' | 'lh.bass';
    }> = [
      {
        templateId: 'ensemble.chamber', band: [0, 0.22], texture: 'broken-chords',
        technique: 'alberti-bass-accompaniment', voiceId: 'lh.support',
      },
      {
        templateId: 'ensemble.sonata', band: [0.22, 0.42], texture: 'broken-chords',
        technique: 'walking-bass-line', voiceId: 'lh.bass',
      },
      {
        templateId: 'ensemble.hybridstudio', band: [0.42, 0.52], texture: 'melody-accompaniment',
        technique: 'rhythmic-ostinato', voiceId: 'lh.bass',
      },
    ];

    for (const item of cases) {
      const sample = composerSample(item.templateId, 11);
      const phrase = phraseForVocabulary(sample.plan, item.band);
      const forcedPlan = contextualPhrasePlan(sample.plan, phrase, item.texture);
      const score = scoreForPlan(sample, forcedPlan);
      const repeatedScore = scoreForPlan(sample, forcedPlan);
      expect(JSON.stringify(repeatedScore.events), `${item.technique} score determinism`)
        .toBe(JSON.stringify(score.events));
      const notes = score.events.filter((event) => event.phraseId === phrase.id
        && event.voiceId === item.voiceId && event.techniqueIntent === item.technique);
      expect(notes.length, `${item.technique} must reach Composer-written notes`).toBeGreaterThan(0);
      expect(notes.every((event) => event.harmonicContext.chordIds.length > 0
        && event.harmonicContext.pitchClasses.includes(event.pitch % 12))).toBe(true);
      expect(withoutUnisonOverlap(score)).toBe(true);
      expect(validatePianoScorePlayability(score, {
        lowestNote: sample.piano.lowestNote,
        highestNote: sample.piano.highestNote,
      }).violations).toEqual([]);

      const groups = byChord(notes);
      expect(groups.some((group) => group.length === 4), `${item.technique} uses a bounded four-note cell`).toBe(true);
      for (const group of groups) expect(group.length).toBeLessThanOrEqual(4);
      if (item.technique === 'alberti-bass-accompaniment') {
        const cell = groups.find((group) => group.length === 4)!;
        expect(cell[0].pitch).toBe(cell[3].pitch);
        expect(cell[0].pitch).toBeGreaterThan(cell[1].pitch);
        expect(cell[1].pitch).not.toBe(cell[2].pitch);
      } else if (item.technique === 'walking-bass-line') {
        const cell = groups.find((group) => group.length === 4)!;
        const intervals = cell.slice(1).map((event, index) => event.pitch - cell[index].pitch);
        expect(intervals.every((interval) => Math.abs(interval) <= 5 && interval !== 0)).toBe(true);
      } else {
        const cell = groups.find((group) => group.length === 4)!;
        expect(new Set(cell.map((event) => event.pitch)).size).toBe(1);
        expect(cell.slice(1).map((event, index) => event.startTick - cell[index].startTick))
          .toEqual([PPQ, PPQ, PPQ]);
      }

      for (const blocked of [
        contextualPhrasePlan(sample.plan, phrase, item.texture, { busyBass: true }),
        contextualPhrasePlan(sample.plan, phrase, item.texture, { lead: true }),
        contextualPhrasePlan(sample.plan, phrase, item.texture, { occupancyKnown: false }),
      ]) {
        const blockedScore = scoreForPlan(sample, blocked);
        expect(blockedScore.events.some((event) => event.phraseId === phrase.id
          && event.techniqueIntent === item.technique)).toBe(false);
      }
    }
  });

  it('realizes a planned Hybrid anticipation as an earlier, articulated motif event', () => {
    const sample = composerSample('ensemble.hybridstudio', 11);
    const phrase = sample.plan.phrases.find((candidate) => candidate.function !== 'release'
      && (candidate.rhythmicPlan.motifCells?.length ?? 0) > 0);
    if (!phrase) throw new Error('The controlled Hybrid fixture needs a motif phrase.');
    const forcedPlan = withMotifAnticipation(sample.plan, phrase);
    const forcedPhrase = forcedPlan.phrases.find((candidate) => candidate.id === phrase.id)!;
    const score = scoreForPlan(sample, forcedPlan);
    const displacedTick = expectedQuantizedMotifTick(forcedPhrase, 1, -480);
    const unshiftedTick = expectedQuantizedMotifTick(forcedPhrase, 1, 0);
    expect(displacedTick).toBeLessThan(unshiftedTick);
    const anticipation = score.events.find((event) => event.phraseId === phrase.id
      && event.voiceId === 'rh.melody'
      && event.startTick === displacedTick
      && event.techniqueIntent === 'phrase-anticipation');
    expect(anticipation).toBeDefined();
    expect(anticipation).toMatchObject({
      gestureIntent: 'anticipated-subject',
      noteRoleTag: 'lift',
      articulation: 'detache',
    });
    expect(anticipation!.harmonicContext.pitchClasses).toContain(anticipation!.pitch % 12);
  });

  it('adds one playable octave reinforcement only at a high, policy-permitted arrival', () => {
    const sample = composerSample('ensemble.chamber', 11);
    const inputAtEnergy = (target: number): PianoEngineInput => ({
      ...sample.input,
      context: {
        ...sample.input.context,
        energy: sample.input.context.energy.map((entry) => ({ ...entry, target, nearSilence: false })),
        moments: [],
        fillWindows: [],
        layerInformation: {
          ...sample.input.context.layerInformation,
          perBar: sample.input.context.layerInformation.perBar.map((entry) => ({ ...entry, layers: [] })),
        },
      },
      analysis: { tracks: [] },
    });
    const writeArrival = (input: PianoEngineInput) => {
      const basePlan = composePianoPlan(input, analyzePianoInput(input));
      const baseScore = scoreForPlan(sample, basePlan, input);
      const phrase = [...basePlan.phrases].reverse().find((candidate) => baseScore.events.some((event) =>
        event.phraseId === candidate.id && event.voiceId === 'rh.melody'));
      if (!phrase) throw new Error('The high-energy controlled fixture needs a written melody event.');
      const phrases = basePlan.phrases.map((candidate) => candidate.id !== phrase.id ? candidate : {
        ...candidate,
        function: 'arrival' as const,
      });
      const harmonicEvents = basePlan.harmonicEvents.map((event) => event.phraseId !== phrase.id ? event : {
        ...event,
        structuralRole: 'arrival' as const,
        orchestration: {
          ...event.orchestration,
          activeTrackIds: [],
          activeRoles: [],
          explicitLeadTrackIds: [],
          momentKinds: [],
          interaction: 'interweave' as const,
        },
      });
      const plan = { ...basePlan, phrases, harmonicEvents };
      return { phrase, plan, score: scoreForPlan(sample, plan, input) };
    };

    const highInput = inputAtEnergy(0.92);
    const high = writeArrival(highInput);
    expect(high.plan.templateConstraints.octaveDoubling).toBe('climaxOnly');
    const octave = high.score.events.filter((event) => event.phraseId === high.phrase.id
      && event.voiceId === 'rh.octave');
    expect(octave).toHaveLength(1);
    const doubledMelody = high.score.events.find((event) => event.phraseId === high.phrase.id
      && event.voiceId === 'rh.melody' && event.startTick === octave[0].startTick);
    expect(doubledMelody).toBeDefined();
    expect(Math.abs(octave[0].pitch - doubledMelody!.pitch)).toBe(12);
    expect(octave[0].durationTicks).toBeLessThanOrEqual(PPQ);
    expect(octave[0].dynamicIntent.velocity).toBeLessThan(doubledMelody!.dynamicIntent.velocity);
    const noOctaveInput: PianoEngineInput = {
      ...highInput,
      context: {
        ...highInput.context,
        rules: highInput.context.rules.filter((rule) => rule.type !== 'octaveDoubling'),
      },
    };
    const withoutOctave = scoreForPlan(sample, high.plan, noOctaveInput);
    const normalizeFindings = (score: PianoScore) => validatePianoScorePlayability(score, {
      lowestNote: sample.piano.lowestNote,
      highestNote: sample.piano.highestNote,
    }).violations.map(({ code, severity, tick, endTick, message, hand }) =>
      [code, severity, tick, endTick, message, hand]);
    expect(normalizeFindings(high.score)).toEqual(normalizeFindings(withoutOctave));
    const doubledPair: PianoScore = {
      ...high.score,
      events: high.score.events.filter((event) => event.phraseId === high.phrase.id
        && event.startTick === octave[0].startTick
        && (event.voiceId === 'rh.melody' || event.voiceId === 'rh.octave')),
    };
    expect(validatePianoScorePlayability(doubledPair, {
      lowestNote: sample.piano.lowestNote,
      highestNote: sample.piano.highestNote,
    }).violations).toEqual([]);
    const realized = realizePianoPlanWithAudit({
      plan: high.plan,
      score: high.score,
      targetTrack: sample.piano,
      projectEndTick: projectEndTick(sample.project),
    });
    expect(realized.notes.some((note) => note.pitch === octave[0].pitch
      && note.startTick === octave[0].startTick
      && note.durationTicks === octave[0].durationTicks)).toBe(true);

    const low = writeArrival(inputAtEnergy(0.4));
    expect(low.score.events.some((event) => event.voiceId === 'rh.octave')).toBe(false);
  });
});