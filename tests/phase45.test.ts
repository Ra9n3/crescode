import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { PEAK_OPEN, PEAK_RESERVE } from '../src/orchestrator/spine';
import { projectFromFixture, type Project } from '../src/shared/schema';

/**
 * Phase 4.5 — the short follow-up on Phase 4:
 *   1. the cinematic chorus keeps its tune (V1 leads, rendered as measured
 *      tremolo repeats where the arc ≥ 0.65);
 *   2. the peak section is SHAPED onto the clamp — opens at PEAK_OPEN (85%),
 *      rises to 100% by its last bar before the final taper — instead of
 *      being clipped flat; every other section still caps at PEAK_RESERVE;
 *   3. Vc+Cb layering per note (skip only the notes that would fall below or
 *      double the leading tone), reported doubled/total per template;
 *   4. a three-chorus fixture asserting the peak plan end-to-end.
 */
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));

const composeWith = (project: Project, templateId: string | null, opts = { seed: 11 }) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  const result = composeAllTracks(project, opts);
  return { project: { ...project, tracks: result.tracks } as Project, result };
};

describe('Phase 4.5 (2): the peak is shaped onto the clamp, not clipped to it', () => {
  // The dorian fixture's Chorus (bars 9–16) is its last section, hence the
  // peak: it must OPEN at 85% of the clamp and rise over the chorus bars.
  it('per-bar chorus targets for chamber, sonata, vocalbacking, cinematic: open ~85% of clamp, rise over bars 1–6, top out at the clamp', () => {
    for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.cinematic']) {
      const { result } = composeWith(BASE(), templateId);
      const clampMax = ENSEMBLE_BY_ID.get(templateId)!.budget.energyClamp[1];
      const targets = result.plan.bars.slice(8, 16).map((b) => b.energyTarget); // chorus bars 9–16
      const lines = targets.map((t, i) => `  chorus bar ${i + 1}: ${(t / clampMax).toFixed(4)} of clamp (${t.toFixed(4)})`);
      console.log(`== ${templateId.slice(9)} (clamp max ${clampMax}), peak chorus targets:\n${lines.join('\n')}`);

      expect(targets[0]).toBeCloseTo(PEAK_OPEN * clampMax, 9); // opens at 85% of the clamp
      for (let i = 1; i < 6; i++) expect(targets[i]).toBeGreaterThan(targets[i - 1]); // rises over chorus bars 1–6
      expect(Math.max(...targets.slice(0, 6))).toBeLessThanOrEqual(clampMax + 1e-9); // the clamp is never exceeded…
      expect(Math.max(...targets)).toBeGreaterThanOrEqual(0.97 * clampMax); // …and the rise reaches it (within 3%)
      // every other section still caps at PEAK_RESERVE
      const verseMax = Math.max(...result.plan.bars.slice(0, 8).map((b) => b.energyTarget));
      expect(verseMax).toBeLessThanOrEqual(PEAK_RESERVE * clampMax + 1e-9);
    }
  });
});
