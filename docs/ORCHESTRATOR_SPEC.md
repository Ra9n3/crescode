# Orchestrator Spec: strings first

Status: design. Nothing here is implemented. Facts about the repo were taken
from a read-only dump and may be stale. If the repo disagrees with this
document, the repo wins. Report the discrepancy; do not paper over it.

## 1. Goal

Compose All produces a score that sounds composed rather than generated:
one shared harmonic and energy plan, voice-leading across the whole section,
a motif that develops, phrase-shaped dynamics, and silence used on purpose.
Strings are the first family. The module interface is family-agnostic so
brass, woodwinds, percussion and keys can follow.

## 2. Ground rules (non-negotiable)

1. Deterministic. Same project + same seed = byte-identical output.
   Use `hashString` / `mulberry32`. No `Math.random`, no `Date.now`.
2. Additive schema. New fields are optional, validated, and ignored by old
   code. Existing projects and fixtures must still load unchanged.
3. Respect locks and the band. Locked tracks and out-of-band tracks are never
   modified. Reuse `isInBand` and the existing lock checks.
4. Output survives `sanitizeNotes` as a no-op (no clipping, no dropped
   fields) and passes `validateProject`.
5. Store SOUNDING pitch. Hard range comes from `INSTRUMENTS` in
   `src/shared/schema/ranges.ts`, never from constants in the orchestrator.
6. One undo step per user action (Compose All, per-section re-roll).
7. No mixing features. Do not implement HPF, EQ, carving by frequency,
   vocal notches, or pan profiles. The app has no mixing engine and export
   ignores volume, pan, mute and solo. Register carving as COMPOSITION
   (choosing which pitches play) is allowed.
8. Tick math is meter-aware. ticks = ms * bpm * 960 / 60000, using the
   tempo map, not a single global bpm if the project has tempo changes.
   Never hard-code "16th = 240 ticks".
9. Build stays a single `dist/index.html`.

## 3. Decisions (defaults chosen by the author; the user may override)

D1. Chamber = the template: string quartet + piano, one player per part.
    Notation allows double-stops only. The user's 6-5-4-3-2 section table
    applies to the preview synth only.
D2. "octaveDoubling: forbidden" ALSO bans the Cb+Vc octave layering inside the
    `cellosBasses` track. (Orchestrally the Cb octave is normal, so this is
    a strict reading. Make it one flag so it is easy to flip.)
D3. Energy occupancy is measured against the TEMPLATE ROSTER size, not the
    in-band track count.
D4. No sample-library keyswitches yet. Articulation is stored as data and
    honoured by the preview synth. MIDI export writes notes + CC only.
D5. Other families arrive later in the same spec format.
D6. Vocal Backing assumes the vocal sings throughout. The singer is not a
    Crescode track, so there is no activity signal. A configurable
    VOCAL_ZONE (default A3..A5 sounding) is kept free of strings. This
    default is the author's proposal, not the user's.
D7. Voices are assigned from whoever is in the band (top line, inner, bass),
    not hard-wired V1=soprano, because Vocal Backing has no `violins1`.

## 4. Repo facts to verify (do not trust blindly)

- Tracks: `violins1`, `violins2`, `violas`, and ONE `cellosBasses` track.
  Violins I range is [55, 96] (G3..C7).
- `Note` = { pitch, startTick, durationTicks, velocity }. No articulation or
  CC fields exist yet.
- PPQ = 960. Chord parser and helpers: `parseChord`, `roleOfChordRoot`,
  `scalePitchClasses`, `barTicks`, `beatOffsets`, `gridResolutionOf`.
- Chord clips can overlap, be unparseable, be half-bar long (1920 ticks),
  and be slash chords (`C/E`).
- Chord lane notes are tied to clips only by tick windows (no id link).
- Templates live in `specs/ensemble-templates/templates/*.json`, validated
  by `src/shared/schema/ensembleTemplate.ts`. They have no chair counts.
- `src/engine/generate.ts` is the rules generator. It must keep serving the
  non-string families until their modules exist.
- `humanizeNotes` is not exported yet.
- `tests/seed-dump.test.ts` imports `src/orchestrator/chordgen`. The first
  source dump had no such file. Phase 0 resolves this.

## 5. Templates and budgets

| Template | Roster (relevant) | maxLayers | Energy clamp | Rules |
|---|---|---|---|---|
| chamber | v1, v2, vla, cb, piano | 5 | [0.20, 0.70] | octaveDoubling climaxOnly @0.55; piano fills only during Strings rests (gap 480) |
| sonata | v1, cb, piano | 3 | [0.15, 0.65] | octaveDoubling forbidden; piano fills during v1 rests (480) |
| vocalbacking | v2, vla, cb, piano, harp | 4 | [0.15, 0.65] | octaveDoubling forbidden |
| symphony | 17 tracks | 7 | [0.25, 0.85] | Woodwinds vs Brass overlapAvoid 240; octaveDoubling allowed |
| cinematic | 16 tracks | 9 | [0.35, 0.95] | same overlapAvoid; allowed |
| hybridstudio | 14 tracks | 8 | [0.30, 0.90] | Percussion fills during Strings rests (480); allowed |

(`cb` = the `cellosBasses` track.)

## 6. Energy model

E = occupancy * velocity, windowed per beat.
- occupancy = sounding roster tracks / roster size
- velocity = mean velocity of sounding tracks / 127
- Clamp max is HARD: output must never exceed it.
- Clamp min is SOFT: report "texture below floor", never fail or pad.

Velocity governor: with N roster tracks and n sounding in a window,
mean velocity <= 127 * max * N / n. The governor limits NOTE velocity, not
CC1. Examples: Sonata (N=3, max 0.65) caps near 83 when all three play.
Strings alone cannot reach the floor in Symphony/Cinematic (4 of 17 tracks
caps E near 0.24). That is expected and must be reported, not "fixed".

`measureEnergy(project, template)` is a pure function, built in Phase 1 and
reused as the audit stage.

## 7. Strings musical spec

### 7.1 Ranges (sounding)
V1 G3-C7. V2 G3-A6. Vla C3-E6. Vc C2-C6. Cb C1(E1)-D3 sounding.
Hard limits come from `INSTRUMENTS`. Also keep a "comfortable" range
(suggested V1 top ~E6) used for ordinary writing; extremes only at climax.
The `cellosBasses` track hosts two layers: Vc and Cb (Cb an octave or more
below, within Cb range). Verify the track's actual range in `ranges.ts`
and report if it cannot contain both.

### 7.2 Polyphony caps (replace "section size" divisi)
Per-track max simultaneous notes: violins 2; violas 2 (3 at climax);
cellosBasses = Vc voices (2, 3 at climax) + 1 Cb voice. Chamber: cap 2 per
track, no Cb layer. Section sizes (6-5-4-3-2 etc.) are preview-synth only.

### 7.3 Voice-leading
- Hard (voicing layer): no doubled leading tone where the mode HAS one
  (D Dorian has none); no crossing; hard range; low-interval limit below
  C3 (only octaves and 5ths between simultaneous notes).
- Soft (scored, may be violated with penalty): no parallel 5ths/8ves among
  INDEPENDENT voices; stepwise upper lines; upper voices within an octave;
  leading-tone resolution.
- Doubling layers (octave doubles, tutti unisons) are exempt from parallel
  checks.
- Voicing is a global dynamic-programming search over the whole progression,
  not greedy chord-by-chord. Bass follows slash chords (`C/E` puts E in the
  bass). Handle half-bar chords and overlapping or unparseable chord events
  via the normalized chord list from Phase 0.

### 7.4 Articulations and bowing
legato, detache, marcato, staccato (notes under 0.25 s), spiccato, pizz,
tremolo, portato, sul tasto, sul pont, con sord.
Down-bow on downbeats, up-bow on pickups (stored as data for the preview
and later export).
0.25 s converts through the tempo map; at 100 BPM it is 400 ticks.

### 7.5 CC automation (additive, optional per-track)
- CC1 and CC11 move together as phrase arcs.
- CC7 is static balance only.
- CC74 short spikes for accents.
- CC68 on legato passages.
- S-curve 40-80 ms ramp on soft legato entries.
CC is data on the track; export writes it as MIDI CC events.

### 7.6 Humanization
- Detune (cents): V1 0, V2 +2, Vla -3, Vc +3, Cb -2. Preview synth only.
  Pitch-bend export is an OFF-by-default option.
- Timing offsets are POSITIVE and correlated within a section:
  +5..+18 ms violins and violas, +12..+28 ms cellos and basses.
- Offsets must never push a note past project end or out of a section's
  intended window. Clamp, then re-validate.
- Use the exported `humanizeNotes` for velocity/timing where it fits.

### 7.7 Preset behaviour
- Cinematic: V2 and Vla ostinato at the finest regular beat subdivision,
  spiccato. V1 tremolo when energy >= 0.65. V1 doubles Vc at the octave
  (allowed by template).
- Symphony: 4-part voice-leading; Cb on a pizz pulse in the cellosBasses track.
- Vocal Backing: wide legato pads only. No notes shorter than an eighth, no
  marcato/staccato stabs, nothing inside VOCAL_ZONE. Known tension: Vla and
  V2 ranges overlap the zone, so voicings must use open spacing (low Vla/Cb
  below, V2 above). Test that triads still come out complete.
- Chamber: quartet, double-stops only.
- Sonata: violin + cello (+ piano owned by another module).

## 8. Architecture (`src/orchestrator/`)

- `spine/`    normalized chord list, section map, energy curve (shared)
- `energy/`   measureEnergy, velocity governor, template rule checker
- `conductor/` per-bar role assignment (lead, pad, ostinato, tremolo,
              counterline, bass, fill ...), obeys maxLayers + octave policy,
              leaves breath windows for fillGating
- `voicing/`  global DP voice-leader, divisi/polyphony caps, unison restoration
- `lines/`    motif (develops across sections), counterline, ostinato,
              bass/pulse
- `technique/` articulation + bowing assignment
- `expression/` CC1/CC11 phrase arcs, CC74 spikes, CC68, S-curves
- `humanize/` timing + detune
- `audit/`    report: ranges, parallels, energy floor/ceiling, rule hits
- `profiles/strings.ts` family profile (ranges, caps, detune table)
- `render.ts` project-in, project-out; honours locks and band

Interface (sketch, adjust to the repo):
SectionModule { family; roles(ctx): LayerPlan; render(ctx, plan, seed): Patch }
Compose All = spine -> conductor -> registered modules -> rules generator for
families with no module -> audit. One undo step.

Per-section re-roll and lock: re-roll changes the seed for one section only.
Lock on a section keeps its notes through Compose All and re-rolls.

## 9. Phases and acceptance

Phase 0: reconcile tree, fix known bugs (see PHASE0 prompt). Done when tests
  and build are green and each fix has a regression test.
Phase 1: optional `articulation` / `detuneCents` on Note; optional CC data
  on tracks; validators; confirm `sanitizeNotes` and `export/midi.ts`
  preserve or safely ignore them. Build `measureEnergy` + rule checker.
Phase 2: strings pad layer from the active roster across all six templates,
  meter-aware, with the velocity governor. Golden test on
  `fixtures/dorian-16bars.json`.
Phase 3: polyphony caps; Vc+Cb layering in `cellosBasses`.
Phase 4: motif, counterline, ostinato, tremolo textures.
Phase 5: technique, bowing, CC, humanize.
Phase 6: preview synth honours CC1/CC11, articulation, tremolo, detune.
Phase 7: audit report modal (needs a new `state.modal` value), per-section
  re-roll and lock UI on the structure lane, breath windows, per-bar layer
  annotation for maxLayers.

## 10. Test plan

Property tests across many seeds, each template, several keys and modes:
determinism; every note inside its `INSTRUMENTS` range; low-interval limit;
no doubled leading tone; parallels only among independent voices (soft,
counted); energy never above clamp max; locked and out-of-band tracks
byte-identical; `sanitizeNotes` no-op; `validateProject` passes; no
orphan notes in the Chords track.
Golden: Dorian fixture (half-bar chords, slash chords) per preset.
E2E: compose, play, open report.

## 11. Non-goals

Mixing, EQ, pan, sample-library keyswitches, brass/woodwind/percussion
modules (later), a score checker beyond `measureEnergy` + template rules.

## 12. Open items for the user

- Confirm D1-D7 above.
- VOCAL_ZONE default (A3..A5) is a proposal.
- Target sample library for future keyswitches.