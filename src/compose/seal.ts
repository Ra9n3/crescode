/**
 * Structural invariant enforcement for the new engine.
 *
 * These are the checks that make the approved guarantees true rather than
 * aspirational: no invented material, no note out of range, no part without a
 * Director decision, no track created. Failures are returned, not thrown, so
 * the report can state exactly what broke.
 */
import { isInstrumentTrack, type Track } from '../shared/schema/types';
import type { OrchestraScore, Participation } from './ir';

export interface SealViolation {
  readonly kind: string;
  readonly detail: string;
}

export interface SealOptions {
  /** Track ids before composing; Compose All must never change this set. */
  readonly originalTrackIds: readonly string[];
  /** Tracks after compiling; the id set must be identical. */
  readonly finalTrackIds: readonly string[];
  /** Tracks the Director was told to skip, so their silence is not a bug. */
  readonly exemptTrackIds: ReadonlySet<string>;
}

export function seal(score: OrchestraScore, options: SealOptions): SealViolation[] {
  const violations: SealViolation[] = [];

  // 1. No track created or removed.
  const before = new Set(options.originalTrackIds);
  const after = new Set(options.finalTrackIds);
  for (const id of after) {
    if (!before.has(id)) violations.push({ kind: 'track-created', detail: `track ${id} did not exist before compose` });
  }
  for (const id of before) {
    if (!after.has(id)) violations.push({ kind: 'track-removed', detail: `track ${id} disappeared during compose` });
  }

  // 2. Every part traces to a Director decision.
  const assigned = new Map<string, Participation>();
  for (const section of score.plan.sections) {
    for (const slot of section.participation) assigned.set(slot.trackId, slot);
  }
  for (const part of score.parts) {
    if (!assigned.has(part.trackId)) {
      violations.push({ kind: 'unassigned-part', detail: `part ${part.trackId} has no Director participation` });
    }
  }

  // 3. Every note is inside its instrument's hard range.
  for (const part of score.parts) {
    for (const note of part.notes) {
      if (note.pitch < part.register.low || note.pitch > part.register.high) {
        violations.push({
          kind: 'out-of-range',
          detail: `${part.role} pitch ${note.pitch} outside [${part.register.low}, ${part.register.high}] at tick ${note.startTick}`,
        });
        break; // one report per part is enough to trace
      }
    }
  }

  // 4. Every note belongs to a phrase the engine actually planned.
  const phraseIds = new Set(score.phrases.map((phrase) => phrase.id));
  for (const part of score.parts) {
    for (const note of part.notes) {
      if (!phraseIds.has(note.phraseId)) {
        violations.push({
          kind: 'orphan-note',
          detail: `${part.role} note at ${note.startTick} references unknown phrase ${note.phraseId}`,
        });
        break;
      }
    }
  }

  // 5. A participation that claims spans but produced nothing is a silent
  //    disappearance — the defect the old engine shipped.
  for (const part of score.parts) {
    const slot = assigned.get(part.trackId);
    if (!slot) continue;
    const totalSpan = slot.spans.reduce((sum, span) => sum + (span.endTick - span.startTick), 0);
    if (totalSpan > 0 && part.notes.length === 0) {
      violations.push({
        kind: 'silent-part',
        detail: `${part.role} was assigned ${slot.materialRole} over ${totalSpan} ticks but produced no notes`,
      });
    }
  }

  // 6. No two notes in one part overlap identically (a doubling accident).
  for (const part of score.parts) {
    const seen = new Set<string>();
    for (const note of part.notes) {
      const key = `${note.pitch}:${note.startTick}`;
      if (seen.has(key)) {
        violations.push({
          kind: 'duplicate-note',
          detail: `${part.role} has two notes at pitch ${note.pitch} tick ${note.startTick}`,
        });
        break;
      }
      seen.add(key);
    }
  }

  return violations;
}

/**
 * Reports tracks that are eligible but received no Director decision. This is
 * deliberately a report rather than a violation: a locked or excluded track is
 * legitimately silent, and a track with no family engine yet is a known gap
 * that must be visible, not hidden.
 */
export function coverageReport(
  tracks: readonly Track[],
  score: OrchestraScore,
  exempt: ReadonlySet<string>,
): { assigned: string[]; unassigned: string[] } {
  const assigned = new Set<string>();
  for (const section of score.plan.sections) {
    for (const slot of section.participation) assigned.add(slot.trackId);
  }
  const assignedIds: string[] = [];
  const unassignedIds: string[] = [];
  for (const track of tracks) {
    if (!isInstrumentTrack(track)) continue;
    if (exempt.has(track.id)) continue;
    if (assigned.has(track.id)) assignedIds.push(track.role);
    else unassignedIds.push(track.role);
  }
  return { assigned: assignedIds, unassigned: unassignedIds };
}
