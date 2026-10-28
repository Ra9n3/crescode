/**
 * Harmony module (Phase 1) — Crescode's musical understanding layer.
 *
 * Knowledge, not decisions: scales, algorithmically discovered chord
 * vocabulary, modal characteristic tones, chromatic/parallel-mode analysis
 * and chord-relationship facts. Framework-free, dependency-free,
 * deterministic. Progression generation belongs to later phases.
 *
 * Example:
 *   const vocabulary = getChordVocabulary({ root: 'D', mode: 'Dorian' });
 *   const analysis = analyzeChordInMode('Bbmaj7', { root: 'D', mode: 'Dorian' });
 */
export * from './types';
export * from './vocabulary';
export * from './analysis';
