/**
 * Phase 11.4 pre-flight (read-only survey, compose only — no source or
 * golden changes). Answers the four pre-flight questions from the phase
 * spec before anything changes:
 *   1. the exact comping gate (threshold, fraction of the clamp, what it
 *      reads) and the distribution of energy (norm = arc target / clamp max)
 *      at NON-CHORUS phrase starts and fill bars per template, with the
 *      per-run counts and how many the gate blocks;
 *   2. where the non-chorus piano notes come from (fill answers, phrase
 *      starts, the final note) — the 115 chamber / 89 sonata 20-run totals;
 *   3. the vocalbacking arpeggio owner (harp vs piano per section type over
 *      20 runs), which menu patterns are legal under a harp-owned section,
 *      and what highArp realises as when the harp shares its bars;
 *   4. the keys safety-pass probe (keys notes at the untouched relief
 *      velocity 92 in chorus windows — where the pass never fired) and the
 *      per-template chorus-mean sums over golden103 (the 11.1 live pin).
 *   npx vite-node scripts/phase114-preflight.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';
import { isChorusTypeK, KEYS_GATES, PIANO_ARP_TEMPLATES } from '../src/orchestrator/keys/profile';
import { resolveTemplate } from '../src/config/ensembles';
import { measureEnergy } from '../src/orchestrator/energy';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

interface Run {
  templateId: string; tag: string; take: number;
  psTotal: number; psBlocked: number; fillTotal: number; fillBlocked: number;
  psBuckets: number[]; fillBuckets: number[];
  srcFill: number; srcPhrase: number; srcFinal: number;
  arpOwner: Record<string, string>;
  highArp: { drawnHarpOwned: number; realizedChord: number; realizedArp: number; drawnPianoOwned: number; realizedArpPianoOwned: number };
  v92Chorus: number; keysChorusNotes: number;
}
const runs: Run[] = [];

for (const templateId of TEMPLATES) {
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const sections = (doc as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections;
    for (let take = 1; take <= 10; take++) {
      const { project, result } = compose(doc, templateId, take);
      const template = resolveTemplate(project.ensemble)!;
      const clampMax = template.budget.energyClamp[1];
      const btBar = barTicks(project.timeSignature);
      const plan = result.plan.keys;
      const bars = plan.bars.length;
      const patternByStart = new Map<number, string>(plan.pianoPatterns.map((e) => [e.startBar, e.pattern] as [number, string]));
      const fillSet = new Set(plan.fillBars);
      const run: Run = {
        templateId, tag, take, psTotal: 0, psBlocked: 0, fillTotal: 0, fillBlocked: 0,
        psBuckets: [0, 0, 0, 0, 0], fillBuckets: [0, 0, 0, 0, 0],
        srcFill: 0, srcPhrase: 0, srcFinal: 0,
        arpOwner: {}, highArp: { drawnHarpOwned: 0, realizedChord: 0, realizedArp: 0, drawnPianoOwned: 0, realizedArpPianoOwned: 0 },
        v92Chorus: 0, keysChorusNotes: 0,
      };
      const bucket = (norm: number): number => (norm < 0.3 ? 0 : norm < 0.5 ? 1 : norm < 0.72 ? 2 : norm < 0.9 ? 3 : 4);

      // ---- Q1: the gate's reach over non-chorus phrase starts and fills ---
      for (const sec of sections) {
        if (isChorusTypeK(sec.name)) continue;
        for (let b = sec.startBar; b < sec.startBar + sec.lengthBars && b <= bars; b++) {
          const norm = plan.bars[b - 1]?.norm ?? 0;
          const isPs = b === sec.startBar || (b - sec.startBar) % 4 === 0;
          if (isPs) {
            run.psTotal++;
            run.psBuckets[bucket(norm)]++;
            if (!(norm >= KEYS_GATES.low && norm < KEYS_GATES.mid)) run.psBlocked++;
          }
          if (fillSet.has(b)) {
            run.fillTotal++;
            run.fillBuckets[bucket(norm)]++;
            if (norm < KEYS_GATES.low) run.fillBlocked++;
          }
        }
      }

      // ---- Q2: the non-chorus piano notes by source ------------------------
      const piano = result.tracks.find((t) => t.role === 'piano');
      if (piano) {
        for (const n of piano.notes) {
          const bar = Math.min(bars, Math.max(1, Math.floor(n.startTick / btBar) + 1));
          const kind = plan.bars[bar - 1]?.voices.piano;
          const sec = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          if (kind === 'final' || bar === bars) { run.srcFinal++; continue; }
          if (isChorusTypeK(sec?.name)) continue;
          if (kind === 'comp') {
            if (fillSet.has(bar)) run.srcFill++; else run.srcPhrase++;
          }
        }
      }

      // ---- Q3: the VB arpeggio owner and highArp's realisation -------------
      if (templateId === 'ensemble.vocalbacking') {
        for (const [type, owner] of Object.entries(plan.arpeggiatorByType)) run.arpOwner[type] = owner;
        const harp = result.tracks.find((t) => t.role === 'harp');
        const harpBars = new Set<number>();
        if (harp) for (const n of harp.notes) harpBars.add(Math.floor(n.startTick / btBar) + 1);
        for (const sec of sections) {
          const pat = patternByStart.get(sec.startBar);
          if (pat !== 'highArp') continue;
          const owner = plan.arpeggiatorByType[sec.name.trim().toLowerCase()] ?? 'harp';
          // realised as arpeggio = >=1 bar in the section with >=4 piano eighths
          // (the eighth figure); realised as chord = only downbeat chords there
          let arpBars = 0;
          for (let b = sec.startBar; b < sec.startBar + sec.lengthBars && b <= bars; b++) {
            if (!harpBars.has(b) && piano) {
              const inBar = piano.notes.filter((n) => {
                const nb = Math.floor(n.startTick / btBar) + 1;
                return nb === b;
              });
              if (inBar.length >= 4) arpBars++;
            }
          }
          if (owner === 'harp') {
            run.highArp.drawnHarpOwned++;
            if (arpBars > 0) run.highArp.realizedArp++; else run.highArp.realizedChord++;
          } else {
            run.highArp.drawnPianoOwned++;
            if (arpBars > 0) run.highArp.realizedArpPianoOwned++;
          }
        }
      }

      // ---- Q4a: the safety-pass probe (keys notes at the untouched relief
      // velocity 92 inside chorus windows — where the pass never fired).
      // Only the relief strikes themselves count: the bar carries no moment
      // (tutti/marcato hits ride their own velocity) and the note sits on
      // the quarter grid with a one-beat duration (a drive/bed strike, not a
      // gliss landing or a moment hit). ------------------------------------
      for (const sec of sections) {
        if (!isChorusTypeK(sec.name)) continue;
        for (let b = sec.startBar; b < sec.startBar + sec.lengthBars && b <= bars; b++) {
          const pb = plan.bars[b - 1];
          if ((pb?.norm ?? 0) < KEYS_GATES.low) continue;
          if (pb?.moment) continue; // tutti/soli/unison bars ride other velocities
          const beatLen = btBar / 4;
          for (const role of ['harp', 'piano']) {
            const t = result.tracks.find((x) => x.role === role);
            for (const n of t?.notes ?? []) {
              const nb = Math.floor(n.startTick / btBar) + 1;
              if (nb !== b) continue;
              // on the quarter grid within the micro-timing lag (±24 ticks)
              const off = Math.abs(((n.startTick - (b - 1) * btBar) % beatLen));
              const onGrid = (off <= 24 || off >= beatLen - 24) && n.durationTicks <= beatLen;
              if (!onGrid) continue;
              run.keysChorusNotes++;
              if (n.velocity === 92) run.v92Chorus++;
            }
          }
        }
      }
      runs.push(run);
    }
  }
}

/* ---------------- Q1: the gate and the energy distributions ---------------- */
console.log('=== Q1. the comping gate and the non-chorus energy distribution (20 runs per template) ===');
console.log(`gate today: phrase starts comp when 0.30 <= norm < 0.50 (LOW..MID of the clamp max); fill bars comp when norm >= 0.30 (no upper bound); chorus relief from 0.30`);
console.log(`norm reads: the conductor arc's per-bar target / energyClamp[1] (plan.keys.bars[].norm)`);
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const rs = runs.filter((r) => r.templateId === templateId);
  const ps = rs.reduce((a, r) => ({ t: a.t + r.psTotal, blk: a.blk + r.psBlocked, b: a.b.map((v, i) => v + r.psBuckets[i]) }), { t: 0, blk: 0, b: [0, 0, 0, 0, 0] });
  const fl = rs.reduce((a, r) => ({ t: a.t + r.blk, x: 0, b: a.b.map((v, i) => v + r.fillBuckets[i]), t2: a.t2 + r.fillTotal, blk2: a.blk2 + r.fillBlocked }), { t: 0, x: 0, b: [0, 0, 0, 0, 0], t2: 0, blk2: 0 });
  const bt = (arr: number[]) => arr.map((v) => pct(v, arr.reduce((a, b) => a + b, 0))).join(' / ');
  console.log(`${short}:`);
  console.log(`  phrase starts  n=${pad(String(ps.t), 5)} blocked ${pad(String(ps.blk), 5)} buckets [<.30 / [.30,.50) / [.50,.72) / [.72,.90) / >=.90] = ${bt(ps.b)}`);
  console.log(`  fill bars      n=${pad(String(fl.t2), 5)} blocked ${pad(String(fl.blk2), 5)} buckets = ${bt(fl.b)}`);
  console.log(`  per run: ${(ps.t / rs.length).toFixed(1)} phrase starts, ${(fl.t2 / rs.length).toFixed(1)} fill bars; gate blocks ${(ps.blk / rs.length).toFixed(1)} phrase starts + ${(fl.blk2 / rs.length).toFixed(1)} fills per run`);
}

/* ---------------- Q2: the non-chorus note sources -------------------------- */
console.log('\n=== Q2. the non-chorus piano notes by source (20-run totals; chorus relief excluded) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const rs = runs.filter((r) => r.templateId === templateId);
  const s = rs.reduce((a, r) => ({ f: a.f + r.srcFill, p: a.p + r.srcPhrase, fi: a.fi + r.srcFinal }), { f: 0, p: 0, fi: 0 });
  console.log(`${pad(short, 14)} fill answers ${pad(String(s.f), 5)} phrase-start comp ${pad(String(s.p), 5)} final note ${pad(String(s.fi), 4)} | per run ${(s.f + s.p) / rs.length + (s.fi / rs.length)}`);
}

/* ---------------- Q3: the vocalbacking arpeggio owner ---------------------- */
console.log('\n=== Q3. the vocalbacking arpeggio owner (20 runs) ===');
{
  const rs = runs.filter((r) => r.templateId === 'ensemble.vocalbacking');
  const owner = new Map<string, { harp: number; piano: number }>();
  for (const r of rs) for (const [t, o] of Object.entries(r.arpOwner)) {
    const e = owner.get(t) ?? { harp: 0, piano: 0 };
    if (o === 'harp') e.harp++; else e.piano++;
    owner.set(t, e);
  }
  for (const [t, e] of [...owner.entries()].sort()) console.log(`  section type ${pad(t, 10)} harp-owned ${pad(String(e.harp), 3)} piano-owned ${e.piano}`);
  const h = rs.reduce((a, r) => ({ dh: a.dh + r.highArp.drawnHarpOwned, rc: a.rc + r.highArp.realizedChord, ra: a.ra + r.highArp.realizedArp, dp: a.dp + r.highArp.drawnPianoOwned, rp: a.rp + r.highArp.realizedArpPianoOwned }), { dh: 0, rc: 0, ra: 0, dp: 0, rp: 0 });
  console.log(`  highArp drawn on harp-owned sections: ${h.dh} -> realised as the chord fallback ${h.rc}, as an arpeggio figure ${h.ra}`);
  console.log(`  highArp drawn on piano-owned sections: ${h.dp} -> realised as an arpeggio figure ${h.rp}`);
}

/* ---------------- Q4: the safety-pass probe and the chorus-mean pin -------- */
console.log('\n=== Q4. the keys safety-pass probe and the 11.1 chorus-mean pin (three-chorus, takes 1-10, moments excluded both sides) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const rs = runs.filter((r) => r.templateId === templateId && r.tag === 'three');
  const v92 = rs.reduce((a, r) => a + r.v92Chorus, 0);
  const kn = rs.reduce((a, r) => a + r.keysChorusNotes, 0);
  // the golden103 chorus-mean sums (the 11.1 live value — the new pin)
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  let sum = 0, n = 0, below = 0;
  for (let take = 1; take <= 10; take++) {
    const golden = JSON.parse(readFileSync(new URL(`../tests/golden103/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
    const base = JSON.parse(JSON.stringify(threeChorus));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    const proj = projectFromFixture(base);
    const momentBars = new Set<number>();
    for (const m of golden.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
    const beforeProj: Project = { ...proj, tracks: proj.tracks.map((x: { id: string }) => ({ ...x, notes: (golden.tracks.find((y: { id: string }) => y.id === x.id)?.notes ?? []) })) };
    const report = measureEnergy(beforeProj, template);
    const secs = (threeChorus as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections;
    for (const w of report.windows) {
      const sec = secs.find((s) => w.bar >= s.startBar && w.bar < s.startBar + s.lengthBars);
      if (!sec || !isChorusTypeK(sec.name)) continue;
      if (momentBars.has(w.bar)) continue;
      sum += w.energy; n++;
      if (w.energy > 0 && w.energy < template.budget.energyClamp[0]) below++;
    }
  }
  console.log(`${pad(short, 14)} relief-velocity-92 keys notes in chorus windows: ${pad(String(v92), 5)} of ${pad(String(kn), 5)} | golden103 chorus mean sum ${sum.toFixed(1)} over ${n} windows, below-floor ${below}`);
}
console.log('\n(velocity 92 = RELIEF_VELOCITY: a note still at 92 was never lowered by the final keys safety pass; zero means the pass fired in every relief window of that template.)');
