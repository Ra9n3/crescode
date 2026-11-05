/**
 * Strings humanize (Phase 5d). Deterministic per D8: the offsets are a pure
 * function of (musical inputs, take).
 *
 * Timing — POSITIVE offsets, correlated within a section: a per-section base
 * (one draw per section per role group, from one take stream) plus a small
 * per-note jitter. Violins/violas land in +5..+18 ms, cellosBasses in
 * +12..+28 ms; the Cb-layer doubles inside cellosBasses follow their cello
 * partner by a further 1..3 ms so the low octave trails naturally. Only the
 * START moves — the original end is kept, so notes keep their written span
 * and nothing re-articulates a legato join — clamped so a note can never
 * pass the project end, its section window, or shrink to zero length.
 * Tremolo notes take the section base WITHOUT per-note jitter (measured
 * repeats stay mechanical) and keep their velocity.
 *
 * Seeding (per note): the per-note timing/velocity jitter and the Cb follow
 * are hashed from the note's OWN identity (track, start, pitch) — never from
 * a sequential stream. The draws are therefore independent of which OTHER
 * notes exist, so a note outside the moment bars jitters identically whether
 * the run planned moments or not (Phase 8). The per-section bases stay on
 * the take stream: the section list never depends on the notes.
 *
 * Velocity — a small seeded jitter (±VELOCITY_JITTER) that never lifts a
 * note above the governor cap for its windows: the cap is read from the
 * sounding-role count of every beat window the (shifted) note touches, the
 * same bound the renderer and mix governor enforce.
 *
 * This deliberately does NOT reuse the engine's exported humanizeNotes: that
 * one jitters symmetrically around zero, moves start AND end together, and
 * has no notion of sections, role ranges, governor caps or Cb partners —
 * it stays with the rules generator's own humanize path, while the
 * orchestrator's strings get this module.
 *
 * Detune is intentionally NOT stored: it is a profile constant for the
 * preview synth, not project data.
 */
import { mulberry32, hashString, sanitizeNotes } from '../../engine/generate';
import { barTicks, beatTicks, projectBars } from '../../shared/schema/meter';
import { isInstrumentTrack, type Note, type Project } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { maxMeanVelocityFor } from '../energy';
import { msToTicks, orchestrationSeedFor, ticksToMs, type SpineSection } from '../spine';
import { BASS_TIMING_MS, CB_FOLLOW_MAX_MS, TIMING_JITTER_MS, VIOLIN_TIMING_MS } from './timing';

// The timing constants live in expression/timing.ts next to the tempo-map
// humanize head (Phase 5.1.3) so the audit and the tests read ONE source;
// re-exported here for the established import path.
export { BASS_TIMING_MS, CB_FOLLOW_MAX_MS, TIMING_JITTER_MS, VIOLIN_TIMING_MS } from './timing';

/* ---------------- named constants ---------------- */

/** Small velocity jitter (plain units on the 1..127 scale). */
export const VELOCITY_JITTER = 4;

export interface HumanizeInput {
  project: Project;
  template: EnsembleTemplate | null;
  sections: SpineSection[];
  /** Final rendered notes per TRACK id (in-band unlocked strings only). */
  notesByTrackId: Record<string, Note[]>;
  /** Every other sounding source (rules-generator notes by role) — feeds the
   *  window sounding counts the velocity cap reads. */
  otherNotes?: { role: string; notes: Note[] }[];
}

/** ms → ticks as a DURATION at tick `at` (exact under any tempo map). */
const msToTicksAt = (ms: number, at: number, tempoMap: Project['tempoMap']): number => {
  const baseMs = ticksToMs(at, tempoMap);
  return msToTicks(baseMs + ms, tempoMap) - msToTicks(baseMs, tempoMap);
};

/** The per-note jitter stream: hashed from the note's own identity (track,
 *  position, pitch) so a note's jitter never depends on which other notes
 *  exist (moments reorder nothing). */
const noteRng = (salt: string, trackId: string, n: Note): () => number =>
  mulberry32((hashString(`${salt}:${trackId}:${n.startTick}:${n.pitch}`) ^ 0x9e3779b9) >>> 0);

/**
 * Humanizes the handed-in string notes. Pure: returns NEW note arrays (the
 * input maps are not mutated), deterministic per (inputs, take).
 */
export function humanizeStrings(input: HumanizeInput): Record<string, Note[]> {
  const { project, template, sections, notesByTrackId, otherNotes } = input;
  const btBar = barTicks(project.timeSignature);
  const bt = beatTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const clampMax = template?.budget.energyClamp[1] ?? 1;
  const rosterSize = Math.max(1, template?.roster.length ?? 1);

  // the take stream: per-section base offsets only — the note draws are
  // per-note hashes (see the header), so the base draws are the ONLY stream
  // positions and they never depend on the notes
  const rng = mulberry32((orchestrationSeedFor(project, project.orchestration) ^ Math.imul(hashString('humanize'), 0x85ebca6b)) >>> 0);

  // per-section base offsets (ms): drawn so base ± jitter stays inside the range
  const baseViolins = new Map<number, number>();
  const baseBass = new Map<number, number>();
  const sortedSections = [...sections].sort((a, b) => a.startBar - b.startBar);
  for (const sec of sortedSections) {
    const drawBase = ([lo, hi]: readonly [number, number]): number => lo + TIMING_JITTER_MS + rng() * ((hi - lo) - 2 * TIMING_JITTER_MS);
    baseViolins.set(sec.index, drawBase(VIOLIN_TIMING_MS));
    baseBass.set(sec.index, drawBase(BASS_TIMING_MS));
  }
  const sectionOfTick = (tick: number): SpineSection => {
    const bar = Math.min(bars, Math.floor(tick / btBar) + 1);
    return sortedSections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars) ?? sortedSections[sortedSections.length - 1];
  };

  // beat-window sounding-role counts over the whole mix (strings + others):
  // the per-note velocity cap reads the same bound the governor enforces
  const roleOfTrackId = new Map(project.tracks.filter((t) => isInstrumentTrack(t)).map((t) => [t.id, t.role]));
  // the governor's roster: the template's roster roles, or (no band) every
  // role that actually sounds in the handed-in material
  const rosterRoles = new Set<string>(
    template
      ? template.roster.map((r) => r.role)
      : [...new Set([...Object.keys(notesByTrackId), ...(otherNotes ?? []).map((o) => o.role)].map((id) => roleOfTrackId.get(id) ?? id))],
  );
  const allByRole = new Map<string, Note[]>();
  for (const [id, notes] of Object.entries(notesByTrackId)) {
    const role = roleOfTrackId.get(id) ?? '';
    if (!rosterRoles.has(role)) continue;
    allByRole.set(role, [...(allByRole.get(role) ?? []), ...notes]);
  }
  for (const { role, notes } of otherNotes ?? []) {
    if (!rosterRoles.has(role)) continue;
    allByRole.set(role, [...(allByRole.get(role) ?? []), ...notes]);
  }
  const windowRoles: Set<string>[] = []; // index = beat window index
  const totalWindows = Math.ceil(endTick / bt);
  for (let wi = 0; wi < totalWindows; wi++) windowRoles.push(new Set());
  for (const [role, notes] of allByRole) {
    for (const n of notes) {
      const first = Math.max(0, Math.floor(n.startTick / bt));
      const last = Math.min(totalWindows - 1, Math.floor((n.startTick + n.durationTicks - 1) / bt));
      for (let wi = first; wi <= last; wi++) windowRoles[wi].add(role);
    }
  }
  const capFor = (startTick: number, endTickExcl: number): number => {
    const first = Math.max(0, Math.floor(startTick / bt));
    const last = Math.min(totalWindows - 1, Math.floor((endTickExcl - 1) / bt));
    let cap = 127;
    for (let wi = first; wi <= last; wi++) {
      if (!windowRoles[wi]) continue;
      cap = Math.min(cap, maxMeanVelocityFor(rosterSize, clampMax, windowRoles[wi].size));
    }
    return cap;
  };

  const out: Record<string, Note[]> = {};
  for (const [trackId, notes] of Object.entries(notesByTrackId)) {
    if (!notes.length) { out[trackId] = notes; continue; }
    const role = roleOfTrackId.get(trackId) ?? '';
    const isBass = role === 'cellosBasses';
    const range = isBass ? BASS_TIMING_MS : VIOLIN_TIMING_MS;

    const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    // Cb doubles: the 4.5 layering marks its doubles `layer: 'cb'` — when the
    // field is present it is the exact read. Notes written before the field
    // existed fall back to the geometric +12-same-start match (the layering
    // copies its partner's start).
    const hasLayerField = sorted.some((n) => n.layer !== undefined);
    const isDouble = new Set<Note>();
    const partnerOf = new Map<Note, Note>();
    if (isBass) {
      for (const n of sorted) {
        const isCb = hasLayerField ? n.layer === 'cb' : undefined;
        if (hasLayerField && !isCb) continue;
        const partner = sorted.find((m) => m !== n && (isCb === undefined || m.layer !== 'cb') && m.pitch === n.pitch + 12 && m.startTick === n.startTick);
        if (partner) { isDouble.add(n); partnerOf.set(n, partner); }
      }
    }

    // pass 1: offsets (ms) for every note — doubles defer to their partner
    const offsetMs = new Map<Note, number>();
    for (const n of sorted) {
      if (isDouble.has(n)) continue; // filled after the partner
      const sec = sectionOfTick(n.startTick);
      const base = isBass ? baseBass.get(sec.index)! : baseViolins.get(sec.index)!;
      const tremolo = n.articulation === 'tremolo';
      const jitter = tremolo ? 0 : (noteRng('crescode:humanize-timing', trackId, n)() * 2 - 1) * TIMING_JITTER_MS;
      offsetMs.set(n, Math.min(range[1], Math.max(range[0], base + jitter)));
    }
    for (const n of sorted) {
      if (!isDouble.has(n)) continue;
      const partner = partnerOf.get(n)!;
      const sec = sectionOfTick(n.startTick);
      const base = baseBass.get(sec.index)!;
      const follow = 1 + noteRng('crescode:humanize-cb', trackId, n)() * (CB_FOLLOW_MAX_MS - 1);
      const partnerOffset = offsetMs.get(partner);
      offsetMs.set(n, partnerOffset !== undefined
        ? partnerOffset + follow
        : Math.min(range[1], base + follow)); // partner rests this bar: fall back to the base
    }

    // pass 2: apply — start moves (never the end), velocity jitters under the cap
    const humanized: Note[] = sorted.map((n) => {
      const ms = offsetMs.get(n) ?? 0;
      const origEnd = n.startTick + n.durationTicks;
      const shifted = Math.round(n.startTick + msToTicksAt(ms, n.startTick, project.tempoMap));
      const start = Math.max(n.startTick, Math.min(origEnd - 1, shifted)); // positive only, never zero-length
      const tremolo = n.articulation === 'tremolo';
      let velocity = n.velocity;
      if (!tremolo) {
        const cap = capFor(start, origEnd);
        velocity = Math.max(1, Math.min(cap, Math.round(n.velocity + (noteRng('crescode:humanize-vel', trackId, n)() * 2 - 1) * VELOCITY_JITTER)));
      }
      return { ...n, startTick: start, durationTicks: Math.max(1, origEnd - start), velocity };
    });

    // keep the engine invariants intact (sanitize is then a no-op on the result)
    const [lo, hi] = trackRangeOf(project, trackId);
    out[trackId] = sanitizeNotes(humanized, lo, hi, endTick);
  }
  return out;
}

/** The track's hard pitch range (sanitize needs it; humanize never moves pitch). */
function trackRangeOf(project: Project, trackId: string): [number, number] {
  const t = project.tracks.find((x) => x.id === trackId)!;
  return [t.lowestNote, t.highestNote];
}
