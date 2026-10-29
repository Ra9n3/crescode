# Crescode Harmony Diagnostics — Technical Analysis (Phase 4.2)

**Scope:** why the Phase 4.1 chord generator produced the reported E Aeolian progression
(`Esus4 → Gsus4 → C → Bsus4 → Bm → G → Abm → …`), answered from recorded
diagnostic evidence, not speculation. No generation rule was changed in this phase.

---

## 1. Reproduction

```bash
npm run harmony:diagnose -- --project fixtures/example-e-aeolian.json --seed 34
npm run harmony:diagnose -- --seed 42 --format json --out diagnostics/harmony/run42.json
```

- Committed example run: `diagnostics/harmony/e-aeolian-seed34.{txt,json}`
  (`Em7 → Bsus4 → Esus2 → Bm7 → Gmaj7 → Abm7 → C → …`).
- **Documented difference from the original screenshot** (spec §16): the exact seed and
  settings that produced the screenshot are unknown. The fixture reconstructs the closest
  available configuration — E Aeolian, 4/4, Verse(8) + Chorus(8), default settings
  (complexity 2, borrowing `some`, variation 0.5). A seed sweep (1–60, same fixture) shows
  the reported failure shapes recur across many seeds: a suspended opening in ~⅔ of runs,
  `Abm` selected in 8 of 60 runs, and — see §4 below — **29 of 29 transitions being
  structural foundation changes in essentially every run**. The analysis cites seed 34
  (which exhibits all reported shapes) and seed 42 (suspended chords in all four phrases).

Evidence below quotes the report's own fields. Numbers are the actual recorded values
(`structure.slots[].selectedCandidateScores.transitionParts`, `…positionParts`,
`structure.windows[].selection`, `color[]`, `transitions[]`), not recomputations.

---

## 2. Q1 — Why are suspended chords appearing so frequently?

**They are structural choices, not color operations.** This is now proven, not assumed:

- Architecturally, the color stage *cannot* create a suspension: colors are grouped by
  foundation identity, and a sus symbol's own core (root+2/5) is a *suspended* foundation.
  The regression tests pin this: `operation.suspensionIntroduced === false` for every event
  in a 20-seed sweep, and every emitted sus symbol's foundation id equals its chord's core.
- In the seed-34 run, `structure.slots` shows the search itself selected **7 of 30 slots on
  suspended foundations** (`B suspended`, `E suspended`, `D suspended`, `C suspended`,
  `G suspended`), and the color stage emitted them as *identity* colors (E suspended has
  exactly one color at complexity 2: `Esus2`). The reported `Esus4/Gsus4` openings were
  therefore produced by the same mechanism: the structural selector chose suspended
  foundations, and the color stage had nothing else to emit.

**Why the structural selector likes them** (from `transitionParts`/`positionParts`):

1. **The phrase planner asks for ambiguity first.** In seed 34 the planned cadence
   intentions are `open` (verse#p0), `suspended` (verse#p1), `ambiguous` (verse#p2),
   `suspended` (chorus#p1) — the plan layer requests unresolved arrivals *before any chord
   is chosen* (report section `planning.phrases`). `foundationArrivalFit` then pays
   suspended quality +0.6 under a `suspended` intention (D suspended: arrival fit 1.20 →
   position part 1.08) and +0.3 under `ambiguous` (G suspended: fit 0.80 → position 0.72).
   The arrival slot carries these through `position = 0.9 × fit`, so a suspension wins
   arrivals outright.
2. **The quality-stability gap is tiny.** `deriveQualityStability` marks suspended
   *native* in E Aeolian (A–B–E is a diatonic sus2 sonority), giving it 0.5 vs 1.0 for
   major/minor. That difference is worth only ≈ **−0.07** per transition
   (`0.18 × (1.0−0.5) × (1.05−0.55·0.51)`), while the arrival-fit bonus above is
   +0.3…+0.6 and the seeded jitter is ±0.06 (variation 0.5). A suspension therefore starts
   each contest nearly tied with a tertian foundation.
3. **The tension anchor flatters them.** `QUALITY_TENSION.suspended = 0.7` against a
   neutral phrase tension ≈0.51 yields `tensionFit ≈ 0.097` — essentially the same credit
   a minor chord receives (0.120). Nothing in the per-transition score says "an
   unresolved sonority is a weaker default than a triad when the phrase did not ask for
   ambiguity."

So: **the phrase planner requests ambiguity on interior phrases, and the arrival-fit and
quality tables make the requested ambiguity nearly free to satisfy** — even at openings,
where the only home preference is a +0.12/+0.07 opening bonus that any tonic-rooted
foundation collects (see Q4).

---

## 3. Q2 — Why was Ab minor selected in E Aeolian?

The seed-34 run selected `Abm7` at slot 5, following `Gmaj7`. The report gives the full
chain:

**Availability.** With borrowing `some`, the chromatic discovery (Phase 1 parallel-mode
facts) puts **52 chromatic foundations into the 70-foundation pool** (vs 17 foundations at
borrowing `none`). `Ab minor` (core Ab–B–Eb) is contained by the E **Ionian** and E
**Lydian** scales (`selected.modesContainingCore: "Ionian, Lydian"`), and it connects to
the tonic triad through B (core tone shared with E minor, `chromaticTonicTone +0.06`).

**Score** (`selectedCandidateScores.transitionParts` after G major):

| component | value | note |
|---|---|---|
| base | +0.200 | every foundation's floor |
| stabilityFit | +0.039 | 1 shared core tone (B) of 3 |
| movementFit | +0.084 | stepwise root motion, interval-class 1 → motion 0.7 |
| leadingTone | +0.039 | G is a semitone below Ab |
| stepwiseModal | +0.027 | stepwise motion × modalPref 0.53 |
| tensionFit | +0.119 | 'minor' quality anchor 0.5 ≈ phrase tension 0.51 |
| **qualityStability** | **+0.139** | **'minor' is the mode's identity anchor (E minor tonic) — the chromatic Abm receives the full 1.0 quality anchor because stability is keyed by QUALITY, not by root** |
| diatonicPreference | +0.05 | borrowing `some` — chromatic grade |
| chromaticTonicTone | +0.06 | shares B with the tonic triad |
| **total** | **0.756** (+ position 0.835, jitter +0.051) | |

**The contest was a photo finish.** The recorded alternatives of the winning expansion:
`C suspended 6.315 · Ab minor 6.291 [SEL] · B major 6.284 [beam-width] · C minor 6.266
[beam-width] · A major 6.255 [successor-cut] …` — four candidates within 0.05, i.e.
**inside the jitter band (±0.06)**. The candidates that lost did so to beam width, not to
any musical judgment.

**How the search treated it.** The final beam held 8 paths spanning totals 7.240–7.542;
the "strong" cutoff (12% of best − 0.05) admitted **all 8**, and the seeded pick chose
index 8 — the `[E minor › B suspended › E suspended › B minor › G major › Ab minor]` path.
Any of the eight could have won the seed roll.

**How the generator interpreted it: it didn't.** No subsystem classifies mid-phrase
chromaticism. `realizedFoundationFamily` (which would label it `chromatic`) runs only at
planned arrivals; slot 5 is a mid-phrase slot, so the chord was scored as an ordinary
stepwise root move. The diatonic/chromatic distinction in the entire transition score is
worth +0.2 vs +0.05 (+0.06 connection bonus) — a net **+0.11 preference for the diatonic
option**, smaller than one step of the jitter scale and far smaller than normal
transition differences.

**Root causes, ranked:** (1) the mode-relative quality stability being quality-keyed gives
every chromatic *minor* chord the tonic's own 1.0 anchor; (2) the diatonic preference being
small and flat; (3) the pool admitting 52 chromatic foundations that compete in every slot;
(4) close contests being decided by jitter and a seeded lottery over "strong" paths.

---

## 4. Q3 — Why does the harmony change when sustaining might be preferable?

The report states the model explicitly (`rhythm.continuationModelNote`): **the rhythm
planner always assigns exactly one foundation per slot; there is no sustain decision at
rhythm time.** The seed-34 numbers:

- Rhythm preference `2/bar (regular)` → **32 slots in 16 bars**; 2 same-foundation runs
  merged; **29 of 29 adjacent transitions are `structural-movement`** (0 color-variations,
  0 exact repetitions). The seed sweep shows the same picture in every run (26–31 moves
  out of 29–31 transitions).

Three mechanisms make "keep this harmony" the *worst-scoring* option at neutral settings:

1. **Transition scoring penalizes prolongation.** The same-foundation term is
   `+0.12·stability − 0.3·movement` = **−0.084** at the neutral (0.55/0.5) values, while
   any root change collects `movementFit` up to +0.117 (motion 0.8 class) — sustaining
   starts every contest 0.2 behind.
2. **The path evaluator rewards root churn.** The movement-diversity component targets
   `distinctRatio = 0.35 + 0.55·movement ≈ 0.625` — i.e. the *ideal path* changes the root
   in ~5 of 8 slots. A sustained passage is scored as a failure of this fit even when the
   phrase is stable.
3. **Continuation exists only post-hoc.** Merging requires the selector to re-choose the
   same foundation, which (1) and (2) discourage; the rhythm layer itself never says
   "sustain this bar" (slots #20, #28 in the seed-42 run are the rare merged cases).

So the harmony changes at every slot not because a planner demands chord changes, but
because **continuation is the only option with no advocate anywhere in the scoring
pipeline**.

---

## 5. Q4 — Is tonal-center establishment being meaningfully evaluated?

**Partially, and weakly.** The actual mechanisms, from the report:

- *Opening*: `foundationTransitionScore` (prev = null) adds +0.12 for a tonic root and
  +0.07 for the tonic triad's quality — **only at slot 0 of the first window**, and only
  through the transition score (seed-34 slot 0 parts: `openingTonic 0.12,
  openingTonicQuality 0.07`).
- *Per chord*: `tonicReinforcement` contributes at most +0.062 (`0.09 × need × …`) — the
  recorded slot parts show +0.062 on establishing phrases, +0.035 mid-song.
- *Per path*: the tonal-identity component fits the fraction of tonic-reinforcing
  foundations against role targets (establish 0.5, weight 0.7). Recorded values:
  verse#p0 `tonalId 0.583/0.7`, chorus#p2 (conclude) `tonalId 0.315/0.7`.

What is **not** evaluated anywhere: whether the tonic was stated at phrase *beginnings*,
whether a chromatic event *obscured* the center before a return, whether the final
arrival actually landed home. The seed-42 run's chorus ends on `Emaj7` — an E **major**
foundation at the `resolved` arrival of E Aeolian; the arrival fit for "at home + stable"
is 0.85 for the chromatic tonic vs 1.0 for the diatonic one — a 0.15 gap × 0.9 position
weight = **0.135**, smaller than one jitter step. The strongest structural signal in the
system (the +0.9-weighted arrival fit) happily resolves to the wrong-mode tonic.

Conclusion: tonal-center awareness exists as three small soft biases; no layer evaluates
*center coherence over time*, and the reported "weak tonal establishment" follows
directly.

---

## 6. Q5 — Does the generator evaluate complete harmonic phrases?

**It computes a whole-path score, but it is numerically marginal and categorical thin.**

What exists (`evaluatePathDetailed`, reported per window as `path evaluation`):
movement-diversity fit, tonal-identity fit, prolongation-purposefulness fit, and a
development bonus (+0.12 when the opening idea returns in the second half). Recorded
totals per window: **0.86–1.11**, against cumulative transition totals of **7.2–15.5** —
the whole-phrase evaluation contributes **≈12% or less** of the final path score. The
per-transition `foundationTransitionScore` (identical for near-identical candidates) is
what actually ranks paths.

What the implementation does **not** evaluate (reported honestly in the trace as absent
categories): chromatic coherence over the phrase, cadential *approach* planning before the
final slot (only the last slot receives `arrivalFit`), root-trajectory direction or shape,
tonic-statement position, relationship between a phrase's opening and the related phrase's
material (beyond the two override mechanisms), and any comparison of rival paths'
*musical* trajectories beyond the four soft fits.

Also structural: the whole-path score is applied **only to the 8 beam survivors** — it can
never rescue a path pruned during expansion, and expansion is driven entirely by the local
transition score.

---

## 7. Q6 — Is candidate diversity being preserved?

**No — the beam converges.** Two recordings demonstrate it:

- Seed-34, verse#p0 finals: all 8 surviving paths begin
  `[E minor › B suspended › E suspended …]`. Eight "different" paths are one trajectory
  with different tails. The diversity mechanism (`MAX_PER_SIGNATURE = 2` on a
  last-two-roots signature) only limits *duplicate tails*; it cannot preserve structurally
  different plans (e.g. a path heading to the C-major side vs the B-minor side), because
  such plans differ in *early* roots, which the signature does not capture.
- Pruning counts (`beam.slots[]`): slot 2+ prunes **24 of 32** successors by beam width in
  every window; the seed-42 opening rejected `E major`/`E suspended` as signature-caps and
  `B minor`/`D major` as successor-cuts — the tonal alternatives never survived to a
  final comparison.
- The final pick then treats a 0.30-total spread as a tie: with the 12% strong cutoff, all
  8 finals were "strong" in every recorded window (`seeded pick index` 0, 4, 4, 7 across
  the four windows), so **seed variation selects among converged variants instead of
  exploring distinct trajectories** — matching the report's own `selectionModel` warning
  that a chord wins because its *path* survived, not because it won a slot.

---

## 8. Q7 — Are settings influencing the correct musical decisions?

- **Complexity stays in the color stage — confirmed.** Every color record carries
  `complexityPref` (0.48/0.46 in the fixture), and the emitted tier distribution
  (14 triads / 16 sevenths / 0 extensions at complexity 2) shows it steering richness.
  The structural pool is nearly complexity-invariant (59 foundations at complexity 1 vs
  70 at 2 and 3 — extensions add no foundations because grouping is by core); no
  structural score reads complexity. This matches the Phase 4.1 intent.
- **Borrowing is the *de facto* structural setting.** borrowing `none` → 17 foundations;
  `some` → **70** (52 chromatic). Combined with the small diatonic grade (+0.2 vs +0.05)
  and the quality-keyed stability anchor (Q2), the borrowing switch effectively decides
  how much chromatic structure competes — much more than its "color" position suggests.
  The seed sweep quantifies the result: non-diatonic structural selections occur in 28 of
  40 seeds at borrowing `some` and 40 of 40 at `more`.
- **Variation acts inside the structural search** (jitter ±0.06 at 0.5) — but because
  contests are routinely decided by less than that (Q3, Q6), variation currently behaves
  less like "adventurousness" and more like "re-roll the lottery among converged paths."
- **Density/stability shape the slot grid** (2/bar here) — timing only, as intended, but
  see Q3: nothing downstream can answer the grid with a sustain.

---

## 9. Q8 — Which subsystem is primarily responsible?

| subsystem | verdict | evidence |
|---|---|---|
| Harmonic rhythm | **contributing, not causal** — it sets the slot grid (2/bar) but never forces a *foundation* change; it also has no sustain concept to offer | `rhythm.continuationModelNote`, slot records |
| Structural selection (candidate scoring) | **primary cause** — suspension-flattering arrival fits, quality-keyed stability anchor for chromatic chords, weak diatonic grading, prolongation penalty, movement-diversity churn target | Q1–Q4 part tables |
| Harmonic color | **not responsible** for the reported problems — suspensions are structural; complexity stays in color; continuity works as designed | Q1, Q7; test invariants |
| Phrase planning | **contributing (Problem A)** — interior `suspended`/`ambiguous` cadence intentions pre-emptively request ambiguity; a plan is not a defect, but the selector obeys it literally | `planning.phrases` cadence intentions |
| Candidate scoring aggregation | **primary amplifier** — whole-path evaluation ≈12% of the final score; arrival fit concentrated on one slot; no mid-phrase chromatic classification | Q5 |
| Search pruning | **primary for Problem D** — beam converges to one trajectory; strong-cutoff admits all finals; seeded lottery among variants | Q6 finals records |

In one sentence: **the scoring layer defines what "good harmony" means too locally and too
symmetrically (every foundation reachable, every quality nearly equal), and the search
layer's remaining global judgment is too weak to recover — so the output is locally
plausible, globally drifting, and seeded noise decides the close calls.**

---

## 10. What these diagnostics do *not* show

- Anything about the original screenshot run itself (unknown seed/settings; see §1).
- Melodic/voice-leading consequences (the engine is chord-level).
- Whether users prefer alternatives — no preference model exists anywhere in the engine;
  all "fit" values are internal planning parameters, as the reports label them.
- The reuse path's alternatives (structural reuse maps material directly; its trace
  records substitutions and cadential variations, and honestly reports that the
  whole-phrase evaluation is *not applied* on that path — see `MaterialSelectTrace`).

## 11. Evidence-backed starting points for the next phase (not implemented here)

1. Root-key (not quality-keyed) mode-relative stability, or an explicit chromatic-departure
   weight in the transition score (Q2 table).
2. Raise the diatonic preference or scale it by phrase stability; treat stepwise chromatic
   roots as marked events unless the plan asks for contrast (Q2/Q3).
3. Give continuation an advocate: evaluate prolongation as a *positive* structural option
   for stable phrases (Q3), and let the rhythm layer express "sustain" slots (the report's
   continuation-model note marks exactly where this hook is missing).
4. Re-balance `foundationArrivalFit` so ambiguous/suspended intentions do not make
   suspensions win non-suspending phrases (Q1), and make the resolved arrival prefer the
   *diatonic* tonic by a margin larger than the jitter (Q4).
5. Diversity: signature on trajectory *shape* (tonic-side membership, first-root class)
   instead of last-two-roots; narrow the strong cutoff or weight the seeded pick by path
   score (Q6).
6. Consider evaluating whole paths *during* expansion (or a two-level search) so the ≈12%
   path evaluation can influence which paths survive at all (Q5).

Each hypothesis above can now be tested by re-running
`npm run harmony:diagnose -- --seed 34` (and the audit corpus) after the change and
diffing the recorded decisions — without re-deriving the pipeline by hand.
