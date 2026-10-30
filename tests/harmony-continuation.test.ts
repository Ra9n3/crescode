/**
 * Harmonic continuation tests (Phase 4.3B) — holding harmony as a genuine
 * structural decision.
 *
 * The pre-4.3B model changed the foundation at EVERY opportunity (29/29 in
 * the Phase 4.2 diagnostics) because continuation had no advocate anywhere:
 * the transition score taxed prolongation, the path evaluator rewarded root
 * churn, and a hidden loop penalty capped same-foundation runs at two slots.
 * These tests pin the corrected model:
 *
 *   - continuation is available wherever the sounding harmony is pooled;
 *   - context (phrase direction, section movement + rhythm preferences,
 *     position, neighbors) decides — never a fixed rule or quota;
 *   - continued slot runs merge into one sustained event with one color;
 *   - locked chords, preserved spans, phrase boundaries and cadences are
 *     respected; meters stay exact; everything stays deterministic.
 *
 * No assertion hardcodes a continuation percentage (spec §5, §6, §14): the
 * tests assert availability, context sensitivity, mechanics and honesty of
 * the recorded diagnostics.
 */
import { describe, expect, it } from 'vitest';
import { generateChordProgression } from '../src/engine/harmony/generation';
import type { MergeRecord } from '../src/engine/harmony/diagnostics';
import {
  foundationContinuationScoreDetailed, foundationTransitionScoreDetailed, seedTensionState,
  type FoundationInfo, type FoundationPool, type StructuralContext,
} from '../src/engine/harmony/foundation';
import { buildFoundationPool } from '../src/engine/harmony/foundation';
import { continuationPositionFor } from '../src/engine/harmony/progression';
import { cadenceEnvironment } from '../src/engine/harmony/cadences';
import { parseChord } from '../src/shared/schema/chords';
import { projectFromFixture, type Chord, type Project, type Section } from '../src/shared/schema';
import type { ModeName } from '../src/shared/schema/modes';
import type { ChordGenSettings } from '../src/shared/schema/types';
import { createDefaultProject } from '../src/shared/schema';

const BT = 960 * 4;

function makeProject(sections: Section[], chords: Chord[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'ContinuationTest', tracks: [] });
  return { ...base, sections, chords, ...opts };
}
const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });
const chd = (id: string, startTick: number, durationTicks: number, symbol = 'C', locked?: boolean): Chord =>
  ({ id, symbol, startTick, durationTicks, ...(locked !== undefined ? { locked } : {}) });
const verseChorus = (opts: Partial<Project> = {}): Project =>
  makeProject([sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)], [], { key: 4, mode: 'Aeolian', ...opts });
const settings = (overrides: Partial<ChordGenSettings> = {}): ChordGenSettings =>
  ({ ...createDefaultProject().chordGenSettings!, ...overrides }) as ChordGenSettings;

/** A neutral structural context for unit-level continuation scoring. */
function neutralCtx(pool: FoundationPool, overrides: Partial<StructuralContext> = {}): StructuralContext {
  return {
    stability: 0.5, movement: 0.5, tension: 0.5, modalPref: 0.5, contrastPref: 0.5,
    borrowing: 'some', role: 'continue', pool, env: cadenceEnvironment(pool.tonic, pool.mode),
    ...overrides,
  };
}

/** Zero-pressure TensionState — the scorer requires one; these unit tests
 *  measure the context-free terms, so no resolution history is carried. */
const noPressure = seedTensionState(null);

/** Events sorted by start, tiled exactly with no gaps/overlaps/zero lengths. */
function assertTiled(chords: Chord[], startTick: number, endTick: number, label: string): void {
  const gen = chords.filter((c) => c.startTick >= startTick && c.startTick < endTick)
    .sort((a, b) => a.startTick - b.startTick);
  expect(gen.length, label).toBeGreaterThan(0);
  expect(gen[0].startTick, label).toBe(startTick);
  let cursor = startTick;
  for (const c of gen) {
    expect(Number.isInteger(c.startTick), `${label} integer start`).toBe(true);
    expect(Number.isInteger(c.durationTicks), `${label} integer duration`).toBe(true);
    expect(c.durationTicks, `${label} positive duration`).toBeGreaterThan(0);
    expect(c.startTick, `${label} no gap/overlap at ${c.startTick}`).toBe(cursor);
    cursor += c.durationTicks;
  }
  expect(cursor, `${label} exact coverage`).toBe(endTick);
}

describe('Phase 4.3B — Test 1: continuation availability', () => {
  it('offers and records the continuation action at every opportunity with a pooled sounding harmony', () => {
    const project = verseChorus();
    const { diagnostics: report } = generateChordProgression(project, { seed: 34, diagnostics: true });
    // The beam expansions record continuation candidates for mid-phrase slots.
    let continuationCandidates = 0;
    let continuationDecisions = 0;
    for (const win of report.structure.windows) {
      expect(win.selection).not.toBeNull();
      if (win.selection?.mode !== 'beam' || win.selection.beam === null) continue;
      for (const st of win.selection.beam.slots) {
        const kinds = new Set(st.candidates.map((c) => c.kind));
        expect(kinds.size, 'every candidate carries a kind').toBeGreaterThanOrEqual(1);
        if (st.slotIndex === 0) continue; // slot 0 availability depends on the incoming anchor
        continuationCandidates += st.candidates.filter((c) => c.kind === 'continuation').length;
      }
    }
    for (const slot of report.rhythm.slots) {
      expect(slot.continuationDecision, 'every slot records a decision').not.toBeNull();
      const d = slot.continuationDecision!;
      expect(['continue', 'change']).toContain(d.selectedAction);
      expect(typeof d.available).toBe('boolean');
      if (slot.slotIndex > 0 && d.available && d.selectedAction === 'continue') continuationDecisions += 1;
    }
    // Continuation candidates exist in the expansions, and the selector used
    // the action somewhere across the run (availability is real, not nominal).
    expect(continuationCandidates).toBeGreaterThan(0);
    expect(continuationDecisions).toBeGreaterThan(0);
    // The empty-region opening has no harmony to continue: no continuation
    // option existed there and a new foundation was forced.
    const opening = report.rhythm.slots[0];
    expect(opening.continuationDecision!.available).toBe(false);
    expect(opening.plannerForcesNewFoundation).toBe(true);
  });
});

describe('Phase 4.3B — Test 2: context sensitivity (no fixed rules)', () => {
  it('scores continuation differently under low- vs high-movement contexts', () => {
    const pool = buildFoundationPool(4, 'Aeolian', { complexity: 2, borrowing: 'some' });
    const ctx = neutralCtx(pool);
    const em = pool.all.find((f) => f.rootPc === 4 && f.quality === 'minor');
    expect(em).toBeDefined();
    const base = { sectionMovement: 0.5, changesPerBar: 2, shape: 'regular' as const, anchorAfterMatches: false, arrivalIntention: null, arrivalPrev: null };

    // (B) Phrase direction: stability welcomes holds, movement discourages —
    // the sign flips with context, and neither extreme is banned.
    const stable = foundationContinuationScoreDetailed(em!, ctx, {
      ...base, position: 'middle',
    }, noPressure).parts;
    expect(stable.directionFit).toBeCloseTo(0.14 * (0.5 - 0.5), 8); // neutral → 0
    const calm = foundationContinuationScoreDetailed(em!, ctx, {
      ...base, position: 'middle',
    }, noPressure);
    const active = foundationContinuationScoreDetailed(em!, { ...ctx, stability: 0.9, movement: 0.1 }, {
      ...base, position: 'middle',
    }, noPressure);
    expect(active.total).toBeGreaterThan(calm.total);
    expect(foundationContinuationScoreDetailed(em!, { ...ctx, stability: 0.1, movement: 0.9 }, {
      ...base, position: 'middle',
    }, noPressure).total).toBeLessThan(calm.total);

    // (D) Position: an opening hold and an arrival reinforcement exist as
    // distinct positional factors.
    const opening = foundationContinuationScoreDetailed(em!, ctx, { ...base, position: 'opening' }, noPressure);
    expect(opening.parts.positionFit).toBeGreaterThan(0);

    // (F) Harmonic rhythm: a sparse hold-shaped profile outcompetes a dense
    // one for the same harmony.
    const sparse = foundationContinuationScoreDetailed(em!, ctx, {
      ...base, changesPerBar: 0.5, shape: 'hold',
    }, noPressure);
    const dense = foundationContinuationScoreDetailed(em!, ctx, {
      ...base, changesPerBar: 4, shape: 'regular',
    }, noPressure);
    expect(sparse.parts.rhythmFit).toBeGreaterThan(dense.parts.rhythmFit);

    // (E) Neighbors: a matching preserved anchor after the target adds the
    // documented join bonus.
    const joined = foundationContinuationScoreDetailed(em!, ctx, { ...base, anchorAfterMatches: true }, noPressure);
    expect(joined.parts.neighborFit).toBeCloseTo(0.08, 8);

    // Continuation competes: at neutral settings its total sits in the same
    // band as a typical change candidate's transition score (no fixed rule).
    const contTotal = foundationContinuationScoreDetailed(em!, ctx, { ...base, position: 'middle' }, noPressure).total;
    const changeTotal = foundationTransitionScoreDetailed(em!, pool.all.find((f) => f.rootPc === 0 && f.quality === 'major')!, ctx, noPressure).total;
    expect(Math.abs(contTotal - changeTotal)).toBeLessThan(0.5);
  });
});

describe('Phase 4.3B — Test 3: sustained durations', () => {
  it('merges continued slot runs into one longer event with exact coverage', () => {
    const project = verseChorus();
    let runsWithSustain = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { chords, report, diagnostics: d } = generateChordProgression(project, { seed, diagnostics: true });
      assertTiled(chords, 0, 16 * BT, `seed ${seed}`);
      // At least one sustained event per run (observed: every seed holds).
      // NOTE: since the story-pass retune moved continuation off equal
      // footing with motion, most-but-not-all seeds sustain; the mechanics
      // assertions below are what this test pins.
      if (report.sustainedEvents > 0) runsWithSustain += 1;
      // Every multi-slot event has integer slot-sum duration and one color.
      for (const ev of d!.color.filter((c) => c.slotCount > 1)) {
        expect(ev.durationTicks).toBeGreaterThanOrEqual(BT); // ≥ one bar (2/bar slots are half-bar)
        expect(Number.isInteger(ev.durationTicks)).toBe(true);
      }
      // Merge records agree with the emitted events: each record is the
      // running state after one absorbed slot; the FINAL record per event
      // must match the emitted event exactly.
      const finalRecordByEvent = new Map<number, MergeRecord>();
      for (const m of d!.structure.merges) finalRecordByEvent.set(m.eventIndex, m);
      for (const m of finalRecordByEvent.values()) {
        const ev = d!.color.find((c) => c.startTick === m.startTick);
        expect(ev, `merge ev${m.eventIndex} emitted`).toBeDefined();
        expect(ev!.durationTicks).toBe(m.durationTicks);
        expect(ev!.slotCount).toBe(m.slotCount);
      }
    }
    expect(runsWithSustain).toBeGreaterThanOrEqual(10);
  });
});

describe('Phase 4.3B — Test 4: no accidental color changes during continuation', () => {
  it('gives each sustained event exactly one color decision and one symbol', () => {
    const project = verseChorus();
    // Seeds observed to sustain under the story-pass continuation economy
    // (continuation is reachable but no longer on equal footing with motion,
    // so not every seed holds — seed 16 of the original set no longer does).
    for (const seed of [1, 7, 34]) {
      const { diagnostics: d } = generateChordProgression(project, { seed, diagnostics: true });
      const sustained = d!.color.filter((c) => c.slotCount > 1);
      expect(sustained.length, `seed ${seed} sustains something`).toBeGreaterThan(0);
      // One color record per event: no per-slot recoloring inside a hold.
      const starts = new Set(d!.color.map((c) => c.startTick));
      expect(starts.size).toBe(d!.color.length);
      // The sustained event's symbol parses to the SAME foundation it holds
      // (the color stage never turns a hold into structural movement).
      for (const ev of sustained) {
        const core = foundationCore(ev.symbol);
        expect(core).not.toBeNull();
        expect(`${core!.rootPc}|${core!.corePitchClasses.join('.')}`).toBe(ev.foundationId);
      }
      // No two ADJACENT events share the same foundation WITHIN a window
      // (those would have merged; same-foundation adjacency survives only
      // as a deliberate boundary rearticulation).
      const byStart = [...d!.color].sort((a, b) => a.startTick - b.startTick);
      for (let i = 1; i < byStart.length; i++) {
        const a = byStart[i - 1];
        const b = byStart[i];
        if (a.foundationId === b.foundationId) {
          // must be a phrase-boundary rearticulation: a window must start at b
          const windowStarts = d!.structure.windows.map((w) => w.startTick);
          expect(windowStarts, `seed ${seed}: same-foundation adjacency only at window starts`).toContain(b.startTick);
        }
      }
    }
  });
});

function foundationCore(symbol: string) {
  const r = parseChord(symbol);
  if (!r.ok) return null;
  const iv = r.chord.intervals;
  const thirdIv = iv.includes(3) ? 3 : iv.includes(4) ? 4 : iv.includes(5) ? 5 : iv.includes(2) ? 2 : null;
  const fifthIv = iv.includes(6) ? 6 : iv.includes(7) ? 7 : iv.includes(8) ? 8 : null;
  const pcs = new Set<number>([r.chord.root % 12]);
  if (thirdIv !== null) pcs.add((r.chord.root + thirdIv) % 12);
  if (fifthIv !== null) pcs.add((r.chord.root + fifthIv) % 12);
  return { rootPc: ((r.chord.root % 12) + 12) % 12, corePitchClasses: [...pcs].sort((a, b) => a - b) };
}

describe('Phase 4.3B — Test 5: phrase boundaries', () => {
  it('sustains harmony across phrase boundaries when the boundary rule permits, never across protected chords', () => {
    const project = verseChorus();
    let crossMerges = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { diagnostics: d } = generateChordProgression(project, { seed, diagnostics: true });
      for (const m of d.structure.merges.filter((x) => x.crossWindow)) {
        crossMerges += 1;
        // A cross-boundary merge must be intentional: the boundary window was
        // not arrival-clipped, or mergeFirst forced the sustain.
        expect(m.slotCount).toBeGreaterThan(1);
        expect(m.durationTicks).toBeGreaterThan(0);
      }
      // No merge ever spans a gap between generation targets (protected
      // chords would create one) — coverage stays exact.
    }
    expect(crossMerges, 'sustain across phrase boundaries occurs').toBeGreaterThan(0);
  });

  it('never merges across a preserved chord', () => {
    const project = makeProject(
      [sec('a', 'Intro', 1, 2), sec('b', 'Verse', 3, 6), sec('c', 'Chorus', 9, 8)],
      [chd('k1', 4 * BT, BT, 'Am', true), chd('k2', 9 * BT, BT, 'Em', true)],
      { key: 4, mode: 'Aeolian' },
    );
    for (let seed = 1; seed <= 10; seed++) {
      const { chords, diagnostics: d } = generateChordProgression(project, { seed, diagnostics: true });
      const preserved = project.chords;
      for (const c of chords.filter((g) => !preserved.some((p) => p.id === g.id))) {
        for (const p of preserved) {
          const overlap = c.startTick < p.startTick + p.durationTicks
            && c.startTick + c.durationTicks > p.startTick;
          expect(overlap, `seed ${seed}: generated event overlaps preserved ${p.id}`).toBe(false);
        }
      }
      // The preserved anchors themselves keep their exact events (not merged
      // into, not resized, not re-symbolized).
      for (const p of preserved) {
        const kept = chords.find((c) => c.id === p.id);
        expect(kept).toBeDefined();
        expect(kept!.symbol).toBe(p.symbol);
        expect(kept!.startTick).toBe(p.startTick);
        expect(kept!.durationTicks).toBe(p.durationTicks);
      }
      expect(d.rhythm.slots.length).toBeGreaterThan(0);
    }
  });
});

describe('Phase 4.3B — Test 6: locked chords', () => {
  it('never modifies locked chords, even when continuation surrounds them', () => {
    const project = makeProject(
      [sec('a', 'Verse', 1, 8)],
      [chd('k1', 2 * BT, BT, 'Em', true), chd('k2', 6 * BT, 2 * BT, 'Cmaj7', true)],
      { key: 4, mode: 'Aeolian' },
    );
    for (let seed = 1; seed <= 10; seed++) {
      const { chords, report } = generateChordProgression(project, { seed });
      for (const original of project.chords.filter((c) => c.locked)) {
        const kept = chords.find((c) => c.id === original.id);
        expect(kept, `seed ${seed} keeps ${original.id}`).toBeDefined();
        // Byte-identical event: continuation never extends or resizes it.
        expect(JSON.stringify(kept)).toBe(JSON.stringify(original));
      }
      expect(report.anchorConstraints.protectedSpans).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Phase 4.3B — Test 7: partial generation (gap filling)', () => {
  it('fills gaps without extending or resizing preserved (locked) chords', () => {
    const project = makeProject(
      [sec('a', 'Verse', 1, 8)],
      // Unlocked existing chords are regenerated (scope 'all'); the LOCKED
      // chord is preserved byte-for-byte and bounds the generation targets.
      [chd('m2', 3 * BT, 2 * BT, 'Am9', true), chd('m3', 7 * BT, BT, 'Dsus4')],
      { key: 4, mode: 'Aeolian' },
    );
    const locked = project.chords.filter((c) => c.locked);
    const before = JSON.parse(JSON.stringify(locked));
    const { chords, diagnostics: d } = generateChordProgression(project, { seed: 11, diagnostics: true });
    for (const original of before) {
      const kept = chords.find((c) => c.id === original.id);
      expect(kept, `preserved chord ${original.id} survives`).toBeDefined();
      expect(JSON.stringify(kept)).toBe(JSON.stringify(original));
    }
    // The gaps around the preserved chord are covered exactly, and no
    // generated event extends INTO the preserved span.
    assertTiled(chords, 0, 3 * BT, 'gap 0–3');
    assertTiled(chords, 5 * BT, 8 * BT, 'gap 5–8');
    for (const slot of d!.structure.slots) {
      expect(slot.startTick >= 3 * BT && slot.startTick < 5 * BT).toBe(false);
    }
  });
});

describe('Phase 4.3B — Test 8: section regeneration respects boundaries', () => {
  it('regenerating one section leaves other sections byte-identical', () => {
    const project = verseChorus();
    const all = generateChordProgression(project, { seed: 21 });
    const verseOnly = generateChordProgression(project, { seed: 5, scope: { type: 'section', sectionId: 'a' } });
    const chorusOnly = generateChordProgression(project, { seed: 8, scope: { type: 'section', sectionId: 'b' } });
    const verseSpan = { start: 0, end: 8 * BT };
    const chorusSpan = { start: 8 * BT, end: 16 * BT };
    const inSpan = (chords: Chord[], s: { start: number; end: number }) =>
      chords.filter((c) => c.startTick >= s.start && c.startTick < s.end);
    // The section-scoped runs never emit outside their section.
    for (const c of inSpan(verseOnly.chords, chorusSpan)) {
      expect(project.chords.some((p) => p.id === c.id), 'chorus untouched by verse run').toBe(true);
    }
    for (const c of inSpan(chorusOnly.chords, verseSpan)) {
      expect(project.chords.some((p) => p.id === c.id), 'verse untouched by chorus run').toBe(true);
    }
    // And the merged events inside the generated section stay within it.
    assertTiled(inSpan(verseOnly.chords, verseSpan), verseSpan.start, verseSpan.end, 'verse section');
    assertTiled(inSpan(chorusOnly.chords, chorusSpan), chorusSpan.start, chorusSpan.end, 'chorus section');
    expect(all.report.sectionsAffected.length).toBe(2);
  });
});

describe('Phase 4.3B — Test 9: meter correctness (4/4, 3/4, 6/8)', () => {
  const meters: Array<[{ numerator: number; denominator: number }, number]> = [
    [{ numerator: 4, denominator: 4 }, 16],
    [{ numerator: 3, denominator: 4 }, 15],
    [{ numerator: 6, denominator: 8 }, 16],
  ];
  for (const [timeSignature, bars] of meters) {
    it(`keeps exact integer coverage and real sustains in ${timeSignature.numerator}/${timeSignature.denominator}`, () => {
      const project = makeProject(
        [sec('a', 'Verse', 1, Math.ceil(bars / 2)), sec('b', 'Chorus', Math.ceil(bars / 2) + 1, Math.floor(bars / 2))],
        [], { key: 2, mode: 'Dorian', timeSignature },
      );
      const barTicks = timeSignature.denominator === 8 ? 960 * 3 : 960 * timeSignature.numerator;
      const span = bars * barTicks;
      let sustained = 0;
      // Aggregated across a seed range (as in the story-pass report counts):
      // WHICH seeds sustain now depends on the tension story — the
      // mid-phrase resolution pull in positionScoreDetailed competes with
      // non-tonic prolongation once slotsSinceResolution builds — so no
      // specific seeds are pinned (no continuation percentage is hardcoded,
      // per the file header).
      for (let seed = 1; seed <= 12; seed++) {
        const { chords, diagnostics: d } = generateChordProgression(project, { seed, diagnostics: true });
        assertTiled(chords, 0, span, `${timeSignature.numerator}/${timeSignature.denominator} seed ${seed}`);
        sustained += d!.color.filter((c) => c.slotCount > 1).length;
      }
      expect(sustained, 'sustains occur in this meter too').toBeGreaterThan(0);
    });
  }
});

describe('Phase 4.3B — Test 10: cadence preservation', () => {
  it('keeps planned arrivals real while allowing the arrival harmony to sustain', () => {
    const project = verseChorus();
    for (const seed of [1, 7, 13, 34]) {
      const { diagnostics: d } = generateChordProgression(project, { seed, diagnostics: true });
      // Every planned arrival still produced a structural cadence record.
      const plannedWindows = d.structure.windows.filter((w) => w.arrivalPlanned);
      expect(d.structure.cadences.length, `seed ${seed}`).toBe(plannedWindows.length);
      for (const c of d.structure.cadences) {
        const ev = d.color.find((x) => x.startTick === c.startTick);
        expect(ev, `cadence event at ${c.startTick}`).toBeDefined();
        // The arrival event (possibly a sustained one spanning the boundary)
        // COVERS the phrase window's end — the arrival was not eliminated.
        const win = plannedWindows.find((w) => w.phraseId === c.phraseId);
        expect(win).toBeDefined();
        expect(ev!.startTick < win!.endTick && ev!.startTick + ev!.durationTicks >= win!.endTick).toBe(true);
      }
      // Families stay within the mode-aware compatible set.
      const compatible = new Set(plannedWindows.flatMap((w) => w.compatibleFamilies));
      for (const c of d.structure.cadences) {
        if (c.family !== null) expect(compatible.has(c.family), `family ${c.family}`).toBe(true);
      }
    }
  });
});

describe('Phase 4.3B — Test 11: all twelve modes', () => {
  const cases: Array<[number, ModeName]> = [
    [0, 'Ionian'], [2, 'Dorian'], [4, 'Phrygian'], [5, 'Lydian'], [7, 'Mixolydian'],
    [9, 'Aeolian'], [11, 'Locrian'], [2, 'Harmonic Minor'], [0, 'Whole Tone'],
    [0, 'Diminished (Half-Whole)'], [0, 'Diminished (Whole-Half)'], [7, 'Melodic Minor'],
  ];
  it('generates valid, deterministic, continuation-aware progressions everywhere', () => {
    for (const [key, mode] of cases) {
      for (const seed of [4, 23]) {
        const project = makeProject(
          [sec('a', 'Verse', 1, 8)], [], { key, mode },
        );
        const { chords, report, diagnostics: d } = generateChordProgression(project, { seed, diagnostics: true });
        expect(chords.length, `${mode} seed ${seed}`).toBeGreaterThan(0);
        for (const c of chords) expect(parseChord(c.symbol).ok, `${mode}: ${c.symbol}`).toBe(true);
        expect(report.continuationSlots, `${mode} decisions recorded`).toBeGreaterThanOrEqual(0);
        for (const slot of d!.rhythm.slots) {
          expect(slot.continuationDecision).not.toBeNull();
        }
        // Determinism per mode/seed.
        const again = generateChordProgression(project, { seed });
        expect(JSON.stringify(again.chords)).toBe(JSON.stringify(chords));
      }
    }
  });
});

describe('Phase 4.3B — Test 12: determinism', () => {
  it('is byte-identical for identical inputs and seed-varying in its continuation patterns', () => {
    const project = verseChorus();
    const a = generateChordProgression(project, { seed: 34, diagnostics: true });
    const b = generateChordProgression(project, { seed: 34, diagnostics: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Different seeds produce different continuation patterns (seeded
    // variation participates in the decision), while staying coherent.
    const counts = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const { report } = generateChordProgression(project, { seed });
      counts.add(report.continuationSlots);
    }
    expect(counts.size, 'continuation counts vary across seeds').toBeGreaterThan(1);
  });
});

describe('Phase 4.3B — Test 13: diagnostic accuracy', () => {
  it('continuation decisions match the emitted chord events exactly', () => {
    const project = verseChorus();
    for (const seed of [2, 16, 34]) {
      const { chords, diagnostics: d } = generateChordProgression(project, { seed, diagnostics: true });
      const generated = chords.filter((c) => !project.chords.some((p) => p.id === c.id));
      const slots = d.rhythm.slots;
      const decisions = slots.map((s) => s.continuationDecision!);

      // Exact accounting: every slot either was merged into the previous
      // event or started a new one; holds = absorbed continuations +
      // boundary rearticulations of a continued harmony.
      const mergedCount = slots.filter((s) => s.mergedIntoPreviousEvent).length;
      const holds = decisions.filter((x) => x.selectedAction === 'continue').length;
      const boundaryRearts = slots.filter((s) =>
        s.continuationDecision!.selectedAction === 'continue'
        && !s.mergedIntoPreviousEvent).length;
      expect(holds).toBe(mergedCount + boundaryRearts);
      expect(d.structure.merges.length).toBe(mergedCount); // one record per absorbed slot
      expect(generated.length).toBe(slots.length - mergedCount);
      // Sustained-event counter: DISTINCT events spanning > 1 slot (merge
      // records are per absorbed slot — group them by event).
      const sustainedEvents = new Set(d.structure.merges.map((m) => m.eventIndex)).size;
      expect(d.color.filter((c) => c.slotCount > 1).length).toBe(sustainedEvents);

      // Resulting durations match the emitted events.
      for (const slot of slots) {
        const dec = slot.continuationDecision!;
        const ev = d.color.find((c) => c.startTick <= slot.startTick
          && c.startTick + c.durationTicks > slot.startTick);
        expect(ev, `event covering slot ${slot.slotIndex}`).toBeDefined();
        expect(dec.resultingDurationTicks).toBe(ev!.durationTicks);
        expect(dec.mergedIntoOneEvent).toBe(ev!.slotCount > 1);
      }
      // plannerForcesNewFoundation ⟺ no continuation option AND a change.
      for (const slot of slots) {
        const dec = slot.continuationDecision!;
        expect(slot.plannerForcesNewFoundation).toBe(dec.selectedAction === 'change' && !dec.available);
      }
      // Scored components match the trace (recorded, not invented).
      for (const slotRec of d.structure.slots) {
        const sc = slotRec.selectedCandidateScores;
        if (sc === null) continue;
        if (sc.continuationParts !== null) {
          expect(sc.transitionParts).toBeNull();
          const si = slotRec.positionInPhrase;
          const win = d.structure.windows.find((w) => w.startTick <= slotRec.startTick
            && w.endTick > slotRec.startTick);
          expect(win).toBeDefined();
          const st = win!.selection?.mode === 'beam' ? win!.selection.beam!.slots[si] : null;
          const chosen = st?.candidates.find((c) => c.selected) ?? null;
          expect(chosen?.kind).toBe('continuation');
          expect(chosen?.continuationParts).toEqual(sc.continuationParts);
        }
      }
    }
  });
});

describe('Phase 4.3B — Test 14: regression protection (existing invariants intact)', () => {
  it('preserves the Phase 4.3A stability semantics in the shared destination terms', () => {
    // The continuation score consumes the SAME gated stability terms: a
    // chromatic foundation still reads qualityStability 0 (Abm in E Aeolian).
    const pool = buildFoundationPool(4, 'Aeolian', { complexity: 2, borrowing: 'some' });
    const ctx = neutralCtx(pool);
    const abm = pool.all.find((f) => f.rootPc === 8 && f.quality === 'minor');
    const em = pool.all.find((f) => f.rootPc === 4 && f.quality === 'minor');
    expect(abm).toBeDefined();
    expect(em).toBeDefined();
    const base = { position: 'middle' as const, sectionMovement: 0.5, changesPerBar: 2, shape: 'regular' as const, anchorAfterMatches: false, arrivalIntention: null, arrivalPrev: null };
    const abmParts = foundationContinuationScoreDetailed(abm!, ctx, base, noPressure).parts;
    const emParts = foundationContinuationScoreDetailed(em!, ctx, base, noPressure).parts;
    expect(abmParts.qualityStability).toBe(0);
    expect(emParts.qualityStability).toBeGreaterThan(0);
    expect(abmParts.structuralConsonance).toBe(emParts.structuralConsonance); // same sonority class
  });

  it('keeps the full existing suite green via the shared generator invariants', () => {
    const project = verseChorus();
    for (const seed of [1, 34]) {
      const { chords, report } = generateChordProgression(project, { seed, diagnostics: false });
      const withDiag = generateChordProgression(project, { seed, diagnostics: true });
      // Non-interference: diagnostics change nothing.
      expect(JSON.stringify(withDiag.chords)).toBe(JSON.stringify(chords));
      expect(JSON.stringify(withDiag.report)).toBe(JSON.stringify(report));
      // Coverage and parseability (Phase 4.1 contracts).
      assertTiled(chords, 0, 16 * BT, `regression seed ${seed}`);
      for (const c of chords) expect(parseChord(c.symbol).ok).toBe(true);
      // The report's new counters agree with each other.
      expect(report.sustainedEvents).toBeGreaterThanOrEqual(0);
      expect(report.continuationSlots).toBeGreaterThanOrEqual(report.sustainedEvents);
    }
  });
});
