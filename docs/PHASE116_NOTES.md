# Phase 11.6 notes

Status at this note's snapshot: 11.6a, 11.6b, 11.6c, and 11.6d-1 were complete; later 11.6d work remained.

## Decisions
- Vocalbacking harp velocity allowance: mean absolute delta ≤ 3; maximum absolute delta ≤ 10.
- Piano absorption derives caps from original velocities and applies the strictest overlap once per note.
- Keep `golden106` stale until step 5; do not refresh it early.
- 11.6c adds arrivals, restrained punctuation, power/repeated-chord beds and repair reports; final-timing repair preserves RH 11/13 guards and uses a chord-tone fallback only when every root/fifth option causes a hard octave.
- Verification recorded in this note's snapshot: typecheck and serial suite passed (60 files / 1,029 tests); focused Phase 11.6c, Phase 8, sanitizer and MIDI-export checks passed. This note does not record that run's commit or tree ID.
- `PHASE116_REPORT.md` records a separate tested snapshot (`f333b7e8220207a64eeeb676bbf37626c8cb9e20`, tree `f0e8ebbd8c9648f6cb7239fec14c71d77c976df0`) with 60 files / 1,032 tests. Neither snapshot identifies the current dirty working tree.
- 11.6d-1: chamber/sonata only; diatonic monophonic answers in Violin1 rest windows, one per four-bar phrase, capped at 15% of piano bars.
- Seed 11, three-chorus, takes 1–20: 53/54 planned echo lines; 53/50 complete, 8.02%/7.95% of piano bars; no lone chopped notes or lead overlaps.
- Forbidden-template answers 0; collision, sanitizer, RH11/13, hard-finding, and aboveMax checks clean; plan/log role counts present in 120/120 runs.
- Golden105 vocalbacking harp velocity deltas: mean 1.78, max 10 across the paired 20-fixture corpus.
- 11.6d-2 item 2: piano-owned eight-note tail runs, harp-gliss bars excluded; targeted 20-run tests pass.
- 11.6d-2 item 3: one RH chord strike rises an octave in the last chorus at most; targeted 20-run tests pass.
Next steps recorded at this note's snapshot: item 4 report, full suite and final audits; do not start golden106 or the separate measurement-script step. The separate report snapshot above is documented in `PHASE116_REPORT.md`.
