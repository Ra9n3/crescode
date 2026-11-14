# Strings V1 — Ensemble Orchestration Identity V1

## Status and boundaries

Implementation and a new MIDI evaluation package, 2026-11-14. **Not listening-approved, not production-UI-enabled, and not a clean Vitest/typecheck/build sign-off.** No dependencies installed, no commit or push. Existing Identity/Development V2 material, package and earlier working-tree changes are preserved.

Classic remains the implicit/default production mode. Developer API `stringsComposition: 'v1'` now defaults to the coordinated ensemble path. Explicit `stringsDevelopment: 'identity-v2'` reconstructs the earlier sequential V2 handoff; `'legacy'` reconstructs Stage 2–6 before V2. `'ensemble-v1'` explicitly selects the new default. These are developer reconstruction controls, not a register/opening preset UI.

## 1. Architecture: plan before placement

`composition.ts` makes V2 theme/phrase intentions, calls `orchestration/plan.ts` **before** selecting/placing its diagnostic violin preview, and attaches the piece plan. `orchestration/realize.ts` realizes that plan jointly at the end of `composeAllTracks`, after Piano and the classic cello/bass split. The preview is never installed first. Nonstring composition continues to consume the original classic string information.

Inputs include actual key/scale and resolved chord facts, chromatic share and root-motion rate, theme centroid/range/head–tail direction/rhythmic density, V2 phrase development and written breaths, phrase-level energy, sounding windows/near-silence, template-derived roster/energy, unlocked eligible tracks, configured track bounds, physical writing bounds and export-triggerable capabilities. Template effects are partly indirect through roster and energy; there is no claim that changing templates freezes the theme or project identity.

The plan allocates phrase foreground, floor, supporting middle/tenor layer, motion, breath answers and deliberate omissions. It chooses a foreground by musical-register and activity suitability, not a seed modulo or equal-probability opening menu. Energy/form progress and thematic direction affect later ownership and tessitura. All decisions carry reasons. A patient spacious subject may begin with harmonic preparation and only its later thematic continuation; a bright active low-patience subject can begin exposed. The rest of the piece still uses the same V2 memory.

There is no required I > II > Viola > Cello > Bass chain. A lower foreground can have upper accompaniment. When Bass owns the floor, Cello can occupy tenor space; when Cello owns the floor, a delayed higher Bass chord-tone reinforcement can be appropriate. The five-desk roster is not an activity quota.

## 2. Realization and accepted writers

The new coordinator supplies symbolic material to **unchanged** `writeVoice`, `writeCompanionVoice`, `writeViolaVoice`, `writeCelloVoice` and `writeDoubleBassVoice`. These accepted expressive writers still shape bowing, breath, articulation and velocity. The historical sequential composition/search/review modules remain intact for reconstruction. The new path does not call those sequential searches with fictional classic lower parts: it constructs their new orchestration material in the coordinated realizer instead.

Foreground preserves the exact V2 phrase/fragment/inversion/sequence/reconstruction pitches and timing, except whole-gesture octave placement and the explicitly planned introduction omission. Each contribution is fitted independently to physical/configured bounds. No individual thematic pitch folding or random transposition is used. Preferred tessitura can broaden to the physical writing window, with a recorded repair; an impossible whole-gesture fit rejects the contribution. Failure of any foreground causes atomic classic ensemble fallback.

Answers use a genuine head fragment, augmentation for Bass, and the existing harmonic adaptation/judgement machinery. A breath that cannot hold two unsqueezed notes is withheld in the plan, not counted as a successful response. Supporting tones are current-chord tones, split at every harmony boundary; borrowed/chromatic tones require the actual chord. Candidate scoring considers planned centre, smooth motion, floor responsibility and contrary/oblique preference. Close seconds and close tritones against already placed material are withheld. This is an economical deterministic search, **not a complete global counterpoint optimizer** or an acoustic masking model.

Expression uses the completed roster (including a newly materialized Bass desk), final nonstring notes for caps, existing humanization/legato/CC functions, and clamps tails to contribution/harmony boundaries. It never fills a planned silence. No UVI profile, keyswitch, transposition, articulation mapping, export module or UI file was edited.

## 3. Honest realization accounting

`stringsDiagnostics.v1.orchestration` is authoritative for the final new ensemble. `composition` is the V2 thematic source plus violin preview, not the final foreground. Its `written` flag must not be interpreted as ensemble success. The old `ensemble`, `viola`, `cello`, `doubleBass` fields remain null in the new path; they are not populated with fictitious successes. A lower-only ensemble can succeed while its unavailable violin preview honestly reports `written: false`.

Per-contribution diagnostics record planned ticks, generated expressive-grid notes/ticks/coverage/range, octave, repairs, rejection reason, and post-expression realized notes/ticks/coverage. Minimum generated coverage: foreground 0.55, answer 0.20, support/floor/motion 0.35. Foreground is checked again after expression at 0.55; a gross post-expression loss/bounds failure also triggers atomic fallback. These are transparent engineering safeguards, not musical-quality scores.

Per desk: `substantial`, `partial`, `intentional-sparse`, `intentional-silence`, `rejected-silent`, `classic-fallback`, or `unavailable`; note count, interval-union occupied ticks, whole-piece occupancy, realized/planned phrase coverage, range, and exact-pitch-independent onset fraction. A desk with two notes or below 10% occupancy is explicitly sparse. Long held foundation roles are assessed by duration, not a universal note quota. Rejected contributions are not installed or relabelled as intentional sparse writing. Fallback diagnostics report the retained classic notes, not zero newly written notes masquerading as the exported part.

Export is a third, separate stage: production diagnostics say `not-serialized-here`. The independent evidence parser measures actual MIDI occupancy/register/entrances and checks mapped content; the composer never claims to have validated bytes it has not serialized.

## 4. Technical verification actually executed

### Standard toolchain: blocked, not passed

No `node_modules`, Vitest, TypeScript or Vite exists in this environment. The exact commands/output/exit codes are in `evaluation/strings-orchestration-v1/*-command.txt` and `standard-command-results.json`:

- Targeted: `npm test -- tests/strings-orchestration-v1.test.ts tests/strings-identity-v2.test.ts tests/strings-v1-voice.test.ts tests/strings-v1-ensemble.test.ts tests/strings-v1-viola.test.ts tests/strings-v1-cello.test.ts tests/strings-v1-double-bass.test.ts --maxWorkers=1 --minWorkers=1`
- Adjacent: `npm test -- tests/strings-classic-fingerprint.test.ts tests/strings-v1-mode.test.ts tests/orchestrator-compose.test.ts tests/piano-engine-production.test.ts tests/phase4a.test.ts tests/phase4b.test.ts tests/harp-regression.test.ts tests/piano-pedal.test.ts tests/export.test.ts tests/phase12.test.ts --maxWorkers=1 --minWorkers=1`
- Full: `npm test -- --maxWorkers=1 --minWorkers=1`
- `npm run typecheck`
- `npm run build`

All five exited **127** (`vitest`, `tsc`, or `vite: not found`). No timeouts, no test workers started; one worker was requested for each test command. No test count is attributed to these failed runners. New Vitest coverage was added without weakening or rewriting existing tests. Nine relevant TS files passed native **syntax transformation only**; MJS and Python syntax checks also passed. This is not semantic type checking.

### Explicit dependency-free execution: passed

Node 22's TS syntax transformer is used by the new audit loader, not by the production app. Missing `midi-file` is replaced **only with explicit `CRESCODE_AUDIT_CODEC=1`** by a small authored audit SMF encoder; there is no installed package or production dependency change. The actual production composition, export functions and UVI profile transformations execute. There is no parser mock: MIDI is independently parsed in Python. This does not verify every behavior of the unavailable third-party library.

Commands (run from repository root):

```sh
CRESCODE_AUDIT_CODEC=1 node --no-warnings --loader ./scripts/strings-orchestration-native-loader.mjs scripts/strings-orchestration-v1-audition.ts evaluation/strings-orchestration-v1/audition
python3 scripts/strings-orchestration-measure.py evaluation/strings-orchestration-v1/audition
CRESCODE_AUDIT_CODEC=1 node --no-warnings --loader ./scripts/strings-orchestration-native-loader.mjs scripts/strings-orchestration-v1-invariants.ts evaluation/strings-orchestration-v1/audition
```

The first command refuses an existing directory; choose a NEW path to reproduce. Final runs: approximately 68 s, under 1 s, and 31 s respectively; all exit 0, no timeout, serial execution, no Vitest workers. An initial 28-case prototype was expanded/refined into the final 30-case run; only final 30-case MIDI is packaged. A later parser rerun initially mistook the newly added verification-logs directory for a case (FileNotFoundError, exit 1); case discovery was corrected to require evidence.json, and the exact same parser command then passed all 295 files including per-contribution exported coverage. Both failure and successful rerun logs are retained.

Results:

- **60 classic golden cells / 270 string-track exported fingerprints**: exact existing note/CC/conductor/nonstring and export-hash equality. Golden export hashes are existing 80-bit truncated SHA256 fingerprints, not new expected values.
- **Nine complete archived V2 string MIDIs** (seeds 1–8,11): direct full byte-array equality on explicit V2 reconstruction, not just hash matching. This is additional evidence for the audit encoder's relevant event encoding.
- **30 actual new production cases**, each repeated exactly and compared with classic. Whole nonstring tracks/CC/state, Piano consumed input/Composer score/realized events/diagnostics, conductor plan, consumed classic-string information and roster matched. Input project immutability checked. No claim about adjacent behavior rests merely on files being unedited.
- V2 themes and complete phrase intentions match the earlier package exactly for all nine controlled archived seeds. Every accepted foreground grid pitch/onset is checked against its V2 source plus the one chosen contribution octave. The matrix includes sequence journeys (head operations with changing shifts), fragments, inversion and reconstruction.
- Separate assertions: fixed-seed takes, explicit/implicit mode routing, old V2/legacy handoffs, actual source Violin II, all-silent windows, clipped/pickup windows, locked lanes, out-of-band Cello, frozen-material energy response, lower-only ensemble, extreme-register foreground rejection and supporting-writer rejection.
- **295 serialized MIDI files / 18,831 note-ons**, including repeated excerpts/keyswitches: independent file size/SHA256, header/track count/name, every mapped note's start/end/pitch/velocity/channel hash, valid pitches/durations and paired note-offs. Musical statistics exclude keyswitches. Accepted participating desks' exported notes also match their final source notes exactly.

## 5. Actual MIDI evidence and musical limits

See the package `MIDI_MEASUREMENTS.md`, `midi-measurements.json`, `OPENING_ANALYSIS.md`, `matrix.json` and per-case evidence. Measurements are duration-weighted, not note-count medians; occupancy uses interval union. Quarter beats mean ticks/960, not always felt meter beats.

Eight identical Symphony / Dorian / 16-bar / stored-take-0 settings, seeds 1–8:

- Planned opening foregrounds: Viola, Viola, Violin II, Violin I, delayed theme over lower harmony, Violin II, Cello, Violin I. Actual first-two-bar desk activity is independently listed. Seed 4 is actually exposed Violin I; seed 5 begins Viola+Cello harmony rather than falsely claiming a silent opening.
- Cello duration-weighted P50: **55,50,52,48,52,60,48,52**. Bass P50: **36,41,36,36,36,35,40,36**. The original audited Cello P50 was 50 in six of eight cases; the same tonic/harmony still reasonably concentrates several Bass medians at 36. This is not a claim of unrestricted register diversity.
- Seed 6 Cello quarter-piece P50 is silence/60/62/60, above Viola for 56.7% of their 29.930 jointly sounding quarter beats. Its Bass trajectory is 38/31/35/34. Seed 7 Cello moves 53/52/47/46 while Bass moves 29/29/43/41. Seed 2 Cello is below Bass for 11.3% of 35.185 jointly sounding quarter beats. These are measured conditional register relationships, not perceptual dominance claims.
- Sparse remains genuinely sparse: seed 4 Cello has two notes and 1.3% occupancy. Violin I is intentionally silent in five of the eight controlled cases. Economy is intentional, but this strong selection bias is a limitation to assess in listening, not evidence of a universally balanced five-desk result. Across the broader matrix all five desks have more than one function; Bass has one planned augmented thematic answer, not a guarantee of frequent bass themes.
- Generated Dorian vs Aeolian runs actually call the existing suggestion engine and use its differing returned chord symbols (e.g. G vs Gm), not a mode-label swap. The engine may still suggest chromatic material; actual resolved chords govern writing. No mode-as-mood claim.

**26/30** production cases accept the new ensemble's foreground gates. **Four explicitly retain classic**: 6/8 (V2 has no two-felt-beat rhythm vocabulary), Whole Tone (not seven-note), no chords, and deliberately impossible configured string ranges. Supported examples include 3/4 and 12/8; do not claim all meters/modes are supported. Rejection safety is also exercised adversarially. No naturally accepted matrix contribution was rejected in the final selected 30 cases; withheld answers and intentionally empty desks remain explicit. That is limited evidence of rejection frequency, not a proof of perfect realization.

The opening/spacing rules are heuristics, not human orchestration judgement. Remaining concerns include frequent sustained chord-tone accompaniment, thin/exposed or dense-register passages, selection bias, root-concentrated Bass, low-register balance, phrase joins, sampled legato and the difference between written and perceived foreground. No complete global voice-leading optimization, audio rendering, Studio One import test, or sample-library audition was performed.

## 6. Package and human handoff

New package only: `evaluation/strings-orchestration-v1/package/Strings_V1_Ensemble_Orchestration_Identity_V1_Studio_One_Audition.zip`. Archive byte size, SHA256/MD5 and verified content count are recorded beside it after assembly. The old package and its Drive file are not updated. A new Drive upload is permitted only after verifying the established destination still allows adding children; no sharing changes.

Files include full ensemble, all strings, individual desks, first-eight-quarter-beat opening, 24–40-quarter-beat transition (when long enough), and Viola/Cello/Bass interaction MIDI. Import ONE alternative at a time to avoid doubling. Intentionally silent desk files can contain only conductor metadata because the unchanged exporter omits empty profile parts. The README supplies the listening route, actual fallback labels and UVI conventions.

**Human listening is outstanding.** In particular confirm lead identification without reading labels, delayed entrances and later payoffs, continuity at takeovers, Cello/Bass register and masking, purposeful sparse desks, articulations/keyswitches, Bass sounding octave, and balance in the full ensemble. No acceptance or approval is implied by generated files, metrics or passed native assertions.
