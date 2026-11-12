import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScore, composePianoScoreWithDiagnostics } from '../src/orchestrator/keys/piano-composer';
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
    // The bass is a connected line: successive bass notes of the phrase never leap beyond an octave.
    const bassLine = phraseEvents.filter((event) => event.voiceId === 'lh.bass').sort((a, b) => a.startTick - b.startTick);
    expect(bassLine.length).toBeGreaterThan(1);
    expect(bassLine.slice(1).every((event, index) => Math.abs(event.pitch - bassLine[index].pitch) <= 12)).toBe(true);
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

  it('production contract — independent composition: the Piano writes its own theme, bass, accompaniment and inner voices without taking material from other instruments', () => {
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
      // Inside a phrase the line never leaps beyond an octave; a register lift may separate phrases.
      expect(melody.slice(1).every((event, index) => event.phraseId !== melody[index].phraseId
        || Math.abs(event.pitch - melody[index].pitch) <= 12)).toBe(true);

      // The upper line is the piece-wide theme: metrically placed on the eighth-note grid, with more
      // than one note length, and present in more than one phrase.
      expect(melody.every((event) => event.startTick % (PPQ / 2) === 0)).toBe(true);
      expect(new Set(melody.map((event) => event.durationTicks)).size).toBeGreaterThan(1);
      expect(new Set(melody.map((event) => event.phraseId)).size).toBeGreaterThan(1);
      expect(melody.some((event) => event.techniqueIntent === 'theme-statement')).toBe(true);
      expect(melody.some((event) => event.techniqueIntent === 'theme-development')).toBe(true);

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

    // The theme returns: its opening bar (rhythm and interval shape) is heard again in a later phrase.
    for (const { score, project } of samples) {
      const bar = barTicks(project.timeSignature);
      const shapes = new Map<string, Set<string>>();
      const melody = score.events.filter((event) => event.voiceId === 'rh.melody')
        .sort((a, b) => a.startTick - b.startTick);
      for (let index = 0; index < Math.ceil(score.projectEndTick / bar); index++) {
        const notes = melody.filter((event) => Math.floor(event.startTick / bar) === index);
        if (notes.length < 3) continue;
        const rhythm = notes.map((event) => event.startTick - index * bar).join(',');
        const phrases = shapes.get(rhythm) ?? new Set<string>();
        phrases.add(notes[0].phraseId ?? '');
        shapes.set(rhythm, phrases);
      }
      expect([...shapes.values()].some((phrases) => phrases.size > 1),
        'a theme rhythm recurs in more than one phrase').toBe(true);
    }

    // Independence, checked against the real Compose All result for the full Chamber ensemble.
    for (const { composition, scoreInput, plan, target, project } of samples) {
      const full = composition.pianoDiagnostics!;
      const alone = composePianoScoreWithDiagnostics(scoreInput, plan, target, projectEndTick(project)).diagnostics!;
      // The theme the Piano writes with nobody else playing is the theme it writes inside the ensemble.
      expect(JSON.stringify(alone.theme)).toBe(JSON.stringify(full.theme));
      expect(alone.adaptation.evidence).toBe('none');
      // Substantive on its own: every sounding phrase has a melody, a bass, an accompaniment
      // figure and inner voices, written before any orchestral evidence is read.
      for (const diagnostics of [alone, full]) {
        for (const phrase of diagnostics.phrases.filter((entry) => entry.role !== 'breath')) {
          const bars = diagnostics.bars.filter((bar) => bar.phraseId === phrase.phraseId);
          const total = (pick: (bar: typeof bars[number]) => number) => bars.reduce((sum, bar) => sum + pick(bar), 0);
          expect(total((bar) => bar.independent.melody), `${phrase.phraseId} melody`).toBeGreaterThan(0);
          expect(total((bar) => bar.independent.bass), `${phrase.phraseId} bass`).toBeGreaterThan(0);
          expect(total((bar) => bar.independent.accompaniment), `${phrase.phraseId} accompaniment`).toBeGreaterThan(0);
          expect(total((bar) => bar.independent.inner), `${phrase.phraseId} inner voices`).toBeGreaterThan(0);
        }
      }
      // Its content is not borrowed: no other instrument's part accounts for the Piano theme. For
      // every finalized non-Piano track, most Piano theme notes do not coincide with a note of that
      // track at the same moment on the same pitch class.
      const theme = full.independentDraft.notes.filter((note) => note.l === 'melody');
      expect(theme.length).toBeGreaterThan(6);
      for (const track of composition.pianoEngineInput.analysis.tracks) {
        if (track.role === 'piano' || !track.notes.length) continue;
        const copied = theme.filter((note) => track.notes.some((other) =>
          Math.abs(other.startTick - note.t) < PPQ / 4 && other.pitch % 12 === note.p % 12)).length;
        expect(copied * 2, `${track.role} does not supply the Piano theme`).toBeLessThan(theme.length);
      }
      // And it is the Piano track that Compose All actually returns.
      const pianoTrack = composition.tracks.find((track) => 'role' in track && track.role === 'piano');
      expect(pianoTrack && 'notes' in pianoTrack ? pianoTrack.notes.length : 0).toBe(composition.pianoScore.events.length);
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
