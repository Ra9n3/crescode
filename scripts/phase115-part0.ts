/**
 * Phase 11.5 Part 0 — the answers owed from 11.4 (read-only):
 *   0.1  the pushed 11.4 commit hash and whether golden104 (120 files) is in it
 *        (answered from git directly in the report; this script prints nothing for it);
 *   0.2  the roster-less tracks in chamber, sonata and vocalbacking (brass, winds,
 *        percussion) — are they empty/absent in golden104;
 *   0.3  the chorus below-floor counts and the chorus peaks against the clamp,
 *        per template (three-chorus, takes 1-10, moment-covered bars excluded from
 *        the below-floor reading exactly like the 11.4 report; the peak reads ALL
 *        chorus windows including the moment bars — the hard clamp binds everywhere).
 *   npx vite-node scripts/phase115-part0.ts
 */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';
import { isChorusTypeK } from '../src/orchestrator/keys/profile';
import { readFileSync } from 'node:fs';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const ROSTERLESS = new Set(['horns', 'trumpets', 'trombones', 'tuba', 'flutes', 'oboes', 'clarinets', 'bassoons', 'timpani', 'snare', 'cymbals', 'aux']);

/* ---- 0.2: the roster-less tracks in golden104 (chamber, sonata, vocalbacking) */
console.log('=== 0.2  roster-less tracks (brass / winds / percussion roles) in golden104 ===');
for (const t of ['chamber', 'sonata', 'vocalbacking']) {
  for (const fix of ['three', 'dorian']) {
    let present: string[] = [];
    let notesInThem = 0;
    for (let take = 1; take <= 10; take++) {
      const g = JSON.parse(readFileSync(new URL(`../tests/golden104/${t}-${fix}-t${take}.json`, import.meta.url), 'utf8'));
      for (const tr of g.tracks) {
        if (ROSTERLESS.has(tr.role)) {
          if (!present.includes(tr.role)) present.push(tr.role);
          notesInThem += (tr.notes ?? []).length;
        }
      }
    }
    console.log(`${t}-${fix}: roster-less roles present ${JSON.stringify(present)}, notes in them ${notesInThem} over 10 takes`);
  }
}

/* ---- 0.3: the chorus below-floor counts and the chorus peaks vs the clamp ---- */
console.log('\n=== 0.3  chorus below-floor counts and chorus peaks vs the clamp (three-chorus, takes 1-10) ===');
const secs = (threeChorus as { sections: { name: string; startBar: number; lengthBars: number }[] }).sections;
for (const templateId of TEMPLATES) {
  const short = templateId.replace('ensemble.', '');
  const template = resolveTemplate({ templateId, overrides: {}, pins: {} })!;
  const floor = template.budget.energyClamp[0];
  const clampMax = template.budget.energyClamp[1];
  let below = 0;
  let windows = 0;
  let peak = 0;
  for (let take = 1; take <= 10; take++) {
    const g = JSON.parse(readFileSync(new URL(`../tests/golden104/${short}-three-t${take}.json`, import.meta.url), 'utf8'));
    const p: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    p.ensemble = { templateId, overrides: {}, pins: {} };
    const momentBars = new Set<number>();
    for (const m of g.moments ?? []) for (let b = m.startBar; b <= m.endBar; b++) momentBars.add(b);
    // the golden track list (the engine-inserted basses desk included), with the
    // fixture's track objects as the field donors — the 11.4 report's reading
    const beforeTracks = (g.tracks as { id: string; role: string; notes: { pitch: number; startTick: number; durationTicks: number; velocity: number }[] }[]).map((gt) => {
      const donor = p.tracks.find((x) => x.id === gt.id);
      if (donor) return { ...donor, notes: gt.notes };
      return {
        id: gt.id, role: gt.role, name: gt.role, family: 'Strings',
        kind: 'instrument', locked: false, notes: gt.notes,
        lowestNote: 21, highestNote: 108, volume: 0.8, pan: 0,
      } as unknown as typeof p.tracks[number];
    });
    const proj: Project = { ...p, tracks: beforeTracks };
    const rep = measureEnergy(proj, template);
    for (const w of rep.windows) {
      const sec = secs.find((s) => w.bar >= s.startBar && w.bar < s.startBar + s.lengthBars);
      if (!sec || !isChorusTypeK(sec.name)) continue;
      if (!momentBars.has(w.bar)) {
        windows++;
        if (w.energy > 0 && w.energy < floor) below++;
      }
      peak = Math.max(peak, w.energy);
    }
  }
  console.log(`${short}: chorus below-floor (excl moments) ${below}/${windows}, chorus peak ${peak.toFixed(3)} vs clamp max ${clampMax} (floor ${floor})`);
}

/* ---- sanity: the live engine at this HEAD stays on golden104 for one probe run ---- */
{
  const templateId = 'ensemble.chamber';
  const p: Project = projectFromFixture(JSON.parse(JSON.stringify(dorian)));
  p.ensemble = { templateId, overrides: {}, pins: {} };
  p.orchestration = { take: 1 };
  const r = composeAllTracks(p, { seed: 11 });
  const proj = { ...p, tracks: r.tracks, orchestration: r.orchestration } as Project;
  const template = resolveTemplate(p.ensemble)!;
  const hard = checkTemplateRules(proj, template, r.plan).filter((f) => f.severity === 'hard');
  const rep = measureEnergy(proj, template);
  const above = rep.violations.filter((v) => v.kind === 'aboveMax');
  console.log(`\nsanity probe (chamber dorian t1): hard findings ${hard.length}, aboveMax ${above.length}`);
}
