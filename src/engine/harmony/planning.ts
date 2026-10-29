/**
 * Internal planning math shared by the Phase 3 modules (phrases, cadences,
 * plan). Deliberately NOT re-exported from index.ts — this is plumbing, not
 * API.
 *
 * Everything here is pure and deterministic: callers pass a seeded generator
 * (Crescode's mulberry32), so identical inputs always produce identical
 * outputs. No caching, no async, no dependencies.
 */

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const roundTo = (v: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/**
 * Deterministic weighted pick over a fixed-order weight list. Entries with
 * weight <= 0 are never picked; the seeded generator resolves proportions,
 * so the same (weights, rng) pair always yields the same value. When every
 * weight is zero the first entry wins (the caller decides what "nothing
 * plausible" means).
 */
export function pickWeighted<T extends string>(
  weights: ReadonlyArray<readonly [T, number]>,
  rng: () => number,
): T {
  const total = weights.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (!(total > 0)) return weights[0][0];
  let roll = rng() * total;
  for (const [value, w] of weights) {
    roll -= Math.max(0, w);
    if (roll < 0) return value;
  }
  return weights[weights.length - 1][0];
}

/**
 * Variation entropy (spec §10): maps raw tendency weights through
 * w^(1 / (0.35 + variation)). At variation 0 the exponent is ~2.9 — picks
 * hug the top tendency; at variation 1 the exponent is ~0.74 — the field
 * flattens and alternatives become reachable. Zero weights stay zero, and
 * the input order is preserved so downstream tie-breaking stays
 * deterministic.
 */
export function applyVariation<T extends string>(
  weights: ReadonlyArray<readonly [T, number]>,
  variation: number,
): Array<readonly [T, number]> {
  const v = Math.min(1, Math.max(0, variation));
  const exponent = 1 / (0.35 + v);
  return weights.map(([key, w]) => [key, w <= 0 ? 0 : Math.pow(w, exponent)] as const);
}

/** Highest-weight entry of a tendency record; ties resolve in insertion
 *  order, so records must be built in the module's fixed canonical order. */
export function topOf<T extends string>(tendencies: Record<T, number>): T {
  let best: T | null = null;
  let bestWeight = -Infinity;
  for (const [key, w] of Object.entries(tendencies) as Array<[T, number]>) {
    if (w > bestWeight) { best = key; bestWeight = w; }
  }
  return best as T;
}
