# Piano Stage 4A — Compose All audition set

Fresh generations through the ordinary production `composeAllTracks` path, packaged for listening. This is a handoff for musical evaluation, not evidence of musical success.

## Merged UVI-profile MIDI

| Example | Seed | File | Written, explicitly annotated strings-lead bars | Brass lead spans | Piano export notes | Piano channel / CC64 points |
|---|---:|---|---|---|---:|---:|
| Cinematic | 0 | [01-cinematic-orchestra.mid](./01-cinematic-orchestra.mid) | 1–7, 16 | none | 57 | 16 / 34 |
| Hybrid Studio | 0 | [02-hybrid-studio-orchestra.mid](./02-hybrid-studio-orchestra.mid) | 1–7, 9–16 | 14–15 | 55 | 16 / 10 |
| Vocal Backing | 0 | [03-vocal-backing.mid](./03-vocal-backing.mid) | none | none | 70 | 16 / 30 |
| Chamber | 0 | [04-chamber.mid](./04-chamber.mid) | 1–7, 13–16 | none | 52 | 16 / 30 |
| Sonata | 0 | [05-sonata.mid](./05-sonata.mid) | 1–7, 9–16 | none | 52 | 16 / 32 |
| Standalone Piano (Chamber rules) | 0 | [06-standalone-piano-chamber.mid](./06-standalone-piano-chamber.mid) | none | none | 60 | 16 / 32 |

All five priority templates use the same seed and fixture. Cinematic, Hybrid Studio, Chamber, and Sonata include written activity under explicitly annotated strings-lead layers. The Hybrid Studio seed also produces a brass lead; that brass plan is recorded separately because the Piano Analyzer’s supplied lead evidence is limited to strings annotations. Vocal Backing has no explicit strings-lead evidence in this generation. The final example contains only Piano as a standalone Composer case.

## Optional file-only percussion parts

The shipped UVI profile intentionally exports Timpani, Snare, and Cymbals as separate file-only parts instead of placing them in the merged file. When generated, the per-example sidecars are listed in `manifest.json`. The profile assigns some sidecar channels that overlap merged wind channels, so load a sidecar in a separate instrument/port (or use the app’s documented per-track export workflow) rather than merging it blindly into the same 16-channel device.

## Context and limitations

- Fixture: `fixtures/dorian-16bars.json`; seed 0; density 1; Compose All moments enabled; initial take 0.
- The first five projects use their selected template rosters. The standalone case retains only Piano before Compose All while using Chamber eligibility/rules; no non-Piano analysis tracks are present in that case.
- The manifest records actual PianoScore event counts, finalized Piano note counts, playability diagnostics, activity-backed lead bars, orchestra lead spans, Piano technique counts, profile channels, CC64 counts, active profile-export track counts, and checksums. These are structural facts, not judgments about sound.
- Piano output is passed through the shipped UVI Orchestral Suite `chunksForTrack` export transform: the Piano patch is UVI Grand Model D on MIDI channel 16, and CC64 is retained by profile policy. Non-Piano profile mapping and per-file-only rules are also applied.
- Because dependencies including `midi-file` are absent, a temporary Node-only SMF writer was used instead of `src/export/midi.ts`. It mirrors the app’s merged-file structure and key/section/tempo metadata, but byte-for-byte export parity is not verified. No dependency installation occurred.
- No audio rendering or human listening evaluation has been performed. Please audition these in the normal sound setup and report the musical results before any further stage.

Full per-track details and SHA-256 hashes: `manifest.json`.
