/**
 * Phase 4 public types — chord progression generation.
 *
 * The scope shape mirrors lib/genScope.ts structurally (the UI layer's
 * detected scope assigns directly) without an engine → lib import. All result
 * types are plain data: no React, no store, no async.
 */
import type { Chord, ChordGenSettings } from '../../shared/schema/types';
import type { CadenceFamily } from './types';

/** What the generator was asked to do (mirrors lib/genScope.ts). */
export type GenerationScope =
  | { type: 'all' }
  | { type: 'empty' }
  | { type: 'section'; sectionId: string };

/** Diagnostics for one generation run — for tests, debugging and Phase 5
 *  evaluation. No UI is built on this in Phase 4 (spec §14). */
export interface ChordGenerationReport {
  /** The effective seed used (options.seed, else the persisted seed). */
  seed: number;
  scope: GenerationScope;
  /** Number of NEW chord events the run produced. */
  generatedChordCount: number;
  /** Number of existing chord events preserved unchanged (same objects). */
  preservedChordCount: number;
  /** Section ids whose span contains at least one generated event. */
  sectionsAffected: string[];
  warnings: string[];
  /** Generated chords carrying tones outside the project mode. */
  borrowedSymbols: string[];
  /** Phrase windows the generator worked through (planned + synthetic). */
  phraseCount: number;
  /** Cadence approach families realized at planned arrivals. */
  cadenceFamiliesUsed: CadenceFamily[];
  /** Harmonic-rhythm summary over generated events. */
  rhythmSummary: { changes: number; meanDurationTicks: number };
  /** Anchor constraints the run respected. */
  anchorConstraints: {
    /** Symbols of preserved anchors before/after the first target. */
    before: string | null;
    after: string | null;
    /** Number of protected (preserved) spans inside the region. */
    protectedSpans: number;
  };
}

export interface ChordGenerationResult {
  /**
   * CONTRACT: the FULL replacement for `project.chords` — every preserved
   * event (original id/symbol/timing/locked flag) plus every newly generated
   * event, sorted by startTick. Store integration commits this array as one
   * undoable step; it is never a fragment.
   */
  chords: Chord[];
  report: ChordGenerationReport;
}

export interface GenerateProgressionOptions {
  /** Deterministic seed; defaults to the project's persisted generator seed.
   *  Never advanced or persisted here — that belongs to the store layer. */
  seed?: number;
  /** Requested scope; defaults to the whole song. */
  scope?: GenerationScope;
  /** Overrides merged over the project's persisted chordGenSettings. */
  settings?: Partial<ChordGenSettings>;
}
