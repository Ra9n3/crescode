# Stage 2A audition package - decisions behind the "after" files

Song: `fixtures/three-chorus-40bars.json`, 40 bars, 100 bpm (one bar = 2.4 s). Seed 1, density 1.
Form: Verse 1-4, Chorus 5-12, Verse 13-16, Chorus 17-24, Bridge 25-28, Chorus 29-36, Outro 37-40.

The `before` folder has the same file names rendered by commit 932356f; the `after` folder is Stage 2A.
`-piano.mid` is the Piano track alone; `-ensemble.mid` is every sounding track.
`solo` = the project contains only the Piano. `full` = the template ensemble.

The tables below report what the composer decided and what a check of the final score found in the same bar.
"Found in the final score" is a statement about written notes (count, placement, direction). The balance column compares written
MIDI velocities. Neither is a statement about how the result sounds or how loud it is on a given instrument library.

Excerpts exist for both takes (T1 and T3). Excerpt files start at their first bar, so bar 1 of the file is the first bar named.

## Chamber

### CH-T1-solo - take 1, solo, identity "chorale"

Files: `full-pieces/chamber/CH-T1-solo-piano.mid`

Chorale. Even, hymn-like movement in chords; the theme moves by step and the dynamics stay close. Theme: a two-bar idea heard twice, first left open, then closed; the opening rises by step and falls back. It sits on the beat. Accompaniment: left hand broken chords in quarter notes (lighter passages: bass and fifth in half notes); right hand chords struck twice a bar. Development: a falling sequence, then a rising sequence; contrast by the theme turned upside down; the return as a plain statement; high point with the theme an octave higher. Shape: the texture follows the energy of the song without a curve of its own; dynamics: an even level. Techniques: octaves at the high point where the template allows.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | sustained-handover | matches: Everything is struck once and held (5 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (7 note(s), 3 in the theme line, attacks at 1 2 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | chordal-punctuation | matches: Two struck chords (6 note(s), 2 in the theme line, attacks at 1 4 beat(s)). | Two struck chords close the section: one on the downbeat, one before the bar line. |
| 24 | bar 24: Chorus to Bridge | sustained-handover | matches: Everything is struck once and held (5 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 28 | bar 28: Bridge to Chorus | chordal-punctuation | matches: Two struck chords (8 note(s), 2 in the theme line, attacks at 1 4 beat(s)). | Two struck chords close the section: one on the downbeat, one before the bar line. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (7 note(s), 3 in the theme line, attacks at 1 2 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/CH-T1-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/CH-T1-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/CH-T1-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/CH-T1-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/CH-T1-solo-bridge-to-chorus-bars27-30-piano.mid`

### CH-T1-full - take 1, full, identity "chorale"

Files: `full-pieces/chamber/CH-T1-full-piano.mid`, `full-pieces/chamber/CH-T1-full-ensemble.mid`

Chorale. Even, hymn-like movement in chords; the theme moves by step and the dynamics stay close. Theme: a two-bar idea heard twice, first left open, then closed; the opening rises by step and falls back. It sits on the beat. Accompaniment: left hand broken chords in quarter notes (lighter passages: bass and fifth in half notes); right hand chords struck twice a bar. Development: a falling sequence, then a rising sequence; contrast by the theme turned upside down; the return as a plain statement; high point with the theme an octave higher. Shape: the texture follows the energy of the song without a curve of its own; dynamics: an even level. Techniques: octaves at the high point where the template allows.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-11 | Chorus | supporting | **+1 before, -4.9 final** (trim 5). Lead 55.9, Piano 56.9 before the phrase trim (+1). Phrase lowered by 5; asked to sit 4 below (2 Piano attacks per lead attack). Final (track): Piano 51.1, -4.9 against the lead. On target. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 12-12 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 13-15 | Verse | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here. |
| 16-16 | Verse | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 17-23 | Chorus | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 24-24 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 25-27 | Bridge | supporting | **+3.1 before, -1.9 final** (trim 5). Lead 58.2, Piano 61.3 before the phrase trim (+3.1). Phrase lowered by 5; asked to sit 2 below (0.8 Piano attacks per lead attack). Final (track): Piano 56.3, -1.9 against the lead. On target. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 28-28 | Bridge | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 29-32 | Chorus | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here. |
| 33-35 | Chorus | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 36-36 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 37-40 | Outro | atmospheric | not applied (not a supporting phrase) | A quiet phrase carried by others: the Piano adds sustained colour in a register that is free. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (7 note(s), 3 in the theme line, attacks at 1 2 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | chordal-punctuation | matches: Two struck chords (6 note(s), 2 in the theme line, attacks at 1 4 beat(s)). | Two struck chords close the section: one on the downbeat, one before the bar line. |
| 24 | bar 24: Chorus to Bridge | sustained-handover | matches: Everything is struck once and held (5 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 28 | bar 28: Bridge to Chorus | chordal-punctuation | matches: Two struck chords (8 note(s), 2 in the theme line, attacks at 1 4 beat(s)). | Two struck chords close the section: one on the downbeat, one before the bar line. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (7 note(s), 3 in the theme line, attacks at 1 2 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/CH-T1-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/CH-T1-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/CH-T1-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/CH-T1-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/CH-T1-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/CH-T1-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/CH-T1-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/CH-T1-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/CH-T1-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/CH-T1-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 5-12: First Chorus with the written lead active. `passages/chamber/CH-T1-full-lead-passage-bars5-12-piano.mid`, `passages/chamber/CH-T1-full-lead-passage-bars5-12-ensemble.mid`

### CH-T3-solo - take 3, solo, identity "lyrical"

Files: `full-pieces/chamber/CH-T3-solo-piano.mid`

Lyrical. A singing line in long notes over a flowing left hand, growing towards a late high point. Theme: a four-bar line without an internal repeat; the opening starts with a leap and fills it in by step. It sits on the beat. Accompaniment: left hand rolling arpeggios (lighter passages: broken chords in quarter notes); right hand a moving inner voice; alternate sections change to an Alberti figure in eighth notes. Development: a falling sequence, then a rising sequence; contrast by a sequence on the second bar of the theme; the return as the theme an octave higher; high point with the theme an octave higher. Shape: the texture thickens steadily towards a late high point; dynamics: loudest in the middle. Techniques: ornaments on the return, a run into the high point, octaves at the high point where the template allows, the theme in the left hand in long phrases.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (7 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 12 | bar 12: Chorus to Verse | pickup | matches: Three-note upbeat moving in one direction (14 note(s), 6 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 16 | bar 16: Verse to Chorus | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. The same boundary earlier in the form used this gesture; it is recalled. |
| 24 | bar 24: Chorus to Bridge | descending-resolution | matches: Falling line of 3 notes (15 note(s), 4 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The line steps down and softens into a calmer section. |
| 28 | bar 28: Bridge to Chorus | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (7 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 36 | bar 36: Chorus to Outro | descending-resolution | matches: Falling line of 3 notes (14 note(s), 4 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The line steps down and softens into a calmer section. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/CH-T3-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/CH-T3-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/CH-T3-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/CH-T3-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/CH-T3-solo-bridge-to-chorus-bars27-30-piano.mid`

### CH-T3-full - take 3, full, identity "lyrical"

Files: `full-pieces/chamber/CH-T3-full-piano.mid`, `full-pieces/chamber/CH-T3-full-ensemble.mid`

Lyrical. A singing line in long notes over a flowing left hand, growing towards a late high point. Theme: a four-bar line without an internal repeat; the opening starts with a leap and fills it in by step. It sits on the beat. Accompaniment: left hand rolling arpeggios (lighter passages: broken chords in quarter notes); right hand a moving inner voice; alternate sections change to an Alberti figure in eighth notes. Development: a falling sequence, then a rising sequence; contrast by a sequence on the second bar of the theme; the return as the theme an octave higher; high point with the theme an octave higher. Shape: the texture thickens steadily towards a late high point; dynamics: loudest in the middle. Techniques: ornaments on the return, a run into the high point, octaves at the high point where the template allows, the theme in the left hand in long phrases.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-11 | Chorus | supporting | **+0.8 before, -5.9 final** (trim 6). Lead 55.6, Piano 56.4 before the phrase trim (+0.8). Phrase lowered by 6; asked to sit 5 below (3.1 Piano attacks per lead attack). Final (track): Piano 49.7, -5.9 against the lead. On target. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 12-12 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 13-15 | Verse | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here. |
| 16-16 | Verse | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 17-23 | Chorus | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 24-24 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 25-27 | Bridge | supporting | **+7.8 before, -4.2 final** (trim 12; EXCEPTION). Lead 56.3, Piano 64.1 before the phrase trim (+7.8). Phrase lowered by 12; asked to sit 5 below (2.7 Piano attacks per lead attack). Final (track): Piano 52.1, -4.2 against the lead. Above the target of 51.3 by 0.8: the trim stops at its limit of 12. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 28-28 | Bridge | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 29-35 | Chorus | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 36-36 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 37-40 | Outro | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | cadence (independent: pickup) | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose pickup; changed because the Piano is supporting in the outgoing phrase and the theme is reduced to long notes in this bar. |
| 24 | bar 24: Chorus to Bridge | short-fill | matches: Three-note turn at the end of the bar (14 note(s), 6 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | A short turn fills the end of the bar. |
| 28 | bar 28: Bridge to Chorus | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (7 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 36 | bar 36: Chorus to Outro | descending-resolution | matches: Falling line of 3 notes (15 note(s), 4 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The line steps down and softens into a calmer section. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/CH-T3-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/CH-T3-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/CH-T3-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/CH-T3-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/CH-T3-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/CH-T3-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/CH-T3-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/CH-T3-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/CH-T3-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/CH-T3-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 5-12: First Chorus with the written lead active. `passages/chamber/CH-T3-full-lead-passage-bars5-12-piano.mid`, `passages/chamber/CH-T3-full-lead-passage-bars5-12-ensemble.mid`

## Sonata

### SO-T1-solo - take 1, solo, identity "lyrical"

Files: `full-pieces/sonata/SO-T1-solo-piano.mid`

Lyrical. A singing line in long notes over a flowing left hand, growing towards a late high point. Theme: a four-bar line without an internal repeat; the opening falls from above and turns up at the end. It sits on the beat. Accompaniment: left hand wide broken tenths (lighter passages: a bass note answered by a chord); right hand chords struck twice a bar; alternate sections change to rolling arpeggios. Development: a rising sequence, then a sequence on the second bar of the theme; contrast by a sequence on the second bar of the theme; the return as an ornamented return; high point with a plain statement. Shape: the texture swells and thins twice; dynamics: one long crescendo. Techniques: a run into the high point, octaves at the high point where the template allows, the theme in the left hand in long phrases.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | descending-resolution | matches: Falling line of 3 notes (12 note(s), 4 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The line steps down and softens into a calmer section. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | pickup | matches: Three-note upbeat moving in one direction (16 note(s), 6 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 24 | bar 24: Chorus to Bridge | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 28 | bar 28: Bridge to Chorus | pickup | matches: Three-note upbeat moving in one direction (18 note(s), 6 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/SO-T1-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/SO-T1-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/SO-T1-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/SO-T1-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/SO-T1-solo-bridge-to-chorus-bars27-30-piano.mid`

### SO-T1-full - take 1, full, identity "lyrical"

Files: `full-pieces/sonata/SO-T1-full-piano.mid`, `full-pieces/sonata/SO-T1-full-ensemble.mid`

Lyrical. A singing line in long notes over a flowing left hand, growing towards a late high point. Theme: a four-bar line without an internal repeat; the opening falls from above and turns up at the end. It sits on the beat. Accompaniment: left hand wide broken tenths (lighter passages: a bass note answered by a chord); right hand chords struck twice a bar; alternate sections change to rolling arpeggios. Development: a rising sequence, then a sequence on the second bar of the theme; contrast by a sequence on the second bar of the theme; the return as an ornamented return; high point with a plain statement. Shape: the texture swells and thins twice; dynamics: one long crescendo. Techniques: a run into the high point, octaves at the high point where the template allows, the theme in the left hand in long phrases.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-11 | Chorus | supporting | **-7.4 before, -8.2 final** (trim 0). Lead 55.1, Piano 47.7 before the phrase trim (-7.4). No phrase trim; asked to sit 6 below (4.3 Piano attacks per lead attack). Final (track): Piano 46.9, -8.2 against the lead. On target. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 12-12 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 13-15 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 16-16 | Verse | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 17-23 | Chorus | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 24-24 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 25-27 | Bridge | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 28-28 | Bridge | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 29-35 | Chorus | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 36-36 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 37-40 | Outro | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | short-fill | matches: Three-note turn at the end of the bar (14 note(s), 6 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | A short turn fills the end of the bar. |
| 24 | bar 24: Chorus to Bridge | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 28 | bar 28: Bridge to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 36 | bar 36: Chorus to Outro | descending-resolution | matches: Falling line of 2 notes (5 note(s), 3 in the theme line, attacks at 1 2 3 beat(s)). | The line steps down and softens into a calmer section. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/SO-T1-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/SO-T1-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/SO-T1-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/SO-T1-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/SO-T1-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/SO-T1-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/SO-T1-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/SO-T1-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/SO-T1-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/SO-T1-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 5-12: First Chorus with the written lead active. `passages/sonata/SO-T1-full-lead-passage-bars5-12-piano.mid`, `passages/sonata/SO-T1-full-lead-passage-bars5-12-ensemble.mid`

### SO-T3-solo - take 3, solo, identity "dialogue"

Files: `full-pieces/sonata/SO-T3-solo-piano.mid`

Dialogue. A short call answered in the space it leaves; the idea passes between the hands. Theme: a four-bar theme whose opening returns in bar three; the opening starts with a leap and fills it in by step. It enters after a rest and leaves part of the bar silent. Accompaniment: left hand a walking bass (lighter passages: a bass note answered by a chord); right hand chords struck twice a bar; alternate sections change to an Alberti figure in eighth notes. Development: its closing fragment, then the theme passed between the hands; contrast by the theme turned upside down; the return as an ornamented return; high point with a plain statement. Shape: the texture changes texture in blocks, section by section; dynamics: two swells. Techniques: ornaments on the return, a run into the high point, octaves at the high point where the template allows, the theme often in the left hand.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | descending-resolution | matches: Falling line of 3 notes (8 note(s), 4 in the theme line, attacks at 1 2 3 4 beat(s)). | The line steps down and softens into a calmer section. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | minimal | matches: The bar plays on without a figure (7 note(s), 4 in the theme line, attacks at 1 2 2.5 3 3.5 4 4.5 beat(s)). | No figure: only the dynamic direction of the form is followed. |
| 24 | bar 24: Chorus to Bridge | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 4 in the theme line, attacks at 1 2 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 28 | bar 28: Bridge to Chorus | rising-figure | matches: Rising line of 4 notes in the second half (15 note(s), 6 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The development of the theme already ends this phrase with a run; no second gesture is added. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/SO-T3-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/SO-T3-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/SO-T3-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/SO-T3-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/SO-T3-solo-bridge-to-chorus-bars27-30-piano.mid`

### SO-T3-full - take 3, full, identity "dialogue"

Files: `full-pieces/sonata/SO-T3-full-piano.mid`, `full-pieces/sonata/SO-T3-full-ensemble.mid`

Dialogue. A short call answered in the space it leaves; the idea passes between the hands. Theme: a four-bar theme whose opening returns in bar three; the opening starts with a leap and fills it in by step. It enters after a rest and leaves part of the bar silent. Accompaniment: left hand a walking bass (lighter passages: a bass note answered by a chord); right hand chords struck twice a bar; alternate sections change to an Alberti figure in eighth notes. Development: its closing fragment, then the theme passed between the hands; contrast by the theme turned upside down; the return as an ornamented return; high point with a plain statement. Shape: the texture changes texture in blocks, section by section; dynamics: two swells. Techniques: ornaments on the return, a run into the high point, octaves at the high point where the template allows, the theme often in the left hand.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-11 | Chorus | supporting | **+2.8 before, -5.5 final** (trim 7). Lead 56.1, Piano 58.9 before the phrase trim (+2.8). Phrase lowered by 7; asked to sit 4 below (2.1 Piano attacks per lead attack). Final (track): Piano 50.6, -5.5 against the lead. On target. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 12-12 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 13-15 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 16-16 | Verse | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 17-20 | Chorus | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here. |
| 21-23 | Chorus | supporting | **-7.7 before, -8.2 final** (trim 0). Lead 65.8, Piano 58.2 before the phrase trim (-7.7). No phrase trim; asked to sit 6 below (4 Piano attacks per lead attack). Final (track): Piano 57.6, -8.2 against the lead. On target. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 24-24 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 25-27 | Bridge | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 28-28 | Bridge | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 29-35 | Chorus | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 36-36 | Chorus | featured | not applied (not a supporting phrase) | No other part writes anything in this phrase: the Piano is alone and presents its own material. |
| 37-40 | Outro | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | short-fill | matches: Three-note turn at the end of the bar (13 note(s), 5 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | A short turn fills the end of the bar. |
| 16 | bar 16: Verse to Chorus | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (4 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 24 | bar 24: Chorus to Bridge | short-fill | matches: Three-note turn at the end of the bar (13 note(s), 5 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | A short turn fills the end of the bar. |
| 28 | bar 28: Bridge to Chorus | pickup | matches: Three-note upbeat moving in one direction (11 note(s), 5 in the theme line, attacks at 1 2 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/SO-T3-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/SO-T3-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/SO-T3-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/SO-T3-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/SO-T3-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/SO-T3-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/SO-T3-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/SO-T3-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/SO-T3-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/SO-T3-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 5-12: First Chorus with the written lead active. `passages/sonata/SO-T3-full-lead-passage-bars5-12-piano.mid`, `passages/sonata/SO-T3-full-lead-passage-bars5-12-ensemble.mid`

## Vocal Backing

### VB-T1-solo - take 1, solo, identity "sparse"

Files: `full-pieces/vocalbacking/VB-T1-solo-piano.mid`

Sparse. Few notes and deliberate silences over a held bass; development comes from register and space. Theme: a four-bar theme whose opening returns in bar three; the opening falls from above and turns up at the end. It sits on the beat. Accompaniment: left hand rolling arpeggios (lighter passages: bass and fifth in half notes); right hand held inner notes. Development: the theme reduced to its main notes, then a rising sequence; contrast by the theme turned upside down; the return as the theme an octave higher; high point with the theme an octave higher. Shape: the texture follows the energy of the song without a curve of its own; dynamics: an even level. Techniques: none beyond the basic texture.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | sustained-handover | matches: Everything is struck once and held (3 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 1 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | sustained-handover | matches: Everything is struck once and held (4 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. The same boundary earlier in the form used this gesture; it is recalled. |
| 24 | bar 24: Chorus to Bridge | minimal | matches: The bar plays on without a figure (11 note(s), 1 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | No figure: only the dynamic direction of the form is followed. |
| 28 | bar 28: Bridge to Chorus | sustained-handover | matches: Everything is struck once and held (4 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 1 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/VB-T1-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/VB-T1-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/VB-T1-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/VB-T1-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/VB-T1-solo-bridge-to-chorus-bars27-30-piano.mid`

### VB-T1-full - take 1, full, identity "sparse"

Files: `full-pieces/vocalbacking/VB-T1-full-piano.mid`, `full-pieces/vocalbacking/VB-T1-full-ensemble.mid`

Sparse. Few notes and deliberate silences over a held bass; development comes from register and space. Theme: a four-bar theme whose opening returns in bar three; the opening falls from above and turns up at the end. It sits on the beat. Accompaniment: left hand rolling arpeggios (lighter passages: bass and fifth in half notes); right hand held inner notes. Development: the theme reduced to its main notes, then a rising sequence; contrast by the theme turned upside down; the return as the theme an octave higher; high point with the theme an octave higher. Shape: the texture follows the energy of the song without a curve of its own; dynamics: an even level. Techniques: none beyond the basic texture.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | supporting | no written lead in this phrase | "Verse" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-12 | Chorus | supporting | no written lead in this phrase | "Chorus" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 13-16 | Verse | supporting | no written lead in this phrase | "Verse" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 17-24 | Chorus | supporting | no written lead in this phrase | "Chorus" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 25-28 | Bridge | supporting | no written lead in this phrase | "Bridge" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 29-36 | Chorus | supporting | no written lead in this phrase | "Chorus" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 37-40 | Outro | featured | not applied (not a supporting phrase) | "Outro" is not a sung section: the Piano presents its own material. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 1 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | minimal | matches: The bar plays on without a figure (10 note(s), 1 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | No figure: only the dynamic direction of the form is followed. |
| 24 | bar 24: Chorus to Bridge | sustained-handover | matches: Everything is struck once and held (5 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 28 | bar 28: Bridge to Chorus | none (independent: descending-resolution) | matches: The bar plays on unchanged (4 note(s), 1 in the theme line, attacks at 1 3 beat(s)). | The section runs on into the next one unchanged. The independent composition chose descending-resolution; changed because the Piano is supporting in the outgoing phrase and other parts already fill the end of the bar (11 attacks in its second half against 3.0 usual; trk_20_harp). |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 1 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/VB-T1-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/VB-T1-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/VB-T1-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/VB-T1-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/VB-T1-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/VB-T1-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/VB-T1-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/VB-T1-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/VB-T1-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/VB-T1-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 13-24: Second Verse and Chorus (sung sections). `passages/vocalbacking/VB-T1-full-verse-chorus-bars13-24-piano.mid`, `passages/vocalbacking/VB-T1-full-verse-chorus-bars13-24-ensemble.mid`
- Excerpt, bars 25-28: Bridge. `passages/vocalbacking/VB-T1-full-bridge-bars25-28-piano.mid`, `passages/vocalbacking/VB-T1-full-bridge-bars25-28-ensemble.mid`

### VB-T3-solo - take 3, solo, identity "flowing"

Files: `full-pieces/vocalbacking/VB-T3-solo-piano.mid`

Flowing. Continuous eighth-note motion in the line and the left hand, rising and falling in waves. Theme: a four-bar theme that repeats its opening at once and then continues; the opening descends by step. Its accents fall off the beat. Accompaniment: left hand rolling arpeggios (lighter passages: broken chords in quarter notes); right hand held inner notes; alternate sections change to broken chords in quarter notes. Development: a rising sequence, then fragments of the opening; contrast by the theme turned upside down; the return as the theme an octave higher; high point with the theme an octave higher. Shape: the texture swells and thins twice; dynamics: two swells. Techniques: scale runs.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | descending-resolution | matches: Falling line of 3 notes (9 note(s), 4 in the theme line, attacks at 1 2 3 4 beat(s)). | The line steps down and softens into a calmer section. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | descending-resolution | matches: Falling line of 3 notes (12 note(s), 4 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The line steps down and softens into a calmer section. The same boundary earlier in the form used this gesture; it is recalled. |
| 24 | bar 24: Chorus to Bridge | pickup | matches: Three-note upbeat moving in one direction (9 note(s), 5 in the theme line, attacks at 1 2 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 28 | bar 28: Bridge to Chorus | rising-figure | matches: Rising line of 4 notes in the second half (14 note(s), 5 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The line climbs through the second half of the bar with a crescendo into a stronger section. |
| 36 | bar 36: Chorus to Outro | descending-resolution | matches: Falling line of 3 notes (10 note(s), 4 in the theme line, attacks at 1 2 3 4 beat(s)). | The line steps down and softens into a calmer section. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/VB-T3-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/VB-T3-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/VB-T3-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/VB-T3-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/VB-T3-solo-bridge-to-chorus-bars27-30-piano.mid`

### VB-T3-full - take 3, full, identity "flowing"

Files: `full-pieces/vocalbacking/VB-T3-full-piano.mid`, `full-pieces/vocalbacking/VB-T3-full-ensemble.mid`

Flowing. Continuous eighth-note motion in the line and the left hand, rising and falling in waves. Theme: a four-bar theme that repeats its opening at once and then continues; the opening descends by step. Its accents fall off the beat. Accompaniment: left hand rolling arpeggios (lighter passages: broken chords in quarter notes); right hand held inner notes; alternate sections change to broken chords in quarter notes. Development: a rising sequence, then fragments of the opening; contrast by the theme turned upside down; the return as the theme an octave higher; high point with the theme an octave higher. Shape: the texture swells and thins twice; dynamics: two swells. Techniques: scale runs.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | supporting | no written lead in this phrase | "Verse" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-12 | Chorus | supporting | no written lead in this phrase | "Chorus" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 13-16 | Verse | supporting | no written lead in this phrase | "Verse" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 17-24 | Chorus | supporting | no written lead in this phrase | "Chorus" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 25-28 | Bridge | supporting | no written lead in this phrase | "Bridge" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 29-36 | Chorus | supporting | no written lead in this phrase | "Chorus" is a sung section: the Piano accompanies and answers at the end of the phrase, where a singer breathes. |
| 37-40 | Outro | featured | not applied (not a supporting phrase) | "Outro" is not a sung section: the Piano presents its own material. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | minimal (first selected: pickup) | matches: The bar plays on without a figure (10 note(s), 2 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | No figure: only the dynamic direction of the form is followed. Selected first: pickup. It could not be written into this bar (No three-note figure in the last three eighths (10 note(s), 2 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s))), so no figure is announced. |
| 24 | bar 24: Chorus to Bridge | descending-resolution (independent: rising-figure) | matches: Falling line of 3 notes (10 note(s), 4 in the theme line, attacks at 1 2 3 4 beat(s)). | The line steps down and softens into a calmer section. The independent composition chose rising-figure; changed because the Piano is supporting in the outgoing phrase. |
| 28 | bar 28: Bridge to Chorus | minimal (independent: pickup) | matches: The bar plays on without a figure (6 note(s), 1 in the theme line, attacks at 1 2 3 4 beat(s)). | No figure: only the dynamic direction of the form is followed. The independent composition chose pickup; changed because the Piano is supporting in the outgoing phrase and another part is active at the end of the bar (7 attacks in its second half against 2.3 usual). |
| 36 | bar 36: Chorus to Outro | descending-resolution | matches: Falling line of 3 notes (10 note(s), 4 in the theme line, attacks at 1 2 3 4 beat(s)). | The line steps down and softens into a calmer section. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/VB-T3-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/VB-T3-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/VB-T3-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/VB-T3-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/VB-T3-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/VB-T3-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/VB-T3-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/VB-T3-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/VB-T3-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/VB-T3-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 13-24: Second Verse and Chorus (sung sections). `passages/vocalbacking/VB-T3-full-verse-chorus-bars13-24-piano.mid`, `passages/vocalbacking/VB-T3-full-verse-chorus-bars13-24-ensemble.mid`
- Excerpt, bars 25-28: Bridge. `passages/vocalbacking/VB-T3-full-bridge-bars25-28-piano.mid`, `passages/vocalbacking/VB-T3-full-bridge-bars25-28-ensemble.mid`

## Cinematic

### CI-T1-solo - take 1, solo, identity "sparse"

Files: `full-pieces/cinematic/CI-T1-solo-piano.mid`

Sparse. Few notes and deliberate silences over a held bass; development comes from register and space. Theme: a two-bar idea heard twice, first left open, then closed; the opening starts with a leap and fills it in by step. It sits on the beat and leaves part of the bar silent. Accompaniment: left hand wide broken tenths (lighter passages: bass and fifth in half notes); right hand held inner notes; alternate sections change to rolling arpeggios. Development: the theme reduced to its main notes, then a rising sequence; contrast by the theme reduced to its main notes; the return as a plain statement; high point with a plain statement. Shape: the texture thickens steadily towards a late high point; dynamics: an even level. Techniques: none beyond the basic texture.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | pickup | matches: Three-note upbeat moving in one direction (7 note(s), 5 in the theme line, attacks at 1 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 12 | bar 12: Chorus to Verse | sustained-handover | matches: Everything is struck once and held (5 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 16 | bar 16: Verse to Chorus | pickup | matches: Three-note upbeat moving in one direction (7 note(s), 5 in the theme line, attacks at 1 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. The same boundary earlier in the form used this gesture; it is recalled. |
| 24 | bar 24: Chorus to Bridge | sustained-handover | matches: Everything is struck once and held (6 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 28 | bar 28: Bridge to Chorus | pickup | matches: Three-note upbeat moving in one direction (14 note(s), 5 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 36 | bar 36: Chorus to Outro | descending-resolution | matches: Falling line of 3 notes (16 note(s), 4 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The line steps down and softens into a calmer section. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/CI-T1-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/CI-T1-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/CI-T1-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/CI-T1-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/CI-T1-solo-bridge-to-chorus-bars27-30-piano.mid`

### CI-T1-full - take 1, full, identity "sparse"

Files: `full-pieces/cinematic/CI-T1-full-piano.mid`, `full-pieces/cinematic/CI-T1-full-ensemble.mid`

Sparse. Few notes and deliberate silences over a held bass; development comes from register and space. Theme: a two-bar idea heard twice, first left open, then closed; the opening starts with a leap and fills it in by step. It sits on the beat and leaves part of the bar silent. Accompaniment: left hand wide broken tenths (lighter passages: bass and fifth in half notes); right hand held inner notes; alternate sections change to rolling arpeggios. Development: the theme reduced to its main notes, then a rising sequence; contrast by the theme reduced to its main notes; the return as a plain statement; high point with a plain statement. Shape: the texture thickens steadily towards a late high point; dynamics: an even level. Techniques: none beyond the basic texture.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | atmospheric | not applied (not a supporting phrase) | A quiet phrase carried by others: the Piano adds sustained colour in a register that is free. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-8 | Chorus | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here. |
| 9-12 | Chorus | supporting | Not measured: the lead is written in 1 of 4 sounding bars of the phrase (at least half are needed). | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 13-15 | Verse | atmospheric | not applied (not a supporting phrase) | A quiet phrase carried by others: the Piano adds sustained colour in a register that is free. |
| 16-16 | Verse | atmospheric | not applied (not a supporting phrase) | A one-bar phrase keeps the role of the phrase before it. First choice was supporting. |
| 17-19 | Chorus | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here. |
| 20-24 | Chorus | supporting | Not measured: the lead is written in 1 of 5 sounding bars of the phrase (at least half are needed). | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 25-28 | Bridge | supporting | **-8.5 before, -8.8 final** (trim 0). Lead 63.6, Piano 55.1 before the phrase trim (-8.5). No phrase trim; asked to sit 6 below (4 Piano attacks per lead attack). Final (track): Piano 54.8, -8.8 against the lead. On target. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 29-29 | Chorus | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 30-36 | Chorus | featured | not applied (not a supporting phrase) | No other part claims the phrase: the Piano presents its theme and full texture. |
| 37-40 | Outro | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | sustained-handover | matches: Everything is struck once and held (5 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 16 | bar 16: Verse to Chorus | cadence (independent: pickup) | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose pickup; changed because the Piano is atmospheric in the outgoing phrase and the theme is reduced to long notes in this bar. |
| 24 | bar 24: Chorus to Bridge | sustained-handover | matches: Everything is struck once and held (6 note(s), 1 in the theme line, attacks at 1 beat(s)). | Everything is held and softened, handing the next section over without a figure. |
| 28 | bar 28: Bridge to Chorus | none (independent: pickup) | matches: The bar plays on unchanged (12 note(s), 2 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The section runs on into the next one unchanged. The independent composition chose pickup; changed because the Piano is supporting in the outgoing phrase and other parts already fill the end of the bar (12 attacks in its second half against 6.3 usual; trk_20_harp). |
| 36 | bar 36: Chorus to Outro | descending-resolution | matches: Falling line of 3 notes (14 note(s), 4 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The line steps down and softens into a calmer section. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/CI-T1-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/CI-T1-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/CI-T1-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/CI-T1-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/CI-T1-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/CI-T1-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/CI-T1-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/CI-T1-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/CI-T1-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/CI-T1-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 29-36: Last Chorus, full orchestra. `passages/cinematic/CI-T1-full-tutti-bars29-36-piano.mid`, `passages/cinematic/CI-T1-full-tutti-bars29-36-ensemble.mid`

### CI-T3-solo - take 3, solo, identity "lyrical"

Files: `full-pieces/cinematic/CI-T3-solo-piano.mid`

Lyrical. A singing line in long notes over a flowing left hand, growing towards a late high point. Theme: a four-bar line without an internal repeat; the opening falls from above and turns up at the end. It sits on the beat. Accompaniment: left hand wide broken tenths (lighter passages: broken chords in quarter notes); right hand chords struck twice a bar; alternate sections change to rolling arpeggios. Development: a rising sequence, then the theme turned upside down; contrast by the theme turned upside down; the return as an ornamented return; high point with a plain statement. Shape: the texture swells and thins twice; dynamics: one long crescendo. Techniques: ornaments on the return, a run into the high point, octaves at the high point where the template allows.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | pickup | matches: Three-note upbeat moving in one direction (11 note(s), 6 in the theme line, attacks at 1 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 2 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | pickup | matches: Three-note upbeat moving in one direction (17 note(s), 6 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. The same boundary earlier in the form used this gesture; it is recalled. |
| 24 | bar 24: Chorus to Bridge | descending-resolution | matches: Falling line of 2 notes (6 note(s), 3 in the theme line, attacks at 1 2 3 beat(s)). | The line steps down and softens into a calmer section. |
| 28 | bar 28: Bridge to Chorus | rising-figure | matches: Rising line of 6 notes in the second half (15 note(s), 7 in the theme line, attacks at 1 1.5 2 2.5 3 3.25 3.5 3.75 4 4.25 4.5 beat(s)). | The development of the theme already ends this phrase with a run; no second gesture is added. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (8 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/CI-T3-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/CI-T3-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/CI-T3-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/CI-T3-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/CI-T3-solo-bridge-to-chorus-bars27-30-piano.mid`

### CI-T3-full - take 3, full, identity "lyrical"

Files: `full-pieces/cinematic/CI-T3-full-piano.mid`, `full-pieces/cinematic/CI-T3-full-ensemble.mid`

Lyrical. A singing line in long notes over a flowing left hand, growing towards a late high point. Theme: a four-bar line without an internal repeat; the opening falls from above and turns up at the end. It sits on the beat. Accompaniment: left hand wide broken tenths (lighter passages: broken chords in quarter notes); right hand chords struck twice a bar; alternate sections change to rolling arpeggios. Development: a rising sequence, then the theme turned upside down; contrast by the theme turned upside down; the return as an ornamented return; high point with a plain statement. Shape: the texture swells and thins twice; dynamics: one long crescendo. Techniques: ornaments on the return, a run into the high point, octaves at the high point where the template allows.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | atmospheric | not applied (not a supporting phrase) | A quiet phrase carried by others: the Piano adds sustained colour in a register that is free. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-8 | Chorus | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here. |
| 9-12 | Chorus | restrained | not applied (not a supporting phrase) | The orchestra is already writing densely in both the Piano's upper and lower registers: the Piano reduces to what still adds something. |
| 13-16 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 17-24 | Chorus | restrained | not applied (not a supporting phrase) | The orchestra is already writing densely in both the Piano's upper and lower registers: the Piano reduces to what still adds something. |
| 25-28 | Bridge | supporting | **-8.4 before, -9 final** (trim 0). Lead 59.9, Piano 51.5 before the phrase trim (-8.4). No phrase trim; asked to sit 2 below (0.8 Piano attacks per lead attack). Final (track): Piano 50.9, -9 against the lead. On target. | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 29-29 | Chorus | supporting | no written lead in this phrase | Another part carries the phrase: the Piano accompanies and answers with its theme where there is room. |
| 30-36 | Chorus | featured | not applied (not a supporting phrase) | No other part claims the phrase: the Piano presents its theme and full texture. |
| 37-40 | Outro | atmospheric | not applied (not a supporting phrase) | A quiet phrase carried by others: the Piano adds sustained colour in a register that is free. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | none (independent: cadence) | matches: The Piano is silent in this bar (0 note(s), 0 in the theme line, attacks at no beat(s)). | No gesture: the Piano rests for this whole bar (restrained role, both registers are full). The independent composition chose cadence. |
| 16 | bar 16: Verse to Chorus | none (independent: pickup) | matches: The bar plays on unchanged (9 note(s), 5 in the theme line, attacks at 1 2 2.5 3 4 4.5 beat(s)). | The section runs on into the next one unchanged. The independent composition chose pickup; changed because other parts already fill the end of the bar (24 attacks in its second half against 15.8 usual; trk_03_violins1, trk_13_clarinets, trk_15_timpani, trk_20_harp). |
| 24 | bar 24: Chorus to Bridge | none (independent: descending-resolution) | matches: The Piano is silent in this bar (0 note(s), 0 in the theme line, attacks at no beat(s)). | No gesture: the Piano rests for this whole bar (restrained role, both registers are full). The independent composition chose descending-resolution. |
| 28 | bar 28: Bridge to Chorus | none (independent: pickup) | matches: The bar plays on unchanged (6 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | The section runs on into the next one unchanged. The independent composition chose pickup; changed because the Piano is supporting in the outgoing phrase and other parts already fill the end of the bar (30 attacks in its second half against 14.5 usual; trk_03_violins1, trk_04_violins2, trk_05_violas, trk_06_cellosBasses, trk_07_horns, trk_11_flutes, trk_14_bassoons, trk_15_timpani, trk_20_harp) and the theme is reduced to long notes in this bar. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (8 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/CI-T3-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/CI-T3-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/CI-T3-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/CI-T3-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/CI-T3-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/CI-T3-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/CI-T3-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/CI-T3-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/CI-T3-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/CI-T3-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 29-36: Last Chorus, full orchestra. `passages/cinematic/CI-T3-full-tutti-bars29-36-piano.mid`, `passages/cinematic/CI-T3-full-tutti-bars29-36-ensemble.mid`

## Hybrid Studio

### HY-T1-solo - take 1, solo, identity "rhythmic"

Files: `full-pieces/hybridstudio/HY-T1-solo-piano.mid`

Rhythmic. A short, accented figure that both hands keep returning to; steady pulse, stepped dynamics. Theme: a four-bar theme that repeats its opening at once and then continues; the opening moves in a zigzag. It sits on the beat. Accompaniment: left hand a stride pattern (lighter passages: a bass note answered by a chord); right hand short off-beat chords; alternate sections change to a quarter-note pulse. Development: fragments of the opening, then a falling sequence; contrast by the theme reduced to its main notes; the return as a plain statement; high point with the theme an octave higher. Shape: the texture changes texture in blocks, section by section; dynamics: two swells. Techniques: octaves at the high point where the template allows.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | chordal-punctuation | matches: Two struck chords (8 note(s), 2 in the theme line, attacks at 1 4 beat(s)). | Two struck chords close the section: one on the downbeat, one before the bar line. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (7 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | chordal-punctuation | matches: Two struck chords (8 note(s), 2 in the theme line, attacks at 1 4 beat(s)). | Two struck chords close the section: one on the downbeat, one before the bar line. The same boundary earlier in the form used this gesture; it is recalled. |
| 24 | bar 24: Chorus to Bridge | descending-resolution | matches: Falling line of 3 notes (13 note(s), 4 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 beat(s)). | The line steps down and softens into a calmer section. |
| 28 | bar 28: Bridge to Chorus | pickup | matches: Three-note upbeat moving in one direction (12 note(s), 6 in the theme line, attacks at 1 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (6 note(s), 3 in the theme line, attacks at 1 2.5 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/HY-T1-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/HY-T1-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/HY-T1-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/HY-T1-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/HY-T1-solo-bridge-to-chorus-bars27-30-piano.mid`

### HY-T1-full - take 1, full, identity "rhythmic"

Files: `full-pieces/hybridstudio/HY-T1-full-piano.mid`, `full-pieces/hybridstudio/HY-T1-full-ensemble.mid`

Rhythmic. A short, accented figure that both hands keep returning to; steady pulse, stepped dynamics. Theme: a four-bar theme that repeats its opening at once and then continues; the opening moves in a zigzag. It sits on the beat. Accompaniment: left hand a stride pattern (lighter passages: a bass note answered by a chord); right hand short off-beat chords; alternate sections change to a quarter-note pulse. Development: fragments of the opening, then a falling sequence; contrast by the theme reduced to its main notes; the return as a plain statement; high point with the theme an octave higher. Shape: the texture changes texture in blocks, section by section; dynamics: two swells. Techniques: octaves at the high point where the template allows.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-12 | Chorus | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. |
| 13-16 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 17-24 | Chorus | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. |
| 25-27 | Bridge | atmospheric | not applied (not a supporting phrase) | A quiet phrase carried by others: the Piano adds sustained colour in a register that is free. |
| 28-28 | Bridge | atmospheric | not applied (not a supporting phrase) | A one-bar phrase keeps the role of the phrase before it. First choice was rhythmic. |
| 29-31 | Chorus | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. |
| 32-36 | Chorus | rhythmic | not applied (not a supporting phrase) | Borderline score 0.23 inside "Chorus": the role of the previous phrase is kept. First choice was featured. |
| 37-40 | Outro | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 0 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | bar 16: Verse to Chorus | minimal (first selected: pickup) | matches: The bar plays on without a figure (10 note(s), 3 in the theme line, attacks at 1 2 2.5 3 3.5 4 beat(s)). | No figure: only the dynamic direction of the form is followed. Selected first: pickup. It could not be written into this bar (No three-note figure in the last three eighths (12 note(s), 3 in the theme line, attacks at 1 2 2.5 3 3.5 4 beat(s))), so no figure is announced. |
| 24 | bar 24: Chorus to Bridge | cadence (independent: descending-resolution) | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 0 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose descending-resolution; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |
| 28 | bar 28: Bridge to Chorus | minimal (independent: pickup) | matches: The bar plays on without a figure (5 note(s), 2 in the theme line, attacks at 1 3 beat(s)). | No figure: only the dynamic direction of the form is followed. The independent composition chose pickup; changed because the Piano is atmospheric in the outgoing phrase and the theme is reduced to long notes in this bar. |
| 36 | bar 36: Chorus to Outro | cadence | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 0 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/HY-T1-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/HY-T1-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/HY-T1-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/HY-T1-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/HY-T1-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/HY-T1-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/HY-T1-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/HY-T1-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/HY-T1-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/HY-T1-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 29-36: Last Chorus, full ensemble. `passages/hybridstudio/HY-T1-full-tutti-bars29-36-piano.mid`, `passages/hybridstudio/HY-T1-full-tutti-bars29-36-ensemble.mid`

### HY-T3-solo - take 3, solo, identity "flowing"

Files: `full-pieces/hybridstudio/HY-T3-solo-piano.mid`

Flowing. Continuous eighth-note motion in the line and the left hand, rising and falling in waves. Theme: a four-bar line without an internal repeat; the opening climbs by step. Its accents fall off the beat. Accompaniment: left hand a 3+3+2 ostinato (lighter passages: a quarter-note pulse); right hand chords struck twice a bar. Development: a sequence on the second bar of the theme, then a rising sequence; contrast by a falling sequence; the return as the theme an octave higher; high point with a rising sequence. Shape: the texture swells and thins twice; dynamics: two swells. Techniques: ornaments on the return, scale runs.

Orchestral evidence: none. Every phrase is featured; the adapted pass is the independent composition.

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | pickup | matches: Three-note upbeat moving in one direction (12 note(s), 6 in the theme line, attacks at 1 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. |
| 12 | bar 12: Chorus to Verse | descending-resolution | matches: Falling line of 2 notes (3 note(s), 2 in the theme line, attacks at 1 2 3 beat(s)). | The line steps down and softens into a calmer section. |
| 16 | bar 16: Verse to Chorus | pickup | matches: Three-note upbeat moving in one direction (14 note(s), 6 in the theme line, attacks at 1 2 2.5 3 3.5 4 4.5 beat(s)). | The theme leads into the new section with an upbeat that arrives on its first note. The same boundary earlier in the form used this gesture; it is recalled. |
| 24 | bar 24: Chorus to Bridge | descending-resolution | matches: Falling line of 3 notes (10 note(s), 4 in the theme line, attacks at 1 2 3 4 beat(s)). | The line steps down and softens into a calmer section. |
| 28 | bar 28: Bridge to Chorus | rising-figure | matches: Rising line of 4 notes in the second half (14 note(s), 6 in the theme line, attacks at 1 2 2.5 3 3.25 3.5 3.75 4 beat(s)). | The development of the theme already ends this phrase with a run; no second gesture is added. |
| 36 | bar 36: Chorus to Outro | descending-resolution | matches: Falling line of 2 notes (9 note(s), 3 in the theme line, attacks at 1 2 3 4 beat(s)). | The line steps down and softens into a calmer section. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/HY-T3-solo-verse-to-chorus-bars3-6-piano.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/HY-T3-solo-chorus-to-verse-bars11-14-piano.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/HY-T3-solo-verse-to-chorus-2-bars15-18-piano.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/HY-T3-solo-chorus-to-bridge-bars23-26-piano.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/HY-T3-solo-bridge-to-chorus-bars27-30-piano.mid`

### HY-T3-full - take 3, full, identity "flowing"

Files: `full-pieces/hybridstudio/HY-T3-full-piano.mid`, `full-pieces/hybridstudio/HY-T3-full-ensemble.mid`

Flowing. Continuous eighth-note motion in the line and the left hand, rising and falling in waves. Theme: a four-bar line without an internal repeat; the opening climbs by step. Its accents fall off the beat. Accompaniment: left hand a 3+3+2 ostinato (lighter passages: a quarter-note pulse); right hand chords struck twice a bar. Development: a sequence on the second bar of the theme, then a rising sequence; contrast by a falling sequence; the return as the theme an octave higher; high point with a rising sequence. Shape: the texture swells and thins twice; dynamics: two swells. Techniques: ornaments on the return, scale runs.

| bars | section | role | Piano minus lead, mean note velocity in the bars of the lead (final = exported track) | why |
|---|---|---|---|---|
| 1-3 | Verse | atmospheric | not applied (not a supporting phrase) | A quiet phrase carried by others: the Piano adds sustained colour in a register that is free. |
| 4-4 | Verse | featured | not applied (not a supporting phrase) | Rest phrase: nothing to present. |
| 5-12 | Chorus | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. |
| 13-16 | Verse | featured | not applied (not a supporting phrase) | A lead is present but leaves room: the Piano presents its theme beside it as a second melodic voice. |
| 17-20 | Chorus | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. A soli or unison moment without the Piano covers most of the phrase, so the Piano does not feature its theme here. |
| 21-24 | Chorus | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. |
| 25-28 | Bridge | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. |
| 29-29 | Chorus | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. |
| 30-36 | Chorus | rhythmic | not applied (not a supporting phrase) | The piece's identity is rhythmic and the phrase has energy: the Piano keeps its rhythm and bass function and withholds the theme. |
| 37-40 | Outro | atmospheric | not applied (not a supporting phrase) | A quiet phrase carried by others: the Piano adds sustained colour in a register that is free. |

| last bar | boundary | decision | found in the final score | why |
|---|---|---|---|---|
| 4 | bar 4: Verse to Chorus | break | matches: The bar is silent (0 note(s), 0 in the theme line, attacks at no beat(s)). | The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | bar 12: Chorus to Verse | cadence (independent: descending-resolution) | matches: Half-bar accompaniment, last theme note held to the bar line (2 note(s), 0 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose descending-resolution; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |
| 16 | bar 16: Verse to Chorus | minimal (first selected: pickup) | matches: The bar plays on without a figure (11 note(s), 3 in the theme line, attacks at 1 2 2.5 3 3.5 4 4.5 beat(s)). | No figure: only the dynamic direction of the form is followed. Selected first: pickup. It could not be written into this bar (No three-note figure in the last three eighths (11 note(s), 3 in the theme line, attacks at 1 2 2.5 3 3.5 4 4.5 beat(s))), so no figure is announced. |
| 24 | bar 24: Chorus to Bridge | cadence (independent: descending-resolution) | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 0 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose descending-resolution; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |
| 28 | bar 28: Bridge to Chorus | chordal-punctuation (independent: rising-figure) | matches: Two struck chords (6 note(s), 0 in the theme line, attacks at 1 4 beat(s)). | Two struck chords close the section: one on the downbeat, one before the bar line. The independent composition chose rising-figure; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |
| 36 | bar 36: Chorus to Outro | cadence (independent: descending-resolution) | matches: Half-bar accompaniment, last theme note held to the bar line (5 note(s), 0 in the theme line, attacks at 1 3 beat(s)). | The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose descending-resolution; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |

- Excerpt, bars 3-6: Verse into Chorus (boundary after bar 4; the conductor marks bar 4 as a near-silence bar). `boundaries/verse-to-chorus/HY-T3-full-verse-to-chorus-bars3-6-piano.mid`, `boundaries/verse-to-chorus/HY-T3-full-verse-to-chorus-bars3-6-ensemble.mid`
- Excerpt, bars 11-14: Chorus into Verse (boundary after bar 12). `boundaries/chorus-to-verse/HY-T3-full-chorus-to-verse-bars11-14-piano.mid`, `boundaries/chorus-to-verse/HY-T3-full-chorus-to-verse-bars11-14-ensemble.mid`
- Excerpt, bars 15-18: Second Verse into Chorus (boundary after bar 16). `boundaries/verse-to-chorus-2/HY-T3-full-verse-to-chorus-2-bars15-18-piano.mid`, `boundaries/verse-to-chorus-2/HY-T3-full-verse-to-chorus-2-bars15-18-ensemble.mid`
- Excerpt, bars 23-26: Second Chorus into the Bridge (boundary after bar 24). `boundaries/chorus-to-bridge/HY-T3-full-chorus-to-bridge-bars23-26-piano.mid`, `boundaries/chorus-to-bridge/HY-T3-full-chorus-to-bridge-bars23-26-ensemble.mid`
- Excerpt, bars 27-30: Bridge into the last Chorus (boundary after bar 28). `boundaries/bridge-to-chorus/HY-T3-full-bridge-to-chorus-bars27-30-piano.mid`, `boundaries/bridge-to-chorus/HY-T3-full-bridge-to-chorus-bars27-30-ensemble.mid`
- Excerpt, bars 29-36: Last Chorus, full ensemble. `passages/hybridstudio/HY-T3-full-tutti-bars29-36-piano.mid`, `passages/hybridstudio/HY-T3-full-tutti-bars29-36-ensemble.mid`

