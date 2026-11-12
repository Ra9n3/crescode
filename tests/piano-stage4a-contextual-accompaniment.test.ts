import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScore, composePianoScoreWithDiagnostics } from '../src/orchestrator/keys/piano-composer';
import type { PianoAnalysisTrack } from '../src/orchestrator/keys/analysis';
import type { PianoEngineInput, PianoLayerSlot, PianoRelevantMoment } from '../src/orchestrator/keys/piano-engine';
import { validatePianoScorePlayability } from '../src/orchestrator/keys/piano-playability';
import type { PianoScore } from '../src/orchestrator/keys/piano-score';
import { isInstrumentTrack, projectFromFixture, type Note, type Project, type Track, type TrackFamily } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';
import { PPQ } from '../src/shared/schema/types';

const sampleCache = new Map<string, {
  project: Project;
  input: PianoEngineInput;
  piano: Track;
}>();

function productionSample(templateId = 'ensemble.chamber', seed = 11) {
  const key = `${templateId}:${seed}`;
  const cached = sampleCache.get(key);
  if (cached) return cached;
  const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  const result = composeAllTracks(project, { seed, density: 0.85, moments: false, pianoComposition: 'classic' });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  if (!piano) throw new Error(`${templateId} returned no Piano target.`);
  const sample = { project, input: result.pianoEngineInput, piano };
  sampleCache.set(key, sample);
  return sample;
}

function makeTrack(
  id: string,
  role: string,
  notes: readonly Note[],
  family: TrackFamily = 'Strings',
): PianoAnalysisTrack {
  return { id, name: id, role, family, notes };
}

function emptyTrack(id = 'silent-violas', role = 'violas'): PianoAnalysisTrack {
  return makeTrack(id, role, []);
}

function notesAcrossBars(
  input: PianoEngineInput,
  pitch: number,
  velocity = 78,
): Note[] {
  return input.context.barWindows.map((bar) => ({
    pitch,
    startTick: bar.startTick + Math.min(120, Math.floor((bar.endTick - bar.startTick) / 8)),
    durationTicks: Math.max(1, bar.endTick - bar.startTick - 240),
    velocity,
  }));
}

function controlledInput(
  source: PianoEngineInput,
  tracks: readonly PianoAnalysisTrack[],
  options: {
    readonly moments?: readonly PianoRelevantMoment[];
    readonly leadTrackId?: string;
    readonly harmony?: PianoEngineInput['context']['harmony'];
    readonly sections?: PianoEngineInput['context']['sections'];
  } = {},
): PianoEngineInput {
  const leadTrackId = options.leadTrackId;
  const perBar = source.context.layerInformation.perBar.map((bar): {
    bar: number;
    layers: readonly PianoLayerSlot[];
  } => ({
    bar: bar.bar,
    layers: leadTrackId
      ? [{ layer: 'lead', trackIds: [leadTrackId], source: 'strings' }]
      : [],
  }));
  return {
    ...source,
    context: {
      ...source.context,
      harmony: options.harmony ?? source.context.harmony,
      sections: options.sections ?? source.context.sections,
      moments: options.moments ?? [],
      fillWindows: [],
      layerInformation: { ...source.context.layerInformation, perBar },
    },
    analysis: { tracks },
  };
}

function writeScore(sample: ReturnType<typeof productionSample>, input = sample.input) {
  const analyzer = analyzePianoInput(input);
  const plan = composePianoPlan(input, analyzer);
  const score = composePianoScore(input, plan, sample.piano, projectEndTick(sample.project), 'classic');
  return { analyzer, plan, score };
}

const SCORE_FIGURE_TECHNIQUES = new Set<PianoScore['events'][number]['techniqueIntent']>([
  'alberti-bass-accompaniment', 'walking-bass-line', 'rhythmic-ostinato',
]);

function scoreFigureEvents(score: PianoScore) {
  return score.events.filter((event) => SCORE_FIGURE_TECHNIQUES.has(event.techniqueIntent));
}

function assertScoreContract(sample: ReturnType<typeof productionSample>, score: PianoScore) {
  const endTick = projectEndTick(sample.project);
  expect(score.events.every((event) => Number.isInteger(event.pitch)
    && event.pitch >= sample.piano.lowestNote && event.pitch <= sample.piano.highestNote)).toBe(true);
  expect(score.events.every((event) => Number.isInteger(event.startTick)
    && event.startTick >= 0 && event.startTick < endTick
    && Number.isInteger(event.durationTicks) && event.durationTicks > 0
    && event.startTick + event.durationTicks <= endTick)).toBe(true);
  expect(score.events.every((event) => Number.isInteger(event.dynamicIntent.velocity)
    && event.dynamicIntent.velocity >= 1 && event.dynamicIntent.velocity <= 127)).toBe(true);

  for (const event of score.events) {
    if ((event.voiceId !== 'lh.bass' && event.voiceId !== 'lh.support' && event.voiceId !== 'rh.inner')
      || event.techniqueIntent === 'prepared-suspension'
      || event.techniqueIntent === 'stepwise-resolution') continue;
    expect(event.harmonicContext.pitchClasses, `${event.voiceId} at ${event.startTick}`)
      .toContain(event.pitch % 12);
  }
  expect(validatePianoScorePlayability(score, {
    lowestNote: sample.piano.lowestNote,
    highestNote: sample.piano.highestNote,
  }).violations).toEqual([]);
}

function activeNotesInWindow(score: PianoScore, startTick: number, endTick: number) {
  return score.events.filter((event) => event.startTick < endTick
    && event.startTick + event.durationTicks > startTick);
}

/** Production score entry point plus its ephemeral diagnostics sidecar. */
function writeComposition(sample: ReturnType<typeof productionSample>, input = sample.input) {
  const plan = composePianoPlan(input, analyzePianoInput(input));
  if (!isInstrumentTrack(sample.piano)) throw new Error('The sample needs an instrument Piano track.');
  const { score, diagnostics } = composePianoScoreWithDiagnostics(input, plan, sample.piano, projectEndTick(sample.project), 'classic');
  if (!diagnostics) throw new Error('The production composer returned no diagnostics.');
  // The diagnostics-bearing entry point and composePianoScore are the same production writer.
  expect(JSON.stringify(composePianoScore(input, plan, sample.piano, projectEndTick(sample.project), 'classic')))
    .toBe(JSON.stringify(score));
  return { plan, score, diagnostics };
}

const themeOf = (score: PianoScore) => score.events
  .filter((event) => event.musicalRole === 'melody' && event.techniqueIntent !== 'cascading-gesture')
  .sort((a, b) => a.startTick - b.startTick);
/** Musical content of events, independent of their generated ids. */
const signature = (events: readonly PianoScore['events'][number][]) => [...events]
  .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)
  .map((event) => `${event.startTick}:${event.pitch}:${event.durationTicks}:${event.voiceId}:${event.dynamicIntent.velocity}`);
const leftOf = (score: PianoScore) => score.events.filter((event) => event.hand === 'left');

describe('Piano Stage 4A contextual accompaniment from finalized tracks', () => {
  it('uses the production Compose All snapshot and records exact chord-window activity without inferring a lead', () => {
    const sample = productionSample();
    expect(sample.input.analysis.tracks.length).toBeGreaterThan(0);
    expect(sample.input.analysis.tracks.some((track) => track.notes.length > 0)).toBe(true);

    const { plan, score } = writeScore(sample);
    expect(plan.status).toBe('composed');
    expect(plan.harmonicEvents.length).toBeGreaterThan(0);
    expect(plan.harmonicEvents.every((event) => event.orchestration.accompanimentActivity?.availability === 'available')).toBe(true);
    expect(plan.harmonicEvents.every((event) => event.orchestration.accompanimentActivity?.source === 'resolved-chord-overlap')).toBe(true);
    expect(plan.harmonicEvents.every((event) => event.orchestration.explicitLeadTrackIds.length === 0
      || event.orchestration.explicitLeadTrackIds.every((id) => sample.input.analysis.tracks.some((track) => track.id === id)))).toBe(true);
    assertScoreContract(sample, score);
  });

  it('production contract — lead adaptation: an explicit lead changes the Piano theme\'s role and register without suppressing the composition', () => {
    const sample = productionSample('ensemble.chamber');
    const bars = sample.input.context.barWindows;
    const barOf = (tick: number) => bars.find((bar) => tick >= bar.startTick && tick < bar.endTick)!.bar;
    const alone = writeComposition(sample, controlledInput(sample.input, []));
    const liveBars = alone.diagnostics.bars.filter((bar) => bar.independent.attacks > 0).map((bar) => bar.bar);

    // (1) A lead well above the Piano theme: the theme stays, as a quieter answering voice.
    // A lead line that moves in quarter notes, so that it has attacks the Piano can answer between.
    const quarterLead = (pitch: number): Note[] => bars.flatMap((bar) => Array.from(
      { length: Math.floor((bar.endTick - bar.startTick) / PPQ) },
      (_, beat) => ({ pitch, startTick: bar.startTick + beat * PPQ, durationTicks: PPQ - 60, velocity: 78 }),
    ));
    const highLead = makeTrack('annotated-violins1', 'violins1', quarterLead(93));
    const high = writeComposition(sample, controlledInput(sample.input, [highLead], { leadTrackId: highLead.id }));
    expect(high.plan.harmonicEvents.every((event) => event.orchestration.explicitLeadTrackIds.includes(highLead.id))).toBe(true);
    // The lead never rewrites what the Piano composed on its own.
    expect(JSON.stringify(high.diagnostics.theme)).toBe(JSON.stringify(alone.diagnostics.theme));
    expect(JSON.stringify(high.diagnostics.independentDraft)).toBe(JSON.stringify(alone.diagnostics.independentDraft));
    const aloneTheme = themeOf(alone.score);
    const highTheme = themeOf(high.score);
    // Not suppressed: every phrase that carries the theme alone still carries it under the lead ...
    for (const phrase of alone.diagnostics.phrases.filter((entry) => entry.melodyEvents.independent > 0)) {
      const own = aloneTheme.filter((event) => event.phraseId === phrase.phraseId);
      const led = highTheme.filter((event) => event.phraseId === phrase.phraseId);
      expect(led.length, `${phrase.phraseId} keeps theme material under the lead`).toBeGreaterThan(0);
      // ... and the theme still enters in the phrase's first bar (a prepared suspension may hold
      // the downbeat itself).
      const firstBar = bars.find((bar) => bar.bar === phrase.startBar)!;
      if (own.length && own[0].startTick < firstBar.endTick) {
        expect(led[0].startTick, `${phrase.phraseId} theme enters in its first bar`).toBeLessThan(firstBar.endTick);
      }
    }
    // Role change: the adapted theme is a subset of the Piano's own theme attacks (nothing is
    // stacked on top), the notes it gives up are ones struck together with a lead attack, and
    // what remains is tagged and voiced as an answer, quieter than the same note played alone.
    // (The reference is the independent draft's theme, before any suspension is laid over it.)
    const ownVelocityAt = new Map<number, number>();
    for (const note of alone.diagnostics.independentDraft.notes.filter((entry) => entry.l === 'melody')) {
      ownVelocityAt.set(note.t, Math.max(ownVelocityAt.get(note.t) ?? 0, note.v));
    }
    expect(highTheme.every((event) => ownVelocityAt.has(event.startTick))).toBe(true);
    const highTicks = new Set(highTheme.map((event) => event.startTick));
    const givenUp = aloneTheme.filter((event) => !highTicks.has(event.startTick)
      && !high.score.events.some((other) => other.voiceId === 'rh.suspension'
        && other.startTick <= event.startTick + event.durationTicks && other.startTick + other.durationTicks > event.startTick));
    expect(givenUp.length).toBeGreaterThan(0);
    for (const event of givenUp) {
      expect(highLead.notes.some((note) => Math.abs(note.startTick - event.startTick) < PPQ / 2),
        `theme note at ${event.startTick} yields only where the lead attacks`).toBe(true);
    }
    const ledBars = new Set(high.diagnostics.adaptation.records.filter((record) => record.kind === 'accompany-lead')
      .map((record) => record.bar));
    const answering = highTheme.filter((event) => event.hand === 'right' && ledBars.has(barOf(event.startTick)));
    expect(answering.length).toBeGreaterThan(0);
    expect(answering.every((event) => event.noteRoleTag === 'answer')).toBe(true);
    expect(answering.every((event) => event.dynamicIntent.velocity < ownVelocityAt.get(event.startTick)!)).toBe(true);
    // The accompaniment is not withdrawn: every sounding bar keeps a left-hand bass and both hands.
    for (const bar of liveBars) {
      const inBar = high.score.events.filter((event) => barOf(event.startTick) === bar);
      expect(inBar.some((event) => event.voiceId === 'lh.bass'), `bar ${bar} keeps its bass under the lead`).toBe(true);
      expect(inBar.some((event) => event.hand === 'right'), `bar ${bar} keeps its right hand under the lead`).toBe(true);
    }

    // (2) A lead inside the Piano theme's own register: the theme moves an octave away from it.
    const centre = Math.round(aloneTheme.filter((event) => event.hand === 'right')
      .reduce((sum, event) => sum + event.pitch, 0) / aloneTheme.filter((event) => event.hand === 'right').length);
    const nearLead = makeTrack('annotated-violins1', 'violins1', quarterLead(centre));
    const near = writeComposition(sample, controlledInput(sample.input, [nearLead], { leadTrackId: nearLead.id }));
    expect(JSON.stringify(near.diagnostics.independentDraft)).toBe(JSON.stringify(alone.diagnostics.independentDraft));
    const shifted = near.diagnostics.adaptation.records.filter((record) => record.kind === 'register-shift');
    expect(shifted.length, 'a lead in the theme register causes a register decision').toBeGreaterThan(0);
    const shiftedBars = new Set(shifted.map((record) => record.bar));
    const mean = (events: readonly PianoScore['events'][number][]) => events.reduce((sum, event) => sum + event.pitch, 0) / events.length;
    const inShifted = (score: PianoScore) => themeOf(score).filter((event) => event.hand === 'right' && shiftedBars.has(barOf(event.startTick)));
    expect(inShifted(near.score).length).toBeGreaterThan(0);
    const displacement = Math.abs(mean(inShifted(near.score)) - mean(inShifted(alone.score)));
    expect(displacement, 'the theme is displaced by roughly an octave').toBeGreaterThanOrEqual(7);
    expect(Math.abs(mean(inShifted(near.score)) - centre)).toBeGreaterThan(Math.abs(mean(inShifted(alone.score)) - centre));

    // (3) Never note-for-note doubling: a theme note does not sound the lead's pitch class while the
    // lead holds it, unless the chord offers no alternative tone.
    for (const [lead, led] of [[highLead, high], [nearLead, near]] as const) {
      for (const event of themeOf(led.score).filter((candidate) => candidate.hand === 'right')) {
        const doubled = lead.notes.some((note) => note.startTick <= event.startTick
          && note.startTick + note.durationTicks > event.startTick && note.pitch % 12 === event.pitch % 12);
        if (doubled) expect(event.harmonicContext.pitchClasses.filter((tone) => tone !== event.pitch % 12).length).toBe(0);
      }
      assertScoreContract(sample, led.score);
    }
  });

  it('production contract — bass adaptation: a busy written bass simplifies the left-hand pattern without removing the Piano bass or touching the theme', () => {
    const sample = productionSample('ensemble.sonata', 11);
    const bars = sample.input.context.barWindows;
    const barOf = (tick: number) => bars.find((bar) => tick >= bar.startTick && tick < bar.endTick)!.bar;
    const open = writeComposition(sample, controlledInput(sample.input, [emptyTrack()]));

    // A sustained bass foundation (one long note per bar) is recognised by the plan ...
    const heldBass = makeTrack('written-basses', 'basses', notesAcrossBars(sample.input, 43));
    const held = writeComposition(sample, controlledInput(sample.input, [heldBass]));
    expect(open.plan.harmonicEvents[0].orchestration.accompanimentActivity)
      .toMatchObject({ availability: 'available', bassFoundationTrackIds: [] });
    expect(held.plan.harmonicEvents[0].orchestration.accompanimentActivity?.bassFoundationTrackIds).toContain(heldBass.id);
    // ... but a merely present bass instrument does not change what the Piano's left hand plays.
    expect(signature(leftOf(held.score))).toEqual(signature(leftOf(open.score)));
    expect(held.diagnostics.adaptation.records.filter((record) => record.kind === 'left-hand-simplified')).toEqual([]);

    // A busy bass line (running eighth notes in the low register) is different evidence.
    const running: Note[] = bars.flatMap((bar) => Array.from({ length: 8 }, (_, index) => ({
      pitch: 36 + [0, 2, 3, 5, 7, 5, 3, 2][index],
      startTick: bar.startTick + index * (PPQ / 2),
      durationTicks: PPQ / 2 - 20,
      velocity: 80,
    }))).filter((note) => note.startTick < projectEndTick(sample.project));
    const busyBass = makeTrack('running-basses', 'basses', running);
    const busy = writeComposition(sample, controlledInput(sample.input, [busyBass]));
    expect(JSON.stringify(busy.diagnostics.independentDraft)).toBe(JSON.stringify(open.diagnostics.independentDraft));

    const simplified = new Set(busy.diagnostics.adaptation.records
      .filter((record) => record.kind === 'left-hand-simplified').map((record) => record.bar));
    expect(simplified.size, 'the fixture has flowing left-hand bars for the busy bass to act on').toBeGreaterThan(0);
    const leftIn = (score: PianoScore, bar: number) => leftOf(score).filter((event) => barOf(event.startTick) === bar
      && event.musicalRole !== 'melody');
    for (const diagnosticBar of open.diagnostics.bars) {
      const bar = diagnosticBar.bar;
      const before = leftIn(open.score, bar);
      const after = leftIn(busy.score, bar);
      if (simplified.has(bar)) {
        // Appropriately changed: fewer left-hand attacks, on a broader rhythmic grid ...
        const attacks = (events: typeof before) => new Set(events.map((event) => event.startTick)).size;
        expect(attacks(after), `bar ${bar} left hand is thinner under the busy bass`).toBeLessThan(attacks(before));
        const offBeats = (events: typeof before) => events.filter((event) => event.startTick % PPQ !== 0).length;
        expect(offBeats(after)).toBeLessThanOrEqual(offBeats(before));
        // ... but not eliminated: the bar keeps its downbeat bass on the same harmony, and motion above it.
        const downbeat = (events: typeof before) => events.find((event) => event.voiceId === 'lh.bass'
          && event.startTick === bars.find((entry) => entry.bar === bar)!.startTick);
        expect(downbeat(after), `bar ${bar} keeps its downbeat bass`).toBeDefined();
        expect(downbeat(after)!.pitch % 12).toBe(downbeat(before)!.pitch % 12);
        expect(attacks(after), `bar ${bar} left hand still moves`).toBeGreaterThan(1);
      } else {
        // Bars the evidence does not reach keep the independent left hand note for note.
        expect(signature(after), `bar ${bar} left hand is untouched`).toEqual(signature(before));
      }
      // The Piano's contribution survives everywhere it existed.
      if (diagnosticBar.adapted.attacks > 0) {
        expect(busy.diagnostics.bars.find((entry) => entry.bar === bar)!.adapted.attacks).toBeGreaterThan(0);
      }
    }
    // The theme is not part of the bass conversation: it is identical with and without the busy bass.
    expect(signature(themeOf(busy.score).filter((event) => event.hand === 'right')))
      .toEqual(signature(themeOf(open.score).filter((event) => event.hand === 'right')));
    // Adaptation thins; it never stacks.
    expect(busy.score.events.length).toBeLessThan(open.score.events.length);
    assertScoreContract(sample, busy.score);
    assertScoreContract(sample, held.score);
  });

  it('treats sustained upper-register occupancy as crowded without turning it into a lead annotation', () => {
    const sample = productionSample('ensemble.chamber');
    const pitches = [72, 74, 76, 77, 79, 81, 83, 84];
    const notes = sample.input.context.barWindows.flatMap((bar) => pitches.map((pitch) => ({
      pitch,
      startTick: bar.startTick + 60,
      durationTicks: Math.max(1, bar.endTick - bar.startTick - 120),
      velocity: 76,
    })));
    const line = makeTrack('busy-violins2', 'violins2', notes);
    const input = controlledInput(sample.input, [line]);
    const crowded = writeScore(sample, input);

    expect(crowded.analyzer.interpretations.leadPassages.candidates).toEqual([]);
    expect(crowded.plan.harmonicEvents[0].orchestration.explicitLeadTrackIds).toEqual([]);
    expect(crowded.plan.harmonicEvents[0].orchestration.accompanimentActivity?.midUpperActivityTrackIds)
      .toContain(line.id);
    expect(crowded.plan.harmonicEvents[0].orchestration.accompanimentActivity?.activeNotesPerBar.pianoUpper)
      .toBeGreaterThanOrEqual(8);
    expect(crowded.plan.phrases.length).toBeGreaterThan(0);
    expect(crowded.plan.phrases.every((phrase) => phrase.texture.kind === 'sparse-sustained')).toBe(true);
    expect(crowded.score.events.length).toBeLessThanOrEqual(writeScore(sample, controlledInput(sample.input, [emptyTrack()])).score.events.length);
    assertScoreContract(sample, crowded.score);
  });

  it('yields at an explicit non-Piano spotlight without generating a counterline or a gap response', () => {
    const sample = productionSample('ensemble.chamber');
    const window = sample.input.context.barWindows[0];
    if (!window) throw new Error('The production fixture needs a source bar.');
    const solo = makeTrack('solo-viola', 'violas', notesAcrossBars(sample.input, 67));
    const moment: PianoRelevantMoment = {
      kind: 'soli',
      startBar: window.bar,
      endBar: window.bar,
      startTick: window.startTick,
      endTick: window.endTick,
      participantRoles: ['violas'],
    };
    const input = controlledInput(sample.input, [solo], { moments: [moment] });
    const { plan, score } = writeScore(sample, input);
    const momentEvents = plan.harmonicEvents.filter((event) =>
      event.chord.startTick < moment.endTick && moment.startTick < event.chord.endTick);
    const momentScore = activeNotesInWindow(score, moment.startTick, moment.endTick);

    expect(momentEvents.length).toBeGreaterThan(0);
    expect(momentEvents.every((event) => event.orchestration.interaction === 'yield-to-spotlight')).toBe(true);
    expect(momentScore.some((event) => event.techniqueIntent === 'independent-counterline')).toBe(false);
    expect(momentScore.some((event) => ['alberti-bass-accompaniment', 'walking-bass-line', 'rhythmic-ostinato']
      .includes(event.techniqueIntent))).toBe(false);
    assertScoreContract(sample, score);
  });

  it('production contract — standalone composition: Compose All with no other instrument writes a developed theme over a harmonically led accompaniment', () => {
    // The real Compose All path on a project whose only instrument track is the Piano.
    const project = projectFromFixture(JSON.parse(JSON.stringify(dorian)) as Project);
    project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
    project.orchestration = { take: 0 };
    project.tracks = project.tracks.filter((track) => !isInstrumentTrack(track) || track.role === 'piano');
    const result = composeAllTracks(project, { seed: 11, density: 0.85, pianoComposition: 'classic' });
    const score = result.pianoScore;
    const diagnostics = result.pianoDiagnostics!;
    const input = result.pianoEngineInput;
    const pianoTrack = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
    if (!pianoTrack || !isInstrumentTrack(pianoTrack)) throw new Error('Compose All returned no Piano track.');
    const bars = input.context.barWindows;
    const barOf = (tick: number) => bars.find((bar) => tick >= bar.startTick && tick < bar.endTick)!.bar;

    // Unknown stays unknown: there is no orchestral evidence, and the adaptation is a no-op.
    expect(input.analysis.tracks.filter((track) => track.role !== 'piano' && track.notes.length > 0)).toEqual([]);
    expect(diagnostics.adaptation.evidence).toBe('none');
    expect(diagnostics.adaptation.records).toEqual([]);
    expect(diagnostics.adaptedDraft.events).toBe(diagnostics.independentDraft.events);
    // The written track is the composed score (the Realizer only transcribes).
    expect(pianoTrack.notes.length).toBe(score.events.length);

    // A theme: the opening bar's rhythm and contour form a shape that returns later in the piece on
    // different pitches (development), and returns again in the final phrase (reprise).
    const theme = themeOf(score).filter((event) => event.hand === 'right');
    const shapeOf = (bar: number) => {
      const notes = theme.filter((event) => barOf(event.startTick) === bar);
      const start = bars.find((entry) => entry.bar === bar)!.startTick;
      return {
        notes,
        rhythm: notes.map((event) => event.startTick - start).join(','),
        contour: notes.slice(1).map((event, index) => Math.sign(event.pitch - notes[index].pitch)).join(','),
        pitches: notes.map((event) => event.pitch).join(','),
      };
    };
    const statementBar = diagnostics.bars.find((bar) => bar.themeBar === 0 && bar.adapted.melody >= 3)!;
    expect(statementBar).toBeDefined();
    const statement = shapeOf(statementBar.bar);
    const returns = diagnostics.bars.filter((bar) => bar.bar !== statementBar.bar && bar.phraseId !== statementBar.phraseId)
      .map((bar) => ({ bar, shape: shapeOf(bar.bar) }))
      .filter(({ shape }) => shape.rhythm === statement.rhythm && shape.contour === statement.contour);
    expect(returns.length, 'the opening shape returns in a later phrase').toBeGreaterThan(0);
    expect(returns.some(({ shape }) => shape.pitches !== statement.pitches), 'at least one return is transformed').toBe(true);
    const roles = new Map(diagnostics.phrases.map((phrase) => [phrase.phraseId, phrase.role]));
    expect(new Set(returns.map(({ bar }) => roles.get(bar.phraseId))).size).toBeGreaterThan(0);
    expect(new Set(diagnostics.phrases.filter((phrase) => phrase.role !== 'breath').map((phrase) => phrase.themeOperation)).size)
      .toBeGreaterThan(1);
    // The theme breathes: it contains tones of at least a half note as well as moving notes.
    expect(theme.some((event) => event.durationTicks >= 2 * PPQ - 120)).toBe(true);
    expect(theme.some((event) => event.durationTicks <= PPQ)).toBe(true);

    // A meaningful accompaniment: in every sounding bar the left hand states the supplied harmony's
    // bass on the downbeat and both hands play; across the piece the left hand moves in patterns.
    const harmonyAt = (tick: number) => input.context.harmony.find((chord) => chord.startTick <= tick && tick < chord.endTick)!;
    const finalBar = Math.max(...diagnostics.bars.filter((bar) => bar.adapted.attacks > 0).map((bar) => bar.bar));
    let patternedBars = 0;
    for (const diagnosticBar of diagnostics.bars.filter((bar) => bar.adapted.attacks > 0)) {
      const window = bars.find((entry) => entry.bar === diagnosticBar.bar)!;
      const inBar = score.events.filter((event) => barOf(event.startTick) === diagnosticBar.bar);
      const left = inBar.filter((event) => event.hand === 'left');
      const downbeat = left.filter((event) => event.startTick === window.startTick).sort((a, b) => a.pitch - b.pitch)[0];
      expect(downbeat, `bar ${diagnosticBar.bar} has a left-hand downbeat`).toBeDefined();
      const chord = harmonyAt(window.startTick);
      expect(downbeat.pitch % 12, `bar ${diagnosticBar.bar} bass states the harmony`).toBe(((chord.parsed.bass ?? chord.parsed.root) % 12 + 12) % 12);
      expect(inBar.some((event) => event.hand === 'right'), `bar ${diagnosticBar.bar} right hand`).toBe(true);
      // Every accompaniment tone belongs to the chord sounding at its attack.
      for (const event of inBar.filter((candidate) => candidate.musicalRole !== 'melody' && candidate.musicalRole !== 'suspension')) {
        expect(harmonyAt(event.startTick).parsed.pitchClasses.map((tone) => ((tone % 12) + 12) % 12)
          .concat(((harmonyAt(event.startTick).parsed.bass ?? harmonyAt(event.startTick).parsed.root) % 12 + 12) % 12))
          .toContain(event.pitch % 12);
      }
      if (diagnosticBar.bar !== finalBar && new Set(left.map((event) => event.startTick)).size >= 3
        && new Set(left.map((event) => event.pitch)).size >= 3) patternedBars++;
    }
    const soundingBars = diagnostics.bars.filter((bar) => bar.adapted.attacks > 0).length;
    expect(patternedBars * 2, 'most sounding bars carry a moving left-hand pattern of three or more tones')
      .toBeGreaterThan(soundingBars);
    // The piece closes on a real chord: at least four notes struck together on the final harmony.
    const landing = score.events.filter((event) => event.gestureIntent === 'cadential-landing');
    expect(new Set(landing.map((event) => event.pitch)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(landing.map((event) => event.startTick)).size).toBe(1);
    expect(validatePianoScorePlayability(score, { lowestNote: pianoTrack.lowestNote, highestNote: pianoTrack.highestNote }).violations)
      .toEqual([]);

    // With no harmony there is nothing to compose from, and nothing is invented.
    const sample = productionSample('ensemble.chamber');
    const noHarmony = writeScore(sample, controlledInput(sample.input, [], { harmony: [] }));
    expect(noHarmony.plan.harmonicEvents).toEqual([]);
    expect(noHarmony.score.events).toEqual([]);
  });

  it('re-establishes accompaniment texture at each section and never requires an event quota', () => {
    const sample = productionSample('ensemble.sonata');
    const input = controlledInput(sample.input, [emptyTrack()]);
    const { plan, score } = writeScore(sample, input);
    const sectionsWithPhrases = plan.sectionIntentions.filter((section) => section.textureProgression.length > 0);

    expect(sectionsWithPhrases.length).toBeGreaterThan(1);
    expect(sectionsWithPhrases.every((section) => section.textureProgression[0].transitionFromPrevious === null
      && section.textureProgression[0].transition === 'establish')).toBe(true);
    expect(score.events.every((event) => event.sectionId === null
      || input.context.sections.some((section) => section.id === event.sectionId))).toBe(true);
    assertScoreContract(sample, score);
  });

  it('keeps template-specific vocabulary gates and seed-stable score events across Compose All templates', () => {
    const templates = [
      ['ensemble.cinematic', 'cinematic-expanse'],
      ['ensemble.hybridstudio', 'hybrid-pulse-and-color'],
      ['ensemble.vocalbacking', 'vocal-space'],
      ['ensemble.chamber', 'chamber-counterpoint'],
      ['ensemble.sonata', 'sonata-dialogue'],
    ] as const;
    for (const [templateId, identity] of templates) {
      const sample = productionSample(templateId, 11);
      const input = controlledInput(sample.input, [emptyTrack()]);
      const first = writeScore(sample, input);
      const again = writeScore(sample, input);
      expect(first.plan.template.style.identity).toBe(identity);
      expect(first.plan.status).toBe('composed');
      expect(first.score.events.length).toBeGreaterThan(0);
      expect(again.score.events).toEqual(first.score.events);
      assertScoreContract(sample, first.score);
      if (templateId === 'ensemble.cinematic' || templateId === 'ensemble.vocalbacking') {
        expect(scoreFigureEvents(first.score)).toEqual([]);
      }
    }

    const sample = productionSample('ensemble.chamber', 11);
    const baseInput = controlledInput(sample.input, [emptyTrack()]);
    const seedA = 11;
    const seedB = 29;
    const withSeed = (input: PianoEngineInput, seed: number): PianoEngineInput => ({
      ...input,
      context: {
        ...input.context,
        seed,
        generationIdentity: { ...input.context.generationIdentity, seed, userSeed: seed },
      },
    });
    const firstSeed = writeScore(sample, withSeed(baseInput, seedA));
    const repeatedSeed = writeScore(sample, withSeed(baseInput, seedA));
    const otherSeed = writeScore(sample, withSeed(baseInput, seedB));
    expect(firstSeed.plan.generationIdentity.seed).toBe(seedA);
    expect(otherSeed.plan.generationIdentity.seed).toBe(seedB);
    expect(repeatedSeed.score.events).toEqual(firstSeed.score.events);
    expect(otherSeed.score.events.every((event) => event.startTick + event.durationTicks <= projectEndTick(sample.project))).toBe(true);
    assertScoreContract(sample, otherSeed.score);
  });
});
