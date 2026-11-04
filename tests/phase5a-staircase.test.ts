import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { CHORUS_STAIRCASE_OPEN, CHORUS_STAIRCASE_TOP } from '../src/orchestrator/spine';
import type { Project } from '../src/shared/schema';
import { projectFromFixture } from '../src/shared/schema';

/**
 * Phase 5a — the chorus staircase: the non-peak choruses ramp across the
 * song instead of all sitting on PEAK_RESERVE. With n choruses before the
 * peak the first caps at ~70% of the clamp and the last non-peak chorus at
 * ~85%, linear in between; the peak is unchanged. On the three-chorus
 * fixture (Chorus 5-12, 17-24, 29-36; the last one is the peak) that means
 * chorus 1 ≤ 70% and chorus 2 ≤ 85% of each template's clamp — printed as
 * per-chorus mean planned E.
 */
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));

const composeWith = (project: Project, templateId: string, take = 0) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks } as Project, result };
};

const CHORUS_STARTS = [5, 17, 29]; // bars where each 8-bar chorus begins

describe('Phase 5a: non-peak choruses staircase toward the peak (three-chorus fixture)', () => {
  it('chorus 1 caps at ~70% of the clamp, chorus 2 at ~85%, and the planned means rise chorus 1 < 2 < 3 — all six templates', () => {
    const lines: string[] = [];
    for (const templateId of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
      const { result } = composeWith(THREE(), templateId);
      const clampMax = ENSEMBLE_BY_ID.get(templateId)!.budget.energyClamp[1];
      const perChorus = CHORUS_STARTS.map((from) => result.plan.bars.filter((b) => b.bar >= from && b.bar < from + 8).map((b) => b.energyTarget));
      const means = perChorus.map((ts) => ts.reduce((a, b) => a + b, 0) / ts.length);
      const maxes = perChorus.map((ts) => Math.max(...ts));
      lines.push(`  ${templateId.slice(9).padEnd(13)} (clamp ${clampMax}): means ${means.map((m) => m.toFixed(3)).join(' → ')}  maxes ${maxes.map((m) => m.toFixed(3)).join(' / ')}`);

      // the staircase caps (70% / 85% of the clamp) bind the first two choruses
      expect(maxes[0]).toBeLessThanOrEqual(CHORUS_STAIRCASE_OPEN * clampMax + 1e-9);
      expect(maxes[1]).toBeLessThanOrEqual(CHORUS_STAIRCASE_TOP * clampMax + 1e-9);
      // the peak chorus is unchanged: its rise still reaches the clamp (within 3%)
      expect(maxes[2]).toBeGreaterThanOrEqual(0.97 * clampMax);
      // the ramp across the song: planned means rise chorus 1 < 2 < 3
      expect(means[0]).toBeLessThan(means[1]);
      expect(means[1]).toBeLessThan(means[2]);
      // the staircase is tighter than the old reserve for BOTH non-peak choruses
      for (const m of maxes.slice(0, 2)) expect(m).toBeLessThanOrEqual(0.88 * clampMax + 1e-9);
    }
    console.log(`5a per-chorus planned E (three-chorus fixture, take 1):\n${lines.join('\n')}`);
  });

  it('a lone non-peak chorus sits at the top share (~85%); the interpolation is linear with three of them', () => {
    // Two choruses: the LAST one is the peak, so the lone non-peak chorus
    // caps at CHORUS_STAIRCASE_TOP.
    const p = THREE();
    p.sections = [
      { id: 's1', name: 'Verse', startBar: 1, lengthBars: 4 },
      { id: 's2', name: 'Chorus', startBar: 5, lengthBars: 8 },
      { id: 's3', name: 'Chorus', startBar: 13, lengthBars: 8 },
    ];
    const { result } = composeWith(p, 'ensemble.cinematic');
    const clampMax = ENSEMBLE_BY_ID.get('ensemble.cinematic')!.budget.energyClamp[1];
    const chorusMax = Math.max(...result.plan.bars.filter((b) => b.bar >= 5 && b.bar < 13).map((b) => b.energyTarget));
    expect(chorusMax).toBeLessThanOrEqual(CHORUS_STAIRCASE_TOP * clampMax + 1e-9);
    expect(chorusMax).toBeGreaterThan(CHORUS_STAIRCASE_OPEN * clampMax); // the top share, not the open

    // four choruses: three non-peak — the caps walk 70% → 77.5% → 85% of the
    // clamp, and the fourth chorus is the peak
    const q = THREE();
    q.sections = [
      { id: 's1', name: 'Verse', startBar: 1, lengthBars: 4 },
      { id: 's2', name: 'Chorus', startBar: 5, lengthBars: 4 },
      { id: 's3', name: 'Chorus', startBar: 9, lengthBars: 4 },
      { id: 's4', name: 'Chorus', startBar: 13, lengthBars: 4 },
      { id: 's5', name: 'Chorus', startBar: 17, lengthBars: 4 },
      { id: 's6', name: 'Outro', startBar: 21, lengthBars: 4 },
    ];
    const { result: r4 } = composeWith(q, 'ensemble.cinematic');
    const caps = [0, 1, 2].map((k) => (CHORUS_STAIRCASE_OPEN + ((CHORUS_STAIRCASE_TOP - CHORUS_STAIRCASE_OPEN) * k) / 2) * clampMax);
    const maxOf = (from: number) => Math.max(...r4.plan.bars.filter((b) => b.bar >= from && b.bar < from + 4).map((b) => b.energyTarget));
    const maxes = [maxOf(5), maxOf(9), maxOf(13)];
    console.log(`5a three-non-peak staircase caps ${caps.map((c) => c.toFixed(3)).join(' / ')} → measured maxes ${maxes.map((m) => m.toFixed(3)).join(' / ')} (peak chorus bars 17-20: ${maxOf(17).toFixed(3)})`);
    maxes.forEach((m, k) => expect(m).toBeLessThanOrEqual(caps[k] + 1e-9));
    expect(maxOf(17)).toBeGreaterThanOrEqual(0.97 * clampMax); // the fourth chorus is the peak
    // the caps bind on this fixture, so the staircase itself is visible
    expect(maxes[1]).toBeGreaterThan(maxes[0]);
    expect(maxes[2]).toBeGreaterThan(maxes[1]);
  });
});
