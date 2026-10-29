# Phase 4.3B — Harmonic Continuation & Natural Harmonic Rhythm: Technical Report

**Scope:** one focused correction — teach the structural selector that keeping the
current harmony sounding is a genuine musical decision. No harmonic-rhythm planning,
continuation-external scoring, color, borrowing, beam-configuration, phrase-planning,
profile, UI or orchestral-MIDI behavior was redesigned. All numbers below are recorded
diagnostic values from the committed artifacts, not recomputations.

**Artifacts**

| artifact | path |
|---|---|
| Pre-change inspection record | `diagnostics/harmony/phase43b/INSPECTION.md` |
| Correction | `src/engine/harmony/foundation.ts` (`foundationContinuationScoreDetailed`, shared `scoreDestination`), `progression.ts` (continuation action, loop-penalty exemption, activity-vs-intent path fit), `generation.ts` (action threading, absorbed-arrival recording) |
| Diagnostics exposure | `diagnostics.ts` (`continuationDecision` per slot, per-window `continuation` summary, `continuationParts`), `diagnostics-format.ts`, `generation-types.ts` |
| Targeted tests | `tests/harmony-continuation.test.ts` (18 tests across 14 spec groups) |
| Before/after (seed 34) | `diagnostics/harmony/phase43b/{baseline,corrected}/e-aeolian-seed34.{txt,json}` |
| Corpus evaluation | `scripts/phase43b-corpus.ts` → `corpus-{baseline,corrected}.json`, `CORPUS_COMPARISON.md` |

The baseline was produced from a `git worktree` at the Phase 4.3A commit (`2d98758`)
with the identical measurement script — the script reads only diagnostic fields that
exist in BOTH versions, so both runs use identical metric semantics.

---

## 1. What caused the every-slot change? (the diagnosed bias, confirmed)

The pre-4.3B inspection (`INSPECTION.md`) confirmed the Phase 4.2 Q3 diagnosis and
found one additional hidden mechanism:

1. **Transition scoring taxed prolongation.** The same-foundation term was
   `+0.12·stability − 0.3·movement` = −0.084 at neutral, while any root change
   collected `movementFit` up to +0.117. Sustaining entered every contest ≈0.16
   behind, and there was no continuation action at all — re-selecting the sounding
   foundation was scored as a root change with a tax.
2. **The path evaluator rewarded root churn.** `movementDiversity` fitted
   `distinctRoots/slots` against `0.35 + 0.55·movement` ≈ 0.625 at neutral — the
   "62% root changes" the 4.2 diagnostics measured. Any sustain scored as a failure
   of that fit even in a stable phrase.
3. **A hidden loop penalty capped holds at two slots.** `recentIds` (last 4 roots
   minus the immediate predecessor) contained the sounding foundation once it had
   already been repeated once, so a THIRD consecutive slot paid −0.3. The comment
   said "the immediate previous foundation is prolongation, not a loop"; the
   implementation overshot. This is why even the rare same-foundation re-selections
   never grew into real holds (max sustained run in the baseline corpus: 2–3 slots).

Result (baseline corpus, 20 seeds × 6 contexts): **4–11% of opportunities kept the
harmony** (mostly 'hold'-shape planner slots), 27.6–29.9 structural changes per run
of ~32 opportunities — the 29/29 pattern, systemic in every mode.

## 2. What replaced it?

Continuation is now an explicit structural action in the beam search
(`progression.ts`): a pool entry that IS the sounding foundation is scored by
`foundationContinuationScoreDetailed` instead of the movement-centric transition
score. Its factors are the spec §5 considerations, each a small, documented,
contextual weight — no factor is a probability, none is keyed on section type alone:

- **(A) holdFit** — holding retains every structural tone (the same full
  common-tone credit a same-foundation change received), scaled by phrase stability.
- **(B) directionFit** — `0.14·(stability − movement)` from the Phase 3 phrase
  direction. The sign is CONTEXT: zero at neutral, positive in calm phrases,
  negative in active ones. This is the continuation advocate without being a
  constant bonus (spec §6: never merely reverse the bias).
- **(C) movementPrefFit** — the Phase 2 section movement preference.
- **(D) positionFit** — opening hold (identity, stability-scaled), mid-phrase hold
  (space), or sustaining an ALREADY-ACHIEVED arrival (scaled by the arrival fit the
  sounding harmony earned when it arrived).
- **(E) neighborFit** — a preserved anchor after the target sounding the same
  harmony (+0.08): sustaining joins it instead of re-striking it.
- **(F) rhythmFit** — the Phase 2 harmonic-rhythm preference: sparse
  (low changes-per-bar) and hold-shaped profiles welcome holds; dense ones
  discourage them.

The sounding sonority is still judged AS a sonority through the exact shared
destination terms (`scoreDestination` — the single implementation both scores
consume), so a held chord competes with the same voice any fresh candidate for that
harmony would use. At neutral settings continuation (≈0.81) and a typical change
(≈0.84) sit inside the same band: the contest is decided by context, seeded jitter
and the whole-path evaluation — never by a fixed rule. The loop penalty now exempts
the sounding foundation (run-length judgment belongs to the path evaluator), so
holds of any length are reachable.

## 3. How is structural movement evaluated now? (root-churn correction, spec §6)

`evaluatePathDetailed.movementDiversity` was rebuilt as **activity vs intended
activity**:

- `changeRate` = foundation changes / opportunities, where continuations (same-id
  adjacencies — the explicit hold decision) are NOT changes;
- `intendedRate = 0.15 + 0.7·movementIntent` with `movementIntent` blending the
  phrase's direction (Phase 3) and the section's movement preference (Phase 2) —
  a contextual preference, not a universal target (no continuation percentage is
  required anywhere, spec §6 "avoid arbitrary targets");
- `varietyFit` = distinct roots among the harmonies actually used — at equal
  activity, a varied path still outranks an alternating one, so variety no longer
  DEMANDS churn.

`prolongationPurposefulness` (unchanged formula) now has real work to do: it polices
run length against stability — a full-hold path in an active phrase loses it,
a purposeful run in a stable phrase gains it.

## 4. Continuation vs rearticulation vs color variation (spec §7)

- **Continuation** — the selector's hold decision; merged into one sustained event
  (exact slot-sum duration, integer ticks, one color decision, one symbol). The
  event-merging layer already did this mechanically; now the decision that feeds it
  is musical.
- **Rearticulation** — preserved exactly as before: a window-opening continuation
  after a PLANNED arrival (when the intention-driven `mergeFirst` lottery does not
  sustain it) stays a separate event. These now occur more often because window
  openings genuinely choose continuation; the corpus shows `color-variation`
  transitions rising (0–1 → 2–15 per 20-seed context) — same-foundation
  re-strikes whose colors legitimately differ. No redesign of that mechanism.
- **Color variation** — unchanged; a sustained event receives ONE color decision
  (spec §9), asserted by Test 4. Extension changes can never masquerade as
  movement (foundation-identity classification, unchanged from Phase 4.2).
- **Limitation represented honestly:** the engine still cannot score
  rearticulation-vs-continuation as distinct SEARCH options at a boundary (the
  boundary shape is decided by the existing emission gate). The updated
  `continuationModelNote` states this rather than inventing behavior.

## 5. Cadences, boundaries and protected chords (spec §8, §10)

- Cross-phrase sustain remains gated by the existing intention-driven rule
  (suspended/ambiguous cadences, continuation/suspension boundaries, unplanned
  arrivals) — untouched. A window-opening continuation after a planned arrival is
  emitted as a rearticulated event, preserving the planned arrival's identity.
- Sustaining the arrival harmony is possible and scored (positionFit 'arrival'
  reinforcement), and a sustained arrival never eliminates the intention: the
  cadence diagnostics now record arrivals ABSORBED into a boundary-spanning
  sustained event too (a pre-existing recording gap the corpus exposed — baseline
  realized-rate 89–90% was under-reporting, not missing arrivals; both versions
  record 100% of planned arrivals after the fix). The realized family is still
  judged from the harmony that led INTO the arrival event.
- Locked chords, preserved spans and generation scopes are structurally untouched:
  continuation merging only ever folds GENERATED slots inside one target. Tests 6–8
  pin byte-identical locked events, exact gap coverage and section-boundary respect.

## 6. Did it over-correct into tonic repetition or monotony? (spec §13 warning)

No — with one nuance to listen to. Over 20 seeds × 6 contexts
(`CORPUS_COMPARISON.md`):

- **Tonic-root fraction** (repetition risk): E Aeolian 21.1% → 21.8%, C Ionian
  28.3% → 27.9%, C WT 29.5% → 30.4%, D Dorian 17.3% → 21.9%, D Phrygian 26.9% →
  31.7%, D DWH 17.9% → 20.3%. The tertian rises (+2.4 to +4.8pp) are the expected
  amplification of what holds favor (stable, reinforcing harmonies sustain well)
  — roughly one extra tonic-rooted event per run, not a flood. **Tonic-REINFORCING
  fraction rises everywhere** (+1.3 to +9.3pp) while first-chord tonic-rooting
  stays 100% and opening behavior is unchanged.
- **Diversity**: distinct roots per phrase drops ≈1.1–1.5 (4.3–5.3 → 3.3–3.8) —
  the arithmetic consequence of ~45% fewer changes; 3–4 distinct roots per phrase
  remains normal phrase variety. Chromatic foundation fraction is stable or lower
  in four contexts (holds replaced marginal chromatic moves), up in D Dorian
  (+0.9pp) and D DWH (+5.3pp, watch).
- **No forced patterns**: continuation fraction varies by context (30% WT — its
  augmented norm discourages long holds — to 52% Dorian), by phrase movement
  (seed 34: activity 0.80 in move-0.47 phrases vs 0.50 in the move-0.36 phrase),
  and by seed (8–19 holds per run). Nothing is pinned to a percentage.
- **Watch item for listening:** max sustained runs grew from 2–3 slots to 5–15
  slots (up to ~7.5 bars at 2/bar). These emerge from jitter-favored hold paths
  that survive the (deliberately weak) path policing — legal under "do not force
  movement", but long static passages are a real listening-test target. If
  unwanted, the lever is a mildly superlinear activity penalty — a separate,
  deliberate musical decision, deliberately NOT taken in this phase.

## 7. Did harmonic pacing improve without sacrificing tonal identity?

**The measured shape of pacing changed exactly as intended.** E Aeolian
continuation fraction 11% → 45%, mean chord duration 2152 → 3410 ticks, structural
changes/run 27.6 → 16.9 — while tonic-root fraction, tonic-reinforcement (up),
cadence realization (now 100% recorded), first-chord behavior and chromatic usage
stayed compatible. Seed 34 concretely: the 4.3A output (`Em7 → Bm7 → Esus2 → …`,
29 events, 2 emergent merges) becomes `Em7 → C7 → G → Bm7 → Csus2 → Cmaj7 → …`
(22 events, 11 scored hold decisions with recorded `cont vs chg` contests, 8
sustained events spanning up to 2 bars), still all-diatonic, still E-centered.

Whether it FEELS better is a listening question the numbers cannot answer (the
audit corpus `npx vite-node scripts/audit-harmony.ts` remains the ear-level tool),
but the generator now demonstrably holds harmony when its context argues for it and
moves when its context argues for movement — per-opportunity contests are recorded
(`cont 0.889 vs chg 0.943` means the hold's PATH won the whole-phrase evaluation,
not a local tie).

## 8. What problems remain unresolved?

Exactly the Phase 4.2 items this phase did not touch, plus two new watch items:

1. **Suspensions win non-suspending arrivals** (Q1) — untouched, as scoped.
2. **Beam convergence / seeded lottery among strong finals** (Q6) — untouched.
3. **Whole-path evaluation still marginal in weight** (Q5) — the activity-vs-intent
   correction changed WHAT it measures, not how much it weighs.
4. **Long sustained runs** (new, §6 above) — the max-run tail grew; needs ears.
5. **Whole Tone chromatic color** (4.3A watch item) — unchanged this phase
   (24.5% vs 24.9% baseline), still a listening item.
6. **D DWH chromatic fraction rose** (8.9% → 14.1%) — holds replaced some diatonic
   moves, leaving relatively more chromatic ones; semantically consistent, worth
   listening.
7. **Musical quality still requires listening.** Every number above explains the
   mechanism; none proves the progressions sound better.

---

## Verification summary

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **283 tests passing** (13 files): 265 pre-existing (including
  Phase 4.2 non-interference and Phase 4.3A stability suites, all green unchanged)
  + 18 new `tests/harmony-continuation.test.ts` tests covering the 14 spec groups:
  availability, context sensitivity (no fixed rules), sustained durations, no
  accidental color changes, phrase boundaries + protected chords, locked chords,
  partial generation, section regeneration, meters (4/4, 3/4, 6/8), cadence
  preservation, all twelve modes, determinism, diagnostic accuracy (exact
  accounting between decisions, merges and events), and regression protection.
- Performance: the beam evaluates the SAME candidate count per expansion (the
  continuation is the same-id pool entry re-scored, not an extra candidate); beam
  width, pruning, jitter scale and PRNG streams are unchanged.
- Determinism: byte-identical outputs for identical inputs in every context and
  meter tested; diagnostics on/off produce identical chords AND reports.
