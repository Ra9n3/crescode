/* One-off debug: find the offset-range violator in the 5.1.3 matrix cells. */
import fixture from '../fixtures/dorian-16bars.json';
import { resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { BASS_TIMING_MS, CB_FOLLOW_MAX_MS, VIOLIN_TIMING_MS } from '../src/orchestrator/expression/humanize';
import { stringsModule, stringVoiceTracks, prepareStrings, maybeLayerCellosBasses } from '../src/orchestrator/render';
import { conduct } from '../src/orchestrator/conductor';
import { chordSpans, sectionMap, energyCurve, orchestrationSeedFor, ticksToMs } from '../src/orchestrator/spine';
import { projectFromFixture } from '../src/shared/schema';
import type { Note, Project } from '../src/shared/schema/types';
import type { OrchestratorContext } from '../src/orchestrator/module';

const TEMPLATES = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio'];
const KEYS = [{ key: 2, mode: 'Dorian' }, { key: 0, mode: 'Ionian' }, { key: 9, mode: 'Aeolian' }];

const preHumanizeStrings = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  const orchestration = { take: take + 1 };
  const template = resolveTemplate(project.ensemble)!;
  const ctx: OrchestratorContext = {
    project: { ...project, orchestration }, template, ensemble: project.ensemble!,
    spans: chordSpans(project), sections: sectionMap(project),
  };
  const seed = orchestrationSeedFor(project, orchestration);
  const voiceTracks = stringVoiceTracks(ctx);
  const arc = energyCurve(project, ctx.sections, orchestration.take, template, true);
  ctx.arc = arc;
  const plan = conduct(ctx, arc);
  ctx.lines = prepareStrings(ctx, orchestration.take);
  const plans = stringsModule.roles(ctx).map((pl) => ({
    ...pl,
    breathByTrack: Object.fromEntries(
      pl.voiceTrackIds.map((id) => [id, plan.breaths.filter((b) => b.trackIds.includes(id)).map((b) => [b.startTick, b.endTick] as [number, number])]),
    ),
  }));
  const notesByTrackId: Record<string, Note[]> = {};
  for (const t of voiceTracks) notesByTrackId[t.id] = [];
  for (const pl of plans) {
    const patch = stringsModule.render(ctx, pl, seed);
    for (const [id, notes] of Object.entries(patch.notesByTrackId)) {
      notesByTrackId[id] = [...(notesByTrackId[id] ?? []), ...notes];
    }
  }
  maybeLayerCellosBasses(ctx, notesByTrackId, voiceTracks.map((t) => t.id));
  return { notesByTrackId, voiceTrackIds: voiceTracks.map((t) => t.id) };
};

for (const bpm of [60, 180]) {
  for (const templateId of TEMPLATES) {
    for (const k of KEYS) {
      for (let take = 0; take <= 2; take++) {
        const p0 = projectFromFixture(JSON.parse(JSON.stringify(fixture)));
        const p = { ...p0, bpm, tempoMap: [{ tick: 0, bpm }], key: k.key as Project['key'], mode: k.mode as Project['mode'], ensemble: { templateId, overrides: {}, pins: {} }, orchestration: { take } };
        const result = composeAllTracks(p, { seed: 11 });
        const project = { ...p, tracks: result.tracks } as Project;
        const pre = preHumanizeStrings(
          { ...JSON.parse(JSON.stringify(p0)), bpm, tempoMap: [{ tick: 0, bpm }], key: k.key, mode: k.mode } as Project, templateId, take);
        const roleOf = new Map(project.tracks.map((t) => [t.id, t.role]));
        for (const id of pre.voiceTrackIds) {
          const role = roleOf.get(id)!;
          const range = role === 'cellosBasses' ? BASS_TIMING_MS : VIOLIN_TIMING_MS;
          const pool = new Map<string, Note[]>();
          for (const b of pre.notesByTrackId[id]) {
            const kk = `${b.pitch}:${b.startTick + b.durationTicks}`;
            (pool.get(kk) ?? pool.set(kk, []).get(kk)!).push(b);
          }
          const after = project.tracks.find((t) => t.id === id)!.notes;
          for (const a of after) {
            const cands = pool.get(`${a.pitch}:${a.startTick + a.durationTicks}`);
            if (!cands || !cands.length) continue;
            let best = -1;
            for (let i = 0; i < cands.length; i++) {
              if (cands[i].startTick <= a.startTick && (best < 0 || cands[i].startTick > cands[best].startTick)) best = i;
            }
            if (best < 0 || a.startTick - cands[best].startTick > 200) continue;
            const b = cands.splice(best, 1)[0];
            const ms = ticksToMs(a.startTick, project.tempoMap) - ticksToMs(b.startTick, project.tempoMap);
            const isDouble = role === 'cellosBasses' && pre.notesByTrackId[id].some((m) => m !== b && m.pitch === b.pitch + 12 && m.startTick === b.startTick);
            const top = range[1] + (isDouble ? CB_FOLLOW_MAX_MS : 0);
            if (bpm === 180 && templateId === 'ensemble.hybridstudio' && role === 'cellosBasses') {
              console.log(`  cell k${k.key} t${take}: ms=${ms.toFixed(2)} ticks=${a.startTick - b.startTick} top=${top} isDouble=${isDouble} pitch=${b.pitch} start=${b.startTick} end=${b.startTick + b.durationTicks}`);
            }
            if (ms > top + ticksToMs(1, project.tempoMap) + 1e-6) {
              console.log(`VIOLATOR ${bpm}bpm ${templateId} key${k.key} take${take} ${role}: ms=${ms.toFixed(2)} top=${top} ticks=${a.startTick - b.startTick} pitch=${b.pitch} start=${b.startTick} isDouble=${isDouble}`);
              const same = pre.notesByTrackId[id].filter((m) => m.startTick === b.startTick);
              console.log('  same-start pre notes:', JSON.stringify(same));
              const afterSame = after.filter((m) => m.pitch === a.pitch && Math.abs(m.startTick - a.startTick) < 200 && m !== a);
              console.log('  near after notes:', JSON.stringify(afterSame));
              process.exit(0);
            }
          }
        }
      }
    }
  }
}
console.log('no violator found');
