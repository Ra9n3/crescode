/**
 * Production Compose All coordinator (spec §8, D9 compose order). Pure:
 * project in, tracks + take state out. Strings render first through the
 * SectionModule interface; their notes become role sources for the generic
 * rules interpreter (for example, cross-family doublings), while strings are
 * excluded from generator writes. The coordinator also runs the dedicated
 * Brass, Winds, Percussion, and Keys renderers. `generate` supplies remaining
 * rules-driven work and compatibility inputs; it is not the sole owner of
 * non-string output. The keys renderer supplies Harp and intermediate Piano
 * candidates; Piano Engine V5 replaces final Piano output after all non-Piano
 * tracks are finalized. Locked and out-of-band tracks remain protected.
 *
 * The take increments here (inside the same edit the store wraps around this)
 * and seeds the strings module via orchestrationSeedFor: each Compose All is
 * a fresh take; same (inputs, take) → byte-identical.
 */
import { generate } from '../engine/generate';
import { freshEnsemble, isInBand } from '../shared/schema/band';
import { isInstrumentTrack, type CcLane, type CcPoint, type Note, type OrchestrationState, type Project, type Track } from '../shared/schema/types';
import type { EnsembleTemplate } from '../shared/schema/ensembleTemplate';
import { resolveTemplate } from '../config/ensembles';
import { chordSpans, sectionMap, orchestrationSeedFor, energyCurve } from './spine';
import { stringsModule, stringVoiceTracks, prepareStrings, maybeLayerCellosBasses } from './render';
import { splitCelloLine, materializeBasses, bassesTrackFor, insertBassesTrack, splitEngaged, BASSES_ROLE, BASSES_TRACK_ID, type SplitResult } from './basses';
import { textureForType, sectionTypeKeyOf } from './conductor/layers';
import { conduct, type ConductorPlan } from './conductor';
import { governPadVelocities } from './energy/mix';
import { maxMeanVelocityFor } from './energy';
import { chordTones } from './voicing/chordTones';
import { leadingTonePcOf } from './voicing/voiceLead';
import { scalePitchClasses } from '../shared/schema/modes';
import { barTicks, beatTicks, projectBars, projectEndTick } from '../shared/schema/meter';
import { buildCcLanes } from './expression/cc';
import { humanizeStrings } from './expression/humanize';
import { overlapLegato } from './expression/legato';
import { renderBrass, governBrassVelocities } from './brass/render';
import { BRASS_PARTS } from './brass/profile';
import { EMPTY_BRASS_PLAN } from './brass/plan';
import { renderWinds, governWindsVelocities } from './winds/render';
import { WIND_PARTS } from './winds/profile';
import { EMPTY_WIND_PLAN } from './winds/plan';
import { renderPercussion, governPercussionVelocities } from './percussion/render';
import { PERC_PARTS } from './percussion/profile';
import { EMPTY_PERC_PLAN } from './percussion/plan';
import { renderKeys, governKeysVelocities, absorbPianoVelocities, repairPianoOctavesAfterHumanize } from './keys/render';
import { KEYS_PARTS } from './keys/profile';
import { EMPTY_KEYS_PLAN } from './keys/plan';
import { buildPianoEngineInput, type PianoEngineInput } from './keys/piano-engine';
import { analyzePianoInput } from './keys/piano-analyzer';
import { composePianoPlan } from './keys/piano-composer';
import { realizePianoPlanWithAudit } from './keys/piano-realizer';
import type { OrchestratorContext } from './module';

export interface ComposeOptions {
  seed: number;
  density?: number;
  humanize?: boolean;
  /** Phase 7: plan moments (default true). Tests disable them to pin that
   *  the texture draws are untouched outside moment bars. */
  moments?: boolean;
}

export interface ComposeResult {
  tracks: Track[];
  /** The take state to write in the SAME edit as the tracks. */
  orchestration: OrchestrationState;
  /** Track IDs written by the strings module; other output comes from family renderers and/or the generic rules interpreter. */
  stringsTrackIds: string[];
  /** The conductor's per-bar layer plan (3a) — an in-memory annotation for
   *  the audit stage. Never persisted; the store writes only tracks + take. */
  plan: ConductorPlan;
  /** Phase 4: renderer notes for the report (fallbacks, skipped layerings). */
  reports: string[];
  /**
   * Ephemeral, immutable Piano Engine V5 input used during this compose.
   * It is non-enumerable and never enters Project persistence or export.
   */
  readonly pianoEngineInput: PianoEngineInput;
}

/** Merge V5-generated pedal automation with authored CC64 when supplied. */
function composePianoCc64(
  generatedControllers: readonly CcLane[],
  authoredControllers: readonly CcLane[] | undefined,
  projectEndTick: number,
): CcLane[] | undefined {
  const generated = generatedControllers.find((lane) => lane.cc === 64);
  const authored = authoredControllers?.find((lane) => lane.cc === 64);
  if (!generated && !authored) return undefined;

  const samePoints = (left: readonly CcPoint[], right: readonly CcPoint[]): boolean =>
    left.length === right.length && left.every((point, index) =>
      point.tick === right[index].tick && point.value === right[index].value);
  // The merged MIDI lane is stored on the project track. On a later Compose,
  // recover its original source events instead of feeding the previous take's
  // generated points back in as if they had been authored.
  const provenance = authored?.pianoV2Pedal;
  const authoredPoints = provenance && samePoints(authored.points, provenance.mergedPoints)
    ? provenance.authoredPoints
    : authored?.points ?? [];

  const byTick = new Map<number, { value: number; priority: number; order: number }>();
  let order = 0;
  const add = (source: readonly CcPoint[], priority: number) => {
    for (const point of source) {
      if (!Number.isInteger(point.tick) || !Number.isInteger(point.value)) continue;
      const tick = Math.max(0, Math.min(projectEndTick, point.tick));
      const value = Math.max(0, Math.min(127, point.value));
      const existing = byTick.get(tick);
      if (!existing || priority > existing.priority || (priority === existing.priority && order > existing.order)) {
        byTick.set(tick, { value, priority, order });
      }
      order++;
    }
  };
  // Preserve source events, while V5's planned value wins at a shared tick.
  add(authoredPoints, 0);
  add(generated?.points ?? [], 1);

  const points: CcPoint[] = [];
  for (const [tick, event] of [...byTick.entries()].sort((a, b) => a[0] - b[0])) {
    if (points[points.length - 1]?.value === event.value) continue;
    points.push({ tick, value: event.value });
  }
  const last = points[points.length - 1];
  if (last && last.value !== 0) {
    if (last.tick === projectEndTick) last.value = 0;
    else points.push({ tick: projectEndTick, value: 0 });
  }
  if (!points.length) return undefined;
  const copyPoints = (source: readonly CcPoint[]) => source.map(({ tick, value }) => ({ tick, value }));
  const mergedPoints = copyPoints(points);
  return [{
    cc: 64,
    points: mergedPoints,
    pianoV2Pedal: {
      generatedPoints: copyPoints(generated?.points ?? []),
      authoredPoints: copyPoints(authoredPoints),
      mergedPoints: copyPoints(mergedPoints),
    },
  }];
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
  const plan = conduct(ctx, arc, options.moments !== false);
  // Phase 4b: prepare the lines (motif + counterline + constrained voicing)
  // once per compose — the per-section render calls slice the result
  ctx.lines = prepareStrings(ctx, orchestration.take);
  // Phase 4.6: which texture each section type drew this take (the plan report)
  const typeOrder = [...new Set(ctx.sections.map((s) => sectionTypeKeyOf(s.name)))];
  ctx.lines.reports.push(`textures (take ${orchestration.take}): ${typeOrder.map((t) => `${t}=${textureForType(ctx, t).id}`).join(', ')}`);
  // Phase 4.8: the drawn ostinato style per section type — cell/contour/
  // accent/density, plus the two-track pairing where the texture has one
  const OST_TEX_IDS = new Set(['singleOstinato', 'interlockingOstinato', 'pizzPulse', 'trailer']);
  const styleLine = typeOrder
    .map((t) => {
      const tex = textureForType(ctx, t);
      if (!OST_TEX_IDS.has(tex.id)) return null;
      const s = tex.style;
      return `${t}=${s.cell}/${s.contour}/${s.accent}/${s.density}${s.pairing !== 'unison' ? `/${s.pairing}` : ''}`;
    })
    .filter(Boolean)
    .join(', ');
  if (styleLine) ctx.lines.reports.push(`ostinato style (take ${orchestration.take}): ${styleLine}`);
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

  // The generic rules generator contributes rules-driven parts and
  // compatibility inputs alongside the family renderers. Strings render
  // first and become D9 role sources, but are excluded from generator writes;
  // brass roles are also excluded because renderBrass owns their output.
  // Generator notes for winds, percussion, and keys remain as phantom inputs
  // to established window/governor calculations. Dedicated renderers supply
  // the family output at assembly: the keys renderer writes Harp and
  // intermediate Piano, which Piano Engine V5 replaces later in this pipeline.
  const roleNotes = Object.entries(notesByTrackId).map(([id, notes]) => ({
    role: project.tracks.find((t) => t.id === id)!.role,
    notes,
  }));
  const brassRosterRoles = template
    ? template.roster.filter((r) => (BRASS_PARTS as readonly string[]).includes(r.role)).map((r) => r.role)
    : [];
  const windRosterRoles = template
    ? template.roster.filter((r) => (WIND_PARTS as readonly string[]).includes(r.role)).map((r) => r.role)
    : [];
  const percRosterRoles = template
    ? template.roster.filter((r) => (PERC_PARTS as readonly string[]).includes(r.role)).map((r) => r.role)
    : [];
  const keysRosterRoles = template
    ? template.roster.filter((r) => (KEYS_PARTS as readonly string[]).includes(r.role)).map((r) => r.role)
    : [];
  const ruleTracks = generate(project, {
    seed: options.seed,
    density: options.density,
    humanize: options.humanize,
    lockedTrackIds,
    excludeRoles: [...new Set([...voiceTracks.map((t) => t.role), ...brassRosterRoles, BASSES_ROLE])],
    roleNotes,
  });

  // Phase 7: the tutti moment's hit for the families the strings module does
  // not write. The moment is defined over the ROSTER (participantRoles);
  // strings are only the first participants (they hit via the renderer from
  // their DP pitch). One chord — the span's bass/root pitch class, octave-
  // fitted or the fixed note for unpitched parts — marcato accent, then the
  // drawn shape. Velocity sits under the WHOLE-ROSTER cap, so the hard
  // clamp holds no matter what else sounds in the window.
  const btBarC = barTicks(project.timeSignature);
  const beatC = beatTicks(project.timeSignature);
  const clampMaxC = template?.budget.energyClamp[1] ?? 1;
  const rosterSizeC = Math.max(1, template?.roster.length ?? 1);
  const capAllC = maxMeanVelocityFor(rosterSizeC, clampMaxC, rosterSizeC);
  for (const m of plan.moments) {
    if (m.kind !== 'tutti' || !m.participantRoles) continue;
    const downbeat = (m.startBar - 1) * btBarC;
    const span = ctx.spans.find((s) => s.startTick <= downbeat && downbeat < s.endTick) ?? ctx.spans[0];
    if (!span) continue;
    const rootPc = ((chordTones(span.parsed).bassPc % 12) + 12) % 12;
    const E = Math.min(clampMaxC, Math.max(0, arc[m.startBar - 1]?.target ?? 0));
    const velocity = Math.max(1, Math.min(capAllC, Math.round(1 + (capAllC - 1) * E)));
    const hitLen = m.shape === 'breath' ? beatC : m.shape === 'decay' ? beatC * 2 : btBarC;
    const roles = new Set(m.participantRoles);
    // writable = in-band unlocked non-string roster tracks (the strings hit
    // via the renderer; locked and out-of-band tracks are never touched)
    const writableIds = new Set(
      project.tracks
        .filter((t) => isInstrumentTrack(t) && !t.locked && roles.has(t.role) && !stringsTrackIds.includes(t.id)
          && isInBand(t.role, project.ensemble!, template))
        .map((t) => t.id),
    );
    for (const t of ruleTracks) {
      if (!writableIds.has(t.id)) continue;
      let pitch: number;
      if (t.highestNote - t.lowestNote < 12) {
        pitch = t.lowestNote; // unpitched/fixed parts hit their own note
      } else {
        pitch = t.lowestNote + (((rootPc - t.lowestNote) % 12) + 12) % 12;
        while (pitch > t.highestNote) pitch -= 12;
      }
      t.notes.push({ pitch, startTick: downbeat, durationTicks: hitLen, velocity, articulation: 'marcato' });
    }
  }

  // Phase 8: brass — the module realises the conductor's plan AFTER the
  // generator and the tutti hits, so the two-pass velocity math sees every
  // other family's notes: each brass note is capped by the governor bound of
  // every beat window it touches, and the whole-roster cap shapes the
  // moment notes. The generator no longer writes the template's brass.
  const brassPlan = ctx.brassPlan ?? EMPTY_BRASS_PLAN;
  const brassResult = renderBrass({
    ctx,
    plan: brassPlan,
    stringsNotes: notesByTrackId,
    ruleNotes: ruleTracks.filter((t) => !stringsTrackIds.includes(t.id)).map((t) => ({ role: t.role, notes: t.notes })),
  });
  const brassNotes = brassResult.notesByTrackId;
  ctx.lines!.reports.push(...brassPlan.reports, ...brassResult.reports);
  const brassOther = Object.entries(brassNotes).map(([id, notes]) => ({
    role: project.tracks.find((t) => t.id === id)!.role,
    notes,
  }));

  // Phase 9: winds — the module realises the conductor's plan AFTER the
  // brass renderer, so the velocity math sees every other family's notes
  // (each wind note is capped by the governor bound of every beat window it
  // touches, over strings + generator + brass + winds) and the brass
  // windowing (§14.6) reads the rendered brass. The generator's own wind
  // notes stay in as the phantom input; the generator's entries for the
  // EXCLUDED roles (brass, the basses desk) carry the project's stale
  // pre-compose notes and are filtered out — the fresh brass rides in via
  // brassNotes, so a re-compose measures the same windows as a fresh one.
  const windPlan = ctx.windPlan ?? EMPTY_WIND_PLAN;
  const windRuleNotes = ruleTracks
    .filter((t) => !stringsTrackIds.includes(t.id) && !brassRosterRoles.includes(t.role) && t.role !== BASSES_ROLE)
    .map((t) => ({ role: t.role, notes: t.notes }));
  const windResult = renderWinds({
    ctx,
    plan: windPlan,
    stringsNotes: notesByTrackId,
    brassNotes,
    ruleNotes: windRuleNotes,
  });
  const windNotes = windResult.notesByTrackId;
  ctx.lines!.reports.push(...windPlan.reports, ...windResult.reports);
  const windsOther = Object.entries(windNotes).map(([id, notes]) => ({
    role: project.tracks.find((t) => t.id === id)!.role,
    notes,
  }));

  // Phase 10: percussion — the module realises the conductor's plan AFTER
  // the winds renderer, so the velocity math sees every other family's notes
  // (each hit is capped by the governor bound of every beat window it
  // touches, over strings + generator + brass + winds + percussion) and the
  // final safety pass below re-checks the clamp over the FINAL notes. The
  // generator's own percussion notes stay in as the phantom input (they keep
  // the pad governor's and the brass/wind caps' window math byte-identical
  // to HEAD — §15.2); the module's notes REPLACE the phantom at assembly, so
  // the module owns the sound while the architecture stays pinned.
  const percPlan = ctx.percussionPlan ?? EMPTY_PERC_PLAN;
  const windRosterRolesC = template
    ? template.roster.filter((r) => (WIND_PARTS as readonly string[]).includes(r.role)).map((r) => r.role)
    : [];
  const percRuleNotes = ruleTracks
    .filter((t) => !stringsTrackIds.includes(t.id) && !brassRosterRoles.includes(t.role) && t.role !== BASSES_ROLE && !windRosterRolesC.includes(t.role))
    .map((t) => ({ role: t.role, notes: t.notes }));
  const percResult = renderPercussion({
    ctx,
    plan: percPlan,
    stringsNotes: notesByTrackId,
    brassNotes,
    windNotes,
    ruleNotes: percRuleNotes,
  });
  const percussionNotes = percResult.notesByTrackId;
  ctx.lines!.reports.push(...percPlan.reports, ...percResult.reports);
  const percOther = Object.entries(percussionNotes).map(([id, notes]) => ({
    role: project.tracks.find((t) => t.id === id)!.role,
    notes,
  }));

  // Phase 11: the dedicated keys renderer realizes the conductor's plan after
  // the percussion renderer. Its V1 Piano notes and the generator's keys notes
  // remain compatibility inputs to established velocity/window calculations.
  // The keys renderer supplies final Harp output and intermediate Piano
  // candidates; Piano Engine V5 replaces Piano after every non-Piano part has
  // been finalized. The generic keys renderer emits no CC; V5 CC64 is composed
  // separately after final Piano realization.
  const keysPlan = ctx.keysPlan ?? EMPTY_KEYS_PLAN;
  const keysRuleNotes = ruleTracks
    .filter((t) => !stringsTrackIds.includes(t.id) && !brassRosterRoles.includes(t.role) && t.role !== BASSES_ROLE && !windRosterRolesC.includes(t.role) && !percRosterRoles.includes(t.role) && !keysRosterRoles.includes(t.role))
    .map((t) => ({ role: t.role, notes: t.notes }));
  const keysResult = renderKeys({
    ctx,
    plan: keysPlan,
    stringsNotes: notesByTrackId,
    brassNotes,
    windNotes,
    percNotes: percussionNotes,
    ruleNotes: keysRuleNotes,
  });
  const keysNotes = keysResult.notesByTrackId;
  ctx.lines!.reports.push(...keysPlan.reports, ...keysResult.reports);
  const keysOther = Object.entries(keysNotes).map(([id, notes]) => ({
    role: project.tracks.find((t) => t.id === id)!.role,
    notes,
  }));

  // Mixed-window governor: the pads' own cap bounds strings-only windows, but
  // real windows mix pads with the rules generator's output. Re-check every
  // beat window and pull pad velocities down where the MIX would breach the
  // template's hard clamp (spec §6, Phase-2 acceptance). No band → no clamp.
  // (Brass and winds are not inputs here — their notes are already
  // governor-capped and the final brass/winds safety passes below re-check
  // the clamp for them.)
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

  // Phase 8.2: the separate Double Basses desk (spec §3). The split engages
  // ONLY under an 'allowed' octaveDoubling policy (the cello's octave-up
  // answer over the basses' own pitch is itself an octave doubling) and only
  // for an unlocked, in-band cello — under climaxOnly/forbidden (chamber,
  // sonata, vocalbacking) the combined writing continues byte-identically.
  // The pass runs HERE — after the brass render and the first governor pass
  // (the generator, the tutti hits, the brass doubling source and the
  // governor all saw the exact pre-split list) and BEFORE humanize, so the
  // routed notes trail their cello partner (the octave-up or the doubled
  // line note) by 1–3 ms through the same partner pass the Cb doubles have
  // always used.
  const cbTrack = voiceTracks.find((t) => t.role === 'cellosBasses');
  const splitOn = !!cbTrack && !cbTrack.locked && splitEngaged(template);
  let splitReport: SplitResult | null = null;
  if (splitOn && cbTrack) {
    // the low-interval guard reads the low voices already written (the brass
    // candidates, §13.4): an octave-up answer that would sit closer than a
    // 5th under MIDI 48 against them is suppressed — the cello rests it
    const lowVoices = Object.values(brassNotes).flatMap((notes) =>
      notes.filter((n) => n.pitch < 48).map((n) => ({ startTick: n.startTick, durationTicks: n.durationTicks, pitch: n.pitch })));
    const ltPc = leadingTonePcOf(project.key, scalePitchClasses(project.key, project.mode));
    const { notes, result } = splitCelloLine(plan.moments, notesByTrackId[cbTrack.id] ?? [], lowVoices, project.tempoMap, ltPc);
    notesByTrackId[cbTrack.id] = notes;
    splitReport = result;
  }

  // Phase 5d: humanize the strings — POSITIVE section-correlated timing
  // offsets (start only, ends kept), a small velocity jitter that never
  // lifts a note above its windows' governor cap, Cb doubles trailing their
  // cello partner. Phase 5.1.2 then glues the legato passages: each legato
  // note's end reaches the next note's humanized start plus a seeded 10–30 ms
  // overlap (legato only, one voice per track, never past the section
  // window). The mix governor re-runs over the overlapped notes so
  // measureEnergy still cannot exceed the clamp, and the CC lanes (5c) are
  // built on the final score — their legato windows cover the overlap.
  const humanized = humanizeStrings({
    project: ctx.project,
    template,
    sections: ctx.sections,
    notesByTrackId,
    otherNotes: ruleTracks
      .filter((t) => !stringsTrackIds.includes(t.id))
      .map((t) => ({ role: t.role, notes: t.notes })),
  });
  for (const [id, notes] of Object.entries(humanized)) notesByTrackId[id] = notes;
  const overlapped = overlapLegato({
    project: ctx.project,
    sections: ctx.sections,
    notesByTrackId,
  });
  for (const [id, notes] of Object.entries(overlapped)) notesByTrackId[id] = notes;
  const pianoRepairTrackId = Object.keys(keysNotes).find((id) => project.tracks.find((track) => track.id === id)?.role === 'piano');
  if (template && pianoRepairTrackId) {
    const roleOfTrack = (id: string) => project.tracks.find((track) => track.id === id)?.role ?? '';
    const finalOtherNotes = [
      ...stringsTrackIds.map((id) => ({ role: roleOfTrack(id), trackId: id, notes: notesByTrackId[id] ?? [] })),
      ...Object.entries(brassNotes).map(([trackId, notes]) => ({ role: roleOfTrack(trackId), trackId, notes })),
      ...Object.entries(windNotes).map(([trackId, notes]) => ({ role: roleOfTrack(trackId), trackId, notes })),
      ...Object.entries(percussionNotes).map(([trackId, notes]) => ({ role: roleOfTrack(trackId), trackId, notes })),
      ...Object.entries(keysNotes).map(([trackId, notes]) => ({ role: roleOfTrack(trackId), trackId, notes })),
      ...ruleTracks.filter((track) => keysRuleNotes.some((entry) => entry.notes === track.notes))
        .map((track) => ({ role: track.role, trackId: track.id, notes: track.notes })),
    ];
    const octaveRepair = repairPianoOctavesAfterHumanize({
      ctx,
      template,
      pianoTrackId: pianoRepairTrackId,
      pianoNotes: keysNotes[pianoRepairTrackId],
      candidates: keysResult.pianoOctaveRepairCandidates,
      otherNotes: finalOtherNotes,
    });
    ctx.lines!.reports.push(`keys piano post-humanize octave repair: shifted ${octaveRepair.shifted}; hard pairs remaining ${octaveRepair.remainingHardPairs}`);
  }
  governPadVelocities({
    project,
    template,
    rosterRoles,
    padNotes: new Map(stringsTrackIds.map((id) => [id, notesByTrackId[id]])),
    otherNotes: ruleTracks
      .filter((t) => !stringsTrackIds.includes(t.id))
      .map((t) => ({ role: t.role, notes: t.notes })),
  });

  // Phase 8: the final brass safety pass — over the FINAL notes (humanize/
  // legato may have moved string attacks across window boundaries) lower
  // BRASS ALONE where the mix would breach the hard clamp. Expected no-op.
  if (template && brassOther.length) {
    governBrassVelocities({
      project: ctx.project,
      template,
      brass: brassOther,
      otherNotes: [
        ...ruleTracks.filter((t) => !stringsTrackIds.includes(t.id)).map((t) => ({ role: t.role, notes: t.notes })),
        ...stringsTrackIds.map((id) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes: notesByTrackId[id] ?? [] })),
      ],
    });
  }

  // Phase 9: the final winds safety pass — the same contract, WINDS ALONE.
  // The others exclude the wind roles (the module's own notes are the `winds`
  // input; the generator's phantom wind notes are not in the final score).
  // Expected no-op.
  const windRosterRoleSet = new Set(windRosterRoles);
  if (template && windsOther.length) {
    governWindsVelocities({
      project: ctx.project,
      template,
      winds: windsOther,
      otherNotes: [
        ...ruleTracks.filter((t) => !stringsTrackIds.includes(t.id) && !brassRosterRoles.includes(t.role) && t.role !== BASSES_ROLE && !windRosterRoleSet.has(t.role)).map((t) => ({ role: t.role, notes: t.notes })),
        ...stringsTrackIds.map((id) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes: notesByTrackId[id] ?? [] })),
        ...brassOther,
      ],
    });
  }

  // Phase 10: the final percussion safety pass — the same contract,
  // PERCUSSION ALONE. The others exclude the wind roles (the real winds ride
  // in via windsOther) and the percussion roles (the module's own notes are
  // the `percussion` input; the generator's phantom percussion is not in the
  // final score). Expected no-op.
  const percRosterRoleSet = new Set(percRosterRoles);
  if (template && percOther.length) {
    governPercussionVelocities({
      project: ctx.project,
      template,
      percussion: percOther,
      otherNotes: [
        ...ruleTracks.filter((t) => !stringsTrackIds.includes(t.id) && !brassRosterRoles.includes(t.role) && t.role !== BASSES_ROLE && !windRosterRoleSet.has(t.role) && !percRosterRoleSet.has(t.role)).map((t) => ({ role: t.role, notes: t.notes })),
        ...stringsTrackIds.map((id) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes: notesByTrackId[id] ?? [] })),
        ...brassOther,
        ...windsOther,
      ],
    });
  }

  // Phase 11.6a: piano-only absorption over the final mix windows. Its
  // order-independent per-note caps keep the held anchor and motion overlays
  // inside the clamp without moving the harp's golden105 velocities. The
  // final keys safety pass remains the hard guard (with the known
  // vocalbacking-only harp velocity residual). Uses FINAL other notes after
  // humanize/legato, matching the state the safety pass reads.
  const keysRosterRoleSet = new Set(keysRosterRoles);
  const pianoAbsorbTrackId = Object.keys(keysNotes).find((id) => project.tracks.find((t) => t.id === id)?.role === 'piano');
  const harpAbsorbTrackId = Object.keys(keysNotes).find((id) => project.tracks.find((t) => t.id === id)?.role === 'harp');
  if (template && pianoAbsorbTrackId) {
    if (keysResult.absorbWindows.length) {
      const absorption = absorbPianoVelocities({
        template,
        piano: { role: 'piano', notes: keysNotes[pianoAbsorbTrackId] },
        harp: harpAbsorbTrackId ? { role: 'harp', notes: keysNotes[harpAbsorbTrackId] } : null,
        otherNotes: [
          ...ruleTracks.filter((t) => !stringsTrackIds.includes(t.id) && !brassRosterRoles.includes(t.role) && t.role !== BASSES_ROLE && !windRosterRoleSet.has(t.role) && !percRosterRoleSet.has(t.role) && !keysRosterRoleSet.has(t.role)).map((t) => ({ role: t.role, notes: t.notes })),
          ...stringsTrackIds.map((id) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes: notesByTrackId[id] ?? [] })),
          ...brassOther,
          ...windsOther,
          ...percOther,
        ],
        windows: keysResult.absorbWindows,
      });
      ctx.lines!.reports.push(`piano absorption (take ${orchestration.take}): checked ${absorption.windows} windows; lowered ${absorption.loweredNotes} notes in ${absorption.loweredWindows} windows`);
    } else {
      ctx.lines!.reports.push(`piano absorption (take ${orchestration.take}): not needed (no piano windows)`);
    }
  }

  // Phase 11: the final keys safety pass — the same contract, KEYS ALONE.
  // The others exclude the wind, percussion and keys roles (the real ones
  // ride in via windsOther / percOther / the `keys` input; the generator's
  // phantoms are not in the final score). Expected no-op.
  if (template && keysOther.length) {
    governKeysVelocities({
      project: ctx.project,
      template,
      keys: keysOther,
      otherNotes: [
        ...ruleTracks.filter((t) => !stringsTrackIds.includes(t.id) && !brassRosterRoles.includes(t.role) && t.role !== BASSES_ROLE && !windRosterRoleSet.has(t.role) && !percRosterRoleSet.has(t.role) && !keysRosterRoleSet.has(t.role)).map((t) => ({ role: t.role, notes: t.notes })),
        ...stringsTrackIds.map((id) => ({ role: project.tracks.find((t) => t.id === id)?.role ?? '', notes: notesByTrackId[id] ?? [] })),
        ...brassOther,
        ...windsOther,
        ...percOther,
      ],
    });
  }
  // Phase 8.2: materialize the two desks — the 'cb'-marked notes (the Cb
  // doubles, the sub-36 line notes, the wide-unison -24 notes) leave the
  // cello list and become the Double Basses track (inserted after the cellos
  // in score order, or they refill the project's own basses track). The mark
  // is stripped: the track IS the bass desk. The desk joins the CC build like
  // every other sounding strings track (the user's Bass patch gets the same
  // expression arcs). The template roster is not touched — growing it would
  // change every governor cap (the chamber pin forbids that); the energy
  // measure counts the desk under the cellosBasses role instead.
  let bassesById = new Map<string, Note[]>();
  let bassesTrackId: string | null = null;
  let bassesNeedsTrack = false;
  if (splitOn && cbTrack) {
    const endTick = projectBars(project) * barTicks(project.timeSignature);
    const m = materializeBasses(notesByTrackId[cbTrack.id], endTick);
    notesByTrackId[cbTrack.id] = m.celloNotes;
    if (splitReport) {
      const sup = splitReport.octaveUpSuppressed ? `, ${splitReport.octaveUpSuppressed} octave-up answer(s) suppressed by the low-interval rule` : '';
      ctx.lines!.reports.push(
        `cello/basses split (take ${orchestration.take}): ${splitReport.routed} note(s) routed to the Double Basses desk (${splitReport.octaveUpCount} octave-up answers on the cello${sup}, ${splitReport.momentRouted} wide-unison notes), Cb doubles ride the desk`,
      );
    }
    const existingBasses = project.tracks.find((t) => t.role === BASSES_ROLE);
    if (existingBasses) {
      bassesTrackId = existingBasses.id;
      bassesById.set(existingBasses.id, m.bassesNotes);
    } else if (m.bassesNotes.length) {
      bassesTrackId = BASSES_TRACK_ID;
      bassesNeedsTrack = true;
      bassesById.set(BASSES_TRACK_ID, m.bassesNotes);
    }
  }

  // Phase 5c: CC lanes for the strings the orchestrator wrote — phrase arcs
  // (CC1/CC11), CC7 balance, CC74 spikes, CC68 legato windows, soft-entry
  // S-curves. Only in-band unlocked string tracks appear in notesByTrackId,
  // so locked and out-of-band tracks never get CC here.
  const ccByTrackId = buildCcLanes({
    project: ctx.project,
    template,
    sections: ctx.sections,
    arc,
    notesByTrackId: Object.fromEntries([
      ...stringsTrackIds.map((id) => [id, notesByTrackId[id] ?? []]),
      ...(bassesTrackId ? [[bassesTrackId, bassesById.get(bassesTrackId) ?? []] as [string, Note[]]] : []),
    ]),
    carrierByBar: ctx.lines!.carrierByBar,
  });
  const ccSummary = stringsTrackIds
    .map((id) => {
      const lanes = ccByTrackId[id];
      if (!lanes) return null;
      const name = project.tracks.find((t) => t.id === id)?.name ?? id;
      return `${name} ${lanes.length}L/${lanes.reduce((a, l) => a + l.points.length, 0)}P`;
    })
    .filter(Boolean)
    .join(', ');
  if (ccSummary) ctx.lines!.reports.push(`cc (take ${orchestration.take}): ${ccSummary}`);

  // Phase 8: brass CC lanes — the SAME generation the strings get (phrase
  // arches on CC1/CC11, soft-entry S-curves into the prepared entrances,
  // CC68/CC74/CC7), built from the final brass notes.
  const brassCcByTrackId = Object.keys(brassNotes).length
    ? buildCcLanes({
        project: ctx.project,
        template,
        sections: ctx.sections,
        arc,
        notesByTrackId: brassNotes,
        carrierByBar: ctx.lines!.carrierByBar,
      })
    : {};
  const brassCcSummary = Object.keys(brassNotes)
    .map((id) => {
      const lanes = brassCcByTrackId[id];
      if (!lanes) return null;
      const name = project.tracks.find((t) => t.id === id)?.name ?? id;
      return `${name} ${lanes.length}L/${lanes.reduce((a, l) => a + l.points.length, 0)}P`;
    })
    .filter(Boolean)
    .join(', ');
  if (brassCcSummary) ctx.lines!.reports.push(`brass cc (take ${orchestration.take}): ${brassCcSummary}`);

  // Phase 9: winds CC lanes — the SAME generation (§14: CC1 and CC11 lanes
  // use the same generation as strings and brass; wind swells are shaped by
  // phrase), built from the final wind notes.
  const windCcByTrackId = Object.keys(windNotes).length
    ? buildCcLanes({
        project: ctx.project,
        template,
        sections: ctx.sections,
        arc,
        notesByTrackId: windNotes,
        carrierByBar: ctx.lines!.carrierByBar,
      })
    : {};
  const windCcSummary = Object.keys(windNotes)
    .map((id) => {
      const lanes = windCcByTrackId[id];
      if (!lanes) return null;
      const name = project.tracks.find((t) => t.id === id)?.name ?? id;
      return `${name} ${lanes.length}L/${lanes.reduce((a, l) => a + l.points.length, 0)}P`;
    })
    .filter(Boolean)
    .join(', ');
  if (windCcSummary) ctx.lines!.reports.push(`winds cc (take ${orchestration.take}): ${windCcSummary}`);

  const stringsNotes = new Map(stringsTrackIds.map((id) => [id, notesByTrackId[id]]));
  let tracks = project.tracks.map((t) => {
    if (!isInstrumentTrack(t)) return t;
    if (t.role === BASSES_ROLE) {
      // the composed basses desk: the split's notes + its CC lanes, or
      // silence (lock wins)
      if (t.locked) return t;
      const cc = ccByTrackId[t.id];
      return { ...t, notes: bassesById.get(t.id) ?? [], ...(cc ? { cc } : {}) };
    }
    if (t.locked) return t; // lock wins
    if (!isInBand(t.role, ensemble, template)) return t; // out of band: untouched
    if (stringsNotes.has(t.id)) {
      const cc = ccByTrackId[t.id];
      return { ...t, notes: stringsNotes.get(t.id)!, ...(cc ? { cc } : {}) };
    }
    if (brassNotes[t.id] !== undefined) {
      const cc = brassCcByTrackId[t.id];
      return { ...t, notes: brassNotes[t.id], ...(cc ? { cc } : {}) };
    }
    if (windNotes[t.id] !== undefined) {
      // the fresh CC build owns the lanes: when it produced none (an empty
      // part — buildCcLanes skips empty tracks), the track's PRE-COMPOSE cc
      // (a re-compose of an older take) must not leak through the spread
      const cc = windCcByTrackId[t.id];
      return { ...t, notes: windNotes[t.id], ...(cc ? { cc } : { cc: undefined }) };
    }
    if (percussionNotes[t.id] !== undefined) {
      // the module owns the sound; no CC lanes for percussion (§15.5 — the
      // generator writes none today), and a stale pre-compose cc must not
      // leak through the spread (the winds rule)
      return { ...t, notes: percussionNotes[t.id], cc: undefined };
    }
    if (keysNotes[t.id] !== undefined) {
      // This intermediate belongs to the generic keys renderer, which emits
      // no CC; Piano is replaced below by V5, including its generated CC64.
      // Clear stale pre-compose lanes so only the current owner writes CC.
      return { ...t, notes: keysNotes[t.id], cc: undefined };
    }
    const gen = ruleTracks.find((r) => r.id === t.id);
    return gen ? { ...t, notes: gen.notes } : t;
  });
  if (bassesNeedsTrack && bassesTrackId) {
    const cc = ccByTrackId[bassesTrackId];
    const basses = bassesTrackFor(project, bassesById.get(bassesTrackId) ?? []);
    tracks = insertBassesTrack(tracks, cc ? { ...basses, cc } : basses);
  }

  // Piano Engine V5 runs after every non-Piano part (including Harp) has
  // been composed and finalized. Its frozen analysis snapshot reads those
  // actual notes and arrangement; the V1 piano candidates above are retained
  // only as compatibility inputs for legacy non-Piano/Harp governance and
  // are never copied to the Piano output track.
  const pianoEngineInput = buildPianoEngineInput({
    project,
    ensemble,
    template,
    sections: ctx.sections,
    harmony: ctx.spans,
    energy: arc,
    conductor: plan,
    seed,
    userSeed: options.seed,
    take: orchestration.take,
    density: options.density,
    finalizedTracks: tracks,
  });
  const pianoAnalyzerReport = analyzePianoInput(pianoEngineInput);
  const pianoPlanV5 = composePianoPlan(pianoEngineInput, pianoAnalyzerReport);
  const pianoTrack = project.tracks.find((track) => isInstrumentTrack(track)
    && track.family === 'Keys' && track.role === 'piano' && !track.locked
    && isInBand(track.role, ensemble, template));
  const pianoRealization = realizePianoPlanWithAudit({
    plan: pianoPlanV5,
    targetTrack: pianoTrack ?? null,
    projectEndTick: projectEndTick(project),
    externalTracks: template
      ? pianoEngineInput.analysis.tracks
        .filter((track) => template.roster.some((entry) => entry.role === track.role))
        .map(({ id, role, notes }) => ({ id, role, notes }))
      : [],
    tempoMap: project.tempoMap,
    timeSignature: project.timeSignature,
  });
  if (pianoTrack) {
    const pianoNotes = pianoEngineInput.context.template.pianoEligible
      ? pianoRealization.notes.map((note) => ({ ...note }))
      : [];
    // Piano Engine V5 supplies its own CC64 lane. Authored CC64 points, when
    // present, are retained in that same lane; generated values win at ties.
    const pianoPedalCc = composePianoCc64(
      pianoRealization.controllers,
      pianoTrack.cc,
      projectEndTick(project),
    );
    tracks = tracks.map((track) => track.id === pianoTrack.id && isInstrumentTrack(track)
      ? { ...track, notes: pianoNotes, cc: pianoPedalCc?.length ? pianoPedalCc : undefined }
      : track);

    // Run the final mix safety guard against the real, finalized arrangement.
    // Piano is the only mutable key lane here; Harp and all other roles retain
    // their established velocities.
    if (pianoEngineInput.context.template.pianoEligible && template) {
      const outputPiano = tracks.find((track) => track.id === pianoTrack.id);
      if (outputPiano && isInstrumentTrack(outputPiano)) {
        governKeysVelocities({
          project: ctx.project,
          template,
          keys: [{ role: 'piano', notes: outputPiano.notes }],
          otherNotes: tracks
            .filter((track) => isInstrumentTrack(track) && track.role !== 'piano')
            .map((track) => ({ role: track.role, notes: track.notes })),
        });
      }
    }
    const completeSuspensions = pianoRealization.suspensions.filter((audit) => audit.complete).length;
    const octaveAudit = pianoRealization.octavePolicy;
    const octaveSummary = octaveAudit.policy === 'forbidden'
      ? `; forbidden octave policy revoiced ${octaveAudit.revoiced}, shortened ${octaveAudit.shortened}, removed ${octaveAudit.dropped}; hard pairs remaining ${octaveAudit.remainingHardPairs}`
      : '';
    ctx.lines!.reports.push(
      `piano engine V5 (take ${orchestration.take}, user seed ${pianoEngineInput.context.generationIdentity.userSeed}, density ${pianoEngineInput.context.generationIdentity.density}): ${pianoEngineInput.context.template.pianoEligible ? `${pianoRealization.notes.length} notes` : 'ineligible'}; suspensions ${completeSuspensions}/${pianoRealization.suspensions.length}${octaveSummary}`,
    );
  }

  const result: Omit<ComposeResult, 'pianoEngineInput'> = {
    tracks,
    orchestration,
    stringsTrackIds,
    plan,
    reports: [...ctx.lines!.reports],
  };
  Object.defineProperty(result, 'pianoEngineInput', {
    value: pianoEngineInput,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return result as ComposeResult;
}
