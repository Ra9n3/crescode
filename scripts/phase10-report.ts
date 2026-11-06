/**
 * Phase 10 report numbers (read-only). Prints:
 *  - take 1 (three-chorus) per percussion template: the percussion note
 *    counts per instrument, the crashes / rolls / tutti hits by bar, the
 *    gates chosen, and the per-part lag ranges;
 *  - the chorus mean + peak against the clamp and the below-floor counts,
 *    before (the golden96 capture at the post-9 HEAD) and after, per
 *    template (takes 1–10 aggregated, three-chorus);
 *  - hard findings across the survey + the most common soft finding;
 *  - the survey-wide crash/roll draw counts.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { readFileSync } from 'node:fs';

const PERC_ROLES = ['timpani', 'snare', 'cymbals', 'aux'];
const TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];

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

console.log('=== take 1, three-chorus: percussion facts per template ===');
for (const templateId of TEMPLATES) {
  const { result, project } = compose(threeChorus, templateId, 1);
  const counts: Record<string, number> = {};
  for (const role of PERC_ROLES) counts[role] = project.tracks.find((t) => t.role === role)?.notes.length ?? 0;
  const plan = result.plan.percussion;
  const crashes = plan.crashes.map((c) => `b${c.bar}(${c.source}${c.swell ? '+swell' : ''})`).join(',') || 'none';
  const rolls = plan.rolls.map((r) => `b${r.startBar}->${r.targetBar}:${r.part}`).join(',') || 'none';
  const tuttis = result.plan.moments.filter((m) => m.kind === 'tutti').map((m) => {
    const btBar = 3840;
    const s = (m.startBar - 1) * btBar;
    const timp = project.tracks.find((t) => t.role === 'timpani')?.notes.some((n) => n.startTick >= s && n.startTick < s + btBar) ?? false;
    const cym = project.tracks.find((t) => t.role === 'cymbals')?.notes.some((n) => n.startTick >= s && n.startTick < s + btBar) ?? false;
    return `b${m.startBar}(timpani:${timp ? 'hit' : '-'},cymbals:${cym ? 'crash' : '-'})`;
  }).join(',') || 'none';
  const finalHit = plan.finalTimpani && (project.tracks.find((t) => t.role === 'timpani')?.notes.some((n) => n.startTick >= 39 * 3840) ?? false);
  console.log(`\n${templateId}: counts ${PERC_ROLES.map((r) => `${r}=${counts[r]}`).join(' ')}  (final timpani hit: ${finalHit ? 'yes' : 'no'})`);
  console.log(`  crashes: ${crashes}   rolls: ${rolls}   tutti hits: ${tuttis}`);
  console.log(`  ${plan.reports[0]}`);
}

console.log('\n=== chorus mean / peak vs the clamp + below-floor counts, before (golden96) and after ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const clamp = template.budget.energyClamp;
  const chorusStats = (proj: Project) => {
    const report = measureEnergy(proj, template);
    let mean = 0, n = 0, below = 0, peak = 0;
    for (const w of report.windows) {
      if (secTypeAt(w.bar) !== 'chorus') continue;
      mean += w.energy; n++;
      peak = Math.max(peak, w.energy);
      if (w.energy > 0 && w.energy < clamp[0]) below++;
    }
    return { mean: mean / Math.max(1, n), below, peak };
  };
  let bMean = 0, bBelow = 0, bPeak = 0, aMean = 0, aBelow = 0, aPeak = 0, lowered = 0;
  for (let take = 1; take <= 10; take++) {
    const g = JSON.parse(readFileSync(new URL(`../tests/golden96/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
    const base: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    const beforeProj: Project = { ...base, tracks: base.tracks.map((x) => ({ ...x, notes: (g.tracks.find((y: { id: string }) => y.id === x.id)?.notes ?? []) })) };
    const b = chorusStats(beforeProj);
    bMean += b.mean; bBelow += b.below; bPeak = Math.max(bPeak, b.peak);
    const { project } = compose(threeChorus, templateId, take);
    const a = chorusStats(project);
    aMean += a.mean; aBelow += a.below; aPeak = Math.max(aPeak, a.peak);
    if (a.mean < b.mean) lowered++;
  }
  console.log(`${short} (clamp ${clamp[0]}–${clamp[1]}): chorus mean ${(bMean / 10).toFixed(3)} -> ${(aMean / 10).toFixed(3)}  peak ${bPeak.toFixed(3)} -> ${aPeak.toFixed(3)}  below-floor ${bBelow} -> ${aBelow}  (takes whose mean lowered: ${lowered}/10)`);
}

console.log('\n=== hard/soft findings across the survey (6 templates × both fixtures × takes 1–10/1–6) ===');
const softCount = new Map<string, number>();
let hardCount = 0, softTotal = 0;
for (const templateId of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const maxTake = fixTag === 'three' ? 10 : 6;
    for (let take = 1; take <= maxTake; take++) {
      const { project } = compose(doc, templateId, take);
      const template = resolveTemplate(project.ensemble)!;
      const findings = checkTemplateRules(project, template, compose(doc, templateId, take).result.plan);
      for (const f of findings) {
        if (f.severity === 'hard') { hardCount++; console.log(`HARD ${templateId} ${fixTag} t${take}: ${f.message}`); }
        else if (f.severity === 'soft') { softTotal++; softCount.set(f.rule, (softCount.get(f.rule) ?? 0) + 1); }
      }
    }
  }
}
const top = [...softCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, c]) => `${r} ${c}`).join(', ');
console.log(`hard findings: ${hardCount}   soft findings: ${softTotal}   most common: ${top}`);

console.log('\n=== survey-wide percussion draw counts (takes 1–10, both fixtures, the three templates) ===');
let crashCount = 0, rollCount = 0, swellCount = 0, finalHits = 0, takes = 0;
for (const templateId of TEMPLATES) {
  for (const doc of [threeChorus, dorian]) {
    for (let take = 1; take <= 10; take++) {
      const { result } = compose(doc, templateId, take);
      takes++;
      crashCount += result.plan.percussion.crashes.length;
      swellCount += result.plan.percussion.crashes.filter((c) => c.swell).length;
      rollCount += result.plan.percussion.rolls.length;
      if (result.plan.percussion.finalTimpani) finalHits++;
    }
  }
}
console.log(`${takes} takes: crashes ${crashCount} (swells ${swellCount}), rolls ${rollCount}, final timpani hits ${finalHits}`);
void softTotal;
