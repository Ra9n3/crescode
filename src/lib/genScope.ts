/**
 * Generation-scope detection (spec §2, §4) — framework-free so it is directly
 * unit-testable. Decides what the Generate button WOULD do from the current
 * project state and the active selection. Deliberately knows nothing about
 * click history, the musical engine, or chord locks (locking is a protection
 * concern for the future generator, not a scope concern).
 *
 * Coverage is interval-based (spec §11): chord spans are merged and compared
 * against the song span, so a gap between two chords is detected exactly like
 * a gap at the start or end. All times are ticks at the project's PPQ; bar
 * spans come from the shared meter utilities, so non-4/4 meters work as-is.
 */
import { barTicks } from '../shared/schema/meter';
import type { Project } from '../shared/schema/types';

export type GenerationScope =
  | { type: 'all' }
  | { type: 'empty' }
  | { type: 'section'; sectionId: string };

export type CoverageKind = 'empty-song' | 'partial' | 'full';

export interface SongCoverage {
  kind: CoverageKind;
  /** Song span in ticks (sections and chords define it; 0 when the song is empty). */
  spanTicks: number;
  /** Ticks of the span actually covered by merged chord intervals. */
  coveredTicks: number;
  /** Number of distinct gaps found between/around chord intervals. */
  gapCount: number;
}

/** Song span in ticks: the end of the last section or chord, whichever is further. */
export function songSpanTicks(p: Pick<Project, 'sections' | 'chords' | 'timeSignature'>): number {
  const bt = barTicks(p.timeSignature);
  let end = 0;
  for (const s of p.sections) end = Math.max(end, (s.startBar - 1 + s.lengthBars) * bt);
  for (const c of p.chords) end = Math.max(end, c.startTick + c.durationTicks);
  return end;
}

/** Interval-coverage walk over [0, span): merges overlapping/adjacent chord spans. */
export function songCoverage(p: Pick<Project, 'sections' | 'chords' | 'timeSignature'>): SongCoverage {
  const span = songSpanTicks(p);
  if (span <= 0 || p.chords.length === 0) return { kind: 'empty-song', spanTicks: span, coveredTicks: 0, gapCount: 0 };
  const sorted = [...p.chords].sort((a, b) => a.startTick - b.startTick);
  let covered = 0;
  let cursor = 0;
  let gaps = 0;
  for (const c of sorted) {
    const s = Math.max(0, c.startTick);
    const e = Math.min(span, c.startTick + c.durationTicks);
    if (e <= cursor) continue; // fully inside / behind the merged region
    if (s > cursor) gaps++; // a real hole before this chord
    covered += e - Math.max(cursor, s);
    cursor = e;
    if (cursor >= span) break;
  }
  const full = covered >= span;
  return { kind: full ? 'full' : 'partial', spanTicks: span, coveredTicks: covered, gapCount: gaps };
}

/**
 * The scope Generate would act on right now (spec §2 table):
 * - a selected section always wins (a selected chord is ignored — song-wide behavior);
 * - an empty chord track → the whole song;
 * - otherwise: fully tiled → whole song, any gap → fill empty spaces only.
 */
export function detectGenerationScope(p: Project, selectedSectionId: string | null): GenerationScope {
  if (selectedSectionId && p.sections.some((s) => s.id === selectedSectionId)) {
    return { type: 'section', sectionId: selectedSectionId };
  }
  const cov = songCoverage(p);
  if (cov.kind === 'empty-song') return { type: 'all' };
  return cov.kind === 'full' ? { type: 'all' } : { type: 'empty' };
}

/** What the Generate button tells the user it will do before they click it (spec §4 table). */
export function scopeTooltip(scope: GenerationScope, p: Project): string {
  if (scope.type === 'section') {
    const s = p.sections.find((x) => x.id === scope.sectionId);
    return `Regenerate selected section: ${s ? s.name : '?'}`;
  }
  if (scope.type === 'empty') return 'Fill empty chord spaces';
  return p.chords.length === 0 ? 'Generate chords for entire song' : 'Regenerate entire song';
}

/** Short label for status lines and tests. */
export function scopeLabel(scope: GenerationScope, p: Project): string {
  switch (scope.type) {
    case 'section': {
      const s = p.sections.find((x) => x.id === scope.sectionId);
      return `section "${s ? s.name : '?'}"`;
    }
    case 'empty': return 'fill empty spaces';
    default: return 'entire song';
  }
}
