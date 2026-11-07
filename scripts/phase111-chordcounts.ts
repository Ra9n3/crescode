/**
 * Phase 11.1 pre-flight addendum (read-only): the per-onset piano chord
 * voice counts at HEAD, per template — relief (chorus) vs non-relief
 * onsets. The new patterns must preserve these counts in harp-shared
 * windows (the energy headroom is zero on sonata/vocalbacking).
 *  npx vite-node scripts/phase111-chordcounts.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { barTicks, beatTicks } from '../src/shared/schema/meter';

const TEMPLATES = ['ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const secTypeAt = (bar: number): string => {
  const secs = [{ name: 'Verse', startBar: 1, lengthBars: 4 }, { name: 'Chorus', startBar: 5, lengthBars: 8 }, { name: 'Verse', startBar: 13, lengthBars: 4 }, { name: 'Chorus', startBar: 17, lengthBars: 8 }, { name: 'Bridge', startBar: 25, lengthBars: 4 }, { name: 'Chorus', startBar: 29, lengthBars: 8 }, { name: 'Outro', startBar: 37, lengthBars: 4 }];
  const s = secs.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
  return s ? s.name.toLowerCase() : '*';
};

for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const counts = new Map<string, Map<number, number>>(); // class -> (voices -> n)
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const { project, result } = compose(doc, templateId, take);
      const bt = barTicks(project.timeSignature);
      const beat = beatTicks(project.timeSignature);
      const piano = project.tracks.find((t) => t.role === 'piano');
      if (!piano) continue;
      const kindByBar = new Map<number, string>();
      for (const b of result.plan.keys.bars) if (b.voices.piano) kindByBar.set(b.bar, b.voices.piano);
      const byOnset = new Map<string, number>();
      for (const n of piano.notes) {
        const bar = Math.floor(n.startTick / bt) + 1;
        const kind = kindByBar.get(bar);
        if (kind !== 'comp') continue;
        const inBar = n.startTick - (bar - 1) * bt;
        const beatIdx = Math.floor(inBar / beat);
        const isChorus = secTypeAt(bar) === 'chorus' || (fixTag === 'dorian' && bar > 8);
        const cls = isChorus ? 'relief' : 'plain';
        const key = `${fixTag === 'three' ? bar : bar}:x${beatIdx}`;
        void key;
        const mKey = `${cls}`;
        const k = `${mKey}@${(bar - 1) * bt + beatIdx * beat}`;
        byOnset.set(k, (byOnset.get(k) ?? 0) + 1);
      }
      for (const [k, n] of byOnset) {
        const cls = k.startsWith('relief') ? 'relief' : 'plain';
        let m = counts.get(cls);
        if (!m) { m = new Map(); counts.set(cls, m); }
        m.set(n, (m.get(n) ?? 0) + 1);
      }
    }
  }
  const lines = [...counts.entries()].sort().map(([cls, m]) =>
    `  ${cls}: ${[...m.entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v}v×${n}`).join('  ')}`);
  console.log(`${short} (comp onsets, voices per onset):\n${lines.join('\n') || '  (none)'}`);
}
