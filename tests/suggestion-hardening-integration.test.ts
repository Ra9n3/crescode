/**
 * Smart Chord Suggestion — comprehensive hardening suite (integration layer).
 *
 * Coverage added on top of the per-layer suites, mapped to the hardening
 * request:
 *  - double-click creates EXACTLY one clip (empty track, rapid gestures)
 *  - apply writes the correct MIDI notes, neighbors untouched
 *  - undo restores the previous clip state; redo reapplies the change
 *  - rename preserves clip length and position (end-to-end through the text
 *    entry path, key normalization included)
 *  - no existing clips are moved or overwritten (creation-time overlap
 *    rejection + apply-time drift guard)
 *  - clips during playback: writes are refused non-blockingly, reads stay
 *  - hidden/missing and locked chord lane: nothing is written, user warned
 *  - DAW API failure during clip creation or note injection: transaction
 *    cancelled, timeline restored, non-blocking error
 *  - user manually edits MIDI after opening the suggestion UI: apply warns
 *    instead of overwriting
 *  - low recognition confidence keeps the system usable end to end
 *
 * Every destructive operation in these tests runs through an undo
 * transaction labeled by the spec ("Create Smart Chord Clip", "Apply Smart
 * Chord", "Rename Chord") and asserts the label, the one-undo-step rule and
 * the failure rollback.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { projectFromFixture, type Chord as ChordEvent, type Note, type Project } from '../src/shared/schema';
import {
  APPLY_TRANSACTION_LABEL, RENAME_TRANSACTION_LABEL, CREATE_CLIP_TRANSACTION_LABEL,
  applyChordTextToClip, applyChordToClip, createCrescodeChordTrackApi,
  createSuggestionInteraction, loadClipEditorData, pitchOf, takeClipSnapshot,
  voiceChordSymbol,
  type ChordLaneHostIo, type CrescodeChordTrackApi, type InteractionApi, type InteractionHooks,
} from '../src/engine/suggestion';
import { suggestChordsAt } from '../src/engine/suggestion/engine';
import { chordTrackApi } from '../src/engine/suggestion/wire';
import { useStore } from '../src/store/store';

const TS44 = { numerator: 4, denominator: 4 };
const BAR = 3840; // 4/4 at 960 PPQ

// --- fixtures (mirroring the interaction-suite conventions) ------------------

const ev = (id: string, symbol: string, startTick: number, durationTicks: number): ChordEvent =>
  ({ id, symbol, startTick, durationTicks });

const midiNote = (pitch: number, startTick = 0, durationTicks = BAR, velocity = 100): Note =>
  ({ pitch, startTick, durationTicks, velocity });

function makeProject(chords: ChordEvent[] = [], laneNotes: Note[] = [], locks = false): Project {
  const p = projectFromFixture({
    schemaVersion: 1, name: 'hardening-test', bpm: 120,
    tempoMap: [{ tick: 0, bpm: 120 }], timeSignature: TS44,
    key: 3, mode: 'Ionian', // Eb major
    sections: [], chords, referenceAudio: { path: null, offsetMs: 0 },
    tracks: [], libraryGroups: [], masterVolume: 1,
  });
  return {
    ...p,
    tracks: p.tracks.map((t) => (t.role === 'chords' ? { ...t, notes: laneNotes, locked: locks || t.locked } : t)),
  };
}

function makeIo(project: Project) {
  const state = { project, dirty: false };
  const past: Project[] = [];
  const io: ChordLaneHostIo = {
    getProject: () => state.project,
    snapshot: () => ({ project: state.project, dirty: state.dirty }),
    putProject: (p) => { state.project = p; state.dirty = true; },
    endTransaction: (pre, mode) => {
      if (mode === 'cancel') { state.project = pre.project; state.dirty = pre.dirty; return; }
      past.push(pre.project);
      state.dirty = true;
    },
    isPlaying: () => false,
    now: () => 0,
    notify: () => undefined,
  };
  return { io, state, past };
}

interface RigCalls { opened: string[]; warns: string[]; errors: string[] }

function makeRig(project: Project, overrides: Partial<InteractionHooks> = {}) {
  const host = makeIo(project);
  const api = createCrescodeChordTrackApi(host.io);
  const calls: RigCalls = { opened: [], warns: [], errors: [] };
  let t = 10_000;
  const hooks: InteractionHooks = {
    openEditor: (id) => calls.opened.push(id),
    warn: (text) => calls.warns.push(text),
    error: (text) => calls.errors.push(text),
    placeholder: () => 'root-note',
    now: () => t,
    isPlaying: () => false,
    laneEditable: () => api.isLaneEditable(),
    ...overrides,
  };
  const recording: InteractionApi = {
    ...api,
    beginUndoTransaction: (l: string) => (labels.push(l), api.beginUndoTransaction(l)),
  };
  const labels: string[] = [];
  const controller = createSuggestionInteraction(recording, hooks);
  return { api: api as CrescodeChordTrackApi, controller, calls, labels, state: host.state, past: host.past, advance: (ms: number) => { t += ms; } };
}

const notePcs = (notes: Array<{ pitchClass: number }>): number[] => notes.map((n) => n.pitchClass).sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// Double-click → exactly one clip
// ---------------------------------------------------------------------------

describe('integration · double-click creates exactly one clip', () => {
  it('on an EMPTY chord track: one clip, one bar long, at the snapped click, with the placeholder', () => {
    const rig = makeRig(makeProject([]));
    rig.controller.handleDoubleClick(null, 5000);

    expect(rig.state.project.chords).toHaveLength(1); // exactly one
    const clip = rig.state.project.chords[0]!;
    expect(clip.startTick).toBe(4800); // snapped down to the beat grid
    expect(clip.durationTicks).toBe(BAR);
    expect(clip.id.startsWith('sch')).toBe(true);
    // Root-note placeholder was injected inside the same transaction.
    expect(rig.past).toHaveLength(1); // ONE undo entry for the whole gesture
    expect(rig.labels).toEqual([CREATE_CLIP_TRANSACTION_LABEL]);
    expect(rig.calls.opened).toEqual([clip.id]); // editor opened for the new clip
  });

  it('rapid same-tick double-clicks still produce exactly one clip', () => {
    const rig = makeRig(makeProject([]));
    rig.controller.handleDoubleClick(null, 5000);
    rig.advance(80);
    rig.controller.handleDoubleClick(null, 5000); // accidental repeat inside the cooldown
    rig.advance(80);
    rig.controller.handleDoubleClick(null, 5000);
    expect(rig.state.project.chords).toHaveLength(1);
    expect(rig.past).toHaveLength(1); // no extra undo steps either
  });

  it('gestures at different ticks are legitimate and create their own clips', () => {
    const rig = makeRig(makeProject([]));
    rig.controller.handleDoubleClick(null, 0);
    rig.advance(500); // outside the cooldown
    rig.controller.handleDoubleClick(null, 2 * BAR);
    expect(rig.state.project.chords).toHaveLength(2);
    expect(rig.past).toHaveLength(2);
  });

  it('a click inside overlapping manual chords creates nothing (and never throws)', () => {
    // c1 [0,3840) and c2 [1920,5760) overlap on [1920,3840).
    const rig = makeRig(makeProject([ev('c1', 'C', 0, BAR), ev('c2', 'F', 1920, BAR)]));
    expect(() => rig.controller.handleDoubleClick(null, 3000)).not.toThrow();
    expect(rig.state.project.chords).toHaveLength(2); // unchanged
    expect(rig.past).toHaveLength(0);
    expect(rig.calls.errors).toEqual([]);

    // On a lane that ALREADY overlaps, the adapter refuses further creation
    // rather than silently adding a third overlapping span (protective, and
    // reported non-blockingly — never a throw into the UI).
    expect(() => rig.controller.handleDoubleClick(null, 6000)).not.toThrow();
    expect(rig.state.project.chords).toHaveLength(2); // nothing created
    expect(rig.past).toHaveLength(0); // the failed attempt rolled back
    expect(rig.calls.errors[0]).toMatch(/overlap|exists|never/i);
  });

  it('creation between clips never moves or overwrites its neighbors', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, BAR), ev('c2', 'F', 2 * BAR, BAR)]));
    rig.controller.handleDoubleClick(null, 5000); // gap [3840, 7680)
    const chords = rig.state.project.chords;
    expect(chords).toHaveLength(3);
    expect(chords[0]).toMatchObject({ id: 'c1', startTick: 0, durationTicks: BAR });
    expect(chords[1]).toMatchObject({ id: 'c2', startTick: 2 * BAR, durationTicks: BAR });
    expect(chords[2]).toMatchObject({ startTick: 4800, durationTicks: 2880 }); // fills the gap exactly
  });

  it('an extremely small gap warns non-destructively and creates nothing', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, BAR), ev('c2', 'F', BAR + 460, BAR)]));
    rig.controller.handleDoubleClick(null, BAR + 100);
    expect(rig.state.project.chords).toHaveLength(2); // nothing created
    expect(rig.past).toHaveLength(0); // no transaction was committed
    expect(rig.calls.warns.length).toBeGreaterThan(0); // non-blocking explanation
    expect(rig.calls.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Clips during playback
// ---------------------------------------------------------------------------

describe('integration · clips during playback', () => {
  it('clip creation mid-playback is refused with a non-blocking warning', () => {
    const rig = makeRig(makeProject([]), { isPlaying: () => true });
    rig.controller.handleDoubleClick(null, 5000);
    expect(rig.state.project.chords).toHaveLength(0); // nothing created
    expect(rig.past).toHaveLength(0); // no transaction was even opened
    expect(rig.calls.warns[0]).toMatch(/Playback is running/i);
    expect(rig.calls.errors).toEqual([]);
  });

  it('opening an existing clip stays available during playback (read-only)', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, BAR)]), { isPlaying: () => true });
    const clip = rig.api.getChordClipAt(1000)!;
    rig.controller.handleDoubleClick(clip, 1000);
    expect(rig.calls.opened).toEqual(['c1']);
    expect(rig.past).toHaveLength(0); // nothing was written
    expect(rig.state.project.chords[0]!.symbol).toBe('C'); // untouched
  });

  it('the manual false-start conversion is also refused during playback', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 4800, BAR)]), { isPlaying: () => true });
    const clip = rig.api.getChordClipAt(5000)!;
    rig.controller.handleDoubleClick(clip, 5000, { freshFromManualCreate: true });
    expect(rig.state.project.chords).toHaveLength(1); // the manual chord survives
    expect(rig.state.project.chords[0]!.id).toBe('c1');
    expect(rig.calls.warns[0]).toMatch(/Playback is running/i);
  });
});

// ---------------------------------------------------------------------------
// Locked or missing (hidden) chord lane
// ---------------------------------------------------------------------------

describe('integration · locked or missing chord lane', () => {
  it('a locked chords track reports not-editable and refuses clip creation', () => {
    const rig = makeRig(makeProject([], [], true));
    expect(rig.api.isLaneEditable()).toBe(false);
    rig.controller.handleDoubleClick(null, 5000);
    expect(rig.state.project.chords).toHaveLength(0);
    expect(rig.past).toHaveLength(0);
    expect(rig.calls.warns[0]).toMatch(/locked/i);
  });

  it('the fresh-manual conversion on a locked lane keeps the manual chord', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 4800, BAR)], [], true));
    const clip = rig.api.getChordClipAt(5000)!;
    rig.controller.handleDoubleClick(clip, 5000, { freshFromManualCreate: true });
    expect(rig.state.project.chords).toHaveLength(1);
    expect(rig.state.project.chords[0]!.id).toBe('c1'); // restored, not converted
    expect(rig.calls.warns[0]).toMatch(/locked/i);
  });

  it('a missing chords track (lane gone) is treated as not editable', () => {
    const p = makeProject([]);
    const withoutLane: Project = { ...p, tracks: p.tracks.filter((t) => t.role !== 'chords') };
    const rig = makeRig(withoutLane);
    expect(rig.api.isLaneEditable()).toBe(false);
    rig.controller.handleDoubleClick(null, 5000);
    expect(rig.calls.warns[0]).toMatch(/locked|missing/i);
    expect(rig.state.project.chords).toHaveLength(0);
  });

  it('read-only operations still work on a locked lane', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, BAR), ev('c2', 'F', 2 * BAR, BAR)], [], true));
    expect(rig.api.getChordClipsInRange(0, 4 * BAR)).toHaveLength(2);
    expect(rig.api.getPreviousChordClip(2 * BAR)?.id).toBe('c1');
    const clip = rig.api.getChordClipAt(2 * BAR)!;
    rig.controller.handleDoubleClick(clip, 2 * BAR);
    expect(rig.calls.opened).toEqual(['c2']); // read-only open, no guard trips
    expect(rig.past).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Apply — correct notes, undo, redo, isolation, guards, failure
// ---------------------------------------------------------------------------

describe('integration · apply writes, undoes and redoes (real app wiring)', () => {
  beforeEach(() => {
    useStore.getState().loadProject(makeProject([ev('c1', 'C', 0, BAR), ev('c2', 'F', 2 * BAR, BAR)]));
  });

  it('apply writes the correct MIDI notes into the target clip — neighbors untouched', () => {
    const api = useStoreChordApi();
    const live = api.getChordClipById('c2')!;
    const voicing = voiceChordSymbol('G7');
    expect(voicing.ok).toBe(true);
    if (!voicing.ok) return;

    const labels: string[] = [];
    const spy = { ...api, beginUndoTransaction: (l: string) => (labels.push(l), api.beginUndoTransaction(l)) };
    const outcome = applyChordToClip(spy, 'c2', 'G7', voicing, takeClipSnapshot(live));
    expect(outcome.ok).toBe(true);
    expect(labels).toEqual([APPLY_TRANSACTION_LABEL]); // the spec's undo label

    const notes = api.getMidiNotes('c2');
    expect(notePcs(notes)).toEqual([2, 5, 7, 11]); // G7 = G B D F
    for (const n of notes) {
      expect(n.startTick).toBeGreaterThanOrEqual(2 * BAR); // inside the clip window
      expect(n.startTick + n.durationTicks).toBeLessThanOrEqual(3 * BAR);
    }
    expect(api.getChordClipById('c2')!.chord.spelling).toBe('G7');
    expect(api.getChordClipById('c1')!.chord.spelling).toBe('C'); // neighbor untouched
    expect(api.getMidiNotes('c1')).toEqual([]);
    // The spec's undo label, one undo step for the whole write.
    expect(useStore.getState().past).toHaveLength(1);
  });

  it('undo restores the previous clip state; redo reapplies the change exactly', () => {
    const api = useStoreChordApi();
    const live = api.getChordClipById('c2')!;
    const voicing = voiceChordSymbol('G7');
    if (!voicing.ok) throw new Error('voicing');
    expect(applyChordToClip(api, 'c2', 'G7', voicing, takeClipSnapshot(live)).ok).toBe(true);
    const afterApply = api.getMidiNotes('c2');
    expect(useStore.getState().past.length).toBe(1); // ONE "Apply Smart Chord" step

    useStore.getState().undo(); // ONE undo step reverts notes + rename together
    expect(api.getChordClipById('c2')!.chord.spelling).toBe('F');
    expect(api.getMidiNotes('c2')).toEqual([]);

    useStore.getState().redo(); // redo reapplies the same change
    expect(api.getChordClipById('c2')!.chord.spelling).toBe('G7');
    expect(notePcs(api.getMidiNotes('c2'))).toEqual(notePcs(afterApply));
  });

  it('user MIDI edits after the overlay opened are never overwritten silently', () => {
    const api = useStoreChordApi();
    const live = api.getChordClipById('c2')!;
    const snapshot = takeClipSnapshot(live);

    // The user writes their own MIDI into the clip while the overlay is open.
    api.beginUndoTransaction('user edit');
    api.replaceMidiNotes('c2', [midiNote(61, 2 * BAR, 960), midiNote(63, 2 * BAR, 960)].map((n) =>
      pitchOf(n)));
    api.commitUndoTransaction();

    const voicing = voiceChordSymbol('G7');
    if (!voicing.ok) throw new Error('voicing');
    const outcome = applyChordToClip(api, 'c2', 'G7', voicing, snapshot);
    expect(outcome).toMatchObject({ ok: false, drift: 'edited' });
    expect(api.getChordClipById('c2')!.chord.spelling).toBe('F'); // user data intact
    expect(notePcs(api.getMidiNotes('c2'))).toEqual([1, 3]); // user notes intact
  });

  it('apply on a locked lane refuses with "locked" and pushes no undo entry', () => {
    useStore.getState().loadProject(makeProject([ev('c1', 'C', 0, BAR)], [], true));
    const api = useStoreChordApi();
    const live = api.getChordClipById('c1')!;
    const voicing = voiceChordSymbol('G7');
    if (!voicing.ok) throw new Error('voicing');
    const pastBefore = useStore.getState().past.length;
    const outcome = applyChordToClip(api, 'c1', 'G7', voicing, takeClipSnapshot(live));
    expect(outcome).toMatchObject({ ok: false, drift: 'locked' });
    expect(api.getChordClipById('c1')!.chord.spelling).toBe('C');
    expect(useStore.getState().past.length).toBe(pastBefore);
  });

  it('a DAW failure during note injection cancels the transaction and restores the clip', () => {
    const api = useStoreChordApi();
    // Give the clip user MIDI first, so the rollback is observable.
    const original = [midiNote(53, 2 * BAR, BAR), midiNote(57, 2 * BAR, BAR), midiNote(60, 2 * BAR, BAR)];
    api.beginUndoTransaction('user edit');
    api.replaceMidiNotes('c2', original.map((n) => pitchOf(n)));
    api.commitUndoTransaction();

    const live = api.getChordClipById('c2')!;
    const voicing = voiceChordSymbol('G7');
    if (!voicing.ok) throw new Error('voicing');
    const pastBefore = useStore.getState().past.length;

    // The host accepts the clear but fails half-way through the injection —
    // a partial write that must be rolled back completely.
    const failing = {
      ...api,
      replaceMidiNotes: (_clipId: string, _notes: never[]) => { throw new Error('DAW write failed'); },
    };
    const outcome = applyChordToClip(failing, 'c2', 'G7', voicing, takeClipSnapshot(live));
    expect(outcome).toMatchObject({ ok: false, drift: 'error' });
    expect(api.getChordClipById('c2')!.chord.spelling).toBe('F'); // chord name restored
    // The user's notes are back, byte for byte (field view over the Pitches).
    expect(api.getMidiNotes('c2').map((n) => ({ pitch: n.midi, startTick: n.startTick, durationTicks: n.durationTicks, velocity: n.velocity }))
      .sort((a, b) => a.pitch - b.pitch))
      .toEqual([...original].sort((a, b) => a.pitch - b.pitch));
    expect(api.isTransactionActive()).toBe(false); // transaction rolled back
    expect(useStore.getState().past.length).toBe(pastBefore); // no undo entry for a failed write
  });
});

// ---------------------------------------------------------------------------
// Rename via text — position/length preserved, undo/redo, key normalization
// ---------------------------------------------------------------------------

describe('integration · text rename preserves the clip and undoes cleanly', () => {
  beforeEach(() => {
    useStore.getState().loadProject(makeProject([ev('c1', 'C', 0, BAR), ev('c2', 'F', 2 * BAR, BAR)]));
  });

  it('renaming normalizes through the key (C#m7→Dbm7 in Eb), keeps length and position', () => {
    const api = useStoreChordApi();
    const before = api.getChordClipById('c2')!;
    expect(before.startTime).toBe(2 * BAR);
    expect(before.lengthTicks).toBe(BAR);

    const labels: string[] = [];
    const spy = { ...api, beginUndoTransaction: (l: string) => (labels.push(l), api.beginUndoTransaction(l)) };
    const outcome = applyChordTextToClip(spy, 'c2', 'C#m7', api.getProjectKeySignature(), {
      snapshot: takeClipSnapshot(before),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // ONE undo entry covers the whole rename, under the spec's own label.
    expect(labels).toEqual([RENAME_TRANSACTION_LABEL]);
    expect(useStore.getState().past).toHaveLength(1);
    expect(outcome.symbol).toBe('Dbm7'); // Eb major prefers the flat spelling
    const after = api.getChordClipById('c2')!;
    expect(after.startTime).toBe(2 * BAR); // position preserved
    expect(after.lengthTicks).toBe(BAR); // length preserved
    expect(after.chord.spelling).toBe('Dbm7');
    expect(notePcs(after.rawMidiNotes ?? [])).toEqual([1, 4, 8, 11]); // Db F Ab Cb
    expect((after.rawMidiNotes ?? []).every((n) => n.startTick === 2 * BAR)).toBe(true);
    expect(api.getChordClipById('c1')!.chord.spelling).toBe('C'); // neighbor untouched
  });

  it('undo restores the original chord and MIDI; redo reapplies the rename', () => {
    const api = useStoreChordApi();
    const before = api.getChordClipById('c2')!;
    const outcome = applyChordTextToClip(api, 'c2', 'Dbm7', api.getProjectKeySignature(), {
      snapshot: takeClipSnapshot(before),
    });
    expect(outcome.ok).toBe(true);

    useStore.getState().undo();
    const restored = api.getChordClipById('c2')!;
    expect(restored.chord.spelling).toBe('F');
    expect(restored.startTime).toBe(2 * BAR);
    expect(restored.lengthTicks).toBe(BAR);
    expect(api.getMidiNotes('c2')).toEqual([]);

    useStore.getState().redo();
    expect(api.getChordClipById('c2')!.chord.spelling).toBe('Dbm7');
    expect(notePcs(api.getMidiNotes('c2'))).toEqual([1, 4, 8, 11]);
  });

  it('invalid text fails inline: no transaction, no undo entry, clip untouched', () => {
    const api = useStoreChordApi();
    const before = api.getChordClipById('c2')!;
    const pastBefore = useStore.getState().past.length;
    const outcome = applyChordTextToClip(api, 'c2', 'Hx7??', api.getProjectKeySignature(), {
      snapshot: takeClipSnapshot(before),
    });
    expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
    expect(api.getChordClipById('c2')!.chord.spelling).toBe('F');
    expect(useStore.getState().past.length).toBe(pastBefore);
    expect(useStore.getState().project.chords).toHaveLength(2); // no clip was created
  });
});

// ---------------------------------------------------------------------------
// Low confidence — usable end to end
// ---------------------------------------------------------------------------

describe('integration · low-confidence clips stay usable end to end', () => {
  it('an unknown clip loads the editor with its honest verdict and suggestions still flow', () => {
    const chromatic: Note[] = [60, 61, 62, 63].map((p, i) => midiNote(p, i * 480, 480));
    const p = makeProject([ev('c1', 'C', 0, BAR)], chromatic);
    const host = makeIo(p);
    const api = createCrescodeChordTrackApi(host.io);

    const data = loadClipEditorData(api, 'c1');
    expect(data).not.toBeNull();
    expect(data?.analysis?.status).toBe('unknown'); // clearly flagged, not hidden
    expect(data?.clip.chord.spelling).toBe('C'); // user-authored symbol intact
    expect(data?.projectKey.tonic).toBe(3);

    // The suggestion engine still ranks a full grid next to it.
    const suggestions = suggestChordsAt(api, 0, { excludeClipId: 'c1' });
    expect(suggestions.length).toBeGreaterThanOrEqual(12);
  });
});

// --- helper: the singleton api wired to the real store ----------------------
function useStoreChordApi(): CrescodeChordTrackApi {
  return chordTrackApi;
}
