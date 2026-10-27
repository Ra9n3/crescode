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
  referenceAudio: ReferenceAudio;
  tracks: Track[];
  libraryGroups: LibraryGroup[];
  masterVolume: number;
}

/** Tracks that carry generated MIDI (not Structure / Chords / Audio lanes). */
export const isInstrumentTrack = (t: Track) => t.family !== 'Structure' && t.family !== 'Audio';
