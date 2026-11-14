/** V1 identity is separate from D8: changing it must never reseed other families. */
import { hashString, mulberry32 } from '../../engine/generate';
import { orchestrationInputs } from '../spine';
import type { Project } from '../../shared/schema/types';

export interface WindIdentity {
  readonly version: 'winds-v1-stage2';
  readonly musicalInputs: string;
  readonly userSeed: number;
  readonly producedTake: number;
  readonly seed: number;
}
export type WindStream = 'casting' | 'phrase-design' | 'instrument-variation' | 'expression';
export function createWindIdentity(project: Project, userSeed: number, producedTake: number): WindIdentity {
  if (!Number.isFinite(userSeed) || !Number.isInteger(producedTake) || producedTake < 1) throw new Error('Invalid wind generation identity');
  const musicalInputs = orchestrationInputs(project);
  const identity = { version: 'winds-v1-stage2' as const, musicalInputs, userSeed: Math.trunc(userSeed), producedTake };
  return Object.freeze({ ...identity, seed: hashString(JSON.stringify(identity)) });
}
/** Fresh keyed streams: consumption in one decision/instrument cannot advance any other. */
export const windStream = (identity: WindIdentity, category: WindStream, key: string): (() => number) =>
  mulberry32(hashString(JSON.stringify([identity.seed, identity.version, category, key])));
