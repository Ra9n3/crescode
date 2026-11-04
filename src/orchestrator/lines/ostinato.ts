/**
 * Cinematic ostinato (Phase 4e), calmed down (Phase 4.6). The rate is part
 * of the texture: 8ths by default, 16ths only for the trailer texture. The
 * ostinato does not run through every bar of a section — the renderer gates
 * it per bar (enters 1–2 bars in, drops out for the section's dip bar) and
 * this generator rests on the last beat of every 4th bar's window when told
 * to (the renderer clips the window). Pattern shapes are seeded per take:
 * repeated note, chord-tone arpeggio, root-fifth. Interlocking textures run
 * the two tracks half a rate apart, so the rhythms never coincide.
 *
 * Note lengths: the trailer clips its notes under 0.25 s through the TEMPO
 * MAP (never a flat bpm); every other texture plays a short but not clipped
 * length (a detached share of its step). Deterministic per (inputs, take,
 * span).
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from '../spine';
import { beatTicks, isCompound } from '../../shared/schema/meter';
import { secondsToTicks } from '../spine';
import type { ChordTone } from '../voicing/chordTones';
import type { Note, Project, TempoEntry, TimeSignature } from '../../shared/schema/types';
import type { OstinatoShape } from '../conductor/layers';

export const MIN_STEP_TICKS = 120;
/** Measured-tremolo repeat rate (a 16th at 4/4), Phase 4e. */
export const TREMOLO_STEP_TICKS = 240;
/** Spiccato-length cap for short notes (the trailer ostinato, pizz pulses). */
export const SHORT_NOTE_SECONDS = 0.25;
/** Non-trailer ostinato: detached share of the step (short, not clipped). */
export const DETACHED_SHARE = 0.75;
/** Pizz pulse: even more clipped share of the step (it is a pluck). */
export const PIZZ_SHARE = 0.5;

/** The 16th-rate subdivision of one felt beat, in ticks (the trailer rate). */
export function subdivisionTicks(ts: TimeSignature): number {
  return Math.max(MIN_STEP_TICKS, Math.floor(beatTicks(ts) / (isCompound(ts) ? 3 : 4)));
}

/** The rate grid for a texture's rate: 8ths by default, 16ths for the trailer. */
export function rateTicks(ts: TimeSignature, rate: 'eighths' | 'sixteenths'): number {
  if (rate === 'sixteenths') return subdivisionTicks(ts);
  return Math.max(MIN_STEP_TICKS, Math.floor(beatTicks(ts) / (isCompound(ts) ? 3 : 2)));
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
  /** The texture's rate grid in ticks (8ths by default, 16ths for the trailer). */
  stepTicks: number;
  /** The take-seeded pattern shape. */
  shape: OstinatoShape;
  /** Interlocking: the lower track runs half a step late, never the same rhythm. */
  interlock: boolean;
  /** Trailer only: clip notes under 0.25 s; otherwise short but not clipped. */
  clipShort: boolean;
  articulation: 'spiccato' | 'pizz';
  /** The pitch the ostinato must stay under (the lead's lowest pitch in the
   *  window), or null when no tune sounds there. 4.6: the ostinato pulses
   *  UNDER the tune — the lead stays the top line. */
  ceilingPitch: number | null;
}

/** The pitch of a pc nearest the middle of a comfortable window, never above
 *  an optional ceiling (the ostinato stays under the lead, 4.6). */
const nearestPitch = (pc: number, low: number, high: number, mid: number, ceiling: number | null): number => {
  const top = ceiling === null ? high : Math.min(high, ceiling - 1);
  let best = NaN;
  for (let p = low; p <= top; p++) {
    if (((p % 12) + 12) % 12 !== pc) continue;
    if (Number.isNaN(best) || Math.abs(p - mid) < Math.abs(best - mid)) best = p;
  }
  return best;
};

export function ostinatoNotes(input: OstinatoInput): Note[][] {
  const { tempoMap, startTick, endTick, tones, project, spanIndex, tracks, velocity, stepTicks, shape, interlock, clipShort, articulation, ceilingPitch } = input;
  if (!tones.length || endTick <= startTick) return tracks.map(() => []);
  const step = Math.max(MIN_STEP_TICKS, Math.floor(stepTicks));
  const dur = clipShort
    ? Math.max(1, Math.min(Math.floor(step / 2), secondsToTicks(SHORT_NOTE_SECONDS, tempoMap) - 1))
    : Math.max(1, Math.floor(step * (articulation === 'pizz' ? PIZZ_SHARE : DETACHED_SHARE)));
  const seed = (orchestrationSeedFor(project, { take: project.orchestration?.take ?? 0 }) ^
    Math.imul(hashString('ostinato'), 0x85ebca6b) ^ Math.imul(spanIndex + 1, 0x9e3779b1)) >>> 0;
  const rng = mulberry32(seed);
  const pcs = tones.map((t) => ((t.pc % 12) + 12) % 12);
  const startIdx = Math.floor(rng() * pcs.length);
  // root-fifth alternates the bass pc and the perfect fifth above it — but
  // only when that fifth is itself in the handed-in tone set (the caller
  // pre-filters the leading tone; an E→B "fifth" in C Ionian must not
  // resurrect it): otherwise the alternation falls back to the next tone
  const fifthPc = (pcs[0] + 7) % 12;
  const altPc = pcs.includes(fifthPc) ? fifthPc : pcs[Math.min(1, pcs.length - 1)];

  // the pattern shape: which pc sounds on step i
  const pcAt = (i: number): number => {
    if (shape === 'repeat') return pcs[startIdx % pcs.length];
    if (shape === 'rootFifth') return i % 2 === 0 ? pcs[0] : altPc;
    return pcs[(startIdx + i) % pcs.length]; // chord-tone arpeggio
  };

  const gridStart = Math.ceil(startTick / step) * step;
  const half = Math.floor(step / 2);
  // per step index: track 0 on the grid; interlocked lower tracks half a
  // step late (the rhythms never coincide — that is the interlock)
  const pitchAt: Map<number, number>[] = tracks.map((track, ti) => {
    const mid = (track.comfortable[0] + track.comfortable[1]) / 2;
    const offset = interlock && ti > 0 ? half : 0;
    const map = new Map<number, number>();
    for (let i = 0, t = gridStart + offset; t < endTick; t += step, i++) {
      const pitch = nearestPitch(pcAt(i), track.low, track.high, mid, ceilingPitch);
      if (!Number.isNaN(pitch)) map.set(i, pitch);
    }
    return map;
  });
  // keep every lower voice strictly under the upper voice at the same step
  // index (same grid: the same onsets; interlocked: the same slot — the
  // upper voice sounding across the offset is the one it must sit under)
  for (let ti = 1; ti < pitchAt.length; ti++) {
    const upper = pitchAt[ti - 1];
    for (const [i, pitch] of pitchAt[ti]) {
      const up = upper.get(i);
      if (up === undefined) continue; // the upper voice rests on this step
      let p = pitch;
      while (p >= up && p - 12 >= tracks[ti].low) p -= 12;
      if (p >= up) pitchAt[ti].delete(i);
      else pitchAt[ti].set(i, p);
    }
  }
  // to notes (step index → onset; the map keeps them deterministic)
  return pitchAt.map((map, ti) => {
    const offset = interlock && ti > 0 ? half : 0;
    const notes: Note[] = [];
    for (const [i, pitch] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
      const t = gridStart + offset + i * step;
      notes.push({ pitch, startTick: t, durationTicks: Math.min(dur, endTick - t), velocity, articulation });
    }
    return notes;
  });
}
