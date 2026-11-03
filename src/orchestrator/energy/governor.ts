/**
 * Velocity governor (spec §6). With N roster tracks and n sounding in a
 * window, the window mean velocity must satisfy
 *   mean/127 × n/N ≤ clampMax   ⇒   mean ≤ 127 · clampMax · N / n.
 * Capping every NOTE's velocity at that bound therefore caps the window mean
 * and with it the energy. The bound is floored (never rounded up) so the hard
 * clamp really cannot be crossed: Sonata (N=3, max 0.65) floors to 82 — the
 * spec's "caps near 83" in prose, one below a rounding that would breach.
 * The governor limits NOTE velocity, not CC1.
 */
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';

/** Highest mean velocity n sounding tracks may hold without breaching the clamp. */
export function maxMeanVelocity(template: EnsembleTemplate, nSounding: number): number {
  return maxMeanVelocityFor(template.roster.length, template.budget.energyClamp[1], nSounding);
}

/** Primitive form used by the renderer (no template object needed). */
export function maxMeanVelocityFor(rosterSize: number, clampMax: number, nSounding: number): number {
  const n = Math.floor(nSounding);
  if (n <= 0) return 127; // nothing sounding: no note to cap
  return Math.min(127, Math.floor((127 * clampMax * Math.max(1, rosterSize)) / n));
}

/** Governor for a single note velocity in a window with n sounding tracks. */
export function governVelocity(template: EnsembleTemplate, nSounding: number, velocity: number): number {
  return Math.max(1, Math.min(Math.round(velocity), maxMeanVelocity(template, nSounding)));
}

/** Energy a window with n sounding tracks at mean velocity v will measure at. */
export function energyOf(template: EnsembleTemplate, nSounding: number, meanVelocity: number): number {
  if (nSounding <= 0) return 0;
  return (nSounding / template.roster.length) * (meanVelocity / 127);
}
