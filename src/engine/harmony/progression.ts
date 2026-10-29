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
 */
import { pickWeighted } from './planning';
import type { ChordGenSettings } from '../../shared/schema/types';
import type { BoundaryIntention, CadenceIntention, HarmonicPhrase, PhraseRole, RhythmShape } from './types';
import type { RhythmSlot } from './rhythm';
import {
  analyzeFoundationRelationship, foundationArrivalFit, foundationTransitionScore,
  poolFoundationOrFallback, realizedFoundationFamily,
  reinforcesTonic, type FoundationInfo, type FoundationPool, type StructuralContext,
} from './foundation';

const BEAM_WIDTH = 8;
const SUCCESSORS_PER_BEAM = 4;
/** Max beam admissions sharing one root-trajectory signature. */
const MAX_PER_SIGNATURE = 2;
/** Window (fraction of best score) for the seeded final pick. */
const STRONG_CUTOFF = 0.12;

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
}

export interface SelectionOutput {
  /** One foundation per slot (never null — sustain decisions happen at the
   *  event-merging layer). */
  foundations: FoundationInfo[];
  /** The foundation now sounding after the window (for chaining). */
  last: FoundationInfo | null;
}

function structuralContext(
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

/** Pick a seeded index among n equal-weight options. */
const pickIndex = (rng: () => number, n: number): number => {
  if (n <= 1) return 0;
  return Number(pickWeighted(Array.from({ length: n }, (_, i) => [`i${i}`, 1] as const), rng).slice(1));
};

/** Positional fit of one foundation at one slot (opening/arrival emphasis). */
function positionScore(
  prev: FoundationInfo | null,
  cand: FoundationInfo,
  slotIndex: number,
  slotCount: number,
  window: SelectionWindow,
  ctx: StructuralContext,
): number {
  let score = 0;
  if (slotIndex === 0 && window.role === 'establish' && cand.rootPc === ctx.pool.tonic) score += 0.12;
  if (slotIndex === slotCount - 1 && window.arrivalPlanned) {
    score += 0.9 * foundationArrivalFit(prev, cand, window.cadence.intention, ctx);
    const family = realizedFoundationFamily(prev, cand, ctx);
    if (family !== null && window.cadence.compatibleFamilies.includes(family)) score += 0.25;
  }
  return score;
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
 */
export function evaluatePath(
  path: FoundationInfo[],
  window: SelectionWindow,
  ctx: StructuralContext,
): number {
  if (path.length === 0) return 0;
  let score = 0;
  const distinctRoots = new Set(path.map((f) => f.rootPc)).size;
  const distinctRatio = distinctRoots / path.length;

  // Movement diversity vs the phrase's movement preference.
  const targetDistinct = 0.35 + 0.55 * ctx.movement;
  score += 0.4 * (1 - Math.abs(distinctRatio - targetDistinct));

  // Tonal identity: how much the path communicates the intended center.
  // The strongest path-level dimension (spec §7 — the central musical
  // improvement), while remaining a soft fit rather than a quota.
  const tonic = ctx.pool.tonic;
  if (ctx.pool.symmetric) {
    const rootContact = path.filter((f) => f.rootPc === tonic).length / path.length;
    const target = 0.2 + 0.3 * window.direction.stability;
    score += 0.6 * (1 - Math.abs(rootContact - target));
  } else {
    const contact = path.filter((f) => reinforcesTonic(f, tonic, ctx.pool.tonicTriadPcs)).length
      / path.length;
    const target = TONAL_CONTACT_TARGET[window.role];
    const weight = window.role === 'establish' || window.role === 'conclude' ? 0.7 : 0.5;
    score += weight * (1 - Math.abs(contact - target));
  }

  // Prolongation purposefulness: same-foundation runs against stability.
  const runRatio = (longestRun(path) - 1) / Math.max(1, path.length - 1);
  const targetRun = 0.1 + 0.45 * window.direction.stability;
  score += 0.25 * (1 - Math.abs(runRatio - targetRun));

  // Development: an opening idea recognized again in the path's second half.
  if (path.length >= 4
    && (window.role === 'establish' || window.role === 'continue' || window.role === 'repeat')) {
    const half = path.slice(Math.ceil(path.length / 2));
    if (half.some((f) => f.id === path[0].id)) score += 0.12;
  }
  return score;
}

/** Bounded, diversity-aware beam search over the window's slots. */
function beamSelect(input: SelectionInput, ctx: StructuralContext): FoundationInfo[] {
  const { slots, pool } = input;
  if (slots.length === 0 || pool.all.length === 0) return [];

  interface Beam { path: FoundationInfo[]; score: number }
  let beams: Beam[] = [{ path: [], score: 0 }];
  const jitterScale = 0.24 * Math.min(1, Math.max(0, input.settings.variation));

  for (let si = 0; si < slots.length; si++) {
    const next: Beam[] = [];

    for (const beam of beams) {
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
        let s = beam.score
          + foundationTransitionScore(beamPrev, c, ctx)
          + positionScore(beamPrev, c, si, slots.length, input.window, ctx);
        if (recentIds.has(c.id)) s -= 0.3;
        // Seeded jitter inside the STRUCTURAL search: seeds move where the
        // harmony goes, not merely how it is decorated (spec §11).
        s += (input.rng() - 0.5) * jitterScale;
        return { c, s, ci };
      }).sort((x, y) => y.s - x.s || x.c.id.localeCompare(y.c.id));

      for (const { c, s } of scored.slice(0, SUCCESSORS_PER_BEAM)) {
        next.push({ path: [...beam.path, c], score: s });
      }
    }

    // Diversity-aware pruning: admit best-first, but at most MAX_PER_SIGNATURE
    // paths per root-trajectory signature (last two roots + candidate root),
    // so one trajectory's variants cannot monoplize the beam.
    next.sort((a, b) => b.score - a.score
      || a.path.map((f) => f.id).join('>').localeCompare(b.path.map((f) => f.id).join('>')));
    const admitted: Beam[] = [];
    const sigCount = new Map<string, number>();
    for (const beam of next) {
      if (admitted.length >= BEAM_WIDTH) break;
      const roots = beam.path.map((f) => f.rootPc);
      const sig = `${roots.slice(-2).join('.')}>${roots[roots.length - 1] ?? ''}`;
      const n = sigCount.get(sig) ?? 0;
      if (n >= MAX_PER_SIGNATURE) continue;
      sigCount.set(sig, n + 1);
      admitted.push(beam);
    }
    beams = admitted;
  }

  // Whole-phrase trajectory evaluation completes each path's score.
  for (const b of beams) b.score += evaluatePath(b.path, input.window, ctx);

  // Anchor continuity into the preserved foundation after the target.
  if (input.after !== null) {
    for (const b of beams) {
      const last = b.path[b.path.length - 1] ?? input.prev;
      if (last !== null) b.score += 0.5 * foundationTransitionScore(last, input.after, ctx);
    }
    beams.sort((a, b) => b.score - a.score);
  }

  // Seeded pick among the strong finals: within ~12% of the best score,
  // equal weights — variation without incoherence.
  const best = beams[0];
  if (!best) return pool.all.length > 0 ? slots.map(() => pool.all[0]) : [];
  const cutoff = best.score - Math.abs(best.score) * STRONG_CUTOFF - 0.05;
  const strong = beams.filter((b) => b.score >= cutoff);
  return strong[pickIndex(input.rng, strong.length)].path;
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

  for (let si = 0; si < slots.length; si++) {
    const isFirst = si === 0;
    const isLast = si === slots.length - 1;
    let cand: FoundationInfo = mapped[si];
    const actualPrev: FoundationInfo | null = isFirst ? input.prev : out[si - 1];

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
      if (substitutes.length > 0) cand = substitutes[pickIndex(input.rng, substitutes.length)];
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
      if (scored.length > 0) cand = scored[pickIndex(input.rng, scored.length)].c;
    }
    out.push(cand);
  }
  return out;
}

/**
 * Select the structural harmony for one phrase window. Returns exactly
 * `slots.length` foundations (a forced first slot continues the incoming
 * harmony across the boundary); colors are applied later by the orchestrator.
 */
export function selectWindowFoundations(input: SelectionInput): SelectionOutput {
  const { window, pool, settings } = input;
  const ctx = structuralContext(window, pool, input.env, settings);

  let path: FoundationInfo[];
  const reuse = input.material !== null && input.material.mode === 'full' && input.material.foundations.length > 0;
  if (reuse) {
    path = materialSelect(input, ctx);
  } else {
    path = beamSelect(input, ctx);
    // 'develop' continuity prior: related material nudges the opening.
    if (input.material !== null && input.material.mode === 'opening'
      && input.material.foundations.length > 0 && path.length > 0
      && coin(input.rng, 0.3)) {
      path[0] = poolFoundationOrFallback(pool, input.material.foundations[0]);
    }
  }
  if (input.forcedFirst !== null && path.length > 0) {
    path[0] = poolFoundationOrFallback(pool, input.forcedFirst);
  }

  const last = path.length > 0 ? path[path.length - 1] : input.prev;
  return { foundations: path, last };
}
