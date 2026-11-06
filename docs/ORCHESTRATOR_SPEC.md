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
tuba bass line). The Phase 7 `div2` relaxation stays strings-only by design
(one voice per brass track — the brass parts export one line each through
their own channels since the Phase 8.1 profile), and every audit assumption
(D2, legato joins, CC bar kinds) holds unchanged.

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
Orchestral Suite profile maps the four brass parts since Phase 8.1 (one
part each on the channels after the strings, red-zone `keyswitchZone` +
`playableLow` per part; the export's red-zone guard drops non-keyswitch
notes below a part's playableLow — export only). Before that phase it
mapped no brass part, so brass exported exactly as it would without a
profile (the profile machinery passes unmapped parts through untouched).

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

## 14. Woodwinds (Phase 9 — the winds module)

Winds join the orchestrator as a family module beside the strings and brass
(`src/orchestrator/winds/`), reusing the brass module's structure — profile,
plan, render — and the conductor, the energy arc, the breaths, the voicing
and the moments (nothing forked). The strings render first, brass second,
the winds third (they read the brass plan and the rendered brass notes for
the windowing below), the rules generator covers percussion/keys as before.
Everything is defined in MIDI numbers, sounding pitch (stored sounding, the
C3/C4 display trap noted in §13 applies).

### 14.1 Roster and voices per track

Wind rosters (from the shipped templates): symphony carries flutes, oboes,
clarinets, bassoons; cinematic carries flutes, clarinets, bassoons (no
oboes); hybridstudio carries flutes, clarinets (no oboes, no bassoons);
chamber, sonata and vocalbacking carry none — for those three the winds
module is silent and their output stays byte-identical (pinned against the
Phase 9 baseline captured at the post-8.3 HEAD). Piccolo, alto flute,
English horn, bass clarinet and contrabassoon are out of scope.

Voices per track: ONE (§13.1's rule carries over). Harmony is spread ACROSS
the four wind instruments — one voice each — never as block chords inside a
track. The old rules generator's wind output (§14.3) is replaced for these
roles exactly as the brass's was.

### 14.2 Zones, ceilings, caps (MIDI, sounding; the config hard ranges win)

| part | hard range (ranges.ts) | weak (soft only, rarely) | sweet spot | strained / loud only | phrase cap | rhythm floor |
|---|---|---|---|---|---|---|
| flutes | 60–96 | below 67 (breathy) | 72–88 | above 91 | min(6 s, 4 bars) | 16ths ok |
| oboes | 58–93 | below 62 (reedy) | 64–84 | above 88 | min(8 s, 8 bars), 1-beat gap | 16ths ok (repeated: < 120 BPM) |
| clarinets | 50–91 | 50–62 (dark, fine as colour) | 67–86 | above 88 | ~10 s | 16ths ok (repeated: < 120 BPM) |
| bassoons | 34–75 | below 38 (rough) | 41–67 | above 70 (pinched) | ~8 s | eighths or slower |

Every zone sits inside its config hard range. Outside the sweet spot a part
plays only above the high energy fraction (§14.4) — the clarinet's dark
50–62 is the one exception (colour is its job). Addendum hard rules: the
oboe has NO soft dynamics below 63, the bassoon none below 41, the flute
none above 84; a flute note in 60–66 never carries a lead, doubled or solo,
over brass or dense strings; a clarinet note in 65–68 never carries a lead,
counterline or pickup-run note. Repeated same-pitch notes: flutes may play
16ths at any tempo; oboes and clarinets play repeated 16ths only below
120 BPM (otherwise eighths); bassoons never faster than eighths; runs of
DIFFERENT pitches at 16ths are fine for flutes, oboes and clarinets.
Sustained pads merge consecutive same-pitch notes into one note. Each cap
cut is followed by a rest of at least one beat (the breath mechanism).
Flutter-tongue: flutes and clarinets may play it at the PEAK only, stored
as the `tremolo` articulation, a rare weighted draw.

### 14.3 Retirement of the old generator's wind rules

The rules generator wrote winds through five labelled parts: Verse
"Clarinet line" (counterMelody), Chorus "Flutes double Vln I" (melody,
doubleOf violins1 +12), Chorus "Oboes" (counterMelody), Chorus "Bassoons
bass" (bass) and Bridge "Oboe solo" (melody). The winds module owns the
SOUND of those tracks from Phase 9 on: its notes replace the generator's at
assembly, so none of the five rules is heard again on a wind template. The
generator itself KEEPS writing them as a phantom input — its notes feed the
brass renderer's and the pad governor's window math exactly as at HEAD,
which is what keeps the brass (and every other family) byte-identical: the
brass velocity caps depend on the window's role count, and removing the
generator's winds would have raised them. The phantom never reaches the
final score (the module claims every rostered wind track, empty or not),
and the wind renderer filters the generator's stale excluded-role entries
(brass, the basses desk) out of its own window math so a re-compose
measures the same windows as a fresh one. Templates without a wind roster
keep the generator byte-identically.

### 14.4 Gating by section target energy (fractions of the clamp max, reported)

- below 0.30 — no winds (the near-silence and thin bars stay thin);
- LOW, ≥ 0.30 — one or two solo colour winds (clarinet, else oboe) over the strings' pad;
- MID, ≥ 0.50 — the flute double joins (drawn per section, §14.5) and the bassoon joins on the bass;
- HIGH, ≥ 0.72 — octave doubling on top and wind runs; the harmony spreads;
- PEAK, ≥ 0.90 — the full wind choir.

Chorus-aware relief (the Phase 8.3 idea, addendum dependency): inside a
chorus-type section (the same /chorus|refrain|hook|drop/ match as brass)
the upper winds — flutes, oboes, clarinets — sound from the LOW gate, so a
chorus never thins with winds in; the bassoon sounds wherever the cellos
play (no energy gate of its own there). The soft-dip bar before a chorus
may still thin out. Every wind entrance keeps the brass rule (§13.3): a
part's first bar after a silent bar follows a strictly lower-energy bar;
bar 1 never enters. The prepared entrance rides the same CC generator.

### 14.5 Roles by texture and energy

- Lead double — a flute or oboe doubles the strings' lead an octave above
  or in unison (a different colour), drawn PER SECTION (never constant, so
  it never sounds like organ stops), octave doubling only where D2 allows;
  winds never go above the lead except in this intended octave double.
- Counterline and colour — the clarinet takes an inner line against the
  lead, rhythmically different from it, by riding the strings' own
  counterline line (which the Phase 7 imitation answers already replace on
  their bars — the imitation mode is thereby extended to a wind at no cost).
- Bass reinforcement — the bassoon doubles the cello line at unison or an
  octave up (fitted into its sweet spot), or sits on a sustained root.
  Below MIDI 48 its intervals with the cellos, basses and low brass are a
  5th or wider (unison/octave allowed) — checked at write time against the
  already-written low voices, the potential cello octave-up answer of a
  sub-36 note included. The leading tone is never doubled across families
  (the brass hard rule: wind pitches open where the LT crosses).
- Harmony — at HIGH+ the rostered winds spread across distinct chord tones,
  one voice per track, under the lead ceiling.
- Ostinato support — staccato chord-tone figures INSIDE the ostinato's
  rhythm cell (read from the strings' rendered ostinato onsets, never
  against it); flutes and clarinets may use 16ths (the addendum's repeated-
  note rules), bassoons eighths or slower.
- Pickup run (rare) — a short diatonic scale run, flutes or clarinets
  (oboes optional), in the last beat or two before a chorus or tutti
  downbeat, ending on a chord tone AT the downbeat; drawn with low weight,
  at most twice per piece, never on the near-silence or final bar.
- Wind lead (rare, weighted) — a solo wind (oboe, clarinet or flute) takes
  the tune for 2–4 bars in a BRIDGE INTERIOR (never a bridge's first or
  last bar: every moment candidate class sits at a section opening, a
  pre-chorus dip or the bar after a breath, so an interior lead displaces
  nothing), the strings dropping to pad (the brass-lead mechanism);
  planned BEFORE the moments on its own stream so it is moments-independent
  and the moments avoid its bars (additively — on the surveyed takes this
  never fires, so the moments stay byte-identical to HEAD); one lead at a
  time — no bar carries a string lead, the brass lead and a wind lead
  together; the lead ceiling moves with it (the motif is drawn in the wind's
  soft window, the clarinet's lifted past the 65–68 ban).

### 14.6 Interaction with brass (windowing)

Winds never fight the brass and the brass part is never changed. When the
brass plan carries a fanfare, stab or lead on a bar, the flutes cut OVER
the brass — the octave above the lead (the strings' tune, or the brass
lead's own line), with notes above MIDI 84 only when the bar's energy
allows them (the high gate). The other winds play in the GAPS between the
brass hits (their attacked notes never attack with the brass) or rest; a
held note may simply continue under the hits.

### 14.7 Moments (Phase 7 integration, extended to winds)

- Tutti: the roster-wide hit now includes the winds (each wind part hits
  the chord's root pitch class octave-fitted into its sweet spot, marcato,
  the drawn shape, under the whole-roster velocity cap).
- Unison: flutes and oboes join an octave above the unison line, bassoons
  join with the cellos (the cellos' own spread offset), only where the
  octaveDoubling policy allows, leading tone skipped; clarinets rest.
- Soli: a wind soli is allowed — the first rostered of oboes, clarinets,
  flutes joins the soli carrier pool where the template rosters winds (the
  Phase 8 horn pattern) — but NOT on a chorus-type candidate, where a wind
  solo replacing a string solo would thin the chorus (the addendum's
  chorus-mean rule); the strings rest (tacet) under it and the winds module
  renders the carrier line.
- Divisi: NOT extended to winds (reported, not built).

### 14.8 Determinism and isolation

The winds planner draws on its OWN salted D8 stream (`hashString('winds')`
over the (inputs, take) seed) — the texture draws, the moments stream, the
brass stream and every existing draw are untouched. The pickup run targets
only structural downbeats (chorus-type entries — where the tutti moments
land anyway), so no wind draw depends on the moments. Wind notes are
velocity-capped by the same governor bound the strings and brass use
(their windows include the rendered brass and the wind candidates), and a
final winds-only safety pass re-checks the windows after humanize/legato
and lowers WINDS ALONE if anything moved. Locked and out-of-band wind
tracks are never written. Output is a `sanitizeNotes` no-op and
`validateProject` passes. One undo step per Compose All. Winds have no
Falcon profile: they pass through the export untouched, exactly like the
brass before Phase 8.1.

### 14.9 Implementation notes (how §14 landed)

- The phrase cap is a PART-level clock over sounding runs (any kind); the
  moment gestures (tutti/unison/soli) neither consume nor obey it and the
  wind lead and pickup run start fresh phrases — the ordinary line's clock
  stays byte-identical with and without the moments (the draw-identity
  pin). The bassoon's cello double rides the CELLO line's own phrasing
  (the §13.9 precedent, cap-free), and the low-interval guard reads the
  WRITTEN cello overlap only — at wind-render time the cello list is
  pre-humanize/pre-legato and a segment's bar holds only notes that start
  in it, so the guard never depends on a moment's replacement of a
  neighbouring bar.
- The brass windowing (§14.6) reads the brass plan's ORDINARY kinds and
  lead spans (both moments-independent) — never the rendered moment kinds —
  and the flute's cut-over emits STATE-FREE (the ordinary kind ghost-runs
  first to advance the state, the cut-over notes consult neither the part
  clock nor the voice-leading groups), so both runs stay byte-identical
  outside moment bars.
- The ostinato figures read the texture's drawn CELL GRID directly (not the
  rendered strings' ostinato notes, which are tacet under a soli — reading
  them would make the ghost state moment-dependent), entering after the
  style's enterAfter like the strings' own cell.
- The bassoon's double is STRUCTURAL in the brass windowing: it never
  yields to the brass hits (the colour and counter voices do), so "the
  bassoon sounds wherever the cellos play" survives the 8.3 chorus
  fanfares. Moment bars are exempt from the presence contract (a soli
  silences the whole wind choir by design).
- The lead ceiling is the tune's lowest pitch in the bar (the wind lead's
  own line when it carries the tune); the intended exceptions are the
  octave lead-double and the flute cut-over.
- A wind part the plan leaves silent is still CLAIMED (an empty note list
  and no CC), so the generator's phantom notes can never leak through the
  assembly's generator fallback; the assembly likewise never lets a
  pre-compose CC lane survive on a wind track the fresh build left empty.

## 15. Percussion (Phase 10 — the percussion module)

Percussion joins the orchestrator as a family module beside the strings,
brass and winds (`src/orchestrator/percussion/`), reusing the same structure
— profile, plan, render — and the conductor, the energy arc, the moments
and the golden-byte harness (nothing forked). The strings render first,
brass second, the winds third, the percussion fourth (its velocity math sees
every other family's notes), the rules generator covers keys as before.
Everything is defined in MIDI numbers, sounding pitch; the earlier roster
list used C4=60 names — the numbers below are the truth.

### 15.1 Roster and voices per track

Percussion rosters (from the shipped templates): symphony carries timpani,
snare, cymbals, aux; cinematic carries timpani, cymbals, aux (no snare);
hybridstudio carries snare, cymbals, aux (no timpani); chamber, sonata and
vocalbacking carry none — for those three the module is silent and their
output stays byte-identical (pinned against the Phase 10 baseline captured
at the post-9 HEAD). Timpani, snare, cymbals and aux are the whole scope;
mallets, celesta, taiko, bass drum, gong, triangle, tambourine and
woodblocks are out.

One voice per track. Timpani is the only PITCHED part; snare (38), cymbals
(49) and aux (42) are unpitched fixed notes. Ranges as written to the file
(MIDI, sounding): timpani 38–57, snare 38–38, cymbals 49–49, aux 42–42.
The timpani's 38–57 spans the four drum bands (38–45, 41–48, 46–53, 50–57);
the config hard range (ranges.ts, D2–A3) is the same span and wins.

### 15.2 Retirement of the old generator's percussion rules

The rules generator wrote percussion through five labelled parts: Verse
"Timpani downbeat" (root, downbeat, 60–76, density 0.5), Chorus "Timpani"
(root, every-beat rhythm, 70–90, density 0.6), Pre-Chorus "Snare roll fill"
and Chorus "Snare" (fixed 38, backbeat + a last-bar roll fill), Chorus
"Cymbal crash" (fixed 49, every bar, 90–110, occurrences 1–4). Aux has no
rule — at HEAD it sounds only through the tutti hit. The module owns the
SOUND of all four tracks from Phase 10 on: its notes replace the
generator's at assembly, so none of the five rules is heard again on a
percussion template. As with the winds (§14.3), the generator KEEPS writing
them as a phantom input — the pre-flight measured that 4.4% (three-chorus)
and 3.1% (dorian) of the beat-window governor bounds the brass/wind caps
and the pad governor read would change without the phantom, which would
break the byte pins. The phantom never reaches the final score (the module
claims every rostered percussion track, empty or not). The tutti hit the
compose loop writes for the roster (§7 moments) stays in the phantom; the
module writes its own from the moments plan (§15.6).

### 15.3 What percussion humanize does today (and what replaces it)

Today the generator's generic `humanizeNotes` jitters every generated
percussion note ±12 ms / ±6 velocity (start-only, clamped inside the bar);
the tutti hits are written AFTER the generator and land on the grid with no
jitter; the strings' humanize never touches percussion; no CC lane reaches
a percussion track anywhere (so a roll crescendo is a VELOCITY RAMP — the
generator writes no CC1/CC11 for percussion). Phase 10 replaces all of it
with per-note, hash-seeded MICRO-TIMING in the module render, stored in the
notes (so the preview and the export — both read the stored notes — show
the same offsets): timpani +10..+24 ms, snare +4..+12 ms, cymbals and aux
0..+6 ms, all lags (never early), hashed from (track, start, pitch) — no
Math.random. A hit never crosses its bar or a moment boundary because of
the jitter (the offset clamps inside the written bar). On a tutti downbeat
the timpani and cymbals lag the strings by 24 ms at most (the strings'
own humanize offsets are positive, so the worst case is the timpani's
+24 ms against a string attack at +5 ms ≈ +19 ms).

### 15.4 Roles by texture and energy

- Timpani (one voice): notes are the chord's ROOT or FIFTH only, folded
  into 38–57, never the leading tone; consecutive hits take the candidate
  nearest the previous pitch (no octave jumps where a nearer pitch exists).
  Downbeat support on section and phrase starts (phrase starts = the
  section's first bar and every 4th bar of it — the hypermeter; reported);
  a pulse on the root (downbeat + the cell's anchor slot) in ostinato and
  trailer textures; a single hit on a tutti; a roll into a chorus or tutti,
  1–2 bars, stored as `tremolo` (16ths), ending on a hit. Low energy allows
  only soft single hits. Timpani never moves faster than eighths except in
  a roll. Hits land on the downbeat or the ostinato's anchor beat — never
  off-grid (snare and aux carry the off-beats).
- Snare: fixed 38. The pattern sits INSIDE the section's drawn ostinato
  rhythm cell, never against it — light (every other cell slot) at mid,
  the full cell at high; the full cell pattern plays only in ostinato or
  trailer textures. A roll crescendo, at most 1 bar (16ths), into a chorus
  or tutti, in any texture, at high energy at the target.
- Cymbals: fixed 49. A crash on the chorus entry and the tutti downbeat:
  the peak chorus always gets one, the first chorus is a weighted draw
  (0.6), other choruses a lighter draw (0.4); every crash needs a strictly
  lower-energy bar before it. A cymbal swell (one bar, `tremolo`) may
  precede a crash by one bar (weighted 0.5). Budget: never two crashes
  within 4 bars, at most one per section (the drawn chorus-entry crashes
  and the tutti crash share the budget; a tutti on a chorus entry is the
  same bar, one crash).
- Aux: fixed 42. A light off-beat accent (the meter's off-beat eighths,
  eighth-length staccato hits) in pizzPulse, ostinato and trailer textures,
  mid energy and above, never in soli. In chorus-type sections the aux
  joins from the section's first bar (the chorus relief below).

Chorus-type sections get percussion from the chorus's FIRST bar at mid
energy and above — no entrance-rule requirement, no enter-after delay
inside a chorus (the Phase 8.3 lesson: the chorus must not thin). Outside
choruses the continuing pulses (timpani pulse, snare cell pattern, aux)
keep the house entrance rule: a part's first bar after a silent bar follows
a strictly lower-energy bar; the structural downbeat support and the
moment/planned hits are exempt. The pre-chorus near-silence bar stays
tacet (below).

### 15.4a The chorus drive (Phase 10.1)

Inside a chorus-type section at or above the MID gate the kit's chorus
line is texture-independent (the drawn texture's own gates yield):

- Timpani (the `drive` kind): the chord's ROOT on every bar downbeat,
  ringing until the bar's next hit or the bar line; optionally the FIFTH
  on the half bar at the HIGH gate and above. Never faster than quarters
  outside rolls. The budget, ring-damping and range rules are the
  ordinary hits'.
- Snare: the backbeat-style hit on the meter's every second beat from
  beat 2 (beats 2 and 4 in 4/4), accented, from the MID gate up. On a kit
  WITHOUT a rostered timpani the snare carries the kit's quarter grid
  instead (the `grid` kind: the downbeat and beat 3 added, plain), so
  every chorus window keeps a fresh hit.
- Aux: the sparse off-beat line — the off-beat eighths, one per beat
  window — from the MID gate up, regardless of the drawn texture.

The whole drive line rides the HIGH gate's intensity floor on the
ABSOLUTE velocity scale (never the window bound: the bound is
moments-dependent through the soli tails that cross a barline, and the
Phase 8 identity pin forbids a moment moving a note outside its bars).
The clamp guarantee stays with `governPercussionVelocities`. The drive
never sounds during a soli, a near-silence bar or the PRE-CHORUS bar (the
bar before a chorus entry). On the pre-chorus bar only the GROOVE is tacet
(Phase 10.2 — the prepared entry keeps its build): the timpani's pulse,
the snare's pattern and the aux off-beat never sound there, while the
rolls' 16ths (timpani and snare), the cymbal swell and every roll's
ending hit sound exactly as in Phase 10 — a soli or near-silence pre-chorus
bar stays fully tacet. The crash budget is untouched. Verses and
bridges keep the §15.4 rules exactly.

### 15.5 Gating by section target energy (fractions of the clamp max, reported)

- below 0.30 — no percussion;
- LOW, ≥ 0.30 — soft single timpani hits (the structural downbeats) only;
- MID, ≥ 0.50 — the timpani pulse (where its texture gate passes), the aux
  off-beats (where its texture gate passes) and the light snare cell
  (chorus relief: from the chorus's first bar; elsewhere in ostinato/
  trailer textures);
- HIGH, ≥ 0.72 — the snare's full cell pattern (ostinato/trailer
  textures), the crash sources (chorus entries) and the rolls;
- PEAK, ≥ 0.90 — the full kit: every rostered part's gated roles stack
  (no new role — the gates accumulate).

Velocity follows the section energy (the same shaping as the winds: the
bar's arc norm under the window governor bound) with downbeat accents;
moment notes ride the whole-roster cap. Repeated hits on one pitch get a
small deterministic velocity variation (±1..3 units hashed from track,
start and pitch — no machine-gun repeats). Articulations are stored as
data: `hit`-style attacks stay unmarked or `marcato` (accents), short
cell/off-beat hits are `staccato`, rolls and swells are `tremolo`; no
keyswitches anywhere in the project.

### 15.6 Moments, tacets and damping

- Tutti: the tutti downbeat carries a timpani hit and a cymbal crash (the
  module writes them from the moments plan), plus a snare roll before it
  when the energy allows (the target bar at the high gate, the roll bars
  free of tacets). Aux stays silent at the tutti.
- Soli: percussion is tacet — no note starts and no note rings into a
  soli-covered bar.
- Unison and divisi: not applicable to percussion.
- Near-silence bar: percussion is tacet.
- Final bar: a closing timpani hit is allowed as a weighted draw (0.5);
  the final bar must still sound (the strings' landing chord is untouched).
- Damping as composition: timpani and cymbal hits are shortened so they
  end before a near-silence bar and before a soli moment — no hit rings
  across them.

### 15.7 Determinism and isolation

The planner runs at the conductor level on its OWN salted D8 stream
(`hashString('percussion')` over the (inputs, take) seed), planned after
the winds; draw order is fixed and position-stable (the final-bar hit, then
per chorus entry in bar order: crash, swell, timpani roll, snare roll, then
per tutti moment: snare roll, timpani roll). The renderer realises the plan
AFTER the winds renderer, claims every rostered writable percussion track
(empty or not), shapes velocities under the window governor bound over
strings + generator + brass + winds + percussion, and applies the
micro-timing last (§15.3). A final safety pass (`governPercussionVelocities`)
re-checks every beat window over the FINAL notes and lowers PERCUSSION
ALONE where the mix would breach the hard clamp — the clamp is never
exceeded. Locked and out-of-band percussion tracks are untouched; the
energy clamp, the one-undo-step contract and the sanitizeNotes no-op are
unchanged; the exports pass the percussion through untouched with and
without the UVI profile (no Falcon profile — the pre-8.1 brass passthrough,
as the winds).

## 16. Keys — harp and piano (Phase 11)

Keys join the orchestrator as a family module beside the strings, brass,
winds and percussion (`src/orchestrator/keys/`), reusing the same structure
— profile, plan, render — and the conductor, the energy arc, the moments
and the golden-byte harness (nothing forked). The strings render first,
brass second, the winds third, the percussion fourth, the keys LAST (their
velocity math sees every other family's rendered notes), the rules
generator covers nothing further. Everything is defined in MIDI numbers,
sounding pitch (the C4=60 display trap noted in §13 applies).

### 16.1 Roster and voices per track

Keys rosters (from the shipped templates): symphony carries harp (no
piano); chamber and sonata carry piano only; cinematic, hybridstudio and
vocalbacking carry both. The config hard ranges (ranges.ts, written C4=60):
piano A0–C8 = 21–108, harp Cb1–G#7 = 23–104 — the track's own
lowestNote/highestNote always wins. One voice per track: sequential figures
only (broken-chord eighths, single-line pulses, glissandos), so the note
`layer` field needed NO generalisation for the figures. The one sanctioned
relaxation is the comping CHORD: the piano's downbeat comp is a chord
(main voice + its 'kbd' sisters — up to COMP_CHORD_VOICES − 1 = 3
sisters, distinct pitch classes, no octave pairs inside the chord), exactly
as 'div2' let one string track carry a second line. 'kbd' is additive and
optional; the validator accepts it; old projects load unchanged.

### 16.2 Registers (MIDI, sounding)

The harp's illustrative sweet spot is 36–91; the extreme top and bottom
octaves are reserved for the roots, the pulses, the tutti hits, the comping
and the glissandos. The bed writes inside the sweet spot over about two
octaves of chord tones; the low plucked roots fold into 23–35; the gliss
runs may span the extremes. The piano's arpeggiator writes 55–84, the comp
register is 48–67 (the search reaches one octave higher so vocalbacking's
zone-shifted tones still yield four voices), the low pulse and the tutti
hit fold into 33–52. In vocalbacking the VOCAL ZONE (A3..A5 = 57–81, the
D6 default the strings already keep free) stays free of BOTH parts: a note
that would land in it moves by octave (down first, then up) and is dropped
when the track's range cannot take it; a gliss run's zone tones drop out of
the run (holes, the sweep keeps its direction).

### 16.3 Roles by template and energy

- Harp arpeggio bed: broken-chord eighths cycling the chord tones over
  about two octaves — the pool is rebuilt at EVERY onset, so a bar spanning
  two half-bar chords walks both (stateless per bar; no ghost runs are
  needed anywhere in this module). Main at low to mid energy; under the
  chorus relief it keeps ringing. Chord tones only. The low plucked roots:
  a soft quarter pluck on phrase starts under the pizz-flavoured sparse
  textures at low energy; under the chorus relief (when the piano owns the
  arpeggiator) the roots become the harp's drive line — the root on every
  quarter, never an arpeggio.
- Glissando (rare, weighted, at most 2 per piece): an upward run of the
  key's diatonic scale only, ending on a chord tone AT a chorus or tutti
  downbeat; a descending run may mark an outro/resolution (the first
  outro-like section's downbeat); stored as plain notes (no articulation);
  1 beat to 1 bar; 16ths; a velocity ramp into the landing. The runs check
  their crossing bars free of near-silence at draw time; a soli covering a
  crossing bar deletes the kind at the voice map.
- Piano arpeggiator: broken-chord eighths in 55–84 at low to mid energy in
  cinematic and hybridstudio ONLY, drawn per SECTION TYPE (one arpeggiator
  per section — never both a harp bed and a piano arp in one bar).
- Low octave pulse: the root on quarters at high energy in ostinato or
  trailer textures (de facto cinematic); under the chorus relief it is the
  non-arpeggiating piano's drive line. Never faster than eighths.
- Comping (chamber, sonata, vocalbacking): the chord on downbeats or phrase
  starts at low to mid energy, on the fillGating answer bars the conductor
  reserves, and — under the chorus relief — on EVERY QUARTER (the drive's
  grid line; the generator's own chorus comp was a quarter-grid block
  chord). One chord per onset, ringing a beat.
- Tutti: the piano hits the downbeat's root (low, marcato, the drawn moment
  shape); the harp's glissando lands on the downbeat when drawn (weighted)
  and otherwise the harp is tacet. Unison: the keys do not join (tacet).
- Final bar: the closing figure sounds — the harp descends the chord (the
  resolving direction), the piano anchors the root (low, marcato, half a
  bar: the figuration exemption's short side against the strings' long
  landing chord). The final bar is never a tacet.

### 16.4 Gating by section target energy (fractions of the clamp max)

- below 0.30 — no keys (the near-silence and thin bars stay thin);
- LOW, ≥ 0.30 — the harp bed (soft), the piano comping at phrase starts
  and the fillGating answer bars;
- MID, ≥ 0.50 — the arpeggiators' main zone, the bed;
- HIGH, ≥ 0.72 — the harp thins to glissandos or rests outside a chorus
  (it is buried under a tutti); the piano's low octave pulse;
- PEAK, ≥ 0.90 — harp tacet except a glissando; the piano's pulse.

Chorus relief (the 8.3/10 lesson — a chorus must not get thinner): inside
a chorus-type section the keys sound from the section's FIRST bar at the
LOW gate — the drawn arpeggiator keeps its figure, the comping rides every
quarter, the bed keeps ringing, the non-arpeggiating part takes its drive
line (roots / pulse on quarters). No entrance rule, no thin-to-rests.
Velocity: the ordinary notes shape against the MUSICAL ceiling (84 — the
generator's keys band topped there) capped by the window bound; the relief
notes ride the ABSOLUTE relief velocity 92 (the percussion drive's rule,
§15.4a — the block chord the comp replaces sat above any shaped level),
and the hard clamp stays with the final safety pass (§16.8).

### 16.5 Moments, tacets and damping

- Tutti: the piano root hit + the harp glissando (weighted draw) — the
  moment is roster-defined as before; the keys renderer writes its own
  gestures from the moments plan (the compose loop's roster hit stays in
  the phantom, §15.2's mechanism).
- Unison: the keys do not join — tacet.
- Soli and near-silence bars: tacet — no note starts and no note rings
  across them (the damping shortens the ringing figures, §15.6's rule).
- Final bar: the closing figure (§16.3) — it must still sound.

### 16.6 Retirement of the old generator's keys rules

The rules generator wrote keys through six labelled parts: Intro "Harp
arpeggio", Verse "Piano chords", Chorus "Piano" and "Harp arp", Outro
"Harp final" and the catch-all "Keys sustain (any family Keys)". The keys
module owns the SOUND of the rostered harp/piano tracks from Phase 11 on:
its notes replace the generator's at assembly. As with the winds and the
percussion, the generator KEEPS writing them as a phantom input — the pad
governor's, the humanize jitter caps' and the brass/wind/percussion caps'
window math read the phantom exactly as at HEAD, which keeps every non-keys
track byte-identical (the pre-flight measured the dependence: without the
phantom the mix windows change on every keys-rostered template). The
phantom never reaches the final score (the module claims every rostered
keys track, empty or not), and a stale pre-compose CC lane cannot leak
through the assembly (the winds rule). A user-added generic 'keys' track
(role 'keys') is not rostered — the generator keeps it.

### 16.7 Humanize and determinism

Micro-timing is per-note, hash-seeded from (track, start, pitch) — no
Math.random — stored IN the notes so the preview and the export show the
same offsets: harp +0..8 ms, piano +4..12 ms, lags only; a note never
crosses its bar or a moment boundary because of the jitter (the start
clamps inside the written bar; the end stays where the figure put it). No
CC lane reaches a keys track — no sustain pedal, no new CC (the generator
writes none today). The planner runs at the conductor level on its OWN
salted D8 stream (`hashString('keys')` over the (inputs, take) seed),
planned after the percussion; draw order is fixed and position-stable (the
arpeggiator per section type, then the chorus-entry glissandos in bar
order, then the outro glissando, then the tutti glissandos in bar order —
the moment-dependent draw rides LAST so a moments-off run consumes an
identical prefix). Locked and out-of-band keys tracks are never written;
one undo step per Compose All; output is a sanitizeNotes no-op and
validateProject passes; the exports pass the keys through untouched with
and without the UVI profile (no keys part mapped — the pre-8.1 brass
passthrough).

### 16.8 The clamp

Every keys note's velocity is capped by the governor bound of the beat
window it attacks in (mean ≤ 127·clampMax·N/roles — the relief's absolute
velocity included, which the bound may EXCEED: the drive's rule), and a
final safety pass (`governKeysVelocities`) re-checks every beat window over
the FINAL notes and lowers KEYS ALONE where the mix would breach the hard
clamp — the clamp is never exceeded.

### 16.9 Implementation notes (how §16 landed)

- The comping chord is the ONE place the one-voice cap bent: the sonata and
  chamber choruses were held up by the generator's block chords, and a
  single guide tone cannot carry the window mean. The 'kbd' layers are the
  div2 precedent applied to keys.
- The relief's absolute velocity exists for the same reason: the window
  bound is a CEILING, not a target, and the tight-clamp templates (sonata:
  bound 82) left the chorus mean below the baseline when the keys shaped
  against the bound. The safety pass holds the clamp; zero aboveMax over
  the whole survey is pinned.
- The keys line is stateless per bar (no pitch walks), so no moment needs a
  ghost run — the draw-identity pin is satisfied by draw ORDER alone.
- The half-bar chord walk: a bar spanning two chords (the dorian fixture's
  grid) reads the span at every onset — the bed, the arpeggio and the comp
  all change colour mid-bar.
