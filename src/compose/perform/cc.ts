/**
 * Layer 5 — Performance realization: CC lanes.
 *
 * Turns the musical intention carried in the notes into controller data,
 * emitting ONLY controllers the shipped UVI orchestral profile enables:
 * CC1 (mod wheel), CC7 (volume), CC11 (expression). CC68 (legato) and CC74
 * (brightness) are explicitly disabled in the profile, so writing them would
 * be inventing automation the library does not read.
 */
import type { CcLane, CcPoint } from '../../shared/schema/types';
import type { MusicalPart, OrchestraScore } from '../ir';

export const ENABLED_CCS = [1, 7, 11] as const;

export interface CcBuildInput {
  readonly score: OrchestraScore;
  readonly parts: readonly MusicalPart[];
  /**
   * Energy at a tick. Reserved for shaping CC1 against the energy arc; the
   * Phase 1 lanes take their contour from the notes' own velocities, which
   * already encode the phrase dynamic.
   */
  readonly energyAtTick?: (tick: number) => number;
}

/**
 * Builds one lane per enabled controller for every part that sounds.
 *
 * The shape is deliberately musical rather than mechanical:
 *  - CC1 (mod wheel) tracks the dynamic contour, so vibrato/intensity swells
 *    with the phrase instead of sitting still;
 *  - CC11 (expression) is the phrase arch: it rises into the phrase's peak and
 *    settles at its cadence;
 *  - CC7 (volume) is a static balance offset per role, set once, so the lead is
 *    forward and the inner voices sit back.
 */
export function buildCcLanesFor(input: CcBuildInput): Map<string, CcLane[]> {
  const lanes = new Map<string, CcLane[]>();
  for (const part of input.parts) {
    if (!part.notes.length) continue;
    lanes.set(part.trackId, buildLanesForPart(part));
  }
  return lanes;
}

function buildLanesForPart(part: MusicalPart): CcLane[] {
  const notes = [...part.notes].sort((a, b) => a.startTick - b.startTick);
  const start = notes[0].startTick;
  const lastNote = notes[notes.length - 1];
  const end = lastNote.startTick + lastNote.durationTicks;

  // CC1: modulate with the intensity the notes already carry.
  const mod: CcPoint[] = [];
  for (const note of notes) {
    const value = clamp(Math.round(note.velocity * 0.72 + 18));
    if (mod.length && mod[mod.length - 1].tick === note.startTick) continue;
    mod.push({ tick: note.startTick, value });
  }

  // CC11: a phrase arch per PHRASE, not per part. One arch stretched across a
  // whole part gave a 40-bar piece four control points: a mechanical ramp that
  // said nothing about where the phrases breathe. Shape each phrase from its
  // own note velocities and release into the boundary.
  const expression: CcPoint[] = [];
  const byPhrase = new Map<string, typeof notes>();
  for (const note of notes) {
    const bucket = byPhrase.get(note.phraseId);
    if (bucket) bucket.push(note);
    else byPhrase.set(note.phraseId, [note]);
  }
  for (const phraseNotes of byPhrase.values()) {
    const first = phraseNotes[0];
    const last = phraseNotes[phraseNotes.length - 1];
    const phraseStart = first.startTick;
    const phraseEnd = last.startTick + last.durationTicks;
    const peak = Math.max(...phraseNotes.map((note) => note.velocity));
    const base = Math.min(...phraseNotes.map((note) => note.velocity));
    const toExpression = (velocity: number): number =>
      clamp(Math.round(44 + (velocity / 127) * 66));
    expression.push({ tick: phraseStart, value: toExpression(base) });
    // The peak lands where the phrase itself is loudest, not at a fixed ratio.
    const loudest = phraseNotes.reduce(
      (best, note) => (note.velocity > best.velocity ? note : best),
      phraseNotes[0],
    );
    if (loudest.startTick > phraseStart) {
      expression.push({ tick: loudest.startTick, value: toExpression(peak) });
    }
    expression.push({ tick: Math.max(loudest.startTick, phraseEnd - 1), value: toExpression(base) });
  }
  if (!expression.length) {
    expression.push({ tick: start, value: 72 }, { tick: end, value: 68 });
  }

  // CC7: a balance offset by role, set once at the start.
  const balance = part.notes[0].role === 'lead'
    ? 108
    : part.notes[0].role === 'bass'
      ? 96
      : 88;
  const volume: CcPoint[] = [{ tick: start, value: balance }, { tick: end, value: balance }];

  return [
    { cc: 1, points: dedupe(mod) },
    { cc: 7, points: volume },
    { cc: 11, points: dedupe(expression) },
  ];
}

function dedupe(points: CcPoint[]): CcPoint[] {
  const seen = new Map<number, number>();
  for (const point of points) seen.set(point.tick, point.value);
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, value]) => ({ tick, value }));
}

const clamp = (value: number): number => Math.max(0, Math.min(127, value));
