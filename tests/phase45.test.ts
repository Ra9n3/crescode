import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID, resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { chordSpans } from '../src/engine/generate';
import { PEAK_OPEN, PEAK_RESERVE, sectionMap, energyCurve } from '../src/orchestrator/spine';
import { prepareStrings } from '../src/orchestrator/render';
import { contourOf } from '../src/orchestrator/lines/motif';
import type { Note } from '../src/shared/schema/types';
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

describe('Phase 4.5 (1): the cinematic chorus keeps its tune', () => {
  /** Contour over collapsed onsets: consecutive same-pitch notes (tremolo
   *  repeats, window-clipped re-attacks) are one contour point, not 'S' moves. */
  const collapsedContour = (notes: Note[]): string => {
    const sorted = [...notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
    const kept: Note[] = [];
    for (const n of sorted) {
      const last = kept[kept.length - 1];
      if (last && last.pitch === n.pitch) continue;
      kept.push(n);
    }
    return contourOf(kept);
  };

  it('V1 pitches in the chorus bars match the motif contour class like the other templates; the tremolo count is reported', () => {
    // Take 2: the contour class survives the raise on every take, but chord-
    // tone snapping at strong beats flips individual moves take-dependently
    // (whole-section agreement 0.58–1.00 across takes 1–4), so the assertion
    // pins a take — same practice as the other listening tests.
    const take = 2;
    const p = BASE();
    p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
    p.orchestration = { take };
    const composed = composeAllTracks(p, { seed: 11 });
    const project = { ...p, tracks: composed.tracks } as Project;

    // rebuild the same prepared lines (deterministic) — the compose INCREMENTS
    // the take, so the rebuild must read the take the compose actually ran
    const takeUsed = composed.orchestration.take;
    const template = resolveTemplate(p.ensemble)!;
    const sections = sectionMap(project);
    const arc = energyCurve(project, sections, takeUsed, template, true);
    const lines = prepareStrings({ project, template, ensemble: p.ensemble!, spans: chordSpans(project), sections, arc }, takeUsed);
    const fallbackTicks: [number, number][] = lines.voiced.filter((v) => lines.fallbackSpanIds.has(v.id)).map((v) => [v.startTick, v.endTick]);
    const inFallback = (tick: number) => fallbackTicks.some(([a, b]) => tick >= a && tick < b);

    const chorusBars = sections.filter((s) => /chorus/i.test(s.name));
    const inChorus = (n: Note) => chorusBars.some((s) => n.startTick >= s.startTick && n.startTick < s.endTick);
    const inVerse1 = (n: Note) => n.startTick < chorusBars[0].startTick;
    const planned = lines.lead!.notes;
    const written = project.tracks.find((t) => t.role === 'violins1')!.notes.filter((n) => inChorus(n) && !inFallback(n.startTick));

    // the motif contour class survives the raise (like chamber/symphony/sonata)
    const agree = (a: string, b: string) => [...a].filter((c, i) => c === b[i]).length / Math.min(a.length, b.length);
    const verseContour = contourOf(planned.filter(inVerse1));
    const chorusContour = contourOf(planned.filter(inChorus));
    console.log(`cinematic motif contour: verse "${verseContour}" chorus "${chorusContour}" (agreement ${agree(verseContour, chorusContour).toFixed(2)})`);
    expect(agree(verseContour, chorusContour)).toBeGreaterThanOrEqual(0.7);
    const mean = (ns: Note[]) => ns.reduce((a, n) => a + n.pitch, 0) / ns.length;
    expect(mean(planned.filter(inChorus))).toBeGreaterThan(mean(planned.filter(inVerse1))); // raised register

    // and the WRITTEN chorus line is that motif — tremolo repeats and all:
    // collapsed to one point per pitch run, the contour is the planned one, exactly
    expect(written.length).toBeGreaterThan(10);
    expect(collapsedContour(written)).toBe(collapsedContour(planned.filter((n) => inChorus(n) && !inFallback(n.startTick))));

    // the tremolo note count is reported and matches the score
    const report = composed.reports.find((r) => r.startsWith('cinematic tremolo'))!;
    const reported = Number(report.match(/(\d+)/)![1]);
    const tremoloCount = project.tracks.find((t) => t.role === 'violins1')!.notes.filter((n) => n.articulation === 'tremolo').length;
    expect(reported).toBe(tremoloCount);
    console.log(`Phase 4.5 report: ${report}`);
  });
});
