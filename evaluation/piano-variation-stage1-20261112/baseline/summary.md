# Piano variation baseline — Stage 1

Matrix label `baseline`. 600 generations, 1680 comparisons, 0 failures. Composer: Texture-and-Theme (current baseline).

Distances run from 0 (identical) to 1 (nothing in common). They are structural measurements, not judgements of how anything sounds.

## Reproducibility and transposition control

- Repeated generations with identical inputs: 75 of 75 identical (notes, CC64 and both fingerprints).
- Synthetic transposition control (same notes moved a fourth): 600 of 600 recognised as an exact transposition; largest overall distance 0.03; classes {"transposed":600}.

## Distance by kind of comparison (final adapted Piano)

Each cell: min / 10th percentile / median / 90th percentile / max.

| Comparison | Pairs | Theme | Rhythm | Accompaniment | Development | Overall |
|---|---|---|---|---|---|---|
| take (same inputs, Compose All pressed again (take changes)) | 360 | 0.16 / 0.27 / 0.44 / 0.53 / 0.65 | 0.05 / 0.14 / 0.26 / 0.36 / 0.50 | 0.02 / 0.18 / 0.36 / 0.53 / 0.71 | 0.02 / 0.05 / 0.08 / 0.29 / 0.39 | 0.12 / 0.21 / 0.28 / 0.37 / 0.51 |
| seed (same inputs, different seed option) | 360 | 0.11 / 0.32 / 0.44 / 0.57 / 0.66 | 0.06 / 0.14 / 0.24 / 0.36 / 0.47 | 0.02 / 0.14 / 0.33 / 0.48 / 0.69 | 0.02 / 0.04 / 0.07 / 0.09 / 0.20 | 0.09 / 0.19 / 0.27 / 0.35 / 0.41 |
| key (same inputs, whole song moved up a fourth) | 300 | 0.11 / 0.29 / 0.44 / 0.57 / 0.67 | 0.06 / 0.15 / 0.28 / 0.38 / 0.51 | 0.06 / 0.18 / 0.38 / 0.54 / 0.70 | 0.01 / 0.05 / 0.08 / 0.32 / 0.39 | 0.12 / 0.20 / 0.30 / 0.40 / 0.55 |
| density (same generation at another density) | 120 | 0.02 / 0.06 / 0.10 / 0.16 / 0.24 | 0.04 / 0.13 / 0.23 / 0.33 / 0.40 | 0.12 / 0.18 / 0.39 / 0.60 / 0.70 | 0.04 / 0.07 / 0.12 / 0.17 / 0.23 | 0.07 / 0.12 / 0.20 / 0.30 / 0.34 |
| arrangement (same generation, Piano-only versus full arrangement) | 300 | 0.01 / 0.02 / 0.17 / 0.24 / 0.31 | 0.01 / 0.06 / 0.20 / 0.31 / 0.39 | 0.02 / 0.07 / 0.33 / 0.53 / 0.76 | 0.06 / 0.17 / 0.30 / 0.39 / 0.44 | 0.03 / 0.08 / 0.25 / 0.36 / 0.44 |
| template (same song and seed, different template) | 240 | 0.30 / 0.39 / 0.48 / 0.59 / 0.71 | 0.10 / 0.20 / 0.31 / 0.41 / 0.52 | 0.16 / 0.39 / 0.58 / 0.73 / 0.82 | 0.06 / 0.10 / 0.17 / 0.39 / 0.45 | 0.23 / 0.32 / 0.40 / 0.48 / 0.54 |

## Same table for the independent draft (before orchestral adaptation)

| Comparison | Theme | Rhythm | Accompaniment | Development | Overall |
|---|---|---|---|---|---|
| take | 0.14 / 0.23 / 0.42 / 0.51 / 0.62 | 0.00 / 0.07 / 0.17 / 0.29 / 0.44 | 0.00 / 0.13 / 0.30 / 0.47 / 0.64 | 0.01 / 0.03 / 0.07 / 0.27 / 0.37 | 0.06 / 0.16 / 0.24 / 0.33 / 0.49 |
| seed | 0.06 / 0.28 / 0.42 / 0.56 / 0.68 | 0.00 / 0.05 / 0.18 / 0.31 / 0.42 | 0.00 / 0.11 / 0.28 / 0.43 / 0.64 | 0.00 / 0.02 / 0.05 / 0.08 / 0.19 | 0.04 / 0.15 / 0.23 / 0.32 / 0.37 |
| key | 0.06 / 0.27 / 0.42 / 0.55 / 0.66 | 0.00 / 0.08 / 0.19 / 0.32 / 0.50 | 0.05 / 0.14 / 0.32 / 0.47 / 0.63 | 0.01 / 0.03 / 0.06 / 0.28 / 0.37 | 0.06 / 0.15 / 0.26 / 0.35 / 0.52 |
| density | 0.00 / 0.00 / 0.03 / 0.09 / 0.19 | 0.00 / 0.05 / 0.19 / 0.29 / 0.40 | 0.10 / 0.14 / 0.37 / 0.58 / 0.73 | 0.03 / 0.06 / 0.11 / 0.18 / 0.23 | 0.04 / 0.08 / 0.17 / 0.28 / 0.38 |
| arrangement | 0.01 / 0.01 / 0.06 / 0.08 / 0.15 | 0.02 / 0.05 / 0.11 / 0.18 / 0.27 | 0.02 / 0.03 / 0.16 / 0.32 / 0.47 | 0.07 / 0.18 / 0.26 / 0.36 / 0.39 | 0.03 / 0.08 / 0.15 / 0.23 / 0.29 |
| template | 0.27 / 0.37 / 0.45 / 0.58 / 0.67 | 0.05 / 0.16 / 0.26 / 0.37 / 0.47 | 0.16 / 0.34 / 0.56 / 0.72 / 0.83 | 0.04 / 0.08 / 0.16 / 0.38 / 0.46 | 0.18 / 0.29 / 0.37 / 0.45 / 0.52 |

## Median component distance by kind (final adapted Piano)

| Component | take | seed | key | density | arrangement | template |
|---|---|---|---|---|---|---|
| contour | 0.39 | 0.40 | 0.36 | 0.00 | 0.00 | 0.42 |
| themeRhythm | 0.47 | 0.50 | 0.50 | 0.00 | 0.00 | 0.50 |
| melody | 0.56 | 0.57 | 0.59 | 0.28 | 0.47 | 0.61 |
| recurrence | 0.20 | 0.23 | 0.23 | 0.17 | 0.31 | 0.27 |
| onsets | 0.26 | 0.23 | 0.26 | 0.30 | 0.20 | 0.32 |
| melodyOnsets | 0.45 | 0.44 | 0.48 | 0.23 | 0.32 | 0.53 |
| positions | 0.09 | 0.08 | 0.10 | 0.18 | 0.08 | 0.13 |
| profile | 0.02 | 0.02 | 0.02 | 0.05 | 0.05 | 0.04 |
| left | 0.38 | 0.33 | 0.40 | 0.43 | 0.29 | 0.66 |
| right | 0.53 | 0.50 | 0.53 | 0.41 | 0.47 | 0.66 |
| exchange | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| bassMotion | 0.25 | 0.10 | 0.27 | 0.43 | 0.16 | 0.88 |
| inner | 0.09 | 0.07 | 0.09 | 0.13 | 0.08 | 0.17 |
| roles | 0.00 | 0.00 | 0.00 | 0.00 | 0.46 | 0.00 |
| operations | 0.00 | 0.00 | 0.00 | 0.00 | 0.46 | 0.00 |
| texture | 0.02 | 0.00 | 0.02 | 0.19 | 0.08 | 0.08 |
| dynamics | 0.07 | 0.04 | 0.06 | 0.05 | 0.13 | 0.19 |
| techniques | 0.40 | 0.39 | 0.41 | 0.44 | 0.28 | 0.58 |

## Classification with the Stage 1 thresholds

Thresholds: same when overall ≤ 0.05; a dimension is "meaningfully different" at theme ≥ 0.3, rhythm ≥ 0.35, accompaniment ≥ 0.55, development ≥ 0.2; "different" needs 3 such dimensions including theme or rhythm.

| Comparison | same | transposed | variation | different | Dimensions most often different |
|---|---|---|---|---|---|
| take | 0 | 0 | 328 | 32 | theme 85%, rhythm 13%, accompaniment 8%, development 20% |
| seed | 0 | 0 | 357 | 3 | theme 91%, rhythm 13%, accompaniment 4%, development 0% |
| key | 0 | 0 | 272 | 28 | theme 89%, rhythm 19%, accompaniment 9%, development 16% |
| density | 0 | 0 | 119 | 1 | theme 0%, rhythm 3%, accompaniment 14%, development 3% |
| arrangement | 23 | 0 | 276 | 1 | theme 0%, rhythm 2%, accompaniment 8%, development 82% |
| template | 0 | 0 | 143 | 97 | theme 100%, rhythm 37%, accompaniment 61%, development 40% |

## Regenerations (take and seed pairs) by template

| Template | Arrangement | Pairs | different | variation | same | Median theme | Median rhythm | Median accompaniment | Median development | Identical onset rhythm |
|---|---|---|---|---|---|---|---|---|---|---|
| chamber | full | 72 | 9 | 63 | 0 | 0.42 | 0.28 | 0.35 | 0.08 | 0% |
| chamber | Piano only | 72 | 0 | 72 | 0 | 0.39 | 0.21 | 0.40 | 0.06 | 1% |
| sonata | full | 72 | 12 | 60 | 0 | 0.47 | 0.23 | 0.42 | 0.10 | 0% |
| sonata | Piano only | 72 | 0 | 72 | 0 | 0.45 | 0.15 | 0.37 | 0.07 | 0% |
| vocalbacking | full | 72 | 0 | 72 | 0 | 0.44 | 0.29 | 0.31 | 0.08 | 0% |
| vocalbacking | Piano only | 72 | 0 | 72 | 0 | 0.44 | 0.27 | 0.31 | 0.07 | 0% |
| cinematic | full | 72 | 3 | 69 | 0 | 0.47 | 0.28 | 0.36 | 0.08 | 0% |
| cinematic | Piano only | 72 | 0 | 72 | 0 | 0.45 | 0.21 | 0.33 | 0.07 | 0% |
| hybridstudio | full | 72 | 9 | 63 | 0 | 0.46 | 0.31 | 0.33 | 0.07 | 0% |
| hybridstudio | Piano only | 72 | 2 | 70 | 0 | 0.42 | 0.23 | 0.34 | 0.06 | 0% |

## Regenerations by form and density

| Form | Density | Pairs | different | variation | Median overall |
|---|---|---|---|---|---|
| dorian-16bars | 0.3 | 120 | 8 | 112 | 0.29 |
| dorian-16bars | 0.6 | 120 | 7 | 113 | 0.28 |
| dorian-16bars | 1 | 120 | 5 | 115 | 0.27 |
| three-chorus-40bars | 0.3 | 120 | 7 | 113 | 0.28 |
| three-chorus-40bars | 0.6 | 120 | 3 | 117 | 0.29 |
| three-chorus-40bars | 1 | 120 | 5 | 115 | 0.28 |

## Diversity inside one generation (means over all generations of a template, full arrangement)

| Template | Theme recurrence | Beat / eighth / sixteenth / triplet / other | Off-beat share | Syncopation | Anticipations | Distinct bar rhythms | Distinct LH figures | Distinct RH figures | Hand-exchange bars |
|---|---|---|---|---|---|---|---|---|---|
| chamber | 0.74 | 0.71 / 0.28 / 0.00 / 0.00 / 0.01 | 0.29 | 0.03 | 5.85 | 9.12 | 4.48 | 4.35 | 1.40 |
| sonata | 0.79 | 0.69 / 0.29 / 0.00 / 0.00 / 0.01 | 0.31 | 0.01 | 7.27 | 8.38 | 6.07 | 5.32 | 1.65 |
| vocalbacking | 0.89 | 0.79 / 0.20 / 0.00 / 0.00 / 0.01 | 0.21 | 0.02 | 4.13 | 9.13 | 5.07 | 3.85 | 0.05 |
| cinematic | 0.73 | 0.71 / 0.28 / 0.00 / 0.00 / 0.02 | 0.29 | 0.04 | 9.83 | 11.72 | 4.02 | 4.48 | 0.10 |
| hybridstudio | 0.72 | 0.72 / 0.27 / 0.00 / 0.00 / 0.01 | 0.28 | 0.04 | 6.23 | 11.50 | 3.75 | 4.95 | 0.12 |

## Distinct identities across the matrix

| Template | Generations | Distinct planned themes | Distinct theme rhythms | Distinct role orders (16 bars / 40 bars) | Distinct texture curves (independent) |
|---|---|---|---|---|---|
| chamber | 120 | 17 | 15 | 3 / 15 | 41 of 120 |
| sonata | 120 | 18 | 14 | 3 / 7 | 44 of 120 |
| vocalbacking | 120 | 19 | 13 | 2 / 2 | 30 of 120 |
| cinematic | 120 | 19 | 14 | 3 / 4 | 33 of 120 |
| hybridstudio | 120 | 18 | 14 | 3 / 6 | 34 of 120 |

## Adaptation: what survives from the independent draft (full arrangement)

| Template | Events kept | Theme notes kept | Melody rhythm kept | LH figure unchanged | RH figure unchanged | Bars with texture changed | Added events | Lowest events kept |
|---|---|---|---|---|---|---|---|---|
| chamber | 0.65 | 0.62 | 0.72 | 0.79 | 0.66 | 0.15 | 0.25 | 0.39 |
| sonata | 0.66 | 0.56 | 0.70 | 0.78 | 0.58 | 0.12 | 0.23 | 0.50 |
| vocalbacking | 0.95 | 0.99 | 0.99 | 0.89 | 0.86 | 0.00 | 0.05 | 0.83 |
| cinematic | 0.68 | 0.78 | 0.84 | 0.68 | 0.49 | 0.12 | 0.20 | 0.40 |
| hybridstudio | 0.52 | 0.53 | 0.67 | 0.71 | 0.53 | 0.18 | 0.31 | 0.23 |
| (all, Piano only) | 0.97 | 0.98 | 0.98 | 0.96 | 0.80 | 0.00 | 0.05 | 0.91 |

## Does adaptation make different generations converge?

Regeneration pairs in the full arrangement: distance between the two independent drafts versus distance between the two adapted results.

| Template | Pairs | Median overall, independent | Median overall, adapted | Pairs closer after adaptation | Largest loss of distance |
|---|---|---|---|---|---|
| chamber | 72 | 0.26 | 0.31 | 13% | -0.05 |
| sonata | 72 | 0.25 | 0.31 | 4% | -0.04 |
| vocalbacking | 72 | 0.24 | 0.28 | 0% | -0.00 |
| cinematic | 72 | 0.24 | 0.30 | 0% | -0.00 |
| hybridstudio | 72 | 0.26 | 0.31 | 11% | -0.05 |

Regeneration pairs whose independent drafts classify as different but whose adapted results do not: 2.
- chamber__dorian-16bars__key+5__seed1__take0__d1 vs chamber__dorian-16bars__key+5__seed1__take2__d1: independent 0.42, adapted 0.42
- hybridstudio__dorian-16bars__key+0__seed1__take0__d0.6 vs hybridstudio__dorian-16bars__key+0__seed1__take2__d0.6: independent 0.38, adapted 0.46

## Anchors for thresholds

- Lower anchor (must read as the same piece): repeated generations and the synthetic transposition control, distance 0.
- Middle anchor (a variation by construction): the same generation at another density. 90th percentile — theme 0.16, rhythm 0.33, accompaniment 0.60, development 0.17, overall 0.30.
- Upper anchor (different by design): another template on the same song and seed. 10th percentile — theme 0.39, rhythm 0.20, accompaniment 0.39, development 0.10, overall 0.32; median — theme 0.48, rhythm 0.31, accompaniment 0.58, development 0.17, overall 0.40.
