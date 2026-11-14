/** Stage 1 one-way handoff. Called exactly once, AFTER Piano and Strings finish.
 * The historical pass remains a compatibility/reservation input to existing
 * families. Only this pass owns V1 wind output; no external family is rerun.
 */
import type { WindExportObservation } from '../../export/wind-audit';
import { hashString } from '../../engine/generate';
import { isInstrumentTrack, type Note, type Track } from '../../shared/schema/types';
import { isInBand } from '../../shared/schema/band';
import { barTicks, beatTicks, projectEndTick } from '../../shared/schema/meter';
import type { OrchestratorContext } from '../module';
import { buildCcLanes } from '../expression/cc';
import { createWindIdentity, windStream, type WindIdentity } from './identity';
import { arrangeWindEnsemble } from './ensemble';
import { planWinds, type WindPlan, type WindVoiceKind } from './plan';
import { governWindsVelocities, renderWinds } from './render';
import { WIND_PARTS, WIND_PROFILES, windTrackOf, type WindPart } from './profile';
import { motifLine } from '../lines/motif';
import { windJobKey, type WindTraceEvent } from './trace';

export const windFingerprint = (value: unknown): string => hashString(JSON.stringify(value)).toString(16).padStart(8, '0');
export interface WindJob {
  readonly id: string;
  readonly part: WindPart;
  readonly bar: number;
  readonly kind: WindVoiceKind | 'pickup';
  readonly reasons: readonly string[];
  readonly generated: number;
  readonly rejected: number;
  readonly retainedAssociations: number;
  readonly state: 'planned-no-notes' | 'candidate-rejected' | 'generated-not-retained' | 'retained';
}
export interface WindPartContribution {
  readonly part: WindPart;
  readonly trackId: string | null;
  readonly eligibility: 'eligible' | 'ineligible';
  readonly reason: string;
  readonly state: 'ineligible' | 'intentional-silence' | 'planned-no-notes' | 'candidate-rejected' | 'generated-not-retained' | 'retained-sparse' | 'retained' | 'legacy-fallback' | 'classic-compatibility';
  readonly generatedCandidates: number | null;
  readonly retainedNotes: number;
  readonly soundingTicks: number;
  readonly retainedFingerprint: string | null;
}
export interface WindDiagnostics {
  readonly mode: 'classic' | 'v1';
  readonly route: 'classic-compatibility' | 'legacy-no-template' | 'v1-final';
  readonly identity: WindIdentity | null;
  readonly ownership: { readonly ownedTrackIds: readonly string[]; readonly preservedTrackIds: readonly string[] };
  readonly context: null | {
    readonly boundary: 'after-piano-and-strings';
    readonly finalNonWindFingerprint: string;
    readonly finalExternalFingerprint: string;
    readonly preparedMaterial: 'carrier/role hints only; notes replaced by final tracks';
    readonly legacyMaterial: 'compatibility wind pass excluded from final note context';
    readonly reservations: { readonly source: 'early-classic-conductor'; readonly leads: WindPlan['leads']; readonly momentsFingerprint: string };
    readonly finalTrackFingerprints: readonly { readonly id: string; readonly fingerprint: string }[];
    readonly carriers: readonly (string | null)[];
    readonly counterSource: { readonly trackId: string; readonly notes: number; readonly fingerprint: string } | null;
  };
  readonly plan: WindPlan | null;
  readonly parts: readonly WindPartContribution[];
  readonly jobs: readonly WindJob[];
  readonly events: readonly WindTraceEvent[];
  readonly export: 'not-observed; pass an audit sink to the MIDI builder';
  readonly sparsePolicy: 'fewer than 4 retained notes OR less than 2 felt beats of union coverage; not a musical quality verdict';
}
const sparsePolicy = 'fewer than 4 retained notes OR less than 2 felt beats of union coverage; not a musical quality verdict' as const;
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const coverage = (notes: readonly Note[]): number => {
  let end = -Infinity, ticks = 0;
  for (const n of [...notes].sort((a, b) => a.startTick - b.startTick)) {
    const e = n.startTick + n.durationTicks;
    ticks += Math.max(0, e - Math.max(end, n.startTick)); end = Math.max(end, e);
  }
  return ticks;
};

/** Classic diagnostics never claim new ownership or observed export. */
export function compatibilityWindDiagnostics(ctx: OrchestratorContext, tracks: readonly Track[], requestedV1 = false): WindDiagnostics {
  return freeze({ mode: requestedV1 ? 'v1' : 'classic', route: requestedV1 ? 'legacy-no-template' : 'classic-compatibility',
    identity: null, ownership: { ownedTrackIds: [], preservedTrackIds: tracks.map((t) => t.id) }, context: null, plan: null, jobs: [], events: [], export: 'not-observed; pass an audit sink to the MIDI builder', sparsePolicy,
    parts: WIND_PARTS.map((part) => {
      const t = tracks.find((t) => t.family === 'Woodwinds' && t.role === part && isInstrumentTrack(t));
      const eligible = !!t && !t.locked && isInBand(part, ctx.ensemble, ctx.template);
      return { part, trackId: t?.id ?? null, eligibility: eligible ? 'eligible' : 'ineligible',
        reason: eligible ? (ctx.template ? 'historical wind renderer; V1 not requested' : 'no template: generic legacy generator owns winds') : 'missing, locked or out of band',
        state: eligible ? (requestedV1 ? 'legacy-fallback' : 'classic-compatibility') : 'ineligible', generatedCandidates: null, retainedNotes: t?.notes.length ?? 0,
        soundingTicks: coverage(t?.notes ?? []), retainedFingerprint: t ? windFingerprint(t.notes) : null };
    }) });
}

export function completeWindsV1(ctx: OrchestratorContext, finalTracks: Track[], userSeed: number): { tracks: Track[]; diagnostics: WindDiagnostics } {
  if (!ctx.template) return { tracks: finalTracks, diagnostics: compatibilityWindDiagnostics(ctx, finalTracks, true) };
  if (!ctx.lines || !ctx.arc || !ctx.windPlan) throw new Error('Winds V1 requires prepared lines, arc and early reservations; no stale-context fallback');
  const identity = createWindIdentity(ctx.project, userSeed, ctx.project.orchestration?.take ?? 0);
  // Copy before exposing notes to the wind renderer. No references to final
  // Piano/Strings note objects can be mutated through this context.
  const local = structuredClone({ ...ctx, project: { ...ctx.project, tracks: finalTracks } });
  const lines = local.lines!;
  const ownedIds = new Set(WIND_PARTS.flatMap((part) => { const t = windTrackOf(local, part); return t ? [t.id] : []; }));
  const externalTracks = local.project.tracks.filter((t) => isInstrumentTrack(t) && !ownedIds.has(t.id));
  const allExternalFingerprint = windFingerprint(externalTracks);
  const nonWinds = local.project.tracks.filter((t) => isInstrumentTrack(t) && t.family !== 'Woodwinds');
  const externalFingerprint = windFingerprint(nonWinds);
  const bt = barTicks(local.project.timeSignature);
  const sounding = (notes: readonly Note[], bar: number) => notes.some((n) => n.startTick < bar * bt && n.startTick + n.durationTicks > (bar - 1) * bt);
  const finalById = new Map(nonWinds.map((t) => [t.id, t]));
  const orchestration = local.stringsV1?.orchestration;
  const acceptedPlan = orchestration?.accepted ? orchestration.plan : null;
  const finalCarriers = lines.carrierByBar.map((id, i) => {
    if (acceptedPlan) {
      const foreground = acceptedPlan.contributions.find((c) => c.duty === 'foreground' && c.startTick < (i + 1) * bt && c.endTick > i * bt);
      id = foreground ? nonWinds.find((t) => t.role === foreground.role)?.id ?? null : null;
    }
    return id && finalById.has(id) && sounding(finalById.get(id)!.notes, i + 1) ? id : null;
  });
  lines.carrierByBar = finalCarriers;
  lines.leads = [...new Set(finalCarriers.filter((id): id is string => id !== null))].map((trackId) => ({ trackId, notes: finalById.get(trackId)!.notes }));
  lines.lead = lines.leads.find((line) => line.trackId === lines.lead?.trackId) ?? lines.leads[0] ?? null;
  // Intermediate DP pitches are not a source of final notes. The retained
  // assignment is a role hint only, not a claim that those pitches survived.
  lines.voiced = []; lines.fallbackSpanIds = new Set();
  if (acceptedPlan) {
    const answers = acceptedPlan.contributions.filter((c) => c.duty === 'answer');
    const notes = nonWinds.flatMap((t) => t.notes.filter((n) => answers.some((c) => c.role === t.role && n.startTick >= c.startTick && n.startTick < c.endTick)));
    lines.counter = notes.length ? { trackId: 'final-strings-answers', notes } : null;
  } else {
    const t = lines.counter ? finalById.get(lines.counter.trackId) : undefined;
    // Role hints are not notes: select only actual final notes in counter bars.
    const notes = t?.notes.filter((n) => lines.assignment[Math.floor(n.startTick / bt)]?.byTrack[t.id] === 'counterline') ?? [];
    lines.counter = t && notes.length ? { trackId: t.id, notes } : null;
  }
  const plan = arrangeWindEnsemble(local, planWinds(local, { reservedLeads: ctx.windPlan.leads,
    rngFor: (category, key) => windStream(identity, category, key) }), identity);
  local.windPlan = plan;
  // Soli is a reservation, not permission to reuse an intermediate melody.
  lines.soliLineByTrackId = {};
  for (const m of local.moments ?? []) {
    const t = local.project.tracks.find((t) => t.id === m.carrierTrackId && t.family === 'Woodwinds');
    if (!t) continue;
    const part = t.role as WindPart, prof = WIND_PROFILES[part];
    if (!prof) continue;
    lines.soliLineByTrackId[t.id] = motifLine({ project: local.project, spans: local.spans, sections: local.sections,
      leadBars: new Set(Array.from({ length: m.endBar - m.startBar + 1 }, (_, i) => m.startBar + i)),
      comfortable: [Math.max(t.lowestNote, prof.sweet[0], prof.leadBan ? prof.leadBan[1] + 1 : 0), Math.min(t.highestNote, prof.softCeiling ?? prof.sweet[1])],
      take: identity.producedTake, rng: windStream(identity, 'phrase-design', `${part}:soli:${m.startBar}`) });
  }
  // No legacy wind notes are available as musical evidence to the final pass.
  for (const t of local.project.tracks) if (ownedIds.has(t.id)) { t.notes = []; t.cc = undefined; }
  freeze(local.project); freeze(lines); freeze(local.arc); freeze(local.spans); freeze(local.sections);
  const events: WindTraceEvent[] = [];
  const stringsNotes = Object.fromEntries(nonWinds.filter((t) => t.family === 'Strings').map((t) => [t.id, t.notes]));
  const brassNotes = Object.fromEntries(nonWinds.filter((t) => t.family === 'Brass').map((t) => [t.id, t.notes]));
  const result = renderWinds({ ctx: local, plan, stringsNotes, brassNotes,
    ruleNotes: externalTracks.filter((t) => t.family !== 'Strings' && t.family !== 'Brass').map((t) => ({ role: t.role, notes: t.notes })),
    motifRng: (part, key) => windStream(identity, 'phrase-design', `${part}:${key}`), finalNonWindNotes: externalTracks.flatMap((t) => t.notes), trace: (e) => events.push(structuredClone(e)) });
  const owned = new Set(Object.keys(result.notesByTrackId));
  const windRoles = Object.entries(result.notesByTrackId).map(([id, notes]) => ({ role: local.project.tracks.find((t) => t.id === id)!.role, notes }));
  governWindsVelocities({ project: local.project, template: local.template!, winds: windRoles, otherNotes: externalTracks.map((t) => ({ role: t.role, notes: t.notes })) });
  const cc: Record<string, ReturnType<typeof buildCcLanes>[string]> = {};
  for (const [id, notes] of Object.entries(result.notesByTrackId)) {
    const part = local.project.tracks.find((t) => t.id === id)!.role;
    Object.assign(cc, buildCcLanes({ project: local.project, template: local.template, sections: local.sections, arc: local.arc!,
      notesByTrackId: { [id]: notes }, carrierByBar: finalCarriers, rng: windStream(identity, 'expression', part) }));
  }
  const tracks = finalTracks.map((t) => owned.has(t.id) ? { ...t, notes: result.notesByTrackId[t.id], cc: cc[t.id] } : t);
  if (windFingerprint(tracks.filter((t) => isInstrumentTrack(t) && !ownedIds.has(t.id))) !== allExternalFingerprint) throw new Error('Wind handoff modified finalized non-wind material');
  const jobSpecs: { id: string; part: WindPart; bar: number; kind: WindVoiceKind | 'pickup' }[] = plan.bars.flatMap((b) => WIND_PARTS.flatMap((part) => {
    const kind = b.voices[part]; return kind ? [{ id: windJobKey(part, b.bar, kind), part, bar: b.bar, kind }] : [];
  }));
  jobSpecs.push(...plan.pickupRuns.map((r) => ({ id: windJobKey(r.part, r.bar, 'pickup'), part: r.part, bar: r.bar, kind: 'pickup' as const })));
  const jobs: WindJob[] = jobSpecs.map((j) => {
    const es = events.filter((e) => e.job === j.id), generated = es.filter((e) => e.stage === 'generated').length,
      rejected = es.filter((e) => e.stage === 'rejected').length, retainedAssociations = es.filter((e) => e.stage === 'retained').length;
    return { ...j, reasons: [...new Set(es.map((e) => e.reason))].concat(es.length ? [] : [local.spans.length ? 'selected role emitted no candidates in this window' : 'no valid normalized harmony spans; owned part cleared']), generated, rejected, retainedAssociations, state: retainedAssociations ? 'retained' : generated ? 'generated-not-retained' : rejected ? 'candidate-rejected' : 'planned-no-notes' };
  });
  const parts: WindPartContribution[] = WIND_PARTS.map((part) => {
    const t = tracks.find((t) => t.family === 'Woodwinds' && t.role === part && owned.has(t.id));
    const any = tracks.find((t) => t.family === 'Woodwinds' && t.role === part);
    const js = jobs.filter((j) => j.part === part), generated = events.filter((e) => e.part === part && e.stage === 'generated').length;
    const ticks = coverage(t?.notes ?? []);
    return { part, trackId: t?.id ?? any?.id ?? null, eligibility: t ? 'eligible' : 'ineligible',
      reason: t ? (!js.length ? 'no job selected by gates/reservations' : 'see per-job states and trace; counts are not musical quality') : !any ? 'no matching instrument track' : !isInBand(part, local.ensemble, local.template) ? 'out of band (pins and overrides applied)' : any.locked ? 'matching instrument locked; original preserved' : 'no writable instrument track',
      state: !t ? 'ineligible' : t.notes.length ? (t.notes.length < 4 || ticks < 2 * beatTicks(local.project.timeSignature) ? 'retained-sparse' : 'retained') : !js.length ? 'intentional-silence' : generated ? 'generated-not-retained' : js.some((j) => j.rejected) ? 'candidate-rejected' : 'planned-no-notes',
      generatedCandidates: generated, retainedNotes: t?.notes.length ?? 0, soundingTicks: ticks, retainedFingerprint: t ? windFingerprint(t.notes) : null };
  });
  if (Object.values(result.notesByTrackId).flat().some((n) => n.startTick + n.durationTicks > projectEndTick(local.project) || n.durationTicks <= 0)) throw new Error('Invalid final wind timing');
  return { tracks, diagnostics: freeze({ mode: 'v1', route: 'v1-final', identity, ownership: { ownedTrackIds: [...ownedIds], preservedTrackIds: tracks.filter((t) => !ownedIds.has(t.id)).map((t) => t.id) }, plan, parts, jobs, events,
    context: { boundary: 'after-piano-and-strings', finalNonWindFingerprint: externalFingerprint, finalExternalFingerprint: allExternalFingerprint,
      finalTrackFingerprints: nonWinds.map((t) => ({ id: t.id, fingerprint: windFingerprint(t) })), carriers: [...finalCarriers], counterSource: lines.counter ? { trackId: lines.counter.trackId, notes: lines.counter.notes.length, fingerprint: windFingerprint(lines.counter.notes) } : null,
      preparedMaterial: 'carrier/role hints only; notes replaced by final tracks', legacyMaterial: 'compatibility wind pass excluded from final note context',
      reservations: { source: 'early-classic-conductor', leads: structuredClone(ctx.windPlan.leads), momentsFingerprint: windFingerprint(ctx.moments) } },
    sparsePolicy, export: 'not-observed; pass an audit sink to the MIDI builder' }) };
}

/** Join export evidence to THIS retained take, not merely a matching role name.
 * Exact per-job note matching is used; transformed/merged profile material is
 * explicitly unresolved rather than falsely declared lost or successful.
 */
export function reconcileWindExport(diagnostics: WindDiagnostics, observations: readonly WindExportObservation[]) {
  return diagnostics.parts.map((part) => {
    const rows = observations.filter((o) => o.trackId === part.trackId);
    const valid = rows.filter((o) => o.retainedFingerprint === part.retainedFingerprint);
    return { part: part.part, trackId: part.trackId,
      state: !rows.length ? 'not-selected-or-not-observed' : !valid.length ? 'stale-export-evidence' : 'observed',
      exports: valid,
      jobs: diagnostics.jobs.filter((j) => j.part === part.part).map((job) => {
        const retained = diagnostics.events.filter((e) => e.job === job.id && e.stage === 'retained' && e.note).map((e) => e.note!);
        const unique = [...new Map(retained.map((n) => [JSON.stringify([n.pitch, n.startTick, n.durationTicks]), n])).values()];
        return { id: job.id, scopes: valid.map((row) => {
          const matched = unique.filter((n) => row.soundingEvents.some((out) => out.startTick === n.startTick && out.durationTicks === n.durationTicks
            && (out.pitch === n.pitch || row.folded > 0 && out.pitch >= n.pitch && (out.pitch - n.pitch) % 12 === 0))).length;
          return { scope: row.scope, retainedAssociations: unique.length, matched,
            state: !unique.length ? 'not-retained' : matched === unique.length ? 'exported' : !row.serializedSoundingNotes ? 'not-exported' : 'unresolved-profile-transform-or-loss' };
        }) };
      }) };
  });
}
