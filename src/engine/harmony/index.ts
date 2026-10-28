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
 * Knowledge and planning, not decisions: nothing here selects, places or
 * modifies chords. Framework-free, dependency-free, deterministic.
 *
 * Example:
 *   const vocabulary = getChordVocabulary({ root: 'D', mode: 'Dorian' });
 *   const analysis = analyzeChordInMode('Bbmaj7', { root: 'D', mode: 'Dorian' });
 *   const profile = buildSectionHarmonyProfile(project, sectionId);
 */
export * from './types';
export * from './vocabulary';
export * from './analysis';
export * from './contours';
export * from './context';
export * from './profiles';
