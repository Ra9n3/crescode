/**
 * Mode-change transformation — the chord track follows the project mode.
 * Pure-logic tests for engine/suggestion/transpose.ts (no DOM, no store).
 *
 * A mode change keeps the tonic, so there is no interval: "the corresponding
 * chord in the new mode" is the same scale degree re-rendered diatonically —
 * root re-spelled as the new mode's scale tone, core quality re-derived from
 * the new mode's stack of thirds, color tones kept, borrowed (chromatic)
 * roots untouched.
 */
import { describe, expect, it } from 'vitest';
import { projectFromFixture, parseChord, type Note, type Project } from '../src/shared/schema';
import { transformProjectMode } from '../src/engine/suggestion/transpose';

const TS44 = { numerator: 4, denominator: 4 } as const;

const makeProject = (key: Project['key'], mode: Project['mode'], chords: { id: string; symbol: string; startTick: number; durationTicks: number }[], laneNotes: Note[] = []): Project => {
  const p = projectFromFixture({
    schemaVersion: 1, name: 'mode-transform-test', bpm: 120,
    tempoMap: [{ tick: 0, bpm: 120 }], timeSignature: TS44,
    key, mode, sections: [], chords, referenceAudio: { path: null, offsetMs: 0 },
    tracks: [], libraryGroups: [], masterVolume: 1,
  });
  if (laneNotes.length === 0) return p;
  return { ...p, tracks: p.tracks.map((t) => (t.role === 'chords' ? { ...t, notes: laneNotes } : t)) };
};

const symbolsOf = (p: Project) => p.chords.map((c) => c.symbol);
const lanePitches = (p: Project) => p.tracks.find((t) => t.role === 'chords')?.notes.map((n) => n.pitch) ?? [];

describe('transformProjectMode — C Ionian → C Aeolian (major → parallel minor)', () => {
  const cases: [string, string][] = [
    ['C', 'Cm'],          // I → i
    ['Dm', 'Ddim'],       // ii → ii°
    ['Em', 'Eb'],         // iii → III
    ['F', 'Fm'],          // IV → iv
    ['G', 'Gm'],          // V → v
    ['Am', 'Ab'],         // vi → VI
    ['Bdim', 'Bb'],       // vii° → VII
    ['Cmaj7', 'Cm7'],     // Imaj7 → i7
    ['Dm7', 'Dm7b5'],     // ii7 → iiø7
    ['Em7', 'Ebmaj7'],    // iii7 → IIImaj7
    ['Fmaj7', 'Fm7'],
    ['G7', 'Gm7'],        // V7 → v7 (the dominant's seventh re-derives too)
    ['Am7', 'Abmaj7'],
    ['Bm7b5', 'Bb7'],     // viiø7 → VII7
  ];
  for (const [from, to] of cases) {
    it(`"${from}" → "${to}"`, () => {
      const res = transformProjectMode(makeProject(0, 'Ionian', [{ id: 'a', symbol: from, startTick: 0, durationTicks: 3840 }]), 'Aeolian');
      expect(symbolsOf(res.project)).toEqual([to]);
      expect(parseChord(to).ok).toBe(true);
    });
  }

  it('re-spells roots with the new mode\'s own diatonic spelling (Ab, not G#)', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'Am', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'Em', startTick: 3840, durationTicks: 3840 },
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['Ab', 'Eb']);
  });

  it('counts every rewritten chord and never moves ids, ticks or durations', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'G7', startTick: 3840, durationTicks: 3840 },
    ]), 'Aeolian');
    expect(res.changed).toBe(2);
    expect(res.from).toBe('Ionian');
    expect(res.to).toBe('Aeolian');
    expect(res.project.chords.map((c) => [c.id, c.startTick, c.durationTicks])).toEqual([
      ['a', 0, 3840], ['b', 3840, 3840],
    ]);
  });
});

describe('transformProjectMode — E Aeolian → E Ionian (minor → parallel major)', () => {
  const cases: [string, string][] = [
    ['Em', 'E'],          // i → I
    ['F#dim', 'F#m'],     // ii° → ii
    ['G', 'G#m'],         // III → iii
    ['Am', 'A'],          // iv → IV
    ['Bm', 'B'],          // v → V
    ['C', 'C#m'],         // VI → vi
    ['D', 'D#dim'],       // VII → vii°
  ];
  for (const [from, to] of cases) {
    it(`"${from}" → "${to}"`, () => {
      const res = transformProjectMode(makeProject(4, 'Aeolian', [{ id: 'a', symbol: from, startTick: 0, durationTicks: 3840 }]), 'Ionian');
      expect(symbolsOf(res.project)).toEqual([to]);
    });
  }
});

describe('transformProjectMode — chords that must NOT move', () => {
  it('leaves chromatic (borrowed) roots untouched', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'Bb', startTick: 0, durationTicks: 3840 },   // bVII
      { id: 'b', symbol: 'F#m', startTick: 3840, durationTicks: 3840 }, // #iv
      { id: 'c', symbol: 'C', startTick: 7680, durationTicks: 3840 },
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['Bb', 'F#m', 'Cm']);
    expect(res.changed).toBe(1);
  });

  it('keeps sus/power text verbatim while the root follows the degree', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'Esus4', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'E5', startTick: 3840, durationTicks: 3840 },
      { id: 'c', symbol: 'G7sus4', startTick: 7680, durationTicks: 3840 }, // root stays on G
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['Ebsus4', 'Eb5', 'G7sus4']);
  });

  it('leaves unparseable symbols untouched', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'bad', symbol: 'X#9', startTick: 0, durationTicks: 3840 },
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['X#9']);
    expect(res.changed).toBe(0);
  });

  it('is a no-op when the mode does not change (same project reference)', () => {
    const p = makeProject(0, 'Ionian', [{ id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 }]);
    const res = transformProjectMode(p, 'Ionian');
    expect(res.project).toBe(p);
    expect(res.changed).toBe(0);
  });

  it('leaves every non-chords track untouched', () => {
    const p = makeProject(0, 'Ionian', [{ id: 'a', symbol: 'Em', startTick: 0, durationTicks: 3840 }]);
    const withInstrument = {
      ...p,
      tracks: p.tracks.map((t) => (t.role !== 'chords' && t.family !== 'Audio' && t.family !== 'Structure'
        ? { ...t, notes: [{ pitch: 72, startTick: 0, durationTicks: 480, velocity: 90 }] }
        : t)),
    };
    const res = transformProjectMode(withInstrument, 'Aeolian');
    const other = res.project.tracks.find((t) => t.role !== 'chords' && t.notes.length > 0);
    expect(other?.notes[0].pitch).toBe(72);
  });
});

describe('transformProjectMode — color tones and slash basses', () => {
  it('re-derives the core of sixth chords and keeps the figure', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'C6', startTick: 0, durationTicks: 3840 },   // major core → minor core
      { id: 'b', symbol: 'Am6', startTick: 3840, durationTicks: 3840 }, // minor core → major core
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['Cm6', 'Ab6']);
  });

  it('re-derives the core of 9-chords and keeps the figure', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'Cmaj9', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'C9', startTick: 3840, durationTicks: 3840 },
      { id: 'c', symbol: 'G9', startTick: 7680, durationTicks: 3840 },
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['Cm9', 'Cm9', 'Gm9']);
  });

  it('re-derives add-chords through the shared grammar (madd9 exists)', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'Cadd9', startTick: 0, durationTicks: 3840 },
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['Cmadd9']);
  });

  it('keeps explicit alterations verbatim on top of the new core', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'Cmaj7#11', startTick: 0, durationTicks: 3840 },
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['Cm7#11']);
  });

  it('slash basses follow their own degree, so inversions stay inversions', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'C/E', startTick: 0, durationTicks: 3840 },    // third in the bass
      { id: 'b', symbol: 'G/B', startTick: 3840, durationTicks: 3840 }, // fifth in the bass
      { id: 'c', symbol: 'Dm7/F', startTick: 7680, durationTicks: 3840 },
      { id: 'd', symbol: 'G/C', startTick: 11520, durationTicks: 3840 }, // foreign bass keeps its pc
    ]), 'Aeolian');
    expect(symbolsOf(res.project)).toEqual(['Cm/Eb', 'Gm/Bb', 'Dm7b5/F', 'Gm/C']);
  });
});

describe('transformProjectMode — the Chords track\'s MIDI notes', () => {
  it('shifts each chord\'s notes by that chord\'s own root delta', () => {
    // C Ionian → C Aeolian: C Δ0, Em Δ−1 (E→Eb), Am Δ−1 (A→Ab), G7 Δ0.
    const p = makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'Em', startTick: 3840, durationTicks: 3840 },
      { id: 'c', symbol: 'Am', startTick: 7680, durationTicks: 3840 },
      { id: 'd', symbol: 'G7', startTick: 11520, durationTicks: 3840 },
    ], [
      { pitch: 60, startTick: 0, durationTicks: 960, velocity: 100 },
      { pitch: 64, startTick: 3840, durationTicks: 960, velocity: 100 },
      { pitch: 69, startTick: 7680, durationTicks: 960, velocity: 100 },
      { pitch: 67, startTick: 11520, durationTicks: 960, velocity: 100 },
    ]);
    const res = transformProjectMode(p, 'Aeolian');
    expect(lanePitches(res.project)).toEqual([60, 63, 68, 67]);
  });

  it('leaves notes outside every chord span alone and clamps into MIDI range', () => {
    const p = makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'Em', startTick: 0, durationTicks: 3840 },
    ], [
      { pitch: 1, startTick: 0, durationTicks: 960, velocity: 100 },      // clamps to 0
      { pitch: 64, startTick: 50000, durationTicks: 960, velocity: 100 }, // outside → untouched
    ]);
    const res = transformProjectMode(p, 'Aeolian');
    expect(lanePitches(res.project)).toEqual([0, 64]);
  });
});

describe('transformProjectMode — reversibility and exotic modes', () => {
  it('is exactly reversible: Ionian → Aeolian → Ionian restores symbols and notes', () => {
    const p = makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'Dm7', startTick: 3840, durationTicks: 3840 },
      { id: 'c', symbol: 'Em', startTick: 7680, durationTicks: 3840 },
      { id: 'd', symbol: 'G7', startTick: 11520, durationTicks: 3840 },
      { id: 'e', symbol: 'Bdim', startTick: 15360, durationTicks: 3840 },
    ], [{ pitch: 64, startTick: 3840, durationTicks: 960, velocity: 100 }]);
    const toMinor = transformProjectMode(p, 'Aeolian');
    expect(symbolsOf(toMinor.project)).toEqual(['Cm', 'Dm7b5', 'Eb', 'Gm7', 'Bb']);
    const back = transformProjectMode(toMinor.project, 'Ionian');
    expect(symbolsOf(back.project)).toEqual(['C', 'Dm7', 'Em', 'G7', 'Bdim']);
    expect(lanePitches(back.project)).toEqual([64]);
  });

  it('whole-tone stacks augmented triads; a seventh cannot stack there and is kept', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'Dm', startTick: 3840, durationTicks: 3840 },
      { id: 'c', symbol: 'G7', startTick: 7680, durationTicks: 3840 }, // 7th unstackable → untouched
    ]), 'Whole Tone');
    expect(symbolsOf(res.project)).toEqual(['Caug', 'Daug', 'G7']);
    expect(res.changed).toBe(2);
  });

  it('octatonic scales stack diminished harmonies — triads stay triads, sevenths stack dim7s', () => {
    const res = transformProjectMode(makeProject(0, 'Ionian', [
      { id: 'a', symbol: 'C', startTick: 0, durationTicks: 3840 },
      { id: 'b', symbol: 'Dm', startTick: 3840, durationTicks: 3840 },
      { id: 'c', symbol: 'Em', startTick: 7680, durationTicks: 3840 },
      { id: 'd', symbol: 'C7', startTick: 11520, durationTicks: 3840 },
    ]), 'Diminished (Half-Whole)');
    expect(symbolsOf(res.project)).toEqual(['Cdim', 'C#dim', 'D#dim', 'Cdim7']);
  });
});
