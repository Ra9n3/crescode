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
import type {
  BoundaryIntention, CadenceIntention, HarmonicPhrase, PhraseRole, RhythmShape,
  SectionHarmonicGoal,
} from './types';
import type { RhythmSlot } from './rhythm';
import {
  analyzeFoundationRelationship, foundationArrivalFit, foundationCountsAsResolved,
  foundationContinuationScoreDetailed,
  foundationTransitionScore,
  foundationLabel,
  poolFoundationOrFallback, QUALITY_TENSION, realizedFoundationFamily,
  reinforcesTonic, type ContinuationPosition, type ContinuationScoreParts,
  type FoundationInfo, type FoundationPool, type StructuralContext, type TensionState,
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

/** Observable shape of the phrase that came BEFORE this one in the same
 *  section — the facts the phrase-to-phrase contrast evaluation compares
 *  against. Built by the orchestrator from the previous window's selection;
 *  null for a section's first phrase or the first window of a target. */
export interface PriorPhraseFeatures {
  role: PhraseRole;
  /** Distinct roots per slot in the previous phrase's path. */
  rootDensity: number;
  /** Realized cadence family of the previous phrase's arrival (null when it
   *  had no planned arrival or no classifiable approach). */
  arrivalFamily: string | null;
  /** Foundation ids the previous phrase used. */
  foundationIds: string[];
}

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
  /** The section's sampled harmonic goal — what this section's arrival
   *  sequence is trying to say (Phase: section story). Null for synthetic
   *  windows (no section). */
  sectionGoal: SectionHarmonicGoal | null;
  /** True when this window is the last phrase of its section — the goal's
   *  payoff moment. */
  isSectionLast: boolean;
  /** Roots of the section's phrase arrivals BEFORE this window (the arrival
   *  sequence so far — goals are scored as a sequence, not per phrase). */
  sectionArrivalRoots: number[];
  /** Features of the previous phrase in this section (phrase-to-phrase
   *  contrast), null when there is no comparable predecessor. */
  priorPhraseFeatures: PriorPhraseFeatures | null;
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
    /** Fit of this phrase's arrival (in sequence) against the section's
     *  sampled harmonic goal. 0 when no goal applies. */
    goalFit: number;
    /** Phrase-to-phrase contrast — penalties for adjacent phrases that
     *  differ in nothing (the "nothing happens" pattern). 0 or negative. */
    contrastFit: number;
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
  /** Expansion score component: the CONTINUATION score when this candidate
   *  keeps the sounding foundation (Phase 4.3B), else the transition score. */
  transition: number;
  position: number;
  loopPenalty: number;
  jitter: number;
  /** Phase 4.3B: which structural action this candidate represents. */
  kind: 'continuation' | 'change';
  /** Continuation-score component breakdown (continuation candidates only). */
  continuationParts: ContinuationScoreParts | null;
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
  /** Develop phrases DEVELOP their source: the bounded transformation applied
   *  before slot variation (null for plain repetition). */
  developTransformation: string | null;
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
  /** Foundations sounding BEFORE `prev`, most recent last (≤2) — the previous
   *  phrase's tail. Loop detection spans the boundary: alternations and
   *  hovers ride across phrases exactly where a path-local view is blind.
   *  Absent (empty) at the region's opening. */
  history?: FoundationInfo[];
  /** Optional observational trace (Phase 4.2). Absent in normal runs. */
  trace?: SelectionTrace;
}

export interface SelectionOutput {
  /** One foundation per slot (never null — sustain decisions happen at the
   *  event-merging layer). */
  foundations: FoundationInfo[];
  /** Phase 4.3B: the structural action per slot — 'continue' when the slot
   *  keeps the previously sounding foundation (same id; at slot 0 this means
   *  the window's incoming harmony), 'change' when a new foundation was
   *  selected. Derived from the FINAL path (after forcedFirst / develop
   *  overrides) against the incoming harmony — the honest outcome. */
  actions: Array<'continue' | 'change'>;
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

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Build the continuation-position facts for one opportunity — the SAME
 *  builder the beam search uses and the diagnostics layer reuses, so
 *  recomputed continuation scores consume identical inputs (Phase 4.2
 *  single-implementation rule).
 *
 *  `pathBefore` is the beam path EXCLUDING the sounding foundation (the
 *  candidate's potential arrival predecessor lives one slot earlier).
 *
 *  `tensionState` rides alongside `sounding` — the beam path's resolution
 *  history at this opportunity (threaded for tension-story scoring). */
export function continuationPositionFor(
  window: SelectionWindow,
  slotIndex: number,
  slotCount: number,
  sounding: FoundationInfo,
  pathBefore: FoundationInfo[],
  inputPrev: FoundationInfo | null,
  after: FoundationInfo | null,
  _tensionState?: TensionState,
): ContinuationPosition {
  const isLast = slotIndex === slotCount - 1;
  const arrival = isLast && window.arrivalPlanned;
  return {
    position: slotIndex === 0 ? 'opening' : arrival ? 'arrival' : 'middle',
    sectionMovement: window.prefs.movement,
    changesPerBar: window.prefs.changesPerBar,
    shape: window.prefs.shape,
    anchorAfterMatches: after !== null && after.id === sounding.id,
    arrivalIntention: arrival ? window.cadence.intention : null,
    arrivalPrev: arrival
      ? (pathBefore.length > 0 ? pathBefore[pathBefore.length - 1] : inputPrev)
      : null,
  };
}

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
 *  detailed variant; total is accumulated in the historical order.
 *  `tensionState` rides alongside `prev` — the beam path's resolution
 *  history at this opportunity (threaded for tension-story scoring). */
export function positionScoreDetailed(
  prev: FoundationInfo | null,
  cand: FoundationInfo,
  slotIndex: number,
  slotCount: number,
  window: SelectionWindow,
  ctx: StructuralContext,
  _tensionState?: TensionState,
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
 *  foundation reinforces the tonic). Contextual preference, not a quota.
 *  Real progressions establish the key with ONE tonic statement, not half
 *  the phrase: the targets are calibrated low — the frame roles keep a
 *  modest pull home, the body barely any. */
const TONAL_CONTACT_TARGET: Record<PhraseRole, number> = {
  establish: 0.25, continue: 0.2, repeat: 0.25, develop: 0.15, contrast: 0.08, conclude: 0.25, prepare: 0.1,
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

/** Tonal flavor of the section goal's target roots — objective root-position
 *  facts, not function claims: the subdominant root is a fifth above home,
 *  the dominant root a fifth below (ascending). */

/**
 * Phrase-to-phrase contrast (the story pass) — penalties for adjacent
 * phrases that DIFFER IN NOTHING. One shared implementation, consumed by the
 * whole-path evaluator (which can then steer the search) and by the
 * orchestrator (which counts how often the realized program still fell flat).
 *
 * Three scored dimensions: root density, arrival family, foundation set.
 * Adjacent phrases matching on ALL of them read as "nothing happens" and are
 * penalized; two consecutive CONTINUE phrases that also arrive in the same
 * family are the strongest version of that flatness and draw the larger
 * penalty. Differing in ANY dimension is unpenalized — contrast is required,
 * but only its total absence.
 */
export function phraseContrastPenalty(
  path: FoundationInfo[],
  window: SelectionWindow,
  ctx: StructuralContext,
): number {
  const prior = window.priorPhraseFeatures;
  if (prior === null || path.length === 0) return 0;
  const distinctRoots = new Set(path.map((f) => f.rootPc)).size;
  const rootDensity = distinctRoots / Math.max(1, path.length);
  const arrival = path[path.length - 1];
  const arrivalPrev = path.length > 1 ? path[path.length - 2] : null;
  const arrivalFamily = realizedFoundationFamily(arrivalPrev, arrival, ctx);
  const pathIds = new Set(path.map((f) => f.id));
  const priorIds = new Set(prior.foundationIds);
  const sameMaterial = pathIds.size === priorIds.size
    && [...pathIds].every((id) => priorIds.has(id));
  const sameDensity = Math.abs(rootDensity - prior.rootDensity) <= 0.15;
  const sameFamily = (arrivalFamily ?? null) === prior.arrivalFamily;
  const dimsDiffer = [!sameDensity, !sameFamily, !sameMaterial].filter(Boolean).length;
  let penalty = 0;
  if (dimsDiffer === 0) penalty += 0.2;
  if (window.role === 'continue' && prior.role === 'continue' && sameFamily) penalty += 0.25;
  return penalty;
}

/**
 * The section-goal fit of one phrase path — how the phrase's arrival (as the
 * NEXT STEP of the section's arrival sequence) serves the section's sampled
 * harmonic goal. This is sequence-aware: goals about journeys read the roots
 * of the section's EARLIER arrivals (window.sectionArrivalRoots), and the
 * section's last phrase is where payoff goals (arrive home / on the
 * subdominant / on the dominant) concentrate their weight.
 */
export function sectionGoalFit(
  path: FoundationInfo[],
  window: SelectionWindow,
  ctx: StructuralContext,
): number {
  const goal = window.sectionGoal;
  if (goal === null || path.length === 0) return 0;
  const tonic = ctx.pool.tonic;
  const tonicPcs = ctx.pool.tonicTriadPcs;
  const arrival = path[path.length - 1];
  const arrHome = reinforcesTonic(arrival, tonic, tonicPcs);
  const arrRootHome = arrival.rootPc === tonic;
  const arrSub = arrival.rootPc === (tonic + 5) % 12;
  const arrDom = arrival.rootPc === (tonic + 7) % 12;
  const secondHalf = path.slice(Math.floor(path.length / 2));
  const secondHalfHome = secondHalf.length > 0
    ? secondHalf.filter((f) => reinforcesTonic(f, tonic, tonicPcs)).length / secondHalf.length
    : 0;
  const pathHomeContact = path.filter((f) => reinforcesTonic(f, tonic, tonicPcs)).length / path.length;
  const arrivalRoots = [...window.sectionArrivalRoots, arrival.rootPc];
  const distinctArrivalRoots = new Set(arrivalRoots).size;
  const pathDistinctRoots = new Set(path.map((f) => f.rootPc)).size;

  switch (goal.kind) {
    case 'home-arrival':
      // The last phrase is where the section comes home; earlier phrases
      // only lean that way (a touch of home contact in their second half).
      return window.isSectionLast
        ? (arrHome ? 1 : arrRootHome ? 0.7 : 0.15)
        : 0.1 + 0.3 * secondHalfHome;
    case 'static-home':
      // Intentional stasis: the more the path (and its arrival) stays home,
      // the better the section says what it means to say.
      return Math.min(1, 0.3 + pathHomeContact + (arrHome ? 0.2 : 0));
    case 'mid-departure':
      // Leave home in the middle, return by the end: middle phrases are
      // rewarded for being AWAY, the last phrase for the return.
      if (window.isSectionLast) return arrHome ? 1 : 0.2;
      if (window.isSectionStart) return 0.5;
      return arrHome ? 0.1 : 0.8;
    case 'subdominant-arrival':
      return window.isSectionLast ? (arrSub ? 1 : arrDom ? 0.3 : 0.1) : (arrSub ? 0.4 : 0.2);
    case 'dominant-arrival':
      return window.isSectionLast ? (arrDom ? 1 : arrSub ? 0.3 : 0.1) : (arrDom ? 0.4 : 0.2);
    case 'journey':
      // Development through motion itself: the arrival sequence (this phrase
      // included) should keep visiting distinct roots.
      return 0.5 * (distinctArrivalRoots / arrivalRoots.length)
        + 0.5 * Math.min(1, pathDistinctRoots / Math.max(1, path.length));
  }
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
    goalFit: 0, contrastFit: 0,
  };
  if (path.length === 0) return { total: 0, components };
  let score = 0;
  const distinctRoots = new Set(path.map((f) => f.rootPc)).size;

  // Movement diversity vs the phrase's movement preference — CORRECTED in
  // Phase 4.3B (spec §6): harmonic activity is measured relative to the
  // phrase's INTENDED activity, never rewarded absolutely. The pre-4.3B form
  // fitted `distinctRoots / slots` against `0.35 + 0.55·movement` — an ideal
  // of ≈62% distinct roots at neutral movement that scored ANY sustain as a
  // failure (the diagnosed root-churn bias: 29/29 transitions changing).
  // Activity is now the FOUNDATION CHANGE RATE across the path's
  // opportunities — continuations (same-id adjacencies, the explicit hold
  // decision) are not changes — and root VARIETY among the harmonies actually
  // used still matters at equal activity, so equal-activity paths with more
  // varied roots outrank alternating ones. Both fits are soft and contextual:
  // no continuation percentage is required anywhere.
  let changes = 0;
  for (let i = 1; i < path.length; i++) {
    if (path[i].id !== path[i - 1].id) changes += 1;
  }
  const changeRate = path.length > 1 ? changes / (path.length - 1) : 1;
  // Intended activity blends the phrase's direction (Phase 3) with the
  // section's movement preference (Phase 2) — a contextual preference, not
  // a universal target (spec §6 "avoid arbitrary targets").
  const movementIntent = clamp01((ctx.movement + window.prefs.movement) / 2);
  const intendedRate = 0.15 + 0.7 * movementIntent;
  const activityFit = 1 - Math.abs(changeRate - intendedRate);
  const varietyFit = changes === 0 ? 1 : distinctRoots / (changes + 1);
  components.movementDiversity = 0.4 * (0.7 * activityFit + 0.3 * varietyFit);
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

  // Section story: the phrase's arrival as the next step of the section's
  // goal sequence. Weight concentrates on the section's LAST phrase — the
  // payoff moment of arrival goals — while earlier phrases feel a light
  // directional pull.
  if (window.sectionGoal !== null) {
    const goalWeight = window.isSectionLast && window.arrivalPlanned ? 0.3 : 0.12;
    components.goalFit = goalWeight * sectionGoalFit(path, window, ctx);
    score += components.goalFit;
  }

  // Phrase-to-phrase contrast: adjacent phrases that differ in nothing are
  // penalized (penalty-only component — shared single implementation). The
  // zero case is normalized to +0 so JSON round-trips stay stable.
  const contrast = phraseContrastPenalty(path, window, ctx);
  components.contrastFit = contrast > 0 ? -contrast : 0;
  score += components.contrastFit;
  return { total: score, components };
}

export function evaluatePath(
  path: FoundationInfo[],
  window: SelectionWindow,
  ctx: StructuralContext,
): number {
  return evaluatePathDetailed(path, window, ctx).total;
}

/** Loop-shape penalty (the story pass, A-B-A correction). Two shapes read as
 *  accidental oscillation; everything else is legitimate structure:
 *
 *  1. STRICT ALTERNATION (0.3): the sounding tail is A,B,A and the candidate
 *     continues the ping-pong with B. A plain A→B→A return — depart, come
 *     back — stays free (the outer A's of an id-based A-B-A share every pitch
 *     class by construction, so a return reads as a return, not a loop).
 *  2. DOUBLED-LEAD-IN RETURN (0.15): the tail is A,A,B (A already re-sounded —
 *     a boundary sustain or held run) and the candidate returns to A after a
 *     single intervening event. The re-articulated A plus the immediate
 *     return reads as hovering on one harmony. Milder than alternation: the
 *     return itself is still a legitimate gesture, only the doubled lead-in
 *     makes it hover.
 *
 *  `before` carries the foundations sounding BEFORE path[0] (most recent
 *  last — the previous phrase's tail). Alternations and hovers ride across
 *  phrase boundaries precisely where a path-local view is blind, so the
 *  pattern window spans the boundary. Continuation (the sounding foundation)
 *  is always exempt — prolongation is judged by the whole-path evaluation,
 *  never here. Exported for tests/diagnostics: single implementation of the
 *  exact condition the beam applies. */
export function strictAlternationPenalty(
  path: FoundationInfo[],
  cand: FoundationInfo,
  isContinuation: boolean,
  before: FoundationInfo[] = [],
): number {
  if (isContinuation) return 0;
  const full = before.length > 0 ? [...before, ...path] : path;
  if (full.length < 3) return 0;
  const p1 = full[full.length - 1];
  const p2 = full[full.length - 2];
  const p3 = full[full.length - 3];
  // 1. strict alternation: …A,B,A + B.
  if (p1.id === p3.id && cand.id === p2.id && p1.id !== p2.id) return 0.3;
  // 2. doubled lead-in: …A,A,B + A.
  if (p2.id === p3.id && p1.id !== p2.id && cand.id === p2.id) return 0.15;
  return 0;
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

  interface Beam { path: FoundationInfo[]; score: number; tensionState: TensionState }
  // Tension story: seeded from the OPENING foundation's quality — the anchor
  // sounding before this window's first slot (null where none exists);
  // peak tension and slot count start clean.
  const openingTensionState: TensionState = {
    lastQuality: input.prev !== null ? input.prev.quality : null,
    peakTensionSinceResolution: 0,
    slotsSinceResolution: 0,
  };
  let beams: Beam[] = [{ path: [], score: 0, tensionState: openingTensionState }];
  const jitterScale = 0.24 * Math.min(1, Math.max(0, input.settings.variation));
  // Sounding context before the beam's own path: the previous phrase's trail
  // plus the incoming foundation — the loop-shape penalty's pattern window
  // spans the phrase boundary (see strictAlternationPenalty).
  const loopContextPrefix: FoundationInfo[] = [
    ...(input.history ?? []),
    ...(input.prev !== null ? [input.prev] : []),
  ];

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
      // Foundation-identity loop detection, RESTRICTED to strict alternation
      // (see strictAlternationPenalty — single shared implementation). The
      // SOUNDING foundation is exempt — continuing it is prolongation at any
      // run length (Phase 4.3B); run-length judgment belongs to the whole-path
      // evaluation (activity fit + prolongation purposefulness).

      const scored = pool.all.map((c, ci) => {
        // Phase 4.3B: a pool entry that IS the sounding foundation is the
        // CONTINUATION action — scored on its own musical terms (hold fit,
        // phrase direction, position, rhythm preference, neighbors), not as
        // a root change. Continuation is available wherever the sounding
        // harmony is pooled: every slot after the first, and slot 0 when the
        // incoming anchor's foundation is pooled (a non-pooled chromatic
        // anchor offers nothing to sustain — nothing can re-voice it).
        const isContinuation = beamPrev !== null && c.id === beamPrev.id;
        let transition: number;
        let continuationParts: ContinuationScoreParts | null = null;
        if (isContinuation && beamPrev !== null) {
          const d = foundationContinuationScoreDetailed(beamPrev, ctx, continuationPositionFor(
            input.window, si, slots.length, beamPrev, beam.path.slice(0, -1), input.prev, input.after,
            beam.tensionState,
          ), beam.tensionState);
          transition = d.total;
          continuationParts = d.parts;
        } else {
          transition = foundationTransitionScore(beamPrev, c, ctx, beam.tensionState);
        }
        const position = positionScoreDetailed(
          beamPrev, c, si, slots.length, input.window, ctx, beam.tensionState,
        ).total;
        // Loop-shape penalty (see above): the sounding tail — including the
        // previous phrase's trail across the boundary — ends A,B,A and this
        // candidate ping-pongs with B, or ends A,A,B and hovers back to A.
        const loopPenalty = beamPrev !== null
          ? strictAlternationPenalty(beam.path, c, isContinuation, loopContextPrefix)
          : 0;
        // Seeded jitter inside the STRUCTURAL search: seeds move where the
        // harmony goes, not merely how it is decorated (spec §11).
        const jitter = (input.rng() - 0.5) * jitterScale;
        let s = beam.score + transition + position;
        if (loopPenalty > 0) s -= loopPenalty;
        s += jitter;
        return { c, s, ci, transition, position, loopPenalty, jitter, isContinuation, continuationParts };
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
            kind: e.isContinuation ? 'continuation' : 'change',
            continuationParts: e.continuationParts,
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
        // Tension story, updated on acceptance: a RESOLVED candidate (tonic
        // root + stable quality — the same atHome && stable gate that opens
        // foundationArrivalFit's 'resolved' branch) resets the accumulation
        // to the candidate's own tension (QUALITY_TENSION of its quality);
        // anything else raises the running peak and counts a slot since
        // resolution. lastQuality always becomes the accepted candidate's.
        const resolved = foundationCountsAsResolved(c, ctx);
        const candTension = QUALITY_TENSION[c.quality];
        next.push({
          path: [...beam.path, c],
          score: s,
          tensionState: {
            lastQuality: c.quality,
            peakTensionSinceResolution: resolved
              ? candTension
              : Math.max(beam.tensionState.peakTensionSinceResolution, candTension),
            slotsSinceResolution: resolved ? 0 : beam.tensionState.slotsSinceResolution + 1,
          },
        });
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
        const bonus = 0.5 * foundationTransitionScore(last, input.after, ctx, b.tensionState);
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
        pathEvaluation: evaluations.get(key) ?? { total: 0, components: { movementDiversity: 0, tonalIdentity: 0, prolongationPurposefulness: 0, development: 0, goalFit: 0, contrastFit: 0 } },
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

/* --------------------------------------------------------------------------
 * Develop transformations — bounded development of reused material (story
 * pass). A develop phrase does not COPY its source; it develops it. Three
 * bounded, seeded transformations, each falling back to the plain mapping
 * when it cannot resolve inside the pool — never a redesign of the idea.
 * ----------------------------------------------------------------------- */

/** Resolve a root pitch class to a pooled foundation: same quality first,
 *  then any diatonic entry, then any entry. Null when the root is not pooled. */
function resolveRootInPool(
  pool: FoundationPool, rootPc: number, preferQuality: FoundationInfo['quality'],
): FoundationInfo | null {
  const at = pool.all.filter((f) => f.rootPc === rootPc);
  if (at.length === 0) return null;
  return at.find((f) => f.quality === preferQuality)
    ?? at.find((f) => f.diatonic)
    ?? at[0];
}

/** (a) Degree transpose: every DIATONIC root moves `step` scale degrees; a
 *  chromatic root in the source stays put (bounded development, not a key
 *  change). Null when nothing actually changed. */
function transposeMaterial(
  material: FoundationInfo[], pool: FoundationPool, scale: number[], step: number,
): FoundationInfo[] | null {
  const L = Math.max(1, scale.length);
  const out: FoundationInfo[] = [];
  let changed = false;
  for (const f of material) {
    const d = scale.indexOf(f.rootPc);
    if (d === -1) { out.push(f); continue; }
    const newRoot = scale[((d + step) % L + L) % L];
    const resolved = resolveRootInPool(pool, newRoot, f.quality);
    if (resolved === null || resolved.id === f.id) { out.push(f); continue; }
    changed = true;
    out.push(resolved);
  }
  return changed ? out : null;
}

/** (b) Chromatic swap: ONE mid-phrase foundation is replaced by a chromatic
 *  neighbor (root a semitone away) that keeps a foothold in its neighbors —
 *  a coloristic darkening/brightening of the idea, not a new idea. */
function chromaticSwapMaterial(
  material: FoundationInfo[], pool: FoundationPool, rng: () => number,
): FoundationInfo[] | null {
  if (material.length < 3) return null;
  const midCount = material.length - 2;
  const start = pickIndex(rng, midCount);
  for (let k = 0; k < midCount; k++) {
    const i = 1 + (start + k) % midCount;
    const orig = material[i];
    const prevF = material[i - 1];
    const nextF = material[i + 1];
    const neighbors = pool.all.filter((c) =>
      c.id !== orig.id
      && (c.rootPc === (orig.rootPc + 1) % 12 || c.rootPc === (orig.rootPc + 11) % 12)
      && analyzeFoundationRelationship(orig, c).sharedCoreTones >= 1
      && analyzeFoundationRelationship(prevF, c).sharedCoreTones >= 1
      && analyzeFoundationRelationship(c, nextF).sharedCoreTones >= 1);
    if (neighbors.length > 0) {
      const pick = neighbors[pickIndex(rng, neighbors.length)];
      const out = [...material];
      out[i] = pick;
      return out;
    }
  }
  return null;
}

/** (c) Contour inversion: the root-motion SEQUENCE reverses, re-anchored on
 *  the first foundation so the phrase still connects to its context. Null
 *  when any root cannot resolve in the pool or nothing actually changed. */
function invertContourMaterial(
  material: FoundationInfo[], pool: FoundationPool,
): FoundationInfo[] | null {
  if (material.length < 3) return null;
  const deltas: number[] = [];
  for (let i = 1; i < material.length; i++) {
    deltas.push(((material[i].rootPc - material[i - 1].rootPc) % 12 + 12) % 12);
  }
  deltas.reverse();
  const roots = [material[0].rootPc];
  for (const d of deltas) roots.push((roots[roots.length - 1] + d) % 12);
  const out: FoundationInfo[] = [];
  for (let i = 0; i < material.length; i++) {
    const resolved = resolveRootInPool(pool, roots[i], material[i].quality);
    if (resolved === null) return null;
    out.push(resolved);
  }
  if (out.every((f, i) => f.id === material[i].id)) return null;
  return out;
}

/** Reuse path: structural repetition with bounded, variation-scaled
 *  foundation-level development (spec §10, §15). REPEAT phrases copy their
 *  source with small variation; DEVELOP phrases transform it first — one
 *  bounded, seeded transformation (degree transpose, chromatic swap or
 *  contour inversion) reshapes the mapped material before the per-slot
 *  variation loop. */
function materialSelect(input: SelectionInput, ctx: StructuralContext): SelectionOutput {
  const { slots, pool, settings, window } = input;
  const material = input.material!;
  const mappedBase = mapMaterial(material.foundations, slots.length, pool);
  let mapped = mappedBase;
  let developTransformation: string | null = null;
  if (window.role === 'develop') {
    const scale = ctx.env.scalePitchClasses;
    const attempts: Array<readonly [string, () => FoundationInfo[] | null]> = [
      ['degree transpose', () => transposeMaterial(
        mappedBase, pool, scale, [1, -1, 2, -2][pickIndex(input.rng, 4)],
      )],
      ['chromatic neighbor swap', () => chromaticSwapMaterial(mappedBase, pool, input.rng)],
      ['contour inversion', () => invertContourMaterial(mappedBase, pool)],
    ];
    const start = pickIndex(input.rng, attempts.length);
    for (let k = 0; k < attempts.length; k++) {
      const [label, attempt] = attempts[(start + k) % attempts.length];
      const transformed = attempt();
      if (transformed !== null) {
        mapped = transformed;
        developTransformation = label;
        break;
      }
    }
  }
  const variation = Math.min(1, Math.max(0, settings.variation));
  const out: FoundationInfo[] = [];
  const actions: Array<'continue' | 'change'> = [];
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
    actions.push(actualPrev !== null && cand.id === actualPrev.id ? 'continue' : 'change');
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
      developTransformation,
      slots: slotTraces,
    };
  }
  const last = out.length > 0 ? out[out.length - 1] : input.prev;
  return { foundations: out, actions, last };
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
    const reused = materialSelect(input, ctx);
    path = reused.foundations;
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
  // Phase 4.3B: the per-slot structural action of the FINAL path (after any
  // forcedFirst / develop override) against the incoming harmony.
  const actions: Array<'continue' | 'change'> = path.map((f, i) => {
    const prevF = i > 0 ? path[i - 1] : input.prev;
    return prevF !== null && f.id === prevF.id ? 'continue' : 'change';
  });
  const last = path.length > 0 ? path[path.length - 1] : input.prev;
  return { foundations: path, actions, last };
}
