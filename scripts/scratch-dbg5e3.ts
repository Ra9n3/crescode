import fixture from '../fixtures/dorian-16bars.json';
import { resolveTemplate } from '../src/config/ensembles';
import { stringsModule, stringVoiceTracks, prepareStrings, maybeLayerCellosBasses } from '../src/orchestrator/render';
import { conduct } from '../src/orchestrator/conductor';
import { chordSpans, sectionMap, energyCurve, orchestrationSeedFor } from '../src/orchestrator/spine';
import { projectFromFixture, type Project } from '../src/shared/schema';
import type { Note } from '../src/shared/schema/types';
import type { OrchestratorContext } from '../src/orchestrator/module';

const p = projectFromFixture(JSON.parse(JSON.stringify(fixture))) as Project;
const take = 2; // compose's internal take for test take 0
p.orchestration = { take };
const template = resolveTemplate(p.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} })!;
const ctx: OrchestratorContext = { project: p, template, ensemble: p.ensemble!, spans: chordSpans(p), sections: sectionMap(p) };
const seed = orchestrationSeedFor(p, p.orchestration);
const voiceTracks = stringVoiceTracks(ctx);
const arc = energyCurve(p, ctx.sections, take, template, true);
ctx.arc = arc;
const plan = conduct(ctx, arc);
ctx.lines = prepareStrings(ctx, take);
const plans = stringsModule.roles(ctx).map((pl) => ({
  ...pl,
  breathByTrack: Object.fromEntries(pl.voiceTrackIds.map((id) => [id, plan.breaths.filter((b) => b.trackIds.includes(id)).map((b) => [b.startTick, b.endTick] as [number, number])])),
}));
const notesByTrackId: Record<string, Note[]> = {};
for (const t of voiceTracks) notesByTrackId[t.id] = [];
for (const pl of plans) {
  const patch = stringsModule.render(ctx, pl, seed);
  for (const [id, notes] of Object.entries(patch.notesByTrackId)) notesByTrackId[id] = [...(notesByTrackId[id] ?? []), ...notes];
}
maybeLayerCellosBasses(ctx, notesByTrackId, voiceTracks.map((t) => t.id));
const cbId = voiceTracks.find((t) => t.role === 'cellosBasses')!.id;
console.log('rebuild cb 40000..41200:', notesByTrackId[cbId].filter((n) => n.startTick >= 40000 && n.startTick < 41200).map((n) => `${n.pitch}@${n.startTick}+${n.durationTicks}`).join(' '));
