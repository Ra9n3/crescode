/**
 * Energy arc (Phase 3c/3d, spec §8 "energy curve" in the spine). Per-bar
 * target energies instead of one flat level per section type:
 *   - a build INSIDE each section (crescendo-shaped, take-varied strength);
 *   - a dip on the last bar before a section change;
 *   - intro tapering (first section starts lower) and outro tapering
 *     (the final section winds down);
 *   - one deliberate near-silence bar before the FIRST Chorus — the strings
 *     rest there entirely (the conductor plans it as a breath), only when a
 *     template is active and unlocked in-band strings exist to silence.
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

  // the near-silence bar: the bar immediately before the first chorus-like section
  const firstChorus = [...sections].sort((a, b) => a.startBar - b.startBar).find((s) => CHORUS_LIKE.test(s.name.trim().toLowerCase()));
  const silenceBar = allowSilence && firstChorus && firstChorus.startBar > 1 ? firstChorus.startBar - 1 : 0;
  const lastSection = sections.length ? sections.reduce((a, b) => (b.startBar > a.startBar ? b : a)) : null;

  const out: ArcBar[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const sec = sectionAtBar(sections, bar);
    const name = sec?.name ?? '*';
    const base = sectionEnergyTarget(name);
    const shape = shapeOf(sec ?? ({ id: '__all', name: '*', index: 0, occurrence: 1, startBar: 1, lengthBars: bars, startTick: 0, endTick: bars * btBar } as SpineSection));
    const i = sec ? Math.min(sec.lengthBars - 1, Math.max(0, bar - sec.startBar)) : bar - 1;
    const B = sec?.lengthBars ?? bars;

    // build inside the section: rises from (1−build/2)·base to (1+build/2)·base
    let target = B > 1 ? base * (1 - shape.build / 2 + (shape.build * i) / (B - 1)) : base;

    // intro taper: the very first section starts lower and ramps in
    if (sec && sec.index === 0 && i < shape.taperBars) {
      target *= 0.6 + 0.4 * ((i + 1) / shape.taperBars);
    }
    // outro taper: the final section winds down over its last bars
    if (sec && lastSection && sec.id === lastSection.id && B - 1 - i < shape.taperBars) {
      target *= 0.55 + 0.45 * ((B - 1 - i) / shape.taperBars);
    }
    // dip before a section change: the last bar of any non-final section
    if (sec && lastSection && sec.id !== lastSection.id && i === B - 1) {
      target *= 1 - shape.dip;
    }

    const nearSilence = bar === silenceBar;
    if (nearSilence) target = 0;

    target = Math.max(0, Math.min(clampMax, target));
    out.push({ bar, startTick: (bar - 1) * btBar, endTick: bar * btBar, sectionId: sec?.id ?? '__all', target, nearSilence });
  }
  return out;
}

/** The arc target at a tick (the containing bar's target; past the end → the last bar). */
export function arcTargetAt(arc: ArcBar[], tick: number): number {
  if (!arc.length) return 0;
  for (const b of arc) if (tick >= b.startTick && tick < b.endTick) return b.target;
  return tick < arc[0].startTick ? arc[0].target : arc[arc.length - 1].target;
}
