import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { chordSpans } from '../src/engine/generate';
import { projectFromFixture, type Project } from '../src/shared/schema';

const fx = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));

describe('chordSpans — the Chords lane as ordered, non-overlapping parsed spans', () => {
  it('reads the dorian fixture: ordered, non-overlapping, half-bars and slash chords intact', () => {
    const p = fx();
    const spans = chordSpans(p);
    expect(spans.length).toBe(p.chords.length);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].startTick).toBeGreaterThanOrEqual(spans[i - 1].endTick);
    }
    // half-bar pair in bar 4: Em7 at 11520 spans 1920 ticks, Fmaj7 follows at 13440
    const em7 = spans.find((s) => s.startTick === 11520)!;
    expect(em7.parsed.rootName).toBe('E');
    expect(em7.endTick - em7.startTick).toBe(1920);
    expect(spans.some((s) => s.startTick === 13440 && s.parsed.rootName === 'F')).toBe(true);
    // slash chords carry their bass: C/E and G/B
    const cOverE = spans.find((s) => s.parsed.rootName === 'C' && s.parsed.bassName === 'E')!;
    expect(cOverE).toBeDefined();
    const gOverB = spans.find((s) => s.parsed.rootName === 'G' && s.parsed.bassName === 'B')!;
    expect(gOverB).toBeDefined();
    // every span is parsed, never raw
    for (const s of spans) expect(s.parsed.pitchClasses.length).toBeGreaterThan(0);
  });

  it('an overlapping paste cuts the earlier span (latest start wins, never extends)', () => {
    const p = fx();
    p.chords.push({ id: 'cx', symbol: 'Bb', startTick: 2000, durationTicks: 6000 }); // lands inside Dm7 [0, 3840)
    const spans = chordSpans(p);
    const first = spans[0];
    expect(first.parsed.rootName).toBe('D');
    expect(first.endTick).toBe(2000); // cut at the intruder's start
    const intruder = spans.find((s) => s.id === 'cx')!;
    expect(intruder.startTick).toBe(2000);
    expect(intruder.endTick).toBe(3840); // the intruder is itself cut by the fixture's G7 at 3840 — latest start wins pairwise
    const g7 = spans.find((s) => s.id === 'c02')!;
    expect(g7.startTick).toBe(3840);
    expect(g7.endTick).toBe(7680); // untouched
    for (let i = 1; i < spans.length; i++) expect(spans[i].startTick).toBeGreaterThanOrEqual(spans[i - 1].endTick);
  });

  it('a gap between chords stays a gap (a later start never stretches the earlier span)', () => {
    const p = fx();
    p.chords = [
      { id: 'a', symbol: 'F', startTick: 0, durationTicks: 480 },
      { id: 'b', symbol: 'G', startTick: 960, durationTicks: 960 },
    ];
    const spans = chordSpans(p);
    expect(spans.map((s) => [s.startTick, s.endTick])).toEqual([[0, 480], [960, 1920]]);
  });

  it('two chords on the same start: the later one in input order wins', () => {
    const p = fx();
    p.chords.push({ id: 'dup1', symbol: 'G7', startTick: 3840, durationTicks: 3840 }); // same slot as fixture c02
    const spans = chordSpans(p);
    const at3840 = spans.filter((s) => s.startTick === 3840);
    expect(at3840.length).toBe(1);
    expect(at3840[0].id).toBe('dup1');
    expect(at3840[0].endTick).toBe(7680);
  });

  it('unparseable symbols are skipped without disturbing their neighbours', () => {
    const p = fx();
    const before = chordSpans(p);
    p.chords.push({ id: 'bad1', symbol: 'H#7', startTick: 1000, durationTicks: 500 });
    p.chords.push({ id: 'bad2', symbol: 'probably not a chord', startTick: 20000, durationTicks: 500 });
    const after = chordSpans(p);
    expect(after).toEqual(before);
    expect(after.find((s) => s.id === 'bad1')).toBeUndefined();
    expect(after.find((s) => s.id === 'bad2')).toBeUndefined();
  });

  it('zero and negative durations are dropped', () => {
    const p = fx();
    p.chords.push({ id: 'z', symbol: 'C', startTick: 500, durationTicks: 0 });
    p.chords.push({ id: 'n', symbol: 'D', startTick: 600, durationTicks: -5 });
    const spans = chordSpans(p);
    expect(spans.find((s) => s.id === 'z')).toBeUndefined();
    expect(spans.find((s) => s.id === 'n')).toBeUndefined();
  });

  it('a negative start clamps to 0', () => {
    const p = fx();
    p.chords = [
      { id: 'neg', symbol: 'F', startTick: -480, durationTicks: 960 },
      { id: 'a', symbol: 'G', startTick: 960, durationTicks: 960 },
    ];
    const spans = chordSpans(p);
    expect(spans[0].id).toBe('neg');
    expect(spans[0].startTick).toBe(0);
    expect(spans[0].endTick).toBe(960); // clamped start, duration kept
  });

  it('an out-of-order lane reads identically to the sorted one', () => {
    const p = fx();
    const expected = chordSpans(p);
    p.chords.reverse();
    expect(chordSpans(p)).toEqual(expected);
  });

  it('an empty or fully unparseable lane yields []', () => {
    const p = fx();
    p.chords = [];
    expect(chordSpans(p)).toEqual([]);
    p.chords = [{ id: 'x', symbol: 'nope', startTick: 0, durationTicks: 960 }];
    expect(chordSpans(p)).toEqual([]);
  });
});
