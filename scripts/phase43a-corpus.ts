/**
 * Phase 4.3A corpus evaluation — measures the tonal-stability correction
 * across modes and seeds, BEFORE and AFTER the change.
 *
 *   npx vite-node scripts/phase43a-corpus.ts --label baseline --out diagnostics/harmony/phase43a/corpus-baseline.json
 *   npx vite-node scripts/phase43a-corpus.ts --label corrected --out diagnostics/harmony/phase43a/corpus-corrected.json
 *   npx vite-node scripts/phase43a-corpus.ts --compare diagnostics/harmony/phase43a/corpus-baseline.json diagnostics/harmony/phase43a/corpus-corrected.json --out diagnostics/harmony/phase43a/CORPUS_COMPARISON.md
 *
 * Reuses the ACTUAL production generator (with diagnostics) — no separate
 * evaluation generator. Every metric is read from recorded output (report /
 * diagnostic slots), never recomputed from re-implemented scoring.
 *
 * Metrics per run (from the recorded diagnostics):
 *  - events, tonic-root fraction, tonic-REINFORCING fraction (root match or
 *    >= 2 shared tonic-triad tones — the existing reinforcesTonic predicate)
 *  - chromatic (non-diatonic) foundation fraction
 *  - distinct roots per phrase (structural diversity)
 *  - transition classifications (exact-repetition / color-variation /
 *    structural-movement — foundation-keyed, per Phase 4.1)
 *  - determinism (same seed twice → identical chord list)
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
  { name: 'D Diminished (Half-Whole)', key: 2, mode: 'Diminished (Half-Whole)' },
];

const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });

function makeProject(key: number, mode: ModeName): Project {
  const base = projectFromFixture({ name: 'Phase43A', tracks: [] });
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
  firstChordTonicRooted: boolean | null;
  tonicRootFraction: number | null;
  tonicReinforceFraction: number | null;
  chromaticFraction: number | null;
  distinctRootsMean: number | null;
  transitions: { 'exact-repetition': number; 'color-variation': number; 'structural-movement': number };
  warnings: number;
  symbols: string[];
}

interface ContextRecord {
  name: string;
  key: number;
  mode: ModeName;
  runs: RunRecord[];
  aggregates: {
    failures: number;
    deterministicAll: boolean;
    tonicRootFractionMean: number;
    tonicReinforceFractionMean: number;
    chromaticFractionMean: number;
    distinctRootsMean: number;
    firstChordTonicRootedFraction: number;
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
    const slots = d?.structure.slots ?? [];
    const events = slots.length;
    const tonic = d?.planning.pool.tonic ?? project.key;
    const tonicRoot = slots.filter((s) => s.selected.rootPc === tonic).length;
    const chromatic = slots.filter((s) => s.selected.diatonic === false).length;
    const transitions = { 'exact-repetition': 0, 'color-variation': 0, 'structural-movement': 0 };
    for (const t of d?.transitions ?? []) transitions[t.classification] += 1;
    const distinct = r1.report.distinctRootsPerPhrase;
    runs.push({
      seed,
      chordCount: r1.chords.length,
      deterministic: JSON.stringify(r1.chords) === JSON.stringify(r2.chords),
      firstChordTonicRooted: slots.length > 0 ? slots[0].selected.rootPc === tonic : null,
      tonicRootFraction: events > 0 ? tonicRoot / events : null,
      tonicReinforceFraction: r1.report.generatedChordCount > 0
        ? r1.report.tonicReinforcementEvents / r1.report.generatedChordCount
        : null,
      chromaticFraction: events > 0 ? chromatic / events : null,
      distinctRootsMean: distinct.length > 0
        ? distinct.reduce((s, v) => s + v, 0) / distinct.length
        : null,
      transitions,
      warnings: r1.report.warnings.length,
      symbols: r1.chords.map((c) => c.symbol),
    });
  }
  const frac = (get: (r: RunRecord) => number | null): number => {
    const vals = runs.map(get).filter((v): v is number => v !== null);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };
  const transitionsTotal = runs.reduce(
    (acc, r) => ({
      'exact-repetition': acc['exact-repetition'] + r.transitions['exact-repetition'],
      'color-variation': acc['color-variation'] + r.transitions['color-variation'],
      'structural-movement': acc['structural-movement'] + r.transitions['structural-movement'],
    }),
    { 'exact-repetition': 0, 'color-variation': 0, 'structural-movement': 0 },
  );
  return {
    name: ctx.name,
    key: ctx.key,
    mode: ctx.mode,
    runs,
    aggregates: {
      failures: runs.filter((r) => r.chordCount === 0 || r.warnings > 0).length,
      deterministicAll: runs.every((r) => r.deterministic),
      tonicRootFractionMean: frac((r) => r.tonicRootFraction),
      tonicReinforceFractionMean: frac((r) => r.tonicReinforceFraction),
      chromaticFractionMean: frac((r) => r.chromaticFraction),
      distinctRootsMean: frac((r) => r.distinctRootsMean),
      firstChordTonicRootedFraction: runs.filter((r) => r.firstChordTonicRooted === true).length / runs.length,
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
  rows.push('# Phase 4.3A — Corpus comparison (before → after the tonal-stability correction)');
  rows.push('');
  rows.push(`Baseline: \`${before.label}\` · Corrected: \`${after.label}\` · ${SEEDS.length} seeds × ${CONTEXTS.length} contexts, Verse-Chorus (8+8), complexity 2, borrowing \`some\`, variation 0.5.`);
  rows.push('');
  rows.push('| Context | Metric | before | after | Δ |');
  rows.push('|---|---|---|---|---|');
  for (const cb of before.contexts) {
    const ca = after.contexts.find((c) => c.name === cb.name);
    if (ca === undefined) continue;
    const m = (c: ContextRecord, k: keyof ContextRecord['aggregates']): number =>
      c.aggregates[k] as number;
    const rowsFor: Array<[string, number, number, (v: number) => string]> = [
      ['tonic-root fraction (structural)', m(cb, 'tonicRootFractionMean'), m(ca, 'tonicRootFractionMean'), pct],
      ['tonic-reinforcing fraction', m(cb, 'tonicReinforceFractionMean'), m(ca, 'tonicReinforceFractionMean'), pct],
      ['chromatic foundation fraction', m(cb, 'chromaticFractionMean'), m(ca, 'chromaticFractionMean'), pct],
      ['distinct roots / phrase', m(cb, 'distinctRootsMean'), m(ca, 'distinctRootsMean'), (v) => v.toFixed(2)],
      ['first chord tonic-rooted', m(cb, 'firstChordTonicRootedFraction'), m(ca, 'firstChordTonicRootedFraction'), pct],
      ['exact-repetition transitions', cb.aggregates.transitionsTotal['exact-repetition'], ca.aggregates.transitionsTotal['exact-repetition'], (v) => String(v)],
      ['color-variation transitions', cb.aggregates.transitionsTotal['color-variation'], ca.aggregates.transitionsTotal['color-variation'], (v) => String(v)],
      ['structural-movement transitions', cb.aggregates.transitionsTotal['structural-movement'], ca.aggregates.transitionsTotal['structural-movement'], (v) => String(v)],
      ['generation failures', cb.aggregates.failures, ca.aggregates.failures, (v) => String(v)],
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
  console.log(`  ${c.name}: tonic-root ${(a.tonicRootFractionMean * 100).toFixed(1)}% · reinforcing ${(a.tonicReinforceFractionMean * 100).toFixed(1)}% · chromatic ${(a.chromaticFractionMean * 100).toFixed(1)}% · roots/phrase ${a.distinctRootsMean.toFixed(2)} · deterministic ${a.deterministicAll}`);
}
