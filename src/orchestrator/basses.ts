/**
 * Phase 8.2 — the separate Double Basses desk (§3 of the spec). The combined
 * cellosBasses track becomes TWO desks: the cello line never sounds below
 * C2=36, and a basses track (role 'basses', Double Basses) carries the low
 * register — the existing Cb octave doubles (all their gating unchanged:
 * the template's octaveDoubling policy, never the leading tone, never below
 * E1=28), the planned cello-line notes under 36 at their own pitch, and the
 * wide-unison moment notes the conductor wrote at -24.
 *
 * WHERE THE SPLIT ENGAGES — the smallest design the pins allow: the cello's
 * octave-up answer (it plays a sub-36 planned note an octave up so the line
 * stays unbroken) is itself an octave doubling over the basses' own pitch,
 * so the whole split runs only where the template's octaveDoubling policy is
 * 'allowed' (symphony, cinematic, hybridstudio). Under 'climaxOnly' or
 * 'forbidden' (chamber, sonata, vocalbacking) the combined Vc+Cb writing
 * continues exactly as before — which is also what keeps those templates
 * byte-identical to HEAD.
 *
 * MECHANICS (compose order): the split pass runs AFTER the brass render and
 * the mix governor, BEFORE humanize — everything upstream (the generator,
 * the tutti hits, the brass doubling source, the first governor pass) sees
 * the exact pre-split note list. The pass marks the routed notes 'cb' (the
 * same export-facing mark the Cb layering has always used) inside the cello
 * list and adds the cello's octave-up answers as plain unmarked notes, so
 * humanize treats the cello+basses as one section: the routed notes trail
 * their cello partner (the octave-up, or the doubled line note) by 1–3 ms,
 * exactly like the Cb doubles always have. After the final governor pass the
 * marked notes materialize as the basses track; the mark is stripped (the
 * track IS the bass desk — the layer split is legacy-export machinery).
 * The template roster is NOT touched: growing it would change every governor
 * cap (the chamber pin forbids that), so the basses joins compositions as a
 * project track and the energy measure counts it under the cellosBasses role.
 */
import { isInstrumentTrack, type Note, type Project, type Track } from '../shared/schema/types';
import type { EnsembleTemplate } from '../shared/schema/ensembleTemplate';
import type { MomentPlan } from './conductor/moments';
import { sanitizeNotes } from '../engine/generate';
import { makeTrack } from '../shared/schema/factory';
import { humanizeHeadTicks } from './expression/timing';

export const BASSES_ROLE = 'basses';
/** Deterministic id: the pins read track data, and the desk must be stable. */
export const BASSES_TRACK_ID = 'trk_basses';
export const BASSES_NAME = 'Double Basses';
/** The low desk's hard range: E1..C5 — it sounds the Cb doubles (a cello
 *  C6 double lands on C5) and nothing higher. */
export const BASSES_RANGE: readonly [number, number] = [28, 72];
/** The cello line's new floor: C2 = 36 (spec §3). */
export const CELLO_LINE_FLOOR = 36;

export type OctavePolicy = 'allowed' | 'climaxOnly' | 'forbidden';

export const octavePolicyOf = (template: EnsembleTemplate | null): OctavePolicy | null =>
  template ? (((template.rules.find((r) => r.type === 'octaveDoubling')?.params as { policy?: string } | undefined)?.policy as OctavePolicy) ?? null) : null;

/** The split engages only where the cello's octave-up answer is allowed. */
export const splitEngaged = (template: EnsembleTemplate | null): boolean => octavePolicyOf(template) === 'allowed';

/** The wide-unison moment windows that route the cello's voice (-24) to the
 *  basses desk — every cello note starting inside one moves, whatever its
 *  (clamped) pitch. */
export const bassRoutedWindows = (moments: MomentPlan[] | undefined): { startTick: number; endTick: number }[] =>
  (moments ?? [])
    .filter((m) => m.kind === 'unison' && m.offsetByRole?.['cellosBasses'] === -24)
    .map((m) => ({ startTick: m.startTick, endTick: m.endTick }));

export interface SplitResult {
  /** Notes routed to the basses desk: the wide-unison -24 notes, the planned
   *  cello-line notes under 36 — all still inside the cello list, marked 'cb'
   *  for the humanize partner pass. */
  routed: number;
  /** How many of those were sub-36 line notes the cello answers an octave up. */
  octaveUpCount: number;
  /** Octave-up answers suppressed (the cello rests them): the raised pitch
   *  would double the leading tone an octave below, or sit closer than a 5th
   *  under MIDI 48 against a low voice that is already written (§13.4). */
  octaveUpSuppressed: number;
  /** Wide-unison notes moved (they answer no octave — the cello rests them). */
  momentRouted: number;
}

/** A low voice already written when the split runs (the brass candidates). */
export interface LowVoice { startTick: number; durationTicks: number; pitch: number }

/**
 * Marks the cello's bass-desk notes inside the (pre-humanize) cello list:
 * every note starting in a routed wide-unison window, and every unmarked
 * note under the cello floor — the latter also gains an octave-up answer on
 * the cello (a plain unmarked note at pitch+12, same window and velocity),
 * EXCEPT divisi second-line notes (their octave-up could cross the parent —
 * the div2 voice simply rests that note) and notes whose octave-up would
 * break the low-interval rule against the already-written low voices (below
 * MIDI 48 a simultaneous pair must be a unison/octave or a 5th or wider —
 * the same rule the low brass write under, ± the humanize head). The cello
 * rests a suppressed answer; the basses still plays the original pitch.
 * Pure: returns a NEW list; the handed-in map is not mutated.
 */
export function splitCelloLine(
  moments: MomentPlan[] | undefined,
  celloNotes: Note[],
  lowVoices: LowVoice[] = [],
  tempoMap: Project['tempoMap'] = [{ tick: 0, bpm: 120 }],
  ltPc: number | null = null,
): { notes: Note[]; result: SplitResult } {
  const windows = bassRoutedWindows(moments);
  const inRoutedWindow = (n: Note): boolean => windows.some((w) => n.startTick >= w.startTick && n.startTick < w.endTick);
  // the low-interval rule (§13.4): below MIDI 48, a simultaneous pair is a
  // unison/octave or a 5th or wider; the humanize head covers the shift the
  // notes take after this pass
  const muddies = (up: number, n: Note): boolean => {
    if (up >= 48 || !lowVoices.length) return false;
    const head = humanizeHeadTicks(tempoMap, n.startTick);
    return lowVoices.some((l) => l.pitch < 48
      && l.startTick - head < n.startTick + n.durationTicks && l.startTick + l.durationTicks + head > n.startTick
      && (() => { const d = Math.abs(l.pitch - up); return d !== 0 && d % 12 !== 0 && d < 7; })());
  };
  const out: Note[] = [];
  const octaveUps: Note[] = [];
  let routedCount = 0;
  let octaveUpCount = 0;
  let octaveUpSuppressed = 0;
  let momentRouted = 0;
  for (const n of celloNotes) {
    if (n.layer === 'cb') { out.push(n); continue; } // the Cb doubles: already desk-marked
    if (inRoutedWindow(n)) {
      out.push({ ...n, layer: 'cb' });
      routedCount++;
      momentRouted++;
      continue;
    }
    if (n.pitch < CELLO_LINE_FLOOR) {
      out.push({ ...n, layer: 'cb' });
      routedCount++;
      if (n.layer !== 'div2') {
        // the cello answers an octave up so the line stays unbroken — unless
        // the answer would double the LEADING TONE an octave below (the hard
        // rule wins over the answer, exactly like the Cb layering) or muddy
        // the low register against a written low voice (the cello rests it;
        // the basses still plays the pitch)
        if ((ltPc !== null && ((n.pitch % 12) + 12) % 12 === ltPc) || muddies(n.pitch + 12, n)) octaveUpSuppressed++;
        else {
          octaveUps.push({ pitch: n.pitch + 12, startTick: n.startTick, durationTicks: n.durationTicks, velocity: n.velocity, ...(n.articulation !== undefined ? { articulation: n.articulation } : {}) });
          octaveUpCount++;
        }
      }
      continue;
    }
    out.push(n);
  }
  const notes = [...out, ...octaveUps].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return { notes, result: { routed: routedCount, octaveUpCount, octaveUpSuppressed, momentRouted } };
}

export interface MaterializedBasses {
  /** The cello desk's final notes: unmarked only (the floor holds). */
  celloNotes: Note[];
  /** The basses desk's final notes: the routed + doubled notes, mark stripped. */
  bassesNotes: Note[];
}

/**
 * Partitions the (post-humanize, post-legato) cello list into the two desks.
 * The 'cb' marks leave the project data here — the basses track IS the bass
 * desk, the layer split is legacy-export machinery only. The basses list is
 * sanitized into the desk's hard range (expected a no-op: every routed note
 * is ≥ 28 and ≤ 72 by construction).
 */
export function materializeBasses(celloNotes: Note[], endTick: number): MaterializedBasses {
  const cello: Note[] = [];
  const basses: Note[] = [];
  for (const n of celloNotes) {
    if (n.layer === 'cb') {
      const { layer, ...rest } = n;
      void layer;
      basses.push(rest as Note);
    } else {
      cello.push(n);
    }
  }
  return {
    celloNotes: cello,
    bassesNotes: sanitizeNotes(basses, BASSES_RANGE[0], BASSES_RANGE[1], endTick),
  };
}

/** The Double Basses track for a composed project (the app's add-track
 *  channel rule; deterministic data, no random ids). */
export function bassesTrackFor(project: Project, notes: Note[]): Track {
  const used = project.tracks.filter((t) => isInstrumentTrack(t)).length;
  return makeTrack({
    id: BASSES_TRACK_ID,
    name: BASSES_NAME,
    family: 'Strings',
    role: BASSES_ROLE,
    lowestNote: BASSES_RANGE[0],
    highestNote: BASSES_RANGE[1],
    midiChannel: (used % 16) + 1,
    notes,
  });
}

/** Inserts the basses track in score order: right after the cellosBasses
 *  desk (or last, when the project has none). Pure. */
export function insertBassesTrack(tracks: Track[], basses: Track): Track[] {
  const idx = tracks.map((t) => t.role).lastIndexOf('cellosBasses');
  if (idx < 0) return [...tracks, basses];
  return [...tracks.slice(0, idx + 1), basses, ...tracks.slice(idx + 1)];
}
