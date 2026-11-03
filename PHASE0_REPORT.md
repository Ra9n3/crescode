# Phase 0 Report

Date: 2026-11-03 · HEAD at start: `743c2ee` (clean, synced with origin/main) · Phase 0 only — the orchestrator was not started.

## Baseline vs final

| | Baseline (before any change) | Final |
|---|---|---|
| `npm ci` | ✓ (esbuild postinstall allowlist warning only) | — |
| Unit tests (`npx vitest run`) | **530/530 pass, 20 files**, 0 failures | **541/541 pass, 21 files**, 0 failures (+11) |
| `npx tsc --noEmit` | clean | clean |
| `npm run build` | ✓ 2.3 s, `dist/index.html` 1,343 kB, single file (js+css inlined) | ✓ 2.4 s, same size, still single file |
| Code diff | — | 2 files changed, 72 insertions(+), 3 deletions(-); +1 test file (`tests/chord-spans.test.ts`, 121 lines) |

## Chordgen reconciliation (Step 2): neither patch needs applying

**Found: flexgen fully applied — and long superseded.** The tree is post-flexgen, post-chordgen-removal:
`generate()` in `src/engine/generate.ts` is the flexgen architecture (buildContext, seeded streams, rules-schema), since extended by the band system (band-gated writes). Zero trace of the chordgen side: no `src/orchestrator/`, no `SCORE_FLOOR`, no `auditProgression`, no `rerollSection`, no `ChordGenDialog`, no `tests/seed-dump.test.ts` (grep across src/tests/scripts: no matches). The work-order's "adapt the Arranger hunk to the ChordEditor popup" also already happened historically (chord picker popup commits `b85c829`…`4e2d0bc`). The two patch files were deleted from the workspace in the stale-artifact cleanup, so there was nothing to apply and nothing missing. **Action taken: none — report only.**

## Shipped in Phase 0 (Steps 3–4)

- **`chordSpans(project)`** (exported, `src/engine/generate.ts`): the Chords lane as ordered, non-overlapping parsed spans. Unparseable symbols skipped; zero/negative durations dropped; negative starts clamp at 0 (duration kept); sorts by start tick, input order breaking ties; a later start **cuts** the previous span, never extends it; equal starts → later input wins; gaps stay gaps; empty/unparseable lane → `[]`. 9 unit tests, all against `fixtures/dorian-16bars.json` (covers half-bar 1920-tick chords and the C/E, G/B slash chords). `buildContext` was deliberately **not** rewired — generation output is byte-identical to baseline.
- **4c done:** `humanizeNotes` exported from `src/engine/generate.ts` (was module-private) + determinism test.
- **4a guarded:** regression test proves `generate()` never writes notes into the Chords (Structure-family) track — orphaned notes from generation are structurally impossible. The chordgen-era bug itself died with that code path.
- **4b, 4d — N/A, premises stale:** there is no `Chord.locked` field, no auto-lock-on-edit concept anywhere in src (grep: no matches), and no `tests/seed-dump.test.ts` exists to write `seed-audit.txt`. Nothing to wire or gate.

## Step 5 answers (report-only; nothing fixed except where noted)

- **validate.ts layering inversion — real.** `src/shared/schema/validate.ts` imports `ENSEMBLE_IDS` from `../../config/ensembles` (schema layer reaching up into config). Not fixed: a clean fix moves the ensemble id list (or the ensemble validation) down a layer and touches imports across the app — orchestrator-phase work, not a Phase 0 one-liner. Recommended before `src/orchestrator/` lands.
- **Visual scripts use /tmp paths — real, by design.** 7 scripts write probe screenshots to `/tmp/render`; they are headless dev probes, not CI. Left as-is.
- **README "permanently pinned" — stale premise.** Already fixed on HEAD (`743c2ee`): README and the About dialog (`Dialogs.tsx`: "X — Toggle mixer") now agree: toggleable dock, mixer button or X key.
- **sanitizeNotes rebuilds notes — yes.** Each note becomes exactly `{ pitch, startTick, durationTicks, velocity }`: unknown fields are silently dropped; pitches octave-shifted into track range then clamped; zero-length and past-end notes removed; same-pitch overlaps merged by truncating the earlier note; result sorted.
- **midi.ts unknown fields & CC:** export reads only the four known note fields — unknown note fields are ignored and never emitted; **no CC/controller events are written at all** (file header states mixer state is intentionally ignored). Import side (`parseMidiFile`) likewise keeps only notes, tempo, time/key signature and markers; CC events are dropped on round-trip.
- **Where things live:** Compose All = `composeAll()` in `src/store/store.ts` (counts band-skipped via `isInBand`, passes `lockedTrackIds`, one `edit()` undo step, returns `{ ms, bandSkipped, lockedKept }`); band semantics = `src/shared/schema/band.ts` (`flipBand`, `setPin`, `isInBand`, `applyTemplate`); template resolution = `resolveTemplate()` in `src/config/ensembles.ts`; UI = `src/components/TopBar.tsx` (picker + button); generation-side gates = `src/engine/generate.ts` (`isLocked` + in-band check).

## Spec vs repo

`docs/ORCHESTRATOR_SPEC.md` **does not exist** — the nearest artifact is `ORCHESTRATION_ENGINE_PLAN.md` (workspace copy, outside the repo). The work-order's Step 2/4 premises (seed-dump test, chordgen import, `Chord.locked`, patches to reconcile) describe the Oct-27 pre-flexgen snapshot, not this tree. Where spec and repo disagreed, the repo was treated as truth and the discrepancy is recorded above.

## Verdict

**Clean — build on it.** No tangle: the tree is ahead of the work-order, all green (541/541, tsc clean, single-file build), and the only real findings (validate.ts layering, unreferenced `public/images/*.jpg` copied into dist as dead weight) are small, known, and deferred.
