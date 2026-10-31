/**
 * Key-change transposition — the whole chord track follows the project key.
 *
 * When the user changes the project's TONIC, every chord on the chord track
 * is transformed to the corresponding chord of the new key: the root keeps
 * its interval from the tonic (same scale degree), the quality/extension
 * text is preserved verbatim, and the new spelling is chosen idiomatically
 * for the NEW key (C major → E major turns C→E, Dm→F#m, G7→B7, Am→C#m,
 * Bdim→D#dim). Slash basses shift by the same interval (C/E → E/G#), and the
 * Chords track's MIDI notes shift with the symbols so voicings, analysis and
 * playback stay consistent with the names.
 *
 * Design notes:
 *  - INTERVAL, not degree re-mapping: transposing by (newTonic − oldTonic)
 *    preserves every chord's quality and is exactly reversible (change the
 *    key back and the original spellings AND octaves return). Re-deriving
 *    qualities from scale degrees would silently rewrite borrowed material
 *    (a G7 would stop being a G7) — that is a reharmonization, not a
 *    transposition, and is deliberately NOT what happens here. The interval
 *    is the SHORTEST signed one (−5..+6: C→E is +4, C→B is −1), so pitch
 *    octaves never creep on key round trips. Changing the MODE alone keeps
 *    every chord as it is (interval 0).
 *  - Spelling: the new root/bass pitch class takes the new key's own
 *    diatonic spelling when it is in the scale (pc 6 in E major → "F#"),
 *    otherwise it follows the key's accidental side (F#7 into E major becomes
 *    A#7, not Bb7). All spelling decisions are normalizeChord's — one music
 *    theory in crescode, never two.
 *  - Unparseable symbols (a mid-edit chord, or text the grammar rejects) are
 *    left untouched and simply not counted.
 *  - Everything here is pure and host-free: the store applies the returned
 *    project as ONE undoable edit, so a single Ctrl+Z restores both the old
 *    key and the old chords.
 */
import { parseChord, type Chord, type Note, type PitchClass, type Project } from '../../shared/schema';
import { normalizeChord } from './normalize';
import { projectKeyOf } from './model';
import type { NoteName, ProjectKey } from './types';

/** Sharp-side canonical name per pitch class — the input normalizeChord
 *  re-spells for the key (a diatonic degree takes the key's own spelling,
 *  a chromatic one follows the key's accidental side). */
const CANONICAL_PC_NAME: Record<PitchClass, NoteName> = {
  0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F',
  6: 'F#', 7: 'G', 8: 'G#', 9: 'A', 10: 'A#', 11: 'B',
};

const mod12 = (v: number): PitchClass => (((v % 12) + 12) % 12) as PitchClass;

/** Key-idiomatic spelling of a pitch class (normalizeChord never throws on
 *  these canonical inputs). */
const spellPc = (pc: PitchClass, key: ProjectKey): NoteName => normalizeChord(CANONICAL_PC_NAME[pc], key);

/**
 * Transpose one chord symbol by `interval` semitones, spelled for `key`.
 * The quality/extension text between root and slash bass survives verbatim
 * ("Dm7b5" → "F#m7b5"); root and slash bass re-spell for the new key.
 * Returns null when the symbol is unparseable or the rebuilt string fails
 * the shared grammar (the caller keeps the original) — a transposed symbol
 * can never be one parseChord rejects.
 */
export function transposeChordSymbol(symbol: string, interval: number, key: ProjectKey): string | null {
  const parsed = parseChord(symbol);
  if (!parsed.ok) return null;
  const c = parsed.chord;
  // The text between the root and the (optional) "/bass" is the quality and
  // any extensions, exactly as the user wrote them — preserved untouched.
  const end = c.bassName !== null ? c.symbol.length - c.bassName.length - 1 : c.symbol.length;
  const qualityText = c.symbol.slice(c.rootName.length, end);
  const root = spellPc(mod12(c.root + interval), key);
  const rebuilt = c.bass !== null && c.bassName !== null
    ? `${root}${qualityText}/${spellPc(mod12(c.bass + interval), key)}`
    : `${root}${qualityText}`;
  return parseChord(rebuilt).ok ? rebuilt : null;
}

export interface KeyTransposeResult {
  /** The project with the new tonic — and, when the tonic actually moved,
   *  transposed chord symbols and Chords-track notes. */
  project: Project;
  /** newTonic − oldTonic in semitones as the shortest signed interval
   *  (−5..+6; 0 = tonic unchanged). */
  interval: number;
  /** Chord symbols actually rewritten (parseable AND different). */
  changed: number;
}

const clampPitch = (p: number, interval: number): number => Math.max(0, Math.min(127, p + interval));

/**
 * The whole-track key change, as one pure project → project function:
 * every parseable chord symbol re-spells for the new tonic, the Chords
 * track's MIDI notes shift by the same interval (clamped to MIDI 0..127),
 * every other track is untouched, and the project key is set. With an
 * unchanged tonic the chords/notes are passed through by reference — only
 * the key field moves (mode-only changes transpose nothing).
 */
export function transposeProjectKey(project: Project, newTonic: PitchClass): KeyTransposeResult {
  const d = mod12(newTonic - project.key);
  const interval = d > 6 ? d - 12 : d; // shortest signed path — exact round trips
  if (interval === 0) return { project: { ...project, key: newTonic }, interval, changed: 0 };
  const key = projectKeyOf({ key: newTonic, mode: project.mode });
  let changed = 0;
  const chords: Chord[] = project.chords.map((c) => {
    const symbol = transposeChordSymbol(c.symbol, interval, key);
    if (symbol === null || symbol === c.symbol) return c;
    changed += 1;
    return { ...c, symbol };
  });
  const shiftNotes = (notes: Note[]): Note[] => notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch, interval) }));
  const tracks = project.tracks.map((t) => (t.role === 'chords' ? { ...t, notes: shiftNotes(t.notes) } : t));
  return { project: { ...project, key: newTonic, chords, tracks }, interval, changed };
}
