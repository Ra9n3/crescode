/**
 * Smart Chord Suggestion — interaction layer between the suggestion UI and
 * the native chord track timeline.
 *
 * Covered: position & length planning on the native grid (1 bar / gap fill /
 * too small), double-click debouncing, transaction-active suppression, the
 * create flow (one "Create Smart Chord Clip" undo step, placeholder
 * preference, failure rollback), the fresh-manual-create conversion, the
 * crescode host adapter over the real store (materialized views, snapshot
 * transactions, overlap/containment rules, gesture emitter) and the
 * end-to-end gesture through the app wiring.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { projectFromFixture, type Chord as ChordEvent, type Note, type Project } from '../src/shared/schema';
import {
  CHORD_LANE_TRACK_ID, SuggestionError,
  createCrescodeChordTrackApi, createSuggestionInteraction, CREATE_CLIP_TRANSACTION_LABEL,
  DoubleClickGate, loadClipEditorData, planClipPlacement, placeholderNotesFor,
  gridResolutionOf,
  type ChordLaneHostIo, type InteractionApi, type InteractionHooks,
  type SmartClipPlaceholder,
} from '../src/engine/suggestion';
import {
  chordTrackApi, chordTrackGesture, isFreshManualCreate, noteManualCreate,
  syncPickerToChordCard,
} from '../src/engine/suggestion/wire';
import { useStore } from '../src/store/store';

const TS44 = { numerator: 4, denominator: 4 };
const GRID = gridResolutionOf(TS44); // 3840/bar, 960/beat

// --- fixtures ----------------------------------------------------------------

const ev = (id: string, symbol: string, startTick: number, durationTicks: number): ChordEvent =>
  ({ id, symbol, startTick, durationTicks });

const makeProject = (chords: ChordEvent[] = [], laneNotes: Note[] = []): Project => {
  const p = projectFromFixture({
    schemaVersion: 1, name: 'interaction-test', bpm: 120,
    tempoMap: [{ tick: 0, bpm: 120 }], timeSignature: TS44,
    key: 3, mode: 'Ionian', // Eb — the placeholder root spells "Eb"
    sections: [], chords, referenceAudio: { path: null, offsetMs: 0 },
    tracks: [], libraryGroups: [], masterVolume: 1,
  });
  if (laneNotes.length === 0) return p;
  return { ...p, tracks: p.tracks.map((t) => (t.role === 'chords' ? { ...t, notes: laneNotes } : t)) };
};

/** In-memory ChordLaneHostIo — mirrors what wire.ts binds to the real store. */
function makeIo(project: Project) {
  const state = { project, dirty: false };
  let commits = 0;
  const io: ChordLaneHostIo = {
    getProject: () => state.project,
    snapshot: () => ({ project: state.project, dirty: state.dirty }),
    putProject: (p) => { state.project = p; state.dirty = true; },
    endTransaction: (pre, mode) => {
      if (mode === 'cancel') { state.project = pre.project; state.dirty = pre.dirty; return; }
      commits += 1;
      state.dirty = true;
    },
    isPlaying: () => false,
    now: () => 0,
    notify: () => undefined,
  };
  return { io, state, commitCount: () => commits };
}

function makeHooks(prefer: SmartClipPlaceholder = 'root-note') {
  const calls = { opened: [] as string[], warns: [] as string[], errors: [] as string[] };
  let t = 10_000;
  const hooks: InteractionHooks = {
    openEditor: (id) => calls.opened.push(id),
    warn: (text) => calls.warns.push(text),
    error: (text) => calls.errors.push(text),
    placeholder: () => prefer,
    now: () => t,
  };
  return { hooks, calls, advance: (ms: number) => { t += ms; } };
}

/** Fresh api + controller per test (the gate lives in the controller). */
function makeRig(project: Project, prefer: SmartClipPlaceholder = 'root-note') {
  const host = makeIo(project);
  const api = createCrescodeChordTrackApi(host.io);
  const labels: string[] = [];
  const recording: InteractionApi = {
    ...api,
    beginUndoTransaction: (label: string) => { labels.push(label); return api.beginUndoTransaction(label); },
  };
  const { hooks, calls, advance } = makeHooks(prefer);
  const controller = createSuggestionInteraction(recording, hooks);
  return { api, controller, calls, labels, host, state: host.state, advance, hooks };
}

// --- position & length planning ---------------------------------------------

describe('planClipPlacement (native grid, ticks)', () => {
  it('exactly 1 bar of space → a clip exactly 1 bar long', () => {
    const plan = planClipPlacement({ startTime: 0, endTime: 3840 }, 0, GRID);
    expect(plan).toMatchObject({ ok: true, startTick: 0, lengthTicks: 3840, leftoverTicks: 0 });
  });

  it('more than 1 bar → 1 bar clip, the rest stays empty', () => {
    const plan = planClipPlacement({ startTime: 3840, endTime: Number.POSITIVE_INFINITY }, 5300, GRID);
    expect(plan).toMatchObject({ ok: true, startTick: 4800, lengthTicks: 3840 });
    if (plan.ok) expect(plan.leftoverTicks).toBeGreaterThan(0);
  });

  it('less than 1 bar (≥ one grid unit) → exactly fills the gap', () => {
    const plan = planClipPlacement({ startTime: 3840, endTime: 6720 }, 4300, GRID); // 2880 ticks = 3 beats
    expect(plan).toMatchObject({ ok: true, startTick: 3840, lengthTicks: 2880, leftoverTicks: 0 });
  });

  it('less than one grid unit → too small: warn, create nothing', () => {
    const plan = planClipPlacement({ startTime: 3840, endTime: 4300 }, 3840, GRID); // 460 < 960
    expect(plan).toMatchObject({ ok: false, reason: 'too-small', availableTicks: 460, snapTicks: 960 });
  });

  it('no gap (inside a clip) → inside-clip', () => {
    expect(planClipPlacement(null, 1000, GRID)).toMatchObject({ ok: false, reason: 'inside-clip' });
  });

  it('snaps the start down to the grid, clamped into the gap', () => {
    const plan = planClipPlacement({ startTime: 0, endTime: 3840 }, 1000, GRID);
    expect(plan).toMatchObject({ ok: true, startTick: 960 });
    const clamped = planClipPlacement({ startTime: 1200, endTime: 3840 }, 500, GRID);
    expect(clamped).toMatchObject({ ok: true, startTick: 1200 });
    const past = planClipPlacement({ startTime: 0, endTime: 960 }, 2000, GRID);
    expect(past).toMatchObject({ ok: false, reason: 'too-small' });
  });

  it('an open tail gap counts as "more than 1 bar" (regression: Infinity)', () => {
    const plan = planClipPlacement({ startTime: 7680, endTime: Number.POSITIVE_INFINITY }, 8000, GRID);
    expect(plan).toMatchObject({ ok: true, startTick: 7680, lengthTicks: 3840 });
  });

  it('adapts to the meter (6/8: bar 2880, snap 1440)', () => {
    const g68 = gridResolutionOf({ numerator: 6, denominator: 8 });
    const plan = planClipPlacement({ startTime: 0, endTime: 2880 }, 100, g68);
    expect(plan).toMatchObject({ ok: true, startTick: 0, lengthTicks: 2880 });
    const small = planClipPlacement({ startTime: 0, endTime: 1400 }, 0, g68);
    expect(small).toMatchObject({ ok: false, reason: 'too-small', availableTicks: 1400 });
  });
});

describe('DoubleClickGate', () => {
  it('admits the first gesture, drops same-tick repeats inside the cooldown', () => {
    const gate = new DoubleClickGate({ now: () => 0 });
    expect(gate.admit(5000, 0)).toBe(true);
    expect(gate.admit(5000, 100)).toBe(false);
    expect(gate.admit(5000, 200)).toBe(false);
    expect(gate.admit(5000, 400)).toBe(true); // cooldown passed
  });
  it('a different tick always passes (moving gestures are legitimate)', () => {
    const gate = new DoubleClickGate({ now: () => 0 });
    expect(gate.admit(5000, 0)).toBe(true);
    expect(gate.admit(9600, 50)).toBe(true);
  });
});

describe('placeholderNotesFor', () => {
  it('root-note: one key-tonic note spanning the clip', () => {
    const notes = placeholderNotesFor({ startTime: 4800, lengthTicks: 3840 }, { tonic: 3, mode: 'Ionian', spelling: 'mixed' }, 'root-note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ midi: 51, startTick: 4800, durationTicks: 3840, velocity: 100 }); // Eb3
  });
  it('empty: nothing to write', () => {
    expect(placeholderNotesFor({ startTime: 0, lengthTicks: 960 }, { tonic: 0, mode: 'Ionian', spelling: 'mixed' }, 'empty')).toEqual([]);
  });
});

// --- the gesture controller (host adapter over an in-memory project) ---------

describe('gesture controller — empty-space creation', () => {
  it('creates a Smart clip in one undo step and opens the editor', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840)]));
    rig.controller.handleDoubleClick(null, 5000);
    expect(rig.labels).toEqual([CREATE_CLIP_TRANSACTION_LABEL]);
    expect(rig.host.commitCount()).toBe(1); // ONE undo step for the whole gesture
    expect(rig.calls.opened).toHaveLength(1);
    const clip = rig.api.getChordClipAt(5000);
    expect(clip).not.toBeNull();
    expect(clip!.id).toBe(rig.calls.opened[0]);
    expect(clip!.startTime).toBe(4800); // snapped from 5000, in the gap after c1
    expect(clip!.lengthTicks).toBe(3840);
    expect(clip!.chord.spelling).toBe('Eb'); // key-tonic placeholder symbol
    const notes = rig.api.getMidiNotes(clip!.id);
    expect(notes).toHaveLength(1); // root-note preference default
    expect(notes[0]).toMatchObject({ midi: 51, startTick: 4800 });
    expect(notes[0]!.startTick + notes[0]!.durationTicks).toBeLessThanOrEqual(clip!.startTime + clip!.lengthTicks);
  });

  it('respects the empty preference (clip stays note-less)', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840)]), 'empty');
    rig.controller.handleDoubleClick(null, 5000);
    expect(rig.calls.opened).toHaveLength(1);
    expect(rig.api.getMidiNotes(rig.calls.opened[0]!)).toEqual([]);
  });

  it('fills a shorter gap exactly and never overlaps the neighbour', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840), ev('c2', 'F', 6720, 1920)]));
    rig.controller.handleDoubleClick(null, 4300);
    const clip = rig.api.getChordClipAt(4300)!;
    expect(clip).toMatchObject({ startTime: 3840, lengthTicks: 2880 });
    expect(clip.startTime + clip.lengthTicks).toBeLessThanOrEqual(6720);
  });

  it('warns non-destructively when the gap is too small', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840), ev('c2', 'F', 4300, 960)]));
    rig.controller.handleDoubleClick(null, 4000);
    expect(rig.calls.warns).toHaveLength(1);
    expect(rig.calls.errors).toEqual([]);
    expect(rig.host.commitCount()).toBe(0);
    expect(rig.state.project.chords).toHaveLength(2); // nothing created
  });

  it('ignores gestures while an undo transaction is already active', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840)]));
    rig.api.beginUndoTransaction('someone else');
    rig.controller.handleDoubleClick(null, 5000);
    expect(rig.calls.opened).toEqual([]);
    expect(rig.calls.warns).toEqual([]);
    rig.api.commitUndoTransaction();
  });

  it('debounces rapid duplicate gestures (no duplicate clips)', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840)]));
    rig.controller.handleDoubleClick(null, 20000);
    rig.advance(100);
    rig.controller.handleDoubleClick(null, 20000); // same tick, inside cooldown
    expect(rig.host.commitCount()).toBe(1);
    expect(rig.state.project.chords.filter((c) => c.id.startsWith('sch_'))).toHaveLength(1);
    rig.advance(1000);
    rig.controller.handleDoubleClick(null, 30000); // later + elsewhere: legitimate
    expect(rig.state.project.chords.filter((c) => c.id.startsWith('sch_'))).toHaveLength(2);
  });

  it('rolls the timeline back when creation fails', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840)]));
    const broken: InteractionApi = {
      ...rig.api,
      createMidiClip: () => { throw new SuggestionError('overlapping-clips', 'injected failure'); },
    };
    const controller = createSuggestionInteraction(broken, rig.hooks);
    controller.handleDoubleClick(null, 5000);
    expect(rig.calls.errors).toHaveLength(1);
    expect(rig.host.commitCount()).toBe(0);
    expect(rig.state.project.chords).toHaveLength(1); // exactly as before the gesture
    expect(rig.state.project.chords[0]!.id).toBe('c1');
    expect(rig.api.isTransactionActive()).toBe(false);
  });
});

describe('gesture controller — existing clips', () => {
  it('opens the editor for an existing clip without writing anything', () => {
    const rig = makeRig(makeProject([ev('c1', 'Am7', 0, 3840)]));
    rig.controller.handleDoubleClick(rig.api.getChordClipAt(100), 100);
    expect(rig.calls.opened).toEqual(['c1']);
    expect(rig.host.commitCount()).toBe(0);
    expect(rig.state.project.chords[0]).toMatchObject({ symbol: 'Am7', startTick: 0, durationTicks: 3840 });
  });

  it('converts a fresh manual chord into a Smart clip atomically', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840), ev('m1', 'C', 3840, 3840)]));
    const fresh = rig.api.getChordClipAt(4000)!;
    rig.controller.handleDoubleClick(fresh, 5000, { freshFromManualCreate: true });
    expect(rig.state.project.chords.some((c) => c.id === 'm1')).toBe(false); // false start removed
    expect(rig.host.commitCount()).toBe(1); // …inside the same undo step
    expect(rig.calls.opened).toHaveLength(1);
    const smart = rig.api.getChordClipAt(5000)!;
    expect(smart.id).not.toBe('m1');
    expect(smart.startTime).toBe(4800);
    expect(smart.id.startsWith('sch_')).toBe(true);
  });

  it('restores the manual false start when the conversion fails', () => {
    const rig = makeRig(makeProject([ev('m1', 'C', 0, 3840)]));
    const broken: InteractionApi = {
      ...rig.api,
      createMidiClip: () => { throw new SuggestionError('overlapping-clips', 'injected failure'); },
    };
    const controller = createSuggestionInteraction(broken, rig.hooks);
    controller.handleDoubleClick(rig.api.getChordClipAt(100), 100, { freshFromManualCreate: true });
    expect(rig.calls.errors).toHaveLength(1);
    expect(rig.host.commitCount()).toBe(0);
    expect(rig.api.getChordClipAt(100)?.id).toBe('m1'); // false start restored
  });

  it('silently ignores a double-click inside an unparseable (mid-edit) chord', () => {
    const rig = makeRig(makeProject([ev('c1', 'C', 0, 3840), ev('bad', 'C!!', 3840, 3840)]));
    rig.controller.handleDoubleClick(null, 5000); // getChordClipAt → null (bad symbol), gap → null (inside bounds)
    expect(rig.calls.opened).toEqual([]);
    expect(rig.calls.warns).toEqual([]);
    expect(rig.calls.errors).toEqual([]);
    expect(rig.host.commitCount()).toBe(0);
  });
});

describe('clip editor data (part 4 loading)', () => {
  it('loads chord, raw MIDI, confidence, alternatives and neighbours', () => {
    const p = makeProject(
      [ev('c0', 'F', 0, 3840), ev('c1', 'Am7', 3840, 3840), ev('c2', 'G7', 7680, 3840)],
      [{ pitch: 57, startTick: 3840, durationTicks: 1920, velocity: 88 }, { pitch: 60, startTick: 4800, durationTicks: 960, velocity: 80 }],
    );
    const api = createCrescodeChordTrackApi(makeIo(p).io);
    const data = loadClipEditorData(api, 'c1');
    expect(data).not.toBeNull();
    expect(data!.clip.chord.spelling).toBe('Am7');
    expect(data!.clip.rawMidiNotes).toHaveLength(2);
    expect(data!.analysis).not.toBeNull();
    expect(data!.analysis!.alternatives.length).toBeGreaterThan(0); // e.g. C6 reading
    expect(data!.previousChord?.spelling).toBe('F');
    expect(data!.nextChord?.spelling).toBe('G7');
    expect(data!.projectKey.tonic).toBe(3);
  });

  it('returns null for a missing clip (panel auto-closes)', () => {
    const api = createCrescodeChordTrackApi(makeIo(makeProject([ev('c1', 'C', 0, 3840)])).io);
    expect(loadClipEditorData(api, 'nope')).toBeNull();
  });
});

// --- the crescode host adapter over the real store ---------------------------

describe('host adapter (real store wiring)', () => {
  beforeEach(() => {
    useStore.getState().loadProject(makeProject([ev('c1', 'C', 0, 3840), ev('c2', 'F', 11520, 3840)]));
  });

  it('transactions commit as ONE undo entry covering every write', () => {
    const api = chordTrackApi;
    api.beginUndoTransaction('Create Smart Chord Clip');
    const clip = api.createMidiClip(3840, 3840);
    api.replaceMidiNotes(clip.id, placeholderNotesFor(clip, api.getProjectKeySignature(), 'root-note'));
    api.renameChordClip(clip.id, 'Eb');
    api.commitUndoTransaction();
    expect(useStore.getState().past).toHaveLength(1);
    expect(api.getChordClipAt(4000)?.chord.spelling).toBe('Eb');
    useStore.getState().undo();
    expect(api.getChordClipAt(4000)).toBeNull(); // create+notes+rename reverted together
    expect(api.getChordClipAt(0)?.id).toBe('c1');
    useStore.getState().redo();
    expect(api.getChordClipAt(4000)?.chord.spelling).toBe('Eb');
  });

  it('cancel restores the project and the dirty flag exactly', () => {
    const api = chordTrackApi;
    const before = useStore.getState().project;
    const wasDirty = useStore.getState().dirty;
    api.beginUndoTransaction('test cancel');
    const clip = api.createMidiClip(3840, 1920);
    api.replaceMidiNotes(clip.id, [{ midi: 51, pitchClass: 3, spelling: 'Eb', octave: 3, velocity: 100, startTick: 3840, durationTicks: 1920 }]);
    api.cancelUndoTransaction();
    expect(useStore.getState().project).toEqual(before);
    expect(useStore.getState().dirty).toBe(wasDirty);
    expect(useStore.getState().past).toHaveLength(0);
    expect(api.isTransactionActive()).toBe(false);
    expect(() => api.getMidiNotes(clip.id)).toThrow(SuggestionError);
  });

  it('refuses to overwrite or move existing clips', () => {
    const api = chordTrackApi;
    api.beginUndoTransaction('overlap');
    expect(() => api.createMidiClip(0, 960)).toThrow(SuggestionError);
    expect(() => api.createMidiClip(-5, 960)).toThrow(SuggestionError);
    api.cancelUndoTransaction();
    expect(useStore.getState().project.chords).toHaveLength(2);
  });

  it('notes must fit inside the clip window', () => {
    const api = chordTrackApi;
    api.beginUndoTransaction('fill');
    const clip = api.createMidiClip(3840, 1920);
    expect(() => api.replaceMidiNotes(clip.id, [
      { midi: 60, pitchClass: 0, spelling: 'C', octave: 4, velocity: 90, startTick: 3800, durationTicks: 960 },
    ])).toThrow(SuggestionError);
    api.replaceMidiNotes(clip.id, [
      { midi: 60, pitchClass: 0, spelling: 'C', octave: 4, velocity: 90, startTick: 3840, durationTicks: 1920 },
    ]);
    expect(api.getMidiNotes(clip.id)).toHaveLength(1);
    api.cancelUndoTransaction();
  });

  it('materializes rawMidiNotes from the Chords structure track', () => {
    useStore.getState().loadProject(makeProject(
      [ev('c1', 'Am7', 0, 3840)],
      [{ pitch: 57, startTick: 0, durationTicks: 960, velocity: 88 }, { pitch: 60, startTick: 1920, durationTicks: 960, velocity: 80 }],
    ));
    const api = chordTrackApi;
    const clip = api.getChordClipAt(100)!;
    expect(clip.rawMidiNotes).toHaveLength(2);
    expect(clip.rawMidiNotes!.map((n) => n.midi)).toEqual([57, 60]);
    expect(api.getMidiNotes('c1')).toHaveLength(2);
    const other = api.getChordClipAt(10000);
    expect(other?.rawMidiNotes ?? []).toHaveLength(0); // c2 window has no notes
  });

  it('unparseable mid-edit symbols are excluded from views but kept as bounds', () => {
    useStore.getState().loadProject(makeProject([ev('c1', 'C', 0, 3840), ev('bad', 'C!!', 3840, 3840)]));
    const api = chordTrackApi;
    expect(api.getChordClipAt(4000)).toBeNull();
    expect(api.getAvailableGapAt(4000)).toBeNull(); // still a bound — the planner cannot overlap it
    expect(api.getPreviousChordClip(10000)?.id).toBe('c1'); // skips the unparseable event
    expect(api.getNextChordClip(0)?.id).toBe('c1');
  });

  it('renameChordClip validates and preserves id, position, length', () => {
    const api = chordTrackApi;
    const before = api.getChordClipAt(0)!;
    api.beginUndoTransaction('rename');
    expect(() => api.renameChordClip('c1', 'Not A Chord')).toThrow(SuggestionError);
    api.renameChordClip('c1', 'Csus2');
    api.commitUndoTransaction();
    const after = api.getChordClipAt(0)!;
    expect(after.chord.spelling).toBe('Csus2');
    expect(after).toMatchObject({ id: before.id, startTime: before.startTime, lengthTicks: before.lengthTicks });
  });

  it('the double-click emitter delivers to chord-lane subscribers only', () => {
    const api = chordTrackApi;
    const seen: Array<{ clip: string | null; time: number }> = [];
    const unsub = api.subscribeToDoubleClick(CHORD_LANE_TRACK_ID, (clip, time) => seen.push({ clip: clip?.id ?? null, time }));
    const wrongLane = api.subscribeToDoubleClick('trk_somewhere', (clip, time) => seen.push({ clip: clip?.id ?? null, time }));
    const clip = api.getChordClipAt(0);
    api.emitDoubleClick(clip, 123);
    api.emitDoubleClick(null, 456);
    expect(seen).toEqual([{ clip: 'c1', time: 123 }, { clip: null, time: 456 }]);
    wrongLane();
    unsub();
    api.emitDoubleClick(clip, 789);
    expect(seen).toHaveLength(2);
  });

  it('MIDI clips on instrument tracks are session windows rolled back on cancel', () => {
    const api = chordTrackApi;
    const piano = useStore.getState().project.tracks.find((t) => t.role === 'piano')!;
    api.beginUndoTransaction('piano sketch');
    const clip = api.createMidiClip(0, 960, piano.id);
    api.replaceMidiNotes(clip.id, [{ midi: 60, pitchClass: 0, spelling: 'C', octave: 4, velocity: 90, startTick: 0, durationTicks: 960 }]);
    expect(api.getMidiNotes(clip.id)).toHaveLength(1);
    api.cancelUndoTransaction();
    expect(() => api.getMidiNotes(clip.id)).toThrow(SuggestionError);
    const pianoAfter = useStore.getState().project.tracks.find((t) => t.role === 'piano')!;
    expect(pianoAfter.notes).toHaveLength(0);
  });
});

// --- end-to-end through the app wiring ---------------------------------------

describe('chord lane gesture (end-to-end through wire.ts)', () => {
  beforeEach(() => {
    useStore.getState().loadProject(makeProject([ev('c1', 'C', 0, 3840)]));
  });

  it('a double-click on empty space creates the clip, placeholder and editor state', () => {
    noteManualCreate('__never__'); // freshness tracker ignores stale ids
    chordTrackGesture(null, 19200);
    const s = useStore.getState();
    const created = s.project.chords.find((c) => c.startTick === 19200);
    expect(created).toBeDefined();
    expect(created!.id.startsWith('sch_')).toBe(true);
    const lane = s.project.tracks.find((t) => t.role === 'chords')!;
    expect(lane.notes.some((n) => n.startTick === 19200 && n.pitch === 51)).toBe(true);
    expect(s.suggestionClipId).toBe(created!.id);
    const editor = loadClipEditorData(chordTrackApi, created!.id);
    expect(editor).not.toBeNull();
    expect(editor!.clip.chord.spelling).toBe('Eb');
    expect(editor!.analysis).not.toBeNull(); // the placeholder root is analyzable
    expect(editor!.previousChord?.spelling).toBe('C'); // c1 precedes the new clip
  });

  it('the freshness tracker tags just-created manual chords only', () => {
    noteManualCreate('fresh_1');
    expect(isFreshManualCreate('fresh_1')).toBe(true);
    expect(isFreshManualCreate('unknown')).toBe(false);
  });
});

// --- popup ↔ chord-card selection sync ---------------------------------------

describe('popup sync (clicking a chord card re-targets the open picker)', () => {
  beforeEach(() => {
    useStore.getState().loadProject(makeProject([ev('c1', 'G7', 0, 3840), ev('c2', 'C', 5760, 3840)]));
  });

  it('the open picker follows the clicked card: settings reload from that clip', () => {
    // picker open on c1 (as the double-click gesture leaves it)
    useStore.getState().set({ suggestionClipId: 'c1', selectedChordId: 'c1', selectedSectionId: null });
    syncPickerToChordCard('c2'); // pointer-down on the c2 card
    const s = useStore.getState();
    expect(s.suggestionClipId).toBe('c2');
    // what the popup renders now comes from c2 — name and position included
    const data = loadClipEditorData(chordTrackApi, s.suggestionClipId!);
    expect(data).not.toBeNull();
    expect(data!.clip.chord.spelling).toBe('C');
    expect(data!.clip.startTime).toBe(5760);
  });

  it('is a no-op when the clicked card is the one already open', () => {
    useStore.getState().set({ suggestionClipId: 'c1' });
    syncPickerToChordCard('c1');
    expect(useStore.getState().suggestionClipId).toBe('c1');
  });

  it('never OPENS the picker from a closed state (single click only selects)', () => {
    useStore.getState().set({ suggestionClipId: null, selectedChordId: null });
    syncPickerToChordCard('c2');
    expect(useStore.getState().suggestionClipId).toBeNull();
    syncPickerToChordCard('c1');
    expect(useStore.getState().suggestionClipId).toBeNull();
  });

  it('keeps following across consecutive card clicks (back and forth)', () => {
    useStore.getState().set({ suggestionClipId: 'c1' });
    syncPickerToChordCard('c2');
    syncPickerToChordCard('c1');
    expect(useStore.getState().suggestionClipId).toBe('c1');
  });
});
