/**
 * Harmony generation diagnostics (Phase 4.2) — observational instrumentation
 * that explains WHY the chord generator makes its musical decisions.
 *
 * STRICTLY DIAGNOSTIC (Phase 4.2 spec §2): nothing here selects, scores,
 * prunes or colors anything. Generation behavior is identical with or
 * without a collector; no extra PRNG values are consumed; no candidate is
 * reordered; no score is touched. Every number in a diagnostic report is
 * either (a) recorded from the actual computation while it ran, or (b)
 * recomputed by the SAME single-implementation functions the generator used
 * (foundation.ts / progression.ts detailed variants) — never invented after
 * the fact. Categories the implementation does not have are reported as
 * "Not implemented" rather than synthesized (spec §10).
 *
 * Report shape (spec §5-§12):
 *   meta        — report identity + the honest generation/selection model
 *   context     — everything needed to reproduce the run (key/mode/meter/
 *                 seed/scope/settings/sections/anchors + a project fingerprint)
 *   planning    — resolved section identities, profiles, contours, phrase
 *                 plan (roles/directions/cadences), structural pool
 *   rhythm      — every harmonic slot with the planner's actual continuation
 *                 model stated explicitly
 *   structure   — per-window search traces (beam internals, reuse internals),
 *                 per-slot structural decisions with alternatives, event
 *                 merges, structural cadence realizations
 *   color       — per-event color decisions: variants, actual weights, pick,
 *                 and the objective operation (third/extension/suspension)
 *   transitions — adjacent emitted pairs classified on FOUNDATION identity
 *                 (never on symbol inequality)
 *
 * Plain data only: no functions, no circular references, no async.
 */
import { NOTE_NAMES, MODE_NAMES, scalePitchClasses } from '../../shared/schema/modes';
import { parseChord } from '../../shared/schema/chords';
import { barTicks } from '../../shared/schema/meter';
import { hashString } from '../generate';
import type { Chord, ChordGenSettings, ModeName, Project, Section } from '../../shared/schema/types';
import {
  foundationLabel,
  type FoundationInfo, type FoundationPool, type FoundationQuality,
  type TransitionScoreParts,
} from './foundation';
import type { BeamCandidateTrace, PositionScoreParts, SelectionTrace } from './progression';
import type { ColorVariantTrace } from './color';
import type {
  BoundaryIntention, CadenceFamily, CadenceIntention, PhraseRole, RhythmShape,
  SongHarmonyPlan, SectionHarmonyProfile,
} from './types';
import type { Contour } from './contours';
import type { GenerationScope } from './generation-types';

/* ==========================================================================
 * Report types — plain, JSON-serializable data
 * ======================================================================== */

/** Objective, context-aware description of one foundation (spec §8). */
export interface FoundationFactsRecord {
  id: string;
  label: string;
  rootPc: number;
  rootName: string;
  quality: FoundationQuality;
  corePitchClasses: number[];
  coreNames: string[];
  /** 1-based degree in the mode scale; null when chromatic. */
  scaleDegree: number | null;
  /** Every CORE tone belongs to the context scale. */
  diatonic: boolean;
  nonDiatonicCorePcs: number[];
  nonDiatonicCoreNames: string[];
  /** Parallel modes of the same tonic whose scale contains every core tone
   *  (the borrowing provenance Phase 1 exposes). Includes the context mode. */
  modesContainingCore: ModeName[];
  characteristicToneCoverage: number;
  /** Semitone distance tonic → root, 0..11. */
  tonicRelationship: number;
  tags: string[];
  /** Pooled color variants under the effective settings. */
  colorSymbols: string[];
}

export interface DiagnosticContext {
  engine: string;
  reportVersion: number;
  key: number;
  keyName: string;
  mode: ModeName;
  timeSignature: { numerator: number; denominator: number };
  ppq: number;
  seed: number;
  scope: GenerationScope;
  /** Effective settings (project persisted values merged with overrides). */
  settings: ChordGenSettings;
  region: { startTick: number; endTick: number };
  sections: Array<{
    id: string; name: string; startBar: number; lengthBars: number;
    startTick: number; endTick: number; energy: number; energyExplicit: boolean;
  }>;
  /** Existing chord events at request time (preserved-or-removed candidates). */
  existingChords: Array<{
    id: string; symbol: string; startTick: number; durationTicks: number;
    locked: boolean; insideRegion: boolean;
  }>;
  anchors: {
    /** Preserved anchors sounding immediately before/after the first target. */
    before: string | null;
    after: string | null;
    /** Preserved (protected) chord spans inside the region. */
    protectedSpans: number;
  };
  /** Deterministic hash of the musically relevant project data. Reproducing
   *  a run requires the original project file; the fingerprint is a sanity
   *  check, not a substitute (Phase 4.2 spec §5). Reference audio is never
   *  part of it. */
  projectFingerprint: string;
  fingerprintNote: string;
}

export interface SectionPlanRecord {
  sectionId: string;
  sectionName: string;
  identity: string;
  family: string;
  identityConfidence: number;
  qualifier: 'final' | null;
  energy: number;
  energyExplicit: boolean;
  occurrence: number;
  familyCount: number;
  isRepeated: boolean;
  startBar: number;
  lengthBars: number;
  durationTicks: number;
  isFirst: boolean;
  isLast: boolean;
  precedesMajorTransition: boolean;
  preferences: {
    stability: { preferred: number; flexibility: number };
    movement: { preferred: number; flexibility: number };
    complexity: { preferred: number; flexibility: number };
    tension: { preferred: number; flexibility: number };
    modalEmphasis: { preferred: number; flexibility: number };
    contrast: { preferred: number; flexibility: number };
    rhythm: { preferredChangesPerBar: number; flexibility: number; shape: RhythmShape };
  };
  contours: { tension: Contour; rhythm: Contour; complexity: Contour };
  development: { role: string; relatedSectionIds: string[] };
  boundary: { toSectionId: string; intention: BoundaryIntention } | null;
}

export interface PhrasePlanRecord {
  id: string;
  sectionId: string;
  index: number;
  startBar: number;
  lengthBars: number;
  startTick: number;
  durationTicks: number;
  role: PhraseRole;
  direction: { stability: number; movement: number; tension: number };
  cadence: { intention: CadenceIntention; compatibleFamilies: CadenceFamily[] };
  relatedPhraseIds: string[];
}

export interface PoolRecord {
  tonic: number;
  tonicName: string;
  mode: ModeName;
  symmetric: boolean;
  size: number;
  diatonicCount: number;
  tonicQuality: FoundationQuality;
  /** Mode-relative quality stability (derived, per foundation.ts). */
  qualityStability: Record<FoundationQuality, number>;
  foundations: FoundationFactsRecord[];
  /** The pruning configuration that governed structural search. */
  searchParams: { beamWidth: number; successorsPerBeam: number; maxPerSignature: number; strongCutoff: number };
}

export interface RhythmSlotRecord {
  slotIndex: number;
  startTick: number;
  durationTicks: number;
  windowIndex: number;
  phraseId: string | null;
  sectionId: string | null;
  /** 0-based position within its phrase window's slot list. */
  positionInPhrase: number;
  phraseSlotCount: number;
  /** Last slot of its window (the planned arrival point). */
  phraseEnd: boolean;
  preference: { changesPerBar: number; shape: RhythmShape };
  /** MODEL FACT (Phase 4.2 spec §7): the rhythm planner always assigns
   *  exactly one foundation per slot — continuation is never a rhythm-time
   *  option. It exists only as (a) the structural selector re-choosing the
   *  same foundation, or (b) the event-merging layer folding same-foundation
   *  slot runs into one sustained event. */
  plannerForcesNewFoundation: true;
  /** The selector chose the same foundation as the previous slot. */
  continuationRealizedStructurally: boolean;
  /** This slot was folded into the previous slot's sustained event. */
  mergedIntoPreviousEvent: boolean;
  /** Sustained harmony: structurally continued OR merged. */
  previousHarmonySustained: boolean;
  newFoundationSelected: boolean;
}

export interface WindowRecord {
  targetIndex: number;
  windowIndex: number;
  startTick: number;
  endTick: number;
  sectionId: string | null;
  /** Null for synthetic windows (spans no planned phrase covers). */
  phraseId: string | null;
  synthetic: boolean;
  role: PhraseRole;
  direction: { stability: number; movement: number; tension: number };
  cadenceIntention: CadenceIntention;
  compatibleFamilies: CadenceFamily[];
  arrivalPlanned: boolean;
  isSectionStart: boolean;
  boundaryIntoNext: BoundaryIntention | null;
  relatedPhraseIds: string[];
  prefs: {
    stability: number; movement: number; complexity: number; tension: number;
    modal: number; contrast: number; changesPerBar: number; shape: RhythmShape;
  };
  slotCount: number;
  /** Full selection trace (beam internals / reuse internals / path evaluation). */
  selection: SelectionTrace | null;
}

/** One structural decision (spec §8) — objective facts + the actual scores. */
export interface StructuralSlotRecord {
  targetIndex: number;
  slotIndex: number;
  startTick: number;
  durationTicks: number;
  windowIndex: number;
  phraseId: string | null;
  sectionId: string | null;
  positionInPhrase: number;
  phraseEnd: boolean;
  selected: FoundationFactsRecord;
  previousFoundation: string | null;
  relationshipToPrevious: {
    rootInterval: number;
    /** Signed root motion in semitones (+ up, − down, 0 same). */
    rootMovementSemitones: number;
    rootDirection: 'up' | 'down' | 'same';
    sharedCoreTones: number;
    coreCommonRatio: number;
    sameQuality: boolean;
    leadingToneIntoCandidate: boolean;
    sameRootDifferentCore: boolean;
  } | null;
  structuralRole: 'opening' | 'middle' | 'arrival' | 'forced-sustain';
  repeatsPreviousFoundation: boolean;
  rootChange: boolean;
  /** First chromatic foundation after a diatonic one (a departure). */
  chromaticDeparture: boolean;
  phraseRole: PhraseRole;
  cadenceIntention: CadenceIntention | null;
  /** Actual scoring components of the SELECTED candidate in its own beam
   *  expansion (null on the reuse path, after a forced first slot / develop
   *  override, or when not traced). */
  selectedCandidateScores: {
    /** Cumulative score through this candidate along its own beam — the
     *  value that ranked it. Comparable only within the same expansion. */
    total: number;
    parentScore: number;
    transition: number;
    position: number;
    loopPenalty: number;
    jitter: number;
    rankInExpansion: number;
    /** Transition-score component breakdown (same implementation as the
     *  generator — recomputed exactly, never approximated). */
    transitionParts: TransitionScoreParts | null;
    /** Position-score component breakdown (opening fit / arrival fit /
     *  cadence-family compatibility). */
    positionParts: PositionScoreParts | null;
  } | null;
  /** Strongest alternatives from the SAME beam expansion (the actual
   *  contest the selected candidate was part of). */
  alternatives: Array<{
    label: string;
    total: number;
    rank: number;
    keptAsSuccessor: boolean;
    admitted: boolean;
    survivedToNextBeam: boolean;
    selected: boolean;
    rejectedBy: 'successor-cut' | 'beam-width' | 'signature-cap' | null;
  }>;
  mergedWithNext: boolean;
}

export interface MergeRecord {
  eventIndex: number;
  startTick: number;
  durationTicks: number;
  slotCount: number;
  foundation: string;
  withinWindow: boolean;
  crossWindow: boolean;
}

export interface CadenceRealizationRecord {
  phraseId: string | null;
  sectionId: string | null;
  startTick: number;
  intention: CadenceIntention;
  family: CadenceFamily | null;
  arrivalFoundation: string;
  previousFoundation: string | null;
}

export interface ColorOperationRecord {
  tier: 'triad' | 'seventh' | 'extension' | 'basic' | 'unparsed';
  thirdPreserved: boolean;
  /** A suspension tone replaced the structural third. */
  thirdReplaced: boolean;
  /** Neither third nor suspension present (power sonority). */
  thirdOmitted: boolean;
  extensionAdded: boolean;
  suspensionIntroduced: boolean;
  chromaticNotesIntroduced: boolean;
  nonDiatonicPcs: string[];
}

export interface ColorDecisionRecord {
  eventIndex: number;
  startTick: number;
  durationTicks: number;
  foundationId: string;
  foundationLabel: string;
  /** Pool entry the color was resolved to (differs only for anchor-derived
   *  foundations outside the settings' palette). */
  resolvedFoundationId: string | null;
  symbol: string;
  availableColors: ColorVariantTrace[];
  pickedIndex: number | null;
  basicFallback: boolean;
  complexityPref: number;
  modalPref: number;
  variation: number;
  isArrival: boolean;
  intention: CadenceIntention | null;
  role: string;
  /** How many slots this event sustains (1 = single slot). */
  slotCount: number;
  operation: ColorOperationRecord;
}

export interface TransitionRecord {
  index: number;
  fromSymbol: string;
  toSymbol: string;
  fromFoundation: string;
  toFoundation: string;
  sameFoundation: boolean;
  /** 'exact-repetition' | 'color-variation' | 'structural-movement' —
   *  classified on FOUNDATION identity, never on symbol inequality. */
  classification: 'exact-repetition' | 'color-variation' | 'structural-movement';
  rootChange: boolean;
  rootInterval: number | null;
  rootMovementSemitones: number | null;
  /** A preserved chord stands between the two generated events. */
  separatedByPreserved: boolean;
}

export interface HarmonyDiagnosticReport {
  meta: {
    engine: 'crescode-harmony-diagnostics';
    version: 1;
    /** Honest statement of what produced the chords (Phase 4.2 spec §9). */
    generationModel: 'two-stage: structural foundation selection, then harmonic color';
    selectionModel: 'complete-path beam search — a chord is selected because its PATH won, not because it won its slot locally';
  };
  context: DiagnosticContext;
  planning: {
    sections: SectionPlanRecord[];
    phrases: PhrasePlanRecord[];
    pool: PoolRecord;
  };
  rhythm: {
    /** Honest continuation-model note (see RhythmSlotRecord). */
    continuationModelNote: string;
    slots: RhythmSlotRecord[];
  };
  structure: {
    windows: WindowRecord[];
    slots: StructuralSlotRecord[];
    merges: MergeRecord[];
    cadences: CadenceRealizationRecord[];
  };
  color: ColorDecisionRecord[];
  transitions: TransitionRecord[];
  warnings: string[];
}

/* ==========================================================================
 * Fact helpers — objective derivations only
 * ======================================================================== */

/** Parallel modes of the same tonic whose scale contains every given pc.
 *  The context mode appears naturally when the pcs are diatonic to it —
 *  never fabricated for chromatic chords. */
function modesContainingPcs(tonic: number, pcs: number[]): ModeName[] {
  const out: ModeName[] = [];
  for (const mode of MODE_NAMES) {
    const scale = new Set(scalePitchClasses(tonic, mode));
    if (pcs.every((p) => scale.has(p))) out.push(mode);
  }
  return out;
}

/** Objective facts for one foundation inside the project key/mode. */
export function foundationFactsRecord(
  f: FoundationInfo,
  key: number,
  mode: ModeName,
): FoundationFactsRecord {
  const scale = new Set(scalePitchClasses(key, mode));
  const nonDiatonic = f.corePitchClasses.filter((p) => !scale.has(p));
  return {
    id: f.id,
    label: foundationLabel(f),
    rootPc: f.rootPc,
    rootName: NOTE_NAMES[f.rootPc],
    quality: f.quality,
    corePitchClasses: [...f.corePitchClasses],
    coreNames: f.corePitchClasses.map((p) => NOTE_NAMES[p]),
    scaleDegree: f.scaleDegree,
    diatonic: f.diatonic,
    nonDiatonicCorePcs: nonDiatonic,
    nonDiatonicCoreNames: nonDiatonic.map((p) => NOTE_NAMES[p]),
    modesContainingCore: modesContainingPcs(key, f.corePitchClasses),
    characteristicToneCoverage: f.characteristicToneCoverage,
    tonicRelationship: f.tonicRelationship,
    tags: [...f.tags],
    colorSymbols: f.colors.map((c) => c.symbol),
  };
}

/** Signed root motion in semitones from an interval class + direction. */
export function signedRootMovement(interval: number): number {
  if (interval === 0) return 0;
  return interval <= 6 ? interval : interval - 12;
}

/** Deterministic fingerprint of the musically relevant project data. */
export function projectFingerprint(project: Project): string {
  const basis = {
    schemaVersion: project.schemaVersion,
    name: project.name,
    bpm: project.bpm,
    timeSignature: project.timeSignature,
    key: project.key,
    mode: project.mode,
    sections: project.sections,
    chords: project.chords,
    chordGenSettings: project.chordGenSettings ?? null,
  };
  return hashString(JSON.stringify(basis)).toString(16).padStart(8, '0');
}

/* ==========================================================================
 * Classifier — what the color stage DID to a foundation (objective)
 * ======================================================================== */

/** Classify the objective relationship between a foundation and the final
 *  chord symbol that realizes it (Phase 4.2 spec §11). Parse-based facts
 *  about the actual outcome — no scores, no invented explanation. */
export function classifyColorOperation(
  symbol: string,
  foundation: FoundationInfo,
  scalePcs: number[],
  tier: 'triad' | 'seventh' | 'extension' | 'basic',
): ColorOperationRecord {
  const parsed = parseChord(symbol);
  if (!parsed.ok) {
    return {
      tier: 'unparsed', thirdPreserved: false, thirdReplaced: false, thirdOmitted: false,
      extensionAdded: false, suspensionIntroduced: false, chromaticNotesIntroduced: false,
      nonDiatonicPcs: [],
    };
  }
  const chord = parsed.chord;
  const pcSet = new Set(chord.pitchClasses);
  const scaleSet = new Set(scalePcs);
  const root = foundation.rootPc;
  // The foundation's structural third (tertian foundations only).
  const thirdPc = foundation.quality === 'major' ? (root + 4) % 12
    : foundation.quality === 'minor' ? (root + 3) % 12
      : foundation.quality === 'diminished' ? (root + 3) % 12
        : foundation.quality === 'augmented' ? (root + 4) % 12
          : null;
  const susPcs = [2, 5].map((iv) => (root + iv) % 12);
  const thirdPreserved = thirdPc !== null && pcSet.has(thirdPc);
  const hasSus = susPcs.some((p) => pcSet.has(p));
  const thirdReplaced = !thirdPreserved && thirdPc !== null && hasSus;
  const thirdOmitted = !thirdPreserved && !hasSus;
  const suspensionIntroduced = !thirdPreserved && hasSus
    && foundation.quality !== 'suspended';
  const nonDiatonicPcs = chord.pitchClasses.filter((p) => !scaleSet.has(p));
  return {
    tier,
    thirdPreserved,
    thirdReplaced,
    thirdOmitted,
    extensionAdded: tier === 'extension' || chord.extensions.length > 0,
    suspensionIntroduced,
    chromaticNotesIntroduced: nonDiatonicPcs.length > 0,
    nonDiatonicPcs: nonDiatonicPcs.map((p) => NOTE_NAMES[p]),
  };
}

/* ==========================================================================
 * Collector — created only when diagnostics are requested
 * ======================================================================== */

export interface DiagnosticInit {
  project: Project;
  settings: ChordGenSettings;
  seed: number;
  scope: GenerationScope;
  regionStart: number;
  regionEnd: number;
  pool: FoundationPool;
  profiles: SectionHarmonyProfile[];
  plan: SongHarmonyPlan;
  anchorBefore: string | null;
  anchorAfter: string | null;
  protectedSpans: number;
  warnings: string[];
  /** Number of preserved (kept) chord events. */
  preservedCount: number;
}

/** Build a collector whose report already carries the full context and
 *  planning layers (Phase 4.2 spec §5, §6). Pure data assembly. */
export function createDiagnosticCollector(init: DiagnosticInit): { report: HarmonyDiagnosticReport } {
  const { project, settings, seed, scope, pool } = init;
  const bt = barTicks(project.timeSignature);

  const sections: DiagnosticContext['sections'] = project.sections.map((s: Section) => ({
    id: s.id,
    name: s.name,
    startBar: s.startBar,
    lengthBars: s.lengthBars,
    startTick: (s.startBar - 1) * bt,
    endTick: (s.startBar - 1 + s.lengthBars) * bt,
    energy: s.energy ?? 0.5,
    energyExplicit: s.energy !== undefined,
  }));

  const existingChords: DiagnosticContext['existingChords'] = project.chords.map((c: Chord) => ({
    id: c.id,
    symbol: c.symbol,
    startTick: c.startTick,
    durationTicks: c.durationTicks,
    locked: c.locked === true,
    insideRegion: c.startTick >= init.regionStart && c.startTick < init.regionEnd,
  }));

  const sectionRecords: SectionPlanRecord[] = init.profiles.map((p) => {
    const plannedSection = init.plan.sections.find((s) => s.sectionId === p.sectionId);
    return {
    sectionId: p.sectionId,
    sectionName: p.sectionName,
    identity: p.identity,
    family: p.family,
    identityConfidence: p.context.confidence,
    qualifier: p.context.qualifier,
    energy: p.context.energy,
    energyExplicit: p.context.energyExplicit,
    occurrence: p.context.occurrence,
    familyCount: p.context.familyCount,
    isRepeated: p.context.isRepeated,
    startBar: p.context.startBar,
    lengthBars: p.context.lengthBars,
    durationTicks: p.context.durationTicks,
    isFirst: p.context.isFirst,
    isLast: p.context.isLast,
    precedesMajorTransition: p.context.precedesMajorTransition,
    preferences: {
      stability: { preferred: p.preferences.stability.preferred, flexibility: p.preferences.stability.flexibility },
      movement: { preferred: p.preferences.movement.preferred, flexibility: p.preferences.movement.flexibility },
      complexity: { preferred: p.preferences.complexity.preferred, flexibility: p.preferences.complexity.flexibility },
      tension: { preferred: p.preferences.tension.preferred, flexibility: p.preferences.tension.flexibility },
      modalEmphasis: { preferred: p.preferences.modalEmphasis.preferred, flexibility: p.preferences.modalEmphasis.flexibility },
      contrast: { preferred: p.preferences.contrast.preferred, flexibility: p.preferences.contrast.flexibility },
      rhythm: {
        preferredChangesPerBar: p.preferences.rhythm.preferredChangesPerBar,
        flexibility: p.preferences.rhythm.flexibility,
        shape: p.preferences.rhythm.shape,
      },
    },
    contours: {
      tension: { ...p.contours.tension },
      rhythm: { ...p.contours.rhythm },
      complexity: { ...p.contours.complexity },
    },
    development: { role: p.development.role, relatedSectionIds: [...p.development.relatedSectionIds] },
    boundary: plannedSection?.boundary
      ? { toSectionId: plannedSection.boundary.toSectionId, intention: plannedSection.boundary.intention }
      : null,
  };
  });

  const phraseRecords: PhrasePlanRecord[] = init.plan.sections.flatMap((s) =>
    s.phrases.map((ph) => ({
      id: ph.id,
      sectionId: ph.sectionId,
      index: ph.index,
      startBar: ph.startBar,
      lengthBars: ph.lengthBars,
      startTick: ph.startTick,
      durationTicks: ph.durationTicks,
      role: ph.role,
      direction: { ...ph.direction },
      cadence: { intention: ph.cadence.intention, compatibleFamilies: [...ph.cadence.compatibleFamilies] },
      relatedPhraseIds: [...ph.relatedPhraseIds],
    })));

  const poolRecord: PoolRecord = {
    tonic: pool.tonic,
    tonicName: NOTE_NAMES[pool.tonic],
    mode: pool.mode,
    symmetric: pool.symmetric,
    size: pool.all.length,
    diatonicCount: pool.diatonicCount,
    tonicQuality: pool.tonicQuality,
    qualityStability: { ...pool.qualityStability },
    foundations: pool.all.map((f) => foundationFactsRecord(f, project.key, project.mode)),
    searchParams: { beamWidth: 8, successorsPerBeam: 4, maxPerSignature: 2, strongCutoff: 0.12 },
  };

  const report: HarmonyDiagnosticReport = {
    meta: {
      engine: 'crescode-harmony-diagnostics',
      version: 1,
      generationModel: 'two-stage: structural foundation selection, then harmonic color',
      selectionModel: 'complete-path beam search — a chord is selected because its PATH won, not because it won its slot locally',
    },
    context: {
      engine: 'crescode-harmony',
      reportVersion: 1,
      key: project.key,
      keyName: NOTE_NAMES[project.key],
      mode: project.mode,
      timeSignature: { ...project.timeSignature },
      ppq: 960,
      seed,
      scope,
      settings: { ...settings },
      region: { startTick: init.regionStart, endTick: init.regionEnd },
      sections,
      existingChords,
      anchors: {
        before: init.anchorBefore,
        after: init.anchorAfter,
        protectedSpans: init.protectedSpans,
      },
      projectFingerprint: projectFingerprint(project),
      fingerprintNote: 'Deterministic hash of the musically relevant project data. Reproducing this run requires the original project file; reference audio is never fingerprinted.',
    },
    planning: {
      sections: sectionRecords,
      phrases: phraseRecords,
      pool: poolRecord,
    },
    rhythm: {
      continuationModelNote: 'The rhythm planner assigns exactly one foundation per slot; there is no explicit sustain decision at rhythm time. Continuation exists only as (a) the structural selector re-choosing the same foundation, or (b) the event-merging layer folding same-foundation slot runs into one sustained event.',
      slots: [],
    },
    structure: { windows: [], slots: [], merges: [], cadences: [] },
    color: [],
    transitions: [],
    warnings: [...init.warnings],
  };

  return { report };
}

/* ==========================================================================
 * Post-processing — alternatives extraction from a selection trace
 * ======================================================================== */

/** Strongest alternatives from the SAME beam expansion the selected candidate
 *  competed in (the actual local contest, within the honest complete-path
 *  model: totals are cumulative path scores, comparable inside the expansion). */
export function extractAlternatives(
  trace: SelectionTrace | null,
  slotIndex: number,
  limit = 8,
): StructuralSlotRecord['alternatives'] {
  const beam = trace?.beam;
  const slot = beam?.slots[slotIndex];
  if (!slot) return [];
  const chosen = slot.candidates.find((c) => c.selected);
  const parent = chosen ? chosen.parentBeamIndex : 0;
  let group = slot.candidates.filter((c) => c.parentBeamIndex === parent);
  if (group.length === 0) group = slot.candidates.filter((c) => c.parentBeamIndex === 0);
  return [...group]
    .sort((a, b) => a.rankInExpansion - b.rankInExpansion)
    .slice(0, limit)
    .map((c: BeamCandidateTrace) => ({
      label: c.label,
      total: c.total,
      rank: c.rankInExpansion,
      keptAsSuccessor: c.keptAsSuccessor,
      admitted: c.admitted,
      survivedToNextBeam: c.survivedToNextBeam,
      selected: c.selected,
      rejectedBy: c.notAdmittedReason,
    }));
}

/* ==========================================================================
 * Transition classification (spec §12) — on FOUNDATION identity
 * ======================================================================== */

/** Classify one adjacent pair of generated events. Uses the Phase 4.1
 *  foundation model: symbol inequality alone NEVER implies movement. */
export function classifyTransition(
  fromSymbol: string,
  fromFoundation: FoundationInfo | null,
  toSymbol: string,
  toFoundation: FoundationInfo | null,
  separatedByPreserved: boolean,
): TransitionRecord {
  const sameFoundation = fromFoundation !== null && toFoundation !== null
    && fromFoundation.id === toFoundation.id;
  let classification: TransitionRecord['classification'];
  if (sameFoundation) {
    classification = fromSymbol === toSymbol ? 'exact-repetition' : 'color-variation';
  } else {
    classification = 'structural-movement';
  }
  const rootChange = fromFoundation !== null && toFoundation !== null
    && fromFoundation.rootPc !== toFoundation.rootPc;
  const rootInterval = fromFoundation !== null && toFoundation !== null
    ? ((toFoundation.rootPc - fromFoundation.rootPc) % 12 + 12) % 12
    : null;
  return {
    index: 0,
    fromSymbol,
    toSymbol,
    fromFoundation: fromFoundation ? foundationLabel(fromFoundation) : '?',
    toFoundation: toFoundation ? foundationLabel(toFoundation) : '?',
    sameFoundation,
    classification,
    rootChange,
    rootInterval,
    rootMovementSemitones: rootInterval !== null ? signedRootMovement(rootInterval) : null,
    separatedByPreserved,
  };
}

/* ==========================================================================
 * Serialization (spec §13A) — validated plain JSON
 * ======================================================================== */

/** Verify the report contains nothing unserializable (functions, circular
 *  references, symbols), then return pretty-printed JSON. */
export function serializeHarmonyDiagnostics(report: HarmonyDiagnosticReport): string {
  const seen = new Set<unknown>();
  const check = (node: unknown): void => {
    if (node === null || typeof node !== 'object') {
      const t = typeof node;
      if (t === 'function' || t === 'symbol' || t === 'undefined') {
        throw new Error(`Unserializable value in diagnostic report: ${t}`);
      }
      return;
    }
    if (seen.has(node)) throw new Error('Circular reference in diagnostic report');
    seen.add(node);
    for (const value of Object.values(node)) check(value);
    seen.delete(node);
  };
  check(report);
  return JSON.stringify(report, null, 2);
}
