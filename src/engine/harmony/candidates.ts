/**
 * Chord candidate selection primitives (Phase 4).
 *
 * The candidate pool is DISCOVERED, not tabulated (spec §6): diatonic chords
 * come from Phase 1's algorithmic vocabulary; extension variants (complexity
 * 3) are derived from diatonic sevenths plus diatonic scale tones; chromatic
 * candidates are discovered through Phase 1's parallel-mode analysis — a
 * non-diatonic chord is borrowable when a related mode of the SAME tonic
 * contains it entirely, which is exactly the fact Phase 1 exposes. There is
 * no transition table anywhere: how well two chords connect is computed from
 * their actual pitch classes, roots and qualities on every evaluation.
 *
 * Scoring is contextual and lightweight (spec §16): smoothness from common
 * tones, motion from root interval, tension from one-semitone pairs — each
 * judged against the phrase's direction parameters, never in isolation.
 * Chromatic harmony is a graded preference shaped by the borrowing setting,
 * phrase role and profile contrast — never a hard quota or prohibition
 * (spec §9). No score floor exists; the search degrades gracefully.
 *
 * Deterministic: pure functions over pitch-class facts. No randomness here —
 * the seeded choice happens in progression.ts among equally strong candidates.
 */
import { parseChord, type ParsedChord } from '../../shared/schema/chords';
import { NOTE_NAMES } from '../../shared/schema/modes';
import { CHORD_STRUCTURES, getChordVocabulary, resolveTonic } from './vocabulary';
import { analyzeChordInMode } from './analysis';
import type { ChordGenSettings, ModeName } from '../../shared/schema/types';
import type {
  CadenceEnvironment, CadenceFamily, CadenceIntention, ChordStructureId,
} from './types';

/** Everything the generator needs to know about one chord candidate. */
export interface CandidateInfo {
  symbol: string;
  rootPc: number;
  /** Sorted unique pitch classes (bass included for slash chords). */
  pcs: number[];
  quality: string;
  tier: 'triad' | 'seventh' | 'extension';
  structureId: ChordStructureId | null;
  /** Every chord tone inside the project mode. */
  diatonic: boolean;
  characteristicToneCoverage: number;
  /** Semitone distance from the tonic to this chord's root. */
  tonicRelationship: number;
  scaleDegree: number | null;
  /** Parallel modes (same tonic) containing every chord tone. */
  parallelModes: ModeName[];
  /** Phase 1 descriptive tags ('tonic-root', 'covers-all-characteristic-tones'…). */
  tags: string[];
}

export interface CandidatePool {
  tonic: number;
  mode: ModeName;
  symmetric: boolean;
  /** Deterministic order: diatonic (vocabulary order), extensions, chromatic. */
  all: CandidateInfo[];
  diatonicCount: number;
  /** Tonic-triad pitch classes (connection anchor for chromatic chords). */
  tonicTriadPcs: number[];
}

const EXTENSION_SUFFIXES: Partial<Record<ChordStructureId, string[]>> = {
  dominant7: ['13', '11', '9'],
  maj7: ['maj13', 'maj11', 'maj9'],
  minor7: ['m13', 'm11', 'm9'],
};

function tierOf(parsed: ParsedChord): CandidateInfo['tier'] {
  if (parsed.extensions.length > 0 && parsed.intervals.length > 4) return 'extension';
  if (parsed.intervals.includes(10) || parsed.intervals.includes(11)) return 'seventh';
  return 'triad';
}

/** Build a CandidateInfo from any parseable chord symbol against a mode. */
export function candidateFromSymbol(symbol: string, tonic: number, mode: ModeName): CandidateInfo | null {
  const r = parseChord(symbol);
  if (!r.ok) return null;
  const a = analyzeChordInMode(r.chord, { root: tonic, mode });
  return {
    symbol: a.symbol,
    rootPc: a.rootPc,
    pcs: [...a.pitchClasses],
    quality: a.quality,
    tier: tierOf(r.chord),
    structureId: null,
    diatonic: a.isDiatonic,
    characteristicToneCoverage: a.characteristicToneCoverage,
    tonicRelationship: a.tonicRelationship,
    scaleDegree: a.scaleDegree,
    parallelModes: [...a.parallelModesContaining],
    tags: [...a.harmonicCharacteristics],
  };
}

/**
 * Build the full candidate pool for a key/mode under the generator settings.
 *
 * - complexity 1 → triads; 2 → triads + sevenths; 3 → also diatonic extension
 *   variants (first diatonic 9/11/13 form of each seventh, tried in a fixed
 *   order — bounded, deterministic).
 * - borrowing 'none' → diatonic only. 'some' → chromatic chords that connect
 *   to the tonic (share a tonic-triad tone or carry a characteristic tone).
 *   'more' → every chromatic chord some parallel mode of the same tonic
 *   contains. Settings shape the POOL; they never mandate usage.
 */
export function buildCandidatePool(
  key: number,
  mode: ModeName,
  settings: Pick<ChordGenSettings, 'complexity' | 'borrowing'>,
): CandidatePool {
  const tonic = resolveTonic(key);
  const vocab = getChordVocabulary({ root: tonic, mode });
  const scaleSet = new Set(vocab.scalePitchClasses);
  const tonicTriadPcs: number[] = [];
  // The diatonic tonic-root chord is the connection anchor; find it in the vocabulary.
  const tonicCandidate = vocab.candidates.find((c) => c.rootPc === tonic);
  if (tonicCandidate) tonicTriadPcs.push(...tonicCandidate.pitchClasses);

  const all: CandidateInfo[] = [];
  const seen = new Set<string>();
  const push = (c: CandidateInfo) => {
    if (seen.has(c.symbol)) return;
    seen.add(c.symbol);
    all.push(c);
  };

  // 1) Diatonic vocabulary, tier-filtered by the complexity setting.
  for (const c of vocab.candidates) {
    const tier: CandidateInfo['tier'] = c.structureId.includes('7') || c.quality === 'm7'
      ? 'seventh' : 'triad';
    if (settings.complexity === 1 && tier !== 'triad') continue;
    push({
      symbol: c.symbol,
      rootPc: c.rootPc,
      pcs: [...c.pitchClasses],
      quality: c.quality,
      tier,
      structureId: c.structureId,
      diatonic: true,
      characteristicToneCoverage: c.characteristicToneCoverage,
      tonicRelationship: c.tonicRelationship,
      scaleDegree: c.scaleDegree,
      parallelModes: [mode],
      tags: [...c.harmonicCharacteristics],
    });
  }
  const diatonicCount = all.length;

  // 2) Extension variants (complexity 3): derive from diatonic sevenths.
  if (settings.complexity === 3) {
    const sevenths = all.filter((c) => c.structureId !== null && EXTENSION_SUFFIXES[c.structureId] !== undefined);
    for (const c of sevenths) {
      const suffixes = EXTENSION_SUFFIXES[c.structureId as ChordStructureId] ?? [];
      for (const suffix of suffixes) {
        const symbol = `${NOTE_NAMES[c.rootPc]}${suffix}`;
        const r = parseChord(symbol);
        if (!r.ok) continue;
        if (!r.chord.pitchClasses.every((p) => scaleSet.has(p))) continue;
        push({
          ...candidateFromSymbol(symbol, tonic, mode)!,
          structureId: null,
        });
        break; // one extension variant per seventh — bounded pool
      }
    }
  }

  // 3) Chromatic (borrowable) candidates via Phase 1 parallel-mode facts.
  if (settings.borrowing !== 'none') {
    for (let root = 0; root < 12; root++) {
      for (const structure of CHORD_STRUCTURES) {
        if (settings.complexity === 1 && structure.tier !== 'triad') continue;
        const pcs = [...new Set(structure.intervals.map((iv) => (root + iv) % 12))].sort((a, b) => a - b);
        if (pcs.every((p) => scaleSet.has(p))) continue; // diatonic — already pooled
        const symbol = `${NOTE_NAMES[root]}${structure.suffix}`;
        const info = candidateFromSymbol(symbol, tonic, mode);
        if (!info) continue;
        if (info.parallelModes.length === 0) continue; // not borrowable from any parallel mode
        if (settings.borrowing === 'some') {
          const connects = pcs.some((p) => tonicTriadPcs.includes(p))
            || pcs.some((p) => vocab.characteristicTones.includes(p));
          if (!connects) continue;
        }
        push(info);
      }
    }
  }

  return {
    tonic,
    mode,
    symmetric: vocab.symmetric,
    all,
    diatonicCount,
    tonicTriadPcs,
  };
}

/* --------------------------------------------------------------------------
 * Relationship facts + contextual scoring (no tables — computed every time)
 * ----------------------------------------------------------------------- */

export interface PairFacts {
  commonToneCount: number;
  /** Shared proportion relative to the smaller chord, 0..1. */
  smoothness: number;
  /** Folded root motion in semitones, 0..6. */
  motion: number;
  /** Directed one-semitone tone pairs from A into B. */
  semitonePairs: number;
  rootInterval: number;
}

export function pairFacts(a: CandidateInfo, b: CandidateInfo): PairFacts {
  const setA = new Set(a.pcs);
  const common = b.pcs.filter((p) => setA.has(p)).length;
  const smaller = Math.min(a.pcs.length, b.pcs.length) || 1;
  let semi = 0;
  for (const x of a.pcs) {
    for (const y of b.pcs) {
      if (x !== y && ((y - x + 12) % 12 === 1 || (x - y + 12) % 12 === 1)) semi++;
    }
  }
  const rootInterval = ((b.rootPc - a.rootPc) % 12 + 12) % 12;
  const folded = Math.min(rootInterval, 12 - rootInterval);
  return {
    commonToneCount: common,
    smoothness: common / smaller,
    motion: folded,
    semitonePairs: semi,
    rootInterval,
  };
}

/** The per-phrase context transition and arrival scoring judge against. */
export interface SelectionContext {
  stability: number;
  movement: number;
  tension: number;
  complexityPref: number;
  modalPref: number;
  contrastPref: number;
  borrowing: ChordGenSettings['borrowing'];
  role: string;
  pool: CandidatePool;
  env: CadenceEnvironment;
}

/**
 * How naturally `b` follows `a`. A weighted blend of Phase 1 relationship
 * facts against the phrase's direction — smooth chords for stable phrases,
 * root motion and tension points for active ones. Chromatic candidates are
 * graded, never excluded: their connection to the tonic, the borrowing
 * setting, the phrase role and the profile's contrast preference decide.
 */
export function transitionScore(a: CandidateInfo | null, b: CandidateInfo, ctx: SelectionContext): number {
  let score = 0.2; // base plausibility — every pool chord stays reachable
  if (a !== null) {
    const f = pairFacts(a, b);
    const stabilityFit = f.smoothness * (0.3 + 0.7 * ctx.stability);
    const movementFit = (1 - f.smoothness) * (0.2 + 0.8 * ctx.movement);
    const tensionFit = 1 - Math.abs(Math.min(1, f.semitonePairs) - ctx.tension);
    score += 0.16 * stabilityFit + 0.2 * movementFit + 0.14 * tensionFit;
    if (a.symbol === b.symbol) score -= 0.25; // immediate repetition is the emit pass's job
  } else {
    score += 0.1 * (b.rootPc === ctx.pool.tonic ? 1 : 0.3); // openings lean home
  }

  if (b.diatonic) {
    score += 0.22;
  } else {
    score += ctx.borrowing === 'more' ? 0.16 : 0.05;
    if (ctx.role === 'contrast' || ctx.role === 'develop') score += 0.07;
    if (ctx.contrastPref >= 0.6) score += 0.05;
    if (ctx.modalPref >= 0.65) score -= 0.06; // protect modal color from chromatic wash
    if (b.pcs.some((p) => ctx.pool.tonicTriadPcs.includes(p))) score += 0.06;
  }

  // Modal color: carry the mode's characteristic tones when emphasis asks.
  const modalWeight = Math.max(-0.3, ctx.modalPref - 0.35);
  score += 0.18 * b.characteristicToneCoverage * modalWeight * 2;

  // Complexity fit: triad ↔ seventh ↔ extension against the profile target.
  const rank = b.tier === 'triad' ? 0 : b.tier === 'seventh' ? 0.5 : 1;
  score += 0.15 * (1 - Math.abs(rank - ctx.complexityPref));

  return Math.max(0, score);
}

/**
 * How well `b` realizes the intended arrival from `a` (spec §8). Property-
 * based, never a cadence dictionary: resolution is read from tonic roots,
 * stable qualities, leading-tone semitone pairs and dominant-side approach —
 * facts derived from Phase 1's environment. Symmetrical scales resolve
 * through pedal tones and repetition instead of function.
 */
export function arrivalFit(
  a: CandidateInfo | null,
  b: CandidateInfo,
  intention: CadenceIntention,
  ctx: SelectionContext,
): number {
  const tonic = ctx.pool.tonic;
  const stableQuality = b.quality === 'major' || b.quality === 'minor';
  const atHome = b.rootPc === tonic;
  switch (intention) {
    case 'resolved': {
      let fit = atHome && stableQuality ? 1 : atHome ? 0.5 : 0.15;
      if (a !== null) {
        const f = pairFacts(a, b);
        // Leading-tone-like resolution: a semitone pair into a tonic-triad tone.
        const leadsHome = a.pcs.some((x) =>
          ctx.pool.tonicTriadPcs.some((t) => ((t - x + 12) % 12 === 1 || (x - t + 12) % 12 === 1)));
        if (leadsHome && f.semitonePairs > 0) fit += 0.3;
        // Dominant-side approach to the tonic (only when the environment supports it).
        if (ctx.env.dominantAvailable && atHome && a.rootPc === (tonic + 7) % 12
          && (a.quality === '7' || a.quality === 'major')) fit += 0.35;
        if (ctx.pool.symmetric && f.commonToneCount > 0) fit += 0.2; // pedal/repetition resolve here
      }
      return fit;
    }
    case 'open': {
      let fit = 0.5;
      if (atHome && stableQuality) fit -= 0.5; // landing home closes the phrase
      if (b.tonicRelationship === 5 || b.tonicRelationship === 7) fit += 0.2;
      if (a !== null && pairFacts(a, b).semitonePairs > 0) fit += 0.15;
      return Math.max(0, fit);
    }
    case 'suspended': {
      let fit = 0.3;
      if (b.quality.includes('sus')) fit += 0.6;
      if (atHome && b.quality.includes('sus')) fit += 0.2;
      if (a !== null && pairFacts(a, b).commonToneCount >= 2) fit += 0.3; // held tones
      return fit;
    }
    case 'transitional': {
      let fit = 0.3;
      if (ctx.env.dominantAvailable && b.rootPc === (tonic + 7) % 12
        && (b.quality === '7' || b.quality === 'major')) fit += 0.4;
      if (!atHome) fit += 0.2;
      if (a !== null && pairFacts(a, b).semitonePairs > 0) fit += 0.2;
      return fit;
    }
    case 'deceptive': {
      let fit = 0.25;
      if (a !== null && a.rootPc === (tonic + 7) % 12 && (a.quality === '7' || a.quality === 'major')
        && stableQuality && !atHome) {
        fit += 0.5; // dominant expectation lands on a different stable triad
        if (pairFacts(a, b).commonToneCount >= 1) fit += 0.2;
      }
      return fit;
    }
    case 'modal': {
      if (ctx.pool.symmetric) return 0.3; // modal language does not apply here
      let fit = 0.3 + 0.6 * b.characteristicToneCoverage;
      if (b.tags.includes('covers-all-characteristic-tones')) fit += 0.3;
      return fit;
    }
    case 'ambiguous': {
      let fit = 0.3;
      const coloristicIds: ReadonlyArray<ChordStructureId> = ['dominant7b5', 'augmented7', 'augmented', 'diminished7', 'halfDiminished7'];
      if (ctx.pool.symmetric && b.structureId !== null && coloristicIds.includes(b.structureId)) fit += 0.4;
      const lowClarity = ['diminished', 'm7b5', 'dim7', 'sus2', 'sus4'].includes(b.quality);
      if (!ctx.pool.symmetric && lowClarity) fit += 0.3;
      if (!atHome) fit += 0.2;
      return fit;
    }
  }
}

/**
 * Which broad cadence approach the actual a→b arrival realizes (spec §14
 * diagnostics + family matching). Derived from transition facts in a fixed
 * deterministic precedence; null when none applies.
 */
export function realizedFamily(
  a: CandidateInfo | null,
  b: CandidateInfo,
  ctx: SelectionContext,
): CadenceFamily | null {
  if (a === null) return null;
  if (!b.diatonic) return 'chromatic';
  const tonic = ctx.pool.tonic;
  if (a.rootPc === (tonic + 7) % 12 && b.rootPc === tonic
    && (a.quality === '7' || a.quality === 'major') && ctx.env.dominantAvailable) {
    return 'functional-tonal';
  }
  if (a.rootPc === (tonic + 5) % 12 && b.rootPc === tonic && ctx.env.subdominantAvailable) return 'plagal';
  const folded = pairFacts(a, b).motion;
  if ((folded === 1 || folded === 2) && b.rootPc === tonic) return 'stepwise';
  if (b.characteristicToneCoverage >= 0.5 && b.diatonic) return 'modal';
  if (a.rootPc === b.rootPc) return 'pedal';
  const coloristicIds: ReadonlyArray<ChordStructureId> = ['dominant7b5', 'augmented7', 'augmented', 'diminished7'];
  if (ctx.pool.symmetric && b.structureId !== null && coloristicIds.includes(b.structureId)) return 'coloristic';
  return null;
}
