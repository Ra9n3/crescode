/**
 * Tonal stability tests (Phase 4.3A) — the tonic-quality collision fix.
 *
 * The pre-4.3A transition score keyed one stability term on QUALITY alone,
 * so a chromatic chord sharing the tonic triad's quality (Ab minor in
 * E Aeolian, seed 34) inherited the tonic's full stability anchor. These
 * tests pin the corrected model:
 *
 *   structural consonance — what the chord IS (mode-independent)
 *   tonic-root relationship — root IS the tonic (objective fact)
 *   tonic-chord relationship — shared tones with the tonic triad (evidence)
 *   modal compatibility — diatonic membership (coherence, not identity)
 *
 * The tests never hardcode Ab minor or E Aeolian behavior: every assertion
 * is derived from the pool/scorer API and transposition-checked.
 */
import { describe, expect, it } from 'vitest';
import {
  buildFoundationPool, foundationArrivalFit, foundationTransitionScoreDetailed,
  reinforcesTonic, seedTensionState, stabilityEvidence,
  type FoundationInfo, type FoundationPool, type StructuralContext,
} from '../src/engine/harmony/foundation';
import { generateChordProgression } from '../src/engine/harmony/generation';
import { serializeHarmonyDiagnostics } from '../src/engine/harmony/diagnostics';
import { cadenceEnvironment } from '../src/engine/harmony/cadences';
import { parseChord } from '../src/shared/schema/chords';
import { MODE_NAMES, type ModeName } from '../src/shared/schema/modes';
import {
  createDefaultProject, projectFromFixture, type Project, type Section,
} from '../src/shared/schema';
import type { ChordGenSettings } from '../src/shared/schema/types';

function makeProject(sections: Section[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'StabilityTest', tracks: [] });
  return { ...base, sections, chords: [], ...opts };
}
const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });
const verseAndChorus = [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)];
const settings = (overrides: Partial<ChordGenSettings> = {}): ChordGenSettings =>
  ({ ...createDefaultProject().chordGenSettings!, ...overrides }) as ChordGenSettings;

/** A neutral structural context (mid-piece, moderate preferences) so unit
 *  assertions measure the stability terms, not phrase planning extremes. */
function neutralCtx(pool: FoundationPool, overrides: Partial<StructuralContext> = {}): StructuralContext {
  return {
    stability: 0.55, movement: 0.5, tension: 0.5, modalPref: 0.5, contrastPref: 0.5,
    borrowing: 'some', role: 'continue', pool, env: cadenceEnvironment(pool.tonic, pool.mode),
    ...overrides,
  };
}

function foundation(pool: FoundationPool, rootPc: number, quality: string): FoundationInfo {
  const f = pool.all.find((x) => x.rootPc === rootPc && x.quality === quality);
  expect(f, `${quality} foundation on root ${rootPc} must be pooled`).toBeDefined();
  return f!;
}

/** Zero-pressure TensionState — the scorer requires one; these unit tests
 *  measure the context-free terms, so no resolution history is carried. */
const noPressure = seedTensionState(null);

describe('Phase 4.3A — Test 1: tonic quality collision (E Aeolian: Em vs Abm)', () => {
  it('Abm cannot inherit the tonic quality anchor; both keep sonority stability', () => {
    const pool = buildFoundationPool(4, 'Aeolian', { complexity: 2, borrowing: 'some' });
    const Em = foundation(pool, 4, 'minor');
    const Abm = foundation(pool, 8, 'minor');
    expect(Em.diatonic).toBe(true);
    expect(Abm.diatonic).toBe(false);

    const evEm = stabilityEvidence(Em, pool);
    const evAbm = stabilityEvidence(Abm, pool);
    // Equal as SONORITIES …
    expect(evAbm.structuralConsonance).toBe(evEm.structuralConsonance);
    expect(evAbm.structuralConsonance).toBeGreaterThan(0);
    // … but only Em relates to the tonal center by root …
    expect(evEm.tonicRootRelationship).toBe(1);
    expect(evAbm.tonicRootRelationship).toBe(0);
    // … and Abm's connection to the tonic TRIAD is weak (shares B only).
    expect(evEm.tonicChordRelationship).toBe(1);
    expect(evAbm.tonicChordRelationship).toBeCloseTo(1 / 3, 9);
    expect(evAbm.modalCompatibility).toBe(0);
    expect(evEm.modalCompatibility).toBe(1);

    // In the score (context: following G major, the seed-34 situation) the
    // mode's quality norm transfers to Em but NOT to Abm.
    const ctx = neutralCtx(pool);
    const pEm = foundationTransitionScoreDetailed(foundation(pool, 7, 'major'), Em, ctx, noPressure).parts;
    const pAbm = foundationTransitionScoreDetailed(foundation(pool, 7, 'major'), Abm, ctx, noPressure).parts;
    expect(pAbm.qualityStability).toBe(0);
    expect(pEm.qualityStability).toBeGreaterThan(0);
    // Same sonority → the same structural-consonance credit.
    expect(pAbm.structuralConsonance).toBeCloseTo(pEm.structuralConsonance, 12);
    // And no tonic-status credit for the chromatic chord.
    expect(pAbm.tonicReinforcement).toBe(0);
    expect(pEm.tonicReinforcement).toBeGreaterThan(0);
  });

  it('recorded diagnostics of the E Aeolian run agree: chromatic picks score no quality norm', () => {
    const p = makeProject(verseAndChorus, { key: 4, mode: 'Aeolian' });
    const r = generateChordProgression(p, { seed: 34, scope: { type: 'all' }, diagnostics: true });
    const d = r.diagnostics!;
    expect(d.planning.pool.mode).toBe('Aeolian');
    for (const slot of d.structure.slots) {
      if (slot.selected.diatonic === false) {
        expect(slot.selectedCandidateScores, 'searched slot must carry scores').not.toBeNull();
        expect(slot.selectedCandidateScores!.transitionParts?.qualityStability ?? 0).toBe(0);
        expect((slot.selectedCandidateScores!.transitionParts?.structuralConsonance ?? 0)).toBeGreaterThan(0);
      }
    }
  });
});

describe('Phase 4.3A — Test 2: major-mode equivalent (C Ionian: C vs D)', () => {
  it('D major (chromatic II) keeps sonority credit but no tonic status or modal norm; Dm keeps the norm', () => {
    const pool = buildFoundationPool(0, 'Ionian', { complexity: 2, borrowing: 'some' });
    const C = foundation(pool, 0, 'major');   // the diatonic tonic
    const D = foundation(pool, 2, 'major');   // chromatic major (V/V shape) — the spec's case
    const Dm = foundation(pool, 2, 'minor');  // the mode's own diatonic ii
    expect(C.diatonic).toBe(true);
    expect(D.diatonic).toBe(false);   // D major is NOT diatonic in C Ionian (F# ∉ scale)
    expect(Dm.diatonic).toBe(true);

    const evC = stabilityEvidence(C, pool);
    const evD = stabilityEvidence(D, pool);
    const evDm = stabilityEvidence(Dm, pool);
    expect(evD.structuralConsonance).toBe(evC.structuralConsonance); // both major sonorities
    expect(evC.tonicRootRelationship).toBe(1);
    expect(evD.tonicRootRelationship).toBe(0);  // quality match ≠ tonic status
    expect(evD.modalCompatibility).toBe(0);
    expect(evD.tonicChordRelationship).toBe(0); // no shared tones with {C,E,G}
    expect(evDm.modalCompatibility).toBe(1);    // Dm is diatonic — fully viable
    expect(evDm.tonicRootRelationship).toBe(0); // …yet never tonic-root

    const ctx = neutralCtx(pool, { role: 'establish' });
    const pC = foundationTransitionScoreDetailed(null, C, ctx, noPressure).parts;
    const pD = foundationTransitionScoreDetailed(null, D, ctx, noPressure).parts;
    const pDm = foundationTransitionScoreDetailed(null, Dm, ctx, noPressure).parts;
    expect(pD.qualityStability).toBe(0);                 // the mode's norm does not describe D major
    expect(pD.structuralConsonance).toBeCloseTo(pC.structuralConsonance, 12);
    expect(pD.tonicReinforcement).toBe(0);               // …and not tonic-root status
    expect(pD.openingTonic).toBe(0);
    expect(pC.tonicReinforcement).toBeGreaterThan(0);
    expect(pC.openingTonic).toBeGreaterThan(0);
    expect(pDm.qualityStability).toBeGreaterThan(0);     // the norm speaks for the mode's own ii
    expect(pDm.tonicReinforcement).toBe(0);              // but Dm is still not the tonic
  });
});

describe('Phase 4.3A — Test 3: diatonic alternatives remain valid (E Aeolian)', () => {
  it('G, Am, Bm, C, D stay pooled, diatonic and within a healthy margin of Em', () => {
    const pool = buildFoundationPool(4, 'Aeolian', { complexity: 2, borrowing: 'some' });
    const Em = foundation(pool, 4, 'minor');
    const ctx = neutralCtx(pool);
    const totalEm = foundationTransitionScoreDetailed(null, Em, ctx, noPressure).total;
    const rivals: Array<[number, string]> = [
      [7, 'major'], [9, 'minor'], [11, 'minor'], [0, 'major'], [2, 'major'],
    ];
    for (const [rootPc, quality] of rivals) {
      const f = foundation(pool, rootPc, quality);
      expect(f.diatonic).toBe(true);
      const ev = stabilityEvidence(f, pool);
      expect(ev.modalCompatibility).toBe(1);
      expect(ev.structuralConsonance).toBe(1);
      const parts = foundationTransitionScoreDetailed(null, f, ctx, noPressure).parts;
      expect(parts.qualityStability).toBeGreaterThan(0); // the mode's norm speaks for its own chords
      expect(parts.structuralConsonance).toBeGreaterThan(0);
      const total = foundationTransitionScoreDetailed(null, f, ctx, noPressure).total;
      expect(total, `${quality} on ${rootPc} stays competitive`).toBeGreaterThan(totalEm - 0.3);
    }
  });
});

describe('Phase 4.3A — Test 4: chromatic freedom', () => {
  it('chromatic foundations stay pooled and score well above exclusion', () => {
    for (const borrowing of ['some', 'more'] as const) {
      const pool = buildFoundationPool(4, 'Aeolian', { complexity: 2, borrowing });
      const Abm = foundation(pool, 8, 'minor');
      const Emaj = foundation(pool, 4, 'major');
      const ctx = neutralCtx(pool, { borrowing });
      // Following G major (a step away), both remain genuinely reachable.
      const prev = foundation(pool, 7, 'major');
      for (const f of [Abm, Emaj]) {
        const { total, parts } = foundationTransitionScoreDetailed(prev, f, ctx, noPressure);
        expect(f.diatonic).toBe(false);
        expect(parts.qualityStability).toBe(0);           // no tonic-quality inheritance
        expect(parts.structuralConsonance).toBeGreaterThan(0); // but full sonority credit
        expect(parts.diatonicPreference).toBeGreaterThan(0);   // borrowing keeps its graded welcome
        expect(total).toBeGreaterThan(0.4); // far above the 0.2 base floor — viable, not punished
      }
    }
  });
});

describe('Phase 4.3A — Test 5: transposition invariance', () => {
  it('the tonic-quality collision and its correction transpose exactly', () => {
    for (const tonic of [0, 3, 4, 7, 9, 11]) {
      const pool = buildFoundationPool(tonic, 'Aeolian', { complexity: 2, borrowing: 'some' });
      const tonicMinor = foundation(pool, tonic, 'minor');
      const chromaticMinor = foundation(pool, (tonic + 4) % 12, 'minor'); // e.g. Abm over E
      expect(tonicMinor.diatonic).toBe(true);
      expect(chromaticMinor.diatonic).toBe(false);
      const evT = stabilityEvidence(tonicMinor, pool);
      const evC = stabilityEvidence(chromaticMinor, pool);
      const ctx = neutralCtx(pool);
      const pT = foundationTransitionScoreDetailed(null, tonicMinor, ctx, noPressure).parts;
      const pC = foundationTransitionScoreDetailed(null, chromaticMinor, ctx, noPressure).parts;
      // Reference values measured on E (tonic 4) — must hold everywhere.
      expect(evT.tonicRootRelationship).toBe(1);
      expect(evC.tonicRootRelationship).toBe(0);
      expect(evC.structuralConsonance).toBe(evT.structuralConsonance);
      expect(evC.tonicChordRelationship).toBeCloseTo(1 / 3, 9);
      expect(evC.modalCompatibility).toBe(0);
      expect(pC.qualityStability).toBe(0);
      expect(pT.qualityStability).toBeGreaterThan(0);
      expect(pC.structuralConsonance).toBeCloseTo(pT.structuralConsonance, 12);
    }
  });
});

describe('Phase 4.3A — Test 6: modal coverage (all twelve modes)', () => {
  it('no chromatic foundation reads the quality norm in any mode; diatonic ones do', () => {
    for (const mode of MODE_NAMES as ModeName[]) {
      for (const tonic of [0, 2]) {
        const pool = buildFoundationPool(tonic, mode, { complexity: 2, borrowing: 'more' });
        const ctx = neutralCtx(pool);
        expect(pool.all.length).toBeGreaterThan(0);
        for (const f of pool.all) {
          const parts = foundationTransitionScoreDetailed(null, f, ctx, noPressure).parts;
          if (f.diatonic) {
            // Diatonic chords read the mode's own norm (never negative).
            expect(parts.qualityStability).toBeGreaterThanOrEqual(0);
          } else {
            // Chromatic chords never read it — in ANY mode, any tonic.
            expect(parts.qualityStability, `${mode} @${tonic}: chromatic ${f.id}`).toBe(0);
          }
          expect(parts.structuralConsonance).toBeGreaterThan(0);
        }
        // The tonic-rooted diatonic foundation (when pooled) reinforces the
        // center by root — whichever sonority the id order surfaces first.
        const tonicF = pool.all.find((f) => f.rootPc === tonic && f.diatonic);
        if (tonicF !== undefined) {
          const evTf = stabilityEvidence(tonicF, pool);
          expect(evTf.tonicRootRelationship).toBe(1);
          expect(reinforcesTonic(tonicF, pool.tonic, pool.tonicTriadPcs)).toBe(true);
        }
      }
    }
  });

  it('symmetrical modes still generate valid harmony with no conventional tonic demand', () => {
    for (const mode of ['Whole Tone', 'Diminished (Half-Whole)', 'Diminished (Whole-Half)'] as ModeName[]) {
      const p = makeProject(verseAndChorus, { key: 0, mode, chordGenSettings: settings({ borrowing: 'none', seed: 5 }) });
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 5 });
      expect(r.chords.length).toBeGreaterThan(0);
      for (const c of r.chords) expect(parseChord(c.symbol).ok).toBe(true);
      // No requirement that any chord be major/minor, or that the tonic
      // root appear — generation stays valid regardless.
      expect(r.report.generatedChordCount).toBeGreaterThan(0);
    }
  });
});

describe('Phase 4.3A — Test 7: phrase context — the tonic is never forced', () => {
  it('open endings still prefer departure, and runs keep non-tonic harmony', () => {
    const pool = buildFoundationPool(4, 'Aeolian', { complexity: 2, borrowing: 'some' });
    const ctx = neutralCtx(pool, { role: 'contrast' });
    const prev = foundation(pool, 7, 'major');
    const Em = foundation(pool, 4, 'minor');
    const Am = foundation(pool, 9, 'minor');
    // An OPEN ending closes on a stable home chord — the planner's semantics
    // (unchanged) still rate a departure above the tonic.
    expect(foundationArrivalFit(prev, Am, 'open', ctx))
      .toBeGreaterThan(foundationArrivalFit(prev, Em, 'open', ctx));

    // Generation-level: twelve seeds, tonic-rooted harmony never floods.
    for (let seed = 1; seed <= 12; seed++) {
      const p = makeProject(verseAndChorus, { key: 4, mode: 'Aeolian', chordGenSettings: settings({ seed }) });
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed, diagnostics: true });
      expect(r.chords.length).toBeGreaterThan(0);
      const d = r.diagnostics!;
      const slots = d.structure.slots;
      const tonicRoot = slots.filter((s) => s.selected.rootPc === d.planning.pool.tonic).length;
      expect(tonicRoot / slots.length).toBeLessThan(0.85);
      expect(tonicRoot).toBeLessThan(slots.length); // at least one non-tonic foundation
    }
  });
});

describe('Phase 4.3A — Test 8: diagnostic correctness', () => {
  it('recorded evidence and stability parts match the actual scorer exactly', () => {
    const p = makeProject(verseAndChorus, { key: 4, mode: 'Aeolian' });
    const r = generateChordProgression(p, { seed: 34, scope: { type: 'all' }, diagnostics: true });
    const d = r.diagnostics!;
    const pool = buildFoundationPool(4, 'Aeolian', { complexity: 2, borrowing: 'some' });
    const byId = new Map(pool.all.map((f) => [f.id, f]));
    for (const slot of d.structure.slots) {
      const f = byId.get(slot.selected.id) ?? pool.all.find((x) => x.rootPc === slot.selected.rootPc && x.quality === slot.selected.quality);
      expect(f, `pool entry for ${slot.selected.label}`).toBeDefined();
      const ev = stabilityEvidence(f!, pool);
      expect(slot.stabilityEvidence).toEqual(ev);
      const sc = slot.selectedCandidateScores;
      if (sc?.transitionParts) {
        const win = d.structure.windows.find((w) => w.windowIndex === slot.windowIndex);
        expect(win).toBeDefined();
        // The scorer consumes window DIRECTION (see structuralContext), not prefs.
        const tension = win!.direction.tension;
        const expectedStructural = 0.10 * ev.structuralConsonance * (1.05 - 0.55 * tension);
        expect(sc.transitionParts.structuralConsonance).toBeCloseTo(expectedStructural, 12);
        if (f!.diatonic) {
          const expectedModal = 0.10 * pool.qualityStability[f!.quality] * (1.05 - 0.55 * tension);
          expect(sc.transitionParts.qualityStability).toBeCloseTo(expectedModal, 12);
        } else {
          expect(sc.transitionParts.qualityStability).toBe(0);
        }
      }
    }
  });
});

describe('Phase 4.3A — Test 9: determinism', () => {
  it('identical input and seed produce identical chords and identical diagnostics', () => {
    const p = makeProject(verseAndChorus, { key: 4, mode: 'Aeolian' });
    const a = generateChordProgression(p, { seed: 34, scope: { type: 'all' }, diagnostics: true });
    const b = generateChordProgression(p, { seed: 34, scope: { type: 'all' }, diagnostics: true });
    const plain = generateChordProgression(p, { seed: 34, scope: { type: 'all' } });
    expect(JSON.stringify(a.chords)).toBe(JSON.stringify(b.chords));
    expect(JSON.stringify(a.chords)).toBe(JSON.stringify(plain.chords));
    expect(serializeHarmonyDiagnostics(b.diagnostics!))
      .toBe(serializeHarmonyDiagnostics(a.diagnostics!));
  });
});
