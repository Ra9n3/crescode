/**
 * Harmony diagnostic CLI (Phase 4.2, spec §14) — reproduce generation runs
 * and inspect WHY the chord generator made its decisions.
 *
 *   npm run harmony:diagnose
 *   npm run harmony:diagnose -- --project fixtures/example-e-aeolian.json --seed 42
 *   npm run harmony:diagnose -- --project fixtures/example-e-aeolian.json --seed 42 --format json
 *   npm run harmony:diagnose -- --format both --out diagnostics/harmony/run.txt
 *
 * - Reuses the ACTUAL production generator (generateChordProgression with
 *   `diagnostics: true`) — there is no separate diagnostic generator.
 * - The input project is never mutated and never written back.
 * - No browser, no UI, no new dependencies (runs under vite-node like the
 *   existing audit harness).
 * - `--format text` prints the human-readable report; `--format json` prints
 *   the machine-readable one; `--format both` prints text and writes JSON
 *   next to `--out`. `--out <path>` writes to a file instead of stdout.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { generateChordProgression } from '../src/engine/harmony/generation';
import { formatHarmonyDiagnostics } from '../src/engine/harmony/diagnostics-format';
import { serializeHarmonyDiagnostics } from '../src/engine/harmony/diagnostics';
import type { GenerationScope } from '../src/engine/harmony/generation-types';
import { projectFromFixture, type Project } from '../src/shared/schema';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

function argValue(flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
function hasFlag(flag: string): boolean {
  return argv.includes(flag);
}

const usage = () => {
  console.log(`Usage: npm run harmony:diagnose -- [options]

  --project <file.json>   Project to load (partial project docs are filled with
                          defaults; default: fixtures/example-e-aeolian.json)
  --seed <number>         Generator seed (default 42)
  --format <text|json|both>  Output format (default text)
  --out <path>            Write output to a file instead of stdout
  --scope <all|empty|section:<id>>  Generation scope (default all)
  --settings <json>       Settings overrides, e.g. '{"complexity":3}'
`);
};

// ---- Load the project (read-only) -----------------------------------------
const projectArg = argValue('--project') ?? path.join(here, '..', 'fixtures', 'example-e-aeolian.json');
let project: Project;
try {
  const doc = JSON.parse(readFileSync(projectArg, 'utf8')) as Partial<Project>;
  project = projectFromFixture(doc);
} catch (err) {
  console.error(`Could not load project "${projectArg}": ${err instanceof Error ? err.message : String(err)}`);
  usage();
  process.exit(1);
}

// ---- Request parameters -----------------------------------------------------
const seedArg = argValue('--seed');
const seed = seedArg !== null ? Number(seedArg) : 42;
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
  console.error(`Invalid seed "${seedArg ?? ''}" — expected an integer 0..2^32-1.`);
  process.exit(1);
}

const scopeArg = argValue('--scope') ?? 'all';
let scope: GenerationScope = { type: 'all' };
if (scopeArg === 'empty') scope = { type: 'empty' };
else if (scopeArg.startsWith('section:')) scope = { type: 'section', sectionId: scopeArg.slice('section:'.length) };
else if (scopeArg !== 'all') {
  console.error(`Invalid scope "${scopeArg}" — expected all | empty | section:<id>.`);
  process.exit(1);
}

let settings: Record<string, unknown> | undefined;
const settingsArg = argValue('--settings');
if (settingsArg !== null) {
  try {
    settings = JSON.parse(settingsArg) as Record<string, unknown>;
  } catch (err) {
    console.error(`Invalid --settings JSON: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const format = argValue('--format') ?? 'text';
if (format !== 'text' && format !== 'json' && format !== 'both') {
  console.error(`Invalid format "${format}" — expected text | json | both.`);
  process.exit(1);
}
const outPath = argValue('--out');

// ---- Run the REAL production generator with diagnostics --------------------
const result = generateChordProgression(project, {
  seed,
  scope,
  settings: settings as Project['chordGenSettings'],
  diagnostics: true,
});
if (result.diagnostics === undefined) {
  console.error('Internal error: diagnostics were requested but not returned.');
  process.exit(1);
}

const text = formatHarmonyDiagnostics(result.diagnostics);
const json = serializeHarmonyDiagnostics(result.diagnostics);

// Header the report itself deliberately omits (the report is deterministic —
// wall-clock time is not part of the generation, so it lives in the CLI only).
const header = `# run: ${new Date().toISOString()} · project: ${path.basename(projectArg)} · seed: ${seed}\n`;

if (outPath !== null) {
  const abs = path.resolve(here, '..', outPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  const content = format === 'json' ? json : `${header}${text}\n`;
  writeFileSync(abs, content);
  if (format === 'both') {
    const jsonPath = abs.replace(/\.(txt|text)$/, '.json');
    writeFileSync(jsonPath, json);
    console.log(`Wrote ${abs} and ${jsonPath}`);
  } else {
    console.log(`Wrote ${abs}`);
  }
  console.log(`Chords: ${result.chords.map((c) => c.symbol).join(' → ')}`);
} else if (format === 'json') {
  console.log(json);
} else {
  console.log(text);
}
