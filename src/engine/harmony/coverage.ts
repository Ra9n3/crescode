/**
 * Generation-scope coverage (Phase 4) — interval arithmetic that decides WHERE
 * chord events may be generated.
 *
 * The engine must work around the user's musical decisions, never override
 * them (spec §1, §3): locked chords are immutable anchors everywhere, manually
 * written harmony is preserved outside the requested scope, and a chord that
 * crosses a section boundary is protected in full (spec §12 — no automatic
 * resizing, and an explicit safe policy instead: a chord qualifies for
 * replacement inside a selected section only when it starts AND ends inside
 * it; everything else overlapping the section is preserved exactly).
 *
 * The output is a list of generation TARGETS — exact, gap-free, non-overlapping
 * open intervals that new chords may occupy — plus the preserved (`keep`) and
 * removed (`removed`) chord events. Preserved events keep their original
 * object identity, ids and timing; removed events are re-generated later and
 * therefore deliberately drop out of `keep`.
 *
 * This module is pure interval bookkeeping: no musical judgement, no chord
 * selection, no randomness. The song-span fallback for a fully empty project
 * (no sections, no chords) mirrors lib/genScope.ts deliberately — the engine
 * never imports from src/lib (lib imports the engine, never the reverse).
 */
import { DEFAULT_EMPTY_BARS, barTicks } from '../../shared/schema/meter';
import { isChordLocked, type Chord, type Project } from '../../shared/schema/types';
import type { GenerationScope } from './generation-types';

/** A chord event preserved from the existing project. */
export type PreservedChord = Chord;

/** One open interval new chords may occupy, with the preserved anchors that
 *  sound immediately before and after it (null at region edges). */
export interface GenerationTarget {
  startTick: number;
  endTick: number;
  /** Preserved chord ending exactly at startTick (harmonic context entering). */
  before: PreservedChord | null;
  /** Preserved chord starting exactly at endTick (harmonic context ahead). */
  after: PreservedChord | null;
}

/** The complete scope resolution for one generation request. */
export interface ScopePlan {
  regionStart: number;
  regionEnd: number;
  /** Preserved chord events (original objects, original timing). */
  keep: PreservedChord[];
  /** Eligible chord events removed for regeneration (replaced by targets). */
  removed: PreservedChord[];
  /** Disjoint, gap-free-within-region open intervals for new chords. */
  targets: GenerationTarget[];
}

/** Song span in ticks: end of the last section or chord, whichever is further.
 *  Mirrors lib/genScope.ts (kept local to avoid an engine → lib dependency). */
export function engineSongSpanTicks(p: Pick<Project, 'sections' | 'chords' | 'timeSignature'>): number {
  const bt = barTicks(p.timeSignature);
  let end = 0;
  for (const s of p.sections) end = Math.max(end, (s.startBar - 1 + s.lengthBars) * bt);
  for (const c of p.chords) end = Math.max(end, c.startTick + c.durationTicks);
  return end;
}

/** The generation region's end: the song span, or the default empty length
 *  (8 bars) when neither sections nor chords define a song yet. */
export function generationRegionEnd(project: Project): number {
  const span = engineSongSpanTicks(project);
  if (span > 0) return span;
  return DEFAULT_EMPTY_BARS * barTicks(project.timeSignature);
}

/** Merge overlapping or touching intervals; returns sorted, disjoint spans. */
function mergeIntervals(intervals: Array<{ startTick: number; endTick: number }>): Array<{ startTick: number; endTick: number }> {
  const sorted = intervals
    .filter((i) => i.endTick > i.startTick)
    .sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
  const out: Array<{ startTick: number; endTick: number }> = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startTick <= last.endTick) {
      last.endTick = Math.max(last.endTick, i.endTick);
    } else {
      out.push({ startTick: i.startTick, endTick: i.endTick });
    }
  }
  return out;
}

/** Complement of merged intervals within [regionStart, regionEnd), as exact
 *  open intervals. Zero-length gaps are dropped. */
function complement(
  merged: Array<{ startTick: number; endTick: number }>,
  regionStart: number,
  regionEnd: number,
): Array<{ startTick: number; endTick: number }> {
  const gaps: Array<{ startTick: number; endTick: number }> = [];
  let cursor = regionStart;
  for (const i of merged) {
    if (i.endTick <= cursor) continue;
    if (i.startTick > cursor) gaps.push({ startTick: cursor, endTick: Math.min(i.startTick, regionEnd) });
    cursor = Math.max(cursor, i.endTick);
    if (cursor >= regionEnd) break;
  }
  if (cursor < regionEnd) gaps.push({ startTick: cursor, endTick: regionEnd });
  return gaps.filter((g) => g.endTick > g.startTick);
}

/** Anchor lookups over the preserved chords. */
function anchorBefore(keep: PreservedChord[], tick: number): PreservedChord | null {
  let best: PreservedChord | null = null;
  for (const c of keep) {
    if (c.startTick + c.durationTicks === tick) best = best ? (best.startTick <= c.startTick ? best : c) : c;
  }
  return best;
}
function anchorAfter(keep: PreservedChord[], tick: number): PreservedChord | null {
  let best: PreservedChord | null = null;
  for (const c of keep) {
    if (c.startTick === tick) best = best ? (best.startTick >= c.startTick ? best : c) : c;
  }
  return best;
}

function buildTargets(regionStart: number, regionEnd: number, keep: PreservedChord[]): GenerationTarget[] {
  const protectedSpans = mergeIntervals(
    keep.map((c) => ({ startTick: c.startTick, endTick: c.startTick + c.durationTicks })),
  );
  return complement(protectedSpans, regionStart, regionEnd).map((g) => ({
    startTick: g.startTick,
    endTick: g.endTick,
    before: anchorBefore(keep, g.startTick),
    after: anchorAfter(keep, g.endTick),
  }));
}

/**
 * Resolve a generation scope into preserved chords, removed chords and
 * generation targets (spec §3 table, §12 boundary safety).
 *
 * - `all` (empty song or full coverage): regenerate the whole span. Locked
 *   chords are preserved everywhere; every unlocked chord is replaced.
 * - `empty` (partially populated): fill only the uncovered gaps. Every
 *   existing chord — locked or not — is preserved exactly.
 * - `section`: regenerate eligible unlocked chords INSIDE the selected
 *   section only. Eligible = unlocked, starts and ends inside. Chords that
 *   cross the boundary in either direction are preserved in full (spec §12);
 *   nothing outside the section is touched.
 */
export function resolveScopePlan(project: Project, scope: GenerationScope): ScopePlan {
  const bt = barTicks(project.timeSignature);

  if (scope.type === 'section') {
    const section = project.sections.find((s) => s.id === scope.sectionId);
    if (!section) {
      // Unresolvable scope: preserve everything, generate nothing.
      return { regionStart: 0, regionEnd: 0, keep: [...project.chords], removed: [], targets: [] };
    }
    const regionStart = (section.startBar - 1) * bt;
    const regionEnd = regionStart + section.lengthBars * bt;
    const removed: PreservedChord[] = [];
    const keep: PreservedChord[] = [];
    for (const c of project.chords) {
      const end = c.startTick + c.durationTicks;
      const eligible = !isChordLocked(c) && c.startTick >= regionStart && end <= regionEnd;
      (eligible ? removed : keep).push(c);
    }
    return { regionStart, regionEnd, keep, removed, targets: buildTargets(regionStart, regionEnd, keep) };
  }

  // 'all' and 'empty' both span the song.
  const regionStart = 0;
  const regionEnd = generationRegionEnd(project);
  if (scope.type === 'empty') {
    // Fill gaps only: every existing chord is preserved.
    const keep = [...project.chords];
    return { regionStart, regionEnd, keep, removed: [], targets: buildTargets(regionStart, regionEnd, keep) };
  }
  // Full-song generation: locked chords survive, unlocked chords are replaced.
  const keep = project.chords.filter((c) => isChordLocked(c));
  const removed = project.chords.filter((c) => !isChordLocked(c));
  return { regionStart, regionEnd, keep, removed, targets: buildTargets(regionStart, regionEnd, keep) };
}
