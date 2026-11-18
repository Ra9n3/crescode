/**
 * Shared orchestrator context.
 *
 * This used to describe the whole family-module system (strings, brass, winds,
 * percussion, keys). Those generators are gone; Piano Engine V5 is the only
 * composer left, and `OrchestratorContext` is the run state it reads.
 */
import type { Project, ProjectEnsemble } from '../shared/schema/types';
import type { EnsembleTemplate } from '../shared/schema/ensembleTemplate';
import type { ResolvedChord, SpineSection, ArcBar } from './spine';
import type { MomentPlan } from './conductor/moments';

/** Layer vocabulary the old conductor used. Nothing renders layers now, but the
 *  piano engine's context shape still names them, so the type lives on. */
export const LAYER_VOCABULARY = [
  'lead', 'pad', 'ostinato', 'tremolo', 'counterline', 'bass', 'fill',
  'stab', 'percussion', 'color', 'sub', 'riser', 'texture',
] as const;
export type LayerName = (typeof LAYER_VOCABULARY)[number];

export interface OrchestratorContext {
  project: Project;
  template: EnsembleTemplate | null;
  ensemble: ProjectEnsemble;
  /** Normalized, non-overlapping chord spans (Phase 0 reading). */
  spans: ResolvedChord[];
  sections: SpineSection[];
  /** The per-bar energy arc (Phase 3c) — targets the renderer works at. */
  arc?: ArcBar[];
  /** The take's moments (Phase 7). An in-memory annotation — never persisted. */
  moments?: MomentPlan[];
  /** Variety switch, retained for call-site compatibility. */
  variety?: boolean;
  /** Diagnostic lines the piano engine appends during a compose. In-memory
   *  annotation of the run — never persisted. */
  reports?: string[];
}
