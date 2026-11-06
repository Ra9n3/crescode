// Phase 10.2 probe: what the pre-chorus bars carry at HEAD (post-10.1),
// plus the chorus mean / below-floor baseline per template.
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { barTicks } from '../src/shared/schema/meter';
import { projectFromFixture } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';

const PERC_TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const PERC_ROLES = ['timpani', 'snare', 'cymbals', 'aux'];
const THREE = () => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
const DORIAN = () => projectFromFixture(JSON.parse(JSON.stringify(dorian)));
const composeTake = (base, templateId, take) => {
  const p = base;
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11, moments: true });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration }, result };
};
const secsOf = (fixture) => fixture === 'three'
  ? [{ name: 'Verse', startBar: 1, lengthBars: 4 }, { name: 'Chorus', startBar: 5, lengthBars: 8 }, { name: 'Verse', startBar: 13, lengthBars: 4 }, { name: 'Chorus', startBar: 17, lengthBars: 8 }, { name: 'Bridge', startBar: 25, lengthBars: 4 }, { name: 'Chorus', startBar: 29, lengthBars: 8 }, { name: 'Outro', startBar: 37, lengthBars: 4 }]
  : [{ name: 'Verse', startBar: 1, lengthBars: 8 }, { name: 'Chorus', startBar: 9, lengthBars: 8 }];
const preChorusBarsOf = (fixture) => (fixture === 'three' ? [4, 16, 28] : [8]);
const chorusBarsOf = (fixture) => (fixture === 'three' ? [5,17,18,19,20,21,22,23,24, 17,18,19,20,21,22,23,24, 29,30,31,32,33,34,35,36] : [9,10,11,12,13,14,15,16]);
const chorusWinBars = (fixture) => (fixture === 'three' ? [5,6,7,8,9,10,11,12,17,18,19,20,21,22,23,24,29,30,31,32,33,34,35,36] : [9,10,11,12,13,14,15,16]);

let roll16Bars = 0, swellBars = 0, noteCounts = {};
for (const templateId of PERC_TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  for (const [fixTag, base] of [['three', THREE], ['dorian', DORIAN]]) {
    for (let take = 1; take <= 10; take++) {
      const { project, result } = composeTake(base(), templateId, take);
      const btBar = barTicks(project.timeSignature);
      for (const bar of preChorusBarsOf(fixTag)) {
        const planBar = result.plan.percussion.bars[bar - 1];
        const soli = result.plan.moments.some((m) => m.kind === 'soli' && bar >= m.startBar && bar <= m.endBar);
        const roll = result.plan.percussion.rolls.find((r) => bar >= r.startBar && bar < r.targetBar);
        const swell = result.plan.percussion.crashes.some((c) => c.swell && c.bar === bar + 1);
        const sounding = {};
        for (const role of PERC_ROLES) {
          const t = project.tracks.find((x) => x.role === role);
          const inBar = (t?.notes ?? []).filter((n) => n.startTick >= (bar - 1) * btBar && n.startTick < bar * btBar);
          if (inBar.length) sounding[role] = inBar.length;
        }
        const key = `${short} ${fixTag} t${take} b${bar}`;
        console.log(`${key}: soli=${soli} kinds=[${Object.entries(planBar?.voices ?? {}).map(([p,k])=>`${p}:${k}`).join(',') || '-'}] roll=${roll ? `${roll.part} b${roll.startBar}->${roll.targetBar}` : '-'} swellBefore=${swell} sounding=${JSON.stringify(sounding)}`);
        if (roll && !soli) roll16Bars++;
        if (swell && !soli) swellBars++;
        for (const [r, c] of Object.entries(sounding)) noteCounts[r] = (noteCounts[r] ?? 0) + c;
      }
    }
  }
}
console.log(`\nnon-soli pre-chorus bars with roll coverage: ${roll16Bars}, with swell: ${swellBars}`);
console.log(`sounding note totals on pre-chorus bars at HEAD: ${JSON.stringify(noteCounts)}`);

// chorus stats at HEAD (before 10.2) — same metric as the phase10 test
console.log('\nchorus stats at HEAD (10 takes, three fixture):');
for (const templateId of PERC_TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} });
  const clampFloor = template.budget.energyClamp[0];
  let mean = 0, n = 0, below = 0;
  for (let take = 1; take <= 10; take++) {
    const { project } = composeTake(THREE(), templateId, take);
    const report = measureEnergy(project, template);
    for (const w of report.windows) {
      if (!chorusWinBars('three').includes(w.bar)) continue;
      mean += w.energy; n++;
      if (w.energy > 0 && w.energy < clampFloor) below++;
    }
  }
  console.log(`${short}: chorus mean ${(mean / n).toFixed(4)}, below-floor ${below} (windows ${n})`);
}
