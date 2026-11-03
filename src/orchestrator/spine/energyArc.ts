/**
 * Energy arc (Phase 3c/3d, spec §8 "energy curve" in the spine). Per-bar
 * target energies instead of one flat level per section type:
 *   - a build INSIDE each section (crescendo-shaped, take-varied strength);
 *   - a dip on the last bar before a section change;
 *   - intro tapering (first section starts lower) and outro tapering
 *     (the final section winds down);
 *   - one deliberate near-silence bar before the FIRST Chorus — the strings
 *     rest there entirely (the conductor plans it as a breath), only when a
 *     template is active and unlocked in-band strings exist to silence;
 *   - peak reservation (Phase 3.5, reshaped in Phase 4.5): the last Chorus
 *     (or the last non-outro section) is the PEAK — it OPENS at PEAK_OPEN of
 *     the clamp max and rises linearly to 100% of the clamp by its last bar
 *     before the final taper (never clipped flat to the clamp) — while every
 *     other section caps at PEAK_RESERVE of the clamp, so exactly one section
 *     ever owns the top of the dynamic range.
 *
 * Per-take variation (3d) is seeded per D8: the shape parameters (build
 * strength, dip depth, taper lengths) are drawn from a stream derived from
 * the orchestration seed of (inputs, take) — same inputs + same take → the
 * same arc; a new take re-rolls the SHAPE, never the constraints. Targets
 * are clamped into the template budget; the renderer maps them through the
 * velocity governor, so the arc can never push a window past the clamp.
 */
import { barTicks, projectBars } from '../../shared/schema/meter';
import { mulberry32, hashString } from '../../engine/generate';
import { orchestrationSeedFor } from './index';
import type { Project } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import type { SpineSection } from './index';
import { sectionAtBar } from './index';
import { sectionEnergyTarget } from '../render';

export interface ArcBar {
  /** 1-indexed bar. */
  bar: number;
  startTick: number;
  endTick: number;
  sectionId: string;
  /** Target energy 0..clampMax for this bar. */
  target: number;
  /** The deliberate near-silence bar before the first Chorus. */
  nearSilence: boolean;
}

/** Sections matching this are "chorus-like" for the near-silence bar. */
const CHORUS_LIKE = /chorus|refrain|hook|drop/;

/** Sections matching this wind the song down (excluded from peak selection). */
const OUTRO_LIKE = /outro|coda|fade/;

/**
 * Peak reservation (Phase 3.5): only ONE section — the peak — may reach 100%
 * of the clamp max; every other section's planned energy caps at this share
 * of the clamp. The last Chorus (or, without one, the last non-outro
 * section) is the peak by default.
 */
export const PEAK_RESERVE = 0.88;

/**
 * Peak shape (Phase 4.5): the peak section OPENS at this share of the clamp
 * max and rises linearly to 100% by its last bar before the final taper —
 * the outro taper when the peak ends the song, else the pre-change dip bar.
 * The peak is shaped, never clipped flat to the clamp.
 */
export const PEAK_OPEN = 0.85;

/**
 * The peak section: the last chorus-like section by start bar, else the last
 * section that is not outro-like (degenerate all-outro maps fall back to the
 * last section). Null when the song has no real structure — with nothing to
 * contrast against there is no peak to reserve.
 */
export function peakSectionOf(sections: SpineSection[]): SpineSection | null {
  if (!sections.length) return null;
  const byStart = [...sections].sort((a, b) => a.startBar - b.startBar);
  const lastChorus = [...byStart].reverse().find((s) => CHORUS_LIKE.test(s.name.trim().toLowerCase()));
  if (lastChorus) return lastChorus;
  return [...byStart].reverse().find((s) => !OUTRO_LIKE.test(s.name.trim().toLowerCase())) ?? byStart[byStart.length - 1];
}

export function energyCurve(p: Project, sections: SpineSection[], take: number, template: EnsembleTemplate | null, allowSilence: boolean): ArcBar[] {
  const btBar = barTicks(p.timeSignature);
  const bars = projectBars(p);
  const clampMax = template?.budget.energyClamp[1] ?? 1;

  // 3d: the shape stream — decorrelated from the voicing stream by a salt,
  // still a pure function of (musical inputs, take).
  const rng = mulberry32((orchestrationSeedFor(p, { take }) ^ Math.imul(hashString('arc'), 0x85ebca6b)) >>> 0);

  // per-section shape parameters (drawn in section order → deterministic)
  interface Shape { build: number; dip: number; taperBars: number }
  const shapes = new Map<string, Shape>();
  const shapeOf = (sec: SpineSection): Shape => {
    const key = `${sec.index}:${sec.occurrence}`;
    let s = shapes.get(key);
    if (!s) {
      s = { build: 0.1 + rng() * 0.2, dip: 0.25 + rng() * 0.2, taperBars: 1 + (rng() < 0.5 ? 1 : 0) };
      shapes.set(key, s);
    }
    return s;
  };

  // the near-silence bar: the bar immediately before the first chorus-like
  // section — never the song's FINAL bar (Phase 3.5: the landing chord always
  // sounds; the guard is explicit even though startBar − 1 < bars always holds)
  const firstChorus = [...sections].sort((a, b) => a.startBar - b.startBar).find((s) => CHORUS_LIKE.test(s.name.trim().toLowerCase()));
  const silenceBar = allowSilence && firstChorus && firstChorus.startBar > 1 && firstChorus.startBar - 1 < bars ? firstChorus.startBar - 1 : 0;
  const lastSection = sections.length ? sections.reduce((a, b) => (b.startBar > a.startBar ? b : a)) : null;

  const out: ArcBar[] = [];
  const mods: number[] = []; // per-bar shape multipliers (parallel to out)
  for (let bar = 1; bar <= bars; bar++) {
    const sec = sectionAtBar(sections, bar);
    const name = sec?.name ?? '*';
    const base = sectionEnergyTarget(name);
    const shape = shapeOf(sec ?? ({ id: '__all', name: '*', index: 0, occurrence: 1, startBar: 1, lengthBars: bars, startTick: 0, endTick: bars * btBar } as SpineSection));
    const i = sec ? Math.min(sec.lengthBars - 1, Math.max(0, bar - sec.startBar)) : bar - 1;
    const B = sec?.lengthBars ?? bars;

    // build inside the section: rises from (1−build/2)·base to (1+build/2)·base
    let target = B > 1 ? base * (1 - shape.build / 2 + (shape.build * i) / (B - 1)) : base;

    // the combined shape multipliers — intro taper, outro taper, pre-change
    // dip — recorded per bar so the peak pass can rebuild the peak section ON
    // the ramp with the same landing shape (Phase 4.5)
    let mult = 1;
    // intro taper: the very first section starts lower and ramps in
    if (sec && sec.index === 0 && i < shape.taperBars) {
      mult *= 0.6 + 0.4 * ((i + 1) / shape.taperBars);
    }
    // outro taper: the final section winds down over its last bars
    if (sec && lastSection && sec.id === lastSection.id && B - 1 - i < shape.taperBars) {
      mult *= 0.55 + 0.45 * ((B - 1 - i) / shape.taperBars);
    }
    // dip before a section change: the last bar of any non-final section
    if (sec && lastSection && sec.id !== lastSection.id && i === B - 1) {
      mult *= 1 - shape.dip;
    }
    target *= mult;
    mods.push(mult);

    const nearSilence = bar === silenceBar;
    if (nearSilence) target = 0;

    target = Math.max(0, Math.min(clampMax, target));
    out.push({ bar, startTick: (bar - 1) * btBar, endTick: bar * btBar, sectionId: sec?.id ?? '__all', target, nearSilence });
  }

  // Peak reservation (Phase 3.5, Phase 4.5 shape): the peak section is not
  // clipped to the clamp — it OPENS at PEAK_OPEN·clampMax and rises linearly
  // to 100% of the clamp by its last bar before the final taper (the outro
  // taper when the peak ends the song, else the pre-change dip bar); the
  // taper/dip multipliers still land on top. Every other section caps at
  // PEAK_RESERVE of the clamp. Applies only to real structure: a structure-
  // less project is one pseudo-section, and giving it the peak ramp would
  // flatten the whole arc for no musical reason. The near-silence bars are
  // re-zeroed last so neither the ramp nor the cap can resurrect them.
  if (p.sections.length) {
    const peak = peakSectionOf(sections);
    if (peak) {
      const trailing = lastSection && peak.id === lastSection.id ? shapeOf(peak).taperBars : 1; // bars under the taper/dip
      const riseBars = Math.max(1, peak.lengthBars - trailing); // bars that carry the rise
      for (const b of out) {
        if (b.sectionId !== peak.id || b.nearSilence) continue;
        const i = b.bar - peak.startBar;
        const prog = riseBars > 1 ? Math.min(1, i / (riseBars - 1)) : 1;
        b.target = Math.min(clampMax, clampMax * (PEAK_OPEN + (1 - PEAK_OPEN) * prog) * mods[b.bar - 1]);
      }
      const cap = PEAK_RESERVE * clampMax;
      for (const b of out) if (b.sectionId !== peak.id) b.target = Math.min(b.target, cap);
      for (const b of out) if (b.nearSilence) b.target = 0;
    }
  }
  return out;
}

/** The arc target at a tick (the containing bar's target; past the end → the last bar). */
export function arcTargetAt(arc: ArcBar[], tick: number): number {
  if (!arc.length) return 0;
  for (const b of arc) if (tick >= b.startTick && tick < b.endTick) return b.target;
  return tick < arc[0].startTick ? arc[0].target : arc[arc.length - 1].target;
}
