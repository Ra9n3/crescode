/**
 * Pure transport state decisions (spec §2, §3, §8, §11).
 *
 * The store holds the authoritative parked playhead in `startTick`; the
 * audio engine reports a live tick while playing. These functions turn
 * (current state, live tick, preferences) into the next state so the
 * Pause / Stop / Second-Stop semantics are unit-testable without an
 * AudioContext. `audio/transport.ts` applies the results.
 *
 * Semantics:
 *  Play (fresh)    — starts from the parked `startTick`, records it as
 *                    `lastPlaybackStartPosition`.
 *  Play (paused)   — resumes from the exact paused position;
 *                    `lastPlaybackStartPosition` is unchanged.
 *  Pause           — freezes the playhead at its exact current position.
 *  Stop (default)  — parks at the stopped position; no automatic return.
 *  Stop (pref)     — "Return to start position on stop" sends the playhead
 *                    back to `lastPlaybackStartPosition`.
 *  Second Stop     — with "Second Stop returns to start position" enabled,
 *                    a Stop press while already stopped relocates to
 *                    `lastPlaybackStartPosition`; disabled (default), it is
 *                    a no-op.
 */

export interface TransportSnapshot {
  playing: boolean;
  paused: boolean;
  /** Parked playhead position (ticks) while stopped/paused. */
  startTick: number;
  /** Where the last playback run started (ticks). */
  lastPlaybackStartPosition: number;
  /** Where the last Stop parked the playhead (ticks). */
  stoppedPosition: number;
}

export interface StopPrefs {
  returnToStartOnStop: boolean;
  secondStopReturnsToStart: boolean;
}

export interface PlayDecision {
  fromTick: number;
  lastPlaybackStartPosition: number;
  resumedFromPause: boolean;
}

/** Pressing Play while stopped or paused. */
export function beginPlay(st: TransportSnapshot): PlayDecision {
  if (st.paused) return { fromTick: st.startTick, lastPlaybackStartPosition: st.lastPlaybackStartPosition, resumedFromPause: true };
  return { fromTick: st.startTick, lastPlaybackStartPosition: st.startTick, resumedFromPause: false };
}

/** Pressing Pause while playing: freeze at the exact live position. */
export function parkPause(liveTick: number): Pick<TransportSnapshot, 'startTick' | 'stoppedPosition'> & { paused: true; playing: false } {
  const pos = Math.max(0, Math.round(liveTick));
  return { startTick: pos, stoppedPosition: pos, paused: true, playing: false };
}

/** Pressing Stop while playing or paused. */
export function parkStop(
  st: TransportSnapshot,
  liveTick: number | null,
  prefs: StopPrefs,
): Pick<TransportSnapshot, 'startTick' | 'stoppedPosition'> & { paused: false; playing: false } {
  const pos = Math.max(0, Math.round(liveTick ?? st.startTick));
  const startTick = prefs.returnToStartOnStop ? st.lastPlaybackStartPosition : pos;
  return { startTick, stoppedPosition: pos, paused: false, playing: false };
}

/**
 * Pressing Stop while already stopped. Returns the tick to relocate to, or
 * null for a no-op (default).
 */
export function secondStop(st: TransportSnapshot, prefs: StopPrefs): number | null {
  if (!prefs.secondStopReturnsToStart) return null;
  if (st.startTick === st.lastPlaybackStartPosition) return null;
  return st.lastPlaybackStartPosition;
}

/**
 * Clicking / locating while the playhead must stay inside the project
 * (spec §8: clamp to the project end instead of parking in empty space).
 */
export function clampSeekTick(tick: number, endTick: number): number {
  if (Number.isNaN(tick)) return 0;
  return Math.max(0, Math.min(endTick, Math.round(tick)));
}
