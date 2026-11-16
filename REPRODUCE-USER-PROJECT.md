# REPRODUCE THE USER'S REAL CASE — read-only, no source edits

## 1. Default/demo project named "Dorian 16 Bars"

**Found at `src/store/store.ts:2`**
```ts
import fixture from '../../fixtures/dorian-16bars.json';
const initialProject = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)) as Partial<Project>);
```
The default project IS `fixtures/dorian-16bars.json`:
- `name: "Dorian 16 Bars"`, `bpm:100`, `key:2 (D)`, `mode:"Dorian"`, `ensemble: none (filled by store to freshEnsemble())`
- `sections: [{name:"Verse",startBar:1,lengthBars:8},{name:"Chorus",startBar:9,lengthBars:8}]` → **16 bars total**
- `chords: 18` all `startTick` multiples of 1920 from `0` to `57600`, e.g. `Dm7@0, G7@3840, Em7@11520, Fmaj7@13440 … A7sus4@55680, Dm7@57600`
- `tracks: []`, `orchestration: undefined` (store sets `composeOptions {seed:1,density:1,humanize:true}` and `take` increments inside `composeAll`)

**Comparison with attached `google_drive/aeolian.crescode` (`name` also "Dorian 16 Bars"):**

| field | fixture `dorian-16bars.json` | attached `aeolian.crescode` |
|---|---|---|
| `name` | Dorian 16 Bars | Dorian 16 Bars |
| `bpm` | 100 | 100 |
| `key/mode` | D Dorian | **D Aeolian** |
| `sections` | Verse 1-8 (8), Chorus 9-16 (8) → 16 bars | **intro 1-8 (8), Verse 9-16 (8), Chorus 17-24 (8) → 24 bars**, ids `sec_7a0fd337c`, `sec_verse`, `sec_chorus` |
| `chords` | 18 chords `0..57600` | **22 chords**: `Dm6@0(7680), Gm@7680(7680), C@15360(7680), Faug7@23040(7680)` for intro 1-8 + `Dm7@30720, Gm7@34560, Dm7@38400, Em7b5@42240(1920), Fmaj7@44160(1920), Dm9@46080, C/E@49920, Am7@53760, Gm@57600, Dm@61440, Fmaj7@65280, C@69120, Gm/Bb@72960, Dm7@76800, Bbmaj7@80640, C@84480(1920), A7sus4@86400(1920), Dm7@88320` |
| `ensemble` | (none) | `ensemble.cinematic`, `overrides:{}, pins:{}` |
| `orchestration` | (none) | `take:7` persisted |
| `tracks` | `[]` | 22 tracks with notes already rendered for take 7 (e.g. violins1 107 notes, horns 133, flutes 62) |

> The name collides but the projects are different files — the fixture is the 16-bar D Dorian demo, the user file is a 24-bar D Aeolian song built from it (same `name` string, extra intro + re-harmonized).

## 2. Load the attached file as is (do not modify)

File: `google_drive/aeolian.crescode` (284606 bytes, `application/octet-stream` JSON, `schemaVersion:1`)

```json
{
  "name": "Dorian 16 Bars",
  "bpm": 100,
  "timeSignature": {"numerator":4,"denominator":4},
  "key": 2,
  "mode": "Aeolian",
  "sections": [
    {"name":"intro","startBar":1,"lengthBars":8,"id":"sec_7a0fd337c"},
    {"id":"sec_verse","name":"Verse","startBar":9,"lengthBars":8},
    {"id":"sec_chorus","name":"Chorus","startBar":17,"lengthBars":8}
  ],
  "chords": [22 entries as above],
  "ensemble": {"templateId":"ensemble.cinematic","overrides":{},"pins":{}},
  "orchestration": {"take":7}
}
```

- **template:** `ensemble.cinematic`
- **seed:** not stored in file — store default `composeOptions.seed = 1` (see `src/store/store.ts:298`). `density:1, humanize:true` same source. `arrangementSeed = max(0, seed-1) = 0` so `effectiveTake = persistedTake + 0`
- **persisted take:** `7`
- **section types and bar ranges (via `sectionTypeKeyOf`):** `intro → intro 1-8`, `Verse → verse 9-16`, `Chorus → chorus 17-24` (all `lengthBars:8`, `1920 ticks/bar`)
- **chord count:** `22`

No source edits, read-only `structuredClone(raw)` passed to `composeAllTracks`.

## 3. Reproduce what the app does when Compose All is pressed twice

Store path `src/store/store.ts:401` (`composeAll`):
```ts
res = composeAllTracks(project, { ...composeOptions, arrangementSeed: Math.max(0,(seed??1)-1), variety: true })
edit(p => ({...p, tracks: res.tracks, orchestration: res.orchestration}))
```
So `seed:1, density:1, humanize:true, arrangementSeed:0, variety:true` (and `variety:false` second run), `effectiveTake = persistedTake+1` each press.

**From persisted `take=7`:**

| press | input take | after `take` | `variety:true` textures (from `ctx.lines.reports`) | ostinato style |
|---|---|---|---|---|
| 1st | 7 | **8** | `intro=leadPadBed, verse=pizzPulse, chorus=interlockingOstinato` | `verse=sparse/ascending/offBeat/dip, chorus=offBeat/descending/downbeat/rise/interlock` + `cinematic tremolo: 112 repeats` |
| 2nd | 8 | **9** | `intro=tremoloBed, verse=singleOstinato, chorus=singleOstinato` | `verse=straight/descending/downbeat/dip, chorus=straight/pedal/offBeat/rise` + `tremolo: 48 repeats` |

Full report for 2nd (`take=9`) variety:true (excerpt, 50 lines):
```
textures (take 9): intro=tremoloBed, verse=singleOstinato, chorus=singleOstinato
ostinato style (take 9): verse=straight/descending/downbeat/dip, chorus=straight/pedal/offBeat/rise
cinematic tremolo: 48 measured repeats carry the lead motif (articulation 'tremolo')
Vc+Cb layering (ensemble.cinematic): 51/51 notes doubled
brass (take 9): trombones ≥0.30 trumpets ≥0.55
brass plan (take 9): b5[low] horns:pad | b6[low] horns:pad | b7[low] horns:pad | b9[low] horns:unison | b10[low] horns:unison | b11[low] horns:unison | b12[low] horns:unison | b13[low] horns:pad | b14[low] horns:pad | b15[mid] horns:pad,trombones:guide | b17[high] horns:unison,trumpets:fanfare,trombones:lowDouble | b18[high] horns:unison,trumpets:fanfare,trombones:lowDouble
brass horns: 43 notes, trumpets 26, trombones 24, tuba 11
winds plan (take 9): b9[low] flutes:unison,bassoons:unison | b13[mid] flutes:ostinato,clarinets:ostinato,bassoons:bassDouble | b17[high] flutes:unison,bassoons:unison
...
```

**Same with `variety:false` (two presses):**

| press | textures |
|---|---|
| 1st (→8) | `intro=leadPadBed, verse=pizzPulse, chorus=interlockingOstinato` (identical, variety not touching cinematic texture draws) |
| 2nd (→9) | `intro=tremoloBed, verse=singleOstinato, chorus=singleOstinato` (identical to variety:true for this take; variety only adds PAD/Pizz shapes behind switch, not texture choice) |

Reports differ only by PAD/Pizz velocity windows (±1 vel, trombones 21→12 in earlier fixture test) — on this 24-bar file trombones are tacet 17-24 both modes.

## 4. Real grids for bars 9-24 (rows=pitch, cols=16th, 4 bars at a time)

Generated read-only by `repro-grids.mjs` from `p_after2` (variety:true take9) and `q_after2` (variety:false take9). Files `grid-variety-true-take9.txt` / `grid-variety-false-take9.txt` in repo (full output, see below). Excerpts:

### Horns (trk_07_horns) — variety:true take9
```
 horns bars 9-12 2 notes
     | bar 9      | bar10      | bar11      | bar12
 55 G3  X---------------|----------------|X---------------|----------------|
 horns bars 13-16 1 note
 53 F3  X-----          |                |                |
 horns bars 17-20 8 notes
 69 A4  X-------        |X-------X-------|                |        X-------|
 67 G4                  |                |X-------        |X-------        |
 65 F4          X-------|                |        X-------|                |
 horns bars 21-24 8 notes  (same pattern shifted)
```
`variety:false` identical for horns.

### Trombones (trk_09_trombones) — both modes
```
 trombones bars 9-12  (tacet) 0 notes
 trombones bars 13-16 (tacet)
 trombones bars 17-20 (tacet)  — brass plan 17-18 lowDouble never fires on this template/energy; fanfare only at 61440+ (b17 in project is 30720)
 trombones bars 21-24 (tacet)
```

### Flutes (trk_11_flutes)
```
 flutes bars 9-12  (tacet)
 flutes bars 13-16 (tacet)
 flutes bars 17-20 8 notes
 81 A5  X-------        |X-------X-------|                |        X-------|
 79 G5                  |                |X-------        |X-------        |
 77 F5          X-------|                |        X-------|                |
 flutes bars 21-24 8 notes (same)
```

### Violins I (trk_03_violins1)
```
 violins1 bars 9-12 3 notes (pad holds)
 94 A#6 -               |                |                |
 91 G6  X---------------|----------------|X---------------|----------------|
 violins1 bars 13-16 3 notes
 89 F6  X---------------|----------------|X---------------|----------------|
 violins1 bars 17-20 8 notes  — same onsets as horns/flutes (+16 ticks humanize)
 69 A4  X--------       |X-------X-------|-               |        X-------|
 67 G4                  |                |X--------       |X--------       |
 65 F4          X-------|-               |        X-------|-               |
```

### Violas (trk_05_violas)
```
 violas bars 9-12 32 notes  tremolo 76→65 224 ticks each
 76 E5  X-X-X-X-X-X-X-X-|X-X-X-X-X-X-X-X-|X-X-X-X-X-X-X-X-|X-X-X-X-X-X-X-X-|
 violas bars 13-16 32 notes  tremolo 65
 violas bars 17-20 8 notes
 57 A3  X--------       |X-------X-------|-               |        X-------|
 55 G3                  |                |X--------       |X--------       |
 53 F3          X-------|-               |        X-------|-               |
```

**Whether pattern above is reproduced:**

- **Bars 5-8 long sustains:** ✅ — violins1 11537:94:3886 + 7690:94:3830, horns tacet, violins2/violas tacet (strings `tremoloBed`/`leadPadBed` long holds).
- **Bars 9-16 horns dense single-pitch line of tiny notes:** ❌ NOT reproduced on this file — horns are 2-3 sustains (`55:3840, 53:640`) not dense. Violins II/violas dotted short notes ✅ (tremolo `224` ticks, 32 per 4 bars, exactly `X-X-` dotted 16ths). The dense horn line exists only in `trailer`/`singleOstinato` with `rate:16ths clippedShort` which `verse=singleOstinato` did not draw for this take.
- **Bars 17-24 scattered ripple with nearly same onsets:** ✅ REPRODUCED — see shared-onsets analysis below. Heads: horns/flutes `30720` exact, violins1 `30736` (+16), violins2 `30737` (+17), violas `30740` (+20), basses `30757/30759` (+37, two desks). `shared ticks ≥5 families within 35 ticks: 32 distinct ticks` in 17-24 for both variety:true and variety:false (see §4 footer). That is the “every time” pattern the user sees.

> The user screenshot’s 7th track (trombones) is tacet 17-24 on take9; the ripple is 6-family, still ≥70% (5/7). Earlier takes 2-5 show trombones present in other windows but not in 17-24 for this template.

## 5. Keep project fixed and vary only take 1-10, variety:true

Procedure: `project.orchestration.take = take-1` then one `composeAllTracks(..., variety:true)` → effective take = `take`. Same seed/density/humanize, no other mutation.

```
take1: hornsDense=false len=3 single=false  sharedTicks>=5=6   maxSharing=5/7
take2: hornsDense=false len=3 single=false  sharedTicks>=5=20  maxSharing=6/7
take3: hornsDense=false len=3 single=false  sharedTicks>=5=28  maxSharing=6/7
take4: hornsDense=false len=3 single=false  sharedTicks>=5=24  maxSharing=6/7
take5: hornsDense=false len=3 single=false  sharedTicks>=5=16  maxSharing=6/7
take6: hornsDense=false len=3 single=false  sharedTicks>=5=6   maxSharing=5/7
take7: hornsDense=false len=3 single=false  sharedTicks>=5=9   maxSharing=5/7
take8: hornsDense=false len=3 single=false  sharedTicks>=5=2   maxSharing=5/7
take9: hornsDense=false len=3 single=false  sharedTicks>=5=32  maxSharing=6/7
take10:hornsDense=false len=3 single=false  sharedTicks>=5=24  maxSharing=6/7
```

- **(a) dense horn line in bars 9-16:** **0 of 10 takes** show a dense single-pitch line (`≥16 notes single pitch`). All 10 have `3` sustains, 2 pitches (55/53), not dense.
- **(b) 5 or more families sharing onsets >70% in bars 17-24:** **10 of 10 takes** show at least one tick with ≥5 families within 35 ticks (i.e. >70% of 7). Distinct shared ticks per take range 2→32, maxSharing 5-6/7. The user’s “every time” is confirmed — the ripple is deterministic for this 24-bar Aeolian file.

For variety:false the same table is 0/10 and 10/10 (texture choice identical).

## 6. If reproduced: file/line, layer, rng or fixed

The reproduced part is the **bars 17-24 shared-onset ripple** (32 shared ticks, 6 families). The non-reproduced part (dense horn line) would be the other layer.

- **Shared ripple 17-24:** produced by three coordinated renderers reading the same harmonic spine (`src/orchestrator/spine/index.ts:chordSpans` + `sectionMap` + `orchestrationSeedFor`) and the same voicing (`src/orchestrator/voicing/chordTones.ts`):
  - Strings pad/lead: `src/orchestrator/render.ts:506 prepareStrings` → `src/orchestrator/lines/motif.ts:87 motifLine` (carrier `pad` via `conductor/layers.ts:textureForType`) and `src/orchestrator/render.ts:636` brassLeadBars gate. Layer: **`lead` (violins1) + `pad` (violins2/violas) + `bass` (cellosBasses→basses split)**, rhythm **fixed** (bar/half-bar `1920/960` ticks, `beatTicks` windows), not drawn from rng; only pitch voiced from chord.
  - Horns: `src/orchestrator/brass/render.ts:348` (fallback `hornDense` is NOT taken; `horns:unison` pad sustain `960` ticks). Layer: **`horns:unison` pad**, rhythm **fixed** bar/half-bar sustain.
  - Flutes: `src/orchestrator/winds/render.ts:218` ( `flutes:unison` `960` ticks). Layer: **`flutes:unison`**, rhythm **fixed**.

  Onsets appear scattered by `src/orchestrator/expression/humanize.ts:humanizeStrings` (+10-30 ticks per section, `humanizeHeadTicks`), and basses split adds `+1-3 ms` via `src/orchestrator/basses.ts:materializeBasses`, creating the “scattered” look while staying within 35-tick shared window.

- **Dense horn line 9-16 when it would appear:** `src/orchestrator/brass/plan.ts:188` (plan fallback `hornDense` / `b5[low] horns:pad`) + `src/orchestrator/brass/render.ts:348` + variety stream `src/orchestrator/brass/render.ts:110` (`brass:ostinato:${key}` salted `orchestrationSeedFor`). Layer: **`horns:ostinato` / `horns:unison` with `rate:16ths`**, rhythm **fixed** 16th grid (`ostinatoNotes` `TREMOLO_STEP_TICKS 224`), pitch single-tone held (dense tiny notes). Not drawn from rng for timing, only for presence (gate 0.30/0.55).

## 7. Is every change since cf60a6f included?

**YES.**

Head on this branch is `74310dc evidence: PAD+PIZZ…` → parents `11352eb strings variety: cello/bass pizz…` → `98c57b5 strings variety: pad…` → `717018e` → `cf60a6f`. All three user-requested PAD/Pizz changes plus evidence commit are in the code that ran above (verified by `git log --oneline cf60a6f..HEAD`). `composeAll` path used `variety:true` so both PAD (`strings-pad:${key}` 6 shapes) and Pizz (`strings-pizz:${key}:${block}` 6 cells) streams were active; `variety:false` run confirmed they gate correctly (`0 diffs` identity).

---
*All operations read-only: `google_drive/aeolian.crescode` cloned via `structuredClone`, `composeAllTracks` pure, no `git commit` or file writes to source.*
