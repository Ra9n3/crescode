/**
 * Phrase-aware STRUCTURAL progression construction (Phase 4.1) — WHERE the
 * harmony goes, before anyone decides how it sounds (spec §5 Stage A, §7, §8).
 *
 * The search operates on harmonic FOUNDATIONS (foundation.ts), never on
 * colored chords: a beam path is a sequence of structural destinations, so
 * D7→D13-style color shuffling cannot occupy search positions, and extension
 * richness cannot influence root selection. Each expansion is scored by the
 * contextual foundation transition facts (stability from shared structural
 * tones, movement from root-change facts, tonal fit, tension fit — computed
 * from pitch-class mathematics on every call, no tables).
 *
 * Whole-phrase TRAJECTORY evaluation (spec §8): beyond per-transition fit,
 * every complete path is judged on movement diversity, tonal-center
 * identity, prolongation purposefulness and development — against the
 * phrase's role and direction parameters, never against universal quotas
 * (no minimum root counts, no maximum repeats, no required tonic bars).
 *
 * Diversity-aware pruning (spec §11): the beam keeps paths representing
 * DIFFERENT root trajectories (signature-capped admission) instead of letting
 * one trajectory's variants fill it, and seeded jitter enters the structural
 * search itself, so different seeds change where the harmony goes — not
 * merely how it is decorated. The final choice among near-equal complete
 * paths is seeded (deterministic per window).
 *
 * Repeated material (spec §10, §15): a phrase linked to earlier material by
 * the Phase 3 plan reuses its structural FOUNDATIONS — exact, proportionally
 * mapped across different lengths — with bounded foundation-level variation
 * and a fresh, context-sensitive color pass applied later by the orchestrator
 * (colors are deliberately not copied). All bounded, all deterministic.
 *
 * Phase 4.2 diagnostics: the search can fill an OPTIONAL SelectionTrace while
 * it runs. Tracing is strictly observational — when `input.trace` is absent
 * not a single extra operation happens; when present it records the actual
 * scores, ranks, admission decisions and picks without consuming additional
 * rng values or reordering anything (Phase 4.2 spec §4).
 */
import { pickWeighted } from './planning';
import type { ChordGenSettings } from '../../shared/schema/types';
import type { BoundaryIntention, CadenceIntention, HarmonicPhrase, PhraseRole, RhythmShape } from './types';
import type { RhythmSlot } from './rhythm';
import {
  analyzeFoundationRelationship, foundationArrivalFit, foundationTransitionScore,
  foundationLabel,
  poolFoundationOrFallback, realizedFoundationFamily,
  reinforcesTonic, type FoundationInfo, type FoundationPool, type StructuralContext,
} from './foundation';

const BEAM_WIDTH = 8;
const SUCCESSORS_PER_BEAM = 4;
/** Max beam admissions sharing one root-trajectory signature. */
const MAX_PER_SIGNATURE = 2;
/** Window (fraction of best score) for the seeded final pick. */
const STRONG_CUTOFF = 0.12;
/** Max candidates recorded per beam expansion in a trace (diagnostics only). */
const TRACE_CANDIDATES_PER_BEAM = 10;

/** Search-shape constants, exposed so diagnostic reports can state the
 *  pruning configuration that actually governed a run (Phase 4.2 spec §9). */
export const BEAM_SEARCH_PARAMS = {
  beamWidth: BEAM_WIDTH,
  successorsPerBeam: SUCCESSORS_PER_BEAM,
  maxPerSignature: MAX_PER_SIGNATURE,
  strongCutoff: STRONG_CUTOFF,
} as const;

/** Everything the selector knows about one phrase window. Built by the
 *  orchestrator from the Phase 3 plan, section profiles and target clipping. */
export interface SelectionWindow {
  startTick: number;
  endTick: number;
  role: PhraseRole;
  direction: { stability: number; movement: number; tension: number };
  cadence: { intention: CadenceIntention; compatibleFamilies: HarmonicPhrase['cadence']['compatibleFamilies'] };
  sectionId: string | null;
  isSectionStart: boolean;
  /** Boundary intention into the NEXT window (when this window ends a section). */
  boundaryIntoNext: BoundaryIntention | null;
  relatedPhraseIds: string[];
  /** True when the phrase's cadence point lies inside this window (its end
   *  was not clipped away by the generation target). */
  arrivalPlanned: boolean;
  phraseRef: HarmonicPhrase | null;
  prefs: {
    stability: number; movement: number; complexity: number; tension: number; modal: number; contrast: number;
    /** Phase 2 harmonic-rhythm preference carried for the rhythm planner. */
    changesPerBar: number; shape: RhythmShape;
  };
}

/** Structural material of a related phrase: foundations in time order (spec
 *  §15 — structural identity reuse; colors are re-chosen per section). */
export interface MaterialReference {
  foundations: FoundationInfo[];
  /** 'full' = reuse across the window (repeat role); 'opening' = first-slot
   *  continuity prior only (develop role). */
  mode: 'full' | 'opening';
  /** Cadence intention of the related phrase, for cadential variation. */
  intention: CadenceIntention | null;
}

/* --------------------------------------------------------------------------
 * Selection trace (Phase 4.2 diagnostics) — observational, optional
 * ----------------------------------------------------------------------- */

/** Whole-path trajectory evaluation, decomposed into the exact components
 *  the evaluator applies (no recomputation, no invented categories). */
export interface PathEvaluationTrace {
  total: number;
  components: {
    movementDiversity: number;
    tonalIdentity: number;
    prolongationPurposefulness: number;
    development: number;
  };
}

/** One evaluated candidate inside one beam expansion. */
export interface BeamCandidateTrace {
  foundationId: string;
  label: string;
  /** Index of the beam whose expansion produced this candidate. */
  parentBeamIndex: number;
  /** Candidate path (foundation ids) including this candidate. */
  pathKey: string;
  parentScore: number;
  transition: number;
  position: number;
  loopPenalty: number;
  jitter: number;
  /** Score that ranked this candidate: parent + transition + position
   *  − loopPenalty + jitter. */
  total: number;
  /** 0-based rank within the parent beam's expansion after sorting. */
  rankInExpansion: number;
  /** Survived the per-beam top-SUCCESSORS cut. */
  keptAsSuccessor: boolean;
  /** Survived diversity-aware beam admission. */
  admitted: boolean;
  /** Precise survival: this candidate's path is one of the next beams. */
  survivedToNextBeam: boolean;
  /** Member of the finally selected path at this slot (complete-path note:
   *  this means the PATH won, not that the candidate won a local contest). */
  selected: boolean;
  notAdmittedReason: 'successor-cut' | 'beam-width' | 'signature-cap' | null;
}

/** One slot of beam search. */
export interface BeamSlotTrace {
  slotIndex: number;
  beamsBefore: number;
  beamsAfter: number;
  /** beamsBefore × pool size — every expansion was fully evaluated. */
  expansionsEvaluated: number;
  successorsKept: number;
  signatureCapsHit: number;
  widthPruned: number;
  /** Top candidates per beam, bounded (TRACE_CANDIDATES_PER_BEAM each). */
  candidates: BeamCandidateTrace[];
  admittedSignatures: string[];
}

/** One complete path in the final beam. */
export interface BeamFinalTrace {
  path: string[];
  /** Cumulative expansion score after the slot loop, before path evaluation. */
  cumulative: number;
  pathEvaluation: PathEvaluationTrace;
  /** Anchor-continuity bonus into the preserved foundation after the target. */
  anchorBonus: number | null;
  total: number;
  /** 0-based index in the beam array the final pick operated on. */
  rank: number;
  strong: boolean;
  chosen: boolean;
}

export interface BeamSearchTrace {
  slots: BeamSlotTrace[];
  finals: BeamFinalTrace[];
  strongCutoff: number;
  chosenIndex: number;
}

/** Reuse-path internals (structural repetition with bounded development). */
export interface MaterialSelectTrace {
  mode: 'full';
  /** Original related material, in time order. */
  sourceLabels: string[];
  /** Proportionally mapped onto this window's slots. */
  mappedLabels: string[];
  slots: Array<{
    slotIndex: number;
    mapped: string;
    chosen: string;
    substitution: boolean;
    /** Candidate labels considered for the substitution. */
    substitutionCandidates: string[];
    cadentialVariation: boolean;
    /** Scored candidates for the cadential variation (top 3). */
    cadentialCandidates: Array<{ label: string; score: number }>;
  }>;
}

/** Everything one structural selection decision exposes (Phase 4.2). */
export interface SelectionTrace {
  mode: 'beam' | 'reuse';
  /** Why reuse ran instead of the beam search (repeat role / cross-section link). */
  reuseReason: string | null;
  /** Foundation forced onto slot 0 (sustain across a phrase boundary). */
  forcedFirst: string | null;
  /** 'develop' continuity prior applied to the opening slot. */
  developOpeningOverride: string | null;
  poolSize: number;
  slotCount: number;
  beam: BeamSearchTrace | null;
  material: MaterialSelectTrace | null;
  /** The FINAL selected path's whole-phrase evaluation. Null on the reuse
   *  path — the evaluator does not run there (reported honestly as such). */
  pathEvaluation: PathEvaluationTrace | null;
  pathLabels: string[];
}

export interface SelectionInput {
  window: SelectionWindow;
  slots: RhythmSlot[];
  pool: FoundationPool;
  env: StructuralContext['env'];
  /** Foundation sounding when the window begins (anchor or previous selection). */
  prev: FoundationInfo | null;
  /** Preserved anchor foundation after the target (context leaving), if any. */
  after: FoundationInfo | null;
  material: MaterialReference | null;
  settings: ChordGenSettings;
  rng: () => number;
  /** When set (a deliberate sustain across the previous phrase boundary),
   *  the window's first slot must continue this foundation. */
  forcedFirst: FoundationInfo | null;
  isSongEnd: boolean;
  /** Optional observational trace (Phase 4.2). Absent in normal runs. */
  trace?: SelectionTrace;
}

export interface SelectionOutput {
  /** One foundation per slot (never null — sustain decisions happen at the
   *  event-merging layer). */
  foundations: FoundationInfo[];
  /** The foundation now sounding after the window (for chaining). */
  last: FoundationInfo | null;
}

/** The StructuralContext a window induces — exported so the diagnostics layer
 *  can recompute score components with the EXACT context the search used. */
export function structuralContext(
  window: SelectionWindow,
  pool: FoundationPool,
  env: StructuralContext['env'],
  settings: ChordGenSettings,
): StructuralContext {
  return {
    stability: window.direction.stability,
    movement: window.direction.movement,
    tension: window.direction.tension,
    modalPref: window.prefs.modal,
    contrastPref: window.prefs.contrast,
    borrowing: settings.borrowing,
    role: window.role,
    pool,
    env,
  };
}

/** Seeded coin with probability p. */
const coin = (rng: () => number, p: number): boolean => rng() < p;

/** Prefix key of a chosen path up to slot si (for candidate marking). */
const finalPathPrefixKey = (path: FoundationInfo[], si: number): string =>
  path.slice(0, si + 1).map((f) => f.id).join('>');

/** Pick a seeded index among n equal-weight options. */
const pickIndex = (rng: () => number, n: number): number => {
  if (n <= 1) return 0;
  return Number(pickWeighted(Array.from({ length: n }, (_, i) => [`i${i}`, 1] as const), rng).slice(1));
};

/** Component breakdown of `positionScore` — single implementation, the
 *  public score delegates (Phase 4.2 diagnostics). */
export interface PositionScoreParts {
  /** Opening-slot tonic emphasis in 'establish' phrases. */
  openingTonicFit: number;
  /** Structural arrival fit at the phrase's final slot. */
  arrivalFit: number;
  /** Bonus when the realized cadence family is compatible with the plan. */
  familyCompatibility: number;
}

/** Positional fit of one foundation at one slot (opening/arrival emphasis) —
 *  detailed variant; total is accumulated in the historical order. */
export function positionScoreDetailed(
  prev: FoundationInfo | null,
  cand: FoundationInfo,
  slotIndex: number,
  slotCount: number,
  window: SelectionWindow,
  ctx: StructuralContext,
): { total: number; parts: PositionScoreParts } {
  const parts: PositionScoreParts = { openingTonicFit: 0, arrivalFit: 0, familyCompatibility: 0 };
  let score = 0;
  if (slotIndex === 0 && window.role === 'establish' && cand.rootPc === ctx.pool.tonic) {
    parts.openingTonicFit = 0.12;
    score += parts.openingTonicFit;
  }
  if (slotIndex === slotCount - 1 && window.arrivalPlanned) {
    parts.arrivalFit = 0.9 * foundationArrivalFit(prev, cand, window.cadence.intention, ctx);
    score += parts.arrivalFit;
    const family = realizedFoundationFamily(prev, cand, ctx);
    if (family !== null && window.cadence.compatibleFamilies.includes(family)) {
      parts.familyCompatibility = 0.25;
      score += parts.familyCompatibility;
    }
  }
  return { total: score, parts };
}

/** Soft tonal-contact target per phrase role (fraction of slots whose
 *  foundation reinforces the tonic). Contextual preference, not a quota. */
const TONAL_CONTACT_TARGET: Record<PhraseRole, number> = {
  establish: 0.5, continue: 0.35, repeat: 0.45, develop: 0.3, contrast: 0.15, conclude: 0.45, prepare: 0.2,
};

/** Longest run of identical consecutive foundations. */
function longestRun(path: FoundationInfo[]): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < path.length; i++) {
    run = i > 0 && path[i].id === path[i - 1].id ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Whole-phrase trajectory evaluation (spec §8) — how a COMPLETE structural
 * path serves the phrase's intent. Every dimension is a soft fit against the
 * phrase's own role and direction: high-movement phrases are rewarded for
 * visiting distinct foundations, stable ones for purposeful prolongation,
 * establishing/concluding phrases for communicating the tonal center.
 * Symmetrical scales communicate the center through root recurrence and
 * shared structure (pedal relationships) instead of tonic-triad content.
 *
 * The detailed variant returns the component breakdown; `evaluatePath`
 * delegates to it, so diagnostics report the values that actually ranked
 * paths (Phase 4.2 spec §10 — only categories that really exist).
 */
export function evaluatePathDetailed(
  path: FoundationInfo[],
  window: SelectionWindow,
  ctx: StructuralContext,
): PathEvaluationTrace {
  const components = {
    movementDiversity: 0, tonalIdentity: 0, prolongationPurposefulness: 0, development: 0,
  };
  if (path.length === 0) return { total: 0, components };
  let score = 0;
  const distinctRoots = new Set(path.map((f) => f.rootPc)).size;
  const distinctRatio = distinctRoots / path.length;

  // Movement diversity vs the phrase's movement preference.
  const targetDistinct = 0.35 + 0.55 * ctx.movement;
  components.movementDiversity = 0.4 * (1 - Math.abs(distinctRatio - targetDistinct));
  score += components.movementDiversity;

  // Tonal identity: how much the path communicates the intended center.
  // The strongest path-level dimension (spec §7 — the central musical
  // improvement), while remaining a soft fit rather than a quota.
  const tonic = ctx.pool.tonic;
  if (ctx.pool.symmetric) {
    const rootContact = path.filter((f) => f.rootPc === tonic).length / path.length;
    const target = 0.2 + 0.3 * window.direction.stability;
    components.tonalIdentity = 0.6 * (1 - Math.abs(rootContact - target));
  } else {
    const contact = path.filter((f) => reinforcesTonic(f, tonic, ctx.pool.tonicTriadPcs)).length
      / path.length;
    const target = TONAL_CONTACT_TARGET[window.role];
    const weight = window.role === 'establish' || window.role === 'conclude' ? 0.7 : 0.5;
    components.tonalIdentity = weight * (1 - Math.abs(contact - target));
  }
  score += components.tonalIdentity;

  // Prolongation purposefulness: same-foundation runs against stability.
  const runRatio = (longestRun(path) - 1) / Math.max(1, path.length - 1);
  const targetRun = 0.1 + 0.45 * window.direction.stability;
  components.prolongationPurposefulness = 0.25 * (1 - Math.abs(runRatio - targetRun));
  score += components.prolongationPurposefulness;

  // Development: an opening idea recognized again in the path's second half.
  if (path.length >= 4
    && (window.role === 'establish' || window.role === 'continue' || window.role === 'repeat')) {
    const half = path.slice(Math.ceil(path.length / 2));
    if (half.some((f) => f.id === path[0].id)) {
      components.development = 0.12;
      score += components.development;
    }
  }
  return { total: score, components };
}

export function evaluatePath(
  path: FoundationInfo[],
  window: SelectionWindow,
  ctx: StructuralContext,
): number {
  return evaluatePathDetailed(path, window, ctx).total;
}

/** Bounded, diversity-aware beam search over the window's slots. */
function beamSelect(input: SelectionInput, ctx: StructuralContext): FoundationInfo[] {
  const { slots, pool } = input;
  const trace = input.trace;
  if (slots.length === 0 || pool.all.length === 0) {
    if (trace) {
      trace.beam = { slots: [], finals: [], strongCutoff: STRONG_CUTOFF, chosenIndex: -1 };
    }
    return [];
  }

  interface Beam { path: FoundationInfo[]; score: number }
  let beams: Beam[] = [{ path: [], score: 0 }];
  const jitterScale = 0.24 * Math.min(1, Math.max(0, input.settings.variation));

  const slotTraces: BeamSlotTrace[] = [];
  const pathKeyOf = (path: FoundationInfo[]): string => path.map((f) => f.id).join('>');

  for (let si = 0; si < slots.length; si++) {
    const next: Beam[] = [];
    const expansions: BeamCandidateTrace[] = [];
    const beamsBefore = beams.length;
    let successorsKept = 0;
    let signatureCapsHit = 0;
    let widthPruned = 0;

    for (let bi = 0; bi < beams.length; bi++) {
      const beam = beams[bi];
      const beamPrev: FoundationInfo | null = beam.path.length
        ? beam.path[beam.path.length - 1]
        : input.prev;
      // Foundation-identity loop detection: returning to a foundation visited
      // just before the current one reads as an accidental A→B→A loop. The
      // IMMEDIATE previous foundation is prolongation, not a loop, and is
      // scored contextually by the transition function instead.
      const recent = beam.path.slice(Math.max(0, beam.path.length - 4), beam.path.length - 1);
      const recentIds = new Set(recent.map((f) => f.id));

      const scored = pool.all.map((c, ci) => {
        const transition = foundationTransitionScore(beamPrev, c, ctx);
        const position = positionScoreDetailed(beamPrev, c, si, slots.length, input.window, ctx).total;
        const loopPenalty = recentIds.has(c.id) ? 0.3 : 0;
        // Seeded jitter inside the STRUCTURAL search: seeds move where the
        // harmony goes, not merely how it is decorated (spec §11).
        const jitter = (input.rng() - 0.5) * jitterScale;
        let s = beam.score + transition + position;
        if (loopPenalty > 0) s -= loopPenalty;
        s += jitter;
        return { c, s, ci, transition, position, loopPenalty, jitter };
      }).sort((x, y) => y.s - x.s || x.c.id.localeCompare(y.c.id));

      if (trace) {
        scored.forEach((e, rank) => {
          if (rank >= TRACE_CANDIDATES_PER_BEAM) return;
          expansions.push({
            foundationId: e.c.id,
            label: foundationLabel(e.c),
            parentBeamIndex: bi,
            pathKey: pathKeyOf([...beam.path, e.c]),
            parentScore: beam.score,
            transition: e.transition,
            position: e.position,
            loopPenalty: e.loopPenalty,
            jitter: e.jitter,
            total: e.s,
            rankInExpansion: rank,
            keptAsSuccessor: rank < SUCCESSORS_PER_BEAM,
            admitted: false,
            survivedToNextBeam: false,
            selected: false,
            notAdmittedReason: rank < SUCCESSORS_PER_BEAM ? null : 'successor-cut',
          });
        });
      }

      for (const { c, s } of scored.slice(0, SUCCESSORS_PER_BEAM)) {
        next.push({ path: [...beam.path, c], score: s });
        successorsKept += 1;
      }
    }

    // Diversity-aware pruning: admit best-first, but at most MAX_PER_SIGNATURE
    // paths per root-trajectory signature (last two roots + candidate root),
    // so one trajectory's variants cannot monoplize the beam.
    next.sort((a, b) => b.score - a.score
      || a.path.map((f) => f.id).join('>').localeCompare(b.path.map((f) => f.id).join('>')));
    const admitted: Beam[] = [];
    const sigCount = new Map<string, number>();
    const admittedSignatures: string[] = [];
    const rejected = new Map<string, 'beam-width' | 'signature-cap'>();
    for (const beam of next) {
      if (admitted.length >= BEAM_WIDTH) {
        widthPruned += 1;
        rejected.set(pathKeyOf(beam.path), 'beam-width');
        continue;
      }
      const roots = beam.path.map((f) => f.rootPc);
      const sig = `${roots.slice(-2).join('.')}>${roots[roots.length - 1] ?? ''}`;
      const n = sigCount.get(sig) ?? 0;
      if (n >= MAX_PER_SIGNATURE) {
        signatureCapsHit += 1;
        rejected.set(pathKeyOf(beam.path), 'signature-cap');
        continue;
      }
      sigCount.set(sig, n + 1);
      admitted.push(beam);
      admittedSignatures.push(sig);
    }
    beams = admitted;

    if (trace) {
      const admittedKeys = new Set(admitted.map((b) => pathKeyOf(b.path)));
      for (const e of expansions) {
        if (e.keptAsSuccessor) {
          const rej = rejected.get(e.pathKey);
          if (rej !== undefined) e.notAdmittedReason = rej;
          else { e.admitted = true; e.notAdmittedReason = null; }
        }
        e.survivedToNextBeam = admittedKeys.has(e.pathKey);
      }
      slotTraces.push({
        slotIndex: si,
        beamsBefore,
        beamsAfter: admitted.length,
        expansionsEvaluated: beamsBefore * pool.all.length,
        successorsKept,
        signatureCapsHit,
        widthPruned,
        candidates: expansions,
        admittedSignatures,
      });
    }
  }

  // Whole-phrase trajectory evaluation completes each path's score.
  const cumulativeByPathKey = new Map<string, number>();
  const evaluations = new Map<string, PathEvaluationTrace>();
  for (const b of beams) {
    const key = pathKeyOf(b.path);
    cumulativeByPathKey.set(key, b.score);
    const ev = evaluatePathDetailed(b.path, input.window, ctx);
    evaluations.set(key, ev);
    b.score += ev.total;
  }

  // Anchor continuity into the preserved foundation after the target.
  const anchorBonusByKey = new Map<string, number>();
  if (input.after !== null) {
    for (const b of beams) {
      const last = b.path[b.path.length - 1] ?? input.prev;
      if (last !== null) {
        const bonus = 0.5 * foundationTransitionScore(last, input.after, ctx);
        anchorBonusByKey.set(pathKeyOf(b.path), bonus);
        b.score += bonus;
      }
    }
    beams.sort((a, b) => b.score - a.score);
  }

  // Seeded pick among the strong finals: within ~12% of the best score,
  // equal weights — variation without incoherence.
  const best = beams[0];
  if (!best) {
    if (trace) trace.beam = { slots: slotTraces, finals: [], strongCutoff: STRONG_CUTOFF, chosenIndex: -1 };
    return pool.all.length > 0 ? slots.map(() => pool.all[0]) : [];
  }
  const cutoff = best.score - Math.abs(best.score) * STRONG_CUTOFF - 0.05;
  const strong = beams.filter((b) => b.score >= cutoff);
  const pick = pickIndex(input.rng, strong.length);
  const chosen = strong[pick];

  if (trace) {
    const chosenKey = pathKeyOf(chosen.path);
    const finals: BeamFinalTrace[] = beams.map((b, rank) => {
      const key = pathKeyOf(b.path);
      return {
        path: b.path.map((f) => foundationLabel(f)),
        cumulative: cumulativeByPathKey.get(key) ?? 0,
        pathEvaluation: evaluations.get(key) ?? { total: 0, components: { movementDiversity: 0, tonalIdentity: 0, prolongationPurposefulness: 0, development: 0 } },
        anchorBonus: anchorBonusByKey.get(key) ?? null,
        total: b.score,
        rank,
        strong: strong.includes(b),
        chosen: key === chosenKey,
      };
    });
    for (let si = 0; si < slotTraces.length; si++) {
      const prefixKey = finalPathPrefixKey(chosen.path, si);
      for (const e of slotTraces[si].candidates) {
        if (e.pathKey === prefixKey) e.selected = true;
      }
    }
    trace.beam = { slots: slotTraces, finals, strongCutoff: cutoff, chosenIndex: pick };
  }

  return chosen.path;
}

/** Map related structural material onto this window's slots proportionally,
 *  resolving every mapped foundation to a colorable pool entry. */
function mapMaterial(material: FoundationInfo[], slotCount: number, pool: FoundationPool): FoundationInfo[] {
  const mapped = material.length === slotCount
    ? [...material]
    : Array.from({ length: slotCount }, (_, i) => {
      const center = (i + 0.5) / slotCount;
      const idx = Math.min(material.length - 1, Math.floor(center * material.length));
      return material[idx];
    });
  return mapped.map((f) => poolFoundationOrFallback(pool, f));
}

/** Reuse path: structural repetition with bounded, variation-scaled
 *  foundation-level development (spec §10, §15). */
function materialSelect(input: SelectionInput, ctx: StructuralContext): FoundationInfo[] {
  const { slots, pool, settings, window } = input;
  const material = input.material!;
  const mapped = mapMaterial(material.foundations, slots.length, pool);
  const variation = Math.min(1, Math.max(0, settings.variation));
  const out: FoundationInfo[] = [];
  const trace = input.trace;
  const slotTraces = trace
    ? [] as MaterialSelectTrace['slots']
    : [];

  for (let si = 0; si < slots.length; si++) {
    const isFirst = si === 0;
    const isLast = si === slots.length - 1;
    let cand: FoundationInfo = mapped[si];
    const actualPrev: FoundationInfo | null = isFirst ? input.prev : out[si - 1];
    let substitution = false;
    let cadentialVariation = false;
    let substitutionCandidates: string[] = [];
    let cadentialCandidates: Array<{ label: string; score: number }> = [];

    // Structural substitution: mid-phrase only, both neighbors keep a
    // structural foothold (shared core tones) — a development of the idea,
    // not its replacement.
    if (!isFirst && !isLast && actualPrev !== null && cand.id !== actualPrev.id
      && coin(input.rng, 0.12 * variation)) {
      const nextCand = mapped[si + 1];
      const substitutes = pool.all.filter((c) =>
        c.id !== cand.id
        && analyzeFoundationRelationship(actualPrev, c).sharedCoreTones >= 1
        && analyzeFoundationRelationship(c, nextCand).sharedCoreTones >= 1);
      if (substitutes.length > 0) {
        substitutionCandidates = substitutes.map((c) => foundationLabel(c));
        cand = substitutes[pickIndex(input.rng, substitutes.length)];
        substitution = true;
      }
    }
    // Cadential variation: the arrival re-realizes THIS window's intention.
    if (isLast && window.arrivalPlanned && material.intention !== null
      && material.intention !== window.cadence.intention) {
      const scored = pool.all
        .map((c) => ({
          c,
          s: (actualPrev === null ? 0.4 : foundationTransitionScore(actualPrev, c, ctx))
            + foundationArrivalFit(actualPrev, c, window.cadence.intention, ctx),
        }))
        .sort((x, y) => y.s - x.s || x.c.id.localeCompare(y.c.id))
        .slice(0, 3);
      if (scored.length > 0) {
        cadentialCandidates = scored.map((e) => ({ label: foundationLabel(e.c), score: e.s }));
        cand = scored[pickIndex(input.rng, scored.length)].c;
        cadentialVariation = true;
      }
    }
    out.push(cand);
    if (trace) {
      slotTraces.push({
        slotIndex: si,
        mapped: foundationLabel(mapped[si]),
        chosen: foundationLabel(cand),
        substitution,
        substitutionCandidates,
        cadentialVariation,
        cadentialCandidates,
      });
    }
  }
  if (trace) {
    trace.material = {
      mode: 'full',
      sourceLabels: material.foundations.map((f) => foundationLabel(f)),
      mappedLabels: mapped.map((f) => foundationLabel(f)),
      slots: slotTraces,
    };
  }
  return out;
}

/**
 * Select the structural harmony for one phrase window. Returns exactly
 * `slots.length` foundations (a forced first slot continues the incoming
 * harmony across the boundary); colors are applied later by the orchestrator.
 *
 * When `input.trace` is provided it is filled with the actual decision data
 * (search mode, reuse reason, beam internals, whole-path evaluation);
 * generation behavior is identical either way (Phase 4.2 spec §4).
 */
export function selectWindowFoundations(input: SelectionInput): SelectionOutput {
  const { window, pool, settings } = input;
  const ctx = structuralContext(window, pool, input.env, settings);
  const trace = input.trace;
  if (trace) {
    trace.mode = 'beam';
    trace.reuseReason = null;
    trace.poolSize = pool.all.length;
    trace.slotCount = input.slots.length;
  }

  let path: FoundationInfo[];
  const reuse = input.material !== null && input.material.mode === 'full' && input.material.foundations.length > 0;
  if (reuse) {
    if (trace) {
      trace.mode = 'reuse';
      trace.reuseReason = window.role === 'repeat'
        ? 'repeat role with linked material'
        : 'cross-section repeated-material link';
    }
    path = materialSelect(input, ctx);
  } else {
    path = beamSelect(input, ctx);
    if (trace && trace.beam !== null) {
      trace.pathEvaluation = trace.beam.finals.find((f) => f.chosen)?.pathEvaluation ?? null;
    }
    // 'develop' continuity prior: related material nudges the opening.
    if (input.material !== null && input.material.mode === 'opening'
      && input.material.foundations.length > 0 && path.length > 0
      && coin(input.rng, 0.3)) {
      path[0] = poolFoundationOrFallback(pool, input.material.foundations[0]);
      if (trace) trace.developOpeningOverride = foundationLabel(path[0]);
    }
  }
  if (input.forcedFirst !== null && path.length > 0) {
    path[0] = poolFoundationOrFallback(pool, input.forcedFirst);
    if (trace) trace.forcedFirst = foundationLabel(path[0]);
  }

  if (trace) trace.pathLabels = path.map((f) => foundationLabel(f));
  const last = path.length > 0 ? path[path.length - 1] : input.prev;
  return { foundations: path, last };
}
