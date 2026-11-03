# Crescode Orchestration Engine — Build Plan

Companion to `docs/ENGINE_BUILD_GUIDE.md` (native VST engine — separate track, unaffected by this plan).
Scope: the **musical brain** behind **Orchestrate All** in the frontend, as a new module `src/orchestrator/` layered on top of the existing `src/engine/generate.ts`, which stays untouched as the "legacy rules" path.

Design decisions locked with the project owner (2026-10-28):

| Decision | Choice |
|---|---|
| Melody | **Hybrid** — auto-compose when no melody exists; wrap the orchestra around a locked melody track when present |
| Voicing | **Shared brain** — one concert-pitch voicing per chord, voice-led; every instrument reads its slot from it |
| Ensemble | **Vibe presets** — Intimate / Chamber / Cinematic / Epic; energy curve drives layering |
| Texture library v1 | **Core 8** — sustain pad, 8th ostinato, 16th ostinato, arpeggio, tremolo, swell, pizzicato, counter-line |
| Transition drama | **Full drama kit** — risers, tutti hits, cymbal crashes, stripped bridge |
| Architecture | **New module** `src/orchestrator/`; legacy rules config stays as fallback |

Non-negotiables carried over from the existing engine: seeded determinism (never `Math.random`), locked tracks returned untouched, every note sanitized to track range, no zero-length/overlapping same-pitch notes, nothing past project end, no new npm dependencies, no `Project` schema change (vibe is a compose-time option).

---

## 0. The promise (what pressing the button gives)

Today, Compose All generates independent per-track patterns — technically correct, musically flat: nothing coordinates the instruments with each other. After this build, pressing **Orchestrate All** on the stock `fixtures/dorian-16bars.json` (D Dorian, 100 BPM, Verse 8 bars + Chorus 8 bars) with **Cinematic** yields in one shot:

- **Verse (bars 1–8):** cellos+basses hold the D-root bass, moving by 5th or less to G when G7 arrives; violas + violins II sustain the Dm7/G7 shells, voice-led into each change; violins I sing a composed motif that gets sequenced over the Em7→Fmaj7 turn; clarinet answers beneath it; harp rolls 8th-note arpeggios; timpani lands roots on downbeats at half density.
- **Boundary (bar 8):** timpani roll crescendo + harp upward gliss — a riser into the chorus.
- **Chorus (bars 9–16):** downbeat tutti hit + cymbal crash; horns join the shells; violins II switch to an 8th-note ostinato; flutes double the melody an octave up; trumpets stab chord tops on strong beats; piano opens into full voicings.
- **If the section repeats:** one extra layer each time (ostinato added, then octave doubling) — repeats *grow*, they never copy-paste.
- **Why it did that is inspectable:** an orchestration report shows the energy map and the layer choices per section.

The rules that produce this are the subject of this document. They are rule-based (expert system), not ML: deterministic, auditable, tweakable, and fast enough to run synchronously on Compose All.

---

## 1. Architecture

```
orchestrate(project, request) -> { tracks: Record<trackId, Note[]>, report: OrchestrationReport }
   │
   ├─ 1. energy.ts      sections -> energy curve 0..1 (name keywords, occurrences, vibe reshape)
   ├─ 2. harmony.ts     chord progression -> harmony spine (voiced chords, voice-led)
   ├─ 3. melody.ts      locked melody? borrow : compose motif + development -> MelodyLine
   ├─ 4. conductor.ts   per section: layer budget (energy × vibe) -> assign instruments
   │                    to slots & textures (eligibility matrix + priority tables)
   ├─ 5. textures.ts    core-8 pure functions: (slot, section, energy, rng) -> Note[]
   ├─ 6. drama.ts       boundary scan -> risers / hits / crashes / wind-downs
   └─ 7. render.ts      plan -> per-track notes -> sanitizeNotes (+humanize) from engine/generate.ts
```

New files:

```
src/orchestrator/
  types.ts        — OrchestrationPlan, VoicedChord, Assignment, OrchestrationReport …
  energy.ts       — energy map
  harmony.ts      — voicing brain (harmony spine)
  melody.ts       — motif engine + hybrid melody source
  conductor.ts    — slot/texture assignment
  textures.ts     — core-8 texture generators
  drama.ts        — transitions & hits
  render.ts       — plan -> notes, reuses engine sanitizers
  presets.ts      — the four vibe presets (data, not logic)
  index.ts        — orchestrate(): the pipeline, single entry point
```

Imports the orchestrator may take from existing code (nothing else): `parseChord`, `scalePitchClasses`, meter helpers (`barTicks`, `beatOffsets`, `pulseTicks`, `isCompound`, `projectBars`), `hashString`/`mulberry32`, `sanitizeNotes`, and — required small refactor — export `humanizeNotes` from `engine/generate.ts` instead of duplicating it.

### Core data contracts (paste into `types.ts`)

```ts
export type Vibe = 'intimate' | 'chamber' | 'cinematic' | 'epic';

export interface OrchestrationRequest {
  seed: number;
  vibe: Vibe;
  /** User density multiplier from the Compose All dropdown, 0.5..1.5. Default 1. */
  density?: number;
}

export interface EnergyPoint {
  sectionIndex: number;
  base: number;        // from section name keywords (0..1)
  effective: number;   // after vibe reshape + occurrence boost + drama offset
  occurrence: number;
}

/** One concert-pitch voicing per chord. Slots are ordered low -> high. */
export interface VoicedChord {
  chordId: string;
  startTick: number;
  endTick: number;
  bass: number;            // MIDI note (bass slot)
  fills: number[];         // MIDI notes (mid slots, ascending)
  top: number;             // MIDI note (headroom slot under the melody)
  /** Which pitch-class role each fill plays: 'root' | 'third' | 'fifth' | 'seventh' */
  fillRoles: Array<'root' | 'third' | 'fifth' | 'seventh'>;
}

export type TextureId =
  | 'sustainPad' | 'ostinato8' | 'ostinato16' | 'arpeggio'
  | 'tremolo' | 'swell' | 'pizz' | 'counterLine';

/** One instrument doing one texture over one section. */
export interface Assignment {
  trackId: string;
  role: string;
  sectionIndex: number;
  texture: TextureId | 'melody' | 'bass' | 'hits' | 'riser' | 'crash';
  slot?: 'bass' | 'fillA' | 'fillB' | 'fillC' | 'top'; // which spine slot it reads
  doubleOf?: { role: string; interval: number };       // intended unison/octave (melody doublings only)
  intensity: number;                                    // 0..1, scales velocity
}

export interface OrchestrationReport {
  vibe: Vibe;
  energy: EnergyPoint[];
  assignments: Assignment[];   // the full "why" — rendered in the UI report
  dramaEvents: { tick: number; kind: 'riser' | 'hit' | 'crash' | 'winddown'; detail: string }[];
  melodySource: 'composed' | 'locked:<trackId>' | 'none';
}
```

Everything downstream of the spine reads slots by **register proximity**, not by hard-coded instrument: `slot owner tables` in §5 decide which *available* track takes `bass` / `fillA` / `fillB` / `fillC` / `top` in each section.

---

## 2. Stage 1 — Energy map (`energy.ts`)

Energy is a 0..1 scalar per section. It is the single knob the rest of the pipeline reads.

**Base energy by section-name keywords** (case-insensitive, same matching spirit as `resolveRuleKey` — exact, then first word, then default):

| Name contains | Base |
|---|---|
| `intro`, `prelude`, `overture`, `fanfare` | 0.20 |
| `verse`, `theme`, `a` (whole-name match), `groove` | 0.40 |
| `pre-chorus`, `prechorus`, `build`, `rise`, `lift` | 0.60 |
| `chorus`, `refrain`, `hook`, `drop`, `b` (whole-name) | 0.85 |
| `bridge`, `middle`, `c` (whole-name), `interlude` | 0.50 |
| `solo`, `breakdown` | 0.25 |
| `outro`, `coda`, `finale`, `fade` | 0.30 |
| unknown | interpolate between nearest named neighbors; if none named, 0.5 |

**Adjustments, applied in order:**

1. **Occurrence boost** — 2nd occurrence of the same ruleKey: `+0.08`; 3rd+: `+0.12` (capped 1.0). Repeats must intensify.
2. **Vibe reshape** — `effective = min + (base × (max − min))` using the preset's `[min, max]` (§7). Epic lifts everything; Intimate caps the ceiling.
3. **Drama offset** — a section entered via riser gets `+0.03` on its first bar (rendered only, keeps the plan honest).

Sections with no explicit name (`*` fallback in the legacy engine) get 0.5 base. A project with **no sections at all** (bare chord progression) is one implicit section at base 0.55 — still gives a full-sounding result.

---

## 3. Stage 2 — Harmony spine (`harmony.ts`) — the heart

One voicing per chord, shared by the whole orchestra. All instruments later claim registers inside these slots. This is the single change that most improves the sound: today each track picks notes independently and the result muds and clashes.

**Rules (in priority order):**

1. **Bass slot.** Bass pitch class = slash bass if present, else chord root. Concrete bass note chosen in `E1–C3` (28–48): prefer the octave nearest the previous chord's bass; constrain motion to ≤ P5 except (a) section starts and (b) after any bass > P4 away, where a reset leap is allowed. Never two adjacent bass notes a tritone apart unless the chords are tritone-related.
2. **Fill slots (2–4 notes).** Must include the 3rd (or the sus color tone for sus chords). Add the 7th when the chord has one (7ths *must* sound in Cinematic/Epic — they are the color). Add the 5th only if fewer than 3 fills are needed. Pitch classes must not duplicate the bass pc. 7th-chord omission rule: when the register window is tight, omit the 5th, never the 3rd or 7th.
3. **Spacing (the anti-mud rules).**
   - Below C3 (48): adjacent fill voices ≥ minor 3rd apart (no 2nds/3rds down low — instant mud).
   - C3–C5 (48–72): close position allowed (3rds/4ths fine).
   - Above C5: ≤ octave between adjacent voices (avoid gaps the ear hears as holes).
   - Total spread of fills ≤ 2 octaves.
4. **Top slot.** One note a 3rd–6th above the highest fill — this is *headroom*, not melody. It is the note a pad-style violins-I would hold when the melody line is silent (Intro, fills between phrases). Chord 5th or 9th preferred, never the 3rd (3rd on top flattens the sound when melody later sits above it).
5. **Voice leading.** Between consecutive chords: each slot moves to the *nearest* candidate pitch of the new chord's same role; common tones hold exactly. Max average motion target ≤ 4 semitones; if a slot would have to leap > 7, swap fill roles between slots before leaping. Bass follows rule 1 independently.
6. **Register anchoring.** The whole spine is anchored so that the fill cluster centers around C3–C4. Anchoring is per-**section**: the first chord of each section re-anchors (fills centered near middle C) so long progressions cannot drift into the extremes.
7. **Invariance (critical for the wow).** The spine depends on **chords + key + meter only** — *not* on occurrence, energy, vibe, or seed. Repeats are the same harmony growing louder and busier, which is what makes it feel like one piece of music. (Seed may select between equally-legal voicing candidates, but must be the same for every occurrence of the same chord slot sequence — use a chord-progression-keyed rng, not a per-section rng.)

**Reference flow:**

```
for each chord c (sorted by startTick):
  bassPc    = c.bass ?? c.root
  tones     = ordered chord tones with roles [root, third, fifth, seventh…]
  fills     = pickFills(tones, previousFills)        // rules 2, 5
  place     = applySpacing(fills, anchor)           // rules 3, 6
  top       = headroom(place)                       // rule 4
  bass      = placeBass(bassPc, previousBass)       // rule 1
```

---

## 4. Stage 3 — Melody engine (`melody.ts`) — hybrid

**Source resolution (in order):**

1. If any **locked** instrument track contains notes and its role is in the melody-carrier priority list (§5), its notes are the MelodyLine (borrowed). The spine's `top` slot defers to it; doublings align to it.
2. Else if the user has flagged a melody source (v1.1 UI: track menu → "Use as melody source"), same as 1.
3. Else **compose**.

**Composition grammar (v1, deliberately conservative — anti-cheese by constraint):**

- **Motif:** 2–4 notes. First note is a chord tone of the section's first chord (weight: 5th 0.4, 3rd 0.35, root 0.25). Contour archetypes: arch, descent, ascent, pendulum — chosen by seed. Interval vocabulary: steps and 3rds dominate; one leap of a 4th/5th allowed inside the motif, only ascending into it or descending out.
- **Rhythm:** pick from phrase templates expressed in **felt beats** (via `MeterInfo` — dotted-quarter beats in 6/8, so compound meters work for free). 4/4 examples: `[1, .5, .5, 2]`, `[1.5, .5, 1, 1]`, `[.5, .5, 1, 2]`. Template must fit the meter's bar; strong-beat positions snap to chord tones, weak beats may use scale tones (the `chordToneOnStrongBeats` concept already proven in the legacy rules).
- **Phrases:** 2-bar (short sections) or 4-bar. Per phrase, apply one development transform (seeded): `repeat` · `sequence` (shift ±2/±3 scale degrees onto the new chord) · `invert` (flip contour) · `same-rhythm-new-pitches` · `fragment` (first half of motif + rest). Bridges get a **contrast rule**: new motif, not a transform.
- **Constraints:**
  - Range: the carrier's sweet spot (violins I: G4–D6). Melody stays ≤ 2 octaves total per section.
  - Leaps ≤ P4 within a phrase, except one structural leap to the section climax.
  - Climax: exactly one per section, in the second half, on a strong beat, approached by step or 4th.
  - Cadence: final phrase ends on a chord tone of the last chord, approached by step (2̂→1̂, 7̂→1̂, 5̂→1̂ patterns).
  - Breathing: last beat/half-beat of each phrase is a rest. No wall-to-wall notes.
- **Occurrence invariance:** the composed melody is identical for every occurrence of a section key (same rng discipline as the spine). Development across repeats comes from *orchestration* (doublings, layers), not new notes.

---

## 5. Stage 4 — Conductor (`conductor.ts`)

Decides, per section: **layer budget** → **which tracks do what**.

**5.1 Layer budget by energy** (Cinematic shown; presets scale these bands):

| Effective energy | Layers | What enters |
|---|---|---|
| < 0.30 | 2 | soft string pad, bass |
| 0.30–0.50 | 3 | + harp arp (or keys) |
| 0.50–0.70 | 5 | + horns pad, counter-line, timpani downbeats |
| 0.70–0.85 | 7 | + melody doublings, ostinato8, brass hits |
| ≥ 0.85 | 9 | + ostinato16/tremolo accent, full bass reinforcement, crash |

Layer budget counts *simultaneous sounding layers*, so ostinato replaces (not adds to) pad for one slot — the ear must never hear 9 things all doing sustains.

**5.2 Slot owner tables** (first available wins; `strings`/`brass`/`woodwinds`/`keys` generic roles map to their family):

| Slot | Priority |
|---|---|
| melody | violins1 → flutes → trumpets → generic strings |
| bass | cellosBasses → bassoons → tuba → generic strings |
| fillA (upper mid, under melody) | violins2 → oboes → horns → generic strings |
| fillB (mid) | violas → clarinets → horns → generic brass |
| fillC (low-mid) | trombones → bassoons → horns |
| texture (harp/keys/pizz/sparkle) | harp → piano → aux |

**5.3 Texture eligibility matrix** (family × energy band; `·` = not eligible):

| Texture | Strings | Brass | Woodwinds | Keys | Percussion |
|---|---|---|---|---|---|
| sustainPad | ≥ 0.15 | ≥ 0.50 (horns only) | ≥ 0.30 | ≥ 0.15 | · |
| ostinato8 | 0.45–0.90 | · | ≥ 0.60 | ≥ 0.40 | · |
| ostinato16 | ≥ 0.80 | · | ≥ 0.85 | ≥ 0.70 | · |
| arpeggio | · | · | ≥ 0.30 | always | · |
| tremolo | 0.55–0.95 | · | · | · | · |
| swell | ≥ 0.40 | ≥ 0.40 | · | · | · |
| pizz | ≤ 0.55 | · | · | · | · |
| counterLine | ≥ 0.40 | · | ≥ 0.40 | · | · |

Plus fixed-role behaviors: timpani = roots on strong beats (density ~0.5 at low energy → full at high), snare = backbeats ≥ 0.70 + rolls as risers, cymbals = crashes only (drama kit), aux = shaker/8ths ≥ 0.75.

**5.4 Assignment algorithm (per section):**

1. Build candidate list: every unlocked instrument track × eligible textures from the matrix.
2. Reserve exactly **one melody carrier** and **one bass carrier** (top of the slot tables). If a texture call would double-book a reserved track, skip it.
3. Fill remaining layer budget by descending energy-fit score = `textureEligibility × registerProximity(track, spine slot)`, seeded tiebreak. Register proximity = how close the track's sweet spot is to its assigned spine slot (prevents flutes trying to moan in the cellos' basement).
4. **Collision rule:** adjacent registered layers may not sound the same pitch (unison) unless it is an intended melody doubling (`doubleOf`). Octaves are allowed; unisons are not.
5. Repeat occurrences: budget may grow by 1 per repeat (cap 9); new layers attach at the *bottom* of the texture stack (ostinato under pad, then doublings on top).
6. Bridge override: sections matching bridge/interlude keywords strip to melody-less `counterLine` + soft `sustainPad` + optional harp — regardless of energy. Silence is the drama.

---

## 6. Texture library (`textures.ts`) — core 8

Every texture is a pure function `(input: TextureInput) => Note[]` where input = spine slice for the section, melody line (for doubling/counter reference), meter, energy, seed-rng, and the owning track (for range). All velocities derive from energy via the family curve (§8), then texture offsets.

1. **sustainPad** — read assigned spine slots; tie across chord changes (`per: 'chord'` semantics), legato 0.95, gentle 1–2 semitone voice-leading is *free* because the spine already voice-led.
2. **ostinato8** — 8th-note pulse cycling fill tones ascending-then-reset (not strict up/down — reset at top keeps it hypnotic); accent on meter's strong beats (+8 vel); direction restarts at each chord change. Owner: violas/violins II.
3. **ostinato16** — same logic in 16ths, prob-masked on off-beats (0.75) so it shimmers rather than machines. High energy only.
4. **arpeggio** — up through bass→fills→top across the chord duration, note count = min(8, chord length in 8ths); harp gets the first 8th of each bar free as a grace sparkle.
5. **tremolo** — held spine tones re-articulated in 32nd pairs, vel low (45–60), reserved for tension bands; never on more than 2 tracks at once.
6. **swell** — single sustained note per chord with `velocityCurve: crescendo` stretched over the last 2 bars before a boundary (velocity mapped 40 → 90); owners: strings + horns.
7. **pizz** — short (legato 0.3) chord-tone pips on beats 1 & 3 (meter-aware: pulses in compound), light sections; vel 55–70.
8. **counterLine** — stepwise line against the melody in contrary motion: mirror the melody's contour within ±4 scale degrees, but flip direction when the melody leaps; snap to chord tones at chord changes; a 3rd–6th below the melody register. If no melody exists, it walks the spine's fill tones with `maxLeap 4`.

Percussion is never "textured" — timpani/snare/cymbals/aux have fixed idioms (§5.3), because wrong percussion is the fastest way to break the illusion.

---

## 7. Vibe presets (`presets.ts`)

| | Intimate | Chamber | Cinematic (default) | Epic |
|---|---|---|---|---|
| energy clamp `[min, max]` | [0.15, 0.60] | [0.25, 0.75] | [0.30, 0.90] | [0.45, 1.00] |
| max simultaneous layers | 3 | 5 | 7 | 9 |
| brass allowed above energy | — | 0.60 | 0.50 | 0.40 |
| percussion allowed above | — | 0.70 | 0.55 | 0.45 |
| melody octave doubling | never | climax only | ≥ 0.70 | always in tutti |
| ostinato16 allowed | no | no | ≥ 0.80 | ≥ 0.70 |
| crash allowed | no | ≥ 0.75 | ≥ 0.80 | ≥ 0.70 |
| default vibe for the ▾ menu | | | ✓ | |

Presets are **data**. The conductor reads them; adding a 5th vibe later is adding an object, not code.

---

## 8. Dynamics mapping (energy → velocity)

Velocity is composed once, centrally, so no texture invents its own loudness:

```
base(energy, family) = floor(30 + 70 × energy)      // 30..100
family offset        = strings 0 · woodwinds −4 · brass +6 · keys −2 · timpani +4
texture offset       = pad −6 · ostinato 0 · arp −4 · pizz −4 · tremolo −10 · melody +8 · hits +12
accent offsets       = meter accents (from rhythm templates) + humanize delta
```

Section-internal shape: long sections (≥ 8 bars) get a ±6 velocity arc (crescendo into the midpoint, relax after), implemented as a linear bend on `base` — this is the "breathing" that separates trailer music from looped pads.

---

## 9. Drama kit (`drama.ts`)

Boundary scan over consecutive sections:

```
Δ = energy(next) − energy(current)
if Δ ≥ +0.15  → riser in the last bar of current (pick by availability, seeded:
                timpani 16th roll crescendo on next chord's root
                → harp scale gliss up, final beat
                → snare roll)
if energy(next) ≥ 0.70 → tutti hit on next section's downbeat:
                stacc chord stab (legato 0.25) for all active strings+brass, vel +12 vs base
if energy(next) ≥ 0.80 (preset gate) and cymbals track exists → crash on that downbeat
if Δ < 0      → wind-down: pads in the last bar get diminuendo curve (vel −15 over the bar)
```

Constraints: a riser may not coexist with a wind-down (mutually exclusive by Δ sign); max one riser instrument per boundary; risers never appear inside a section, only across boundaries; hits are ≤ 1 beat, so they don't fight the pad's sustain (same-pitch overlap sanitizer already merges them).

---

## 10. Worked example (the fixture, Cinematic)

`dorian-16bars.json` — D Dorian, 4/4, Verse (bars 1–8: Dm7 · G7 · Dm7 · Em7→Fmaj7 · Dm9 · C/E · Am7), Chorus (bars 9–16: G · Dm · Fmaj7 · C · G/B · Dm7 · Bbmaj7 · C→A7sus4→Dm7).

**Energy:** Verse base 0.40 → effective 0.39 after reshape; Chorus 0.85 → 0.83; Δ ≈ +0.44 → **riser fires** at bar 8; Chorus ≥ 0.80 → **hit + crash** at bar 9.

**Harmony spine, first four chords (illustrative):**

| Chord | bass | fills | top | motion from previous |
|---|---|---|---|---|
| Dm7 | D2 (38) | F3 · A3 · C4 | E4? no — D4's 5th slot → A3? see note | — (section anchor) |
| G7 | G2 (43, P4 up) | F3 (held) · B3 · D4 | A4 | F holds; A3→B3, C4→D4 |
| Em7 | E2 (40, step down) | G3 · B3 · D4 | F#4 | B3 holds, D4 holds |
| Fmaj7 | F2 (41, step) | A3 · C4 · E4 | G4 | smooth stepwise climb |

*(Exact octaves are the implementation's job; the invariant is the motion budget ≤ 4 semitones average and no low-mud intervals — the table shows the *shape* of what must pass.)*

**Assignments, Verse (budget 3):** cellosBasses = bass slot sustain · violas+violinsII = pad on fills · violinsI = composed melody · harp = arp · timpani = downbeat roots at density 0.5 · clarinets = counterLine (energy-gated in at 0.40 for Cinematic? — no: 0.40 < 0.40 threshold, clarinet stays silent in Verse; it enters in the boost on Verse 2 at effective 0.47).

**Assignments, Chorus (budget 7):** bass reinforcement adds bassoons under cellos · violinsII flips pad → ostinato8 · horns join fills · flutes double melody +8ve · trumpets = hits on strong beats · piano = arpeggio → full chords · snare backbeats in · riser resolved, crash fired.

Second Verse (occurrence 2): same melody, same spine, +ostinato8 in violas, +2 velocity, clarinet in. **It sounds like the same piece, growing.**

---

## 11. Integration

- **`store.composeAll()`** — if the compose-options vibe ≠ `legacy`, call `orchestrate(project, { seed, vibe, density })` instead of `generate(...)`. Same post-processing order: humanize → sanitize already handled inside `orchestrate`'s render step. Keep returning elapsed ms (perf budget: < 80 ms for a 200-bar project; the pipeline is O(sections × tracks × chords), trivial at these sizes).
- **Compose All ▾ menu** — add an "Orchestra vibe" row of chips: Intimate / Chamber / Cinematic / Epic / Legacy rules. Persist last choice in localStorage alongside seed/density/humanize. Default Cinematic.
- **Locked tracks** — unchanged contract: returned untouched. Locked melody tracks additionally feed the melody engine (source resolution §4). This is the hybrid working exactly like the user already expects locks to work.
- **Density slider** — multiplies texture prob-masks (ostinato16 masking, timpani density) and layer budget thresholds ±0.05; does not touch spine or melody.
- **Orchestration report (v1):** after compose, StatusBar tooltip / small popover listing: vibe, per-section energy, layers, drama events. v1 can be plain text; v1.1 renders the energy curve as a sparkline. This is the answer to "according to what rules?" — visible, not hidden.
- **Export** — zero changes. Notes are notes; MIDI export already round-trips.
- **Legacy path** — `generate()` + `generation-rules.ts` stay green and are the "Legacy rules" vibe. No migration forced on power users.
- **Small refactor required:** export `humanizeNotes` from `engine/generate.ts` (currently module-private). No behavioral change; existing tests keep passing.

---

## 12. Build phases (each ends audible + green tests)

**Phase 1 — Harmony spine + static orchestration** *(the "in-tune orchestra" moment)*
`types.ts`, `harmony.ts`, `render.ts`, minimal `conductor.ts` (fixed slot tables, sustainPad + bass + melody-carrier-holds-top only).
*Wow test:* load fixture, add the standard 21 tracks, Compose → it sounds like one string section rehearsing: no mud, no clashes, bass moves musically.
*Tests:* voicing invariants (spacing rules per zone, voice-leading budget, bass motion rules, spine occurrence-invariance).

**Phase 2 — Energy map + conductor + presets**
`energy.ts`, `presets.ts`, full `conductor.ts`.
*Wow test:* Verse → Chorus audibly thickens; the four presets are distinguishable blind.
*Tests:* keyword table, occurrence boost, vibe reshape clamps, layer budgets, assignment uniqueness (one melody carrier, one bass carrier), no unintended unisons.

**Phase 3 — Texture library (core 8)**
`textures.ts`.
*Wow test:* motion — ostinato under the pad, harp sparkle, swells into boundaries; nothing sounds looped.
*Tests:* per-texture rhythm correctness against `MeterInfo` (including 6/8 felt beats), range compliance via sanitize, texture velocity offsets.

**Phase 4 — Melody engine (hybrid)**
`melody.ts`.
*Wow test:* there is a *tune* — hummable, developed across phrases, identical on repeats; lock a piano-roll melody and the orchestra wraps around it.
*Tests:* motif constraints (start/end chord tones, leap limits, one climax, breathing rests), hybrid source resolution order, determinism per seed, occurrence invariance.

**Phase 5 — Drama kit + report**
`drama.ts`, report UI.
*Wow test:* the trailer moment — riser at bar 8, hit + crash at bar 9, second chorus bigger, bridge stripped bare; report explains every choice.
*Tests:* boundary triggers per Δ table, riser/hit/crash gating by preset, spine/melody invariance under drama, report content matches plan.

Order rationale: the spine is the dependency root (every texture reads it); melody is late because it is independent and the riskiest to get non-cheesy — by Phase 4 the orchestration around it already sounds good, so the melody lands on a bed that flatters it.

---

## 13. Test & harness plan

- `tests/orchestrator.test.ts` — unit tests per phase above, seeded (same `mulberry32` discipline).
- Harness extension: `npm run harness -- --orchestrate cinematic 42` prints the plan instead of note counts: energy table, per-section assignments, drama events, per-track note counts. This becomes the review tool for every tweak ("did Epic actually add layers?").
- Golden snapshot: `orchestrate(fixture, { seed: 42, vibe: 'cinematic' })` → hash of plan JSON, committed. Any intentional rule change updates it deliberately (same philosophy as their existing export round-trip tests).
- Musical smoke: e2e compose → assert per-family note counts fall inside expected energy-band ranges (catches "Epic got quieter than Intimate" class bugs).

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Melody engine goes cheesy | Conservative grammar (§4), one climax rule, breathing rests, seed re-roll is one click; melody is Phase 4 so bed music is already good |
| Ostinatos machine-like | Prob-masking + accent variance + meter-aware accents; humanize stays on |
| Preset feels like volume knob | Presets change *instrumentation and textures*, not just velocity (§7 gates brass/percussion/16ths) |
| Overloaded final chorus | Layer budget counts simultaneous layers; ostinato replaces pad, never stacks (§5.1) |
| Perf regression on huge projects | O(sections × tracks × chords); budget < 80 ms @ 200 bars, asserted in test |
| Two brains diverge | Orchestrator imports engine primitives; no rule logic copied; legacy path frozen |
