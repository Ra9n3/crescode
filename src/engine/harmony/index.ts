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
