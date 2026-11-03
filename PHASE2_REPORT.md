# Phase 2 Report — strings pad slice

Branch `orchestrator-phase1-2` (continues Phase 1). Baseline for this phase: 579/579 (24 files). **Final: 656/656 tests, 26 files, `npm run typecheck` (src + tests) clean, single-file build green at every commit.**

## Phase 2.5 (fixes) — the review round

The spec's D8–D11 decision text landed in §3 (commit `0660220`); these fixes implement them.

| # | Fix | Commit | Notes |
|---|---|---|---|
| 1 | **D8 seed**: `orchestrationSeed` = `hashString(musical inputs)` combined with take/sectionTakes. Inputs = chords (normalized spans), structure, key, mode, tempo (bpm + map), template id, band (templateId + overrides + pins). **Semantic serialization**: no uids, no notes — two musically identical projects hash identically; editing only notes never moves the seed. `e44a1ca` | 6 tests (same-inputs-same-seed, one-chord change, every input dimension, take/sectionTake combine, byte-identity). D8 lists no meter — time-signature changes therefore do NOT reseed (verbatim spec reading, flagged here). |
| 2 | **D9 compose order**: the strings module renders first and its notes become `roleNotes` sources for the rules generator, so "Flutes double Vln I" doubles the strings module's top line again. Strings stay excluded from the generator's own writing. `b1d5ab3` | Flutes non-empty in symphony + cinematic on the fixture; every flute entrance sits on a Violins I entrance (sanitize never moves startTicks). This retires PHASE2 deviation #8. |
| 3 | **D10 checker exemption**: chord-internal octave doubling FORCED by sounding voices > the chord's distinct tones (doubled pc a chord tone) is exempt from octaveDoubling findings; deliberate layer doubles still reported. `b6f5353` | Chamber audit on the composed fixture: **zero octaveDoubling** (was honest audit noise). Sibling tests: 5 voices on Dm7 → exempt; drop to 4 voices (== tones) → reported; doubling F# against Dm7 with 5 voices → still reported (foreign pc never forced). |
| 4 | **D11 take variety**: the backtrack SAMPLES (seeded by the take's stream) among the top-K near-optimal choices — best ending within `VOICING_COST_MARGIN = 5.0` capped at `VOICING_TOP_K = 8`, then backward through the 8 best parents per entry. Hard constraints never traded (every sampled state passed feasibility). `c1649ec` | Measured on the fixture (chamber, takes 0→5): **66.7 / 55.6 / 72.2 / 50.0 / 61.1 %** of spans differ in pitches between neighbouring takes (guard ≥ 40%). Same take byte-identical; ranges/low-interval/sanitize hold on every take. |
| 5 | Report items — see below. | | |

### Report: beam vs exhaustive (small case)

4-chord progression (Dm7 G7 Cmaj7 G/B), 3 voices in one-octave ranges, best-of-8 seeds per configuration (both sample paths, so best-of-N approximates each optimum; jitter-free `scoreVoicing`):

**beam (width 320, per-pc caps) best 15.2 = exhaustive (width ∞, caps ∞) best 15.2 — pitch agreement 8/8.** On the small case the production beam loses nothing; the wide-register/quartet case is beam-only by cost (the exhaustive DP is quadratic in the static frontier).

### Report: `cellosBasses` range vs Vc+Cb layering

`INSTRUMENTS` gives the shared track **E1..C6 (28..84)**. The Vc layer needs **C2..C6 (36..84)** — contained exactly. The Cb layer per spec §7.1 sounds **C1..D3 (24..50)**: its bottom four semitones (C1..D#1, 24..27) fall **below the track floor E1 = 28**, so the track as configured cannot host the lowest quarter of the Cb range. Today the profile keeps the bass voice ≥ E1 (comfortable [28,60]) and nothing breaks; when the Vc+Cb layering phase arrives, either the `INSTRUMENTS` floor moves to C1 (user call — the app's single source of truth) or the Cb layer is capped at E1. Flagged as a mismatch, not silently papered over.

### Report: sustained-note min-velocity over its windows

Unit-tested: four pad notes sustaining across a loud mixed beat (piano 4×127 → per-pad window cap 50) and a strings-only beat (no cap) come out at **velocity 50 for their whole length** — a note takes the MIN cap over every beat window it touches, so a sustained note can never straddle a clamp breach. `measureEnergy` on the result stays ≤ the chamber clamp (0.70).

## Shipped

| Commit | Content |
|---|---|
| `833bf51` | **2a+2b+2c** — `src/orchestrator/spine/` (chordSpans re-export, section map with tick windows + occurrence counts, meter helpers, tempo-map `ticksToMs`/`msToTicks` (spec §2.8, map-ready), `orchestrationSeed`), `profiles/strings.ts` (hard ranges **read from `INSTRUMENTS`**, comfortable windows, `VOCAL_ZONE` A3..A5), family-agnostic `SectionModule` interface, `voicing/chordTones.ts` (keep-priority bass→third→seventh→fifth→extensions, slash bass to the lowest voice, sus/6/alt handling), `voicing/voiceLead.ts` (global DP voice leader). 13 tests. |
| `577f840` | **2d+2e** — `render.ts` strings pad module (sustained per-span notes, per-section-type energy table → governor, Vocal Backing preset: zone-free + eighth minimum + open spacing), `compose.ts` (`composeAllTracks`: strings via module, everything else via the rules generator with `excludeRoles`, locked/out-of-band untouched), store `composeAll` now orchestrates and increments `orchestration.take` inside the **same** edit. |
| `0608c87` | **2f** — the property sweep (6 templates × 3 keys × 3 modes: determinism, ranges, `sanitizeNotes` no-op, `validateProject`, energy ≤ clamp, no doubled leading tone, low-interval limit, Chords lane untouched), take/lock/out-of-band identity tests, golden dorian fixture per template, Vocal Backing zone/triad tests, store-level one-undo test. |

## Voice-leading (2c) — what the DP enforces

Hard: INSTRUMENTS ranges · no crossing · lowest voice sings the slash bass (or root) · no doubled leading tone where the mode has one (derived: semitone below tonic **and** in the scale — D Dorian correctly has none) · no octave doubling when the template forbids it · low-interval limit below C3 (unisons/octaves and fifths only) · Vocal-zone exclusion. Soft: motion (common tones rewarded, so they tie across boundaries), parallel 5ths/8ves among independent voices (off in the three symmetric modes), upper-voice leaps, spacing (normal keeps upper voices within an octave; Vocal Backing prefers open gaps). Fewer voices than tones: the tone set is trimmed by keep-priority before voicing.

## Deviations and why (the honest list)

1. **Beam-pruned DP, not exhaustive** — the full state space (candidates^voices chained over 18 chords) is past a billion transitions; the beam (width 320, per-pitch-class candidate caps) keeps the search global rather than greedy and runs in ~40 ms. Spec §7.3's "global DP" intent is kept; the pruning is the engineering delta.
2. **Energy→velocity mapping** — chasing the literal target (`v = E·127·N/n`) pushes every pad to velocity 127 in the big bands (strings are 4 of 17 roster roles per D3; the spec itself calls the resulting floor gap "expected… not fixed"). Pads map the section-type target linearly across the window the governor allows: `v = 1 + (cap−1)·E`.
3. **Mixed-window governor (new pass, `energy/mix.ts`)** — the pads-only cap cannot see the rules generator's tracks: real windows mix them, and the first sweep **breached the hard clamp** (sonata 0.740 > 0.65, chamber 0.705 > 0.70, vocal backing 0.701 > 0.65 — e.g. bar 9: 2 strings @80 + 4 piano notes @86 → mean 84 → E 0.66). The pass re-checks every beat window after both generators run and lowers **only pad velocities, minimally**, to the exact window budget `padSum ≤ 127·max·N·total/roles − otherSum`. Windows already under the clamp are untouched.
4. **Per-pitch-class candidate caps** — the golden test caught a real bug: a global cap let one pitch class crowd the others out (3 A's beat 1 E on cost), leaving A7sus4 **no feasible quartet voicing** → silent span. Candidates are now capped per pitch class (≥ 2 octaves each), so every tone stays reachable.
5. **Take phrase mask** — pitch/cost jitter alone converged: 2 of 4 takes (later 2 of 6) produced byte-identical scores because hard constraints + common-tone rewards make the optimum robust. Each take now derives a phrase mask (`take·0x9E3779B1`, odd multiplier → bijection mod 2ⁿ) deciding which spans the pad **re-attacks** at the midpoint instead of sustaining. Nearby takes are *guaranteed* different scores, not probably different; same take stays byte-identical.
6. **Doubling relaxation** — when voices outnumber distinct tones (chamber quartet on a plain triad: 4 voices, 3 pcs), full forbidding would force silence; the voicer allows a minimal **bass-pitch-class** doubling (classic root doubling) instead. `climaxOnly` counts as forbidding (pads carry no climax bookkeeping yet); the Phase-1 checker will still report those doublings below the threshold — honest audit noise, easy to flip per D2.
7. **Hard range = the track's own range** (defaults come from `INSTRUMENTS`): `validateProject` and `sanitizeNotes` gate on track range, so the orchestrator must too or composed projects would fail validation if a user narrows a lane.
8. **Consequence of excluding strings from the rules generator**: the chorus "Flutes double Vln I" part now finds nothing to double and flutes stay empty in the fixture (symphony/cinematic maps below). Their own module arrives in a later phase.

## Listening map (golden fixture, take 1, seed 11 — notes per track)

| Template | Strings (per voice) | Rules-generator tracks |
|---|---|---|
| Symphony | v1 29 · v2 29 · vla 29 · cb 29 | horns 44, trumpets 16, trombones 18, tuba 9, oboes 19, clarinets 22, bassoons 9, timpani 23, snare 30, cymbals 8, harp 64 (flutes 0 — see #8; piano out of roster) |
| Chamber | v1 29 · v2 29 · vla 29 · cb 29 | piano 155 |
| Cinematic | v1 29 · v2 29 · vla 29 · cb 29 | horns 44, trumpets 16, trombones 18, tuba 9, clarinets 22, bassoons 9, timpani 23, cymbals 8, piano 155, harp 64 |
| Sonata | v1 29 · cb 29 | piano 155 |
| Vocal Backing | v2 29 · vla 29 · cb 29 (zone-free, ≥ eighth, open spacing; triads complete) | piano 155, harp 64 |
| Hybrid Studio | v1 29 · v2 29 · vla 29 · cb 29 | horns 44, trumpets 16, trombones 18, clarinets 22, snare 30, cymbals 8, piano 155, harp 64 |

(29 pad notes = 18 chord spans + 11 take-1 re-attacks. Measure-energy max stayed ≤ every template clamp across the whole 54-compose sweep.)

## Out of scope (respected)

Articulation assignment, CC generation, motifs, ostinati, humanize, preview-synth changes, UI. `docs/ORCHESTRATION_ENGINE_PLAN.md` stays marked superseded; the two work-order mismatches ("Amendments v2", "D8") are documented in PHASE1_REPORT.md and the code comments.

## Amendments v2 reconciliation (arrived mid-run as `480a2a5`, merged into the branch)

| Amendment | Status |
|---|---|
| §3 "Add D8–D11 from the review above" | **D8–D11 contents are not in the diff** — the amendment references a review that isn't in the repo. `orchestrationSeed` follows §2.1/§8 (take-seeded). Open item for the author. |
| §4 stale-fact replacements | All already true on this branch (chordSpans home + re-export; sanitizeNotes preserves fields; midi.ts CC; composeAll/band/resolveTemplate locations; tests typecheck). |
| §7.3 vocabulary | Covered — the full `parseChord` grammar was already generic; the amendment's named list (incl. `G#dim7`, `7b9`, `7b5`, `m(maj7)`) is now **pinned by tests** through parse → chordTones → voicing, slash basses included. |
| §7.3 leading tone derived | Already implemented exactly so; D Dorian has none. |
| §7.3 parallels off in symmetric/non-tertian harmony | **Fixed**: Locrian joined Whole Tone + both Diminished modes in the parallels-off set. |
| §7.6 detune is a profile constant, not on notes | Respected — no detune storage anywhere. |
| §9 CC export moved to Phase 1 | Was done in Phase 1 (`a909820`). |
| §10 test additions | All five properties are tested (field-preserving sanitizer, old files load, CC round-trip, same take byte-identical, different take different). |
