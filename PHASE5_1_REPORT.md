# Phase 5.1 + 4.8 Report — baseline CC, legato overlap, tempo-map head, ostinato cells

**Suite: 792/792 passed (42 files) · tsc clean · `npm run build` green (single-file `dist/index.html`).** Commits: 5.1.3 (`b47ce3e`), 5.1.1 (`e9a1d40`), 5.1.2 (`c9622f3`), 4.8 (`cb2f891`). New batteries: `tests/phase51.test.ts` (12), `phase48` (8). No new dependencies. Out of scope, untouched: preview synth, UI, other families' modules.

## 5.1.1 — baseline CC (expression/cc.ts)

- Every in-band unlocked string track's **CC1/CC11 lane covers the whole piece**: first point at tick 0, closing point at the project end, a defined level at every bar. Line bars ride the phrase arch exactly as before; **ostinato/pizz/tremolo stretches and rests hold a flat level** derived from the bar's arc energy — `CC_BASELINE_ARCH` 0.5 of the range scaled by `0.5 + 0.5·E` — with CC11 lifted `CC_BASELINE_LIFT` = 6 above CC1 there (the gap stays +3..+8 across the energy band, strictly above).
- Phrases a track plays entirely as texture get the baseline instead of no arch. Point counts stay far under the cap (worst lane on the 40-bar fixture unchanged in kind, < 300).
- Tests: 5c's arch contract rewritten (the arch must lift line bars above the baseline band; pure texture stretches must hold the energy-scaled flat baseline with CC11 ≥ CC1 at every bar); the phase51 battery asserts tick-0 first points for CC1/CC11/CC7 and project-end closure on every composed track of all six templates on **both** fixtures, plus per-bar definedness.

## 5.1.2 — legato overlap (expression/legato.ts, wired into Compose All)

- In legato passages each note's end reaches the **next note's humanized start plus a seeded 10–30 ms overlap** (tempo-map ticks, one draw per join from the take stream). Runs after humanize, before the governor re-run and the CC build — CC68's legato windows cover the overlap.
- Guardrails: legato articulation only; **one voice per track** (a join is blocked when anything else sounds in the bridged stretch, except the join's own note and its same-position octave doubles); the join only re-glues what humanize/grid separated (gap ≤ the tempo-map humanize head — a written rest stays a rest); a repeated pitch re-articulates, and the extension never creates a same-pitch overlap (sanitize stays a no-op); never past the section window or project end — a cramped join at a section edge is skipped, so every created overlap stays inside the band.
- The transient crossfades are exempt from the low-interval and leading-tone voicing reads (a ≤ 31 ms bow change, not a voicing); the golden bass-pc contract reads attacks.
- Tests: the phase51 battery classifies every same-track overlap (octave double / ≤ 31 ms join crossfade / the line's own both-legato overlap), bounds every note to its section window and the project end, re-pins sanitize no-op + validateProject + clamp on all six templates, and unit-pins glue/rest/repeat/block/section-edge/non-legato.

## 5.1.3 — the humanize head through the tempo map (expression/timing.ts)

- `humanizeHeadTicks(tempoMap, atTick)` replaces the flat `HUMANIZE_HEAD_TICKS = 60` (which was only right near ~117 BPM): 32 ms (bass top 28 + Cb follow 3 + rounding) lands as **~31 ticks at 60 BPM, ~52 at 100, ~62 at 120, ~93 at 180**. The D10 audit (voicesAt break bound, exemption and climax lookbacks) reads the head at the tick it checks; every grid-tolerance test derives it per position.
- **The 5e matrix re-runs at 60 and 180 BPM**: 108 cells (6 templates × 3 key/modes × takes 0..2) each asserting validate / sanitize no-op / CC validity / CC7 static / CC68 over legato / energy clamp / non-negative starts; determinism on the take-0 cells; every offset inside its ms range through THAT tempo map. Head-vs-tempo unit: 31/52/93 ticks.
- **Offsets per track (ms | ticks)**, three-chorus 40-bar fixture, take 1 — the same ms draw lands in tempo-scaled ticks:

| template | track | 60 BPM ms | 60 BPM ticks | 180 BPM ms | 180 BPM ticks |
| --- | --- | --- | --- | --- | --- |
| symphony | Cellos/Basses | 13.5..28.1 | 13..27 | 13.2..27.4 | 38..79 |
| symphony | Violins I | 6.3..15.6 | 6..15 | 5.9..16.3 | 17..47 |
| chamber | Cellos/Basses | 12.5..26.0 | 12..25 | 16.7..27.1 | 48..78 |
| chamber | Violins I | 7.3..17.7 | 7..17 | 6.3..17.0 | 18..49 |
| cinematic | Cellos/Basses | 12.5..26.0 | 12..25 | 13.2..26.7 | 38..77 |
| cinematic | Violins I | 8.3..15.6 | 8..15 | 9.0..14.2 | 26..41 |
| sonata | Cellos/Basses | 14.6..27.1 | 14..26 | 17.7..25.0 | 51..72 |
| vocalbacking | Cellos/Basses | 14.6..26.0 | 14..25 | 14.6..27.8 | 42..80 |
| hybridstudio | Cellos/Basses | 13.5..29.2 | 13..28 | 14.9..27.4 | 43..79 |
| hybridstudio | Violins I | 6.3..17.7 | 6..17 | 8.0..16.7 | 23..48 |

(The full per-track table — violas and violins II included at both tempos — is printed by the 5.1.3 report test.)

## 4.8 — ostinato rhythm cells (conductor/layers.ts + lines/ostinato.ts)

- The texture now draws a **rhythm cell** — a 4-step mask over the rate grid, tiled through the bar — per take and section type: `straight` 1111 / `lift3` 1101 / `skip2` 1011 / `dactyl` 1100. It is the fourth seeded style draw, placed AFTER the established shape/enterAfter/ost-track draws, so their stream positions (and every measured frequency) are unchanged. The **trailer pins 'straight'** — it stays the full 16th grid.
- `ostinatoNotes` applies the mask (a 0 step rests); the renderer hands the drawn cell through. The cells only ever REMOVE onsets, so every 4.6 contract keeps holding: enters 1–2 bars in, the dip bar rests, the last beat of every 4th bar rests, interlock = the same mask on both tracks half a step apart, calm-down ≤ half the trailer count.
- **CC and humanize follow the cells automatically** (they read the notes) — pinned: CC74 spike ticks exactly equal the phrase downbeats plus the first tremolo/ostinato onset per bar recomputed from the cells' onsets (78 ostinato tracks verified); onsets sit on their mask positions within the tempo-map humanize head (89 draw checks); the 5.1.1 tick-0 CC contract holds on cell-thinned takes.
- Draw distribution over 40 three-chorus takes (109 drawn cells): straight 38 / lift3 29 / skip2 25 / dactyl 17. The phase46 interlock bar tolerates the dactyl minimum (≥ 4 onsets/bar).
