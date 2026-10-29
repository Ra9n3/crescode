# Phase 4.3B — Pre-Implementation Inspection Record

**Purpose:** spec §3 requires the existing Phase 4.3A behavior to be documented
BEFORE any change. Everything below was read from the code at commit
`2d98758` (Phase 4.3A), cross-checked against `diagnostics/harmony/ANALYSIS.md`
(Phase 4.2, Q3). No code was modified when this file was written.

---

## 1. How harmonic-rhythm slots are created (`rhythm.ts`)

`planRhythmSlots(target, windows, meter, rng, variation)` partitions each
generation target into exact, gapless, positively sized `RhythmSlot`s
(`startTick`, `durationTicks`, `windowIndex`, `phraseEnd`), snapped to the
notated pulse grid at 960 PPQ. Slot lengths EMERGE from the section's Phase 2
rhythm preference (`changesPerBar`, `shape`), the real meter, and seeded
variation. Slots never cross a phrase-window boundary; the last slot of a
window is that window's arrival point. **The planner is content-agnostic —
it decides WHEN an opportunity exists, never WHAT harmony goes there.**

## 2. Does every slot currently require a new foundation?

The rhythm layer does not force content, but the SELECTION MODEL treats every
slot as a mandatory change decision:

- `RhythmSlotRecord.plannerForcesNewFoundation` is hardcoded `true` (the
  Phase 4.2 model statement: "the rhythm planner always assigns exactly one
  foundation per slot; there is no explicit sustain decision at rhythm time").
- `ANALYSIS.md` §Q3: in the seed-34 run, **29 of 29 adjacent transitions were
  structural foundation changes** (0 continuations, 0 exact repetitions).

## 3. How "continuation" is scored today (`foundation.ts`)

There is no continuation action. Re-selecting the immediate previous
foundation is possible (it is a pool entry) but enters the SAME contest as a
root change, scored by `foundationTransitionScore`:

- Same-foundation: `stabilityFit = 0.16·1.0·(0.3+0.7·stability)` (full
  common-tone ratio), `movementFit = 0.22·0.12·(0.15+0.85·movement)`
  (`MOTION_BY_CLASS[0]=0.12` — near-no-motion), and the **prolongation term
  `0.12·stability − 0.3·movement` = −0.084 at the neutral (0.55/0.5)**.
- A root change additionally collects `movementFit` up to
  `0.22·0.8·(0.15+0.85·movement)` ≈ +0.10 at neutral.
- Destination terms (tensionFit, structuralConsonance, qualityStability,
  tonicReinforcement, modalColor, diatonicPreference) apply to both equally.

Net at neutral settings: sustaining starts every contest ≈0.16 behind a
change. `ANALYSIS.md` calls continuation "the only option with no advocate
anywhere in the scoring pipeline."

## 4. How the phrase evaluator rewards structural movement (`progression.ts`)

`evaluatePathDetailed` components:

- `movementDiversity = 0.4·(1 − |distinctRoots/path.length − (0.35+0.55·movement)|)`
  — at neutral movement the ideal path has ≈**0.625 distinct roots**
  (the "≈62% root changes" the 4.2 diagnostics measured). A sustained
  passage scores as a FAILURE of this fit even in a stable phrase.
- `prolongationPurposefulness = 0.25·(1 − |runRatio − (0.1+0.45·stability)|)`
  — the only pro-sustain voice (≤0.25).
- `tonalIdentity` (0.5–0.7) and `development` (+0.12) are continuation-neutral.

## 5. How neighboring anchors influence decisions

- `input.prev` (preserved anchor before the target, or the previous window's
  last foundation) seeds the search as `beamPrev` for slot 0.
- `input.after` (preserved anchor after the target) contributes a WHOLE-PATH
  `anchorBonus = 0.5·foundationTransitionScore(last, after, ctx)` — after the
  beam loop, never per slot. No per-slot "destination approaching" awareness.

## 6. How selected foundations become final chord events (`generation.ts`)

Per window: `selectWindowFoundations` → one foundation per slot → the
emission loop folds adjacent same-foundation slots into `StructuralEvent`s
→ Stage B colors each EVENT (one decision per event, never per slot) →
`Chord`s with exact slot-sum durations (integer ticks, 960 PPQ).

## 7. How adjacent identical foundations are merged today

`last.foundation.id === f.id && adjacent && (withinWindow || crossWindow)`:

- `withinWindow` (same window): always merged.
- `crossWindow` (window wi > 0): merged only when `mergeFirst[wi]` — a seeded
  `0.3+0.3·stability` decision gated on a suspended/ambiguous cadence or a
  continuation/suspension boundary — OR the previous window had no planned
  arrival. A same-foundation pick at slot 0 after a PLANNED arrival without
  mergeFirst stays a separate event: **this is where rearticulation survives**
  (`sameFoundationRepetitions`).
- Merged events keep one color decision and one symbol (spec §9 of 4.3B is
  already structurally satisfied at the event layer).
- Merges never touch preserved chords: generated slots exist only inside
  generation targets, which exclude kept spans (`coverage.ts`).

## 8. Hidden anti-sustain mechanism found during inspection

`beamSelect` loop penalty: `recent = path.slice(max(0,len−4), len−1)`,
`loopPenalty = 0.3` when the candidate's id is in `recent`. Because `recent`
EXCLUDES `beamPrev` but INCLUDES earlier slots, a candidate continuing a
foundation that already sounds in the previous slot is exempt — **but a THIRD
consecutive slot of the same foundation IS penalized 0.3** (e.g. path
`[A,B,C,C]` expanding another `C`: `recent = [A,B,C]` contains `C`). Same-
foundation runs are therefore silently capped at length 2 today. The comment
says "the IMMEDIATE previous foundation is prolongation, not a loop" — the
implementation overshoots that intent. Phase 4.3B must exempt continuation
from the loop penalty (run-length judgment belongs to the path evaluator).

## 9. Other facts the design must respect

- `forcedFirst` (mergeFirst) overrides `path[0]` AFTER the search; trace
  records it; selected-candidate scores are honestly omitted for that slot.
- Reuse path (`materialSelect`) maps related material proportionally;
  adjacent mapped duplicates merge at the event layer. No continuation
  search option there (out of scope to redesign — documented honestly).
- Diagnostics are strictly observational (Phase 4.2 contract): the new
  continuation records must be filled from the SAME functions the search
  used, must not consume rng, reorder, or rescore anything.
- Phase 4.3A's corrected stability terms (structuralConsonance /
  qualityStability gating) are OUT OF SCOPE and must remain byte-identical.
