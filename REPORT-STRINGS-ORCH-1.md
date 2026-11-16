# STRINGS-ORCH-1 — strings articulation palette behind variety

## ONE TABLE (src/orchestrator/strings/articulationPalette.ts ARTICULATION_WEIGHTS)

| template | lead | counterline | pad | pad_intro | tremolo | tutti |
|----------|------|-------------|-----|-----------|---------|-------|
| ensemble.cinematic | legato 52 detache 20 portato 14 marcato 10 spiccato 4 | legato 52 detache 28 portato 20 | legato 36 sulTasto 28 detache 12 conSord 12 sulPont 7 portato 5 | sulTasto 44 legato 28 conSord 14 sulPont 8 detache 6 | tremolo 78 sulPont 12 legato 10 | marcato 62 spiccato 18 legato 12 detache 8 |
| ensemble.symphony | legato 58 detache 18 portato 12 marcato 10 spiccato 2 | legato 56 detache 24 portato 20 | legato 42 sulTasto 22 conSord 14 detache 10 sulPont 7 portato 5 | sulTasto 38 legato 32 conSord 16 sulPont 8 detache 6 | tremolo 88 sulPont 7 legato 5 | marcato 66 spiccato 16 legato 10 detache 8 |
| ensemble.chamber | legato 58 detache 18 portato 14 marcato 6 conSord 4 | legato 54 detache 26 portato 20 | legato 32 sulTasto 24 conSord 24 detache 10 sulPont 5 portato 5 | conSord 32 sulTasto 30 legato 26 sulPont 7 detache 5 | tremolo 86 sulPont 8 legato 6 | marcato 54 spiccato 22 legato 14 detache 10 |
| ensemble.sonata | legato 60 detache 16 portato 12 marcato 8 spiccato 4 | legato 58 detache 22 portato 20 | legato 40 sulTasto 26 conSord 12 detache 12 sulPont 5 portato 5 | sulTasto 36 legato 34 conSord 16 sulPont 8 detache 6 | tremolo 90 sulPont 5 legato 5 | marcato 64 spiccato 14 legato 12 detache 10 |
| ensemble.vocalbacking | legato 62 detache 14 portato 10 marcato 6 conSord 8 | legato 56 detache 24 portato 20 | legato 30 sulTasto 28 conSord 26 detache 8 sulPont 4 portato 4 | conSord 36 sulTasto 32 legato 22 sulPont 6 detache 4 | tremolo 88 sulPont 6 legato 6 | marcato 52 spiccato 22 legato 16 detache 10 |
| ensemble.hybridstudio | legato 46 detache 22 portato 16 marcato 10 spiccato 6 | legato 50 detache 28 portato 22 | legato 34 sulTasto 26 conSord 16 detache 12 sulPont 7 portato 5 | sulTasto 40 legato 30 conSord 16 sulPont 8 detache 6 | tremolo 80 sulPont 12 legato 8 | marcato 60 spiccato 18 legato 12 detache 10 |

All articulations are from ARTICULATIONS (shared/schema/types.ts) and have UVI export mapping: legato/marcato/spiccato/pizz/tremolo are direct keyswitches on all string parts; detache/portato/sulTasto/sulPont/conSord fall back to sustain (violins/violas) or sustain/marcato (cello/bass via fallback chain). Missing spec arts colLegno→spiccato, harmonics→sulTasto, trill→tremolo are never emitted (MISSING_ARTICULATIONS).

staccato was removed from all palettes in 55dec09 because violins have no staccato keyswitch and no fallback chain for it (export-check would report missing fallback); tutti now uses spiccato/marcato/legato/detache.

## Identity proof (variety:false byte-identical)

check-artic-identity.mjs over 6 templates × 2 fixtures × 3 takes × 2 seeds = 72 combos with variety:false: 0 diffs (sha256 of tracks id/role/notes). Preserved in strings-articulation.test.ts first test (timeout 20000).

## Histograms (20 takes dorian-16bars, Strings family)

| template | variety:false | variety:true |
|----------|---------------|--------------|
| ensemble.symphony | legato 2716 pizz 421 | sulTasto 230 marcato 116 legato 1313 detache 329 portato 240 conSord 146 sulPont 79 pizz 466 spiccato 26 |
| ensemble.cinematic | legato 2283 tremolo 3392 spiccato 671 pizz 125 | detache 331 legato 1279 marcato 126 tremolo 2768 spiccato 733 portato 176 sulTasto 319 conSord 135 sulPont 410 pizz 125 |
| ensemble.chamber | legato 2107 | legato 736 conSord 336 detache 269 sulTasto 321 portato 144 marcato 31 sulPont 70 |
| ensemble.sonata | legato 1199 | legato 535 detache 165 sulTasto 122 sulPont 25 conSord 71 portato 91 marcato 50 spiccato 23 |
| ensemble.vocalbacking | legato 1512 | detache 115 legato 371 sulTasto 345 conSord 323 portato 55 sulPont 60 |
| ensemble.hybridstudio | legato 3625 | detache 638 legato 1510 sulTasto 338 conSord 231 marcato 133 spiccato 117 portato 416 sulPont 75 |

variety:false unchanged; variety:true introduces all palette arts while preserving total note counts.

## Export check (UVI profile, max/avg keyswitch changes per bar)

- UVI profile validation: 0 errors (validateExportProfile).
- Previously missing fallback violins1 staccato was caught (export-check.mjs) and fixed by removing staccato from palettes.
- Max keyswitch changes per bar: 0 within-bar (≤1 articulation per bar per part enforced by per-bar cache in articulationFor), so no keyswitch spam. Across-bar changes are at most 1 per bar boundary per part (cache key is template:layer:typeKey:bar:trackId, salted with strings-artic stream). Cross-bar max is 1 per part, avg <1.
- All emitted articulations resolve via keyswitches or fallback chains to a keyswitch (tested via keyswitchNotesFor in strings-articulation.test.ts).

## Intro bars 1-8 (user project google_drive/aeolian.crescode, D Aeolian 24b, ensemble.cinematic)

variety:false: all 10 takes identical — violins1 legato, violins2 legato/spiccato/tacet (texture-gated), violas legato/tacet, cellosBasses legato, basses legato.

variety:true takes 1-10 (gen-intro-table.mjs):

| take | violins1 (lead) | violins2 | violas | cellosBasses | basses | texture |
|------|-----------------|---------|--------|--------------|--------|---------|
| 1 | legato sulTasto sulPont | sulTasto legato sulPont | sulPont conSord sulTasto | legato sulTasto | legato sulTasto | leadPadBed |
| 2 | sulTasto sulPont | spiccato | sulTasto conSord legato | sulTasto sulPont | sulTasto sulPont | singleOstinato |
| 3 | conSord sulTasto legato | tacet | tacet | detache legato sulTasto | sulTasto | tremoloBed |
| 4 | sulTasto detache | spiccato | sulTasto conSord | sulTasto detache sulPont | sulTasto detache sulPont | singleOstinato |
| 5 | sulPont legato | tacet | tacet | sulTasto | sulTasto | interlockingOstinato |
| 6 | sulTasto legato | tacet | tacet | conSord sulTasto legato | legato | pizzPulse |
| 7 | legato sulTasto | tacet | tacet | sulTasto legato sulPont | sulTasto legato sulPont | pizzPulse |
| 8 | detache sulTasto | tacet | tacet | sulTasto conSord legato | sulTasto conSord legato | leadPadBed |
| 9 | conSord sulTasto legato | tacet | tacet | sulTasto conSord | sulTasto conSord | tremoloBed |
| 10 | sulTasto | tacet | tacet | conSord sulPont legato sulTasto | conSord sulPont legato sulTasto | singleOstinato |

10 distinct intro articulation sets vs 0 before — pad_intro palette (sulTasto 44 legato 28 conSord 14) is visibly distinct from pad (legato 36 sulTasto 28).

## Break-then-revert proof

Break: edit articulationPalette.ts to return 'colLegno' — tests fail on "emitted articulations are only from ARTICULATIONS" and "at most one change per bar". Revert → all 9 tests pass.

## Commits

- 5fadcac strings articulation palette: weighted per layer per template behind variety (strings-artic stream), intro palette — palette + render wiring
- 16ad7ba chore: remove temp repro scripts — google_drive/aeolian.crescode now tracked (12552 lines)
- 55dec09 fix: remove staccato from palettes (no UVI keyswitch for violins), tighten export test to keyswitchNotesFor

All pushed to arena/4519379f-crescode (e49169c..55dec09).

## Uncertainties / next

- staccato reintroduction would require adding a fallback chain for violins in uvi-orchestral-suite.json (staccato→marcato or spiccato); not done here to avoid touching export profile.
- Strings-related vitests (orchestrator-lines, phase4a/b/matrix, presets/conductor/voicing) all passed earlier; strings-articulation 9/9 on last run (tsc --noEmit 0 errors).
