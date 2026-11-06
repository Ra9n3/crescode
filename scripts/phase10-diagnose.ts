/** Diagnostic: where does the chorus mean drop come from (golden96 vs now)? */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { readFileSync } from 'node:fs';

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { p: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};
const isChorusBar = (bar: number): boolean => [5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20, 21, 22, 23, 24, 29, 30, 31, 32, 33, 34, 35, 36].includes(bar);

for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']) {
  const beforeWindows: { energy: number; roles: string[] }[] = [];
  const afterWindows: { energy: number; roles: string[] }[] = [];
  for (let take = 1; take <= 10; take++) {
    // before: the golden96 capture (post-9 HEAD)
    const g = JSON.parse(readFileSync(new URL(`../tests/golden96/${templateId.replace('ensemble.', '')}-three-t${take}.json`, import.meta.url), 'utf8'));
    const pb: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    pb.ensemble = { templateId, overrides: {}, pins: {} };
    pb.orchestration = { take };
    pb.tracks = pb.tracks.map((t) => {
      const gt = g.tracks.find((x: { id: string }) => x.id === t.id);
      return gt ? { ...t, notes: gt.notes } : t;
    });
    const rb = measureEnergy(pb, pb.ensemble ? (await import('../src/config/ensembles')).resolveTemplate(pb.ensemble)! : null as never);
    for (const w of rb.windows) if (isChorusBar(w.bar)) beforeWindows.push({ energy: w.energy, roles: w.soundingRoles });
    // after: the live compose
    const { p: pa } = compose(threeChorus, templateId, take);
    const ra = measureEnergy(pa, (await import('../src/config/ensembles')).resolveTemplate(pa.ensemble)!);
    for (const w of ra.windows) if (isChorusBar(w.bar)) afterWindows.push({ energy: w.energy, roles: w.soundingRoles });
  }
  const mean = (ws: { energy: number }[]) => ws.reduce((a, w) => a + w.energy, 0) / Math.max(1, ws.length);
  console.log(`\n${templateId}: chorus mean ${mean(beforeWindows).toFixed(3)} -> ${mean(afterWindows).toFixed(3)}  (windows ${beforeWindows.length}/${afterWindows.length})`);
  // role presence delta
  const presence = (ws: { roles: string[] }[]) => {
    const m = new Map<string, number>();
    for (const w of ws) for (const r of w.roles) m.set(r, (m.get(r) ?? 0) + 1);
    return m;
  };
  const pb2 = presence(beforeWindows), pa2 = presence(afterWindows);
  const roles = [...new Set([...pb2.keys(), ...pa2.keys()])].sort();
  for (const r of roles) {
    const b = pb2.get(r) ?? 0, a = pa2.get(r) ?? 0;
    if (Math.abs(a - b) > beforeWindows.length * 0.01) console.log(`  ${r}: ${((b / beforeWindows.length) * 100).toFixed(0)}% -> ${((a / afterWindows.length) * 100).toFixed(0)}% of chorus windows`);
  }
}
