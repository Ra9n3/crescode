/**
 * Keys family profile (Phase 11, spec §16). Harp and piano. Ranges and
 * micro-timing are in MIDI numbers / milliseconds, sounding pitch — the same
 * units the tests read (the note names in ranges.ts are written C4=60).
 *
 * The harp keeps its existing bed, roots, glissandos and closing descent.
 * The piano keeps the held two-hand anchor from 11.6a; 11.6b adds a
 * section-level support/motion choice and phrase-rotated RH figures over it.
 */
import { isInstrumentTrack, type NoteRoleTag, type Project, type ProjectEnsemble, type Track } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { isInBand } from '../../shared/schema/band';

export type KeysPart = 'harp' | 'piano';
export type PianoRoleTag = NoteRoleTag;

export interface KeysProfile {
  role: KeysPart;
  /** Micro-timing: per-note lag range in ms (§16.7), positive only. */
  timingMs: [number, number];
  /** The bed/arpeggio writing window (harp) or chord window (piano). */
  sweet: [number, number];
  /** The low register the harp roots and piano body fold into. */
  low: [number, number];
  /** The chord register (piano RH, or harp's rolled-chord material). */
  comp: [number, number];
  rhythmFloor: 'eighth';
}

/** §16.2 — illustrative windows; the track's hard range is authoritative. */
export const KEYS_PROFILES: Record<KeysPart, KeysProfile> = {
  harp: { role: 'harp', timingMs: [0, 8], sweet: [36, 91], low: [23, 35], comp: [36, 91], rhythmFloor: 'eighth' },
  piano: { role: 'piano', timingMs: [4, 12], sweet: [64, 108], low: [36, 56], comp: [64, 108], rhythmFloor: 'eighth' },
};

export const KEYS_PARTS: readonly KeysPart[] = ['harp', 'piano'];

/** §16.4 gates: the bar's arc target as a fraction of the clamp max. */
export const KEYS_GATES = { low: 0.3, mid: 0.5, high: 0.72, peak: 0.9 } as const;
export type KeysLevel = 'off' | 'low' | 'mid' | 'high' | 'peak';

export const levelForNormK = (norm: number): KeysLevel =>
  norm >= KEYS_GATES.peak ? 'peak' : norm >= KEYS_GATES.high ? 'high' : norm >= KEYS_GATES.mid ? 'mid' : norm >= KEYS_GATES.low ? 'low' : 'off';

/** Chorus-like section names receive the established low-gate relief. */
export const KEYS_CHORUS_LIKE = /chorus|refrain|hook|drop/;
export const isChorusTypeK = (name: string | undefined): boolean => KEYS_CHORUS_LIKE.test((name ?? '').trim().toLowerCase());

/** Piano hand bands (MIDI, sounding). */
export const PIANO_LH = [40, 55] as const;
export const PIANO_RH = [64, 108] as const;
export const VB_LOW = [40, 56] as const;
export const VB_RH = [82, 108] as const;
/** Vocalbacking's piano figure sparkle body and rare peak phrase-start cap. */
export const VB_SPARKLE_BODY = [82, 91] as const;
export const VB_SPARKLE_PEAK = [92, 96] as const;

/** Piano concurrency cap — enforced on the written and jittered schedules. */
export const PIANO_CONCURRENCY = { total: 8, below55: 2, at55: 6 } as const;
/** At least a minor sixth between the LH top and RH bottom. */
export const PIANO_HAND_GAP = 8;

export type PianoJob = 'support' | 'motion';
export type PianoFigure =
  | 'arpUp' | 'arpDown' | 'arpPendulum'
  | 'alberti' | 'cascade' | 'wideBroken' | 'ostinatoCell' | 'highSparkle';
export type PianoFigureFamily = 'arpeggio' | Exclude<PianoFigure, 'arpUp' | 'arpDown' | 'arpPendulum'>;
export type PianoEnergySlope = 'rising' | 'falling' | 'flat';

/** A balanced alternating job ring; output take offsets the first section. */
export const PIANO_JOB_ROTATION: readonly PianoJob[] = ['support', 'motion'];
/** Motion figures are selected phrase-by-phrase; repeated sonata Alberti
 *  slots make it its heavy-weight figure without adjacent repeats. */
export const PIANO_MOTION_MENUS: Record<string, readonly PianoFigureFamily[]> = {
  'ensemble.chamber': ['arpeggio', 'alberti', 'cascade', 'wideBroken', 'highSparkle'],
  'ensemble.sonata': ['alberti', 'arpeggio', 'alberti', 'cascade', 'alberti', 'wideBroken', 'alberti', 'highSparkle'],
  'ensemble.vocalbacking': ['wideBroken', 'arpeggio', 'wideBroken', 'alberti', 'cascade', 'wideBroken', 'ostinatoCell', 'wideBroken', 'highSparkle'],
  'ensemble.cinematic': ['arpeggio', 'alberti', 'cascade', 'ostinatoCell', 'wideBroken', 'highSparkle'],
  'ensemble.hybridstudio': ['arpeggio', 'alberti', 'cascade', 'ostinatoCell', 'wideBroken', 'highSparkle'],
};
/** Only these two figure families compete for the section's single arp owner.
 *  Alberti is the specified bed pattern; cascade is a slow arpeggio. */
export const PIANO_ARPEGGIATOR_FAMILIES = new Set<PianoFigureFamily>(['arpeggio', 'cascade']);
/** Arpeggio up figures may occupy at most one fifth of motion bars. */
export const PIANO_UP_MAX_SHARE = 0.2;
/** Figure rotation phrase unit: two bars guarantees two phrases in a 4-bar chorus. */
export const PIANO_MOTION_PHRASE_BARS = 2;

/* ------------------------------------------------------------------------
 * Harp vocabulary retained from Phase 11.5. These figures belong to the
 * harp only; the piano's independent motion figures are listed above.
 * ---------------------------------------------------------------------- */
export type HarpFigure =
  | 'arpUp' | 'arpDown' | 'pendulum' | 'brokenThirds' | 'wideRoll'
  | 'offBeatPairs' | 'pluckSparkle' | 'rolledChord' | 'lowRootFifth';
export const HARP_FIGURE_MENU: readonly HarpFigure[] = [
  'arpUp', 'arpDown', 'pendulum', 'brokenThirds', 'wideRoll',
  'offBeatPairs', 'pluckSparkle', 'rolledChord', 'lowRootFifth',
];
/** Harp figure rotation's stable offset. */
export const HARP_ROTATION_OFFSET = 4;
/** Harp's bed figure changes by two-bar unit. */
export const HARP_FIGURE_UNIT_BARS = 2;

/** §16.2 weighted harp glissando draws (rare — at most 2 per piece). */
export const GLISS_WEIGHTS = { chorus: 0.35, tutti: 0.5, outro: 0.4 } as const;
export const GLISS_MAX_PER_PIECE = 2;
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
