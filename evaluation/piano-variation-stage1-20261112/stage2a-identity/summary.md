# Piano variation baseline — Stage 1

Matrix label `stage2a-identity`. 600 generations, 1680 comparisons, 0 failures. Composer: Texture-and-Theme (current baseline).

Distances run from 0 (identical) to 1 (nothing in common). They are structural measurements, not judgements of how anything sounds.

## Reproducibility and transposition control

- Repeated generations with identical inputs: 75 of 75 identical (notes, CC64 and both fingerprints).
- Synthetic transposition control (same notes moved a fourth): 600 of 600 recognised as an exact transposition; largest overall distance 0.03; classes {"transposed":600}.

## Distance by kind of comparison (final adapted Piano)

Each cell: min / 10th percentile / median / 90th percentile / max.

| Comparison | Pairs | Theme | Rhythm | Accompaniment | Development | Overall |
|---|---|---|---|---|---|---|
| take (same inputs, Compose All pressed again (take changes)) | 360 | 0.41 / 0.50 / 0.59 / 0.69 / 0.81 | 0.10 / 0.25 / 0.36 / 0.47 / 0.61 | 0.15 / 0.32 / 0.56 / 0.71 / 0.85 | 0.06 / 0.12 / 0.22 / 0.35 / 0.45 | 0.24 / 0.35 / 0.43 / 0.51 / 0.64 |
| seed (same inputs, different seed option) | 360 | 0.24 / 0.43 / 0.56 / 0.67 / 0.80 | 0.07 / 0.21 / 0.36 / 0.47 / 0.56 | 0.06 / 0.26 / 0.51 / 0.68 / 0.83 | 0.04 / 0.07 / 0.15 / 0.25 / 0.32 | 0.17 / 0.28 / 0.40 / 0.48 / 0.53 |
| key (same inputs, whole song moved up a fourth) | 300 | 0.21 / 0.43 / 0.55 / 0.66 / 0.77 | 0.10 / 0.20 / 0.34 / 0.46 / 0.56 | 0.11 / 0.24 / 0.53 / 0.70 / 0.86 | 0.04 / 0.09 / 0.21 / 0.33 / 0.45 | 0.17 / 0.29 / 0.40 / 0.49 / 0.58 |
| density (same generation at another density) | 120 | 0.02 / 0.06 / 0.10 / 0.14 / 0.18 | 0.04 / 0.12 / 0.22 / 0.31 / 0.36 | 0.04 / 0.17 / 0.38 / 0.53 / 0.64 | 0.03 / 0.07 / 0.11 / 0.16 / 0.21 | 0.04 / 0.13 / 0.20 / 0.27 / 0.31 |
| arrangement (same generation, Piano-only versus full arrangement) | 300 | 0.01 / 0.08 / 0.14 / 0.23 / 0.32 | 0.03 / 0.10 / 0.21 / 0.34 / 0.57 | 0.01 / 0.11 / 0.32 / 0.52 / 0.79 | 0.07 / 0.18 / 0.30 / 0.39 / 0.44 | 0.03 / 0.15 / 0.25 / 0.35 / 0.44 |
| template (same song and seed, different template) | 240 | 0.40 / 0.46 / 0.55 / 0.66 / 0.76 | 0.14 / 0.27 / 0.40 / 0.48 / 0.57 | 0.22 / 0.39 / 0.60 / 0.75 / 0.83 | 0.08 / 0.15 / 0.26 / 0.39 / 0.45 | 0.28 / 0.36 / 0.45 / 0.54 / 0.60 |

## Same table for the independent draft (before orchestral adaptation)

| Comparison | Theme | Rhythm | Accompaniment | Development | Overall |
|---|---|---|---|---|---|
| take | 0.38 / 0.49 / 0.59 / 0.69 / 0.79 | 0.10 / 0.21 / 0.31 / 0.43 / 0.52 | 0.16 / 0.31 / 0.51 / 0.66 / 0.80 | 0.04 / 0.11 / 0.21 / 0.32 / 0.45 | 0.21 / 0.33 / 0.41 / 0.48 / 0.56 |
| seed | 0.24 / 0.42 / 0.54 / 0.68 / 0.78 | 0.02 / 0.16 / 0.31 / 0.43 / 0.52 | 0.05 / 0.24 / 0.47 / 0.62 / 0.79 | 0.02 / 0.06 / 0.15 / 0.24 / 0.31 | 0.15 / 0.26 / 0.38 / 0.46 / 0.53 |
| key | 0.22 / 0.42 / 0.55 / 0.65 / 0.77 | 0.03 / 0.16 / 0.28 / 0.40 / 0.48 | 0.07 / 0.22 / 0.46 / 0.66 / 0.81 | 0.03 / 0.08 / 0.20 / 0.31 / 0.43 | 0.11 / 0.27 / 0.37 / 0.46 / 0.52 |
| density | 0.00 / 0.00 / 0.02 / 0.09 / 0.12 | 0.00 / 0.04 / 0.15 / 0.27 / 0.31 | 0.05 / 0.17 / 0.38 / 0.54 / 0.61 | 0.02 / 0.07 / 0.10 / 0.16 / 0.21 | 0.03 / 0.08 / 0.17 / 0.25 / 0.30 |
| arrangement | 0.01 / 0.02 / 0.06 / 0.08 / 0.11 | 0.02 / 0.05 / 0.09 / 0.15 / 0.20 | 0.01 / 0.04 / 0.11 / 0.31 / 0.52 | 0.07 / 0.15 / 0.25 / 0.35 / 0.40 | 0.03 / 0.07 / 0.13 / 0.21 / 0.27 |
| template | 0.38 / 0.44 / 0.54 / 0.66 / 0.73 | 0.14 / 0.21 / 0.32 / 0.44 / 0.49 | 0.20 / 0.39 / 0.56 / 0.72 / 0.78 | 0.06 / 0.14 / 0.25 / 0.38 / 0.45 | 0.25 / 0.33 / 0.42 / 0.50 / 0.56 |

## Median component distance by kind (final adapted Piano)

| Component | take | seed | key | density | arrangement | template |
|---|---|---|---|---|---|---|
| contour | 0.59 | 0.53 | 0.50 | 0.00 | 0.00 | 0.50 |
| themeRhythm | 0.65 | 0.63 | 0.61 | 0.00 | 0.00 | 0.63 |
| melody | 0.65 | 0.65 | 0.63 | 0.28 | 0.40 | 0.69 |
| recurrence | 0.31 | 0.26 | 0.28 | 0.18 | 0.23 | 0.31 |
| onsets | 0.39 | 0.38 | 0.35 | 0.29 | 0.21 | 0.43 |
| melodyOnsets | 0.59 | 0.56 | 0.54 | 0.22 | 0.26 | 0.57 |
| positions | 0.17 | 0.16 | 0.15 | 0.16 | 0.10 | 0.21 |
| profile | 0.05 | 0.04 | 0.04 | 0.04 | 0.04 | 0.05 |
| left | 0.64 | 0.58 | 0.58 | 0.43 | 0.33 | 0.70 |
| right | 0.71 | 0.67 | 0.68 | 0.46 | 0.42 | 0.71 |
| exchange | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| bassMotion | 0.60 | 0.67 | 0.58 | 0.29 | 0.13 | 0.81 |
| inner | 0.16 | 0.15 | 0.14 | 0.10 | 0.08 | 0.17 |
| roles | 0.00 | 0.00 | 0.00 | 0.00 | 0.50 | 0.00 |
| operations | 0.38 | 0.25 | 0.30 | 0.00 | 0.50 | 0.50 |
| texture | 0.10 | 0.05 | 0.07 | 0.20 | 0.06 | 0.13 |
| dynamics | 0.12 | 0.10 | 0.12 | 0.04 | 0.14 | 0.17 |
| techniques | 0.54 | 0.50 | 0.52 | 0.39 | 0.29 | 0.56 |

## Classification with the Stage 1 thresholds

Thresholds: same when overall ≤ 0.05; a dimension is "meaningfully different" at theme ≥ 0.3, rhythm ≥ 0.35, accompaniment ≥ 0.55, development ≥ 0.2; "different" needs 3 such dimensions including theme or rhythm.

| Comparison | same | transposed | variation | different | Dimensions most often different |
|---|---|---|---|---|---|
| take | 0 | 0 | 144 | 216 | theme 100%, rhythm 55%, accompaniment 53%, development 60% |
| seed | 0 | 0 | 214 | 146 | theme 99%, rhythm 52%, accompaniment 40%, development 30% |
| key | 0 | 0 | 144 | 156 | theme 98%, rhythm 46%, accompaniment 46%, development 56% |
| density | 1 | 0 | 119 | 0 | theme 0%, rhythm 3%, accompaniment 9%, development 1% |
| arrangement | 7 | 0 | 281 | 12 | theme 2%, rhythm 9%, accompaniment 6%, development 86% |
| template | 0 | 0 | 66 | 174 | theme 100%, rhythm 65%, accompaniment 63%, development 79% |

## Regenerations (take and seed pairs) by template

| Template | Arrangement | Pairs | different | variation | same | Median theme | Median rhythm | Median accompaniment | Median development | Identical onset rhythm |
|---|---|---|---|---|---|---|---|---|---|---|
| chamber | full | 72 | 30 | 42 | 0 | 0.58 | 0.36 | 0.56 | 0.17 | 0% |
| chamber | Piano only | 72 | 36 | 36 | 0 | 0.55 | 0.30 | 0.60 | 0.19 | 0% |
| sonata | full | 72 | 45 | 27 | 0 | 0.52 | 0.36 | 0.64 | 0.20 | 0% |
| sonata | Piano only | 72 | 44 | 28 | 0 | 0.52 | 0.30 | 0.63 | 0.20 | 0% |
| vocalbacking | full | 72 | 11 | 61 | 0 | 0.60 | 0.30 | 0.30 | 0.14 | 0% |
| vocalbacking | Piano only | 72 | 28 | 44 | 0 | 0.62 | 0.40 | 0.44 | 0.18 | 0% |
| cinematic | full | 72 | 42 | 30 | 0 | 0.59 | 0.41 | 0.55 | 0.19 | 0% |
| cinematic | Piano only | 72 | 14 | 58 | 0 | 0.55 | 0.29 | 0.45 | 0.18 | 0% |
| hybridstudio | full | 72 | 59 | 13 | 0 | 0.62 | 0.45 | 0.62 | 0.23 | 0% |
| hybridstudio | Piano only | 72 | 53 | 19 | 0 | 0.59 | 0.39 | 0.57 | 0.22 | 0% |

## Regenerations by form and density

| Form | Density | Pairs | different | variation | Median overall |
|---|---|---|---|---|---|
| dorian-16bars | 0.3 | 120 | 41 | 79 | 0.39 |
| dorian-16bars | 0.6 | 120 | 56 | 64 | 0.42 |
| dorian-16bars | 1 | 120 | 45 | 75 | 0.40 |
| three-chorus-40bars | 0.3 | 120 | 77 | 43 | 0.43 |
| three-chorus-40bars | 0.6 | 120 | 75 | 45 | 0.44 |
| three-chorus-40bars | 1 | 120 | 68 | 52 | 0.42 |

## Diversity inside one generation (means over all generations of a template, full arrangement)

| Template | Theme recurrence | Beat / eighth / sixteenth / triplet / other | Off-beat share | Syncopation | Anticipations | Distinct bar rhythms | Distinct LH figures | Distinct RH figures | Hand-exchange bars |
|---|---|---|---|---|---|---|---|---|---|
| chamber | 0.77 | 0.69 / 0.30 / 0.00 / 0.00 / 0.01 | 0.31 | 0.03 | 5.85 | 11.43 | 5.67 | 5.92 | 1.35 |
| sonata | 0.81 | 0.67 / 0.32 / 0.00 / 0.00 / 0.01 | 0.33 | 0.02 | 6.32 | 10.57 | 6.42 | 5.68 | 1.42 |
| vocalbacking | 0.85 | 0.83 / 0.16 / 0.00 / 0.00 / 0.01 | 0.17 | 0.04 | 3.83 | 7.50 | 4.73 | 3.43 | 0.00 |
| cinematic | 0.68 | 0.72 / 0.27 / 0.00 / 0.00 / 0.02 | 0.28 | 0.04 | 8.17 | 11.60 | 4.62 | 4.62 | 0.10 |
| hybridstudio | 0.63 | 0.77 / 0.21 / 0.00 / 0.00 / 0.01 | 0.23 | 0.05 | 5.60 | 11.08 | 4.72 | 5.37 | 0.63 |

## Distinct identities across the matrix

| Template | Generations | Distinct planned themes | Distinct theme rhythms | Distinct role orders (16 bars / 40 bars) | Distinct texture curves (independent) |
|---|---|---|---|---|---|
| chamber | 120 | 20 | 20 | 3 / 8 | 60 of 120 |
| sonata | 120 | 20 | 19 | 3 / 11 | 78 of 120 |
| vocalbacking | 120 | 20 | 19 | 2 / 4 | 64 of 120 |
| cinematic | 120 | 20 | 20 | 3 / 7 | 61 of 120 |
| hybridstudio | 120 | 20 | 15 | 3 / 9 | 65 of 120 |

## Adaptation: what survives from the independent draft (full arrangement)

| Template | Events kept | Theme notes kept | Melody rhythm kept | LH figure unchanged | RH figure unchanged | Bars with texture changed | Added events | Lowest events kept |
|---|---|---|---|---|---|---|---|---|
| chamber | 0.64 | 0.66 | 0.79 | 0.71 | 0.63 | 0.13 | 0.26 | 0.27 |
| sonata | 0.69 | 0.76 | 0.87 | 0.80 | 0.63 | 0.07 | 0.26 | 0.47 |
| vocalbacking | 0.73 | 0.70 | 0.74 | 0.68 | 0.74 | 0.07 | 0.14 | 0.32 |
| cinematic | 0.60 | 0.62 | 0.69 | 0.63 | 0.46 | 0.16 | 0.22 | 0.28 |
| hybridstudio | 0.51 | 0.48 | 0.60 | 0.67 | 0.56 | 0.13 | 0.31 | 0.21 |
| (all, Piano only) | 0.97 | 0.98 | 0.98 | 0.96 | 0.80 | 0.00 | 0.05 | 0.91 |

## Does adaptation make different generations converge?

Regeneration pairs in the full arrangement: distance between the two independent drafts versus distance between the two adapted results.

| Template | Pairs | Median overall, independent | Median overall, adapted | Pairs closer after adaptation | Largest loss of distance |
|---|---|---|---|---|---|
| chamber | 72 | 0.38 | 0.41 | 10% | -0.05 |
| sonata | 72 | 0.40 | 0.44 | 0% | -0.00 |
| vocalbacking | 72 | 0.38 | 0.35 | 56% | -0.14 |
| cinematic | 72 | 0.36 | 0.44 | 4% | -0.03 |
| hybridstudio | 72 | 0.44 | 0.48 | 8% | -0.10 |

Regeneration pairs whose independent drafts classify as different but whose adapted results do not: 5.
- sonata__dorian-16bars__key+5__seed1__take0__d1__identity vs sonata__dorian-16bars__key+5__seed1__take2__d1__identity: independent 0.38, adapted 0.39
- hybridstudio__dorian-16bars__key+5__seed1__take1__d1__identity vs hybridstudio__dorian-16bars__key+5__seed1__take2__d1__identity: independent 0.46, adapted 0.41
- chamber__three-chorus-40bars__key+0__seed1__take0__d0.6__identity vs chamber__three-chorus-40bars__key+0__seed29__take0__d0.6__identity: independent 0.47, adapted 0.42
- vocalbacking__three-chorus-40bars__key+5__seed1__take1__d0.3__identity vs vocalbacking__three-chorus-40bars__key+5__seed1__take2__d0.3__identity: independent 0.46, adapted 0.42
- vocalbacking__three-chorus-40bars__key+5__seed1__take1__d0.6__identity vs vocalbacking__three-chorus-40bars__key+5__seed1__take2__d0.6__identity: independent 0.47, adapted 0.42

## Anchors for thresholds

- Lower anchor (must read as the same piece): repeated generations and the synthetic transposition control, distance 0.
- Middle anchor (a variation by construction): the same generation at another density. 90th percentile — theme 0.14, rhythm 0.31, accompaniment 0.53, development 0.16, overall 0.27.
- Upper anchor (different by design): another template on the same song and seed. 10th percentile — theme 0.46, rhythm 0.27, accompaniment 0.39, development 0.15, overall 0.36; median — theme 0.55, rhythm 0.40, accompaniment 0.60, development 0.26, overall 0.45.

## Composer mode

This run used the **identity** Piano composer.

## Note-derived distance by kind of comparison (final score)

Measured from pitch, start, length and velocity only - no composer labels. Each cell: median (10th - 90th percentile).

| Comparison | Pairs | Top line | Bar rhythm | Left-hand rhythm | Bass motion | Shape | Overall | Overall, independent draft |
|---|---|---|---|---|---|---|---|---|
| take | 360 | 0.64 (0.48 - 0.78) | 0.38 (0.20 - 0.51) | 0.35 (0.14 - 0.52) | 0.00 (0.00 - 0.13) | 0.21 (0.15 - 0.28) | 0.32 (0.24 - 0.40) | 0.31 (0.22 - 0.38) |
| seed | 360 | 0.64 (0.42 - 0.79) | 0.36 (0.17 - 0.48) | 0.31 (0.08 - 0.47) | 0.00 (0.00 - 0.10) | 0.17 (0.11 - 0.23) | 0.30 (0.20 - 0.38) | 0.29 (0.19 - 0.36) |
| key | 300 | 0.61 (0.44 - 0.81) | 0.34 (0.17 - 0.48) | 0.31 (0.09 - 0.49) | 0.00 (0.00 - 0.13) | 0.21 (0.14 - 0.29) | 0.30 (0.21 - 0.39) | 0.28 (0.19 - 0.35) |
| density | 120 | 0.15 (0.05 - 0.28) | 0.28 (0.12 - 0.42) | 0.28 (0.04 - 0.51) | 0.00 (0.00 - 0.00) | 0.11 (0.06 - 0.18) | 0.17 (0.08 - 0.26) | 0.15 (0.04 - 0.25) |
| arrangement | 300 | 0.42 (0.24 - 0.66) | 0.21 (0.10 - 0.39) | 0.21 (0.06 - 0.45) | 0.13 (0.05 - 0.18) | 0.23 (0.17 - 0.30) | 0.24 (0.16 - 0.35) | 0.13 (0.07 - 0.23) |
| template | 240 | 0.68 (0.48 - 0.80) | 0.42 (0.25 - 0.53) | 0.40 (0.19 - 0.52) | 0.00 (0.00 - 0.13) | 0.25 (0.19 - 0.32) | 0.35 (0.27 - 0.42) | 0.32 (0.24 - 0.41) |

## Note-derived regeneration distance (take and seed pairs) by template

| Template | Arrangement | Top line | Bar rhythm | Left-hand rhythm | Bass motion | Shape | Overall | Identical bar rhythm throughout |
|---|---|---|---|---|---|---|---|---|
| chamber | full | 0.61 | 0.37 | 0.33 | 0.00 | 0.21 | 0.31 | 0% |
| chamber | Piano only | 0.60 | 0.31 | 0.32 | 0.05 | 0.17 | 0.30 | 0% |
| sonata | full | 0.56 | 0.36 | 0.38 | 0.10 | 0.22 | 0.32 | 0% |
| sonata | Piano only | 0.52 | 0.28 | 0.34 | 0.08 | 0.18 | 0.28 | 0% |
| vocalbacking | full | 0.52 | 0.34 | 0.22 | 0.00 | 0.15 | 0.27 | 0% |
| vocalbacking | Piano only | 0.73 | 0.44 | 0.33 | 0.00 | 0.18 | 0.34 | 0% |
| cinematic | full | 0.68 | 0.41 | 0.35 | 0.00 | 0.22 | 0.33 | 0% |
| cinematic | Piano only | 0.63 | 0.26 | 0.23 | 0.00 | 0.16 | 0.26 | 0% |
| hybridstudio | full | 0.71 | 0.43 | 0.39 | 0.00 | 0.23 | 0.35 | 0% |
| hybridstudio | Piano only | 0.70 | 0.41 | 0.40 | 0.00 | 0.20 | 0.33 | 0% |

## What adaptation keeps of the identity

Mean share per generation. "Exact": every attack and the direction of every step kept. "Transformed": the rhythm kept with other steps, or a fragment of the bar kept. "Lost": no trace. Rhythm cell: bars that sounded the whole cell before adaptation. Bass: bars whose first bass note is unchanged.

| Template | Arrangement | Theme exact | Theme transformed | Theme lost | Head exact | Head transformed | Head lost | Rhythm cell exact | Rhythm cell partial | Bass motion | All events | Generations with no theme bar surviving | Generations with no head surviving |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chamber | full | 0.53 | 0.33 | 0.14 | 0.43 | 0.42 | 0.15 | 0.60 | 0.23 | 1.00 | 0.64 | 0 of 60 | 0 of 60 |
| chamber | Piano only | 0.96 | 0.04 | 0.01 | 0.93 | 0.07 | 0.00 | 0.95 | 0.05 | 1.00 | 0.97 | 0 of 60 | 0 of 60 |
| sonata | full | 0.65 | 0.24 | 0.10 | 0.58 | 0.32 | 0.10 | 0.78 | 0.10 | 1.00 | 0.69 | 0 of 60 | 0 of 60 |
| sonata | Piano only | 0.97 | 0.03 | 0.00 | 0.96 | 0.04 | 0.00 | 0.96 | 0.04 | 1.00 | 0.97 | 0 of 60 | 0 of 60 |
| vocalbacking | full | 0.64 | 0.29 | 0.07 | 0.37 | 0.52 | 0.11 | 0.37 | 0.30 | 1.00 | 0.73 | 0 of 60 | 3 of 60 |
| vocalbacking | Piano only | 0.96 | 0.02 | 0.02 | 0.95 | 0.02 | 0.03 | 0.96 | 0.04 | 1.00 | 0.98 | 0 of 60 | 0 of 60 |
| cinematic | full | 0.49 | 0.24 | 0.27 | 0.44 | 0.31 | 0.25 | 0.49 | 0.25 | 0.98 | 0.60 | 0 of 60 | 0 of 60 |
| cinematic | Piano only | 0.89 | 0.08 | 0.03 | 0.90 | 0.09 | 0.01 | 0.91 | 0.09 | 1.00 | 0.96 | 0 of 60 | 0 of 60 |
| hybridstudio | full | 0.43 | 0.21 | 0.36 | 0.40 | 0.27 | 0.33 | 0.53 | 0.13 | 1.00 | 0.51 | 0 of 60 | 0 of 60 |
| hybridstudio | Piano only | 0.96 | 0.02 | 0.01 | 0.97 | 0.01 | 0.02 | 0.97 | 0.03 | 1.00 | 0.97 | 0 of 60 | 0 of 60 |

## Identity survival by archetype (full arrangement)

| Archetype | Generations | Theme exact | Theme transformed | Theme lost | Head exact | Head transformed | Head lost | Rhythm cell exact | Rhythm cell partial | Bass motion | All events |
|---|---|---|---|---|---|---|---|---|---|---|---|
| chorale | 18 | 0.58 | 0.39 | 0.03 | 0.26 | 0.70 | 0.04 | 0.29 | 0.66 | 1.00 | 0.77 |
| dialogue | 33 | 0.71 | 0.21 | 0.07 | 0.73 | 0.18 | 0.10 | 0.88 | 0.03 | 1.00 | 0.66 |
| flowing | 81 | 0.32 | 0.35 | 0.33 | 0.13 | 0.54 | 0.33 | 0.24 | 0.11 | 0.99 | 0.54 |
| lyrical | 69 | 0.61 | 0.33 | 0.06 | 0.52 | 0.44 | 0.04 | 0.64 | 0.32 | 0.98 | 0.66 |
| rhythmic | 42 | 0.37 | 0.26 | 0.37 | 0.36 | 0.36 | 0.28 | 0.56 | 0.12 | 1.00 | 0.61 |
| sparse | 57 | 0.83 | 0.05 | 0.12 | 0.76 | 0.03 | 0.21 | 0.78 | 0.21 | 1.00 | 0.70 |

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

Share of notes labelled "melody" that are also the audible top line: mean 0.82, lowest 0.55.
