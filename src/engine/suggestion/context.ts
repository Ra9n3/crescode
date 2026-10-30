/**
 * DAW state reader (feature spec §4).
 *
 * Given a time position on the chord track, queries the ChordTrackAPI and
 * returns the chord clips surrounding it — previous, next and the clip
 * sounding AT the position — each with its parsed chord, raw MIDI notes,
 * and (when the clip is MIDI-backed) a fresh analysis from the §1 parser
 * including confidence and alternative interpretations.
 *
 * Reading only: this module never calls a mutating API method and never
 * mutates the clips it receives.
 *
 * Semantics at time T (half-open clip spans [start, start + length)):
 *  - current  — a clip with start ≤ T < end ("sounding at T"; a clip that
 *    starts exactly at T is current). Overlapping spanning clips resolve to
 *    the latest start, then the lowest id.
 *  - previous — the clip with the greatest end ≤ T (a clip ending exactly
 *    at T is previous). Ties: latest start, then lowest id.
 *  - next     — the first clip with start ≥ T, excluding the current clip
 *    (so the clip starting exactly at T is not reported as its own next).
 *    Ties: earliest start, then shortest, then lowest id.
 *  - every slot is null when nothing qualifies (empty regions, track edges).
 */
import type { Chord, ChordClip, GridResolution, ProjectKey } from './types';
import { SuggestionError } from './types';
import type { ChordAnalysis } from './parse';
import { parseChordFromClip } from './parse';
import type { ChordTrackAPI } from './adapter';

export interface ChordContextEntry {
  clip: ChordClip;
  /** Fresh parse of clip.rawMidiNotes — null for user-typed lane symbols
   *  without MIDI backing (their chord carries contract confidence 1). */
  analysis: ChordAnalysis | null;
}

export interface ChordContextRead {
  time: number;
  previousChordClip: ChordContextEntry | null;
  nextChordClip: ChordContextEntry | null;
  currentChordClip: ChordContextEntry | null;
}

const clipEnd = (c: ChordClip): number => c.startTime + c.lengthTicks;

/** Comparator over numeric keys, ascending; the lowest id breaks full ties. */
function byKeys(keys: Array<(c: ChordClip) => number>) {
  return (a: ChordClip, b: ChordClip): number => {
    for (const key of keys) {
      if (key(a) !== key(b)) return key(a) - key(b);
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export function readChordContextAt(api: ChordTrackAPI, time: number): ChordContextRead {
  if (!Number.isInteger(time) || time < 0) {
    throw new SuggestionError('invalid-range', `time must be an integer ≥ 0 (got ${time})`);
  }

  // Clips intersecting [0, T] and [T, ∞). The reader does its own boundary
  // logic so overlapping/degenerate adapter state is handled deterministically.
  const left = api.getChordClipsInRange(0, time + 1);
  const right = api.getChordClipsInRange(time, Number.MAX_SAFE_INTEGER);
  const seen = new Set<string>();
  const all: ChordClip[] = [];
  for (const c of [...left, ...right]) {
    if (!seen.has(c.id)) { seen.add(c.id); all.push(c); }
  }

  const currentClip = all
    .filter((c) => c.startTime <= time && time < clipEnd(c))
    .sort(byKeys([(c) => c.startTime]))
    .at(-1) ?? null;
  const previousClip = all
    .filter((c) => clipEnd(c) <= time)
    .sort(byKeys([clipEnd, (c) => c.startTime]))
    .at(-1) ?? null;
  const nextClip = all
    .filter((c) => c.startTime >= time && c.id !== currentClip?.id)
    .sort(byKeys([(c) => c.startTime, (c) => c.lengthTicks]))[0] ?? null;

  const key: ProjectKey = api.getProjectKeySignature();
  const grid: GridResolution = api.getGridResolution();

  const entryOf = (clip: ChordClip | null, prevChord: Chord | null, nextChord: Chord | null): ChordContextEntry | null => {
    if (clip === null) return null;
    const notes = clip.rawMidiNotes ?? [];
    const analysis = notes.length > 0
      ? parseChordFromClip(
          { startTime: clip.startTime, lengthTicks: clip.lengthTicks, notes },
          { grid, projectKey: key, previousChord: prevChord, nextChord },
        )
      : null;
    return { clip, analysis };
  };

  return {
    time,
    previousChordClip: entryOf(previousClip, null, currentClip?.chord ?? nextClip?.chord ?? null),
    nextChordClip: entryOf(nextClip, currentClip?.chord ?? previousClip?.chord ?? null, null),
    currentChordClip: entryOf(currentClip, previousClip?.chord ?? null, nextClip?.chord ?? null),
  };
}
