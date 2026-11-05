/**
 * Conductor (spec §8, Phase 3a). The per-bar layer plan: which LAYERS play
 * in which bar, on which tracks, using the shared layer vocabulary from
 * specs/ensemble-templates/ensemble-template.schema.json ("a layer is a
 * functional role, not an instrument").
 *
 * The plan is an IN-MEMORY annotation: it rides on the Compose All result
 * for the audit stage (checkTemplateRules) and is never persisted. Today the
 * orchestrator owns exactly one layer — the strings pad — so the plan says
 * "pad" per bar and leaves the rules-generator families listed as
 * unannotated rather than pretending to know their layers; their modules
 * arrive in later phases and will annotate honestly.
 *
 * Hard contracts the plan obeys:
 *  - template maxLayers: no bar plans more concurrent layers than the budget;
 *  - the band's octaveDoubling policy: when doubling is not 'allowed', the
 *    conductor plans no octave-double/unison layer slots (it plans none at
 *    all in this phase — the guard is the contract for later phases);
 *  - fillGating: for every fillGating rule the strings leave a BREATH
 *    window (the section's last bar — the rules generator's own fill
 *    convention) of at least minGapTicks on the duringRestsOf tracks, and
 *    the corresponding fill window is registered for the checker.
 */
import { barTicks, projectBars, sectionAtBar, type ArcBar } from '../spine';
import { isInstrumentTrack, type TrackFamily } from '../../shared/schema/types';
import type { EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { isInBand } from '../../shared/schema/band';
import type { OrchestratorContext } from '../module';
import { stringVoiceTracks, sectionEnergyTarget } from '../render';
import { layerSlotsForBar } from './layers';
import { textureForType } from './layers';
import { planMoments, type MomentPlan } from './moments';
import { planBrass, planBrassLeads, brassRng, type BrassPlan } from '../brass/plan';

/** The shared layer vocabulary (ensemble-template.schema.json §budget). */
export const LAYER_VOCABULARY = [
  'lead', 'pad', 'ostinato', 'tremolo', 'counterline', 'bass', 'fill',
  'stab', 'percussion', 'color', 'sub', 'riser', 'texture',
] as const;
export type LayerName = (typeof LAYER_VOCABULARY)[number];

/** One layer one bar: the tracks carrying it this bar. */
export interface LayerSlot {
  layer: LayerName;
  trackIds: string[];
  /** Who plans the layer today: the strings module (the rest are unannotated). */
  source: 'strings';
}

export interface BarPlan {
  /** 1-indexed bar. */
  bar: number;
  startTick: number;
  endTick: number;
  sectionId: string;
  sectionName: string;
  layers: LayerSlot[];
  /** The arc's target energy for this bar (0..1; flat per-section table until the arc lands). */
  energyTarget: number;
  /** The moment covering this bar, if any (Phase 7) — beside the texture
   *  layers, which keep showing what the texture itself planned. */
  moment?: { kind: MomentPlan['kind']; startBar: number; endBar: number };
}

/** A window in which the named string parts deliberately REST. */
export interface BreathWindow {
  trackIds: string[];
  roles: string[];
  /** The fillGating target this breath serves ('Strings', 'violins1', …), or 'arc' for a pure energy-silence bar. */
  duringRestsOf: string;
  startTick: number;
  endTick: number;
  /** The minimum rest length the template demands for a fill to land here. */
  minGapTicks: number;
  reason: 'fillGating' | 'nearSilence';
  /** True when this window also carries the arc's pre-Chorus near-silence. */
  nearSilence?: boolean;
}

/** A window the conductor reserves for a fillGating actor. */
export interface FillWindow {
  /** The rule's fills target: a family or roster role. */
  target: string;
  startTick: number;
  endTick: number;
}

export interface ConductorPlan {
  templateId: string | null;
  maxLayers: number;
  octaveDoublingPolicy: 'allowed' | 'climaxOnly' | 'forbidden' | 'none';
  bars: BarPlan[];
  breaths: BreathWindow[];
  fills: FillWindow[];
  /** In-band roles the orchestrator does not annotate yet (no family module). */
  unannotatedRoles: string[];
  /** The take's moments (Phase 7) — planned here, rendered beside the
   *  textures. In-memory only; never persisted. */
  moments: MomentPlan[];
  /** The take's brass plan (Phase 8) — planned here after the moments,
   *  realised by the brass renderer after the rules generator. In-memory
   *  only; never persisted. */
  brass: BrassPlan;
}

export function octaveDoublingPolicyOf(template: EnsembleTemplate | null): ConductorPlan['octaveDoublingPolicy'] {
  const rule = template?.rules.find((r) => r.type === 'octaveDoubling');
  const policy = rule ? (rule.params as { policy?: string }).policy : undefined;
  return policy === 'allowed' || policy === 'climaxOnly' || policy === 'forbidden' ? policy : 'none';
}

const matchesTarget = (target: string, role: string, family: TrackFamily): boolean =>
  target.toLowerCase() === family.toLowerCase() || target === role;

/** Build the per-bar plan for the project. Pure: same context → same plan.
 *  The arc (Phase 3c) supplies per-bar energy targets and the pre-Chorus
 *  near-silence bar; without one the flat per-section table stands in.
 *  Phase 7: `withMoments` (default true) plans the take's moments; tests
 *  pass false to pin that everything outside moment bars is unchanged. */
export function conduct(ctx: OrchestratorContext, arc?: ArcBar[], withMoments = true): ConductorPlan {
  const template = ctx.template;
  const voices = stringVoiceTracks(ctx);
  const voiceIds = voices.map((t) => t.id);
  const btBar = barTicks(ctx.project.timeSignature);
  const bars = projectBars(ctx.project);

  const barPlans: BarPlan[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const startTick = (bar - 1) * btBar;
    const sec = sectionAtBar(ctx.sections, bar);
    const arcBar = arc?.[bar - 1];
    barPlans.push({
      bar,
      startTick,
      endTick: startTick + btBar,
      sectionId: sec?.id ?? '__all',
      sectionName: sec?.name ?? '*',
      // Phase 4a: one role per string TRACK per bar (lead, counterline, pad,
      // ostinato, tremolo, bass) from section type, arc energy and preset —
      // the same assignment the renderer plays, so the annotation is honest.
      layers: layerSlotsForBar(ctx, bar).map((s) => ({ ...s, source: 'strings' as const })),
      energyTarget: arcBar ? arcBar.target : sectionEnergyTarget(sec?.name ?? '*'),
    });
  }

  // fillGating breaths: the duringRestsOf parts rest on each section's last
  // bar (where the rules generator places fills), so the fill actor answers
  // in a real rest — the template's own contract, made checkable.
  const breaths: BreathWindow[] = [];
  const fills: FillWindow[] = [];
  if (template && voiceIds.length) {
    for (const rule of template.rules) {
      if (rule.type !== 'fillGating') continue;
      const { fills: fillTarget, duringRestsOf, minGapTicks } = rule.params as { fills: string; duringRestsOf: string; minGapTicks: number };
      const resting = voices.filter((t) => matchesTarget(duringRestsOf, t.role, t.family));
      if (!resting.length) continue;
      for (const sec of ctx.sections) {
        const lastBar = sec.startBar + sec.lengthBars - 1;
        if (lastBar < 1 || lastBar > bars) continue;
        // Phase 3.5: never on the song's FINAL bar — the strings sustain the
        // landing chord there, so no breath is planned and no fill window is
        // registered (the landing chord is not a fill moment).
        if (lastBar === bars) continue;
        const startTick = (lastBar - 1) * btBar;
        if (btBar < minGapTicks) continue; // a bar too short to gate a fill: no breath, no fill window
        breaths.push({
          trackIds: resting.map((t) => t.id),
          roles: resting.map((t) => t.role),
          duringRestsOf,
          startTick,
          endTick: startTick + btBar,
          minGapTicks,
          reason: 'fillGating',
        });
        fills.push({ target: fillTarget, startTick, endTick: startTick + btBar });
      }
    }
  }

  // the arc's deliberate near-silence bar (pre-first-Chorus): the strings
  // rest there. Merged into an existing breath ONLY when that breath already
  // covers every string voice; otherwise it rides as its own window (the
  // near-silence always rests the WHOLE string section).
  if (arc && voiceIds.length) {
    for (const a of arc) {
      if (!a.nearSilence) continue;
      const coversAll = (ids: string[]) => ids.length === voiceIds.length && voiceIds.every((id) => ids.includes(id));
      const existing = breaths.find((b) => b.startTick === a.startTick && b.endTick === a.endTick && coversAll(b.trackIds));
      if (existing) existing.nearSilence = true;
      else
        breaths.push({
          trackIds: [...voiceIds],
          roles: voices.map((t) => t.role),
          duringRestsOf: 'arc',
          startTick: a.startTick,
          endTick: a.endTick,
          minGapTicks: a.endTick - a.startTick,
          reason: 'nearSilence',
          nearSilence: true,
        });
    }
  }

  // Phase 7: the take's moments — planned AFTER the breaths (a soli may sit
  // right after one) and BEFORE rendering, on their own salted stream so the
  // texture draws stay untouched. The plan rides beside the textures; only
  // the bars a moment covers may deviate from the layer plan above.
  // Phase 8: the brass lead is planned BEFORE the moments (it is
  // moments-independent — the same spans with and without them) and the
  // moments avoid its bars.
  const brassLeadBars = new Set(
    planBrassLeads(ctx.project, template, ctx.sections, arc ?? [], brassRng(ctx.project, ctx.project.orchestration?.take ?? 0))
      .flatMap((l) => { const out: number[] = []; for (let b = l.startBar; b <= l.endBar; b++) out.push(b); return out; }),
  );
  const moments: MomentPlan[] = withMoments
    ? planMoments({
        project: ctx.project,
        template,
        sections: ctx.sections,
        spans: ctx.spans,
        arc: arc ?? [],
        breaths,
        texturePlanOf: (typeName) => textureForType(ctx, typeName).plan as Partial<Record<string, string>>,
        stringTracks: voices,
        take: ctx.project.orchestration?.take ?? 0,
        brassLeadBars,
      })
    : [];
  ctx.moments = moments;
  const momentByBar = new Map<number, MomentPlan>();
  for (const m of moments) for (let b = m.startBar; b <= m.endBar; b++) momentByBar.set(b, m);
  for (const bp of barPlans) {
    const m = momentByBar.get(bp.bar);
    if (m) bp.moment = { kind: m.kind, startBar: m.startBar, endBar: m.endBar };
  }

  // Phase 8: the brass plan — its OWN salted stream, planned after the
  // moments (a brass lead never shares bars with one). The strings' layer
  // suppression on brass-lead bars reads ctx.brassPlan.leads at render time.
  const brass = planBrass(ctx);
  ctx.brassPlan = brass;

  // Hard contract: the plan never exceeds maxLayers (trivially true with one
  // layer today — the guard is the contract later phases must keep), and no
  // doubling layer slots exist when the band's policy forbids them.
  const maxLayers = template?.budget.maxLayers ?? LAYER_VOCABULARY.length;

  const annotated = new Set(voiceIds);
  // Phase 8: a brass role the brass plan actually annotates is no longer
  // "unannotated" — the plan carries its per-bar kinds (plan.brass).
  const unannotatedRoles = [
    ...new Set(
      ctx.project.tracks
        .filter((t) => isInstrumentTrack(t) && !t.locked && !annotated.has(t.id) && isInBand(t.role, ctx.ensemble, template))
        .filter((t) => {
          const planned = brass.bars.some((b) => b.voices[t.role as keyof typeof b.voices] !== undefined);
          return !planned;
        })
        .map((t) => t.role),
    ),
  ].sort();

  return {
    templateId: template?.id ?? null,
    maxLayers,
    octaveDoublingPolicy: octaveDoublingPolicyOf(template),
    bars: barPlans,
    breaths,
    fills,
    unannotatedRoles,
    moments,
    brass,
  };
}

/** The breath windows that apply to one track (for the renderer). */
export const breathsForTrack = (plan: ConductorPlan, trackId: string): [number, number][] =>
  plan.breaths.filter((b) => b.trackIds.includes(trackId)).map((b) => [b.startTick, b.endTick]);
