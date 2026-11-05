# Phase 7 Report — moments (the rare designed gestures)

**Suite: 877 tests / 45 files green (862 + 15 in `tests/phase7.test.ts`) · tsc clean (src + tests) · single-file build green · e2e smokes 54 + 41 + 35.** No new dependencies. Schema: one additive optional value (`Note.layer?: 'cb' | 'div2'`). The moments are an in-memory conductor annotation — never persisted, never stored; old projects without orchestration are untouched (pinned).

## Files changed

- `src/orchestrator/conductor/moments.ts` **(new)** — the planner (own salted D8 stream: `hashString('moments')` over the (inputs, take) seed), the availability table, the divisi second line (`resolveDivisiSpans`: a scoped run of THE voicing DP with the part contributing two voices — parent pinned `VoiceFix 'pitch'`, second line `VoiceFix 'below'`, a new additive fix kind), the imitation answer generator.
- `src/orchestrator/conductor/index.ts` — `plan.moments` beside the textures (after the breaths, before rendering), per-bar `moment` annotation.
- `src/orchestrator/conductor/layers.ts` — the moment override in `stringLayerForBar` (tutti/unison/soli-tacet/imitation-counterline), soli carrier in `tuneCarrierForBar`, `layerSlotsForBar` reads the pure texture plan.
- `src/orchestrator/render.ts` — unison (lead line spread by octave, LT never doubled, range notes octave-moved never dropped), tutti (marcato hit + hold/decay/breath from the DP pitch), div2 writing (pad + tremolo beds), soli tacet, imitation answers replacing the free counterline on their bars only, divisi resolution after the DP (empty moments dropped + reported), Cb layering skips `div2` (Vc keeps 2 voices + 1 Cb), and a latent fix: the tremolo carrier check is now BAR-scoped.
- `src/orchestrator/compose.ts` — the tutti roster hit for the non-string families (the moment is defined over `participantRoles` = the whole roster; strings are only the first participants), in-band/locked guards, `moments?: false` option for the draw-identity pins.
- `src/orchestrator/voicing/voiceLead.ts` — `VoiceFix 'below'` (strictly below AND a different pitch class). Existing callers never pass it: byte-identical.
- `src/orchestrator/expression/legato.ts` — under a doubling-forbidding policy the crossfade no longer creates transient octave/unison pairs with another track ('allowed' templates byte-identical).
- `src/shared/schema/types.ts`, `validate.ts`, `project.schema.json` — `layer?: 'cb' | 'div2'`.
- `src/export/profile.ts` — `mergeTremoloGroups` groups PER PITCH (a divisi part's two interleaved repeat lines each merge; single-voice parts unchanged — phase55 counts stay pinned).
- `tests/phase7.test.ts` **(new)**; `tests/phase51.test.ts` (matrix timeout, now runs WITH moments — 108 cells green incl. moments); 5 older test files compose with `moments: false` where they pin pre-moment texture/contract output.

## Per template, moments planned (takes 1–10 three-chorus + 1–6 dorian)

| template | unison | tutti | soli | divisi | imitation |
|---|---|---|---|---|---|
| symphony | 15 | 6 | 12 | 3 | 6 |
| cinematic | 14 | 8 | 10 | 8 | — (no counterline/handoff in its palette) |
| hybridstudio | 14 | 6 | 10 | 7 | 7 |
| chamber | — (climaxOnly) | — (5-player roster) | 15 | 7 | 11 |
| sonata | — (forbidden) | — | 17 | — | 0 (its only handoff lead is the bass — no lower voice answers) |
| vocalbacking | — | — | — | — | — (pad-only preset: nothing) |

**three-chorus-40bars take 1, timeline by bar:** symphony — unison 5–8, divisi 18–21 (V2), soli 25–28 (Vc), tutti 29; chamber — imitation 25–28 (V2), divisi 30–33 (Vla); cinematic — unison 16–19, soli 25–28 (Vc), tutti 29; sonata — soli 29–32 (V1); hybridstudio — unison 16–19, soli 25–28 (Vc), tutti 29; vocalbacking — none.

## Findings

- **Hard findings ON moment bars: 0** (pinned across the whole survey). Outside moment bars the checker reports **20 pre-existing findings** (2 per take × 10 vocalbacking takes: the rules generator's harp against the pads under a forbidding policy — moments:false reproduces them; left alone per "don't disturb the existing draws").
- Most common soft finding: `energy` below-floor (2954 windows — strings-only textures in large rosters, expected per spec §6), then `overlapAvoid` (2005, soft by design), `octaveDoubling` climaxOnly (14, soft).
- **Texture draws unchanged:** for all six templates × takes 1–10 the drawn texture per section type is byte-identical with and without moments, and the per-bar layer plan differs ONLY on moment bars (pinned by the moments:false comparison).
- Energy clamp: 0 `aboveMax` violations across the survey (moment notes ride the whole-roster cap and the arc).

## Wasn't possible / workarounds

- **Humanize/legato micro-jitter outside moment bars is not byte-identical** to a no-moments run: those streams are note-sequential, and moment notes re-order the draws. What IS pinned unchanged: the texture draws, the DP voicing (the divisi mini-DP and the soli/imitation handling deliberately avoid touching the main run's constraints or streams) and the layer assignment outside moment bars.
- The legato crossfade tail (10–30 ms) can transiently overlap the next span's div2 line — the same transient class the compose sweep already exempts; the divisi test measures crossings only beyond the humanize head.
- The imitation test traces the answer against the RENDERED lead; sanitize merges same-pitch lead notes (humanize overlap), so the rhythm match is pinned as a strict majority (≥ 50%) traced at +delay through merged spans — the subset direction (answer onsets = motif onsets + delay) is structural in the generator.
- Sonata draws no imitation: its only handoff gives the lead to the cellosBasses, and the answer must sit below the lead (register rule) — there is no lower voice.
- Vocal Backing gets no moments by design (pad-only preset; the vocal owns the moments) — the availability table is data in `moments.ts`.
