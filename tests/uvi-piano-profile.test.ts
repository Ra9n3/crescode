import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan } from '../src/orchestrator/keys/piano-composer';
import { projectEndTick } from '../src/shared/schema/meter';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { buildMergedMidi, buildPerTrackMidi, parseMidiFile } from '../src/export/midi';
import { profilePartSummary, validateExportProfile } from '../src/export/profile';
import { projectFromFixture } from '../src/shared/schema';
import { isInstrumentTrack, type Project } from '../src/shared/schema/types';

const PROFILE = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
const pianoPart = PROFILE.parts.find((part) => part.id === 'piano')!;

function projectWithPiano(templateId = 'ensemble.chamber'): Project {
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 1 };
  return project;
}

function pianoTrack(project: Project) {
  const track = project.tracks.find((candidate) => isInstrumentTrack(candidate) && candidate.role === 'piano');
  if (!track || !isInstrumentTrack(track)) throw new Error('Fixture does not contain an instrument Piano track');
  return track;
}

function exportedPiano(bytes: Uint8Array) {
  const parsed = parseMidiFile(bytes);
  const track = parsed.tracks.find((candidate) => candidate.name === 'Piano'
    && (candidate.channel !== null || candidate.cc.length > 0));
  if (!track) throw new Error('MIDI file does not contain the Piano part');
  return track;
}

function controllerSummary(project: Project, templateId = 'ensemble.chamber') {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 1 };
  const result = composeAllTracks(project, { seed: 11 });
  const output = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  if (!output || !isInstrumentTrack(output)) throw new Error('Composition did not return the Piano instrument track');
  const plan = composePianoPlan(result.pianoEngineInput, analyzePianoInput(result.pianoEngineInput));
  return {
    result,
    plan,
    piano: output,
  };
}

describe('Piano Engine V5 CC64 and UVI profile', () => {
  it('keeps the patch identity while exporting the part under the exact Piano name', () => {
    expect(validateExportProfile(PROFILE)).toEqual([]);
    expect(pianoPart.patch).toBe('UVI Grand Model D');
    expect(pianoPart.exportName).toBe('Piano');
    expect(pianoPart.channel).toBe(16);
    expect(pianoPart.ccEnabled).toEqual({ '64': true });
    expect(pianoPart.keyswitchMode).toBe('none');
    const summary = profilePartSummary(PROFILE).find((line) => line.startsWith('ch 16 ·')) ?? '';
    expect(summary).toContain('UVI Grand Model D');
    expect(summary).toContain('CC64 sustain pedal automation');
  });

  it('composes a generated Piano pedal lane without a source CC64 lane', () => {
    const project = projectWithPiano();
    const piano = pianoTrack(project);
    piano.cc = [{ cc: 1, points: [{ tick: 0, value: 72 }] }];
    const { piano: composed } = controllerSummary(project);
    const cc64 = composed.cc?.find((lane) => lane.cc === 64);
    expect(cc64).toBeDefined();
    expect(cc64?.points.some((point) => point.value === 127)).toBe(true);
    expect(cc64?.points.some((point) => point.value === 0)).toBe(true);
    expect(cc64?.points.at(-1)?.value).toBe(0);
    expect(composed.cc?.some((lane) => lane.cc === 1)).toBe(false);
  });

  it('keeps authored pedal events, merges them with generated events, and finishes released', () => {
    const baseline = composeAllTracks(projectWithPiano(), { seed: 11 });
    const baselinePiano = baseline.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
    if (!baselinePiano || !isInstrumentTrack(baselinePiano)) throw new Error('Baseline composition has no Piano');
    const generatedLane = baselinePiano.cc?.find((lane) => lane.cc === 64);
    if (!generatedLane) throw new Error('Baseline composition generated no CC64 lane');
    const releasedGap = generatedLane.points.slice(0, -1).find((point, index) =>
      point.value === 0
      && generatedLane.points[index + 1]?.value === 127
      && generatedLane.points[index + 1].tick - point.tick > 1,
    );
    if (!releasedGap) throw new Error('Generated lane has no gap to probe authored CC64 merging');

    const project = projectWithPiano();
    const source = pianoTrack(project);
    const authoredDownTick = releasedGap.tick + 1;
    source.cc = [
      { cc: 64, points: [{ tick: authoredDownTick, value: 127 }] },
      { cc: 1, points: [{ tick: 0, value: 72 }] },
    ];
    const { result, piano: composed } = controllerSummary(project);
    const cc64 = composed.cc?.find((lane) => lane.cc === 64);
    expect(cc64).toBeDefined();
    expect(cc64?.points.some((point) => point.tick === authoredDownTick && point.value === 127)).toBe(true);
    expect(cc64?.points.at(-1)).toEqual({ tick: projectEndTick(project), value: 0 });
    expect(composed.cc?.some((lane) => lane.cc === 1)).toBe(false);

    const nonPianoState = (tracks: typeof result.tracks) => tracks
      .filter(isInstrumentTrack)
      .filter((track) => track.role !== 'piano')
      .map(({ id, notes, cc }) => ({ id, notes, cc }))
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(nonPianoState(result.tracks)).toEqual(nonPianoState(baseline.tracks));
  });

  it('recomposes prior V5 output without accumulating it as source CC64', () => {
    const authoredPoints = [{ tick: 1, value: 127 }, { tick: 2, value: 0 }];
    const firstProject = projectWithPiano();
    pianoTrack(firstProject).cc = [{ cc: 64, points: authoredPoints.map((point) => ({ ...point })) }];
    const first = composeAllTracks(firstProject, { seed: 11 });

    const changedProject = JSON.parse(JSON.stringify({
      ...firstProject,
      key: 0 as Project['key'],
      mode: 'Ionian' as const,
      orchestration: first.orchestration,
      tracks: first.tracks,
    })) as Project;
    const recomposed = composeAllTracks(changedProject, { seed: 11 });

    const freshProject = projectWithPiano();
    freshProject.key = 0;
    freshProject.mode = 'Ionian';
    freshProject.orchestration = first.orchestration;
    pianoTrack(freshProject).cc = [{ cc: 64, points: authoredPoints.map((point) => ({ ...point })) }];
    const fresh = composeAllTracks(freshProject, { seed: 11 });
    const outputPiano = (tracks: typeof fresh.tracks) => tracks
      .find((track) => isInstrumentTrack(track) && track.role === 'piano');
    const recomposedPiano = outputPiano(recomposed.tracks);
    const freshPiano = outputPiano(fresh.tracks);
    expect(recomposedPiano && isInstrumentTrack(recomposedPiano) ? recomposedPiano.cc : undefined)
      .toEqual(freshPiano && isInstrumentTrack(freshPiano) ? freshPiano.cc : undefined);
    expect(recomposedPiano && isInstrumentTrack(recomposedPiano)
      ? recomposedPiano.cc?.find((lane) => lane.cc === 64)?.pianoV2Pedal?.authoredPoints
      : undefined).toEqual(authoredPoints);
  });

  it('exports generated CC64 on the correct Piano channel in both MIDI forms', () => {
    const project = projectWithPiano();
    const { piano } = controllerSummary(project);
    const perTrack = buildPerTrackMidi(project, [piano], PROFILE).find((file) => file.fileName === 'Piano.mid');
    expect(perTrack).toBeDefined();
    const perTrackPiano = exportedPiano(perTrack!.data);
    expect(perTrackPiano.channel).toBe(16);
    expect(perTrackPiano.cc.length).toBeGreaterThan(0);
    expect(perTrackPiano.cc.every((event) => event.cc === 64)).toBe(true);
    expect(perTrackPiano.cc.at(-1)?.value).toBe(0);
    const expectedPedal = piano.cc?.find((lane) => lane.cc === 64)?.points
      .map(({ tick, value }) => ({ cc: 64, tick, value }));
    expect(perTrackPiano.cc).toEqual(expectedPedal);

    const mergedPiano = exportedPiano(buildMergedMidi(project, [piano], PROFILE));
    expect(mergedPiano.channel).toBe(16);
    expect(mergedPiano.cc).toEqual(perTrackPiano.cc);
  });

  it('writes no Piano notes or pedal events for Symphony and does not change non-Piano controllers', () => {
    const project = projectWithPiano('ensemble.symphony');
    const source = pianoTrack(project);
    source.cc = [{ cc: 1, points: [{ tick: 0, value: 72 }] }];
    const result = composeAllTracks(project, { seed: 11 });
    const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
    expect(piano && isInstrumentTrack(piano) ? piano.notes : []).toEqual([]);
    expect(piano && isInstrumentTrack(piano) ? piano.cc?.some((lane) => lane.cc === 64) : false).toBe(false);
    expect(piano && isInstrumentTrack(piano) ? piano.cc : undefined).toEqual(source.cc);

    const baseline = composeAllTracks(projectWithPiano('ensemble.symphony'), { seed: 11 });
    const nonPianoState = (tracks: typeof result.tracks) => tracks
      .filter((track) => isInstrumentTrack(track) && track.role !== 'piano')
      .map((track) => isInstrumentTrack(track)
        ? { id: track.id, notes: track.notes, cc: track.cc }
        : null)
      .sort((a, b) => (a?.id ?? '').localeCompare(b?.id ?? ''));
    expect(nonPianoState(result.tracks)).toEqual(nonPianoState(baseline.tracks));
  });

  it('is deterministic and varies pedal articulation with Piano templates', () => {
    const templates = [
      'ensemble.chamber',
      'ensemble.sonata',
      'ensemble.vocalbacking',
      'ensemble.cinematic',
      'ensemble.hybridstudio',
    ];
    const summaries = templates.map((templateId) => {
      const first = controllerSummary(projectWithPiano(templateId), templateId);
      const second = controllerSummary(projectWithPiano(templateId), templateId);
      expect(second.piano.cc).toEqual(first.piano.cc);
      expect(first.piano.notes.length).toBeGreaterThan(0);
      const lane = first.piano.cc?.find((candidate) => candidate.cc === 64);
      expect(lane, `${templateId} generated a Piano pedal`).toBeDefined();
      expect(lane?.points.at(-1)?.value).toBe(0);
      return lane?.points.map((point) => [point.tick, point.value]);
    });
    expect(new Set(summaries.map((summary) => JSON.stringify(summary))).size).toBeGreaterThan(1);
  });

  it('anchors generated down events to Piano attacks and lifts at phrase boundaries', () => {
    const project = projectWithPiano();
    const result = controllerSummary(project);
    const plan = result.plan;
    expect(plan.status).toBe('composed');
    // The fixture includes sustained accompaniment, discrete attacks, and
    // phrase gaps; generated events remain bounded to realized activity.
    const lane = result.piano.cc?.find((candidate) => candidate.cc === 64);
    expect(lane).toBeDefined();
    for (const point of lane?.points ?? []) {
      if (point.value === 127) {
        expect(result.piano.notes.some((note) => note.startTick === point.tick)).toBe(true);
      }
    }
    const phrases = plan.phrases;
    for (const phrase of phrases.slice(0, -1)) {
      if (phrase.endTick < projectEndTick(project)) {
        expect(lane?.points.some((point) => point.tick <= phrase.endTick && point.value === 0)).toBe(true);
      }
    }
  });
});
