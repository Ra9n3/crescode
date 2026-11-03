# Phase 4 Report — lines (lead, counterline, ostinato, tremolo, bass)

**Suite: 717/717 passed (32 files) · tsc clean · `npm run build` green (single-file `dist/index.html`) at every commit.** Commits: `f34959a` 4a · `934fdf6` 4c+4d · `4250177` 4b · `3613e8c` 4e+4f+4g · `a4578b9` 4h · report.

## 4a — per-track layer plan (5 lines)

- The conductor gives every string TRACK a role per bar (lead, counterline, pad, ostinato, tremolo, bass) from section type, arc energy and template preset (`conductor/layers.ts`), shared with the renderer so plan and notes can never disagree.
- One track = one role per bar; the plan's per-bar layer slots are what the checker's maxLayers audit reads.
- Presets: symphony V1 lead / V2+Vla pad / Cb bass; chamber+hybrid +V2 counterline; sonata V1 lead / Cb bass; cinematic V2+Vla ostinato, V1 tremolo when arc ≥ 0.65 else lead; Vocal Backing pad only.
- Intro-like sections never carry a lead; one near-silence/breath bar still rests the whole section.
- maxLayers: chamber 4 ≤ 5, symphony 3 ≤ 7, cinematic 3 ≤ 9, sonata 2 ≤ 3, vocalbacking 1 ≤ 4, hybrid 4 ≤ 8 — every bar.

## 4b — lead as constraint (5 lines)

- Motif and counterline notes are fixed pitches; the DP fits the remaining chord tones under them (fixed voice claims its register; everything below stays strictly under, everything above strictly over).
- Every pitch class the lines sound in a span is barred from the pad against doubled leading tones and, under a doubling-forbidding policy, against octave doubles.
- A span the fixed lines make infeasible drops its constraints and re-joins as the pure pad voicing for that span — never silence, never a rule violation; fallbacks are tracked by deletion and reported (0–4 spans per compose).
- Renderer writes line notes on honoured spans, DP notes on fallback spans, per (span ∩ bar ∩ section) piece, breath windows cutting every layer.
- Same take → byte-identical; the D8 voicing stream is round-salted so fallback re-runs stay deterministic.

## 4c+4d — motif and counterline (5 lines)

- Motif: 1–2 bar scale-degree cell, meter-relative rhythm (felt beats; half-beat anticipation in simple meters), D8-seeded per take; strong beats land on chord tones (bar-relative beats 1 and 3), weak beats any scale step.
- Development by occurrence: statement in Verse 1, answer/sequence next phrase, Chorus raised (octave if the comfortable window holds it, else +2 degrees, settled by scale-walk never octave-flip), final non-chorus section fragmented or augmented.
- Contour class (U/D/S of onsets) survives raising; tests: Verse 1 vs Chorus 1 agreement ≥ 0.7 with a higher mean register, on both fixtures.
- Counterline: stepwise under the lead, sounding in its rests and long holds, direction flipped against the lead's motion, consonant (3rd/6th/10th) with the lead on strong beats or with the chord when the lead rests, soft parallel penalty, never doubles the lead's leading tone.
- Both generators are pure functions with unit tests (determinism, ranges, chord tones, contrary ≥ 0.55, consonance, contour).

## 4e — preset behaviour (5 lines)

- Cinematic: V2+Vla ostinato on chord tones at the finest regular beat subdivision (simple ×4 / compound ×3, floored at 120 ticks), spiccato-length notes under 0.25 s through the tempo map, leading tone excluded from the tone list, viola strictly under V2 per step.
- Cinematic tremolo: V1 measured repeated notes (240-tick rate, articulation 'tremolo') only where the bar's arc target ≥ 0.65 — adds 56 repeated notes on the dorian fixture (bars 9–15; bar 16's taper drops below threshold → lead).
- Symphony: cellosBasses pizz-pulse — short notes (pizz, < 0.25 s) on strong beats 1 and 3 under pads and lines; chamber/sonata/hybrid keep the sustained bass.
- Vocal Backing: wide legato only — every string note is a ≥ eighth pad note, vocal zone still empty, no lead/ostinato/stabs.
- Chamber and sonata: lead + counterline + bass only; no double-stops anywhere.

## 4f+4g — Vc+Cb layering and articulations (5 lines)

- Cb doubles the Vc line an octave below inside cellosBasses only where octaveDoubling is 'allowed', the track's hard range holds both lines, and the Vc line never crosses the leading tone (a Cb octave there would double it).
- On the dorian fixture: hybridstudio layers (27 notes doubled); symphony and cinematic report-and-skip (their Vc line reaches D2; a Cb would need D1, below the E1 floor).
- Articulations: lead/counterline/pad/bass sustained = legato, ostinato = spiccato, tremolo = tremolo, pizz-pulse = pizz. No CC, no humanize.
- sanitizeNotes is a no-op on every string track across the matrix (notes stay sorted, non-overlapping, in range).
- Skips and fallbacks surface on `ComposeResult.reports` (in-memory, never persisted).

## 4h — the matrix (5 lines)

- 6 templates × keys (D, C, A) × modes (Dorian, Ionian, Aeolian) × takes 0–5: determinism byte-identical, validateProject passes, ranges + sanitize no-op, energy ≤ clamp with zero aboveMax, low-interval and leading-tone rules hold, Chords track empty, locked/out-of-band untouched (property sweep extended and green).
- Lead is the top sounding string line in 15/15 bars (symphony, chamber, sonata) and 14/15 (hybrid); counterline contrary 11/17 end-to-end (fallback spans excluded; the pure generator measures 0.55–1.00 across takes).
- New multi-chorus fixture (`fixtures/multi-chorus-16bars.json`, Verse–Chorus–Verse–Chorus): the LAST Chorus is the peak — exactly one section within 3% of the clamp planned, every other ≤ 0.88, measured energy never exceeds the clamp on all six templates.
- Motif on the multi-chorus fixture: Chorus 1 keeps the Verse 1 contour class (≥ 0.7) at a higher mean register.
- Golden dorian fixture tests unchanged and green (bass pc per span, slash basses, span coverage, listening map).

## Four one-line confirmations

1. **Flutes**: symphony 32 flute notes, cinematic 114 — both play on the dorian fixture (D9 doubling reads the strings' written lines).
2. **Beam vs exhaustive (2 voices, 3 chords: Dm7–G7–Cmaj7)**: beam best 16.0000 = exhaustive best 16.0000, pitch agreement 8/8.
3. **cellosBasses range vs Vc+Cb**: the range holds both only when the Vc line stays ≥ E2 — hybridstudio's does (layered, 27 notes doubled); symphony's and cinematic's reach D2 → reported and skipped per 4f.
4. **Sustained pad min-velocity over windows**: confirmed — the renderer caps every note at 1+(cap−1)·E ≤ cap, and the mix governor takes the MIN cap over every beat window a note spans (unit test `orchestrator-energy.test.ts:298`, still green; composed output re-checked in the sweep).

## Target vs written velocity — sonata and chamber chorus (bars 9–16)

```text
== Sonata (clamp 0.65):  target E 0.650 (all bars, clamp-pinned peak) → written strings meanVel 77.3 / 72.8 / 62.4 / 71.5 / 60.0 / 80.0 / 75.7 / 54.0 → measured E 0.630 / 0.622 / 0.624 / 0.625 / 0.615 / 0.614 / 0.619 / 0.563
== Chamber (clamp 0.70): target E 0.683–0.700 → written strings meanVel 76.0 / 78.0 / 77.0 / 78.0 / 77.3 / 78.0 / 78.0 / 50.0 → measured E 0.621 / 0.634 / 0.649 / 0.635 / 0.647 / 0.610 / 0.625 / 0.513
```

**Verdict: no fix needed.** Where targets rise, written velocities rise (the verse build survives). Inside these choruses the targets themselves are clamp-pinned — the peak reservation (Phase 3.5) puts the last Chorus at 100% of the clamp by design. The mix pass only pulls sonata's pads down where the piano+strings mix approaches the clamp (bars 11/13: meanVel 60–62 vs cap 80) — the strings yield headroom so the WINDOW honours the hard rule, and measured E stays ~0.62, right under the clamp. Calibration bands are illustrative; the only hard rule is that energy never exceeds the clamp.

## Listening map (dorian fixture, take 1; per section: mean E per bar + each string track's layer)

```text
Symphony Orchestra (clamp 0.25–0.85, maxLayers 7, policy allowed)
  measureEnergy: max 0.580 · strings notes 132
  Verse (bars 1–8): mean E/bar: [0.132, 0.157, 0.160, 0.153, 0.161, 0.160, 0.152, 0.058]
    cellosBasses: bass 1–7, REST (nearSilence) 8
    violas+violins2: pad 1–7, REST (nearSilence) 8
    violins1: lead 1–7, REST (nearSilence) 8
  Chorus (bars 9–16): mean E/bar: [0.476, 0.479, 0.517, 0.506, 0.522, 0.515, 0.538, 0.486]
    cellosBasses: bass 9–16 · violas+violins2: pad 9–16 · violins1: lead 9–16
Chamber (clamp 0.2–0.7, maxLayers 5, policy climaxOnly)
  measureEnergy: max 0.697 · strings notes 137
  Verse (bars 1–8): mean E/bar: [0.426, 0.405, 0.457, 0.453, 0.455, 0.458, 0.474, 0.087]
    cellosBasses: bass 1–7, REST (fillGating+nearSilence) 8
    violas: pad 1–7, REST (fillGating+nearSilence) 8
    violins2: counterline 1–7, REST (fillGating+nearSilence) 8
    violins1: lead 1–7, REST (fillGating+nearSilence) 8
  Chorus (bars 9–16): mean E/bar: [0.621, 0.634, 0.649, 0.635, 0.647, 0.610, 0.625, 0.513]
    cellosBasses: bass 9–16 · violas: pad 9–16 · violins2: counterline 9–16 · violins1: lead 9–16
Cinematic (clamp 0.35–0.95, maxLayers 9, policy allowed)
  measureEnergy: max 0.698 · strings notes 641
  Verse (bars 1–8): mean E/bar: [0.182, 0.211, 0.222, 0.211, 0.221, 0.215, 0.209, 0.086]
    cellosBasses: bass 1–7, REST (nearSilence) 8
    violas+violins2: ostinato 1–7, REST (nearSilence) 8
    violins1: lead 1–7, REST (nearSilence) 8
  Chorus (bars 9–16): mean E/bar: [0.569, 0.587, 0.633, 0.626, 0.631, 0.631, 0.663, 0.495]
    cellosBasses: bass 9–16 · violas+violins2: ostinato 9–16 · violins1: tremolo 9–15, lead 16
Sonata (clamp 0.15–0.65, maxLayers 3, policy forbidden)
  measureEnergy: max 0.648 · strings notes 69
  Verse (bars 1–8): mean E/bar: [0.433, 0.431, 0.496, 0.480, 0.477, 0.471, 0.483, 0.144]
    cellosBasses: bass 1–7, REST (nearSilence) 8 · violins1: lead 1–7, REST (fillGating) 8
  Chorus (bars 9–16): mean E/bar: [0.630, 0.622, 0.624, 0.625, 0.615, 0.614, 0.619, 0.563]
    cellosBasses: bass 9–16 · violins1: lead 9–16
Vocal Backing (clamp 0.15–0.65, maxLayers 4, policy forbidden)
  measureEnergy: max 0.649 · strings notes 81
  Verse (bars 1–8): mean E/bar: [0.372, 0.350, 0.397, 0.391, 0.391, 0.391, 0.403, 0.087]
    cellosBasses+violas+violins2: pad 1–7, REST (nearSilence) 8
  Chorus (bars 9–16): mean E/bar: [0.629, 0.609, 0.624, 0.635, 0.621, 0.619, 0.618, 0.567]
    cellosBasses+violas+violins2: pad 9–16
Hybrid Studio (clamp 0.3–0.9, maxLayers 8, policy allowed)
  measureEnergy: max 0.599 · strings notes 173
  Verse (bars 1–8): mean E/bar: [0.208, 0.230, 0.245, 0.239, 0.239, 0.241, 0.233, 0.099]
    cellosBasses: bass 1–7, REST (fillGating+nearSilence) 8 · violas: pad 1–7, REST (fillGating+nearSilence) 8
    violins2: counterline 1–7, REST (fillGating+nearSilence) 8 · violins1: lead 1–7, REST (fillGating+nearSilence) 8
  Chorus (bars 9–16): mean E/bar: [0.553, 0.550, 0.564, 0.559, 0.568, 0.558, 0.574, 0.519]
    cellosBasses: bass 9–16 · violas: pad 9–16 · violins2: counterline 9–16 · violins1: lead 9–16
```

## Deviations

- Cinematic V1 tremolo replaces the lead in bars with arc energy ≥ 0.65 (the brief's own threshold), so cinematic's Chorus motif is carried by the tremolo + ostinato texture; the contour-class test runs on the four templates whose lead plays in both sections.
- "Reaches within 3% of the clamp" stays a PLANNED-target assertion (Phase 3.5 wording); measured energy is asserted as never exceeding the clamp — the rules generator owns non-string velocities in the windows.
- The counterline's end-to-end contrary rate (11/17) counts fallback spans' DP notes excluded; the pure generator's rate is 0.55–1.00 across takes.
