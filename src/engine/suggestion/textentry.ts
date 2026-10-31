/**
 * Text-based chord entry and renaming (feature spec: "text entry & rename").
 *
 * The user double-clicks an existing chord name on the chord lane, an inline
 * text input opens at the clip, and everything they type flows through THIS
 * module before anything is written:
 *
 *  §2  parseChordText      — strict-but-forgiving breakdown of chord text
 *                            (root letter, accidental, quality, extensions,
 *                            slash bass, or an error). Validation ALWAYS runs
 *                            through the shared parseChord — one chord grammar
 *                            in crescode, never two; this module only splits
 *                            and re-composes text around it. "Forgiving"
 *                            means input folding (lowercase root letters and
 *                            unicode ♯/♭ fold to the grammar's ASCII canon);
 *                            the user's quality/extension spelling itself is
 *                            preserved verbatim in `qualitySuffix`.
 *  —   interpretChordText  — the grammar is deterministic, so exactly one
 *                            token is resolved by convention: a bare "sus"
 *                            (→ sus4). Text entry surfaces BOTH readings
 *                            ("Csus4"/"Csus2") and lets the user choose —
 *                            ambiguity is never resolved silently.
 *  §3  suggestChordCompletions — triad-only autocomplete. While the user is
 *                            typing a bare root or root+quality, ONLY the
 *                            four triads of that root are offered (major,
 *                            minor, diminished, augmented) — no 7ths, 9ths,
 *                            11ths, 13ths or other extensions. Once an
 *                            extension marker is typed (a digit, "maj7",
 *                            "sus", "add", …) the relevant extensions of the
 *                            shared grammar appear. Exact matches rank first,
 *                            then diatonically relevant chords (every chord
 *                            tone inside the key scale); the remaining order
 *                            is the fixed canonical-suffix vocabulary. An
 *                            empty input offers the key's own diatonic
 *                            triads as the starting menu.
 *  §4  normalizeChordText  — root and slash bass pass through normalizeChord
 *                            (key-idiomatic spelling: Db→C# in D major,
 *                            C#→Db in Eb major, Bb preferred in F major);
 *                            the pitch class is verified to never move.
 *  §5  voiceChordText      — the normalized name through the §"MIDI
 *                            Generation" voicing rules (C4-centered close
 *                            voicing, bass ≤ uppers, MIDI 36–84 guard, one
 *                            note per pitch class, inversion/slash respected).
 *                            Returns BOTH the note list and the normalized
 *                            name.
 *  §6  applyChordTextToClip — the whole track update as one testable
 *                            function: validate → disambiguate → normalize →
 *                            voice → locate the clip → drift guard → warn on
 *                            substantial unrecognized user MIDI → ONE
 *                            "Rename Chord" undo transaction that clears the
 *                            clip's notes, writes the new voicing and updates
 *                            the displayed name. Position, length, track
 *                            assignment and metadata are never touched (the
 *                            adapter's rule 3); any failure cancels the
 *                            transaction, restoring the original chord and
 *                            MIDI exactly. No code path here creates a clip.
 *
 * Pure and deterministic: no store access, no rng, no I/O — same text, key
 * and host state → same result, always.
 */
import { parseChord, scalePitchClasses, type PitchClass } from '../../shared/schema';
import { chordFromSymbol, pcOfNoteName, spelledNoteName } from './model';
import { normalizeChord } from './normalize';
import { parseChordClipView, type ChordAnalysis } from './parse';
import {
  clipDrift, takeClipSnapshot, type ApplyApi, type ClipDrift, type ClipSnapshot,
} from './overlay';
import {
  voiceChordSymbol, voicingToPitches, type VoicedNote, type VoicingOptions, type VoicingResult,
} from './voicing';
import type { Chord, ChordClip, NoteName, Pitch, ProjectKey } from './types';

// ---------------------------------------------------------------------------
// §2 — chord text grammar (breakdown over the shared parser)
// ---------------------------------------------------------------------------

/** The accidental as folded into the grammar's ASCII canon. */
export type Accidental = '' | '#' | 'b';

export interface ChordTextParts {
  /** Folded, trimmed input — the text every other field was cut from. */
  text: string;
  /** Root letter A–G ("Dbm7" → "D"). */
  rootLetter: string;
  /** Root including its accidental, as typed ("Db", "F#", "C"). */
  rootName: string;
  accidental: Accidental;
  /** Canonical quality name from the shared table ("major", "m7", "sus4"). */
  quality: string;
  /** Extension/alteration tokens typed above the base quality ("add9"). */
  extensions: string[];
  /** Slash bass as typed ("C/E" → "E"), null when absent. */
  bassName: string | null;
  /** The typed text between the root and the slash — reused VERBATIM when
   *  re-composing, so "maj7(b9)" stays "maj7(b9)". */
  qualitySuffix: string;
}

export type ChordTextParse =
  | { ok: true; parts: ChordTextParts }
  | { ok: false; error: string };

/** Input folding: unicode accidentals fold to ASCII, a lowercase root letter
 *  folds to uppercase (the shared grammar's own shape). Everything else —
 *  quality/extension spelling, parens — is the user's verbatim. */
const foldChordText = (raw: string): string =>
  raw.trim().replace(/♯/g, '#').replace(/♭/g, 'b').replace(/^([a-g])/, (m) => m.toUpperCase());

export function parseChordText(raw: string): ChordTextParse {
  if (typeof raw !== 'string') return { ok: false, error: 'Chord text must be a string' };
  const text = foldChordText(raw);
  if (!text) return { ok: false, error: 'Empty chord text' };
  const parsed = parseChord(text); // the ONLY grammar — never a second one
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const c = parsed.chord;
  const rootLetter = c.rootName[0]!;
  const accidental: Accidental = c.rootName.length > 1 ? (c.rootName[1] as Accidental) : '';
  const withoutBass = c.bassName !== null ? text.slice(0, text.length - c.bassName.length - 1) : text;
  return {
    ok: true,
    parts: {
      text,
      rootLetter,
      rootName: c.rootName,
      accidental,
      quality: c.quality,
      extensions: [...c.extensions],
      bassName: c.bassName,
      qualitySuffix: withoutBass.slice(c.rootName.length),
    },
  };
}

// ---------------------------------------------------------------------------
// Ambiguity — the one convention-resolved token, surfaced instead of guessed
// ---------------------------------------------------------------------------

export type ChordTextInterpretation =
  | { status: 'ok'; chord: Chord }
  | { status: 'ambiguous'; interpretations: Chord[] }
  | { status: 'invalid'; error: string };

/** Bare "sus" — not followed by a digit — is the shared grammar's single
 *  convention-resolved token (→ sus4). "sus2"/"sus4" are explicit. */
const BARE_SUS = /sus(?![0-9])/;

const chordOfSymbol = (symbol: string): Chord | null => {
  const r = chordFromSymbol(symbol, { confidence: 1 }); // user-authored text
  return r.ok ? r.chord : null;
};

/**
 * Reads chord text into the chord it names. Invalid text reports an error;
 * text whose bare "sus" admits two readings reports BOTH (grammar default
 * sus4 first) as fully resolved, committable symbols — the UI must make the
 * user choose one; nothing is applied until it does.
 */
export function interpretChordText(raw: string): ChordTextInterpretation {
  const p = parseChordText(raw);
  if (!p.ok) return { status: 'invalid', error: p.error };
  const { text, rootName, qualitySuffix, bassName } = p.parts;
  const bassPart = bassName !== null ? `/${bassName}` : '';
  if (BARE_SUS.test(qualitySuffix)) {
    const interpretations = (['sus4', 'sus2'] as const)
      .map((rep) => chordOfSymbol(`${rootName}${qualitySuffix.replace(BARE_SUS, rep)}${bassPart}`))
      .filter((c): c is Chord => c !== null);
    if (interpretations.length >= 2) return { status: 'ambiguous', interpretations };
  }
  const chord = chordOfSymbol(text);
  return chord !== null ? { status: 'ok', chord } : { status: 'invalid', error: `"${raw}": unrecognized chord text` };
}

// ---------------------------------------------------------------------------
// §3 — triad-only autocomplete
// ---------------------------------------------------------------------------

export interface ChordCompletion {
  /** Full, committable chord symbol with the key-normalized root spelling. */
  symbol: string;
  /** The normalized root spelling used in `symbol`. */
  rootName: string;
  quality: string;
  /** The typed text already names exactly this chord. */
  exact: boolean;
  /** Every chord tone sits inside the key scale. */
  diatonic: boolean;
  stage: 'triad' | 'extension';
}

/** Suffixes that keep the user in the TRIAD stage (longest-first matching).
 *  sus is NOT here — in this codebase's vocabulary sus is an extension
 *  (overlay EXTENSION_IDS), so "Csus2"/"Csus4" reach the extension stage. */
const TRIAD_STAGE_SUFFIXES = ['min', 'maj', 'dim', 'aug', 'm', 'M', '-', '°', 'o', '+'];
/** The four triads offered while typing a root or root+quality — never an
 *  extension (spec §3: "only suggest triads"). */
const TRIAD_COMPLETION_SUFFIXES = ['', 'm', 'dim', 'aug'] as const;
/** Canonical suffix vocabulary of the shared grammar — one entry per
 *  ChordQuality, in stable display order. Filtered through parseChord at
 *  module init so grammar drift can never leak into the dropdown. */
const CANONICAL_SUFFIXES = [
  '', 'm', 'dim', 'aug', 'sus2', 'sus4', '5', '6', 'm6', '6/9', 'm6/9',
  '7', 'maj7', 'm7', 'm7b5', 'dim7', 'mMaj7', 'aug7', 'augmaj7',
  '7sus4', '7sus2', '9', 'maj9', 'm9', '9sus4',
  '11', 'm11', 'maj11', '13', 'm13', 'maj13',
  'add9', 'add2', 'madd9', 'add11', 'add4',
] as const;
const EXTENSION_STAGE_SUFFIXES: readonly string[] = CANONICAL_SUFFIXES.filter((s) => parseChord(`C${s}`).ok);

const scaleOf = (key: ProjectKey | null): Set<PitchClass> | null =>
  key === null ? null : new Set(scalePitchClasses(key.tonic, key.mode) as PitchClass[]);

/** Every chord tone of `symbol` sits inside the key scale. */
export function isDiatonicSymbol(symbol: string, scale: Set<PitchClass> | null): boolean {
  if (scale === null) return false;
  const p = parseChord(symbol);
  if (!p.ok) return false;
  return p.chord.pitchClasses.every((pc) => scale.has(pc as PitchClass));
}

/** The key's own triads, scale-degree order — the empty-input starting menu
 *  (heptatonic modes only; the seven degrees must spell real triads). */
function diatonicTriadMenu(key: ProjectKey, scale: Set<PitchClass> | null, limit: number): ChordCompletion[] {
  if (scale === null) return [];
  const pcs = scalePitchClasses(key.tonic, key.mode);
  if (pcs.length !== 7 || new Set(pcs).size !== 7) return []; // non-heptatonic mode
  const out: ChordCompletion[] = [];
  for (let d = 0; d < 7; d++) {
    const root = pcs[d]!;
    const third = pcs[(d + 2) % 7]!;
    const fifth = pcs[(d + 4) % 7]!;
    const iv3 = (third - root + 12) % 12;
    const iv5 = (fifth - root + 12) % 12;
    const suffix = iv3 === 4 && iv5 === 7 ? '' : iv3 === 3 && iv5 === 7 ? 'm' : iv3 === 3 && iv5 === 6 ? 'dim' : null;
    if (suffix === null) continue;
    const rootName = normalizeChord(spelledNoteName(root as PitchClass), key);
    const symbol = `${rootName}${suffix}`;
    if (!parseChord(symbol).ok) continue;
    out.push({
      symbol, rootName,
      quality: suffix === '' ? 'major' : suffix === 'm' ? 'minor' : 'diminished',
      exact: false, diatonic: true, stage: 'triad',
    });
  }
  return out.slice(0, limit);
}

/**
 * Triad-only autocomplete for the inline chord text input (spec §3).
 *
 *  - bare root / root+triad-quality → the four triads of that root only;
 *  - extension marker typed → the shared-grammar extensions matching the
 *    typed prefix ("C7" → C7, C7sus2, C7sus4);
 *  - empty text → the key's diatonic triads;
 *  - ranking: exact match first, then diatonically relevant, then the fixed
 *    vocabulary order. Every offered symbol parses through the shared parser.
 */
export function suggestChordCompletions(raw: string, key: ProjectKey | null, limit = 12): ChordCompletion[] {
  const text = typeof raw === 'string' ? foldChordText(raw) : '';
  const scale = scaleOf(key);
  if (!text) return key !== null ? diatonicTriadMenu(key, scale, limit) : [];

  const rootMatch = /^([A-G][#b]?)/.exec(text);
  if (rootMatch === null) return [];
  const typedRoot = rootMatch[1];
  const rest = text.slice(typedRoot.length);

  let normRoot = typedRoot;
  if (key !== null) {
    try {
      normRoot = normalizeChord(typedRoot, key); // key-idiomatic dropdown spelling
    } catch {
      normRoot = typedRoot; // defensive: never block typing on a spelling rule
    }
  }

  const stage = triadOrExtension(rest);
  const suffixes: readonly string[] = stage === 'triad' ? TRIAD_COMPLETION_SUFFIXES : EXTENSION_STAGE_SUFFIXES;

  const out: Array<{ completion: ChordCompletion; idx: number }> = [];
  for (const suffix of suffixes) {
    const symbol = `${normRoot}${suffix}`;
    if (stage === 'extension' && !symbol.startsWith(text)) continue; // prefix match
    const parsed = parseChord(symbol);
    if (!parsed.ok) continue; // grammar gate — one chord grammar, never two
    out.push({
      idx: out.length,
      completion: {
        symbol,
        rootName: normRoot,
        quality: parsed.chord.quality,
        exact: text === `${typedRoot}${suffix}`,
        diatonic: isDiatonicSymbol(symbol, scale),
        stage,
      },
    });
  }
  return out
    .sort((a, b) =>
      (a.completion.exact ? 0 : 1) - (b.completion.exact ? 0 : 1) ||
      (a.completion.diatonic ? 0 : 1) - (b.completion.diatonic ? 0 : 1) ||
      a.idx - b.idx)
    .slice(0, limit)
    .map((e) => e.completion);
}

/** Triad stage while the typed rest is empty or exactly a triad-quality
 *  suffix; extension stage the moment an extension marker appears. */
function triadOrExtension(rest: string): 'triad' | 'extension' {
  if (rest === '') return 'triad';
  const triad = TRIAD_STAGE_SUFFIXES.find((s) => s !== '' && rest.startsWith(s));
  if (triad !== undefined) return rest === triad ? 'triad' : 'extension';
  return 'extension';
}

// ---------------------------------------------------------------------------
// §4 — enharmonic normalization of chord text
// ---------------------------------------------------------------------------

export type NormalizeChordTextResult =
  | { ok: true; symbol: string; chord: Chord }
  | { ok: false; error: string };

/**
 * Normalizes chord TEXT for the project key (spec §4): root and slash bass
 * through normalizeChord (key-idiomatic spelling, explicit valid spellings
 * preserved), the quality/extension suffix verbatim, the pitch class
 * verified to never move. The result always parses through the shared
 * grammar and carries confidence 1 (user-authored).
 */
export function normalizeChordText(raw: string, key: ProjectKey): NormalizeChordTextResult {
  const p = parseChordText(raw);
  if (!p.ok) return { ok: false, error: p.error };
  const { rootName, qualitySuffix, bassName } = p.parts;
  let root: string;
  let bass: string | null;
  try {
    root = normalizeChord(rootName, key);
    bass = bassName !== null ? normalizeChord(bassName, key) : null;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const symbol = `${root}${qualitySuffix}${bass !== null ? `/${bass}` : ''}`;
  const reparsed = parseChord(symbol);
  if (!reparsed.ok) return { ok: false, error: reparsed.error };
  const originalPc = pcOfNoteName(rootName as NoteName);
  if (originalPc !== null && reparsed.chord.root !== originalPc) {
    return { ok: false, error: `normalization changed the pitch class of "${rootName}"` };
  }
  const chord = chordFromSymbol(symbol, { confidence: 1 });
  if (!chord.ok) return { ok: false, error: chord.error.message };
  return { ok: true, symbol, chord: chord.chord };
}

// ---------------------------------------------------------------------------
// §5 — text → MIDI (the §"MIDI Generation" voicing rules)
// ---------------------------------------------------------------------------

export interface ChordTextVoicing {
  /** The normalized chord name (normalizeChordText output). */
  symbol: string;
  /** Close voicing, C4-centered default, bass ≤ uppers, MIDI 36–84 guard. */
  notes: VoicedNote[];
  bassNote: NoteName;
}

export type ChordTextVoicingResult =
  | { ok: true; voicing: ChordTextVoicing }
  | { ok: false; error: string };

/** Normalizes the text, then voices the normalized symbol. Returns both the
 *  MIDI note list and the normalized chord name (spec §5). */
export function voiceChordText(raw: string, key: ProjectKey, options: VoicingOptions = {}): ChordTextVoicingResult {
  const n = normalizeChordText(raw, key);
  if (!n.ok) return { ok: false, error: n.error };
  const v: VoicingResult = voiceChordSymbol(n.symbol, options);
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true, voicing: { symbol: v.chordName, notes: v.notes, bassNote: v.bassNote } };
}

// ---------------------------------------------------------------------------
// §6 — the track update ("Rename Chord" transaction)
// ---------------------------------------------------------------------------

/** Label of the undo step a text-entry rename produces (spec §6 step 1). */
export const RENAME_TRANSACTION_LABEL = 'Rename Chord';

export type ChordTextApplyOutcome =
  | { ok: true; clip: ChordClip; snapshot: ClipSnapshot; symbol: string; notes: Pitch[] }
  | { ok: false; reason: 'invalid'; error: string }
  | { ok: false; reason: 'ambiguous'; interpretations: Chord[] }
  | { ok: false; reason: 'unrecognized-midi'; analysis: ChordAnalysis; message: string }
  | { ok: false; reason: 'drift'; drift: ClipDrift }
  | { ok: false; reason: 'locked'; message: string }
  | { ok: false; reason: 'error'; error: string };

export interface ChordTextApplyOptions {
  /** What the editor remembered about the clip when it opened (drift guard). */
  snapshot?: ClipSnapshot | null;
  /** The user confirmed replacement of unrecognized user MIDI (spec §6). */
  confirmUnsafe?: boolean;
  /** Voicing escape hatch (octave offset) — same rules otherwise. */
  voicingOptions?: VoicingOptions;
}

/** Two or more notes the analyzer cannot explain = substantial user MIDI. */
const UNRECOGNIZED_MIDI_MIN_NOTES = 2;

/**
 * The whole text-entry rename (spec §6) as one testable function.
 *
 * Order of guards — every rejection below happens BEFORE any transaction is
 * opened, so a rejected rename can never have touched the clip:
 *  1. invalid text → 'invalid' (+ inline message; no modification);
 *  2. ambiguous text ('Csus') → 'ambiguous' with both readings; the UI must
 *     make the user choose one and re-invoke with the chosen symbol;
 *  3. the clip vanished / moved / was note-edited since the editor opened →
 *     'drift' (non-destructive warning, never overwritten automatically);
 *  4. the clip holds ≥ 2 notes the analyzer cannot read as any chord →
 *     'unrecognized-midi' (warn before replacing; the UI re-invokes with
 *     confirmUnsafe once the user confirms);
 * then the write, in the spec's own order, inside ONE "Rename Chord"
 * transaction: clear the clip's notes → write the calculated voicing →
 * update the displayed name → commit. Position, length, track assignment and
 * metadata are preserved by the adapter (rule 3). Any failure cancels the
 * transaction — the original chord and MIDI are restored exactly.
 */
export function applyChordTextToClip(
  api: ApplyApi,
  clipId: string,
  raw: string,
  key: ProjectKey,
  opts: ChordTextApplyOptions = {},
): ChordTextApplyOutcome {
  // Structural guard first: a locked or missing chord lane accepts no writes
  // at all — refused before any transaction, nothing to roll back.
  if (api.isLaneEditable?.() === false) {
    return { ok: false, reason: 'locked', message: 'The chord lane is locked (or missing) — the chord was not renamed. Unlock the Chords track to edit chords.' };
  }
  // 1+2. Grammar and ambiguity first — unusable text never opens a transaction.
  const interp = interpretChordText(raw);
  if (interp.status === 'invalid') return { ok: false, reason: 'invalid', error: interp.error };
  if (interp.status === 'ambiguous') return { ok: false, reason: 'ambiguous', interpretations: interp.interpretations };

  // 3 (§4). Key-idiomatic spelling; pitch class verified unchanged.
  const normalized = normalizeChordText(raw, key);
  if (!normalized.ok) return { ok: false, reason: 'invalid', error: normalized.error };

  // 4 (§5). The replacement voicing — computed before any write.
  const voiced = voiceChordSymbol(normalized.symbol, opts.voicingOptions);
  if (!voiced.ok) return { ok: false, reason: 'invalid', error: voiced.error };

  // Locate + guard the clip (non-destructive: warn, never overwrite).
  const live = api.getChordClipById(clipId);
  if (live === null) return { ok: false, reason: 'drift', drift: 'missing' };
  const drift = clipDrift(opts.snapshot ?? null, live);
  if (drift !== null) return { ok: false, reason: 'drift', drift };

  // Substantial user MIDI no chord reading explains → warn before replacing.
  const existing = live.rawMidiNotes ?? [];
  if (existing.length >= UNRECOGNIZED_MIDI_MIN_NOTES && opts.confirmUnsafe !== true) {
    const analysis = parseChordClipView(live); // context-free verdict by design
    if (analysis.status === 'unknown') {
      return {
        ok: false,
        reason: 'unrecognized-midi',
        analysis,
        message: `This clip's ${existing.length} notes do not read as a recognizable chord — replacing them with ${normalized.symbol} overwrites your MIDI.`,
      };
    }
  }

  try {
    api.beginUndoTransaction(RENAME_TRANSACTION_LABEL);
    api.clearMidiNotes(clipId); // spec order: clear → write → rename
    api.replaceMidiNotes(clipId, voicingToPitches(voiced, live.startTime, live.lengthTicks));
    api.renameChordClip(clipId, normalized.symbol);
    api.commitUndoTransaction();
    const fresh = api.getChordClipById(clipId);
    if (fresh === null) return { ok: false, reason: 'drift', drift: 'missing' }; // defensive
    return {
      ok: true,
      clip: fresh,
      snapshot: takeClipSnapshot(fresh),
      symbol: normalized.symbol,
      notes: fresh.rawMidiNotes ?? [],
    };
  } catch (err) {
    // DAW operation failed: cancel → the original chord and MIDI are restored.
    try {
      if (api.isTransactionActive()) api.cancelUndoTransaction();
    } catch {
      /* the transaction was already closed by the failure path */
    }
    return { ok: false, reason: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
