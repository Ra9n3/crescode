/**
 * Harmonic analysis (Phase 1) — objective facts about chords in a mode and
 * about chord-to-chord relationships. Pure functions over the existing chord
 * parser (src/shared/schema/chords.ts); no scoring, no progression rules,
 * no UI. Every emitted fact is derived from pitch-class mathematics and the
 * scale-comparison helpers in vocabulary.ts.
 */
import { parseChord, type ParsedChord } from '../../shared/schema/chords';
import { MODE_NAMES, scalePitchClasses } from '../../shared/schema/modes';
import type { ModeName } from '../../shared/schema/types';
import {
  getCharacteristicTones, getScalePitchClasses, harmonicCharacteristics,
  isSymmetricScale, resolveTonic, tonicTriadPcs,
} from './vocabulary';
import type { ChordModeAnalysis, ChordRelationship, HarmonyContext, SemitonePair } from './types';

/** Accept a chord symbol or an already-parsed chord; parse and fail loudly
 *  on invalid input (deterministic — a bad symbol is a programming error,
 *  not a runtime condition). */
function toParsed(chord: string | ParsedChord, fn: string): ParsedChord {
  if (typeof chord !== 'string') return chord;
  const r = parseChord(chord);
  if (!r.ok) throw new Error(`${fn}: ${r.error}`);
  return r.chord;
}

const sortedUnique = (pcs: number[]): number[] => [...new Set(pcs)].sort((a, b) => a - b);

/**
 * Analyze one chord against a key/mode. Describes scale membership, the
 * mode's characteristic tones carried by the chord, its relationship to the
 * tonic, and — crucially for chromatic harmony — which PARALLEL modes (same
 * tonic) contain the chord entirely. Borrowing is never decided here; the
 * facts are simply made available. Example: Bbmaj7 in D Dorian is
 * non-diatonic (Bb outside), and discovered as contained by D Phrygian,
 * D Aeolian and D Harmonic Minor.
 */
export function analyzeChordInMode(chord: string | ParsedChord, context: HarmonyContext): ChordModeAnalysis {
  const parsed = toParsed(chord, 'analyzeChordInMode');
  const tonic = resolveTonic(context.root);
  const scale = getScalePitchClasses(tonic, context.mode);
  const scaleSet = new Set(scale);
  const pcs = sortedUnique(parsed.pitchClasses);
  const nonDiatonic = pcs.filter((p) => !scaleSet.has(p));
  const isDiatonic = nonDiatonic.length === 0;
  const symmetric = isSymmetricScale(scale);
  const characteristicTones = getCharacteristicTones(tonic, context.mode);
  const present = characteristicTones.filter((c) => pcs.includes(c));
  const tonicTriad = tonicTriadPcs(scale);
  const degreeIndex = scale.indexOf(parsed.root);
  const parallelModesContaining = MODE_NAMES.filter((m) => {
    const s = scalePitchClasses(tonic, m);
    return pcs.every((p) => s.includes(p));
  });

  return {
    symbol: parsed.symbol,
    rootPc: parsed.root,
    pitchClasses: pcs,
    quality: parsed.quality,
    scalePitchClasses: [...scale],
    isDiatonic,
    nonDiatonicPitchClasses: nonDiatonic,
    scaleDegree: degreeIndex >= 0 ? degreeIndex + 1 : null,
    tonicRelationship: ((parsed.root - tonic) % 12 + 12) % 12,
    characteristicTonesPresent: present,
    characteristicToneCoverage:
      characteristicTones.length === 0 ? 0 : present.length / characteristicTones.length,
    tonicChordSharedPitchClasses: tonicTriad ? pcs.filter((p) => tonicTriad.includes(p)) : [],
    parallelModesContaining: parallelModesContaining as ModeName[],
    harmonicCharacteristics: harmonicCharacteristics({
      rootPc: parsed.root, tonicPc: tonic, pitchClasses: pcs,
      characteristicTones, symmetric, isDiatonic,
    }),
  };
}

/**
 * Describe the relationship between two chords — root interval, common
 * tones, pitch-class changes, one-semitone tension points, quality delta.
 * Deliberately returns NO quality score; later phases decide what matters.
 */
export function analyzeChordRelationship(
  chordA: string | ParsedChord,
  chordB: string | ParsedChord,
): ChordRelationship {
  const a = toParsed(chordA, 'analyzeChordRelationship');
  const b = toParsed(chordB, 'analyzeChordRelationship');
  const pcsA = sortedUnique(a.pitchClasses);
  const pcsB = sortedUnique(b.pitchClasses);
  const shared = pcsA.filter((p) => pcsB.includes(p));
  const added = pcsB.filter((p) => !pcsA.includes(p));
  const removed = pcsA.filter((p) => !pcsB.includes(p));

  const pairs: SemitonePair[] = [];
  const seen = new Set<string>();
  for (const x of pcsA) {
    for (const y of pcsB) {
      if (x === y) continue;
      const distance = Math.min(((y - x) % 12 + 12) % 12, ((x - y) % 12 + 12) % 12);
      if (distance !== 1) continue;
      const key = `${x}>${y}`;
      if (!seen.has(key)) { seen.add(key); pairs.push({ from: x, to: y }); }
    }
  }
  pairs.sort((p, q) => p.from - q.from || p.to - q.to);

  const sameContent = added.length === 0 && removed.length === 0;
  const identical = a.root === b.root && sameContent;
  return {
    rootInterval: ((b.root - a.root) % 12 + 12) % 12,
    sharedPitchClasses: shared,
    commonToneCount: shared.length,
    addedPitchClasses: added,
    removedPitchClasses: removed,
    semitoneRelationships: pairs,
    qualitiesDiffer: a.quality !== b.quality,
    identical,
    enharmonicallyEquivalent: sameContent && !identical,
  };
}
