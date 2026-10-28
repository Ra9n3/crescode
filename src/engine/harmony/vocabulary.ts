/**
 * Harmonic vocabulary engine (Phase 1).
 *
 * Answers "what harmonic possibilities exist in this musical context?" —
 * never "which chord must come next?". Chords are DISCOVERED algorithmically
 * from a scale's pitch classes and a catalog of fundamental interval formulas;
 * nothing here stores per-mode chord tables or progression rules.
 *
 * Spec adaptation: the brief suggested `src/orchestrator/harmony/`; this
 * repository keeps framework-free algorithmic code under `src/engine/`,
 * so the module lives here. Reuses src/shared/schema/modes.ts (mode
 * definitions, NOTE_NAMES) — no duplicated scale data, no new dependencies,
 * no React/Zustand imports.
 *
 * Determinism: every function is pure; identical inputs produce identical
 * outputs. No caching (the computation is trivially cheap — measuring
 * comes before caching).
 */
import { MODES, MODE_NAMES, NOTE_NAMES, scalePitchClasses } from '../../shared/schema/modes';
import type { ModeName } from '../../shared/schema/types';
import type {
  ChordStructure, ChordVocabulary, HarmonicCandidate, HarmonyContext,
} from './types';

/**
 * Fundamental chord-structure interval formulas. These are interval
 * definitions (like the scale definitions they are tested against), not
 * compositional rules. A structure only enters a vocabulary when ALL of its
 * tones belong to the selected scale. The two altered dominants exist because
 * they are the only seventh structures the symmetrical Whole Tone scale
 * contains; they are discovered like everything else, never special-cased.
 */
export const CHORD_STRUCTURES: readonly ChordStructure[] = [
  { id: 'major', intervals: [0, 4, 7], suffix: '', quality: 'major', tier: 'triad' },
  { id: 'minor', intervals: [0, 3, 7], suffix: 'm', quality: 'minor', tier: 'triad' },
  { id: 'diminished', intervals: [0, 3, 6], suffix: 'dim', quality: 'diminished', tier: 'triad' },
  { id: 'augmented', intervals: [0, 4, 8], suffix: 'aug', quality: 'augmented', tier: 'triad' },
  { id: 'sus2', intervals: [0, 2, 7], suffix: 'sus2', quality: 'sus2', tier: 'triad' },
  { id: 'sus4', intervals: [0, 5, 7], suffix: 'sus4', quality: 'sus4', tier: 'triad' },
  { id: 'maj7', intervals: [0, 4, 7, 11], suffix: 'maj7', quality: 'maj7', tier: 'seventh' },
  { id: 'minor7', intervals: [0, 3, 7, 10], suffix: 'm7', quality: 'm7', tier: 'seventh' },
  { id: 'dominant7', intervals: [0, 4, 7, 10], suffix: '7', quality: '7', tier: 'seventh' },
  { id: 'halfDiminished7', intervals: [0, 3, 6, 10], suffix: 'm7b5', quality: 'm7b5', tier: 'seventh' },
  { id: 'diminished7', intervals: [0, 3, 6, 9], suffix: 'dim7', quality: 'dim7', tier: 'seventh' },
  { id: 'minorMajor7', intervals: [0, 3, 7, 11], suffix: 'mMaj7', quality: 'mMaj7', tier: 'seventh' },
  { id: 'dominant7b5', intervals: [0, 4, 6, 10], suffix: '7b5', quality: '7b5', tier: 'seventh' },
  { id: 'augmented7', intervals: [0, 4, 8, 10], suffix: 'aug7', quality: 'aug7', tier: 'seventh' },
];

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Resolve a context tonic to a pitch class. Accepts 0..11 or bare note
 *  names with single accidentals ('D', 'Eb', 'C#', 'Bb', unicode too). */
export function resolveTonic(root: number | string): number {
  if (typeof root === 'number') {
    if (!Number.isInteger(root) || root < 0 || root > 11) {
      throw new Error(`harmony: tonic pitch class out of range: ${root}`);
    }
    return root;
  }
  const m = /^([A-Ga-g])(#|b|♯|♭)?$/.exec(root.trim());
  if (!m) throw new Error(`harmony: cannot parse tonic "${root}"`);
  let pc = LETTER_PC[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

/** Scale pitch classes for a context, in ascending interval order from the
 *  tonic (thin validation wrapper over the schema function). */
export function getScalePitchClasses(root: number | string, mode: ModeName): number[] {
  if (!MODE_NAMES.includes(mode)) throw new Error(`harmony: unknown mode "${mode}"`);
  return scalePitchClasses(resolveTonic(root), mode);
}

/** True when transposing the pitch-class set by some nonzero interval maps it
 *  onto itself (Whole Tone: +2, Diminished scales: +3). Fully derived — no
 *  hardcoded mode list. Symmetrical scales are the ones where tonal
 *  characteristic tones and functional labels do not apply. */
export function isSymmetricScale(pitchClasses: number[]): boolean {
  const set = new Set(pitchClasses);
  for (let k = 1; k < 12; k++) {
    if (pitchClasses.every((p) => set.has((p + k) % 12))) return true;
  }
  return false;
}

const symmetricDiffSize = (a: Set<number>, b: Set<number>): number => {
  let n = 0;
  for (const x of a) if (!b.has(x)) n++;
  for (const x of b) if (!a.has(x)) n++;
  return n;
};

/**
 * Characteristic tone INTERVALS of a mode (tonic-invariant), derived by scale
 * comparison — not a table of unrelated preferences.
 *
 * Derivation: compare the mode against its nearest relatives — every
 * non-symmetrical mode of the same cardinality sharing the same third degree
 * (minor-third modes vs minor-third modes, major-third vs major-third). The
 * nearest relatives are those with the smallest symmetric difference; the
 * mode's characteristic tones are the tones it carries that its nearest
 * relatives lack. Symmetrical scales return [] — the `symmetric` flag on the
 * vocabulary states that ambiguity explicitly instead of inventing one.
 *
 * Spot checks (interval space): Dorian vs {Aeolian, Melodic Minor} → {9, 10};
 * Phrygian vs {Aeolian, Locrian} → {1, 7}; Lydian vs Ionian → {6}; Mixolydian
 * vs Ionian → {10}; Harmonic Minor vs {Aeolian, Melodic Minor} → {8, 11};
 * Melodic Minor vs {Harmonic Minor, Dorian} → {9, 11}.
 */
export function getCharacteristicToneIntervals(mode: ModeName): number[] {
  if (!MODE_NAMES.includes(mode)) throw new Error(`harmony: unknown mode "${mode}"`);
  const intervals = MODES[mode];
  if (isSymmetricScale(intervals)) return [];
  // Same third degree + same cardinality + non-symmetrical = comparable relative.
  const third = intervals[2];
  const pool = MODE_NAMES.filter((m) => {
    if (m === mode) return false;
    const iv = MODES[m];
    return iv.length === intervals.length && !isSymmetricScale(iv) && iv[2] === third;
  });
  const mine = new Set(intervals);
  const minDiff = Math.min(...pool.map((m) => symmetricDiffSize(mine, new Set(MODES[m]))));
  const tones = new Set<number>();
  for (const m of pool) {
    if (symmetricDiffSize(mine, new Set(MODES[m])) !== minDiff) continue;
    for (const i of intervals) if (!MODES[m].includes(i)) tones.add(i);
  }
  return [...tones].sort((a, b) => a - b);
}

/** Characteristic tones of a mode as pitch classes for the given tonic,
 *  sorted ascending. */
export function getCharacteristicTones(root: number | string, mode: ModeName): number[] {
  const tonic = resolveTonic(root);
  return getCharacteristicToneIntervals(mode)
    .map((i) => (tonic + i) % 12)
    .sort((a, b) => a - b);
}

/**
 * Descriptive tags shared by vocabulary candidates and chord analysis.
 * Tags state facts; they never grade. Order is deterministic.
 */
export function harmonicCharacteristics(opts: {
  rootPc: number;
  tonicPc: number;
  pitchClasses: number[];
  characteristicTones: number[];
  symmetric: boolean;
  isDiatonic: boolean;
}): string[] {
  const tags: string[] = [];
  if (opts.rootPc === opts.tonicPc) tags.push('tonic-root');
  const hits = opts.pitchClasses.filter((p) => opts.characteristicTones.includes(p));
  if (hits.length > 0) tags.push('contains-characteristic-tones');
  if (opts.characteristicTones.length > 0 && hits.length === opts.characteristicTones.length) {
    tags.push('covers-all-characteristic-tones');
  }
  if (opts.symmetric) tags.push('non-tonal-context');
  if (!opts.isDiatonic) tags.push('non-diatonic');
  return tags;
}

/** The mode's diatonic tonic triad: the first catalog triad constructible
 *  from the tonic within the scale (major → minor → dim → aug → sus2 → sus4).
 *  Deterministic; null only for a scale with no triad on its tonic (cannot
 *  happen for the twelve Crescode modes). */
export function tonicTriadPcs(scalePitchClassesInTonicOrder: number[]): number[] | null {
  const set = new Set(scalePitchClassesInTonicOrder);
  const tonic = scalePitchClassesInTonicOrder[0];
  for (const s of CHORD_STRUCTURES) {
    if (s.tier !== 'triad') continue;
    const pcs = s.intervals.map((iv) => (tonic + iv) % 12);
    if (pcs.every((p) => set.has(p))) return pcs;
  }
  return null;
}

/**
 * Discover the harmonic vocabulary of one key/mode.
 *
 * For every scale tone (in scale-degree order) and every catalog structure,
 * the chord is included exactly when all of its tones belong to the scale.
 * Handles 7-note modes, the 6-note Whole Tone scale and the 8-note
 * Diminished scales uniformly — cardinality is never assumed.
 */
export function getChordVocabulary(context: HarmonyContext): ChordVocabulary {
  const tonic = resolveTonic(context.root);
  const scale = getScalePitchClasses(tonic, context.mode);
  const scaleSet = new Set(scale);
  const symmetric = isSymmetricScale(scale);
  const characteristicTones = getCharacteristicTones(tonic, context.mode);

  const candidates: HarmonicCandidate[] = [];
  const seen = new Set<string>();
  scale.forEach((rootPc, degreeIndex) => {
    for (const structure of CHORD_STRUCTURES) {
      const pcs = [...new Set(structure.intervals.map((iv) => (rootPc + iv) % 12))]
        .sort((a, b) => a - b);
      if (!pcs.every((p) => scaleSet.has(p))) continue;
      const key = `${rootPc}:${structure.id}`;
      if (seen.has(key)) continue; // defensive; (root, structure) pairs are unique by construction
      seen.add(key);
      const hits = pcs.filter((p) => characteristicTones.includes(p));
      candidates.push({
        symbol: `${NOTE_NAMES[rootPc]}${structure.suffix}`,
        rootPc,
        pitchClasses: pcs,
        structureId: structure.id,
        quality: structure.quality,
        scaleDegree: degreeIndex + 1,
        isDiatonic: true,
        characteristicToneCoverage:
          characteristicTones.length === 0 ? 0 : hits.length / characteristicTones.length,
        tonicRelationship: ((rootPc - tonic) % 12 + 12) % 12,
        harmonicCharacteristics: harmonicCharacteristics({
          rootPc, tonicPc: tonic, pitchClasses: pcs,
          characteristicTones, symmetric, isDiatonic: true,
        }),
      });
    }
  });

  return {
    rootPc: tonic,
    mode: context.mode,
    scalePitchClasses: [...scale],
    symmetric,
    characteristicTones,
    candidates,
  };
}
