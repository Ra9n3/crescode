# Phase 4.8 — Ostinato variety

Per take and per section TYPE the conductor now draws a whole ostinato **style** from the
D8 seed, in addition to the existing pattern shape (repeat / arpeggio / rootFifth, untouched,
stream positions 1–3 preserved). Every weight is a named constant. CC and humanize read the
notes, so they follow the cells automatically (pinned by tests: CC74 spike placement, tick-0
baseline, humanize-head grid tolerance).

## The style draw (draw order = seed-stream order)

| # | draw | options (weights) |
|---|---|---|
| 4 | rhythm cell | straight 30 · syncopated 20 · gallop 12 · offBeat 18 · sparse 20 |
| 5 | contour | ascending 25 · descending 25 · pingPong 25 · pedal 25 |
| 6 | accent | downbeat 40 · offBeat 30 · flat 30 |
| 7 | density curve | rise 55 · dip 45 |
| 8 | pairing | interlock 55 · hocket 45 |

Rules that ride along:

- **Default stays calm** — `straight` is the baseStyle default and the heaviest cell weight;
  the 16th GRID stays trailer-only (the trailer pins `straight` + rate `sixteenths` = the full
  16th grid, exactly the 4e/4.6 behaviour). The gallop's two 16th pickups are its cell shape,
  not a rate.
- **Meter-aware** — cells are defined over FELT BEATS: simple meters divide a beat into 2
  slots (8ths) or 4 (gallop's 16ths), compound meters into 3. `syncopated` is 3+3+2 over the
  bar's 8th slots (3/4 → 3+3, 6/8 → the dotted-beat downbeats); `gallop` in compound is the
  ternary 8th–rest–8th lilt; `offBeat` is slot 1 of every beat (compound: the middle 8th);
  `sparse` is 2 per 2-beat group with rests, and a lone last beat in odd meters takes its
  downbeat. Every onset lands on a felt-beat subdivision in 4/4, 3/4 and 6/8.
- **No gallop for the interlocking texture** — two galloping tracks (3 onsets/beat each)
  would double past the 4.6 calm-down bound (≤ half the trailer's per-bar count). The
  `INTERLOCK_CELL_IDS` set enforces it at the draw.
- **Contours** walk the REGISTER, the shape still picks the chord-tone pc: ascending /
  descending wrap at the window edges, ping-pong zigzags and bounces, pedal holds a fixed low
  chord tone under a moving upper tone. All stay on chord tones minus the leading tone, in
  range, under the lead's ceiling.
- **Accents** (`ACCENT_VELOCITY = 12`) rise to the window's governor cap, never past it — so
  measureEnergy still cannot exceed the clamp. At cap-sitting energies (outro climax bars)
  the accent naturally flattens.
- **Density curve** — per bar the two-track texture compares the bar's arc target against the
  section's OWN arc-range midpoint: `rise` = full (two tracks) on the high half, thin (upper
  track only) below; `dip` is the reverse curve. Not a fixed on/off (pinned: thin > 0 AND
  full > 0 bars per draw).
- **Hocket** — across-bar call/response between V2 and Vla (even section bar → V2 calls, odd
  → the viola answers; same grid, no offset), an option next to the existing half-slot
  interlock. The trailer keeps its pinned unison drive.

## Pattern table — takes 1..10 (three-chorus cinematic, result takes)

| take | section | texture | cell | contour | accent | density | pairing |
|---|---|---|---|---|---|---|---|
| 1 | chorus | pizzPulse | syncopated | descending | offBeat | dip | unison |
| 1 | outro | singleOstinato | sparse | pedal | downbeat | dip | unison |
| 2 | verse | interlockingOstinato | straight | ascending | flat | rise | hocket |
| 2 | bridge | singleOstinato | syncopated | pingPong | offBeat | rise | unison |
| 2 | outro | pizzPulse | sparse | pingPong | downbeat | rise | unison |
| 3 | verse | pizzPulse | straight | pedal | downbeat | rise | unison |
| 3 | chorus | trailer | straight | ascending | offBeat | rise | unison |
| 3 | outro | interlockingOstinato | syncopated | pingPong | downbeat | rise | interlock |
| 4 | chorus | interlockingOstinato | sparse | pedal | offBeat | dip | hocket |
| 4 | bridge | pizzPulse | sparse | pedal | offBeat | dip | unison |
| 4 | outro | interlockingOstinato | straight | pingPong | flat | dip | interlock |
| 5 | verse | pizzPulse | sparse | ascending | flat | rise | unison |
| 5 | chorus | pizzPulse | straight | ascending | downbeat | dip | unison |
| 5 | bridge | pizzPulse | straight | ascending | flat | dip | unison |
| 6 | verse | pizzPulse | straight | pingPong | offBeat | rise | unison |
| 6 | chorus | pizzPulse | straight | ascending | offBeat | dip | unison |
| 6 | bridge | interlockingOstinato | sparse | ascending | downbeat | rise | hocket |
| 6 | outro | pizzPulse | gallop | pedal | downbeat | dip | unison |
| 7 | bridge | interlockingOstinato | syncopated | pingPong | downbeat | dip | interlock |
| 7 | outro | singleOstinato | straight | ascending | downbeat | rise | unison |
| 8 | bridge | interlockingOstinato | sparse | pedal | downbeat | dip | interlock |
| 9 | verse | singleOstinato | offBeat | pingPong | downbeat | rise | unison |
| 9 | chorus | pizzPulse | sparse | pingPong | downbeat | rise | unison |
| 10 | verse | trailer | straight | ascending | downbeat | rise | unison |
| 10 | bridge | trailer | straight | descending | offBeat | dip | unison |
| 10 | outro | pizzPulse | gallop | descending | offBeat | rise | unison |

(Takes 7 and 8 drew non-ostinato textures for some sections — those sections carry no rows.)

## Measured (cinematic, takes 0..39, dorian + three-chorus fixtures — the 4.8 battery)

- **157 verified (take, section-type) draws**; every onset of every draw sits on its drawn
  cell's slot grid within the tempo-map humanize head.
- **6 distinct ostinato onset patterns** (≥ 6 required): straight:eighths ×38,
  syncopated:eighths ×29, offBeat:eighths ×25, sparse:eighths ×27, gallop:eighths ×10,
  straight:sixteenths (trailer grid) ×28.
- **(cell, contour) sharing**: worst combo `straight|ascending` = **14.0%** over 157 draws /
  20 combos (limit ~25%).
- **Hocket alternation** verified on 10 (take, type) draws: exactly one track per bar, V2 on
  even section bars; two-track bars over the battery: 112 hocketed, 22 density-thin,
  20 density-full.
- **Density curve** verified on 11 interlocked draws: 11 thin bars, 8 full bars (7 with both
  tracks sounding, 1 ceiling-squeezed — the under-lead pass removed the viola's only
  candidates, the same pre-existing squeeze any interlocked bar can hit; not a density gate).
- **Downbeat accent** verified over 42 draws (29 clearly accented): aggregate first-of-bar
  mean velocity 95.1 vs 92.4 for the other onsets; high-energy cap-sitting bars mute it by
  design (never past the governor cap).
- **Meters**: 3/4 and 6/8 fixtures built in the test — all five cells observed in EACH meter
  (29 draws each), every onset on its felt-beat slots.
- **Kept contracts, all green**: 4.6 calm-down (non-trailer max 8 onsets/chorus-bar vs
  trailer max 32 — ≤ half holds), enter-after/dip-bar/4th-bar gating, trailer full 16th grid,
  CC74 spikes == actual first onsets per bar, tick-0 CC1/CC11/CC7 baseline, sanitize no-op,
  track ranges, monophony (no ostinato self-overlap), energy ≤ clamp on all six templates,
  byte determinism.

Suite: **807 tests / 42 files green**, typecheck clean, `dist/index.html` builds.
