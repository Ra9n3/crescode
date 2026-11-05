# Phase 8 Report — post-moments hardening (four answers)

**Suite: 886 tests / 46 files green (877 + 9 in `tests/phase8.test.ts`) · tsc clean (src + tests) · single-file build green · e2e smokes 54 + 41 + 35.** No new dependencies. No schema change. Composition is unchanged outside the moment bars (pinned: 50,579 notes byte-identical to the moments:false runs).

## 1. Vocalbacking hard findings — FALSE POSITIVE, exempted

**Archaeology.** The finding class is as old as the checker: at `95c7c67` ("Orchestrator energy … notes-only template rule checker", the first commit that could observe it) a composed Vocal Backing project already reports hard octave doublings (238 on the dorian fixture — harp/piano arpeggios against the sustained pads). On the three-chorus fixture the count was 160 (16/take) at `414ed71` (Phase 4.5) and `fca21a0` (4.6), 30 (3/take) at `e76c72e`–`b47ce3e` (5d–5.1.3, the D10 forced-doubling exemption flipping in and out with note spans), and **exactly 20 (2/take) from `d8d7d88` (Phase 5.5) through Phase 7**.

**Rule and why.** `octaveDoubling`, policy `forbidden` (vocalbacking.json) → hard. Both findings are the legacy rules generator's harp — an eighths arpeggio over chord tones (Intro "Harp arpeggio", Chorus "Harp arp", Outro "Harp final") — landing for one eighth note an octave (or two) from a sustained string pad: harp 77 vs the V2 pad 89 (bar 37, every take, ±humanize jitter), harp 62 vs the Cb pad 38 (bar 40). The engine makes no cross-part policy decisions; the arpeggio just passes through the register.

**Verdict.** False positive for this shape: a broken-chord figuration note under a longer sustained line is not a layer double — D2's `forbidden` targets stacked pads (the Cb+Vc case). Exemption added in the checker's forbidden branch (audit-only, zero composition change):

```ts
if (d.a.trackId !== d.b.trackId && shortN.durationTicks <= barTicks(p.timeSignature) / 2 && longN.durationTicks > shortN.durationTicks
  && chordHere !== null && chordTones(chordHere.parsed).tones.some((t) => t.pc === ((shortN.pitch % 12) + 12) % 12)) continue;
```

Pinned narrow by unit tests: long+long still hard, two shorts colliding still hard, same-track still hard, and the D10 forced exemption is untouched. **Zero hard findings now across all six templates × every surveyed take** (the pre-existing-20 printout in phase7 is empty). Sonata's policy never produced findings (no Keys roster) and still doesn't.

## 2. Divisi in exports (cinematic + symphony, UVI profile) — all four checks pass, nothing broke

- **Keyswitches**: recomputed independently over each divisi part's merged notes — counts match the emit-on-change rules exactly, no duplicates (same pitch+start), every keyswitch ends at or before its trigger. The div2 notes ride the parent part, so a divisi never adds or displaces a keyswitch.
- **Tremolo merge**: `mergeTremoloGroups` groups per pitch — measured on a violas divisi carrying 7 simultaneous tremolo pitches and a violins2 divisi carrying 5: every pitch merges independently (group counts equal the per-pitch independent merge), no cross-line gluing, no dropped pitch.
- **Red-zone/range guard + cbLayer 'omit'**: every div2 note sits inside its track's hard range, survives `sanitizeNotes` unchanged (still a no-op), and reaches the exported part chunk under the default `omit` profile — nothing dropped.
- **Preview**: `planTrackNotes` plans both lines — every div2 note sounds (tremolo repeats ride their per-pitch merged spans, the AM plays over the span — the designed preview behaviour for measured repeats, parent line included).
- Round-trip smoke: a divisi take exports merged (parses, 19 tracks) + 18 per-track files with the profile on.

## 3. Soft findings — moments LOWERED both

| rule | moments ON | moments:false | Δ |
|---|---|---|---|
| overlapAvoid | 2005 | 2159 | **−154** (symphony −14, cinematic −140) |
| octaveDoubling climaxOnly | 13 | 14 | **−1** (chamber) |

Survey: six templates × takes 1–10 (three-chorus) + 1–6 (dorian). The moments replace texture onsets that collided with the overlapAvoid `against` entrances, so both soft counts drop; nothing rose.

## 4. Humanize/legato seeding — CHEAP, DONE (per note)

- **humanize.ts**: the per-note timing jitter, velocity jitter and the Cb follow are hashed from the note's own identity (`trackId:startTick:pitch`, salted per purpose) instead of a sequential stream; only the per-section base offsets still ride the take stream (the section list never depends on the notes).
- **legato.ts**: the 10–30 ms overlap is hashed from the join's own identity (`trackId`, the two written starts).
- Enabling planning fix (the moment notes re-ordered the note sets the streams were read over): the DP's voicing fixes, the pad's pc constraints, the carrier map and the counterline now all read the PURE TEXTURE plan; the soli carrier's own line is built beside the DP (like the div2 line) when the texture line has no notes on its bars. The moments render on their bars; the plan underneath never moves.
- **Result: 50,579 notes outside moment bars byte-identical** (pitch, start, duration, velocity, articulation, layer) to the moments:false runs across six templates × takes 1–10. The only residual diffs: 23 legato tails whose written end reaches INTO a moment bar — the bow-change crossfade into the moment's entry note; the target notes are the moment's own, so this class is irreducible (pinned as the one exemption in the test).

## Files changed

- `src/orchestrator/energy/rules.ts` — the figuration exemption (forbidden branch, one condition + comment), `barTicks` import.
- `src/orchestrator/expression/humanize.ts` — per-note seeded jitter (timing/velocity/Cb follow); section bases unchanged.
- `src/orchestrator/expression/legato.ts` — per-join seeded overlap; div2 join transparency (a div2 note is never the other line's join target; a non-octave div2 sister never blocks, an octave/unison one still does — the transient-pair guard keeps its teeth).
- `src/orchestrator/conductor/layers.ts` — `tuneCarrierForBar`/`assignStringLayers` gain `ignoreMoments` (the pure texture plan).
- `src/orchestrator/render.ts` — the carrier map/lines/counterline/fixes/pcs read the pure texture plan; the soli carrier's line built beside the DP (`soliLineByTrackId`) and consulted only on its bars; the counterline drawn over the texture bars with moment bars overridden by their layer (the imitation pattern, generalized).
- `scripts/make-golden.ts` — composes with `moments: false` (matching the phase55 harness); golden bytes regenerated for the reseeded jitter.
- `tests/phase8.test.ts` (new, 9 tests); `tests/golden/*` regenerated.

## Wasn't possible / notes

- The 23 entry-crossfade tails are irreducible: the join target inside a moment bar is the moment's own note, so a with/without pair cannot agree there without dropping the crossfade (which the without-run has).
- Two-short figurations colliding at the octave remain hard by design (the exemption demands one sustained side); if a future template arpeggiates on both hands, the condition would need a second clause.
