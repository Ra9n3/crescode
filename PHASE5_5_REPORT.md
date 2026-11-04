# Phase 5.5 Report — export profile for UVI Orchestral Suite string ensembles

**Suite: 832 tests / 43 files green (807 + 25 new) · tsc clean · `npm run build` green (single-file `dist/index.html`).** No new dependencies. The profile is data (`src/export/profiles/uvi-orchestral-suite.json`); the code (`src/export/profile.ts`) is generic and holds no library/product names.

## What landed

- **Schema (additive, optional):** `Note.layer?: 'cb'` — set by the Vc+Cb layering step on the Cb-doubled notes. Preserved by `sanitizeNotes` (via `carryNoteFields`), humanize (spread; the Cb-double detection now prefers the explicit field, geometric fallback for old files) and the legato overlap. Old files load unchanged; `validateProject` rejects a bad layer value.
- **Export profile:** per part — patch name, MIDI channel, source role (+ optional layer), keyswitch names under the profile's `pitchConvention` (`C3=60`, confirmed: C0 = 24, C-1 = 12), fallback chains, `transposeSemitones`, `keyswitchLeadMs` 30, `keyswitchLengthMs` 60, `tremoloMode` (sampled default), `ccEnabled` (1/7/11 on, 68/74 off). Validator checks: keyswitch keys below the part's lowest playable note, valid articulation names, unique channels, unique sources, every articulation resolving through its fallback chain (chain terminal = sustain), acyclic chains.
- **Export behaviour:** keyswitch (velocity 100) ~30 ms before the first note of every articulation change through the tempo map — emitted only on change, plus one at each part's first note; it ends at or before its trigger note starts. Sampled tremolo merges each group of consecutive same-pitch repeats into one note (first start → last end, first repeat's velocity) in the export only; measured keeps the repeats and resolves through the fallback chain. Transposition per part, notes stay sounding pitch in the project. CC lanes filtered by `ccEnabled`; CC7 stays its single 90 at tick 0. Parts: channels 1–5, the `cellosBasses` track splits by layer into Cello (unmarked) and Bass (`layer:'cb'`) parts; non-part tracks pass through untouched. Per-part files name the split `NN Cello Ensemble.mid` / `NN Bass Ensemble.mid`.
- **UI:** a profile dropdown in the Export dialog (default "None (plain MIDI)"), used by both the merged and the per-track exports; the report line names the profile when active. Export mutates nothing, so undo is unaffected.
- **No-profile export is byte-identical to the pre-phase writer** — pinned against golden bytes captured at the previous commit (`tests/golden/`, dorian-cinematic + three-chorus-symphony, merged + every per-track file).

## Test battery (`tests/phase55.test.ts`, 25 tests)

Convention both ways (C0 = 24, C-1 = 12, round trip over 0..127); validator rejections (keyswitch inside the playable range, unknown articulation, duplicate channel, unresolvable chain); fallback chains (cello pizz → E-1 = 16, cello/bass staccato+spiccato → marcato A-1, violins staccato → sustain, detache/portato/sulTasto/sulPont/conSord → sustain, legato → Sustain Smooth); `layer:'cb'` routing (Bass ch5) vs unmarked (Cello ch4), channels 1–5; keyswitch emission rules (velocity 100, only on change, strictly ahead of its trigger, ends before it starts) recomputed independently; the 30 ms lead rides the tempo map (verified across a 100→180 BPM change); keyswitches never enter the project (byte-equal project JSON after export, `validateProject` passes); transpose applied in the export only; sampled merges / measured doesn't (+ measured skips the tremolo key); `ccEnabled` respected (68/74 off by default, flippable); round-trip parse shows keyswitches + CC; per-part file split; sanitize/humanize/legato preserve `layer`; old files load unchanged; byte determinism; chamber (no cb layer) exports no Bass part.

## Report numbers

**Keyswitch count per part + articulation sequence, bars 1–8** (dorian fixture, take 1, composed + profiled):

| part | cinematic | symphony |
|---|---|---|
| violins1 (ch1) | 3 — b1 legato×22 | 1 — b1 legato×43 |
| violins2 (ch2) | 2 — b5 spiccato×16 | 1 — b1 legato×26 |
| violas (ch3) | 1 — b2 spiccato×96 | 1 — b1 legato×26 |
| cello (ch4) | 1 — b1 legato×26 | 1 — b1 pizz×30 |
| bass (ch5) | 1 — b4 legato×20 | 1 — b1 pizz×26 |

(three-chorus cinematic take 1 for comparison: 7/7/7/1/1 — the tremolo bed adds legato↔tremolo changes at the chorus energy peak.)

**Tremolo merge (sampled), cinematic:** dorian take 1 — **224 repeats → 133 merged groups**; three-chorus take 1 — **1440 repeats → 452 merged groups** (988 repeats removed; plain 2639 notes → 1674 profiled + 23 keyswitches).

**4.8 side item — pizz overrepresentation: NOT a bug.** 400-take distribution on three-chorus-40bars (all section types draw the SAME full palette — no per-type restriction, no fallback path):

| type | leadPadBed (25) | singleOst (20) | pizzPulse (15) | tremoloBed (15) | interlock (15) | trailer (10) |
|---|---|---|---|---|---|---|
| verse | 25.3% | 19.3% | 16.3% | 14.0% | 14.0% | 11.3% |
| chorus | 22.5% | 22.8% | 14.8% | 13.3% | 14.3% | 12.5% |
| bridge | 25.5% | 23.3% | **12.3%** | 15.3% | 12.5% | 11.3% |
| outro | 26.0% | 19.5% | 16.5% | 13.0% | 16.3% | 8.8% |

Every type sits within binomial noise of its weight (n=400, ±1.8% for pizzPulse); bridge is actually the LOWEST pizzPulse draw. Takes 1..10 reproduce the report table's 12 rows exactly (3+4+2+3 across verse/chorus/bridge/outro = 12/40 draws, 12/26 among the ostinato-row subset) — a small-sample fluctuation, nothing to fix.

**Downbeat accent** (95.1 vs 92.4): unchanged, as instructed — the user will judge it in Falcon. **Interlocked bar losing the viola**: left as is (rare, not a blocker).

## UNVERIFIED values still marked in the profile JSON

1. `parts[1].keyswitches.spiccato` — Violins 2 spiccato **D2** (small manual image)
2. `parts[2].keyswitches.spiccato` — Viola spiccato **C#1** (small manual image)
3. `parts[3].keyswitches.marcato` — Cello marcato **A-1** (small manual image)
4. `parts[4].transposeSemitones` — Bass part, default **0**

`pitchConvention: 'C3=60'` is confirmed (C0 = 24, C-1 = 12) and no longer marked.
