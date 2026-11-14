# Strings V1 — Stage 6: the Double Bass as a fifth voice

Audition package. MIDI files exported through the shipped UVI Orchestral Suite profile. **Nothing in this package was listened to before it was sent**; it is for you to judge. What is stated below is read from the composed data and from the bytes of the files.

## Read this first: the reference case has no Double Bass

The reference case of Stages 2–5 is **Chamber / D Dorian / 16 bars / seed 1 / take 0**. The Chamber band has no Double Bass track, and this stage does not invent one. For that case the package therefore holds the Stage 4 and Stage 5 material again (byte-identical with what you auditioned) and nothing new: Stage 6 full equals Stage 5 full.

The Double Bass is in the three bands that have a desk — **Symphony, Cinematic, Hybrid Studio** — on the same piece (D Dorian, 16 bars, seed 1). Those three folders are where to listen. Sonata and Vocal Backing stay classic.

## Cases

| folder | Double Bass | theme on | roles written | notes | channel |
|---|---|---|---|---|---|
| `chamber-dorian-16bars-seed1-take0/` | none — the band has no Double Basses desk: this stage writes onto the existing desk and never creates a track | Violin II | — | — | — |
| `symphony-dorian-16bars-seed1-take0/` | written | Violin I | foundation, moving, arrival, root-fifth | 25 | 5 |
| `cinematic-dorian-16bars-seed1-take1/` | written | Violin I | foundation, moving, arrival, plucked, response | 28 | 5 |
| `hybridstudio-dorian-16bars-seed1-take0/` | written | Violin I | foundation, moving, arrival, plucked | 24 | 5 |

## The six things to compare, per case

| | chamber | symphony | cinematic | hybridstudio |
|---|---|---|---|---|
| **Stage 4 three voices** | file 06 | file 06 | file 06 | file 06 |
| **Stage 5 four voices** | file 07 | file 07 | file 07 | file 07 |
| **Stage 6 Double Bass alone** | — (no Double Bass) | file 05 | file 05 | file 05 |
| **Stage 6 five voices** | — (no Double Bass) | file 08 | file 08 | file 08 |
| **Stage 5 full** | file 09 | file 09 | file 09 | file 09 |
| **Stage 6 full** | file 10 | file 10 | file 10 | file 10 |

In every folder the files are numbered the same way:

| # | file | what it is |
|---|---|---|
| 01–04 | `…__01_violin-i-alone` … `…__04_cello-alone` | the four accepted voices, one track each |
| 05 | `…__05_stage6_double-bass-alone` | **the new Double Bass alone** (not in the Chamber folder) |
| 06 | `…__06_stage4_three-voices` | Violin I, Violin II, Viola |
| 07 | `…__07_stage5_four-voices` | the same with the Cello |
| 08 | `…__08_stage6_five-voices` | the same with the new Double Bass (not in the Chamber folder) |
| 09 | `…__09_stage5_full` | the whole arrangement, Double Bass = the old Cello/Bass split |
| 10 | `…__10_stage6_full` | the whole arrangement, Double Bass = the composed fifth voice |

Files 09 and 10 differ in one track only: the Double Bass. Files 07 and 08 differ by that track being added.

## Suggested order (in a Symphony, Cinematic or Hybrid Studio folder)

1. File 05: the Double Bass alone. Is it a part, with rests and a shape, or a row of roots?
2. File 07, then 08: four voices without and with it. Does it carry the ensemble from below without thickening it, and can it be told from the Cello?
3. File 09, then 10: the full arrangement with the old split, then with the composed part.
4. `cinematic-…-take1`: bars 11–12 — the Double Bass answers with the first three notes of the theme's head in notes twice as long. The other two cases planned the same answer and did not write it (the evidence says why).

## Loading

One part per track; the Double Bass goes to the "Bass Ensemble" part on MIDI channel 5 (the channel and part the classic Double Bass already used — nothing about the track was changed). Keyswitches per the profile: sustain = MIDI 12, legato = 14, pizzicato = 17, tremolo = 19, marcato = 21 (zone MIDI 12–22). Controllers written: CC1, CC11 (own curves) and CC7.

**Unverified against the UVI patch:** the keys, the zone, the playable range, and whether the patch sounds at the written key or an octave lower. The profile states no upper limit; nothing above MIDI 48 (C3) or below MIDI 28 (E1) is written. If a note sounds like a wrong articulation or does not sound at all, a wrong key is the first thing to suspect.

## What the Double Bass does — symphony, take 0

| bars | planned | what it plays |
|---|---|---|
| bar 1 beat 1 – bar 3 beat 1 | tacet | silent — silent by plan |
| bar 3 beat 1 – bar 5 beat 1 | foundation | foundation: long tones on the bass of every chord |
| bar 5 beat 1 – bar 7 beat 1 | moving | moving: a line connecting the basses of the chords |
| bar 7 beat 1 – bar 7 beat 2 | arrival | arrival: the bass of Am7, held 1 beats |
| bar 7 beat 2 – bar 8 beat 1 | arrival | arrival: the arrival tone goes on |
| bar 9 beat 1 – bar 10 beat 1 | root-fifth | root-fifth: the bass on the bar, its fifth or octave in the middle of it |
| bar 10 beat 1 – bar 11 beat 1 | root-fifth | root-fifth: the bass on the bar, its fifth or octave in the middle of it |
| bar 11 beat 1 – bar 13 beat 1 | response | foundation: the theme's head fitted nowhere in this stretch: long tones instead |
| bar 13 beat 1 – bar 16 beat 1 | moving | moving: a line connecting the basses of the chords |
| bar 16 beat 1 – bar 16 beat 4 | arrival | arrival: the bass of Dm7, held 3 beats |

## What the Double Bass does — cinematic, take 1

| bars | planned | what it plays |
|---|---|---|
| bar 1 beat 1 – bar 3 beat 1 | tacet | silent — silent by plan |
| bar 3 beat 1 – bar 5 beat 1 | foundation | foundation: long tones on the bass of every chord |
| bar 5 beat 1 – bar 7 beat 1 | moving | moving: a line connecting the basses of the chords |
| bar 7 beat 1 – bar 7 beat 2 | arrival | arrival: the bass of Am7, held 1 beats |
| bar 7 beat 2 – bar 8 beat 1 | arrival | arrival: the arrival tone goes on |
| bar 9 beat 1 – bar 10 beat 1 | plucked | plucked: the bass plucked on the bar, answered in the middle of it |
| bar 10 beat 1 – bar 11 beat 1 | foundation | foundation: long tones on the bass of every chord |
| bar 11 beat 1 – bar 13 beat 1 | response | response: the first 3 notes of the theme's head in notes twice as long, from bar 11 |
| bar 13 beat 1 – bar 16 beat 1 | moving | moving: a line connecting the basses of the chords |
| bar 16 beat 1 – bar 16 beat 4 | arrival | arrival: the bass of Dm7, held 3 beats |

## What the Double Bass does — hybridstudio, take 0

| bars | planned | what it plays |
|---|---|---|
| bar 1 beat 1 – bar 3 beat 1 | tacet | silent — silent by plan |
| bar 3 beat 1 – bar 5 beat 1 | foundation | foundation: long tones on the bass of every chord |
| bar 5 beat 1 – bar 7 beat 1 | moving | moving: a line connecting the basses of the chords |
| bar 7 beat 1 – bar 7 beat 2 | arrival | arrival: the bass of Am7, held 1 beats |
| bar 7 beat 2 – bar 8 beat 1 | arrival | arrival: the arrival tone goes on |
| bar 9 beat 1 – bar 10 beat 1 | plucked | plucked: the bass plucked on the bar, answered in the middle of it |
| bar 10 beat 1 – bar 11 beat 1 | plucked | plucked: the bass plucked on the bar, answered in the middle of it |
| bar 11 beat 1 – bar 13 beat 1 | response | foundation: the theme's head fitted nowhere in this stretch: long tones instead |
| bar 13 beat 1 – bar 16 beat 1 | moving | moving: a line connecting the basses of the chords |
| bar 16 beat 1 – bar 16 beat 4 | arrival | arrival: the bass of Dm7, held 3 beats |

## Comparison with the kept Stage 4 and Stage 5 packages

Reference case (`chamber-dorian-16bars-seed1-take0`), rebuilt now and compared byte for byte with the kept folders (which were only read):

- 01_violin-i-alone vs strings-v1-stage5/1_stage4_violin-i-alone__uvi.mid: identical
- 02_violin-ii-alone vs strings-v1-stage5/2_stage4_violin-ii-alone__uvi.mid: identical
- 03_viola-alone vs strings-v1-stage5/3_stage4_viola-alone__uvi.mid: identical
- 04_cello-alone vs strings-v1-stage5/4_stage5_cello-alone__uvi.mid: identical
- 06_stage4_three-voices vs strings-v1-stage4/5_stage4_three-voices__uvi.mid: identical
- 07_stage5_four-voices vs strings-v1-stage5/6_stage5_four-voices__uvi.mid: identical
- 09_stage5_full vs strings-v1-stage5/8_stage5_full__uvi.mid: identical

The other cases have no kept record to compare with.

## Evidence

Each folder has `…__evidence.md`: files and hashes, the instrument as the profile states it, the plan and roles, what each stretch became and why, every note against each of the four voices, the review and its findings, range and keyswitch-zone safety, controller output, the exported file read back, the hand-off to the existing desk, and the limits of the evidence. `coverage.md` lists every template × fixture × take 0–3.

