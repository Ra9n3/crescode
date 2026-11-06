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
import type { StringLines } from './render';
import type { MomentPlan } from './conductor/moments';
import type { BrassPlan } from './brass/plan';
import type { WindPlan } from './winds/plan';
import type { PercPlan } from './percussion/plan';

export interface OrchestratorContext {
  project: Project;
  template: EnsembleTemplate | null;
  ensemble: ProjectEnsemble;
  /** Normalized, non-overlapping chord spans (Phase 0 reading). */
  spans: ResolvedChord[];
  sections: SpineSection[];
  /** The per-bar energy arc (Phase 3c) — targets the modules render at. */
  arc?: ArcBar[];
  /** The prepared lines (Phase 4b): motif, counterline, constrained voicing.
   *  An in-memory annotation of the compose run — never persisted. */
  lines?: StringLines;
  /** The take's moments (Phase 7), planned by the conductor before rendering.
   *  An in-memory annotation — never persisted; only the bars a moment
   *  covers may deviate from the texture plan. */
  moments?: MomentPlan[];
  /** The brass plan (Phase 8), planned by the conductor after the moments.
   *  An in-memory annotation — never persisted; the brass renderer realises
   *  it after the rules generator. */
  brassPlan?: BrassPlan;
  /** The winds plan (Phase 9), planned by the conductor after the moments.
   *  An in-memory annotation — never persisted; the winds renderer realises
   *  it after the brass renderer. */
  windPlan?: WindPlan;
  /** The percussion plan (Phase 10), planned by the conductor after the
   *  winds. An in-memory annotation — never persisted; the percussion
   *  renderer realises it after the winds renderer. */
  percussionPlan?: PercPlan;
}

/** The string layer vocabulary the orchestrator renders today (Phase 4a) —
 *  a subset of the shared layer vocabulary from the ensemble-template schema.
 *  Phase 7 adds the moment layers: 'tacet' (a true silence — everything
 *  unlisted is pad, this is the one way to be silent), 'tutti' (the whole
 *  section hits one chord) and 'unison' (every voice plays the lead's line,
 *  spread by octave). The moment layers only ever appear on the bars a
 *  moment covers. */
export type StringsLayer = 'lead' | 'counterline' | 'pad' | 'ostinato' | 'tremolo' | 'bass' | 'tacet' | 'tutti' | 'unison';

/** One layer one section. Phase 4 renders pad, lead, counterline, ostinato,
 *  tremolo and bass layers. */
export interface LayerPlan {
  moduleId: string;
  sectionId: string;
  layer: StringsLayer;
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
