import { describe, expect, it } from 'vitest';
import dorian from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScoreWithDiagnostics } from '../src/orchestrator/keys/piano-composer';
import { validatePianoScorePlayability } from '../src/orchestrator/keys/piano-playability';
import { isInstrumentTrack, projectFromFixture, type Project } from '../src/shared/schema';
import { projectEndTick } from '../src/shared/schema/meter';
import { PPQ } from '../src/shared/schema/types';

/**
 * Texture-and-Theme Composer regression tests. Every case runs the ordinary
 * production Compose All path on an unmodified fixture; nothing forces a plan,
 * a texture, or a context.
 */
const TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.cinematic', 'ensemble.hybridstudio'] as const;
const FIXTURES = { dorian, threeChorus } as const;

function compose(
  templateId: string,
  fixture: keyof typeof FIXTURES,
  options: { seed?: number; density?: number; standalone?: boolean } = {},
) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(FIXTURES[fixture])) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: 0 };
  if (options.standalone) {
    project.tracks = project.tracks.filter((track) => !isInstrumentTrack(track) || track.role === 'piano');
  }
  const result = composeAllTracks(project, { seed: options.seed ?? 0, density: options.density ?? 1 });
  const piano = result.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
  return { project, result, piano, score: result.pianoScore, diagnostics: result.pianoDiagnostics };
}

const attacksPerBar = (ticks: readonly number[], bars: number) => new Set(ticks).size / bars;

describe('Piano Texture-and-Theme Composer (production Compose All)', () => {
  it('plans a section arc with roles and texture levels that the written score follows', () => {
    for (const templateId of TEMPLATES) {
      const { diagnostics } = compose(templateId, 'threeChorus');
      expect(diagnostics, templateId).not.toBeNull();
      const roles = new Set(diagnostics!.phrases.map((phrase) => phrase.role));
      expect(roles.has('statement'), `${templateId} states the theme`).toBe(true);
      expect(roles.has('climax'), `${templateId} has a formal high point`).toBe(true);
      expect(roles.has('arrival'), `${templateId} arrives`).toBe(true);
      expect(new Set(diagnostics!.bars.map((bar) => bar.independentLevel)).size, `${templateId} texture levels`).toBeGreaterThan(1);
      // The plan drives the notes: bars planned at a higher texture level carry more attacks.
      const mean = (level: number) => {
        const bars = diagnostics!.bars.filter((bar) => bar.independentLevel === level && bar.independent.attacks > 0);
        return bars.length ? bars.reduce((sum, bar) => sum + bar.independent.attacks, 0) / bars.length : null;
      };
      const levels = [0, 1, 2, 3].map(mean).filter((value): value is number => value !== null);
      expect(levels.length).toBeGreaterThan(1);
      expect(levels[levels.length - 1], `${templateId} highest level is busier than the lowest`).toBeGreaterThan(levels[0]);
      // The climax phrase is at least as loud as the opening statement.
      const velocityOf = (role: string) => {
        const phraseIds = new Set(diagnostics!.phrases.filter((phrase) => phrase.role === role).map((phrase) => phrase.phraseId));
        const barsOf = new Set(diagnostics!.bars.filter((bar) => phraseIds.has(bar.phraseId)).map((bar) => bar.bar));
        const notes = diagnostics!.independentDraft.notes.filter((note) => barsOf.has(Math.floor(note.t / (4 * PPQ)) + 1));
        return Math.max(...notes.map((note) => note.v));
      };
      expect(velocityOf('climax')).toBeGreaterThan(velocityOf('statement'));
    }
  });

  it('writes a genuine multi-bar theme and develops it by role across the form', () => {
    for (const templateId of TEMPLATES) {
      const { diagnostics, score } = compose(templateId, 'threeChorus', { standalone: true });
      const theme = diagnostics!.theme!;
      expect(theme.bars.length).toBe(4);
      expect(theme.eventCount).toBeGreaterThanOrEqual(6);
      const steps = theme.bars.flat().map((note) => note.step);
      expect(Math.max(...steps) - Math.min(...steps)).toBeGreaterThanOrEqual(3);
      expect(steps.some((step, index) => index > 0 && step > steps[index - 1])).toBe(true);
      expect(steps.some((step, index) => index > 0 && step < steps[index - 1])).toBe(true);
      expect(new Set(theme.bars.flat().map((note) => note.dur)).size).toBeGreaterThan(1);
      // It ends on a long cadence tone: room to breathe.
      const last = theme.bars[3][theme.bars[3].length - 1];
      expect(last.dur).toBeGreaterThanOrEqual(4);
      const operations = new Set(diagnostics!.phrases.map((phrase) => phrase.themeOperation));
      operations.delete('rest');
      expect(operations.size, `${templateId} development operations`).toBeGreaterThanOrEqual(3);
      expect(score.events.some((event) => event.techniqueIntent === 'theme-statement')).toBe(true);
      expect(score.events.some((event) => event.techniqueIntent === 'theme-development')).toBe(true);
    }
  });

  it('gives each template its own bar-level pattern vocabulary and real right-hand chords', () => {
    const techniques = (templateId: string) => {
      const { score } = compose(templateId, 'threeChorus', { standalone: true });
      return { score, set: new Set(score.events.map((event) => event.techniqueIntent)) };
    };
    const chamber = techniques('ensemble.chamber');
    expect(chamber.set.has('alberti-bass-accompaniment') || chamber.set.has('rolling-arpeggio-accompaniment')).toBe(true);
    expect(chamber.set.has('flowing-inner-voice')).toBe(true);
    const sonata = techniques('ensemble.sonata');
    expect(sonata.set.has('independent-counterline'), 'Sonata gives the theme to the left hand for contrast').toBe(true);
    expect(sonata.set.has('alberti-bass-accompaniment') || sonata.set.has('broken-tenth-accompaniment')
      || sonata.set.has('walking-bass-line')).toBe(true);
    const cinematic = techniques('ensemble.cinematic');
    expect(cinematic.set.has('rolling-arpeggio-accompaniment') || cinematic.set.has('broken-tenth-accompaniment')).toBe(true);
    expect(cinematic.set.has('block-chord')).toBe(true);
    const hybrid = techniques('ensemble.hybridstudio');
    expect(hybrid.set.has('rhythmic-ostinato')).toBe(true);
    expect(hybrid.set.has('syncopated-pulse-accompaniment')).toBe(true);
    const vocal = techniques('ensemble.vocalbacking');
    expect(vocal.set.has('rhythmic-ostinato')).toBe(false);
    expect(vocal.set.has('cascading-gesture')).toBe(false);

    // Block chords are chords: at least three right-hand notes struck together.
    const blockTicks = new Map<number, number>();
    for (const event of cinematic.score.events) {
      if (event.hand !== 'right') continue;
      blockTicks.set(event.startTick, (blockTicks.get(event.startTick) ?? 0) + 1);
    }
    const blockStarts = new Set(cinematic.score.events.filter((event) => event.techniqueIntent === 'block-chord')
      .map((event) => event.startTick));
    expect([...blockStarts].some((tick) => (blockTicks.get(tick) ?? 0) >= 3)).toBe(true);

    // The left hand is a pattern, not a static root-and-fifth pair.
    for (const sample of [chamber, sonata, cinematic, hybrid]) {
      const left = sample.score.events.filter((event) => event.hand === 'left');
      const offBeat = left.filter((event) => event.startTick % PPQ !== 0);
      expect(offBeat.length).toBeGreaterThan(0);
      expect(new Set(left.map((event) => event.pitch % 12)).size).toBeGreaterThan(3);
    }
    // Vocal Backing stays below the other templates' activity.
    const bars = 40;
    const perBar = (score: typeof vocal.score) => attacksPerBar(score.events.map((event) => event.startTick), bars);
    expect(perBar(vocal.score)).toBeLessThan(perBar(sonata.score));
    expect(perBar(vocal.score)).toBeLessThan(perBar(cinematic.score));
  });

  it('lets density change the composition, not multiply notes', () => {
    for (const templateId of TEMPLATES) {
      const low = compose(templateId, 'threeChorus', { density: 0.3 });
      const medium = compose(templateId, 'threeChorus', { density: 0.6 });
      const high = compose(templateId, 'threeChorus', { density: 1 });
      const maxLevel = (sample: typeof low) => Math.max(...sample.diagnostics!.bars.map((bar) => bar.independentLevel));
      expect(maxLevel(low)).toBeLessThanOrEqual(1);
      expect(maxLevel(medium)).toBeLessThanOrEqual(2);
      expect(maxLevel(high)).toBeGreaterThanOrEqual(maxLevel(medium));
      const count = (sample: typeof low) => sample.diagnostics!.independentDraft.events;
      expect(count(low)).toBeLessThan(count(medium));
      expect(count(medium)).toBeLessThanOrEqual(count(high));
      // The theme itself is the same theme at every density.
      expect(JSON.stringify(low.diagnostics!.theme)).toBe(JSON.stringify(high.diagnostics!.theme));
      for (const sample of [low, medium, high]) {
        expect(sample.result.pianoPlayability.violations, `${templateId} playability`).toEqual([]);
      }
    }
  });

  it('keeps the independent composition identical when the orchestra changes, and adapts without stacking', () => {
    for (const templateId of TEMPLATES) {
      const full = compose(templateId, 'dorian', { seed: 11 });
      // Same project context, different arrangement: every finalized non-Piano track removed.
      const input = full.result.pianoEngineInput;
      const aloneInput = { ...input, analysis: { ...input.analysis, tracks: [] } };
      const alonePlan = composePianoPlan(aloneInput, analyzePianoInput(aloneInput));
      const target = full.project.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano');
      if (!target || !isInstrumentTrack(target)) throw new Error('fixture needs a Piano track');
      const alone = composePianoScoreWithDiagnostics(aloneInput, alonePlan, target, projectEndTick(full.project));
      expect(JSON.stringify(full.diagnostics!.theme), `${templateId} theme`).toBe(JSON.stringify(alone.diagnostics!.theme));
      expect(JSON.stringify(full.diagnostics!.independentDraft), `${templateId} independent draft`)
        .toBe(JSON.stringify(alone.diagnostics!.independentDraft));
      expect(full.diagnostics!.phrases.map((phrase) => `${phrase.role}:${phrase.themeOperation}`))
        .toEqual(alone.diagnostics!.phrases.map((phrase) => `${phrase.role}:${phrase.themeOperation}`));
      // Missing evidence is a no-op.
      expect(alone.diagnostics!.adaptation.evidence).toBe('none');
      expect(alone.diagnostics!.adaptation.records).toEqual([]);
      expect(alone.diagnostics!.adaptedDraft.events).toBe(alone.diagnostics!.independentDraft.events);
      // Adaptation transforms or thins; it never adds weight on top of the independent draft.
      expect(full.diagnostics!.adaptedDraft.events).toBeLessThanOrEqual(full.diagnostics!.independentDraft.events);
      expect(full.diagnostics!.adaptation.records.every((record) => record.reason.length > 0 && record.evidence.length > 0)).toBe(true);
      // The theme is never withheld from a whole sounding phrase.
      for (const phrase of full.diagnostics!.phrases) {
        if (phrase.melodyEvents.independent > 0) {
          expect(phrase.melodyEvents.adapted, `${templateId} ${phrase.phraseId} keeps theme material`).toBeGreaterThan(0);
        }
      }
      // A bass instrument does not switch the Piano's left hand off.
      for (const bar of full.diagnostics!.bars) {
        if (bar.independent.bass > 0) expect(bar.adapted.bass, `${templateId} bar ${bar.bar} bass`).toBeGreaterThan(0);
      }
    }
  });

  it('confines a conductor moment to its own bars', () => {
    const { diagnostics, result } = compose('ensemble.cinematic', 'dorian');
    const moments = result.pianoEngineInput.context.moments;
    expect(moments.length).toBeGreaterThan(0);
    const momentBars = new Set<number>();
    for (const bar of result.pianoEngineInput.context.barWindows) {
      if (moments.some((moment) => moment.startTick < bar.endTick && moment.endTick > bar.startTick)) momentBars.add(bar.bar);
    }
    const momentRecords = diagnostics!.adaptation.records.filter((record) => record.kind === 'moment-yield' || record.kind === 'moment-support');
    expect(momentRecords.length).toBeGreaterThan(0);
    expect(momentRecords.every((record) => momentBars.has(record.bar))).toBe(true);
    // The Piano still plays inside the moment.
    for (const bar of diagnostics!.bars.filter((entry) => momentBars.has(entry.bar))) {
      expect(bar.adapted.attacks).toBeGreaterThan(0);
    }
  });

  it('respects near-silence, range, playability and the Realizer contract on every template and fixture', () => {
    for (const fixture of ['dorian', 'threeChorus'] as const) {
      for (const templateId of TEMPLATES) {
        for (const seed of [0, 29]) {
          const { result, score, piano, diagnostics } = compose(templateId, fixture, { seed });
          const context = result.pianoEngineInput.context;
          const silentBars = context.barWindows.filter((bar) => context.energy.find((entry) => entry.bar === bar.bar)?.nearSilence);
          for (const bar of silentBars) {
            const attacks = score.events.filter((event) => event.startTick >= bar.startTick && event.startTick < bar.endTick
              && event.voiceId !== 'rh.suspension');
            expect(attacks, `${templateId} ${fixture} near-silent bar ${bar.bar}`).toEqual([]);
          }
          expect(validatePianoScorePlayability(score, { lowestNote: 21, highestNote: 108 }).violations).toEqual([]);
          expect(Object.isFrozen(score) && Object.isFrozen(score.events)).toBe(true);
          expect(piano && isInstrumentTrack(piano) ? piano.notes.length : 0).toBeGreaterThan(0);
          // The Realizer transcribes: it does not invent notes.
          expect((piano as { notes: unknown[] }).notes.length).toBeLessThanOrEqual(score.events.length);
          expect(diagnostics!.flags.filter((flag) => flag.startsWith('empty-non-rest-phrase'))).toEqual([]);
          expect(Object.keys(result)).not.toContain('pianoDiagnostics');
        }
      }
    }
  });

  it('is deterministic, varies with the seed, and keeps Symphony Piano-free', () => {
    const first = compose('ensemble.sonata', 'threeChorus', { seed: 29 });
    const second = compose('ensemble.sonata', 'threeChorus', { seed: 29 });
    expect(JSON.stringify(second.score)).toBe(JSON.stringify(first.score));
    expect(JSON.stringify(second.diagnostics)).toBe(JSON.stringify(first.diagnostics));
    const themes = new Set([0, 11, 29, 47, 53].map((seed) =>
      JSON.stringify(compose('ensemble.sonata', 'threeChorus', { seed }).diagnostics!.theme)));
    expect(themes.size).toBeGreaterThan(1);
    const symphony = compose('ensemble.symphony', 'dorian');
    expect(symphony.score.events).toEqual([]);
    expect(symphony.diagnostics).toBeNull();
    expect(symphony.piano && isInstrumentTrack(symphony.piano) ? symphony.piano.notes : []).toEqual([]);
  });
  it('writes Alberti, walking-bass and ostinato figures with their defining shapes in ordinary Compose All output', () => {
    const cellsOf = (templateId: string, technique: string, fixture: keyof typeof FIXTURES = 'threeChorus') => {
      const { score, result } = compose(templateId, fixture, { standalone: true });
      const bars = result.pianoEngineInput.context.barWindows;
      return bars.map((bar) => ({
        bar,
        left: score.events.filter((event) => event.hand === 'left' && event.startTick >= bar.startTick && event.startTick < bar.endTick)
          .sort((a, b) => a.startTick - b.startTick),
      })).filter(({ left }) => left.some((event) => event.techniqueIntent === technique));
    };
    // Alberti: low – high – middle – high within each half bar, in eighth notes, all chord tones.
    const alberti = [...cellsOf('ensemble.chamber', 'alberti-bass-accompaniment'), ...cellsOf('ensemble.sonata', 'alberti-bass-accompaniment')];
    expect(alberti.length).toBeGreaterThan(0);
    let albertiCells = 0;
    for (const { bar, left } of alberti) {
      const cell = left.filter((event) => event.startTick < bar.startTick + 2 * PPQ);
      if (cell.length !== 4 || new Set(cell.map((event) => event.harmonicContext.chordIds[0])).size !== 1) continue;
      albertiCells++;
      expect(cell.map((event) => event.startTick - bar.startTick)).toEqual([0, PPQ / 2, PPQ, 3 * PPQ / 2]);
      expect(cell[0].pitch).toBeLessThan(cell[2].pitch);
      expect(cell[2].pitch).toBeLessThan(cell[1].pitch);
      expect(cell[3].pitch).toBe(cell[1].pitch);
      expect(cell.every((event) => event.harmonicContext.pitchClasses.includes(event.pitch % 12))).toBe(true);
    }
    expect(albertiCells).toBeGreaterThan(0);
    // Walking bass: one bass note per beat, always moving, never leaping beyond an octave.
    const walking = cellsOf('ensemble.sonata', 'walking-bass-line');
    expect(walking.length).toBeGreaterThan(0);
    for (const { bar, left } of walking) {
      const line = left.filter((event) => event.voiceId === 'lh.bass');
      expect(line.map((event) => (event.startTick - bar.startTick) % PPQ)).toEqual(line.map(() => 0));
      expect(line.length).toBeGreaterThanOrEqual(2);
      const moves = line.slice(1).map((event, index) => event.pitch - line[index].pitch);
      expect(moves.every((move) => move !== 0 && Math.abs(move) <= 12)).toBe(true);
    }
    // Ostinato: the bass articulates 3 + 3 + 2 eighth notes on one repeated pitch.
    const ostinato = cellsOf('ensemble.hybridstudio', 'rhythmic-ostinato');
    expect(ostinato.length).toBeGreaterThan(0);
    let ostinatoBars = 0;
    for (const { bar, left } of ostinato) {
      const bass = left.filter((event) => event.voiceId === 'lh.bass');
      if (new Set(bass.map((event) => event.harmonicContext.chordIds[0])).size !== 1) continue;
      ostinatoBars++;
      expect(bass.map((event) => event.startTick - bar.startTick)).toEqual([0, 3 * PPQ / 2, 3 * PPQ]);
      expect(new Set(bass.map((event) => event.pitch)).size).toBe(1);
    }
    expect(ostinatoBars).toBeGreaterThan(0);
    // Template identity bounds the vocabulary.
    expect(cellsOf('ensemble.vocalbacking', 'rhythmic-ostinato')).toEqual([]);
    expect(cellsOf('ensemble.vocalbacking', 'walking-bass-line')).toEqual([]);
    expect(cellsOf('ensemble.cinematic', 'alberti-bass-accompaniment')).toEqual([]);
  });

  it('adds octave reinforcement only at a policy-permitted climax, an octave under the theme and softer than it', () => {
    let written = 0;
    for (const templateId of TEMPLATES) {
      for (const fixture of ['dorian', 'threeChorus'] as const) {
        const { score, diagnostics, result } = compose(templateId, fixture);
        const rule = result.pianoEngineInput.context.rules.find((entry) => entry.type === 'octaveDoubling');
        const octaves = score.events.filter((event) => event.voiceId === 'rh.octave');
        if (!rule || rule.type !== 'octaveDoubling' || rule.policy === 'forbidden') {
          expect(octaves, `${templateId} ${fixture} forbids octave doubling`).toEqual([]);
          continue;
        }
        const roleOf = new Map(diagnostics!.phrases.map((phrase) => [phrase.phraseId, phrase.role]));
        for (const octave of octaves) {
          written++;
          const bar = diagnostics!.bars.find((entry) => entry.bar === Math.floor(octave.startTick / (4 * PPQ)) + 1)!;
          expect(roleOf.get(bar.phraseId)).toBe('climax');
          expect(bar.adaptedLevel).toBe(3);
          expect(bar.energy).toBeGreaterThanOrEqual(rule.policy === 'climaxOnly' ? (rule.energyThreshold ?? 1) : 0.72);
          const doubled = score.events.find((event) => event.voiceId === 'rh.melody' && event.startTick === octave.startTick);
          expect(doubled, 'the octave reinforces a theme note struck with it').toBeDefined();
          expect(doubled!.pitch - octave.pitch).toBe(12);
          expect(octave.dynamicIntent.velocity).toBeLessThan(doubled!.dynamicIntent.velocity);
        }
      }
    }
    // The device is really used somewhere in the ordinary matrix; otherwise this test proves nothing.
    expect(written).toBeGreaterThan(0);
  });
});
