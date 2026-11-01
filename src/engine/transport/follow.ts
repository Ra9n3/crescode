/**
 * Pure auto-scroll ("follow playhead") policy.
 *
 * The arranger is a native scroll container: content x of timeline tick t is
 * `headerPx + t * pxPerTick`, and the sticky track-header column covers the
 * first `headerPx` device pixels of the viewport. The policy is a pure
 * function of (mode, trigger, view geometry, playhead tick, loop region) so
 * every mode, the loop-fit rule and the wrap-back rule are unit-testable
 * without a DOM. The Playhead component applies the result once per frame.
 *
 * Modes (spec §4):
 *  off        — the view never follows; the playhead may leave the view.
 *  smooth     — default. Stationary until the playhead crosses the trigger
 *               point (fraction of the visible timeline width), then the
 *               view scrolls continuously with the playhead pinned at the
 *               trigger — no jumps, upcoming content always ahead.
 *  page       — stationary until the playhead exits the view, then jump
 *               forward by one full view (stable clip positions, visible
 *               page flip).
 *  centered   — playhead pinned at the horizontal center of the timeline
 *               area (equivalent to a 0.5 trigger, but pinned from t=0).
 *  stationary — the playhead is pinned at the configured fraction and the
 *               timeline moves beneath it (labelled: disorienting).
 */

export type FollowMode = 'off' | 'smooth' | 'page' | 'centered' | 'stationary';

export const FOLLOW_MODES: { value: FollowMode; label: string; tip: string }[] = [
  { value: 'off', label: 'Off', tip: 'Auto-scroll off — the view never follows the playhead' },
  { value: 'smooth', label: 'Smooth', tip: 'Smooth continuous follow — scrolls once the playhead reaches the trigger point (default)' },
  { value: 'page', label: 'Page', tip: 'Page follow — jumps one full view when the playhead exits the visible range' },
  { value: 'centered', label: 'Centered', tip: 'Centered follow — the playhead stays centered while the timeline scrolls beneath it' },
  { value: 'stationary', label: 'Stationary', tip: 'Stationary playhead — the playhead is pinned and the timeline moves beneath it (can be disorienting)' },
];

/** Configurable trigger points, as a fraction of the visible timeline width. */
export const TRIGGER_POINTS: { value: number; label: string }[] = [
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 0.9, label: '90%' },
];

export interface FollowView {
  mode: FollowMode;
  /** Fraction of the visible timeline width where following kicks in / pins. */
  trigger: number;
  playheadTick: number;
  pxPerTick: number;
  /** Content-pixel offset of tick 0 (the sticky header column width). */
  headerPx: number;
  scrollLeft: number;
  /** Visible width of the scroll container (includes the header column). */
  clientWidth: number;
  /** Active loop region, when looping (also accepts the transport's [start, end] tuple). */
  loop: { startTick: number; endTick: number } | [number, number] | null;
}

export interface FollowResult {
  /** New scrollLeft, or null when the view should stay put this frame. */
  scrollLeft: number | null;
  /** True when the playhead jumped backwards out of view (loop wrap, seek
   *  back) — the applier may glide the view back instead of hard-jumping. */
  wrapBack?: boolean;
}

const clampScroll = (x: number) => Math.max(0, x);

/** Visible timeline width = viewport minus the sticky header column. */
export function timelineWidth(v: Pick<FollowView, 'clientWidth' | 'headerPx'>): number {
  return Math.max(1, v.clientWidth - v.headerPx);
}

/** Content x of the playhead. */
export function playheadX(v: Pick<FollowView, 'playheadTick' | 'pxPerTick' | 'headerPx'>): number {
  return v.headerPx + v.playheadTick * v.pxPerTick;
}

/** Where the view pins the playhead for smooth/centered/stationary modes. */
function anchorFraction(mode: FollowMode, trigger: number): number {
  if (mode === 'centered') return 0.5;
  return Math.min(0.95, Math.max(0.05, trigger));
}

/** Does the loop region fit inside the visible timeline width? */
export function loopFitsInView(loop: { startTick: number; endTick: number } | [number, number], v: Pick<FollowView, 'pxPerTick' | 'headerPx' | 'clientWidth'>): boolean {
  const [a, b] = Array.isArray(loop) ? loop : [loop.startTick, loop.endTick];
  return (b - a) * v.pxPerTick <= timelineWidth(v);
}

/** Is the playhead inside the currently visible timeline range? */
export function playheadVisible(v: Pick<FollowView, 'playheadTick' | 'pxPerTick' | 'headerPx' | 'scrollLeft' | 'clientWidth'>): boolean {
  const x = playheadX(v);
  return x >= v.scrollLeft + v.headerPx - 0.5 && x <= v.scrollLeft + v.clientWidth + 0.5;
}

/**
 * One frame of the follow policy. Returns the scrollLeft the view should
 * take this frame, or null to keep the current one.
 */
export function followScroll(v: FollowView): FollowResult {
  if (v.mode === 'off') return { scrollLeft: null };
  const tw = timelineWidth(v);
  const x = playheadX(v);
  const viewL = v.scrollLeft + v.headerPx; // visible timeline left edge (content x)
  const viewR = v.scrollLeft + v.clientWidth; // visible right edge (content x)

  // Loop-fit rule (spec §7): a loop that fits on screen must not scroll at
  // all — no page jumps on every cycle. Only opt out when the loop is not
  // actually on screen (e.g. the view was left elsewhere without follow
  // having re-anchored yet).
  if (v.loop) {
    const [ls, le] = Array.isArray(v.loop) ? v.loop : [v.loop.startTick, v.loop.endTick];
    if (loopFitsInView(v.loop, v) && le * v.pxPerTick + v.headerPx >= viewL && ls * v.pxPerTick + v.headerPx <= viewR) {
      return { scrollLeft: null };
    }
  }

  if (v.mode === 'page') {
    if (x > viewR) return { scrollLeft: clampScroll(v.scrollLeft + tw) }; // one full view forward
    if (x < viewL) return { scrollLeft: clampScroll(x - v.headerPx), wrapBack: true }; // loop wrap / seek back
    return { scrollLeft: null };
  }

  const anchor = anchorFraction(v.mode, v.trigger);
  const targetFor = (px: number) => clampScroll(px - v.headerPx - anchor * tw);

  if (v.mode === 'centered' || v.mode === 'stationary') {
    // Always pinned (centered pins at 0.5; stationary pins at the trigger).
    return { scrollLeft: targetFor(x) };
  }

  // smooth: stationary until the playhead crosses the anchor, then pinned.
  if (x > viewL + anchor * tw) return { scrollLeft: targetFor(x) };
  if (x < viewL) return { scrollLeft: targetFor(x), wrapBack: true };
  return { scrollLeft: null };
}

/**
 * Snap the view so the playhead sits where the mode wants it — used by the
 * Re-follow control, playback start, zoom re-anchoring, and loop-wrap
 * glides.
 */
export function refollowScrollLeft(v: FollowView): number {
  if (v.mode === 'off') return v.scrollLeft;
  if (v.mode === 'page') return clampScroll(playheadX(v) - v.headerPx);
  const anchor = anchorFraction(v.mode, v.trigger);
  return clampScroll(playheadX(v) - v.headerPx - anchor * timelineWidth(v));
}
