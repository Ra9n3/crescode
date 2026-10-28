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

/* ==========================================================================
 * Phase 2 — Section harmony profiles (planning descriptions, not decisions)
 * ==========================================================================
 *
 * Everything below describes HOW harmony may behave in a section and across
 * a song: identity, structural context, flexible dimension preferences,
 * contours and repetition relationships. Nothing here selects, places or
 * modifies chords, and nothing here is visible UI state. All numeric
 * preferences are INTERNAL PLANNING PARAMETERS (spec §6) — normalized
 * conveniences that shape the possibility space for later phases, not
 * measurements of musical emotion.
 */

/** Coarse structural family a section name resolves to. 'unknown' = no
 *  recognized identity — fully supported, treated neutrally. */
export type SectionFamily =
  | 'intro' | 'verse' | 'prechorus' | 'chorus' | 'build' | 'bridge'
  | 'breakdown' | 'outro' | 'instrumental' | 'interlude' | 'solo'
  | 'transition' | 'reprise' | 'unknown';

/** Specific normalized identity. Finer than the family: 'coda' shares the
 *  'outro' family, 'reprise' may share the family it reprises. */
export type SectionIdentity = SectionFamily | 'coda';

/** Result of recognizing one section name. */
export interface ResolvedSectionIdentity {
  identity: SectionIdentity;
  family: SectionFamily;
  /** 'final' when the name carries a final/last qualifier ("Final Chorus"). */
  qualifier: 'final' | null;
  /** Occurrence number written in the name ("Verse 2" → 2), when present. */
  explicitOccurrence: number | null;
  /** 0 = unrecognized (neutral), 0.95 = single clear keyword,
   *  0.7 = several conflicting keywords (best guess kept). */
  confidence: number;
}

/** One neighboring section as seen from the analyzed section. */
export interface NeighborSummary {
  sectionId: string;
  name: string;
  identity: SectionIdentity;
  family: SectionFamily;
  energy: number;
}

/** Where a section sits in the arrangement. Pure facts plus the resolved
 *  identity — no harmonic decisions. */
export interface SectionContext {
  sectionId: string;
  name: string;
  identity: SectionIdentity;
  family: SectionFamily;
  qualifier: 'final' | null;
  confidence: number;
  /** 1-based position within this section's relationship group (explicit
   *  numbering in the name wins; otherwise chronological order). */
  occurrence: number;
  /** How many sections share this section's relationship group. */
  familyCount: number;
  /** The family occurs more than once — related material exists. */
  isRepeated: boolean;
  startBar: number;
  lengthBars: number;
  /** Inclusive last bar (startBar + lengthBars - 1). */
  endBar: number;
  durationBars: number;
  /** lengthBars × barTicks(project.timeSignature) — meter-aware. */
  durationTicks: number;
  /** Resolved energy: the section's own value, else neutral 0.5. */
  energy: number;
  /** Whether the section carried an explicit energy value. */
  energyExplicit: boolean;
  /** Section start/center/end normalized over the song's section span. */
  normalizedPosition: { start: number; center: number; end: number };
  isFirst: boolean;
  isLast: boolean;
  /** Normalized center ≤ 0.2 / ≥ 0.8. */
  nearBeginning: boolean;
  nearEnd: boolean;
  previous: NeighborSummary | null;
  next: NeighborSummary | null;
  /** energy minus previous energy (null when no previous section). */
  energyDeltaFromPrevious: number | null;
  /** next energy minus energy (null when no next section). */
  energyDeltaToNext: number | null;
  /** The next section changes family, or the energy jumps by ≥ 0.3 — a
   *  factual structural boundary, not a prescription to build. */
  precedesMajorTransition: boolean;
}

/** A flexible preference: a general target plus how far behavior may range
 *  around it. `preferred` is 0..1 (internal planning parameter); `flexibility`
 *  describes the allowed spread, not a hard clamp for later phases. */
export interface HarmonicPreference {
  preferred: number;
  flexibility: number;
}

/** Shape of harmonic activity a section tends toward. A descriptor for the
 *  future generator — NOT a chord-duration template. */
export type RhythmShape =
  | 'hold' | 'regular' | 'mixed' | 'accelerating' | 'decelerating' | 'periodic';

/** Meter-aware harmonic-rhythm preference. `preferredChangesPerBar` is bar-
 *  relative; the interval fields are derived through the project's actual
 *  meter utilities (barTicks / felt beats), never by assuming 4/4. */
export interface HarmonicRhythmPreference {
  preferredChangesPerBar: number;
  /** Allowed spread in changes-per-bar units. */
  flexibility: number;
  /** barTicks / preferredChangesPerBar — concrete ticks in THIS meter. */
  preferredChangeIntervalTicks: number;
  /** Felt beats between changes (beatsPerBar / preferredChangesPerBar). */
  preferredChangeIntervalBeats: number;
  shape: RhythmShape;
}

export type DevelopmentRole = 'establish' | 'repeat' | 'develop' | 'contrast';

/** Repetition/development description for one section. */
export interface SectionDevelopment {
  role: DevelopmentRole;
  /** Other sections sharing the relationship group, chronological. */
  relatedSectionIds: string[];
}

/** Meter facts read from the project — so later phases never re-derive them
 *  and never assume 4/4. */
export interface SectionMeterFacts {
  timeSignature: { numerator: number; denominator: number };
  barTicks: number;
  beatTicks: number;
  /** Felt beats per bar (compound meters group pulses in threes). */
  beatsPerBar: number;
  compound: boolean;
}

/** The complete Phase-2 planning description of one section. */
export interface SectionHarmonyProfile {
  sectionId: string;
  sectionName: string;
  identity: SectionIdentity;
  family: SectionFamily;
  context: SectionContext;
  meter: SectionMeterFacts;
  preferences: {
    stability: HarmonicPreference;
    movement: HarmonicPreference;
    rhythm: HarmonicRhythmPreference;
    complexity: HarmonicPreference;
    tension: HarmonicPreference;
    modalEmphasis: HarmonicPreference;
    contrast: HarmonicPreference;
  };
  /** How each dimension may evolve across the section. Any dimension may
   *  carry a contour — tension is not privileged. */
  contours: {
    tension: import('./contours').Contour;
    rhythm: import('./contours').Contour;
    complexity: import('./contours').Contour;
  };
  development: SectionDevelopment;
}
