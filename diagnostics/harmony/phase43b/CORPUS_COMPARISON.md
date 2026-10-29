# Phase 4.3B — Corpus comparison (before → after harmonic continuation)

Baseline: `baseline-4.3a` · Corrected: `corrected-4.3b` · 20 seeds × 6 contexts, Verse-Chorus (8+8), complexity 2, borrowing `some`, variation 0.5. Slot-unit metrics are computed identically for both versions (see script header).

| Context | Metric | before | after | Δ |
|---|---|---|---|---|
| E Aeolian | structural changes / run | 27.6 | 16.9 | -10.65 |
| E Aeolian | continuations (holds) / run | 3.4 | 14.1 | +10.65 |
| E Aeolian | continuation fraction of opportunities | 11.0% | 45.3% | +34.4% |
| E Aeolian | mean chord duration (ticks) | 2152 | 3410 | +1258.65 |
| E Aeolian | harmonic activity (changes/opportunity) | 0.890 | 0.547 | -0.34 |
| E Aeolian | tonic-root fraction (structural) | 21.1% | 21.8% | +0.7% |
| E Aeolian | tonic-reinforcing fraction | 59.9% | 63.3% | +3.4% |
| E Aeolian | first chord tonic-rooted | 100.0% | 100.0% | — |
| E Aeolian | cadence realization rate | 90.1% | 100.0% | +9.9% |
| E Aeolian | chromatic foundation fraction | 2.4% | 1.0% | -1.4% |
| E Aeolian | distinct roots / phrase | 4.56 | 3.47 | -1.09 |
| E Aeolian | sustained events / run | 3.4 | 7.5 | +4.10 |
| E Aeolian | color-variation transitions | 1 | 15 | +14.00 |
| E Aeolian | generation failures | 0 | 0 | — |
| E Aeolian | cross-phrase sustains (total) | 17 | 33 | +16.00 |
| E Aeolian | max sustained run (slots, any seed) | 2 | 12 | +10.00 |
| E Aeolian | determinism (all seeds) | true | true | |
| D Dorian | structural changes / run | 28.6 | 14.8 | -13.75 |
| D Dorian | continuations (holds) / run | 2.4 | 16.1 | +13.75 |
| D Dorian | continuation fraction of opportunities | 7.7% | 52.1% | +44.4% |
| D Dorian | mean chord duration (ticks) | 2077 | 3872 | +1795.00 |
| D Dorian | harmonic activity (changes/opportunity) | 0.923 | 0.479 | -0.44 |
| D Dorian | tonic-root fraction (structural) | 17.3% | 21.9% | +4.6% |
| D Dorian | tonic-reinforcing fraction | 40.0% | 49.3% | +9.3% |
| D Dorian | first chord tonic-rooted | 100.0% | 100.0% | — |
| D Dorian | cadence realization rate | 90.1% | 100.0% | +9.9% |
| D Dorian | chromatic foundation fraction | 2.1% | 3.0% | +0.9% |
| D Dorian | distinct roots / phrase | 4.88 | 3.34 | -1.53 |
| D Dorian | sustained events / run | 2.3 | 6.3 | +4.05 |
| D Dorian | color-variation transitions | 1 | 15 | +14.00 |
| D Dorian | generation failures | 0 | 0 | — |
| D Dorian | cross-phrase sustains (total) | 15 | 40 | +25.00 |
| D Dorian | max sustained run (slots, any seed) | 3 | 15 | +12.00 |
| D Dorian | determinism (all seeds) | true | true | |
| C Ionian | structural changes / run | 29.1 | 16.3 | -12.75 |
| C Ionian | continuations (holds) / run | 1.9 | 14.7 | +12.75 |
| C Ionian | continuation fraction of opportunities | 6.3% | 47.4% | +41.1% |
| C Ionian | mean chord duration (ticks) | 2047 | 3658 | +1611.10 |
| C Ionian | harmonic activity (changes/opportunity) | 0.937 | 0.526 | -0.41 |
| C Ionian | tonic-root fraction (structural) | 28.3% | 27.9% | -0.4% |
| C Ionian | tonic-reinforcing fraction | 67.2% | 71.9% | +4.8% |
| C Ionian | first chord tonic-rooted | 100.0% | 100.0% | — |
| C Ionian | cadence realization rate | 90.1% | 100.0% | +9.9% |
| C Ionian | chromatic foundation fraction | 1.9% | 1.3% | -0.5% |
| C Ionian | distinct roots / phrase | 4.45 | 3.38 | -1.07 |
| C Ionian | sustained events / run | 1.9 | 6.2 | +4.20 |
| C Ionian | color-variation transitions | 0 | 8 | +8.00 |
| C Ionian | generation failures | 0 | 0 | — |
| C Ionian | cross-phrase sustains (total) | 11 | 37 | +26.00 |
| C Ionian | max sustained run (slots, any seed) | 2 | 14 | +12.00 |
| C Ionian | determinism (all seeds) | true | true | |
| D Phrygian | structural changes / run | 27.8 | 15.8 | -12.05 |
| D Phrygian | continuations (holds) / run | 3.2 | 15.3 | +12.05 |
| D Phrygian | continuation fraction of opportunities | 10.3% | 49.2% | +38.9% |
| D Phrygian | mean chord duration (ticks) | 2138 | 3704 | +1566.25 |
| D Phrygian | harmonic activity (changes/opportunity) | 0.897 | 0.508 | -0.39 |
| D Phrygian | tonic-root fraction (structural) | 26.9% | 31.7% | +4.8% |
| D Phrygian | tonic-reinforcing fraction | 68.3% | 75.3% | +7.0% |
| D Phrygian | first chord tonic-rooted | 100.0% | 100.0% | — |
| D Phrygian | cadence realization rate | 90.1% | 100.0% | +9.9% |
| D Phrygian | chromatic foundation fraction | 2.6% | 2.3% | -0.3% |
| D Phrygian | distinct roots / phrase | 4.87 | 3.40 | -1.48 |
| D Phrygian | sustained events / run | 3.1 | 6.7 | +3.55 |
| D Phrygian | color-variation transitions | 0 | 6 | +6.00 |
| D Phrygian | generation failures | 0 | 0 | — |
| D Phrygian | cross-phrase sustains (total) | 14 | 35 | +21.00 |
| D Phrygian | max sustained run (slots, any seed) | 3 | 15 | +12.00 |
| D Phrygian | determinism (all seeds) | true | true | |
| C Whole Tone | structural changes / run | 29.9 | 21.8 | -8.05 |
| C Whole Tone | continuations (holds) / run | 1.1 | 9.2 | +8.05 |
| C Whole Tone | continuation fraction of opportunities | 3.7% | 29.7% | +26.0% |
| C Whole Tone | mean chord duration (ticks) | 1993 | 2725 | +732.15 |
| C Whole Tone | harmonic activity (changes/opportunity) | 0.963 | 0.703 | -0.26 |
| C Whole Tone | tonic-root fraction (structural) | 29.5% | 30.4% | +0.9% |
| C Whole Tone | tonic-reinforcing fraction | 92.1% | 93.4% | +1.3% |
| C Whole Tone | first chord tonic-rooted | 100.0% | 100.0% | — |
| C Whole Tone | cadence realization rate | 89.0% | 100.0% | +11.0% |
| C Whole Tone | chromatic foundation fraction | 24.9% | 24.5% | -0.4% |
| C Whole Tone | distinct roots / phrase | 4.30 | 3.76 | -0.54 |
| C Whole Tone | sustained events / run | 1.1 | 6.0 | +4.90 |
| C Whole Tone | color-variation transitions | 0 | 2 | +2.00 |
| C Whole Tone | generation failures | 0 | 0 | — |
| C Whole Tone | cross-phrase sustains (total) | 13 | 29 | +16.00 |
| C Whole Tone | max sustained run (slots, any seed) | 3 | 5 | +2.00 |
| C Whole Tone | determinism (all seeds) | true | true | |
| D Diminished (Whole-Half) | structural changes / run | 29.3 | 17.6 | -11.65 |
| D Diminished (Whole-Half) | continuations (holds) / run | 1.8 | 13.4 | +11.65 |
| D Diminished (Whole-Half) | continuation fraction of opportunities | 5.6% | 43.2% | +37.6% |
| D Diminished (Whole-Half) | mean chord duration (ticks) | 2034 | 3401 | +1367.40 |
| D Diminished (Whole-Half) | harmonic activity (changes/opportunity) | 0.944 | 0.568 | -0.38 |
| D Diminished (Whole-Half) | tonic-root fraction (structural) | 17.9% | 20.3% | +2.4% |
| D Diminished (Whole-Half) | tonic-reinforcing fraction | 73.9% | 77.6% | +3.7% |
| D Diminished (Whole-Half) | first chord tonic-rooted | 100.0% | 100.0% | — |
| D Diminished (Whole-Half) | cadence realization rate | 89.0% | 100.0% | +11.0% |
| D Diminished (Whole-Half) | chromatic foundation fraction | 8.9% | 14.1% | +5.3% |
| D Diminished (Whole-Half) | distinct roots / phrase | 5.27 | 3.83 | -1.45 |
| D Diminished (Whole-Half) | sustained events / run | 1.7 | 6.0 | +4.35 |
| D Diminished (Whole-Half) | color-variation transitions | 0 | 3 | +3.00 |
| D Diminished (Whole-Half) | generation failures | 0 | 0 | — |
| D Diminished (Whole-Half) | cross-phrase sustains (total) | 11 | 34 | +23.00 |
| D Diminished (Whole-Half) | max sustained run (slots, any seed) | 3 | 14 | +11.00 |
| D Diminished (Whole-Half) | determinism (all seeds) | true | true | |
