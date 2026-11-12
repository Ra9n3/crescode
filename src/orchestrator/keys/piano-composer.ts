/**
 * Phase 5: a deterministic, piano-specific composition planner.
 *
 * The Composer consumes the Phase 4A handoff and Phase 4B report. Production
 * `composeAllTracks` invokes it as part of Piano Engine V5 after all non-Piano
 * parts are finalized. `composePianoPlan` records phrase/harmony intentions;
 * `composePianoScore` makes the actual MIDI pitch, timing, duration, hand,
 * voice, and expressive-intent decisions before the Realizer converts them.
 */
import { PPQ } from '../../shared/schema/types';
import type { PianoAnalyzerReport, PianoInstrumentObservedFacts, PianoIntervalActivity } from './piano-analyzer';
import type { PianoEngineInput, PianoGenerationIdentity, PianoMomentKind, PianoTemplateRule } from './piano-engine';
import { composeTextureTheme, type PianoCompositionDiagnostics } from './piano-texture-theme';
import type { PianoCompositionMode } from './piano-composition-identity';
import { createPianoScore, type PianoScore, type PianoScoreEvent, type PianoScoreRest, type PianoScoreTarget, type PianoScoreVoiceId, type PianoMusicalRole, type PianoGestureIntent, type PianoTechniqueIntent } from './piano-score';

export type PianoPlanStatus = 'composed' | 'ineligible' | 'insufficient-harmony';
export type PianoIntensity = 0 | 1 | 2 | 3 | 4 | 5;
export type PianoDensity = 'very-sparse' | 'sparse' | 'moderate' | 'broad';
export type PianoRegisterZone = 'bass' | 'low-middle' | 'middle' | 'upper-middle' | 'high';
export type PianoTextureKind =
  | 'sparse-sustained'
  | 'broken-chords'
  | 'arpeggiated'
  | 'melody-accompaniment'
  | 'block-chords'
  | 'contrapuntal-dialogue'
  | 'short-flourishes';
export type PianoTexturePurpose =
  | 'preserve-space'
  | 'connect-harmony'
  | 'build-motion'
  | 'carry-melody'
  | 'mark-arrival'
  | 'exchange-voices'
  | 'punctuate-phrase';
export type PianoTextureTransition = 'establish' | 'continue' | 'thin' | 'unfold' | 'open' | 'answer' | 'release' | 'punctuate';

export type PianoTemplateIdentity =
  | 'chamber-counterpoint'
  | 'sonata-dialogue'
  | 'vocal-space'
  | 'cinematic-expanse'
  | 'hybrid-pulse-and-color'
  | 'adaptive-spacious';

export interface PianoComposerStyle {
  readonly identity: PianoTemplateIdentity;
  readonly approach: string;
  readonly leftHandRole: string;
  readonly rightHandRole: string;
  readonly leftHandRegister: PianoRegisterZone;
  readonly rightHandRegister: PianoRegisterZone;
  readonly preferredRightHandVoices: number;
  readonly extensionAppetite: 'restrained' | 'selective' | 'generous';
  readonly rhythmicCharacter: 'elastic' | 'speech-like' | 'unhurried' | 'broad' | 'syncopated';
}

export interface PianoEnergyTrajectoryPoint {
  readonly bar: number;
  /** Exact half-open source bar window; no meter reconstruction is used. */
  readonly startTick: number;
  readonly endTick: number;
  /** Position of this supplied bar's target within the phrase, from 0 to 1. */
  readonly position: number;
  readonly target: number;
  readonly nearSilence: boolean;
}

export interface PianoDynamicCurvePoint {
  /** Position within the phrase, from 0 to 1. */
  readonly position: number;
  /** Continuous 0–5 piano intensity; the Composer score writer maps it to MIDI velocity. */
  readonly intensity: number;
  /** Null only for a Composer-added expressive anchor, not a source bar. */
  readonly sourceBar: number | null;
  readonly sourceTarget: number | null;
}

export interface PianoDynamicSegment {
  /** Segment bounds in the parent phrase's normalized time. */
  readonly startPosition: number;
  readonly endPosition: number;
  readonly shape: 'suspended-breath' | 'rising-arc' | 'unwind' | 'held-arrival' | 'arch' | 'plateau';
  readonly entry: PianoIntensity;
  readonly peak: PianoIntensity;
  readonly exit: PianoIntensity;
  /** Peak position is phrase-relative, so adjacent segments share one clock. */
  readonly peakPosition: number;
  readonly turningPoint: 'peak' | 'valley' | null;
}

export interface PianoPhraseDynamics {
  readonly shape: 'suspended-breath' | 'rising-arc' | 'unwind' | 'held-arrival' | 'arch' | 'plateau';
  readonly entry: PianoIntensity;
  readonly peak: PianoIntensity;
  readonly exit: PianoIntensity;
  /** Position of the planned maximum, derived from the complete shared curve. */
  readonly peakPosition: number;
  /** Piecewise envelope derived from the supplied per-bar energy targets. */
  readonly intensityCurve: readonly PianoDynamicCurvePoint[];
  /** Dynamic-only subphrases; note-writing phrase boundaries stay independent. */
  readonly segments: readonly PianoDynamicSegment[];
  readonly emotionalColor: 'intimate' | 'yearning' | 'restless' | 'luminous' | 'resolute' | 'reflective';
  /** Exact supplied energy samples; no separate piano energy curve is invented. */
  readonly sourceEnergy: {
    readonly entryTarget: number | null;
    readonly exitTarget: number | null;
    readonly nearSilence: boolean;
    readonly descendingTowardEnd: boolean;
    readonly peakPosition: number;
    readonly trajectory: readonly PianoEnergyTrajectoryPoint[];
  };
}

export interface PianoTextureIntention {
  readonly kind: PianoTextureKind;
  readonly purpose: PianoTexturePurpose;
  readonly leftHandRole: string;
  readonly rightHandRole: string;
  readonly transitionFromPrevious: PianoTextureKind | null;
  readonly transition: PianoTextureTransition;
  readonly rationale: string;
  readonly evidence: readonly string[];
}

export interface PianoSectionIntention {
  readonly sectionId: string;
  readonly name: string;
  readonly index: number;
  readonly occurrence: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly function: 'opening' | 'continuation' | 'contrast' | 'reprise' | 'culmination' | 'closing';
  /** Dominant texture across the section's phrase-level development. */
  readonly texture: PianoTextureKind;
  readonly textureProgression: readonly {
    readonly phraseId: string;
    readonly kind: PianoTextureKind;
    readonly transitionFromPrevious: PianoTextureKind | null;
    readonly transition: PianoTextureTransition;
  }[];
  readonly textureChange: string;
  readonly phraseIds: readonly string[];
  readonly dynamics: PianoPhraseDynamics;
  readonly evidence: readonly string[];
}

export type PianoMotifOperation =
  | 'introduce'
  | 'sequence-in-new-harmony'
  | 'rhythmic-augmentation'
  | 'interval-expansion'
  | 'invert-and-reframe'
  | 'fragmented-recall'
  | 'withhold-under-lead'
  | 'fragment-to-landing';

export interface PianoPhraseIntention {
  readonly id: string;
  readonly sectionId: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly function: 'statement' | 'development' | 'contrast' | 'reprise' | 'arrival' | 'release' | 'statement-and-landing';
  readonly boundaryEvidence: readonly string[];
  readonly texture: PianoTextureIntention;
  readonly leftHandIntent: string;
  readonly rightHandIntent: string;
  readonly registerPlan: { readonly left: PianoRegisterZone; readonly right: PianoRegisterZone };
  readonly rhythmicIntent: string;
  readonly rhythmicPlan: {
    /** Underlying quarter-note pulse; displaced events remain related to this grid. */
    readonly pulseTicks: number;
    /** Straight subdivision grid used for actual motif and texture MIDI onsets. */
    readonly gridTicks?: number;
    /** Length of one motif cell; augmentation scales this to four source bars. */
    readonly cellTicks?: number;
    /** Phrase-level variation of the four motif inter-onset durations. */
    readonly weights: readonly number[];
    /** Composer-planned motif entries, relative to the phrase start. */
    readonly motifCells?: readonly {
      readonly startOffsetTicks: number;
      readonly positions: readonly (0 | 1 | 2 | 3)[];
      readonly variation: 'statement' | 'sequence' | 'reframe' | 'fragment' | 'cadence' | 'expansion' | 'augmentation';
    }[];
    readonly syncopation: null | {
      /** Motif position moved ahead of the pulse; its pitch still comes from the motif/harmony. */
      readonly displacedPosition: 1 | 2;
      readonly offsetTicks: -240 | -480;
      readonly resolvesAtPosition: 3 | null;
      readonly rationale: string;
    };
  };
  readonly intendedDensity: PianoDensity;
  readonly dynamics: PianoPhraseDynamics;
  readonly motif: {
    readonly motifId: string | null;
    readonly operation: PianoMotifOperation | 'unavailable';
    readonly rationale: string;
  };
}

export interface PianoMotifTone {
  readonly position: number;
  readonly pitchClass: number;
  readonly function: 'guide-tone' | 'chord-tone' | 'chromatic-neighbor' | 'resolution';
}

export interface PianoMotifPlan {
  readonly id: string;
  readonly originChordId: string;
  readonly originChordSymbol: string;
  readonly anchorPitchClass: number;
  /** Relative semitone contour, not absolute MIDI pitches or note events. */
  readonly intervalContour: readonly number[];
  /** Relative durations summing to 1 for phrase-level note scheduling by the score writer. */
  readonly rhythmicWeights: readonly number[];
  readonly tones: readonly PianoMotifTone[];
  readonly tensionResolution:
    | {
        readonly kind: 'chromatic-neighbor';
        readonly position: number;
        readonly resolvesAt: number;
        readonly semitonesToResolution: number;
      }
    | {
        readonly kind: 'unavailable';
        readonly reason: string;
      };
  readonly developmentPalette: readonly PianoMotifOperation[];
  readonly identityRationale: string;
}

export interface PianoVoiceLeadingIntent {
  readonly fromChordId: string | null;
  readonly commonPitchClasses: readonly number[];
  readonly totalSemitoneMotion: number | null;
  readonly bassSemitoneMotion: number | null;
  readonly strategy: 'opening-voicing' | 'retain-common-tones' | 'stepwise-revoicing' | 'intentional-reframe';
}

export interface PianoSuspensionIntent {
  readonly kind: 'prepared-stepwise-suspension';
  readonly preparedByChordId: string;
  readonly tensionPitchClass: number;
  readonly resolvesToPitchClass: number;
  readonly resolutionDistanceSemitones: number;
  readonly evidence: string;
}

/**
 * Register occupancy observed by Analyzer for a score-planning window. These
 * counts describe overlapping note events, not source loudness, lead roles,
 * counterpoint, or exact simultaneous polyphony. Missing context stays null.
 */
export interface PianoAccompanimentActivityEvidence {
  readonly availability: 'available' | 'partial' | 'unavailable';
  readonly source: 'source-bar-overlap' | 'resolved-chord-overlap';
  readonly activeTrackIds: readonly string[];
  /** Active notes in a bass role or in the Piano's low register. */
  readonly bassFoundationTrackIds: readonly string[];
  /** Non-bass tracks with written activity in the Piano mid/upper registers. */
  readonly midUpperActivityTrackIds: readonly string[];
  /** Mean overlapping-note counts per intersecting source bar. */
  readonly activeNotesPerBar: {
    readonly pianoBass: number | null;
    readonly pianoSupport: number | null;
    readonly pianoInner: number | null;
    readonly pianoUpper: number | null;
    readonly total: number | null;
  };
}

export interface PianoHarmonicEvent {
  readonly chord: {
    readonly id: string;
    readonly symbol: string;
    readonly startTick: number;
    readonly endTick: number;
    readonly rootPitchClass: number;
    readonly availablePitchClasses: readonly number[];
    readonly quality: string;
  };
  readonly sectionIds: readonly string[];
  readonly phraseId: string | null;
  readonly structuralRole: 'continuity' | 'color-turn' | 'arrival' | 'release';
  readonly voicing: {
    /** Symbolic pitch classes only; no MIDI register or note placement. */
    readonly leftHandBassPitchClass: number;
    readonly inversion: 'root' | 'third' | 'fifth' | 'seventh' | 'other-chord-tone' | 'slash-bass';
    readonly rightHandPitchClasses: readonly number[];
    readonly selectedExtensionPitchClasses: readonly number[];
    readonly omittedChordPitchClasses: readonly number[];
    readonly treatment: 'guide-tone-shell' | 'open-triad' | 'extension-color' | 'suspended-chord' | 'slash-bass-voicing';
  };
  readonly voiceLeading: PianoVoiceLeadingIntent;
  readonly suspension: PianoSuspensionIntent | null;
  readonly hands: {
    readonly left: {
      readonly role: string;
      readonly register: PianoRegisterZone;
      readonly motion: 'change-with-harmony' | 'hold-common-tone' | 'sparse-approach' | 'yield';
    };
    readonly right: {
      readonly role: string;
      readonly register: PianoRegisterZone;
      readonly density: PianoDensity;
      readonly motion: 'motif-led' | 'inner-voice' | 'open-hold' | 'fragment' | 'yield';
    };
  };
  readonly orchestration: {
    /** Written activity only; never an audibility assertion. */
    readonly activeTrackIds: readonly string[];
    /** Source roles help the Composer avoid duplicating a busy low foundation. */
    readonly activeRoles?: readonly string[];
    readonly explicitLeadTrackIds: readonly string[];
    readonly momentKinds: readonly PianoMomentKind[];
    readonly interaction: 'interweave' | 'support-moment' | 'yield-to-spotlight' | 'leave-space' | 'unavailable';
    readonly analyzerEvidence: 'available' | 'partial' | 'unavailable';
    /** Directly observed written-register occupancy; null/unknown is never treated as empty. */
    readonly registerOccupancy?: {
      readonly low: number;
      readonly middle: number;
      readonly high: number;
      readonly total: number;
      readonly availability: 'available' | 'unavailable';
    };
    /** Analyzer activity for this chord span; never used to infer an orchestral lead. */
    readonly accompanimentActivity?: PianoAccompanimentActivityEvidence;
  };
  readonly dynamicIntent: {
    readonly intensity: PianoIntensity;
    readonly gesture: PianoPhraseDynamics['shape'];
    readonly sourceEnergyTarget: number | null;
    readonly sourceEnergyNearSilence: boolean;
  };
}

export interface PianoFillDecision {
  readonly target: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly sectionId: string | null;
  readonly decision: 'consider-brief-gesture' | 'leave-space' | 'keys-family-only' | 'activity-evidence-unavailable';
  readonly observedWrittenActivity: {
    readonly availability: 'available' | 'unavailable';
    readonly activeTrackIds: readonly string[];
    readonly onsetCount: number;
  };
  readonly rationale: string;
  readonly mandatory: false;
}

export interface PianoAttackRestriction {
  readonly bar: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly reason: 'near-silence-zero-energy';
  readonly rationale: string;
}

export interface PianoStructuralEvent {
  readonly kind: 'section-entry' | 'section-transition' | 'section-release' | 'conductor-emphasis' | 'release-after-near-silence' | 'final-landing';
  readonly startTick: number;
  readonly endTick: number;
  readonly sectionId: string | null;
  readonly momentKind?: PianoMomentKind;
  readonly chordId?: string;
  readonly intention: string;
  readonly evidence: string;
}

export interface PianoComposerPlan {
  readonly version: 2;
  readonly status: PianoPlanStatus;
  readonly generationIdentity: PianoGenerationIdentity;
  readonly seed: number;
  readonly template: {
    readonly id: string | null;
    readonly eligible: boolean;
    readonly style: PianoComposerStyle;
  };
  readonly templateConstraints: {
    readonly octaveDoubling: 'forbidden' | 'climaxOnly' | 'allowed' | 'not-specified';
    readonly pianoFillGatingRules: readonly Extract<PianoTemplateRule, { type: 'fillGating' }>[];
    readonly fillSource: 'explicit-conductor-windows-only';
  };
  readonly sectionIntentions: readonly PianoSectionIntention[];
  readonly phrases: readonly PianoPhraseIntention[];
  readonly motif: PianoMotifPlan | null;
  readonly harmonicEvents: readonly PianoHarmonicEvent[];
  readonly fillDecisions: readonly PianoFillDecision[];
  /** Exact supplied bar windows where zero-energy near-silence suppresses new attacks. */
  readonly attackRestrictions: readonly PianoAttackRestriction[];
  readonly structuralEvents: readonly PianoStructuralEvent[];
  readonly ending: {
    readonly availability: 'available' | 'unavailable';
    readonly tick: number | null;
    readonly chordId: string | null;
    readonly intention: 'settle-on-supplied-harmony' | 'leave-color-open' | 'unavailable';
    readonly cadenceInference: false;
    readonly reason: string;
  };
  readonly limitations: readonly string[];
  readonly containsMidiNotes: false;
}

interface StyleProfile {
  readonly public: PianoComposerStyle;
  readonly voicingVoices: number;
  readonly extensionBias: number;
  readonly rootPositionPenalty: number;
  readonly responseBias: number;
  readonly suspensionBias: number;
  readonly motifMotion: 'compact' | 'lyrical' | 'wide' | 'angular';
  readonly densityBias: number;
}

interface SectionWindow {
  readonly id: string;
  readonly name: string;
  readonly index: number;
  readonly occurrence: number;
  readonly startBar: number;
  readonly lengthBars: number;
  readonly startTick: number;
  readonly endTick: number;
}

interface PhraseBoundary {
  readonly tick: number;
  readonly reasons: readonly string[];
}

interface PhraseWindow {
  readonly id: string;
  readonly section: SectionWindow;
  readonly startTick: number;
  readonly endTick: number;
  readonly function: PianoPhraseIntention['function'];
  readonly firstInSection: boolean;
  readonly lastInSection: boolean;
  readonly startReasons: readonly string[];
  readonly endReasons: readonly string[];
}

interface ChordMaterial {
  readonly chordId: string;
  readonly symbol: string;
  readonly root: number;
  readonly tones: readonly number[];
  readonly intervals: readonly number[];
  readonly guides: readonly number[];
  readonly extensions: readonly number[];
  readonly slashBass: number | null;
  readonly quality: string;
}

interface OrchestrationReading {
  readonly activeTrackIds: readonly string[];
  readonly activeRoles: readonly string[];
  readonly explicitLeadTrackIds: readonly string[];
  readonly moments: readonly PianoEngineInput['context']['moments'][number][];
  readonly inPianoFill: boolean;
  readonly accompanimentActivity: PianoAccompanimentActivityEvidence;
  readonly registerOccupancy: {
    /** Mean written note-onset count per supplied bar, from source octaves. */
    readonly low: number;
    readonly middle: number;
    readonly high: number;
    readonly total: number;
    readonly availability: 'available' | 'unavailable';
  };
  readonly evidence: 'available' | 'partial' | 'unavailable';
  readonly interaction: PianoHarmonicEvent['orchestration']['interaction'];
}

const PROFILES: Readonly<Record<string, Omit<StyleProfile, 'public'>>> = Object.freeze({
  'ensemble.chamber': {
    voicingVoices: 3, extensionBias: 0.25, rootPositionPenalty: 1.2, responseBias: 0.48, suspensionBias: 0.30, motifMotion: 'compact', densityBias: -0.4,
  },
  'ensemble.sonata': {
    voicingVoices: 3, extensionBias: 0.35, rootPositionPenalty: 0.75, responseBias: 0.72, suspensionBias: 0.34, motifMotion: 'lyrical', densityBias: 0.1,
  },
  'ensemble.vocalbacking': {
    voicingVoices: 2, extensionBias: 0.12, rootPositionPenalty: 0.75, responseBias: 0.12, suspensionBias: 0.18, motifMotion: 'compact', densityBias: -0.8,
  },
  'ensemble.cinematic': {
    voicingVoices: 4, extensionBias: 0.82, rootPositionPenalty: 0.35, responseBias: 0.42, suspensionBias: 0.40, motifMotion: 'wide', densityBias: 0.25,
  },
  'ensemble.hybridstudio': {
    voicingVoices: 3, extensionBias: 0.55, rootPositionPenalty: 0.65, responseBias: 0.48, suspensionBias: 0.24, motifMotion: 'angular', densityBias: 0.15,
  },
});

const STYLE_TEXT: Readonly<Record<string, PianoComposerStyle>> = Object.freeze({
  'ensemble.chamber': {
    identity: 'chamber-counterpoint',
    approach: 'Intimate counterpoint: preserve inner-voice motion, let the ensemble lead breathe, and prefer economical guide-tone voicings.',
    leftHandRole: 'independent low counterline or a lightly held chord-tone anchor',
    rightHandRole: 'inner-voice motif with restrained color',
    leftHandRegister: 'bass',
    rightHandRegister: 'middle',
    preferredRightHandVoices: 3,
    extensionAppetite: 'restrained',
    rhythmicCharacter: 'elastic',
  },
  'ensemble.sonata': {
    identity: 'sonata-dialogue',
    approach: 'Soloistic dialogue: develop a cantabile subject, let the bass answer it, and make phrase contrasts audible without default octave doubling.',
    leftHandRole: 'responsive bass gesture that answers the right-hand line',
    rightHandRole: 'cantabile motif and changing chord-tone color',
    leftHandRegister: 'low-middle',
    rightHandRegister: 'upper-middle',
    preferredRightHandVoices: 3,
    extensionAppetite: 'selective',
    rhythmicCharacter: 'speech-like',
  },
  'ensemble.vocalbacking': {
    identity: 'vocal-space',
    approach: 'Supportive and restrained: keep the upper texture unassertive, use compact guide-tone shells, and leave broad melodic space.',
    leftHandRole: 'soft low anchor, often root-light',
    rightHandRole: 'supporting shell or a quiet motif fragment',
    leftHandRegister: 'low-middle',
    rightHandRegister: 'middle',
    preferredRightHandVoices: 2,
    extensionAppetite: 'restrained',
    rhythmicCharacter: 'unhurried',
  },
  'ensemble.cinematic': {
    identity: 'cinematic-expanse',
    approach: 'Wide-register arc: open the harmony with available extensions, reserve broad voicings for arrivals, and otherwise keep the texture breathing.',
    leftHandRole: 'wide bass foundation with occasional held common tone',
    rightHandRole: 'open color voicing or a rising motif fragment',
    leftHandRegister: 'bass',
    rightHandRegister: 'high',
    preferredRightHandVoices: 4,
    extensionAppetite: 'generous',
    rhythmicCharacter: 'broad',
  },
  'ensemble.hybridstudio': {
    identity: 'hybrid-pulse-and-color',
    approach: 'Pulse-and-color: create an adaptable rhythmic cell around the harmony, with selective syncopation and a bass role that avoids locking into every chord root.',
    leftHandRole: 'elastic pulse anchor or held non-root chord tone',
    rightHandRole: 'syncopated motif fragments with selective color',
    leftHandRegister: 'low-middle',
    rightHandRegister: 'upper-middle',
    preferredRightHandVoices: 3,
    extensionAppetite: 'selective',
    rhythmicCharacter: 'syncopated',
  },
});

function profileFor(input: PianoEngineInput): StyleProfile {
  const id = input.context.template.id ?? '';
  const publicStyle = STYLE_TEXT[id] ?? {
    identity: 'adaptive-spacious' as const,
    approach: 'Adaptive, spacious writing: follow the resolved harmony and supplied structure, favoring coherent voice leading over default accompaniment.',
    leftHandRole: 'sparse chord-tone foundation',
    rightHandRole: 'motif-led voicing with room for the ensemble',
    leftHandRegister: 'low-middle' as const,
    rightHandRegister: 'upper-middle' as const,
    preferredRightHandVoices: 3,
    extensionAppetite: 'selective' as const,
    rhythmicCharacter: 'elastic' as const,
  };
  return {
    public: publicStyle,
    ...(PROFILES[id] ?? {
      voicingVoices: 3, extensionBias: 0.35, rootPositionPenalty: 0.7, responseBias: 0.35, suspensionBias: 0.25, motifMotion: 'lyrical' as const, densityBias: -0.1,
    }),
  };
}

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

const pc = (value: number): number => ((value % 12) + 12) % 12;
const pcDistance = (a: number, b: number): number => {
  const d = Math.abs(pc(a) - pc(b));
  return Math.min(d, 12 - d);
};
const signedPcMotion = (from: number, to: number): number => {
  const up = (pc(to) - pc(from) + 12) % 12;
  return up <= 6 ? up : up - 12;
};
const intersects = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => aStart < bEnd && aEnd > bStart;
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

function sectionWindows(input: PianoEngineInput): SectionWindow[] {
  if (input.context.sections.length) {
    return [...input.context.sections]
      .sort((a, b) => a.index - b.index)
      .map((section) => ({
        id: section.id,
        name: section.name,
        index: section.index,
        occurrence: section.occurrence,
        startBar: section.startBar,
        lengthBars: section.lengthBars,
        startTick: section.startTick,
        endTick: section.endTick,
      }));
  }
  const grouped = new Map<string, { name: string; bars: PianoEngineInput['context']['barWindows'][number][] }>();
  for (const bar of input.context.barWindows) {
    const group = grouped.get(bar.sectionId) ?? { name: bar.sectionName, bars: [] };
    group.bars.push(bar);
    grouped.set(bar.sectionId, group);
  }
  const occurrences = new Map<string, number>();
  return [...grouped.entries()].map(([id, group], index) => {
    const bars = [...group.bars].sort((a, b) => a.bar - b.bar);
    const key = group.name.trim().toLowerCase();
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    return {
      id,
      name: group.name,
      index,
      occurrence,
      startBar: bars[0]?.bar ?? 0,
      lengthBars: bars.length,
      startTick: bars[0]?.startTick ?? 0,
      endTick: bars[bars.length - 1]?.endTick ?? 0,
    };
  });
}

function phraseBoundaries(input: PianoEngineInput, section: SectionWindow): PhraseBoundary[] {
  const reasons = new Map<number, Set<string>>();
  const add = (tick: number, reason: string) => {
    if (tick < section.startTick || tick > section.endTick) return;
    const current = reasons.get(tick) ?? new Set<string>();
    current.add(reason);
    reasons.set(tick, current);
  };
  add(section.startTick, 'section-entry');
  add(section.endTick, 'section-release');
  if (section.occurrence > 1) add(section.startTick, `section-reprise:${section.name}:occurrence-${section.occurrence}`);

  for (const moment of input.context.moments) {
    if (!intersects(moment.startTick, moment.endTick, section.startTick, section.endTick)) continue;
    if (moment.startTick > section.startTick && moment.startTick < section.endTick) add(moment.startTick, `moment:${moment.kind}:start`);
    if (moment.endTick > section.startTick && moment.endTick < section.endTick) add(moment.endTick, `moment:${moment.kind}:end`);
  }
  for (const fill of input.context.fillWindows) {
    if (!intersects(fill.startTick, fill.endTick, section.startTick, section.endTick)) continue;
    if (fill.startTick > section.startTick && fill.startTick < section.endTick) add(fill.startTick, 'explicit-fill-window:start');
    if (fill.endTick > section.startTick && fill.endTick < section.endTick) add(fill.endTick, 'explicit-fill-window:end');
  }

  // Use source bar windows and the already-computed arc values; a local turn
  // is a phrase cue, not a replacement energy analysis or a fixed bar grid.
  const bars = input.context.barWindows
    .filter((bar) => bar.sectionId === section.id && bar.startTick >= section.startTick && bar.endTick <= section.endTick)
    .sort((a, b) => a.bar - b.bar);
  const energyAt = new Map(input.context.energy.map((entry) => [entry.bar, entry]));
  for (const bar of bars) {
    if (!energyAt.get(bar.bar)?.nearSilence) continue;
    if (bar.startTick > section.startTick && bar.startTick < section.endTick) {
      add(bar.startTick, 'energy-near-silence:start');
    }
    if (bar.endTick > section.startTick && bar.endTick < section.endTick) {
      add(bar.endTick, 'energy-near-silence:end');
    }
  }
  for (let i = 1; i < bars.length - 1; i++) {
    const previous = energyAt.get(bars[i - 1].bar)?.target;
    const current = energyAt.get(bars[i].bar)?.target;
    const next = energyAt.get(bars[i + 1].bar)?.target;
    if (previous === undefined || current === undefined || next === undefined) continue;
    const before = current - previous;
    const after = next - current;
    if (Math.abs(before) >= 0.08 && Math.abs(after) >= 0.08 && Math.sign(before) !== Math.sign(after)) {
      add(bars[i].endTick, 'existing-energy-arc-turn');
    }
  }

  return [...reasons.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tick, why]) => ({ tick, reasons: [...why].sort() }));
}

function phraseWindows(input: PianoEngineInput, sections: readonly SectionWindow[]): PhraseWindow[] {
  const result: PhraseWindow[] = [];
  for (const section of sections) {
    const boundaries = phraseBoundaries(input, section);
    for (let i = 0; i + 1 < boundaries.length; i++) {
      const start = boundaries[i];
      const end = boundaries[i + 1];
      if (end.tick <= start.tick) continue;
      const phrase = {
        id: `${section.id}:phrase-${result.filter((p) => p.section.id === section.id).length + 1}`,
        section,
        startTick: start.tick,
        endTick: end.tick,
        firstInSection: i === 0,
        lastInSection: i === boundaries.length - 2,
        startReasons: start.reasons,
        endReasons: end.reasons,
      };
      const hasMoment = input.context.moments.some((moment) =>
        intersects(moment.startTick, moment.endTick, start.tick, end.tick));
      result.push({
        ...phrase,
        function: phraseFunction(phrase, sections.length, hasMoment,
          section.index === sections.length - 1, section.occurrence > 1),
      });
    }
  }
  return result;
}

function sectionIdsFor(input: PianoEngineInput, startTick: number, endTick: number): string[] {
  const idsFromBars = input.context.barWindows
    .filter((bar) => intersects(bar.startTick, bar.endTick, startTick, endTick))
    .map((bar) => bar.sectionId);
  if (idsFromBars.length) return unique(idsFromBars);
  return input.context.sections
    .filter((section) => intersects(section.startTick, section.endTick, startTick, endTick))
    .map((section) => section.id);
}

function sectionForTick(sections: readonly SectionWindow[], tick: number): SectionWindow | null {
  return sections.find((section) => tick >= section.startTick && tick < section.endTick) ?? null;
}

function phraseForEvent(phrases: readonly PhraseWindow[], tick: number): PhraseWindow | null {
  return phrases.find((phrase) => tick >= phrase.startTick && tick < phrase.endTick) ?? null;
}

function materialOf(chord: PianoEngineInput['context']['harmony'][number]): ChordMaterial {
  const parsed = chord.parsed;
  const root = pc(parsed.root);
  const tones = unique(parsed.pitchClasses.map(pc));
  const intervals = unique(parsed.intervals);
  const guides = unique(intervals
    .filter((interval) => [3, 4, 10, 11].includes(pc(interval)))
    .map((interval) => pc(root + interval)));
  const suspensionTones = intervals
    .filter((interval) => [2, 5].includes(pc(interval)))
    .map((interval) => pc(root + interval));
  const selectedGuides = guides.length ? guides : suspensionTones.slice(0, 1);
  const extensions = unique(intervals
    .filter((interval) => interval >= 12)
    .map((interval) => pc(root + interval))
    .filter((pitchClass) => pitchClass !== root));
  return {
    chordId: chord.id,
    symbol: chord.symbol,
    root,
    tones: tones.length ? tones : [root],
    intervals,
    guides: selectedGuides,
    extensions,
    slashBass: parsed.bass === null ? null : pc(parsed.bass),
    quality: parsed.quality,
  };
}

function availableBassTones(material: ChordMaterial): number[] {
  if (material.slashBass !== null) return [material.slashBass];
  const structural = material.intervals
    .filter((interval) => interval < 12 && [0, 3, 4, 5, 7, 10, 11].includes(interval))
    .map((interval) => pc(material.root + interval));
  const options = unique(structural.length ? structural : material.tones);
  return options.length ? options : [material.root];
}

function bassScore(
  candidate: number,
  material: ChordMaterial,
  previousBass: number | null,
  phrase: PhraseWindow | null,
  profile: StyleProfile,
  seed: number,
  phraseEntry: boolean,
): number {
  const landing = phrase?.function === 'arrival' || phrase?.function === 'statement-and-landing';
  const rootPenalty = candidate === material.root
    ? landing || phraseEntry ? -0.8 : profile.rootPositionPenalty * 0.5
    : 0;
  const movement = previousBass === null ? 0 : pcDistance(previousBass, candidate) * 0.65;
  const repeatedBass = previousBass === candidate
    ? candidate === material.root ? 0.25 : 0.55
    : 0;
  return rootPenalty + movement + repeatedBass + unitRandom(seed, `bass:${material.chordId}:${candidate}`) * 0.15;
}

function selectBass(
  material: ChordMaterial,
  previousBass: number | null,
  phrase: PhraseWindow | null,
  profile: StyleProfile,
  seed: number,
  phraseEntry: boolean,
): number {
  return [...availableBassTones(material)].sort((a, b) =>
    bassScore(a, material, previousBass, phrase, profile, seed, phraseEntry)
      - bassScore(b, material, previousBass, phrase, profile, seed, phraseEntry))[0];
}

function combinations(items: readonly number[], size: number): number[][] {
  if (size <= 0) return [[]];
  if (items.length < size) return [items.slice()];
  const result: number[][] = [];
  const visit = (start: number, selected: number[]) => {
    if (selected.length === size) { result.push([...selected]); return; }
    for (let i = start; i <= items.length - (size - selected.length); i++) {
      selected.push(items[i]);
      visit(i + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return result;
}

function minimumVoiceMotion(from: readonly number[], to: readonly number[]): number {
  if (!from.length || !to.length) return 0;
  const smaller = from.length <= to.length ? from : to;
  const larger = from.length <= to.length ? to : from;
  let best = Number.POSITIVE_INFINITY;
  const assign = (index: number, used: Set<number>, cost: number) => {
    if (index >= smaller.length) { best = Math.min(best, cost); return; }
    for (let i = 0; i < larger.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      assign(index + 1, used, cost + pcDistance(smaller[index], larger[i]));
      used.delete(i);
    }
  };
  assign(0, new Set(), 0);
  return best + Math.abs(from.length - to.length) * 1.5;
}

function voicingScore(
  candidate: readonly number[],
  material: ChordMaterial,
  requiredGuides: readonly number[],
  previous: readonly number[],
  profile: StyleProfile,
  seed: number,
): number {
  const common = candidate.filter((tone) => previous.includes(tone)).length;
  const missingGuides = requiredGuides.filter((tone) => !candidate.includes(tone)).length;
  const color = candidate.filter((tone) => material.extensions.includes(tone)).length;
  const motion = minimumVoiceMotion(previous, candidate);
  const tag = [...candidate].sort((a, b) => a - b).join(',');
  return motion * 1.15 - common * 1.25 + missingGuides * 4.5
    - color * profile.extensionBias * 1.4
    + Math.abs(candidate.length - profile.public.preferredRightHandVoices) * 0.25
    + unitRandom(seed, `voicing:${material.chordId}:${tag}`) * 0.12;
}

function selectRightHand(
  material: ChordMaterial,
  bass: number,
  previous: readonly number[],
  profile: StyleProfile,
  desiredVoices: number,
  seed: number,
): number[] {
  let upper = material.tones.filter((tone) => tone !== bass);
  if (upper.length < 2) upper = unique([...upper, ...material.tones]);
  const available = unique(upper);
  const size = Math.max(1, Math.min(desiredVoices, available.length));
  const required = material.guides.filter((tone) => available.includes(tone));
  const candidates = combinations(available, size);
  candidates.sort((a, b) =>
    voicingScore(a, material, required, previous, profile, seed)
      - voicingScore(b, material, required, previous, profile, seed));
  return candidates[0] ?? available.slice(0, size);
}

function inversionFor(material: ChordMaterial, bass: number): PianoHarmonicEvent['voicing']['inversion'] {
  if (material.slashBass !== null) return 'slash-bass';
  const intervals = material.intervals.filter((interval) => interval < 12);
  if (bass === material.root) return 'root';
  for (const interval of intervals) {
    if (pc(material.root + interval) !== bass) continue;
    if (interval === 3 || interval === 4) return 'third';
    if (interval === 7) return 'fifth';
    if (interval === 10 || interval === 11) return 'seventh';
  }
  return 'other-chord-tone';
}

function rightHandMotion(previous: readonly number[], current: readonly number[]): PianoVoiceLeadingIntent['strategy'] {
  if (!previous.length) return 'opening-voicing';
  if (current.some((tone) => previous.includes(tone))) return 'retain-common-tones';
  return minimumVoiceMotion(previous, current) <= 5 ? 'stepwise-revoicing' : 'intentional-reframe';
}

function desiredVoices(
  profile: StyleProfile,
  reading: OrchestrationReading,
  phrase: PhraseWindow | null,
  hasArrival: boolean,
): number {
  let count = profile.voicingVoices;
  if (reading.explicitLeadTrackIds.length) count -= 1;
  if (reading.activeTrackIds.length >= 5) count -= 1;
  if (hasArrival && reading.activeTrackIds.length < 3) count += 1;
  if (phrase?.function === 'release' || phrase?.function === 'contrast') count -= 1;
  return Math.max(2, Math.min(4, count));
}

function composerVisible(instrument: PianoInstrumentObservedFacts): boolean {
  // Synthetic/legacy snapshots omit mixer state; retain their written evidence.
  return instrument.compositionState?.composerVisible !== false;
}

const PIANO_BASS_FOUNDATION_ROLES = new Set(['cellosBasses', 'basses', 'tuba', 'trombones', 'bassoons']);

function activePitchCount(activity: PianoIntervalActivity, low: number, high: number): number {
  return activity.activePitchDistribution.reduce((sum, item) =>
    item.pitch >= low && item.pitch <= high ? sum + item.noteCount : sum, 0);
}

interface PianoActivitySlice {
  readonly bar: number;
  readonly activity: PianoIntervalActivity;
}

interface PianoActivityCounts {
  pianoBass: number;
  pianoSupport: number;
  pianoInner: number;
  pianoUpper: number;
  total: number;
}

function summarizeAccompanimentActivity(
  instruments: readonly PianoInstrumentObservedFacts[],
  slicesByTrack: ReadonlyMap<string, readonly PianoActivitySlice[]>,
  availability: PianoAccompanimentActivityEvidence['availability'],
  source: PianoAccompanimentActivityEvidence['source'],
): PianoAccompanimentActivityEvidence {
  const barIds = [...new Set([...slicesByTrack.values()].flatMap((slices) => slices.map((slice) => slice.bar)))];
  const byBar = new Map<number, PianoActivityCounts>();
  const activeTrackIds: string[] = [];
  const bassFoundationTrackIds: string[] = [];
  const midUpperActivityTrackIds: string[] = [];

  for (const instrument of instruments) {
    const slices = slicesByTrack.get(instrument.instrument.id) ?? [];
    let active = false;
    let bassFoundation = false;
    let midUpperActivity = false;
    for (const slice of slices) {
      const activity = slice.activity;
      const counts = byBar.get(slice.bar) ?? { pianoBass: 0, pianoSupport: 0, pianoInner: 0, pianoUpper: 0, total: 0 };
      counts.pianoBass += activePitchCount(activity, 29, 55);
      counts.pianoSupport += activePitchCount(activity, 40, 67);
      counts.pianoInner += activePitchCount(activity, 50, 76);
      counts.pianoUpper += activePitchCount(activity, 60, 101);
      counts.total += activity.activeNoteCount;
      byBar.set(slice.bar, counts);

      if (activity.activeNoteCount > 0) active = true;
      if (activity.activeNoteCount > 0 && (PIANO_BASS_FOUNDATION_ROLES.has(instrument.instrument.role)
        || activePitchCount(activity, 29, 55) > 0)) bassFoundation = true;
      if (activePitchCount(activity, 50, 101) > 0
        && !PIANO_BASS_FOUNDATION_ROLES.has(instrument.instrument.role)) midUpperActivity = true;
    }
    if (active) activeTrackIds.push(instrument.instrument.id);
    if (bassFoundation) bassFoundationTrackIds.push(instrument.instrument.id);
    if (midUpperActivity) midUpperActivityTrackIds.push(instrument.instrument.id);
  }

  const average = (key: keyof PianoActivityCounts): number | null => {
    if (!barIds.length) return null;
    const total = barIds.reduce((sum, bar) => sum + (byBar.get(bar)?.[key] ?? 0), 0);
    return total / barIds.length;
  };
  return {
    availability: barIds.length ? availability : availability === 'unavailable' ? 'unavailable' : 'partial',
    source,
    activeTrackIds,
    bassFoundationTrackIds,
    midUpperActivityTrackIds,
    activeNotesPerBar: {
      pianoBass: average('pianoBass'),
      pianoSupport: average('pianoSupport'),
      pianoInner: average('pianoInner'),
      pianoUpper: average('pianoUpper'),
      total: average('total'),
    },
  };
}

function accompanimentActivityFromBars(
  analyzer: PianoAnalyzerReport,
  instruments: readonly PianoInstrumentObservedFacts[],
  barIds: ReadonlySet<number>,
): PianoAccompanimentActivityEvidence {
  const slicesByTrack = new Map(instruments.map((instrument) => [
    instrument.instrument.id,
    instrument.byBar.filter((bar) => barIds.has(bar.bar)).map((bar) => ({ bar: bar.bar, activity: bar })),
  ]));
  const requestedBars = [...barIds];
  const availability = barIds.size > 0 && instruments.length > 0
    && analyzer.observedFacts.barAssignmentAvailability === 'available'
    && instruments.every((instrument) => requestedBars.every((barId) =>
      instrument.byBar.some((bar) => bar.bar === barId)))
    ? 'available' as const
    : barIds.size === 0 ? 'unavailable' as const : 'partial' as const;
  return summarizeAccompanimentActivity(instruments, slicesByTrack, availability, 'source-bar-overlap');
}

function accompanimentActivityForChord(
  analyzer: PianoAnalyzerReport,
  chordId: string,
): PianoAccompanimentActivityEvidence {
  const instruments = analyzer.observedFacts.instruments.filter(composerVisible);
  const slicesByTrack = new Map<string, PianoActivitySlice[]>();
  let allFactsAvailable = analyzer.existingContextFacts.harmony.availability === 'available' && instruments.length > 0;
  for (const instrument of instruments) {
    const relationships = instrument.relationships.harmony;
    const span = relationships.spans.find((candidate) => candidate.chord.id === chordId);
    if (relationships.availability !== 'available' || !span || !span.byBar.length) {
      allFactsAvailable = false;
      slicesByTrack.set(instrument.instrument.id, []);
      continue;
    }
    slicesByTrack.set(instrument.instrument.id, span.byBar.map((item) => ({
      bar: item.bar,
      activity: item.activity,
    })));
  }
  const availability = instruments.length === 0
    ? 'partial' as const
    : allFactsAvailable ? 'available' as const : 'unavailable' as const;
  return summarizeAccompanimentActivity(instruments, slicesByTrack, availability, 'resolved-chord-overlap');
}

function orchestrationReading(
  input: PianoEngineInput,
  analyzer: PianoAnalyzerReport,
  startTick: number,
  endTick: number,
): OrchestrationReading {
  const bars = input.context.barWindows.filter((bar) => intersects(bar.startTick, bar.endTick, startTick, endTick));
  const barIds = new Set(bars.map((bar) => bar.bar));
  const visibleInstruments = analyzer.observedFacts.instruments.filter(composerVisible);
  const accompanimentActivity = accompanimentActivityFromBars(analyzer, visibleInstruments, barIds);
  const active = visibleInstruments.filter((instrument) =>
    accompanimentActivity.activeTrackIds.includes(instrument.instrument.id));
  const activeTrackIds = active.map((instrument) => instrument.instrument.id);
  const activeRoles = active.map((instrument) => instrument.instrument.role);
  const registerCounts = { low: 0, middle: 0, high: 0 };
  for (const instrument of visibleInstruments) {
    for (const bar of instrument.byBar) {
      if (!barIds.has(bar.bar)) continue;
      for (const register of bar.registerDistribution) {
        if (register.midiOctave <= 2) registerCounts.low += register.noteCount;
        else if (register.midiOctave <= 4) registerCounts.middle += register.noteCount;
        else registerCounts.high += register.noteCount;
      }
    }
  }
  const occupancyBars = Math.max(1, barIds.size);
  const registerOccupancy = {
    low: registerCounts.low / occupancyBars,
    middle: registerCounts.middle / occupancyBars,
    high: registerCounts.high / occupancyBars,
    total: (registerCounts.low + registerCounts.middle + registerCounts.high) / occupancyBars,
    availability: bars.length > 0 && visibleInstruments.length > 0
      && analyzer.observedFacts.barAssignmentAvailability === 'available'
      ? 'available' as const : 'unavailable' as const,
  };
  const lead = analyzer.interpretations.leadPassages.candidates
    .filter((candidate) => intersects(candidate.startTick, candidate.endTick, startTick, endTick))
    .map((candidate) => candidate.instrument.id);
  const moments = input.context.moments.filter((moment) => intersects(moment.startTick, moment.endTick, startTick, endTick));
  const inPianoFill = input.context.fillWindows.some((window) =>
    window.target.toLowerCase() === 'piano' && intersects(window.startTick, window.endTick, startTick, endTick));
  const evidence: OrchestrationReading['evidence'] = bars.length === 0
    ? 'unavailable'
    : analyzer.observedFacts.barAssignmentAvailability === 'available'
      && visibleInstruments.length > 0 ? 'available' : 'partial';
  const reading = {
    activeTrackIds,
    activeRoles,
    explicitLeadTrackIds: unique(lead),
    moments,
    inPianoFill,
    registerOccupancy,
    accompanimentActivity,
    evidence,
  };
  return { ...reading, interaction: momentDecision(reading) };
}
function chordActivityIds(
  analyzer: PianoAnalyzerReport,
  chordId: string,
): string[] {
  return analyzer.observedFacts.instruments
    .filter(composerVisible)
    .filter((instrument) => instrument.relationships.harmony.spans
      .some((span) => span.chord.id === chordId && span.activity.activeNoteCount > 0))
    .map((instrument) => instrument.instrument.id);
}

function momentDecision(reading: Pick<OrchestrationReading, 'evidence' | 'moments' | 'explicitLeadTrackIds' | 'activeTrackIds' | 'inPianoFill'>): PianoHarmonicEvent['orchestration']['interaction'] {
  if (reading.evidence === 'unavailable') return 'unavailable';
  const spotlight = reading.moments.find((moment) => moment.kind === 'soli' || moment.kind === 'unison' || moment.kind === 'tutti');
  if (spotlight) {
    const participants = spotlight.participantRoles?.map((role) => role.toLowerCase());
    if (participants?.some((role) => role === 'piano' || role === 'keys')) return 'support-moment';
    if (participants) return 'yield-to-spotlight';
    return 'leave-space';
  }
  if (reading.explicitLeadTrackIds.length) return 'leave-space';
  if (reading.activeTrackIds.length >= 4) return 'leave-space';
  if (reading.inPianoFill) return 'interweave';
  return 'interweave';
}
function phraseFunction(
  phrase: Pick<PhraseWindow, 'firstInSection' | 'lastInSection'>,
  sectionCount: number,
  hasMoment: boolean,
  isLastSection: boolean,
  repeatedSection: boolean,
): PianoPhraseIntention['function'] {
  if (phrase.firstInSection && phrase.lastInSection && sectionCount === 1 && isLastSection) return 'statement-and-landing';
  if (phrase.lastInSection && isLastSection) return 'arrival';
  if (phrase.firstInSection && repeatedSection) return 'reprise';
  if (hasMoment) return 'contrast';
  if (phrase.lastInSection) return 'release';
  if (phrase.firstInSection) return 'statement';
  return 'development';
}

function intensityFromTarget(target: number | null): PianoIntensity {
  if (target === null || !Number.isFinite(target)) return 2;
  return Math.max(0, Math.min(5, Math.round(target * 5))) as PianoIntensity;
}

function continuousIntensityFromTarget(target: number, reduction: number): number {
  return Math.max(0, Math.min(5, target * 5 - reduction));
}

function linearTrend(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const meanIndex = (values.length - 1) / 2;
  const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index++) {
    const centeredIndex = index - meanIndex;
    numerator += centeredIndex * (values[index] - meanValue);
    denominator += centeredIndex * centeredIndex;
  }
  return denominator > 0 ? (numerator / denominator) * (values.length - 1) : 0;
}

function clearlyDescendingTowardEnd(trajectory: readonly PianoEnergyTrajectoryPoint[]): boolean {
  if (trajectory.length < 2) return false;
  const tail = trajectory.slice(-Math.min(4, trajectory.length)).map((point) => point.target);
  if (tail.length < 2) return false;
  const last = tail[tail.length - 1];
  const previous = tail[tail.length - 2];
  const tailPeak = Math.max(...tail);
  const netDowntrend = last - tail[0] <= -0.05 && linearTrend(tail) <= -0.04;
  const pronouncedFinalDrop = previous - last >= 0.08;
  return tailPeak - last >= 0.10 && (netDowntrend || pronouncedFinalDrop);
}

interface EnergyTurn {
  readonly index: number;
  readonly kind: 'peak' | 'valley';
  readonly prominence: number;
}

const ENERGY_DIRECTION_EPSILON = 0.008;
const ENERGY_TURN_PROMINENCE = 0.06;

/** Detect a salient reversal from cumulative phrase context, not one-bar slope thresholds. */
function meaningfulEnergyTurns(trajectory: readonly PianoEnergyTrajectoryPoint[]): EnergyTurn[] {
  if (trajectory.length < 3) return [];
  const values = trajectory.map((point) => point.target);
  const candidates: { index: number; kind: EnergyTurn['kind'] }[] = [];
  let direction: -1 | 1 | 0 = 0;
  let trendStart = 0;

  for (let nextIndex = 1; nextIndex < values.length; nextIndex++) {
    const difference = values[nextIndex] - values[nextIndex - 1];
    const nextDirection: -1 | 1 | 0 = Math.abs(difference) <= ENERGY_DIRECTION_EPSILON
      ? 0 : difference > 0 ? 1 : -1;
    if (nextDirection === 0) continue;
    if (direction === 0) {
      direction = nextDirection;
      continue;
    }
    if (nextDirection === direction) continue;

    const kind: EnergyTurn['kind'] = direction > 0 ? 'peak' : 'valley';
    let turnIndex = trendStart;
    for (let index = trendStart + 1; index < nextIndex; index++) {
      const better = kind === 'peak'
        ? values[index] > values[turnIndex]
        : values[index] < values[turnIndex];
      const tiedAndLater = Math.abs(values[index] - values[turnIndex]) <= 1e-9 && index > turnIndex;
      if (better || tiedAndLater) turnIndex = index;
    }
    if (turnIndex > 0 && turnIndex < values.length - 1) candidates.push({ index: turnIndex, kind });
    direction = nextDirection;
    trendStart = turnIndex;
  }

  const mergeAdjacentSameKind = () => {
    for (let index = 1; index < candidates.length; index++) {
      const previous = candidates[index - 1];
      const current = candidates[index];
      if (previous.kind !== current.kind) continue;
      const keepCurrent = current.kind === 'peak'
        ? values[current.index] >= values[previous.index]
        : values[current.index] <= values[previous.index];
      if (keepCurrent) candidates.splice(index - 1, 1);
      else candidates.splice(index, 1);
      index = Math.max(0, index - 2);
    }
  };

  // Remove low-prominence wiggles, then re-evaluate the remaining turns against
  // their new neighbors. This keeps a gradual build followed by a sharp drop,
  // while tiny alternating bar-to-bar changes do not create subphrases.
  for (;;) {
    mergeAdjacentSameKind();
    let weakestIndex = -1;
    let weakestProminence = Number.POSITIVE_INFINITY;
    for (let index = 0; index < candidates.length; index++) {
      const turn = candidates[index];
      const leftIndex = candidates[index - 1]?.index ?? 0;
      const rightIndex = candidates[index + 1]?.index ?? values.length - 1;
      const leftRange = values.slice(leftIndex, turn.index + 1);
      const rightRange = values.slice(turn.index, rightIndex + 1);
      const value = values[turn.index];
      const prominence = turn.kind === 'peak'
        ? Math.min(value - Math.min(...leftRange), value - Math.min(...rightRange))
        : Math.min(Math.max(...leftRange) - value, Math.max(...rightRange) - value);
      if (prominence < weakestProminence) {
        weakestProminence = prominence;
        weakestIndex = index;
      }
    }
    if (weakestIndex < 0 || weakestProminence >= ENERGY_TURN_PROMINENCE) break;
    candidates.splice(weakestIndex, 1);
  }

  return candidates.map((turn, index) => {
    const leftIndex = candidates[index - 1]?.index ?? 0;
    const rightIndex = candidates[index + 1]?.index ?? values.length - 1;
    const leftRange = values.slice(leftIndex, turn.index + 1);
    const rightRange = values.slice(turn.index, rightIndex + 1);
    const value = values[turn.index];
    const prominence = turn.kind === 'peak'
      ? Math.min(value - Math.min(...leftRange), value - Math.min(...rightRange))
      : Math.min(Math.max(...leftRange) - value, Math.max(...rightRange) - value);
    return { ...turn, prominence };
  });
}

function sourceEnergyForPhrase(
  input: PianoEngineInput,
  phrase: PhraseWindow,
): PianoPhraseDynamics['sourceEnergy'] {
  const phraseLength = Math.max(1, phrase.endTick - phrase.startTick);
  const overlappingBars = input.context.barWindows
    .filter((bar) => intersects(bar.startTick, bar.endTick, phrase.startTick, phrase.endTick))
    .sort((a, b) => a.bar - b.bar);
  const energyByBar = new Map(input.context.energy.map((entry) => [entry.bar, entry]));
  const trajectory = overlappingBars.flatMap((bar): PianoEnergyTrajectoryPoint[] => {
    const energy = energyByBar.get(bar.bar);
    if (!energy) return [];
    const sampleTick = Math.max(phrase.startTick, bar.startTick);
    return [{
      bar: bar.bar,
      startTick: bar.startTick,
      endTick: bar.endTick,
      position: Math.max(0, Math.min(1, (sampleTick - phrase.startTick) / phraseLength)),
      target: energy.target,
      nearSilence: energy.nearSilence,
    }];
  });
  let peakIndex = 0;
  for (let index = 1; index < trajectory.length; index++) {
    if (trajectory[index].target > trajectory[peakIndex].target) peakIndex = index;
  }
  return {
    entryTarget: trajectory[0]?.target ?? null,
    exitTarget: trajectory[trajectory.length - 1]?.target ?? null,
    nearSilence: trajectory.some((point) => point.nearSilence),
    descendingTowardEnd: clearlyDescendingTowardEnd(trajectory),
    peakPosition: trajectory[peakIndex]?.position ?? 0.5,
    trajectory,
  };
}

function phraseEntirelyNearSilence(sourceEnergy: PianoPhraseDynamics['sourceEnergy']): boolean {
  return sourceEnergy.trajectory.length > 0
    && sourceEnergy.trajectory.every((point) => point.nearSilence);
}

const DENSITY_LEVEL: Readonly<Record<PianoDensity, number>> = Object.freeze({
  'very-sparse': 0,
  sparse: 1,
  moderate: 2,
  broad: 3,
});

function scalePianoDensity(density: PianoDensity, multiplier: number): PianoDensity {
  const scaled = DENSITY_LEVEL[density] * Math.max(0.1, Math.min(1, multiplier));
  if (scaled < 0.5) return 'very-sparse';
  if (scaled < 1.5) return 'sparse';
  if (scaled < 2.5) return 'moderate';
  return 'broad';
}

function sourceTrend(sourceEnergy: PianoPhraseDynamics['sourceEnergy']): number {
  return linearTrend(sourceEnergy.trajectory.map((point) => point.target));
}

function dynamicPeakPosition(
  sourceEnergy: PianoPhraseDynamics['sourceEnergy'],
  shape: PianoPhraseDynamics['shape'],
  turns: readonly EnergyTurn[],
  trend: number,
): number {
  if (shape === 'unwind' || shape === 'rising-arc' || shape === 'suspended-breath') {
    return sourceEnergy.peakPosition;
  }
  if (shape === 'held-arrival') {
    return trend >= 0.08 && !sourceEnergy.descendingTowardEnd ? sourceEnergy.peakPosition : 0.68;
  }
  if (shape === 'arch') {
    const majorPeak = [...turns]
      .filter((turn) => turn.kind === 'peak')
      .sort((a, b) => b.prominence - a.prominence || b.index - a.index)[0];
    return majorPeak ? sourceEnergy.trajectory[majorPeak.index].position : 0.5;
  }
  return 0.5;
}

function smoothProgress(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function intensityAtPosition(curve: readonly PianoDynamicCurvePoint[], position: number): number | null {
  if (!curve.length) return null;
  const ordered = [...curve].sort((a, b) => a.position - b.position);
  if (position <= ordered[0].position) return ordered[0].intensity;
  for (let index = 0; index + 1 < ordered.length; index++) {
    const left = ordered[index];
    const right = ordered[index + 1];
    if (position > right.position) continue;
    const span = right.position - left.position;
    if (span <= 0) return Math.max(left.intensity, right.intensity);
    const t = smoothProgress((position - left.position) / span);
    return left.intensity + (right.intensity - left.intensity) * t;
  }
  return ordered[ordered.length - 1].intensity;
}

function makeIntensityCurve(
  sourceEnergy: PianoPhraseDynamics['sourceEnergy'],
  shape: PianoPhraseDynamics['shape'],
  peak: PianoIntensity,
  peakPosition: number,
  entry: PianoIntensity,
  orchestrationReduction: number,
  profile: StyleProfile,
): PianoDynamicCurvePoint[] {
  if (!sourceEnergy.trajectory.length) return [];
  const ceiling = profile.densityBias < -0.5 ? 4 : 5;
  const breathCap = shape === 'suspended-breath' ? 1 : ceiling;
  const curve: PianoDynamicCurvePoint[] = sourceEnergy.trajectory.map((point) => ({
    position: point.position,
    intensity: Math.max(0, Math.min(breathCap, continuousIntensityFromTarget(point.target, orchestrationReduction))),
    sourceBar: point.bar,
    sourceTarget: point.target,
  }));
  if (curve[0].position > 0) {
    curve.push({ position: 0, intensity: Math.max(0, Math.min(breathCap, entry)), sourceBar: null, sourceTarget: null });
  }
  const peakAnchor = shape === 'rising-arc' || shape === 'arch' || shape === 'held-arrival';
  if (peakAnchor) {
    const plannedPeak = Math.max(0, Math.min(breathCap, peak));
    const existingPointIndex = curve.findIndex((point) => Math.abs(point.position - peakPosition) <= 1e-8);
    const existingPeak = intensityAtPosition(curve, peakPosition) ?? 0;
    if (plannedPeak > existingPeak + 1e-6) {
      if (existingPointIndex >= 0) {
        curve[existingPointIndex] = { ...curve[existingPointIndex], intensity: plannedPeak };
      } else {
        curve.push({ position: peakPosition, intensity: plannedPeak, sourceBar: null, sourceTarget: null });
      }
    }
  }
  const terminalIntensity = Math.max(0, Math.min(breathCap,
    continuousIntensityFromTarget(sourceEnergy.exitTarget ?? 0.4, orchestrationReduction)));
  curve.push({ position: 1, intensity: terminalIntensity, sourceBar: null, sourceTarget: sourceEnergy.exitTarget });
  return curve.sort((a, b) => a.position - b.position || (a.sourceBar === null ? 1 : -1));
}

function dynamicSegmentsForPhrase(
  sourceEnergy: PianoPhraseDynamics['sourceEnergy'],
  shape: PianoPhraseDynamics['shape'],
  entry: PianoIntensity,
  peak: PianoIntensity,
  exit: PianoIntensity,
  peakPosition: number,
  intensityCurve: readonly PianoDynamicCurvePoint[],
  turns: readonly EnergyTurn[],
): PianoDynamicSegment[] {
  if (!turns.length) {
    return [{ startPosition: 0, endPosition: 1, shape, entry, peak, exit, peakPosition, turningPoint: null }];
  }
  const cuts = turns.flatMap((turn) => {
    const nextPoint = sourceEnergy.trajectory[turn.index + 1];
    return nextPoint && nextPoint.position > 0 && nextPoint.position < 1
      ? [{ position: nextPoint.position, turn: turn.kind }]
      : [];
  });
  const uniqueCuts = cuts.filter((cut, index) => index === 0
    || cut.position > cuts[index - 1].position + 1e-6);
  if (!uniqueCuts.length) {
    return [{ startPosition: 0, endPosition: 1, shape, entry, peak, exit, peakPosition, turningPoint: null }];
  }
  const segments: PianoDynamicSegment[] = [];
  let startPosition = 0;
  let startsAfter: 'peak' | 'valley' | null = null;
  for (const cut of [...uniqueCuts, { position: 1, turn: null as 'peak' | 'valley' | null }]) {
    if (cut.position <= startPosition + 1e-6) continue;
    const includesEnd = cut.position >= 1 - 1e-6;
    const points = intensityCurve.filter((point) => point.position >= startPosition - 1e-6
      && (includesEnd ? point.position <= cut.position + 1e-6 : point.position < cut.position - 1e-6));
    const sourcePoints = sourceEnergy.trajectory.filter((point) => point.position >= startPosition - 1e-6
      && (includesEnd ? point.position <= cut.position + 1e-6 : point.position < cut.position - 1e-6));
    const values = sourcePoints.map((point) => point.target);
    const segmentTrend = linearTrend(values);
    const segmentIsQuiet = sourcePoints.length > 0 && sourcePoints.every((point) => point.nearSilence);
    const segmentShape: PianoPhraseDynamics['shape'] = segmentIsQuiet ? 'suspended-breath'
      : startsAfter === 'peak' ? 'unwind'
        : startsAfter === 'valley' ? 'rising-arc'
          : segmentTrend >= 0.04 ? 'rising-arc'
            : segmentTrend <= -0.04 ? 'unwind' : shape;
    const intensities = points.map((point) => point.intensity);
    const segmentEntry = Math.round(points[0]?.intensity ?? intensityAtPosition(intensityCurve, startPosition) ?? entry) as PianoIntensity;
    const segmentExit = Math.round(points[points.length - 1]?.intensity ?? intensityAtPosition(intensityCurve, cut.position) ?? exit) as PianoIntensity;
    const segmentPeak = Math.max(segmentEntry, segmentExit,
      Math.round(intensities.length ? Math.max(...intensities) : peak)) as PianoIntensity;
    const peakPoint = points.reduce<PianoDynamicCurvePoint | null>((best, point) =>
      !best || point.intensity > best.intensity ? point : best, null);
    segments.push({
      startPosition,
      endPosition: cut.position,
      shape: segmentShape,
      entry: segmentEntry,
      peak: segmentPeak,
      exit: segmentExit,
      peakPosition: peakPoint?.position ?? startPosition,
      turningPoint: startsAfter,
    });
    startPosition = cut.position;
    startsAfter = cut.turn;
  }
  return segments;
}

function dynamicsForPhrase(
  input: PianoEngineInput,
  phrase: PhraseWindow,
  functionName: PianoPhraseIntention['function'],
  profile: StyleProfile,
  reading: OrchestrationReading,
): PianoPhraseDynamics {
  const sourceEnergy = sourceEnergyForPhrase(input, phrase);
  const sourceEntry = intensityFromTarget(sourceEnergy.entryTarget);
  const sourceExit = intensityFromTarget(sourceEnergy.exitTarget);
  const orchestrationReduction = reading.explicitLeadTrackIds.length || reading.activeTrackIds.length >= 5 ? 1 : 0;
  const entry = Math.max(0, sourceEntry - orchestrationReduction) as PianoIntensity;
  const exit = Math.max(0, sourceExit - orchestrationReduction) as PianoIntensity;
  const trend = sourceTrend(sourceEnergy);
  const turns = meaningfulEnergyTurns(sourceEnergy.trajectory);
  const momentAtEnd = input.context.moments.some((moment) =>
    Math.abs(moment.endTick - phrase.endTick) <= 1 && intersects(moment.startTick, moment.endTick, phrase.startTick, phrase.endTick));
  const finalLanding = functionName === 'arrival' || functionName === 'statement-and-landing';
  let shape: PianoPhraseDynamics['shape'];
  if (phraseEntirelyNearSilence(sourceEnergy)) shape = 'suspended-breath';
  else if (finalLanding && sourceEnergy.descendingTowardEnd) shape = 'unwind';
  else if (finalLanding || momentAtEnd) shape = 'held-arrival';
  else if (turns.some((turn) => turn.kind === 'peak')) shape = 'arch';
  else if (trend >= 0.12) shape = 'rising-arc';
  else if (trend <= -0.12) shape = 'unwind';
  else if (turns.some((turn) => turn.kind === 'valley')) shape = 'arch';
  else shape = unitRandom(input.context.seed, `phrase-shape:${phrase.id}`) < 0.52 ? 'arch' : 'plateau';

  const trajectoryPeak = sourceEnergy.trajectory.length
    ? Math.max(...sourceEnergy.trajectory.map((point) => continuousIntensityFromTarget(point.target, orchestrationReduction)))
    : Math.max(entry, exit);
  let peak = Math.max(entry, exit, Math.round(trajectoryPeak)) as PianoIntensity;
  if (shape === 'rising-arc' || shape === 'arch') peak = Math.min(5, Math.max(peak, entry + 1)) as PianoIntensity;
  if (shape === 'held-arrival') peak = Math.max(peak, 3) as PianoIntensity;
  if (profile.densityBias < -0.5) peak = Math.min(peak, 4) as PianoIntensity;
  const adjustedExit = shape === 'unwind' || shape === 'suspended-breath'
    ? Math.min(exit, peak) as PianoIntensity
    : exit;
  peak = Math.max(peak, entry, adjustedExit) as PianoIntensity;
  const peakPosition = dynamicPeakPosition(sourceEnergy, shape, turns, trend);
  const intensityCurve = makeIntensityCurve(
    sourceEnergy, shape, peak, peakPosition, entry, orchestrationReduction, profile,
  );
  const segments = dynamicSegmentsForPhrase(
    sourceEnergy, shape, entry, peak, adjustedExit, peakPosition, intensityCurve, turns,
  );
  const emotionalColor: PianoPhraseDynamics['emotionalColor'] = phraseEntirelyNearSilence(sourceEnergy)
    ? 'yearning'
    : shape === 'rising-arc' || shape === 'held-arrival'
      ? profile.public.identity === 'cinematic-expanse' ? 'luminous' : 'resolute'
      : shape === 'unwind'
        ? 'reflective'
        : profile.public.identity === 'sonata-dialogue' ? 'restless' : 'intimate';
  return {
    shape,
    entry,
    peak,
    exit: adjustedExit,
    peakPosition,
    intensityCurve,
    segments,
    emotionalColor,
    sourceEnergy,
  };
}

function motifOperation(
  phrase: PhraseWindow,
  phraseFunctionName: PianoPhraseIntention['function'],
  previousOperation: PianoMotifOperation | null,
  phraseIndex: number,
  motif: PianoMotifPlan | null,
  profile: StyleProfile,
  reading: OrchestrationReading,
  input: PianoEngineInput,
): { operation: PianoPhraseIntention['motif']['operation']; rationale: string } {
  if (!motif) return { operation: 'unavailable', rationale: 'No resolved harmony was supplied from which to build a chord-relative motif.' };
  if (reading.explicitLeadTrackIds.length && phraseFunctionName !== 'arrival') {
    if (profile.public.identity === 'hybrid-pulse-and-color') {
      return {
        operation: 'fragmented-recall',
        rationale: 'Keep a two-note chord-relative color reply under the annotated lead; anticipate one pulse in the upper voice while the bass anchors harmony, without tracing the lead contour.',
      };
    }
    return { operation: 'withhold-under-lead', rationale: 'An explicit conductor lead annotation is active; the piano motif yields rather than competing.' };
  }
  if (phraseIndex === 0) return { operation: 'introduce', rationale: 'Establish a short chord-relative cell with a prepared neighbor and resolution.' };
  if (phraseFunctionName === 'arrival' || phraseFunctionName === 'statement-and-landing') {
    return { operation: 'fragment-to-landing', rationale: 'Recall only part of the cell so the supplied final harmony, not a repeated pattern, carries the landing.' };
  }
  if (phraseFunctionName === 'reprise') {
    const operation = profile.public.identity === 'sonata-dialogue'
      ? 'invert-and-reframe' as const
      : 'fragmented-recall' as const;
    return {
      operation,
      rationale: `Re-enter the repeated ${phrase.section.name} section with the same main motif identity but a ${operation === 'invert-and-reframe' ? 'reversed contour and new harmonic frame' : 'short recalled fragment'}; this is a reprise, not a copied bar.`,
    };
  }
  const moments = input.context.moments.filter((moment) =>
    intersects(moment.startTick, moment.endTick, phrase.startTick, phrase.endTick));
  if (moments.some((moment) => moment.kind === 'soli' || moment.kind === 'unison')) {
    return { operation: 'invert-and-reframe', rationale: 'Reframe the cell around the explicit conductor spotlight instead of restating it unchanged.' };
  }
  const energy = sourceEnergyForPhrase(input, phrase);
  if (phraseEntirelyNearSilence(energy)
    || (energy.entryTarget !== null && energy.exitTarget !== null && energy.exitTarget < energy.entryTarget - 0.1)) {
    return { operation: 'rhythmic-augmentation', rationale: 'Lengthen the gesture as the supplied energy arc relaxes or creates near-silence.' };
  }
  const previousSection = phrase.section.index > 0;
  const choices: PianoMotifOperation[] = profile.motifMotion === 'wide'
    ? ['interval-expansion', 'fragmented-recall', 'sequence-in-new-harmony']
    : profile.motifMotion === 'angular'
      ? ['sequence-in-new-harmony', 'interval-expansion', 'rhythmic-augmentation']
      : ['sequence-in-new-harmony', 'rhythmic-augmentation', 'fragmented-recall', 'invert-and-reframe'];
  const available = choices.filter((choice) => choice !== previousOperation);
  const selection = available[Math.floor(unitRandom(input.context.seed, `motif-op:${phrase.id}:${motif.id}`) * available.length)] ?? choices[0];
  if (previousSection && phrase.firstInSection && profile.motifMotion === 'lyrical') {
    return { operation: 'invert-and-reframe', rationale: 'The new section restates the motif from a changed contour to make the formal contrast audible.' };
  }
  if (selection === 'sequence-in-new-harmony') {
    return { operation: selection, rationale: 'Move the cell with the next supplied chord roots while preserving its tension-resolution shape.' };
  }
  if (selection === 'interval-expansion') {
    return { operation: selection, rationale: 'Widen one interval in the contour, preserving the cell’s chord-relative anchor and resolution.' };
  }
  if (selection === 'rhythmic-augmentation') {
    return { operation: selection, rationale: 'Stretch the cell’s relative durations and keep its contour recognizable.' };
  }
  if (selection === 'invert-and-reframe') {
    return { operation: selection, rationale: 'Reverse the contour direction and re-anchor it to the current harmony.' };
  }
  return { operation: 'fragmented-recall', rationale: 'Recall only the recognizable opening fragment, leaving space for a new continuation.' };
}
function phraseRhythmicPlan(
  input: PianoEngineInput,
  phrase: PhraseWindow,
  motif: PianoMotifPlan | null,
  operation: PianoPhraseIntention['motif']['operation'],
  density: PianoDensity,
  texture: PianoTextureKind,
  dynamics: PianoPhraseDynamics,
  profile: StyleProfile,
  allowMotifAttacks: boolean,
): PianoPhraseIntention['rhythmicPlan'] {
  const identity = profile.public.identity;
  const isHybrid = identity === 'hybrid-pulse-and-color';
  const pulseTicks = PPQ;
  const gridTicks = isHybrid ? PPQ / 4 : PPQ / 2;
  const phraseLength = Math.max(1, phrase.endTick - phrase.startTick);
  const maximumCellTicks = operation === 'rhythmic-augmentation' ? 16 * PPQ : 8 * PPQ;
  const cellTicks = Math.max(gridTicks, Math.min(phraseLength, maximumCellTicks));
  const defaultWeights = motif?.rhythmicWeights ?? [0.25, 0.25, 0.25, 0.25];

  // A two-bar subject gives the line room to breathe; the explicit
  // augmentation operation doubles that span. All note starts are later
  // quantized against the selected straight eighth- or sixteenth-note grid.
  const hybridCells: readonly (readonly number[])[] = [
    [0.25, 0.25, 0.25, 0.25],
    [0.1875, 0.3125, 0.25, 0.25],
    [0.25, 0.1875, 0.3125, 0.25],
    [0.25, 0.25, 0.1875, 0.3125],
  ];
  const cellIndex = Math.floor(unitRandom(input.context.seed, `hybrid-cell:${phrase.id}`) * hybridCells.length);
  const weights = isHybrid ? (hybridCells[cellIndex] ?? hybridCells[0]) : defaultWeights;
  const operationCanSoundMotif = operation !== 'withhold-under-lead' && operation !== 'unavailable';
  const textureCanCarryMotif = texture === 'sparse-sustained'
    || texture === 'broken-chords' || texture === 'arpeggiated'
    || texture === 'melody-accompaniment' || texture === 'contrapuntal-dialogue';
  const canPlaceMotif = allowMotifAttacks && motif !== null && operationCanSoundMotif && textureCanCarryMotif
    && density !== 'very-sparse' && !phraseEntirelyNearSilence(dynamics.sourceEnergy);

  let syncopation: PianoPhraseIntention['rhythmicPlan']['syncopation'] = null;
  if (isHybrid && canPlaceMotif && phrase.function !== 'arrival'
    && phrase.function !== 'statement-and-landing') {
    const fullCell = ['introduce', 'sequence-in-new-harmony', 'rhythmic-augmentation',
      'interval-expansion', 'invert-and-reframe'].includes(operation);
    const canPairNeighborAndResolution = fullCell
      && (density === 'moderate' || density === 'broad')
      && motif?.tensionResolution.kind === 'chromatic-neighbor';
    const displacedPosition: 1 | 2 = canPairNeighborAndResolution ? 2 : 1;
    const offsetTicks: -240 | -480 = unitRandom(input.context.seed, `hybrid-anticipation:${phrase.id}`) < 0.5
      ? -240 : -480;
    syncopation = {
      displacedPosition,
      offsetTicks,
      resolvesAtPosition: displacedPosition === 2 ? 3 : null,
      rationale: displacedPosition === 2
        ? 'Anticipate the motif neighbor by one sixteenth or eighth; retain its planned stepwise resolution on supplied harmony.'
        : 'Anticipate one chord-relative motif color against the quarter-note bass pulse; the selected pitch remains a supplied chord tone.',
    };
  }

  const hasLeadYield = operation === 'withhold-under-lead' || operation === 'unavailable';
  const isLanding = phrase.function === 'arrival' || phrase.function === 'statement-and-landing'
    || operation === 'fragment-to-landing';
  const positionsFor = (variation: NonNullable<PianoPhraseIntention['rhythmicPlan']['motifCells']>[number]['variation']): (0 | 1 | 2 | 3)[] => {
    if (!canPlaceMotif || hasLeadYield) return [];
    if (variation === 'cadence' || isLanding) return [0, 3];
    if (variation === 'fragment' || operation === 'fragmented-recall') return [0, 1];
    if (texture === 'sparse-sustained') {
      // A sparse Hybrid phrase still needs the explicitly selected pickup to
      // appear in a motif cell; keep the third position as its chord-relative
      // resolution rather than advertising an unrealizable syncopation.
      return isHybrid && syncopation
        ? [0, syncopation.displacedPosition, 3]
        : [0, 3];
    }
    if (density === 'sparse') return [0, 1, 3];
    return [0, 1, 2, 3];
  };
  const firstVariation: NonNullable<PianoPhraseIntention['rhythmicPlan']['motifCells']>[number]['variation'] =
    operation === 'sequence-in-new-harmony' ? 'sequence'
      : operation === 'rhythmic-augmentation' ? 'augmentation'
        : operation === 'interval-expansion' ? 'expansion'
          : operation === 'invert-and-reframe' ? 'reframe'
            : operation === 'fragmented-recall' ? 'fragment'
              : isLanding ? 'cadence' : 'statement';
  const motifCells: Array<NonNullable<PianoPhraseIntention['rhythmicPlan']['motifCells']>[number]> = [];
  if (canPlaceMotif && !hasLeadYield) {
    for (let offset = 0, index = 0; offset < phraseLength; offset += cellTicks, index++) {
      const isLastCell = offset + cellTicks >= phraseLength;
      const variation = isLanding && isLastCell ? 'cadence'
        : index === 0 ? firstVariation
          : operation === 'sequence-in-new-harmony' ? 'sequence'
            : operation === 'introduce' ? index % 2 === 1 ? 'sequence' : 'reframe'
              : operation === 'interval-expansion' && index === 0 ? 'expansion'
                : operation === 'invert-and-reframe' && index === 0 ? 'reframe'
                  : operation === 'rhythmic-augmentation' && index === 0 ? 'augmentation'
                    : operation === 'fragmented-recall' ? 'fragment' : 'sequence';
      const cellPositions = positionsFor(variation);
      if (cellPositions.length) motifCells.push({
        startOffsetTicks: offset,
        positions: cellPositions,
        variation,
      });
    }
  }

  return {
    pulseTicks,
    gridTicks,
    cellTicks,
    weights,
    motifCells,
    syncopation,
  };
}

function textureRoles(kind: PianoTextureKind): Pick<PianoTextureIntention, 'purpose' | 'leftHandRole' | 'rightHandRole'> {
  switch (kind) {
    case 'sparse-sustained':
      return {
        purpose: 'preserve-space',
        leftHandRole: 'hold one quiet bass anchor or rest through the supplied release',
        rightHandRole: 'sustain one clear chord tone; leave the marked lead and occupied register open',
      };
    case 'broken-chords':
      return {
        purpose: 'connect-harmony',
        leftHandRole: 'mark each harmonic change with a restrained, voice-led bass anchor',
        rightHandRole: 'answer in two separated chord-tone fragments rather than a continuous loop',
      };
    case 'arpeggiated':
      return {
        purpose: 'build-motion',
        leftHandRole: 'ground the changing harmony without doubling the upper figure',
        rightHandRole: 'unfold supplied chord tones in a phrase-directed, single-note line',
      };
    case 'melody-accompaniment':
      return {
        purpose: 'carry-melody',
        leftHandRole: 'support the phrase with a separated bass foundation',
        rightHandRole: 'carry the chord-relative subject above a lean harmonic accompaniment',
      };
    case 'block-chords':
      return {
        purpose: 'mark-arrival',
        leftHandRole: 'anchor the structural arrival at the supplied harmony boundary',
        rightHandRole: 'state the selected close-voiced harmony together, without an ornamental roll',
      };
    case 'contrapuntal-dialogue':
      return {
        purpose: 'exchange-voices',
        leftHandRole: 'answer the upper phrase with a lower, stepwise counter-voice between bass anchors',
        rightHandRole: 'shape the motif as a distinct upper phrase with room for the lower reply',
      };
    case 'short-flourishes':
      return {
        purpose: 'punctuate-phrase',
        leftHandRole: 'keep the harmonic foundation quiet beneath the reserved fill window',
        rightHandRole: 'place a brief chord-relative flourish only inside the explicit piano reservation',
      };
  }
}

function textureTransition(
  kind: PianoTextureKind,
  previous: PianoTextureKind | null,
  phrase: PhraseWindow,
): PianoTextureTransition {
  if (previous === null) return 'establish';
  if (previous === kind) return 'continue';
  if (kind === 'sparse-sustained') return phrase.function === 'release' || phrase.lastInSection ? 'release' : 'thin';
  if (kind === 'arpeggiated' || kind === 'broken-chords') return 'unfold';
  if (kind === 'block-chords') return 'open';
  if (kind === 'contrapuntal-dialogue' || kind === 'melody-accompaniment') return 'answer';
  return 'punctuate';
}

function textureIntention(
  input: PianoEngineInput,
  phrase: PhraseWindow,
  dynamics: PianoPhraseDynamics,
  motif: PianoMotifPlan | null,
  profile: StyleProfile,
  reading: OrchestrationReading,
  previousTexture: PianoTextureKind | null,
  fillPlans: readonly PianoFillDecision[],
): PianoTextureIntention {
  const phraseLength = Math.max(1, phrase.endTick - phrase.startTick);
  const harmony = input.context.harmony
    .filter((chord) => intersects(chord.startTick, chord.endTick, phrase.startTick, phrase.endTick))
    .sort((a, b) => a.startTick - b.startTick);
  const meanChordSpan = harmony.length
    ? harmony.reduce((sum, chord) => sum + Math.min(phrase.endTick, chord.endTick) - Math.max(phrase.startTick, chord.startTick), 0) / harmony.length
    : 0;
  const energyTrend = sourceTrend(dynamics.sourceEnergy);
  const energyPeak = dynamics.sourceEnergy.trajectory.length
    ? Math.max(...dynamics.sourceEnergy.trajectory.map((point) => point.target)) : null;
  const activeUpperRegisterActivity = reading.accompanimentActivity.activeNotesPerBar.pianoUpper;
  const upperRegisterActivity = Math.max(reading.registerOccupancy.middle + reading.registerOccupancy.high,
    activeUpperRegisterActivity ?? 0);
  const activeTotal = reading.accompanimentActivity.activeNotesPerBar.total;
  const registerCrowded = (reading.registerOccupancy.availability === 'available' && upperRegisterActivity >= 7)
    || (reading.accompanimentActivity.availability === 'available' && activeUpperRegisterActivity !== null
      && activeUpperRegisterActivity >= 7);
  const ensembleDense = reading.activeTrackIds.length >= 5
    || (reading.registerOccupancy.total >= 14 && upperRegisterActivity >= 8)
    || (reading.accompanimentActivity.availability === 'available' && activeTotal !== null
      && activeTotal >= 14 && (activeUpperRegisterActivity ?? 0) >= 8);
  const hasExplicitLead = reading.explicitLeadTrackIds.length > 0;
  const nonLeadMidUpperActivity = reading.accompanimentActivity.midUpperActivityTrackIds
    .filter((trackId) => !reading.explicitLeadTrackIds.includes(trackId));
  const hasExistingMidUpperLine = nonLeadMidUpperActivity.length > 0;
  const leadNeedsSpace = hasExplicitLead && (ensembleDense || registerCrowded || reading.interaction !== 'interweave');
  const release = (phrase.function === 'release'
      && (dynamics.sourceEnergy.descendingTowardEnd
        || phraseEntirelyNearSilence(dynamics.sourceEnergy) || dynamics.exit <= 1))
    || (dynamics.shape === 'unwind' && dynamics.sourceEnergy.descendingTowardEnd && dynamics.exit <= 2);
  const hasSelectedFill = fillPlans.some((fill) => fill.target.toLowerCase() === 'piano'
    && fill.decision === 'consider-brief-gesture'
    && intersects(fill.startTick, fill.endTick, phrase.startTick, phrase.endTick));
  const hasExplicitLeaveSpace = fillPlans.some((fill) => fill.target.toLowerCase() === 'piano'
    && fill.decision === 'leave-space'
    && intersects(fill.startTick, fill.endTick, phrase.startTick, phrase.endTick));
  const rising = dynamics.shape === 'rising-arc' || (energyTrend >= 0.08 && !dynamics.sourceEnergy.descendingTowardEnd);
  const highArrival = (phrase.function === 'arrival' || phrase.function === 'statement-and-landing'
      || reading.moments.some((moment) => moment.kind === 'tutti' || moment.kind === 'unison'))
    && (dynamics.peak >= 3 || (energyPeak !== null && energyPeak >= 0.68));
  const hasRoomForFiguration = !ensembleDense && !registerCrowded && !hasExplicitLead;
  let kind: PianoTextureKind;
  let rationale: string;

  const phraseIsQuiet = phraseEntirelyNearSilence(dynamics.sourceEnergy);
  if (phraseIsQuiet || reading.interaction === 'yield-to-spotlight'
    || leadNeedsSpace || hasExplicitLeaveSpace || release) {
    kind = 'sparse-sustained';
    rationale = hasExplicitLeaveSpace
      ? 'An explicit Composer leave-space reservation overlaps this phrase; preserve the reserved span instead of layering another texture.'
      : phraseIsQuiet
        ? 'The exact supplied near-silence span is a phrase of its own; leave it to the explicit quiet-bar gate rather than carrying the phrase-wide texture through neighboring bars.'
        : reading.interaction === 'yield-to-spotlight' || leadNeedsSpace
          ? 'The marked orchestral spotlight or written register occupancy calls for a restrained sustained response, not a competing figure.'
          : 'The phrase is releasing or descending toward its boundary; thin the attacks and let the supplied harmony settle.';
  } else if (hasSelectedFill && hasRoomForFiguration) {
    kind = 'short-flourishes';
    rationale = 'A seed-stable Composer decision selected an explicit piano fill reservation; punctuate only that window with harmony-aware notes.';
  } else if (highArrival && !ensembleDense && !registerCrowded) {
    kind = 'block-chords';
    rationale = 'A supplied arrival, unison/tutti moment, or structural peak merits a coordinated chord statement at the harmonic boundary.';
  } else if (rising && hasRoomForFiguration && meanChordSpan >= Math.min(PPQ, phraseLength / 3)
    && harmony.some((chord) => new Set(chord.parsed.pitchClasses).size >= 3)) {
    kind = 'arpeggiated';
    rationale = 'The existing energy trajectory rises over sufficiently long, multi-tone harmony; unfold those chord tones toward the phrase peak.';
  } else if (hasRoomForFiguration && !hasExistingMidUpperLine && motif !== null
    && (profile.public.identity === 'chamber-counterpoint' || profile.public.identity === 'sonata-dialogue')
    && (phrase.function === 'development' || phrase.function === 'contrast' || phrase.function === 'reprise')
    && dynamics.peak >= 2 && harmony.length >= 2) {
    kind = 'contrapuntal-dialogue';
    rationale = phrase.function === 'reprise'
      ? 'A repeated Chamber/Sonata section recalls the established subject while the lower response changes its entry; the same motif identity is developed rather than copied.'
      : 'A chamber/sonata development has room between the supplied chord changes; let the right-hand subject and lower response enter independently.';
  } else if (hasRoomForFiguration && !hasExplicitLead && dynamics.peak >= 1 && dynamics.peak <= 3
    && meanChordSpan >= Math.min(PPQ, phraseLength / 2) && harmony.length > 0) {
    kind = 'broken-chords';
    rationale = 'Moderate energy and spacious harmonic spans support separated chord fragments rather than continuous arpeggiation or a dense block.';
  } else if (hasRoomForFiguration && motif !== null && dynamics.peak >= 2) {
    kind = 'melody-accompaniment';
    rationale = 'The phrase has a usable chord-relative subject and open upper register; keep accompaniment lean beneath the line.';
  } else {
    kind = 'sparse-sustained';
    rationale = 'The current harmony, trajectory, and ensemble activity favor a clear sustained anchor over added figuration.';
  }

  const roles = textureRoles(kind);
  const occupancy = reading.registerOccupancy;
  const evidence = [
    `Section ${phrase.section.name}; phrase function ${phrase.function}; ${phrase.firstInSection ? 'section entry' : phrase.lastInSection ? 'section release' : 'interior phrase'}.`,
    `Energy shape ${dynamics.shape}, trend ${energyTrend.toFixed(3)}, peak ${energyPeak === null ? 'unavailable' : energyPeak.toFixed(2)}${dynamics.sourceEnergy.nearSilence ? ', with supplied near-silence' : ''}.`,
    `${harmony.length} resolved chord span(s) overlap this phrase; mean clipped span ${Math.round(meanChordSpan)} ticks.`,
    `Analyzer reports ${reading.activeTrackIds.length} active written track(s); onset register counts/bar low ${occupancy.low.toFixed(1)}, middle ${occupancy.middle.toFixed(1)}, high ${occupancy.high.toFixed(1)} (${occupancy.availability}).`,
    `Overlapping note events/bar in Piano ranges bass 29–55, support 40–67, inner 50–76, upper 60–101: ${[reading.accompanimentActivity.activeNotesPerBar.pianoBass, reading.accompanimentActivity.activeNotesPerBar.pianoSupport, reading.accompanimentActivity.activeNotesPerBar.pianoInner, reading.accompanimentActivity.activeNotesPerBar.pianoUpper].map((value) => value === null ? 'unavailable' : value.toFixed(1)).join(', ')} (${reading.accompanimentActivity.availability}).`,
    ...(reading.accompanimentActivity.bassFoundationTrackIds.length
      ? [`Observed low-register/bass-role foundation: ${reading.accompanimentActivity.bassFoundationTrackIds.join(', ')}.`] : []),
    ...(hasExistingMidUpperLine
      ? [`Observed non-bass mid/upper activity: ${nonLeadMidUpperActivity.join(', ')}; this is register occupancy, not an inferred lead or response cue.`] : []),
    ...(reading.explicitLeadTrackIds.length ? [`Explicit lead evidence: ${reading.explicitLeadTrackIds.join(', ')}; interaction ${reading.interaction}.`] : [`Orchestration interaction: ${reading.interaction}; no explicit lead candidate overlaps.`]),
    ...(reading.moments.length ? [`Supplied moments: ${unique(reading.moments.map((moment) => moment.kind)).join(', ')}.`] : []),
    ...(hasSelectedFill ? ['A selected explicit piano fill reservation overlaps this phrase.'] : []),
    ...(hasExplicitLeaveSpace ? ['An explicit piano leave-space reservation overlaps this phrase.'] : []),
    ...(previousTexture ? [`Previous phrase texture: ${previousTexture}.`] : []),
  ];
  return {
    kind,
    ...roles,
    transitionFromPrevious: previousTexture,
    transition: textureTransition(kind, previousTexture, phrase),
    rationale,
    evidence,
  };
}
function generationDensity(input: PianoEngineInput): number {
  const density = input.context.generationIdentity?.density;
  return Number.isFinite(density) ? Math.max(0.1, Math.min(1, density!)) : 1;
}

function composePhraseIntention(
  input: PianoEngineInput,
  phrase: PhraseWindow,
  phraseIndex: number,
  motif: PianoMotifPlan | null,
  profile: StyleProfile,
  reading: OrchestrationReading,
  previousOperation: PianoMotifOperation | null,
  previousTexture: PianoTextureKind | null,
  fillPlans: readonly PianoFillDecision[],
): PianoPhraseIntention {
  const functionName = phrase.function;
  const dynamics = dynamicsForPhrase(input, phrase, functionName, profile, reading);
  const motifPlan = motifOperation(phrase, functionName, previousOperation, phraseIndex, motif, profile, reading, input);
  const texture = textureIntention(input, phrase, dynamics, motif, profile, reading, previousTexture, fillPlans);
  const readingLead = reading.explicitLeadTrackIds.length > 0;
  const baseDensity: PianoDensity = phraseEntirelyNearSilence(dynamics.sourceEnergy)
    ? 'very-sparse'
    : texture.kind === 'sparse-sustained' || texture.kind === 'short-flourishes'
      ? 'sparse'
      : texture.kind === 'block-chords'
        ? profile.voicingVoices >= 4 && reading.activeTrackIds.length < 3 ? 'broad' : 'moderate'
        : profile.voicingVoices <= 2 ? 'sparse' : 'moderate';
  const intendedDensity = scalePianoDensity(baseDensity, generationDensity(input));
  const rhythmicIntent = texture.kind === 'sparse-sustained'
    ? 'state a quiet motif anchor, answer it on a later two-bar cell only where space permits, and leave the release open'
    : texture.kind === 'broken-chords'
      ? 'separate chord-tone fragments on the straight subdivision grid; vary their entry across harmony instead of looping a bar'
      : texture.kind === 'arpeggiated'
        ? 'unfold supplied chord tones on the phrase grid toward the planned arc peak, then reverse or thin the figure'
        : texture.kind === 'melody-accompaniment'
          ? 'shape a recognizable two-bar subject above a lean, voice-led accompaniment with independent attack spacing'
          : texture.kind === 'block-chords'
            ? 'state the selected voicing together at structural harmony boundaries and release between arrivals'
            : texture.kind === 'contrapuntal-dialogue'
              ? 'alternate a grid-aligned upper subject and lower response, with the bass approaching the next supplied harmony'
              : 'place a brief chord-relative flourish only within the selected piano fill window, aligned to the phrase grid';
  // Match the Realizer's leave-space gate in the symbolic plan as well: do not
  // advertise a motif cell that the explicit full-phrase reservation will mute.
  const reservedForSpace = fillPlans.some((fill) => fill.target.toLowerCase() === 'piano'
    && fill.decision === 'leave-space'
    && fill.startTick <= phrase.startTick && fill.endTick >= phrase.endTick);
  const rhythmicPlan = phraseRhythmicPlan(input, phrase, motif, motifPlan.operation,
    intendedDensity, texture.kind, dynamics, profile, !reservedForSpace);
  return {
    id: phrase.id,
    sectionId: phrase.section.id,
    startTick: phrase.startTick,
    endTick: phrase.endTick,
    function: functionName,
    boundaryEvidence: unique([...phrase.startReasons, ...phrase.endReasons]),
    texture,
    leftHandIntent: texture.leftHandRole,
    rightHandIntent: readingLead
      ? `Under the explicit lead: ${texture.rightHandRole}`
      : texture.rightHandRole,
    registerPlan: { left: profile.public.leftHandRegister, right: profile.public.rightHandRegister },
    rhythmicIntent,
    rhythmicPlan,
    intendedDensity,
    dynamics,
    motif: {
      motifId: motif?.id ?? null,
      operation: motifPlan.operation,
      rationale: motifPlan.rationale,
    },
  };
}

function chooseMotif(
  input: PianoEngineInput,
  profile: StyleProfile,
): PianoMotifPlan | null {
  if (!input.context.harmony.length) return null;
  const first = materialOf(input.context.harmony[0]);
  const second = materialOf(input.context.harmony[1] ?? input.context.harmony[0]);
  const anchorOptions = first.tones.filter((tone) => tone !== first.root);
  const anchorSet = anchorOptions.length ? anchorOptions : [...first.tones];
  const anchor = anchorSet[Math.floor(unitRandom(input.context.seed, 'motif-anchor') * anchorSet.length)] ?? first.root;
  const targetOptions = second.tones.filter((tone) => tone !== anchor);
  const targets = targetOptions.length ? targetOptions : [...second.tones];
  const targetDistance = profile.motifMotion === 'wide' ? 6
    : profile.motifMotion === 'angular' ? 5
      : profile.motifMotion === 'lyrical' ? 4 : 3;
  const target = [...targets].sort((a, b) =>
    Math.abs(pcDistance(anchor, a) - targetDistance) - Math.abs(pcDistance(anchor, b) - targetDistance)
      + (unitRandom(input.context.seed, `motif-target:${a}`) - unitRandom(input.context.seed, `motif-target:${b}`)) * 0.4)[0] ?? anchor;
  const neighborCandidates = [1, -1, 2, -2]
    .map((step) => pc(target + step))
    .filter((tone) => !second.tones.includes(tone));
  const neighbor = neighborCandidates.length
    ? neighborCandidates[Math.floor(unitRandom(input.context.seed, 'motif-neighbor') * neighborCandidates.length)]
    : target;
  const hasNeighbor = neighborCandidates.length > 0;
  const contour = [
    signedPcMotion(anchor, target),
    signedPcMotion(target, neighbor),
    signedPcMotion(neighbor, target),
  ];
  const rhythmRaw = [
    0.75 + unitRandom(input.context.seed, 'motif-rhythm-a') * 0.75,
    0.25 + unitRandom(input.context.seed, 'motif-rhythm-b') * (profile.public.rhythmicCharacter === 'syncopated' ? 0.9 : 0.55),
    0.3 + unitRandom(input.context.seed, 'motif-rhythm-c') * 0.65,
    0.7 + unitRandom(input.context.seed, 'motif-rhythm-d') * 0.8,
  ];
  const total = rhythmRaw.reduce((sum, value) => sum + value, 0);
  const anchorRole = first.intervals.some((interval) => pc(first.root + interval) === anchor && (interval === 3 || interval === 4))
    ? 'guide-tone' as const : 'chord-tone' as const;
  return {
    id: 'piano-motif-main',
    originChordId: first.chordId,
    originChordSymbol: first.symbol,
    anchorPitchClass: anchor,
    intervalContour: contour,
    rhythmicWeights: rhythmRaw.map((value) => value / total),
    tones: [
      { position: 0, pitchClass: anchor, function: anchorRole },
      { position: 1, pitchClass: target, function: 'chord-tone' },
      { position: 2, pitchClass: neighbor, function: hasNeighbor ? 'chromatic-neighbor' : 'chord-tone' },
      { position: 3, pitchClass: target, function: hasNeighbor ? 'resolution' : 'chord-tone' },
    ],
    tensionResolution: hasNeighbor
      ? {
          kind: 'chromatic-neighbor',
          position: 2,
          resolvesAt: 3,
          semitonesToResolution: pcDistance(neighbor, target),
        }
      : { kind: 'unavailable', reason: 'The supplied chord contains every candidate neighbor pitch class; no non-chord tone is invented.' },
    developmentPalette: ['sequence-in-new-harmony', 'rhythmic-augmentation', 'interval-expansion', 'invert-and-reframe', 'fragmented-recall'],
    identityRationale: hasNeighbor
      ? `Anchored on ${anchorRole} pitch class ${anchor} from ${first.symbol}; a non-chord neighbor resolves by step to a chord tone of ${second.symbol}.`
      : `Anchored on ${anchorRole} pitch class ${anchor}; the supplied harmony leaves no non-chord neighbor, so the cell stays chord-tone based.`,
  };
}

function energyBarAtTick(input: PianoEngineInput, tick: number): PianoEngineInput['context']['energy'][number] | null {
  const bar = input.context.barWindows.find((candidate) => tick >= candidate.startTick && tick < candidate.endTick);
  return bar ? input.context.energy.find((energy) => energy.bar === bar.bar) ?? null : null;
}

function energyTargetAt(input: PianoEngineInput, startTick: number, endTick: number): number | null {
  const atStart = energyBarAtTick(input, startTick);
  if (atStart) return atStart.target;
  const bar = input.context.barWindows.find((candidate) => intersects(candidate.startTick, candidate.endTick, startTick, endTick));
  return bar ? input.context.energy.find((energy) => energy.bar === bar.bar)?.target ?? null : null;
}

function sectionIntention(
  section: SectionWindow,
  index: number,
  sectionCount: number,
  phrases: readonly PianoPhraseIntention[],
  input: PianoEngineInput,
): PianoSectionIntention {
  const sectionPhrases = phrases.filter((phrase) => phrase.sectionId === section.id);
  const textureDurations = new Map<PianoTextureKind, number>();
  for (const phrase of sectionPhrases) {
    textureDurations.set(phrase.texture.kind,
      (textureDurations.get(phrase.texture.kind) ?? 0) + Math.max(0, phrase.endTick - phrase.startTick));
  }
  const dominantTexture = [...textureDurations.entries()]
    .sort(([textureA, durationA], [textureB, durationB]) =>
      durationB - durationA
        || sectionPhrases.findIndex((phrase) => phrase.texture.kind === textureA)
          - sectionPhrases.findIndex((phrase) => phrase.texture.kind === textureB))[0]?.[0] ?? 'sparse-sustained';
  const textureProgression = sectionPhrases.map((phrase) => ({
    phraseId: phrase.id,
    kind: phrase.texture.kind,
    transitionFromPrevious: phrase.texture.transitionFromPrevious,
    transition: phrase.texture.transition,
  }));
  const moments = input.context.moments.filter((moment) => intersects(moment.startTick, moment.endTick, section.startTick, section.endTick));
  const energy = input.context.energy.filter((entry) => {
    const bar = input.context.barWindows.find((candidate) => candidate.bar === entry.bar);
    return !!bar && intersects(bar.startTick, bar.endTick, section.startTick, section.endTick);
  });
  const nearSilence = energy.some((entry) => entry.nearSilence);
  const entireSectionNearSilence = energy.length > 0 && energy.every((entry) => entry.nearSilence);
  const reachesUpperArc = energy.some((entry) => entry.target >= 0.8);
  const functionName: PianoSectionIntention['function'] = sectionCount === 1 || index === 0
    ? 'opening'
    : index === sectionCount - 1
      ? 'closing'
      : section.occurrence > 1
        ? 'reprise'
        : moments.some((moment) => moment.kind === 'tutti' || moment.kind === 'unison') || reachesUpperArc
        ? 'culmination'
        : nearSilence || moments.some((moment) => moment.kind === 'soli')
          ? 'contrast' : 'continuation';
  const firstPhrase = sectionPhrases[0];
  const lastPhrase = sectionPhrases[sectionPhrases.length - 1];
  const sectionLength = Math.max(1, section.endTick - section.startTick);
  const sectionEnergyTrajectory: PianoEnergyTrajectoryPoint[] = input.context.barWindows
    .filter((bar) => intersects(bar.startTick, bar.endTick, section.startTick, section.endTick))
    .sort((a, b) => a.bar - b.bar)
    .flatMap((bar): PianoEnergyTrajectoryPoint[] => {
      const sample = input.context.energy.find((candidate) => candidate.bar === bar.bar);
      if (!sample) return [];
      const tick = Math.max(section.startTick, bar.startTick);
      return [{
        bar: bar.bar,
        startTick: bar.startTick,
        endTick: bar.endTick,
        position: Math.max(0, Math.min(1, (tick - section.startTick) / sectionLength)),
        target: sample.target,
        nearSilence: sample.nearSilence,
      }];
    });
  let sectionPeakIndex = 0;
  for (let index = 1; index < sectionEnergyTrajectory.length; index++) {
    if (sectionEnergyTrajectory[index].target > sectionEnergyTrajectory[sectionPeakIndex].target) sectionPeakIndex = index;
  }
  const sectionCurvePoints = sectionPhrases.flatMap((phrase) => {
    const phraseLength = phrase.endTick - phrase.startTick;
    return phrase.dynamics.intensityCurve.map((point) => ({
      ...point,
      position: Math.max(0, Math.min(1,
        (phrase.startTick + point.position * phraseLength - section.startTick) / sectionLength)),
    }));
  }).sort((a, b) => a.position - b.position
    || (a.sourceBar === b.sourceBar ? 0 : a.sourceBar === null ? -1 : 1));
  const sectionCurve: PianoDynamicCurvePoint[] = [];
  for (const point of sectionCurvePoints) {
    const previous = sectionCurve[sectionCurve.length - 1];
    if (previous && Math.abs(previous.position - point.position) <= 1e-8) {
      if (point.sourceBar !== null || previous.sourceBar === null) sectionCurve[sectionCurve.length - 1] = point;
      continue;
    }
    sectionCurve.push(point);
  }
  const sectionPeakPhrase = sectionPhrases.reduce((best, phrase) =>
    !best || phrase.dynamics.peak > best.dynamics.peak ? phrase : best, null as PianoPhraseIntention | null);
  const sectionSegments = sectionPhrases.flatMap((phrase) => {
    const phraseLength = phrase.endTick - phrase.startTick;
    return phrase.dynamics.segments.map((segment) => ({
      ...segment,
      startPosition: Math.max(0, Math.min(1,
        (phrase.startTick + segment.startPosition * phraseLength - section.startTick) / sectionLength)),
      endPosition: Math.max(0, Math.min(1,
        (phrase.startTick + segment.endPosition * phraseLength - section.startTick) / sectionLength)),
      peakPosition: Math.max(0, Math.min(1,
        (phrase.startTick + segment.peakPosition * phraseLength - section.startTick) / sectionLength)),
    }));
  });
  const dynamics = firstPhrase && lastPhrase
    ? {
        ...firstPhrase.dynamics,
        peak: Math.max(...sectionPhrases.map((phrase) => phrase.dynamics.peak)) as PianoIntensity,
        exit: lastPhrase.dynamics.exit,
        shape: entireSectionNearSilence ? 'suspended-breath' as const : lastPhrase.dynamics.shape,
        peakPosition: sectionPeakPhrase
          ? (sectionPeakPhrase.startTick + sectionPeakPhrase.dynamics.peakPosition
            * (sectionPeakPhrase.endTick - sectionPeakPhrase.startTick) - section.startTick) / sectionLength
          : 0.5,
        intensityCurve: sectionCurve,
        segments: sectionSegments,
        sourceEnergy: {
          entryTarget: sectionEnergyTrajectory[0]?.target ?? firstPhrase.dynamics.sourceEnergy.entryTarget,
          exitTarget: sectionEnergyTrajectory.at(-1)?.target ?? lastPhrase.dynamics.sourceEnergy.exitTarget,
          nearSilence,
          descendingTowardEnd: clearlyDescendingTowardEnd(sectionEnergyTrajectory),
          peakPosition: sectionEnergyTrajectory[sectionPeakIndex]?.position ?? 0.5,
          trajectory: sectionEnergyTrajectory,
        },
      }
    : {
        shape: 'plateau' as const,
        entry: 2 as const,
        peak: 2 as const,
        exit: 2 as const,
        peakPosition: 0.5,
        intensityCurve: [],
        segments: [{ startPosition: 0, endPosition: 1, shape: 'plateau' as const,
          entry: 2 as const, peak: 2 as const, exit: 2 as const, peakPosition: 0.5, turningPoint: null }],
        emotionalColor: 'reflective' as const,
        sourceEnergy: {
          entryTarget: null,
          exitTarget: null,
          nearSilence: false,
          descendingTowardEnd: false,
          peakPosition: 0.5,
          trajectory: [],
        },
      };
  const textureDirection = functionName === 'opening'
    ? 'introduce the piano language in a restrained register before widening'
    : functionName === 'reprise'
      ? 'recall the established subject with a changed contour or fragment and let the harmony supply the new color'
      : functionName === 'culmination'
        ? 'open the voicing only at the explicit moment or high-energy section peak'
        : functionName === 'contrast'
          ? 'thin or reframe the texture to make the section change audible'
          : functionName === 'closing'
            ? 'reduce activity toward a clear landing on the final supplied harmony'
            : 'develop the established motif without repeating its previous surface';
  const textureChange = `${textureDirection}; ${dominantTexture} is the section’s duration-weighted texture, with ${textureProgression.length} phrase-level decision(s).`;
  const evidence = [
    'Section identity and tick span are copied from the existing context.',
    `Duration-weighted section texture is ${dominantTexture}; phrase transitions are retained in textureProgression.`,
    ...(moments.length ? [`Conductor annotations present: ${unique(moments.map((moment) => moment.kind)).join(', ')}.`] : []),
    ...(nearSilence ? ['The existing energy arc marks near-silence in this section.'] : []),
    ...(reachesUpperArc ? ['The supplied energy arc reaches at least 0.8 in this section.'] : []),
  ];
  return {
    sectionId: section.id,
    name: section.name,
    index: section.index,
    occurrence: section.occurrence,
    startTick: section.startTick,
    endTick: section.endTick,
    function: functionName,
    texture: dominantTexture,
    textureProgression,
    textureChange,
    phraseIds: sectionPhrases.map((phrase) => phrase.id),
    dynamics,
    evidence,
  };
}

function makeOrchestrationReadingForEvent(
  input: PianoEngineInput,
  analyzer: PianoAnalyzerReport,
  chord: PianoEngineInput['context']['harmony'][number],
): OrchestrationReading {
  const reading = orchestrationReading(input, analyzer, chord.startTick, chord.endTick);
  const accompanimentActivity = accompanimentActivityForChord(analyzer, chord.id);
  const relationIds = chordActivityIds(analyzer, chord.id);
  const exactActivityAvailable = accompanimentActivity.availability === 'available';
  const activeTrackIds = exactActivityAvailable
    ? [...accompanimentActivity.activeTrackIds]
    : unique([...reading.activeTrackIds, ...relationIds]);
  const active = analyzer.observedFacts.instruments
    .filter(composerVisible)
    .filter((instrument) => activeTrackIds.includes(instrument.instrument.id));
  const enriched = {
    ...reading,
    activeTrackIds,
    activeRoles: active.map((instrument) => instrument.instrument.role),
    accompanimentActivity,
  };
  return { ...enriched, interaction: momentDecision(enriched) };
}

function suspensionFor(
  previous: { chordId: string; endTick: number; rightHand: readonly number[]; leftHandBassPitchClass: number } | null,
  currentChord: PianoEngineInput['context']['harmony'][number],
  material: ChordMaterial,
  currentBassPitchClass: number,
  octavePolicy: PianoComposerPlan['templateConstraints']['octaveDoubling'],
  profile: StyleProfile,
  seed: number,
): PianoSuspensionIntent | null {
  if (!previous || previous.endTick !== currentChord.startTick || profile.suspensionBias <= 0) return null;
  if (unitRandom(seed, `suspension:${currentChord.id}`) > profile.suspensionBias) return null;
  const mayDouble = octavePolicy === 'allowed' || octavePolicy === 'climaxOnly';
  const candidates = previous.rightHand.filter((tone) => !material.tones.includes(tone));
  const resolutions = candidates.flatMap((tone) => material.tones
    .map((target) => ({ tone, target, distance: pcDistance(tone, target) }))
    .filter((choice) => choice.distance > 0 && choice.distance <= 2
      && (mayDouble || pc(previous.leftHandBassPitchClass) !== pc(choice.tone))
      && (mayDouble || pc(currentBassPitchClass) !== pc(choice.target))))
    .sort((a, b) => a.distance - b.distance || a.tone - b.tone || a.target - b.target);
  const chosen = resolutions[0];
  if (!chosen) return null;
  const avoidsBassDoubling = !mayDouble
    && pc(currentBassPitchClass) !== pc(chosen.target)
    && material.tones.some((tone) => tone !== chosen.target && pcDistance(chosen.tone, tone) > 0 && pcDistance(chosen.tone, tone) <= 2);
  return {
    kind: 'prepared-stepwise-suspension',
    preparedByChordId: previous.chordId,
    tensionPitchClass: chosen.tone,
    resolvesToPitchClass: chosen.target,
    resolutionDistanceSemitones: chosen.distance,
    evidence: `Pitch class ${chosen.tone} belongs to ${previous.chordId}, is absent from ${currentChord.symbol}, and can resolve by step to ${chosen.target}.${avoidsBassDoubling ? ` The ${octavePolicy} octave policy favors this adjacent chord tone over a resolution that would double the left-hand bass.` : ''}`,
  };
}

function structuralRoleForEvent(
  chord: PianoEngineInput['context']['harmony'][number],
  phrase: PhraseWindow | null,
  isFinalHarmony: boolean,
  reading: OrchestrationReading,
): PianoHarmonicEvent['structuralRole'] {
  if (isFinalHarmony || phrase?.function === 'arrival' || phrase?.function === 'statement-and-landing'
    || reading.moments.some((moment) => moment.kind === 'tutti' || moment.kind === 'unison')) return 'arrival';
  if (phrase?.function === 'release' || reading.moments.some((moment) => moment.endTick === chord.endTick)) return 'release';
  if (reading.moments.length || reading.explicitLeadTrackIds.length) return 'color-turn';
  return 'continuity';
}

function composeHarmonicEvents(
  input: PianoEngineInput,
  analyzer: PianoAnalyzerReport,
  phrases: readonly PhraseWindow[],
  phrasePlans: readonly PianoPhraseIntention[],
  fillPlans: readonly PianoFillDecision[],
  profile: StyleProfile,
): PianoHarmonicEvent[] {
  const chords = [...input.context.harmony].sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  const events: PianoHarmonicEvent[] = [];
  let previousBass: number | null = null;
  let previousRightHand: number[] = [];
  let previousChord: { chordId: string; endTick: number; rightHand: readonly number[]; leftHandBassPitchClass: number } | null = null;

  for (let index = 0; index < chords.length; index++) {
    const chord = chords[index];
    const material = materialOf(chord);
    const phrase = phraseForEvent(phrases, chord.startTick);
    const phrasePlan = phrasePlans.find((candidate) => candidate.id === phrase?.id) ?? null;
    const reading = makeOrchestrationReadingForEvent(input, analyzer, chord);
    const isFinalHarmony = index === chords.length - 1;
    const momentArrival = reading.moments.some((moment) => moment.kind === 'tutti' || moment.kind === 'unison');
    const arrival = isFinalHarmony || phrasePlan?.function === 'arrival' || momentArrival;
    const bass = selectBass(material, previousBass, phrase, profile, input.context.seed,
      phrase !== null && chord.startTick === phrase.startTick);
    const desired = desiredVoices(profile, reading, phrase, arrival);
    const rightHand = selectRightHand(material, bass, previousRightHand, profile, desired, input.context.seed);
    const common = rightHand.filter((tone) => previousRightHand.includes(tone));
    const motion = previousRightHand.length ? minimumVoiceMotion(previousRightHand, rightHand) : null;
    const bassMotion = previousBass === null ? null : pcDistance(previousBass, bass);
    const inversion = inversionFor(material, bass);
    const selectedExtensions = rightHand.filter((tone) => material.extensions.includes(tone));
    const omitted = material.tones.filter((tone) => tone !== bass && !rightHand.includes(tone));
    const candidateSuspension = suspensionFor(previousChord, chord, material, bass, octaveRule(input), profile, input.context.seed);
    const suspensionResolveTick = chord.startTick + Math.min(PPQ / 2,
      Math.max(1, Math.round((chord.endTick - chord.startTick) * 0.18)));
    const leaveSpaceBlocksResolution = candidateSuspension !== null && fillPlans.some((decision) =>
      decision.target.toLowerCase() === 'piano'
      && decision.decision === 'leave-space'
      && suspensionResolveTick >= decision.startTick && suspensionResolveTick < decision.endTick);
    const suspension = leaveSpaceBlocksResolution ? null : candidateSuspension;
    const sectionIds = sectionIdsFor(input, chord.startTick, chord.endTick);
    const selectedPhrase = phrasePlan;
    const nearSilence = energyBarAtTick(input, chord.startTick)?.nearSilence ?? false;
    const hasLead = reading.explicitLeadTrackIds.length > 0;
    const hybridPulseUnderLead = profile.public.identity === 'hybrid-pulse-and-color'
      && hasLead && !nearSilence && reading.moments.length === 0 && reading.activeTrackIds.length < 4;
    const momentYield = reading.interaction === 'yield-to-spotlight'
      || (reading.interaction === 'leave-space' && (!hasLead || reading.activeTrackIds.length >= 4));
    const textureKind = selectedPhrase?.texture.kind;
    const upperRegisterActivity = Math.max(
      reading.registerOccupancy.middle + reading.registerOccupancy.high,
      reading.accompanimentActivity.activeNotesPerBar.pianoUpper ?? 0,
    );
    const hasBassFoundation = reading.accompanimentActivity.bassFoundationTrackIds.length > 0;
    const baseHandDensity: PianoDensity = nearSilence || momentYield ? 'very-sparse'
      : hasLead || reading.activeTrackIds.length >= 5 || upperRegisterActivity >= 7 ? 'sparse'
        : textureKind === 'sparse-sustained' || textureKind === 'short-flourishes' ? 'sparse'
          : textureKind === 'block-chords'
            ? arrival && profile.voicingVoices >= 4 ? 'broad' : 'moderate'
            : textureKind === 'melody-accompaniment' ? 'sparse'
              : profile.voicingVoices <= 2 ? 'sparse' : 'moderate';
    const handDensity = scalePianoDensity(baseHandDensity, generationDensity(input));
    const lhRole = nearSilence || momentYield ? 'yielding held tone or silence'
      : hasBassFoundation ? 'root-light counter-foundation under the observed low-register line'
        : selectedPhrase?.texture.leftHandRole
          ?? (previousBass === bass ? 'hold a common bass tone through the chord change' : profile.public.leftHandRole);
    const rhRole = nearSilence || momentYield ? 'withhold or leave a single color-tone trace'
      : hasLead ? hybridPulseUnderLead
        ? 'sparse chord-relative pulse and color beneath the annotated lead; avoid its melodic contour'
        : 'inner response to the explicitly annotated lead; do not double it'
        : reading.moments.length ? 'support the supplied moment with a compact chord-tone voicing'
          : selectedPhrase?.texture.rightHandRole ?? profile.public.rightHandRole;
    const interaction = momentYield ? reading.interaction
      : hasLead ? hybridPulseUnderLead ? 'interweave' as const : 'leave-space' as const
        : reading.moments.length ? 'support-moment' as const
          : reading.interaction;
    const treatment: PianoHarmonicEvent['voicing']['treatment'] = material.slashBass !== null
      ? 'slash-bass-voicing'
      : material.quality.toLowerCase().includes('sus') ? 'suspended-chord'
        : selectedExtensions.length ? 'extension-color'
          : rightHand.length <= 2 ? 'guide-tone-shell' : material.tones.length <= 3 ? 'open-triad' : 'guide-tone-shell';
    const energyTarget = energyTargetAt(input, chord.startTick, chord.endTick);
    const dynamic = selectedPhrase?.dynamics;
    const dynamicPosition = selectedPhrase
      ? Math.max(0, Math.min(1, (chord.startTick - selectedPhrase.startTick)
        / Math.max(1, selectedPhrase.endTick - selectedPhrase.startTick)))
      : 0;
    const plannedIntensity = dynamic ? intensityAtPosition(dynamic.intensityCurve, dynamicPosition) : null;
    const intensity = plannedIntensity !== null
      ? Math.max(0, Math.min(5, Math.round(plannedIntensity))) as PianoIntensity
      : dynamic?.shape === 'suspended-breath' ? Math.min(dynamic.entry, 1) as PianoIntensity
        : dynamic?.shape === 'held-arrival' && arrival ? dynamic.peak
          : dynamic?.entry ?? intensityFromTarget(energyTarget);

    events.push({
      chord: {
        id: chord.id,
        symbol: chord.symbol,
        startTick: chord.startTick,
        endTick: chord.endTick,
        rootPitchClass: material.root,
        availablePitchClasses: [...material.tones],
        quality: material.quality,
      },
      sectionIds,
      phraseId: phrase?.id ?? null,
      structuralRole: structuralRoleForEvent(chord, phrase, isFinalHarmony, reading),
      voicing: {
        leftHandBassPitchClass: bass,
        inversion,
        rightHandPitchClasses: [...rightHand],
        selectedExtensionPitchClasses: selectedExtensions,
        omittedChordPitchClasses: omitted,
        treatment,
      },
      voiceLeading: {
        fromChordId: index > 0 ? chords[index - 1].id : null,
        commonPitchClasses: common,
        totalSemitoneMotion: motion,
        bassSemitoneMotion: bassMotion,
        strategy: rightHandMotion(previousRightHand, rightHand),
      },
      suspension,
      hands: {
        left: {
          role: lhRole,
          register: profile.public.leftHandRegister,
          motion: nearSilence || momentYield ? 'yield'
            : previousBass === bass ? 'hold-common-tone'
              : hasBassFoundation ? 'sparse-approach' : 'change-with-harmony',
        },
        right: {
          role: rhRole,
          register: profile.public.rightHandRegister,
          density: handDensity,
          motion: nearSilence || momentYield ? 'yield'
            : hasLead ? 'inner-voice'
              : textureKind === 'short-flourishes' ? 'fragment'
                : textureKind === 'melody-accompaniment' || textureKind === 'contrapuntal-dialogue'
                  || textureKind === 'broken-chords' || textureKind === 'arpeggiated'
                  ? 'motif-led'
                  : selectedPhrase?.motif.operation === 'fragmented-recall' || selectedPhrase?.motif.operation === 'fragment-to-landing'
                    ? 'fragment'
                    : rightHand.length >= 3 ? 'motif-led' : 'open-hold',
        },
      },
      orchestration: {
        activeTrackIds: reading.activeTrackIds,
        activeRoles: reading.activeRoles,
        explicitLeadTrackIds: reading.explicitLeadTrackIds,
        momentKinds: unique(reading.moments.map((moment) => moment.kind)),
        interaction,
        analyzerEvidence: reading.evidence,
        registerOccupancy: { ...reading.registerOccupancy },
        accompanimentActivity: reading.accompanimentActivity,
      },
      dynamicIntent: {
        intensity,
        gesture: dynamic?.shape ?? 'plateau',
        sourceEnergyTarget: energyTarget,
        sourceEnergyNearSilence: energyBarAtTick(input, chord.startTick)?.nearSilence ?? false,
      },
    });
    previousBass = bass;
    previousRightHand = rightHand;
    previousChord = { chordId: chord.id, endTick: chord.endTick, rightHand, leftHandBassPitchClass: bass };
  }
  return events;
}
function fillActivity(
  analyzer: PianoAnalyzerReport,
  fill: PianoEngineInput['context']['fillWindows'][number],
): { available: boolean; activeIds: string[]; onsetCount: number } {
  const visibleInstruments = analyzer.observedFacts.instruments.filter(composerVisible);
  const entries = visibleInstruments.flatMap((instrument) => instrument.relationships.fillWindows.items)
    .filter((entry) => entry.window.target === fill.target
      && entry.window.startTick === fill.startTick
      && entry.window.endTick === fill.endTick);
  if (!entries.length || !analyzer.observedFacts.instruments.length) return { available: false, activeIds: [], onsetCount: 0 };
  const activeIds = visibleInstruments.flatMap((instrument) => {
    const relation = instrument.relationships.fillWindows.items.find((entry) => entry.window.target === fill.target
      && entry.window.startTick === fill.startTick && entry.window.endTick === fill.endTick);
    return relation && relation.activity.activeNoteCount > 0 ? [instrument.instrument.id] : [];
  });
  return {
    available: true,
    activeIds,
    onsetCount: entries.reduce((sum, entry) => sum + entry.activity.onsetNoteCount, 0),
  };
}

function fillDecisions(
  input: PianoEngineInput,
  analyzer: PianoAnalyzerReport,
  sections: readonly SectionWindow[],
  profile: StyleProfile,
): PianoFillDecision[] {
  const fills = input.context.fillWindows;
  const decisions: PianoFillDecision[] = [];
  const consideredSections = new Set<string>();
  for (const [index, fill] of fills.entries()) {
    const section = sectionForTick(sections, fill.startTick);
    const activity = fillActivity(analyzer, fill);
    if (fill.target.toLowerCase() !== 'piano') {
      decisions.push({
        target: fill.target, startTick: fill.startTick, endTick: fill.endTick,
        sectionId: section?.id ?? null, decision: 'keys-family-only',
        observedWrittenActivity: { availability: activity.available ? 'available' : 'unavailable', activeTrackIds: activity.activeIds, onsetCount: activity.onsetCount },
        rationale: 'The conductor target is the Keys family, not piano specifically; preserve it as context without assigning a piano response.',
        mandatory: false,
      });
      continue;
    }
    if (!activity.available) {
      decisions.push({
        target: fill.target, startTick: fill.startTick, endTick: fill.endTick,
        sectionId: section?.id ?? null, decision: 'activity-evidence-unavailable',
        observedWrittenActivity: { availability: 'unavailable', activeTrackIds: [], onsetCount: 0 },
        rationale: 'An explicit piano fill reservation exists, but the Analyzer supplied no matching activity relationship; do not infer a rest or fill from missing data.',
        mandatory: false,
      });
      continue;
    }
    const leadPresent = analyzer.interpretations.leadPassages.candidates.some((candidate) =>
      intersects(candidate.startTick, candidate.endTick, fill.startTick, fill.endTick));
    const momentPresent = input.context.moments.some((moment) =>
      moment.kind === 'soli' && intersects(moment.startTick, moment.endTick, fill.startTick, fill.endTick));
    const noise = unitRandom(input.context.seed, `fill-choice:${index}:${fill.startTick}:${fill.endTick}`) * 0.18;
    const activityPenalty = Math.min(activity.activeIds.length, 5) * 0.09;
    const score = profile.responseBias + noise + (momentPresent ? 0.12 : 0) - activityPenalty - (leadPresent ? 0.28 : 0);
    const sectionKey = section?.id ?? '__unsectioned';
    const selected = score >= 0.62 && !consideredSections.has(sectionKey);
    if (selected) consideredSections.add(sectionKey);
    decisions.push({
      target: fill.target, startTick: fill.startTick, endTick: fill.endTick,
      sectionId: section?.id ?? null,
      decision: selected ? 'consider-brief-gesture' : 'leave-space',
      observedWrittenActivity: { availability: 'available', activeTrackIds: activity.activeIds, onsetCount: activity.onsetCount },
      rationale: selected
        ? 'A seed-stable choice selects one optional gesture from this section’s explicit piano fill reservation; the choice is not inferred from silence and is not mandatory.'
        : leadPresent
          ? 'Preserve the explicit fill window as space under an annotated lead; do not compete or fill every reservation.'
          : 'Keep the explicit fill window open; the orchestration context or style score does not justify another piano gesture here.',
      mandatory: false,
    });
  }
  return decisions;
}

function attackRestrictions(input: PianoEngineInput): PianoAttackRestriction[] {
  const energyByBar = new Map(input.context.energy.map((energy) => [energy.bar, energy]));
  return input.context.barWindows.flatMap((bar) => {
    const energy = energyByBar.get(bar.bar);
    if (!energy?.nearSilence || energy.target !== 0) return [];
    return [{
      bar: bar.bar,
      startTick: bar.startTick,
      endTick: bar.endTick,
      reason: 'near-silence-zero-energy' as const,
      rationale: `The supplied energy arc marks bar ${bar.bar} near-silent with a zero target; suppress new attacks unless a specific Composer exception or fill decision authorizes one.`,
    }];
  });
}

function structuralEvents(
  input: PianoEngineInput,
  sections: readonly SectionWindow[],
  harmonicEvents: readonly PianoHarmonicEvent[],
): PianoStructuralEvent[] {
  const events: PianoStructuralEvent[] = [];
  sections.forEach((section, index) => {
    events.push({
      kind: index === 0 ? 'section-entry' : 'section-transition',
      startTick: section.startTick,
      endTick: section.startTick,
      sectionId: section.id,
      intention: index === 0 ? 'introduce the piano language without spending the whole dynamic range' : 'reframe the motif and hand roles for the new section',
      evidence: `Existing section boundary: ${section.name} (${section.id}).`,
    });
    events.push({
      kind: 'section-release',
      startTick: section.endTick,
      endTick: section.endTick,
      sectionId: section.id,
      intention: 'leave a clear transition into the next supplied section',
      evidence: `Existing section end tick ${section.endTick}.`,
    });
  });
  for (const moment of input.context.moments) {
    events.push({
      kind: 'conductor-emphasis',
      startTick: moment.startTick,
      endTick: moment.endTick,
      sectionId: sectionForTick(sections, moment.startTick)?.id ?? null,
      momentKind: moment.kind,
      intention: moment.kind === 'soli' ? 'thin the piano texture or support only if the explicit participant list includes piano' : 'shape a compact emphasis around the supplied conductor moment',
      evidence: `Reused explicit ${moment.kind} annotation from PianoEngineContext.moments.`,
    });
  }
  const energyByBar = new Map(input.context.energy.map((energy) => [energy.bar, energy]));
  for (const bar of input.context.barWindows) {
    const energy = energyByBar.get(bar.bar);
    const next = input.context.energy.find((candidate) => candidate.bar === bar.bar + 1);
    if (energy?.nearSilence && next && next.target > energy.target) {
      const nextBar = input.context.barWindows.find((candidate) => candidate.bar === next.bar);
      if (nextBar) events.push({
        kind: 'release-after-near-silence',
        startTick: nextBar.startTick,
        endTick: nextBar.startTick,
        sectionId: nextBar.sectionId,
        intention: 'allow a single restrained arrival after the supplied near-silence, then develop rather than automatically swell',
        evidence: `Existing energy arc marks bar ${bar.bar} near-silent and raises target in bar ${next.bar}.`,
      });
    }
  }
  const final = harmonicEvents[harmonicEvents.length - 1];
  if (final) events.push({
    kind: 'final-landing',
    startTick: final.chord.endTick,
    endTick: final.chord.endTick,
    sectionId: final.sectionIds[final.sectionIds.length - 1] ?? null,
    chordId: final.chord.id,
    intention: 'reduce the texture and sustain a clear voicing of the final supplied chord; no cadence is inferred',
    evidence: `The last resolved chord span supplied is ${final.chord.symbol} (${final.chord.id}).`,
  });
  return events.sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick || a.kind.localeCompare(b.kind));
}

function octaveRule(input: PianoEngineInput): PianoComposerPlan['templateConstraints']['octaveDoubling'] {
  return input.context.rules.find((rule) => rule.type === 'octaveDoubling')?.policy ?? 'not-specified';
}

function fillRules(input: PianoEngineInput): Extract<PianoTemplateRule, { type: 'fillGating' }>[] {
  return input.context.rules
    .filter((rule): rule is Extract<PianoTemplateRule, { type: 'fillGating' }> => rule.type === 'fillGating')
    .map((rule) => ({ ...rule }));
}

function endingPlan(
  harmonicEvents: readonly PianoHarmonicEvent[],
  eligible: boolean,
): PianoComposerPlan['ending'] {
  const final = harmonicEvents[harmonicEvents.length - 1];
  if (!final) return {
    availability: 'unavailable', tick: null, chordId: null, intention: 'unavailable', cadenceInference: false,
    reason: eligible
      ? 'No resolved harmony was supplied; an ending cannot be composed without inventing a chord.'
      : 'The resolved template gate makes piano ineligible; no piano ending is planned.',
  };
  const hasSuspendedQuality = final.chord.quality.toLowerCase().includes('sus');
  return {
    availability: 'available',
    tick: final.chord.endTick,
    chordId: final.chord.id,
    intention: hasSuspendedQuality ? 'leave-color-open' : 'settle-on-supplied-harmony',
    cadenceInference: false,
    reason: hasSuspendedQuality
      ? 'The final supplied chord carries suspended quality; preserve its open color rather than invent a resolution.'
      : 'Land on the final supplied harmony with a thinning texture; no key, mode, or cadence is inferred.',
  };
}

function freezePlan<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezePlan(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Compose symbolic Piano intentions from the exact engine input and its Phase
 * 4B analysis. The report is consumed as evidence; composePianoScore then
 * realizes these intentions as Composer-owned events before the Realizer.
 * Production integration is owned by composeAllTracks, which invokes the
 * Composer as part of Piano Engine V5.
 */
export function composePianoPlan(input: PianoEngineInput, analyzer: PianoAnalyzerReport): PianoComposerPlan {
  const sourceIdentity = input.context.generationIdentity;
  const seed = Number.isFinite(input.context.seed) ? Math.trunc(input.context.seed) >>> 0 : 0;
  const generationIdentity: PianoGenerationIdentity = {
    algorithm: sourceIdentity?.algorithm ?? 'piano-engine-v5',
    key: sourceIdentity?.key ?? `piano-engine-v5|legacy-seed=${seed}`,
    orchestrationSeed: sourceIdentity?.orchestrationSeed ?? seed,
    userSeed: sourceIdentity?.userSeed ?? 0,
    take: sourceIdentity?.take ?? 0,
    density: generationDensity(input),
    seed,
  };
  const profile = profileFor(input);
  const sections = sectionWindows(input);
  const phraseWindowsForPlan = input.context.template.pianoEligible ? phraseWindows(input, sections) : [];
  const motif = input.context.template.pianoEligible ? chooseMotif(input, profile) : null;
  const fillPlans = input.context.template.pianoEligible ? fillDecisions(input, analyzer, sections, profile) : [];
  const phrasePlans: PianoPhraseIntention[] = [];
  let previousOperation: PianoMotifOperation | null = null;
  let previousTexture: PianoTextureKind | null = null;
  for (const [index, phrase] of phraseWindowsForPlan.entries()) {
    const reading = orchestrationReading(input, analyzer, phrase.startTick, phrase.endTick);
    // Texture progression belongs to one section; motif identity may continue
    // across sections, but the accompaniment surface must be re-established.
    const precedingSectionTexture = phrase.firstInSection ? null : previousTexture;
    const plan = composePhraseIntention(input, phrase, index, motif, profile, reading,
      previousOperation, precedingSectionTexture, fillPlans);
    phrasePlans.push(plan);
    if (plan.motif.operation !== 'unavailable') previousOperation = plan.motif.operation;
    previousTexture = plan.texture.kind;
  }
  const sectionIntentions = input.context.template.pianoEligible
    ? sections.map((section, index) => sectionIntention(section, index, sections.length, phrasePlans, input))
    : [];
  const harmonicEvents = input.context.template.pianoEligible
    ? composeHarmonicEvents(input, analyzer, phraseWindowsForPlan, phrasePlans, fillPlans, profile)
    : [];
  const status: PianoPlanStatus = !input.context.template.pianoEligible
    ? 'ineligible'
    : input.context.harmony.length ? 'composed' : 'insufficient-harmony';
  const ending = endingPlan(harmonicEvents, input.context.template.pianoEligible);
  const limitations = [
    'This is the symbolic intention layer: composePianoScore materializes it as actual MIDI pitches, note durations, velocities, and articulations before realization.',
    'Texture labels, roles, purposes, and transitions are supporting Composer decisions; note-level timing, register, hand, and voice choices are recorded separately in PianoScore.',
    'The input has no key/mode or time-signature field; harmony is interpreted only from resolved chord symbols and pitch classes, and rhythmic cells remain relative.',
    'Written-note facts remain separate from the production mute/solo/lock/band gate; Composer visibility is known, but exact loudness, volume, and time-varying CC7 are not inferred.',
    'Only strings lead layers and the supplied tutti/soli/unison moments are available; other family lead spans and divisi/imitation details remain unavailable.',
    'Writing-phrase boundaries use supplied sections, moments/fill reservations, established energy turns, and exact near-silence bar edges; salient interior energy reversals remain dynamic-only segments.',
    'V5 identity hashes the orchestration seed, ComposeOptions seed, take, and clamped density; Piano stays metrically gridded, so the generic humanize flag is not part of its identity.',
    ...(input.context.template.pianoEligible ? [] : ['The resolved template/write-eligibility gate says piano is not eligible; no piano material is planned.']),
    ...(!input.context.harmony.length ? ['No resolved chord spans were supplied; harmonic voicings, motif and ending are unavailable.'] : []),
  ];

  return freezePlan({
    version: 2,
    status,
    generationIdentity,
    seed: input.context.seed,
    template: {
      id: input.context.template.id,
      eligible: input.context.template.pianoEligible,
      style: profile.public,
    },
    templateConstraints: {
      octaveDoubling: octaveRule(input),
      pianoFillGatingRules: fillRules(input),
      fillSource: 'explicit-conductor-windows-only',
    },
    sectionIntentions,
    phrases: phrasePlans,
    motif,
    harmonicEvents,
    fillDecisions: fillPlans,
    attackRestrictions: input.context.template.pianoEligible ? attackRestrictions(input) : [],
    structuralEvents: input.context.template.pianoEligible ? structuralEvents(input, sections, harmonicEvents) : [],
    ending,
    limitations,
    containsMidiNotes: false,
  });
}

/* ---------------- Stage 1: note-level score writing ---------------- */

const SCORE_REGISTER_WINDOWS: Readonly<Record<PianoRegisterZone, readonly [number, number]>> = {
  bass: [29, 55],
  'low-middle': [40, 63],
  middle: [50, 76],
  'upper-middle': [60, 88],
  high: [70, 101],
};
const SCORE_VELOCITIES: readonly number[] = [30, 38, 48, 61, 75, 91];
const SCORE_VOICES: readonly PianoScoreVoiceId[] = ['lh.bass', 'lh.support', 'rh.inner', 'rh.melody', 'rh.suspension', 'rh.octave'];

const scorePc = (value: number): number => ((value % 12) + 12) % 12;
const scorePcDistance = (a: number, b: number): number => {
  const distance = Math.abs(scorePc(a) - scorePc(b));
  return Math.min(distance, 12 - distance);
};
const scoreClamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const scoreEndOf = (event: PianoScoreEvent): number => event.startTick + event.durationTicks;

function scoreRange(zone: PianoRegisterZone, target: PianoScoreTarget): [number, number] {
  const window = SCORE_REGISTER_WINDOWS[zone];
  const low = Math.max(target.lowestNote, window[0]);
  const high = Math.min(target.highestNote, window[1]);
  return low <= high ? [low, high] : [target.lowestNote, target.highestNote];
}

function scorePitchesForClasses(classes: readonly number[], range: readonly [number, number]): number[] {
  const pitchClasses = new Set(classes.map(scorePc));
  const notes: number[] = [];
  for (let pitch = Math.ceil(range[0]); pitch <= Math.floor(range[1]); pitch++) {
    if (pitchClasses.has(scorePc(pitch))) notes.push(pitch);
  }
  return notes;
}

function uniquePitchClasses(values: readonly number[]): number[] {
  return [...new Set(values.map(scorePc))];
}

function chooseLeftHandPair(
  event: PianoHarmonicEvent,
  target: PianoScoreTarget,
  previousBass: number | null,
  excludedBassPitchClasses: readonly number[] = [],
): { bass: number | null; support: number | null } {
  const bassRange = scoreRange(event.hands.left.register, target);
  const supportRange: [number, number] = [Math.max(target.lowestNote, 40), Math.min(target.highestNote, 67)];
  const actualSupportRange = supportRange[0] <= supportRange[1]
    ? supportRange
    : [target.lowestNote, target.highestNote] as [number, number];
  const tones = uniquePitchClasses(event.chord.availablePitchClasses);
  const excludedBass = new Set(excludedBassPitchClasses.map(scorePc));
  const requestedBassPc = scorePc(event.voicing.leftHandBassPitchClass);
  const bassPitchClasses = uniquePitchClasses([
    ...(excludedBass.has(requestedBassPc) ? tones.filter((tone) => !excludedBass.has(tone)) : [requestedBassPc]),
    ...(previousBass !== null && tones.includes(scorePc(previousBass)) && !excludedBass.has(scorePc(previousBass))
      ? [scorePc(previousBass)] : []),
  ]);
  const basses = scorePitchesForClasses(bassPitchClasses, bassRange);
  const supports = scorePitchesForClasses(tones.filter((tone) => tone !== scorePc(event.voicing.leftHandBassPitchClass)), actualSupportRange);
  if (!basses.length) return { bass: null, support: null };
  const preferredBass = previousBass ?? (bassRange[0] + bassRange[1]) / 2;
  const pairs = basses.flatMap((bass) => supports
    .filter((support) => support > bass && scorePc(support) !== scorePc(bass))
    .map((support) => ({
      bass,
      support,
      span: support - bass,
      cost: Math.abs(bass - preferredBass) * 1.25
        + Math.abs((support - bass) - 7) * 1.8
        + Math.abs(support - 51) * 0.12
        + (support - bass > 12 ? 24 : 0),
    })));
  pairs.sort((a, b) => a.cost - b.cost || a.bass - b.bass || a.support - b.support);
  if (pairs.length) return { bass: pairs[0].bass, support: pairs[0].support };
  const bass = [...basses].sort((a, b) => Math.abs(a - preferredBass) - Math.abs(b - preferredBass) || a - b)[0];
  return { bass, support: null };
}

function chooseScorePitch(options: {
  pitchClasses: readonly number[];
  range: readonly [number, number];
  preferredMidi: number;
  previousMidi: number | null;
  desiredPitchClass?: number | null;
  minimumPitch?: number;
  maximumPitch?: number;
  excluded?: readonly number[];
}): number | null {
  const { pitchClasses, range, preferredMidi, previousMidi, desiredPitchClass } = options;
  let candidates = scorePitchesForClasses(pitchClasses, range)
    .filter((pitch) => !options.excluded?.includes(pitch));
  if (options.minimumPitch !== undefined) candidates = candidates.filter((pitch) => pitch >= options.minimumPitch!);
  if (options.maximumPitch !== undefined) candidates = candidates.filter((pitch) => pitch <= options.maximumPitch!);
  if (!candidates.length && (options.minimumPitch !== undefined || options.maximumPitch !== undefined)) {
    candidates = scorePitchesForClasses(pitchClasses, range).filter((pitch) => !options.excluded?.includes(pitch));
  }
  if (!candidates.length) return null;
  const previous = previousMidi;
  candidates.sort((a, b) => {
    const cost = (pitch: number) => {
      const motion = previous === null ? Math.abs(pitch - preferredMidi) * 0.35 : Math.abs(pitch - previous) * 1.1;
      const center = Math.abs(pitch - preferredMidi) * 0.18;
      const contour = desiredPitchClass === undefined || desiredPitchClass === null
        ? 0 : scorePcDistance(pitch, desiredPitchClass) * 2.2;
      const leap = previous !== null && Math.abs(pitch - previous) > 12 ? 12 : 0;
      return motion + center + contour + leap;
    };
    return cost(a) - cost(b) || a - b;
  });
  return candidates[0];
}

type PianoMotifCellVariation = NonNullable<PianoPhraseIntention['rhythmicPlan']['motifCells']>[number]['variation'];

interface PianoMotifAttack {
  readonly phrase: PianoPhraseIntention;
  readonly cellIndex: number;
  readonly cellStartTick: number;
  readonly cellEndTick: number;
  readonly variation: PianoMotifCellVariation;
  readonly contour: readonly number[];
  readonly position: 0 | 1 | 2 | 3;
  readonly startTick: number;
  readonly source: PianoHarmonicEvent;
}

interface PianoWrittenMelodyEvent extends PianoMotifAttack {
  readonly pitch: number;
  readonly isTension: boolean;
  readonly resolvesAtTick: number | null;
}

function scoreQuantizeToGrid(tick: number, gridTicks: number): number {
  const grid = Math.max(1, Math.round(gridTicks));
  return Math.round(tick / grid) * grid;
}

function normalizedScoreWeights(weights: readonly number[], fallback: readonly number[]): number[] {
  const source = weights.length === 4 ? weights : fallback;
  const safe = Array.from({ length: 4 }, (_, index) => {
    const value = source[index];
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
  const total = safe.reduce((sum, value) => sum + value, 0);
  return total > 0 ? safe.map((value) => value / total) : [0.25, 0.25, 0.25, 0.25];
}

function isAnticipatedMotifAttack(attack: PianoMotifAttack, motif: PianoMotifPlan): boolean {
  const syncopation = attack.phrase.rhythmicPlan.syncopation;
  if (!syncopation || syncopation.displacedPosition !== attack.position || syncopation.offsetTicks >= 0) return false;
  const gridTicks = Math.max(1, attack.phrase.rhythmicPlan.gridTicks ?? PPQ / 2);
  const weights = normalizedScoreWeights(attack.phrase.rhythmicPlan.weights, motif.rhythmicWeights);
  const offsets = [0, weights[0], weights[0] + weights[1], weights[0] + weights[1] + weights[2]];
  const firstGridTick = Math.ceil(attack.cellStartTick / gridTicks) * gridTicks;
  const lastGridTick = Math.floor((attack.cellEndTick - 1) / gridTicks) * gridTicks;
  if (lastGridTick < firstGridTick) return false;
  const unshifted = scoreClamp(scoreQuantizeToGrid(
    attack.cellStartTick + offsets[attack.position] * (attack.cellEndTick - attack.cellStartTick), gridTicks,
  ), firstGridTick, lastGridTick);
  return attack.startTick < unshifted;
}

function motifContourForCell(motif: PianoMotifPlan, variation: PianoMotifCellVariation): number[] {
  const tones = [...motif.tones].sort((a, b) => a.position - b.position);
  const fallback = tones.slice(0, 3).map((tone, index) =>
    signedPcMotion(tone.pitchClass, tones[index + 1]?.pitchClass ?? tone.pitchClass));
  const contour = Array.from({ length: 3 }, (_, index) => Math.round(
    Number.isFinite(motif.intervalContour[index]) ? motif.intervalContour[index] : fallback[index] ?? 0,
  ));
  if (variation === 'reframe') return contour.map((interval) => -interval);
  if (variation === 'expansion') {
    const first = contour[0];
    const direction = first === 0 ? 1 : Math.sign(first);
    contour[0] = direction * Math.min(8, Math.abs(first) + (Math.abs(first) >= 6 ? 1 : 2));
  }
  return contour;
}

function motifPitchCandidates(
  pitchClasses: readonly number[],
  source: PianoHarmonicEvent,
  target: PianoScoreTarget,
  innerPitch: number | null,
  bassPitch: number | null,
  supportPitch: number | null,
  simultaneousRightPitches: readonly number[] = [],
): number[] {
  const range = scoreRange(source.hands.right.register, target);
  const excluded = new Set([innerPitch, bassPitch, supportPitch].filter((pitch): pitch is number => pitch !== null));
  const all = scorePitchesForClasses(pitchClasses, range).filter((pitch) => !excluded.has(pitch));
  const min = Math.max(range[0], innerPitch !== null ? innerPitch + 3 : supportPitch !== null ? supportPitch + 7 : range[0]);
  const max = innerPitch !== null ? Math.min(range[1], innerPitch + 12) : range[1];
  const separated = all.filter((pitch) => pitch >= min && pitch <= max);
  const handSafe = separated.filter((pitch) => simultaneousRightPitches.every((active) => Math.abs(pitch - active) <= 12));
  if (simultaneousRightPitches.length && !handSafe.length) return [];
  return handSafe.length ? handSafe : separated.length ? separated : all;
}

function chooseMotifPitch(options: {
  readonly candidates: readonly number[];
  readonly desiredMidi: number;
  readonly previousMidi: number | null;
  readonly preferredPitchClass?: number | null;
  readonly preferDownward?: boolean;
}): number | null {
  if (!options.candidates.length) return null;
  const previous = options.previousMidi;
  const sorted = [...new Set(options.candidates)];
  sorted.sort((a, b) => {
    const cost = (pitch: number) => {
      const leap = previous === null ? 0 : Math.abs(pitch - previous);
      const contour = Math.abs(pitch - options.desiredMidi) * 0.8;
      const motion = previous === null ? 0 : leap * 0.48 + Math.max(0, leap - 8) * 0.45;
      const targetClass = options.preferredPitchClass ?? scorePc(options.desiredMidi);
      const pitchClass = scorePcDistance(pitch, targetClass) * 3.4;
      const repeat = previous === pitch
        ? scorePc(previous) === targetClass ? 1.5 : 9
        : previous !== null && scorePc(previous) === scorePc(pitch)
          ? scorePc(previous) === targetClass ? 0.35 : 2.5
          : 0;
      const downward = options.preferDownward && previous !== null && pitch > previous
        ? 1.5 + (pitch - previous) * 0.12 : 0;
      return contour + motion + pitchClass + repeat + downward;
    };
    return cost(a) - cost(b) || a - b;
  });
  return sorted[0];
}

function scoreDynamicIntent(
  event: PianoHarmonicEvent,
  role: PianoMusicalRole,
): PianoScoreEvent['dynamicIntent'] {
  const intensity = scoreClamp(event.dynamicIntent.intensity, 0, 5);
  const base = SCORE_VELOCITIES[Math.round(intensity)] ?? SCORE_VELOCITIES[2];
  const roleOffset = role === 'bass' ? -2 : role === 'support' ? -7 : role === 'inner' ? -3 : role === 'melody' ? 2 : 0;
  return {
    intensity,
    velocity: Math.round(scoreClamp(base + roleOffset, 1, 127)),
    phraseShape: event.dynamicIntent.gesture,
    sourceEnergyTarget: event.dynamicIntent.sourceEnergyTarget,
  };
}

function scoreHarmonicContext(event: PianoHarmonicEvent): PianoScoreEvent['harmonicContext'] {
  return {
    chordIds: [event.chord.id],
    chordSymbols: [event.chord.symbol],
    pitchClasses: uniquePitchClasses(event.chord.availablePitchClasses),
    quality: event.chord.quality,
  };
}

function mergedScoreHarmonicContext(
  previous: PianoScoreEvent['harmonicContext'],
  next: PianoScoreEvent['harmonicContext'],
): PianoScoreEvent['harmonicContext'] {
  return {
    chordIds: [...new Set([...previous.chordIds, ...next.chordIds])],
    chordSymbols: [...new Set([...previous.chordSymbols, ...next.chordSymbols])],
    pitchClasses: uniquePitchClasses([...previous.pitchClasses, ...next.pitchClasses]),
    quality: [...new Set([previous.quality, next.quality])].join(' / '),
  };
}

function scoreAttackAllowed(plan: PianoComposerPlan, tick: number, plannedSuspension = false): boolean {
  const explicitLeave = plan.fillDecisions.some((decision) => decision.target.toLowerCase() === 'piano'
    && decision.decision === 'leave-space'
    && tick >= decision.startTick && tick < decision.endTick);
  if (explicitLeave) return false;
  if (plannedSuspension) return true;
  return !plan.attackRestrictions.some((window) => tick >= window.startTick && tick < window.endTick);
}

type PianoScoreFigureKind =
  | 'sustained'
  | 'broken-chords'
  | 'arpeggiated'
  | 'dialogue'
  | 'pulse'
  | 'flourish'
  | 'alberti-bass'
  | 'walking-bass'
  | 'ostinato';

interface PianoScoreFigureTicks {
  readonly kind: PianoScoreFigureKind;
  readonly bass: readonly number[];
  readonly support: readonly number[];
  readonly inner: readonly number[];
}

function scoreFigureKind(
  phrase: PianoPhraseIntention | null,
  event: PianoHarmonicEvent,
  identity: PianoTemplateIdentity,
  plan: PianoComposerPlan,
): PianoScoreFigureKind {
  const hybridPulseUnderLead = identity === 'hybrid-pulse-and-color'
    && event.orchestration.explicitLeadTrackIds.length > 0
    && event.hands.right.role.toLowerCase().includes('pulse')
    && event.orchestration.interaction === 'interweave';
  if (event.dynamicIntent.sourceEnergyNearSilence
    || event.hands.left.motion === 'yield'
    || event.hands.right.motion === 'yield'
    || event.orchestration.interaction === 'yield-to-spotlight'
    || event.orchestration.interaction === 'leave-space') return 'sustained';
  if (hybridPulseUnderLead) return 'pulse';

  let baseKind: PianoScoreFigureKind;
  switch (phrase?.texture.kind ?? 'sparse-sustained') {
    case 'broken-chords':
      baseKind = 'broken-chords';
      break;
    case 'arpeggiated':
      baseKind = identity === 'hybrid-pulse-and-color' ? 'pulse' : 'arpeggiated';
      break;
    case 'melody-accompaniment':
      baseKind = identity === 'hybrid-pulse-and-color' ? 'pulse'
        : identity === 'cinematic-expanse' ? 'arpeggiated' : 'broken-chords';
      break;
    case 'contrapuntal-dialogue':
      baseKind = 'dialogue';
      break;
    case 'short-flourishes':
      baseKind = 'flourish';
      break;
    case 'block-chords':
    case 'sparse-sustained':
    default:
      baseKind = 'sustained';
      break;
  }

  const occupancy = event.orchestration.registerOccupancy;
  const accompanimentActivity = event.orchestration.accompanimentActivity;
  const observedBassFoundation = accompanimentActivity?.availability === 'available'
    ? accompanimentActivity.bassFoundationTrackIds.length > 0
    : (accompanimentActivity?.bassFoundationTrackIds.length ?? 0) > 0
      || (event.orchestration.activeRoles ?? []).some((role) => PIANO_BASS_FOUNDATION_ROLES.has(role));
  const exactActivityAvailable = accompanimentActivity
    ? accompanimentActivity.availability === 'available'
      && accompanimentActivity.activeNotesPerBar.total !== null
    : event.orchestration.analyzerEvidence === 'available' && occupancy?.availability === 'available';
  const localSupportActivity = accompanimentActivity?.activeNotesPerBar.pianoSupport ?? null;
  const localUpperActivity = accompanimentActivity?.activeNotesPerBar.pianoUpper ?? null;
  const localRegistersCrowded = (localSupportActivity !== null && localSupportActivity >= 6)
    || (localUpperActivity !== null && localUpperActivity >= 8);
  const lowFoundationIsClear = exactActivityAvailable && !observedBassFoundation
    && (accompanimentActivity
      ? (accompanimentActivity.activeNotesPerBar.pianoBass ?? Number.POSITIVE_INFINITY) <= 2.25
      : occupancy?.availability === 'available' && occupancy.low <= 2.25);
  const nonLeadMidUpperActivity = accompanimentActivity?.midUpperActivityTrackIds
    .some((trackId) => !event.orchestration.explicitLeadTrackIds.includes(trackId)) ?? false;
  if (baseKind === 'dialogue' && nonLeadMidUpperActivity) baseKind = 'broken-chords';

  // Stage 4 patterns remain optional: they need a locally open bass register,
  // complete Analyzer activity evidence, and the existing phrase/energy gates.
  const usableContext = phrase !== null
    && (phrase.intendedDensity === 'moderate' || phrase.intendedDensity === 'broad')
    && phrase.function !== 'release'
    && phrase.function !== 'arrival'
    && phrase.function !== 'statement-and-landing'
    && !event.dynamicIntent.sourceEnergyNearSilence
    && (event.dynamicIntent.sourceEnergyTarget ?? 0) >= 0.42
    && event.dynamicIntent.intensity >= 2
    && event.orchestration.explicitLeadTrackIds.length === 0
    && event.orchestration.momentKinds.length === 0
    && event.orchestration.analyzerEvidence !== 'unavailable'
    && !localRegistersCrowded
    && lowFoundationIsClear
    && event.chord.endTick - event.chord.startTick >= 4 * PPQ;
  if (!usableContext || !phrase) return baseKind;

  const selection = unitRandom(plan.seed, `score-accompaniment-vocabulary:${phrase.id}`);
  if ((identity === 'chamber-counterpoint' || identity === 'sonata-dialogue')
    && baseKind === 'broken-chords'
    && selection < 0.22) return 'alberti-bass';
  if ((identity === 'sonata-dialogue' || identity === 'hybrid-pulse-and-color')
    && (baseKind === 'broken-chords' || baseKind === 'pulse')
    && event.dynamicIntent.intensity >= 3
    && selection >= 0.22 && selection < 0.42) return 'walking-bass';
  if (identity === 'hybrid-pulse-and-color'
    && baseKind === 'pulse'
    && phrase.texture.kind === 'melody-accompaniment'
    && selection >= 0.22 && selection < 0.52) return 'ostinato';
  return baseKind;
}

function spacedScoreTicks(
  startTick: number,
  endTick: number,
  offsetTicks: number,
  stepTicks: number,
  gridTicks: number,
  limit: number,
): number[] {
  const grid = Math.max(1, Math.round(gridTicks));
  const step = Math.max(grid, Math.round(stepTicks / grid) * grid);
  const first = Math.ceil((startTick + Math.max(0, offsetTicks)) / grid) * grid;
  const ticks: number[] = [];
  for (let tick = first; tick < endTick && ticks.length < limit; tick += step) {
    if (tick >= startTick) ticks.push(tick);
  }
  return ticks;
}

function scoreFigureTicks(
  kind: PianoScoreFigureKind,
  startTick: number,
  endTick: number,
  phrase: PianoPhraseIntention | null,
  event: PianoHarmonicEvent,
  identity: PianoTemplateIdentity,
  density: number,
  plan: PianoComposerPlan,
): PianoScoreFigureTicks {
  const grid = Math.max(1, phrase?.rhythmicPlan.gridTicks ?? PPQ / 2);
  const isSparse = density < 0.35 || phrase?.intendedDensity === 'very-sparse'
    || event.hands.right.density === 'very-sparse';
  const hybridLeadPulse = kind === 'pulse' && identity === 'hybrid-pulse-and-color'
    && event.orchestration.explicitLeadTrackIds.length > 0
    && event.hands.right.role.toLowerCase().includes('pulse');
  const repetitionLimit = isSparse ? (hybridLeadPulse ? 1 : 0)
    : density < 0.55 ? 2 : density < 0.8 ? 3 : 4;
  const base = {
    bass: [startTick],
    support: [startTick],
    inner: [startTick],
  };
  if (kind === 'sustained' || (isSparse && !hybridLeadPulse)) {
    return { kind: 'sustained', bass: base.bass, support: base.support, inner: base.inner };
  }

  const styleStep = identity === 'hybrid-pulse-and-color' || identity === 'sonata-dialogue'
    ? PPQ : identity === 'vocal-space' ? 4 * PPQ : 2 * PPQ;
  const step = Math.max(styleStep, density < 0.45 ? styleStep * 2 : styleStep);
  const bass = [...base.bass];
  const support = [...base.support];
  const inner = [...base.inner];

  if (kind === 'pulse' || kind === 'ostinato') {
    bass.push(...spacedScoreTicks(startTick, endTick, step, step, grid, repetitionLimit));
    support.push(...spacedScoreTicks(startTick, endTick, Math.max(grid, PPQ / 2), step, grid,
      Math.min(3, repetitionLimit)));
  } else if (kind === 'alberti-bass') {
    const span = endTick - startTick;
    const stride = Math.max(PPQ, Math.round((span / 4) / grid) * grid);
    support.push(...spacedScoreTicks(startTick, endTick, stride, stride, grid, Math.min(3, repetitionLimit)));
  } else if (kind === 'walking-bass') {
    bass.push(...spacedScoreTicks(startTick, endTick, PPQ, PPQ, grid, Math.min(3, repetitionLimit)));
  } else if (kind === 'broken-chords') {
    const answerOffset = identity === 'chamber-counterpoint' ? 2 * PPQ : PPQ;
    support.push(...spacedScoreTicks(startTick, endTick, answerOffset, 2 * PPQ, grid, Math.min(2, repetitionLimit || 1)));
    inner.push(...spacedScoreTicks(startTick, endTick, answerOffset + PPQ, 4 * PPQ, grid, 1));
  } else if (kind === 'arpeggiated') {
    support.push(...spacedScoreTicks(startTick, endTick, step, step, grid, repetitionLimit));
    inner.push(...spacedScoreTicks(startTick, endTick, PPQ, 2 * PPQ, grid, Math.min(2, repetitionLimit)));
  } else if (kind === 'dialogue') {
    const responseOffset = identity === 'sonata-dialogue' ? PPQ : 2 * PPQ;
    support.push(...spacedScoreTicks(startTick, endTick, responseOffset, 2 * PPQ, grid, Math.min(2, repetitionLimit || 1)));
    inner.push(...spacedScoreTicks(startTick, endTick, responseOffset + PPQ, 4 * PPQ, grid, 1));
  } else if (kind === 'flourish') {
    const fillTicks = plan.fillDecisions
      .filter((decision) => decision.target.toLowerCase() === 'piano'
        && decision.decision === 'consider-brief-gesture'
        && intersects(decision.startTick, decision.endTick, startTick, endTick))
      .flatMap((decision) => spacedScoreTicks(
        Math.max(startTick, decision.startTick), Math.min(endTick, decision.endTick),
        grid, Math.max(grid, PPQ / 2), grid, Math.min(3, Math.max(1, repetitionLimit)),
      ));
    inner.push(...fillTicks);
  }

  const allowed = (ticks: readonly number[]) => [...new Set(ticks)]
    .filter((tick) => tick >= startTick && tick < endTick && scoreAttackAllowed(plan, tick))
    .sort((a, b) => a - b);
  return {
    kind,
    bass: allowed(bass),
    support: allowed(support),
    inner: allowed(inner),
  };
}

function scoreBassPatternPitch(
  event: PianoHarmonicEvent,
  target: PianoScoreTarget,
  previousMidi: number | null,
  position: number,
  excludedPitchClasses: readonly number[],
  kind: PianoScoreFigureKind,
  basePitch: number,
  finalPatternAttack: boolean,
  nextChordRootPitchClass: number | null,
): number | null {
  const range = scoreRange(event.hands.left.register, target);
  const excluded = new Set(excludedPitchClasses.map(scorePc));
  const available = uniquePitchClasses(event.chord.availablePitchClasses)
    .filter((tone) => !excluded.has(tone));
  if (!available.length) return null;
  if (kind === 'ostinato' && available.includes(scorePc(basePitch))) return basePitch;

  const root = scorePc(event.chord.rootPitchClass);
  const fifth = scorePc(root + 7);
  if (kind === 'walking-bass') {
    let candidates = scorePitchesForClasses(available, range);
    if (!candidates.length) return null;
    if (finalPatternAttack && nextChordRootPitchClass !== null) {
      const nextRoots = scorePitchesForClasses([nextChordRootPitchClass], range);
      const approaches = candidates.filter((pitch) => nextRoots.some((next) => Math.abs(next - pitch) <= 2));
      if (approaches.length) candidates = approaches;
    }
    if (previousMidi !== null) {
      const stepwise = candidates.filter((pitch) => pitch !== previousMidi && Math.abs(pitch - previousMidi) <= 5);
      if (stepwise.length) candidates = stepwise;
    }
    candidates.sort((a, b) => {
      const cost = (pitch: number) => Math.abs(pitch - (previousMidi ?? basePitch))
        + (pitch === previousMidi ? 9 : 0)
        + (finalPatternAttack && nextChordRootPitchClass !== null
          ? scorePcDistance(pitch, nextChordRootPitchClass) * 0.35 : 0)
        + (Math.abs(pitch - (previousMidi ?? basePitch)) > 7 ? 8 : 0);
      return cost(a) - cost(b) || a - b;
    });
    return candidates[0];
  }

  const preferredClass = position % 2 === 1 && available.includes(fifth)
    ? fifth : available.includes(root) ? root
      : available.includes(scorePc(event.voicing.leftHandBassPitchClass))
        ? scorePc(event.voicing.leftHandBassPitchClass) : available[0];
  const preferredClasses = scorePitchesForClasses([preferredClass], range).length
    ? [preferredClass] : available;
  return chooseScorePitch({
    pitchClasses: preferredClasses,
    range,
    preferredMidi: previousMidi ?? (range[0] + range[1]) / 2,
    previousMidi,
    desiredPitchClass: preferredClass,
  });
}

function scoreSupportPatternPitch(
  event: PianoHarmonicEvent,
  target: PianoScoreTarget,
  bassPitch: number,
  previousMidi: number | null,
  position: number,
  kind: PianoScoreFigureKind,
  ascending: boolean,
  octaveDoubling: PianoComposerPlan['templateConstraints']['octaveDoubling'],
  fallback: number | null,
): number | null {
  const low = Math.max(target.lowestNote, 40, bassPitch + 3);
  const high = Math.min(target.highestNote, 67, bassPitch + 12);
  const fallbackAllowed = fallback !== null && fallback !== bassPitch
    && (octaveDoubling !== 'forbidden' || scorePc(fallback) !== scorePc(bassPitch));
  if (low > high) return fallbackAllowed ? fallback : null;
  const range: [number, number] = [low, high];
  const tones = uniquePitchClasses(event.chord.availablePitchClasses)
    .filter((tone) => octaveDoubling !== 'forbidden' || tone !== scorePc(bassPitch));
  const candidates = scorePitchesForClasses(tones, range).filter((pitch) => pitch !== bassPitch);
  if (!candidates.length) return fallbackAllowed ? fallback : null;

  if (kind === 'ostinato' && fallbackAllowed) return fallback;

  if (kind === 'alberti-bass' && candidates.length > 1) {
    const ordered = [...candidates].sort((a, b) => a - b);
    const positions = [ordered.length - 1, 0, Math.floor((ordered.length - 1) / 2), ordered.length - 1];
    const selected = ordered[positions[position % positions.length]];
    if (selected !== undefined) return selected;
  }

  if (kind === 'arpeggiated' && candidates.length > 1) {
    const ordered = [...candidates].sort((a, b) => a - b);
    const startIndex = Math.max(0, ordered.indexOf(fallback ?? previousMidi ?? ordered[0]));
    const direction = ascending ? 1 : -1;
    const rawIndex = startIndex + direction * position;
    return ordered[((rawIndex % ordered.length) + ordered.length) % ordered.length];
  }

  const preferredClass = tones.length ? tones[(position + (ascending ? 0 : tones.length - 1)) % tones.length] : undefined;
  return chooseScorePitch({
    pitchClasses: tones,
    range,
    preferredMidi: previousMidi ?? (range[0] + range[1]) / 2,
    previousMidi,
    desiredPitchClass: preferredClass,
    excluded: [bassPitch],
  }) ?? (fallbackAllowed ? fallback : null);
}

function shouldWriteClimaxOctave(
  input: PianoEngineInput,
  phrase: PianoPhraseIntention,
  source: PianoHarmonicEvent,
  isLastPhraseAttack: boolean,
): boolean {
  if (!isLastPhraseAttack || source.dynamicIntent.sourceEnergyNearSilence
    || source.orchestration.explicitLeadTrackIds.length > 0) return false;
  const rule = input.context.rules.find((candidate) => candidate.type === 'octaveDoubling');
  if (!rule || rule.policy === 'forbidden') return false;
  const energy = source.dynamicIntent.sourceEnergyTarget;
  if (energy === null || !Number.isFinite(energy) || source.dynamicIntent.intensity < 3) return false;
  const prominent = phrase.function === 'arrival'
    || phrase.function === 'statement-and-landing'
    || source.structuralRole === 'arrival'
    || source.orchestration.momentKinds.some((kind) => kind === 'tutti' || kind === 'unison');
  if (!prominent) return false;
  const threshold = rule.policy === 'climaxOnly' ? rule.energyThreshold ?? 1 : 0.72;
  return energy >= threshold;
}

function scoreOctavePitchFitsHand(
  events: readonly PianoScoreEvent[],
  pitch: number,
  startTick: number,
  endTick: number,
  target: PianoScoreTarget,
): boolean {
  if (pitch < target.lowestNote || pitch > target.highestNote || endTick <= startTick) return false;
  const overlappingEvents = events.filter((event) => event.startTick < endTick && scoreEndOf(event) > startTick);
  if (overlappingEvents.some((event) => event.pitch === pitch)) return false;
  const overlapping = overlappingEvents.filter((event) => event.hand === 'right');
  const boundaries = [...new Set([startTick, ...overlapping.flatMap((event) =>
    [Math.max(startTick, event.startTick), Math.min(endTick, scoreEndOf(event))])])]
    .filter((tick) => tick >= startTick && tick < endTick)
    .sort((a, b) => a - b);
  for (const tick of boundaries) {
    const active = overlapping.filter((event) => event.startTick <= tick && scoreEndOf(event) > tick);
    const pitches = [...new Set([...active.map((event) => event.pitch), pitch])].sort((a, b) => a - b);
    if (pitches.length > 4 || pitches[pitches.length - 1] - pitches[0] > 12) return false;
  }
  return true;
}

function avoidScoreUnisonRearticulation(events: readonly PianoScoreEvent[]): PianoScoreEvent[] {
  const priority: Readonly<Record<PianoScoreVoiceId, number>> = {
    'lh.support': 1,
    'rh.inner': 2,
    'lh.bass': 3,
    'rh.melody': 4,
    'rh.suspension': 5,
    'rh.octave': 6,
  };
  const ordered = [...events].sort((a, b) => priority[b.voiceId] - priority[a.voiceId]
    || a.startTick - b.startTick || a.id.localeCompare(b.id));
  const accepted: PianoScoreEvent[] = [];
  for (const event of ordered) {
    let endTick = scoreEndOf(event);
    let suppress = false;
    for (const higher of accepted) {
      if (higher.pitch !== event.pitch || higher.startTick >= endTick || scoreEndOf(higher) <= event.startTick) continue;
      if (higher.startTick <= event.startTick) {
        suppress = true;
        break;
      }
      endTick = Math.min(endTick, higher.startTick);
    }
    if (suppress || endTick <= event.startTick) continue;
    accepted.push(endTick === scoreEndOf(event)
      ? event : { ...event, durationTicks: endTick - event.startTick });
  }
  return accepted;
}

function scoreRests(plan: PianoComposerPlan, events: readonly PianoScoreEvent[], projectEndTick: number): PianoScoreRest[] {
  const rests: PianoScoreRest[] = [];
  for (const phrase of plan.phrases) {
    const phraseStart = Math.min(projectEndTick, Math.max(0, phrase.startTick));
    const phraseEnd = Math.min(projectEndTick, Math.max(phraseStart, phrase.endTick));
    for (const voiceId of SCORE_VOICES) {
      const line = events.filter((event) => event.voiceId === voiceId && event.phraseId === phrase.id)
        .map((event) => ({ start: Math.max(phraseStart, event.startTick), end: Math.min(phraseEnd, scoreEndOf(event)) }))
        .filter((interval) => interval.end > interval.start)
        .sort((a, b) => a.start - b.start || a.end - b.end);
      let cursor = phraseStart;
      const addRest = (startTick: number, endTick: number) => {
        if (endTick <= startTick) return;
        const explicitLeave = plan.fillDecisions.some((decision) => decision.target.toLowerCase() === 'piano'
          && decision.decision === 'leave-space' && startTick < decision.endTick && decision.startTick < endTick);
        const gated = plan.attackRestrictions.some((window) => startTick < window.endTick && window.startTick < endTick);
        rests.push({
          hand: voiceId.startsWith('lh.') ? 'left' : 'right',
          voiceId,
          startTick,
          endTick,
          phraseId: phrase.id,
          sectionId: phrase.sectionId,
          reason: explicitLeave ? 'explicit-leave-space' : gated ? 'attack-restriction' : 'phrase-space',
        });
      };
      for (const interval of line) {
        if (interval.start > cursor) addRest(cursor, interval.start);
        cursor = Math.max(cursor, interval.end);
      }
      if (cursor < phraseEnd) addRest(cursor, phraseEnd);
    }
  }
  return rests;
}

/**
 * Legacy per-chord foundation writer (Stages 1-4A). Production no longer uses
 * its bass, support, inner or motif-cell notes: `composePianoScore` writes the
 * Texture-and-Theme composition and borrows only this writer's prepared
 * suspension voice. It is retained for that voice and for the regression
 * tests that pin the earlier voice-leading and contextual-technique rules.
 */
export function composePianoFoundationScore(
  input: PianoEngineInput,
  plan: PianoComposerPlan,
  target: PianoScoreTarget | null,
  projectEndTick: number,
): PianoScore {
  const validEnd = Number.isInteger(projectEndTick) && projectEndTick > 0 ? projectEndTick : 0;
  const validTarget = target !== null
    && target.family === 'Keys'
    && target.role === 'piano'
    && !target.locked
    && Number.isInteger(target.lowestNote)
    && Number.isInteger(target.highestNote)
    && target.lowestNote >= 0
    && target.highestNote <= 127
    && target.lowestNote <= target.highestNote;
  const empty = () => createPianoScore({
    generationIdentity: plan.generationIdentity,
    templateId: plan.template.id,
    projectEndTick: validEnd,
    events: [],
    rests: [],
  });
  if (!validTarget || validEnd <= 0 || !plan.template.eligible || plan.status !== 'composed'
    || !input.context.template.pianoEligible || !plan.harmonicEvents.length) return empty();
  const density = scoreClamp(generationDensity(input), 0.1, 1);

  const phraseById = new Map(plan.phrases.map((phrase) => [phrase.id, phrase]));
  const harmonic = [...plan.harmonicEvents]
    .filter((event) => Number.isInteger(event.chord.startTick) && Number.isInteger(event.chord.endTick))
    .sort((a, b) => a.chord.startTick - b.chord.startTick || a.chord.endTick - b.chord.endTick || a.chord.id.localeCompare(b.chord.id));
  const mutableEvents: PianoScoreEvent[] = [];
  const lastEventByVoice = new Map<PianoScoreVoiceId, number>();
  const previousPitchByVoice = new Map<PianoScoreVoiceId, number>();
  const bassPitchByChord = new Map<string, number | null>();
  const supportPitchByChord = new Map<string, number | null>();
  const innerPitchByChord = new Map<string, number | null>();
  let nextEventId = 0;

  const addEvent = (values: {
    source: PianoHarmonicEvent;
    phraseId: string | null;
    sectionId: string | null;
    hand: 'left' | 'right';
    voiceId: PianoScoreVoiceId;
    pitch: number;
    startTick: number;
    durationTicks: number;
    musicalRole: PianoMusicalRole;
    gestureIntent: PianoGestureIntent;
    techniqueIntent: PianoTechniqueIntent;
    noteRoleTag: PianoScoreEvent['noteRoleTag'];
    articulation: PianoScoreEvent['articulation'];
    allowed: boolean;
    allowTie: boolean;
    velocityAdjustment?: number;
    contextEvents?: readonly PianoHarmonicEvent[];
  }) => {
    const { source, phraseId, sectionId, hand, voiceId, pitch, startTick, durationTicks } = values;
    if (!Number.isInteger(pitch) || pitch < target!.lowestNote || pitch > target!.highestNote
      || !Number.isInteger(startTick) || startTick < 0 || startTick >= validEnd
      || !Number.isInteger(durationTicks) || durationTicks < 1) return;
    let clippedDuration = Math.min(durationTicks, validEnd - startTick);
    if (clippedDuration < 1 || !values.allowed) return;
    const attackGaps = [
      ...plan.fillDecisions.filter((decision) => decision.target.toLowerCase() === 'piano'
        && decision.decision === 'leave-space')
        .map((decision) => ({ startTick: decision.startTick, endTick: decision.endTick })),
      ...(values.musicalRole === 'suspension' ? [] : plan.attackRestrictions),
    ];
    const noteEnd = startTick + clippedDuration;
    const nextGap = attackGaps
      .filter((window) => window.startTick > startTick && window.startTick < noteEnd)
      .reduce((nearest, window) => Math.min(nearest, window.startTick), noteEnd);
    clippedDuration = nextGap - startTick;
    if (clippedDuration < 1) return;
    const previousIndex = lastEventByVoice.get(voiceId);
    const previous = previousIndex === undefined ? undefined : mutableEvents[previousIndex];
    const sourceContext = (values.contextEvents ?? [source]).map(scoreHarmonicContext);
    const mergedContext = sourceContext.slice(1).reduce(mergedScoreHarmonicContext, sourceContext[0] ?? scoreHarmonicContext(source));
    if (values.allowTie && previous && previous.pitch === pitch
      && scoreEndOf(previous) === startTick
      && previous.phraseId === phraseId && previous.sectionId === sectionId) {
      mutableEvents[previousIndex!] = {
        ...previous,
        durationTicks: clippedDuration + previous.durationTicks,
        musicalRole: values.musicalRole === 'cadence' ? 'cadence' : previous.musicalRole,
        gestureIntent: values.gestureIntent === 'cadential-landing' ? 'cadential-landing' : previous.gestureIntent,
        techniqueIntent: values.techniqueIntent === 'final-harmony' ? 'final-harmony' : previous.techniqueIntent,
        noteRoleTag: values.noteRoleTag === 'settle' ? 'settle' : previous.noteRoleTag,
        articulation: values.articulation === 'sustain' ? 'sustain' : previous.articulation,
        harmonicContext: mergedScoreHarmonicContext(previous.harmonicContext, mergedContext),
      };
      previousPitchByVoice.set(voiceId, pitch);
      return;
    }
    const dynamicIntent = scoreDynamicIntent(source, values.musicalRole);
    const adjustedDynamicIntent = values.velocityAdjustment
      ? {
          ...dynamicIntent,
          velocity: Math.round(scoreClamp(dynamicIntent.velocity + values.velocityAdjustment, 1, 127)),
        }
      : dynamicIntent;
    const event: PianoScoreEvent = {
      id: `${plan.generationIdentity.key}:score:${nextEventId++}`,
      pitch,
      startTick,
      durationTicks: clippedDuration,
      hand,
      voiceId,
      musicalRole: values.musicalRole,
      phraseId,
      sectionId,
      gestureIntent: values.gestureIntent,
      techniqueIntent: values.techniqueIntent,
      noteRoleTag: values.noteRoleTag,
      articulation: values.articulation,
      dynamicIntent: adjustedDynamicIntent,
      harmonicContext: mergedContext,
    };
    mutableEvents.push(event);
    lastEventByVoice.set(voiceId, mutableEvents.length - 1);
    previousPitchByVoice.set(voiceId, pitch);
  };

  for (let index = 0; index < harmonic.length; index++) {
    const source = harmonic[index];
    const start = Math.max(0, source.chord.startTick);
    const chordEnd = Math.min(validEnd, source.chord.endTick);
    const phrase = source.phraseId ? phraseById.get(source.phraseId) ?? null : null;
    const end = phrase ? Math.min(chordEnd, phrase.endTick) : chordEnd;
    const span = end - start;
    if (span < 1 || start >= validEnd) continue;
    const phraseId = phrase?.id ?? source.phraseId;
    const sectionId = phrase?.sectionId ?? source.sectionIds[0] ?? null;
    const finalLanding = source.chord.id === plan.ending.chordId;
    const allowedAtDownbeat = scoreAttackAllowed(plan, start);
    const restrictedBassPitchClasses = plan.templateConstraints.octaveDoubling === 'forbidden'
      ? [
          ...(source.suspension ? [source.suspension.resolvesToPitchClass] : []),
          ...plan.harmonicEvents.flatMap((candidate) => candidate.suspension?.preparedByChordId === source.chord.id
            ? [candidate.suspension.tensionPitchClass] : []),
        ]
      : [];
    const { bass, support } = chooseLeftHandPair(source, target!, previousPitchByVoice.get('lh.bass') ?? null, restrictedBassPitchClasses);
    const nextHarmony = harmonic[index + 1];
    const nextBassRootPitchClass = nextHarmony
      && nextHarmony.phraseId === source.phraseId
      && nextHarmony.chord.startTick === source.chord.endTick
      ? nextHarmony.chord.rootPitchClass : null;
    const figureKind = finalLanding ? 'sustained'
      : scoreFigureKind(phrase, source, plan.template.style.identity, plan);
    const figure = scoreFigureTicks(figureKind, start, end, phrase, source,
      plan.template.style.identity, density, plan);
    const supportWritten = finalLanding || density >= 0.35 || index % 2 === 0;
    bassPitchByChord.set(source.chord.id, allowedAtDownbeat ? bass : null);
    supportPitchByChord.set(source.chord.id, allowedAtDownbeat && supportWritten ? support : null);

    const bassTicks = figure.bass;
    for (let bassIndex = 0; bassIndex < bassTicks.length; bassIndex++) {
      const tick = bassTicks[bassIndex];
      if (bass === null) continue;
      const pitch = tick === start ? bass
        : scoreBassPatternPitch(source, target!, previousPitchByVoice.get('lh.bass') ?? bass,
          bassIndex, restrictedBassPitchClasses, figure.kind, bass,
          bassIndex === bassTicks.length - 1, nextBassRootPitchClass);
      if (pitch === null) continue;
      const nextTick = bassTicks[bassIndex + 1] ?? end;
      const duration = nextTick < end && figure.kind !== 'sustained'
        ? Math.max(1, Math.round((nextTick - tick) * 0.9))
        : Math.max(1, nextTick - tick);
      const rootPitchClass = scorePc(source.chord.rootPitchClass);
      const fifthPitchClass = scorePc(rootPitchClass + 7);
      const bassTechnique: PianoTechniqueIntent = finalLanding && tick === start ? 'final-harmony'
        : figure.kind === 'walking-bass' ? 'walking-bass-line'
          : figure.kind === 'ostinato' ? 'rhythmic-ostinato'
            : figure.kind === 'pulse' && scorePc(pitch) === fifthPitchClass ? 'root-fifth-bass-pattern'
              : figure.kind === 'pulse' ? 'pulsed-bass-pattern' : 'sustained-bass-foundation';
      const movingBass = figure.kind === 'walking-bass' && tick !== start;
      addEvent({
        source, phraseId, sectionId, hand: 'left', voiceId: 'lh.bass', pitch,
        startTick: tick, durationTicks: duration,
        musicalRole: finalLanding && tick === start ? 'cadence' : 'bass',
        gestureIntent: finalLanding && tick === start ? 'cadential-landing'
          : movingBass ? 'walking-bass-motion'
            : figure.kind === 'pulse' || figure.kind === 'ostinato' ? 'bass-pulse' : 'bass-foundation',
        techniqueIntent: bassTechnique,
        noteRoleTag: finalLanding && tick === start ? 'settle' : tick === start ? 'anchor' : 'lift',
        articulation: 'legato',
        allowed: scoreAttackAllowed(plan, tick),
        allowTie: figure.kind !== 'pulse' && figure.kind !== 'walking-bass' && figure.kind !== 'ostinato',
        velocityAdjustment: tick === start ? 0 : figure.kind === 'walking-bass' ? -4 : -3,
      });
    }

    if (supportWritten) {
      const supportTicks = figure.support;
      const ascendingFigure = unitRandom(plan.seed, `score-arpeggio-direction:${phraseId ?? 'unphrased'}:${source.chord.id}`) >= 0.5;
      let firstWrittenSupport: number | null = null;
      for (let supportIndex = 0; supportIndex < supportTicks.length; supportIndex++) {
        const tick = supportTicks[supportIndex];
        const activeBass = [...mutableEvents].reverse().find((candidate) => candidate.voiceId === 'lh.bass'
          && candidate.startTick <= tick && scoreEndOf(candidate) > tick)?.pitch ?? bass;
        const previousSupport = previousPitchByVoice.get('lh.support') ?? null;
        const pitch = tick === start && support !== null && figure.kind !== 'alberti-bass'
          ? support
          : activeBass === null ? null
            : scoreSupportPatternPitch(source, target!, activeBass, previousSupport, supportIndex,
              figure.kind, ascendingFigure, plan.templateConstraints.octaveDoubling, support);
        if (pitch === null) continue;
        const nextTick = supportTicks[supportIndex + 1] ?? end;
        const patterned = figure.kind !== 'sustained';
        const duration = !patterned
          ? finalLanding ? span : Math.max(1, Math.round(span * 0.82))
          : nextTick < end ? Math.max(1, Math.round((nextTick - tick) * 0.88)) : Math.max(1, nextTick - tick);
        const counterline = figure.kind === 'dialogue';
        const flourishAttack = figure.kind === 'flourish' && tick !== start;
        const technique: PianoTechniqueIntent = finalLanding && tick === start ? 'final-harmony'
          : figure.kind === 'alberti-bass' ? 'alberti-bass-accompaniment'
            : figure.kind === 'ostinato' ? 'rhythmic-ostinato'
              : figure.kind === 'arpeggiated' ? 'arpeggiated-chord-accompaniment'
                : counterline ? 'independent-counterline'
                  : figure.kind === 'pulse' && tick % PPQ !== 0 ? 'syncopated-pulse-accompaniment'
                    : flourishAttack ? 'staccato-fill-gesture'
                      : figure.kind === 'pulse' ? 'chord-tone-support'
                        : patterned ? 'broken-chord-accompaniment' : 'chord-tone-support';
        addEvent({
          source, phraseId, sectionId, hand: 'left', voiceId: 'lh.support', pitch,
          startTick: tick, durationTicks: duration,
          musicalRole: finalLanding && tick === start ? 'cadence' : 'support',
          gestureIntent: finalLanding && tick === start ? 'cadential-landing'
            : counterline ? 'counterline-answer'
              : patterned ? 'broken-chord-figure' : 'harmonic-support',
          techniqueIntent: technique,
          noteRoleTag: finalLanding && tick === start ? 'settle'
            : counterline ? 'answer'
              : flourishAttack ? 'flourish' : 'bed',
          articulation: flourishAttack ? 'staccato' : 'legato',
          allowed: scoreAttackAllowed(plan, tick),
          allowTie: !patterned,
          velocityAdjustment: tick === start ? 0 : figure.kind === 'pulse' || figure.kind === 'ostinato' ? -5 : -3,
        });
        if (firstWrittenSupport === null) firstWrittenSupport = pitch;
      }
      if (firstWrittenSupport !== null) supportPitchByChord.set(source.chord.id, firstWrittenSupport);
    }

    const rightZone = scoreRange(source.hands.right.register, target!);
    const previousInnerPitch = previousPitchByVoice.get('rh.inner') ?? null;
    const rightPitchClasses = uniquePitchClasses([
      ...(source.voicing.rightHandPitchClasses.length ? source.voicing.rightHandPitchClasses : source.chord.availablePitchClasses),
      ...(previousInnerPitch !== null && source.chord.availablePitchClasses.map(scorePc).includes(scorePc(previousInnerPitch))
        ? [scorePc(previousInnerPitch)] : []),
    ]);
    const innerPitch = chooseScorePitch({
      pitchClasses: rightPitchClasses,
      range: rightZone,
      preferredMidi: (rightZone[0] + rightZone[1]) / 2 - 4,
      previousMidi: previousInnerPitch,
      minimumPitch: support === null ? undefined : support + 3,
      excluded: [bass, support].filter((pitch): pitch is number => pitch !== null),
    });
    const innerWritten = innerPitch !== null && (finalLanding || density >= 0.55 || index % 2 === 0);
    const ascendingInner = unitRandom(plan.seed, `score-inner-direction:${phraseId ?? 'unphrased'}:${source.chord.id}`) >= 0.5;
    let firstWrittenInner: number | null = null;
    if (innerWritten) {
      for (let innerIndex = 0; innerIndex < figure.inner.length; innerIndex++) {
        const tick = figure.inner[innerIndex];
        const activeBass = [...mutableEvents].reverse().find((candidate) => candidate.voiceId === 'lh.bass'
          && candidate.startTick <= tick && scoreEndOf(candidate) > tick)?.pitch ?? bass;
        const activeSupport = [...mutableEvents].reverse().find((candidate) => candidate.voiceId === 'lh.support'
          && candidate.startTick <= tick && scoreEndOf(candidate) > tick)?.pitch ?? support;
        const variedInnerPitch = tick === start ? innerPitch : chooseScorePitch({
          pitchClasses: rightPitchClasses,
          range: rightZone,
          preferredMidi: previousPitchByVoice.get('rh.inner') ?? innerPitch,
          previousMidi: previousPitchByVoice.get('rh.inner') ?? innerPitch,
          desiredPitchClass: rightPitchClasses.length
            ? rightPitchClasses[(innerIndex + (ascendingInner ? 0 : rightPitchClasses.length - 1)) % rightPitchClasses.length]
            : undefined,
          minimumPitch: activeSupport === null ? undefined : activeSupport + 3,
          excluded: [activeBass, activeSupport].filter((pitch): pitch is number => pitch !== null),
        });
        if (variedInnerPitch === null) continue;
        const nextTick = figure.inner[innerIndex + 1] ?? end;
        const patterned = figure.kind !== 'sustained';
        const duration = patterned && nextTick < end
          ? Math.max(1, Math.round((nextTick - tick) * 0.9)) : Math.max(1, nextTick - tick);
        const counterline = figure.kind === 'dialogue';
        const flourishAttack = figure.kind === 'flourish' && tick !== start;
        addEvent({
          source, phraseId, sectionId, hand: 'right', voiceId: 'rh.inner', pitch: variedInnerPitch,
          startTick: tick, durationTicks: duration,
          musicalRole: finalLanding && tick === start ? 'cadence' : 'inner',
          gestureIntent: finalLanding && tick === start ? 'cadential-landing'
            : counterline ? 'counterline-answer'
              : patterned && tick !== start ? 'inner-line-motion' : 'inner-voice',
          techniqueIntent: finalLanding && tick === start ? 'final-harmony'
            : flourishAttack ? 'staccato-fill-gesture'
              : patterned && tick !== start ? 'moving-inner-voice' : 'voice-led-inner-tone',
          noteRoleTag: finalLanding && tick === start ? 'settle'
            : counterline ? 'answer'
              : flourishAttack ? 'flourish' : 'bed',
          articulation: flourishAttack ? 'staccato' : 'legato',
          allowed: scoreAttackAllowed(plan, tick),
          allowTie: !patterned,
          velocityAdjustment: tick === start ? 0 : -2,
        });
        if (firstWrittenInner === null) firstWrittenInner = variedInnerPitch;
      }
    }
    innerPitchByChord.set(source.chord.id, firstWrittenInner);
  }

  const plannedSuspensionWindows: Array<{ startTick: number; endTick: number }> = [];
  for (const resolving of harmonic) {
    const intention = resolving.suspension;
    if (!intention || intention.kind !== 'prepared-stepwise-suspension') continue;
    const prepared = harmonic.find((event) => event.chord.id === intention.preparedByChordId);
    if (!prepared || prepared.chord.endTick !== resolving.chord.startTick
      || !prepared.chord.availablePitchClasses.map(scorePc).includes(scorePc(intention.tensionPitchClass))
      || resolving.chord.availablePitchClasses.map(scorePc).includes(scorePc(intention.tensionPitchClass))) continue;
    const boundary = resolving.chord.startTick;
    const resolvingEnd = Math.min(validEnd, resolving.chord.endTick);
    if (boundary >= resolvingEnd || !scoreAttackAllowed(plan, boundary, true)) continue;
    const preparedBass = bassPitchByChord.get(prepared.chord.id) ?? null;
    const resolvingBass = bassPitchByChord.get(resolving.chord.id) ?? null;
    if (plan.templateConstraints.octaveDoubling === 'forbidden'
      && ((preparedBass !== null && scorePc(preparedBass) === scorePc(intention.tensionPitchClass))
        || (resolvingBass !== null && scorePc(resolvingBass) === scorePc(intention.resolvesToPitchClass)))) continue;
    const rightZone = scoreRange(prepared.hands.right.register, target!);
    const tensionCandidates = scorePitchesForClasses([intention.tensionPitchClass], rightZone);
    const hasStepwiseResolution = tensionCandidates.some((tension) =>
      [-intention.resolutionDistanceSemitones, intention.resolutionDistanceSemitones]
        .some((delta) => tension + delta >= target!.lowestNote && tension + delta <= target!.highestNote
          && scorePc(tension + delta) === scorePc(intention.resolvesToPitchClass)));
    if (!hasStepwiseResolution) continue;
    const preparedStart = Math.max(prepared.chord.startTick,
      boundary - Math.min(PPQ / 2, Math.floor((boundary - prepared.chord.startTick) * 0.2)));
    const resolutionStart = boundary + Math.min(PPQ / 2, Math.floor((resolvingEnd - boundary) * 0.15));
    const resolutionDuration = Math.max(1, Math.min(resolvingEnd - resolutionStart,
      Math.round((resolvingEnd - boundary) * 0.42)));
    const resolutionEnd = resolutionStart + resolutionDuration;
    if (resolutionStart <= preparedStart || resolutionStart >= resolvingEnd
      || !scoreAttackAllowed(plan, preparedStart, true)
      || !scoreAttackAllowed(plan, resolutionStart, true)) continue;
    plannedSuspensionWindows.push({ startTick: preparedStart, endTick: resolutionEnd });
  }
  const activeRightEventsAt = (tick: number) => mutableEvents.filter((event) => event.hand === 'right'
    && event.startTick <= tick && scoreEndOf(event) > tick);

  // The planned phrase cells, not the harmonic-change count, own upper-line
  // attacks. Each weighted motif position is realized in the harmony active at
  // that tick; the contour is carried in MIDI semitones and then fitted to the
  // supplied chord while keeping the line in the right-hand register.
  const scheduledByPhrase = new Map<string, PianoMotifAttack[]>();
  if (plan.motif) {
    for (const phrase of plan.phrases) {
      if (phrase.motif.operation === 'withhold-under-lead' || phrase.motif.operation === 'unavailable') continue;
      const cells = phrase.rhythmicPlan.motifCells ?? [];
      const cellTicks = Math.max(1, phrase.rhythmicPlan.cellTicks ?? 2 * PPQ);
      const gridTicks = Math.max(1, phrase.rhythmicPlan.gridTicks ?? PPQ / 2);
      const weights = normalizedScoreWeights(phrase.rhythmicPlan.weights, plan.motif.rhythmicWeights);
      const offsets = [0, weights[0], weights[0] + weights[1], weights[0] + weights[1] + weights[2]];
      const phraseAttacks: PianoMotifAttack[] = [];

      for (const [cellIndex, cell] of cells.entries()) {
        const cellStartTick = Math.max(phrase.startTick, phrase.startTick + cell.startOffsetTicks);
        const cellEndTick = Math.min(phrase.endTick, cellStartTick + cellTicks);
        const cellSpan = cellEndTick - cellStartTick;
        if (cellSpan <= 0) continue;
        const contour = motifContourForCell(plan.motif, cell.variation);
        const firstGridTick = Math.ceil(cellStartTick / gridTicks) * gridTicks;
        const lastGridTick = Math.floor((cellEndTick - 1) / gridTicks) * gridTicks;
        if (lastGridTick < firstGridTick) continue;
        const byTick = new Map<number, PianoMotifAttack[]>();

        for (const position of cell.positions) {
          const displacement = phrase.rhythmicPlan.syncopation?.displacedPosition === position
            ? phrase.rhythmicPlan.syncopation.offsetTicks : 0;
          const rawTick = cellStartTick + offsets[position] * cellSpan + displacement;
          const tick = scoreClamp(scoreQuantizeToGrid(rawTick, gridTicks), firstGridTick, lastGridTick);
          if (tick < phrase.startTick || tick >= phrase.endTick || tick >= validEnd
            || !scoreAttackAllowed(plan, tick)
            || plannedSuspensionWindows.some((window) => tick >= window.startTick && tick < window.endTick)) continue;
          const source = harmonic.find((event) => event.chord.startTick <= tick && tick < event.chord.endTick);
          if (!source || source.suspension) continue;
          const attack: PianoMotifAttack = {
            phrase,
            cellIndex,
            cellStartTick,
            cellEndTick,
            variation: cell.variation,
            contour,
            position,
            startTick: tick,
            source,
          };
          const atTick = byTick.get(tick) ?? [];
          atTick.push(attack);
          byTick.set(tick, atTick);
        }

        // A very short or syncopated cell can quantize two positions together.
        // Keep the phrase anchor on a collision, but prefer the resolving third
        // over an unresolved chromatic neighbor when those two coincide.
        for (const collisions of byTick.values()) {
          const resolvingThird = collisions.find((attack) => attack.position === 3);
          const anchor = collisions.find((attack) => attack.position === 0);
          const selected = resolvingThird && collisions.some((attack) => attack.position === 2)
            ? resolvingThird
            : anchor ?? [...collisions].sort((a, b) => a.position - b.position)[0];
          if (selected) phraseAttacks.push(selected);
        }
      }
      phraseAttacks.sort((a, b) => a.startTick - b.startTick || a.cellIndex - b.cellIndex || a.position - b.position);
      if (phraseAttacks.length) scheduledByPhrase.set(phrase.id, phraseAttacks);
    }
  }

  const writtenMelody: PianoWrittenMelodyEvent[] = [];
  let previousMelodyPitch = previousPitchByVoice.get('rh.melody') ?? null;
  for (const phrase of plan.phrases) {
    const phraseAttacks = scheduledByPhrase.get(phrase.id) ?? [];
    if (!phraseAttacks.length || !plan.motif) continue;
    const lastAttack = phraseAttacks[phraseAttacks.length - 1];
    const cells = new Map<number, PianoMotifAttack[]>();
    for (const attack of phraseAttacks) {
      const current = cells.get(attack.cellIndex) ?? [];
      current.push(attack);
      cells.set(attack.cellIndex, current);
    }

    for (const cellAttacks of [...cells.values()].sort((a, b) => a[0].cellStartTick - b[0].cellStartTick)) {
      cellAttacks.sort((a, b) => a.startTick - b.startTick || a.position - b.position);
      let cellAnchorPitch: number | null = null;
      const pendingResolutionRef: { current: {
        readonly tensionPitch: number;
        readonly distance: number;
        readonly tick: number;
        readonly candidates: readonly number[];
      } | null } = { current: null };

      for (const attack of cellAttacks) {
        const pendingResolution = pendingResolutionRef.current;
        const source = attack.source;
        const activeRightEvents = activeRightEventsAt(attack.startTick);
        const simultaneousRightPitches = activeRightEvents.map((event) => event.pitch);
        const activeInnerPitch = [...activeRightEvents].reverse().find((event) => event.voiceId === 'rh.inner')?.pitch ?? null;
        const innerPitch = activeInnerPitch ?? innerPitchByChord.get(source.chord.id) ?? null;
        const bassPitch = bassPitchByChord.get(source.chord.id) ?? null;
        const supportPitch = supportPitchByChord.get(source.chord.id) ?? null;
        const chordPitchClasses = uniquePitchClasses(source.chord.availablePitchClasses);
        const contourOffset = attack.contour.slice(0, attack.position).reduce((sum, interval) => sum + interval, 0);
        const currentRightRange = scoreRange(source.hands.right.register, target!);
        const expectedMidi = cellAnchorPitch === null
          ? Math.max((currentRightRange[0] + currentRightRange[1]) / 2, 72) + contourOffset
          : cellAnchorPitch + contourOffset;
        const expectedPitchClass = scorePc((cellAnchorPitch ?? plan.motif.anchorPitchClass) + contourOffset);
        const phraseLast = attack === lastAttack;
        const finalLandingChord = source.chord.id === plan.ending.chordId;
        const preferredPitchClass = phraseLast && finalLandingChord
          && (phrase.function === 'arrival' || phrase.function === 'statement-and-landing')
          ? source.chord.rootPitchClass
          : attack.position === 0 && cellAnchorPitch === null ? plan.motif.anchorPitchClass : expectedPitchClass;
        let candidates = motifPitchCandidates(chordPitchClasses, source, target!, innerPitch, bassPitch, supportPitch,
          simultaneousRightPitches);
        let isTension = false;
        let resolvesAtTick: number | null = null;
        let resolutionCandidates: number[] = [];

        if (attack.position === 2 && plan.motif.tensionResolution.kind === 'chromatic-neighbor'
          && plan.motif.tones.find((tone) => tone.position === 2)?.function === 'chromatic-neighbor'
          && !chordPitchClasses.includes(expectedPitchClass)) {
          const resolvingAttack = cellAttacks.find((candidate) => candidate.position === 3
            && candidate.startTick > attack.startTick);
          if (resolvingAttack) {
            const activeResolvingEvents = activeRightEventsAt(resolvingAttack.startTick);
            const resolvingSimultaneousPitches = activeResolvingEvents.map((event) => event.pitch);
            const resolvingInner = [...activeResolvingEvents].reverse()
              .find((event) => event.voiceId === 'rh.inner')?.pitch
              ?? innerPitchByChord.get(resolvingAttack.source.chord.id) ?? null;
            const resolvingBass = bassPitchByChord.get(resolvingAttack.source.chord.id) ?? null;
            const resolvingSupport = supportPitchByChord.get(resolvingAttack.source.chord.id) ?? null;
            const resolvingTones = uniquePitchClasses(resolvingAttack.source.chord.availablePitchClasses);
            const distance = Math.max(1, Math.min(2, plan.motif.tensionResolution.semitonesToResolution));
            const possibleResolutions = motifPitchCandidates(resolvingTones, resolvingAttack.source, target!,
              resolvingInner, resolvingBass, resolvingSupport, resolvingSimultaneousPitches);
            const targetResolutionPc = scorePc((cellAnchorPitch ?? plan.motif.anchorPitchClass)
              + attack.contour.slice(0, 3).reduce((sum, interval) => sum + interval, 0));
            const exactResolutions = possibleResolutions.filter((pitch) => scorePc(pitch) === targetResolutionPc);
            const preferredResolutions = exactResolutions.length ? exactResolutions : possibleResolutions;
            const tensionCandidates = motifPitchCandidates([expectedPitchClass], source, target!,
              innerPitch, bassPitch, supportPitch, simultaneousRightPitches);
            const resolvableTensions = tensionCandidates.filter((tension) =>
              preferredResolutions.some((resolution) => Math.abs(resolution - tension) <= distance));
            if (resolvableTensions.length) {
              candidates = resolvableTensions;
              resolutionCandidates = preferredResolutions;
              resolvesAtTick = resolvingAttack.startTick;
              isTension = true;
            }
          }
        }

        if (attack.position === 3 && pendingResolution?.tick === attack.startTick) {
          const stepwise = pendingResolution.candidates
            .filter((pitch) => Math.abs(pitch - pendingResolution!.tensionPitch) <= pendingResolution!.distance);
          if (stepwise.length) candidates = stepwise;
        }

        const desiredMidi = cellAnchorPitch === null
          ? expectedMidi
          : cellAnchorPitch + contourOffset;
        const melodyPitch = chooseMotifPitch({
          candidates,
          desiredMidi,
          previousMidi: previousMelodyPitch,
          preferredPitchClass,
          preferDownward: phraseLast && phrase.function === 'release',
        });
        if (melodyPitch === null) continue;
        if (cellAnchorPitch === null) cellAnchorPitch = melodyPitch - contourOffset;
        if (isTension && resolvesAtTick !== null) {
          pendingResolutionRef.current = {
            tensionPitch: melodyPitch,
            distance: Math.max(1, Math.min(2, plan.motif.tensionResolution.kind === 'chromatic-neighbor'
              ? plan.motif.tensionResolution.semitonesToResolution : 1)),
            tick: resolvesAtTick,
            candidates: resolutionCandidates,
          };
        } else if (attack.position === 3 && pendingResolution?.tick === attack.startTick) {
          pendingResolutionRef.current = null;
        }
        const written: PianoWrittenMelodyEvent = {
          ...attack,
          pitch: melodyPitch,
          isTension,
          resolvesAtTick,
        };
        writtenMelody.push(written);
        previousMelodyPitch = melodyPitch;
      }
    }
  }

  // Keep the explicit score-level ending audible in the upper line when the
  // final phrase has a planned motif but its weighted cells do not land inside
  // the final supplied chord. This is a chord-boundary cadence, not an inferred
  // key, added harmony, or Realizer-side melody decision.
  const endingHarmony = harmonic.find((event) => event.chord.id === plan.ending.chordId);
  const endingPhrase = endingHarmony?.phraseId ? phraseById.get(endingHarmony.phraseId) ?? null
    : endingHarmony ? plan.phrases.find((phrase) => endingHarmony.chord.startTick >= phrase.startTick
      && endingHarmony.chord.startTick < phrase.endTick) ?? null : null;
  if (plan.motif && endingHarmony && endingPhrase
    && (endingPhrase.function === 'arrival' || endingPhrase.function === 'statement-and-landing')
    && endingPhrase.motif.operation !== 'withhold-under-lead'
    && (endingPhrase.rhythmicPlan.motifCells?.length ?? 0) > 0
    && !writtenMelody.some((event) => event.phrase.id === endingPhrase.id
      && event.source.chord.id === endingHarmony.chord.id)) {
    const gridTicks = Math.max(1, endingPhrase.rhythmicPlan.gridTicks ?? PPQ / 2);
    const landingTick = Math.ceil(endingHarmony.chord.startTick / gridTicks) * gridTicks;
    if (landingTick < endingHarmony.chord.endTick && landingTick < validEnd
      && scoreAttackAllowed(plan, landingTick) && !endingHarmony.suspension
      && !plannedSuspensionWindows.some((window) => landingTick >= window.startTick && landingTick < window.endTick)) {
      const activeRightEvents = activeRightEventsAt(landingTick);
      const simultaneousRightPitches = activeRightEvents.map((event) => event.pitch);
      const innerPitch = [...activeRightEvents].reverse().find((event) => event.voiceId === 'rh.inner')?.pitch
        ?? innerPitchByChord.get(endingHarmony.chord.id) ?? null;
      const bassPitch = bassPitchByChord.get(endingHarmony.chord.id) ?? null;
      const supportPitch = supportPitchByChord.get(endingHarmony.chord.id) ?? null;
      const landingCandidates = motifPitchCandidates(endingHarmony.chord.availablePitchClasses, endingHarmony,
        target!, innerPitch, bassPitch, supportPitch, simultaneousRightPitches);
      const rightZone = scoreRange(endingHarmony.hands.right.register, target!);
      const landingPitch = chooseMotifPitch({
        candidates: landingCandidates,
        desiredMidi: previousMelodyPitch ?? Math.max((rightZone[0] + rightZone[1]) / 2, 72),
        previousMidi: previousMelodyPitch,
        preferredPitchClass: endingHarmony.chord.rootPitchClass,
      });
      if (landingPitch !== null) {
        const finalCell = Math.max(0, (endingPhrase.rhythmicPlan.motifCells?.length ?? 1) - 1);
        writtenMelody.push({
          phrase: endingPhrase,
          cellIndex: finalCell,
          cellStartTick: landingTick,
          cellEndTick: endingHarmony.chord.endTick,
          variation: 'cadence',
          contour: [],
          position: 3,
          startTick: landingTick,
          source: endingHarmony,
          pitch: landingPitch,
          isTension: false,
          resolvesAtTick: null,
        });
        previousMelodyPitch = landingPitch;
      }
    }
  }

  writtenMelody.sort((a, b) => a.startTick - b.startTick || a.phrase.startTick - b.phrase.startTick
    || a.cellIndex - b.cellIndex || a.position - b.position);
  for (let index = 0; index < writtenMelody.length; index++) {
    const event = writtenMelody[index];
    const nextInPhrase = writtenMelody.slice(index + 1).find((candidate) =>
      candidate.phrase.id === event.phrase.id && candidate.startTick > event.startTick);
    const phraseEnd = Math.min(validEnd, event.phrase.endTick);
    const intendedEnd = nextInPhrase
      ? event.startTick + Math.max(1, Math.round((nextInPhrase.startTick - event.startTick) * 0.9))
      : phraseEnd;
    let noteEnd = Math.max(event.startTick + 1, Math.min(phraseEnd, intendedEnd));
    if (event.isTension && event.resolvesAtTick !== null) {
      noteEnd = Math.min(noteEnd, event.resolvesAtTick);
    } else {
      const pitchClass = scorePc(event.pitch);
      for (const nextHarmony of harmonic) {
        if (nextHarmony.chord.startTick <= event.source.chord.startTick || nextHarmony.chord.startTick >= noteEnd) continue;
        if (!nextHarmony.chord.availablePitchClasses.map(scorePc).includes(pitchClass)) {
          noteEnd = Math.min(noteEnd, nextHarmony.chord.startTick);
          break;
        }
      }
    }
    for (const window of plannedSuspensionWindows) {
      if (window.startTick > event.startTick && window.startTick < noteEnd) {
        noteEnd = Math.min(noteEnd, window.startTick);
        break;
      }
    }
    noteEnd = Math.max(event.startTick + 1, noteEnd);
    const contextEvents = harmonic.filter((candidate) => candidate.chord.startTick < noteEnd
      && candidate.chord.endTick > event.startTick);
    const finalLanding = event.source.chord.id === plan.ending.chordId;
    const anticipated = plan.motif !== null && isAnticipatedMotifAttack(event, plan.motif);
    addEvent({
      source: event.source,
      phraseId: event.phrase.id,
      sectionId: event.phrase.sectionId,
      hand: 'right',
      voiceId: 'rh.melody',
      pitch: event.pitch,
      startTick: event.startTick,
      durationTicks: noteEnd - event.startTick,
      musicalRole: finalLanding ? 'cadence' : 'melody',
      gestureIntent: finalLanding ? 'cadential-landing'
        : anticipated ? 'anticipated-subject' : 'cantabile-subject',
      techniqueIntent: finalLanding ? 'final-harmony'
        : anticipated ? 'phrase-anticipation' : 'phrase-led-upper-line',
      noteRoleTag: finalLanding ? 'settle' : anticipated ? 'lift' : 'answer',
      articulation: anticipated ? 'detache' : 'legato',
      allowed: scoreAttackAllowed(plan, event.startTick),
      allowTie: true,
      velocityAdjustment: anticipated ? -4 : undefined,
      contextEvents: contextEvents.length ? contextEvents : [event.source],
    });
    if (shouldWriteClimaxOctave(input, event.phrase, event.source, !nextInPhrase)) {
      const octaveEnd = Math.min(noteEnd, event.startTick + PPQ);
      const octavePitch = [event.pitch + 12, event.pitch - 12].find((pitch) =>
        scoreOctavePitchFitsHand(mutableEvents, pitch, event.startTick, octaveEnd, target!));
      if (octavePitch !== undefined) {
        addEvent({
          source: event.source,
          phraseId: event.phrase.id,
          sectionId: event.phrase.sectionId,
          hand: 'right',
          voiceId: 'rh.octave',
          pitch: octavePitch,
          startTick: event.startTick,
          durationTicks: octaveEnd - event.startTick,
          musicalRole: 'octave',
          gestureIntent: 'octave-reinforcement',
          techniqueIntent: 'octave-doubling',
          noteRoleTag: 'arrival',
          articulation: 'legato',
          allowed: scoreAttackAllowed(plan, event.startTick),
          allowTie: false,
          velocityAdjustment: -7,
          contextEvents: contextEvents.length ? contextEvents : [event.source],
        });
      }
    }
  }

  // Convert each explicit Composer suspension into an actual held preparation
  // and exact stepwise resolution. This remains a score decision; the Realizer
  // only carries the two events through policy checks and Note conversion.
  for (const resolving of harmonic) {
    const intention = resolving.suspension;
    if (!intention || intention.kind !== 'prepared-stepwise-suspension') continue;
    const prepared = harmonic.find((event) => event.chord.id === intention.preparedByChordId);
    if (!prepared || prepared.chord.endTick !== resolving.chord.startTick) continue;
    if (!prepared.chord.availablePitchClasses.map(scorePc).includes(scorePc(intention.tensionPitchClass))) continue;
    if (resolving.chord.availablePitchClasses.map(scorePc).includes(scorePc(intention.tensionPitchClass))) continue;
    const boundary = resolving.chord.startTick;
    const resolvingEnd = Math.min(validEnd, resolving.chord.endTick);
    if (boundary >= resolvingEnd || !scoreAttackAllowed(plan, boundary, true)) continue;
    const plannedBassForChord = (chordId: string): number | null => [...mutableEvents].reverse().find((candidate) =>
      candidate.voiceId === 'lh.bass' && candidate.harmonicContext.chordIds.includes(chordId))?.pitch ?? null;
    const previousBass = plannedBassForChord(prepared.chord.id);
    const resolvingBass = plannedBassForChord(resolving.chord.id);
    if (plan.templateConstraints.octaveDoubling === 'forbidden'
      && ((previousBass !== null && scorePc(previousBass) === scorePc(intention.tensionPitchClass))
        || (resolvingBass !== null && scorePc(resolvingBass) === scorePc(intention.resolvesToPitchClass)))) continue;

    const rightZone = scoreRange(prepared.hands.right.register, target!);
    const tensionOptions = scorePitchesForClasses([intention.tensionPitchClass], rightZone);
    const likelyLine = previousPitchByVoice.get('rh.melody') ?? previousPitchByVoice.get('rh.inner') ?? 72;
    tensionOptions.sort((a, b) => Math.abs(a - likelyLine) - Math.abs(b - likelyLine) || a - b);
    let chosen: { tension: number; resolution: number } | null = null;
    for (const tension of tensionOptions) {
      const resolutions = [-intention.resolutionDistanceSemitones, intention.resolutionDistanceSemitones]
        .map((delta) => tension + delta)
        .filter((pitch) => pitch >= target!.lowestNote && pitch <= target!.highestNote
          && scorePc(pitch) === scorePc(intention.resolvesToPitchClass));
      if (resolutions.length) {
        resolutions.sort((a, b) => Math.abs(a - (tension + (scorePc(intention.resolvesToPitchClass) > scorePc(intention.tensionPitchClass) ? 1 : -1)))
          - Math.abs(b - (tension + (scorePc(intention.resolvesToPitchClass) > scorePc(intention.tensionPitchClass) ? 1 : -1))) || a - b);
        chosen = { tension, resolution: resolutions[0] };
        break;
      }
    }
    if (!chosen) continue;
    const resolvingPhrase = resolving.phraseId ? phraseById.get(resolving.phraseId) ?? null : null;
    const preparedPhrase = prepared.phraseId ? phraseById.get(prepared.phraseId) ?? null : null;
    const phraseId = preparedPhrase?.id ?? prepared.phraseId;
    const sectionId = preparedPhrase?.sectionId ?? prepared.sectionIds[0] ?? null;
    const preparedStart = Math.max(prepared.chord.startTick,
      boundary - Math.min(PPQ / 2, Math.floor((boundary - prepared.chord.startTick) * 0.2)));
    const resolutionOffset = Math.min(PPQ / 2, Math.floor((resolvingEnd - boundary) * 0.15));
    const resolutionStart = boundary + resolutionOffset;
    if (resolutionStart <= preparedStart || resolutionStart >= resolvingEnd) continue;
    const resolutionDuration = Math.max(1, Math.min(resolvingEnd - resolutionStart,
      Math.round((resolvingEnd - boundary) * 0.42)));
    addEvent({
      source: prepared,
      phraseId,
      sectionId,
      hand: 'right',
      voiceId: 'rh.suspension',
      pitch: chosen.tension,
      startTick: preparedStart,
      durationTicks: resolutionStart - preparedStart,
      musicalRole: 'suspension',
      gestureIntent: 'prepared-tension',
      techniqueIntent: 'prepared-suspension',
      noteRoleTag: 'answer',
      articulation: 'legato',
      allowed: scoreAttackAllowed(plan, preparedStart, true),
      allowTie: false,
      contextEvents: [prepared, resolving],
    });
    const resolvingSectionId = resolvingPhrase?.sectionId ?? resolving.sectionIds[0] ?? sectionId;
    addEvent({
      source: resolving,
      phraseId: resolvingPhrase?.id ?? resolving.phraseId,
      sectionId: resolvingSectionId,
      hand: 'right',
      voiceId: 'rh.suspension',
      pitch: chosen.resolution,
      startTick: resolutionStart,
      durationTicks: resolutionDuration,
      musicalRole: 'suspension',
      gestureIntent: 'stepwise-resolution',
      techniqueIntent: 'stepwise-resolution',
      noteRoleTag: 'settle',
      articulation: 'legato',
      allowed: scoreAttackAllowed(plan, resolutionStart, true),
      allowTie: false,
      contextEvents: [resolving],
    });
  }

  const events = avoidScoreUnisonRearticulation(mutableEvents);
  const rests = scoreRests(plan, events, validEnd);
  return createPianoScore({
    generationIdentity: plan.generationIdentity,
    templateId: plan.template.id,
    projectEndTick: validEnd,
    events,
    rests,
  });
}

export interface PianoScoreComposition {
  readonly score: PianoScore;
  /** Ephemeral sidecar; null when no score could be written. Never persisted. */
  readonly diagnostics: PianoCompositionDiagnostics | null;
}

/**
 * Write the Composer-owned Piano score.
 *
 *   Section Arc Plan -> Theme Layer -> Pattern/Texture Layer
 *     -> Bounded Orchestral Adaptation -> PianoScore
 *
 * The Realizer receives the frozen score and only converts it to Note values,
 * applies the existing template safety policy and builds the CC64 lane.
 * Target ranges and the supplied project endpoint are hard inputs.
 */
export function composePianoScoreWithDiagnostics(
  input: PianoEngineInput,
  plan: PianoComposerPlan,
  target: PianoScoreTarget | null,
  projectEndTick: number,
  /** 'identity' (default) or 'classic'; Classic runs the Texture-and-Theme Composer exactly as accepted. */
  mode?: PianoCompositionMode,
): PianoScoreComposition {
  const validEnd = Number.isInteger(projectEndTick) && projectEndTick > 0 ? projectEndTick : 0;
  const validTarget = target !== null
    && target.family === 'Keys'
    && target.role === 'piano'
    && !target.locked
    && Number.isInteger(target.lowestNote)
    && Number.isInteger(target.highestNote)
    && target.lowestNote >= 0
    && target.highestNote <= 127
    && target.lowestNote <= target.highestNote;
  if (!validTarget || validEnd <= 0 || !plan.template.eligible || plan.status !== 'composed'
    || !input.context.template.pianoEligible || !plan.harmonicEvents.length) {
    return {
      score: createPianoScore({
        generationIdentity: plan.generationIdentity,
        templateId: plan.template.id,
        projectEndTick: validEnd,
        events: [],
        rests: [],
      }),
      diagnostics: null,
    };
  }
  const density = scoreClamp(generationDensity(input), 0.1, 1);
  const composition = composeTextureTheme(input, plan, target!, validEnd, density, mode);
  const harmonicById = new Map(plan.harmonicEvents.map((event) => [event.chord.id, event]));
  const fallbackHarmony = plan.harmonicEvents[0];
  let nextEventId = 0;
  const events: PianoScoreEvent[] = composition.events.map((draft) => {
    const source = harmonicById.get(draft.chordId) ?? fallbackHarmony;
    return {
      id: `${plan.generationIdentity.key}:score:${nextEventId++}`,
      pitch: draft.pitch,
      startTick: draft.startTick,
      durationTicks: draft.durationTicks,
      hand: draft.hand,
      voiceId: draft.voiceId,
      musicalRole: draft.musicalRole,
      phraseId: draft.phraseId,
      sectionId: draft.sectionId || null,
      gestureIntent: draft.gestureIntent,
      techniqueIntent: draft.techniqueIntent,
      noteRoleTag: draft.noteRoleTag,
      articulation: draft.articulation,
      dynamicIntent: {
        intensity: Math.round(draft.intensity * 100) / 100,
        velocity: draft.velocity,
        phraseShape: source.dynamicIntent.gesture,
        sourceEnergyTarget: source.dynamicIntent.sourceEnergyTarget,
      },
      harmonicContext: scoreHarmonicContext(source),
    };
  });

  // Prepared suspensions remain a Composer decision. Each planned pair is
  // placed under the theme as an inner voice where it fits the right hand and
  // does not collide with a theme attack; otherwise it is left out and the
  // Realizer audit reports it as not written.
  const foundation = composePianoFoundationScore(input, plan, target, projectEndTick);
  const suspensionVoice = foundation.events.filter((event) => event.voiceId === 'rh.suspension');
  const endOf = (event: PianoScoreEvent) => event.startTick + event.durationTicks;
  const lastSuspensionPitch = new Map<string, number>();
  for (let index = 0; index + 1 < suspensionVoice.length; index++) {
    const tension = suspensionVoice[index];
    const resolution = suspensionVoice[index + 1];
    if (tension.techniqueIntent !== 'prepared-suspension' || resolution.techniqueIntent !== 'stepwise-resolution'
      || endOf(tension) !== resolution.startTick) continue;
    index++;
    const windowStart = tension.startTick;
    const windowEnd = endOf(resolution);
    const overlapping = () => events.filter((event) => event.startTick < windowEnd && endOf(event) > windowStart);
    const upperLine = () => overlapping().filter((event) => event.voiceId === 'rh.melody' || event.voiceId === 'rh.octave');
    const leftTop = Math.max(-1, ...overlapping().filter((event) => event.hand === 'left').map((event) => event.pitch));
    // The suspension voice stays in one register inside a phrase.
    const previousInVoice = tension.phraseId ? lastSuspensionPitch.get(tension.phraseId) : undefined;
    const withinVoiceReach = (pitch: number) => previousInVoice === undefined || Math.abs(pitch - previousInVoice) <= 12;
    const fitUnder = (): number | null => {
      const melody = upperLine();
      if (!melody.length) return null;
      const melodyLow = Math.min(...melody.map((event) => event.pitch));
      const melodyHigh = Math.max(...melody.map((event) => event.pitch));
      // Prefer a placement the right hand can hold with the theme (within an octave). Otherwise
      // accept one the pedal carries, still inside the validator's hard span limit, so that the
      // theme is not displaced by its own inner suspension.
      for (const reach of [12, 19]) {
        for (const candidate of [0, -12, 12, -24, 24]) {
          const pitches = [tension.pitch + candidate, resolution.pitch + candidate];
          if (pitches.every((pitch) => withinVoiceReach(pitch) && pitch > leftTop && pitch < melodyLow - 1
            && melodyHigh - pitch <= reach
            && pitch >= target!.lowestNote && pitch <= target!.highestNote)) return candidate;
        }
      }
      return null;
    };
    let takeoverEnd: number | null = null;
    let shift = fitUnder();
    if (shift === null) {
      // No room beneath the theme: the suspension takes the theme's place for the boundary beat
      // only. The theme note struck with it gives way, a theme note already sounding is released
      // as the dissonance enters, and the theme resumes at its next attack, where the resolution ends.
      const resume = events
        .filter((event) => (event.voiceId === 'rh.melody' || event.voiceId === 'rh.octave')
          && event.startTick >= resolution.startTick + PPQ / 2 && event.startTick < windowEnd)
        .reduce((earliest, event) => Math.min(earliest, event.startTick), windowEnd);
      takeoverEnd = resume;
      for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex--) {
        const event = events[eventIndex];
        if (event.voiceId !== 'rh.melody' && event.voiceId !== 'rh.octave') continue;
        if (event.startTick >= resume || endOf(event) <= windowStart) continue;
        if (event.startTick < windowStart) events[eventIndex] = { ...event, durationTicks: windowStart - event.startTick };
        else events.splice(eventIndex, 1);
      }
      const before = events.filter((event) => event.voiceId === 'rh.melody' && event.startTick < windowStart)
        .sort((x, y) => y.startTick - x.startTick)[0];
      const reference = previousInVoice ?? before?.pitch ?? Math.max(leftTop + 12, 67);
      const fits = [0, -12, 12, -24, 24].filter((candidate) =>
        [tension.pitch + candidate, resolution.pitch + candidate].every((pitch) => pitch > leftTop + 2
          && pitch >= target!.lowestNote && pitch <= target!.highestNote));
      fits.sort((x, y) => Math.abs(tension.pitch + x - reference) - Math.abs(tension.pitch + y - reference) || x - y);
      shift = fits.length ? fits[0] : null;
    }
    if (shift === null) continue;
    const tensionPitch = tension.pitch + shift;
    const resolutionPitch = resolution.pitch + shift;
    if (resolution.phraseId) lastSuspensionPitch.set(resolution.phraseId, resolutionPitch);
    if (tension.phraseId && tension.phraseId !== resolution.phraseId) lastSuspensionPitch.set(tension.phraseId, tensionPitch);
    // Clear inner support that would smear the dissonance or its resolution.
    for (let eventIndex = events.length - 1; eventIndex >= 0; eventIndex--) {
      const event = events[eventIndex];
      if (event.voiceId !== 'rh.inner' || event.startTick >= windowEnd || endOf(event) <= windowStart) continue;
      if (Math.abs(event.pitch - tensionPitch) > 2 && Math.abs(event.pitch - resolutionPitch) > 1
        && Math.abs(event.pitch - Math.min(tensionPitch, resolutionPitch)) <= 12) continue;
      if (event.startTick < windowStart - PPQ / 2) {
        events[eventIndex] = { ...event, durationTicks: windowStart - event.startTick };
      } else {
        events.splice(eventIndex, 1);
      }
    }
    events.push(
      { ...tension, id: `${plan.generationIdentity.key}:score:${nextEventId++}`, pitch: tensionPitch },
      {
        ...resolution,
        id: `${plan.generationIdentity.key}:score:${nextEventId++}`,
        pitch: resolutionPitch,
        durationTicks: takeoverEnd === null ? resolution.durationTicks
          : Math.max(1, Math.min(resolution.durationTicks, takeoverEnd - resolution.startTick)),
      },
    );
  }

  const cleaned = avoidScoreUnisonRearticulation(events);
  return {
    score: createPianoScore({
      generationIdentity: plan.generationIdentity,
      templateId: plan.template.id,
      projectEndTick: validEnd,
      events: cleaned,
      rests: scoreRests(plan, cleaned, validEnd),
    }),
    diagnostics: composition.diagnostics,
  };
}

/** Production score entry point; see `composePianoScoreWithDiagnostics`. */
export function composePianoScore(
  input: PianoEngineInput,
  plan: PianoComposerPlan,
  target: PianoScoreTarget | null,
  projectEndTick: number,
  mode?: PianoCompositionMode,
): PianoScore {
  return composePianoScoreWithDiagnostics(input, plan, target, projectEndTick, mode).score;
}
