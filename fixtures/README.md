# Fixtures

Development inputs for the harmony diagnostic CLI (`npm run harmony:diagnose`).
Fixture projects are READ-ONLY inputs: the CLI never writes chords back into
them and never mutates the files.

## example-e-aeolian.json

The closest reproducible configuration for the problematic E Aeolian
progression investigated in Phase 4.2:

```text
Esus4 → Gsus4 → C → Bsus4 → Bm → G → Abm → Bm → G → Em → C → Csus2 → Bm
```

**Documented differences from the original screenshot** (Phase 4.2 spec §16):
the exact seed and generator settings that produced the screenshot are not
available. This fixture reconstructs the closest available setup — E Aeolian,
4/4, a Verse (8 bars) + Chorus (8 bars) form, and the default generator
settings (complexity 2, borrowing `some`, variation 0.5) — which is the
configuration class the failing outputs were reported from. Run several seeds
(`--seed 1..N`) to find runs that exhibit the same failure shapes (suspended
openings, chromatic departures, dense foundation changes); each run's report
explains that run's actual decisions. Do not pretend any single run IS the
screenshot run.
