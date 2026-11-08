# Phase 11.6 notes

Status: 11.6a, 11.6b, and 11.6c are complete; 11.6d remains.

## Decisions
- Vocalbacking harp velocity allowance: mean absolute delta ≤ 3; maximum absolute delta ≤ 10.
- Piano absorption derives caps from original velocities and applies the strictest overlap once per note.
- Keep `golden106` stale until step 5; do not refresh it early.
- 11.6c adds arrivals, restrained punctuation, power/repeated-chord beds and repair reports; final-timing repair preserves RH 11/13 guards and uses a chord-tone fallback only when every root/fifth option causes a hard octave.
- Verification: typecheck and serial suite passed (60 files / 1,029 tests); focused Phase 11.6c, Phase 8, sanitizer and MIDI-export checks passed.
Next: 11.6d, then step 5.
