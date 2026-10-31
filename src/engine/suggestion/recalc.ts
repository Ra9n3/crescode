/**
 * Debounced recalculation for the Smart Chord Suggestion overlay.
 *
 * Feature requirement: "Suggestion recalculation is debounced during rapid
 * edits." The overlay re-runs the background engine whenever the project
 * moves — including while the user drags a slider or types in a neighbor
 * panel, which can fire dozens of project swaps per second. Coalescing them
 * keeps the engine off the hot path without changing its result: the LAST
 * state inside the window is the one that gets computed, and the compute is
 * the same read-only engine call as before.
 *
 * Pure and deterministic: the schedule (timer) and clock are injectable, so
 * tests drive the exact delivery sequence without real time. Same call
 * sequence + same clock → same delivery sequence, always. No engine code, no
 * store access lives here.
 */

/** Cancels the pending delivery (idempotent). */
export type CancelFn = () => void;

/** Schedules `fn` after `delayMs`. Defaults to setTimeout; tests inject a
 *  virtual scheduler. Must return a cancel function. */
export type ScheduleFn = (fn: () => void, delayMs: number) => CancelFn;

export interface RecalculatorOptions {
  /** Coalescing window in ms (default 120 — fast enough to feel instant). */
  delayMs?: number;
  schedule?: ScheduleFn;
}

export interface DebouncedRecalculator {
  /** Requests a recalculation. A request inside the window of a previous
   *  one replaces it (only the last runs); the first request of a window
   *  schedules the delivery after `delayMs`. */
  request(): void;
  /** Runs a pending recalculation immediately (and cancels the timer).
   *  No-op when nothing is pending. */
  flush(): void;
  /** Drops a pending recalculation without running it (idempotent). */
  cancel(): void;
  /** True while a delivery is scheduled. */
  readonly pending: boolean;
}

const defaultSchedule: ScheduleFn = (fn, delayMs) => {
  const id = setTimeout(fn, delayMs);
  return () => clearTimeout(id);
};

export function createSuggestionRecalculator(
  task: () => void,
  opts: RecalculatorOptions = {},
): DebouncedRecalculator {
  const delayMs = opts.delayMs ?? 120;
  const schedule = opts.schedule ?? defaultSchedule;
  let cancelPending: CancelFn | null = null;

  return {
    request() {
      if (cancelPending !== null) cancelPending(); // coalesce: the newest state wins
      cancelPending = schedule(() => {
        cancelPending = null;
        task();
      }, delayMs);
    },
    flush() {
      if (cancelPending === null) return;
      cancelPending();
      cancelPending = null;
      task();
    },
    cancel() {
      if (cancelPending === null) return;
      cancelPending();
      cancelPending = null;
    },
    get pending() {
      return cancelPending !== null;
    },
  };
}
