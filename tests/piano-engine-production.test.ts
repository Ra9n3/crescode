import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { resolveTemplate } from '../src/config/ensembles';
import { checkTemplateRules } from '../src/orchestrator/energy';
import { planTrackNotes } from '../src/audio/mapping';
import { buildMergedMidi, parseMidiFile } from '../src/export/midi';
import { isInstrumentTrack, projectFromFixture, validateProject, type Project, type Track } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';
import { composeAllTracks as compose } from '../src/orchestrator/compose';
import { governKeysVelocities } from '../src/orchestrator/keys/render';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScore, openPianoOwnedTransitionBars } from '../src/orchestrator/keys/piano-composer';
import { realizePianoPlanWithAudit } from '../src/orchestrator/keys/piano-realizer';

const CASES = [
  { id: 'ensemble.chamber', take: 1, fixture: threeChorus },
  { id: 'ensemble.vocalbacking', take: 3, fixture: threeChorus },
  { id: 'ensemble.sonata', take: 2, fixture: dorian },
  { id: 'ensemble.cinematic', take: 4, fixture: threeChorus },
  { id: 'ensemble.hybridstudio', take: 5, fixture: threeChorus },
] as const;

function makeProject(templateId: string, take: number, fixture: unknown = threeChorus): Project {
  const project = projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: take - 1 };
  return project;
}

function pianoOf(tracks: readonly Track[]): Track {
  const piano = tracks.find((track) => isInstrumentTrack(track) && track.family === 'Keys' && track.role === 'piano');
  if (!piano) throw new Error('The fixture is missing its Piano track.');
  return piano;
}

const pitchClass = (pitch: number): number => ((pitch % 12) + 12) % 12;

function eventShape(notes: readonly { pitch: number; startTick: number; durationTicks: number; velocity: number }[]) {
  return [...notes]
    .map(({ pitch, startTick, durationTicks, velocity }) => ({ pitch, startTick, durationTicks, velocity }))
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.durationTicks - b.durationTicks || a.velocity - b.velocity);
}

function composeCase(templateId: string, take: number, fixture: unknown = threeChorus) {
  const project = makeProject(templateId, take, fixture);
  const result = compose(project, { seed: 11 });
  return { project, result, piano: pianoOf(result.tracks) };
}

describe('Piano Engine V5 production path', () => {
  it('is the only Piano-track note producer for all five eligible templates', () => {
    for (const entry of CASES) {
      const { project, result, piano } = composeCase(entry.id, entry.take, entry.fixture);
      const input = result.pianoEngineInput;
      const analysis = analyzePianoInput(input);
      // Stage 2A: the production path opens the Piano's own transition windows before scoring.
      const plan = openPianoOwnedTransitionBars(composePianoPlan(input, analysis));
      const target = project.tracks.find((track) => track.id === piano.id)!;
      const score = composePianoScore(input, plan, target, projectEndTick(project));
      const template = resolveTemplate(project.ensemble)!;
      const externalTracks = input.analysis.tracks
        .filter((track) => template.roster.some((entry) => entry.role === track.role))
        .map(({ id, role, notes }) => ({ id, role, notes }));
      const realization = realizePianoPlanWithAudit({
        plan,
        score,
        targetTrack: target,
        projectEndTick: projectEndTick(project),
        externalTracks,
        tempoMap: project.tempoMap,
        timeSignature: project.timeSignature,
      });
      const expected = realization.notes.map((note) => ({ ...note }));
      governKeysVelocities({
        project,
        template,
        keys: [{ role: 'piano', notes: expected }],
        otherNotes: result.tracks
          .filter((track) => isInstrumentTrack(track) && track.role !== 'piano')
          .map((track) => ({ role: track.role, notes: track.notes })),
      });

      expect(input.context.template.pianoEligible, entry.id).toBe(true);
      expect(plan.template.eligible, entry.id).toBe(true);
      expect(result.pianoScore.events).toEqual(score.events);
      expect(result.pianoPlayability.findings).toBeDefined();
      expect(result.pianoRealizedScoreEvents.some((entry) => entry.source.hand === 'left'), `${entry.id} retains left-hand identity`).toBe(true);
      expect(result.pianoRealizedScoreEvents.some((entry) => entry.source.hand === 'right'), `${entry.id} retains right-hand identity`).toBe(true);
      expect(Object.keys(result)).not.toContain('pianoRealizedScoreEvents');
      expect(realization.realizedScoreEvents).toEqual(result.pianoRealizedScoreEvents);
      expect(realization.notes.length, `${entry.id} produced notes`).toBeGreaterThan(0);
      expect(piano.notes, `${entry.id} output equals V5 Realizer output after mix safety`).toEqual(expected);
      expect(realization.octavePolicy.remainingHardPairs, `${entry.id} forbidden octave pairs`).toBe(0);
      const pianoHardFindings = checkTemplateRules(
        { ...project, tracks: result.tracks, orchestration: result.orchestration },
        template,
        result.plan,
      ).filter((finding) => finding.rule === 'octaveDoubling'
        && finding.severity === 'hard' && finding.message.includes('piano'));
      expect(pianoHardFindings, `${entry.id} Piano rule audit`).toHaveLength(0);
      expect(input.analysis.tracks.some((track) => track.role === 'piano'), `${entry.id} excludes piano from analysis`).toBe(false);
      expect(input.analysis.tracks.map((track) => track.id)).toEqual(
        result.tracks.filter((track) => isInstrumentTrack(track) && track.role !== 'piano').map((track) => track.id),
      );
      expect(validateProject({ ...project, tracks: result.tracks, orchestration: result.orchestration }).ok, entry.id).toBe(true);

      const endTick = projectEndTick(project);
      for (const note of piano.notes) {
        expect(Number.isInteger(note.pitch) && note.pitch >= piano.lowestNote && note.pitch <= piano.highestNote, `${entry.id} pitch range`).toBe(true);
        expect(Number.isInteger(note.startTick) && note.startTick >= 0, `${entry.id} nonnegative onset`).toBe(true);
        expect(Number.isInteger(note.durationTicks) && note.durationTicks > 0, `${entry.id} positive duration`).toBe(true);
        expect(note.startTick + note.durationTicks, `${entry.id} project boundary`).toBeLessThanOrEqual(endTick);
        expect(Number.isInteger(note.velocity) && note.velocity >= 1 && note.velocity <= 127, `${entry.id} velocity`).toBe(true);
      }

      for (const note of piano.notes) {
        const restriction = plan.attackRestrictions.find((window) =>
          note.startTick >= window.startTick && note.startTick < window.endTick);
        if (!restriction) continue;
        const explicitFill = note.roleTag === 'flourish' && plan.fillDecisions.some((decision) =>
          decision.decision === 'consider-brief-gesture'
          && note.startTick >= decision.startTick && note.startTick < decision.endTick);
        const explicitSuspension = plan.harmonicEvents.some((event) => {
          const suspension = event.suspension;
          if (!suspension) return false;
          if (note.roleTag === 'settle') {
            return pitchClass(note.pitch) === pitchClass(suspension.resolvesToPitchClass)
              && note.startTick > event.chord.startTick && note.startTick < event.chord.endTick;
          }
          const prepared = plan.harmonicEvents.find((candidate) => candidate.chord.id === suspension.preparedByChordId);
          return note.roleTag === 'answer' && !!prepared
            && pitchClass(note.pitch) === pitchClass(suspension.tensionPitchClass)
            && note.startTick < event.chord.startTick
            && note.startTick + note.durationTicks > event.chord.startTick
            && note.startTick >= prepared.chord.startTick;
        });
        expect(explicitFill || explicitSuspension,
          `${entry.id} bar ${restriction.bar} attack is not a planned exception`).toBe(true);
      }
      // Stage 2A: a planned suspension is either written whole, or deliberately omitted whole with
      // a recorded reason. It is never half written.
      const omissions = result.pianoDiagnostics?.performance?.omittedSuspensions ?? [];
      const omitted = { has: (boundaryTick: number) => omissions.some((item) => item.startTick < boundaryTick && item.resolutionTick >= boundaryTick) };
      const unresolved = realization.suspensions.filter((audit) => !audit.complete
        && !(omitted.has(audit.boundaryTick) && !audit.preparationFound && !audit.resolutionFound));
      expect(unresolved, `${entry.id} planned suspensions resolve or are omitted whole: ${JSON.stringify(unresolved)}`).toEqual([]);
      // An omission is a recorded decision about one planned suspension, with its reason, and it
      // leaves no suspension note of that span in the score.
      for (const omission of omissions) {
        expect(omission.reason.length, `${entry.id} omission at ${omission.startTick} has a reason`).toBeGreaterThan(0);
        expect(realization.suspensions.some((audit) => omission.startTick < audit.boundaryTick && omission.resolutionTick >= audit.boundaryTick),
          `${entry.id} omission at ${omission.startTick} names a planned suspension`).toBe(true);
        expect(result.pianoScore.events.filter((event) => event.voiceId === 'rh.suspension'
          && event.startTick >= omission.startTick && event.startTick <= omission.resolutionTick),
          `${entry.id} omitted suspension at ${omission.startTick} left a note`).toEqual([]);
      }
    }
  });

  it('revoices Piano in forbidden-policy templates without leaving hard Piano octave findings', () => {
    const collisionCases = [
      { id: 'ensemble.sonata', take: 2, fixture: threeChorus },
      { id: 'ensemble.vocalbacking', take: 4, fixture: dorian },
    ] as const;
    for (const entry of collisionCases) {
      const { project, result } = composeCase(entry.id, entry.take, entry.fixture);
      const template = resolveTemplate(project.ensemble)!;
      const findings = checkTemplateRules(
        { ...project, tracks: result.tracks, orchestration: result.orchestration },
        template,
        result.plan,
      ).filter((finding) => finding.rule === 'octaveDoubling'
        && finding.severity === 'hard' && finding.message.includes('piano'));
      expect(findings, `${entry.id} take ${entry.take}`).toHaveLength(0);
      expect(result.reports.find((line) => line.startsWith('piano engine V5')))
        .toMatch(/forbidden octave policy revoiced \d+/);
    }
  });

  it('replays identical notes and CC64 for the same project, take, user seed, and density', () => {
    const { project } = composeCase('ensemble.cinematic', 4);
    const a = compose(project, { seed: 11, density: 1 });
    const b = compose(project, { seed: 11, density: 1 });
    expect(a.pianoEngineInput.context.generationIdentity)
      .toEqual(b.pianoEngineInput.context.generationIdentity);
    expect(pianoOf(a.tracks).notes).toEqual(pianoOf(b.tracks).notes);
    const pedal = (tracks: readonly Track[]) => pianoOf(tracks).cc?.find((lane) => lane.cc === 64)?.points ?? [];
    expect(pedal(a.tracks)).toEqual(pedal(b.tracks));
    expect(JSON.stringify(a.tracks)).toBe(JSON.stringify(b.tracks));
  });

  it('keeps Symphony Piano-free even when a pin admits Piano to the generic band', () => {
    const project = makeProject('ensemble.symphony', 1);
    project.ensemble!.pins.piano = 'in';
    const result = compose(project, { seed: 11 });
    const piano = pianoOf(result.tracks);

    expect(result.pianoEngineInput.context.template).toEqual({ id: 'ensemble.symphony', pianoEligible: false });
    expect(piano.notes).toEqual([]);
  });

  it('keeps preview notes and exported MIDI notes plus CC64 identical to the composed Piano track', () => {
    const { project, result, piano } = composeCase('ensemble.chamber', 1);
    const composedProject: Project = { ...project, tracks: result.tracks, orchestration: result.orchestration };
    const expectedEvents = eventShape(piano.notes);

    expect(eventShape(planTrackNotes(piano, 'simple'))).toEqual(expectedEvents);
    expect(eventShape(planTrackNotes(piano, 'expressive'))).toEqual(expectedEvents);

    const midi = parseMidiFile(buildMergedMidi(composedProject, composedProject.tracks.filter(isInstrumentTrack)));
    const pianoMidiTrack = midi.tracks.find((track) => track.name === piano.name);
    expect(pianoMidiTrack).toBeDefined();
    expect(eventShape(pianoMidiTrack!.notes)).toEqual(expectedEvents);
    const expectedPedal = piano.cc?.find((lane) => lane.cc === 64)?.points
      .map(({ tick, value }) => ({ cc: 64, tick, value })) ?? [];
    expect(expectedPedal.length).toBeGreaterThan(0);
    expect(pianoMidiTrack!.cc.filter((event) => event.cc === 64)
      .map(({ cc, tick, value }) => ({ cc, tick, value }))).toEqual(expectedPedal);
  });
});
