/**
 * Phrase-aware progression construction (Phase 4) — WHICH chords, in WHICH
 * order (spec §7, §8, §10).
 *
 * Selection is a bounded beam search over the chord slots of one phrase
 * window: partial paths expand candidate by candidate, each expansion scored
 * by the contextual transition facts from candidates.ts plus position fit
 * (arrival realization at the phrase's cadence point), and only the strongest
 * few paths survive each slot. Whole-path scoring keeps the phrase's broader
 * harmonic direction in view — a Dm→G→C path reads differently depending on
 * whether it ends home or keeps moving, and the beam carries that difference.
 * The final choice among equally strong complete paths is seeded (deterministic
 * per window), which is how repeated clicks produce coherent variations rather
 * than random chord collections (spec §13).
 *
 * Repeated material (spec §10): a phrase linked to earlier material by the
 * Phase 3 plan can reuse it — exact repetition, chord-quality variation,
 * common-tone substitution or cadential variation, in a degree set by the
 * variation setting and preserveIdentity. Related sections of different
 * lengths map material proportionally. All bounded, all deterministic.
 *
 * Complexity bounds: beam width 8, ≤ 3 successors per beam per slot, one
 * shortlist pass per distinct previous chord. No unbounded search, no large
 * optimization framework (spec §7, §18).
 */
import { pickWeighted } from './planning';
import type { ChordGenSettings } from '../../shared/schema/types';
import type { BoundaryIntention, CadenceFamily, CadenceIntention, HarmonicPhrase, PhraseRole, RhythmShape } from './types';
import type { RhythmSlot } from './rhythm';
import {
  arrivalFit, candidateFromSymbol, pairFacts, realizedFamily, transitionScore,
  type CandidateInfo, type CandidatePool, type SelectionContext,
} from './candidates';

const BEAM_WIDTH = 8;
const SUCCESSORS_PER_BEAM = 3;
const SHORTLIST = 14;

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

export interface MaterialReference {
  /** Symbols of the related material, in time order. */
  symbols: string[];
  /** 'full' = reuse across the window (repeat role); 'opening' = first-slot
   *  continuity prior only (develop role). */
  mode: 'full' | 'opening';
  /** Cadence intention of the related phrase, for cadential variation. */
  intention: CadenceIntention | null;
}

export interface SelectionInput {
  window: SelectionWindow;
  slots: RhythmSlot[];
  pool: CandidatePool;
  env: SelectionContext['env'];
  /** Chord sounding when the window begins (anchor or previous selection). */
  prev: CandidateInfo | null;
  /** Preserved anchor chord after the target (context leaving), if any. */
  after: CandidateInfo | null;
  material: MaterialReference | null;
  settings: ChordGenSettings;
  rng: () => number;
  /** True when the window's first slot continues the previous event (a
   *  sustain across the previous phrase boundary, decided upstream). */
  mergeFirst: boolean;
  isSongEnd: boolean;
}

export interface SelectionOutput {
  /** One entry per slot: the chosen symbol, or null for a continuation slot
   *  (the event sustains from the previous slot — same chord, merged event). */
  symbols: Array<string | null>;
  /** The candidate now sounding after the window (for chaining). */
  last: CandidateInfo | null;
  /** Family realized at the planned arrival, for the report. */
  arrivalFamily: CadenceFamily | null;
}

function selectionContext(
  window: SelectionWindow,
  pool: CandidatePool,
  env: SelectionContext['env'],
  settings: ChordGenSettings,
): SelectionContext {
  return {
    stability: window.direction.stability,
    movement: window.direction.movement,
    tension: window.direction.tension,
    complexityPref: window.prefs.complexity,
    modalPref: window.prefs.modal,
    contrastPref: window.prefs.contrast,
    borrowing: settings.borrowing,
    role: window.role,
    pool,
    env,
  };
}

/** Resolve a symbol to candidate info: pool lookup first, else analyze the
 *  symbol on demand (manual chromatic material is never rejected). */
function resolveSymbol(symbol: string, pool: CandidatePool): CandidateInfo | null {
  const found = pool.all.find((c) => c.symbol === symbol);
  if (found) return found;
  return candidateFromSymbol(symbol, pool.tonic, pool.mode);
}

/** Positional fit of one candidate at one slot (first/last emphasis). */
function positionScore(
  prev: CandidateInfo | null,
  cand: CandidateInfo,
  slotIndex: number,
  slotCount: number,
  input: SelectionInput,
  ctx: SelectionContext,
): number {
  let score = 0;
  const window = input.window;
  if (slotIndex === 0 && window.role === 'establish' && cand.rootPc === ctx.pool.tonic) score += 0.12;
  if (slotIndex === slotCount - 1 && window.arrivalPlanned) {
    score += 0.9 * arrivalFit(prev, cand, window.cadence.intention, ctx);
    const family = realizedFamily(prev, cand, ctx);
    if (family !== null && window.cadence.compatibleFamilies.includes(family)) score += 0.25;
  }
  return score;
}

/** Seeded coin with probability p. */
const coin = (rng: () => number, p: number): boolean => rng() < p;

/** Pick a seeded index among n equal-weight options. */
const pickIndex = (rng: () => number, n: number): number => {
  if (n <= 1) return 0;
  return Number(pickWeighted(Array.from({ length: n }, (_, i) => [`i${i}`, 1] as const), rng).slice(1));
};

/** Bounded beam search over the window's slots. */
function beamSelect(input: SelectionInput, ctx: SelectionContext): Array<string | null> {
  const { slots, pool } = input;
  if (slots.length === 0 || pool.all.length === 0) return slots.map(() => null);

  interface Beam { symbols: string[]; cands: CandidateInfo[]; score: number }
  let beams: Beam[] = [{ symbols: [], cands: [], score: 0 }];

  for (let si = 0; si < slots.length; si++) {
    const next: Beam[] = [];
    const seenPaths = new Set<string>();
    const isArrivalSlot = si === slots.length - 1 && input.window.arrivalPlanned;

    // Group beams by their last candidate so the shortlist pass is shared.
    const groups = new Map<string, Beam[]>();
    for (const beam of beams) {
      const key = beam.cands.length ? beam.cands[beam.cands.length - 1].symbol : '∅';
      const list = groups.get(key) ?? [];
      list.push(beam);
      groups.set(key, list);
    }

    for (const group of groups.values()) {
      const groupPrev: CandidateInfo | null = group[0].cands.length
        ? group[0].cands[group[0].cands.length - 1]
        : input.prev;
      // Shortlist: top candidates by contextual transition score (null prev
      // scores through the real opening function — openings lean home).
      let shortlist = pool.all
        .map((c) => ({ c, t: transitionScore(groupPrev, c, ctx) }))
        .sort((x, y) => y.t - x.t || x.c.symbol.localeCompare(y.c.symbol))
        .slice(0, SHORTLIST);
      // Arrival slots also admit the strongest realizations of the intended
      // cadence, so a good arrival is never pruned by its transition alone.
      if (isArrivalSlot) {
        const have = new Set(shortlist.map((s) => s.c.symbol));
        const arrivals = pool.all
          .map((c) => ({ c, a: arrivalFit(groupPrev, c, input.window.cadence.intention, ctx) }))
          .sort((x, y) => y.a - x.a || x.c.symbol.localeCompare(y.c.symbol))
          .slice(0, 6);
        for (const a of arrivals) if (!have.has(a.c.symbol)) shortlist.push({ c: a.c, t: 0 });
      }

      for (const beam of group) {
        const beamPrev: CandidateInfo | null = beam.cands.length
          ? beam.cands[beam.cands.length - 1]
          : input.prev;
        // Path-internal repetition: revisiting a recent chord inside the same
        // phrase reads as an accidental loop, not a return — discourage it
        // without forbidding it (returns at phrase boundaries stay natural).
        // Enharmonic twins (same pitch content, e.g. dim7 rotations) count too.
        const recentPcs = new Set(beam.cands.slice(-4).flatMap((c) => c.pcs.map((p) => `${p}`)));
        const scored = shortlist
          .map(({ c }) => ({
            c,
            score: beam.score
              + transitionScore(beamPrev, c, ctx)
              + positionScore(beamPrev, c, si, slots.length, input, ctx)
              - (c.pcs.every((p) => recentPcs.has(`${p}`)) ? 0.35 : 0),
          }))
          .sort((x, y) => y.score - x.score || x.c.symbol.localeCompare(y.c.symbol))
          .slice(0, SUCCESSORS_PER_BEAM);
        for (const s of scored) {
          const key = [...beam.symbols, s.c.symbol].join('>');
          if (seenPaths.has(key)) continue;
          seenPaths.add(key);
          next.push({ symbols: [...beam.symbols, s.c.symbol], cands: [...beam.cands, s.c], score: s.score });
        }
      }
    }

    next.sort((a, b) => b.score - a.score || a.symbols.join('>').localeCompare(b.symbols.join('>')));
    beams = next.slice(0, BEAM_WIDTH);
  }

  // Anchor continuity into the preserved chord after the target.
  if (input.after !== null) {
    for (const b of beams) b.score += 0.5 * transitionScore(b.cands[b.cands.length - 1], input.after, ctx);
    beams.sort((a, b) => b.score - a.score);
  }

  // Seeded pick among the strong finals: within ~12% of the best score,
  // equal weights — variation without incoherence (spec §13).
  const best = beams[0];
  const cutoff = best.score - Math.abs(best.score) * 0.12 - 0.05;
  const strong = beams.filter((b) => b.score >= cutoff);
  return strong[pickIndex(input.rng, strong.length)].symbols;
}

/** Map related material onto this window's slots proportionally. */
function mapMaterial(material: string[], slotCount: number): string[] {
  if (material.length === slotCount) return [...material];
  return Array.from({ length: slotCount }, (_, i) => {
    const center = (i + 0.5) / slotCount;
    const idx = Math.min(material.length - 1, Math.floor(center * material.length));
    return material[idx];
  });
}

/** Reuse path: exact repetition with bounded, variation-scaled development. */
function materialSelect(input: SelectionInput, ctx: SelectionContext): string[] {
  const { slots, pool, settings, window } = input;
  const material = input.material!;
  const mapped = mapMaterial(material.symbols, slots.length);
  const variation = Math.min(1, Math.max(0, settings.variation));
  const out: string[] = [];

  for (let si = 0; si < slots.length; si++) {
    const isFirst = si === 0;
    const isLast = si === slots.length - 1;
    let cand: CandidateInfo | null = resolveSymbol(mapped[si], pool);
    const actualPrev: CandidateInfo | null = isFirst
      ? input.prev
      : resolveSymbol(out[si - 1], pool);

    // Chord-quality variation: same root, different diatonic structure.
    if (cand !== null && coin(input.rng, 0.16 * variation + (settings.preserveIdentity ? 0 : 0.1))) {
      const variants = pool.all.filter((c) => c.rootPc === cand!.rootPc && c.symbol !== cand!.symbol && c.diatonic);
      if (variants.length > 0) cand = variants[pickIndex(input.rng, variants.length)];
    }
    // Common-tone substitution: mid-phrase only, both neighbors keep a foothold.
    if (cand !== null && !isFirst && !isLast && coin(input.rng, 0.12 * variation)) {
      const nextCand = resolveSymbol(mapped[si + 1], pool);
      if (actualPrev !== null && nextCand !== null) {
        const substitutes = pool.all.filter((c) =>
          c.symbol !== cand!.symbol
          && pairFacts(actualPrev, c).commonToneCount >= 2
          && pairFacts(c, nextCand).commonToneCount >= 2);
        if (substitutes.length > 0) cand = substitutes[pickIndex(input.rng, substitutes.length)];
      }
    }
    // Cadential variation: the arrival re-realizes THIS window's intention.
    if (isLast && window.arrivalPlanned && material.intention !== null
      && material.intention !== window.cadence.intention && cand !== null) {
      const scored = pool.all
        .map((c) => ({
          c,
          s: (actualPrev === null ? 0.4 : transitionScore(actualPrev, c, ctx))
            + arrivalFit(actualPrev, c, window.cadence.intention, ctx),
        }))
        .sort((x, y) => y.s - x.s || x.c.symbol.localeCompare(y.c.symbol))
        .slice(0, 3);
      if (scored.length > 0) cand = scored[pickIndex(input.rng, scored.length)].c;
    }
    out.push(cand !== null ? cand.symbol : mapped[si]);
  }
  return out;
}

/**
 * Select chords for one phrase window. Returns one entry per slot; a null
 * entry sustains the previous event (continuation). Never throws, always
 * returns exactly `slots.length` entries, and never emits an unparsable
 * symbol: every candidate originates from the parser-validated pool.
 */
export function selectWindowChords(input: SelectionInput): SelectionOutput {
  const { window, pool, settings } = input;
  const ctx = selectionContext(window, pool, input.env, settings);

  let symbols: Array<string | null>;
  const reuse = input.material !== null && input.material.mode === 'full' && input.material.symbols.length > 0;
  if (reuse) {
    symbols = [...materialSelect(input, ctx)];
  } else {
    symbols = [...beamSelect(input, ctx)];
    // 'develop' continuity prior: related material nudges the opening.
    if (input.material !== null && input.material.mode === 'opening'
      && input.material.symbols.length > 0 && symbols.length > 0
      && coin(input.rng, 0.3)) {
      symbols[0] = input.material.symbols[0];
    }
  }

  // The arrival chord = the last selected (non-continuation) candidate.
  let lastCand: CandidateInfo | null = null;
  let arrivalFamily: CadenceFamily | null = null;
  if (window.arrivalPlanned) {
    for (let i = symbols.length - 1; i >= 0; i--) {
      const cand = resolveSymbol(symbols[i] ?? '', pool);
      if (cand === null) continue;
      lastCand = cand;
      arrivalFamily = realizedFamily(i === 0 ? input.prev : resolveSymbol(symbols[i - 1] ?? '', pool), cand, ctx);
      break;
    }
  }
  for (let i = symbols.length - 1; i >= 0 && lastCand === null; i--) {
    lastCand = resolveSymbol(symbols[i] ?? '', pool);
  }
  const last = lastCand ?? input.prev;

  // Continuation slot (sustain across the previous boundary): no new chord.
  const output: Array<string | null> = [...symbols];
  if (input.mergeFirst && output.length > 0) output[0] = null;

  return { symbols: output, last, arrivalFamily };
}
