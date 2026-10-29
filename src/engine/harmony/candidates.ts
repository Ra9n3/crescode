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
import type { ChordStructureId } from './types';

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
 * Colored pair facts (used by the color stage and diagnostics)
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
