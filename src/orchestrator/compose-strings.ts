/**
 * Early vertical integration: the new strings engine into Compose All.
 *
 * The new engine (`src/compose/`) owns string generation. Piano Engine V5
 * still owns the Piano track. This module is the seam between them, and it
 * exists for one reason: ORDERING.
 *
 * V5's analysis snapshot reads `finalizedTracks` — the notes of every other
 * instrument in the project. So the strings must already be written when V5's
 * input is built, or the Piano is composed against silence. That forces the
 * strings pass to run in the middle of `composeAllTracks`, not after it.
 *
 * What this module does NOT do:
 *   - it never calls the legacy orchestra generator (that code is gone);
 *   - it never invents, renames, duplicates or deletes a track;
 *   - it never writes the Piano track;
 *   - it holds no musical logic of its own — every note comes from
 *     `composeOrchestra`.
 *
 * Track ownership is decided by the new engine's own compiler, which only
 * writes a track it has a realised part for. A track the engine did not
 * realise keeps the notes it had. In this milestone that means non-string
 * parts are left exactly as `composeAllTracks` left them (empty), which is
 * the pre-existing behaviour for every non-Piano family.
 */
import { isInstrumentTrack, type CcLane, type Project, type Track } from '../shared/schema/types';
import { composeOrchestra, type ComposeOrchestraResult } from '../compose';
import { isStringRole } from '../compose/families/strings';

export interface StringsPassOptions {
  /** User-facing seed; same seed + same project gives identical strings. */
  readonly seed: number;
  /** The take this compose produces, matching the store's take semantics. */
  readonly take: number;
}

export interface StringsPassResult {
  /** Tracks after the strings pass — same ids, same order, same length. */
  readonly tracks: Track[];
  /** Ids the new engine actually wrote notes to. */
  readonly writtenTrackIds: readonly string[];
  /** Diagnostic report lines from the engine. */
  readonly reports: readonly string[];
  /** The full engine result, or null when there was nothing to compose. */
  readonly orchestra: ComposeOrchestraResult | null;
}

/**
 * The tracks this milestone considers eligible for the strings engine.
 *
 * Deliberately narrow: a track must be an instrument track, carry a role the
 * engine can place in a register band, be unlocked, and be in the ensemble
 * band. Anything else is left alone rather than guessed at.
 *
 * NOTE: `isStringRole` is the engine's own definition and is used verbatim so
 * this list can never drift from what the engine will actually realise.
 */
export function eligibleStringTrackIds(project: Project, inBand: (role: string) => boolean): string[] {
  return project.tracks
    .filter((track) => isInstrumentTrack(track) && !track.locked
      && isStringRole(track.role) && inBand(track.role))
    .map((track) => track.id);
}

/**
 * Runs the new strings engine and returns the project's tracks with the
 * string parts written in.
 *
 * Contract with the caller (`composeAllTracks`):
 *   - the returned array is the same length and order as `project.tracks`;
 *   - ids are preserved exactly — nothing is created or removed;
 *   - only tracks the engine realised carry new notes;
 *   - the Piano track is never written here (the engine has no part for it).
 */
export function composeStringsIntoProject(
  project: Project,
  options: StringsPassOptions,
  inBand: (role: string) => boolean,
): StringsPassResult {
  const eligible = new Set(eligibleStringTrackIds(project, inBand));
  if (eligible.size === 0) {
    // No eligible string tracks: do not run the engine at all. A project with
    // no strings must cost nothing and must not acquire tracks it never had.
    // `orchestra` is null here rather than a fabricated empty result, so a
    // caller cannot mistake "not run" for "ran and produced nothing".
    return { tracks: project.tracks, writtenTrackIds: [], reports: [], orchestra: null };
  }

  const orchestra = composeOrchestra(project, { seed: options.seed, take: options.take });

  // Map by id, never by index: the engine preserves ids, but trusting that
  // silently would be a way for a wrong part to reach a wrong track.
  const written = new Map<string, Track>();
  for (const track of orchestra.tracks) {
    if (!isInstrumentTrack(track)) continue;
    if (!eligible.has(track.id)) continue;
    written.set(track.id, track);
  }

  const tracks = project.tracks.map((track) => {
    const next = written.get(track.id);
    if (!next) return track;
    const notes = next.notes.map((note) => ({ ...note }));
    const lanes = (next as { cc?: CcLane[] }).cc;
    return {
      ...track,
      notes,
      // The engine owns the CC lanes of a track it wrote. When it produced
      // none, a stale pre-compose lane must not leak through the spread.
      ...(lanes && lanes.length ? { cc: lanes.map((lane) => ({ ...lane, points: lane.points.map((p) => ({ ...p })) })) } : { cc: undefined }),
    };
  });

  const writtenTrackIds = [...written.keys()];
  const reports = orchestra.reports.filter((line) => line.startsWith('strings:') || line.startsWith('cc:'));
  return { tracks, writtenTrackIds, reports, orchestra };
}
