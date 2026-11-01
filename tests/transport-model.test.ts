import { describe, expect, it } from 'vitest';
import { beginPlay, clampSeekTick, parkPause, parkStop, secondStop, type TransportSnapshot } from '../src/engine/transport/model';

const snap = (over: Partial<TransportSnapshot>): TransportSnapshot => ({
  playing: false, paused: false, startTick: 0, lastPlaybackStartPosition: 0, stoppedPosition: 0, ...over,
});
const PREFS_OFF = { returnToStartOnStop: false, secondStopReturnsToStart: false };
const PREFS_RETURN = { returnToStartOnStop: true, secondStopReturnsToStart: false };
const PREFS_SECOND = { returnToStartOnStop: false, secondStopReturnsToStart: true };

describe('starting playback (spec §2)', () => {
  it('a fresh start records the position as lastPlaybackStartPosition', () => {
    const d = beginPlay(snap({ startTick: 2880 })); // bar 3 at 960 PPQ, 4/4
    expect(d.fromTick).toBe(2880);
    expect(d.lastPlaybackStartPosition).toBe(2880);
    expect(d.resumedFromPause).toBe(false);
  });
  it('starting from bar 3 does not touch anything else (no clip/selection/zoom concept here)', () => {
    const d = beginPlay(snap({ startTick: 2880 }));
    expect(Object.keys(d).sort()).toEqual(['fromTick', 'lastPlaybackStartPosition', 'resumedFromPause']);
  });
});

describe('pause (spec §3)', () => {
  it('freezes the playhead at the exact live position', () => {
    const d = parkPause(1234.6);
    expect(d.startTick).toBe(1235); // rounded to the tick
    expect(d.stoppedPosition).toBe(1235);
    expect(d.paused).toBe(true);
    expect(d.playing).toBe(false);
  });
  it('resuming after pause starts from the frozen position and keeps lastPlaybackStartPosition', () => {
    const st = snap({ paused: true, startTick: 1235, lastPlaybackStartPosition: 960 });
    const d = beginPlay(st);
    expect(d.fromTick).toBe(1235);
    expect(d.lastPlaybackStartPosition).toBe(960); // unchanged by Pause
    expect(d.resumedFromPause).toBe(true);
  });
});

describe('stop (spec §3)', () => {
  it('default: parks where it stopped — no automatic return', () => {
    const st = snap({ playing: true, startTick: 0, lastPlaybackStartPosition: 2880 });
    const d = parkStop(st, 5678.9, PREFS_OFF);
    expect(d.startTick).toBe(5679);
    expect(d.stoppedPosition).toBe(5679);
    expect(d.paused).toBe(false);
  });
  it('"Return to start position on stop" returns to lastPlaybackStartPosition', () => {
    const st = snap({ playing: true, startTick: 0, lastPlaybackStartPosition: 2880 });
    const d = parkStop(st, 5678.9, PREFS_RETURN);
    expect(d.startTick).toBe(2880);
    expect(d.stoppedPosition).toBe(5679); // where it actually stopped is still recorded
  });
  it('stopping from pause parks at the paused position', () => {
    const st = snap({ paused: true, startTick: 1235, lastPlaybackStartPosition: 0 });
    const d = parkStop(st, null, PREFS_OFF);
    expect(d.startTick).toBe(1235);
    expect(d.stoppedPosition).toBe(1235);
  });
});

describe('second stop (spec §3)', () => {
  it('default: a repeated Stop has no additional effect', () => {
    const st = snap({ startTick: 5679, lastPlaybackStartPosition: 2880 });
    expect(secondStop(st, PREFS_OFF)).toBeNull();
    expect(secondStop(st, PREFS_RETURN)).toBeNull();
  });
  it('with the preference, a second Stop returns to the playback start', () => {
    const st = snap({ startTick: 5679, lastPlaybackStartPosition: 2880 });
    expect(secondStop(st, PREFS_SECOND)).toBe(2880);
  });
  it('with the preference, a second Stop is a no-op when already at the start', () => {
    const st = snap({ startTick: 2880, lastPlaybackStartPosition: 2880 });
    expect(secondStop(st, PREFS_SECOND)).toBeNull();
  });
});

describe('seek clamping (spec §8, §17)', () => {
  const END = 4 * 4 * 960; // 4 bars of 4/4
  it('clamps clicks beyond the project end to the project end', () => {
    expect(clampSeekTick(END + 5000, END)).toBe(END);
  });
  it('clamps negatives to bar 0', () => {
    expect(clampSeekTick(-42, END)).toBe(0);
  });
  it('passes valid positions through, rounded', () => {
    expect(clampSeekTick(96.4, END)).toBe(96);
    expect(clampSeekTick(2880, END)).toBe(2880);
  });
  it('NaN and Infinity are safe', () => {
    expect(clampSeekTick(NaN, END)).toBe(0);
    expect(clampSeekTick(Infinity, END)).toBe(END);
  });
});
