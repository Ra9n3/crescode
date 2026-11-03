# Phase 0 Report

Date: 2026-11-03 · Start: `743c2ee` (clean, synced) · Mid-task the remote gained `fd078a2` ("Update project files"), which staged the work-order's missing artifacts INTO the repo (`docs/ORCHESTRATOR_SPEC.md`, `tests/seed-dump.test.ts`, both patches, `seed-audit.txt`, `ORCHESTRATION_ENGINE_PLAN.md`); it was merged and the work re-done against the integrated tree. Phase 0 only — the orchestrator was not started.

## Baseline vs final

| | Baseline (pre-change local tree) | Final (integrated tree) |
|---|---|---|
| `npm ci` | ✓ (esbuild allowlist warning only) | — |
| Unit tests | **530/530, 20 files**, 0 failures | **542/542, 22 files**, 0 failures. (After the staging merge the uploaded `seed-dump.test.ts` broke the suite — missing `src/orchestrator/chordgen`; resolved, see below.) |
| `npx tsc --noEmit` | clean | clean (note: `tsconfig.json` includes only `src` — tests are not typechecked; vitest is their gate) |
| `npm run build` | ✓ 2.3 s, single-file `dist/index.html` (1,343 kB) | ✓ 2.2 s, still single file (1,344 kB) |
| Code diff (Phase 0 itself) | — | `src/`+`tests/`: 4 files, +287 −3 (chordSpans + 3 test files). Tree-level also: merge +6 staged files, cleanup −3 retired files (recoverable at `fd078a2`) |

## Chordgen reconciliation (Step 2): flexgen won — confirmed, and the loose end is now resolved

**Found: flexgen fully applied and long superseded.** `generate()` in `src/engine/generate.ts` is the flexgen architecture, since extended by the band system (band-gated writes). Zero trace of the chordgen engine in `src/`: no `src/orchestrator/`, no `generateProgressionDetailed`, `SCORE_FLOOR`, `auditProgression`, `rerollSection` or `ChordGenDialog` (grep across src/tests/scripts: no matches). The work-order's "adapt the Arranger hunk to the ChordEditor popup" already happened historically (chord picker popup commits `b85c829`…`4e2d0bc`).

**Resolution (default plan applied): flexgen wins.** The uploaded `tests/seed-dump.test.ts` still imported the dead chordgen module (`Cannot find module '../src/orchestrator/chordgen'`) and used the chordgen-era concepts (`SCORE_FLOOR`, chord-level `locked`) that do not exist — `Chord` is `{ id, symbol, startTick, durationTicks }`. The harness was **adapted to the shipped engine**: same 20 seeds × 5 structures, now built on the fixture's standard tracks, dumping per-family and per-section note counts as a listening map, with inline assertions for determinism (same seed → byte-identical) and locked-track invariance. Its dump now goes to `os.tmpdir()` (or `$CRESCODE_SEED_AUDIT_OUT`), never the repo root — **Step 4d done**. The chordgen-era patches and the stale `seed-audit.txt` were retired from the tree in a follow-up commit (git history keeps them).

## Shipped in Phase 0 (Steps 3–4)

- **`chordSpans(project)`** (exported, `src/engine/generate.ts`): the chord lane as ordered, non-overlapping parsed spans — the "normalized chord list" the spec's §7.3/§8 `spine/` expects from Phase 0. Unparseable symbols skipped; zero/negative durations dropped; negative starts clamp at 0 (duration kept); sorted by start tick, input order breaking ties; a later start **cuts** the previous span, never extends it; equal starts → later input wins; gaps stay gaps; empty/unparseable lane → `[]`. 9 unit tests on `fixtures/dorian-16bars.json` (half-bar 1920-tick chords and C/E, G/B slash chords included). `buildContext` deliberately not rewired — generation output byte-identical to baseline.
- **4c done:** `humanizeNotes` exported (was module-private; the spec §4 flagged it and §7.6 depends on it) + determinism test.
- **4a guarded:** regression test proves `generate()` never writes notes into the Chords (Structure-family) track — orphaned notes from generation are structurally impossible. The chordgen-era bug died with that code path.
- **4b — N/A, premise stale:** no `Chord.locked` field and no auto-lock-on-edit concept exists anywhere in `src/` (grep: no matches). Locks are track-level; nothing to wire.
- **4d done** (see above).

## Step 5 answers (report-only; nothing fixed except where noted)

- **validate.ts layering inversion — real.** `src/shared/schema/validate.ts` imports `ENSEMBLE_IDS` from `../../config/ensembles` (schema reaching up into config). Not fixed: a clean fix moves the id list (or ensemble validation) down a layer and touches imports app-wide — orchestrator-phase prep, not a Phase 0 one-liner.
- **Visual scripts use /tmp paths — real, by design.** 7 scripts write probe screenshots to `/tmp/render`; headless dev probes, not CI. Left as-is.
- **README "permanently pinned" — stale premise.** Already fixed on HEAD (`743c2ee`): README and About dialog (`Dialogs.tsx`: "X — Toggle mixer") agree: toggleable dock, mixer button or X key.
- **sanitizeNotes rebuilds notes — yes.** Each note becomes exactly `{ pitch, startTick, durationTicks, velocity }`: unknown fields silently dropped; pitches octave-shifted into range then clamped; zero-length/past-end notes removed; same-pitch overlaps merged by truncating the earlier note; sorted. (Spec §2.4 wants it to stay a no-op on orchestrator output — it will, if output is already clean.)
- **midi.ts unknown fields & CC:** export reads only the four known note fields — unknown fields are never emitted; **no CC/controller events are written at all** (header says mixer state is intentionally ignored). `parseMidiFile` likewise keeps only notes, tempo, time/key signature, markers; CC is dropped on round-trip. (Spec §7.5 wants CC export in Phase 5 — that is additive work in this file.)
- **Where things live:** Compose All = `composeAll()` in `src/store/store.ts` (counts `bandSkipped` via `isInBand`, passes `lockedTrackIds`, one `edit()` undo step, returns `{ ms, bandSkipped, lockedKept }`); band semantics = `src/shared/schema/band.ts` (`flipBand`, `setPin`, `isInBand`, `applyTemplate`); template resolution = `resolveTemplate()` in `src/config/ensembles.ts`; UI = `src/components/TopBar.tsx`; generation-side gates = `src/engine/generate.ts` (`isLocked` + in-band check).

## Spec (`docs/ORCHESTRATOR_SPEC.md`) vs repo

The spec self-describes as design-only with possibly stale facts, and its verifiable claims **check out**: PPQ 960; `Note` = 4 fields; V1 range G3–C7 ([55, 96]); `parseChord`, `roleOfChordRoot`, `gridResolutionOf`, `scalePitchClasses`, `barTicks`, `beatOffsets` all exist (the latter two helpers live in the suggestion module, not the engine); all six template budgets in its §5 table match `specs/ensemble-templates/templates/*.json` **exactly** (maxLayers + energy clamps); "humanizeNotes is not exported yet" was true and is now resolved. Its §4 call-out — "seed-dump.test.ts imports src/orchestrator/chordgen … Phase 0 resolves this" — is resolved as above (module does not exist; harness adapted; flexgen wins). One nuance for Phase 1: the spec's §4 "Chord lane notes are tied to clips only by tick windows" holds, and `chordSpans` is now the shared reading it asks for. Nothing in the spec contradicts the tree today.

## Verdict

**Clean — build on it.** The suite is green end-to-end (542/542 across 22 files, tsc clean, single-file build), the work-order's stale premises are all resolved or documented, and the two real findings (validate.ts schema→config import; unreferenced `public/images/*.jpg` copied into dist as dead weight) are small, known, and deliberately deferred.
