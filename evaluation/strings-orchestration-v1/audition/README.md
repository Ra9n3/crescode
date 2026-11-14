# Strings V1 — Ensemble Orchestration Identity V1
## New Studio One MIDI audition · 2026-11-14

**Not listened to or approved.** Implementation/evaluation delivery, not a production enablement or clean test-toolchain sign-off. The earlier Identity/Development V2 package is unchanged.

## Start here

1. Create a fresh Studio One song. Import one case's `02_strings__uvi.mid` at bar 1 with the file's tempo/meter. Controlled cases are 100 BPM, 4/4, 960 PPQ, D Dorian, 16 bars.
2. Assign the named UVI Orchestral Suite patches to the imported parts. Keep the shipped keyswitch/controller mappings. MIDI pitch numbers are authoritative: conventional **C4=60**, while this profile calls MIDI 60 C3.
3. Use **one alternative at a time**: full ensemble OR all strings OR individual desks. Importing full+strings+individual files together doubles the material. Opening/transition excerpts are shortened alternatives, not extra layers.
4. Bass stays at the shipped profile's zero transposition. Do **not** automatically add a -12 octave. The actual UVI patch's sounding octave and unverified switches still require human/sample-library confirmation.
5. Empty individual-desk MIDI can contain conductor metadata only. The unchanged exporter omits an empty profile part. `matrix.json` and each case's evidence explicitly distinguish intentional silence, unavailable desks and classic fallback.

## Recommended listening route

All file paths below are relative to this folder. Listen first without reading the foreground labels if possible; then compare the measured/intentional evidence.

| Question | Case / files | What the implementation actually attempts |
|---|---|---|
| Clear upper solo vs another opening | `symphony-dorian-seed4-take0/03_opening__uvi.mid`, then `symphony-dorian-seed1-take0/03_opening__uvi.mid` | Exposed Violin I vs Viola-led three-desk texture; not the same first violin line with another octave preset |
| Other violin establishes the theme | `symphony-dorian-seed3-take0/02_strings__uvi.mid` | Violin II first, Violin I later; V2 source phrase remains the same as the earlier package for this seed |
| Harmony first, theme later | `symphony-dorian-seed5-take0/03_opening__uvi.mid`, then its `02_strings__uvi.mid` | Viola+Cello harmonic preparation; first thematic contribution begins at quarter-beat 8, outside the opening excerpt |
| Low-register theme and floor exchange | `symphony-dorian-seed7-take0/02_strings__uvi.mid`, `04_transition__uvi.mid`, `05_lower_interaction__uvi.mid` | Cello-led beginning; later Cello trajectory 53/52/47/46 and Bass 29/29/43/41 (quarter-piece duration-weighted medians) |
| Cello tenor, not an automatic D3 centre | `symphony-dorian-seed6-take0/05_lower_interaction__uvi.mid`, then `01_full__uvi.mid` | Bass supplies the floor, Cello moves into tenor space; assess balance, joins and proximity to Viola |
| Higher Bass reinforcement over a Cello floor | `symphony-dorian-seed2-take0/05_lower_interaction__uvi.mid` | Delayed Bass chord-tone layer; Cello/Bass are not forced into a permanent hierarchy |
| Genuine sparse part | `symphony-dorian-seed4-take0/desk_cellosBasses__uvi.mid` | Only two Cello notes, approximately 1.3% occupancy. It is explicitly sparse, not a substantial five-voice claim |
| Fixed displayed seed, different takes | `symphony-dorian-seed1-take0` through `take3` | Stored takes 0–3 produce takes 1–4; theme, phrases and score change reproducibly |
| Template context | `chamber-dorian-seed1`, `cinematic-dorian-seed1`, `hybridstudio-dorian-seed1` | Actual template/roster/energy and thematic identity change; this is NOT a frozen-theme register comparison |
| Actual generated mode/harmony distinction | `generated-dorian`, `generated-aeolian` | Existing suggestion engine produces different actual chord symbols, e.g. G vs Gm; not a label-only mode change |
| Difficult borrowed/chromatic context | `borrowed-chromatic/02_strings__uvi.mid` | Dm/A, Bb/A, Eb7, A7; inspect local harmonic fit and low-voice movement |
| Short, long, unequal/repeated forms | `short-2bars`, `long-40bars`, `unequal-repeated-17bars` | Explicit short forms, changing ownership across long/unequal sections, rests retained |
| Honest fallback | `meter-6-8`, `fallback-unsupported-mode`, `fallback-no-chords`, `fallback-restricted-ranges` | Entire classic output retained; these four cases are NOT new-orchestration success. No-chord fallback may be musically empty |
| Protection cases | `locked-violin1`, `out-of-band-cello` | Those lanes remain protected; they are not silently incorporated into a claimed newly written desk |

## Files in every case

- `01_full__uvi.mid`: full sounding ensemble, including unchanged nonstrings.
- `02_strings__uvi.mid`: all string desks that the unchanged exporter materializes, including intentional omissions as documented.
- `desk_<role>__uvi.mid`: each existing string desk separately; silent desks can have conductor metadata only.
- `03_opening__uvi.mid`: first eight **quarter beats**, clipped from actual final notes (not recomposed). In 3/4 or compound meters this is not necessarily two bars.
- `04_transition__uvi.mid`: quarter beats 24–40, when the piece is long enough; near-silence before Chorus remains audible as a rest. Begins at local bar 1 in the excerpt file.
- `05_lower_interaction__uvi.mid`: Viola, Cello and Bass, same final notes and timeline as the full string file.
- `evidence.json`: seed/stored and produced take, actual mode/chords/form, immutable V2 source, pre-placement plan, generated/post-expression realization reviews, final notes/CC and isolation checks.

Use the full files for phrase/section context. An excerpt can begin midway through a held note; it is a clipped view, not a new compositional entrance. Quarter beats = ticks/960. All note-on/note-off times in JSON are ticks.

## Technical evidence and limits

- **30 production cases**, each repeated exactly and compared against classic; **26 accepted foreground gates, four explicit classic fallbacks**.
- **60 classic golden cells / 270 exported string fingerprints** match the existing baseline. Nine archived prior-V2 string files also match by direct full byte comparison under explicit V2 reconstruction.
- **295 MIDI files**, independently parsed in Python: file sizes/SHA256, track names/counts, every mapped note start/end/pitch/velocity/channel, and paired note-offs verified. **18,831 note-ons** includes keyswitches and repeated excerpts; it is not a count of independent musical observations.
- `MIDI_MEASUREMENTS.md` is the concise actual-MIDI register/occupancy/trajectory/spacing report. `midi-measurements.json` contains duration-weighted P10/P50/P90/mean, entrances, opening events, section/quarter trajectories, all ten simultaneous desk pairs and role assessments. Keyswitches are excluded from musical metrics.
- `OPENING_ANALYSIS.md` links actual opening pitches/rhythms/harmony and texture to planned later journeys. Musical intent is not a perceptual foreground measurement.
- `midi-manifest.json` and `SHA256SUMS` cover the 295 MIDI files. `FULL_CONTENT_SHA256SUMS` covers all package payload files except itself. The archive's own size/digests/content verification are delivered beside the ZIP, avoiding a circular checksum.
- `IMPLEMENTATION_AND_VALIDATION.md` documents architecture, thresholds, exact commands, failures, safeguards and musical limits. `verification-logs/` contains final native/parser logs and all standard command failures.

### Important environment disclosure

No dependencies were installed. `npm test` targeted/adjacent/full, `npm run typecheck`, and `npm run build` all exited 127 because **Vitest/tsc/Vite are absent**. Zero Vitest workers started, no timeouts; no standard test/build pass is claimed.

The production compose, MIDI exporter and UVI profile functions DID execute through an explicit audit-only native TS loader. Its opt-in small SMF encoder substitutes for missing `midi-file`; the shipped serializer package itself was unavailable. Existing classic export fingerprints and nine direct archived byte comparisons validate the exercised encoding, and Python independently validates all new bytes. This is substantial evidence, **not a substitute for running the normal installed-dependency toolchain**. The loader/encoder do not participate in the app or ordinary tests.

## Human listening still required

Confirm remembered thematic identity, opening character and later payoff, legibility of low/other-violin foregrounds, register changes, floor exchanges, sparse-desk purpose, phrase joins, proximity/masking, sampled articulations and balance in the full ensemble. Check the Bass sounding octave and unverified profile keys with the actual library. Violin I is intentionally silent in five of the eight controlled cases; assess whether that restraint becomes a selection bias. Several Bass medians still cluster around MIDI 36 under the same D-centred harmony.

No audio render, Studio One import execution, human audition, approval, or permission/sharing change is claimed.
