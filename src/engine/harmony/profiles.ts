/**
 * Section harmony profiles (Phase 2) — the planning layer between Phase 1's
 * harmonic vocabulary and the future progression generator.
 *
 * WHAT THIS IS: a context-sensitive description of how harmony may behave in
 * each section — independent dimensions (stability, movement, rhythm,
 * complexity, tension, modal emphasis, contrast), flexible preferences
 * (target + flexibility), evolution contours, and repetition/development
 * relationships. Built from the section's resolved identity, its structural
 * context, the section's own energy, the project meter and the user's
 * persistent generator settings.
 *
 * WHAT THIS IS NOT (spec §13): a dictionary of section presets. Identity
 * contributes only SMALL INTERPRETABLE BIASES (≤ ~0.15 around the neutral
 * anchor) which are then shifted by context, energy and settings — the same
 * identity in different songs produces meaningfully different profiles, and
 * `sectionAware: false` collapses the identity influence to a residual.
 * No code path maps a section name to fixed harmonic values.
 *
 * ENERGY INTEGRATION (spec §9): the section's own optional `energy` field is
 * one contextual influence among several. It nudges movement, rhythm and —
 * deliberately WEAKLY — tension (±0.04 at full energy swing on tension vs
 * ±0.6 on the energy value itself). There is no `tension = energy` mapping
 * anywhere; stability, modal emphasis and contrast are not energy-driven at
 * all. Documented influence factors live in ENERGY_INFLUENCE below.
 *
 * Deterministic: pure functions over (project, sectionId). No randomness, no
 * caching, no async. Builds nothing but descriptions — no chords are
 * selected, placed or modified, and nothing here touches the manual editor,
 * the orchestral generator or the UI.
 */
import {
  DEFAULT_CHORDGEN_SETTINGS, type ChordGenSettings, type Project,
} from '../../shared/schema/types';
import { barTicks, beatOffsets, beatTicks, isCompound } from '../../shared/schema/meter';
import type {
  Contour, ContourFamily,
} from './contours';
import { contourRangeForPreference } from './contours';
import {
  analyzeSectionContext, relationshipKey, resolveSectionIdentity, sectionsInOrder,
} from './context';
import type {
  DevelopmentRole, HarmonicPreference, HarmonicRhythmPreference,
  RhythmShape, SectionContext, SectionHarmonyProfile, SectionIdentity,
} from './types';


/* --------------------------------------------------------------------------
 * Identity tendencies — broad, interpretable biases (spec §13), NOT presets
 * ----------------------------------------------------------------------- */

export interface IdentityTendency {
  /** Deltas applied to the neutral 0.5 anchor of each dimension. */
  stability: number;
  movement: number;
  complexity: number;
  tension: number;
  modalEmphasis: number;
  contrast: number;
  /** Delta on the settings-derived changes-per-bar target. */
  rhythmDelta: number;
  /** Preferred activity shape (a descriptor, not a template). */
  shape: RhythmShape;
  /** Preferred contour family per dimension. */
  contours: { tension: ContourFamily; rhythm: ContourFamily; complexity: ContourFamily };
}

const allStable = { tension: 'stable', rhythm: 'stable', complexity: 'stable' } as const;

/**
 * The complete tendency table — deliberately small biases. Every number here
 * is a starting nudge that context, energy and settings can push around; a
 * "sparse, harmonically restrained chorus" (spec §1A) remains reachable
 * because flexibility stays wide and no value is ever dictated.
 */
export const IDENTITY_TENDENCIES: Record<SectionIdentity, IdentityTendency> = {
  intro: {
    stability: 0.10, movement: -0.06, complexity: -0.04, tension: -0.08,
    modalEmphasis: 0.06, contrast: 0, rhythmDelta: -0.4, shape: 'hold',
    contours: { tension: 'stable', rhythm: 'stable', complexity: 'stable' },
  },
  verse: {
    stability: 0.07, movement: 0, complexity: -0.02, tension: 0,
    modalEmphasis: 0.03, contrast: -0.02, rhythmDelta: 0, shape: 'regular',
    contours: { ...allStable },
  },
  prechorus: {
    stability: -0.04, movement: 0.08, complexity: 0.02, tension: 0.10,
    modalEmphasis: 0, contrast: 0.02, rhythmDelta: 0.3, shape: 'mixed',
    contours: { tension: 'rising', rhythm: 'stable', complexity: 'stable' },
  },
  chorus: {
    stability: 0.10, movement: -0.02, complexity: -0.04, tension: 0.04,
    modalEmphasis: 0.10, contrast: 0.04, rhythmDelta: 0, shape: 'regular',
    contours: { ...allStable },
  },
  build: {
    stability: -0.06, movement: 0.10, complexity: 0.04, tension: 0.12,
    modalEmphasis: 0, contrast: 0.04, rhythmDelta: 0.8, shape: 'accelerating',
    contours: { tension: 'rising', rhythm: 'rising', complexity: 'stable' },
  },
  bridge: {
    stability: -0.08, movement: 0.10, complexity: 0.08, tension: 0.04,
    modalEmphasis: -0.04, contrast: 0.10, rhythmDelta: 0.2, shape: 'mixed',
    contours: { tension: 'wave', rhythm: 'stable', complexity: 'arch' },
  },
  breakdown: {
    stability: -0.04, movement: -0.04, complexity: -0.08, tension: -0.04,
    modalEmphasis: 0.04, contrast: 0.08, rhythmDelta: -0.6, shape: 'hold',
    contours: { tension: 'valley', rhythm: 'stable', complexity: 'stable' },
  },
  outro: {
    stability: 0.08, movement: -0.08, complexity: -0.06, tension: -0.10,
    modalEmphasis: 0.04, contrast: -0.04, rhythmDelta: -0.5, shape: 'decelerating',
    contours: { tension: 'falling', rhythm: 'falling', complexity: 'stable' },
  },
  coda: {
    stability: 0.10, movement: -0.08, complexity: -0.06, tension: -0.10,
    modalEmphasis: 0.04, contrast: -0.06, rhythmDelta: -0.5, shape: 'decelerating',
    contours: { tension: 'falling', rhythm: 'falling', complexity: 'stable' },
  },
  instrumental: {
    stability: 0.02, movement: 0, complexity: 0.02, tension: 0,
    modalEmphasis: 0, contrast: 0, rhythmDelta: 0, shape: 'regular',
    contours: { ...allStable },
  },
  interlude: {
    stability: 0, movement: 0.05, complexity: 0.04, tension: 0,
    modalEmphasis: 0, contrast: 0.05, rhythmDelta: 0.2, shape: 'mixed',
    contours: { ...allStable },
  },
  solo: {
    stability: 0, movement: 0.06, complexity: 0.06, tension: 0.05,
    modalEmphasis: 0, contrast: 0.06, rhythmDelta: 0.2, shape: 'mixed',
    contours: { tension: 'stable', rhythm: 'stable', complexity: 'arch' },
  },
  transition: {
    stability: -0.05, movement: 0.08, complexity: 0, tension: 0.06,
    modalEmphasis: 0, contrast: 0, rhythmDelta: 0.5, shape: 'accelerating',
    contours: { tension: 'rising', rhythm: 'rising', complexity: 'stable' },
  },
  reprise: {
    stability: 0.05, movement: -0.02, complexity: 0, tension: 0,
    modalEmphasis: 0.02, contrast: -0.05, rhythmDelta: 0, shape: 'regular',
    contours: { ...allStable },
  },
  unknown: {
    stability: 0, movement: 0, complexity: 0, tension: 0,
    modalEmphasis: 0, contrast: 0, rhythmDelta: 0, shape: 'mixed',
    contours: { ...allStable },
  },
};

/* --------------------------------------------------------------------------
 * Influence factors — the documented weights of each input
 * ----------------------------------------------------------------------- */

/** How much a full (−0.5 → +0.5) energy swing moves each influenced value. */
export const ENERGY_INFLUENCE = {
  /** Movement and rhythm respond most: energetic sections may move more. */
  movement: 0.15,
  rhythmChangesPerBar: 1.0,
  complexity: 0.08,
  /** Deliberately WEAK — energy must never directly determine tension. */
  tension: 0.08,
} as const;

/** Settings-derived anchors (internal planning parameters). */
const COMPLEXITY_ANCHOR: Record<ChordGenSettings['complexity'], number> = { 1: 0.35, 2: 0.5, 3: 0.65 };
const DENSITY_ANCHOR: Record<ChordGenSettings['density'], number> = { 0: 1, 1: 2, 2: 3 };
const CADENCE_STABILITY: Record<ChordGenSettings['cadence'], number> = { soft: -0.03, balanced: 0, strong: 0.05 };
const BORROWING_FLEX: Record<ChordGenSettings['borrowing'], { movement: number; contrast: number; complexity: number }> = {
  none: { movement: -0.04, contrast: -0.04, complexity: 0 },
  some: { movement: 0.05, contrast: 0.05, complexity: 0 },
  more: { movement: 0.12, contrast: 0.12, complexity: 0.06 },
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round = (v: number, d: number): number => Math.round(v * 10 ** d) / 10 ** d;
const pref = (preferred: number, flexibility: number): HarmonicPreference => ({
  preferred: round(clamp01(preferred), 3),
  flexibility: round(Math.min(0.5, Math.max(0.05, flexibility)), 3),
});

/** Contour for a 0..1 dimension: `stable` sits at the preferred value;
 *  shaped families explore the range the preference makes plausible. */
function dimensionContour(family: ContourFamily, p: HarmonicPreference): Contour {
  if (family === 'stable') return { family, level: p.preferred };
  const { lo, hi } = contourRangeForPreference(p.preferred, p.flexibility);
  return { family, lo, hi };
}

/** Contour for harmonic rhythm: cpb normalized to 0..1 over the planner's
 *  working range (0.5–4 changes/bar) — an internal mapping, documented. */
function rhythmContour(family: ContourFamily, cpb: number, flexCpb: number): Contour {
  const center = clamp01((cpb - 0.5) / 3.5);
  if (family === 'stable') return { family, level: round(center, 3) };
  const spread = (flexCpb / 3.5) * 0.6;
  return { family, lo: round(clamp01(center - spread), 3), hi: round(clamp01(center + spread), 3) };
}

/** Repetition/development role (spec §4, §12): single occurrences establish
 *  (or, for contrast identities, contrast); repeats follow preserveIdentity. */
function developmentRole(ctx: SectionContext, settings: ChordGenSettings): DevelopmentRole {
  if (ctx.familyCount === 1) {
    const contrastIdentities: ReadonlyArray<SectionContext['family']> =
      ['bridge', 'breakdown', 'solo', 'interlude', 'transition'];
    return contrastIdentities.includes(ctx.family) ? 'contrast' : 'establish';
  }
  if (ctx.occurrence === 1) return 'establish';
  return settings.preserveIdentity ? 'repeat' : 'develop';
}

/* --------------------------------------------------------------------------
 * Profile construction
 * ----------------------------------------------------------------------- */

/**
 * Build the harmony profile of one section. Returns null when the sectionId
 * is unknown. Pure and deterministic — identical projects always yield
 * identical profiles.
 */
export function buildSectionHarmonyProfile(
  project: Project,
  sectionId: string,
): SectionHarmonyProfile | null {
  const ctx = analyzeSectionContext(project, sectionId);
  if (!ctx) return null;

  const settings: ChordGenSettings = { ...DEFAULT_CHORDGEN_SETTINGS, ...(project.chordGenSettings ?? {}) };
  const tendency = IDENTITY_TENDENCIES[ctx.identity];

  // Section-awareness scales the IDENTITY and CONTEXT influences without
  // disabling analysis (spec §10): residual 0.25 / 0.5 keeps a whisper of
  // structure while user settings stay meaningful.
  const identityFactor = settings.sectionAware ? 1 : 0.25;
  const contextFactor = settings.sectionAware ? 1 : 0.5;
  const energyDelta = ctx.energy - 0.5;

  // 1) Settings anchors → 2) identity biases → 3) energy nudges →
  // 4) structural context shifts. Each step documented above.
  let stability = 0.5 + tendency.stability * identityFactor
    + CADENCE_STABILITY[settings.cadence] * contextFactor;
  let movement = 0.5 + tendency.movement * identityFactor + ENERGY_INFLUENCE.movement * energyDelta;
  let complexity = COMPLEXITY_ANCHOR[settings.complexity] + tendency.complexity * identityFactor
    + ENERGY_INFLUENCE.complexity * energyDelta;
  let tension = 0.5 + tendency.tension * identityFactor + ENERGY_INFLUENCE.tension * energyDelta;
  const modalEmphasis = 0.3 + 0.4 * settings.modalEmphasis + tendency.modalEmphasis * identityFactor;
  let contrast = 0.5 + tendency.contrast * identityFactor;

  let shape: RhythmShape = tendency.shape;
  const contextShift = (d: number): number => d * contextFactor;

  if (settings.sectionAware) {
    if (ctx.isFirst) {
      stability = stability + contextShift(0.05);
      tension = tension - contextShift(0.03);
    }
    if (ctx.isLast) {
      stability = stability + contextShift(0.04);
      tension = tension - contextShift(0.05);
    }
    if (ctx.qualifier === 'final') stability = stability + contextShift(0.04);
    if (ctx.previous && ctx.previous.family === ctx.family) movement = movement - contextShift(0.04);
    // Repetition identity wins over neighbor boundaries: a recurring section
    // should keep sounding like its siblings, not contrast with them.
    const isRecurrence = ctx.isRepeated && ctx.occurrence > 1;
    if (isRecurrence) {
      contrast = contrast - contextShift(0.04);
    } else if (ctx.previous && ctx.previous.family !== 'unknown' && ctx.family !== 'unknown'
      && ctx.previous.family !== ctx.family) {
      contrast = contrast + contextShift(0.04);
    }
    if (ctx.precedesMajorTransition) tension = tension + contextShift(0.04);
  }

  // Flexibility: variation widens everything; borrowing widens movement,
  // contrast and complexity; nothing is ever narrowed to zero.
  const widen = settings.variation * 0.15;
  const borrow = BORROWING_FLEX[settings.borrowing];
  const stabilityP = pref(stability, 0.35 + widen);
  const movementP = pref(movement, 0.35 + widen + borrow.movement);
  const complexityP = pref(complexity, 0.35 + widen + borrow.complexity);
  const tensionP = pref(tension, 0.35 + widen);
  const modalP = pref(modalEmphasis, 0.35 + widen);
  const contrastP = pref(contrast, 0.35 + widen + borrow.contrast);

  // Harmonic rhythm (meter-aware, spec §7): settings density is the base,
  // identity and energy nudge it, the project's own meter converts it to
  // concrete tick intervals. No 4/4 assumption anywhere.
  const changesPerBar = Math.min(8, Math.max(0.25,
    DENSITY_ANCHOR[settings.density] + tendency.rhythmDelta * identityFactor
    + ENERGY_INFLUENCE.rhythmChangesPerBar * energyDelta));
  const bt = barTicks(project.timeSignature);
  const beatsPerBar = beatOffsets(project.timeSignature).length;
  const rhythmFlex = Math.min(2, Math.max(0.25, 0.5 + settings.variation * 0.5));
  if (ctx.isLast && shape === 'accelerating') shape = 'decelerating';
  const rhythm: HarmonicRhythmPreference = {
    preferredChangesPerBar: round(changesPerBar, 2),
    flexibility: round(rhythmFlex, 3),
    preferredChangeIntervalTicks: Math.round(bt / changesPerBar),
    preferredChangeIntervalBeats: round(beatsPerBar / changesPerBar, 2),
    shape,
  };

  // Contours: identity picks the family per dimension; the preference range
  // fills in the values. Tension is not privileged — any dimension evolves.
  const contours = {
    tension: dimensionContour(tendency.contours.tension, tensionP),
    rhythm: rhythmContour(tendency.contours.rhythm, changesPerBar, rhythmFlex),
    complexity: dimensionContour(tendency.contours.complexity, complexityP),
  };

  // Development relationships (facts, not decisions): every section whose
  // relationship key matches — same family for recognized names, shared
  // number-stripped name for unrecognized ones.
  const key = relationshipKey(ctx.name, ctx.family);
  const related = sectionsInOrder(project)
    .filter((s) => s.id !== ctx.sectionId
      && relationshipKey(s.name, resolveSectionIdentity(s.name).family) === key)
    .map((s) => s.id);

  return {
    sectionId: ctx.sectionId,
    sectionName: ctx.name,
    identity: ctx.identity,
    family: ctx.family,
    context: ctx,
    meter: {
      timeSignature: { ...project.timeSignature },
      barTicks: bt,
      beatTicks: beatTicks(project.timeSignature),
      beatsPerBar,
      compound: isCompound(project.timeSignature),
    },
    preferences: {
      stability: stabilityP,
      movement: movementP,
      rhythm,
      complexity: complexityP,
      tension: tensionP,
      modalEmphasis: modalP,
      contrast: contrastP,
    },
    contours,
    development: {
      role: developmentRole(ctx, settings),
      relatedSectionIds: related,
    },
  };
}

/**
 * Profiles for the whole song, in chronological order (spec §12). Unusual
 * structures — one long section, no chorus, consecutive bridges, unfamiliar
 * names — are all valid; every section simply receives its context-derived
 * description. Returns [] for a sectionless project.
 */
export function buildSongHarmonyProfiles(project: Project): SectionHarmonyProfile[] {
  const profiles: SectionHarmonyProfile[] = [];
  for (const s of sectionsInOrder(project)) {
    const p = buildSectionHarmonyProfile(project, s.id);
    if (p) profiles.push(p);
  }
  return profiles;
}
