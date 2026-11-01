import { describe, expect, it } from 'vitest';
import { catchUpScrollLeft, chaseStep, FOLLOW_RESUME_IDLE_MS, followScroll, loopFitsInView, playheadVisible, refollowScrollLeft, timelineWidth, type FollowView } from '../src/engine/transport/follow';

// Mirrors the arranger geometry: 300px sticky header, 1300px viewport.
const HEADER = 300;
const CW = 1300; // visible timeline width = 1000px

const view = (over: Partial<FollowView>): FollowView => ({
  mode: 'smooth', trigger: 0.75, playheadTick: 0, pxPerTick: 1, headerPx: HEADER,
  scrollLeft: 0, clientWidth: CW, loop: null, ...over,
});

describe('timeline geometry', () => {
  it('visible timeline width excludes the sticky header column', () => {
    expect(timelineWidth({ clientWidth: CW, headerPx: HEADER })).toBe(1000);
  });
  it('a degenerate (tiny) viewport still yields a positive width', () => {
    expect(timelineWidth({ clientWidth: 100, headerPx: HEADER })).toBe(1);
  });
  it('playhead visibility boundaries (content under the sticky header counts as hidden)', () => {
    const base = { pxPerTick: 1, headerPx: HEADER, scrollLeft: 1000, clientWidth: CW };
    expect(playheadVisible({ ...base, playheadTick: 1000 })).toBe(true); // x = 1300 = left edge of the timeline area
    expect(playheadVisible({ ...base, playheadTick: 1999 })).toBe(true); // x = 2299 ≤ viewR 2300
    expect(playheadVisible({ ...base, playheadTick: 2001 })).toBe(false);
    expect(playheadVisible({ ...base, playheadTick: 999 })).toBe(false); // still under the header
  });
});

describe('smooth continuous follow (default)', () => {
  it('stays stationary while the playhead is left of the trigger point', () => {
    // Playhead at 40% of the visible width → no scroll.
    const v = view({ playheadTick: 400 }); // x = 700 < 300 + 750
    expect(followScroll(v).scrollLeft).toBeNull();
  });
  it('crossing the trigger starts scrolling and pins the playhead at 75%', () => {
    const v = view({ playheadTick: 1000 }); // x = 1300 > anchor 1050
    const r = followScroll(v);
    expect(r.scrollLeft).not.toBeNull();
    // After the scroll the playhead sits exactly at the anchor: x - scrollLeft - header = 0.75 * tw
    const pinned = 300 + 1000 - (r.scrollLeft as number) - HEADER;
    expect(pinned).toBeCloseTo(750, 5);
  });
  it('keeps pinning continuously — every subsequent frame scrolls by the same delta', () => {
    let s = 0;
    for (let tick = 1000; tick <= 1300; tick += 100) {
      const r = followScroll(view({ playheadTick: tick, scrollLeft: s }));
      s = r.scrollLeft ?? s;
    }
    const x = 300 + 1300;
    expect(x - s - HEADER).toBeCloseTo(750, 5); // still exactly at the trigger
  });
  it('the playhead never leaves the view while following', () => {
    let s = 0;
    for (let tick = 0; tick <= 5000; tick += 37) {
      const r = followScroll(view({ playheadTick: tick, scrollLeft: s }));
      s = r.scrollLeft ?? s;
      expect(playheadVisible({ playheadTick: tick, pxPerTick: 1, headerPx: HEADER, scrollLeft: s, clientWidth: CW })).toBe(true);
    }
  });
  it('a playhead that jumped backwards out of view (loop wrap / seek back) flags wrapBack and re-pins at the anchor, clamped at 0', () => {
    const v = view({ playheadTick: 100, scrollLeft: 3000 }); // x = 400 < viewL 3300
    const r = followScroll(v);
    expect(r.wrapBack).toBe(true);
    expect(r.scrollLeft).toBe(0); // 400 - 300 - 750 clamps to 0
  });
  it('a wrap-back within positive range re-pins exactly at the anchor', () => {
    const v = view({ playheadTick: 2000, scrollLeft: 3000 }); // x = 2300 < viewL
    const r = followScroll(v);
    expect(r.wrapBack).toBe(true);
    expect(300 + 2000 - (r.scrollLeft as number) - HEADER).toBeCloseTo(750, 5);
  });
});

describe('loop-fit rule (spec §7)', () => {
  it('a loop that fits on screen never scrolls — no page jumps on every cycle', () => {
    const loop = { startTick: 100, endTick: 700 }; // 600px < 1000px visible
    const v = view({ playheadTick: 1000, loop }); // past the trigger, but loop on screen
    expect(followScroll(v).scrollLeft).toBeNull();
  });
  it('a loop wider than the view uses the selected mode', () => {
    const loop = { startTick: 0, endTick: 5000 };
    const v = view({ playheadTick: 1200, loop, scrollLeft: 0 });
    expect(followScroll(v).scrollLeft).not.toBeNull();
  });
  it('a fitting loop that is scrolled out of view still follows (re-acquires the loop)', () => {
    const loop = { startTick: 5000, endTick: 5500 };
    const v = view({ playheadTick: 5100, loop, scrollLeft: 0 }); // playhead/loop far right of the view
    const r = followScroll(v);
    expect(r.scrollLeft).not.toBeNull();
  });
  it('loopFitsInView boundary: exactly the visible width fits', () => {
    const geom = { pxPerTick: 1, headerPx: HEADER, clientWidth: CW };
    expect(loopFitsInView({ startTick: 0, endTick: 1000 }, geom)).toBe(true);
    expect(loopFitsInView({ startTick: 0, endTick: 1001 }, geom)).toBe(false);
  });
});

describe('page follow', () => {
  it('stays stationary until the playhead exits the view', () => {
    expect(followScroll(view({ mode: 'page', playheadTick: 900 })).scrollLeft).toBeNull();
  });
  it('jumps exactly one full view when the playhead exits the right edge', () => {
    const r = followScroll(view({ mode: 'page', playheadTick: 1600, scrollLeft: 500 })); // x = 1900 > viewR 1800
    expect(r.scrollLeft).toBe(500 + 1000);
    expect(r.wrapBack).toBeFalsy();
  });
  it('a wrap-back snaps the playhead to the left edge', () => {
    const r = followScroll(view({ mode: 'page', playheadTick: 100, scrollLeft: 3000 }));
    expect(r.scrollLeft).toBe(400 - HEADER);
    expect(r.wrapBack).toBe(true);
  });
});

describe('centered follow', () => {
  it('pins the playhead at the center of the timeline area from the first frame', () => {
    const r = followScroll(view({ mode: 'centered', playheadTick: 1000 }));
    const s = r.scrollLeft as number;
    expect(300 + 1000 - s - HEADER).toBeCloseTo(500, 5); // centered in the 1000px timeline width
  });
  it('clamps at 0 near tick 0 instead of scrolling negative', () => {
    expect(followScroll(view({ mode: 'centered', playheadTick: 100 })).scrollLeft).toBe(0);
  });
});

describe('stationary playhead', () => {
  it('pins the playhead at the configured fraction and moves the timeline beneath', () => {
    const r = followScroll(view({ mode: 'stationary', playheadTick: 1000 }));
    expect(300 + 1000 - (r.scrollLeft as number) - HEADER).toBeCloseTo(750, 5);
  });
  it('clamps extreme trigger values into a sane range', () => {
    const r = followScroll(view({ mode: 'stationary', trigger: 5, playheadTick: 1000 }));
    expect(300 + 1000 - (r.scrollLeft as number) - HEADER).toBeCloseTo(950, 5); // 0.95 cap
  });
});

describe('off', () => {
  it('never scrolls, wherever the playhead is', () => {
    expect(followScroll(view({ mode: 'off', playheadTick: 90000 })).scrollLeft).toBeNull();
  });
});

describe('clamping and re-follow anchoring', () => {
  it('never scrolls before tick 0', () => {
    const r = followScroll(view({ mode: 'centered', playheadTick: 0 }));
    expect(r.scrollLeft).toBe(0);
  });
  it('refollow: smooth/centered/stationary pin at their anchors', () => {
    expect(300 + 1000 - refollowScrollLeft(view({ playheadTick: 1000 })) - HEADER).toBeCloseTo(750, 5);
    expect(300 + 1000 - refollowScrollLeft(view({ mode: 'centered', playheadTick: 1000 })) - HEADER).toBeCloseTo(500, 5);
  });
  it('refollow: page puts the playhead at the left edge; off leaves the view alone', () => {
    expect(refollowScrollLeft(view({ mode: 'page', playheadTick: 1000 }))).toBe(1000);
    expect(refollowScrollLeft(view({ mode: 'off', playheadTick: 1000, scrollLeft: 321 }))).toBe(321);
  });
});

describe('catch-up after a manual scroll ends (spec §5 resume-after-scroll)', () => {
  it('smooth: playhead past the trigger → chase the pin position', () => {
    // The user scrolled backwards; the playhead is 250px past the anchor.
    const v = view({ playheadTick: 1300 }); // x = 1600 > anchor 300 + 750 + 0 = 1050
    const target = catchUpScrollLeft(v);
    expect(target).not.toBeNull();
    expect(300 + 1300 - (target as number) - HEADER).toBeCloseTo(750, 5);
  });
  it('smooth: playhead left of the trigger → hold the view, no backward yank', () => {
    expect(catchUpScrollLeft(view({ playheadTick: 400 }))).toBeNull();
  });
  it('smooth: playhead scrolled off the LEFT edge → hold; the view waits for it to re-cross', () => {
    // The user scrolled ahead of the playhead — chasing would drag the view backwards.
    expect(catchUpScrollLeft(view({ playheadTick: 100, scrollLeft: 3000 }))).toBeNull();
  });
  it('smooth: playhead off the RIGHT edge → chase it back into view', () => {
    expect(catchUpScrollLeft(view({ playheadTick: 5000 }))).not.toBeNull();
  });
  it('centered/stationary always chase their pin — the mode promises the pin, any direction', () => {
    expect(catchUpScrollLeft(view({ mode: 'centered', playheadTick: 200, scrollLeft: 3000 }))).not.toBeNull();
    expect(catchUpScrollLeft(view({ mode: 'stationary', playheadTick: 5000 }))).not.toBeNull();
  });
  it('page: playhead visible → hold; off the right edge → chase to the left-edge pin', () => {
    expect(catchUpScrollLeft(view({ mode: 'page', playheadTick: 900 }))).toBeNull();
    const target = catchUpScrollLeft(view({ mode: 'page', playheadTick: 2500, scrollLeft: 500 })); // x = 2800 > viewR 1800
    expect(target).toBe(refollowScrollLeft(view({ mode: 'page', playheadTick: 2500, scrollLeft: 500 })));
  });
  it('a fitting loop that is on screen never chases (loop-fit rule §7)', () => {
    const loop = { startTick: 100, endTick: 700 };
    expect(catchUpScrollLeft(view({ playheadTick: 1000, loop }))).toBeNull();
  });
  it('a fitting loop scrolled out of view still re-acquires the playhead', () => {
    const loop = { startTick: 5000, endTick: 5500 };
    expect(catchUpScrollLeft(view({ playheadTick: 5100, loop, scrollLeft: 0 }))).not.toBeNull();
  });
  it('off never chases', () => {
    expect(catchUpScrollLeft(view({ mode: 'off', playheadTick: 90000 }))).toBeNull();
  });
  it('chasing a moving playhead tracks it with a small bounded lag (damped follow, no jump)', () => {
    // While the playhead keeps advancing the exponential chase never fully
    // "done"s — it settles into tracking the moving pin with a small
    // constant lag, which is visually indistinguishable from pinning.
    const advance = 6; // px per simulated frame (≈ 384 px/s at 60fps)
    let cur = catchUpScrollLeft(view({ playheadTick: 1300 })) as number;
    let tick = 1300;
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      tick += advance;
      const target = catchUpScrollLeft(view({ playheadTick: tick, scrollLeft: cur }));
      if (target === null) break;
      const stp = chaseStep(cur, target, 1 / 60);
      cur = stp.next;
      worst = Math.max(worst, Math.abs(target - cur));
    }
    expect(worst).toBeLessThan(40); // steady-state lag stays small…
    const res = followScroll(view({ playheadTick: tick, scrollLeft: cur }));
    // …and the handover to the policy costs at most a couple of frames.
    if (res.scrollLeft !== null) expect(Math.abs(res.scrollLeft - cur)).toBeLessThanOrEqual(advance * 6);
  });
});

describe('catch-up glide step', () => {
  it('converges exponentially and finishes exactly on the target', () => {
    let cur = 0;
    let frames = 0;
    while (frames < 600) {
      const stp = chaseStep(cur, 800, 1 / 60);
      cur = stp.next;
      frames++;
      if (stp.done) break;
    }
    expect(cur).toBe(800);
    expect(frames).toBeLessThan(120); // 800px in well under two seconds
  });
  it('chases a moving target monotonically, never overshooting', () => {
    let cur = 0;
    for (let i = 0; i < 120; i++) {
      const target = 500 + i * 10; // the pin moves forward with the playhead
      const stp = chaseStep(cur, target, 1 / 60);
      expect(stp.next).toBeGreaterThanOrEqual(cur);
      expect(stp.next).toBeLessThanOrEqual(target);
      cur = stp.next;
    }
  });
  it('a sub-pixel distance snaps exactly onto the target', () => {
    expect(chaseStep(799.7, 800, 1 / 60)).toEqual({ next: 800, done: true });
    expect(chaseStep(800.4, 800, 1 / 60)).toEqual({ next: 800, done: true });
  });
  it('a large gap glides smoothly — the first step is a small fraction, not a jump', () => {
    const stp = chaseStep(0, 5000, 1 / 60);
    expect(stp.done).toBe(false);
    expect(stp.next).toBeGreaterThan(0);
    expect(stp.next).toBeLessThan(5000 * 0.35); // ~18% per frame at 60fps
  });
  it('the resume idle window is half a second', () => {
    expect(FOLLOW_RESUME_IDLE_MS).toBe(500);
  });
});
