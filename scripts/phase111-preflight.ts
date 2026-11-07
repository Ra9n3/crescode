/**
 * Phase 11.1 pre-flight (read-only): measures the piano's register and
 * variety at the baseline HEAD, over the full survey (6 templates ×
 * {three-chorus, dorian} × takes 1-10, moments on).
 *
 *  1. per template × piano role (comp / arp / pulse / tutti / final):
 *     note count, mean pitch, % of notes below MIDI 60;
 *  2. the pitch-bucket histogram per template (the vocal-zone fallback's
 *     effect: the 45-56 bucket is the down-shifted zone material);
 *  3. distinct piano tracks across takes 1-10, per template × fixture
 *     (stable JSON of the whole track);
 *  4. the strings' register per template (violas + cellosBasses: min /
 *     median / max over the survey) — calibrates the strings-register rule;
 *  5. the energy headroom per template (max window energy vs the clamp max)
 *     — calibrates the breach risk of new window-presence.
 *  npx vite-node scripts/phase111-preflight.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

interface RoleStat { n: number; pitchSum: number; below60: number }
const roleStats = new Map<string, Map<string, RoleStat>>();
const buckets = new Map<string, number[]>(); // <45, 45-56, 57-81, 82-96, >96
const statFor = (tpl: string, role: string): RoleStat => {
  let m = roleStats.get(tpl);
  if (!m) { m = new Map(); roleStats.set(tpl, m); }
  let s = m.get(role);
  if (!s) { s = { n: 0, pitchSum: 0, below60: 0 }; m.set(role, s); }
  return s;
};

const stringStats = new Map<string, { pitches: number[] }>();
const headroom = new Map<string, { maxE: number; clampMax: number }>();

for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  buckets.set(short, [0, 0, 0, 0, 0]);
  stringStats.set(short, { pitches: [] });
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const { project, result } = compose(doc, templateId, take);
      const bt = barTicks(project.timeSignature);
      const piano = project.tracks.find((t) => t.role === 'piano');
      if (piano) {
        const kindByBar = new Map<number, string>();
        for (const b of result.plan.keys.bars) if (b.voices.piano) kindByBar.set(b.bar, b.voices.piano);
        for (const n of piano.notes) {
          const bar = Math.floor(n.startTick / bt) + 1;
          const kind = kindByBar.get(bar) ?? 'unknown';
          const s = statFor(short, kind);
          s.n++; s.pitchSum += n.pitch;
          if (n.pitch < 60) s.below60++;
          const b = buckets.get(short)!;
          if (n.pitch < 45) b[0]++;
          else if (n.pitch < 57) b[1]++;
          else if (n.pitch < 82) b[2]++;
          else if (n.pitch <= 96) b[3]++;
          else b[4]++;
        }
      }
      for (const role of ['violas', 'cellosBasses']) {
        const t = project.tracks.find((x) => x.role === role);
        if (t) stringStats.get(short)!.pitches.push(...t.notes.map((n) => n.pitch));
      }
      const template = (await import('../src/config/ensembles')).resolveTemplate(project.ensemble)!;
      const rep = measureEnergy(project, template);
      const maxE = Math.max(...rep.windows.map((w) => w.energy));
      const h = headroom.get(short) ?? { maxE: 0, clampMax: template.budget.energyClamp[1] };
      h.maxE = Math.max(h.maxE, maxE);
      headroom.set(short, h);
    }
  }
}

console.log('=== 1. piano per template × role: n / mean pitch / % below 60 (survey, moments on) ===');
for (const [tpl, roles] of roleStats) {
  const lines = [...roles.entries()].sort().map(([role, s]) =>
    `  ${role}: n ${s.n}  mean ${s.n ? (s.pitchSum / s.n).toFixed(1) : '-'}  <60 ${(s.n ? (100 * s.below60) / s.n : 0).toFixed(1)}%`);
  console.log(`${tpl.replace('ensemble.', '')}:\n${lines.join('\n') || '  (no piano notes)'}`);
}

console.log('\n=== 2. piano pitch buckets per template: <45 / 45-56 / 57-81(zone) / 82-96 / >96 ===');
for (const [tpl, b] of buckets) {
  const total = b.reduce((a, x) => a + x, 0);
  const pct = b.map((x) => (total ? (100 * x / total).toFixed(1) : '0.0'));
  console.log(`${tpl}: n ${total}  [${pct.join('%, ')}%]`);
}

console.log('\n=== 3. distinct piano tracks across takes 1-10, per template × fixture ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const perFix: string[] = [];
  for (const [fixTag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const seen = new Set<string>();
    let hasPiano = false;
    for (let take = 1; take <= 10; take++) {
      const { project } = compose(doc, templateId, take);
      const t = project.tracks.find((x) => x.role === 'piano');
      if (!t) continue;
      hasPiano = true;
      seen.add(JSON.stringify({ notes: t.notes, cc: t.cc ?? null }));
    }
    perFix.push(`${fixTag}: ${hasPiano ? seen.size : 'no piano track'}`);
  }
  console.log(`${short}: ${perFix.join('  ')}`);
}

console.log('\n=== 4. strings register per template (violas + cellosBasses, survey) ===');
for (const [tpl, s] of stringStats) {
  if (!s.pitches.length) { console.log(`${tpl}: (no strings notes)`); continue; }
  const sorted = [...s.pitches].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const octave = 12 * Math.floor(med / 12);
  console.log(`${tpl}: min ${sorted[0]}  median ${med}  max ${sorted[sorted.length - 1]}  (median octave band ${octave}-${octave + 11})`);
}

console.log('\n=== 5. energy headroom per template (max window energy vs clamp max, survey) ===');
for (const [tpl, h] of headroom) {
  console.log(`${tpl}: max window energy ${h.maxE.toFixed(3)}  clamp max ${h.clampMax.toFixed(3)}  headroom ${(h.clampMax - h.maxE).toFixed(3)}`);
}
