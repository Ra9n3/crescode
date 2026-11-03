/**
 * The family-agnostic module interface (spec §8). A family module reads the
 * spine (chord spans, section map, band) and answers two questions per
 * section: which layers it wants, and what notes realise a layer. Compose All
 * runs registered modules first, then the rules generator for families with
 * no module, then the audit.
 */
import type { Note, Project, TrackFamily, ProjectEnsemble } from '../shared/schema/types';
import type { EnsembleTemplate } from '../shared/schema/ensembleTemplate';
import type { ResolvedChord, SpineSection, ArcBar } from './spine';

export interface OrchestratorContext {
  project: Project;
  template: EnsembleTemplate | null;
  ensemble: ProjectEnsemble;
  /** Normalized, non-overlapping chord spans (Phase 0 reading). */
  spans: ResolvedChord[];
  sections: SpineSection[];
  /** The per-bar energy arc (Phase 3c) — targets the modules render at. */
  arc?: ArcBar[];
}

/** One layer one section. Phase 2 only ever produces pad layers. */
export interface LayerPlan {
  moduleId: string;
  sectionId: string;
  layer: 'pad';
  /** The track ids that will carry this layer, bass voice first. */
  voiceTrackIds: string[];
  /** Conductor breath windows per TRACK id (3a): the track rests inside
   *  these tick windows — the renderer cuts its notes around them. */
  breathByTrack?: Record<string, [number, number][]>;
}

/** The notes a module wants written, keyed by TRACK id. */
export interface SectionPatch {
  notesByTrackId: Record<string, Note[]>;
}

export interface SectionModule {
  /** The family this module owns. */
  family: TrackFamily;
  /** Layer plan per section (skips sections it has nothing to say about). */
  roles(ctx: OrchestratorContext): LayerPlan[];
  /** Realise one layer. Pure: same inputs → same notes. */
  render(ctx: OrchestratorContext, plan: LayerPlan, seed: number): SectionPatch;
}
