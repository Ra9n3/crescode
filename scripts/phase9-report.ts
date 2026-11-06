/**
 * Phase 9 report numbers (read-only). Prints:
 *  - take 1 (three-chorus) per wind template: wind note counts per
 *    instrument, lead doubles per section, pickup runs, wind lead bars,
 *    flutter bars, the moment timeline;
 *  - the chorus mean + below-floor counts before (golden90) and after, per
 *    template (takes 1–10 aggregated, three-chorus);
 *  - hard findings across the survey + the most common soft finding;
 *  - the survey-wide wind draw counts.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project, type Track } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { readFileSync } from 'node:fs';

const WIND_ROLES = ['flutes', 'oboes', 'clarinets', 'bassoons'];
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

console.log('=== take 1, three-chorus: wind facts per template ===');
for (const templateId of TEMPLATES) {
  const { result, project } = compose(threeChorus, templateId, 1);
  const counts: Record<string, number> = {};
  for (const role of WIND_ROLES) counts[role] = project.tracks.find((t) => t.role === role)?.notes.length ?? 0;
  const doubles = Object.entries(result.plan.winds.leadDoubleByType).map(([k, d]) => `${k}=${d.part ?? 'none'}/${d.mode}`).join(' ');
  const runs = result.plan.winds.pickupRuns.map((r) => `b${r.bar}→${r.downbeatBar}:${r.part}`).join(',') || 'none';
  const lead = result.plan.winds.leads.map((l) => `${l.startBar}-${l.endBar}:${l.part}`).join(',') || 'none';
  const flutter = Object.entries(result.plan.winds.flutterBars).map(([p, b]) => `${p}:${(b as number[]).join('/')}`).join(' ') || 'none';
  const moments = result.plan.moments.map((m) => `${m.kind} ${m.startBar}-${m.endBar}`).join(', ');
  console.log(`\n${templateId.replace('ensemble.', '')}: notes ${JSON.stringify(counts)}`);
  console.log(`  lead doubles: ${doubles}`);
  console.log(`  wind lead: ${lead} | pickup runs: ${runs} | flutter: ${flutter}`);
  console.log(`  moments: ${moments}`);
}

console.log('\n=== chorus mean + below-floor, before (golden90) → after, per template (takes 1–10, three-chorus) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  let bMean = 0, bN = 0, aMean = 0, aN = 0, bBelow = 0, aBelow = 0, lowered = 0;
  const perTake: string[] = [];
  for (let take = 1; take <= 10; take++) {
    const g = JSON.parse(readFileSync(new URL(`../tests/golden90/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
    const base = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    const before: Project = { ...base, tracks: g.tracks.map((t: Track) => ({ ...base.tracks.find((x) => x.id === t.id)!, notes: t.notes })) };
    const { project } = compose(threeChorus, templateId, take);
    const rb = measureEnergy(before, template);
    const ra = measureEnergy(project, template);
    let bs = 0, bn = 0, as = 0, an = 0, bb = 0, ab = 0;
    for (const w of rb.windows) {
      if (secTypeAt(w.bar) !== 'chorus') continue;
      bs += w.energy; bn++;
      if (w.energy < template.budget.energyClamp[0] - 1e-9 && w.noteCount > 0) bb++;
    }
    for (const w of ra.windows) {
      if (secTypeAt(w.bar) !== 'chorus') continue;
      as += w.energy; an++;
      if (w.energy < template.budget.energyClamp[0] - 1e-9 && w.noteCount > 0) ab++;
    }
    const bm = bs / bn, am = as / an;
    if (am < bm - 1e-9) lowered++;
    bMean += bm; bN++; aMean += am; aN++; bBelow += bb; aBelow += ab;
    perTake.push(`t${take} ${bm.toFixed(3)}→${am.toFixed(3)}${am < bm ? '*' : ''}`);
  }
  console.log(`${short}: chorus mean ${(bMean / bN).toFixed(3)} → ${(aMean / aN).toFixed(3)} (clamp max ${template.budget.energyClamp[1]}), below-floor ${bBelow} → ${aBelow}, per-take lowered: ${lowered}/10`);
  console.log('   ' + perTake.join(' | '));
}

console.log('\n=== findings across the survey (6 templates × takes 1–10 × both fixtures, moments on) ===');
const soft: Record<string, number> = {};
let hard = 0;
for (const templateId of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const takes = tag === 'three' ? 10 : 10;
    for (let take = 1; take <= takes; take++) {
      const { result, project } = compose(doc, templateId, take);
      const findings = checkTemplateRules(project, resolveTemplate({ templateId, overrides: {}, pins: {} })!, result.plan);
      for (const f of findings) {
        if (f.severity === 'hard') { hard++; console.log(`HARD ${templateId} ${tag} t${take}: ${f.message}`); }
        else if (f.severity === 'soft') soft[f.rule] = (soft[f.rule] ?? 0) + 1;
      }
    }
  }
}
console.log(`hard findings: ${hard}`);
console.log('soft findings:', Object.entries(soft).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));

console.log('\n=== survey-wide wind draws (three-chorus + dorian, takes 1–10) ===');
for (const templateId of TEMPLATES) {
  let leads = 0, runs = 0, flutter = 0, windSoli = 0;
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const { result } = compose(doc, templateId, take);
      leads += result.plan.winds.leads.length;
      runs += result.plan.winds.pickupRuns.length;
      flutter += Object.values(result.plan.winds.flutterBars).flat().length;
      for (const m of result.plan.moments) {
        if (m.kind !== 'soli' || m.flavor !== 'lead') continue;
        const role = (result.tracks as Track[]).find((t) => t.id === m.carrierTrackId)?.role;
        if (role && (WIND_ROLES as string[]).includes(role)) windSoli++;
      }
    }
  }
  console.log(`${templateId.replace('ensemble.', '')}: wind leads ${leads}, pickup runs ${runs}, flutter bars ${flutter}, wind solis ${windSoli}`);
}
