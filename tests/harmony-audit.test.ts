/**
 * Audit infrastructure tests (Phase 4.3C, spec §12).
 *
 * The audit is an INVESTIGATION instrument over the unmodified production
 * generator. These tests pin the guarantees that make its evidence usable:
 *
 *   1  Production equivalence — audit output IS production output.
 *   2  Configuration isolation — only complexity + borrowing differ (A/B/C).
 *   3  Determinism — identical inputs → identical audit reports.
 *   4  Foundation extraction — extensions never alter structural identity.
 *   5  Continuation accounting — sustained slots are never counted as
 *      multiple changes; audit accounting agrees with the generator's.
 *   6  Chromatic analysis — non-diatonic foundations identified exactly.
 *   7  Phrase alignment — events land in the correct section and phrase.
 *   8  All twelve modes supported.
 *   9  No side effects — projects and shared settings stay untouched.
 *   10 Regression guard — audit invocation leaves no state behind: the
 *      production generator keeps producing identical output afterwards.
 *
 * Metrics are asserted for MECHANICS and CONSISTENCY, never for specific
 * musical values (spec §7 — descriptive measurements, not quality scores).
 */
import { describe, expect, it } from 'vitest';
import { generateChordProgression } from '../src/engine/harmony/generation';
import {
  AUDIT_CONFIGURATIONS, aggregateRuns, computeProgressionMetrics, extractAuditEvents,
  resolveAuditSettings, runAuditConfig, runAuditMatched, settingsIsolatedApart,
} from '../src/engine/harmony/audit';
import { auditionVoicing, buildAuditionMidi } from '../src/engine/harmony/audit-midi';
import { projectFromFixture, type Project, type Section } from '../src/shared/schema';
import { DEFAULT_CHORDGEN_SETTINGS, type Chord } from '../src/shared/schema/types';
import type { ModeName } from '../src/shared/schema/modes';
import { barTicks, barToTick } from '../src/shared/schema/meter';

const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });

function makeProject(mode: ModeName = 'Aeolian', key = 4): Project {
  const base = projectFromFixture({ name: 'AuditTest', tracks: [] });
  return {
    ...base,
    key,
    mode,
    sections: [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)],
    chords: [],
    chordGenSettings: { ...DEFAULT_CHORDGEN_SETTINGS },
  };
}

const ALL_CONFIGS = [AUDIT_CONFIGURATIONS.A, AUDIT_CONFIGURATIONS.B, AUDIT_CONFIGURATIONS.C];

/* ------------------------------------------------------------------------ */

describe('Phase 4.3C audit infrastructure', () => {
  it('Test 1 — production equivalence: audit runs produce exactly what the production generator produces', () => {
    const project = makeProject();

    // Config C passes NO overrides — must equal a plain production call.
    const auditC = runAuditConfig(project, 34, AUDIT_CONFIGURATIONS.C);
    const direct = generateChordProgression(project, { seed: 34 });
    expect(JSON.stringify(auditC.progression.map((e) => [e.symbol, e.startTick, e.durationTicks])))
      .toBe(JSON.stringify(direct.chords.map((c: Chord) => [c.symbol, c.startTick, c.durationTicks])));

    // Config A passes its overrides — must equal the production call with
    // the SAME overrides.
    const auditA = runAuditConfig(project, 34, AUDIT_CONFIGURATIONS.A);
    const directA = generateChordProgression(project, {
      seed: 34, settings: { complexity: 1, borrowing: 'none' },
    });
    expect(JSON.stringify(auditA.progression.map((e) => [e.symbol, e.startTick, e.durationTicks])))
      .toBe(JSON.stringify(directA.chords.map((c: Chord) => [c.symbol, c.startTick, c.durationTicks])));
  });

  it('Test 2 — configuration isolation: only complexity and borrowing differ between A, B and C', () => {
    const project = makeProject();
    const matched = runAuditMatched(project, 5, ALL_CONFIGS);
    const a = matched.configs.A.effectiveSettings;
    const b = matched.configs.B.effectiveSettings;
    const c = matched.configs.C.effectiveSettings;

    expect(a.complexity).toBe(1);
    expect(a.borrowing).toBe('none');
    expect(b.complexity).toBe(2);
    expect(b.borrowing).toBe('none');
    expect(c.complexity).toBe(project.chordGenSettings!.complexity);
    expect(c.borrowing).toBe(project.chordGenSettings!.borrowing);

    // Every non-isolated field is identical across all three configurations.
    expect(settingsIsolatedApart(a, b)).toBe(true);
    expect(settingsIsolatedApart(b, c)).toBe(true);
    expect(settingsIsolatedApart(a, c)).toBe(true);
    // ...and the isolated fields genuinely differ where the design says so.
    expect(a.complexity).not.toBe(b.complexity);
    expect(b.borrowing).not.toBe(c.borrowing);

    // resolveAuditSettings agrees with what the run recorded.
    expect(resolveAuditSettings(project, AUDIT_CONFIGURATIONS.C)).toEqual(c);
  });

  it('Test 3 — determinism: repeated audits with identical inputs produce identical reports', () => {
    const project = makeProject();
    const r1 = runAuditMatched(project, 9, ALL_CONFIGS);
    const r2 = runAuditMatched(project, 9, ALL_CONFIGS);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));

    // Aggregates are deterministic too.
    const agg1 = aggregateRuns(r1.configs.C ? [r1.configs.A] : [], true);
    const agg2 = aggregateRuns([r2.configs.A], true);
    expect(JSON.stringify(agg1)).toBe(JSON.stringify(agg2));
  });

  it('Test 4 — foundation extraction: chord extensions never alter structural identification', () => {
    const project = makeProject();
    const colored: Chord[] = [
      { id: 'x1', symbol: 'Em7', startTick: 0, durationTicks: 1920 },
      { id: 'x2', symbol: 'Cmaj7', startTick: 1920, durationTicks: 1920 },
      { id: 'x3', symbol: 'G7', startTick: 3840, durationTicks: 1920 },
      { id: 'x4', symbol: 'Bm7b5', startTick: 5760, durationTicks: 1920 },
      { id: 'x5', symbol: 'Csus2', startTick: 7680, durationTicks: 1920 },
    ];
    const plain: Chord[] = [
      { id: 'y1', symbol: 'Em', startTick: 0, durationTicks: 1920 },
      { id: 'y2', symbol: 'C', startTick: 1920, durationTicks: 1920 },
      { id: 'y3', symbol: 'G', startTick: 3840, durationTicks: 1920 },
      { id: 'y4', symbol: 'Bdim', startTick: 5760, durationTicks: 1920 },
      { id: 'y5', symbol: 'Csus2', startTick: 7680, durationTicks: 1920 },
    ];
    const a = extractAuditEvents(colored, project, undefined);
    const b = extractAuditEvents(plain, project, undefined);
    expect(a.map((e) => e.foundationId)).toEqual(b.map((e) => e.foundationId));
    expect(a.map((e) => e.rootPc)).toEqual([4, 0, 7, 11, 0]);
    expect(a[0].quality).toBe('minor');
    expect(a[3].quality).toBe('diminished');
    expect(a[4].quality).toBe('suspended');
    // Metrics are foundation-based, so color cannot move them.
    const ma = computeProgressionMetrics(a, project, undefined);
    const mb = computeProgressionMetrics(b, project, undefined);
    expect(ma.foundationDiversity).toBe(mb.foundationDiversity);
    expect(ma.structuralChanges).toBe(mb.structuralChanges);
  });

  it('Test 5 — continuation accounting: sustained slots are never counted as multiple changes', () => {
    const project = makeProject();
    // Several seeds: wherever sustains occur, the accounting must hold.
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = runAuditConfig(project, seed, AUDIT_CONFIGURATIONS.B);
      const m = run.metrics;
      const events = run.progression;

      // Every adjacent pair is exactly one of: change / exact repeat / color
      // variation — so changes + repeats = pairs.
      expect(m.structuralChanges + m.consecutiveRepetitions).toBe(Math.max(0, events.length - 1));

      // Sustained events agree with the generator's own accounting.
      const sustained = events.filter((e) => (e.slotCount ?? 1) > 1).length;
      expect(sustained).toBe(run.generationFacts.sustainedEvents);

      // Sustained holds keep ONE foundation and ONE symbol across the hold
      // (the slotCount>1 event is a single progression entry, by construction
      // of the audit extraction — entries are chord events, not slots).
      // Total duration is preserved: events tile the covered span.
      const sorted = [...events].sort((p, q) => p.startTick - q.startTick);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].startTick).toBe(sorted[i - 1].startTick + sorted[i - 1].durationTicks);
        expect(sorted[i].durationTicks).toBeGreaterThan(0);
      }
    }
  });

  it('Test 6 — chromatic analysis: non-diatonic foundations are identified exactly', () => {
    const project = makeProject();

    // Borrowing 'none' (configs A and B) can never produce a chromatic
    // FOUNDATION in an anchor-free corpus project.
    for (const seed of [1, 2, 3]) {
      const runA = runAuditConfig(project, seed, AUDIT_CONFIGURATIONS.A);
      expect(runA.metrics.chromaticFoundations).toBe(0);
      expect(runA.progression.every((e) => e.borrowed === false)).toBe(true);
    }

    // Borrowing 'some' (config C) should surface chromatic foundations in
    // at least one of eight seeds — and when it does, the analysis carries
    // the exact non-diatonic core tones.
    const runsC = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => runAuditConfig(project, seed, AUDIT_CONFIGURATIONS.C));
    const withChromatic = runsC.filter((r) => r.metrics.chromaticFoundations > 0);
    expect(withChromatic.length).toBeGreaterThan(0);
    for (const run of withChromatic) {
      const borrowed = run.progression.filter((e) => e.borrowed);
      expect(borrowed.length).toBe(run.metrics.chromaticFoundations);
      for (const e of borrowed) {
        expect(e.diatonic).toBe(false);
        expect(e.nonDiatonicCoreNames.length).toBeGreaterThan(0);
      }
      expect(run.metrics.nonDiatonicPitchClasses.length).toBeGreaterThan(0);
      expect(run.metrics.chromaticDurationFraction ?? 0).toBeGreaterThan(0);
    }
  });

  it('Test 7 — phrase alignment: generated events are associated with the correct phrase and section', () => {
    const project = makeProject();
    const run = runAuditConfig(project, 34, AUDIT_CONFIGURATIONS.C);
    const bt = barTicks(project.timeSignature);

    for (const e of run.progression) {
      // Section assignment matches the section span computed from ticks.
      const expected = project.sections.find((s) => {
        const start = barToTick(s.startBar, project.timeSignature);
        return e.startTick >= start && e.startTick < start + s.lengthBars * bt;
      });
      expect(e.sectionId).toBe(expected?.id ?? null);
      // The corpus covers the whole song with planned phrases — every event
      // sits inside one.
      expect(e.phraseId).not.toBeNull();
    }

    // Arrivals: every planned arrival record carries intention + actual chord.
    expect(run.metrics.phraseArrivals.length).toBeGreaterThan(0);
    for (const a of run.metrics.phraseArrivals) {
      expect(a.intention.length).toBeGreaterThan(0);
      expect(a.finalSymbol).not.toBeNull();
      expect(a.finalFoundation).not.toBeNull();
    }
  });

  it('Test 8 — all modes: the audit infrastructure supports all twelve modes', () => {
    const modes: ModeName[] = [
      'Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian',
      'Harmonic Minor', 'Melodic Minor', 'Whole Tone', 'Diminished (Half-Whole)', 'Diminished (Whole-Half)',
    ];
    for (const mode of modes) {
      const project = makeProject(mode, 2);
      const run = runAuditConfig(project, 1, AUDIT_CONFIGURATIONS.B);
      expect(run.chordCount).toBeGreaterThan(0);
      expect(run.warnings).toEqual([]);
      expect(run.metrics.foundationDiversity).toBeGreaterThan(0);
      expect(run.metrics.totalEvents).toBe(run.progression.length);
      // Audition rendering works everywhere too.
      const midi = buildAuditionMidi(project, run.progression.map((e, i) => ({
        index: i, symbol: e.symbol, startTick: e.startTick, durationTicks: e.durationTicks,
        foundationId: e.foundation, foundationLabel: e.foundation, rootPc: e.rootPc, rootName: null,
        quality: e.quality, diatonic: e.diatonic, borrowed: e.borrowed, borrowedProvenance: [],
        nonDiatonicCoreNames: [], sectionId: e.sectionId, phraseId: e.phraseId,
        provenance: 'generated' as const, slotCount: e.slotCount, colorTier: null,
        structuralSuspension: false, colorSuspension: false,
      })));
      expect(midi.length).toBeGreaterThan(100);
    }
  });

  it('Test 9 — no side effects: audit generation does not modify the project or shared settings', () => {
    const project = makeProject();
    const before = JSON.stringify(project);
    const defaultsBefore = JSON.stringify(DEFAULT_CHORDGEN_SETTINGS);

    runAuditMatched(project, 11, ALL_CONFIGS);

    expect(JSON.stringify(project)).toBe(before);
    expect(JSON.stringify(DEFAULT_CHORDGEN_SETTINGS)).toBe(defaultsBefore);
  });

  it('Test 10 — regression guard: audit invocation leaves no state behind in the generator', () => {
    const project = makeProject();
    const before = JSON.stringify(
      generateChordProgression(project, { seed: 7 }).chords.map((c) => [c.symbol, c.startTick, c.durationTicks]),
    );
    // Run a full matched audit (all configs, several seeds) in between.
    runAuditMatched(project, 1, ALL_CONFIGS);
    runAuditMatched(project, 7, ALL_CONFIGS);
    const after = JSON.stringify(
      generateChordProgression(project, { seed: 7 }).chords.map((c) => [c.symbol, c.startTick, c.durationTicks]),
    );
    expect(after).toBe(before);
  });

  it('audition voicing is fixed and parser-faithful (spec §9 consistency)', () => {
    // Same quality → same interval structure regardless of root.
    const c = auditionVoicing('Cmaj7');
    const g = auditionVoicing('Gmaj7');
    expect(c.map((n) => n - c[0])).toEqual([0, 4, 7, 11]);
    expect(g.map((n) => n - g[0])).toEqual([0, 4, 7, 11]);
    // Slash bass below the root.
    const slash = auditionVoicing('C/E');
    expect(slash[0]).toBeLessThan(auditionVoicing('C')[0]);
    // Deterministic.
    expect(JSON.stringify(auditionVoicing('Bm7b5'))).toBe(JSON.stringify(auditionVoicing('Bm7b5')));
    // MIDI building is deterministic for identical inputs.
    const project = makeProject();
    const run = runAuditConfig(project, 2, AUDIT_CONFIGURATIONS.A);
    const events = run.progression.map((e, i) => ({
      index: i, symbol: e.symbol, startTick: e.startTick, durationTicks: e.durationTicks,
      foundationId: e.foundation, foundationLabel: e.foundation, rootPc: e.rootPc, rootName: null,
      quality: e.quality, diatonic: e.diatonic, borrowed: e.borrowed, borrowedProvenance: [],
      nonDiatonicCoreNames: [], sectionId: e.sectionId, phraseId: e.phraseId,
      provenance: 'generated' as const, slotCount: e.slotCount, colorTier: null,
      structuralSuspension: false, colorSuspension: false,
    }));
    expect(JSON.stringify(buildAuditionMidi(project, events)))
      .toBe(JSON.stringify(buildAuditionMidi(project, events)));
  });
});
