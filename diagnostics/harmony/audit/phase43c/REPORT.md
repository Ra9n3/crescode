# Phase 4.3C — Harmonic Quality Isolation & Controlled Musical Audit

**Investigation report — no generation algorithm was modified.**

Scope: 9 contexts × 6 arrangement structures × 40 deterministic seeds × 3 matched
configurations = **21,600 production generations** (54 cells, 6,480 runs per
configuration), plus 2,160 matched side-by-side comparisons and 486 audition
MIDI files. Every progression was produced by the unmodified production
generator (`generateChordProgression`); configurations A/B/C differ only
through its public `settings` override option.

## 0. Executive answer

**The weak component is structural selection's tonal gravity — not chord color,
not chromatic borrowing, and not harmonic rhythm.**

The most basic configuration (A: plain triads, zero borrowing) already shows
the two structural signatures that make output feel unconvincing:

1. **The tonic has almost no structural weight after the opening.** In E
   Aeolian the harmony spends only **12.5% of its time on the tonic root**
   (Em), while the relative-major pole (G + Bm) occupies **~49%**. The
   generator opens on the tonic 100% of the time, then drifts into the
   relative-major region and only returns to the tonic at `resolved`
   cadences (89.5% of them are tonic-rooted).
2. **`resolved` cadence intentions are realized through weak approaches.**
   Dominant-class root motion (stepwise + functional-tonal) accounts for
   only **20.7%** of resolved arrivals; 38.5% arrive "coloristic"/"modal"/
   "chromatic", and 30.4% are the previous chord simply sustaining across
   the cadence point.

Adding sevenths (B) changes **nothing structurally** — 36/36 tertian cells
are structurally identical to A. Enabling borrowing (C) adds only a small
amount of chromatic material in tertian modes (0.7–4.6% of duration) but
**reshuffles the entire structural path** (54/54 cells diverge from A), and
in symmetric modes it imports foreign tertian triads wholesale (**up to
28.7% of duration in C Whole Tone**) — the clearest "questionable chromatic
choices" signature in the corpus.

These conclusions come from descriptive metrics; the listening kit
(`listening-template.md` + `midi/`) exists to confirm them by ear.

---

## 1. Method summary (spec §3–§6)

| Config | Complexity | Borrowing | Question it isolates |
|---|---|---|---|
| A — Structural baseline | 1 (triads) | none | Can pure diatonic vocabulary convince? |
| B — Diatonic color | 2 (triads+sevenths) | none | Does color help or hurt? |
| C — Full vocabulary | project (2) | project (some) | What does borrowing do? |

- Foundations extracted per event through the generator's own Phase 4.1
  reducer (`foundationInfoFromSymbol`) — extensions cannot alter structural
  identity (pinned by Test 4).
- Sustained harmony counted once, never per-slot (Test 5).
- Phrase arrivals judged from the generator's own cadence records.
- All metrics are **descriptive** (spec §7): no quality score, no thresholds.

## 2. Evidence per diagnostic question (spec §11)

### Q1 — Can the generator produce convincing progressions from basic diatonic harmony alone?

**Grammatically yes; directionally no.**

What works in config A (evidence: `audit-summary.md`, all 40-seed cells):

- 0 failures, 100% deterministic in every cell (2,160 runs per config).
- Opening chord is tonic-rooted in **100%** of sampled runs (18/18 per
  checked context; every run of seeds 1/2/34).
- `resolved` arrivals end on tonic-root harmony **89.5%** (5,068/5,661).
- Repeated sections keep harmonic identity: related-Chorus foundation overlap
  **88.2% mean** (n=1,080 pairs); recurring foundation motifs in **40/40**
  full-form runs.
- Pacing is sane: ~1.0 structural change/bar against a 2/bar preference,
  i.e. the 4.3B continuation stage holds harmony roughly half of the
  opportunities; event durations 0.5–1 bar (45–67%), 1–2 bars (~40%), 2+
  bars (~7%).

What does not work — the structural journey itself (E Aeolian, config A,
verse-chorus root-duration profile, sampled events n=53):

```
G major 26.0% · B minor 22.9% · C major 19.8% · E minor 12.5% (tonic!)
D major 7.3% · Csus 5.2% · Am 2.1% · others 2.2%
```

The tonic is the FOURTH most occupied root. The same drift shows in every
Aeolian/Dorian/Lydian cell (tonic-root duration share 12–21%), while
Phrygian (43.8%) and symmetric modes (31–70%, anchored by the tonic-aug or
tonic-dim pool) hold their centers much better. **This signature exists
before any color or borrowing is applied** — so the primary problem is
structural selection (how much tonal gravity the path evaluator gives the
tonic region), not the color stage and not borrowing.

Seed-level spread is healthy (E Aeolian verse-chorus changes/bar: A median
1.06, p25 0.94, p75 1.13) — the variance is not the issue; the *center of
gravity* is.

### Q2 — Does adding seventh chords improve or damage the underlying progression?

**It neither helps nor damages the harmony — it is strictly a color change.**

- In all **36 tertian cells**, A and B are structurally **identical**
  (same mean changes, same foundation diversity — e.g. E Aeolian verse-chorus:
  A and B both 18.2 events / 16.5 changes / 5.1 roots / 6.8 foundations).
- The 18 exceptions are exactly the **3 symmetric modes × 6 structures**,
  where complexity legitimately changes the *pool* (symmetric colored
  candidates group into different foundation cores). Documented mechanism,
  not leakage.
- The color stage behaves cleanly everywhere: **0 color-stage suspensions**
  (third replacement never fires on non-sus foundations), color-only
  adjacent changes ≤ 1.4 per run, adjacent exact repetitions ≤ 1.5.

Conclusion: the "complexity" knob is innocent. Listening ratings (B vs A,
same foundations) can decide voicing-richness preference, but there is no
structural damage to repair in the color stage.

### Q3 — Does chromatic borrowing introduce most of the questionable harmonic jumps?

**In tertian modes: no. In symmetric modes: yes — and it also perturbs the
diatonic journey itself.**

Per-run chromatic foundation content, config C vs A (from `audit-summary.md`):

| Context | C: chromatic events/run (duration share) | A: baseline |
|---|---|---|
| E Aeolian (verse-chorus) | 0.2 (0.7%) | 0 |
| C Ionian (verse-chorus) | 0.3 (0.9%) | 0 |
| D Lydian (verse-chorus) | 1.3 (4.2%) | 0 |
| D Phrygian (verse-chorus) | 0.6 (1.9%) | 0 |
| C Whole Tone (verse-chorus) | **5.3 (17.7%)** | 0 |
| C Whole Tone (full-form) | **16.2 (28.7%)** | 0 |
| D Diminished (Whole-Half) (full-form) | **9.8 (18.6%)** | 0 |

- 66.6% of config-C runs (1,438/2,160) contain ≥1 chromatic foundation, but
  in tertian contexts these are few and mostly mode-plausible (parallel-mode
  provenance recorded per event; e.g. F minor in E Aeolian → Phrygian/
  Aeolian/Locrian provenance — the bII region).
- **Whole Tone and Diminished contexts are the anomaly**: their diatonic pool
  is tiny (Whole Tone ≈ 3.5 foundations in config A), and borrowing 'some'
  floods it with parallel-tertian triads (F minor, A minor, G major…) that
  occupy up to 29% of duration. These are the "questionable chromatic
  choices" the E Aeolian-era complaints anticipated — concentrated where the
  mode is symmetric.
- **Interaction effect**: A vs C diverge structurally in **54/54 cells**; in
  the sampled E Aeolian verse-chorus runs, **0/3 seeds** share A's foundation
  sequence. Enlarging the pool changes the beam search's whole trajectory —
  borrowing doesn't just add chromatic chords, it reshuffles which *diatonic*
  chords get chosen. This is a system-interaction finding: pool size itself
  is a musical variable.

Seed-34 E Aeolian verse-chorus (config C) shows both effects in one example —
the journey gains Am/D (fine), but the resolved arrival lands on **E major
[chromatic approach]** — the borrowed "picardy" tonic-major replacing the
expected minor arrival (see `matched-samples.txt`).

### Q4 — Does the generator maintain its tonal center across complete phrases?

**It establishes the tonic at the opening and at resolved cadences, but the
interior drifts — systematically toward the relative-major pole in Aeolian.**

- Tonic-rooted duration share by mode (config A, verse-chorus): Phrygian
  43.8% · Harmonic Minor 24.8% · Ionian 19.6% · Aeolian **15.6%** · Dorian
  16.5% · Lydian 14.5%.
- Non-arrival phrases end tonic-rooted only 3.3–7.3% of the time (open/
  transitional/modal/ambiguous intentions — by design, but combined with the
  root-share numbers it means the tonic is rarely *sounding* mid-phrase).
- The E Aeolian root profile (Q1) shows where the time goes instead: the
  G-major/B-minor pole ≈ 49%. Long stretches are harmonically indistinguishable
  from the relative major — this is precisely "establishes the tonic briefly
  and then drifts toward another center".

### Q5 — Are phrase endings musically convincing?

**The endings land where they promise; the road there is often weak.**

Resolved arrivals (n=5,661 across the full corpus, all configs) realize as:

| Approach family | Share of resolved arrivals |
|---|---|
| (no family — arrival absorbed into a sustained chord) | 30.4% |
| stepwise | 17.4% |
| coloristic | 14.3% |
| modal | 12.8% |
| chromatic | 11.4% |
| plagal | 6.6% |
| pedal | 3.9% |
| functional-tonal | 3.3% |

- **89.5%** of resolved arrivals end on tonic-root harmony — the *destination*
  is right.
- But the *approach* is weak: dominant-class approaches (stepwise +
  functional-tonal) account for only **20.7%** of resolved arrivals;
  coloristic/modal/chromatic account for 38.5%; and **30.4% of "resolutions"
  are simply the previous chord continuing to sound** across the cadence
  point — legitimate under the 4.3B continuation model, but for a `resolved`
  intention it dilutes the sense of arrival.
- Config C adds chromatic approaches (e.g. seed 34's resolved arrival
  realized as `E major [chromatic]` instead of a minor-key cadence —
  `matched-samples.txt`).

The cadence *planner* (Phase 3) is picking sensible intentions; the *arrival
realization* (structural scoring at arrivals) admits weak approach families
too often for `resolved` endings.

### Q6 — Does harmonic continuation (4.3B) improve pacing, or just lengthen awkward harmonies?

**It improved pacing, and it is not the source of the problem.**

- 4.3B corpus baseline (Phase 4.3B `CORPUS_COMPARISON.md`): harmonic activity
  per opportunity 0.890 → 0.547 (E Aeolian); holds/run 3.4 → 7.5; mean chord
  duration 2,077 → 3,872 ticks; cross-phrase sustains 17 → 33; max sustained
  run 2 → 12 slots; cadence realization 90.1% → 100%; distinct roots/phrase
  4.56 → 3.47 (down = less churn).
- In this audit: ~14 holds per verse-chorus run, changes/bar ≈ 1.0 against a
  2/bar preference, no zero-length/gap artifacts (Test 5), and pacing spreads
  are reasonable (Q1).
- The sustained harmonies are the *same drifting roots* — continuation
  faithfully holds what structural selection picks. Fixing the drift fixes
  what gets held.

### Q7 — Does the generator preserve recognizable harmonic identity across repeated sections?

**Yes — this subsystem works.**

- Related-section foundation overlap: **88.2% mean** (1,080 pairs, range
  44–100%).
- Recurring 3-foundation motifs in **40/40** full-form runs (A and C alike).
- `preserveIdentity` reuse is visibly active (matched comparisons show
  Verse/Verse′ and Chorus/Chorus′ sharing material in full-form).

### Q8 — Which subsystem should be improved next?

Ranked by evidence strength:

1. **Structural tonal gravity (highest priority).** The tonic's structural
   share is 12–21% in exactly the modes where the user expects modal identity
   (Aeolian/Dorian/Lydian), with the relative-major pole dominating Aeolian.
   Present in config A ⇒ caused by the structural path evaluator's stability/
   movement balance and pool weighting, not by color or borrowing. 4.3A
   removed out-of-key foundations; it did not give the tonic *within-key
   gravity*. Next change: strengthen tonic-region pull in the structural
   score (existing stability evidence + position scoring — no quotas, no
   fixed rules), verified against this audit's tonic-duration and
   G-pole metrics.
2. **Cadence approach realization.** Dominant-class approaches (stepwise +
   functional-tonal) realize only 20.7% of `resolved` arrivals, and 30.4%
   sustain across the cadence point. Next change: tighten arrival-fit
   weighting of approach families for `resolved`/`deceptive` intentions
   (Phase 3 already computes family compatibility; the scorer under-uses it).
3. **Symmetric-mode borrowing gate.** Whole Tone/Diminished contexts import
   parallel-tertian triads at up to 29% duration. Next change: make borrowing
   availability mode-aware for symmetric scales (weight, not prohibition).
4. **Not targets:** color stage (clean), harmonic rhythm/continuation
   (working), phrase planning (intentions sound), section identity (88%
   overlap), beam search mechanics (deterministic, 0 failures).

## 3. What the numbers cannot say

Whether any configuration "sounds good" is a human judgment. The audit kit
provides, under identical conditions (same tempo/voicing/velocity/phrase
boundaries):

- `latest/midi/*.mid` — 486 audition files (seeds 1–3 × every cell × config).
- `listening-template.md` — rubric + rating table + the progressions to rate.

Priority listening: E Aeolian verse-chorus seeds 1–3 (A/B/C back-to-back),
then the same for C Whole Tone config C (predict: clearly foreign chords) and
D Phrygian config A (predict: strongest tonal center). The metrics predict
**A ≈ B** (identical harmony, different voicing richness), **C more
adventurous but differently-shaped journeys**, and **C Whole Tone C the
least mode-coherent**.

## 4. Reproduction

```bash
npm run harmony:audit -- --all --seeds 40 --out diagnostics/harmony/audit/latest --tag phase43c --midi --listen
npx vite-node scripts/analysis-audit43c.ts diagnostics/harmony/audit/latest/audit-results.json
npm run harmony:diagnose -- --seed 34          # deep dive on one run
npx vitest run tests/harmony-audit.test.ts     # 11 infrastructure tests
```

Single context: `npm run harmony:audit -- --key E --mode Aeolian --seeds 30`.
Files in this directory: `audit-results.json` (aggregates for all 40 seeds ×
all cells; progressions for seeds 1 & 34), `audit-summary.md` (54-cell
aggregate table), `matched-samples.txt` (seed-34 comparisons for every
context + E Aeolian seeds 1), `listening-template.md`,
`analysis-output.txt` (raw analysis printout). The complete corpus
(including all progressions and MIDI) is written to
`diagnostics/harmony/audit/latest/` and is reproducible with the command
above.

## 5. Production-equivalence statement

No production file was modified. The audit invokes
`generateChordProgression` with `settings` overrides only (the same public
option the UI uses). Tests 1 and 10 in `tests/harmony-audit.test.ts` pin
this: audit runs are byte-identical to direct generation, and audit
invocation leaves no state behind. The full existing suite (283 tests + 11
new) passes.
