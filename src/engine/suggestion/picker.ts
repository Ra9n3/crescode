/**
 * Pure logic behind the compact Smart Chord picker (popup redesign).
 *
 * The redesign turns the old select-then-Apply overlay into an
 * immediate-selection picker: clicking a suggestion tile writes that chord
 * to the clip right away ("Apply Smart Chord" transaction), the popup stays
 * open for the next pick, and the Advanced controls (extension / bass /
 * octave) apply to the clip's CURRENT chord on change — no separate
 * confirmation step anywhere.
 *
 * Everything here stays deterministic and host-free so the React layer is a
 * thin renderer: composition always flows through the SHARED grammar
 * (buildChordSymbol → parseChord) and the voicing rules (voiceChordSymbol),
 * and the write path is exactly the drift-guarded applyChordToClip
 * transaction — the redesign adds no second scoring, parsing or voicing
 * implementation.
 */
import type { PitchClass } from '../../shared/schema';
import { parseChord, scalePitchClasses } from '../../shared/schema';
import { chordFromSymbol, chordPitchClasses } from './model';
import {
  applyChordToClip, buildChordSymbol, extensionChoicesFor, extensionIdOf,
  type ApplyApi, type ApplyOutcome, type BassSelection, type ExtensionId,
} from './overlay';
import { voiceChordSymbol, type VoicingResult } from './voicing';
import type { ChordSuggestion } from './engine';
import type { Chord, ProjectKey, SuggestionColorCategory } from './types';

// ---------------------------------------------------------------------------
// Immediate selection — the click path
// ---------------------------------------------------------------------------

/** Advanced-control state: null = "the chord's own default". */
export interface PickerOverrides {
  /** Extension above the triad (extension id), or null for the chord's own. */
  ext: string | null;
  /** 'auto' | 'root' | 'pc:<0-11>' — slash bass / inversion, or null = auto. */
  bass: string | null;
  /** Voicing anchor offset in octaves from C4, or null for the default. */
  octave: number | null;
}

export const NO_OVERRIDES: PickerOverrides = { ext: null, bass: null, octave: null };

export type ComposedSuggestion =
  | { ok: true; symbol: string; voicing: VoicingResult & { ok: true } }
  | { ok: false; error: string };

function bassSelectionOf(bass: string | null | undefined): BassSelection {
  if (bass === 'root') return 'root';
  if (typeof bass === 'string' && bass.startsWith('pc:')) {
    const pc = Number(bass.slice(3));
    if (Number.isInteger(pc) && pc >= 0 && pc <= 11) return { pc: pc as PitchClass };
  }
  return 'auto';
}

/**
 * Composes + voices one chord for the picker: the suggestion's own quality
 * (or the Advanced override, grammar-gated), Auto/Root/slash bass, and the
 * octave anchor. Root spelling normalizes through the project key; the pitch
 * class never moves. A suggestion composed here always round-trips through
 * the shared parser, so the write path can never store an unparseable name.
 */
export function composeForSuggestion(
  chord: Chord,
  key: ProjectKey,
  overrides: PickerOverrides = NO_OVERRIDES,
): ComposedSuggestion {
  const choices = extensionChoicesFor(chord.quality);
  const wanted = overrides.ext ?? extensionIdOf(chord.quality);
  const ext = (choices.some((c) => c.id === wanted) ? wanted : choices[0]?.id ?? 'none') as ExtensionId;
  const composed = buildChordSymbol(chord, ext, bassSelectionOf(overrides.bass), key);
  if (!composed.ok) return composed;
  const voicing = voiceChordSymbol(composed.symbol, { octaveOffset: overrides.octave ?? 0 });
  if (!voicing.ok) return { ok: false, error: voicing.error };
  return { ok: true, symbol: composed.symbol, voicing };
}

/**
 * The suggestion tile's whole write path: compose → voice → the drift-guarded
 * "Apply Smart Chord" transaction. One undo step per pick; position, length,
 * track assignment and metadata are never touched; any failure leaves the
 * timeline exactly as before and is reported, never thrown.
 */
export function applyChordComposition(
  api: ApplyApi,
  clipId: string,
  chord: Chord,
  key: ProjectKey,
  snapshot: Parameters<typeof applyChordToClip>[4],
  overrides: PickerOverrides = NO_OVERRIDES,
): ApplyOutcome {
  const composed = composeForSuggestion(chord, key, overrides);
  if (!composed.ok) return { ok: false, drift: 'error', error: composed.error };
  return applyChordToClip(api, clipId, composed.symbol, composed.voicing, snapshot);
}

/**
 * The chord a picker edit targets: the clip's CURRENT chord (its live
 * symbol), so Advanced tweaks and tile picks always edit what is on the
 * timeline instead of a hidden draft. Returns null for an unparseable symbol
 * (a mid-edit manual chord — the editor is closed for those anyway).
 */
export function currentChordOf(symbol: string): Chord | null {
  const parsed = chordFromSymbol(symbol);
  return parsed.ok ? parsed.chord : null;
}

// ---------------------------------------------------------------------------
// Grid paging — 8–12 compact tiles first, a small "+N" reveals the rest
// ---------------------------------------------------------------------------

/** Tiles visible when the picker opens (4-column grid, two rows). */
export const PICKER_INITIAL_COUNT = 8;
/** Tiles each press of the reveal control adds (one more row). */
export const PICKER_MORE_STEP = 4;
/** The engine breadth the picker browses: the contract's maximum, so the
 *  lower-ranked yellow/red material (borrowed / modal color) actually
 *  reaches the "Other Chords" view instead of being cut at 18 all-green
 *  tiles in plain contexts. A preference — never a scoring change. */
export const PICKER_MAX_SUGGESTIONS = 24;

export function nextVisibleCount(current: number, total: number): number {
  return Math.min(total, current + PICKER_MORE_STEP);
}

// ---------------------------------------------------------------------------
// Short functional labels — the tile's secondary line
// ---------------------------------------------------------------------------

/** The engine's harmonic family, rendered as a two-word-max category. */
const CATEGORY_LABEL: Readonly<Record<SuggestionColorCategory, string>> = {
  diatonic: 'Diatonic',
  tonic: 'Tonic',
  subdominant: 'Subdominant',
  dominant: 'Dominant',
  passing: 'Passing',
  'modal-color': 'Modal color',
  borrowed: 'Borrowed',
  cadential: 'Cadential',
};

/** Short functional/category label for a tile (the contract's open set may
 *  grow — unknown categories render generically, never as raw ids). */
export function categoryLabelOf(category: string): string {
  const mapped = (CATEGORY_LABEL as Readonly<Record<string, string>>)[category];
  if (mapped !== undefined) return mapped;
  return category.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Views & search — the small filter above the grid (Scale Chords / Other)
// ---------------------------------------------------------------------------

/** The picker's two browse views: "Scale Chords" = every sounding pitch
 *  class inside the project scale (the base scale vocabulary), "Other
 *  Chords" = everything the engine also ranks — the borrowed/modal-color
 *  material that usually carries the yellow/red compatibility bands. */
export type SuggestionView = 'scale' | 'other';

/** "Base scale chord" test through the SHARED grammar: every pitch class the
 *  chord sounds sits in the key's scale. Pure — no second music theory. */
export function isScaleChord(chord: Chord, scalePcs: readonly PitchClass[]): boolean {
  const pcs = chordPitchClasses(chord);
  return pcs.length > 0 && pcs.every((pc) => scalePcs.includes(pc));
}

/** The key's scale pitch classes — computed once per project key. */
export function scalePitchClassesFor(key: ProjectKey): PitchClass[] {
  return scalePitchClasses(key.tonic, key.mode) as PitchClass[];
}

/** Partition the engine's ranked list into a view. The engine's order is
 *  never re-scored or re-sorted — a view is a filter over the same ranking. */
export function partitionSuggestionsByView(
  list: ChordSuggestion[],
  view: SuggestionView,
  scalePcs: readonly PitchClass[],
): ChordSuggestion[] {
  const wantScale = view === 'scale';
  return list.filter((s) => isScaleChord(s.chord, scalePcs) === wantScale);
}

/** A typed query broken into flexible match rules. `quality` is the canonical
 *  quality name when the typed text parses ("g7" → "7", "gm" → "minor");
 *  non-parseable rests fall back to prefix matching ("gmi" → minor…). */
export interface SuggestionQuery {
  /** Root pitch class of the typed note (enharmonic — "gb" matches Gb and F#). */
  rootPc: PitchClass;
  /** The typed rest after the root, lowercased ('' = bare root). */
  rest: string;
  /** Canonical quality name from the shared grammar, or null when the rest
   *  does not parse (prefix matching applies instead). */
  quality: string | null;
}

const QUERY_LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parse the symbol field's live draft into query rules, or null when the
 *  draft is empty / not chord-shaped (no filtering). Case-insensitive by
 *  construction; the root matches enharmonically through its pitch class. */
export function parseSuggestionQuery(raw: string): SuggestionQuery | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(.*?)\s*$/.exec(raw);
  if (!m) return null;
  let pc = QUERY_LETTER[m[1].toUpperCase()];
  const acc = m[2].replace('♯', '#').replace('♭', 'b');
  if (acc === '#') pc += 1;
  if (acc === 'b') pc -= 1;
  const rootPc = (((pc % 12) + 12) % 12) as PitchClass;
  const rest = m[3].toLowerCase();
  if (rest.length === 0) return { rootPc, rest, quality: null };
  const parsed = parseChord(`${m[1].toUpperCase()}${acc}${m[3].trim()}`);
  return { rootPc, rest, quality: parsed.ok ? parsed.chord.quality : null };
}

/** The dynamic search rules: root must match (enharmonic), and when the
 *  typed rest carries quality information it must agree — exactly through
 *  the shared grammar, or as a case-insensitive prefix of the quality name. */
export function filterSuggestionsByQuery(list: ChordSuggestion[], q: SuggestionQuery): ChordSuggestion[] {
  return list.filter((s) => {
    if (s.chord.rootPc !== q.rootPc) return false;
    if (q.quality !== null) return s.chord.quality === q.quality;
    if (q.rest.length === 0) return true;
    return s.chord.quality.toLowerCase().startsWith(q.rest);
  });
}
