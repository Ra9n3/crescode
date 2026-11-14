# Strings V1 — Stage 5: the Cello as a fourth voice

Audition package for **chamber / dorian-16bars / seed 1 / take 0**. Eight MIDI files exported through the shipped UVI Orchestral Suite profile (format 1, 960 ticks per beat). Nothing in this package was listened to before it was sent; it is for you to judge.

## What is Stage 4 and what is Stage 5

- **Stage 4** files are the accepted three-voice state: Violin I, Violin II and Viola composed by Strings V1; the Cello is still the classic part. They are rebuilt here and compared byte for byte with the package you auditioned.
- **Stage 5** files differ from Stage 4 in **one track only: the Cello**. Violin I, Violin II and Viola are the same notes and controllers.
- Double Bass: this band (Chamber) has no Double Bass track; none was created and none is in any file.

## Suggested order

| # | file | what it is | SHA-1 |
|---|---|---|---|
| 1 | `chamber-dorian-16bars-seed1-take0__1_stage4_violin-i-alone__uvi.mid` | Stage 4 (accepted): Violin I alone (the second voice) | `24958f6acf22d7dfeaa5f3fa4d25b6c9e2df047e` |
| 2 | `chamber-dorian-16bars-seed1-take0__2_stage4_violin-ii-alone__uvi.mid` | Stage 4 (accepted): Violin II alone (carries the theme) | `42d9ab3391774ea0cd0b1803def8f5640b19329a` |
| 3 | `chamber-dorian-16bars-seed1-take0__3_stage4_viola-alone__uvi.mid` | Stage 4 (accepted): the Viola alone | `5ae57a46678d1044f53c5e0aa854fb0a735962a1` |
| 4 | `chamber-dorian-16bars-seed1-take0__4_stage5_cello-alone__uvi.mid` | Stage 5: the new Cello alone | `2894685d6f5ec1634df4fef1893f4227a25c416f` |
| 5 | `chamber-dorian-16bars-seed1-take0__5_stage4_three-voices__uvi.mid` | Stage 4 (accepted): Violin I, Violin II and Viola, nothing else | `2b55b808e0d3a31821853597de89d0a131decac7` |
| 6 | `chamber-dorian-16bars-seed1-take0__6_stage5_four-voices__uvi.mid` | Stage 5: Violin I, Violin II, Viola and the new Cello, nothing else | `2427d12798040bf7b85997c5154e53ad1da6ab59` |
| 7 | `chamber-dorian-16bars-seed1-take0__7_stage4_full__uvi.mid` | Stage 4 (accepted): the full arrangement (three composed voices; Cello and everything else classic) | `ba399480567a26e14ca8e8aca9d1ba8a73a0c9cf` |
| 8 | `chamber-dorian-16bars-seed1-take0__8_stage5_full__uvi.mid` | Stage 5: the full arrangement (four composed voices; Double Bass, where the band has one, and everything else classic) | `8515e35167b8d537905ccf94c2f1dc8d736b50da` |

1. Files 1–3: the three accepted voices alone, as a reminder.
2. File 4: the Cello alone — does it stand as a line of its own?
3. File 5, then file 6: the same passage without and with the Cello.
4. File 7, then file 8: the full arrangement with the classic Cello, then with the composed one.

## Tracks and channels

| track | channel | voice |
|---|---|---|
| Violin I | 1 | the second voice |
| Violin II | 2 | carries the theme |
| Viola | 3 | third voice (Stage 4) |
| Cello | 4 | fourth voice (Stage 5) |

**The theme is carried by Violin II.**

## Keyswitches and controllers on the Cello channel

Keyswitch zone per the profile: MIDI 12–35; lowest playable note MIDI 36. Strokes this file uses: legato (MIDI 14), sustain (MIDI 12). Keyswitch notes are sent at velocity 100 shortly before the note they apply to.

- bar 1 beat 1 (tick 0): MIDI 14, velocity 100
- bar 6 beat 4.98 (tick 23021): MIDI 12, velocity 100
- bar 10 beat 4.98 (tick 38380): MIDI 14, velocity 100
- bar 15 beat 4.98 (tick 57584): MIDI 12, velocity 100

Read back from file 4: "Cello Ensemble" ch 4: 38 note-ons, of which 4 in the keyswitch zone (MIDI 12, 14) and 34 musical notes (MIDI 36–65); controllers CC1 ×75, CC7 ×1, CC11 ×78.

**Unverified:** the keys, the zone and the playable range are what the export profile states. They were not checked against the UVI patch in this stage; every articulation is marked "not auditioned" in the capability table. If the Cello sounds wrong in a way that looks like a wrong key, that is the first thing to suspect.

## What the Cello does in this case

| bars | role | what it plays |
|---|---|---|
| bar 1 beat 1 – bar 3 beat 1 | foundation | long bass tones |
| bar 3 beat 1 – bar 5 beat 1 | bass-line | a moving bass |
| bar 5 beat 1 – bar 7 beat 1 | theme | the theme's head from bar 5 beat 3, 3 scale steps lower (stepwise-moves, 1 note(s) moved); then a moving bass; then a moving bass |
| bar 7 beat 1 – bar 7 beat 2 | arrival | the bass of the goal chord, held |
| bar 7 beat 2 – bar 8 beat 1 | arrival | silent — the arrival note goes on sounding from the stretch before |
| bar 9 beat 1 – bar 10 beat 1 | tacet | silent — silent by plan: rule 2 — the Viola plucks the bass under a theme that is already known: the lightest texture of the piece; a bowed bass would thicken it, so the Cello rests |
| bar 10 beat 1 – bar 11 beat 1 | tacet | silent — silent by plan: rule 2 — the Viola plucks the bass under a theme that is already known: the lightest texture of the piece; a bowed bass would thicken it, so the Cello rests |
| bar 11 beat 1 – bar 13 beat 1 | bass-line | a moving bass |
| bar 13 beat 1 – bar 16 beat 1 | theme | the theme's head from bar 14 beat 3, 10 scale steps lower (stepwise-moves, 1 note(s) moved); then a moving bass; then a moving bass |
| bar 16 beat 1 – bar 16 beat 4 | arrival | the bass of the goal chord, held |

Thematic entries: bar 5 beat 3 (head), bar 14 beat 3 (head). Details, every note against the other voices, the review and the measurements are in `chamber-dorian-16bars-seed1-take0__evidence.md`.

## Comparison with the Stage 4 package

5 Stage 4 files compared with the kept Stage 4 record, 5 byte-identical.

