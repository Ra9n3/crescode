# Piano Stage 4 Musical Auditions

Generated 2026-11-08. These deterministic, Piano-only MIDI files are prepared for human listening. The structural observations below do **not** establish sound quality.

## Production path and scope

- Each audition used the production `composeAllTracks` path: Piano Engine input → `analyzePianoInput` → `composePianoPlan` → `composePianoScore` → `realizePianoPlanWithAudit` → Piano-only MIDI export.
- Composer decisions selected the technique intents naturally. No technique was forced and no notes were inserted manually.
- All fixture instrument tracks started unlocked, unmuted, and note-empty. Only Piano plus the listed string companion(s) were in the selected band; those companions received notes from the ordinary Composer pass. Other template roles were out of band, not locked-empty.
- The MIDI files contain one note-bearing Piano track plus a conductor track. Generated companion lines are described below but are intentionally not included in the Piano-only exports.
- The existing environment has no usable UVI Grand Model D / local WAV-rendering setup. No WAV was rendered; no dependencies or environment settings were changed.

## Audition files

### 1. Alberti bass

[MIDI: `01-alberti-dorian-chamber-violin-seed-9.mid`](./01-alberti-dorian-chamber-violin-seed-9.mid)

- **Context:** D Dorian, Dorian 16-bar fixture; Chamber template with Piano and generated `violins1`; other Chamber string roles out of band. Seed **9**, 96 BPM, 4/4, density 0.85, moments off.
- **Phrase:** `sec_verse:phrase-1`, bars 1–7, statement / broken-chords / moderate. Harmony: Dm7 → G7 → Dm7 → Em7 → Fmaj7 → Dm9 → C/E → Am7.
- **Composer selection:** 24 `alberti-bass-accompaniment` events in the `lh.support` voice. The pattern gives four quarter-note attacks on each of six full-bar chords; the two half-bar chords in bar 4 have no Alberti-tagged attacks.
- **Structural detail / listening check:** the first cells are D3–F2–A2–D3 (Dm7), D3–F2–G2–D3 (G7), and D3–F2–A2–D3 (Dm7). The figure starts on the higher pitch and then drops, rather than following the conventional low–high–middle–high order; the Alberti intent is Composer-selected, but this pitch ordering is worth checking by ear. The figure pauses across the split Em7/Fmaj7 bar before resuming on Dm9.
- **Coordination context:** `violins1` generated 44 notes overall and 12 notes overlapping the target phrase (MIDI pitches 86–93). None of the 24 Piano target attacks share a violin attack; 20 occur while a violin note is sustaining. This is a high violin register: the profile’s comfortable ceiling is MIDI 88, while its hard limit is 96. There is no separate Piano `rh.melody` in this phrase (six such events occur elsewhere in the piece). The violin is omitted from the Piano MIDI, so the file cannot convey that line’s blend.
- **MIDI / playability:** 71 Piano notes; 24/24 target events matched from Composer score through Realizer into parsed MIDI. No playability warnings or hard violations in the target phrase (two warnings elsewhere in the piece; zero hard violations overall).

### 2. Walking bass

[MIDI: `02-walking-multi-chorus-sonata-violin-seed-1.mid`](./02-walking-multi-chorus-sonata-violin-seed-1.mid)

- **Context:** D Dorian, multi-chorus 16-bar fixture; Sonata template with Piano and generated `violins1`; `cellosBasses` out of band. Seed **1**, 96 BPM, 4/4, density 0.85, moments off.
- **Phrase:** `sec_chorus1:phrase-1`, bars 5–7, statement / melody-accompaniment / moderate. Harmony: Dm9 → C/E → Am7.
- **Composer selection:** 12 `walking-bass-line` events in `lh.bass`, one per quarter-note onset (960 ticks). The pitch sequence is D3–C3–D3–C3 | C3–E3–G3–G3 | G3–A3–G3–A3. This is mostly stepwise with repeated chord-tone pitches.
- **Melody and line context:** eight separate Piano `rh.melody` events occur in the phrase: F5–A5–A5–G5–E5–C6–C6–E5. The rise to C6 and return to E5 is an 8-semitone leap each way and is worth listening for. `violins1` generated 36 notes overall and five in the target phrase (pitches 69–76); no violin attacks coincide with the 12 walking-bass onsets, though nine of those Piano attacks occur under a sustained violin note.
- **MIDI / playability:** 77 Piano notes; 12/12 target events matched through the Realizer and MIDI parser. No playability warnings or hard violations in the target phrase (four warnings elsewhere in the piece; zero hard violations overall).

### 3. Arpeggiation and moving inner voice

[MIDI: `03-arpeggiation-moving-inner-dorian-chamber-cello-seed-1.mid`](./03-arpeggiation-moving-inner-dorian-chamber-cello-seed-1.mid)

- **Context:** D Dorian, Dorian 16-bar fixture; Chamber template with Piano and generated `cellosBasses`; other Chamber string roles out of band. Seed **1**, 96 BPM, 4/4, density 0.85, moments off.
- **Phrase:** `sec_verse:phrase-1`, bars 1–7, statement / arpeggiated / moderate. Harmony: Dm7 → G7 → Dm7 → Em7 → Fmaj7 → Dm9 → C/E → Am7.
- **Composer selections:** 14 `arpeggiated-chord-accompaniment` events in `lh.support` plus 14 `moving-inner-voice` events in `rh.inner`. Their attacks interleave: the support line begins at tick 0 and recurs every 1,920 ticks; the inner line begins 960 ticks later and also recurs every 1,920 ticks. Together they create a quarter-note attack stream, while remaining separate Piano voices. Support pitches are A2–F2–B2–D3–A2–F2–B2–A2–A2–F2–G2–E2–G2–A2; the moving-inner pitch sequence is F4–A4–B4–F4–F4–A4–G4–F4–F4–A4–C5–G4–C5–G4.
- **Coordination / register check:** `cellosBasses` generated 27 notes overall and 12 across the target phrase (MIDI pitches 74–81). No target attack coincides with a cello attack, but 13 of 14 occur while a cello note sustains. This cello range is above the profile’s comfortable window but within its hard range, so it is a context-register point to review; for the 14 moving-inner attacks, none coincide with a cello attack and 13 occur under a sustained cello note. The cello is excluded from this Piano-only MIDI. There is no separate Piano `rh.melody` in the target phrase (five such events occur elsewhere in the piece).
- **MIDI / playability:** 70 Piano notes; all 14 moving-inner events were matched through the Realizer and MIDI parser, and the phrase also contains all 14 selected arpeggiated-accompaniment events. No playability warnings or hard violations in the phrase or full piece.

## Techniques not naturally selected

In the **2,100-configuration** controlled reduced-roster search (two fixtures, three templates, seven one- or two-string rosters, seeds 1–150; 96 BPM, 4/4, density 0.85, moments off), the exact Composer-owned intents `rhythmic-ostinato` and `independent-counterline` had **zero** events. Neither was forced into these auditions.

| Composer intent | PianoScore events across search | Phrases with 4+ events |
|---|---:|---:|
| `alberti-bass-accompaniment` | 1,032 | 60 |
| `walking-bass-line` | 288 | 24 |
| `rhythmic-ostinato` | 0 | 0 |
| `arpeggiated-chord-accompaniment` | 8,695 | 750 |
| `independent-counterline` | 0 | 0 |
| `moving-inner-voice` | 8,528 | 1,004 |

These are aggregate Composer event observations, not unique notes or a quality rating. A separate 900-configuration full-roster sweep found none of the six exact target intents. The selected companion roles above were unlocked and actually composed, avoiding the earlier locked-empty-context caveat.

MIDI event structure verifies timing, pitch, and note counts only. Please listen to the files for musical judgment; no claim that any technique sounds good is made.
