/**
 * Phase 5 — Complete Progression Evaluation & Musical Coherence: final
 * development audit CLI (spec §20).
 *
 *   npm run phase5:audit
 *   npm run phase5:audit -- --quick        (fewer seeds, for smoke runs)
 *
 * Runs the ACTUAL production Phase 5 path — `generateEvaluatedProgression`
 * (bounded complete candidates → whole-song evaluation → seeded selection) —
 * across song structures, all twelve modes, a twelve-key sweep, harmonic
 * complexity/borrowing settings and ≥ 30 deterministic seeds per
 * representative cell. Writes to diagnostics/harmony/phase5/:
 *
 *   phase5-audit-results.json   aggregates + representative per-run records
 *   phase5-audit-summary.md     aggregate tables, performance measurements,
 *                               candidate-comparison samples, honesty notes
 *
 * HONESTY (spec §20): nothing here claims the generator produces excellent
 * music. Heuristic evaluation scores are INTERNAL SELECTION TOOLS — they are
 * reported beside objective measurements and explicitly separated from them.
 * The final judgment is a human listening review.
 *
 * No browser, no UI, no project writes, no new dependencies.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { projectFromFixture, type Project, type Section } from '../src/shared/schema';
import { DEFAULT_CHORDGEN_SETTINGS, type ChordGenSettings } from '../src/shared/schema/types';
import { MODE_NAMES, type ModeName } from '../src/shared/schema/modes';
import { generateEvaluatedProgression, type EvaluatedProgressionResult } from '../src/engine/harmony/selection';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const outDir = path.join(repoRoot, 'diagnostics', 'harmony', 'phase5');
const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');

const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });

/* --------------------------------------------------------------------------
 * Corpus (spec §20) — structures × modes × keys × settings × seeds
 * ------------------------------------------------------------------------ */

const STRUCTURES: Array<{ id: string; sections: Section[] }> = [
  {
    id: 'V/C verse-chorus',
    sections: [sec('v1', 'Verse 1', 1, 8), sec('c1', 'Chorus 1', 9, 8), sec('v2', 'Verse 2', 17, 8), sec('c2', 'Chorus 2', 25, 8)],
  },
  {
    id: 'full arrangement',
    sections: [sec('intro', 'Intro', 1, 4), sec('v1', 'Verse 1', 5, 8), sec('c1', 'Chorus 1', 13, 8), sec('br', 'Bridge', 21, 8), sec('c2', 'Final Chorus', 29, 8), sec('out', 'Outro', 37, 4)],
  },
  {
    id: 'irregular lengths',
    sections: [sec('a', 'Intro', 1, 5), sec('b', 'Verse', 6, 7), sec('c', 'Build', 13, 4), sec('d', 'Chorus', 17, 9)],
  },
];

const SEEDS = QUICK
  ? [1, 2, 3, 4, 5]
  : Array.from({ length: 30 }, (_, i) => i + 1);

function makeProject(mode: ModeName, key: number, structure: Section[], settings?: Partial<ChordGenSettings>): Project {
  return {
    ...projectFromFixture({ name: 'Phase5Audit', tracks: [] }),
    key,
    mode,
    sections: structure,
    chords: [],
    chordGenSettings: { ...DEFAULT_CHORDGEN_SETTINGS, ...(settings ?? {}) },
  };
}

/* --------------------------------------------------------------------------
 * Run + aggregate
 * ------------------------------------------------------------------------ */

interface RunRecord {
  cell: string;
  mode: ModeName;
  key: number;
  keyName: string;
  structure: string;
  seed: number;
  settingsNote: string;
  ms: number;
  candidateCount: number;
  distinctSignatures: number;
  meanPairwiseDistance: number;
  competitiveCount: number;
  pickedIndex: number;
  pickedRank: number;
  selectedTotal: number;
  bestTotal: number;
  symbols: string[];
  foundations: string[];
  changesPerBar: number;
  distinctRoots: number;
  chromaticShare: number;
  phraseCount: number;
  cadenceIntentions: string[];
  components: Record<string, number | null>;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function runCell(
  cell: string,
  mode: ModeName,
  key: number,
  structure: Section[],
  structureId: string,
  seeds: number[],
  settings?: Partial<ChordGenSettings>,
): RunRecord[] {
  const settingsNote = settings
    ? Object.entries(settings).map(([k, v]) => `${k}=${String(v)}`).join(', ')
    : 'project defaults';
  const records: RunRecord[] = [];
  for (const seed of seeds) {
    const project = makeProject(mode, key, structure, settings);
    const t0 = performance.now();
    const out: EvaluatedProgressionResult = generateEvaluatedProgression(project, { seed });
    const ms = performance.now() - t0;
    const picked = out.selection.candidates[out.selection.selection.pickedIndex];
    records.push({
      cell,
      mode,
      key,
      keyName: NOTE_NAMES[key],
      structure: structureId,
      seed,
      settingsNote,
      ms,
      candidateCount: out.selection.candidateCount,
      distinctSignatures: out.selection.diversity.distinctSignatures,
      meanPairwiseDistance: out.selection.diversity.meanPairwiseDistance,
      competitiveCount: out.selection.selection.competitiveCount,
      pickedIndex: out.selection.selection.pickedIndex,
      pickedRank: picked.rank,
      selectedTotal: out.evaluation.total,
      bestTotal: Math.max(...out.selection.candidates.map((c) => c.totalScore)),
      symbols: out.chords.map((c) => c.symbol),
      foundations: out.evaluation.facts.foundationLabels,
      changesPerBar: out.evaluation.facts.changesPerBar,
      distinctRoots: out.evaluation.facts.distinctRoots,
      chromaticShare: out.evaluation.phrases.length > 0
        ? out.evaluation.phrases.reduce((s, p) => s + p.facts.chromaticShare * (p.endTick - p.startTick), 0)
          / out.evaluation.phrases.reduce((s, p) => s + (p.endTick - p.startTick), 0)
        : 0,
      phraseCount: out.evaluation.phrases.length,
      cadenceIntentions: out.evaluation.phrases
        .filter((p) => !p.synthetic)
        .map((p) => `${p.role}/${p.cadenceIntention}`),
      components: { ...out.evaluation.components },
    });
  }
  return records;
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0; }
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }
function r3(x: number): number { return Math.round(x * 1000) / 1000; }

interface CellAggregate {
  cell: string;
  runs: number;
  totalMean: number;
  componentsMean: Record<string, number>;
  /** Components that were null in EVERY run (genuinely not applicable). */
  componentsNa: string[];
  candidateCountMean: number;
  distinctSignaturesMean: number;
  meanPairwiseDistance: number;
  competitiveMean: number;
  pickedNotTopRate: number;
  selectedVsBestGap: number;
  changesPerBarMean: number;
  distinctRootsMean: number;
  chromaticShareMean: number;
  msMean: number;
  msMedian: number;
  msMax: number;
}

function aggregate(cellRecords: RunRecord[]): CellAggregate {
  const componentKeys = Object.keys(cellRecords[0].components);
  const componentsMean: Record<string, number> = {};
  const componentsNa: string[] = [];
  for (const k of componentKeys) {
    const vals = cellRecords.map((r) => r.components[k]).filter((v): v is number => v !== null);
    if (vals.length === 0) { componentsNa.push(k); continue; }
    componentsMean[k] = r3(mean(vals));
  }
  return {
    cell: cellRecords[0].cell,
    runs: cellRecords.length,
    totalMean: r3(mean(cellRecords.map((r) => r.selectedTotal))),
    componentsMean,
    componentsNa,
    candidateCountMean: r3(mean(cellRecords.map((r) => r.candidateCount))),
    distinctSignaturesMean: r3(mean(cellRecords.map((r) => r.distinctSignatures))),
    meanPairwiseDistance: r3(mean(cellRecords.map((r) => r.meanPairwiseDistance))),
    competitiveMean: r3(mean(cellRecords.map((r) => r.competitiveCount))),
    pickedNotTopRate: r3(cellRecords.filter((r) => r.pickedRank !== 0).length / cellRecords.length),
    selectedVsBestGap: r3(mean(cellRecords.map((r) => r.bestTotal - r.selectedTotal))),
    changesPerBarMean: r3(mean(cellRecords.map((r) => r.changesPerBar))),
    distinctRootsMean: r3(mean(cellRecords.map((r) => r.distinctRoots))),
    chromaticShareMean: r3(mean(cellRecords.map((r) => r.chromaticShare))),
    msMean: Math.round(mean(cellRecords.map((r) => r.ms))),
    msMedian: Math.round(median(cellRecords.map((r) => r.ms))),
    msMax: Math.round(Math.max(...cellRecords.map((r) => r.ms))),
  };
}

/* --------------------------------------------------------------------------
 * Execute
 * ------------------------------------------------------------------------ */

const t0 = performance.now();
const allRecords: RunRecord[] = [];
const aggregates: CellAggregate[] = [];
function addAggregate(records: RunRecord[]): void {
  if (records.length === 0) return;
  aggregates.push(aggregate(records));
  allRecords.push(...records);
  process.stdout.write(`  ${records[0].cell}: ${records.length} runs done\n`);
}

console.log('Phase 5 audit — modes × structures × seeds');
for (const mode of MODE_NAMES) {
  for (const structure of STRUCTURES) {
    const records = runCell(
      `${mode} / ${structure.id}`, mode, 4, structure.sections, structure.id, SEEDS,
    );
    addAggregate(records);
  }
}

console.log('Twelve-key sweep (Aeolian, verse-chorus)');
for (let key = 0; key < 12; key++) {
  const structure = STRUCTURES[0];
  const records = runCell(
    `key ${NOTE_NAMES[key]} Aeolian / ${structure.id}`, 'Aeolian', key, structure.sections, structure.id, SEEDS,
  );
  addAggregate(records);
}

console.log('Settings sweep (E Aeolian, verse-chorus)');
const SETTINGS_VARIANTS: Array<Partial<ChordGenSettings>> = [
  { complexity: 1, borrowing: 'none' },
  { complexity: 2, borrowing: 'none' },
  { complexity: 3, borrowing: 'none' },
  { complexity: 2, borrowing: 'some' },
  { complexity: 3, borrowing: 'more' },
  { density: 0 },
  { density: 2 },
];
for (const settings of SETTINGS_VARIANTS) {
  const structure = STRUCTURES[0];
  const records = runCell(
    `settings ${Object.entries(settings).map(([k, v]) => `${k}=${String(v)}`).join(', ')}`,
    'Aeolian', 4, structure.sections, structure.id, SEEDS, settings,
  );
  addAggregate(records);
}

// Long-form performance measurement (§18): a 200-bar arrangement.
let perfLong: { mean: number; median: number; max: number } = { mean: 0, median: 0, max: 0 };
console.log('Performance: 200-bar arrangement');
{
  const longSections: Section[] = [];
  for (let b = 1, i = 0; b <= 200; b += 8, i++) {
    longSections.push(sec(`s${i}`, i % 2 === 0 ? 'Verse' : 'Chorus', b, Math.min(8, 200 - b + 1)));
  }
  const project = makeProject('Aeolian', 4, longSections);
  generateEvaluatedProgression(project, { seed: 1 }); // warmup
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const s = performance.now();
    generateEvaluatedProgression(project, { seed: 10 + i });
    times.push(performance.now() - s);
  }
  console.log(`  200-bar: mean ${Math.round(mean(times))}ms median ${Math.round(median(times))}ms max ${Math.round(Math.max(...times))}ms`);
  perfLong = { mean: Math.round(mean(times)), median: Math.round(median(times)), max: Math.round(Math.max(...times)) };
}

// Typical-song performance is already captured per-run (msMean/msMedian of
// the E Aeolian verse-chorus cell).

/* --------------------------------------------------------------------------
 * Representative per-run records (bounded output, §13-style deliverables)
 * ------------------------------------------------------------------------ */

const REPRESENTATIVE_SEEDS = QUICK ? [1, 2] : [1, 7, 14, 23];
const representative = allRecords.filter((r) => REPRESENTATIVE_SEEDS.includes(r.seed)
  && (r.cell.startsWith('Aeolian / V/C') || r.cell.startsWith('Whole Tone / V/C')
    || r.cell.includes('full arrangement') || r.cell.startsWith('key E Aeolian')));

// Candidate-comparison samples: full candidate tables for a few runs.
const comparisonSamples: Array<Record<string, unknown>> = [];
{
  const sampleCells = [
    { mode: 'Aeolian' as ModeName, structure: STRUCTURES[0], seeds: REPRESENTATIVE_SEEDS.slice(0, 2) },
    { mode: 'Dorian' as ModeName, structure: STRUCTURES[1], seeds: REPRESENTATIVE_SEEDS.slice(0, 1) },
    { mode: 'Whole Tone' as ModeName, structure: STRUCTURES[0], seeds: REPRESENTATIVE_SEEDS.slice(0, 1) },
  ];
  for (const s of sampleCells) {
    for (const seed of s.seeds) {
      const project = makeProject(s.mode, 4, s.structure.sections);
      const out = generateEvaluatedProgression(project, { seed });
      comparisonSamples.push({
        mode: s.mode,
        structure: s.structure.id,
        seed,
        selectedSymbols: out.chords.map((c) => c.symbol),
        selectionNote: out.selection.selection.note,
        candidates: out.selection.candidates.map((c) => ({
          seed: c.seed,
          rank: c.rank,
          totalScore: r3(c.totalScore),
          competitive: c.inCompetitiveSet,
          selected: c.selected,
          distinctRoots: c.facts.distinctRoots,
          changesPerBar: r3(c.facts.changesPerBar),
          signature: c.facts.structuralSignature,
          scores: Object.fromEntries(Object.entries(c.scores).map(([k, v]) => [k, v === null ? null : r3(v)])),
        })),
        diversity: {
          distinctSignatures: out.selection.diversity.distinctSignatures,
          meanPairwiseDistance: r3(out.selection.diversity.meanPairwiseDistance),
        },
      });
    }
  }
}

/* --------------------------------------------------------------------------
 * Write outputs
 * ------------------------------------------------------------------------ */

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const json = {
  meta: {
    engine: 'crescode-phase5-audit',
    date: new Date().toISOString(),
    quick: QUICK,
    seedsPerCell: SEEDS.length,
    structures: STRUCTURES.map((s) => s.id),
    note: 'Heuristic evaluation scores are INTERNAL SELECTION TOOLS, not measures of musical quality. The final judgment is human listening (Phase 5 spec §20).',
    performance200Bars: perfLong,
  },
  aggregates,
  representativeRuns: representative,
  candidateComparisons: comparisonSamples,
};
const jsonPath = path.join(outDir, 'phase5-audit-results.json');
writeFileSync(jsonPath, JSON.stringify(json));

/* Markdown summary */
const lines: string[] = [];
lines.push('# Phase 5 — Complete Progression Evaluation & Musical Coherence: Development Audit');
lines.push('');
lines.push(`Generated ${new Date().toISOString()} · ${QUICK ? 'QUICK' : 'full'} corpus · ${SEEDS.length} seeds per cell · ${allRecords.length} generation runs total`);
lines.push('');
lines.push('> **Reading this report honestly (spec §20)**');
lines.push('>');
lines.push('> The evaluation system is a tool for selecting more coherent alternatives — it is');
lines.push('> **not** proof of artistic quality. `total` and every component below are internal');
lines.push('> 0..1 heuristic fits (clearly separated from the objective facts beside them).');
lines.push('> A candidate selected because its evaluator liked it is a *candidate the system');
lines.push('> could argue for* — whether the music is convincing is decided by human listening.');
lines.push('');
lines.push('## What Phase 5 added');
lines.push('');
lines.push('- Whole-phrase and whole-song evaluation (`evaluatePhrase`, `evaluateSongProgression`): structural movement before color, phrase-intention context, duration-based continuation, contextual cadence/chromatic judgments, repeated-section identity, symmetrical-scale-safe tonal identity.');
lines.push('- Bounded complete-candidate generation over the UNMODIFIED production generator (candidate 0 = the requested seed; the Phase 4 result is always in the field).');
lines.push('- Deterministic seeded selection among musically competitive candidates (margin-based, no score floor).');
lines.push('- Scope/lock safety by construction: selection only PICKS complete candidates; protected material is identical in every candidate.');
lines.push('');
lines.push('## Aggregate results');
lines.push('');
lines.push('| Cell | runs | total (mean) | tonal | continuity | rep-sect | arrival | rhythm | chromatic | cands | sig | div | competit. | picked≠top | cpb | roots | chromShare | ms mean |');
lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const a of aggregates) {
  const c = a.componentsMean;
  const na = (k: string) => (a.componentsNa.includes(k) ? 'n/a' : (c[k] ?? 0).toFixed(3));
  lines.push(`| ${a.cell} | ${a.runs} | ${a.totalMean.toFixed(3)} | ${(c.tonalIdentity ?? 0).toFixed(3)} | ${na('harmonicContinuity')} | ${na('repeatedSectionIdentity')} | ${na('arrivalQuality')} | ${na('harmonicRhythmFit')} | ${c.chromaticCoherence.toFixed(3)} | ${a.candidateCountMean.toFixed(1)} | ${a.distinctSignaturesMean.toFixed(1)} | ${a.meanPairwiseDistance.toFixed(3)} | ${a.competitiveMean.toFixed(1)} | ${(a.pickedNotTopRate * 100).toFixed(0)}% | ${a.changesPerBarMean.toFixed(2)} | ${a.distinctRootsMean.toFixed(1)} | ${a.chromaticShareMean.toFixed(3)} | ${a.msMean} |`);
}
lines.push('');
lines.push('Column glossary: `total` = selected candidate\u2019s heuristic song fit (selection signal only); `sig` = mean distinct structural signatures among candidates; `div` = mean pairwise structural distance; `competit.` = mean competitive-set size; `picked≠top` = share of runs where the seeded pick was not the top-ranked candidate (§15 variation behavior); `cpb` = structural changes per bar (objective); `roots` = distinct foundation roots (objective); `chromShare` = duration share of non-diatonic foundations (objective); `ms` = wall-clock per evaluated generation.');
lines.push('');
lines.push('## Performance (measured, §18)');
lines.push('');
{
  const typical = aggregates.find((a) => a.cell.startsWith('Aeolian / V/C'));
  lines.push(`- Typical 40-bar verse/chorus project: mean ${typical?.msMean ?? 'n/a'} ms, median ${typical?.msMedian ?? 'n/a'} ms, max ${typical?.msMax ?? 'n/a'} ms per evaluated generation (${typical?.candidateCountMean ?? '?'} candidates).`);
  lines.push(`- 200-bar arrangement: mean ${perfLong.mean} ms, median ${perfLong.median} ms, max ${perfLong.max} ms.`);
  lines.push(`- Targets (§18): < 150 ms typical, < 500 ms at 200 bars — ${((typical?.msMean ?? 999) < 150 && perfLong.mean < 500) ? 'MET' : 'see numbers above'}.`);
}
lines.push('');
lines.push('## Candidate comparison samples');
lines.push('');
for (const s of comparisonSamples) {
  const c = s as { mode: string; structure: string; seed: number; selectedSymbols: string[]; candidates: Array<{ seed: number; rank: number; totalScore: number; selected: boolean; signature: string[] }> };
  lines.push(`### ${c.mode} · ${c.structure} · seed ${c.seed}`);
  lines.push('');
  lines.push(`Selected (${c.candidates.filter((x) => x.selected).length} of ${c.candidates.length} candidates; signatures: ${c.candidates.map((x) => x.signature.length + '-foundations').join(', ')}):`);
  lines.push('');
  lines.push('```text');
  lines.push(c.selectedSymbols.join(' → '));
  lines.push('```');
  lines.push('');
  lines.push('| seed | rank | total | signature (foundations in order) |');
  lines.push('|---|---|---|---|');
  for (const cand of c.candidates) {
    lines.push(`| ${cand.seed}${cand.selected ? ' ✅' : ''} | ${cand.rank} | ${cand.totalScore.toFixed(3)} | ${cand.signature.join(' → ')} |`);
  }
  lines.push('');
}
lines.push('## Next step (mandated by the Phase 5 spec)');
lines.push('');
lines.push('Comprehensive HUMAN listening review of the completed generator, followed by targeted corrections. The evaluator\u2019s weights (documented in `src/engine/harmony/evaluation.ts` as calibration heuristics) exist to be adjusted against what listeners actually prefer — not to certify the output.');
lines.push('');

const summaryPath = path.join(outDir, 'phase5-audit-summary.md');
writeFileSync(summaryPath, lines.join('\n') + '\n');

console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${summaryPath}`);
console.log(`Total audit wall-clock: ${Math.round((performance.now() - t0) / 1000)}s across ${allRecords.length} runs`);
