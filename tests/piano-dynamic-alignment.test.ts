import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/three-chorus-40bars.json';
import { resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScore, type PianoComposerPlan } from '../src/orchestrator/keys/piano-composer';
import type { PianoEngineInput } from '../src/orchestrator/keys/piano-engine';
import { realizePianoPlan, realizePianoPlanWithAudit } from '../src/orchestrator/keys/piano-realizer';
import { projectFromFixture, isInstrumentTrack, type Note, type Project, type Track } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';

const BAR_TICKS = 3840;
const TEMPLATE_CASES = [
  { id: 'ensemble.chamber', label: 'Chamber' },
  { id: 'ensemble.sonata', label: 'Sonata' },
  { id: 'ensemble.vocalbacking', label: 'Vocal Backing' },
  { id: 'ensemble.cinematic', label: 'Cinematic' },
  { id: 'ensemble.hybridstudio', label: 'Hybrid Studio' },
] as const;

type TemplateId = (typeof TEMPLATE_CASES)[number]['id'];
interface ProductionCase {
  readonly project: Project;
  readonly result: ReturnType<typeof composeAllTracks>;
  readonly input: PianoEngineInput;
  readonly pianoTarget: Track;
  readonly plan: PianoComposerPlan;
}

const productionCases = new Map<string, ProductionCase>();

function productionCase(templateId: TemplateId, priorTake = 0): ProductionCase {
  const cacheKey = `${templateId}:${priorTake}`;
  const cached = productionCases.get(cacheKey);
  if (cached) return cached;
  const project = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: priorTake };
  // This suite pins independent Piano phrase dynamics, not lead-response
  // yielding. Keep the actual Compose All path and Conductor phrase boundaries,
  // but mixer-mute all non-Piano lanes so the Piano is the sole visible writer.
  project.tracks = project.tracks.map((track) =>
    isInstrumentTrack(track) && track.role !== 'piano' ? { ...track, muted: true } : track);
  const result = composeAllTracks(project, { seed: 11, pianoComposition: 'classic' });
  const pianoTarget = project.tracks.find((track) =>
    isInstrumentTrack(track) && track.family === 'Keys' && track.role === 'piano');
  if (!pianoTarget) throw new Error(`${templateId} fixture has no Piano target.`);
  const input = result.pianoEngineInput;
  const plan = composePianoPlan(input, analyzePianoInput(input));
  const value = { project, result, input, pianoTarget, plan };
  productionCases.set(cacheKey, value);
  return value;
}

function withOutroEnergy(input: PianoEngineInput, targets: readonly number[]): PianoEngineInput {
  return {
    ...input,
    context: {
      ...input.context,
      energy: input.context.energy.map((entry) => entry.bar >= 37 && entry.bar <= 40
        ? { ...entry, target: targets[entry.bar - 37] }
        : entry),
    },
  };
}

function withChorusThreeEnergy(input: PianoEngineInput, targets: readonly number[]): PianoEngineInput {
  return {
    ...input,
    context: {
      ...input.context,
      energy: input.context.energy.map((entry) => entry.bar >= 29 && entry.bar <= 36
        ? { ...entry, target: targets[entry.bar - 29] }
        : entry),
    },
  };
}

function planFor(input: PianoEngineInput): PianoComposerPlan {
  return composePianoPlan(input, analyzePianoInput(input));
}

function pianoTrack(tracks: readonly Track[]): Track {
  const track = tracks.find((candidate) =>
    isInstrumentTrack(candidate) && candidate.family === 'Keys' && candidate.role === 'piano');
  if (!track) throw new Error('Composed output has no Piano track.');
  return track;
}

function notesInBar(notes: readonly Note[], bar: number): Note[] {
  const startTick = (bar - 1) * BAR_TICKS;
  const endTick = bar * BAR_TICKS;
  return notes.filter((note) => note.startTick >= startTick && note.startTick < endTick);
}

function meanVelocity(notes: readonly Note[]): number {
  return notes.length ? notes.reduce((sum, note) => sum + note.velocity, 0) / notes.length : Number.NaN;
}

function realize(input: PianoEngineInput, project: Project, targetTrack: Track, plan: PianoComposerPlan): readonly Note[] {
  const template = resolveTemplate(project.ensemble);
  const externalTracks = template
    ? input.analysis.tracks
      .filter((track) => template.roster.some((entry) => entry.role === track.role))
      .map(({ id, role, notes }) => ({ id, role, notes }))
    : [];
  const score = composePianoScore(input, plan, targetTrack, projectEndTick(project), 'classic');
  return realizePianoPlanWithAudit({
    plan,
    score,
    targetTrack,
    projectEndTick: projectEndTick(project),
    externalTracks,
    tempoMap: project.tempoMap,
    timeSignature: project.timeSignature,
  }).notes;
}

function realizeLegacy(input: PianoEngineInput, project: Project, targetTrack: Track, plan: PianoComposerPlan): readonly Note[] {
  const template = resolveTemplate(project.ensemble);
  const externalTracks = template
    ? input.analysis.tracks
      .filter((track) => template.roster.some((entry) => entry.role === track.role))
      .map(({ id, role, notes }) => ({ id, role, notes }))
    : [];
  return realizePianoPlan({
    plan,
    targetTrack,
    projectEndTick: projectEndTick(project),
    externalTracks,
    tempoMap: project.tempoMap,
    timeSignature: project.timeSignature,
  });
}

function phraseForBar(plan: PianoComposerPlan, bar: number) {
  const tick = (bar - 1) * BAR_TICKS;
  return plan.phrases.find((phrase) => phrase.startTick <= tick && phrase.endTick > tick);
}

function nonVelocityShape(notes: readonly Note[]) {
  return notes.map(({ velocity: _velocity, ...note }) => note);
}

describe('Piano V5 dynamic alignment', () => {
  it('unwinds falling Outro energy without an artificial arrival peak across all five Piano templates', () => {
    for (const { id, label } of TEMPLATE_CASES) {
      const run = productionCase(id);
      const finalPhrase = run.plan.phrases.at(-1)!;
      expect(finalPhrase.sectionId, label).toBe('sec_outro');
      expect(finalPhrase.function, label).toBe('arrival');
      expect(finalPhrase.dynamics.sourceEnergy.descendingTowardEnd, label).toBe(true);
      expect(finalPhrase.dynamics.shape, label).toBe('unwind');
      expect(finalPhrase.dynamics.peak, `${label} does not get the forced arrival floor`).toBeLessThan(3);

      const outputPiano = pianoTrack(run.result.tracks);
      const outputBar37 = meanVelocity(notesInBar(outputPiano.notes, 37));
      const outputBar40 = meanVelocity(notesInBar(outputPiano.notes, 40));
      expect(Number.isFinite(outputBar37), `${label} has notes at bar 37`).toBe(true);
      expect(Number.isFinite(outputBar40), `${label} has notes at bar 40`).toBe(true);
      expect(outputBar37 - outputBar40, `${label} follows the quiet ending`).toBeGreaterThanOrEqual(5);

      const fallingInput = withOutroEnergy(run.input, [0.72, 0.50, 0.29, 0.10]);
      const fallingPlan = planFor(fallingInput);
      const fallingPhrase = fallingPlan.phrases.at(-1)!;
      expect(fallingPhrase.dynamics.shape, `${label} synthetic descending ending`).toBe('unwind');
      expect(fallingPhrase.dynamics.sourceEnergy.descendingTowardEnd).toBe(true);
      expect(fallingPhrase.dynamics.intensityCurve.at(-1)!.intensity)
        .toBeLessThan(fallingPhrase.dynamics.intensityCurve[0].intensity);
      const fallingNotes = realize(fallingInput, run.project, run.pianoTarget, fallingPlan);
      const fallingMeans = [37, 38, 39, 40].map((bar) => meanVelocity(notesInBar(fallingNotes, bar)));
      expect(fallingMeans.every(Number.isFinite), `${label} has notes across the final phrase`).toBe(true);
      expect(fallingMeans[0] - fallingMeans[3], `${label} has a meaningful velocity descent`).toBeGreaterThanOrEqual(15);

      const peakThenDropPlan = planFor(withOutroEnergy(run.input, [0.34, 0.38, 0.42, 0.25]));
      const peakThenDrop = peakThenDropPlan.phrases.at(-1)!;
      const bar39 = peakThenDrop.dynamics.sourceEnergy.trajectory.find((point) => point.bar === 39)!;
      const bar40 = peakThenDrop.dynamics.sourceEnergy.trajectory.find((point) => point.bar === 40)!;
      expect(peakThenDrop.dynamics.shape, `${label} final peak followed by a drop`).toBe('unwind');
      expect(peakThenDrop.dynamics.peakPosition).toBeCloseTo(bar39.position, 8);
      expect(peakThenDrop.dynamics.intensityCurve.find((point) => point.sourceBar === 39)!.intensity)
        .toBeGreaterThan(peakThenDrop.dynamics.intensityCurve.find((point) => point.sourceBar === 40)!.intensity);
      expect(bar39.target).toBeGreaterThan(bar40.target);
    }
  });

  it('retains a genuine build into a strong final arrival across all five templates', () => {
    for (const { id, label } of TEMPLATE_CASES) {
      const run = productionCase(id);
      const risingInput = withOutroEnergy(run.input, [0.12, 0.32, 0.60, 0.92]);
      const risingPlan = planFor(risingInput);
      const finalPhrase = risingPlan.phrases.at(-1)!;
      expect(finalPhrase.dynamics.sourceEnergy.descendingTowardEnd, label).toBe(false);
      expect(finalPhrase.dynamics.shape, label).toBe('held-arrival');
      expect(finalPhrase.dynamics.peak, label).toBeGreaterThanOrEqual(3);
      const risingNotes = realize(risingInput, run.project, run.pianoTarget, risingPlan);
      const firstMean = meanVelocity(notesInBar(risingNotes, 37));
      const finalMean = meanVelocity(notesInBar(risingNotes, 40));
      expect(finalMean - firstMean, `${label} preserves its final statement`).toBeGreaterThanOrEqual(15);
    }
  });

  it('places the Cinematic and Hybrid Studio interior climax at bar 35, then unwinds at bar 36', () => {
    const cases = [
      { id: 'ensemble.cinematic', sectionId: 'sec_chorus3', phraseStartBar: 30 },
      { id: 'ensemble.hybridstudio', sectionId: 'sec_chorus3', phraseStartBar: 32 },
    ] as const;
    for (const { id, sectionId, phraseStartBar } of cases) {
      const run = productionCase(id);
      const phrase = phraseForBar(run.plan, 35);
      expect(phrase, id).toBeDefined();
      expect(phrase!.sectionId).toBe(sectionId);
      expect(phrase!.startTick).toBe((phraseStartBar - 1) * BAR_TICKS);
      // The dynamic turn is segmented internally; the established writing-phrase
      // boundaries (and therefore note/texture decisions) are not split.
      expect(phrase!.endTick).toBe(36 * BAR_TICKS);
      const peakSample = phrase!.dynamics.sourceEnergy.trajectory.find((point) => point.bar === 35)!;
      const dropSample = phrase!.dynamics.sourceEnergy.trajectory.find((point) => point.bar === 36)!;
      expect(peakSample.target).toBeGreaterThan(dropSample.target);
      expect(phrase!.dynamics.sourceEnergy.peakPosition).toBeCloseTo(peakSample.position, 8);
      expect(phrase!.dynamics.peakPosition).toBeCloseTo(peakSample.position, 8);
      expect(phrase!.dynamics.shape).toBe('arch');

      const plannedPeak = phrase!.dynamics.intensityCurve.find((point) => point.sourceBar === 35)!;
      const plannedDrop = phrase!.dynamics.intensityCurve.find((point) => point.sourceBar === 36)!;
      expect(plannedPeak.intensity).toBeGreaterThan(plannedDrop.intensity);
      expect(plannedPeak.sourceTarget).toBe(peakSample.target);
      expect(phrase!.dynamics.segments).toHaveLength(2);
      expect(phrase!.dynamics.segments[0]).toMatchObject({ shape: 'rising-arc', turningPoint: null });
      expect(phrase!.dynamics.segments[0].peakPosition).toBeCloseTo(peakSample.position, 8);
      expect(phrase!.dynamics.segments[1]).toMatchObject({ shape: 'unwind', turningPoint: 'peak' });
      expect(phrase!.dynamics.segments[1].startPosition).toBeCloseTo(dropSample.position, 8);

      const outputPiano = pianoTrack(run.result.tracks);
      const bar35Mean = meanVelocity(notesInBar(outputPiano.notes, 35));
      const bar36Mean = meanVelocity(notesInBar(outputPiano.notes, 36));
      expect(bar35Mean, `${id} bar 35 peak`).toBeGreaterThan(bar36Mean + 12);
      const chorusPhrases = run.plan.phrases.filter((candidate) => candidate.sectionId === sectionId);
      expect(chorusPhrases.map((candidate) => candidate.startTick / BAR_TICKS + 1), id)
        .toEqual(id === 'ensemble.cinematic' ? [29, 30] : [29, 32]);
    }
  });

  it('keeps the descending ending across different take-derived seeds', () => {
    for (const { id, label } of TEMPLATE_CASES) {
      for (const priorTake of [0, 4, 6]) {
        const run = productionCase(id, priorTake);
        const finalPhrase = run.plan.phrases.at(-1)!;
        expect(finalPhrase.dynamics.sourceEnergy.descendingTowardEnd, `${label} take ${priorTake + 1}`).toBe(true);
        expect(finalPhrase.dynamics.shape, `${label} take ${priorTake + 1}`).toBe('unwind');
        const outputPiano = pianoTrack(run.result.tracks);
        expect(meanVelocity(notesInBar(outputPiano.notes, 37)), `${label} take ${priorTake + 1} start`)
          .toBeGreaterThan(meanVelocity(notesInBar(outputPiano.notes, 40)));
      }
    }
  });

  it('does not split for minor fluctuations, and remains deterministic for identical inputs and seeds', () => {
    const run = productionCase('ensemble.cinematic');
    const originalChorusPhrases = run.plan.phrases.filter((phrase) => phrase.sectionId === 'sec_chorus3');
    const minorInput = withChorusThreeEnergy(run.input, [0.80, 0.817, 0.806, 0.824, 0.811, 0.829, 0.815, 0.802]);
    const minorPlan = planFor(minorInput);
    const minorPhrase = phraseForBar(minorPlan, 35)!;
    const minorChorusPhrases = minorPlan.phrases.filter((phrase) => phrase.sectionId === 'sec_chorus3');
    expect(minorChorusPhrases).toHaveLength(originalChorusPhrases.length);
    expect(minorPhrase.dynamics.segments).toHaveLength(1);

    const firstPlan = planFor(run.input);
    const repeatedPlan = planFor(run.input);
    expect(JSON.stringify(repeatedPlan)).toBe(JSON.stringify(firstPlan));
    const firstNotes = realize(run.input, run.project, run.pianoTarget, firstPlan);
    const repeatedNotes = realize(run.input, run.project, run.pianoTarget, repeatedPlan);
    expect(repeatedNotes).toEqual(firstNotes);
  });

  it('limits the new Realizer effect to velocity; pitches, timing, articulation, and phrase texture stay fixed', () => {
    const run = productionCase('ensemble.hybridstudio');
    const alteredPlan: PianoComposerPlan = {
      ...run.plan,
      phrases: run.plan.phrases.map((phrase) => ({
        ...phrase,
        dynamics: {
          ...phrase.dynamics,
          intensityCurve: phrase.dynamics.intensityCurve.map((point) => ({
            ...point,
            intensity: Math.min(5, point.intensity + 0.5),
          })),
        },
      })),
    };
    const originalNotes = realizeLegacy(run.input, run.project, run.pianoTarget, run.plan);
    const alteredNotes = realizeLegacy(run.input, run.project, run.pianoTarget, alteredPlan);
    expect(nonVelocityShape(alteredNotes)).toEqual(nonVelocityShape(originalNotes));
    expect(alteredNotes.map((note) => note.velocity)).not.toEqual(originalNotes.map((note) => note.velocity));
    expect(alteredPlan.phrases.map((phrase) => phrase.rhythmicPlan))
      .toEqual(run.plan.phrases.map((phrase) => phrase.rhythmicPlan));
  });
});
