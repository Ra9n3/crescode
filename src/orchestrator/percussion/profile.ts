/**
 * Percussion family profile (Phase 10, spec §15). Ranges, fixed notes and
 * micro-timing ranges are defined in MIDI numbers / milliseconds, sounding
 * pitch — the same units the tests read (the note NAMES in ranges.ts are
 * written C4=60; the MIDI numbers are the truth).
 *
 * Timpani is the only pitched part (38–57, the four drum bands spanned);
 * snare, cymbals and aux are unpitched fixed notes. The config hard range
 * (ranges.ts, applied to the tracks by the factory) always wins — the
 * renderer writes inside the TRACK's own lowestNote/highestNote, never
 * inside a module constant.
 */
import { isInstrumentTrack, type Project, type ProjectEnsemble, type Track } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { isInBand } from '../../shared/schema/band';

export type PercPart = 'timpani' | 'snare' | 'cymbals' | 'aux';

export interface PercProfile {
  role: PercPart;
  /** The unpitched fixed note (null for the pitched timpani). */
  fixedNote: number | null;
  /** The file range as the factory writes it (the addendum's drum-band space). */
  range: [number, number];
  /** Micro-timing: the per-note lag range in ms (addendum §15.3), positive only. */
  timingMs: [number, number];
  /** The smallest onset spacing the part allows in its ordinary roles
   *  (rolls are exempt — that is their point, §15.4). */
  rhythmFloor: 'eighth' | 'sixteenth';
}

/** §15.1 — the ranges the factory writes (ranges.ts wins; these mirror it). */
export const PERC_PROFILES: Record<PercPart, PercProfile> = {
  timpani: { role: 'timpani', fixedNote: null, range: [38, 57], timingMs: [10, 24], rhythmFloor: 'eighth' },
  snare: { role: 'snare', fixedNote: 38, range: [38, 38], timingMs: [4, 12], rhythmFloor: 'sixteenth' },
  cymbals: { role: 'cymbals', fixedNote: 49, range: [49, 49], timingMs: [0, 6], rhythmFloor: 'eighth' },
  aux: { role: 'aux', fixedNote: 42, range: [42, 42], timingMs: [0, 6], rhythmFloor: 'eighth' },
};

export const PERC_PARTS: readonly PercPart[] = ['timpani', 'snare', 'cymbals', 'aux'];

/** §15.5 gates: the bar's arc target as a fraction of the clamp max. */
export const PERC_GATES = { low: 0.3, mid: 0.5, high: 0.72, peak: 0.9 } as const;
export type PercLevel = 'off' | 'low' | 'mid' | 'high' | 'peak';

export const levelForNormP = (norm: number): PercLevel =>
  norm >= PERC_GATES.peak ? 'peak' : norm >= PERC_GATES.high ? 'high' : norm >= PERC_GATES.mid ? 'mid' : norm >= PERC_GATES.low ? 'low' : 'off';

/** §15.4 chorus relief: the same chorus-like match the brass and winds use. */
export const PERC_CHORUS_LIKE = /chorus|refrain|hook|drop/;
export const isChorusTypeP = (name: string | undefined): boolean => PERC_CHORUS_LIKE.test((name ?? '').trim().toLowerCase());

/** The textures whose rhythm cell the snare pattern and the timpani's
 *  anchor pulse join (§15.4); aux also takes the pizz pulse. */
export const CELL_TEXTURES = new Set(['singleOstinato', 'interlockingOstinato', 'trailer']);
export const AUX_TEXTURES = new Set(['singleOstinato', 'interlockingOstinato', 'pizzPulse', 'trailer']);

/** §15.4 weighted draws (rare, reported). */
export const CRASH_WEIGHTS = { peakChorus: 1, firstChorus: 0.6, otherChorus: 0.4 } as const;
export const CYMBAL_SWELL_CHANCE = 0.5;
export const TIMPANI_ROLL_CHANCE = 0.4;
export const SNARE_ROLL_CHANCE = 0.4;
export const FINAL_TIMPANI_WEIGHTS = { none: 0.5, hit: 0.5 } as const;
/** The machine-gun bump: ±(1..3) velocity units, hashed per note (§15.5). */
export const REPEAT_BUMP_MAX = 3;

/** The part's track: in band, unlocked, instrument (one track per role). */
export function percTrackOf(ctx: { project: Project; ensemble: ProjectEnsemble; template: EnsembleTemplate | null }, part: PercPart): Track | null {
  return (
    ctx.project.tracks.find(
      (t) => t.role === part && t.family === 'Percussion' && isInstrumentTrack(t) && !t.locked && isInBand(t.role, ctx.ensemble, ctx.template),
    ) ?? null
  );
}

/** The template's percussion parts that actually have a writable track. */
export function percRosterOf(ctx: { project: Project; ensemble: ProjectEnsemble; template: EnsembleTemplate | null }): PercPart[] {
  if (!ctx.template) return []; // no band: the legacy rules generator keeps percussion
  return PERC_PARTS.filter((p) => percTrackOf(ctx, p) !== null);
}
