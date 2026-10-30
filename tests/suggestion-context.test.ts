/**
 * Smart Chord Suggestion — DAW state reader tests (feature spec §4).
 * readChordContextAt against an in-memory ChordTrackAPI fake: boundary
 * semantics, empty regions, overlapping clips, MIDI-backed vs user-typed
 * clips, and the reading-only guarantee (the fake records any mutation).
 */
import { describe, expect, it } from 'vitest';
import type { Chord as ChordEvent, TimeSignature } from '../src/shared/schema';
import {
  SuggestionError, chordClipOf, gridResolutionOf, pitchOf, projectKeyOf, readChordContextAt,
  type ChordClip, type ChordTrackAPI, type GridResolution, type MidiClip, type Pitch,
  type ProjectKey, type Unsubscribe, type UndoTransaction, type DoubleClickHandler,
} from '../src/engine/suggestion';

const TS44: TimeSignature = { numerator: 4, denominator: 4 };
const note = (midi: number, startTick: number, durationTicks = 1920, velocity = 100): Pitch =>
  pitchOf({ pitch: midi, startTick, durationTicks, velocity });

const event = (id: string, symbol: string, startTick: number, durationTicks: number): ChordEvent =>
  ({ id, symbol, startTick, durationTicks });

const midiBacked = (id: string, symbol: string, startTick: number, durationTicks: number, midis: number[]): ChordClip => {
  const r = chordClipOf(event(id, symbol, startTick, durationTicks), {
    rawMidiNotes: midis.map((m) => note(m, startTick)),
    confidence: 0.8,
    metadata: { lane: 'chords' },
  });
  if (!r.ok) throw r.error;
  return r.clip;
};

const typed = (id: string, symbol: string, startTick: number, durationTicks: number): ChordClip => {
  const r = chordClipOf(event(id, symbol, startTick, durationTicks), { metadata: { lane: 'chords' } });
  if (!r.ok) throw r.error;
  return r.clip;
};

/** Conforming in-memory adapter: reads are real, every write is recorded and
 *  refused — the reader must never trigger one. */
class ReaderFake implements ChordTrackAPI {
  readonly mutations: string[] = [];
  constructor(
    private readonly clips: ChordClip[],
    private readonly key: ProjectKey = projectKeyOf({ key: 0, mode: 'Ionian' }),
    private readonly grid: GridResolution = gridResolutionOf(TS44),
  ) {}
  getProjectKeySignature(): ProjectKey { return this.key; }
  getGridResolution(): GridResolution { return this.grid; }
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
  private refuse(op: string): never {
    this.mutations.push(op);
    throw new SuggestionError('no-transaction', `${op} called by the reader — state readers must not mutate`);
  }
  createMidiClip(): MidiClip { return this.refuse('createMidiClip'); }
  getMidiNotes(clipId: string): Pitch[] {
    return this.clips.find((c) => c.id === clipId)?.rawMidiNotes ?? [];
  }
  replaceMidiNotes(): void { this.refuse('replaceMidiNotes'); }
  clearMidiNotes(): void { this.refuse('clearMidiNotes'); }
  renameChordClip(): void { this.refuse('renameChordClip'); }
  subscribeToDoubleClick(_trackId: string, _callback: DoubleClickHandler): Unsubscribe {
    return () => undefined;
  }
  beginUndoTransaction(label: string): UndoTransaction { return this.refuse(`beginUndoTransaction(${label})`); }
  commitUndoTransaction(): void { this.refuse('commitUndoTransaction'); }
  cancelUndoTransaction(): void { this.refuse('cancelUndoTransaction'); }
}

const makeApi = (): ChordTrackAPI => new ReaderFake([
  typed('c1', 'C', 0, 3840),
  midiBacked('c2', 'Am7', 3840, 3840, [57, 60, 64, 67]), // A C E G sounding under the symbol
  typed('c3', 'F', 11520, 3840),
]);

describe('readChordContextAt', () => {
  it('returns previous, current and next around a MIDI-backed clip', () => {
    const read = readChordContextAt(makeApi(), 5000);
    expect(read.time).toBe(5000);
    expect(read.previousChordClip?.clip.id).toBe('c1');
    expect(read.currentChordClip?.clip.id).toBe('c2');
    expect(read.nextChordClip?.clip.id).toBe('c3');
  });

  it('carries parsed chord, raw MIDI notes, confidence and alternatives', () => {
    const read = readChordContextAt(makeApi(), 5000);
    const entry = read.currentChordClip!;
    expect(entry.clip.chord.spelling).toBe('Am7');       // parsed chord
    expect(entry.clip.rawMidiNotes).toHaveLength(4);      // raw MIDI notes
    expect(entry.analysis).not.toBeNull();                // fresh analysis
    expect(entry.analysis!.confidence).toBeGreaterThanOrEqual(0);
    expect(entry.analysis!.confidence).toBeLessThanOrEqual(100);
    expect(entry.analysis!.chord?.rootPc).toBe(9);
    expect(entry.analysis!.alternatives.length).toBeGreaterThan(0);
    // user-typed neighbor: no MIDI backing → no analysis, contract confidence 1
    const prev = read.previousChordClip!;
    expect(prev.clip.chord.confidence).toBe(1);
    expect(prev.analysis).toBeNull();
  });

  it('returns nulls safely in empty regions and at the track edges', () => {
    const gap = readChordContextAt(makeApi(), 9000);
    expect(gap.currentChordClip).toBeNull();
    expect(gap.previousChordClip?.clip.id).toBe('c2');
    expect(gap.nextChordClip?.clip.id).toBe('c3');

    const start = readChordContextAt(makeApi(), 0);
    expect(start.previousChordClip).toBeNull();
    expect(start.currentChordClip?.clip.id).toBe('c1');
    expect(start.nextChordClip?.clip.id).toBe('c2');

    const after = readChordContextAt(makeApi(), 20000);
    expect(after.previousChordClip?.clip.id).toBe('c3');
    expect(after.currentChordClip).toBeNull();
    expect(after.nextChordClip).toBeNull();

    const empty = readChordContextAt(new ReaderFake([]), 100);
    expect(empty.previousChordClip).toBeNull();
    expect(empty.currentChordClip).toBeNull();
    expect(empty.nextChordClip).toBeNull();
  });

  it('a clip starting exactly at the requested time is current, not next', () => {
    const read = readChordContextAt(makeApi(), 3840); // exact start of c2 / exact end of c1
    expect(read.previousChordClip?.clip.id).toBe('c1'); // ends exactly at T
    expect(read.currentChordClip?.clip.id).toBe('c2');  // sounds from T
    expect(read.nextChordClip?.clip.id).toBe('c3');     // c2 is not its own next
  });

  it('handles overlapping clips deterministically', () => {
    const api = new ReaderFake([
      typed('a', 'C', 0, 3840),
      typed('b', 'G', 1920, 3840),  // overlaps a ([1920, 5760) vs [0, 3840))
      typed('c', 'F', 7680, 3840),
    ]);
    const insideBoth = readChordContextAt(api, 2500);
    expect(insideBoth.currentChordClip?.clip.id).toBe('b');   // later start wins
    expect(insideBoth.previousChordClip).toBeNull();          // nothing ends ≤ 2500
    expect(insideBoth.nextChordClip?.clip.id).toBe('c');

    const afterOverlap = readChordContextAt(api, 6000);
    expect(afterOverlap.previousChordClip?.clip.id).toBe('b'); // greatest end ≤ T
    expect(afterOverlap.currentChordClip).toBeNull();
    expect(afterOverlap.nextChordClip?.clip.id).toBe('c');
  });

  it('never mutates DAW state (every write method stays untouched)', () => {
    const api = makeApi();
    for (const t of [0, 3840, 5000, 9000, 12000, 20000]) readChordContextAt(api, t);
    expect((api as ReaderFake).mutations).toEqual([]);
  });

  it('rejects invalid time positions with the contract error code', () => {
    expect(() => readChordContextAt(makeApi(), -1)).toThrowError(SuggestionError);
    expect(() => readChordContextAt(makeApi(), 1.5)).toThrowError(/integer ≥ 0/);
  });
});
