/**
 * Read-only snapshot of the finalized non-piano tracks for PianoEngine.
 * This copies source data only; it performs no analysis or musical decisions.
 * Piano is deliberately omitted, while harp remains a frozen, read-only input.
 */
import { isInstrumentTrack, type CcLane, type CcPoint, type Note, type Track, type TrackFamily } from '../../shared/schema/types';

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export interface PianoAnalysisCcLane {
  readonly cc: number;
  readonly points: readonly DeepReadonly<CcPoint>[];
}

export interface PianoAnalysisTrack {
  readonly id: string;
  readonly name: string;
  readonly family: TrackFamily;
  readonly role: string;
  readonly notes: readonly DeepReadonly<Note>[];
  readonly cc?: readonly PianoAnalysisCcLane[];
}

export interface PianoAnalysis {
  readonly tracks: readonly PianoAnalysisTrack[];
}

function snapshotNotes(notes: readonly Note[]): readonly DeepReadonly<Note>[] {
  return Object.freeze(notes.map((note) => Object.freeze({ ...note }))) as readonly DeepReadonly<Note>[];
}

function snapshotCc(lanes: readonly CcLane[] | undefined): readonly PianoAnalysisCcLane[] | undefined {
  if (!lanes) return undefined;
  return Object.freeze(lanes.map((lane) => Object.freeze({
    cc: lane.cc,
    points: Object.freeze(lane.points.map((point) => Object.freeze({ ...point }))),
  })));
}

/** Create a deep-frozen, piano-excluded snapshot without retaining Track refs. */
export function buildPianoAnalysisSnapshot(tracks: readonly Track[]): PianoAnalysis {
  const snapshot = tracks
    .filter((track) => isInstrumentTrack(track) && track.role !== 'piano')
    .map((track) => Object.freeze({
      id: track.id,
      name: track.name,
      family: track.family,
      role: track.role,
      notes: snapshotNotes(track.notes),
      ...(track.cc ? { cc: snapshotCc(track.cc) } : {}),
    }));
  return Object.freeze({ tracks: Object.freeze(snapshot) });
}
