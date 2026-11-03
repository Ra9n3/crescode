/**
 * Cinematic ostinato (Phase 4e). Violins II + Violas play chord tones at the
 * finest regular beat subdivision — meter-aware (simple meters divide the
 * felt beat in four, compound in three), floored at MIN_STEP_TICKS so very
 * fast beats stay playable. Notes are spiccato-length (under 0.25 s through
 * the TEMPO MAP, never a flat bpm), on the subdivision grid, each track
 * cycling the chord's keep-priority tone list from a take-seeded index.
 * Deterministic per (inputs, take, span).
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from '../spine';
import { beatTicks, isCompound } from '../../shared/schema/meter';
import { secondsToTicks } from '../spine';
import type { ChordTone } from '../voicing/chordTones';
import type { Note, Project, TempoEntry, TimeSignature } from '../../shared/schema/types';

export const MIN_STEP_TICKS = 120;
/** Measured-tremolo repeat rate (a 16th at 4/4), Phase 4e. */
export const TREMOLO_STEP_TICKS = 240;
/** Spiccato-length cap for short notes (ostinato, pizz pulses). */
export const SHORT_NOTE_SECONDS = 0.25;

/** The finest regular subdivision of one felt beat, in ticks. */
export function subdivisionTicks(ts: TimeSignature): number {
  return Math.max(MIN_STEP_TICKS, Math.floor(beatTicks(ts) / (isCompound(ts) ? 3 : 4)));
}

export interface OstinatoTrack {
  comfortable: [number, number];
  low: number;
  high: number;
}

export interface OstinatoInput {
  ts: TimeSignature;
  tempoMap: TempoEntry[];
  /** The window to fill (a chord span ∩ bar ∩ section piece, breaths cut). */
  startTick: number;
  endTick: number;
  /** The chord's tone pcs in keep-priority order. */
  tones: ChordTone[];
  /** The composed project (the D8 seed inputs + take ride on it). */
  project: Project;
  /** Drawn per span: deterministic per (inputs, take, span). */
  spanIndex: number;
  tracks: OstinatoTrack[];
  velocity: number;
}

/** The pitch of a pc nearest the middle of a comfortable window. */
const nearestPitch = (pc: number, low: number, high: number, mid: number): number => {
  const base = mid - ((((mid - pc) % 12) + 12) % 12);
  const candidates = [base - 12, base, base + 12].filter((p) => p >= low && p <= high);
  if (!candidates.length) return NaN;
  return candidates.reduce((best, p) => (Math.abs(p - mid) < Math.abs(best - mid) ? p : best), candidates[0]);
};

export function ostinatoNotes(input: OstinatoInput): Note[][] {
  const { ts, tempoMap, startTick, endTick, tones, project, spanIndex, tracks, velocity } = input;
  if (!tones.length || endTick <= startTick) return tracks.map(() => []);
  const step = subdivisionTicks(ts);
  const dur = Math.max(1, Math.min(Math.floor(step / 2), secondsToTicks(SHORT_NOTE_SECONDS, tempoMap) - 1));
  const seed = (orchestrationSeedFor(project, { take: project.orchestration?.take ?? 0 }) ^
    Math.imul(hashString('ostinato'), 0x85ebca6b) ^ Math.imul(spanIndex + 1, 0x9e3779b1)) >>> 0;
  const rng = mulberry32(seed);
  const pcs = tones.map((t) => ((t.pc % 12) + 12) % 12);

  const gridStart = Math.ceil(startTick / step) * step;
  // build each track's step pattern independently (deterministic draw order),
  // then keep every lower voice strictly under the upper voice AT EACH STEP
  const perTrack: Note[][] = tracks.map((track, ti) => {
    const mid = (track.comfortable[0] + track.comfortable[1]) / 2;
    const startIdx = Math.floor(rng() * pcs.length);
    const notes: Note[] = [];
    for (let i = 0, t = gridStart; t < endTick; t += step, i++) {
      const pc = pcs[(startIdx + i) % pcs.length];
      const pitch = nearestPitch(pc, track.low, track.high, mid);
      if (Number.isNaN(pitch)) continue;
      notes.push({ pitch, startTick: t, durationTicks: Math.min(dur, endTick - t), velocity, articulation: 'spiccato' });
    }
    void ti;
    return notes;
  });
  for (let ti = 1; ti < perTrack.length; ti++) {
    const upperAt = new Map(perTrack[ti - 1].map((n) => [n.startTick, n.pitch]));
    perTrack[ti] = perTrack[ti].filter((n) => {
      const up = upperAt.get(n.startTick);
      if (up === undefined) return true; // the upper voice rests on this step
      let pitch = n.pitch;
      while (pitch >= up && pitch - 12 >= tracks[ti].low) pitch -= 12;
      if (pitch >= up) return false;
      n.pitch = pitch;
      return true;
    });
  }
  return perTrack;
}
