/**
 * Smart Chord picker — the compact immediate-selection redesign.
 *
 * Covered: the short functional category labels, the compose+voice path
 * shared by tile picks and Advanced changes (grammar-gated extensions, slash
 * bass, octave anchor), and the whole immediate-selection write path through
 * the REAL crescode host adapter — one "Apply Smart Chord" undo step per
 * pick, repeated selections without self-drift, undo/redo transaction
 * boundaries, the non-destructive drift guard, and manual chord entry
 * (valid rename is one undo step; invalid text cancels and never modifies).
 */
import { describe, expect, it } from 'vitest';
import { projectFromFixture, type Chord as ChordEvent, type Project } from '../src/shared/schema';
import {
  APPLY_TRANSACTION_LABEL, applyChordComposition, categoryLabelOf, chordFromSymbol,
  composeForSuggestion, createCrescodeChordTrackApi, currentChordOf, nextVisibleCount,
  NO_OVERRIDES, PICKER_INITIAL_COUNT, PICKER_MORE_STEP, takeClipSnapshot,
  voiceChordSymbol,
  type ChordLaneHostIo, type ProjectKey,
} from '../src/engine/suggestion';

const TS44 = { numerator: 4, denominator: 4 };
const C_MAJOR: ProjectKey = { tonic: 0, mode: 'Ionian', spelling: 'mixed' };

const chord = (symbol: string) => {
  const r = chordFromSymbol(symbol);
  if (!r.ok) throw new Error(`fixture "${symbol}" must parse`);
  return r.chord;
};

// --- host harness with real undo/redo semantics (mirrors wire.ts) ------------

const makeProject = (chords: ChordEvent[] = []): Project => projectFromFixture({
  schemaVersion: 1, name: 'picker-test', bpm: 120,
  tempoMap: [{ tick: 0, bpm: 120 }], timeSignature: TS44,
  key: 0, mode: 'Ionian', sections: [], chords,
  referenceAudio: { path: null, offsetMs: 0 }, tracks: [], libraryGroups: [], masterVolume: 1,
});

function makeIo(project: Project) {
  const state = { project, dirty: false };
  const past: Project[] = [];
  const future: Project[] = [];
  const io: ChordLaneHostIo = {
    getProject: () => state.project,
    snapshot: () => ({ project: state.project, dirty: state.dirty }),
    putProject: (p) => { state.project = p; state.dirty = true; },
    endTransaction: (pre, mode) => {
      if (mode === 'cancel') { state.project = pre.project; state.dirty = pre.dirty; return; }
      past.push(pre.project); // one history entry per committed transaction
      future.length = 0;
      state.dirty = true;
    },
    isPlaying: () => false,
    now: () => 0,
    notify: () => undefined,
  };
  const undo = () => {
    if (past.length === 0) return;
    future.unshift(state.project);
    state.project = past.pop()!;
  };
  const redo = () => {
    if (future.length === 0) return;
    past.push(state.project);
    state.project = future.shift()!;
  };
  return { io, state, past, future, undo, redo };
}

/** A rig with one Smart clip at [3840, 7680) (one bar of 4/4). */
function makeRig() {
  const host = makeIo(makeProject([
    { id: 'p1', symbol: 'F', startTick: 0, durationTicks: 3840 },
    { id: 'n1', symbol: 'C', startTick: 7680, durationTicks: 3840 },
  ]));
  const api = createCrescodeChordTrackApi(host.io);
  api.beginUndoTransaction('Create Smart Chord Clip');
  const midiClip = api.createMidiClip(3840, 3840);
  api.commitUndoTransaction();
  const clipId = midiClip.id;
  const live = () => api.getChordClipById(clipId)!;
  return { api, host, clipId, live, snapshot: () => takeClipSnapshot(live()) };
}

// ---------------------------------------------------------------------------
// Short functional labels
// ---------------------------------------------------------------------------

describe('categoryLabelOf (tile secondary line)', () => {
  it('maps every engine category to a short musical function', () => {
    expect(categoryLabelOf('diatonic')).toBe('Diatonic');
    expect(categoryLabelOf('tonic')).toBe('Tonic');
    expect(categoryLabelOf('subdominant')).toBe('Subdominant');
    expect(categoryLabelOf('dominant')).toBe('Dominant');
    expect(categoryLabelOf('passing')).toBe('Passing');
    expect(categoryLabelOf('modal-color')).toBe('Modal color');
    expect(categoryLabelOf('borrowed')).toBe('Borrowed');
    expect(categoryLabelOf('cadential')).toBe('Cadential');
  });

  it('renders unknown categories generically, never as raw ids', () => {
    expect(categoryLabelOf('passing-chord')).toBe('Passing Chord');
    expect(categoryLabelOf('neo_rouch')).toBe('Neo Rouch');
  });
});

// ---------------------------------------------------------------------------
// Compose + voice — the path both tile picks and Advanced changes share
// ---------------------------------------------------------------------------

describe('composeForSuggestion (immediate selection composition)', () => {
  it('defaults reproduce the suggestion\'s own symbol and a legal voicing', () => {
    for (const symbol of ['Gm7', 'C', 'F', 'Bb', 'Dm7b5', 'A7']) {
      const composed = composeForSuggestion(chord(symbol), C_MAJOR, NO_OVERRIDES);
      expect(composed.ok, symbol).toBe(true);
      if (!composed.ok) continue;
      expect(composed.symbol, symbol).toBe(symbol); // no hidden respelling
      expect(composed.voicing.notes.length).toBeGreaterThan(0);
    }
    const c = composeForSuggestion(chord('Gm7'), C_MAJOR);
    expect(c.ok && c.voicing.notes.map((n) => n.midi)).toEqual([55, 58, 62, 65]);
  });

  it('extension override composes through the shared grammar (C + 7 → C7)', () => {
    const composed = composeForSuggestion(chord('C'), C_MAJOR, { ...NO_OVERRIDES, ext: '7' });
    expect(composed.ok && composed.symbol).toBe('C7');
  });

  it('bass override composes the slash chord (C over E)', () => {
    const composed = composeForSuggestion(chord('C'), C_MAJOR, { ...NO_OVERRIDES, bass: 'pc:4' });
    expect(composed.ok && composed.symbol).toBe('C/E');
  });

  it('octave override shifts the voicing anchor (+1 → +12 semitones)', () => {
    const base = composeForSuggestion(chord('C'), C_MAJOR, NO_OVERRIDES);
    const up = composeForSuggestion(chord('C'), C_MAJOR, { ...NO_OVERRIDES, octave: 1 });
    expect(base.ok && up.ok).toBe(true);
    if (!base.ok || !up.ok) return;
    expect(up.voicing.notes.map((n) => n.midi)).toEqual(base.voicing.notes.map((n) => n.midi + 12));
  });

  it('an extension the quality does not offer falls back to the chord\'s own shape', () => {
    // maj9 is not offered on a sus4 base — the picker never composes an
    // unparseable symbol, it falls back to the sus4's own extension id.
    const composed = composeForSuggestion(chord('Gsus4'), C_MAJOR, { ...NO_OVERRIDES, ext: 'maj9' });
    expect(composed.ok && composed.symbol).toBe('Gsus4');
  });
});

// ---------------------------------------------------------------------------
// Immediate selection — the write path through the real adapter
// ---------------------------------------------------------------------------

describe('applyChordComposition (immediate selection)', () => {
  it('one pick = one "Apply Smart Chord" undo step: notes + name written, bounds preserved', () => {
    const rig = makeRig();
    const outcome = applyChordComposition(rig.api, rig.clipId, chord('Gm7'), C_MAJOR, rig.snapshot());
    expect(outcome).toMatchObject({ ok: true });
    expect(rig.host.past).toHaveLength(2); // clip creation + this pick — nothing more

    const after = rig.live();
    expect(after.chord.spelling).toBe('Gm7');
    expect(after.startTime).toBe(3840); // position/length/track never touched
    expect(after.lengthTicks).toBe(3840);
    expect(rig.api.getMidiNotes(rig.clipId).map((n) => n.midi)).toEqual(voiceChordSymbol('Gm7').ok ? [55, 58, 62, 65] : []);
  });

  it('the transaction label is the spec label', () => {
    expect(APPLY_TRANSACTION_LABEL).toBe('Apply Smart Chord');
  });

  it('repeated selections keep applying: A → B → A, one undo step each, no self-drift', () => {
    const rig = makeRig();
    const first = applyChordComposition(rig.api, rig.clipId, chord('Gm7'), C_MAJOR, rig.snapshot());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyChordComposition(rig.api, rig.clipId, chord('Cm'), C_MAJOR, first.snapshot);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const third = applyChordComposition(rig.api, rig.clipId, chord('Gm7'), C_MAJOR, second.snapshot);
    expect(third.ok).toBe(true);
    expect(rig.host.past).toHaveLength(4); // creation + three picks
    expect(rig.live().chord.spelling).toBe('Gm7');
  });

  it('undo/redo walks exactly one pick per history entry', () => {
    const rig = makeRig();
    const first = applyChordComposition(rig.api, rig.clipId, chord('Gm7'), C_MAJOR, rig.snapshot());
    if (!first?.ok) throw new Error('first pick failed');
    const second = applyChordComposition(rig.api, rig.clipId, chord('Cm'), C_MAJOR, first.snapshot);
    if (!second?.ok) throw new Error('second pick failed');
    expect(rig.live().chord.spelling).toBe('Cm');

    rig.host.undo(); // undoes the Cm pick only
    expect(rig.live().chord.spelling).toBe('Gm7');
    rig.host.undo(); // undoes the Gm7 pick
    expect(rig.live().chord.spelling).toBe('C'); // the creation placeholder (key C → "C")
    rig.host.redo(); // replays the Gm7 pick
    expect(rig.live().chord.spelling).toBe('Gm7');
    rig.host.redo(); // replays the Cm pick
    expect(rig.live().chord.spelling).toBe('Cm');
  });

  it('a clip moved since the picker opened is never overwritten (drift guard)', () => {
    const rig = makeRig();
    const before = rig.snapshot();
    rig.host.state.project = {
      ...rig.host.state.project,
      chords: rig.host.state.project.chords.map((c) => (c.id === rig.clipId ? { ...c, startTick: 4800 } : c)),
    };
    const outcome = applyChordComposition(rig.api, rig.clipId, chord('Gm7'), C_MAJOR, before);
    expect(outcome).toMatchObject({ ok: false, drift: 'moved' });
    expect(rig.host.past).toHaveLength(1); // no history entry — nothing written
    expect(rig.live().chord.spelling).toBe('C');
    expect(rig.api.getMidiNotes(rig.clipId)).toHaveLength(0);
  });

  it('Advanced overrides ride the same transaction (ext change re-applies immediately)', () => {
    const rig = makeRig();
    const first = applyChordComposition(rig.api, rig.clipId, chord('C'), C_MAJOR, rig.snapshot());
    if (!first?.ok) throw new Error('pick failed');
    const tweaked = applyChordComposition(rig.api, rig.clipId, chord('C'), C_MAJOR, first.snapshot, { ...NO_OVERRIDES, ext: 'maj7', bass: 'pc:4' });
    expect(tweaked.ok).toBe(true);
    expect(rig.live().chord.spelling).toBe('Cmaj7/E');
    expect(rig.host.past).toHaveLength(3); // creation + pick + advanced tweak
  });
});

// ---------------------------------------------------------------------------
// Manual chord entry (the thin name field)
// ---------------------------------------------------------------------------

describe('manual chord entry', () => {
  it('a valid typed name renames in one undo step and never touches the notes', () => {
    const rig = makeRig();
    const pick = applyChordComposition(rig.api, rig.clipId, chord('Gm7'), C_MAJOR, rig.snapshot());
    if (!pick?.ok) throw new Error('pick failed');
    const notesBefore = rig.api.getMidiNotes(rig.clipId);

    rig.api.beginUndoTransaction('Rename Chord');
    rig.api.renameChordClip(rig.clipId, 'Bbm9');
    rig.api.commitUndoTransaction();

    expect(rig.live().chord.spelling).toBe('Bbm9');
    expect(rig.api.getMidiNotes(rig.clipId)).toEqual(notesBefore); // rename only
    expect(rig.host.past).toHaveLength(3); // creation + pick + rename
  });

  it('an invalid typed name cancels the transaction and modifies nothing', () => {
    const rig = makeRig();
    const before = { symbol: rig.live().chord.spelling, notes: rig.api.getMidiNotes(rig.clipId), past: rig.host.past.length };

    rig.api.beginUndoTransaction('Rename Chord');
    expect(() => rig.api.renameChordClip(rig.clipId, 'Xq')).toThrow();
    rig.api.cancelUndoTransaction();

    expect(rig.live().chord.spelling).toBe(before.symbol);
    expect(rig.api.getMidiNotes(rig.clipId)).toEqual(before.notes);
    expect(rig.host.past).toHaveLength(before.past); // no history entry
    expect(rig.api.isTransactionActive()).toBe(false);
  });

  it('currentChordOf resolves the clip\'s live name for Advanced edits (null for garbage)', () => {
    expect(currentChordOf('Dbm7')?.rootPc).toBe(1);
    expect(currentChordOf('not-a-chord')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Grid paging — 8 first, +4 per reveal, never a scrollbar
// ---------------------------------------------------------------------------

describe('picker paging', () => {
  it('starts at 8 tiles and reveals one row at a time', () => {
    expect(PICKER_INITIAL_COUNT).toBe(8);
    expect(PICKER_MORE_STEP).toBe(4);
    expect(nextVisibleCount(PICKER_INITIAL_COUNT, 18)).toBe(12);
    expect(nextVisibleCount(12, 18)).toBe(16);
    expect(nextVisibleCount(16, 18)).toBe(18);
  });

  it('clamps at the engine total (12–24 suggestions)', () => {
    expect(nextVisibleCount(PICKER_INITIAL_COUNT, 10)).toBe(10);
    expect(nextVisibleCount(24, 18)).toBe(18);
  });
});
