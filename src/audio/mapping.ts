/**
 * Pure preview-sound mapping (Phase 6). Everything here is plain data — no
 * AudioContext, no DOM — so the mapping unit-tests in node. The engine
 * (preview.ts) consumes it: one lookup per scheduled voice, one event list
 * per scheduled CC window.
 *
 * Phase 6 rules honoured here:
 *  - ccValueAt reproduces the export's step semantics exactly: the MIDI file
 *    writes every lane point as one controller event and a reader holds the
 *    last value until the next (the composer's S-curves are baked in as
 *    point ramps, there is no interpolation in the writer).
 *  - The tremolo merge IS the 5.5 export merge (mergeTremoloGroups) — the
 *    grouping logic is not duplicated.
 *  - The detune is a per-part constant (D9): preview only, never stored, and
 *    each voice's offset derives deterministically from hashString.
 *  - Nothing mutates the project; every function reads.
 */
import { hashString } from '../engine/generate';
import { mergeTremoloGroups } from '../export/profile';
import type { CcLane, CcPoint, Note, Track } from '../shared/schema/types';

export type PreviewMode = 'simple' | 'expressive';

/* ---------------- CC lanes ---------------- */

/**
 * The value a MIDI reader holds at `tick`: the LAST point at or before it —
 * the same semantics the exported file has (each point is one controller
 * event; between events the value holds). Before the first point the first
 * point's value holds (composer lanes start at tick 0). Missing/empty lane
 * → null.
 */
export function ccValueAt(lane: CcLane | undefined | null, tick: number): number | null {
  if (!lane || !Array.isArray(lane.points) || !lane.points.length) return null;
  let best: CcPoint | null = null;
  let first: CcPoint = lane.points[0];
  for (const p of lane.points) {
    if (p.tick <= tick && (best === null || p.tick >= best.tick)) best = p;
    if (p.tick < first.tick) first = p;
  }
  return best !== null ? best.value : first.value;
}

/** The track's lane for one controller number, or undefined. */
export const ccLaneOf = (track: Pick<Track, 'cc'>, cc: number): CcLane | undefined =>
  track.cc?.find((l) => l && l.cc === cc);

/** The CC1 level a note starts under (null when the track has no CC1 lane). */
export const cc1At = (track: Pick<Track, 'cc'>, tick: number): number | null =>
  ccValueAt(ccLaneOf(track, 1), tick);

/* ---------------- CC11 → the strip's expression gain ---------------- */

/** Perceptual curve + floor: CC11 0 stays audible-silent-ish at the floor,
 *  127 is unity. Composed arcs (30..96) map to roughly 0.38..0.79. */
export const EXPRESSION_FLOOR = 0.25;
export const EXPRESSION_CURVE = 1.3;
export const expressionGain = (cc11: number | null): number =>
  cc11 === null ? 1 : EXPRESSION_FLOOR + (1 - EXPRESSION_FLOOR) * Math.pow(Math.max(0, Math.min(127, cc11)) / 127, EXPRESSION_CURVE);

/**
 * The scheduled automation events of a track's CC11 lane: sorted, no-op
 * steps coalesced away (a point that doesn't change the held value fires no
 * event). The composer already thins collinear points and caps the lane at
 * MAX_CC_POINTS_PER_LANE; this keeps the AudioParam event count bounded too.
 */
export function expressionEvents(track: Pick<Track, 'cc'>): CcPoint[] {
  const lane = ccLaneOf(track, 11);
  if (!lane) return [];
  return coalesceCcPoints([...lane.points].sort((a, b) => a.tick - b.tick));
}

/** Drops points that don't change the held value; the first point survives. */
export function coalesceCcPoints(points: CcPoint[]): CcPoint[] {
  const out: CcPoint[] = [];
  for (const p of points) {
    if (out.length && out[out.length - 1].value === p.value) continue;
    out.push(p);
  }
  return out;
}

/* ---------------- CC1 → per-voice dynamics + brightness ---------------- */

/** Voice-gain curve (perceptual, not linear): CC1 38..84 → ~0.48..0.74. */
export const DYNAMIC_FLOOR = 0.3;
export const DYNAMIC_CURVE = 1.2;
export const dynamicGain = (cc1: number | null): number =>
  cc1 === null ? 1 : DYNAMIC_FLOOR + (1 - DYNAMIC_FLOOR) * Math.pow(Math.max(0, Math.min(127, cc1)) / 127, DYNAMIC_CURVE);

/** Per-voice lowpass multiplier tied to CC1 (brightness inside the voice). */
export const BRIGHT_FLOOR = 0.7;
export const BRIGHT_SPAN = 0.6;
export const brightnessGain = (cc1: number | null): number =>
  cc1 === null ? 1 : BRIGHT_FLOOR + BRIGHT_SPAN * (Math.max(0, Math.min(127, cc1)) / 127);

/* ---------------- articulation envelopes ---------------- */

export interface TremoloSettings { rateHz: number; depth: number }

export interface VoiceParams {
  /** true = the note carries no articulation: the engine keeps its family's
   *  legacy envelope and only folds in the CC1 dynamics. Old projects sound
   *  unchanged. */
  legacy: boolean;
  /** Seconds to the full level. */
  attack: number;
  /** 'sqrt' shapes the attack (and the fade) as an equal-power crossfade
   *  half — overlapping legato notes sum to ~unity. */
  attackShape: 'linear' | 'sqrt';
  /** Seconds from the note's end (or its cap) to silence. */
  release: number;
  /** Max audible body in seconds (spiccato/staccato); null = note length. */
  capSec: number | null;
  /** Exponential-decay time constant (pizz); null = hold the sustain. */
  decayTauSec: number | null;
  /** Initial gain multiplier above the sustain level (marcato's bump). */
  accent: number;
  /** Fraction of the peak the held note settles at (legacy: 0.85). */
  sustainLevel: number;
  /** Amplitude modulation over the held note (tremolo). */
  trem?: TremoloSettings;
  /** CC1 fold-ins: voice-gain multiplier and lowpass multiplier. */
  dynamic: number;
  bright: number;
}

/** The sustain-family row: slow-ish attack, full sustain, ~150 ms release. */
const SUSTAIN_FAMILY = { attack: 0.09, attackShape: 'linear' as const, release: 0.15, capSec: null, decayTauSec: null, accent: 1, sustainLevel: 1 };
/** Tremolo AM (spec: ~7–9 Hz, depth ~40%). */
export const TREMOLO_RATE_HZ = 8;
export const TREMOLO_DEPTH = 0.4;

/** One row per articulation (spec table, Phase 6 item 2). Notes WITHOUT an
 *  articulation never reach this table — they keep today's envelope. */
export const ARTICULATION_VOICES: Record<string, Omit<VoiceParams, 'legacy' | 'dynamic' | 'bright'>> = {
  sustain: SUSTAIN_FAMILY,
  detache: SUSTAIN_FAMILY,
  portato: SUSTAIN_FAMILY,
  sulTasto: SUSTAIN_FAMILY,
  sulPont: SUSTAIN_FAMILY,
  conSord: SUSTAIN_FAMILY,
  legato: { attack: 0.15, attackShape: 'sqrt', release: 0.18, capSec: null, decayTauSec: null, accent: 1, sustainLevel: 1 },
  marcato: { attack: 0.02, attackShape: 'linear', release: 0.15, capSec: null, decayTauSec: null, accent: 1.3, sustainLevel: 1 },
  staccato: { attack: 0.02, attackShape: 'linear', release: 0.06, capSec: 0.18, decayTauSec: null, accent: 1, sustainLevel: 1 },
  spiccato: { attack: 0.012, attackShape: 'linear', release: 0.06, capSec: 0.22, decayTauSec: null, accent: 1, sustainLevel: 1 },
  pizz: { attack: 0.004, attackShape: 'linear', release: 0.12, capSec: null, decayTauSec: 0.24, accent: 1, sustainLevel: 1 },
  tremolo: { attack: 0.09, attackShape: 'linear', release: 0.15, capSec: null, decayTauSec: null, accent: 1, sustainLevel: 1, trem: { rateHz: TREMOLO_RATE_HZ, depth: TREMOLO_DEPTH } },
};

/**
 * The voice's synthesis parameters. Articulated string notes get their
 * table row; every other note is `legacy` — the engine's existing envelope,
 * with only the CC1 dynamics folded in. Never null.
 */
export function voiceParams(note: Note, track: Pick<Track, 'family'>, ccAtStart: { cc1: number | null }): VoiceParams {
  const dynamic = dynamicGain(ccAtStart.cc1);
  const bright = brightnessGain(ccAtStart.cc1);
  const row = note.articulation && track.family === 'Strings' ? ARTICULATION_VOICES[note.articulation] : undefined;
  if (!row) return { legacy: true, attack: 0.09, attackShape: 'linear', release: 0.3, capSec: null, decayTauSec: null, accent: 1, sustainLevel: 0.85, dynamic, bright };
  return { ...row, legacy: false, dynamic, bright };
}

/* ---------------- ensemble detune (D9, preview only) ---------------- */

export type StringPart = 'violins1' | 'violins2' | 'violas' | 'cello' | 'bass';

/** Per-part ensemble spread: each voice's offset stays within ±spread cents. */
export const DETUNE_SPREAD_CENTS: Record<StringPart, number> = {
  violins1: 8, violins2: 8, violas: 6, cello: 6, bass: 4,
};

/** Which string part a note belongs to (the cellosBasses track splits by its
 *  note layer; the Phase 8.2 Double Basses desk is its own track); null for
 *  every non-string note. */
export function stringPartOf(track: Pick<Track, 'family' | 'role'>, note: Note): StringPart | null {
  if (track.family !== 'Strings') return null;
  if (track.role === 'cellosBasses') return note.layer === 'cb' ? 'bass' : 'cello';
  if (track.role === 'basses') return 'bass'; // the Phase 8.2 Double Basses desk: the existing bass detune
  if (track.role === 'violins1' || track.role === 'violins2' || track.role === 'violas') return track.role;
  return null;
}

const hash01 = (note: Note): number => (hashString(`${note.pitch}:${note.startTick}`) % 4096) / 4096;

/**
 * The voice's deterministic detune in cents: within ± the part's spread,
 * derived from hashString(pitch:startTick) — no Math.random, nothing stored.
 */
export function voiceDetune(note: Note, track: Pick<Track, 'family' | 'role'>): number {
  const part = stringPartOf(track, note);
  if (!part) return 0;
  return (hash01(note) * 2 - 1) * DETUNE_SPREAD_CENTS[part];
}

/* ---------------- the notes a voice plays ---------------- */

/**
 * The notes the preview schedules for a track. Simple mode: the track's
 * notes exactly as stored (today's behaviour). Expressive mode: the measured
 * tremolo repeats merge into one note per group — THE 5.5 EXPORT MERGE, not
 * a copy of it — and the AM tremolo (item 3) plays over the merged span.
 * The export merge drops `articulation` on merged groups (keyswitches carry
 * the sound there); the preview re-marks those notes 'tremolo' so the AM
 * envelope applies to them. Export output is untouched.
 */
export function planTrackNotes(track: Track, mode: PreviewMode): Note[] {
  if (mode !== 'expressive') return track.notes;
  return mergeTremoloGroups(track.notes).map((n) => (n.articulation ? n : { ...n, articulation: 'tremolo' as const }));
}
