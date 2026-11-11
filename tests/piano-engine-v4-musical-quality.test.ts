import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScore } from '../src/orchestrator/keys/piano-composer';
import { realizePianoPlanWithAudit } from '../src/orchestrator/keys/piano-realizer';
import { isInstrumentTrack, projectFromFixture, type Project } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';

const PPQ = 960;
const TEMPLATE_IDS = [
  'ensemble.chamber',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.cinematic',
  'ensemble.hybridstudio',
] as const;
type TemplateId = (typeof TEMPLATE_IDS)[number];

function productionSample(templateId: TemplateId) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed: 11 });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} production composition returned no Piano track.`);
  const input = result.pianoEngineInput;
  const plan = composePianoPlan(input, analyzePianoInput(input));
  const score = composePianoScore(input, plan, piano, projectEndTick(project));
  const realization = realizePianoPlanWithAudit({
    plan,
    score,
    targetTrack: piano,
    projectEndTick: projectEndTick(project),
  });
  return { project, result, piano, input, plan, score, realization };
}

function independentSample(templateId: TemplateId) {
  const sample = productionSample(templateId);
  const input = {
    ...sample.input,
    context: {
      ...sample.input.context,
      leadWindows: [],
      moments: [],
      fillWindows: [],
      layerInformation: {
        ...sample.input.context.layerInformation,
        perBar: sample.input.context.layerInformation.perBar.map((bar) => ({ ...bar, layers: [] })),
      },
    },
    analysis: { tracks: [] },
  };
  const plan = composePianoPlan(input, analyzePianoInput(input));
  const score = composePianoScore(input, plan, sample.piano, projectEndTick(sample.project));
  const realization = realizePianoPlanWithAudit({
    plan,
    score,
    targetTrack: sample.piano,
    projectEndTick: projectEndTick(sample.project),
  });
  return { ...sample, input, plan, score, realization };
}

describe('Piano Engine V4 musical-quality writing', () => {
  it('keeps the production Composer → Realizer path deterministic and metrically grounded for all five Piano templates', () => {
    for (const templateId of TEMPLATE_IDS) {
      const sample = productionSample(templateId);
      const repeatedPlan = composePianoPlan(sample.input, analyzePianoInput(sample.input));
      const repeatedScore = composePianoScore(
        sample.input, repeatedPlan, sample.piano, projectEndTick(sample.project),
      );
      const repeatedRealization = realizePianoPlanWithAudit({
        plan: repeatedPlan,
        score: repeatedScore,
        targetTrack: sample.piano,
        projectEndTick: projectEndTick(sample.project),
      });
      expect(JSON.stringify(repeatedPlan), `${templateId} plan determinism`).toBe(JSON.stringify(sample.plan));
      expect(repeatedRealization.notes, `${templateId} note determinism`).toEqual(sample.realization.notes);
      expect(sample.plan.status).toBe('composed');
      expect(sample.plan.template.eligible).toBe(true);
      expect(sample.realization.notes.length, `${templateId} realized Piano notes`).toBeGreaterThan(0);
      expect(sample.realization.octavePolicy.remainingHardPairs).toBe(0);
      expect(sample.realization.notes.every((note) => note.durationTicks > 0
        && note.startTick >= 0
        && note.startTick + note.durationTicks <= projectEndTick(sample.project))).toBe(true);

      const nonPiano = sample.result.tracks
        .filter((track) => isInstrumentTrack(track) && track.role !== 'piano');
      expect(sample.input.analysis.tracks.map(({ id, notes }) => ({ id, notes })))
        .toEqual(nonPiano.map(({ id, notes }) => ({ id, notes })));
      expect(sample.plan.phrases.every((phrase) => (phrase.rhythmicPlan.gridTicks ?? 0) > 0
        && (phrase.rhythmicPlan.cellTicks ?? 0) > 0
        && Array.isArray(phrase.rhythmicPlan.motifCells))).toBe(true);

      const grid = sample.plan.phrases[0]?.rhythmicPlan.gridTicks ?? PPQ / 2;
      expect(sample.realization.notes.every((note) => note.startTick % grid === 0),
        `${templateId} MIDI onsets should fall on the planned grid`).toBe(true);
    }
  });

  it('develops a two-bar subject across Chamber and Sonata phrases and keeps their bass lines economical', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.sonata'] as const) {
      const sample = independentSample(templateId);
      const phrase = sample.plan.phrases.find((candidate) => candidate.sectionId === 'sec_verse1'
        && (candidate.rhythmicPlan.motifCells?.length ?? 0) >= 2);
      if (!phrase) throw new Error(`${templateId} did not plan a multi-cell opening phrase.`);
      const cells = phrase.rhythmicPlan.motifCells ?? [];
      expect(phrase.rhythmicPlan.cellTicks).toBe(8 * PPQ);
      expect(cells[0].variation).toBe('statement');
      expect(cells.some((cell) => cell.variation === 'sequence')).toBe(true);
      expect(cells.every((cell) => cell.startOffsetTicks % (phrase.rhythmicPlan.cellTicks ?? 1) === 0
        && cell.startOffsetTicks < phrase.endTick - phrase.startTick
        && cell.positions.every((position) => position >= 0 && position <= 3))).toBe(true);

      const plannedCellStarts = cells
        .filter((cell) => cell.positions.includes(0))
        .map((cell) => phrase.startTick + cell.startOffsetTicks);
      const realizedMelodicAttacks = sample.realization.notes.filter((note) =>
        note.pitch >= 60 && note.pitch <= 100
        && note.startTick >= phrase.startTick && note.startTick < phrase.endTick)
        .map((note) => note.startTick);
      expect(plannedCellStarts.some((tick) => realizedMelodicAttacks.includes(tick)),
        `${templateId} motif schedule should reach MIDI attacks`).toBe(true);

      const bass = sample.realization.notes.filter((note) => note.roleTag === 'anchor'
        && note.startTick >= phrase.startTick && note.startTick < phrase.endTick)
        .sort((a, b) => a.startTick - b.startTick);
      expect(bass.length).toBeGreaterThan(0);
      const leaps = bass.slice(1).map((note, index) => Math.abs(note.pitch - bass[index].pitch));
      const meanLeap = leaps.length ? leaps.reduce((sum, leap) => sum + leap, 0) / leaps.length : 0;
      expect(meanLeap, `${templateId} average bass motion`).toBeLessThanOrEqual(8);
    }
  });

  it('keeps two-hand separation intentional in the realized opening material', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.sonata'] as const) {
      const sample = productionSample(templateId);
      const anchors = sample.realization.notes.filter((note) => note.roleTag === 'anchor');
      const upper = sample.realization.notes.filter((note) => note.pitch >= 60);
      for (const bass of anchors) {
        for (const treble of upper) {
          const overlaps = bass.startTick < treble.startTick + treble.durationTicks
            && treble.startTick < bass.startTick + bass.durationTicks;
          if (!overlaps || bass.pitch >= treble.pitch) continue;
          expect(treble.pitch - bass.pitch, `${templateId} hands should not crowd at a semitone`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
