/**
 * One seeded RNG for the whole string generator.
 *
 * Every random draw in the style-card engine goes through a `Rng` created here.
 * Nothing in the generator is allowed to call Math.random(): a composition is
 * reproducible from its seed alone, which is what lets the quality gate render
 * twelve candidates from one master seed and pick the best.
 */

/** mulberry32 — small, fast, good enough distribution for musical choices. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** True with probability p (0..1). */
  chance(p: number): boolean;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /**
   * Weighted pick. `weights` is parallel to `items`; the sum need not be 1.
   * Returns the last item if floating point drift overshoots.
   */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  /** Derived independent stream, for per-purpose isolation. */
  fork(salt: number): Rng;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const rng: Rng = {
    next,
    int: (min, max) => (max <= min ? min : min + Math.floor(next() * (max - min + 1))),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (!items.length) throw new Error('pick() from an empty list');
      return items[Math.min(items.length - 1, Math.floor(next() * items.length))];
    },
    weighted: (items, weights) => {
      if (!items.length) throw new Error('weighted() from an empty list');
      const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
      if (total <= 0) return items[items.length - 1];
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= Math.max(0, weights[i]);
        if (roll < 0) return items[i];
      }
      return items[items.length - 1];
    },
    fork: (salt) => createRng((seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0),
  };
  return rng;
}

/**
 * A fresh master seed from crypto-grade randomness.
 *
 * Falls back to Math.random only where `crypto` genuinely does not exist (older
 * test runners); the fallback is still seeded into mulberry32, so the rest of
 * the engine never sees it.
 */
export function freshSeed(): number {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const buffer = new Uint32Array(1);
    cryptoObj.getRandomValues(buffer);
    return buffer[0] >>> 0;
  }
  return (Math.floor(Math.random() * 0x100000000) >>> 0);
}
