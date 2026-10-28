# Schema changes

- None to the §3 contract. Optional `exportedAt` (string) is accepted on JSON export/import and stripped on import.
- Range table: Snare/Cymbals/Aux are expressed as fixed notes (38/49/42) via `fixedNote`, as the brief specifies; no pitched ranges were altered.

# Harmony engine (Phase 1)

- New framework-free module `src/engine/harmony/` (`types.ts`, `vocabulary.ts`, `analysis.ts`, `index.ts`). The brief suggested `src/orchestrator/harmony/`; the repository's convention places pure algorithmic code under `src/engine/`, so the module lives there. No React/Zustand imports, no new dependencies.
- Reuses `src/shared/schema/modes.ts` (MODES, MODE_NAMES, NOTE_NAMES, scalePitchClasses) and `src/shared/schema/chords.ts` (parseChord) — no duplicated scale or pitch-class data, no separate chord notation.
- Chords are discovered algorithmically from scale pitch classes and a catalog of 14 fundamental interval formulas; no per-mode chord tables. Cardinality-agnostic (7-note modes, 6-note Whole Tone, 8-note Diminished scales).
- Modal characteristic tones are derived by scale comparison (nearest same-third, same-cardinality, non-symmetrical relatives), not hardcoded per mode; symmetrical scales return an empty set with an explicit `symmetric` flag.
- Vocabulary/analysis functions are descriptive only: no progression generation, no scoring, no borrowing decisions. Manual chord entry, the chord editor, and the orchestral Generate workflow are untouched (no UI or store changes in this phase).
- All emitted chord symbols round-trip through the existing parser with identical pitch-class content, verified across all 144 tonic/mode combinations in `tests/harmony-vocabulary.test.ts` (25 new tests; suite total 83).
