/**
 * Harmonic foundations (Phase 4.1) — structural harmony separated from chord
 * color (spec §4, §5, §6).
 *
 * The Phase 4 generator selected fully colored chords directly, so "D7 → D13"
 * competed with "D7 → C → Em" as if it were the same kind of harmonic event,
 * and complexity preferences leaked into root selection. The correction is
 * architectural: every chord is reduced to its STRUCTURAL FOUNDATION — the
 * underlying harmony that survives when sevenths, extensions and suspensions
 * are stripped away — and progression construction happens in two stages:
 *
 *   Stage A (structural): choose WHERE the harmony goes, over foundations.
 *   Stage B (color):      choose HOW each foundation sounds, over chords.
 *
 * A foundation is (root pitch class, structural core). The core is the root
 * plus its structural third and fifth: D, D7, D9, D13 share the D major core
 * {D, F#, A}; Em, Em7, Em9, Em11 share the E minor core {E, G, B}. Genuinely
 * different harmonies stay different — D vs Dm vs Ddim vs Daug vs Dsus4 all
 * carry distinct cores, and altered fifths (7b5-family) keep their own core
 * instead of being folded into major/minor. Symmetrical-scale harmony (Whole
 * Tone augmented chords, diminished structures) is classified honestly as
 * augmented / diminished / other — never forced into conventional categories.
 *
 * The foundation pool is grouped FROM the colored candidate pool, so:
 * - availability (complexity, borrowing) keeps shaping the COLOR palette,
 *   never the number of structural shortlist positions (spec §6 — a
 *   foundation never ranks higher because it has more extensions);
 * - every pooled color is parser-validated and settings-filtered;
 * - structural selection cannot reward extended symbols (spec §16).
 *
 * Everything here is deterministic, dependency-free and framework-free:
 * pure functions over pitch-class facts, recomputed on every call.
 */
import { parseChord, type ParsedChord } from '../../shared/schema/chords';
import { NOTE_NAMES, scalePitchClasses } from '../../shared/schema/modes';
import type { ChordGenSettings, ModeName } from '../../shared/schema/types';
import { buildCandidatePool, type CandidateInfo, type CandidatePool } from './candidates';
import type { CadenceEnvironment, CadenceFamily, CadenceIntention } from './types';
import {
  CHORD_STRUCTURES, getCharacteristicTones, harmonicCharacteristics, resolveTonic,
} from './vocabulary';

/** Structural quality families. 'other' holds what the conventional names
 *  cannot describe (major-third flat-five sonorities, power dyads, no3
 *  chords) — the core pitch classes carry the identity instead. */
export type FoundationQuality =
  | 'major' | 'minor' | 'diminished' | 'augmented' | 'suspended' | 'other';

/** Context-free structural identity of a chord. */
export interface FoundationCore {
  rootPc: number;
  quality: FoundationQuality;
  /** Root + structural third + structural fifth (or fewer for dyads). */
  corePitchClasses: number[];
}

/** Structural identity of one chord inside a key/mode (spec §4 shape). */
export interface HarmonicFoundation extends FoundationCore {
  /** 1-based degree of the root in the mode's scale; null when chromatic. */
  scaleDegree: number | null;
  /** Every CORE tone belongs to the context scale. (A chord may carry
   *  chromatic color while its foundation stays diatonic.) */
  diatonic: boolean;
  /** Share of the mode's characteristic tones present in the core, 0..1. */
  characteristicToneCoverage: number;
}

/* --------------------------------------------------------------------------
 * Foundation derivation
 * ----------------------------------------------------------------------- */

/** Structural third/fifth classes read from the parsed chord's intervals.
 *  Real thirds (3/4) win over suspension tones (2/5) when both exist; the
 *  fifth keeps alterations (6/8) as structural facts. */
function coreFromParsed(chord: ParsedChord): FoundationCore {
  const iv = chord.intervals;
  const thirdIv = iv.includes(3) ? 3 : iv.includes(4) ? 4 : iv.includes(5) ? 5 : iv.includes(2) ? 2 : null;
  const fifthIv = iv.includes(6) ? 6 : iv.includes(7) ? 7 : iv.includes(8) ? 8 : null;
  const pcs = new Set<number>([chord.root % 12]);
  if (thirdIv !== null) pcs.add((chord.root + thirdIv) % 12);
  if (fifthIv !== null) pcs.add((chord.root + fifthIv) % 12);
  const core = [...pcs].sort((a, b) => a - b);

  let quality: FoundationQuality;
  if (thirdIv === 4 && fifthIv === 7) quality = 'major';
  else if (thirdIv === 3 && fifthIv === 7) quality = 'minor';
  else if (thirdIv === 3 && fifthIv === 6) quality = 'diminished';
  else if (thirdIv === 4 && fifthIv === 8) quality = 'augmented';
  else if (thirdIv === 2 || thirdIv === 5) quality = 'suspended';
  else if (thirdIv === 4 && fifthIv === null) quality = 'major';
  else if (thirdIv === 3 && fifthIv === null) quality = 'minor';
  else quality = 'other';

  return { rootPc: ((chord.root % 12) + 12) % 12, quality, corePitchClasses: core };
}

/** Reduce any parseable chord symbol to its structural foundation
 *  (context-free part). Returns null for unparsable symbols. */
export function foundationOf(chord: string | ParsedChord): FoundationCore | null {
  const r = typeof chord === 'string' ? parseChord(chord) : { ok: true as const, chord };
  if (!r.ok) return null;
  return coreFromParsed(r.chord);
}

/** Canonical deterministic foundation id: root pitch class + core tones. */
export function foundationId(core: FoundationCore): string {
  return `${core.rootPc}|${core.corePitchClasses.join('.')}`;
}

/** Human-readable foundation label for diagnostics ("E minor", "D other[F#,A,C]"). */
export function foundationLabel(core: FoundationCore): string {
  const base = `${NOTE_NAMES[core.rootPc]} ${core.quality}`;
  return core.quality === 'other'
    ? `${base}[${core.corePitchClasses.map((p) => NOTE_NAMES[p]).join(',')}]`
    : base;
}

/** Analyze a chord's foundation inside a key/mode (spec §4). */
export function getHarmonicFoundation(
  chord: string | ParsedChord,
  context: { root: number | string; mode: ModeName },
): HarmonicFoundation | null {
  const core = foundationOf(chord);
  if (core === null) return null;
  const tonic = resolveTonic(context.root);
  const scale = scalePitchClasses(tonic, context.mode);
  const scaleSet = new Set(scale);
  const degreeIndex = scale.indexOf(core.rootPc);
  const charTones = getCharacteristicTones(tonic, context.mode);
  const hits = core.corePitchClasses.filter((p) => charTones.includes(p)).length;
  return {
    ...core,
    scaleDegree: degreeIndex >= 0 ? degreeIndex + 1 : null,
    diatonic: core.corePitchClasses.every((p) => scaleSet.has(p)),
    characteristicToneCoverage: charTones.length === 0 ? 0 : hits / charTones.length,
  };
}

/** Two chords share a structural foundation when root AND core agree. */
export function sameHarmonicFoundation(a: FoundationCore, b: FoundationCore): boolean {
  return a.rootPc === b.rootPc
    && a.corePitchClasses.length === b.corePitchClasses.length
    && a.corePitchClasses.every((p, i) => p === b.corePitchClasses[i]);
}

/** True when moving a→b changes the underlying harmony (not just its color). */
export function isStructuralMovement(a: FoundationCore, b: FoundationCore): boolean {
  return !sameHarmonicFoundation(a, b);
}

/* --------------------------------------------------------------------------
 * Foundation relationships — structural facts, no scores
 * ----------------------------------------------------------------------- */

export interface FoundationRelationship {
  /** Directed interval from a's root to b's root, 0..11. */
  rootInterval: number;
  /** Folded interval class, 0..6. */
  intervalClass: number;
  sameRoot: boolean;
  /** Shortest-path direction of the root motion. */
  rootDirection: 'up' | 'down' | 'same';
  /** Core tones present in both foundations. */
  sharedCoreTones: number;
  /** Shared core proportion relative to the smaller core, 0..1. */
  coreCommonRatio: number;
  sameQuality: boolean;
  /** a carries a core tone a semitone below b's root (leading potential). */
  leadingToneIntoB: boolean;
  /** b carries a core tone a semitone below a's root. */
  leadingToneIntoA: boolean;
  /** Same root, different core — a pedal reclassification, not a new root. */
  sameRootDifferentCore: boolean;
}

export function analyzeFoundationRelationship(a: FoundationCore, b: FoundationCore): FoundationRelationship {
  const rootInterval = ((b.rootPc - a.rootPc) % 12 + 12) % 12;
  const intervalClass = Math.min(rootInterval, 12 - rootInterval);
  const setA = new Set(a.corePitchClasses);
  const shared = b.corePitchClasses.filter((p) => setA.has(p));
  const smaller = Math.min(a.corePitchClasses.length, b.corePitchClasses.length) || 1;
  const leadsInto = (from: FoundationCore, toRoot: number) =>
    from.corePitchClasses.some((x) => ((toRoot - x) % 12 + 12) % 12 === 1);
  return {
    rootInterval,
    intervalClass,
    sameRoot: rootInterval === 0,
    rootDirection: rootInterval === 0 ? 'same' : rootInterval <= 6 ? 'up' : 'down',
    sharedCoreTones: shared.length,
    coreCommonRatio: shared.length / smaller,
    sameQuality: a.quality === b.quality,
    leadingToneIntoB: leadsInto(a, b.rootPc),
    leadingToneIntoA: leadsInto(b, a.rootPc),
    sameRootDifferentCore: rootInterval === 0 && !sameHarmonicFoundation(a, b),
  };
}

/** How root motion reads structurally, by interval class — FACTS weighted
 *  later by context, never a transition table. Same root = no movement;
 *  fifths/fourths and steps read as the strongest changes, thirds as moderate
 *  ones, the tritone as unstable. Direction is deliberately NOT weighted
 *  (spec §10: descending fifths are not universally privileged). */
const MOTION_BY_CLASS: Record<number, number> = { 0: 0.12, 1: 0.7, 2: 0.7, 3: 0.62, 4: 0.62, 5: 0.8, 6: 0.6 };

/** How much a foundation quality reads as tonally settled vs unstable — a
 *  descriptive anchor the contextual tension fit consumes, not a goodness
 *  score. Calibrated so NEUTRAL tension contexts favor the tertian norm and
 *  genuinely tension-seeking contexts welcome the floatier qualities. */
const QUALITY_TENSION: Record<FoundationQuality, number> = {
  major: 0.45, minor: 0.5, suspended: 0.7, other: 0.7, diminished: 0.85, augmented: 0.9,
};

/**
 * Mode-relative quality stability, DERIVED from the mode's own vocabulary
 * (never a per-mode table). The mode's TERTIAN backbone — its diatonic
 * third-bearing triads — defines the structural norm, anchored at 1.0 by the
 * tonic triad's own quality; relative frequencies set the rest. Suspended and
 * non-tertian cores are the elaboration register: usable everywhere, but
 * matching the local norm only when the scale genuinely contains such
 * structures diatonically (Whole Tone's 7b5 sonorities, the diminished
 * modes' altered dominants). Ionian's norm is major/minor; Whole Tone's is
 * augmented; Locrian's is diminished — each derived, none hard-coded.
 */
export function deriveQualityStability(tonic: number, mode: ModeName): Record<FoundationQuality, number> {
  const scale = scalePitchClasses(tonic, mode);
  const scaleSet = new Set(scale);
  const qualityOf: Record<string, FoundationQuality> = {
    major: 'major', minor: 'minor', diminished: 'diminished', augmented: 'augmented',
    sus2: 'suspended', sus4: 'suspended', maj7: 'major', minor7: 'minor', dominant7: 'major',
    halfDiminished7: 'diminished', diminished7: 'diminished', minorMajor7: 'minor',
    dominant7b5: 'other', augmented7: 'augmented',
  };
  const triadCounts: Record<FoundationQuality, number> = {
    major: 0, minor: 0, diminished: 0, augmented: 0, suspended: 0, other: 0,
  };
  const native = new Set<FoundationQuality>();
  for (const structure of CHORD_STRUCTURES) {
    const q = qualityOf[structure.id];
    if (q === undefined) continue;
    for (const rootPc of scale) {
      const pcs = structure.intervals.map((iv) => (rootPc + iv) % 12);
      if (!pcs.every((p) => scaleSet.has(p))) continue;
      native.add(q);
      // The tertian backbone counts third-bearing TRIADS only — sevenths
      // project the same cores, and suspensions are measured against the
      // backbone rather than belonging to it.
      if (structure.tier === 'triad' && q !== 'suspended') triadCounts[q] += 1;
    }
  }
  // The tonic triad's own quality anchors the mode's identity.
  let tonicQuality: FoundationQuality = 'major';
  for (const structure of CHORD_STRUCTURES) {
    if (structure.tier !== 'triad') continue;
    const pcs = structure.intervals.map((iv) => (tonic + iv) % 12);
    if (pcs.every((p) => scaleSet.has(p))) { tonicQuality = qualityOf[structure.id]; break; }
  }
  const max = Math.max(triadCounts.major, triadCounts.minor, triadCounts.diminished, triadCounts.augmented, 1);
  const out = {} as Record<FoundationQuality, number>;
  for (const q of Object.keys(triadCounts) as FoundationQuality[]) {
    if (q === tonicQuality) out[q] = 1;
    else if (q === 'suspended' || q === 'other') out[q] = native.has(q) ? 0.5 : 0.15;
    else out[q] = Math.max(0.15, triadCounts[q] / max);
  }
  return out;
}

/** True when the foundation contains the tonic triad well enough to
 *  reinforce the tonal center (root on the tonic, or ≥ 2 shared tones). */
export function reinforcesTonic(f: FoundationCore, tonic: number, tonicTriadPcs: number[]): boolean {
  if (f.rootPc === tonic) return true;
  const set = new Set(f.corePitchClasses);
  return tonicTriadPcs.filter((t) => set.has(t)).length >= 2;
}

/* --------------------------------------------------------------------------
 * Foundation pool — structural candidates grouped from the colored pool
 * ----------------------------------------------------------------------- */

/** One structural destination with every colored realization available under
 *  the current settings. `colors` is always non-empty for pool entries. */
export interface FoundationInfo extends HarmonicFoundation {
  id: string;
  /** Semitone distance from the tonic to the root, 0..11. */
  tonicRelationship: number;
  /** Colored chords realizing this foundation (parser-validated, filtered by
   *  the complexity/borrowing settings — see buildCandidatePool). */
  colors: CandidateInfo[];
  /** Phase 1 descriptive tags over the CORE ('tonic-root', 'covers-all-characteristic-tones'…). */
  tags: string[];
}

export interface FoundationPool {
  tonic: number;
  mode: ModeName;
  symmetric: boolean;
  /** Deterministic order: diatonic (scale-degree order), then borrowed
   *  (root ascending, core ascending). */
  all: FoundationInfo[];
  diatonicCount: number;
  /** Tonic-triad pitch classes (the tonal-reinforcement anchor). */
  tonicTriadPcs: number[];
  /** The tonic-rooted foundation's id, when pooled. */
  tonicFoundationId: string | null;
  /** The tonic triad's own quality — the mode's identity anchor. */
  tonicQuality: FoundationQuality;
  /** Mode-relative quality stability (see deriveQualityStability). */
  qualityStability: Record<FoundationQuality, number>;
}

/**
 * Build the STRUCTURAL pool for a key/mode: group the colored candidate pool
 * (spec §6) by foundation. Complexity and borrowing keep governing which
 * colors exist — they no longer create extra structural candidates. The pool
 * is a grouped SET: nothing ranks a foundation by its extension count.
 */
export function buildFoundationPool(
  key: number,
  mode: ModeName,
  settings: Pick<ChordGenSettings, 'complexity' | 'borrowing'>,
): FoundationPool {
  const colored: CandidatePool = buildCandidatePool(key, mode, settings);
  const tonic = colored.tonic;
  const scale = scalePitchClasses(tonic, mode);
  const scaleSet = new Set(scale);
  const charTones = getCharacteristicTones(tonic, mode);

  const byId = new Map<string, FoundationInfo>();
  for (const c of colored.all) {
    const core = foundationOf(c.symbol);
    if (core === null) continue; // unreachable: pool symbols are parser-validated
    const id = foundationId(core);
    const existing = byId.get(id);
    if (existing) {
      existing.colors.push(c);
      continue;
    }
    const degreeIndex = scale.indexOf(core.rootPc);
    const hits = core.corePitchClasses.filter((p) => charTones.includes(p)).length;
    byId.set(id, {
      id,
      rootPc: core.rootPc,
      quality: core.quality,
      corePitchClasses: core.corePitchClasses,
      scaleDegree: degreeIndex >= 0 ? degreeIndex + 1 : null,
      diatonic: core.corePitchClasses.every((p) => scaleSet.has(p)),
      characteristicToneCoverage: charTones.length === 0 ? 0 : hits / charTones.length,
      tonicRelationship: ((core.rootPc - tonic) % 12 + 12) % 12,
      colors: [c],
      tags: harmonicCharacteristics({
        rootPc: core.rootPc, tonicPc: tonic, pitchClasses: core.corePitchClasses,
        characteristicTones: charTones, symmetric: colored.symmetric,
        isDiatonic: core.corePitchClasses.every((p) => scaleSet.has(p)),
      }),
    });
  }

  const all = [...byId.values()];
  // Deterministic order: diatonic first in scale-degree order, then borrowed
  // by root/core. Grouping never reorders by richness.
  all.sort((a, b) => {
    const da = a.diatonic ? 0 : 1;
    const db = b.diatonic ? 0 : 1;
    if (da !== db) return da - db;
    if (a.diatonic && b.diatonic && a.scaleDegree !== null && b.scaleDegree !== null
      && a.scaleDegree !== b.scaleDegree) return a.scaleDegree - b.scaleDegree;
    if (a.rootPc !== b.rootPc) return a.rootPc - b.rootPc;
    return a.id.localeCompare(b.id);
  });
  const diatonicCount = all.filter((f) => f.diatonic).length;
  const tonicEntry = all.find((f) => f.rootPc === tonic && f.diatonic) ?? null;
  const qualityStability = deriveQualityStability(tonic, mode);

  return {
    tonic,
    mode,
    symmetric: colored.symmetric,
    all,
    diatonicCount,
    tonicTriadPcs: [...colored.tonicTriadPcs],
    tonicFoundationId: tonicEntry?.id ?? null,
    tonicQuality: tonicQualityOf(tonic, mode),
    qualityStability,
  };
}

/** The tonic triad's own quality (first catalog triad constructible on the
 *  tonic within the scale — same derivation order as vocabulary.ts). */
function tonicQualityOf(tonic: number, mode: ModeName): FoundationQuality {
  const scaleSet = new Set(scalePitchClasses(tonic, mode));
  const qualityOf: Record<string, FoundationQuality> = {
    major: 'major', minor: 'minor', diminished: 'diminished', augmented: 'augmented',
    sus2: 'suspended', sus4: 'suspended',
  };
  for (const structure of CHORD_STRUCTURES) {
    if (structure.tier !== 'triad') continue;
    const pcs = structure.intervals.map((iv) => (tonic + iv) % 12);
    if (pcs.every((p) => scaleSet.has(p))) return qualityOf[structure.id];
  }
  return 'other';
}

/** Resolve a foundation to its pool entry (same id first, then same root,
 *  then the tonic entry, then the first entry) so material reuse and anchor
 *  prolongation always obtain a colorable foundation. The returned entry
 *  keeps the SAME id unless no entry matches at all. */
export function poolFoundationOrFallback(pool: FoundationPool, f: FoundationInfo): FoundationInfo {
  const byId = pool.all.find((p) => p.id === f.id);
  if (byId) return byId;
  const sameRoot = pool.all.find((p) => p.rootPc === f.rootPc);
  if (sameRoot) return sameRoot;
  const tonicEntry = pool.tonicFoundationId !== null
    ? pool.all.find((p) => p.id === pool.tonicFoundationId)
    : undefined;
  return tonicEntry ?? pool.all[0];
}

/** A foundation-less anchor (existing chord outside the pool) reduced to a
 *  FoundationInfo with no colors — for structural context only. */
export function foundationInfoFromSymbol(
  symbol: string,
  key: number,
  mode: ModeName,
): FoundationInfo | null {
  const core = foundationOf(symbol);
  if (core === null) return null;
  const scale = scalePitchClasses(key, mode);
  const scaleSet = new Set(scale);
  const charTones = getCharacteristicTones(key, mode);
  const degreeIndex = scale.indexOf(core.rootPc);
  const hits = core.corePitchClasses.filter((p) => charTones.includes(p)).length;
  return {
    id: foundationId(core),
    rootPc: core.rootPc,
    quality: core.quality,
    corePitchClasses: core.corePitchClasses,
    scaleDegree: degreeIndex >= 0 ? degreeIndex + 1 : null,
    diatonic: core.corePitchClasses.every((p) => scaleSet.has(p)),
    characteristicToneCoverage: charTones.length === 0 ? 0 : hits / charTones.length,
    tonicRelationship: ((core.rootPc - key) % 12 + 12) % 12,
    colors: [],
    tags: harmonicCharacteristics({
      rootPc: core.rootPc, tonicPc: key, pitchClasses: core.corePitchClasses,
      characteristicTones: charTones, symmetric: false,
      isDiatonic: core.corePitchClasses.every((p) => scaleSet.has(p)),
    }),
  };
}

/* --------------------------------------------------------------------------
 * Structural scoring — contextual, computed from facts on every call
 * ----------------------------------------------------------------------- */

/** The per-window context structural scoring judges against. Complexity is
 *  deliberately ABSENT: richness is the color stage's decision (spec §5, §16). */
export interface StructuralContext {
  stability: number;
  movement: number;
  tension: number;
  modalPref: number;
  contrastPref: number;
  borrowing: ChordGenSettings['borrowing'];
  role: string;
  pool: FoundationPool;
  env: CadenceEnvironment;
}

/** How much each phrase role wants the tonal center communicated — a soft
 *  contextual weight (like the path evaluator's contact targets), not a
 *  requirement. Contrast/prepare phrases deliberately de-center. */
const CENTER_NEED: Record<string, number> = {
  establish: 1, conclude: 0.9, repeat: 0.7, continue: 0.55, develop: 0.4, prepare: 0.3, contrast: 0.15,
};

/** Named breakdown of `foundationTransitionScore` — the diagnostics layer
 *  reports the ACTUAL components that produced a score, so this decomposition
 *  is the single implementation and the public score delegates to it. Field
 *  values mirror the additions applied inside the function, in order. */
export interface TransitionScoreParts {
  /** Base plausibility every pool foundation receives. */
  base: number;
  /** Opening only: root on the tonic. */
  openingTonic: number;
  /** Opening only: root on the tonic AND quality = the tonic triad's own. */
  openingTonicQuality: number;
  /** Shared structural tones, weighted by the phrase's stability. */
  stabilityFit: number;
  /** Root-change facts, weighted by the phrase's movement. */
  movementFit: number;
  /** Same-foundation prolongation (positive when stable, negative when active). */
  prolongation: number;
  /** Same root, different core (+0.04). */
  pedalReclassification: number;
  /** Leading-tone pull into the candidate. */
  leadingTone: number;
  /** Stepwise root motion under modal emphasis. */
  stepwiseModal: number;
  /** Settled-vs-unstable quality against the phrase's tension. */
  tensionFit: number;
  /** Mode-relative quality stability (the local diatonic norm). */
  qualityStability: number;
  /** Tonal-center reinforcement under the role's center need. */
  tonicReinforcement: number;
  /** Characteristic-tone coverage under modal emphasis. */
  modalColor: number;
  /** Diatonic grading (or the borrowing-shaped chromatic grade). */
  diatonicPreference: number;
  /** Chromatic bonus in contrast/develop roles. */
  roleChromaticBonus: number;
  /** Chromatic bonus when the profile seeks contrast. */
  contrastBonus: number;
  /** Chromatic penalty under strong modal emphasis (may be negative). */
  modalProtect: number;
  /** Chromatic bonus when the core shares a tonic-triad tone. */
  chromaticTonicTone: number;
}

/**
 * How naturally foundation `b` follows `prev` — structural harmony only.
 *
 * Stability and movement are INDEPENDENT dimensions (spec §10): common-tone
 * retention measures smoothness, root change measures motion, and a
 * D7→D13-shaped move (same foundation) now scores as almost no movement at
 * all instead of borrowing "dissonance" from its extensions. Same-foundation
 * continuation is neither banned nor free: stable phrases sustain it (pedal,
 * prolongation), active phrases discourage it — context decides, never a
 * repetition cap.
 *
 * This detailed variant returns the full component breakdown alongside the
 * total; the total is accumulated in EXACTLY the order the historical public
 * score applied it, so `foundationTransitionScore` simply delegates here and
 * diagnostics can report the values that actually produced a decision.
 */
export function foundationTransitionScoreDetailed(
  prev: FoundationInfo | null,
  cand: FoundationInfo,
  ctx: StructuralContext,
): { total: number; parts: TransitionScoreParts } {
  const parts: TransitionScoreParts = {
    base: 0.2, openingTonic: 0, openingTonicQuality: 0, stabilityFit: 0, movementFit: 0,
    prolongation: 0, pedalReclassification: 0, leadingTone: 0, stepwiseModal: 0,
    tensionFit: 0, qualityStability: 0, tonicReinforcement: 0, modalColor: 0,
    diatonicPreference: 0, roleChromaticBonus: 0, contrastBonus: 0, modalProtect: 0,
    chromaticTonicTone: 0,
  };
  let score = parts.base;

  if (prev === null) {
    // Openings lean home, and lean hardest on the mode's OWN tonic triad.
    if (cand.rootPc === ctx.pool.tonic) {
      parts.openingTonic = 0.12;
      score += parts.openingTonic;
      if (cand.quality === ctx.pool.tonicQuality) {
        parts.openingTonicQuality = 0.07;
        score += parts.openingTonicQuality;
      }
    }
  } else {
    const rel = analyzeFoundationRelationship(prev, cand);
    // Stability: shared structural tones.
    const stabilityFit = rel.coreCommonRatio * (0.3 + 0.7 * ctx.stability);
    // Movement: root-change facts — NOT "1 − smoothness". A color-only move
    // (same foundation) reads as almost no structural motion here.
    const motion = rel.sameRoot ? MOTION_BY_CLASS[0] : MOTION_BY_CLASS[rel.intervalClass] ?? 0.6;
    const movementFit = motion * (0.15 + 0.85 * ctx.movement);
    parts.stabilityFit = 0.16 * stabilityFit;
    parts.movementFit = 0.22 * movementFit;
    score += parts.stabilityFit + parts.movementFit;

    // Same-foundation prolongation: welcomed by stability, discouraged by
    // movement — the deliberate-pedal vs accidental-stasis distinction.
    if (cand.id === prev.id) {
      parts.prolongation = 0.12 * ctx.stability - 0.3 * ctx.movement;
      score += parts.prolongation;
    }
    // Same root, different core (e.g. Dm → D): a pedal reclassification.
    if (rel.sameRootDifferentCore) {
      parts.pedalReclassification = 0.04;
      score += parts.pedalReclassification;
    }

    // Leading-tone pull into the candidate, when the phrase wants tension.
    if (rel.leadingToneIntoB) {
      parts.leadingTone = 0.06 * (0.3 + 0.7 * ctx.tension);
      score += parts.leadingTone;
    }

    // Stepwise root motion carries modal flavor (non-symmetrical contexts).
    if (!ctx.pool.symmetric && (rel.intervalClass === 1 || rel.intervalClass === 2)) {
      parts.stepwiseModal = 0.05 * ctx.modalPref;
      score += parts.stepwiseModal;
    }
  }

  // Tension fit: settled vs unstable foundation quality against the phrase
  // (applies to openings too — it needs no preceding harmony).
  const tensionFit = 1 - Math.abs(QUALITY_TENSION[cand.quality] - ctx.tension);
  parts.tensionFit = 0.12 * tensionFit;
  score += parts.tensionFit;

  // Mode-relative quality stability: qualities that are the local diatonic
  // NORM carry the harmony naturally (Ionian's major/minor, Whole Tone's
  // augmented, Locrian's diminished); foreign qualities stay reachable but
  // fit calmer phrases less, and the preference flattens as the phrase
  // genuinely seeks tension. Derived from the mode's own vocabulary —
  // never a per-mode table (spec §6, §16).
  const stability = ctx.pool.qualityStability[cand.quality];
  parts.qualityStability = 0.18 * stability * (1.05 - 0.55 * ctx.tension);
  score += parts.qualityStability;

  // Tonal-center reinforcement (spec §7): foundations that communicate the
  // intended center fit phrases whose role asks for one — weighted by the
  // role's center need and muted in movement-seeking phrases. Never a
  // requirement: every foundation stays reachable in every context.
  const need = CENTER_NEED[ctx.role] ?? 0.5;
  if (reinforcesTonic(cand, ctx.pool.tonic, ctx.pool.tonicTriadPcs)) {
    parts.tonicReinforcement = 0.09 * need * (0.35 + 0.65 * (1 - ctx.movement));
    score += parts.tonicReinforcement;
  }

  // Modal color: carry the mode's characteristic tones when emphasis asks.
  const modalWeight = Math.max(-0.3, ctx.modalPref - 0.35);
  parts.modalColor = 0.18 * cand.characteristicToneCoverage * modalWeight * 2;
  score += parts.modalColor;

  // Diatonic vs borrowed grading — a graded preference, never a prohibition.
  if (cand.diatonic) {
    parts.diatonicPreference = 0.2;
    score += parts.diatonicPreference;
  } else {
    parts.diatonicPreference = ctx.borrowing === 'more' ? 0.16 : 0.05;
    score += parts.diatonicPreference;
    if (ctx.role === 'contrast' || ctx.role === 'develop') {
      parts.roleChromaticBonus = 0.07;
      score += parts.roleChromaticBonus;
    }
    if (ctx.contrastPref >= 0.6) {
      parts.contrastBonus = 0.05;
      score += parts.contrastBonus;
    }
    if (ctx.modalPref >= 0.65) {
      parts.modalProtect = -0.06; // protect modal color from chromatic wash
      score += parts.modalProtect;
    }
    if (cand.corePitchClasses.some((p) => ctx.pool.tonicTriadPcs.includes(p))) {
      parts.chromaticTonicTone = 0.06;
      score += parts.chromaticTonicTone;
    }
  }

  return { total: Math.max(0, score), parts };
}

export function foundationTransitionScore(
  prev: FoundationInfo | null,
  cand: FoundationInfo,
  ctx: StructuralContext,
): number {
  return foundationTransitionScoreDetailed(prev, cand, ctx).total;
}

/**
 * How well foundation `cand` realizes the intended arrival from `prev`
 * (spec §13 — structural arrival FIRST, color later). Property-based, never a
 * cadence dictionary: resolution is read from tonic roots, stable qualities,
 * leading-tone approach and dominant-side preparation — facts derived from
 * the Phase 1 environment. Symmetrical scales resolve through pedal tones,
 * root recurrence and shared structure instead of function.
 */
export function foundationArrivalFit(
  prev: FoundationInfo | null,
  cand: FoundationInfo,
  intention: CadenceIntention,
  ctx: StructuralContext,
): number {
  const tonic = ctx.pool.tonic;
  const stable = cand.quality === 'major' || cand.quality === 'minor';
  const atHome = cand.rootPc === tonic;
  switch (intention) {
    case 'resolved': {
      let fit = atHome && stable
        ? (cand.diatonic ? 1 : 0.85) // the mode's own tonic resolves most fully
        : atHome ? (ctx.pool.symmetric ? 0.7 : 0.5) : 0.15;
      if (prev !== null) {
        const rel = analyzeFoundationRelationship(prev, cand);
        const leadsHome = prev.corePitchClasses.some((x) =>
          ctx.pool.tonicTriadPcs.some((t) => {
            const d = ((t - x) % 12 + 12) % 12;
            return d === 1 || d === 11;
          }));
        if (leadsHome && rel.leadingToneIntoB) fit += 0.3;
        if (ctx.env.dominantAvailable && atHome && prev.rootPc === (tonic + 7) % 12
          && prev.quality === 'major') fit += 0.35;
        if (ctx.pool.symmetric && rel.sharedCoreTones > 0) fit += 0.2;
      }
      return fit;
    }
    case 'open': {
      let fit = 0.5;
      if (atHome && stable) fit -= 0.5; // landing home closes the phrase
      if (cand.tonicRelationship === 5 || cand.tonicRelationship === 7) fit += 0.2;
      if (prev !== null && analyzeFoundationRelationship(prev, cand).leadingToneIntoB) fit += 0.15;
      return Math.max(0, fit);
    }
    case 'suspended': {
      let fit = 0.3;
      if (cand.quality === 'suspended') fit += 0.6;
      if (atHome && cand.quality === 'suspended') fit += 0.2;
      if (prev !== null && analyzeFoundationRelationship(prev, cand).sharedCoreTones >= 2) fit += 0.3;
      return fit;
    }
    case 'transitional': {
      let fit = 0.3;
      if (ctx.env.dominantAvailable && cand.rootPc === (tonic + 7) % 12 && cand.quality === 'major') fit += 0.4;
      if (!atHome) fit += 0.2;
      if (prev !== null && analyzeFoundationRelationship(prev, cand).leadingToneIntoB) fit += 0.2;
      return fit;
    }
    case 'deceptive': {
      let fit = 0.25;
      if (prev !== null && prev.rootPc === (tonic + 7) % 12 && prev.quality === 'major'
        && stable && !atHome) {
        fit += 0.5; // dominant expectation lands on a different stable triad
        if (analyzeFoundationRelationship(prev, cand).sharedCoreTones >= 1) fit += 0.2;
      }
      return fit;
    }
    case 'modal': {
      if (ctx.pool.symmetric) return 0.3; // modal language does not apply here
      let fit = 0.3 + 0.6 * cand.characteristicToneCoverage;
      if (cand.tags.includes('covers-all-characteristic-tones')) fit += 0.3;
      return fit;
    }
    case 'ambiguous': {
      let fit = 0.3;
      const unstable = cand.quality === 'diminished' || cand.quality === 'augmented'
        || cand.quality === 'other' || cand.quality === 'suspended';
      if (ctx.pool.symmetric && unstable) fit += 0.4;
      if (!ctx.pool.symmetric && (cand.quality === 'diminished' || cand.quality === 'suspended'
        || cand.quality === 'other')) fit += 0.3;
      if (!atHome) fit += 0.2;
      return fit;
    }
  }
}

/**
 * Which broad cadence approach the structural a→b arrival realizes — the
 * foundation-level counterpart of the report's family diagnostics (spec §14).
 */
export function realizedFoundationFamily(
  prev: FoundationInfo | null,
  cand: FoundationInfo,
  ctx: StructuralContext,
): CadenceFamily | null {
  if (prev === null) return null;
  if (!cand.diatonic) return 'chromatic';
  const tonic = ctx.pool.tonic;
  if (prev.rootPc === (tonic + 7) % 12 && cand.rootPc === tonic
    && prev.quality === 'major' && ctx.env.dominantAvailable) return 'functional-tonal';
  if (prev.rootPc === (tonic + 5) % 12 && cand.rootPc === tonic && ctx.env.subdominantAvailable) return 'plagal';
  const rel = analyzeFoundationRelationship(prev, cand);
  if ((rel.intervalClass === 1 || rel.intervalClass === 2) && cand.rootPc === tonic) return 'stepwise';
  if (cand.characteristicToneCoverage >= 0.5 && cand.diatonic) return 'modal';
  if (rel.sameRoot) return 'pedal';
  const coloristic = cand.quality === 'diminished' || cand.quality === 'augmented' || cand.quality === 'other';
  if (ctx.pool.symmetric && coloristic) return 'coloristic';
  return null;
}
