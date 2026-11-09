# Phase 8 — piano follow-through

**Result:** the Composer/Realizer handoff, energy gate, Hybrid Studio rhythm update, separate Phase 8 tests, and updated MIDI exports are complete. This is a deterministic score/MIDI evaluation; no audio was rendered or auditioned.

## Before / after

| Template | Piano notes (Phase 7 → 8) | Planned suspensions complete | New attacks in zero-energy near-silence bar 8 |
|---|---:|---:|---:|
| Chamber | 24 → 23 | 1/1 → 1/1 | 2 → 0 |
| Sonata | 41 → 45 | 1/4 → 4/4 | 5 → 3* |
| Vocal Backing | 26 → 26 | 1/1 → 1/1 | 1 → 0 |
| Cinematic | 33 → 33 | 2/5 → 5/5 | 1 → 0 |
| Hybrid Studio | 24 → 25 | 1/1 → 1/1 | 2 → 1* |
| **Total** | **148 → 152** | **6/12 → 12/12** | **11 → 4** |

The restricted bar is `[26880, 30720)` ticks in these 4/4 examples. The gate is created only when the supplied bar is marked both near-silent and zero-energy. `*` Sonata’s three remaining onsets are explicitly authorized: a planned suspension resolution at tick 27360 and two selected `consider-brief-gesture` fill notes at 27725 and 29261. Hybrid Studio’s single onset at 27360 is its planned suspension resolution. Chamber’s `leave-space` decision suppresses all bar-8 attacks; it is not overridden. A note whose onset precedes a restricted window is retained even if its duration crosses into that window.

## What changed

- `realizePianoPlanWithAudit` now reports every Composer-planned suspension’s preparation, resolving-chord attack, completion, and explicit failure reasons; `realizePianoPlan` remains the notes-only wrapper. In the five deterministic examples all 12 planned suspensions now have a crossing preparation and an exact stepwise resolution within the resolving chord. Chained suspensions carry their resolution forward instead of losing the crossing voice during note normalization.
- Attack filtering runs before normalization. Only new attacks inside the supplied near-silence/zero-energy windows are gated; explicit suspension/fill intentions may pass, but `leave-space` takes priority. The separate tests also cover near-silence without zero energy, zero energy without near-silence, and preservation of pre-window note tails.
- Hybrid Studio retains its quarter-note anchor pulse and gains an explicit, motif-related chord-tone anticipation. The planned displacement is realized at tick 31200 in the chorus phrase, off the quarter-note grid; a separate answer remains quarter-aligned, providing rhythmic contrast. In this one sample, quarter-grid attacks are still common (23/25 versus 22/24 in Phase 7); the change is targeted rather than wholesale. A seed sweep over eight alternate Hybrid seeds also verified that the planned pickup survives octave-conflict revoicing. Other templates have no Hybrid-style syncopation plan.

## MIDI and arrangement checks

Each template folder contains the Phase 7 Composer piano MIDI for comparison, the legacy piano MIDI, the new piano-only export, a reference export without piano, and a combined Phase 8 export. The updated exports are Type 1, 960 PPQ, 100 BPM, 4/4, and end at tick 61440. Piano-only MIDI round-trips to the realized notes. Parsed non-piano notes, CC lanes, channels, and track data match the Phase 7 reference arrangement exactly; no non-piano part was rewritten.

The 4 new tests live in `tests/phase8-followthrough.test.ts`; the pre-existing `tests/phase8.test.ts` was not changed for this work. The full Composer plans, realized notes and suspension audits, verification records, MIDI hashes, and summary data are in this folder. See `manifest.json` and `analysis/summary.json` for the per-template figures.
