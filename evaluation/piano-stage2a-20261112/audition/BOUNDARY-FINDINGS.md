# Boundary findings - decision against the notes in the MIDI files

Every row is read from the files of this package: `before/full-pieces/<template>/<file>` and `after/full-pieces/<template>/<file>` (Piano track, full arrangement).
"Decision" and "why" come from the composer diagnostics; "before" and "after" are the notes found in that bar of the exported MIDI file.
"Other parts" is the number of notes the rest of the ensemble starts in the bar. These are statements about notes, not about sound.

Kinds of silence used in the last column:

- **near-silence bar**: the conductor marks the bar near-silent with zero energy; the whole ensemble rests. The Piano is not allowed new attacks. Orchestral restriction.
- **leave-space window**: the plan keeps a fill window open and another part is written in it. Existing rule of the plan, unchanged.
- **role rest**: the Piano is Restrained in the phrase and rests both hands because both registers are full. Decision `none`, by the role.
- **other parts fill the bar**: the adaptation withdrew the gesture; the texture of the phrase continues (the bar need not be silent).

## Chamber take 1 (`CH-T1-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | silent | silent | 0 | **near-silence bar** Piano-owned fill window, opened for the transition decision. The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | cadence; role featured | matches | silent | 7 notes, attacks on beats 1 2 3 | 0 |  Piano-owned fill window, opened for the transition decision. The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | chordal-punctuation; role supporting | matches | silent | 6 notes, attacks on beats 1 4 | 0 |  Piano-owned fill window, opened for the transition decision. Two struck chords close the section: one on the downbeat, one before the bar line. |
| 24 | sustained-handover; role featured | matches | silent | 5 notes, attacks on beats 1 | 0 |  Piano-owned fill window, opened for the transition decision. Everything is held and softened, handing the next section over without a figure. |
| 28 | chordal-punctuation; role featured | matches | silent | 8 notes, attacks on beats 1 4 | 0 |  Piano-owned fill window, opened for the transition decision. Two struck chords close the section: one on the downbeat, one before the bar line. |
| 36 | cadence; role featured | matches | 6 notes, attacks on beats 1 3 | 7 notes, attacks on beats 1 2 3 | 0 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |

## Chamber take 3 (`CH-T3-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | silent | silent | 0 | **near-silence bar** Piano-owned fill window, opened for the transition decision. The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | cadence; role featured | matches | silent | 6 notes, attacks on beats 1 2.5 3 | 0 |  Piano-owned fill window, opened for the transition decision. The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | cadence (independent: pickup); role supporting | matches | 7 notes, attacks on beats 1 2 3 4 | 5 notes, attacks on beats 1 3 | 0 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose pickup; changed because the Piano is supporting in the outgoing phrase and the theme is reduced to long notes in this bar. |
| 24 | short-fill; role featured | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 14 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 0 |  A short turn fills the end of the bar. |
| 28 | cadence; role featured | matches | 12 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 7 notes, attacks on beats 1 2.5 3 | 0 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 36 | descending-resolution; role featured | matches | silent | 16 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 0 |  Piano-owned fill window, opened for the transition decision. The line steps down and softens into a calmer section. |

## Sonata take 1 (`SO-T1-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | silent | silent | 0 | **near-silence bar** The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | cadence; role featured | matches | 12 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 6 notes, attacks on beats 1 2.5 3 | 2 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | short-fill; role featured | matches | 6 notes, attacks on beats 1 2.5 3 | 14 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 1 |  A short turn fills the end of the bar. |
| 24 | cadence; role featured | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 7 notes, attacks on beats 1 2.5 3 4.5 | 1 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 28 | break; role featured | matches | silent | silent | 2 | **leave-space window** (another part is written in it) The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 36 | descending-resolution; role featured | matches | 9 notes, attacks on beats 1 2 3 4 4.5 | 5 notes, attacks on beats 1 2 3 | 2 |  The line steps down and softens into a calmer section. |

## Sonata take 3 (`SO-T3-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | silent | silent | 0 | **near-silence bar** The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | short-fill; role featured | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 2 |  A short turn fills the end of the bar. |
| 16 | cadence; role featured | matches | 6 notes, attacks on beats 1 1.5 3 | 5 notes, attacks on beats 1 1.5 3 | 1 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 24 | short-fill; role featured | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 2 |  A short turn fills the end of the bar. |
| 28 | pickup; role featured | matches | 8 notes, attacks on beats 1 1.5 3 4.5 | 11 notes, attacks on beats 1 2 3 3.5 4 4.5 | 2 |  The theme leads into the new section with an upbeat that arrives on its first note. |
| 36 | cadence; role featured | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 7 notes, attacks on beats 1 3 4.5 | 2 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |

## Vocal Backing take 1 (`VB-T1-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | 1 notes, attacks on beats 1.5 | silent | 0 | **near-silence bar** The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | cadence; role supporting | matches | 5 notes, attacks on beats 1 3 | 5 notes, attacks on beats 1 3 | 10 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | minimal; role supporting | matches | 5 notes, attacks on beats 1 3 4.5 | 11 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 3 |  No figure: only the dynamic direction of the form is followed. |
| 24 | sustained-handover; role supporting | matches | 11 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 5 notes, attacks on beats 1 | 7 |  Everything is held and softened, handing the next section over without a figure. |
| 28 | none (independent: descending-resolution); role supporting | matches | 5 notes, attacks on beats 1 1.5 3 | 5 notes, attacks on beats 1 1.5 3 | 22 |  The section runs on into the next one unchanged. The independent composition chose descending-resolution; changed because the Piano is supporting in the outgoing phrase and other parts already fill the end of the bar (11 attacks in its second half against 3.0 usual; trk_20_harp). |
| 36 | cadence; role supporting | matches | 11 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 5 notes, attacks on beats 1 3 | 10 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |

## Vocal Backing take 3 (`VB-T3-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | silent | silent | 0 | **near-silence bar** The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | cadence; role supporting | matches | 8 notes, attacks on beats 1 2 3 4 | 5 notes, attacks on beats 1 3 | 14 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | minimal (first selected: pickup); role supporting | matches | 10 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 10 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 7 |  No figure: only the dynamic direction of the form is followed. Selected first: pickup. It could not be written into this bar (No three-note figure in the last three eighths (10 note(s), 2 in the theme line, attacks at 1 1.5 2 2.5 3 3.5 4 4.5 beat(s))), so no figure is announced. |
| 24 | descending-resolution (independent: rising-figure); role supporting | matches | 9 notes, attacks on beats 1 2 3 4 4.5 | 11 notes, attacks on beats 1 2 3 4 4.5 | 9 |  The line steps down and softens into a calmer section. The independent composition chose rising-figure; changed because the Piano is supporting in the outgoing phrase. |
| 28 | minimal (independent: pickup); role supporting | matches | 7 notes, attacks on beats 1 1.5 2 3 4 | 7 notes, attacks on beats 1 1.5 2 3 4 | 14 |  No figure: only the dynamic direction of the form is followed. The independent composition chose pickup; changed because the Piano is supporting in the outgoing phrase and another part is active at the end of the bar (7 attacks in its second half against 2.3 usual). |
| 36 | descending-resolution; role supporting | matches | 8 notes, attacks on beats 1 2 3 4 | 10 notes, attacks on beats 1 2 3 4 | 17 |  The line steps down and softens into a calmer section. |

## Cinematic take 1 (`CI-T1-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | silent | silent | 0 | **near-silence bar** The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | sustained-handover; role supporting | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 6 notes, attacks on beats 1 1.5 | 31 |  Everything is held and softened, handing the next section over without a figure. |
| 16 | cadence (independent: pickup); role atmospheric | matches | 5 notes, attacks on beats 1 3 | 5 notes, attacks on beats 1 3 | 23 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose pickup; changed because the Piano is atmospheric in the outgoing phrase and the theme is reduced to long notes in this bar. |
| 24 | sustained-handover; role supporting | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 6 notes, attacks on beats 1 | 26 |  Everything is held and softened, handing the next section over without a figure. |
| 28 | none (independent: pickup); role supporting | matches | 12 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 12 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 21 |  The section runs on into the next one unchanged. The independent composition chose pickup; changed because the Piano is supporting in the outgoing phrase and other parts already fill the end of the bar (12 attacks in its second half against 6.3 usual; trk_20_harp). |
| 36 | descending-resolution; role featured | matches | 14 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 14 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 4.5 | 30 |  The line steps down and softens into a calmer section. |

## Cinematic take 3 (`CI-T3-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | silent | silent | 0 | **near-silence bar** The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | none (independent: cadence); role restrained | matches | 9 notes, attacks on beats 1 1.5 2 3 4 | silent | 67 | **role rest** No gesture: the Piano rests for this whole bar (restrained role, both registers are full). The independent composition chose cadence. |
| 16 | none (independent: pickup); role featured | matches | 7 notes, attacks on beats 1 2 3 4 | 9 notes, attacks on beats 1 2 2.5 3 4 4.5 | 47 |  The section runs on into the next one unchanged. The independent composition chose pickup; changed because other parts already fill the end of the bar (24 attacks in its second half against 15.8 usual; trk_03_violins1, trk_13_clarinets, trk_15_timpani, trk_20_harp). |
| 24 | none (independent: descending-resolution); role restrained | matches | 8 notes, attacks on beats 1 2 3 4 | silent | 51 | **role rest** No gesture: the Piano rests for this whole bar (restrained role, both registers are full). The independent composition chose descending-resolution. |
| 28 | none (independent: pickup); role supporting | matches | 9 notes, attacks on beats 1 2 3 4 | 6 notes, attacks on beats 1 3 | 65 |  The section runs on into the next one unchanged. The independent composition chose pickup; changed because the Piano is supporting in the outgoing phrase and other parts already fill the end of the bar (30 attacks in its second half against 14.5 usual; trk_03_violins1, trk_04_violins2, trk_05_violas, trk_06_cellosBasses, trk_07_horns, trk_11_flutes, trk_14_bassoons, trk_15_timpani, trk_20_harp) and the theme is reduced to long notes in this bar. |
| 36 | cadence; role featured | matches | 10 notes, attacks on beats 1 2 3 4 4.5 | 11 notes, attacks on beats 1 2.5 3 4.5 | 66 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |

## Hybrid Studio take 1 (`HY-T1-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | 1 notes, attacks on beats 1.5 | silent | 0 | **near-silence bar** The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | cadence; role rhythmic | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 | 5 notes, attacks on beats 1 3 | 23 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |
| 16 | minimal (first selected: pickup); role featured | matches | 11 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 | 11 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 | 2 |  No figure: only the dynamic direction of the form is followed. Selected first: pickup. It could not be written into this bar (No three-note figure in the last three eighths (12 note(s), 3 in the theme line, attacks at 1 2 2.5 3 3.5 4 beat(s))), so no figure is announced. |
| 24 | cadence (independent: descending-resolution); role rhythmic | matches | 11 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 | 6 notes, attacks on beats 1 1.5 3 | 23 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose descending-resolution; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |
| 28 | minimal (independent: pickup); role atmospheric | matches | 8 notes, attacks on beats 1 2 3 3.5 | 5 notes, attacks on beats 1 3 | 7 |  No figure: only the dynamic direction of the form is followed. The independent composition chose pickup; changed because the Piano is atmospheric in the outgoing phrase and the theme is reduced to long notes in this bar. |
| 36 | cadence; role rhythmic | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 3.5 4 | 5 notes, attacks on beats 1 3 | 22 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. |

## Hybrid Studio take 3 (`HY-T3-full-piano.mid`)

| last bar | decision | check of the final score | before (932356f) | after | other parts | why / kind |
|---|---|---|---|---|---|---|
| 4 | break; role featured | matches | 1 notes, attacks on beats 1.5 | silent | 0 | **near-silence bar** The bar is a supplied near-silence or leave-space window: the Piano is silent for the whole bar and writes no isolated note into it. |
| 12 | cadence (independent: descending-resolution); role rhythmic | matches | 13 notes, attacks on beats 1 1.5 2 2.5 3 4 | 3 notes, attacks on beats 1 1.5 3 | 16 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose descending-resolution; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |
| 16 | minimal (first selected: pickup); role featured | matches | 12 notes, attacks on beats 1 2 2.5 3 3.5 4 4.5 | 12 notes, attacks on beats 1 2 2.5 3 3.5 4 4.5 | 7 |  No figure: only the dynamic direction of the form is followed. Selected first: pickup. It could not be written into this bar (No three-note figure in the last three eighths (11 note(s), 3 in the theme line, attacks at 1 2 2.5 3 3.5 4 4.5 beat(s))), so no figure is announced. |
| 24 | cadence (independent: descending-resolution); role rhythmic | matches | 11 notes, attacks on beats 1 2 2.5 3 3.5 4 4.5 | 5 notes, attacks on beats 1 3 | 16 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose descending-resolution; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |
| 28 | chordal-punctuation (independent: rising-figure); role rhythmic | matches | 6 notes, attacks on beats 1 2 3 4 | 6 notes, attacks on beats 1 4 | 20 |  Two struck chords close the section: one on the downbeat, one before the bar line. The independent composition chose rising-figure; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |
| 36 | cadence (independent: descending-resolution); role rhythmic | matches | 9 notes, attacks on beats 1 2 2.5 3 4 | 5 notes, attacks on beats 1 3 | 16 |  The bar broadens into a cadence: bass, then the held chord, slightly softer. The independent composition chose descending-resolution; changed because the Piano is rhythmic in the outgoing phrase and the theme is withheld in this bar. |

