# Phase 11.6 notes

Status: 11.6a, 11.6b, 11.6c, and 11.6d-1 are complete; later 11.6d work remains.

## Decisions
- Vocalbacking harp velocity allowance: mean absolute delta ≤ 3; maximum absolute delta ≤ 10.
- Piano absorption derives caps from original velocities and applies the strictest overlap once per note.
- Keep `golden106` stale until step 5; do not refresh it early.
- 11.6c adds arrivals, restrained punctuation, power/repeated-chord beds and repair reports; final-timing repair preserves RH 11/13 guards and uses a chord-tone fallback only when every root/fifth option causes a hard octave.
- Verification: typecheck and serial suite passed (60 files / 1,029 tests); focused Phase 11.6c, Phase 8, sanitizer and MIDI-export checks passed.
- 11.6d-1: chamber/sonata only; diatonic monophonic answers in Violin1 rest windows, one per four-bar phrase, capped at 15% of piano bars.
- Seed 11, three-chorus, takes 1–20: 53/54 planned echo lines; 53/50 complete, 8.02%/7.95% of piano bars; no lone chopped notes or lead overlaps.
- Forbidden-template answers 0; collision, sanitizer, RH11/13, hard-finding, and aboveMax checks clean; plan/log role counts present in 120/120 runs.
- Golden105 vocalbacking harp velocity deltas: mean 1.78, max 10 across the paired 20-fixture corpus.
Next: await direction; do not start scale run, register shift, or step 5.
