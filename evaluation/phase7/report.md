# Phase 7 — first piano evaluation

**Scope:** Chamber, Sonata, Vocal Backing, Cinematic, Hybrid Studio  
**Status:** Exports and score-level evaluation complete. **This is not a listening verdict:** no audio was rendered, inspected, or listened to.

## Executive finding

Composer V1 + Realizer V1 produced valid, deterministic piano parts with clearer template-specific register/density choices and strong pitch-class alignment to the supplied harmony. They are generally sparser and more sustained than the legacy parts; that is a difference, not evidence by itself of better music. Vocal Backing and Cinematic show the clearest register/texture adaptation in this one sample, while Hybrid Studio does not yet realize much of its stated syncopated identity.

Two concrete realization gaps stand out: several Composer-planned suspensions are incomplete in Sonata and Cinematic, and the new piano writes attacks in the shared bar marked as near-silence for every template. The Chamber and Sonata MIDI also remain highly concurrent with their string/solo lines despite their rest-response descriptions. These findings are reported, not fixed. A musical winner cannot be declared without an actual playback/listening pass.

## Inputs and paired-comparison method

- Source: `fixtures/dorian-16bars.json`, copied to `inputs/dorian-16bars.json` — D Dorian, 100 BPM, 4/4, 16 bars; Verse and Chorus (8 bars each); 18 chord events.
- Each template started from the same fixture expanded with the app's default tracks, that template's roster, and `orchestration.take = 0`. Compose options were `density = 1`, `humanize = true`, and `moments = true`; the compose result was take 1.
- For each template, the deterministic orchestration-derived 32-bit seed was passed as the legacy Compose seed and was also the Piano Engine / Composer plan seed. The same compose result supplied the legacy piano and the finalized non-piano arrangement; the new pipeline read that result's `pianoEngineInput` and replaced only piano notes for the new-piano/combined exports. Non-piano notes and CC lanes were fingerprinted and retained unchanged within each pair.
- The template changes the orchestration seed by design, so the numeric seed differs **between** templates; each legacy/new pair uses the exact same numeric seed and comparison-input fingerprint.

| Template | Paired seed | Legacy take → new take |
|---|---:|---:|
| Chamber | `4001943009` | 1 → 1 |
| Sonata | `1759893709` | 1 → 1 |
| Vocal Backing | `130786751` | 1 → 1 |
| Cinematic | `3899254770` | 1 → 1 |
| Hybrid Studio | `3597702329` | 1 → 1 |

Each case was regenerated once with the same input. Legacy notes, new notes, non-piano arrangement snapshots, and all four MIDI exports were byte-identical on repeat. Per-template hashes and full project/engine inputs are in `manifest.json`. This is one composition and one deterministic seed per template—a pilot sample, not a general estimate across songs or seeds.

## Note and arrangement statistics

The note counts and complexity figures are descriptive only; they are not quality scores. Pitch is MIDI note number; velocity is the exported 1–127 MIDI velocity range. “Max overlap” is the largest number of simultaneous piano note events in the realized note data.

| Template | Piano notes (legacy → new) | Pitch range (legacy → new) | Velocity range (legacy → new) | New max overlap | New chord spans with an onset |
|---|---:|---:|---:|---:|---:|
| Chamber | 48 → 24 | 38–84 → 45–75 | 47–92 → 22–72 | 3 | 14 / 18 |
| Sonata | 79 → 41 | 38–84 → 45–81 | 46–92 → 22–72 | 4 | 17 / 18 |
| Vocal Backing | 114 → 26 | 38–105 → 45–69 | 46–92 → 29–72 | 3 | 15 / 18 |
| Cinematic | 78 → 33 | 38–93 → 33–93 | 33–92 → 29–85 | 3 | 16 / 18 |
| Hybrid Studio | 87 → 24 | 38–96 → 45–81 | 36–92 → 29–70 | 3 | 16 / 18 |

Reference arrangements used in the exports (piano removed) contain: Chamber 4 active tracks / 101 notes; Sonata 2 / 67; Vocal Backing 4 / 147; Cinematic 16 / 979; Hybrid Studio 14 / 363. The exact per-track notes and CC snapshots are under `inputs/reference-arrangements/`.

## Musical comparison

### Harmony and voice leading

- The new Composer planned 18 harmonic events in every case. New piano attacks fall on a plan-defined chord pitch class for 23/24 Chamber notes and for every note in the other four cases. This is a useful alignment check, not a complete judgment of harmonic correctness; planned non-chord tones and voice-leading context still matter.
- Piano attacks occur in 14–17 of the 18 chord spans. Some spans are carried by sustained notes rather than a fresh attack.
- Tagged low anchors in the new parts move economically in this sample: the largest step between successive unique anchor starts is 3–5 semitones, depending on template.
- Using the Phase 6 suspension-test pattern (an `answer` in the planned tension pitch class crossing the chord boundary, followed by a `settle` in the resolution pitch class within the new chord), realization was complete for Chamber 1/1, Sonata 1/4, Vocal Backing 1/1, Cinematic 2/5, and Hybrid Studio 1/1. In Sonata, C/E (c07) has neither half; C (c16) and Dm7 (c18) lack a matching settle. In Cinematic, Em7 (c04), Fmaj7 (c05), and Dm7 (c18) have resolution-tagged notes without a matching prepared crossing note. This is a Composer-plan-to-Realizer follow-through defect in this sample, not a MIDI export failure.
- The new piano files contain no overlapping piano-note pairs exactly an octave apart in these five samples. A simple pairwise counter found 26 such overlaps in legacy Sonata and 22 in legacy Vocal Backing, whose template policies forbid octave doubling. This is a score-level template-fit warning; the counter does not infer intended voice assignment, so it should not be treated as a complete policy audit.

### Phrase shape, density, and rhythm

- The new plans produce 2–4 phrases per 16-bar piece (Chamber 4; Sonata 3; Vocal Backing 2; Cinematic 3; Hybrid Studio 3), with role-tagged answer events of 6, 6, 3, 7, and 2 respectively. The phrases and motif operations are inspectable in `analysis/composer-plans/`.
- New parts have lower maximum polyphony (3–4 simultaneous notes) than the legacy parts (5–7). Average new note lengths are about 0.69–1.05 bars, and individual holds reach roughly 2–3 bars depending on template. This supports a more open texture, but long holds can reduce perceived motion or carry through lead activity; that needs playback assessment.
- Legacy attacks are humanized: in this sample every legacy onset falls within 20 ticks of a sixteenth-note grid point (at 100 BPM, 20 ticks is 12.5 ms), but none is exactly grid-aligned. New events are mostly grid-aligned. This reflects `humanize = true` on the legacy Compose path versus the direct Composer/Realizer output; it is not a like-for-like timing-quality result.
- Hybrid Studio is the clearest style mismatch: 22/24 new attacks are on quarter-note grid points and 23/24 on eighth-note points, with only 2 answer-tagged events. The plan calls for a syncopated pulse-and-color language, but this seed realizes little rhythmic displacement or motif response.

### Register, dynamics, and template fit

- **Chamber:** New register is compact (45–75) and max overlap is 3, consistent with an intimate palette. However, 90.1% of summed piano note-time overlaps the union of written string activity, and 19/24 piano attacks begin while at least one string note is active. This improves on the legacy part's near-continuous string overlap, but is not strict “answer in the strings' rests” behavior. The explicit near-silence/fill window also receives two new piano attacks (velocities 22 and 29) despite a `leave-space` fill decision.
- **Sonata:** The new part narrows the register (45–81) and uses at most 4 simultaneous notes; its bass anchors are connected. But 94.6% of summed piano note-time overlaps written Violins I activity, and 22/41 piano attacks begin during a violin note. Sustained tails account for much of the overlap, so this is not an audibility claim, but it weakens the advertised call-and-response feel. Suspension completion is also low (1/4).
- **Vocal Backing:** The new register is substantially lower and narrower (45–69 versus legacy up to 105), with at most 3 simultaneous notes. That is directionally consistent with leaving upper space. The fixture has no singer track, however, so vocal clearance cannot be evaluated; the result is only judged against the instrumental backing. It has two planned phrases and relatively few answer events.
- **Cinematic:** The new piano uses the broadest range (33–93) and the widest sampled velocity span (29–85), over a large reference arrangement (16 tracks / 979 notes). It remains sparse (33 notes, maximum overlap 3), which may give orchestral color without crowding, but could also be too subtle in playback. The suspension follow-through (2/5) is a clear weakness.
- **Hybrid Studio:** New register is bounded (45–81), with a stepwise anchor line and at most 3 simultaneous notes. Its 24-note part is mostly sustained and grid-bound, with only two answer events; the intended pulse/syncopation is not evident from this one realization.

The mean new-note velocity rises from Verse to Chorus in every template (approximately 33–40 to 63–72, averaged over attacks), while staying below the legacy means in this sample. This is evidence of a written dynamic contour, not a claim about perceived loudness: the exports carry no instrument program, and no audio was heard.

### Near-silence behavior

The composed context marks bar 8 as `nearSilence` with energy target 0 for every template. Each legacy piano part has no attack in that bar. The new parts attack there 2 times in Chamber, 5 in Sonata, 1 in Vocal Backing, 1 in Cinematic, and 2 in Hybrid Studio; these are low-velocity events (22–32). This may be an intended quiet trace rather than a hard-zero requirement, but it is a consistent behavior worth explicitly deciding and testing. In Chamber it also conflicts with the local `leave-space` decision.

## MIDI verification and DAW notes

Twenty files were written: four per template. Every file round-tripped through Crescode's MIDI parser as Type 1, 960 PPQ, 100 BPM, 4/4, with Verse at tick 0, Chorus at tick 30,720, and every track ending at tick 61,440 (16 bars / 38.4 seconds). Parsed note counts and pitch/start/duration/velocity data matched the source notes; controller events matched the source CC lanes; all parsed notes had valid MIDI pitch/velocity, integer nonnegative ticks, positive duration, and ended within the project boundary. The repeated MIDI files were byte-identical.

The existing exporter preserves track MIDI channels and writes no instrument program changes. Some combined files therefore contain duplicate channels: Chamber and Sonata have Violins I + Piano on channel 1; Vocal Backing has Violins II + Harp on channel 2; Cinematic and Hybrid Studio have those collisions plus Violas + Double Basses on channel 3, and their combined files also put Piano on channel 1 with Violins I. Tracks remain separate in the Type 1 file, but assign patches and, if your DAW/device needs it, unique channels during import/routing. No source channels or non-piano tracks were changed for this evaluation. Tempo, meter, markers, notes, CC, and endpoints were round-trip checked; the current parser does not expose key-signature events for an equivalent round-trip assertion.

## Prioritized recommendations

1. **Make planned gestures auditable end-to-end.** Add/extend tests so every Composer-planned suspension is either realized as preparation + resolution or explicitly reported as unavailable; target the Sonata and Cinematic cases above. Do not silently drop half of a planned gesture.
2. **Define and enforce temporal presence rules.** Decide whether `nearSilence` is a soft low-velocity trace or a no-attack window. Then test attack suppression and note-tail trimming against the zero-target bar, explicit `leave-space` windows, and Sonata/Chamber rest-response policies.
3. **Strengthen the Hybrid rhythmic identity.** Test a wider range of seeds and ensure the realized pulse/motif has audible off-beat placement rather than mostly quarter/eighth-grid attacks; retain harmony and the low anchor behavior.
4. **Run an actual listening round before ranking quality.** Render both parts with the same piano sound and non-piano mix, compare phrase shape, articulation, balance, and whether long holds obscure responses. This evaluation intentionally makes no claim about sound, masking, playability, or emotional effect.
5. **Prepare DAW routing.** Keep the existing MIDI output as delivered, but document channel collisions or provide a separate export-only channel-remapped variant if that is wanted later. Do not alter the underlying arrangement to solve routing.

## Deliverables

- MIDI folders: `exports/chamber/`, `exports/sonata/`, `exports/vocal-backing/`, `exports/cinematic/`, and `exports/hybrid-studio/`.
- Inputs, Composer plans, raw note events, note statistics, template-fit audits, MIDI checksums, and determinism records: `inputs/`, `analysis/`, `verification/`, and `manifest.json`.
- No Composer, Realizer, legacy instrument behavior, harp, non-piano arrangement, production integration, persistence, or schema changes were made. No commit was created.
