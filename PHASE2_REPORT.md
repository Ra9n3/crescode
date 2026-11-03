# Phase 2 Report — strings pad slice

Branch `orchestrator-phase1-2` (continues Phase 1). Baseline for this phase: 579/579 (24 files). **Final: 656/656 tests, 26 files, `npm run typecheck` (src + tests) clean, single-file build green at every commit.**

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
