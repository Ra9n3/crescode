# Crescode — Orchestral MIDI Studio

Set key / mode / BPM / meter, sketch sections and chords on the arranger, pick a **band** in the ▾ next to **Compose All**, preview, export MIDI, and finish the track in your DAW. The band (one of six ensemble templates) decides which of your tracks play. Production Compose All is coordinated by `src/orchestrator/compose.ts`: dedicated family renderers own their paths, while the generic rules interpreter in `src/engine/generate.ts` consumes `src/config/generation-rules.ts` for remaining rules-driven work and compatibility inputs. Piano Engine V2 replaces intermediate Piano output after the non-Piano parts are finalized; Harp remains with the keys renderer.

> **Delivery status, plainly:** this repository has the complete **frontend application**: schema, generation engine, export, arranger UI, the band system (six ensemble templates with header in/out and project pins), mixer, piano roll, routing, freeze, save/load, undo, plus tests. It runs in Chromium-based browsers (Edge or Chrome on Windows) as a single local HTML file, with the built-in Web Audio preview sound. The **Tauri shell, the Rust `crescode-engine.exe`, real VST3 scanning and hosting, and the Windows installer are not included yet** (see `docs/ENGINE_BUILD_GUIDE.md` for the implementation plan). The UI already speaks the engine protocol (`docs/PROTOCOL.md`), and degrades gracefully without the engine, as the brief requires.

## Prerequisites (Windows 10/11 x64)
1. **Node.js LTS** (22.x): https://nodejs.org. Use the default installer options.
2. Optional, only for the browser smoke test: run `npx playwright install chromium` once.
3. **Rust (stable, MSVC toolchain)** is only needed to implement or build the planned native engine (see `docs/ENGINE_BUILD_GUIDE.md`). No C++ compiler, no JUCE, no Visual Studio IDE is intended — just the Rust toolchain and the MSVC linker that `rustup` installs automatically.

## Run
```
npm install
npm run dev          # http://localhost:5173 — open in Edge or Chrome
npm run build        # produces dist/index.html (one self-contained file; open it directly)
```

Nothing goes over the network at runtime. The fonts are bundled. The engine connection is off by default, and when turned on it only targets 127.0.0.1.

## Test
```
npm test                         # Vitest suite
npm test -- tests/piano-engine-production.test.ts  # focused example; choose the test relevant to your change
npm run typecheck                # source and test TypeScript checks
npm run harness                  # CLI summary for fixtures/dorian-16bars.json
npm run harness -- 42            # with seed 42
npm run e2e                      # builds, then runs the headless UI smoke test
npm run e2e:gesture              # chord-lane gestures and smart chord overlay
npm run e2e:transport            # transport, auto-scroll, follow and loop
```

For coding-agent navigation, start with [AGENTS.md](AGENTS.md). The detailed current orchestration flow and musical contracts are in [docs/ORCHESTRATOR_SPEC.md](docs/ORCHESTRATOR_SPEC.md).

## Using Crescode
- **Top bar:** project name, New / Open / Save / Recent / Export, undo and redo, BPM, Key, Mode, Time signature, the transport, and **Compose All**. The ▾ next to Compose All holds the **band picker** plus seed, density and humanize.
- **Structure lane:** drag to create a section. Drag a section to move it, drag an edge to resize, double-click to rename (presets or any custom name), and press Delete or the × to remove it.
- **Chords lane:** click to place a chord and type the symbol. Invalid symbols turn red. Drag to move, use the right edge to resize, double-click to edit.
- **Reference Audio:** the upload icon loads wav / mp3 / flac. Use the **ms** offset (arrow keys nudge it by 10 ms) and the metronome to line the bars up by ear.
- **Tracks:** L / M / S, freeze (❄), the VST button, MIDI channel, volume and pan. Ctrl-click selects several tracks. Double-click a lane to open the **piano roll**.
- **The band:** six ensemble templates (Symphony, Chamber, Cinematic, Sonata, Vocal Backing, Hybrid Studio) decide which of your instrument tracks join the composition — they never create or delete tracks. Pick one in the ▾ next to Compose All; the picker row says how many instruments it carries and notes where project pins leave it short or force extras in. Switching bands starts a new composition: header choices reset and out-of-band lanes empty (one Ctrl+Z restores everything). The IN/OUT chip on a track header flips that instrument for this composition — going OUT empties its lane; a locked track keeps its notes. Settings → Band pins an instrument always-in / always-out across every band; a pinned instrument refuses the header chip. Power order: pins beat the header chip, the header chip beats the band — until the next switch. Compose All writes only for unlocked in-band tracks (no band chosen: everyone).
- **Mixer:** a full-width dock beneath the arranger — open by default, toggled with the mixer button or the **X** key — and still visible when routing, VST/settings menus, or the piano roll is open. One brushed-aluminium strip per track plus the master; it controls preview playback only. Each strip: channel number, VST readout, pan knob, M/S/L lamp buttons, then a centred level fader with the level meter and its printed dB numbers immediately to the right, the readout under the meter, and the track name on a high-contrast label band. The master strip is exactly one channel wide and its fader and meter are level with the channel faders.
- **Routing panel:** groups, the tracks in each, and a loaded/unloaded badge. Drag tracks between groups or use the menu on each track. For Violins I + II: Ctrl-click both headers, then **Group selected tracks**.
- **Keyboard:** Space play/stop · Delete · Ctrl+Z / Ctrl+Shift+Z · L / M / S on selected tracks · Ctrl+wheel zoom · Ctrl+S / Ctrl+O.
- **Saving:** `.crescode` files use the same JSON as the export. Saving uses the native save dialog in Edge/Chrome. The app autosaves to a recovery slot and offers a restore on the next start. Recent projects are listed in the app.

## Exporting MIDI and checking it in your DAW (manual test)
1. Export → **MIDI · single file** → All tracks → Export → save `Song.mid`.
2. In your DAW (Cubase, Studio One, Reaper, Logic…), create an empty project, then File → Import → MIDI file (or drag the file onto the arranger).
3. Check: one track per instrument, named after it. The tempo matches the BPM (the DAW should adopt the file's tempo; tick "import tempo" if it asks). The time signature matches. Section markers appear on the marker track.
4. Per-track export: choose a folder. Drag all the `NN Name.mid` files in at bar 1. They all start at bar 1 and end on the same bar.

## Writing rules for the generic generator
Edit `src/config/generation-rules.ts` (the schema is in `src/engine/rules-schema.ts`; the file's header comment is a reference card). This config feeds generic rules-driven work in Compose All; family-specific renderers own their dedicated output. The structure:

```ts
sections: {
  Chorus: {                       // matched by name, then name without a number ("Chorus 2"), then "*"
    density: 1, velocityScale: 1.1,
    variation: { velocityOffsetOnRepeat: 4, octaveShiftOnRepeat: 0, densityScaleOnRepeat: 1 },
    parts: [{
      match: { roles: ['violins1'] },          // or families: ['Brass'], trackNames: ['Harp']
      role: 'melody',                          // your vocabulary: bass/pad/harmony/melody/counterMelody/accent/percussion/…
      pitch: { source: 'scale', register: [0.45, 0.7], motion: 'stepwise', maxLeap: 5, chordToneOnStrongBeats: true },
      rhythm: { type: 'pattern', unit: 'beat', steps: [{ at: 0, len: 1.5, accent: 8 }, { at: 1.5, len: 0.5 }] },
      velocity: [78, 98], velocityCurve: 'crescendo', density: 0.9,
      articulation: { legato: 0.8, minTicks: 30 },
      doubling: [12],                          // octave copy, kept only if it fits the range
      fill: { when: 'lastBarOfSection', rhythm: 'rollFill', velocityOffset: 10 },
      occurrences: [2],                        // only the 2nd time this section plays
    }, {
      match: { roles: ['flutes'] }, role: 'melody', pitch: { source: 'scale' }, rhythm: 'sustainChord',
      doubleOf: { role: 'violins1', interval: 12 },   // copy another track (generated or locked)
    }],
  },
}
```
- **Pitch sources:** `chord`, `chordUpper` (no slash bass), `root`, `bass`, `scale`, `fixed`. **Motions:** `block` (voice-led voicing with `voices` and `spread`), `arpeggioUp`, `arpeggioDown`, `arpeggioUpDown`, `stepwise`, `random`.
- **Rhythm units:** `beat` (the felt beat: dotted quarter in 6/8), `quarter`, `eighth`, `sixteenth`, `triplet8`, `pulse`, `bar`. Sustains: `per: 'chord' | 'bar' | 'chordOrBar' | 'beat' | 'section'`.
- **Hooks:** `custom(pc)` replaces generation for that part, and `transform(notes, pc)` post-processes its notes. `pc.ctx` gives you the key, mode, `scalePitchClasses`, the parsed chords (`chordAt(tick)`), the sections (with occurrence), the meter (`barTicks`, `beatOffsets`, compound), BPM, the options, `lockedNotes` (by track and by role), and `generatedByRole`. `pc.rng` is seeded, so never use `Math.random`.
- **What the generic rules interpreter guarantees regardless of your rules:** determinism, locked tracks returned untouched, every note in range (folded by octaves), no same-pitch overlaps, no zero-length notes, nothing past the end, and humanize under 15 ms that stays inside the bar.

## Planned Native Engine (`crescode-engine`) — Not Included

No `crescode-engine/` source tree or Rust binary is included in this repository. The current frontend includes the `src/engineClient/` WebSocket client; `docs/PROTOCOL.md` records the intended protocol and `docs/ENGINE_BUILD_GUIDE.md` is a future implementation plan. The native-engine details below describe planned architecture, not shipped native functionality.

The intended native engine is a Rust binary with no C++ or JUCE dependency, communicating with the frontend over the WebSocket protocol. This separation is intentional and should be preserved if the native engine is implemented.

Planned scope:

VST3 hosting only. No VST2 (deprecated, licensing issues). No CLAP — Crescode's target instruments (orchestral sample libraries: Kontakt, VSL, Spitfire, Cinesamples, EastWest, etc.) ship as VST3, not CLAP, so CLAP support would add engineering cost with zero real-world benefit for this app.

Multi-timbral routing is the most important planned engine capability, not an afterthought. A single plugin instance (e.g., one Kontakt) commonly hosts many instruments at once, each on its own MIDI channel, each producing its own audio output. The future engine should let Crescode tracks:

- Share one plugin instance across multiple tracks.
- Route each track's MIDI to a specific MIDI channel on that shared instance.
- Route each track's audio from a specific VST3 output bus on that shared instance back to that track's mixer strip.

This is expected to be the highest-risk part of a future engine: VST3 multi-bus negotiation is difficult and plugins can respond differently. The build guide proposes validating it against a real multi-timbral plugin in its Phase 3; that validation has not been performed by this frontend repository.

The VST3 hosting crate remains a future decision. The build guide requires an explicit Phase 0a verification before choosing a crate; do not treat its candidate notes as a completed implementation decision.

## Plugin-scanning UI and planned native behavior
The frontend VST browser exposes Scanning, Empty, Not scanned, and Loaded states, plus a development switch for exercising the UI with clearly labelled sample data. This repository does not include the native engine, so actual VST3 scanning and hosting are not available; without an engine, tracks retain the built-in **preview sound** (marked **PV**). The build guide proposes running future scanning in a sandboxed subprocess so a crashing plugin cannot take down the engine.

## The interface
The UI is built as vintage studio hardware: graphite control panels with brushed-metal grain, brushed aluminium plates for the master section, cream silkscreen print, chrome toggles, square lamp buttons, spoked rotary knobs with tick rings, and desk faders with printed scales and aluminium caps. Panel titles are set in a brush script on a silkscreen rule, and the timecode sits in an inset display window. Family colours are the channel colour coding — the coloured knob caps of a mixing desk. The piano roll's key strip is a real vintage keyboard: aged ivory whites with dark seams and worn front edges, glossy black keys inset over them with a gloss highlight and a cast shadow, felt under the fallboard and printed C labels. The mixer opens as a full-width dock beneath the arranger (default open; toggled with the mixer button or the X key) and stays full-width while routing, VST/settings menus, or the piano roll are open. All previous checkbox controls are analog chrome toggles: ON glows warm gold; OFF is unlit. M/S/L are graphite lamp buttons with a small corner LED that lights (amber mute, olive solo, blue lock); the selected channel is marked by a family-colour edge glow rather than a brightness wash. Every hardware control shares one press physic (sink + golden glow on `:active`/tap). Faders use the classic SSL / Standard Wedge: rectangular matte black console caps with a concave finger scoop, deep center groove, and a sharp contrasting white indicator line painted down the middle. Grab the cap with a relative drag, click the empty track to jump, scroll to nudge (Shift = fine). Printed dB numbers `+6 0 −10 −20 −40` sit to the right of the meter (the master adds `−∞`) without bleeding above or below. The fader and playback preview bar are centered as a pair directly beneath the Mute and Solo buttons. Channel names are engraved in black plate ink with no background frame, matching the "PAN" labels. Pan knobs are enlarged (36px in full density) with a spoked tick ring, 12-o'clock detent, and scroll-to-turn. The master channel matches the exact width and fader/meter travel of standard channels. Screenshots: `docs/screenshot.png`. Every color comes from `src/theme/tokens.ts`; the brushed-metal textures are embedded in `src/theme/material.css`, so nothing is fetched at runtime.

## Project layout
```
specs/ensemble-templates/  the six band templates (JSON): roster, energy budget, orchestration rules
src/shared/schema/   types, JSON Schema, chord parser, modes, ranges, meter, factory, validation, band.ts (membership logic)
src/orchestrator/   production Compose All coordinator, family renderers, Piano Engine V2
src/engine/          generate.ts (generic rules interpreter), rules-schema.ts, suggestion/ (chord analysis), transport/ (follow)
src/config/          generation-rules.ts (generic rules data) · ensembles.ts (band registry + template resolver)
src/export/          midi.ts (MIDI writer), profile.ts and profiles/ (export transformations)
src/audio/           preview synth, scheduler, meters, freeze (offline render), transport
src/engineClient/    frontend WebSocket client for the planned native engine
src/components/      UI;  src/theme/tokens.ts holds every color
docs/ENGINE_BUILD_GUIDE.md and docs/PROTOCOL.md  future native-engine plan/protocol; no crescode-engine/ source tree is present
fixtures/ tests/ scripts/ docs/
```
