# Piano Engine — Forensic Musical Quality Audit

> **Historical scope:** This audit evaluates the Phase 8 V2 exports and the
> production-path state observed for that snapshot. Its statement below that
> `composeAllTracks` still used legacy `renderKeys` is time-bound; the current
> repository integrates Piano Engine V2 after the non-Piano parts. The findings
> about the saved Phase 8 MIDI files remain unchanged.

## Executive finding

The musical criticism is substantially supported for the designated Phase 8 Composer-v2/Realizer-v2 exports: they are sparse, mostly long chord-change anchors plus a single upper voice, with too little independent hand writing, texture change, or idiomatic development. The code does plan chord-aware intentions and a few genuine techniques; it does **not** plan a complete, note-level piano score, and the realization step often collapses even its symbolic chord voicings to one right-hand note.

There is an important version distinction: I found **no seven-note simultaneity in the five Phase 8 v2 piano-only exports**. Their measured maximum overlap is three notes in four templates and four in Sonata. Seven-note overlaps do occur in the bundled `legacy-piano.mid` comparisons for Cinematic, Hybrid Studio, and Sonata, and the current production `composeAllTracks` path still calls the legacy `renderKeys` renderer; the Phase 8 Composer/Realizer is not called there. If the audition was of an ordinary application export, the legacy path is the likely source of the seven-note passages.

**Recommendation:** rebuild the musical-writing model as a two-hand, voice-led score planner; retain the Analyzer’s read-only input snapshot, useful chord/suspension/voice-leading utilities, deterministic seeding, and safety gates. Do not try to solve the musical-quality failure by adding more cases to the current Composer/Realizer.

## Scope and method

I read the Phase 8 bundle’s [`manifest.json`](../phase8/manifest.json) and audited the per-template files it labels `phase8ComposerPiano` (for example, [`Chamber v2`](../phase8/exports/chamber/composer-v2-realizer-v2-piano.mid)). I parsed the piano note-on/note-off events and checked the associated generated Composer plans and realized-note records. I also parsed the `legacy-piano.mid` files separately to locate the reported seven-note examples. No test outcomes were used as evidence of musical quality, and no audio was rendered in this audit.

The five examples use the same 16-bar D-Dorian, 100 BPM, 4/4 fixture: 960 ticks per quarter note, 3,840 ticks per bar, endpoint 61,440. Bar numbers below are one-based; pitches are MIDI numbers with C4 = 60. Durations are ticks and velocities are MIDI note-on velocities. Maximum polyphony counts active piano notes over half-open note intervals `[startTick, endTick)`.

### Direct MIDI scan of the designated Phase 8 v2 exports

| Template | Piano notes | MIDI pitch range | Attacks, bars 1–8 / 9–16 | Maximum active piano notes |
|---|---:|---:|---:|---:|
| Chamber | 23 | 45–75 | 6 / 17 | 3 |
| Sonata | 45 | 45–81 | 21 / 24 | 4 |
| Vocal Backing | 26 | 45–69 | 6 / 20 | 3 |
| Cinematic | 33 | 33–93 | 11 / 22 | 3 |
| Hybrid Studio | 25 | 45–81 | 8 / 17 | 3 |

These counts agree with the Phase 8 bundle’s note counts and maximum-overlap metadata. The endpoints are not, by themselves, proof of useful register development: Cinematic’s five-octave min/max comes from a handful of distant low/high notes, while four templates occupy a 24–36-semitone total range and often leave the same low-plus-upper gap for whole bars.

## MIDI examples: symptoms visible in the notes

### Sparse shells and repeated downbeat texture

In [`Vocal Backing v2`](../phase8/exports/vocal-backing/composer-v2-realizer-v2-piano.mid), the chorus settles into repeated two-note chord shells:

- **Bar 10, tick 34,560:** MIDI **53 (F3)**, duration **3,533**, velocity **58**; MIDI **69 (A4)**, duration **3,533**, velocity **68**. The supplied chord is Fmaj7; the piano sounds only root and third.
- **Bar 11, tick 38,400:** MIDI **52 (E3)**, duration **3,533**, velocity **58**; MIDI **60 (C4)**, duration **3,533**, velocity **68**. The supplied chord is C; this is third plus root, without G.
- **Bar 12, tick 42,240:** MIDI **47 (B2)**, duration **3,533**, velocity **58**; MIDI **55 (G3)**, duration **3,533**, velocity **68**. The supplied chord is G/B; again this is a two-note fragment.

Each pair attacks at the bar/chord downbeat and sustains for about 92% of the bar. The pitches change with the harmony, but the repeated texture, duration, and velocity pairing make this read as a low note plus one upper answer rather than a developed two-hand accompaniment.

[`Chamber v2`](../phase8/exports/chamber/composer-v2-realizer-v2-piano.mid) shows an even barer opening: MIDI **65 (F4)** attacks at tick **0** for **1,205** ticks at velocity **38**, then repeats at tick **1,205** for **632** ticks at velocity **40**. There is no further attack until **bar 3, tick 7,680**. Its whole-piece range is 45–75, but this opening passage is literally a repeated single note followed by a long attack gap.

[`Hybrid Studio v2`](../phase8/exports/hybrid-studio/composer-v2-realizer-v2-piano.mid) has the same tendency. At **bar 11, tick 38,400**, MIDI **52 (E3)** and **72 (C5)** both last **3,533** ticks at velocities **58** and **68**. At **bar 12, tick 42,240**, MIDI **47 (B2)** and **67 (G4)** repeat the same duration/velocity pairing. The planned pickup is audible in the MIDI, but it is a small local variation rather than an ongoing syncopated piano texture:

- **Bar 9, tick 30,720:** MIDI **50 (D3)**, duration **3,533**, velocity **58**; MIDI **65 (F4)**, duration **7,526**, velocity **68**.
- **Bar 9, tick 31,200:** MIDI **81 (A5)**, duration **1,008**, velocity **70**.

That A5 is the planned upper-register anticipation, 480 ticks after the downbeat and 480 before the next quarter-note pulse. The Phase 8 summary reports 23/25 Hybrid attacks on quarter notes and 25/25 on eighth-note grid. This is a real, motif-related syncopation, but there are only two off-quarter attacks in the whole 25-note sample.

### Wide register does not necessarily mean full voicing

[`Cinematic v2`](../phase8/exports/cinematic/composer-v2-realizer-v2-piano.mid) does span MIDI 33–93, but its chorus often reduces to an extremely open two-note dyad:

- **Bar 9, tick 30,720:** MIDI **38 (D2)**, duration **3,610**, velocity **58**; MIDI **77 (F5)**, duration **3,610**, velocity **68**.
- **Bar 9, tick 31,801:** MIDI **93 (A6)**, duration **729**, velocity **70**.

The bass and F5 are held for almost the whole bar; the short A6 decorates them. This is a 55-semitone active span at the pickup, not a continuously voiced cinematic chord. The next three downbeats continue the same low-plus-high pattern: MIDI 36/81 at tick 34,560; 36/76 at 38,400; and 35/79 at 42,240, each with 3,610-tick bass/upper notes. The wide range is therefore an occasional register jump, not a carefully developed multi-register ensemble piano texture.

### Chordal writing exists, but is thin and uneven

The output is not literally chord-free. [`Sonata v2`](../phase8/exports/sonata/composer-v2-realizer-v2-piano.mid) begins with a three-note Dm7 fragment at **bar 1, tick 0**:

- MIDI **48 (C3)**, duration **2,765**, velocity **35**;
- MIDI **74 (D5)**, duration **1,584**, velocity **40**;
- MIDI **77 (F5)**, duration **11,290**, velocity **46**.

This is a real, inversion-colored subset of Dm7 (C–D–F), but it omits A and spans 29 semitones from C3 to F5. The F5 lasts nearly three bars while the other notes release much earlier. It is a voicing fragment plus a long-held upper tone, not evidence of a sustained, independently voiced RH chord line.

At **bar 6, tick 19,200**, Sonata reaches four active notes: the earlier MIDI **77 (F5)** from tick 15,360 is still sounding (duration **4,320**, velocity **50**), while MIDI **79 (G5)** (480, 52), **72 (C5)** (3,840, 50), and **52 (E3)** (5,530, 45) begin. That is a four-note overlap, but it is formed by carry-over plus a new bass/upper gesture; it is not a four-note block chord deliberately voiced across two named hands.

### A genuine success: prepared suspension and resolution

The v2 exports do realize the Phase 8 suspension change more clearly than the earlier chord shells. In [`Cinematic v2`](../phase8/exports/cinematic/composer-v2-realizer-v2-piano.mid), MIDI **83 (B5)** starts at **bar 2, tick 3,840**, lasts **4,320** ticks at velocity **37**, and crosses the next chord boundary at **tick 7,680**. MIDI **84 (C6)** first attacks exactly at tick **7,680** for **480** ticks at velocity **37**, so B5 and C6 overlap by a semitone for an eighth note. The held B5 releases at tick **8,160** as C6 is rearticulated there for **3,706** ticks at velocity **40**. This is a concrete prepared, stepwise suspension gesture, though the MIDI realizes the new C before the held B has released. The Phase 8 records report 12/12 planned suspensions complete; this is a useful local technique to retain, not a substitute for a full piano texture.

### Where the seven-note passages actually are

The claimed seven-note stack is **not present in any designated Phase 8 v2 piano-only export or its `combined-v2-piano.mid` piano track**. It is present in the bundled legacy comparisons. For example, [`Cinematic legacy`](../phase8/exports/cinematic/legacy-piano.mid) has seven notes active at **bar 15, tick 56,175**:

| MIDI pitch | Approx. name | Start tick | Duration | Velocity |
|---:|---|---:|---:|---:|
| 79 | G5 | 55,690 | 1,910 | 92 |
| 52 | E3 | 55,691 | 1,909 | 92 |
| 64 | E4 | 55,691 | 1,909 | 92 |
| 69 | A4 | 55,691 | 1,909 | 92 |
| 74 | D5 | 55,691 | 1,909 | 92 |
| 45 | A2 | 55,697 | 1,903 | 92 |
| 86 | D6 | 56,175 | 465 | 84 |

Six attacks are within seven ticks of one another (about 4.4 ms at this tempo); the seventh enters at the measured peak. The active set spans 41 semitones, and the five upper pitches alone span 22 semitones. The MIDI has no hand/finger assignment, so exact fingering cannot be recovered, but this is a serious playability risk rather than an auditable two-hand chord.

A second example is [`Hybrid Studio legacy`](../phase8/exports/hybrid-studio/legacy-piano.mid): seven notes are active at **bar 15, tick 55,697**, MIDI pitches **45, 52, 64, 69, 74, 76, 79** (A2, E3, E4, A4, D5, E5, G5), spanning **34 semitones**. Six begin at ticks 55,690–55,691; A2 joins at 55,697. The six longer notes last 1,903–1,910 ticks at velocity 92, while E5 lasts 469 ticks at velocity 84.

[`Sonata legacy`](../phase8/exports/sonata/legacy-piano.mid) also has seven active notes at **bar 13, tick 48,008**: MIDI **50, 65, 69, 74, 77, 81, 84**. Six begin within eight ticks around tick 46,090–46,098, last about 3,822–3,830 ticks, and have velocities 74–87; MIDI 69 enters at tick 48,008 for 1,912 ticks at velocity 74. Again the active span is broad (D3–C6), with no exported hand allocation.

## Answers to the audit questions

### 1. Why are the outputs predominantly single-line or ostinato-like?

There are two interacting causes. First, the realized score is extremely small: 23–45 notes per 16 bars. Second, the event-level orchestration gate often tells the Realizer to yield. Across the 90 harmonic events in the five saved plans, **73 are `very-sparse` with right-hand motion `yield`**; those are all 18 events in Chamber, Cinematic, Hybrid Studio, and Vocal Backing, plus one Sonata event. The other 17 are Sonata's `sparse`/`inner-voice` events. In the actual MIDI, that commonly becomes one bass anchor plus one RH pitch, often held almost to the next chord.

The Composer's orchestration reader treats any active tracks over the chord/bar window as a reason to `leave-space`; `momentDecision` also returns `leave-space` once four tracks are active. `composeHarmonicEvents` turns this into `momentYield` and `very-sparse` density. Because the Analyzer counts written-note overlaps at bar/chord scale, not actual foreground at each piano onset, the policy is conservative to the point of erasing most piano roles. The exact note examples above show the result more clearly than a plan label does.

### 2. Does the Composer plan complete piano textures?

It plans a **symbolic arrangement skeleton**, not a complete piano score. `PianoComposerPlan` has section and phrase intentions, one motif, harmonic events, fill decisions, suspensions, and structural events. Each chord event has a bass pitch class, an RH pitch-class array, hand-role strings, and an inversion label. But the plan explicitly has `containsMidiNotes: false`; the Composer does not assign absolute note pitches, note durations, velocities, articulations, or instrument choices ([`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L242-L274), [`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L1613-L1647)).

In practice, the Realizer derives one LH bass note per chord event, a density-limited RH chord subset, one melodic motif line, optional fills, and suspension notes. That is more than a bag of unrelated notes, but it is not a fully composed two-hand texture with independent voice schedules.

### 3. Are chord voicings genuinely composed and realized?

Partly. The Composer does parse supplied chord tones, choose a bass pitch class, select RH chord tones, score common tones and movement, and label root/third/fifth/seventh/slash-bass inversions ([`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L584-L610), [`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L639-L735)). The 90 saved events contain two RH pitch classes in 82 events and three in eight. The Realizer then maps these classes into MIDI registers and scores exact-pitch spacing and movement ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L283-L329)).

The bottleneck is the next step: `voicingPitchClasses` applies a density limit of one RH note for `very-sparse` events and two for `sparse` events ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L192-L228)). Thus most saved voicings are not realized as the three- or four-note chords their plan could imply. `minimumVoiceMotion` in the Composer is pitch-class distance, before octave placement; the Realizer's MIDI mapping is a set optimization, not persistent voice-leading for named soprano/alto/tenor/bass lines ([`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L667-L683), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L231-L280)). The resulting Sonata opening and Vocal Backing shells show that inversions exist, but complete triads/sevenths across templates are inconsistent.

### 4. Is there a meaningful left-hand/right-hand model?

There is a **coarse semantic split**, not a robust hand-composition model. The plan labels LH role/register and RH role/register; a realized draft temporarily tags notes as `left`, `right`, `melody`, or `fill` ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L44-L62)). The LH is usually a single bass pitch, and the RH is a small chord subset or a one-note motif ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L363-L416), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L570-L625), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L830-L905)). The hand identity is then discarded when candidates are normalized into ordinary `Note` values ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L1297-L1329)). There are no persistent hand-specific voice IDs, independent hand rhythms, fingerings, or a plan for how one hand passes material to the other.

The motif routine is a separate upper-register melody generator, not a dialogue system that makes LH and RH answer, interlock, or share a melodic line ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L855-L905), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L1060-L1090)). The result can contain notes in two registers without demonstrating two-hand counterpoint.

### 5. Why is the register use narrow or repetitive?

Each template chooses fixed register zones, reused for every phrase: e.g. Chamber uses LH `bass` and RH `middle`; Vocal Backing uses `low-middle` and `middle`; Cinematic uses `bass` and `high` ([`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L336-L407), [`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L1047-L1053)). The Realizer maps those zones to fixed MIDI windows and favors a preferred center ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L78-L84), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L148-L190), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L283-L319)). There is no phrase-by-phrase register arc or register-exchange plan.

The MIDI ranges above qualify the claim: Cinematic is wide in min/max, but its high and low notes are isolated; Vocal Backing is only 24 semitones across the whole piece, Chamber 30, and Sonata/Hybrid 36. In the Vocal Backing chorus, repeated two-note pairs remain in the same general low/middle bands. Thus the core issue is not that every sample has a literally tiny min/max range; it is that register choices are zone-bound and sparse, with little continuous movement or register development.

### 6. How are simultaneous notes and playability handled?

For the designated Phase 8 v2 MIDI, the highest observed overlap is four (Sonata), not seven. But this is **not evidence that the engine has solved playability**. The new Realizer tries hand gaps of 8, 5, 2, then 0 semitones; it rejects same-pitch duplication and later removes overlapping octave doublings. Its final normalization validates pitch/time/velocity and resolves same-pitch overlaps. It does not impose a maximum simultaneous-note count, per-hand finger count, maximum hand span, leap constraint, or a playable fingering assignment ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L78-L100), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L283-L331), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L1260-L1330)). The sparse Phase 8 sample masks that limitation.

The legacy renderer has a total concurrency cap of **eight**, with separate low/high count limits, and therefore admits seven simultaneous piano notes. It has some hand separation and chord-spacing rules, but a global cap of eight is not a hand/fingering model ([`profile.ts`](../../src/orchestrator/keys/profile.ts#L49-L61), [`render.ts`](../../src/orchestrator/keys/render.ts#L113-L186), [`render.ts`](../../src/orchestrator/keys/render.ts#L750-L766)). The concrete seven-note examples above are from that legacy comparison path.

### 7. Why is there little variation or development?

Each plan contains only one four-tone `piano-motif-main`, chosen from the first two supplied chords; later phrases select operations such as inversion, sequence, augmentation, or fragment, but these are transformations of the same small cell ([`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L1063-L1127), [`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L1618-L1629)). The non-Hybrid phrase plans reuse the same four motif duration weights for every phrase, while Hybrid selects among four fixed weight cells and, in this seed, realizes only one specifically displaced motif note ([`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L953-L1005); see the Hybrid timing record in [`summary.json`](../phase8/analysis/summary.json)). Phrase counts in the saved sample range from two to four across the whole 16 bars.

The note records are also mostly legato: **124 of 152** realized notes are tagged `legato`, **26** have no articulation tag, and only **two** are staccato flourishes. Plain MIDI export writes note-on/note-off and velocity events; it does not encode the note's `articulation` field ([`midi.ts`](../../src/export/midi.ts#L49-L60), [`types.ts`](../../src/shared/schema/types.ts#L30-L41)). The sustained bass/upper pairs reinforce the same texture with repeated velocities: Vocal Backing bars 10–12 repeat 58/68; Cinematic bars 9–12 repeat 58/68 (with a separate 70-velocity pickup in bar 9). Phase 8 added only four notes across the five samples (148 to 152), so its suspension and gate changes did not materially increase textural development ([Phase 8 summary](../phase8/analysis/summary.json)).

### 8. Which orchestral piano techniques are supported, missing, or incorrectly realized?

**Supported in the standalone Phase 8 engine:** chord-tone shells and inversions, common-tone/stepwise voicing preferences, phrase-level energy labels, a four-note motif with a handful of transformations, explicit prepared suspensions and stepwise resolutions, occasional fill gestures, a near-silence attack gate, and one Hybrid-style chord-tone anticipation. The Cinematic B5-to-C6 suspension and Hybrid bar-9 pickup are concrete examples.

**Missing or only described in words:** independent LH ostinati, full block-chord or stride writing, sustained inner-voice counterpoint, multi-voice arpeggiation/Alberti patterns, repeated chords, octave reinforcement, hand-crossing/passages, continuous register arcs, and detailed orchestral doubling/interlocking. `leftHandRole`, `rightHandRole`, and texture identities are mostly intention strings; they are not enough to specify these techniques.

**Incorrectly realized:** template descriptions often lose to the global yield decision. In the saved plans, all event-level RHS motion yields in four templates, including Cinematic's nominal “expanse” and Hybrid's “pulse-and-color”; Sonata is the one comparatively fuller case. The separate `PianoEngine` context only knows annotated Strings layers, and it marks total orchestral capacity unavailable. The Analyzer itself says that response and general phrase opportunities are unavailable and that activity/overlap does not judge musical suitability ([`piano-engine.ts`](../../src/orchestrator/keys/piano-engine.ts#L91-L126), [`piano-analyzer.ts`](../../src/orchestrator/keys/piano-analyzer.ts#L795-L821)).

There is also an **over-broad near-silence propagation** in the saved plans. The input marks **only bar 8** near-silent. For Cinematic, Hybrid, and Vocal Backing, however, the first phrase spans `[0, 30,720)` (bars 1–8), and `sourceEnergyForPhrase` sets phrase-level `nearSilence` if **any** bar in that phrase is near-silent. The per-event `dynamicIntent.sourceEnergyNearSilence` remains local to bar 8, but all nine events inherit the phrase-level flag for hand density/motion; their saved RH intents are consequently `very-sparse`/`yield` throughout bars 1–8. The exact attack restriction still applies only to bar 8, while phrase density and motif realization are suppressed across the larger phrase. The relevant code is [`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L492-L563), [`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L834-L847), and [`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L1307-L1317); `selectedMotifPositions` also returns no motif notes when its phrase-level `nearSilence` flag is set ([`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L830-L853)).

### 9. Which Analyzer, Composer, and Realizer parts are worth retaining?

**Retain:** the immutable input snapshot and provenance; exact supplied harmony/section/bar/energy data; deterministic seed-label randomness; chord-tone and inversion utilities; common-tone and stepwise movement preferences; suspension planning plus the explicit realization audit; the precise bar-local attack restriction; template roster/lock/range checks; and the MIDI parsing/verification artifacts. These are useful infrastructure and safety properties.

**Redesign fundamentally:** the Composer's single global motif and chord-event skeleton as the main score model; the phrase-wide “any near-silence” interpretation; `leave-space` based on active-track count; the static hand-role/register descriptors; and the Realizer's density-limited chord subset plus one upper melody line. Also redesign orchestral analysis before using it to suppress piano: the current snapshot omits mute/solo state and does not supply non-string lead/answer relationships or cross-family capacity. Retain those facts as evidence, but do not turn them directly into whole-event yields.

## Root-cause map

| Audible symptom | Immediate mechanism visible in this audit | Architectural limitation |
|---|---|---|
| Single line / ostinato-like bars | 73/90 harmonic events are `very-sparse`/`yield`; long two-note attacks repeat at chord/bar boundaries | No note-level two-hand texture schedule or independent rhythmic voice lines |
| Chords absent or incomplete | 1 RH pitch selected for most events; many outputs are bass plus one RH tone | Symbolic pitch-class voicing is not a fully realized chord/voice-leading score |
| Fixed/narrow register behavior | Same per-template LH/RH zones reused across phrases | No phrase-level register trajectory, voice crossing, or hand-specific register development |
| Seven-note overload | Present in legacy comparison, not in Phase 8 v2 MIDI; legacy cap permits eight | Count cap is not a pianistic model; new Realizer also has no global playability constraint |
| Little development | One four-tone motif, repeated phrase weights, few phrase windows; mostly legato note data | No multi-motif/formal development grammar or articulation-level piano score |
| Piano disappears under orchestra | Any four active tracks or a string lead can trigger `leave-space`; phrase bar-8 flag spreads to whole phrase | Analyzer sees written activity, not audibility/foreground; only Strings lead annotations and partial capacity are available |

## Recommended redesign and sequence

1. **Correct the orchestral context first.** Keep activity per exact tick/beat and per track; distinguish audible/eligible parts from muted/soloed parts; supply cross-family lead, register occupancy, and explicit phrase/response data. Make a local low-energy bar affect that bar, not every chord in a phrase containing it.
2. **Replace the symbolic shell plan with an explicit score plan.** For every phrase choose a texture recipe by template and function: for example, a walking or sustained bass with a three/four-note RH voicing; alternating LH bass/chord; an Alberti/broken-chord pattern; a repeated-chord pulse; a high-register response; or an intentionally sparse color. Each planned voice needs exact onset/duration, actual MIDI pitch, voice ID/hand, articulation, and phrase role—not only a pitch class and descriptive string.
3. **Voice-lead actual notes, not pitch classes alone.** Select chord inversions and omissions in real registers, track named voices across changes, and score spacing, crossings, leaps, common tones, and chord coverage. Preserve intentional color tones and suspensions as explicit events.
4. **Add an independent playability pass.** Assign notes to hands, enforce per-hand note count and reachable span/leaps, test overlap during sustained notes, and reject or revoice physically implausible clusters. A total cap such as eight must not be treated as a playability proof.
5. **Model development and orchestral technique directly.** Use multiple motifs and phrase-specific variation in contour, rhythm, register, density, articulation, and role. Let the piano interlock or answer particular orchestral lines when the score supports it; do not infer a mandatory rest merely from four active tracks.
6. **Integrate only after the score model earns it.** `composeAllTracks` currently calls legacy `renderKeys` at [`compose.ts`](../../src/orchestrator/compose.ts#L295-L320); its Phase 4A PianoEngine input is an ephemeral handoff at [`compose.ts`](../../src/orchestrator/compose.ts#L685-L713). The Piano Composer and Realizer comments explicitly say they are standalone/not wired into the production path ([`piano-composer.ts`](../../src/orchestrator/keys/piano-composer.ts#L1-L7), [`piano-realizer.ts`](../../src/orchestrator/keys/piano-realizer.ts#L1-L7)). Decide which engine owns piano, then audit the exact resulting production MIDI rather than conflating legacy and Phase 8 comparison exports.

## Final recommendation

**Rebuild the musical-writing model rather than substantially extending the current Composer/Realizer.** Keep the Analyzer as a read-only context service and preserve the chord/suspension/gating utilities, but replace the single-motif, pitch-class-shell plan and density-thinned realization with an explicit, voice-led, two-hand score model plus a real playability validator. The seven-note examples should be tracked to the legacy path; the Phase 8 v2 samples fail chiefly through under-composition and over-yield, not seven-note clusters.