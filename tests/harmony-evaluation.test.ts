/**
 * Phase 5 tests — complete-progression evaluation & candidate selection
 * (spec §19, tests 1–15).
 *
 * The evaluator is a musical COMPARISON tool, so these tests pin its
 * MECHANICS and its CONTEXTUALITY, never specific musical verdicts:
 * structural/color separation, contextual re-evaluation of identical
 * material, duration-based continuation accounting, in-context chromatic
 * and cadence judgments, repeated-section recognition, bounded candidate
 * generation over the UNMODIFIED production generator, diversity
 * measurement, seeded selection with variation, scope safety, full mode and
 * tonic support, odd meters, performance guardrails and regression
 * equivalence with the Phase 4 generator.
 *
 * Heuristic scores are asserted RELATIVELY (a prepared cadence outranks an
 * unprepared one) or for MECHANICS (ranges, null-honesty, determinism) —
 * never as absolute claims of musical quality (spec §20).
 */
import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { projectFromFixture, type Project, type Section } from '../src/shared/schema';
import { DEFAULT_CHORDGEN_SETTINGS, type Chord } from '../src/shared/schema/types';
import type { ModeName } from '../src/shared/schema/modes';
import { barTicks } from '../src/shared/schema/meter';
import {
  buildEvaluationContext, evaluatePhrase, evaluateSongProgression,
  type EvaluationWindow,
} from '../src/engine/harmony/evaluation';
import {
  candidateSeed, generateEvaluatedProgression, generateProgressionCandidates,
  measureCandidateDiversity, selectProgression, MAX_CANDIDATE_COUNT,
} from '../src/engine/harmony/selection';
import { generateChordProgression } from '../src/engine/harmony/generation';
import { planSongHarmony } from '../src/engine/harmony/plan';

const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });

function makeProject(mode: ModeName = 'Aeolian', key = 4, sections: Section[] = [sec('a', 'Verse', 1, 8)]): Project {
  const base = projectFromFixture({ name: 'EvalTest', tracks: [] });
  return {
    ...base,
    key,
    mode,
    sections,
    chords: [],
    chordGenSettings: { ...DEFAULT_CHORDGEN_SETTINGS },
  };
}

/** Two bars of 4/4 at 960 PPQ. */
const BAR = barTicks({ numerator: 4, denominator: 4 });
let chordSeq = 0;
function chordRow(symbol: string, startBar0: number, bars: number, locked = false): Chord {
  chordSeq += 1;
  return {
    id: `t${chordSeq}`,
    symbol,
    startTick: startBar0 * BAR,
    durationTicks: bars * BAR,
    ...(locked ? { locked: true } : {}),
  };
}

/** Evaluation context + first window for a sectionless (synthetic-window)
 *  project — the focused harness for phrase-level tests. */
function phraseHarness(
  mode: ModeName,
  key: number,
  chords: Chord[],
): { context: ReturnType<typeof buildEvaluationContext>; window: EvaluationWindow } {
  const project = makeProject(mode, key, []);
  const plan = planSongHarmony(project, { seed: 5 });
  const context = buildEvaluationContext(project, plan);
  expect(context.windows.length).toBeGreaterThanOrEqual(1);
  return { context, window: context.windows[0] };
}

/* ------------------------------------------------------------------------ */

describe('Phase 5 — structural versus color evaluation (Test 1)', () => {
  it('Em→C→G and Em7→Cmaj7→Gmaj7 share one structural trajectory', () => {
    const triads = [chordRow('Em', 0, 2), chordRow('C', 2, 2), chordRow('G', 4, 4)];
    const sevenths = [chordRow('Em7', 0, 2), chordRow('Cmaj7', 2, 2), chordRow('Gmaj7', 4, 4)];
    const a = phraseHarness('Aeolian', 4, triads);
    const b = phraseHarness('Aeolian', 4, sevenths);

    const ea = evaluatePhrase(a.window, triads, a.context);
    const eb = evaluatePhrase(b.window, sevenths, b.context);

    // Same structural trajectory (Phase 4.1 extraction — extensions never
    // alter foundation identity, spec §5).
    expect(eb.facts.foundationLabels).toEqual(ea.facts.foundationLabels);
    expect(eb.facts.foundationLabels).toEqual(['E minor', 'C major', 'G major']);
    expect(eb.facts.structuralChanges).toBe(ea.facts.structuralChanges);
    expect(eb.facts.distinctRoots).toBe(ea.facts.distinctRoots);

    // Structural categories are identical; color may differ but must not
    // move the structural verdicts (spec §5, §11).
    expect(eb.scores.harmonicDirection).toBe(ea.scores.harmonicDirection);
    expect(eb.scores.movementFit).toBe(ea.scores.movementFit);
    expect(eb.scores.tonalIdentity).toBe(ea.scores.tonalIdentity);
    expect(eb.scores.chromaticCoherence).toBe(ea.scores.chromaticCoherence);
    expect(eb.facts.chromaticShare).toBe(ea.facts.chromaticShare);
  });
});

describe('Phase 5 — phrase context (Test 2)', () => {
  it('identical material evaluates differently under different phrase intentions', () => {
    const chords = [chordRow('Em', 0, 2), chordRow('G', 2, 2), chordRow('C', 4, 2), chordRow('G', 6, 2)];
    const { context, window } = phraseHarness('Aeolian', 4, chords);
    const establish: EvaluationWindow = { ...window, role: 'establish' };
    const contrast: EvaluationWindow = { ...window, role: 'contrast' };

    const e1 = evaluatePhrase(establish, chords, context);
    const e2 = evaluatePhrase(contrast, chords, context);

    // An establishing phrase is judged on communicating the center; a
    // contrasting phrase is not (§4, §12 — no fixed weights regardless of
    // context). Same chords, different contextual verdicts.
    expect(e1.scores.tonalIdentity).toBeGreaterThan(e2.scores.tonalIdentity);
    expect(e1.scores.total).not.toBe(e2.scores.total);
    // The objective facts are untouched by the role change.
    expect(e2.facts.foundationLabels).toEqual(e1.facts.foundationLabels);
    expect(e2.facts.structuralChanges).toBe(e1.facts.structuralChanges);
  });
});

describe('Phase 5 — tonal identity (Test 3)', () => {
  it('uses the selected key and mode, including symmetrical scales', () => {
    const centered = [chordRow('Em', 0, 2), chordRow('G', 2, 2), chordRow('C', 4, 2), chordRow('Em', 6, 2)];
    const avoidant = [chordRow('C', 0, 2), chordRow('G', 2, 2), chordRow('D', 4, 2), chordRow('G', 6, 2)];
    const a = phraseHarness('Aeolian', 4, centered);
    const b = phraseHarness('Aeolian', 4, avoidant);

    const ea = evaluatePhrase(a.window, centered, a.context);
    const eb = evaluatePhrase(b.window, avoidant, b.context);
    expect(ea.facts.tonalContactShare).toBeGreaterThan(eb.facts.tonalContactShare);
    expect(ea.scores.tonalIdentity).toBeGreaterThan(eb.scores.tonalIdentity);

    // Whole Tone: no traditional tonic function — evaluation runs its
    // recurrence/anchoring path and stays a bounded number (§7).
    const wtChords = [chordRow('Caug', 0, 2), chordRow('Daug', 2, 2), chordRow('Caug', 4, 4)];
    const w = phraseHarness('Whole Tone', 0, wtChords);
    const ew = evaluatePhrase(w.window, wtChords, w.context);
    expect(ew.scores.tonalIdentity).toBeGreaterThanOrEqual(0);
    expect(ew.scores.tonalIdentity).toBeLessThanOrEqual(1);
    expect(Number.isFinite(ew.scores.tonalIdentity)).toBe(true);
  });
});

describe('Phase 5 — continuation by duration (Test 4)', () => {
  it('a sustained harmony is one harmony, whatever the event count', () => {
    const sustained = [chordRow('Em', 0, 8)];
    const restruck = [
      chordRow('Em', 0, 2), chordRow('Em', 2, 2), chordRow('Em', 4, 2), chordRow('Em', 6, 2),
    ];
    const moving = [chordRow('Em', 0, 2), chordRow('G', 2, 2), chordRow('Em', 4, 2), chordRow('G', 6, 2)];
    const a = phraseHarness('Aeolian', 4, sustained);
    const b = phraseHarness('Aeolian', 4, restruck);
    const c = phraseHarness('Aeolian', 4, moving);

    // Neutral mid-phrase windows (no planned arrival): the question here is
    // purely whether re-articulations count as structural movement.
    const neutral = (h: ReturnType<typeof phraseHarness>): EvaluationWindow => ({
      ...h.window,
      arrivalPlanned: false,
      cadence: { intention: 'open', compatibleFamilies: [...h.window.cadence.compatibleFamilies] },
    });

    const ea = evaluatePhrase(neutral(a), sustained, a.context);
    const eb = evaluatePhrase(neutral(b), restruck, b.context);
    const ec = evaluatePhrase(neutral(c), moving, c.context);

    // Same foundation sounding for 8 bars reads identically whether it was
    // re-struck or held (§4 continuation, §12 actual durations).
    expect(eb.facts.eventCount).toBe(4);
    expect(ea.facts.eventCount).toBe(1);
    expect(eb.facts.structuralChanges).toBe(0);
    expect(ea.facts.structuralChanges).toBe(0);
    expect(eb.scores.movementFit).toBe(ea.scores.movementFit);
    expect(eb.scores.harmonicDirection).toBe(ea.scores.harmonicDirection);
    expect(eb.scores.tonalIdentity).toBe(ea.scores.tonalIdentity);
    // Real movement is a different structural fact.
    expect(ec.facts.structuralChanges).toBe(3);
    expect(ec.facts.structuralChanges).not.toBe(ea.facts.structuralChanges);
  });
});

describe('Phase 5 — chromatic coherence (Test 5)', () => {
  it('judges chromatic chords by context, not scale membership', () => {
    // C#dim7 leads into D (its core carries C#, a semitone below D) — a
    // chromatic departure with a purpose (§10).
    const purposeful = [
      chordRow('Em', 0, 2), chordRow('C#dim7', 2, 2), chordRow('D', 4, 2), chordRow('Em', 6, 2),
    ];
    // Bbmaj7 sits between unrelated harmonies with no shared tones and no
    // leading motion either side — arbitrary chromaticism.
    const arbitrary = [
      chordRow('Em', 0, 2), chordRow('Bbmaj7', 2, 2), chordRow('C', 4, 2), chordRow('Em', 6, 2),
    ];
    const a = phraseHarness('Aeolian', 4, purposeful);
    const b = phraseHarness('Aeolian', 4, arbitrary);

    const ea = evaluatePhrase(a.window, purposeful, a.context);
    const eb = evaluatePhrase(b.window, arbitrary, b.context);

    // Both carry the SAME amount of chromatic content (one non-diatonic
    // foundation) — the difference is contextual coherence, never quantity.
    expect(ea.facts.chromaticShare).toBeGreaterThan(0);
    expect(eb.facts.chromaticShare).toBeGreaterThan(0);
    expect(ea.scores.chromaticCoherence).toBeGreaterThan(eb.scores.chromaticCoherence);
  });
});

describe('Phase 5 — cadence evaluation (Test 6)', () => {
  it('considers the preceding harmony, not just the arrival chord', () => {
    const project = makeProject('Aeolian', 4, [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)]);
    const plan = planSongHarmony(project, { seed: 5 });
    const context = buildEvaluationContext(project, plan);
    const arrivalWindow = context.windows[context.windows.length - 1];
    expect(arrivalWindow.arrivalPlanned).toBe(true);

    // Arrival chord held fixed (Em at the song end); only the preparation
    // differs. G shares two core tones with Em (mediant preparation); Bb
    // shares none and sits outside the mode entirely.
    const prepared = [chordRow('G', 8, 3), chordRow('G', 11, 3), chordRow('Em', 14, 2)];
    const unrelated = [chordRow('Bb', 8, 3), chordRow('Bb', 11, 3), chordRow('Em', 14, 2)];

    const ea = evaluatePhrase(arrivalWindow, prepared, context);
    const eb = evaluatePhrase(arrivalWindow, unrelated, context);

    expect(ea.scores.cadenceFit).not.toBeNull();
    expect(eb.scores.cadenceFit).not.toBeNull();
    // Same arrival chord, different preparation, different cadence fit (§8).
    expect(ea.scores.cadenceFit!).toBeGreaterThan(eb.scores.cadenceFit!);
  });
});

describe('Phase 5 — repeated sections (Test 7)', () => {
  it('recognizes structural identity across different chord colors', () => {
    const project = makeProject('Aeolian', 4, [
      sec('v1', 'Verse 1', 1, 8), sec('c1', 'Chorus 1', 9, 8),
      sec('v2', 'Verse 2', 17, 8), sec('c2', 'Chorus 2', 25, 8),
    ]);
    const chords: Chord[] = [
      // Verse 1: triads.
      chordRow('Em', 0, 2), chordRow('C', 2, 2), chordRow('G', 4, 2), chordRow('D', 6, 2),
      // Chorus 1: a different route.
      chordRow('C', 8 * 1, 2), chordRow('G', 8 * 1 + 2, 2), chordRow('D', 8 * 1 + 4, 2), chordRow('Em', 8 * 1 + 6, 2),
      // Verse 2: the SAME foundations as Verse 1, different colors (§9).
      chordRow('Em7', 16, 2), chordRow('Cmaj7', 18, 2), chordRow('Gmaj7', 20, 2), chordRow('Dmaj7', 22, 2),
      // Chorus 2: the same foundations as Chorus 1, different colors again.
      chordRow('Cmaj7', 24, 2), chordRow('Gmaj7', 26, 2), chordRow('Dmaj7', 28, 2), chordRow('Em7', 30, 2),
    ];
    const plan = planSongHarmony(project, { seed: 5 });
    const evaluation = evaluateSongProgression(project, chords, plan);

    expect(evaluation.facts.relatedSectionPairs.length).toBeGreaterThanOrEqual(2);
    const v = evaluation.facts.relatedSectionPairs.find((p) => p.a === 'v1' && p.b === 'v2');
    const c = evaluation.facts.relatedSectionPairs.find((p) => p.a === 'c1' && p.b === 'c2');
    expect(v).toBeDefined();
    expect(c).toBeDefined();
    // Foundation sequences match despite different chord symbols — high
    // structural similarity for the repeat relationship (§9, §22.8).
    expect(v!.similarity).toBeGreaterThanOrEqual(0.7);
    expect(c!.similarity).toBeGreaterThanOrEqual(0.7);
    expect(evaluation.components.repeatedSectionIdentity).not.toBeNull();
  });
});

describe('Phase 5 — candidate diversity & selection (Tests 8, 9)', () => {
  const sections = [
    sec('intro', 'Intro', 1, 4), sec('v1', 'Verse 1', 5, 8), sec('c1', 'Chorus 1', 13, 8),
    sec('v2', 'Verse 2', 21, 8), sec('c2', 'Chorus 2', 29, 8),
  ];

  it('measures structural diversity between complete candidates', () => {
    const project = makeProject('Aeolian', 4, sections);
    const candidates = generateProgressionCandidates(project, { seed: 34 });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.length).toBeLessThanOrEqual(MAX_CANDIDATE_COUNT);
    // Candidate 0 is the untouched requested seed.
    expect(candidates[0].seed).toBe(34);
    expect(candidateSeed(34, 0)).toBe(34);
    expect(candidateSeed(34, 1)).not.toBe(34);

    const diversity = measureCandidateDiversity(candidates);
    expect(diversity.distinctSignatures).toBeGreaterThanOrEqual(2);
    expect(diversity.meanPairwiseDistance).toBeGreaterThan(0);

    // Selection machinery is sound: valid pick, honest competitive set.
    const { index, competitiveCount } = selectProgression(candidates, 34);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(candidates.length);
    expect(competitiveCount).toBeGreaterThanOrEqual(1);
    expect(competitiveCount).toBeLessThanOrEqual(candidates.length);
  });

  it('seeded selection keeps meaningful variation across seeds', () => {
    const project = makeProject('Aeolian', 4, sections);
    const selections = new Set<string>();
    for (const seed of [1, 2, 3, 5, 7, 11, 13, 17]) {
      const out = generateEvaluatedProgression(project, { seed });
      selections.add(out.selection.candidates[out.selection.selection.pickedIndex]
        .facts.structuralSignature.join('>'));
      // Every selected candidate satisfies the generation guarantees.
      expect(out.chords.length).toBeGreaterThan(0);
    }
    // Different seeds surface different musical outcomes (§15, §22.13) —
    // deterministic per seed, varied across the fixed seed list.
    expect(selections.size).toBeGreaterThanOrEqual(2);
  });

  it('identical input and seed produce identical output (Test 9)', () => {
    const project = makeProject('Aeolian', 4, sections);
    const a = generateEvaluatedProgression(project, { seed: 34 });
    const b = generateEvaluatedProgression(project, { seed: 34 });
    expect(JSON.stringify(a.chords)).toBe(JSON.stringify(b.chords));
    expect(a.evaluation.total).toBe(b.evaluation.total);
    expect(JSON.stringify(a.selection.candidateSeeds)).toBe(JSON.stringify(b.selection.candidateSeeds));
    expect(JSON.stringify(a.selection.candidates.map((c) => [c.seed, c.rank, c.totalScore])))
      .toBe(JSON.stringify(b.selection.candidates.map((c) => [c.seed, c.rank, c.totalScore])));
  });
});

describe('Phase 5 — scope safety (Test 10)', () => {
  it('whole-song evaluation never modifies protected chords', () => {
    const project = makeProject('Aeolian', 4, [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)]);
    const locked = chordRow('G', 8, 2, true);
    const manual = chordRow('Am', 4, 2); // unlocked, but OUTSIDE the selected section
    const outOfScope = chordRow('Em', 16, 2); // beyond the selected section's end
    const withChords: Project = { ...project, chords: [locked, manual, outOfScope] };

    // Section scope: only eligible unlocked chords inside the section are
    // replaced; everything else is byte-identical in the SELECTED result.
    const sectioned = generateEvaluatedProgression(withChords, {
      seed: 9, scope: { type: 'section', sectionId: 'b' },
    });
    expect(sectioned.chords).toContainEqual(locked);
    expect(sectioned.chords).toContainEqual(manual);
    expect(sectioned.chords).toContainEqual(outOfScope);
    const foundLocked = sectioned.chords.find((c) => c.id === locked.id)!;
    expect(foundLocked.locked).toBe(true);
    expect(foundLocked.symbol).toBe('G');
    expect(foundLocked.startTick).toBe(locked.startTick);

    // The protected material is identical in EVERY candidate — a candidate
    // may score poorly because of protected material, but the protected
    // material is never a variable (§16).
    for (const candidate of generateProgressionCandidates(withChords, {
      seed: 9, scope: { type: 'section', sectionId: 'b' },
    })) {
      expect(candidate.result.chords).toContainEqual(locked);
      expect(candidate.result.chords).toContainEqual(manual);
      expect(candidate.result.chords).toContainEqual(outOfScope);
    }

    // Gap-fill scope: every existing chord is preserved.
    const filled = generateEvaluatedProgression(withChords, { seed: 9, scope: { type: 'empty' } });
    expect(filled.chords).toContainEqual(locked);
    expect(filled.chords).toContainEqual(manual);
    expect(filled.chords).toContainEqual(outOfScope);

    // Full-song scope: locked chords survive everywhere.
    const full = generateEvaluatedProgression(withChords, { seed: 9, scope: { type: 'all' } });
    expect(full.chords).toContainEqual(locked);
  });
});

describe('Phase 5 — all modes and tonics (Tests 11, 12)', () => {
  const MODES: ModeName[] = [
    'Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian',
    'Harmonic Minor', 'Melodic Minor', 'Whole Tone',
    'Diminished (Half-Whole)', 'Diminished (Whole-Half)',
  ];

  it('evaluates and selects across all twelve modes', () => {
    for (const mode of MODES) {
      const project = makeProject(mode, 4, [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)]);
      const out = generateEvaluatedProgression(project, { seed: 5 });
      expect(out.chords.length).toBeGreaterThan(0);
      expect(out.evaluation.total).toBeGreaterThanOrEqual(0);
      expect(out.evaluation.total).toBeLessThanOrEqual(1);
      expect(out.evaluation.phrases.length).toBeGreaterThan(0);
      expect(Number.isFinite(out.evaluation.total)).toBe(true);
    }
  });

  it('evaluates and selects across all twelve chromatic tonics', () => {
    for (let key = 0; key < 12; key++) {
      const project = makeProject('Dorian', key, [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)]);
      const out = generateEvaluatedProgression(project, { seed: 5 });
      expect(out.chords.length).toBeGreaterThan(0);
      expect(out.evaluation.total).toBeGreaterThanOrEqual(0);
      expect(out.evaluation.total).toBeLessThanOrEqual(1);
    }
  });
});

describe('Phase 5 — odd sections and meters (Test 13)', () => {
  it('handles irregular section lengths in 4/4, 3/4 and 6/8', () => {
    const meters = [
      { numerator: 4, denominator: 4 },
      { numerator: 3, denominator: 4 },
      { numerator: 6, denominator: 8 },
    ];
    for (const timeSignature of meters) {
      const project = makeProject('Aeolian', 4, [sec('a', 'Intro', 1, 5), sec('b', 'Verse', 6, 7)]);
      project.timeSignature = timeSignature;
      const out = generateEvaluatedProgression(project, { seed: 11 });
      const bt = barTicks(timeSignature);
      const regionEnd = 12 * bt;
      // Exact, gapless, non-overlapping coverage of the whole span.
      const sorted = [...out.chords].sort((a, b) => a.startTick - b.startTick);
      expect(sorted[0].startTick).toBe(0);
      let cursor = 0;
      for (const c of sorted) {
        expect(c.startTick).toBe(cursor);
        expect(c.durationTicks).toBeGreaterThan(0);
        cursor += c.durationTicks;
      }
      expect(cursor).toBe(regionEnd);
      expect(out.evaluation.facts.durationBars).toBeCloseTo(12, 5);
    }
  });
});

describe('Phase 5 — performance guardrails (Test 14)', () => {
  it('evaluated generation stays interactive on representative projects', () => {
    const typical = makeProject('Aeolian', 4, [
      sec('intro', 'Intro', 1, 4), sec('v1', 'Verse 1', 5, 8), sec('c1', 'Chorus 1', 13, 8),
      sec('v2', 'Verse 2', 21, 8), sec('c2', 'Chorus 2', 29, 8),
    ]);
    // Warmup (module caches, JIT).
    generateEvaluatedProgression(typical, { seed: 1 });
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      generateEvaluatedProgression(typical, { seed: 100 + i });
      times.push(performance.now() - t0);
    }
    const meanTypical = times.reduce((s, v) => s + v, 0) / times.length;
    // Guardrail at 4× the §18 target (150 ms) to stay robust on slow CI;
    // measured means are recorded in the Phase 5 audit report.
    expect(meanTypical).toBeLessThan(600);

    const longSections: Section[] = [];
    for (let b = 1, i = 0; b <= 200; b += 8, i++) {
      longSections.push(sec(`s${i}`, i % 2 === 0 ? 'Verse' : 'Chorus', b, Math.min(8, 200 - b + 1)));
    }
    const long200 = makeProject('Aeolian', 4, longSections);
    generateEvaluatedProgression(long200, { seed: 1 });
    const t1 = performance.now();
    generateEvaluatedProgression(long200, { seed: 2 });
    const longMs = performance.now() - t1;
    expect(longMs).toBeLessThan(2000);
  });
});

describe('Phase 5 — regression guard (Test 15)', () => {
  it('candidateCount=1 is byte-equivalent to the plain Phase 4 generator', () => {
    const project = makeProject('Aeolian', 4, [
      sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8),
    ]);
    const single = generateEvaluatedProgression(project, { seed: 34, candidateCount: 1 });
    const plain = generateChordProgression(project, { seed: 34 });
    expect(JSON.stringify(single.chords)).toBe(JSON.stringify(plain.chords));
    expect(single.report.generatedChordCount).toBe(plain.report.generatedChordCount);
    expect(single.report.structuralFoundations).toEqual(plain.report.structuralFoundations);
    expect(single.report.preservedChordCount).toBe(plain.report.preservedChordCount);
  });

  it('selected output keeps every generation invariant', () => {
    const project = makeProject('Aeolian', 4, [
      sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8),
    ]);
    const locked = chordRow('Bm', 8, 2, true);
    const withLock: Project = { ...project, chords: [locked] };
    const out = generateEvaluatedProgression(withLock, { seed: 21 });
    const bt = barTicks(project.timeSignature);
    const regionEnd = 16 * bt;
    const sorted = [...out.chords].sort((a, b) => a.startTick - b.startTick);
    expect(sorted[0].startTick).toBe(0);
    let cursor = 0;
    for (const c of sorted) {
      expect(c.startTick).toBe(cursor);
      expect(c.durationTicks).toBeGreaterThan(0);
      cursor += c.durationTicks;
    }
    expect(cursor).toBe(regionEnd);
    // The locked chord survives with its identity and protection.
    const survived = out.chords.find((c) => c.id === locked.id)!;
    expect(survived.symbol).toBe('Bm');
    expect(survived.locked).toBe(true);
    // Objective/heuristic separation is present in the report (§17).
    expect(out.selection.candidates.length).toBeGreaterThan(0);
    expect(out.selection.diversity.distinctSignatures).toBeGreaterThan(0);
    expect(typeof out.evaluation.total).toBe('number');
  });
});
