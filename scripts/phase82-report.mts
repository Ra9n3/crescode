/* Phase 8.2 report numbers:
 *  - fold/drop counts per profile part (cinematic + symphony, takes 1–10, both fixtures);
 *  - whether any fold creates a new unison/octave doubling with another part;
 *  - energy mean/peak before (the Phase 8.1 golden tracks) and after (the 8.2 composes);
 *  - the cello/basses desk diff vs HEAD (the sanctioned differences);
 *  - the roster list (every track beyond strings and brass, and who writes it). */
import { readFileSync } from 'node:fs';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectFromFixture, type Note, type Project } from '../src/shared/schema';
import { EXPORT_PROFILES } from '../src/export/profiles';
import { chunksForTrack, type FoldStats } from '../src/export/profile';
import { exportableTracks } from '../src/export/midi';
import { resolveTemplate } from '../src/config/ensembles';
import { measureEnergy } from '../src/orchestrator/energy';

const PROFILE = EXPORT_PROFILES[0].profile;
const FIX: Record<string, unknown> = { dorian, three: threeChorus };

const compose = (doc: unknown, templateId: string, take: number) => {
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(doc)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take };
  const result = composeAllTracks(p, { seed: 11 });
  return { project: { ...p, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

/* ---- folds ---- */
const foldTotals: Record<string, { folded: number; hard: number; dbl: number }> = {};
for (const templateId of ['ensemble.cinematic', 'ensemble.symphony']) {
  for (let take = 1; take <= 10; take++) {
    for (const fixTag of ['dorian', 'three']) {
      const { project } = compose(FIX[fixTag], templateId, take);
      const stats: FoldStats = { folded: {}, droppedHardRange: {}, droppedDoubling: {} };
      for (const t of exportableTracks(project, 'all')) chunksForTrack(project, t, PROFILE, stats);
      for (const [key, rec] of [['folded', stats.folded], ['hard', stats.droppedHardRange], ['dbl', stats.droppedDoubling]] as const) {
        for (const [part, n] of Object.entries(rec)) {
          foldTotals[part] ??= { folded: 0, hard: 0, dbl: 0 };
          foldTotals[part][key] += n;
        }
      }
    }
  }
}
console.log('FOLDS (cinematic+symphony, takes 1-10, both fixtures):');
for (const [part, s] of Object.entries(foldTotals)) console.log(`  ${part}: folded=${s.folded} droppedHardRange=${s.hard} droppedDoubling=${s.dbl}`);
if (!Object.keys(foldTotals).length) console.log('  (none — every composed note already sits at or above its part playableLow)');

/* ---- energy before/after ---- */
console.log('\nENERGY (mean/peak window energy, 2 fixtures x takes 1-10):');
for (const templateId of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
  const short = templateId.replace('ensemble.', '');
  let meanAfter = 0; let peakAfter = 0; let n = 0;
  let meanBefore = 0; let peakBefore = 0;
  for (let take = 1; take <= 10; take++) {
    for (const fixTag of ['dorian', 'three']) {
      const { project } = compose(FIX[fixTag], templateId, take);
      const template = resolveTemplate(project.ensemble)!;
      const rep = measureEnergy(project, template);
      const ws = rep.windows.filter((w) => w.energy > 0);
      meanAfter += ws.reduce((a, w) => a + w.energy, 0) / Math.max(1, ws.length);
      peakAfter = Math.max(peakAfter, rep.max);
      n++;
      // before: the Phase 8.1 golden tracks
      const golden = JSON.parse(readFileSync(`tests/golden-moments/${short}-${fixTag}-t${take}.json`, 'utf8'));
      const before: Project = { ...project, tracks: project.tracks.map((t) => {
        const g = golden.tracks.find((x: { id: string }) => x.id === t.id);
        return g ? { ...t, notes: g.notes, ...(g.cc !== undefined ? { cc: g.cc } : {}) } : (t.role === 'basses' ? { ...t, notes: [] } : t);
      }) };
      const repB = measureEnergy(before, template);
      const wsB = repB.windows.filter((w) => w.energy > 0);
      meanBefore += wsB.reduce((a, w) => a + w.energy, 0) / Math.max(1, wsB.length);
      peakBefore = Math.max(peakBefore, repB.max);
    }
  }
  console.log(`  ${short}: before mean=${(meanBefore / n).toFixed(4)} peak=${peakBefore.toFixed(4)} | after mean=${(meanAfter / n).toFixed(4)} peak=${peakAfter.toFixed(4)} | clampMax=${resolveTemplate({ templateId } as never)!.budget.energyClamp[1]}`);
}

/* ---- desk diffs (sanctioned) ---- */
console.log('\nDESK DIFF vs HEAD (3 split templates, both fixtures, takes 1-10):');
for (const templateId of ['ensemble.symphony', 'ensemble.cinematic', 'ensemble.hybridstudio']) {
  const short = templateId.replace('ensemble.', '');
  let removed = 0; let added = 0; let bassesNotes = 0; let octaveUps = 0; let routed = 0;
  for (let take = 1; take <= 10; take++) {
    for (const fixTag of ['dorian', 'three']) {
      const { project, result } = compose(FIX[fixTag], templateId, take);
      const golden = JSON.parse(readFileSync(`tests/golden-moments/${short}-${fixTag}-t${take}.json`, 'utf8'));
      const sig = (n: Note) => `${n.pitch}:${n.startTick}:${n.durationTicks}:${n.velocity}`;
      const cb = project.tracks.find((t) => t.role === 'cellosBasses')!;
      const g = golden.tracks.find((x: { id: string }) => x.id === cb.id);
      const cur = new Set(cb.notes.map(sig)); const base = new Set((g.notes as Note[]).map(sig));
      base.forEach((s) => { if (!cur.has(s)) removed++; });
      cur.forEach((s) => { if (!base.has(s)) added++; });
      bassesNotes += project.tracks.find((t) => t.role === 'basses')!.notes.length;
      const rep = result.reports.find((r) => r.startsWith('cello/basses split'))!;
      octaveUps += Number(rep.match(/(\d+) octave-up answers/)![1]);
      routed += Number(rep.match(/(\d+) note\(s\) routed/)![1]);
    }
  }
  console.log(`  ${short}: cello notes removed=${removed} added=${added} (vs HEAD) | basses desk notes=${bassesNotes} | routed=${routed} (octave-up answers=${octaveUps})`);
}

/* ---- roster list ---- */
console.log('\nROSTER (tracks beyond strings and brass):');
const roster = new Map<string, Set<string>>();
for (const templateId of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
  const t = resolveTemplate({ templateId } as never)!;
  for (const r of t.roster) {
    if (['violins1', 'violins2', 'violas', 'cellosBasses', 'horns', 'trumpets', 'trombones', 'tuba', 'basses'].includes(r.role)) continue;
    if (!roster.has(r.role)) roster.set(r.role, new Set());
    roster.get(r.role)!.add(t.id.replace('ensemble.', ''));
  }
}
const RANGE: Record<string, string> = {
  flutes: 'C4–C7', oboes: 'Bb3–A6', clarinets: 'D3–G6', bassoons: 'Bb1–Eb5',
  timpani: 'D2–A3', snare: 'D2 (fixed 38)', cymbals: 'C#3 (fixed 49)', aux: 'F#2 (fixed 42)',
  piano: 'A0–C8', harp: 'Cb1–G#7',
};
for (const [role, templates] of [...roster.entries()].sort()) {
  console.log(`  ${role} (${RANGE[role] ?? '?'}): ${[...templates].join(', ')}`);
}
console.log('\nEngine-touched today: NONE of the above — the strings module writes the string desks and the brass module the brass roster; every other family goes through the rules generator (generate()), which has written them since Phase 2.');
