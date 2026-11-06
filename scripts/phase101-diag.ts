/**
 * Phase 10.1 diagnostic (read-only): where do the chorus below-floor windows
 * sit, and what does the post-9 golden96 look like in the same windows?
 * Per perc template: for takes 1-10 aggregated — chorus windows bucketed by
 * (norm gate bucket), with counts below the floor; plus per-bar detail for
 * take 1.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const SECS = [{ name: 'Verse', startBar: 1, lengthBars: 4 }, { name: 'Chorus', startBar: 5, lengthBars: 8 }, { name: 'Verse', startBar: 13, lengthBars: 4 }, { name: 'Chorus', startBar: 17, lengthBars: 8 }, { name: 'Bridge', startBar: 25, lengthBars: 4 }, { name: 'Chorus', startBar: 29, lengthBars: 8 }, { name: 'Outro', startBar: 37, lengthBars: 4 }];
const secTypeAt = (bar: number): string => {
  const s = SECS.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
  return s ? s.name.toLowerCase() : '*';
};
const compose = (templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { result, project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project };
};

for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const clamp = template.budget.energyClamp;
  const bucket = (norm: number): string => (norm >= 0.9 ? 'peak' : norm >= 0.72 ? 'high' : norm >= 0.5 ? 'mid' : norm >= 0.3 ? 'low' : 'off');
  type W = { bar: number; norm: number; roles: number; meanVel: number; energy: number };
  const stats = (proj: Project): { all: W[]; below: W[] } => {
    const report = measureEnergy(proj, template);
    const all: W[] = [];
    for (const w of report.windows) {
      if (secTypeAt(w.bar) !== 'chorus') continue;
      all.push({ bar: w.bar, norm: w.target / clamp[1], roles: w.roleCount, meanVel: w.meanVelocity, energy: w.energy });
    }
    return { all, below: all.filter((w) => w.energy > 0 && w.energy < clamp[0]) };
  };
  const agg: Record<string, { n: number; below: number; mean: number; sum: number }> = {};
  const aggG: Record<string, { n: number; below: number; mean: number; sum: number }> = {};
  let belowBars = new Map<number, number>();
  let belowBarsG = new Map<number, number>();
  for (let take = 1; take <= 10; take++) {
    const { project, result } = compose(templateId, take);
    const arc = result.plan.percussion.bars;
    const g = JSON.parse(readFileSync(new URL(`../tests/golden96/${short}-three-t${take}.json`, import.meta.url), import.meta.url ? 'utf8' : 'utf8'));
    const base: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    const gProj: Project = { ...base, tracks: base.tracks.map((x) => ({ ...x, notes: (g.tracks.find((y: { id: string }) => y.id === x.id)?.notes ?? []) })) };
    for (const [proj, aggRef, barsRef, withArc] of [[project, agg, belowBars, arc], [gProj, aggG, belowBarsG, null]] as const) {
      const { all, below } = stats(proj);
      for (const w of all) {
        const b = withArc ? bucket(withArc[w.bar - 1]?.norm ?? 0) : 'gold';
        aggRef[b] = aggRef[b] ?? { n: 0, below: 0, mean: 0, sum: 0 };
        aggRef[b].n++;
        aggRef[b].sum += w.energy;
        if (w.energy > 0 && w.energy < clamp[0]) {
          aggRef[b].below++;
          barsRef.set(w.bar, (barsRef.get(w.bar) ?? 0) + 1);
        }
      }
    }
  }
  const fmt = (a: Record<string, { n: number; below: number; mean: number; sum: number }>) =>
    Object.entries(a).sort().map(([b, v]) => `${b}:${v.n}w below=${v.below} mean=${(v.sum / v.n).toFixed(3)}`).join('  ');
  console.log(`\n${short} (floor ${clamp[0]}):`);
  console.log(`  post-10  ${fmt(agg)}`);
  console.log(`  post-9   ${fmt(aggG)}`);
  const bars = (m: Map<number, number>) => [...m.entries()].sort((x, y) => x[0] - y[0]).map(([b, c]) => `b${b}×${c}`).join(' ');
  console.log(`  below-floor bars post-10: ${bars(belowBars)}`);
  console.log(`  below-floor bars post-9:  ${bars(belowBarsG)}`);
}
