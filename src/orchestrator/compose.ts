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
import { freshEnsemble, isInBand } from '../shared/schema/band';
import { isInstrumentTrack, type CcLane, type CcPoint, type OrchestrationState, type Project, type Track } from '../shared/schema/types';
import type { EnsembleTemplate } from '../shared/schema/ensembleTemplate';
import { resolveTemplate } from '../config/ensembles';
import { chordSpans, sectionMap, orchestrationSeedFor, energyCurve, sectionAtBar } from './spine';
import { barTicks, projectEndTick } from '../shared/schema/meter';
import { buildPianoEngineInput, type PianoEngineInput } from './keys/piano-engine';
import { analyzePianoInput } from './keys/piano-analyzer';
import { composePianoPlan, composePianoScoreWithDiagnostics, openPianoOwnedTransitionBars } from './keys/piano-composer';
import type { PianoCompositionMode } from './keys/piano-composition-identity';
import { reconcilePianoLeadBalance, type PianoCompositionDiagnostics } from './keys/piano-texture-theme';
import { validatePianoScorePlayability } from './keys/piano-playability';
import type { PianoScore } from './keys/piano-score';
import type { PianoPlayabilityReport } from './keys/piano-playability';
import { realizePianoPlanWithAudit, type PianoRealizationWithAudit, type PianoRealizedScoreEvent } from './keys/piano-realizer';
import type { LayerName, OrchestratorContext } from './module';
import type { MomentPlan } from './conductor/moments';

export interface ComposeOptions {
  seed: number;
  density?: number;
  humanize?: boolean;
  /** Phase 7: plan moments (default true). Tests disable them to pin that
   *  the texture draws are untouched outside moment bars. */
  moments?: boolean;
  /** Arrangement seed offset (default 0). effectiveTake = persistedTake + arrangementSeed * 1000. */
  arrangementSeed?: number;
  /** Variety switch (default false). When true brass/winds use extra seeded variety draws behind their own salted streams. */
  variety?: boolean;
  /**
   * Piano composition mode. Default 'identity': every generation gets a
   * coordinated composition identity. 'classic' is the regression mode and
   * reproduces the accepted Texture-and-Theme Composer exactly.
   */
  pianoComposition?: PianoCompositionMode;
}

export interface ComposeBarPlan {
  bar: number;
  startTick: number;
  endTick: number;
  sectionId: string;
  sectionName: string;
  layers: { layer: LayerName; trackIds: string[]; source: 'strings' }[];
  energyTarget: number;
}

/** The exact plan shape the piano engine consumes. In-memory only. */
export interface ComposePlan {
  templateId: string | null;
  maxLayers: number;
  octaveDoublingPolicy: 'allowed' | 'climaxOnly' | 'forbidden' | 'none';
  bars: ComposeBarPlan[];
  breaths: never[];
  fills: { target: string; startTick: number; endTick: number }[];
  unannotatedRoles: string[];
  moments: MomentPlan[];
  [extra: string]: unknown;
}

export interface ComposeResult {
  tracks: Track[];
  /** The take state to write in the SAME edit as the tracks. */
  orchestration: OrchestrationState;
  /** Track IDs written by the strings module; other output comes from family renderers and/or the generic rules interpreter. */
  stringsTrackIds: string[];
  /** The per-bar annotation the piano engine reads (source windows + sections).
   *  Never persisted; the store writes only tracks + take. */
  plan: ComposePlan;
  /** Phase 4: renderer notes for the report (fallbacks, skipped layerings). */
  reports: string[];
  /**
   * Ephemeral, immutable Piano Engine V5 input used during this compose.
   * It is non-enumerable and never enters Project persistence or export.
   */
  readonly pianoEngineInput: PianoEngineInput;
  /** Ephemeral Composer-owned note events; hand/voice identity is not persisted to Project tracks or MIDI. */
  readonly pianoScore: PianoScore;
  /** Realizer's post-policy note pairing, retaining source hand/voice IDs for internal audit. */
  readonly pianoRealizedScoreEvents: readonly PianoRealizedScoreEvent[];
  /** Report-only diagnostics over the immutable score, before realization. */
  readonly pianoPlayability: PianoPlayabilityReport;
  /** Ephemeral Piano composition diagnostics. Non-enumerable; never persisted. */
  readonly pianoDiagnostics: PianoCompositionDiagnostics | null;
  /**
   * The Realizer's octave-policy audit: how many notes were revoiced, shortened
   * or dropped for playability. Exposed so callers can account for the
   * difference between the immutable score and the notes written to the track
   * instead of assuming they are always equal.
   */
  readonly pianoOctavePolicy: PianoRealizationWithAudit['octavePolicy'];
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
  if (last) {
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

  // the take this compose produces (increments the previous one); the arrangement
  // seed shifts the effective take by arrangementSeed*1000 so arrangementSeed 0
  // is byte-identical to today while any other seed re-rolls every take-varying
  // stream. effectiveTake is never written to project.orchestration.take.
  const persistedTake = (project.orchestration?.take ?? 0) + 1;
  const arrangementOffset = (options?.arrangementSeed ?? 0) * 1000;
  const effectiveTake = persistedTake + arrangementOffset;
  const orchestration: OrchestrationState = {
    take: persistedTake,
    ...(project.orchestration?.sectionTakes ? { sectionTakes: { ...project.orchestration.sectionTakes } } : {}),
    ...(project.orchestration?.sectionLocks ? { sectionLocks: [...project.orchestration.sectionLocks] } : {}),
  };
  const effectiveOrchestration: OrchestrationState = {
    take: effectiveTake,
    ...(orchestration.sectionTakes ? { sectionTakes: { ...orchestration.sectionTakes } } : {}),
    ...(orchestration.sectionLocks ? { sectionLocks: [...orchestration.sectionLocks] } : {}),
  };

  const ctx: OrchestratorContext = { project: { ...project, orchestration: effectiveOrchestration }, template, ensemble, spans: chordSpans(project), sections: sectionMap(project), ...(options?.variety !== undefined ? { variety: options.variety } : {}) } as OrchestratorContext;
  const seed = orchestrationSeedFor(project, effectiveOrchestration);
  const arc = energyCurve(project, ctx.sections, effectiveTake, template, false);
  ctx.arc = arc;
  ctx.reports = [];
  // The piano engine reads its exact source windows from the conductor plan:
  // barWindows carry startTick/endTick/sectionId/sectionName. Orchestra
  // generation is gone, so the bar plan is built here directly from the spine
  // instead of from conduct(); the piano is the only consumer left.
  const bars = arc.map((a) => {
    const section = sectionAtBar(ctx.sections, a.bar);
    return {
      bar: a.bar,
      startTick: a.startTick,
      endTick: a.endTick,
      sectionId: section?.id ?? '__all',
      sectionName: section?.name ?? '*',
      layers: [] as { layer: LayerName; trackIds: string[]; source: 'strings' }[],
      energyTarget: a.target,
    };
  });
  const plan: ComposePlan = {
    templateId: template?.id ?? null,
    maxLayers: template?.budget.maxLayers ?? 0,
    octaveDoublingPolicy: 'none',
    bars,
    breaths: [],
    fills: [],
    unannotatedRoles: [],
    moments: [],
  };
  // Compose All owns the Piano. Every other track keeps exactly what it had:
  // there is no strings, brass, winds or percussion generator left to rewrite
  // them, so clearing their notes or automation would destroy the user's work
  // (and the Piano's authored CC64) for no musical reason.
  let tracks: Track[] = project.tracks.map((t) => ({ ...t }));

  // Piano Engine V5 is the only composer left. Every other track keeps whatever
  // notes it already had (Compose All clears them above, so they stay empty) —
  // there is no strings, brass, winds or percussion generator to fill them.
  const stringsTrackIdsOut: string[] = [];

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
  // Identity mode: a fill window that would leave the whole ensemble silent goes to the Piano's
  // transition decision. Classic keeps the plan exactly as composed.
  const pianoPlanComposed = composePianoPlan(pianoEngineInput, pianoAnalyzerReport);
  const pianoPlanV5 = options.pianoComposition === 'classic' ? pianoPlanComposed : openPianoOwnedTransitionBars(pianoPlanComposed);
  const pianoTrack = project.tracks.find((track) => isInstrumentTrack(track)
    && track.family === 'Keys' && track.role === 'piano' && !track.locked
    && isInBand(track.role, ensemble, template));
  const pianoComposition = composePianoScoreWithDiagnostics(pianoEngineInput, pianoPlanV5, pianoTrack ?? null, projectEndTick(project), options.pianoComposition);
  const pianoScore = pianoComposition.score;
  const pianoPlayability = validatePianoScorePlayability(pianoScore, {
    lowestNote: pianoTrack?.lowestNote,
    highestNote: pianoTrack?.highestNote,
    barTicks: barTicks(project.timeSignature),
  });
  const pianoRealization = realizePianoPlanWithAudit({
    plan: pianoPlanV5,
    score: pianoScore,
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
    const pianoNotes = pianoRealization.notes.map((note) => ({ ...note }));
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
                // Stage 2A: the balance report is measured on these final notes, after the Realizer and
        // the mix guard above, against the final notes of the lead. Report only; no note changes.
        reconcilePianoLeadBalance(pianoComposition.diagnostics, 'track', outputPiano.notes,
          tracks.flatMap((track) => (isInstrumentTrack(track) && track.role !== 'piano' ? [{ id: track.id, notes: track.notes }] : [])));
      }
    }
    const completeSuspensions = pianoRealization.suspensions.filter((audit) => audit.complete).length;
    const octaveAudit = pianoRealization.octavePolicy;
    const octaveSummary = octaveAudit.policy === 'forbidden'
      ? `; forbidden octave policy revoiced ${octaveAudit.revoiced}, shortened ${octaveAudit.shortened}, removed ${octaveAudit.dropped}; hard pairs remaining ${octaveAudit.remainingHardPairs}`
      : '';
    ctx.reports.push(
      `piano engine V5 (take ${orchestration.take}, user seed ${pianoEngineInput.context.generationIdentity.userSeed}, density ${pianoEngineInput.context.generationIdentity.density}): ${pianoEngineInput.context.template.pianoEligible ? `${pianoRealization.notes.length} notes` : 'ineligible'}; suspensions ${completeSuspensions}/${pianoRealization.suspensions.length}${octaveSummary}`,
      `piano score playability (take ${orchestration.take}): ${pianoScore.events.length} Composer events; ${pianoPlayability.warnings.length} warnings, ${pianoPlayability.violations.length} hard violations (report only)`,
    );
  }

  const result: Omit<ComposeResult, 'pianoEngineInput' | 'pianoScore' | 'pianoRealizedScoreEvents' | 'pianoPlayability' | 'pianoDiagnostics' | 'pianoOctavePolicy'> = {
    tracks,
    orchestration,
    stringsTrackIds: stringsTrackIdsOut,
    plan,
    reports: [...(ctx.reports ?? [])],
  };
  for (const [key, value] of [
    ['pianoEngineInput', pianoEngineInput],
    ['pianoScore', pianoScore],
    ['pianoRealizedScoreEvents', pianoRealization.realizedScoreEvents],
    ['pianoPlayability', pianoPlayability],
    ['pianoDiagnostics', pianoComposition.diagnostics],
    ['pianoOctavePolicy', pianoRealization.octavePolicy],
  ] as const) {
    Object.defineProperty(result, key, {
      value,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return result as ComposeResult;
}
