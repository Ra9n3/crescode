/**
 * Phase 9 pin + energy probe (read-only):
 *  1. the three wind templates' non-wind tracks vs golden90 outside the
 *     sanctioned bars (wind leads, wind solis, moment bars either side,
 *     brass leads, the legato-join window);
 *  2. chorus mean + below-floor counts before (golden90) and after, per take.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Note, type Project, type Track } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { measureEnergy } from '../src/orchestrator/energy';
import { readFileSync } from 'node:fs';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';
import { secondsToTicks, barTicks } from '../src/orchestrator/spine';

const WIND_ROLES = ['flutes', 'oboes', 'clarinets', 'bassoons'];
const TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { p, result, project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project };
};

const secTypeAt = (bar: number): string => {
  const secs = [{ name: 'Verse', startBar: 1, lengthBars: 4 }, { name: 'Chorus', startBar: 5, lengthBars: 8 }, { name: 'Verse', startBar: 13, lengthBars: 4 }, { name: 'Chorus', startBar: 17, lengthBars: 8 }, { name: 'Bridge', startBar: 25, lengthBars: 4 }, { name: 'Chorus', startBar: 29, lengthBars: 8 }, { name: 'Outro', startBar: 37, lengthBars: 4 }];
  const s = secs.find((x) => bar >= x.startBar && bar < x.startBar + x.lengthBars);
  return s ? s.name.toLowerCase() : '*';
};

let diffCount = 0;
const diffs: string[] = [];
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  for (const [tag, doc] of [['three', threeChorus], ['dorian', dorian]] as const) {
    for (let take = 1; take <= 10; take++) {
      const golden = JSON.parse(readFileSync(new URL(`../tests/golden90/${short}-${tag}-t${take}.json`, import.meta.url), 'utf8'));
      const { result, project } = compose(doc, templateId, take);
      const base = projectFromFixture(JSON.parse(JSON.stringify(doc)));
      base.ensemble = { templateId, overrides: {}, pins: {} };
      base.orchestration = { take };
      const beforeProject: Project = { ...base, tracks: golden.tracks.map((t: Track) => ({ ...base.tracks.find((x) => x.id === t.id)!, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) })) };
      const btBar = barTicks(project.timeSignature);
      // sanctioned bars: wind leads + all moments either side + brass leads
      const leadBars = new Set<number>();
      for (const l of result.plan.winds.leads) for (let b = l.startBar; b <= l.endBar; b++) leadBars.add(b);
      for (const l of result.plan.brass.leads) for (let b = l.startBar; b <= l.endBar; b++) leadBars.add(b);
      for (const l of golden.leads ?? []) for (let b = l.startBar; b <= l.endBar; b++) leadBars.add(b);
      for (const m of result.plan.moments) for (let b = m.startBar; b <= m.endBar; b++) leadBars.add(b);
      for (const m of golden.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) leadBars.add(b);
      const joinOf = new Map<number, number>();
      for (const b of leadBars) {
        const bs = (b - 1) * btBar;
        joinOf.set(b, humanizeHeadTicks(base.tempoMap, bs) + Math.ceil(secondsToTicks(0.035, base.tempoMap)));
      }
      const inSanctioned = (n: Note) => {
        const end = n.startTick + n.durationTicks;
        if (leadBars.has(Math.floor(n.startTick / btBar) + 1) || leadBars.has(Math.floor((end - 1) / btBar) + 1)) return true;
        const endBar = Math.floor(end / btBar) + 1;
        const join = joinOf.get(endBar);
        if (join !== undefined && end - (endBar - 1) * btBar <= join) return true;
        return false;
      };
      const sig = (n: Note) => `${n.pitch}:${n.startTick}:${n.durationTicks}:${n.velocity}:${n.articulation ?? ''}:${n.layer ?? ''}`;
      for (const t of project.tracks) {
        if ((WIND_ROLES as string[]).includes(t.role)) continue;
        const g = (golden.tracks as { id: string; notes: Note[] }[]).find((x) => x.id === t.id);
        if (!g) { diffs.push(`${short} ${tag} t${take} ${t.role}: missing golden`); continue; }
        const cur = t.notes.filter((n) => !inSanctioned(n)).map(sig).sort();
        const was = g.notes.filter((n) => !inSanctioned(n)).map(sig).sort();
        if (JSON.stringify(cur) !== JSON.stringify(was)) {
          diffCount++;
          const curSet = new Set(cur);
          const extra = cur.filter((x) => !was.includes(x)).slice(0, 3);
          const missing = was.filter((x) => !curSet.has(x)).slice(0, 3);
          diffs.push(`${short} ${tag} t${take} ${t.role}: +${extra.length}/${missing.length} e.g. ${extra[0] ?? ''} vs ${missing[0] ?? ''}`);
        }
      }
    }
  }
}
console.log(`non-wind byte-identity outside sanctioned bars: ${diffCount === 0 ? 'HOLDS (60 compositions × every non-wind track)' : `${diffCount} DIFFS`}`);
for (const d of diffs.slice(0, 20)) console.log('  ' + d);

// chorus mean + below-floor before/after per template per take
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  let beforeMean = 0, beforeN = 0, afterMean = 0, afterN = 0;
  let beforeBelow = 0, afterBelow = 0;
  let lowered = 0;
  const perTake: string[] = [];
  for (let take = 1; take <= 10; take++) {
    const golden = JSON.parse(readFileSync(new URL(`../tests/golden90/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
    const { project } = compose(threeChorus, templateId, take);
    const base = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    base.ensemble = { templateId, overrides: {}, pins: {} };
    const beforeProject: Project = { ...base, tracks: golden.tracks.map((t: Track) => ({ ...base.tracks.find((x) => x.id === t.id)!, notes: t.notes, ...(t.cc !== undefined ? { cc: t.cc } : {}) })) };
    const rb = measureEnergy(beforeProject, template);
    const ra = measureEnergy(project, template);
    let bSum = 0, bN = 0, aSum = 0, aN = 0, bBelow = 0, aBelow = 0;
    for (const w of rb.windows) {
      if (secTypeAt(w.bar) !== 'chorus') continue;
      bSum += w.energy; bN++;
      if (w.energy < template.budget.energyClamp[0] - 1e-9 && w.noteCount > 0) bBelow++;
    }
    for (const w of ra.windows) {
      if (secTypeAt(w.bar) !== 'chorus') continue;
      aSum += w.energy; aN++;
      if (w.energy < template.budget.energyClamp[0] - 1e-9 && w.noteCount > 0) aBelow++;
    }
    const bm = bSum / bN, am = aSum / aN;
    if (am < bm - 1e-9) lowered++;
    beforeMean += bm; beforeN++;
    afterMean += am; afterN++;
    beforeBelow += bBelow; afterBelow += aBelow;
    perTake.push(`t${take} ${bm.toFixed(3)}→${am.toFixed(3)}${am < bm ? ' LOWERED' : ''}`);
  }
  console.log(`${short}: chorus mean ${((beforeMean) / beforeN).toFixed(3)} → ${(afterMean / afterN).toFixed(3)}, below-floor ${beforeBelow} → ${afterBelow}, takes lowered: ${lowered}`);
  console.log('   ' + perTake.join(' | '));
}
