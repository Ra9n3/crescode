/**
 * Harmony vocabulary types (Phase 1 — knowledge, not decisions).
 *
 * Pure data contracts for the harmonic knowledge layer. No React, no store,
 * no UI, no progression logic. Pitch classes are 0..11 with C = 0, matching
 * src/shared/schema/types.ts. Nothing here assigns musical "goodness" —
 * every field is a descriptive, objectively derivable fact.
 */
import type { ModeName } from '../../shared/schema/types';

/** Context for every vocabulary/analysis call. */
export interface HarmonyContext {
  /** Tonic: pitch class 0..11 (0 = C), or a bare note name ('D', 'Eb', 'F#'). */
  root: number | string;
  mode: ModeName;
}

/** Structures the vocabulary can construct from scale notes. */
export type ChordStructureId =
  | 'major' | 'minor' | 'diminished' | 'augmented'
  | 'sus2' | 'sus4'
  | 'maj7' | 'minor7' | 'dominant7'
  | 'halfDiminished7' | 'diminished7' | 'minorMajor7'
  | 'dominant7b5' | 'augmented7';

/** A fundamental interval formula plus the symbol suffix that round-trips
 *  through the existing chord parser (src/shared/schema/chords.ts). */
export interface ChordStructure {
  id: ChordStructureId;
  /** Semitone intervals above the root, ascending, first is 0. */
  intervals: number[];
  /** Symbol suffix appended after the root name (e.g. 'm7' for "Dm7"). */
  suffix: string;
  /** Quality label aligned with the chord parser's quality names. */
  quality: string;
  tier: 'triad' | 'seventh';
}

/** One chord candidate discovered in a mode. Descriptive only — later phases
 *  decide what to do with this information. */
export interface HarmonicCandidate {
  /** Parser-compatible chord symbol (e.g. "Dm7", "F#m7b5", "Bbmaj7"). */
  symbol: string;
  /** Chord root, 0..11 (0 = C). */
  rootPc: number;
  /** Chord pitch classes, sorted ascending, unique. */
  pitchClasses: number[];
  /** Structure identifier from the interval-formula catalog. */
  structureId: ChordStructureId;
  /** Quality label aligned with the chord parser's quality names. */
  quality: string;
  /** 1-based position of the root in the mode's ascending scale order.
   *  Null when the root is not a scale tone (never the case for
   *  vocabulary entries, which are discovered from scale tones). */
  scaleDegree: number | null;
  /** True when every chord tone belongs to the context scale. Always true
   *  for vocabulary entries; the field keeps the shape uniform with
   *  analyzeChordInMode output. */
  isDiatonic: boolean;
  /** Share of the mode's characteristic tones present in this chord, 0..1.
   *  0 when the mode has no characteristic tones (symmetrical scales). */
  characteristicToneCoverage: number;
  /** Semitone distance from the context tonic to the chord root, 0..11. */
  tonicRelationship: number;
  /** Descriptive, non-evaluative tags (see vocabulary.ts). */
  harmonicCharacteristics: string[];
}

/** The complete harmonic vocabulary of one key/mode. */
export interface ChordVocabulary {
  /** Resolved tonic pitch class 0..11. */
  rootPc: number;
  mode: ModeName;
  /** Scale pitch classes in ascending interval order from the tonic. */
  scalePitchClasses: number[];
  /** True for the symmetrical modes (Whole Tone, both Diminished scales). */
  symmetric: boolean;
  /** Pitch classes that distinguish this mode from its nearest relatives.
   *  Empty for symmetrical scales — tonal characteristic tones do not apply
   *  there, and the `symmetric` flag says so explicitly. */
  characteristicTones: number[];
  /** Diatonic chord candidates discovered from the scale. Deterministic
   *  order: scale-degree order, then catalog order. */
  candidates: HarmonicCandidate[];
}

/** Objective analysis of one chord against one key/mode. */
export interface ChordModeAnalysis {
  symbol: string;
  /** Chord root, 0..11. */
  rootPc: number;
  /** All chord pitch classes (bass included for slash chords), sorted ascending. */
  pitchClasses: number[];
  /** Quality label from the existing chord parser. */
  quality: string;
  scalePitchClasses: number[];
  isDiatonic: boolean;
  /** Chord tones outside the context scale, sorted ascending. */
  nonDiatonicPitchClasses: number[];
  /** 1-based degree of the chord root in the scale, null when the root is
   *  not a scale tone. */
  scaleDegree: number | null;
  /** Semitone distance from tonic to chord root, 0..11. */
  tonicRelationship: number;
  /** Mode characteristic tones present in the chord. */
  characteristicTonesPresent: number[];
  characteristicToneCoverage: number;
  /** Pitch classes shared with the mode's diatonic tonic triad. */
  tonicChordSharedPitchClasses: number[];
  /** Parallel modes (same tonic) whose scale contains every chord tone,
   *  in MODE_NAMES order. Includes the context mode itself when the chord
   *  is diatonic to it. */
  parallelModesContaining: ModeName[];
  harmonicCharacteristics: string[];
}

/** A directed one-semitone motion between a tone of chord A and a tone of
 *  chord B — a potential half-step resolution point. */
export interface SemitonePair {
  /** Pitch class in chord A. */
  from: number;
  /** Pitch class in chord B, one semitone away from `from`. */
  to: number;
}

/** Objective description of the relationship between two chords. No scores. */
export interface ChordRelationship {
  /** Semitone distance from A's root to B's root, 0..11. */
  rootInterval: number;
  /** Pitch classes present in both chords, sorted ascending. */
  sharedPitchClasses: number[];
  commonToneCount: number;
  /** Pitch classes entering with chord B (not in A). */
  addedPitchClasses: number[];
  /** Pitch classes leaving with chord A (not in B). */
  removedPitchClasses: number[];
  /** Directed tone pairs (a in A, b in B) one semitone apart, sorted.
   *  Objective voice-leading tension points, not resolution rules. */
  semitoneRelationships: SemitonePair[];
  /** The two chords carry different quality labels. */
  qualitiesDiffer: boolean;
  /** Same root and same pitch-class content. */
  identical: boolean;
  /** Same pitch-class content but a different root (symmetrical-scale
   *  twins, e.g. Bdim7 vs Ddim7). */
  enharmonicallyEquivalent: boolean;
}
