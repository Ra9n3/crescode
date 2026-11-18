/**
 * Layer 1 — Musical Context.
 *
 * Reads the project and produces the musical foundation the rest of the
 * engine reasons over: the bar grid, sections and their dramatic function,
 * harmonic spans, the energy arc, and the register field.
 *
 * Imports ONLY `shared/schema` — never the old orchestrator. This is the
 * boundary that keeps the new engine independent.
 */
import { parseChord } from '../../shared/schema/chords';
import { scalePitchClasses } from '../../shared/schema/modes';
import { barTicks, beatTicks, projectBars, projectEndTick } from '../../shared/schema/meter';
import { INSTRUMENTS, instrumentRange } from '../../shared/schema/ranges';
import {
  isInstrumentTrack,
  type Project,
  type Section,
  type Track,
} from '../../shared/schema/types';
import type {
  BarCell,
  FormSection,
  HarmonicSpan,
  MeterGrid,
  RegisterBand,
  SectionFunction,
} from '../ir';

/* ------------------------------------------------------------ the grid */

export function buildGrid(project: Project): MeterGrid {
  const bars = projectBars(project);
  return {
    timeSignature: { ...project.timeSignature },
    barTicks: barTicks(project.timeSignature),
    beatTicks: beatTicks(project.timeSignature),
    totalBars: bars,
    endTick: projectEndTick(project),
  };
}

/* ------------------------------------------------------- form / sections */

/**
 * Section function is derived from position and repetition, not from the
 * section's name — a project is free to call its sections anything.
 */
function sectionFunctionFor(
  index: number,
  total: number,
  occurrence: number,
  lengthBars: number,
  longest: number,
): SectionFunction {
  if (index === 0) return 'opening';
  if (index === total - 1) return 'closing';
  if (occurrence > 1) return 'reprise';
  // A section notably longer than the piece's median reads as the structural
  // weight — the place the music is built toward.
  if (lengthBars >= longest * 0.9 && total >= 3) return 'culmination';
  if (lengthBars <= longest * 0.5) return 'contrast';
  return 'continuation';
}

export function buildSections(project: Project, grid: MeterGrid): FormSection[] {
  const sections: Section[] = [...project.sections].sort((a, b) => a.startBar - b.startBar);
  if (!sections.length) {
    // No authored sections: one implicit section so the engine still composes.
    return [{
      id: 'section-implicit',
      name: 'All',
      index: 0,
      occurrence: 1,
      startTick: 0,
      endTick: grid.endTick,
      startBar: 1,
      lengthBars: grid.totalBars,
      function: grid.totalBars > 1 ? 'opening' : 'opening',
    }];
  }
  const longest = Math.max(...sections.map((s) => s.lengthBars));
  const seen = new Map<string, number>();
  return sections.map((section, index) => {
    const occurrence = (seen.get(section.name) ?? 0) + 1;
    seen.set(section.name, occurrence);
    const startTick = (section.startBar - 1) * grid.barTicks;
    const endTick = Math.min(grid.endTick, startTick + section.lengthBars * grid.barTicks);
    return {
      id: section.id,
      name: section.name,
      index,
      occurrence,
      startTick,
      endTick,
      startBar: section.startBar,
      lengthBars: Math.max(1, Math.round((endTick - startTick) / grid.barTicks)),
      function: sectionFunctionFor(index, sections.length, occurrence, section.lengthBars, longest),
    };
  });
}

/* ------------------------------------------------------------ harmony */

export function buildHarmony(project: Project, grid: MeterGrid): HarmonicSpan[] {
  const sorted = [...project.chords].sort((a, b) => a.startTick - b.startTick);
  if (!sorted.length) {
    // No chords: an open, tonic-rooted field so material still has a home.
    return [{
      id: 'harmony-open',
      symbol: '-',
      startTick: 0,
      endTick: grid.endTick,
      root: project.key,
      bass: project.key,
      pitchClasses: scalePitchClasses(project.key, project.mode),
      intervals: [0],
    }];
  }
  const spans: HarmonicSpan[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const chord = sorted[index];
    const next = sorted[index + 1];
    const startTick = chord.startTick;
    const endTick = Math.min(grid.endTick, next ? next.startTick : startTick + chord.durationTicks);
    if (endTick <= startTick) continue;
    const parsed = parseChord(chord.symbol);
    if (!parsed.ok) {
      // Unparseable symbols fall back to the scale: never invent a harmony
      // the project did not ask for, but keep the bar harmonically legal.
      spans.push({
        id: chord.id,
        symbol: chord.symbol,
        startTick,
        endTick,
        root: project.key,
        bass: project.key,
        pitchClasses: scalePitchClasses(project.key, project.mode),
        intervals: [0],
      });
      continue;
    }
    spans.push({
      id: chord.id,
      symbol: chord.symbol,
      startTick,
      endTick,
      root: parsed.chord.root,
      bass: parsed.chord.bass ?? parsed.chord.root,
      pitchClasses: parsed.chord.pitchClasses,
      intervals: parsed.chord.intervals,
    });
  }
  return mergeAdjacent(spans);
}

/** Consecutive identical chords read as one span, so phrases are not split. */
function mergeAdjacent(spans: HarmonicSpan[]): HarmonicSpan[] {
  const out: HarmonicSpan[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (last && last.symbol === span.symbol && last.endTick === span.startTick) {
      out[out.length - 1] = { ...last, endTick: span.endTick };
    } else {
      out.push(span);
    }
  }
  return out;
}

/* ------------------------------------------------------------- energy */

/**
 * A deterministic energy arc over the whole piece, shaped by section
 * function. This is a musical intention curve, not a loudness measurement:
 * it says how much the music should be doing, bar by bar.
 */
export function buildEnergy(sections: FormSection[], grid: MeterGrid): number[] {
  const energy = new Array<number>(grid.totalBars).fill(0.5);
  for (const section of sections) {
    const base = baseEnergyFor(section.function);
    const length = Math.max(1, section.lengthBars);
    for (let offset = 0; offset < length; offset++) {
      const bar = section.startBar - 1 + offset;
      if (bar < 0 || bar >= grid.totalBars) continue;
      const t = length === 1 ? 1 : offset / (length - 1);
      // Each section has its own interior shape, so the arc is not a step
      // function: openings swell, climaxes peak late, closings settle.
      let shape: number;
      switch (section.function) {
        case 'opening': shape = 0.35 + 0.5 * t; break;
        case 'culmination': shape = 0.7 + 0.3 * Math.sin(Math.PI * t); break;
        case 'contrast': shape = 0.85 - 0.5 * t; break;
        case 'closing': shape = 0.8 - 0.55 * t; break;
        case 'reprise': shape = 0.6 + 0.25 * Math.sin(Math.PI * t); break;
        default: shape = 0.5 + 0.2 * Math.sin(Math.PI * t); break;
      }
      energy[bar] = clamp01(base * 0.45 + shape * 0.55);
    }
  }
  return energy;
}

function baseEnergyFor(fn: SectionFunction): number {
  switch (fn) {
    case 'opening': return 0.55;
    case 'culmination': return 1;
    case 'contrast': return 0.3;
    case 'closing': return 0.4;
    case 'reprise': return 0.8;
    default: return 0.7;
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ------------------------------------------------------------- bar grid */

export function buildBars(
  sections: FormSection[],
  grid: MeterGrid,
  energy: number[],
): BarCell[] {
  const bars: BarCell[] = [];
  for (let index = 0; index < grid.totalBars; index++) {
    const startTick = index * grid.barTicks;
    const section = sections.find((s) => startTick >= s.startTick && startTick < s.endTick)
      ?? sections[sections.length - 1];
    bars.push({
      bar: index + 1,
      startTick,
      endTick: startTick + grid.barTicks,
      sectionId: section.id,
      sectionName: section.name,
      sectionFunction: section.function,
      energy: energy[index] ?? 0.5,
    });
  }
  return bars;
}

/* ---------------------------------------------------- register field */

const byRole = new Map(INSTRUMENTS.map((def) => [def.role, def]));

/**
 * Hard range comes from the shared instrument table; the comfortable window is
 * a fraction of it taken from the middle of the instrument, which is where
 * orchestral writing actually lives. This is the single definition every
 * family engine and the validator read.
 */
export function registerBandFor(role: string): RegisterBand | null {
  const def = byRole.get(role);
  if (!def) return null;
  const [low, high] = instrumentRange(def);
  const span = high - low;
  // Keep clear of the extremes: bottom 15% and top 25% are for extremes only.
  const comfyLow = Math.round(low + span * 0.15);
  const comfyHigh = Math.round(high - span * 0.25);
  return {
    low,
    high,
    comfortable: [comfyLow, Math.max(comfyLow + 1, comfyHigh)],
    centroid: Math.round((comfyLow + comfyHigh) / 2),
  };
}

export function registerFieldFor(tracks: readonly Track[]): Map<string, RegisterBand> {
  const field = new Map<string, RegisterBand>();
  for (const track of tracks) {
    if (!isInstrumentTrack(track)) continue;
    const band = registerBandFor(track.role);
    if (band) {
      // Honour the track's own authored limits when they are narrower.
      field.set(track.id, {
        ...band,
        low: Math.max(band.low, track.lowestNote),
        high: Math.min(band.high, track.highestNote),
      });
    }
  }
  return field;
}
