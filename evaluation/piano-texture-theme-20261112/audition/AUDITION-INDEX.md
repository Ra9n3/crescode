# Piano Texture-and-Theme Composer — Audition Index

No audio was rendered or listened to in preparing this package. Selections were made from
structural diagnostics only; "strong" and "ordinary" describe those diagnostics, not how the
music sounds. Every file is a standard MIDI file exported through the UVI Orchestral Suite
profile (Piano on channel 16, with its CC64 pedal lane).

- `*-piano.mid` — the Piano track alone.
- `*-full.mid` — the full Compose All arrangement, Piano included.
- Fixtures: **D16** = `dorian-16bars` (Verse 1–8, Chorus 9–16; bar 8 is near-silent).
  **TC40** = `three-chorus-40bars` (Verse 1–4, Chorus 5–12, Verse 13–16, Chorus 17–24,
  Bridge 25–28, Chorus 29–36, Outro 37–40).
- Density: low 0.3, medium 0.6, high 1.0. Take 0 throughout.

## Template examples

| ID | Template | Selection | Fixture | Seed | Density | Piano-only MIDI | Full-arrangement MIDI |
|---|---|---|---|---|---|---|---|
| CH-S | Chamber | Strong | TC40 | 0 | medium | `CH-S-piano.mid` | `CH-S-full.mid` |
| CH-O | Chamber | Ordinary | D16 | 11 | medium | `CH-O-piano.mid` | `CH-O-full.mid` |
| SO-S | Sonata | Strong | TC40 | 0 | high | `SO-S-piano.mid` | `SO-S-full.mid` |
| SO-O | Sonata | Ordinary | D16 | 11 | medium | `SO-O-piano.mid` | `SO-O-full.mid` |
| VB-S | Vocal Backing | Strong | TC40 | 0 | high | `VB-S-piano.mid` | `VB-S-full.mid` |
| VB-O | Vocal Backing | Ordinary | D16 | 11 | medium | `VB-O-piano.mid` | `VB-O-full.mid` |
| CI-S | Cinematic | Strong | TC40 | 11 | high | `CI-S-piano.mid` | `CI-S-full.mid` |
| CI-O | Cinematic | Ordinary | D16 | 0 | medium | `CI-O-piano.mid` | `CI-O-full.mid` |
| HY-S | Hybrid Studio | Strong | TC40 | 11 | medium | `HY-S-piano.mid` | `HY-S-full.mid` |
| HY-O | Hybrid Studio | Ordinary | D16 | 11 | medium | `HY-O-piano.mid` | `HY-O-full.mid` |

### Why these were selected (structural reasons only)

"Kept" = share of the Piano's own theme notes that survive adaptation to the orchestra.
"Removed" = share of the independent draft's events with no counterpart after adaptation.

| ID | Phrase roles | Theme operations | Theme kept | Removed | Texture levels used | LH pattern families |
|---|---|---|---|---|---|---|
| CH-S | 8 | 8 | 0.76 | 0.13 | 3 | 4 |
| CH-O | 3 | 3 | 0.65 | 0.22 | 3 | 4 |
| SO-S | 8 | 8 | 0.82 | 0.08 | 3 | 6 |
| SO-O | 2 | 2 | 0.65 | 0.27 | 3 | 3 |
| VB-S | 6 | 6 | 1.00 | 0.01 | 3 | 4 |
| VB-O | 2 | 2 | 1.00 | 0.03 | 3 | 3 |
| CI-S | 7 | 8 | 0.82 | 0.19 | 4 | 4 |
| CI-O | 3 | 3 | 0.78 | 0.27 | 3 | 3 |
| HY-S | 7 | 7 | 0.63 | 0.22 | 3 | 4 |
| HY-O | 3 | 3 | 0.70 | 0.20 | 3 | 3 |

- **Strong** picks are the candidates with the widest formal plan (most phrase roles and theme
  operations), the highest theme survival under the orchestra and the lowest removal within
  their template. All come from the 40-bar form, because the 16-bar fixture yields only two or
  three phrase roles and cannot show reprise, build or release. They were not chosen by note
  count: CH-S and HY-S are medium density.
- **Ordinary** picks are medium-density runs on the 16-bar fixture whose figures sit in the
  middle of their template's range. None was chosen as a failure case.
- Only seeds 0 and 11 at medium or high density have both a Piano-only and a full-arrangement
  export, so every selection comes from that pool of eight runs per template.

## Standalone Piano (Chamber, no other instruments)

| ID | Fixture | Seed | Density | Piano-only MIDI | Notes |
|---|---|---|---|---|---|
| ST-1 | D16 | 0 | medium | `ST-1-piano.mid` | 2 phrase roles, 5 left-hand pattern families, 3 texture levels |
| ST-2 | TC40 | 11 | high | `ST-2-piano.mid` | 6 phrase roles, 6 theme operations, all 4 texture levels |

With no orchestra there is no adaptation: these are the composer's independent draft as written.
There is no full-arrangement file because the Piano is the whole arrangement.

## Excessive-adaptation cases (flagged for closer inspection)

All three are Hybrid Studio, D16, high density — the only runs in the 108-run matrix that
raise `excessive-adaptation-removal` (more than 40% of the independent draft removed).

| ID | Seed | Density | Removed | Piano-only MIDI | Full-arrangement MIDI | Diagnostics |
|---|---|---|---|---|---|---|
| X1 | 0 | high | 92 of 191 (48%) | `X1-piano.mid` | `X1-full.mid` | `diagnostics/X1.json` |
| X2 | 11 | high | 109 of 211 (52%) | `X2-piano.mid` | `X2-full.mid` | `diagnostics/X2.json` |
| X3 | 29 | high | 121 of 222 (55%) | `X3-piano.mid` | `X3-full.mid` | `diagnostics/X3.json` |

What the diagnostics show in all three:

- Bars 9–12 (first half of the Chorus, planned as the climax at texture level 3) are written at
  level 1, because a conductor "unison" moment without the Piano covers exactly those bars.
- Bars 13–15 drop from level 3 to level 2 under the lead.
- A lead is annotated in 15 of 16 bars; the theme is moved an octave in 11 bars.
- The left hand is simplified in 3 bars and the right hand held instead of re-struck in 1 bar.

So the flag comes from the Piano's planned peak coinciding with a moment that excludes it.
Compare bars 9–12 against bars 13–15 in the Piano-only file, then in the full arrangement.
HY-O is the same template and fixture at medium density without the flag, for comparison.
In each `diagnostics/X*.json`, `independentDraft.notes` holds what the Piano wrote before
adaptation, `adaptation.records` the per-bar reasons, and `bars[]` the before/after activity.

## What to listen for

General questions for every example:

- Is there a recognisable theme in the first phrase, and can you hear it come back?
- When it returns, is it changed in a way that sounds intended (higher, ornamented, in the other
  hand, fragmented) rather than merely different?
- Do the hands sound coordinated but independently purposeful, or does one just shadow the other?
- Does the left hand give rhythmic movement and harmonic direction, or does it sound like a loop?
- Do texture, loudness and register change across sections, with a build, a peak and a release?
- In the full arrangement, is the Piano's material still present, or is it buried or thinned away?
- Is anything awkward, overcrowded, repetitive or mechanical?

Per template:

- **Chamber** — interplay. Listen for a moving inner line under the theme and for the left hand
  taking the theme while the right hand takes the broken figure. In CH-S: reprise at bars 17–23,
  inverted theme in the Bridge (25–27), build 29–32, peak 33–35, then the Outro. Left hand:
  bass-and-chord, rolling arpeggios, broken quarters.
- **Sonata** — statement, development, contrast. Listen for walking bass, Alberti and broken
  tenths under the theme and for the hand exchange in the long Chorus phrases. In SO-S the peak
  (bars 29–35) is planned at the top texture level but written one level lower under the lead,
  so no block chords appear; a build precedes it at 25–27 and a one-bar release follows at 36.
  The strings lead almost throughout this fixture, so judge in `SO-S-full.mid` whether the
  Piano's theme still reads as a theme or only as fragments between the lead's notes.
- **Vocal Backing** — restraint. The texture never reaches the top level and the theme is fully
  preserved under the orchestra; the left hand uses broken quarters, bass-and-chord and
  rolling arpeggios, with no ostinato. Judge whether it
  leaves room while still sounding composed rather than merely sparse.
- **Cinematic** — width and build. Low bass, broken tenths, block chords and
  octave doubling at the peak, the widest dynamic range (up to velocity 103). In CI-S the peak is
  bars 30–36 with the Outro releasing after it; the Bridge (25–28) is a quieter contrast with the
  theme inverted. Bars 5–8 and 17–19 are planned at the top level but written at level 1
  because of conductor moments, so compare them with bars 9–12 and 20–24. In CI-O, bars 9–12
  are held back in the same way.
- **Hybrid Studio** — pulse. A 3+3+2 left-hand ostinato or stride pattern with off-beat
  right-hand chord stabs. Judge whether the rhythm drives or becomes mechanical over 40 bars
  (HY-S), and whether the theme survives above it.

## Missing or regenerated artifacts

- **X3 MIDI was regenerated.** The matrix exports MIDI only for seeds 0 and 11, so seed 29 had
  diagnostics but no MIDI. `X3-piano.mid` and `X3-full.mid` were produced through the production
  `composeAllTracks` path with the same inputs and export calls as the matrix script:
  fixture `fixtures/dorian-16bars.json`, template `ensemble.hybridstudio`, take 0, seed 29,
  density 1, profile `uvi-orchestral-suite`, `buildPerTrackMidi` / `buildMergedMidi`.
  Command: `npx vite-node /tmp/audreg/x3.ts` (a temporary script kept outside the repository).
  The diagnostics from that run are byte-identical to the stored
  `after/diagnostics/hybridstudio__dorian-16bars__seed29__high.json`, so the MIDI corresponds to
  the flagged run.
- All other files are unmodified copies from `../after/midi/` and `../after/diagnostics/`.
- No audio renders exist. Low-density runs and seed 29 have no full-arrangement export and were
  therefore not candidates for the template selections.

## Source of each file

| ID | Source artifact id (in `../after/`) |
|---|---|
| CH-S | `chamber__three-chorus-40bars__seed0__medium` |
| CH-O | `chamber__dorian-16bars__seed11__medium` |
| SO-S | `sonata__three-chorus-40bars__seed0__high` |
| SO-O | `sonata__dorian-16bars__seed11__medium` |
| VB-S | `vocalbacking__three-chorus-40bars__seed0__high` |
| VB-O | `vocalbacking__dorian-16bars__seed11__medium` |
| CI-S | `cinematic__three-chorus-40bars__seed11__high` |
| CI-O | `cinematic__dorian-16bars__seed0__medium` |
| HY-S | `hybridstudio__three-chorus-40bars__seed11__medium` |
| HY-O | `hybridstudio__dorian-16bars__seed11__medium` |
| ST-1 | `standalone-chamber__dorian-16bars__seed0__medium` |
| ST-2 | `standalone-chamber__three-chorus-40bars__seed11__high` |
| X1 | `hybridstudio__dorian-16bars__seed0__high` |
| X2 | `hybridstudio__dorian-16bars__seed11__high` |
| X3 | `hybridstudio__dorian-16bars__seed29__high` (MIDI regenerated, see above) |
