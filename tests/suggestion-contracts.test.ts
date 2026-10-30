/**
 * Smart Chord Suggestion — contract tests. One example per major type plus
 * every validation rule and the adapter's transaction/write contract, proven
 * against a minimal in-memory ChordTrackAPI implementation (spec stage: the
 * real adapter wraps the store; the contract is what these tests pin).
 */
import { describe, expect, it } from 'vitest';
import type { Chord as ChordEvent, TimeSignature } from '../src/shared/schema';
import {
  CHORD_LANE_TRACK_ID, CHORD_QUALITIES, SUGGESTION_COLOR_CATEGORIES,
  SuggestionError, chordClipOf, chordFromSymbol, gridResolutionOf, isChordExtension,
  isChordQuality, isPitchClass, keySignatureLabel, pcOfNoteName, pitchOf,
  projectKeyOf, spelledNoteName, timePositionOf,
  assertInTransaction, assertNoOpenTransaction, assertTransactionOpen,
  validateChord, validateChordName, validateGap, validateNoClipOverlap,
  validatePitch, validateSuggestion, validateTimeRange,
  type ChordCandidate, type ChordClip, type ChordTrackAPI, type DoubleClickHandler,
  type GridResolution, type MidiClip, type Pitch, type ProjectKey, type Suggestion,
  type TimePosition, type Unsubscribe, type UndoTransaction,
} from '../src/engine/suggestion';

const TS44: TimeSignature = { numerator: 4, denominator: 4 };

describe('NoteName', () => {
  it('resolves both accidentals to the same pitch class', () => {
    expect(pcOfNoteName('C')).toBe(0);
    expect(pcOfNoteName('C#')).toBe(1);
    expect(pcOfNoteName('Db')).toBe(1);
    expect(pcOfNoteName('F#')).toBe(6);
    expect(pcOfNoteName('Gb')).toBe(6);
    expect(pcOfNoteName('Eb')).toBe(3);
    expect(pcOfNoteName('Bb')).toBe(10);
  });
  it('produces crescode canon (mixed accidentals) from a midi number', () => {
    expect(spelledNoteName(63)).toBe('Eb');
    expect(spelledNoteName(60)).toBe('C');
    expect(spelledNoteName(66)).toBe('F#');
  });
  it('rejects garbage at runtime despite the type', () => {
    expect(pcOfNoteName('X#' as never)).toBeNull();
  });
});

describe('PitchClass', () => {
  it('accepts 0–11 integers only', () => {
    for (let i = 0; i <= 11; i++) expect(isPitchClass(i)).toBe(true);
    expect(isPitchClass(12)).toBe(false);
    expect(isPitchClass(-1)).toBe(false);
    expect(isPitchClass(1.5)).toBe(false);
    expect(isPitchClass('4')).toBe(false);
  });
});

describe('Pitch', () => {
  const note = { pitch: 63, startTick: 0, durationTicks: 480, velocity: 90 };
  it('decorates a native Note with spelling and octave', () => {
    const p = pitchOf(note);
    expect(p).toMatchObject({ midi: 63, pitchClass: 3, spelling: 'Eb', octave: 4, velocity: 90 });
    expect(validatePitch(p).ok).toBe(true);
  });
  it('rule: invalid MIDI notes are caught field by field', () => {
    const base = pitchOf(note);
    expect(validatePitch({ ...base, midi: 128 }).ok).toBe(false);
    expect(validatePitch({ ...base, pitchClass: 0 }).ok).toBe(false); // disagrees with midi
    expect(validatePitch({ ...base, spelling: 'C#' }).ok).toBe(false); // disagrees with pc
    expect(validatePitch({ ...base, octave: 5 }).ok).toBe(false);
    expect(validatePitch({ ...base, velocity: 0 }).ok).toBe(false);
    expect(validatePitch({ ...base, durationTicks: 0 }).ok).toBe(false);
  });
});

describe('ChordQuality', () => {
  it('covers the shared parser output set', () => {
    expect(CHORD_QUALITIES.length).toBeGreaterThanOrEqual(30);
    for (const q of ['major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4', 'power', 'maj7', '7'] as const) {
      expect(isChordQuality(q)).toBe(true);
    }
    expect(isChordQuality('minor7')).toBe(false);
    const samples: Array<[string, string]> = [
      ['C', 'major'], ['Cm', 'minor'], ['Cdim', 'diminished'], ['Caug', 'augmented'],
      ['Csus4', 'sus4'], ['C5', 'power'], ['Cmaj7', 'maj7'], ['C7b9', '7'],
    ];
    for (const [sym, quality] of samples) {
      const r = chordFromSymbol(sym);
      expect(r.ok, sym).toBe(true);
      if (r.ok) expect(r.chord.quality, sym).toBe(quality);
    }
  });
});

describe('ChordExtension', () => {
  it('accepts the parser token grammar, rejects the rest', () => {
    for (const e of ['none', '7', 'maj7', '9', 'add9', 'sus4', 'b9', '#11', 'b13']) {
      expect(isChordExtension(e)).toBe(true);
    }
    expect(isChordExtension('flat-nine')).toBe(false);
    expect(isChordExtension(9)).toBe(false);
  });
});

describe('Chord', () => {
  it('analyzes a user-typed symbol with confidence 1 and no source', () => {
    const r = chordFromSymbol('Cmaj7');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chord).toMatchObject({
      rootPc: 0, rootName: 'C', quality: 'maj7', extensions: [],
      bassNote: null, inversion: 0, spelling: 'Cmaj7', confidence: 1, sourcePitchClasses: [],
    });
    expect(validateChord(r.chord).ok).toBe(true);
  });
  it('separates base quality from extensions and tracks inversions', () => {
    const seven = chordFromSymbol('C7b9');
    if (seven.ok) {
      expect(seven.chord.quality).toBe('7');
      expect(seven.chord.extensions).toEqual(['b9']);
    }
    const slash = chordFromSymbol('C/E');
    if (slash.ok) {
      expect(slash.chord.bassNote).toBe('E');
      expect(slash.chord.inversion).toBe(1);
    }
    const third = chordFromSymbol('Am7/G');
    if (third.ok) {
      expect(third.chord.rootName).toBe('A');
      expect(third.chord.bassNote).toBe('G');
      expect(third.chord.inversion).toBe(3);
    }
  });
  it('rule: invalid chord names fail through the shared parser', () => {
    const bad = chordFromSymbol('Qwerty7');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('invalid-chord-name');
    expect(validateChordName('Xyz7').ok).toBe(false);
    expect(validateChordName('C7b9').ok).toBe(true);
  });
  it("rule: 'none' cannot be combined with real extensions", () => {
    const r = chordFromSymbol('C7');
    if (r.ok) {
      expect(validateChord({ ...r.chord, extensions: ['none', 'b9'] }).ok).toBe(false);
      expect(validateChord({ ...r.chord, extensions: ['weird'] }).ok).toBe(false);
      expect(validateChord({ ...r.chord, confidence: 1.5 }).ok).toBe(false);
    }
  });
});

describe('ChordCandidate', () => {
  it('records what matched, what is missing and what is extra', () => {
    const cmaj7 = chordFromSymbol('Cmaj7');
    const am7 = chordFromSymbol('Am7');
    expect(cmaj7.ok && am7.ok).toBe(true);
    if (!cmaj7.ok || !am7.ok) return;
    const input = [0, 4, 7, 9];
    const candidate: ChordCandidate = {
      chord: cmaj7.chord,
      score: 0.72,
      confidence: 0.9,
      matchedPitchClasses: [0, 4, 7],
      missingPitchClasses: [11],
      extraPitchClasses: [9],
      alternativeInterpretations: [am7.chord], // Am7 explains all four input pcs
    };
    for (const pc of candidate.matchedPitchClasses) expect(input).toContain(pc);
    for (const pc of candidate.missingPitchClasses) expect(input).not.toContain(pc);
    for (const pc of candidate.extraPitchClasses) expect(input).toContain(pc);
    expect(candidate.alternativeInterpretations[0]!.spelling).toBe('Am7');
    expect(candidate.score >= 0 && candidate.score <= 1).toBe(true);
  });
});

describe('TimePosition', () => {
  it('keeps tick authoritative and derives bar/beat/seconds', () => {
    const zero: TimePosition = timePositionOf(0, TS44, 120);
    expect(zero).toEqual({ tick: 0, bar: 1, beat: 1, seconds: 0 });
    const mid = timePositionOf(5280, TS44, 120); // 1 bar + 1.5 beats in
    expect(mid.tick).toBe(5280);
    expect(mid.bar).toBe(2);
    expect(mid.beat).toBe(2);
    expect(mid.seconds).toBeCloseTo(2.75, 5);
  });
  it('seconds stay null without a tempo (no seconds in the model)', () => {
    expect(timePositionOf(3840, TS44).seconds).toBeNull();
  });
});

describe('GridResolution', () => {
  it('derives the native grid from the time signature', () => {
    const q: GridResolution = gridResolutionOf(TS44);
    expect(q).toMatchObject({ ppq: 960, ticksPerBar: 3840, ticksPerBeat: 960, ticksPerPulse: 960, compound: false });
    const e8: GridResolution = gridResolutionOf({ numerator: 6, denominator: 8 });
    expect(e8).toMatchObject({ ticksPerBar: 2880, ticksPerPulse: 480, ticksPerBeat: 1440, compound: true });
  });
});

describe('MidiClip', () => {
  it('windows notes with a track id (chord lane uses the sentinel)', () => {
    const notes: Pitch[] = [pitchOf({ pitch: 60, startTick: 0, durationTicks: 480, velocity: 80 })];
    const clip: MidiClip = {
      id: 'mc1', startTime: 3840, lengthTicks: 1920,
      trackId: CHORD_LANE_TRACK_ID, notes, metadata: { origin: 'suggestion' },
    };
    expect(clip.trackId).toBe(CHORD_LANE_TRACK_ID);
    expect(clip.startTime).toBe(3840);
    for (const n of clip.notes) expect(validatePitch(n).ok).toBe(true);
  });
});

describe('ChordClip', () => {
  const ev = (id: string, symbol: string, startTick: number, durationTicks: number): ChordEvent =>
    ({ id, symbol, startTick, durationTicks });
  it('materializes a view over a lane event', () => {
    const r = chordClipOf(ev('c1', 'Am7', 3840, 1920), { metadata: { lane: 'chords' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const clip: ChordClip = r.clip;
    expect(clip).toMatchObject({
      id: 'c1', startTime: 3840, lengthTicks: 1920,
      confidence: 1, rawMidiNotes: null, alternativeInterpretations: [], metadata: { lane: 'chords' },
    });
    expect(clip.chord.rootName).toBe('A');
    expect(clip.chord.quality).toBe('m7');
  });
  it('carries source MIDI pitch classes when analysis has input', () => {
    const r = chordClipOf(ev('c2', 'C7b9', 0, 960), {
      rawMidiNotes: [pitchOf({ pitch: 60, startTick: 0, durationTicks: 960, velocity: 100 })],
      confidence: 0.8,
    });
    if (r.ok) {
      expect(r.clip.chord.sourcePitchClasses).toEqual([0]);
      expect(r.clip.chord.extensions).toEqual(['b9']);
      expect(r.clip.rawMidiNotes).toHaveLength(1);
    }
  });
});

describe('Suggestion', () => {
  const chord = chordFromSymbol('G7');
  it('carries score, color category, reasons and a human explanation', () => {
    if (!chord.ok) throw chord.error;
    const s: Suggestion = {
      chord: chord.chord,
      score: 0.87,
      colorCategory: 'dominant',
      reasonCodes: ['fits-key-scale', 'resolves-prev-leading-tone'],
      contextExplanation: 'G7 pulls home from the bar-2 Am7.',
    };
    expect(validateSuggestion(s).ok).toBe(true);
    expect(SUGGESTION_COLOR_CATEGORIES).toContain(s.colorCategory);
  });
  it('rule: score and category are bounded', () => {
    if (!chord.ok) throw chord.error;
    const bad: Suggestion = {
      chord: chord.chord, score: 1.2, colorCategory: 'dominant',
      reasonCodes: ['x'], contextExplanation: 'y',
    };
    const unknown: Suggestion = { ...bad, score: 0.5, colorCategory: 'sparkly' as never };
    expect(validateSuggestion(bad).ok).toBe(false);
    expect(validateSuggestion(unknown).ok).toBe(false);
  });
});

describe('ProjectKey', () => {
  it('reads the project key/mode with crescode spelling canon', () => {
    const key: ProjectKey = projectKeyOf({ key: 4, mode: 'Aeolian' });
    expect(key).toEqual({ tonic: 4, mode: 'Aeolian', spelling: 'mixed' });
  });
  it('derives conventional key-signature labels (null for non-heptatonic)', () => {
    expect(keySignatureLabel(projectKeyOf({ key: 0, mode: 'Ionian' }))).toBe('no accidentals');
    expect(keySignatureLabel(projectKeyOf({ key: 4, mode: 'Aeolian' }))).toBe('1 sharp');
    expect(keySignatureLabel(projectKeyOf({ key: 3, mode: 'Ionian' }))).toBe('3 flats');
    expect(keySignatureLabel(projectKeyOf({ key: 2, mode: 'Dorian' }))).toBe('no accidentals');
    expect(keySignatureLabel(projectKeyOf({ key: 1, mode: 'Harmonic Minor' }))).toBe('4 sharps');
    expect(keySignatureLabel(projectKeyOf({ key: 0, mode: 'Whole Tone' }))).toBeNull();
  });
});

describe('validation rules', () => {
  it('overlapping clips: half-open spans, touching edges are legal', () => {
    expect(validateNoClipOverlap([
      { id: 'a', startTime: 0, lengthTicks: 1920 },
      { id: 'b', startTime: 1920, lengthTicks: 1920 },
    ]).ok).toBe(true);
    const bad = validateNoClipOverlap([
      { id: 'a', startTime: 0, lengthTicks: 1921 },
      { id: 'b', startTime: 1920, lengthTicks: 10 },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('overlapping-clips');
  });
  it('zero-length gaps are rejected; null (no gap) is fine', () => {
    expect(validateGap(null).ok).toBe(true);
    expect(validateGap({ startTime: 0, endTime: 960 }).ok).toBe(true);
    const zero = validateGap({ startTime: 480, endTime: 480 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe('zero-length-gap');
  });
  it('query ranges must be non-empty and ordered', () => {
    expect(validateTimeRange(0, 10).ok).toBe(true);
    expect(validateTimeRange(960, 960).ok).toBe(false);
    expect(validateTimeRange(-1, 10).ok).toBe(false);
  });
});

describe('ChordTrackAPI — transaction & write contract (in-memory fake)', () => {
  const ev = (id: string, symbol: string, startTick: number, durationTicks: number): ChordEvent =>
    ({ id, symbol, startTick, durationTicks });
  const clipOf = (id: string, symbol: string, startTick: number, durationTicks: number): ChordClip => {
    const r = chordClipOf(ev(id, symbol, startTick, durationTicks), { metadata: { lane: 'chords' } });
    if (!r.ok) throw r.error;
    return r.clip;
  };

  /** Minimal conforming implementation — the shape every real adapter must have. */
  class FakeChordTrack implements ChordTrackAPI {
    private clips: ChordClip[];
    private midiClips = new Map<string, MidiClip>();
    private nextId = 1;
    private tx: UndoTransaction | null = null;
    constructor(clips: ChordClip[]) { this.clips = clips; }
    getProjectKeySignature(): ProjectKey { return projectKeyOf({ key: 4, mode: 'Aeolian' }); }
    getGridResolution(): GridResolution { return gridResolutionOf(TS44); }
    getChordClipsInRange(startTime: number, endTime: number): ChordClip[] {
      return this.clips.filter((c) => c.startTime < endTime && c.startTime + c.lengthTicks > startTime);
    }
    getChordClipAt(time: number): ChordClip | null {
      return this.clips.find((c) => time >= c.startTime && time < c.startTime + c.lengthTicks) ?? null;
    }
    getPreviousChordClip(time: number): ChordClip | null {
      return this.clips.filter((c) => c.startTime + c.lengthTicks <= time).at(-1) ?? null;
    }
    getNextChordClip(time: number): ChordClip | null {
      return this.clips.find((c) => c.startTime >= time) ?? null;
    }
    getAvailableGapAt(time: number): { startTime: number; endTime: number } | null {
      if (this.getChordClipAt(time) !== null) return null;
      const prev = this.getPreviousChordClip(time);
      const next = this.getNextChordClip(time);
      const start = prev !== null ? prev.startTime + prev.lengthTicks : 0;
      const end = next !== null ? next.startTime : Number.POSITIVE_INFINITY;
      return end > start ? { startTime: start, endTime: end } : null;
    }
    createMidiClip(startTime: number, lengthTicks: number, trackId = CHORD_LANE_TRACK_ID): MidiClip {
      assertInTransaction(this.tx, 'createMidiClip');
      const clip: MidiClip = { id: `mc${this.nextId++}`, startTime, lengthTicks, trackId, notes: [], metadata: {} };
      this.midiClips.set(clip.id, clip);
      return clip;
    }
    getMidiNotes(clipId: string): Pitch[] {
      const clip = this.midiClips.get(clipId);
      if (clip === undefined) throw new SuggestionError('clip-not-found', clipId);
      return clip.notes;
    }
    replaceMidiNotes(clipId: string, notes: Pitch[]): void {
      assertInTransaction(this.tx, 'replaceMidiNotes');
      const clip = this.midiClips.get(clipId);
      if (clip === undefined) throw new SuggestionError('clip-not-found', clipId);
      for (const n of notes) {
        const v = validatePitch(n);
        if (!v.ok) throw v.error;
      }
      clip.notes = notes; // bounds/name/metadata untouched (rule 3)
    }
    clearMidiNotes(clipId: string): void {
      assertInTransaction(this.tx, 'clearMidiNotes');
      const clip = this.midiClips.get(clipId);
      if (clip === undefined) throw new SuggestionError('clip-not-found', clipId);
      clip.notes = [];
    }
    renameChordClip(clipId: string, chordName: string): void {
      assertInTransaction(this.tx, 'renameChordClip');
      const clip = this.clips.find((c) => c.id === clipId);
      if (clip === undefined) throw new SuggestionError('clip-not-found', clipId);
      const analyzed = chordFromSymbol(chordName);
      if (!analyzed.ok) throw analyzed.error;
      clip.chord = analyzed.chord; // id, position, length, metadata preserved (rule 3)
    }
    subscribeToDoubleClick(_trackId: string, _callback: DoubleClickHandler): Unsubscribe {
      return () => undefined;
    }
    beginUndoTransaction(label: string): UndoTransaction {
      assertNoOpenTransaction(this.tx);
      this.tx = { label };
      return this.tx;
    }
    commitUndoTransaction(): void { assertTransactionOpen(this.tx); this.tx = null; }
    cancelUndoTransaction(): void { assertTransactionOpen(this.tx); this.tx = null; }
  }

  const makeApi = (): ChordTrackAPI => new FakeChordTrack([
    clipOf('c1', 'C', 0, 3840),
    clipOf('c2', 'Am7', 3840, 3840),
    clipOf('c3', 'F', 11520, 3840),
  ]);

  const throwsCode = (fn: () => void, code: SuggestionError['code']): void => {
    try {
      fn();
      expect.fail(`expected SuggestionError ${code}`);
    } catch (e) {
      expect(e).toBeInstanceOf(SuggestionError);
      expect((e as SuggestionError).code).toBe(code);
    }
  };

  it('queries the chord lane in native ticks', () => {
    const api = makeApi();
    expect(api.getChordClipAt(4000)?.id).toBe('c2');
    expect(api.getChordClipAt(9000)).toBeNull();
    expect(api.getPreviousChordClip(9000)?.id).toBe('c2');
    expect(api.getNextChordClip(9000)?.id).toBe('c3');
    expect(api.getAvailableGapAt(9000)).toEqual({ startTime: 7680, endTime: 11520 });
    expect(api.getAvailableGapAt(4000)).toBeNull(); // inside a clip
    expect(api.getChordClipsInRange(3000, 9000).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(api.getProjectKeySignature().tonic).toBe(4);
    expect(api.getGridResolution().ticksPerBar).toBe(3840);
  });

  it('writes require an open transaction; transactions are not nestable', () => {
    const api = makeApi();
    throwsCode(() => api.createMidiClip(7680, 1920), 'no-transaction');
    throwsCode(() => api.renameChordClip('c1', 'C'), 'no-transaction');
    api.beginUndoTransaction('test');
    throwsCode(() => api.beginUndoTransaction('nested'), 'transaction-open');
    api.commitUndoTransaction();
    throwsCode(() => api.commitUndoTransaction(), 'transaction-not-open');
  });

  it('rename validates the symbol and preserves id, position, length, metadata', () => {
    const api = makeApi();
    const before = api.getChordClipAt(0)!;
    api.beginUndoTransaction('rename');
    throwsCode(() => api.renameChordClip('c1', 'Not A Chord'), 'invalid-chord-name');
    api.renameChordClip('c1', 'Csus2');
    api.commitUndoTransaction();
    const after = api.getChordClipAt(0)!;
    expect(after.chord.spelling).toBe('Csus2');
    expect(after.chord.quality).toBe('sus2');
    expect(after.id).toBe(before.id);
    expect(after.startTime).toBe(before.startTime);
    expect(after.lengthTicks).toBe(before.lengthTicks);
    expect(after.metadata).toEqual(before.metadata);
  });

  it('note replacement validates pitches and preserves the clip', () => {
    const api = makeApi();
    api.beginUndoTransaction('fill');
    const clip = api.createMidiClip(7680, 1920);
    expect(clip.trackId).toBe(CHORD_LANE_TRACK_ID);
    throwsCode(() => api.replaceMidiNotes(clip.id, [
      pitchOf({ pitch: 60, startTick: 7680, durationTicks: 480, velocity: 90 }),
      { ...pitchOf({ pitch: 60, startTick: 7680, durationTicks: 480, velocity: 90 }), midi: 128 },
    ]), 'invalid-midi-note');
    const valid = [
      pitchOf({ pitch: 60, startTick: 7680, durationTicks: 960, velocity: 90 }),
      pitchOf({ pitch: 64, startTick: 7680, durationTicks: 960, velocity: 90 }),
    ];
    api.replaceMidiNotes(clip.id, valid);
    expect(api.getMidiNotes(clip.id)).toHaveLength(2);
    api.cancelUndoTransaction(); // cancel is legal and closes cleanly
    expect(api.getChordClipAt(0)?.chord.spelling).toBe('C'); // chord lane untouched
  });
});
