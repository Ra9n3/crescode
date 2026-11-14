/**
 * Strings V1 musical understanding (Stage 1): the composition brief, the
 * harmonic map and the structural proposal. Pure analysis of what the
 * project already holds — it writes no notes and changes nothing.
 */
import type { EnsembleTemplate } from '../../../shared/schema/ensembleTemplate';
import { projectEndTick } from '../../../shared/schema/meter';
import type { Project, ProjectEnsemble } from '../../../shared/schema/types';
import type { ArcBar, ResolvedChord, SpineSection } from '../../spine';
import { buildCompositionBrief, type CompositionBrief } from './brief';
import { buildHarmonicMap, type HarmonicMap } from './harmony';
import { buildStructuralProposal, type StructuralProposal } from './structure';

export * from './brief';
export * from './harmony';
export * from './structure';

export interface StringsUnderstanding {
  readonly brief: CompositionBrief;
  readonly harmony: HarmonicMap;
  readonly structure: StructuralProposal;
}

export interface UnderstandingInput {
  readonly project: Project;
  readonly template: EnsembleTemplate | null;
  readonly ensemble: ProjectEnsemble;
  readonly spans: readonly ResolvedChord[];
  readonly sections: readonly SpineSection[];
  readonly arc?: readonly ArcBar[];
  /** The take being composed. */
  readonly take: number;
}

export function buildStringsUnderstanding(input: UnderstandingInput): StringsUnderstanding {
  const sectionsProvided = input.project.sections.length > 0;
  const brief = buildCompositionBrief(input);
  const harmony = buildHarmonicMap({ project: input.project, spans: input.spans, endTick: projectEndTick(input.project) });
  const structure = buildStructuralProposal({ harmony, sections: input.sections, sectionsProvided });
  return { brief, harmony, structure };
}
