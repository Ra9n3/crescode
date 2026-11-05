/**
 * Phase 8 brass report numbers: per template × takes 1–10 (three-chorus)
 * brass note counts per instrument + kind coverage; take-1 lead ownership +
 * moment timeline; chorus energy vs clamp before (HEAD state is recomposed
 * from the baseline goldens) and after; soft findings.
 */
import { readFileSync } from 'node:fs';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { beatOffsets } from '../src/shared/schema/meter';

const THREE = JSON.parse(readFileSync(new URL('../fixtures/three-chorus-40bars.json', import.meta.url), 'utf8'));
const DORIAN = JSON.parse(readFileSync(new URL('../fixtures/dorian-16bars.json', import.meta.url), 'utf8'));
const BRASS = ['horns', 'trumpets', 'trombones', 'tuba'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { p, result, project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project };
};

const CHORUS = /chorus|refrain|hook|drop/;

console.log('=== per template × takes 1–10 (three-chorus): brass note counts per instrument ===');
for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio', 'ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
  const sums: Record<string, number> = { horns: 0, trumpets: 0, trombones: 0, tuba: 0 };
  const kinds = new Set<string>();
  let leads = 0;
  for (let take = 1; take <= 10; take++) {
    const { project, result } = compose(THREE, templateId, take);
    for (const role of BRASS) {
      const t = project.tracks.find((x) => x.role === role);
      sums[role] += t?.notes.length ?? 0;
    }
    for (const b of result.plan.brass.bars) for (const [, k] of Object.entries(b.voices)) if (k) kinds.add(k);
    leads += result.plan.brass.leads.length;
  }
  console.log(`${templateId.replace('ensemble.', '').padEnd(14)} horns ${String(sums.horns).padStart(5)}  trumpets ${String(sums.trumpets).padStart(5)}  trombones ${String(sums.trombones).padStart(5)}  tuba ${String(sums.tuba).padStart(4)}  kinds [${[...kinds].sort().join(',')}]  leads ${leads}`);
}

console.log('\n=== dorian × takes 1–10: kinds + leads ===');
for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']) {
  const kinds = new Set<string>();
  let leads = 0;
  for (let take = 1; take <= 10; take++) {
    const { result } = compose(DORIAN, templateId, take);
    for (const b of result.plan.brass.bars) for (const [, k] of Object.entries(b.voices)) if (k) kinds.add(k);
    leads += result.plan.brass.leads.length;
  }
  console.log(`${templateId.replace('ensemble.', '').padEnd(14)} kinds [${[...kinds].sort().join(',')}]  leads ${leads}`);
}

console.log('\n=== take 1 (three-chorus): who leads per section + brass counts + moments ===');
for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']) {
  const { project, result } = compose(THREE, templateId, 1);
  const carriersBySection = result.plan.bars.map((bp) => {
    const sec = bp.sectionName;
    return { sec, bar: bp.bar };
  });
  const carrierByBar = (bar: number) => {
    const b = result.plan.brass.bars[bar - 1];
    const lead = result.plan.brass.leads.some((l) => bar >= l.startBar && bar <= l.endBar) ? 'BRASS(trumpets)' : null;
    if (lead) return lead;
    void carriersBySection;
    return null;
  };
  void carrierByBar;
  const perSection = new Map<string, string>();
  for (const bp of result.plan.bars) {
    const brassBar = result.plan.brass.bars[bp.bar - 1];
    const lead = result.plan.brass.leads.some((l) => bp.bar >= l.startBar && bp.bar <= l.endBar);
    const brassVoices = Object.entries(brassBar?.voices ?? {}).filter(([, k]) => k !== undefined).map(([p, k]) => `${p}:${k}`).join(',') || 'rest';
    if (!perSection.has(bp.sectionId)) perSection.set(bp.sectionId, `bars ${bp.bar}.. bar1[${brassVoices}]${lead ? ' +BRASS LEAD' : ''}`);
  }
  const counts = BRASS.map((role) => `${role} ${project.tracks.find((x) => x.role === role)?.notes.length ?? 0}`);
  const moments = result.plan.moments.map((m) => `${m.kind} ${m.startBar}–${m.endBar}${m.kind === 'soli' && m.carrierTrackId ? ` (${project.tracks.find((t) => t.id === m.carrierTrackId)?.role ?? m.carrierTrackId})` : ''}`).join(', ');
  const lines: string[] = [];
  for (const bp of result.plan.bars) {
    const sec = bp.sectionName;
    if (lines.length && lines[lines.length - 1].startsWith(`${sec}: `)) continue;
    const brassBar = result.plan.brass.bars[bp.bar - 1];
    const kindsHere = new Set<string>();
    for (let b = bp.bar; b < bp.bar + 40; b++) {
      const bb = result.plan.brass.bars[b - 1];
      if (!bb || result.plan.bars[b - 1]?.sectionName !== sec) break;
      for (const [p, k] of Object.entries(bb.voices)) if (k) kindsHere.add(`${p}:${k}`);
    }
    const leadHere = result.plan.brass.leads.filter((l) => l.startBar >= bp.bar && l.startBar < bp.bar + 40).length;
    lines.push(`${sec}: ${[...kindsHere].join(', ') || 'no brass'}${leadHere ? `; brass lead ${leadHere}×` : ''}`);
  }
  console.log(`\n${templateId}:`);
  console.log('  sections: ' + lines.join(' | '));
  console.log('  brass notes: ' + counts.join(', '));
  console.log('  moments: ' + (moments || 'none'));
}

console.log('\n=== chorus energy mean/peak vs clamp, before (baseline) vs after (brass) ===');
for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']) {
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} } as Project['ensemble'])!;
  const short = templateId.replace('ensemble.', '');
  for (const [fixTag, doc] of [['three', THREE], ['dorian', DORIAN]] as const) {
    let beforeMean = 0, beforePeak = 0, afterMean = 0, afterPeak = 0, beforeN = 0, afterN = 0, beforeBelow = 0, afterBelow = 0;
    for (let take = 1; take <= 10; take++) {
      const { project } = compose(doc, templateId, take);
      const golden = JSON.parse(readFileSync(new URL(`../tests/golden-moments/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
      const beforeProject: Project = { ...project, tracks: project.tracks.map((t) => { const g = golden.tracks.find((x: { id: string }) => x.id === t.id); return g ? { ...t, notes: g.notes, cc: g.cc } : t; }) };
      const secOf = (bar: number) => (doc === THREE ? THREE.sections : DORIAN.sections).find((s: { startBar: number; lengthBars: number; name: string }) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
      for (const [rep, isAfter] of [[measureEnergy(beforeProject, template), false], [measureEnergy(project, template), true]] as const) {
        for (const w of rep.windows) {
          const sec = secOf(w.bar);
          if (!sec || !CHORUS.test(sec.name.trim().toLowerCase()) || w.noteCount === 0) continue;
          if (isAfter) { afterMean += w.energy; afterPeak = Math.max(afterPeak, w.energy); afterN++; if (w.energy < template.budget.energyClamp[0] - 1e-9) afterBelow++; }
          else { beforeMean += w.energy; beforePeak = Math.max(beforePeak, w.energy); beforeN++; if (w.energy < template.budget.energyClamp[0] - 1e-9) beforeBelow++; }
        }
      }
    }
    console.log(`${short} ${fixTag}: chorus mean ${(beforeMean / beforeN).toFixed(3)}→${(afterMean / afterN).toFixed(3)} (clamp max ${template.budget.energyClamp[1]}), peak ${beforePeak.toFixed(3)}→${afterPeak.toFixed(3)}, below-floor windows ${beforeBelow}/${beforeN}→${afterBelow}/${afterN}`);
  }
}

console.log('\n=== findings across six templates × takes 1–10 × both fixtures (moments on) ===');
const soft = new Map<string, number>();
let hard = 0;
for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio', 'ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
  for (const [_, doc] of [['three', THREE], ['dorian', DORIAN]] as const) {
    for (let take = 1; take <= 10; take++) {
      const { project, result } = compose(doc, templateId, take);
      const findings = checkTemplateRules(project, resolveTemplate({ templateId, overrides: {}, pins: {} } as Project['ensemble'])!, result.plan);
      for (const f of findings) {
        if (f.severity === 'hard') { hard++; console.log('HARD:', templateId, f.message); }
        if (f.severity === 'soft') soft.set(f.rule, (soft.get(f.rule) ?? 0) + 1);
      }
    }
  }
}
console.log('hard findings:', hard);
console.log('soft by rule:', [...soft.entries()].sort((a, b) => b[1] - a[1]).map(([r, c]) => `${r} ${c}`).join(', '));
void beatOffsets;
