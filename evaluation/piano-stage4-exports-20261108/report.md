# Piano Stage 4 seed exports

Fresh Piano-only MIDI exports from the current Composer → PianoScore →
Realizer → MIDI path. These files were added under a new directory so no
existing musical-audit artifacts were replaced.

| Seed | Composer score events | Piano notes | MIDI size | SHA-256 |
|---:|---:|---:|---:|---|
| 11 | 114 | 114 | 1,562 bytes | `6fd66b47b7cdfcbf71a456d3d240aed8ec26b6112d0e2c60beaf2716d5a8c2a7` |
| 29 | 112 | 112 | 1,538 bytes | `8dd7e30301bfb50ccdf7ed1e1fdf6ef6152351bf8701b5bb1cc1593041a953aa` |
| 47 | 106 | 106 | 1,487 bytes | `fbd67e5e9ecde3071230b95def14d11635367168d46a3fb9b391b6284339917b` |

**Shared settings:** `fixtures/three-chorus-40bars.json`, `ensemble.chamber`,
seed as listed, density `1`, moments disabled, orchestration take `0`. Each
Standard MIDI File is Type 1 at 960 PPQ with a conductor track and exactly one
instrument track (Piano). Every export was parsed back and its Piano note
count matched the realized track.

These three ordinary production runs did not select the new optional Alberti,
walking-bass, ostinato, motif-anticipation, or octave-reinforcement events.
That is an observed result for these settings/seeds, not a failure: the
accompaniment figures require low-register evidence and other context gates,
and the upper-line gestures are similarly conditional. The Stage 4 forced-
context tests verify that the relevant score events can be emitted when their
eligibility evidence is present.

No WAV/audio render or listening audition was produced; only score/MIDI
structure was checked.
