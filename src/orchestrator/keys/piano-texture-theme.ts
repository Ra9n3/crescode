/**
 * Piano Texture-and-Theme Composer.
 *
 * This is the Composer's note-writing layer:
 *
 *   Section Arc Plan -> Theme Layer -> Pattern/Texture Layer
 *     -> Bounded Orchestral Adaptation -> draft events for PianoScore
 *
 * The independent composition is derived only from the supplied form,
 * harmony, energy, density, template and seed. Orchestral evidence is read
 * afterwards and may only change role, register, texture level, emphasis and
 * local activity through recorded adaptation directives; it never becomes a
 * permission gate for the whole part. Independent and adaptation decisions
 * draw from separate deterministic label streams, so a different arrangement
 * cannot re-roll the Piano theme or its pattern families.
 *
 * Nothing here is persisted: diagnostics are an ephemeral sidecar.
 */
import {
  DEFAULT_PIANO_COMPOSITION_MODE, IDENTITY_RHYTHMS, derivePianoCompositionIdentity, dynamicBias, identityHash, trajectoryBias,
  type PianoCompositionIdentity, type PianoCompositionMode, type PianoIdentityTemplateFacts, type PianoThemeContour,
} from './piano-composition-identity';
import { PPQ } from '../../shared/schema/types';
import type { Articulation, NoteRoleTag } from '../../shared/schema/types';
import type { PianoEngineInput } from './piano-engine';
import type { PianoComposerPlan, PianoHarmonicEvent, PianoTemplateIdentity } from './piano-composer';
import type {
  PianoGestureIntent, PianoHand, PianoMusicalRole, PianoScoreTarget, PianoScoreVoiceId, PianoTechniqueIntent,
} from './piano-score';

export type PianoArcRole =
  | 'statement' | 'development' | 'contrast' | 'response' | 'reprise'
  | 'build' | 'climax' | 'release' | 'arrival' | 'breath';
export type PianoTextureLevel = 0 | 1 | 2 | 3;
export type PianoThemeOperation =
  | 'statement' | 'sequence' | 'fragment-extension' | 'inversion' | 'rising-fragments'
  | 'register-lift' | 'ornamented-reprise' | 'augmented-skeleton' | 'answer-fragment'
  | 'cadential-return' | 'rest'
  /** Identity composer only. */
  | 'descending-sequence' | 'hand-exchange' | 'tail-sequence';
export type PianoLeftPattern =
  | 'sustain' | 'broken-quarters' | 'bass-and-chord' | 'walking' | 'pulse-quarters'
  | 'alberti-eighths' | 'rolling-arpeggio' | 'broken-tenths' | 'stride' | 'ostinato-332'
  /** Identity composer only. */
  | 'half-notes' | 'cell-figure';
export type PianoRightStyle = 'held' | 'restrike' | 'flowing-inner' | 'offbeat-stabs' | 'block-chords'
  /** Identity composer only. */
  | 'answer-chords';
export type PianoLayer = 'melody' | 'bass' | 'accompaniment' | 'inner';

export interface PianoArcBar {
  readonly bar: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly phraseId: string;
  readonly energy: number;
  readonly restricted: boolean;
  /** Independent decisions. */
  readonly level: PianoTextureLevel;
  readonly intensity: number;
  readonly leftPattern: PianoLeftPattern;
  readonly rightStyle: PianoRightStyle;
  readonly themeBar: number | null;
  readonly themeStepShift: number;
  readonly themeInvert: boolean;
  readonly themeOctave: number;
  readonly themeHand: PianoHand;
  readonly ornament: boolean;
  readonly octaveDouble: boolean;
  readonly run: 'up' | 'down' | null;
  readonly finalLanding: boolean;
  /** Identity composer only: the theme bar is reduced to its structural notes. */
  readonly themeSkeleton?: boolean;
}

export interface PianoArcPhrase {
  readonly phraseId: string;
  readonly sectionId: string;
  readonly sectionName: string;
  readonly startBar: number;
  readonly endBar: number;
  readonly role: PianoArcRole;
  readonly themeOperation: PianoThemeOperation;
  readonly meanEnergy: number;
  readonly levels: readonly PianoTextureLevel[];
  readonly rationale: string;
}

export interface PianoThemeNote {
  /** Eighth-note position inside the theme bar. */
  readonly pos: number;
  /** Length in eighth notes. */
  readonly dur: number;
  /** Diatonic step offset from the theme anchor. */
  readonly step: number;
  /** Structural tones are fitted to the sounding chord; others pass or neighbour by step. */
  readonly structural: boolean;
}

export interface PianoTheme {
  readonly id: 'piano-theme-main';
  readonly scalePitchClasses: readonly number[];
  readonly anchorPitchClass: number;
  readonly contour: string;
  readonly rhythm: readonly string[];
  readonly bars: readonly (readonly PianoThemeNote[])[];
  readonly eventCount: number;
}

export interface PianoAdaptationRecord {
  readonly bar: number;
  readonly kind:
    | 'accompany-lead' | 'answer-in-lead-rests' | 'register-shift' | 'texture-level-lowered'
    | 'right-hand-thinned' | 'left-hand-simplified' | 'moment-yield' | 'moment-support'
    | 'unison-substitution' | 'velocity-trim';
  readonly reason: string;
  readonly evidence: string;
}

interface BarDirective {
  level: PianoTextureLevel;
  melody: 'theme' | 'skeleton' | 'answers' | 'none';
  registerShift: number;
  velocityTrim: number;
  melodyTrim: number;
  rightCap: PianoRightStyle | null;
  leftCap: PianoTextureLevel | null;
  /** Identity composer only: protected traits. Nothing here forces a note through a real conflict. */
  protectHead?: boolean;
  rightThin?: boolean;
  leftLight?: boolean;
}

export interface PianoDraftEvent {
  readonly pitch: number;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly hand: PianoHand;
  readonly voiceId: PianoScoreVoiceId;
  readonly layer: PianoLayer;
  readonly musicalRole: PianoMusicalRole;
  readonly gestureIntent: PianoGestureIntent;
  readonly techniqueIntent: PianoTechniqueIntent;
  readonly noteRoleTag: NoteRoleTag;
  readonly articulation: Articulation;
  readonly velocity: number;
  readonly intensity: number;
  readonly chordId: string;
  readonly phraseId: string;
  readonly sectionId: string;
  readonly bar: number;
}

export interface PianoLayerActivity {
  readonly melody: number;
  readonly bass: number;
  readonly accompaniment: number;
  readonly inner: number;
}

export interface PianoCompositionDiagnostics {
  readonly version: 1;
  readonly algorithm: 'piano-texture-theme-v1' | 'piano-composition-identity-v1';
  /** Present only when the identity composer wrote the piece; absent in Classic mode. */
  readonly identity?: PianoCompositionIdentity;
  readonly templateIdentity: PianoTemplateIdentity;
  readonly density: number;
  readonly randomStreams: { readonly independent: string; readonly adaptation: string };
  readonly theme: PianoTheme | null;
  readonly phrases: readonly (PianoArcPhrase & {
    readonly adaptedLevels: readonly PianoTextureLevel[];
    readonly melodyEvents: { readonly independent: number; readonly adapted: number };
    readonly attacksPerBar: { readonly independent: number; readonly adapted: number };
  })[];
  readonly bars: readonly {
    readonly bar: number;
    readonly phraseId: string;
    readonly role: PianoArcRole;
    readonly energy: number;
    readonly independentLevel: PianoTextureLevel;
    readonly adaptedLevel: PianoTextureLevel;
    readonly leftPattern: PianoLeftPattern;
    readonly rightStyle: PianoRightStyle;
    readonly themeBar: number | null;
    readonly independent: PianoLayerActivity & { readonly attacks: number };
    readonly adapted: PianoLayerActivity & { readonly attacks: number };
  }[];
  readonly independentDraft: {
    readonly events: number;
    readonly notes: readonly { readonly t: number; readonly d: number; readonly p: number; readonly v: number; readonly l: PianoLayer; readonly k: string }[];
  };
  readonly adaptedDraft: { readonly events: number };
  readonly adaptation: {
    readonly evidence: 'available' | 'none';
    readonly records: readonly PianoAdaptationRecord[];
    readonly changes: {
      readonly unchanged: number; readonly removed: number; readonly added: number;
      readonly registerMoved: number; readonly revoiced: number; readonly shortened: number; readonly softened: number;
    };
  };
  readonly metrics: {
    readonly attacksPerBar: number;
    readonly melodyEventsPerPhrase: number;
    readonly subdivisions: { readonly beat: number; readonly eighth: number; readonly sixteenth: number };
    readonly longNoteShare: number;
    readonly chordalEvents: number;
    readonly patternUsage: Readonly<Record<string, number>>;
    readonly velocityRange: readonly [number, number];
    readonly textureLevelBars: readonly [number, number, number, number];
  };
  readonly flags: readonly string[];
}

export interface PianoTextureThemeResult {
  readonly events: readonly PianoDraftEvent[];
  readonly diagnostics: PianoCompositionDiagnostics;
}

/* ------------------------------------------------------------------ */
/* Deterministic streams                                               */
/* ------------------------------------------------------------------ */

function unitRandom(seed: number, label: string): number {
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

/**
 * Seed of the independent composition stream. It is built from the project,
 * user seed and take only: density and the arrangement are deliberately not
 * part of it, so the same piece keeps the same theme at every density.
 */
function compositionSeed(plan: PianoComposerPlan): number {
  const identity = plan.generationIdentity;
  return Math.round(unitRandom(identity.orchestrationSeed >>> 0, `composition:${identity.userSeed}:${identity.take}`) * 4294967295) >>> 0;
}

const pc = (value: number): number => ((value % 12) + 12) % 12;
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const EIGHTH = PPQ / 2;

/* ------------------------------------------------------------------ */
/* Template profiles                                                   */
/* ------------------------------------------------------------------ */

interface TextureProfile {
  readonly ceiling: PianoTextureLevel;
  readonly levelBias: number;
  readonly melodyCenter: number;
  readonly bassCenter: number;
  readonly melodyPresence: 'full' | 'selective';
  readonly contours: readonly ('arch' | 'leap-fill' | 'descent-rise' | 'wave')[];
  readonly headRhythms: readonly string[];
  readonly left: Readonly<Record<1 | 2 | 3, readonly PianoLeftPattern[]>>;
  readonly right: Readonly<Record<1 | 2 | 3, PianoRightStyle>>;
  readonly innerVoices: number;
  readonly leftHandTheme: boolean;
  readonly sixteenthRuns: boolean;
  readonly intensityCap: number;
}

const PROFILES: Readonly<Record<string, TextureProfile>> = Object.freeze({
  'chamber-counterpoint': {
    ceiling: 3, levelBias: -0.1, melodyCenter: 72, bassCenter: 41, melodyPresence: 'full',
    contours: ['wave', 'arch'], headRhythms: ['r1', 'r2', 'r3', 'r5'],
    left: { 1: ['broken-quarters', 'bass-and-chord'], 2: ['alberti-eighths', 'rolling-arpeggio'], 3: ['rolling-arpeggio', 'alberti-eighths'] },
    right: { 1: 'held', 2: 'flowing-inner', 3: 'flowing-inner' },
    innerVoices: 2, leftHandTheme: true, sixteenthRuns: false, intensityCap: 5,
  },
  'sonata-dialogue': {
    ceiling: 3, levelBias: 0.05, melodyCenter: 76, bassCenter: 45, melodyPresence: 'full',
    contours: ['leap-fill', 'arch'], headRhythms: ['r1', 'r7', 'r2', 'r3'],
    left: { 1: ['broken-quarters', 'walking'], 2: ['alberti-eighths', 'broken-tenths'], 3: ['rolling-arpeggio', 'alberti-eighths'] },
    right: { 1: 'held', 2: 'flowing-inner', 3: 'block-chords' },
    innerVoices: 2, leftHandTheme: true, sixteenthRuns: false, intensityCap: 5,
  },
  'vocal-space': {
    ceiling: 2, levelBias: -0.35, melodyCenter: 69, bassCenter: 45, melodyPresence: 'selective',
    contours: ['arch', 'wave'], headRhythms: ['r4', 'r10', 'r11'],
    left: { 1: ['bass-and-chord', 'broken-quarters'], 2: ['rolling-arpeggio', 'broken-quarters'], 3: ['rolling-arpeggio'] },
    right: { 1: 'held', 2: 'restrike', 3: 'restrike' },
    innerVoices: 2, leftHandTheme: false, sixteenthRuns: false, intensityCap: 4,
  },
  'cinematic-expanse': {
    ceiling: 3, levelBias: 0.1, melodyCenter: 77, bassCenter: 38, melodyPresence: 'full',
    contours: ['leap-fill', 'arch', 'descent-rise'], headRhythms: ['r1', 'r11', 'r2', 'r4'],
    left: { 1: ['broken-quarters', 'bass-and-chord'], 2: ['rolling-arpeggio', 'broken-tenths'], 3: ['rolling-arpeggio', 'broken-tenths'] },
    right: { 1: 'held', 2: 'restrike', 3: 'block-chords' },
    innerVoices: 3, leftHandTheme: false, sixteenthRuns: true, intensityCap: 5,
  },
  'hybrid-pulse-and-color': {
    ceiling: 3, levelBias: 0.05, melodyCenter: 72, bassCenter: 43, melodyPresence: 'full',
    contours: ['wave', 'leap-fill'], headRhythms: ['r6', 'r7', 'r5'],
    left: { 1: ['pulse-quarters', 'bass-and-chord'], 2: ['ostinato-332', 'stride'], 3: ['ostinato-332'] },
    right: { 1: 'held', 2: 'offbeat-stabs', 3: 'offbeat-stabs' },
    innerVoices: 2, leftHandTheme: false, sixteenthRuns: true, intensityCap: 5,
  },
  'adaptive-spacious': {
    ceiling: 3, levelBias: 0, melodyCenter: 74, bassCenter: 43, melodyPresence: 'full',
    contours: ['arch', 'leap-fill'], headRhythms: ['r1', 'r2', 'r3'],
    left: { 1: ['broken-quarters'], 2: ['rolling-arpeggio'], 3: ['rolling-arpeggio'] },
    right: { 1: 'held', 2: 'restrike', 3: 'block-chords' },
    innerVoices: 2, leftHandTheme: false, sixteenthRuns: false, intensityCap: 5,
  },
});

/** [position, length] pairs in eighth notes over a common-time bar. */
const RHYTHMS: Readonly<Record<string, readonly (readonly [number, number])[]>> = Object.freeze({
  r1: [[0, 3], [3, 1], [4, 2], [6, 2]],
  r2: [[0, 2], [2, 2], [4, 3], [7, 1]],
  r3: [[0, 2], [2, 1], [3, 1], [4, 4]],
  r4: [[0, 4], [4, 2], [6, 2]],
  r5: [[1, 1], [2, 2], [4, 2], [6, 2]],
  r6: [[0, 3], [3, 3], [6, 2]],
  r7: [[0, 1], [1, 1], [2, 2], [4, 3], [7, 1]],
  r8: [[0, 6], [6, 2]],
  r10: [[0, 2], [2, 2], [4, 4]],
  r11: [[0, 3], [3, 1], [4, 4]],
  l1: [[0, 4], [4, 2], [6, 2]],
  l2: [[0, 6], [6, 2]],
  l3: [[0, 2], [2, 2], [4, 4]],
  l4: [[0, 3], [3, 1], [4, 4]],
  c1: [[0, 4], [4, 4]],
  c2: [[0, 2], [2, 2], [4, 4]],
  c3: [[0, 8]],
});

/* ------------------------------------------------------------------ */
/* Harmony helpers                                                     */
/* ------------------------------------------------------------------ */

interface ChordInfo {
  readonly id: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly root: number;
  readonly bass: number;
  readonly tones: readonly number[];
  /** Guide tones first, then colour, fifth and root. */
  readonly rightPreference: readonly number[];
  readonly localScale: readonly number[];
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

function inferScale(input: PianoEngineInput): number[] {
  let best = 0;
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    const set = new Set(MAJOR.map((step) => pc(tonic + step)));
    let score = 0;
    for (const chord of input.context.harmony) {
      const weight = Math.max(1, chord.endTick - chord.startTick) / PPQ;
      for (const tone of chord.parsed.pitchClasses) score += set.has(pc(tone)) ? weight : -weight;
    }
    if (score > bestScore + 1e-9) { bestScore = score; best = tonic; }
  }
  return MAJOR.map((step) => pc(best + step)).sort((a, b) => a - b);
}

function localScaleFor(scale: readonly number[], tones: readonly number[]): number[] {
  const local = new Set(scale);
  const chord = new Set(tones.map(pc));
  for (const tone of chord) {
    if (local.has(tone)) continue;
    for (const neighbour of [pc(tone + 1), pc(tone - 1)]) {
      if (local.has(neighbour) && !chord.has(neighbour)) local.delete(neighbour);
    }
    local.add(tone);
  }
  return [...local].sort((a, b) => a - b);
}

function chordInfos(input: PianoEngineInput, scale: readonly number[]): ChordInfo[] {
  return [...input.context.harmony]
    .filter((chord) => chord.endTick > chord.startTick && chord.parsed.pitchClasses.length > 0)
    .sort((a, b) => a.startTick - b.startTick)
    .map((chord) => {
      const root = pc(chord.parsed.root);
      const tones = [...new Set(chord.parsed.pitchClasses.map(pc))];
      const byInterval = (intervals: readonly number[]) => tones.filter((tone) => intervals.includes(pc(tone - root)));
      const preference = [
        ...byInterval([3, 4]), ...byInterval([10, 11]), ...byInterval([2, 5, 9, 1, 6, 8]), ...byInterval([7]), ...byInterval([0]),
      ];
      const bass = chord.parsed.bass === null || chord.parsed.bass === undefined ? root : pc(chord.parsed.bass);
      return {
        id: chord.id,
        startTick: chord.startTick,
        endTick: chord.endTick,
        root,
        bass,
        tones: tones.includes(bass) ? tones : [...tones, bass],
        rightPreference: [...new Set([...preference, ...tones])],
        localScale: localScaleFor(scale, tones),
      };
    });
}

function stepInScale(pitch: number, steps: number, scale: readonly number[]): number {
  let current = pitch;
  if (!scale.includes(pc(current))) {
    for (let delta = 1; delta < 7; delta++) {
      if (scale.includes(pc(current - delta))) { current -= delta; break; }
      if (scale.includes(pc(current + delta))) { current += delta; break; }
    }
  }
  const direction = steps >= 0 ? 1 : -1;
  for (let remaining = Math.abs(steps); remaining > 0; remaining--) {
    do { current += direction; } while (!scale.includes(pc(current)));
  }
  return current;
}

function nearestWithClasses(pitch: number, classes: readonly number[], low: number, high: number, bias = 0): number | null {
  let best: number | null = null;
  let bestCost = Infinity;
  for (let candidate = Math.max(low, pitch - 11); candidate <= Math.min(high, pitch + 11); candidate++) {
    if (!classes.includes(pc(candidate))) continue;
    const cost = Math.abs(candidate - pitch) - (Math.sign(candidate - pitch) === Math.sign(bias) && bias !== 0 ? 0.4 : 0);
    if (cost < bestCost) { bestCost = cost; best = candidate; }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Section Arc Plan                                                    */
/* ------------------------------------------------------------------ */

interface ArcContext {
  readonly bars: PianoArcBar[];
  readonly phrases: PianoArcPhrase[];
}

function restrictedWindows(plan: PianoComposerPlan): { startTick: number; endTick: number }[] {
  return [
    ...plan.attackRestrictions.map(({ startTick, endTick }) => ({ startTick, endTick })),
    ...plan.fillDecisions
      .filter((decision) => decision.target.toLowerCase() === 'piano' && decision.decision === 'leave-space')
      .map(({ startTick, endTick }) => ({ startTick, endTick })),
  ];
}

function planArc(
  input: PianoEngineInput,
  plan: PianoComposerPlan,
  profile: TextureProfile,
  theme: PianoTheme | null,
  density: number,
  octaveAllowedAt: (energy: number) => boolean,
  idn: PianoCompositionIdentity | null = null,
): ArcContext {
  const seed = compositionSeed(plan);
  const energyByBar = new Map(input.context.energy.map((entry) => [entry.bar, entry]));
  const restricted = restrictedWindows(plan);
  const sectionNameById = new Map(input.context.sections.map((section) => [section.id, section.name]));
  const windows = [...input.context.barWindows].sort((a, b) => a.startTick - b.startTick);
  const liveEnergies = windows
    .map((bar) => energyByBar.get(bar.bar))
    .filter((entry): entry is NonNullable<typeof entry> => !!entry && !entry.nearSilence)
    .map((entry) => entry.target);
  const minEnergy = liveEnergies.length ? Math.min(...liveEnergies) : 0.5;
  const maxEnergy = liveEnergies.length ? Math.max(...liveEnergies) : 0.5;
  const range = maxEnergy - minEnergy;
  const shaped = (energy: number): number => range >= 0.12
    ? 0.6 * energy + 0.4 * ((energy - minEnergy) / range) : energy;
  const densityCeiling: PianoTextureLevel = density < 0.4 ? 1 : density < 0.75 ? 2 : 3;
  const ceiling = Math.min(profile.ceiling, densityCeiling) as PianoTextureLevel;
  const densityFactor = 0.35 + 0.65 * density;

  interface PhraseDraft {
    id: string; sectionId: string; sectionName: string; bars: typeof windows; energies: number[];
    mean: number; allRestricted: boolean; firstInSection: boolean; nameOccurrence: number; distinctIndex: number;
  }
  const seenNames: string[] = [];
  const occurrence = new Map<string, number>();
  let previousSection: string | null = null;
  const drafts: PhraseDraft[] = [];
  for (const phrase of plan.phrases) {
    const bars = windows.filter((bar) => bar.startTick >= phrase.startTick && bar.startTick < phrase.endTick);
    if (!bars.length) continue;
    const sectionName = sectionNameById.get(phrase.sectionId) ?? phrase.sectionId;
    const firstInSection = previousSection !== phrase.sectionId;
    if (firstInSection) {
      occurrence.set(sectionName, (occurrence.get(sectionName) ?? 0) + 1);
      if (!seenNames.includes(sectionName)) seenNames.push(sectionName);
    }
    previousSection = phrase.sectionId;
    const isRestricted = (bar: typeof windows[number]) => (energyByBar.get(bar.bar)?.nearSilence ?? false)
      || restricted.some((window) => window.startTick <= bar.startTick && window.endTick >= bar.endTick);
    const live = bars.filter((bar) => !isRestricted(bar));
    const energies = bars.map((bar) => energyByBar.get(bar.bar)?.target ?? 0.5);
    const liveEnergy = live.map((bar) => energyByBar.get(bar.bar)?.target ?? 0.5);
    drafts.push({
      id: phrase.id, sectionId: phrase.sectionId, sectionName, bars, energies,
      mean: liveEnergy.length ? liveEnergy.reduce((sum, value) => sum + value, 0) / liveEnergy.length : 0,
      allRestricted: live.length === 0,
      firstInSection,
      nameOccurrence: occurrence.get(sectionName) ?? 1,
      distinctIndex: seenNames.indexOf(sectionName),
    });
  }

  const live = drafts.filter((draft) => !draft.allRestricted);
  const lastLive = live[live.length - 1] ?? null;
  const firstLive = live[0] ?? null;
  const climaxPool = live.filter((draft) => draft !== lastLive && draft.bars.length >= 2);
  let climax: PhraseDraft | null = null;
  for (const draft of climaxPool.length ? climaxPool : live.filter((entry) => entry !== lastLive)) {
    if (!climax || draft.mean >= climax.mean - 1e-9) climax = draft;
  }
  if (idn && idn.trajectory.climax !== 'energy' && climax) {
    // Several phrases can be about equally energetic; the identity decides which one is the high point.
    const top = climax.mean;
    const near = (climaxPool.length ? climaxPool : live.filter((entry) => entry !== lastLive)).filter((draft) => draft.mean >= top - 0.06);
    if (near.length > 1) climax = idn.trajectory.climax === 'early' ? near.find((draft) => draft !== firstLive) ?? near[0] : near[near.length - 1];
  }
  if (climax && firstLive && climax === firstLive && live.length > 2) climax = null;
  const liveMeanMin = live.length ? Math.min(...live.map((draft) => draft.mean)) : 0;
  const climaxIsEnergetic = !!climax && climax.mean - liveMeanMin >= 0.08;

  const roles = new Map<string, PianoArcRole>();
  const developmentCount = new Map<string, number>();
  live.forEach((draft, index) => {
    const next = live[index + 1] ?? null;
    const previous = live[index - 1] ?? null;
    let role: PianoArcRole;
    if (draft === lastLive && live.length > 1) role = 'arrival';
    else if (draft === climax) role = 'climax';
    else if (draft === firstLive) role = 'statement';
    else if (next === climax && climax && draft.mean < climax.mean - 0.04 && draft.bars.length >= 2) role = 'build';
    else if (previous === climax && climax && draft.mean < climax.mean - 0.1) role = 'release';
    else if (draft.bars.length <= 1) role = 'response';
    else if (draft.firstInSection && draft.nameOccurrence > 1) role = 'reprise';
    else if (draft.firstInSection && draft.distinctIndex >= (idn ? idn.development.contrastFromSection : 2)) role = 'contrast';
    else role = 'development';
    roles.set(draft.id, role);
  });
  for (const draft of drafts) if (draft.allRestricted) roles.set(draft.id, 'breath');

  const roleBias = (role: PianoArcRole, position: number): number => {
    switch (role) {
      case 'statement': return -0.45;
      case 'climax': return 0.35;
      case 'build': return -0.35 + 0.6 * position;
      case 'release': return -0.45;
      case 'response': return -0.2;
      case 'contrast': return -0.15;
      default: return 0;
    }
  };

  const piecePosition = (bar: typeof windows[number]): number => (windows.length > 1 ? windows.indexOf(bar) / (windows.length - 1) : 0.5);
  const levelFor = (energy: number, role: PianoArcRole, position: number, piece = 0.5): PianoTextureLevel => {
    const raw = shaped(energy) * 3.8 * densityFactor + roleBias(role, position) + profile.levelBias
      + (idn ? idn.trajectory.levelBias + trajectoryBias(idn.trajectory.shape, piece) : 0);
    // The identity's floor never lifts a level above the template or density ceiling.
    return clamp(Math.round(raw), Math.min(ceiling, idn ? idn.trajectory.levelFloor : 0), ceiling) as PianoTextureLevel;
  };

  // Pair bars so a texture is held for at least two bars before it changes.
  const phraseLevels = new Map<string, PianoTextureLevel[]>();
  for (const draft of drafts) {
    const role = roles.get(draft.id)!;
    const levels: PianoTextureLevel[] = [];
    for (let index = 0; index < draft.bars.length; index += 2) {
      const pair = draft.energies.slice(index, index + 2);
      const mean = pair.reduce((sum, value) => sum + value, 0) / pair.length;
      const position = draft.bars.length > 1 ? index / (draft.bars.length - 1) : 1;
      const level = role === 'breath' ? 0 : levelFor(mean, role, position, piecePosition(draft.bars[index]));
      for (let k = 0; k < pair.length; k++) levels.push(level);
    }
    phraseLevels.set(draft.id, levels);
  }

  // Where the form allows, the piece must not sit on a single texture level.
  const flat = live.flatMap((draft) => phraseLevels.get(draft.id)!);
  if (flat.length >= 8 && density >= 0.4 && new Set(flat).size === 1) {
    const level = flat[0];
    if (climax && level < ceiling) {
      phraseLevels.set(climax.id, phraseLevels.get(climax.id)!.map(() => (level + 1) as PianoTextureLevel));
    } else if (firstLive && level > 0) {
      phraseLevels.set(firstLive.id, phraseLevels.get(firstLive.id)!.map(() => (level - 1) as PianoTextureLevel));
    }
  }

  const themeBars = theme ? theme.bars.length : 0;
  const bars: PianoArcBar[] = [];
  const phrases: PianoArcPhrase[] = [];
  const finalChordId = plan.ending.chordId;
  const finalChord = input.context.harmony.find((chord) => chord.id === finalChordId) ?? null;

  for (const draft of drafts) {
    const role = roles.get(draft.id)!;
    const levels = phraseLevels.get(draft.id)!;
    const count = draft.bars.length;
    const devIndex = developmentCount.get(role) ?? 0;
    developmentCount.set(role, devIndex + 1);

    let operation: PianoThemeOperation;
    let mapping: { themeBar: number | null; shift: number; invert: boolean; octave: number; ornament: boolean; run: 'up' | 'down' | null; hand: PianoHand; skeleton: boolean }[];
    const base = (themeBar: number | null, shift = 0) => ({
      themeBar, shift, invert: false, octave: 0, ornament: false, run: null as 'up' | 'down' | null, hand: 'right' as PianoHand,
      skeleton: false,
    });
    const statementShape = (): ReturnType<typeof base>[] => {
      if (count === 1) return [base(0)];
      if (count === 2) return [base(0), base(1)];
      if (count === 3) return [base(0), base(1), base(3)];
      if (count === 4) return [base(0), base(1), base(2), base(3)];
      const head = count >= 6 ? [base(0), base(1), base(2), base(3)] : [base(0), base(1)];
      const middle: ReturnType<typeof base>[] = [];
      for (let index = 0; head.length + middle.length < count - 2; index++) {
        middle.push(base(index % 2, 1 + Math.floor(index / 2)));
      }
      return [...head, ...middle, base(2), base(3)].slice(0, count);
    };

    // Call and response between the hands: in dialogue templates the left hand answers with the
    // third and fourth bars of a long phrase while the right hand takes the figuration.
    const dialogue = (entries: ReturnType<typeof base>[]): ReturnType<typeof base>[] =>
      profile.leftHandTheme && entries.length >= 6
        ? entries.map((entry, index) => (index === 2 || index === 3 ? { ...entry, hand: 'left' as PianoHand } : entry))
        : entries;
    if (idn && theme && role !== 'breath') {
      // The identity decides how each phrase role treats the theme; the transformations themselves
      // are the composer's existing ones plus three more that use the same machinery.
      operation = role === 'development' ? idn.development.cycle[devIndex % idn.development.cycle.length] : idn.development.operations[role];
      const leftAllowed = profile.leftHandTheme && idn.accompaniment.leftHandTheme !== 'never';
      const exchange = (entries: ReturnType<typeof base>[]): ReturnType<typeof base>[] => !leftAllowed ? entries
        : idn.accompaniment.leftHandTheme === 'frequent'
          ? (entries.length >= 4 ? entries.map((entry, index) => (index % 4 === 2 || index % 4 === 3 ? { ...entry, hand: 'left' as PianoHand } : entry)) : entries)
          : dialogue(entries);
      const closing = (entries: ReturnType<typeof base>[]): ReturnType<typeof base>[] => {
        if (count >= 4) { entries[count - 2] = base(2); entries[count - 1] = base(3); }
        return entries;
      };
      switch (operation) {
        case 'ornamented-reprise': mapping = exchange(statementShape().map((entry) => ({ ...entry, ornament: true }))); break;
        case 'register-lift': {
          const lift = profile.melodyCenter <= 74 ? 1 : 0;
          mapping = statementShape().map((entry) => ({ ...entry, octave: lift }));
          break;
        }
        case 'rising-fragments':
          mapping = Array.from({ length: count }, (_, index) => base(index % 2 === 0 ? 0 : 1, Math.floor(index / 2) + 1));
          mapping[count - 1] = { ...mapping[count - 1], run: 'up' };
          break;
        case 'inversion':
          mapping = statementShape().map((entry, index) => ({
            ...entry, invert: true, hand: (leftAllowed && index < 2 && count >= 3 ? 'left' : 'right') as PianoHand,
          }));
          break;
        case 'augmented-skeleton': mapping = statementShape().map((entry) => ({ ...entry, skeleton: true })); break;
        case 'answer-fragment': mapping = Array.from({ length: count }, (_, index) => base(index === count - 1 ? 3 : 2)); break;
        case 'sequence': mapping = exchange(closing(Array.from({ length: count }, (_, index) => base(index % 2, 2 + Math.floor(index / 2))))); break;
        case 'descending-sequence': mapping = closing(Array.from({ length: count }, (_, index) => base(index % 2, -1 - Math.floor(index / 2)))); break;
        case 'fragment-extension':
          mapping = Array.from({ length: count }, (_, index) => base(0, index));
          if (count >= 2) mapping[count - 1] = base(3);
          break;
        case 'tail-sequence':
          // The head once for recognition, then the theme's second bar walked down by step.
          mapping = count <= 2 ? [base(1), base(3)].slice(0, count)
            : [base(0), ...Array.from({ length: count - 2 }, (_, index) => base(1, -index)), base(3)];
          break;
        case 'hand-exchange':
          mapping = statementShape().map((entry, index) => ({
            ...entry,
            hand: (leftAllowed && (count >= 4 ? Math.floor(index / 2) % 2 === 1 : index === 1) ? 'left' : 'right') as PianoHand,
          }));
          break;
        default: mapping = statementShape();
      }
      if (!idn.techniques.ornaments) mapping = mapping.map((entry) => ({ ...entry, ornament: false }));
      if (idn.techniques.runs === 'none') mapping = mapping.map((entry) => ({ ...entry, run: null }));
    } else if (!theme || role === 'breath') {
      operation = 'rest';
      mapping = Array.from({ length: count }, () => base(null));
    } else if (role === 'statement') {
      operation = 'statement';
      mapping = statementShape();
    } else if (role === 'reprise') {
      operation = 'ornamented-reprise';
      mapping = dialogue(statementShape().map((entry) => ({ ...entry, ornament: true })));
    } else if (role === 'climax') {
      operation = 'register-lift';
      const lift = profile.melodyCenter <= 74 ? 1 : 0;
      mapping = statementShape().map((entry) => ({ ...entry, octave: lift }));
    } else if (role === 'build') {
      operation = 'rising-fragments';
      mapping = Array.from({ length: count }, (_, index) => base(index % 2 === 0 ? 0 : 1, Math.floor(index / 2) + 1));
      mapping[count - 1] = { ...mapping[count - 1], run: 'up' };
    } else if (role === 'contrast') {
      operation = 'inversion';
      mapping = statementShape().map((entry, index) => ({
        ...entry, invert: true, hand: (profile.leftHandTheme && index < 2 && count >= 3 ? 'left' : 'right') as PianoHand,
      }));
    } else if (role === 'release') {
      operation = 'augmented-skeleton';
      mapping = statementShape();
    } else if (role === 'response') {
      operation = 'answer-fragment';
      mapping = Array.from({ length: count }, (_, index) => ({ ...base(index === count - 1 ? 3 : 2), run: null }));
    } else if (role === 'arrival') {
      operation = 'cadential-return';
      mapping = statementShape();
    } else if (devIndex % 2 === 0) {
      operation = 'sequence';
      mapping = Array.from({ length: count }, (_, index) => base(index % 2, 2 + Math.floor(index / 2)));
      if (count >= 4) { mapping[count - 2] = base(2); mapping[count - 1] = base(3); }
      mapping = dialogue(mapping);
    } else {
      operation = 'fragment-extension';
      mapping = Array.from({ length: count }, (_, index) => base(0, index));
      if (count >= 2) mapping[count - 1] = base(3);
    }

    const sectionKey = `${draft.sectionName}`;
    draft.bars.forEach((window, index) => {
      const energy = draft.energies[index];
      const entry = energyByBar.get(window.bar);
      const isRestricted = (entry?.nearSilence ?? false)
        || restricted.some((gap) => gap.startTick <= window.startTick && gap.endTick >= window.endTick);
      const isFinal = !!finalChord && finalChord.startTick <= window.startTick && window.startTick < finalChord.endTick
        && role === 'arrival' && index === count - 1;
      let level = levels[index];
      if (isFinal) level = 0;
      const position = count > 1 ? index / (count - 1) : 0.5;
      const hairpin = role === 'build' ? -0.4 + 0.8 * position
        : role === 'release' ? 0.2 - 0.5 * position
          : 0.25 - Math.abs(position - 0.6) * 0.5;
      const roleLift = role === 'climax' ? 0.5 : role === 'statement' ? -0.2 : role === 'release' ? -0.4
        : role === 'response' ? -0.2 : 0;
      // Dynamics follow the piece's own arc as well as absolute energy, so the formal peak reaches
      // the top of the template's range and the quietest phrase its bottom. No global offset.
      const classicIntensity = shaped(energy) * 5.2 + roleLift + hairpin - (isFinal && energy < 0.7 ? 0.5 : 0);
      // Identity: its own swell inside the phrase, its own contrast width and its own curve over the
      // piece. The template's intensity cap is applied last and is never exceeded.
      const identityHairpin = idn && role !== 'build' && role !== 'release'
        ? idn.dynamics.hairpinDepth * (0.5 - Math.abs(position - idn.dynamics.hairpinPeak)) : hairpin;
      const intensity = clamp(idn
        ? 3 + (classicIntensity - hairpin + identityHairpin - 3) * idn.dynamics.contrast + dynamicBias(idn.dynamics.shape, piecePosition(window))
        : classicIntensity, 0.6, profile.intensityCap);
      const fillHere = density >= 0.4 && level >= 1 && !isRestricted && plan.fillDecisions.some((decision) =>
        decision.target.toLowerCase() === 'piano' && decision.decision === 'consider-brief-gesture'
        && decision.startTick < window.endTick && decision.endTick > window.startTick);
      const fillRun: 'up' | 'down' | null = fillHere && (!idn || idn.techniques.runs === 'free')
        ? (unitRandom(seed, `independent:fill-direction:${window.bar}`) < 0.5 ? 'up' : 'down') : null;
      const alternate = !!idn && idn.accompaniment.changeBySection && draft.distinctIndex % 2 === 1;
      const patternList = level === 0 ? ['sustain' as PianoLeftPattern] : profile.left[level as 1 | 2 | 3];
      const patternDraw = unitRandom(seed, `independent:left-pattern:${sectionKey}:${level}`);
      const map = mapping[index];
      const themeBar = map.themeBar === null || !themeBars ? null : map.themeBar % themeBars;
      const octaveDouble = role === 'climax' && level >= 3 && octaveAllowedAt(energy) && (!idn || idn.techniques.octaves);
      bars.push({
        bar: window.bar,
        startTick: window.startTick,
        endTick: window.endTick,
        phraseId: draft.id,
        energy,
        restricted: isRestricted,
        level,
        intensity,
        leftPattern: idn && level > 0
          ? (alternate ? idn.accompaniment.leftAlternate : idn.accompaniment.left)[level as 1 | 2 | 3]
          : patternList[Math.floor(patternDraw * patternList.length)] ?? patternList[0],
        rightStyle: level === 0 ? 'held'
          : idn ? (alternate ? idn.accompaniment.rightAlternate : idn.accompaniment.right)[level as 1 | 2 | 3]
            : profile.right[level as 1 | 2 | 3],
        themeBar: isRestricted ? null : themeBar,
        themeStepShift: map.shift,
        themeInvert: map.invert,
        themeOctave: map.octave,
        themeHand: map.hand,
        ornament: map.ornament,
        octaveDouble,
        run: level >= 2 && map.run ? map.run : fillRun,
        finalLanding: isFinal,
        ...(map.skeleton ? { themeSkeleton: true } : {}),
      });
    });
    const rationale = role === 'breath' ? 'Every bar of the phrase is a supplied near-silence or explicit rest window.'
      : role === 'climax' ? `Highest sustained energy of the form (mean ${draft.mean.toFixed(2)})${climaxIsEnergetic ? '' : '; the energy curve is nearly flat, so this is a formal high point only'}.`
        : role === 'build' ? 'Leads into the climax phrase from lower energy; fragments rise and the texture thickens.'
          : role === 'arrival' ? 'Final phrase of the form; returns to the theme and settles on the supplied final harmony.'
            : role === 'statement' ? 'First sounding phrase; states the theme plainly.'
              : role === 'reprise' ? `Section "${draft.sectionName}" returns (occurrence ${draft.nameOccurrence}); the theme is recalled with ornament.`
                : role === 'contrast' ? `Third or later distinct section "${draft.sectionName}"; the theme is inverted for contrast.`
                  : role === 'release' ? 'Follows the climax at clearly lower energy; the theme is reduced to its skeleton.'
                    : role === 'response' ? 'One-bar phrase at a boundary; answers with the theme\'s closing fragment.'
                      : 'Continues the section; the theme is developed in sequence.';
    phrases.push({
      phraseId: draft.id,
      sectionId: draft.sectionId,
      sectionName: draft.sectionName,
      startBar: draft.bars[0].bar,
      endBar: draft.bars[count - 1].bar,
      role,
      themeOperation: operation,
      meanEnergy: Math.round(draft.mean * 1000) / 1000,
      levels: bars.slice(-count).map((bar) => bar.level),
      rationale,
    });
  }
  return { bars, phrases };
}

/* ------------------------------------------------------------------ */
/* Theme Layer                                                         */
/* ------------------------------------------------------------------ */

function buildTheme(seed: number, profile: TextureProfile, chords: readonly ChordInfo[], scale: readonly number[]): PianoTheme | null {
  if (!chords.length) return null;
  const draw = (label: string) => unitRandom(seed, `independent:theme:${label}`);
  const pick = <T>(items: readonly T[], label: string): T => items[Math.floor(draw(label) * items.length)] ?? items[0];
  const first = chords[0];
  const anchorOptions = first.tones.filter((tone) => tone !== first.root && scale.includes(tone));
  const anchor = anchorOptions.length ? pick(anchorOptions, 'anchor') : first.root;
  const contour = pick(profile.contours, 'contour');
  const headId = pick(profile.headRhythms, 'head-rhythm');
  const landingId = pick(['l1', 'l2', 'l3', 'l4'], 'landing-rhythm');
  const cadenceId = pick(['c1', 'c2', 'c1'], 'cadence-rhythm');
  const head = RHYTHMS[headId];
  const landing = RHYTHMS[landingId];
  const cadence = RHYTHMS[cadenceId];
  const structural = (pos: number, dur: number, index: number, last: boolean) => index === 0 || last || pos % 4 === 0 || dur >= 3;

  // Bar 1: the head. A leap is always answered by stepwise motion the other way.
  const headSteps: number[] = [];
  let current = contour === 'descent-rise' ? 4 : 0;
  headSteps.push(current);
  for (let index = 1; index < head.length; index++) {
    let delta: number;
    if (contour === 'arch') delta = current >= 4 ? -1 : draw(`arch-${index}`) < 0.3 && current <= 2 ? 2 : 1;
    else if (contour === 'leap-fill') delta = index === 1 ? (draw('leap') < 0.5 ? 3 : 4) : -1;
    else if (contour === 'descent-rise') delta = index === head.length - 1 ? 1 : draw(`fall-${index}`) < 0.3 ? -2 : -1;
    else delta = index % 2 === 1 ? 2 : -1;
    current += delta;
    headSteps.push(current);
  }
  // Bar 2: reach the peak, then come down by step onto a long tone.
  const landingSteps: number[] = [];
  // The whole theme stays within about a seventh so that it remains singable.
  const peak = contour === 'leap-fill' || current >= 5 ? current - 1 : current + 1;
  landing.forEach((_, index) => landingSteps.push(peak - index));
  // Bar 3: the head again in sequence, one step lower or higher.
  const sequenceShift = contour === 'descent-rise' ? 1 : -1;
  const sequenceSteps = headSteps.map((step) => step + sequenceShift);
  // Bar 4: cadence back to the anchor by step.
  const cadenceSteps = cadence.map((_, index) => cadence.length - 1 - index);

  const makeBar = (rhythm: readonly (readonly [number, number])[], steps: readonly number[]): PianoThemeNote[] =>
    rhythm.map(([pos, dur], index) => ({
      pos, dur, step: steps[index] ?? 0, structural: structural(pos, dur, index, index === rhythm.length - 1),
    }));
  const bars = [makeBar(head, headSteps), makeBar(landing, landingSteps), makeBar(head, sequenceSteps), makeBar(cadence, cadenceSteps)];
  return {
    id: 'piano-theme-main',
    scalePitchClasses: [...scale],
    anchorPitchClass: anchor,
    contour,
    rhythm: [headId, landingId, headId, cadenceId],
    bars,
    eventCount: bars.reduce((sum, bar) => sum + bar.length, 0),
  };
}

/** Scale steps of a theme head for one contour; a leap is always answered by step. */
function contourSteps(contour: PianoThemeContour, count: number, draw: (label: string) => number): number[] {
  const steps: number[] = [];
  let current = contour === 'descent-rise' || contour === 'fall' ? 4 : contour === 'repeat-step' && draw('repeat-direction') < 0.4 ? 3 : 0;
  const repeatDirection = current === 3 ? -1 : 1;
  const swing = draw('pendulum-first') < 0.5 ? 1 : -1;
  steps.push(current);
  for (let index = 1; index < count; index++) {
    let delta: number;
    switch (contour) {
      case 'arch': delta = current >= 4 ? -1 : draw(`arch-${index}`) < 0.3 && current <= 2 ? 2 : 1; break;
      case 'leap-fill': delta = index === 1 ? (draw('leap') < 0.5 ? 3 : 4) : -1; break;
      case 'descent-rise': delta = index === count - 1 ? 1 : draw(`fall-${index}`) < 0.3 ? -2 : -1; break;
      case 'rise': delta = draw(`rise-${index}`) < 0.25 && index === 1 ? 2 : 1; break;
      case 'fall': delta = -1; break;
      case 'pendulum': delta = (index % 2 === 1 ? 1 : -1) * swing * (index % 4 >= 2 ? -1 : 1); break;
      case 'repeat-step': delta = index % 2 === 1 ? 0 : repeatDirection; break;
      default: delta = index % 2 === 1 ? 2 : -1;
    }
    current += delta;
    steps.push(current);
  }
  return steps;
}

/**
 * The theme of an identity-driven piece. Same data shape as the Classic theme
 * (four bars of eighth-slot notes in scale steps), but contour, rhythm cell and
 * the way the four bars relate all come from the composition identity.
 */
function buildIdentityTheme(idn: PianoCompositionIdentity, chords: readonly ChordInfo[], scale: readonly number[]): PianoTheme | null {
  if (!chords.length) return null;
  const draw = (label: string) => unitRandom(idn.generation.compositionSeed, `identity:theme:${label}`);
  const first = chords[0];
  const anchorOptions = first.tones.filter((tone) => tone !== first.root && scale.includes(tone));
  const anchor = anchorOptions.length ? anchorOptions[Math.floor(draw('anchor') * anchorOptions.length)] ?? anchorOptions[0] : first.root;
  const { contour, form, headRhythm, landingRhythm, cadenceRhythm, range } = idn.theme;
  const head = IDENTITY_RHYTHMS[headRhythm];
  const landing = IDENTITY_RHYTHMS[landingRhythm];
  const cadence = IDENTITY_RHYTHMS[cadenceRhythm];
  const fit = (step: number): number => clamp(step, range[0], range[1]);
  const structural = (pos: number, dur: number, index: number, last: boolean) => index === 0 || last || pos % 4 === 0 || dur >= 3;

  const headSteps = contourSteps(contour, head.length, draw).map(fit);
  const sequenceShift = contour === 'descent-rise' || contour === 'fall' ? 1 : -1;
  const sequenceSteps = headSteps.map((step) => fit(step + sequenceShift));
  const landingFrom = (last: number): number[] => {
    const peak = fit(contour === 'leap-fill' || last >= 5 ? last - 1 : last + 1);
    return landing.map((_, index) => fit(peak - index));
  };
  const fromAbove = draw('cadence-approach') < 0.6;
  const cadenceSteps = cadence.map((_, index) => (fromAbove ? cadence.length - 1 - index : index - (cadence.length - 1)));

  const makeBar = (rhythm: readonly (readonly [number, number])[], steps: readonly number[]): PianoThemeNote[] =>
    rhythm.map(([pos, dur], index) => ({
      pos, dur, step: steps[index] ?? 0, structural: structural(pos, dur, index, index === rhythm.length - 1),
    }));
  let bars: PianoThemeNote[][];
  let rhythm: string[];
  if (form === 'sentence') {
    // The opening is repeated at once on another step, then continues to the cadence.
    bars = [makeBar(head, headSteps), makeBar(head, sequenceSteps), makeBar(landing, landingFrom(sequenceSteps[sequenceSteps.length - 1])), makeBar(cadence, cadenceSteps)];
    rhythm = [headRhythm, headRhythm, landingRhythm, cadenceRhythm];
  } else if (form === 'question-answer') {
    // A two-bar idea heard twice: first left open on a step away from the anchor, then closed.
    const open = landingFrom(headSteps[headSteps.length - 1]);
    open[open.length - 1] = fit(draw('open-ending') < 0.5 ? 1 : 4);
    bars = [makeBar(head, headSteps), makeBar(landing, open), makeBar(head, headSteps), makeBar(cadence, cadenceSteps)];
    rhythm = [headRhythm, landingRhythm, headRhythm, cadenceRhythm];
  } else if (form === 'long-line') {
    // No internal repeat: the second idea is answered by its own rising form.
    const second = landingFrom(headSteps[headSteps.length - 1]);
    const third = landing.map((_, index) => fit(second[second.length - 1] + index));
    bars = [makeBar(head, headSteps), makeBar(landing, second), makeBar(landing, third), makeBar(cadence, cadenceSteps)];
    rhythm = [headRhythm, landingRhythm, landingRhythm, cadenceRhythm];
  } else {
    bars = [makeBar(head, headSteps), makeBar(landing, landingFrom(headSteps[headSteps.length - 1])), makeBar(head, sequenceSteps), makeBar(cadence, cadenceSteps)];
    rhythm = [headRhythm, landingRhythm, headRhythm, cadenceRhythm];
  }
  return {
    id: 'piano-theme-main',
    scalePitchClasses: [...scale],
    anchorPitchClass: anchor,
    contour: `${contour} ${form}`,
    rhythm,
    bars,
    eventCount: bars.reduce((sum, bar) => sum + bar.length, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

interface ExternalEvidence {
  readonly available: boolean;
  readonly leadNotesByBar: ReadonlyMap<number, readonly { start: number; end: number; pitch: number }[]>;
  readonly leadIdsByBar: ReadonlyMap<number, readonly string[]>;
  readonly upperOnsetsByBar: ReadonlyMap<number, number>;
  readonly bassOnsetsByBar: ReadonlyMap<number, number>;
  readonly momentByBar: ReadonlyMap<number, { kind: string; pianoParticipates: boolean; explicitOthers: boolean }>;
}

const VELOCITY_TABLE = [30, 40, 52, 65, 79, 95];
function velocityFor(intensity: number, offset: number): number {
  const bounded = clamp(intensity, 0, 5);
  const low = Math.floor(bounded);
  const high = Math.min(5, low + 1);
  const base = VELOCITY_TABLE[low] + (VELOCITY_TABLE[high] - VELOCITY_TABLE[low]) * (bounded - low);
  // 30 is the quietest velocity the previous engine wrote; nothing is written below it.
  return Math.round(clamp(base + offset, 30, 127));
}

interface RenderOptions {
  readonly input: PianoEngineInput;
  readonly plan: PianoComposerPlan;
  readonly profile: TextureProfile;
  readonly identity: PianoTemplateIdentity;
  readonly theme: PianoTheme | null;
  readonly arc: ArcContext;
  readonly chords: readonly ChordInfo[];
  readonly scale: readonly number[];
  readonly target: PianoScoreTarget;
  readonly endTick: number;
  readonly density: number;
  readonly directives: ReadonlyMap<number, BarDirective>;
  readonly evidence: ExternalEvidence | null;
  readonly records: PianoAdaptationRecord[] | null;
  readonly idn: PianoCompositionIdentity | null;
}

function render(options: RenderOptions): PianoDraftEvent[] {
  const { plan, profile, theme, arc, chords, scale, target, endTick, density, directives, evidence, records, idn } = options;
  const seed = compositionSeed(plan);
  const events: PianoDraftEvent[] = [];
  const octaveForbidden = plan.templateConstraints.octaveDoubling === 'forbidden';
  const gaps = restrictedWindows(plan);
  const attackAllowed = (tick: number): boolean => !gaps.some((gap) => tick >= gap.startTick && tick < gap.endTick);
  const phraseSection = new Map(plan.phrases.map((phrase) => [phrase.id, phrase.sectionId]));
  const chordAt = (tick: number): ChordInfo | null =>
    chords.find((chord) => chord.startTick <= tick && tick < chord.endTick) ?? null;
  const low = target.lowestNote;
  const high = target.highestNote;

  const push = (event: Omit<PianoDraftEvent, 'sectionId' | 'durationTicks'> & { durationTicks: number }) => {
    if (!Number.isInteger(event.pitch) || event.pitch < low || event.pitch > high) return;
    const start = Math.round(event.startTick);
    if (start < 0 || start >= endTick || !attackAllowed(start)) return;
    let end = Math.min(endTick, start + Math.max(1, Math.round(event.durationTicks)));
    for (const gap of gaps) if (gap.startTick > start && gap.startTick < end) end = gap.startTick;
    if (end - start < 1) return;
    events.push({
      ...event,
      startTick: start,
      durationTicks: end - start,
      velocity: Math.round(clamp(event.velocity, 1, 127)),
      sectionId: phraseSection.get(event.phraseId) ?? '',
    });
  };

  const melodyHome = (() => {
    if (!theme) return profile.melodyCenter;
    // Centre the theme's whole compass, not just its first note, on the template register.
    const steps = theme.bars.flat().map((note) => note.step);
    const meanStep = steps.reduce((sum, step) => sum + step, 0) / Math.max(1, steps.length);
    const wanted = profile.melodyCenter - Math.round(meanStep * 12 / 7);
    let best = wanted;
    let cost = Infinity;
    for (let pitch = wanted - 6; pitch <= wanted + 6; pitch++) {
      if (pc(pitch) !== theme.anchorPitchClass) continue;
      if (Math.abs(pitch - wanted) < cost) { cost = Math.abs(pitch - wanted); best = pitch; }
    }
    return best;
  })();

  let previousBass: number | null = null;
  let previousLadder: number[] = [];
  let previousInner: number[] = [];
  let previousMelody: number | null = null;
  let previousMelodyPhrase: string | null = null;

  interface MelodyNote { tick: number; dur: number; pitch: number; structural: boolean; run: boolean }

  const melodyForBar = (bar: PianoArcBar, directive: BarDirective): MelodyNote[] => {
    if (!theme || bar.themeBar === null || directive.melody === 'none') return [];
    const length = bar.endTick - bar.startTick;
    const slots = Math.max(1, Math.round(length / EIGHTH));
    const leftHand = bar.themeHand === 'left';
    const anchor = melodyHome + 12 * (bar.themeOctave + directive.registerShift) - (leftHand ? 24 : 0);
    const rangeLow = Math.max(low, leftHand ? 43 : Math.max(57, anchor - 10));
    const rangeHigh = Math.min(high, leftHand ? 60 : Math.min(anchor + 14, profile.melodyCenter + 19));
    const source = theme.bars[bar.themeBar].filter((note) => note.pos < slots);
    const notes: MelodyNote[] = [];
    let previousRaw: number | null = null;
    source.forEach((note, index) => {
      const tick = bar.startTick + note.pos * EIGHTH;
      const chord = chordAt(tick);
      if (!chord) return;
      const step = (bar.themeInvert ? -note.step : note.step) + bar.themeStepShift;
      const raw = stepInScale(anchor, step, scale);
      const direction = previousRaw === null ? 0 : raw - previousRaw;
      previousRaw = raw;
      let pitch: number | null;
      if (note.structural) pitch = nearestWithClasses(raw, chord.tones, rangeLow, rangeHigh, direction);
      else pitch = nearestWithClasses(raw, chord.localScale, rangeLow, rangeHigh, direction);
      if (pitch === null) return;
      const nextPos = source[index + 1]?.pos ?? slots;
      const dur = Math.min(note.dur, nextPos - note.pos, slots - note.pos) * EIGHTH;
      notes.push({ tick, dur, pitch, structural: note.structural, run: false });
    });
    // Keep the written contour: no accidental repeats, no unresolved leaps from non-chord tones.
    for (let index = 1; index < notes.length; index++) {
      const prior = notes[index - 1];
      const note = notes[index];
      const chord = chordAt(note.tick);
      if (!chord) continue;
      const wanted = source[index].step - source[index - 1].step;
      if (note.pitch === prior.pitch && wanted !== 0) {
        // The theme moves here: take the next tone in the written direction rather than repeat.
        const direction = (bar.themeInvert ? -1 : 1) * Math.sign(wanted);
        const classes = note.structural ? chord.tones : chord.localScale;
        for (let distance = 1; distance <= 7; distance++) {
          const candidate = prior.pitch + direction * distance;
          if (candidate < rangeLow || candidate > rangeHigh) break;
          if (classes.includes(pc(candidate))) { note.pitch = candidate; break; }
        }
      }
      if (!prior.structural && Math.abs(note.pitch - prior.pitch) > 4) {
        const priorChord = chordAt(prior.tick);
        const fixed = priorChord ? nearestWithClasses(prior.pitch, priorChord.tones, rangeLow, rangeHigh) : null;
        if (fixed !== null) prior.pitch = fixed;
      }
    }

    let output = notes;
    // Identity: the theme's rhythm is the piece's identity, so a thin texture alone does not reduce it
    // to its skeleton. The head always sounds whole; at low density the other bars may still thin out.
    const thinTexture = bar.level === 0 && (!idn || (density < 0.4 && bar.themeBar !== 0));
    const skeleton = directive.melody === 'skeleton' || thinTexture || bar.themeSkeleton === true
      || (profile.melodyPresence === 'selective' && (bar.themeBar === 1 || bar.themeBar === 3))
      || (density < 0.4 && bar.themeBar === 1);
    if (skeleton) {
      const kept = notes.filter((note) => note.structural);
      const thinned = kept.filter((_, index) => index === 0 || kept[index].tick - kept[index - 1].tick >= 2 * PPQ);
      output = thinned.map((note, index) => ({
        ...note,
        dur: Math.min(4 * PPQ, (thinned[index + 1]?.tick ?? bar.endTick) - note.tick),
      }));
    } else if (bar.ornament) {
      const index = notes.findIndex((note) => note.structural && note.dur >= 4 * EIGHTH);
      const chord = index >= 0 ? chordAt(notes[index].tick + notes[index].dur - EIGHTH) : null;
      if (index >= 0 && chord) {
        const main = notes[index];
        const neighbour = stepInScale(main.pitch, 1, chord.localScale);
        if (neighbour <= rangeHigh && neighbour - main.pitch <= 2) {
          output = [
            ...notes.slice(0, index),
            { ...main, dur: main.dur - 2 * EIGHTH },
            { tick: main.tick + main.dur - 2 * EIGHTH, dur: EIGHTH, pitch: neighbour, structural: false, run: false },
            { tick: main.tick + main.dur - EIGHTH, dur: EIGHTH, pitch: main.pitch, structural: true, run: false },
            ...notes.slice(index + 1),
          ];
        }
      }
    }
    if (bar.run && !skeleton && slots >= 8) {
      const runStart = bar.startTick + Math.floor(slots / 2) * EIGHTH;
      const before = output.filter((note) => note.tick < runStart)
        .map((note) => ({ ...note, dur: Math.min(note.dur, runStart - note.tick) }));
      const step = profile.sixteenthRuns && density >= 0.75 ? EIGHTH / 2 : EIGHTH;
      let pitch = before.length ? before[before.length - 1].pitch : anchor;
      const runNotes: MelodyNote[] = [];
      for (let tick = runStart; tick < bar.endTick; tick += step) {
        const chord = chordAt(tick);
        if (!chord) break;
        const direction = bar.run === 'up' ? 1 : -1;
        let next = stepInScale(pitch, direction, chord.localScale);
        // A passing tone is only written when the following step resolves it onto a chord tone.
        if (!chord.tones.includes(pc(next)) && !chord.tones.includes(pc(stepInScale(next, direction, chord.localScale)))) {
          next = stepInScale(next, direction, chord.localScale);
        }
        pitch = next;
        if (pitch > Math.min(high, rangeHigh + 5) || pitch < rangeLow) break;
        runNotes.push({ tick, dur: step, pitch, structural: false, run: true });
      }
      output = [...before, ...runNotes];
    }
    return output.filter((note) => note.dur > 0);
  };

  /** Every non-chord tone must resolve by step onto a chord tone; otherwise it becomes a chord tone. */
  const resolveNonChordTones = (notes: MelodyNote[]): MelodyNote[] => {
    const isChordTone = (note: MelodyNote) => chordAt(note.tick)?.tones.includes(pc(note.pitch)) ?? true;
    for (let index = notes.length - 1; index >= 0; index--) {
      const note = notes[index];
      if (isChordTone(note)) continue;
      const next = notes[index + 1];
      if (next && isChordTone(next) && Math.abs(next.pitch - note.pitch) <= 2 && next.pitch !== note.pitch) continue;
      const chord = chordAt(note.tick)!;
      const previous = notes[index - 1]?.pitch;
      const options = [-2, -1, 1, 2, -3, 3, -4, 4].map((delta) => note.pitch + delta)
        .filter((pitch) => chord.tones.includes(pc(pitch)) && pitch !== previous && pitch !== next?.pitch && pitch >= low && pitch <= high);
      const fallback = nearestWithClasses(note.pitch, chord.tones, low, high);
      const replacement = options[0] ?? fallback;
      if (replacement !== null && replacement !== undefined) notes[index] = { ...note, pitch: replacement, structural: true };
    }
    return notes;
  };

  const chooseBass = (chord: ChordInfo): number => {
    const center = previousBass ?? profile.bassCenter;
    let best = profile.bassCenter;
    let cost = Infinity;
    for (let pitch = Math.max(low, profile.bassCenter - 9); pitch <= Math.min(high, profile.bassCenter + 9); pitch++) {
      if (pc(pitch) !== chord.bass) continue;
      const value = Math.abs(pitch - center) + Math.abs(pitch - profile.bassCenter) * 0.35;
      if (value < cost) { cost = value; best = pitch; }
    }
    return best;
  };

  /** Chord tones above the bass, voice-led from the previous figure. */
  const buildLadder = (chord: ChordInfo, bass: number, open: boolean, ceiling: number): number[] => {
    const minGap = bass < 45 ? 5 : 3;
    const reach = open ? 17 : 12;
    const candidates: number[] = [];
    for (let pitch = bass + minGap; pitch <= Math.min(ceiling, bass + reach); pitch++) {
      if (!chord.tones.includes(pc(pitch))) continue;
      if (octaveForbidden && pc(pitch) === pc(bass)) continue;
      candidates.push(pitch);
    }
    if (!candidates.length) return [bass];
    const wanted = open ? [bass + 7, bass + 15] : [bass + 7, bass + 10, bass + 12];
    const guides = previousLadder.length > 1 && !open ? previousLadder.slice(1) : wanted;
    const chosen: number[] = [];
    for (const guide of guides) {
      const available = candidates.filter((pitch) => !chosen.includes(pitch) && chosen.every((other) => Math.abs(other - pitch) >= 2));
      if (!available.length) break;
      available.sort((a, b) => Math.abs(a - guide) - Math.abs(b - guide) || a - b);
      chosen.push(available[0]);
    }
    if (chosen.length < 2) {
      for (const pitch of candidates) {
        if (chosen.length >= 2) break;
        if (!chosen.includes(pitch) && chosen.every((other) => Math.abs(other - pitch) >= 2)) chosen.push(pitch);
      }
    }
    return [bass, ...chosen.sort((a, b) => a - b)];
  };

  const SEQUENCES: Readonly<Record<string, readonly (number | readonly number[] | null)[]>> = {
    'broken-quarters': [0, null, 1, null, 2, null, 1, null],
    'bass-and-chord': [0, null, null, null, [1, 2], null, null, null],
    'pulse-quarters': [0, null, 1, null, 0, null, 1, null],
    'alberti-eighths': [0, 2, 1, 2, 0, 2, 1, 2],
    'rolling-arpeggio': [0, 1, 2, 3, 2, 1, 2, 1],
    'broken-tenths': [0, 1, 2, 1, 0, 1, 2, 1],
    stride: [0, null, [1, 2], null, 0, null, [1, 2], null],
    'ostinato-332': [0, null, 1, 0, null, 1, 0, 1],
    'half-notes': [0, null, null, null, 1, null, null, null],
  };
  // Identity only: the left hand repeats the rhythm of the theme's head. The bass sounds on the
  // downbeat; the other attacks of the cell alternate between two chord tones above it.
  const cellSequence: (number | null)[] = Array.from({ length: 8 }, () => null);
  if (idn) {
    cellSequence[0] = 0;
    let upper = 1;
    for (const slot of idn.rhythm.cell) {
      if (slot <= 0 || slot > 7) continue;
      cellSequence[slot] = upper;
      upper = upper === 1 ? 2 : 1;
    }
  }
  const LEFT_TECHNIQUE: Readonly<Record<PianoLeftPattern, PianoTechniqueIntent>> = {
    sustain: 'chord-tone-support',
    'broken-quarters': 'broken-chord-accompaniment',
    'bass-and-chord': 'stride-accompaniment',
    walking: 'walking-bass-line',
    'pulse-quarters': 'pulsed-bass-pattern',
    'alberti-eighths': 'alberti-bass-accompaniment',
    'rolling-arpeggio': 'rolling-arpeggio-accompaniment',
    'broken-tenths': 'broken-tenth-accompaniment',
    stride: 'stride-accompaniment',
    'ostinato-332': 'rhythmic-ostinato',
    'half-notes': 'broken-chord-accompaniment',
    'cell-figure': 'rhythmic-ostinato',
  };

  for (const bar of arc.bars) {
    if (bar.restricted) { previousInner = []; continue; }
    const directive = directives.get(bar.bar) ?? {
      level: bar.level, melody: 'theme' as const, registerShift: 0, velocityTrim: 0, melodyTrim: 0, rightCap: null, leftCap: null,
    };
    const level = directive.level;
    const leftLevel = directive.leftCap === null ? level : Math.min(level, directive.leftCap) as PianoTextureLevel;
    const intensity = bar.intensity;
    const trim = directive.velocityTrim;
    const segments = chords
      .filter((chord) => chord.startTick < bar.endTick && chord.endTick > bar.startTick)
      .map((chord) => ({ chord, start: Math.max(bar.startTick, chord.startTick), end: Math.min(bar.endTick, chord.endTick) }));
    if (!segments.length) continue;
    const phraseId = bar.phraseId;
    const common = { phraseId, bar: bar.bar, intensity };

    /* ---------------- final landing: real chordal weight ---------------- */
    if (bar.finalLanding) {
      const { chord, start, end } = segments[0];
      const bass = chooseBass(chord);
      const span = end - start;
      const landing: Omit<PianoDraftEvent, 'pitch' | 'hand' | 'voiceId' | 'layer' | 'velocity' | 'sectionId' | 'durationTicks' | 'startTick'> = {
        ...common, chordId: chord.id, musicalRole: 'cadence', gestureIntent: 'cadential-landing',
        techniqueIntent: 'final-harmony', noteRoleTag: 'settle', articulation: 'sustain',
      };
      push({ ...landing, pitch: bass, startTick: start, durationTicks: span, hand: 'left', voiceId: 'lh.bass', layer: 'bass', velocity: velocityFor(intensity, -1 + trim) });
      const fifth = nearestWithClasses(bass + 7, chord.tones.filter((tone) => tone !== pc(bass)), bass + 3, bass + 12);
      if (fifth !== null) push({ ...landing, pitch: fifth, startTick: start, durationTicks: span, hand: 'left', voiceId: 'lh.support', layer: 'accompaniment', velocity: velocityFor(intensity, -8 + trim) });
      const topTarget = previousMelody ?? melodyHome;
      const topClasses = [chord.root, ...chord.tones.filter((tone) => [3, 4].includes(pc(tone - chord.root)))];
      const top = nearestWithClasses(topTarget, topClasses, Math.max(60, topTarget - 7), Math.min(high, topTarget + 7)) ?? topTarget;
      push({ ...landing, pitch: top, startTick: start, durationTicks: span, hand: 'right', voiceId: 'rh.melody', layer: 'melody', velocity: velocityFor(intensity, 5 + trim) });
      const voices = density < 0.4 ? 1 : Math.min(3, profile.innerVoices + 1);
      const inner: number[] = [];
      for (let pitch = top - 2; pitch >= Math.max((fifth ?? bass) + 1, top - 12) && inner.length < voices; pitch--) {
        if (!chord.tones.includes(pc(pitch)) || pc(pitch) === pc(top)) continue;
        if (inner.some((other) => other - pitch < 2)) continue;
        if (octaveForbidden && (pc(pitch) === pc(bass))) continue;
        inner.push(pitch);
      }
      for (const pitch of inner) push({ ...landing, pitch, startTick: start, durationTicks: span, hand: 'right', voiceId: 'rh.inner', layer: 'inner', velocity: velocityFor(intensity, -6 + trim) });
      continue;
    }

    /* ---------------- melody ---------------- */
    let melody = melodyForBar(bar, directive);
    const leftTheme = bar.themeHand === 'left' && melody.length > 0;
    if (directive.melody === 'answers' && evidence) {
      const lead = evidence.leadNotesByBar.get(bar.bar) ?? [];
      const busy = (tick: number) => lead.some((note) => Math.abs(note.start - tick) < EIGHTH);
      // Protected theme head (identity only): its notes also stay where the lead attacks at the same
      // moment, as long as the lead is not in the same register. A lead within a fourth is a real
      // conflict and the note still goes.
      const clear = (note: MelodyNote) => !lead.some((other) => Math.abs(other.start - note.tick) < EIGHTH && Math.abs(other.pitch - note.pitch) < 5);
      const kept = melody.filter((note, index) => !busy(note.tick)
        || (note.structural && (index === 0 || note.dur >= 2 * PPQ))
        || (directive.protectHead === true && clear(note)));
      if (records && kept.length !== melody.length) {
        records.push({
          bar: bar.bar, kind: 'answer-in-lead-rests',
          reason: `Kept ${kept.length} of ${melody.length} theme notes: the phrase opening and the notes that fall between the lead's attacks.`,
          evidence: `${lead.length} lead note(s) from ${(evidence.leadIdsByBar.get(bar.bar) ?? []).join(', ')} in bar ${bar.bar}.`,
        });
      }
      melody = kept.map((note, index) => ({
        ...note, dur: Math.min(note.dur, (kept[index + 1]?.tick ?? bar.endTick) - note.tick),
      }));
      // Never double the lead at the unison or octave: take the next chord tone below.
      melody = melody.map((note) => {
        const clash = lead.some((other) => other.start <= note.tick && other.end > note.tick && pc(other.pitch) === pc(note.pitch));
        const chord = chordAt(note.tick);
        if (!clash || !chord) return note;
        const others = chord.tones.filter((tone) => tone !== pc(note.pitch));
        const moved = others.length ? nearestWithClasses(note.pitch - 2, others, note.pitch - 7, note.pitch - 1) : null;
        if (moved === null) return note;
        records?.push({
          bar: bar.bar, kind: 'unison-substitution',
          reason: `Theme note ${note.pitch} would double the lead's pitch class; substituted chord tone ${moved}.`,
          evidence: `Lead sounds pitch class ${pc(note.pitch)} at tick ${note.tick}.`,
        });
        return { ...note, pitch: moved };
      });
    }
    // Keep the line singable after fitting, filtering and register decisions: inside a phrase no
    // step of the theme exceeds a major sixth.
    {
      let last = !leftTheme && previousMelodyPhrase === bar.phraseId ? previousMelody : null;
      const floor = leftTheme ? low : Math.max(low, 57);
      melody = melody.map((note) => {
        if (last === null || Math.abs(note.pitch - last) <= 9) { last = note.pitch; return note; }
        const chord = chordAt(note.tick);
        if (!chord) { last = note.pitch; return note; }
        const classes = chord.tones.includes(pc(note.pitch)) ? chord.tones : chord.localScale;
        const direction = Math.sign(note.pitch - last);
        const moved = nearestWithClasses(last + direction * 6, classes, Math.max(floor, last - 9),
          Math.min(high, last + 9, leftTheme ? 60 : profile.melodyCenter + 19));
        const pitch = moved !== null && moved !== last ? moved : note.pitch;
        last = pitch;
        return pitch === note.pitch ? note : { ...note, pitch };
      });
    }
    melody = resolveNonChordTones(melody);
    const melodyTechnique: PianoTechniqueIntent = leftTheme ? 'independent-counterline'
      : bar.themeBar === 0 && bar.themeStepShift === 0 && !bar.themeInvert ? 'theme-statement' : 'theme-development';
    for (const note of melody) {
      const chord = chordAt(note.tick);
      if (!chord) continue;
      const accent = (note.tick - bar.startTick) % (2 * PPQ) === 0 ? 2 : 0;
      const runLift = note.run ? Math.round(6 * (note.tick - bar.startTick) / (bar.endTick - bar.startTick)) - 2 : 0;
      push({
        ...common, chordId: chord.id, pitch: note.pitch, startTick: note.tick,
        durationTicks: note.run ? note.dur * 0.9 : note.dur * 0.97,
        hand: leftTheme ? 'left' : 'right', voiceId: leftTheme ? 'lh.support' : 'rh.melody', layer: 'melody',
        musicalRole: 'melody',
        gestureIntent: note.run ? 'cascading-gesture' : leftTheme ? 'counterline-answer' : 'cantabile-subject',
        techniqueIntent: note.run ? 'cascading-gesture' : melodyTechnique,
        noteRoleTag: note.run ? 'flourish' : directive.melody === 'answers' ? 'answer' : 'lift',
        articulation: 'legato',
        velocity: velocityFor(intensity, (leftTheme ? 3 : 6) + accent + runLift + trim + directive.melodyTrim),
      });
      if (bar.octaveDouble && level >= 3 && !leftTheme && note.structural && note.dur >= PPQ && note.pitch - 12 >= 55) {
        push({
          ...common, chordId: chord.id, pitch: note.pitch - 12, startTick: note.tick, durationTicks: note.dur * 0.97,
          hand: 'right', voiceId: 'rh.octave', layer: 'melody', musicalRole: 'octave',
          gestureIntent: 'octave-reinforcement', techniqueIntent: 'octave-doubling', noteRoleTag: 'power',
          articulation: 'legato', velocity: velocityFor(intensity, 0 + trim),
        });
      }
    }
    if (melody.length && !leftTheme) { previousMelody = melody[melody.length - 1].pitch; previousMelodyPhrase = bar.phraseId; }
    const rightMelody = leftTheme ? [] : melody;
    const melodyAt = (from: number, to: number) => rightMelody.filter((note) => note.tick < to && note.tick + note.dur > from);

    /* ---------------- left hand ---------------- */
    const leftThemeTop = leftTheme ? Math.max(...melody.map((note) => note.pitch)) : null;
    const leftThemeLow = leftTheme ? Math.min(...melody.map((note) => note.pitch)) : null;
    const rightFloor = rightMelody.length ? Math.min(...rightMelody.map((note) => note.pitch)) : melodyHome - 5;
    const leftCeiling = Math.min(62, rightFloor - 8);
    let leftTop = profile.bassCenter;
    segments.forEach(({ chord, start, end }, segmentIndex) => {
      const bass = chooseBass(chord);
      const slots = Math.max(1, Math.round((end - start) / EIGHTH));
      const pattern: PianoLeftPattern = leftLevel === 0 ? 'sustain'
        : leftLevel === bar.level || directive.leftLight ? bar.leftPattern
          : idn ? idn.accompaniment.left[leftLevel as 1 | 2 | 3] : profile.left[leftLevel as 1 | 2 | 3][0];
      // Protected rhythm cell under a busy low register (identity only): the cell keeps sounding in
      // the middle of the hand, the repeated bass notes are left to the orchestra's bass.
      const lightCell = directive.leftLight === true && pattern === 'cell-figure';
      const bassVelocity = velocityFor(intensity, (segmentIndex === 0 ? 1 : -2) + trim);
      if (leftTheme) {
        // The left hand carries the theme: a short downbeat bass only where it fits under the hand.
        const firstTheme = melody.find((note) => note.tick >= start && note.tick < end);
        if ((!firstTheme || firstTheme.tick > start) && leftThemeLow !== null && leftThemeLow - bass <= 12) {
          push({
            ...common, chordId: chord.id, pitch: bass, startTick: start,
            durationTicks: Math.min(PPQ, (firstTheme?.tick ?? end) - start) * 0.95,
            hand: 'left', voiceId: 'lh.bass', layer: 'bass', musicalRole: 'bass', gestureIntent: 'bass-foundation',
            techniqueIntent: 'sustained-bass-foundation', noteRoleTag: 'anchor', articulation: 'legato', velocity: bassVelocity,
          });
        }
        previousBass = bass;
        leftTop = leftThemeTop ?? bass;
        return;
      }
      const open = pattern === 'broken-tenths' || pattern === 'rolling-arpeggio';
      const ladder = buildLadder(chord, bass, open, leftCeiling);
      leftTop = Math.max(leftTop, ...ladder);
      const technique = LEFT_TECHNIQUE[pattern];

      if (pattern === 'sustain' || ladder.length < 2) {
        push({
          ...common, chordId: chord.id, pitch: bass, startTick: start, durationTicks: end - start,
          hand: 'left', voiceId: 'lh.bass', layer: 'bass', musicalRole: 'bass', gestureIntent: 'bass-foundation',
          techniqueIntent: 'sustained-bass-foundation', noteRoleTag: 'anchor', articulation: 'legato', velocity: bassVelocity,
        });
        const support = ladder.find((pitch) => pitch > bass && pitch - bass <= 12);
        if (support !== undefined && density >= 0.2) {
          push({
            ...common, chordId: chord.id, pitch: support, startTick: start, durationTicks: (end - start) * 0.9,
            hand: 'left', voiceId: 'lh.support', layer: 'accompaniment', musicalRole: 'support', gestureIntent: 'harmonic-support',
            techniqueIntent: 'chord-tone-support', noteRoleTag: 'bed', articulation: 'legato', velocity: velocityFor(intensity, -9 + trim),
          });
        }
      } else if (pattern === 'walking') {
        const next = chords[chords.indexOf(chord) + 1] ?? null;
        const beats = Math.max(1, Math.round((end - start) / PPQ));
        let current = bass;
        for (let beat = 0; beat < beats; beat++) {
          const tick = start + beat * PPQ;
          let pitch = bass;
          if (beat > 0 && beat === beats - 1 && next) {
            const nextBass = nearestWithClasses(current, [next.bass], Math.max(low, profile.bassCenter - 9), profile.bassCenter + 12) ?? current;
            pitch = stepInScale(nextBass, nextBass >= current ? -1 : 1, next.localScale);
            if (pitch === current) pitch = stepInScale(nextBass, nextBass >= current ? 1 : -1, next.localScale);
          } else if (beat > 0) {
            const tones = chord.tones.filter((tone) => tone !== pc(current));
            pitch = nearestWithClasses(current + 3, tones, current + 1, bass + 12)
              ?? nearestWithClasses(current - 3, tones, Math.max(low, bass - 5), current - 1) ?? bass;
          }
          current = pitch;
          push({
            ...common, chordId: chord.id, pitch, startTick: tick, durationTicks: PPQ * 0.92,
            hand: 'left', voiceId: 'lh.bass', layer: 'bass', musicalRole: 'bass',
            gestureIntent: beat === 0 ? 'bass-foundation' : 'walking-bass-motion', techniqueIntent: 'walking-bass-line',
            noteRoleTag: beat === 0 ? 'anchor' : 'lift', articulation: 'legato',
            velocity: velocityFor(intensity, (beat === 0 ? 0 : -4) + trim),
          });
        }
      } else {
        const sequence = (pattern === 'cell-figure' ? cellSequence : SEQUENCES[pattern]).slice(0, slots);
        const attacks = sequence.map((entry, slot) => ({ entry, slot })).filter((item) => item.entry !== null);
        attacks.forEach(({ entry, slot }, attackIndex) => {
          const tick = start + slot * EIGHTH;
          const nextSlot = attacks[attackIndex + 1]?.slot ?? slots;
          const length = (nextSlot - slot) * EIGHTH;
          const indices = Array.isArray(entry) ? entry as readonly number[] : [entry as number];
          for (const index of indices) {
            if (lightCell && index === 0 && slot > 0) continue;
            const isBass = index === 0;
            const pitch = ladder[Math.min(index, ladder.length - 1)];
            if (!isBass && pitch === bass) continue;
            const strong = slot % 4 === 0;
            push({
              ...common, chordId: chord.id, pitch, startTick: tick,
              durationTicks: length * (pattern === 'ostinato-332' || pattern === 'stride' ? 0.8 : 0.95),
              hand: 'left', voiceId: isBass ? 'lh.bass' : 'lh.support', layer: isBass ? 'bass' : 'accompaniment',
              musicalRole: isBass ? 'bass' : 'support',
              gestureIntent: isBass ? (pattern === 'ostinato-332' || pattern === 'pulse-quarters' ? 'bass-pulse' : 'bass-foundation')
                : pattern === 'rolling-arpeggio' || pattern === 'broken-tenths' ? 'arpeggio-figure' : 'broken-chord-figure',
              techniqueIntent: isBass && slot === 0 && pattern !== 'ostinato-332' ? 'sustained-bass-foundation' : technique,
              noteRoleTag: isBass && slot === 0 ? 'anchor' : 'bed',
              articulation: pattern === 'ostinato-332' ? 'staccato' : 'legato',
              velocity: isBass ? velocityFor(intensity, (slot === 0 ? (segmentIndex === 0 ? 1 : -2) : -4) + trim)
                : velocityFor(intensity, (strong ? -8 : -11) + trim),
            });
          }
        });
      }
      previousBass = bass;
      previousLadder = ladder;
    });

    /* ---------------- right hand under (or without) the melody ---------------- */
    const style: PianoRightStyle = level === 0 ? 'held'
      : directive.rightCap ?? bar.rightStyle;
    const innerCount = directive.rightThin ? 1 : level === 0 ? (density >= 0.6 ? 2 : 1)
      : level === 1 ? Math.min(2, profile.innerVoices)
        : level === 2 ? profile.innerVoices
          : Math.min(3, profile.innerVoices + 1);
    const nextInner: number[] = [];
    segments.forEach(({ chord, start, end }, segmentIndex) => {
      const sounding = melodyAt(start, end);
      const floor = Math.max(leftTop + 1, leftTheme && leftThemeTop !== null ? leftThemeTop + 1 : 0);
      let windowLow: number;
      let windowHigh: number;
      if (sounding.length) {
        const top = Math.max(...sounding.map((note) => note.pitch));
        const bottom = Math.min(...sounding.map((note) => note.pitch));
        windowHigh = bottom - 2;
        windowLow = Math.max(floor, top - 12);
      } else {
        const center = leftTheme ? Math.max(floor + 6, 69) : melodyHome - 7;
        windowLow = Math.max(floor, center - 6);
        windowHigh = center + 6;
      }
      const melodyClasses = sounding.filter((note) => note.tick <= start).map((note) => pc(note.pitch));
      const bassClass = previousBass === null ? -1 : pc(previousBass);
      const candidates: { pitch: number; cost: number }[] = [];
      for (let pitch = windowLow; pitch <= Math.min(high, windowHigh); pitch++) {
        const tone = pc(pitch);
        if (!chord.tones.includes(tone)) continue;
        if (melodyClasses.includes(tone) && level < 3) continue;
        if (octaveForbidden && (tone === bassClass || melodyClasses.includes(tone))) continue;
        const preference = chord.rightPreference.indexOf(tone);
        const reference = previousInner.length
          ? Math.min(...previousInner.map((other) => Math.abs(other - pitch)))
          : Math.abs(pitch - (windowLow + windowHigh) / 2) * 0.5;
        candidates.push({ pitch, cost: reference + (preference < 0 ? 4 : preference * 0.9) });
      }
      candidates.sort((a, b) => a.cost - b.cost || a.pitch - b.pitch);
      const tones: number[] = [];
      for (const candidate of candidates) {
        if (tones.length >= innerCount) break;
        if (tones.every((other) => Math.abs(other - candidate.pitch) >= 2)) tones.push(candidate.pitch);
      }
      tones.sort((a, b) => a - b);
      if (!tones.length) return;
      const slots = Math.max(1, Math.round((end - start) / EIGHTH));
      const chordal = tones.length >= 2;
      const base: Omit<PianoDraftEvent, 'pitch' | 'velocity' | 'sectionId' | 'durationTicks' | 'startTick' | 'techniqueIntent' | 'gestureIntent' | 'noteRoleTag' | 'articulation'> = {
        ...common, chordId: chord.id, hand: 'right', voiceId: 'rh.inner', layer: 'inner', musicalRole: 'inner',
      };
      const strike = (
        tick: number, length: number, pitches: readonly number[], offset: number,
        technique: PianoTechniqueIntent, gesture: PianoGestureIntent, tag: NoteRoleTag, articulation: Articulation,
      ) => {
        for (const pitch of pitches) {
          push({ ...base, pitch, startTick: tick, durationTicks: length, techniqueIntent: technique, gestureIntent: gesture, noteRoleTag: tag, articulation, velocity: velocityFor(intensity, offset + trim) });
        }
      };
      const melodyAttackSlots = new Set(sounding.filter((note) => note.tick >= start && note.tick < end)
        .map((note) => Math.round((note.tick - start) / EIGHTH)));

      if (leftTheme) {
        // Hands exchange roles: the right hand takes the broken figure.
        const figure = tones.length >= 2 ? tones : [tones[0]];
        const stepSlots = level >= 2 ? 1 : 2;
        for (let slot = 0, index = 0; slot < slots; slot += stepSlots, index++) {
          const order = figure.length >= 3 ? [0, 1, 2, 1] : [0, 1];
          strike(start + slot * EIGHTH, stepSlots * EIGHTH * 0.92, [figure[order[index % order.length] % figure.length]],
            slot % 4 === 0 ? -7 : -10, 'broken-chord-accompaniment', 'broken-chord-figure', 'bed', 'legato');
        }
      } else if (style === 'block-chords' || (level >= 1 && segmentIndex === 0 && bar.themeBar === 0 && density >= 0.75 && style === 'held')) {
        const half = Math.floor(slots / 2);
        const full = style === 'block-chords';
        strike(start, (full && half >= 2 ? half : slots) * EIGHTH * 0.96, tones, full ? -3 : -6,
          chordal ? 'block-chord' : 'voice-led-inner-tone', chordal ? 'chordal-weight' : 'inner-voice', full ? 'power' : 'bed', 'legato');
        if (full && half >= 2) {
          strike(start + half * EIGHTH, (slots - half) * EIGHTH * 0.96, tones, -6, chordal ? 'block-chord' : 'voice-led-inner-tone',
            chordal ? 'chordal-weight' : 'inner-voice', 'bed', 'legato');
          // Light inner pulse between the two weights where the melody is holding.
          for (const slot of [half - 1, slots - 1]) {
            if (slot > 0 && !melodyAttackSlots.has(slot) && density >= 0.75) {
              strike(start + slot * EIGHTH, EIGHTH * 0.9, [tones[tones.length - 1]], -12, 'moving-inner-voice', 'inner-line-motion', 'bed', 'legato');
            }
          }
        }
      } else if (style === 'restrike') {
        const half = Math.floor(slots / 2);
        strike(start, (half >= 2 ? half : slots) * EIGHTH * 0.96, tones, -7,
          chordal ? 'rhythmic-chord-accompaniment' : 'voice-led-inner-tone', chordal ? 'chordal-weight' : 'inner-voice', 'bed', 'legato');
        if (half >= 2) {
          strike(start + half * EIGHTH, (slots - half) * EIGHTH * 0.96, tones.slice(-Math.max(1, tones.length - 1)), -10,
            chordal ? 'rhythmic-chord-accompaniment' : 'voice-led-inner-tone', 'inner-voice', 'bed', 'legato');
        }
      } else if (style === 'answer-chords') {
        // Identity only: chords in the gaps of the melody. Each chord falls on a slot where the line is
        // holding or resting, so the right hand answers the theme's own rhythm instead of a fixed one.
        const limit = level >= 3 ? 3 : 2;
        const chosen: number[] = [];
        for (let slot = sounding.length ? 1 : 0; slot < slots && chosen.length < limit; slot++) {
          if (melodyAttackSlots.has(slot)) continue;
          if (chosen.length && slot - chosen[chosen.length - 1] < 2) continue;
          // Prefer the slot right after a melody attack: that is where an answer is heard as one.
          if (sounding.length && !melodyAttackSlots.has(slot - 1) && slot % 2 === 1) continue;
          chosen.push(slot);
        }
        if (!chosen.length) {
          strike(start, slots * EIGHTH * 0.96, tones, -8, chordal ? 'held-chord-support' : 'voice-led-inner-tone', chordal ? 'harmonic-support' : 'inner-voice', 'bed', 'legato');
        }
        chosen.forEach((slot, index) => {
          let next = chosen[index + 1] ?? slots;
          for (let probe = slot + 1; probe < next; probe++) if (melodyAttackSlots.has(probe)) { next = probe; break; }
          strike(start + slot * EIGHTH, Math.min(next - slot, 2) * EIGHTH * 0.9, level >= 3 ? tones : tones.slice(-2), slot % 4 === 0 ? -7 : -9,
            'rhythmic-chord-accompaniment', chordal ? 'chordal-weight' : 'inner-voice', 'answer', 'legato');
        });
      } else if (style === 'offbeat-stabs') {
        const pattern = level >= 3 ? [1, 2.5, 4, 5.5, 7] : [2, 5];
        strike(start, EIGHTH * 0.8, tones, -6, 'rhythmic-chord-accompaniment', 'chordal-weight', 'punctuation', 'staccato');
        for (const position of pattern) {
          if (position >= slots) continue;
          strike(start + position * EIGHTH, EIGHTH * 0.55, tones, Number.isInteger(position) ? -8 : -11,
            'syncopated-pulse-accompaniment', 'chordal-weight', 'punctuation', 'staccato');
        }
      } else if (style === 'flowing-inner') {
        // A held lower tone plus a moving inner line that answers the melody's long notes.
        const lowerTone = tones[0];
        strike(start, slots * EIGHTH * 0.96, [lowerTone], -8, 'voice-led-inner-tone', 'inner-voice', 'bed', 'legato');
        const linePool: number[] = [];
        for (let pitch = Math.max(windowLow, lowerTone + 2); pitch <= Math.min(high, windowHigh); pitch++) {
          if (chord.tones.includes(pc(pitch)) && !(octaveForbidden && melodyClasses.includes(pc(pitch)))) linePool.push(pitch);
        }
        if (linePool.length >= 2) {
          const ascending = unitRandom(seed, `independent:inner-direction:${bar.bar}:${segmentIndex}`) < 0.5;
          const ordered = ascending ? linePool : [...linePool].reverse();
          const stepSlots = level >= 3 ? 1 : 2;
          let index = 0;
          for (let slot = stepSlots; slot < slots; slot += stepSlots) {
            if (melodyAttackSlots.has(slot)) continue;
            const pitch = ordered[index % ordered.length];
            index++;
            strike(start + slot * EIGHTH, stepSlots * EIGHTH * 0.92, [pitch], slot % 4 === 0 ? -8 : -10,
              'flowing-inner-voice', 'inner-line-motion', 'answer', 'legato');
          }
        } else if (tones.length > 1) {
          strike(start, slots * EIGHTH * 0.96, tones.slice(1), -9, 'voice-led-inner-tone', 'inner-voice', 'bed', 'legato');
        }
      } else {
        strike(start, slots * EIGHTH * (level === 0 ? 1 : 0.96), tones, -8,
          chordal && level >= 1 ? 'held-chord-support' : 'voice-led-inner-tone', chordal && level >= 1 ? 'harmonic-support' : 'inner-voice', 'bed', 'legato');
      }
      nextInner.push(...tones);
    });
    previousInner = nextInner.length ? [...new Set(nextInner)] : previousInner;
  }

  return events;
}

/* ------------------------------------------------------------------ */
/* Bounded orchestral adaptation                                       */
/* ------------------------------------------------------------------ */

const BASS_ROLES = new Set(['cellosBasses', 'basses', 'tuba', 'trombones', 'bassoons']);
const UNPITCHED_ROLES = new Set(['timpani', 'snare', 'cymbals', 'aux', 'percussion']);

function collectEvidence(input: PianoEngineInput, plan: PianoComposerPlan, arc: ArcContext): ExternalEvidence {
  const tracks = input.analysis.tracks.filter((track) =>
    track.role !== 'piano' && track.notes.length > 0 && track.compositionState?.composerVisible !== false);
  const leadNotesByBar = new Map<number, { start: number; end: number; pitch: number }[]>();
  const leadIdsByBar = new Map<number, string[]>();
  const upperOnsetsByBar = new Map<number, number>();
  const bassOnsetsByBar = new Map<number, number>();
  const momentByBar = new Map<number, { kind: string; pianoParticipates: boolean; explicitOthers: boolean }>();
  for (const bar of arc.bars) {
    const leadIds = [...new Set(plan.harmonicEvents
      .filter((event) => event.chord.startTick < bar.endTick && event.chord.endTick > bar.startTick)
      .flatMap((event) => event.orchestration.explicitLeadTrackIds))];
    const leadNotes = tracks.filter((track) => leadIds.includes(track.id))
      .flatMap((track) => track.notes)
      .filter((note) => note.startTick < bar.endTick && note.startTick + note.durationTicks > bar.startTick)
      .map((note) => ({ start: note.startTick, end: note.startTick + note.durationTicks, pitch: note.pitch }));
    if (leadNotes.length) { leadNotesByBar.set(bar.bar, leadNotes); leadIdsByBar.set(bar.bar, leadIds); }
    let upper = 0;
    let bass = 0;
    for (const track of tracks) {
      if (UNPITCHED_ROLES.has(track.role) || leadIds.includes(track.id)) continue;
      for (const note of track.notes) {
        if (note.startTick < bar.startTick || note.startTick >= bar.endTick) continue;
        if (note.pitch >= 60 && note.pitch <= 96 && !BASS_ROLES.has(track.role)) upper++;
        if (note.pitch >= 28 && note.pitch <= 55) bass++;
      }
    }
    upperOnsetsByBar.set(bar.bar, upper);
    bassOnsetsByBar.set(bar.bar, bass);
    const moment = input.context.moments.find((entry) => entry.startTick < bar.endTick && entry.endTick > bar.startTick);
    if (moment) {
      const participants = moment.participantRoles?.map((role) => role.toLowerCase());
      momentByBar.set(bar.bar, {
        kind: moment.kind,
        pianoParticipates: !!participants?.some((role) => role === 'piano' || role === 'keys'),
        explicitOthers: !!participants,
      });
    }
  }
  return { available: tracks.length > 0, leadNotesByBar, leadIdsByBar, upperOnsetsByBar, bassOnsetsByBar, momentByBar };
}

function adaptDirectives(
  arc: ArcContext,
  evidence: ExternalEvidence,
  profile: TextureProfile,
  records: PianoAdaptationRecord[],
  idn: PianoCompositionIdentity | null = null,
): Map<number, BarDirective> {
  const protects = (trait: 'theme-head' | 'rhythm-cell' | 'bass-motion'): boolean => !!idn && idn.protectedTraits.includes(trait);
  const directives = new Map<number, BarDirective>();
  const roleByPhrase = new Map(arc.phrases.map((phrase) => [phrase.phraseId, phrase.role]));
  // One register decision per phrase, so the theme never jumps octaves mid-phrase.
  const phraseShift = new Map<string, { shift: number; mean: number; centre: number }>();
  for (const phrase of arc.phrases) {
    const bars = arc.bars.filter((bar) => bar.phraseId === phrase.phraseId && !bar.restricted && bar.themeBar !== null);
    const led = bars.filter((bar) => (evidence.leadNotesByBar.get(bar.bar) ?? []).length > 0);
    if (!bars.length || led.length * 2 < bars.length) continue;
    const notes = led.flatMap((bar) => evidence.leadNotesByBar.get(bar.bar) ?? []);
    const mean = notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length;
    const centre = profile.melodyCenter + 12 * Math.max(...bars.map((bar) => bar.themeOctave));
    if (Math.abs(mean - centre) > 6) continue;
    const down = centre - 12 >= 64;
    const up = centre + 12 <= 91;
    const shift = mean >= centre ? (down ? -1 : up ? 1 : 0) : (up ? 1 : down ? -1 : 0);
    if (shift !== 0) phraseShift.set(phrase.phraseId, { shift, mean, centre });
  }
  for (const bar of arc.bars) {
    const directive: BarDirective = {
      level: bar.level, melody: 'theme', registerShift: 0, velocityTrim: 0, melodyTrim: 0, rightCap: null, leftCap: null,
    };
    directives.set(bar.bar, directive);
    if (!evidence.available || bar.restricted) continue; // Missing evidence is a no-op, never a rest.

    const lead = evidence.leadNotesByBar.get(bar.bar) ?? [];
    const moment = evidence.momentByBar.get(bar.bar);
    if (lead.length) {
      const ids = (evidence.leadIdsByBar.get(bar.bar) ?? []).join(', ');
      directive.melody = 'answers';
      directive.melodyTrim = -3;
      if (protects('theme-head') && bar.themeBar === 0) directive.protectHead = true;
      records.push({
        bar: bar.bar, kind: 'accompany-lead',
        reason: 'An annotated lead is sounding: the Piano keeps its accompaniment and moves its theme into an answering role.',
        evidence: `${lead.length} lead note(s) from ${ids}.`,
      });
      const shift = phraseShift.get(bar.phraseId);
      if (shift && bar.themeHand !== 'left' && bar.themeBar !== null) {
        directive.registerShift = shift.shift;
        records.push({
          bar: bar.bar, kind: 'register-shift',
          reason: `Piano theme moved ${shift.shift > 0 ? 'up' : 'down'} an octave for this phrase to clear the lead's register.`,
          evidence: `Lead mean pitch ${shift.mean.toFixed(1)} against Piano theme centre ${shift.centre}.`,
        });
      }
      if (bar.level === 3) {
        directive.level = 2;
        records.push({
          bar: bar.bar, kind: 'texture-level-lowered',
          reason: 'Full two-hand figuration reduced one level under the lead; the left-hand pattern continues.',
          evidence: `Lead active (${ids}); independent level 3.`,
        });
      }
    }
    if (moment && !moment.pianoParticipates && (moment.kind === 'soli' || moment.kind === 'unison')) {
      // The spotlight belongs to others for exactly these bars.
      if (directive.level > 1) directive.level = 1;
      directive.melody = 'skeleton';
      directive.velocityTrim = -8;
      records.push({
        bar: bar.bar, kind: 'moment-yield',
        reason: `Explicit ${moment.kind} moment without the Piano: texture held to level ${directive.level} and the theme reduced to its skeleton for this bar only.`,
        evidence: `Conductor ${moment.kind} moment overlaps bar ${bar.bar}.`,
      });
    } else if (moment && (moment.pianoParticipates || moment.kind === 'tutti')) {
      records.push({
        bar: bar.bar, kind: 'moment-support',
        reason: `Piano joins the ${moment.kind} moment with its independent texture unchanged.`,
        evidence: `Conductor ${moment.kind} moment overlaps bar ${bar.bar}.`,
      });
    }
    const upper = evidence.upperOnsetsByBar.get(bar.bar) ?? 0;
    if (upper >= 12 && directive.level >= 2 && bar.rightStyle === 'answer-chords' && protects('rhythm-cell')) {
      directive.rightThin = true;
      directive.velocityTrim = Math.min(directive.velocityTrim, -3);
      records.push({
        bar: bar.bar, kind: 'right-hand-thinned',
        reason: 'Right-hand answers reduced to a single soft note each: the registers above are busy, and the answering rhythm is a protected trait of this piece.',
        evidence: `${upper} non-lead onsets between MIDI 60 and 96 in bar ${bar.bar}.`,
      });
    } else if (upper >= 12 && directive.level >= 2 && bar.rightStyle !== 'held') {
      directive.rightCap = 'held';
      records.push({
        bar: bar.bar, kind: 'right-hand-thinned',
        reason: 'Right-hand chord motion held instead of re-struck: the middle and upper registers are already busy. Theme and left hand are unchanged.',
        evidence: `${upper} non-lead onsets between MIDI 60 and 96 in bar ${bar.bar}.`,
      });
    }
    const bass = evidence.bassOnsetsByBar.get(bar.bar) ?? 0;
    if (bass >= 8 && directive.level >= 2 && bar.leftPattern === 'cell-figure' && protects('rhythm-cell')) {
      directive.leftLight = true;
      records.push({
        bar: bar.bar, kind: 'left-hand-simplified',
        reason: 'Left-hand figure keeps its rhythm on the upper notes only: the repeated bass notes are left out against an actively moving low register. The rhythm of the theme is a protected trait of this piece.',
        evidence: `${bass} onsets between MIDI 28 and 55 in bar ${bar.bar}.`,
      });
    } else if (bass >= 8 && directive.level >= 2) {
      // Against a running low register the left hand moves to its quarter-note pattern: the
      // downbeat bass and the harmony stay, the eighth-note figuration is left to the bass line.
      directive.leftCap = 1;
      records.push({
        bar: bar.bar, kind: 'left-hand-simplified',
        reason: 'Left-hand figuration reduced to its quarter-note pattern against an actively moving low register; the Piano bass is kept.',
        evidence: `${bass} onsets between MIDI 28 and 55 in bar ${bar.bar}.`,
      });
    }
    if (roleByPhrase.get(bar.phraseId) === 'climax' && lead.length && directive.velocityTrim === 0) {
      directive.velocityTrim = -2;
    }
  }
  return directives;
}

/* ------------------------------------------------------------------ */
/* Clean-up, diagnostics and entry point                               */
/* ------------------------------------------------------------------ */

const VOICE_PRIORITY: Readonly<Record<PianoScoreVoiceId, number>> = {
  'rh.melody': 6, 'rh.suspension': 5, 'rh.octave': 4, 'lh.bass': 3, 'rh.inner': 2, 'lh.support': 1,
};

/** One sounding instance per pitch; the more important voice keeps the attack. */
function resolveUnisons(events: readonly PianoDraftEvent[]): PianoDraftEvent[] {
  const ordered = [...events].sort((a, b) => VOICE_PRIORITY[b.voiceId] - VOICE_PRIORITY[a.voiceId]
    || a.startTick - b.startTick || a.pitch - b.pitch);
  const accepted: PianoDraftEvent[] = [];
  const byPitch = new Map<number, PianoDraftEvent[]>();
  for (const event of ordered) {
    let end = event.startTick + event.durationTicks;
    let drop = false;
    for (const other of byPitch.get(event.pitch) ?? []) {
      const otherEnd = other.startTick + other.durationTicks;
      if (other.startTick >= end || otherEnd <= event.startTick) continue;
      if (other.startTick <= event.startTick) { drop = true; break; }
      end = Math.min(end, other.startTick);
    }
    if (drop || end - event.startTick < 60) continue;
    const kept = end === event.startTick + event.durationTicks ? event : { ...event, durationTicks: end - event.startTick };
    accepted.push(kept);
    byPitch.set(event.pitch, [...(byPitch.get(event.pitch) ?? []), kept]);
  }
  return accepted.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
}

function activityByBar(events: readonly PianoDraftEvent[], bar: number): PianoLayerActivity & { attacks: number } {
  const inBar = events.filter((event) => event.bar === bar);
  const count = (layer: PianoLayer) => inBar.filter((event) => event.layer === layer).length;
  return {
    melody: count('melody'), bass: count('bass'), accompaniment: count('accompaniment'), inner: count('inner'),
    attacks: new Set(inBar.map((event) => event.startTick)).size,
  };
}

function buildDiagnostics(
  identity: PianoTemplateIdentity,
  density: number,
  theme: PianoTheme | null,
  arc: ArcContext,
  independent: readonly PianoDraftEvent[],
  adapted: readonly PianoDraftEvent[],
  directives: ReadonlyMap<number, BarDirective>,
  evidence: ExternalEvidence,
  records: readonly PianoAdaptationRecord[],
  profile: TextureProfile,
  idn: PianoCompositionIdentity | null = null,
): PianoCompositionDiagnostics {
  const roleByPhrase = new Map(arc.phrases.map((phrase) => [phrase.phraseId, phrase.role]));
  const bars = arc.bars.map((bar) => ({
    bar: bar.bar,
    phraseId: bar.phraseId,
    role: roleByPhrase.get(bar.phraseId) ?? 'development' as PianoArcRole,
    energy: Math.round(bar.energy * 1000) / 1000,
    independentLevel: bar.level,
    adaptedLevel: directives.get(bar.bar)?.level ?? bar.level,
    leftPattern: bar.leftPattern,
    rightStyle: bar.rightStyle,
    themeBar: bar.themeBar,
    independent: activityByBar(independent, bar.bar),
    adapted: activityByBar(adapted, bar.bar),
  }));
  const phrases = arc.phrases.map((phrase) => {
    const phraseBars = bars.filter((bar) => bar.phraseId === phrase.phraseId);
    const mean = (pick: (bar: typeof bars[number]) => number) => phraseBars.length
      ? Math.round(phraseBars.reduce((sum, bar) => sum + pick(bar), 0) / phraseBars.length * 100) / 100 : 0;
    return {
      ...phrase,
      adaptedLevels: phraseBars.map((bar) => bar.adaptedLevel),
      melodyEvents: {
        independent: phraseBars.reduce((sum, bar) => sum + bar.independent.melody, 0),
        adapted: phraseBars.reduce((sum, bar) => sum + bar.adapted.melody, 0),
      },
      attacksPerBar: { independent: mean((bar) => bar.independent.attacks), adapted: mean((bar) => bar.adapted.attacks) },
    };
  });

  // Independent versus adapted material.
  const key = (event: PianoDraftEvent) => `${event.startTick}:${event.layer}`;
  const adaptedPool = new Map<string, PianoDraftEvent[]>();
  for (const event of adapted) adaptedPool.set(key(event), [...(adaptedPool.get(key(event)) ?? []), event]);
  const changes = { unchanged: 0, removed: 0, added: 0, registerMoved: 0, revoiced: 0, shortened: 0, softened: 0 };
  for (const event of independent) {
    const pool = adaptedPool.get(key(event)) ?? [];
    let index = pool.findIndex((other) => other.pitch === event.pitch);
    if (index < 0) index = pool.findIndex((other) => pc(other.pitch) === pc(event.pitch));
    if (index < 0 && pool.length) index = 0;
    if (index < 0) { changes.removed++; continue; }
    const match = pool.splice(index, 1)[0];
    if (match.pitch !== event.pitch) {
      if (pc(match.pitch) === pc(event.pitch)) changes.registerMoved++; else changes.revoiced++;
    } else if (match.durationTicks < event.durationTicks) changes.shortened++;
    else if (match.velocity < event.velocity) changes.softened++;
    else changes.unchanged++;
  }
  for (const pool of adaptedPool.values()) changes.added += pool.length;

  const attackTicks = [...new Set(adapted.map((event) => event.startTick))];
  const subdivisions = { beat: 0, eighth: 0, sixteenth: 0 };
  for (const tick of attackTicks) {
    if (tick % PPQ === 0) subdivisions.beat++;
    else if (tick % EIGHTH === 0) subdivisions.eighth++;
    else subdivisions.sixteenth++;
  }
  const chordalEvents = attackTicks.filter((tick) =>
    adapted.filter((event) => event.startTick === tick && event.hand === 'right').length >= 3).length;
  const patternUsage: Record<string, number> = {};
  for (const event of adapted) patternUsage[event.techniqueIntent] = (patternUsage[event.techniqueIntent] ?? 0) + 1;
  const velocities = adapted.map((event) => event.velocity);
  const levelBars: [number, number, number, number] = [0, 0, 0, 0];
  for (const bar of bars) levelBars[bar.adaptedLevel]++;

  const flags: string[] = [];
  const liveBars = bars.filter((bar) => !arc.bars.find((entry) => entry.bar === bar.bar)?.restricted);
  for (const phrase of phrases) {
    if (phrase.role === 'breath') continue;
    const phraseBars = liveBars.filter((bar) => bar.phraseId === phrase.phraseId);
    if (phraseBars.length && phraseBars.every((bar) => bar.adapted.attacks === 0)) {
      flags.push(`empty-non-rest-phrase: ${phrase.phraseId} has no Piano attack although it is not a rest phrase.`);
    }
    if (phrase.melodyEvents.independent > 0 && phrase.melodyEvents.adapted === 0) {
      flags.push(`missing-melody-role: adaptation removed every theme note in ${phrase.phraseId}.`);
    }
  }
  let still = 0;
  for (const bar of liveBars) {
    still = bar.adapted.attacks <= 1 ? still + 1 : 0;
    if (still === 4) flags.push(`no-motion: four consecutive live bars ending at bar ${bar.bar} have at most one attack each.`);
  }
  if (independent.length && changes.removed / independent.length > 0.4) {
    flags.push(`excessive-adaptation-removal: ${changes.removed} of ${independent.length} independent events were removed.`);
  }
  if (liveBars.length >= 8 && density >= 0.4 && new Set(liveBars.map((bar) => bar.adaptedLevel)).size === 1) {
    flags.push('no-texture-development: every live bar sits on the same adapted texture level.');
  }
  const perSection = new Map<string, number[]>();
  for (const phrase of phrases) {
    if (phrase.role === 'breath') continue;
    perSection.set(phrase.sectionId, [...(perSection.get(phrase.sectionId) ?? []), phrase.attacksPerBar.adapted]);
  }
  const sectionMeans = [...perSection.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  if (sectionMeans.length >= 3 && density >= 0.4 && Math.max(...sectionMeans) - Math.min(...sectionMeans) < 0.75) {
    flags.push('uniform-sections: mean attacks per bar differ by less than 0.75 across all sections.');
  }
  void profile;

  return {
    version: 1,
    algorithm: idn ? 'piano-composition-identity-v1' : 'piano-texture-theme-v1',
    templateIdentity: identity,
    density,
    randomStreams: { independent: 'independent:*', adaptation: 'none drawn; adaptation is evidence-driven and deterministic' },
    theme,
    phrases,
    bars,
    independentDraft: {
      events: independent.length,
      notes: independent.map((event) => ({ t: event.startTick, d: event.durationTicks, p: event.pitch, v: event.velocity, l: event.layer, k: event.techniqueIntent })),
    },
    adaptedDraft: { events: adapted.length },
    adaptation: { evidence: evidence.available ? 'available' : 'none', records, changes },
    metrics: {
      attacksPerBar: bars.length ? Math.round(attackTicks.length / bars.length * 100) / 100 : 0,
      melodyEventsPerPhrase: phrases.length
        ? Math.round(phrases.reduce((sum, phrase) => sum + phrase.melodyEvents.adapted, 0) / phrases.length * 100) / 100 : 0,
      subdivisions,
      longNoteShare: adapted.length
        ? Math.round(adapted.filter((event) => event.durationTicks >= 2 * PPQ).length / adapted.length * 100) / 100 : 0,
      chordalEvents,
      patternUsage,
      velocityRange: velocities.length ? [Math.min(...velocities), Math.max(...velocities)] : [0, 0],
      textureLevelBars: levelBars,
    },
    flags,
    ...(idn ? { identity: idn } : {}),
  };
}

/** Template facts an identity has to respect, read from the template's own profile. */
export function pianoIdentityTemplateFacts(templateIdentity: string): PianoIdentityTemplateFacts {
  const profile = PROFILES[templateIdentity] ?? PROFILES['adaptive-spacious'];
  return {
    templateIdentity: PROFILES[templateIdentity] ? templateIdentity : 'adaptive-spacious',
    contours: profile.contours,
    leftHandTheme: profile.leftHandTheme,
    melodyCenter: profile.melodyCenter,
  };
}

/**
 * The project seed of the Piano: user seed, template and the song itself
 * (harmony and form). It does not contain the take, so pressing Compose All
 * again walks through one seeded order of archetypes instead of redrawing it.
 */
function pianoProjectSeed(input: PianoEngineInput, plan: PianoComposerPlan, chords: readonly ChordInfo[]): number {
  return identityHash([
    `seed:${plan.generationIdentity.userSeed}`,
    `template:${plan.template.id}`,
    ...chords.map((chord) => `${chord.startTick}-${chord.endTick}:${chord.root}/${chord.bass}:${chord.tones.join('.')}`),
    ...input.context.sections.map((section) => `${section.id}:${section.name}`),
  ].join('|'));
}

/**
 * Compose the independent Piano draft, then adapt it to the finalized
 * non-Piano arrangement. Returns unidentified draft events; the Composer
 * wraps them into the immutable PianoScore.
 */
export function composeTextureTheme(
  input: PianoEngineInput,
  plan: PianoComposerPlan,
  target: PianoScoreTarget,
  projectEndTick: number,
  density: number,
  mode: PianoCompositionMode = DEFAULT_PIANO_COMPOSITION_MODE,
): PianoTextureThemeResult {
  const identity = plan.template.style.identity;
  const profile = PROFILES[identity] ?? PROFILES['adaptive-spacious'];
  const scale = inferScale(input);
  const chords = chordInfos(input, scale);
  // Classic mode never derives an identity: `idn` stays null and every identity branch below is skipped.
  const idn = mode === 'classic' ? null : derivePianoCompositionIdentity({
    projectSeed: pianoProjectSeed(input, plan, chords),
    take: plan.generationIdentity.take,
    compositionSeed: compositionSeed(plan),
    template: pianoIdentityTemplateFacts(identity),
  });
  const theme = idn ? buildIdentityTheme(idn, chords, scale) : buildTheme(compositionSeed(plan), profile, chords, scale);
  const octaveRule = input.context.rules.find((rule) => rule.type === 'octaveDoubling');
  const octaveAllowedAt = (energy: number): boolean => {
    if (!octaveRule || octaveRule.type !== 'octaveDoubling') return false;
    if (octaveRule.policy === 'allowed') return energy >= 0.72;
    if (octaveRule.policy === 'climaxOnly') return energy >= (octaveRule.energyThreshold ?? 1);
    return false;
  };
  const arc = planArc(input, plan, profile, theme, density, octaveAllowedAt, idn);
  const shared = { input, plan, profile, identity, theme, arc, chords, scale, target, endTick: projectEndTick, density, idn };

  const independentDirectives = new Map<number, BarDirective>();
  const independent = resolveUnisons(render({ ...shared, directives: independentDirectives, evidence: null, records: null }));

  const evidence = collectEvidence(input, plan, arc);
  const records: PianoAdaptationRecord[] = [];
  const directives = adaptDirectives(arc, evidence, profile, records, idn);
  const adapted = evidence.available
    ? resolveUnisons(render({ ...shared, directives, evidence, records }))
    : independent;

  return {
    events: adapted,
    diagnostics: buildDiagnostics(identity, density, theme, arc, independent, adapted, directives, evidence, records, profile, idn),
  };
}

export type { PianoHarmonicEvent };
