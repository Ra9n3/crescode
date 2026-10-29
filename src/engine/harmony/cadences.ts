/**
 * Cadence planning (Phase 3) — intended harmonic arrivals, not chord
 * formulas.
 *
 * WHAT THIS IS: for every planned phrase, a description of how its end is
 * meant to FEEL (resolved / open / suspended / transitional / deceptive /
 * modal / ambiguous) plus the broad cadential approaches the key/mode
 * structurally supports. Both derive from Phase 1 facts (scale membership,
 * leading tone, dominant-quality degree-5 triad, tonic-triad stability,
 * characteristic tones, symmetry) — never from a mode-name table and never
 * from a progression bank (spec §1A, §6). "Resolved" stays available in
 * every context: in D Dorian a G→Dm arrival resolves through modal
 * relationships; in symmetrical scales resolution may ride on pedal tones
 * and repetition. Choosing the chords that realize an intention is Phase 4's
 * job, not this module's.
 *
 * WHAT THIS IS NOT: cadence selection. No chord is picked, scored, placed
 * or modified here, and the manual workflow is untouched.
 *
 * Deterministic (spec §10 Option B): identical inputs produce identical
 * outputs; the seed only chooses among weighted, structurally sensible
 * outcomes and is never advanced or persisted.
 */
import { MODES, scalePitchClasses } from '../../shared/schema/modes';
import {
  DEFAULT_CHORDGEN_SETTINGS, type ChordGenSettings, type ModeName, type Project,
} from '../../shared/schema/types';
import { hashString, mulberry32 } from '../generate';
import { getCharacteristicToneIntervals, isSymmetricScale } from './vocabulary';
import { applyVariation, pickWeighted } from './planning';
import type {
  CadenceEnvironment, CadenceFamily, CadenceIntention, PhraseCadence, PhraseRole,
  SectionHarmonyProfile,
} from './types';

/** All intentions in deterministic order — the full support set every phrase
 *  draws from. No intention is ever structurally impossible (spec §5). */
export const CADENCE_INTENTIONS: readonly CadenceIntention[] = [
  'resolved', 'open', 'suspended', 'transitional', 'deceptive', 'modal', 'ambiguous',
];

/** Canonical family order; used as the deterministic tie-break. */
export const CADENCE_FAMILIES: readonly CadenceFamily[] = [
  'functional-tonal', 'plagal', 'modal', 'stepwise', 'pedal', 'chromatic', 'coloristic',
];

/** Triad/seventh interval probes (semitones above the chord root). */
const MAJOR_TRIAD = [0, 4, 7];
const MINOR_TRIAD = [0, 3, 7];
const DOMINANT7 = [0, 4, 7, 10];

function hasChord(scaleSet: Set<number>, rootPc: number, intervals: number[]): boolean {
  return intervals.every((iv) => scaleSet.has((rootPc + iv) % 12));
}

/**
 * Derive the cadence-relevant structural facts of a key/mode from Phase 1
 * primitives (scale comparison, symmetry detection) — NOT a per-mode table.
 * Example: Ionian gains `dominantAvailable` because degree 5 hosts a major/
 * dominant-quality triad AND a semitone leading tone exists; Dorian lacks
 * the leading tone, Phrygian/Locrian lack one or both, and the symmetrical
 * scales lack all of them. `key` is a pitch class 0..11 (0 = C).
 */
export function cadenceEnvironment(key: number, mode: ModeName): CadenceEnvironment {
  const tonic = ((key % 12) + 12) % 12;
  const scale = scalePitchClasses(tonic, mode);
  const scaleSet = new Set(scale);
  const dominant = (tonic + 7) % 12;
  const subdominant = (tonic + 5) % 12;
  return {
    scalePitchClasses: scale,
    symmetric: isSymmetricScale(scale),
    hasLeadingTone: MODES[mode].includes(11),
    dominantAvailable:
      hasChord(scaleSet, dominant, MAJOR_TRIAD) || hasChord(scaleSet, dominant, DOMINANT7),
    subdominantAvailable:
      hasChord(scaleSet, subdominant, MAJOR_TRIAD) || hasChord(scaleSet, subdominant, MINOR_TRIAD),
    tonicTriadStable:
      hasChord(scaleSet, tonic, MAJOR_TRIAD) || hasChord(scaleSet, tonic, MINOR_TRIAD),
    characteristicToneCount: getCharacteristicToneIntervals(mode).length,
  };
}

/**
 * Which broad cadential approaches this environment supports, strongest
 * first. Families scoring at or below the support floor are excluded — that
 * is the ONLY exclusion mechanism, and it is purely structural: symmetrical
 * scales never receive functional-tonal or modal entries, Locrian's
 * diminished tonic removes plagal support, and so on. The list never drops
 * below four entries, so no phrase is ever boxed in. `phraseHint` only
 * re-orders relevance for the phrase's role (a contrast phrase reads
 * modal/chromatic approaches as more pertinent); it can never resurrect an
 * excluded family.
 */
export function compatibleCadenceFamilies(
  environment: CadenceEnvironment,
  phraseHint?: { role: PhraseRole },
): CadenceFamily[] {
  const scores = new Map<CadenceFamily, number>();
  const set = (f: CadenceFamily, v: number) => { scores.set(f, v); };
  const bump = (f: CadenceFamily, d: number) => {
    if (scores.has(f)) scores.set(f, scores.get(f)! + d);
  };

  if (environment.dominantAvailable && environment.hasLeadingTone && environment.tonicTriadStable) {
    set('functional-tonal', 1);
  }
  if (environment.subdominantAvailable && environment.tonicTriadStable) set('plagal', 0.85);
  if (environment.characteristicToneCount > 0) set('modal', 0.8);
  set('stepwise', 0.7);
  set('pedal', environment.symmetric ? 0.9 : 0.6);
  set('coloristic', environment.symmetric || !environment.tonicTriadStable ? 0.85 : 0.55);
  set('chromatic', 0.5);

  if (phraseHint) {
    if (phraseHint.role === 'contrast' || phraseHint.role === 'develop') {
      bump('modal', 0.05); bump('chromatic', 0.05);
    }
    if (phraseHint.role === 'conclude') { bump('functional-tonal', 0.05); bump('plagal', 0.05); }
  }

  return CADENCE_FAMILIES.filter((f) => (scores.get(f) ?? 0) > 0.45)
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
}

/** Base arrival tendencies per phrase role — the deterministic starting
 *  weights every modifier bends. Order matches CADENCE_INTENTIONS. */
const ROLE_BASE: Record<PhraseRole, Record<CadenceIntention, number>> = {
  establish: { resolved: 0.5, open: 3, suspended: 1.5, transitional: 0.5, deceptive: 0.25, modal: 1.5, ambiguous: 0.75 },
  continue: { resolved: 0.5, open: 3, suspended: 1.5, transitional: 0.5, deceptive: 0.25, modal: 1, ambiguous: 1 },
  repeat: { resolved: 0.6, open: 2.5, suspended: 1.5, transitional: 0.75, deceptive: 0.4, modal: 1, ambiguous: 1 },
  develop: { resolved: 0.5, open: 2.5, suspended: 1.5, transitional: 0.75, deceptive: 0.4, modal: 1, ambiguous: 1 },
  contrast: { resolved: 0.4, open: 1.5, suspended: 1, transitional: 0.4, deceptive: 1.5, modal: 3, ambiguous: 2 },
  conclude: { resolved: 3, open: 1.5, suspended: 0.75, transitional: 0.25, deceptive: 0.75, modal: 1.5, ambiguous: 0.5 },
  prepare: { resolved: 0.75, open: 2, suspended: 1.5, transitional: 3, deceptive: 0.25, modal: 0.5, ambiguous: 0.75 },
};

export interface CadenceTendencyInput {
  role: PhraseRole;
  phraseIndex: number;
  phraseCount: number;
  isSectionEnd: boolean;
  isSongEnd: boolean;
  profile: SectionHarmonyProfile;
  environment: CadenceEnvironment;
  settings: ChordGenSettings;
}

/**
 * Deterministic arrival weights for one phrase — the honest, inspectable
 * planning surface. `planCadence` samples this distribution with the seed;
 * tests and Phase 4 can read it directly. Structural context (song end,
 * final qualifier, what comes next) shifts weights but mandates nothing:
 * every intention keeps a nonzero weight in every context (spec §5, §13-T4).
 */
export function cadenceTendencies(input: CadenceTendencyInput): Record<CadenceIntention, number> {
  const w: Record<CadenceIntention, number> = { ...ROLE_BASE[input.role] };
  // sectionAware scales the CONTEXTUAL modifiers only — role character,
  // environment character and user settings keep operating (analysis is
  // reduced, never disabled).
  const cf = input.settings.sectionAware ? 1 : 0.5;

  // Environment character: symmetrical scales arrive by pedal, repetition
  // and color — modal language does not apply, and resolution reads softer.
  if (input.environment.symmetric) {
    w.modal *= 0.2;
    w.ambiguous *= 1.3;
    w.suspended *= 1.2;
    w.resolved *= 0.8;
  }

  // The user's cadence setting bends arrival strength.
  if (input.settings.cadence === 'soft') { w.open *= 1.4; w.suspended *= 1.3; w.resolved *= 0.7; }
  if (input.settings.cadence === 'strong') { w.resolved *= 1.35; w.transitional *= 1.25; w.ambiguous *= 0.8; }

  // Settings-derived character preferences (from Phase 2 anchors).
  if (input.profile.preferences.modalEmphasis.preferred >= 0.7) w.modal *= 1.3;
  if (input.profile.preferences.complexity.preferred >= 0.65) {
    w.deceptive *= 1.25;
    w.ambiguous *= 1.2;
  }

  // Structural position — contextual, scaled by sectionAware.
  if (input.isSongEnd && input.role === 'conclude') {
    w.resolved *= 1 + 1.0 * cf;
    w.ambiguous *= 1 - 0.4 * cf;
    w.deceptive *= 1 - 0.4 * cf;
  }
  if (input.isSectionEnd && !input.isSongEnd && input.profile.context.qualifier === 'final') {
    w.resolved *= 1 + 0.4 * cf;
  }
  if (input.isSectionEnd && !input.isSongEnd && input.profile.context.precedesMajorTransition) {
    w.transitional *= 1 + 0.5 * cf;
  }
  if (input.isSectionEnd && !input.isSongEnd && input.profile.context.next) {
    const next = input.profile.context.next;
    if (next.family === 'breakdown') w.suspended *= 1 + 0.6 * cf;
    if (next.family === 'chorus') w.transitional *= 1 + 0.3 * cf;
  }
  return w;
}

export interface CadencePhraseInput {
  role: PhraseRole;
  /** 0-based phrase index within the section. */
  index: number;
  /** Total phrase count of the section. */
  count: number;
  /** True when the SECTION is the song's last (the arrival must land). */
  isSongEnd: boolean;
}

export interface CadencePlanContext {
  /** Key/mode describing the harmonic environment. */
  project: Pick<Project, 'key' | 'mode'>;
  profile: SectionHarmonyProfile;
  /** Merged over DEFAULT_CHORDGEN_SETTINGS when omitted. */
  settings?: Partial<ChordGenSettings>;
  /** Optional deterministic seed; defaults to the project's persisted seed. */
  seed?: number;
}

/**
 * Plan the intended arrival of one phrase: a cadential intention chosen
 * (deterministically, seed-aware) from the structural tendencies, plus the
 * environment-derived compatible families. No chord is selected (spec §6:
 * compatibility is not selection).
 */
export function planCadence(
  phrase: CadencePhraseInput,
  context: CadencePlanContext,
): PhraseCadence {
  const settings: ChordGenSettings = { ...DEFAULT_CHORDGEN_SETTINGS, ...(context.settings ?? {}) };
  const seed = context.seed ?? settings.seed;
  const environment = cadenceEnvironment(context.project.key, context.project.mode);
  const families = compatibleCadenceFamilies(environment, { role: phrase.role });
  const tendencies = cadenceTendencies({
    role: phrase.role,
    phraseIndex: phrase.index,
    phraseCount: phrase.count,
    isSectionEnd: phrase.index === phrase.count - 1,
    isSongEnd: phrase.isSongEnd,
    profile: context.profile,
    environment,
    settings,
  });
  const weighted = applyVariation(
    CADENCE_INTENTIONS.map((intention) => [intention, tendencies[intention]] as const),
    settings.variation,
  );
  const rng = mulberry32(hashString(
    ['crescode:cadence', context.profile.sectionId, String(phrase.index), String(seed)].join('|'),
  ));
  return { intention: pickWeighted(weighted, rng), compatibleFamilies: families };
}
