/**
 * Piano variation baseline matrix (Performance Styles, Stage 1).
 *
 * Runs the ordinary production `composeAllTracks` path over a representative
 * matrix, fingerprints every Piano draft and compares generations pairwise.
 *
 *   npx vite-node scripts/piano-variation-matrix.ts -- <label>
 *
 * Output: evaluation/piano-variation-stage1-20261112/<label>/
 *   runs.json          one row per generation: digests, diversity figures, adaptation retention
 *   fingerprints.json  the full fingerprints (independent and adapted) per generation
 *   pairs.json         every comparison: kind, distances per dimension, classification
 *   summary.md         distributions, classifications and recommended thresholds
 *
 * These are structural measurements. They never say how a generation sounds.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { compareNoteProfiles, type IdentitySurvival, type NoteProfileComparison, type PianoNoteProfile } from '../src/orchestrator/keys/piano-note-analysis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  classifySimilarity, compareFingerprints, fingerprintDigest, fingerprintPiano, transposeFingerprintInput,
  STAGE1_THRESHOLDS, type FingerprintComparison, type FingerprintDimension, type PianoFingerprint,
} from '../src/orchestrator/keys/piano-fingerprint';
import { PIANO_FIXTURES, PIANO_TEMPLATES, cellId, runPianoCell, type PianoCell } from '../tests/piano-variation-support';

const here = path.dirname(fileURLToPath(import.meta.url));
// Production default is the identity composer; PIANO_COMPOSITION=classic measures the regression mode.
const MODE = process.env.PIANO_COMPOSITION === 'classic' ? 'classic' as const : 'identity' as const;
const label = process.argv.slice(2).find((arg) => /^[a-z0-9-]+$/i.test(arg)) ?? 'run';
const outRoot = path.join(here, '..', 'evaluation', 'piano-variation-stage1-20261112', label);

/** "take" generations are what repeated Compose All presses produce in the app; "seed" generations change the seed option. */
const GENERATIONS = [
  { seed: 1, take: 0 }, { seed: 1, take: 1 }, { seed: 1, take: 2 }, { seed: 11, take: 0 }, { seed: 29, take: 0 },
] as const;
const TRANSPOSITIONS = [0, 5] as const;
const DENSITIES = [0.3, 0.6, 1] as const;
const DIMENSIONS: readonly FingerprintDimension[] = ['theme', 'rhythm', 'accompaniment', 'development'];

interface Run { id: string; cell: PianoCell; independent: PianoFingerprint; adapted: PianoFingerprint; row: Record<string, unknown>; notes: PianoNoteProfile; draftNotes: PianoNoteProfile }
const runs: Run[] = [];
const failures: string[] = [];
const controls: { id: string; exactTransposition: boolean; classification: string; overall: number }[] = [];
let repeatsChecked = 0;
let repeatsIdentical = 0;

const started = Date.now();
for (const fixture of PIANO_FIXTURES) for (const template of PIANO_TEMPLATES) for (const standalone of [false, true])
  for (const transpose of TRANSPOSITIONS) for (const density of DENSITIES) for (const generation of GENERATIONS) {
    const cell: PianoCell = { template, fixture, standalone, transpose, density, ...generation, mode: MODE };
    const id = cellId(cell);
    try {
      const run = runPianoCell(cell);
      if (!run.fingerprints || !run.inputs || !run.piano) { failures.push(`${id}: no Piano composition`); continue; }
      const { independent, adapted, retention } = run.fingerprints;
      const diagnostics = run.result.pianoDiagnostics!;
      runs.push({
        id, cell, independent, adapted, notes: run.noteProfiles!.adapted, draftNotes: run.noteProfiles!.independent,
        row: {
          id, ...cell,
          notes: run.piano.notes.length,
          playabilityViolations: run.result.pianoPlayability.violations.length,
          independentDigest: fingerprintDigest(independent),
          adaptedDigest: fingerprintDigest(adapted),
          themeRhythm: diagnostics.theme?.rhythm.join('-') ?? null,
          themeContour: diagnostics.theme?.contour ?? null,
          recurrence: adapted.theme.recurrence,
          relationShare: adapted.theme.relationShare,
          subdivision: adapted.rhythm.subdivision,
          offbeatShare: adapted.rhythm.offbeatShare,
          syncopation: adapted.rhythm.syncopation,
          silentBeatShare: adapted.rhythm.silentBeatShare,
          anticipations: adapted.rhythm.anticipations,
          distinctRhythmCells: adapted.rhythm.distinctCells,
          distinctLeftFigures: adapted.accompaniment.distinctLeft,
          distinctRightFigures: adapted.accompaniment.distinctRight,
          exchangeBars: adapted.accompaniment.exchangeBars.length,
          roles: adapted.development.roles,
          texture: adapted.development.texture.join(''),
          independentTexture: independent.development.texture.join(''),
          dynamics: adapted.development.dynamics,
          climaxAt: adapted.development.climaxAt,
          peakAt: adapted.development.peakAt,
          retention,
          archetype: diagnostics.identity?.archetype ?? null,
          identity: diagnostics.identity?.description ?? null,
          protectedTraits: diagnostics.identity?.protectedTraits ?? null,
          survival: run.survival,
          melodyLabelAgreement: run.noteProfiles!.melodyLabelAgreement,
          noteDerived: { subdivision: run.noteProfiles!.adapted.subdivision, offbeatShare: run.noteProfiles!.adapted.offbeatShare, syncopation: run.noteProfiles!.adapted.syncopation, distinctBarRhythms: run.noteProfiles!.adapted.distinctBarRhythms, distinctLowRhythms: run.noteProfiles!.adapted.distinctLowRhythms },
          adaptationFlags: diagnostics.flags,
        },
      });
      // Control: the same notes moved by a fourth must be recognised as a transposition.
      const moved = fingerprintPiano(transposeFingerprintInput(run.inputs.adapted, 5));
      const control = compareFingerprints(adapted, moved);
      controls.push({ id, exactTransposition: control.exactTransposition, classification: classifySimilarity(control).classification, overall: control.overall });
      // Reproducibility: every eighth cell is composed a second time from scratch.
      if (runs.length % 8 === 0) {
        const again = runPianoCell(cell);
        repeatsChecked++;
        if (JSON.stringify(again.piano?.notes) === JSON.stringify(run.piano.notes)
          && JSON.stringify(again.piano?.cc) === JSON.stringify(run.piano.cc)
          && fingerprintDigest(again.fingerprints!.adapted) === fingerprintDigest(adapted)
          && fingerprintDigest(again.fingerprints!.independent) === fingerprintDigest(independent)) repeatsIdentical++;
      }
    } catch (error) {
      failures.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

/* ---------------- pairs ---------------- */
type Kind = 'take' | 'seed' | 'key' | 'density' | 'template' | 'arrangement';
interface Pair {
  kind: Kind; a: string; b: string; template: string; fixture: string; standalone: boolean; density: number;
  adapted: FingerprintComparison; independent: FingerprintComparison; classification: string; independentClassification: string;
  differentDimensions: readonly string[];
  /** Stage 2: the same pair measured from the written notes alone (final score; independent draft). */
  notes: NoteProfileComparison; draftNotes: NoteProfileComparison;
}
const pairs: Pair[] = [];
const sameExcept = (a: PianoCell, b: PianoCell, keys: readonly (keyof PianoCell)[]): boolean =>
  (Object.keys(a) as (keyof PianoCell)[]).every((key) => keys.includes(key) || a[key] === b[key]);
for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
  const a = runs[i].cell;
  const b = runs[j].cell;
  if (a.fixture !== b.fixture) continue;
  let kind: Kind | null = null;
  if (sameExcept(a, b, ['take']) && a.take !== b.take) kind = 'take';
  else if (sameExcept(a, b, ['seed']) && a.seed !== b.seed) kind = 'seed';
  else if (sameExcept(a, b, ['transpose'])) kind = 'key';
  else if (sameExcept(a, b, ['density']) && a.seed === 1 && a.take === 0) kind = 'density';
  else if (sameExcept(a, b, ['template']) && a.seed === 1 && a.take === 0) kind = 'template';
  else if (sameExcept(a, b, ['standalone'])) kind = 'arrangement';
  if (!kind) continue;
  const adapted = compareFingerprints(runs[i].adapted, runs[j].adapted);
  const independent = compareFingerprints(runs[i].independent, runs[j].independent);
  const verdict = classifySimilarity(adapted);
  pairs.push({
    kind, a: runs[i].id, b: runs[j].id, template: kind === 'template' ? `${a.template}|${b.template}` : a.template,
    fixture: a.fixture, standalone: a.standalone && b.standalone, density: a.density,
    adapted, independent, classification: verdict.classification, independentClassification: classifySimilarity(independent).classification,
    differentDimensions: verdict.differentDimensions,
    notes: compareNoteProfiles(runs[i].notes, runs[j].notes), draftNotes: compareNoteProfiles(runs[i].draftNotes, runs[j].draftNotes),
  });
}

/* ---------------- summary ---------------- */
const quantile = (values: readonly number[], q: number): number => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
};
const fmt = (value: number): string => (Number.isFinite(value) ? value.toFixed(2) : '–');
const spread = (values: readonly number[]): string => `${fmt(quantile(values, 0))} / ${fmt(quantile(values, 0.1))} / ${fmt(quantile(values, 0.5))} / ${fmt(quantile(values, 0.9))} / ${fmt(quantile(values, 1))}`;
const mean = (values: readonly number[]): number => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN);
const KINDS: readonly Kind[] = ['take', 'seed', 'key', 'density', 'arrangement', 'template'];
const KIND_NOTE: Record<Kind, string> = {
  take: 'same inputs, Compose All pressed again (take changes)',
  seed: 'same inputs, different seed option',
  key: 'same inputs, whole song moved up a fourth',
  density: 'same generation at another density',
  arrangement: 'same generation, Piano-only versus full arrangement',
  template: 'same song and seed, different template',
};
const lines: string[] = [];
lines.push('# Piano variation baseline — Stage 1', '');
lines.push(`Matrix label \`${label}\`. ${runs.length} generations, ${pairs.length} comparisons, ${failures.length} failures. Composer: Texture-and-Theme (current baseline).`, '');
lines.push('Distances run from 0 (identical) to 1 (nothing in common). They are structural measurements, not judgements of how anything sounds.', '');
lines.push('## Reproducibility and transposition control', '');
lines.push(`- Repeated generations with identical inputs: ${repeatsIdentical} of ${repeatsChecked} identical (notes, CC64 and both fingerprints).`);
lines.push(`- Synthetic transposition control (same notes moved a fourth): ${controls.filter((c) => c.exactTransposition).length} of ${controls.length} recognised as an exact transposition; largest overall distance ${fmt(Math.max(...controls.map((c) => c.overall)))}; classes ${JSON.stringify(count(controls.map((c) => c.classification)))}.`, '');
function count(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}
lines.push('## Distance by kind of comparison (final adapted Piano)', '');
lines.push('Each cell: min / 10th percentile / median / 90th percentile / max.', '');
lines.push('| Comparison | Pairs | Theme | Rhythm | Accompaniment | Development | Overall |', '|---|---|---|---|---|---|---|');
for (const kind of KINDS) {
  const set = pairs.filter((pair) => pair.kind === kind);
  lines.push(`| ${kind} (${KIND_NOTE[kind]}) | ${set.length} | ${DIMENSIONS.map((d) => spread(set.map((pair) => pair.adapted.dimensions[d]))).join(' | ')} | ${spread(set.map((pair) => pair.adapted.overall))} |`);
}
lines.push('', '## Same table for the independent draft (before orchestral adaptation)', '');
lines.push('| Comparison | Theme | Rhythm | Accompaniment | Development | Overall |', '|---|---|---|---|---|---|');
for (const kind of KINDS) {
  const set = pairs.filter((pair) => pair.kind === kind);
  lines.push(`| ${kind} | ${DIMENSIONS.map((d) => spread(set.map((pair) => pair.independent.dimensions[d]))).join(' | ')} | ${spread(set.map((pair) => pair.independent.overall))} |`);
}
lines.push('', '## Median component distance by kind (final adapted Piano)', '');
const componentKeys = Object.keys(pairs[0]?.adapted.components ?? {});
lines.push(`| Component | ${KINDS.join(' | ')} |`, `|---|${KINDS.map(() => '---').join('|')}|`);
for (const key of componentKeys) {
  lines.push(`| ${key} | ${KINDS.map((kind) => fmt(quantile(pairs.filter((pair) => pair.kind === kind).map((pair) => pair.adapted.components[key]), 0.5))).join(' | ')} |`);
}
lines.push('', '## Classification with the Stage 1 thresholds', '');
lines.push(`Thresholds: same when overall ≤ ${STAGE1_THRESHOLDS.sameOverall}; a dimension is "meaningfully different" at theme ≥ ${STAGE1_THRESHOLDS.different.theme}, rhythm ≥ ${STAGE1_THRESHOLDS.different.rhythm}, accompaniment ≥ ${STAGE1_THRESHOLDS.different.accompaniment}, development ≥ ${STAGE1_THRESHOLDS.different.development}; "different" needs ${STAGE1_THRESHOLDS.dimensionsRequired} such dimensions including theme or rhythm.`, '');
lines.push('| Comparison | same | transposed | variation | different | Dimensions most often different |', '|---|---|---|---|---|---|');
for (const kind of KINDS) {
  const set = pairs.filter((pair) => pair.kind === kind);
  const classes = count(set.map((pair) => pair.classification));
  const dims = count(set.flatMap((pair) => [...pair.differentDimensions]));
  lines.push(`| ${kind} | ${classes.same ?? 0} | ${classes.transposed ?? 0} | ${classes.variation ?? 0} | ${classes.different ?? 0} | ${DIMENSIONS.map((d) => `${d} ${Math.round(100 * (dims[d] ?? 0) / Math.max(1, set.length))}%`).join(', ')} |`);
}
lines.push('', '## Regenerations (take and seed pairs) by template', '');
lines.push('| Template | Arrangement | Pairs | different | variation | same | Median theme | Median rhythm | Median accompaniment | Median development | Identical onset rhythm |', '|---|---|---|---|---|---|---|---|---|---|---|');
for (const template of PIANO_TEMPLATES) for (const standalone of [false, true]) {
  const set = pairs.filter((pair) => (pair.kind === 'take' || pair.kind === 'seed') && pair.template === template && pair.standalone === standalone);
  const classes = count(set.map((pair) => pair.classification));
  lines.push(`| ${template} | ${standalone ? 'Piano only' : 'full'} | ${set.length} | ${classes.different ?? 0} | ${classes.variation ?? 0} | ${classes.same ?? 0} | ${DIMENSIONS.map((d) => fmt(quantile(set.map((pair) => pair.adapted.dimensions[d]), 0.5))).join(' | ')} | ${Math.round(100 * set.filter((pair) => pair.adapted.components.onsets === 0).length / Math.max(1, set.length))}% |`);
}
lines.push('', '## Regenerations by form and density', '');
lines.push('| Form | Density | Pairs | different | variation | Median overall |', '|---|---|---|---|---|---|');
for (const fixture of PIANO_FIXTURES) for (const density of DENSITIES) {
  const set = pairs.filter((pair) => (pair.kind === 'take' || pair.kind === 'seed') && pair.fixture === fixture && pair.density === density);
  const classes = count(set.map((pair) => pair.classification));
  lines.push(`| ${fixture} | ${density} | ${set.length} | ${classes.different ?? 0} | ${classes.variation ?? 0} | ${fmt(quantile(set.map((pair) => pair.adapted.overall), 0.5))} |`);
}
lines.push('', '## Diversity inside one generation (means over all generations of a template, full arrangement)', '');
lines.push('| Template | Theme recurrence | Beat / eighth / sixteenth / triplet / other | Off-beat share | Syncopation | Anticipations | Distinct bar rhythms | Distinct LH figures | Distinct RH figures | Hand-exchange bars |', '|---|---|---|---|---|---|---|---|---|---|');
for (const template of PIANO_TEMPLATES) {
  const set = runs.filter((run) => run.cell.template === template && !run.cell.standalone).map((run) => run.adapted);
  const sub = (key: keyof PianoFingerprint['rhythm']['subdivision']) => fmt(mean(set.map((f) => f.rhythm.subdivision[key])));
  lines.push(`| ${template} | ${fmt(mean(set.map((f) => f.theme.recurrence)))} | ${sub('beat')} / ${sub('eighth')} / ${sub('sixteenth')} / ${sub('triplet')} / ${sub('other')} | ${fmt(mean(set.map((f) => f.rhythm.offbeatShare)))} | ${fmt(mean(set.map((f) => f.rhythm.syncopation)))} | ${fmt(mean(set.map((f) => f.rhythm.anticipations)))} | ${fmt(mean(set.map((f) => f.rhythm.distinctCells)))} | ${fmt(mean(set.map((f) => f.accompaniment.distinctLeft)))} | ${fmt(mean(set.map((f) => f.accompaniment.distinctRight)))} | ${fmt(mean(set.map((f) => f.accompaniment.exchangeBars.length)))} |`);
}
lines.push('', '## Distinct identities across the matrix', '');
const themeIds = (set: readonly Run[]) => new Set(set.map((run) => JSON.stringify([run.adapted.theme.contour, run.adapted.theme.rhythm]))).size;
lines.push('| Template | Generations | Distinct planned themes | Distinct theme rhythms | Distinct role orders (16 bars / 40 bars) | Distinct texture curves (independent) |', '|---|---|---|---|---|---|');
for (const template of PIANO_TEMPLATES) {
  const set = runs.filter((run) => run.cell.template === template);
  const byFixture = (fixture: string) => new Set(set.filter((run) => run.cell.fixture === fixture).map((run) => run.adapted.development.roles.join(','))).size;
  lines.push(`| ${template} | ${set.length} | ${themeIds(set)} | ${new Set(set.map((run) => run.adapted.theme.rhythm.join('|'))).size} | ${byFixture('dorian-16bars')} / ${byFixture('three-chorus-40bars')} | ${new Set(set.map((run) => `${run.cell.fixture}:${run.cell.density}:${run.independent.development.texture.join('')}`)).size} of ${set.length} |`);
}
lines.push('', '## Adaptation: what survives from the independent draft (full arrangement)', '');
lines.push('| Template | Events kept | Theme notes kept | Melody rhythm kept | LH figure unchanged | RH figure unchanged | Bars with texture changed | Added events | Lowest events kept |', '|---|---|---|---|---|---|---|---|---|');
const retentionOf = (run: Run) => run.row.retention as Record<string, number>;
for (const template of PIANO_TEMPLATES) {
  const set = runs.filter((run) => run.cell.template === template && !run.cell.standalone).map(retentionOf);
  const col = (key: string) => fmt(mean(set.map((r) => r[key])));
  lines.push(`| ${template} | ${col('events')} | ${col('themeNotes')} | ${col('rhythmicMotif')} | ${col('leftPattern')} | ${col('rightPattern')} | ${col('textureChanged')} | ${col('added')} | ${fmt(Math.min(...set.map((r) => r.events)))} |`);
}
const solo = runs.filter((run) => run.cell.standalone).map(retentionOf);
lines.push(`| (all, Piano only) | ${fmt(mean(solo.map((r) => r.events)))} | ${fmt(mean(solo.map((r) => r.themeNotes)))} | ${fmt(mean(solo.map((r) => r.rhythmicMotif)))} | ${fmt(mean(solo.map((r) => r.leftPattern)))} | ${fmt(mean(solo.map((r) => r.rightPattern)))} | ${fmt(mean(solo.map((r) => r.textureChanged)))} | ${fmt(mean(solo.map((r) => r.added)))} | ${fmt(Math.min(...solo.map((r) => r.events)))} |`);
lines.push('', '## Does adaptation make different generations converge?', '');
lines.push('Regeneration pairs in the full arrangement: distance between the two independent drafts versus distance between the two adapted results.', '');
lines.push('| Template | Pairs | Median overall, independent | Median overall, adapted | Pairs closer after adaptation | Largest loss of distance |', '|---|---|---|---|---|---|');
for (const template of PIANO_TEMPLATES) {
  const set = pairs.filter((pair) => (pair.kind === 'take' || pair.kind === 'seed') && pair.template === template && !pair.standalone);
  const delta = set.map((pair) => pair.adapted.overall - pair.independent.overall);
  lines.push(`| ${template} | ${set.length} | ${fmt(quantile(set.map((pair) => pair.independent.overall), 0.5))} | ${fmt(quantile(set.map((pair) => pair.adapted.overall), 0.5))} | ${Math.round(100 * delta.filter((value) => value < -0.005).length / Math.max(1, set.length))}% | ${fmt(Math.min(...delta))} |`);
}
const converged = pairs.filter((pair) => (pair.kind === 'take' || pair.kind === 'seed') && !pair.standalone
  && pair.independentClassification === 'different' && pair.classification !== 'different');
lines.push('', `Regeneration pairs whose independent drafts classify as different but whose adapted results do not: ${converged.length}.`);
for (const pair of converged.slice(0, 12)) lines.push(`- ${pair.a} vs ${pair.b}: independent ${fmt(pair.independent.overall)}, adapted ${fmt(pair.adapted.overall)}`);
lines.push('', '## Anchors for thresholds', '');
const anchor = (kind: Kind, d: FingerprintDimension | 'overall', q: number) => fmt(quantile(pairs.filter((pair) => pair.kind === kind).map((pair) => (d === 'overall' ? pair.adapted.overall : pair.adapted.dimensions[d])), q));
lines.push('- Lower anchor (must read as the same piece): repeated generations and the synthetic transposition control, distance 0.');
lines.push('- Middle anchor (a variation by construction): the same generation at another density. 90th percentile — ' + [...DIMENSIONS, 'overall' as const].map((d) => `${d} ${anchor('density', d, 0.9)}`).join(', ') + '.');
lines.push('- Upper anchor (different by design): another template on the same song and seed. 10th percentile — ' + [...DIMENSIONS, 'overall' as const].map((d) => `${d} ${anchor('template', d, 0.1)}`).join(', ') + '; median — ' + [...DIMENSIONS, 'overall' as const].map((d) => `${d} ${anchor('template', d, 0.5)}`).join(', ') + '.');
if (failures.length) lines.push('', '## Failures', '', ...failures.map((failure) => `- ${failure}`));

/* ---------------- Stage 2: note-derived distances and identity survival ---------------- */
lines.push('', `## Composer mode`, '', `This run used the **${MODE}** Piano composer.`);
lines.push('', '## Note-derived distance by kind of comparison (final score)', '',
  'Measured from pitch, start, length and velocity only - no composer labels. Each cell: median (10th - 90th percentile).', '',
  '| Comparison | Pairs | Top line | Bar rhythm | Left-hand rhythm | Bass motion | Shape | Overall | Overall, independent draft |', '|---|---|---|---|---|---|---|---|---|');
const band = (values: readonly number[]): string => `${fmt(quantile(values, 0.5))} (${fmt(quantile(values, 0.1))} - ${fmt(quantile(values, 0.9))})`;
for (const kind of KINDS) {
  const set = pairs.filter((pair) => pair.kind === kind);
  lines.push(`| ${kind} | ${set.length} | ${(['melody', 'rhythm', 'lowRhythm', 'bass', 'shape', 'overall'] as const).map((key) => band(set.map((pair) => pair.notes[key]))).join(' | ')} | ${band(set.map((pair) => pair.draftNotes.overall))} |`);
}
lines.push('', '## Note-derived regeneration distance (take and seed pairs) by template', '',
  '| Template | Arrangement | Top line | Bar rhythm | Left-hand rhythm | Bass motion | Shape | Overall | Identical bar rhythm throughout |', '|---|---|---|---|---|---|---|---|---|');
for (const template of PIANO_TEMPLATES) for (const standalone of [false, true]) {
  const set = pairs.filter((pair) => (pair.kind === 'take' || pair.kind === 'seed') && pair.template === template && pair.standalone === standalone);
  lines.push(`| ${template} | ${standalone ? 'Piano only' : 'full'} | ${(['melody', 'rhythm', 'lowRhythm', 'bass', 'shape', 'overall'] as const).map((key) => fmt(quantile(set.map((pair) => pair.notes[key]), 0.5))).join(' | ')} | ${Math.round(100 * set.filter((pair) => pair.notes.rhythm === 0).length / Math.max(1, set.length))}% |`);
}
const survivalOf = (run: Run) => run.row.survival as IdentitySurvival;
const SURVIVAL_KEYS = ['themeExact', 'themeTransformed', 'themeLost', 'headExact', 'headTransformed', 'headLost', 'rhythmExact', 'rhythmPartial', 'bassMotion', 'events'] as const;
lines.push('', '## What adaptation keeps of the identity', '',
  'Mean share per generation. "Exact": every attack and the direction of every step kept. "Transformed": the rhythm kept with other steps, or a fragment of the bar kept. "Lost": no trace. Rhythm cell: bars that sounded the whole cell before adaptation. Bass: bars whose first bass note is unchanged.', '',
  '| Template | Arrangement | Theme exact | Theme transformed | Theme lost | Head exact | Head transformed | Head lost | Rhythm cell exact | Rhythm cell partial | Bass motion | All events | Generations with no theme bar surviving | Generations with no head surviving |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const template of PIANO_TEMPLATES) for (const standalone of [false, true]) {
  const set = runs.filter((run) => run.cell.template === template && run.cell.standalone === standalone).map(survivalOf);
  lines.push(`| ${template} | ${standalone ? 'Piano only' : 'full'} | ${SURVIVAL_KEYS.map((key) => fmt(mean(set.map((item) => item[key])))).join(' | ')} | ${set.filter((item) => item.themeBars > 0 && item.themeLost === 1).length} of ${set.length} | ${set.filter((item) => item.headBars > 0 && item.headLost === 1).length} of ${set.length} |`);
}
if (MODE === 'identity') {
  lines.push('', '## Identity survival by archetype (full arrangement)', '',
    '| Archetype | Generations | Theme exact | Theme transformed | Theme lost | Head exact | Head transformed | Head lost | Rhythm cell exact | Rhythm cell partial | Bass motion | All events |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
  const archetypes = [...new Set(runs.map((run) => String(run.row.archetype)))].sort();
  for (const archetype of archetypes) {
    const set = runs.filter((run) => run.row.archetype === archetype && !run.cell.standalone).map(survivalOf);
    lines.push(`| ${archetype} | ${set.length} | ${SURVIVAL_KEYS.map((key) => fmt(mean(set.map((item) => item[key])))).join(' | ')} |`);
  }
  lines.push('', '## Archetypes drawn', '', '| Template | Archetype | Generations |', '|---|---|---|');
  for (const template of PIANO_TEMPLATES) for (const archetype of archetypes) {
    const count = runs.filter((run) => run.cell.template === template && run.row.archetype === archetype).length;
    if (count) lines.push(`| ${template} | ${archetype} | ${count} |`);
  }
}
lines.push('', '## Composer labels against the notes', '',
  `Share of notes labelled "melody" that are also the audible top line: mean ${fmt(mean(runs.map((run) => run.row.melodyLabelAgreement as number)))}, lowest ${fmt(Math.min(...runs.map((run) => run.row.melodyLabelAgreement as number)))}.`);

mkdirSync(outRoot, { recursive: true });
writeFileSync(path.join(outRoot, 'runs.json'), JSON.stringify({ label, generatedBy: 'scripts/piano-variation-matrix.ts', thresholds: STAGE1_THRESHOLDS, matrix: { templates: PIANO_TEMPLATES, fixtures: PIANO_FIXTURES, generations: GENERATIONS, transpositions: TRANSPOSITIONS, densities: DENSITIES, arrangements: ['full', 'piano-only'] }, repeats: { checked: repeatsChecked, identical: repeatsIdentical }, transpositionControl: { checked: controls.length, exact: controls.filter((c) => c.exactTransposition).length }, failures, runs: runs.map((run) => run.row) }, null, 1));
writeFileSync(path.join(outRoot, 'fingerprints.json'), JSON.stringify(Object.fromEntries(runs.map((run) => [run.id, { independent: run.independent, adapted: run.adapted }]))));
writeFileSync(path.join(outRoot, 'pairs.json'), JSON.stringify(pairs.map((pair) => ({ ...pair, adapted: { d: pair.adapted.dimensions, c: pair.adapted.components, o: pair.adapted.overall }, independent: { d: pair.independent.dimensions, o: pair.independent.overall }, notes: pair.notes, draftNotes: pair.draftNotes }))));
writeFileSync(path.join(outRoot, 'summary.md'), `${lines.join('\n')}\n`);
console.log(`${runs.length} generations, ${pairs.length} pairs, ${failures.length} failures, ${Math.round((Date.now() - started) / 1000)} s -> ${path.relative(process.cwd(), outRoot)}`);
