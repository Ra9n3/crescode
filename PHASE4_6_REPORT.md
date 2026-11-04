# Phase 4.6 Report — texture palettes per take, a calmer ostinato

**Suite: 740/740 passed (34 files) · tsc clean · `npm run build` green (single-file `dist/index.html`).** Commit: `808a659` (items 1+2+3), report. New battery: `tests/phase46.test.ts` (16 tests). No new dependencies; CC, humanize, preview and UI untouched.

## Item 1 — texture palettes (conductor/layers.ts, the single source for plan and renderer)

- The fixed per-preset role map is replaced by a weighted PALETTE of textures per preset. Per take, ONE texture is drawn per section TYPE (all Verses share one, all Choruses share one — a type stays coherent) from the D8 seed: `hash(texture:<type>)` over `orchestrationSeedFor(project, {take})`. Same take → identical plan (byte-asserted); a new take can change it. Weights are named constants (`CINEMATIC_TEXTURE_WEIGHTS` etc., each summing to 100) and the draw also seeds the style: pattern shape, entry bar, and which inner track ostinates/pulses.
- Palettes (weights): cinematic leadPadBed 25 / singleOstinato 20 / interlockingOstinato 15 / pizzPulse 15 / tremoloBed 15 / trailer 10. Symphony: V1 lead with Cb pizz (45) vs sustained (25), lead handoff to V2 (15) or Vla (15). Chamber: quartet 45 / V1 leads without counterline 25 / V2 handoff 30. Sonata: soloist 70 / Cb handoff 30. Hybrid: counterline on V2 55 / on Vla 45. Vocal Backing: padBed only — every track stays a pad, asserted across 20 takes.
- Handoffs are per-carrier tune lines: `prepareStrings` now builds one motif line per tune carrier over ITS bars (same take seed, so a handed-off chorus states the same cell in the new voice's window); `StringLines.leads`/`carrierByBar` replace the single `lead` (kept as the topmost carrier). The DP fixes each carrier under its own line; `linePcs` unions all carriers.
- Every texture obeys the hard contracts: maxLayers (asserted in every bar of 40 takes), one role per track per bar (partition asserted), one voice per track, the conductor's breath windows (unchanged subtraction), the octaveDoubling policy (ostinato textures only ship on the doubling-`allowed` cinematic preset; the voicer still enforces the rest), and the vocal zone (Vocal Backing unchanged).
- Distinct role plans across 20 takes (dorian): symphony 9, chamber 8, sonata 4, hybrid 4 (≥ 2 asserted); vocalbacking exactly 1.
- Lead handoffs and the top-line audit: handoff bars are read from the plan (a `lead` slot without V1) and exempted; outside them the lead is the top sounding line in ≥ 70% of bars (matrix) — and on cinematic, where no handoff texture exists, 100% in every one of 40 takes (worst take reported).

## Item 2 — the ostinato calms down (lines/ostinato.ts + renderer gating)

- **Rate is part of the texture**: 8ths by default (`rateTicks`, half the felt beat), 16ths only for the trailer. Lengths: the trailer clips under 0.25 s through the tempo map (unchanged spiccato); every other texture plays a short but not clipped length (75% of the step for spiccato pulses, 50% for the pizz pulse) — no seconds-cap applied.
- **It does not run through every bar**: the renderer gates it per bar — it enters 1–2 bars in (the texture's seeded `enterAfter`; zero onsets in the first bar of any chorus, any take), drops out for the section's pre-change dip bar (zero onsets in every chorus's last bar, any take), and rests on the last beat of every 4th bar of the section (asserted per 4th bar). On a gated bar the ostinato rests — it does not fall through to a pad.
- **Pattern shapes seeded per take**: repeated note, chord-tone arpeggio, root-fifth (the fifth is only used when it is in the handed-in tone set — an E→B "fifth" in C Ionian must not resurrect the filtered leading tone; that regression was caught by the compose sweep and fixed). Draws over 40 dorian verse textures: arpeggio 17 / repeat 9 / rootFifth 14; `enterAfter` 1: 22 / 2: 18.
- **Interlocking** = the two tracks offset by half the rate: Vla = V2 onsets + 240 ticks, disjoint rhythms (asserted on every interlocking-chorus take), and the lower voice stays under the upper at the same step index.
- **The pulse stays under the tune**: the ostinato's ceiling is the lead's lowest pitch sounding in the window (the DP's V1 voice on a fallback span), so the lead remains the top line — the 40-take battery reads 100% lead-on-top (unisons do not displace the lead).
- Ostinato/pizz note counts per template (dorian, texture-exercising takes): cinematic trailer take — Violins II 180 + Violas 159 (16ths through both sections minus the gating); symphony all-pizz take — Cellos/Basses 56 strong-beat pizz; chamber/sonata/hybrid — none by design.

## Item 3 — the 40-take battery (dorian + three-chorus cinematic, takes 0..39)

- **Trailer frequency**: chorus 8/40 = 20.0% (weight 10/100), verse 2/40 — inside the ≤ 20% bound the phase demands; 18 distinct Verse/Chorus texture combos across the 40 takes (≥ 4 required).
- **Textures per take 1..10 (dorian, Verse/Chorus)**:

```text
take 1:  trailer / trailer            take 6:  tremoloBed / singleOstinato
take 2:  interlockingOstinato / singleOstinato   take 7:  leadPadBed / pizzPulse
take 3:  tremoloBed / singleOstinato  take 8:  leadPadBed / tremoloBed
take 4:  interlockingOstinato / pizzPulse        take 9:  leadPadBed / tremoloBed
take 5:  tremoloBed / leadPadBed      take 10: tremoloBed / pizzPulse
```

- **Calm-down**: max ostinato notes per chorus bar — trailer 32 (16ths × 2 tracks), every non-trailer take ≤ 16 (interlocking 8ths × 2; single/pizz 8) = exactly half the trailer count, asserted per take.
- **Hygiene, every take**: same take byte-identical (score and plan), `validateProject` clean, every note inside its track's hard range, `sanitizeNotes` a no-op, measured energy ≤ the clamp with no `aboveMax` violations, plan ≤ maxLayers, one role per track per bar, lead on top (cinematic: 100% of sounding bars, worst take reported).
- Updated pins: the 4e ostinato contract now scans for a trailer take (the style is texture-driven); the symphony pizz contract scans for an all-pizz take and the sustained axis is asserted too; the 4a preset pins assert per drawn texture plus a scanned quartet take; the counterline/motif listening tests scan to a take that still carries the line (handoffs move it by design), printing the take tables.
