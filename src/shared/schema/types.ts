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

export interface Chord { id: string; symbol: string; startTick: number; durationTicks: number; /** true = protected from future generation. Missing/false = unlocked (old files load unlocked). */ locked?: boolean }

/** A chord is locked only when the field is explicitly true — generated chords stay unlocked. */
export const isChordLocked = (c: Pick<Chord, 'locked'>): boolean => c.locked === true;

/** Chord-generator settings (UI/UX phase): stored with the project, wired to the
 *  harmony engine when it lands. Flat on purpose — new rule groups extend it. */
export interface ChordGenSettings {
  /* General */
  /** 1 = triads, 2 = triads + sevenths, 3 = sevenths + extensions. */
  complexity: 1 | 2 | 3;
  /** Harmonic rhythm / chord density: 0 sparse, 1 moderate, 2 dense. */
  density: 0 | 1 | 2;
  /** Variation amount 0..1 (restraint → adventurous across generations). */
  variation: number;
  /* Harmony */
  /** Chromatic borrowing preference. */
  borrowing: 'none' | 'some' | 'more';
  /** Cadence strength. */
  cadence: 'soft' | 'balanced' | 'strong';
  /** Modal character emphasis 0..1 (straight → strongly modal). */
  modalEmphasis: number;
  /* Structure */
  /** Repeated sections keep the same harmonic identity (with variation). */
  preserveIdentity: boolean;
  /** Harmony reacts to each section's type and position. */
  sectionAware: boolean;
  /* Advanced */
  /** Deterministic seed 0..2^32-1. Persists with the project; advances only on a successful generation. */
  seed: number;
}

export const DEFAULT_CHORDGEN_SETTINGS: ChordGenSettings = {
  complexity: 2,
  density: 1,
  variation: 0.5,
  borrowing: 'some',
  cadence: 'balanced',
  modalEmphasis: 0.5,
  preserveIdentity: true,
  sectionAware: true,
  seed: 1,
};

export interface ReferenceAudio { path: string | null; offsetMs: number }

export interface Note { pitch: number; startTick: number; durationTicks: number; velocity: number }

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
}

export interface LibraryGroup {
  id: string;
  name: string;
  pluginId: string | null;
  pluginState: string | null;
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
  /** Chord-generator settings. Optional: older projects load with engine defaults. */
  chordGenSettings?: ChordGenSettings;
  referenceAudio: ReferenceAudio;
  tracks: Track[];
  libraryGroups: LibraryGroup[];
  masterVolume: number;
}

/** Tracks that carry generated MIDI (not Structure / Chords / Audio lanes). */
export const isInstrumentTrack = (t: Track) => t.family !== 'Structure' && t.family !== 'Audio';
