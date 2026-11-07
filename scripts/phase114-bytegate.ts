/**
 * Phase 11.4: the byte gate — every NON-PIANO track (harp included) in all
 * six templates × both fixtures × takes 1-10 must be byte-identical to
 * golden103. Also prints the per-template non-chorus piano note counts
 * (before = golden103, after = live) and the cinematic/hybridstudio piano
 * pin (their piano must NOT move either).
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';
import { isChorusTypeK } from '../src/orchestrator/keys/profile';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const stableTrack = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
  JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });

let failures = 0;
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
      p.ensemble = { templateId, overrides: {}, pins: {} };
      p.orchestration = { take };
      const result = composeAllTracks(p, { seed: 11 });
      const project = { ...p, tracks: result.tracks } as Project;
      const golden = JSON.parse(readFileSync(new URL(`../tests/golden103/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
      const goldenTracks = golden.tracks.filter((t: { role: string }) => t.role !== 'piano');
      const current = project.tracks.filter((t) => t.role !== 'piano');
      const a = current.map(stableTrack);
      const b = goldenTracks.map(stableTrack);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        failures++;
        console.log(`FAIL ${short}-${fixTag}-t${take}: a non-piano track moved`);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          if (a[i] !== b[i]) {
            const role = current[i]?.role ?? goldenTracks[i]?.role ?? '?';
            console.log(`  track ${i} role=${role}`);
            if (a[i] === undefined || b[i] === undefined) { console.log('  track list mismatch'); continue; }
            const na = JSON.parse(a[i]).notes as { pitch: number; startTick: number; durationTicks: number; velocity: number; layer?: string; articulation?: string }[];
            const nb = JSON.parse(b[i]).notes as typeof na[];
            console.log(`  notes: live ${na.length} vs golden ${nb.length}`);
            const n = Math.min(na.length, nb.length);
            let shown = 0;
            for (let j = 0; j < n && shown < 6; j++) {
              const x = na[j]; const y = nb[j];
              const d: string[] = [];
              if (x.pitch !== y.pitch) d.push(`pitch ${y.pitch}->${x.pitch}`);
              if (x.startTick !== y.startTick) d.push(`start ${y.startTick}->${x.startTick}`);
              if (x.durationTicks !== y.durationTicks) d.push(`dur ${y.durationTicks}->${x.durationTicks}`);
              if (x.velocity !== y.velocity) d.push(`vel ${y.velocity}->${x.velocity}`);
              if ((x.layer ?? '') !== (y.layer ?? '')) d.push(`layer ${y.layer ?? '-'}->${x.layer ?? '-'}`);
              if (d.length) { console.log(`  note ${j}: ${d.join(', ')}`); shown++; }
            }
          }
        }
      }
    }
  }
  // the piano-side stats (non-chorus notes per run) + the cinematic/hybrid piano pin
  const perRun: number[] = [];
  let pianoPinsHold = true;
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
      p.ensemble = { templateId, overrides: {}, pins: {} };
      p.orchestration = { take };
      const result = composeAllTracks(p, { seed: 11 });
      const project = { ...p, tracks: result.tracks } as Project;
      const golden = JSON.parse(readFileSync(new URL(`../tests/golden103/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
      const piano = project.tracks.find((t) => t.role === 'piano');
      const goldPiano = golden.tracks.find((t: { role: string }) => t.role === 'piano');
      if (['ensemble.cinematic', 'ensemble.hybridstudio', 'ensemble.symphony'].includes(templateId)) {
        if (JSON.stringify(piano?.notes ?? []) !== JSON.stringify(goldPiano?.notes ?? [])) pianoPinsHold = false;
      }
      const btBar = barTicks(project.timeSignature);
      const plan = result.plan.keys;
      let nc = 0;
      const bars = plan.bars.length;
      for (const n of piano?.notes ?? []) {
        const bar = Math.min(bars, Math.max(1, Math.floor(n.startTick / btBar) + 1));
        const sec = (doc as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        if (sec && !isChorusTypeK(sec.name)) nc++;
      }
      perRun.push(nc);
    }
  }
  const avg = perRun.reduce((a, b) => a + b, 0) / perRun.length;
  console.log(`${short}: non-chorus piano notes/run ${avg.toFixed(2)} (was golden103)${['ensemble.cinematic', 'ensemble.hybridstudio', 'ensemble.symphony'].includes(templateId) ? ` | piano pin vs golden103: ${pianoPinsHold ? 'HOLDS' : 'MOVED'}` : ''}`);
}
console.log(failures === 0 ? `\nBYTE GATE: all non-piano tracks identical to golden103 (120 runs)` : `\nBYTE GATE: ${failures} FAILURES`);
