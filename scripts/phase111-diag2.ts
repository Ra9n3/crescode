/**
 * Phase 11.1 dry-run diagnosis 2 (read-only): prints the harp plan kinds,
 * norms and full note records for the affected vocalbacking bars.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { readFileSync } from 'node:fs';
import { barTicks, beatTicks } from '../src/shared/schema/meter';

const templateId = 'ensemble.vocalbacking';

const compose = (doc: unknown, tid: string, tk: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId: tid, overrides: {}, pins: {} };
  p.orchestration = { take: tk };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const stash = JSON.parse(readFileSync('/home/z/my-project/scratch/stash-63a82f8/vocalbacking-three-t1.json', 'utf8'));
const { project, result } = compose(threeChorus, templateId, 1);
const bt = barTicks(project.timeSignature);
const beat = beatTicks(project.timeSignature);
console.log(`barTicks ${bt} beatTicks ${beat} PPQ ${project.tracks[0] ? 'n/a' : ''}`);

for (const bar of [20, 22, 24]) {
  const planBar = result.plan.keys.bars.find((b) => b.bar === bar);
  console.log(`bar ${bar}: level ${planBar?.level} norm ${planBar?.norm?.toFixed(3)} voices ${JSON.stringify(planBar?.voices)} moment ${planBar?.moment ?? '-'}`);
  const s = (bar - 1) * bt;
  const e = bar * bt;
  const liveHarp = project.tracks.find((t) => t.role === 'harp')!.notes.filter((n) => n.startTick >= s && n.startTick < e);
  const stashHarp = stash.tracks.find((t: { role: string }) => t.role === 'harp').notes.filter((n: any) => n.startTick >= s && n.startTick < e);
  const fmt = (ns: any[]) => ns.map((n) => `p${n.pitch}@${n.startTick - s}d${n.durationTicks}v${n.velocity}`).join(' ');
  console.log(`  stash harp [${fmt(stashHarp)}]`);
  console.log(`  live  harp [${fmt(liveHarp)}]`);
}
console.log(`moments: ${JSON.stringify(result.plan.moments.filter((m) => m.endBar >= 19 && m.startBar <= 25))}`);
console.log(`sections: ${JSON.stringify(project.sections.filter((s) => s.startBar <= 24 && s.startBar + s.lengthBars > 19))}`);
