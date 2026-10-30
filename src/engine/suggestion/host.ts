/**
 * The crescode host adapter — the concrete ChordTrackAPI over this app's own
 * project model and undo history. Crescent IS the DAW, so "the host" means
 * `useStore`'s project: chord clips are views over `project.chords`, and the
 * MIDI behind them lives on the Chords structure track (`role: "chords"`) —
 * a Track whose notes are inert by design (never played by the preview
 * engine, never exported, never touched by generate), which makes it the
 * native backing store for chord-lane MIDI.
 *
 * Adaptation notes (DAW-agnostic spec → crescode):
 *  - A chord-lane MIDI clip IS persisted: createMidiClip on the chord lane
 *    reserves the span as a lane Chord event (id prefix `sch_`), so the clip
 *    survives save/reload and shows on the lane like any chord. Its symbol
 *    starts as the key tonic (the placeholder root) until a chord is named.
 *  - MIDI clips on OTHER tracks are session windows (registry) — the
 *    suggestion flow only uses the chord lane; this keeps the adapter
 *    honest about both halves of the contract without inventing schema.
 *  - Undo transactions ride the store's snapshot history: begin captures the
 *    project, interior writes swap the project silently, commit pushes ONE
 *    history entry, cancel restores the snapshot exactly.
 *  - Lane events whose symbol does not parse (mid-edit manual chords) are
 *    not chord-clip views, but they still count as bounds for gaps — a
 *    half-typed chord never lets the planner overlap it.
 */
import { projectEndTick, uid, type Chord as ChordEvent, type Note, type Project, type Track } from '../../shared/schema';
import { sanitizeNotes } from '../generate';
import {
  assertInTransaction, assertNoOpenTransaction, assertTransactionOpen,
  validateGap, validateNoClipOverlap, validatePitch, validateTimeRange,
} from './validation';
import {
  chordClipOf, chordFromSymbol, gridResolutionOf, pitchesFromNotes, projectKeyOf, spelledNoteName,
} from './model';
import { CHORD_LANE_TRACK_ID, type ChordTrackAPI, type DoubleClickHandler, type Unsubscribe } from './adapter';
import {
  SuggestionError,
  type ChordClip, type ClipMetadata, type GridResolution, type MidiClip, type Pitch,
  type ProjectKey, type UndoTransaction,
} from './types';

/** Id prefix reserved for Smart Chord clips — how the lane (and a saved
 *  project, after reload) tells them apart from manually typed chords. */
export const SMART_CLIP_ID_PREFIX = 'sch';

/** What the host captured when a transaction began. */
export interface HostSnapshot {
  project: Project;
  dirty: boolean;
}

/** The slice of the app the adapter needs. `createDefaultChordLaneHostIo`
 *  (wire.ts) binds this to the real zustand store; tests bind fakes. */
export interface ChordLaneHostIo {
  getProject(): Project;
  snapshot(): HostSnapshot;
  /** Transaction-interior write: swap the project without undo bookkeeping. */
  putProject(p: Project): void;
  /** Close the open transaction: commit = one undo step from `pre`;
   *  cancel = restore `pre` exactly (project and dirty flag). */
  endTransaction(pre: HostSnapshot, mode: 'commit' | 'cancel'): void;
  isPlaying(): boolean;
  now(): number;
  notify(kind: 'warn' | 'error' | 'info' | 'success', text: string): void;
}

/** The full contract plus the crescode-only extras the UI and the
 *  interaction layer drive (kept out of the portable ChordTrackAPI). */
export type CrescodeChordTrackApi = ChordTrackAPI & {
  isTransactionActive(): boolean;
  /** Remove a chord-lane clip (or a session MIDI clip). Transaction-scoped:
   *  used to convert a just-created manual chord into a Smart clip. */
  removeChordClip(clipId: string): void;
  getChordClipById(clipId: string): ChordClip | null;
  /** Host-side entry point of the "open suggestions here" gesture — the
   *  chord lane calls this; consumers receive it via subscribeToDoubleClick. */
  emitDoubleClick(clip: ChordClip | null, time: number): void;
};

interface RegisteredWindow { startTime: number; lengthTicks: number; trackId: string }

function chordsTrackOf(p: Project): Track | null {
  return p.tracks.find((t) => t.family === 'Structure' && t.role === 'chords') ?? null;
}

/** Notes of a track sounding inside [start, end). */
function windowNotes(p: Project, trackId: string, start: number, end: number): Pitch[] {
  const track = p.tracks.find((t) => t.id === trackId);
  if (track === undefined) return [];
  return pitchesFromNotes(track.notes.filter((n) => n.startTick < end && n.startTick + n.durationTicks > start));
}

const toNote = (n: Pitch): Note => ({ pitch: n.midi, startTick: n.startTick, durationTicks: n.durationTicks, velocity: n.velocity });

const eventEnd = (c: ChordEvent): number => c.startTick + c.durationTicks;

const byStartThenId = (a: ChordEvent, b: ChordEvent): number =>
  a.startTick - b.startTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const byIdAsc = (a: ChordEvent, b: ChordEvent): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const intersects = (c: ChordEvent, start: number, end: number): boolean => c.startTick < end && eventEnd(c) > start;

const isInt = (v: number): boolean => Number.isInteger(v);

/** Notes must sit fully inside the clip window — chord-lane clips are
 *  analyzed per window, so legato into the neighbour would corrupt both. */
function assertNotesFit(clipId: string, start: number, end: number, notes: readonly Pitch[]): void {
  for (const n of notes) {
    if (n.startTick < start || n.startTick + n.durationTicks > end) {
      throw new SuggestionError('invalid-range', `note [${n.startTick}, +${n.durationTicks}] does not fit inside clip "${clipId}" [${start}, ${end})`);
    }
  }
}

/**
 * Builds the crescode ChordTrackAPI. All durable state lives in the host's
 * project (plus the session registry for non-lane MIDI clips); the adapter
 * itself holds only the open transaction and the double-click listeners.
 */
export function createCrescodeChordTrackApi(io: ChordLaneHostIo): CrescodeChordTrackApi {
  /** Session windows for MIDI clips created on instrument tracks. */
  const registry = new Map<string, RegisteredWindow>();
  const listeners = new Set<DoubleClickHandler>();
  let tx: UndoTransaction | null = null;
  let preSnapshot: HostSnapshot | null = null;
  let preRegistry: Map<string, RegisteredWindow> | null = null;

  const p = (): Project => io.getProject();

  /** A lane event is a chord-clip view only when its symbol parses —
   *  mid-edit manual chords are transient and excluded from the contract
   *  views (but never from gap bounds). */
  const materialize = (proj: Project, ev: ChordEvent): ChordClip | null => {
    const r = chordClipOf(ev, {
      rawMidiNotes: windowNotes(proj, chordsTrackOf(proj)?.id ?? '', ev.startTick, eventEnd(ev)),
    });
    return r.ok ? r.clip : null;
  };

  const assertTime = (time: number, op: string): void => {
    if (!isInt(time) || time < 0) throw new SuggestionError('invalid-range', `${op}: time must be an integer ≥ 0 (got ${time})`);
  };

  /** The placeholder root symbol of a fresh Smart clip: the project tonic in
   *  crescode's mixed canon (key Eb → "Eb"). Replaced when a chord is named. */
  const tonicSymbol = (proj: Project): string => spelledNoteName(proj.key);

  const applyNotesToTrack = (proj: Project, trackId: string, start: number, end: number, incoming: Pitch[]): void => {
    const track = proj.tracks.find((t) => t.id === trackId);
    if (track === undefined) throw new SuggestionError('invalid-range', `track "${trackId}" does not exist`);
    // Notes outside the window belong to other clips — never touched.
    const kept = track.notes.filter((n) => !(n.startTick >= start && n.startTick < end));
    const cleaned = sanitizeNotes(
      [...kept, ...incoming.map(toNote)],
      track.lowestNote, track.highestNote, projectEndTick(proj),
    );
    io.putProject({ ...proj, tracks: proj.tracks.map((t) => (t.id === trackId ? { ...t, notes: cleaned } : t)) });
  };

  const api: CrescodeChordTrackApi = {
    getProjectKeySignature(): ProjectKey {
      return projectKeyOf(p());
    },

    getGridResolution(): GridResolution {
      return gridResolutionOf(p().timeSignature);
    },

    getChordClipsInRange(startTime: number, endTime: number): ChordClip[] {
      const v = validateTimeRange(startTime, endTime);
      if (!v.ok) throw v.error;
      const proj = p();
      const out: ChordClip[] = [];
      for (const ev of [...proj.chords].sort(byStartThenId)) {
        if (!intersects(ev, startTime, endTime)) continue;
        const clip = materialize(proj, ev);
        if (clip !== null) out.push(clip);
      }
      return out;
    },

    getChordClipAt(time: number): ChordClip | null {
      assertTime(time, 'getChordClipAt');
      const proj = p();
      // Defensive against overlapping manual lanes: latest start wins, then
      // lowest id. Unparseable (mid-edit) events are skipped, not reported.
      const hits = proj.chords
        .filter((c) => c.startTick <= time && time < eventEnd(c))
        .sort((a, b) => b.startTick - a.startTick || byIdAsc(a, b));
      for (const hit of hits) {
        const clip = materialize(proj, hit);
        if (clip !== null) return clip;
      }
      return null;
    },

    getPreviousChordClip(time: number): ChordClip | null {
      assertTime(time, 'getPreviousChordClip');
      const proj = p();
      const hits = proj.chords
        .filter((c) => eventEnd(c) <= time)
        .sort((a, b) => eventEnd(b) - eventEnd(a) || b.startTick - a.startTick || byIdAsc(a, b));
      for (const hit of hits) {
        const clip = materialize(proj, hit);
        if (clip !== null) return clip;
      }
      return null;
    },

    getNextChordClip(time: number): ChordClip | null {
      assertTime(time, 'getNextChordClip');
      const proj = p();
      const hits = proj.chords
        .filter((c) => c.startTick >= time)
        .sort((a, b) => a.startTick - b.startTick || a.durationTicks - b.durationTicks || byIdAsc(a, b));
      for (const hit of hits) {
        const clip = materialize(proj, hit);
        if (clip !== null) return clip;
      }
      return null;
    },

    getAvailableGapAt(time: number): { startTime: number; endTime: number } | null {
      assertTime(time, 'getAvailableGapAt');
      const proj = p();
      // Bounds come from ALL events (even unparseable mid-edit ones).
      if (proj.chords.some((c) => c.startTick <= time && time < eventEnd(c))) return null;
      const prev = proj.chords
        .filter((c) => eventEnd(c) <= time)
        .sort((a, b) => eventEnd(b) - eventEnd(a) || b.startTick - a.startTick || byIdAsc(a, b))[0];
      const next = proj.chords
        .filter((c) => c.startTick >= time)
        .sort((a, b) => a.startTick - b.startTick || a.durationTicks - b.durationTicks || byIdAsc(a, b))[0];
      const gap = { startTime: prev !== undefined ? eventEnd(prev) : 0, endTime: next !== undefined ? next.startTick : Number.POSITIVE_INFINITY };
      // An open tail gap is a legitimate contract value (the contract's own
      // reference fake returns Infinity) — validateGap only judges bounded spans.
      if (gap.endTime === Number.POSITIVE_INFINITY) {
        return Number.isInteger(gap.startTime) && gap.startTime >= 0 ? gap : null;
      }
      const v = validateGap(gap);
      return v.ok ? gap : null;
    },

    createMidiClip(startTime: number, lengthTicks: number, trackId = CHORD_LANE_TRACK_ID): MidiClip {
      assertInTransaction(tx, 'createMidiClip');
      if (!isInt(startTime) || startTime < 0 || !isInt(lengthTicks) || lengthTicks < 1) {
        throw new SuggestionError('invalid-range', `createMidiClip: bounds must be integers with lengthTicks ≥ 1 (got [${startTime}, +${lengthTicks}))`);
      }
      const proj = p();
      if (trackId === CHORD_LANE_TRACK_ID) {
        const id = uid(SMART_CLIP_ID_PREFIX);
        const next: Project = {
          ...proj,
          chords: [...proj.chords, { id, symbol: tonicSymbol(proj), startTick: startTime, durationTicks: lengthTicks }],
        };
        const v = validateNoClipOverlap(next.chords.map((c) => ({ id: c.id, startTime: c.startTick, lengthTicks: c.durationTicks })));
        if (!v.ok) throw v.error; // never overwrite or move existing clips
        io.putProject(next);
        return { id, startTime, lengthTicks, trackId, notes: [], metadata: {} as ClipMetadata };
      }
      if (!proj.tracks.some((t) => t.id === trackId)) {
        throw new SuggestionError('invalid-range', `createMidiClip: track "${trackId}" does not exist`);
      }
      const id = uid(SMART_CLIP_ID_PREFIX);
      registry.set(id, { startTime, lengthTicks, trackId });
      return { id, startTime, lengthTicks, trackId, notes: [], metadata: {} as ClipMetadata };
    },

    getMidiNotes(clipId: string): Pitch[] {
      const proj = p();
      const ev = proj.chords.find((c) => c.id === clipId);
      if (ev !== undefined) return windowNotes(proj, chordsTrackOf(proj)?.id ?? '', ev.startTick, eventEnd(ev));
      const reg = registry.get(clipId);
      if (reg !== undefined) return windowNotes(proj, reg.trackId, reg.startTime, reg.startTime + reg.lengthTicks);
      throw new SuggestionError('clip-not-found', `no chord-lane clip "${clipId}"`);
    },

    replaceMidiNotes(clipId: string, notes: Pitch[]): void {
      assertInTransaction(tx, 'replaceMidiNotes');
      for (const n of notes) {
        const v = validatePitch(n);
        if (!v.ok) throw v.error;
      }
      const proj = p();
      const ev = proj.chords.find((c) => c.id === clipId);
      if (ev !== undefined) {
        assertNotesFit(clipId, ev.startTick, eventEnd(ev), notes);
        applyNotesToTrack(proj, chordsTrackOf(proj)?.id ?? '', ev.startTick, eventEnd(ev), notes);
        return;
      }
      const reg = registry.get(clipId);
      if (reg === undefined) throw new SuggestionError('clip-not-found', `no chord-lane clip "${clipId}"`);
      assertNotesFit(clipId, reg.startTime, reg.startTime + reg.lengthTicks, notes);
      applyNotesToTrack(proj, reg.trackId, reg.startTime, reg.startTime + reg.lengthTicks, notes);
    },

    clearMidiNotes(clipId: string): void {
      assertInTransaction(tx, 'clearMidiNotes');
      const proj = p();
      const ev = proj.chords.find((c) => c.id === clipId);
      if (ev !== undefined) {
        applyNotesToTrack(proj, chordsTrackOf(proj)?.id ?? '', ev.startTick, eventEnd(ev), []);
        return;
      }
      const reg = registry.get(clipId);
      if (reg === undefined) throw new SuggestionError('clip-not-found', `no chord-lane clip "${clipId}"`);
      applyNotesToTrack(proj, reg.trackId, reg.startTime, reg.startTime + reg.lengthTicks, []);
    },

    renameChordClip(clipId: string, chordName: string): void {
      assertInTransaction(tx, 'renameChordClip');
      const analyzed = chordFromSymbol(chordName);
      if (!analyzed.ok) throw analyzed.error;
      const proj = p();
      if (!proj.chords.some((c) => c.id === clipId)) {
        throw new SuggestionError('clip-not-found', `chord-lane clip "${clipId}" does not exist (MIDI clips on instrument tracks carry no chord symbol)`);
      }
      // Only the symbol changes — id, position, length untouched (rule 3).
      io.putProject({ ...proj, chords: proj.chords.map((c) => (c.id === clipId ? { ...c, symbol: analyzed.chord.spelling } : c)) });
    },

    subscribeToDoubleClick(trackId: string, callback: DoubleClickHandler): Unsubscribe {
      if (trackId !== CHORD_LANE_TRACK_ID) return () => undefined; // the gesture lives on the chord lane
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },

    beginUndoTransaction(label: string): UndoTransaction {
      assertNoOpenTransaction(tx);
      preSnapshot = io.snapshot();
      preRegistry = new Map(registry);
      tx = { label };
      return tx;
    },

    commitUndoTransaction(): void {
      assertTransactionOpen(tx);
      const snapshot = preSnapshot!;
      tx = null;
      preSnapshot = null;
      preRegistry = null;
      io.endTransaction(snapshot, 'commit');
    },

    cancelUndoTransaction(): void {
      assertTransactionOpen(tx);
      const snapshot = preSnapshot!;
      const windows = preRegistry!;
      tx = null;
      preSnapshot = null;
      preRegistry = null;
      // Roll back session windows created inside the transaction.
      registry.clear();
      for (const [k, v] of windows) registry.set(k, v);
      io.endTransaction(snapshot, 'cancel');
    },

    // --- crescode extras ---------------------------------------------------

    isTransactionActive(): boolean {
      return tx !== null;
    },

    removeChordClip(clipId: string): void {
      assertInTransaction(tx, 'removeChordClip');
      const proj = p();
      const ev = proj.chords.find((c) => c.id === clipId);
      if (ev !== undefined) {
        const laneTrack = chordsTrackOf(proj);
        const start = ev.startTick;
        const end = eventEnd(ev);
        const tracks = proj.tracks.map((t) =>
          laneTrack !== null && t.id === laneTrack.id
            ? { ...t, notes: t.notes.filter((n) => !(n.startTick >= start && n.startTick < end)) }
            : t,
        );
        io.putProject({ ...proj, chords: proj.chords.filter((c) => c.id !== clipId), tracks });
        return;
      }
      if (registry.delete(clipId)) return;
      throw new SuggestionError('clip-not-found', `no chord-lane clip "${clipId}"`);
    },

    getChordClipById(clipId: string): ChordClip | null {
      const proj = p();
      const ev = proj.chords.find((c) => c.id === clipId);
      return ev === undefined ? null : materialize(proj, ev);
    },

    emitDoubleClick(clip: ChordClip | null, time: number): void {
      for (const cb of [...listeners]) cb(clip, time);
    },
  };

  return api;
}
