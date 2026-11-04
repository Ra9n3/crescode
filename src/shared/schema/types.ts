/**
 * Crescode data contracts (fixed). Time unit: ticks at 960 PPQ everywhere.
 * No seconds anywhere in the model.
 */
export const PPQ = 960;
export const SCHEMA_VERSION = 1;

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type ModeName =
  | 'Ionian' | 'Dorian' | 'Phrygian' | 'Lydian' | 'Mixolydian' | 'Aeolian' | 'Locrian'
  | 'Harmonic Minor' | 'Melodic Minor' | 'Whole Tone'
  | 'Diminished (Half-Whole)' | 'Diminished (Whole-Half)';

export type TrackFamily =
  | 'Structure' | 'Audio' | 'Strings' | 'Brass' | 'Woodwinds' | 'Percussion' | 'Keys';

export interface TempoEntry { tick: number; bpm: number }
export interface TimeSignature { numerator: number; denominator: number }

export interface Section { id: string; name: string; startBar: number; lengthBars: number }

export interface Chord { id: string; symbol: string; startTick: number; durationTicks: number }

export interface ReferenceAudio { path: string | null; offsetMs: number }

/**
 * Performance articulation, stored as data (spec D4: no sample-library
 * keyswitches yet — the preview synth honours it, MIDI export ignores it).
 */
export const ARTICULATIONS = [
  'legato', 'detache', 'marcato', 'staccato', 'spiccato', 'pizz',
  'tremolo', 'portato', 'sulTasto', 'sulPont', 'conSord',
] as const;
export type Articulation = (typeof ARTICULATIONS)[number];

export interface Note {
  pitch: number; startTick: number; durationTicks: number; velocity: number;
  /** Optional performance data — old projects and fixtures have none. */
  articulation?: Articulation;
  bow?: 'down' | 'up';
  /** The Vc+Cb layering step (Phase 4.5) marks its Cb-doubled notes 'cb'.
   *  Additive, optional: export profiles split the cellosBasses track by it
   *  (layer 'cb' → the bass part, everything else → the cello part). */
  layer?: 'cb';
}

/** One automation point on a CC lane. Ticks are absolute, values 0–127. */
export interface CcPoint { tick: number; value: number }

/** A controller lane on a track (CC1/CC11 phrase arcs, CC7 balance, …). */
export interface CcLane { cc: number; points: CcPoint[] }

/** Safety cap: one lane may hold at most this many automation points. */
export const MAX_CC_POINTS_PER_LANE = 1024;

/**
 * Orchestration memory: which take the current score is, per-section take
 * numbers (re-roll one section only) and which sections are locked through
 * Compose All and re-rolls. Absent field = no orchestration yet.
 */
export interface OrchestrationState {
  /** Incremented on every full Compose All; the take number seeds generation. */
  take: number;
  /** Per-section take counters (section re-roll). */
  sectionTakes?: Record<string, number>;
  /** Section ids locked against Compose All and re-rolls. */
  sectionLocks?: string[];
}

export interface Track {
  id: string;
  name: string;
  family: TrackFamily;
  color: string;
  /** The instrument role addressed by the generation rules config (e.g. "violins1"). */
  role: string;
  lowestNote: number;
  highestNote: number;
  locked: boolean;
  muted: boolean;
  soloed: boolean;
  libraryGroupId: string | null;
  midiChannel: number;
  frozen: boolean;
  volume: number;
  pan: number;
  notes: Note[];
  /** Optional CC automation lanes (additive, validated; ignored by old code). */
  cc?: CcLane[];
}

export interface LibraryGroup {
  id: string;
  name: string;
  pluginId: string | null;
  pluginState: string | null;
}

export type BandState = 'in' | 'out';

/**
 * Band memory (ensemble templates). A band marks membership over the app's
 * existing instrument tracks — it never creates or deletes tracks.
 * Absent field = no band chosen: every instrument track is in.
 */
export interface ProjectEnsemble {
  /** Shipped ensemble template id (e.g. "ensemble.symphony"), or null for no band. */
  templateId: string | null;
  /** Track-header in/out choices for this composition. Cleared when the template switches. */
  overrides: Record<string, BandState>;
  /** Project-settings pins ("always in" / "always out"). Ride over every template. */
  pins: Record<string, BandState>;
}

export interface Project {
  schemaVersion: number;
  name: string;
  bpm: number;
  tempoMap: TempoEntry[];
  timeSignature: TimeSignature;
  /** Tonic pitch class 0..11 (0 = C). */
  key: PitchClass;
  mode: ModeName;
  sections: Section[];
  chords: Chord[];
  referenceAudio: ReferenceAudio;
  tracks: Track[];
  libraryGroups: LibraryGroup[];
  ensemble?: ProjectEnsemble;
  orchestration?: OrchestrationState;
  masterVolume: number;
}

/** Tracks that carry generated MIDI (not Structure / Chords / Audio lanes). */
export const isInstrumentTrack = (t: Track) => t.family !== 'Structure' && t.family !== 'Audio';
