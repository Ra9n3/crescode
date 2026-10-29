# Phase 5 — Complete Progression Evaluation & Musical Coherence: Development Audit

Generated 2026-10-29T20:47:52.667Z · full corpus · 30 seeds per cell · 1650 generation runs total

> **Reading this report honestly (spec §20)**
>
> The evaluation system is a tool for selecting more coherent alternatives — it is
> **not** proof of artistic quality. `total` and every component below are internal
> 0..1 heuristic fits (clearly separated from the objective facts beside them).
> A candidate selected because its evaluator liked it is a *candidate the system
> could argue for* — whether the music is convincing is decided by human listening.

## What Phase 5 added

- Whole-phrase and whole-song evaluation (`evaluatePhrase`, `evaluateSongProgression`): structural movement before color, phrase-intention context, duration-based continuation, contextual cadence/chromatic judgments, repeated-section identity, symmetrical-scale-safe tonal identity.
- Bounded complete-candidate generation over the UNMODIFIED production generator (candidate 0 = the requested seed; the Phase 4 result is always in the field).
- Deterministic seeded selection among musically competitive candidates (margin-based, no score floor).
- Scope/lock safety by construction: selection only PICKS complete candidates; protected material is identical in every candidate.

## Aggregate results

| Cell | runs | total (mean) | tonal | continuity | rep-sect | arrival | rhythm | chromatic | cands | sig | div | competit. | picked≠top | cpb | roots | chromShare | ms mean |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Ionian / V/C verse-chorus | 30 | 0.704 | 0.605 | 0.838 | 0.608 | 0.625 | 0.602 | 0.988 | 6.0 | 6.0 | 0.343 | 4.0 | 73% | 1.27 | 5.8 | 0.008 | 94 |
| Ionian / full arrangement | 30 | 0.735 | 0.657 | 0.823 | 0.714 | 0.680 | 0.604 | 0.981 | 6.0 | 6.0 | 0.366 | 4.4 | 77% | 1.34 | 7.7 | 0.041 | 144 |
| Ionian / irregular lengths | 30 | 0.734 | 0.683 | 0.821 | n/a | 0.706 | 0.542 | 0.982 | 6.0 | 6.0 | 0.333 | 4.9 | 83% | 1.49 | 6.1 | 0.009 | 135 |
| Dorian / V/C verse-chorus | 30 | 0.671 | 0.613 | 0.743 | 0.518 | 0.573 | 0.546 | 0.986 | 6.0 | 6.0 | 0.341 | 4.3 | 80% | 1.16 | 6.4 | 0.022 | 96 |
| Dorian / full arrangement | 30 | 0.712 | 0.676 | 0.775 | 0.712 | 0.601 | 0.556 | 0.966 | 6.0 | 6.0 | 0.352 | 4.6 | 67% | 1.26 | 8.1 | 0.056 | 148 |
| Dorian / irregular lengths | 30 | 0.709 | 0.699 | 0.743 | n/a | 0.624 | 0.514 | 0.968 | 6.0 | 6.0 | 0.315 | 5.0 | 80% | 1.43 | 6.4 | 0.013 | 142 |
| Phrygian / V/C verse-chorus | 30 | 0.682 | 0.632 | 0.740 | 0.569 | 0.588 | 0.533 | 0.980 | 6.0 | 6.0 | 0.352 | 4.3 | 63% | 1.13 | 6.1 | 0.027 | 88 |
| Phrygian / full arrangement | 30 | 0.707 | 0.654 | 0.708 | 0.673 | 0.642 | 0.569 | 0.953 | 6.0 | 6.0 | 0.356 | 4.8 | 73% | 1.27 | 8.6 | 0.081 | 138 |
| Phrygian / irregular lengths | 30 | 0.711 | 0.679 | 0.719 | n/a | 0.662 | 0.510 | 0.971 | 6.0 | 6.0 | 0.328 | 4.8 | 83% | 1.43 | 6.5 | 0.015 | 132 |
| Lydian / V/C verse-chorus | 30 | 0.703 | 0.637 | 0.812 | 0.588 | 0.608 | 0.622 | 0.946 | 6.0 | 6.0 | 0.347 | 4.3 | 70% | 1.31 | 6.7 | 0.072 | 84 |
| Lydian / full arrangement | 30 | 0.734 | 0.658 | 0.799 | 0.736 | 0.661 | 0.617 | 0.961 | 6.0 | 6.0 | 0.353 | 4.2 | 53% | 1.38 | 8.1 | 0.083 | 134 |
| Lydian / irregular lengths | 30 | 0.723 | 0.674 | 0.797 | n/a | 0.677 | 0.539 | 0.958 | 6.0 | 6.0 | 0.338 | 5.1 | 83% | 1.50 | 7.1 | 0.042 | 130 |
| Mixolydian / V/C verse-chorus | 30 | 0.681 | 0.609 | 0.742 | 0.585 | 0.600 | 0.545 | 0.966 | 6.0 | 6.0 | 0.358 | 4.3 | 67% | 1.15 | 6.2 | 0.033 | 87 |
| Mixolydian / full arrangement | 30 | 0.708 | 0.668 | 0.742 | 0.694 | 0.636 | 0.526 | 0.971 | 6.0 | 6.0 | 0.345 | 4.5 | 83% | 1.19 | 8.5 | 0.078 | 135 |
| Mixolydian / irregular lengths | 30 | 0.707 | 0.678 | 0.752 | n/a | 0.642 | 0.511 | 0.960 | 6.0 | 6.0 | 0.348 | 5.1 | 73% | 1.42 | 6.7 | 0.021 | 130 |
| Aeolian / V/C verse-chorus | 30 | 0.671 | 0.552 | 0.763 | 0.587 | 0.555 | 0.589 | 0.975 | 6.0 | 6.0 | 0.345 | 5.1 | 80% | 1.24 | 5.5 | 0.018 | 98 |
| Aeolian / full arrangement | 30 | 0.711 | 0.653 | 0.758 | 0.726 | 0.594 | 0.592 | 0.964 | 6.0 | 6.0 | 0.360 | 4.7 | 80% | 1.34 | 8.0 | 0.056 | 154 |
| Aeolian / irregular lengths | 30 | 0.703 | 0.675 | 0.724 | n/a | 0.605 | 0.543 | 0.977 | 6.0 | 6.0 | 0.330 | 5.3 | 83% | 1.49 | 6.4 | 0.015 | 147 |
| Locrian / V/C verse-chorus | 30 | 0.685 | 0.659 | 0.788 | 0.576 | 0.614 | 0.423 | 0.943 | 6.0 | 6.0 | 0.393 | 4.3 | 77% | 0.91 | 6.1 | 0.142 | 83 |
| Locrian / full arrangement | 30 | 0.706 | 0.696 | 0.747 | 0.682 | 0.633 | 0.498 | 0.933 | 6.0 | 6.0 | 0.363 | 4.8 | 77% | 1.11 | 9.2 | 0.158 | 130 |
| Locrian / irregular lengths | 30 | 0.704 | 0.723 | 0.740 | n/a | 0.645 | 0.479 | 0.892 | 6.0 | 6.0 | 0.353 | 5.4 | 80% | 1.30 | 7.3 | 0.077 | 123 |
| Harmonic Minor / V/C verse-chorus | 30 | 0.703 | 0.621 | 0.823 | 0.618 | 0.599 | 0.611 | 0.961 | 6.0 | 6.0 | 0.360 | 4.4 | 73% | 1.28 | 5.3 | 0.020 | 96 |
| Harmonic Minor / full arrangement | 30 | 0.731 | 0.667 | 0.818 | 0.725 | 0.649 | 0.591 | 0.968 | 6.0 | 6.0 | 0.356 | 4.7 | 70% | 1.33 | 7.6 | 0.061 | 152 |
| Harmonic Minor / irregular lengths | 30 | 0.739 | 0.717 | 0.816 | n/a | 0.680 | 0.540 | 0.948 | 6.0 | 6.0 | 0.333 | 4.9 | 77% | 1.50 | 6.0 | 0.024 | 146 |
| Melodic Minor / V/C verse-chorus | 30 | 0.699 | 0.606 | 0.813 | 0.543 | 0.588 | 0.678 | 0.967 | 6.0 | 6.0 | 0.341 | 4.4 | 77% | 1.41 | 6.6 | 0.031 | 95 |
| Melodic Minor / full arrangement | 30 | 0.738 | 0.659 | 0.823 | 0.745 | 0.665 | 0.632 | 0.964 | 6.0 | 6.0 | 0.352 | 4.6 | 67% | 1.42 | 8.8 | 0.070 | 150 |
| Melodic Minor / irregular lengths | 30 | 0.736 | 0.693 | 0.793 | n/a | 0.689 | 0.564 | 0.973 | 6.0 | 6.0 | 0.328 | 5.0 | 77% | 1.56 | 6.6 | 0.017 | 141 |
| Whole Tone / V/C verse-chorus | 30 | 0.739 | 0.739 | 0.776 | 0.660 | 0.644 | 0.696 | 0.876 | 6.0 | 6.0 | 0.370 | 5.0 | 73% | 1.46 | 5.9 | 0.235 | 68 |
| Whole Tone / full arrangement | 30 | 0.758 | 0.802 | 0.760 | 0.731 | 0.670 | 0.663 | 0.883 | 6.0 | 6.0 | 0.376 | 5.0 | 83% | 1.48 | 8.3 | 0.317 | 111 |
| Whole Tone / irregular lengths | 30 | 0.766 | 0.833 | 0.750 | n/a | 0.708 | 0.642 | 0.862 | 6.0 | 6.0 | 0.375 | 5.5 | 77% | 1.72 | 7.2 | 0.187 | 107 |
| Diminished (Half-Whole) / V/C verse-chorus | 30 | 0.705 | 0.676 | 0.785 | 0.556 | 0.647 | 0.526 | 0.905 | 6.0 | 6.0 | 0.391 | 4.9 | 70% | 1.11 | 7.6 | 0.151 | 64 |
| Diminished (Half-Whole) / full arrangement | 30 | 0.729 | 0.745 | 0.776 | 0.660 | 0.660 | 0.549 | 0.918 | 6.0 | 6.0 | 0.358 | 5.0 | 83% | 1.22 | 9.4 | 0.177 | 108 |
| Diminished (Half-Whole) / irregular lengths | 30 | 0.732 | 0.771 | 0.719 | n/a | 0.697 | 0.504 | 0.876 | 6.0 | 6.0 | 0.349 | 5.2 | 77% | 1.40 | 8.4 | 0.091 | 103 |
| Diminished (Whole-Half) / V/C verse-chorus | 30 | 0.711 | 0.660 | 0.753 | 0.588 | 0.632 | 0.636 | 0.921 | 6.0 | 6.0 | 0.363 | 4.4 | 83% | 1.34 | 8.0 | 0.136 | 69 |
| Diminished (Whole-Half) / full arrangement | 30 | 0.738 | 0.725 | 0.788 | 0.685 | 0.644 | 0.633 | 0.918 | 6.0 | 6.0 | 0.348 | 4.8 | 87% | 1.41 | 10.4 | 0.191 | 113 |
| Diminished (Whole-Half) / irregular lengths | 30 | 0.743 | 0.753 | 0.772 | n/a | 0.680 | 0.563 | 0.909 | 6.0 | 6.0 | 0.346 | 5.4 | 83% | 1.55 | 9.2 | 0.086 | 108 |
| key C Aeolian / V/C verse-chorus | 30 | 0.671 | 0.563 | 0.752 | 0.543 | 0.565 | 0.602 | 0.985 | 6.0 | 6.0 | 0.341 | 4.7 | 83% | 1.26 | 6.0 | 0.027 | 97 |
| key C# Aeolian / V/C verse-chorus | 30 | 0.681 | 0.592 | 0.783 | 0.565 | 0.569 | 0.599 | 0.978 | 6.0 | 6.0 | 0.339 | 4.5 | 63% | 1.26 | 5.9 | 0.032 | 99 |
| key D Aeolian / V/C verse-chorus | 30 | 0.677 | 0.556 | 0.775 | 0.580 | 0.573 | 0.609 | 0.982 | 6.0 | 6.0 | 0.344 | 4.8 | 70% | 1.27 | 6.0 | 0.022 | 98 |
| key D# Aeolian / V/C verse-chorus | 30 | 0.679 | 0.574 | 0.748 | 0.603 | 0.568 | 0.618 | 0.979 | 6.0 | 6.0 | 0.344 | 4.3 | 70% | 1.30 | 5.9 | 0.021 | 97 |
| key E Aeolian / V/C verse-chorus | 30 | 0.671 | 0.552 | 0.763 | 0.587 | 0.555 | 0.589 | 0.975 | 6.0 | 6.0 | 0.345 | 5.1 | 80% | 1.24 | 5.5 | 0.018 | 99 |
| key F Aeolian / V/C verse-chorus | 30 | 0.673 | 0.566 | 0.784 | 0.585 | 0.548 | 0.591 | 0.981 | 6.0 | 6.0 | 0.347 | 5.0 | 77% | 1.25 | 5.8 | 0.021 | 98 |
| key F# Aeolian / V/C verse-chorus | 30 | 0.668 | 0.569 | 0.747 | 0.551 | 0.562 | 0.588 | 0.983 | 6.0 | 6.0 | 0.339 | 4.9 | 80% | 1.25 | 5.7 | 0.020 | 97 |
| key G Aeolian / V/C verse-chorus | 30 | 0.674 | 0.563 | 0.732 | 0.575 | 0.558 | 0.633 | 0.970 | 6.0 | 6.0 | 0.349 | 4.9 | 83% | 1.33 | 5.6 | 0.018 | 98 |
| key G# Aeolian / V/C verse-chorus | 30 | 0.680 | 0.587 | 0.771 | 0.612 | 0.569 | 0.589 | 0.982 | 6.0 | 6.0 | 0.346 | 4.5 | 70% | 1.23 | 5.7 | 0.016 | 98 |
| key A Aeolian / V/C verse-chorus | 30 | 0.673 | 0.563 | 0.779 | 0.627 | 0.549 | 0.572 | 0.977 | 6.0 | 6.0 | 0.347 | 4.9 | 70% | 1.21 | 5.8 | 0.011 | 100 |
| key A# Aeolian / V/C verse-chorus | 30 | 0.683 | 0.579 | 0.776 | 0.625 | 0.571 | 0.598 | 0.964 | 6.0 | 6.0 | 0.346 | 4.7 | 70% | 1.26 | 6.0 | 0.032 | 97 |
| key B Aeolian / V/C verse-chorus | 30 | 0.682 | 0.576 | 0.784 | 0.615 | 0.566 | 0.604 | 0.974 | 6.0 | 6.0 | 0.343 | 4.4 | 73% | 1.27 | 5.7 | 0.026 | 97 |
| settings complexity=1, borrowing=none | 30 | 0.670 | 0.576 | 0.767 | 0.584 | 0.547 | 0.599 | 1.000 | 6.0 | 6.0 | 0.320 | 4.6 | 77% | 1.26 | 5.4 | 0.000 | 33 |
| settings complexity=2, borrowing=none | 30 | 0.672 | 0.576 | 0.767 | 0.584 | 0.547 | 0.599 | 1.000 | 6.0 | 6.0 | 0.320 | 4.6 | 77% | 1.26 | 5.4 | 0.000 | 33 |
| settings complexity=3, borrowing=none | 30 | 0.670 | 0.576 | 0.767 | 0.584 | 0.547 | 0.599 | 1.000 | 6.0 | 6.0 | 0.320 | 4.6 | 77% | 1.26 | 5.4 | 0.000 | 33 |
| settings complexity=2, borrowing=some | 30 | 0.671 | 0.552 | 0.763 | 0.587 | 0.555 | 0.589 | 0.975 | 6.0 | 6.0 | 0.345 | 5.1 | 80% | 1.24 | 5.5 | 0.018 | 98 |
| settings complexity=3, borrowing=more | 30 | 0.677 | 0.581 | 0.751 | 0.581 | 0.585 | 0.609 | 0.939 | 6.0 | 6.0 | 0.373 | 4.6 | 73% | 1.29 | 6.4 | 0.089 | 104 |
| settings density=0 | 30 | 0.687 | 0.587 | 0.755 | 0.652 | 0.572 | 0.561 | 0.988 | 6.0 | 6.0 | 0.360 | 4.3 | 67% | 0.63 | 4.7 | 0.020 | 58 |
| settings density=2 | 30 | 0.689 | 0.566 | 0.803 | 0.547 | 0.547 | 0.818 | 0.955 | 6.0 | 6.0 | 0.338 | 5.3 | 80% | 3.51 | 7.2 | 0.024 | 183 |

Column glossary: `total` = selected candidate’s heuristic song fit (selection signal only); `sig` = mean distinct structural signatures among candidates; `div` = mean pairwise structural distance; `competit.` = mean competitive-set size; `picked≠top` = share of runs where the seeded pick was not the top-ranked candidate (§15 variation behavior); `cpb` = structural changes per bar (objective); `roots` = distinct foundation roots (objective); `chromShare` = duration share of non-diatonic foundations (objective); `ms` = wall-clock per evaluated generation.

## Performance (measured, §18)

- Typical 40-bar verse/chorus project: mean 98 ms, median 98 ms, max 120 ms per evaluated generation (6 candidates).
- 200-bar arrangement: mean 132 ms, median 131 ms, max 136 ms.
- Targets (§18): < 150 ms typical, < 500 ms at 200 bars — MET.

## Candidate comparison samples

### Aeolian · V/C verse-chorus · seed 1

Selected (1 of 6 candidates; signatures: 37-foundations, 38-foundations, 42-foundations, 43-foundations, 26-foundations, 38-foundations):

```text
Em7 → Bsus4 → C → Bm7 → G → C → EmMaj7 → Bm → Gmaj7 → Cmaj7 → Gmaj7 → Bm → Bm7 → Gmaj7 → C → Bsus4 → Csus2 → Bm7 → G → Em7 → C7b5 → Em7 → Bsus4 → C7 → Bm → Gmaj7 → C → Em → Bm → G7 → Cmaj7 → G7 → Bm → Cmaj7 → G → Bm → Cmaj7 → G → Bm
```

| seed | rank | total | signature (foundations in order) |
|---|---|---|---|
| 1 | 4 | 0.641 | E minor → C major → D major → G major → C major → E minor → G major → C major → G suspended → E minor → G major → B minor → G major → E minor → A minor → G major → B minor → D major → G suspended → E minor → C major → D major → G major → C major → E minor → G major → C major → G suspended → E minor → G major → B minor → E minor → G major → B minor → E minor → G major → B minor |
| 679982870 | 1 | 0.668 | E minor → G major → C major → E minor → B minor → B suspended → C major → D major → G major → Ab diminished → E minor → G major → C major → A minor → D major → G major → B minor → C suspended → D major → Bb other[D,E,Bb] → E minor → F diminished → G major → C major → F diminished → G major → C major → D major → G major → Ab diminished → E minor → G major → C major → E minor → G major → C major → E minor → C major |
| 3966669547 | 0 | 0.674 | E minor → G major → C major → E minor → E suspended → C major → D major → G major → B minor → C other[C,E,F#] → E minor → C major → G major → B minor → C suspended → G major → C major → B suspended → E minor → B minor → G suspended → E minor → G major → E suspended → C major → E minor → E suspended → C major → D major → G major → B minor → C other[C,E,F#] → E minor → C major → G major → B minor → E minor → C major → G major → B minor → C major → B minor |
| 3372649744 | 3 | 0.644 | E minor → C major → E suspended → G major → C major → E minor → B minor → G major → C suspended → G suspended → D major → B minor → G major → C suspended → D major → B minor → G suspended → D major → C suspended → B minor → G suspended → E minor → C major → A suspended → E suspended → G major → C major → E minor → B minor → G major → C suspended → G suspended → D major → Bb other[D,E,Bb] → G major → C suspended → Bb other[D,E,Bb] → G major → C suspended → D major → Bb other[D,E,Bb] → G major → C suspended |
| 2405945829 | 5 | 0.596 | E minor → G major → C major → G major → B minor → B suspended → E minor → C major → G major → B minor → C suspended → E minor → G major → C major → G major → B minor → B suspended → E minor → C major → G major → B minor → B suspended → E minor → C major → G major → B minor |
| 4226520066 ✅ | 2 | 0.662 | E minor → B suspended → C major → B minor → G major → C major → E minor → B minor → G major → C major → G major → B minor → G major → C major → B suspended → C suspended → B minor → G major → E minor → C other[C,E,F#] → E minor → B suspended → C major → B minor → G major → C major → E minor → B minor → G major → C major → G major → B minor → C major → G major → B minor → C major → G major → B minor |

### Aeolian · V/C verse-chorus · seed 7

Selected (1 of 6 candidates; signatures: 39-foundations, 36-foundations, 35-foundations, 48-foundations, 41-foundations, 43-foundations):

```text
Em → Cmaj7 → Gmaj7 → Bm7 → Em → Cmaj7 → C#m → Dmaj7 → G → C7 → C#m7b5 → Em7 → Bsus4 → Cmaj7 → G → Csus2 → Gmaj7 → C → D → Gsus2 → G → Csus2 → Em7 → Cmaj7 → Gmaj7 → Bm7 → Esus4 → Em → C7 → C#m → D7 → Gmaj7 → Cmaj7 → C#m7b5 → Em → Bsus4 → C7 → Gmaj7 → Csus2 → Em → Bsus4 → C7 → Gmaj7 → Csus2 → Em → Bsus4 → G → Csus2
```

| seed | rank | total | signature (foundations in order) |
|---|---|---|---|
| 7 | 1 | 0.686 | E minor → C major → B minor → G major → C suspended → G major → C major → A minor → B minor → G major → C suspended → E suspended → B minor → G major → C major → E minor → G major → D major → G suspended → E minor → C major → B minor → G major → C suspended → E minor → C major → B minor → G major → C suspended → G major → C suspended → E suspended → B minor → G major → C major → E minor → G major → D major → G suspended |
| 713538108 | 2 | 0.686 | E minor → B minor → G major → C major → G suspended → B minor → G major → C suspended → E minor → C major → B minor → E minor → C major → B suspended → G major → E minor → C major → G suspended → E minor → B minor → G major → C major → G suspended → B minor → G major → C suspended → E minor → C major → B minor → E minor → C major → B suspended → G major → E minor → C major → G suspended |
| 4067335261 | 3 | 0.684 | E minor → B minor → C suspended → G major → E minor → C major → B minor → E suspended → B suspended → C major → A minor → C major → B suspended → G major → E minor → C major → D major → G major → C suspended → E minor → B minor → C suspended → E minor → B minor → C suspended → C major → A minor → C major → B suspended → G major → E minor → C major → D major → G major → C suspended |
| 3473315458 ✅ | 0 | 0.689 | E minor → C major → G major → B minor → E minor → C major → C# minor → D major → G major → C major → C# diminished → E minor → B suspended → C major → G major → C suspended → G major → C major → D major → G suspended → G major → C suspended → E minor → C major → G major → B minor → E suspended → E minor → C major → C# minor → D major → G major → C major → C# diminished → E minor → B suspended → C major → G major → C suspended → E minor → B suspended → C major → G major → C suspended → E minor → B suspended → G major → C suspended |
| 2305280115 | 5 | 0.672 | E minor → G major → C major → B minor → G major → E minor → C major → G major → B minor → D major → E minor → B minor → G major → C major → A minor → E suspended → B suspended → E minor → C major → D major → E minor → G major → C major → Eb other[Eb,G,A] → G major → E minor → C major → G major → B minor → D major → E minor → B minor → G major → C major → A minor → E suspended → B suspended → E minor → C major → D major → E minor |
| 4125854352 | 4 | 0.673 | E suspended → G major → C major → E minor → B suspended → G major → B minor → C major → E suspended → G major → C major → D major → B minor → G major → C major → E minor → B suspended → E minor → C major → A minor → E suspended → G major → C major → Bb diminished → E minor → B suspended → G major → B minor → C major → E suspended → G major → C major → D major → B minor → E suspended → G major → C major → D major → B minor → E suspended → G major → D major → B minor |

### Dorian · full arrangement · seed 1

Selected (1 of 6 candidates; signatures: 49-foundations, 51-foundations, 45-foundations, 56-foundations, 45-foundations, 50-foundations):

```text
Em7 → G7 → Gsus2 → Gmaj7 → Amaj7 → Bm7 → Bm → Dmaj7 → F#m7 → Gmaj7 → Dsus4 → Gsus2 → F#m7 → D → Gmaj7 → Em7 → G7 → F#m → D → Bm7 → Bm → G → Em → F#m → Dmaj7 → G7b5 → F#m7 → G7 → Csus2 → C#m7b5 → Dmaj7 → Gsus2 → Dsus4 → Em7 → Bsus4 → F#m7 → Bm → G7 → Dmaj7 → Bm7 → Gsus2 → Em7 → Gmaj7 → F#m → Ebm7 → Bm → EmMaj7 → G → F#m7 → Ebm7 → Bm7 → F#m7 → G → G7
```

| seed | rank | total | signature (foundations in order) |
|---|---|---|---|
| 1 | 3 | 0.665 | E minor → G major → D major → B minor → G major → A major → E suspended → G major → F# minor → D major → G major → B minor → F# minor → A major → D major → G major → B minor → A major → F# minor → G suspended → Ab diminished → A suspended → Bb diminished → B minor → G major → D major → G major → Eb major → E minor → C major → G suspended → B minor → G major → C suspended → E suspended → G major → F# minor → E suspended → G major → F# minor → D major → G major → B minor → A major → F# minor → G suspended → E minor → A major → G suspended |
| 679982870 ✅ | 0 | 0.711 | E minor → G major → G suspended → G major → A major → B minor → D major → F# minor → G major → D suspended → G suspended → F# minor → D major → G major → E minor → G major → F# minor → D major → B minor → G major → E minor → F# minor → D major → G other[C#,G,B] → F# minor → G major → C suspended → C# diminished → D major → G suspended → D suspended → E minor → B suspended → F# minor → B minor → G major → D major → B minor → G suspended → E minor → G major → F# minor → Eb minor → B minor → E minor → G major → F# minor → Eb minor → B minor → F# minor → G major |
| 3966669547 | 4 | 0.630 | E minor → G major → D major → D suspended → B minor → G major → D suspended → D major → G major → B minor → F# suspended → B suspended → F# minor → D major → E minor → B minor → G major → B minor → A major → D major → F# minor → G major → E minor → B minor → G suspended → A major → Bb minor → F# minor → G major → E minor → C major → G suspended → D major → G major → E minor → B minor → A major → D suspended → E minor → B minor → E minor → B minor → G suspended → G major → A major |
| 3372649744 | 1 | 0.707 | E minor → A major → D major → G major → E suspended → F# minor → G major → E minor → B minor → G major → E minor → A major → F# minor → B minor → F# minor → D major → B minor → G major → F# minor → D suspended → G suspended → F# minor → D major → B minor → G major → B minor → G major → Ab diminished → F# minor → D major → G suspended → D suspended → E minor → B minor → G major → D suspended → G suspended → B minor → E minor → G major → D major → G suspended → B minor → F# minor → D major → B minor → F# minor → D major → B minor → G suspended → F# minor → D major → B minor → G major → A major → E minor |
| 2405945829 | 5 | 0.629 | E minor → E suspended → B minor → G major → A major → D major → F# minor → D major → B minor → G major → B minor → E suspended → B minor → G major → B minor → G major → E minor → B minor → C suspended → C# diminished → D major → G minor → B minor → F# minor → D major → G major → B minor → E minor → C major → G suspended → F# minor → D major → G major → B minor → F# suspended → E suspended → B minor → G major → B minor → G major → E minor → Bb other[D,E,Bb] → B minor → G major → D major |
| 4226520066 | 2 | 0.705 | E minor → G major → B minor → G major → E minor → G other[C#,G,B] → F# minor → D major → G major → E minor → B minor → E suspended → B minor → D major → B minor → G major → A major → D suspended → A suspended → D major → F# minor → G major → B minor → G suspended → Ab diminished → G major → C suspended → C# diminished → D suspended → G major → B minor → A major → E minor → B minor → F# minor → D major → A major → D suspended → E suspended → B minor → E suspended → B minor → D major → F# minor → G major → B minor → G suspended → F# minor → E minor → G major |

### Whole Tone · V/C verse-chorus · seed 1

Selected (1 of 6 candidates; signatures: 46-foundations, 54-foundations, 48-foundations, 35-foundations, 29-foundations, 44-foundations):

```text
Eaug → Am7 → Caug7 → Abaug7 → Eaug7 → Am7 → Dsus2 → Caug7 → Ab7b5 → Eaug → Abaug → E7b5 → Am7 → Eaug7 → Caug7 → C#m → A → Bb7b5 → Eaug → Abaug → Caug → Abaug7 → Am7 → Caug7 → A → Eaug7 → Am → Ab7b5 → Abaug → Eaug → Am7 → Dsus2 → Dsus2 → Caug7 → Ab7b5 → Eaug → Abaug → E7b5 → Am7 → Eaug7 → Caug → C#m7 → A7 → Eaug → Caug7 → C#m → Amaj7 → Caug → A7
```

| seed | rank | total | signature (foundations in order) |
|---|---|---|---|
| 1 | 4 | 0.692 | E augmented → C augmented → Ab augmented → E augmented → A minor → C other[C,E,F#] → C augmented → E augmented → A minor → Ab augmented → A major → E suspended → C augmented → C other[C,E,F#] → Ab augmented → E augmented → Ab augmented → E other[E,Ab,Bb] → C augmented → A minor → C other[C,E,F#] → Ab augmented → C augmented → A minor → E augmented → C augmented → Ab augmented → E augmented → A minor → C other[C,E,F#] → C augmented → E augmented → A minor → Ab augmented → A major → E suspended → C augmented → C other[C,E,F#] → Ab augmented → C augmented → C other[C,E,F#] → Ab augmented → E suspended → C augmented → C other[C,E,F#] → Ab augmented |
| 679982870 | 1 | 0.722 | E augmented → Ab augmented → C# minor → E other[E,Ab,Bb] → Ab augmented → C augmented → E augmented → C other[C,E,F#] → E augmented → C augmented → Ab augmented → E other[E,Ab,Bb] → A suspended → E other[E,Ab,Bb] → C augmented → Ab augmented → C other[C,E,F#] → E augmented → Ab other[C,D,Ab] → C# minor → A minor → Ab augmented → C augmented → Ab other[C,D,Ab] → C augmented → F major → E augmented → F diminished → Ab augmented → C# minor → F diminished → Ab augmented → C# minor → E augmented → C augmented → Ab augmented → E other[E,Ab,Bb] → A suspended → E other[E,Ab,Bb] → C augmented → Ab augmented → C other[C,E,F#] → E augmented → Ab other[C,D,Ab] → C# minor → A minor → E other[E,Ab,Bb] → Ab augmented → C other[C,E,F#] → E augmented → C major → A minor → Ab augmented → C# minor |
| 3966669547 ✅ | 0 | 0.761 | E augmented → A minor → C augmented → Ab augmented → E augmented → A minor → D suspended → C augmented → Ab other[C,D,Ab] → E augmented → Ab augmented → E other[E,Ab,Bb] → A minor → E augmented → C augmented → C# minor → A major → Bb other[D,E,Bb] → E augmented → Ab augmented → C augmented → Ab augmented → A minor → C augmented → A major → E augmented → A minor → Ab other[C,D,Ab] → Ab augmented → E augmented → A minor → D suspended → C augmented → Ab other[C,D,Ab] → E augmented → Ab augmented → E other[E,Ab,Bb] → A minor → E augmented → C augmented → C# minor → A major → E augmented → C augmented → C# minor → A major → C augmented → A major |
| 3372649744 | 2 | 0.721 | E augmented → C augmented → Ab augmented → E augmented → A minor → C augmented → E augmented → C other[C,E,F#] → Ab augmented → A minor → E augmented → C augmented → Ab augmented → C other[C,E,F#] → Ab augmented → E augmented → A minor → E augmented → C augmented → C suspended → Ab augmented → E augmented → A minor → C augmented → E augmented → C other[C,E,F#] → Ab augmented → A diminished → A minor → Ab augmented → A diminished → A minor → Ab augmented → A diminished → A minor |
| 2405945829 | 5 | 0.661 | E other[E,Ab,Bb] → Ab augmented → C augmented → E augmented → A major → E augmented → Ab augmented → A minor → E augmented → C other[C,E,F#] → A minor → E augmented → C augmented → Ab augmented → A major → E other[E,Ab,Bb] → Ab augmented → C augmented → E augmented → A major → E augmented → Ab augmented → A minor → E augmented → C other[C,E,F#] → A minor → E augmented → C other[C,E,F#] → A minor |
| 4226520066 | 3 | 0.714 | E augmented → Ab augmented → E other[E,Ab,Bb] → C augmented → A minor → C other[C,E,F#] → Ab augmented → E augmented → C augmented → Ab other[C,D,Ab] → Ab augmented → C augmented → C# minor → E augmented → C augmented → A minor → Ab augmented → E other[E,Ab,Bb] → Ab augmented → E augmented → C augmented → C# minor → E augmented → Ab augmented → E other[E,Ab,Bb] → C augmented → A minor → C other[C,E,F#] → Ab augmented → E augmented → C augmented → Ab other[C,D,Ab] → Ab augmented → C augmented → C# minor → E augmented → C augmented → A minor → E augmented → C augmented → A minor → E augmented → C augmented → A minor |

## Next step (mandated by the Phase 5 spec)

Comprehensive HUMAN listening review of the completed generator, followed by targeted corrections. The evaluator’s weights (documented in `src/engine/harmony/evaluation.ts` as calibration heuristics) exist to be adjusted against what listeners actually prefer — not to certify the output.

