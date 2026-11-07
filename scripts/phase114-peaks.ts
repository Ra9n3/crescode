/** Phase 11.4: the peak window energies vs the clamp (three-chorus, takes 1-10). */
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { projectFromFixture, type Project } from '../src/shared/schema';
import { resolveTemplate } from '../src/config/ensembles';

for (const t of ['symphony', 'chamber', 'cinematic', 'sonata', 'vocalbacking', 'hybridstudio']) {
  let peak = 0;
  let template = null as null | ReturnType<typeof resolveTemplate>;
  for (let take = 1; take <= 10; take++) {
    const p: Project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));
    p.ensemble = { templateId: `ensemble.${t}`, overrides: {}, pins: {} };
    p.orchestration = { take };
    const r = composeAllTracks(p, { seed: 11 });
    const proj = { ...p, tracks: r.tracks } as Project;
    template = resolveTemplate(p.ensemble);
    const rep = measureEnergy(proj, template!);
    peak = Math.max(peak, rep.max);
  }
  const clamp = template!.budget.energyClamp;
  console.log(`${t}: peak ${peak.toFixed(3)} vs clamp max ${clamp[1]} (floor ${clamp[0]})`);
}
