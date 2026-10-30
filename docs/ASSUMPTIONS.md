# Assumptions & decisions

1. **Platform.** This build environment could not produce a Tauri/Rust app or a JUCE C++ engine, so I delivered the full frontend as a local web app (Vite single-file build) that runs in Edge or Chrome. The native parts are listed under Known Issues; nothing in the UI pretends they exist.
2. **Bars are 1-based** (`startBar: 1` begins at tick 0).
3. **Project length** = the latest end of any section or chord, rounded up to a whole bar. With no sections or chords it is 8 bars. Notes do not extend the project.
4. **No sections defined:** the whole project is treated as one section named `*`, which uses the `*` rules.
5. **Section rule lookup:** exact name (case-insensitive), then the name without a trailing number, then `*`.
6. **Chord lookup during generation:** the chord sounding at the tick; otherwise the last chord before it; otherwise the first chord; otherwise the tonic triad of key + mode.
7. **Chord parser output order:** slash bass first, then chord tones in ascending stacking order, with duplicates removed. "6/9" is a quality, not a slash chord. A bare 11 or 13 implies a b7.
8. **Default MIDI channels** run 1–16 sequentially across instrument tracks, wrapping after 16 (there are 18 default instrument tracks). The channel is informational in export. Inside a library group, channels must be unique, and routing a track into a group picks the lowest free channel automatically.
9. **Default tracks have no library group** and so play the built-in preview sound.
10. **Aux** is a fixed-note percussion track (default note 42). Snare (38) and Cymbals (49) can be changed in Settings; changing one updates the track's range and existing notes.
11. **Fixture** `tracks: []` is valid. On load, `projectFromFixture` fills in the default tracks.
12. **Key signature in MIDI:** church modes use the parent major's signature. Aeolian, harmonic minor and melodic minor are written as minor. Whole-tone and diminished use the tonic's major signature.
13. **Export end-of-track** sits exactly at the project end tick. Note-offs are written before note-ons on the same tick.
14. **Humanize** has a timing cap of 12 ms by default (hard cap 14.5 ms) and ±6 velocity. A note never leaves its original bar.
15. **Same-pitch overlaps** are resolved by truncating the earlier note. A duplicate start drops the shorter note. This also runs on piano-roll commits.
16. **Freeze** renders offline with the preview synth (OfflineAudioContext) into session memory. The cache is cleared on close. Frozen buffers are not saved; the restore action re-renders them.
17. **Instance counter** = library groups with at least one unfrozen track, plus 1 for the shared preview synth when any ungrouped instrument track is unfrozen.
18. **Reference audio:** the browser cannot read file paths, so `path` stores the file name and the audio must be loaded again after reopening. `offsetMs > 0` means the audio starts later on the timeline.
19. **Default tracks** (Structure … Harp) cannot be deleted. Tracks you add can be (select and press Delete).
20. **Loop** covers the selected section, otherwise the whole song.
21. **Undo history** keeps 200 steps. Rapid edits with the same control (slider drags) are merged into one step within 800 ms.
22. **Native file dialogs** use the File System Access API (save, folder picker) where available, and fall back to downloads.
23. **@tonejs/midi** was dropped because it fixes PPQ at 480 and cannot set the end-of-track tick. I used `midi-file` (the library underneath it) instead.
24. **Mixer dock toggle:** the mixer is a toggleable bottom dock (opened/closed with the mixer button or the `X` key, default open on startup). When open, it sits below the arranger and stays full-width.
25. **Reference fader scale:** use the supplied `0, 3, 6, 9, 12, 15, 18, 21, 24, 30, 35, 45, 60` attenuation labels, evenly mapped in dB from top to bottom with 3 px end insets for text centering. Labels are muted and have no printed tick dashes.
26. **Switch controls:** every prior checkbox is rendered as a vertical analog switch; ON uses the warm-gold lamp glow, OFF is unlit.
27. **Smart Chord clips** are chord-lane events with a `sch_` id prefix plus their MIDI on the Chords structure track's notes (that track is inert: never played by the preview engine, never exported, never written by generate). A fresh clip's symbol is the project tonic in canon spelling until a chord is named; the clip is a first-class lane object, so save/reload keeps everything.
28. **Double-click on the chord lane:** on empty space it creates a Smart clip — exactly 1 bar of space → 1 bar; less (but at least one grid unit) → fills the gap exactly; more → 1 bar with the rest left empty; smaller than one grid unit → warn toast, nothing created. On an existing clip it opens the chord editor. The first click of such a double-click still runs the manual-chord creation; the gesture then converts that false start into the Smart clip inside the same undo step (on failure the manual chord is restored).
29. **Chord-lane MIDI containment:** notes written into a clip must start and end inside the clip's window (chord-lane clips are analyzed per window); notes outside the window on the same track are never touched. The lane's own note cleanup (`sanitizeNotes`) applies.
30. **New-clip content** is a persisted user preference (`settings.smartChordPlaceholder`): "empty" or "root-note" (one key-tonic note spanning the clip, C3-based, velocity 100). Default is root-note; the switch lives in the chord editor footer.
