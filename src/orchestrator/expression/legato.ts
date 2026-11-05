/**
 * Legato overlap (Phase 5.1.2). In legato passages each note's end reaches
 * to the NEXT note's humanized start plus a seeded 10–30 ms overlap (through
 * the tempo map), so the bow change lands inside the next attack instead of
 * chattering at the join. Runs AFTER humanize (it reads the humanized
 * starts) and BEFORE the CC build (the CC68 legato windows then cover the
 * overlap too). Deterministic per D8: the overlap draws ride one seeded
 * take stream.
 *
 * Guardrails:
 *   - legato articulation ONLY — pizz/spiccato/tremolo notes never move;
 *   - one voice per track: a join is skipped when anything else sounds in
 *     the bridged stretch, except the join's own next note and its
 *     same-position octave doubles (the Cb layer follows its partner);
 *   - the join only re-glues what humanize/grid separated: the gap between
 *     the two notes may not exceed the tempo-map humanize head, so a
 *     written rest (a motif breath, a conductor breath) stays a rest;
 *   - a repeated pitch re-articulates — no overlap there (a tie would
 *     merge the notes and un-do the sanitize no-op);
 *   - never past the section window or the project end: when the section
 *     end would cramp the overlap below its 10 ms floor, the note is left
 *     as written.
 */
import { hashString, mulberry32 } from '../../engine/generate';
import { barTicks, projectBars } from '../../shared/schema/meter';
import type { Note, Project } from '../../shared/schema/types';
import { resolveTemplate } from '../../config/ensembles';
import { msToTicks, orchestrationSeedFor, ticksToMs, type SpineSection } from '../spine';
import { humanizeHeadTicks } from './timing';

/** The seeded overlap band (ms), through the tempo map at the next note. */
export const LEGATO_OVERLAP_MS: readonly [number, number] = [10, 30];

export interface LegatoInput {
  project: Project;
  sections: SpineSection[];
  /** Final humanized notes per TRACK id (in-band unlocked strings only). */
  notesByTrackId: Record<string, Note[]>;
}

/**
 * Extends legato note ends into their neighbours. Pure: returns NEW note
 * arrays (the input maps are not mutated), deterministic per (inputs, take).
 */
export function overlapLegato(input: LegatoInput): Record<string, Note[]> {
  const { project, sections, notesByTrackId } = input;
  const btBar = barTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const rng = mulberry32((orchestrationSeedFor(project, project.orchestration) ^ Math.imul(hashString('legato'), 0x85ebca6b)) >>> 0);

  // Phase 7: under a doubling-forbidding policy the crossfade must not
  // create a transient octave/unison pair with another track's note — the
  // extension is skipped for that note (the voicing itself never doubles,
  // so only the overlap could). 'allowed' templates are byte-identical.
  const template = resolveTemplate(project.ensemble);
  const forbidOctaves = !!template && template.rules.some((r) => r.type === 'octaveDoubling' && (r.params as { policy?: string }).policy !== 'allowed');
  const otherNotes = forbidOctaves
    ? Object.values(notesByTrackId).flat()
    : [];

  const sortedSections = [...sections].sort((a, b) => a.startBar - b.startBar);
  const sectionEndOf = (tick: number): number => {
    const bar = Math.min(bars, Math.floor(tick / btBar) + 1);
    const sec = sortedSections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
    return sec ? Math.min(endTick, sec.endTick) : endTick;
  };
  // ms → ticks as a DURATION at tick `at` (exact under any tempo map)
  const msToTicksAt = (ms: number, at: number): number => {
    const baseMs = ticksToMs(at, project.tempoMap);
    return msToTicks(baseMs + ms, project.tempoMap) - msToTicks(baseMs, project.tempoMap);
  };

  const out: Record<string, Note[]> = {};
  for (const [trackId, notes] of Object.entries(notesByTrackId)) {
    if (!notes.length) { out[trackId] = notes; continue; }
    const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    const legato = sorted.filter((n) => n.articulation === 'legato');
    const headAt = (tick: number): number => humanizeHeadTicks(project.tempoMap, tick);
    const isDoubleOf = (u: Note, v: Note): boolean =>
      Math.abs(u.pitch - v.pitch) === 12 && Math.abs(u.startTick - v.startTick) <= headAt(Math.max(u.startTick, v.startTick));

    // pass 1: the join target for every legato note, from the written ends
    const extendTo = new Map<Note, number>();
    for (const n of legato) {
      const nEnd = n.startTick + n.durationTicks;
      // the next legato note: the first one starting at or after the note's
      // end (sorted by start, so this is the passage's continuation)
      const m = legato.find((u) => u !== n && u.startTick >= nEnd);
      if (!m) continue;
      const gap = m.startTick - nEnd;
      if (gap > headAt(m.startTick)) continue; // a written rest stays a rest
      if (m.pitch === n.pitch) continue; // a repeated pitch re-articulates
      const overlapMs = LEGATO_OVERLAP_MS[0] + rng() * (LEGATO_OVERLAP_MS[1] - LEGATO_OVERLAP_MS[0]);
      const overlapTicks = Math.max(1, Math.round(msToTicksAt(overlapMs, m.startTick)));
      const target = m.startTick + overlapTicks;
      if (target > Math.min(endTick, sectionEndOf(n.startTick))) continue; // no cramped overlap at a section edge
      // a repeated pitch re-articulates — the extension must also never
      // create a same-pitch overlap (sanitize would truncate it back)
      const samePitchAhead = sorted.some((u) => u !== n && u.pitch === n.pitch
        && u.startTick < target && u.startTick + u.durationTicks > nEnd);
      if (samePitchAhead) continue;
      // one voice per track: nothing else may sound in the bridged stretch
      const blocked = sorted.some((u) => u !== n && u !== m
        && !isDoubleOf(u, m) && !isDoubleOf(u, n)
        && u.startTick < target && u.startTick + u.durationTicks > nEnd);
      if (blocked) continue;
      // and under a forbidding policy, no cross-track octave/unison in the
      // extended tail (the transient crossfade would read as a layer double)
      if (forbidOctaves) {
        const octClash = otherNotes.some((u) => u !== n
          && u.startTick < target && u.startTick + u.durationTicks > nEnd
          && Math.abs(u.pitch - n.pitch) % 12 === 0);
        if (octClash) continue;
      }
      extendTo.set(n, target);
    }

    // pass 2: apply — the END only, starts and pitches untouched
    out[trackId] = sorted.map((n) => {
      const target = extendTo.get(n);
      return target === undefined ? n : { ...n, durationTicks: Math.max(1, target - n.startTick) };
    });
  }
  return out;
}
