/**
 * Mixed-window velocity governor (spec §6 made operational for Compose All).
 *
 * The pads' own cap (maxMeanVelocityFor) bounds a window where ONLY the pads
 * sound. Real windows mix the pads with everything else the rules generator
 * wrote, and E counts every sounding roster role and every note's velocity.
 * After both generators have run, this pass re-checks every meter-aware beat
 * window and pulls PAD velocities down — and only pad velocities, minimally —
 * where the mix would breach the template's hard clamp:
 *
 *   E = roles/N × meanVel/127 ≤ max
 *   ⇒ padSum ≤ 127·max·N·totalNotes/roles − otherSum
 *
 * Windows already under the clamp are untouched (no pointless flattening);
 * pads from out-of-band or non-roster tracks are ignored by the math exactly
 * like measureEnergy ignores them. If the non-pad tracks alone breach the
 * clamp, pads drop to velocity 1 and the audit reports the breach — the rules
 * generator's output is not this pass's to rewrite. Pure: mutates only the
 * pad notes it was handed (fresh objects from the renderer), deterministically.
 */
import { barTicks, beatOffsets, beatTicks, projectBars } from '../../shared/schema/meter';
import type { Note, Project } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';

export interface MixGovernorInput {
  project: Project;
  template: EnsembleTemplate | null;
  /** Effective roster roles (template roster, or every in-band role with no band). */
  rosterRoles: ReadonlySet<string>;
  /** Pad notes per track id — fresh objects; velocities may be lowered. */
  padNotes: Map<string, Note[]>;
  /** Every other sounding source: role + notes (rules-generator output). */
  otherNotes: { role: string; notes: Note[] }[];
}

export function governPadVelocities(input: MixGovernorInput): void {
  const { project, template, rosterRoles, padNotes, otherNotes } = input;
  if (!template) return; // no band: no clamp to defend
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  if (N < 1 || rosterRoles.size === 0) return;

  const ts = project.timeSignature;
  const btBar = barTicks(ts);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const bt = beatTicks(ts);

  const pads = [...padNotes.entries()]
    .filter(([id]) => rosterRoles.has(project.tracks.find((t) => t.id === id)?.role ?? ''))
    .flatMap(([, notes]) => notes);
  const others = otherNotes.filter((t) => rosterRoles.has(t.role)).flatMap((t) => t.notes);
  if (!pads.length) return;

  const padRoles = new Set(
    [...padNotes.keys()].map((id) => project.tracks.find((t) => t.id === id)?.role ?? '').filter((r) => rosterRoles.has(r)),
  );

  // per-window totals over roster-sounding material
  interface Window { start: number; end: number; perPad: number }
  const windows: Window[] = [];

  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    const offsets = beatOffsets(ts);
    for (let b = 0; b < offsets.length; b++) {
      const start = barStart + offsets[b];
      if (start >= endTick) continue;
      const end = Math.min(endTick, start + bt);
      const roles = new Set<string>(padRoles);
      let otherSum = 0;
      let otherCount = 0;
      let padSum = 0;
      let padCount = 0;
      for (const n of others) {
        if (n.startTick < end && n.startTick + n.durationTicks > start) { otherSum += n.velocity; otherCount++; }
      }
      for (const t of otherNotes) {
        if (!rosterRoles.has(t.role)) continue;
        if (t.notes.some((n) => n.startTick < end && n.startTick + n.durationTicks > start)) roles.add(t.role);
      }
      for (const n of pads) {
        if (n.startTick < end && n.startTick + n.durationTicks > start) { padSum += n.velocity; padCount++; }
      }
      if (roles.size === 0 || otherCount + padCount === 0) continue;
      const energy = (roles.size / N) * (((otherSum + padSum) / (otherCount + padCount)) / 127);
      const allowedPadSum = (127 * clampMax * N * (otherCount + padCount)) / roles.size - otherSum;
      const perPad = energy > clampMax + 1e-9 && padCount > 0 ? Math.max(1, Math.floor(allowedPadSum / padCount)) : Infinity;
      windows.push({ start, end, perPad });
    }
  }

  if (!windows.length) return;
  for (const n of pads) {
    let cap = Infinity;
    for (const w of windows) {
      if (n.startTick < w.end && n.startTick + n.durationTicks > w.start) cap = Math.min(cap, w.perPad);
    }
    if (cap < n.velocity) n.velocity = Math.max(1, cap);
  }
}
