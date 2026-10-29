/**
 * Harmony module — Crescode's musical understanding layer.
 *
 * Phase 1 (vocabulary): scales, algorithmically discovered chord vocabulary,
 * modal characteristic tones, chromatic/parallel-mode analysis and
 * chord-relationship facts.
 *
 * Phase 2 (profiles): section identity recognition, arrangement context,
 * flexible per-section harmonic preferences, evolution contours and
 * repetition/development relationships — a planning layer for future
 * generation phases.
 *
 * Phase 3 (phrase & cadence planning): phrase organization inside sections,
 * phrase roles and directions, intended cadential arrivals with
 * mode-derived cadence-family compatibility, section-boundary intentions and
 * repeated-material links — a song-level blueprint for the future chord
 * selector.
 *
 * Knowledge and planning, not decisions: nothing here selects, places or
 * modifies chords. Framework-free, dependency-free, deterministic.
 *
 * Example:
 *   const vocabulary = getChordVocabulary({ root: 'D', mode: 'Dorian' });
 *   const analysis = analyzeChordInMode('Bbmaj7', { root: 'D', mode: 'Dorian' });
 *   const profile = buildSectionHarmonyProfile(project, sectionId);
 *   const songPlan = planSongHarmony(project, { seed: 7 });
 */
export * from './types';
export * from './vocabulary';
export * from './analysis';
export * from './contours';
export * from './context';
export * from './profiles';
export * from './cadences';
export * from './phrases';
export * from './plan';

// Phase 4 — chord progression generation (the engine's first stage that
// creates chord events; everything above remains knowledge and planning).
export * from './coverage';
export * from './rhythm';
export * from './candidates';
// Phase 4.1 — structural harmony separated from chord color.
export * from './foundation';
export * from './progression';
export * from './color';
export * from './generation';
export * from './generation-types';
// Phase 4.2 — observational diagnostics (explain decisions, change nothing).
export * from './diagnostics';
export * from './diagnostics-format';
// Phase 5 — complete-progression evaluation & candidate selection:
// whole-phrase / whole-song musical evaluation, bounded candidate
// generation over the production generator, and seeded selection among
// musically competitive complete outcomes.
export * from './evaluation';
export * from './selection';
