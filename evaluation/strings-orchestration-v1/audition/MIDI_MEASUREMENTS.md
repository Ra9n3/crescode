# Actual MIDI measurements

295 files validated by independent Python parsing; 18831 note-ons matched against the production profile chunks (including keyswitches for transport validation). Musical metrics below EXCLUDE keyswitches. All note-offs paired; 960 PPQ. Conventional C4=60; shipped profile calls MIDI 60 C3. Bass transpose remains the shipped zero; no additional -12 applied.

Duration-weighted P50 (not note-count median); dash means no exported musical notes. Percent crossing/within4 is conditional on joint sounding, using simultaneous mean pitch per desk. Proximity is not proof of perceptual masking.

| Controlled seed | Planned thematic opening | Actual first 8 quarter-beat desks | P50 I / II / Va / Vc / B | Occupancy % I / II / Va / Vc / B |
|---|---|---|---|---|
| 1 | violas | violins2, violas, cellosBasses | — / 62 / 65 / 55 / 36 | 0.0 / 38.8 / 71.4 / 83.4 / 44.9 |
| 2 | violas | violins2, violas, cellosBasses | — / 67 / 62 / 50 / 41 | 0.0 / 89.6 / 63.2 / 83.6 / 55.1 |
| 3 | violins2 | violins2, violas, cellosBasses | 81 / 69 / 60 / 52 / 36 | 38.2 / 83.8 / 45.0 / 39.5 / 45.8 |
| 4 | violins1 | violins1 | 74 / 65 / 57 / 48 / 36 | 38.8 / 43.5 / 47.2 / 1.3 / 45.8 |
| 5 | None | violas, cellosBasses | — / 69 / 60 / 52 / 36 | 0.0 / 60.1 / 77.9 / 35.4 / 45.3 |
| 6 | violins2 | violins2, violas, basses | — / 65 / 57 / 60 / 35 | 0.0 / 25.1 / 74.1 / 50.3 / 77.5 |
| 7 | cellosBasses | violas, cellosBasses, basses | — / 69 / 60 / 48 / 40 | 0.0 / 47.8 / 84.5 / 78.0 / 77.4 |
| 8 | violins1 | violins1, violins2, cellosBasses | 74 / 67 / 57 / 52 / 36 | 24.5 / 69.0 / 53.1 / 38.9 / 47.1 |

## Controlled register trajectories (quarter-piece P50)

| Seed | I | II | Viola | Cello | Bass |
|---|---|---|---|---|---|
| 1 | —/—/—/— | 62/60/—/— | 67/67/64/62 | 52/50/55/57 | —/—/35/36 |
| 2 | —/—/—/— | 69/67/65/69 | 62/62/53/62 | 50/50/48/48 | —/41/43/41 |
| 3 | —/—/81/77 | 69/67/67/69 | 60/60/—/69 | 50/52/—/— | —/—/36/36 |
| 4 | 74/76/—/— | —/—/65/65 | —/59/55/57 | —/—/—/48 | —/—/36/36 |
| 5 | —/—/—/— | 71/64/72/69 | 59/67/57/60 | 52/50/—/— | —/—/36/36 |
| 6 | —/—/—/— | 65/62/—/— | 57/64/59/53 | —/60/62/60 | 38/31/35/34 |
| 7 | —/—/—/— | —/—/67/69 | 57/60/62/64 | 53/52/47/46 | 29/29/43/41 |
| 8 | 74/81/—/— | 65/72/72/69 | —/60/59/57 | 52/52/—/48 | —/43/36/34 |

## Simultaneous lower spacing and hierarchy

| Seed | Cello/Bass joint q-beats; median gap | Viola BELOW Cello % | Violin I BELOW II % |
|---|---|---|---|
| 1 | 28.624; 19 | 0.0 | — |
| 2 | 35.185; 5 | 0.0 | — |
| 3 | no joint sound | 0.0 | 0.0 |
| 4 | no joint sound | — | — |
| 5 | no joint sound | 0.0 | — |
| 6 | 32.135; 27 | 56.7 | — |
| 7 | 47.519; 9 | 4.1 | — |
| 8 | 4.42; 9 | 0.0 | 0.0 |

## Cases and limitations

| Case | Ensemble accepted? | Actual opening desks | Sparse / silence / fallback |
|---|---|---|---|
| borrowed-chromatic | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| chamber-dorian-seed1 | True | violins1, violins2, cellosBasses | violas: intentional-sparse; basses: unavailable |
| cinematic-dorian-seed1 | True | violins2 | violas: intentional-sparse; cellosBasses: intentional-sparse |
| fallback-no-chords | False |  | violins1: classic-fallback; violins2: classic-fallback; violas: classic-fallback; cellosBasses: classic-fallback; basses: unavailable |
| fallback-restricted-ranges | False | violins1, violins2, violas | violins1: classic-fallback; violins2: classic-fallback; violas: classic-fallback; cellosBasses: classic-fallback; basses: unavailable |
| fallback-unsupported-mode | False | violins1, violins2, violas, cellosBasses, basses | violins1: classic-fallback; violins2: classic-fallback; violas: classic-fallback; cellosBasses: classic-fallback; basses: classic-fallback |
| generated-aeolian | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| generated-dorian | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| hybridstudio-dorian-seed1 | True | violas, cellosBasses, basses | violins1: intentional-silence; violins2: intentional-silence |
| locked-violin1 | True | violins1, violins2, violas, cellosBasses | violins1: unavailable |
| long-40bars | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| meter-12-8 | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| meter-3-4 | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| meter-6-8 | False | violins1, violins2, violas, cellosBasses, basses | violins1: classic-fallback; violins2: classic-fallback; violas: classic-fallback; cellosBasses: classic-fallback; basses: classic-fallback |
| out-of-band-cello | True | violins2, violas | violins1: intentional-silence; cellosBasses: unavailable; basses: unavailable |
| short-2bars | True | violins2, violas, cellosBasses | violins1: intentional-silence; cellosBasses: intentional-sparse; basses: intentional-silence |
| static-pedal | True | violins2, violas, cellosBasses | violas: intentional-sparse |
| symphony-dorian-seed1-take0 | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| symphony-dorian-seed1-take1 | True | violas, cellosBasses, basses | violins1: intentional-silence; violins2: intentional-silence |
| symphony-dorian-seed1-take2 | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| symphony-dorian-seed1-take3 | True | violins1, violins2, cellosBasses | violas: intentional-silence |
| symphony-dorian-seed11-take0 | True | violins1, violins2, basses | violas: intentional-sparse; cellosBasses: intentional-silence |
| symphony-dorian-seed2-take0 | True | violins2, violas, cellosBasses | violins1: intentional-silence |
| symphony-dorian-seed3-take0 | True | violins2, violas, cellosBasses |  |
| symphony-dorian-seed4-take0 | True | violins1 | cellosBasses: intentional-sparse |
| symphony-dorian-seed5-take0 | True | violas, cellosBasses | violins1: intentional-silence |
| symphony-dorian-seed6-take0 | True | violins2, violas, basses | violins1: intentional-silence |
| symphony-dorian-seed7-take0 | True | violas, cellosBasses, basses | violins1: intentional-silence |
| symphony-dorian-seed8-take0 | True | violins1, violins2, cellosBasses |  |
| unequal-repeated-17bars | True | violins2, violas, basses | violins1: intentional-silence; violins2: intentional-sparse |

See midi-measurements.json for duration-weighted P10/P50/P90/mean, full ranges, section trajectories, entrance times, exact opening pitches/rhythms, independent-onset fractions, all ten simultaneous desk pairs, and role-relative realization reviews. Planned opening foreground is a compositional intention; actual opening desks and durations are measured independently. No audio or listening approval is implied.
