/**
 * Enharmonic equivalence engine (feature spec §2).
 *
 * Recognizes that C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb, Cb/B and E#/F (plus the
 * completing B#/C and Fb/E pairs) denote the same pitch class — via EXPLICIT
 * per-pitch-class tables only. There is no letter arithmetic and no single
 * global conversion rule anywhere in this module: every spelling↔pitch-class
 * fact is written out, so odd pairs (Cb=B, E#=F, B#=C, Fb=E) are first-class
 * citizens rather than edge cases of a formula.
 */
import type { PitchClass } from '../../shared/schema';
import type { NoteName } from './types';

/**
 * Every accepted spelling of each pitch class, written out in full.
 * Order within a row is the display preference for neutral contexts:
 * naturals first, then canon-mixed accidentals (Eb/Ab/Bb with F#/C# —
 * crescode canon, NOTE_NAMES), then the remaining cross-letter spellings.
 */
export const PITCH_CLASS_SPELLINGS: Record<PitchClass, readonly NoteName[]> = {
  0: ['C', 'B#'],
  1: ['C#', 'Db'],
  2: ['D'],
  3: ['D#', 'Eb'],
  4: ['E', 'Fb'],
  5: ['F', 'E#'],
  6: ['F#', 'Gb'],
  7: ['G'],
  8: ['G#', 'Ab'],
  9: ['A'],
  10: ['A#', 'Bb'],
  11: ['B', 'Cb'],
};

/** Every note name with its pitch class — the explicit reverse table. */
const NAME_TO_PITCH_CLASS: Readonly<Record<string, PitchClass>> = (() => {
  const table: Record<string, PitchClass> = {};
  for (const key of Object.keys(PITCH_CLASS_SPELLINGS)) {
    const pc = Number(key) as PitchClass; // Object.keys yields strings
    for (const name of PITCH_CLASS_SPELLINGS[pc]) table[name] = pc;
  }
  return table;
})();

/** Cross-letter spellings normalize to their natural partner in contexts
 *  where they are not the key's own diatonic spelling (normalize.ts). */
const NATURAL_PARTNER: Readonly<Record<string, NoteName>> = {
  'B#': 'C', Cb: 'B', 'E#': 'F', Fb: 'E',
};

export class EnharmonicEngine {
  /** Accepts ASCII and unicode accidentals ("c♯" → "C#", "db" → "Db").
   *  Returns null on anything that is not a single-accidental note name. */
  static normalizeInputName(name: string): NoteName | null {
    if (typeof name !== 'string') return null;
    const m = /^([A-Ga-g])(#|♯|b|♭)?$/.exec(name.trim());
    if (!m) return null;
    const accidental = m[2] === undefined ? '' : m[2] === '#' || m[2] === '♯' ? '#' : 'b';
    const candidate = `${m[1].toUpperCase()}${accidental}`;
    return candidate in NAME_TO_PITCH_CLASS ? (candidate as NoteName) : null;
  }

  static isValidNoteName(name: string): boolean {
    return EnharmonicEngine.normalizeInputName(name) !== null;
  }

  /** Explicit lookup — no arithmetic. Returns null for unknown names. */
  static pitchClassOf(name: string): PitchClass | null {
    const canon = EnharmonicEngine.normalizeInputName(name);
    return canon === null ? null : NAME_TO_PITCH_CLASS[canon];
  }

  /** All spellings of a pitch class (display-preference order). */
  static spellingsOf(pc: PitchClass): readonly NoteName[] {
    return PITCH_CLASS_SPELLINGS[pc];
  }

  /** The other names that denote the same pitch class ("C#" → ["Db"],
   *  "Cb" → ["B"], "E#" → ["F"]). Empty for unambiguous naturals like "D". */
  static partnersOf(name: string): NoteName[] {
    const canon = EnharmonicEngine.normalizeInputName(name);
    if (canon === null) return [];
    const pc = NAME_TO_PITCH_CLASS[canon];
    return PITCH_CLASS_SPELLINGS[pc].filter((n) => n !== canon);
  }

  static areEnharmonicEquivalents(a: string, b: string): boolean {
    const pa = EnharmonicEngine.pitchClassOf(a);
    const pb = EnharmonicEngine.pitchClassOf(b);
    return pa !== null && pb !== null && pa === pb;
  }

  /** True for B#/Cb/E#/Fb — spellings that jump across the natural letter
   *  and are therefore only idiomatic when the key itself demands them. */
  static isCrossAccidental(name: string): boolean {
    const canon = EnharmonicEngine.normalizeInputName(name);
    return canon !== null && canon in NATURAL_PARTNER;
  }

  /** "Cb" → "B", "E#" → "F". Input must be a cross-letter spelling. */
  static naturalPartnerOf(name: string): NoteName | null {
    const canon = EnharmonicEngine.normalizeInputName(name);
    return canon !== null && canon in NATURAL_PARTNER ? NATURAL_PARTNER[canon] : null;
  }

  /** True when the name carries ♯ or ♭ (after unicode folding). */
  static hasAccidental(name: string): boolean {
    const canon = EnharmonicEngine.normalizeInputName(name);
    return canon !== null && canon.length === 2;
  }
}
