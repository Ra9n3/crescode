import { PPQ, type Project, type TimeSignature } from './types';

/** Ticks per bar for a time signature at 960 PPQ. */
export function barTicks(ts: TimeSignature): number {
  return Math.round((PPQ * 4 * ts.numerator) / ts.denominator);
}

/** Ticks per notated pulse (the denominator unit). */
export function pulseTicks(ts: TimeSignature): number {
  return Math.round((PPQ * 4) / ts.denominator);
}

/** Compound meters (6/8, 9/8, 12/8) group pulses in threes. */
export function isCompound(ts: TimeSignature): boolean {
  return ts.denominator >= 8 && ts.numerator % 3 === 0 && ts.numerator > 3;
}

/** Felt beats per bar and their tick offsets within the bar. */
export function beatOffsets(ts: TimeSignature): number[] {
  const p = pulseTicks(ts);
  if (isCompound(ts)) return Array.from({ length: ts.numerator / 3 }, (_, i) => i * p * 3);
  return Array.from({ length: ts.numerator }, (_, i) => i * p);
}

export function beatTicks(ts: TimeSignature): number {
  return isCompound(ts) ? pulseTicks(ts) * 3 : pulseTicks(ts);
}

export function barToTick(bar1: number, ts: TimeSignature): number {
  return (bar1 - 1) * barTicks(ts);
}

export function tickToBarBeat(tick: number, ts: TimeSignature): { bar: number; beat: number; tick: number } {
  const bt = barTicks(ts);
  const bar = Math.floor(tick / bt);
  const inBar = tick - bar * bt;
  const b = beatTicks(ts);
  const beat = Math.floor(inBar / b);
  return { bar: bar + 1, beat: beat + 1, tick: Math.round(inBar - beat * b) };
}

export const DEFAULT_EMPTY_BARS = 8;

/** Project length in bars: sections and chords define the song; minimum 1 bar. */
export function projectBars(p: Pick<Project, 'sections' | 'chords' | 'timeSignature'>): number {
  const bt = barTicks(p.timeSignature);
  let bars = 0;
  for (const s of p.sections) bars = Math.max(bars, s.startBar - 1 + s.lengthBars);
  for (const c of p.chords) bars = Math.max(bars, Math.ceil((c.startTick + c.durationTicks) / bt));
  return bars > 0 ? bars : DEFAULT_EMPTY_BARS;
}

export function projectEndTick(p: Pick<Project, 'sections' | 'chords' | 'timeSignature'>): number {
  return projectBars(p) * barTicks(p.timeSignature);
}

export function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQ) * (60 / bpm);
}
export function secondsToTicks(sec: number, bpm: number): number {
  return (sec * bpm * PPQ) / 60;
}
