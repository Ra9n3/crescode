/**
 * Phase 11.1 report numbers (read-only): the coverage list (who writes
 * each track), the soft findings + glissando counts, the pinned-contract
 * chorus allowance (moment-covered windows excluded on both sides, vs the
 * 63a82f8 control stash), the peaks against the clamp, and the take-1
 * pattern menus.
 *   npx vite-node scripts/phase111-report.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks, } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, isInstrumentTrack, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { isInBand } from '../src/shared/schema/band';
import { BRASS_PARTS } from '../src/orchestrator/brass/profile';
import { WIND_PARTS } from '../src/orchestrator/winds/profile';
import { PERC_PARTS } from '../src/orchestrator/percussion/profile';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const STASH = '/home/z/my-project/scratch/stash-63a82f8';

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

/* ---- 1. the coverage list (take 1 per template, three-chorus) ----------- */
console.log('=== coverage: every track and its writer (three-chorus take 1) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const { project, result } = compose(threeChorus, templateId, 1);
  const template = resolveTemplate(project.ensemble)!;
  const brass = new Set(template.roster.filter((r) => (BRASS_PARTS as readonly string[]).includes(r.role)).map((r) => r.role));
  const winds = new Set(template.roster.filter((r) => (WIND_PARTS as readonly string[]).includes(r.role)).map((r) => r.role));
  const perc = new Set(template.roster.filter((r) => (PERC_PARTS as readonly string[]).includes(r.role)).map((r) => r.role));
  const keys = new Set(template.roster.filter((r) => ['harp', 'piano'].includes(r.role)).map((r) => r.role));
  const stringsIds = new Set(result.stringsTrackIds);
  const lines: string[] = [];
  for (const t of project.tracks) {
    const inBand = isInBand(t.role, project.ensemble, template);
    const writer = stringsIds.has(t.id)
      ? 'engine (strings module)'
      : t.role === 'basses'
        ? 'engine (basses desk — the Phase 8.2 split; silence when it does not engage)'
        : brass.has(t.role) ? 'engine (brass module) + generator phantom feeds the window math'
          : winds.has(t.role) ? 'engine (winds module) + generator phantom feeds the window math'
            : perc.has(t.role) ? 'engine (percussion module) + generator phantom feeds the window math'
              : keys.has(t.role) ? 'engine (keys module) + generator phantom feeds the window math'
                : inBand ? 'generator'
                  : "untouched (out of band — the fixture's own notes stay)";
    const label = `${t.role}: ${writer}`;
    if (!lines.includes(label)) lines.push(label);
  }
  console.log(`${short} (${project.tracks.length} tracks):`);
  for (const l of lines) console.log(`  ${l}`);
}

/* ---- 2. soft findings + glissandos over takes 1-10 ----------------------- */
console.log('\n=== soft findings + glissandos (takes 1-10, both fixtures) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const findingCount = new Map<string, number>();
  let hard = 0;
  let glissThree = 0;
  let glissDorian = 0;
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const { project, result } = compose(doc, templateId, take);
      const template = resolveTemplate(project.ensemble)!;
      glissThree += fixTag === 'three' ? result.plan.keys.glisses.length : 0;
      glissDorian += fixTag === 'dorian' ? result.plan.keys.glisses.length : 0;
      for (const f of checkTemplateRules(project, template, result.plan)) {
        if (f.severity === 'hard') { hard++; continue; }
        const k = f.message.split(':')[0].slice(0, 60);
        findingCount.set(k, (findingCount.get(k) ?? 0) + 1);
      }
    }
  }
  const top = [...findingCount.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(`${short}: glissandos three ${glissThree} / dorian ${glissDorian} (over 10 takes each); hard ${hard}; most common soft: ${top ? `${top[1]}× "${top[0]}"` : 'none'}${findingCount.size ? ` (${findingCount.size} kinds)` : ''}`);
}

/* ---- 3. the pinned-contract chorus allowance (live vs the 63a82f8 stash) - */
console.log('\n=== pinned-contract chorus (moment-covered windows excluded BOTH sides; live vs the 63a82f8 control) ===');
const secTypeAt = (bar: number): string => {
  const secs = [{ name: 'Verse', startBar: 1, lengthBars: 4 }, { name: 'Chorus', startBar: 5, lengthBars: 8 }, { name: 'Verse', startBar: 13, lengthBars: 4 }, { name: 'Chorus', startBar: 17, lengthBars: 8 }, { name: 'Bridge', startBar: 25, lengthBars: 4 }, { name: 'Chorus', startBar: 29, lengthBars: 8 }, { name: 'Outro', startBar: 37, lengthBars: 4 }];
  const s = secs.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
  return s ? s.name.toLowerCase() : '*';
};
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  let bSum = 0, aSum = 0, excludedWindows = 0, chorusWindows = 0, bBelow = 0, aBelow = 0;
  for (let take = 1; take <= 10; take++) {
    const g = JSON.parse(readFileSync(`${STASH}/vocalbacking-three-t1.json`.replace('vocalbacking', short).replace('t1', `t${take}`), 'utf8'));
    const momentBars = new Set<number>();
    for (const m of g.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
    const base = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    // the before side carries the STASH'S FULL track list (the fixture
    // tracks + the engine-inserted desks) so the reading is symmetric
    const stashById = new Map<string, { role: string; notes: { pitch: number; startTick: number; durationTicks: number; velocity: number }[] }>(g.tracks.map((t: { id: string; role: string; notes: never[] }) => [t.id, t]));
    const beforeTracks = base.tracks.map((x) => ({ ...x, notes: stashById.get(x.id)?.notes ?? [], cc: undefined }));
    const shape = base.tracks.find((t) => isInstrumentTrack(t))!;
    for (const st of stashById.values()) {
      if (beforeTracks.some((x) => x.id === (st as unknown as { id: string }).id)) continue;
      beforeTracks.push({ ...shape, id: (st as unknown as { id: string }).id, role: (st as unknown as { role: string }).role, name: (st as unknown as { role: string }).role, notes: (st as unknown as { notes: never[] }).notes, cc: undefined, locked: false });
    }
    const before: Project = { ...base, tracks: beforeTracks } as Project;
    const { project } = compose(threeChorus, templateId, take);
    const chorus = (proj: Project) => {
      const rep = measureEnergy(proj, template);
      let sum = 0, n = 0, below = 0;
      for (const w of rep.windows) {
        if (secTypeAt(w.bar) !== 'chorus') continue;
        chorusWindows += 1;
        if (momentBars.has(w.bar)) { excludedWindows += 1; continue; }
        sum += w.energy; n++;
        if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) below++;
      }
      return { sum, below };
    };
    const b = chorus(before);
    const a = chorus(project);
    bSum += b.sum; aSum += a.sum;
    bBelow += b.below; aBelow += a.below;
  }
  console.log(`${short}: excl-moments chorus sum (10 takes) ${bSum.toFixed(1)} -> ${aSum.toFixed(1)} (${((aSum - bSum) / bSum * 100).toFixed(2)}%); below-floor ${bBelow} -> ${aBelow}; excluded ${excludedWindows} moment-covered of ${chorusWindows} chorus window-readings (10 takes × 24 chorus windows)`);
}

/* ---- 4. the peaks against the clamp (post-change survey) ----------------- */
console.log('\n=== peaks vs the clamp max (takes 1-10, both fixtures) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  let maxE = 0;
  let clampMax = 0;
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    void fixTag;
    for (let take = 1; take <= 10; take++) {
      const { project } = compose(doc, templateId, take);
      const template = resolveTemplate(project.ensemble)!;
      clampMax = template.budget.energyClamp[1];
      const rep = measureEnergy(project, template);
      maxE = Math.max(maxE, ...rep.windows.map((w) => w.energy));
    }
  }
  console.log(`${short}: peak window energy ${maxE.toFixed(3)} vs clamp max ${clampMax.toFixed(3)} (headroom ${(clampMax - maxE).toFixed(3)})`);
}

/* ---- 5. the take-1 pattern menus ----------------------------------------- */
console.log('\n=== the drawn piano menu, take 1 (three-chorus | dorian) ===');
for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
  const short = templateId.replace('ensemble.', '');
  const menus: string[] = [];
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const { result } = compose(doc, templateId, 1);
    menus.push(`${fixTag}: ${result.plan.keys.pianoPatterns.map((e) => `b${e.startBar}=${e.pattern}`).join(', ')}`);
  }
  console.log(`${short}: ${menus.join('  |  ')}`);
}
