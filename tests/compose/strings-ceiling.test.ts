/**
 * Guards the voice-ceiling fix carried in
 * `patches/0001-strings-voice-ceiling.patch` (report §8.11).
 *
 * These tests target the primitives directly rather than the composed output,
 * because the composed output can mask the bug: a ceiling that is silently
 * widened only shows up when an inner voice happens to land in the widened
 * gap. Here the ceiling is exercised across every pitch class, slot and
 * ceiling value, so the invariant is checked exhaustively.
 *
 * All three tests FAIL on the pre-patch code, which is what makes them worth
 * keeping: the old bound was `Math.max(winLow + 11, min(winHigh, ceiling))`,
 * and with a requested ceiling of 52 it could place a note at 61.
 */
import { describe, expect, it } from 'vitest';
import type { RegisterBand } from '../../src/compose/ir';
import { pitchForPitchClass, avoidLeadCollision } from '../../src/compose/families/strings';

// A synthetic band with a wide comfortable window, so the ceiling is what binds.
const band: RegisterBand = { low: 40, high: 96, comfortable: [48, 84], centroid: 66 };
const valid = (p: number) => Number.isFinite(p);

describe('hard ceiling', () => {
  it('never places a pitch above the requested ceiling, across tight windows', () => {
    let above = 0, checked = 0;
    for (let ceiling = 50; ceiling <= 84; ceiling++) {
      for (let pc = 0; pc < 12; pc++) {
        for (let slot = 0; slot < 4; slot++) {
          const p = pitchForPitchClass(pc, band, slot, null, null, ceiling);
          checked++;
          if (!valid(p) || p > ceiling) above++;
        }
      }
    }
    console.log(`pitchForPitchClass: ${above}/${checked} placements above ceiling or non-finite`);
    expect(checked).toBeGreaterThan(1000);
    expect(above).toBe(0);
  });

  it('the nudge cannot lift a note back above the ceiling', () => {
    let above = 0, nudged = 0;
    for (let ceiling = 50; ceiling <= 72; ceiling++) {
      for (let pc = 0; pc < 12; pc++) {
        for (let leadPitch = 60; leadPitch <= 84; leadPitch += 2) {
          const leadPcs = new Set([((leadPitch % 12) + 12) % 12]);
          const chord = [0, 4, 7, 11];
          const p = avoidLeadCollision(pc, chord, leadPcs, band, leadPitch, ceiling);
          nudged++;
          if (!valid(p) || p > ceiling) above++;
        }
      }
    }
    console.log(`avoidLeadCollision: ${above}/${nudged} nudges above ceiling or non-finite`);
    expect(nudged).toBeGreaterThan(1000);
    expect(above).toBe(0);
  });

  it('regression guard: a tight ceiling must NOT be widened to a full octave', () => {
    // The old code did Math.max(winLow + 11, min(winHigh, ceiling)).
    // With winLow=48 and ceiling=52 the old bound became 59; the hard one is 52.
    let worst = -Infinity;
    for (let pc = 0; pc < 12; pc++) {
      const p = pitchForPitchClass(pc, band, 1, null, null, 52);
      if (!valid(p)) { worst = NaN; }
      worst = Number.isNaN(worst) ? worst : Math.max(worst, p);
    }
    console.log(`tight-ceiling worst pitch: ${worst} (must be <= 52, old code reached 59)`);
    expect(Number.isFinite(worst)).toBe(true);
    expect(worst).toBeLessThanOrEqual(52);
  });
});
