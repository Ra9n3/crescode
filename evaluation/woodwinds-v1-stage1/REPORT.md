# Woodwinds V1 — Stage 1 foundation report

## 1. Status and starting state

Stage 1 is implemented in the working tree on `arena/7c78989c-crescode`. The audited implementation starting point and current HEAD are `96c7756c6484f85d3937d20a070818fa568d4d80`; the mandatory preflight found a clean working tree matching that audited HEAD. No commit, push, branch switch, dependency installation, service change, or UI/default enablement was performed for Stage 1.

The starting pipeline planned winds before prepared lines and finalized Piano/Strings output were available. Existing compatibility output and reservations had to remain valid for other families. The foundation addresses that dependency, deterministic identity, ownership, and truthful contribution/export evidence. It does **not** claim a musical vocabulary or personality redesign.

## 2. Before/after architecture and enforced dependency

**Before:** early orchestration/planning and historical wind rendering could use intermediate material; later dedicated Piano/Strings realization could replace that material. A planned wind role was not proof that the writer produced or retained sounding notes.

**After, opt-in V1:**

```text
early conductor / historical compatibility planning and reservations
    → existing family composition
    → accepted final Piano and Strings material
    → one final-context wind handoff
    → wind realization, validation, ownership replacement, diagnostics
    → optional observed MIDI export and reconciliation
```

The early compatibility pass remains because its reservations are already inputs to accepted non-wind composition. It is explicitly distinguished from V1-owned final output. There is no recursive orchestration or non-wind recomposition in response to the new winds.

`completeWindsV1` requires prepared lines, arc, and early wind reservations; absent readiness throws rather than silently treating stale context as final. A no-template request follows an explicitly labeled `legacy-no-template` route, without claiming V1 final-context ownership.

The adapter copies final material before rendering, uses prepared carrier/assignment data as **role hints**, validates carriers against sounding final tracks, and uses accepted Strings foreground/answer contributions where available. It rebinds `lines.lead` and `lines.leads` to final notes and removes intermediate voiced-pitch/fallback sources. Counter-source diagnostics identify the actual final source. All non-owned instrument tracks, including preserved duplicate-role winds, participate in external collision/energy context. Fingerprints distinguish final non-wind and all-external material.

Exactly selected wind track IDs are replaced, not every track sharing a role. Empty owned output remains authoritative and old notes/CC are cleared; locks, pins, out-of-band and non-owned tracks remain protected. A V1-only single-voice guard trims copied legato tails or discards simultaneous extra source voices, recording adjustments/discards without editing the source Strings. Bassoon validation also checks the final external low-interval picture.

## 3. Access, identity, take, and streams

V1 is API-only: `composeAllTracks(project, { seed, windsComposition: 'v1', ... })`, with an optional matching store compose option. Omitted or `classic` retains the historical path. There is no UI control, persistence migration, or changed default. Store tests cover one final handoff and atomic tracks/take undo/redo.

The immutable identity contains:

- version: `winds-v1-stage1`;
- canonical musical inputs from the existing orchestration identity contract;
- displayed/user seed;
- **produced** take (not the preceding stored take);
- derived deterministic seed.

Fresh keyed streams separate `casting`, `phrase-design`, `instrument-variation`, and `expression`, including instrument/decision keys. Optional caller-owned RNG hooks leave historical motif and CC streams unchanged. Tests compare pitch/onset/duration structure separately from velocity and CC. Same complete identity reproduces structure and full output; tested seeds and produced takes change real structure. Extra flute expression draws do not advance another instrument's stream. This is deterministic isolation, not a guarantee that every possible seed or take must sound different.

## 4. Truthful lifecycle and export

Diagnostics distinguish eligibility, planned jobs, writer events, retained parts, and independently observed exports. `windDiagnostics` is non-enumerable, preserving existing serialized Compose All result shape. Compatibility paths report unknown generated counts rather than inventing writer evidence.

| Situation | Reported evidence/state |
| --- | --- |
| Missing/locked/out-of-band part | `ineligible`, with reason |
| Eligible one-bar opening with no jobs | `intentional-silence`; no fallback or stale CC |
| Job exists but harmony/material yields no notes | `planned-no-notes`, with writer reason |
| Candidate fails validation | rejected event / `candidate-rejected` when applicable |
| Candidate generated but none survives its job | `generated-not-retained` |
| Small retained contribution | `retained-sparse`, note count and union sounding duration |
| Other retained contribution | `retained`, not a musical-quality assertion |
| Historical/no-template output | `classic-compatibility` / `legacy-fallback` |
| Compose without observed builder call | export remains explicitly `not-observed` |
| Profile fold/drop/fallback/omission | actual builder observations, separate from retained notes |
| Only switches survive serialization | `keyswitch-only`, zero sounding notes |

Sparse means fewer than four retained notes **or** less than two felt beats of union coverage. It is deliberately not synonymous with failure or quality. Trace stages include not-generated, generated, rejected, discarded, adjusted, and retained. Job associations survive merges; association/event counts are not additive unique-note totals.

An optional `FoldStats.winds` sink observes actual merged/per-track chunks after successful serialization. It records retained fingerprints, sounding events, keyswitches, clipping, octave folds, drops, articulation fallback, omitted chunks, file-only scope and unmapped parts. Keyswitch identity is tracked separately; parsed MIDI checks prove keyswitch-only output is not counted as sounding. Existing UVI profile data was not expanded or changed.

`reconcileWindExport` joins observed evidence to the retained take by fingerprint and rejects stale evidence. Job scope states distinguish exported, not-retained, not-exported and unresolved profile transformation/loss. Matching accepts exact note timing/pitch or evidenced octave folding; unresolved transformations are not falsely attributed as proven loss. No export success is inferred merely from a nonempty plan or track.

## 5. Production-path evidence

`tests/winds-production-truth.test.ts` exercises actual Compose All, not just helper constructors:

- final boundary, complete identity, external fingerprints and reservations;
- ordinary flute **and** oboe doubling with writer-candidate evidence tied to sounding final sources (brass cut-over alone cannot satisfy the test);
- retained ordinary clarinet counter contributions and actual final source matches in Hybrid Studio;
- deterministic reproduction, separate structural seed/take variation, keyed isolation and production expression-consumption perturbation;
- exact non-wind/Piano/Strings preservation with Classic and V1 Strings;
- store once-only handoff, persisted notes/take and undo/redo;
- missing-readiness failure, empty ownership, stale CC, intentional silence, sparse/rejected/generated-not-retained jobs;
- locked/pinned and duplicate-role preservation;
- Symphony, Cinematic and Hybrid Studio bounds, monophony and energy checks;
- job/retained fingerprints and parsed plain/UVI merged and per-track exports;
- folds, drops, fallback, omitted chunks, unmapped parts, keyswitch-only output and stale export evidence.

Symphony does not provide the ordinary string-counterline texture used by the counter test. The test uses Hybrid Studio rather than fabricating notes or changing Symphony's vocabulary. Source-copy legato overlaps discovered during validation were corrected only in V1 wind output and traced, not by rewriting accepted Strings.

## 6. Exact preservation evidence and scope

`audited-head-comparison.json` records a successful comparison against git-object sources from audited HEAD `96c7756c6484f85d3937d20a070818fa568d4d80`, using the installed `midi-file` serializer. The scripts do not switch branches or check out another worktree.

**12/12 cases exact:** Symphony, Cinematic, Hybrid Studio, Chamber, Sonata and Vocal Backing × Classic/V1 Strings; Dorian 16-bar fixture, displayed seed 3, initial stored take 0, default winds. Comparisons cover complete enumerable Compose All results, every track and CC lane, plain/UVI merged MIDI bytes, and plain/UVI per-track filenames and MIDI bytes. SHA-256 evidence is saved in the JSON artifact.

Separately, production tests compare V1-opted-in results against unchanged-wind results for exact full non-wind track objects, including accepted Piano and Strings notes and CC. Thus the historical baseline check and the V1 non-wind-preservation check answer different questions. Neither is an exhaustive proof across all possible projects.

No harmony/mode/chord/borrowed-harmony policy, Piano writer, Strings writer, template identity, instrument inventory, range/profile vocabulary, or UVI profile data was changed. Existing mode-transform and band regressions passed; modes were not replaced or described as missing.

## 7. Verification results

| Verification | Result |
| --- | --- |
| Production truth suite, final strengthened source-evidence assertions | **24/24 passed** |
| Broader relevant integration run, 11 files | **272 passed, 2 skipped**, exit 0 |
| Audited-HEAD baseline comparison | **12/12 exact**, exit 0 |
| `npm run typecheck` | Passed, exit 0 |
| `npm run build` | Passed, exit 0 |
| `git diff --check` | Passed |

Broader command:

```sh
npm test -- tests/winds-production-truth.test.ts tests/phase9.test.ts tests/phase12.test.ts tests/orchestrator-compose.test.ts tests/piano-engine-production.test.ts tests/strings-v1-mode.test.ts tests/export.test.ts tests/mode-transform.test.ts tests/band.test.ts tests/strings-orchestration-v1.test.ts tests/strings-identity-v2.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=30000
```

An earlier run hit an existing Phase 9 five-second timeout under concurrent load, not an assertion mismatch. The broader rerun above passed using a CLI timeout of 30 seconds; no historical tests or goldens were changed. The broader run preceded the last stale-intermediate-source sanitization/reason edits; production tests, typecheck, build and baseline were repeated afterward. The final change strengthened source-evidence assertions only; the 24-test suite was repeated successfully after that change. This was a relevant broader run, **not the entire repository suite**.

Reproduce baseline evidence with `node scripts/winds-stage1-baseline.mjs` using the existing installed dependencies. No generated MIDI bundle is required.

## 8. Changed files

| Files | Purpose |
| --- | --- |
| `src/orchestrator/winds/identity.ts` (new) | Versioned identity and named keyed streams |
| `src/orchestrator/winds/production.ts` (new) | One-way final adapter, ownership, diagnostics and export reconciliation |
| `src/orchestrator/winds/trace.ts` (new) | Writer lifecycle events and job keys |
| `src/orchestrator/winds/plan.ts`, `render.ts` | Optional V1 streams/context/trace hooks and V1 validation |
| `src/orchestrator/compose.ts` | API opt-in, final handoff and non-enumerable diagnostics |
| `src/store/store.ts` | API-only store option; existing atomic operation retained |
| `src/orchestrator/lines/motif.ts`, `expression/cc.ts` | Optional caller-owned RNG, historical defaults preserved |
| `src/export/wind-audit.ts` (new) | Actual serialized wind evidence and keyswitch separation |
| `src/export/profile.ts`, `midi.ts` | Optional export observation, byte-preserving |
| `tests/winds-production-truth.test.ts` (new) | Production integration and parsed-export tests |
| `scripts/winds-stage1-baseline.mjs`, `winds-stage1-baseline-loader.mjs` (new) | Audited-HEAD comparison without checkout/reset |
| `evaluation/woodwinds-v1-stage1/audited-head-comparison.json`, `REPORT.md` (new) | Machine-readable evidence and this report |

## 9. Limitations and Stage 2 readiness

**Implemented:** one-way dependency, explicit identity/streams, exact ownership, compatibility labels and observable lifecycle/export contract.

**Tested through the production path:** the cases above, including actual serialized/parsed MIDI. This does not mean deployed, enabled in UI, exhaustively verified, or auditioned.

**Unverified:** human listening with the target sample library, musical improvement, instrument personality, expressive realism and broader musical coverage. Object freezing does not make JavaScript Set/Map intrinsic mutation methods immutable; the adapter's source-copy boundary is the principal protection against mutating accepted final tracks. Runtime diagnostic fingerprints are compact hashes, not cryptographic collision-proof identities; the separate baseline artifacts use SHA-256. Export association may remain explicitly unresolved after transformations that cannot be attributed safely.

**Stage 2:** the foundation is ready for a separately authorized musical-personality/vocabulary iteration and human audition. Existing vocabulary, gates, breath behavior and four instruments remain the scope here; no new grammar, motif catalogue, artificial note padding, advanced themes, instruments, broad articulation expansion or general orchestration redesign was introduced. Intentional silence remains valid. No human musical-quality approval is claimed.
