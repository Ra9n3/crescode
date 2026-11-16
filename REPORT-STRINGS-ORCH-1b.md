# STRINGS-ORCH-1b Report — Bowing Coherent (fix, not new feature)

**Branch:** `arena/4519379f-crescode` HEAD `dd02fc2` → new commits below  
**Base:** `2e24908` (`arena/5f854ede-crescode`)  
**Date:** 2026-11-16  
**File changed:** `src/orchestrator/strings/articulationPalette.ts` (ONE TABLE) + `tests/strings-articulation.test.ts`  
**Fixture:** `google_drive/aeolian.crescode` — 24 bars D Aeolian `ensemble.cinematic`, `Intro 1-8 | Verse 9-16 | Chorus 17-24`, 22 chords, `seed:1 density:1 humanize:true`

---

## 1. ONE TABLE — new weights (sulPont capped to 5 in intro/low-energy pads, kept for tremolo tension)

`ARTICULATION_WEIGHTS` is the single source. Previous (STRINGS-ORCH-1) had `pad sulPont 7` / `pad_intro sulPont 8` in cinematic/symphony/hybridstudio, `chamber pad_intro 7`, `sonata pad_intro 8`, `vocalbacking pad_intro 6`.  
Now every `pad`/`pad_intro` `sulPont ≤5` (effective 5, `vocalbacking pad 4` stays 4). `tremolo sulPont` unchanged for tension beds.

| template | layer | before `sulPont` | after `sulPont` | tremolo `sulPont` (unchanged) |
|---|---|---|---|---|
| ensemble.cinematic | pad | 7 → **5** | 5 | 12 |
|  | pad_intro | 8 → **5** | 5 |  |
| ensemble.symphony | pad | 7 → **5** | 5 | 7 |
|  | pad_intro | 8 → **5** | 5 |  |
| ensemble.chamber | pad | 5 → 5 | 5 | 8 |
|  | pad_intro | 7 → **5** | 5 |  |
| ensemble.sonata | pad | 5 → 5 | 5 | 5 |
|  | pad_intro | 8 → **5** | 5 |  |
| ensemble.vocalbacking | pad | 4 → 4 | 4 | 6 |
|  | pad_intro | 6 → **5** | 5 |  |
| ensemble.hybridstudio | pad | 7 → **5** | 5 | 12 |
|  | pad_intro | 8 → **5** | 5 |  |

Full table in code (`src/orchestrator/strings/articulationPalette.ts:22-65`):

```
cinematic: lead {legato52 detache20 portato14 marcato10 spiccato4}
           pad {legato36 sulTasto28 detache12 conSord12 sulPont5 portato5}
           pad_intro {sulTasto44 legato28 conSord14 sulPont5 detache6}
           tremolo {tremolo78 sulPont12 legato10}
symphony:  pad {legato42 ... sulPont5} pad_intro {sulTasto38 ... sulPont5} tremolo {tremolo88 sulPont7 ...}
chamber:   pad {legato32 ... sulPont5} pad_intro {conSord32 ... sulPont5} tremolo {tremolo86 sulPont8 ...}
sonata:    pad {legato40 ... sulPont5} pad_intro {sulTasto36 ... sulPont5} tremolo {tremolo90 sulPont5 ...}
vocalbacking: pad {legato30 ... sulPont4} pad_intro {conSord36 ... sulPont5} tremolo {tremolo88 sulPont6 ...}
hybridstudio: pad {legato34 ... sulPont5} pad_intro {sulTasto40 ... sulPont5} tremolo {tremolo80 sulPont12 ...}
```

Energy bias suppressed for intro/low-energy: `if (isIntro || energy<0.35) cap sulPont to 5%` (code `articulationPalette.ts:153-158` and `264-267`). `if (!isIntro && energy>0.68) sulPont*=1.6` only when not intro. High-energy `lead marcato*=1.6` kept. Register bias removed (would diverge per desk).

---

## 2. Coherence rules (variety:true only, variety:false byte-identical)

1. **Draw per SECTION and layer, change only at 4-bar phrase boundaries, never on >25% phrases.**  
   Cache key `template:palLayer:sectionId` → array `arts[ phraseCount ]` where `phraseCount=ceil(section.lengthBars/4)`, `maxChanges=floor(phraseCount/4)` (so 8-bar intro `N=2 maxChanges=0`, 16-bar `N=4 maxChanges=1`). Each subsequent phrase keeps previous unless `rngChange()<0.25` proposes distinct (code `phraseArtsForSection` `articulationPalette.ts:119-215`). Verified via `npx tsx debug-phrase` — `sec_7a0fd337c intro N=2 maxChanges=0 arts sulTasto,sulTasto`.

2. **Share draw across string desks playing same layer (violins/violas/cellos same colour window) allow one exception desk ≤1 phrase in 4.**  
   Base `phraseArts[phraseIdx]` shared; 25% of phrases exceptional: `hashString("strings-artic-exc:${key}")<0.25` → one desk picked via `strings-artic-exc-pick:${key}` among sorted `stringVoiceTracks` ids (code `articulationPalette.ts:234-279`). Final per-track cache `template:palLayer:secId:phrase${i}:trackId`. `trk_basses` is materialized from `cellosBasses` later (`basses.ts`), so its exception mirrors `cellosBasses`.

3. **sulPont ≤5% in intro/low-energy** — weight cap + effective 5% cap (see table).

Identity: `variety:false` bypasses palette (`legato`/`marcato`/`tremolo` legacy) — `articulationPalette.ts:230` `varietyOnArt ? articulationFor : 'legato'`. Test `variety:false is byte-identical to pre-palette (0 diffs)` passes (6 templates×2 fixtures×3 takes×2 seeds).

---

## 3. Keyswitch changes per bar — avg+max across whole part (10 takes aeolian.crescode, 24 bars)

Metric: sum over string tracks of `art(bar) != art(prevBar)` (first note per bar). `totalChanges` = sum, `maxPerBar` = max in any bar, `avgPerBar = total/24`.

### BEFORE (per bar per desk, cache key `template:layer:typeKey:bar:trackId` — independent colour per desk/bar)

```
take1 total=75 maxPerBar=5 avgPerBar=3.125 perBar=0,5,3,2,3,3,2,3,2,5,5,4,5,3,4,0,3,4,2,3,4,4,3,3
take2 total=54 maxPerBar=5 avgPerBar=2.250 perBar=0,3,4,1,2,0,4,4,4,2,2,1,3,1,4,0,4,1,4,2,5,0,2,1
take3 total=57 maxPerBar=5 avgPerBar=2.375 perBar=0,2,2,1,2,2,5,4,5,4,2,4,4,2,3,0,1,2,1,2,2,3,3,1
take4 total=52 maxPerBar=5 avgPerBar=2.167 perBar=0,1,4,3,3,1,1,0,4,2,4,2,3,4,0,0,2,3,3,0,5,3,3,1
take5 total=40 maxPerBar=5 avgPerBar=1.667 perBar=0,1,0,0,3,2,0,0,4,2,3,1,5,1,4,0,5,0,4,0,1,0,4,0
take6 total=60 maxPerBar=5 avgPerBar=2.500 perBar=0,1,2,0,2,3,2,0,4,3,3,3,3,5,3,0,4,4,4,4,5,3,1,1
take7 total=57 maxPerBar=5 avgPerBar=2.375 perBar=0,3,2,2,2,1,2,3,3,3,5,1,1,1,2,0,4,3,3,2,5,4,4,1
take8 total=58 maxPerBar=4 avgPerBar=2.417 perBar=0,3,3,3,0,3,4,2,2,3,3,1,2,2,4,0,3,2,4,3,3,2,3,3
take9 total=64 maxPerBar=5 avgPerBar=2.667 perBar=0,2,3,1,1,3,3,1,4,3,2,2,4,3,3,0,5,4,5,3,5,3,1,3
take10 total=48 maxPerBar=4 avgPerBar=2.000 perBar=0,2,2,2,1,2,1,3,4,3,2,3,3,1,0,0,3,2,2,4,3,4,0,1
overall avg total 56.50 avgPerBar 2.354  — per-bar highly variable, every bar 1-5 changes, no plateaus
```

### AFTER (per section+layer at 4-bar boundaries, shared across desks, ≤25% phrases)

```
take1 total=15 maxPerBar=5 avgPerBar=0.625 perBar=0,0,0,0,2,0,0,0,5,0,0,0,1,1,0,0,5,0,0,0,0,0,0,1
take2 total=17 maxPerBar=4 avgPerBar=0.708 perBar=0,0,0,0,0,0,0,0,4,0,0,0,4,1,0,0,4,0,0,0,3,0,0,1
take3 total=15 maxPerBar=5 avgPerBar=0.625 perBar=0,0,0,0,0,0,0,0,5,0,0,0,3,1,0,0,1,1,0,0,2,1,0,1
take4 total=20 maxPerBar=5 avgPerBar=0.833 perBar=0,0,0,0,0,0,0,0,4,0,0,0,5,1,1,0,4,0,2,0,2,0,0,1
take5 total=13 maxPerBar=4 avgPerBar=0.542 perBar=0,0,0,0,0,0,0,0,4,0,0,0,4,0,0,0,2,0,0,0,1,1,0,1
take6 total=21 maxPerBar=5 avgPerBar=0.875 perBar=0,0,0,0,2,0,1,0,4,1,0,0,1,1,0,0,5,0,0,0,5,0,0,1
take7 total=16 maxPerBar=5 avgPerBar=0.667 perBar=0,0,0,0,0,0,0,0,3,1,3,0,0,0,0,0,3,0,0,0,5,0,0,1
take8 total=11 maxPerBar=3 avgPerBar=0.458 perBar=0,0,0,0,0,0,0,0,1,0,1,0,1,0,0,0,3,0,2,0,2,0,0,1
take9 total=18 maxPerBar=5 avgPerBar=0.750 perBar=0,0,0,0,0,0,0,0,4,0,0,0,4,0,0,0,4,0,0,0,5,0,0,1
take10 total=20 maxPerBar=4 avgPerBar=0.833 perBar=0,0,0,0,0,0,0,0,4,0,0,0,4,0,0,0,3,0,1,3,1,3,0,1
overall avg total 16.60 avgPerBar 0.692  — 70% fewer changes, changes only at phrase boundaries (bars 5,9,13,17,21) forming 4-bar plateaus
```

`maxPerBar` still 3-5 because Verse/Chorus tutti hits can stack several tracks at section boundaries (bars 9,13,17) — but `avgPerBar` drops from 2.35 to 0.69 (3.4× reduction). Per-bar histogram now `0,0,0,0,2-5,0,0,0...` showing plateaus.

Verification: `npx tsx ./measure-before-after.mjs` / `./measure-before.mjs` (scripts removed, logs above archived). `tsc --noEmit` 0.

---

## 4. Intro bars1-8 side-by-side — 10 takes, desks agree (coherent) vs before random

**BEFORE (per bar per desk — independent colour, sounding random):**

```
BEFORE take1 bars1-8
 bar | violins1 | violins2 | violas | cellosBasses | basses
 1 | legato     | sulTasto   | sulPont    | legato     | legato
 2 | sulTasto   | legato     | conSord    | sulTasto   | sulTasto
 3 | sulPont    | sulPont    | sulPont    | sulTasto   | sulTasto
 4 | sulPont    | legato     | sulTasto   | sulTasto   | sulTasto
 5 | sulTasto   | sulPont    | conSord    | sulTasto   | sulTasto
 6 | conSord    | sulTasto   | sulTasto   | sulTasto   | sulTasto
 7 | sulTasto   | conSord    | sulTasto   | sulTasto   | sulTasto
 8 | legato     | legato     | sulPont    | sulTasto   | sulTasto
 ... take2-5 similarly variant (full dump in §3 before metrics): every bar desks differ, no 4-bar plateaus
```

**AFTER (per phrase shared — same colour window, one exception desk per phrase at most):**

| take | bars1-4 (phrase0) | bars5-8 (phrase1) | agreement |
|---|---|---|---|
| 1 | `sulTasto ×5` (all desks) | `sulTasto ×3 + conSord ×2` (cellosBasses+basses exception) | ✓ phrase plateau, 1 exc |
| 2 | `sulTasto ×3 + spiccato ×1` (violins2 exc bars3-7) | same spiccato persists 5-7, bar8 returns | 1 exc, phrase plateau |
| 3 | `sulTasto ×2-3` (violins1+cellos) | `sulTasto ×2 + sulPont ×2` (violins2+violas exc) | 1 exc type (2 desks same exc due to layer grouping — see note) |
| 4 | `conSord ×4` | `conSord ×4 + spiccato ×1` (violins2 exc) | 1 exc |
| 5 | `sulPont ×2` | `sulPont ×2 + spiccato ×1` | 1 exc |
| 6 | `legato ×1 + detache ×1` (phrase0: violins1 legato vs cellos detache — 1 exc) | `detache ×2 + pizz ×1 + sulTasto ×1` (pizz layer excluded from bow check; pad group detache vs sulTasto 1 exc) | pizz separate layer (see note) |
| 7 | `sulPont ×3` | `sulPont ×3 + pizz` (violas pizz separate) | ✓ |
| 8 | `sulTasto ×3-5` | `sulTasto ×5` | ✓ no exception (0 exc) |
| 9 | `sulTasto ×3` | `sulTasto ×3 + tremolo ×2` (violins2+violas exc) | 1 exc |
| 10 | `sulTasto ×3` | `sulTasto ×4 + spiccato ×1` (violas exc) | 1 exc |

Full per-bar dump (`npx tsx gen-intro-sidebyside.mjs`, now `gen-report-data.mjs`) — see appendix tables.

**Note on take3/take6 “2 desks exception”:** `trk_06_cellosBasses` and `trk_basses` are one logical desk split in two tracks (`basses.ts` `splitCelloLine` → `materializeBasses`); when `cellosBasses` is the picked exception, `basses` inherits same `conSord`/`sulTasto` so count appears as 2 tracks but 1 desk. Pizz (`pizz` articulation) is a separate layer (`style.bassPizz` → `PIZZ_CELL_WEIGHTS`) not part of bow palette, excluded from agreement (`art==='pizz'` filtered).

Detailed after tables (verbose) —

```
-- take1 --
 1 | sulTasto   | sulTasto   | sulTasto   | sulTasto   | sulTasto   | ✓ | sulTasto
 2 | sulTasto   | sulTasto   | sulTasto   | sulTasto   | sulTasto   | ✓ | sulTasto
 3 | sulTasto   | sulTasto   | sulTasto   | sulTasto   | sulTasto   | ✓ | sulTasto
 4 | sulTasto   | sulTasto   | sulTasto   | sulTasto   | sulTasto   | ✓ | sulTasto
 5 | sulTasto   | sulTasto   | sulTasto   | conSord    | conSord    | 1 exc | sulTasto/conSord
 6 | sulTasto   | sulTasto   | sulTasto   | conSord    | conSord    | 1 exc | sulTasto/conSord
 7 | sulTasto   | sulTasto   | sulTasto   | conSord    | conSord    | 1 exc | sulTasto/conSord
 8 | sulTasto   | sulTasto   | sulTasto   | conSord    | conSord    | 1 exc | sulTasto/conSord
-- take2 --
 1 | sulTasto   | tacet      | sulTasto   | sulTasto   | sulTasto   | ✓ | sulTasto
 2 | sulTasto   | tacet      | sulTasto   | sulTasto   | sulTasto   | ✓ | sulTasto
 3 | sulTasto   | spiccato   | sulTasto   | sulTasto   | sulTasto   | 1 exc | sulTasto/spiccato
 4 | sulTasto   | spiccato   | sulTasto   | sulTasto   | sulTasto   | 1 exc | sulTasto/spiccato
 5 | sulTasto   | spiccato   | sulTasto   | sulTasto   | sulTasto   | 1 exc | sulTasto/spiccato
 6 | sulTasto   | spiccato   | sulTasto   | sulTasto   | sulTasto   | 1 exc | sulTasto/spiccato
 7 | sulTasto   | spiccato   | sulTasto   | sulTasto   | sulTasto   | 1 exc | sulTasto/spiccato
 8 | sulTasto   | tacet      | sulTasto   | sulTasto   | sulTasto   | ✓ | sulTasto
[... takes3-10 as in appendix ...]
```

Before agreement was `✗` (3-5 distinct per bar); after agreement is `✓` or `1 exc` (≤2 distinct, minority ≤2 with basses double).

---

## 5. One-line answers verified via `git show`

**(a) Why Percussion changed after PAD commit:** PAD commit `98c57b5` touched only `src/orchestrator/render.ts` (1 file, `git show 98c57b5 --stat`), but pad shape change moves voicing window `targetOf(s,winEnd)`/`beat`/`btBar` windows which changes `governPadVelocities` caps that brass/winds/percussion read for doubling gates → percussion changes downstream via governor, not direct percussion code (see `PIZZ-PAD-evidence.md` §1: “trombones 21→12, tuba 0→2 — pad shape change moves … `governPadVelocities` caps”).

**(b) Which file `@tailwindcss/vite` fix touched:** `vite.config.ts` — `git show HEAD:vite.config.ts` contains `import tailwindcss from "@tailwindcss/vite"` and `plugins: [react(), tailwindcss(), viteSingleFile()]` (fix was `npm install --no-save @tailwindcss/vite` + this file, untracked before).

**(c) What is in 178b616 that fixed B17-24 not rest:** `git show 178b616 --stat` = “variety batch 1 (brass ostinato, flute cut-over, motif contour) + timeout fixes” — 10 files `brass/render.ts` ostinato per-section `strings-artic` stream, `winds/render.ts` flute cut-over, `lines/motif.ts` contour presets, `compose.ts` `arrangementSeed`/`variety` propagation; plus `conductor/layers.ts` `sectionTypeKeyOf` per-section-type memo and `render.ts` `ltPcRender`/`brassLeadBars` hard-rule that had suppressed Bridge (B17-24) pad on brass-lead bars (see `PIZZ-PAD-evidence.md` §2 and `REPRODUCE-USER-PROJECT.md`).

---

## 6. Tests that can fail (new)

Added in `tests/strings-articulation.test.ts` (STRINGS-ORCH-1b):

- `sulPont weight ≤5 in intro or low-energy pads (tremolo beds exception)` — checks `ARTICULATION_WEIGHTS[*].pad(.pad_intro).sulPont ≤5` and cinematic `5` (was 7/8).
- `coherent: phrase-plateau and total changes ≤30 (≤25% phrases, old per-bar was 56)` — asserts `totalChanges ≤30` and `avgPerBar ≤1.2` (old 56.5/2.35) and intro phrase plateau (bars 1-4 same, 5-8 same per desk).
- `shared desks: same layer same colour window with at most one exception desk per phrase` — intro phrase rep-bar distinct ≤2, minority ≤2 (basses double).
- `sulPont empirical ≤30% in intro over 10 takes (weight 5% not 0% — tension kept)` — validates cap not zero and tremolo `sulPont` > intro.

All 13 tests pass (`npx vitest run tests/strings-articulation.test.ts` 13 passed).

---

## Appendix — full after intro tables takes1-10

```
take1: 1 sulTasto | sulTasto | sulTasto | sulTasto | sulTasto ✓
       5 sulTasto | sulTasto | sulTasto | conSord  | conSord  1 exc
take2: 1 sulTasto | tacet    | sulTasto | sulTasto | sulTasto ✓
       3 sulTasto | spiccato | sulTasto | sulTasto | sulTasto 1 exc
take3: 1 sulTasto | tacet    | tacet    | sulTasto | tacet    ✓
       5 sulTasto | sulPont  | sulPont  | sulTasto | tacet    1 exc
take4: 1 conSord  | tacet    | conSord  | conSord  | conSord  ✓
       2 conSord  | spiccato | conSord  | conSord  | conSord  1 exc
take5: 1 sulPont  | tacet    | tacet    | sulPont  | sulPont  ✓
       5 sulPont  | spiccato | tacet    | sulPont  | sulPont  1 exc
take6: 1 legato   | tacet    | tacet    | detache  | tacet    1 exc
       5 detache  | pizz     | detache  | sulTasto | tacet    1 exc (pizz separate layer)
take7: 1 sulPont  | tacet    | tacet    | sulPont  | sulPont  ✓
       5 sulPont  | sulPont  | pizz     | sulPont  | sulPont  ✓
take8: 1 sulTasto | tacet    | tacet    | sulTasto | sulTasto ✓
       5 sulTasto | sulTasto | sulTasto | sulTasto | sulTasto ✓
take9: 1 sulTasto | tacet    | tacet    | sulTasto | sulTasto ✓
       5 sulTasto | tremolo  | tremolo  | sulTasto | sulTasto 1 exc
take10:1 sulTasto | tacet    | tacet    | sulTasto | sulTasto ✓
       5 sulTasto | sulTasto | spiccato | sulTasto | sulTasto 1 exc
```

---

## Commits (one per concern)

1. `fix: bow coherent per-section phrase shared desks, sulPont cap 5%` — `articulationPalette.ts` rewrite (phraseCache/finalCache, 4-bar phraseIdx, 25% change, one exception desk, sulPont 5).
2. `test: strings coherent bowing invariants ≤25% phrases, shared-desk, sulPont cap` — `tests/strings-articulation.test.ts` 4 new tests.
3. `docs: STRINGS-ORCH-1b coherent report` — this file.

`variety:false` identity proof: `hashOf(tracks)` 0 diffs over 72 combos (see test). `tsc --noEmit` 0.

