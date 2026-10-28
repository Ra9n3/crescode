/**
 * Harmony vocabulary engine tests (Phase 1 spec §12).
 *
 * Covers: all 12 modes (incl. 6- and 8-note symmetrical scales), all 144
 * tonic/mode combinations with parser round-trip verification, the D Dorian
 * vocabulary, derived modal characteristic tones, symmetrical-scale handling,
 * chromatic/parallel-mode analysis, chord relationships, determinism, and a
 * manual-workflow regression smoke over the real project fixture.
 */
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import {
  analyzeChordInMode, analyzeChordRelationship,
  getCharacteristicTones, getChordVocabulary, getScalePitchClasses, isSymmetricScale,
} from '../src/engine/harmony';
import { MODE_NAMES } from '../src/shared/schema/modes';
import { parseChord } from '../src/shared/schema/chords';
import { projectFromFixture, validateProject } from '../src/shared/schema';

const ALL_TONICS = Array.from({ length: 12 }, (_, i) => i);
const asSet = (pcs: number[]) => new Set(pcs);

describe('scale construction for all 12 modes (Test 1)', () => {
  it('returns the correct pitch classes for every mode from tonic D', () => {
    // Degree order (ascending intervals from the tonic), NOT sorted — the
    // order is what makes scaleDegree meaningful. D Dorian is D E F G A B C.
    const expected: Record<string, number[]> = {
      'Ionian': [2, 4, 6, 7, 9, 11, 1],
      'Dorian': [2, 4, 5, 7, 9, 11, 0],
      'Phrygian': [2, 3, 5, 7, 9, 10, 0],
      'Lydian': [2, 4, 6, 8, 9, 11, 1],
      'Mixolydian': [2, 4, 6, 7, 9, 11, 0],
      'Aeolian': [2, 4, 5, 7, 9, 10, 0],
      'Locrian': [2, 3, 5, 7, 8, 10, 0],
      'Harmonic Minor': [2, 4, 5, 7, 9, 10, 1],
      'Melodic Minor': [2, 4, 5, 7, 9, 11, 1],
      'Whole Tone': [2, 4, 6, 8, 10, 0],
      'Diminished (Half-Whole)': [2, 3, 5, 6, 8, 9, 11, 0],
      'Diminished (Whole-Half)': [2, 4, 5, 7, 8, 10, 11, 1],
    };
    expect(Object.keys(expected).sort()).toEqual([...MODE_NAMES].sort());
    for (const mode of MODE_NAMES) {
      expect(getScalePitchClasses('D', mode), mode).toEqual(expected[mode]);
    }
    // D Dorian: degree 3 of D Dorian is F (pc 5) — the minor third.
    expect(getScalePitchClasses('D', 'Dorian')[2]).toBe(5);
  });

  it('never assumes seven degrees: Whole Tone has 6, Diminished scales have 8', () => {
    for (const mode of MODE_NAMES) {
      const size = getScalePitchClasses(0, mode).length;
      if (mode === 'Whole Tone') expect(size, mode).toBe(6);
      else if (mode.startsWith('Diminished')) expect(size, mode).toBe(8);
      else expect(size, mode).toBe(7);
    }
  });

  it('flags exactly the three symmetrical modes', () => {
    for (const mode of MODE_NAMES) {
      const symmetric = isSymmetricScale(getScalePitchClasses(0, mode));
      expect(symmetric, mode).toBe(
        mode === 'Whole Tone' || mode === 'Diminished (Half-Whole)' || mode === 'Diminished (Whole-Half)',
      );
    }
  });
});

describe('vocabulary across all 144 tonic/mode combinations (Test 2)', () => {
  it('produces valid, parser-compatible, duplicate-free candidates everywhere', () => {
    for (const tonic of ALL_TONICS) {
      for (const mode of MODE_NAMES) {
        const label = `${tonic}/${mode}`;
        const v = getChordVocabulary({ root: tonic, mode });
        expect(v.candidates.length, label).toBeGreaterThan(0);
        expect(v.symmetric, label).toBe(isSymmetricScale(v.scalePitchClasses));
        // Characteristic tones are scale tones.
        for (const ct of v.characteristicTones) expect(v.scalePitchClasses, label).toContain(ct);
        // Symmetrical modes carry no characteristic tones (ambiguity explicit).
        if (v.symmetric) expect(v.characteristicTones, label).toEqual([]);

        const structureKeys = new Set<string>();
        const symbols = new Set<string>();
        for (const c of v.candidates) {
          // Valid pitch classes, root present, sorted ascending, unique.
          expect(c.rootPc, label).toBeGreaterThanOrEqual(0);
          expect(c.rootPc, label).toBeLessThanOrEqual(11);
          expect(v.scalePitchClasses, label).toContain(c.rootPc);
          expect(c.isDiatonic, `${label} ${c.symbol}`).toBe(true);
          for (const p of c.pitchClasses) {
            expect(p, `${label} ${c.symbol}`).toBeGreaterThanOrEqual(0);
            expect(p, `${label} ${c.symbol}`).toBeLessThanOrEqual(11);
            expect(v.scalePitchClasses, `${label} ${c.symbol}`).toContain(p);
          }
          expect(new Set(c.pitchClasses).size, `${label} ${c.symbol}`).toBe(c.pitchClasses.length);
          expect([...c.pitchClasses], `${label} ${c.symbol}`).toEqual(
            [...c.pitchClasses].sort((a, b) => a - b),
          );
          // Positional facts consistent.
          expect(c.scaleDegree, `${label} ${c.symbol}`).toBe(v.scalePitchClasses.indexOf(c.rootPc) + 1);
          expect(c.tonicRelationship, `${label} ${c.symbol}`).toBe(((c.rootPc - tonic) % 12 + 12) % 12);
          expect(c.characteristicToneCoverage, `${label} ${c.symbol}`).toBeGreaterThanOrEqual(0);
          expect(c.characteristicToneCoverage, `${label} ${c.symbol}`).toBeLessThanOrEqual(1);
          // No accidental duplicates.
          const key = `${c.rootPc}:${c.structureId}`;
          expect(structureKeys.has(key), `${label} duplicate ${key}`).toBe(false);
          structureKeys.add(key);
          expect(symbols.has(c.symbol), `${label} duplicate symbol ${c.symbol}`).toBe(false);
          symbols.add(c.symbol);
          // Parser round-trip: symbol parses and preserves pitch-class content.
          const parsed = parseChord(c.symbol);
          expect(parsed.ok, `${label} ${c.symbol} must parse`).toBe(true);
          if (parsed.ok) {
            expect(asSet(parsed.chord.pitchClasses), `${label} ${c.symbol}`).toEqual(asSet(c.pitchClasses));
            expect(parsed.chord.root, `${label} ${c.symbol}`).toBe(c.rootPc);
          }
        }
      }
    }
  });
});

describe('D Dorian vocabulary (Test 3)', () => {
  const v = getChordVocabulary({ root: 'D', mode: 'Dorian' });

  it('discovers the diatonic triads algorithmically', () => {
    const triads = v.candidates.filter((c) => c.pitchClasses.length === 3).map((c) => c.symbol);
    for (const s of ['Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C']) expect(triads, s).toContain(s);
    expect(triads.sort()).toEqual([
      'Am', 'Asus2', 'Asus4', 'Bdim', 'C', 'Csus2', 'Csus4',
      'Dm', 'Dsus2', 'Dsus4', 'Em', 'Esus4', 'F', 'Fsus2',
      'G', 'Gsus2', 'Gsus4',
    ]);
  });

  it('discovers the diatonic seventh chords', () => {
    const sevenths = v.candidates.filter((c) => c.pitchClasses.length === 4).map((c) => c.symbol);
    for (const s of ['Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bm7b5', 'Cmaj7']) {
      expect(sevenths, s).toContain(s);
    }
    expect(sevenths.sort()).toEqual(['Am7', 'Bm7b5', 'Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7']);
  });

  it('rejects chords that leave the scale (no hardcoded tables)', () => {
    const symbols = new Set(v.candidates.map((c) => c.symbol));
    expect(symbols.has('D')).toBe(false); // D major needs F#, not in D Dorian
    expect(symbols.has('A7')).toBe(false); // A7 needs C#
    expect(symbols.has('DmMaj7')).toBe(false); // needs G#
  });
});

describe('modal characteristic tones (Test 4)', () => {
  it('identifies the characteristic pitch classes derived from nearest relatives', () => {
    // D Dorian -> B natural (pc 11); also C natural: Dorian vs its other
    // nearest relative (Melodic Minor) differs by the natural seventh.
    expect(getCharacteristicTones('D', 'Dorian')).toEqual([0, 11]);
    // Phrygian has TWO nearest relatives (Aeolian and Locrian, symmetric
    // difference 2 each): b2 (Eb, vs Aeolian) and the perfect fifth (A, the
    // tone Locrian lacks). Both are derived facts, not preferences.
    expect(getCharacteristicTones('D', 'Phrygian')).toEqual([3, 9]);
    expect(getCharacteristicTones('D', 'Lydian')).toEqual([8]); // G#, the #4
    expect(getCharacteristicTones('D', 'Mixolydian')).toEqual([0]); // C natural, the b7
    expect(getCharacteristicTones('D', 'Locrian')).toEqual([8]); // Ab, the b5
    // Harmonic Minor: raised 7th vs natural minor (C#) plus the b6 that
    // separates it from Melodic Minor.
    expect(getCharacteristicTones('D', 'Harmonic Minor')).toEqual([1, 10]);
    // Melodic Minor: raised 6th AND 7th relative to natural minor.
    expect(getCharacteristicTones('D', 'Melodic Minor')).toEqual([1, 11]);
  });

  it('is tonic-relative: the same derivation transfers to any key', () => {
    // C Dorian: A natural (9) is the characteristic major sixth.
    expect(getCharacteristicTones('C', 'Dorian')).toEqual([9, 10]);
    expect(getCharacteristicTones('Ab', 'Lydian')).toEqual([2]); // D natural, the #4 of Ab
  });

  it('gives symmetrical scales none, explicitly', () => {
    for (const mode of ['Whole Tone', 'Diminished (Half-Whole)', 'Diminished (Whole-Half)'] as const) {
      expect(getCharacteristicTones('D', mode), mode).toEqual([]);
    }
  });

  it('feeds coverage on candidates (G major in D Dorian carries B natural)', () => {
    const v = getChordVocabulary({ root: 'D', mode: 'Dorian' });
    const gMajor = v.candidates.find((c) => c.symbol === 'G')!;
    expect(gMajor.characteristicToneCoverage).toBe(0.5); // B present, C not in triad
    expect(gMajor.harmonicCharacteristics).toContain('contains-characteristic-tones');
    const dMinor = v.candidates.find((c) => c.symbol === 'Dm')!;
    expect(dMinor.characteristicToneCoverage).toBe(0);
    expect(dMinor.harmonicCharacteristics).toContain('tonic-root');
  });
});

describe('symmetrical scales (Test 5)', () => {
  it('Whole Tone yields only augmented triads and altered dominants', () => {
    const v = getChordVocabulary({ root: 'C', mode: 'Whole Tone' });
    expect(v.symmetric).toBe(true);
    expect(v.scalePitchClasses).toHaveLength(6);
    const ids = new Set(v.candidates.map((c) => c.structureId));
    expect([...ids].sort()).toEqual(['augmented', 'augmented7', 'dominant7b5']);
    const augs = v.candidates.filter((c) => c.structureId === 'augmented');
    expect(augs.map((c) => c.symbol).sort())
      .toEqual(['Abaug', 'Bbaug', 'Caug', 'Daug', 'Eaug', 'F#aug']);
    for (const c of v.candidates) expect(c.harmonicCharacteristics).toContain('non-tonal-context');
  });

  it('Diminished Half-Whole yields four dominant sevenths a minor third apart', () => {
    const v = getChordVocabulary({ root: 'C', mode: 'Diminished (Half-Whole)' });
    expect(v.scalePitchClasses).toHaveLength(8);
    const dom7 = v.candidates.filter((c) => c.structureId === 'dominant7').map((c) => c.symbol);
    expect(dom7.sort()).toEqual(['A7', 'C7', 'Eb7', 'F#7']);
    // Fully diminished sevenths on every scale tone (octatonic property).
    const dim7 = v.candidates.filter((c) => c.structureId === 'diminished7');
    expect(dim7).toHaveLength(8);
  });

  it('Diminished Whole-Half yields fully diminished sevenths plus dominant sonorities', () => {
    const v = getChordVocabulary({ root: 'C', mode: 'Diminished (Whole-Half)' });
    expect(v.scalePitchClasses).toHaveLength(8);
    expect(v.candidates.filter((c) => c.structureId === 'diminished7')).toHaveLength(8);
    const dom7 = v.candidates.filter((c) => c.structureId === 'dominant7').map((c) => c.symbol);
    expect(dom7.sort()).toEqual(['Ab7', 'B7', 'D7', 'F7']);
    // Minor sevenths a minor third apart are discovered too (Dm7, Fm7, Abm7, Bm7).
    const m7 = v.candidates.filter((c) => c.structureId === 'minor7').map((c) => c.symbol);
    expect(m7.sort()).toEqual(['Abm7', 'Bm7', 'Dm7', 'Fm7']);
  });
});

describe('chromatic analysis and parallel modes (Test 6)', () => {
  it('identifies Bbmaj7 in D Dorian as non-diatonic and discovers its parallel homes', () => {
    const a = analyzeChordInMode('Bbmaj7', { root: 'D', mode: 'Dorian' });
    expect(a.isDiatonic).toBe(false);
    expect(a.nonDiatonicPitchClasses).toEqual([10]); // Bb is the only outside tone
    expect(a.pitchClasses).toEqual([2, 5, 9, 10]);
    expect(a.quality).toBe('maj7');
    expect(a.rootPc).toBe(10);
    expect(a.scaleDegree).toBeNull();
    expect(a.tonicRelationship).toBe(8);
    expect(a.tonicChordSharedPitchClasses).toEqual([2, 5, 9]); // shares the Dm tonic triad
    // Discovered by pitch-class comparison, never hardcoded: Bbmaj7 belongs
    // entirely to D Phrygian, D Aeolian and D Harmonic Minor.
    expect(a.parallelModesContaining).toEqual(['Phrygian', 'Aeolian', 'Harmonic Minor']);
  });

  it('describes diatonic chords with full positional facts', () => {
    const a = analyzeChordInMode('G7', { root: 'D', mode: 'Dorian' });
    expect(a.isDiatonic).toBe(true);
    expect(a.nonDiatonicPitchClasses).toEqual([]);
    expect(a.scaleDegree).toBe(4);
    expect(a.characteristicTonesPresent).toEqual([11]); // carries B natural
    expect(a.characteristicToneCoverage).toBe(0.5);
    expect(a.tonicChordSharedPitchClasses).toEqual([2, 5]);
    // G7 also fits D Melodic Minor and D Diminished (Whole-Half) — objective
    // facts discovered by pitch-class comparison, not a rule.
    expect(a.parallelModesContaining)
      .toEqual(['Dorian', 'Melodic Minor', 'Diminished (Whole-Half)']);
  });

  it('accepts pitch-class tonics and slash chords', () => {
    const a = analyzeChordInMode('C/E', { root: 2, mode: 'Dorian' });
    expect(a.isDiatonic).toBe(true); // bass E is a scale tone and counted
    expect(a.pitchClasses).toEqual([0, 4, 7]);
    expect(a.rootPc).toBe(0);
  });
});

describe('chord relationships (Test 7)', () => {
  it('describes root motion, common tones and pitch-class changes', () => {
    const r = analyzeChordRelationship('Dm', 'G7');
    expect(r.rootInterval).toBe(5);
    expect(r.sharedPitchClasses).toEqual([2, 5]);
    expect(r.commonToneCount).toBe(2);
    expect(r.addedPitchClasses).toEqual([7, 11]);
    expect(r.removedPitchClasses).toEqual([9]);
    expect(r.qualitiesDiffer).toBe(true);
    expect(r.semitoneRelationships).toEqual([]); // whole-step motion only
  });

  it('finds one-semitone resolution points (E7 -> Am)', () => {
    const r = analyzeChordRelationship('E7', 'Am');
    expect(r.semitoneRelationships).toEqual([
      { from: 8, to: 9 }, // G# -> A
      { from: 11, to: 0 }, // B -> C
    ]);
  });

  it('recognises identical and enharmonically equivalent chords', () => {
    const same = analyzeChordRelationship('Dm7', 'Dm7');
    expect(same.identical).toBe(true);
    expect(same.enharmonicallyEquivalent).toBe(false);
    expect(same.commonToneCount).toBe(4);
    expect(same.qualitiesDiffer).toBe(false);
    expect(same.rootInterval).toBe(0);

    // Bdim7 and Ddim7 share all four pitch classes under different roots.
    const twin = analyzeChordRelationship('Bdim7', 'Ddim7');
    expect(twin.identical).toBe(false);
    expect(twin.enharmonicallyEquivalent).toBe(true);
    expect(twin.rootInterval).toBe(3);
    expect(twin.commonToneCount).toBe(4);

    // Spelling variants of the same root are identical, not merely enharmonic.
    const spelled = analyzeChordRelationship('C#m7', 'Dbm7');
    expect(spelled.identical).toBe(true);
    expect(spelled.enharmonicallyEquivalent).toBe(false);
  });

  it('reports quality differences without grading them', () => {
    expect(analyzeChordRelationship('C', 'Cm').qualitiesDiffer).toBe(true);
    expect(analyzeChordRelationship('C', 'Cmaj').qualitiesDiffer).toBe(false);
  });
});

describe('determinism (Test 8)', () => {
  it('produces byte-identical output for identical inputs', () => {
    const contexts = [
      { root: 'D', mode: 'Dorian' },
      { root: 6, mode: 'Diminished (Half-Whole)' },
      { root: 'Ab', mode: 'Melodic Minor' },
      { root: 10, mode: 'Whole Tone' },
    ] as const;
    for (const ctx of contexts) {
      expect(JSON.stringify(getChordVocabulary(ctx)))
        .toBe(JSON.stringify(getChordVocabulary(ctx)));
      expect(JSON.stringify(analyzeChordInMode('Bbmaj7', ctx)))
        .toBe(JSON.stringify(analyzeChordInMode('Bbmaj7', ctx)));
    }
    const r1 = analyzeChordRelationship('Dm7', 'G7');
    const r2 = analyzeChordRelationship('Dm7', 'G7');
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('resolves note-name and pitch-class tonics to the same vocabulary', () => {
    expect(JSON.stringify(getChordVocabulary({ root: 'D', mode: 'Dorian' })))
      .toBe(JSON.stringify(getChordVocabulary({ root: 2, mode: 'Dorian' })));
    expect(JSON.stringify(getChordVocabulary({ root: 'Eb', mode: 'Phrygian' })))
      .toBe(JSON.stringify(getChordVocabulary({ root: 3, mode: 'Phrygian' })));
  });
});

describe('manual workflow regression (Test 9)', () => {
  it('analyzes the real project fixture without altering or restricting it', () => {
    const project = projectFromFixture(fixture);
    expect(validateProject(project).ok).toBe(true);
    expect(project.chords.length).toBe(18);

    const nonDiatonic: string[] = [];
    for (const chord of project.chords) {
      // Manual entry stays unrestricted: every existing project chord parses
      // and analyzes regardless of diatonicity. Nothing is mutated.
      const parsed = parseChord(chord.symbol);
      expect(parsed.ok, chord.symbol).toBe(true);
      const a = analyzeChordInMode(chord.symbol, { root: project.key, mode: project.mode });
      expect(a.symbol).toBe(chord.symbol);
      if (!a.isDiatonic) nonDiatonic.push(chord.symbol);
    }
    // The fixture deliberately contains exactly one chromatic chord.
    expect(nonDiatonic).toEqual(['Bbmaj7']);
  });

  it('never polices unconventional chromatic chords', () => {
    // A user may enter anything; the analyzer only describes it.
    const wild = analyzeChordInMode('C7b9#11', { root: 'D', mode: 'Dorian' });
    expect(wild.isDiatonic).toBe(false);
    expect(wild.nonDiatonicPitchClasses).toEqual([1, 6, 10]); // Db, F#, Bb outside
    expect(wild.parallelModesContaining).toEqual([]); // no mode contains it — stated, not forbidden
  });
});
