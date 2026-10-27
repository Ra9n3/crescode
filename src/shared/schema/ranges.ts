import { parseNoteName } from './modes';
import type { TrackFamily } from './types';

/**
 * Editable instrument range table. Refine only with a documented reason
 * (log it in docs/CHANGES.md). Notes are written as scientific pitch, C4 = 60.
 */
export interface InstrumentDef {
  name: string;
  family: TrackFamily;
  role: string;
  low: string;
  high: string;
  /** Unpitched percussion: a configurable fixed note (low = high = this). */
  fixedNote?: number;
}

export const PERCUSSION_FIXED_NOTES = { snare: 38, cymbals: 49, aux: 42 };

export const INSTRUMENTS: InstrumentDef[] = [
  { name: 'Structure', family: 'Structure', role: 'structure', low: 'C-1', high: 'G9' },
  { name: 'Chords', family: 'Structure', role: 'chords', low: 'C-1', high: 'G9' },
  { name: 'Reference Audio', family: 'Audio', role: 'reference', low: 'C-1', high: 'G9' },
  { name: 'Violins I', family: 'Strings', role: 'violins1', low: 'G3', high: 'C7' },
  { name: 'Violins II', family: 'Strings', role: 'violins2', low: 'G3', high: 'A6' },
  { name: 'Violas', family: 'Strings', role: 'violas', low: 'C3', high: 'E6' },
  { name: 'Cellos/Basses', family: 'Strings', role: 'cellosBasses', low: 'E1', high: 'C6' },
  { name: 'French Horns', family: 'Brass', role: 'horns', low: 'F2', high: 'F5' },
  { name: 'Trumpets', family: 'Brass', role: 'trumpets', low: 'E3', high: 'C6' },
  { name: 'Trombones', family: 'Brass', role: 'trombones', low: 'E2', high: 'F5' },
  { name: 'Tuba', family: 'Brass', role: 'tuba', low: 'D1', high: 'F4' },
  { name: 'Flutes', family: 'Woodwinds', role: 'flutes', low: 'C4', high: 'C7' },
  { name: 'Oboes', family: 'Woodwinds', role: 'oboes', low: 'Bb3', high: 'A6' },
  { name: 'Clarinets', family: 'Woodwinds', role: 'clarinets', low: 'D3', high: 'G6' },
  { name: 'Bassoons', family: 'Woodwinds', role: 'bassoons', low: 'Bb1', high: 'Eb5' },
  { name: 'Timpani', family: 'Percussion', role: 'timpani', low: 'D2', high: 'A3' },
  { name: 'Snare', family: 'Percussion', role: 'snare', low: 'D2', high: 'D2', fixedNote: PERCUSSION_FIXED_NOTES.snare },
  { name: 'Cymbals', family: 'Percussion', role: 'cymbals', low: 'C#3', high: 'C#3', fixedNote: PERCUSSION_FIXED_NOTES.cymbals },
  { name: 'Aux', family: 'Percussion', role: 'aux', low: 'F#2', high: 'F#2', fixedNote: PERCUSSION_FIXED_NOTES.aux },
  { name: 'Piano', family: 'Keys', role: 'piano', low: 'A0', high: 'C8' },
  { name: 'Harp', family: 'Keys', role: 'harp', low: 'Cb1', high: 'G#7' },
];

export function instrumentRange(def: InstrumentDef): [number, number] {
  if (def.fixedNote !== undefined) return [def.fixedNote, def.fixedNote];
  return [parseNoteName(def.low) ?? 0, parseNoteName(def.high) ?? 127];
}

/** Templates offered by "Add Track", per family. */
export const ADD_TRACK_TEMPLATES: Record<string, { name: string; role: string; low: number; high: number }> = {
  Strings: { name: 'Strings', role: 'strings', low: 28, high: 96 },
  Brass: { name: 'Brass', role: 'brass', low: 40, high: 84 },
  Woodwinds: { name: 'Woodwinds', role: 'woodwinds', low: 34, high: 96 },
  Percussion: { name: 'Percussion', role: 'percussion', low: 35, high: 81 },
  Keys: { name: 'Keys', role: 'keys', low: 21, high: 108 },
};
