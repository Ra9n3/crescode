import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashString } from '../src/engine/generate';
import dorian from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan } from '../src/orchestrator/keys/piano-composer';
import { chordSpans, energyCurve, orchestrationSeedFor, sectionMap } from '../src/orchestrator/spine';
import { isInBand } from '../src/shared/schema/band';
import { isInstrumentTrack, type Project } from '../src/shared/schema/types';
import { projectFromFixture, validateProject } from '../src/shared/schema';
import type { PianoTemplateRule } from '../src/orchestrator/keys/piano-engine';

const NON_PIANO_TRACK_HASHES: Record<string, string> = {
  'ensemble.chamber': '6dc72ee17dc456a809ec1157d065a3372053a70b3b4e2f471968675d091b20a7',
  'ensemble.vocalbacking': 'd64f5544e431ad4c60de625d1c8783e8bf885738aec4c65d854d19a7dba8df5b',
  'ensemble.sonata': 'b8e1f15db34d2571e9bf097c446e70362b889d1ac24476995525ab6562279999',
  'ensemble.cinematic': 'f41405ddec62c242fc51c8c8d1349a88839122a12c9679cd1e22833031d5f35e',
  'ensemble.hybridstudio': 'b02e1a02a65f8df95d718470bc255eb0368dc4cfaea4ba21e93d55de94db68e7',
  'ensemble.symphony': 'd6f6f90f76150b56b440ea1ecca1c7c7282ad644dd32dc046ed7c8b0bfaee7b9',
};

const CASES = [
  { id: 'ensemble.chamber', take: 1, fixture: threeChorus },
  { id: 'ensemble.vocalbacking', take: 3, fixture: threeChorus },
  { id: 'ensemble.sonata', take: 2, fixture: dorian },
  { id: 'ensemble.cinematic', take: 4, fixture: threeChorus },
  { id: 'ensemble.hybridstudio', take: 5, fixture: threeChorus },
  { id: 'ensemble.symphony', take: 6, fixture: threeChorus },
] as const;

function makeProject(templateId: string, take: number, fixture: unknown = threeChorus): Project {
  const project = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: take - 1 };
  return project;
}

function composeCase(templateId: string, take: number, fixture: unknown = threeChorus) {
  const project = makeProject(templateId, take, fixture);
  const result = composeAllTracks(project, { seed: 11 });
  return { project, result, input: result.pianoEngineInput, context: result.pianoEngineInput.context };
}

function trackHash(tracks: unknown): string {
  return createHash('sha256').update(JSON.stringify(tracks)).digest('hex');
}

const expectedRules: Record<string, readonly PianoTemplateRule[]> = {
  'ensemble.chamber': [
    { type: 'octaveDoubling', policy: 'climaxOnly', energyThreshold: 0.55, severity: 'soft', source: 'template.rules' },
    { type: 'fillGating', fills: 'piano', duringRestsOf: 'Strings', minGapTicks: 480, severity: 'hard', source: 'template.rules' },
  ],
  'ensemble.cinematic': [
    { type: 'octaveDoubling', policy: 'allowed', severity: 'none', source: 'template.rules' },
  ],
  'ensemble.hybridstudio': [
    { type: 'octaveDoubling', policy: 'allowed', severity: 'none', source: 'template.rules' },
  ],
  'ensemble.sonata': [
    { type: 'octaveDoubling', policy: 'forbidden', severity: 'hard', source: 'template.rules' },
    { type: 'fillGating', fills: 'piano', duringRestsOf: 'violins1', minGapTicks: 480, severity: 'hard', source: 'template.rules' },
  ],
  'ensemble.symphony': [],
  'ensemble.vocalbacking': [
    { type: 'octaveDoubling', policy: 'forbidden', severity: 'hard', source: 'template.rules' },
  ],
};

const pianoEligibility: Record<string, boolean> = {
  'ensemble.chamber': true,
  'ensemble.cinematic': true,
  'ensemble.hybridstudio': true,
  'ensemble.sonata': true,
  'ensemble.symphony': false,
  'ensemble.vocalbacking': true,
};

describe('Piano Engine Phase 4A ephemeral context contract', () => {
  it('exposes the resolved template gate and only applicable rules with checker severities for all six templates', () => {
    for (const entry of CASES) {
      const { project, result, context } = composeCase(entry.id, entry.take, entry.fixture);
      expect(context.template.id, entry.id).toBe(resolveTemplate(project.ensemble)?.id ?? null);
      expect(context.template.pianoEligible, entry.id).toBe(pianoEligibility[entry.id]);
      expect(context.rules, entry.id).toEqual(expectedRules[entry.id]);
      expect(result.pianoEngineInput.context).toBe(context);
    }
  });

  it('keeps Symphony ineligible when a pinned piano passes the generic band selector', () => {
    const project = makeProject('ensemble.symphony', 1);
    project.ensemble!.pins.piano = 'in';
    const result = composeAllTracks(project, { seed: 11 });

    expect(isInBand('piano', project.ensemble!, resolveTemplate(project.ensemble))).toBe(true);
    expect(result.pianoEngineInput.context.template).toEqual({ id: 'ensemble.symphony', pianoEligible: false });
    expect(result.pianoEngineInput.context.rules).toEqual([]);
    // A pin may admit Piano to the generic renderer, but cannot make
    // Symphony Piano-eligible or leave V1 notes on the output track.
    expect(result.tracks.find((track) => track.role === 'piano')?.notes).toEqual([]);
    expect(trackHash(result.tracks.filter((track) => track.role !== 'piano')))
      .toBe('19d1fc787ff044f0eebd84a22284a043ad160bd848f255f11f181c2f3f45732f');
  });

  it('passes section, harmony, energy, conductor moments/fills/layers, and the existing orchestration seed through unchanged', () => {
    const { project, result, context } = composeCase('ensemble.chamber', 1);
    const template = resolveTemplate(project.ensemble)!;
    const expectedSections = sectionMap(project);
    const expectedHarmony = chordSpans(project);
    const expectedEnergy = energyCurve(project, expectedSections, result.orchestration.take, template, true)
      .map(({ bar, target, nearSilence }) => ({ bar, target, nearSilence }));
    const relevantMoments = result.plan.moments
      .filter((moment) => moment.kind === 'tutti' || moment.kind === 'soli' || moment.kind === 'unison')
      .map((moment) => ({
        kind: moment.kind,
        startBar: moment.startBar,
        endBar: moment.endBar,
        startTick: moment.startTick,
        endTick: moment.endTick,
        ...(moment.participantRoles ? { participantRoles: moment.participantRoles } : {}),
        ...(moment.shape ? { shape: moment.shape } : {}),
      }));
    const pianoFills = result.plan.fills
      .filter((fill) => fill.target === 'piano' || fill.target.toLowerCase() === 'keys')
      .map(({ target, startTick, endTick }) => ({ target, startTick, endTick }));
    const stringLayerAnnotations = result.plan.bars.map((bar) => ({
      bar: bar.bar,
      layers: bar.layers.map(({ layer, trackIds, source }) => ({ layer, trackIds, source })),
    }));

    expect(context.sections).toEqual(expectedSections);
    expect(context.barWindows).toEqual(result.plan.bars.map(({ bar, startTick, endTick, sectionId, sectionName }) => ({
      bar, startTick, endTick, sectionId, sectionName,
    })));
    expect(context.harmony).toEqual(expectedHarmony);
    expect(context.energy).toEqual(expectedEnergy);
    expect(context.energy.map((bar) => bar.target)).toEqual(result.plan.bars.map((bar) => bar.energyTarget));
    expect(context.moments).toEqual(relevantMoments);
    expect(context.fillWindows).toEqual(pianoFills);
    expect(context.layerInformation.perBar).toEqual(stringLayerAnnotations);
    const orchestrationSeed = orchestrationSeedFor(project, result.orchestration);
    const identityKey = [
      'piano-engine-v5',
      `orchestrationSeed=${orchestrationSeed}`,
      'userSeed=11',
      `take=${result.orchestration.take}`,
      'density=1.000',
    ].join('|');
    expect(context.generationIdentity).toEqual({
      algorithm: 'piano-engine-v5',
      key: identityKey,
      orchestrationSeed,
      userSeed: 11,
      take: result.orchestration.take,
      density: 1,
      seed: hashString(identityKey),
    });
    expect(context.seed).toBe(context.generationIdentity.seed);
    expect(context.provenance).toEqual({
      resolvedTemplate: 'src/config/ensembles.ts: resolveTemplate(project.ensemble)',
      pianoEligibility: 'template roster plus unlocked in-band piano track',
      applicableRules: 'EnsembleTemplate.rules + src/orchestrator/energy/rules.ts severity contracts',
      sections: 'src/orchestrator/spine/index.ts: sectionMap(project)',
      barWindows: 'src/orchestrator/conductor/index.ts: ConductorPlan.bars[].startTick/endTick',
      harmony: 'src/orchestrator/spine/index.ts: chordSpans(project)',
      energy: 'src/orchestrator/spine/energyArc.ts: ArcBar.target and ArcBar.nearSilence',
      layerInformation: 'src/orchestrator/conductor/index.ts: ConductorPlan.bars[].layers (strings-only, partial)',
      moments: 'src/orchestrator/conductor/index.ts: ConductorPlan.moments (keys-relevant kinds)',
      fillWindows: 'src/orchestrator/conductor/index.ts: ConductorPlan.fills (piano/Keys targets)',
      generationIdentity: 'piano-engine-v5: orchestration seed + ComposeOptions seed/take/density, hashed with hashString',
      seed: 'PianoGenerationIdentity.seed: deterministic Composer decisions',
      analysis: 'composeAllTracks finalized tracks, excluding piano; production mute/solo/lock/band state is snapshotted',
    });
  });

  it('reuses the deterministic V5 identity and produces the same input for identical inputs/takes', () => {
    const first = composeCase('ensemble.cinematic', 4);
    const second = composeCase('ensemble.cinematic', 4);

    expect(first.context.generationIdentity.orchestrationSeed)
      .toBe(orchestrationSeedFor(first.project, first.result.orchestration));
    expect(first.context.seed).toBe(first.context.generationIdentity.seed);
    expect(second.context.generationIdentity).toEqual(first.context.generationIdentity);
    expect(second.context.seed).toBe(first.context.seed);
    expect(JSON.stringify(first.input)).toBe(JSON.stringify(second.input));
  });

  it('snapshots mute, solo, lock, and band visibility without hiding preserved locked notes', () => {
    const project = makeProject('ensemble.cinematic', 4);
    const template = resolveTemplate(project.ensemble);
    const nonPiano = project.tracks.filter((track) => isInstrumentTrack(track) && track.role !== 'piano');
    const inBand = nonPiano.filter((track) => isInBand(track.role, project.ensemble!, template));
    const outOfBand = nonPiano.filter((track) => !isInBand(track.role, project.ensemble!, template));
    if (inBand.length < 3 || outOfBand.length < 2) {
      throw new Error('The fixture needs three in-band and two out-of-band non-Piano tracks.');
    }
    const [audibleTrack, mutedTrack, lockedInBandTrack] = inBand;
    const [unlockedOutOfBandTrack, lockedOutOfBandTrack] = outOfBand;
    mutedTrack.muted = true;
    lockedInBandTrack.locked = true;
    lockedOutOfBandTrack.locked = true;

    const result = composeAllTracks(project, { seed: 11 });
    const stateFor = (trackId: string) => result.pianoEngineInput.analysis.tracks
      .find((track) => track.id === trackId)?.compositionState;
    expect(stateFor(audibleTrack.id)).toMatchObject({
      locked: false, muted: false, soloed: false, inBand: true, mixerAudible: true, composerVisible: true,
    });
    expect(stateFor(mutedTrack.id)).toMatchObject({ muted: true, mixerAudible: false, composerVisible: false });
    expect(stateFor(lockedInBandTrack.id)).toMatchObject({ locked: true, inBand: true, composerVisible: true });
    expect(stateFor(unlockedOutOfBandTrack.id)).toMatchObject({
      locked: false, inBand: false, mixerAudible: true, composerVisible: false,
    });
    expect(stateFor(lockedOutOfBandTrack.id)).toMatchObject({
      locked: true, inBand: false, mixerAudible: true, composerVisible: true,
    });

    const soloProject = makeProject('ensemble.cinematic', 4);
    const soloTracks = soloProject.tracks.filter((track) => isInstrumentTrack(track) && track.role !== 'piano'
      && isInBand(track.role, soloProject.ensemble!, template));
    const soloTrack = soloTracks[0];
    const excludedTrack = soloTracks.find((track) => track.id !== soloTrack.id);
    if (!soloTrack || !excludedTrack) throw new Error('The fixture needs two in-band tracks for the solo gate.');
    soloTrack.soloed = true;
    const soloResult = composeAllTracks(soloProject, { seed: 11 });
    const soloState = soloResult.pianoEngineInput.analysis.tracks.find((track) => track.id === soloTrack.id)?.compositionState;
    const excludedState = soloResult.pianoEngineInput.analysis.tracks.find((track) => track.id === excludedTrack.id)?.compositionState;
    expect(soloState).toMatchObject({ soloed: true, mixerAudible: true, composerVisible: true });
    expect(excludedState).toMatchObject({ soloed: false, mixerAudible: false, composerVisible: false });
  });

  it('keys V5 identity to user seed, take, and density and changes the musical plan deterministically', () => {
    const { project, result: baseline } = composeCase('ensemble.chamber', 1);
    const replay = composeAllTracks(project, { seed: 11, density: 1 });
    const otherUserSeed = composeAllTracks(project, { seed: 29, density: 1 });
    const lowerDensity = composeAllTracks(project, { seed: 11, density: 0.1 });
    const nextTakeProject: Project = { ...project, orchestration: baseline.orchestration };
    const nextTake = composeAllTracks(nextTakeProject, { seed: 11, density: 1 });
    const baseIdentity = baseline.pianoEngineInput.context.generationIdentity;

    expect(replay.pianoEngineInput.context.generationIdentity).toEqual(baseIdentity);
    expect(baseIdentity).toMatchObject({ algorithm: 'piano-engine-v5', userSeed: 11, take: 1, density: 1 });
    expect(baseIdentity.key).toContain('userSeed=11');
    expect(baseIdentity.key).toContain('take=1');
    expect(baseIdentity.key).toContain('density=1.000');
    expect(otherUserSeed.pianoEngineInput.context.generationIdentity.key).not.toBe(baseIdentity.key);
    expect(nextTake.pianoEngineInput.context.generationIdentity.key).not.toBe(baseIdentity.key);
    expect(lowerDensity.pianoEngineInput.context.generationIdentity.key).not.toBe(baseIdentity.key);
    expect(lowerDensity.pianoEngineInput.context.generationIdentity.density).toBe(0.1);

    const pianoNotesFor = (result: ReturnType<typeof composeAllTracks>) => result.tracks
      .find((track) => isInstrumentTrack(track) && track.role === 'piano')?.notes ?? [];
    expect(pianoNotesFor(otherUserSeed)).not.toEqual(pianoNotesFor(baseline));
    expect(pianoNotesFor(nextTake)).not.toEqual(pianoNotesFor(baseline));
    expect(pianoNotesFor(lowerDensity)).not.toEqual(pianoNotesFor(baseline));

    const planFor = (result: ReturnType<typeof composeAllTracks>) => composePianoPlan(
      result.pianoEngineInput,
      analyzePianoInput(result.pianoEngineInput),
    );
    const basePlan = planFor(baseline);
    const changedSeedPlan = planFor(otherUserSeed);
    const changedTakePlan = planFor(nextTake);
    const lowerDensityPlan = planFor(lowerDensity);
    expect(basePlan.generationIdentity.seed).toBe(basePlan.seed);
    expect(changedSeedPlan.motif?.rhythmicWeights).not.toEqual(basePlan.motif?.rhythmicWeights);
    expect(changedTakePlan.generationIdentity.key).not.toBe(basePlan.generationIdentity.key);
    expect(changedTakePlan.phrases.map((phrase) => phrase.motif))
      .not.toEqual(basePlan.phrases.map((phrase) => phrase.motif));
    const baselineDensityByPhrase = new Map(basePlan.phrases.map((phrase) => [phrase.id, phrase.intendedDensity]));
    expect(lowerDensityPlan.phrases.some((phrase) => baselineDensityByPhrase.get(phrase.id) !== phrase.intendedDensity)).toBe(true);
  });

  it('marks string-only layer annotations partial and never infers total occupancy or capacity', () => {
    const { context } = composeCase('ensemble.chamber', 1);
    expect(context.layerInformation.availability).toBe('partial');
    expect(context.layerInformation.source).toBe('ConductorPlan.bars[].layers');
    expect(context.layerInformation.annotatedFamilies).toEqual(['Strings']);
    expect(context.layerInformation.totalCapacity).toBeNull();
    expect(context.layerInformation.totalOccupiedLayers).toBeNull();
    expect(context.layerInformation.unavailableReason).toMatch(/not inferred/);
  });

  it('keeps the analysis snapshot deeply immutable, piano-excluded, and harp read-only', () => {
    const { project, result, input } = composeCase('ensemble.cinematic', 4);
    const snapshot = input.analysis;
    const nonPianoTracks = result.tracks.filter((track) => isInstrumentTrack(track) && track.role !== 'piano');
    const expectedSnapshot = nonPianoTracks.map(({ id, name, family, role, notes, cc }) => ({
      id,
      name,
      family,
      role,
      notes,
      ...(cc ? { cc } : {}),
    }));
    const harp = snapshot.tracks.find((track) => track.role === 'harp');
    const harpOutput = result.tracks.find((track) => track.role === 'harp');
    const before = JSON.stringify(result.tracks);

    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.context)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.tracks)).toBe(true);
    expect(snapshot.tracks.map(({ id, name, family, role, notes, cc }) => ({
      id,
      name,
      family,
      role,
      notes,
      ...(cc ? { cc } : {}),
    }))).toEqual(expectedSnapshot);
    expect(snapshot.tracks.some((track) => track.role === 'piano')).toBe(false);
    expect(harp).toBeDefined();
    expect(harpOutput).toBeDefined();
    expect(Object.isFrozen(harp)).toBe(true);
    expect(Object.isFrozen(harp!.notes)).toBe(true);
    expect(harp!.notes.every((note) => Object.isFrozen(note))).toBe(true);
    if (harp!.cc) {
      expect(Object.isFrozen(harp!.cc)).toBe(true);
      expect(harp!.cc.every((lane) => Object.isFrozen(lane) && Object.isFrozen(lane.points))).toBe(true);
    }
    expect(harp!.notes).not.toBe(harpOutput!.notes);
    expect(JSON.stringify(result.tracks)).toBe(before);
    expect(project.tracks.some((track) => track.role === 'harp')).toBe(true);
  });

  it('does not put context in the project, persisted composition shape, or serialized track output', () => {
    const { project, result } = composeCase('ensemble.chamber', 1);
    const composedProject: Project = {
      ...project,
      tracks: result.tracks,
      orchestration: result.orchestration,
    };
    const serialized = JSON.parse(JSON.stringify(composedProject)) as Record<string, unknown>;

    expect(serialized).not.toHaveProperty('pianoEngineInput');
    expect(Object.keys(result)).not.toContain('pianoEngineInput');
    expect(JSON.stringify(result)).not.toContain('pianoEngineInput');
    expect(JSON.stringify(result.tracks)).not.toContain('pianoEngineInput');
    expect(validateProject(serialized).ok).toBe(true);
  });

  it('keeps every non-Piano track byte-identical to the pre-V2 baseline for every template', () => {
    for (const entry of CASES) {
      const { result } = composeCase(entry.id, entry.take, entry.fixture);
      const nonPianoTracks = result.tracks.filter((track) => track.role !== 'piano');
      expect(trackHash(nonPianoTracks), `${entry.id}, take ${entry.take}`)
        .toBe(NON_PIANO_TRACK_HASHES[entry.id]);
    }
  });
});
