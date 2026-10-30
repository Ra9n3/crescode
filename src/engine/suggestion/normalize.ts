/**
 * Key-idiomatic enharmonic normalization (feature spec §3).
 *
 * normalizeChord(root, projectKey) picks the most idiomatic spelling of a
 * chord root for the project's key, WITHOUT ever changing the pitch class:
 *
 *  1. Invalid names throw SuggestionError('invalid-chord-name').
 *  2. Naturals are always preserved (B natural in F major is a Lydian #4,
 *     not a mistyped Bb).
 *  3. If the key's scale contains the pitch class, the key's own diatonic
 *     spelling of that degree wins (Db → C# in D major; A# → Bb in F major;
 *     Cb → B in C major). This also covers cross-letter spellings, which are
 *     preserved only when the key itself spells the degree that way (Cb is
 *     the tonic of Cb major, B# the 7th of C# major).
 *  4. Chromatic pitch classes first check the raised-leading-tone slot —
 *     pc == tonic−1 in a minor-type key keeps its sharp spelling (C# stays
 *     C# in D minor even though the signature prefers flats).
 *  5. Remaining chromatic notes follow the key's accidental side: sharp
 *     keys prefer sharps, flat keys prefer flats (C# → Db in Eb major);
 *     neutral keys (and non-heptatonic modes) preserve the explicit input.
 *
 * Policy note: a pitch class the key's scale contains always takes the key's
 * own spelling of that degree (Db → C# in D major, Gb → F# in G major); a
 * chromatic pitch class follows the key's accidental side and is preserved
 * when it already matches (C# stays C# in G major — the raised fourth keeps
 * its spelling). Per-chord context respelling is a later concern.
 */
import type { PitchClass } from '../../shared/schema';
import { IONIAN_STEPS, PARENT_MAJOR_DEGREE } from './model';
import { EnharmonicEngine } from './enharmonic';
import { SuggestionError, type NoteName, type ProjectKey } from './types';

/** Conventional major-key spelling of each root pitch class (pc 1 → "Db",
 *  matching the flat-side signature that FIFTHS_OF_MAJOR_ROOT assigns it). */
const MAJOR_ROOT_LETTER_NAME: Readonly<Record<PitchClass, NoteName>> = {
  0: 'C', 1: 'Db', 2: 'D', 3: 'Eb', 4: 'E', 5: 'F',
  6: 'F#', 7: 'G', 8: 'Ab', 9: 'A', 10: 'Bb', 11: 'B',
};

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

const mod12 = (v: number): PitchClass => (((v % 12) + 12) % 12) as PitchClass;

/** Explicit per-pitch-class preferences for sharp-side and flat-side keys.
 *  Only the five pitch classes with a sharp/flat pair appear; every other
 *  chromatic spelling keeps its input form (naturals and cross-letter
 *  spellings are handled by their own rules). */
const SHARP_PREFERENCE: Partial<Record<PitchClass, NoteName>> = {
  1: 'C#', 3: 'D#', 6: 'F#', 8: 'G#', 10: 'A#',
};
const FLAT_PREFERENCE: Partial<Record<PitchClass, NoteName>> = {
  1: 'Db', 3: 'Eb', 6: 'Gb', 8: 'Ab', 10: 'Bb',
};

export type AccidentalPreference = 'sharps' | 'flats' | 'neutral';

/**
 * The key's diatonic spelling per pitch class, e.g. D major →
 * { 2:'D', 4:'E', 6:'F#', 7:'G', 9:'A', 11:'B', 1:'C#' }.
 * Derived from the parent major (heptatonic modes only; null otherwise).
 */
export function diatonicSpellingMap(key: ProjectKey): Partial<Record<PitchClass, NoteName>> | null {
  const degree = PARENT_MAJOR_DEGREE[key.mode];
  if (degree === undefined) return null;
  const parentRoot = mod12(key.tonic - IONIAN_STEPS[degree]);
  const parentLetterIdx = LETTERS.indexOf(MAJOR_ROOT_LETTER_NAME[parentRoot][0] as (typeof LETTERS)[number]);
  const map: Partial<Record<PitchClass, NoteName>> = {};
  for (let d = 0; d < 7; d++) {
    const pc = mod12(parentRoot + IONIAN_STEPS[d]);
    const letter = LETTERS[(parentLetterIdx + d) % 7];
    const spelling = EnharmonicEngine.spellingsOf(pc as PitchClass).find((n) => n[0] === letter);
    if (spelling !== undefined) map[pc as PitchClass] = spelling;
  }
  return map;
}

/** Which accidental side the key's own scale lives on ("1 sharp" → sharps,
 *  "3 flats" → flats, "no accidentals" → neutral). Non-heptatonic modes are
 *  neutral. ProjectKey.spelling is crescode's display canon ('mixed') and
 *  does not override the signature — the spec's sharp/flat rules come from
 *  the key itself. */
export function keyAccidentalPreference(key: ProjectKey): AccidentalPreference {
  const map = diatonicSpellingMap(key);
  if (map === null) return 'neutral';
  let accidentals = 0;
  for (const spelling of Object.values(map)) {
    if (spelling === undefined) continue;
    if (spelling.includes('#')) accidentals += 1;
    if (spelling.includes('b')) accidentals -= 1;
  }
  return accidentals > 0 ? 'sharps' : accidentals < 0 ? 'flats' : 'neutral';
}

/**
 * The most idiomatic spelling of `root` for the project key.
 * Never changes the pitch class; preserves valid explicit spellings unless
 * they are inconsistent with the key signature (see module doc).
 */
export function normalizeChord(root: string, projectKey: ProjectKey): NoteName {
  const canon = EnharmonicEngine.normalizeInputName(root);
  if (canon === null) {
    throw new SuggestionError('invalid-chord-name', `"${String(root)}" is not a valid note name`);
  }
  const pc = EnharmonicEngine.pitchClassOf(canon) as PitchClass;

  // Naturals are always valid, in every key.
  if (!EnharmonicEngine.hasAccidental(canon)) return canon;

  const map = diatonicSpellingMap(projectKey);
  if (map !== null) {
    const keySpelling = map[pc];
    // The pitch class is diatonic: the key's own spelling of that degree wins
    // (Db→C# in D major; Cb→B in C major; preserved when already idiomatic).
    if (keySpelling !== undefined) return keySpelling;

    // Raised leading tone (pc = tonic−1, chromatic): keep its sharp-side
    // spelling — C# stays C# over a D-minor signature (Bb), B stays B in C minor.
    const leadingTonePc = mod12(projectKey.tonic + 11);
    if (pc === leadingTonePc) {
      const tonicSpelling = map[projectKey.tonic];
      if (tonicSpelling !== undefined) {
        const tonicLetterIdx = LETTERS.indexOf(tonicSpelling[0] as (typeof LETTERS)[number]);
        const leadingToneLetter = LETTERS[(tonicLetterIdx + 6) % 7];
        const lt = EnharmonicEngine.spellingsOf(pc).find((n) => n[0] === leadingToneLetter);
        if (lt !== undefined) return lt;
      }
    }
  }

  // Cross-letter spellings outside the key's own usage normalize to naturals.
  if (EnharmonicEngine.isCrossAccidental(canon)) {
    return EnharmonicEngine.naturalPartnerOf(canon) as NoteName;
  }

  const preference = keyAccidentalPreference(projectKey);
  if (preference === 'sharps') return SHARP_PREFERENCE[pc] ?? canon;
  if (preference === 'flats') return FLAT_PREFERENCE[pc] ?? canon;
  return canon; // neutral key: preserve the explicit spelling
}
