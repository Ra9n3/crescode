/**
 * Energy measurement (spec §6). Pure: project in, report out; no I/O, never
 * throws, no mutation.
 *
 * E = occupancy × velocity, windowed per felt beat (meter-aware — compound
 * meters group pulses into dotted-pulse beats via beatOffsets/beatTicks).
 *   occupancy = distinct roster roles sounding in the window / roster size (D3)
 *   velocity  = mean velocity of the sounding notes in the window / 127
 * The window mean over NOTES (not per-track averages) is what makes the
 * governor work: capping every note's velocity at 127·max·N/n guarantees the
 * window mean lands under it, so a governed render can never exceed the clamp.
 *
 * Clamp max is HARD (violations are findings); clamp min is SOFT (a report on
 * windows where something sounds but the texture is thin). Fully silent
 * windows are reported as silence, not as floor violations — rests are
 * deliberate (spec §1: silence used on purpose).
 */
import { barTicks, beatOffsets, beatTicks, projectBars } from '../../shared/schema/meter';
import { isInstrumentTrack, type Note, type Project } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';

export interface EnergyWindow {
  startTick: number;
  endTick: number;
  bar: number; // 1-indexed
  beat: number; // 1-indexed felt beat inside the bar
  /** Distinct roster roles with at least one note sounding here. */
  soundingRoles: string[];
  noteCount: number;
  /** Mean velocity of the sounding notes, 1..127 (0 when silent). */
  meanVelocity: number;
  /** E = (soundingRoles/rosterSize) × (meanVelocity/127); 0 when silent. */
  energy: number;
}

export type EnergyViolationKind = 'aboveMax' | 'belowFloor';
export interface EnergyViolation {
  kind: EnergyViolationKind;
  /** Severity by spec: max is HARD, min is SOFT (report only). */
  severity: 'hard' | 'soft';
  startTick: number;
  energy: number;
  clamp: [number, number];
  message: string;
}

export interface EnergyReport {
  windows: EnergyWindow[];
  max: number;
  min: number;
  violations: EnergyViolation[];
  rosterSize: number;
}

const EPS = 1e-9;

/** All notes of roster tracks with their role, flattened once. Phase 8.2:
 *  the Double Basses desk (role 'basses') counts as the cellosBasses role —
 *  the split moved notes between two desks of ONE section, it added a role. */
function rosterNotes(p: Project, template: EnsembleTemplate): { role: string; notes: Note[] }[] {
  const roles = new Set(template.roster.map((r) => r.role));
  const out: { role: string; notes: Note[] }[] = [];
  for (const t of p.tracks) {
    if (!isInstrumentTrack(t) || t.notes.length === 0) continue;
    const role = t.role === 'basses' && roles.has('cellosBasses') ? 'cellosBasses' : t.role;
    if (!roles.has(role)) continue;
    out.push({ role, notes: t.notes });
  }
  return out;
}

export function measureEnergy(p: Project, template: EnsembleTemplate): EnergyReport {
  const ts = p.timeSignature;
  const rosterSize = template.roster.length;
  const bt = beatTicks(ts);
  const bars = projectBars(p);
  const btBar = barTicks(ts);
  const endTick = bars * btBar;
  const notes = rosterNotes(p, template);

  const windows: EnergyWindow[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * btBar;
    const offsets = beatOffsets(ts);
    for (let b = 0; b < offsets.length; b++) {
      const startTick = barStart + offsets[b];
      if (startTick >= endTick) continue;
      const winEnd = Math.min(endTick, startTick + bt);
      const roles = new Set<string>();
      let sum = 0;
      let count = 0;
      for (const { role, notes: ns } of notes) {
        for (const n of ns) {
          if (n.startTick < winEnd && n.startTick + n.durationTicks > startTick) {
            roles.add(role);
            sum += n.velocity;
            count++;
          }
        }
      }
      const meanVelocity = count ? sum / count : 0;
      windows.push({
        startTick, endTick: winEnd, bar: bar + 1, beat: b + 1,
        soundingRoles: [...roles].sort(),
        noteCount: count,
        meanVelocity,
        energy: count ? (roles.size / rosterSize) * (meanVelocity / 127) : 0,
      });
    }
  }

  const [minClamp, maxClamp] = template.budget.energyClamp;
  const sounding = windows.filter((w) => w.noteCount > 0);
  const violations: EnergyViolation[] = [];
  for (const w of sounding) {
    if (w.energy > maxClamp + EPS) {
      violations.push({
        kind: 'aboveMax', severity: 'hard', startTick: w.startTick, energy: w.energy, clamp: template.budget.energyClamp,
        message: `Energy ${w.energy.toFixed(3)} exceeds the hard clamp max ${maxClamp} at bar ${w.bar} beat ${w.beat}`,
      });
    } else if (w.energy < minClamp - EPS) {
      violations.push({
        kind: 'belowFloor', severity: 'soft', startTick: w.startTick, energy: w.energy, clamp: template.budget.energyClamp,
        message: `Texture below floor: energy ${w.energy.toFixed(3)} < ${minClamp} at bar ${w.bar} beat ${w.beat}`,
      });
    }
  }

  return {
    windows,
    max: sounding.length ? Math.max(...sounding.map((w) => w.energy)) : 0,
    min: sounding.length ? Math.min(...sounding.map((w) => w.energy)) : 0,
    violations,
    rosterSize,
  };
}
