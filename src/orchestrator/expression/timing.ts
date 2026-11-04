/**
 * Humanize timing constants and the tempo-map humanize head (Phase 5.1.3).
 *
 * The head replaces the old flat HUMANIZE_HEAD_TICKS = 60 constant: how far
 * a humanized attack may sit past its written (grid) tick is a TIME (the
 * ms ranges below plus the Cb follow), so in ticks it depends on the tempo
 * map. 31 ms is ~30 ticks at 60 BPM, ~50 at 100, ~62 at 120 and ~93 at
 * 180 — one constant is only right wherever the tempo happens to be
 * ~117 BPM. The audit (D10 voicesAt, exemption/climax lookbacks) and the
 * grid-tolerance tests read the head AT the position they check, through
 * the same tempo map the offsets themselves use.
 */
import { msToTicks, ticksToMs } from '../spine';
import type { TempoEntry } from '../../shared/schema/types';

/** Timing ranges in ms (positive only): [min, max] per role group. */
export const VIOLIN_TIMING_MS: readonly [number, number] = [5, 18];
export const BASS_TIMING_MS: readonly [number, number] = [12, 28];
/** Per-note jitter around the section base (ms). */
export const TIMING_JITTER_MS = 4;
/** Cb doubles trail their cello partner by 1..CB_FOLLOW_MAX_MS ms. */
export const CB_FOLLOW_MAX_MS = 3;

/** The largest offset humanize can add: the bass range top plus the Cb
 *  follow, plus 1 ms so the tick rounding of the drawn offset stays inside
 *  the head at every tempo. */
export const HUMANIZE_HEAD_MS = BASS_TIMING_MS[1] + CB_FOLLOW_MAX_MS + 1;

/** The humanize head at one position, in ticks through the tempo map:
 *  the most ticks a humanized attack may sit past its written grid tick. */
export function humanizeHeadTicks(tempoMap: TempoEntry[], atTick: number): number {
  const baseMs = ticksToMs(Math.max(0, atTick), tempoMap);
  return Math.ceil(msToTicks(baseMs + HUMANIZE_HEAD_MS, tempoMap) - msToTicks(baseMs, tempoMap));
}
