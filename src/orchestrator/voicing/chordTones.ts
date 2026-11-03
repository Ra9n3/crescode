/**
 * Chord tones (spec §7.3 voicing input; work-order step 2b). Turns parseChord
 * output into pitch classes with a KEEP-priority order:
 *   bass (slash bass) → root (root position: the bass tier) → third →
 *   seventh → fifth → extensions.
 * With fewer voices than chord tones, voices drop tones from the tail of this
 * order first (extensions die before the fifth, the fifth before the seventh,
 * and with a slash bass the chord root is the last survivor upstairs). The
 * slash bass is a hard assignment: the LOWEST voice sings it.
 *
 * NOTE: the work order cites "Amendments v2 §7.3" for the covered vocabulary;
 * no such amendments document exists anywhere in the project, so this covers
 * the repo's real vocabulary — the full parseChord grammar (major/minor/dim/
 * aug/sus2/sus4/power/6/m6/6-9/7/maj7/m7/m7b5/dim7/mMaj7/aug7/7sus/9/11/13/
 * add-variants, optional-alteration extensions, no3/no5, slash bass).
 */
import type { ParsedChord } from '../../shared/schema/chords';

export type ToneTier = 'bass' | 'root' | 'third' | 'seventh' | 'fifth' | 'extension';

export interface ChordTone {
  pc: number;
  tier: ToneTier;
  /** Keep-priority: lower is kept longer. Bass tier is 0. */
  rank: number;
}

/** Classify one interval above the root. */
function tierOf(interval: number, hasThird: boolean, hasSeventh: boolean): ToneTier {
  switch (interval) {
    case 0: return 'root';
    case 3: case 4: return 'third';
    case 10: case 11: return 'seventh';
    case 6: case 7: case 8: return 'fifth'; // includes b5/#5 — still the fifth tier
    case 9: return hasSeventh ? 'extension' : 'seventh'; // a 6th chord's sixth is the colour seventh
    case 2: return hasThird ? 'extension' : 'third'; // sus2 replaces the third
    case 5: return hasThird ? 'extension' : 'third'; // sus4 replaces the third
    default: return 'extension'; // 9ths, 11ths, 13ths, alterations
  }
}

/** Ranks within the keep order. Bass keeps 0; everything else follows. */
const RANK_WITHOUT_SLASH: Record<ToneTier, number> = { bass: 0, root: 0, third: 1, seventh: 2, fifth: 3, extension: 4 };
const RANK_WITH_SLASH: Record<ToneTier, number> = { bass: 0, root: 5, third: 1, seventh: 2, fifth: 3, extension: 4 };

export interface ChordTones {
  /** Deduplicated pitch classes, KEEP-priority order (bass first). */
  tones: ChordTone[];
  /** The lowest-voice pitch class: the slash bass, else the root. */
  bassPc: number;
  /** True when the symbol carried an explicit slash bass. */
  hasSlashBass: boolean;
}

export function chordTones(parsed: ParsedChord): ChordTones {
  const hasThird = parsed.intervals.some((i) => i === 3 || i === 4);
  const hasSeventh = parsed.intervals.some((i) => i === 10 || i === 11);
  const ranks = parsed.bass !== null ? RANK_WITH_SLASH : RANK_WITHOUT_SLASH;

  const tones: ChordTone[] = [];
  const seen = new Set<number>();
  if (parsed.bass !== null) {
    seen.add(parsed.bass);
    tones.push({ pc: parsed.bass, tier: 'bass', rank: 0 });
  }
  for (const iv of parsed.intervals) {
    const pc = (parsed.root + iv) % 12;
    if (seen.has(pc)) continue; // first occurrence keeps its (more structural) tier
    seen.add(pc);
    tones.push({ pc, tier: tierOf(iv, hasThird, hasSeventh), rank: ranks[tierOf(iv, hasThird, hasSeventh)] });
  }
  tones.sort((a, b) => a.rank - b.rank);
  return { tones, bassPc: parsed.bass ?? parsed.root, hasSlashBass: parsed.bass !== null };
}

/** The n tones that survive when only n voices are available (keep order). */
export const keepTones = (t: ChordTones, n: number): ChordTone[] => t.tones.slice(0, Math.max(0, n));
