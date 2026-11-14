# Woodwinds V1 Stage 2 — EARLY LISTENING GATE

**Ready for human audition. Not human-auditioned or approved.** These files are the first bounded musical slice, generated through actual `composeAllTracks(..., { windsComposition: 'v1', stringsComposition: 'v1' })`. Please listen before requesting more vocabulary. Automated evidence is not a musical-quality verdict.

## Start here (about five minutes)

1. Open **01-lyrical-dorian / seed 1 / take 1 / uvi**. Import its `__winds-only.mid`, load the four Solo patches below, and listen from bar 1. At **bars 3–4** hear oboe statement → clarinet answer with bassoon support; **bars 14–16** lead toward a flute answer and oboe arrival.
2. Compare its `__full-orchestra.mid` to `__nonwind-reference.mid` on mutually exclusive tracks. Do the winds sound integrated or pasted on? Check space, foreground competition and balance. Do not play both references together.
3. Open **03-low-support / seed 3 / take 1**: solo `__bassoons.mid` around **bar 10**, then hear it in context. It has a short independent answer, not an exact cello copy. Is that gesture audible and convincing, or merely busy?
4. Hear **02-dialogue-dorian / seed 1 / take 1**, **bars 6–12**: flute statement → clarinet answer → flute continuation, then a new exchange and arrival. Compare produced **take 2** at the same displayed seed.
5. Hear **04-lyrical-aeolian**, especially **bars 2–7 and 14–16**. Compare the Dorian interpretation. Then compare lyrical Dorian **seed 7** against seed 1.

Questions for the listening gate: Which exchange sounds most natural? Which line needs more space? Does oboe have a different weight from flute? Is clarinet a real melodic participant? Does bassoon have character without fighting the orchestral bass? Are repeated ideas recognizable without sounding mechanical? Please report composition/seed/take, bars, patch and what you hear.

## Studio One + UVI Orchestral Suite 1

- Use a fresh Song for each rendition, with its MIDI imported at **bar 1**. All source fixtures are **4/4, 100 BPM**; MIDI carries tempo/meter. Keep the lead-in and initial silent bars: they are part of the arrangement. These are Type-1 MIDI files, 960 PPQ, sounding pitch (no manual clarinet transposition).
- For the easiest wind audition import `__winds-only.mid`, split its named tracks if required, and assign one UVI instance/part per named instrument. MIDI does **not** load patches automatically.
- For UVI-profile exports route **Flute Solo → channel 11; Oboe Solo → 12; Clarinet Solo → 13; Bassoon Solo → 14**. Preserve keyswitch notes and CC1/CC7/CC11. The existing profile uses the `C3=60` naming convention; MIDI numbers are authoritative if Studio One's octave labels differ.
- Sustain/staccato are the existing wind patch switches. Written legato/marcato fall back to sustain as the unchanged profile specifies. This is **not** a new sampled-legato implementation. Do not erase low keyswitch notes or transpose the MIDI to change note labels.
- `__full-orchestra.mid` is the existing **merged** export. In UVI mode it deliberately omits file-only **Timpani, Snare and Cymbals** because the profile's channel allocation cannot fit them in the merged stream. For complete orchestral playback, add those named files from `uvi/orchestral-parts/` on separate instrument instances. Do not also import duplicate string/wind parts. Aux is explicitly unmapped by the existing profile. No mapping was changed for this package.
- Alternatively import every file in `uvi/orchestral-parts/`, each onto its own assigned instrument, and **do not** import the merged file. Snare/channel 11 and Cymbals/channel 12 must use separate instances/routing, not the flute/oboe UVI inputs. `evidence.json` and `uvi-profile-reference.json` give the complete patch/channel mapping, including all non-wind tracks.
- `plain/` contains the same production arrangement without profile keyswitch/fold handling. Assign suitable sounds yourself; plain wind channels are flute **9**, oboe **10**, clarinet **11**, bassoon **12**. Do not combine plain and UVI versions for playback. Full plain MIDI may require per-track routing rather than a General MIDI multitimbral player.
- Isolated files retain original song timing, tempo and CC, not normalized or cropped solos. Empty/out-of-band parts are intentionally empty; a conductor-only UVI MIDI file is not corruption.

## Six renditions / four compositions

| Folder prefix | Source fixture | Template | Mode | Seed / produced take | Purpose |
| --- | --- | --- | --- | --- | --- |
| 01-lyrical-dorian | dorian-16bars | Symphony | Dorian | 1 / 1 | Four-player lyrical slice |
| 01-lyrical-dorian | dorian-16bars | Symphony | Dorian | 7 / 1 | Alternative seed |
| 02-dialogue-dorian | three-chorus-40bars | Hybrid Studio | Dorian | 1 / 1 | 40-bar dialogue/recurrence |
| 02-dialogue-dorian | three-chorus-40bars | Hybrid Studio | Dorian | 1 / 2 | Alternative produced take |
| 03-low-support | multi-chorus-16bars | Cinematic | Dorian | 3 / 1 | Independent bassoon/support |
| 04-lyrical-aeolian | dorian-16bars, existing mode transform | Symphony | Aeolian | 1 / 1 | Different modal harmony |

No custom test-only notes were planted. The Aeolian input uses the app's existing `transformProjectMode`, not a hand-rewritten chord sequence. Stored input take is one less than the produced take. Dedicated Piano V5 and accepted Strings V1 remain unchanged by the wind opt-in in all six renditions.

Hybrid Studio's roster includes flute/clarinet, not oboe/bassoon. Cinematic excludes oboe. Those isolated files are supplied but silent; **Symphony demonstrates all four instruments together**. We did not pin excluded players in merely to populate files.

## Files and evidence

Each rendition includes, for **plain and UVI**:

- `__full-orchestra.mid` (merged, UVI limitations above);
- `__winds-only.mid`;
- `__flutes.mid`, `__oboes.mid`, `__clarinets.mid`, `__bassoons.mid`;
- `__nonwind-reference.mid`;
- `orchestral-parts/` (existing per-track exporter, including supported file-only parts).

There are **306 MIDI files** total (42 merged/isolated/reference files per profile, plus 114 plain and 108 UVI per-track files). Each rendition also includes input/produced project JSON and `evidence.json`: identity/version, track mapping, plan, phrase links, rests, writer traces, retained counts, observed exports and reconciliation. `catalog.json` is the concise index. `SHA256SUMS` covers package files except itself. The accompanying ZIP contains this complete folder.

All **345 designed phrase notes** across the six renditions survive with their exact planned pitch/onset/duration in the retained wind tracks. Actual parsed merged plain/UVI note-ons reconcile with sounding counts plus separate keyswitch counts, and per-job export evidence reconciles. Full non-wind track/CC objects equal the same run without V1 winds. These checks establish delivery/provenance, **not listenability**.

Bassoon has 18, 9, 25 and 16 retained notes in the four Symphony/Cinematic renditions respectively that are not exact onset/duration/pitch-class cello copies. This is a narrow numerical independence measure; listen to determine whether its rhythm and tenor voice work musically.

## Known limits / listening priorities

This is a compact shared contour with instrument-specific pacing, transformed answers, occasional continuation, selective source anchors, two-voice support and cadential endings. It is not long-form thematic development. Early-reserved tutti/unison/soli and lead material retains the existing vocabulary and source-copy validator, but now also uses planned breath windows; compare it to the new dialogue. All wind gestures, including source-based reservations, have a felt beat allocated for air each bar (or an earlier time cap at slow tempi); designed dialogue also uses bounded register motion. Source-based gestures can retain larger source intervals. Whether those frequent bar-level breaths sound too square is an important audition question.

Support is currently most often bassoon (or clarinet when bassoon is absent). The planner does not model sample-library latency or human performance. Existing energy governance and CC shaping remain; mix and actual sample balance have not been listened to here. A phrase label expresses intent, not proof that the listener perceives a foreground or meaningful answer. Human approval and any next vocabulary expansion remain pending.
