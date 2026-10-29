/**
 * Whole-progression candidate generation & selection (Phase 5) — the
 * Generate → Evaluate → Compare → Select layer (spec §3, §14, §15, §16).
 *
 * A bounded collection of COMPLETE progression candidates is produced by the
 * EXISTING production generator — `generateChordProgression`, called once per
 * candidate with a deterministic derived seed. Every candidate is therefore a
 * full production run with all its guarantees intact: scope resolution,
 * locked-chord protection, anchor continuity, exact coverage, parser
 * compatibility, determinism. Nothing about the generator itself changes.
 *
 * Candidate 0 always uses the requested seed unchanged, so the pre-Phase-5
 * generation result remains a member of the candidate set (backwards
 * compatibility by construction, verified by tests). Candidates 1..N-1 use
 * domain-separated derived seeds
 * (`crescode:gen:candidate|i|seed`) — the same stream-separation discipline
 * every internal generator stage uses.
 *
 * Each candidate is then evaluated as a COMPLETE musical outcome by
 * evaluation.ts (`evaluateSongProgression` — whole phrases, section seams,
 * repeated-section relationships, tonal identity, cadences, chromatic
 * coherence, light color fit). Candidates are compared on those evaluations
 * and the SELECTED progression is drawn, deterministically, from the
 * musically competitive set — never mechanically the highest score (§15:
 * different seeds must keep producing meaningful variation).
 *
 * Safety invariants (spec §16):
 *   - Selection only ever PICKS a candidate. Chords outside the requested
 *     generation scope are preserved by the generator inside every candidate
 *     and are never rewritten here. A candidate may score poorly because of
 *     protected material — the protected material is identical in every
 *     candidate and remains untouched.
 *   - No score floor: a weak field still yields the best available candidate.
 *   - Deterministic: identical (project, options, seed) → identical output,
 *     selection report included.
 *   - Bounded: candidate count is capped; no retries, no unbounded search.
 *
 * Pure, synchronous, dependency-free. The input project is never mutated.
 */
import { type Chord, type Project } from '../../shared/schema/types';
import { barTicks } from '../../shared/schema/meter';
import { hashString } from '../generate';
import { generateChordProgression, planningProjectFor } from './generation';
import { planSongHarmony } from './plan';
import {
  evaluateSongProgression, type SongEvaluation,
} from './evaluation';
import { foundationInfoFromSymbol, foundationLabel } from './foundation';
import { generationRegionEnd } from './coverage';
import type {
  ChordGenerationResult, GenerateProgressionOptions,
} from './generation-types';

/** Default bounded candidate count (spec §14: "a bounded collection"). */
export const DEFAULT_CANDIDATE_COUNT = 6;
/** Hard cap — never exceeded, whatever the caller asks for. */
export const MAX_CANDIDATE_COUNT = 8;
/** Span (in bars) beyond which the default candidate count shrinks (§18:
 *  interactive budget for very long arrangements; measured: a 200-bar run
 *  costs ≈ 22 ms per candidate + ≈ 4 ms planning). */
const LONG_SPAN_BARS = 128;
const LONG_SPAN_CANDIDATE_COUNT = 4;

/** Candidates whose total score is within this margin of the best are
 *  "musically competitive" — the seeded pick chooses among them (§15). The
 *  margin is a documented heuristic for listening calibration. */
export const SELECTION_MARGIN = 0.06;

/** Options for evaluated generation — the plain generation options plus the
 *  bounded candidate count (tests/audits may lower it; never raise it past
 *  the hard cap). */
export interface EvaluatedProgressionOptions extends GenerateProgressionOptions {
  /** Bounded candidate count (default 6; long spans 4; capped at 8). */
  candidateCount?: number;
}

/** One complete progression candidate: a full production result plus its
 *  identity and evaluation. */
export interface ProgressionCandidate {
  /** Deterministic derived seed this candidate ran with (candidate 0 = the
   *  requested seed, unchanged). */
  seed: number;
  result: ChordGenerationResult;
  evaluation: SongEvaluation;
  /** Objective structural signature (foundation label sequence, collapsed) —
   *  used for diversity measurement and honest "structurally similar"
   *  reporting (§14). */
  structuralSignature: string[];
}

/** Everything the selection decided, exposed for diagnostics (§17). */
export interface SelectionReport {
  candidateCount: number;
  candidateSeeds: number[];
  /** Per-candidate evaluation + ranking records. `scores` are internal
   *  heuristics (§17 separation); `facts` are objective. */
  candidates: Array<{
    seed: number;
    /** 0-based rank by evaluation total (0 = best). */
    rank: number;
    totalScore: number;
    inCompetitiveSet: boolean;
    selected: boolean;
    /** Objective objective summary — distinct roots, events, changes/bar. */
    facts: {
      eventCount: number;
      distinctRoots: number;
      changesPerBar: number;
      structuralSignature: string[];
    };
    scores: {
      tonalIdentity: number;
      harmonicDirection: number;
      arrivalQuality: number | null;
      harmonicRhythmFit: number | null;
      repeatedSectionIdentity: number | null;
      chromaticCoherence: number;
      colorFitMean: number;
    };
  }>;
  diversity: {
    /** Mean pairwise structural distance over candidate pairs (0 = all
     *  candidates structurally identical). */
    meanPairwiseDistance: number;
    /** Count of distinct structural signatures. */
    distinctSignatures: number;
    /** Distance from each candidate to the SELECTED one (§17). */
    distanceToSelected: number[];
  };
  selection: {
    /** Candidates inside the competitive margin. */
    competitiveCount: number;
    margin: number;
    /** Index (in the original candidate order) the seeded pick drew. */
    pickedIndex: number;
    /** Note stating the selection behavior honestly (§17). */
    note: string;
  };
}

export interface EvaluatedProgressionResult extends ChordGenerationResult {
  /** The complete comparison record (candidates, rankings, selection). */
  selection: SelectionReport;
  /** The selected candidate's whole-song evaluation. */
  evaluation: SongEvaluation;
}

/** Objective structural signature of a progression: its foundation sequence
 *  with consecutive duplicates collapsed (sustains count once) — the same
 *  color-independent extraction the whole engine is built on. */
function structuralSignatureOf(chords: Chord[], key: number, mode: Project['mode']): string[] {
  const labels: string[] = [];
  for (const c of chords) {
    const f = foundationInfoFromSymbol(c.symbol, key, mode);
    if (f === null) continue;
    const label = foundationLabel(f);
    if (labels[labels.length - 1] !== label) labels.push(label);
  }
  return labels;
}

/** Bounded candidate count for a project (§18 performance discipline). */
function resolveCandidateCount(project: Project, requested: number | undefined): number {
  const spanBars = Math.max(1, generationRegionEnd(project) / barTicks(project.timeSignature));
  const base = spanBars > LONG_SPAN_BARS ? LONG_SPAN_CANDIDATE_COUNT : DEFAULT_CANDIDATE_COUNT;
  const n = requested ?? base;
  return Math.max(1, Math.min(MAX_CANDIDATE_COUNT, Math.floor(n)));
}

/** Deterministic derived seed for candidate i (candidate 0 = the seed). */
export function candidateSeed(seed: number, index: number): number {
  if (index === 0) return seed >>> 0;
  return hashString(['crescode:gen:candidate', String(index), String(seed >>> 0)].join('|')) >>> 0;
}

/**
 * Generate a bounded collection of complete progression candidates with the
 * existing production generator (spec §3, §14). Each candidate uses the same
 * project and generation scope; each is a full, deterministic production run
 * that respects locked chords and preserves manual material. The plan each
 * candidate was generated under is rebuilt (deterministically) so its
 * evaluation reads the phrase intentions that actually shaped it.
 */
export function generateProgressionCandidates(
  project: Project,
  options: EvaluatedProgressionOptions = {},
): ProgressionCandidate[] {
  const count = resolveCandidateCount(project, options.candidateCount);
  const requestedSeed = options.seed ?? project.chordGenSettings?.seed ?? 1;
  const planProject = planningProjectFor(project);
  const candidates: ProgressionCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const seed = candidateSeed(requestedSeed, i);
    const result = generateChordProgression(project, {
      seed,
      scope: options.scope,
      settings: options.settings,
      diagnostics: false,
    });
    const plan = planSongHarmony(planProject, { seed });
    const evaluation = evaluateSongProgression(project, result.chords, plan);
    candidates.push({
      seed,
      result,
      evaluation,
      structuralSignature: structuralSignatureOf(
        result.chords, project.key, project.mode,
      ),
    });
  }
  return candidates;
}

/** Structural distance between two candidates (§14 candidate diversity):
 *  a blend of foundation-sequence difference (order-sensitive alignment on
 *  the collapsed signatures), root-trajectory difference, harmonic-rhythm
 *  difference and arrival difference. Objective — reported, never used to
 *  reject anything. */
export function candidateDistance(a: ProgressionCandidate, b: ProgressionCandidate): number {
  // 1) Foundation-sequence distance: positional agreement of the collapsed
  //    signatures over the longer length (order-sensitive; a sequence and its
  //    rotation differ — §14 "recognize when they are structurally similar"
  //    applies to colors, not to genuinely different routes).
  const sa = a.structuralSignature;
  const sb = b.structuralSignature;
  const n = Math.max(sa.length, sb.length);
  const seqDistance = n === 0 ? 0
    : sa.length !== sb.length
      ? Math.abs(sa.length - sb.length) / n * 0.5
        + (function () {
          const m = Math.min(sa.length, sb.length);
          let same = 0;
          for (let i = 0; i < m; i++) if (sa[i] === sb[i]) same += 1;
          return (m - same) / n * 0.5;
        })()
      : (function () {
        let same = 0;
        for (let i = 0; i < n; i++) if (sa[i] === sb[i]) same += 1;
        return (n - same) / n;
      })();
  // 2) Root trajectory: distinct-root overlap of the collapsed signatures
  //    (Jaccard distance).
  const sigRoots = (sig: string[]) => new Set(sig.map((l) => l.split(' ')[0]));
  const ra = sigRoots(sa);
  const rb = sigRoots(sb);
  const union = new Set([...ra, ...rb]);
  const rootDistance = union.size > 0
    ? 1 - [...ra].filter((r) => rb.has(r)).length / union.size
    : 0;
  // 3) Harmonic rhythm difference (objective changes per bar).
  const cpbA = a.evaluation.facts.changesPerBar;
  const cpbB = b.evaluation.facts.changesPerBar;
  const rhythmDistance = Math.abs(cpbA - cpbB) / Math.max(cpbA, cpbB, 1);
  // Weighted blend (documented heuristic; the numbers are diagnostic).
  return Math.min(1, 0.6 * seqDistance + 0.25 * rootDistance + 0.15 * rhythmDistance);
}

/** Measure structural diversity across the candidate collection (§14, §17 —
 *  an objective measurement, never a rejection filter). */
export function measureCandidateDiversity(
  candidates: ProgressionCandidate[],
): SelectionReport['diversity'] {
  const n = candidates.length;
  const distances: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = candidateDistance(candidates[i], candidates[j]);
      distances[i][j] = d;
      distances[j][i] = d;
      sum += d;
      pairs += 1;
    }
  }
  const signatures = new Set(candidates.map((c) => c.structuralSignature.join('>|<')));
  return {
    meanPairwiseDistance: pairs > 0 ? sum / pairs : 0,
    distinctSignatures: signatures.size,
    distanceToSelected: Array(n).fill(0),
  };
}

/**
 * Select the progression to use from the evaluated candidates (spec §15).
 *
 * NOT "always the mathematically highest score": candidates whose evaluation
 * is within `SELECTION_MARGIN` of the best form the competitive set, and the
 * seeded pick draws among them — coherent alternatives keep surfacing across
 * seeds while coherence stays the primary consideration. No score floor, no
 * rejection: with one candidate (or a weak field) the best available
 * progression is returned.
 */
export function selectProgression(
  candidates: ProgressionCandidate[],
  seed: number,
): { index: number; competitiveCount: number } {
  if (candidates.length === 0) {
    throw new Error('selectProgression requires at least one candidate');
  }
  const totals = candidates.map((c) => c.evaluation.total);
  let best = 0;
  for (let i = 1; i < totals.length; i++) {
    if (totals[i] > totals[best]) best = i;
  }
  const competitive: number[] = [];
  for (let i = 0; i < totals.length; i++) {
    if (totals[best] - totals[i] <= SELECTION_MARGIN) competitive.push(i);
  }
  // Deterministic seeded pick among the competitive set.
  const pickRng = hashString(['crescode:gen:pick', String(seed >>> 0), String(candidates.length)].join('|'));
  const pickedIndex = competitive[pickRng % competitive.length];
  return { index: pickedIndex, competitiveCount: competitive.length };
}

/**
 * Generate, evaluate and select the best complete progression (Phase 5's
 * integrated entry point — the path the app's Generate action uses).
 *
 * Returns the SAME result shape the plain generator returns (full
 * replacement chord array + report) plus the selection record and the
 * selected candidate's whole-song evaluation. With `candidateCount: 1` this
 * is byte-equivalent to a plain `generateChordProgression` call with the same
 * seed (the original run is always candidate 0 and the only choice) — the
 * Phase 4 behavior is a strict subset of Phase 5.
 */
export function generateEvaluatedProgression(
  project: Project,
  options: EvaluatedProgressionOptions = {},
): EvaluatedProgressionResult {
  const requestedSeed = options.seed ?? project.chordGenSettings?.seed ?? 1;
  const candidates = generateProgressionCandidates(project, options);
  const { index, competitiveCount } = selectProgression(candidates, requestedSeed);
  const chosen = candidates[index];
  const diversity = measureCandidateDiversity(candidates);
  diversity.distanceToSelected = candidates.map((c) => candidateDistance(c, chosen));

  // Ranking (stable, by evaluation total desc; ties by candidate order).
  const order = candidates
    .map((c, i) => ({ i, total: c.evaluation.total }))
    .sort((a, b) => b.total - a.total || a.i - b.i);
  const rankOf = new Map(order.map((o, r) => [o.i, r]));

  const report: SelectionReport = {
    candidateCount: candidates.length,
    candidateSeeds: candidates.map((c) => c.seed),
    candidates: candidates.map((c, i) => ({
      seed: c.seed,
      rank: rankOf.get(i) ?? i,
      totalScore: c.evaluation.total,
      inCompetitiveSet: c.evaluation.total >= chosen.evaluation.total - SELECTION_MARGIN,
      selected: i === index,
      facts: {
        eventCount: c.evaluation.facts.eventCount,
        distinctRoots: c.evaluation.facts.distinctRoots,
        changesPerBar: c.evaluation.facts.changesPerBar,
        structuralSignature: c.structuralSignature,
      },
      scores: {
        tonalIdentity: c.evaluation.components.tonalIdentity,
        harmonicDirection: meanOf(c.evaluation.phrases.map((p) => p.scores.harmonicDirection)),
        arrivalQuality: c.evaluation.components.arrivalQuality,
        harmonicRhythmFit: c.evaluation.components.harmonicRhythmFit,
        repeatedSectionIdentity: c.evaluation.components.repeatedSectionIdentity,
        chromaticCoherence: c.evaluation.components.chromaticCoherence,
        colorFitMean: meanOf(c.evaluation.phrases.map((p) => p.scores.colorFit)),
      },
    })),
    diversity,
    selection: {
      competitiveCount,
      margin: SELECTION_MARGIN,
      pickedIndex: index,
      note: competitiveCount === 1
        ? 'selected the clear evaluation leader — no other candidate was inside the competitive margin'
        : `selected deterministically (seeded) among ${competitiveCount} musically competitive candidates within margin ${SELECTION_MARGIN}`,
    },
  };

  // The deep per-run diagnostic report (Phase 4.2) is regenerated ONLY when
  // requested — the selected candidate's seed reproduces it exactly.
  if (options.diagnostics === true) {
    const deep = generateChordProgression(project, {
      seed: chosen.seed,
      scope: options.scope,
      settings: options.settings,
      diagnostics: true,
    });
    return { ...chosen.result, diagnostics: deep.diagnostics, selection: report, evaluation: chosen.evaluation };
  }
  return { ...chosen.result, selection: report, evaluation: chosen.evaluation };
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0.5;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
