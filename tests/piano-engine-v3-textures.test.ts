import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { buildMergedMidi, buildPerTrackMidi, parseMidiFile } from '../src/export/midi';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import type { PianoAnalysis, PianoAnalysisTrack } from '../src/orchestrator/keys/analysis';
import {
  composePianoPlan,
  type PianoComposerPlan,
  type PianoTextureKind,
} from '../src/orchestrator/keys/piano-composer';
import type { PianoEngineInput, PianoRelevantMoment } from '../src/orchestrator/keys/piano-engine';
import { realizePianoPlanWithAudit } from '../src/orchestrator/keys/piano-realizer';
import { projectEndTick } from '../src/shared/schema/meter';
import { isInstrumentTrack, projectFromFixture, type Project, type Track } from '../src/shared/schema';
import type { SpineSection } from '../src/orchestrator/spine';

const PPQ = 960;
const BAR = PPQ * 4;
const DEMO_END = BAR * 12;
const TEMPLATE_IDS = [
  'ensemble.chamber',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.cinematic',
  'ensemble.hybridstudio',
] as const;
type TemplateId = (typeof TEMPLATE_IDS)[number];

interface ProductionCase {
  readonly project: Project;
  readonly result: ReturnType<typeof composeAllTracks>;
  readonly piano: Track;
}

interface TextureFixture {
  readonly input: PianoEngineInput;
  readonly project: Project;
  readonly piano: Track;
}

interface TextureOptions {
  readonly targets?: readonly number[];
  readonly nearSilenceBars?: readonly number[];
  readonly moments?: readonly PianoRelevantMoment[];
  readonly fillWindows?: PianoEngineInput['context']['fillWindows'];
  readonly analysis?: PianoAnalysis;
  readonly seed?: number;
}

const productionCases = new Map<TemplateId, ProductionCase>();

function productionCase(templateId: TemplateId): ProductionCase {
  const cached = productionCases.get(templateId);
  if (cached) return cached;
  const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed: 17 });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} production composition returned no Piano track.`);
  const created = { project, result, piano };
  productionCases.set(templateId, created);
  return created;
}

function emptyAnalysisTrack(id = 'empty-strings'): PianoAnalysisTrack {
  return { id, name: 'Quiet strings', family: 'Strings', role: 'violins1', notes: [] };
}

function moment(
  kind: PianoRelevantMoment['kind'],
  startBar: number,
  endBar: number,
  participantRoles: readonly string[] = ['piano'],
): PianoRelevantMoment {
  return {
    kind,
    startBar,
    endBar,
    startTick: (startBar - 1) * BAR,
    endTick: endBar * BAR,
    participantRoles,
    shape: 'hold',
  };
}

function contrastMoments(): PianoRelevantMoment[] {
  return [
    moment('soli', 5, 5),
    moment('soli', 8, 8),
    moment('unison', 9, 10),
  ];
}

function shapedInput(templateId: TemplateId, options: TextureOptions = {}): TextureFixture {
  const base = productionCase(templateId);
  const source = base.result.pianoEngineInput;
  const sectionNames = ['Opening space', 'Dialogue / development', 'Climax and release'];
  const sections: SpineSection[] = sectionNames.map((name, index) => ({
    id: `v3-section-${index + 1}`,
    name,
    index,
    occurrence: 1,
    startBar: index * 4 + 1,
    lengthBars: 4,
    startTick: index * 4 * BAR,
    endTick: (index + 1) * 4 * BAR,
  }));
  const barWindows = source.context.barWindows
    .filter((bar) => bar.bar >= 1 && bar.bar <= 12)
    .map((bar) => {
      const sectionIndex = Math.min(2, Math.floor((bar.bar - 1) / 4));
      return { ...bar, sectionId: sections[sectionIndex].id, sectionName: sections[sectionIndex].name };
    });
  const sourceHarmony = source.context.harmony.filter((chord) => chord.startTick < DEMO_END);
  const harmony = sourceHarmony.flatMap((chord, index) => {
    const nextStart = sourceHarmony[index + 1]?.startTick ?? DEMO_END;
    const endTick = Math.min(DEMO_END, chord.endTick, nextStart);
    return endTick > chord.startTick ? [{ ...chord, endTick }] : [];
  });
  const targets = options.targets ?? Array.from({ length: 12 }, (_, index) =>
    index < 4 ? 0.35 : index < 8 ? 0.45 : [0.5, 0.9, 0.45, 0.15][index - 8]);
  const nearSilenceBars = new Set(options.nearSilenceBars ?? []);
  const energy = barWindows.map((bar, index) => ({
    bar: bar.bar,
    target: Math.max(0, Math.min(1, targets[bar.bar - 1] ?? 0.45)),
    nearSilence: nearSilenceBars.has(bar.bar),
  }));
  const layerInformation = {
    ...source.context.layerInformation,
    perBar: barWindows.map(({ bar }) => ({ bar, layers: [] })),
  };
  const input: PianoEngineInput = {
    context: {
      ...source.context,
      sections,
      barWindows,
      harmony,
      energy,
      layerInformation,
      moments: options.moments ?? contrastMoments(),
      fillWindows: options.fillWindows ?? [],
      seed: options.seed ?? 17,
    },
    analysis: options.analysis ?? { tracks: [] },
  };
  return { input, project: base.project, piano: base.piano };
}

function planFor(input: PianoEngineInput): PianoComposerPlan {
  return composePianoPlan(input, analyzePianoInput(input));
}

function texturePhrase(plan: PianoComposerPlan, sectionId: string, functionName?: string) {
  return plan.phrases.find((phrase) => phrase.sectionId === sectionId
    && (functionName === undefined || phrase.function === functionName));
}

function overlapping(a: { pitch: number; startTick: number; durationTicks: number }, b: { pitch: number; startTick: number; durationTicks: number }): boolean {
  return a.startTick < b.startTick + b.durationTicks && b.startTick < a.startTick + a.durationTicks;
}

function eventShape(notes: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[]) {
  return [...notes]
    .map(({ pitch, startTick, durationTicks, velocity }) => ({ pitch, startTick, durationTicks, velocity }))
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.durationTicks - b.durationTicks || a.velocity - b.velocity);
}

function pitchClass(pitch: number): number {
  return ((pitch % 12) + 12) % 12;
}

function templateAwarePianoNotes(templateId: TemplateId) {
  const base = productionCase(templateId);
  const input = base.result.pianoEngineInput;
  const plan = planFor(input);
  const notes = realizePianoPlanWithAudit({
    plan,
    targetTrack: base.piano,
    projectEndTick: projectEndTick(base.project),
  });
  return { ...base, input, plan, notes };
}

describe('Piano Engine V3 context-aware textures', () => {
  it('chooses a purpose-led texture path across phrases and sections without random pattern selection', () => {
    const fixture = shapedInput('ensemble.chamber');
    const plan = planFor(fixture.input);
    const repeated = planFor(fixture.input);
    const alternateSeed = planFor({
      ...fixture.input,
      context: { ...fixture.input.context, seed: fixture.input.context.seed + 1 },
    });

    expect(JSON.stringify(repeated)).toBe(JSON.stringify(plan));
    expect(alternateSeed.phrases.map((phrase) => phrase.texture.kind))
      .toEqual(plan.phrases.map((phrase) => phrase.texture.kind));
    expect(plan.version).toBe(2);
    expect(plan.containsMidiNotes).toBe(false);
    expect(plan.sectionIntentions).toHaveLength(3);
    expect(new Set(plan.phrases.map((phrase) => phrase.texture.kind)).size).toBeGreaterThanOrEqual(4);
    expect(plan.phrases.every((phrase) => phrase.texture.rationale.length > 0
      && phrase.texture.evidence.some((entry) => entry.includes('Energy'))
      && phrase.texture.evidence.some((entry) => entry.includes('resolved chord')))).toBe(true);

    const opening = texturePhrase(plan, 'v3-section-1');
    const dialogue = texturePhrase(plan, 'v3-section-2', 'development');
    const climax = texturePhrase(plan, 'v3-section-3', 'contrast');
    const release = texturePhrase(plan, 'v3-section-3', 'arrival');
    expect(opening?.texture.kind).toBe('broken-chords');
    expect(dialogue?.texture.kind).toBe('contrapuntal-dialogue');
    expect(climax?.texture.kind).toBe('block-chords');
    expect(release?.texture.kind).toBe('sparse-sustained');
    expect(release?.texture.transitionFromPrevious).toBe('block-chords');
    expect(release?.texture.transition).toBe('release');
    expect(plan.sectionIntentions[2].textureProgression.map((entry) => entry.kind))
      .toEqual(['block-chords', 'sparse-sustained']);
  });

  it('covers sparse, broken, arpeggiated, melody-plus-accompaniment, block, dialogue, and reserved flourishes', () => {
    const expectedTextures: PianoTextureKind[] = [
      'sparse-sustained', 'broken-chords', 'arpeggiated', 'melody-accompaniment',
      'block-chords', 'contrapuntal-dialogue', 'short-flourishes',
    ];
    const sparseFixture = shapedInput('ensemble.vocalbacking', { nearSilenceBars: [6, 7] });
    const brokenPlan = planFor(shapedInput('ensemble.vocalbacking').input);
    const arpeggioTargets = Array.from({ length: 12 }, (_, index) =>
      index === 4 ? 0.2 : index === 5 ? 0.35 : index === 6 ? 0.8 : index === 7 ? 0.45 : 0.45);
    const arpeggioPlan = planFor(shapedInput('ensemble.cinematic', { targets: arpeggioTargets }).input);
    const melodyTargets = Array.from({ length: 12 }, (_, index) => index === 5 || index === 6 ? 0.78 : 0.45);
    const melodyPlan = planFor(shapedInput('ensemble.hybridstudio', { targets: melodyTargets }).input);
    const dialoguePlan = planFor(shapedInput('ensemble.sonata').input);
    const climaxPlan = planFor(shapedInput('ensemble.chamber').input);
    const flourishStart = 5 * BAR + PPQ / 2;
    const flourishFixture = shapedInput('ensemble.sonata', {
      fillWindows: [{ target: 'piano', startTick: flourishStart, endTick: flourishStart + PPQ }],
      analysis: { tracks: [emptyAnalysisTrack()] },
    });
    const flourishPlan = planFor(flourishFixture.input);
    const actualTextures = [
      texturePhrase(planFor(sparseFixture.input), 'v3-section-2', 'development')?.texture.kind,
      texturePhrase(brokenPlan, 'v3-section-2', 'development')?.texture.kind,
      texturePhrase(arpeggioPlan, 'v3-section-2', 'development')?.texture.kind,
      texturePhrase(melodyPlan, 'v3-section-2', 'development')?.texture.kind,
      texturePhrase(climaxPlan, 'v3-section-3', 'contrast')?.texture.kind,
      texturePhrase(dialoguePlan, 'v3-section-2', 'development')?.texture.kind,
      flourishPlan.phrases.find((phrase) => phrase.texture.kind === 'short-flourishes')?.texture.kind,
    ];
    expect(actualTextures).toEqual(expectedTextures);

    const flourishPhrase = flourishPlan.phrases.find((phrase) => phrase.texture.kind === 'short-flourishes');
    expect(flourishPhrase?.texture.purpose).toBe('punctuate-phrase');
    expect(flourishPlan.fillDecisions.some((fill) => fill.decision === 'consider-brief-gesture')).toBe(true);
  });

  it('thins under a written lead or crowded upper-register occupancy', () => {
    const baseline = shapedInput('ensemble.vocalbacking');
    const baselinePhrase = texturePhrase(planFor(baseline.input), 'v3-section-2', 'development');
    expect(baselinePhrase?.texture.kind).toBe('broken-chords');

    const highNotes = [6, 7].flatMap((bar) => Array.from({ length: 7 }, (_, index) => ({
      pitch: 84,
      startTick: (bar - 1) * BAR + 100 + index * 400,
      durationTicks: 120,
      velocity: 72,
    })));
    const occupiedInput: PianoEngineInput = {
      ...baseline.input,
      analysis: { tracks: [{ ...emptyAnalysisTrack('high-register'), notes: highNotes }] },
    };
    const occupiedPhrase = texturePhrase(planFor(occupiedInput), 'v3-section-2', 'development');
    expect(occupiedPhrase?.texture.kind).toBe('sparse-sustained');
    expect(occupiedPhrase?.texture.evidence.some((entry) => entry.includes('high 7.0'))).toBe(true);

    const leadId = 'annotated-strings-lead';
    const leadNotes = [6, 7].map((bar) => ({
      pitch: 82,
      startTick: (bar - 1) * BAR + 120,
      durationTicks: PPQ,
      velocity: 78,
    }));
    const layerInformation = {
      ...baseline.input.context.layerInformation,
      perBar: baseline.input.context.barWindows.map(({ bar }) => ({
        bar,
        layers: bar === 6 || bar === 7
          ? [{ layer: 'lead' as const, trackIds: [leadId], source: 'strings' as const }]
          : [],
      })),
    };
    const leadInput: PianoEngineInput = {
      ...baseline.input,
      context: { ...baseline.input.context, layerInformation },
      analysis: { tracks: [{
        id: leadId, name: 'Lead violins', family: 'Strings', role: 'violins1', notes: leadNotes,
      }] },
    };
    const leadPhrase = texturePhrase(planFor(leadInput), 'v3-section-2', 'development');
    expect(leadPhrase?.texture.kind).toBe('sparse-sustained');
    expect(leadPhrase?.texture.evidence.some((entry) => entry.includes(leadId))).toBe(true);
  });

  it('lets an explicit leave-space reservation override a decorative phrase texture', () => {
    const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
    project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
    project.orchestration = { take: 0 };
    const result = composeAllTracks(project, { seed: 11 });
    const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
    if (!piano) throw new Error('Production composition returned no Piano track.');
    const plan = planFor(result.pianoEngineInput);
    const reservation = plan.fillDecisions.find((fill) => fill.target.toLowerCase() === 'piano'
      && fill.decision === 'leave-space');
    if (!reservation) throw new Error('The production fixture did not select a Piano leave-space reservation.');
    const phrase = plan.phrases.find((entry) => entry.startTick <= reservation.startTick
      && entry.endTick >= reservation.endTick);
    expect(phrase?.texture.kind).toBe('sparse-sustained');
    expect(phrase?.texture.rationale).toContain('leave-space reservation');
    expect(phrase?.texture.evidence.some((entry) => entry.includes('leave-space reservation'))).toBe(true);

    const realization = realizePianoPlanWithAudit({
      plan,
      targetTrack: piano,
      projectEndTick: projectEndTick(project),
    });
    expect(realization.notes.filter((note) => note.startTick >= reservation.startTick
      && note.startTick < reservation.endTick)).toEqual([]);
  });

  it('realizes playable textures with independent hands, phrase-connected flourishes, and bounded voice-leading', () => {
    const fixture = shapedInput('ensemble.chamber');
    const plan = planFor(fixture.input);
    const result = realizePianoPlanWithAudit({ plan, targetTrack: fixture.piano, projectEndTick: DEMO_END });
    const dialogue = texturePhrase(plan, 'v3-section-2', 'development')!;
    const dialogueNotes = result.notes.filter((note) => note.startTick >= dialogue.startTick && note.startTick < dialogue.endTick);
    const lowerAnswers = dialogueNotes.filter((note) => note.roleTag === 'answer' && note.pitch < 60);
    const upperSubject = dialogueNotes.filter((note) => note.roleTag === 'answer' && note.pitch >= 60);
    expect(lowerAnswers.length).toBeGreaterThan(0);
    expect(upperSubject.length).toBeGreaterThan(0);
    expect(lowerAnswers.some((note) => note.startTick % PPQ !== 0)).toBe(true);
    expect(lowerAnswers.every((note) => note.pitch >= fixture.piano.lowestNote && note.pitch <= 55)).toBe(true);
    const lowerLine = [...lowerAnswers].sort((a, b) => a.startTick - b.startTick);
    const lowerLeaps = lowerLine.slice(1).map((note, index) => Math.abs(note.pitch - lowerLine[index].pitch));
    expect(lowerLeaps.length === 0 || lowerLeaps.reduce((sum, leap) => sum + leap, 0) / lowerLeaps.length)
      .toBeLessThanOrEqual(8);

    const broken = texturePhrase(plan, 'v3-section-1')!;
    const brokenChord = plan.harmonicEvents.find((event) => event.chord.startTick >= broken.startTick
      && event.chord.startTick < broken.endTick)!;
    const brokenOnsets = result.notes.filter((note) => note.roleTag === 'bed'
      && note.startTick >= brokenChord.chord.startTick && note.startTick < brokenChord.chord.endTick)
      .map((note) => note.startTick);
    expect(new Set(brokenOnsets).size).toBeGreaterThanOrEqual(2);

    const climax = texturePhrase(plan, 'v3-section-3', 'contrast')!;
    const blockChord = plan.harmonicEvents.find((event) => event.chord.startTick >= climax.startTick
      && event.chord.startTick < climax.endTick)!;
    const blockAttackCount = result.notes.filter((note) => note.startTick === blockChord.chord.startTick
      && note.pitch >= 50 && (note.roleTag === 'bed' || note.roleTag === 'arrival')).length;
    expect(blockAttackCount).toBeGreaterThanOrEqual(2);

    for (const note of result.notes) {
      expect(note.pitch).toBeGreaterThanOrEqual(fixture.piano.lowestNote);
      expect(note.pitch).toBeLessThanOrEqual(fixture.piano.highestNote);
      expect(note.startTick).toBeGreaterThanOrEqual(0);
      expect(note.durationTicks).toBeGreaterThan(0);
      expect(note.startTick + note.durationTicks).toBeLessThanOrEqual(DEMO_END);
    }
    expect(result.octavePolicy.remainingHardPairs).toBe(0);
    for (let left = 0; left < result.notes.length; left++) {
      for (let right = left + 1; right < result.notes.length; right++) {
        const first = result.notes[left];
        const second = result.notes[right];
        const interval = Math.abs(first.pitch - second.pitch);
        if (interval < 12 || interval % 12 !== 0 || !overlapping(first, second)) continue;
        const settle = first.roleTag === 'settle' ? first : second.roleTag === 'settle' ? second : null;
        const bass = settle === first ? second : first;
        const plannedSuspension = settle !== null && bass.roleTag === 'anchor'
          && plan.harmonicEvents.some((event) => event.suspension !== null
            && pitchClass(settle.pitch) === pitchClass(event.suspension.resolvesToPitchClass)
            && pitchClass(bass.pitch) === pitchClass(event.voicing.leftHandBassPitchClass)
            && settle.startTick > event.chord.startTick && settle.startTick < event.chord.endTick);
        expect(plannedSuspension, `unplanned octave overlap ${first.pitch}/${second.pitch}`).toBe(true);
      }
    }
  });

  it('tracks a climax into a sustained release and keeps generation deterministic', () => {
    const fixture = shapedInput('ensemble.chamber');
    const plan = planFor(fixture.input);
    const repeatedPlan = planFor(fixture.input);
    const repeatedNotes = realizePianoPlanWithAudit({ plan: repeatedPlan, targetTrack: fixture.piano, projectEndTick: DEMO_END }).notes;
    const notes = realizePianoPlanWithAudit({ plan, targetTrack: fixture.piano, projectEndTick: DEMO_END }).notes;
    expect(JSON.stringify(plan)).toBe(JSON.stringify(repeatedPlan));
    expect(repeatedNotes).toEqual(notes);

    const climax = texturePhrase(plan, 'v3-section-3', 'contrast')!;
    const release = texturePhrase(plan, 'v3-section-3', 'arrival')!;
    expect(climax.dynamics.peak).toBeGreaterThanOrEqual(3);
    expect(climax.texture.kind).toBe('block-chords');
    expect(release.dynamics.sourceEnergy.descendingTowardEnd).toBe(true);
    expect(release.dynamics.exit).toBeLessThan(release.dynamics.peak);
    expect(release.texture.kind).toBe('sparse-sustained');
    expect(release.texture.rationale).toContain('releasing or descending');
  });

  it('keeps the production Piano path, template boundaries, and non-Piano note identity for all five eligible templates', () => {
    for (const templateId of TEMPLATE_IDS) {
      const { project, result, piano, input, plan, notes } = templateAwarePianoNotes(templateId);
      expect(input.context.template).toEqual({ id: templateId, pianoEligible: true });
      expect(plan.status).toBe('composed');
      expect(plan.template.eligible).toBe(true);
      expect(plan.phrases.every((phrase) => phrase.texture.kind.length > 0)).toBe(true);
      expect(notes.notes.length, `${templateId} Realizer output`).toBeGreaterThan(0);
      expect(notes.controllers.every((lane) => lane.cc !== 64 || lane.points.at(-1)?.value === 0)).toBe(true);

      const nonPiano = result.tracks.filter((track) => isInstrumentTrack(track) && track.role !== 'piano');
      expect(input.analysis.tracks.map(({ id, notes: trackNotes }) => ({ id, notes: trackNotes })))
        .toEqual(nonPiano.map(({ id, notes: trackNotes }) => ({ id, notes: trackNotes })));
      for (const note of notes.notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(piano.lowestNote);
        expect(note.pitch).toBeLessThanOrEqual(piano.highestNote);
        expect(note.startTick + note.durationTicks).toBeLessThanOrEqual(projectEndTick(project));
      }
    }
  });

  it('keeps Symphony piano-free despite a generic Piano pin', () => {
    const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
    project.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: { piano: 'in' } };
    project.orchestration = { take: 0 };
    const result = composeAllTracks(project, { seed: 17 });
    const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
    if (!piano) throw new Error('Symphony composition returned no Piano slot to validate.');
    const plan = planFor(result.pianoEngineInput);
    const realization = realizePianoPlanWithAudit({ plan, targetTrack: piano, projectEndTick: projectEndTick(project) });
    expect(result.pianoEngineInput.context.template).toEqual({ id: 'ensemble.symphony', pianoEligible: false });
    expect(plan.status).toBe('ineligible');
    expect(plan.phrases).toEqual([]);
    expect(piano.notes).toEqual([]);
    expect(piano.cc?.some((lane) => lane.cc === 64) ?? false).toBe(false);
    expect(realization.notes).toEqual([]);
    expect(realization.controllers).toEqual([]);
  });

  it('exports the same V3 Piano notes and CC64 under the UVI Piano track name', () => {
    const base = productionCase('ensemble.chamber');
    const piano = base.result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
    if (!piano || !isInstrumentTrack(piano)) throw new Error('Production composition returned no instrument Piano.');
    const project: Project = { ...base.project, tracks: base.result.tracks, orchestration: base.result.orchestration };
    const uvi = EXPORT_PROFILES.find((entry) => entry.id === 'uvi-orchestral-suite')!.profile;
    const pianoProfile = uvi.parts.find((part) => part.id === 'piano')!;
    expect(pianoProfile.patch).toBe('UVI Grand Model D');
    expect(pianoProfile.exportName).toBe('Piano');
    const perTrackFile = buildPerTrackMidi(project, [piano], uvi).find((file) => file.fileName === 'Piano.mid');
    expect(perTrackFile).toBeDefined();
    const perTrack = parseMidiFile(perTrackFile!.data).tracks.find((track) => track.name === 'Piano');
    expect(perTrack).toBeDefined();
    expect(eventShape(perTrack!.notes)).toEqual(eventShape(piano.notes));
    const expectedPedal = piano.cc?.find((lane) => lane.cc === 64)?.points
      .map(({ tick, value }) => ({ cc: 64, tick, value }));
    expect(expectedPedal?.length).toBeGreaterThan(0);
    expect(perTrack!.cc.map(({ cc, tick, value }) => ({ cc, tick, value }))).toEqual(expectedPedal);

    const merged = parseMidiFile(buildMergedMidi(project, [piano], uvi));
    const mergedPiano = merged.tracks.find((track) => track.name === 'Piano');
    expect(mergedPiano).toBeDefined();
    expect(eventShape(mergedPiano!.notes)).toEqual(eventShape(piano.notes));
    expect(mergedPiano!.cc.map(({ cc, tick, value }) => ({ cc, tick, value }))).toEqual(expectedPedal);
  });
});
