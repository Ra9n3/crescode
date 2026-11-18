/**
 * Piano V5 compatibility adapter.
 *
 * Piano V5's `buildPianoEngineInput` requires a `ConductorPlan`. The new engine
 * does not have one — and must not adopt the old conductor's musical logic.
 *
 * This adapter constructs the *smallest* plan that satisfies that type, filling
 * only the four fields V5 genuinely reads, sourced from the new engine's own
 * `OrchestraPlan`:
 *
 *   conductor.bars[].{bar,startTick,endTick,sectionId,sectionName}  -> barWindows
 *   conductor.bars[].layers                                        -> layerInformation
 *   conductor.moments                                              -> moments
 *   conductor.fills                                                -> fillWindows
 *
 * The brass/winds/percussion/keys sub-plans are empty because the new engine
 * realises no such material in phase 1, and V5 never reads them. Those are
 * honest empties, not fabricated musical content.
 *
 * Piano V5 itself is untouched.
 *
 * IMPORTANT: the `ConductorPlan` types are imported as TYPES only. No old
 * conductor function is called; nothing from `conductor/index.ts` runs.
 */
import type {
  ConductorPlan,
  BarPlan,
  LayerSlot,
} from '../../orchestrator/conductor';
import type { MomentKind } from '../../orchestrator/conductor/moments';
import type { OrchestraPlan, SectionPlan } from '../ir';

export interface AdapterSection {
  readonly id: string;
  readonly name: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly startBar: number;
  readonly lengthBars: number;
}

export interface AdapterBar {
  readonly bar: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly sectionId: string;
  readonly sectionName: string;
  /** The energy target this bar was composed toward (V5 reads it via `energy`). */
  readonly energy: number;
}

export interface AdapterInput {
  readonly plan: OrchestraPlan;
  readonly sections: readonly AdapterSection[];
  readonly bars: readonly AdapterBar[];
  readonly templateId: string | null;
  readonly unannotatedRoles: readonly string[];
}

/**
 * Builds the plan V5 consumes. Only the four read fields carry new-engine data;
 * everything else is structurally required but semantically inert.
 */
export function buildConductorPlanForPiano(input: AdapterInput): ConductorPlan {
  const planBySection = new Map<string, SectionPlan>(
    input.plan.sections.map((section) => [section.sectionId, section]),
  );

  const bars: BarPlan[] = input.bars.map((bar) => {
    const sectionPlan = planBySection.get(bar.sectionId);
    return {
      bar: bar.bar,
      startTick: bar.startTick,
      endTick: bar.endTick,
      sectionId: bar.sectionId,
      sectionName: bar.sectionName,
      layers: layerSlotsFor(sectionPlan),
      energyTarget: bar.energy,
    };
  });

  const moments = input.plan.moments.map((moment) => ({
    kind: moment.kind as MomentKind,
    startBar: moment.startBar,
    endBar: moment.endBar,
    startTick: moment.startTick,
    endTick: moment.endTick,
    participantRoles: [...moment.participantRoles],
    ...(moment.shape ? { shape: moment.shape } : {}),
  }));

  const fills = input.plan.fills.map((fill) => ({
    target: fill.target,
    startTick: fill.startTick,
    endTick: fill.endTick,
  }));

  return {
    templateId: input.templateId,
    maxLayers: 0,
    octaveDoublingPolicy: 'allowed',
    bars,
    breaths: [],
    fills,
    unannotatedRoles: [...input.unannotatedRoles],
    moments,
    // Structurally required, never read by V5, and honestly empty in phase 1.
    brass: { bars: [], leads: [], trumpetRoleByType: {}, reports: [] },
    winds: { bars: [], leads: [], leadDoubleByType: {}, pickupRuns: [], flutterBars: {}, reports: [] },
    percussion: { bars: [], rolls: [], crashes: [], finalTimpani: false, reports: [] },
    keys: {
      bars: [],
      glisses: [],
      harpModeByType: {},
      arpeggiatorOwnerByType: {},
      pianoJobs: [],
      harpFigures: [],
      pianoRoleCounts: { anchor: 0, answer: 0 },
      pianoMotionStats: { motionBars: 0, upBars: 0, upLimit: 0 },
      reports: [],
    },
  } as unknown as ConductorPlan;
}

/**
 * Layer slots for one bar, grouped by layer.
 *
 * `source: 'strings'` is accurate: strings are the only family the new engine
 * annotates in this phase, and labelling them otherwise would be a claim V5
 * might act on.
 */
function layerSlotsFor(sectionPlan: SectionPlan | undefined): LayerSlot[] {
  if (!sectionPlan) return [];
  const grouped = new Map<string, string[]>();
  for (const slot of sectionPlan.participation) {
    const existing = grouped.get(slot.layer);
    if (existing) existing.push(slot.trackId);
    else grouped.set(slot.layer, [slot.trackId]);
  }
  const slots: LayerSlot[] = [];
  for (const [layer, trackIds] of grouped) {
    slots.push({ layer: layer as LayerSlot['layer'], trackIds, source: 'strings' });
  }
  return slots;
}

/** Roles present in the project that the new engine does not yet realise. */
export function unannotatedRolesFor(
  roles: readonly string[],
  realised: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const role of roles) if (!realised.has(role)) out.add(role);
  return [...out];
}
