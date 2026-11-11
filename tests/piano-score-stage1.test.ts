import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScore, type PianoPhraseIntention } from '../src/orchestrator/keys/piano-composer';
import { validatePianoScorePlayability } from '../src/orchestrator/keys/piano-playability';
import { createPianoScore, pianoScoreEventToNote, type PianoScore, type PianoScoreEvent } from '../src/orchestrator/keys/piano-score';
import { realizePianoPlanWithAudit } from '../src/orchestrator/keys/piano-realizer';
import { projectFromFixture } from '../src/shared/schema';
import { barTicks, projectEndTick } from '../src/shared/schema/meter';
import { PPQ, type Project } from '../src/shared/schema/types';

const GENERATION_IDENTITY = {
  algorithm: 'piano-engine-v5' as const,
  key: 'stage1-test-score',
  orchestrationSeed: 11,
  userSeed: 11,
  take: 1,
  density: 1,
  seed: 11,
};

function scoreEvent(id: string, patch: Partial<PianoScoreEvent> = {}): PianoScoreEvent {
  return {
    id,
    pitch: 60,
    startTick: 0,
    durationTicks: 480,
    hand: 'right',
    voiceId: 'rh.inner',
    musicalRole: 'inner',
    phraseId: 'phrase-1',
    sectionId: 'section-1',
    gestureIntent: 'inner-voice',
    techniqueIntent: 'voice-led-inner-tone',
    noteRoleTag: 'bed',
    articulation: 'legato',
    dynamicIntent: { intensity: 2, velocity: 48, phraseShape: 'plateau', sourceEnergyTarget: 0.4 },
    harmonicContext: { chordIds: ['chord-1'], chordSymbols: ['C'], pitchClasses: [0, 4, 7], quality: 'major' },
    ...patch,
  };
}

function scoreOf(events: readonly PianoScoreEvent[], projectEndTick = 3840): PianoScore {
  return createPianoScore({
    generationIdentity: GENERATION_IDENTITY,
    templateId: 'ensemble.chamber',
    projectEndTick,
    events,
    rests: [],
  });
}

function stageOneChamberPhrase(seed = 29) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const composition = composeAllTracks(project, { seed });
  const productionInput = composition.pianoEngineInput;
  const scoreInput = {
    ...productionInput,
    context: {
      ...productionInput.context,
      fillWindows: [],
      moments: [],
      layerInformation: {
        ...productionInput.context.layerInformation,
        perBar: productionInput.context.layerInformation.perBar.map((bar) => ({ ...bar, layers: [] })),
      },
    },
    analysis: { tracks: [] },
  };
  const analysis = analyzePianoInput(scoreInput);
  const plan = composePianoPlan(scoreInput, analysis);
  const target = project.tracks.find((track) => track.role === 'piano')!;
  const score = composePianoScore(scoreInput, plan, target, projectEndTick(project));
  return { project, composition, scoreInput, plan, target, score };
}

function weightedMotifTicks(phrase: PianoPhraseIntention, cellIndex: number): number[] {
  const cell = phrase.rhythmicPlan.motifCells?.[cellIndex];
  if (!cell) return [];
  const grid = Math.max(1, phrase.rhythmicPlan.gridTicks ?? PPQ / 2);
  const cellTicks = Math.max(1, phrase.rhythmicPlan.cellTicks ?? 2 * PPQ);
  const start = phrase.startTick + cell.startOffsetTicks;
  const end = Math.min(phrase.endTick, start + cellTicks);
  const span = end - start;
  if (span <= 0) return [];
  const sourceWeights = phrase.rhythmicPlan.weights.length === 4
    ? phrase.rhythmicPlan.weights : [0.25, 0.25, 0.25, 0.25];
  const total = sourceWeights.reduce((sum, weight) => sum + Math.max(0, weight), 0) || 1;
  const weights = sourceWeights.map((weight) => Math.max(0, weight) / total);
  const offsets = [0, weights[0], weights[0] + weights[1], weights[0] + weights[1] + weights[2]];
  const firstGrid = Math.ceil(start / grid) * grid;
  const lastGrid = Math.floor((end - 1) / grid) * grid;
  return cell.positions.map((position) => {
    const displacement = phrase.rhythmicPlan.syncopation?.displacedPosition === position
      ? phrase.rhythmicPlan.syncopation.offsetTicks : 0;
    const quantized = Math.round((start + offsets[position] * span + displacement) / grid) * grid;
    return Math.max(firstGrid, Math.min(lastGrid, quantized));
  });
}

describe('Piano Stage 1 note-level score contract', () => {
  it('writes a controlled Chamber phrase with an upper line, connected bass, support, coordinated hands, rests, and a clear landing', () => {
    const { plan, target, score } = stageOneChamberPhrase();
    expect(score.templateId).toBe('ensemble.chamber');
    expect(score.events.length).toBeGreaterThan(0);

    const phrase = plan.phrases.find((candidate) => score.events.some((event) => event.phraseId === candidate.id));
    expect(phrase).toBeDefined();
    const phraseEvents = score.events.filter((event) => event.phraseId === phrase!.id);
    const voices = new Set(phraseEvents.map((event) => event.voiceId));
    expect(voices).toContain('lh.bass');
    expect(voices).toContain('lh.support');
    expect(voices).toContain('rh.inner');
    expect(voices).toContain('rh.melody');
    expect(phraseEvents.some((event) => event.hand === 'left')).toBe(true);
    expect(phraseEvents.some((event) => event.hand === 'right')).toBe(true);
    expect(phraseEvents.some((left) => phraseEvents.some((right) =>
      left.hand !== right.hand && left.startTick === right.startTick))).toBe(true);
    expect(phraseEvents.some((event) => event.voiceId === 'rh.melody' && event.pitch > 60)).toBe(true);
    expect(phraseEvents.some((event) => event.voiceId === 'lh.bass' && event.durationTicks >= 960)).toBe(true);
    expect(score.rests.some((rest) => rest.phraseId === phrase!.id)).toBe(true);

    for (const event of score.events) {
      expect(Number.isInteger(event.pitch) && event.pitch >= target.lowestNote && event.pitch <= target.highestNote).toBe(true);
      expect(Number.isInteger(event.startTick) && event.startTick >= 0).toBe(true);
      expect(Number.isInteger(event.durationTicks) && event.durationTicks > 0).toBe(true);
      expect(event.harmonicContext.chordIds.length).toBeGreaterThan(0);
      expect(event.dynamicIntent.velocity).toBeGreaterThanOrEqual(1);
      expect(event.dynamicIntent.velocity).toBeLessThanOrEqual(127);
    }

    const landing = score.events.filter((event) => event.gestureIntent === 'cadential-landing');
    expect(landing.length).toBeGreaterThan(0);
    expect(Math.max(...landing.map((event) => event.startTick + event.durationTicks)))
      .toBe(Math.min(score.projectEndTick, plan.ending.tick!));
  });

  it('realizes Chamber motif contour, weighted rhythm, harmonic resolutions, voice identity, and landings in Composer score events', () => {
    const samples = [11, 29, 47].map((seed) => stageOneChamberPhrase(seed));
    const signatures: string[] = [];

    for (const sample of samples) {
      const { plan, score, project, scoreInput, target } = sample;
      const melody = score.events.filter((event) => event.voiceId === 'rh.melody')
        .sort((a, b) => a.startTick - b.startTick);
      expect(melody.length).toBeGreaterThan(6);
      expect(melody.every((event) => event.hand === 'right' && event.phraseId !== null
        && event.harmonicContext.chordIds.length > 0)).toBe(true);
      expect(new Set(melody.map((event) => event.pitch)).size).toBeGreaterThan(3);
      const pitchCounts = new Map<number, number>();
      for (const event of melody) pitchCounts.set(event.pitch, (pitchCounts.get(event.pitch) ?? 0) + 1);
      expect(Math.max(...pitchCounts.values()) / melody.length).toBeLessThan(0.5);
      expect(melody.slice(1).every((event, index) => Math.abs(event.pitch - melody[index].pitch) <= 12)).toBe(true);

      const plannedTicks = new Set<number>();
      for (const phrase of plan.phrases) {
        for (const [cellIndex] of (phrase.rhythmicPlan.motifCells ?? []).entries()) {
          for (const tick of weightedMotifTicks(phrase, cellIndex)) plannedTicks.add(tick);
        }
      }
      expect(melody.every((event) => plannedTicks.has(event.startTick)
        || (event.musicalRole === 'cadence' && plan.ending.chordId !== null
          && event.harmonicContext.chordIds.includes(plan.ending.chordId))),
      'upper-line attacks should come from Composer motif cells or the explicit final landing').toBe(true);

      const voiceIds = new Set(score.events.map((event) => event.voiceId));
      expect([...voiceIds]).toEqual(expect.arrayContaining(['lh.bass', 'lh.support', 'rh.inner', 'rh.melody']));
      expect(score.events.some((left) => left.hand === 'left' && score.events.some((right) =>
        right.hand === 'right' && right.startTick === left.startTick))).toBe(true);

      for (const event of melody) {
        const source = plan.harmonicEvents.find((candidate) => candidate.chord.startTick <= event.startTick
          && event.startTick < candidate.chord.endTick);
        expect(source, `melody onset ${event.startTick} has supplied harmony`).toBeDefined();
        if (!source!.chord.availablePitchClasses.map((pitchClass) => ((pitchClass % 12) + 12) % 12)
          .includes(event.pitch % 12)) {
          const resolution = melody.find((candidate) => candidate.phraseId === event.phraseId
            && candidate.startTick > event.startTick);
          expect(resolution, `non-chord tone at ${event.startTick} resolves in its phrase`).toBeDefined();
          expect(Math.abs(resolution!.pitch - event.pitch)).toBeLessThanOrEqual(2);
          const resolvingHarmony = plan.harmonicEvents.find((candidate) => candidate.chord.startTick <= resolution!.startTick
            && resolution!.startTick < candidate.chord.endTick);
          expect(resolvingHarmony?.chord.availablePitchClasses.map((pitchClass) => ((pitchClass % 12) + 12) % 12))
            .toContain(resolution!.pitch % 12);
        }
      }

      const finalHarmony = plan.harmonicEvents.find((event) => event.chord.id === plan.ending.chordId);
      expect(finalHarmony).toBeDefined();
      const finalMelody = melody.filter((event) => event.harmonicContext.chordIds.includes(plan.ending.chordId!));
      if (finalMelody.length) {
        const landing = finalMelody[finalMelody.length - 1];
        expect(finalHarmony!.chord.availablePitchClasses.map((pitchClass) => ((pitchClass % 12) + 12) % 12))
          .toContain(landing.pitch % 12);
        expect(landing.startTick + landing.durationTicks).toBe(plan.ending.tick);
      } else {
        const upperChordLanding = score.events.some((event) => event.hand === 'right'
          && event.musicalRole === 'cadence'
          && event.harmonicContext.chordIds.includes(plan.ending.chordId!));
        expect(finalHarmony!.suspension !== null || upperChordLanding,
          'an unmelodized ending still has an explicit suspension or upper chord-tone landing').toBe(true);
      }
      expect(score.events.some((event) => event.voiceId === 'lh.bass' && event.musicalRole === 'cadence'
        && event.startTick + event.durationTicks === plan.ending.tick)).toBe(true);

      const repeated = composePianoScore(scoreInput, plan, target, projectEndTick(project));
      expect(JSON.stringify(repeated)).toBe(JSON.stringify(score));
      signatures.push(melody.map((event) => `${event.startTick}:${event.pitch}`).join('|'));
    }
    expect(new Set(signatures).size).toBeGreaterThan(1);

    const { plan, score } = samples[1]; // Seed 29 provides a complete planned four-position Chamber cell.
    const phrase = plan.phrases.find((candidate) =>
      candidate.rhythmicPlan.motifCells?.some((cell) => cell.positions.length === 4))!;
    const cellIndex = phrase.rhythmicPlan.motifCells!.findIndex((cell) => cell.positions.length === 4);
    const cell = phrase.rhythmicPlan.motifCells![cellIndex];
    const ticks = weightedMotifTicks(phrase, cellIndex);
    const events = ticks.map((tick) => score.events.find((event) => event.voiceId === 'rh.melody'
      && event.phraseId === phrase.id && event.startTick === tick));
    expect(events.every((event) => event !== undefined)).toBe(true);
    expect(events[0]!.harmonicContext.chordIds.length).toBeGreaterThan(0);

    const contour = cell.variation === 'reframe'
      ? plan.motif!.intervalContour.map((interval) => -interval)
      : [...plan.motif!.intervalContour];
    const anchorPitchClass = events[0]!.pitch % 12;
    for (let position = 1; position < cell.positions.length; position++) {
      const attackPosition = cell.positions[position];
      const expectedPitchClass = ((anchorPitchClass
        + contour.slice(0, attackPosition).reduce((sum, interval) => sum + interval, 0)) % 12 + 12) % 12;
      const source = plan.harmonicEvents.find((candidate) => candidate.chord.startTick <= ticks[position]
        && ticks[position] < candidate.chord.endTick)!;
      const consonantTarget = source.chord.availablePitchClasses.map((pitchClass) => ((pitchClass % 12) + 12) % 12)
        .includes(expectedPitchClass);
      if (consonantTarget || attackPosition === 2) {
        expect(events[position]!.pitch % 12).toBe(expectedPitchClass);
      }
      expect(events[position]!.harmonicContext.chordIds).toContain(source.chord.id);
    }

    if (cell.positions.includes(2) && cell.positions.includes(3) && plan.motif!.tensionResolution.kind === 'chromatic-neighbor') {
      const tensionIndex = cell.positions.indexOf(2);
      const resolutionIndex = cell.positions.indexOf(3);
      const tension = events[tensionIndex]!;
      const resolution = events[resolutionIndex]!;
      const tensionHarmony = plan.harmonicEvents.find((candidate) => candidate.chord.startTick <= tension.startTick
        && tension.startTick < candidate.chord.endTick)!;
      if (!tensionHarmony.chord.availablePitchClasses.map((pitchClass) => ((pitchClass % 12) + 12) % 12)
        .includes(tension.pitch % 12)) {
        expect(Math.abs(resolution.pitch - tension.pitch)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('is deterministic and the Realizer preserves score hand/voice identity without persisting metadata to MIDI Notes', () => {
    const { project, scoreInput, plan, target, score } = stageOneChamberPhrase();
    const repeated = composePianoScore(scoreInput, plan, target, projectEndTick(project));
    expect(JSON.stringify(repeated)).toBe(JSON.stringify(score));

    const realization = realizePianoPlanWithAudit({
      plan,
      score,
      targetTrack: target,
      projectEndTick: projectEndTick(project),
      externalTracks: [],
      tempoMap: project.tempoMap,
      timeSignature: project.timeSignature,
    });
    expect(realization.realizedScoreEvents.map((entry) => entry.source.id))
      .toEqual(score.events.map((event) => event.id));
    expect(new Set(realization.realizedScoreEvents.map((entry) => entry.source.hand))).toEqual(new Set(['left', 'right']));
    expect(new Set(realization.realizedScoreEvents.map((entry) => entry.source.voiceId)).size).toBeGreaterThanOrEqual(4);
    expect(realization.notes).toEqual(realization.realizedScoreEvents.map((entry) => entry.note));
    expect(realization.notes.every((note) => !('hand' in note) && !('voiceId' in note) && !('pianoScoreEventId' in note))).toBe(true);
  });

  it('converts an authored score event to the standard Piano Note shape without changing timing, pitch, or dynamics', () => {
    const event = scoreEvent('conversion', {
      pitch: 74,
      startTick: 720,
      durationTicks: 360,
      noteRoleTag: 'answer',
      articulation: 'marcato',
      dynamicIntent: { intensity: 4, velocity: 75, phraseShape: 'rising-arc', sourceEnergyTarget: 0.9 },
    });
    expect(pianoScoreEventToNote(event)).toEqual({
      pitch: 74,
      startTick: 720,
      durationTicks: 360,
      velocity: 75,
      roleTag: 'answer',
      articulation: 'marcato',
    });
  });
});

describe('report-only Piano playability validator', () => {
  it('reports span, leap, register discontinuity, and hand crossing warnings without mutating the score', () => {
    const score = scoreOf([
      scoreEvent('bass-a', { hand: 'left', voiceId: 'lh.bass', musicalRole: 'bass', pitch: 40, durationTicks: 480 }),
      scoreEvent('left-wide', { hand: 'left', voiceId: 'lh.support', musicalRole: 'support', pitch: 58, durationTicks: 480 }),
      scoreEvent('bass-b', { hand: 'left', voiceId: 'lh.bass', musicalRole: 'bass', pitch: 62, startTick: 480, durationTicks: 480 }),
      scoreEvent('right-cross', { hand: 'right', voiceId: 'rh.inner', pitch: 50, durationTicks: 960 }),
    ]);
    const before = JSON.stringify(score);
    const report = validatePianoScorePlayability(score, { lowestNote: 21, highestNote: 108 });
    expect(report.warnings.some((finding) => finding.code === 'hand-span')).toBe(true);
    expect(report.warnings.some((finding) => finding.code === 'voice-leap')).toBe(true);
    expect(report.warnings.some((finding) => finding.code === 'voice-register-discontinuity')).toBe(true);
    expect(report.warnings.some((finding) => finding.code === 'hand-crossing')).toBe(true);
    expect(JSON.stringify(score)).toBe(before);
  });

  it('separates hard range, impossible span/polyphony, and extreme simultaneous demands from warnings', () => {
    const crowded = [
      35, 40, 45, 50, 55, 60,
    ].map((pitch, index) => scoreEvent(`left-${index}`, {
      pitch,
      hand: 'left',
      voiceId: index % 2 === 0 ? 'lh.bass' : 'lh.support',
      musicalRole: index % 2 === 0 ? 'bass' : 'support',
      startTick: 0,
      durationTicks: 960,
      phraseId: `crowded-${index}`,
    }));
    const right = [65, 68, 71, 74, 77, 80].map((pitch, index) => scoreEvent(`right-${index}`, {
      pitch,
      hand: 'right',
      voiceId: index % 2 === 0 ? 'rh.inner' : 'rh.melody',
      musicalRole: index % 2 === 0 ? 'inner' : 'melody',
      startTick: 0,
      durationTicks: 960,
      phraseId: `right-${index}`,
    }));
    const score = scoreOf([...crowded, ...right, scoreEvent('out-of-range', { pitch: 120, startTick: 1200 })]);
    const report = validatePianoScorePlayability(score, { lowestNote: 21, highestNote: 108 });
    expect(report.violations.some((finding) => finding.code === 'pitch-range')).toBe(true);
    expect(report.violations.some((finding) => finding.code === 'per-hand-polyphony')).toBe(true);
    expect(report.violations.some((finding) => finding.code === 'hand-span')).toBe(true);
    expect(report.violations.some((finding) => finding.code === 'simultaneous-hand-demand')).toBe(true);
  });

  it('reports sustained-note movement conflicts and suspicious attack density, with visible contextual exceptions', () => {
    const events = [
      scoreEvent('sustained-bass', { hand: 'left', voiceId: 'lh.bass', musicalRole: 'bass', pitch: 36, durationTicks: 1920 }),
      scoreEvent('moving-support', { hand: 'left', voiceId: 'lh.support', musicalRole: 'support', pitch: 60, startTick: 960, durationTicks: 240 }),
      ...Array.from({ length: 13 }, (_, index) => scoreEvent(`dense-${index}`, {
        hand: 'right',
        voiceId: index % 2 === 0 ? 'rh.inner' : 'rh.melody',
        musicalRole: index % 2 === 0 ? 'inner' : 'melody',
        pitch: 64 + (index % 5),
        startTick: 2000 + index * 70,
        durationTicks: 30,
        phraseId: `density-${index}`,
      })),
    ];
    const score = scoreOf(events);
    const report = validatePianoScorePlayability(score, {
      lowestNote: 21,
      highestNote: 108,
      barTicks: barTicks({ numerator: 4, denominator: 4 }),
      exceptions: [{ code: 'sustain-movement-conflict', startTick: 960, endTick: 1200, reason: 'Explicit hand-transfer study.' }],
    });
    expect(report.warnings.some((finding) => finding.code === 'suspicious-density')).toBe(true);
    expect(report.warnings.some((finding) => finding.code === 'sustain-movement-conflict'
      && finding.contextualException === 'Explicit hand-transfer study.')).toBe(true);
  });
});
