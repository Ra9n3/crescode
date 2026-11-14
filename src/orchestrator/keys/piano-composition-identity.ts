/**
 * Piano Composition Identity (Performance Styles, Stage 2).
 *
 * One immutable record per generation. It is drawn once, before any note is
 * written, and coordinates the decisions the Texture-and-Theme Composer used
 * to take separately: theme, rhythm, accompaniment, development, trajectory,
 * dynamics and techniques.
 *
 * The record starts from an archetype - an internal compositional concept,
 * not a user-facing style - and every other decision is drawn from ranges
 * that belong to that archetype, then narrowed by what the template allows,
 * then checked against explicit compatibility rules. Template limits always
 * win: an archetype can only choose among what a template permits.
 *
 * Nothing here writes notes and nothing here is random at run time: the same
 * project seed and take index always give the same record. Density is not an
 * input, so the same piece keeps its identity at every density.
 *
 * Classic mode never calls this module.
 */
import type { PianoArcRole, PianoLeftPattern, PianoRightStyle, PianoThemeOperation } from './piano-texture-theme';

export type PianoCompositionMode = 'identity' | 'classic';
/** Compose All uses the identity-driven composer unless Classic is requested explicitly. */
export const DEFAULT_PIANO_COMPOSITION_MODE: PianoCompositionMode = 'identity';

export type PianoArchetype = 'lyrical' | 'rhythmic' | 'dialogue' | 'chorale' | 'flowing' | 'sparse';
export const PIANO_ARCHETYPES: readonly PianoArchetype[] = ['lyrical', 'rhythmic', 'dialogue', 'chorale', 'flowing', 'sparse'];

export type PianoThemeContour = 'arch' | 'leap-fill' | 'descent-rise' | 'wave' | 'rise' | 'fall' | 'pendulum' | 'repeat-step';
/** How the four theme bars relate: A B A' C, A A' B C, A B(open) A C, or A B C D. */
export type PianoThemeForm = 'period' | 'sentence' | 'question-answer' | 'long-line';
export type PianoTrajectoryShape = 'late-peak' | 'early-peak' | 'terraced' | 'two-waves' | 'plateau';
export type PianoDynamicShape = 'arch' | 'terraced' | 'long-crescendo' | 'waves' | 'level';
export type PianoProtectedTrait = 'theme-head' | 'rhythm-cell' | 'bass-motion';
export type PianoRunPolicy = 'none' | 'cadential' | 'free';
export type PianoLeftThemePolicy = 'never' | 'answer' | 'frequent';
type Level = 1 | 2 | 3;

/** [position, length] in eighth notes inside a common-time bar. */
export type PianoRhythmCell = readonly (readonly [number, number])[];

/**
 * Rhythm cells of the identity composer. Every cell lies on the existing
 * eighth-note grid and uses only note lengths the Classic composer already
 * writes (eighth, quarter, dotted quarter, half, dotted half, whole).
 */
export const IDENTITY_RHYTHMS: Readonly<Record<string, PianoRhythmCell>> = Object.freeze({
  // lyrical heads: long values, one short pickup at most
  ly1: [[0, 4], [4, 2], [6, 2]],
  ly2: [[0, 3], [3, 1], [4, 4]],
  ly3: [[0, 3], [3, 1], [4, 2], [6, 2]],
  ly4: [[0, 2], [2, 4], [6, 2]],
  ly5: [[0, 6], [6, 1], [7, 1]],
  // rhythmic heads: off-beat accents, 3+3+2 groupings, a rest inside the bar
  rh1: [[0, 3], [3, 3], [6, 2]],
  rh2: [[1, 1], [2, 2], [4, 2], [6, 2]],
  rh3: [[0, 1], [1, 2], [3, 1], [4, 2], [6, 2]],
  rh4: [[0, 3], [3, 2], [5, 3]],
  rh5: [[0, 2], [3, 1], [4, 1], [5, 3]],
  // dialogue heads: a short call that leaves the rest of the bar for an answer
  di1: [[0, 2], [2, 1], [3, 1], [4, 2]],
  di2: [[0, 1], [1, 1], [2, 2]],
  di3: [[0, 3], [3, 1], [4, 1]],
  di4: [[2, 1], [3, 1], [4, 2]],
  // chorale heads: even values
  ch1: [[0, 2], [2, 2], [4, 4]],
  ch2: [[0, 4], [4, 4]],
  ch3: [[0, 2], [2, 2], [4, 2], [6, 2]],
  ch4: [[0, 4], [4, 2], [6, 2]],
  // flowing heads: running eighths
  fl1: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [6, 2]],
  fl2: [[0, 2], [2, 1], [3, 1], [4, 1], [5, 1], [6, 2]],
  fl3: [[0, 1], [1, 1], [2, 2], [4, 3], [7, 1]],
  fl4: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 2]],
  // sparse heads: few notes, silence as part of the idea
  sp1: [[0, 6], [6, 2]],
  sp2: [[2, 2], [4, 4]],
  sp3: [[0, 2], [4, 4]],
  sp4: [[0, 4], [6, 2]],
  // landings (second idea of the theme)
  la1: [[0, 4], [4, 2], [6, 2]],
  la2: [[0, 6], [6, 2]],
  la3: [[0, 2], [2, 2], [4, 4]],
  la4: [[0, 3], [3, 1], [4, 4]],
  la5: [[0, 4], [4, 4]],
  la6: [[0, 2], [2, 2], [4, 2]],
  la7: [[0, 1], [1, 1], [2, 2], [4, 4]],
  la8: [[0, 3], [3, 3], [6, 2]],
  // cadences
  ca1: [[0, 4], [4, 4]],
  ca2: [[0, 2], [2, 2], [4, 4]],
  ca3: [[0, 8]],
  ca4: [[0, 3], [3, 1], [4, 4]],
  ca5: [[0, 2], [2, 2], [4, 2]],
});

/** Eighth slots on which each left-hand figure attacks ("cell-figure" follows the identity's own cell). */
const LEFT_ATTACKS: Readonly<Record<Exclude<PianoLeftPattern, 'cell-figure'>, readonly number[]>> = {
  sustain: [0],
  'half-notes': [0, 4],
  'broken-quarters': [0, 2, 4, 6],
  'bass-and-chord': [0, 4],
  walking: [0, 2, 4, 6],
  'pulse-quarters': [0, 2, 4, 6],
  'alberti-eighths': [0, 1, 2, 3, 4, 5, 6, 7],
  'rolling-arpeggio': [0, 1, 2, 3, 4, 5, 6, 7],
  'broken-tenths': [0, 1, 2, 3, 4, 5, 6, 7],
  stride: [0, 2, 4, 6],
  'ostinato-332': [0, 2, 3, 5, 6, 7],
};

export function leftPatternAttacks(pattern: PianoLeftPattern, cell: readonly number[]): readonly number[] {
  return pattern === 'cell-figure' ? [...new Set([0, ...cell])].sort((a, b) => a - b) : LEFT_ATTACKS[pattern];
}

/* ------------------------------------------------------------------ */
/* Archetypes                                                          */
/* ------------------------------------------------------------------ */

interface ArchetypeSpec {
  /** One sentence in plain words. */
  readonly summary: string;
  readonly contours: readonly PianoThemeContour[];
  readonly forms: readonly PianoThemeForm[];
  readonly heads: readonly string[];
  readonly landings: readonly string[];
  readonly cadences: readonly string[];
  /** Lowest and highest scale step of the theme relative to its anchor. */
  readonly range: readonly [number, number];
  /** Preference order; the template's allowed set decides what is actually available. */
  readonly left: Readonly<Record<Level, readonly PianoLeftPattern[]>>;
  readonly right: Readonly<Record<Level, readonly PianoRightStyle[]>>;
  /** Alternatives for successive "development" phrases. */
  readonly developments: readonly (readonly PianoThemeOperation[])[];
  readonly reprise: readonly PianoThemeOperation[];
  readonly climax: readonly PianoThemeOperation[];
  readonly build: readonly PianoThemeOperation[];
  readonly contrast: readonly PianoThemeOperation[];
  readonly release: readonly PianoThemeOperation[];
  readonly trajectories: readonly PianoTrajectoryShape[];
  /** Added to the texture level before the template and density ceilings are applied. */
  readonly levelBias: number;
  /** Lowest texture level of a sounding bar; 1 where the accompaniment itself carries the idea. */
  readonly levelFloor: 0 | 1;
  readonly dynamics: readonly PianoDynamicShape[];
  readonly contrastWidth: readonly [number, number];
  /** Depth and position of the swell inside one phrase. */
  readonly hairpin: readonly [depth: number, peak: number];
  readonly ornamentChance: number;
  readonly runs: PianoRunPolicy;
  readonly octaveChance: number;
  readonly leftTheme: PianoLeftThemePolicy;
  /** Chance that a contrast is taken at the second distinct section already. */
  readonly earlyContrastChance: number;
  readonly protectedTraits: readonly PianoProtectedTrait[];
}

const ARCHETYPES: Readonly<Record<PianoArchetype, ArchetypeSpec>> = Object.freeze({
  lyrical: {
    summary: 'A singing line in long notes over a flowing left hand, growing towards a late high point.',
    contours: ['arch', 'leap-fill', 'descent-rise', 'rise'],
    forms: ['period', 'long-line', 'sentence'],
    heads: ['ly1', 'ly2', 'ly3', 'ly4', 'ly5'],
    landings: ['la1', 'la2', 'la4'],
    cadences: ['ca1', 'ca2', 'ca4'],
    range: [-1, 6],
    left: {
      1: ['broken-quarters', 'half-notes', 'bass-and-chord', 'walking', 'pulse-quarters'],
      2: ['rolling-arpeggio', 'broken-tenths', 'alberti-eighths', 'broken-quarters', 'stride', 'ostinato-332', 'pulse-quarters'],
      3: ['rolling-arpeggio', 'broken-tenths', 'alberti-eighths', 'ostinato-332', 'stride'],
    },
    right: {
      1: ['held', 'restrike', 'offbeat-stabs'],
      2: ['flowing-inner', 'restrike', 'held', 'block-chords', 'answer-chords', 'offbeat-stabs'],
      3: ['flowing-inner', 'block-chords', 'restrike', 'answer-chords', 'offbeat-stabs'],
    },
    developments: [['sequence', 'tail-sequence'], ['sequence', 'inversion'], ['descending-sequence', 'sequence']],
    reprise: ['ornamented-reprise', 'register-lift'],
    climax: ['register-lift'],
    build: ['rising-fragments', 'sequence'],
    contrast: ['inversion', 'tail-sequence', 'descending-sequence'],
    release: ['augmented-skeleton', 'descending-sequence'],
    trajectories: ['late-peak', 'two-waves'],
    levelBias: 0,
    levelFloor: 0,
    dynamics: ['arch', 'long-crescendo'],
    contrastWidth: [1, 1.25],
    hairpin: [0.5, 0.7],
    ornamentChance: 0.9,
    runs: 'cadential',
    octaveChance: 1,
    leftTheme: 'answer',
    earlyContrastChance: 0.3,
    protectedTraits: ['theme-head', 'bass-motion'],
  },
  rhythmic: {
    summary: 'A short, accented figure that both hands keep returning to; steady pulse, stepped dynamics.',
    contours: ['repeat-step', 'pendulum', 'wave', 'leap-fill'],
    forms: ['sentence', 'question-answer', 'period'],
    heads: ['rh1', 'rh2', 'rh3', 'rh4', 'rh5'],
    landings: ['la8', 'la7', 'la3'],
    cadences: ['ca2', 'ca5', 'ca4'],
    range: [-2, 5],
    left: {
      1: ['pulse-quarters', 'bass-and-chord', 'walking', 'broken-quarters', 'half-notes'],
      2: ['cell-figure', 'ostinato-332', 'stride', 'walking', 'alberti-eighths', 'pulse-quarters', 'rolling-arpeggio', 'broken-tenths', 'broken-quarters'],
      3: ['ostinato-332', 'cell-figure', 'stride', 'alberti-eighths', 'rolling-arpeggio', 'broken-tenths'],
    },
    right: {
      1: ['offbeat-stabs', 'restrike', 'held'],
      2: ['offbeat-stabs', 'answer-chords', 'restrike', 'block-chords', 'flowing-inner', 'held'],
      3: ['offbeat-stabs', 'answer-chords', 'block-chords', 'restrike', 'flowing-inner'],
    },
    developments: [['fragment-extension', 'sequence'], ['fragment-extension', 'descending-sequence'], ['rising-fragments', 'fragment-extension']],
    reprise: ['statement', 'ornamented-reprise'],
    climax: ['statement', 'register-lift'],
    build: ['rising-fragments', 'fragment-extension'],
    contrast: ['descending-sequence', 'inversion', 'augmented-skeleton'],
    release: ['answer-fragment', 'augmented-skeleton'],
    trajectories: ['terraced', 'late-peak', 'early-peak'],
    levelBias: 0.15,
    levelFloor: 1,
    dynamics: ['terraced', 'waves'],
    contrastWidth: [1, 1.3],
    hairpin: [0.15, 0.5],
    ornamentChance: 0.2,
    runs: 'none',
    octaveChance: 1,
    leftTheme: 'never',
    earlyContrastChance: 0.6,
    protectedTraits: ['rhythm-cell', 'theme-head'],
  },
  dialogue: {
    summary: 'A short call answered in the space it leaves; the idea passes between the hands.',
    contours: ['leap-fill', 'pendulum', 'rise', 'fall'],
    forms: ['question-answer', 'sentence', 'period'],
    heads: ['di1', 'di2', 'di3', 'di4'],
    landings: ['la6', 'la3', 'la1'],
    cadences: ['ca5', 'ca1', 'ca2'],
    range: [-2, 5],
    left: {
      1: ['bass-and-chord', 'walking', 'broken-quarters', 'pulse-quarters', 'half-notes'],
      2: ['alberti-eighths', 'walking', 'broken-quarters', 'stride', 'rolling-arpeggio', 'ostinato-332', 'broken-tenths', 'pulse-quarters'],
      3: ['alberti-eighths', 'stride', 'rolling-arpeggio', 'ostinato-332', 'broken-tenths'],
    },
    right: {
      1: ['held', 'restrike', 'offbeat-stabs'],
      2: ['answer-chords', 'flowing-inner', 'restrike', 'held', 'block-chords', 'offbeat-stabs'],
      3: ['answer-chords', 'flowing-inner', 'block-chords', 'restrike', 'offbeat-stabs'],
    },
    developments: [['hand-exchange', 'sequence'], ['hand-exchange', 'inversion'], ['answer-fragment', 'hand-exchange']],
    reprise: ['hand-exchange', 'ornamented-reprise'],
    climax: ['register-lift'],
    build: ['rising-fragments', 'sequence'],
    contrast: ['inversion', 'hand-exchange', 'tail-sequence'],
    release: ['answer-fragment', 'augmented-skeleton'],
    trajectories: ['two-waves', 'terraced'],
    levelBias: 0,
    levelFloor: 0,
    dynamics: ['waves', 'terraced'],
    contrastWidth: [0.9, 1.2],
    hairpin: [0.4, 0.5],
    ornamentChance: 0.5,
    runs: 'cadential',
    octaveChance: 0.5,
    leftTheme: 'frequent',
    earlyContrastChance: 0.6,
    protectedTraits: ['theme-head', 'rhythm-cell'],
  },
  chorale: {
    summary: 'Even, hymn-like movement in chords; the theme moves by step and the dynamics stay close.',
    contours: ['arch', 'rise', 'fall', 'pendulum'],
    forms: ['period', 'question-answer', 'sentence'],
    heads: ['ch1', 'ch2', 'ch3', 'ch4'],
    landings: ['la5', 'la3', 'la1'],
    cadences: ['ca1', 'ca3', 'ca2'],
    range: [-1, 4],
    left: {
      1: ['half-notes', 'bass-and-chord', 'broken-quarters', 'pulse-quarters', 'walking'],
      2: ['broken-quarters', 'bass-and-chord', 'pulse-quarters', 'walking', 'rolling-arpeggio', 'stride', 'alberti-eighths', 'ostinato-332', 'broken-tenths'],
      3: ['rolling-arpeggio', 'broken-tenths', 'alberti-eighths', 'stride', 'ostinato-332'],
    },
    right: {
      1: ['held', 'restrike', 'offbeat-stabs'],
      2: ['block-chords', 'restrike', 'held', 'flowing-inner', 'answer-chords', 'offbeat-stabs'],
      3: ['block-chords', 'restrike', 'flowing-inner', 'answer-chords', 'offbeat-stabs'],
    },
    developments: [['sequence', 'augmented-skeleton'], ['descending-sequence', 'sequence'], ['tail-sequence', 'sequence']],
    reprise: ['statement', 'register-lift'],
    climax: ['statement', 'register-lift'],
    build: ['sequence', 'rising-fragments'],
    contrast: ['augmented-skeleton', 'inversion', 'descending-sequence'],
    release: ['augmented-skeleton'],
    trajectories: ['late-peak', 'plateau'],
    levelBias: -0.15,
    levelFloor: 0,
    dynamics: ['long-crescendo', 'level', 'arch'],
    contrastWidth: [0.7, 1],
    hairpin: [0.25, 0.6],
    ornamentChance: 0.1,
    runs: 'none',
    octaveChance: 1,
    leftTheme: 'never',
    earlyContrastChance: 0.3,
    protectedTraits: ['bass-motion', 'theme-head'],
  },
  flowing: {
    summary: 'Continuous eighth-note motion in the line and the left hand, rising and falling in waves.',
    contours: ['wave', 'rise', 'fall', 'arch'],
    forms: ['sentence', 'long-line', 'period'],
    heads: ['fl1', 'fl2', 'fl3', 'fl4'],
    landings: ['la7', 'la3', 'la4'],
    cadences: ['ca2', 'ca4', 'ca1'],
    range: [-2, 6],
    left: {
      1: ['broken-quarters', 'walking', 'bass-and-chord', 'pulse-quarters', 'half-notes'],
      2: ['rolling-arpeggio', 'alberti-eighths', 'broken-tenths', 'ostinato-332', 'stride', 'broken-quarters', 'pulse-quarters'],
      3: ['rolling-arpeggio', 'broken-tenths', 'alberti-eighths', 'ostinato-332', 'stride'],
    },
    right: {
      1: ['held', 'restrike', 'offbeat-stabs'],
      2: ['held', 'restrike', 'flowing-inner', 'block-chords', 'answer-chords', 'offbeat-stabs'],
      3: ['restrike', 'flowing-inner', 'block-chords', 'answer-chords', 'offbeat-stabs'],
    },
    developments: [['sequence', 'descending-sequence'], ['tail-sequence', 'sequence'], ['sequence', 'fragment-extension']],
    reprise: ['ornamented-reprise', 'register-lift'],
    climax: ['register-lift', 'sequence'],
    build: ['rising-fragments', 'sequence'],
    contrast: ['descending-sequence', 'inversion', 'tail-sequence'],
    release: ['descending-sequence', 'augmented-skeleton'],
    trajectories: ['two-waves', 'plateau', 'early-peak'],
    levelBias: 0.3,
    levelFloor: 1,
    dynamics: ['waves', 'arch'],
    contrastWidth: [0.85, 1.1],
    hairpin: [0.45, 0.6],
    ornamentChance: 0.6,
    runs: 'free',
    octaveChance: 0.5,
    leftTheme: 'answer',
    earlyContrastChance: 0.4,
    protectedTraits: ['rhythm-cell', 'bass-motion'],
  },
  sparse: {
    summary: 'Few notes and deliberate silences over a held bass; development comes from register and space.',
    contours: ['leap-fill', 'fall', 'descent-rise', 'arch'],
    forms: ['question-answer', 'period'],
    heads: ['sp1', 'sp2', 'sp3', 'sp4'],
    landings: ['la2', 'la5'],
    cadences: ['ca3', 'ca1'],
    range: [-1, 5],
    left: {
      1: ['half-notes', 'bass-and-chord', 'broken-quarters', 'pulse-quarters', 'walking'],
      2: ['broken-tenths', 'rolling-arpeggio', 'broken-quarters', 'pulse-quarters', 'bass-and-chord', 'ostinato-332', 'stride', 'alberti-eighths'],
      3: ['broken-tenths', 'rolling-arpeggio', 'ostinato-332', 'alberti-eighths', 'stride'],
    },
    right: {
      1: ['held', 'restrike', 'offbeat-stabs'],
      2: ['held', 'restrike', 'flowing-inner', 'answer-chords', 'block-chords', 'offbeat-stabs'],
      3: ['restrike', 'block-chords', 'flowing-inner', 'offbeat-stabs', 'answer-chords'],
    },
    developments: [['fragment-extension', 'augmented-skeleton'], ['tail-sequence', 'augmented-skeleton'], ['augmented-skeleton', 'sequence']],
    reprise: ['register-lift', 'statement'],
    climax: ['register-lift'],
    build: ['sequence', 'rising-fragments'],
    contrast: ['augmented-skeleton', 'inversion'],
    release: ['augmented-skeleton'],
    trajectories: ['late-peak', 'plateau'],
    levelBias: -0.35,
    levelFloor: 0,
    dynamics: ['level', 'arch'],
    contrastWidth: [0.7, 0.95],
    hairpin: [0.3, 0.5],
    ornamentChance: 0.1,
    runs: 'none',
    octaveChance: 0,
    leftTheme: 'never',
    earlyContrastChance: 0.2,
    protectedTraits: ['theme-head', 'bass-motion'],
  },
});

/* ------------------------------------------------------------------ */
/* Template limits                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a template lets an identity choose from. The first entry of every
 * list is the template's own Classic choice. Texture ceiling, registers,
 * melody presence, intensity cap, octave policy and pedal are not listed
 * here because an identity cannot touch them at all.
 */
export interface PianoIdentityTemplateLimits {
  /** Allowed archetypes with their weights; an archetype that is not listed is never chosen. */
  readonly archetypes: Readonly<Partial<Record<PianoArchetype, number>>>;
  readonly left: Readonly<Record<Level, readonly PianoLeftPattern[]>>;
  readonly right: Readonly<Record<Level, readonly PianoRightStyle[]>>;
}

export const PIANO_IDENTITY_TEMPLATE_LIMITS: Readonly<Record<string, PianoIdentityTemplateLimits>> = Object.freeze({
  'chamber-counterpoint': {
    archetypes: { lyrical: 3, dialogue: 3, flowing: 2, chorale: 2 },
    left: {
      1: ['broken-quarters', 'bass-and-chord', 'half-notes'],
      2: ['alberti-eighths', 'rolling-arpeggio', 'broken-quarters'],
      3: ['rolling-arpeggio', 'alberti-eighths', 'broken-tenths'],
    },
    right: { 1: ['held', 'restrike'], 2: ['flowing-inner', 'held', 'answer-chords', 'restrike'], 3: ['flowing-inner', 'answer-chords', 'restrike'] },
  },
  'sonata-dialogue': {
    archetypes: { lyrical: 3, dialogue: 3, rhythmic: 2, flowing: 2 },
    left: {
      1: ['broken-quarters', 'walking', 'bass-and-chord'],
      2: ['alberti-eighths', 'broken-tenths', 'rolling-arpeggio', 'walking', 'cell-figure'],
      3: ['rolling-arpeggio', 'alberti-eighths', 'broken-tenths', 'stride'],
    },
    right: { 1: ['held', 'restrike'], 2: ['flowing-inner', 'restrike', 'answer-chords', 'block-chords'], 3: ['block-chords', 'flowing-inner', 'answer-chords'] },
  },
  'vocal-space': {
    archetypes: { chorale: 3, sparse: 3, flowing: 2 },
    left: {
      1: ['bass-and-chord', 'broken-quarters', 'half-notes'],
      2: ['rolling-arpeggio', 'broken-quarters', 'bass-and-chord'],
      3: ['rolling-arpeggio'],
    },
    right: { 1: ['held'], 2: ['restrike', 'held'], 3: ['restrike'] },
  },
  'cinematic-expanse': {
    archetypes: { sparse: 3, lyrical: 3, flowing: 2, rhythmic: 2 },
    left: {
      1: ['broken-quarters', 'bass-and-chord', 'half-notes', 'pulse-quarters'],
      2: ['rolling-arpeggio', 'broken-tenths', 'ostinato-332', 'pulse-quarters'],
      3: ['rolling-arpeggio', 'broken-tenths', 'ostinato-332'],
    },
    right: { 1: ['held'], 2: ['restrike', 'held', 'block-chords'], 3: ['block-chords', 'restrike'] },
  },
  'hybrid-pulse-and-color': {
    archetypes: { rhythmic: 3, sparse: 2, flowing: 2 },
    left: {
      1: ['pulse-quarters', 'bass-and-chord', 'half-notes'],
      2: ['ostinato-332', 'stride', 'cell-figure', 'pulse-quarters'],
      3: ['ostinato-332', 'cell-figure', 'stride'],
    },
    right: { 1: ['held', 'offbeat-stabs'], 2: ['offbeat-stabs', 'restrike', 'answer-chords'], 3: ['offbeat-stabs', 'answer-chords', 'block-chords'] },
  },
  'adaptive-spacious': {
    archetypes: { lyrical: 1, rhythmic: 1, dialogue: 1, chorale: 1, flowing: 1, sparse: 1 },
    left: {
      1: ['broken-quarters', 'bass-and-chord', 'half-notes'],
      2: ['rolling-arpeggio', 'alberti-eighths', 'broken-quarters'],
      3: ['rolling-arpeggio', 'broken-tenths'],
    },
    right: { 1: ['held', 'restrike'], 2: ['restrike', 'held', 'flowing-inner'], 3: ['block-chords', 'restrike'] },
  },
});

/** Template facts the identity must respect; supplied by the composer from its template profile. */
export interface PianoIdentityTemplateFacts {
  readonly templateIdentity: string;
  /** Contours the template favours; they are weighted up, never forced. */
  readonly contours: readonly string[];
  /** Whether the template lets the left hand carry the theme at all. */
  readonly leftHandTheme: boolean;
  /** Middle C = 60. The climax may lift an octave only from a centre of 74 or lower. */
  readonly melodyCenter: number;
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export interface PianoCompositionIdentity {
  readonly version: 1;
  readonly archetype: PianoArchetype;
  readonly generation: {
    /** Song, template and user seed. Does not change when Compose All is pressed again. */
    readonly projectSeed: number;
    /** 0 for the first Compose All, 1 for the next, and so on. */
    readonly takeIndex: number;
    /** Each cycle uses every allowed archetype once, in a seeded order. */
    readonly cycle: number;
    readonly positionInCycle: number;
    readonly archetypeOrder: readonly PianoArchetype[];
    /** Seed of the draws inside this identity (project seed and take, never density). */
    readonly compositionSeed: number;
  };
  readonly theme: {
    readonly contour: PianoThemeContour;
    readonly form: PianoThemeForm;
    /** Bars of new material before the theme repeats itself: 2 for question-answer, else 4. */
    readonly ideaBars: 2 | 4;
    readonly headRhythm: string;
    readonly landingRhythm: string;
    readonly cadenceRhythm: string;
    readonly range: readonly [number, number];
  };
  readonly rhythm: {
    /** Eighth slots of the head's attacks: the cell the piece keeps returning to. */
    readonly cell: readonly number[];
    readonly placement: 'on-beat' | 'off-beat' | 'after-rest';
    /** Eighth slots of the head bar in which the line is silent. */
    readonly restSlots: number;
    /** Which part repeats the cell besides the theme. */
    readonly carrier: 'theme' | 'left-hand' | 'right-hand';
  };
  readonly accompaniment: {
    readonly left: Readonly<Record<Level, PianoLeftPattern>>;
    /** Used in every second distinct section when `changeBySection` is set. */
    readonly leftAlternate: Readonly<Record<Level, PianoLeftPattern>>;
    readonly right: Readonly<Record<Level, PianoRightStyle>>;
    readonly rightAlternate: Readonly<Record<Level, PianoRightStyle>>;
    readonly changeBySection: boolean;
    readonly leftHandTheme: PianoLeftThemePolicy;
  };
  readonly development: {
    readonly operations: Readonly<Record<Exclude<PianoArcRole, 'development' | 'breath'>, PianoThemeOperation>>;
    /** Successive development phrases walk this list. */
    readonly cycle: readonly PianoThemeOperation[];
    /** A new section counts as a contrast from this distinct-section index on (Classic: 2). */
    readonly contrastFromSection: 1 | 2;
  };
  readonly trajectory: {
    readonly shape: PianoTrajectoryShape;
    readonly levelBias: number;
    /** Lowest texture level of a sounding bar (the final landing excepted). Ceilings still apply. */
    readonly levelFloor: 0 | 1;
    /** Which of several equally energetic phrases becomes the climax. */
    readonly climax: 'energy' | 'early' | 'late';
  };
  readonly dynamics: {
    readonly shape: PianoDynamicShape;
    /** Width of the loud-soft contrast around the middle; the template's cap still applies. */
    readonly contrast: number;
    readonly hairpinDepth: number;
    readonly hairpinPeak: number;
  };
  readonly techniques: {
    readonly ornaments: boolean;
    readonly runs: PianoRunPolicy;
    /** Octave reinforcement is used only where the template's octave rule also allows it. */
    readonly octaves: boolean;
  };
  /** What adaptation gives up last. */
  readonly protectedTraits: readonly PianoProtectedTrait[];
  /** Plain-language description for reports and audition notes. */
  readonly description: string;
}

/* ------------------------------------------------------------------ */
/* Deterministic draws                                                 */
/* ------------------------------------------------------------------ */

/** Seeded value in [0, 1). The label names the decision, so decisions do not disturb each other. */
export function identityRandom(seed: number, label: string): number {
  let hash = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash += 0x6d2b79f5;
  let value = hash;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function identityHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  return hash >>> 0;
}

/**
 * The order in which one cycle of takes visits the allowed archetypes.
 * A weighted, seeded shuffle: heavier archetypes tend to come earlier, the
 * order differs between project seeds and between cycles, and a new cycle
 * never starts with the archetype the previous cycle ended on.
 */
export function archetypeOrderForCycle(
  projectSeed: number,
  weights: Readonly<Partial<Record<PianoArchetype, number>>>,
  cycle: number,
): PianoArchetype[] {
  const allowed = PIANO_ARCHETYPES.filter((name) => (weights[name] ?? 0) > 0);
  if (!allowed.length) return ['lyrical'];
  const order = (index: number): PianoArchetype[] => allowed
    .map((name) => ({
      name,
      key: -Math.log(Math.max(1e-9, identityRandom(projectSeed, `archetype-order:${index}:${name}`))) / (weights[name] ?? 1),
    }))
    .sort((a, b) => a.key - b.key || a.name.localeCompare(b.name))
    .map((entry) => entry.name);
  const current = order(cycle);
  if (cycle > 0 && current.length > 1) {
    const previous = archetypeOrderForCycle(projectSeed, weights, cycle - 1);
    if (current[0] === previous[previous.length - 1]) [current[0], current[1]] = [current[1], current[0]];
  }
  return current;
}

export interface PianoIdentityRequest {
  readonly projectSeed: number;
  /** Take about to be written by Compose All (1 for the first). */
  readonly take: number;
  /** Seed of the composition stream: project and take, never density. */
  readonly compositionSeed: number;
  readonly template: PianoIdentityTemplateFacts;
}

const cellSlots = (id: string): number[] => (IDENTITY_RHYTHMS[id] ?? []).map(([position]) => position);

/** Does this combination keep beats one and three audible somewhere? */
function marksTheBeat(cell: readonly number[], left: PianoLeftPattern): boolean {
  const attacks = leftPatternAttacks(left, cell);
  return (cell.includes(0) && cell.includes(4)) || (attacks.includes(0) && attacks.includes(4));
}

const OFFBEAT_RIGHT: readonly PianoRightStyle[] = ['offbeat-stabs', 'answer-chords'];
const FRAGMENTING: readonly PianoThemeOperation[] = ['fragment-extension', 'rising-fragments'];

/** Derive the identity of one generation. Pure and deterministic. */
export function derivePianoCompositionIdentity(request: PianoIdentityRequest): PianoCompositionIdentity {
  const limits = PIANO_IDENTITY_TEMPLATE_LIMITS[request.template.templateIdentity] ?? PIANO_IDENTITY_TEMPLATE_LIMITS['adaptive-spacious'];
  const takeIndex = Math.max(0, Math.trunc(request.take) - 1);
  const allowedCount = Math.max(1, PIANO_ARCHETYPES.filter((name) => (limits.archetypes[name] ?? 0) > 0).length);
  const cycle = Math.floor(takeIndex / allowedCount);
  const positionInCycle = takeIndex % allowedCount;
  const archetypeOrder = archetypeOrderForCycle(request.projectSeed, limits.archetypes, cycle);
  const archetype = archetypeOrder[positionInCycle] ?? archetypeOrder[0];
  const spec = ARCHETYPES[archetype];
  const seed = request.compositionSeed >>> 0;
  const draw = (label: string): number => identityRandom(seed, `identity:${label}`);
  const pick = <T>(items: readonly T[], label: string): T => items[Math.floor(draw(label) * items.length)] ?? items[0];

  /* ---- theme and rhythm: one cell, chosen first, everything else follows it ---- */
  const contourPool = spec.contours.flatMap((contour) => (request.template.contours.includes(contour) ? [contour, contour] : [contour]));
  const contour = pick(contourPool, 'contour');
  const form = pick(spec.forms, 'form');
  const headRhythm = pick(spec.heads, 'head-rhythm');
  const landingRhythm = pick(spec.landings, 'landing-rhythm');
  const cadenceRhythm = pick(spec.cadences, 'cadence-rhythm');
  const head = IDENTITY_RHYTHMS[headRhythm];
  const cell = cellSlots(headRhythm);
  const offbeatOnsets = cell.filter((slot) => slot % 2 === 1).length;
  const covered = new Set<number>();
  for (const [position, length] of head) for (let slot = position; slot < position + length; slot++) covered.add(slot);
  const restSlots = 8 - covered.size;
  const offBeatTheme = cell[0] > 0 || offbeatOnsets >= 2;
  const placement: PianoCompositionIdentity['rhythm']['placement'] = cell[0] > 0 ? 'after-rest' : offbeatOnsets >= 2 ? 'off-beat' : 'on-beat';
  const busyTheme = cell.length >= 6;

  /* ---- accompaniment: archetype preference, inside the template's allowed set ---- */
  const leftOk = (pattern: PianoLeftPattern, level: Level): boolean => {
    if (pattern === 'cell-figure' && cell.length < 3) return false;
    // Rule: beats one and three stay audible in the theme or in the left hand.
    if (level >= 2 && !marksTheBeat(cell, pattern)) return false;
    return true;
  };
  const rightOk = (style: PianoRightStyle, left: PianoLeftPattern): boolean => {
    // Rule: an off-beat theme is not answered by a second off-beat layer.
    if (offBeatTheme && OFFBEAT_RIGHT.includes(style)) return false;
    // Rule: a running theme does not get a third moving voice.
    if (busyTheme && style === 'flowing-inner') return false;
    // Rule: when the left hand doubles the theme's rhythm, the right hand stays calm.
    if (left === 'cell-figure' && style !== 'held' && style !== 'restrike' && style !== 'block-chords') return false;
    return true;
  };
  const candidates = <T>(preference: readonly T[], allowed: readonly T[], ok: (item: T) => boolean): T[] => {
    const inTemplate = preference.filter((item) => allowed.includes(item));
    const compatible = inTemplate.filter(ok);
    // The template's own first choice is the last resort: template authority outranks a rule.
    return compatible.length ? compatible : inTemplate.length ? inTemplate : [allowed[0]];
  };
  const left = {} as Record<Level, PianoLeftPattern>;
  const leftAlternate = {} as Record<Level, PianoLeftPattern>;
  const right = {} as Record<Level, PianoRightStyle>;
  const rightAlternate = {} as Record<Level, PianoRightStyle>;
  for (const level of [1, 2, 3] as const) {
    const leftList = candidates(spec.left[level], limits.left[level], (pattern) => leftOk(pattern, level));
    const first = leftList.length > 1 && draw(`left:${level}`) >= 0.7 ? 1 : 0;
    left[level] = leftList[first];
    leftAlternate[level] = leftList[first === 0 ? Math.min(1, leftList.length - 1) : 0];
    const rightList = (pattern: PianoLeftPattern) => candidates(spec.right[level], limits.right[level], (style) => rightOk(style, pattern));
    const primary = rightList(left[level]);
    const rightFirst = primary.length > 1 && draw(`right:${level}`) >= 0.7 ? 1 : 0;
    right[level] = primary[rightFirst];
    const secondary = rightList(leftAlternate[level]);
    rightAlternate[level] = secondary.find((style) => style !== right[level]) ?? secondary[0];
  }
  const changeBySection = draw('change-by-section') < (archetype === 'chorale' || archetype === 'sparse' ? 0.35 : 0.65);
  const leftHandTheme: PianoLeftThemePolicy = request.template.leftHandTheme ? spec.leftTheme : 'never';

  /* ---- development ---- */
  const usable = (operation: PianoThemeOperation): boolean => {
    // Rule: fragmenting needs a head with a separable opening.
    if (FRAGMENTING.includes(operation) && cell.length < 3) return false;
    // Rule: the hands exchange the theme only where the template lets the left hand carry it.
    if (operation === 'hand-exchange' && leftHandTheme === 'never') return false;
    // Template register authority: a lift exists only where the template's centre leaves room.
    if (operation === 'register-lift' && request.template.melodyCenter > 74) return false;
    return true;
  };
  const choose = (options: readonly PianoThemeOperation[], label: string, fallback: PianoThemeOperation): PianoThemeOperation => {
    const valid = options.filter(usable);
    return valid.length ? pick(valid, label) : fallback;
  };
  const cycleOptions = spec.developments
    .map((list) => list.filter(usable))
    .filter((list) => list.length > 0);
  let developmentCycle: PianoThemeOperation[] = [...(cycleOptions.length ? pick(cycleOptions, 'development-cycle') : ['sequence' as PianoThemeOperation])];
  if (developmentCycle.length < 2) developmentCycle = [...developmentCycle, developmentCycle[0] === 'sequence' ? 'tail-sequence' : 'sequence'];
  const operations: PianoCompositionIdentity['development']['operations'] = {
    statement: 'statement',
    response: 'answer-fragment',
    arrival: 'cadential-return',
    reprise: choose(spec.reprise, 'reprise', 'ornamented-reprise'),
    // The formal high point keeps the theme whole: a lift where the register allows, else a full statement.
    climax: choose(spec.climax, 'climax', 'statement'),
    build: choose(spec.build, 'build', 'sequence'),
    contrast: choose(spec.contrast, 'contrast', 'inversion'),
    release: choose(spec.release, 'release', 'augmented-skeleton'),
  };

  /* ---- trajectory, dynamics, techniques ---- */
  const shape = pick(spec.trajectories, 'trajectory');
  const dynamicShape = pick(spec.dynamics, 'dynamics');
  const contrast = Math.round((spec.contrastWidth[0] + draw('contrast') * (spec.contrastWidth[1] - spec.contrastWidth[0])) * 100) / 100;
  const ornaments = draw('ornaments') < spec.ornamentChance && !busyTheme;
  const octaves = draw('octaves') < spec.octaveChance;
  const carrier: PianoCompositionIdentity['rhythm']['carrier'] = left[2] === 'cell-figure' || left[3] === 'cell-figure' ? 'left-hand'
    : right[2] === 'answer-chords' || right[3] === 'answer-chords' ? 'right-hand' : 'theme';

  const identity: Omit<PianoCompositionIdentity, 'description'> = {
    version: 1,
    archetype,
    generation: {
      projectSeed: request.projectSeed >>> 0, takeIndex, cycle, positionInCycle, archetypeOrder, compositionSeed: seed,
    },
    theme: {
      contour, form, ideaBars: form === 'question-answer' ? 2 : 4, headRhythm, landingRhythm, cadenceRhythm, range: spec.range,
    },
    rhythm: { cell, placement, restSlots, carrier },
    accompaniment: { left, leftAlternate, right, rightAlternate, changeBySection, leftHandTheme },
    development: {
      operations,
      cycle: developmentCycle,
      contrastFromSection: draw('early-contrast') < spec.earlyContrastChance ? 1 : 2,
    },
    trajectory: {
      shape,
      levelBias: spec.levelBias,
      levelFloor: spec.levelFloor,
      climax: shape === 'early-peak' ? 'early' : shape === 'late-peak' ? 'late' : 'energy',
    },
    dynamics: { shape: dynamicShape, contrast, hairpinDepth: spec.hairpin[0], hairpinPeak: spec.hairpin[1] },
    techniques: { ornaments, runs: spec.runs, octaves },
    protectedTraits: spec.protectedTraits,
  };
  return deepFreeze({ ...identity, description: describePianoIdentity(identity) });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/* Curves                                                              */
/* ------------------------------------------------------------------ */

/** Texture bias over the piece (position 0..1), in texture levels. */
export function trajectoryBias(shape: PianoTrajectoryShape, position: number): number {
  const x = Math.max(0, Math.min(1, position));
  switch (shape) {
    case 'late-peak': return x < 0.85 ? -0.5 + 1.1 * (x / 0.85) : 0.6 - 2 * (x - 0.85);
    case 'early-peak': return 0.5 * Math.cos(2 * Math.PI * (x - 0.3)) * (x < 0.8 ? 1 : 0.4);
    case 'terraced': return [-0.4, 0.3, -0.15, 0.45][Math.min(3, Math.floor(x * 4))];
    case 'two-waves': return 0.45 * Math.sin(4 * Math.PI * x - Math.PI / 2);
    default: return 0;
  }
}

/** Loudness bias over the piece (position 0..1), in intensity steps. */
export function dynamicBias(shape: PianoDynamicShape, position: number): number {
  const x = Math.max(0, Math.min(1, position));
  switch (shape) {
    case 'arch': return 0.6 * Math.sin(Math.PI * x) - 0.3;
    case 'long-crescendo': return -0.55 + 1.1 * x;
    case 'terraced': return [-0.5, 0.35, -0.2, 0.55][Math.min(3, Math.floor(x * 4))];
    case 'waves': return 0.45 * Math.sin(4 * Math.PI * x - Math.PI / 2);
    default: return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Compatibility                                                       */
/* ------------------------------------------------------------------ */

/**
 * Check a record against the compatibility rules and its template. Returns
 * one sentence per broken rule; an empty list means the identity is coherent.
 */
export function validatePianoCompositionIdentity(identity: PianoCompositionIdentity, template: PianoIdentityTemplateFacts): string[] {
  const problems: string[] = [];
  const limits = PIANO_IDENTITY_TEMPLATE_LIMITS[template.templateIdentity] ?? PIANO_IDENTITY_TEMPLATE_LIMITS['adaptive-spacious'];
  const { cell } = identity.rhythm;
  const offBeatTheme = cell[0] > 0 || cell.filter((slot) => slot % 2 === 1).length >= 2;
  if (!((limits.archetypes[identity.archetype] ?? 0) > 0)) problems.push(`Archetype ${identity.archetype} is not allowed in ${template.templateIdentity}.`);
  for (const level of [1, 2, 3] as const) {
    for (const [name, pattern] of [['left', identity.accompaniment.left[level]], ['alternate left', identity.accompaniment.leftAlternate[level]]] as const) {
      if (!limits.left[level].includes(pattern)) problems.push(`Level ${level} ${name} figure ${pattern} is outside the template.`);
      const alternatives = limits.left[level].filter((other) => (other !== 'cell-figure' || cell.length >= 3) && marksTheBeat(cell, other));
      if (level >= 2 && !marksTheBeat(cell, pattern) && alternatives.length) problems.push(`Level ${level} ${name} figure ${pattern} leaves beats one and three unmarked under this theme.`);
      if (pattern === 'cell-figure' && cell.length < 3) problems.push('The left hand repeats a cell that has fewer than three attacks.');
    }
    for (const [name, style, under] of [
      ['right', identity.accompaniment.right[level], identity.accompaniment.left[level]],
      ['alternate right', identity.accompaniment.rightAlternate[level], identity.accompaniment.leftAlternate[level]],
    ] as const) {
      if (!limits.right[level].includes(style)) problems.push(`Level ${level} ${name} style ${style} is outside the template.`);
      const calm = (other: PianoRightStyle) => !(offBeatTheme && OFFBEAT_RIGHT.includes(other)) && !(cell.length >= 6 && other === 'flowing-inner')
        && !(under === 'cell-figure' && other !== 'held' && other !== 'restrike' && other !== 'block-chords');
      if (!calm(style) && limits.right[level].some(calm)) problems.push(`Level ${level} ${name} style ${style} is incompatible with this theme and left hand.`);
    }
  }
  const operations = [...Object.values(identity.development.operations), ...identity.development.cycle];
  if (cell.length < 3 && operations.some((operation) => FRAGMENTING.includes(operation))) problems.push('A fragmenting development is planned for a head without a separable opening.');
  if (identity.accompaniment.leftHandTheme === 'never' && operations.includes('hand-exchange')) problems.push('A hand exchange is planned although the left hand never carries the theme.');
  if (!template.leftHandTheme && identity.accompaniment.leftHandTheme !== 'never') problems.push('The left hand carries the theme in a template that does not allow it.');
  if (template.melodyCenter > 74 && operations.includes('register-lift')) problems.push('A register lift is planned above the template register.');
  if (identity.development.operations.statement !== 'statement') problems.push('The first phrase must state the theme.');
  if (identity.development.operations.arrival !== 'cadential-return') problems.push('The last phrase must return to the theme.');
  return problems;
}

/* ------------------------------------------------------------------ */
/* Plain-language description                                          */
/* ------------------------------------------------------------------ */

const LEFT_WORDS: Readonly<Record<PianoLeftPattern, string>> = {
  sustain: 'held bass notes',
  'half-notes': 'bass and fifth in half notes',
  'broken-quarters': 'broken chords in quarter notes',
  'bass-and-chord': 'a bass note answered by a chord',
  walking: 'a walking bass',
  'pulse-quarters': 'a quarter-note pulse',
  'alberti-eighths': 'an Alberti figure in eighth notes',
  'rolling-arpeggio': 'rolling arpeggios',
  'broken-tenths': 'wide broken tenths',
  stride: 'a stride pattern',
  'ostinato-332': 'a 3+3+2 ostinato',
  'cell-figure': 'a figure in the rhythm of the theme',
};
const RIGHT_WORDS: Readonly<Record<PianoRightStyle, string>> = {
  held: 'held inner notes',
  restrike: 'chords struck twice a bar',
  'flowing-inner': 'a moving inner voice',
  'offbeat-stabs': 'short off-beat chords',
  'block-chords': 'full block chords',
  'answer-chords': 'chords placed in the gaps of the melody',
};
const CONTOUR_WORDS: Readonly<Record<PianoThemeContour, string>> = {
  arch: 'rises by step and falls back',
  'leap-fill': 'starts with a leap and fills it in by step',
  'descent-rise': 'falls from above and turns up at the end',
  wave: 'moves in a zigzag',
  rise: 'climbs by step',
  fall: 'descends by step',
  pendulum: 'swings around one note',
  'repeat-step': 'repeats each note before moving on',
};
const FORM_WORDS: Readonly<Record<PianoThemeForm, string>> = {
  period: 'a four-bar theme whose opening returns in bar three',
  sentence: 'a four-bar theme that repeats its opening at once and then continues',
  'question-answer': 'a two-bar idea heard twice, first left open, then closed',
  'long-line': 'a four-bar line without an internal repeat',
};
const OPERATION_WORDS: Readonly<Record<PianoThemeOperation, string>> = {
  statement: 'a plain statement',
  sequence: 'a rising sequence',
  'descending-sequence': 'a falling sequence',
  'fragment-extension': 'fragments of the opening',
  inversion: 'the theme turned upside down',
  'rising-fragments': 'rising fragments',
  'register-lift': 'the theme an octave higher',
  'ornamented-reprise': 'an ornamented return',
  'augmented-skeleton': 'the theme reduced to its main notes',
  'answer-fragment': 'its closing fragment',
  'cadential-return': 'a closing return',
  'hand-exchange': 'the theme passed between the hands',
  'tail-sequence': 'a sequence on the second bar of the theme',
  rest: 'silence',
};
const TRAJECTORY_WORDS: Readonly<Record<PianoTrajectoryShape, string>> = {
  'late-peak': 'thickens steadily towards a late high point',
  'early-peak': 'is fullest early, thins, and recovers',
  terraced: 'changes texture in blocks, section by section',
  'two-waves': 'swells and thins twice',
  plateau: 'follows the energy of the song without a curve of its own',
};
const DYNAMIC_WORDS: Readonly<Record<PianoDynamicShape, string>> = {
  arch: 'loudest in the middle',
  'long-crescendo': 'one long crescendo',
  terraced: 'stepped, block dynamics',
  waves: 'two swells',
  level: 'an even level',
};

export function describePianoIdentity(identity: Omit<PianoCompositionIdentity, 'description'>): string {
  const spec = ARCHETYPES[identity.archetype];
  const { accompaniment, development, theme, rhythm } = identity;
  const name = identity.archetype[0].toUpperCase() + identity.archetype.slice(1);
  const rhythmWords = rhythm.placement === 'after-rest' ? 'It enters after a rest'
    : rhythm.placement === 'off-beat' ? 'Its accents fall off the beat' : 'It sits on the beat';
  const rests = rhythm.restSlots >= 2 ? ' and leaves part of the bar silent' : '';
  const techniques = [
    identity.techniques.ornaments ? 'ornaments on the return' : null,
    identity.techniques.runs === 'free' ? 'scale runs' : identity.techniques.runs === 'cadential' ? 'a run into the high point' : null,
    identity.techniques.octaves ? 'octaves at the high point where the template allows' : null,
    accompaniment.leftHandTheme === 'frequent' ? 'the theme often in the left hand' : accompaniment.leftHandTheme === 'answer' ? 'the theme in the left hand in long phrases' : null,
  ].filter((entry): entry is string => entry !== null);
  return [
    `${name}. ${spec.summary}`,
    `Theme: ${FORM_WORDS[theme.form]}; the opening ${CONTOUR_WORDS[theme.contour]}. ${rhythmWords}${rests}.`,
    `Accompaniment: left hand ${LEFT_WORDS[accompaniment.left[2]]} (lighter passages: ${LEFT_WORDS[accompaniment.left[1]]}); right hand ${RIGHT_WORDS[accompaniment.right[2]]}`
      + `${accompaniment.changeBySection && accompaniment.leftAlternate[2] !== accompaniment.left[2] ? `; alternate sections change to ${LEFT_WORDS[accompaniment.leftAlternate[2]]}` : ''}.`,
    `Development: ${development.cycle.map((operation) => OPERATION_WORDS[operation]).join(', then ')}; contrast by ${OPERATION_WORDS[development.operations.contrast]}; `
      + `the return as ${OPERATION_WORDS[development.operations.reprise]}; high point with ${OPERATION_WORDS[development.operations.climax]}.`,
    `Shape: the texture ${TRAJECTORY_WORDS[identity.trajectory.shape]}; dynamics: ${DYNAMIC_WORDS[identity.dynamics.shape]}.`,
    techniques.length ? `Techniques: ${techniques.join(', ')}.` : 'Techniques: none beyond the basic texture.',
  ].join(' ');
}
