# Phase 6 Report — expressive preview synth

**Suite: 862 tests / 44 files green (832 + 30 new: 25 in `tests/phase56.test.ts`, 5 cbLayer tests added to `tests/phase55.test.ts`) · tsc clean (src + tests) · build green (single-file `dist/index.html`) · all three e2e smokes green (54 + 41 + 35 checks).** No new dependencies. No project schema changes. The preview never mutates the project (pinned by deep-equal). One answer to the open question: **862 is the current test count** (792 was pre-5.1; 807 pre-4.8).

## Files changed

- `src/audio/mapping.ts` **(new)** — the pure mapping: `ccValueAt`, `ccLaneOf`, `cc1At`, `expressionGain`, `expressionEvents`, `coalesceCcPoints`, `dynamicGain`, `brightnessGain`, `voiceParams`, `voiceDetune`, `stringPartOf`, `planTrackNotes`, the articulation table and the detune constants. No AudioContext — unit-tested in node.
- `src/audio/preview.ts` — reuses its existing structure and per-track nodes: each strip gained one `expr` GainNode (voices → expr → mixer gain → pan → analyser); expressive mode schedules CC11 onto it in the same 150 ms windows the notes use, through the segment's tick→seconds anchor; CC7 folds into the mixer gain as a static level in `applyMixer`; `playVoice` takes an optional `{params, detuneCents}` (absent = today's exact path); freeze renders the same mapping offline and its hash now includes the mode.
- `src/export/profile.ts`, `src/export/profiles/uvi-orchestral-suite.json` — item 0: `cbLayer: 'separate' | 'omit'` (default `'omit'`, shipped in the JSON): omit drops the Cb-layer notes from the export entirely — no Bass part, no Bass file; `'separate'` keeps the 5.5 behaviour. Both output shapes go through `chunksForTrack`, so one change covers merged + per-part. No-profile export byte identity re-pinned against the golden bytes.
- `src/store/store.ts`, `src/audio/transport.ts` — UI-only `previewMode: 'simple' | 'expressive'` (default expressive, never stored in the project), bound into the engine.
- `src/components/StatusBar.tsx` (+ a pointer comment in `TopBar.tsx`) — the "Preview: simple | expressive" control lives in the status bar beside the follow control; a first placement in the top bar's transport cluster pushed the Routing button past the window at 1280/1366 px (caught by the smoke e2e, fixed by moving it).
- `tests/phase56.test.ts` **(new)**, `tests/phase55.test.ts` (bass-routing tests now run under `cbLayer: 'separate'`; new omit battery).

## Mapping table as implemented (`src/audio/mapping.ts`)

| Articulation | Attack | Release | Cap | Shape |
|---|---|---|---|---|
| sustain / detache / portato / sulTasto / sulPont / conSord | 90 ms | 150 ms | — | linear, full sustain |
| legato | 150 ms | 180 ms | — | **sqrt attack + sqrt fade** (equal-power crossfade halves) |
| marcato | 20 ms | 150 ms | — | accent ×1.3 bump, decays (τ 90 ms) to sustain |
| staccato | 20 ms | 60 ms | **180 ms** | linear |
| spiccato | 12 ms | 60 ms | **220 ms** | linear |
| pizz | 4 ms | 120 ms tail | — | exponential decay τ 240 ms, regardless of note length |
| tremolo | 90 ms | 150 ms | — | **AM 8 Hz, depth 0.40** over the held note |

- **Tremolo rate/depth:** 8 Hz (in the 7–9 window), depth 0.4 (±40% around the held level) — constants `TREMOLO_RATE_HZ` / `TREMOLO_DEPTH`. The merge is THE 5.5 export `mergeTremoloGroups` (reused, not copied); the export merge drops `articulation` on merged groups, so the preview re-marks those notes `'tremolo'` (preview-only; export output untouched — pinned by tests).
- **Detune (D9, preview only, never stored):** per-part spread — violins1 ±8, violins2 ±8, violas ±6, cello ±6, bass (layer cb) ±4 cents; each voice's offset = `(hash01(pitch:startTick)·2−1)·spread` via `hashString` — deterministic, no Math.random, verified to vary (>20 distinct offsets over 100 voices) and stay in range.
- **CC1 → dynamics:** voice gain `0.3 + 0.7·(cc1/127)^1.2` (perceptual taper — CC1 38..84 ≈ 0.48..0.74) **+ brightness**: the voice's lowpass × `0.7 + 0.6·cc1/127` (CC1 38..84 ≈ ×0.88..×1.10). Synthesis-internal; not exposed in the UI. No CC1 lane → unity (old projects keep their level).
- **CC11 → expression gain:** `0.25 + 0.75·(cc11/127)^1.3` on the strip's expr node; scheduled as AudioParam `setValueAtTime` events. **CC7 → static level:** `(cc7/127)` multiplier on the mixer gain (lane is one tick-0 90 → ×0.709 on composed tracks; no lane → ×1).
- **No articulation → today's behaviour:** `voiceParams` returns the legacy row (attack 90 ms / release 300 ms / sustain 0.85) and the engine's legacy envelope runs unchanged; simple mode never consults the mapping at all and schedules the stored notes array as-is.

## Interpolation + event counts

**`ccValueAt` == the export's semantics:** the MIDI writer emits every lane point as one controller event and holds the last value between events (the composer's S-curves are baked in as point ramps — there is no interpolation in the writer). `ccValueAt` is that step function: last point ≤ tick wins, later write wins on a shared tick, before the first point the first value holds. A test parses the actual exported file and asserts, per track per lane, that the parsed events equal the lane points and `ccValueAt` reproduces the file's value at every event tick.

**Max automation events per track (three-chorus-40bars, cinematic take 1, coalesced):**

| track | CC11 events (scheduled) | lanes 1+7+11 coalesced |
|---|---|---|
| **Cellos/Basses** | **58 (max)** | 97 |
| Violins I | 48 | 75 |
| Violins II | 33 | 57 |
| Violas | 22 | 45 |
| all other tracks | 0 (no lanes) | 0 |

Coalescing drops no-op steps (a point that doesn't change the held value fires no event); every lane stays ≤ `MAX_CC_POINTS_PER_LANE` (1024). Loop wraps are safe (all of a pass's events fire before the wrap anchor); starting mid-piece primes the expr node with `ccValueAt(lane, fromTick)` — pinned against the file's held value at that position.

## Wasn't possible / approximations

- **Equal-power legato crossfade is approximated** with 4-segment sqrt-shaped linear ramps instead of `setValueCurveAtTime` — a value curve can't be cancelled mid-flight by the Stop path, and the crossfade region is only the 10–30 ms the 5.1.2 overlap writes.
- **Tempo edit during playback:** ≤150 ms of already-scheduled CC events keep the old timing until the next window — the same accepted behaviour the notes have (the rebase test in the transport e2e stays green).
- **The A/B switch applies from the next Play** (already-scheduled voices keep their params); frozen buffers are rendered in the current mode and the freeze hash includes it, so switching invalidates stale buffers.
- Preview tick→seconds goes through the transport's segment anchor — identical to the tempo-map conversion in v1 (single tempo entry), and a tempo change still rebases the whole engine as before.
