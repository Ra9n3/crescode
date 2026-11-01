/**
 * Key/mode changes — the whole chord track follows the project key.
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
 * When the user changes the MODE (tonic stays), "the corresponding chord in
 * the new mode" is the chord's scale degree re-rendered diatonically:
 * transformProjectMode keeps the degree, re-spells the root as the new
 * mode's scale tone there, and re-derives the core quality from the new
 * mode's own stack of thirds (C Ionian → C Aeolian turns C→Cm, Dm→Ddim,
 * Em→Eb, G7→Gm7, Am→Ab, Bdim→Bb). A chord with a third re-derives its core
 * (triad, or seventh when it had one) and keeps its color tones (6/9/11/13,
 * addX, explicit alterations) verbatim; sus/power chords have no third to
 * re-derive, so their text is kept and only the root follows the degree.
 * Roots that are chromatic in the OLD mode are borrowed material — exactly
 * the stuff degree re-mapping cannot name — so they are left untouched.
 *
 * Design notes:
 *  - TONIC changes are INTERVAL, not degree re-mapping: transposing by
 *    (newTonic − oldTonic) preserves every chord's quality and is exactly
 *    reversible (change the key back and the original spellings AND octaves
 *    return). Re-deriving qualities there would silently rewrite borrowed
 *    material (a G7 would stop being a G7) — that is a reharmonization, not
 *    a transposition, and is deliberately NOT what happens on a key change.
 *    The interval is the SHORTEST signed one (−5..+6: C→E is +4, C→B is −1),
 *    so pitch octaves never creep on key round trips.
 *  - MODE changes are DEGREE re-derivation, and still exactly reversible:
 *    the rebuild is a pure function of (degree, new mode), so A→B→A restores
 *    every symbol whose root stayed diatonic on both hops.
 *  - Spelling: the new root/bass pitch class takes the new key's own
 *    diatonic spelling when it is in the scale (pc 6 in E major → "F#",
 *    pc 8 in C Aeolian → "Ab"), otherwise it follows the key's accidental
 *    side (F#7 into E major becomes A#7, not Bb7). All spelling decisions
 *    are normalizeChord's — one music theory in crescode, never two.
 *  - Unparseable symbols (a mid-edit chord, or text the grammar rejects) are
 *    left untouched and simply not counted; a rebuilt symbol that the shared
 *    grammar cannot express (mMaj9, say) keeps the original too.
 *  - Everything here is pure and host-free: the store applies the returned
 *    project as ONE undoable edit, so a single Ctrl+Z restores both the old
 *    key/mode and the old chords.
 */
import {
  MODES, parseChord, type Chord, type ModeName, type Note, type ParsedChord, type PitchClass, type Project,
} from '../../shared/schema';
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

// --- Mode change: same tonic, degrees re-rendered diatonically --------------

export interface ModeTransformResult {
  /** The project with the new mode — and every diatonic-root chord
   *  re-rendered for it. */
  project: Project;
  from: ModeName;
  to: ModeName;
  /** Chord symbols actually rewritten (diatonic root AND an expressible
   *  new quality). */
  changed: number;
}

/** Stack of thirds at `degree` of `scale`, in semitones above the root:
 *  positions wrap through the octave, so non-heptatonic modes derive
 *  correctly (Whole Tone stacks augmented triads, the octatonic scales
 *  stack diminished 7ths). A scale too short to stack a seventh (Whole
 *  Tone's third stack lands back on the root) reports seventh: null. */
interface DiatonicStack { third: number; fifth: number; seventh: number | null }

const stackAt = (scale: readonly number[], degree: number): DiatonicStack | null => {
  const n = scale.length;
  const at = (k: number): number => scale[(degree + k) % n]! + 12 * Math.floor((degree + k) / n);
  return {
    third: at(2) - at(0),
    fifth: at(4) - at(0),
    seventh: (degree + 6) % n === degree ? null : at(6) - at(0),
  };
};

/** Diatonic triad quality at a degree — '' (major), 'm', 'dim', 'aug';
 *  null when the stack has no name the shared grammar can spell. */
const triadAt = (scale: readonly number[], degree: number): '' | 'm' | 'dim' | 'aug' | null => {
  const s = stackAt(scale, degree);
  if (s === null) return null;
  if (s.third === 4 && s.fifth === 7) return '';
  if (s.third === 3 && s.fifth === 7) return 'm';
  if (s.third === 3 && s.fifth === 6) return 'dim';
  if (s.third === 4 && s.fifth === 8) return 'aug';
  return null;
};

/** Diatonic seventh-chord quality at a degree (the core of a re-derived
 *  7th/9/11/13 chord); null when no standard name fits the stack. */
const seventhAt = (scale: readonly number[], degree: number): string | null => {
  const s = stackAt(scale, degree);
  if (s === null || s.seventh === null) return null;
  const { third, fifth, seventh } = s;
  if (third === 4 && fifth === 7 && seventh === 11) return 'maj7';
  if (third === 4 && fifth === 7 && seventh === 10) return '7';
  if (third === 3 && fifth === 7 && seventh === 10) return 'm7';
  if (third === 3 && fifth === 6 && seventh === 10) return 'm7b5';
  if (third === 3 && fifth === 6 && seventh === 9) return 'dim7';
  if (third === 3 && fifth === 7 && seventh === 11) return 'mMaj7';
  if (third === 4 && fifth === 8 && seventh === 10) return 'aug7';
  if (third === 4 && fifth === 8 && seventh === 11) return 'augmaj7';
  return null;
};

/** The 9/11/13 figure that sits on top of each re-derived seventh core
 *  ("m7" core + "9" → "m9"). null when the grammar cannot spell the
 *  combination — the chord is then left untouched. */
const EXTENDED_FIGURE: Record<string, Record<string, string>> = {
  '9': { maj7: 'maj9', '7': '9', m7: 'm9', m7b5: 'm9b5', dim7: 'dim9', mMaj7: 'mMaj9', aug7: 'aug9', augmaj7: 'augmaj9' },
  '11': { maj7: 'maj11', '7': '11', m7: 'm11', m7b5: 'm11b5', dim7: 'dim11', mMaj7: 'mMaj11', aug7: 'aug11', augmaj7: 'augmaj11' },
  '13': { maj7: 'maj13', '7': '13', m7: 'm13', m7b5: 'm13b5', dim7: 'dim13', mMaj7: 'mMaj13', aug7: 'aug13', augmaj7: 'augmaj13' },
};

/**
 * New quality text for one chord whose core is re-derived at `degree` of
 * `scale` (the NEW mode). The core is the diatonic triad — or the diatonic
 * seventh when the old chord had one (9/11/13 chords have a seventh under
 * their figure) — and every color tone the chord carried (6/9/11/13 figures,
 * addX, explicit alterations) is appended verbatim. Qualities without a
 * third (sus/power/7sus) return their text unchanged: there is nothing to
 * re-derive. null → the chord is left untouched.
 */
const rebuiltQuality = (parsed: ParsedChord, qualityText: string, scale: readonly number[], degree: number): string | null => {
  const ext = parsed.extensions.join('');
  switch (parsed.quality) {
    case 'major': case 'minor': case 'diminished': case 'augmented':
      return triadAt(scale, degree) === null ? null : triadAt(scale, degree)! + ext;
    case 'sus2': case 'sus4': case 'power': case '7sus4': case '7sus2': case '9sus4':
      return qualityText; // no third — the suspension IS the quality
    case '6': case 'm6': case '6/9': {
      const t = triadAt(scale, degree);
      if (t === null) return null;
      return `${t}6${parsed.quality === '6/9' ? '/9' : ''}${ext}`;
    }
    case '7': case 'maj7': case 'm7': case 'm7b5': case 'dim7': case 'mMaj7': case 'aug7': case 'augMaj7':
      return seventhAt(scale, degree) === null ? null : seventhAt(scale, degree)! + ext;
    case '9': case 'maj9': case 'm9': case '11': case 'm11': case 'maj11': case '13': case 'm13': case 'maj13': {
      const figure = parsed.quality.includes('11') ? '11' : parsed.quality.includes('13') ? '13' : '9';
      const core = seventhAt(scale, degree);
      if (core === null) return null;
      const built = EXTENDED_FIGURE[figure]?.[core];
      return built === undefined ? null : built + ext;
    }
    case 'add9': case 'madd9': case 'add2': case 'add11': case 'add4': {
      const t = triadAt(scale, degree);
      if (t === null) return null;
      const figure = parsed.quality.replace(/^m/, '');
      return `${t}${figure}${ext}`;
    }
    default:
      return null; // unknown core — never guess
  }
};

/**
 * The whole-track MODE change, as one pure project → project function:
 * every chord whose root is diatonic in the OLD mode keeps its scale degree
 * and is re-rendered diatonically in the new mode (root re-spelled, core
 * quality re-derived, color tones and slash basses preserved — the bass
 * follows its own degree, so inversions stay inversions). Chromatic roots
 * and unparseable symbols pass through untouched, and the Chords track's
 * MIDI notes shift by each chord's own root delta (shortest signed path,
 * clamped to MIDI 0..127, notes assigned to the chord whose span contains
 * them). Every other track is untouched.
 */
export function transformProjectMode(project: Project, newMode: ModeName): ModeTransformResult {
  const from = project.mode;
  if (newMode === from) return { project, from, to: newMode, changed: 0 };
  const oldScale = MODES[from];
  const newScale = MODES[newMode];
  const key = projectKeyOf({ key: project.key, mode: newMode });
  const tonic = project.key;
  // Degree lookup + per-chord root delta, shared by symbols and note shifting.
  const degreeOf = (pc: number): number => oldScale.findIndex((step) => mod12(tonic + step) === mod12(pc));
  const shortest = (d: number): number => { const m = mod12(d); return m > 6 ? m - 12 : m; };

  let changed = 0;
  const deltas = new Map<string, number>();
  const chords: Chord[] = project.chords.map((c) => {
    const parsed = parseChord(c.symbol);
    if (!parsed.ok) return c;
    const degree = degreeOf(parsed.chord.root);
    if (degree < 0) return c; // chromatic in the old mode — borrowed, keep it
    const quality = rebuiltQuality(parsed.chord, c.symbol.slice(parsed.chord.rootName.length, parsed.chord.bassName !== null ? c.symbol.length - parsed.chord.bassName.length - 1 : c.symbol.length), newScale, degree);
    if (quality === null) return c;
    const newRootPc = mod12(tonic + newScale[degree]!);
    const bass = parsed.chord.bass !== null && parsed.chord.bassName !== null
      ? `/${spellPc(degreeOf(parsed.chord.bass) >= 0 ? mod12(tonic + newScale[degreeOf(parsed.chord.bass)]!) : mod12(parsed.chord.bass), key)}`
      : '';
    const rebuilt = `${spellPc(newRootPc, key)}${quality}${bass}`;
    if (!parseChord(rebuilt).ok || rebuilt === c.symbol) return c;
    changed += 1;
    deltas.set(c.id, shortest(newRootPc - parsed.chord.root));
    return { ...c, symbol: rebuilt };
  });

  const at = (tick: number, list: Chord[]): number => {
    let delta = 0;
    for (const c of list) {
      if (c.startTick <= tick && tick < c.startTick + c.durationTicks) delta = deltas.get(c.id) ?? 0;
    }
    return delta; // later start wins on overlap; outside every chord → 0
  };
  const shiftNotes = (notes: Note[], list: Chord[]): Note[] =>
    notes.map((n) => (deltas.size === 0 ? n : { ...n, pitch: clampPitch(n.pitch, at(n.startTick, list)) }));
  const tracks = project.tracks.map((t) => (t.role === 'chords' ? { ...t, notes: shiftNotes(t.notes, chords) } : t));
  return { project: { ...project, mode: newMode, chords, tracks }, from, to: newMode, changed };
}

/**
 * The whole-track key change, as one pure project → project function:
 * every parseable chord symbol re-spells for the new tonic, the Chords
 * track's MIDI notes shift by the same interval (clamped to MIDI 0..127),
 * every other track is untouched, and the project key is set. With an
 * unchanged tonic the chords/notes are passed through by reference — only
 * the key field moves (mode-only changes run through transformProjectMode
 * instead, which re-derives the diatonic chords for the new mode).
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
