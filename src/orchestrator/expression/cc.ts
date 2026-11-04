/**
 * CC generation (Phase 5c). Builds the CC lanes for every string track the
 * orchestrator writes, FROM the per-take texture plan: the notes'
 * articulations classify each bar (ostinato/pizz, tremolo, legato line), so
 * a texture that hands the tune to another voice moves the arcs with it and
 * a pizz/ostinato texture never gets expressive legato automation.
 *
 *   - CC1 + CC11  one phrase arc per phrase (PHRASE_BARS-bar chunks aligned
 *                 to the section start): a raised-cosine rise to the
 *                 phrase's highest-energy bar, easing off after it, scaled
 *                 by the bar's arc energy. CC11 spans a slightly wider
 *                 range than CC1. Skipped for phrases a track plays
 *                 entirely as ostinato/pizz. Handoff bars need no special
 *                 case: each carrier's own track carries the arch, so the
 *                 arc follows the current lead carrier by construction.
 *   - CC7         ONE static point at tick 0 (balance only).
 *   - CC74        short seeded spikes on phrase-start downbeats and on the
 *                 first tremolo/ostinato onset of each bar (attack colour).
 *   - CC68        127 over legato passages, 0 elsewhere — pad/lead/bass/
 *                 counterline legato only (ostinato/pizz/tremolo tracks
 *                 have no legato notes, so they get no CC68 lane at all).
 *   - S-curves    a 40–80 ms smoothstep ramp (tempo-map ticks, seeded per
 *                 take) on CC11 at soft legato entries (first note after a
 *                 rest, velocity below SOFT_ENTRY_VELOCITY) — legato
 *                 entries only, never on ostinato/pizz/tremolo.
 *
 * Engineering contract: lanes sorted by tick, ticks within [0, project end],
 * at most MAX_CC_POINTS_PER_LANE points per lane (collinear points thinned,
 * then an even decimation as the hard cap), values 0–127, deterministic per
 * D8 (the seed rides on the orchestration seed of (inputs, take)).
 */
import { hashString, mulberry32 } from '../../engine/generate';
import { barTicks, projectBars } from '../../shared/schema/meter';
import { MAX_CC_POINTS_PER_LANE, type CcLane, type CcPoint, type Note, type Project } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { msToTicks, orchestrationSeedFor, ticksToMs, type ArcBar, type SpineSection } from '../spine';

/* ---------------- named constants ---------------- */

/** A phrase: this many bars, aligned to the section start (last chunk may be shorter). */
export const PHRASE_BARS = 4;
/** CC1 arch range (0–127); CC11 spans a slightly wider range. */
export const CC1_ARC_RANGE: readonly [number, number] = [38, 84];
export const CC11_ARC_RANGE: readonly [number, number] = [30, 96];
/** CC68 over legato passages / elsewhere. */
export const CC68_LEGATO = 127;
export const CC68_OFF = 0;
/** A legato run tolerates this small a gap between consecutive notes before it breaks. */
export const CC68_GAP_TICKS = 240;
/** CC7 static balance point (one point at tick 0). */
export const CC7_BALANCE = 90;
/** CC74 spikes: base 0, seeded spike value range and length in ticks. */
export const CC74_BASE = 0;
export const CC74_SPIKE_VALUE: readonly [number, number] = [96, 120];
export const CC74_SPIKE_TICKS: readonly [number, number] = [48, 96];
/** Soft legato entries (S-curve): velocity threshold and ramp shape. */
export const SOFT_ENTRY_VELOCITY = 50;
export const S_CURVE_MS: readonly [number, number] = [40, 80];
export const S_CURVE_POINTS = 5;
/** How far above the lane floor the S-curve tops out (on the CC11 scale). */
export const S_CURVE_DIP = 24;

/** The bar kind a track plays, read from its notes' articulations in one bar. */
export type BarKind = 'ostinato' | 'tremolo' | 'line';

/* ---------------- helpers ---------------- */

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v)));

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Exact integer collinearity: point b lies on the segment a..c. */
const collinear = (a: CcPoint, b: CcPoint, c: CcPoint): boolean =>
  (b.value - a.value) * (c.tick - a.tick) === (c.value - a.value) * (b.tick - a.tick);

/** Sort, collapse duplicate ticks (later write wins), thin collinear points, enforce the cap. */
export function finalizeLane(cc: number, points: CcPoint[], endTick: number): CcLane {
  const sorted = points
    .filter((p) => Number.isFinite(p.tick) && Number.isFinite(p.value))
    .map((p) => ({ tick: clampInt(p.tick, 0, endTick), value: clampInt(p.value, 0, 127) }))
    .sort((a, b) => a.tick - b.tick);
  const deduped: CcPoint[] = [];
  for (const p of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && last.tick === p.tick) deduped[deduped.length - 1] = p;
    else deduped.push(p);
  }
  const thinned: CcPoint[] = [];
  for (const p of deduped) {
    const n = thinned.length;
    if (n >= 2 && collinear(thinned[n - 2], thinned[n - 1], p)) thinned.pop();
    thinned.push(p);
  }
  let out = thinned;
  if (out.length > MAX_CC_POINTS_PER_LANE) {
    const k = Math.ceil(out.length / MAX_CC_POINTS_PER_LANE);
    const keepLast = out[out.length - 1];
    out = out.filter((_, i) => i % k === 0);
    if (out[out.length - 1] !== keepLast) out.push(keepLast);
  }
  return { cc, points: out };
}

/** The bar kind a track plays, from the articulations sounding in that bar. */
export function barKindOf(notes: Note[], barStart: number, barEnd: number): BarKind | null {
  let saw = false;
  let ost = false;
  let trem = false;
  for (const n of notes) {
    if (n.startTick >= barEnd || n.startTick + n.durationTicks <= barStart) continue;
    saw = true;
    if (n.articulation === 'spiccato' || n.articulation === 'pizz') ost = true;
    else if (n.articulation === 'tremolo') trem = true;
  }
  if (!saw) return null;
  return ost ? 'ostinato' : trem ? 'tremolo' : 'line';
}

/** The phrase chunks of one section: PHRASE_BARS-bar stretches from its start. */
export function phrasesOf(section: SpineSection): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (let b = section.startBar; b < section.startBar + section.lengthBars; b += PHRASE_BARS) {
    out.push({ from: b, to: Math.min(section.startBar + section.lengthBars, b + PHRASE_BARS) });
  }
  return out;
}

/** One phrase arch evaluated at each bar start, scaled by the bar's arc energy. */
function phraseArc(from: number, to: number, btBar: number, arc: ArcBar[], clampMax: number, range: readonly [number, number]): CcPoint[] {
  const bars = Array.from({ length: to - from }, (_, i) => from + i);
  const targetOf = (b: number) => arc[b - 1]?.target ?? 0;
  let peak = from; // the phrase's peak bar: highest arc energy, earliest on a tie
  for (const b of bars) if (targetOf(b) > targetOf(peak) + 1e-12) peak = b;
  const [lo, hi] = range;
  return bars.map((b) => {
    const t = b <= peak
      ? (peak === from ? 1 : (b - from) / (peak - from))
      : (to - 1 === peak ? 0 : (b - peak) / (to - 1 - peak));
    const arch = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
    const energy = clampMax > 0 ? targetOf(b) / clampMax : 0;
    return { tick: (b - 1) * btBar, value: lo + (hi - lo) * arch * (0.5 + 0.5 * energy) };
  });
}

/* ---------------- the builder ---------------- */

export interface CcBuildInput {
  project: Project;
  template: EnsembleTemplate | null;
  sections: SpineSection[];
  arc: ArcBar[];
  /** Final notes per TRACK id (in-band, unlocked strings only). */
  notesByTrackId: Record<string, Note[]>;
  /** The tune carrier per bar (index bar−1, null = none). The arcs ride each
   *  track's own bars — a handoff moves the arc to the new carrier without a
   *  special case — but the carrier map stays part of the input contract so
   *  future lane kinds can key on it. */
  carrierByBar: (string | null)[];
}

/** Builds the CC lanes for every handed-in track. Pure; deterministic per (inputs, take). */
export function buildCcLanes(input: CcBuildInput): Record<string, CcLane[]> {
  const { project, template, sections, arc, notesByTrackId } = input;
  const btBar = barTicks(project.timeSignature);
  const bars = projectBars(project);
  const endTick = bars * btBar;
  const clampMax = template?.budget.energyClamp[1] ?? 1;

  // one seeded draw per take (D8): the spike shape and the S-curve length
  const rng = mulberry32((orchestrationSeedFor(project, project.orchestration) ^ Math.imul(hashString('cc'), 0x85ebca6b)) >>> 0);
  const spikeValue = Math.round(CC74_SPIKE_VALUE[0] + rng() * (CC74_SPIKE_VALUE[1] - CC74_SPIKE_VALUE[0]));
  const spikeTicks = Math.round(CC74_SPIKE_TICKS[0] + rng() * (CC74_SPIKE_TICKS[1] - CC74_SPIKE_TICKS[0]));
  const rampMs = S_CURVE_MS[0] + rng() * (S_CURVE_MS[1] - S_CURVE_MS[0]);

  const out: Record<string, CcLane[]> = {};
  for (const [trackId, notes] of Object.entries(notesByTrackId)) {
    if (!notes.length) continue;
    const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    const kindAt = (b: number) => barKindOf(sorted, (b - 1) * btBar, b * btBar);

    // --- phrase arcs (CC1 + CC11); skipped for all-ostinato/pizz phrases ---
    const cc1: CcPoint[] = [];
    const cc11: CcPoint[] = [];
    for (const sec of sections) {
      for (const ph of phrasesOf(sec)) {
        const kinds = Array.from({ length: ph.to - ph.from }, (_, i) => kindAt(ph.from + i));
        if (!kinds.some((k) => k !== null)) continue; // the track rests through the phrase
        if (kinds.every((k) => k === 'ostinato')) continue; // no expression arcs over a pizz/ostinato phrase
        const soundingBars = new Set(kinds.map((k, i) => (k !== null ? ph.from + i : -1)).filter((b) => b > 0));
        for (const [lane, range] of [[cc1, CC1_ARC_RANGE], [cc11, CC11_ARC_RANGE]] as [CcPoint[], readonly [number, number]][]) {
          lane.push(...phraseArc(ph.from, ph.to, btBar, arc, clampMax, range).filter((p) => soundingBars.has(Math.floor(p.tick / btBar) + 1)));
        }
      }
    }

    // --- CC68: 127 over legato passages, 0 elsewhere ---
    const cc68: CcPoint[] = [];
    let runEnd: number | null = null; // end tick of the open legato run
    for (const n of sorted) {
      const nEnd = Math.min(endTick, n.startTick + n.durationTicks);
      if (n.articulation === 'legato' && n.startTick < endTick) {
        if (runEnd !== null && n.startTick - runEnd <= CC68_GAP_TICKS) {
          runEnd = Math.max(runEnd, nEnd); // the passage continues
          continue;
        }
        if (runEnd !== null) cc68.push({ tick: runEnd, value: CC68_OFF }); // close the previous run
        cc68.push({ tick: n.startTick, value: CC68_LEGATO });
        runEnd = nEnd;
      } else if (runEnd !== null) {
        cc68.push({ tick: runEnd, value: CC68_OFF });
        runEnd = null;
      }
    }
    if (runEnd !== null) cc68.push({ tick: runEnd, value: CC68_OFF });
    // an explicit "0 elsewhere" from tick 0, so no consumer smears the first
    // passage's 127 backwards over the opening rests
    if (cc68.length && cc68[0].tick !== 0) cc68.unshift({ tick: 0, value: CC68_OFF });

    // --- CC74: phrase-start downbeats + tremolo/ostinato entries ---
    const cc74: CcPoint[] = [];
    const spike = (tick: number) => {
      cc74.push({ tick, value: spikeValue });
      cc74.push({ tick: Math.min(endTick, tick + spikeTicks), value: CC74_BASE });
    };
    for (const sec of sections) {
      for (const ph of phrasesOf(sec)) {
        if (ph.from <= bars && kindAt(ph.from) !== null) spike((ph.from - 1) * btBar);
      }
    }
    for (let b = 1; b <= bars; b++) {
      const kind = kindAt(b);
      if (kind !== 'ostinato' && kind !== 'tremolo') continue;
      const first = sorted.find((n) => n.startTick >= (b - 1) * btBar && n.startTick < b * btBar
        && (n.articulation === 'spiccato' || n.articulation === 'pizz' || n.articulation === 'tremolo'));
      if (first) spike(first.startTick);
    }

    // --- S-curves on CC11 at soft legato entries (first note after a rest, velocity < ~50) ---
    const rampTicks = Math.max(1, Math.round(msToTicks(ticksToMs(0, project.tempoMap) + rampMs, project.tempoMap) - ticksToMs(0, project.tempoMap)));
    let prev: Note | null = null;
    for (const n of sorted) {
      const afterRest = prev !== null && prev.startTick + prev.durationTicks < n.startTick;
      prev = n;
      if (n.articulation !== 'legato' || !afterRest || n.velocity >= SOFT_ENTRY_VELOCITY) continue;
      const t0 = Math.max(0, n.startTick - rampTicks);
      const startVal = CC11_ARC_RANGE[0];
      const endVal = Math.min(CC11_ARC_RANGE[1], startVal + S_CURVE_DIP);
      for (let i = 0; i < S_CURVE_POINTS; i++) {
        const t = Math.round(t0 + ((n.startTick - t0) * i) / (S_CURVE_POINTS - 1));
        cc11.push({ tick: t, value: startVal + (endVal - startVal) * smoothstep(i / (S_CURVE_POINTS - 1)) });
      }
    }

    // --- assemble (lane numbers ascending); CC74 rests at 0 from tick 0 ---
    if (cc74.length && cc74[0].tick !== 0) cc74.unshift({ tick: 0, value: CC74_BASE });
    const lanes = [
      finalizeLane(1, cc1, endTick),
      finalizeLane(11, cc11, endTick),
      ...(cc68.length ? [finalizeLane(68, cc68, endTick)] : []),
      finalizeLane(74, cc74, endTick),
      finalizeLane(7, [{ tick: 0, value: CC7_BALANCE }], endTick),
    ].filter((l) => l.points.length > 0);
    if (lanes.length) out[trackId] = lanes;
  }
  return out;
}
