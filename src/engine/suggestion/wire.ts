/**
 * App wiring for the Smart Chord Suggestion interaction layer: binds the
 * crescode host adapter and the gesture controller to the real zustand
 * store. This is the ONLY module in the feature that knows both sides —
 * engine code stays store-free, UI code never touches the project model
 * directly for chord clips.
 *
 * The chord lane (Arranger) calls `chordTrackGesture(clip | null, tick,
 * opts)`; the controller drives the API; the editor panel reads the open
 * clip id from the store (`suggestionClipId`) and applies changes through
 * `chordTrackApi` transactions.
 */
import { HISTORY_LIMIT, useStore } from '../../store/store';
import type { ChordClip } from './types';
import {
  createCrescodeChordTrackApi, SMART_CLIP_ID_PREFIX, type ChordLaneHostIo, type CrescodeChordTrackApi, type HostSnapshot,
} from './host';

export { SMART_CLIP_ID_PREFIX };
import {
  createSuggestionInteraction, type GestureOptions, type SmartClipPlaceholder, type SuggestionInteraction,
} from './interaction';
import { suggestChordsAt, type ChordSuggestion, type SuggestionPreferences } from './engine';

/** The adapter's view of the app: project in, project out, one undo entry
 *  per committed transaction, toasts for non-destructive feedback. */
export function createDefaultChordLaneHostIo(): ChordLaneHostIo {
  return {
    getProject: () => useStore.getState().project,
    snapshot: (): HostSnapshot => {
      const s = useStore.getState();
      return { project: s.project, dirty: s.dirty };
    },
    putProject: (p) => useStore.setState({ project: p, dirty: true }),
    endTransaction: (pre, mode) => {
      if (mode === 'cancel') {
        useStore.setState({ project: pre.project, dirty: pre.dirty });
        return;
      }
      const s = useStore.getState();
      useStore.setState({ past: [...s.past, pre.project].slice(-HISTORY_LIMIT), future: [], lastCoalesce: null });
    },
    isPlaying: () => useStore.getState().playing,
    now: () => Date.now(),
    notify: (kind, text) => useStore.getState().toast(kind, text),
  };
}

export const chordTrackApi: CrescodeChordTrackApi = createCrescodeChordTrackApi(createDefaultChordLaneHostIo());

const interaction: SuggestionInteraction = createSuggestionInteraction(chordTrackApi, {
  openEditor: (clipId) => {
    useStore.getState().set({ suggestionClipId: clipId, selectedChordId: clipId, selectedSectionId: null });
  },
  warn: (text) => useStore.getState().toast('warn', text),
  error: (text) => useStore.getState().toast('error', text),
  placeholder: (): SmartClipPlaceholder => useStore.getState().settings.smartChordPlaceholder ?? 'root-note',
  now: () => Date.now(),
  // Transport guard: creating clips mid-playback is refused non-blockingly.
  isPlaying: () => useStore.getState().playing,
  // Structural guard: a locked or missing chord lane accepts no writes.
  laneEditable: () => chordTrackApi.isLaneEditable(),
});

// The adapter's emitter stays available for other consumers of the gesture
// (contract surface); the lane calls the controller through this helper so
// gesture hints (fresh manual-create conversion) reach it directly.
export function chordTrackGesture(clip: ChordClip | null, time: number, opts?: GestureOptions): void {
  interaction.handleDoubleClick(clip, time, opts);
}

// --- the background suggestion engine, bound to the app ---------------------

export interface ChordSuggestionsAtOptions {
  /** User tuning for the engine (qualities, complexity, weights). */
  preferences?: SuggestionPreferences;
  /** A clip to keep out of the neighbor context. Defaults to the clip the
   *  Smart Chord editor has open (`suggestionClipId`) — the freshly created
   *  Smart clip must not act as its own next/previous chord. */
  excludeClipId?: string;
}

/**
 * The background Smart Suggestion Engine entry the overlay uses: the chord
 * editor calls this when it opens for a double-click at `time` and renders
 * the returned list directly. Strictly read-only — every write stays inside
 * the interaction layer's undo transactions.
 */
export function chordSuggestionsAt(time: number, options: ChordSuggestionsAtOptions = {}): ChordSuggestion[] {
  const excludeClipId = options.excludeClipId ?? useStore.getState().suggestionClipId ?? undefined;
  return suggestChordsAt(chordTrackApi, time, { preferences: options.preferences, excludeClipId });
}

// --- manual-create freshness (the double-click conversion) -----------------

const FRESH_WINDOW_MS = 450;
const manualCreates = new Map<string, number>();

/** The chord lane records every manual chord it creates, so the gesture
 *  layer can recognize the just-created false start of a double-click. */
export function noteManualCreate(clipId: string): void {
  manualCreates.set(clipId, Date.now());
  if (manualCreates.size > 64) {
    const cutoff = Date.now() - 5 * FRESH_WINDOW_MS;
    for (const [k, at] of manualCreates) if (at < cutoff) manualCreates.delete(k);
  }
}

export function isFreshManualCreate(clipId: string): boolean {
  const at = manualCreates.get(clipId);
  return at !== undefined && Date.now() - at < FRESH_WINDOW_MS;
}
