import fixture from '../fixtures/dorian-16bars.json';
import { humanizeStrings } from '../src/orchestrator/expression/humanize';
import { resolveTemplate } from '../src/config/ensembles';
import { stringsModule, stringVoiceTracks, prepareStrings, maybeLayerCellosBasses } from '../src/orchestrator/render';
import { chordSpans, sectionMap, energyCurve, orchestrationSeedFor } from '../src/orchestrator/spine';
import { projectFromFixture, type Project } from '../src/shared/schema';
import type { Note, OrchestratorContext } from '../src/orchestrator/module';
import type { OrchestratorContext as OC } from '../src/orchestrator/module';

const p = projectFromFixture(JSON.parse(JSON.stringify(fixture))) as Project;
const take = 0;
p.orchestration = { take };
const template = resolveTemplate(p.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: {} })!;
const ctx: OC = { project: p, template, ensemble: p.ensemble!, spans: chordSpans(p), sections: sectionMap(p) };
const seed = orchestrationSeedFor(p, p.orchestration);
const voiceTracks = stringVoiceTracks(ctx);
const arc = energyCurve(p, ctx.sections, take, template, true);
ctx.arc = arc;
ctx.lines = prepareStrings(ctx, take);
const plans = stringsModule.roles(ctx).map((pl) => ({ ...pl, breathByTrack: {} }));
const notesByTrackId: Record<string, Note[]> = {};
for (const t of voiceTracks) notesByTrackId[t.id] = [];
for (const pl of plans) {
  const patch = stringsModule.render(ctx, pl, seed);
  for (const [id, notes] of Object.entries(patch.notesByTrackId)) notesByTrackId[id] = [...(notesByTrackId[id] ?? []), ...notes];
}
maybeLayerCellosBasses(ctx, notesByTrackId, voiceTracks.map((t) => t.id));
for (const [id, notes] of Object.entries(notesByTrackId)) {
  // count same-pitch overlapping pairs
  let overlaps = 0;
  for (const a of notes) for (const b of notes) {
    if (a !== b && a.pitch === b.pitch && b.startTick > a.startTick && b.startTick < a.startTick + a.durationTicks) overlaps++;
  }
  console.log(p.tracks.find((t) => t.id === id)!.role, notes.length, 'same-pitch overlaps:', overlaps);
}
const humanized = humanizeStrings({ project: p, template, sections: ctx.sections, notesByTrackId });
for (const [id, notes] of Object.entries(humanized)) console.log('after:', p.tracks.find((t) => t.id === id)!.role, notes.length);
