/**
 * The adapter must actually FEED Piano V5 — not merely type-check.
 *
 * The equivalence gate (§7.7A) proves the adapter does not change V5's
 * behaviour on equivalent inputs. This suite proves the other half: that the
 * new engine's plan produces a real, V5-consumable context whose four fields
 * carry genuine musical meaning — honest participants, real track ids, real
 * phrase-derived fill windows.
 */
import { describe, expect, it } from 'vitest';
import dorian from '../../fixtures/dorian-16bars.json';
import threeChorus from '../../fixtures/three-chorus-40bars.json';
import { projectFromFixture, isInstrumentTrack, type Project } from '../../src/shared/schema';
import { composeOrchestra } from '../../src/compose';
import { buildPianoEngineInput } from '../../src/orchestrator/keys/piano-engine';
import { resolveTemplate } from '../../src/config/ensembles';
import { analyzePianoInput } from '../../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan } from '../../src/orchestrator/keys/piano-composer';
import { projectEndTick } from '../../src/shared/schema/meter';

const CASES = [
  { name: 'dorian', json: dorian },
  { name: 'three-chorus', json: threeChorus },
] as const;

function feedV5(json: unknown) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(json)) as Project);
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeOrchestra(project, { seed: 1, take: 1 });
  const composed: Project = { ...project, tracks: result.tracks };
  const template = resolveTemplate(composed.ensemble);
  const input = buildPianoEngineInput({
    project: composed,
    ensemble: composed.ensemble!,
    template,
    sections: result.score.sections.map((section, index) => ({
      id: section.id,
      name: section.name,
      index,
      occurrence: section.occurrence,
      startBar: section.startBar,
      lengthBars: section.lengthBars,
      startTick: section.startTick,
      endTick: section.endTick,
    })),
    harmony: result.score.harmony.map((span) => ({
      id: span.id,
      symbol: span.symbol,
      startTick: span.startTick,
      endTick: span.endTick,
      parsed: {
        symbol: span.symbol, root: span.root, rootName: '', quality: '',
        extensions: [], bass: null, bassName: null,
        intervals: span.intervals, pitchClasses: span.pitchClasses,
      },
    })),
    energy: result.score.bars.map((bar) => ({
      bar: bar.bar, startTick: bar.startTick, endTick: bar.endTick,
      sectionId: bar.sectionId, target: bar.energy, nearSilence: bar.energy < 0.12,
    })),
    conductor: result.pianoPlan,
    seed: 12345,
    userSeed: 1,
    take: 1,
    density: 1,
    finalizedTracks: result.tracks,
  });
  const report = analyzePianoInput(input);
  const plan = composePianoPlan(input, report);
  return { project: composed, result, input, plan };
}

describe.each(CASES)('Piano V5 adapter integration — $name', (testCase) => {
  it('produces a context V5 can consume end to end', () => {
    const { input, plan } = feedV5(testCase.json);
    expect(input.context.barWindows.length).toBeGreaterThan(0);
    // V5's composer actually runs and plans harmonic events.
    expect(plan.harmonicEvents.length).toBeGreaterThan(0);
  });

  it('barWindows are contained in their own sections (or V5 orphans bars)', () => {
    const { input } = feedV5(testCase.json);
    for (const bar of input.context.barWindows) {
      const section = input.context.sections.find((entry) => entry.id === bar.sectionId);
      expect(section).toBeDefined();
      if (!section) continue;
      expect(bar.startTick).toBeGreaterThanOrEqual(section.startTick);
      expect(bar.endTick).toBeLessThanOrEqual(section.endTick);
    }
  });

  it('layerInformation names real tracks and real lead ownership', () => {
    const { input, project } = feedV5(testCase.json);
    const realIds = new Set(project.tracks.map((track) => track.id));
    const leadSlots = input.context.layerInformation.perBar
      .flatMap((bar) => bar.layers.filter((slot) => slot.layer === 'lead'))
      .flatMap((slot) => slot.trackIds);
    // The melody is annotated, so V5 knows to leave space for it.
    expect(leadSlots.length).toBeGreaterThan(0);
    for (const id of leadSlots) expect(realIds.has(id)).toBe(true);
    // The honest contract from Decision 4 is preserved verbatim.
    expect(input.context.layerInformation.availability).toBe('partial');
    expect(input.context.layerInformation.totalCapacity).toBeNull();
    expect(input.context.layerInformation.totalOccupiedLayers).toBeNull();
  });

  it('moments carry honest participants that exist in the roster', () => {
    const { input, project } = feedV5(testCase.json);
    const roles = new Set(
      project.tracks.filter((track) => isInstrumentTrack(track)).map((track) => track.role),
    );
    for (const moment of input.context.moments) {
      expect(['tutti', 'soli', 'unison']).toContain(moment.kind);
      expect(moment.participantRoles?.length ?? 0).toBeGreaterThan(0);
      for (const role of moment.participantRoles ?? []) expect(roles.has(role)).toBe(true);
    }
  });

  it('fill windows are real, in range, and target the piano', () => {
    const { input, project } = feedV5(testCase.json);
    const end = projectEndTick(project);
    for (const fill of input.context.fillWindows) {
      expect(fill.target.toLowerCase()).toBe('piano');
      expect(fill.startTick).toBeGreaterThanOrEqual(0);
      expect(fill.endTick).toBeLessThanOrEqual(end);
      expect(fill.endTick).toBeGreaterThan(fill.startTick);
    }
  });

  it('the analysis sees the new engine’s real notes, not placeholder silence', () => {
    const { input, result } = feedV5(testCase.json);
    const analysed = input.analysis.tracks.filter((track) => track.notes.length > 0);
    expect(analysed.length).toBeGreaterThan(0);
    // It matches what the engine actually wrote.
    for (const part of result.score.parts) {
      const observed = input.analysis.tracks.find((track) => track.id === part.trackId);
      if (observed) expect(observed.notes.length).toBe(part.notes.length);
    }
  });
});
