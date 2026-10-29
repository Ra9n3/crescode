/**
 * Phase 4.3C — Harmonic Quality Isolation & Controlled Musical Audit.
 *
 * A controlled A/B/C experiment harness over the ACTUAL production generator
 * (spec §5: "Use the Existing Production Generator"). There is no separate
 * experimental chord generator here: every progression is produced by
 * `generateChordProgression` with the audit configuration applied through the
 * generator's own public `settings` override option — the same mechanism the
 * UI uses. The production generator is not modified in any way, and for
 * identical inputs it produces exactly the chord events it would produce
 * without this module (Test 1 in tests/harmony-audit.test.ts).
 *
 * Configurations (spec §3):
 *   A — Structural baseline : complexity 1 (basic triads), borrowing 'none'
 *   B — Diatonic color      : complexity 2 (triads + sevenths), borrowing 'none'
 *   C — Full vocabulary     : the project's own persisted complexity + borrowing
 *
 * What this module does:
 *   1. Resolves each configuration's effective settings (read-only merge).
 *   2. Runs the production generator once per configuration with diagnostics.
 *   3. Extracts per-event STRUCTURAL FOUNDATIONS independently of chord color
 *      (spec §6) — extensions never alter foundation identification, because
 *      extraction goes through the same Phase 4.1 `foundationInfoFromSymbol`
 *      the generator itself is built on.
 *   4. Computes DESCRIPTIVE metrics (spec §7 A–J) — diagnostic measurements,
 *      never quality scores; sustained harmony is never counted as multiple
 *      changes merely because it spans several rhythm slots.
 *   5. Formats matched A/B/C comparisons (text) and machine-readable JSON.
 *
 * No UI, no async, no new dependencies, no mutation of the input project.
 */
import { DEFAULT_CHORDGEN_SETTINGS, type Chord, type ChordGenSettings, type Project } from '../../shared/schema/types';
import { MODES, NOTE_NAMES, scalePitchClasses } from '../../shared/schema/modes';
import { barTicks, barToTick } from '../../shared/schema/meter';
import { foundationInfoFromSymbol, foundationLabel } from './foundation';
import { generateChordProgression } from './generation';
import type { HarmonyDiagnosticReport } from './diagnostics';
import type { ChordGenerationReport } from './generation-types';

/** Parallel modes of the same tonic whose scale contains every given core
 *  pitch class, excluding the context mode (borrowing provenance). Mirrors
 *  the diagnostics module's derivation without importing it. */
function borrowedModesContaining(tonic: number, mode: string, corePcs: number[]): string[] {
  const out: string[] = [];
  const core = new Set(corePcs);
  for (const m of Object.keys(MODES) as Array<keyof typeof MODES>) {
    if (m === mode) continue;
    const scale = new Set(scalePitchClasses(tonic, m));
    if ([...core].every((p) => scale.has(p))) out.push(m);
  }
  return out;
}

/* ==========================================================================
 * Configurations (spec §3)
 * ======================================================================== */

export type AuditConfigId = 'A' | 'B' | 'C';

export interface AuditConfiguration {
  id: AuditConfigId;
  name: string;
  summary: string;
  /** Settings overrides applied over the project's persisted chordGenSettings.
   *  `null` = configuration C: the project's own settings, untouched. */
  overrides: Partial<ChordGenSettings> | null;
}

export const AUDIT_CONFIGURATIONS: Record<AuditConfigId, AuditConfiguration> = {
  A: {
    id: 'A',
    name: 'Structural baseline',
    summary: 'basic triads, no borrowing',
    overrides: { complexity: 1, borrowing: 'none' },
  },
  B: {
    id: 'B',
    name: 'Diatonic color',
    summary: 'triads + sevenths, no borrowing',
    overrides: { complexity: 2, borrowing: 'none' },
  },
  C: {
    id: 'C',
    name: 'Full vocabulary',
    summary: 'project complexity + project borrowing',
    overrides: null,
  },
};

/** Effective settings for a configuration — the same merge the generator
 *  performs internally, computed here only for RECORDING. The audit never
 *  mutates `project.chordGenSettings`; overrides live in the options object. */
export function resolveAuditSettings(project: Project, config: AuditConfiguration): ChordGenSettings {
  return {
    ...DEFAULT_CHORDGEN_SETTINGS,
    ...(project.chordGenSettings ?? {}),
    ...(config.overrides ?? {}),
  };
}

/** The ONLY fields a configuration may change relative to the project's own
 *  settings (spec §3 — configuration isolation). */
export const AUDIT_ISOLATED_FIELDS: Array<keyof ChordGenSettings> = ['complexity', 'borrowing'];

/** True when two effective settings differ ONLY in the isolated fields. */
export function settingsIsolatedApart(a: ChordGenSettings, b: ChordGenSettings): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ChordGenSettings>;
  for (const k of keys) {
    if (AUDIT_ISOLATED_FIELDS.includes(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

/* ==========================================================================
 * Event extraction (spec §6) — foundations independent of chord color
 * ======================================================================== */

/** One sounding chord event with its structural foundation. */
export interface AuditEvent {
  index: number;
  /** Final chord symbol (with color). */
  symbol: string;
  startTick: number;
  durationTicks: number;
  /** Structural foundation — null only for unparsable symbols (defensive;
   *  the generator emits parser-validated symbols). */
  foundationId: string | null;
  foundationLabel: string | null;
  rootPc: number | null;
  rootName: string | null;
  quality: string | null;
  /** Foundation-level diatonic status (every core tone in the mode scale). */
  diatonic: boolean | null;
  /** Borrowed status = a non-diatonic FOUNDATION. */
  borrowed: boolean;
  /** Parallel modes of the same tonic containing the foundation's core,
   *  excluding the context mode (borrowing provenance). */
  borrowedProvenance: string[];
  /** Core tones outside the context mode (pitch-class names). */
  nonDiatonicCoreNames: string[];
  sectionId: string | null;
  /** Planned phrase window covering the event start (null in synthetic gaps). */
  phraseId: string | null;
  provenance: 'generated' | 'preserved';
  /** Rhythm slots this event sustains (1 = single slot; >1 = a sustained
   *  hold the continuation stage merged). Null when unavailable. */
  slotCount: number | null;
  colorTier: 'triad' | 'seventh' | 'extension' | 'basic' | 'unparsed' | null;
  /** Structural suspension: the FOUNDATION itself is sus2/sus4. */
  structuralSuspension: boolean;
  /** Color-stage suspension: the color replaced the structural third of a
   *  non-suspension foundation. */
  colorSuspension: boolean;
}

interface PhraseSpan { id: string; startTick: number; durationTicks: number }

function sectionAt(project: Project, tick: number): string | null {
  const bt = barTicks(project.timeSignature);
  for (const s of project.sections) {
    const start = barToTick(s.startBar, project.timeSignature);
    if (tick >= start && tick < start + s.lengthBars * bt) return s.id;
  }
  return null;
}

function phraseAt(spans: PhraseSpan[], tick: number): string | null {
  for (const p of spans) {
    if (tick >= p.startTick && tick < p.startTick + p.durationTicks) return p.id;
  }
  return null;
}

const eventKey = (c: Pick<Chord, 'startTick' | 'durationTicks' | 'symbol'>): string =>
  `${c.startTick}|${c.durationTicks}|${c.symbol}`;

/**
 * Extract audit events from a generation result. Foundations are derived
 * from the FINAL chord symbols through the generator's own foundation
 * reducer, so extensions (7, 9, 11, 13, sus colors) cannot alter the
 * structural identification (spec §6: `Em7 → Em`).
 */
export function extractAuditEvents(
  chords: Chord[],
  project: Project,
  diag: HarmonyDiagnosticReport | undefined,
): AuditEvent[] {
  const phrases: PhraseSpan[] = (diag?.planning.phrases ?? []).map((p) => ({
    id: p.id, startTick: p.startTick, durationTicks: p.durationTicks,
  }));
  // Color records describe every GENERATED event (start/duration/symbol are
  // unique per event), carrying slot-span and color-operation facts.
  const colorByKey = new Map<string, HarmonyDiagnosticReport['color'][number]>();
  for (const c of diag?.color ?? []) colorByKey.set(eventKey(c), c);

  const out: AuditEvent[] = [];
  const generatedSeen = new Set<string>();
  for (const c of diag?.color ?? []) generatedSeen.add(eventKey(c));

  for (const chord of chords) {
    const f = foundationInfoFromSymbol(chord.symbol, project.key, project.mode);
    const color = colorByKey.get(eventKey(chord)) ?? null;
    const generated = generatedSeen.has(eventKey(chord));
    const structuralSuspension = f !== null && f.quality === 'suspended';
    out.push({
      index: out.length,
      symbol: chord.symbol,
      startTick: chord.startTick,
      durationTicks: chord.durationTicks,
      foundationId: f?.id ?? null,
      foundationLabel: f !== null ? foundationLabel(f) : null,
      rootPc: f?.rootPc ?? null,
      rootName: f !== null ? NOTE_NAMES[f.rootPc] : null,
      quality: f?.quality ?? null,
      diatonic: f?.diatonic ?? null,
      borrowed: f !== null && !f.diatonic,
      borrowedProvenance: f !== null && !f.diatonic
        ? borrowedModesContaining(project.key, project.mode, f.corePitchClasses)
        : [],
      nonDiatonicCoreNames: f !== null
        ? f.corePitchClasses
          .filter((p) => !new Set(scalePitchClasses(project.key, project.mode)).has(p))
          .map((p) => NOTE_NAMES[p])
        : [],
      sectionId: sectionAt(project, chord.startTick),
      phraseId: phraseAt(phrases, chord.startTick),
      provenance: generated ? 'generated' : 'preserved',
      slotCount: color?.slotCount ?? null,
      colorTier: color?.operation.tier ?? null,
      structuralSuspension,
      colorSuspension: color?.operation.thirdReplaced === true && !structuralSuspension,
    });
  }
  return out;
}

/* ==========================================================================
 * Descriptive progression metrics (spec §7 A–J)
 * ======================================================================== */

export interface PhraseArrivalRecord {
  phraseId: string | null;
  sectionId: string | null;
  /** Planned cadence intention (Phase 3). */
  intention: string;
  /** Actual harmony at the arrival. */
  finalFoundation: string | null;
  finalSymbol: string | null;
  tonicRooted: boolean | null;
  realizedFamily: string | null;
}

export interface ProgressionMetrics {
  /** §7 A — distinct structural roots. */
  structuralRootDiversity: number;
  /** §7 B — distinct foundations (root + core). */
  foundationDiversity: number;
  /** §7 C — structural changes (foundation changes between consecutive
   *  events; sustained slots are NOT changes). */
  structuralChanges: number;
  /** §7 C — changes relative to song duration (bars covered). */
  changesPerBar: number | null;
  /** §7 D — mean event duration (ticks). */
  meanEventDurationTicks: number | null;
  /** §7 D — median event duration (ticks). */
  medianEventDurationTicks: number | null;
  /** §7 E — tonic-root harmony presence (event count / duration). Higher is
   *  NOT automatically better — descriptive only. */
  tonicRootEventFraction: number | null;
  tonicRootDurationFraction: number | null;
  /** §7 F — chromatic content (foundations only; color-stage chromaticism
   *  is recorded separately via colorSuspension / tier facts). */
  chromaticFoundations: number;
  chromaticDurationFraction: number | null;
  /** Non-diatonic pitch classes sounding in chromatic foundations. */
  nonDiatonicPitchClasses: string[];
  /** Borrowed-mode relationships (parallel-mode provenance). */
  borrowedRelationships: string[];
  /** §7 G — suspended harmony: structural vs color-stage. */
  structuralSuspensions: number;
  structuralSuspensionTicks: number;
  colorSuspensions: number;
  /** §7 H — adjacent events sharing one foundation. */
  colorOnlyAdjacentChanges: number;
  exactAdjacentRepetitions: number;
  /** §7 I — phrase arrivals. */
  phraseArrivals: PhraseArrivalRecord[];
  /** §7 J — structural repetition. */
  consecutiveRepetitions: number;
  recurringFoundationMotifs: string[];
  recurringRootPatterns: string[];
  /** §7 J — foundation-set overlap between related sections (from the
   *  generation report; empty when no repeated sections are planned). */
  sectionIdentityOverlap: Array<{ a: string; b: string; overlap: number }>;
  /** Context facts. */
  totalEvents: number;
  totalBars: number | null;
  meanDistinctRootsPerPhrase: number | null;
}

/** n-grams (n = 3) over a sequence, returned as `x → y → z ×count` strings
 *  for every pattern occurring more than once, most frequent first. */
function recurringMotifs(labels: string[], n = 3): string[] {
  if (labels.length < n) return [];
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= labels.length; i++) {
    const key = labels.slice(i, i + n).join('→');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, c]) => `${k.replace(/→/g, ' → ')} ×${c}`);
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Compute the §7 metric set for one progression. Purely descriptive: no
 * quality score is derived, no weighting, no thresholds.
 */
export function computeProgressionMetrics(
  events: AuditEvent[],
  project: Project,
  diag: HarmonyDiagnosticReport | undefined,
  report?: ChordGenerationReport,
): ProgressionMetrics {
  const parsed = events.filter((e) => e.foundationId !== null);
  const tonic = diag?.planning.pool.tonic ?? project.key;
  const bt = barTicks(project.timeSignature);

  // §7 C/D — structural movement over consecutive events.
  let structuralChanges = 0;
  let exactRepetitions = 0;
  let colorOnlyChanges = 0;
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1];
    const b = events[i];
    if (a.foundationId === null || b.foundationId === null) continue;
    if (a.foundationId === b.foundationId) {
      if (a.symbol === b.symbol) exactRepetitions += 1;
      else colorOnlyChanges += 1;
    } else {
      structuralChanges += 1;
    }
  }
  const first = events[0];
  const last = events[events.length - 1];
  const coveredTicks = events.length > 0 ? (last.startTick + last.durationTicks) - first.startTick : 0;
  const coveredBars = coveredTicks / bt;

  // §7 E — tonal center presence.
  const tonicRootEvents = parsed.filter((e) => e.rootPc === tonic);
  const totalTicks = parsed.reduce((s, e) => s + e.durationTicks, 0);
  const tonicTicks = tonicRootEvents.reduce((s, e) => s + e.durationTicks, 0);

  // §7 F — chromatic content.
  const chromatic = parsed.filter((e) => e.diatonic === false);
  const chromaticTicks = chromatic.reduce((s, e) => s + e.durationTicks, 0);
  const nonDiatonicPcs = new Set<string>();
  const provenance = new Set<string>();
  for (const e of chromatic) {
    for (const n of e.nonDiatonicCoreNames) nonDiatonicPcs.add(n);
    for (const m of e.borrowedProvenance) provenance.add(m);
  }

  // §7 G — suspensions.
  const structuralSus = parsed.filter((e) => e.structuralSuspension);
  const structuralSusTicks = structuralSus.reduce((s, e) => s + e.durationTicks, 0);
  const colorSus = events.filter((e) => e.colorSuspension);

  // §7 I — phrase arrivals (from the generator's own arrival records).
  const eventAtTick = new Map<number, AuditEvent>();
  for (const e of events) eventAtTick.set(e.startTick, e);
  const phraseArrivals: PhraseArrivalRecord[] = (diag?.structure.cadences ?? []).map((c) => {
    const ev = eventAtTick.get(c.startTick) ?? null;
    return {
      phraseId: c.phraseId,
      sectionId: c.sectionId,
      intention: c.intention,
      finalFoundation: ev?.foundationLabel ?? c.arrivalFoundation,
      finalSymbol: ev?.symbol ?? null,
      tonicRooted: ev !== null && ev.rootPc !== null ? ev.rootPc === tonic : null,
      realizedFamily: c.family,
    };
  });

  // §7 J — repetition.
  const motifLabels = parsed.map((e) => e.foundationId!);
  const rootLabels = parsed.map((e) => `${e.rootName ?? '?'}`);

  return {
    structuralRootDiversity: new Set(parsed.map((e) => e.rootPc)).size,
    foundationDiversity: new Set(parsed.map((e) => e.foundationId)).size,
    structuralChanges,
    changesPerBar: coveredBars > 0 ? structuralChanges / coveredBars : null,
    meanEventDurationTicks: events.length > 0
      ? Math.round(events.reduce((s, e) => s + e.durationTicks, 0) / events.length)
      : null,
    medianEventDurationTicks: median(events.map((e) => e.durationTicks)),
    tonicRootEventFraction: parsed.length > 0 ? tonicRootEvents.length / parsed.length : null,
    tonicRootDurationFraction: totalTicks > 0 ? tonicTicks / totalTicks : null,
    chromaticFoundations: chromatic.length,
    chromaticDurationFraction: totalTicks > 0 ? chromaticTicks / totalTicks : null,
    nonDiatonicPitchClasses: [...nonDiatonicPcs].sort(),
    borrowedRelationships: [...provenance].sort(),
    structuralSuspensions: structuralSus.length,
    structuralSuspensionTicks: structuralSusTicks,
    colorSuspensions: colorSus.length,
    colorOnlyAdjacentChanges: colorOnlyChanges,
    exactAdjacentRepetitions: exactRepetitions,
    phraseArrivals,
    consecutiveRepetitions: exactRepetitions + colorOnlyChanges,
    recurringFoundationMotifs: recurringMotifs(motifLabels),
    recurringRootPatterns: recurringMotifs(rootLabels),
    sectionIdentityOverlap: report ? [...report.sectionFoundationOverlap] : [],
    totalEvents: events.length,
    totalBars: coveredBars > 0 ? Math.round(coveredBars * 100) / 100 : null,
    meanDistinctRootsPerPhrase: report && report.distinctRootsPerPhrase.length > 0
      ? Math.round((report.distinctRootsPerPhrase.reduce((s, v) => s + v, 0) / report.distinctRootsPerPhrase.length) * 100) / 100
      : null,
  };
}

/* ==========================================================================
 * Matched A/B/C runs (spec §3, §5)
 * ======================================================================== */

export interface AuditRunRecord {
  configId: AuditConfigId;
  configName: string;
  configSummary: string;
  effectiveSettings: ChordGenSettings;
  seed: number;
  warnings: string[];
  chordCount: number;
  generatedChordCount: number;
  preservedChordCount: number;
  /** §6 progression records — full listing. */
  progression: Array<{
    symbol: string;
    foundation: string | null;
    rootPc: number | null;
    quality: string | null;
    startTick: number;
    durationTicks: number;
    sectionId: string | null;
    phraseId: string | null;
    diatonic: boolean | null;
    borrowed: boolean;
    /** Core tones outside the context mode (§7F; empty for diatonic). */
    nonDiatonicCoreNames: string[];
    /** Parallel-mode provenance for borrowed foundations (§7F). */
    borrowedProvenance: string[];
    slotCount: number | null;
  }>;
  metrics: ProgressionMetrics;
  /** Selected generation-report facts for cross-checking (§12 Test 5). */
  generationFacts: {
    continuationSlots: number;
    sustainedEvents: number;
    sameFoundationRepetitions: number;
    colorOnlyChanges: number;
    tonicReinforcementEvents: number;
    cadenceFamiliesUsed: string[];
    meanDurationTicks: number;
    distinctRootsPerPhrase: number[];
  };
}

export interface MatchedAuditRun {
  seed: number;
  configs: Record<AuditConfigId, AuditRunRecord>;
}

/** Run ONE seed under ONE configuration through the production generator. */
export function runAuditConfig(
  project: Project,
  seed: number,
  config: AuditConfiguration,
): AuditRunRecord {
  const result = generateChordProgression(project, {
    seed,
    scope: { type: 'all' },
    settings: config.overrides ?? undefined,
    diagnostics: true,
  });
  const events = extractAuditEvents(result.chords, project, result.diagnostics);
  const metrics = computeProgressionMetrics(events, project, result.diagnostics, result.report);
  return {
    configId: config.id,
    configName: config.name,
    configSummary: config.summary,
    effectiveSettings: resolveAuditSettings(project, config),
    seed,
    warnings: [...result.report.warnings],
    chordCount: result.chords.length,
    generatedChordCount: result.report.generatedChordCount,
    preservedChordCount: result.report.preservedChordCount,
    progression: events.map((e) => ({
      symbol: e.symbol,
      foundation: e.foundationLabel,
      rootPc: e.rootPc,
      quality: e.quality,
      startTick: e.startTick,
      durationTicks: e.durationTicks,
      sectionId: e.sectionId,
      phraseId: e.phraseId,
      diatonic: e.diatonic,
      borrowed: e.borrowed,
      nonDiatonicCoreNames: e.nonDiatonicCoreNames,
      borrowedProvenance: e.borrowedProvenance,
      slotCount: e.slotCount,
    })),
    metrics,
    generationFacts: {
      continuationSlots: result.report.continuationSlots,
      sustainedEvents: result.report.sustainedEvents,
      sameFoundationRepetitions: result.report.sameFoundationRepetitions,
      colorOnlyChanges: result.report.colorOnlyChanges,
      tonicReinforcementEvents: result.report.tonicReinforcementEvents,
      cadenceFamiliesUsed: [...result.report.cadenceFamiliesUsed],
      meanDurationTicks: result.report.rhythmSummary.meanDurationTicks,
      distinctRootsPerPhrase: [...result.report.distinctRootsPerPhrase],
    },
  };
}

/** Run ONE seed under ALL configurations — matched conditions (spec §3). */
export function runAuditMatched(project: Project, seed: number, configs: AuditConfiguration[]): MatchedAuditRun {
  const byId = {} as Record<AuditConfigId, AuditRunRecord>;
  for (const config of configs) byId[config.id] = runAuditConfig(project, seed, config);
  return { seed, configs: byId };
}

/* ==========================================================================
 * Aggregation across seeds
 * ======================================================================== */

/** Numeric metric fields aggregated across runs. */
const NUMERIC_METRICS = [
  'structuralRootDiversity', 'foundationDiversity', 'structuralChanges', 'changesPerBar',
  'meanEventDurationTicks', 'medianEventDurationTicks',
  'tonicRootEventFraction', 'tonicRootDurationFraction',
  'chromaticFoundations', 'chromaticDurationFraction',
  'structuralSuspensions', 'structuralSuspensionTicks', 'colorSuspensions',
  'colorOnlyAdjacentChanges', 'exactAdjacentRepetitions', 'consecutiveRepetitions',
  'totalEvents', 'totalBars',
] as const;

export type NumericMetricKey = (typeof NUMERIC_METRICS)[number];

export interface MetricAggregate { mean: number; min: number; max: number; median: number }

export interface AuditAggregate {
  runs: number;
  failures: number;
  deterministicAll: boolean;
  tonicRootedArrivalFraction: number | null;
  realizedArrivalFraction: number | null;
  meanDistinctRootsPerPhrase: number | null;
  metrics: { [K in NumericMetricKey]: MetricAggregate };
}

const round4 = (v: number): number => Math.round(v * 10000) / 10000;

export function aggregateRuns(runs: AuditRunRecord[], deterministicAll: boolean): AuditAggregate {
  const metrics = {} as { [K in NumericMetricKey]: MetricAggregate };
  for (const key of NUMERIC_METRICS) {
    const values = runs.map((r) => r.metrics[key]).filter((v): v is number => v !== null);
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    metrics[key] = {
      mean: values.length ? round4(values.reduce((s, v) => s + v, 0) / values.length) : 0,
      min: values.length ? round4(sorted[0]) : 0,
      max: values.length ? round4(sorted[sorted.length - 1]) : 0,
      median: values.length ? round4(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : 0,
    };
  }
  const arrivals = runs.flatMap((r) => r.metrics.phraseArrivals);
  const withSymbol = arrivals.filter((a) => a.finalSymbol !== null);
  const rootsMean = runs.map((r) => r.generationFacts.distinctRootsPerPhrase);
  const flatRoots = rootsMean.filter((a) => a.length > 0);
  return {
    runs: runs.length,
    failures: runs.filter((r) => r.chordCount === 0 || r.warnings.length > 0).length,
    deterministicAll,
    tonicRootedArrivalFraction: arrivals.length > 0
      ? round4(arrivals.filter((a) => a.tonicRooted === true).length / arrivals.length)
      : null,
    realizedArrivalFraction: arrivals.length > 0
      ? round4(withSymbol.filter((a) => a.realizedFamily !== null).length / arrivals.length)
      : null,
    meanDistinctRootsPerPhrase: flatRoots.length > 0
      ? round4(flatRoots.reduce((s, a) => s + a.reduce((t, v) => t + v, 0) / a.length, 0) / flatRoots.length)
      : null,
    metrics,
  };
}

/* ==========================================================================
 * Formatting — matched A/B/C comparisons (spec §8)
 * ======================================================================== */

const ticksLabel = (ticks: number, bt: number): string => {
  const bars = ticks / bt;
  if (Math.abs(bars - Math.round(bars)) < 0.01 && Math.round(bars) > 1) return `${Math.round(bars)}b`;
  if (bars >= 1) return `${(Math.round(bars * 10) / 10).toString().replace(/\.0$/, '')}b`;
  return `${Math.round(bars * 4)}/4b`;
};

function formatProgressionLines(
  run: AuditRunRecord,
  project: Project,
): { chords: string; foundations: string } {
  const bt = barTicks(project.timeSignature);
  const sectionOrder = project.sections.map((s) => s.id);
  const groups = new Map<string, string[]>();
  const fGroups = new Map<string, string[]>();
  const fallback = '(region)';
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const arr = map.get(key) ?? [];
    arr.push(value);
    map.set(key, arr);
  };
  for (const ev of run.progression) {
    const key = ev.sectionId ?? fallback;
    push(groups, key, ev.slotCount !== null && ev.slotCount > 1
      ? `${ev.symbol}${ticksLabel(ev.durationTicks, bt)}`
      : ev.symbol);
    push(fGroups, key, ev.foundation ?? '?');
  }
  const chordParts: string[] = [];
  const foundationParts: string[] = [];
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = sectionOrder.indexOf(a); const ib = sectionOrder.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  for (const key of keys) {
    const name = project.sections.find((s) => s.id === key)?.name ?? key;
    chordParts.push(`${name}: ${groups.get(key)!.join(' | ')}`);
    foundationParts.push(`${name}: ${fGroups.get(key)!.join(' → ')}`);
  }
  if (groups.size === 0) {
    chordParts.push('(no events)');
    foundationParts.push('(no events)');
  }
  return { chords: chordParts.join('\n'), foundations: foundationParts.join('\n') };
}

function metricsOneLine(m: ProgressionMetrics): string {
  const pct = (v: number | null): string => v === null ? '—' : `${Math.round(v * 100)}%`;
  return [
    `events ${m.totalEvents}`,
    `foundations ${m.foundationDiversity}`,
    `roots ${m.structuralRootDiversity}`,
    `changes ${m.structuralChanges}`,
    m.changesPerBar !== null ? `${(Math.round(m.changesPerBar * 100) / 100).toFixed(2)}/bar` : '—/bar',
    `meanDur ${m.meanEventDurationTicks ?? '—'}t`,
    `tonicRoot ${pct(m.tonicRootEventFraction)}/${pct(m.tonicRootDurationFraction)}`,
    `chromatic ${m.chromaticFoundations} (${pct(m.chromaticDurationFraction)})`,
    `sus ${m.structuralSuspensions}s/${m.colorSuspensions}c`,
    `colorOnly ${m.colorOnlyAdjacentChanges}`,
    `repeats ${m.exactAdjacentRepetitions}`,
  ].join(' · ');
}

/** Human-readable matched comparison for one project/seed (spec §8). */
export function formatMatchedComparison(
  matched: MatchedAuditRun,
  project: Project,
  contextLabel: string,
  structureLabel: string,
): string {
  const lines: string[] = [];
  lines.push(`PROJECT: ${contextLabel} — ${structureLabel} · SEED ${matched.seed}`);
  lines.push('');
  for (const id of ['A', 'B', 'C'] as AuditConfigId[]) {
    const run = matched.configs[id];
    if (!run) continue;
    lines.push(`CONFIG ${id} — ${run.configName.toUpperCase()} (${run.configSummary})`);
    const { chords, foundations } = formatProgressionLines(run, project);
    for (const line of chords.split('\n')) lines.push(`  ${line}`);
    lines.push('  foundations:');
    for (const line of foundations.split('\n')) lines.push(`    ${line}`);
    lines.push(`  metrics: ${metricsOneLine(run.metrics)}`);
    if (run.metrics.phraseArrivals.length > 0) {
      const arrivals = run.metrics.phraseArrivals
        .map((a) => `${a.intention}→${a.finalSymbol ?? '?'}${a.realizedFamily ? ` [${a.realizedFamily}]` : ''}`)
        .join(' · ');
      lines.push(`  arrivals: ${arrivals}`);
    }
    if (run.warnings.length > 0) lines.push(`  warnings: ${run.warnings.join(' · ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Aggregate summary table for one cell (context × structure × config). */
export function formatCellSummary(
  contextLabel: string,
  structureLabel: string,
  configId: AuditConfigId,
  aggregate: AuditAggregate,
): string {
  const m = aggregate.metrics;
  const pct = (v: number): string => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
  return [
    `${contextLabel} · ${structureLabel} · CONFIG ${configId}:`,
    `  runs ${aggregate.runs} · failures ${aggregate.failures} · deterministic ${aggregate.deterministicAll ? 'yes' : 'NO'}`,
    `  events ${m.totalEvents.mean} · changes ${m.structuralChanges.mean} (${m.changesPerBar.mean}/bar) · meanDur ${m.meanEventDurationTicks.mean}t`,
    `  roots ${m.structuralRootDiversity.mean} · foundations ${m.foundationDiversity.mean} · roots/phrase ${aggregate.meanDistinctRootsPerPhrase ?? '—'}`,
    `  tonicRoot events ${pct(m.tonicRootEventFraction.mean)} · duration ${pct(m.tonicRootDurationFraction.mean)}`,
    `  chromatic ${m.chromaticFoundations.mean} (${pct(m.chromaticDurationFraction.mean)}) · sus s/c ${m.structuralSuspensions.mean}/${m.colorSuspensions.mean}`,
    `  colorOnly ${m.colorOnlyAdjacentChanges.mean} · repeats ${m.exactAdjacentRepetitions.mean} · sustains ${aggregate.tonicRootedArrivalFraction ?? '—'} tonic arrivals · ${aggregate.realizedArrivalFraction ?? '—'} realized`,
  ].join('\n');
}
