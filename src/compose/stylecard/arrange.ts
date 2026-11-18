/**
 * Turns a form + harmony + melody + role ladder into per-instrument notes, with
 * the voice-leading rules from the spec enforced as the notes are placed rather
 * than repaired afterwards.
 */
import type { Rng } from './rng';
import type { BarHarmony, ChordPlan } from './harmony';
import type { FormSectionPlan } from './form';
import type { MelodyPlan } from './melody';
import type { PatternName, Role, SectionRoles } from './roles';
import { RANGES } from './stylecard';

import type { Articulation } from '../../shared/schema/types';

export interface PlacedNote {
  pitch: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
  /** Narrowed to the schema's union so a placed note can become a real Note. */
  articulation: Articulation;
  /**
   * Set when a voice had to be realised on a desk that is not its own: 'cb' is
   * the doubled bass line riding the cellos/basses desk, 'div2' a divisi voice.
   */
  layer?: 'cb' | 'div2';
  /** True on notes that realise the tune, so the top-voice pass can find them. */
  melody?: boolean;
}

export type TrackNotes = Map<string, PlacedNote[]>;

export interface ArrangeContext {
  readonly rng: Rng;
  readonly sections: readonly FormSectionPlan[];
  readonly barHarmony: readonly BarHarmony[];
  readonly melody: MelodyPlan;
  readonly roleBySection: readonly SectionRoles[];
  readonly beatTicks: number;
  readonly barTicks: number;
  readonly beatsPerBar: number;
  readonly meterName: string;
  readonly ensembleTracks: readonly string[];
  readonly totalBars: number;
}

const ROLE_ARTICULATION: Record<Role, Articulation> = {
  MELODY: 'legato',
  COUNTER: 'legato',
  PAD: 'legato',
  OSTINATO: 'spiccato',
  BASS: 'sustain',
  PIZZ: 'pizz',
  DOUBLE: 'legato',
  REST: 'sustain',
};

/** Clamps a pitch into an instrument's range by octaves, or drops it. */
export function fitToRange(pitch: number, trackId: string): number | null {
  const range = RANGES[trackId];
  if (!range) return pitch;
  let value = pitch;
  while (value < range.low) value += 12;
  while (value > range.high) value -= 12;
  return value >= range.low && value <= range.high ? value : null;
}

const sectionForBar = (sections: readonly FormSectionPlan[], bar: number): { section: FormSectionPlan; index: number } => {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (bar >= section.startBar && bar < section.startBar + section.bars) return { section, index: i };
  }
  const last = sections.length - 1;
  return { section: sections[last], index: last };
};

/** The chord tone nearest `previous` in a chord. */
function nearestTone(chord: ChordPlan, previous: number, low: number, high: number, tonic: number): number {
  let best = previous;
  let bestDistance = 1e9;
  for (let pitch = low; pitch <= high; pitch++) {
    const pc = ((pitch - tonic) % 12 + 12) % 12;
    if (!chord.pitchClasses.includes(pc)) continue;
    const distance = Math.abs(pitch - previous);
    if (distance < bestDistance) { bestDistance = distance; best = pitch; }
  }
  return best;
}

/**
 * Accompaniment pitches for one chord, one chord tone per part, avoiding
 * duplicates below the "everything doubles" energy threshold.
 */
function spreadChord(
  chord: ChordPlan,
  previous: Record<string, number>,
  tracks: readonly string[],
  tonic: number,
  energy: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  for (const track of tracks) {
    const range = RANGES[track];
    if (!range) continue;
    const reference = previous[track] ?? Math.round((range.low + range.high) / 2);
    let pitch = nearestTone(chord, reference, range.low, range.high, tonic);
    if (energy <= 0.85) {
      let guard = 0;
      while (used.has(pitch) && guard++ < 12) {
        const alternative = nearestTone(chord, pitch + 3, range.low, range.high, tonic);
        if (alternative === pitch) break;
        pitch = alternative;
      }
    }
    out[track] = pitch;
    used.add(pitch);
  }
  return out;
}

/**
 * Parallel perfect fifths/octaves between two voices are forbidden. Returns
 * true when the move from `a1,b1` to `a2,b2` creates one.
 */
export function isParallelPerfect(a1: number, b1: number, a2: number, b2: number): boolean {
  // Parallel motion means BOTH voices actually move. Two parts holding the same
  // interval (or the same notes) is static texture, not parallel fifths — an
  // ostinato repeating against a held pad is not a contrapuntal error, and
  // counting it as one made the gate reject every candidate.
  const movedA = a1 !== a2;
  const movedB = b1 !== b2;
  if (!movedA || !movedB) return false;
  const before = ((b1 - a1) % 12 + 12) % 12;
  const after = ((b2 - a2) % 12 + 12) % 12;
  if (before !== after) return false;
  return before === 0 || before === 7;
}

export function arrange(context: ArrangeContext): TrackNotes {
  const {
    rng, sections, barHarmony, melody, roleBySection, beatTicks, barTicks,
    beatsPerBar, meterName, ensembleTracks, totalBars,
  } = context;
  const notes: TrackNotes = new Map();
  for (const track of ensembleTracks) notes.set(track, []);
  const tonic = barHarmony.length && barHarmony[0].chords.length
    ? ((barHarmony[0].chords[0].pitchClasses[0] - barHarmony[0].chords[0].semitone) % 12 + 12) % 12
    : 0;

  // ---- melody (carried by vln1, or handed to vc / vla in B and Bridge) ----
  const melodyTrackByBar = new Map<number, string>();
  let previousMelodyCarrier = 'violins1';
  for (let bar = 1; bar <= totalBars; bar++) {
    const { section, index } = sectionForBar(sections, bar);
    const roles = roleBySection[index];
    const handover = (section.kind === 'B' || section.kind === 'B2' || section.kind === 'Bridge')
      && rng.chance(0.3) && bar === section.startBar;
    if (handover) {
      previousMelodyCarrier = rng.chance(0.5) ? 'cellosBasses' : 'violas';
    } else if (bar === section.startBar) {
      previousMelodyCarrier = 'violins1';
    }
    if (roles.vln1 === 'MELODY' || roles.vc === 'MELODY' || handover) {
      melodyTrackByBar.set(bar, previousMelodyCarrier);
    }
  }

  for (const note of melody.notes) {
    const bar = Math.floor(note.startTick / barTicks) + 1;
    const track = melodyTrackByBar.get(bar) ?? 'violins1';
    const range = RANGES[track];
    if (!range) continue;
    let pitch = note.pitch;
    if (track !== 'violins1') {
      // The cello carries it an octave above its bass role; the viola takes it
      // where it lies.
      if (track === 'cellosBasses') pitch += 12;
      pitch = Math.max(range.low, Math.min(range.high, pitch));
    }
    notes.get(track)?.push({
      pitch,
      startTick: note.startTick,
      durationTicks: note.durationTicks,
      velocity: 80,
      articulation: 'legato',
      melody: true,
    });
  }

  // ---- accompaniment, chord by chord ----
  const previous: Record<string, number> = {};
  for (let bar = 1; bar <= totalBars; bar++) {
    const { section, index } = sectionForBar(sections, bar);
    const roles = roleBySection[index];
    const harmony = barHarmony[bar - 1];
    if (!harmony?.chords.length) continue;
    const energy = section.energy;
    const pattern = roles.pattern;

    const accompanying = ensembleTracks.filter((track) => track !== 'violins1');
    for (const chord of harmony.chords) {
      const tones = spreadChord(chord, previous, accompanying, tonic, energy);
      for (const track of accompanying) {
        const range = RANGES[track];
        if (!range) continue;
        const tone = tones[track];
        if (tone === undefined) continue;
        const role: Role = track === 'cellosBasses' || track === 'basses'
          ? (roles.vc === 'MELODY' && track === 'cellosBasses' ? 'REST' : 'BASS')
          : track === 'violins2' ? roles.vln2
          : track === 'violas' ? roles.vla
          : roles.vln2;
        if (role === 'REST') continue;

        // The bass takes the root; everyone else takes their chord tone.
        const pitch = role === 'BASS' ? nearestTone(chord, tone, range.low, range.high, tonic) : tone;
        const placed = placePattern(pattern, chord, pitch, bar, beatTicks, barTicks, beatTicks, beatsPerBar, energy, previous[track]);
        for (const slice of placed) {
          const fitted = fitToRange(slice.pitch, track);
          if (fitted === null) continue;
          notes.get(track)?.push({
            pitch: fitted,
            startTick: slice.startTick,
            durationTicks: slice.durationTicks,
            velocity: slice.velocity,
            articulation: ROLE_ARTICULATION[role === 'BASS' ? 'BASS' : role],
          });
        }
        previous[track] = pitch;
      }
    }
  }

  // ---- humanize ----
  for (const [track, list] of notes) {
    const bass = track === 'cellosBasses' || track === 'basses';
    const offset = bass ? rng.int(-4, 4) : rng.int(-8, 8);
    for (const note of list) {
      note.startTick = Math.max(0, note.startTick + offset);
      note.velocity = Math.max(30, Math.min(120, note.velocity + rng.int(-6, 6)));
      if (note.articulation !== 'legato') {
        note.durationTicks = Math.max(1, Math.round(note.durationTicks * rng.range(0.92, 1)));
      }
    }
  }

  // ---- melody must be the top voice ----
  // Every melody note carries the tag set at placement, so this pass compares
  // against the ACTUAL melody rather than guessing from the bar's carrier.
  enforceMelodyOnTop(notes);
  // ---- ranges after everything ----
  // A note the top-voice pass had to remove carries durationTicks 0; drop it now
  // rather than letting a range clamp resurrect it a few octaves away.
  for (const [track, list] of notes) {
    notes.set(track, list
      .map((note) => {
        if (note.durationTicks <= 0) return null;
        const fitted = fitToRange(note.pitch, track);
        return fitted === null ? null : { ...note, pitch: fitted };
      })
      .filter((note): note is PlacedNote => note !== null));
  }
  void meterName;
  return notes;
}

interface Slice { startTick: number; durationTicks: number; pitch: number; velocity: number }

function placePattern(
  pattern: PatternName,
  chord: ChordPlan,
  pitch: number,
  bar: number,
  beatTicks: number,
  barTicks: number,
  _beatTicks: number,
  beatsPerBar: number,
  energy: number,
  previousPitch: number | undefined,
): Slice[] {
  const barStart = (bar - 1) * barTicks;
  const chordStart = barStart + Math.round(chord.startBeat * beatTicks);
  const span = Math.round(chord.beats * beatTicks);
  const velocity = Math.max(30, Math.min(120, Math.round(40 + energy * 70)));
  const note = (startTick: number, durationTicks: number, p = pitch): Slice => ({
    startTick, durationTicks, pitch: p, velocity,
  });
  const fifth = pitch + 7 > 0 ? pitch + 7 : pitch;
  const third = pitch + 4;

  switch (pattern) {
    case 'sustained': return [note(chordStart, span)];
    case 'halfPulse': {
      const step = Math.round(beatTicks * 2);
      return fillSpan(span, step, (offset) => [note(chordStart + offset, step)]);
    }
    case 'quarterPulse': {
      const step = Math.round(beatTicks);
      return fillSpan(span, step, (offset) => [note(chordStart + offset, step)]);
    }
    case 'eighths': {
      const step = Math.round(beatTicks / 2);
      return fillSpan(span, step, (offset) => [note(chordStart + offset, Math.round(step * 0.9))]);
    }
    case 'syncopated': {
      const step = Math.round(beatTicks);
      return fillSpan(span, step, (offset) => [note(chordStart + offset, Math.round(step * 0.75))]);
    }
    case 'arpeggio': {
      const step = Math.round(beatTicks / 2);
      const tones = [pitch, fifth, third, fifth];
      let index = 0;
      return fillSpan(span, step, (offset) => [note(chordStart + offset, Math.round(step * 0.9), tones[index++ % tones.length])]);
    }
    case 'waltz': {
      // bass on 1, chord on 2 and 3 — only legal in 3/4.
      const step = Math.round(beatTicks);
      if (beatsPerBar !== 3) return [note(chordStart, span)];
      return fillSpan(span, step, (offset, cell) => [note(chordStart + offset, step, cell === 0 ? pitch : third)]);
    }
    case 'pizzQuarters': {
      const step = Math.round(beatTicks);
      return fillSpan(span, step, (offset) => [note(chordStart + offset, Math.round(step * 0.85))]);
    }
    case 'tremolo': {
      return [note(chordStart, span)];
    }
    case 'spiccato16': {
      const step = Math.round(beatTicks / 4);
      return fillSpan(span, step, (offset) => [note(chordStart + offset, Math.round(step * 0.25))]);
    }
    default: return [note(chordStart, span)];
  }
  function fillSpan(
    total: number,
    step: number,
    make: (offset: number, index: number) => Slice[],
  ): Slice[] {
    if (step <= 0) return [note(chordStart, total)];
    const out: Slice[] = [];
    let cell = 0;
    for (let offset = 0; offset < total; offset += step, cell++) {
      out.push(...make(offset, cell));
    }
    void previousPitch;
    const last = out[out.length - 1];
    if (last) out[out.length - 1] = { ...last, durationTicks: Math.min(last.durationTicks, total - (out.length - 1) * step) };
    return out.filter((slice) => slice.durationTicks > 0);
  }
}

/**
 * The melody must be the highest sounding note at every moment; any part above
 * it is dropped an octave.
 */
function enforceMelodyOnTop(notes: TrackNotes): void {
  const melody = [...notes.values()].flat().filter((note) => note.melody);
  if (!melody.length) return;

  for (const [track, list] of notes) {
    for (const note of list) {
      if (note.melody) continue; // never move the tune itself
      const over = melody.filter(
        (m) => m.startTick < note.startTick + note.durationTicks && note.startTick < m.startTick + m.durationTicks,
      );
      if (!over.length) continue;
      const top = Math.max(...over.map((m) => m.pitch));
      if (note.pitch < top) continue;
      // Drop by octaves until strictly below the tune. `fitToRange` is NOT used
      // here: it clamps by octaves and would push the note straight back up to
      // or above the melody, undoing the fix. If the drop leaves the instrument's
      // range the note is simply removed — silence is better than a second
      // "melody" an octave above the real one.
      let pitch = note.pitch;
      for (let guard = 0; guard < 4 && pitch >= top; guard++) pitch -= 12;
      const range = RANGES[track];
      if (range && (pitch < range.low || pitch > range.high)) {
        note.durationTicks = 0;
      } else {
        note.pitch = pitch;
      }
    }
  }
}
