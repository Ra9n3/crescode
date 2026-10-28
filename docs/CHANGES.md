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

# Harmony engine (Phase 2 — section profiles)

- Extends `src/engine/harmony/` with `contours.ts`, `context.ts`, `profiles.ts` (types extended in `types.ts`, exports in `index.ts`). Still pure TypeScript: no React/Zustand, no new dependencies, no UI or store changes, manual workflow and orchestral Generate untouched.
- Schema: `Section.energy?: number` (0–1, optional, missing = neutral 0.5) added as the SINGLE canonical energy field — the spec assumes one exists; none did. Validated when present (mirrors the `Chord.locked?` pattern), documented in `project.schema.json`. Old files load unchanged.
- `resolveSectionIdentity`: free-form section names ("Final Chorus", "Verse 2", "Pre-Chorus", "Build-Up", "Chorus Reprise", "Coda") resolve to normalized identity + family through conservative keyword/phrase matching with plural handling; unknown names stay neutral (confidence 0) and remain fully supported — no naming convention imposed.
- `analyzeSectionContext`: neighbors, energy deltas, normalized position over the sectioned song span, occurrence/family count via relationship keys (recognized families group by family; unrecognized names group by number-stripped normalized name, so "Jam 1"/"Jam 2" relate while "Section A"/"Part B" stay apart), first/last/near-boundary flags, family-change transition flag.
- `buildSectionHarmonyProfile` / `buildSongHarmonyProfiles`: seven independent dimensions (stability, movement, rhythm, complexity, tension, modal emphasis, contrast) as {preferred, flexibility} pairs — internal planning parameters, not measurements. Identity contributes only ≤0.15 biases (no preset dictionary); context, the section's own energy (deliberately weak on tension, none on stability/modal/contrast) and the existing chordGenSettings (density, complexity, modalEmphasis, variation, borrowing, cadence, preserveIdentity, sectionAware) shift the anchors; `sectionAware:false` reduces identity influence to a residual 0.25 instead of disabling analysis.
- Harmonic rhythm is meter-aware via the shared meter utilities (barTicks/beatOffsets/beatTicks): changes-per-bar plus concrete tick intervals and felt-beat intervals, with a rhythm shape descriptor (hold/regular/mixed/accelerating/decelerating) — no chord timing is placed and no 4/4 assumption exists (6/8 reports 2 felt beats, dotted-quarter beatTicks, compound flag).
- `contours.ts`: reusable stable/rising/falling/arch/valley/wave contour families with deterministic, bounded, duration-independent `evaluateContour`; any dimension may carry one. Profile contours take family from identity tendencies and ranges from the dimension's preference.
- Development roles (establish/repeat/develop/contrast) derive from family recurrence and preserveIdentity; repetition identity outweighs neighbor-boundary contrast for recurring sections.
- Tests: `tests/harmony-profiles.test.ts`, 43 tests covering the ten spec groups (identities, context/energy/settings sensitivity, repetition, unusual structures, contours, 3/4 & 6/8 meter, determinism, no-mutation, Phase 1 + schema regression). Suite total 126; tsc clean; vite build unchanged.
