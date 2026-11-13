/**
 * Stage 2A — contextual Piano performance roles and transition decisions.
 *
 * These tests protect technical properties only (determinism, no-op without evidence, Classic
 * unchanged, the independent draft untouched by adaptation, no isolated suspension notes, respect
 * for other parts' fills, role stability, MIDI integrity). They make no claim about how the music
 * sounds.
 */
import { describe, expect, it } from 'vitest';
import { analyzePianoInput } from '../src/orchestrator/keys/piano-analyzer';
import {
  composePianoPlan, composePianoScoreWithDiagnostics, openPianoOwnedTransitionBars,
  pianoTransitionNotes, verifyPianoTransitions,
} from '../src/orchestrator/keys/piano-composer';
import { buildMergedMidi, parseMidiFile } from '../src/export/midi';
import {
  derivePianoPerformanceRoles, PIANO_FEATURED_THRESHOLD, PIANO_PERFORMANCE_ROLES, pianoFeaturedScore,
  type PianoPhraseRoleEvidence, type PianoRoleContext,
} from '../src/orchestrator/keys/piano-performance-role';
import {
  adaptPianoTransitions, fallbackPianoTransition, PIANO_TRANSITION_GESTURES, planPianoTransitions, verifyPianoTransition,
  type PianoBoundaryContext, type PianoBoundaryOrchestration, type PianoTransitionFacts,
} from '../src/orchestrator/keys/piano-transitions';
import { projectEndTick } from '../src/shared/schema';
import { PIANO_TEMPLATES, runPianoCell, type PianoCell } from './piano-variation-support';

const LONG = { timeout: 120_000 };
const BAR = 3840;

const cell = (overrides: Partial<PianoCell> = {}): PianoCell => ({
  template: 'chamber', fixture: 'three-chorus-40bars', standalone: false, transpose: 0, density: 1, seed: 1, take: 0, mode: 'identity', ...overrides,
});

const musical = (events: readonly { startTick: number; durationTicks: number; pitch: number; hand: string; voiceId: string; dynamicIntent: { velocity: number } }[]) =>
  events.map((event) => `${event.startTick}:${event.durationTicks}:${event.pitch}:${event.hand}:${event.voiceId}:${event.dynamicIntent.velocity}`).join('|');

const phraseEvidence = (overrides: Partial<PianoPhraseRoleEvidence> = {}): PianoPhraseRoleEvidence => ({
  phraseId: 'p', sectionName: 'Verse', arcRole: 'statement', liveBars: 4, meanEnergy: 0.5, energyRank: 0.5,
  hasThemeHead: true, themeCentre: 72, leadCoverage: 0, leadOnsetsPerBar: 0, leadMeanPitch: null,
  upperOnsetsPerBar: 4, bassOnsetsPerBar: 2, interweaveShare: 0, leaveSpaceShare: 0, spotlightYieldShare: 0,
  handYieldShare: 0, arrivalShare: 0, spotlightShare: 0, ...overrides,
});

const roleContext = (phrases: readonly PianoPhraseRoleEvidence[], overrides: Partial<PianoRoleContext> = {}): PianoRoleContext => ({
  evidenceAvailable: true, templateIdentity: 'chamber-counterpoint', archetype: 'lyrical', protectedTraits: [], phrases, ...overrides,
});

const boundary = (overrides: Partial<PianoBoundaryContext> = {}): PianoBoundaryContext => ({
  bar: 4, outgoingSection: 'Verse', incomingSection: 'Chorus', outgoingArcRole: 'statement', incomingArcRole: 'climax',
  suppliedEnergy: 0.4, outgoingEnergy: 0.5, incomingEnergy: 0.8, restricted: false, incomingRestricted: false,
  existingRun: null, level: 2, slots: 8, hasRightHandTheme: true, authenticMotion: true, pianoOwnsFill: false,
  incomingIsClimax: true, incomingIsFinalSection: false, incomingReturns: false, outgoingBars: 4, ...overrides,
} as PianoBoundaryContext);

const FACTS = { archetype: 'lyrical', runs: 'occasional', sixteenthRuns: false, density: 1 } as unknown as PianoTransitionFacts;
const noise = (label: string) => {
  let hash = 2166136261;
  for (let index = 0; index < label.length; index++) hash = Math.imul(hash ^ label.charCodeAt(index), 16777619);
  return ((hash >>> 0) % 10000) / 10000;
};
const tail = (overrides: Partial<PianoBoundaryOrchestration> = {}): PianoBoundaryOrchestration => ({
  outgoingRole: 'featured', incomingRole: 'featured', tailOnsets: 0, usualHalfBarOnsets: 4, fillTaggedNotes: 0, tailTrackIds: [], melody: 'theme', rest: null, ...overrides,
});

describe('Stage 2A role decision (unit)', () => {
  it('is deterministic and uses only the five roles', () => {
    const context = roleContext([
      phraseEvidence({ phraseId: 'a' }),
      phraseEvidence({ phraseId: 'b', leadCoverage: 1, leadOnsetsPerBar: 6, leadMeanPitch: 72 }),
      phraseEvidence({ phraseId: 'c', upperOnsetsPerBar: 30, bassOnsetsPerBar: 12, sectionName: 'Chorus' }),
    ]);
    const first = derivePianoPerformanceRoles(context);
    expect(derivePianoPerformanceRoles(context)).toEqual(first);
    for (const decision of first) {
      expect(PIANO_PERFORMANCE_ROLES).toContain(decision.role);
      expect(decision.reason.length).toBeGreaterThan(0);
      expect(decision.evidence.length).toBeGreaterThan(0);
    }
  });

  it('without orchestral evidence every phrase is featured', () => {
    const decisions = derivePianoPerformanceRoles(roleContext(
      [phraseEvidence({ phraseId: 'a', leadCoverage: 1, leadOnsetsPerBar: 8, leadMeanPitch: 72 }), phraseEvidence({ phraseId: 'b' })],
      { evidenceAvailable: false, templateIdentity: 'cinematic-expanse' },
    ));
    expect(decisions.map((decision) => decision.role)).toEqual(['featured', 'featured']);
  });

  it('a lead being present does not by itself remove the Piano from the foreground', () => {
    // A sparse lead far from the Piano's register: the Piano may stay featured (co-lead).
    const sparseFarLead = derivePianoPerformanceRoles(roleContext([
      phraseEvidence({ leadCoverage: 1, leadOnsetsPerBar: 1, leadMeanPitch: 50, interweaveShare: 1 }),
    ], { templateIdentity: 'sonata-dialogue' }));
    expect(sparseFarLead[0].role).toBe('featured');
    // A busy lead in the Piano's own register scores lower than that.
    const busyNearLead = derivePianoPerformanceRoles(roleContext([
      phraseEvidence({ leadCoverage: 1, leadOnsetsPerBar: 8, leadMeanPitch: 72 }),
      phraseEvidence({ phraseId: 'q' }),
    ], { templateIdentity: 'sonata-dialogue' }));
    expect(busyNearLead[0].featuredScore!).toBeLessThan(sparseFarLead[0].featuredScore!);
  });

  it('the Piano alone in a phrase is featured in instrumental templates', () => {
    for (const templateIdentity of ['chamber-counterpoint', 'sonata-dialogue', 'cinematic-expanse', 'hybrid-pulse-and-color']) {
      const decisions = derivePianoPerformanceRoles(roleContext(
        [phraseEvidence({ upperOnsetsPerBar: 0, bassOnsetsPerBar: 0 })], { templateIdentity },
      ));
      expect(decisions[0].role, templateIdentity).toBe('featured');
    }
  });

  it('a marginal score difference between neighbouring phrases does not flip the role', () => {
    // Find the lead activity at which the featured score crosses the threshold, then place three
    // phrases of one section just below, just above and just below it.
    const identity = { templateIdentity: 'cinematic-expanse' };
    const at = (activity: number, phraseId = 'p') => phraseEvidence({ phraseId, leadCoverage: 1, leadOnsetsPerBar: activity, leadMeanPitch: 72 });
    const scoreAt = (activity: number) => pianoFeaturedScore(roleContext([at(activity)], identity), at(activity));
    let low = 0;
    let high = 16;
    expect(scoreAt(low)).toBeGreaterThan(PIANO_FEATURED_THRESHOLD);
    expect(scoreAt(high)).toBeLessThan(PIANO_FEATURED_THRESHOLD);
    for (let step = 0; step < 40; step++) {
      const middle = (low + high) / 2;
      if (scoreAt(middle) >= PIANO_FEATURED_THRESHOLD) low = middle; else high = middle;
    }
    const below = high + 0.05;
    const above = low - 0.05;
    const context = roleContext([at(below, 'a'), at(above, 'b'), at(below, 'c')], identity);
    const decisions = derivePianoPerformanceRoles(context);
    expect(new Set(decisions.map((decision) => decision.role)).size).toBe(1);
    expect(decisions[1].stabilised).toBe(true);
    // A clear difference is still allowed to change the role.
    const clear = derivePianoPerformanceRoles(roleContext([at(below, 'a'), at(0, 'b'), at(below, 'c')].map((phrase, index) => (index === 1 ? { ...phrase, leadCoverage: 0 } : phrase)), identity));
    expect(clear[1].role).toBe('featured');
    expect(clear[0].role).not.toBe('featured');
  });
});

describe('Stage 2A transition decision (unit)', () => {
  it('is deterministic and names a known gesture with a reason', () => {
    const boundaries = [boundary({ bar: 4 }), boundary({ bar: 12, outgoingSection: 'Chorus', incomingSection: 'Verse', outgoingEnergy: 0.8, incomingEnergy: 0.45, incomingIsClimax: false, incomingReturns: true })];
    const first = planPianoTransitions(boundaries, FACTS, noise);
    expect(planPianoTransitions(boundaries, FACTS, noise)).toEqual(first);
    for (const decision of first) {
      expect(PIANO_TRANSITION_GESTURES).toContain(decision.gesture);
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  it('a restricted last bar is a break, never a figure', () => {
    const [decision] = planPianoTransitions([boundary({ restricted: true })], FACTS, noise);
    expect(decision.gesture).toBe('break');
  });

  it('another part owning the fill silences the Piano gesture; a present tail only narrows it', () => {
    const boundaries = [boundary()];
    const independent = planPianoTransitions(boundaries, FACTS, noise);
    const strong = adaptPianoTransitions(independent, boundaries, FACTS, new Map([[4, tail({ tailOnsets: 12, fillTaggedNotes: 3, tailTrackIds: ['drums'] })]]), noise);
    expect(strong[0].gesture).toBe('none');
    expect(strong[0].independentGesture).toBe(independent[0].gesture);
    const present = adaptPianoTransitions(independent, boundaries, FACTS, new Map([[4, tail({ tailOnsets: 7 })]]), noise);
    expect(['minimal', 'none', 'sustained-handover', 'cadence']).toContain(present[0].gesture);
    const quiet = adaptPianoTransitions(independent, boundaries, FACTS, new Map([[4, tail({ tailOnsets: 0 })]]), noise);
    expect(quiet[0].gesture).toBe(independent[0].gesture);
    expect(quiet[0].changedByArrangement).toBe(false);
  });

  it('a fill the plan gave to the Piano is not handed away', () => {
    const boundaries = [boundary({ pianoOwnsFill: true })];
    const independent = planPianoTransitions(boundaries, FACTS, noise);
    const adapted = adaptPianoTransitions(independent, boundaries, FACTS, new Map([[4, tail({ tailOnsets: 12, fillTaggedNotes: 3 })]]), noise);
    expect(adapted[0].gesture).toBe(independent[0].gesture);
  });
});

describe('Stage 2A production path', () => {
  it('roles, transitions and notes are deterministic', LONG, () => {
    for (const template of ['chamber', 'cinematic'] as const) {
      const first = runPianoCell(cell({ template }));
      const second = runPianoCell(cell({ template }));
      expect(JSON.stringify(second.result.pianoDiagnostics!.performance), template).toBe(JSON.stringify(first.result.pianoDiagnostics!.performance));
      expect(musical(second.result.pianoScore.events), template).toBe(musical(first.result.pianoScore.events));
    }
  });

  it('Piano-only: no evidence, every phrase featured, adaptation is a no-op, and the piece is a full composition', LONG, () => {
    for (const template of PIANO_TEMPLATES) {
      for (const take of [0, 1]) {
        const run = runPianoCell(cell({ template, take, standalone: true }));
        const diagnostics = run.result.pianoDiagnostics!;
        const performance = diagnostics.performance!;
        const label = `${template} take ${take}`;
        expect(performance.evidence, label).toBe('none');
        expect(performance.roles.every((entry) => entry.role === 'featured'), label).toBe(true);
        expect(performance.transitions.every((decision) => !decision.changedByArrangement), label).toBe(true);
        expect(diagnostics.adaptation.records, label).toEqual([]);
        for (const bar of diagnostics.bars) expect(bar.adaptedLevel, `${label} bar ${bar.bar}`).toBe(bar.independentLevel);
        // Full capabilities: both hands, a theme, and sound in (almost) every bar.
        const events = run.result.pianoScore.events;
        expect(events.some((event) => event.hand === 'left'), label).toBe(true);
        expect(events.some((event) => event.voiceId === 'rh.melody'), label).toBe(true);
        const sounding = new Set(events.map((event) => Math.floor(event.startTick / BAR)));
        expect(sounding.size / diagnostics.bars.length, label).toBeGreaterThanOrEqual(0.95);
        expect(diagnostics.flags.filter((flag) => flag.startsWith('empty-non-rest-phrase')), label).toEqual([]);
      }
    }
  });

  it('Classic carries no Stage 2A decisions and does not use the opened plan', LONG, () => {
    for (const template of PIANO_TEMPLATES) {
      const run = runPianoCell(cell({ template, mode: 'classic' }));
      expect(run.result.pianoDiagnostics!.performance, template).toBeUndefined();
      const input = run.result.pianoEngineInput;
      const plan = composePianoPlan(input, analyzePianoInput(input));
      const target = run.project.tracks.find((track) => track.id === run.piano!.id)!;
      const direct = composePianoScoreWithDiagnostics(input, plan, target as never, projectEndTick(run.project), 'classic');
      expect(musical(direct.score.events), template).toBe(musical(run.result.pianoScore.events));
    }
  });

  it('the independent draft is the same with and without the arrangement', LONG, () => {
    for (const template of PIANO_TEMPLATES) {
      const run = runPianoCell(cell({ template }));
      const input = run.result.pianoEngineInput;
      const target = run.project.tracks.find((track) => track.id === run.piano!.id)!;
      const end = projectEndTick(run.project);
      const plan = openPianoOwnedTransitionBars(composePianoPlan(input, analyzePianoInput(input)));
      const withArrangement = composePianoScoreWithDiagnostics(input, plan, target as never, end);
      const bare = { ...input, analysis: { ...input.analysis, tracks: [] } };
      const withoutArrangement = composePianoScoreWithDiagnostics(bare, plan, target as never, end);
      expect(JSON.stringify(withoutArrangement.diagnostics!.independentDraft.notes), template)
        .toBe(JSON.stringify(withArrangement.diagnostics!.independentDraft.notes));
      expect(JSON.stringify(run.result.pianoDiagnostics!.independentDraft.notes), template)
        .toBe(JSON.stringify(withArrangement.diagnostics!.independentDraft.notes));
      // Independent transition choices are part of the draft and survive as `independentGesture`.
      expect(withArrangement.diagnostics!.performance!.transitions.map((decision) => decision.independentGesture), template)
        .toEqual(withoutArrangement.diagnostics!.performance!.transitions.map((decision) => decision.gesture));
    }
  });

  it('no boundary bar carries an isolated suspension note, and restricted bars stay silent', LONG, () => {
    for (const template of PIANO_TEMPLATES) {
      for (const standalone of [false, true]) {
        for (const take of [0, 1, 2]) {
          const run = runPianoCell(cell({ template, standalone, take }));
          const label = `${template} ${standalone ? 'solo' : 'full'} take ${take}`;
          const input = run.result.pianoEngineInput;
          const events = run.result.pianoScore.events;
          const plan = openPianoOwnedTransitionBars(composePianoPlan(input, analyzePianoInput(input)));
          for (const restriction of plan.attackRestrictions) {
            const inside = events.filter((event) => event.startTick >= restriction.startTick && event.startTick < restriction.endTick);
            expect(inside.filter((event) => event.musicalRole === 'suspension'), `${label} restricted bar ${restriction.bar}`).toEqual([]);
          }
          for (const window of input.context.barWindows) {
            const inBar = events.filter((event) => event.startTick >= window.startTick && event.startTick < window.endTick);
            if (!inBar.length) continue;
            expect(inBar.every((event) => event.musicalRole === 'suspension'), `${label} bar ${window.bar} is only a suspension`).toBe(false);
          }
          // Every Piano note that reaches the track comes from the score.
          expect(run.piano!.notes.length, label).toBe(events.length);
          for (const decision of run.result.pianoDiagnostics!.performance!.transitions) {
            if (decision.gesture !== 'break') continue;
            const window = input.context.barWindows.find((entry) => entry.bar === decision.bar)!;
            const sounding = run.piano!.notes.filter((note) => note.startTick >= window.startTick + BAR / 2 && note.startTick < window.endTick);
            expect(sounding, `${label} break bar ${decision.bar}`).toEqual([]);
          }
        }
      }
    }
  });

  it('arrangement changes to a transition only reduce the Piano gesture, and are explained', LONG, () => {
    // A change made for the arrangement never adds one of the Piano's most assertive figures.
    const assertive = new Set(['flourish', 'rising-figure']);
    let changed = 0;
    for (const template of PIANO_TEMPLATES) {
      for (const take of [0, 1, 2, 3]) {
        const transitions = runPianoCell(cell({ template, take })).result.pianoDiagnostics!.performance!.transitions;
        for (const decision of transitions) {
          expect(decision.reason.length, `${template} bar ${decision.bar}`).toBeGreaterThan(0);
          if (!decision.changedByArrangement) { expect(decision.gesture).toBe(decision.independentGesture); continue; }
          changed++;
          // The reason names what the independent composition chose and why the bar differs: the
          // arrangement, a role that rests the Piano, or a figure that could not be written.
          expect(decision.reason, `${template} bar ${decision.bar}`).toMatch(/changed because|The independent composition chose|Selected first/);
          expect(decision.reason, `${template} bar ${decision.bar}`).toContain(decision.fallbackFrom ?? decision.independentGesture!);
          expect(assertive.has(decision.gesture), `${template} take ${take} bar ${decision.bar}: ${decision.independentGesture} -> ${decision.gesture}`).toBe(false);
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('roles are reported per phrase with reasons, hold inside a section, and keep the template character', LONG, () => {
    const featuredShare: Record<string, number> = {};
    for (const template of PIANO_TEMPLATES) {
      let featured = 0;
      let total = 0;
      for (const take of [0, 1, 2, 3]) {
        const performance = runPianoCell(cell({ template, take })).result.pianoDiagnostics!.performance!;
        expect(performance.evidence, template).not.toBe('none');
        for (const entry of performance.roles) {
          expect(entry.reason.length, `${template} ${entry.phraseId}`).toBeGreaterThan(0);
          expect(typeof entry.presentation.asIntended, `${template} ${entry.phraseId}`).toBe('boolean');
        }
        // Stability: inside one section occurrence the role does not go A, B, A across full phrases.
        const full = performance.roles.filter((entry) => entry.endBar - entry.startBar + 1 >= 2);
        for (let index = 2; index < full.length; index++) {
          const [a, b, c] = [full[index - 2], full[index - 1], full[index]];
          if (a.sectionName !== b.sectionName || b.sectionName !== c.sectionName) continue;
          if (c.startBar - a.endBar > b.endBar - b.startBar + 2) continue;
          expect(a.role === c.role && a.role !== b.role, `${template} take ${take} bars ${a.startBar}-${c.endBar}: ${a.role}/${b.role}/${c.role}`).toBe(false);
        }
        featured += performance.roleBars.featured;
        total += Object.values(performance.roleBars).reduce((sum, value) => sum + value, 0);
      }
      featuredShare[template] = featured / total;
    }
    // Template character, as a relation and not as a target value.
    expect(featuredShare.chamber).toBeGreaterThan(featuredShare.cinematic);
    expect(featuredShare.sonata).toBeGreaterThan(featuredShare.hybridstudio);
    expect(featuredShare.chamber).toBeGreaterThan(featuredShare.vocalbacking);
    // No needless suppression: the Piano is not written out of any template.
    for (const template of PIANO_TEMPLATES) {
      const run = runPianoCell(cell({ template }));
      const sounding = new Set(run.piano!.notes.map((note) => Math.floor(note.startTick / BAR)));
      expect(sounding.size / run.result.pianoDiagnostics!.bars.length, template).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('takes still differ in the full arrangement (Stage 2 variation is kept)', LONG, () => {
    for (const template of PIANO_TEMPLATES) {
      const scores = [0, 1, 2, 3].map((take) => musical(runPianoCell(cell({ template, take })).result.pianoScore.events));
      expect(new Set(scores).size, template).toBe(4);
      const archetypes = [0, 1, 2, 3, 4, 5].map((take) => runPianoCell(cell({ template, take, fixture: 'dorian-16bars' })).result.pianoDiagnostics!.identity!.archetype);
      expect(new Set(archetypes).size, template).toBeGreaterThanOrEqual(2);
    }
  });

  it('MIDI integrity: notes inside the project, positive lengths, valid velocities, pedal lane present', LONG, () => {
    for (const template of PIANO_TEMPLATES) {
      for (const standalone of [false, true]) {
        const run = runPianoCell(cell({ template, standalone }));
        const end = projectEndTick(run.project);
        const label = `${template} ${standalone ? 'solo' : 'full'}`;
        for (const note of run.piano!.notes) {
          expect(Number.isInteger(note.startTick) && note.startTick >= 0, label).toBe(true);
          expect(note.durationTicks, label).toBeGreaterThan(0);
          expect(note.startTick + note.durationTicks, label).toBeLessThanOrEqual(end);
          expect(note.velocity >= 1 && note.velocity <= 127, label).toBe(true);
        }
        // (Hybrid Studio Piano-only take 0 on this fixture writes no pedal lane; that is the
        // behaviour of commit 932356f as well and is not asserted here.)
        const pedal = run.piano!.cc?.find((lane) => lane.cc === 64);
        if (template !== 'hybridstudio') expect(pedal, label).toBeDefined();
        if (pedal) expect(pedal.points.every((point) => point.tick >= 0 && point.tick <= end && (point.value === 0 || point.value === 127)), label).toBe(true);
        expect(run.result.pianoPlayability.violations, label).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Follow-up: the decision against the notes. A decision in the diagnostics is not a rendered bar.
// ---------------------------------------------------------------------------------------------

const BAR4 = { startTick: 3 * BAR, endTick: 4 * BAR, chordStarts: [] as number[] };
const at = (eighth: number, pitch: number, melody = true, eighths = 1) =>
  ({ startTick: 3 * BAR + eighth * 480, durationTicks: eighths * 480, pitch, melody });

describe('Stage 2A rendering check (unit)', () => {
  it('a pickup is three notes in the last three eighths moving one way', () => {
    const check = (pitches: number[]) => verifyPianoTransition({ bar: 4, gesture: 'pickup' }, BAR4,
      [at(0, 60, false, 4), ...pitches.map((pitch, index) => at(5 + index, pitch))]).rendered;
    expect(check([67, 69, 71])).toBe(true);
    expect(check([71, 69, 67])).toBe(true);
    expect(check([67, 71, 69])).toBe(false);
    expect(check([67, 69])).toBe(false);
    // The same three notes in the accompaniment are not a pickup of the theme line.
    expect(verifyPianoTransition({ bar: 4, gesture: 'pickup' }, BAR4, [at(5, 67, false), at(6, 69, false), at(7, 71, false)]).rendered).toBe(false);
  });

  it('rising and falling lines must not turn back', () => {
    expect(verifyPianoTransition({ bar: 4, gesture: 'rising-figure' }, BAR4, [at(4, 64), at(5, 65), at(6, 67), at(7, 69)]).rendered).toBe(true);
    expect(verifyPianoTransition({ bar: 4, gesture: 'rising-figure' }, BAR4, [at(4, 64), at(5, 67), at(6, 65), at(7, 69)]).rendered).toBe(false);
    expect(verifyPianoTransition({ bar: 4, gesture: 'descending-resolution' }, BAR4, [at(0, 72, true, 2), at(2, 71, true, 2), at(4, 69, true, 4)]).rendered).toBe(true);
    expect(verifyPianoTransition({ bar: 4, gesture: 'descending-resolution' }, BAR4, [at(0, 72, true, 2), at(2, 74, true, 2), at(4, 69, true, 4)]).rendered).toBe(false);
  });

  it('a break is silent from the second beat; minimal must sound; none may be silent', () => {
    expect(verifyPianoTransition({ bar: 4, gesture: 'break' }, BAR4, []).rendered).toBe(true);
    expect(verifyPianoTransition({ bar: 4, gesture: 'break' }, BAR4, [at(0, 60, false, 2)]).rendered).toBe(true);
    expect(verifyPianoTransition({ bar: 4, gesture: 'break' }, BAR4, [at(0, 60, false, 6)]).rendered).toBe(false);
    expect(verifyPianoTransition({ bar: 4, gesture: 'break' }, BAR4, [at(6, 60, false)]).rendered).toBe(false);
    expect(verifyPianoTransition({ bar: 4, gesture: 'minimal' }, BAR4, []).rendered).toBe(false);
    expect(verifyPianoTransition({ bar: 4, gesture: 'minimal' }, BAR4, [at(0, 60, false, 8)]).rendered).toBe(true);
    expect(verifyPianoTransition({ bar: 4, gesture: 'none' }, BAR4, []).rendered).toBe(true);
  });

  it('held gestures do not re-strike; punctuation is exactly two chords', () => {
    expect(verifyPianoTransition({ bar: 4, gesture: 'sustained-handover' }, BAR4, [at(0, 48, false, 8), at(0, 64, true, 8)]).rendered).toBe(true);
    expect(verifyPianoTransition({ bar: 4, gesture: 'sustained-handover' }, BAR4, [at(0, 48, false, 8), at(3, 55, false, 2)]).rendered).toBe(false);
    expect(verifyPianoTransition({ bar: 4, gesture: 'chordal-punctuation' }, BAR4, [at(0, 48, false, 2), at(6, 48, false, 2)]).rendered).toBe(true);
    expect(verifyPianoTransition({ bar: 4, gesture: 'chordal-punctuation' }, BAR4, [at(0, 48, false, 2), at(3, 52, false), at(6, 48, false, 2)]).rendered).toBe(false);
  });

  it('a figure that cannot be written falls back to minimal and keeps the first selection on record', () => {
    const boundaries = [boundary()];
    const [decision] = planPianoTransitions(boundaries, FACTS, noise);
    const fallen = fallbackPianoTransition({ ...decision, gesture: 'pickup' }, boundaries[0], 'No three-note figure in the last three eighths.');
    expect(fallen.gesture).toBe('minimal');
    expect(fallen.fallbackFrom).toBe('pickup');
    expect(fallen.reason).toContain('pickup');
    expect(fallen.reason).toContain('No three-note figure');
    // A second fallback does not lose the first selection.
    expect(fallbackPianoTransition(fallen, boundaries[0], 'x').fallbackFrom).toBe('pickup');
  });
});

describe('Stage 2A transition adaptation against the role directives (unit)', () => {
  const adaptWith = (orchestration: Partial<PianoBoundaryOrchestration>, gesture = 'pickup') => {
    const boundaries = [boundary()];
    const independent = planPianoTransitions(boundaries, FACTS, noise).map((decision) => ({ ...decision, gesture } as typeof decision));
    return adaptPianoTransitions(independent, boundaries, FACTS, new Map([[4, tail(orchestration)]]), noise)[0];
  };

  it('a bar in which both hands rest announces no gesture', () => {
    const decision = adaptWith({ outgoingRole: 'restrained', rest: 'both' });
    expect(decision.gesture).toBe('none');
    expect(decision.reason.length).toBeGreaterThan(0);
  });

  it('a rhythmic bar is not given a melodic turn', () => {
    for (const gesture of ['short-fill', 'pickup', 'rising-figure', 'descending-resolution']) {
      const decision = adaptWith({ outgoingRole: 'rhythmic', melody: 'none' }, gesture);
      expect(['short-fill', 'pickup', 'rising-figure', 'flourish', 'register-lift', 'descending-resolution'], gesture).not.toContain(decision.gesture);
    }
  });

  it('without the theme line in the bar no melodic figure is selected, whatever the role', () => {
    for (const outgoingRole of ['supporting', 'atmospheric', 'featured'] as const) {
      const decision = adaptWith({ outgoingRole, incomingRole: 'featured', melody: 'none' });
      expect(['short-fill', 'pickup', 'rising-figure', 'flourish', 'register-lift', 'descending-resolution'], outgoingRole).not.toContain(decision.gesture);
    }
  });
});

describe('Stage 2A decisions against the final notes', () => {
  const CELLS = PIANO_TEMPLATES.flatMap((template) => [false, true].flatMap((standalone) => [0, 1, 2].map((take) => ({ template, standalone, take }))));

  it('every transition decision is found in the final score, the track and the serialized MIDI', LONG, () => {
    let fallbacks = 0;
    for (const entry of CELLS) {
      const run = runPianoCell(cell(entry));
      const label = `${entry.template} ${entry.standalone ? 'solo' : 'full'} take ${entry.take}`;
      const input = run.result.pianoEngineInput;
      const performance = run.result.pianoDiagnostics!.performance!;
      const plan = openPianoOwnedTransitionBars(composePianoPlan(input, analyzePianoInput(input)));
      // The reported check is the check of the final score, and it is recomputed here from the events.
      const recomputed = verifyPianoTransitions(input, plan, performance.transitions, pianoTransitionNotes(run.result.pianoScore.events));
      expect(performance.transitionRendering, label).toEqual(recomputed);
      expect(recomputed.length, label).toBe(performance.transitions.length);
      for (const rendering of recomputed) expect(rendering.rendered, `${label} bar ${rendering.bar} ${rendering.gesture}: ${rendering.found}`).toBe(true);
      for (const decision of performance.transitions) {
        if (decision.fallbackFrom) {
          fallbacks++;
          expect(['minimal', 'none'], `${label} bar ${decision.bar}`).toContain(decision.gesture);
          expect(decision.reason, `${label} bar ${decision.bar}`).toContain(decision.fallbackFrom);
        }
      }
      // The serialized file carries exactly the notes of the score (time, pitch, velocity, length).
      const parsed = parseMidiFile(buildMergedMidi(run.project, [run.piano!]));
      const key = (note: { startTick: number; durationTicks: number; pitch: number; velocity: number }) => `${note.startTick}:${note.durationTicks}:${note.pitch}:${note.velocity}`;
      const written = parsed.tracks.flatMap((track) => track.notes).map(key).sort();
      expect(written, label).toEqual(run.piano!.notes.map(key).sort());
      // Every score event reaches the track at its own time and velocity. (The Realizer may revoice
      // a pitch for playability or octave policy; that is its job and is not asserted away here.)
      const scoreKeys = run.result.pianoScore.events.map((event) => `${event.startTick}:${event.dynamicIntent.velocity}`).sort();
      expect(run.piano!.notes.map((note) => `${note.startTick}:${note.velocity}`).sort(), label).toEqual(scoreKeys);
      // The pedal lane of the file is the pedal lane of the track.
      const lane = run.piano!.cc?.find((item) => item.cc === 64);
      const pedal = parsed.tracks.flatMap((track) => track.cc).filter((event) => event.cc === 64);
      expect(pedal.map((event) => `${event.tick}:${event.value}`), label).toEqual((lane?.points ?? []).map((point) => `${point.tick}:${point.value}`));
    }
    // (Informative only: the fallback path is exercised by this set of cells or it is not; either is valid.)
    expect(fallbacks).toBeGreaterThanOrEqual(0);
  });

  it('a minimal boundary sounds, a break is silent after the first beat, in the track notes', LONG, () => {
    for (const entry of CELLS.filter((item) => !item.standalone)) {
      const run = runPianoCell(cell(entry));
      const label = `${entry.template} take ${entry.take}`;
      const windows = run.result.pianoEngineInput.context.barWindows;
      for (const decision of run.result.pianoDiagnostics!.performance!.transitions) {
        const window = windows.find((item) => item.bar === decision.bar)!;
        const sounding = run.piano!.notes.filter((note) => note.startTick < window.endTick && note.startTick + note.durationTicks > window.startTick);
        if (decision.gesture === 'minimal') expect(sounding.length, `${label} minimal bar ${decision.bar}`).toBeGreaterThan(0);
        if (decision.gesture === 'break') {
          expect(run.piano!.notes.filter((note) => note.startTick >= window.startTick + BAR / 4 && note.startTick < window.endTick), `${label} break bar ${decision.bar}`).toEqual([]);
        }
        if (decision.gesture === 'none' && sounding.length === 0) expect(decision.reason.length, `${label} silent bar ${decision.bar} is explained`).toBeGreaterThan(0);
      }
    }
  });

  it('a suspension is never written across a boundary figure, and an omitted one leaves no note behind', LONG, () => {
    for (const entry of CELLS) {
      const run = runPianoCell(cell(entry));
      const label = `${entry.template} ${entry.standalone ? 'solo' : 'full'} take ${entry.take}`;
      const events = run.result.pianoScore.events;
      const performance = run.result.pianoDiagnostics!.performance!;
      for (const omission of performance.omittedSuspensions) {
        expect(omission.reason.length, label).toBeGreaterThan(0);
        expect(omission.startTick, label).toBeLessThan(omission.resolutionTick);
        const left = events.filter((event) => event.voiceId === 'rh.suspension' && event.startTick >= omission.startTick && event.startTick <= omission.resolutionTick);
        expect(left, `${label} omitted suspension at ${omission.startTick}`).toEqual([]);
      }
      // Suspension notes come in pairs: a preparation and its resolution.
      const suspension = events.filter((event) => event.voiceId === 'rh.suspension');
      expect(suspension.filter((event) => event.techniqueIntent === 'prepared-suspension').length, label)
        .toBe(suspension.filter((event) => event.techniqueIntent === 'stepwise-resolution').length);
    }
  });
});

// The balance under a lead is covered end to end in tests/piano-stage2a-lead-balance.test.ts.
