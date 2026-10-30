/**
 * Smart Chord Suggestion — core data contracts (spec stage: no engine yet).
 *
 * Adapted from a DAW-agnostic suggestion spec to crescode's native model.
 * Crescent IS the host, so "the DAW" means this app's own project model.
 * The deliberate deviations from the generic spec:
 *
 *  - TIME: ticks at 960 PPQ are the only timeline unit (schema/types.ts:
 *    "No seconds anywhere in the model"). TimePosition carries bars/beats as
 *    DERIVED views and seconds as an optional derived display value — never
 *    authoritative, never persisted.
 *  - The chord lane is `project.chords` (schema `Chord`: id/symbol/
 *    startTick/durationTicks) surfaced on the `Chords` structure lane. There
 *    are no stored clips: ChordClip/MidiClip are VIEW contracts the adapter
 *    materializes over that flat model (tracks hold flat `Note[]`).
 *  - Chord names are validated exclusively through the shared parser
 *    (`shared/schema/chords.ts` parseChord) — one grammar, never two.
 *  - Types that already exist in crescode are REUSED, not duplicated:
 *    PitchClass, ModeName, TimeSignature, Note.
 *  - confidence is 0..1; 1 means user-authored (a typed symbol), analysis
 *    results carry their own confidence.
 */
import type { ModeName, PitchClass, TimeSignature } from '../../shared/schema';

/** Undo transaction handle — see ChordTrackAPI for the transaction contract. */
export interface UndoTransaction {
  readonly label: string;
}

/** Spelled note WITHOUT octave (e.g. "C", "C#", "Db", "F#", "Gb"). Crescent
 *  canon spells with mixed accidentals (NOTE_NAMES: Eb, Ab, Bb — never D#);
 *  both accidentals are accepted as input, canon is produced on output. */
export type NoteName =
  `${'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'}${'' | '#' | 'b' | '♯' | '♭'}`;

/** Runtime guard for the PitchClass union re-exported from the schema. */
export function isPitchClass(v: unknown): v is PitchClass {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 11;
}

/** One sounding note — the spell-decorated view over crescode's native
 *  `Note { pitch, startTick, durationTicks, velocity }`. */
export interface Pitch {
  /** MIDI note number 0–127 (C4 = 60) — the native Note.pitch value. */
  midi: number;
  pitchClass: PitchClass;
  /** Spelled name WITHOUT octave (e.g. "Eb"), canon per NOTE_NAMES. */
  spelling: NoteName;
  /** Scientific octave (C4 = 60): Math.floor(midi / 12) - 1. */
  octave: number;
  /** 1–127 — crescode's Note.velocity rule; 0 is a note-off, not a sound. */
  velocity: number;
  /** Native timeline values — ticks, never seconds. */
  startTick: number;
  durationTicks: number;
}

/** Canonical quality names — exactly the value set parseChord can return
 *  (shared/schema/chords.ts QUALITIES table). */
export type ChordQuality =
  | 'major' | 'minor' | 'diminished' | 'augmented' | 'sus2' | 'sus4' | 'power'
  | '6' | 'm6' | '6/9' | 'm6/9'
  | '7' | 'maj7' | 'm7' | 'm7b5' | 'dim7' | 'mMaj7' | 'aug7' | 'augMaj7'
  | '7sus4' | '7sus2'
  | '9' | 'maj9' | 'm9' | '9sus4'
  | '11' | 'm11' | 'maj11'
  | '13' | 'm13' | 'maj13'
  | 'add9' | 'add2' | 'madd9' | 'add11' | 'add4';

export const CHORD_QUALITIES: readonly ChordQuality[] = [
  'major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4', 'power',
  '6', 'm6', '6/9', 'm6/9',
  '7', 'maj7', 'm7', 'm7b5', 'dim7', 'mMaj7', 'aug7', 'augMaj7',
  '7sus4', '7sus2',
  '9', 'maj9', 'm9', '9sus4',
  '11', 'm11', 'maj11',
  '13', 'm13', 'maj13',
  'add9', 'add2', 'madd9', 'add11', 'add4',
];

export function isChordQuality(v: unknown): v is ChordQuality {
  return typeof v === 'string' && (CHORD_QUALITIES as readonly string[]).includes(v);
}

/** Extension/alteration token ABOVE the base quality — the same token
 *  grammar parseChord accepts ('b9', '#11', 'add9', 'sus4', 'no3', …).
 *  'none' is the explicit empty marker and must appear alone (validateChord). */
export type ChordExtension =
  | 'none' | 'sus2' | 'sus4' | 'sus' | 'no3' | 'no5' | 'maj7'
  | '6' | '7' | '9' | '11' | '13'
  | `add${string}`
  | `${'b' | '#' | '♯' | '♭'}${string}`;

export function isChordExtension(v: unknown): v is ChordExtension {
  if (typeof v !== 'string') return false;
  if (['none', 'sus2', 'sus4', 'sus', 'no3', 'no5', 'maj7', '6', '7', '9', '11', '13'].includes(v)) return true;
  return /^(add|[b#♯♭])/.test(v);
}

/** The analyzed/spelled chord. Distinct from the schema's lane event `Chord`
 *  (id/symbol/startTick/durationTicks) — bridge with chordFromSymbol or
 *  chordClipOf (model.ts). */
export interface Chord {
  rootPc: PitchClass;
  rootName: NoteName;
  quality: ChordQuality;
  /** Extension/alteration tokens above the base quality; empty list = none
   *  ('none' may appear only alone — see validateChord). */
  extensions: ChordExtension[];
  /** Slash bass ("C/E" → "E"), null in root position. */
  bassNote: NoteName | null;
  /** Position of the sounding bass among the chord pcs ordered from the root
   *  (0 = root position, 1 = first inversion…); null only if the bass is not
   *  a chord tone (defensive — the parser never produces that). */
  inversion: number | null;
  /** The spelled symbol as displayed — crescode's canonical chord name. */
  spelling: string;
  /** 0..1 — 1 when user-authored; analysis confidence otherwise. */
  confidence: number;
  /** MIDI pitch classes this chord was derived from; empty when user-authored. */
  sourcePitchClasses: PitchClass[];
}

/** One ranked reading of input material. */
export interface ChordCandidate {
  chord: Chord;
  /** 0..1 — engine-assessed fit of this reading. */
  score: number;
  confidence: number;
  matchedPitchClasses: PitchClass[];
  /** Chord tones absent from the input material. */
  missingPitchClasses: PitchClass[];
  /** Input tones the chord does not explain. */
  extraPitchClasses: PitchClass[];
  /** Next-best readings of the same input, best first (no repeats of `chord`). */
  alternativeInterpretations: Chord[];
}

/** Position on the native timeline. `tick` is the ONLY authoritative value;
 *  bar/beat are derived views (tickToBarBeat), seconds a derived display
 *  value (ticksToSeconds) that exists only when a tempo was supplied. */
export interface TimePosition {
  /** Absolute ticks from project start, 0-based. */
  tick: number;
  /** 1-based bar, derived. */
  bar: number;
  /** 1-based beat within the bar (compound meters group in threes), derived. */
  beat: number;
  /** Derived seconds — display only (audio sync), null without a tempo. */
  seconds: number | null;
}

/** The host grid, derived from the project time signature at 960 PPQ. */
export interface GridResolution {
  ppq: number;
  timeSignature: TimeSignature;
  ticksPerBar: number;
  ticksPerBeat: number;
  ticksPerPulse: number;
  /** Compound meters (6/8, 9/8, 12/8) group pulses in threes. */
  compound: boolean;
}

/** Free-form clip metadata the adapter must preserve across updates. */
export type ClipMetadata = Record<string, string | number | boolean | null>;

/** A working view over a span of one track's notes. Crescent stores notes
 *  flat on `Track.notes` — clips are materialized windows, not containers. */
export interface MidiClip {
  id: string;
  /** Absolute ticks (native), 0-based. */
  startTime: number;
  lengthTicks: number;
  /** Owning track id — or CHORD_LANE_TRACK_ID for the chord lane, which is
   *  `project.chords` and not a Track. */
  trackId: string;
  notes: Pitch[];
  metadata: ClipMetadata;
}

/** One chord event on the chord lane, enriched for the suggestion feature. */
export interface ChordClip {
  id: string;
  /** Absolute ticks (native). */
  startTime: number;
  lengthTicks: number;
  chord: Chord;
  /** Source MIDI backing the analysis, null for user-typed symbols. */
  rawMidiNotes: Pitch[] | null;
  confidence: number;
  alternativeInterpretations: Chord[];
  /** Preserved by the adapter on every update (write contract, rule 3). */
  metadata: ClipMetadata;
}

/** Why a suggestion looks the way it does — an open set the engine may
 *  extend; consumers must render unknown categories generically. */
export type SuggestionColorCategory =
  | 'diatonic' | 'tonic' | 'subdominant' | 'dominant'
  | 'passing' | 'modal-color' | 'borrowed' | 'cadential';

export const SUGGESTION_COLOR_CATEGORIES: readonly SuggestionColorCategory[] = [
  'diatonic', 'tonic', 'subdominant', 'dominant', 'passing', 'modal-color', 'borrowed', 'cadential',
];

/** One suggestion the engine hands to the UI. */
export interface Suggestion {
  chord: Chord;
  /** 0..1. */
  score: number;
  colorCategory: SuggestionColorCategory;
  /** Machine-readable causes, e.g. "fits-key-scale", "resolves-prev-leading-tone". */
  reasonCodes: string[];
  /** One human sentence for the UI. */
  contextExplanation: string;
}

/** How the host spells — crescode canon is 'mixed' (Eb/Ab/Bb with F#/C#). */
export type SpellingPreference = 'sharps' | 'flats' | 'mixed';

export interface ProjectKey {
  /** Tonic pitch class 0–11 (0 = C) — the schema Project.key. */
  tonic: PitchClass;
  mode: ModeName;
  spelling: SpellingPreference;
}

/** Error contract for the whole feature — adapter and validation throw this;
 *  pure helpers return it inside result objects. Codes are machine-readable. */
export type SuggestionErrorCode =
  | 'invalid-midi-note'
  | 'invalid-chord-name'
  | 'overlapping-clips'
  | 'zero-length-gap'
  | 'invalid-range'
  | 'clip-not-found'
  | 'no-transaction'
  | 'transaction-open'
  | 'transaction-not-open';

export class SuggestionError extends Error {
  readonly code: SuggestionErrorCode;
  constructor(code: SuggestionErrorCode, message: string) {
    super(message);
    this.name = 'SuggestionError';
    this.code = code;
  }
}

/** Single-problem result style (matches parseChord's { ok, error } shape). */
export type SuggestionValidation = { ok: true } | { ok: false; error: SuggestionError };
