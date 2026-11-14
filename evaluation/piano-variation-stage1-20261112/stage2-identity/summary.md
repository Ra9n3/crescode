# Piano variation baseline — Stage 1

Matrix label `stage2-identity`. 600 generations, 1680 comparisons, 0 failures. Composer: Texture-and-Theme (current baseline).

Distances run from 0 (identical) to 1 (nothing in common). They are structural measurements, not judgements of how anything sounds.

## Reproducibility and transposition control

- Repeated generations with identical inputs: 75 of 75 identical (notes, CC64 and both fingerprints).
- Synthetic transposition control (same notes moved a fourth): 600 of 600 recognised as an exact transposition; largest overall distance 0.03; classes {"transposed":600}.

## Distance by kind of comparison (final adapted Piano)

Each cell: min / 10th percentile / median / 90th percentile / max.

| Comparison | Pairs | Theme | Rhythm | Accompaniment | Development | Overall |
|---|---|---|---|---|---|---|
| take (same inputs, Compose All pressed again (take changes)) | 360 | 0.41 / 0.51 / 0.59 / 0.68 / 0.76 | 0.16 / 0.25 / 0.36 / 0.46 / 0.55 | 0.21 / 0.34 / 0.55 / 0.71 / 0.81 | 0.05 / 0.12 / 0.22 / 0.36 / 0.45 | 0.26 / 0.35 / 0.43 / 0.50 / 0.56 |
| seed (same inputs, different seed option) | 360 | 0.23 / 0.44 / 0.56 / 0.66 / 0.76 | 0.07 / 0.21 / 0.36 / 0.46 / 0.55 | 0.07 / 0.27 / 0.51 / 0.68 / 0.81 | 0.04 / 0.08 / 0.16 / 0.25 / 0.34 | 0.17 / 0.29 / 0.40 / 0.47 / 0.55 |
| key (same inputs, whole song moved up a fourth) | 300 | 0.23 / 0.44 / 0.55 / 0.66 / 0.76 | 0.11 / 0.22 / 0.33 / 0.44 / 0.51 | 0.11 / 0.26 / 0.51 / 0.69 / 0.83 | 0.05 / 0.09 / 0.21 / 0.33 / 0.44 | 0.17 / 0.29 / 0.40 / 0.48 / 0.53 |
| density (same generation at another density) | 120 | 0.02 / 0.07 / 0.10 / 0.14 / 0.19 | 0.04 / 0.13 / 0.23 / 0.32 / 0.39 | 0.08 / 0.21 / 0.38 / 0.58 / 0.68 | 0.03 / 0.07 / 0.11 / 0.16 / 0.21 | 0.04 / 0.14 / 0.20 / 0.29 / 0.33 |
| arrangement (same generation, Piano-only versus full arrangement) | 300 | 0.01 / 0.02 / 0.14 / 0.21 / 0.31 | 0.02 / 0.07 / 0.18 / 0.27 / 0.36 | 0.02 / 0.06 / 0.28 / 0.52 / 0.74 | 0.06 / 0.17 / 0.29 / 0.39 / 0.44 | 0.03 / 0.08 / 0.22 / 0.33 / 0.42 |
| template (same song and seed, different template) | 240 | 0.39 / 0.45 / 0.55 / 0.66 / 0.71 | 0.12 / 0.28 / 0.38 / 0.48 / 0.57 | 0.24 / 0.40 / 0.59 / 0.75 / 0.81 | 0.07 / 0.16 / 0.27 / 0.40 / 0.49 | 0.29 / 0.37 / 0.45 / 0.53 / 0.59 |

## Same table for the independent draft (before orchestral adaptation)

| Comparison | Theme | Rhythm | Accompaniment | Development | Overall |
|---|---|---|---|---|---|
| take | 0.38 / 0.49 / 0.60 / 0.70 / 0.79 | 0.12 / 0.21 / 0.31 / 0.43 / 0.52 | 0.18 / 0.29 / 0.49 / 0.67 / 0.80 | 0.04 / 0.11 / 0.22 / 0.35 / 0.45 | 0.21 / 0.33 / 0.41 / 0.48 / 0.57 |
| seed | 0.23 / 0.43 / 0.55 / 0.70 / 0.78 | 0.02 / 0.15 / 0.31 / 0.42 / 0.52 | 0.04 / 0.23 / 0.46 / 0.63 / 0.79 | 0.02 / 0.06 / 0.15 / 0.24 / 0.36 | 0.15 / 0.26 / 0.38 / 0.46 / 0.54 |
| key | 0.22 / 0.42 / 0.55 / 0.67 / 0.77 | 0.03 / 0.16 / 0.28 / 0.40 / 0.48 | 0.07 / 0.22 / 0.45 / 0.66 / 0.79 | 0.03 / 0.08 / 0.20 / 0.32 / 0.43 | 0.11 / 0.26 / 0.38 / 0.46 / 0.52 |
| density | 0.00 / 0.00 / 0.01 / 0.09 / 0.12 | 0.00 / 0.04 / 0.16 / 0.28 / 0.34 | 0.06 / 0.17 / 0.36 / 0.55 / 0.65 | 0.03 / 0.06 / 0.10 / 0.16 / 0.21 | 0.03 / 0.08 / 0.17 / 0.26 / 0.31 |
| arrangement | 0.01 / 0.02 / 0.05 / 0.08 / 0.11 | 0.02 / 0.04 / 0.09 / 0.15 / 0.19 | 0.02 / 0.03 / 0.12 / 0.31 / 0.49 | 0.07 / 0.18 / 0.25 / 0.35 / 0.41 | 0.03 / 0.07 / 0.13 / 0.21 / 0.26 |
| template | 0.37 / 0.44 / 0.55 / 0.67 / 0.73 | 0.12 / 0.23 / 0.33 / 0.45 / 0.49 | 0.20 / 0.36 / 0.56 / 0.73 / 0.80 | 0.06 / 0.15 / 0.26 / 0.40 / 0.47 | 0.25 / 0.33 / 0.42 / 0.51 / 0.57 |

## Median component distance by kind (final adapted Piano)

| Component | take | seed | key | density | arrangement | template |
|---|---|---|---|---|---|---|
| contour | 0.59 | 0.53 | 0.50 | 0.00 | 0.00 | 0.50 |
| themeRhythm | 0.65 | 0.63 | 0.61 | 0.00 | 0.00 | 0.63 |
| melody | 0.67 | 0.68 | 0.65 | 0.28 | 0.37 | 0.68 |
| recurrence | 0.31 | 0.26 | 0.28 | 0.17 | 0.23 | 0.28 |
| onsets | 0.40 | 0.39 | 0.37 | 0.31 | 0.19 | 0.42 |
| melodyOnsets | 0.55 | 0.54 | 0.52 | 0.24 | 0.23 | 0.57 |
| positions | 0.19 | 0.16 | 0.16 | 0.17 | 0.07 | 0.21 |
| profile | 0.05 | 0.04 | 0.04 | 0.04 | 0.04 | 0.06 |
| left | 0.65 | 0.60 | 0.57 | 0.45 | 0.26 | 0.71 |
| right | 0.70 | 0.67 | 0.66 | 0.47 | 0.40 | 0.70 |
| exchange | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| bassMotion | 0.50 | 0.50 | 0.50 | 0.31 | 0.11 | 0.75 |
| inner | 0.16 | 0.15 | 0.14 | 0.11 | 0.08 | 0.19 |
| roles | 0.00 | 0.00 | 0.00 | 0.00 | 0.46 | 0.00 |
| operations | 0.43 | 0.29 | 0.33 | 0.00 | 0.46 | 0.50 |
| texture | 0.09 | 0.05 | 0.08 | 0.19 | 0.06 | 0.13 |
| dynamics | 0.12 | 0.10 | 0.12 | 0.05 | 0.13 | 0.20 |
| techniques | 0.54 | 0.51 | 0.52 | 0.41 | 0.23 | 0.57 |

## Classification with the Stage 1 thresholds

Thresholds: same when overall ≤ 0.05; a dimension is "meaningfully different" at theme ≥ 0.3, rhythm ≥ 0.35, accompaniment ≥ 0.55, development ≥ 0.2; "different" needs 3 such dimensions including theme or rhythm.

| Comparison | same | transposed | variation | different | Dimensions most often different |
|---|---|---|---|---|---|
| take | 0 | 0 | 145 | 215 | theme 100%, rhythm 55%, accompaniment 49%, development 60% |
| seed | 0 | 0 | 211 | 149 | theme 99%, rhythm 53%, accompaniment 41%, development 33% |
| key | 0 | 0 | 153 | 147 | theme 98%, rhythm 44%, accompaniment 42%, development 56% |
| density | 1 | 0 | 119 | 0 | theme 0%, rhythm 7%, accompaniment 15%, development 1% |
| arrangement | 24 | 0 | 274 | 2 | theme 0%, rhythm 0%, accompaniment 6%, development 80% |
| template | 0 | 0 | 59 | 181 | theme 100%, rhythm 65%, accompaniment 65%, development 80% |

## Regenerations (take and seed pairs) by template

| Template | Arrangement | Pairs | different | variation | same | Median theme | Median rhythm | Median accompaniment | Median development | Identical onset rhythm |
|---|---|---|---|---|---|---|---|---|---|---|
| chamber | full | 72 | 36 | 36 | 0 | 0.57 | 0.34 | 0.55 | 0.19 | 0% |
| chamber | Piano only | 72 | 36 | 36 | 0 | 0.55 | 0.31 | 0.58 | 0.19 | 0% |
| sonata | full | 72 | 47 | 25 | 0 | 0.54 | 0.36 | 0.63 | 0.20 | 0% |
| sonata | Piano only | 72 | 42 | 30 | 0 | 0.52 | 0.29 | 0.62 | 0.20 | 0% |
| vocalbacking | full | 72 | 15 | 57 | 0 | 0.62 | 0.40 | 0.43 | 0.17 | 0% |
| vocalbacking | Piano only | 72 | 27 | 45 | 0 | 0.62 | 0.39 | 0.43 | 0.19 | 0% |
| cinematic | full | 72 | 39 | 33 | 0 | 0.58 | 0.38 | 0.53 | 0.19 | 0% |
| cinematic | Piano only | 72 | 18 | 54 | 0 | 0.56 | 0.29 | 0.46 | 0.18 | 0% |
| hybridstudio | full | 72 | 52 | 20 | 0 | 0.60 | 0.41 | 0.58 | 0.23 | 0% |
| hybridstudio | Piano only | 72 | 52 | 20 | 0 | 0.60 | 0.39 | 0.56 | 0.22 | 0% |

## Regenerations by form and density

| Form | Density | Pairs | different | variation | Median overall |
|---|---|---|---|---|---|
| dorian-16bars | 0.3 | 120 | 44 | 76 | 0.41 |
| dorian-16bars | 0.6 | 120 | 59 | 61 | 0.42 |
| dorian-16bars | 1 | 120 | 44 | 76 | 0.40 |
| three-chorus-40bars | 0.3 | 120 | 75 | 45 | 0.41 |
| three-chorus-40bars | 0.6 | 120 | 77 | 43 | 0.44 |
| three-chorus-40bars | 1 | 120 | 65 | 55 | 0.42 |

## Diversity inside one generation (means over all generations of a template, full arrangement)

| Template | Theme recurrence | Beat / eighth / sixteenth / triplet / other | Off-beat share | Syncopation | Anticipations | Distinct bar rhythms | Distinct LH figures | Distinct RH figures | Hand-exchange bars |
|---|---|---|---|---|---|---|---|---|---|
| chamber | 0.76 | 0.70 / 0.29 / 0.00 / 0.00 / 0.01 | 0.30 | 0.03 | 5.85 | 10.57 | 4.40 | 5.28 | 0.85 |
| sonata | 0.71 | 0.68 / 0.31 / 0.00 / 0.00 / 0.01 | 0.32 | 0.04 | 7.27 | 10.65 | 5.93 | 5.85 | 1.57 |
| vocalbacking | 0.90 | 0.78 / 0.21 / 0.00 / 0.00 / 0.01 | 0.22 | 0.03 | 4.13 | 8.20 | 4.28 | 3.43 | 0.08 |
| cinematic | 0.74 | 0.70 / 0.28 / 0.00 / 0.00 / 0.02 | 0.30 | 0.05 | 9.83 | 11.95 | 3.95 | 4.28 | 0.07 |
| hybridstudio | 0.78 | 0.75 / 0.24 / 0.00 / 0.00 / 0.01 | 0.25 | 0.06 | 6.23 | 11.45 | 3.68 | 4.83 | 0.07 |

## Distinct identities across the matrix

| Template | Generations | Distinct planned themes | Distinct theme rhythms | Distinct role orders (16 bars / 40 bars) | Distinct texture curves (independent) |
|---|---|---|---|---|---|
| chamber | 120 | 20 | 20 | 3 / 19 | 70 of 120 |
| sonata | 120 | 20 | 19 | 3 / 11 | 76 of 120 |
| vocalbacking | 120 | 20 | 19 | 2 / 4 | 60 of 120 |
| cinematic | 120 | 20 | 20 | 3 / 7 | 65 of 120 |
| hybridstudio | 120 | 20 | 15 | 3 / 9 | 72 of 120 |

## Adaptation: what survives from the independent draft (full arrangement)

| Template | Events kept | Theme notes kept | Melody rhythm kept | LH figure unchanged | RH figure unchanged | Bars with texture changed | Added events | Lowest events kept |
|---|---|---|---|---|---|---|---|---|
| chamber | 0.63 | 0.66 | 0.77 | 0.75 | 0.63 | 0.17 | 0.26 | 0.38 |
| sonata | 0.65 | 0.66 | 0.78 | 0.76 | 0.63 | 0.15 | 0.26 | 0.47 |
| vocalbacking | 0.94 | 0.99 | 0.99 | 0.90 | 0.85 | 0.00 | 0.05 | 0.72 |
| cinematic | 0.68 | 0.78 | 0.84 | 0.69 | 0.51 | 0.12 | 0.20 | 0.41 |
| hybridstudio | 0.54 | 0.68 | 0.82 | 0.71 | 0.60 | 0.19 | 0.35 | 0.30 |
| (all, Piano only) | 0.97 | 0.98 | 0.98 | 0.96 | 0.80 | 0.00 | 0.05 | 0.89 |

## Does adaptation make different generations converge?

Regeneration pairs in the full arrangement: distance between the two independent drafts versus distance between the two adapted results.

| Template | Pairs | Median overall, independent | Median overall, adapted | Pairs closer after adaptation | Largest loss of distance |
|---|---|---|---|---|---|
| chamber | 72 | 0.38 | 0.41 | 10% | -0.04 |
| sonata | 72 | 0.40 | 0.44 | 4% | -0.02 |
| vocalbacking | 72 | 0.38 | 0.40 | 10% | -0.02 |
| cinematic | 72 | 0.36 | 0.41 | 17% | -0.04 |
| hybridstudio | 72 | 0.44 | 0.46 | 26% | -0.07 |

Regeneration pairs whose independent drafts classify as different but whose adapted results do not: 9.
- sonata__dorian-16bars__key+5__seed1__take0__d1__identity vs sonata__dorian-16bars__key+5__seed1__take2__d1__identity: independent 0.38, adapted 0.38
- hybridstudio__dorian-16bars__key+0__seed1__take0__d0.3__identity vs hybridstudio__dorian-16bars__key+0__seed11__take0__d0.3__identity: independent 0.44, adapted 0.43
- hybridstudio__dorian-16bars__key+0__seed1__take0__d0.6__identity vs hybridstudio__dorian-16bars__key+0__seed11__take0__d0.6__identity: independent 0.43, adapted 0.40
- hybridstudio__dorian-16bars__key+5__seed1__take0__d1__identity vs hybridstudio__dorian-16bars__key+5__seed11__take0__d1__identity: independent 0.41, adapted 0.43
- vocalbacking__three-chorus-40bars__key+5__seed1__take0__d1__identity vs vocalbacking__three-chorus-40bars__key+5__seed1__take2__d1__identity: independent 0.41, adapted 0.39
- cinematic__three-chorus-40bars__key+5__seed1__take0__d0.3__identity vs cinematic__three-chorus-40bars__key+5__seed1__take2__d0.3__identity: independent 0.45, adapted 0.43
- cinematic__three-chorus-40bars__key+5__seed1__take0__d0.6__identity vs cinematic__three-chorus-40bars__key+5__seed29__take0__d0.6__identity: independent 0.41, adapted 0.40
- hybridstudio__three-chorus-40bars__key+5__seed1__take0__d0.6__identity vs hybridstudio__three-chorus-40bars__key+5__seed29__take0__d0.6__identity: independent 0.45, adapted 0.42
- hybridstudio__three-chorus-40bars__key+5__seed1__take0__d1__identity vs hybridstudio__three-chorus-40bars__key+5__seed29__take0__d1__identity: independent 0.46, adapted 0.39

## Anchors for thresholds

- Lower anchor (must read as the same piece): repeated generations and the synthetic transposition control, distance 0.
- Middle anchor (a variation by construction): the same generation at another density. 90th percentile — theme 0.14, rhythm 0.32, accompaniment 0.58, development 0.16, overall 0.29.
- Upper anchor (different by design): another template on the same song and seed. 10th percentile — theme 0.45, rhythm 0.28, accompaniment 0.40, development 0.16, overall 0.37; median — theme 0.55, rhythm 0.38, accompaniment 0.59, development 0.27, overall 0.45.

## Composer mode

This run used the **identity** Piano composer.

## Note-derived distance by kind of comparison (final score)

Measured from pitch, start, length and velocity only - no composer labels. Each cell: median (10th - 90th percentile).

| Comparison | Pairs | Top line | Bar rhythm | Left-hand rhythm | Bass motion | Shape | Overall | Overall, independent draft |
|---|---|---|---|---|---|---|---|---|
| take | 360 | 0.66 (0.50 - 0.81) | 0.39 (0.20 - 0.51) | 0.34 (0.16 - 0.51) | 0.00 (0.00 - 0.13) | 0.21 (0.15 - 0.29) | 0.33 (0.24 - 0.39) | 0.31 (0.22 - 0.39) |
| seed | 360 | 0.65 (0.47 - 0.80) | 0.38 (0.17 - 0.50) | 0.31 (0.09 - 0.48) | 0.00 (0.00 - 0.13) | 0.18 (0.12 - 0.24) | 0.32 (0.21 - 0.39) | 0.29 (0.19 - 0.37) |
| key | 300 | 0.63 (0.48 - 0.82) | 0.36 (0.18 - 0.50) | 0.31 (0.09 - 0.48) | 0.00 (0.00 - 0.13) | 0.21 (0.16 - 0.29) | 0.31 (0.22 - 0.39) | 0.29 (0.19 - 0.36) |
| density | 120 | 0.17 (0.06 - 0.29) | 0.30 (0.15 - 0.45) | 0.27 (0.09 - 0.53) | 0.00 (0.00 - 0.05) | 0.12 (0.08 - 0.20) | 0.17 (0.09 - 0.28) | 0.14 (0.04 - 0.26) |
| arrangement | 300 | 0.35 (0.07 - 0.56) | 0.19 (0.06 - 0.33) | 0.19 (0.04 - 0.44) | 0.13 (0.05 - 0.20) | 0.21 (0.09 - 0.32) | 0.22 (0.10 - 0.34) | 0.13 (0.07 - 0.23) |
| template | 240 | 0.66 (0.50 - 0.82) | 0.42 (0.25 - 0.54) | 0.40 (0.19 - 0.53) | 0.00 (0.00 - 0.15) | 0.27 (0.19 - 0.36) | 0.35 (0.27 - 0.44) | 0.33 (0.24 - 0.42) |

## Note-derived regeneration distance (take and seed pairs) by template

| Template | Arrangement | Top line | Bar rhythm | Left-hand rhythm | Bass motion | Shape | Overall | Identical bar rhythm throughout |
|---|---|---|---|---|---|---|---|---|
| chamber | full | 0.62 | 0.36 | 0.33 | 0.08 | 0.23 | 0.32 | 0% |
| chamber | Piano only | 0.62 | 0.31 | 0.31 | 0.05 | 0.18 | 0.30 | 0% |
| sonata | full | 0.61 | 0.37 | 0.36 | 0.13 | 0.23 | 0.34 | 0% |
| sonata | Piano only | 0.55 | 0.28 | 0.31 | 0.08 | 0.17 | 0.27 | 0% |
| vocalbacking | full | 0.72 | 0.45 | 0.31 | 0.00 | 0.20 | 0.34 | 0% |
| vocalbacking | Piano only | 0.72 | 0.44 | 0.33 | 0.00 | 0.19 | 0.33 | 0% |
| cinematic | full | 0.63 | 0.41 | 0.34 | 0.00 | 0.21 | 0.33 | 0% |
| cinematic | Piano only | 0.67 | 0.28 | 0.22 | 0.00 | 0.16 | 0.28 | 0% |
| hybridstudio | full | 0.70 | 0.46 | 0.36 | 0.05 | 0.21 | 0.35 | 0% |
| hybridstudio | Piano only | 0.72 | 0.41 | 0.38 | 0.00 | 0.20 | 0.34 | 0% |

## What adaptation keeps of the identity

Mean share per generation. "Exact": every attack and the direction of every step kept. "Transformed": the rhythm kept with other steps, or a fragment of the bar kept. "Lost": no trace. Rhythm cell: bars that sounded the whole cell before adaptation. Bass: bars whose first bass note is unchanged.

| Template | Arrangement | Theme exact | Theme transformed | Theme lost | Head exact | Head transformed | Head lost | Rhythm cell exact | Rhythm cell partial | Bass motion | All events | Generations with no theme bar surviving | Generations with no head surviving |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chamber | full | 0.44 | 0.47 | 0.09 | 0.44 | 0.51 | 0.05 | 0.52 | 0.31 | 1.00 | 0.63 | 0 of 60 | 0 of 60 |
| chamber | Piano only | 0.94 | 0.05 | 0.01 | 0.90 | 0.10 | 0.00 | 0.93 | 0.07 | 1.00 | 0.97 | 0 of 60 | 0 of 60 |
| sonata | full | 0.46 | 0.46 | 0.08 | 0.47 | 0.49 | 0.04 | 0.55 | 0.26 | 1.00 | 0.65 | 0 of 60 | 0 of 60 |
| sonata | Piano only | 0.96 | 0.03 | 0.00 | 0.94 | 0.06 | 0.00 | 0.96 | 0.03 | 1.00 | 0.97 | 0 of 60 | 0 of 60 |
| vocalbacking | full | 0.97 | 0.01 | 0.02 | 0.97 | 0.02 | 0.02 | 0.96 | 0.04 | 1.00 | 0.94 | 0 of 60 | 0 of 60 |
| vocalbacking | Piano only | 0.96 | 0.02 | 0.02 | 0.94 | 0.03 | 0.03 | 0.95 | 0.05 | 1.00 | 0.98 | 0 of 60 | 0 of 60 |
| cinematic | full | 0.61 | 0.30 | 0.09 | 0.62 | 0.31 | 0.06 | 0.61 | 0.27 | 1.00 | 0.68 | 0 of 60 | 0 of 60 |
| cinematic | Piano only | 0.88 | 0.09 | 0.04 | 0.87 | 0.11 | 0.02 | 0.89 | 0.11 | 1.00 | 0.95 | 0 of 60 | 0 of 60 |
| hybridstudio | full | 0.55 | 0.38 | 0.06 | 0.53 | 0.40 | 0.07 | 0.59 | 0.26 | 1.00 | 0.54 | 0 of 60 | 0 of 60 |
| hybridstudio | Piano only | 0.96 | 0.03 | 0.02 | 0.95 | 0.02 | 0.03 | 0.96 | 0.04 | 1.00 | 0.97 | 0 of 60 | 0 of 60 |

## Identity survival by archetype (full arrangement)

| Archetype | Generations | Theme exact | Theme transformed | Theme lost | Head exact | Head transformed | Head lost | Rhythm cell exact | Rhythm cell partial | Bass motion | All events |
|---|---|---|---|---|---|---|---|---|---|---|---|
| chorale | 18 | 0.88 | 0.10 | 0.02 | 0.89 | 0.11 | 0.01 | 0.86 | 0.12 | 1.00 | 0.93 |
| dialogue | 33 | 0.52 | 0.34 | 0.14 | 0.71 | 0.18 | 0.11 | 0.79 | 0.11 | 1.00 | 0.63 |
| flowing | 81 | 0.49 | 0.47 | 0.04 | 0.31 | 0.65 | 0.04 | 0.32 | 0.36 | 1.00 | 0.67 |
| lyrical | 69 | 0.55 | 0.38 | 0.07 | 0.58 | 0.41 | 0.01 | 0.64 | 0.32 | 1.00 | 0.67 |
| rhythmic | 42 | 0.47 | 0.44 | 0.09 | 0.57 | 0.34 | 0.09 | 0.70 | 0.17 | 1.00 | 0.62 |
| sparse | 57 | 0.91 | 0.03 | 0.06 | 0.92 | 0.02 | 0.06 | 0.93 | 0.07 | 1.00 | 0.76 |

## Archetypes drawn

| Template | Archetype | Generations |
|---|---|---|
| chamber | chorale | 6 |
| chamber | dialogue | 30 |
| chamber | flowing | 30 |
| chamber | lyrical | 54 |
| sonata | dialogue | 36 |
| sonata | flowing | 30 |
| sonata | lyrical | 42 |
| sonata | rhythmic | 12 |
| vocalbacking | chorale | 30 |
| vocalbacking | flowing | 42 |
| vocalbacking | sparse | 48 |
| cinematic | flowing | 24 |
| cinematic | lyrical | 42 |
| cinematic | rhythmic | 30 |
| cinematic | sparse | 24 |
| hybridstudio | flowing | 36 |
| hybridstudio | rhythmic | 42 |
| hybridstudio | sparse | 42 |

## Composer labels against the notes

Share of notes labelled "melody" that are also the audible top line: mean 0.82, lowest 0.58.
