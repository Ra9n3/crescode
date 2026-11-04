/**
 * Cinematic ostinato (Phase 4e), calmed down (Phase 4.6), styled (Phase 4.8).
 * The ostinato no longer runs a uniform grid: per take and section type the
 * conductor draws a STYLE — a rhythm CELL (meter-aware onsets over the felt
 * beats), a CONTOUR (the register walk), an ACCENT shape (velocity), and —
 * for the two-track texture — a DENSITY curve and a PAIRING (interlock vs
 * hocket). The onsets always land on felt-beat subdivisions: simple meters
 * divide a beat into 2 (8ths) or 4 (16ths) slots, compound meters into 3,
 * so 4/4, 3/4 and 6/8 all stay on the felt pulse. Pattern shapes (repeated
 * note, chord-tone arpeggio, root-fifth) still pick the chord tone per
 * onset; the contour only re-walks the register.
 *
 * The ostinato does not run through every bar of a section — the renderer
 * gates it per bar (enters 1–2 bars in, drops out for the section's dip
 * bar) and this generator rests on the last beat of every 4th bar's window
 * when told to (the renderer clips the window). Interlocking textures run
 * the two tracks half a slot apart, so the rhythms never coincide; hocketed
 * textures alternate the two tracks across bars.
 *
 * Note lengths: the trailer clips its notes under 0.25 s through the TEMPO
 * MAP (never a flat bpm); every other texture plays a short but not clipped
 * length (a detached share of the cell's slot), never reaching the next
 * onset. Accents rise to the window's governor cap, never past it.
 * Deterministic per (inputs, take, span).
 */
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from '../spine';
import { barTicks, beatOffsets, beatTicks, isCompound } from '../../shared/schema/meter';
import { secondsToTicks } from '../spine';
import type { ChordTone } from '../voicing/chordTones';
import type { Note, Project, TempoEntry, TimeSignature } from '../../shared/schema/types';
import type { OstinatoAccentId, OstinatoCellId, OstinatoContourId, OstinatoRate, OstinatoShape } from '../conductor/layers';

export const MIN_STEP_TICKS = 120;
/** Measured-tremolo repeat rate (a 16th at 4/4), Phase 4e. */
export const TREMOLO_STEP_TICKS = 240;
/** Spiccato-length cap for short notes (the trailer ostinato, pizz pulses). */
export const SHORT_NOTE_SECONDS = 0.25;
/** Non-trailer ostinato: detached share of the cell's slot (short, not clipped). */
export const DETACHED_SHARE = 0.75;
/** Pizz pulse: even more clipped share of the slot (it is a pluck). */
export const PIZZ_SHARE = 0.5;
/** Velocity boost of an accented onset (Phase 4.8) — rises to the window's
 *  governor cap, never past it. */
export const ACCENT_VELOCITY = 12;

/** The 16th-rate subdivision of one felt beat, in ticks (the trailer rate). */
export function subdivisionTicks(ts: TimeSignature): number {
  return Math.max(MIN_STEP_TICKS, Math.floor(beatTicks(ts) / (isCompound(ts) ? 3 : 4)));
}

/** The rate grid for a texture's rate: 8ths by default, 16ths for the trailer. */
export function rateTicks(ts: TimeSignature, rate: 'eighths' | 'sixteenths'): number {
  if (rate === 'sixteenths') return subdivisionTicks(ts);
  return Math.max(MIN_STEP_TICKS, Math.floor(beatTicks(ts) / (isCompound(ts) ? 3 : 2)));
}

/**
 * The rhythm cell's slot grid for one bar (Phase 4.8). Slots are felt-beat
 * subdivisions: `perBeat` slots per beat (2/4 simple, 3 compound), slot i of
 * a bar sounds iff it is in `slots`. Meter-aware by construction — every
 * cell is defined in felt-beat slots, never notated pulses:
 *   straight    — every slot (the 8th grid; the trailer's 16th rate widens
 *                 it to 4 slots per simple beat, 3 per compound beat);
 *   syncopated  — every 3rd 8th-slot of the bar (3+3+2 in 4/4, 3+3 in 3/4,
 *                 the dotted-beat downbeats in 6/8);
 *   gallop      — per beat: slots 0,2,3 of 4 (8th + two 16ths); compound
 *                 ternary lilt 0,2 of 3 (8th–rest–8th);
 *   offBeat     — slot 1 of every beat (the "and"; compound: middle 8th);
 *   sparse      — per 2-beat group: slot 0 and the group's last slot, rest
 *                 between; a lone last beat in odd meters: downbeat only.
 */
export interface CellGrid {
  /** Slots per felt beat. */
  perBeat: number;
  /** Sounding slot indices within one bar (0..perBeat·beats−1). */
  slots: number[];
}

export function cellGrid(ts: TimeSignature, cell: OstinatoCellId, rate: OstinatoRate): CellGrid {
  const beats = beatOffsets(ts).length;
  const compound = isCompound(ts);
  const base = compound ? 3 : 2; // the 8th grid: slots per felt beat
  const fine = compound ? 3 : 4; // the 16th grid (in compound that IS the 8th grid)
  const perBeat = cell === 'gallop' || (cell === 'straight' && rate === 'sixteenths') ? fine : base;
  const total = beats * perBeat;
  const groupLen = 2 * perBeat; // one beat group = two felt beats
  const slots: number[] = [];
  for (let i = 0; i < total; i++) {
    const inBeat = i % perBeat;
    const beat = Math.floor(i / perBeat);
    let sound: boolean;
    switch (cell) {
      case 'straight':
        sound = true;
        break;
      case 'offBeat':
        sound = inBeat === 1;
        break;
      case 'syncopated': // 3+3+2 over the bar's 8th slots
        sound = perBeat === 2 ? i % 3 === 0 : inBeat === 0;
        break;
      case 'gallop':
        sound = inBeat === 0 || inBeat === 2 || (!compound && inBeat === 3);
        break;
      case 'sparse': {
        const inGroup = i % groupLen;
        const loneLastBeat = beats % 2 === 1 && beat === beats - 1;
        sound = loneLastBeat ? inBeat === 0 : inGroup === 0 || inGroup === groupLen - 1;
        break;
      }
    }
    if (sound) slots.push(i);
  }
  return { perBeat, slots };
}

/** The tick of slot `slotIdx` of one bar (bar-anchored: the felt-beat lattice). */
function slotTick(barStart: number, slotIdx: number, ts: TimeSignature, perBeat: number): number {
  const beat = beatTicks(ts);
  return barStart + Math.floor(slotIdx / perBeat) * beat + (slotIdx % perBeat) * Math.floor(beat / perBeat);
}

export interface OstinatoTrack {
  comfortable: [number, number];
  low: number;
  high: number;
}

export interface OstinatoInput {
  ts: TimeSignature;
  tempoMap: TempoEntry[];
  /** The window to fill (a chord span ∩ bar ∩ section piece, breaths cut). */
  startTick: number;
  endTick: number;
  /** The chord's tone pcs in keep-priority order. */
  tones: ChordTone[];
  /** The composed project (the D8 seed inputs + take ride on it). */
  project: Project;
  /** Drawn per span: deterministic per (inputs, take, span). */
  spanIndex: number;
  tracks: OstinatoTrack[];
  velocity: number;
  /** The window's governor cap: accented velocities rise to it, never past. */
  velocityCap: number;
  /** The texture's rate grid base: 8ths by default, 16ths only for the
   *  trailer (whose straight cell then runs the full 16th grid). */
  rate: OstinatoRate;
  /** The drawn rhythm cell (Phase 4.8). */
  cell: OstinatoCellId;
  /** The drawn contour (Phase 4.8): the register walk across the onsets. */
  contour: OstinatoContourId;
  /** The drawn accent shape (Phase 4.8). */
  accent: OstinatoAccentId;
  /** The take-seeded pattern shape (the chord-tone sequence). */
  shape: OstinatoShape;
  /** Interlocking: the lower track runs half a slot late, never the same rhythm. */
  interlock: boolean;
  /** Trailer only: clip notes under 0.25 s; otherwise short but not clipped. */
  clipShort: boolean;
  articulation: 'spiccato' | 'pizz';
  /** The pitch the ostinato must stay under (the lead's lowest pitch in the
   *  window), or null when no tune sounds there. 4.6: the ostinato pulses
   *  UNDER the tune — the lead stays the top line. */
  ceilingPitch: number | null;
}

/** The pitch of a pc nearest the middle of a comfortable window, never above
 *  an optional ceiling (the ostinato stays under the lead, 4.6). */
const nearestPitch = (pc: number, low: number, high: number, mid: number, ceiling: number | null): number => {
  const top = ceiling === null ? high : Math.min(high, ceiling - 1);
  let best = NaN;
  for (let p = low; p <= top; p++) {
    if (((p % 12) + 12) % 12 !== pc) continue;
    if (Number.isNaN(best) || Math.abs(p - mid) < Math.abs(best - mid)) best = p;
  }
  return best;
};

const pcOf = (p: number): number => ((p % 12) + 12) % 12;

/** The lowest / highest pitch of a pc inside the window (NaN when none). */
const lowestWithPc = (pc: number, low: number, top: number): number => {
  for (let p = low; p <= top; p++) if (pcOf(p) === pc) return p;
  return NaN;
};
const highestWithPc = (pc: number, low: number, top: number): number => {
  for (let p = top; p >= low; p--) if (pcOf(p) === pc) return p;
  return NaN;
};
const nextWithPcAbove = (pc: number, from: number, low: number, top: number): number => {
  for (let p = Math.max(low, from + 1); p <= top; p++) if (pcOf(p) === pc) return p;
  return NaN;
};
const nextWithPcBelow = (pc: number, from: number, low: number, top: number): number => {
  for (let p = Math.min(top, from - 1); p >= low; p--) if (pcOf(p) === pc) return p;
  return NaN;
};

export function ostinatoNotes(input: OstinatoInput): Note[][] {
  const { tempoMap, startTick, endTick, tones, project, spanIndex, tracks, velocity, velocityCap, rate, cell, contour, accent, shape, interlock, clipShort, articulation, ceilingPitch } = input;
  const ts = input.ts;
  if (!tones.length || endTick <= startTick) return tracks.map(() => []);
  const grid = cellGrid(ts, cell, rate);
  const beat = beatTicks(ts);
  const slot = Math.max(MIN_STEP_TICKS, Math.floor(beat / grid.perBeat));
  const barT = barTicks(ts);
  // note length: the detached share of the cell's slot (clipped short for
  // the trailer), never reaching the next onset
  const dur = clipShort
    ? Math.max(1, Math.min(Math.floor(slot / 2), secondsToTicks(SHORT_NOTE_SECONDS, tempoMap) - 1))
    : Math.max(1, Math.floor(slot * (articulation === 'pizz' ? PIZZ_SHARE : DETACHED_SHARE)));
  const seed = (orchestrationSeedFor(project, { take: project.orchestration?.take ?? 0 }) ^
    Math.imul(hashString('ostinato'), 0x85ebca6b) ^ Math.imul(spanIndex + 1, 0x9e3779b1)) >>> 0;
  const rng = mulberry32(seed);
  const pcs = tones.map((t) => ((t.pc % 12) + 12) % 12);
  const startIdx = Math.floor(rng() * pcs.length);
  // root-fifth alternates the bass pc and the perfect fifth above it — but
  // only when that fifth is itself in the handed-in tone set (the caller
  // pre-filters the leading tone; an E→B "fifth" in C Ionian must not
  // resurrect it): otherwise the alternation falls back to the next tone
  const fifthPc = (pcs[0] + 7) % 12;
  const altPc = pcs.includes(fifthPc) ? fifthPc : pcs[Math.min(1, pcs.length - 1)];

  // the pattern shape: which pc sounds on onset i
  const pcAt = (i: number): number => {
    if (shape === 'repeat') return pcs[startIdx % pcs.length];
    if (shape === 'rootFifth') return i % 2 === 0 ? pcs[0] : altPc;
    return pcs[(startIdx + i) % pcs.length]; // chord-tone arpeggio
  };

  // the bar range the window touches (windows sit inside one bar, but stay
  // correct across any window)
  const firstBar = Math.floor(startTick / barT);
  const lastBar = Math.floor((endTick - 1) / barT);
  const interlockHalf = interlock ? Math.floor(slot / 2) : 0;

  // per track: onsets (slot index → tick), then the contour walk fills pitches
  interface Onset { i: number; t: number; }
  const onsetLists: Onset[][] = tracks.map((_, ti) => {
    const offset = interlock && ti > 0 ? interlockHalf : 0;
    const out: Onset[] = [];
    let i = 0;
    for (let b = firstBar; b <= lastBar; b++) {
      const barStart = b * barT;
      for (const s of grid.slots) {
        const t = slotTick(barStart, s, ts, grid.perBeat) + offset;
        if (t < startTick || t >= endTick) continue;
        out.push({ i, t });
        i++;
      }
    }
    return out;
  });

  // the contour walk (Phase 4.8): per track, per onset, the register —
  // always inside the comfortable window and under the lead's ceiling
  const pitchAt: Map<number, number>[] = tracks.map((track, ti) => {
    const mid = (track.comfortable[0] + track.comfortable[1]) / 2;
    const top = ceilingPitch === null ? track.high : Math.min(track.high, ceilingPitch - 1);
    const map = new Map<number, number>();
    let prev: number | null = null; // the walk's last pitch
    let pedal = NaN; // the pedal contour's fixed low note (resolved lazily)
    for (const { i } of onsetLists[ti]) {
      const pc = pcAt(i);
      let pitch = NaN;
      if (contour === 'pedal') {
        if (Number.isNaN(pedal)) pedal = lowestWithPc(pcs[0], track.low, top);
        if (i % 2 === 0 && !Number.isNaN(pedal)) {
          pitch = pedal; // the pedal note on the even onsets
        } else {
          pitch = Number.isNaN(pedal) ? NaN : nextWithPcAbove(pc, pedal, track.low, top);
          if (Number.isNaN(pitch)) pitch = nearestPitch(pc, track.low, track.high, mid, ceilingPitch);
        }
      } else if (contour === 'ascending') {
        pitch = prev === null ? lowestWithPc(pc, track.low, top) : nextWithPcAbove(pc, prev, track.low, top);
        if (Number.isNaN(pitch) && prev !== null) pitch = lowestWithPc(pc, track.low, top); // wrap to the bottom
      } else if (contour === 'descending') {
        pitch = prev === null ? highestWithPc(pc, track.low, top) : nextWithPcBelow(pc, prev, track.low, top);
        if (Number.isNaN(pitch) && prev !== null) pitch = highestWithPc(pc, track.low, top); // wrap to the top
      } else { // pingPong: strict zigzag, falling back over the window edge
        const dir: 1 | -1 = i % 2 === 0 ? 1 : -1;
        pitch = prev === null
          ? (dir === 1 ? lowestWithPc(pc, track.low, top) : highestWithPc(pc, track.low, top))
          : dir === 1 ? nextWithPcAbove(pc, prev, track.low, top) : nextWithPcBelow(pc, prev, track.low, top);
        if (Number.isNaN(pitch) && prev !== null) {
          pitch = dir === 1 ? nextWithPcBelow(pc, prev, track.low, top) : nextWithPcAbove(pc, prev, track.low, top);
        }
      }
      if (Number.isNaN(pitch)) pitch = nearestPitch(pc, track.low, track.high, mid, ceilingPitch);
      if (!Number.isNaN(pitch)) {
        map.set(i, pitch);
        prev = pitch;
      }
    }
    return map;
  });

  // keep every lower voice strictly under the upper voice at the same onset
  // index (same grid: the same onsets; interlocked: the same slot — the
  // upper voice sounding across the offset is the one it must sit under)
  for (let ti = 1; ti < pitchAt.length; ti++) {
    const upper = pitchAt[ti - 1];
    for (const [i, pitch] of pitchAt[ti]) {
      const up = upper.get(i);
      if (up === undefined) continue; // the upper voice rests on this onset
      let p = pitch;
      while (p >= up && p - 12 >= tracks[ti].low) p -= 12;
      if (p >= up) pitchAt[ti].delete(i);
      else pitchAt[ti].set(i, p);
    }
  }

  // to notes (onset index → tick; the maps keep them deterministic), with
  // the drawn accent shape (Phase 4.8) riding the governor cap
  return pitchAt.map((map, ti) => {
    const offset = interlock && ti > 0 ? interlockHalf : 0;
    const onsets = onsetLists[ti].filter(({ i }) => map.has(i));
    const notes: Note[] = [];
    for (let k = 0; k < onsets.length; k++) {
      const { i, t } = onsets[k];
      const pitch = map.get(i)!;
      // accent placement: 'downbeat' = the bar's first onset of this track;
      // 'offBeat' = slot 1 of its felt beat (the "and"; compound: middle 8th)
      let accented = false;
      if (accent === 'downbeat') {
        const prev = k > 0 ? onsets[k - 1].t - offset : NaN;
        accented = Number.isNaN(prev) || Math.floor(prev / barT) !== Math.floor((t - offset) / barT);
      } else if (accent === 'offBeat') {
        const inBar = t - offset - Math.floor((t - offset) / barT) * barT;
        accented = Math.round((inBar % beat) / slot) === 1;
      }
      const v = accented ? Math.min(velocityCap, velocity + ACCENT_VELOCITY) : velocity;
      const nextT = k + 1 < onsets.length ? onsets[k + 1].t : endTick;
      const len = Math.max(1, Math.min(dur, nextT - t));
      notes.push({ pitch, startTick: t, durationTicks: Math.min(len, endTick - t), velocity: Math.max(1, v), articulation });
    }
    return notes;
  });
}
