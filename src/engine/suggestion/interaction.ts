/**
 * The interaction layer between the Smart Chord Suggestion UI and the
 * native Chord Track timeline (feature spec: double-click interception,
 * position & length logic, MIDI clip creation, existing-clip handling).
 *
 * Everything here is deterministic and host-independent: the planner and
 * the gate are pure, the controller drives any ChordTrackAPI (plus the
 * crescode extras) through injected hooks. No transport calls, no rng —
 * gestures during playback are handled by the same code path and can never
 * corrupt clip state, because every write is one undo transaction and a
 * failure cancels it back to the pre-gesture snapshot.
 *
 * Gesture semantics on the chord lane:
 *  - double-click on empty space  → plan from the grid, create a Smart clip
 *    (1 bar, or exactly filling a shorter gap; too-small gaps warn and
 *    create nothing) inside a "Create Smart Chord Clip" transaction, then
 *    open the chord editor for the new clip.
 *  - double-click on a clip       → open the chord editor with the clip's
 *    chord, raw MIDI, confidence and alternatives. Position/length are
 *    never touched.
 *  - the first click of a double-click on empty space runs crescode's
 *    protected manual-chord creation (a plain lane chord). When the
 *    double-click then lands on that just-created chord, the gesture is
 *    recognized via the wire's freshness tracker and converted ATOMICALLY:
 *    the manual false start is removed inside the same transaction that
 *    creates the Smart clip, so the net effect is one undo step and, on
 *    failure, the manual chord is restored.
 */
import { pitchOf } from './model';
import { parseChordClipView, type ChordAnalysis } from './parse';
import type { ChordTrackAPI } from './adapter';
import type {
  Chord, ChordClip, GridResolution, Pitch, ProjectKey, UndoTransaction,
} from './types';

/** The adapter surface the interaction layer drives: the portable contract
 *  plus the two crescode extras it needs. */
export type InteractionApi = ChordTrackAPI & {
  isTransactionActive(): boolean;
  removeChordClip(clipId: string): void;
};

/** Label of the undo step a Smart-clip creation produces. */
export const CREATE_CLIP_TRANSACTION_LABEL = 'Create Smart Chord Clip';

// ---------------------------------------------------------------------------
// 1+2. Position & length planning (native grid, ticks only)
// ---------------------------------------------------------------------------

export type ClipPlan =
  | { ok: true; startTick: number; lengthTicks: number; leftoverTicks: number; availableTicks: number }
  | { ok: false; reason: 'inside-clip' | 'too-small'; availableTicks: number; snapTicks: number };

/**
 * Decides where a double-clicked empty span should host a Smart clip.
 *
 * Rules (gap = the open span around the click, from the host grid):
 *  - available == 1 bar            → clip exactly 1 bar long.
 *  - available  < 1 bar (≥ snap)   → clip exactly fills the gap.
 *  - available  > 1 bar            → clip 1 bar long, the rest stays empty.
 *  - available  < one grid unit    → too small for a usable clip: warn,
 *                                    create nothing (crescode's own chord
 *                                    lane floors manual chords at one grid
 *                                    unit — Smart clips never go under it,
 *                                    and they never overlap neighbours).
 *  - no gap (inside a clip)        → nothing to create.
 * The start snaps DOWN to the grid (the lane's native snap), clamped into
 * the gap. All values are ticks; an infinite tail gap counts as "> 1 bar".
 */
export function planClipPlacement(
  gap: { startTime: number; endTime: number } | null,
  clickTick: number,
  grid: GridResolution,
): ClipPlan {
  const snap = grid.ticksPerBeat;
  const bar = grid.ticksPerBar;
  if (gap === null) {
    return { ok: false, reason: 'inside-clip', availableTicks: 0, snapTicks: snap };
  }
  const click = Number.isFinite(clickTick) ? Math.max(0, Math.floor(clickTick)) : 0;
  let start = Math.floor(click / snap) * snap; // native snap: floor to the grid
  if (start < gap.startTime) start = gap.startTime; // grid line sits before the gap
  if (gap.endTime <= start) {
    // The click snapped past the gap's end — nothing usable starts in here.
    return { ok: false, reason: 'too-small', availableTicks: 0, snapTicks: snap };
  }
  const available = gap.endTime - start; // Infinity for an open tail gap — handled below
  if (available < snap) {
    return { ok: false, reason: 'too-small', availableTicks: available, snapTicks: snap };
  }
  if (available >= bar) {
    return { ok: true, startTick: start, lengthTicks: bar, leftoverTicks: available - bar, availableTicks: available };
  }
  return { ok: true, startTick: start, lengthTicks: available, leftoverTicks: 0, availableTicks: available };
}

// ---------------------------------------------------------------------------
// 1. Double-click interception helpers
// ---------------------------------------------------------------------------

/**
 * Drops accidental duplicate gestures: the same click tick within the
 * cooldown window is ignored, so rapid extra clicks never create duplicate
 * clips. Gestures at a different tick always pass.
 */
export class DoubleClickGate {
  private last: { tick: number; at: number } | null = null;
  private readonly cooldownMs: number;
  private readonly clock: () => number;

  constructor(opts: { cooldownMs?: number; now?: () => number } = {}) {
    this.cooldownMs = opts.cooldownMs ?? 350;
    this.clock = opts.now ?? Date.now;
  }

  admit(clickTick: number, now = this.clock()): boolean {
    const last = this.last;
    if (last !== null && now - last.at < this.cooldownMs && last.tick === clickTick) return false;
    this.last = { tick: clickTick, at: now };
    return true;
  }

  reset(): void {
    this.last = null;
  }
}

/** What a fresh Smart clip contains before the user picks a chord. */
export type SmartClipPlaceholder = 'empty' | 'root-note';

/**
 * The root-note placeholder: one key-tonic note spanning the clip
 * (C3-based so the tonic always sits in a singable octave). Empty
 * preference returns nothing to write.
 */
export function placeholderNotesFor(
  clip: { startTime: number; lengthTicks: number },
  projectKey: ProjectKey,
  preference: SmartClipPlaceholder,
): Pitch[] {
  if (preference === 'empty') return [];
  return [pitchOf({ pitch: 48 + projectKey.tonic, startTick: clip.startTime, durationTicks: clip.lengthTicks, velocity: 100 })];
}

// ---------------------------------------------------------------------------
// 3+4. The gesture controller
// ---------------------------------------------------------------------------

export interface InteractionHooks {
  /** Open the chord editing UI for this clip (stores the created clip id —
   *  the suggestion UI and the MIDI injection read it from there). */
  openEditor(clipId: string): void;
  warn(text: string): void;
  error(text: string): void;
  /** The selected new-clip content preference (a persisted user setting). */
  placeholder(): SmartClipPlaceholder;
  now?(): number;
}

export interface GestureOptions {
  /** The clip under the cursor was created by the first click of this very
   *  double-click (manual false start — converted atomically, see module doc). */
  freshFromManualCreate?: boolean;
}

export interface SuggestionInteraction {
  handleDoubleClick(clip: ChordClip | null, time: number, opts?: GestureOptions): void;
  gate: DoubleClickGate;
}

export function createSuggestionInteraction(api: InteractionApi, hooks: InteractionHooks): SuggestionInteraction {
  const gate = new DoubleClickGate({ now: hooks.now });

  const createSmartClip = (time: number, freshClip: ChordClip | null): void => {
    let tx: UndoTransaction | null = null;
    try {
      tx = api.beginUndoTransaction(CREATE_CLIP_TRANSACTION_LABEL);
      if (freshClip !== null) api.removeChordClip(freshClip.id); // convert the false start inside the same undo step
      const gap = api.getAvailableGapAt(time);
      const plan = planClipPlacement(gap, time, api.getGridResolution());
      if (!plan.ok) {
        api.cancelUndoTransaction();
        if (plan.reason === 'too-small') {
          hooks.warn(`Not enough room for a chord clip here (${plan.availableTicks} ticks — needs one grid unit of ${plan.snapTicks}).`);
        }
        return;
      }
      const clip = api.createMidiClip(plan.startTick, plan.lengthTicks);
      const notes = placeholderNotesFor(clip, api.getProjectKeySignature(), hooks.placeholder());
      if (notes.length > 0) api.replaceMidiNotes(clip.id, notes);
      api.commitUndoTransaction();
      hooks.openEditor(clip.id);
    } catch (err) {
      // Creation failed: restore the timeline to its prior state.
      try {
        if (tx !== null && api.isTransactionActive()) api.cancelUndoTransaction();
      } catch {
        /* the transaction was already closed by the failure path */
      }
      hooks.error(`Clip creation failed — the timeline was restored. (${err instanceof Error ? err.message : String(err)})`);
    }
  };

  return {
    gate,
    handleDoubleClick(clip, time, opts = {}) {
      // Rule: ignore gestures while an undo transaction is already active.
      if (api.isTransactionActive()) return;
      if (!gate.admit(time, hooks.now?.())) return; // debounced duplicate
      if (Number.isInteger(time) === false || time < 0) return;
      if (clip !== null) {
        if (opts.freshFromManualCreate) {
          createSmartClip(time, clip);
          return;
        }
        // Existing clip: open the chord editing UI — never create, never move.
        hooks.openEditor(clip.id);
        return;
      }
      createSmartClip(time, null);
    },
  };
}

// ---------------------------------------------------------------------------
// Editor data (part 4 — what the chord editing UI loads)
// ---------------------------------------------------------------------------

export interface ClipEditorData {
  clip: ChordClip;
  /** Fresh parse of the clip's raw MIDI — null for user-typed symbols
   *  without MIDI backing (their confidence is 1: user-authored). */
  analysis: ChordAnalysis | null;
  previousChord: Chord | null;
  nextChord: Chord | null;
  projectKey: ProjectKey;
  grid: GridResolution;
}

/** Loads everything the chord editing UI shows for one clip: the chord, the
 *  raw notes, the confidence and the alternative interpretations, plus the
 *  surrounding harmony the suggestion engine will reason about. Read-only. */
export function loadClipEditorData(
  api: InteractionApi & { getChordClipById(clipId: string): ChordClip | null },
  clipId: string,
): ClipEditorData | null {
  const clip = api.getChordClipById(clipId);
  if (clip === null) return null;
  const projectKey = api.getProjectKeySignature();
  const grid = api.getGridResolution();
  const previousChord = api.getPreviousChordClip(clip.startTime)?.chord ?? null;
  const nextChord = api.getNextChordClip(clip.startTime + clip.lengthTicks)?.chord ?? null;
  const notes = clip.rawMidiNotes ?? [];
  const analysis = notes.length > 0
    ? parseChordClipView(clip, { grid, projectKey, previousChord, nextChord })
    : null;
  return { clip, analysis, previousChord, nextChord, projectKey, grid };
}
