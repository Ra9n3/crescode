/**
 * Pure bridges between crescode's schema and the suggestion domain contracts.
 * No store access, no rng, no I/O — every function here is total and
 * deterministic, which keeps the contracts unit-testable without a host.
 */
import {
  NOTE_NAMES, PPQ, parseChord,
  barTicks, beatTicks, pulseTicks, isCompound, tickToBarBeat, ticksToSeconds,
  type Chord as ChordEvent, type ModeName, type Note, type PitchClass,
  type Project, type TimeSignature,
} from '../../shared/schema';
import {
  isPitchClass, type Chord, type ChordClip, type ClipMetadata, type GridResolution,
  type NoteName, type Pitch, type ProjectKey, type TimePosition, SuggestionError,
  type ChordQuality, type ChordExtension,
} from './types';

/** Pitch class of a spelled note ("C"→0, "Db"→1, "F#"→6). null on garbage —
 *  the template-literal NoteName type prevents most, not runtime input. */
export function pcOfNoteName(name: NoteName): PitchClass | null {
  const m = /^([A-G])(#|b|♯|♭)?$/.exec(name);
  if (!m) return null;
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = base[m[1]];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  const normalized = ((pc % 12) + 12) % 12;
  return isPitchClass(normalized) ? normalized : null;
}

/** Crescent's canonical spelling for a pitch class (mixed accidentals). */
export function spelledNoteName(pc: number): NoteName {
  return NOTE_NAMES[((pc % 12) + 12) % 12] as NoteName;
}

/** Decorate a native Note into a Pitch. */
export function pitchOf(note: Note, spelling?: NoteName): Pitch {
  const midi = note.pitch;
  return {
    midi,
    pitchClass: (((midi % 12) + 12) % 12) as PitchClass,
    spelling: spelling ?? spelledNoteName(midi),
    octave: Math.floor(midi / 12) - 1,
    velocity: note.velocity,
    startTick: note.startTick,
    durationTicks: note.durationTicks,
  };
}

export function pitchesFromNotes(notes: readonly Note[]): Pitch[] {
  return notes.map((n) => pitchOf(n));
}

/** Derived position view — `tick` stays the single source of truth. */
export function timePositionOf(tick: number, ts: TimeSignature, bpm?: number): TimePosition {
  const { bar, beat } = tickToBarBeat(tick, ts);
  return { tick, bar, beat, seconds: bpm !== undefined ? ticksToSeconds(tick, bpm) : null };
}

export function gridResolutionOf(ts: TimeSignature): GridResolution {
  return {
    ppq: PPQ,
    timeSignature: ts,
    ticksPerBar: barTicks(ts),
    ticksPerBeat: beatTicks(ts),
    ticksPerPulse: pulseTicks(ts),
    compound: isCompound(ts),
  };
}

/** Analyze a chord symbol through the SHARED parser — the only chord-name
 *  grammar in crescode. confidence defaults to 1 (user-authored); pass
 *  analysis values and source pitch classes where they exist. */
export function chordFromSymbol(
  symbol: string,
  source?: { confidence?: number; sourcePitchClasses?: PitchClass[] },
): { ok: true; chord: Chord } | { ok: false; error: SuggestionError } {
  const r = parseChord(symbol);
  if (!r.ok) return { ok: false, error: new SuggestionError('invalid-chord-name', r.error) };
  const c = r.chord;
  // Chord pcs ordered from the root (intervals may exceed 12; dedupe enharmonic repeats).
  const rootOrderedPcs = c.intervals
    .map((i) => ((c.root + i) % 12 + 12) % 12)
    .filter((v, idx, a) => a.indexOf(v) === idx);
  const inversion = c.bass === null
    ? 0
    : rootOrderedPcs.indexOf(c.bass) >= 0
      ? rootOrderedPcs.indexOf(c.bass)
      : null;
  return {
    ok: true,
    chord: {
      rootPc: c.root as PitchClass,
      rootName: c.rootName as NoteName,
      quality: c.quality as ChordQuality,
      extensions: c.extensions as ChordExtension[],
      bassNote: c.bassName !== null ? (c.bassName as NoteName) : null,
      inversion,
      spelling: c.symbol,
      confidence: source?.confidence ?? 1,
      sourcePitchClasses: source?.sourcePitchClasses ?? [],
    },
  };
}

/** The chord's own sounding pitch classes (root-ordered, deduped, mod 12),
 *  derived through the SHARED parser from the chord's spelling — the
 *  contract `Chord` stays a plain symbol-carrying record. */
export function chordPitchClasses(chord: Chord): PitchClass[] {
  const parsed = parseChord(chord.spelling);
  if (!parsed.ok) return [chord.rootPc];
  const pcs: PitchClass[] = [];
  for (const interval of parsed.chord.intervals) {
    const pc = ((((chord.rootPc + interval) % 12) + 12) % 12) as PitchClass;
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  return pcs.length > 0 ? pcs : [chord.rootPc];
}

/** Materialize a ChordClip view over a lane event. */
export function chordClipOf(
  event: ChordEvent,
  opts?: {
    rawMidiNotes?: Pitch[] | null;
    confidence?: number;
    alternativeInterpretations?: Chord[];
    metadata?: ClipMetadata;
  },
): { ok: true; clip: ChordClip } | { ok: false; error: SuggestionError } {
  const analyzed = chordFromSymbol(event.symbol, {
    confidence: opts?.confidence ?? 1,
    sourcePitchClasses: opts?.rawMidiNotes?.map((n) => n.pitchClass),
  });
  if (!analyzed.ok) return analyzed;
  return {
    ok: true,
    clip: {
      id: event.id,
      startTime: event.startTick,
      lengthTicks: event.durationTicks,
      chord: analyzed.chord,
      rawMidiNotes: opts?.rawMidiNotes ?? null,
      confidence: opts?.confidence ?? 1,
      alternativeInterpretations: opts?.alternativeInterpretations ?? [],
      metadata: opts?.metadata ?? {},
    },
  };
}

export function projectKeyOf(p: Pick<Project, 'key' | 'mode'>): ProjectKey {
  return { tonic: p.key, mode: p.mode, spelling: 'mixed' };
}

/** Ionian scale-degree semitone offsets (mode → its parent major's root). */
export const IONIAN_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;
/** Circle-of-fifths position of each major-root pitch class (sharps positive). */
const FIFTHS_OF_MAJOR_ROOT: Record<PitchClass, number> = {
  0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6,
  1: -5, 8: -4, 3: -3, 10: -2, 5: -1,
};
/** Parent-major scale degree per mode; null for non-heptatonic modes. */
export const PARENT_MAJOR_DEGREE: Partial<Record<ModeName, number>> = {
  Ionian: 0, Dorian: 1, Phrygian: 2, Lydian: 3, Mixolydian: 4, Aeolian: 5, Locrian: 6,
  'Harmonic Minor': 5, 'Melodic Minor': 5,
};

/** Conventional key-signature label ("no accidentals", "1 sharp", "3 flats").
 *  null for modes with no heptatonic signature (Whole Tone, Diminished). */
export function keySignatureLabel(key: ProjectKey): string | null {
  const degree = PARENT_MAJOR_DEGREE[key.mode];
  if (degree === undefined) return null;
  const majorRoot = ((key.tonic - IONIAN_STEPS[degree]) % 12 + 12) % 12;
  const fifths = FIFTHS_OF_MAJOR_ROOT[majorRoot as PitchClass];
  if (fifths === 0) return 'no accidentals';
  return fifths > 0
    ? `${fifths} sharp${fifths > 1 ? 's' : ''}`
    : `${-fifths} flat${fifths < -1 ? 's' : ''}`;
}
