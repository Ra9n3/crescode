# Crescode Engine Build Guide — VST3 Hosting with Multi-Timbral Routing

This document is the implementation plan for `crescode-engine`, the native Rust binary that gives Crescode real VST3 instrument hosting. Follow the phases in order. Do not skip ahead — each phase produces something testable before the next begins.

## Non-Negotiable Constraints

1. **Pure Rust. No C++, no JUCE, no second compiler toolchain, no exceptions to this.** This project has already paid the cost of a C++/JUCE dead end once — this build must not repeat that.
2. **The frontend never changes.** `crescode-engine` must implement `docs/PROTOCOL.md` exactly as written. If the protocol needs new message types for routing (see Phase 5), add them to `PROTOCOL.md` and keep the frontend's `src/engineClient/` in sync — but do not change how the existing UI/engine contract already works.
3. **VST3 only.** Do not implement VST2 or CLAP in this pass. Crescode's target plugins (orchestral sample libraries) are VST3-only in practice.
4. **Never crash the UI.** A misbehaving plugin must only ever affect its own instance, never the engine process or the frontend.
5. **Never block the audio thread.** No heap allocation, no locks, no file I/O, no logging inside the real-time audio callback. Use lock-free queues (`ringbuf` or `crossbeam`) to pass commands from the control side to the audio side.

---

## Phase 0a — Crate Verification (do this first, before writing any code)

Before committing to a VST3 hosting crate, verify it actually exists and is real. Do not trust crate names or code samples from any planning document (including this one, or anything previously provided) at face value — AI-generated planning text can reference plausible-sounding crates, APIs, or version numbers that don't actually exist. Treat this as a hard gate before Phase 0.

1. Check crates.io directly for the exact crate name and version under consideration (candidates to check: `vst3-sys`, `vst3-host`, or any other VST3-related Rust crate).
2. Confirm each candidate has: a linked repository, recent commit activity, a reasonable download count, and more than a trivial number of dependents.
3. Open the actual source code of the crate's key functions — plugin loading, bus activation, audio processing, MIDI event sending — and confirm they contain real implementation, not stubs, `todo!()`, or `unimplemented!()`.
4. If a "high-level safe wrapper" crate is being considered (as opposed to lower-level raw bindings), specifically search its GitHub issues/discussions for evidence someone else has used it successfully for **multi-bus output** — this is Crescode's core requirement, so generic "it loads a plugin and plays a note" success stories are not sufficient evidence.
5. Document findings in `crescode-engine/README.md`: which crate was chosen, why, what was verified, and links to the evidence (repo, issues, etc.).

**Default fallback if verification fails or a candidate crate is too immature/unverifiable:** use `vst3-sys` (confirmed real, maintained under the RustAudio GitHub organization) as the low-level binding layer, accepting that more manual `unsafe` COM-handling code will be required on your side in exchange for certainty that the foundation is real and maintained.

**Do not proceed to Phase 0 until this verification is complete and documented.**

---

## Phase 0 — Project Setup

1. Create `crescode-engine/` as a new Cargo workspace member (or standalone crate) alongside the existing frontend.
2. Add dependencies based on the Phase 0a decision, e.g.:

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.21"   # WebSocket server
serde = { version = "1", features = ["derive"] }
serde_json = "1"
cpal = "0.15"                 # audio I/O
ringbuf = "0.3"
crossbeam = "0.8"
# VST3 hosting crate — fill in based on verified Phase 0a decision
```

Milestone: `cargo run` starts a process that does nothing but print "crescode-engine starting" and exit cleanly. Confirm the Rust/MSVC toolchain (installed via `rustup`) compiles end to end before writing any real logic. No C++ compiler should be required anywhere in this build.

---

## Phase 1 — WebSocket Protocol Shell
Goal: the frontend's "Engine Connected" indicator lights up, with zero plugin functionality behind it yet.

1. Read `docs/PROTOCOL.md` fully before writing code.
2. Implement the WebSocket server on 127.0.0.1 on the port the frontend expects.
3. Implement the handshake and heartbeat messages exactly as specified.
4. Implement a basic command dispatcher — a match on incoming message type fields that currently just logs "not yet implemented" for anything beyond handshake/heartbeat.

Test: run the frontend (`npm run dev`), turn on the engine connection in Settings, confirm the UI shows connected and heartbeats keep it alive. No plugin features yet — this phase is purely about proving the transport layer works.

---

## Phase 2 — Plugin Scanning (Sandboxed)
Goal: the VST browser's four states (Scanning / Empty / Not scanned / Loaded) reflect real VST3 plugins found on disk.

1. Scanning must run in a separate child process, not inline in `crescode-engine`. Plugins frequently crash or hang during scanning — this must never take down the main engine.
2. Build `crescode-scanner.exe` as a second small Rust binary (same VST3 crate dependency as the main engine). Its only job: given a directory, enumerate `.vst3` bundles, attempt to load each one just far enough to read its name/vendor/category, and report results back to the parent process via stdout (newline-delimited JSON) or a named pipe.
3. The parent `crescode-engine` spawns `crescode-scanner.exe`, applies a timeout per plugin (e.g. 5 seconds — if a plugin hangs loading, kill the scanner process and mark that plugin as failed, then restart the scanner for the remaining plugins).
4. Cache scan results to disk (e.g. `%APPDATA%/Crescode/plugin-cache.json`) so re-scanning on every app launch isn't required.
5. Wire scan progress and results to the WebSocket messages the VST browser already expects (live counter during scanning, final list on completion).

Test: point Settings' scan directory at a real VST3 folder (e.g. `C:\Program Files\Common Files\VST3`), click Scan, confirm the live counter moves and the final list populates the VST browser with real plugin names.

---

## Phase 3 — Single Plugin Load, Audio Passthrough, AND Multi-Bus Validation

This phase is more front-loaded than you might expect — deliberately. Multi-timbral routing is Crescode's single most important engine capability (see README), and VST3's bus negotiation is widely considered its fussiest part to implement correctly. This phase validates that risk immediately, while the codebase is still small enough that a pivot would be cheap, rather than discovering a problem after months of work are built on top of an assumption.

### 3.1 — Basic single-output plugin loading

1. Implement `load_plugin(path) -> PluginHandle` using the verified crate from Phase 0a. This means: load the plugin's factory, create the component, initialize it, and get it into a running state per the VST3 initialization sequence (IPluginFactory → IComponent → IAudioProcessor → IEditController).
2. Set up the `cpal` audio output stream with a real-time callback. This callback must only read from lock-free queues already filled by the control thread.
3. Implement MIDI note-on/note-off delivery into the plugin's event input.

Test: load a simple free single-output VST3 instrument (e.g. Vital, Surge XT), send it a note-on via a hardcoded test command, confirm audio comes out of your speakers.

### 3.2 — Multi-bus validation (do this before moving to Phase 4)

1. Load a real multi-timbral plugin with multiple configured outputs — a free/demo version of Kontakt is ideal since it's Crescode's primary real-world target.
2. Call the bus enumeration functions (`getBusCount`/`getBusInfo` or your chosen crate's equivalent) for the output bus type, and confirm you get back the actual number of output buses the plugin is configured to expose (e.g. if Kontakt is set up with 4 stereo outputs, you should see 4 buses reported, not 1).
3. Activate more than one output bus simultaneously, confirm the plugin accepts this without erroring.
4. Send MIDI note-on events on two different MIDI channels and confirm (even just by checking non-zero signal / RMS in each bus's audio buffer) that different channels are being routed by the plugin to different internal instruments, and that each bus's audio buffer reflects only the output of the instrument(s) assigned to it.

Decision point:

- If 3.2 works cleanly → the Phase 0a-verified crate is confirmed viable for Crescode's core requirement. Proceed to Phase 4 with confidence.
- If 3.2 fights hard (missing needed bindings, inconsistent bus negotiation behavior) → stop and reassess here, with minimal sunk cost. Do not wait until Phase 5 to discover this.

Document the outcome in `crescode-engine/README.md` — specifically note which plugin was tested, how many buses were correctly detected, and any quirks encountered. This becomes the reference case for Phase 5.

---

## Phase 4 — Protocol Wiring for Single-Timbral Tracks
Goal: a Crescode track's VST button can load a plugin and the generated MIDI from Compose All actually plays through it. This phase covers the simple case (one track, one plugin, one MIDI channel, one stereo output) before Phase 5 builds the shared/multi-timbral case on top of it.

1. Map each Crescode track to one `PluginInstance` in the engine.
2. Implement the protocol messages for: load plugin onto track, unload, set parameter, save/load plugin state (for `.crescode` file save/load — the plugin's chunk data needs to round-trip through your save format).
3. Implement playback transport sync — when the frontend plays, the engine needs the same tick-accurate timeline the frontend's preview scheduler uses, so generated notes land on the plugin in time.

Test: in the app, load a real plugin on one track via the VST button (should move from "Not scanned"/"Empty" to "Loaded" state with real plugin data, not DEV sample data), hit Compose All, hit play, hear that track's generated part through the real plugin instead of the preview synth.

---

## Phase 5 — Multi-Timbral Routing (Core Requirement)

This is the part that makes Crescode actually useful for real orchestral templates, where one Kontakt instance plays 8+ instruments on separate MIDI channels. Phase 3.2 already proved the underlying bus negotiation works — this phase wires that capability into the full track/mixer/routing UI.

### 5.1 — Protocol additions

Add new message types to `docs/PROTOCOL.md` (and keep `src/engineClient/` in sync):

- `instrument_rack.create` — creates a shared plugin instance not tied to one track.
- `track.assign_to_rack` — assigns a Crescode track to `{rack_id, midi_channel, output_bus_index}`.
- `instrument_rack.list_outputs` — asks the engine what output buses a loaded plugin exposes (so the UI's routing panel can show real bus names like "Violins I" / "Violins II" if the plugin labels them, falling back to "Output 1" / "Output 2" etc.).

### 5.2 — Engine-side data model

```rust
struct InstrumentRack {
    id: RackId,
    plugin: PluginHandle,
    output_buses: Vec<AudioBusInfo>, // discovered from the plugin at load time
}

struct TrackRouting {
    track_id: TrackId,
    rack_id: RackId,
    midi_channel: u8,       // 0-15
    output_bus_index: usize, // which of the plugin's output buses feeds this track's mixer strip
}
```

### 5.3 — MIDI routing

When dispatching a note event for a given Crescode track, look up its `TrackRouting`, tag the MIDI event with the correct channel, and send it to the shared rack's plugin instance — not a dedicated instance per track.

### 5.4 — Audio bus routing

After loading a plugin into a rack:

1. Query its output bus count and layout (same calls validated in Phase 3.2).
2. Allocate one audio buffer per output bus.
3. After `process()` runs for the rack, route each output bus's buffer to the mixer strip(s) of whichever track(s) are assigned to that bus index.

Multiple tracks can share the same rack but read from different bus indices — this is the exact pattern used by a template like "one Kontakt instance = full string section, each articulation/instrument on its own MIDI channel and output."

### 5.5 — UI wiring

The Routing panel described in the README (groups, drag tracks between groups, loaded/unloaded badge) needs a new concept: "shared instrument rack" as a group type, distinct from a simple mix bus group. This may already map cleanly onto your existing routing group UI — confirm with the frontend code in `src/components/` before adding new UI; prefer extending the existing routing panel data model over creating a parallel one.

Test: load one multi-timbral plugin (e.g. Kontakt with a multi), assign 4 different Crescode tracks to 4 different MIDI channels and 4 different output buses on that same instance, hit Compose All + play, confirm each track's mixer strip shows independent meter activity and each plays the correct instrument.

---

## Phase 6 — Plugin Editor Windows

1. Implement the VST3 `IPlugView` embedding so a plugin's own GUI can open in a native window.
2. On Windows, this means creating an HWND, attaching the plugin's view to it via `IPlugView::attached()`, and handling resize events the plugin requests.

Test: click to open a loaded plugin's editor, confirm its native GUI renders and responds to mouse/keyboard, confirm closing it doesn't crash the engine.

---

## Phase 7 — State Save/Load Integration

1. Implement VST3 component state serialization (`IComponent::getState` / `setState`) and controller state if separate.
2. Wire this into `.crescode` file save/load so a project reopens with every plugin's full state restored, not just which plugin was loaded.

Test: load a plugin, tweak its parameters via its own GUI, save the project, close Crescode, reopen, confirm the plugin's state matches exactly.

---

## Phase 8 — Stability Hardening

1. Add a watchdog: if a plugin's `process()` call doesn't return within a reasonable budget (e.g. 2x the expected block time), treat the rack as hung — stop feeding it audio, surface an error to the UI, and allow the user to unload/reload it without restarting the whole engine.
2. Wrap plugin calls that happen outside the strict RT audio callback (loading, parameter queries, state save) in `catch_unwind` or equivalent, so a panicking/crashing plugin during a non-realtime operation doesn't take the whole engine process down.
3. Consider (stretch goal, not required for v1): moving each instrument rack into its own child process for full crash isolation, communicating via shared memory for audio and a control pipe for everything else. Only pursue this after Phases 1–7 are solid, since it adds real complexity.

---

## Phase 9 — Tauri Shell & Packaging

1. Wrap the existing frontend (already a single `dist/index.html`) in Tauri.
2. Tauri spawns `crescode-engine.exe` as a sidecar process on app launch and shuts it down cleanly on app close.
3. Build the Windows installer (Tauri's built-in bundler handles this).

Test: full end-to-end — install the app on a clean Windows machine, open it, scan for plugins, load a multi-timbral instrument, compose, route, play, save, reopen, confirm everything round-trips.

---

## Summary Checklist

- [ ] Phase 0a — VST3 hosting crate verified as real and suitable; findings documented
- [ ] Phase 0 — project builds, pure Rust toolchain confirmed, no C++ anywhere
- [ ] Phase 1 — WebSocket handshake/heartbeat working
- [ ] Phase 2 — sandboxed scanning, real plugin list in VST browser
- [ ] Phase 3.1 — one single-output plugin loads, makes sound
- [ ] Phase 3.2 — multi-bus negotiation validated against a real multi-timbral plugin (go/no-go checkpoint)
- [ ] Phase 4 — single-timbral track playback through Compose All
- [ ] Phase 5 — multi-timbral routing: MIDI channels + output buses to separate mixer strips
- [ ] Phase 6 — plugin editor GUI embedding
- [ ] Phase 7 — plugin state save/load round-trips through `.crescode` files
- [ ] Phase 8 — crash/hang isolation
- [ ] Phase 9 — Tauri packaging, installer
