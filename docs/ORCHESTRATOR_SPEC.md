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
D8. The orchestrator's seed derives from the MUSICAL INPUTS ONLY: the
    normalized chord list, the structure (section names, start bars,
    lengths), key, mode, tempo (bpm + tempo map), template id and band
    membership — hashed with `hashString`, then combined with the take (and
    the per-section take for section re-rolls). Notes are never inputs;
    orchestration state other than the take counters is never an input.
    Same inputs + same take → the same stream (byte-identical output); any
    chord, structure, key, mode, tempo, template or band change → a
    different stream.
D9. Compose order: family modules render FIRST, and their rendered notes
    are handed to the rules generator as role sources, so cross-family
    doubling parts ("Flutes double Vln I") double what the modules wrote.
    Families a module owns stay excluded from the generator's own writing,
    so no lane is written twice.
D10. The checker judges layers, not arithmetic necessity: chord-internal
    octave doubling FORCED by sounding voices outnumbering the chord's
    distinct tones is exempt from octaveDoubling findings (with the doubled
    pitch class a chord tone); a deliberate layer double — voices within
    the distinct-tone count — is still reported exactly as before.
D11. Take variety comes from seeded sampling among the top-K near-optimal
    voicings; K and the cost margin are named constants in
    `voicing/voiceLead.ts`. Hard constraints are never traded for variety,
    and the same take stays byte-identical.

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

Mixing, EQ, pan, sample-library keyswitches, woodwind/percussion modules
(later), a score checker beyond `measureEnergy` + template rules. (Brass
moved out of this list in §13 — Phase 8 builds the brass module.)

## 12. Open items for the user

- Confirm D1-D7 above.
- VOCAL_ZONE default (A3..A5) is a proposal.
- Target sample library for future keyswitches.


## Amendments v2 (after Phase 0)

§3  D8–D11 added above (orchestrationSeed derivation, compose order,
    checker's forced-doubling exemption, top-K take variety) — they were
    cited by the review but their text never landed in the repo.
§4  Replace stale facts:
    - Chord = {id, symbol, startTick, durationTicks}. No chord-level lock;
      locks are track-level.
    - chordSpans(project) is the normalized chord list. It currently lives in
      src/engine/generate.ts and is re-exported from orchestrator/spine/.
    - sanitizeNotes rebuilds notes as 4 fields and drops unknown ones.
      Phase 1 makes it preserve the optional fields.
    - midi.ts writes no CC and ignores unknown note fields.
    - composeAll() is in src/store/store.ts; band semantics are in
      src/shared/schema/band.ts; templates resolve via resolveTemplate() in
      src/config/ensembles.ts.
    - tsconfig covers src only; tests are gated by vitest. Add a test typecheck.
§7.3 Chord vocabulary: the voicer must handle every quality parseChord reads:
    maj, m, dim, aug, sus2, sus4, 7, maj7, m7, m7b5, dim7, m(maj7), add9,
    madd9, 9, maj9, m9, 7sus4, 9sus4, 7b9, 7b5, plus slash bass. Spelling
    such as G#dim7 must resolve to the right pitch classes.
    Leading tone is derived, not named: it exists iff the mode's scale
    contains the pitch class one semitone below the tonic. (D Dorian: no.)
    Parallel-5th/8ve checks are OFF in Whole Tone, both Diminished modes and
    Locrian (symmetric or non-tertian harmony); the other soft rules stay on.
§7.6 Detune is a profile constant applied by the preview. It is not stored on notes.
§9  Move MIDI CC export from Phase 5 to Phase 1, so expression data is
    audible in a DAW as soon as it exists.
§10 Add: sanitizeNotes preserves optional fields; old project files load
    unchanged; CC round-trips through export; the same inputs and take give
    byte-identical output; a different take gives different output.
## 13. Brass (Phase 8 — the brass module)

Brass joins the orchestrator as a family module beside the strings module
(`src/orchestrator/brass/`): the strings render first, the rules generator
covers winds/percussion/keys as before, and brass is written by its own
planner + renderer between the two. Everything below is defined in MIDI
numbers, sounding pitch (the note names in `ranges.ts` are written with
C4=60; the app displays C3=60 — the MIDI numbers are the truth either way).

### 13.1 Roster and voices per track

Brass rosters (from the shipped templates): symphony and cinematic carry
horns, trumpets, trombones, tuba; hybridstudio carries horns, trumpets,
trombones (no tuba); chamber, sonata and vocalbacking carry none — for
those three the brass module is silent and their output stays byte-identical
(pinned against the moments-on baseline).

Voices per track: ONE. A brass track carries a single line — no block
chords, no self-doubling, no divisi. The old rules generator voiced horns
and trombones as 2–3-voice block pads (the reason the checker needed its
block-chord exemption); the module replaces that with section writing where
the choir covers harmony across tracks (horn pad + trombone guide tone +
tuba bass line). The Phase 7 `div2` relaxation stays strings-only: without
a brass export profile there is no honest way to carry a second brass line
through keyswitches/parts, and every audit assumption (D2, legato joins,
CC bar kinds) holds unchanged.

### 13.2 Zones, ceilings, caps (MIDI, sounding)

| part | hard range (ranges.ts) | sweet spot (the module writes here) | soft-dynamic ceiling | phrase cap | rhythm floor |
|---|---|---|---|---|---|
| horns | 41–77 | 41–72 | no soft dynamics above 72 | ~10 s | quarters or slower, except trailer repeats |
| trumpets | 52–84 | 58–77 | no soft dynamics above 77 | ~6 s | 16ths only in trailer repeats or fanfare repeats |
| trombones | 40–77 | 53–70 | n/a | ~7 s | eighths or slower |
| tuba | 26–65 | 41–53 | n/a | ~5 s | eighths or slower |

Every sweet spot sits inside its hard range; the config ranges are the
playable extremes, the sweet spots are the writing window. Phrase caps are
measured in seconds through the tempo map; when a sustained stretch reaches
the cap the part rests at least one beat before re-attacking (the breath
mechanism, per-instrument through the cap lengths; the rest itself is one
beat for every part).

Outside the sweet spot a part plays only above the high energy fraction
(§13.3) — in practice the module's roles all stay inside their sweet spots
by construction, and the rule is armed as a guard.

### 13.3 Gating by section target energy

The bar's arc target, as a fraction of the template's clamp max, gates the
choir (fractions chosen by the implementer, reported):

- below 0.30 — no brass (the near-silence and thin bars stay thin);
- LOW, ≥ 0.30 — horns only, soft pad;
- MID, ≥ 0.55 — horns plus trombones as guide tones;
- HIGH, ≥ 0.75 — trumpets join (fanfare, stab or swell role);
- PEAK, ≥ 0.90 — the full choir, plus tuba on the bass line.

No bar number is ever consulted — only the arc. Every brass ENTRANCE (the
part's first bar after a whole silent bar) must follow a strictly
lower-energy bar, mirroring the tutti anticipation rule.

### 13.4 Roles by texture and energy

- Horn pad (default presence): sustained chord tones in the mid register,
  one note per chord span, quarters-or-slower re-articulation.
- Trombone guide tones (MID+): one chord tone per span, voice-led smoothly,
  kept off the horn pad's pitch class where the chord allows.
- Trumpets (HIGH+): one role drawn per section type on the brass stream —
  fanfare (the lead's rhythm on chord tones), marcato stabs (downbeats and
  phrase ends, inside the lead's windowing gaps), or a chord-tone swell
  (one sustained tone through the section's high stretch).
- Low brass (HIGH+): trombones and (at PEAK) tuba double the cello line at
  unison or an octave lower, octave-fitted into their sweet spots. Below
  MIDI 48 any two simultaneous low voices (trombone/tuba/cello) that are
  NOT in unison or octaves sit a 5th or wider apart.
- Trailer ostinato: in the trailer texture horns and trumpets may repeat a
  chord tone on the drawn ostinato rhythm cell; trombones and tuba never do.

### 13.5 Prepared entrances and the brass lead

Every brass entrance rides a CC1/CC11 crescendo built by the same CC
generator the strings use (phrase arches, soft-entry S-curves), and follows
a lower-energy bar (§13.3).

Brass lead (PEAK only, rare, weighted — at most one per piece): the lead
moves to the trumpets for 2–4 bars (capped by the trumpet phrase cap).
The strings drop to pad for those bars — a rendering-level override beside
the DP exactly like the Phase 7 moment layers, so the voicing outside those
bars is untouched — and the lead's pitch ceiling moves with it: the motif
is drawn in the trumpet sweet spot. The horns may double the brass lead an
octave below where the band's octaveDoubling policy allows (D2), and the
leading tone is never doubled across families. One lead at a time: no bar
carries both a string lead and the brass lead.

### 13.6 Moments (Phase 7 integration)

- Tutti: the roster-wide hit now includes brass — each brass part hits the
  chord's root pitch class octave-fitted into its sweet spot, marcato, with
  the drawn hold/decay/breath shape, under the whole-roster velocity cap.
- Unison: the horns join the strings' unison line at the octave that fits
  their sweet spot, only where the octaveDoubling policy allows, leading
  tone skipped; the strings' part of the moment is untouched.
- Soli: a horn soli is allowed — horns join the lead-flavor carrier pool
  when the template rosters them (rare by draw); the strings rest (tacet)
  under it and the brass module renders the carrier line.
- Divisi and imitation: NOT extended to brass (not cheap: the export
  profile machinery and the counterline concepts are strings-shaped; no
  brass profile exists). Reported, not built.

### 13.7 Doubling, parallels, articulations

A horn doubling a trumpet lead at the octave respects D2 (the band's
octaveDoubling policy). The leading tone is never doubled across families.
Parallel 5ths/octaves between the outer voices are penalized when brass
pitches are chosen (a candidate-ranking penalty in the module's pickers)
and reported by the audit as a soft finding (`brassParallels`).

Articulations are stored as data on the notes — `sustain`, `legato`,
`marcato`, `staccato` — never as keyswitches in the project. The UVI
Orchestral Suite profile maps no brass part, so brass exports exactly as
they would without a profile (the profile machinery passes unmapped parts
through untouched).

### 13.8 Determinism and isolation

The brass planner draws on its OWN salted D8 stream (`hashString('brass')`
over the (inputs, take) seed) — the texture draws, the moments stream and
every existing draw are untouched. Brass notes are velocity-capped by the
same governor bound the strings use, so the hard energy clamp can never be
breached by a brass entrance; a final brass-only safety pass re-checks the
windows after humanize/legato and lowers brass alone if anything moved.
Locked and out-of-band brass tracks are never written. Output is a
`sanitizeNotes` no-op and `validateProject` passes. One undo step per
Compose All (the brass work happens inside `composeAllTracks`).

### 13.9 Implementation notes (how §13 landed)

- The phrase cap is a PART-level clock over sounding runs (any kind); the
  moment gestures (tutti/unison/soli) neither consume nor obey it and the
  brass lead starts a fresh phrase at its first note — this keeps the
  ordinary line's clock byte-identical with and without the moments (the
  draw-identity pin), at the cost of the rare gestures not counting toward
  lip time.
- A moment overriding a part's ordinary line ghost-runs the ordinary kind on
  that bar: the cap clock, the voice-leading targets and the outer-voice
  tracking advance exactly as they would without the moments.
- The low brass doubling rides the CELLO line's own phrasing — no
  independent cap clock; cello notes closer together than an eighth merge
  into one held segment (the doubling never moves faster than eighths), and
  a sub-48 pair against any other low voice (Cb doubles included, ± the
  humanize head) that is not a unison/octave or a 5th+ opens the doubling.
- The suppressed string pad on a brass-lead bar opens where its DP pitch
  would double a leading tone another voice holds (a line fix can pin a
  track to the line's LT note that only sounds at the span's tail, and the
  previous span's forced bass LT can tail in through the legato join).
