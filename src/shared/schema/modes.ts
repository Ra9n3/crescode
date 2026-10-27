import type { ModeName, PitchClass } from './types';

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Semitone interval arrays from the tonic. */
export const MODES: Record<ModeName, number[]> = {
  Ionian: [0, 2, 4, 5, 7, 9, 11],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  Aeolian: [0, 2, 3, 5, 7, 8, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Melodic Minor': [0, 2, 3, 5, 7, 9, 11],
  'Whole Tone': [0, 2, 4, 6, 8, 10],
  'Diminished (Half-Whole)': [0, 1, 3, 4, 6, 7, 9, 10],
  'Diminished (Whole-Half)': [0, 2, 3, 5, 6, 8, 9, 11],
};

export const MODE_NAMES = Object.keys(MODES) as ModeName[];

export function scalePitchClasses(key: PitchClass | number, mode: ModeName): number[] {
  return MODES[mode].map((i) => (key + i) % 12);
}

export function noteName(pitch: number): string {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** Parse "G3", "Bb1", "Cb1", "G#7" → MIDI number (C4 = 60). Returns null on bad input. */
export function parseNoteName(s: string): number | null {
  const m = /^([A-Ga-g])([#b]*)(-?\d+)$/.exec(s.trim());
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === '#' ? 1 : -1;
  const midi = (parseInt(m[3], 10) + 1) * 12 + pc;
  return midi >= 0 && midi <= 127 ? midi : null;
}
