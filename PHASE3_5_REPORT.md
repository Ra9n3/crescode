# Phase 3.5 Report — final-bar guarantee + peak reservation

**Suite: 694/694 passed (29 files) · tsc clean · `npm run build` green (single-file `dist/index.html`) at every commit.** Commits: `f9a4b21` (fix 1), `e549c1a` (fix 2), report commit.

## Fix 1 — the final bar always sounds

- The conductor planned a fillGating breath on every section's last bar, including the song's final bar — strings went silent exactly on the landing chord (chamber bar 16 mean E was 0.126, hybrid 0.313).
- `conduct()` now skips the breath AND the fill window when the section's last bar is the song's final bar (a fill window without its rest would have been a hard fillGating finding).
- The arc's near-silence guard is explicit: `firstChorus.startBar − 1 < bars` (belt-and-braces — it could never reach the final bar, now the code says so).
- Test: all six templates on the dorian fixture — every in-band string track sounds in the final bar, and no breath/fill window overlaps it; the three fillGating templates still gate fills elsewhere (not vacuous).
- Bar 16 mean E after: chamber 0.513, hybrid 0.528, sonata violins1 rejoins (0.394 → 0.563).

## Fix 2 — peak reservation

- Named constant `PEAK_RESERVE = 0.88` (`spine/energyArc.ts`); `peakSectionOf()` picks the peak: last Chorus by start bar, else last non-outro section (`/outro|coda|fade/`), else last section.
- After the arc shapes its bars, the peak section is scaled so its loudest bar sits exactly at the clamp max; every other section's targets cap at `PEAK_RESERVE × clampMax`. Near-silence bars are re-zeroed last so neither scale nor cap can resurrect them.
- Skipped for structureless projects: one pseudo-section has nothing to contrast against, and scaling it to the clamp would flatten the whole arc.
- Test: chamber, sonata, vocalbacking (+ the other three) — exactly one section reaches within 3% of the clamp, it is the last Chorus, all others ≤ 88%; `measureEnergy` never exceeds the clamp and reports zero aboveMax violations. Scaling path exercised on cinematic (raw chorus top 0.81 → 0.95).
- Audible result: symphony chorus bars +3.7%, cinematic +17% (0.518 → 0.542 mean E on bar 9); verses unchanged (already under the cap).

## Listening map (dorian fixture, take 1; per section: mean E per bar + per-string-track layer)

```text
Symphony Orchestra (clamp 0.25–0.85, maxLayers 7, policy allowed)
  measureEnergy: max 0.595 · strings notes 108
  Verse (bars 1–8):
    mean E/bar: [0.143, 0.170, 0.173, 0.167, 0.176, 0.175, 0.168, 0.058]
    cellosBasses+violas+violins1+violins2: pad 1–7, REST (nearSilence+nearSilence) 8
  Chorus (bars 9–16):
    mean E/bar: [0.495, 0.500, 0.538, 0.528, 0.545, 0.539, 0.562, 0.502]
    cellosBasses+violas+violins1+violins2: pad 9–16
Chamber (clamp 0.2–0.7, maxLayers 5, policy climaxOnly)
  measureEnergy: max 0.697 · strings notes 108
  Verse (bars 1–8):
    mean E/bar: [0.426, 0.405, 0.458, 0.453, 0.456, 0.458, 0.474, 0.087]
    cellosBasses+violas+violins1+violins2: pad 1–7, REST (fillGating+nearSilence) 8
  Chorus (bars 9–16):
    mean E/bar: [0.621, 0.634, 0.649, 0.635, 0.648, 0.610, 0.625, 0.513]
    cellosBasses+violas+violins1+violins2: pad 9–16
Cinematic (clamp 0.35–0.95, maxLayers 9, policy allowed)
  measureEnergy: max 0.655 · strings notes 108
  Verse (bars 1–8):
    mean E/bar: [0.192, 0.207, 0.222, 0.208, 0.215, 0.208, 0.201, 0.086]
    cellosBasses+violas+violins1+violins2: pad 1–7, REST (nearSilence+nearSilence) 8
  Chorus (bars 9–16):
    mean E/bar: [0.542, 0.552, 0.595, 0.577, 0.580, 0.569, 0.596, 0.513]
    cellosBasses+violas+violins1+violins2: pad 9–16
Sonata (clamp 0.15–0.65, maxLayers 3, policy forbidden)
  measureEnergy: max 0.648 · strings notes 54
  Verse (bars 1–8):
    mean E/bar: [0.433, 0.431, 0.496, 0.480, 0.477, 0.471, 0.483, 0.144]
    cellosBasses: pad 1–7, REST (nearSilence+nearSilence) 8
    violins1: pad 1–7, REST (fillGating) 8
  Chorus (bars 9–16):
    mean E/bar: [0.626, 0.612, 0.613, 0.625, 0.604, 0.614, 0.614, 0.563]
    cellosBasses+violins1: pad 9–16
Vocal Backing (clamp 0.15–0.65, maxLayers 4, policy forbidden)
  measureEnergy: max 0.649 · strings notes 81
  Verse (bars 1–8):
    mean E/bar: [0.372, 0.350, 0.397, 0.391, 0.391, 0.391, 0.403, 0.087]
    cellosBasses+violas+violins2: pad 1–7, REST (nearSilence+nearSilence) 8
  Chorus (bars 9–16):
    mean E/bar: [0.629, 0.609, 0.624, 0.635, 0.621, 0.619, 0.618, 0.567]
    cellosBasses+violas+violins2: pad 9–16
Hybrid Studio (clamp 0.3–0.9, maxLayers 8, policy allowed)
  measureEnergy: max 0.593 · strings notes 108
  Verse (bars 1–8):
    mean E/bar: [0.211, 0.228, 0.245, 0.238, 0.237, 0.238, 0.230, 0.099]
    cellosBasses+violas+violins1+violins2: pad 1–7, REST (fillGating+nearSilence) 8
  Chorus (bars 9–16):
    mean E/bar: [0.547, 0.543, 0.556, 0.550, 0.559, 0.546, 0.563, 0.528]
    cellosBasses+violas+violins1+violins2: pad 9–16
```

Every template's peak is the Chorus and every string track plays `pad` through bar 16; the only rests are the planned breaths on bar 8 (near-silence, plus sonata's violins1 fillGating breath). Numbers reproduced by `npx vitest run tests/phase3-listening.test.ts`.

## Deviations

- "Reaches within 3% of the clamp" is asserted on the PLAN's per-bar energy targets (the fix's own wording: "highest planned energy"); the measured side is asserted as "measureEnergy never exceeds it" (max ≤ clamp, zero aboveMax), since the rules generator owns the non-string velocities in the windows.
- The near-silence bar could never mathematically land on the final bar (`startBar − 1 < bars`); the guard is explicit anyway per the brief.
