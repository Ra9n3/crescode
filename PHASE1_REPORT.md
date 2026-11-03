# Phase 1 Report — data model, export, energy

Branch `orchestrator-phase1-2` off `dc6ef43`. Baseline 542/542 (22 files), tsc clean, single-file build. Every commit kept the suite, `npm run typecheck` (now also covering `tests/`) and the build green.

## What changed

| Commit | Content |
|---|---|
| `c66fcde` | `docs/ORCHESTRATION_ENGINE_PLAN.md` (was never in the repo) added **marked SUPERSEDED** by `ORCHESTRATOR_SPEC.md`. |
| `d1c598c` | **1a** — `Note.articulation?` (11 values) + `Note.bow?`; `Track.cc?` lanes `{cc 0..127, points[{tick,value 0..127}]}` (sorted, tick ≤ project end, cap 1024/lane, one lane per controller); `Project.orchestration?` `{take, sectionTakes?, sectionLocks?}`. Validators for all of it (`validate.ts` — no new `config/` imports). `sanitizeNotes`/`humanizeNotes` carry the optional fields through octave-shift, clamp, trim and the same-pitch merge (**the earlier note's fields win** — a same-start duplicate is dropped, a partial overlap truncates the earlier note and both keep their own fields). JSON Schema (`project.schema.json`) updated additively. Old fixtures load unchanged; field-less notes keep their exact old shape. |
| `a909820` | **1b** — CC lanes export as controller events on the track's channel (merged + per-track files), sorted before note-ons at shared ticks; `parseMidiFile` returns `cc` per track. **Projects without cc export byte-identically** (tested against `cc: []` and empty lanes). Import: the app has no MIDI→project import; `parseMidiFile` is the import surface and now carries CC — mapping into `track.cc` for a future importer is one line per event. |
| `95c7c67` | **1c** — `src/orchestrator/energy/`: `measureEnergy(project, template)` (per felt-beat windows, meter-aware incl. compound; E = roles sounding / roster size × mean note velocity / 127, per D3; silent windows reported, not floor-violated), `maxMeanVelocity` / `governVelocity` / `energyOf` (floored: sonata caps at **82**, not 83 — rounding up would breach the hard clamp), `checkTemplateRules` (energy above max = hard, below floor = soft; octaveDoubling forbidden/climaxOnly incl. the D2 same-track reading; overlapAvoid; fillGating/maxLayers/unisonOrnament are explicit "not checkable yet" stubs). |
| `8bd5e19` | **1d** — `tsconfig.tests.json` + `npm run typecheck` (src **and** tests). Surfaced and fixed 15 pre-existing type errors in test files (unguarded `parseChord().chord`, a missing `Track` import, negative-test casts). |

**Final: 579/579 tests, 24 files, tsc × 2 clean, build 2.1 s single-file.**

## Mismatches (repo is source of truth)

1. **"Amendments v2" does not exist** — not in the spec, the repo, `upload/`, or `download/`. Phase 2's chord-tone function will cover the repo's *actual* chord vocabulary: the full `parseChord` grammar (45 quality/extension tables incl. sus, no3/no5, add/alt extensions, 6/9, slash bass) — which is the widest vocabulary that exists anywhere in the project.
2. **"orchestrationSeed per D8" — there is no D8**; the spec's decisions end at D7. `orchestrationSeed` will be implemented from spec §2.1/§8 instead: `hashString` over the orchestration take (and per-section takes), so a re-roll changes one section's seed only.
3. **validate.ts config inversion — left untouched, not trivial**: the validator genuinely needs the shipped template-id set; moving it into `shared/schema` duplicates the loader or inverts `config/ensembles` (which imports schema types) app-wide. New validators added zero new config dependencies.
4. Spec §4 "humanizeNotes is not exported yet" was already stale (exported in Phase 0) — no action.

## Calibration numbers (formula per spec §6/D3; reported, not bent)

| Point (symphony, N=17) | Target band | Actual | Verdict |
|---|---|---|---|
| Solo pizz pp (v=24) | 0.05–0.10 | **0.011** | MISS below — 0.05 needs v≈108 (ff); solo ceiling is 1/17 ≈ 0.059 even at v=127 |
| Section mf pad (4 strings, v=70) | 0.30–0.40 | **0.130** | MISS below — the band needs v≈162–215, impossible (max 127) |
| Tutti ff (17 roles, v=127) | 0.85–0.95 | **≤ 0.843** governed (1.0 ungoverned → hard violation) | Only the bottom edge is reachable, by design of the hard clamp |

Consistency checks that DO hold: the spec's own worked examples reproduce exactly (strings-only tutti in Symphony = 4/17 ≈ 0.235 "near 0.24"; Sonata governor caps "near 83" at 82). The three target bands look written for a small-roster reading (chamber N=5 gives 0.039 / 0.44 / 0.70) — i.e. occupancy counted over the string section, not the full roster. Per the brief the formula was **not** bent; if those bands are meant as acceptance criteria, the occupancy base needs a decision (roster per D3 vs string-section reading) before Phase 3.
