/**
 * Phase 11.4 report numbers (read-only): the per-template before/after
 * non-chorus piano counts, the vocalbacking register split per drawn
 * pattern (golden103 = before, live = after), the drive variants' mean
 * pitch and below-60 share, the realized pattern top shares per section
 * type, and the roster-less families check (brass, winds, percussion in
 * chamber, sonata and vocalbacking).
 *   npx vite-node scripts/phase114-report.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';
import { isChorusTypeK } from '../src/orchestrator/keys/profile';
import { readFileSync } from 'node:fs';

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks } as Project, result };
};
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const secsOf = (doc: unknown) => (doc as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections;

/* ---- 1. the non-chorus piano notes per run: golden103 vs live ---------- */
console.log('=== 1. non-chorus piano notes per run (20 runs; before = golden103, after = live) ===');
for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
  const short = templateId.replace('ensemble.', '');
  let before = 0;
  let after = 0;
  let beforeNoFinal = 0;
  let afterNoFinal = 0;
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const secs = secsOf(doc);
    const bars = secs.reduce((a, s) => Math.max(a, s.startBar + s.lengthBars - 1), 0);
    for (let take = 1; take <= 10; take++) {
      for (const [label, notes, bt] of [
        ['g', (JSON.parse(readFileSync(new URL(`../tests/golden103/${short}-${tag}-t${take}.json`, import.meta.url), 'utf8')).tracks.find((t: { role: string }) => t.role === 'piano')?.notes ?? []) as { startTick: number }[], 3840],
        ['l', compose(doc, templateId, take).project.tracks.find((t) => t.role === 'piano')?.notes ?? [], barTicks((projectFromFixture(JSON.parse(JSON.stringify(doc)))).timeSignature)],
      ] as const) {
        let c = 0;
        let cf = 0;
        for (const n of notes) {
          const bar = Math.floor(n.startTick / bt) + 1;
          const sec = secs.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
          if (!sec || isChorusTypeK(sec.name)) continue;
          c++;
          if (bar !== bars) cf++;
        }
        if (label === 'g') { before += c; beforeNoFinal += cf; } else { after += c; afterNoFinal += cf; }
      }
    }
  }
  console.log(`${pad(short, 14)} before ${pad((before / 20).toFixed(2), 7)} after ${pad((after / 20).toFixed(2), 7)} | excl. final note: before ${pad((beforeNoFinal / 20).toFixed(2), 6)} after ${(afterNoFinal / 20).toFixed(2)}`);
}

/* ---- 2. the vocalbacking register split per drawn pattern --------------- */
console.log('\n=== 2. vocalbacking piano register split per drawn pattern (20 runs; sparkle 82-96 / low <57 / zone 57-81) ===');
const splitOf = (notes: { pitch: number }[], keyOf: (n: { pitch: number }) => string | null): Map<string, { s: number; low: number; zone: number; hi: number }> => {
  const agg = new Map<string, { s: number; low: number; zone: number; hi: number }>();
  for (const n of notes) {
    const k = keyOf(n);
    if (!k) continue;
    const e = agg.get(k) ?? { s: 0, low: 0, zone: 0, hi: 0 };
    if (n.pitch >= 82 && n.pitch <= 96) e.s++;
    else if (n.pitch < 57) e.low++;
    else if (n.pitch >= 57 && n.pitch <= 81) e.zone++;
    else e.hi++;
    agg.set(k, e);
  }
  return agg;
};
{
  // before: golden103 with the plan's drawn patterns — the golden files do
  // not carry the plan, so the before side reports the aggregate split only
  let g = { s: 0, low: 0, zone: 0, hi: 0 };
  for (const templateId of ['ensemble.vocalbacking']) {
    for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
      for (let take = 1; take <= 10; take++) {
        const notes = JSON.parse(readFileSync(new URL(`../tests/golden103/vocalbacking-${tag}-t${take}.json`, import.meta.url), 'utf8')).tracks.find((t: { role: string }) => t.role === 'piano')?.notes ?? [];
        for (const n of notes as { pitch: number }[]) {
          if (n.pitch >= 82 && n.pitch <= 96) g.s++;
          else if (n.pitch < 57) g.low++;
          else if (n.pitch >= 57 && n.pitch <= 81) g.zone++;
          else g.hi++;
        }
      }
    }
  }
  console.log(`before (aggregate): sparkle ${pct(g.s, g.s + g.low + g.zone + g.hi)} (${g.s}), low ${pct(g.low, g.s + g.low + g.zone + g.hi)} (${g.low}), zone ${pct(g.zone, g.s + g.low + g.zone + g.hi)} (${g.zone}), above96 ${g.hi}`);
  // after: per drawn pattern
  const agg = new Map<string, { s: number; low: number; zone: number; hi: number }>();
  const drivePitch: Map<string, { n: number; sum: number; below: number }> = new Map();
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const secs = secsOf(doc);
    for (let take = 1; take <= 10; take++) {
      const { project: proj, result } = compose(doc, 'ensemble.vocalbacking', take);
      const btBar = barTicks(proj.timeSignature);
      const bt = btBar / 4;
      const patternByStart = new Map<number, string>(result.plan.keys.pianoPatterns.map((e) => [e.startBar, e.pattern] as [number, string]));
      const kindByBar = new Map<number, string>();
      for (const b of result.plan.keys.bars) if (b.voices.piano) kindByBar.set(b.bar, b.voices.piano);
      const piano = proj.tracks.find((t) => t.role === 'piano');
      const perPattern = splitOf(piano?.notes ?? [], (n) => {
        const bar = Math.floor(n.startTick / btBar) + 1;
        const kind = kindByBar.get(bar);
        if (kind !== 'comp') return null;
        const sec = secs.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        return sec ? (patternByStart.get(sec.startBar) ?? null) : null;
      });
      for (const [k, v] of perPattern) {
        const a = agg.get(k) ?? { s: 0, low: 0, zone: 0, hi: 0 };
        a.s += v.s; a.low += v.low; a.zone += v.zone; a.hi += v.hi;
        agg.set(k, a);
      }
      // the drive variants' mean pitch (relief notes in chorus bars)
      for (const n of piano?.notes ?? []) {
        const bar = Math.floor(n.startTick / btBar) + 1;
        const sec = secs.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
        if (!sec || !isChorusTypeK(sec.name)) continue;
        if (kindByBar.get(bar) !== 'comp') continue;
        const pat = patternByStart.get(sec.startBar) ?? 'driveBlock';
        const d = drivePitch.get(pat) ?? { n: 0, sum: 0, below: 0 };
        d.n++; d.sum += n.pitch; if (n.pitch < 60) d.below++;
        drivePitch.set(pat, d);
      }
    }
  }
  console.log('after, per drawn pattern (pooled 20 runs):');
  console.log(`${pad('pattern', 12)}${pad('notes', 8)}${pad('sparkle', 10)}${pad('low', 8)}${pad('zone', 8)}${pad('above96', 9)}`);
  for (const [k, v] of [...agg.entries()].sort()) {
    const t = v.s + v.low + v.zone + v.hi;
    console.log(`${pad(k, 12)}${pad(String(t), 8)}${pad(pct(v.s, t), 10)}${pad(pct(v.low, t), 8)}${pad(pct(v.zone, t), 8)}${pad(String(v.hi), 9)}`);
  }
  console.log('\nthe drive variants\' mean pitch (20 runs):');
  for (const [k, d] of [...drivePitch.entries()].sort()) {
    console.log(`  ${pad(k, 14)} notes ${pad(String(d.n), 6)} mean pitch ${(d.sum / d.n).toFixed(1)} below60 ${pct(d.below, d.n)}`);
  }
}

/* ---- 3. the realized pattern top shares per section type ---------------- */
console.log('\n=== 3. realized pattern top shares per section type (20 runs) ===');
for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
  const short = templateId.replace('ensemble.', '');
  const byType = new Map<string, Map<string, number>>();
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    const secs = secsOf(doc);
    for (let take = 1; take <= 10; take++) {
      const { project: proj, result } = compose(doc, templateId, take);
      const btBar = barTicks(proj.timeSignature);
      const patternByStart = new Map<number, string>(result.plan.keys.pianoPatterns.map((e) => [e.startBar, e.pattern] as [number, string]));
      const kindByBar = new Map<number, string>();
      for (const b of result.plan.keys.bars) if (b.voices.piano) kindByBar.set(b.bar, b.voices.piano);
      const piano = proj.tracks.find((t) => t.role === 'piano');
      for (const sec of secs) {
        const drawn = patternByStart.get(sec.startBar);
        if (!drawn) continue;
        const notes = (piano?.notes ?? []).filter((n) => {
          const bar = Math.floor(n.startTick / btBar) + 1;
          if (bar < sec.startBar || bar >= sec.startBar + sec.lengthBars) return false;
          return kindByBar.get(bar) === 'comp';
        });
        if (!notes.length) continue;
        // realized: the drawn pattern whose register/shape the notes carry
        let ok = true;
        if (drawn === 'lowFifth') ok = notes.every((n) => n.pitch < 57);
        else if (['sparkle', 'dyadHigh', 'highArp'].includes(drawn)) ok = notes.every((n) => !(n.pitch >= 57 && n.pitch <= 81));
        else if (drawn === 'driveLow') ok = notes.every((n) => n.pitch >= 40 && n.pitch <= 56);
        else if (drawn === 'driveSplit') ok = notes.every((n) => n.pitch < 57 || n.pitch >= 82);
        if (!ok) continue;
        const type = sec.name.trim().toLowerCase();
        if (!byType.has(type)) byType.set(type, new Map());
        const m = byType.get(type)!;
        m.set(drawn, (m.get(drawn) ?? 0) + 1);
      }
    }
  }
  const rows = [...byType.entries()].sort().map(([type, m]) => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [top, topN] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return `${pad(type, 8)} n=${pad(String(total), 3)} top ${pad(top, 12)} ${pad(pct(topN, total), 6)} ${topN / total > 0.4 ? 'SAMEY' : 'ok'}`;
  });
  console.log(`${short}:\n${rows.map((r) => `  ${r}`).join('\n')}`);
}

/* ---- 4. the roster-less families check ---------------------------------- */
console.log('\n=== 4. the roster-less families in chamber, sonata, vocalbacking ===');
for (const templateId of ['ensemble.chamber', 'ensemble.sonata', 'ensemble.vocalbacking']) {
  const short = templateId.replace('ensemble.', '');
  const { project } = compose(threeChorus, templateId, 1);
  const famTracks = project.tracks.filter((t) => ['brass', 'winds', 'percussion'].includes((t.family ?? '').toLowerCase()) || ['trumpets', 'horns', 'trombones', 'tubas', 'clarinets', 'flutes', 'oboes', 'bassoons', 'timpani', 'snare', 'cymbals', 'auxPerc'].includes(t.role));
  const withNotes = famTracks.filter((t) => t.notes.length > 0);
  console.log(`${pad(short, 14)} brass/wind/perc tracks in project: ${famTracks.length}${famTracks.length ? `, with notes: ${withNotes.length} (${withNotes.map((t) => t.role).join(', ')})` : ' — the band carries none'}`);
}
