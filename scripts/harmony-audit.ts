/**
 * Phase 4.3C — Controlled musical audit CLI (spec §5, §13).
 *
 *   npm run harmony:audit -- --key E --mode Aeolian --seeds 30
 *   npm run harmony:audit -- --all --out diagnostics/harmony/audit/latest
 *
 * Runs the ACTUAL production generator under three matched configurations
 * (A basic triads / B diatonic color / C full vocabulary) across contexts,
 * arrangement structures and deterministic seeds, then writes:
 *
 *   audit-results.json        machine-readable corpus (per-run metrics)
 *   audit-summary.md          human-readable aggregate tables
 *   matched-comparisons.txt   side-by-side A/B/C for EVERY project × seed
 *   midi/ (optional)          consistent-audition MIDI files (§9)
 *   listening-template.md     human evaluation rubric (§10)
 *
 * No browser, no UI, no project writes, no new dependencies, no changes to
 * production generation. Reuses Phase 4.2 diagnostics internally through the
 * audit core (src/engine/harmony/audit.ts).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  AUDIT_CONFIGURATIONS, aggregateRuns, formatCellSummary, formatMatchedComparison,
  runAuditConfig, type AuditAggregate, type AuditConfigId, type AuditRunRecord,
} from '../src/engine/harmony/audit';
import { buildAuditionMidi } from '../src/engine/harmony/audit-midi';
import { projectFromFixture, type Project, type Section } from '../src/shared/schema';
import { DEFAULT_CHORDGEN_SETTINGS, type ModeName } from '../src/shared/schema/types';
import { MODE_NAMES } from '../src/shared/schema/modes';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const argv = process.argv.slice(2);
const argValue = (flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const hasFlag = (flag: string): boolean => argv.includes(flag);

/* --------------------------------------------------------------------------
 * Corpus definitions (spec §4) — 9 contexts × 6 structures
 * ------------------------------------------------------------------------ */

const CONTEXTS: Array<{ name: string; key: number; mode: ModeName }> = [
  { name: 'E Aeolian', key: 4, mode: 'Aeolian' },
  { name: 'D Dorian', key: 2, mode: 'Dorian' },
  { name: 'C Ionian', key: 0, mode: 'Ionian' },
  { name: 'D Phrygian', key: 2, mode: 'Phrygian' },
  { name: 'D Lydian', key: 2, mode: 'Lydian' },
  { name: 'E Harmonic Minor', key: 4, mode: 'Harmonic Minor' },
  { name: 'C Whole Tone', key: 0, mode: 'Whole Tone' },
  { name: 'D Diminished (Half-Whole)', key: 2, mode: 'Diminished (Half-Whole)' },
  { name: 'D Diminished (Whole-Half)', key: 2, mode: 'Diminished (Whole-Half)' },
];

const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });

interface StructureDef {
  id: string;
  label: string;
  sections: Section[];
}

const STRUCTURES: StructureDef[] = [
  { id: 'single-8', label: 'Single eight-bar section', sections: [sec('a', 'Section', 1, 8)] },
  { id: 'verse-16', label: 'Sixteen-bar Verse', sections: [sec('a', 'Verse', 1, 16)] },
  { id: 'verse-chorus', label: 'Verse → Chorus', sections: [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)] },
  { id: 'verse-prechorus-chorus', label: 'Verse → Pre-Chorus → Chorus', sections: [sec('a', 'Verse', 1, 8), sec('b', 'Pre-Chorus', 9, 4), sec('c', 'Chorus', 13, 8)] },
  {
    id: 'full-form', label: 'Intro → Verse → Chorus → Bridge → Chorus → Outro',
    sections: [
      sec('intro', 'Intro', 1, 4), sec('v', 'Verse', 5, 8), sec('c', 'Chorus', 13, 8),
      sec('bridge', 'Bridge', 21, 4), sec('c2', 'Chorus', 25, 8), sec('outro', 'Outro', 33, 4),
    ],
  },
  { id: 'odd-length', label: 'Odd-length sections', sections: [sec('a', 'Intro', 1, 3), sec('b', 'Verse', 4, 7), sec('c', 'Chorus', 11, 5)] },
];

/** Parse a note name or number into a tonic pitch class. */
function parseKey(input: string): number | null {
  const names: Record<string, number> = {
    C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6,
    GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11,
  };
  const byName = names[input.trim().toUpperCase()];
  if (byName !== undefined) return byName;
  const n = Number(input);
  return Number.isInteger(n) && n >= 0 && n <= 11 ? n : null;
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* --------------------------------------------------------------------------
 * Project factory — same project for all three configurations (spec §3)
 * ------------------------------------------------------------------------ */

function makeProject(context: { key: number; mode: ModeName }, structure: StructureDef): Project {
  const base = projectFromFixture({ name: 'Phase43C', tracks: [] });
  return {
    ...base,
    key: context.key,
    mode: context.mode,
    sections: structure.sections,
    chords: [],
    // The project's PERSISTED settings — configuration C uses these as-is
    // ("current project setting"), A/B override only complexity + borrowing.
    chordGenSettings: { ...DEFAULT_CHORDGEN_SETTINGS },
  };
}

/* --------------------------------------------------------------------------
 * CLI options
 * ------------------------------------------------------------------------ */

const usage = () => {
  console.log(`Usage: npm run harmony:audit -- [options]

  --key <name|0-11>       Tonic pitch class (default E)
  --mode <ModeName>       Mode (default Aeolian; must be one of the 12 modes)
  --all                   Run the full 9-context corpus
  --seeds <n>             Deterministic seeds 1..n (default 30)
  --structures <list>     Comma-separated structure ids (default all six)
  --configs <list>        Comma-separated config ids from A,B,C (default A,B,C)
  --out <dir>             Output directory (default diagnostics/harmony/audit/latest)
  --tag <name>            ALSO copy audit-results.json + audit-summary.md to
                          diagnostics/harmony/audit/<name>/ for committing
  --midi                  Write audition MIDI (seeds 1..3 per cell, §9)
  --listen                Write listening-evaluation template (§10)
  --quiet                 Only write files, no per-cell stdout lines`);
};

const keyArg = argValue('--key') ?? 'E';
const modeArg = argValue('--mode') ?? 'Aeolian';
const runAll = hasFlag('--all');
const seedsCount = Number(argValue('--seeds') ?? '30');
const structuresArg = argValue('--structures');
const configsArg = argValue('--configs');
const outArg = argValue('--out') ?? path.join('diagnostics', 'harmony', 'audit', 'latest');
const tag = argValue('--tag');
const wantMidi = hasFlag('--midi');
const wantListen = hasFlag('--listen');
const quiet = hasFlag('--quiet');

if (!Number.isInteger(seedsCount) || seedsCount < 1 || seedsCount > 200) {
  console.error('Invalid --seeds — expected an integer 1..200.');
  process.exit(1);
}
const SEEDS = Array.from({ length: seedsCount }, (_, i) => i + 1);

let contexts = CONTEXTS;
if (!runAll) {
  const key = parseKey(keyArg);
  if (key === null) { console.error(`Invalid --key "${keyArg}"`); usage(); process.exit(1); }
  if (!MODE_NAMES.includes(modeArg as ModeName)) {
    console.error(`Invalid --mode "${modeArg}" — expected one of: ${MODE_NAMES.join(', ')}`);
    process.exit(1);
  }
  contexts = [{ name: `${keyArg} ${modeArg}`, key, mode: modeArg as ModeName }];
}

if (structuresArg !== null) {
  const ids = structuresArg.split(',').map((s) => s.trim());
  const unknown = ids.filter((id) => !STRUCTURES.some((st) => st.id === id));
  if (unknown.length > 0) {
    console.error(`Unknown structure id(s): ${unknown.join(', ')} — available: ${STRUCTURES.map((s) => s.id).join(', ')}`);
    process.exit(1);
  }
}
const structures = structuresArg === null
  ? STRUCTURES
  : STRUCTURES.filter((st) => structuresArg.split(',').map((s) => s.trim()).includes(st.id));

const configIds: AuditConfigId[] = configsArg === null
  ? ['A', 'B', 'C']
  : (configsArg.split(',').map((s) => s.trim().toUpperCase()).filter((id): id is AuditConfigId =>
      id === 'A' || id === 'B' || id === 'C'));
if (configIds.length === 0) { console.error('No valid --configs given.'); process.exit(1); }
const configs = configIds.map((id) => AUDIT_CONFIGURATIONS[id]);

/* --------------------------------------------------------------------------
 * Run the corpus
 * ------------------------------------------------------------------------ */

interface CellResult {
  context: { name: string; key: number; mode: ModeName };
  structure: { id: string; label: string; bars: number };
  configs: Record<string, { aggregate: AuditAggregate; runs: AuditRunRecord[] }>;
}

const cells: CellResult[] = [];
const matchedTexts: string[] = [];
const midiFiles: Array<{ fileName: string; data: Uint8Array }> = [];

const t0 = Date.now();
for (const context of contexts) {
  for (const structure of structures) {
    const project = makeProject(context, structure);
    const cell: CellResult = {
      context,
      structure: { id: structure.id, label: structure.label, bars: structure.sections.reduce((s, x) => s + x.lengthBars, 0) },
      configs: {},
    };
    for (const config of configs) {
      const runs: AuditRunRecord[] = [];
      const detFlags: boolean[] = [];
      for (const seed of SEEDS) {
        const record = runAuditConfig(project, seed, config);
        // Determinism spot-check: identical inputs must reproduce identical
        // output (checked for seeds 1..3 of every cell).
        if (seed <= 3) {
          const again = runAuditConfig(project, seed, config);
          detFlags.push(
            JSON.stringify(again.progression) === JSON.stringify(record.progression)
            && JSON.stringify(again.metrics) === JSON.stringify(record.metrics),
          );
        }
        runs.push(record);
      }
      const deterministicAll = detFlags.every(Boolean) && detFlags.length > 0;
      cell.configs[config.id] = { aggregate: aggregateRuns(runs, deterministicAll), runs };
      // MIDI audition export (§9): seeds 1..3 per cell × config, rendered
      // from the ALREADY-generated events — no re-generation.
      if (wantMidi) {
        for (const seed of SEEDS.slice(0, 3)) {
          const record = runs.find((r) => r.seed === seed);
          if (!record) continue;
          midiFiles.push({
            fileName: `${slug(context.name)}-${structure.id}-seed${seed}-${config.id}.mid`,
            data: buildAuditionMidi(project, record.progression.map((e, i) => ({
              index: i, symbol: e.symbol, startTick: e.startTick, durationTicks: e.durationTicks,
              foundationId: e.foundation, foundationLabel: e.foundation, rootPc: e.rootPc,
              rootName: null, quality: e.quality, diatonic: e.diatonic, borrowed: e.borrowed,
              borrowedProvenance: [], nonDiatonicCoreNames: [],
              sectionId: e.sectionId, phraseId: e.phraseId, provenance: 'generated' as const,
              slotCount: e.slotCount, colorTier: null, structuralSuspension: false,
              colorSuspension: false,
            }))),
          });
        }
      }
    }
    // Matched side-by-side text for EVERY seed of this cell (spec §8).
    if (configIds.length > 1) {
      for (const seed of SEEDS) {
        const byId = {} as Record<AuditConfigId, AuditRunRecord>;
        for (const id of configIds) {
          const rec = cell.configs[id].runs.find((r) => r.seed === seed);
          if (rec) byId[id] = rec;
        }
        matchedTexts.push(formatMatchedComparison(
          { seed, configs: byId }, project, context.name, structure.label,
        ));
      }
    }
    cells.push(cell);
    if (!quiet) {
      for (const id of configIds) {
        console.log(formatCellSummary(context.name, structure.label, id, cell.configs[id].aggregate));
      }
      console.log(`  [${Math.round((Date.now() - t0) / 1000)}s elapsed]`);
    }
  }
}

/* --------------------------------------------------------------------------
 * Listening evaluation template (spec §10)
 * ------------------------------------------------------------------------ */

const listenSections: string[] = [];
{
  for (const context of contexts) {
    for (const structure of structures) {
      // Keep the audition set manageable: the priority context gets seeds
      // 1..3, every other cell seed 1.
      const priority = context.key === 4 && context.mode === 'Aeolian';
      const seedsToListen = priority ? [1, 2, 3] : [1];
      for (const seed of seedsToListen) {
        const key = `${context.name} — ${structure.label} — seed ${seed}`;
        const rows: string[] = [];
        for (const config of configs) {
          const runs = cells
            .find((c) => c.context.name === context.name && c.structure.id === structure.id)
            ?.configs[config.id].runs ?? [];
          const rec = runs.find((r) => r.seed === seed);
          rows.push(`- **Config ${config.id}**: \`${rec ? rec.progression.map((e) => e.symbol).join(' → ') : '(missing)'}\``);
        }
        listenSections.push([`### ${key}`, '', ...rows, ''].join('\n'));
      }
    }
  }
}

function listeningTemplate(): string {
  const lines: string[] = [];
  lines.push('# Crescode — Phase 4.3C Listening Evaluation');
  lines.push('');
  lines.push('Rate each progression on a 1–5 scale (1 = clearly poor, 5 = clearly strong).');
  lines.push('These are HUMAN listening ratings — no generator-derived score belongs here.');
  lines.push('');
  lines.push('Consistent listening conditions: use the exported audition MIDI files (same tempo,');
  lines.push('same block-chord voicing, same velocity, same phrase boundaries) or any player at');
  lines.push('the same volume. Rate configs A/B/C of the same cell+seed back to back.');
  lines.push('');
  lines.push('| Dimension | Question |');
  lines.push('|---|---|');
  lines.push('| Tonal identity | Does the progression establish the intended tonal center? |');
  lines.push('| Harmonic movement | Do chord changes feel natural and purposeful? |');
  lines.push('| Phrase coherence | Does the progression feel like a connected musical idea? |');
  lines.push('| Cadential quality | Do phrase endings feel appropriate? |');
  lines.push('| Chromatic coherence | Do chromatic chords feel intentional rather than arbitrary? |');
  lines.push('| Overall usefulness | Would a composer keep or develop this progression? |');
  lines.push('');
  lines.push('## Rating table');
  lines.push('');
  lines.push('| Cell | Config | Tonal | Movement | Phrase | Cadence | Chromatic | Overall | Notes |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const context of contexts) {
    for (const structure of structures) {
      const priority = context.key === 4 && context.mode === 'Aeolian';
      const seedsToListen = priority ? [1, 2, 3] : [1];
      for (const seed of seedsToListen) {
        for (const config of configIds) {
          lines.push(`| ${context.name} · ${structure.label} · s${seed} | ${config} |  |  |  |  |  |  |  |`);
        }
      }
    }
  }
  lines.push('');
  lines.push('## Progressions under evaluation');
  lines.push('');
  lines.push(...listenSections);
  return lines.join('\n') + '\n';
}

/* --------------------------------------------------------------------------
 * Output
 * ------------------------------------------------------------------------ */

const outDir = path.isAbsolute(outArg) ? outArg : path.resolve(repoRoot, outArg);
mkdirSync(outDir, { recursive: true });

const json = {
  meta: {
    engine: 'crescode-harmony-audit',
    phase: '4.3C',
    generator: 'production generateChordProgression (unmodified; settings overrides only)',
    configs: Object.fromEntries(configIds.map((id) => [id, {
      name: AUDIT_CONFIGURATIONS[id].name,
      summary: AUDIT_CONFIGURATIONS[id].summary,
      overrides: AUDIT_CONFIGURATIONS[id].overrides,
    }])),
    seeds: SEEDS,
    metricsNote: 'All metrics are DESCRIPTIVE (spec §7) — diagnostic measurements, never quality scores.',
  },
  cells,
};
const jsonPath = path.join(outDir, 'audit-results.json');
writeFileSync(jsonPath, JSON.stringify(json, null, 2));

const summaryLines: string[] = [];
summaryLines.push('# Phase 4.3C — Audit summary');
summaryLines.push('');
summaryLines.push('Descriptive aggregates across seeds per cell and configuration.');
summaryLines.push('Higher/lower is NOT automatically better anywhere in this report.');
summaryLines.push('');
summaryLines.push('| Context | Structure | Config | Runs | Fail | Det | Events | Changes | Chg/bar | MeanDur(t) | Roots | Foundations | TonicEv | TonicDur | Chromatic | Sus s/c | ColorOnly | Repeats |');
summaryLines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const cell of cells) {
  for (const id of configIds) {
    const a = cell.configs[id].aggregate;
    const m = a.metrics;
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
    summaryLines.push([
      cell.context.name, cell.structure.label, id,
      String(a.runs), String(a.failures), a.deterministicAll ? 'yes' : 'NO',
      m.totalEvents.mean.toFixed(1), m.structuralChanges.mean.toFixed(1), m.changesPerBar.mean.toFixed(2),
      m.meanEventDurationTicks.mean.toFixed(0), m.structuralRootDiversity.mean.toFixed(1),
      m.foundationDiversity.mean.toFixed(1), pct(m.tonicRootEventFraction.mean), pct(m.tonicRootDurationFraction.mean),
      `${m.chromaticFoundations.mean.toFixed(1)} (${pct(m.chromaticDurationFraction.mean)})`,
      `${m.structuralSuspensions.mean.toFixed(1)}/${m.colorSuspensions.mean.toFixed(1)}`,
      m.colorOnlyAdjacentChanges.mean.toFixed(1), m.exactAdjacentRepetitions.mean.toFixed(1),
    ].join(' | '));
  }
}
const summaryPath = path.join(outDir, 'audit-summary.md');
writeFileSync(summaryPath, summaryLines.join('\n') + '\n');

if (matchedTexts.length > 0) {
  writeFileSync(path.join(outDir, 'matched-comparisons.txt'),
    matchedTexts.join('\n' + '-'.repeat(78) + '\n\n'));
}

if (wantMidi) {
  const midiDir = path.join(outDir, 'midi');
  mkdirSync(midiDir, { recursive: true });
  for (const f of midiFiles) writeFileSync(path.join(midiDir, f.fileName), f.data);
}

if (wantListen) {
  writeFileSync(path.join(outDir, 'listening-template.md'), listeningTemplate());
}

if (tag !== null) {
  // The tagged copy is the COMMITTABLE, representative result set (spec §13:
  // "Do not commit enormous generated datasets unnecessarily"). It carries
  // full aggregates for every cell plus per-run records (with progression
  // listings) for a representative seed subset — the complete corpus stays
  // in the --out directory.
  const tagDir = path.resolve(repoRoot, 'diagnostics', 'harmony', 'audit', tag);
  mkdirSync(tagDir, { recursive: true });
  const SAMPLE_SEEDS = [1, 34];
  const sampleRuns = (runs: AuditRunRecord[]) => runs.filter((r) => SAMPLE_SEEDS.includes(r.seed));
  const tagged = {
    ...json,
    meta: {
      ...json.meta,
      seedsRun: SEEDS.length,
      note: `Representative tag "${tag}": aggregates over ${SEEDS.length} seeds per cell/config; per-run records (with progressions) for seeds ${SAMPLE_SEEDS.join(', ')} only. Reproduce the complete corpus with: npm run harmony:audit -- ${runAll ? '--all' : `--key ${keyArg} --mode ${modeArg}`} --seeds ${seedsCount} --out <dir>`,
    },
    cells: cells.map((c) => ({
      ...c,
      configs: Object.fromEntries(configIds.map((id) => [id, {
        aggregate: c.configs[id].aggregate,
        runs: sampleRuns(c.configs[id].runs),
      }])),
    })),
  };
  writeFileSync(path.join(tagDir, 'audit-results.json'), JSON.stringify(tagged));
  writeFileSync(path.join(tagDir, 'audit-summary.md'), summaryLines.join('\n') + '\n');
  // Representative matched comparisons: seed 34 for every context on the
  // Verse → Chorus structure, plus seeds 1 & 2 of the E Aeolian cells.
  const seed34 = matchedTexts.filter((t) => t.includes('SEED 34') && t.includes('Verse → Chorus'));
  const eAeolianSample = matchedTexts.filter((t) =>
    t.startsWith('PROJECT: E Aeolian') && (t.includes('SEED 1\n') || t.includes('SEED 2\n')));
  const merged = [...seed34, ...eAeolianSample];
  if (merged.length > 0) {
    writeFileSync(path.join(tagDir, 'matched-samples.txt'),
      merged.join('\n' + '-'.repeat(78) + '\n\n'));
  }
  if (wantListen) writeFileSync(path.join(tagDir, 'listening-template.md'), listeningTemplate());
  console.log(`Tagged copy: ${tagDir}`);
}

console.log(`\nWrote ${jsonPath}`);
console.log(`Wrote ${summaryPath}`);
if (matchedTexts.length > 0) console.log(`Wrote ${path.join(outDir, 'matched-comparisons.txt')} (${matchedTexts.length} comparisons)`);
if (wantMidi) console.log(`Wrote ${midiFiles.length} audition MIDI files to ${path.join(outDir, 'midi')}`);
if (wantListen) console.log(`Wrote ${path.join(outDir, 'listening-template.md')}`);
console.log(`Done in ${Math.round((Date.now() - t0) / 1000)}s`);
