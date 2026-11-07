/**
 * Phase 11.3 (read-only survey): the piano pattern diversity (distinct
 * per-section pattern sequences over takes 1-10 on both fixtures, the
 * per-section-type share of the most frequent pattern, samey > 40%), the
 * vocalbacking piano register split per pattern (sparkle 82-96 / low <57 /
 * the vocal zone 57-81 / above 96), and the chorus relief drive's register
 * per voicing variant (mean pitch, share below 60) on chamber, sonata and
 * vocalbacking. Compose only; no source or golden changes.
 *   npx vite-node scripts/phase113-patterns.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';
import { isChorusTypeK, PIANO_ARP_TEMPLATES } from '../src/orchestrator/keys/profile';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const KEYS_GATES_LOW = 0.3;

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  return composeAllTracks(p, { seed: 11 });
};

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

/* ------------- the sanity check: live piano == golden103 piano ----------- */
console.log('=== sanity: live compose vs golden103 (piano notes, byte JSON) ===');
for (const [templateId, doc, tag] of [
  ['ensemble.chamber', threeChorus, 'three'], ['ensemble.vocalbacking', dorian, 'dorian'],
  ['ensemble.cinematic', threeChorus, 'three'],
] as const) {
  const short = templateId.replace('ensemble.', '');
  const live = compose(doc, templateId, 1);
  const golden = JSON.parse(readFileSync(new URL(`../tests/golden103/${short}-${tag}-t1.json`, import.meta.url), 'utf8'));
  const livePiano = live.tracks.find((t) => t.role === 'piano');
  const goldPiano = golden.tracks.find((t: { role: string }) => t.role === 'piano');
  const same = JSON.stringify(livePiano?.notes ?? []) === JSON.stringify(goldPiano?.notes ?? []);
  console.log(`${short}-${tag}-t1: piano notes live ${livePiano?.notes.length ?? 0} vs golden ${goldPiano?.notes.length ?? 0} — identical: ${same}`);
}

/* ------------------------- per-run collection ---------------------------- */
interface Run {
  templateId: string; tag: string; take: number;
  seq: string[]; arps: Record<string, string>;
  vbNotes: Map<string, { s: number; low: number; zone: number; high: number }>;
  drive: Map<string, { n: number; sum: number; below: number }>;
  nonDrive: Map<string, number>;
  kinds: Map<string, number>;
  chorusBarsTotal: number; chorusReliefBars: number;
}
const runs: Run[] = [];

for (const templateId of TEMPLATES) {
  const menuable = !PIANO_ARP_TEMPLATES.has(templateId);
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const sections = (doc as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections;
    const secTypeAt = (bar: number): string => {
      const s = sections.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
      return s ? s.name.trim().toLowerCase() : '*';
    };
    for (let take = 1; take <= 10; take++) {
      const result = compose(doc, templateId, take);
      const p = projectFromFixture(JSON.parse(JSON.stringify(doc)));
      p.ensemble = { templateId, overrides: {}, pins: {} };
      p.orchestration = { take };
      const btBar = barTicks(p.timeSignature);
      const plan = result.plan.keys;
      const patternByStart = new Map<number, string>(plan.pianoPatterns.map((e) => [e.startBar, e.pattern] as [number, string]));
      const patternOfBar = (bar: number): string | null => {
        const sec = sections.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
        return sec ? (patternByStart.get(sec.startBar) ?? null) : null;
      };
      const piano = result.tracks.find((t) => t.role === 'piano');
      const run: Run = { templateId, tag, take, seq: [], arps: {}, vbNotes: new Map(), drive: new Map(), nonDrive: new Map(), kinds: new Map(), chorusBarsTotal: 0, chorusReliefBars: 0 };

      // the drawn sequence (ordered by section startBar) and the arp owner map
      const ordered = [...sections].sort((a, b) => a.startBar - b.startBar);
      for (const sec of ordered) {
        const pat = patternByStart.get(sec.startBar);
        if (pat !== undefined) run.seq.push(`${sec.name.trim().toLowerCase()}:${pat}`);
        const owner = plan.arpeggiatorByType[sec.name.trim().toLowerCase() ?? '*'];
        if (owner !== undefined) run.arps[sec.name.trim().toLowerCase()] = owner;
      }

      // the piano notes
      if (piano) {
        for (const n of piano.notes) {
          const bar = Math.min(plan.bars.length, Math.max(1, Math.floor(n.startTick / btBar) + 1));
          const barPlan = plan.bars[bar - 1];
          const kind = barPlan?.voices.piano ?? '?';
          run.kinds.set(kind, (run.kinds.get(kind) ?? 0) + 1);
          if (n.articulation === 'marcato') continue; // tutti hits, not pattern writing
          const secType = secTypeAt(bar);
          const pattern = patternOfBar(bar);
          const relief = isChorusTypeK(secType) && (barPlan?.norm ?? 0) >= KEYS_GATES_LOW;
          if (isChorusTypeK(secType)) {
            run.chorusBarsTotal += 0; // bars counted below per-run, not per-note
          }
          if (kind !== 'comp') continue; // the pattern/drive realisation only
          if (relief && pattern?.startsWith('drive')) {
            const d = run.drive.get(pattern) ?? { n: 0, sum: 0, below: 0 };
            d.n++; d.sum += n.pitch; if (n.pitch < 60) d.below++;
            run.drive.set(pattern, d);
          } else if (pattern && !relief) {
            run.nonDrive.set(pattern, (run.nonDrive.get(pattern) ?? 0) + 1);
          }
          if (templateId === 'ensemble.vocalbacking' && pattern) {
            const v = run.vbNotes.get(pattern) ?? { s: 0, low: 0, zone: 0, high: 0 };
            if (n.pitch >= 82 && n.pitch <= 96) v.s++;
            else if (n.pitch < 57) v.low++;
            else if (n.pitch >= 57 && n.pitch <= 81) v.zone++;
            else v.high++;
            run.vbNotes.set(pattern, v);
          }
        }
      }
      // chorus bar census (relief vs low-gate fallback)
      for (let bar = 1; bar <= plan.bars.length; bar++) {
        const t = secTypeAt(bar);
        if (!isChorusTypeK(t)) continue;
        run.chorusBarsTotal++;
        if ((plan.bars[bar - 1]?.norm ?? 0) >= KEYS_GATES_LOW) run.chorusReliefBars++;
      }
      runs.push(run);
    }
  }
}

/* ---------------- 1. distinct per-section pattern sequences -------------- */
console.log('\n=== 1. distinct per-section pattern sequences (takes 1-10) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const rs = runs.filter((r) => r.templateId === templateId);
  if (PIANO_ARP_TEMPLATES.has(templateId)) {
    const maps = rs.map((r) => JSON.stringify(Object.entries(r.arps).sort()));
    const distinct = new Set(maps).size;
    console.log(`${short}: NO pattern menu (the Phase 11 arpeggiator, spec §16.3a) — the only per-take draw is the arpeggiator owner per section type; distinct owner assignments ${distinct} of 20 runs`);
    continue;
  }
  const three = rs.filter((r) => r.tag === 'three').map((r) => r.seq.join(' '));
  const dorian = rs.filter((r) => r.tag === 'dorian').map((r) => r.seq.join(' '));
  const pooled = [...three, ...dorian];
  console.log(`${short}: distinct sequences — three-chorus ${new Set(three).size}/10, dorian ${new Set(dorian).size}/10, pooled ${new Set(pooled).size}/20`);
}

/* ------------- 2. per section type: most-frequent pattern share ---------- */
console.log('\n=== 2. per section type: drawn-pattern shares (pooled 20 runs; samey when top > 40%) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const rs = runs.filter((r) => r.templateId === templateId);
  const menuable = !PIANO_ARP_TEMPLATES.has(templateId);
  const byType = new Map<string, Map<string, number>>();
  for (const r of rs) {
    if (menuable) {
      for (const entry of r.seq) {
        const [type, pat] = entry.split(':');
        if (!byType.has(type)) byType.set(type, new Map());
        const m = byType.get(type)!;
        m.set(pat, (m.get(pat) ?? 0) + 1);
      }
    } else {
      for (const [type, owner] of Object.entries(r.arps)) {
        if (!byType.has(type)) byType.set(type, new Map());
        const m = byType.get(type)!;
        m.set(`arp-owner:${owner}`, (m.get(`arp-owner:${owner}`) ?? 0) + 1);
      }
    }
  }
  const rows = [...byType.entries()].sort().map(([type, m]) => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [top, topN] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const dist = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, total)}`).join(', ');
    return `${pad(type, 8)} n=${pad(String(total), 4)} top ${pad(top, 16)} ${pad(pct(topN, total), 6)} ${topN / total > 0.4 ? 'SAMEY' : 'ok    '} | ${dist}`;
  });
  console.log(`${short}:\n${rows.map((r) => `  ${r}`).join('\n')}`);
}

/* ------------- 3. vocalbacking: the piano register split per pattern ----- */
console.log('\n=== 3. vocalbacking piano register split per drawn pattern (pooled 20 runs) ===');
{
  const rs = runs.filter((r) => r.templateId === 'ensemble.vocalbacking');
  const agg = new Map<string, { s: number; low: number; zone: number; high: number }>();
  for (const r of rs) for (const [pat, v] of r.vbNotes) {
    const a = agg.get(pat) ?? { s: 0, low: 0, zone: 0, high: 0 };
    a.s += v.s; a.low += v.low; a.zone += v.zone; a.high += v.high;
    agg.set(pat, a);
  }
  console.log(`${pad('pattern', 12)}${pad('notes', 8)}${pad('sparkle 82-96', 15)}${pad('low <57', 10)}${pad('vocal zone 57-81', 18)}${pad('above 96', 10)}`);
  for (const [pat, v] of [...agg.entries()].sort()) {
    const total = v.s + v.low + v.zone + v.high;
    console.log(`${pad(pat, 12)}${pad(String(total), 8)}${pad(pct(v.s, total), 15)}${pad(pct(v.low, total), 10)}${pad(pct(v.zone, total), 18)}${pad(pct(v.high, total), 10)}`);
  }
}

/* ------------- 3b. drawn vs realized: which patterns actually sound ------ */
console.log('\n=== 3b. drawn menu patterns vs realized notes (pooled 20 runs) ===');
{
  const per = new Map<string, Map<string, number>>();
  for (const r of runs) {
    if (PIANO_ARP_TEMPLATES.has(r.templateId)) continue;
    if (!per.has(r.templateId)) per.set(r.templateId, new Map());
    const m = per.get(r.templateId)!;
    for (const [pat, d] of r.drive) m.set(pat, (m.get(pat) ?? 0) + d.n);
  }
  // the non-chorus realizations: recompute from the per-run vb/comp split —
  // collect them in the run loop instead; here only the drive sums are known,
  // so the realized totals come from the kinds tally minus the drive sums
  for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
    const short = templateId.replace('ensemble.', '');
    const rs = runs.filter((r) => r.templateId === templateId);
    const compTotal = rs.reduce((a, r) => a + (r.kinds.get('comp') ?? 0), 0);
    const driveTotal = rs.reduce((a, r) => a + [...r.drive.values()].reduce((x, d) => x + d.n, 0), 0);
    const rows = [...(per.get(templateId) ?? new Map()).entries()].sort().map(([p, n]) => `${p} ${n}`).join(', ');
    const nd = new Map<string, number>();
    for (const r of rs) for (const [p, n] of r.nonDrive) nd.set(p, (nd.get(p) ?? 0) + n);
    const ndRows = [...nd.entries()].sort().map(([p, n]) => `${p} ${n}`).join(', ');
    console.log(`${short}: comp notes ${compTotal} = drive ${driveTotal} + non-chorus comp ${compTotal - driveTotal}`);
    console.log(`  realized per drawn pattern: ${rows}`);
    console.log(`  non-chorus realizations: ${ndRows || 'none'}`);
  }
}

/* ------------- 4. the chorus relief drive's register per variant --------- */
console.log('\n=== 4. chorus relief drive register per voicing variant (pooled 20 runs) ===');
for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
  const short = templateId.replace('ensemble.', '');
  const rs = runs.filter((r) => r.templateId === templateId);
  const agg = new Map<string, { n: number; sum: number; below: number }>();
  for (const r of rs) for (const [v, d] of r.drive) {
    const a = agg.get(v) ?? { n: 0, sum: 0, below: 0 };
    a.n += d.n; a.sum += d.sum; a.below += d.below;
    agg.set(v, a);
  }
  const bars = rs.reduce((a, r) => ({ total: a.total + r.chorusBarsTotal, relief: a.relief + r.chorusReliefBars }), { total: 0, relief: 0 });
  console.log(`${short} (chorus bars ${bars.total} across 20 runs, relief-realised ${bars.relief}, low-gate block-fallback ${bars.total - bars.relief}):`);
  for (const [v, d] of [...agg.entries()].sort()) {
    console.log(`  ${pad(v, 14)} notes ${pad(String(d.n), 6)} mean pitch ${(d.sum / d.n).toFixed(1)}  below60 ${pct(d.below, d.n)}`);
  }
}

/* ------------- 5. the piano voice-kind mix (context for 3 and 4) --------- */
console.log('\n=== 5. piano voice-kind mix per template (all notes, 20 runs) ===');
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const agg = new Map<string, number>();
  for (const r of runs.filter((x) => x.templateId === templateId)) for (const [k, v] of r.kinds) agg.set(k, (agg.get(k) ?? 0) + v);
  console.log(`${short}: ${[...agg.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
