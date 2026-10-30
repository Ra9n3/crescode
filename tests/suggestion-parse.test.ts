/**
 * Smart Chord Suggestion — foundation layer tests (feature spec §1–§3):
 * MIDI parsing, the enharmonic engine and key-idiomatic normalization.
 * The six worked examples from the spec are pinned one-to-one.
 */
import { describe, expect, it } from 'vitest';
import type { PitchClass } from '../src/shared/schema';
import {
  EnharmonicEngine, analyzeChord, chordFromSymbol, keyAccidentalPreference,
  normalizeChord, parseChordClipView, parseChordFromClip, pitchOf, projectKeyOf,
  CHORD_TEMPLATES, diatonicSpellingMap,
  type Chord, type ProjectKey,
} from '../src/engine/suggestion';

const note = (midi: number, startTick = 0, durationTicks = 960, velocity = 100) =>
  pitchOf({ pitch: midi, startTick, durationTicks, velocity });

const keyOf = (tonic: PitchClass, mode: Parameters<typeof projectKeyOf>[0]['mode']): ProjectKey =>
  projectKeyOf({ key: tonic, mode });

const chordOf = (symbol: string): Chord => {
  const r = chordFromSymbol(symbol);
  if (!r.ok) throw r.error;
  return r.chord;
};

// --- §2 Enharmonic engine ----------------------------------------------------

describe('EnharmonicEngine', () => {
  it('recognizes every enharmonic pair through explicit tables', () => {
    const pairs: Array<[string, string]> = [
      ['C#', 'Db'], ['D#', 'Eb'], ['F#', 'Gb'], ['G#', 'Ab'], ['A#', 'Bb'],
      ['Cb', 'B'], ['E#', 'F'], ['B#', 'C'], ['Fb', 'E'],
    ];
    for (const [a, b] of pairs) {
      expect(EnharmonicEngine.areEnharmonicEquivalents(a, b), `${a}/${b}`).toBe(true);
      expect(EnharmonicEngine.partnersOf(a)).toContain(b);
      expect(EnharmonicEngine.partnersOf(b)).toContain(a);
    }
    expect(EnharmonicEngine.areEnharmonicEquivalents('C', 'Db')).toBe(false);
    expect(EnharmonicEngine.partnersOf('D')).toEqual([]);
  });

  it('resolves spellings to pitch classes without conversion arithmetic', () => {
    expect(EnharmonicEngine.pitchClassOf('C')).toBe(0);
    expect(EnharmonicEngine.pitchClassOf('B#')).toBe(0);
    expect(EnharmonicEngine.pitchClassOf('Cb')).toBe(11);
    expect(EnharmonicEngine.pitchClassOf('E#')).toBe(5);
    expect(EnharmonicEngine.pitchClassOf('Fb')).toBe(4);
    expect(EnharmonicEngine.pitchClassOf('Db')).toBe(1);
    expect(EnharmonicEngine.spellingsOf(1)).toEqual(['C#', 'Db']);
    expect(EnharmonicEngine.spellingsOf(6)).toEqual(['F#', 'Gb']);
  });

  it('folds unicode accidentals and case, rejects garbage', () => {
    expect(EnharmonicEngine.normalizeInputName('c♯')).toBe('C#');
    expect(EnharmonicEngine.normalizeInputName(' db ')).toBe('Db');
    expect(EnharmonicEngine.normalizeInputName('E♭')).toBe('Eb');
    expect(EnharmonicEngine.isValidNoteName('Bb')).toBe(true);
    expect(EnharmonicEngine.isValidNoteName('H')).toBe(false);
    expect(EnharmonicEngine.isValidNoteName('C##')).toBe(false);
    expect(EnharmonicEngine.isValidNoteName('')).toBe(false);
    expect(EnharmonicEngine.pitchClassOf('nope')).toBeNull();
  });

  it('flags cross-letter spellings and their natural partners', () => {
    for (const [cross, natural] of [['B#', 'C'], ['Cb', 'B'], ['E#', 'F'], ['Fb', 'E']] as const) {
      expect(EnharmonicEngine.isCrossAccidental(cross)).toBe(true);
      expect(EnharmonicEngine.naturalPartnerOf(cross)).toBe(natural);
    }
    expect(EnharmonicEngine.isCrossAccidental('C#')).toBe(false);
    expect(EnharmonicEngine.hasAccidental('Cb')).toBe(true);
    expect(EnharmonicEngine.hasAccidental('C')).toBe(false);
  });
});

// --- §3 Normalization ---------------------------------------------------------

describe('normalizeChord', () => {
  it('normalizes to the key signature spelling (spec examples)', () => {
    expect(normalizeChord('Db', keyOf(2, 'Ionian'))).toBe('C#');   // D major
    expect(normalizeChord('C#', keyOf(3, 'Ionian'))).toBe('Db');   // Eb major
    expect(normalizeChord('A#', keyOf(5, 'Ionian'))).toBe('Bb');   // F major
  });

  it('preserves explicit spellings in neutral keys (A minor)', () => {
    expect(normalizeChord('C#', keyOf(9, 'Aeolian'))).toBe('C#');
    expect(normalizeChord('Db', keyOf(9, 'Aeolian'))).toBe('Db');
    expect(normalizeChord('D#', keyOf(9, 'Aeolian'))).toBe('D#'); // documented: neutral keeps input
  });

  it('never changes the pitch class, for any spelling in any key', () => {
    const keys: ProjectKey[] = [
      keyOf(0, 'Ionian'), keyOf(2, 'Ionian'), keyOf(3, 'Ionian'), keyOf(9, 'Aeolian'),
      keyOf(2, 'Aeolian'), keyOf(6, 'Ionian'), keyOf(1, 'Ionian'), keyOf(0, 'Whole Tone'),
    ];
    const names = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'Fb', 'F', 'E#', 'F#', 'Gb',
      'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B', 'Cb', 'B#'];
    for (const key of keys) {
      for (const name of names) {
        const out = normalizeChord(name, key);
        expect(EnharmonicEngine.pitchClassOf(out)).toBe(EnharmonicEngine.pitchClassOf(name));
      }
    }
  });

  it('keeps naturals, keeps the leading tone in minor, follows the key side for chromatics', () => {
    expect(normalizeChord('B', keyOf(0, 'Ionian'))).toBe('B');
    expect(normalizeChord('F#', keyOf(7, 'Ionian'))).toBe('F#');  // diatonic in G
    expect(normalizeChord('C#', keyOf(2, 'Aeolian'))).toBe('C#'); // raised 7th of D minor
    expect(normalizeChord('Db', keyOf(7, 'Ionian'))).toBe('C#');  // sharp side (G major)
    expect(normalizeChord('Gb', keyOf(2, 'Ionian'))).toBe('F#');  // diatonic degree wins
    expect(normalizeChord('C#', keyOf(7, 'Ionian'))).toBe('C#');  // chromatic on the sharp side stays
  });

  it('resolves cross-letter spellings unless the key itself uses them', () => {
    expect(normalizeChord('Cb', keyOf(0, 'Ionian'))).toBe('B');
    expect(normalizeChord('B#', keyOf(0, 'Ionian'))).toBe('C');
    expect(normalizeChord('Fb', keyOf(0, 'Ionian'))).toBe('E');
    expect(normalizeChord('E#', keyOf(6, 'Ionian'))).toBe('E#'); // 7th degree of F# major
    expect(normalizeChord('Cb', keyOf(0, 'Whole Tone'))).toBe('B'); // non-heptatonic → natural
  });

  it('derives the key accidental side and the diatonic spelling map', () => {
    expect(keyAccidentalPreference(keyOf(2, 'Ionian'))).toBe('sharps');
    expect(keyAccidentalPreference(keyOf(3, 'Ionian'))).toBe('flats');
    expect(keyAccidentalPreference(keyOf(9, 'Aeolian'))).toBe('neutral');
    expect(keyAccidentalPreference(keyOf(2, 'Dorian'))).toBe('neutral');
    expect(keyAccidentalPreference(keyOf(9, 'Harmonic Minor'))).toBe('neutral');
    expect(diatonicSpellingMap(keyOf(2, 'Ionian'))).toMatchObject({
      1: 'C#', 2: 'D', 4: 'E', 6: 'F#', 7: 'G', 9: 'A', 11: 'B',
    });
  });

  it('rejects invalid note names with the contract error code', () => {
    expect(() => normalizeChord('H', keyOf(0, 'Ionian'))).toThrowError(/not a valid note name/);
    expect(() => normalizeChord('C##', keyOf(0, 'Ionian'))).toThrowError();
  });
});

// --- §1 MIDI parsing ----------------------------------------------------------

describe('analyzeChord — worked examples from the spec', () => {
  it('C, E, G parses as C major', () => {
    const a = analyzeChord([note(60), note(64), note(67)]);
    expect(a.status).toBe('clear');
    expect(a.chord?.spelling).toBe('C');
    expect(a.chord?.quality).toBe('major');
    expect(a.chord?.inversion).toBe(0);
    expect(a.chord?.confidence).toBeCloseTo(0.88, 5);
    expect(a.confidence).toBe(88);
    expect(a.matchedPitchClasses).toEqual([0, 4, 7]);
    expect(a.missingPitchClasses).toEqual([]);
    expect(a.extraPitchClasses).toEqual([]);
    expect(a.alternatives.map((c) => c.chord?.spelling))
      .toEqual(['C6', 'C7', 'Cmaj7', 'Cadd9', 'Am7/C']);
  });

  it('E, G, C parses as C major first inversion and recognizes Am7', () => {
    const a = analyzeChord([note(64), note(67), note(72)]);
    expect(a.status).toBe('clear');
    expect(a.chord?.spelling).toBe('C/E');
    expect(a.chord?.inversion).toBe(1);
    expect(a.chord?.bassNote).toBe('E');
    expect(a.confidence).toBe(78);
    expect(a.alternatives.map((c) => c.chord?.spelling))
      .toEqual(['C6/E', 'C7/E', 'Cmaj7/E', 'Am7/E', 'Cadd9/E']);
  });

  it('C, E, G, A returns C6 vs Am7 as competing interpretations (bass decides)', () => {
    const withCBass = analyzeChord([note(60), note(64), note(67), note(81)]);
    expect(withCBass.status).toBe('ambiguous');
    expect(withCBass.chord?.spelling).toBe('C6');
    expect(withCBass.confidence).toBe(60);
    expect(withCBass.alternatives[0]?.chord.spelling).toBe('Am7/C');

    const withABass = analyzeChord([note(57), note(60), note(64), note(67)]);
    expect(withABass.status).toBe('ambiguous');
    expect(withABass.chord?.spelling).toBe('Am7');
    expect(withABass.alternatives[0]?.chord.spelling).toBe('C6/A');
  });

  it('C, D, G returns Csus2 vs Gsus4 as competing interpretations', () => {
    const a = analyzeChord([note(60), note(62), note(67)]);
    expect(a.status).toBe('ambiguous');
    expect(a.chord?.spelling).toBe('Csus2');
    expect(a.alternatives.map((c) => c.chord?.spelling))
      .toEqual(['Gsus4/C', 'D7sus4/C', 'G7sus4/C', 'G5/C']);
  });

  it('C, E, G, D distinguishes Cadd9 from a possible G/C by weighting and context', () => {
    // Strong D and E: the add9 reading wins outright.
    const add9 = analyzeChord([note(60), note(62), note(64), note(67)]);
    expect(add9.status).toBe('clear');
    expect(add9.chord?.spelling).toBe('Cadd9');
    expect(add9.confidence).toBe(88);
    expect(add9.alternatives.map((c) => c.chord?.spelling)).toEqual(['C9', 'Cmaj9']);

    // Full G triad over a C bass: the slash reading, not a sus chord guess.
    const slash = analyzeChord([note(60), note(67), note(71), note(74)]);
    expect(slash.status).toBe('clear');
    expect(slash.chord?.spelling).toBe('G/C');
    expect(slash.chord?.bassNote).toBe('C');
    expect(slash.chord?.inversion).toBeNull();
    // Cmaj9-without-E loses to G/C thanks to the missing-third penalty.
    expect(slash.alternatives.map((c) => c.chord?.spelling)).toEqual(['Cmaj9', 'Csus2', 'Gsus4/C']);
  });

  it('C, G only returns an incomplete result rather than guessing a triad', () => {
    const a = analyzeChord([note(60), note(67)]);
    expect(a.status).toBe('incomplete');
    expect(a.chord?.spelling).toBe('C5');
    expect(a.chord?.quality).toBe('power');
    expect(a.confidence).toBe(55);
    const spellings = a.alternatives.map((c) => c.chord?.spelling);
    // The honest triad completions stay visible; sus/power readings rank too.
    expect(spellings).toEqual(['C', 'Cm', 'Csus2', 'Csus4', 'Fsus2/C']);
  });
});

describe('analyzeChord — real-world input', () => {
  it('sevenths and their inversions parse with the slash bass label', () => {
    const root = analyzeChord([note(60), note(63), note(67), note(70)]);
    // {C,Eb,G,Bb} is genuinely Cm7-or-Eb6 — the shared pitch-class set keeps
    // the verdict ambiguous; the C bass picks Cm7 as primary.
    expect(root.status).toBe('ambiguous');
    expect(root.chord?.spelling).toBe('Cm7');
    expect(root.alternatives.map((c) => c.chord?.spelling)).toEqual(['Eb6/C', 'Cm9', 'Abmaj9/C', 'Eb/C']);

    const third = analyzeChord([note(64), note(67), note(70), note(72)]);
    expect(third.chord?.spelling).toBe('C7/E');
    expect(third.chord?.inversion).toBe(1);
    expect(third.alternatives.map((c) => c.chord?.spelling)).toEqual(['C9/E']);
  });

  it('doubled notes do not break detection', () => {
    const a = analyzeChord([note(48), note(60), note(64), note(67)]);
    expect(a.status).toBe('clear');
    expect(a.chord?.spelling).toBe('C');
    expect(a.matchedPitchClasses).toEqual([0, 4, 7]);
  });

  it('arpeggiated notes across the window parse as one chord', () => {
    const a = analyzeChord([note(60, 0), note(64, 960), note(67, 1920)]);
    expect(a.status).toBe('clear');
    expect(a.chord?.spelling).toBe('C');
    expect(a.window).toEqual({ startTick: 0, endTick: 2880 });
  });

  it('faint passing tones are ignored; heavier ones land in weakPitchClasses', () => {
    const faint = analyzeChord([
      note(60, 0, 1920), note(64, 0, 1920), note(67, 0, 1920),
      note(62, 120, 120, 40), // quick, quiet D — invisible
    ]);
    expect(faint.status).toBe('clear');
    expect(faint.chord?.spelling).toBe('C');
    expect(faint.weakPitchClasses).toEqual([]);

    const heavier = analyzeChord([
      note(60, 0, 1920), note(64, 0, 1920), note(67, 0, 1920),
      note(62, 240, 960, 30), // D now audible but faint
    ]);
    expect(heavier.status).toBe('clear');
    expect(heavier.chord?.spelling).toBe('C'); // not Cadd9 — the D is too faint
    expect(heavier.weakPitchClasses).toEqual([2]);
  });

  it('velocity and duration weighting can flip the reading (Cadd9 needs a real 9th)', () => {
    const weak = analyzeChord([
      note(60, 0, 1920), note(64, 0, 1920), note(67, 0, 1920), note(62, 0, 240, 45),
    ]);
    expect(weak.chord?.spelling).toBe('C');

    const strong = analyzeChord([note(60), note(62), note(64), note(67)]);
    expect(strong.chord?.spelling).toBe('Cadd9');
  });

  it('incomplete input is labeled incomplete, unknown input is unknown', () => {
    const single = analyzeChord([note(60)]);
    expect(single.status).toBe('incomplete');
    expect(single.chord?.spelling).toBe('C5');

    const cluster = analyzeChord([note(60), note(61), note(62), note(63)]);
    expect(cluster.status).toBe('unknown');
    expect(cluster.confidence).toBeLessThanOrEqual(20);

    expect(analyzeChord([]).status).toBe('unknown');
    expect(analyzeChord([]).chord).toBeNull();
    expect(analyzeChord([]).confidence).toBe(0);
  });

  it('invalid notes are ignored and counted', () => {
    const a = analyzeChord([
      note(60), note(64), note(67),
      { ...note(60), midi: 128 },          // out of range
      { ...note(64), velocity: 0 },        // note-off, not a sound
      { ...note(67), durationTicks: 0 },   // degenerate
    ]);
    expect(a.ignoredNoteCount).toBe(3);
    expect(a.chord?.spelling).toBe('C');
  });

  it('missing chord tones keep the honest reading and list what is absent', () => {
    const a = analyzeChord([note(60), note(64), note(67), note(72)]); // C E G + doubled C
    expect(a.chord?.spelling).toBe('C');

    const noFifth = analyzeChord([note(60), note(64)]);
    expect(noFifth.status).toBe('incomplete');
    expect(noFifth.chord?.spelling).toBe('C');
    expect(noFifth.missingPitchClasses).toEqual([7]);
  });

  it('key context and neighboring chords only break ties, never hide contests', () => {
    const key = keyOf(9, 'Aeolian'); // A minor
    const a = analyzeChord([note(57), note(60), note(64), note(67)], {
      projectKey: key,
      previousChord: chordOf('Dm'),
    });
    expect(a.status).toBe('ambiguous'); // C6/A still contests Am7
    expect(a.chord?.spelling).toBe('Am7');
  });
});

describe('parseChordFromClip / parseChordClipView', () => {
  it('collects notes overlapping the clip window and clamps partial overlap', () => {
    const a = parseChordFromClip({
      startTime: 3840,
      lengthTicks: 1920,
      notes: [
        note(60, 3840, 960), note(64, 4800, 960), note(67, 5280, 960), // inside
        note(72, 3360, 960), // spills in from before (overlap 3360–4320 → 480 ticks inside)
        note(76, 7680, 960), // entirely after the window
      ],
    });
    expect(a.status).toBe('clear');
    expect(a.chord?.spelling).toBe('C');
    expect(a.window).toEqual({ startTick: 3840, endTick: 5760 });
  });

  it('parses a MIDI-backed chord-lane clip view end to end', () => {
    const clip = {
      id: 'c2',
      startTime: 3840,
      lengthTicks: 3840,
      chord: chordOf('Am7'),
      rawMidiNotes: [note(57, 3840, 1920), note(60, 3840, 1920), note(64, 3840, 1920), note(67, 3840, 1920)],
      confidence: 0.8,
      alternativeInterpretations: [],
      metadata: {},
    };
    const a = parseChordClipView(clip, { projectKey: keyOf(9, 'Aeolian') });
    expect(a.chord?.spelling).toBe('Am7');
    expect(a.confidence).toBeGreaterThanOrEqual(0);
    expect(a.confidence).toBeLessThanOrEqual(100);
  });
});

describe('CHORD_TEMPLATES — derived from the shared grammar', () => {
  it('covers the spec template set and round-trips through parseChord', () => {
    const suffixes = CHORD_TEMPLATES.map((t) => t.suffix);
    for (const s of ['', 'm', 'dim', 'aug', 'sus2', 'sus4', '7', 'maj7', 'm7', 'add9', '6', 'm6']) {
      expect(suffixes).toContain(s);
    }
    for (const t of CHORD_TEMPLATES) {
      expect(chordFromSymbol(`C${t.suffix}`).ok, `C${t.suffix}`).toBe(true);
      expect(t.pcs[0]).toBe(0); // stacked from the root
    }
    expect(CHORD_TEMPLATES.find((t) => t.suffix === '')?.pcs).toEqual([0, 4, 7]);
    expect(CHORD_TEMPLATES.find((t) => t.suffix === '7')?.pcs).toEqual([0, 4, 7, 10]);
  });
});
