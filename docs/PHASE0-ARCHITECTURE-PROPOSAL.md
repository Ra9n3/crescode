# Phase 0 (rev. 4 — FINAL) — Architecture proposal under approved decisions

**Status: READ-ONLY architecture approval.** No implementation, no source changes,
no test changes, no engine disconnection, no Piano V5 modification.

Scope and preservation safeguards unchanged. The only Git operation performed
remains Decision 3's preservation, verified in §2.

### Corrections incorporated in this revision

| # | Correction | Where |
|---|---|---|
| 1 | Remove the mandatory two-family minimum; participation validated against actual available tracks | §6.2, §13.1 |
| 2 | Project tracks define the roster; Director decides for every eligible track; templates prefer/constrain but never add tracks; **Compose All never creates tracks** | §9 |
| 3 | Refine material/Director/family boundaries so families may idiomatically adapt abstract material without inventing content | §4.2, §6.4 |
| 4 | Byte-identity when effective inputs are equivalent; distinguish expected change from adapter regression | §7.7 |
| 5 | Variation is plan-level and need not force change everywhere | §10 |
| 6 | Strengthened Phase 1 audible acceptance criteria | §13.2 |
| — | Removed "a part that never rests is a bug" | §6.2 |

---

## 0. Decisions carried forward (unchanged)

| # | Decision |
|---|---|
| 1 | New engine owns **all** instrument roles; **no** generic-generator fallback |
| 2 | `roleNotes`/`doubleOf`/`excludeRoles` ownership model **not** carried over |
| 3 | Four-file diff preserved on `legacy/orch-fixes` ✔ |
| 4 | **No** enrichment of `layerInformation`; Piano V5 unchanged |
| + | `shared/deterministic.ts` extraction; `generation-rules.ts` is old musical content |

---

## 1. Old-engine state, call graph, and the hard switch

### 1.1 Seam

```
store.ts:382  composeAll()            ← UI
store.ts:401  composeAllTracks(...)   ← ★ HARD SWITCH: one identifier
store.ts:406  edit(p => ({tracks, orchestration}))  ← one atomic undo step
```

`composeAllTracks` is pure (project in, result out). `composeOrchestra` inherits
that property, which makes lock-safety and single-step undo structural.

### 1.2 Ownership today

| Roles | Current final writer |
|---|---|
| strings (vln1/2, vla, vc) + **a created `basses` desk** | `stringsModule`, `basses.ts` |
| horns, trumpets, trombones, tuba | `renderBrass` |
| flutes, oboes, clarinets, bassoons | `renderWinds` |
| timpani, snare, cymbals, aux | `renderPercussion` |
| harp | keys renderer |
| piano | **Piano V5** |
| **all others / template-free** | `generate()` fallback (`compose.ts:805`) |

### 1.3 Hard switch procedure (phase 6, later)

1. `composeOrchestra(project, options): ComposeResult` — same shape.
2. `store.ts:401`: one identifier changes. Nothing else.
3. Old tree leaves the reachable graph; files remain. Lint rule:
   `src/compose/**` may import `src/orchestrator/keys/**` only.
4. Old musical suites quarantined (§11), never re-pinned.
5. `shared/deterministic.ts` extraction lands **before** step 2
   (`piano-engine.ts:6` imports `hashString` from `engine/generate`).

Reversal is one `git revert`.

---

## 2. Decision 3 — preservation, completed and verified

**Branch:** `legacy/orch-fixes` → `3a4aa6d`, parent `0b3ca39`. Not pushed.

| Safeguard | Result |
|---|---|
| 1. State verified first | `arena/c6eef56a-crescode` @ `0b3ca39`; 4 modified, 3 untracked, nothing staged |
| 2. Diff is exactly the documented one | pre-op sha256 `01547013…7309`, 176 lines, 4 files, +86/−8 |
| 3. Preserved without modification | **post-op re-diff sha256 identical — byte-identical** |
| 4. Nothing overwritten or discarded | temp-index plumbing; HEAD, real index, working tree untouched |
| 5. Branch holds the expected diff | 1 commit, 4 files, 0 added, per-file blob hashes equal working tree |

Method: `GIT_INDEX_FILE` → `read-tree 0b3ca39` → `add` (4 files) → `write-tree` →
`commit-tree` → `branch`. Purely additive. The diff remains **both** recorded on
the reference branch **and** in the working tree, as instructed.

---

## 3. New engine — module architecture

Nothing under `src/compose/` imports `src/orchestrator/**` except `keys/**`, only
inside `adapters/piano.ts`. Lint-enforced. **Nothing renamed or moved from the old
tree; every module newly written.**

```
src/compose/
  context/     harmonic.ts  form.ts  meter.ts  energy.ts  tension.ts  register.ts
  material/    motif.ts  phrase.ts  rhythm.ts  develop.ts  counter.ts  harmony.ts
  director/    plan.ts  roles.ts  participation.ts  density.ts  moments.ts  fills.ts
  families/    strings.ts            ← phase 1
               winds.ts  brass.ts  percussion.ts  harp.ts   ← later
  perform/     articulation.ts  dynamics.ts  cc.ts  validate.ts
  ir.ts          shared musical representation (§4)
  compose.ts     layer orchestration (pipeline, not the seam)
  compile.ts     IR → Track[] + PianoEngineInput
  adapters/      piano.ts   OrchestraPlan → ConductorPlan (V5 only)
  seal.ts        invariant enforcement
  index.ts       composeOrchestra(project, options): ComposeResult   ← the seam
```

---

## 4. Shared musical representation (IR)

`src/compose/ir.ts`. Independent of `ConductorPlan`, Piano V5's score, and
`Track[]`.

```ts
interface OrchestraScore {
  readonly meta: {
    readonly seed: number; readonly take: number;
    readonly inputHash: string; readonly engineVersion: string;
    readonly templateId: string | null;   // null is fully supported (§9)
    readonly rosterHash: string;          // identity of available instrumentation
  };
  readonly grid: MeterGrid;
  readonly sections: FormSection[];
  readonly harmony: HarmonicSpan[];
  readonly energy: EnergyPoint[];
  readonly tension: TensionPoint[];
  readonly motifs: Motif[];
  readonly phrases: Phrase[];
  readonly plan: OrchestraPlan;
  readonly parts: MusicalPart[];
}
```

**Sections and phrases** carry function (`opening|continuation|culmination|
contrast|closing|reprise`), so structure is explicit rather than implied.

**`Motif`** is the unit of thematic identity: a seeded cell of rhythm + pitch
contour, with development operations recorded as transformations
(`transpose | invert | fragment | augment | displace | reorchestrate`) and a
parent link, so development is auditable rather than opaque variation.

### 4.1 `MaterialPhrase` — the abstract material contract

The boundary between composition and orchestration. It is **abstract**: it names
no instrument and fixes no register.

```ts
interface MaterialPhrase {
  readonly phraseId: string;
  readonly materialRole: MusicalRole;      // lead|counter|inner|bass|pulse|pad|accent|fill
  readonly startTick: Tick; readonly endTick: Tick;
  /** Contour + rhythm cell; pitch class or interval, register-agnostic. */
  readonly cell: Cell;
  readonly events: AbstractEvent[];        // onsets, durations, scale degrees / pcs
  readonly dynamic: DynamicIntent;         // intensity envelope over the phrase
  readonly articulationIntent: ArticulationIntent;
}
```

### 4.2 What families MAY and MAY NOT do with material (Correction 3)

This is the correction that protects musical intelligence. A family engine is not
a pitch-range translator; it is an interpreter with idiomatic judgement.

**Families MAY:**
- place abstract material into their instrument's register band and comfortable
  window, choosing the octave where the line sits best;
- apply idiomatic articulation (`spiccato` vs `detache` for a short cell; bowing,
  breathing, tonguing, pedalling equivalents);
- adapt a cell to the instrument's idiomatic motion — string crossings, double
  stops, open-string-friendly spacing, natural harmonics where intended;
- distribute a pitch set across divisi within the family, when the absence of a
  divisi line would be less musical;
- adjust dynamics to the instrument's dynamic curve and its role in the texture;
- ornament or simplify a cell where idiom demands it, **provided the phrase's
  identity and contour survive**;
- choose to realise a phrase with fewer sounding voices on that instrument.

**Families MAY NOT:**
- invent material unassigned by the Director (no `phraseId` ⇒ rejected);
- change the phrase's function, its boundaries, or its position in the form;
- invent a second subject, counter-melody, or fill the Director did not plan;
- contradict the harmonic context (added notes must be chord/scale-legal for the
  span, or declared as a Director-approved extension);
- retime onsets beyond the phrase's rhythmic contract.

`seal.ts` enforces the MAY NOTs; the MAY list is deliberately open, because
over-constraining it would produce the mechanically correct but musically dead
output this project exists to avoid. Enforcement is at the level of *material
identity and harmonic legality*, not at the level of individual note placement.

---

## 5. Musical Context and Composition Intelligence (Layers 1–2)

### 5.1 Layer 1 — Musical Context

Chords and harmonic rhythm (project, primary; the engine may extend or substitute,
not discard), key/mode/tonic, sections and phrase boundaries, meter and tempo,
energy arc, tension/resolution, **register field** (`register.ts`: hard range,
comfortable window, idiomatic tessitura, preferred band per material role — one
shared definition read by every family and by `validate.ts`), and project
constraints (locks, band, ranges, project end).

### 5.2 Layer 2 — Composition Intelligence

Motif generation (seeded rhythmic/pitch cells); phrase construction
(antecedent/consequent over the form); development (transposition, inversion,
fragmentation, augmentation, rhythmic displacement, re-orchestration of the *same*
motif); call and response; countermelody derived from the lead's actual contour
and the harmony; harmonic support as voicing intent; tension/release cross-fades
to the context curve.

Output: `Motif[]`, `Phrase[]`, `MaterialPhrase[]` — instrument-agnostic.

---

## 6. Orchestration Director (Layer 3)

### 6.1 What the Director decides, before any family engine runs

Participation; material-role assignment; doubling (with a stated purpose);
register and density per section and phrase; entries and exits; section
development; moments and fills.

### 6.2 Participation — relative, never absolute (Corrections 1 & 2)

The Director makes a participation decision for **every eligible track**. A
decision may be "plays", "rests this span", or "sustains throughout" — all are
legitimate outcomes recorded in the plan.

**There is no minimum number of participating families.** Support:

| Scale | Expected shape |
|---|---|
| **solo** | 1 instrument; the material carries the piece alone |
| **duo** | 2 instruments; complementary roles, call/response |
| **chamber** | 3–6; lead + support + bass, with real rests |
| **full orchestra** | 10+; layered roles, coordinated entries |

Participation is validated **relative to the actual available tracks and the
musical context**, never against a fixed family count:

- if the project has one eligible track, a solo texture is correct, not a defect;
- if a section's energy and function call for thin texture, few players is
  correct;
- if an instrument is available, in-band, and the Director has no musical reason
  to rest it, material for it is expected.

**Continuous playing is legitimate.** A sustained pad, drone, or texture role may
play throughout a section or the whole piece. There is no rule that a part must
rest; under-participation is judged against available tracks and musical intent,
per section.

### 6.3 Double Basses — the roster question (Correction 2, concrete)

**Verified in this repository:** `INSTRUMENTS` has 21 entries and **no `basses`
role**; today the old pipeline *creates* a `basses` track (`basses.ts`,
`makeTrack`, `BASSES_TRACK_ID = 'trk_basses'`) whenever the cello/bass split
engages. That is a Compose-All-created track.

Under Correction 2, **the new engine must not do this.** Two compliant outcomes:

- the project already contains a track with role `basses` (added by the user) →
  the Director writes it like any other track; or
- the project does not contain one → **no basses line is created.** The lowest
  available low instrument carries the bass role. If the cello is the only low
  instrument, the cello carries it.

A user who wants a basses desk will have one in their project. This is a
deliberate, user-visible behaviour change from today, and it will be stated as
such in the switch report. **The Director never mints a `Track`.**

### 6.4 Family realization boundaries

Governed by §4.2: families interpret abstract material idiomatically and may not
invent content. The Director owns *what* is played and *by whom*; the family owns
*how that instrument idiomatically plays it*.

### 6.5 Anti-defect rules encoded in Director + `seal.ts`

| Old defect | Structural prevention |
|---|---|
| instruments at extreme range | register band from the comfortable window |
| unnatural leaps | `validate.ts` leap budget per material role |
| unforced octave doubling | doubling requires a recorded purpose |
| divisi silently disappearing | planned span with zero events fails the seal |
| empty/underdeveloped sections | judged **relative to available tracks and context** (§6.2) — no fixed family minimum |
| repeated articulation noise | articulations latched per phrase |
| uncoordinated instruments | events must resolve to an assignment (§4.2) |
| repetitive arrangements | variation operates on the plan (§10) |

---

## 7. Piano V5 compatibility adapter

**Piano V5 is unchanged.** No enrichment approved (Decision 4).

### 7.1 Non-conductor fields

`sections`, `harmony`, `energy`, `generationIdentity`, `template`, `rules`, and
`analysis` (from **finalized tracks**).

### 7.2 `layerInformation` — lead ownership per bar

Consumer: `piano-analyzer.ts:725–731` → `explicitLeadTrackIds` →
`momentDecision` → `'leave-space'` (`piano-composer.ts:1129`). **Semantics: which
track holds the melody this bar, so the piano yields.**

Adapter duties: real, finalized `trackId`s; `layer` from `LAYER_VOCABULARY`
(`lead, pad, ostinato, tremolo, counterline, bass, fill, stab, percussion, color,
sub, riser, texture`); `availability: 'partial'`, `annotatedFamilies`,
`totalCapacity: null`, `totalOccupiedLayers: null` and `unavailableReason`
preserved **verbatim**.

### 7.3 `moments` — section function, phrase cues, whether piano speaks

`piano-composer.ts:1120` (yield/support by `participantRoles`), `:2108`
(`tutti|unison` ⇒ `culmination`; `soli` ⇒ `contrast`), `:655` (phrase cues).
Filtered to `{tutti, soli, unison}`. Adapter maps `OrchestraPlan.moments` with
**honest `participantRoles`**.

### 7.4 `fillWindows` — genuine fills only

`:658` phrase cues; `:1089` `inPianoFill` ⇒ `'interweave'`;
`piano-analyzer.ts:501`. Filtered by `pianoTarget` (`'piano'` or case-insensitive
`'keys'`). Only Director-planned fills; no fabrication, no placeholders.

### 7.5 `barWindows` — mechanical, must be exact

Piano filters `bar.sectionId === section.id` and requires windows **contained**
in their section (`startTick >= section.start`, `endTick <= section.end`), or bars
orphan from every phrase. Derived mechanically.

### 7.6 Semantic weight

| Field | Weight | Stubbed ⇒ |
|---|---|---|
| `barWindows` | none | bars orphaned from phrases |
| `layerInformation` | **high** | piano never yields to the lead |
| `moments` | **high** | wrong section function; cues lost |
| `fillWindows` | medium | fill behaviour inverted |

### 7.7 Byte-identity gate, refined (Correction 4)

The previous revision demanded unconditional byte-identity, which is wrong: when
the new orchestration legitimately changes the piano's musical context, the piano's
output **must** change.

Define **effective input** = the complete, immutable `PianoEngineInput`
(`context` + `analysis`) handed to V5. Then:

**A. Equivalence gate (adapter regression test).**
For any case where `effectiveInput(new) ≡ effectiveInput(old)`, V5's output —
piano notes, velocities, and the CC64 lane — must be **byte-identical** to `HEAD`.
Failure ⇒ **adapter regression**. This isolates adapter correctness from musical
change and is the gate that runs **before** phase 1 code, using synthetic inputs
that bracket the baseline (captured from `HEAD`) through the adapter.

**B. Expected-change gate (integration test).**
When the context differs (different lead bars, moments, fills, or a different
finalized ensemble), piano output is **expected to differ**. The test asserts:
- V5 completed without error and without falling back;
- invariants hold (playable range, suspensions, pedal sanity, note count within
  a documented band);
- the **delta is explainable**: every difference traces to a changed input field,
  recorded in the report.

**C. No silent drift.** A case that is neither equivalent (A) nor explainable
(B) fails. There is no "approximately equal" category.

This keeps Piano V5 untouched while making regressions distinguishable from
intended musical response.

---

## 8. Shared infrastructure and legacy boundaries

### 8.1 Reuse freely

`shared/schema/*` · `config/ensembles.ts` · `specs/ensemble-templates/*.json` ·
`fixtures/*` · `export/midi.ts` (reads only `notes`, `cc`, `name`) ·
`export/profile.ts` · `export/profiles/uvi-orchestral-suite.json` · store
`edit`/`undo`/`redo` · `suggestion/*` · React UI.

**Note on fixtures:** `dorian-16bars.json` etc. have **zero tracks**; the
instrument set comes from the default project factory (21 instrument tracks) or
from the user's project. Template rosters do **not** create tracks. This
distinction is central to §9.

### 8.2 `engine/generate.ts` — separated conceptually (not executed)

`hashString`/`mulberry32`/`sanitizeNotes` → `shared/deterministic.ts`, behaviour
preserved verbatim. `roleNotes`/`doubleOf`/`excludeRoles` → **dropped**
(Decision 2). `config/generation-rules.ts` → old musical content, never a new-engine
dependency. **Compatibility constraint:** `piano-engine.ts:6` imports
`hashString` from it, as do `export/profile.ts`, `audio/mapping.ts`,
`PianoRoll.tsx`, `StatusBar.tsx`, `suggestion/host.ts` — extraction is a pure move
plus import-path update, verified by hash equality. No file deleted this phase.

### 8.3 Interpreter disposition

Under Decision 1 the fallback's musical job is gone. Recommendation: retire with
the old engine, keeping only §8.2's utilities. Deferred; verified against a real
template-free composition before acting.

### 8.4 Old engine — no reuse

`render · compose · conductor/ · voicing/ · lines/ · brass/ · winds/ ·
percussion/ · strings/ · basses · expression/ · energy/ · spine/ · profiles/`.
No renaming, no relocation, no algorithm carried across.

---

## 9. Template-free and template behaviour (Corrections 1 & 2)

**The roster is the project. Full stop.**

1. **Available instrumentation = the project's existing instrument tracks.**
   Compose All reads them and **never creates, deletes, or renames a track.**
2. **The Director makes a participation decision for every eligible track** —
   `plays`, `rests this span`, or `sustains throughout`. Every track gets a
   decision; "eligible" means it is a real instrument track that is not locked and
   not explicitly excluded.
3. **Templates express preferences and constraints, not membership.**
   A template may declare legitimate exclusions (this ensemble does not use tuba),
   density/budget limits, preference orderings, and rules such as doubling policy.
   It **cannot add a track**, **cannot create a roster**, and **cannot be the
   reason an available track is silently ignored** — an exclusion must be an
   explicit, inspectable template statement, recorded in the plan report.
4. **Without a template:** the Director builds a default participation scheme from
   the available tracks — highest string voices lead, middle voices support, low
   voices take bass; winds/brass enter by energy band; percussion by accent need;
   keys/harp by texture need. This must produce a complete orchestration.
5. **Band pins/overrides** (project-level user intent) are honoured as *user*
   constraints, distinct from template constraints, and are also recorded.

**Acceptance tests:** (a) template-free project with only 2 string tracks →
coherent duo; (b) template-free full default project → complete orchestration with
every eligible track receiving a decision; (c) chamber template on a full project
→ exclusions explicit and reported, no tracks added or removed; (d) any project →
`tracks.length` identical before and after Compose All.

---

## 10. Variation and deterministic generation (Correction 5)

- `inputHash = hash(roster, key, mode, meter, tempo, chords, sections, options)`;
  streams salted per decision domain (`motif`, `phrase`, `director`, `fill`,
  `humanize`), so one decision changing does not reshuffle everything.
- **Same seed + same input ⇒ identical output.**
- **Different seeds ⇒ meaningful plan-level variation**, drawn from the
  *structural* choice set: motif selection and its development operations, phrase
  pairing, participation emphasis, density contour, moment and fill placement,
  doubling choices.
- **Variation is not required to touch every part or section.** A different seed
  may legitimately leave large regions identical and vary the climax, the
  counterline, or the texture of one section. What is forbidden is *uniform,
  untargeted reshuffling*, and equally forbidden is *no audible difference*.
  Acceptance: across seeds, plan-level choices differ measurably (motif identity /
  development ops / participation pattern), and at least one structurally
  significant region differs; not "every track changes".
- **Coordination:** all variation flows through `OrchestraPlan`, so correlated
  parts change together.
- **Reproducibility:** `seed`, `take`, `inputHash`, `rosterHash`, `engineVersion`
  recorded in artifacts and reports.

---

## 11. Test preservation and migration

80 suites; 51 reference the old engine. **Nothing deleted this phase.**

| Class | Suites | Action |
|---|---|---|
| ① Old-engine musical behaviour | conductor, lines, voicing, energy, compose, compose-failure, phase3-listening, phase4-matrix, phase45–48, phase4a/b, phase5, phase5a-staircase, phase5b-contour, phase5c-cc, phase5d-humanize, phase5e-matrix, phase51, phase55, phase56, phase6, phase7, phase8, phase81–83, phase9, phase10, phase12, brass, strings-articulation, variety-invariants, orchestration-seed | quarantine at switch; never re-pin |
| ② Shared infra / project contract | band, browser-globals, chord-spans, ensemble-template, export, follow, generate, key-transpose, mixer, mode-transform, orchestration-schema, schema, seed-dump, transport-model, suggestion-* (11) | **preserve — regression net** |
| ③ MIDI / export | export, uvi-piano-profile, harp-regression, seed-dump | preserve, re-point |
| ④ Piano V5 integration | piano-engine-v5, -production, -stage3-development, -v3-textures, -v4-musical-quality, piano-score-stage1, piano-stage4-contextual-techniques, -stage4a-contextual-accompaniment, piano-texture-theme, piano-dynamic-alignment, piano-variation-support | preserve; 10 of 11 use `composeAllTracks` as a *fixture builder* → fixture re-point, not rewrite |
| ⑤ New-engine equivalents | property-intent subset of ① | new tests against the IR |

**Preservation rule:** no ① suite retires until its intent is covered by a ⑤ test
or explicitly listed as no longer required, with a reason. `variety-invariants`
already fails at `0b3ca39` — pre-existing, unrelated.

---

## 12. Hard switch at Compose All

Per §1.3. One identifier; same `ComposeResult`; old tree out of the reachable
graph but not deleted; lint-enforced boundary; suites quarantined by class;
reversible by `git revert`. **Post-switch invariant added by Correction 2:** Compose
All never changes `tracks.length`. Recorded as a test and stated in the switch
report, because it is a user-visible behaviour change (no auto-created basses desk).

---

## 13. Implementation sequence and Phase 1 acceptance

### 13.1 Phases

| Phase | Content | Result |
|---|---|---|
| **0** | this proposal + §2 preservation | — |
| **1** | IR, context, `register.ts`, Director skeleton, strings family, `perform/`, `compile`, `seal`, `adapters/piano`; **piano equivalence gate first** | **first audible slice** |
| **2** | Composition intelligence depth: development, phrase functions, call/response | audible |
| **3** | Director depth: density curves, entries/exits, moments, fills, coordination | audible |
| **4** | Strings performance: articulation from intent, CC, playability | audible |
| **5** | `shared/deterministic.ts` extraction + interpreter disposition | no behaviour change |
| **6** | **Hard switch**; quarantine ①; re-point ③④ | switch |
| **7** | winds → brass → percussion → harp | audible |
| **8** | Musical-quality harness across seeds × fixtures × templates | — |

Ordering in phase 1: capture piano baseline → IR/context/compiler → adapter →
equivalence gate (§7.7A) → strings → verify → export.

### 13.2 Phase 1 audible acceptance criteria (Correction 6)

Architecture that produces notes is not acceptance. The first slice must
**compose**. All of the following are demonstrated on a real fixture, exported to
MIDI, parsed back, and inspected beyond the opening bars:

1. **Recognizable motifs** — at least 2 distinct cells identifiable in the output;
   the same cell recurs, so a listener could name it.
2. **Phrase development** — a motif returns *transformed* (sequence, inversion,
   fragmentation, augmentation) at least 3 times, with the transformation recorded
   in the plan and audible in the notes.
3. **Phrase structure** — antecedent/consequent pairing over at least one section
   boundary; phrase boundaries align with section ends.
4. **Coordinated participation** — entries and exits coincide with phrase
   boundaries; parts change together rather than drifting independently.
5. **Distinct musical roles** — lead, counter/pad, and bass are simultaneously
   identifiable and distinguishable in the output.
6. **Idiomatic string writing** — within comfortable windows (§5.1); leap
   distribution sane; no instrument pinned at a range extreme; bowing/articulation
   appropriate to the material.
7. **Rests** — at least one deliberate rest span, stated in the plan; **and** at
   least one role that legitimately sustains continuously (§6.2), demonstrating
   both are handled musically.
8. **Dynamics** — a moving dynamic contour (intensity intent → velocity), not a
   flat band; dynamic shape follows phrase contour.
9. **Valid MIDI export** — exported through the existing UVI profile, parsed back:
   correct channels, notes, CC lanes, one latched keyswitch per string part inside
   its zone, no `programChange`.
10. **No filler** — no track receives material purely to make the file non-empty;
    every part traces to a Director assignment.

**Honest limit:** these are structural and musical-property checks on a MIDI file.
I cannot verify it *sounds* good — no sound library here — and will say so in the
report rather than implying otherwise.

---

## 14. Files added, modified, preserved, retired

**Added — new engine:** `src/compose/{ir,compose,compile,seal,index}.ts`;
`context/*` (6); `material/*` (6); `director/*` (6); `families/strings.ts`;
`perform/*` (4); `adapters/piano.ts`. ~25 files at phase 1, ~35 at full scope.

**Added — shared:** `src/shared/deterministic.ts` (extracted verbatim, phase 5).

**Added — tests/docs:** `tests/compose/*.test.ts`; `docs/compose-engine.md`.

**Modified:** `src/store/store.ts` (one identifier, phase 6);
`export/profile.ts`, `audio/mapping.ts`, `components/PianoRoll.tsx`,
`components/StatusBar.tsx`, `orchestrator/keys/piano-engine.ts` — **import path
only** (`engine/generate` → `shared/deterministic`), behaviour-identical.

**Preserved unchanged:** Piano V5's 18,220 lines; all 80 suites (until switch);
old engine source on disk; `legacy/orch-fixes`.

**Retired eventually (files remain until then):** the 14 old-engine modules
(§8.4); `config/generation-rules.ts`; §8.3 interpreter; ① suites after ⑤ coverage.

---

## 15. Risks

1. **Piano regression via adapter** → §7.7A equivalence gate before phase 1 code.
2. **`engine/generate` deletion breaks Piano** (`piano-engine.ts:6`) → §8.2 first.
3. **Template-free regression** → §9 with four explicit acceptance tests.
4. **Basses desk no longer auto-created** → user-visible change; documented,
   tested, and reported at switch (§6.3, §12).
5. **Suite collapse misread as catastrophe** → ① quarantined and reported apart.
6. **Over-constraining families kills musicality** → §4.2 enforcement deliberately
   limited to material identity and harmonic legality.
7. **Comfortable register rebuilt inconsistently** → single `register.ts`,
   enforced by `validate.ts`.
8. **Musical quality unmeasurable** → phase 8 property harness; no claim of
   musical success from a passing test.

---

## 16. Assumptions and confirmations

- **Unverifiable here:** no sound library / UVI Workstation — MIDI **structure** is
  verifiable by parsing, **sound is not**.
- `node_modules` absent: no number in this document comes from a run this session.
- No reference corpus for "professional quality" — judged against the §6 defect
  list and musical judgement.

**One non-blocking confirmation (phase 5):** retiring the generic interpreter
(§8.3) rather than keeping it vestigially. Re-verified against a real template-free
composition before acting.

No implementation started. No source, test, or Piano V5 changes. Awaiting final
approval.
