/**
 * Stage 2A — relative balance of a Supporting Piano phrase against its lead, end to end.
 *
 * Everything here compares written MIDI velocities: the lead's notes and the Piano's notes in the
 * same bars, read from the final tracks and from the serialized MIDI file. Velocity is not
 * loudness; these tests make no claim about how the balance sounds.
 */
import { describe, expect, it } from 'vitest';
import { buildMergedMidi, parseMidiFile } from '../src/export/midi';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import { composePianoPlan, composePianoScoreWithDiagnostics, openPianoOwnedTransitionBars } from '../src/orchestrator/keys/piano-composer';
import type { PianoEngineInput } from '../src/orchestrator/keys/piano-engine';
import {
  combinePianoVelocityTrims, PIANO_LEAD_BALANCE_LIMIT, solvePianoLeadTrim, type PianoLeadBalance,
} from '../src/orchestrator/keys/piano-texture-theme';
import { isInstrumentTrack, projectEndTick } from '../src/shared/schema';
import { runPianoCell, type PianoCell, type PianoCellRun } from './piano-variation-support';

const LONG = { timeout: 180_000 };
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const close = (a: number, b: number, by = 0.051) => Math.abs(a - b) <= by;

const cell = (overrides: Partial<PianoCell> & { fixture?: string } = {}): PianoCell => ({
  template: 'chamber', fixture: 'three-chorus-40bars', standalone: false, transpose: 0, density: 1, seed: 1, take: 0, mode: 'identity', ...overrides,
} as PianoCell);

const rolesOf = (run: PianoCellRun) => run.result.pianoDiagnostics!.performance!.roles;
const inBars = (balance: PianoLeadBalance, tick: number) => balance.barWindows.some((bar) => tick >= bar.startTick && tick < bar.endTick);
const sounds = (balance: PianoLeadBalance, note: { startTick: number; durationTicks: number }) =>
  balance.barWindows.some((bar) => note.startTick < bar.endTick && note.startTick + note.durationTicks > bar.startTick);

/** The two populations of the definition, read from the exported file and the final tracks. */
function measured(run: PianoCellRun, balance: PianoLeadBalance) {
  const file = parseMidiFile(buildMergedMidi(run.project, [run.piano!]));
  const piano = file.tracks.flatMap((track) => track.notes).filter((note) => inBars(balance, note.startTick)).map((note) => note.velocity);
  const lead = run.result.tracks.filter((track) => isInstrumentTrack(track) && balance.leadTrackIds.includes(track.id))
    .flatMap((track) => (isInstrumentTrack(track) ? track.notes : [])).filter((note) => sounds(balance, note)).map((note) => note.velocity);
  return { piano: mean(piano), lead: mean(lead), pianoNotes: piano.length, leadNotes: lead.length };
}

const MATRIX: PianoCell[] = (['chamber', 'sonata', 'cinematic', 'hybridstudio'] as const).flatMap((template) =>
  (['dorian-16bars', 'three-chorus-40bars'] as const).flatMap((fixture) => [0, 1, 2, 3].map((take) => cell({ template, fixture, take }))));

describe('Stage 2A lead balance: the trim amount (unit)', () => {
  const notes = (velocities: number[], barTrim = 0) => velocities.map((velocity) => ({ velocity, barTrim }));

  it('takes the smallest whole amount that brings the mean to the target, and nothing when already there', () => {
    expect(solvePianoLeadTrim(notes([60, 62, 64, 66]), 58).trim).toBe(5);
    expect(solvePianoLeadTrim(notes([60, 62, 64, 66]), 58).reachable).toBe(true);
    expect(solvePianoLeadTrim(notes([50, 52]), 58).trim).toBe(0);
    // Within half a step of the target counts as there.
    expect(solvePianoLeadTrim(notes([58, 59]), 58).trim).toBe(0);
  });

  it('stops at the limit and says the target was not reached', () => {
    const solved = solvePianoLeadTrim(notes([90, 90]), 60);
    expect(solved.trim).toBe(PIANO_LEAD_BALANCE_LIMIT);
    expect(solved.reachable).toBe(false);
    expect(solved.predicted).toBe(90 - PIANO_LEAD_BALANCE_LIMIT);
  });

  it('knows that notes at the quietest written velocity do not move', () => {
    // Without the floor the mean 40 would reach 36 with 4; half the notes cannot move, so it takes 8.
    const solved = solvePianoLeadTrim(notes([30, 30, 50, 50]), 35.5);
    expect(solved.trim).toBe(8);
    expect(solved.predicted).toBe(36);
    expect(solvePianoLeadTrim(notes([40, 40, 40, 40]), 35.5).trim).toBe(4);
  });

  it('does not add the phrase trim to a bar-local reduction', () => {
    expect(combinePianoVelocityTrims(0, 5)).toBe(-5);
    expect(combinePianoVelocityTrims(-8, 5)).toBe(-8);
    expect(combinePianoVelocityTrims(-8, 12)).toBe(-12);
    expect(combinePianoVelocityTrims(-3, 3)).toBe(-3);
    // A bar already lowered by 8 moves by 2 under a phrase trim of 10: the solver counts that.
    const plain = solvePianoLeadTrim(notes([70, 70]), 64);
    const withLocal = solvePianoLeadTrim([{ velocity: 70, barTrim: 0 }, { velocity: 70, barTrim: -8 }], 64);
    expect(plain.trim).toBe(6);
    expect(withLocal.trim).toBe(10);
    expect(withLocal.predicted).toBe(64);
  });
});

describe('Stage 2A lead balance: the report describes the exported notes', () => {
  it('final figures equal the serialized MIDI and the final lead track, for every measured phrase', LONG, () => {
    let phrases = 0; let trimmed = 0; let exceptions = 0;
    for (const entry of MATRIX) {
      const run = runPianoCell(entry);
      const label = `${entry.template} ${entry.fixture} take ${entry.take}`;
      for (const role of rolesOf(run)) {
        const balance = role.presentation.balance;
        if (!balance) continue;
        phrases++;
        const where = `${label} bars ${role.startBar}-${role.endBar}`;
        // Definitions.
        expect(role.role, where).toBe('supporting');
        expect(balance.leadBars * 2, where).toBeGreaterThanOrEqual(balance.liveBars);
        expect(balance.bars.length, where).toBe(balance.leadBars);
        expect(balance.margin >= 2 && balance.margin <= 6, where).toBe(true);
        expect(balance.trim >= 0 && balance.trim <= PIANO_LEAD_BALANCE_LIMIT, where).toBe(true);
        expect(close(balance.difference, balance.pianoVelocity - balance.leadVelocity, 0.11), where).toBe(true);
        // Stages in pipeline order, the last one being the exported track.
        expect(balance.stages.map((stage) => stage.stage), where).toEqual(['draft', 'score', 'track']);
        expect(balance.final, where).toEqual(balance.stages[2]);
        // The final figures are the file's.
        const file = measured(run, balance);
        expect(close(file.piano, balance.final.pianoVelocity), `${where}: Piano ${file.piano} in the file, ${balance.final.pianoVelocity} reported`).toBe(true);
        expect(close(file.lead, balance.final.leadVelocity), `${where}: lead ${file.lead} in the tracks, ${balance.final.leadVelocity} reported`).toBe(true);
        expect(file.pianoNotes, where).toBe(balance.final.pianoNotes);
        expect(file.leadNotes, where).toBe(balance.leadNotes);
        expect(close(balance.final.difference, file.piano - file.lead, 0.11), where).toBe(true);
        // On target or an explained exception; never both, never neither.
        const onTarget = file.piano <= file.lead - balance.margin + 0.5 + 0.051;
        expect(balance.withinTarget, `${where}: ${balance.note}`).toBe(onTarget);
        expect(balance.exception === null, where).toBe(balance.withinTarget);
        if (!balance.withinTarget) {
          exceptions++;
          // The target is missed only where the trim is exhausted.
          expect(balance.trim, `${where}: ${balance.exception}`).toBe(PIANO_LEAD_BALANCE_LIMIT);
          expect(balance.exception, where).toContain(`limit of ${PIANO_LEAD_BALANCE_LIMIT}`);
        }
        // The trim is decided on the pre-trim relation and is not larger than needed.
        if (balance.trim === 0) expect(balance.pianoVelocity, where).toBeLessThanOrEqual(balance.target + 0.56);
        else { trimmed++; expect(balance.pianoVelocity, where).toBeGreaterThan(balance.target + 0.44); }
        // No repeated reduction: the trimmed draft is not below "before minus trim", and later
        // stages do not lower the phrase unless the mix guard fires (which the track stage shows).
        const [draft, score, track] = balance.stages;
        expect(draft.pianoVelocity, where).toBeGreaterThanOrEqual(balance.pianoVelocity - balance.trim - 0.5);
        expect(draft.pianoVelocity, where).toBeLessThanOrEqual(balance.pianoVelocity + 0.05);
        expect(track.pianoVelocity, where).toBeLessThanOrEqual(score.pianoVelocity + 0.05);
        // The trim record is there exactly when a trim was applied.
        const records = run.result.pianoDiagnostics!.adaptation.records.filter((record) => record.kind === 'velocity-trim' && record.bar >= role.startBar && record.bar <= role.endBar);
        expect(records.length > 0, where).toBe(balance.trim > 0);
      }
    }
    expect(phrases).toBeGreaterThan(20);
    expect(trimmed).toBeGreaterThan(5);
    expect(exceptions).toBeGreaterThan(0);
  });

  it('a phrase the limit cannot bring to the target is reported as an exception, not hidden', LONG, () => {
    // Sonata, dorian-16bars, take 3 (index 2): the Piano starts 12.7 above the violin lead.
    const run = runPianoCell(cell({ template: 'sonata', fixture: 'dorian-16bars', take: 2 }));
    const role = rolesOf(run).find((item) => item.startBar === 13)!;
    const balance = role.presentation.balance!;
    expect(balance.trim).toBe(PIANO_LEAD_BALANCE_LIMIT);
    expect(balance.withinTarget).toBe(false);
    expect(balance.final.pianoVelocity).toBeGreaterThan(balance.target + 0.5);
    expect(balance.exception).toMatch(/Above the target of [\d.]+ by [\d.]+: the trim stops at its limit of 12/);
    expect(balance.note).toContain(balance.exception!);
    // The phrase still moved by the full amount where notes could move.
    expect(balance.pianoVelocity - balance.stages[0].pianoVelocity).toBeGreaterThan(PIANO_LEAD_BALANCE_LIMIT - 2);
    const file = measured(run, balance);
    expect(close(file.piano - file.lead, balance.final.difference, 0.11)).toBe(true);
  });

  it('Featured, Rhythmic, Atmospheric, Restrained and Piano-only passages carry no balance and no trim', LONG, () => {
    const seen = new Set<string>();
    for (const entry of MATRIX) {
      const run = runPianoCell(entry);
      const label = `${entry.template} ${entry.fixture} take ${entry.take}`;
      const records = run.result.pianoDiagnostics!.adaptation.records.filter((record) => record.kind === 'velocity-trim');
      for (const role of rolesOf(run)) {
        seen.add(role.role);
        if (role.role === 'supporting') continue;
        const where = `${label} ${role.role} bars ${role.startBar}-${role.endBar}`;
        expect(role.presentation.balance, where).toBeNull();
        expect(role.presentation.balanceNote, where).toBeNull();
        expect(records.filter((record) => record.bar >= role.startBar && record.bar <= role.endBar), where).toEqual([]);
      }
      // Every trim record belongs to a measured Supporting phrase with a positive trim.
      for (const record of records) {
        const role = rolesOf(run).find((item) => record.bar >= item.startBar && record.bar <= item.endBar)!;
        expect(role.role, `${label} bar ${record.bar}`).toBe('supporting');
        expect(role.presentation.balance!.trim, `${label} bar ${record.bar}`).toBeGreaterThan(0);
      }
    }
    for (const role of ['featured', 'supporting', 'rhythmic', 'atmospheric']) expect(seen.has(role), role).toBe(true);
    for (const template of ['chamber', 'sonata', 'cinematic'] as const) {
      const solo = runPianoCell(cell({ template, standalone: true }));
      expect(rolesOf(solo).every((role) => role.role === 'featured' && !role.presentation.balance), template).toBe(true);
      expect(solo.result.pianoDiagnostics!.adaptation.records.filter((record) => record.kind === 'velocity-trim'), template).toEqual([]);
    }
  });

  it('a Featured phrase beside a lead keeps the velocities of the independent piece unless the mix guard lowers them', LONG, () => {
    for (const template of ['chamber', 'sonata'] as const) {
      const run = runPianoCell(cell({ template }));
      const draft = run.result.pianoDiagnostics!.independentDraft.notes;
      const independent = new Map<string, number>();
      for (const note of draft) independent.set(`${note.t}:${note.p}`, Math.max(independent.get(`${note.t}:${note.p}`) ?? 0, note.v));
      const windows = run.result.pianoEngineInput.context.barWindows;
      let compared = 0;
      for (const role of rolesOf(run).filter((item) => item.role === 'featured')) {
        const start = windows.find((bar) => bar.bar === role.startBar)!.startTick;
        const end = windows.find((bar) => bar.bar === role.endBar)!.endTick;
        for (const event of run.result.pianoScore.events) {
          if (event.startTick < start || event.startTick >= end || event.voiceId === 'rh.suspension') continue;
          const written = independent.get(`${event.startTick}:${event.pitch}`);
          if (written === undefined) continue;
          compared++;
          // Co-leading: a transition may shape the boundary bar, but no balance reduction is applied.
          if (!run.result.pianoDiagnostics!.performance!.transitions.some((decision) => decision.bar === role.endBar && event.startTick >= windows.find((bar) => bar.bar === decision.bar)!.startTick)) {
            expect(event.dynamicIntent.velocity, `${template} bars ${role.startBar}-${role.endBar} tick ${event.startTick}`).toBeGreaterThanOrEqual(written);
          }
        }
      }
      expect(compared, template).toBeGreaterThan(50);
    }
  });
});

describe('Stage 2A lead balance: every pass after the Composer', () => {
  it('the Realizer keeps score velocities; the mix guard only lowers; the file is the track', LONG, () => {
    let lowered = 0;
    const cells = [
      ...MATRIX.filter((entry) => entry.take < 2),
      // A case in which the final mix guard lowers Piano notes (bar 14, a Featured phrase).
      cell({ template: 'sonata', fixture: 'dorian-16bars', take: 3 }),
    ];
    for (const entry of cells) {
      const run = runPianoCell(entry);
      const label = `${entry.template} ${entry.fixture} take ${entry.take}`;
      const scoreById = new Map(run.result.pianoScore.events.map((event) => [event.id, event]));
      const key = (note: { startTick: number; pitch: number }) => `${note.startTick}:${note.pitch}`;
      const realized = new Map<string, number[]>();
      for (const item of run.result.pianoRealizedScoreEvents) {
        // Score to Realizer: the same velocity for the same event.
        const source = scoreById.get((item.source as { id: string }).id);
        expect(source, label).toBeDefined();
        expect(item.note.velocity, `${label} event ${source!.id}`).toBe(source!.dynamicIntent.velocity);
        realized.set(key(item.note), [...(realized.get(key(item.note)) ?? []), item.note.velocity]);
      }
      // Realizer to track: equal, or lowered by the mix guard. Never raised.
      expect(run.piano!.notes.length, label).toBe(run.result.pianoRealizedScoreEvents.length);
      const guardBars = new Set<number>();
      for (const note of run.piano!.notes) {
        const before = Math.max(...(realized.get(key(note)) ?? [NaN]));
        expect(note.velocity, `${label} tick ${note.startTick}`).toBeLessThanOrEqual(before);
        if (note.velocity < before) { lowered++; guardBars.add(Math.floor(note.startTick / 3840) + 1); }
      }
      // Track to file: identical, on channel 16.
      const file = parseMidiFile(buildMergedMidi(run.project, [run.piano!]));
      const stamp = (note: { startTick: number; durationTicks: number; pitch: number; velocity: number }) => `${note.startTick}:${note.durationTicks}:${note.pitch}:${note.velocity}`;
      expect(file.tracks.flatMap((track) => track.notes).map(stamp).sort(), label).toEqual(run.piano!.notes.map(stamp).sort());
      // Where the guard lowered a measured phrase, the report shows it: the track stage is below the score stage.
      for (const role of rolesOf(run)) {
        const balance = role.presentation.balance;
        if (!balance) continue;
        const touched = balance.bars.some((bar) => guardBars.has(bar));
        const [, score, track] = balance.stages;
        if (!touched) expect(track.pianoVelocity, `${label} bars ${role.startBar}-${role.endBar}`).toBe(score.pianoVelocity);
        else expect(track.pianoVelocity, `${label} bars ${role.startBar}-${role.endBar}`).toBeLessThanOrEqual(score.pianoVelocity);
      }
    }
    // The guard case is really in this set.
    expect(lowered).toBeGreaterThan(0);
  });
});

/** The same arrangement with the lead annotation moved to another written part. */
function composeWithLead(run: PianoCellRun, leadRole: string) {
  const input = run.result.pianoEngineInput;
  const lead = input.analysis.tracks.find((track) => track.role === leadRole && track.notes.length > 0);
  if (!lead) throw new Error(`no written ${leadRole} part`);
  const perBar = input.context.layerInformation.perBar.map((bar) => ({
    ...bar, layers: bar.layers.map((slot) => (slot.layer === 'lead' ? { ...slot, trackIds: [lead.id] } : slot)),
  }));
  const relabelled = { ...input, context: { ...input.context, layerInformation: { ...input.context.layerInformation, perBar } } } as PianoEngineInput;
  const plan = openPianoOwnedTransitionBars(composePianoPlan(relabelled, analyzePianoInput(relabelled)));
  const target = run.project.tracks.find((track) => isInstrumentTrack(track) && track.role === 'piano')!;
  const composed = composePianoScoreWithDiagnostics(relabelled, plan, target as never, projectEndTick(run.project), 'identity');
  return { lead, composed };
}

describe('Stage 2A lead balance: leads other than the first violins', () => {
  it('second violins as the lead in a generated Chamber arrangement', LONG, () => {
    let found = 0;
    for (const take of [0, 1, 2, 3]) {
      const run = runPianoCell(cell({ template: 'chamber', fixture: 'dorian-16bars', take }));
      for (const role of rolesOf(run)) {
        const balance = role.presentation.balance;
        if (!balance || !balance.leadTrackIds.some((id) => /violins2/.test(id))) continue;
        found++;
        const file = measured(run, balance);
        expect(close(file.lead, balance.final.leadVelocity)).toBe(true);
        expect(close(file.piano, balance.final.pianoVelocity)).toBe(true);
        expect(balance.withinTarget || balance.trim === PIANO_LEAD_BALANCE_LIMIT).toBe(true);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('a cello lead under a soli moment in a generated Sonata arrangement is measured, and its exception is reported', LONG, () => {
    // Sonata, dorian-16bars, seed 2, take 2 (index 1): bars 9-12, the cello leads and the conductor marks a soli.
    const run = runPianoCell(cell({ template: 'sonata', fixture: 'dorian-16bars', seed: 2, take: 1 }));
    const role = rolesOf(run).find((item) => item.startBar === 9)!;
    expect(role.role).toBe('supporting');
    const balance = role.presentation.balance!;
    expect(balance).not.toBeNull();
    expect(balance.leadTrackIds.every((id) => /cellosBasses/.test(id))).toBe(true);
    const file = measured(run, balance);
    expect(close(file.lead, balance.final.leadVelocity)).toBe(true);
    expect(close(file.piano, balance.final.pianoVelocity)).toBe(true);
    // The conductor moment already lowers each bar by 8; the phrase trim replaces that and is not added to it.
    expect(balance.barLocalReductions.map((item) => item.amount)).toEqual([8, 8, 8, 8]);
    expect(balance.trim).toBe(PIANO_LEAD_BALANCE_LIMIT);
    expect(balance.pianoVelocity - balance.stages[0].pianoVelocity).toBeLessThanOrEqual(PIANO_LEAD_BALANCE_LIMIT - 8 + 0.5);
    // The Piano's notes stay above the cello's; the report says so instead of hiding it.
    expect(balance.final.difference).toBeGreaterThan(0);
    expect(balance.withinTarget).toBe(false);
    expect(balance.exception).toContain('bar-local reduction of 8');
  });

  for (const [template, leadRole] of [['cinematic', 'flutes'], ['cinematic', 'clarinets'], ['chamber', 'cellosBasses'], ['chamber', 'violas'], ['sonata', 'cellosBasses']] as const) {
    it(`${leadRole} annotated as the lead of a generated ${template} arrangement`, LONG, () => {
      // The conductor annotates only string parts as leads. Here the annotation of a generated
      // arrangement is moved to another written part, and the Piano is composed again against it.
      let measuredPhrases = 0;
      for (const take of [0, 1, 2, 3]) {
        const run = runPianoCell(cell({ template, take }));
        const { lead, composed } = composeWithLead(run, leadRole);
        for (const role of composed.diagnostics!.performance!.roles) {
          const balance = role.presentation.balance;
          if (role.role !== 'supporting') { expect(balance, `${leadRole} take ${take} ${role.role}`).toBeNull(); continue; }
          if (!balance) continue;
          measuredPhrases++;
          const where = `${template} lead ${leadRole} take ${take} bars ${role.startBar}-${role.endBar}`;
          expect(balance.leadTrackIds, where).toEqual([lead.id]);
          // The lead level is that part's written notes in the measured bars, each once.
          const written = lead.notes.filter((note) => sounds(balance, note)).map((note) => note.velocity);
          expect(written.length, where).toBe(balance.leadNotes);
          expect(close(mean(written), balance.leadVelocity), where).toBe(true);
          // The Piano figures are the finished score's.
          const piano = composed.score.events.filter((event) => inBars(balance, event.startTick)).map((event) => event.dynamicIntent.velocity);
          expect(balance.final.stage, where).toBe('score');
          expect(close(mean(piano), balance.final.pianoVelocity), where).toBe(true);
          // A Piano already below the target is left alone; otherwise it is on target or at the limit.
          if (balance.pianoVelocity <= balance.target + 0.44) expect(balance.trim, where).toBe(0);
          expect(balance.withinTarget || balance.trim === PIANO_LEAD_BALANCE_LIMIT, `${where}: ${balance.note}`).toBe(true);
          expect(balance.trim, where).toBeLessThanOrEqual(PIANO_LEAD_BALANCE_LIMIT);
        }
      }
      expect(measuredPhrases, `${template} ${leadRole}`).toBeGreaterThan(0);
    });
  }

  it('the measurement does not depend on the register of the lead', LONG, () => {
    // The same lead two octaves lower: the same velocities, so the same lead level and the same
    // target arithmetic. (Roles and textures may answer the register; only phrases that stay
    // Supporting and measured in both are compared.)
    const run = runPianoCell(cell({ template: 'chamber', take: 0 }));
    const high = composeWithLead(run, 'violins2');
    const input = run.result.pianoEngineInput;
    const lowered = {
      ...run,
      result: { ...run.result, pianoEngineInput: { ...input, analysis: { ...input.analysis, tracks: input.analysis.tracks.map((track) => (track.id === high.lead.id ? { ...track, notes: track.notes.map((note) => ({ ...note, pitch: note.pitch - 24 })) } : track)) } } },
    } as PianoCellRun;
    const low = composeWithLead(lowered, 'violins2');
    let compared = 0;
    for (const role of high.composed.diagnostics!.performance!.roles) {
      const other = low.composed.diagnostics!.performance!.roles.find((item) => item.startBar === role.startBar && item.endBar === role.endBar);
      const a = role.presentation.balance; const b = other?.presentation.balance;
      if (!a || !b || a.bars.join() !== b.bars.join()) continue;
      compared++;
      expect(b.leadVelocity, `bars ${role.startBar}-${role.endBar}`).toBe(a.leadVelocity);
      expect(b.leadNotes).toBe(a.leadNotes);
      // The same rule in both registers: on target, or at the limit.
      for (const balance of [a, b]) expect(balance.withinTarget || balance.trim === PIANO_LEAD_BALANCE_LIMIT).toBe(true);
    }
    expect(compared).toBeGreaterThan(0);
  });
});
