/**
 * Harmonic rhythm planning (Phase 4) — WHEN chords change, before WHICH
 * chords are chosen (spec §5).
 *
 * The planner partitions a generation target into exact, gapless, positively
 * sized chord slots. Slot lengths EMERGE from the section's Phase 2 rhythm
 * preference (preferred changes per bar, flexibility, shape), the project's
 * real meter (never a hardcoded bar length — 3/4 and 6/8 work through the
 * shared meter utilities, compound meters through their FELT beats) and
 * seeded variation. A four-bar passage may become one chord per bar, two
 * half-bar chords, a sustained bar plus two half-bar chords — timing only,
 * never chord content.
 *
 * Slots are planned per phrase window and never cross a window boundary: the
 * last slot of a phrase carries its arrival (spec §8), and deliberate
 * sustain-across-a-boundary is a later, intention-driven decision (see
 * progression.ts), not an accident of the grid.
 *
 * Grid: slots snap to multiples of the notated pulse (the time-signature
 * denominator unit at 960 PPQ), which keeps bar/half-bar/beat positions in
 * any meter; window edges themselves may sit off-grid (gaps can begin where
 * a user chord ends), in which case the edge slots absorb the offset exactly.
 * All arithmetic is integer ticks; zero-length and negative durations are
 * impossible by construction, and targets are covered exactly.
 *
 * Deterministic: identical inputs (span, windows, meter, preferences, rng
 * state) always produce identical slot lists. No async, no dependencies.
 */
import { barTicks, beatTicks, isCompound, pulseTicks } from '../../shared/schema/meter';
import type { TimeSignature } from '../../shared/schema/types';
import { applyVariation, pickWeighted } from './planning';
import type { RhythmShape } from './types';

/** One chord slot: an interval exactly one generated chord event will occupy. */
export interface RhythmSlot {
  startTick: number;
  durationTicks: number;
  /** Index of the phrase window this slot belongs to. */
  windowIndex: number;
  /** True for the last slot of its window — the phrase's arrival point. */
  phraseEnd: boolean;
}

/** Meter facts + rhythm preference carried per window by the orchestrator. */
export interface RhythmWindowInput {
  startTick: number;
  endTick: number;
  /** Preferred changes per bar (Phase 2 profile, contour-adjusted). */
  changesPerBar: number;
  shape: RhythmShape;
}

export interface MeterFacts {
  timeSignature: TimeSignature;
  barTicksValue: number;
  pulseTicksValue: number;
  beatTicksValue: number;
  beatsPerBar: number;
  compound: boolean;
}

export function meterFacts(ts: TimeSignature): MeterFacts {
  return {
    timeSignature: { ...ts },
    barTicksValue: barTicks(ts),
    pulseTicksValue: pulseTicks(ts),
    beatTicksValue: beatTicks(ts),
    beatsPerBar: isCompound(ts) ? Math.round(barTicks(ts) / beatTicks(ts)) : ts.numerator,
    compound: isCompound(ts),
  };
}

/** Slot lengths the planner may use, in notated pulses. One pulse is the
 *  denominator unit; longer multiples cover beats, bars and multi-bar holds
 *  in every supported meter. */
const SLOT_PULSES = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48] as const;

/** Nearest allowed pulse length to a desired (possibly fractional) one. */
function snapPulses(desired: number): number {
  let best: number = SLOT_PULSES[0];
  let bestDist = Infinity;
  for (const p of SLOT_PULSES) {
    const d = Math.abs(p - desired);
    if (d < bestDist) { best = p; bestDist = d; }
  }
  return best;
}

interface WindowSlots { windowIndex: number; lengths: number[] } // lengths in ticks

/**
 * Plan slot lengths (in ticks) for one window: exact-fit, shape-aware,
 * seeded. Greedy fill from the allowed pulse grid; the last slot absorbs the
 * remainder so the window is covered exactly.
 */
function planWindowSlots(
  window: RhythmWindowInput,
  windowIndex: number,
  meter: MeterFacts,
  rng: () => number,
  variation: number,
): WindowSlots {
  const span = window.endTick - window.startTick;
  if (span <= 0) return { windowIndex, lengths: [] };
  const pulse = Math.max(1, meter.pulseTicksValue);

  // Shorter than one pulse (or a non-positive preference): a single exact slot.
  const cpb = Math.min(4, Math.max(0.25, window.changesPerBar));
  if (span < pulse) return { windowIndex, lengths: [span] };

  // Desired slot length from the preferred changes-per-bar, on the pulse grid.
  const barPulses = meter.barTicksValue / pulse;
  const desiredPulses = Math.max(1, barPulses / cpb);
  const basePulses = snapPulses(desiredPulses);
  const baseTicks = basePulses * pulse;

  let lengths: number[] = [];
  const uniform = (): number[] => {
    const n = Math.max(1, Math.round(span / baseTicks));
    return Array.from({ length: n }, () => baseTicks);
  };

  switch (window.shape) {
    case 'hold': {
      // Fewer, longer slots; one seeded extension produces a multi-bar sustain.
      lengths = uniform();
      if (lengths.length >= 2 && rng() < 0.3 + 0.2 * (1 - variation)) {
        // Merge a random adjacent pair into a sustained slot.
        const i = Math.floor(rng() * (lengths.length - 1));
        lengths = lengths.filter((_, j) => j !== i + 1);
      }
      break;
    }
    case 'regular':
    case 'periodic':
      lengths = uniform();
      break;
    case 'mixed': {
      // Greedy: each slot picks among half/base/double with seeded weights.
      const options: Array<readonly [string, number]> = [
        [`p${Math.max(1, Math.round(basePulses / 2))}`, 0.25],
        [`p${basePulses}`, 0.5],
        [`p${Math.min(48, basePulses * 2)}`, 0.25],
      ];
      const weighted = applyVariation(options, variation);
      let remaining = span;
      const out: number[] = [];
      let guard = 0;
      while (remaining >= pulse && guard++ < 256) {
        const remainingPulses = remaining / pulse;
        const pickKey = pickWeighted(weighted, rng);
        const pick = Number(pickKey.slice(1));
        const choicePulses = Math.min(pick, Math.floor(remainingPulses));
        // Keep the final remainder large enough to be its own slot.
        const afterMin = remainingPulses - choicePulses;
        const chosen = afterMin > 0 && afterMin < 1 ? Math.max(1, choicePulses - 1) : choicePulses;
        const ticks = Math.min(remaining, chosen * pulse);
        out.push(ticks);
        remaining -= ticks;
      }
      lengths = out.length ? out : [span];
      break;
    }
    case 'accelerating':
    case 'decelerating': {
      // Geometric ramp from double to half the base length (or reverse),
      // normalized to fit the window exactly.
      const accel = window.shape === 'accelerating';
      const maxN = Math.max(1, Math.floor(span / Math.max(pulse, Math.round(pulse * Math.min(basePulses, 2) * 0.5))));
      const n = Math.max(1, Math.min(maxN, Math.round(span / baseTicks)));
      const startPulses = Math.min(48, basePulses * 2);
      const endPulses = Math.max(1, Math.round(basePulses * 0.5));
      const raw: number[] = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1);
        const p = accel ? startPulses + (endPulses - startPulses) * t : endPulses + (startPulses - endPulses) * t;
        raw.push(p * pulse);
      }
      const sum = raw.reduce((s, v) => s + v, 0);
      const scale = span / sum;
      lengths = raw.map((v) => Math.max(pulse, Math.round(v * scale)));
      break;
    }
  }

  // Exact fit: distribute the rounding remainder, keep every slot positive.
  const total = lengths.reduce((s, v) => s + v, 0);
  let diff = span - total;
  const min = Math.max(1, Math.floor(pulse / 2));
  for (let i = 0; diff !== 0 && lengths.length > 0; i = (i + 1) % lengths.length) {
    const step = Math.sign(diff);
    if (lengths[i] + step < min) { if (i === lengths.length - 1) break; continue; }
    lengths[i] += step;
    diff -= step;
  }
  if (diff > 0) lengths[lengths.length - 1] += diff;
  // Merge any slot that rounding pushed below the minimum into its neighbor.
  for (let i = lengths.length - 1; i >= 0; i--) {
    if (lengths[i] >= 1) continue;
    if (i > 0) { lengths[i - 1] += lengths[i]; lengths.splice(i, 1); }
    else if (lengths.length > 1) { lengths[1] += lengths[0]; lengths.splice(0, 1); }
    else lengths[0] = Math.max(1, lengths[0]);
  }
  return { windowIndex, lengths };
}

/**
 * Plan the chord slots of one generation target. Windows must be sorted by
 * startTick, lie inside the target and tile it (the orchestrator guarantees
 * this — see generation.ts `windowsForTarget`). The output covers the target
 * exactly: first slot starts at target start, last slot ends at target end,
 * no gaps, no overlaps, all durations ≥ 1 tick.
 */
export function planRhythmSlots(
  target: { startTick: number; endTick: number },
  windows: RhythmWindowInput[],
  meter: MeterFacts,
  rng: () => number,
  variation: number,
): RhythmSlot[] {
  const slots: RhythmSlot[] = [];
  let cursor = target.startTick;
  windows.forEach((w, wi) => {
    const planned = planWindowSlots({ ...w, startTick: cursor, endTick: w.endTick }, wi, meter, rng, variation);
    planned.lengths.forEach((len, li) => {
      slots.push({
        startTick: cursor,
        durationTicks: len,
        windowIndex: wi,
        phraseEnd: li === planned.lengths.length - 1,
      });
      cursor += len;
    });
  });
  // Defensive exact-fit fix-up: windows were computed from clipped phrase
  // spans, so rounding drift cannot occur; guard against it regardless.
  if (cursor !== target.endTick && slots.length > 0) {
    const last = slots[slots.length - 1];
    const adjusted = target.endTick - last.startTick;
    if (adjusted >= 1) last.durationTicks = adjusted;
  }
  return slots;
}
