/**
 * Phase 11 report numbers (read-only). Prints:
 *  - take 1 (three-chorus) per template: the harp / piano note counts,
 *    the glissandos by bar (part, direction, source), the drawn
 *    arpeggiator per section type, and the keys plan report line;
 *  - the chorus mean + peak against the clamp, before (the golden102
 *    capture at the post-10.2 HEAD 894eefb) and after, per template
 *    (takes 1–10 aggregated, three-chorus, all chorus windows).
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const KEYS_ROLES = ['harp', 'piano'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { result, project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project };
};
const secTypeAt = (bar: number): string => {
  const secs = [{ name: 'Verse', startBar: 1, lengthBars: 4 }, { name: 'Chorus', startBar: 5, lengthBars: 8 }, { name: 'Verse', startBar: 13, lengthBars: 4 }, { name: 'Chorus', startBar: 17, lengthBars: 8 }, { name: 'Bridge', startBar: 25, lengthBars: 4 }, { name: 'Chorus', startBar: 29, lengthBars: 8 }, { name: 'Outro', startBar: 37, lengthBars: 4 }];
  const s = secs.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
  return s ? s.name.toLowerCase() : '*';
};

console.log('=== take 1, three-chorus: keys facts per template ===');
for (const templateId of TEMPLATES) {
  const { result, project } = compose(threeChorus, templateId, 1);
  const counts: Record<string, number> = {};
  for (const role of KEYS_ROLES) counts[role] = project.tracks.find((t) => t.role === role)?.notes.length ?? 0;
  const plan = result.plan.keys;
  const glisses = plan.glisses.map((g) => `b${Math.floor(g.targetTick / 3840) + 1}(harp ${g.dir}, ${g.source})`).join(',') || 'none';
  const arp = Object.entries(plan.arpeggiatorByType).map(([t, p]) => `${t}=${p}`).join(',') || 'single-part';
  console.log(`\n${templateId}: harp=${counts.harp} piano=${counts.piano}`);
  console.log(`  glissandos: ${glisses}   arpeggiator by section type: ${arp}`);
  console.log(`  ${plan.reports[0]}`);
}

console.log('\n=== chorus mean / peak vs the clamp, before (golden102, post-10.2) and after ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const clamp = template.budget.energyClamp;
  const chorusStats = (proj: Project) => {
    const report = measureEnergy(proj, template);
    let mean = 0, n = 0, peak = 0;
    for (const w of report.windows) {
      if (secTypeAt(w.bar) !== 'chorus') continue;
      mean += w.energy; n++;
      peak = Math.max(peak, w.energy);
    }
    return { mean: mean / Math.max(1, n), peak };
  };
  let bMean = 0, bPeak = 0, aMean = 0, aPeak = 0, lowered = 0;
  for (let take = 1; take <= 10; take++) {
    const g = JSON.parse(readFileSync(new URL(`../tests/golden102/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
    const base: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    const beforeProj: Project = { ...base, tracks: base.tracks.map((x) => ({ ...x, notes: (g.tracks.find((y: { id: string }) => y.id === x.id)?.notes ?? []) })) };
    const b = chorusStats(beforeProj);
    bMean += b.mean; bPeak = Math.max(bPeak, b.peak);
    const { project } = compose(threeChorus, templateId, take);
    const a = chorusStats(project);
    aMean += a.mean; aPeak = Math.max(aPeak, a.peak);
    if (a.mean < b.mean) lowered++;
  }
  const pct = ((aMean - bMean) / bMean * 100).toFixed(1);
  console.log(`${short} (clamp ${clamp[0]}–${clamp[1]}): chorus mean ${(bMean / 10).toFixed(3)} -> ${(aMean / 10).toFixed(3)} (${pct}%)  peak ${bPeak.toFixed(3)} -> ${aPeak.toFixed(3)}  (takes whose mean lowered: ${lowered}/10)`);
}
