/**
 * Dynamics: a crescendo through the first half of each phrase and a decrescendo
 * through the second, written to CC11 (expression) and CC1 (modulation) at
 * eighth-note resolution, plus a swell on every note of two beats or longer.
 *
 * Phrase-level shape rather than per-note randomness is what makes a line sound
 * phrased instead of merely played.
 */
import type { CcLane, CcPoint } from '../../shared/schema/types';
import type { PlacedNote } from './arrange';
import type { FormSectionPlan } from './form';

export interface DynamicsContext {
  readonly sections: readonly FormSectionPlan[];
  readonly notes: readonly PlacedNote[];
  readonly beatTicks: number;
  readonly barTicks: number;
  readonly totalBars: number;
}

const clamp = (value: number): number => Math.max(0, Math.min(127, Math.round(value)));

export function buildDynamics(context: DynamicsContext): CcLane[] {
  const { sections, notes, beatTicks, barTicks, totalBars } = context;
  if (!notes.length) return [];
  const endTick = totalBars * barTicks;
  const expression: CcPoint[] = [];
  const modulation: CcPoint[] = [];

  const energyAtBar = (bar: number): number => {
    for (const section of sections) {
      if (bar >= section.startBar && bar < section.startBar + section.bars) return section.energy;
    }
    return sections[sections.length - 1]?.energy ?? 0.5;
  };

  // One arch per PHRASE (4 bars), not one ramp across the piece.
  const step = Math.round(beatTicks / 2);
  const phraseBars = 4;
  for (let phraseStart = 0; phraseStart < totalBars; phraseStart += phraseBars) {
    const phraseEnd = Math.min(totalBars, phraseStart + phraseBars);
    const base = 40 + energyAtBar(phraseStart + 1) * 70;
    const startTick = phraseStart * barTicks;
    const endTickOfPhrase = phraseEnd * barTicks;
    const midTick = (startTick + endTickOfPhrase) / 2;
    for (let tick = startTick; tick <= endTickOfPhrase; tick += step) {
      const t = tick <= midTick
        ? (tick - startTick) / Math.max(1, midTick - startTick)
        : 1 - (tick - midTick) / Math.max(1, endTickOfPhrase - midTick);
      const value = clamp(base * (0.72 + 0.28 * t));
      expression.push({ tick, value });
      // CC1 follows the same shape at a lower intensity, so vibrato opens with
      // the phrase rather than sitting flat.
      modulation.push({ tick, value: clamp(30 + 60 * (0.6 + 0.4 * t) * (base / 110)) });
    }
  }

  // Swell on every long note: +12 then -12 through the note.
  for (const note of notes) {
    if (note.durationTicks < beatTicks * 2) continue;
    const mid = note.startTick + Math.round(note.durationTicks / 2);
    const peak = clamp(expressionValueAt(expression, note.startTick) + 12);
    expression.push({ tick: mid, value: peak });
    expression.push({ tick: note.startTick + note.durationTicks - 1, value: clamp(peak - 12) });
  }

  expression.sort((a, b) => a.tick - b.tick);
  modulation.sort((a, b) => a.tick - b.tick);
  return [
    { cc: 11, points: dedupe(expression) } as CcLane,
    { cc: 1, points: dedupe(modulation) } as CcLane,
    { cc: 7, points: [{ tick: 0, value: 100 }, { tick: endTick, value: 100 }] } as CcLane,
  ];
}

function expressionValueAt(points: readonly CcPoint[], tick: number): number {
  let best = 70;
  for (const point of points) {
    if (point.tick > tick) break;
    best = point.value;
  }
  return best;
}

function dedupe(points: readonly CcPoint[]): CcPoint[] {
  const seen = new Map<number, number>();
  for (const point of points) seen.set(Math.max(0, Math.round(point.tick)), point.value);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([tick, value]) => ({ tick, value }));
}
