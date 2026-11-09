/**
 * Phase 6: realize a Phase 5 piano intention plan as piano MIDI notes.
 *
 * This module writes Piano notes only. It reads the Composer's resolved
 * harmonic, phrase, motif, dynamics, and orchestration intentions, plus the
 * immutable non-Piano note snapshot used to enforce the template's forbidden
 * octave policy. It never mutates or renders any non-Piano part.
 */
import { PPQ, type CcLane, type Note, type TempoEntry, type TimeSignature, type Track } from '../../shared/schema/types';
import { applyPianoOctavePolicy, type PianoOctavePolicyReport, type PianoPolicyExternalTrack } from './piano-octave-policy';
import { generatePianoPedalLane } from './piano-pedal';
import type {
  PianoComposerPlan,
  PianoHarmonicEvent,
  PianoMotifOperation,
  PianoPhraseDynamics,
  PianoPhraseIntention,
  PianoRegisterZone,
} from './piano-composer';

export type PianoRealizerTarget = Pick<Track, 'role' | 'family' | 'locked' | 'lowestNote' | 'highestNote'>;

export interface PianoRealizerInput {
  readonly plan: PianoComposerPlan;
  /** Only the piano target's write/range contract is read; notes are not mutated. */
  readonly targetTrack: PianoRealizerTarget | null;
  /** Project tick boundary supplied by the caller; no song length is inferred. */
  readonly projectEndTick: number;
  /** Final roster notes used by the template's Piano octave-policy guard. */
  readonly externalTracks?: readonly PianoPolicyExternalTrack[];
  /** Existing project timing used only for the rule audit's head/figuration exemptions. */
  readonly tempoMap?: readonly TempoEntry[];
  readonly timeSignature?: TimeSignature;
}

export interface PianoSuspensionAudit {
  readonly chordId: string;
  readonly preparedByChordId: string;
  readonly boundaryTick: number;
  readonly tensionPitchClass: number;
  readonly resolvesToPitchClass: number;
  readonly preparationFound: boolean;
  readonly resolutionFound: boolean;
  readonly complete: boolean;
  readonly preparationReason: string | null;
  readonly resolutionReason: string | null;
  /** Null only when the complete planned gesture survives realization. */
  readonly reason: string | null;
}

interface DraftNote {
  note: Note;
  hand: 'left' | 'right' | 'melody' | 'fill';
  chordId: string | null;
  /** Exact LH partner(s) for an explicitly planned suspension line only. */
  suspensionOctavePartners?: { chordId: string; pitch: number }[];
  /** Protects the prepared/resolving line from incidental same-pitch-class octave conflicts. */
  suspensionPart?: 'preparation' | 'resolution' | 'preparation-resolution';
}

interface RealizedChord {
  readonly event: PianoHarmonicEvent;
  readonly phrase: PianoPhraseIntention | null;
  readonly startTick: number;
  readonly endTick: number;
  readonly leftPitch: number | null;
  readonly rightPitches: readonly number[];
  readonly rolled: boolean;
}

interface SuspensionAttemptRecord {
  preparedStart: number | null;
  resolveAt: number | null;
  preparationReason: string | null;
  resolutionReason: string | null;
}

interface SuspensionAttempt {
  notes: DraftNote[];
  records: Map<string, SuspensionAttemptRecord>;
}

type Hand = 'left' | 'right' | 'melody' | 'fill';

const REGISTER_WINDOWS: Readonly<Record<PianoRegisterZone, readonly [number, number]>> = {
  bass: [29, 55],
  'low-middle': [40, 63],
  middle: [50, 76],
  'upper-middle': [60, 88],
  high: [70, 101],
};

const DYNAMIC_VELOCITY: readonly number[] = [30, 38, 48, 61, 75, 91];
const HAND_GAPS: readonly number[] = [8, 5, 2, 0];
const NOTE_TAG_PRIORITY: Readonly<Record<NonNullable<Note['roleTag']>, number>> = {
  anchor: 7,
  arrival: 6,
  answer: 5,
  shift: 4,
  flourish: 3,
  lift: 2,
  settle: 8,
  bed: 1,
  atmosphere: 1,
  punctuation: 1,
  power: 1,
};

const pc = (value: number): number => ((value % 12) + 12) % 12;
const pcDistance = (a: number, b: number): number => {
  const distance = Math.abs(pc(a) - pc(b));
  return Math.min(distance, 12 - distance);
};
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const isInteger = (value: number): boolean => Number.isFinite(value) && Number.isInteger(value);
const endOf = (note: Note): number => note.startTick + note.durationTicks;
const overlaps = (a: Note, b: Note): boolean => a.startTick < endOf(b) && b.startTick < endOf(a);

/** Stable label-salted randomness; never consumes or mutates a shared RNG. */
function unitRandom(seed: number, label: string): number {
  let hash = (Math.trunc(Number.isFinite(seed) ? seed : 0) ^ 0x811c9dc5) >>> 0;
  for (let index = 0; index < label.length; index++) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash += 0x6d2b79f5;
  let value = hash;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function freezeNotes(notes: readonly Note[]): readonly Note[] {
  return Object.freeze(notes.map((note) => Object.freeze({ ...note })));
}

function validInput(input: PianoRealizerInput): boolean {
  const { plan, targetTrack, projectEndTick } = input;
  return !!targetTrack
    && targetTrack.family === 'Keys'
    && targetTrack.role === 'piano'
    && !targetTrack.locked
    && isInteger(targetTrack.lowestNote)
    && isInteger(targetTrack.highestNote)
    && targetTrack.lowestNote >= 0
    && targetTrack.highestNote <= 127
    && targetTrack.lowestNote <= targetTrack.highestNote
    && isInteger(projectEndTick)
    && projectEndTick > 0
    && plan.status === 'composed'
    && plan.template.eligible
    && plan.harmonicEvents.length > 0;
}

function rangeForZone(zone: PianoRegisterZone, target: PianoRealizerTarget): [number, number] {
  const window = REGISTER_WINDOWS[zone];
  const low = Math.max(target.lowestNote, window[0]);
  const high = Math.min(target.highestNote, window[1]);
  return low <= high ? [Math.ceil(low), Math.floor(high)] : [target.lowestNote, target.highestNote];
}

function pitchesForClass(pitchClass: number, low: number, high: number): number[] {
  const pitches: number[] = [];
  for (let pitch = Math.ceil(low); pitch <= Math.floor(high); pitch++) {
    if (pc(pitch) === pc(pitchClass)) pitches.push(pitch);
  }
  return pitches;
}

function chooseBassPitch(
  event: PianoHarmonicEvent,
  target: PianoRealizerTarget,
  previousPitch: number | null,
  seed: number,
): number | null {
  const [low, high] = rangeForZone(event.hands.left.register, target);
  let candidates = pitchesForClass(event.voicing.leftHandBassPitchClass, low, high);
  if (!candidates.length) candidates = pitchesForClass(event.voicing.leftHandBassPitchClass, target.lowestNote, target.highestNote);
  if (!candidates.length) return null;

  if (event.hands.left.motion === 'hold-common-tone'
    && previousPitch !== null
    && pc(previousPitch) === pc(event.voicing.leftHandBassPitchClass)
    && candidates.includes(previousPitch)) return previousPitch;

  const center = clamp((low + high) / 2, target.lowestNote, target.highestNote);
  const reference = previousPitch ?? center;
  return [...candidates].sort((a, b) => {
    const scoreA = Math.abs(a - reference) * (previousPitch === null ? 0.2 : 1)
      + Math.abs(a - center) * 0.28
      + unitRandom(seed, `bass:${event.chord.id}:${a}`) * 0.06;
    const scoreB = Math.abs(b - reference) * (previousPitch === null ? 0.2 : 1)
      + Math.abs(b - center) * 0.28
      + unitRandom(seed, `bass:${event.chord.id}:${b}`) * 0.06;
    return scoreA - scoreB || a - b;
  })[0];
}

function voicingPitchClasses(
  event: PianoHarmonicEvent,
  previous: readonly number[],
  requiredPitchClasses: readonly number[] = [],
): number[] {
  const all = [...new Set(event.voicing.rightHandPitchClasses
    .filter((tone) => Number.isInteger(tone) && tone >= 0 && tone < 12))];
  if (!all.length) return [];
  const densityCount = event.hands.right.density === 'very-sparse' ? 1
    : event.hands.right.density === 'sparse' ? 2
      : event.hands.right.density === 'moderate' ? 3 : 4;
  const interactionCount = event.orchestration.interaction === 'yield-to-spotlight' ? 1
    : event.orchestration.interaction === 'leave-space' ? 2 : densityCount;
  const motionCount = event.hands.right.motion === 'yield' ? 1
    : event.hands.right.motion === 'inner-voice' ? Math.min(2, interactionCount)
      : event.hands.right.motion === 'fragment' ? Math.min(2, interactionCount) : interactionCount;
  const limit = Math.max(1, Math.min(all.length, densityCount, motionCount));
  const prior = new Set(previous.map(pc));
  const common = new Set(event.voiceLeading.commonPitchClasses.map(pc));
  const extensions = new Set(event.voicing.selectedExtensionPitchClasses.map(pc));
  const ranked = all.map((tone, index) => ({ tone, index })).sort((a, b) => {
    const score = (tone: number, index: number): number =>
      (common.has(tone) && prior.has(tone) ? -5 : 0)
      + (extensions.has(tone) ? -1 : 0)
      + (event.structuralRole === 'arrival' && tone === event.chord.rootPitchClass ? -0.5 : 0)
      + index * 0.01;
    return score(a.tone, a.index) - score(b.tone, b.index);
  });
  const selected = ranked.slice(0, limit).map(({ tone }) => tone);
  // Keep the Composer's planned suspension in its preparing chord even when
  // ordinary texture density would otherwise omit that specific voice.
  for (const required of requiredPitchClasses.map(pc)) {
    if (!all.includes(required) || selected.includes(required)) continue;
    if (selected.length < limit) selected.push(required);
    else if (selected.length) selected[selected.length - 1] = required;
  }
  return [...new Set(selected)];
}

function minimumVoiceMotion(previous: readonly number[], current: readonly number[]): number {
  if (!previous.length || !current.length) return Math.max(previous.length, current.length) * 8;
  let best = Number.POSITIVE_INFINITY;
  const assign = (index: number, used: Set<number>, cost: number) => {
    if (index === current.length) {
      best = Math.min(best, cost + Math.max(0, previous.length - used.size) * 8);
      return;
    }
    for (let priorIndex = 0; priorIndex < previous.length; priorIndex++) {
      if (used.has(priorIndex)) continue;
      used.add(priorIndex);
      assign(index + 1, used, cost + Math.abs(current[index] - previous[priorIndex]));
      used.delete(priorIndex);
    }
    assign(index + 1, used, cost + 8);
  };
  assign(0, new Set(), 0);
  return best;
}

function scoreVoicing(
  pitches: readonly number[],
  previous: readonly number[],
  previousByClass: ReadonlyMap<number, number>,
  common: ReadonlySet<number>,
  center: number,
  identity: PianoComposerPlan['template']['style']['identity'],
  seed: number,
  chordId: string,
): number {
  const ordered = [...pitches].sort((a, b) => a - b);
  let spacing = 0;
  for (let index = 1; index < ordered.length; index++) {
    const interval = ordered[index] - ordered[index - 1];
    if (interval < 3) spacing += (3 - interval) * 3.5;
    if (interval > 15) spacing += (interval - 15) * (identity === 'cinematic-expanse' ? 0.12 : 0.42);
  }
  const commonMotion = ordered.reduce((sum, pitch) => {
    const previousPitch = previousByClass.get(pc(pitch));
    return sum + (common.has(pc(pitch)) && previousPitch !== undefined ? Math.abs(pitch - previousPitch) * 2.4 : 0);
  }, 0);
  const registerCost = ordered.reduce((sum, pitch) => sum + Math.abs(pitch - center) * 0.12, 0);
  const span = ordered.length > 1 ? ordered[ordered.length - 1] - ordered[0] : 0;
  const spanReward = identity === 'cinematic-expanse' ? Math.min(span, 18) * 0.10 : 0;
  return minimumVoiceMotion(previous, ordered) * 0.58
    + commonMotion
    + registerCost
    + spacing
    - spanReward
    + unitRandom(seed, `voicing:${chordId}:${ordered.join(',')}`) * 0.08;
}

function chooseRightHandPitches(
  event: PianoHarmonicEvent,
  pitchClasses: readonly number[],
  leftPitch: number | null,
  previous: readonly number[],
  target: PianoRealizerTarget,
  seed: number,
  identity: PianoComposerPlan['template']['style']['identity'],
): number[] {
  if (!pitchClasses.length) return [];
  const zone = rangeForZone(event.hands.right.register, target);
  const preferredHigh = Math.min(zone[1], Math.round(zone[0] + (zone[1] - zone[0]) * 0.82));
  const previousByClass = new Map<number, number>();
  for (const pitch of previous) previousByClass.set(pc(pitch), pitch);
  const common = new Set(event.voiceLeading.commonPitchClasses.map(pc));
  const center = (zone[0] + preferredHigh) / 2;

  for (const high of [preferredHigh, zone[1]]) {
    for (const gap of HAND_GAPS) {
      const low = Math.max(zone[0], target.lowestNote, leftPitch === null ? target.lowestNote : leftPitch + gap);
      if (low > high) continue;
      const choices = pitchClasses.map((tone) => pitchesForClass(tone, low, high));
      const accessible = choices.flatMap((candidates, index) => candidates.length ? [index] : []);
      if (!accessible.length) continue;
      const activeChoices = accessible.map((index) => choices[index]);
      let best: number[] = [];
      let bestScore = Number.POSITIVE_INFINITY;
      const selected: number[] = [];
      const visit = (index: number) => {
        if (index === activeChoices.length) {
          const ordered = [...selected].sort((a, b) => a - b);
          const score = scoreVoicing(ordered, previous, previousByClass, common, center, identity, seed, event.chord.id);
          if (score < bestScore) { bestScore = score; best = ordered; }
          return;
        }
        for (const pitch of activeChoices[index]) {
          if (selected.includes(pitch)) continue;
          // A permitted doubling is not a request to invent one.
          if (leftPitch !== null && pc(pitch) === pc(leftPitch)) continue;
          selected.push(pitch);
          visit(index + 1);
          selected.pop();
        }
      };
      visit(0);
      if (best.length) return best;
    }
  }
  return [];
}

function phraseAtTick(plan: PianoComposerPlan, tick: number, phraseId?: string | null): PianoPhraseIntention | null {
  if (phraseId) {
    const byId = plan.phrases.find((phrase) => phrase.id === phraseId);
    if (byId) return byId;
  }
  return plan.phrases.find((phrase) => tick >= phrase.startTick && tick < phrase.endTick) ?? null;
}

function shouldRoll(
  plan: PianoComposerPlan,
  event: PianoHarmonicEvent,
  phrase: PianoPhraseIntention | null,
): boolean {
  if (event.hands.right.motion === 'yield'
    || event.orchestration.interaction === 'yield-to-spotlight'
    || event.hands.right.density === 'very-sparse') return false;
  const probability: Record<PianoComposerPlan['template']['style']['identity'], number> = {
    'chamber-counterpoint': 0.34,
    'sonata-dialogue': 0.25,
    'vocal-space': 0.10,
    'cinematic-expanse': 0.38,
    'hybrid-pulse-and-color': 0.30,
    'adaptive-spacious': 0.24,
  };
  const emphasis = event.orchestration.momentKinds.length > 0 || phrase?.function === 'arrival';
  const threshold = emphasis ? probability[plan.template.style.identity] * 0.55 : probability[plan.template.style.identity];
  return unitRandom(plan.seed, `roll:${event.chord.id}:${event.chord.startTick}`) < threshold;
}

function makeRealizedChords(
  plan: PianoComposerPlan,
  target: PianoRealizerTarget,
  projectEndTick: number,
): RealizedChord[] {
  const ordered = [...plan.harmonicEvents]
    .filter((event) => isInteger(event.chord.startTick)
      && isInteger(event.chord.endTick)
      && event.chord.startTick >= 0
      && event.chord.endTick > event.chord.startTick
      && event.chord.startTick < projectEndTick)
    .sort((a, b) => a.chord.startTick - b.chord.startTick || b.chord.endTick - a.chord.endTick);
  // Resolve duplicate boundaries deterministically in favor of the longer span.
  const source = ordered.filter((event, index) => index === 0
    || event.chord.startTick !== ordered[index - 1].chord.startTick);
  const chords: RealizedChord[] = [];
  let previousBass: number | null = null;
  let previousRight: number[] = [];

  for (let index = 0; index < source.length; index++) {
    const event = source[index];
    const startTick = event.chord.startTick;
    const nextStart = source[index + 1]?.chord.startTick;
    const endTick = Math.min(projectEndTick, event.chord.endTick,
      nextStart !== undefined && nextStart > startTick ? nextStart : projectEndTick);
    if (endTick <= startTick) continue;
    const phrase = phraseAtTick(plan, startTick, event.phraseId);
    const leftPitch = chooseBassPitch(event, target, previousBass, plan.seed);
    const nextSuspension = source[index + 1]?.suspension;
    const requiredTension = nextSuspension?.preparedByChordId === event.chord.id
      ? [nextSuspension.tensionPitchClass] : [];
    const rightPitchClasses = voicingPitchClasses(event, previousRight, requiredTension);
    const rightPitches = chooseRightHandPitches(
      event,
      rightPitchClasses,
      leftPitch,
      previousRight,
      target,
      plan.seed,
      plan.template.style.identity,
    );
    chords.push({
      event,
      phrase,
      startTick,
      endTick,
      leftPitch,
      rightPitches,
      rolled: rightPitches.length > 1 && shouldRoll(plan, event, phrase),
    });
    previousBass = leftPitch;
    previousRight = rightPitches;
  }
  return chords;
}

function phraseProgress(phrase: PianoPhraseIntention, tick: number): number {
  const length = phrase.endTick - phrase.startTick;
  return length > 0 ? clamp((tick - phrase.startTick) / length, 0, 1) : 0;
}

function smooth(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function phraseIntensity(dynamics: PianoPhraseDynamics, progress: number): number {
  const t = clamp(progress, 0, 1);
  if (dynamics.intensityCurve.length) {
    const curve = [...dynamics.intensityCurve].sort((a, b) => a.position - b.position);
    if (t <= curve[0].position) return curve[0].intensity;
    for (let index = 0; index + 1 < curve.length; index++) {
      const left = curve[index];
      const right = curve[index + 1];
      if (t > right.position) continue;
      const span = right.position - left.position;
      if (span <= 0) return Math.max(left.intensity, right.intensity);
      return mix(left.intensity, right.intensity, smooth((t - left.position) / span));
    }
    return curve[curve.length - 1].intensity;
  }

  // Compatibility for hand-authored plans without a source trajectory.
  const peakPosition = clamp(dynamics.peakPosition, 0.05, 0.95);
  switch (dynamics.shape) {
    case 'rising-arc':
    case 'held-arrival':
    case 'arch':
      return t < peakPosition
        ? mix(dynamics.entry, dynamics.peak, smooth(t / peakPosition))
        : mix(dynamics.peak, dynamics.exit, smooth((t - peakPosition) / (1 - peakPosition)));
    case 'unwind':
    case 'plateau':
      return mix(dynamics.entry, dynamics.exit, smooth(t));
    case 'suspended-breath':
      return mix(Math.min(dynamics.entry, 1), Math.min(dynamics.exit, 1), smooth(t));
  }
}

function eventAtTick(chords: readonly RealizedChord[], tick: number): RealizedChord | null {
  return chords.find((chord) => tick >= chord.startTick && tick < chord.endTick) ?? null;
}

function intensityFor(
  plan: PianoComposerPlan,
  chord: RealizedChord | null,
  phrase: PianoPhraseIntention | null,
  tick: number,
): number {
  if (!phrase) return chord?.event.dynamicIntent.intensity ?? 2;
  let intensity = phraseIntensity(phrase.dynamics, phraseProgress(phrase, tick));
  // Arrival peaks are already explicit in the Composer's planned curve. The
  // Realizer must not restore a scalar event-level floor that contradicts an
  // intentionally descending phrase.
  if (plan.template.style.identity === 'cinematic-expanse' && phrase.dynamics.emotionalColor === 'luminous') intensity += 0.15;
  return clamp(intensity, 0, 5);
}

function velocityAtIntensity(intensity: number): number {
  const value = clamp(intensity, 0, 5);
  const lower = Math.floor(value);
  const upper = Math.ceil(value);
  return mix(DYNAMIC_VELOCITY[lower], DYNAMIC_VELOCITY[upper], value - lower);
}

function velocityFor(
  plan: PianoComposerPlan,
  chord: RealizedChord | null,
  phrase: PianoPhraseIntention | null,
  tick: number,
  hand: Hand,
  accent = 0,
): number {
  const intensity = clamp(intensityFor(plan, chord, phrase, tick), 0, 5);
  let velocity = velocityAtIntensity(intensity) + accent;
  if (hand === 'left') velocity -= 5;
  else if (hand === 'melody' || hand === 'fill') velocity += hand === 'melody' ? 4 : 2;
  if (chord?.event.structuralRole === 'arrival' && hand !== 'left') velocity += 3;
  if (phrase) {
    if (phrase.dynamics.emotionalColor === 'intimate' || phrase.dynamics.emotionalColor === 'reflective') velocity -= 2;
    if (phrase.dynamics.emotionalColor === 'yearning') velocity -= 3;
    if (phrase.dynamics.emotionalColor === 'resolute' || phrase.dynamics.emotionalColor === 'luminous') velocity += 2;
  }
  return Math.round(clamp(velocity, 1, 112));
}

function tieForwardEnd(
  chords: readonly RealizedChord[],
  index: number,
  pitch: number,
  hand: 'left' | 'right',
): { lastIndex: number; tick: number } {
  let lastIndex = index;
  for (let nextIndex = index + 1; nextIndex < chords.length; nextIndex++) {
    const previous = chords[lastIndex];
    const next = chords[nextIndex];
    if (previous.endTick !== next.startTick || previous.phrase?.id !== next.phrase?.id) break;
    if (hand === 'left') {
      if (next.leftPitch !== pitch || next.event.hands.left.motion !== 'hold-common-tone') break;
    } else {
      const pitchClass = pc(pitch);
      if (!next.event.voiceLeading.commonPitchClasses.map(pc).includes(pitchClass)
        || !next.rightPitches.includes(pitch)) break;
    }
    lastIndex = nextIndex;
  }
  return { lastIndex, tick: chords[lastIndex].endTick };
}

function continuesFromPrevious(chords: readonly RealizedChord[], index: number, pitch: number, hand: 'left' | 'right'): boolean {
  if (index <= 0) return false;
  const previous = chords[index - 1];
  const current = chords[index];
  if (previous.endTick !== current.startTick || previous.phrase?.id !== current.phrase?.id) return false;
  if (hand === 'left') {
    return current.leftPitch === pitch && current.event.hands.left.motion === 'hold-common-tone';
  }
  return current.rightPitches.includes(pitch)
    && previous.rightPitches.includes(pitch)
    && current.event.voiceLeading.commonPitchClasses.map(pc).includes(pc(pitch));
}

function chordGate(
  plan: PianoComposerPlan,
  realized: RealizedChord,
  tied: boolean,
  isFinal: boolean,
  hand: 'left' | 'right',
): number {
  if (isFinal) return 1;
  if (tied) return 0.98;
  if (realized.event.dynamicIntent.gesture === 'suspended-breath') return 0.95;
  if (realized.event.structuralRole === 'release') return hand === 'right' ? 0.72 : 0.78;
  const base: Record<PianoComposerPlan['template']['style']['identity'], number> = {
    'chamber-counterpoint': 0.84,
    'sonata-dialogue': 0.91,
    'vocal-space': 0.76,
    'cinematic-expanse': 0.94,
    'hybrid-pulse-and-color': 0.82,
    'adaptive-spacious': 0.85,
  };
  if (realized.event.hands.right.density === 'very-sparse') return Math.max(base[plan.template.style.identity], 0.92);
  return base[plan.template.style.identity];
}

function keepLeftAttack(plan: PianoComposerPlan, chord: RealizedChord): boolean {
  if (chord.event.hands.left.motion !== 'yield') return true;
  if (chord.event.structuralRole === 'arrival') return true;
  // Yield on most chord changes beneath an explicit lead or near-silent span.
  return unitRandom(plan.seed, `left-yield:${chord.event.chord.id}`) >= 0.78;
}

function realizeChordTones(
  plan: PianoComposerPlan,
  chords: readonly RealizedChord[],
  projectEndTick: number,
): DraftNote[] {
  const notes: DraftNote[] = [];
  for (let index = 0; index < chords.length; index++) {
    const chord = chords[index];
    const leftAllowed = keepLeftAttack(plan, chord);
    if (chord.leftPitch !== null && leftAllowed && !continuesFromPrevious(chords, index, chord.leftPitch, 'left')) {
      const chain = tieForwardEnd(chords, index, chord.leftPitch, 'left');
      const chainIsFinal = plan.ending.chordId !== null
        && chords[chain.lastIndex].event.chord.id === plan.ending.chordId;
      let gate = chordGate(plan, chord, chain.lastIndex > index, chainIsFinal, 'left');
      if (!chainIsFinal && chord.event.hands.left.motion === 'sparse-approach') gate = Math.min(gate, 0.72);
      const endTick = Math.min(projectEndTick,
        Math.max(chord.startTick + 1, Math.round(chord.startTick + (chain.tick - chord.startTick) * gate)));
      notes.push({
        hand: 'left',
        chordId: chord.event.chord.id,
        note: {
          pitch: chord.leftPitch,
          startTick: chord.startTick,
          durationTicks: endTick - chord.startTick,
          velocity: velocityFor(plan, chord, chord.phrase, chord.startTick, 'left'),
          roleTag: 'anchor',
          ...(chain.lastIndex > index || gate >= 0.9 ? { articulation: 'legato' as const } : {}),
        },
      });
    }

    for (let voiceIndex = 0; voiceIndex < chord.rightPitches.length; voiceIndex++) {
      const pitch = chord.rightPitches[voiceIndex];
      const hasCrossingVoice = notes.some((draft) => draft.hand !== 'left' && draft.note.pitch === pitch
        && draft.note.startTick < chord.startTick && endOf(draft.note) > chord.startTick);
      const nextSuspension = chords[index + 1]?.event.suspension;
      const isExplicitPreparation = nextSuspension?.preparedByChordId === chord.event.chord.id
        && pc(nextSuspension.tensionPitchClass) === pc(pitch);
      if (continuesFromPrevious(chords, index, pitch, 'right') && hasCrossingVoice && !isExplicitPreparation) continue;
      const chain = tieForwardEnd(chords, index, pitch, 'right');
      const chainIsFinal = plan.ending.chordId !== null
        && chords[chain.lastIndex].event.chord.id === plan.ending.chordId;
      const spread = chord.rolled && chord.rightPitches.length > 1
        ? Math.round(Math.min(PPQ / 4, (chord.endTick - chord.startTick) * 0.08)
          * voiceIndex / (chord.rightPitches.length - 1))
        : 0;
      const startTick = chord.startTick + spread;
      if (startTick >= chord.endTick || startTick >= projectEndTick) continue;
      const gate = chordGate(plan, chord, chain.lastIndex > index, chainIsFinal, 'right');
      const endTick = Math.min(projectEndTick,
        Math.max(startTick + 1, Math.round(startTick + (chain.tick - startTick) * gate)));
      const roleTag = chord.event.structuralRole === 'arrival' ? 'arrival' : 'bed';
      notes.push({
        hand: 'right',
        chordId: chord.event.chord.id,
        note: {
          pitch,
          startTick,
          durationTicks: endTick - startTick,
          velocity: velocityFor(plan, chord, chord.phrase, startTick, 'right', voiceIndex === chord.rightPitches.length - 1 ? 2 : 0),
          roleTag,
          ...(chain.lastIndex > index || gate >= 0.9 ? { articulation: 'legato' as const } : {}),
        },
      });
    }
  }
  return notes;
}

function suspensionCanUseOctavePartner(plan: PianoComposerPlan): boolean {
  // A prepared suspension is a planned melodic voice, not a generic chord
  // doubling. `climaxOnly` still constrains other doublings, but must not erase
  // this explicit voice-leading line; `forbidden` retains its stricter policy.
  return plan.templateConstraints.octaveDoubling === 'allowed'
    || plan.templateConstraints.octaveDoubling === 'climaxOnly';
}

function realizeSuspensions(
  plan: PianoComposerPlan,
  chords: readonly RealizedChord[],
  target: PianoRealizerTarget,
  projectEndTick: number,
  chordNotes: DraftNote[],
): SuspensionAttempt {
  const notes: DraftNote[] = [];
  const records = new Map<string, SuspensionAttemptRecord>();
  for (const current of chords) {
    const intention = current.event.suspension;
    if (!intention || intention.kind !== 'prepared-stepwise-suspension') continue;
    const record: SuspensionAttemptRecord = {
      preparedStart: null,
      resolveAt: null,
      preparationReason: null,
      resolutionReason: null,
    };
    records.set(current.event.chord.id, record);
    const reject = (preparationReason: string, resolutionReason = preparationReason) => {
      record.preparationReason = preparationReason;
      record.resolutionReason = resolutionReason;
    };
    const previous = chords.find((chord) => chord.event.chord.id === intention.preparedByChordId);
    if (!previous) {
      reject(`The Composer names preparing chord ${intention.preparedByChordId}, but it is absent from the valid realized harmony sequence.`);
      continue;
    }
    if (previous.endTick !== current.startTick) {
      reject(`Preparing chord ${intention.preparedByChordId} ends at tick ${previous.endTick}, not at resolving chord ${current.event.chord.id}'s boundary ${current.startTick}.`);
      continue;
    }
    if (!previous.event.chord.availablePitchClasses.map(pc).includes(pc(intention.tensionPitchClass))) {
      reject(`Pitch class ${pc(intention.tensionPitchClass)} is not available in preparing chord ${intention.preparedByChordId}.`);
      continue;
    }
    if (current.event.chord.availablePitchClasses.map(pc).includes(pc(intention.tensionPitchClass))) {
      reject(`Pitch class ${pc(intention.tensionPitchClass)} remains in resolving chord ${current.event.chord.id}; the supplied harmony does not support this suspension.`);
      continue;
    }
    const tensionPitch = previous.rightPitches.find((pitch) => pc(pitch) === pc(intention.tensionPitchClass));
    if (tensionPitch === undefined) {
      reject(`Preparing chord ${intention.preparedByChordId} could not voice required tension pitch class ${pc(intention.tensionPitchClass)} in the playable right-hand register.`);
      continue;
    }
    const preparedDoubling = previous.leftPitch !== null && pc(previous.leftPitch) === pc(tensionPitch);
    const resolutionDoubling = current.leftPitch !== null
      && pc(current.leftPitch) === pc(intention.resolvesToPitchClass);
    const canUseSuspensionOctave = suspensionCanUseOctavePartner(plan);
    if ((preparedDoubling || resolutionDoubling) && !canUseSuspensionOctave) {
      const points = [
        ...(preparedDoubling ? ['the prepared tension would double the left-hand bass'] : []),
        ...(resolutionDoubling ? ['the resolution would double the left-hand bass'] : []),
      ];
      reject(`The template's ${plan.templateConstraints.octaveDoubling} octave policy blocks the planned line because ${points.join(' and ')}.`,
        `The template's ${plan.templateConstraints.octaveDoubling} octave policy blocks the planned line because ${points.join(' and ')}.`);
      continue;
    }

    const voiceIndex = previous.rightPitches.indexOf(tensionPitch);
    const spread = previous.rolled && previous.rightPitches.length > 1
      ? Math.round(Math.min(PPQ / 4, (previous.endTick - previous.startTick) * 0.08)
        * voiceIndex / (previous.rightPitches.length - 1))
      : 0;
    const preparedStart = previous.startTick + spread;
    const span = current.endTick - current.startTick;
    const delay = Math.min(PPQ / 2, Math.max(1, Math.round(span * 0.18)));
    const resolveAt = current.startTick + delay;
    record.preparedStart = preparedStart;
    record.resolveAt = resolveAt;
    if (preparedStart >= current.startTick || resolveAt <= preparedStart) {
      reject(`No positive preparation-to-resolution span remains before chord boundary tick ${current.startTick}.`);
      continue;
    }
    if (resolveAt >= current.endTick || resolveAt >= projectEndTick) {
      reject(`The planned resolution at tick ${resolveAt} lies outside resolving chord ${current.event.chord.id} or the project boundary.`);
      continue;
    }

    // A suspension belongs to the resolving chord even when a phrase boundary
    // falls on the same tick; chord harmony, not phrase segmentation, controls it.
    const [zoneLow, zoneHigh] = rangeForZone(current.event.hands.right.register, target);
    const low = Math.max(zoneLow, target.lowestNote,
      current.leftPitch === null ? target.lowestNote : current.leftPitch + 1);
    const expectedStep = clamp(Math.round(intention.resolutionDistanceSemitones), 1, 2);
    const candidates = pitchesForClass(intention.resolvesToPitchClass, low, zoneHigh)
      .filter((pitch) => Math.abs(pitch - tensionPitch) === expectedStep);
    if (!candidates.length) {
      reject(`No resolution pitch class ${pc(intention.resolvesToPitchClass)} lies exactly ${expectedStep} semitone${expectedStep === 1 ? '' : 's'} from prepared pitch ${tensionPitch} in the planned right-hand register; no orphan tension was emitted.`);
      continue;
    }
    const resolutionPitch = candidates.sort((a, b) =>
      Math.abs(a - (zoneLow + zoneHigh) / 2) - Math.abs(b - (zoneLow + zoneHigh) / 2)
      || a - b)[0];
    const resolutionDuration = Math.min(
      PPQ / 2,
      current.endTick - resolveAt,
      projectEndTick - resolveAt,
    );
    if (resolutionDuration < 1) {
      reject(`The resolving chord has no positive duration remaining after tick ${resolveAt}.`);
      continue;
    }

    const existingPreparation = chordNotes
      .filter(({ note }) => note.pitch === tensionPitch
        && note.startTick <= preparedStart && endOf(note) >= preparedStart)
      .sort((a, b) => b.note.startTick - a.note.startTick)[0];
    const preparedNoteStart = existingPreparation?.note.startTick ?? preparedStart;
    const preparedDuration = resolveAt - preparedNoteStart;
    if (preparedDuration < 1) {
      reject(`The prepared voice at pitch ${tensionPitch} would begin at or after its planned resolution tick ${resolveAt}.`);
      continue;
    }
    record.preparedStart = preparedNoteStart;
    if (existingPreparation) {
      // End at the planned stepwise resolution rather than letting an ordinary
      // chord-bed gate carry the dissonance beyond its intended resolve point.
      existingPreparation.note.durationTicks = preparedDuration;
      existingPreparation.note.roleTag = 'answer';
      existingPreparation.note.articulation = 'legato';
      existingPreparation.suspensionPart = 'preparation';
      existingPreparation.hand = 'melody';
      existingPreparation.chordId = previous.event.chord.id;
      if (preparedDoubling && previous.leftPitch !== null) {
        existingPreparation.suspensionOctavePartners ??= [];
        existingPreparation.suspensionOctavePartners.push({
          chordId: previous.event.chord.id,
          pitch: previous.leftPitch,
        });
      }
    } else {
      notes.push({
        hand: 'melody',
        chordId: previous.event.chord.id,
        suspensionPart: 'preparation',
        ...(preparedDoubling && previous.leftPitch !== null ? {
          suspensionOctavePartners: [{ chordId: previous.event.chord.id, pitch: previous.leftPitch }],
        } : {}),
        note: {
          pitch: tensionPitch,
          startTick: preparedNoteStart,
          durationTicks: preparedDuration,
          velocity: velocityFor(plan, previous, previous.phrase, preparedStart, 'melody'),
          roleTag: 'answer',
          articulation: 'legato',
        },
      });
    }
    notes.push({
      hand: 'melody',
      chordId: current.event.chord.id,
      suspensionPart: 'resolution',
      ...(resolutionDoubling && current.leftPitch !== null ? {
        suspensionOctavePartners: [{ chordId: current.event.chord.id, pitch: current.leftPitch }],
      } : {}),
      note: {
        pitch: resolutionPitch,
        startTick: resolveAt,
        durationTicks: resolutionDuration,
        velocity: velocityFor(plan, current, current.phrase, resolveAt, 'melody', 1),
        roleTag: 'settle',
        articulation: 'legato',
      },
    });
  }

  // When one planned suspension resolves to the exact pitch that the next
  // Composer event prepares, let that resolution carry forward as the next
  // preparation. This preserves a single connected voice through consecutive
  // suspensions instead of letting a same-pitch reattack split the crossing.
  for (const current of chords) {
    const suspension = current.event.suspension;
    if (!suspension || suspension.kind !== 'prepared-stepwise-suspension') continue;
    const previous = chords.find((chord) => chord.event.chord.id === suspension.preparedByChordId);
    const previousSuspension = previous?.event.suspension;
    const nextResolveAt = records.get(current.event.chord.id)?.resolveAt;
    if (!previous || !previousSuspension || previousSuspension.kind !== 'prepared-stepwise-suspension'
      || pc(previousSuspension.resolvesToPitchClass) !== pc(suspension.tensionPitchClass)
      || nextResolveAt === undefined || nextResolveAt === null) continue;
    const carriedResolution = notes.find((draft) => draft.chordId === previous.event.chord.id
      && draft.note.roleTag === 'settle'
      && pc(draft.note.pitch) === pc(suspension.tensionPitchClass)
      && draft.note.startTick < current.startTick);
    if (!carriedResolution || nextResolveAt <= carriedResolution.note.startTick) continue;
    carriedResolution.note.durationTicks = nextResolveAt - carriedResolution.note.startTick;
    carriedResolution.suspensionPart = 'preparation-resolution';
  }
  return { notes, records };
}

function selectedMotifPositions(phrase: PianoPhraseIntention): number[] {
  let positions: number[];
  switch (phrase.motif.operation) {
    case 'introduce':
    case 'sequence-in-new-harmony':
    case 'rhythmic-augmentation':
    case 'interval-expansion':
    case 'invert-and-reframe':
      positions = [0, 1, 2, 3];
      break;
    case 'fragmented-recall':
    case 'fragment-to-landing':
      positions = [0, 1];
      break;
    case 'withhold-under-lead':
    case 'unavailable':
      positions = [];
      break;
  }
  if (phrase.dynamics.sourceEnergy.nearSilence) return [];
  if (phrase.intendedDensity === 'very-sparse') return positions.slice(0, 1);
  if (phrase.intendedDensity === 'sparse') return positions.slice(0, 2);
  return positions;
}

function motifContour(motif: NonNullable<PianoComposerPlan['motif']>, operation: PianoMotifOperation): number[] {
  const contour = [...motif.intervalContour].filter(Number.isFinite);
  if (operation === 'invert-and-reframe') return contour.map((interval) => -interval);
  if (operation === 'interval-expansion' && contour.length) {
    let widest = 0;
    for (let index = 1; index < contour.length; index++) {
      if (Math.abs(contour[index]) > Math.abs(contour[widest])) widest = index;
    }
    const sign = contour[widest] < 0 ? -1 : 1;
    contour[widest] = sign * Math.min(7, Math.abs(contour[widest]) + 2);
  }
  return contour;
}

function baseMotifPitchClasses(
  motif: NonNullable<PianoComposerPlan['motif']>,
  operation: PianoMotifOperation,
): number[] {
  const contour = motifContour(motif, operation);
  const pitches = [pc(motif.anchorPitchClass)];
  for (const interval of contour) pitches.push(pc(pitches[pitches.length - 1] + interval));
  return motif.tones.map((tone, index) => pitches[index] ?? pc(tone.pitchClass));
}

function closestChordTone(ideal: number, event: RealizedChord, seed: number, label: string): number | null {
  const tones = [...new Set(event.event.chord.availablePitchClasses.map(pc))];
  if (!tones.length) return null;
  return tones.sort((a, b) => pcDistance(a, ideal) - pcDistance(b, ideal)
    || unitRandom(seed, `${label}:${a}`) - unitRandom(seed, `${label}:${b}`)
    || a - b)[0];
}

function motifPitchClassAt(
  plan: PianoComposerPlan,
  motifPitches: readonly number[],
  operation: PianoMotifOperation,
  position: number,
  tick: number,
  resolutionTick: number | null,
  phraseEntryRoot: number,
  originRoot: number,
  chords: readonly RealizedChord[],
  blocked: ReadonlySet<number>,
  seed: number,
): number | null {
  const event = eventAtTick(chords, tick);
  if (!event) return null;
  const motifPitch = motifPitches[position] ?? plan.motif?.anchorPitchClass ?? 0;
  const localHarmonyShift = operation === 'sequence-in-new-harmony'
    ? pc(event.event.chord.rootPitchClass - phraseEntryRoot) : 0;
  const ideal = pc(motifPitch + pc(phraseEntryRoot - originRoot) + localHarmonyShift);
  if (position === 2 && plan.motif?.tensionResolution.kind === 'chromatic-neighbor') {
    const resolutionEvent = resolutionTick === null ? null : eventAtTick(chords, resolutionTick);
    const resolutionMotifPitch = motifPitches[3] ?? motifPitch;
    const idealResolution = pc(resolutionMotifPitch + pc(phraseEntryRoot - originRoot)
      + (operation === 'sequence-in-new-harmony' && resolutionEvent
        ? pc(resolutionEvent.event.chord.rootPitchClass - phraseEntryRoot) : 0));
    const resolution = resolutionEvent
      ? closestChordTone(idealResolution, resolutionEvent, seed, 'motif-resolution')
      : null;
    if (resolution !== null) {
      const candidates = [1, -1, 2, -2]
        .map((step) => pc(resolution + step))
        .filter((tone) => !event.event.chord.availablePitchClasses.map(pc).includes(tone) && !blocked.has(tone));
      if (candidates.length) {
        return candidates.sort((a, b) => pcDistance(a, ideal) - pcDistance(b, ideal)
          || unitRandom(seed, `motif-neighbor:${position}:${a}`) - unitRandom(seed, `motif-neighbor:${position}:${b}`)
          || a - b)[0];
      }
    }
  }
  return closestChordTone(ideal, event, seed, `motif-tone:${position}`);
}

function normalizedWeights(weights: readonly number[]): number[] {
  const clean = weights.slice(0, 4).map((weight) => Number.isFinite(weight) && weight > 0 ? weight : 0);
  while (clean.length < 4) clean.push(1);
  const total = clean.reduce((sum, value) => sum + value, 0);
  return total > 0 ? clean.map((value) => value / total) : [0.25, 0.25, 0.25, 0.25];
}

function melodyPitch(
  pitchClass: number,
  event: RealizedChord,
  target: PianoRealizerTarget,
  previousPitch: number | null,
  blockedPitchClasses: ReadonlySet<number>,
  seed: number,
  label: string,
): number | null {
  if (blockedPitchClasses.has(pc(pitchClass))) return null;
  const [zoneLow, zoneHigh] = rangeForZone(event.event.hands.right.register, target);
  const lower = Math.max(zoneLow, Math.floor(zoneLow + (zoneHigh - zoneLow) * 0.43));
  let candidates = pitchesForClass(pitchClass, lower, zoneHigh);
  if (!candidates.length) candidates = pitchesForClass(pitchClass, zoneLow, zoneHigh);
  if (!candidates.length) return null;
  const chordHigh = event.rightPitches.length ? Math.max(...event.rightPitches) : zoneLow;
  return candidates.sort((a, b) => {
    const score = (pitch: number) => (previousPitch === null ? 0 : Math.abs(pitch - previousPitch) * 0.8)
      + Math.abs(pitch - (zoneLow + zoneHigh) / 2) * 0.2
      + (pitch <= chordHigh && event.rightPitches.length ? (chordHigh - pitch + 2) * 1.4 : 0)
      + unitRandom(seed, `${label}:${pitch}`) * 0.05;
    return score(a) - score(b) || a - b;
  })[0];
}

function realizeMotifs(
  plan: PianoComposerPlan,
  chords: readonly RealizedChord[],
  target: PianoRealizerTarget,
  projectEndTick: number,
): DraftNote[] {
  const motif = plan.motif;
  if (!motif) return [];
  const originEvent = chords.find((chord) => chord.event.chord.id === motif.originChordId);
  const originRoot = originEvent?.event.chord.rootPitchClass ?? motif.anchorPitchClass;
  const output: DraftNote[] = [];
  let previousMelodyPitch: number | null = null;

  for (const phrase of plan.phrases) {
    const operation = phrase.motif.operation;
    const weights = normalizedWeights(phrase.rhythmicPlan.weights.length
      ? phrase.rhythmicPlan.weights : motif.rhythmicWeights);
    const positions = selectedMotifPositions(phrase);
    if (!positions.length || phrase.endTick <= phrase.startTick) continue;
    const entryEvent = eventAtTick(chords, phrase.startTick)
      ?? chords.find((chord) => chord.startTick >= phrase.startTick && chord.startTick < phrase.endTick);
    if (!entryEvent) continue;
    const motifPitches = baseMotifPitchClasses(motif, operation as PianoMotifOperation);
    const cellTicks = Math.min(phrase.endTick - phrase.startTick,
      operation === 'rhythmic-augmentation' ? 8 * PPQ : 4 * PPQ);
    if (cellTicks <= 0) continue;
    const onsets: number[] = [];
    let cumulative = 0;
    for (const weight of weights) {
      onsets.push(phrase.startTick + Math.round(cumulative * cellTicks));
      cumulative += weight;
    }
    const displacement = phrase.rhythmicPlan.syncopation;
    if (displacement && positions.includes(displacement.displacedPosition)) {
      const position = displacement.displacedPosition;
      const previousOnset = onsets[position - 1];
      const nextOnset = onsets[position + 1];
      if (previousOnset !== undefined && nextOnset !== undefined) {
        const subdivision = PPQ / 4;
        const lower = previousOnset + subdivision;
        const upper = nextOnset - subdivision;
        const desired = clamp(onsets[position] + displacement.offsetTicks, lower, upper);
        const quantized = phrase.startTick
          + Math.round((desired - phrase.startTick) / subdivision) * subdivision;
        onsets[position] = Math.round(clamp(quantized, lower, upper));
      }
    }
    const phraseEntryRoot = entryEvent.event.chord.rootPitchClass;
    const blockedBassClasses = new Set(chords
      .filter((chord) => chord.startTick < phrase.endTick && chord.endTick > phrase.startTick && chord.leftPitch !== null)
      .map((chord) => pc(chord.leftPitch!)));
    const resolved = new Map<number, number>();
    for (const position of positions) {
      const pitchClass = motifPitchClassAt(
        plan,
        motifPitches,
        operation as PianoMotifOperation,
        position,
        onsets[position],
        position === 2 ? onsets[3] ?? null : null,
        phraseEntryRoot,
        originRoot,
        chords,
        blockedBassClasses,
        plan.seed,
      );
      if (pitchClass !== null) resolved.set(position, pitchClass);
    }

    for (let order = 0; order < positions.length; order++) {
      const position = positions[order];
      const startTick = onsets[position];
      if (!isInteger(startTick) || startTick < phrase.startTick || startTick >= phrase.endTick || startTick >= projectEndTick) continue;
      const chord = eventAtTick(chords, startTick);
      let pitchClass = resolved.get(position);
      if (!chord || pitchClass === undefined) continue;
      const bassClasses = chord.leftPitch === null ? new Set<number>() : new Set([pc(chord.leftPitch)]);
      const isDisplacedColor = phrase.rhythmicPlan.syncopation?.displacedPosition === position;
      const alreadyVoicedClasses = new Set([...bassClasses, ...chord.rightPitches.map(pc)]);
      if (isDisplacedColor && alreadyVoicedClasses.has(pc(pitchClass))) {
        // Keep the displaced motif reply independent from both hands while
        // retaining the nearest available chord tone when its ideal class is
        // doubled by the bass or the selected right-hand chord voicing.
        const idealClass = pc(pitchClass);
        const alternative = chord.event.chord.availablePitchClasses.map(pc)
          .filter((tone) => !alreadyVoicedClasses.has(tone))
          .sort((a, b) => pcDistance(a, idealClass) - pcDistance(b, idealClass)
            || pcDistance(a, motifPitches[position] ?? idealClass)
              - pcDistance(b, motifPitches[position] ?? idealClass)
            || a - b)[0];
        if (alternative !== undefined) pitchClass = alternative;
      }
      const pitch = melodyPitch(
        pitchClass,
        chord,
        target,
        previousMelodyPitch,
        bassClasses,
        plan.seed,
        `${phrase.id}:melody:${position}`,
      );
      if (pitch === null) continue;
      previousMelodyPitch = pitch;
      const naturalEnd = startTick + Math.max(1,
        Math.round(weights[position] * cellTicks * (operation === 'rhythmic-augmentation' ? 0.92 : 0.84)));
      const nextOnset = order + 1 < positions.length ? onsets[positions[order + 1]] : phrase.endTick;
      let endTick = Math.min(projectEndTick, phrase.endTick, naturalEnd,
        nextOnset > startTick ? nextOnset : naturalEnd);
      for (const next of chords) {
        if (next.startTick > startTick && next.startTick < endTick
          && !next.event.chord.availablePitchClasses.map(pc).includes(pitchClass)) {
          endTick = next.startTick;
          break;
        }
      }
      if (endTick <= startTick) continue;
      output.push({
        hand: 'melody',
        chordId: chord.event.chord.id,
        note: {
          pitch,
          startTick,
          durationTicks: endTick - startTick,
          velocity: velocityFor(plan, chord, phrase, startTick, 'melody', position === 0 ? 2 : position === 3 ? 3 : 0),
          roleTag: 'answer',
          ...(position === 3 || operation === 'sequence-in-new-harmony' ? { articulation: 'legato' as const } : {}),
        },
      });
    }
  }
  return output;
}

function realizeFillGestures(
  plan: PianoComposerPlan,
  chords: readonly RealizedChord[],
  target: PianoRealizerTarget,
  projectEndTick: number,
): DraftNote[] {
  const notes: DraftNote[] = [];
  for (const fill of plan.fillDecisions) {
    if (fill.decision !== 'consider-brief-gesture' || fill.target.toLowerCase() !== 'piano') continue;
    if (!isInteger(fill.startTick) || !isInteger(fill.endTick)) continue;
    const start = Math.max(0, fill.startTick);
    const end = Math.min(projectEndTick, fill.endTick);
    if (end <= start) continue;
    const chord = eventAtTick(chords, start)
      ?? chords.find((candidate) => candidate.startTick >= start && candidate.startTick < end);
    if (!chord) continue;
    const available = [...new Set(chord.event.voicing.rightHandPitchClasses
      .filter((tone) => Number.isInteger(tone) && tone >= 0 && tone < 12).map(pc))];
    if (!available.length) continue;
    const pitchClasses = available.slice(0, Math.min(2, available.length));
    const span = end - start;
    const onsets = pitchClasses.length === 1 || span < 240
      ? [start]
      : [start + Math.round(span * 0.22), start + Math.round(span * 0.62)];
    for (let index = 0; index < onsets.length; index++) {
      const tick = onsets[index];
      if (tick >= end || tick >= projectEndTick) continue;
      const toneIndex = unitRandom(plan.seed, `fill-tone:${fill.startTick}:${index}`) < 0.5
        ? index : pitchClasses.length - 1 - index;
      const pitchClass = pitchClasses[toneIndex] ?? pitchClasses[0];
      const blocked = chord.leftPitch === null ? new Set<number>() : new Set([pc(chord.leftPitch)]);
      const pitch = melodyPitch(pitchClass, chord, target, null, blocked, plan.seed, `fill:${fill.startTick}:${index}`);
      if (pitch === null) continue;
      const nextTick = onsets[index + 1] ?? end;
      const durationTicks = Math.max(1,
        Math.min(end - tick, nextTick - tick, Math.round((nextTick - tick) * 0.72)));
      notes.push({
        hand: 'fill',
        chordId: chord.event.chord.id,
        note: {
          pitch,
          startTick: tick,
          durationTicks,
          velocity: velocityFor(plan, chord, chord.phrase, tick, 'fill', index === 0 ? 1 : 0),
          roleTag: 'flourish',
          articulation: 'staccato',
        },
      });
    }
  }
  return notes;
}

function suppressRestrictedAttacks(
  plan: PianoComposerPlan,
  drafts: readonly DraftNote[],
): DraftNote[] {
  const explicitlyLeavesSpace = (tick: number): boolean => plan.fillDecisions.some((decision) =>
    decision.target.toLowerCase() === 'piano'
    && decision.decision === 'leave-space'
    && tick >= decision.startTick && tick < decision.endTick);
  const explicitlyAllowsFill = (draft: DraftNote): boolean => draft.hand === 'fill'
    && draft.note.roleTag === 'flourish'
    && plan.fillDecisions.some((decision) => decision.target.toLowerCase() === 'piano'
      && decision.decision === 'consider-brief-gesture'
      && draft.note.startTick >= decision.startTick && draft.note.startTick < decision.endTick);
  const explicitlyPlansSuspension = (draft: DraftNote): boolean => {
    if (draft.suspensionPart === 'preparation' || draft.suspensionPart === 'preparation-resolution') {
      return plan.harmonicEvents.some((event) => event.suspension?.preparedByChordId === draft.chordId
        && pc(event.suspension.tensionPitchClass) === pc(draft.note.pitch));
    }
    if (draft.suspensionPart === 'resolution') {
      return plan.harmonicEvents.some((event) => event.chord.id === draft.chordId
        && event.suspension !== null
        && pc(event.suspension.resolvesToPitchClass) === pc(draft.note.pitch));
    }
    return false;
  };

  return drafts.filter((draft) => {
    const tick = draft.note.startTick;
    // A Composer leave-space decision has priority over every optional gesture.
    if (explicitlyLeavesSpace(tick)) return false;
    const nearSilentZero = plan.attackRestrictions.some((window) =>
      tick >= window.startTick && tick < window.endTick);
    if (!nearSilentZero) return true;
    // Only a specifically planned suspension line or an explicitly selected
    // piano fill can cross the attack gate; ordinary chord beds are not raised
    // with low-velocity replacement notes.
    return explicitlyPlansSuspension(draft) || explicitlyAllowsFill(draft);
  });
}

function attackRestrictionReason(plan: PianoComposerPlan, tick: number | null): string | null {
  if (tick === null) return null;
  const leaveSpace = plan.fillDecisions.find((decision) => decision.target.toLowerCase() === 'piano'
    && decision.decision === 'leave-space'
    && tick >= decision.startTick && tick < decision.endTick);
  if (leaveSpace) {
    return `The attack at tick ${tick} is blocked by the explicit Composer leave-space decision for [${leaveSpace.startTick}, ${leaveSpace.endTick}).`;
  }
  const restriction = plan.attackRestrictions.find((window) => tick >= window.startTick && tick < window.endTick);
  return restriction
    ? `The attack at tick ${tick} is suppressed inside bar ${restriction.bar}, marked near-silent with zero energy, and has no permitted explicit exception.`
    : null;
}

function approachNotes(
  plan: PianoComposerPlan,
  chords: readonly RealizedChord[],
  target: PianoRealizerTarget,
  projectEndTick: number,
): DraftNote[] {
  const output: DraftNote[] = [];
  const usedPhrases = new Set<string>();
  for (let index = 0; index + 1 < chords.length; index++) {
    const current = chords[index];
    const next = chords[index + 1];
    const phraseId = current.phrase?.id ?? current.event.phraseId ?? `unphrased:${current.startTick}`;
    if (current.event.hands.left.motion !== 'sparse-approach'
      || current.phrase?.dynamics.sourceEnergy.nearSilence
      || current.endTick !== next.startTick
      || usedPhrases.has(phraseId)
      || current.leftPitch === null
      || next.leftPitch === null) continue;
    const nextPitchClass = pc(next.leftPitch);
    const currentPitchClass = pc(current.leftPitch);
    const candidates = current.event.chord.availablePitchClasses.map(pc)
      .filter((tone) => tone !== currentPitchClass && pcDistance(tone, nextPitchClass) <= 2);
    if (!candidates.length) continue;
    const approachPitchClass = candidates.sort((a, b) => pcDistance(a, nextPitchClass) - pcDistance(b, nextPitchClass)
      || a - b)[0];
    const span = current.endTick - current.startTick;
    const tick = current.startTick + Math.floor(span * 0.78);
    const endTick = Math.min(projectEndTick, next.startTick,
      tick + Math.min(PPQ / 4, Math.floor(span * 0.18)));
    if (endTick <= tick) continue;
    const [low, high] = rangeForZone(current.event.hands.left.register, target);
    const pitch = pitchesForClass(approachPitchClass, low, high)
      .sort((a, b) => Math.abs(a - next.leftPitch!) - Math.abs(b - next.leftPitch!) || a - b)[0];
    if (pitch === undefined || pc(pitch) === currentPitchClass) continue;
    output.push({
      hand: 'left',
      chordId: current.event.chord.id,
      note: {
        pitch,
        startTick: tick,
        durationTicks: endTick - tick,
        velocity: Math.max(24, velocityFor(plan, current, current.phrase, tick, 'left') - 4),
        roleTag: 'lift',
      },
    });
    usedPhrases.add(phraseId);
  }
  return output;
}

function isSuspensionBassPair(a: DraftNote, b: DraftNote): boolean {
  const matches = (melody: DraftNote, bass: DraftNote): boolean =>
    melody.hand === 'melody'
    && bass.hand === 'left'
    && melody.suspensionOctavePartners?.some((partner) =>
      partner.chordId === bass.chordId && partner.pitch === bass.note.pitch) === true;
  return matches(a, b) || matches(b, a);
}

function resolveOctaveDoublings(notes: DraftNote[]): void {
  // V1 does not invent doublings even where a template permits them. Only the
  // exact LH note paired with a planned suspension is exempt from this guard.
  for (let left = 0; left < notes.length; left++) {
    for (let right = left + 1; right < notes.length; right++) {
      const a = notes[left];
      const b = notes[right];
      const interval = Math.abs(a.note.pitch - b.note.pitch);
      if (interval < 12 || interval % 12 !== 0 || !overlaps(a.note, b.note) || isSuspensionBassPair(a, b)) continue;
      let winner: DraftNote;
      if (a.suspensionPart && b.suspensionPart) {
        const rank = (draft: DraftNote) => draft.suspensionPart === 'preparation-resolution' ? 2
          : draft.suspensionPart === 'resolution' ? 1 : 0;
        winner = rank(a) === rank(b)
          ? a.note.startTick <= b.note.startTick ? a : b
          : rank(a) > rank(b) ? a : b;
      } else if (a.suspensionPart || b.suspensionPart) {
        const planned = a.suspensionPart ? a : b;
        const other = planned === a ? b : a;
        // Never create an octave conflict with an unpaired left-hand anchor.
        // A left-hand `lift`, however, is only an optional approach gesture;
        // preserve the explicitly planned suspension and yield that approach.
        winner = other.hand === 'left' && other.note.roleTag !== 'lift' ? other : planned;
      } else {
        const aPriority = NOTE_TAG_PRIORITY[a.note.roleTag ?? 'bed'];
        const bPriority = NOTE_TAG_PRIORITY[b.note.roleTag ?? 'bed'];
        winner = aPriority > bPriority ? a : bPriority > aPriority ? b
          : a.note.startTick <= b.note.startTick ? a : b;
      }
      const loser = winner === a ? b : a;
      loser.note.durationTicks = loser.note.startTick < winner.note.startTick
        ? Math.max(0, winner.note.startTick - loser.note.startTick)
        : 0;
    }
  }
}

function normalizeCandidates(
  drafts: readonly DraftNote[],
  target: PianoRealizerTarget,
  projectEndTick: number,
): Note[] {
  // A motif/bed can independently choose the same pitch as a prepared
  // suspension. Do not let its later onset split the planned held note before
  // the chord boundary; trim an earlier ordinary note at the preparation, or
  // drop an ordinary attack that falls inside the protected suspension.
  const protectedSuspensions = drafts
    .filter((draft) => draft.suspensionPart !== undefined)
    .map((draft) => ({ pitch: draft.note.pitch, start: draft.note.startTick, end: endOf(draft.note) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const conflictFreeDrafts = drafts.flatMap((draft) => {
    if (draft.suspensionPart !== undefined) return [draft];
    const note = { ...draft.note };
    let end = endOf(note);
    for (const suspension of protectedSuspensions) {
      if (suspension.pitch !== note.pitch || note.startTick >= suspension.end || end <= suspension.start) continue;
      if (note.startTick < suspension.start) end = Math.min(end, suspension.start);
      else return [];
    }
    return end > note.startTick
      ? [{ ...draft, note: { ...note, durationTicks: end - note.startTick } }]
      : [];
  });
  const fixed = conflictFreeDrafts.flatMap(({ note }) => {
    if (!isInteger(note.pitch) || note.pitch < target.lowestNote || note.pitch > target.highestNote
      || !isInteger(note.startTick) || note.startTick < 0 || note.startTick >= projectEndTick
      || !isInteger(note.durationTicks) || note.durationTicks < 1
      || !isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) return [];
    const durationTicks = Math.min(note.durationTicks, projectEndTick - note.startTick);
    return durationTicks > 0 ? [{ ...note, durationTicks }] : [];
  });
  fixed.sort((a, b) => a.pitch - b.pitch || a.startTick - b.startTick || b.durationTicks - a.durationTicks);
  const disjoint: Note[] = [];
  for (const note of fixed) {
    const previous = disjoint[disjoint.length - 1];
    if (previous && previous.pitch === note.pitch && overlaps(previous, note)) {
      if (previous.startTick === note.startTick) {
        if (note.velocity > previous.velocity) previous.velocity = note.velocity;
        if (note.durationTicks > previous.durationTicks) previous.durationTicks = note.durationTicks;
        if (NOTE_TAG_PRIORITY[note.roleTag ?? 'bed'] > NOTE_TAG_PRIORITY[previous.roleTag ?? 'bed']) {
          if (note.roleTag !== undefined) previous.roleTag = note.roleTag;
          if (note.articulation !== undefined) previous.articulation = note.articulation;
        }
        continue;
      }
      previous.durationTicks = note.startTick - previous.startTick;
      if (previous.durationTicks < 1) disjoint.pop();
    }
    disjoint.push(note);
  }
  return disjoint.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
}

function invalidInputReason(input: PianoRealizerInput): string {
  const { plan, targetTrack, projectEndTick } = input;
  if (!targetTrack) return 'No writable piano target was supplied to the Realizer.';
  if (targetTrack.family !== 'Keys' || targetTrack.role !== 'piano') return 'The target is not a piano track in the Keys family.';
  if (targetTrack.locked) return 'The piano target is locked and cannot receive realized notes.';
  if (!isInteger(targetTrack.lowestNote) || !isInteger(targetTrack.highestNote)
    || targetTrack.lowestNote < 0 || targetTrack.highestNote > 127 || targetTrack.lowestNote > targetTrack.highestNote) {
    return 'The piano target has an invalid playable MIDI range.';
  }
  if (!isInteger(projectEndTick) || projectEndTick <= 0) return 'The supplied project end tick is invalid.';
  if (plan.status !== 'composed' || !plan.template.eligible) return 'The Composer plan is not eligible for piano realization.';
  if (!plan.harmonicEvents.length) return 'The Composer plan contains no valid harmonic events.';
  return 'The Realizer input did not satisfy its piano-only validation contract.';
}

function suspensionAuditForNotes(
  plan: PianoComposerPlan,
  notes: readonly Note[],
  records: ReadonlyMap<string, SuspensionAttemptRecord>,
  invalidReason: string | null = null,
): PianoSuspensionAudit[] {
  return plan.harmonicEvents.flatMap((event) => {
    const suspension = event.suspension;
    if (!suspension || suspension.kind !== 'prepared-stepwise-suspension') return [];
    const boundaryTick = event.chord.startTick;
    const record = records.get(event.chord.id);
    const preparationFound = notes.some((note) => (note.roleTag === 'answer' || note.roleTag === 'settle')
      && pc(note.pitch) === pc(suspension.tensionPitchClass)
      && note.startTick < boundaryTick && endOf(note) > boundaryTick);
    const resolutionFound = record?.resolveAt !== null && record?.resolveAt !== undefined
      && notes.some((note) => note.roleTag === 'settle'
        && pc(note.pitch) === pc(suspension.resolvesToPitchClass)
        && note.startTick === record.resolveAt
        && note.startTick > boundaryTick && note.startTick < event.chord.endTick);
    const preparationReason = preparationFound ? null
      : invalidReason
        ?? record?.preparationReason
        ?? attackRestrictionReason(plan, record?.preparedStart ?? null)
        ?? `The prepared pitch did not survive note-conflict normalization as a crossing attack at chord boundary ${boundaryTick}.`;
    const resolutionReason = resolutionFound ? null
      : invalidReason
        ?? record?.resolutionReason
        ?? attackRestrictionReason(plan, record?.resolveAt ?? null)
        ?? `No settle attack in pitch class ${pc(suspension.resolvesToPitchClass)} survived inside resolving chord ${event.chord.id} [${boundaryTick}, ${event.chord.endTick}).`;
    const complete = preparationFound && resolutionFound;
    const reason = complete ? null : [
      !preparationFound ? `Preparation unavailable: ${preparationReason}` : null,
      !resolutionFound ? `Resolution unavailable: ${resolutionReason}` : null,
    ].filter((value): value is string => value !== null).join(' ');
    return [{
      chordId: event.chord.id,
      preparedByChordId: suspension.preparedByChordId,
      boundaryTick,
      tensionPitchClass: pc(suspension.tensionPitchClass),
      resolvesToPitchClass: pc(suspension.resolvesToPitchClass),
      preparationFound,
      resolutionFound,
      complete,
      preparationReason,
      resolutionReason,
      reason,
    }];
  });
}

export interface PianoRealizationWithAudit {
  readonly notes: readonly Note[];
  /** Generated Piano-only controller lanes; CC64 is composed by V2, not MIDI export. */
  readonly controllers: readonly CcLane[];
  readonly suspensions: readonly PianoSuspensionAudit[];
  readonly octavePolicy: PianoOctavePolicyReport;
}

const emptyOctavePolicyReport = (plan: PianoComposerPlan): PianoOctavePolicyReport => ({
  policy: plan.templateConstraints.octaveDoubling === 'forbidden' ? 'forbidden' : 'not-required',
  revoiced: 0,
  shortened: 0,
  dropped: 0,
  remainingHardPairs: 0,
});

/**
 * Realize a Phase 5 piano plan into validated piano-only Note values and retain
 * an explicit per-suspension explanation for any Composer intention that could
 * not survive register, timing, attack-window, or note-conflict checks.
 */
export function realizePianoPlanWithAudit(input: PianoRealizerInput): PianoRealizationWithAudit {
  if (!validInput(input)) {
    const reason = invalidInputReason(input);
    return {
      notes: freezeNotes([]),
      controllers: Object.freeze([]),
      suspensions: suspensionAuditForNotes(input.plan, [], new Map(), reason),
      octavePolicy: emptyOctavePolicyReport(input.plan),
    };
  }
  const { plan, targetTrack, projectEndTick } = input;
  if (!targetTrack) {
    const reason = 'No writable piano target was supplied to the Realizer.';
    return {
      notes: freezeNotes([]),
      controllers: Object.freeze([]),
      suspensions: suspensionAuditForNotes(plan, [], new Map(), reason),
      octavePolicy: emptyOctavePolicyReport(plan),
    };
  }
  const chords = makeRealizedChords(plan, targetTrack, projectEndTick);
  if (!chords.length) {
    const reason = 'No valid harmonic span remains inside the supplied project endpoint.';
    return {
      notes: freezeNotes([]),
      controllers: Object.freeze([]),
      suspensions: suspensionAuditForNotes(plan, [], new Map(), reason),
      octavePolicy: emptyOctavePolicyReport(plan),
    };
  }
  const chordNotes = realizeChordTones(plan, chords, projectEndTick);
  const suspensionAttempt = realizeSuspensions(plan, chords, targetTrack, projectEndTick, chordNotes);
  const drafts = [
    ...chordNotes,
    ...suspensionAttempt.notes,
    ...approachNotes(plan, chords, targetTrack, projectEndTick),
    ...realizeMotifs(plan, chords, targetTrack, projectEndTick),
    ...realizeFillGestures(plan, chords, targetTrack, projectEndTick),
  ];
  const permittedDrafts = suppressRestrictedAttacks(plan, drafts);
  resolveOctaveDoublings(permittedDrafts);
  const normalized = normalizeCandidates(permittedDrafts, targetTrack, projectEndTick);
  const policy = applyPianoOctavePolicy({
    plan,
    targetTrack,
    notes: normalized,
    externalTracks: input.externalTracks,
    tempoMap: input.tempoMap,
    timeSignature: input.timeSignature,
  });
  const notes = freezeNotes(policy.notes);
  const pedalLane = generatePianoPedalLane(plan, notes, projectEndTick);
  return {
    notes,
    controllers: Object.freeze(pedalLane ? [pedalLane] : []),
    suspensions: suspensionAuditForNotes(plan, notes, suspensionAttempt.records),
    octavePolicy: policy.report,
  };
}

/**
 * Realize a Phase 5 piano plan into validated piano-only Note values.
 * The result is deeply frozen and the supplied plan/track projection is never
 * mutated. An invalid or ineligible target safely returns an empty array.
 */
export function realizePianoPlan(input: PianoRealizerInput): readonly Note[] {
  return realizePianoPlanWithAudit(input).notes;
}

/** Return explicit completion status and failure reasons for Composer suspensions. */
export function auditPianoSuspensions(input: PianoRealizerInput): readonly PianoSuspensionAudit[] {
  return realizePianoPlanWithAudit(input).suspensions;
}
