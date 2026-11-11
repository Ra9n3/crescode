/**
 * Stage 1's internal, note-level Piano score contract. These events are
 * ephemeral Composer output: hand/voice identity is retained through the
 * Realizer for audit and conversion, but is deliberately not written into the
 * shared Project Note schema or MIDI event stream.
 */
import type { Articulation, Note, NoteRoleTag, Track } from '../../shared/schema/types';
import type { PianoGenerationIdentity } from './piano-engine';

export type PianoHand = 'left' | 'right';
export type PianoScoreVoiceId = 'lh.bass' | 'lh.support' | 'rh.inner' | 'rh.melody' | 'rh.suspension';
export type PianoMusicalRole = 'bass' | 'support' | 'inner' | 'melody' | 'suspension' | 'cadence';
export type PianoGestureIntent =
  | 'bass-foundation'
  | 'bass-pulse'
  | 'harmonic-support'
  | 'broken-chord-figure'
  | 'counterline-answer'
  | 'inner-voice'
  | 'inner-line-motion'
  | 'cantabile-subject'
  | 'prepared-tension'
  | 'stepwise-resolution'
  | 'cadential-landing';
export type PianoTechniqueIntent =
  | 'sustained-bass-foundation'
  | 'pulsed-bass-pattern'
  | 'root-fifth-bass-pattern'
  | 'chord-tone-support'
  | 'broken-chord-accompaniment'
  | 'syncopated-pulse-accompaniment'
  | 'arpeggiated-chord-accompaniment'
  | 'independent-counterline'
  | 'voice-led-inner-tone'
  | 'moving-inner-voice'
  | 'phrase-led-upper-line'
  | 'prepared-suspension'
  | 'stepwise-resolution'
  | 'final-harmony';

export interface PianoScoreHarmonicContext {
  /** One event normally names one chord; a tied common tone can name several. */
  readonly chordIds: readonly string[];
  readonly chordSymbols: readonly string[];
  readonly pitchClasses: readonly number[];
  readonly quality: string;
}

export interface PianoScoreDynamicIntent {
  /** Composer intensity on the existing 0–5 piano scale. */
  readonly intensity: number;
  /** Concrete velocity decision made by the Composer (1–127). */
  readonly velocity: number;
  readonly phraseShape: string;
  readonly sourceEnergyTarget: number | null;
}

/** One pitched, timed event in the internal Piano score. */
export interface PianoScoreEvent {
  readonly id: string;
  /** Actual MIDI pitch, not a pitch class. */
  readonly pitch: number;
  readonly startTick: number;
  readonly durationTicks: number;
  readonly hand: PianoHand;
  readonly voiceId: PianoScoreVoiceId;
  readonly musicalRole: PianoMusicalRole;
  readonly phraseId: string | null;
  readonly sectionId: string | null;
  readonly gestureIntent: PianoGestureIntent;
  readonly techniqueIntent: PianoTechniqueIntent;
  readonly noteRoleTag: NoteRoleTag;
  readonly articulation: Articulation;
  readonly dynamicIntent: PianoScoreDynamicIntent;
  readonly harmonicContext: PianoScoreHarmonicContext;
}

/** Explicit silent spans make voice continuity and intentional space inspectable. */
export interface PianoScoreRest {
  readonly hand: PianoHand;
  readonly voiceId: PianoScoreVoiceId;
  readonly startTick: number;
  readonly endTick: number;
  readonly phraseId: string;
  readonly sectionId: string;
  readonly reason: 'phrase-space' | 'attack-restriction' | 'explicit-leave-space';
}

export interface PianoScore {
  readonly version: 1;
  readonly generationIdentity: PianoGenerationIdentity;
  readonly templateId: string | null;
  readonly projectEndTick: number;
  readonly events: readonly PianoScoreEvent[];
  readonly rests: readonly PianoScoreRest[];
}

export type PianoScoreTarget = Pick<Track, 'family' | 'role' | 'locked' | 'lowestNote' | 'highestNote'>;

/** Freeze the score boundary so downstream stages cannot silently rewrite it. */
export function createPianoScore(
  input: Omit<PianoScore, 'version' | 'events' | 'rests'> & {
    readonly events: readonly PianoScoreEvent[];
    readonly rests: readonly PianoScoreRest[];
  },
): PianoScore {
  const events = [...input.events]
    .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.id.localeCompare(b.id))
    .map((event) => Object.freeze({
      ...event,
      dynamicIntent: Object.freeze({ ...event.dynamicIntent }),
      harmonicContext: Object.freeze({
        ...event.harmonicContext,
        chordIds: Object.freeze([...event.harmonicContext.chordIds]),
        chordSymbols: Object.freeze([...event.harmonicContext.chordSymbols]),
        pitchClasses: Object.freeze([...event.harmonicContext.pitchClasses]),
      }),
    }));
  const rests = [...input.rests]
    .sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick || a.voiceId.localeCompare(b.voiceId))
    .map((rest) => Object.freeze({ ...rest }));
  return Object.freeze({
    version: 1,
    generationIdentity: Object.freeze({ ...input.generationIdentity }),
    templateId: input.templateId,
    projectEndTick: input.projectEndTick,
    events: Object.freeze(events),
    rests: Object.freeze(rests),
  });
}

/** Convert one Composer event to the shared track-note shape without identity loss in the caller. */
export function pianoScoreEventToNote(event: PianoScoreEvent): Note {
  return {
    pitch: event.pitch,
    startTick: event.startTick,
    durationTicks: event.durationTicks,
    velocity: event.dynamicIntent.velocity,
    roleTag: event.noteRoleTag,
    articulation: event.articulation,
  };
}
