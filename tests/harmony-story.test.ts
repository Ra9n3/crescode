/**
 * Story-pass tests — the section-level musical narrative layer and the
 * rebalanced movement economy:
 *
 *   - directed motion classes (descending fifths strongest, tritone weakest,
 *     pedal reclassifications audible but moderate);
 *   - motion weighted ABOVE stability in the transition score;
 *   - continuation reachable but never on equal footing (base 0.15, holdFit
 *     below the full common-tone credit);
 *   - the A-B-A correction: returns are free, strict alternation is not;
 *   - halved tonal-contact targets and cut CENTER_NEED for body roles;
 *   - section harmonic goals: sampling, determinism, sequence-aware fit;
 *   - phrase-to-phrase contrast penalties;
 *   - develop phrases transform their material instead of copying it;
 *   - the rhythm ↔ structure alignment post-process and its report fields;
 *   - audition MIDI delta times are real DELTAS (finalizeTrack regression).
 *
 * No assertion hardcodes a progression: everything pins behavior through the
 * exported scoring surfaces, the plan and the generation report.
 */
import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import { generateChordProgression } from '../src/engine/harmony/generation';
import { planSongHarmony } from '../src/engine/harmony/plan';
import {
  foundationContinuationScoreDetailed, foundationTransitionScoreDetailed,
  buildFoundationPool, seedTensionState, type FoundationInfo, type StructuralContext,
} from '../src/engine/harmony/foundation';
import {
  evaluatePathDetailed, phraseContrastPenalty, sectionGoalFit, selectWindowFoundations,
  strictAlternationPenalty, type SelectionWindow,
} from '../src/engine/harmony/progression';
import { sampleSectionGoal } from '../src/engine/harmony/phrases';
import { buildSongHarmonyProfiles } from '../src/engine/harmony/profiles';
import { cadenceEnvironment } from '../src/engine/harmony/cadences';
import { buildAuditionMidi } from '../src/engine/harmony/audit-midi';
import { mulberry32, hashString } from '../src/engine/generate';
import { barToTick } from '../src/shared/schema/meter';
import { projectFromFixture } from '../src/shared/schema';
import type { Chord, Project, Section } from '../src/shared/schema';
import type { SectionGoalKind } from '../src/engine/harmony/types';

const KEY = 4; // E
const MODE = 'Aeolian';

function pool(): ReturnType<typeof buildFoundationPool> {
  return buildFoundationPool(KEY, MODE, { complexity: 2, borrowing: 'some' });
}

function ctx(p = pool(), overrides: Partial<StructuralContext> = {}): StructuralContext {
  return {
    stability: 0.5, movement: 0.5, tension: 0.5, modalPref: 0.5, contrastPref: 0.5,
    borrowing: 'some', role: 'continue',
    pool: p, env: cadenceEnvironment(KEY, MODE),
    ...overrides,
  };
}

const at = (p: ReturnType<typeof buildFoundationPool>, rootPc: number, quality?: string): FoundationInfo => {
  const f = quality
    ? p.all.find((x) => x.rootPc === rootPc && x.quality === quality)
    : p.all.find((x) => x.rootPc === rootPc);
  if (!f) throw new Error(`no pooled foundation at root ${rootPc} (${quality ?? 'any'})`);
  return f;
};

/** Zero-pressure TensionState — the scorer requires one; these unit tests
 *  measure the context-free terms, so no resolution history is carried. */
const noPressure = seedTensionState(null);

function window(overrides: Partial<SelectionWindow> = {}): SelectionWindow {
  return {
    startTick: 0, endTick: 4 * 960, role: 'continue',
    direction: { stability: 0.5, movement: 0.5, tension: 0.5 },
    cadence: { intention: 'open', compatibleFamilies: [] },
    sectionId: 'a', isSectionStart: true, boundaryIntoNext: null, relatedPhraseIds: [],
    arrivalPlanned: true, phraseRef: null,
    sectionGoal: null, isSectionLast: false, sectionArrivalRoots: [], priorPhraseFeatures: null,
    prefs: { stability: 0.5, movement: 0.5, complexity: 0.5, tension: 0.5, modal: 0.5, contrast: 0.5, changesPerBar: 2, shape: 'regular' },
    ...overrides,
  };
}

const fixture = (sections: Section[], chords: Chord[] = []): Project => ({
  ...projectFromFixture({ name: 'StoryTest', tracks: [] }),
  sections,
  chords,
  key: KEY,
  mode: MODE,
});

describe('story pass — directed motion classes', () => {
  it('recovers the directed motion values from the movementFit term', () => {
    const p = pool();
    const c = ctx(p);
    const em = at(p, 4, 'minor');
    // motion = movementFit / (0.28 * (0.15 + 0.85 * movement)), movement 0.5
    const div = 0.28 * (0.15 + 0.85 * 0.5);
    const motionOf = (cand: FoundationInfo) =>
      foundationTransitionScoreDetailed(em, cand, c, noPressure).parts.movementFit / div;
    // Descending fifth (E→A, interval +5) is strongest, ascending fifth
    // (+7) milder, steps next, thirds and pedal moderate, tritone weakest.
    expect(motionOf(at(p, 9))).toBeCloseTo(0.9, 5);   // Am
    expect(motionOf(at(p, 11))).toBeCloseTo(0.75, 5); // Bm
    expect(motionOf(at(p, 6))).toBeCloseTo(0.65, 5);  // F#dim — step
    expect(motionOf(at(p, 0))).toBeCloseTo(0.5, 5);   // C — third
    expect(motionOf(at(p, 10))).toBeCloseTo(0.4, 5);  // D#… tritone (chromatic, pooled)
  });

  it('reads a same-root reclassification as audible, moderate motion', () => {
    const p = buildFoundationPool(KEY, MODE, { complexity: 3, borrowing: 'more' });
    const em = at(p, 4, 'minor');
    const pedal = p.all.find((f) => f.rootPc === 4 && f.id !== em.id);
    if (pedal === undefined) return; // pool has no same-root second core — nothing to pin
    const c = ctx(p);
    const div = 0.28 * (0.15 + 0.85 * 0.5);
    const motion = foundationTransitionScoreDetailed(em, pedal, c, noPressure).parts.movementFit / div;
    expect(motion).toBeCloseTo(0.5, 5);
  });

  it('weights motion above stability', () => {
    const p = pool();
    const c = ctx(p);
    const em = at(p, 4, 'minor');
    const parts = foundationTransitionScoreDetailed(em, at(p, 9), c, noPressure).parts; // E→A, desc fifth
    expect(parts.movementFit).toBeGreaterThan(parts.stabilityFit);
  });
});

describe('story pass — continuation off equal footing', () => {
  it('caps holdFit below the full common-tone credit', () => {
    const p = pool();
    const em = at(p, 4, 'minor');
    const held = foundationContinuationScoreDetailed(
      em, ctx(p, { stability: 1, movement: 0 }), {
        position: 'middle', sectionMovement: 0.5, changesPerBar: 2, shape: 'regular',
        anchorAfterMatches: false, arrivalIntention: null, arrivalPrev: null,
      },
      noPressure,
    );
    expect(held.parts.holdFit).toBeCloseTo(0.11, 5); // below the 0.12 change ceiling
    expect(held.parts.base).toBeCloseTo(0.15, 5);
  });

  it('keeps continuation reachable while purposeful motion outscores it at neutral', () => {
    const p = pool();
    const c = ctx(p);
    const em = at(p, 4, 'minor');
    const position = {
      position: 'middle' as const, sectionMovement: 0.5, changesPerBar: 2,
      shape: 'regular' as const, anchorAfterMatches: false, arrivalIntention: null, arrivalPrev: null,
    };
    const hold = foundationContinuationScoreDetailed(em, c, position, noPressure).total;
    const move = foundationTransitionScoreDetailed(em, at(p, 9), c, noPressure).total; // desc fifth
    expect(move).toBeGreaterThan(hold);
    // Not dwarfed either: continuation stays plainly reachable.
    expect(hold).toBeGreaterThan(move * 0.5);
  });
});

describe('story pass — the A-B-A correction', () => {
  const p = pool();
  const A = at(p, 4, 'minor'); // Em
  const B = at(p, 9);          // Am
  const C = at(p, 0);          // C

  it('does NOT penalize a plain A→B→A return', () => {
    expect(strictAlternationPenalty([A, B], A, false)).toBe(0);
    expect(strictAlternationPenalty([A, B, C], A, false)).toBe(0); // 3-back return too
    expect(strictAlternationPenalty([A, B, C, A], B, false)).toBe(0);
  });

  it('penalizes strict alternation A→B→A→B only', () => {
    expect(strictAlternationPenalty([A, B, A], B, false)).toBe(0.3);
    expect(strictAlternationPenalty([A, B, A, B, A], B, false)).toBe(0.3);
    expect(strictAlternationPenalty([A, B], B, false)).toBe(0); // immediate prolongation is not alternation
  });

  it('always exempts continuation (the sounding foundation)', () => {
    expect(strictAlternationPenalty([A, B, A], A, true)).toBe(0);
  });

  it('penalizes the doubled lead-in return mildly (A,A,B + A reads as hovering)', () => {
    expect(strictAlternationPenalty([A, A, B], A, false)).toBe(0.15);
    expect(strictAlternationPenalty([A, A, A, B], A, false)).toBe(0.15); // longer held run, same hover
    expect(strictAlternationPenalty([A, A, B], C, false)).toBe(0); // a different move is free
    expect(strictAlternationPenalty([A, B], A, false)).toBe(0); // single lead-in return stays legitimate
  });

  it('sees across the phrase boundary via the previous phrase tail', () => {
    // Alternation riding the boundary: previous phrase ended …A,B, this one
    // opened with A, candidate ping-pongs back to B.
    expect(strictAlternationPenalty([A], B, false, [A, B])).toBe(0.3);
    // Doubled lead-in across the boundary: previous phrase ended …A,A (a
    // boundary sustain), this phrase moved to B, candidate hovers back to A.
    expect(strictAlternationPenalty([B], A, false, [A, A])).toBe(0.15);
    // A plain cross-boundary return (…A | B, A) stays legitimate.
    expect(strictAlternationPenalty([B], A, false, [A])).toBe(0);
    // Continuation remains exempt with context present.
    expect(strictAlternationPenalty([A], A, true, [A, B])).toBe(0);
  });

  it('keeps the beam honest: no explored 2-back return carries a penalty', () => {
    const p2 = pool();
    const env = cadenceEnvironment(KEY, MODE);
    const slots = Array.from({ length: 8 }, (_, i) => ({
      startTick: i * 480, durationTicks: 480, windowIndex: 0, phraseEnd: i === 7,
    }));
    const w = window({
      endTick: 8 * 480,
      direction: { stability: 0.2, movement: 0.9, tension: 0.5 },
      prefs: { stability: 0.2, movement: 0.9, complexity: 0.65, tension: 0.5, modal: 0.5, contrast: 0.5, changesPerBar: 4, shape: 'regular' },
    });
    for (let seed = 1; seed <= 10; seed++) {
      const trace = {
        mode: 'beam' as const, reuseReason: null, forcedFirst: null, developOpeningOverride: null,
        poolSize: p2.all.length, slotCount: 8, beam: null, material: null,
        pathEvaluation: null, pathLabels: [],
      };
      selectWindowFoundations({
        window: w, slots, pool: p2, env, prev: null, after: null, material: null,
        settings: { complexity: 3, borrowing: 'more', variation: 1, density: 2, modalEmphasis: 0.3, preserveIdentity: true, sectionAware: true, seed },
        rng: mulberry32(hashString(`story-aba-${seed}`)), forcedFirst: null, isSongEnd: false, trace,
      });
      for (const st of trace.beam?.slots ?? []) {
        for (const cand of st.candidates) {
          const parts = cand.pathKey.split('>');
          if (cand.kind !== 'change' || parts.length < 3) continue;
          if (parts[parts.length - 1] === parts[parts.length - 3]) {
            // a 2-back return (…X→Y→X) — the old code taxed this. A tail that
            // is ALSO strict alternation (…X→Y→X→Y, i.e. parts[-2] ===
            // parts[-4]) is legitimately taxed 0.3 by the shared
            // strictAlternationPenalty — only PLAIN 2-back returns are free.
            if (parts.length >= 4 && parts[parts.length - 2] === parts[parts.length - 4]) continue;
            expect(cand.loopPenalty, `seed ${seed} path ${cand.pathKey}`).toBe(0);
          }
        }
      }
    }
  });
});

describe('story pass — rebalanced tonal pull', () => {
  it('halves the tonal-contact targets (establish 0.25, continue 0.2)', () => {
    const p = pool();
    const c = ctx(p);
    const em = at(p, 4, 'minor');
    const homePath = [em, em, em]; // contact ratio 1.0
    const establish = evaluatePathDetailed(homePath, window({ role: 'establish' }), c);
    expect(establish.components.tonalIdentity).toBeCloseTo(0.7 * (1 - Math.abs(1 - 0.25)), 5);
    const cont = evaluatePathDetailed(homePath, window({ role: 'continue' }), c);
    expect(cont.components.tonalIdentity).toBeCloseTo(0.5 * (1 - Math.abs(1 - 0.2)), 5);
  });

  it('cuts CENTER_NEED for body roles (continue 0.3, establish 1)', () => {
    const p = pool();
    const em = at(p, 4, 'minor');
    const position = {
      position: 'middle' as const, sectionMovement: 0.5, changesPerBar: 2,
      shape: 'regular' as const, anchorAfterMatches: false, arrivalIntention: null, arrivalPrev: null,
    };
    const body = foundationContinuationScoreDetailed(em, ctx(p, { role: 'continue' }), position, noPressure).parts;
    const frame = foundationContinuationScoreDetailed(em, ctx(p, { role: 'establish' }), position, noPressure).parts;
    const neutralMoveFactor = 0.35 + 0.65 * (1 - 0.5);
    expect(body.tonicReinforcement).toBeCloseTo(0.09 * 0.3 * neutralMoveFactor, 5);
    expect(frame.tonicReinforcement).toBeCloseTo(0.09 * 1 * neutralMoveFactor, 5);
  });
});

describe('story pass — section harmonic goals', () => {
  const sections: Section[] = [
    { id: 'a', name: 'Verse', startBar: 1, lengthBars: 8 },
    { id: 'b', name: 'Chorus', startBar: 9, lengthBars: 8 },
    { id: 'z', name: 'Outro', startBar: 17, lengthBars: 4 },
  ];

  it('samples deterministic, well-formed goals per section', () => {
    const project = fixture(sections);
    const p1 = planSongHarmony(project, { seed: 11 });
    const p2 = planSongHarmony(project, { seed: 11 });
    const kinds: SectionGoalKind[] = [
      'home-arrival', 'subdominant-arrival', 'dominant-arrival', 'mid-departure', 'static-home', 'journey',
    ];
    for (const plan of [p1, p2]) {
      expect(plan.sections.map((s) => s.goal.kind)).toEqual(p1.sections.map((s) => s.goal.kind));
      for (const s of plan.sections) {
        expect(kinds).toContain(s.goal.kind);
        expect(s.goal.description.length).toBeGreaterThan(5);
      }
    }
    // Different seeds can explore different goals.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      for (const s of planSongHarmony(project, { seed }).sections) seen.add(s.goal.kind);
    }
    expect(seen.size).toBeGreaterThanOrEqual(4); // the sampler is genuinely seeded
  });

  it('leans the final section home', () => {
    const project = fixture(sections);
    const profiles = buildSongHarmonyProfiles(project);
    const last = profiles.find((p) => p.context.isLast)!;
    const counts = new Map<SectionGoalKind, number>();
    for (let seed = 1; seed <= 40; seed++) {
      const k = sampleSectionGoal(last, seed).kind;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const home = counts.get('home-arrival') ?? 0;
    for (const [kind, n] of counts) {
      if (kind !== 'home-arrival') expect(home, `${kind} should not dominate the finale`).toBeGreaterThan(n);
    }
  });

  it('scores arrivals as a SEQUENCE against the goal', () => {
    const p = pool();
    const c = ctx(p);
    const em = at(p, 4, 'minor');
    const am = at(p, 9); // away from home in E Aeolian (shares only E)
    // home-arrival, last phrase: the tonic arrival pays off, an away arrival does not…
    const homeWin = window({ sectionGoal: { kind: 'home-arrival', description: 'x' }, isSectionLast: true });
    expect(sectionGoalFit([em], homeWin, c)).toBe(1);
    expect(sectionGoalFit([am], homeWin, c)).toBe(0.15);
    // …and mid-departure flips the preference for MIDDLE phrases, then back for the last.
    const mid = window({ sectionGoal: { kind: 'mid-departure', description: 'x' }, isSectionStart: false });
    expect(sectionGoalFit([am], mid, c)).toBeGreaterThan(sectionGoalFit([em], mid, c));
    const last = window({ sectionGoal: { kind: 'mid-departure', description: 'x' }, isSectionLast: true });
    expect(sectionGoalFit([em], last, c)).toBeGreaterThan(sectionGoalFit([am], last, c));
    // journey: distinct arrival roots score higher than repeated ones.
    const journey = window({ sectionGoal: { kind: 'journey', description: 'x' }, sectionArrivalRoots: [4, 9] });
    expect(sectionGoalFit([at(p, 0)], journey, c)).toBeGreaterThan(sectionGoalFit([at(p, 4)], journey, c));
  });

  it('feeds goalFit into the whole-path evaluation (weighted to the section last phrase)', () => {
    const p = pool();
    const c = ctx(p);
    const em = at(p, 4, 'minor');
    const am = at(p, 9);
    const goal = { kind: 'home-arrival' as const, description: 'x' };
    const lastWin = window({ sectionGoal: goal, isSectionLast: true });
    const midWin = window({ sectionGoal: goal, isSectionLast: false });
    const payoff = 0.3 * (sectionGoalFit([em], lastWin, c) - sectionGoalFit([am], lastWin, c));
    const pull = 0.12 * (sectionGoalFit([em], midWin, c) - sectionGoalFit([am], midWin, c));
    expect(evaluatePathDetailed([em], lastWin, c).components.goalFit
      - evaluatePathDetailed([am], lastWin, c).components.goalFit).toBeCloseTo(payoff, 5);
    expect(evaluatePathDetailed([em], midWin, c).components.goalFit
      - evaluatePathDetailed([am], midWin, c).components.goalFit).toBeCloseTo(pull, 5);
    // No goal → no component.
    expect(evaluatePathDetailed([em], window(), c).components.goalFit).toBe(0);
  });
});

describe('story pass — phrase-to-phrase contrast', () => {
  const p = pool();
  const c = ctx(p);
  const em = at(p, 4, 'minor');
  const am = at(p, 9);

  it('penalizes adjacent phrases that differ in nothing — hardest for continue/continue', () => {
    // [em, em]: density 0.5, realized arrival family 'pedal' (same root).
    const prior = { role: 'continue' as const, rootDensity: 0.5, arrivalFamily: 'pedal', foundationIds: [em.id] };
    const w = window({ role: 'continue', priorPhraseFeatures: prior });
    expect(phraseContrastPenalty([em, em], w, c)).toBeCloseTo(0.45, 5);
  });

  it('rewards contrast in any single dimension (no penalty)', () => {
    const prior = { role: 'continue' as const, rootDensity: 0.5, arrivalFamily: 'pedal', foundationIds: [em.id] };
    const w = window({ role: 'continue', priorPhraseFeatures: prior });
    // Different material AND different density — nothing flat about it.
    expect(phraseContrastPenalty([am, em], w, c)).toBe(0);
    // Different role: the continue/continue family rule does not fire.
    const w2 = window({ role: 'develop', priorPhraseFeatures: prior });
    expect(phraseContrastPenalty([em, em], w2, c)).toBeCloseTo(0.2, 5); // only the all-same penalty
  });

  it('is a penalty-only component of the path evaluation', () => {
    const prior = { role: 'continue' as const, rootDensity: 0.5, arrivalFamily: 'pedal', foundationIds: [em.id] };
    const w = window({ role: 'continue', priorPhraseFeatures: prior });
    const flat = evaluatePathDetailed([em, em], w, c);
    const varied = evaluatePathDetailed([am, em], w, c);
    expect(flat.components.contrastFit).toBeCloseTo(-0.45, 5);
    expect(varied.components.contrastFit).toBe(0);
    expect(varied.total).toBeGreaterThan(flat.total);
  });

  it('counts realized flat pairs in the generation report', () => {
    const project = fixture([
      { id: 'a', name: 'Verse', startBar: 1, lengthBars: 8 },
      { id: 'b', name: 'Chorus', startBar: 9, lengthBars: 8 },
      { id: 'c', name: 'Verse', startBar: 17, lengthBars: 8 },
      { id: 'd', name: 'Bridge', startBar: 25, lengthBars: 8 },
    ]);
    let flat = 0;
    let swaps = 0;
    let goalRows = 0;
    // 60 seeds: the mid-phrase resolution pull (positionScoreDetailed) made
    // weak-slot alignment swaps rarer — under the pull the first realized
    // swap across this fixture lands at seed 32 — while they still occur.
    // The sample widens so the guard keeps asserting OCCURRENCE across
    // seeds, not a rate.
    for (let seed = 1; seed <= 60; seed++) {
      const { report } = generateChordProgression(project, { seed });
      flat += report.phraseContrastPenalties;
      swaps += report.harmonicRhythmSwaps;
      expect(report.sectionGoals.length).toBe(4);
      for (const g of report.sectionGoals) {
        expect(g.description.length).toBeGreaterThan(5);
        expect(g.realizedArrivalFamilies.length).toBeLessThanOrEqual(report.phraseCount);
        goalRows += 1;
      }
    }
    expect(goalRows).toBe(240);
    expect(flat, 'flat adjacent-phrase pairs occur across seeds').toBeGreaterThanOrEqual(1);
    expect(swaps, 'weak-slot alignment swaps occur across seeds').toBeGreaterThanOrEqual(1);
  });
});

describe('story pass — develop phrases transform their material', () => {
  const p = pool();

  function developRun(seed: number) {
    const slots = Array.from({ length: 4 }, (_, i) => ({
      startTick: i * 960, durationTicks: 960, windowIndex: 0, phraseEnd: i === 3,
    }));
    const materialFoundations = [at(p, 4, 'minor'), at(p, 0), at(p, 9), at(p, 7)];
    const trace = {
      mode: 'beam' as const, reuseReason: null, forcedFirst: null, developOpeningOverride: null,
      poolSize: p.all.length, slotCount: 4, beam: null, material: null,
      pathEvaluation: null, pathLabels: [],
    };
    const out = selectWindowFoundations({
      window: window({
        role: 'develop',
        relatedPhraseIds: ['a#p0'],
      }),
      slots, pool: p, env: cadenceEnvironment(KEY, MODE), prev: null, after: null,
      material: { foundations: materialFoundations, mode: 'full', intention: null },
      settings: { complexity: 2, borrowing: 'some', variation: 0.5, density: 1, modalEmphasis: 0.3, preserveIdentity: true, sectionAware: true, seed },
      rng: mulberry32(hashString(`develop-${seed}`)), forcedFirst: null, isSongEnd: false, trace,
    });
    return { out, trace, source: materialFoundations };
  }

  it('records a bounded transformation and never claims one it did not apply', () => {
    let transformed = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const { out, trace, source } = developRun(seed);
      const transformation = trace.material?.developTransformation ?? null;
      const sourceIds = new Set(source.map((f) => f.id));
      if (transformation !== null) {
        transformed += 1;
        // The transformation genuinely changed the material.
        expect(out.foundations.some((f) => !sourceIds.has(f.id)), `seed ${seed}`).toBe(true);
        // And it is one of the three bounded moves.
        expect(['degree transpose', 'chromatic neighbor swap', 'contour inversion']).toContain(transformation);
      }
    }
    expect(transformed, 'transformations resolve for most seeds with a full pool').toBeGreaterThanOrEqual(12);
  });

  it('repeats still repeat: a repeat-role window copies its material', () => {
    const slots = Array.from({ length: 4 }, (_, i) => ({
      startTick: i * 960, durationTicks: 960, windowIndex: 0, phraseEnd: i === 3,
    }));
    const materialFoundations = [at(p, 4, 'minor'), at(p, 0), at(p, 9), at(p, 7)];
    const trace = {
      mode: 'beam' as const, reuseReason: null, forcedFirst: null, developOpeningOverride: null,
      poolSize: p.all.length, slotCount: 4, beam: null, material: null,
      pathEvaluation: null, pathLabels: [],
    };
    selectWindowFoundations({
      window: window({ role: 'repeat', relatedPhraseIds: ['a#p0'] }),
      slots, pool: p, env: cadenceEnvironment(KEY, MODE), prev: null, after: null,
      material: { foundations: materialFoundations, mode: 'full', intention: null },
      settings: { complexity: 2, borrowing: 'some', variation: 0, density: 1, modalEmphasis: 0.3, preserveIdentity: true, sectionAware: true, seed: 5 },
      rng: mulberry32(hashString('repeat-copy')), forcedFirst: null, isSongEnd: false, trace,
    });
    expect(trace.material?.developTransformation ?? null).toBeNull();
  });
});

describe('story pass — audition MIDI deltas are real deltas', () => {
  it('reconstructs absolute marker and note positions from delta times', () => {
    const project = fixture([
      { id: 'a', name: 'Verse', startBar: 1, lengthBars: 8 },
      { id: 'b', name: 'Chorus', startBar: 9, lengthBars: 8 },
    ]);
    const { chords } = generateChordProgression(project, { seed: 3 });
    const bytes = buildAuditionMidi(project, chords.map((c) => ({
      symbol: c.symbol, startTick: c.startTick, durationTicks: c.durationTicks,
    })));
    const parsed = parseMidi(bytes as unknown as Uint8Array);
    expect(parsed.header.numTracks).toBe(2);
    for (const track of parsed.tracks) {
      // Reconstruct absolute ticks; every delta must be non-negative and the
      // cursor must never go backwards.
      let abs = 0;
      for (const ev of track) {
        expect(ev.deltaTime).toBeGreaterThanOrEqual(0);
        abs += ev.deltaTime ?? 0;
      }
      // The old bug (delta = absolute) would make `abs` grow quadratically;
      // the reconstructed end must stay near the song length.
      expect(abs).toBeLessThanOrEqual(16 * 3840 + 480);
    }
    // The conductor track's markers land exactly on their section starts.
    const conductor = parsed.tracks[0];
    let abs = 0;
    const markerAbs: number[] = [];
    for (const ev of conductor) {
      abs += ev.deltaTime ?? 0;
      if (ev.type === 'marker') markerAbs.push(abs);
    }
    expect(markerAbs).toEqual(sections_of(project).map((s) => barToTick(s.startBar, project.timeSignature)));
    // The very first event sits at tick 0.
    expect(conductor[0].deltaTime).toBe(0);
  });
});

function sections_of(project: Project): Section[] {
  return [...project.sections].sort((a, b) => a.startBar - b.startBar);
}
