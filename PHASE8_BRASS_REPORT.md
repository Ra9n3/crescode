# Phase 8 Report — brass

**Suite: 904 tests / 47 files green (886 + 18 in `tests/brass.test.ts`) · tsc clean (src + tests) · single-file build green · e2e smokes 54 + 41 + 35.** No new dependencies. One additive schema value (`'sustain'` joined the `ARTICULATIONS` union — the preview mapping already had the sustain-family row); brass articulations are stored as data (`sustain`, `legato`, `marcato`, `staccato`), never as keyswitches. Composition is unchanged for every template without brass and for every non-brass track outside the sanctioned bars (pinned).

## Baseline and pins

The baseline is the pre-brass HEAD (`a4a14ab`) composed with moments ON, captured before building into `tests/golden-moments/` (all six templates × three-chorus + dorian × takes 1–10; chamber/sonata/vocalbacking as full bytes, the brass templates as per-track bytes). The existing moments-off golden (`tests/golden/`) was regenerated (`scripts/make-golden.ts`, still moments:false) — its diff scope was verified **brass-only first**: all 28 non-brass per-track exports of the two golden compositions are byte-identical to the committed files; only the four brass tracks + the merged file changed.

Pins in `tests/brass.test.ts`: chamber/sonata/vocalbacking byte-identical to the baseline (60 compositions); symphony/cinematic/hybridstudio non-brass tracks identical outside the sanctioned bars — brass-lead bars (the strings drop to pad), horn-soli bars, and all moment bars on either side (the moments plans legitimately moved: the brass lead's bars join the moments' noGo, so a divisi can land elsewhere), plus notes ending inside the legato-join window of a sanctioned bar (the entry crossfade class).

## Pre-flight

**Brass rosters** (tracks = the default instrument tracks; hard ranges from `shared/schema/ranges.ts`):

| template | brass | hard ranges (MIDI sounding) |
|---|---|---|
| symphony | horns, trumpets, trombones, tuba | horns 41–77, trumpets 52–84, trombones 40–77, tuba 26–65 |
| cinematic | horns, trumpets, trombones, tuba | same |
| hybridstudio | horns, trumpets, trombones (no tuba) | same minus tuba |
| chamber / sonata / vocalbacking | none | — (module silent, output byte-identical) |

**Soft zones vs the config ranges** — the sweet spots (horns 41–72, trumpets 58–77, trombones 53–70, tuba 41–53) all sit inside the hard ranges; the differences are width only (the config's playable extremes are wider: horns reach 77, trumpets 52–84, trombones 40–77, tuba 26–65). The module writes everywhere inside the sweet spots; the out-of-sweet-spot guard (allowed only above the 0.75 gate) never fired. Note names: the source text writes C4=60, the app displays C3=60 — all numbers here are MIDI, sounding (display: horns F1–C4, trumpets A#2–F4, trombones F2–A#3, tuba F1–F2).

**Voices per track: ONE.** The rules generator voiced horns/trombones as 2–3-voice block pads (why the checker needed its block-chord exemption); the module writes monophonic section lines — the choir covers harmony across tracks (horn pad + trombone guide tone + tuba bass). The Phase 7 `div2` relaxation stays strings-only: without a brass export profile there is no honest second line through parts/keyswitches, and D2, the legato joins, the CC bar-kinds and the audit all keep their one-voice assumptions.

## Build

- `src/orchestrator/brass/profile.ts` (new) — zones, ceilings, caps (horns 10 s / trumpets 6 s / trombones 7 s / tuba 5 s, tempo-map seconds), rhythm floors, gates.
- `src/orchestrator/brass/plan.ts` (new) — the D8 planner on its own salted stream (`hashString('brass')`); gates low ≥ 0.30 / mid ≥ 0.55 / high ≥ 0.75 / peak ≥ 0.90 of the clamp max; the brass lead (peak only, 0.35 draw, 2–4 bars capped by the trumpet cap, planned BEFORE the moments which then avoid its bars); the trumpets' role draw (fanfare 0.4 / stab 0.35 / swell 0.25 per section type); the entrance rule (a part's first bar after a silent bar needs a strictly lower-energy bar before; bar 1 never enters; moment kinds carry their own contracts).
- `src/orchestrator/brass/render.ts` (new) — role realization (pad, guide tones with the parallel-5th/8ve ranking penalty, low doubling of the cello line, fanfare on the lead's rhythm, stabs in the lead's windowing gaps, chord-tone swells, trailer ostinato on the pinned 16th cell for horns/trumpets only, tutti hit, unison join, horn soli, brass lead + horn octave double), the part-level phrase-cap clock with ≥1-beat breaths, two-pass velocity shaping (the bar's arc norm under the governor bound of every beat window touched), the final brass-only safety governor, `sanitizeNotes` on its own output.
- Wiring: `conductor/index.ts` (the brass plan beside the moments), `conductor/layers.ts` (strings read pad + no carrier on lead bars — the pure-texture read untouched), `conductor/moments.ts` (horns join the soli carrier pool where rostered), `render.ts` (brass sweet spots for a horn soli line; the suppressed pad opens where its DP pitch would double a held leading tone), `compose.ts` (brass excluded from the generator, rendered after it and the tutti hits, CC lanes via the same `buildCcLanes`, assembly), `energy/rules.ts` (the `brassParallels` soft finding), `shared/schema/types.ts` (`'sustain'`).
- Tests: `tests/brass.test.ts` (new, 18).

## Take 1, three-chorus — lead ownership, brass counts, moments

| template | textures (take 1) | who leads per section | brass notes (h/tr/tb/tuba) | moments |
|---|---|---|---|---|
| symphony | verse v1LeadsPizzBass, chorus vlaHandoff, bridge/outro v1Leads | V1 leads verses/bridge/outro; the violas take the tune in every Chorus (handoff); no brass lead this take | 41 / 14 / 33 / 1 | unison 5–8, divisi 18–21 (V2), soli 25–28 (Vc), tutti 29 |
| cinematic | verse interlockingOstinato, chorus tremoloBed, bridge singleOstinato, outro pizzPulse | V1 leads throughout; the strings drop to pad and the trumpets take the tune on the brass lead in the last Chorus | 51 / 9 / 29 / 7 | unison 16–19, soli 25–28 (Vc), tutti 29, **brass lead 31–32 (trumpets, horns doubling below)** |
| hybridstudio | vlaCounter verses/bridge, v2Counter choruses | V1 leads throughout; brass lead in the last Chorus | 45 / 7 / 34 / 0 | unison 16–19, soli 25–28 (Vc), tutti 29, **brass lead 32–33 (trumpets, horns doubling below)** |

Survey-wide (takes 1–10 × three-chorus): symphony horns 505 / trumpets 282 / trombones 266 / tuba 16 with 6 brass leads; cinematic 829/290/280/36 with 4; hybridstudio 453/172/327/0 (no tuba) with 4; dorian adds 3/2/6 leads. Kinds exercised: pad, guide, lowDouble, fanfare, stab, swell, ostinato (trailer), lead, leadDouble, tutti, unison, soli. Chamber/sonata/vocalbacking: zero brass notes, zero leads.

## Chorus energy against the clamp (before → after)

| template × fixture | chorus mean (clamp max) | chorus peak | below-floor windows |
|---|---|---|---|
| symphony three | 0.506 → 0.456 (0.85) | 0.657 → 0.700 | 0/960 → 78/960 |
| symphony dorian | 0.509 → 0.503 (0.85) | 0.601 → 0.717 | 0/320 → 11/320 |
| cinematic three | 0.550 → 0.501 (0.95) | 0.747 → 0.804 | 30/960 → 112/960 |
| cinematic dorian | 0.575 → 0.568 (0.95) | 0.715 → 0.770 | 4/320 → 18/320 |
| hybridstudio three | 0.492 → 0.483 (0.90) | 0.701 → 0.726 | 47/960 → 204/960 |
| hybridstudio dorian | 0.527 → 0.557 (0.90) | 0.620 → 0.707 | 3/320 → 27/320 |

**"Below floor" is not gone — it rose.** The generator's brass played through nearly every section; the module rests brass wherever the gate says so (thin bars stay thin, entrances wait for a lower-energy bar), so windows the generator used to fill are now deliberately thin. Below-floor is soft and report-only by spec (silence on purpose); zero `aboveMax` anywhere.

## Findings

- **Hard findings: 0** (six templates × takes 1–10 × both fixtures, moments on; sanitize no-op, validateProject pass, locks and out-of-band tracks untouched, exports round-trip with and without the UVI profile — brass has no Falcon profile and passes through untouched via `chunksForTrack`).
- Most common soft finding: `overlapAvoid` 3939 (Woodwinds vs Brass entrances near section starts), then below-floor `energy` 3727 (see above), `brassParallels` 88 (the new soft rule — the planner's penalty keeps it low), `octaveDoubling` climaxOnly 13 (chamber, unchanged).
- The mixed-window governor and the humanize cap guard were measured inert at the baseline (0 fired windows, max window energy 0.786 of the clamp across the brass templates × takes 1–10 × both fixtures) — the brass caps keep them inert, so the strings' byte-identity through the whole chain holds architecturally, not just empirically.

## Wasn't possible / deviations

- The moment gestures (tutti/unison/soli) neither consume nor obey the phrase-cap clock, and the brass lead starts a fresh phrase: the clock must stay byte-identical with and without the moments (the draw-identity pin). The rare gestures therefore don't count toward lip time.
- The low-brass doubling rides the cello line's own phrasing (no independent cap clock); sub-eighth cello motion merges into held segments. Trombones/tuba caps govern their guide/sustained writing.
- Divisi and imitation were NOT extended to brass (not cheap: the export-profile machinery and the counterline concepts are strings-shaped; no brass profile exists) — per the prompt, said rather than built.
- The brass CC lanes reuse the strings' generator wholesale (CC1/CC11 phrase arches + soft-entry S-curves, CC68/CC74, one CC7 point at tick 0) — that includes the static CC7 balance point, same as the strings since Phase 5c.
- The brass lead's placement is moments-independent, which moves the moments plans of the brass templates (a divisi can land elsewhere); chamber/sonata/vocalbacking plans are untouched (pinned byte-identical).
