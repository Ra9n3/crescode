/**
 * Phase 8.3 diagnosis (read-only): per section type, on three-chorus takes
 * 1–10 for symphony / cinematic / hybridstudio —
 *   - energy mean (measureEnergy windows grouped by section type);
 *   - sounding roster voices per bar split by family group and by writer;
 *   - the brass gate-level distribution + trumpet presence straight from the
 *     plan (the plan's own norm/level — no arc re-derivation);
 *   - per-take chorus vs verse energy means (the spec's target metric);
 *   - below-floor window counts per section type.
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { measureEnergy } from '../src/orchestrator/energy';
import { sectionMap, barTicks } from '../src/orchestrator/spine';
import { BRASS_GATES } from '../src/orchestrator/brass/profile';

const TEMPLATES = ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio'];
const FAMILY_OF: Record<string, string> = {
  violins1: 'strings', violins2: 'strings', violas: 'strings', cellosBasses: 'strings', basses: 'strings',
  horns: 'brass', trumpets: 'brass', trombones: 'brass', tuba: 'brass',
  flutes: 'winds', oboes: 'winds', clarinets: 'winds', bassoons: 'winds',
  timpani: 'percussion', snare: 'percussion', cymbals: 'percussion', aux: 'percussion',
  harp: 'harp', piano: 'piano',
};
const GROUPS = ['strings', 'brass', 'winds', 'percussion', 'harp', 'piano'] as const;
const secType = (name: string): string => name.trim().toLowerCase() || '*';

interface Acc {
  energySum: number; energyN: number;
  belowFloor: number;
  voices: Record<string, { sum: number; bars: number }>;
  brassBarCount: number; brassBars: number;
  trumpetBars: number;
  levels: Record<string, number>;
  perTake: Map<number, { chorus: { sum: number; n: number }; verse: { sum: number; n: number } }>;
}
const accFor = (): Acc => ({
  energySum: 0, energyN: 0, belowFloor: 0,
  voices: Object.fromEntries(GROUPS.map((g) => [g, { sum: 0, bars: 0 }])),
  brassBarCount: 0, brassBars: 0, trumpetBars: 0, levels: {},
  perTake: new Map(),
});

for (const templateId of TEMPLATES) {
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const clampMax = template.budget.energyClamp[1];
  const N = template.roster.length;
  const acc: Record<string, Acc> = {};
  const roleFamily: Record<string, string> = {};
  for (const r of template.roster) roleFamily[r.role] = FAMILY_OF[r.role] ?? 'other';
  for (const t of ['intro', 'verse', 'chorus', 'bridge', 'outro']) acc[t] = accFor();

  for (let take = 1; take <= 10; take++) {
    const p: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    p.ensemble = { templateId, overrides: {}, pins: {} };
    p.orchestration = { take };
    const result = composeAllTracks(p, { seed: 11, moments: true });
    const project: Project = { ...p, tracks: result.tracks, orchestration: result.orchestration };
    const sections = sectionMap(project);
    const report = measureEnergy(project, template);
    const barsTotal = Math.max(...sections.map((s) => s.startBar + s.lengthBars - 1));
    const typeAtBar: string[] = [];
    for (let bar = 1; bar <= barsTotal; bar++) {
      const sec = sections.find((s) => bar >= s.startBar && bar < s.startBar + s.lengthBars);
      typeAtBar[bar] = sec ? secType(sec.name) : '*';
    }
    for (const w of report.windows) {
      const type = typeAtBar[w.bar];
      if (!type || !acc[type]) continue;
      acc[type].energySum += w.energy;
      acc[type].energyN++;
      if (w.energy < template.budget.energyClamp[0] - 1e-9 && w.noteCount > 0) acc[type].belowFloor++;
      const pt = acc[type].perTake.get(take) ?? { chorus: { sum: 0, n: 0 }, verse: { sum: 0, n: 0 } };
      const slot = type === 'chorus' ? pt.chorus : type === 'verse' ? pt.verse : null;
      if (slot) { slot.sum += w.energy; slot.n++; }
      acc[type].perTake.set(take, pt);
    }
    const btBar = barTicks(project.timeSignature); // the fixture's own PPQ — never assume 480
    const rolesByBar: Record<number, Set<string>> = {};
    for (const t of project.tracks) {
      if (!t.notes?.length || !roleFamily[t.role]) continue;
      for (const n of t.notes) {
        const firstBar = Math.floor(n.startTick / btBar) + 1;
        const lastBar = Math.floor((n.startTick + n.durationTicks - 1) / btBar) + 1;
        for (let b = firstBar; b <= lastBar; b++) (rolesByBar[b] ??= new Set()).add(t.role);
      }
    }
    for (let bar = 1; bar <= barsTotal; bar++) {
      const type = typeAtBar[bar];
      if (!type || !acc[type]) continue;
      const roles = rolesByBar[bar] ?? new Set<string>();
      for (const g of GROUPS) {
        const n = [...roles].filter((r) => roleFamily[r] === g).length;
        acc[type].voices[g].sum += n;
        acc[type].voices[g].bars++;
      }
      const sounding = [...roles].filter((r) => roleFamily[r] === 'brass');
      if (sounding.length) acc[type].brassBarCount++;
      if (sounding.includes('trumpets')) acc[type].trumpetBars++;
      acc[type].brassBars++;
    }
    // gate levels straight from the brass plan
    for (const b of result.plan.brass.bars) {
      const type = typeAtBar[b.bar];
      if (!type || !acc[type]) continue;
      acc[type].levels[b.level] = (acc[type].levels[b.level] ?? 0) + 1;
    }
  }

  console.log(`\n=== ${templateId} (clampMax ${clampMax}, N ${N}, gates ${JSON.stringify(BRASS_GATES)}) ===`);
  console.log('type     | E mean | <floor | str   | brs   | wnd   | prc   | hrp   | pno   | brass-bars | tpt-bars | plan levels (bars, 10 takes)');
  for (const type of ['intro', 'verse', 'chorus', 'bridge', 'outro']) {
    const a = acc[type];
    if (!a.energyN) continue;
    const v = GROUPS.map((g) => (a.voices[g].bars ? (a.voices[g].sum / a.voices[g].bars).toFixed(2) : '-')).join(' | ');
    const lv = Object.entries(a.levels).sort().map(([k, n]) => `${k}:${n}`).join(' ');
    console.log(
      `${type.padEnd(8)} | ${(a.energySum / a.energyN).toFixed(3)} | ${String(a.belowFloor).padEnd(3)} | ${v} | ${(a.brassBarCount / Math.max(1, a.brassBars)).toFixed(2).padEnd(4)} | ${(a.trumpetBars / Math.max(1, a.brassBars)).toFixed(2).padEnd(4)} | ${lv}`,
    );
  }
  // per-take chorus vs verse means (the spec's target metric)
  const verseAcc = acc['verse'];
  const chorusAcc = acc['chorus'];
  const rows: string[] = [];
  let allPass = true;
  for (let take = 1; take <= 10; take++) {
    const v = verseAcc.perTake.get(take)!;
    const c = chorusAcc.perTake.get(take)!;
    const vm = v.verse.sum / v.verse.n;
    const cm = c.chorus.sum / c.chorus.n;
    const ok = cm > vm;
    if (!ok) allPass = false;
    rows.push(`t${take}: verse ${vm.toFixed(3)} chorus ${cm.toFixed(3)} ${ok ? '>' : '<< FAIL'}`);
  }
  console.log(`  per-take chorus>verse: ${allPass ? 'PASS all 10' : 'FAIL some'}`);
  console.log('  ' + rows.join(' | '));
}
console.log('\nwriter map: strings+brass = orchestrator modules; winds/percussion/harp/piano = rules generator (+ tutti hits)');
