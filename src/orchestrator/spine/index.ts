/**
 * Spine (spec §8): the shared reading of the project every orchestrator
 * module must agree on — the normalized chord list (re-exported from the
 * engine), the section map in ticks, meter helpers, tempo-map time
 * conversion, and the orchestration seed. Pure functions only.
 */
import { hashString } from '../../engine/generate';
import { barTicks, beatOffsets, beatTicks, isCompound, projectBars, pulseTicks } from '../../shared/schema/meter';
import type { OrchestrationState, Project, TempoEntry } from '../../shared/schema/types';

/** A chord span (normalized chord list entry, Phase 0). */
export type { ResolvedChord } from '../../engine/rules-schema';
export { chordSpans } from '../../engine/generate';

/** A section window in ticks, with occurrence numbering for repeated names. */
export interface SpineSection {
  id: string;
  name: string;
  /** 0-indexed order in the song. */
  index: number;
  /** 1-based occurrence of this section NAME (Verse, Verse → 1, 2). */
  occurrence: number;
  startBar: number;
  lengthBars: number;
  startTick: number;
  endTick: number;
}

/**
 * The section map: sections sorted by start bar, name occurrences numbered,
 * converted to tick windows. A project without sections reads as one whole
 * song section ("*"), so the orchestrator always has a map.
 */
export function sectionMap(p: Project): SpineSection[] {
  const bt = barTicks(p.timeSignature);
  const bars = projectBars(p);
  const endTick = bars * bt;
  const src = p.sections.length
    ? [...p.sections].sort((a, b) => a.startBar - b.startBar)
    : [{ id: '__all', name: '*', startBar: 1, lengthBars: bars }];
  const occ: Record<string, number> = {};
  return src.map((s, index) => {
    const key = s.name.trim().toLowerCase();
    occ[key] = (occ[key] ?? 0) + 1;
    const startTick = (s.startBar - 1) * bt;
    return {
      id: s.id, name: s.name, index, occurrence: occ[key],
      startBar: s.startBar, lengthBars: s.lengthBars,
      startTick, endTick: Math.min(endTick, startTick + s.lengthBars * bt),
    };
  });
}

export { barTicks, beatOffsets, beatTicks, isCompound, projectBars, pulseTicks };

/* ---------------- tempo-map time conversion (spec §2.8) ---------------- */

const sortedMap = (tempoMap: TempoEntry[]): TempoEntry[] =>
  [...tempoMap].sort((a, b) => a.tick - b.tick);

/**
 * Ticks → milliseconds through the tempo MAP (never a single global bpm):
 * each segment between entries runs at its own bpm, ticks = ms·bpm·960/60000.
 * Entries after the last covered tick keep the last bpm.
 */
export function ticksToMs(tick: number, tempoMap: TempoEntry[]): number {
  if (!tempoMap.length) return 0;
  const map = sortedMap(tempoMap);
  let ms = 0;
  for (let i = 0; i < map.length; i++) {
    const entry = map[i];
    const segEnd = i + 1 < map.length ? map[i + 1].tick : Infinity;
    if (tick <= entry.tick) break;
    const spanTicks = Math.min(tick, segEnd) - entry.tick;
    ms += (spanTicks / 960) * (60000 / entry.bpm);
  }
  return ms;
}

/** Milliseconds → ticks through the tempo map (the exact inverse). */
export function msToTicks(ms: number, tempoMap: TempoEntry[]): number {
  if (!tempoMap.length) return 0;
  const map = sortedMap(tempoMap);
  let ticks = 0;
  let left = Math.max(0, ms);
  for (let i = 0; i < map.length; i++) {
    const entry = map[i];
    const segEndTick = i + 1 < map.length ? map[i + 1].tick : Infinity;
    const segMs = segEndTick === Infinity ? Infinity : ((segEndTick - entry.tick) / 960) * (60000 / entry.bpm);
    if (left <= segMs) return ticks + (left / 60000) * entry.bpm * 960;
    ticks = segEndTick;
    left -= segMs;
  }
  return ticks;
}

/** Seconds variant (0.25 s articulation thresholds convert through this). */
export const ticksToSeconds = (tick: number, tempoMap: TempoEntry[]): number => ticksToMs(tick, tempoMap) / 1000;
export const secondsToTicks = (sec: number, tempoMap: TempoEntry[]): number => msToTicks(sec * 1000, tempoMap);

/* ---------------- orchestration seed ---------------- */

/**
 * The orchestrator's seed source (spec §2.1 + §8). NOTE: the work order cites
 * "D8" for this; the spec's decisions end at D7, so this follows §2.1/§8
 * instead: the take number (plus a per-section take for re-rolls) hashes into
 * a deterministic 32-bit stream seed. Same take → byte-identical; a new take
 * → a new stream; a section re-roll changes only that section's seed.
 */
export function orchestrationSeed(p: Project, sectionId?: string): number {
  return orchestrationSeedFor(p.orchestration, sectionId);
}

/** Same seed derivation for a take state that is about to be written (the
 *  new take), so Compose All can seed generation before the edit lands. */
export function orchestrationSeedFor(o: OrchestrationState | undefined, sectionId?: string): number {
  return hashString([
    'orchestration',
    `take:${o?.take ?? 0}`,
    `section:${sectionId ?? 'all'}`,
    `sectionTake:${(sectionId && o?.sectionTakes?.[sectionId]) ?? 0}`,
  ].join('|'));
}
