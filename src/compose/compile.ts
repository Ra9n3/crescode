/**
 * The compiler: OrchestraScore -> Track[].
 *
 * This is the ONLY module in the new engine that writes track notes. It makes
 * no musical decisions: it writes what the family engines realised, honours
 * locks byte-for-byte, leaves tracks with no realisation untouched, and never
 * creates, removes or renames a track.
 */
import { isInstrumentTrack, type CcLane, type Note, type Project, type Track } from '../shared/schema/types';
import type { OrchestraScore } from './ir';

export interface CompileResult {
  readonly tracks: Track[];
  /** Track ids the engine wrote this pass. */
  readonly writtenTrackIds: string[];
  /** Track ids left untouched (locked, no realisation, or out of scope). */
  readonly untouchedTrackIds: string[];
}

export function compile(
  score: OrchestraScore,
  project: Project,
  /** CC lanes built by the performance layer, keyed by track id. */
  ccByTrackId: ReadonlyMap<string, CcLane[]> = new Map(),
): CompileResult {
  const partsByTrack = new Map(score.parts.map((part) => [part.trackId, part]));
  const writtenTrackIds: string[] = [];
  const untouchedTrackIds: string[] = [];

  const projectTrackIds = new Set(project.tracks.map((track) => track.id));
  for (const part of score.parts) {
    if (!projectTrackIds.has(part.trackId)) {
      throw new Error(
        `compose: realised part ${part.trackId} has no matching project track — the engine must never invent a track`,
      );
    }
  }

  const tracks = project.tracks.map((track) => {
    if (!isInstrumentTrack(track)) {
      untouchedTrackIds.push(track.id);
      return track;
    }
    // Lock wins, unconditionally and byte-for-byte.
    if (track.locked) {
      untouchedTrackIds.push(track.id);
      return track;
    }
    const part = partsByTrack.get(track.id);
    if (!part) {
      // No realisation for this track in this phase: leave the existing
      // project content exactly as it was rather than blanking it.
      untouchedTrackIds.push(track.id);
      return track;
    }
    const notes = part.notes.map((note) => toNote(note));
    writtenTrackIds.push(track.id);
    const lanes = ccByTrackId.get(track.id);
    return {
      ...track,
      notes,
      // The engine owns these lanes. When it produced none, a stale pre-compose
      // lane must not leak through the spread.
      ...(lanes && lanes.length ? { cc: lanes } : { cc: undefined }),
    };
  });

  return { tracks, writtenTrackIds, untouchedTrackIds };
}

function toNote(note: {
  pitch: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
  articulation: string;
  role: string;
}): Note {
  return {
    pitch: note.pitch,
    startTick: note.startTick,
    durationTicks: Math.max(1, note.durationTicks),
    velocity: Math.max(1, Math.min(127, note.velocity)),
    articulation: note.articulation as Note['articulation'],
  };
}
