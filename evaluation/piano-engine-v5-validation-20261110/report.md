# Piano Engine V5 fresh MIDI validation

Generated 2026-11-10 from the current production Compose All path. All exports use `fixtures/three-chorus-40bars.json`, user seed 11, density 1.0, and three consecutive takes per template. The starting take numbers match the production regression cases: Chamber 1, Sonata 2, Vocal Backing 3, Cinematic 4, Hybrid Studio 5. For a consistent 40-bar comparison, this audit uses that same fixture for all templates; the production regression test uses `dorian-16bars.json` for Sonata.

## Export and round-trip

The exports are UVI-profile per-track Piano MIDI files (Grand Model D, Piano name, channel 16, no keyswitch/transposition, CC64 enabled). The repository's declared `midi-file` package is not installed in this workspace. To create the requested fresh MIDI files without installing dependencies, I called the repository's `buildPerTrackMidi` and `parseMidiFile` through a temporary minimal Standard MIDI File compatibility shim. Each of the 15 files round-tripped through the repository parser and matched the `chunksForTrack` note events and CC64 points exactly; all are format 1, 960 PPQ, two tracks, channel 16, and end with CC64=0. This is an ad hoc validation, not the official dependency-backed MIDI test.

## Current-generation comparison

Three takes per template produced distinct note-event hashes in every case. “Bass anchors” uses the Piano Realizer's in-memory `roleTag: anchor` LH events; the MIDI itself does not preserve that tag. “Bass leap” is mean semitone motion between consecutive anchor attacks. “Split-register attack ticks” are ticks with both a note below MIDI 60 and a note at/above 60. “Anchor with upper overlap” counts anchor events overlapped by at least one non-anchor note at/above 60; it is a note-data proxy for two-register writing, not hand/fingering proof. Phrase counts are actual note-start activity by Composer phrase windows.

| Template | Take | MIDI notes | MIDI range | Bass anchors (range) | Mean bass leap | Split-register attack ticks | Anchors with upper overlap | Active phrases | Textures | Motif ops | CC64 points | File |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| chamber | 1 | 64 | 33–76 | 7 (33–43) | 2.5 | 5 | 6/7 | 9/14 | 3 | 7 | 68 | chamber-take-1.mid |
| chamber | 2 | 61 | 33–69 | 11 (33–38) | 1.4 | 10 | 10/11 | 8/13 | 2 | 6 | 68 | chamber-take-2.mid |
| chamber | 3 | 62 | 33–70 | 11 (33–41) | 2 | 8 | 9/11 | 7/13 | 2 | 7 | 66 | chamber-take-3.mid |
| sonata | 2 | 96 | 41–84 | 30 (41–55) | 1.76 | 27 | 30/30 | 12/14 | 2 | 6 | 80 | sonata-take-2.mid |
| sonata | 3 | 116 | 45–88 | 29 (45–62) | 1.86 | 24 | 29/29 | 14/14 | 3 | 6 | 80 | sonata-take-3.mid |
| sonata | 4 | 113 | 43–88 | 26 (43–55) | 1.44 | 24 | 26/26 | 15/15 | 3 | 7 | 84 | sonata-take-4.mid |
| vocalbacking | 3 | 79 | 45–76 | 16 (45–59) | 2.27 | 12 | 16/16 | 8/8 | 3 | 5 | 78 | vocalbacking-take-3.mid |
| vocalbacking | 4 | 75 | 48–74 | 13 (48–60) | 2.58 | 8 | 13/13 | 7/8 | 4 | 5 | 72 | vocalbacking-take-4.mid |
| vocalbacking | 5 | 68 | 45–74 | 13 (45–62) | 3.08 | 7 | 13/13 | 8/8 | 3 | 5 | 72 | vocalbacking-take-5.mid |
| cinematic | 4 | 77 | 38–98 | 17 (38–55) | 2.38 | 15 | 16/17 | 10/10 | 1 | 5 | 68 | cinematic-take-4.mid |
| cinematic | 5 | 65 | 38–93 | 14 (38–50) | 1.85 | 11 | 13/14 | 10/10 | 2 | 6 | 76 | cinematic-take-5.mid |
| cinematic | 6 | 70 | 33–95 | 15 (33–48) | 2.43 | 13 | 15/15 | 8/9 | 1 | 5 | 74 | cinematic-take-6.mid |
| hybridstudio | 5 | 103 | 45–88 | 20 (45–57) | 1.68 | 19 | 20/20 | 12/12 | 1 | 5 | 10 | hybridstudio-take-5.mid |
| hybridstudio | 6 | 93 | 45–88 | 15 (45–62) | 2.57 | 10 | 15/15 | 10/10 | 2 | 5 | 12 | hybridstudio-take-6.mid |
| hybridstudio | 7 | 90 | 45–88 | 13 (45–62) | 2.92 | 11 | 13/13 | 9/10 | 1 | 5 | 8 | hybridstudio-take-7.mid |

### Across the three generations

| Template | Distinct note outputs | Note-count range | Bass-anchor range | Active phrases by take |
|---|---|---:|---:|---|
| chamber | 3/3 unique; pairwise different=true | 61–64 | 7–11 | 9, 8, 7 of 14, 13, 13 |
| sonata | 3/3 unique; pairwise different=true | 96–116 | 26–30 | 12, 14, 15 of 14, 14, 15 |
| vocalbacking | 3/3 unique; pairwise different=true | 68–79 | 13–16 | 8, 7, 8 of 8, 8, 8 |
| cinematic | 3/3 unique; pairwise different=true | 65–77 | 14–17 | 10, 10, 8 of 10, 10, 9 |
| hybridstudio | 3/3 unique; pairwise different=true | 90–103 | 13–20 | 12, 10, 9 of 12, 10, 10 |

## Historical V4 MIDI reference

These are existing V4 artifacts from the repository's evaluation folder. Counts/ranges are parsed from their Piano tracks. They provide a rough previous-version reference; they are not byte-level or audio comparisons, and not all V4 exports have a guaranteed take/seed manifest.

| Template | V4 notes | V4 pitch range | Notes below 60 | Notes at/above 60 | Max polyphony | CC64 points |
|---|---:|---:|---:|---:|---:|---:|
| chamber | 85 | 33–74 | 36 | 49 | 4 | 70 |
| sonata | 99 | 47–88 | 28 | 71 | 4 | 80 |
| vocalbacking | 66 | 45–76 | 11 | 55 | 4 | 72 |
| cinematic | 68 | 45–96 | 16 | 52 | 4 | 68 |
| hybridstudio | 81 | 45–82 | 11 | 70 | 4 | 14 |

## Musical inspection

- **Bass:** V5 writes explicit LH anchor notes in all five templates and every sampled take. Motion is generally economical, but anchor density varies materially by template/take; compare the “Bass anchors” and “Mean bass leap” columns. Very low mean leaps can sound static, so the current range alone should not be read as an improvement in bass-line development.
- **Two-hand writing:** actual exports contain low/high register overlaps and simultaneous split-register attacks; the note-role metrics show real LH anchors coexisting with upper material. This supports two-register independence, but cannot prove playable hand assignments, fingering, or idiomatic voicing without listening.
- **Phrase development:** all three takes differ per template and Composer plans multiple textures/motif operations, but actual note-start coverage is uneven. Across 168 phrase windows, 21 have neither Piano note starts nor overlapping Piano notes. Six coincide with exact supplied near-silence/zero-target attack restrictions. Eighteen windows overlap a Composer leave-space decision; three of those are also among the Chamber near-silence windows. The remaining 15 are separate full-phrase leave-space reservations: 13 Chamber release phrases and two Sonata phrases that also withhold under annotated lead. Thus 6 + 18 − 3 = 21; the 18-window overlap count is not 18 additional reservations. All 45 repeated-section surfaces (Verse occurrence 2 and Chorus occurrences 2–3, across 15 exports) differ from their section-relative first occurrence by pitch/onset/duration/velocity signature. The repeated blank Chamber releases may still make development too sparse; these are intentional Composer decisions, not a Realizer failure. The manifest records exact reservations and evidence.
- **Targeted correction:** a fully reserved leave-space phrase used to retain Composer motif cells even though the Realizer suppresses their attacks. That mismatch is now removed and covered by a V5 regression test. No notes were added; the corrected plan also stops inaudible motif drafts from affecting later melody state. Chamber take 1's first note of the following reprise changed from MIDI 64 to 76 at tick 107520 (duration 3533 to 2508 ticks); the other 14 sampled note hashes are unchanged from the pre-correction exports. The CC64 lanes are identical across all 15 pre/post comparisons. Treat this as a consistency fix, not as proven musical improvement.
- **Overall:** the evidence supports seeded variation and structural/two-register writing, but not an across-the-board musical improvement. Compared with the historical V4 counts, Sonata is 96–116 vs 99 notes; Vocal Backing 68–79 vs 66; Cinematic 65–77 vs 68; Hybrid Studio 90–103 vs 81; Chamber is notably sparser at 61–64 vs 85. These are unmatched historical exports, so counts alone are not a controlled quality comparison. No notes were added without listening evidence. Read the per-take phrase and reprise details in `manifest.json` and audition the MIDI in a Piano instrument before treating tags/plans as proof of a better performance.

## Artifacts

This folder contains 15 fresh MIDI files and `manifest.json` with per-take identity, phrase, bass, register, polyphony, and round-trip details. No generated MIDI files were placed in `tests/golden/`.
