/**
 * Phase 4.3C — deep analysis of the audit corpus (feeds REPORT.md).
 *
 * Reads diagnostics/harmony/audit/phase43c/audit-results.json (the tagged,
 * committable representative set) and prints evidence for the eight
 * diagnostic questions (spec §11). Read-only.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] ?? path.resolve(here, '..', 'diagnostics/harmony/audit/phase43c/audit-results.json');
const corpus = JSON.parse(readFileSync(file, 'utf8')) as {
  cells: Array<{
    context: { name: string; key: number; mode: string };
    structure: { id: string; label: string; bars: number };
    configs: Record<string, {
      aggregate: {
        runs: number; failures: number; deterministicAll: boolean;
        tonicRootedArrivalFraction: number | null;
        realizedArrivalFraction: number | null;
        meanDistinctRootsPerPhrase: number | null;
        metrics: Record<string, { mean: number; min: number; max: number; median: number }>;
      };
      runs: Array<{
        seed: number;
        progression?: Array<{ symbol: string; foundation: string | null; diatonic: boolean | null; borrowed: boolean; nonDiatonicCoreNames: string[]; borrowedProvenance: string[]; startTick: number; durationTicks: number; sectionId: string | null; slotCount: number | null }>;
        metrics: {
          phraseArrivals: Array<{ intention: string; finalFoundation: string | null; finalSymbol: string | null; tonicRooted: boolean | null; realizedFamily: string | null }>;
          recurringFoundationMotifs: string[];
          structuralChanges: number;
          changesPerBar: number | null;
          chromaticFoundations: number;
          borrowedRelationships: string[];
          sectionIdentityOverlap: Array<{ a: string; b: string; overlap: number }>;
          consecutiveRepetitions: number;
          colorOnlyAdjacentChanges: number;
        };
      }>;
    }>;
  }>;
};

const pct = (v: number | null): string => v === null ? '—' : `${(v * 100).toFixed(1)}%`;
const cells = corpus.cells;

console.log('=== 1. Structural identity of A vs B vs C (does complexity/borrowing change the journey?) ===');
let abIdentical = 0; let abTotal = 0; let acDiffs = 0; let acTotals = 0;
for (const cell of cells) {
  const a = cell.configs.A?.aggregate; const b = cell.configs.B?.aggregate; const c = cell.configs.C?.aggregate;
  if (!a || !b) continue;
  abTotal++;
  const same = a.metrics.structuralChanges.mean === b.metrics.structuralChanges.mean
    && a.metrics.foundationDiversity.mean === b.metrics.foundationDiversity.mean;
  if (same) abIdentical++;
  if (a && c) {
    acTotals++;
    if (Math.abs(a.metrics.structuralChanges.mean - c.metrics.structuralChanges.mean) > 0.5
      || a.metrics.foundationDiversity.mean !== c.metrics.foundationDiversity.mean) acDiffs++;
  }
}
console.log(`A≡B structurally identical cells: ${abIdentical}/${abTotal}`);
console.log(`A vs C structurally divergent cells (>0.5 changes or different foundation sets): ${acDiffs}/${acTotals}`);

console.log('\n=== 2. Change rate distribution (harmonic pacing) ===');
const byMode = new Map<string, { a: number; c: number; n: number }>();
for (const cell of cells) {
  const key = cell.context.name;
  const e = byMode.get(key) ?? { a: 0, c: 0, n: 0 };
  if (cell.configs.A) e.a += cell.configs.A.aggregate.metrics.changesPerBar.mean;
  if (cell.configs.C) e.c += cell.configs.C.aggregate.metrics.changesPerBar.mean;
  e.n++;
  byMode.set(key, e);
}
for (const [name, e] of byMode) {
  console.log(`${name}: A ${((e.a / e.n)).toFixed(2)} chg/bar · C ${((e.c / e.n)).toFixed(2)} chg/bar`);
}

console.log('\n=== 3. Phrase arrivals: how do planned intentions realize? (Q4, Q5) ===');
const intentions = new Map<string, { total: number; tonicRooted: number; realized: number; families: Map<string, number> }>();
for (const cell of cells) {
  for (const id of ['A', 'B', 'C']) {
    const cfg = cell.configs[id];
    if (!cfg) continue;
    for (const run of cfg.runs) {
      for (const arr of run.metrics.phraseArrivals) {
        const e = intentions.get(arr.intention) ?? { total: 0, tonicRooted: 0, realized: 0, families: new Map() };
        e.total++;
        if (arr.tonicRooted === true) e.tonicRooted++;
        if (arr.realizedFamily !== null) {
          e.realized++;
          e.families.set(arr.realizedFamily, (e.families.get(arr.realizedFamily) ?? 0) + 1);
        }
        intentions.set(arr.intention, e);
      }
    }
  }
}
for (const [intent, e] of [...intentions.entries()].sort((a, b) => b[1].total - a[1].total)) {
  const fams = [...e.families.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4)
    .map(([f, n]) => `${f} ${pct(n / e.realized)}`).join(' · ');
  console.log(`${intent}: n=${e.total} · tonic-rooted ${pct(e.tonicRooted / e.total)} · family realized ${pct(e.realized / e.total)} [${fams}]`);
}

console.log('\n=== 4. Tonic-rooted FINAL arrivals only (resolved intention) ===');
{
  let total = 0; let tonic = 0;
  for (const cell of cells) {
    for (const id of ['A', 'B', 'C']) {
      for (const run of cell.configs[id]?.runs ?? []) {
        for (const arr of run.metrics.phraseArrivals) {
          if (arr.intention !== 'resolved') continue;
          total++;
          if (arr.tonicRooted === true) tonic++;
        }
      }
    }
  }
  console.log(`resolved arrivals ending on tonic-root harmony: ${tonic}/${total} = ${pct(total > 0 ? tonic / total : null)}`);
}

console.log('\n=== 5. Chromatic foundations in config C — what are they? (Q3) ===');
const chromKinds = new Map<string, { n: number; provenance: Map<string, number> }>();
let chromRuns = 0; let chromZeroRuns = 0;
for (const cell of cells) {
  const cfg = cell.configs.C;
  if (!cfg) continue;
  for (const run of cfg.runs) {
    const prog = run.progression;
    if (!prog) continue;
    const borrowed = prog.filter((e) => e.borrowed);
    if (borrowed.length === 0) { chromZeroRuns++; continue; }
    chromRuns++;
    for (const e of borrowed) {
      const label = `${e.foundation} (needs ${e.nonDiatonicCoreNames.join('/')})`;
      const entry = chromKinds.get(label) ?? { n: 0, provenance: new Map() };
      entry.n++;
      for (const m of e.borrowedProvenance) entry.provenance.set(m, (entry.provenance.get(m) ?? 0) + 1);
      chromKinds.set(label, entry);
    }
  }
}
console.log(`sampled runs with ≥1 chromatic foundation: ${chromRuns} · without: ${chromZeroRuns}`);
for (const [label, e] of [...chromKinds.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) {
  const prov = [...e.provenance.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${m}×${n}`).join(', ');
  console.log(`  ${e.n}× ${label} — provenance: ${prov || '(no parallel mode contains the core)'}`);
}

console.log('\n=== 6. Symmetric-mode C anomaly: Whole Tone & Diminished chromatic share ===');
for (const name of ['C Whole Tone', 'D Diminished (Half-Whole)', 'D Diminished (Whole-Half)']) {
  const cell = cells.find((c) => c.context.name === name && c.structure.id === 'verse-chorus');
  if (!cell?.configs.C) continue;
  const runs = cell.configs.C.runs.filter((r) => r.progression);
  const kinds = new Map<string, number>();
  for (const run of runs) for (const e of run.progression ?? []) if (e.borrowed) kinds.set(e.foundation, (kinds.get(e.foundation) ?? 0) + 1);
  console.log(`${name} (verse-chorus, C): chromatic events/run ${cell.configs.C.aggregate.metrics.chromaticFoundations.mean.toFixed(1)} (${pct(cell.configs.C.aggregate.metrics.chromaticDurationFraction.mean)} of duration)`);
  console.log(`  kinds: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`).join(' · ') || '(none in samples)'}`);
}

console.log('\n=== 7. Repeated-section identity (Q7): foundation overlap between related Chorus sections ===');
{
  let n = 0; let sum = 0; let min = 1; let max = 0;
  for (const cell of cells) {
    if (cell.structure.id !== 'full-form') continue;
    for (const id of ['A', 'B', 'C']) {
      for (const run of cell.configs[id]?.runs ?? []) {
        for (const ov of run.metrics.sectionIdentityOverlap) {
          n++; sum += ov.overlap;
          min = Math.min(min, ov.overlap); max = Math.max(max, ov.overlap);
        }
      }
    }
  }
  console.log(n > 0 ? `overlap pairs n=${n} · mean ${pct(sum / n)} · range ${(min * 100).toFixed(0)}%–${(max * 100).toFixed(0)}%` : 'no overlap pairs recorded');
}

console.log('\n=== 8. Recurring harmonic motifs (Q7) — distinct motifs per run (A vs C, full-form) ===');
{
  let withMotifA = 0; let withMotifC = 0; let n = 0;
  for (const cell of cells) {
    if (cell.structure.id !== 'full-form' || cell.context.name !== 'E Aeolian') continue;
    for (const run of cell.configs.A?.runs ?? []) { n++; if (run.metrics.recurringFoundationMotifs.length > 0) withMotifA++; }
    for (const run of cell.configs.C?.runs ?? []) { if (run.metrics.recurringFoundationMotifs.length > 0) withMotifC++; }
  }
  console.log(`E Aeolian full-form: runs with ≥1 recurring 3-motif — A ${withMotifA}/${n} · C ${withMotifC}/${n}`);
  const sample = cells.find((c) => c.context.name === 'E Aeolian' && c.structure.id === 'full-form')?.configs.A?.runs.find((r) => r.metrics.recurringFoundationMotifs.length > 0);
  if (sample) console.log(`  example motifs: ${sample.metrics.recurringFoundationMotifs.slice(0, 3).join(' ; ')}`);
}

console.log('\n=== 9. Per-seed spread of changesPerBar (E Aeolian verse-chorus) ===');
{
  const cell = cells.find((c) => c.context.name === 'E Aeolian' && c.structure.id === 'verse-chorus');
  for (const id of ['A', 'C']) {
    const runs = cell?.configs[id]?.runs ?? [];
    const vals = runs.map((r) => r.metrics.changesPerBar ?? 0).sort((a, b) => a - b);
    if (vals.length === 0) continue;
    console.log(`Config ${id}: min ${vals[0].toFixed(2)} · p25 ${vals[Math.floor(vals.length * 0.25)].toFixed(2)} · median ${vals[Math.floor(vals.length / 2)].toFixed(2)} · p75 ${vals[Math.floor(vals.length * 0.75)].toFixed(2)} · max ${vals[vals.length - 1].toFixed(2)}`);
  }
}

console.log('\n=== 10. Seed-34 E Aeolian verse-chorus matched example (spec §8 illustration) ===');
{
  const cell = cells.find((c) => c.context.name === 'E Aeolian' && c.structure.id === 'verse-chorus');
  if (cell) {
    for (const id of ['A', 'B', 'C']) {
      const run = cell.configs[id]?.runs.find((r) => r.seed === 34);
      if (!run?.progression) continue;
      const bySec = new Map<string, string[]>();
      for (const e of run.progression) {
        const arr = bySec.get(e.sectionId ?? '?') ?? [];
        arr.push(e.symbol + (e.borrowed ? '*' : ''));
        bySec.set(e.sectionId ?? '?', arr);
      }
      console.log(`CONFIG ${id}:`);
      for (const [secId, syms] of bySec) console.log(`  ${secId}: ${syms.join(' | ')}`);
      const fnd = [...new Set(run.progression.map((e) => e.foundation))];
      console.log(`  foundations (${fnd.length}): ${fnd.join(' → ')}`);
    }
  }
}
