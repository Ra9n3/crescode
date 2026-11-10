/**
 * Phase 5: a deterministic, piano-specific composition planner.
 *
 * The Composer consumes the Phase 4A handoff and Phase 4B report. Production
 * `composeAllTracks` invokes it as part of Piano Engine V2 after all non-Piano
 * parts are finalized. It writes symbolic intentions (pitch classes, register
 * zones, phrases and gestures), never MIDI notes; the Realizer writes the
 * final Piano notes.
 */
import { PPQ } from '../../shared/schema/types';
import type { PianoAnalyzerReport } from './piano-analyzer';
import type { PianoEngineInput, PianoMomentKind, PianoTemplateRule } from './piano-engine';

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
  /** Position of this supplied bar's target within the phrase, from 0 to 1. */
  readonly position: number;
  readonly target: number;
  readonly nearSilence: boolean;
}

export interface PianoDynamicCurvePoint {
  /** Position within the phrase, from 0 to 1. */
  readonly position: number;
  /** Continuous 0–5 piano intensity; the Realizer maps it to MIDI velocity. */
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
  readonly startTick: number;
  readonly endTick: number;
  readonly function: 'opening' | 'continuation' | 'contrast' | 'culmination' | 'closing';
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
  readonly function: 'statement' | 'development' | 'contrast' | 'arrival' | 'release' | 'statement-and-landing';
  readonly boundaryEvidence: readonly string[];
  readonly texture: PianoTextureIntention;
  readonly leftHandIntent: string;
  readonly rightHandIntent: string;
  readonly registerPlan: { readonly left: PianoRegisterZone; readonly right: PianoRegisterZone };
  readonly rhythmicIntent: string;
  readonly rhythmicPlan: {
    /** Underlying quarter-note pulse; displaced events remain related to this grid. */
    readonly pulseTicks: number;
    /** Phrase-level variation of the four motif durations. */
    readonly weights: readonly number[];
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
  /** Relative durations summing to 1; a flexible cell for a later Realizer. */
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
    readonly explicitLeadTrackIds: readonly string[];
    readonly momentKinds: readonly PianoMomentKind[];
    readonly interaction: 'interweave' | 'support-moment' | 'yield-to-spotlight' | 'leave-space' | 'unavailable';
    readonly analyzerEvidence: 'available' | 'partial' | 'unavailable';
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
  return [...grouped.entries()].map(([id, group], index) => {
    const bars = [...group.bars].sort((a, b) => a.bar - b.bar);
    return {
      id,
      name: group.name,
      index,
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
        function: phraseFunction(phrase, sections.length, hasMoment, section.index === sections.length - 1),
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
): number {
  const landing = phrase?.function === 'arrival' || phrase?.function === 'statement-and-landing';
  const rootPenalty = candidate === material.root
    ? landing ? -1.2 : profile.rootPositionPenalty
    : 0;
  const movement = previousBass === null ? 0 : pcDistance(previousBass, candidate) * 0.7;
  const repeatedBass = previousBass === candidate && candidate !== material.root ? 0.55 : 0;
  return rootPenalty + movement + repeatedBass + unitRandom(seed, `bass:${material.chordId}:${candidate}`) * 0.15;
}

function selectBass(
  material: ChordMaterial,
  previousBass: number | null,
  phrase: PhraseWindow | null,
  profile: StyleProfile,
  seed: number,
): number {
  return [...availableBassTones(material)].sort((a, b) =>
    bassScore(a, material, previousBass, phrase, profile, seed)
      - bassScore(b, material, previousBass, phrase, profile, seed))[0];
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

function orchestrationReading(
  input: PianoEngineInput,
  analyzer: PianoAnalyzerReport,
  startTick: number,
  endTick: number,
): OrchestrationReading {
  const bars = input.context.barWindows.filter((bar) => intersects(bar.startTick, bar.endTick, startTick, endTick));
  const barIds = new Set(bars.map((bar) => bar.bar));
  const active = analyzer.observedFacts.instruments.filter((instrument) =>
    instrument.byBar.some((bar) => barIds.has(bar.bar) && bar.activeNoteCount > 0));
  const activeTrackIds = active.map((instrument) => instrument.instrument.id);
  const activeRoles = active.map((instrument) => instrument.instrument.role);
  const registerCounts = { low: 0, middle: 0, high: 0 };
  for (const instrument of analyzer.observedFacts.instruments) {
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
    availability: bars.length > 0 && analyzer.observedFacts.barAssignmentAvailability === 'available'
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
      && analyzer.observedFacts.instruments.length > 0 ? 'available' : 'partial';
  const reading = {
    activeTrackIds,
    activeRoles,
    explicitLeadTrackIds: unique(lead),
    moments,
    inPianoFill,
    registerOccupancy,
    evidence,
  };
  return { ...reading, interaction: momentDecision(reading) };
}

function chordActivityIds(
  analyzer: PianoAnalyzerReport,
  chordId: string,
): string[] {
  return analyzer.observedFacts.instruments
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
): PianoPhraseIntention['function'] {
  if (phrase.firstInSection && phrase.lastInSection && sectionCount === 1 && isLastSection) return 'statement-and-landing';
  if (phrase.lastInSection && isLastSection) return 'arrival';
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
    const segmentShape: PianoPhraseDynamics['shape'] = sourceEnergy.nearSilence ? 'suspended-breath'
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
  if (sourceEnergy.nearSilence) shape = 'suspended-breath';
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
  const emotionalColor: PianoPhraseDynamics['emotionalColor'] = sourceEnergy.nearSilence
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
  if (phraseIndex === 0) return { operation: 'introduce', rationale: 'Establish a short chord-relative cell with a prepared neighbor and resolution.' };
  if (reading.explicitLeadTrackIds.length && phraseFunctionName !== 'arrival') {
    if (profile.public.identity === 'hybrid-pulse-and-color') {
      return {
        operation: 'fragmented-recall',
        rationale: 'Keep a two-note chord-relative color reply under the annotated lead; anticipate one pulse in the upper voice while the bass anchors harmony, without tracing the lead contour.',
      };
    }
    return { operation: 'withhold-under-lead', rationale: 'An explicit conductor lead annotation is active; the piano motif yields rather than competing.' };
  }
  if (phraseFunctionName === 'arrival' || phraseFunctionName === 'statement-and-landing') {
    return { operation: 'fragment-to-landing', rationale: 'Recall only part of the cell so the supplied final harmony, not a repeated pattern, carries the landing.' };
  }
  const moments = input.context.moments.filter((moment) =>
    intersects(moment.startTick, moment.endTick, phrase.startTick, phrase.endTick));
  if (moments.some((moment) => moment.kind === 'soli' || moment.kind === 'unison')) {
    return { operation: 'invert-and-reframe', rationale: 'Reframe the cell around the explicit conductor spotlight instead of restating it unchanged.' };
  }
  const energy = sourceEnergyForPhrase(input, phrase);
  if (energy.nearSilence || (energy.entryTarget !== null && energy.exitTarget !== null && energy.exitTarget < energy.entryTarget - 0.1)) {
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
): PianoPhraseIntention['rhythmicPlan'] {
  const defaultWeights = motif?.rhythmicWeights ?? [0.25, 0.25, 0.25, 0.25];
  if (profile.public.identity !== 'hybrid-pulse-and-color') {
    return { pulseTicks: PPQ, weights: defaultWeights, syncopation: null };
  }

  // Keep a recognizable quarter-note backbone, while varying the cell's
  // subdivisions by phrase rather than stamping one repeated accompaniment.
  const hybridCells: readonly (readonly number[])[] = [
    [0.25, 0.25, 0.25, 0.25],
    [0.1875, 0.3125, 0.25, 0.25],
    [0.25, 0.1875, 0.3125, 0.25],
    [0.25, 0.25, 0.1875, 0.3125],
  ];
  const cellIndex = Math.floor(unitRandom(input.context.seed, `hybrid-cell:${phrase.id}`) * hybridCells.length);
  const weights = hybridCells[cellIndex] ?? hybridCells[0];
  const operationCanSoundMotif = operation !== 'withhold-under-lead' && operation !== 'unavailable';
  const textureCanCarryMotif = texture === 'sparse-sustained'
    || texture === 'melody-accompaniment' || texture === 'contrapuntal-dialogue';
  const canPlaceColor = motif !== null && operationCanSoundMotif && textureCanCarryMotif
    && density !== 'very-sparse'
    && !dynamics.sourceEnergy.nearSilence
    && phrase.function !== 'arrival'
    && phrase.function !== 'statement-and-landing';
  if (!canPlaceColor) return { pulseTicks: PPQ, weights, syncopation: null };

  const fullCell = ['introduce', 'sequence-in-new-harmony', 'rhythmic-augmentation',
    'interval-expansion', 'invert-and-reframe'].includes(operation);
  const canPairNeighborAndResolution = fullCell
    && (density === 'moderate' || density === 'broad')
    && motif?.tensionResolution.kind === 'chromatic-neighbor';
  const displacedPosition: 1 | 2 = canPairNeighborAndResolution ? 2 : 1;
  const offsetTicks: -240 | -480 = unitRandom(input.context.seed, `hybrid-anticipation:${phrase.id}`) < 0.5
    ? -240 : -480;
  return {
    pulseTicks: PPQ,
    weights,
    syncopation: {
      displacedPosition,
      offsetTicks,
      resolvesAtPosition: displacedPosition === 2 ? 3 : null,
      rationale: displacedPosition === 2
        ? 'Anticipate the motif neighbor against the quarter pulse; retain its planned stepwise resolution on supplied harmony.'
        : 'Anticipate one chord-relative motif color against the quarter-note bass pulse; the selected pitch remains a supplied chord tone.',
    },
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
  const upperRegisterActivity = reading.registerOccupancy.middle + reading.registerOccupancy.high;
  const registerCrowded = reading.registerOccupancy.availability === 'available' && upperRegisterActivity >= 7;
  const ensembleDense = reading.activeTrackIds.length >= 5
    || (reading.registerOccupancy.total >= 14 && upperRegisterActivity >= 8);
  const hasExplicitLead = reading.explicitLeadTrackIds.length > 0;
  const leadNeedsSpace = hasExplicitLead && (ensembleDense || registerCrowded || reading.interaction !== 'interweave');
  const release = (phrase.function === 'release'
      && (dynamics.sourceEnergy.descendingTowardEnd || dynamics.sourceEnergy.nearSilence || dynamics.exit <= 1))
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

  if (dynamics.sourceEnergy.nearSilence || reading.interaction === 'yield-to-spotlight'
    || leadNeedsSpace || hasExplicitLeaveSpace || release) {
    kind = 'sparse-sustained';
    rationale = dynamics.sourceEnergy.nearSilence
      ? 'The supplied phrase contains near-silence; retain one sustained color or silence instead of adding a new pattern.'
      : reading.interaction === 'yield-to-spotlight' || leadNeedsSpace
        ? 'The marked orchestral spotlight or written register occupancy calls for a restrained sustained response, not a competing figure.'
        : hasExplicitLeaveSpace
          ? 'An explicit Composer leave-space reservation overlaps this phrase; preserve the reserved span instead of layering another texture.'
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
  } else if (hasRoomForFiguration && motif !== null
    && (profile.public.identity === 'chamber-counterpoint' || profile.public.identity === 'sonata-dialogue')
    && (phrase.function === 'development' || phrase.function === 'contrast')
    && dynamics.peak >= 2 && harmony.length >= 2) {
    kind = 'contrapuntal-dialogue';
    rationale = 'A chamber/sonata development has room between the supplied chord changes; let the right-hand subject and lower response enter independently.';
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
    `Analyzer reports ${reading.activeTrackIds.length} active written track(s); register onsets/bar low ${occupancy.low.toFixed(1)}, middle ${occupancy.middle.toFixed(1)}, high ${occupancy.high.toFixed(1)} (${occupancy.availability}).`,
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
  const intendedDensity: PianoDensity = dynamics.sourceEnergy.nearSilence
    ? 'very-sparse'
    : texture.kind === 'sparse-sustained' || texture.kind === 'short-flourishes'
      ? 'sparse'
      : texture.kind === 'block-chords'
        ? profile.voicingVoices >= 4 && reading.activeTrackIds.length < 3 ? 'broad' : 'moderate'
        : profile.voicingVoices <= 2 ? 'sparse' : 'moderate';
  const rhythmicIntent = texture.kind === 'sparse-sustained'
    ? 'hold through the supplied harmony; let the phrase release before adding another attack'
    : texture.kind === 'broken-chords'
      ? 'separate chord-tone fragments across the harmony span; avoid a repeating bar loop'
      : texture.kind === 'arpeggiated'
        ? 'unfold supplied chord tones toward the phrase peak, reversing or thinning with the energy arc'
        : texture.kind === 'melody-accompaniment'
          ? 'keep a chord-relative subject distinct from its lean, voice-led accompaniment'
          : texture.kind === 'block-chords'
            ? 'state the selected voicing together at structural harmony boundaries'
            : texture.kind === 'contrapuntal-dialogue'
              ? 'alternate the upper subject and lower response with independent attack spacing'
              : 'place a brief chord-relative flourish only within the selected piano fill window';
  const rhythmicPlan = phraseRhythmicPlan(input, phrase, motif, motifPlan.operation,
    intendedDensity, texture.kind, dynamics, profile);
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
  const reachesUpperArc = energy.some((entry) => entry.target >= 0.8);
  const functionName: PianoSectionIntention['function'] = sectionCount === 1 || index === 0
    ? 'opening'
    : index === sectionCount - 1
      ? 'closing'
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
        shape: nearSilence ? 'suspended-breath' as const : lastPhrase.dynamics.shape,
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
  const relationIds = chordActivityIds(analyzer, chord.id);
  const enriched = {
    ...reading,
    activeTrackIds: unique([...reading.activeTrackIds, ...relationIds]),
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
    const bass = selectBass(material, previousBass, phrase, profile, input.context.seed);
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
    const nearSilence = selectedPhrase?.dynamics.sourceEnergy.nearSilence ?? false;
    const hasLead = reading.explicitLeadTrackIds.length > 0;
    const hybridPulseUnderLead = profile.public.identity === 'hybrid-pulse-and-color'
      && hasLead && !nearSilence && reading.moments.length === 0 && reading.activeTrackIds.length < 4;
    const momentYield = reading.interaction === 'yield-to-spotlight'
      || (reading.interaction === 'leave-space' && (!hasLead || reading.activeTrackIds.length >= 4));
    const textureKind = selectedPhrase?.texture.kind;
    const handDensity: PianoDensity = nearSilence || momentYield ? 'very-sparse'
      : hasLead || reading.activeTrackIds.length >= 5
        || (reading.registerOccupancy.middle + reading.registerOccupancy.high >= 7) ? 'sparse'
        : textureKind === 'sparse-sustained' || textureKind === 'short-flourishes' ? 'sparse'
          : textureKind === 'block-chords'
            ? arrival && profile.voicingVoices >= 4 ? 'broad' : 'moderate'
            : textureKind === 'melody-accompaniment' ? 'sparse'
              : profile.voicingVoices <= 2 ? 'sparse' : 'moderate';
    const lhRole = nearSilence || momentYield ? 'yielding held tone or silence'
      : selectedPhrase?.texture.leftHandRole
        ?? (reading.activeRoles.some((role) => ['cellosBasses', 'basses', 'tuba', 'trombones'].includes(role))
          ? 'root-light counter-foundation under existing bass activity'
          : previousBass === bass ? 'hold a common bass tone through the chord change' : profile.public.leftHandRole);
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
              : reading.activeRoles.some((role) => ['cellosBasses', 'basses', 'tuba', 'trombones'].includes(role))
                ? 'sparse-approach' : 'change-with-harmony',
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
        explicitLeadTrackIds: reading.explicitLeadTrackIds,
        momentKinds: unique(reading.moments.map((moment) => moment.kind)),
        interaction,
        analyzerEvidence: reading.evidence,
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
  const entries = analyzer.observedFacts.instruments.flatMap((instrument) => instrument.relationships.fillWindows.items)
    .filter((entry) => entry.window.target === fill.target
      && entry.window.startTick === fill.startTick
      && entry.window.endTick === fill.endTick);
  if (!entries.length || !analyzer.observedFacts.instruments.length) return { available: false, activeIds: [], onsetCount: 0 };
  const activeIds = analyzer.observedFacts.instruments.flatMap((instrument) => {
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
 * Compose symbolic piano intentions from the exact engine input and its Phase
 * 4B analysis. The report is consumed as evidence; note-event generation is
 * deferred to the Realizer. Production integration is owned by
 * composeAllTracks, which invokes the Composer as part of Piano Engine V2.
 */
export function composePianoPlan(input: PianoEngineInput, analyzer: PianoAnalyzerReport): PianoComposerPlan {
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
    const plan = composePhraseIntention(input, phrase, index, motif, profile, reading,
      previousOperation, previousTexture, fillPlans);
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
    'This is an intention plan only: no MIDI notes, durations, velocities, articulations, or instrument patch choices are produced.',
    'Texture labels, roles, purposes, and transitions are symbolic Composer decisions; the existing Piano Realizer maps them to notes.',
    'The input has no key/mode or time-signature field; harmony is interpreted only from resolved chord symbols and pitch classes, and rhythmic cells remain relative.',
    'Analyzer activity is written-score evidence, not audible-state evidence; missing mute/solo state is not inferred.',
    'Only strings lead layers and the supplied tutti/soli/unison moments are available; other family lead spans and divisi/imitation details remain unavailable.',
    'Writing-phrase boundaries use supplied section boundaries, conductor moments/fill reservations, and established energy turns; salient interior energy reversals are also retained as dynamic-only segments without changing note-writing phrase boundaries.',
    ...(input.context.template.pianoEligible ? [] : ['The resolved template/write-eligibility gate says piano is not eligible; no piano material is planned.']),
    ...(!input.context.harmony.length ? ['No resolved chord spans were supplied; harmonic voicings, motif and ending are unavailable.'] : []),
  ];

  return freezePlan({
    version: 2,
    status,
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
