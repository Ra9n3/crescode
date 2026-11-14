# Stage 2A - lead balance, end to end

All figures are mean written MIDI velocities. They describe the notes in the file, not how loud the instruments sound; that is for the audition.

## Definitions

- **Measured phrase**: a Supporting phrase in which a lead part is written in at least half of the bars the Piano plays.
- **Measured bars**: the bars of that phrase in which the lead is written (bars under a conductor moment included).
- **Lead**: every note of the lead part(s) sounding in a measured bar, counted once.
- **Piano**: every Piano note starting in a measured bar.
- **Target**: lead minus a margin of 2 to 6 (larger the more attacks the Piano plays per lead attack). On target = Piano mean no more than 0.5 above it.
- **Trim**: smallest whole amount, at most 12, that reaches the target. A bar that already carries a local reduction (8 or 3) takes the larger of the two, not the sum.
- **pre** = before the phrase trim; **final** = the exported track (equal to the serialized MIDI).

Sample: 216 generated arrangements (3 fixtures x chamber, sonata, cinematic, hybridstudio x seeds 1-3 x takes 1-6), 263 measured phrases.

## Summary

| template | group | phrases | pre: Piano - lead, mean (range) | final: mean (range) | above target |
|---|---|---|---|---|---|
| chamber | trimmed | 62 | +2.7 (-3.7 to +12.8) | -4.1 (-7.1 to +3.6) | 9 |
| chamber | no trim | 18 | -5.4 (-11.6 to -1.6) | -5.9 (-12 to -2.5) | 0 |
| sonata | trimmed | 17 | +7.0 (-1.9 to +23.9) | +0.1 (-6.4 to +19.9) | 6 |
| sonata | no trim | 7 | -7.1 (-9.9 to -4.3) | -7.9 (-10.6 to -5.4) | 0 |
| cinematic | trimmed | 8 | -0.2 (-2.6 to +3.3) | -3.7 (-5.6 to -0.7) | 2 |
| cinematic | no trim | 55 | -13.0 (-40.4 to -1.6) | -13.5 (-40.4 to -2.2) | 0 |
| hybridstudio | trimmed | 1 | +1.3 (+1.3 to +1.3) | -2.6 (-2.6 to -2.6) | 0 |
| hybridstudio | no trim | 95 | -17.2 (-32.2 to -2) | -17.6 (-34.4 to -2) | 0 |

## Exceptions: 17 phrases above their target, all at the trim limit of 12

| arrangement | bars | lead part | lead | Piano pre | Piano final | final Piano - lead | above target by |
|---|---|---|---|---|---|---|---|
| dorian-16bars_sonata_s2_t1 | 9-12 | cellosBasses | 52.8 | 76.7 | 72.7 | +19.9 | 22.9 |
| three-chorus-40bars_sonata_s3_t1 | 29-32 | violins1 | 42.8 | 63.7 | 59.3 | +16.5 | 18.5 |
| three-chorus-40bars_sonata_s2_t1 | 29-32 | violins1 | 45.9 | 64.1 | 59.2 | +13.3 | 17.3 |
| dorian-16bars_sonata_s3_t1 | 9-12 | cellosBasses | 52.8 | 70.7 | 64.8 | +12 | 16.0 |
| dorian-16bars_chamber_s3_t2 | 9-12 | violins1 | 64.9 | 74.6 | 68.5 | +3.6 | 6.6 |
| dorian-16bars_chamber_s2_t2 | 9-12 | violins1 | 64.4 | 75.4 | 67.8 | +3.4 | 6.4 |
| three-chorus-40bars_sonata_s3_t5 | 21-23 | violins1 | 55.5 | 66.2 | 54.2 | -1.3 | 4.7 |
| dorian-16bars_sonata_s1_t2 | 13-16 | violins1 | 66.4 | 79.1 | 67 | +0.6 | 3.6 |
| multi-chorus-16bars_chamber_s1_t2 | 13-14 | violins1 | 71.5 | 84.3 | 72.3 | +0.8 | 2.8 |
| multi-chorus-16bars_chamber_s3_t4 | 5-7 | violins1 | 66 | 75.2 | 63.2 | -2.8 | 2.2 |
| three-chorus-40bars_chamber_s3_t1 | 37-40 | violins1 | 40.3 | 49.8 | 39.5 | -0.8 | 2.2 |
| three-chorus-40bars_chamber_s2_t5 | 33-35 | violins1 | 76.3 | 86.1 | 74.1 | -2.1 | 1.8 |
| multi-chorus-16bars_chamber_s3_t2 | 13-14 | violins1 | 71.8 | 83.9 | 71.3 | -0.4 | 1.5 |
| three-chorus-40bars_cinematic_s2_t0 | 16-16 | violins1 | 47.3 | 50.5 | 46.5 | -0.7 | 1.2 |
| three-chorus-40bars_cinematic_s2_t3 | 16-16 | violins1 | 44.3 | 47.2 | 43.5 | -0.7 | 1.2 |
| three-chorus-40bars_chamber_s1_t2 | 25-27 | violins1 | 56.3 | 64.1 | 52.1 | -4.2 | 0.8 |
| multi-chorus-16bars_chamber_s2_t2 | 13-14 | violins1 | 71.8 | 80.7 | 68.4 | -3.3 | 0.6 |

In the arrangement names `tN` is the take index from 0 (take N+1 in the app).

## Every trimmed phrase

| arrangement | bars | lead part | lead | Piano pre | pre diff | margin | trim | Piano final | final diff | on target |
|---|---|---|---|---|---|---|---|---|---|---|
| dorian-16bars_chamber_s1_t0 | 13-16 | violins2 | 71.2 | 71.5 | +0.3 | 4 | 5 | 65.9 | -5.3 | yes |
| dorian-16bars_chamber_s2_t2 | 9-12 | violins1 | 64.4 | 75.4 | +11 | 3 | 12 | 67.8 | +3.4 | NO |
| dorian-16bars_chamber_s2_t3 | 13-16 | violins1 | 74.8 | 78.4 | +3.6 | 4 | 8 | 68.4 | -6.4 | yes |
| dorian-16bars_chamber_s3_t1 | 1-7 | violins1 | 52.9 | 52.3 | -0.6 | 5 | 5 | 47.2 | -5.7 | yes |
| dorian-16bars_chamber_s3_t2 | 9-12 | violins1 | 64.9 | 74.6 | +9.7 | 3 | 12 | 68.5 | +3.6 | NO |
| dorian-16bars_chamber_s3_t3 | 13-16 | violins1 | 74.8 | 77.4 | +2.7 | 4 | 7 | 69.2 | -5.5 | yes |
| dorian-16bars_sonata_s1_t2 | 13-16 | violins1 | 66.4 | 79.1 | +12.7 | 3 | 12 | 67 | +0.6 | NO |
| dorian-16bars_sonata_s2_t1 | 9-12 | cellosBasses | 52.8 | 76.7 | +23.9 | 3 | 12 | 72.7 | +19.9 | NO |
| dorian-16bars_sonata_s3_t1 | 9-12 | cellosBasses | 52.8 | 70.7 | +17.9 | 4 | 12 | 64.8 | +12 | NO |
| dorian-16bars_sonata_s3_t2 | 13-16 | violins1 | 61.8 | 69.9 | +8.1 | 3 | 12 | 58.2 | -3.6 | yes |
| multi-chorus-16bars_chamber_s1_t1 | 5-7 | violins2 | 66.3 | 66.9 | +0.7 | 5 | 6 | 60.4 | -5.9 | yes |
| multi-chorus-16bars_chamber_s1_t2 | 5-7 | violins1 | 65.7 | 70.2 | +4.5 | 4 | 9 | 61.2 | -4.5 | yes |
| multi-chorus-16bars_chamber_s1_t2 | 13-14 | violins1 | 71.5 | 84.3 | +12.8 | 2 | 12 | 72.3 | +0.8 | NO |
| multi-chorus-16bars_chamber_s1_t2 | 15-16 | violins1 | 55 | 55.7 | +0.7 | 2 | 3 | 52.7 | -2.3 | yes |
| multi-chorus-16bars_chamber_s1_t4 | 1-3 | violins1 | 47.6 | 46.4 | -1.2 | 5 | 4 | 42.5 | -5 | yes |
| multi-chorus-16bars_chamber_s2_t0 | 13-16 | violins1 | 62.9 | 63.1 | +0.2 | 4 | 4 | 58.9 | -4 | yes |
| multi-chorus-16bars_chamber_s2_t1 | 5-7 | violins2 | 66.3 | 69.5 | +3.3 | 5 | 8 | 61.5 | -4.7 | yes |
| multi-chorus-16bars_chamber_s2_t2 | 13-14 | violins1 | 71.8 | 80.7 | +9 | 4 | 12 | 68.4 | -3.3 | NO |
| multi-chorus-16bars_chamber_s2_t2 | 15-16 | violins1 | 55 | 55.1 | +0.1 | 2 | 2 | 52.8 | -2.2 | yes |
| multi-chorus-16bars_chamber_s2_t4 | 5-7 | violins1 | 66 | 68.3 | +2.3 | 3 | 5 | 63.3 | -2.7 | yes |
| multi-chorus-16bars_chamber_s2_t4 | 13-16 | violins1 | 67.5 | 71.9 | +4.4 | 2 | 6 | 65.4 | -2.1 | yes |
| multi-chorus-16bars_chamber_s3_t1 | 5-7 | violins2 | 66.3 | 62.5 | -3.7 | 5 | 1 | 60.7 | -5.6 | yes |
| multi-chorus-16bars_chamber_s3_t2 | 5-7 | violins1 | 65.7 | 67 | +1.4 | 3 | 4 | 61.9 | -3.8 | yes |
| multi-chorus-16bars_chamber_s3_t2 | 13-14 | violins1 | 71.8 | 83.9 | +12.1 | 2 | 12 | 71.3 | -0.4 | NO |
| multi-chorus-16bars_chamber_s3_t4 | 5-7 | violins1 | 66 | 75.2 | +9.2 | 5 | 12 | 63.2 | -2.8 | NO |
| multi-chorus-16bars_chamber_s3_t4 | 13-16 | violins1 | 67.5 | 72.8 | +5.3 | 4 | 9 | 62.8 | -4.7 | yes |
| three-chorus-40bars_chamber_s1_t0 | 5-11 | violins1 | 55.9 | 56.9 | +1 | 4 | 5 | 51.1 | -4.9 | yes |
| three-chorus-40bars_chamber_s1_t0 | 25-27 | violins2 | 58.2 | 61.3 | +3.1 | 2 | 5 | 56.3 | -1.9 | yes |
| three-chorus-40bars_chamber_s1_t1 | 1-3 | violins1 | 50.1 | 50.2 | +0.1 | 4 | 4 | 46.2 | -3.9 | yes |
| three-chorus-40bars_chamber_s1_t1 | 5-11 | violins2 | 54.7 | 55.8 | +1.1 | 5 | 6 | 48.9 | -5.8 | yes |
| three-chorus-40bars_chamber_s1_t1 | 13-15 | violins1 | 54.3 | 56.6 | +2.3 | 4 | 6 | 50.6 | -3.7 | yes |
| three-chorus-40bars_chamber_s1_t1 | 37-40 | violins1 | 40.3 | 44 | +3.7 | 3 | 8 | 37.4 | -2.9 | yes |
| three-chorus-40bars_chamber_s1_t2 | 5-11 | violins1 | 55.6 | 56.4 | +0.8 | 5 | 6 | 49.7 | -5.9 | yes |
| three-chorus-40bars_chamber_s1_t2 | 25-27 | violins1 | 56.3 | 64.1 | +7.8 | 5 | 12 | 52.1 | -4.2 | NO |
| three-chorus-40bars_chamber_s1_t3 | 9-11 | violins1 | 55 | 53.3 | -1.7 | 5 | 3 | 48.2 | -6.8 | yes |
| three-chorus-40bars_chamber_s1_t4 | 5-11 | violins1 | 55.3 | 53.8 | -1.4 | 4 | 3 | 49.5 | -5.7 | yes |
| three-chorus-40bars_chamber_s1_t4 | 13-15 | violins1 | 54.2 | 51.9 | -2.3 | 6 | 4 | 47.9 | -6.3 | yes |
| three-chorus-40bars_chamber_s1_t4 | 21-23 | violins1 | 67 | 66.9 | -0.1 | 6 | 6 | 60.9 | -6.1 | yes |
| three-chorus-40bars_chamber_s1_t5 | 1-3 | violins1 | 53.7 | 55.5 | +1.8 | 2 | 4 | 51.5 | -2.2 | yes |
| three-chorus-40bars_chamber_s1_t5 | 5-11 | violins1 | 55.5 | 58.3 | +2.8 | 2 | 5 | 52.1 | -3.4 | yes |
| three-chorus-40bars_chamber_s1_t5 | 17-23 | violins1 | 66.3 | 65.7 | -0.6 | 4 | 3 | 61.6 | -4.6 | yes |
| three-chorus-40bars_chamber_s1_t5 | 25-27 | violins1 | 59.6 | 61.3 | +1.6 | 2 | 4 | 56.3 | -3.3 | yes |
| three-chorus-40bars_chamber_s1_t5 | 33-35 | violins1 | 76.3 | 78.5 | +2.3 | 2 | 4 | 72.8 | -3.4 | yes |
| three-chorus-40bars_chamber_s2_t0 | 5-11 | violins1 | 55.9 | 57.6 | +1.6 | 6 | 8 | 49.6 | -6.4 | yes |
| three-chorus-40bars_chamber_s2_t0 | 25-27 | violins2 | 58.2 | 60.2 | +2.1 | 4 | 6 | 54.2 | -3.9 | yes |
| three-chorus-40bars_chamber_s2_t1 | 5-11 | violins2 | 54.7 | 57.4 | +2.7 | 3 | 6 | 49.9 | -4.8 | yes |
| three-chorus-40bars_chamber_s2_t1 | 13-15 | violins1 | 54.3 | 57.5 | +3.2 | 2 | 5 | 52.5 | -1.8 | yes |
| three-chorus-40bars_chamber_s2_t1 | 25-27 | violins1 | 59.1 | 62.2 | +3.1 | 3 | 6 | 56.2 | -2.9 | yes |
| three-chorus-40bars_chamber_s2_t2 | 17-23 | violins1 | 66.4 | 66.9 | +0.5 | 6 | 7 | 59.3 | -7.1 | yes |
| three-chorus-40bars_chamber_s2_t2 | 25-27 | violins1 | 56.3 | 62.4 | +6.1 | 5 | 11 | 51.4 | -4.9 | yes |
| three-chorus-40bars_chamber_s2_t4 | 5-11 | violins1 | 55.3 | 57.6 | +2.4 | 5 | 7 | 50.4 | -4.9 | yes |
| three-chorus-40bars_chamber_s2_t4 | 21-23 | violins1 | 67 | 69.6 | +2.6 | 5 | 8 | 60.6 | -6.4 | yes |
| three-chorus-40bars_chamber_s2_t5 | 5-11 | violins1 | 55.5 | 58.4 | +2.9 | 4 | 7 | 50.9 | -4.5 | yes |
| three-chorus-40bars_chamber_s2_t5 | 13-15 | violins1 | 56.1 | 56.1 | +0 | 6 | 6 | 50.1 | -6 | yes |
| three-chorus-40bars_chamber_s2_t5 | 25-27 | violins1 | 59.6 | 60.1 | +0.5 | 5 | 6 | 53.7 | -5.9 | yes |
| three-chorus-40bars_chamber_s2_t5 | 33-35 | violins1 | 76.3 | 86.1 | +9.9 | 4 | 12 | 74.1 | -2.1 | NO |
| three-chorus-40bars_chamber_s3_t0 | 5-11 | violins1 | 55.9 | 58.7 | +2.8 | 2 | 5 | 52.6 | -3.3 | yes |
| three-chorus-40bars_chamber_s3_t0 | 25-27 | violins2 | 58.2 | 57.5 | -0.6 | 4 | 3 | 53.5 | -4.7 | yes |
| three-chorus-40bars_chamber_s3_t1 | 13-15 | violins1 | 54.3 | 57.9 | +3.6 | 5 | 9 | 48.2 | -6.1 | yes |
| three-chorus-40bars_chamber_s3_t1 | 25-27 | violins1 | 59.1 | 56.2 | -2.9 | 5 | 2 | 53.6 | -5.6 | yes |
| three-chorus-40bars_chamber_s3_t1 | 37-40 | violins1 | 40.3 | 49.8 | +9.4 | 3 | 12 | 39.5 | -0.8 | NO |
| three-chorus-40bars_chamber_s3_t2 | 17-23 | violins1 | 66.4 | 66.2 | -0.2 | 6 | 6 | 60 | -6.5 | yes |
| three-chorus-40bars_chamber_s3_t2 | 25-27 | violins1 | 56.3 | 60.2 | +3.9 | 6 | 10 | 49.5 | -6.8 | yes |
| three-chorus-40bars_chamber_s3_t4 | 5-11 | violins1 | 55.3 | 57.5 | +2.2 | 5 | 7 | 49.5 | -5.8 | yes |
| three-chorus-40bars_chamber_s3_t4 | 21-23 | violins1 | 67 | 69.2 | +2.2 | 5 | 7 | 62.2 | -4.8 | yes |
| three-chorus-40bars_chamber_s3_t5 | 13-15 | violins1 | 56.1 | 56.3 | +0.1 | 5 | 5 | 51.3 | -4.9 | yes |
| three-chorus-40bars_sonata_s1_t1 | 5-11 | violins1 | 56.5 | 54.6 | -1.9 | 5 | 3 | 50.3 | -6.2 | yes |
| three-chorus-40bars_sonata_s1_t1 | 37-40 | violins1 | 41 | 42.2 | +1.2 | 3 | 4 | 38.1 | -2.9 | yes |
| three-chorus-40bars_sonata_s1_t2 | 5-11 | violins1 | 56.1 | 58.9 | +2.8 | 4 | 7 | 50.6 | -5.5 | yes |
| three-chorus-40bars_sonata_s1_t3 | 5-11 | violins1 | 56.1 | 58.9 | +2.8 | 4 | 7 | 50.7 | -5.5 | yes |
| three-chorus-40bars_sonata_s2_t0 | 5-11 | violins1 | 56.3 | 54.3 | -1.9 | 6 | 4 | 49.9 | -6.4 | yes |
| three-chorus-40bars_sonata_s2_t1 | 29-32 | violins1 | 45.9 | 64.1 | +18.2 | 4 | 12 | 59.2 | +13.3 | NO |
| three-chorus-40bars_sonata_s2_t2 | 21-23 | violins1 | 60.3 | 60.4 | +0 | 6 | 6 | 54.2 | -6.1 | yes |
| three-chorus-40bars_sonata_s2_t3 | 5-11 | violins1 | 57.1 | 57 | -0.1 | 4 | 4 | 51.3 | -5.8 | yes |
| three-chorus-40bars_sonata_s3_t0 | 5-11 | violins1 | 56.9 | 59.2 | +2.3 | 4 | 6 | 51.3 | -5.6 | yes |
| three-chorus-40bars_sonata_s3_t1 | 29-32 | violins1 | 42.8 | 63.7 | +20.9 | 2 | 12 | 59.3 | +16.5 | NO |
| three-chorus-40bars_sonata_s3_t2 | 5-11 | violins1 | 57.5 | 59.5 | +2 | 4 | 6 | 51.8 | -5.7 | yes |
| three-chorus-40bars_sonata_s3_t3 | 5-11 | violins1 | 57.6 | 56.7 | -0.9 | 6 | 5 | 51.7 | -5.9 | yes |
| three-chorus-40bars_sonata_s3_t5 | 21-23 | violins1 | 55.5 | 66.2 | +10.7 | 6 | 12 | 54.2 | -1.3 | NO |
| three-chorus-40bars_cinematic_s1_t3 | 25-28 | violins1 | 60.9 | 60.2 | -0.6 | 5 | 4 | 55.7 | -5.1 | yes |
| three-chorus-40bars_cinematic_s1_t5 | 13-16 | violins1 | 57.6 | 55.8 | -1.8 | 3 | 1 | 54.8 | -2.8 | yes |
| three-chorus-40bars_cinematic_s2_t0 | 16-16 | violins1 | 47.3 | 50.5 | +3.3 | 2 | 12 | 46.5 | -0.7 | NO |
| three-chorus-40bars_cinematic_s2_t3 | 16-16 | violins1 | 44.3 | 47.2 | +3 | 2 | 12 | 43.5 | -0.7 | NO |
| three-chorus-40bars_cinematic_s2_t3 | 25-28 | violins1 | 60.9 | 58.2 | -2.6 | 6 | 3 | 55.3 | -5.6 | yes |
| three-chorus-40bars_cinematic_s2_t5 | 13-16 | violins1 | 57.6 | 57.6 | +0 | 3 | 3 | 52.4 | -5.2 | yes |
| three-chorus-40bars_cinematic_s3_t3 | 25-28 | violins1 | 60.9 | 59.1 | -1.8 | 5 | 3 | 55.7 | -5.2 | yes |
| three-chorus-40bars_cinematic_s3_t5 | 13-16 | violins1 | 57.6 | 56.6 | -1 | 4 | 3 | 53.6 | -4 | yes |
| three-chorus-40bars_hybridstudio_s3_t5 | 37-40 | violins1 | 40.7 | 42 | +1.3 | 2 | 4 | 38.1 | -2.6 | yes |
