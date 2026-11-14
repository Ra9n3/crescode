/** Strings V1 musical identity V2. No state and no Math.random.
 *
 * Contract: semantic project/orchestration seed + DISPLAYED user seed + the
 * produced take identify a composition. The orchestration seed is an opaque
 * input: its existing contract (and every non-string consumer) is unchanged.
 * Categories and individual decisions are addressed by label, not by PRNG
 * consumption order. Adding a rhythm decision cannot move a phrase draw.
 * Density/expression are deliberately not part of musical identity.
 */
import { hashString, mulberry32 } from '../../engine/generate';

export interface StringsIdentity {
  readonly version: 2;
  readonly userSeed: number;
  readonly orchestrationSeed: number;
  readonly take: number;
  readonly seed: number;
  readonly streams: Readonly<Record<'theme' | 'rhythm' | 'phrases' | 'development', number>>;
  readonly intent: {
    /** First move in scale steps; zero requests a repeated-note opening. */
    readonly opening: number;
    /** Relative pitch targets at four evenly spaced points; not note patterns. */
    readonly trajectory: readonly number[];
    readonly activity: number;
    readonly syncopation: number;
    readonly tension: number;
    readonly breadth: number;
    readonly phraseBeats: number;
    readonly patience: number;
  };
}

export function identityDraw(seed: number, label: string): number {
  return mulberry32(hashString(`strings-identity-v2|${seed >>> 0}|${label}`))();
}

export function createStringsIdentity(orchestrationSeed: number, userSeed: number, take: number): StringsIdentity {
  const normalized = Number.isFinite(userSeed) ? Math.trunc(userSeed) : 0;
  const actualTake = Math.max(0, Math.trunc(Number.isFinite(take) ? take : 0));
  const seed = hashString(`strings-identity-v2|orchestration:${orchestrationSeed >>> 0}|user:${normalized}|take:${actualTake}`);
  const stream = (label: string) => hashString(`${seed}|${label}`);
  const streams = { theme: stream('theme'), rhythm: stream('rhythm'), phrases: stream('phrases'), development: stream('development') };
  const draw = (label: string) => identityDraw(streams.theme, label);
  const breadth = 3 + Math.floor(draw('breadth') * 5);
  const opening = [-3, -2, -1, 0, 1, 2, 3, 4][Math.floor(draw('opening') * 8)];
  const sign = opening < 0 ? -1 : 1;
  return {
    version: 2, seed, orchestrationSeed: orchestrationSeed >>> 0, userSeed: normalized, take: actualTake, streams,
    intent: {
      opening,
      trajectory: [0, sign * (1 + draw('first-turn') * breadth), (draw('second-turn') * 2 - 1) * breadth, (draw('destination') * 2 - 1) * breadth * 0.65],
      activity: identityDraw(streams.rhythm, 'activity'), syncopation: identityDraw(streams.rhythm, 'placement'),
      tension: 0.05 + draw('tension') * 0.35, breadth,
      phraseBeats: 12 + Math.floor(identityDraw(streams.phrases, 'breath-span') * 5) * 4,
      patience: identityDraw(streams.development, 'patience'),
    },
  };
}
