# Phase 7 piano evaluation bundle

This folder contains five paired piano comparisons for the Dorian 16-bar fixture. It is an evaluation artifact only; no production source, legacy behavior, harp part, or non-piano arrangement was changed.

## MIDI exports

Each `exports/<template>/` folder contains:

- `legacy-piano.mid` — the piano part from the existing `composeAllTracks` path.
- `composer-v1-realizer-v1-piano.mid` — the new piano part, produced by `analyzePianoInput` → `composePianoPlan` → `realizePianoPlan`.
- `reference-without-piano.mid` — the active non-piano tracks from the same template-specific compose result.
- `combined-new-piano.mid` — those same non-piano tracks plus the new piano notes.

All are Type 1 MIDI at 960 PPQ and contain tempo, meter, and section-marker metadata. The exports preserve Crescode's existing MIDI-channel assignments and do not contain instrument program changes. See the report for duplicate-channel caveats and DAW setup notes.

## Reproducibility and audits

- `manifest.json` records the fixture, per-template deterministic seeds, source/input hashes, comparison fingerprints, MIDI hashes, and repeatability checks.
- `inputs/` contains the fixture, resolved template projects, templates, exact non-piano note/CC snapshots, and the piano-engine inputs.
- `analysis/` contains Composer plans, raw legacy/new piano note events, note statistics, and template-fit audits.
- `verification/` contains parsed MIDI round-trip checks for note data, CC data, channels, meter, tempo, markers, project endpoint, and event validity.

No audio was rendered, inspected, or listened to. `report.md` is therefore a score-level evaluation, not a listening verdict.
