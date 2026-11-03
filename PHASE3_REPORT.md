# Phase 3 Report — conductor + energy arc

Branch line: `orchestrator-phase1-2` merged into `main`; Phase 3 commits land on `main` (the accepted branch line). Baseline for this phase: 672/672 (27 files, after the Phase 2.5 fixes). **Final: 688/688 tests, 28 files, `npm run typecheck` (src + tests) clean, single-file build green at every commit.**

## Shipped

| Commit | Content |
|---|---|
| `821fcdb` | **3a+3b** — `src/orchestrator/conductor/`: per-bar layer plan in the shared layer vocabulary (lead, pad, ostinato, tremolo, counterline, bass, fill, stab, percussion, color, sub, riser, texture — from `specs/ensemble-templates/ensemble-template.schema.json`), fillGating **breath windows** (≥ minGapTicks) on the rule's `duringRestsOf` parts at each section's last bar (the rules generator's own fill convention), matching fill windows registered; the renderer cuts pad notes around breaths (`subtractBreaths`); the checker reads **maxLayers** (hard) and **fillGating** (hard) from the annotation — the two Phase-1 stubs are replaced when a plan is handed in and stay honest stubs without one. The plan rides **in memory** on `ComposeResult.plan`; the store persists only tracks + take. |
| `577c50c` | **3c+3d** — `spine/energyArc.ts`: per-bar energy targets replacing the flat per-section level — a build INSIDE each section, a dip on the last bar before a section change, intro/outro tapering, and one deliberate **near-silence bar before the first Chorus** (the whole string section rests — planned as a breath, only when a template is active and unlocked in-band strings exist). Velocities come per span from the arc through the governor (`v = 1 + (cap−1)·E`, sampled at each sounded sub-window), so `measureEnergy` stays ≤ the clamp by construction. **3d**: the arc's shape parameters (build strength 0.10–0.30, dip depth 0.25–0.45, taper length 1–2 bars) are drawn from a stream salt-derived from the D8 seed of (inputs, take) — same take → byte-identical arc, a new take re-rolls the shape, never the constraints. |

## Design decisions (and where they deviate from the letter of the brief)

1. **The plan annotates what the orchestrator owns.** Today that is exactly one layer — the strings pad. The rules-generator families are listed as `unannotatedRoles` rather than guessed at; when their modules arrive they annotate honestly and maxLayers becomes a full-texture check. The 3b checker is annotation-driven, so violating/clean plans are testable regardless of who produced them.
2. **Near-silence is a whole-section rest** — "near-silence" is realized as the strings being silent for that bar (other families keep the rules generator's output; silencing them is out of scope this phase). "Only if the template and locks allow" is read as: a template is active AND at least one unlocked in-band string track exists to silence (locked lanes are never written either way). All six templates qualify on the fixture.
3. **Breath merging**: when the near-silence bar coincides with a fillGating breath that already covers every string voice (chamber, hybridstudio), the two merge into one window (flagged `nearSilence`). When the gate covers only part of the section (sonata's violins1), the near-silence rides as its own window — it always rests the WHOLE section.
4. **A new checker exemption was needed (documented in the code header)**: the near-silence exposed the rules generator's piano block chords voicing octave pairs *within one chord event* (F3+F4, D4+D5 — a register artifact of consecutive-candidate voicing, not a layer decision). Under `climaxOnly`, same-track same-onset pairs on chord tones are now exempt; under policy `forbidden` the exemption does NOT apply — D2's strict reading keeps in-track octave layering reportable. The D10 forced-doubling exemption (voices > distinct tones) is unchanged and applies to both policies.
5. **Honest strict-policy noise, not bent away**: under sonata/vocalbacking (`forbidden`), a rules-generator note can land an octave from the pad by pure coincidence (the piano cannot see the strings' voicing until its module exists). The audit reports those as hard findings; the conductor test scopes its "no hard findings" assertion accordingly and documents why.
6. **`forbidden` still forbids for the voicer** — the strings module never plans doubling layers under any non-`allowed` policy (climaxOnly counts as forbidding for pads, as in Phase 2), and the conductor plans no doubling layer slots at all in this phase.

## Test coverage added (16 tests)

- **3a**: vocabulary + pad annotation per bar (per template), fillGating breath windows per rule target (Strings family vs the violins1 role), fills registered, renderer honours breaths (no note starts in, or straddles, a breath window), plan never exceeds maxLayers, policy recorded and obeyed.
- **3b**: the real plan audits clean (no maxLayers/fillGating findings, no stubs for them, no hard findings except the documented strict-policy coincidences); violating plans are caught — 6 layers in a chamber bar, a fill with no rest around it, a breath shortened below minGapTicks; without the annotation the two rules stay stubs.
- **3c**: the arc builds inside sections (a curve, not a flat level), dips before section changes, tapers intro/outro, places the near-silence exactly on the bar before the first Chorus; every target ≤ clamp; `measureEnergy` max ≤ clamp for all six templates with the silence in place.
- **3d**: same take → byte-identical arc; take 2 re-rolls the shape; still clamped.

## Listening maps (golden fixture, take 1, seed 11)

`E/bar` = mean of the bar's beat-window energies (silence counts as 0). `E→x` = the arc target the pad voiced at. Composed with the arc, breaths, and the D11 take sampling.

**Symphony Orchestra** (clamp 0.25–0.85, maxLayers 7, doubling allowed) — measureEnergy max 0.590
- Verse (bars 1–8) — mean E/bar: `[0.143, 0.170, 0.173, 0.167, 0.176, 0.175, 0.168, 0.058]` — pad(4 voices), arc targets 0.34 → 0.55 across the build; **bar 8 = near-silence** (strings rest; woodwinds/brass keep the mean at 0.058).
- Chorus (bars 9–16) — mean E/bar: `[0.490, 0.494, 0.533, 0.523, 0.538, 0.533, 0.557, 0.499]` — pad(4v), targets 0.65 → 0.82, bar 16 tapers to 0.47.

**Chamber** (clamp 0.20–0.70, maxLayers 5, climaxOnly @0.55) — max 0.697
- Verse — `[0.426, 0.405, 0.458, 0.453, 0.456, 0.458, 0.474, 0.087]` — pad(4v) 0.44 → 0.54; **bar 8 = fillGating breath + near-silence merged** (piano gets the room; mean E 0.087).
- Chorus — `[0.621, 0.634, 0.649, 0.635, 0.648, 0.610, 0.625, 0.126]` — pad(4v) at the 0.70 ceiling; **bar 16 = fillGating breath** (final bar rests under the piano's last chord).

**Cinematic** (clamp 0.35–0.95, maxLayers 9, allowed) — max 0.629
- Verse — `[0.192, 0.207, 0.222, 0.208, 0.215, 0.208, 0.201, 0.086]` — pad(4v) 0.37 → 0.53; bar 8 near-silence.
- Chorus — `[0.518, 0.528, 0.570, 0.551, 0.553, 0.543, 0.568, 0.498]` — pad(4v) 0.67 → 0.81, taper to 0.46.

**Sonata** (clamp 0.15–0.65, maxLayers 3, forbidden) — max 0.648
- Verse — `[0.433, 0.431, 0.496, 0.480, 0.477, 0.471, 0.483, 0.144]` — pad(2 voices: v1 + cb) 0.37 → 0.53; bar 8: violins1 gate breath + whole-section near-silence (cellosBasses rests too — mean 0.144 is piano only).
- Chorus — `[0.626, 0.612, 0.613, 0.625, 0.604, 0.614, 0.614, 0.394]` — pad(2v) at the 0.65 ceiling; bar 16 = violins1 breath (cb sustains → 0.394).

**Vocal Backing** (clamp 0.15–0.65, maxLayers 4, forbidden) — max 0.649
- Verse — `[0.372, 0.350, 0.397, 0.391, 0.391, 0.391, 0.403, 0.087]` — pad(3 voices: v2, vla, cb — zone-free) 0.44 → 0.54; bar 8 near-silence.
- Chorus — `[0.629, 0.609, 0.624, 0.635, 0.621, 0.619, 0.618, 0.567]` — pad(3v) at 0.65; bar 16 tapers to 0.46 (no fillGating — the strings still sound, just quieter).

**Hybrid Studio** (clamp 0.30–0.90, maxLayers 8, allowed) — max 0.570
- Verse — `[0.211, 0.228, 0.245, 0.238, 0.237, 0.238, 0.230, 0.099]` — pad(4v) 0.38 → 0.52; **bar 8 = Percussion fillGating breath + near-silence merged**.
- Chorus — `[0.525, 0.521, 0.534, 0.526, 0.535, 0.523, 0.540, 0.313]` — pad(4v) 0.70 → 0.79; bar 16 = Percussion breath.

Reading the maps: the arc is audible as designed — every section builds, bar 8 is the deliberate hole before the Chorus in every template, the fillGating templates breathe on section-last bars, and the last bar winds down. The tight clamps hold: chamber peaks at 0.697 ≤ 0.70 and sonata at 0.648 ≤ 0.65 — the governor and the mix pass keep the hard ceilings exactly.

## Out of scope (respected)

Motifs, ostinati, articulation, CC, humanize, preview-synth changes, UI. The conductor plans no lead/ostinato/counterline slots yet — their renderer modules are later phases; the plan structure (vocabulary, breaths, fills, maxLayers contract) is the scaffold they plug into. The plan is never persisted; the audit modal that would surface it is Phase 7.
