# Piano Engine V4 MIDI inspection

Generated from the production `composeAllTracks` → Piano Composer → Piano Realizer path using `three-chorus-40bars.json`, seed 11, 4/4 at 100 BPM. Each MIDI contains the conductor/section track and one UVI-profile Piano track on channel 16.

The profile chunk is serialized to Standard MIDI Files and independently parsed back. Note-on ticks, note-off-derived durations, CC64 events, PPQ, track count, and channel were checked. This is real generated MIDI event inspection, but not validation through `buildMergedMidi`/`buildPerTrackMidi` and not listening/render validation.

## chamber

- File: `evaluation/piano-engine-v4-chamber-40bar.mid` (1346 bytes)
- SMF format 1; 2 tracks; PPQ 960; Piano channel 16.
- Notes: 85; pitch range 33–74; CC64 events 70; CC64 values 127/0; final CC64 0 at tick 153600.
- Parsed MIDI onsets and note-off durations round-trip to the production UVI profile chunk; last note ends at tick 153600.

| Section | Notes | Planned texture / motif operation | First MIDI events (onset:duration@pitch, ticks) |
|---|---:|---|---|
| Verse (sec_verse1, bars 1–4) | 8 | sparse-sustained/introduce, sparse-sustained/rhythmic-augmentation | 0:5280@62; 0:2255@65; 3840:3533@35; 5280:2002@62; 7680:1128@65; 10560:960@62; 11520:4320@62; 12480:950@67 |
| Chorus (sec_chorus1, bars 5–12) | 12 | sparse-sustained/withhold-under-lead, sparse-sustained/sequence-in-new-harmony | 15360:3533@57; 15840:480@60; 19200:3533@35; 19200:4320@55; 23040:480@53; 23520:3840@53; 26880:480@52; 27360:480@52; 30720:3840@53; 34560:4320@53 |
| Bridge (sec_bridge, bars 25–28) | 6 | sparse-sustained/withhold-under-lead, sparse-sustained/invert-and-reframe | 92160:3533@38; 92160:4320@53; 96000:3533@57; 96480:480@52; 99840:3533@34; 99840:3533@55 |
| Chorus (sec_chorus3, bars 29–36) | 20 | contrapuntal-dialogue/invert-and-reframe, sparse-sustained/withhold-under-lead, sparse-sustained/fragmented-recall | 107520:3533@33; 107520:4320@64; 109920:720@36; 111360:3533@35; 111360:3533@67; 111840:480@62; 111840:898@73; 113760:720@38; 115200:4320@65; 117600:720@33 |
| Outro (sec_outro, bars 37–40) | 11 | sparse-sustained/fragment-to-landing | 138240:3533@38; 138240:4320@60; 138240:2255@65; 142080:3533@38; 142080:3533@65; 142560:480@62; 145920:3533@36; 145920:3533@64; 149760:3840@38; 149760:3840@65 |

## sonata

- File: `evaluation/piano-engine-v4-sonata-40bar.mid` (1539 bytes)
- SMF format 1; 2 tracks; PPQ 960; Piano channel 16.
- Notes: 99; pitch range 47–88; CC64 events 80; CC64 values 127/0; final CC64 0 at tick 153600.
- Parsed MIDI onsets and note-off durations round-trip to the production UVI profile chunk; last note ends at tick 153600.

| Section | Notes | Planned texture / motif operation | First MIDI events (onset:duration@pitch, ticks) |
|---|---:|---|---|
| Verse (sec_verse1, bars 1–4) | 11 | sparse-sustained/introduce, sparse-sustained/rhythmic-augmentation | 0:2765@57; 0:1618@84; 2880:240@60; 3840:2765@59; 3840:7526@74; 4320:2880@77; 7680:2765@60; 7680:4320@77; 12000:480@76; 12480:950@86 |
| Chorus (sec_chorus1, bars 5–12) | 19 | sparse-sustained/withhold-under-lead, short-flourishes/sequence-in-new-harmony | 15360:2765@60; 15360:3494@76; 18240:240@57; 19200:2765@59; 19200:7526@74; 23040:5530@60; 26880:3494@76; 30720:2765@62; 30720:3494@77; 34560:2765@60 |
| Bridge (sec_bridge, bars 25–28) | 8 | sparse-sustained/withhold-under-lead, sparse-sustained/withhold-under-lead | 92160:7526@57; 92160:3494@74; 92160:4320@77; 96000:3494@72; 96480:480@76; 99840:2765@58; 99840:3494@77; 102720:240@55 |
| Chorus (sec_chorus3, bars 29–36) | 20 | sparse-sustained/withhold-under-lead, short-flourishes/fragmented-recall | 107520:3494@57; 107520:3494@76; 108000:480@77; 111360:2765@59; 111360:2880@74; 114240:240@62; 115200:5530@60; 115200:4320@77; 119040:480@76; 119520:480@76 |
| Outro (sec_outro, bars 37–40) | 10 | sparse-sustained/fragment-to-landing | 138240:7526@50; 138240:480@77; 138240:1618@84; 138720:480@77; 142080:4320@77; 145920:2765@48; 145920:480@76; 146400:480@76; 149760:3840@50; 149760:3840@77 |

## vocalbacking

- File: `evaluation/piano-engine-v4-vocalbacking-40bar.mid` (1209 bytes)
- SMF format 1; 2 tracks; PPQ 960; Piano channel 16.
- Notes: 66; pitch range 45–76; CC64 events 72; CC64 values 127/0; final CC64 0 at tick 153600.
- Parsed MIDI onsets and note-off durations round-trip to the production UVI profile chunk; last note ends at tick 153600.

| Section | Notes | Planned texture / motif operation | First MIDI events (onset:duration@pitch, ticks) |
|---|---:|---|---|
| Verse (sec_verse1, bars 1–4) | 4 | sparse-sustained/introduce | 0:11290@65; 3840:3648@59; 7680:3648@60; 11520:4320@62 |
| Chorus (sec_chorus1, bars 5–12) | 12 | broken-chords/fragmented-recall | 15360:2995@60; 15840:480@64; 15840:2419@69; 19680:2419@67; 23520:2419@74; 27360:2419@64; 30720:2995@62; 31200:2419@65; 35040:2419@69; 38400:2995@59 |
| Bridge (sec_bridge, bars 25–28) | 9 | sparse-sustained/rhythmic-augmentation | 92160:2995@50; 92160:2765@65; 96000:2765@48; 96000:4320@67; 96000:4320@69; 99840:2765@46; 99840:4320@65; 100320:480@67; 104160:480@64 |
| Chorus (sec_chorus3, bars 29–36) | 9 | sparse-sustained/rhythmic-augmentation | 107520:2765@65; 111360:2765@67; 115200:4320@65; 119040:480@64; 119520:480@64; 122880:2765@65; 126720:2765@60; 130560:2880@67; 133440:4175@67 |
| Outro (sec_outro, bars 37–40) | 12 | sparse-sustained/fragment-to-landing | 138240:2918@45; 138240:2918@60; 138240:2109@65; 142080:2765@46; 142080:1440@62; 143520:2087@74; 145920:2765@48; 145920:4320@64; 149760:3840@50; 149760:480@65 |

## cinematic

- File: `evaluation/piano-engine-v4-cinematic-40bar.mid` (1188 bytes)
- SMF format 1; 2 tracks; PPQ 960; Piano channel 16.
- Notes: 68; pitch range 45–96; CC64 events 68; CC64 values 127/0; final CC64 0 at tick 153600.
- Parsed MIDI onsets and note-off durations round-trip to the production UVI profile chunk; last note ends at tick 153600.

| Section | Notes | Planned texture / motif operation | First MIDI events (onset:duration@pitch, ticks) |
|---|---:|---|---|
| Verse (sec_verse1, bars 1–4) | 3 | sparse-sustained/introduce | 0:7526@86; 7680:4320@89; 12000:480@88 |
| Chorus (sec_chorus1, bars 5–12) | 13 | broken-chords/invert-and-reframe, sparse-sustained/withhold-under-lead | 15360:4320@88; 19200:4320@91; 19680:480@86; 23040:480@89; 23520:3840@89; 26880:2995@48; 26880:480@88; 27360:3840@88; 30720:480@89; 31200:480@89 |
| Bridge (sec_bridge, bars 25–28) | 5 | sparse-sustained/withhold-under-lead | 92160:480@77; 92640:480@77; 96000:2765@81; 99840:3840@79; 103680:4320@79 |
| Chorus (sec_chorus3, bars 29–36) | 14 | sparse-sustained/interval-expansion, sparse-sustained/withhold-under-lead | 107520:3610@52; 107520:3610@81; 108000:480@77; 111360:2995@50; 111360:2765@79; 115200:2995@50; 115200:2765@77; 119040:7526@81; 126720:2995@52; 126720:4320@84 |
| Outro (sec_outro, bars 37–40) | 12 | sparse-sustained/fragment-to-landing | 138240:3610@45; 138240:480@77; 138240:2053@96; 138720:480@77; 142080:3610@46; 142080:4320@77; 145920:3610@48; 145920:480@76; 146400:3840@76; 149760:3840@50 |

## hybridstudio

- File: `evaluation/piano-engine-v4-hybridstudio-40bar.mid` (1095 bytes)
- SMF format 1; 2 tracks; PPQ 960; Piano channel 16.
- Notes: 81; pitch range 45–82; CC64 events 14; CC64 values 127/0; final CC64 0 at tick 153600.
- Parsed MIDI onsets and note-off durations round-trip to the production UVI profile chunk; last note ends at tick 153600.

| Section | Notes | Planned texture / motif operation | First MIDI events (onset:duration@pitch, ticks) |
|---|---:|---|---|
| Verse (sec_verse1, bars 1–4) | 3 | sparse-sustained/introduce | 0:7526@74; 7680:4320@72; 12000:480@71 |
| Chorus (sec_chorus1, bars 5–12) | 15 | sparse-sustained/fragmented-recall | 15360:4320@72; 15360:1440@81; 16800:1238@81; 19200:2765@67; 19680:480@71; 23040:4320@65; 24480:1238@72; 26880:7526@69; 27360:480@64; 32160:1238@77 |
| Bridge (sec_bridge, bars 25–28) | 10 | sparse-sustained/fragmented-recall, sparse-sustained/invert-and-reframe | 92160:4320@65; 92160:1200@74; 93360:2064@74; 96000:3533@72; 96480:480@64; 99840:3533@67; 100320:1032@77; 103680:3533@45; 103680:3533@67; 103680:826@74 |
| Chorus (sec_chorus3, bars 29–36) | 19 | sparse-sustained/fragmented-recall, sparse-sustained/fragmented-recall | 107520:3533@45; 107520:3533@65; 108960:1238@72; 111360:3533@47; 111360:4320@67; 115200:3533@48; 115200:3533@62; 115200:480@77; 115680:480@65; 115680:619@81 |
| Outro (sec_outro, bars 37–40) | 10 | sparse-sustained/fragment-to-landing | 138240:3533@50; 138240:480@65; 138720:480@65; 142080:3533@50; 144000:1651@82; 145920:3533@48; 145920:3533@64; 149760:3840@50; 149760:3840@65; 151680:1651@81 |
