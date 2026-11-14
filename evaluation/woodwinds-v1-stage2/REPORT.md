# Woodwinds V1 — Stage 2 first musical slice / listening-gate handoff

## Status

**Implemented, tested, exported through production, and ready for human audition. Not human-auditioned or approved.** The acceptance criterion of genuinely listenable music remains a human listening decision. This handoff deliberately stops at the mandatory early audition gate; no vocabulary expansion should be inferred from passing tests.

Main deliverable: `woodwinds-v1-stage2-early-audition.zip` in this directory. Unpacked package: `early-audition/`. Start with its `README.md` rather than browsing all per-track files.

## 1. Mandatory preflight and preservation

Starting branch: `arena/7c78989c-crescode`.

Starting/current HEAD: `96c7756c6484f85d3937d20a070818fa568d4d80`.

The working tree was **not clean**: Stage 1 comprised eight modified tracked files and nine new/untracked files (17 expanded paths). Branch, HEAD, full status, tracked diffs, Stage 1 report, handoff, planner/writer, identity, trace, export observation and baseline scripts were inspected before implementation. The state matched the report; no unexpected changes required stopping.

`provenance/stage1-start.json` records all 17 paths, sizes and SHA-256 hashes. `stage1-start.patch` records the tracked diff, and `stage1-start-sources.zip` preserves exact starting contents, including untracked Stage 1 sources and report/evidence. Stage 1 was extended in place, not discarded, reset, stashed or replaced with another implementation.

No branch switch, dependency install/update, commit, push, UI enablement, production-default change or service change was performed. The existing service was left alone.

### Existing Stage 1 files preserved byte-for-byte (12)

- `src/export/midi.ts`, `src/export/profile.ts`, `src/export/wind-audit.ts`
- `src/orchestrator/compose.ts`
- `src/orchestrator/expression/cc.ts`, `src/orchestrator/lines/motif.ts`
- `src/orchestrator/winds/trace.ts`
- `src/store/store.ts`
- `scripts/winds-stage1-baseline.mjs`, `scripts/winds-stage1-baseline-loader.mjs`
- `evaluation/woodwinds-v1-stage1/REPORT.md`
- `evaluation/woodwinds-v1-stage1/audited-head-comparison.json`

### Existing Stage 1 files extended (5)

| File | Stage 2 delta |
| --- | --- |
| `src/orchestrator/winds/production.ts` | Calls the ensemble arranger only after the existing finalized-context adapter; retains ownership, fingerprint, trace, CC, and export reconciliation contracts |
| `src/orchestrator/winds/plan.ts` | Adds optional ensemble score and a `phrase` job kind; historical planning unchanged |
| `src/orchestrator/winds/render.ts` | Writes allocated phrase notes through existing validation/governance; prevents flute cut-over from replacing an allocated dialogue; applies planned breath windows to source gestures as well |
| `src/orchestrator/winds/identity.ts` | Advances explicit wind version to `winds-v1-stage2`; identity inputs and keyed-stream mechanism preserved |
| `tests/winds-production-truth.test.ts` | Adds the existing long fixture to the real generated-not-retained survey: the eight short runs no longer lose whole dialogue jobs against brass; the original lifecycle assertion is retained |

### New Stage 2 source (3)

- `src/orchestrator/winds/ensemble.ts`: bounded ensemble score and phrase allocation.
- `tests/winds-musical-slice.test.ts`: 11 production-path musical/technical tests.
- `scripts/winds-stage2-audition.mjs`: actual Compose All package generation, export observation, parsing, reconciliation and evidence.

All other additions are under `evaluation/woodwinds-v1-stage2/`. `provenance/stage2-changes.json` identifies exact before/after source hashes; `stage2-source.patch` separates these changes from the preserved uncommitted Stage 1 patch.

## 2. Ensemble-planning approach

The existing early reservations remain inputs to accepted non-wind composition. Stage 2 runs only inside the Stage 1 one-way boundary, after final Piano/Strings acceptance. It reads actual final carrier notes, actual counter sources, all non-owned instrument context, normalized harmony, sections, energy and the existing wind roster. It never replans/recomposes Piano or Strings.

One score allocates each bar's wind foreground, related answer/continuation, optional support and resting players **before** note realization. A compact shared contour has returning statement, inverted answer, extended ending, support and arrival interpretations. Answers normally pass to a different eligible player; a continuation can retain or change the player. Casting is keyed to section/bar rather than one fixed sequence of instrument entrances. Energy-off/opening/near-silence bars rest. Missing harmony preserves planned-empty jobs rather than mislabeling unavailable material as intentional musical silence.

Ordinary dialogue uses at most two designed wind voices: one foreground and occasional support. Selected final-source doubles/counters are limited to a source connection per section/kind instead of becoming constant doubling. Conductor-reserved moments/leads remain separate and may involve more players; they are not counted as proof of new dialogue. Pickup replacement cannot overwrite a planned exchange. Final brass attack gaps are allocated before pitch writing; the writer's existing safety checks still run.

This is an intentionally small model. Foreground/answer labels describe intent, not proof that a listener perceives an effective relationship.

## 3. Initial instrumental identities

| Player | Implemented first-slice behavior | Where to inspect/listen |
| --- | --- | --- |
| Flute | Shorter agile subdivisions, small arch/falling contours, late replies around busy foreground, selective register peak at high energy, occasional statements and continuation | Hybrid Studio bars 3 and 6–12; lyrical Symphony answer at bar 15 |
| Oboe | Longer-weighted three-event statements, deliberate arrivals, transformed answers and selective return rather than a second flute line | Symphony Dorian bars 3/5/7 and final arrival; Aeolian bars 2/6 |
| Clarinet | Connected four-event gestures with alternative pacing, transformed melodic answers, continuation and occasional articulated inflection/support | Symphony answers at bars 4/6; longer Hybrid Studio dialogue |
| Bassoon | Independent tenor-register short replies, offbeat articulated support, small moving intervals and occasional foreground; the crowded orchestral bass is not simply copied | Cinematic bar 10 answer; Aeolian bar 14 statement; Symphony support |

Registers are bounded by existing track/profile limits. Clarinet's existing lead-register exclusion and flute soft ceiling remain respected. No instrument/profile or broad articulation expansion was added. A part may be absent from a template or silent: Hybrid Studio has flute/clarinet, not oboe/bassoon; Cinematic excludes oboe. Symphony demonstrates all four together without artificial pins or planted notes.

## 4. Interaction, continuity, breath and harmony

- Shared idea IDs and explicit `relatedTo` links connect statements, transformed answers, continuations and support.
- Current chord tones, including borrowed chords, anchor attacks/endings; weak movement reads the existing mode. Dorian/Aeolian conversion uses the existing `transformProjectMode`; harmony policy was not rewritten.
- Rhythmic slots are allocated on the felt-eighth grid before pitch selection. Gate lengths distinguish articulation and phrasing; note velocities/CC are not counted as structural variation.
- Register center follows a bounded energy trajectory rather than an upward random walk. Designed successive pitches stay within a fifth-to-fifth-class bound of seven semitones in the tested contexts.
- Internal spaces permit a supporter to maintain motion while the foreground rests. Every allocated wind bar leaves a felt beat of air; slow/variable tempi can impose an earlier time cap.
- The same planned breathing windows apply to source-based reserved gestures. Inspection found that inherited moment exemptions could otherwise produce long unbroken wind runs even though new phrases breathed correctly. Their **wind** gates now follow the planned windows, with explicit adjusted/not-generated trace reasons; source Strings remain untouched. The full exported winds, not only newly designed notes, are tested for caps and monophony.
- The Stage 1 copied-string overlap guard remains in place. New phrases are non-overlapping by design, not generated polyphonically and salvaged by deleting most notes.

All 345 newly designed notes in the final six-rendition package survive with exact pitch/onset/duration. That figure is delivery evidence, not a note-count target or a musical-success metric. Existing reserved/source material is still subject to explicit physical/ownership validation and may be silent or rejected.

## 5. Seed/take alternatives

The Stage 1 identity still includes canonical musical inputs, displayed seed, produced take and wind version. Stage 2 explicitly changes the version to avoid pretending that the Stage 1 algorithm produces the same music.

Existing named streams are reused:

- `casting`: keyed foreground/answer player choices and continuation decisions;
- `phrase-design`: the shared compact contour;
- `instrument-variation`: keyed player/bar/duty rhythmic inflection;
- `expression`: existing isolated CC stream per instrument.

Alternative seed 7 versus seed 1 changes actual phrase assignments/rhythms/pitches. Produced take 2 versus 1 at seed 1 changes the interpretation and handoffs. Same complete identity reproduces the score/output exactly. Stream isolation tests from Stage 1 still pass, including extra flute-expression consumption. No requirement forces every possible seed/take to differ, and no random note noise was added to maximize differences.

## 6. Early gate chronology and technical corrections

The first package was generated and surfaced as soon as the compact score worked, before the final broader regression pass. Vocabulary was not expanded afterward. Technical inspection/testing then tightened rhythmic slot allocation so a short event cannot push a cadential ending outside its window, and applied breathing windows to inherited source gestures. The ZIP was refreshed to the tested version. Use the final ZIP/SHA256SUMS, not an earlier downloaded copy.

No human listening result has been received. The implementation remains paused at this gate; the next musical changes should follow listening feedback.

## 7. Verification

### Final source

| Check | Result |
| --- | --- |
| Stage 1 production truth tests | **24 passed** |
| Stage 2 musical-slice tests | **11 passed** |
| Final relevant integration run, 12 files | **283 passed, 2 skipped; exit 0** |
| `npm run typecheck` | **exit 0** |
| `npm run build` | **exit 0**, 258 modules |
| Audited-HEAD default/Classic comparison | **12/12 exact; exit 0** |
| Diff whitespace check | **passed** |

The 12-case comparison covers six existing templates × Classic/V1 Strings on the existing Dorian fixture: complete enumerable Compose All results, all tracks/CC, merged and per-track plain/UVI MIDI bytes versus audited HEAD. Evidence: `provenance/audited-head-comparison.json`. In addition, all six audition renditions compare exact full non-wind track/CC objects against the same composition without the V1 wind opt-in.

The final musical tests cover linked answers, optional continuation/arrival, bounded arrangement density, distinguishable rhythmic behavior, real bassoon independence, support during actual foreground spaces, exact designed-note retention, grid/range/monophony/register/breath, full source-gesture breath runs, chord-based endings, seed/take structural variation, non-wind equality, parsed sounding pitches/onsets/durations (separate from keyswitches), merged/per-track reconciliation, 3/4 and 6/8 at slow/changing tempi. These are invariants and evidence for audition, not replacements for listening.

Broader command:

```sh
npm test -- tests/winds-musical-slice.test.ts tests/winds-production-truth.test.ts tests/phase9.test.ts tests/phase12.test.ts tests/orchestrator-compose.test.ts tests/piano-engine-production.test.ts tests/strings-v1-mode.test.ts tests/export.test.ts tests/mode-transform.test.ts tests/band.test.ts tests/strings-orchestration-v1.test.ts tests/strings-identity-v2.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=30000
```

An initial final-source run completed all assertions (283 passed/2 skipped) but exited 1 with a Vitest worker `onTaskUpdate` RPC timeout while other validation jobs ran concurrently. It is **not** reported as a clean pass. The same complete command was rerun alone, without suppressing errors, changing dependencies/configuration or weakening assertions; it exited 0 with 283 passed/2 skipped and no unhandled errors. Both logs are saved: `provenance/integration-tests.txt` and `integration-tests-rerun.txt`. This is a relevant integration suite, not the entire repository test suite.

### Production MIDI checks

The generator uses actual Compose All V1 output and the installed `midi-file` serializer. Every exported MIDI is parsed. Actual merged note-ons reconcile with sounding notes plus keyswitches; per-job merged/per-track observations reconcile to retained fingerprints. Silent/out-of-band parts are not relabeled sounding or legacy. Keys/CC/profile mappings remain unchanged. Package `BUILD.json` pins source/fixture/profile hashes, verified against the final working tree.

## 8. Exact audition package

Location: `evaluation/woodwinds-v1-stage2/early-audition/`.

ZIP: `evaluation/woodwinds-v1-stage2/woodwinds-v1-stage2-early-audition.zip`.

**329 files, including 306 MIDI files.** Each of six rendition folders includes 7 merged/isolated/reference files per profile (42 per profile across all renditions), plus 114 plain and 108 UVI per-track files across the package. That is 156 plain + 150 UVI MIDI files. There are 18 per-rendition JSON files, and five root documentation/evidence files: README, catalog, BUILD, profile reference, SHA256SUMS.

| Rendition | Template / mode / bars | Seed / produced take | Retained Fl / Ob / Cl / Bn | Designed notes retained |
| --- | --- | --- | --- | --- |
| 01 lyrical Dorian | Symphony / Dorian / 16 | 1 / 1 | 12 / 25 / 8 / 18 | 34/34 |
| 01 alternative seed | Symphony / Dorian / 16 | 7 / 1 | 19 / 19 / 13 / 16 | 31/31 |
| 02 dialogue | Hybrid Studio / Dorian / 40 | 1 / 1 | 54 / 0 / 60 / 0 | 109/109 |
| 02 alternative take | Hybrid Studio / Dorian / 40 | 1 / 2 | 55 / 0 / 58 / 0 | 101/101 |
| 03 low support | Cinematic / Dorian / 16 | 3 / 1 | 24 / 0 / 8 / 9 | 30/30 |
| 04 modal contrast | Symphony / Aeolian / 16 | 1 / 1 | 22 / 22 / 16 / 25 | 40/40 |

Per profile/rendition: full orchestral merged MIDI, winds-only MIDI, four isolated wind MIDI files, non-wind reference MIDI, plus the existing per-track exporter files. Input and produced project JSON make the context inspectable; evidence JSON includes track/channel/patch mapping, identity, per-bar decisions/rests, phrase links, trace, ownership and exports.

**UVI caveat:** the existing merged architecture omits file-only Timpani/Snare/Cymbals and unmapped Aux. Supported percussion is supplied in per-track files; use separate instances/routing because percussion shares channels with some wind parts. The README gives Studio One/UVI import instructions and warns against doubled imports. UVI profile/mappings were not altered. Plain files contain no profile keyswitch handling. Isolated silent/out-of-band files are intentionally valid empty/conductor-only MIDI.

Reproduce with the existing dependencies:

```sh
node --no-warnings --experimental-loader ./scripts/strings-orchestration-native-loader.mjs scripts/winds-stage2-audition.mjs
```

The loader's alternate codec is **not enabled**. The generator does not install dependencies or generate synthetic test-only music. ZIP assembly and integrity checks are documented by `provenance/package-integrity.json`.

## 9. Known musical and technical limits

- Listenability, natural interaction, mix balance, sample realism and the four perceived personalities are **not verified by a human**.
- One small contour family and limited rhythmic inflections are intentionally exposed, not concealed by a large catalogue. Some legal modal answers reduce to repeated pitches; whether these feel purposeful needs listening.
- Frequent bar-level breath windows are physically conservative and may feel square. This is a key listening question, not a claim of finished long-phrase development.
- Designed register movement is bounded; preserved source-based gestures can retain larger source intervals. Their role continuity and audibility need audition.
- Support often falls to bassoon (or clarinet when bassoon is absent). No deep contrapuntal solver, voice hierarchy across all sample articulations or long-form thematic development was added.
- Existing energy governance and CC shaping remain. There is no sample-latency compensation or human performance rendering; legato/marcato fall back to UVI sustain as before.
- Runtime diagnostic hashes are compact, not cryptographic collision-proof identities. Baseline/package evidence uses SHA-256. The Stage 1 Set/Map intrinsic-mutation limitation remains; copied final-context ownership protects source tracks.
- The exported exactness checks cover this representative package/test set, not every possible project. No production UI/default enablement or deployment is claimed.

## 10. Stage 3 / next decision

First obtain human Studio One/UVI feedback by composition/seed/take/bar. Prioritize: perceived oboe-versus-flute phrasing; clarinet continuity; bassoon character and masking; naturalness of the breaths/answers; contrast between seed/take interpretations; whether reserved source gestures integrate with new dialogue.

Only then choose a small revision: longer cross-bar breathing arcs, more context-sensitive answer endings, less predictable support, or refined balance. Advanced thematic systems, a large vocabulary, new instruments/profiles, template-specific identities and general orchestration redesign remain outside this slice. Human-auditioned-and-approved status is explicitly **pending**.
