/**
 * Key-change transposition — the chord track follows the project key.
 * Pure-logic tests for engine/suggestion/transpose.ts (no DOM, no store).
 */
import { describe, expect, it } from 'vitest';
import { projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { parseChord } from '../src/shared/schema';
import { transposeChordSymbol, transposeProjectKey } from '../src/engine/suggestion/transpose';

const TS44 = { numerator: 4, denominator: 4 } as const;

const makeProject = (key: Project['key'], chords: { id: string; symbol: string; startTick: number; durationTicks: number }[], laneNotes: Note[] = []): Project => {
  const p = projectFromFixture({
    schemaVersion: 1, name: 'key-transpose-test', bpm: 120,
    tempoMap: [{ tick: 0, bpm: 120 }], timeSignature: TS44,
    key, mode: 'Ionian',
    sections: [], chords, referenceAudio: { path: null, offsetMs: 0 },
    tracks: [], libraryGroups: [], masterVolume: 1,
  });
  if (laneNotes.length === 0) return p;
  return { ...p, tracks: p.tracks.map((t) => (t.role === 'chords' ? { ...t, notes: laneNotes } : t)) };
};

const E_MAJOR = { tonic: 4 as const, mode: 'Ionian' as const, spelling: 'mixed' as const };

describe('transposeChordSymbol — C major → E major (+4)', () => {
  const cases: [string, string][] = [
    ['C', 'E'],          // the user's example: I → I
    ['Dm', 'F#m'],       // ii → ii (the user's example)
    ['G7', 'B7'],        // V7 → V7
    ['Am', 'C#m'],       // vi → vi
    ['Bdim', 'D#dim'],   // vii° → vii°
    ['Em', 'G#m'],
    ['F', 'A'],
    ['C/E', 'E/G#'],     // slash bass shifts by the same interval
    ['G/B', 'B/D#'],
    ['Dm7b5', 'F#m7b5'], // quality text survives verbatim
    ['G7sus4', 'B7sus4'],
    ['Cadd9', 'Eadd9'],
    ['Fmaj9', 'Amaj9'],
    ['Bb7', 'D7'],       // borrowed bVII lands on a diatonic degree
    ['g7', 'B7'],        // quick-entry case folds through the parser
  ];
  for (const [from, to] of cases) {
    it(`"${from}" → "${to}"`, () => {
      expect(transposeChordSymbol(from, 4, E_MAJOR)).toBe(to);
      expect(parseChord(to).ok).toBe(true);
    });
  }

  it('spells chromatic roots on the new key\'s accidental side (F#7 → A#7 in E major)', () => {
    expect(transposeChordSymbol('F#7', 4, E_MAJOR)).toBe('A#7');
  });

  it('returns null for unparseable symbols', () => {
    expect(transposeChordSymbol('X#9', 4, E_MAJOR)).toBeNull();
    expect(transposeChordSymbol('C 7q', 4, E_MAJOR)).toBeNull();
  });
});

describe('transposeChordSymbol — flat keys', () => {
  const EB_MAJOR = { tonic: 3 as const, mode: 'Ionian' as const, spelling: 'mixed' as const };
  it('diatonic degrees take the key\'s own spelling (B7 → D7 going C → Eb)', () => {
    expect(transposeChordSymbol('B7', 3, EB_MAJOR)).toBe('D7');
  });
  it('chromatic roots prefer flats in a flat key (D#7 → Gb7 in Eb major)', () => {
    expect(transposeChordSymbol('D#7', 3, EB_MAJOR)).toBe('Gb7');
  });
  it('diatonic degrees re-spell (Dm → Fm in Eb major)', () => {
    expect(transposeChordSymbol('Dm', 3, EB_MAJOR)).toBe('Fm');
  });
});

describe('transposeProjectKey', () => {
  it('moves every chord and the Chords-track notes (the user\'s exact example)', () => {
    const p = makeProject(0, [
      { id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'Dm', startTick: 3840, durationTicks: 3840 },
      { id: 'c', symbol: 'G7', startTick: 7680, durationTicks: 3840 },
    ], [{ pitch: 60, startTick: 0, durationTicks: 960, velocity: 100 }]);
    const res = transposeProjectKey(p, 4);
    expect(res.interval).toBe(4);
    expect(res.changed).toBe(3);
    expect(res.project.chords.map((c) => c.symbol)).toEqual(['E', 'F#m', 'B7']);
    expect(res.project.tracks.find((t) => t.role === 'chords')?.notes[0].pitch).toBe(64);
    expect(res.project.key).toBe(4);
    // position, length, ids and velocity are never touched
    expect(res.project.chords.map((c) => [c.id, c.startTick, c.durationTicks])).toEqual([
      ['a', 0, 3840], ['b', 3840, 3840], ['c', 7680, 3840],
    ]);
  });

  it('leaves other tracks and unparseable symbols untouched', () => {
    const p = makeProject(0, [
      { id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 },
      { id: 'bad', symbol: 'X#9', startTick: 3840, durationTicks: 3840 },
    ]);
    const withTrack = { ...p, tracks: p.tracks.map((t) => (t.role !== 'chords' && t.role !== 'structure' && t.family !== 'Audio' ? { ...t, notes: [{ pitch: 72, startTick: 0, durationTicks: 480, velocity: 90 }] } : t)) };
    const res = transposeProjectKey(withTrack, 4);
    expect(res.changed).toBe(1); // only "C"
    expect(res.project.chords.find((c) => c.id === 'bad')?.symbol).toBe('X#9');
    expect(res.project.tracks.find((t) => t.role !== 'chords' && t.notes.length > 0)?.notes[0].pitch).toBe(72);
  });

  it('clamps transposed pitches into the MIDI range', () => {
    const p = makeProject(0, [], [
      { pitch: 126, startTick: 0, durationTicks: 480, velocity: 100 },
      { pitch: 2, startTick: 0, durationTicks: 480, velocity: 100 },
    ]);
    const res = transposeProjectKey(p, 4); // +4
    const notes = res.project.tracks.find((t) => t.role === 'chords')?.notes;
    expect(notes?.[0].pitch).toBe(127);
    expect(notes?.[1].pitch).toBe(6);
  });

  it('is exactly reversible: E major back to C major restores the spellings', () => {
    const p = makeProject(0, [
      { id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'Dm', startTick: 3840, durationTicks: 3840 },
      { id: 'c', symbol: 'Bdim', startTick: 7680, durationTicks: 3840 },
    ], [{ pitch: 60, startTick: 0, durationTicks: 960, velocity: 100 }]);
    const up = transposeProjectKey(p, 4);
    const down = transposeProjectKey(up.project, 0);
    expect(down.project.chords.map((c) => c.symbol)).toEqual(['C', 'Dm', 'Bdim']);
    expect(down.project.tracks.find((t) => t.role === 'chords')?.notes[0].pitch).toBe(60);
  });

  it('is a no-op for the chords when the tonic does not move (mode-only change)', () => {
    const p = makeProject(0, [{ id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 }]);
    const chords = p.chords;
    const res = transposeProjectKey(p, 0);
    expect(res.interval).toBe(0);
    expect(res.changed).toBe(0);
    expect(res.project.chords).toBe(chords); // same reference — nothing rewritten
    expect(res.project.key).toBe(0);
  });
});
