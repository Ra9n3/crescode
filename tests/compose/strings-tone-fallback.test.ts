/**
 * Guards the chord-tone fallback in `pitchForPitchClass` and the moment-local
 * lead test in `avoidLeadCollision`.
 *
 * Both defects were found while chasing residual octave doublings. Neither one
 * was itself the doubling: they were the reason the doubling code could not
 * work. `pitchForPitchClass` ended in `return anywhere ?? target`, where
 * `target` is the arithmetic midpoint of the voice's slot band. When the
 * requested pitch class had no representative inside a SHORTENED window — an
 * inner voice clamped under a low lead can leave as little as seven semitones —
 * the function returned that midpoint, whose pitch class is arbitrary.
 *
 * That silently defeated every downstream test: `avoidLeadCollision` and the
 * occupancy check filter candidates by the REQUESTED tone, but the emitted note
 * sang a different class. Measured on dorian seed 3, chamber template: the
 * caller asked for pc 0 under C/E and the part received pitch 67 (pc 7), the
 * exact class the bass was already holding. The first test below is that case.
 *
 * The second test covers the over-broad veto. `leadPitchClasses` is the union
 * of every class the lead plays anywhere in the piece — up to seven of twelve.
 * Used as a per-moment exclusion it can ban the only non-doubling chord tone in
 * a short window, leaving the search with nothing and keeping the doubled
 * pitch. When a lead pitch is genuinely sounding, only that one class is off
 * limits.
 *
 * These tests FAIL on the pre-patch code.
 */
import { describe, expect, it } from 'vitest';
import type { RegisterBand } from '../../src/compose/ir';
import { avoidLeadCollision, pitchForPitchClass } from '../../src/compose/families/strings';

const pcOf = (pitch: number) => ((pitch % 12) + 12) % 12;

// The real violins2 band. `comfyWindowOf` trims this to 63..80; the ceiling in
// the failing case was 69, so only seven semitones were reachable and pc 0 —
// which lives at 60 and 72 — had no representative at all.
const band: RegisterBand = { low: 55, high: 96, comfortable: [61, 83], centroid: 72 };

describe('pitchForPitchClass chord-tone fallback', () => {
  it('never leaves the chord when the requested class cannot sound', () => {
    // pc 0 with a ceiling of 69 has no representative — 60 and 72 are both
    // outside 63..69 — so no placement can honour the request. What matters is
    // that the substitute stays inside the harmony. The old code returned 67,
    // the slot-band midpoint, which happened to be pc 7 here but is an
    // arithmetic accident: across other windows and slots it lands anywhere.
    const chord = [0, 4, 7];
    const chordPcs = chord.map((cls) => pcOf(cls));
    let exercised = 0;
    for (let slot = 0; slot < 4; slot++) {
      for (let ceiling = 63; ceiling <= 80; ceiling++) {
        // A degenerate window (a ceiling of 63 leaves the single pitch 63) can
        // hold no chord tone at all. The ceiling is the HARD rule — it may never
        // be raised to buy harmony — so only windows that can hold a chord tone
        // are asserted here; the degenerate case is covered separately below.
        const reachable = [];
        for (let pitch = 63; pitch <= Math.min(80, ceiling); pitch++) reachable.push(pcOf(pitch));
        if (!reachable.some((cls) => chordPcs.includes(cls))) continue;
        exercised++;
        const placed = pitchForPitchClass(0, band, slot, null, null, ceiling, chord);
        expect(chordPcs).toContain(pcOf(placed));
      }
    }
    expect(exercised).toBeGreaterThan(0);
  });

  it('keeps the hard ceiling even when that leaves no chord tone', () => {
    // 63..63 holds only pitch 63 (pc 3), which is outside C major triad. The
    // ceiling wins: an out-of-chord note is better than an inner voice rising
    // above the lead, which is the rule the ceiling exists to protect.
    const placed = pitchForPitchClass(0, band, 1, null, null, 63, [0, 4, 7]);
    expect(placed).toBeLessThanOrEqual(63);
    expect(placed).toBeGreaterThanOrEqual(63);
  });

  it('substitutes a chord tone rather than an arbitrary slot-centre pitch', () => {
    // C/E inside a 63..69 window holds only E(64) and G(67); pc 0 cannot sound.
    const placed = pitchForPitchClass(0, band, 1, null, null, 69, [0, 4, 7]);
    expect([4, 7]).toContain(pcOf(placed));
    expect(placed).toBeGreaterThanOrEqual(63);
    expect(placed).toBeLessThanOrEqual(69);
  });

  it('prefers a substitute the caller has not vetoed', () => {
    // G is the occupied class, so E must win even though G sits nearer the slot
    // centre. Without the penalty the substitute swaps one doubling for another.
    const placed = pitchForPitchClass(0, band, 1, null, null, 69, [0, 4, 7], new Set([7]));
    expect(pcOf(placed)).toBe(4);
  });

  it('still honours the hard ceiling when substituting', () => {
    for (let ceiling = 60; ceiling <= 84; ceiling++) {
      for (let pc = 0; pc < 12; pc++) {
        const placed = pitchForPitchClass(pc, band, 1, null, null, ceiling, [0, 4, 7]);
        expect(Number.isFinite(placed)).toBe(true);
        expect(placed).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});

describe('avoidLeadCollision moment-local lead test', () => {
  it('does not veto a class the lead only plays elsewhere in the piece', () => {
    // The lead visits every class except E somewhere in the piece. At this
    // instant it is sounding A (pc 9). E (64) is therefore legal harmony and
    // must be reachable; the old piece-wide veto banned it and gave up.
    // This is the real measured set for dorian seed 3: the lead visits every
    // class of the mode. It contains both B (4) and G (7) — the only two chord
    // tones inside 63..69 — so the old veto rejected every candidate, the
    // search found nothing, and it returned the doubled 67 unchanged. The lead
    // is sounding F (pc 6) at this instant, which is neither chord tone.
    const pieceWide = new Set([2, 4, 5, 7, 9, 11, 0]);
    const placed = avoidLeadCollision(
      67, [0, 4, 7], pieceWide, band, 66, 69, new Set([7]),
    );
    expect(pcOf(placed)).toBe(4);
  });

  it('still rejects an octave against the sounding lead', () => {
    const placed = avoidLeadCollision(72, [0, 4, 7], new Set<number>(), band, 69, 69);
    expect(Math.abs(placed - 69) % 12).not.toBe(0);
  });
});
