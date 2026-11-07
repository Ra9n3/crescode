/**
 * Keys family profile (Phase 11, spec §16). Harp and piano. Ranges and
 * micro-timing are defined in MIDI numbers / milliseconds, sounding pitch —
 * the same units the tests read (the note NAMES in ranges.ts are written
 * C4=60; the MIDI numbers are the truth).
 *
 * The config hard range (ranges.ts — piano A0–C8 = 21–108, harp Cb1–G#7 =
 * 23–104, applied to the tracks by the factory) always wins — the renderer
 * writes inside the TRACK's own lowestNote/highestNote, never inside a module
 * constant. The harp's illustrative sweet spot (36–91) is the BED's writing
 * window; the extreme top and bottom octaves are reserved for roots and
 * glissandos (§16.2). One voice per track — sequential figures only, no
 * chords, so the layer field is never generalised (§16.1).
 */
import { isInstrumentTrack, type Project, type ProjectEnsemble, type Track } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { isInBand } from '../../shared/schema/band';

export type KeysPart = 'harp' | 'piano';

export interface KeysProfile {
  role: KeysPart;
  /** Micro-timing: the per-note lag range in ms (§16.7), positive only. */
  timingMs: [number, number];
  /** The bed/arpeggio writing window (the illustrative sweet spot; the
   *  extreme octaves are roots-and-glissandos only). */
  sweet: [number, number];
  /** The low register the roots, pulses and tutti hits fold into. */
  low: [number, number];
  /** The comp register (the piano's downbeat guide-tone window). */
  comp: [number, number];
  /** The smallest onset spacing the part allows (the glissandos' 16ths are
   *  a run — a figure, not a rhythm; the ordinary figures sit at eighths). */
  rhythmFloor: 'eighth';
}

/** §16.2 — the writing windows (ranges.ts wins; these mirror it). */
export const KEYS_PROFILES: Record<KeysPart, KeysProfile> = {
  harp: { role: 'harp', timingMs: [0, 8], sweet: [36, 91], low: [23, 35], comp: [36, 91], rhythmFloor: 'eighth' },
  piano: { role: 'piano', timingMs: [4, 12], sweet: [62, 84], low: [33, 52], comp: [62, 84], rhythmFloor: 'eighth' },
};

export const KEYS_PARTS: readonly KeysPart[] = ['harp', 'piano'];

/** §16.4 gates: the bar's arc target as a fraction of the clamp max
 *  (the house fractions, reported). The chorus relief engages from LOW. */
export const KEYS_GATES = { low: 0.3, mid: 0.5, high: 0.72, peak: 0.9 } as const;
export type KeysLevel = 'off' | 'low' | 'mid' | 'high' | 'peak';

export const levelForNormK = (norm: number): KeysLevel =>
  norm >= KEYS_GATES.peak ? 'peak' : norm >= KEYS_GATES.high ? 'high' : norm >= KEYS_GATES.mid ? 'mid' : norm >= KEYS_GATES.low ? 'low' : 'off';

/** §16.4 chorus relief: the same chorus-like match the brass, winds and
 *  percussion use (the Phase 8.3 lesson: a chorus must not get thinner). */
export const KEYS_CHORUS_LIKE = /chorus|refrain|hook|drop/;
export const isChorusTypeK = (name: string | undefined): boolean => KEYS_CHORUS_LIKE.test((name ?? '').trim().toLowerCase());

/** The templates whose piano carries the arpeggiator role (§16.3); the harp
 *  bed is roster-wide. The ostinato/trailer textures only ship on the
 *  doubling-'allowed' cinematic palette (§4.6), so the low octave pulse is
 *  de facto cinematic-only through its texture gate. */
export const PIANO_ARP_TEMPLATES = new Set(['ensemble.cinematic', 'ensemble.hybridstudio']);

/** §16.2a (Phase 11.1) the piano's register windows (MIDI, sounding):
 *  the right-hand material is centred in 62-84 with the chord's top voice
 *  around 72-84; the deliberate left-hand single root/fifth sits in 40-55
 *  at phrase starts. vocalbacking keeps the vocal zone (57-81) free by
 *  writing ABOVE it (the sparkle register, capped about 96) or below it
 *  (the low root/fifth); it never falls back to octave-down for chords or
 *  arpeggios. The octave pulse keeps its low window — that is its job. */
export const PIANO_LH = [40, 55] as const;
export const PIANO_SPARKLE_CAP = 96;
export const VB_SPARKLE = [82, PIANO_SPARKLE_CAP] as const;
export const VB_LOW = [40, 56] as const;

/** §16.3a (Phase 11.1) the piano's per-section pattern menu, drawn per
 *  section instance per take on its OWN salted stream (the existing draw
 *  streams untouched). chorus-type sections draw the relief drive's
 *  voicing variants (the drive's grid, note counts and velocities stay
 *  exactly the Phase 11 relief's — only the voicing changes, so the chorus
 *  energy is untouched); the other sections draw the comp menu (chamber,
 *  sonata) or the vocalbacking menu. Every section type has ≥ 4 outcomes. */
export type PianoPattern =
  | 'block' | 'offbeat' | 'broken' | 'alberti' | 'dyad' | 'echo' | 'callfill'
  | 'sparkle' | 'lowFifth' | 'highArp' | 'dyadHigh'
  | 'driveBlock' | 'driveInvert' | 'driveOpen' | 'driveTight';
export const PIANO_COMP_MENU: readonly PianoPattern[] = ['block', 'offbeat', 'broken', 'alberti', 'dyad', 'echo', 'callfill'];
export const PIANO_VB_MENU: readonly PianoPattern[] = ['sparkle', 'lowFifth', 'highArp', 'dyadHigh'];
export const PIANO_DRIVE_MENU: readonly PianoPattern[] = ['driveBlock', 'driveInvert', 'driveOpen', 'driveTight'];

/** §16.2 weighted glissando draws (rare — at most 2 per piece, reported). */
export const GLISS_WEIGHTS = { chorus: 0.35, tutti: 0.5, outro: 0.4 } as const;
export const GLISS_MAX_PER_PIECE = 2;

/** Outro-like section names the descending resolving gliss may land into. */
export const OUTRO_LIKE = /outro|coda|final|postlude/;

/** The part's track: in band, unlocked, instrument (one track per role). */
export function keysTrackOf(ctx: { project: Project; ensemble: ProjectEnsemble; template: EnsembleTemplate | null }, part: KeysPart): Track | null {
  return (
    ctx.project.tracks.find(
      (t) => t.role === part && t.family === 'Keys' && isInstrumentTrack(t) && !t.locked && isInBand(t.role, ctx.ensemble, ctx.template),
    ) ?? null
  );
}

/** The template's keys parts that actually have a writable track. */
export function keysRosterOf(ctx: { project: Project; ensemble: ProjectEnsemble; template: EnsembleTemplate | null }): KeysPart[] {
  if (!ctx.template) return []; // no band: the legacy rules generator keeps keys
  return KEYS_PARTS.filter((p) => keysTrackOf(ctx, p) !== null);
}
