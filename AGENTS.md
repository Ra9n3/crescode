# AI coding guide

Start here for repository navigation. For product usage and setup, see [README.md](README.md). For detailed musical orchestration contracts, see [docs/ORCHESTRATOR_SPEC.md](docs/ORCHESTRATOR_SPEC.md).

## Working rules

- Treat the current source and tests as authoritative over plans, reports, and recorded test totals. Historical phase reports describe specific snapshots, not necessarily this working tree.
- Preserve all unrelated working-tree changes, including untracked files. Do not reset, stash, clean, overwrite, or change unrelated instruments or subsystems.
- Follow the existing module boundaries. Read the relevant symbols and focused tests; do not read entire large source files when they are unnecessary.
- Do not load large `tests/golden*/` datasets or `evaluation/` bundles unless a task specifically requires that evidence. Tests can consume the fixtures without loading them into your context.
- Run focused tests first, then expand verification to adjacent integration tests or the full suite according to the change's scope. Use `npm run typecheck` when appropriate. Do not install dependencies without authorization.
- Never report tests, typecheck, or build as passing unless that command actually ran successfully. State any verification limits.

## Production Compose All path

`src/components/TopBar.tsx` → `src/store/store.ts` → `src/orchestrator/compose.ts`.

`src/orchestrator/compose.ts` coordinates the production pipeline and dedicated family renderers. `src/engine/generate.ts` is the generic rules interpreter: it supplies remaining rules-driven work and compatibility inputs, but is **not** the sole owner of Compose All's musical decisions. The generic keys renderer in `src/orchestrator/keys/render.ts` owns Harp and produces intermediate Piano candidates; Piano Engine V5 replaces the final Piano output after the non-Piano parts are composed. See §16.11 in `docs/ORCHESTRATOR_SPEC.md` for the generation identity, localized quiet-bar behavior, orchestration visibility gates, CC64 merge, and export path. Harp remains with the existing keys/orchestration path and is not replaced by V5.

## Task-to-source and focused-test map

| Task | Start with | Focused tests |
|---|---|---|
| Production composition | `src/store/store.ts`, `src/orchestrator/compose.ts` | `tests/orchestrator-compose.test.ts`, `tests/compose-failure.test.ts` |
| Family orchestration | `src/orchestrator/compose.ts`; `src/orchestrator/render.ts`; `src/orchestrator/brass/render.ts`; `src/orchestrator/winds/render.ts`; `src/orchestrator/percussion/render.ts`; `src/orchestrator/keys/plan.ts`, `render.ts` | `tests/orchestrator-compose.test.ts`, `tests/orchestrator-conductor.test.ts`, `tests/orchestrator-energy.test.ts`, `tests/orchestrator-lines.test.ts`, `tests/orchestrator-voicing.test.ts`; add the relevant `tests/phase*.test.ts` for cross-family behavior |
| Piano Engine integration and handoff | `src/orchestrator/compose.ts`, `src/orchestrator/keys/piano-engine.ts`, `src/orchestrator/keys/analysis.ts` | `tests/piano-engine-production.test.ts`, `tests/phase4a.test.ts`, `tests/phase4b.test.ts` |
| Piano Analyzer | `src/orchestrator/keys/piano-analyzer.ts` | `tests/phase4b.test.ts`, `tests/piano-dynamic-alignment.test.ts` |
| Piano Composer | `src/orchestrator/keys/piano-composer.ts` | `tests/phase5.test.ts`, `tests/piano-dynamic-alignment.test.ts`, `tests/phase8-followthrough.test.ts` |
| Piano Realizer and policies | `src/orchestrator/keys/piano-realizer.ts`, `src/orchestrator/keys/piano-octave-policy.ts`, `src/orchestrator/keys/piano-pedal.ts` | `tests/phase6.test.ts`, `tests/phase8-followthrough.test.ts`, `tests/piano-engine-production.test.ts`, `tests/piano-pedal.test.ts` |
| Harp and keys governance | `src/orchestrator/keys/plan.ts`, `src/orchestrator/keys/profile.ts`, `src/orchestrator/keys/render.ts`, `src/orchestrator/compose.ts` | `tests/harp-regression.test.ts`; use `tests/phase7.test.ts`, `tests/phase8.test.ts`, or `tests/phase10.test.ts` for the relevant moment/governance interaction |
| Ensemble template policies | `specs/ensemble-templates/templates/*.json`, `src/shared/schema/ensembleTemplate.ts`, `src/config/ensembles.ts`, `src/shared/schema/band.ts`; Piano-specific adaptation is in `src/orchestrator/keys/piano-engine.ts` and `src/orchestrator/keys/piano-composer.ts` | `tests/ensemble-template.test.ts`, `tests/band.test.ts`, `tests/orchestrator-energy.test.ts`, `tests/piano-engine-production.test.ts` |
| CC64 and MIDI/UVI export | `src/orchestrator/keys/piano-pedal.ts`, `src/orchestrator/keys/piano-realizer.ts`, `src/orchestrator/compose.ts`; `src/export/midi.ts`, `src/export/profile.ts`, `src/export/profiles/index.ts`, `src/export/profiles/uvi-orchestral-suite.json` | `tests/piano-pedal.test.ts`, `tests/uvi-piano-profile.test.ts`, `tests/export.test.ts`, `tests/phase12.test.ts` |

Phase-numbered `tests/phase*.test.ts` files are active regression tests, not historical reports. Select the narrowest relevant test first, then add integration coverage when a change crosses module boundaries.

## Piano reading strategy

- **Integration/handoff:** `src/orchestrator/compose.ts` → `src/orchestrator/keys/piano-engine.ts` → `src/orchestrator/keys/analysis.ts`.
- **Analyzer:** `src/orchestrator/keys/piano-analyzer.ts` observes the immutable input; it does not plan or write notes.
- **Composer:** `src/orchestrator/keys/piano-composer.ts` turns analysis into symbolic Piano intentions; it does not emit MIDI notes.
- **Realizer:** `src/orchestrator/keys/piano-realizer.ts` realizes notes and applies `src/orchestrator/keys/piano-octave-policy.ts` and `src/orchestrator/keys/piano-pedal.ts`.
- **Export:** follow the CC64 merge in `src/orchestrator/compose.ts` into `src/export/midi.ts` and the profile files listed above.

Read only the stage a small change affects. Add the production integration test when a change alters the handoff or behavior across stages; do not read Analyzer, Composer, and Realizer end-to-end for every Piano task.
