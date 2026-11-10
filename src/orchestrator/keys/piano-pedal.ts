/**
 * Piano Engine V5's generated sustain-pedal automation.
 *
 * The Realizer calls this after its final note/conflict pass, so pedal timing
 * follows the notes that will actually be written. Harmonic events and phrase
 * boundaries come from the Composer; the MIDI exporter only serializes this
 * controller lane.
 */
import { MAX_CC_POINTS_PER_LANE, type CcLane, type CcPoint, type Note } from '../../shared/schema/types';
import type {
  PianoComposerPlan,
  PianoDensity,
  PianoHarmonicEvent,
  PianoPhraseIntention,
  PianoTemplateIdentity,
} from './piano-composer';

export const PIANO_SUSTAIN_PEDAL_CC = 64;
const PEDAL_DOWN = 127;
const PEDAL_UP = 0;

interface PedalPolicy {
  /** A gap this long splits activity into separate pedal gestures. */
  readonly restGapTicks: number;
  /** Small acoustic tail after the last note release, before lifting the pedal. */
  readonly releaseTailTicks: number;
  /** Reject brief events that would only produce a pedal flick. */
  readonly minActivityTicks: number;
  readonly minPedalTicks: number;
  /** Fast repeated attacks are left unpedalled. */
  readonly fastRunMedianGapTicks: number;
  readonly veryFastGapTicks: number;
  readonly fastRunMinimumOnsets: number;
  /** Maximum simultaneous written notes for a pedal gesture. */
  readonly maxConcurrentNotes: number;
  readonly maxDensity: PianoDensity;
  /** Hybrid syncopation is left clear rather than blurred by the pedal. */
  readonly skipSyncopatedPhrases: boolean;
}

const PEDAL_POLICIES: Readonly<Record<PianoTemplateIdentity, PedalPolicy>> = Object.freeze({
  'chamber-counterpoint': {
    restGapTicks: 600,
    releaseTailTicks: 120,
    minActivityTicks: 480,
    minPedalTicks: 360,
    fastRunMedianGapTicks: 360,
    veryFastGapTicks: 240,
    fastRunMinimumOnsets: 3,
    maxConcurrentNotes: 5,
    maxDensity: 'sparse',
    skipSyncopatedPhrases: false,
  },
  'sonata-dialogue': {
    restGapTicks: 480,
    releaseTailTicks: 192,
    minActivityTicks: 420,
    minPedalTicks: 360,
    fastRunMedianGapTicks: 360,
    veryFastGapTicks: 240,
    fastRunMinimumOnsets: 3,
    maxConcurrentNotes: 6,
    maxDensity: 'moderate',
    skipSyncopatedPhrases: false,
  },
  'vocal-space': {
    restGapTicks: 840,
    releaseTailTicks: 240,
    minActivityTicks: 480,
    minPedalTicks: 420,
    fastRunMedianGapTicks: 360,
    veryFastGapTicks: 240,
    fastRunMinimumOnsets: 3,
    maxConcurrentNotes: 4,
    maxDensity: 'sparse',
    skipSyncopatedPhrases: false,
  },
  'cinematic-expanse': {
    restGapTicks: 960,
    releaseTailTicks: 360,
    minActivityTicks: 480,
    minPedalTicks: 480,
    fastRunMedianGapTicks: 360,
    veryFastGapTicks: 240,
    fastRunMinimumOnsets: 4,
    maxConcurrentNotes: 9,
    maxDensity: 'broad',
    skipSyncopatedPhrases: false,
  },
  'hybrid-pulse-and-color': {
    restGapTicks: 360,
    releaseTailTicks: 96,
    minActivityTicks: 420,
    minPedalTicks: 360,
    fastRunMedianGapTicks: 480,
    veryFastGapTicks: 240,
    fastRunMinimumOnsets: 3,
    maxConcurrentNotes: 5,
    maxDensity: 'moderate',
    skipSyncopatedPhrases: true,
  },
  'adaptive-spacious': {
    restGapTicks: 600,
    releaseTailTicks: 180,
    minActivityTicks: 480,
    minPedalTicks: 360,
    fastRunMedianGapTicks: 360,
    veryFastGapTicks: 240,
    fastRunMinimumOnsets: 3,
    maxConcurrentNotes: 6,
    maxDensity: 'sparse',
    skipSyncopatedPhrases: false,
  },
});

const DENSITY_RANK: Readonly<Record<PianoDensity, number>> = {
  'very-sparse': 0,
  sparse: 1,
  moderate: 2,
  broad: 3,
};

interface ActivityInterval {
  readonly startTick: number;
  readonly endTick: number;
  readonly note: Note;
}

interface ActivityBlock {
  startTick: number;
  endTick: number;
  readonly notes: Set<Note>;
}

interface PedalSegment {
  readonly startTick: number;
  endTick: number;
  /** Harmony or phrase boundary approached; null when a rest/note release lifts it. */
  boundaryTick: number | null;
  readonly phraseId: string | null;
  eventIndex: number;
  readonly harmonicEvent: PianoHarmonicEvent;
  pitchClasses: Set<number>;
}

const pitchClass = (pitch: number): number => ((pitch % 12) + 12) % 12;
const noteEnd = (note: Note): number => note.startTick + note.durationTicks;
const densityRank = (density: PianoDensity): number => DENSITY_RANK[density];

function phraseForEvent(plan: PianoComposerPlan, event: PianoHarmonicEvent): PianoPhraseIntention | null {
  return plan.phrases.find((phrase) => phrase.id === event.phraseId)
    ?? plan.phrases.find((phrase) => phrase.startTick <= event.chord.startTick
      && event.chord.startTick < phrase.endTick)
    ?? null;
}

function activityBlocks(
  notes: readonly Note[],
  startTick: number,
  endTick: number,
  restGapTicks: number,
): ActivityBlock[] {
  const intervals: ActivityInterval[] = notes.flatMap((note) => {
    const start = Math.max(startTick, note.startTick);
    const end = Math.min(endTick, noteEnd(note));
    return Number.isInteger(note.startTick) && Number.isInteger(note.durationTicks)
      && note.durationTicks > 0 && end > start
      ? [{ startTick: start, endTick: end, note }]
      : [];
  }).sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick || a.note.pitch - b.note.pitch);

  const blocks: ActivityBlock[] = [];
  for (const interval of intervals) {
    const current = blocks[blocks.length - 1];
    if (!current || interval.startTick - current.endTick >= restGapTicks) {
      blocks.push({
        startTick: interval.startTick,
        endTick: interval.endTick,
        notes: new Set([interval.note]),
      });
      continue;
    }
    current.endTick = Math.max(current.endTick, interval.endTick);
    current.notes.add(interval.note);
  }
  return blocks;
}

function peakConcurrency(notes: readonly Note[], startTick: number, endTick: number): number {
  const edges = notes.flatMap((note) => {
    const start = Math.max(startTick, note.startTick);
    const end = Math.min(endTick, noteEnd(note));
    return end > start
      ? [{ tick: start, delta: 1 }, { tick: end, delta: -1 }]
      : [];
  }).sort((a, b) => a.tick - b.tick || a.delta - b.delta);
  let active = 0;
  let peak = 0;
  for (const edge of edges) {
    active += edge.delta;
    peak = Math.max(peak, active);
  }
  return peak;
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isFastRun(onsets: readonly number[], policy: PedalPolicy): boolean {
  const gaps = onsets.slice(1).map((tick, index) => tick - onsets[index]);
  return gaps.some((gap) => gap <= policy.veryFastGapTicks)
    || (onsets.length >= policy.fastRunMinimumOnsets
      && median(gaps) <= policy.fastRunMedianGapTicks);
}

function appendState(points: CcPoint[], tick: number, value: 0 | 127, endTick: number): void {
  const safeTick = Math.max(0, Math.min(endTick, Math.round(tick)));
  const previous = points[points.length - 1];
  if (previous?.tick === safeTick) {
    if (previous.value !== value) previous.value = value;
    return;
  }
  if (previous?.value === value) return;
  points.push({ tick: safeTick, value });
}

function canCarryPedalAcrossChord(previous: PedalSegment, next: PedalSegment): boolean {
  if (previous.boundaryTick === null
    || previous.endTick !== previous.boundaryTick
    || next.startTick !== previous.boundaryTick
    || next.eventIndex !== previous.eventIndex + 1
    || previous.phraseId === null
    || previous.phraseId !== next.phraseId) return false;
  const nextPitchClasses = new Set(next.harmonicEvent.chord.availablePitchClasses.map(pitchClass));
  return previous.pitchClasses.size > 0
    && [...previous.pitchClasses].every((pitch) => nextPitchClasses.has(pitch));
}

/**
 * Build one deterministic CC64 lane from the Composer's harmonic/phrase plan
 * and the Realizer's final Piano notes. A pedal segment starts on a real
 * piano attack, lifts for long rests and phrase boundaries, and is released
 * just before any non-final harmony/phrase boundary it cannot safely cross.
 */
export function generatePianoPedalLane(
  plan: PianoComposerPlan,
  notes: readonly Note[],
  projectEndTick: number,
): CcLane | null {
  if (plan.status !== 'composed' || !plan.template.eligible
    || !Number.isInteger(projectEndTick) || projectEndTick <= 0 || !notes.length) return null;

  const policy = PEDAL_POLICIES[plan.template.style.identity] ?? PEDAL_POLICIES['adaptive-spacious'];
  const events = plan.harmonicEvents
    .map((event, originalIndex) => ({ event, originalIndex }))
    .filter(({ event }) => Number.isInteger(event.chord.startTick)
      && Number.isInteger(event.chord.endTick)
      && event.chord.startTick >= 0
      && event.chord.endTick > event.chord.startTick
      && event.chord.startTick < projectEndTick)
    .sort((a, b) => a.event.chord.startTick - b.event.chord.startTick || a.originalIndex - b.originalIndex);

  const candidates: PedalSegment[] = [];
  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const { event } = events[eventIndex];
    const startTick = event.chord.startTick;
    const nextEventStart = events[eventIndex + 1]?.event.chord.startTick;
    const chordEndTick = Math.min(
      projectEndTick,
      event.chord.endTick,
      nextEventStart !== undefined && nextEventStart > startTick ? nextEventStart : projectEndTick,
    );
    const phrase = phraseForEvent(plan, event);
    const endTick = Math.min(chordEndTick, phrase?.endTick ?? chordEndTick, projectEndTick);
    if (endTick <= startTick) continue;
    if (policy.skipSyncopatedPhrases && phrase?.rhythmicPlan.syncopation) continue;
    if (densityRank(event.hands.right.density) > densityRank(policy.maxDensity)) continue;

    const blocks = activityBlocks(notes, startTick, endTick, policy.restGapTicks);
    for (const block of blocks) {
      const attackTicks = [...new Set([...block.notes]
        .filter((note) => note.startTick >= startTick && note.startTick < endTick
          && note.startTick >= block.startTick && note.startTick < block.endTick)
        .map((note) => note.startTick))]
        .sort((a, b) => a - b);
      if (!attackTicks.length || block.endTick - block.startTick < policy.minActivityTicks) continue;

      const blockNotes = [...block.notes];
      if (peakConcurrency(blockNotes, block.startTick, block.endTick) > policy.maxConcurrentNotes) continue;
      if (isFastRun(attackTicks, policy)) continue;

      const downTick = attackTicks[0];
      const restRelease = Math.min(endTick, block.endTick + policy.releaseTailTicks);
      const reachesBoundary = restRelease >= endTick;
      const upTick = Math.min(restRelease, endTick);
      if (upTick - downTick < policy.minPedalTicks) continue;

      const phraseEnd = phrase?.endTick ?? projectEndTick;
      const reachesChordBoundary = reachesBoundary
        && endTick === chordEndTick
        && chordEndTick < projectEndTick
        && chordEndTick < phraseEnd;
      const reachesPhraseBoundary = reachesBoundary
        && endTick === phraseEnd
        && phraseEnd < projectEndTick;
      candidates.push({
        startTick: downTick,
        endTick: upTick,
        boundaryTick: reachesChordBoundary ? chordEndTick : reachesPhraseBoundary ? phraseEnd : null,
        phraseId: event.phraseId ?? phrase?.id ?? null,
        eventIndex,
        harmonicEvent: event,
        pitchClasses: new Set(blockNotes.map((note) => pitchClass(note.pitch))),
      });
    }
  }

  candidates.sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick || a.eventIndex - b.eventIndex);
  const segments: PedalSegment[] = [];
  for (const candidate of candidates) {
    const previous = segments[segments.length - 1];
    if (previous && canCarryPedalAcrossChord(previous, candidate)) {
      previous.endTick = candidate.endTick;
      previous.boundaryTick = candidate.boundaryTick;
      previous.eventIndex = candidate.eventIndex;
      previous.pitchClasses = new Set([...previous.pitchClasses, ...candidate.pitchClasses]);
    } else {
      segments.push({ ...candidate, pitchClasses: new Set(candidate.pitchClasses) });
    }
  }

  const points: CcPoint[] = [];
  const maximumSegments = Math.floor(MAX_CC_POINTS_PER_LANE / 2);
  for (const segment of segments.slice(0, maximumSegments)) {
    const upTick = segment.boundaryTick !== null
      ? Math.min(segment.endTick, segment.boundaryTick - 1)
      : segment.endTick;
    if (upTick <= segment.startTick) continue;
    appendState(points, segment.startTick, PEDAL_DOWN, projectEndTick);
    appendState(points, upTick, PEDAL_UP, projectEndTick);
  }

  // Explicitly close an otherwise-open final gesture at the project endpoint.
  if (points[points.length - 1]?.value === PEDAL_DOWN) appendState(points, projectEndTick, PEDAL_UP, projectEndTick);
  if (!points.length) return null;

  const frozenPoints = Object.freeze(points.map((point) => Object.freeze({ ...point }))) as unknown as CcPoint[];
  return Object.freeze({ cc: PIANO_SUSTAIN_PEDAL_CC, points: frozenPoints });
}
