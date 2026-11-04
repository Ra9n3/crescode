/**
 * Compose All, orchestrator edition (spec §8, D9 compose order). Pure:
 * project in, tracks + take state out. The strings module renders FIRST;
 * its notes are then handed to the rules generator as role sources so
 * cross-family doubling parts ("Flutes double Vln I") double what the
 * strings actually wrote — while strings stay EXCLUDED from the generator's
 * own writing so no lane is written twice. Every other family keeps the
 * rules generator until its module exists. Locked and out-of-band tracks
 * are returned untouched (band semantics via isInBand, lock checks as in
 * the rules engine).
 *
 * The take increments here (inside the same edit the store wraps around this)
 * and seeds the strings module via orchestrationSeedFor: each Compose All is
 * a fresh take; same (inputs, take) → byte-identical.
 */
import { generate } from '../engine/generate';
import { freshEnsemble, isInBand } from '../shared/schema/band';
import { isInstrumentTrack, type Note, type OrchestrationState, type Project, type Track } from '../shared/schema/types';
import type { EnsembleTemplate } from '../shared/schema/ensembleTemplate';
import { resolveTemplate } from '../config/ensembles';
import { chordSpans, sectionMap, orchestrationSeedFor, energyCurve } from './spine';
import { stringsModule, stringVoiceTracks, prepareStrings, maybeLayerCellosBasses } from './render';
import { textureForType, sectionTypeKeyOf } from './conductor/layers';
import { conduct, type ConductorPlan } from './conductor';
import { governPadVelocities } from './energy/mix';
import type { OrchestratorContext } from './module';

export interface ComposeOptions {
  seed: number;
  density?: number;
  humanize?: boolean;
}

export interface ComposeResult {
  tracks: Track[];
  /** The take state to write in the SAME edit as the tracks. */
  orchestration: OrchestrationState;
  /** Track ids written by the strings module (the rest went through the rules generator). */
  stringsTrackIds: string[];
  /** The conductor's per-bar layer plan (3a) — an in-memory annotation for
   *  the audit stage. Never persisted; the store writes only tracks + take. */
  plan: ConductorPlan;
  /** Phase 4: renderer notes for the report (fallbacks, skipped layerings). */
  reports: string[];
}

export function composeAllTracks(project: Project, options: ComposeOptions): ComposeResult {
  const ensemble = project.ensemble ?? freshEnsemble();
  const template: EnsembleTemplate | null = resolveTemplate(project.ensemble);
  const lockedTrackIds = project.tracks.filter((t) => t.locked).map((t) => t.id);

  // the take this compose produces (increments the previous one)
  const orchestration: OrchestrationState = {
    take: (project.orchestration?.take ?? 0) + 1,
    ...(project.orchestration?.sectionTakes ? { sectionTakes: { ...project.orchestration.sectionTakes } } : {}),
    ...(project.orchestration?.sectionLocks ? { sectionLocks: [...project.orchestration.sectionLocks] } : {}),
  };

  const ctx: OrchestratorContext = { project: { ...project, orchestration }, template, ensemble, spans: chordSpans(project), sections: sectionMap(project) };
  const seed = orchestrationSeedFor(project, orchestration);
  const voiceTracks = stringVoiceTracks(ctx);
  // Phase 3c/3d: the per-bar energy arc, seeded per D8 — the near-silence
  // bar only when a template is active and unlocked in-band strings exist
  // to silence (locked lanes are never written either way).
  const arc = energyCurve(project, ctx.sections, orchestration.take, template, template !== null && voiceTracks.length > 0);
  ctx.arc = arc;
  const plan = conduct(ctx, arc);
  // Phase 4b: prepare the lines (motif + counterline + constrained voicing)
  // once per compose — the per-section render calls slice the result
  ctx.lines = prepareStrings(ctx, orchestration.take);
  // Phase 4.6: which texture each section type drew this take (the plan report)
  const typeOrder = [...new Set(ctx.sections.map((s) => sectionTypeKeyOf(s.name)))];
  ctx.lines.reports.push(`textures (take ${orchestration.take}): ${typeOrder.map((t) => `${t}=${textureForType(ctx, t).id}`).join(', ')}`);
  // the conductor's breaths ride into the strings plans per track (3a)
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
  const stringsTrackIds = voiceTracks.map((t) => t.id);
  // Phase 4.5: report how many measured tremolo repeats carried the lead
  if (ctx.lines.tremoloRepeats > 0) {
    ctx.lines.reports.push(`cinematic tremolo: ${ctx.lines.tremoloRepeats} measured repeats carry the lead motif (articulation 'tremolo')`);
  }
  // Phase 4f: Cb an octave below the Vc line inside cellosBasses, where the
  // policy allows doubling and the range holds both — otherwise reported+skipped
  maybeLayerCellosBasses(ctx, notesByTrackId, stringsTrackIds);

  // the rules generator covers every other family — strings excluded from
  // its WRITING, but their rendered notes feed its doublings (D9)
  const roleNotes = Object.entries(notesByTrackId).map(([id, notes]) => ({
    role: project.tracks.find((t) => t.id === id)!.role,
    notes,
  }));
  const ruleTracks = generate(project, {
    seed: options.seed,
    density: options.density,
    humanize: options.humanize,
    lockedTrackIds,
    excludeRoles: [...new Set(voiceTracks.map((t) => t.role))],
    roleNotes,
  });

  // Mixed-window governor: the pads' own cap bounds strings-only windows, but
  // real windows mix pads with the rules generator's output. Re-check every
  // beat window and pull pad velocities down where the MIX would breach the
  // template's hard clamp (spec §6, Phase-2 acceptance). No band → no clamp.
  const rosterRoles = new Set(
    (template ? template.roster.map((r) => r.role) : project.tracks.filter((t) => isInstrumentTrack(t) && isInBand(t.role, ensemble, template)).map((t) => t.role)),
  );
  governPadVelocities({
    project,
    template,
    rosterRoles,
    padNotes: new Map(stringsTrackIds.map((id) => [id, notesByTrackId[id]])),
    otherNotes: ruleTracks
      .filter((t) => !stringsTrackIds.includes(t.id))
      .map((t) => ({ role: t.role, notes: t.notes })),
  });

  const stringsNotes = new Map(stringsTrackIds.map((id) => [id, notesByTrackId[id]]));
  const tracks = project.tracks.map((t) => {
    if (!isInstrumentTrack(t)) return t;
    if (t.locked) return t; // lock wins
    if (!isInBand(t.role, ensemble, template)) return t; // out of band: untouched
    if (stringsNotes.has(t.id)) return { ...t, notes: stringsNotes.get(t.id)! };
    const gen = ruleTracks.find((r) => r.id === t.id);
    return gen ? { ...t, notes: gen.notes } : t;
  });

  return { tracks, orchestration, stringsTrackIds, plan, reports: [...ctx.lines!.reports] };
}
