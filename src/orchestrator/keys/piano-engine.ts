/**
 * Phase 4A: typed, ephemeral handoff data for the future PianoEngine.
 * This module copies verified pipeline outputs only; it does not plan,
 * generate, correct, replace, or persist any tracks.
 */
import { isInBand } from '../../shared/schema/band';
import type { EnsembleRule, EnsembleTemplate } from '../../shared/schema/ensembleTemplate';
import { isInstrumentTrack, type Project, type ProjectEnsemble, type Track } from '../../shared/schema/types';
import type { ConductorPlan, LayerName } from '../conductor';
import type { MomentKind } from '../conductor/moments';
import type { ArcBar, ResolvedChord, SpineSection } from '../spine';
import { buildPianoAnalysisSnapshot, type DeepReadonly, type PianoAnalysis } from './analysis';

export type PianoRuleSeverity = 'hard' | 'soft' | 'none' | 'stub';
type PianoRuleBase<S extends PianoRuleSeverity> = {
  readonly severity: S;
  readonly source: 'template.rules';
  readonly mode?: string;
};

export interface PianoOctaveDoublingRule extends PianoRuleBase<'hard' | 'soft' | 'none'> {
  readonly type: 'octaveDoubling';
  readonly policy: 'allowed' | 'climaxOnly' | 'forbidden';
  readonly energyThreshold?: number;
}

export interface PianoFillGatingRule extends PianoRuleBase<'hard'> {
  readonly type: 'fillGating';
  readonly fills: string;
  readonly duringRestsOf: string;
  readonly minGapTicks: number;
}

export interface PianoOverlapAvoidRule extends PianoRuleBase<'soft'> {
  readonly type: 'overlapAvoid';
  readonly actor: string;
  readonly against: string;
  readonly windowTicks: number;
}

export interface PianoUnisonOrnamentRule extends PianoRuleBase<'stub'> {
  readonly type: 'unisonOrnament';
  readonly tracks: readonly string[];
  readonly transforms: readonly string[];
  readonly divergence?: 'perInstrument';
}

/** Rules that the existing template/rules checker actually applies to piano. */
export type PianoTemplateRule =
  | PianoOctaveDoublingRule
  | PianoFillGatingRule
  | PianoOverlapAvoidRule
  | PianoUnisonOrnamentRule;

export type PianoMomentKind = Extract<MomentKind, 'tutti' | 'soli' | 'unison'>;

/** The existing conductor moment fields that affect the keys/piano planner. */
export interface PianoRelevantMoment {
  readonly kind: PianoMomentKind;
  readonly startBar: number;
  readonly endBar: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly participantRoles?: readonly string[];
  readonly shape?: 'hold' | 'breath' | 'decay';
}

/** Direct projection of ArcBar; target is not recomputed from the conductor. */
export interface PianoEnergyBar {
  readonly bar: number;
  readonly target: number;
  readonly nearSilence: boolean;
}

/** Exact per-bar timing and section labels copied from ConductorPlan.bars. */
export interface PianoBarWindow {
  readonly bar: number;
  readonly startTick: number;
  readonly endTick: number;
  readonly sectionId: string;
  readonly sectionName: string;
}

/** Direct projection of a conductor fill window targeted at piano/Keys. */
export interface PianoFillWindow {
  readonly target: string;
  readonly startTick: number;
  readonly endTick: number;
}

export interface PianoLayerSlot {
  readonly layer: LayerName;
  readonly trackIds: readonly string[];
  readonly source: 'strings';
}

/**
 * The conductor's layer annotation is known to cover strings only. Nulls are
 * explicit: neither total occupancy nor capacity is inferred from that subset.
 */
export interface PianoLayerInformation {
  readonly availability: 'partial';
  readonly source: 'ConductorPlan.bars[].layers';
  readonly annotatedFamilies: readonly ['Strings'];
  readonly perBar: readonly {
    readonly bar: number;
    readonly layers: readonly PianoLayerSlot[];
  }[];
  readonly totalCapacity: null;
  readonly totalOccupiedLayers: null;
  readonly unavailableReason: string;
}

export interface PianoContextProvenance {
  readonly resolvedTemplate: 'src/config/ensembles.ts: resolveTemplate(project.ensemble)';
  readonly pianoEligibility: 'template roster plus unlocked in-band piano track';
  readonly applicableRules: 'EnsembleTemplate.rules + src/orchestrator/energy/rules.ts severity contracts';
  readonly sections: 'src/orchestrator/spine/index.ts: sectionMap(project)';
  readonly barWindows: 'src/orchestrator/conductor/index.ts: ConductorPlan.bars[].startTick/endTick';
  readonly harmony: 'src/orchestrator/spine/index.ts: chordSpans(project)';
  readonly energy: 'src/orchestrator/spine/energyArc.ts: ArcBar.target and ArcBar.nearSilence';
  readonly layerInformation: 'src/orchestrator/conductor/index.ts: ConductorPlan.bars[].layers (strings-only, partial)';
  readonly moments: 'src/orchestrator/conductor/index.ts: ConductorPlan.moments (keys-relevant kinds)';
  readonly fillWindows: 'src/orchestrator/conductor/index.ts: ConductorPlan.fills (piano/Keys targets)';
  readonly seed: 'src/orchestrator/spine/index.ts: orchestrationSeedFor(project, orchestration)';
  readonly analysis: 'composeAllTracks finalized tracks, excluding piano';
}

export interface PianoEngineContext {
  readonly template: {
    readonly id: string | null;
    /** The resolved roster and writable-track gate; pins cannot add roster roles. */
    readonly pianoEligible: boolean;
  };
  readonly rules: readonly PianoTemplateRule[];
  readonly sections: readonly DeepReadonly<SpineSection>[];
  /** Exact source windows; never inferred from meter or note events. */
  readonly barWindows: readonly PianoBarWindow[];
  readonly harmony: readonly DeepReadonly<ResolvedChord>[];
  readonly energy: readonly PianoEnergyBar[];
  readonly layerInformation: PianoLayerInformation;
  readonly moments: readonly PianoRelevantMoment[];
  readonly fillWindows: readonly PianoFillWindow[];
  readonly seed: number;
  readonly provenance: PianoContextProvenance;
}

/** Immutable, piano-excluded analysis snapshot plus the ephemeral context. */
export interface PianoEngineInput {
  readonly context: PianoEngineContext;
  readonly analysis: PianoAnalysis;
}

export interface BuildPianoEngineInputOptions {
  readonly project: Project;
  readonly ensemble: ProjectEnsemble;
  readonly template: EnsembleTemplate | null;
  /** Existing sectionMap(project) result from the composition pipeline. */
  readonly sections: readonly SpineSection[];
  /** Existing chordSpans(project) result from the composition pipeline. */
  readonly harmony: readonly ResolvedChord[];
  /** Existing energyCurve result; nearSilence is not reconstructed. */
  readonly energy: readonly ArcBar[];
  readonly conductor: ConductorPlan;
  /** Existing orchestrationSeedFor(project, orchestration) value. */
  readonly seed: number;
  /** Final composition tracks; piano is omitted from the read-only snapshot. */
  readonly finalizedTracks: readonly Track[];
}

const PIANO_MOMENT_KINDS: ReadonlySet<MomentKind> = new Set(['tutti', 'soli', 'unison']);

/**
 * Gate the new engine by the resolved template's roster, then by ordinary
 * write eligibility. isInBand alone is deliberately insufficient: pins may
 * add piano to the generic band selector (notably Symphony), but cannot add a
 * role to the resolved template roster.
 */
export function isPianoEngineEligible(
  project: Project,
  ensemble: ProjectEnsemble,
  template: EnsembleTemplate | null,
): boolean {
  if (!template || !template.roster.some((entry) => entry.role === 'piano' && entry.family === 'Keys')) return false;
  return project.tracks.some((track) =>
    isInstrumentTrack(track)
      && track.family === 'Keys'
      && track.role === 'piano'
      && !track.locked
      && isInBand(track.role, ensemble, template),
  );
}

const ruleMode = (rule: EnsembleRule): { mode?: string } =>
  rule.mode === undefined ? {} : { mode: rule.mode };

const pianoTarget = (value: unknown): value is string =>
  value === 'piano' || (typeof value === 'string' && value.toLowerCase() === 'keys');

function applicablePianoRules(template: EnsembleTemplate | null, pianoEligible: boolean): readonly PianoTemplateRule[] {
  if (!template || !pianoEligible) return Object.freeze([]);
  const output: PianoTemplateRule[] = [];
  for (const rule of template.rules) {
    const params = rule.params;
    switch (rule.type) {
      case 'octaveDoubling': {
        const policy = params.policy;
        if (policy !== 'allowed' && policy !== 'climaxOnly' && policy !== 'forbidden') break;
        output.push(Object.freeze({
          type: 'octaveDoubling',
          policy,
          ...(typeof params.energyThreshold === 'number' ? { energyThreshold: params.energyThreshold } : {}),
          severity: policy === 'forbidden' ? 'hard' : policy === 'climaxOnly' ? 'soft' : 'none',
          source: 'template.rules',
          ...ruleMode(rule),
        }));
        break;
      }
      case 'fillGating': {
        if (!pianoTarget(params.fills) || typeof params.duringRestsOf !== 'string' || typeof params.minGapTicks !== 'number') break;
        output.push(Object.freeze({
          type: 'fillGating',
          fills: params.fills,
          duringRestsOf: params.duringRestsOf,
          minGapTicks: params.minGapTicks,
          severity: 'hard',
          source: 'template.rules',
          ...ruleMode(rule),
        }));
        break;
      }
      case 'overlapAvoid': {
        if ((!pianoTarget(params.actor) && !pianoTarget(params.against))
          || typeof params.actor !== 'string' || typeof params.against !== 'string' || typeof params.windowTicks !== 'number') break;
        output.push(Object.freeze({
          type: 'overlapAvoid',
          actor: params.actor,
          against: params.against,
          windowTicks: params.windowTicks,
          severity: 'soft',
          source: 'template.rules',
          ...ruleMode(rule),
        }));
        break;
      }
      case 'unisonOrnament': {
        if (!Array.isArray(params.tracks) || !params.tracks.includes('piano')
          || !Array.isArray(params.transforms) || !params.transforms.every((item) => typeof item === 'string')) break;
        output.push(Object.freeze({
          type: 'unisonOrnament',
          tracks: Object.freeze(params.tracks.filter((item): item is string => typeof item === 'string')),
          transforms: Object.freeze([...params.transforms]),
          ...(params.divergence === 'perInstrument' ? { divergence: 'perInstrument' as const } : {}),
          // The current template checker reports unisonOrnament as a stub.
          severity: 'stub',
          source: 'template.rules',
          ...ruleMode(rule),
        }));
        break;
      }
    }
  }
  return Object.freeze(output);
}

function snapshotHarmony(span: ResolvedChord): DeepReadonly<ResolvedChord> {
  const parsed = Object.freeze({
    ...span.parsed,
    extensions: Object.freeze([...span.parsed.extensions]),
    intervals: Object.freeze([...span.parsed.intervals]),
    pitchClasses: Object.freeze([...span.parsed.pitchClasses]),
  });
  return Object.freeze({ ...span, parsed }) as DeepReadonly<ResolvedChord>;
}

function snapshotMoment(moment: ConductorPlan['moments'][number]): PianoRelevantMoment {
  return Object.freeze({
    kind: moment.kind as PianoMomentKind,
    startBar: moment.startBar,
    endBar: moment.endBar,
    startTick: moment.startTick,
    endTick: moment.endTick,
    ...(moment.participantRoles ? { participantRoles: Object.freeze([...moment.participantRoles]) } : {}),
    ...(moment.shape ? { shape: moment.shape } : {}),
  });
}

const PROVENANCE: PianoContextProvenance = Object.freeze({
  resolvedTemplate: 'src/config/ensembles.ts: resolveTemplate(project.ensemble)',
  pianoEligibility: 'template roster plus unlocked in-band piano track',
  applicableRules: 'EnsembleTemplate.rules + src/orchestrator/energy/rules.ts severity contracts',
  sections: 'src/orchestrator/spine/index.ts: sectionMap(project)',
  barWindows: 'src/orchestrator/conductor/index.ts: ConductorPlan.bars[].startTick/endTick',
  harmony: 'src/orchestrator/spine/index.ts: chordSpans(project)',
  energy: 'src/orchestrator/spine/energyArc.ts: ArcBar.target and ArcBar.nearSilence',
  layerInformation: 'src/orchestrator/conductor/index.ts: ConductorPlan.bars[].layers (strings-only, partial)',
  moments: 'src/orchestrator/conductor/index.ts: ConductorPlan.moments (keys-relevant kinds)',
  fillWindows: 'src/orchestrator/conductor/index.ts: ConductorPlan.fills (piano/Keys targets)',
  seed: 'src/orchestrator/spine/index.ts: orchestrationSeedFor(project, orchestration)',
  analysis: 'composeAllTracks finalized tracks, excluding piano',
});

/** Build a deeply read-only context from the exact resolved pipeline values. */
export function buildPianoEngineInput(options: BuildPianoEngineInputOptions): PianoEngineInput {
  const { project, ensemble, template, sections, harmony, energy, conductor, seed, finalizedTracks } = options;
  const pianoEligible = isPianoEngineEligible(project, ensemble, template);
  const layerInformation: PianoLayerInformation = Object.freeze({
    availability: 'partial',
    source: 'ConductorPlan.bars[].layers',
    annotatedFamilies: Object.freeze(['Strings'] as const),
    perBar: Object.freeze(conductor.bars.map((bar) => Object.freeze({
      bar: bar.bar,
      layers: Object.freeze(bar.layers.map((layer) => Object.freeze({
        layer: layer.layer,
        trackIds: Object.freeze([...layer.trackIds]),
        source: layer.source,
      }))),
    }))),
    totalCapacity: null,
    totalOccupiedLayers: null,
    unavailableReason: 'Conductor layer slots annotate strings only; total cross-family occupancy/capacity is unavailable and is not inferred.',
  });
  const moments = Object.freeze(conductor.moments
    .filter((moment) => PIANO_MOMENT_KINDS.has(moment.kind))
    .map(snapshotMoment));
  const fillWindows = Object.freeze(conductor.fills
    .filter((fill) => pianoTarget(fill.target))
    .map((fill) => Object.freeze({
      target: fill.target,
      startTick: fill.startTick,
      endTick: fill.endTick,
    })));
  const context: PianoEngineContext = Object.freeze({
    template: Object.freeze({ id: template?.id ?? null, pianoEligible }),
    rules: applicablePianoRules(template, pianoEligible),
    sections: Object.freeze(sections.map((section) => Object.freeze({ ...section }))) as readonly DeepReadonly<SpineSection>[],
    barWindows: Object.freeze(conductor.bars.map((bar) => Object.freeze({
      bar: bar.bar,
      startTick: bar.startTick,
      endTick: bar.endTick,
      sectionId: bar.sectionId,
      sectionName: bar.sectionName,
    }))),
    harmony: Object.freeze(harmony.map(snapshotHarmony)),
    energy: Object.freeze(energy.map((bar) => Object.freeze({
      bar: bar.bar,
      target: bar.target,
      nearSilence: bar.nearSilence,
    }))),
    layerInformation,
    moments,
    fillWindows,
    seed,
    provenance: PROVENANCE,
  });
  return Object.freeze({
    context,
    analysis: buildPianoAnalysisSnapshot(finalizedTracks),
  });
}
