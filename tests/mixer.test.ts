import { describe, expect, it } from 'vitest';
import { legendStops } from '../src/components/ui';

describe('mixer fader legends', () => {
  it('spreads label stops evenly from 0% (top) to 100% (bottom)', () => {
    expect(legendStops(5)).toEqual([0, 25, 50, 75, 100]);
    expect(legendStops(6)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('always anchors the first and last label at the track extremes', () => {
    for (const n of [2, 3, 5, 6, 8]) {
      const stops = legendStops(n);
      expect(stops[0]).toBe(0);
      expect(stops[stops.length - 1]).toBe(100);
      for (let i = 1; i < stops.length; i++) expect(stops[i]).toBeGreaterThan(stops[i - 1]);
    }
  });
});
