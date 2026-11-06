/**
 * Phase 11.2 dry-run harness (read-only — the phase STOPPED at the dry run;
 * see the phase report). Run at the clean pre-11.2 HEAD it is the CONTROL:
 * the live bytes equal golden102 on every non-keys track (the Phase 11
 * pins), so the non-keys rows print zero and the harness proves itself.
 * The KEYS rows vs golden102 show Phase 11's OWN changes (golden102 was
 * captured at the post-10.2 HEAD, before the keys module existed) — they
 * are NOT 11.2 deltas. The measured 11.2 cleanup deltas (out of bounds —
 * the stop reason) were taken on the stopped WIP tree against a
 * stashed-tree capture at this HEAD and live in the phase report.
 * Prints per track:
 *  - the notes-changed count (structural: length/alignment mismatches);
 *  - WHICH field changed (pitch / startTick / durationTicks / articulation /
 *    velocity / layer) over 1:1 aligned notes;
 *  - the velocity delta (mean absolute, max) over aligned notes;
 *  - a CC-bytes-changed flag.
 * Then the decision gates: the per-track delta bounds (mean ≤ 3, max ≤ 10,
 * velocity-only), the chorus mean drop ≤ 1% per template, the below-floor
 * counts, zero aboveMax and the hard findings.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];

interface GTrack { id: string; role: string; notes: Note[]; cc?: unknown }
interface Golden { templateId: string; fixture: string; take: number; tracks: GTrack[] }

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

interface TrackStat { role: string; notes: number; lenMismatch: boolean; fields: Set<string>; velSum: number; velN: number; velMax: number; ccChanged: boolean }
const perTemplate = new Map<string, Map<string, TrackStat>>();
const noteKey = (n: Note): string => `${n.startTick}|${n.pitch}|${n.durationTicks}|${n.articulation ?? ''}`;

let structuralFails = 0;
const statFor = (templateId: string, role: string): TrackStat => {
  let m = perTemplate.get(templateId);
  if (!m) { m = new Map(); perTemplate.set(templateId, m); }
  let s = m.get(role);
  if (!s) { s = { role, notes: 0, lenMismatch: false, fields: new Set(), velSum: 0, velN: 0, velMax: 0, ccChanged: false }; m.set(role, s); }
  return s;
};

for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const g: Golden = JSON.parse(readFileSync(new URL(`../tests/golden102/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
      const { project } = compose(doc, templateId, take);
      const gById = new Map(g.tracks.map((t) => [t.id, t]));
      for (const t of project.tracks) {
        if (!gById.has(t.id)) continue; // structural (added/removed) tracks cannot appear — ids are stable
        const gt = gById.get(t.id)!;
        const s = statFor(templateId, t.role);
        const a = [...t.notes].sort((x, y) => x.startTick - y.startTick || x.pitch - y.pitch || x.durationTicks - y.durationTicks);
        const b = [...gt.notes].sort((x, y) => x.startTick - y.startTick || x.pitch - y.pitch || x.durationTicks - y.durationTicks);
        if (a.length !== b.length) { s.lenMismatch = true; s.notes += Math.abs(a.length - b.length); structuralFails++; continue; }
        for (let i = 0; i < a.length; i++) {
          const x = a[i], y = b[i];
          if (x.pitch !== y.pitch) s.fields.add('pitch');
          if (x.startTick !== y.startTick) s.fields.add('startTick');
          if (x.durationTicks !== y.durationTicks) s.fields.add('durationTicks');
          if ((x.articulation ?? '') !== (y.articulation ?? '')) s.fields.add('articulation');
          if (x.layer !== undefined || y.layer !== undefined) {
            if (JSON.stringify(x.layer ?? null) !== JSON.stringify(y.layer ?? null)) s.fields.add('layer');
          }
          if (x.velocity !== y.velocity) {
            s.fields.add('velocity');
            const d = Math.abs(x.velocity - y.velocity);
            s.velSum += d; s.velN++; s.velMax = Math.max(s.velMax, d);
          }
        }
        if (JSON.stringify(t.cc ?? null) !== JSON.stringify(gt.cc ?? null)) s.ccChanged = true;
      }
    }
  }
}

console.log('=== dry run vs golden102: per template × track (10 takes aggregated) ===');
let worstMean = 0, worstMax = 0, worstMeanRole = '', worstMaxRole = '';
const nonVelocity = new Set<string>();
for (const [templateId, tracks] of perTemplate) {
  const short = templateId.replace('ensemble.', '');
  const lines: string[] = [];
  for (const s of [...tracks.values()].sort((x, y) => x.role.localeCompare(y.role))) {
    const mean = s.velN ? s.velSum / s.velN : 0;
    if (mean > worstMean) { worstMean = mean; worstMeanRole = `${short}/${s.role}`; }
    if (s.velMax > worstMax) { worstMax = s.velMax; worstMaxRole = `${short}/${s.role}`; }
    for (const f of s.fields) if (f !== 'velocity') nonVelocity.add(`${short}/${s.role}:${f}`);
    if (s.lenMismatch) nonVelocity.add(`${short}/${s.role}:length`);
    if (s.ccChanged) nonVelocity.add(`${short}/${s.role}:cc`);
    if (!s.velN && !s.lenMismatch && !s.ccChanged && s.fields.size === 0) continue;
    lines.push(`  ${s.role}: notesΔ ${s.velN}${s.lenMismatch ? ` (+${s.notes} STRUCTURAL)` : ''} fields {${[...s.fields].join(',')}} vel mean|Δ| ${mean.toFixed(2)} max ${s.velMax}${s.ccChanged ? ' CC-CHANGED' : ''}`);
  }
  console.log(`${short}:\n${lines.join('\n') || '  (no changes)'}`);
}
console.log(`\nworst per-track mean |Δv|: ${worstMean.toFixed(2)} (${worstMeanRole})   worst max: ${worstMax} (${worstMaxRole})`);
console.log(`non-velocity changes: ${nonVelocity.size ? [...nonVelocity].join(', ') : 'NONE'}`);

console.log('\n=== chorus mean / below-floor vs golden102 (all-windows, takes 1-10 aggregated) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const clamp = template.budget.energyClamp;
  const chorusStats = (proj: Project) => {
    const report = measureEnergy(proj, template);
    let mean = 0, n = 0, below = 0;
    for (const w of report.windows) {
      if (secTypeAt(w.bar) !== 'chorus') continue;
      mean += w.energy; n++;
      if (w.energy > 0 && w.energy < clamp[0]) below++;
    }
    return { mean: mean / Math.max(1, n), below };
  };
  let bMean = 0, aMean = 0, bBelow = 0, aBelow = 0, dropped = 0;
  for (let take = 1; take <= 10; take++) {
    const g: Golden = JSON.parse(readFileSync(new URL(`../tests/golden102/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
    const base: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    const beforeProj: Project = { ...base, tracks: base.tracks.map((x) => ({ ...x, notes: (g.tracks.find((y) => y.id === x.id)?.notes ?? []) })) };
    const b = chorusStats(beforeProj);
    const { project } = compose(threeChorus, templateId, take);
    const a = chorusStats(project);
    bMean += b.mean; aMean += a.mean; bBelow += b.below; aBelow += a.below;
    if (a.mean < b.mean) dropped++;
  }
  const pct = ((aMean - bMean) / bMean * 100).toFixed(2);
  console.log(`${short}: chorus mean ${(bMean / 10).toFixed(3)} -> ${(aMean / 10).toFixed(3)} (${pct}%)  below-floor ${bBelow} -> ${aBelow}  (takes dropped: ${dropped}/10)`);
}

console.log('\n=== clamp + findings (survey, 6 templates × both fixtures × takes 1-10/1-6) ===');
let hard = 0, aboveMax = 0;
for (const templateId of TEMPLATES) {
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const maxTake = fixTag === 'three' ? 10 : 6;
    for (let take = 1; take <= maxTake; take++) {
      const { project, result } = compose(doc, templateId, take);
      const template = resolveTemplate(project.ensemble)!;
      const rep = measureEnergy(project, template);
      aboveMax += rep.windows.filter((w) => w.energy > template.budget.energyClamp[1] + 1e-9).length;
      const findings = checkTemplateRules(project, template, result.plan);
      for (const f of findings) if (f.severity === 'hard') { hard++; console.log(`HARD ${templateId} ${fixTag} t${take}: ${f.message}`); }
    }
  }
}
console.log(`hard findings: ${hard}   windows above clamp max: ${aboveMax}   structural track fails: ${structuralFails}`);
