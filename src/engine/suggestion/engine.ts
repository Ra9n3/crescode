/**
 * The background Smart Suggestion Engine (feature spec §1–§6).
 *
 * Runs when the user double-clicks the Chord Track: the interaction layer has
 * planned and created the Smart clip, the chord editor overlay opens, and
 * this engine turns the surrounding harmonic context into a ranked,
 * color-coded suggestion list that is sent straight to the custom UI overlay
 * (plain JSON-serializable objects, no host types beyond the contracts).
 *
 * Inputs (§1): projectKey, previousChord (null ok), nextChord (null ok),
 * availableGapLength (ticks), currentGridResolution (ticks) and optional user
 * preferences. With no neighbors the engine still returns useful suggestions
 * — the score then rests on diatonic fit and key context alone.
 *
 * Pipeline (pure, deterministic, no rng, no I/O):
 *  §2 Candidate generation — a BOUNDED vocabulary: 12 roots × 20 chord
 *    shapes, every shape parsed through the SHARED chord grammar (one chord
 *    grammar in crescode, never two), tiered by the user's complexity
 *    preference. Everything is scored; only the top 12–24 reach the output,
 *    with a per-root diversity cap so one root cannot flood the list.
 *  §3 Compatibility scoring — transparent, configurable weights on a 0–100
 *    scale. All spec weights are implemented verbatim around a documented
 *    BASE of 50: without it the spec's own bonuses could never lift a
 *    key-only suggestion past +25 (everything red), which would contradict
 *    §1. Justification bonuses (borrowed / modal interchange / chromatic
 *    mediant) are mutually exclusive — the strongest applies, never stacked.
 *    Penalties apply once per suggestion (max over the two neighbors), not
 *    stacked per neighbor.
 *  §4 Ambiguous MIDI — the highest-confidence reading of an ambiguous
 *    neighbor is the primary context; a SECOND full ranking runs against its
 *    top alternative interpretation (one variant per ambiguous neighbor — no
 *    combinatorial explosion). Suggestions whose rank moves by ≥ 3 places,
 *    crosses a color boundary, or shifts by ≥ 15 points are flagged
 *    context-sensitive, carry both scores, and EVERY suggestion carries the
 *    ambiguity note — never hidden from the UI.
 *  §5 Color mapping — 75–100 green, 45–74 yellow, 0–44 red (deterministic;
 *    the contract's colorCategory keeps its harmonic vocabulary alongside).
 *  §6 Output — ChordSuggestion[], sorted by score descending (deterministic
 *    tie-breaks), each passing the contract's validateSuggestion.
 *
 * Adaptation notes (generic spec → crescode):
 *  - availableGapLength and currentGridResolution are accepted and validated
 *    per the feature contract. Scoring is purely harmonic (key + neighbors +
 *    preferences) so a suggestion list stays stable regardless of where in
 *    the gap the user clicked; the gap/grid values remain available to the
 *    overlay for layout, and the clip length itself was already fixed by the
 *    interaction layer (planClipPlacement).
 *  - The engine is strictly READ-ONLY: pure functions over the inputs, and
 *    suggestChordsAt calls read methods of the ChordTrackAPI only. Every
 *    write stays inside the interaction layer's undo transactions.
 */
import {
  MODES, NOTE_NAMES, parseChord, scalePitchClasses,
  type ModeName, type PitchClass,
} from '../../shared/schema';
import { chordFromSymbol, chordPitchClasses, spelledNoteName } from './model';
import { normalizeChord } from './normalize';
import { parseChordClipView } from './parse';
import type { ChordTrackAPI } from './adapter';
import {
  isPitchClass, SuggestionError,
  type Chord, type ChordClip, type ChordQuality, type GridResolution,
  type ProjectKey, type Suggestion, type SuggestionColorCategory,
} from './types';

// ---------------------------------------------------------------------------
// §3 weights — transparent, configurable scoring rules
// ---------------------------------------------------------------------------

/** Every scoring rule and its default weight (the feature spec's numbers;
 *  the base and the key-context tiers are documented engine decisions). */
export interface ScoreWeights {
  /** Neutral starting point on the 0–100 scale — see module doc §3. */
  base: number;
  /** All chord tones inside the key scale. */
  diatonicFit: number;
  /** Key-context tiers by the root's function in the key. */
  keyContextPrimary: number;   // tonic / subdominant / dominant
  keyContextSecondary: number; // predominant / submediant
  keyContextTertiary: number;  // mediant / leading
  /** Strong functional transition from the previous chord. */
  strongFunctionalRelation: number;
  /** Strong resolution tendency into the next chord. */
  strongResolution: number;
  /** ≥ 2 shared pitch classes with a neighbor (≥ 1 when it sounds ≤ 2 tones). */
  commonTone: number;
  /** Root a fourth or fifth from a neighbor. */
  rootMotionFourthFifth: number;
  /** Classic parallel-mode mixture with a chromatic root (bIII/bVI/bVII…). */
  borrowedCommon: number;
  /** Parallel-mode diatonic on a root the key already owns (iv, i, VII…). */
  borrowedOther: number;
  /** Fully diatonic to a sibling mode of the same tonic. */
  modalInterchange: number;
  /** Shares ≥ 2 tones with a sibling mode of the same tonic. */
  modalInterchangePartial: number;
  /** Chromatic mediant of a neighbor (both major-ish, roots a 3rd apart). */
  chromaticMediant: number;
  /** The spec's contextual cadential bonuses (V→I/vi, next=V, prev=IV/ii). */
  cadentialBonus: number;
  /** Root a tritone from a neighbor. */
  tritoneClash: number;
  /** Opposing thirds over the same root tone (C vs Cm, G7 vs Cmaj7). */
  thirdClash: number;
  /** Non-diatonic with no contextual justification. */
  nonDiatonicNoJustification: number;
  /** Same pitch-class set (or a superset/subset of it) as a neighbor. */
  duplicateAdjacent: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  base: 50,
  diatonicFit: 25,
  keyContextPrimary: 10,
  keyContextSecondary: 6,
  keyContextTertiary: 3,
  strongFunctionalRelation: 20,
  strongResolution: 25,
  commonTone: 10,
  rootMotionFourthFifth: 10,
  borrowedCommon: 15,
  borrowedOther: 10,
  modalInterchange: 10,
  modalInterchangePartial: 5,
  chromaticMediant: 10,
  cadentialBonus: 10,
  tritoneClash: -20,
  thirdClash: -15,
  nonDiatonicNoJustification: -20,
  duplicateAdjacent: -10,
};

/** Machine-readable causes — the spec's codes plus the open-set extras the
 *  contract allows ("consumers must render unknown categories generically"). */
export type ReasonCode =
  | 'DIATONIC' | 'KEY_CONTEXT' | 'STRONG_FUNCTIONAL_RELATION' | 'STRONG_RESOLUTION'
  | 'CADENTIAL' | 'COMMON_TONE' | 'ROOT_MOTION_FIFTH' | 'BORROWED_CHORD'
  | 'CHROMATIC_MEDIANT' | 'POSSIBLE_CLASH' | 'NON_DIATONIC' | 'DUPLICATE_ADJACENT'
  | 'WEAK_CONTEXT';

/** §5 color bands. */
export type EngineColor = 'green' | 'yellow' | 'red';

/** The user-tunable part of §1's "optional user preferences". */
export interface SuggestionPreferences {
  /** Restrict the candidate vocabulary to these qualities (exact quality
   *  names — 'major' matches plain major triads, extensions carry their own
   *  quality names such as 'maj7'). */
  allowedQualities?: readonly ChordQuality[];
  /** Vocabulary tier: simple = triads/sus only; moderate adds the common
   *  sevenths, 6/m6 and add9; rich adds the remaining grammar shapes. */
  preferredComplexity?: SuggestionComplexity;
  /** Output size, clamped to the spec's 12–24 window (default 18). */
  maxSuggestions?: number;
  /** At most this many suggestions per root pitch class (default 3) — a
   *  selection rule, not a score change, so one root cannot flood the list. */
  maxPerRoot?: number;
  /** Weight overrides — every rule is configurable (§3 "transparent,
   *  configurable rules"). Unspecified rules keep their defaults. */
  weights?: Partial<ScoreWeights>;
  /** Disable borrowed/modal/mediant justification (strictly diatonic lens). */
  allowBorrowedChords?: boolean;
}

export type SuggestionComplexity = 'simple' | 'moderate' | 'rich';

// ---------------------------------------------------------------------------
// §1 inputs
// ---------------------------------------------------------------------------

/** One neighbor chord plus — when its parse was ambiguous — its top
 *  alternative readings, best first (the engine's §4 secondary context). */
export interface SuggestionNeighbor {
  readonly chord: Chord;
  readonly alternatives?: readonly Chord[];
}

export interface SuggestionEngineInput {
  readonly projectKey: ProjectKey;
  readonly previousChord: SuggestionNeighbor | null;
  readonly nextChord: SuggestionNeighbor | null;
  /** Ticks. Informational context (see module doc) — validated, ≥ 0. */
  readonly availableGapLength: number;
  /** Ticks per grid unit — validated, a positive integer. */
  readonly currentGridResolution: number;
  readonly preferences?: SuggestionPreferences;
}

// ---------------------------------------------------------------------------
// §6 output
// ---------------------------------------------------------------------------

/** One transparent scoring step. */
export interface ScoreBreakdownEntry {
  readonly rule: string;
  readonly delta: number;
  readonly detail: string;
}

/** The same chord re-scored under a neighbor's alternative interpretation. */
export interface AlternativeContextResult {
  readonly contextLabel: string;
  readonly score100: number;
  readonly color: EngineColor;
  readonly rank: number;
}

/** §4 — the ambiguity is stated on every suggestion, never hidden. */
export interface ContextAmbiguityInfo {
  readonly position: 'previous' | 'next';
  readonly primary: { readonly displayName: string; readonly confidence: number };
  readonly alternative: { readonly displayName: string; readonly confidence: number };
}

/** What the engine hands to the custom UI overlay. Structurally a contract
 *  `Suggestion` (0..1 score, colorCategory, reasonCodes, explanation) plus
 *  the spec's 0–100 score, §5 color, transparency and §4 ambiguity fields. */
export interface ChordSuggestion extends Suggestion {
  readonly score100: number;
  readonly color: EngineColor;
  readonly scoreBreakdown: readonly ScoreBreakdownEntry[];
  readonly contextSensitive: boolean;
  readonly alternativeContextResults?: readonly AlternativeContextResult[];
  readonly ambiguity?: readonly ContextAmbiguityInfo[];
}

/** Rank/color movement that marks a suggestion context-sensitive (§4). */
export const CONTEXT_SENSITIVE_RANK_DELTA = 3;
export const CONTEXT_SENSITIVE_SCORE_DELTA = 15;

// ---------------------------------------------------------------------------
// Harmonic helpers
// ---------------------------------------------------------------------------

const mod12 = (v: number): PitchClass => (((v % 12) + 12) % 12) as PitchClass;

/** Circle distance between two pitch classes: 0 = unison, 6 = tritone. */
export function rootDistance(a: PitchClass, b: PitchClass): number {
  const d = mod12(a - b);
  return Math.min(d, 12 - d);
}

/** Positional function of a root inside the key's mode. Heptatonic modes map
 *  their scale degrees onto the classic roles (the positional mapping keeps
 *  idiomatic behavior in every mode: Aeolian's bVII acts as a dominant-type
 *  cadence degree, Phrygian's bII as a predominant, …). Non-heptatonic scales
 *  carry only the structural anchors (tonic / fourth / fifth). */
export type FunctionRole =
  | 'tonic' | 'predominant' | 'mediant' | 'subdominant'
  | 'dominant' | 'submediant' | 'leading';

const ROLE_BY_DEGREE: readonly FunctionRole[] =
  ['tonic', 'predominant', 'mediant', 'subdominant', 'dominant', 'submediant', 'leading'];

export function roleOfChordRoot(key: ProjectKey, rootPc: PitchClass): FunctionRole | 'chromatic' {
  const interval = mod12(rootPc - key.tonic);
  const steps = MODES[key.mode];
  if (steps.length === 7) {
    const degree = steps.indexOf(interval);
    return degree >= 0 ? ROLE_BY_DEGREE[degree]! : 'chromatic';
  }
  const scale = scalePitchClasses(key.tonic, key.mode);
  if (!scale.includes(rootPc)) return 'chromatic';
  if (interval === 5) return 'subdominant';
  if (interval === 7) return 'dominant';
  return 'chromatic';
}

/** Strong function transitions (from > to) — the shared table behind the
 *  +20 functional-relationship and +25 resolution-tendency rules. */
const STRONG_TRANSITIONS: ReadonlySet<string> = new Set([
  'tonic>predominant', 'tonic>subdominant', 'tonic>dominant',
  'predominant>dominant',
  'subdominant>dominant', 'subdominant>tonic',
  'dominant>tonic', 'dominant>submediant',
  'leading>tonic',
  'submediant>predominant', 'submediant>subdominant',
  'mediant>submediant', 'mediant>subdominant',
]);

const isStrongTransition = (from: FunctionRole, to: FunctionRole): boolean =>
  STRONG_TRANSITIONS.has(`${from}>${to}`);

/** True when every chord tone sits inside the key's scale. */
export function isDiatonicInKey(key: ProjectKey, pcs: readonly PitchClass[]): boolean {
  const scale = scalePitchClasses(key.tonic, key.mode);
  return pcs.every((pc) => scale.includes(pc));
}

/** True when a and b spell opposing thirds over the same root tone: one has
 *  x & x+4 where the other has x & x+3 — the C/Cm and G7/Cmaj7 cross-relations. */
export function thirdsClash(a: readonly PitchClass[], b: readonly PitchClass[]): boolean {
  for (const x of a) {
    if (a.includes(mod12(x + 4)) && b.includes(x) && b.includes(mod12(x + 3))) return true;
    if (a.includes(mod12(x + 3)) && b.includes(x) && b.includes(mod12(x + 4))) return true;
  }
  return false;
}

/** Duplicate or near-duplicate of a neighbor: identical pitch-class set, or
 *  same root with one set containing the other (C after C6/Cmaj7), or same
 *  root and quality. Same-root chords with opposing thirds fall through to
 *  the third-clash rule instead. */
export function nearDuplicateOf(cand: Chord, neighbor: Chord): boolean {
  const a = chordPitchClasses(cand);
  const b = chordPitchClasses(neighbor);
  if (a.length === b.length && a.every((pc) => b.includes(pc))) return true;
  if (cand.rootPc !== neighbor.rootPc) return false;
  if (cand.quality === neighbor.quality) return true;
  return a.every((pc) => b.includes(pc)) || b.every((pc) => a.includes(pc));
}

const keyLabel = (key: ProjectKey): string => `${NOTE_NAMES[key.tonic]} ${key.mode}`;

// ---------------------------------------------------------------------------
// §2 candidate generation — bounded vocabulary through the shared grammar
// ---------------------------------------------------------------------------

/** Chord shapes per complexity tier. Order is the stable tie-break within an
 *  equal score (usable shapes first: root triad, sevenths, colors, then the
 *  rest). Every suffix parses through the shared parseChord — verified once
 *  at module load so grammar drift fails loudly here, not in the UI. */
const COMPLEXITY_SUFFIXES: Record<SuggestionComplexity, readonly string[]> = {
  simple: ['', 'm', 'dim', 'aug', 'sus2', 'sus4'],
  moderate: ['', 'm', '7', 'maj7', 'm7', '6', 'm6', 'sus2', 'sus4', 'dim', 'aug', '5', 'add9', '7sus4'],
  rich: ['', 'm', '7', 'maj7', 'm7', '6', 'm6', 'sus2', 'sus4', 'dim', 'aug', '5', 'add9', '7sus4',
    'm7b5', 'dim7', 'aug7', '9', 'maj9', 'm9'],
};

/** Suffix → quality, pinned against the shared grammar at load time. */
const TEMPLATE_QUALITY: ReadonlyMap<string, ChordQuality> = (() => {
  const map = new Map<string, ChordQuality>();
  for (const suffix of COMPLEXITY_SUFFIXES.rich) {
    const parsed = parseChord(`C${suffix}`);
    if (!parsed.ok) throw new Error(`suggestion vocabulary template "${suffix}" failed to parse — shared grammar drift`);
    map.set(suffix, parsed.chord.quality as ChordQuality);
  }
  return map;
})();

/**
 * §2 — the bounded candidate vocabulary: 12 roots × the tier's shapes
 * (240 at 'rich'). Roots use crescode's canonical mixed spellings; every
 * candidate is built through the shared parser, so a suggestion can always
 * round-trip into renameChordClip without a second grammar.
 */
export function generateCandidateVocabulary(
  key: ProjectKey,
  preferences?: SuggestionPreferences,
): Chord[] {
  const tier = preferences?.preferredComplexity ?? 'rich';
  const suffixes = COMPLEXITY_SUFFIXES[tier];
  const allowed = preferences?.allowedQualities;
  const out: Chord[] = [];
  for (let pc = 0; pc <= 11; pc++) {
    // Root spellings follow the project key (spec §3 of the foundation layer:
    // Db in Eb major, C# in D major) via the key normalizer; the pitch class
    // never changes.
    const rootName = normalizeChord(spelledNoteName(pc), key);
    for (const suffix of suffixes) {
      const quality = TEMPLATE_QUALITY.get(suffix);
      if (quality === undefined) continue;
      if (allowed !== undefined && !allowed.includes(quality)) continue;
      const built = chordFromSymbol(`${rootName}${suffix}`);
      if (!built.ok) {
        throw new SuggestionError('invalid-chord-name', `vocabulary candidate "${rootName}${suffix}" failed to parse: ${built.error.message}`);
      }
      out.push(built.chord);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// §3 compatibility scoring
// ---------------------------------------------------------------------------

export interface ScoringContext {
  readonly key: ProjectKey;
  readonly prev: Chord | null;
  readonly next: Chord | null;
  readonly weights: ScoreWeights;
  readonly allowBorrowed: boolean;
}

export interface CandidateScore {
  score100: number;
  breakdown: ScoreBreakdownEntry[];
  reasonCodes: ReasonCode[];
  colorCategory: SuggestionColorCategory;
  keyContextBonus: number;
}

interface Justification {
  rule: string;
  delta: number;
  detail: string;
  reason: ReasonCode;
  kind: 'borrowed' | 'modal' | 'mediant' | 'none';
}

const NO_JUSTIFICATION: Justification = { rule: '', delta: 0, detail: '', reason: 'BORROWED_CHORD', kind: 'none' };

const keyContextBonusOf = (role: FunctionRole | 'chromatic', w: ScoreWeights): number =>
  role === 'tonic' || role === 'subdominant' || role === 'dominant' ? w.keyContextPrimary
    : role === 'predominant' || role === 'submediant' ? w.keyContextSecondary
      : role === 'mediant' || role === 'leading' ? w.keyContextTertiary
        : 0;

function borrowedJustification(key: ProjectKey, cand: Chord, w: ScoreWeights): Justification {
  const parallelMode: ModeName = key.mode === 'Ionian' ? 'Aeolian' : 'Ionian';
  const parallel = scalePitchClasses(key.tonic, parallelMode);
  const pcs = chordPitchClasses(cand);
  if (pcs.length === 0 || !pcs.every((pc) => parallel.includes(pc))) return NO_JUSTIFICATION;
  const rootInKey = scalePitchClasses(key.tonic, key.mode).includes(cand.rootPc);
  return rootInKey
    ? { rule: 'borrowedChord', delta: w.borrowedOther, detail: `borrowed from the parallel ${parallelMode} (same root)`, reason: 'BORROWED_CHORD', kind: 'borrowed' }
    : { rule: 'borrowedChord', delta: w.borrowedCommon, detail: `borrowed from the parallel ${parallelMode}`, reason: 'BORROWED_CHORD', kind: 'borrowed' };
}

/** Sibling modes of the SAME tonic (Locrian excluded — a scale with no
 *  perfect fifth makes almost anything "diatonic" and justifies tritone-root
 *  chords the ear rejects; the six practical modes keep the rule honest). */
const MODAL_SIBLING_MODES: readonly ModeName[] =
  ['Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian'];

function modalJustification(key: ProjectKey, cand: Chord, w: ScoreWeights): Justification {
  const pcs = chordPitchClasses(cand);
  if (pcs.length === 0) return NO_JUSTIFICATION;
  for (const mode of MODAL_SIBLING_MODES) {
    if (mode === key.mode) continue;
    const scale = scalePitchClasses(key.tonic, mode);
    if (pcs.every((pc) => scale.includes(pc))) {
      return { rule: 'modalInterchange', delta: w.modalInterchange, detail: `modal interchange — diatonic to ${keyLabel({ ...key, mode })}`, reason: 'BORROWED_CHORD', kind: 'modal' };
    }
  }
  for (const mode of MODAL_SIBLING_MODES) {
    if (mode === key.mode) continue;
    const scale = scalePitchClasses(key.tonic, mode);
    if (scale.includes(cand.rootPc) && pcs.filter((pc) => scale.includes(pc)).length >= 2) {
      return { rule: 'modalInterchange', delta: w.modalInterchangePartial, detail: `modal color from ${keyLabel({ ...key, mode })}`, reason: 'BORROWED_CHORD', kind: 'modal' };
    }
  }
  return NO_JUSTIFICATION;
}

function mediantJustification(cand: Chord, prev: Chord | null, next: Chord | null, w: ScoreWeights): Justification {
  const hasMajorThird = (c: Chord): boolean => chordPitchClasses(c).includes(mod12(c.rootPc + 4));
  if (!hasMajorThird(cand)) return NO_JUSTIFICATION;
  for (const neighbor of [prev, next]) {
    if (neighbor === null || !hasMajorThird(neighbor)) continue;
    const d = rootDistance(cand.rootPc, neighbor.rootPc);
    if (d === 3 || d === 4) {
      return { rule: 'chromaticMediant', delta: w.chromaticMediant, detail: `chromatic mediant of ${neighbor.spelling}`, reason: 'CHROMATIC_MEDIANT', kind: 'mediant' };
    }
  }
  return NO_JUSTIFICATION;
}

/**
 * §3 — score one candidate against the key and its neighbors, 0–100.
 * Every applicable rule appends a breakdown entry (transparent, and the UI
 * can show exactly why a suggestion ranked where it did).
 */
export function scoreCandidate(cand: Chord, ctx: ScoringContext): CandidateScore {
  const w = ctx.weights;
  const key = ctx.key;
  const pcs = chordPitchClasses(cand);
  const prevPcs = ctx.prev !== null ? chordPitchClasses(ctx.prev) : [];
  const nextPcs = ctx.next !== null ? chordPitchClasses(ctx.next) : [];
  const scale = scalePitchClasses(key.tonic, key.mode);
  const diatonic = pcs.every((pc) => scale.includes(pc));
  const candRole = roleOfChordRoot(key, cand.rootPc);
  const prevRole = ctx.prev !== null ? roleOfChordRoot(key, ctx.prev.rootPc) : null;
  const nextRole = ctx.next !== null ? roleOfChordRoot(key, ctx.next.rootPc) : null;

  let total = w.base;
  const breakdown: ScoreBreakdownEntry[] = [
    { rule: 'base', delta: w.base, detail: `neutral base of ${w.base} on the 0–100 scale` },
  ];
  const reasons: ReasonCode[] = [];
  const add = (rule: string, delta: number, detail: string, reason?: ReasonCode): void => {
    total += delta;
    breakdown.push({ rule, delta, detail });
    if (reason !== undefined && !reasons.includes(reason)) reasons.push(reason);
  };

  let functionalFired = false;
  let resolutionFired = false;
  let commonToneFired = false;
  let rootMotionFired = false;
  let cadentialFired = false;
  let justificationDelta = 0;
  let justificationKind: Justification['kind'] = 'none';
  let keyContextBonus = 0;

  // Diatonic fit to the project key: +25.
  if (diatonic) add('diatonicFit', w.diatonicFit, `diatonic in ${keyLabel(key)}`, 'DIATONIC');

  // Key context (root's function inside the key).
  keyContextBonus = keyContextBonusOf(candRole, w);
  if (keyContextBonus > 0) {
    add('keyContext', keyContextBonus, `${candRole} function in ${keyLabel(key)}`, 'KEY_CONTEXT');
  }

  // Strong functional relationship to the previous chord: +20.
  if (ctx.prev !== null && prevRole !== null && prevRole !== 'chromatic' && candRole !== 'chromatic'
    && isStrongTransition(prevRole, candRole)) {
    add('functionalRelation', w.strongFunctionalRelation, `strong harmonic function after ${ctx.prev.spelling}`, 'STRONG_FUNCTIONAL_RELATION');
    functionalFired = true;
  }

  // Strong resolution tendency toward the next chord: +25.
  if (ctx.next !== null && nextRole !== null && nextRole !== 'chromatic' && candRole !== 'chromatic'
    && isStrongTransition(candRole, nextRole)) {
    add('resolutionTendency', w.strongResolution, `strong resolution into ${ctx.next.spelling}`, 'STRONG_RESOLUTION');
    resolutionFired = true;
  }

  // Common-tone retention with either neighbor: +10 (once). Suppressed
  // against a near-duplicate — an (almost) identical chord's common tones
  // are not voice-leading information (the duplicate rule already speaks).
  const prevDup = ctx.prev !== null && nearDuplicateOf(cand, ctx.prev);
  const nextDup = ctx.next !== null && nearDuplicateOf(cand, ctx.next);
  const sharedWith = (nbPcs: readonly PitchClass[]): number => pcs.filter((pc) => nbPcs.includes(pc)).length;
  const toneThreshold = (nbPcs: readonly PitchClass[]): number => (nbPcs.length <= 2 ? 1 : 2);
  const prevShared = ctx.prev !== null ? sharedWith(prevPcs) : 0;
  const nextShared = ctx.next !== null ? sharedWith(nextPcs) : 0;
  const prevCommon = ctx.prev !== null && !prevDup && prevShared >= toneThreshold(prevPcs);
  const nextCommon = ctx.next !== null && !nextDup && nextShared >= toneThreshold(nextPcs);
  if (prevCommon || nextCommon) {
    const nb = prevCommon ? ctx.prev! : ctx.next!;
    const n = prevCommon ? prevShared : nextShared;
    add('commonTone', w.commonTone, `${n} common tone${n === 1 ? '' : 's'} with ${nb.spelling}`, 'COMMON_TONE');
    commonToneFired = true;
  }

  // Root motion by fourth or fifth: +10 (once).
  const prevDist = ctx.prev !== null ? rootDistance(cand.rootPc, ctx.prev.rootPc) : -1;
  const nextDist = ctx.next !== null ? rootDistance(cand.rootPc, ctx.next.rootPc) : -1;
  if (prevDist === 5 || prevDist === 7 || nextDist === 5 || nextDist === 7) {
    const byPrev = prevDist === 5 || prevDist === 7;
    const nb = byPrev ? ctx.prev! : ctx.next!;
    add('rootMotion', w.rootMotionFourthFifth, `root motion by fourth/fifth ${byPrev ? 'from' : 'to'} ${nb.spelling}`, 'ROOT_MOTION_FIFTH');
    rootMotionFired = true;
  }

  // Justification for chromatic chords — borrowed / modal / mediant, the
  // strongest applies, never stacked.
  if (!diatonic && ctx.allowBorrowed) {
    const candidates: Justification[] = [
      borrowedJustification(key, cand, w),
      modalJustification(key, cand, w),
      mediantJustification(cand, ctx.prev, ctx.next, w),
    ];
    const best = candidates.reduce((a, b) => (b.delta > a.delta ? b : a));
    if (best.delta > 0) {
      add(best.rule, best.delta, best.detail, best.reason);
      justificationDelta = best.delta;
      justificationKind = best.kind;
    }
  }

  // Contextual cadential bonuses (§3 "also apply contextual bonuses").
  if (ctx.prev !== null && prevRole !== null && prevRole !== 'chromatic' && candRole !== 'chromatic') {
    if (prevRole === 'dominant' && (candRole === 'tonic' || candRole === 'submediant')) {
      add('cadential', w.cadentialBonus, `${ctx.prev.spelling}→${cand.spelling} cadential resolution`, 'CADENTIAL');
      cadentialFired = true;
    } else if (prevRole === 'subdominant'
      && (candRole === 'dominant' || candRole === 'tonic' || candRole === 'predominant' || candRole === 'submediant')) {
      add('cadential', w.cadentialBonus, `follows ${ctx.prev.spelling} idiomatically (IV→V/I/ii/vi)`, 'CADENTIAL');
      cadentialFired = true;
    } else if (prevRole === 'predominant' && (candRole === 'dominant' || candRole === 'leading')) {
      add('cadential', w.cadentialBonus, `follows ${ctx.prev.spelling} idiomatically (ii→V)`, 'CADENTIAL');
      cadentialFired = true;
    }
  }
  if (ctx.next !== null && nextRole === 'dominant' && candRole !== 'chromatic'
    && (candRole === 'predominant' || candRole === 'subdominant')) {
    add('cadential', w.cadentialBonus, `strong pre-dominant setup for ${ctx.next.spelling}`, 'CADENTIAL');
    cadentialFired = true;
  }

  // Penalties — each applies once (max over the two neighbors).
  if (prevDist === 6 || nextDist === 6) {
    const nb = prevDist === 6 ? ctx.prev! : ctx.next!;
    add('tritoneClash', w.tritoneClash, `possible tritone clash with ${nb.spelling}`, 'POSSIBLE_CLASH');
  }
  const prevThirdClash = ctx.prev !== null && thirdsClash(pcs, prevPcs);
  const nextThirdClash = ctx.next !== null && thirdsClash(pcs, nextPcs);
  if (prevThirdClash || nextThirdClash) {
    const nb = prevThirdClash ? ctx.prev! : ctx.next!;
    add('thirdClash', w.thirdClash, `major/minor third cross-relation with ${nb.spelling}`, 'POSSIBLE_CLASH');
  }
  if (prevDup || nextDup) {
    const nb = prevDup ? ctx.prev! : ctx.next!;
    add('duplicateAdjacent', w.duplicateAdjacent, `near-duplicate of ${nb.spelling}`, 'DUPLICATE_ADJACENT');
  }
  const justified = justificationDelta > 0 || commonToneFired || rootMotionFired
    || functionalFired || resolutionFired;
  if (!diatonic && !justified) {
    add('nonDiatonic', w.nonDiatonicNoJustification, 'non-diatonic with no contextual justification', 'NON_DIATONIC');
  }

  // WEAK_CONTEXT — little to stand on: no neighbor-driven support, or (key
  // only) neither a key role nor a justification.
  const neighborSupport = functionalFired || resolutionFired || commonToneFired
    || rootMotionFired || cadentialFired || justificationDelta > 0;
  if (ctx.prev !== null || ctx.next !== null) {
    if (!neighborSupport) reasons.push('WEAK_CONTEXT');
  } else if (keyContextBonus === 0 && justificationDelta === 0) {
    reasons.push('WEAK_CONTEXT');
  }

  const colorCategory: SuggestionColorCategory =
    cadentialFired ? 'cadential'
      : candRole === 'tonic' ? 'tonic'
        : justificationKind === 'borrowed' ? 'borrowed'
          : justificationKind === 'modal' || justificationKind === 'mediant' ? 'modal-color'
            : candRole === 'dominant' ? 'dominant'
              : candRole === 'subdominant' ? 'subdominant'
                : diatonic ? 'diatonic'
                  : 'passing';

  return {
    score100: Math.max(0, Math.min(100, total)),
    breakdown,
    reasonCodes: reasons,
    colorCategory,
    keyContextBonus,
  };
}

// ---------------------------------------------------------------------------
// §5 color mapping — deterministic
// ---------------------------------------------------------------------------

/** 75–100 green, 45–74 yellow, 0–44 red (the spec's table, boundaries exact). */
export function colorForScore(score100: number): EngineColor {
  return score100 >= 75 ? 'green' : score100 >= 45 ? 'yellow' : 'red';
}

// ---------------------------------------------------------------------------
// Ranking, selection, §4 ambiguity, main entry
// ---------------------------------------------------------------------------

interface RankedCandidate {
  readonly candidate: Chord;
  readonly vocabIndex: number;
  readonly result: CandidateScore;
  readonly score100: number;
  readonly keyContextBonus: number;
  readonly rank: number;
}

function rankCandidates(vocabulary: Chord[], ctx: ScoringContext): RankedCandidate[] {
  const tonic = ctx.key.tonic;
  return vocabulary
    .map((candidate, vocabIndex) => {
      const result = scoreCandidate(candidate, ctx);
      return { candidate, vocabIndex, result, score100: result.score100, keyContextBonus: result.keyContextBonus, rank: 0 };
    })
    .sort((a, b) =>
      b.score100 - a.score100 ||
      b.keyContextBonus - a.keyContextBonus ||
      rootDistance(a.candidate.rootPc, tonic) - rootDistance(b.candidate.rootPc, tonic) ||
      a.vocabIndex - b.vocabIndex)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Greedy top-N with a per-root diversity cap — a selection rule over the
 *  full ranking, never a score change. */
function selectRanked(ranked: RankedCandidate[], maxSuggestions: number, maxPerRoot: number): RankedCandidate[] {
  const perRoot = new Map<PitchClass, number>();
  const out: RankedCandidate[] = [];
  for (const entry of ranked) {
    if (out.length >= maxSuggestions) break;
    const count = perRoot.get(entry.candidate.rootPc) ?? 0;
    if (count >= maxPerRoot) continue;
    perRoot.set(entry.candidate.rootPc, count + 1);
    out.push(entry);
  }
  return out;
}

function clampCount(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function validateEngineInput(input: SuggestionEngineInput): void {
  if (!isPitchClass(input.projectKey.tonic)) {
    throw new SuggestionError('invalid-range', `projectKey.tonic must be a pitch class 0–11 (got ${String(input.projectKey.tonic)})`);
  }
  if (!(input.projectKey.mode in MODES)) {
    throw new SuggestionError('invalid-range', `unknown key mode "${String(input.projectKey.mode)}"`);
  }
  const gap = input.availableGapLength;
  if (typeof gap !== 'number' || Number.isNaN(gap) || gap < 0) {
    throw new SuggestionError('invalid-range', `availableGapLength must be a number ≥ 0 in ticks (got ${String(gap)})`);
  }
  const grid = input.currentGridResolution;
  if (!Number.isInteger(grid) || grid <= 0) {
    throw new SuggestionError('invalid-range', `currentGridResolution must be a positive integer tick count (got ${String(grid)})`);
  }
}

function explanationOf(entry: RankedCandidate): string {
  const phrases = entry.result.breakdown
    .filter((e) => e.rule !== 'base')
    .map((e) => e.detail)
    .filter((d) => d.length > 0);
  const text = phrases.length > 0 ? phrases.join('; ') : `${entry.candidate.spelling} fits the current context`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ambiguityOf(input: SuggestionEngineInput): ContextAmbiguityInfo[] {
  const out: ContextAmbiguityInfo[] = [];
  const push = (position: 'previous' | 'next', neighbor: SuggestionNeighbor | null): void => {
    const alt = neighbor?.alternatives?.[0];
    if (neighbor !== null && neighbor !== undefined && alt !== undefined) {
      out.push({
        position,
        primary: { displayName: neighbor.chord.spelling, confidence: neighbor.chord.confidence },
        alternative: { displayName: alt.spelling, confidence: alt.confidence },
      });
    }
  };
  push('previous', input.previousChord);
  push('next', input.nextChord);
  return out;
}

interface Variant {
  readonly label: string;
  readonly bySpelling: ReadonlyMap<string, { rank: number; score100: number; color: EngineColor }>;
}

function variantOf(
  vocabulary: Chord[],
  base: ScoringContext,
  position: 'previous' | 'next',
  alt: Chord,
  label: string,
): Variant {
  const ctx: ScoringContext = position === 'previous' ? { ...base, prev: alt } : { ...base, next: alt };
  const ranked = rankCandidates(vocabulary, ctx);
  const bySpelling = new Map(ranked.map((r) => [
    r.candidate.spelling,
    { rank: r.rank, score100: r.score100, color: colorForScore(r.score100) },
  ]));
  return { label, bySpelling };
}

/**
 * §1–§6 — the engine entry point. Pure: same input, same output, always.
 */
export function generateChordSuggestions(input: SuggestionEngineInput): ChordSuggestion[] {
  validateEngineInput(input);
  const prefs = input.preferences ?? {};
  const weights: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS, ...prefs.weights };
  const maxSuggestions = clampCount(prefs.maxSuggestions, 18, 12, 24);
  const maxPerRoot = clampCount(prefs.maxPerRoot, 3, 1, 12);
  const allowBorrowed = prefs.allowBorrowedChords ?? true;

  const vocabulary = generateCandidateVocabulary(input.projectKey, prefs);
  const primary: ScoringContext = {
    key: input.projectKey,
    prev: input.previousChord?.chord ?? null,
    next: input.nextChord?.chord ?? null,
    weights,
    allowBorrowed,
  };
  const ranked = rankCandidates(vocabulary, primary);

  // §4 — one secondary ranking per ambiguous neighbor (primary stays the
  // highest-confidence reading; no combinatorial explosion).
  const variants: Variant[] = [];
  const prevAlt = input.previousChord?.alternatives?.[0];
  const nextAlt = input.nextChord?.alternatives?.[0];
  if (prevAlt !== undefined) {
    variants.push(variantOf(vocabulary, primary, 'previous', prevAlt, `previous chord as ${prevAlt.spelling}`));
  }
  if (nextAlt !== undefined) {
    variants.push(variantOf(vocabulary, primary, 'next', nextAlt, `next chord as ${nextAlt.spelling}`));
  }
  const ambiguity = ambiguityOf(input);

  return selectRanked(ranked, maxSuggestions, maxPerRoot).map((entry) => {
    const color = colorForScore(entry.score100);
    const alternativeContextResults: AlternativeContextResult[] = [];
    for (const variant of variants) {
      const hit = variant.bySpelling.get(entry.candidate.spelling);
      if (hit !== undefined) {
        alternativeContextResults.push({
          contextLabel: variant.label, score100: hit.score100, color: hit.color, rank: hit.rank,
        });
      }
    }
    const contextSensitive = alternativeContextResults.some((a) =>
      Math.abs(a.rank - entry.rank) >= CONTEXT_SENSITIVE_RANK_DELTA
      || a.color !== color
      || Math.abs(a.score100 - entry.score100) >= CONTEXT_SENSITIVE_SCORE_DELTA);

    const suggestion: ChordSuggestion = {
      chord: entry.candidate,
      score: entry.score100 / 100,
      colorCategory: entry.result.colorCategory,
      reasonCodes: [...entry.result.reasonCodes],
      contextExplanation: explanationOf(entry),
      score100: entry.score100,
      color,
      scoreBreakdown: entry.result.breakdown,
      contextSensitive,
      alternativeContextResults: alternativeContextResults.length > 0 ? alternativeContextResults : undefined,
      ambiguity: ambiguity.length > 0 ? ambiguity : undefined,
    };
    return suggestion;
  });
}

// ---------------------------------------------------------------------------
// The double-click entry — read-only reads off the ChordTrackAPI
// ---------------------------------------------------------------------------

export interface SuggestAtOptions {
  readonly preferences?: SuggestionPreferences;
  /** A clip to exclude from both neighbor slots — the freshly created Smart
   *  clip the overlay is open for must not act as its own chord context. */
  readonly excludeClipId?: string;
}

function neighborOf(clip: ChordClip | null, grid: GridResolution, key: ProjectKey): SuggestionNeighbor | null {
  if (clip === null) return null;
  const notes = clip.rawMidiNotes ?? [];
  if (notes.length > 0) {
    // MIDI-backed: the fresh context-free parse is the primary reading and
    // its alternative readings feed §4 (the verdict is context-free by
    // design in the §1 parser — only ranking tie-breaks use context).
    const analysis = parseChordClipView(clip, { grid, projectKey: key });
    return {
      chord: analysis.chord ?? clip.chord,
      alternatives: analysis.alternatives.map((a) => a.chord),
    };
  }
  return { chord: clip.chord, alternatives: clip.alternativeInterpretations };
}

/**
 * Runs the engine for a double-click at `time`: reads the project key, grid,
 * open gap and surrounding chords from the API (read methods only), then
 * delegates to generateChordSuggestions.
 */
export function suggestChordsAt(api: ChordTrackAPI, time: number, options: SuggestAtOptions = {}): ChordSuggestion[] {
  if (!Number.isInteger(time) || time < 0) {
    throw new SuggestionError('invalid-range', `time must be an integer ≥ 0 (got ${time})`);
  }
  const key = api.getProjectKeySignature();
  const grid = api.getGridResolution();

  let prevClip = api.getPreviousChordClip(time);
  let nextClip = api.getNextChordClip(time);
  const exclude = options.excludeClipId;
  if (exclude !== undefined) {
    if (prevClip?.id === exclude) prevClip = api.getPreviousChordClip(prevClip.startTime);
    if (nextClip?.id === exclude) nextClip = api.getNextChordClip(nextClip.startTime + nextClip.lengthTicks);
  }

  const gap = api.getAvailableGapAt(time);
  const availableGapLength = gap === null
    ? 0
    : gap.endTime === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : gap.endTime - gap.startTime;

  return generateChordSuggestions({
    projectKey: key,
    previousChord: neighborOf(prevClip, grid, key),
    nextChord: neighborOf(nextClip, grid, key),
    availableGapLength,
    currentGridResolution: grid.ticksPerBeat,
    preferences: options.preferences,
  });
}
