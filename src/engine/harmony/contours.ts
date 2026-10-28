/**
 * Harmonic contours (Phase 2) — reusable descriptions of how a harmonic
 * dimension may EVOLVE across one section.
 *
 * A contour is a tendency, never a command: it maps a normalized position
 * within a section (0 = section start, 1 = section end) to a normalized
 * value in [0, 1]. Contours are independent of section duration, contain no
 * randomness, select no chords, and are reusable across dimensions — tension,
 * rhythm, complexity, stability all may evolve, so nothing here assumes the
 * contour describes "tension" specifically.
 *
 * All numeric outputs are INTERNAL PLANNING PARAMETERS (spec §6): they shape
 * the space of possibilities a later generation stage may explore. They are
 * not objective measurements of musical emotion and must not be presented
 * as such.
 */

export type ContourFamily = 'stable' | 'rising' | 'falling' | 'arch' | 'valley' | 'wave';

/** All families a contour may take — exported for exhaustive checks and tests. */
export const CONTOUR_FAMILIES: readonly ContourFamily[] = [
  'stable', 'rising', 'falling', 'arch', 'valley', 'wave',
];

/**
 * A contour description. Only `family` is required; every parameter has a
 * deterministic default so a bare `{ family: 'rising' }` is a complete,
 * well-defined contour.
 *
 * - `level`  — flat value for `stable` (default 0.5).
 * - `lo`/`hi` — value range for the shaped families (defaults 0.25 / 0.85).
 * - `peak`   — normalized position of the summit for `arch`/`valley`
 *              (default 0.5; strictly inside (0,1)).
 * - `cycles` — full oscillations for `wave` (default 2; whole numbers make
 *              the contour start and end at its midline).
 */
export interface Contour {
  family: ContourFamily;
  level?: number;
  lo?: number;
  hi?: number;
  peak?: number;
  cycles?: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Fill in a partially specified contour with the documented defaults. */
export function normalizeContour(c: Contour): Required<Contour> {
  const peak = c.peak === undefined ? 0.5 : Math.min(0.999, Math.max(0.001, c.peak));
  const cycles = c.cycles === undefined ? 2 : Math.max(1, c.cycles);
  return {
    family: c.family,
    level: c.level === undefined ? 0.5 : clamp01(c.level),
    lo: c.lo === undefined ? 0.25 : clamp01(Math.min(c.lo, c.hi ?? Infinity)),
    hi: c.hi === undefined ? 0.85 : clamp01(Math.max(c.hi, c.lo ?? -Infinity)),
    peak,
    cycles,
  };
}

/** Symmetric smooth hill: 0 at both ends, 1 at `peak` (half-cosine pieces). */
function archShape(t: number, peak: number): number {
  const u = t <= peak ? t / peak : (1 - t) / (1 - peak);
  return 0.5 - 0.5 * Math.cos(Math.PI * u);
}

/**
 * Evaluate a contour at a normalized section position.
 *
 * `t` is clamped to [0, 1]; the result is always within [0, 1]. The function
 * is pure and deterministic: identical (contour, t) pairs yield identical
 * values forever. Boundary behavior: `stable` is constant; `rising` maps 0→lo
 * and 1→hi; `falling` the reverse; `arch`/`valley` return `lo`/`hi` at BOTH
 * ends (their extremes live inside the section); integer-cycle `wave` starts
 * and ends on its midline.
 */
export function evaluateContour(contour: Contour, t: number): number {
  const c = normalizeContour(contour);
  const pos = clamp01(t);
  const mid = (c.lo + c.hi) / 2;
  const amp = (c.hi - c.lo) / 2;
  switch (c.family) {
    case 'stable':
      return c.level;
    case 'rising':
      return clamp01(c.lo + (c.hi - c.lo) * pos);
    case 'falling':
      return clamp01(c.hi - (c.hi - c.lo) * pos);
    case 'arch':
      return clamp01(c.lo + (c.hi - c.lo) * archShape(pos, c.peak));
    case 'valley':
      return clamp01(c.hi - (c.hi - c.lo) * archShape(pos, c.peak));
    case 'wave':
      return clamp01(mid + amp * Math.sin(2 * Math.PI * c.cycles * pos));
  }
}

/**
 * Sample a contour at fixed steps — a convenience for tests, previews and
 * future interpreters. `steps` evenly spaced positions from 0 to 1 inclusive.
 */
export function sampleContour(contour: Contour, steps = 32): number[] {
  const n = Math.max(2, Math.floor(steps));
  return Array.from({ length: n }, (_, i) => evaluateContour(contour, i / (n - 1)));
}

/**
 * Derive a contour's value range from a dimension preference (center +
 * flexibility): the contour explores roughly the range the preference makes
 * plausible. Pure arithmetic — same preference, same contour range, always.
 */
export function contourRangeForPreference(
  preferred: number,
  flexibility: number,
): { lo: number; hi: number } {
  const spread = Math.max(0, flexibility) * 0.6;
  return { lo: clamp01(preferred - spread), hi: clamp01(preferred + spread) };
}
