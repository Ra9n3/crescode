/**
 * Pure logic behind the Smart Chord overlay controls (feature spec:
 * "Chord Grid UI", "Customization Controls", "Apply Button").
 *
 * Everything here is deterministic and host-free so the React layer stays a
 * thin renderer and the rules stay unit-testable:
 *
 *  - Extension choices are a FIXED, table-driven vocabulary per triad base.
 *    The user's root and quality are preserved unless the extension itself
 *    demands otherwise (min7/m6 force minor, dim7 forces diminished, sus
 *    replaces the third) — exactly the spec's "unless the extension makes
 *    them invalid". Every suffix is gated through the SHARED parseChord, so
 *    a symbol the overlay composes can always round-trip into
 *    renameChordClip — one chord grammar in crescode, never two.
 *  - Bass choices are Auto (keep the chord's own slash), Root position, and
 *    the twelve chromatic bass notes; note names are normalized through
 *    normalizeChord for the project key (Db in Eb major, C# in D major).
 *  - buildChordSymbol composes root + suffix + optional slash and verifies
 *    the pitch class never moved.
 *  - The drift guard backs the Apply button's non-destructive rule: a clip
 *    that was deleted, moved, renamed or note-edited since the overlay
 *    opened is reported, never silently overwritten.
 *  - Filtering/sorting for the chord grid (score order is the engine's).
 */
import { parseChord, type PitchClass } from '../../shared/schema';
import { chordPitchClasses, spelledNoteName } from './model';
import { normalizeChord } from './normalize';
import { voicingToPitches, type VoicingResult } from './voicing';
import type { ChordTrackAPI } from './adapter';
import type { Chord, ChordClip, ChordQuality, ProjectKey } from './types';

// ---------------------------------------------------------------------------
// Triad bases — what "quality" collapses to when an extension is applied
// ---------------------------------------------------------------------------

export type TriadBase = 'maj' | 'min' | 'dim' | 'aug' | 'sus4' | 'sus2' | 'power';

const TRIAD_BASE_OF: Readonly<Record<string, TriadBase>> = {
  major: 'maj', minor: 'min', diminished: 'dim', augmented: 'aug',
  sus2: 'sus2', sus4: 'sus4', power: 'power',
  '6': 'maj', '6/9': 'maj', add9: 'maj', add2: 'maj', add11: 'maj', add4: 'maj',
  '7': 'maj', maj7: 'maj', maj9: 'maj', '9': 'maj', '11': 'maj', '13': 'maj',
  m6: 'min', 'm6/9': 'min', madd9: 'min', m7: 'min', m9: 'min', m11: 'min', m13: 'min', mMaj7: 'min',
  m7b5: 'dim', dim7: 'dim',
  aug7: 'aug', augMaj7: 'aug',
  '7sus4': 'sus4', '9sus4': 'sus4', '7sus2': 'sus2',
};

export function triadBaseOf(quality: string): TriadBase {
  return TRIAD_BASE_OF[quality] ?? 'maj';
}

// ---------------------------------------------------------------------------
// Extension vocabulary — suffix per (extension, triad base); null = not offered
// ---------------------------------------------------------------------------

export const EXTENSION_IDS = [
  'none', '7', 'maj7', 'min7', '9', 'maj9', 'add9', 'sus4', 'sus2', '6', 'm6',
  '6/9', '11', '13', '7sus4', 'm7b5', 'dim7', 'power',
] as const;

export type ExtensionId = (typeof EXTENSION_IDS)[number];

const EXTENSION_LABEL: Readonly<Record<ExtensionId, string>> = {
  none: 'None (triad)', '7': '7 (dominant)', maj7: 'maj7', min7: 'm7',
  '9': '9', maj9: 'maj9', add9: 'add9', sus4: 'sus4', sus2: 'sus2',
  '6': '6', m6: 'm6', '6/9': '6/9', '11': '11', '13': '13',
  '7sus4': '7sus4', m7b5: 'm7b5', dim7: 'dim7', power: '5 (power)',
};

/**
 * The suffix each extension produces on each triad base. `null` means the
 * combination is not offered (no conventional name in the shared grammar).
 * Forcing rows implement the spec's escape hatch: min7/m6 make a major
 * quality invalid (→ minor), dim7 forces diminished, sus replaces the
 * third, power replaces the whole shape above the root.
 */
const EXT_SUFFIX: Readonly<Record<ExtensionId, Readonly<Record<TriadBase, string | null>>>> = {
  none: { maj: '', min: 'm', dim: 'dim', aug: 'aug', sus4: 'sus4', sus2: 'sus2', power: '5' },
  '7': { maj: '7', min: 'm7', dim: 'm7b5', aug: 'aug7', sus4: '7sus4', sus2: '7sus2', power: null },
  maj7: { maj: 'maj7', min: 'mMaj7', dim: 'dimmaj7', aug: 'augmaj7', sus4: null, sus2: null, power: null },
  min7: { maj: 'm7', min: 'm7', dim: 'm7b5', aug: 'm7', sus4: '7sus4', sus2: '7sus2', power: null },
  '9': { maj: '9', min: 'm9', dim: null, aug: 'aug9', sus4: '9sus4', sus2: null, power: null },
  maj9: { maj: 'maj9', min: null, dim: null, aug: null, sus4: null, sus2: null, power: null },
  add9: { maj: 'add9', min: 'madd9', dim: 'dimadd9', aug: 'augadd9', sus4: null, sus2: null, power: null },
  sus4: { maj: 'sus4', min: 'sus4', dim: 'sus4', aug: 'sus4', sus4: 'sus4', sus2: 'sus4', power: null },
  sus2: { maj: 'sus2', min: 'sus2', dim: 'sus2', aug: 'sus2', sus4: 'sus2', sus2: 'sus2', power: null },
  '6': { maj: '6', min: 'm6', dim: null, aug: null, sus4: null, sus2: null, power: null },
  m6: { maj: 'm6', min: 'm6', dim: null, aug: null, sus4: null, sus2: null, power: null },
  '6/9': { maj: '6/9', min: 'm6/9', dim: null, aug: null, sus4: null, sus2: null, power: null },
  '11': { maj: '11', min: 'm11', dim: null, aug: null, sus4: null, sus2: null, power: null },
  '13': { maj: '13', min: 'm13', dim: null, aug: null, sus4: null, sus2: null, power: null },
  '7sus4': { maj: '7sus4', min: '7sus4', dim: '7sus4', aug: '7sus4', sus4: '7sus4', sus2: '7sus4', power: null },
  m7b5: { maj: 'm7b5', min: 'm7b5', dim: 'm7b5', aug: null, sus4: null, sus2: null, power: null },
  dim7: { maj: 'dim7', min: 'dim7', dim: 'dim7', aug: null, sus4: null, sus2: null, power: null },
  power: { maj: '5', min: '5', dim: '5', aug: '5', sus4: null, sus2: null, power: '5' },
};

export interface ExtensionChoice {
  id: ExtensionId;
  label: string;
  suffix: string;
}

/** The extension dropdown for one chord quality — grammar-gated, in stable
 *  EXTENSION_IDS order. Every returned choice parses through the shared
 *  parser, so the overlay can never offer a symbol renameChordClip rejects. */
export function extensionChoicesFor(quality: string): ExtensionChoice[] {
  const base = triadBaseOf(quality);
  const out: ExtensionChoice[] = [];
  const seen = new Set<string>();
  for (const id of EXTENSION_IDS) {
    const suffix = EXT_SUFFIX[id][base];
    if (suffix === null) continue;
    if (seen.has(suffix)) continue; // two ids with the same sound — offer the first only
    if (!parseChord(`C${suffix}`).ok) continue; // grammar gate — one chord grammar, never two
    seen.add(suffix);
    out.push({ id, label: EXTENSION_LABEL[id], suffix });
  }
  return out;
}

/** Which dropdown position an existing chord sits at (quality → ext id).
 *  Shapes outside the vocabulary (user-typed add2/add11/add4) read as the
 *  plain triad — the reading section still shows the true chord. */
const EXTENSION_ID_OF: Readonly<Record<string, ExtensionId>> = {
  major: 'none', minor: 'none', diminished: 'none', augmented: 'none',
  sus2: 'none', sus4: 'none', power: 'none', add2: 'none', add11: 'none', add4: 'none',
  '6': '6', m6: '6', '6/9': '6/9', 'm6/9': '6/9',
  '7': '7', m7: '7', m7b5: '7', '7sus4': '7', '7sus2': '7', aug7: '7',
  maj7: 'maj7', mMaj7: 'maj7', augMaj7: 'maj7',
  '9': '9', m9: '9', '9sus4': '9',
  maj9: 'maj9',
  add9: 'add9', madd9: 'add9',
  '11': '11', m11: '11', '13': '13', m13: '13',
  dim7: 'dim7',
};

export function extensionIdOf(quality: string): ExtensionId {
  return EXTENSION_ID_OF[quality] ?? 'none';
}

// ---------------------------------------------------------------------------
// Bass choices
// ---------------------------------------------------------------------------

export type BassSelection = 'auto' | 'root' | { readonly pc: PitchClass };

export interface BassChoice {
  id: string; // 'auto' | 'root' | 'pc:<n>' — select-friendly
  label: string;
  selection: BassSelection;
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'] as const;

/** The bass dropdown for one chord: Auto, Root position, then the twelve
 *  chromatic bass notes labeled as inversions (chord tone) or slash bass. */
export function bassChoicesFor(chord: Chord): BassChoice[] {
  const pcs = chordPitchClasses(chord);
  const out: BassChoice[] = [
    {
      id: 'auto',
      label: chord.bassNote !== null ? `Auto (keep ${chord.bassNote})` : 'Auto (chord root)',
      selection: 'auto',
    },
    { id: 'root', label: 'Root position', selection: 'root' },
  ];
  for (let pc = 0; pc <= 11; pc++) {
    if (pc === chord.rootPc) continue; // covered by "Root position"
    const name = spelledNoteName(pc);
    const idx = pcs.indexOf(pc as PitchClass);
    const label = idx > 0 ? `${name} · ${ORDINAL[Math.min(idx - 1, ORDINAL.length - 1)]} inversion` : `${name} · slash bass`;
    out.push({ id: `pc:${pc}`, label, selection: { pc: pc as PitchClass } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Symbol composing
// ---------------------------------------------------------------------------

export type ComposeResult = { ok: true; symbol: string } | { ok: false; error: string };

/**
 * Composes the final chord symbol from a suggestion chord plus the two
 * dropdowns. Root and slash bass go through normalizeChord (key-idiomatic
 * spelling, pitch class never moves — foundation-layer §3), the result is
 * verified against the shared grammar and the original root pitch class.
 */
export function buildChordSymbol(
  chord: Chord,
  ext: ExtensionId,
  bass: BassSelection,
  key: ProjectKey,
): ComposeResult {
  const base = triadBaseOf(chord.quality);
  const suffix = EXT_SUFFIX[ext][base];
  if (suffix === null) {
    return { ok: false, error: `extension "${ext}" is not available for a ${chord.quality} chord` };
  }
  let root: string;
  try {
    root = normalizeChord(chord.rootName, key);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  let symbol = `${root}${suffix}`;
  try {
    if (bass === 'auto' && chord.bassNote !== null) symbol += `/${normalizeChord(chord.bassNote, key)}`;
    if (bass !== 'auto' && bass !== 'root') symbol += `/${normalizeChord(spelledNoteName(bass.pc), key)}`;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const parsed = parseChord(symbol);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (parsed.chord.root !== chord.rootPc) {
    return { ok: false, error: `composed symbol "${symbol}" changed the root pitch class` };
  }
  return { ok: true, symbol };
}

// ---------------------------------------------------------------------------
// Apply guard — the clip must not have drifted since the overlay opened
// ---------------------------------------------------------------------------

/** Label of the undo step an Apply produces (feature spec §4). */
export const APPLY_TRANSACTION_LABEL = 'Apply Smart Chord';

/** What the overlay remembered about the clip when it opened (or last wrote). */
export interface ClipSnapshot {
  id: string;
  startTime: number;
  lengthTicks: number;
  symbol: string;
  noteSignature: string;
}

const noteSignatureOf = (clip: ChordClip): string =>
  (clip.rawMidiNotes ?? [])
    .map((n) => `${n.midi}:${n.startTick}:${n.durationTicks}:${n.velocity}`)
    .join('|');

export function takeClipSnapshot(clip: ChordClip): ClipSnapshot {
  return {
    id: clip.id,
    startTime: clip.startTime,
    lengthTicks: clip.lengthTicks,
    symbol: clip.chord.spelling,
    noteSignature: noteSignatureOf(clip),
  };
}

export type ClipDrift = 'missing' | 'moved' | 'renamed' | 'edited';

/**
 * Non-destructive Apply guard (spec: "If the target clip no longer exists,
 * was moved, or was edited by the user, show a non-destructive warning and
 * do not overwrite it automatically"). null = safe to write.
 */
export function clipDrift(snapshot: ClipSnapshot | null, clip: ChordClip | null): ClipDrift | null {
  if (clip === null) return snapshot === null ? null : 'missing';
  if (snapshot === null) return null;
  if (clip.id !== snapshot.id) return 'missing';
  if (clip.startTime !== snapshot.startTime || clip.lengthTicks !== snapshot.lengthTicks) return 'moved';
  if (clip.chord.spelling !== snapshot.symbol) return 'renamed';
  if (noteSignatureOf(clip) !== snapshot.noteSignature) return 'edited';
  return null;
}

/** The adapter surface Apply drives — the portable contract's write half plus
 *  the crescode extra that re-locates the clip (structural, so tests can
 *  pass any conforming object). */
export type ApplyApi = Pick<
  ChordTrackAPI,
  'beginUndoTransaction' | 'commitUndoTransaction' | 'cancelUndoTransaction' | 'replaceMidiNotes' | 'renameChordClip'
> & {
  getChordClipById(clipId: string): ChordClip | null;
  isTransactionActive(): boolean;
};

export type ApplyOutcome =
  | { ok: true; snapshot: ClipSnapshot | null }
  | { ok: false; drift: ClipDrift | 'error'; error?: string };

/**
 * The Apply button's whole write path (feature spec §4), as one testable
 * function: re-locate the clip, guard the drift, then replace the notes and
 * update the displayed name inside ONE "Apply Smart Chord" undo transaction.
 * Position, length, track assignment and metadata are never touched (the
 * adapter's rule 3). Any failure cancels the transaction — the timeline is
 * exactly as before — and is reported instead of thrown.
 */
export function applyChordToClip(
  api: ApplyApi,
  clipId: string,
  symbol: string,
  voicing: VoicingResult & { ok: true },
  snapshot: ClipSnapshot | null,
): ApplyOutcome {
  const live = api.getChordClipById(clipId);
  if (live === null) return { ok: false, drift: 'missing' };
  const drift = clipDrift(snapshot, live);
  if (drift !== null) return { ok: false, drift };
  try {
    api.beginUndoTransaction(APPLY_TRANSACTION_LABEL);
    api.replaceMidiNotes(clipId, voicingToPitches(voicing, live.startTime, live.lengthTicks));
    api.renameChordClip(clipId, symbol);
    api.commitUndoTransaction();
    const fresh = api.getChordClipById(clipId);
    return { ok: true, snapshot: fresh === null ? null : takeClipSnapshot(fresh) };
  } catch (err) {
    try {
      if (api.isTransactionActive()) api.cancelUndoTransaction();
    } catch {
      /* the transaction was already closed by the failure path */
    }
    return { ok: false, drift: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Chord grid filtering / sorting
// ---------------------------------------------------------------------------

export type SuggestionColorFilter = 'all' | 'green' | 'yellow' | 'red';
export type SuggestionSort = 'score' | 'name';

export interface SuggestionFilter {
  query: string;
  color: SuggestionColorFilter;
  sort: SuggestionSort;
}

/** Grid query support (spec: "Sort suggestions by score, but allow the user
 *  to filter or search"). 'score' keeps the engine's ranked order; 'name'
 *  sorts alphabetically. Matching is case-insensitive over the symbol and
 *  the quality name. */
export function filterSuggestions<T extends { chord: Chord; color: 'green' | 'yellow' | 'red' }>(
  list: readonly T[],
  f: SuggestionFilter,
): T[] {
  const q = f.query.trim().toLowerCase();
  const hits = list.filter((s) =>
    (f.color === 'all' || s.color === f.color) &&
    (q === '' || s.chord.spelling.toLowerCase().includes(q) || s.chord.quality.toLowerCase().includes(q)));
  if (f.sort !== 'name') return [...hits];
  return [...hits].sort((a, b) => a.chord.spelling.localeCompare(b.chord.spelling, 'en', { numeric: true }));
}

/** Quality label helper for the grid cards (colorCategory is the engine's
 *  functional family; the quality string is what musicians read). */
export function qualityLabelOf(quality: ChordQuality | string): string {
  return quality;
}
