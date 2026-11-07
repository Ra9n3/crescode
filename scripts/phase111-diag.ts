/**
 * Phase 11.1 dry-run diagnosis (read-only): diffs the vocalbacking harp
 * track (stash vs live) and prints every velocity-changed note with its
 * bar/beat, plus the piano's notes in the same windows (stash vs live).
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { readFileSync } from 'node:fs';
import { barTicks, beatTicks } from '../src/shared/schema/meter';

const templateId = 'ensemble.vocalbacking';
const take = 1;

const compose = (doc: unknown, tid: string, tk: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId: tid, overrides: {}, pins: {} };
  p.orchestration = { take: tk };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const stash = JSON.parse(readFileSync('/home/z/my-project/scratch/stash-63a82f8/vocalbacking-three-t1.json', 'utf8'));
const { project } = compose(threeChorus, templateId, take);
const bt = barTicks(project.timeSignature);
const beat = beatTicks(project.timeSignature);

const stashHarp = stash.tracks.find((t: { role: string }) => t.role === 'harp')!.notes;
const liveHarp = project.tracks.find((t) => t.role === 'harp')!.notes;
const stashPiano = stash.tracks.find((t: { role: string }) => t.role === 'piano')!.notes;
const livePiano = project.tracks.find((t) => t.role === 'piano')!.notes;

const key = (n: { pitch: number; startTick: number; durationTicks: number }) => `${n.startTick}|${n.pitch}|${n.durationTicks}`;
const stashMap = new Map(stashHarp.map((n: any) => [key(n), n.velocity]));

console.log('== harp velocity changes (stash -> live) ==');
let shown = 0;
for (const n of liveHarp) {
  const old = stashMap.get(key(n));
  if (old !== undefined && old !== n.velocity) {
    const bar = Math.floor(n.startTick / bt) + 1;
    const b = Math.floor((n.startTick - (bar - 1) * bt) / beat) + 1;
    console.log(`  bar ${bar} beat ${b} pitch ${n.pitch} v ${old} -> ${n.velocity}`);
    if (++shown >= 12) break;
  }
}
const totalChanged = liveHarp.filter((n) => stashMap.get(key(n)) !== undefined && stashMap.get(key(n)) !== n.velocity).length;
const structural = liveHarp.filter((n) => !stashMap.has(key(n))).length;
console.log(`(total changed ${totalChanged}, structural new ${structural}, stash harp ${stashHarp.length}, live harp ${liveHarp.length})`);

const changedBars = new Set(liveHarp.filter((n) => stashMap.get(key(n)) !== undefined && stashMap.get(key(n)) !== n.velocity).map((n) => Math.floor(n.startTick / bt) + 1));
console.log(`\n== piano in the affected bars (${[...changedBars].slice(0, 6).join(',')}) ==`);
for (const bar of [...changedBars].slice(0, 4)) {
  const s = (bar - 1) * bt;
  const e = bar * bt;
  const sp = stashPiano.filter((n: any) => n.startTick >= s && n.startTick < e);
  const lp = livePiano.filter((n) => n.startTick >= s && n.startTick < e);
  const fmt = (ns: any[]) => ns.map((n) => `p${n.pitch}@${n.startTick - s}v${n.velocity}${(n as any).layer ? 'k' : ''}`).join(' ');
  console.log(`  bar ${bar}: stash [${fmt(sp)}]`);
  console.log(`          live  [${fmt(lp)}]`);
}
