/**
 * Brass family profile (Phase 8, spec §13). Zones, ceilings, phrase caps and
 * rhythm floors are defined in MIDI numbers, sounding pitch — the same units
 * the ranges table and the tests read (the note NAMES in ranges.ts are
 * written C4=60, the app displays C3=60; the MIDI numbers are the truth).
 *
 * Hard ranges stay in shared/schema/ranges.ts (the orchestrator never keeps
 * pitch limits); the sweet spots here are the ordinary WRITING window and
 * sit inside the hard ranges. Outside the sweet spot a part plays only above
 * the high energy fraction (HIGH_GATE) — a guard the current roles never
 * need, armed in the renderer.
 */
import { isInstrumentTrack, type Project, type ProjectEnsemble, type Track } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { isInBand } from '../../shared/schema/band';

export type BrassPart = 'horns' | 'trumpets' | 'trombones' | 'tuba';

export interface BrassProfile {
  role: BrassPart;
  /** The ordinary writing window, MIDI sounding. */
  sweet: [number, number];
  /** No SOFT dynamics (sustain/legato/swell) above this; accents may reach
   *  the hard range top above the high gate. Null = no soft ceiling. */
  softCeiling: number | null;
  /** A sustained stretch longer than this (seconds, tempo map) is cut and
   *  followed by at least one beat of rest (the breath mechanism, tuned per
   *  instrument through the cap lengths). */
  phraseCapSec: number;
  /** The smallest onset spacing the part allows in its ordinary roles. */
  rhythmFloor: 'quarter' | 'eighth';
}

/** §13.2 zones — MIDI sounding. */
export const BRASS_PROFILES: Record<BrassPart, BrassProfile> = {
  horns: { role: 'horns', sweet: [41, 72], softCeiling: 72, phraseCapSec: 10, rhythmFloor: 'quarter' },
  trumpets: { role: 'trumpets', sweet: [58, 77], softCeiling: 77, phraseCapSec: 6, rhythmFloor: 'eighth' },
  trombones: { role: 'trombones', sweet: [53, 70], softCeiling: null, phraseCapSec: 7, rhythmFloor: 'eighth' },
  tuba: { role: 'tuba', sweet: [41, 53], softCeiling: null, phraseCapSec: 5, rhythmFloor: 'eighth' },
};

export const BRASS_PARTS: readonly BrassPart[] = ['horns', 'trumpets', 'trombones', 'tuba'];

/** §13.3 gates: the bar's arc target as a fraction of the clamp max. */
export const BRASS_GATES = { low: 0.3, mid: 0.55, high: 0.75, peak: 0.9 } as const;
export type BrassLevel = 'off' | 'low' | 'mid' | 'high' | 'peak';

export const levelForNorm = (norm: number): BrassLevel =>
  norm >= BRASS_GATES.peak ? 'peak' : norm >= BRASS_GATES.high ? 'high' : norm >= BRASS_GATES.mid ? 'mid' : norm >= BRASS_GATES.low ? 'low' : 'off';

/** Outside the sweet spot a part plays only above this fraction (§13.2). */
export const OUT_OF_SWEET_GATE = BRASS_GATES.high;

/** §13.5: the brass lead draw (none / one per piece), peak only. */
export const BRASS_LEAD_WEIGHTS = { none: 0.65, one: 0.35 } as const;

/** §13.4: the trumpets' HIGH+ role draw per section type. */
export const TRUMPET_ROLE_WEIGHTS = { fanfare: 0.4, stab: 0.35, swell: 0.25 } as const;
export type TrumpetRole = keyof typeof TRUMPET_ROLE_WEIGHTS;

/** The part's track: in band, unlocked, instrument (one track per role). */
export function brassTrackOf(ctx: { project: Project; ensemble: ProjectEnsemble; template: EnsembleTemplate | null }, part: BrassPart): Track | null {
  return (
    ctx.project.tracks.find(
      (t) => t.role === part && t.family === 'Brass' && isInstrumentTrack(t) && !t.locked && isInBand(t.role, ctx.ensemble, ctx.template),
    ) ?? null
  );
}

/** The template's brass parts that actually have a writable track. */
export function brassRosterOf(ctx: { project: Project; ensemble: ProjectEnsemble; template: EnsembleTemplate | null }): BrassPart[] {
  if (!ctx.template) return []; // no band: the legacy rules generator keeps brass
  return BRASS_PARTS.filter((p) => brassTrackOf(ctx, p) !== null);
}
