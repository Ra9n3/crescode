# Strings V1 — identity and development V2

**Studio One MIDI audition; not listened to, not audio, not musical approval.**

## Suggested listening order
1. Compare Symphony seeds 1, 2, 5, 6, 8 and 11, take 0: file 04 (theme only), then 01 (primary development). Listen for descending/repeated-note/ascending and wider-leap openings, different rhythmic gait, peak placement and returns.
2. Compare file 01 across the eight consecutive seeds (plus seed 11, a repeated-opening control), then file 02 (full string band). Are these recognizably different ideas, and does each journey remain related to its own theme?
3. Fix seed 1: compare take 0/1/2/3. Folder take is the STORED request; evidence also gives the incremented produced take.
4. Compare Chamber, Cinematic, Hybrid Studio and Symphony at seed 1/take 0. Normal production identity includes template: these compare BOTH new composition and roster/energy. They do not prove template-specific musical style.
5. Separately, fixed-material-energy-control freezes the Symphony seed-1 phrases and octave and calls the accepted writer with each template's energy targets. These are primary-only, no humanization or CC; any change here is writer energy, NOT new thematic identity. Identical controls are valid.
6. Longer/repeated form: multi-chorus-16bars and three-chorus-40bars, file 01 then 02. Check whether a long form develops instead of cycling indiscriminately.

## Import into Studio One
Use the same UVI Orchestral Suite setup as Stage 6. Open/import ONE MIDI at a time at song origin, preserving the file tempo and meter; do not layer files 01–04. Files are Type 1, conductor plus one part per present string instrument. Route each named part to the same existing UVI desk/channel used by the accepted packages. UVI keyswitches are low notes: do not play them as musical notes or transpose them. Existing profile and mappings are unchanged. CC1/11/7 are retained in the production primary/full-strings files. File 03 is plain MIDI without keyswitch conversion, useful for inspecting notes or another sound source (not the UVI articulation comparison). File 04 is an isolated writer realization of just the home theme, without the production expression passes.

The script parses every MIDI and verifies expected part counts. See midi-manifest.json for actual SHA256/byte sizes/counts, not as evidence of musical diversity. Each evidence.json holds actual final notes/CC and symbolic theme/phrase evidence.

## Controls and known limits
All main seed controls share D Dorian harmony, tempo, project, Symphony template and stored take 0. Exact repeated production runs, nonstring output equality to classic, Piano consumed-input equality and track roster equality are asserted for EVERY case. No new tracks are invented. A rejected writer keeps its classic part: this is stated below and in per-case evidence, not silently counted as a new V2 voice. The accepted lower voices still own their existing role schedules/search policies and can reject richer material. No supported mood input exists; no mood comparison is claimed.

| Case | Actual theme intervals (scale steps) | Rhythm (beats) | Phrases | Limits |
|---|---|---|---|---|
| symphony-dorian-16bars-seed1-take0 | -3, 1, 0, -1, -1 | 1.5, 1, 1, 1.5, 1.5, 1 | 2 | all present desks written |
| symphony-dorian-16bars-seed2-take0 | 1, 1, 0, -2, 0, -1, 1, 0, 2 | 1.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5, 1, 1 | 4 | all present desks written |
| symphony-dorian-16bars-seed3-take0 | -2, -1, 1, 2, 2, 1, 0, -1, -1 | 1, 1, 1, 0.5, 0.5, 0.5, 1, 0.5, 1, 1 | 2 | all present desks written |
| symphony-dorian-16bars-seed4-take0 | 1, 2, 1, -1, -2, -2, 0, 1, 1 | 0.5, 0.5, 1.5, 0.5, 1, 1, 0.5, 1, 0.5, 1 | 2 | all present desks written |
| symphony-dorian-16bars-seed5-take0 | 2, 0, 2, -1, -5 | 1, 1.5, 1.5, 0.5, 1.5, 2 | 4 | all present desks written |
| symphony-dorian-16bars-seed6-take0 | 4, 1, -2, -2, -3 | 2, 0.5, 1.5, 1.5, 0.5, 2 | 4 | all present desks written |
| symphony-dorian-16bars-seed7-take0 | -3, 1, -1, 0, 1, 2, 2 | 1, 1, 1.5, 0.5, 1, 0.5, 1.5, 1 | 4 | all present desks written |
| symphony-dorian-16bars-seed8-take0 | 3, 1, -1, -2, -2, 1, -1 | 1, 0.5, 1, 1, 0.5, 2, 0.5, 1 | 4 | all present desks written |
| symphony-dorian-16bars-seed11-take0 | 0, 2, 1, 1, 0, -3, -4 | 0.5, 1, 0.5, 1.5, 1, 0.5, 1, 1.5 | 2 | viola: the Viola found nothing sound to play in any stretch: its classic part is kept; cello: the Viola was not composed (the Viola found nothing sound to play in any stretch: its classic part is kept): this stage adds the Cello to three composed voices only; doubleBass: the Viola was not composed (the Viola found nothing sound to play in any stretch: its classic part is kept): this stage adds the Double Bass to four composed voices only |
| symphony-dorian-16bars-seed1-take1 | 4, -4, -2, -1, 1 | 2, 1.5, 0.5, 1.5, 0.5, 2 | 4 | all present desks written |
| symphony-dorian-16bars-seed1-take2 | 3, 1, -1, -2, -2 | 1.5, 1, 1, 1.5, 0.5, 2 | 4 | viola: the Viola found nothing sound to play in any stretch: its classic part is kept; cello: the Viola was not composed (the Viola found nothing sound to play in any stretch: its classic part is kept): this stage adds the Cello to three composed voices only; doubleBass: the Viola was not composed (the Viola found nothing sound to play in any stretch: its classic part is kept): this stage adds the Double Bass to four composed voices only |
| symphony-dorian-16bars-seed1-take3 | 2, 1, -2, 0, 2 | 1, 2, 1, 2, 0.5, 1.5 | 4 | all present desks written |
| chamber-dorian-16bars-seed1-take0 | 1, 1, -1, 1, 1, -1, -1, 0, -5 | 1, 0.5, 0.5, 1.5, 0.5, 0.5, 1, 0.5, 1, 1 | 3 | doubleBass: the band has no Double Basses desk: this stage writes onto the existing desk and never creates a track |
| cinematic-dorian-16bars-seed1-take0 | 2, -1, 0, -1, 0, -1, 0, 1, 1 | 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5, 1 | 2 | viola: the Viola found nothing sound to play in any stretch: its classic part is kept; cello: the Viola was not composed (the Viola found nothing sound to play in any stretch: its classic part is kept): this stage adds the Cello to three composed voices only; doubleBass: the Viola was not composed (the Viola found nothing sound to play in any stretch: its classic part is kept): this stage adds the Double Bass to four composed voices only |
| hybridstudio-dorian-16bars-seed1-take0 | 4, -5, -1 | 1, 3, 3, 1 | 3 | all present desks written |
| symphony-multi-chorus-16bars-seed1-take0 | 1, 1, -2, -1, 0 | 1, 1.5, 1, 0.5, 2, 1.5 | 4 | cello: the Cello found nothing sound to play in any stretch: its classic part is kept; doubleBass: the Cello was not composed (the Cello found nothing sound to play in any stretch: its classic part is kept): this stage adds the Double Bass to four composed voices only, so the desk keeps its classic part |
| symphony-three-chorus-40bars-seed1-take0 | 1, 1, 1, -1, -2, -1, 1, 0, 2 | 1, 0.5, 0.5, 1, 1, 1, 1, 0.5, 0.5, 1 | 10 | all present desks written |

## Listening questions
Does the initial idea stay memorable after inversion/fragmentation/augmentation? Are breaths, joins, climaxes and cadences convincing? Does the second voice support rather than compete? Do lower voices still sound repetitive despite the richer upstream line? Does a retained classic part clash? These require human listening in Studio One/UVI; data checks cannot answer them.
