# Phase 5 Report (with 4.7) — draw distribution, chorus staircase, contour, CC, humanize

**Suite: 772/772 passed (40 files) · tsc clean · `npm run build` green (single-file `dist/index.html`).** Commits: 4.7 (`b43536c`), 5a (`a7676d8`), 5b (`afe7bf6`), 5c (`a3f39f8`), 5d (`e76c72e`), 5e + this report. New batteries: `tests/phase47.test.ts` (4), `phase5a-staircase` (2), `phase5b-contour` (2), `phase5c-cc` (10), `phase5d-humanize` (8), `phase5e-matrix` (6). No new dependencies. Out of scope, untouched: preview synth, UI, other families' modules.

## Phase 4.7 — the texture draw, measured over 400 takes

- 400 takes × dorian cinematic: per-texture Verse/Chorus frequency against the named weights (25/20/15/15/15/10). Verse: leadPadBed 23.3%, singleOstinato 21.3%, interlocking 13.3%, pizzPulse 16.0%, tremoloBed 17.0%, trailer 9.3%. Chorus: 24.0 / 23.3 / 17.0 / 14.5 / 13.8 / 7.5. Chi-square goodness of fit: verse 3.18, chorus 6.32 — both far under the 95% critical value 11.07 (5 df). **No skew in the hash or draw — nothing to fix.** (The old 8/40 = 20% chorus-trailer reading was 40-take sampling noise: over 400 takes the trailer lands at 7.5%.)
- Tightened window: trailer in Chorus within 6–14% (30/400 = 7.5%, asserted); Verse trailer 9.3%.
- Verse/Chorus draws are independent: chi-square independence 24.58 < 37.65 (25 df), the full 6×6 joint table printed in the test.
- A fresh project's FIRST Compose All draws at take 1: `verse=trailer, chorus=trailer` (reported from the compose reports line and cross-checked against the pure draw).

## 5a — the chorus staircase (spine/energyArc.ts)

- Non-peak choruses no longer all sit on `PEAK_RESERVE` (88%): with n chorus-like sections before the peak, the first caps at `CHORUS_STAIRCASE_OPEN` = 70% of the clamp max, the last non-peak chorus at `CHORUS_STAIRCASE_TOP` = 85%, linear in between; a lone non-peak chorus sits at the top share. The peak is unchanged (opens at 85%, rises to 100%).
- Per-chorus mean planned E on the three-chorus fixture (chorus 3 = peak), take 1:

| template (clamp) | chorus 1 mean/max | chorus 2 mean/max | chorus 3 (peak) mean/max |
| --- | --- | --- | --- |
| symphony (0.85) | 0.586 / 0.595 | 0.682 / 0.722 | 0.756 / 0.850 |
| chamber (0.70) | 0.490 / 0.490 | 0.581 / 0.595 | 0.616 / 0.700 |
| cinematic (0.95) | 0.648 / 0.665 | 0.713 / 0.783 | 0.848 / 0.950 |
| sonata (0.65) | 0.455 / 0.455 | 0.553 / 0.552 | 0.572 / 0.650 |
| vocalbacking (0.65) | 0.455 / 0.455 | 0.546 / 0.552 | 0.573 / 0.650 |
| hybridstudio (0.90) | 0.619 / 0.630 | 0.712 / 0.765 | 0.803 / 0.900 |

- Means rise chorus 1 < 2 < 3 on every template (asserted); a four-chorus fixture verifies the linear interpolation (caps 0.665 / 0.736 / 0.807 bind, the fourth chorus still reaches the clamp).

## 5b — the motif contour survives chord-tone snapping (lines/motif.ts)

- Strong-beat snapping (and the post-settle re-snap) now preserves each interval's DIRECTION: the walk's own degree wins when it is already a chord tone; otherwise same-direction candidates are searched nearest-first (bounded by the scale walk) and the opposite direction only as a last resort — a rising step can never snap downward or collapse to a repeat.
- Verse vs chorus contour agreement ≥ 0.7 for ALL takes 0–5 on BOTH fixtures (no pinned take): dorian 0.79 / 1.00 / 0.74 / 1.00 / 1.00 / 0.74; three-chorus 1.00 / 1.00 / 0.87 / 0.91 / 1.00 / 1.00. The chorus register is still raised (asserted per take).

## 5c — CC generation (orchestrator/expression/cc.ts, wired into Compose All)

- Per-take texture plan drives everything, read from the notes' articulations per bar: ostinato/pizz bars, tremolo bars, legato lines. Handoffs need no special case — each carrier's own track carries its arch, so the arc follows the current lead carrier by construction.
- **CC1 + CC11**: one phrase arc per phrase (4-bar chunks aligned to the section start): a raised-cosine rise to the phrase's highest-energy bar, easing off after, scaled by the bar's arc energy; CC11 spans 30–96, slightly wider than CC1's 38–84. A phrase a track plays entirely as ostinato/pizz gets no arch; tremolo carriers get their arcs like every sustained line.
- **CC7**: one static point at tick 0 (balance 90) per track.
- **CC74**: short seeded spikes (value 96–120, length 48–96 ticks, one draw per take) on phrase-start downbeats and on the first tremolo/ostinato onset of each bar; the lane rests at 0 from tick 0.
- **CC68**: 127 over legato passages, 0 elsewhere (explicit 0 at tick 0), gaps ≤ 240 ticks stay inside one passage; ostinato/pizz/tremolo-only tracks have no legato and therefore no CC68 lane at all.
- **S-curves**: a 40–80 ms smoothstep ramp (tempo-map ticks, seeded per take) on CC11 at soft legato entries (first note after a rest, velocity < 50) — legato entries only, never on ostinato/pizz/tremolo.
- Engineering contract: lanes sorted by tick, clamped into [0, project end], ≤ 1024 points/lane (collinear points thinned, then an even decimation as the hard cap), values 0–127, deterministic per D8. Locked and out-of-band tracks get no CC (they never enter the builder; asserted).
- Point counts per track (three-chorus 40-bar fixture, take 1): worst lane 138 (sonata Cellos/Basses CC11) — the 1024 cap is never approached; full per-track table printed by the 5c/5e tests (e.g. cinematic Violins I: CC1 37 / CC11 87 / CC68 9 / CC74 62 / CC7 1).

## 5d — humanize (orchestrator/expression/humanize.ts, wired between the mix governor and the CC build)

- **Timing**: POSITIVE offsets, correlated within a section — a per-section base (one draw per section per role group from the take stream) plus ±4 ms per-note jitter; violins/violas land in +5..18 ms, cellosBasses in +12..28 ms through the tempo map at the note's own position. Only the START moves; the original end is kept, so nothing passes the project end, its section window, or shrinks to zero length. Measured ranges per track (40-bar fixture, take 1): violins/violas 5.0–17.5 ms, cellosBasses 12.5–28.8 ms.
- **Cb layer**: doubles trail their cello partner by 1–3 ms (asserted; the partner offset is reused so the low octave follows).
- **Tremolo**: the section base WITHOUT per-note jitter (one identical offset per section, asserted) and untouched velocity — measured repeats stay mechanical.
- **Velocity**: ±4 jitter that never lifts a note above the governor cap for its windows (per-beat sounding-role counts over the full mix; dense-window unit test). The mix governor re-runs AFTER humanize, so `measureEnergy` still cannot exceed the clamp on all six templates (asserted).
- **Detune is not stored** — it stays a preview-profile constant.
- **The engine's exported `humanizeNotes` is NOT reused here, deliberately**: it jitters symmetrically around zero, moves start AND end together, and has no notion of sections, role ranges, governor caps or Cb partners. It stays with the rules generator's own humanize path; the orchestrator's strings get `humanizeStrings`.
- Grid-exact earlier-phase contracts now carry a bounded head (HUMANIZE_HEAD_TICKS = 60, exported from the energy rules): chord-span head coverage, D9 doubling match, sustained-bass/vocalbacking minimum lengths, ostinato grid + pizz beats + tremolo onset tolerances, Cb pair matching, the 4.6 interlock offset envelope (240 ± head). The D10 octave-doubling audit is humanize-aware (attacks written for a tick count as sounding there within the head).

## 5e — the matrix (6 templates × 3 key/modes × takes 0..2 = 54 cells)

- Every cell asserts: determinism (byte-identical notes + CC on a second compose), `validateProject` passes, `sanitizeNotes` is a no-op, every CC lane sorted/in-range/capped, CC7 static, CC68 127-windows contain legato notes, no CC on locked tracks, `measureEnergy` ≤ clamp with no hard violations, humanized starts never before the grid start, and every offset inside its ms range through the tempo map (matched back to the pre-humanize score the compose pipeline builds — breaths included, take incremented).
- **MIDI export round-trips the new CC**: per track, per controller, the parsed events equal the lane points exactly (all six templates on the 40-bar fixture).
- Report tables (offset min/max per track, CC point counts per track per template, cap check) are printed by the 5e test and quoted above.
