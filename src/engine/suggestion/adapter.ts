/**
 * The DAW adapter — the ONLY surface the Smart Chord Suggestion feature may
 * touch the host through. In crescode the "DAW" is this app: implementations
 * wrap the project model (`project.chords` + `Track.notes`) and the store's
 * undoable-edit mechanism. Swapping the adapter later must not require
 * touching the feature code above it.
 *
 * Contract rules (encoded in validation.ts, proven in tests):
 *  1. ALL times are absolute ticks at the project's grid resolution — never
 *     seconds (crescode model: ticks at 960 PPQ only).
 *  2. Every mutation (createMidiClip / replaceMidiNotes / clearMidiNotes /
 *     renameChordClip) MUST run inside an open undo transaction; a write
 *     outside one throws SuggestionError('no-transaction'). Transactions are
 *     not nestable; cancel restores the pre-transaction state.
 *  3. Updates PRESERVE the clip: position, length, name and metadata never
 *     change as a side effect of a note or chord update. ChordClip exposes
 *     all four so callers can observe and re-assert them.
 *  4. Chord names are validated through the shared parser before any write;
 *     invalid names throw SuggestionError('invalid-chord-name').
 */
import type {
  ChordClip, GridResolution, MidiClip, Pitch, ProjectKey, UndoTransaction,
} from './types';

/** Sentinel track id for the chord lane: chord clips live in
 *  `project.chords`, which is not a Track — the UI surfaces them on the
 *  Chords structure lane (role "chords"). */
export const CHORD_LANE_TRACK_ID = 'chords';

export type Unsubscribe = () => void;

/** Double-click on a chord-lane clip (or the empty lane — clip null, with the
 *  click time in ticks). This is crescode's "open suggestions here" gesture. */
export type DoubleClickHandler = (clip: ChordClip | null, time: number) => void;

export interface ChordTrackAPI {
  /** The project's key/mode (schema Project.key/.mode) + spelling canon. */
  getProjectKeySignature(): ProjectKey;

  /** The native grid: PPQ, time signature, ticks per bar/beat/pulse. */
  getGridResolution(): GridResolution;

  /** Clips whose [startTime, startTime+lengthTicks) intersects the range. */
  getChordClipsInRange(startTime: number, endTime: number): ChordClip[];

  /** The clip sounding at `time`, null on empty space. */
  getChordClipAt(time: number): ChordClip | null;

  /** Last clip ending at or before `time`; null when none. */
  getPreviousChordClip(time: number): ChordClip | null;

  /** First clip starting at or after `time`; null when none. */
  getNextChordClip(time: number): ChordClip | null;

  /** The open span around `time` between neighboring chord clips; null when
   *  `time` is inside a clip (there is no gap there). Zero-length gaps are
   *  never returned (validateGap). */
  getAvailableGapAt(time: number): { startTime: number; endTime: number } | null;

  /** Reserve an empty MIDI span on `trackId` (defaults to the chord lane in
   *  crescode's flow). Requires an open transaction; the returned clip view
   *  is empty — fill with replaceMidiNotes. */
  createMidiClip(startTime: number, lengthTicks: number, trackId?: string): MidiClip;

  getMidiNotes(clipId: string): Pitch[];

  /** Replace the clip's notes. Position, length, name and metadata are
   *  preserved (rule 3); pitches must validate (rule: invalid MIDI notes).
   *  Requires an open transaction. */
  replaceMidiNotes(clipId: string, notes: Pitch[]): void;

  /** Empty the clip's notes; the clip itself (bounds, name, metadata) stays.
   *  Requires an open transaction. */
  clearMidiNotes(clipId: string): void;

  /** Change the chord carried by a chord-lane clip. The symbol is validated
   *  through parseChord first (rule 4); id, position, length and metadata
   *  are preserved (rule 3). Requires an open transaction. */
  renameChordClip(clipId: string, chordName: string): void;

  /** Subscribe to the host's "open suggestions here" gesture. */
  subscribeToDoubleClick(trackId: string, callback: DoubleClickHandler): Unsubscribe;

  /** Open an undoable transaction grouping every write until commit/cancel.
   *  Throws 'transaction-open' if one is already open (no nesting). */
  beginUndoTransaction(label: string): UndoTransaction;

  /** Commit the open transaction as ONE undo step. */
  commitUndoTransaction(): void;

  /** Abort the open transaction; the host state must be exactly as before. */
  cancelUndoTransaction(): void;
}
