/**
 * Spine (spec §8): the shared reading of the project every orchestrator
 * module must agree on — the normalized chord list (re-exported from the
 * engine), the section map in ticks, meter helpers, tempo-map time
 * conversion, and the orchestration seed. Pure functions only.
 */
import { hashString } from '../../engine/generate';
import { chordSpans } from '../../engine/generate';
import { barTicks, beatOffsets, beatTicks, isCompound, projectBars, pulseTicks } from '../../shared/schema/meter';
import type { OrchestrationState, Project, TempoEntry } from '../../shared/schema/types';

/** A chord span (normalized chord list entry, Phase 0). */
export type { ResolvedChord } from '../../engine/rules-schema';
export { chordSpans };
export { energyCurve, arcTargetAt, peakSectionOf, PEAK_RESERVE, PEAK_OPEN, CHORUS_STAIRCASE_OPEN, CHORUS_STAIRCASE_TOP, type ArcBar } from './energyArc';

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

/** The section a bar belongs to (sections tile the song; gaps fall back to the
 *  nearest section starting at or before the bar, then the first one). */
export function sectionAtBar(sections: SpineSection[], bar: number): SpineSection | null {
  if (!sections.length) return null;
  const covering = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
  if (covering) return covering;
  const before = [...sections].sort((a, b) => a.startBar - b.startBar).filter((s) => s.startBar <= bar);
  return before.length ? before[before.length - 1] : sections[0];
}

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

/* ---------------- orchestration seed (spec D8) ---------------- */

/**
 * The canonical musical inputs, D8: chords, structure, key, mode, tempo,
 * template id, band. Serialized SEMANTICALLY (no uids, no notes, no
 * orchestration state): two projects that agree musically hash identically
 * even if their track/chord ids differ, and editing only notes never moves
 * the seed. Pure, deterministic, never throws.
 */
export function orchestrationInputs(p: Project): string {
  const chords = chordSpans(p).map((s) => `${s.symbol}@${s.startTick}-${s.endTick}`).join(',');
  const structure = p.sections.length
    ? [...p.sections].sort((a, b) => a.startBar - b.startBar).map((s) => `${s.name}:${s.startBar}+${s.lengthBars}`).join(',')
    : `*:${projectBars(p)}`;
  const tempo = `${p.bpm}|${[...p.tempoMap].sort((a, b) => a.tick - b.tick).map((t) => `${t.tick}:${t.bpm}`).join(',')}`;
  const band = p.ensemble
    ? `${p.ensemble.templateId ?? 'none'};o:${sortedEntries(p.ensemble.overrides)};p:${sortedEntries(p.ensemble.pins)}`
    : 'none';
  return ['orchestration:v2', `chords:${chords}`, `structure:${structure}`, `key:${p.key}`, `mode:${p.mode}`, `tempo:${tempo}`, `band:${band}`].join('\n');
}

const sortedEntries = (rec: Record<string, string>): string =>
  Object.keys(rec).sort().map((k) => `${k}=${rec[k]}`).join(',').concat('.'); // trailing '.' so {} != {a:''} edge cases

/**
 * The orchestrator's seed source (spec D8): hashString over the musical
 * inputs, combined with the take counters. Same inputs + same take → the
 * same 32-bit stream seed (byte-identical output); any chord, structure,
 * key, mode, tempo, template or band change → a different stream; a section
 * re-roll changes only that section's seed.
 */
export function orchestrationSeed(p: Project, sectionId?: string): number {
  return orchestrationSeedFor(p, p.orchestration, sectionId);
}

/** Same derivation for a take state that is about to be written (the new
 *  take), so Compose All can seed generation before the edit lands. */
export function orchestrationSeedFor(p: Project, o: OrchestrationState | undefined, sectionId?: string): number {
  const base = hashString(orchestrationInputs(p));
  const takePart = hashString([
    `take:${o?.take ?? 0}`,
    `section:${sectionId ?? 'all'}`,
    `sectionTake:${(sectionId && o?.sectionTakes?.[sectionId]) ?? 0}`,
  ].join('|'));
  // mix both halves with odd multipliers so neither input can cancel the other
  return (Math.imul(base, 0x9e3779b1) ^ Math.imul(takePart, 0x85ebca6b)) >>> 0;
}
