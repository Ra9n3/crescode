/**
 * Strings family profile (spec §7.1, D6). Hard ranges are READ from
 * INSTRUMENTS in shared/schema/ranges.ts — the orchestrator never keeps its
 * own pitch limits. The "comfortable" window is the ordinary-writing register
 * (spec: V1 top ~E6); extremes are reachable but cost more in the voicer.
 * VOCAL_ZONE is the D6 default (A3..A5 sounding) — an author proposal the
 * user can still move.
 */
import { INSTRUMENTS, instrumentRange } from '../../shared/schema/ranges';

export interface StringProfile {
  role: string;
  name: string;
  /** Hard range, straight from the instrument table. */
  low: number;
  high: number;
  /** Ordinary writing window ⊆ [low, high]. */
  comfortable: [number, number];
  /** Default register slot — the voicer still assigns voices from the band (D7). */
  slot: 'top' | 'inner' | 'bass';
}

const byRole = new Map(INSTRUMENTS.map((d) => [d.role, d]));

function profile(role: string, comfortable: [number, number], slot: StringProfile['slot']): StringProfile {
  const def = byRole.get(role);
  if (!def || def.family !== 'Strings') throw new Error(`strings profile: "${role}" is not a Strings instrument in ranges.ts`);
  const [low, high] = instrumentRange(def);
  if (comfortable[0] < low || comfortable[1] > high) throw new Error(`strings profile: comfortable range of "${role}" escapes its hard range`);
  return { role, name: def.name, low, high, comfortable, slot };
}

/** Roster order = score order (top first). The voicer orders voices itself. */
export const STRING_PROFILES: StringProfile[] = [
  profile('violins1', [55, 88], 'top'),      // G3..C7, comfortable top E6 (spec §7.1)
  profile('violins2', [55, 86], 'inner'),    // G3..A6
  profile('violas', [48, 79], 'inner'),      // C3..E6, comfortable top G5
  profile('cellosBasses', [28, 60], 'bass'), // E1..C6 — bass register now; Vc+Cb layers arrive in Phase 3
];

export const STRING_PROFILE_BY_ROLE: ReadonlyMap<string, StringProfile> = new Map(STRING_PROFILES.map((s) => [s.role, s]));

export const STRING_ROLES: readonly string[] = STRING_PROFILES.map((s) => s.role);

/**
 * D6: the singer is not a Crescode track and is assumed to sing throughout,
 * so this sounding zone (A3..A5) is kept free of notes. Tunable constant.
 */
export const VOCAL_ZONE: readonly [number, number] = [57, 81]; // A3..A5

export const inVocalZone = (pitch: number): boolean => pitch >= VOCAL_ZONE[0] && pitch <= VOCAL_ZONE[1];
