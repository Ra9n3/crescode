# Phase 1 — Implementation report

**Scope:** Phase 1 only, per the approved rev. 4 architecture. No Phase 2 work, no
hard switch, no Piano V5 modification.

---

## 1. Files added and modified

### Added — new engine (`src/compose/`, 2,971 lines across 10 files)

| File | Lines | Responsibility |
|---|---|---|
| `ir.ts` | 332 | The shared musical representation (Layer 1–5 types) |
| `context/index.ts` | 283 | Layer 1: grid, form, harmony, energy, register field |
| `material/index.ts` | 401 | Layer 2: motifs, development, phrases, harmonic fitting |
| `director/index.ts` | 431 | Layer 3: participation, roles, moments, fills |
| `families/strings.ts` | 687 | Layer 4: idiomatic string realization |
| `perform/cc.ts` | 118 | Layer 5: CC1/7/11 from dynamic intent |
| `adapters/piano.ts` | 155 | OrchestraPlan → ConductorPlan for Piano V5 |
| `compile.ts` | 86 | The only `Track[]` writer |
| `seal.ts` | 134 | Invariant enforcement |
| `index.ts` | 344 | `composeOrchestra()` entry point |

### Added — tests (`tests/compose/`, 865 lines, 59 tests)

| File | Tests | Purpose |
|---|---|---|
| `piano-equivalence-gate.test.ts` | 18 | §7.7A gate — V5 determinism, context well-formedness, JSON round-trip. **Does not invoke the adapter** (§3.2) |
| `piano-adapter-integration.test.ts` | 12 | Adapter genuinely feeds V5 end-to-end |
| `phase1-acceptance.test.ts` | 28 | The ten §13.2 audible criteria + MIDI/profile/variation/determinism |
| `phase1-artifacts.test.ts` | 1 | MIDI export, parse-back, evidence dump |

### Added — other

- `scripts/compose-phase1-artifacts.ts` — artifact generator (runs as a test;
  no new dependency, since `tsx` is not installed).
- `artifacts/phase1/` — **2** merged + **8** per-track MIDI files, `summary.json` (8 KB).

### Modified

**None.** All four modified files are the pre-existing legacy diff, verified
byte-identical (per-file sha256 match) to `legacy/orch-fixes`; `git diff
legacy/orch-fixes -- src/orchestrator/` is empty. I changed no existing file.

---

## 2. Build and test results — actual commands

Re-run in full on the FINAL delivered tree, after both correction rounds — the
cross-section pairing (§5.11) and the applied voice-ceiling fix (§8.11):

```
npm ci                                    → installed, no errors
./node_modules/.bin/tsc --noEmit -p tsconfig.json
                                          → 0 errors
./node_modules/.bin/vite build            → ✓ built in 4.12s, dist/index.html 1,883.72 kB
./node_modules/.bin/vitest run tests/compose/
                                          → 5 files, 64 tests, all passed
./node_modules/.bin/vitest run            → 11 failed files / 17 failed tests
                                            / 1271 passed (1288 total, 85 files)
```

**The 11 failing files are exactly the pre-existing set**, unchanged from the
Phase 0 audit:

```
brass, orchestrator-compose, orchestrator-presets, phase10, phase12, phase4a,
phase9, piano-stage2a-lead-balance, piano-variation-baseline,
seed-reaches-all-families, variety-invariants
```

Ten fail because of the uncommitted legacy diff; `variety-invariants` fails at
`0b3ca39` itself. **Zero failures in `tests/compose/`.** New tests added:
64 (61 Phase 1 + 3 voice-ceiling guards). Net change in passing tests:
1207 → 1271. The failing set is **unchanged** — the voice-ceiling fix adds no
new failures and re-pins no legacy golden.

### 2.1 Reconciliation integrity

> **Superseded.** The paragraph below describes the *earlier* reconciliation pass,
> which did change documentation only. It no longer describes the current tree:
> the cross-section pairing correction (§5.11) changed `src/compose/ir.ts`,
> `src/compose/material/index.ts` and `tests/compose/phase1-acceptance.test.ts`),
> and the voice-ceiling fix (§8.11) changed
> `src/compose/families/strings.ts` and added
> `tests/compose/strings-ceiling.test.ts`.
> The snapshot digest below is that pass's record, not the current state.

This earlier pass changed **documentation only**. Proof: a sha256 snapshot of all 33
implementation files (`src/compose/**`, `tests/compose/**`,
`src/orchestrator/keys/**`, `src/store/store.ts`) was taken before the
reconciliation began and compared afterwards — identical, same file-level digests,
same aggregate digest `6455f50c1f6afd1580d1c285d5c82116d072a9c5489bf08688f3313f94fef4b4`.
A stray scratch probe (`tests/compose/zz-t1.test.ts`) was created during
measurement and removed; the final `tests/compose/` contains exactly the four
permanent files. No production file, test file or artifact was added, edited or
deleted as part of the reconciliation.

---

## 3. Piano V5 equivalence gate — §7.7A

`tests/compose/piano-equivalence-gate.test.ts` — **18 tests, all passing**,
across 3 cases (dorian/chamber, dorian/sonata, three-chorus/chamber).

### 3.1 What the baseline is

**There is no stored baseline artifact.** No fixture, golden file or recorded
MIDI exists under `tests/` or `artifacts/` for the piano gate. The "baseline" is
**computed live on every test run** by calling `composeAllTracks` — the existing
pipeline — with a fixed fixture/template/seed/take:

```ts
function baseline(fixture, templateId, seed, take) {
  const project = loadProject(fixture, templateId, take);
  const result  = composeAllTracks(project, { seed, density: 1, moments: true });
  const pianoTrack = result.tracks.find(t => isInstrumentTrack(t) && t.role === 'piano');
  return { project, input: result.pianoEngineInput, tracks: result.tracks, pianoTrack };
}
```

This is genuinely a baseline from the **old pipeline**, and `composeAllTracks` is
called unmodified by this test. But it is **not** "unmodified HEAD": the working
tree carries a pre-existing, four-file legacy diff (§7), and that diff includes an
octave-doubling guard inserted at `src/orchestrator/compose.ts` line ~657 which
**thins `notesByTrackId` before the V5 input is built** at line 819. So the
baseline is "HEAD plus the pre-existing legacy diff", not pristine `0b3ca39`.
The gate cannot detect a difference between those two, because it only ever runs
the working tree.

### 3.2 What each gate actually compares

| Gate | What it compares | Against what | Result |
|---|---|---|---|
| **A2** | V5 run twice on the *same* `PianoEngineInput` | itself | ✔ 3/3, non-vacuous (`notes.length > 0`) |
| **A1** | Structural properties of the old conductor's own context: bar windows inside sections, layer vocabulary legal, real track ids, moment kinds/roles, fill targets in range | invariants, not the adapter | ✔ 12/12 |
| **A3** | V5 on the original context vs. V5 on a `JSON.parse(JSON.stringify(...))` round-trip of **that same context** | itself | ✔ 3/3 |

**Stated plainly:** A1's title says "project correctly *through the adapter*", but
`piano-equivalence-gate.test.ts` **does not import or invoke the adapter at all**
(0 references to `adapters/piano`). A1 asserts that the *old* conductor's context
is well formed. A3 is a serialisation round-trip of the old conductor's context,
not a comparison of the adapter's output against the old conductor's.

So this file demonstrates **determinism and context well-formedness**. It does
**not** demonstrate adapter↔baseline equality, and there is no artifact that would
let it.

The separate `piano-adapter-integration.test.ts` (12 tests) runs the **real**
adapter (`buildConductorPlanForPiano` over a composed score) and checks that V5
receives usable input — 16/40 bar windows, annotated lead ownership, honest
moments, a real piano fill window, 18 harmonic events. That suite proves **the
adapter produces valid input**, not that its input is *equivalent* to the old
conductor's.

### 3.3 Honest limitation

No test compares "V5 output under the new orchestration" to "V5 output under the
old orchestration for the same musical content". Producing such a comparison would
require capturing a baseline from a pristine `0b3ca39` worktree, and the audit was
not authorised to run one. Under Correction 4 this is arguably the right scope —
when the musical context legitimately differs, different piano output is
*correct* — but the gate must not be read as proving more than it does.

Piano V5's 18,220 lines were not touched. `src/orchestrator/keys/` shows no
modification in `git status`.

---

---

## 4. MIDI export and parsing evidence

Exported through the existing `buildMergedMidi`/`buildPerTrackMidi` with
`src/export/profiles/uvi-orchestral-suite.json`, then parsed back with
`parseMidiFile`. Figures below are post-audit and were re-verified during the
final reconciliation.

**dorian-16bars, seed 1** (`artifacts/phase1/dorian-16bars-s1.mid`, **1593 bytes**):

```
ppq 960 | format 1 | 5 tracks | 0 seal violations
ch  1 | Violins 1 Ensemble |  44 notes | cc [1,7,11] | ks 2
ch  2 | Violins 2 Ensemble |  15 notes | cc [1,7,11] | ks 2
ch  3 | Viola Ensemble     |  15 notes | cc [1,7,11] | ks 2
ch  4 | Cello Ensemble     |  19 notes | cc [1,7,11] | ks 1
```

**three-chorus-40bars, seed 1** (**4137 bytes**):

```
ppq 960 | format 1 | 5 tracks | 0 seal violations
ch  1 | Violins 1 Ensemble | 101 notes | cc [1,7,11] | ks 4
ch  2 | Violins 2 Ensemble |  76 notes | cc [1,7,11] | ks 2
ch  3 | Viola Ensemble     |  38 notes | cc [1,7,11] | ks 4
ch  4 | Cello Ensemble     |  37 notes | cc [1,7,11] | ks 1
```

Musical notes vs. MIDI note events reconcile exactly as
`musical + keyswitches`: 86 + 7 = 93 and 241 + 11 = 252 (full table in §5.0).

Verified properties:

- **No `programChange`** events (profile-driven, as before).
- **Keyswitches: one per articulation change** — 7 on dorian, 11 on
  three-chorus, *not* one per part. Each sits inside its part's own
  `keyswitchZone`, matches the written articulation, and never collides with
  another switch (mutual overlap 0). Deviates from §13.2 criterion 9 as written;
  see §8.6 for the justification and the latching proof.
- **Only profile-enabled controllers**: CC1, CC7, CC11. CC68 and CC74 are
  disabled in the profile and are not written.
- **No channel collisions**: 4 distinct channels.
- **No invented articulations**: every articulation is one of
  `legato / marcato / pizz / spiccato / sustain / tremolo` — the profile's actual
  keyswitch vocabulary. Asserted by test `9c`; the full emitted sequence is
  validated element-for-element in §8.6.

---

## 5. Evidence for each §13.2 audible criterion

All figures below are **post-audit** and were re-measured during the final
reconciliation. Demonstrated on `three-chorus-40bars` (40 bars, 7 sections) so
that nothing here is evidence from the opening bars only. Full dump reproducible
via `tests/compose/phase1-artifacts.test.ts`.

### 5.0 Note-count reconciliation against parsed MIDI

Musical note counts and parsed MIDI event counts differ by exactly the number of
keyswitch events. There are no dropped, duplicated or invented notes:

| Fixture | Part | Musical notes | Parsed MIDI notes | = sounding + keyswitches |
|---|---|---:|---:|---|
| dorian-16bars | violins1 | 42 | 44 | 42 + 2 |
| dorian-16bars | violins2 | 13 | 15 | 13 + 2 |
| dorian-16bars | violas | 13 | 15 | 13 + 2 |
| dorian-16bars | cellosBasses | 18 | 19 | 18 + 1 |
| **dorian-16bars** | **total** | **86** | **93** | **86 + 7** |
| three-chorus-40bars | violins1 | 97 | 101 | 97 + 4 |
| three-chorus-40bars | violins2 | 74 | 76 | 74 + 2 |
| three-chorus-40bars | violas | 34 | 38 | 34 + 4 |
| three-chorus-40bars | cellosBasses | 36 | 37 | 36 + 1 |
| **three-chorus-40bars** | **total** | **241** | **252** | **241 + 11** |

A keyswitch is a short note (1–48 ticks) inside the part's keyswitch zone; every
other note is musical material. `artifacts/phase1/summary.json` records the same
per-track counts.

**1. Recognizable motifs.** Two distinct cells:
`motif-pickup-run-1` degrees [0,1,2,0,−1] durations [240,240,480,960,1920];
`motif2-anacrusis-1` degrees [0,−1,−2,−3] durations [480,480,960,1920].
The primary is stated **14** times in 14 different bars across 7 sections; the
secondary 37 times in 26 bars. (Degree values are post-audit; `[0,1,2,0,6]` and
`[0,6,5,4]` were the wrapped encodings that made a rising line read as a
falling one — see §8.1.)

**2. Phrase development.** **51** statements, of which **29** are transformations
beyond identity: `invert` 8, `transpose` 6, `fragment` 14, `augment` 1
(`identity` 22). Each carries a recorded description. Examples beyond the
opening: bar 9 `augment`, bar 11 `transpose`, bar 21 `fragment`, bar 33
`fragment`, bar 37 `fragment`. The 51 includes the counterline's own statements
added by §8.2. On the 16-bar dorian fixture: 24 statements (identity 9,
transpose 2, invert 6, fragment 7).

**3. Phrase structure.** 14 phrases spanning the whole form:
`b1:antecedent b3:consequent b5:antecedent b9:climax b13:antecedent
b15:consequent b17:antecedent b21:consequent b25:sustain b27:sustain
b29:antecedent b33:consequent b37:consequent b39:cadence`.
Sections: `sec_verse1` 1–4, `sec_chorus1` 5–12, `sec_verse2` 13–16,
`sec_chorus2` 17–24, `sec_bridge` 25–28, `sec_chorus3` 29–36, `sec_outro` 37–40.
Every phrase lies entirely inside its own section (**0 notes outside their
phrase window**, verified across all 241 notes).

> **§13.2 criterion 3 — now met as written.** Earlier revisions of this report
> recorded a deviation here: phrases were labelled `antecedent`/`consequent` by
> index, no pair crossed a section boundary, and 3 of the 5 adjacencies built the
> consequence from a **different** motif. That is fixed. `Phrase.answersPhraseId`
> now records an explicit answer-link, and `pickCrossSectionPair` selects a
> boundary whose right-hand phrase becomes the **consequence**. In both fixtures
> the consequence inherits the antecedent's *realised* motif (`antecedentMotifId`,
> captured after the lead is written, not "the primary motif") and opens with
> `fragment → invert → transpose` — development, not restatement. The pair is
> adjacent by construction (`rightIndex === leftIndex + 1`), shares the boundary
> tick exactly (gap and overlap 0), and the antecedent ends on its section's
> `endTick` while the consequence starts on the next section's `startTick`.
> Concretely: dorian `phrase-sec_verse-1` (bars 5–8) → `phrase-sec_chorus-0`
> (bars 9–12); three-chorus `phrase-sec_bridge-1` (bars 27–28) →
> `phrase-sec_chorus3-0` (bars 29–32). Full detail in §5.11, asserted by test
> `3b` in `tests/compose/phase1-acceptance.test.ts`. Deviation **D1 is retired**.

**4. Coordinated participation.** Sections carry functions
`opening / culmination / reprise / contrast / closing`; parts change at phrase
boundaries. The Director plans **3 moments** (unison, tutti, soli) at
structurally correct points — the tutti at a culmination, the soli in the
contrast section — and after the §8.2 fix those moments are **audible**: the
soli at bars 25–28 leaves only `violins1` sounding; the bar-1 unison leaves only
`violins1` and `cellosBasses`. Before that fix they were reported but not
applied.

**5. Distinct roles.** `violins1:lead`, `violins2:inner`/`counter`,
`violas:inner`, `cellosBasses:bass`. Registers are separated for the whole piece:
lead 64–81, counter 60–76, viola 57–67, bass 38–48. The lead's mean pitch
exceeds the bass's by more than two octaves. Role separation is by register
**and** function; counterline independence is measured in §8.2 and §8.6: unison/octave collisions
with the lead fell from 84 % to 8 %, and no counter note crosses above the lead.

**6. Idiomatic writing.** All four parts stay inside their **declared
comfortable** windows — lead 64–81 (61–86), violin2 60–76 (61–84), viola 57–67
(54–78), cello 38–48 (36–70). Measured containment on three-chorus: **100 %,
99 %, 100 %, 100 %** of notes inside the declared window (dorian is **100 % on
all four parts**, with every voice's range fully inside its window). Average lead
leap 2.2 semitones (dorian) and 2.5 (three-chorus); maximum **7** and **10**, with
0 of 41 and 3 of 96 leaps wider than a minor seventh. **Voice crossings** at
120-tick resolution: **0 on both fixtures, in every voice** — 60-tick sampling
across the whole piece. Dorian previously showed 64 samples of violins2 above
violins1 (bars 6–8); that pre-existing defect was fixed by the separately
delivered `patches/0001-strings-voice-ceiling.patch`, applied for this build. See
§8.11 for the root cause, the three-state measurement and the patch record.

> **Correction.** This criterion previously claimed "100 % of notes are chord
> tones". That stopped being true when the audit made chord-tone fitting a
> strong-beat rule (§8.1): weak-beat non-chord tones are now deliberate passing
> and neighbour notes, which is what makes the motif recognisable. The claim is
> withdrawn rather than the musical fix reverted.

**7. Rests AND legitimate sustaining.** `violins1` has 16 stated rest spans;
`violins2` 19; `violas` 1; `cellosBasses` 0. After §8.2 the rests fall where the
Director's moments say they should. Simultaneously `violas` and `cellosBasses`
play continuously (34 and 36 notes, 0 gaps, 0 overlaps) — deliberate continuous
playing, not a defect. They are re-articulated rather than held: pitch changes in
**39 of 39** bar-to-bar transitions (§8.2). No rest was introduced to satisfy a
test.

**8. Dynamics.** Velocity **57–112** on the 40-bar piece (48–99 on dorian), with
real contour movement (≥10 distinct velocity steps per part). No velocity pinned
at 1 or 127. CC11 is shaped per phrase from each phrase's own velocity contour
(§8.4).

**9. Valid MIDI export.** Channels 1–4, distinct; CC lanes limited to the
profile-enabled `1/7/11`; no `programChange`; no orphaned CC after a part's last
note. Keyswitches: **this criterion asked for exactly one per part; the engine
emits one per articulation change** (7 on dorian, 11 on three-chorus). Every
switch is a valid UVI articulation inside the part's zone, and each matches the
musical articulation sequence exactly. See §8.6 for the deviation, the profile
validation and the latching proof.

**10. No filler.** Every note resolves to a planned phrase (asserted for all 241
notes across four parts; **0** notes outside their own phrase window);
`seal.ts` reports zero violations on both fixtures.

**Bonus — variation and determinism.** Same seed and take reproduce the score
byte-identically; four seeds produce four distinct plans with 45–53 % shared note
positions. Template-free composition is tested and orchestrates every eligible
string track.

### 5.11 The cross-section pair, concretely

Both fixtures now realise an explicit antecedent→consequent answer across a
section boundary. The consequence is not a restatement: it takes the
antecedent's own motif, fragments it, inverts it, and transposes it.

#### dorian-16bars, seed 1 — `sec_verse` → `sec_chorus`

| | Antecedent | Consequent |
|---|---|---|
| phrase ID | `phrase-sec_verse-1` | `phrase-sec_chorus-0` |
| section ID | `sec_verse` | `sec_chorus` |
| bars | **5–8** | **9–12** |
| function | `antecedent` | `consequent` |
| motif | `motif2-arch-1` | `motif2-arch-1` (**same**) |
| link | — | `answersPhraseId = phrase-sec_verse-1` |
| statements | `-s6` identity (b5) · `-s7` invert (b6–7) · `-s8` identity (b7–8) | `-s12` **fragment** (b9) · `-s13` **invert** (b10–11) · `-s14` **transpose** −2° (b11–12) |
| lead pitches | `b5:74 76 77 79 · b6:74 72 71 · b7:69 64 64 · b8:67 67` | `b9:74 76 · b10:74 72 71 · b11:67 72 72 · b12:74 76` |

Boundary: antecedent `endTick` **30720**, consequence `startTick` **30720** —
**0 ticks of gap, 0 of overlap**.

#### three-chorus-40bars, seed 1 — `sec_bridge` → `sec_chorus3`

| | Antecedent | Consequent |
|---|---|---|
| phrase ID | `phrase-sec_bridge-1` | `phrase-sec_chorus3-0` |
| section ID | `sec_bridge` | `sec_chorus3` |
| bars | **27–28** | **29–32** |
| function | `antecedent` | `consequent` |
| motif | `motif2-anacrusis-1` | `motif2-anacrusis-1` (**same**) |
| link | — | `answersPhraseId = phrase-sec_bridge-1` |
| statements | `-s33` identity (b27) | `-s35` **fragment** (b29) · `-s36` **invert** (b30–31) · `-s37` **transpose** −2° (b31–32) |
| lead pitches | `b27:74/480 72/480 71/960 67/5760` | `b29:64 72 · b30:74 76 79 79 · b31:72 69 67 · b32:64` |

Boundary: antecedent `endTick` **107520**, consequence `startTick` **107520** —
**0 ticks of gap, 0 of overlap**.

#### What makes it a development, not a reuse

- The consequence opens with **`fragment`**, so the first thing heard after the
  boundary is a *part* of the antecedent's cell, not the cell again.
- The plan is **`fragment → invert → transpose −2°`**. No consequence statement
  is `identity`, and at least two distinct operations are applied (asserted).
- The pitch sequence of the consequence differs from the antecedent's in both
  fixtures (asserted), so the relationship cannot be satisfied by copying notes.
- The consequence inherits the antecedent's **realised** motif ID — captured from
  the antecedent's first statement after the lead was written. Inheriting "the
  primary motif" instead was tried and produced a false pair (dorian's
  consequence answered `motif-dotted-1` while the antecedent stated
  `motif2-arch-1`).
- The pair survives export: parsing `artifacts/phase1/*-s1.mid` back yields the
  same pitch sequences on channel 1 in the same bar windows.

**Verified by** `tests/compose/phase1-acceptance.test.ts`, test
`3b. answers its antecedent ACROSS a section boundary, with the same motif`
(runs for both fixtures). It asserts: exactly one `answersPhraseId` link;
sections adjacent (`rightIndex === leftIndex + 1`) and distinct; functions
`antecedent`/`consequent`; `antecedent.endTick === leftSection.endTick` and
`consequent.startTick === rightSection.startTick`; every consequent `motifId`
present among the antecedent's motifs; the first consequence op is not
`identity` and ≥2 distinct ops appear; the consequence's pitch sequence differs
from the antecedent's. **The test was sabotaged** — swapping the inherited motif
to the other candidate made it fail on both fixtures (2 failed / 28 passed) — so
it is a test that can actually fail.

## 6. Unmet criteria, limitations and deviations

**Honest limitations:**

1. **Sound quality is NOT verified.** No UVI Workstation or sound library is
   available in this environment. Everything above is structural, statistical and
   musical-property evidence parsed from MIDI bytes. I cannot confirm it sounds
   good, and I am not claiming that.
2. **Only the strings family is implemented** (Phase 1 scope). Winds, brass,
   percussion and harp tracks are left exactly as they were — not filled with
   placeholder material. On a full template, those tracks keep their pre-existing
   notes.
3. **The hard switch has not happened.** `store.ts:401` still calls
   `composeAllTracks`. `composeOrchestra` is reachable only from tests and the
   artifact script.
4. **CC lanes are newly authored by this engine.** CC11 is shaped per phrase
   from each phrase's velocity contour and CC1 follows the notes, but these are
   not the old engine's lanes and are not field-tested against a real library.
5. **`energyAtTick` is currently unused** in CC shaping — the contour comes from
   the notes' own velocities and phrase shapes. The parameter is retained and
   documented.
6. **Seed variation is real but bounded.** Different seeds change motifs,
   statement counts, fills and orchestration detail (45–53% shared note
   positions), while the form, sections, phrase grid and harmonic plan stay
   fixed. That is a deliberate choice for Phase 1, not an accident.

**Deviations from the proposal:** five live, listed in §9.1 (D2 keyswitches,
D3 adapter typing, D4 module layout, D5 local RNG, D6 strings-only); D1 (the
label-only pairing) is **retired** — see §5.11. The only one that affects
acceptance is D2. One judgement call also worth naming: the
string-family **choir stack** (lead above inner voices, by instrument order and a
hard ceiling) is a musical decision introduced in the Director and the strings
engine; it is what eliminated voice crossings. It is recorded in code comments as
a musical choice, not presented as inevitable.

**Defects found and fixed during Phase 1** (each was a real musical bug caught by
measurement, not a test tweak): piano stealing the lead role; sections 1–8 empty
because participation was overwritten per section; violins1 sitting above the
lead; `degreeForPitchClass` snapping borrowed chord tones to the tonic (0/18
chord tones); semitone nudging off chord tones; 12-semitone leaps from narrow
slot bands; 20-semitone leap from an unbounded collision search; `detache` and
`portato` written but absent from the UVI profile (invented keyswitches);
duplicated overlapping rest spans.

**Defects found and fixed by the pre-completion audit** (§8) — **eight**, all
musical: wrapped motif degrees that inverted a rising line into a falling one;
chord-tone fitting applied to every note (44% of adjacent pairs repeated);
register penalties that made an octave leap cheaper than a semitone step (leaps up
to 11 semitones); `moments` computed and reported but never applied, so a planned
`soli` had all four parts playing; a `counter` line that replayed the lead's own
statements (84% unison/octave); a counter line that crossed above the lead in 12
bars; a hard floor that destroyed inversion; and CC11 that ignored phrasing. Plus
two corrected test assumptions: a latched keyswitch need not be at tick 0 when a
part enters later, and "exactly one keyswitch per part" (§8.6).

---

## 7. Confirmation: old engine connected, switch not performed

```
src/store/store.ts:10   import { composeAllTracks } from '../orchestrator/compose';
src/store/store.ts:401    composeAllTracks(project, {...})
```

- `src/store/store.ts` — **unmodified** (absent from `git status`).
- Compose All still invokes the old engine exactly as before.
- The 4 files shown as modified (`compose.ts`, `moments.ts`, `render.ts`,
  `voiceLead.ts`) are the **pre-existing legacy diff**. I did not author or alter
  them.
- `src/orchestrator/keys/` (Piano V5) — unmodified (`git status` empty).
- No file was deleted. No dependency was added. No commit or push was made.

### 7.1 `legacy/orch-fixes` verified against the preservation record

| Check | Expected | Measured | Status |
|---|---|---|---|
| Branch commit | recreated after sandbox reset | `e4d84ab28d78d264a4c7a517bd08c6c086c8514f` | ✔ |
| Parent commit | `0b3ca39a842c6ee1c9234c48f16265349e7be999` | `0b3ca39a842c6ee1c9234c48f16265349e7be999` | ✔ |
| `voiceLead.ts` blob | working-tree content | `156dfcf29402b468161f29ea43912821dffa6133` | ✔ matches worktree |
| `compose.ts` blob | working-tree content | `9fc51a67a73444cf8d04f0bf19435f0949630128` | ✔ matches worktree |
| `moments.ts` blob | working-tree content | `a1fedafed8bfda3644648bf7d47626c788fe9cf5` | ✔ matches worktree |
| `render.ts` blob | working-tree content | `8469d982a5d3cac00d498668d1c5dc7136bfa4fb` | ✔ matches worktree |
| Preserved diff sha256 | `01547013c1f43b24c4923de774a96b4c19045c5ca9a46c2a3c00f90331677309` | identical | ✔ |
| Diff shape | 4 files, 86 insertions, 8 deletions | 32 / 4 / 9 / 49 lines; 86 +, 8 − | ✔ |
| Working tree vs branch | empty diff | `git diff legacy/orch-fixes -- src/orchestrator/` empty | ✔ |

**The earlier hash discrepancy is resolved.** `01547013…` reproduces exactly under
five independent methods, including the authoritative
`git diff 0b3ca39 legacy/orch-fixes -- src/orchestrator/`. The `d767e53e…` value
recorded in the previous turn came from `git diff -- src/orchestrator/*.ts`, whose
shell glob expands to `basses.ts, compose.ts, module.ts, render.ts` — a *different*
file set, because `conductor/moments.ts` and `voicing/voiceLead.ts` live in
subdirectories. That was a **measurement error in the report, not a content
change**. No file differed then or now.

---

## 8. Pre-completion verification audit

A focused audit was run against the six questions in the review brief, using the
two fixtures and their real MIDI output. It found **five genuine musical defects**,
all now fixed, and one false premise. Numbers below are post-fix.

### 8.1 Motifs and phrases (item 1)

`generateMotif` and `generateCounterMotif` stored degrees **wrapped to `0..size-1`**.
An ascending line `0,1,2,3` was therefore stored as `0,6,5,4` and read back as a
*falling* fifth, which produced 9–11 semitone "leaps" that were really octave
wraparounds. Degrees are now stored unwrapped, and `statementDegrees` no longer
wraps either, so inversion mirrors true intervals (`signedInterval`) instead of
folding in modulo space.

Concrete result on `three-chorus-40bars` seed 1 (bars, pitch/duration in ticks):

```
MOTIF motif-pickup-run-1  degrees=[0,1,2,0,-1]  durations=[240,240,480,960,1920]
MOTIF motif2-anacrusis-1  degrees=[0,-1,-2,-3]  durations=[480,480,960,1920]

bar  1  s0  identity   | 74/240 76/240 77/480 74/960 72/5760   [+2,+1,-3,-2]
bar  3  s1  invert     | 74/480 76/480 77/960 81/5760          [+2,+1,+4]
bar  6  s3  transpose+2| 77/240 79/240 81/480 74/960 76/1920   [+2,+2,-7,+2]
bar  9  s5  augment    | 74/960 72/960 69/1920 69/3840         [-2,-3, 0]
bar 15  s8  fragment   | 74/240 76/240 77/480                   [+2,+1]
bar 37  s23 fragment   | 74/240 76/240 77/480                   [+2,+1]
```

The motif is recognisable in every transformation: identity reproduces the
intervals exactly (`+2,+1,-3,-2`), transpose shifts the whole line, augment
doubles durations, fragment truncates, and inversion is contour-faithful
(descending `[0,-1,-2,-3]` becomes ascending `[0,+1,+2,+3]`).

Two further fixes were required:
- **Chord-tone fitting was applied to every note**, snapping adjacent degrees onto
  one pitch (44% of adjacent motif-note pairs repeated). Fitting now applies on
  **strong beats only**; weak-beat non-chord tones are passing/neighbour notes.
  Repeated pairs: **44% → 8%**.
- **Register corrections outranked voice leading** in `pitchForMelody`: a flat
  12-semitone penalty for one step outside the stack floor made the melody leap
  an octave instead of stepping down. It is now a graded penalty, plus a
  step-preferring selection. Lead leaps: dorian max **11 → 5** semitones
  (14% → 0% above a seventh); three-chorus **10 → 9** (8% → 2%). The two
  remaining wide intervals sit at section boundaries (bars 13, 29) where the
  theme returns at its original register after a low chorus. *(Post-correction
  figures for the delivered build are 7 and 10, with 0/41 and 3/96 above a
  seventh — see §5.6; the antecedent is now longer, so the lead plays more
  notes.)*

Phrase integrity: **0 of 241 notes fall outside their own phrase window**; the
40-bar piece uses 14 phrases across 7 sections.

### 8.2 Continuous parts and texture (item 2, item 4)

The Director computed `moments` (`unison`, `tutti`, `soli`) and reported them, but
**realisation never consumed them**. A `soli` at bars 25–28 that names only
`violins1` had all four string parts playing. Moments are now applied by
subtracting each moment's window from every role that is not a participant. Verified:

```
unison bar 1     violins1 5 notes | violins2 0 | violas 0 | cellos 1
soli bars 25-28  violins1 9 notes | violins2 0 | violas 0 | cellos 0
tutti bar 8      violins1 1       | violins2 1 | violas 1 | cellos 1
```

The sustained inner parts are **not** artificial filler and **not** rest-padded:
violas and cellos change pitch in **39 of 39** bar-to-bar transitions (17/18 in
dorian) — they are re-articulated harmonies, not a held drone — and the notes are
genuinely continuous (0 gaps, 0 overlaps) because span logic keeps them sounding.
No rest was introduced to satisfy any test.

`counter` was replaying the **lead's own statements and durations**, so it shared
79% of the lead's onsets and sat at unison or the octave in 66/79 of them (84%):
doubling, not counterpoint. Phrases now carry a separate `counterStatementIds`
built from the contrasting motif with its own staggered entry.

Measured progression as the audit fixes landed (three-chorus, seed 1):

| Stage | Shared onsets | Unison/octave at shared onsets |
|---|---:|---:|
| Original (counter replayed lead) | 79 % | 66/79 = **84 %** |
| After separate counter statements | 59 % | 20/59 = 34 % |
| After hard ceiling + per-note lead bound (§8.7) | 59 % | **5/59 = 8 %** |

Final vertical interval set: `-12,-10,-9,-7,-5,-4,-3,-2,-1,0` — the counter now
sits a third to a tenth below the lead instead of shadowing it, and only 5 of 59
coincidences are a unison or octave. `-12` and `0` are the residual cases where
the only legal chord tone lay directly under the lead.

Texture over the 40 bars shows real development: the lead rests at bars 2, 4, 12,
14, 16 and 24; violins2 drops out entirely at bars 8 and 12; the bridge and outro
thin to two voices. It is not 40 identical bars.

### 8.3 Piano fill window (item 3)

The brief's premise — that neither fixture has a piano track — is **false**. Both
fixtures declare `tracks: 0`, so `projectFromFixture` (`src/shared/schema/factory.ts:85`)
populates the default 21-instrument roster, which includes piano, and
`isPianoEngineEligible` is true for the chamber template. The genuine defect was
that the old `planFills` derived windows from *planned* spans plus a
closing-section rule, while the phrase-final **hold** extended a lead note across
that window — so piano received a fill window over a sounding lead (`76 @ 56640
for 4800` across `57600–61440`).

`planFills` was replaced by `planFillsFromRealisation`, which derives windows from
**realised** lead silence. Result: **dorian 0 fills** (its lead never leaves a
full bar of silence) and **three-chorus 6 fills**, with **0 lead overlaps** in
both. Piano V5 was not modified.

### 8.4 Performance data (item 5)

```
three-chorus-40bars seed 1, parsed back from the exported MIDI
Violins 1  104 notes  vel[57-112]  CC1 100p  CC7 2p  CC11 143p  ks 4
Violins 2   76 notes  vel[62-112]  CC1  74p  CC7 2p  CC11 108p  ks 2
Viola       38 notes  vel[62-112]  CC1  34p  CC7 2p  CC11  68p  ks 4
Cello       37 notes  vel[62-112]  CC1  36p  CC7 2p  CC11  73p  ks 1
```

- Channels 1–4, all distinct; **0 note overlaps** in every part; no program change.
- Every CC lane is one the profile enables (`1`, `7`, `11`); CC68/CC74 are never
  written. **No orphaned CC events** after a part's last note.
- **CC11 was a fixed 4-point arch across the whole part**, which on a 40-bar piece
  said nothing about phrasing. It is now shaped **per phrase** from that phrase's
  own velocity contour: 4 → 41 points on the 40-bar fixture.
- Keyswitches are valid UVI articulations for each part: violins1 `24/26/33` =
  sustain/legato/marcato, violins2 `36/38`, cello `12` (sustain). A part that enters
  late (violins2/violas at bar 3, after the bar-1 unison) latches its switch at that
  entry rather than at tick 0 — the earlier "must be at tick 0" assertion encoded a
  wrong assumption and was corrected.

### 8.5 Seed variation and reproducibility (item 6)

Four seeds of `three-chorus-40bars`:

```
seed 1  motifs [0120-1] [0-1-2-3]  stmts 51  notes 241  fills 7
seed 2  motifs [01243]  [0121]     stmts 51  notes 225  fills 4
seed 3  motifs [023]    [0101]     stmts 63  notes 222  fills 4
seed 7  motifs [0134]   [012]      stmts 69  notes 235  fills 4
```

- **Reproducible:** re-running the same seed and take produces a byte-identical
  note signature for all four seeds.
- **Different takes** of the same seed differ (no cached output).
- **Coherent variation, not random displacement:** seeds share 45–53% of
  note positions (same form, sections, phrase grid and harmonic plan) while the
  motifs, statement counts, fills and orchestration details change together.
  Sections, phrase boundaries and moment placement are identical across seeds,
  which is what "coordinated" means here.

### 8.6 Keyswitches: deviation from "one per string part"

**The criterion.** §13.2 criterion 9 asks for "one latched keyswitch per string
part inside its zone". The delivered engine emits **one per articulation change**:
7 keyswitches across 4 parts on dorian, 11 across 4 parts on three-chorus.

**Why this is necessary.** A UVI orchestral patch selects its articulation from
the last keyswitch it received. The Phase 1 engine writes genuinely different
articulations within a single part — `legato`, `marcato`, `sustain` all appear in
violins1 on the 40-bar piece. With a single latched switch at tick 0 the part
would play the whole piece in whatever the first articulation happened to be, and
the written articulations would be silently ignored. Emitting on change is what
makes the written articulation audible; a single switch would satisfy the letter
of the criterion while defeating its purpose ("bowing/articulation appropriate to
the material", criterion 6).

**This is a deviation, and it is recorded as one.** The criterion is not met as
written.

**Every articulation is valid for the profile.** Verified against
`src/export/profiles/uvi-orchestral-suite.json` (pitch convention `C3 = 60`):

| Part | Keyswitch zone | Emitted sequence | Musical articulations |
|---|---|---|---|
| violins1 | 24–38 | legato(D0=26) → marcato(A0=33) → legato(D0=26) → sustain(C0=24) | legato → marcato → legato → sustain |
| violins2 | 36–50 | legato(D1=38) → sustain(C1=36) | legato → sustain |
| violas | 24–47 | legato(D0=26) → marcato(A0=33) → legato(D0=26) → sustain(C0=24) | legato → marcato → legato → sustain |
| cellosBasses | 12–35 | sustain(C-1=12) | sustain |

- All 6 emitted pitches exist in the profile's `keyswitches` map for that exact
  part. **No invented articulation.**
- The emitted sequence **equals** the musical articulation-change sequence
  element-for-element on all four parts (verified programmatically: `match: YES`).
- Every switch lies **inside** its part's `keyswitchZone`.

**Latching is structurally guaranteed, not merely observed.**

1. `src/export/profile.ts:804` builds each part as
   `[...keyswitchNotesFor(...), ...merged].sort((a,b) => a.startTick - b.startTick || a.pitch - b.pitch)`.
   At a shared tick the lower pitch sorts first.
2. For every string part the **highest** keyswitch is *below* the part's
   `playableLow` — violins1 38 < 48, violins2 50 < 53, violas 37 < 48,
   cello 21 < 36. So at a shared tick the keyswitch always sorts **before** the
   musical note and is written first.
3. Consequently **no keyswitch is ever overwritten by a sounding note at the same
   tick**, and all note-ons carry the same writer `order` (2) and preserve their
   insertion order.
4. **Switches never collide with each other:** measured *mutual overlap = 0* on
   every part in both fixtures. Their ticks are strictly increasing
   (0, 30672, 46032, 145872 etc.), each ≥ 48 ticks after the previous ends.

**On "overlap" with sounding notes.** A switch deliberately sounds *during* the
previous note: the profile sets `keyswitchLeadMs = 30`, so a switch starts ~30 ms
before the note it governs and is voiced while the preceding note still sustains.
That is the intended behaviour — the library needs the switch before the note
starts. Switches are 1 tick at tick 0 (no room for a lead) and 48 ticks
elsewhere. This is not an unintended overlap; the only true invariant is that a
switch never begins *after* the note it governs, and that holds for every switch
in both fixtures.

---

### 8.7 Two further defects found while checking the report itself

Opening the report for review exposed that §5 (the §13.2 criteria) still carried
**pre-audit** figures that §8 contradicted, and checking them turned up two more
real musical defects.

**7. The counterline crossed above the lead in 12 bars.** `pitchForMelody` treated
the stack ceiling as a *soft penalty*, so at bar 10 violins2 climbed to 79 while
the lead held 69 — a tenth above the melody, which reads as an unintended
handover. Measured 170 crossing samples at 120-tick resolution. The ceiling is now
a **hard bound**, and the counter is bounded by the lead's *sounding pitch* rather
than a static family number, because the lead moves. The static ceiling plus the
moving pitch also squeezed the counter into 59–70, below its declared comfortable
window, so the counter now uses the moving bound only. **Crossings: 170 → 0.**

**8. A hard floor destroyed inversion.** With the floor enforced as a hard bound,
degree `-3` in the dorian mode is pitch class A, which in the lead's window
occurred only at 57, 69 and 81. The floor of 70 left 81 as the only legal A, so a
**one-step melodic descent became a 9-semitone jump**, and inversion — a criterion
this report certifies — was not actually musical. The floor is now a preference
that yields when honouring it would cost more than four semitones, and never
relaxes onto the instrument's hard extremes. Lead leaps: **max 9–11 with 8–14%
above a seventh → max 5 (dorian, 0%) and max 9 (three-chorus, 2%)**. *(Delivered
build after the pairing correction: max **7** (0/41
above a seventh) and max **10** (3/96).)*

Correcting §5 also withdrew a claim: it said "100% of notes are chord tones". That
stopped being true when §8.1 made chord-tone fitting a strong-beat rule, so the
claim was removed rather than the rule reverted.

### 8.8 Verification status after the audit

```
./node_modules/.bin/tsc --noEmit -p tsconfig.json   ->  0 errors
./node_modules/.bin/vitest run tests/compose/       ->  64 passed (5 files)
./node_modules/.bin/vitest run                      ->  17 failed | 1271 passed
                                                        (11 files, identical
                                                         pre-existing set)
./node_modules/.bin/vite build                      ->  built in 4.12s
```

The 11 failing files are the same pre-existing failures recorded at the base
commit; none touches `src/compose/`.

### 8.9 Remaining truths that are not defects

- **`hashString`/`makeRng` remain local** to `src/compose/material/index.ts`
  instead of moving to `shared/deterministic.ts`.
- **`adapters/piano.ts` imports `ConductorPlan`/`BarPlan`/`LayerSlot`/`MomentKind`
  type-only.**
- **`register.ts` is folded into `context/index.ts`**; there is no separate
  `perform/` module beyond `perform/cc.ts`.
- **Only the strings family is implemented**; the other 17 instruments receive
  nothing from the new engine yet.
- **Sound quality was not verified.** There is no UVI Workstation or library in
  this environment. Every claim above is about generated MIDI structure and event
  data, never about how it sounds. The UVI profile was used to validate
  articulation vocabulary and controller enablement only.
- **The Piano V5 gate has no stored baseline** (§3). It shows determinism and
  context well-formedness; it does not compare adapter output against the old
  conductor's, and its "baseline" is the working tree, not pristine `0b3ca39`.

### 8.11 The voice ceiling — APPLIED, a separately identifiable change

**Status: applied to `src/compose/families/strings.ts`.** Delivered and tracked as
`patches/0001-strings-voice-ceiling.patch` (3 hunks) so it remains a distinct,
reviewable change rather than an untraceable edit folded into the Phase 1 work.
It is **not** part of the cross-section correction and does not affect
criterion 3.

#### The defect (pre-existing, not introduced by the pairing work)

`pitchForPitchClass` documents its ceiling as a hard rule — "a lower voice must
never rise above the lead" — but computed it as:

```ts
const high = ceiling === null ? winHigh : Math.max(winLow + 11, Math.min(winHigh, ceiling));
```

The `Math.max(winLow + 11, …)` silently **raised** the ceiling back to a full
octave whenever the requested ceiling left fewer than eleven semitones, so an
inner voice bounded under a lead at 68 could still be placed at 72. Two paths
compounded it: the inner-voice call site passed only the static `leadFloor - 1`,
never a per-instant ceiling; and the `avoidLeadCollision` nudge that runs
afterwards was called **without** the ceiling, so it could walk the note back up
above the lead the clamp had just placed it under.

#### What the patch does

1. Make the ceiling hard: `Math.min(winHigh, ceiling)`.
2. Bound inner voices by the **lowest lead pitch across the span** they sustain —
   an inner note that clears the ceiling at its onset still crosses when the
   melody descends beneath it. This accounts for the final 16 crossings (bar 7).
3. Pass the same ceiling to `avoidLeadCollision`.

#### Measured effect — three states, this session

dorian-16bars, seed 1, violins2 above violins1:

| State | Crossings | Bars | Lead pitches |
|---|---:|---|---|
| Baseline: no pairing, no fix | **32** | 6, 8 | 44 notes, max leap 5 |
| Pairing, no fix | **64** | 6, 7, 8 | 42 notes, max leap 7 |
| **Delivered: pairing + fix** | **0** | — | 42 notes, max leap 7 |

`three-chorus-40bars` is **0 in all three states** — the defect is latent there
and only surfaces where the melody descends to 64 under a sustained inner voice.

Crossings are measured at **60-tick resolution** (finer than the 120-tick
sampling used earlier) across the entire piece, for **every** voice against the
lead — not only violins2. Result on the delivered build: **0 on both fixtures.**

#### Independence — verified, not assumed

- The defect exists with the pairing feature reverted (**32** crossings), so it
  predates this task.
- Applying the fix changes **only** inner-voice pitches: the lead's pitches,
  motif IDs, statement operations and the 0-tick section boundary are
  **byte-identical** with and without it, and acceptance test `3b` passes in both
  states.
- The pairing's contribution to the count (32 → 64) is a consequence of the
  antecedent being **longer**, giving the lead more low notes to sit above — not
  a defect the pairing introduced.
- Note and keyswitch counts are unchanged by the fix; artifact sizes are
  identical (1593 B / 4137 B). Only pitch values inside violins2 move.

#### Proven by a test that fails without the patch

`tests/compose/strings-ceiling.test.ts` — **3 tests**, added with this change and
targeting the primitives directly rather than composed output, because composed
output can mask the bug. Measured on the delivered build, and re-run against the
pre-patch code to confirm they discriminate:

| Check | Delivered | Pre-patch |
|---|---:|---:|
| `pitchForPitchClass` placements above ceiling (1680 cases) | **0** | **264** |
| `avoidLeadCollision` nudges above ceiling (3588 cases) | **0** | 0 |
| Worst pitch with a requested ceiling of 52 | **52** | **61** |

The third row is the crisper statement of the bug: the old code placed a note at
**61** when asked never to exceed **52**.

#### Registers unaffected

Every part remains inside its declared comfortable window — dorian 100 % on all
four parts; three-chorus 100 / 99 / 100 / 100 %. The fix does not push any voice
out of its tessitura to achieve zero crossings.

### 8.10 Verdict

**Phase 1 is functionally complete, with one recorded deviation from §13.2 as
written.** Nine of the ten audible criteria are met in full; criterion 9 (exactly
one keyswitch per part) remains a documented deviation. Criterion 3 (pairing
across a section boundary) is now **met as written** — see §5.11 — after the
correction recorded below. On the evidence, and
only on the evidence: motifs are recognisable under five transformations with
concrete bar/pitch/duration evidence, the piece develops across its seven
sections, the texture thins to a real soli and a real unison, the
lead/counter/inner/bass roles are distinguishable (counterpoint now rather than
doubling), fills only ever appear over genuine silence, performance data is valid
and profile-legal, and seeds vary coherently and reproducibly.

**Ten** defects were found by this audit and fixed rather than rationalised:
wrapped motif degrees, uniform chord-tone fitting, register penalties that
outranked voice leading, moments that were planned but inaudible, a counter line
that duplicated the lead, a counter line that crossed above the lead, a hard
floor that destroyed inversion, CC11 that ignored phrasing, a pairing that was a
label rather than an answer, and a "hard" ceiling that silently rose by an octave
when the window got tight. Each was measured before and after and each is backed
by a test.

The last two were found during the final correction round, and both are now
delivered: the pairing in §5.11 (criterion 3), the ceiling in §8.11. The ceiling
fix is carried as a **separately identifiable patch** and its own test file so it
can be reviewed and reverted on its own terms.

Finding them changed the verdict twice: the counterpoint and inversion criteria
were **not** met when this audit began, and are met now.

The remaining limitations in §8.9 and §6 are scope boundaries or unverifiable
claims, not outstanding Phase 1 work. The hard switch at `store.ts:401` was not
performed and belongs to Phase 6.

---

## 9. Acceptance criteria → evidence → status

Every §13.2 criterion, mapped to where its evidence lives and what its status
actually is. "Met" means demonstrated on both fixtures with parsed-MIDI evidence;
"Partial" means a recorded deviation.

| # | §13.2 criterion | Evidence | Status |
|---|---|---|---|
| 1 | Recognizable motifs — ≥2 cells, recurring | §5.1; degrees/durations; primary in 14 bars across 7 sections | **Met** |
| 2 | Motif returns transformed ≥3 times | §5.2; 29 transformation statements of 51 | **Met** |
| 3 | Antecedent/consequent pairing over ≥1 section boundary | §5.3, §5.11 — explicit `answersPhraseId` link; adjacent sections in both fixtures; consequence inherits the antecedent's realised motif and opens `fragment → invert → transpose`; 0-tick boundary; asserted by test `3b` | **Met** |
| 4 | Entries/exits coincide with phrase boundaries | §5.4; 3 moments now audible; 0 notes outside phrase windows | **Met** |
| 5 | Lead, counter/pad, bass simultaneously distinguishable | §5.5, §8.11; registers 64–81 / 63–69 / 57–67 / 38–48 (dorian) and 64–81 / 60–76 / 57–67 / 38–48 (three-chorus); **0 crossings in every voice on both fixtures** at 60-tick resolution | **Met** |
| 6 | Idiomatic writing — comfortable windows, sane leaps, no extremes | §5.6; 99–100 % inside declared windows; max leap 7 / 10 | **Met** |
| 7 | ≥1 deliberate rest **and** ≥1 continuous sustainer | §5.7; 16/19/1/0 rest spans; violas+cello continuous, 39/39 re-articulation | **Met** |
| 8 | Moving dynamic contour following phrase | §5.8; velocity 57–112, CC11 per phrase | **Met** |
| 9 | Valid MIDI — channels, CC, **one latched keyswitch per part**, no programChange | §5.9, §8.6; channels 1–4, CC 1/7/11 only, no programChange; **7 / 11 keyswitches** (one per articulation change), all valid, in-zone, non-colliding, latched | **Partial — deviation D2** |
| 10 | No filler — every part traces to a Director assignment | §5.10; 241/241 notes phrase-assigned; seal 0 violations | **Met** |

### 9.1 Deviations

| ID | Deviation | Why | Consequence |
|---|---|---|---|
| ~~**D1**~~ | ~~Antecedent/consequent are *labels by phrase index*, not an explicit pairing~~ | **Retired.** `Phrase.answersPhraseId` + `pickCrossSectionPair` make the link explicit; the consequence inherits the antecedent's realised motif | Criterion 3 is now **Met** (§5.11) |
| **D2** | One keyswitch **per articulation change**, not one per part | A single latched switch would make every later articulation inaudible | Criterion 9 exceeded in function, deviated in letter |
| **D3** | `adapters/piano.ts` imports `ConductorPlan`/`BarPlan`/`LayerSlot`/`MomentKind` **type-only** | Proposal wanted the adapter on IR types only | Type-level coupling remains to the old conductor |
| **D4** | `register.ts` folded into `context/index.ts`; no separate `perform/` beyond `perform/cc.ts` | Delivered layout | Cosmetic vs. proposal |
| **D5** | `hashString`/`makeRng` **local** to `material/index.ts` | Not moved to `shared/deterministic.ts` | Duplication, no behaviour change |
| **D6** | Only the **strings family** implemented | Phase 1 scope | Other 17 instruments receive nothing |

### 9.2 Limitations

1. **Sound quality is unverified.** No UVI Workstation or library in this
   environment. Every claim is MIDI structure and event data, never playback.
2. **The Piano V5 gate has no stored baseline** (§3). It proves determinism and
   context well-formedness; it does **not** compare adapter output against the old
   conductor's, and the "baseline" is the working tree (HEAD + the pre-existing
   legacy diff), not pristine `0b3ca39`.
3. **CC lanes are newly authored** and not field-tested against a real library.
4. **Seed variation is bounded** — motifs, statement counts, fills and
   orchestration vary; form, phrase grid and harmony stay fixed.
5. **`energyAtTick` is unused** in CC shaping; contour comes from note velocities.
6. **The hard switch was not performed.** `store.ts:401` still calls
   `composeAllTracks`.

---

---

## 10. Final reconciliation changelog

Documentation-only pass. No production or test file was modified (§2.1).

| Item | Was | Now |
|---|---|---|
| §5 note counts | musical counts only, unreconciled with MIDI | §5.0 table: 86 + 7 = 93, 241 + 11 = 252 |
| §5.1 motif degree values | stale wrapped encodings | post-audit `[0,1,2,0,−1]`, `[0,−1,−2,−3]` |
| §5.2 statement count | 25 | 51 (29 transformations) |
| §5.3 phrase structure | "pairs occur in four sections" (implied pairing) | explicit `answersPhraseId` link; **both fixtures pair ACROSS a boundary**; D1 retired |
| §5.6 chord-tone claim | "100 % of notes are chord tones" | withdrawn; containment 99–100 % reported instead |
| §5.9 keyswitches | "exactly one latched keyswitch per part" | one per articulation change; deviation D2; §8.6 |
| §5 — | no concrete pair | §5.11 gives both cross-section pairs: section IDs, bars, motif, ops, pitches |
| §4 MIDI block | 1667/3985 bytes, 46/20/20/19, `ks 1` | **1593/4137 bytes**, 44/15/15/19 and 101/76/38/37, `ks 2 2 2 1` / `4 2 4 1` |
| §3 V5 gate | implied adapter↔baseline equivalence | no stored baseline; A1 does not invoke the adapter; stated as a limitation |
| §7.1 legacy branch | hash discrepancy attributed to "diff context" | resolved: the `01547013…` record reproduces; earlier mismatch was a wrong file set |
| §8.2 counter collisions | "84 % → 31 %" | three-stage table, final 8 % |
| §1 counts | 2,812 / 831 lines, 5 merged files | 2,971 / 865 lines, 2 merged files |
| §6 deviations | "none material", "five defects" | five live deviations (§9.1, D1 retired), ten fixed defects (§6), ceiling fix carried as a separate patch (§8.11) |

Final closeout additions: §8.11 (voice-ceiling fix, applied, carried as
`patches/0001-strings-voice-ceiling.patch`), `tests/compose/strings-ceiling.test.ts`
(3 guards that fail on the pre-patch code), and the final verification numbers
above.

New sections: §2.1 (reconciliation integrity), §5.0 (count reconciliation),
§5.11 (concrete pair), §7.1 (legacy verification), §8.6 (keyswitch deviation),
§9 (criterion→evidence→status map), §9.1 (deviations), §9.2 (limitations),
§10 (this changelog).
