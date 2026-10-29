/**
 * Phase 4.3B corpus evaluation — measures the harmonic-continuation change
 * across modes and seeds, BEFORE and AFTER the change.
 *
 *   npx vite-node scripts/phase43b-corpus.ts --label baseline --out diagnostics/harmony/phase43b/corpus-baseline.json
 *   npx vite-node scripts/phase43b-corpus.ts --label corrected --out diagnostics/harmony/phase43b/corpus-corrected.json
 *   npx vite-node scripts/phase43b-corpus.ts --compare diagnostics/harmony/phase43b/corpus-baseline.json diagnostics/harmony/phase43b/corpus-corrected.json --out diagnostics/harmony/phase43b/CORPUS_COMPARISON.md
 *
 * Reuses the ACTUAL production generator (with diagnostics) — no separate
 * evaluation generator. Every metric is read from recorded output, never
 * recomputed. The extraction uses ONLY diagnostic fields that exist in BOTH
 * the Phase 4.3A baseline and the Phase 4.3B corrected engine (slot-level
 * sustain flags, event transitions, merge records), so the identical script
 * measures both versions with identical semantics:
 *
 *   - opportunities   = slots with a sounding previous harmony (slots − 1
 *                       for these anchor-free corpus projects);
 *   - continuations   = slots whose previous harmony was sustained into
 *                       them (`previousHarmonySustained` — the Phase 4.2
 *                       slot flag; in 4.3B these are the selector's hold
 *                       decisions, in 4.3A the emergent same-foundation
 *                       re-selections that merged);
 *   - changes         = opportunities − continuations;
 *   - activity        = changes / opportunities (§13.4).
 *
 * Spec §13 metrics: 1 changes · 2 continuations · 3 mean duration ·
 * 4 activity · 5 tonal center · 6 cadence realization · 7 chromatic usage ·
 * 8 root diversity · 9 failures · 10 determinism.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateChordProgression } from '../src/engine/harmony/generation';
import { projectFromFixture, type Project, type Section } from '../src/shared/schema';
import type { ModeName } from '../src/shared/schema/modes';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argValue = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

const CONTEXTS: Array<{ name: string; key: number; mode: ModeName }> = [
  { name: 'E Aeolian', key: 4, mode: 'Aeolian' },
  { name: 'D Dorian', key: 2, mode: 'Dorian' },
  { name: 'C Ionian', key: 0, mode: 'Ionian' },
  { name: 'D Phrygian', key: 2, mode: 'Phrygian' },
  { name: 'C Whole Tone', key: 0, mode: 'Whole Tone' },
  { name: 'D Diminished (Whole-Half)', key: 2, mode: 'Diminished (Whole-Half)' },
];

const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });

function makeProject(key: number, mode: ModeName): Project {
  const base = projectFromFixture({ name: 'Phase43B', tracks: [] });
  return {
    ...base,
    key,
    mode,
    sections: [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)],
    chords: [],
  };
}

interface RunRecord {
  seed: number;
  chordCount: number;
  deterministic: boolean;
  /** §13.1 — actual structural changes (slots that moved the harmony). */
  changes: number;
  /** §13.2 — continuations (slots sustaining the previous harmony). */
  continuations: number;
  opportunities: number;
  /** §13.3 — mean generated event duration (ticks). */
  meanDurationTicks: number;
  /** §13.4 — activity = changes / opportunities. */
  activity: number | null;
  /** §13.5 — tonal center. */
  firstChordTonicRooted: boolean | null;
  tonicRootFraction: number | null;
  tonicReinforceFraction: number | null;
  /** §13.6 — cadence realization. */
  plannedArrivals: number;
  realizedArrivals: number;
  familiesUsed: string[];
  /** §13.7 — chromatic usage. */
  chromaticFraction: number | null;
  /** §13.8 — structural root diversity. */
  distinctRootsMean: number | null;
  /** §13.9 — failures. */
  warnings: number;
  /** Extra pacing facts. */
  sustainedEvents: number;
  maxSustainedSlots: number;
  exactRepetitions: number;
  colorVariations: number;
  crossWindowMerges: number;
}

interface ContextRecord {
  name: string;
  key: number;
  mode: ModeName;
  runs: RunRecord[];
  aggregates: {
    failures: number;
    deterministicAll: boolean;
    changesMean: number;
    continuationsMean: number;
    continuationFraction: number | null;
    meanDurationTicks: number;
    activityMean: number;
    tonicRootFractionMean: number;
    tonicReinforceFractionMean: number;
    firstChordTonicRootedFraction: number;
    cadenceRealizationRate: number | null;
    chromaticFractionMean: number;
    distinctRootsMean: number;
    sustainedEventsMean: number;
    maxSustainedSlotsMax: number;
    crossWindowMergesTotal: number;
    transitionsTotal: { 'exact-repetition': number; 'color-variation': number; 'structural-movement': number };
  };
}

function runContext(ctx: { name: string; key: number; mode: ModeName }): ContextRecord {
  const project = makeProject(ctx.key, ctx.mode);
  const runs: RunRecord[] = [];
  for (const seed of SEEDS) {
    const r1 = generateChordProgression(project, { seed, scope: { type: 'all' }, diagnostics: true });
    const r2 = generateChordProgression(project, { seed, scope: { type: 'all' }, diagnostics: false });
    const d = r1.diagnostics;
    const structSlots = d?.structure.slots ?? [];
    const rhythmSlots = d?.rhythm.slots ?? [];
    const events = structSlots.length;
    const tonic = d?.planning.pool.tonic ?? project.key;
    const tonicRoot = structSlots.filter((s) => s.selected.rootPc === tonic).length;
    const chromatic = structSlots.filter((s) => s.selected.diatonic === false).length;
    const transitions = { 'exact-repetition': 0, 'color-variation': 0, 'structural-movement': 0 };
    for (const t of d?.transitions ?? []) transitions[t.classification] += 1;
    // Slot-unit continuation metrics (version-independent; see header).
    const totalSlots = rhythmSlots.length;
    const continuations = rhythmSlots.filter((s) => s.previousHarmonySustained).length;
    const opportunities = Math.max(0, totalSlots - 1); // first slot: no sounding harmony
    const changes = Math.max(0, opportunities - continuations);
    const merges = d?.structure.merges ?? [];
    runs.push({
      seed,
      chordCount: r1.chords.length,
      deterministic: JSON.stringify(r1.chords) === JSON.stringify(r2.chords),
      changes,
      continuations,
      opportunities,
      meanDurationTicks: r1.report.rhythmSummary.meanDurationTicks,
      activity: opportunities > 0 ? changes / opportunities : null,
      firstChordTonicRooted: structSlots.length > 0 ? structSlots[0].selected.rootPc === tonic : null,
      tonicRootFraction: events > 0 ? tonicRoot / events : null,
      tonicReinforceFraction: r1.report.generatedChordCount > 0
        ? r1.report.tonicReinforcementEvents / r1.report.generatedChordCount
        : null,
      plannedArrivals: (d?.structure.windows ?? []).filter((w) => w.arrivalPlanned).length,
      realizedArrivals: r1.report.structuralCadences.length,
      familiesUsed: [...r1.report.cadenceFamiliesUsed],
      chromaticFraction: events > 0 ? chromatic / events : null,
      distinctRootsMean: r1.report.distinctRootsPerPhrase.length > 0
        ? r1.report.distinctRootsPerPhrase.reduce((s, v) => s + v, 0) / r1.report.distinctRootsPerPhrase.length
        : null,
      warnings: r1.report.warnings.length,
      sustainedEvents: new Set(merges.map((m) => m.eventIndex)).size,
      maxSustainedSlots: Math.max(0, ...merges.map((m) => m.slotCount)),
      exactRepetitions: transitions['exact-repetition'],
      colorVariations: transitions['color-variation'],
      crossWindowMerges: merges.filter((m) => m.crossWindow).length,
    });
  }
  const frac = (get: (r: RunRecord) => number | null): number | null => {
    const vals = runs.map(get).filter((v): v is number => v !== null);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  };
  const transitionsTotal = runs.reduce(
    (acc, r) => ({
      'exact-repetition': acc['exact-repetition'] + r.exactRepetitions,
      'color-variation': acc['color-variation'] + r.colorVariations,
      'structural-movement': acc['structural-movement'] + r.changes,
    }),
    { 'exact-repetition': 0, 'color-variation': 0, 'structural-movement': 0 },
  );
  const plannedTotal = runs.reduce((s, r) => s + r.plannedArrivals, 0);
  const realizedTotal = runs.reduce((s, r) => s + r.realizedArrivals, 0);
  const opportunitiesTotal = runs.reduce((s, r) => s + r.opportunities, 0);
  const continuationsTotal = runs.reduce((s, r) => s + r.continuations, 0);
  return {
    name: ctx.name,
    key: ctx.key,
    mode: ctx.mode,
    runs,
    aggregates: {
      failures: runs.filter((r) => r.chordCount === 0 || r.warnings > 0).length,
      deterministicAll: runs.every((r) => r.deterministic),
      changesMean: frac((r) => r.changes) ?? 0,
      continuationsMean: frac((r) => r.continuations) ?? 0,
      continuationFraction: opportunitiesTotal > 0 ? continuationsTotal / opportunitiesTotal : null,
      meanDurationTicks: frac((r) => r.meanDurationTicks) ?? 0,
      activityMean: frac((r) => r.activity) ?? 0,
      tonicRootFractionMean: frac((r) => r.tonicRootFraction) ?? 0,
      tonicReinforceFractionMean: frac((r) => r.tonicReinforceFraction) ?? 0,
      firstChordTonicRootedFraction: runs.filter((r) => r.firstChordTonicRooted === true).length / runs.length,
      cadenceRealizationRate: plannedTotal > 0 ? realizedTotal / plannedTotal : null,
      chromaticFractionMean: frac((r) => r.chromaticFraction) ?? 0,
      distinctRootsMean: frac((r) => r.distinctRootsMean) ?? 0,
      sustainedEventsMean: frac((r) => r.sustainedEvents) ?? 0,
      maxSustainedSlotsMax: Math.max(0, ...runs.map((r) => r.maxSustainedSlots)),
      crossWindowMergesTotal: runs.reduce((s, r) => s + r.crossWindowMerges, 0),
      transitionsTotal,
    },
  };
}

// ---- Modes -----------------------------------------------------------------
const label = argValue('--label');
const outPath = argValue('--out');
const compareArg = argValue('--compare');

if (compareArg !== null) {
  // Comparison mode: render a markdown before/after table from two corpora.
  const before = JSON.parse(readFileSync(compareArg, 'utf8')) as { label: string; contexts: ContextRecord[] };
  const afterPath = argv[argv.indexOf('--compare') + 2];
  const after = JSON.parse(readFileSync(afterPath, 'utf8')) as { label: string; contexts: ContextRecord[] };
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const rows: string[] = [];
  rows.push('# Phase 4.3B — Corpus comparison (before → after harmonic continuation)');
  rows.push('');
  rows.push(`Baseline: \`${before.label}\` · Corrected: \`${after.label}\` · ${SEEDS.length} seeds × ${CONTEXTS.length} contexts, Verse-Chorus (8+8), complexity 2, borrowing \`some\`, variation 0.5. Slot-unit metrics are computed identically for both versions (see script header).`);
  rows.push('');
  rows.push('| Context | Metric | before | after | Δ |');
  rows.push('|---|---|---|---|---|');
  for (const cb of before.contexts) {
    const ca = after.contexts.find((c) => c.name === cb.name);
    if (ca === undefined) continue;
    const m = (c: ContextRecord, k: keyof ContextRecord['aggregates']): number =>
      c.aggregates[k] as number;
    const rowsFor: Array<[string, number, number, (v: number) => string]> = [
      ['structural changes / run', m(cb, 'changesMean'), m(ca, 'changesMean'), (v) => v.toFixed(1)],
      ['continuations (holds) / run', m(cb, 'continuationsMean'), m(ca, 'continuationsMean'), (v) => v.toFixed(1)],
      ['continuation fraction of opportunities', m(cb, 'continuationFraction') ?? 0, m(ca, 'continuationFraction') ?? 0, pct],
      ['mean chord duration (ticks)', m(cb, 'meanDurationTicks'), m(ca, 'meanDurationTicks'), (v) => v.toFixed(0)],
      ['harmonic activity (changes/opportunity)', m(cb, 'activityMean'), m(ca, 'activityMean'), (v) => v.toFixed(3)],
      ['tonic-root fraction (structural)', m(cb, 'tonicRootFractionMean'), m(ca, 'tonicRootFractionMean'), pct],
      ['tonic-reinforcing fraction', m(cb, 'tonicReinforceFractionMean'), m(ca, 'tonicReinforceFractionMean'), pct],
      ['first chord tonic-rooted', m(cb, 'firstChordTonicRootedFraction'), m(ca, 'firstChordTonicRootedFraction'), pct],
      ['cadence realization rate', m(cb, 'cadenceRealizationRate') ?? 0, m(ca, 'cadenceRealizationRate') ?? 0, pct],
      ['chromatic foundation fraction', m(cb, 'chromaticFractionMean'), m(ca, 'chromaticFractionMean'), pct],
      ['distinct roots / phrase', m(cb, 'distinctRootsMean'), m(ca, 'distinctRootsMean'), (v) => v.toFixed(2)],
      ['sustained events / run', m(cb, 'sustainedEventsMean'), m(ca, 'sustainedEventsMean'), (v) => v.toFixed(1)],
      ['color-variation transitions', cb.aggregates.transitionsTotal['color-variation'], ca.aggregates.transitionsTotal['color-variation'], (v) => String(v)],
      ['generation failures', cb.aggregates.failures, ca.aggregates.failures, (v) => String(v)],
      ['cross-phrase sustains (total)', cb.aggregates.crossWindowMergesTotal, ca.aggregates.crossWindowMergesTotal, (v) => String(v)],
      ['max sustained run (slots, any seed)', cb.aggregates.maxSustainedSlotsMax, ca.aggregates.maxSustainedSlotsMax, (v) => String(v)],
    ];
    for (const [name, b, a, fmt] of rowsFor) {
      if (!Number.isFinite(b) || !Number.isFinite(a)) continue;
      const delta = a - b;
      const deltaStr = Math.abs(delta) < 1e-9 ? '—' : (delta > 0 ? '+' : '') + (fmt === pct ? pct(delta) : delta.toFixed(2));
      rows.push(`| ${cb.name} | ${name} | ${fmt(b)} | ${fmt(a)} | ${deltaStr} |`);
    }
    rows.push(`| ${cb.name} | determinism (all seeds) | ${cb.aggregates.deterministicAll} | ${ca.aggregates.deterministicAll} | |`);
  }
  const md = rows.join('\n') + '\n';
  if (outPath !== null) {
    const abs = path.resolve(here, '..', outPath);
    writeFileSync(abs, md);
    console.log(`Wrote ${abs}`);
  } else {
    console.log(md);
  }
  process.exit(0);
}

if (label === null || outPath === null) {
  console.error('Usage: --label <name> --out <file.json>  |  --compare <before.json> <after.json> --out <file.md>');
  process.exit(1);
}

const corpus = { label, seeds: SEEDS.length, contexts: CONTEXTS.map(runContext) };
const abs = path.resolve(here, '..', outPath);
writeFileSync(abs, JSON.stringify(corpus, null, 2));
console.log(`Wrote ${abs}`);
for (const c of corpus.contexts) {
  const a = c.aggregates;
  console.log(`  ${c.name}: changes/run ${a.changesMean.toFixed(1)} · holds/run ${a.continuationsMean.toFixed(1)} (${((a.continuationFraction ?? 0) * 100).toFixed(0)}% of opportunities) · mean dur ${a.meanDurationTicks.toFixed(0)}t · tonic-root ${(a.tonicRootFractionMean * 100).toFixed(1)}% · chromatic ${(a.chromaticFractionMean * 100).toFixed(1)}% · cadence ${((a.cadenceRealizationRate ?? 0) * 100).toFixed(0)}% · deterministic ${a.deterministicAll}`);
}
