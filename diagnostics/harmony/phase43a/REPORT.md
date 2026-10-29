# Phase 4.3A — Tonal Stability Correction: Technical Report

**Scope:** one focused correction to the tonal-stability evaluation in the structural
transition score. No other scoring, planning, search, color, rhythm or UI behavior was
changed. All numbers below are recorded diagnostic values, not recomputations.

**Artifacts**

| artifact | path |
|---|---|
| Correction | `src/engine/harmony/foundation.ts` (`STRUCTURAL_CONSONANCE`, `StabilityEvidence`, `stabilityEvidence()`, `foundationTransitionScoreDetailed`) |
| Diagnostics exposure | `src/engine/harmony/diagnostics.ts` (`stabilityEvidence` per slot), `diagnostics-format.ts`, `generation.ts` |
| Targeted tests | `tests/harmony-stability.test.ts` (11 tests, all 12 modes covered) |
| Before/after (seed 34) | `diagnostics/harmony/phase43a/{baseline,corrected}/e-aeolian-seed34.{txt,json}` |
| Corpus evaluation | `scripts/phase43a-corpus.ts` → `corpus-{baseline,corrected}.json`, `CORPUS_COMPARISON.md` |

---

## 1. What exactly caused the tonic-quality collision?

The pre-4.3A transition score contained one stability term:

```ts
const stability = ctx.pool.qualityStability[cand.quality];       // quality-keyed
parts.qualityStability = 0.18 * stability * (1.05 - 0.55 * ctx.tension);
```

`pool.qualityStability` is `deriveQualityStability(tonic, mode)`: it maps each foundation
**quality** to how normal that quality is inside the mode's diatonic vocabulary, with the
tonic triad's own quality **anchored at 1.0**. In E Aeolian the tonic triad (Em) is minor,
so `qualityStability['minor'] = 1.0` — and that 1.0 was then applied to *every* minor
foundation, diatonic or not. The recorded seed-34 contest (slot 5, after Gmaj7) shows the
consequence — chromatic Abm7 collecting the full anchor:

| component | Ab minor (before) | note |
|---|---|---|
| base | +0.200 | |
| stabilityFit / movementFit / leadingTone / stepwiseModal | +0.039 / +0.084 / +0.039 / +0.027 | stepwise approach from G |
| tensionFit | +0.119 | minor anchor ≈ phrase tension |
| **qualityStability** | **+0.139** | **'minor' = the tonic's quality — awarded because of chord SHAPE, not because of any relation to E** |
| diatonicPreference / chromaticTonicTone | +0.050 / +0.060 | |
| **total** | **6.291** | selected; contest decided inside the ±0.06 jitter band |

The term's *intent* was "the mode's local diatonic norm" — a statement about the mode's
OWN chords. Applying it to a chromatic chord silently converted "minor is the tonic's
quality in E Aeolian" into "this chord is as tonally settled as the tonic". Abm (core
Ab–B–Eb) has no root relationship to E, shares exactly one tonic-triad tone (B), and is
not diatonic — nothing about it reinforces E except its quality label.

## 2. What calculation replaced it?

The single quality-keyed term was split into two terms with genuinely different meanings
(`foundation.ts`, Phase 4.3A block):

```ts
// 1) Structural consonance — the sonority's OWN stability.
parts.structuralConsonance = 0.10 * STRUCTURAL_CONSONANCE[cand.quality] * (1.05 - 0.55 * ctx.tension);
// 2) Mode-relative quality norm — gated on diatonic membership.
if (cand.diatonic) {
  parts.qualityStability = 0.10 * ctx.pool.qualityStability[cand.quality] * (1.05 - 0.55 * ctx.tension);
}
```

- `STRUCTURAL_CONSONANCE` (major 1, minor 1, suspended 0.5, other 0.45, diminished 0.3,
  augmented 0.25) is an intrinsic, mode-independent, root-independent description of the
  chord shape — documented as a heuristic, not a perceptual measurement. It applies to
  **every** foundation, so chromatic consonant triads remain viable sonorities (they keep
  ~0.077 at neutral tension) while gaining nothing from the mode's identity.
- The mode's quality norm (unchanged derivation, `deriveQualityStability`) now speaks
  **only about chords the mode contains**. Net effects at neutral tension:
  diatonic normative chords: 0.139 → 0.154 (+0.015); chromatic chords sharing the tonic
  quality: 0.139 → 0.077 (−0.062); the tonic-quality **anchor can no longer reach any
  chromatic foundation in any mode**.

Tonic identity itself remains rooted where it always was — root and common-tone facts:
`tonicReinforcement` (root on tonic or ≥ 2 shared tonic-triad tones), `openingTonic*`,
`chromaticTonicTone`. No new score terms were added; no weights outside this term changed;
beam width, pruning, jitter, prolongation, arrival fits and the path evaluator are
byte-identical.

## 3. How does the corrected model distinguish structural consonance from tonal stability?

Through four explicit, comparable factors (`StabilityEvidence`, computed by
`stabilityEvidence(cand, pool)` and reported per slot in the diagnostics):

| factor | meaning | Abm in E Aeolian | Em in E Aeolian |
|---|---|---|---|
| structuralConsonance | what the sonority IS | 1 | 1 |
| tonicRootRelationship | root IS the tonic (fact) | 0 | 1 |
| tonicChordRelationship | shared tonic-triad tones | 0.333 (B) | 1 |
| modalCompatibility | diatonic membership | 0 | 1 |

The scorer consumes these through separate components: `structuralConsonance` (sonority),
`tonicReinforcement` (root/common-tone), `qualityStability` (modal norm, diatonic only),
`diatonicPreference`/`modalColor` (modal compatibility). "Being a stable triad" and
"reinforcing E" are now different numbers produced by different mechanisms — the report's
`stability evidence:` line prints all four plus the actual scored contribution
(`structuralConsonance + qualityStability` from `transitionParts`, never re-derived).

## 4. Why can Ab minor no longer inherit Em's tonic status?

Because the only bridge between them — the quality key — no longer carries tonic
information across diatonic boundaries. Concretely: `qualityStability['minor'] = 1.0`
describes Em, Am and Bm (the mode's own minor chords). Abm is not one of the mode's
chords, so the gated term yields exactly 0 for it; its remaining stability evidence is its
sonority (0.077) — the same credit *any* minor triad receives in any mode. Its tonic-root
relationship is 0, its tonic-chord relationship is 1/3 (one shared tone), and it keeps the
existing chromatic grading (diatonicPreference 0.05, chromaticTonicTone +0.06, no modal
color). It stays pooled, scoreable and selectable — just without a stability term it never
deserved. No Ab-specific rule exists; the same holds for every chromatic chord sharing the
tonic quality (e.g. Emaj7 in seed 42's baseline, E major in C Aeolian, D major in C
Ionian — Test 2 pins the major-mode equivalent).

## 5. How does the correction behave in symmetrical modes?

No conventional major/minor tonic demand exists anywhere in the corrected path — the
change adds no tonic requirement, and the planner's symmetric-mode guarantees (no
functional-tonal/plagal *support*, `cadenceEnvironment`) are untouched. What changes is
where borrowed consonance lands:

- **Whole Tone:** the mode's own norm (augmented, anchored 1.0) now applies to its own
  augmented chords only. Borrowed consonant triads (Am, Fm, C7 in C WT) previously
  collected the 0.15 "foreign quality" floor (~0.023); now they collect their honest
  sonority credit (0.077) — so *consonant borrowed color becomes somewhat more
  competitive* (chromatic fraction 13.4% → 24.9% over 20 seeds), while the tonic-root
  fraction is unchanged (29.6% → 29.5%) and root diversity slightly rises. This is the
  corrected semantics working (a major triad IS a stable sonority even in WT; it does NOT
  become tonic — arrivals still need root/common-tone facts), but it is a behavior shift
  to watch in listening tests.
- **Diminished (Half-Whole / Whole-Half):** chromatic candidates lose the quality-norm
  credit; the mode's own diminished tonic arrivals become relatively stronger (tonic-root
  28.7% → 36.7% in D HW). A visible consequence: the D WH diatonic run (seed 42) now ends
  a phrase `G major → D diminished` — an arrival on the mode's own tonic sonority. The
  `realizedFoundationFamily` labeler calls that root motion 'plagal' (it labels any
  (tonic+5)→tonic motion, no quality involved; it carries no score). The
  `harmony-structure.test.ts` assertion was updated to pin the *mechanism* (planner cannot
  offer plagal; `dominantAvailable` false; functional-tonal never realized) instead of an
  emergent label coincidence. No functional cliché is imposed — the arrival is a
  diminished tonic in octatonic space, which is exactly what "resolution" means there.
- Symmetric generation remains valid and deterministic in all seeds tested (Test 6, corpus
  `deterministicAll: true` everywhere).

## 6. Did the change introduce excessive tonic repetition?

No. Over 20 seeds × 6 contexts (`CORPUS_COMPARISON.md`):

- **Tonic-root fraction** (the repetition risk metric): E Aeolian 21.8% → 21.1%, D Dorian
  17.2% → 17.3%, C Ionian 29.0% → 28.3%, D Phrygian 29.2% → 26.9% (down), C Whole Tone
  29.6% → 29.5%. Only D Diminished HW rose (28.7% → 36.7%) — arrivals on the mode's own
  tonic sonority after chromatic competitors lost their unearned credit.
- **Distinct roots per phrase** (diversity): E Aeolian +0.04, C Ionian +0.15, C WT +0.11,
  D Phrygian +0.04; D Dorian −0.06; D Dim HW −0.65 (still 4.53 of ~5 slots).
- First chord tonic-rooted: 100% before and after (opening behavior unchanged).
- Generation failures: 0 everywhere; determinism held in every run.

The correction removed chromaticism that was *purchased with an unearned stability
anchor* (E Aeolian 4.5% → 2.4%, D Phrygian 6.6% → 2.6%, D Dorian 3.9% → 2.1%) without
shrinking the chromatic palette (pool sizes unchanged; borrowed consonant color in WT
actually increased).

## 7. Did it improve the E Aeolian example?

**The targeted defect is gone.** Seed 34, identical project/settings/scope:

- **Before:** `Em7 → Bsus4 → Esus2 → Bm7 → Gmaj7 → Abm7 → C → …` — Abm selected at the
  slot-5 arrival with `qualityStability +0.139`, inside a photo-finish contest (C
  suspended 6.315 · Ab minor 6.291 · B major 6.284 …).
- **After:** `Em7 → Bm7 → Esus2 → Bsus4 → Gmaj7 → Cmaj7 → Am → D7 → …` — **no chromatic
  foundation is selected anywhere in the run**. Ab-rooted foundations still appear in
  early expansions (e.g. `E other[E,Ab,Bb]` at slot 0, successor-cut) — chromatic freedom
  preserved, the anchor-subsidized selection gone. Em's own opening evidence now reads
  `struct 1 · tonic-root 1 · tonic-chord 1 · modal 1` with total 1.043 (slightly above the
  baseline 1.028 — the tonic gains the modal norm it owns).
- Required observations (spec §10): 1. Abm remains a candidate — yes (pooled, scored,
  Test 4). 2. Its stability evaluation changed — +0.139 → +0.077, all from sonority. 3.
  Its ranking changed — no longer selected in seed 34; corpus-wide chromatic selections
  halved. 4. Still selectable in principle — yes (scores well above exclusion; contests
  still admit chromatic candidates). 5. Em receives appropriate tonic recognition —
  opening tonic + quality bonus + reinforcement + full modal norm, and no other chord
  shares any of the root-based credits. 6. G/Am/Bm/C/D remain competitive — Test 3 pins
  them within 0.3 of Em in a neutral contest. 7. Trajectory changed — the whole path
  re-ranked (also producing 3 sustained events where the baseline had none — a neutral
  side effect of path re-ranking, not a new mechanism).

The *suspension* selections visible in both runs are the separate Q1 defect from Phase
4.2 — explicitly out of scope here and unchanged.

## 8. What problems remain unresolved?

Exactly the ones Phase 4.2 documented and this task excluded:

1. **Suspensions win non-suspending arrivals** (Q1): Esus2/Bsus4 still appear at openings;
   `foundationArrivalFit` still pays +0.6 under `suspended` intentions and the quality
   tables make ambiguity nearly free.
2. **No continuation advocate** (Q3): every transition in the seed-34 baseline was still a
   structural movement; the corrected run shows 3 merged sustains only as a side effect of
   path re-ranking. The rhythm planner still assigns one foundation per slot with no
   sustain decision.
3. **Beam convergence** (Q6): finals still converge on one trajectory; the strong cutoff
   still admits all 8; the seeded pick still chooses among converged variants.
4. **Whole-path evaluation still marginal** (Q5): unchanged in this phase.
5. **New watch item from the corpus:** in Whole Tone, borrowed consonant triads became
   more prominent (13.4% → 24.9% chromatic). Semantically correct under the corrected
   model, but worth listening to; if unwanted, the lever is the structural-consonance
   weight for *chromatic* candidates or the borrowing grades — a separate, deliberate
   musical decision, not part of this correction.
6. **Musical quality still requires listening.** Every number above explains the scoring;
   none of it proves the progressions sound better. The audit corpus
   (`npx vite-node scripts/audit-harmony.ts`) remains the ear-level review tool.

---

## Verification summary

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **265 tests passing** (12 files), including the 11 new
  `harmony-stability.test.ts` tests: tonic-quality collision (Em/Abm), major-mode
  equivalent (C/D/Dm), diatonic alternatives, chromatic freedom, transposition invariance
  (6 tonics), all-12-mode coverage × 2 tonics with symmetric-mode smoke, phrase-context
  freedom (open endings, no tonic flooding over 12 seeds), diagnostic correctness
  (recorded evidence == scorer recomputation), determinism, and the full existing suite.
- Corpus: 20 seeds × 6 contexts before/after — no failures, full determinism, metrics in
  `CORPUS_COMPARISON.md`.
- Diagnostic non-interference preserved: diagnostics are recorded from the same
  single-implementation functions (`stabilityEvidence` consumes the same constants the
  scorer consumes); disabled-diagnostics output is unchanged except for the corrected
  scores themselves.
