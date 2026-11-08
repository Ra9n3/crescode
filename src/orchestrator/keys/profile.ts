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

/** §16.2a (Phase 11.6 rewrite) the piano's register windows (MIDI,
 *  sounding): the deliberate left hand sits in 40-55 (vocalbacking 40-56,
 *  below the vocal zone); the right hand starts at 64 or above
 *  (vocalbacking 82 or above — the sparkle band above the zone). The band
 *  56-63 stays empty on the non-vocalbacking templates (the hand split),
 *  and 57-81 stays empty on vocalbacking (the vocal zone). The high
 *  sparkle writes 84 and above within the hard range.  §16.2b (Phase 11.4)
 *  the sparkle band is capped: the BODY writes 82-91; the 92-96 top is
 *  rare — only the phrase-start chords of peak-level bars may write it
 *  (VB_SPARKLE_TOP). */
export const PIANO_LH = [40, 55] as const;
export const PIANO_RH = [64, 84] as const;
export const PIANO_SPARKLE_CAP = 96;
export const PIANO_SPARKLE_FLOOR = 84;
export const VB_SPARKLE = [82, 91] as const;
export const VB_SPARKLE_TOP = 96;
export const VB_LOW = [40, 56] as const;

/** §16.9 (Phase 11.6) the piano's polyphony cap — the engine enforces it
 *  over the realised candidates: at most 8 simultaneous notes, at most 2 of
 *  them below MIDI 55, at most 6 at or above 55. When a new note would
 *  exceed its band the EARLIEST still-sounding note in that band ends at
 *  the new onset (the cascade's own release rule — the ring stays inside
 *  the cap). */
export const PIANO_CONCURRENCY = { total: 8, below55: 2, at55: 6 } as const;
/** §16.9 (Phase 11.6) the share caps the draw and the renderer obey. */
export const PIANO_STAB_MAX = 0.10;
export const PIANO_REPEATED_MAX = 0.15;
export const PIANO_BLOCK_MAX = 0.25;
export const PIANO_ARPUP_MAX = 0.20;
export const PIANO_PEDAL_MAX = 0.10;
/** The hand-split gap: at least a sixth (8 semitones) between the LH top
 *  note and the RH bottom note of a strike. */
export const PIANO_HAND_GAP = 8;

/* ------------------------------------------------------------------------
 * §16.9 (Phase 11.6) the piano FROM SCRATCH: jobs, layers, figures. The
 * old comping menu, the six drive variants, the chorus figure rotation,
 * the piano arpeggiator kind and the octave pulse kind are DELETED (their
 * tests retire with them). Every piano event belongs to a hand:
 *   LH — a single root, an octave or an open fifth (root plus fifth, no
 *        third), lowest note 40-55 (vocalbacking 40-56); never a third or
 *        a fourth below 55; at most 2 notes below 55 sound at once.
 *   RH — chords and figures whose lowest note is 64+ (vocalbacking 82+);
 *        the minimum interval inside an RH chord is a third; at least a
 *        sixth between the LH top and the RH bottom; every chord of 3+
 *        notes spans at least an octave. Inversions exist only inside RH.
 * The bass note — the lowest sounding note of every strike — is the chord
 * root (or the fifth on a deliberate pedal point, at most 10% of strikes):
 * the LH only ever writes the root below its fifth or octave, so the rule
 * holds by construction. Layers, added bar by bar by the energy arc:
 *   L0 Body   — the LH, struck at the chord change and held to the end of
 *               the harmonic span (at most 1 bar, never past a tacet bar
 *               or a moment boundary);
 *   L1 Chord  — the RH chord held the same way: block held, rolled
 *               (staggered inside the first eighth, then held), pad with
 *               one slow stepwise inner voice;
 *   L2 Figure — the moving part (the catalog below);
 *   L3 Power  — octave doubling or broken octaves, at high energy only.
 * Above 0.72 ABSOLUTE energy the non-chorus piano thins to L0 plus an L3
 * hit on downbeats; at 0.90 ABSOLUTE and above it is tacet except the
 * tutti hit and the final bar (the chamber/sonata/vocalbacking clamps are
 * 0.65-0.70 — they never reach either band; cinematic and hybridstudio
 * do). The chorus relief keeps the full job from the LOW gate — the
 * chorus must not get thinner.
 * ---------------------------------------------------------------------- */

export type PianoJob = 'support' | 'motion' | 'rhythm' | 'color' | 'melody' | 'power';

/** The L2 figure catalog (one per section phrase, realised by the renderer). */
export type PianoFigure =
  | 'alberti'            // low-high-mid-high in the RH over the held LH root (chamber, sonata — heavy in sonata)
  | 'arpUp' | 'arpDown' | 'arpPendulum' // eighth broken chords, RH, over the held body
  | 'wideBroken'         // LH root, a gap, then high chord tones (the main motion in vocalbacking)
  | 'cascade'            // slow arpeggio, each note held to the span end (cap-trimmed)
  | 'ostinatoCell'       // a 3-4 note cell from the existing ostinato vocabulary over the held body
  | 'sparkleCell'        // the sparse sparkle cell (vocalbacking color, at most one section per take)
  | 'pump'               // the 3+3+2 syncopated pump, each strike held to the next
  | 'repeatedChords'     // RH chords on every beat, each held to the next
  | 'stab'               // short dry chord on beat 1 (cinematic, hybridstudio)
  | 'brokenOctaves'      // LH low-high octave alternation (the power job)
  | 'octavePulse'        // LH octave on the beat under the held RH chord (the power job)
  | 'flourish'           // diatonic upward run landing on a chorus downbeat (not vocalbacking)
  | 'highSparkle'        // single high notes at 84+, soft, low energy
  | 'highRoll'           // the high rolled chord (the color job's third outcome)
  | 'answer';            // the echo of the strings' lead in the answer windows (chamber, sonata)

/** The L1 chord variants (the support and melody jobs hold one per section). */
export type PianoL1 = 'blockHeld' | 'rolled' | 'pad';
export const PIANO_L1_MENU: readonly PianoL1[] = ['blockHeld', 'rolled', 'pad'];

/** The job menu per template — drawn per SECTION INSTANCE by a balanced
 *  rotation offset per take (the same rotation family the 11.4 menu used),
 *  so adjacent menu entries land on adjacent sections and the same job
 *  never repeats in two consecutive sections of one take. Chamber and
 *  sonata keep the melody job (the answers in the string rests) and a
 *  limited rhythm job (the pump); cinematic and hybridstudio draw the five
 *  non-melody jobs (their fillGating targets the percussion, so a melody
 *  job there would never leave the support layers); vocalbacking has no
 *  melody and no stabs. */
export const PIANO_JOB_MENUS: Record<string, readonly PianoJob[]> = {
  'ensemble.chamber': ['support', 'motion', 'melody', 'rhythm', 'power'],
  'ensemble.sonata': ['support', 'motion', 'melody', 'rhythm', 'power'],
  'ensemble.vocalbacking': ['support', 'motion', 'rhythm', 'color', 'power'],
  'ensemble.cinematic': ['support', 'motion', 'rhythm', 'color', 'power'],
  'ensemble.hybridstudio': ['support', 'motion', 'rhythm', 'color', 'power'],
};
export const PIANO_JOB_FALLBACK: readonly PianoJob[] = ['support', 'motion', 'rhythm', 'color', 'power'];

/** The figure menu per template and job (the phrase-level rotation walks
 *  the job's own menu; every figure realises over the 20-run survey by
 *  construction). Chamber leans on the arpeggios and the cascade; sonata
 *  leans on the Alberti (the heavy weight — two of six menu slots);
 *  cinematic leans on the arpeggio and the ostinato cell; hybridstudio on
 *  the cell and the stab; vocalbacking's motion is the high cascade, the
 *  pendulum and the wide-broken, its color the sparse sparkle (the
 *  flourish stays out — the zone). */
export const PIANO_MOTION_MENUS: Record<string, readonly PianoFigure[]> = {
  'ensemble.chamber': ['arpUp', 'arpDown', 'arpPendulum', 'cascade', 'wideBroken', 'alberti'],
  'ensemble.sonata': ['alberti', 'arpPendulum', 'alberti', 'cascade', 'wideBroken'],
  'ensemble.vocalbacking': ['cascade', 'arpPendulum', 'wideBroken'],
  'ensemble.cinematic': ['arpUp', 'arpDown', 'arpPendulum', 'cascade', 'wideBroken', 'ostinatoCell'],
  'ensemble.hybridstudio': ['arpUp', 'arpPendulum', 'cascade', 'wideBroken', 'ostinatoCell'],
};
export const PIANO_RHYTHM_MENUS: Record<string, readonly PianoFigure[]> = {
  'ensemble.chamber': ['pump'],
  'ensemble.sonata': ['pump'],
  'ensemble.vocalbacking': ['pump'],
  'ensemble.cinematic': ['ostinatoCell', 'stab', 'pump'],
  'ensemble.hybridstudio': ['ostinatoCell', 'stab', 'pump'],
};
export const PIANO_COLOR_MENUS: Record<string, readonly PianoFigure[]> = {
  'ensemble.chamber': ['highSparkle', 'flourish', 'highRoll'],
  'ensemble.sonata': ['highSparkle', 'flourish', 'highRoll'],
  'ensemble.vocalbacking': ['highSparkle', 'sparkleCell'],
  'ensemble.cinematic': ['highSparkle', 'flourish', 'highRoll'],
  'ensemble.hybridstudio': ['highSparkle', 'flourish', 'highRoll'],
};
export const PIANO_POWER_FIGURES: readonly PianoFigure[] = ['brokenOctaves', 'octavePulse'];
/** The arpeggio figures — excluded where the harp owns the section type's
 *  arpeggiator (the one-arpeggiator rule). */
export const PIANO_ARP_FIGURES: readonly PianoFigure[] = ['arpUp', 'arpDown', 'arpPendulum'];

/** §16.6 (Phase 11.5) the harp's per-section figure menu. The bed realises
 *  the drawn figure instead of the single broken-chord-eighths shape; the
 *  rotation is the piano's balanced rotation OFFSET by a constant, and the
 *  figure varies per two-bar unit inside a section by a salted hash step
 *  (a chorus of at least 4 bars therefore always uses at least 2 figures,
 *  and a chorus never repeats the verse's figure). The existing roles stay:
 *  the low roots, the rare glissandos, the high-energy thinning, the tacet
 *  at peak and the final-bar descent are kinds of their own, not menu
 *  outcomes. */
export type HarpFigure =
  | 'arpUp' | 'arpDown' | 'pendulum' | 'brokenThirds' | 'wideRoll'
  | 'offBeatPairs' | 'pluckSparkle' | 'rolledChord' | 'lowRootFifth';
export const HARP_FIGURE_MENU: readonly HarpFigure[] = [
  'arpUp', 'arpDown', 'pendulum', 'brokenThirds', 'wideRoll',
  'offBeatPairs', 'pluckSparkle', 'rolledChord', 'lowRootFifth',
];
/** The harp rotation's constant offset from the piano's (the piano indexes
 *  (take - 1 + ordinal); the harp's global unit stream adds this — different
 *  draws for the same ordinal, the same balanced coverage). */
export const HARP_ROTATION_OFFSET = 4;
/** The figure varies per two-bar unit inside a section (the chorus rule's
 *  "at least 2 figures in 4 bars"); the units walk the global rotation and
 *  the menu's PHASE shifts per take and per section type by a salted hash —
 *  the phrase-level hash variation. */
export const HARP_FIGURE_UNIT_BARS = 2;

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
