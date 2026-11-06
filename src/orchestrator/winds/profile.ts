/**
 * Woodwind family profile (Phase 9, spec §14). Zones, ceilings, phrase caps
 * and rhythm floors are defined in MIDI numbers, sounding pitch — the same
 * units the ranges table and the tests read (the note NAMES in ranges.ts are
 * written C4=60, the app displays C3=60; the MIDI numbers are the truth).
 *
 * Hard ranges stay in shared/schema/ranges.ts (the orchestrator never keeps
 * pitch limits); the sweet spots here are the ordinary WRITING window and
 * sit inside the hard ranges. Outside the sweet spot a part plays only above
 * the high energy fraction (HIGH_GATE) — the clarinet's dark 50–62 is the
 * one exception (colour is its job, §14.2).
 */
import { isInstrumentTrack, type Project, type ProjectEnsemble, type Track } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { isInBand } from '../../shared/schema/band';

export type WindPart = 'flutes' | 'oboes' | 'clarinets' | 'bassoons';

export interface WindProfile {
  role: WindPart;
  /** The ordinary writing window, MIDI sounding. */
  sweet: [number, number];
  /** The weak zone's top (below it: soft only, rarely — colour). */
  weakTop: number;
  /** The strained zone's bottom (above it: loud only, hard articulations). */
  strainedBottom: number;
  /** No SOFT dynamics (sustain/legato) above this. Null = no soft ceiling. */
  softCeiling: number | null;
  /** No SOFT dynamics below this (the addendum's hard floors). Null = none. */
  softFloor: number | null;
  /** Notes in [leadBanLow, leadBanHigh] never carry a lead, counterline or
   *  pickup-run note (the addendum's register bans). Null = no ban. */
  leadBan: [number, number] | null;
  /** A sustained stretch longer than this (seconds, tempo map) is cut and
   *  followed by at least one beat of rest (the breath mechanism). */
  phraseCapSec: number;
  /** The addendum's bar bound on the cap (flutes 4, oboes 8; null = seconds only). */
  phraseCapBars: number | null;
  /** The smallest onset spacing the part allows in its ordinary roles. */
  rhythmFloor: 'sixteenth' | 'eighth';
  /** Repeated SAME-pitch 16ths allowed at any tempo (flutes only). */
  repeated16thsAnyTempo: boolean;
}

/** §14.2 zones — MIDI sounding (the addendum's table; config ranges win). */
export const WIND_PROFILES: Record<WindPart, WindProfile> = {
  flutes: {
    role: 'flutes', sweet: [72, 88], weakTop: 66, strainedBottom: 92,
    softCeiling: 84, softFloor: null, leadBan: [60, 66],
    phraseCapSec: 6, phraseCapBars: 4, rhythmFloor: 'sixteenth', repeated16thsAnyTempo: true,
  },
  oboes: {
    role: 'oboes', sweet: [64, 84], weakTop: 61, strainedBottom: 89,
    softCeiling: null, softFloor: 63, leadBan: null,
    phraseCapSec: 8, phraseCapBars: 8, rhythmFloor: 'sixteenth', repeated16thsAnyTempo: false,
  },
  clarinets: {
    role: 'clarinets', sweet: [67, 86], weakTop: 62, strainedBottom: 89,
    softCeiling: null, softFloor: null, leadBan: [65, 68],
    phraseCapSec: 10, phraseCapBars: null, rhythmFloor: 'sixteenth', repeated16thsAnyTempo: false,
  },
  bassoons: {
    role: 'bassoons', sweet: [41, 67], weakTop: 37, strainedBottom: 71,
    softCeiling: null, softFloor: 41, leadBan: null,
    phraseCapSec: 8, phraseCapBars: null, rhythmFloor: 'eighth', repeated16thsAnyTempo: false,
  },
};

export const WIND_PARTS: readonly WindPart[] = ['flutes', 'oboes', 'clarinets', 'bassoons'];

/** §14.4 gates: the bar's arc target as a fraction of the clamp max. */
export const WIND_GATES = { low: 0.3, mid: 0.5, high: 0.72, peak: 0.9 } as const;
export type WindLevel = 'off' | 'low' | 'mid' | 'high' | 'peak';

export const levelForNormW = (norm: number): WindLevel =>
  norm >= WIND_GATES.peak ? 'peak' : norm >= WIND_GATES.high ? 'high' : norm >= WIND_GATES.mid ? 'mid' : norm >= WIND_GATES.low ? 'low' : 'off';

/** §14.4 chorus relief (the Phase 8.3 idea): inside chorus-type sections the
 *  upper winds — flutes, oboes, clarinets — sound from the LOW gate so a
 *  chorus never thins with winds in, and the bassoon sounds wherever the
 *  cellos play (no energy gate of its own there). The soft-dip bar before a
 *  chorus may still thin out. The pattern is the same chorus-like match the
 *  spine's peak selection and the brass relief use — kept here as data so
 *  the module stays self-contained. */
export const WIND_CHORUS_LIKE = /chorus|refrain|hook|drop/;
export const isChorusTypeW = (name: string | undefined): boolean => WIND_CHORUS_LIKE.test((name ?? '').trim().toLowerCase());

/** Outside the sweet spot a part plays only above this fraction (§14.2). */
export const OUT_OF_SWEET_GATE_W = WIND_GATES.high;

/** §14.5: the wind lead draw (none / one per piece), bridge sections only. */
export const WIND_LEAD_WEIGHTS = { none: 0.7, one: 0.3 } as const;
/** The wind lead's instrument draw (rostered-filtered). */
export const WIND_LEAD_INSTRUMENT_WEIGHTS: Record<WindPart, number> = { flutes: 0.2, oboes: 0.45, clarinets: 0.35, bassoons: 0 };

/** §14.5: the lead double, drawn per section type. */
export const LEAD_DOUBLE_MODE_WEIGHTS = { octaveAbove: 0.55, unison: 0.25, none: 0.2 } as const;
export type LeadDoubleMode = keyof typeof LEAD_DOUBLE_MODE_WEIGHTS;
export const LEAD_DOUBLE_PART_WEIGHTS: Record<WindPart, number> = { flutes: 0.65, oboes: 0.35, clarinets: 0, bassoons: 0 };

/** §14.5: the pickup run (rare) — per-candidate chance, cap, instrument draw. */
export const PICKUP_RUN_CHANCE = 0.3;
export const PICKUP_RUN_MAX = 2;
export const PICKUP_RUN_PART_WEIGHTS: Record<WindPart, number> = { flutes: 0.5, clarinets: 0.35, oboes: 0.15, bassoons: 0 };

/** §14.2: flutter-tongue (peak only, stored as 'tremolo') — a rare weighted draw. */
export const FLUTTER_WEIGHTS: Record<WindPart, number> = { flutes: 0.15, clarinets: 0.1, oboes: 0, bassoons: 0 };

/** §14.7: the soli carrier pool's wind order (the first rostered joins). */
export const WIND_SOLI_ORDER: readonly WindPart[] = ['oboes', 'clarinets', 'flutes'];

/** The part's track: in band, unlocked, instrument (one track per role). */
export function windTrackOf(ctx: { project: Project; ensemble: ProjectEnsemble; template: EnsembleTemplate | null }, part: WindPart): Track | null {
  return (
    ctx.project.tracks.find(
      (t) => t.role === part && t.family === 'Woodwinds' && isInstrumentTrack(t) && !t.locked && isInBand(t.role, ctx.ensemble, ctx.template),
    ) ?? null
  );
}

/** The template's wind parts that actually have a writable track. */
export function windRosterOf(ctx: { project: Project; ensemble: ProjectEnsemble; template: EnsembleTemplate | null }): WindPart[] {
  if (!ctx.template) return []; // no band: the legacy rules generator keeps winds
  return WIND_PARTS.filter((p) => windTrackOf(ctx, p) !== null);
}
