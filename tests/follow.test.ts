import { describe, expect, it } from 'vitest';
import { followScroll, loopFitsInView, playheadVisible, refollowScrollLeft, timelineWidth, type FollowView } from '../src/engine/transport/follow';

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
