/**
 * Phase 11.5 byte gate — the non-piano, non-harp tracks must be
 * byte-identical to golden104 in all six templates × both fixtures ×
 * takes 1-10 (the keys family may move — the harp figures and the piano
 * figuration are the phase's own change). The cinematic and hybridstudio
 * PIANO is also probed: the pitch/startTick/durationTicks/articulation/
 * layer fields must match golden104 exactly (a velocity-only allowance),
 * and the velocity delta is reported.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const stableTrack = (t: { id: string; role: string; notes: unknown; cc?: unknown }) =>
  JSON.stringify({ id: t.id, role: t.role, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) });

let failures = 0;
const velStats = new Map<string, { n: number; sum: number; max: number; up: number }>();
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
      p.ensemble = { templateId, overrides: {}, pins: {} };
      p.orchestration = { take };
      const result = composeAllTracks(p, { seed: 11 });
      const project = { ...p, tracks: result.tracks } as Project;
      const golden = JSON.parse(readFileSync(new URL(`../tests/golden104/${short}-${fixTag}-t${take}.json`, import.meta.url), 'utf8'));
      const keysRoles = new Set(['piano', 'harp']);
      const goldenTracks = golden.tracks.filter((t: { role: string }) => !keysRoles.has(t.role));
      const current = project.tracks.filter((t: { role: string }) => !keysRoles.has(t.role));
      const a = current.map(stableTrack);
      const b = goldenTracks.map(stableTrack);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        failures++;
        console.log(`FAIL ${short}-${fixTag}-t${take}: a non-keys track moved`);
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
            for (let j = 0; j < n && shown < 4; j++) {
              const x = na[j]; const y = nb[j];
              const d: string[] = [];
              if (x.pitch !== y.pitch) d.push(`pitch ${y.pitch}->${x.pitch}`);
              if (x.startTick !== y.startTick) d.push(`start ${y.startTick}->${x.startTick}`);
              if (x.durationTicks !== y.durationTicks) d.push(`dur ${y.durationTicks}->${x.durationTicks}`);
              if (x.velocity !== y.velocity) d.push(`vel ${y.velocity}->${x.velocity}`);
              if (d.length) { console.log(`  note ${j}: ${d.join(', ')}`); shown++; }
            }
          }
        }
      }
      // the cinematic/hybridstudio piano probe (velocity-only allowance)
      if (templateId === 'ensemble.cinematic' || templateId === 'ensemble.hybridstudio') {
        const goldPiano = golden.tracks.find((t: { role: string }) => t.role === 'piano');
        const livePiano = project.tracks.find((t: { role: string }) => t.role === 'piano');
        if (goldPiano && livePiano) {
          const gn = goldPiano.notes as typeof livePiano.notes;
          const ln = livePiano.notes;
          if (gn.length !== ln.length) {
            failures++;
            console.log(`FAIL ${short}-${fixTag}-t${take}: the piano note count moved (${gn.length} -> ${ln.length})`);
          } else {
            let velN = 0; let velSum = 0; let velMax = 0; let velUp = 0;
            for (let j = 0; j < gn.length; j++) {
              const x = ln[j]; const y = gn[j];
              if (x.pitch !== y.pitch || x.startTick !== y.startTick || x.durationTicks !== y.durationTicks || (x.articulation ?? '') !== (y.articulation ?? '') || (x.layer ?? '') !== (y.layer ?? '')) {
                failures++;
                console.log(`FAIL ${short}-${fixTag}-t${take}: the piano moved beyond velocity at note ${j}: ${JSON.stringify({ y, x })}`);
                break;
              }
              if (x.velocity !== y.velocity) { velN++; velSum += Math.abs(x.velocity - y.velocity); velMax = Math.max(velMax, Math.abs(x.velocity - y.velocity)); if (x.velocity > y.velocity) velUp++; }
            }
            if (velN) {
              const key = `${short}`;
              const s = velStats.get(key) ?? { n: 0, sum: 0, max: 0, up: 0 };
              s.n += velN; s.sum += velSum; s.max = Math.max(s.max, velMax); s.up += velUp;
              velStats.set(key, s);
            }
          }
        }
      }
    }
  }
}
console.log(failures === 0 ? 'BYTE GATE: clean — every non-keys track is byte-identical to golden104' : `BYTE GATE: ${failures} failures`);
for (const [k, s] of velStats) {
  console.log(`${k} piano velocity-only delta: ${s.n} notes, mean |dv| ${(s.sum / s.n).toFixed(2)}, max ${s.max}, ${s.up} raised / ${s.n - s.up} lowered`);
}
if (!velStats.size) console.log('cinematic/hybridstudio piano: byte-identical to golden104 (no velocity delta)');
