# Piano Stage 4: contextual score-writing audit

Stage 4 extends the production Composer → PianoScore → Realizer path. This is
an event-level audit of the 23-technique roadmap in
[`PIANO_SCORE_STAGE1.md`](PIANO_SCORE_STAGE1.md), not a checklist to make every
composition use every device. The inventory remains a vocabulary of options;
space, voice leading, phrase purpose, template character, and playability can
all justify writing no extra figure.

## Audit method

A technique counts as realized only when `composePianoScore` emits the
corresponding pitched events with meaningful timing, pitch, voice/hand,
articulation, or velocity properties. A plan label or `techniqueIntent` alone
is not proof. The audit compares the accepted inventory with the score writer
in `src/orchestrator/keys/piano-composer.ts`, the event contract in
`piano-score.ts`, the Stage 3 score-event regressions, and Stage 4 tests that
inspect actual generated events. The Stage 4 accompaniment probes use the
three-chorus fixture with controlled Chamber, Sonata, and Hybrid contexts;
ordinary production decisions are still free to select sustained notes or
leave space.

Status means **present** only for the described constrained scope; **partial**
means related event writing exists but not the full named vocabulary; **not
implemented** means no Composer-owned note-writing evidence is claimed.

| # | Accepted technique | Composer-written event evidence and audit status |
|---:|---|---|
| 1 | Arpeggiation / broken chords | **Present, conditional.** Separated chord-tone notes are written in `lh.support`/`rh.inner` when the phrase texture and score gates permit them; the figure pitch classes and onsets come from supplied harmony and phrase timing. |
| 2 | Inner-voice movement | **Present.** `rh.inner` events change MIDI pitch over supplied harmony; non-sustained figures can write further moving-inner-voice attacks. |
| 3 | Octave doubling | **Present, tightly gated.** A single short `rh.octave` event may reinforce the last upper-line attack of a prominent, high-energy arrival, only when the resolved template permits doubling (and the template threshold is met for `climaxOnly`), no explicit lead occupies the passage, the target range allows it, and the added pitch remains within the report-only hand-span/polyphony limits. Otherwise it is omitted. |
| 4 | Role-aware velocity / dynamics | **Present.** The score stores concrete, bounded velocities with separate bass, support, inner, melody, and reinforcement offsets; pattern notes receive softer role-aware adjustments. |
| 5 | Phrase swells, retreats, and shaping | **Partial.** Source energy is converted into phrase/dynamic curves and event velocities, with actual velocity descent/rise across attacks. A sustained event does not itself contain a continuous within-note dynamic envelope; no extra controller automation is invented here. |
| 6 | Appoggiaturas and sigh gestures | **Partial.** The motif can write a non-chord neighbor only when a later chord-tone attack supports a stepwise resolution. There is no general accented-appoggiatura or dedicated sigh-gesture policy. |
| 7 | Passing, neighbor, escape, and grace approaches | **Partial.** The neighbor and prepared-suspension paths write actual tension/resolution events. General passing/escape notes and grace-note vocabulary are not implemented. |
| 8 | Anticipations / ghost notes | **Partial.** A selected Hybrid motif position can be moved earlier on the phrase grid; the realized event is tagged `phrase-anticipation`, uses a lifted note role and detached articulation, and receives a softer velocity adjustment. There is no general ghost-note system. |
| 9 | Suspensions / resolutions | **Present.** `rh.suspension` writes the prepared non-chord pitch followed by a stepwise resolution on the supplied chord, subject to playability and template checks. |
| 10 | Cascading chord gestures | **Partial.** Arpeggiated single-note unfolding is written; a full multi-register, cross-hand cascading chord gesture is not claimed. |
| 11 | Register spacing / space | **Present.** Event pitches are fitted to target and hand register windows, with active voice spacing, explicit rests, lead/near-silence gates, and a valid no-note choice. |
| 12 | Staccato / legato | **Partial.** Legato remains the ordinary line articulation; detached staccato events are now written only for brief, explicitly reserved flourish attacks. No global articulation makeover is applied. |
| 13 | Alberti bass | **Present, conditional.** In a suitable Chamber/Sonata broken-chord phrase with moderate-or-broader density, sufficient energy, known open low-register space, no explicit lead, and no moment/leave-space conflict, `lh.support` can write a bounded high–low–middle–high cell over the chord. The pattern is deterministic and may be absent. |
| 14 | Walking bass | **Present, conditional.** In an eligible Sonata/Hybrid phrase, `lh.bass` can write at most four attacks per chord span. Moving notes favor nearby supplied chord tones and, when available, a stepwise approach to the next supplied chord root; existing bass activity or unknown/occupied low-register evidence blocks the option. |
| 15 | Tremolo / repeated notes | **Partial.** The repeated-note ostinato below is a measured, pulse-spaced repetition; no fast tremolo or tremolo articulation is written. |
| 16 | Rhythmic ostinatos | **Present, conditional.** A Hybrid pulse texture can repeat bass/support pitches on its existing pulse grid. This reuses the pulse attack budget rather than adding an independent layer; it is not selected under a lead, near-silence, a release, or unavailable/occupied low-register evidence. |
| 17 | Contextual accents / syncopation | **Partial.** The actual anticipated motif note is displaced before its unshifted grid position and softened/detached; offbeat pulse notes are identified by their actual onset. There is no general accent palette or generic rhythm-control change. |
| 18 | Recognizable motifs | **Present.** A stable motif identity and chord-relative anchor are used by actual `rh.melody` events when the Composer chooses to state them. |
| 19 | Motif transformation / development | **Present.** Sequence, augmentation, inversion/reframing, expansion, fragmentation, and cadence variants affect actual scheduled attacks and pitches, not only intent strings. |
| 20 | Melodic contour / phrase direction | **Present.** Motif contour and phrase-specific attack placement are realized as MIDI pitches and timing; motif notes yield when a marked lead or sparse phrase calls for it. |
| 21 | Counterpoint / dialogue | **Partial.** When selected, `dialogue` writes temporally separated answer events in distinct voice IDs against the upper subject and bass. It is intentionally compact, not a claim of free multi-voice imitation. |
| 22 | Coordinated independent hands | **Present.** Bass, support, inner voice, upper subject, suspension, and optional octave reinforcement retain distinct hand/voice IDs and independently timed events; onset collisions, unisons, range, and playability remain checked. |
| 23 | Beginning / development / climax / release | **Present, context-bound.** Supplied section/phrase functions, energy trajectory, arrivals, motif operations, texture transitions, and release/near-silence gates shape actual events and velocities. The Composer does not infer missing formal or harmonic facts. |

## Stage 4 decisions

- Preserve Stage 3’s sustained/broken/arpeggiated/dialogue/pulse/flourish
  choices. The new Alberti, walking-bass, and repeated-note ostinato vocabulary
  is an optional per-phrase, seed-stable variation, never a requirement to
  increase density. Each new pattern has a bounded four-note cell and requires
  moderate-or-broader density plus observed, unoccupied low-register space.
- Carry Analyzer-derived active roles and register-occupancy observations into
  each Composer harmonic event as evidence. Unknown occupancy is not treated
  as silence; pattern selection remains in the Composer. No decision moved to
  the Analyzer or Realizer.
- Mark anticipation and reserved-fill articulation on the actual note events.
  The Realizer continues to convert score events without changing their
  musical decisions. Shared Keys rendering, generic `renderKeys`, Density and
  Humanize controls, Harp ownership, and non-Piano behavior are not changed.
- Octave reinforcement honors the shipped template policy and is suppressed
  if the added note would duplicate an active pitch, exceed the target range,
  or create an avoidable same-hand span/polyphony problem. The existing
  report-only playability validator still reports rather than repairs events.

## Verification boundary

`tests/piano-stage4-contextual-techniques.test.ts` asserts real event timing,
pitch classes, repeated/stepwise pitch behavior, deterministic score writing,
occupied/unknown/lead context gates for each new accompaniment figure,
anticipation articulation, and a policy-permitted octave event that survives
Realizer conversion. Stage 3 motif, voice-leading, landing, coordination,
template, and playability regressions remain in the existing Piano suites.

Fresh Piano-only MIDI exports for Chamber seeds 11, 29, and 47 are in
[`evaluation/piano-stage4-exports-20261108/`](../evaluation/piano-stage4-exports-20261108/);
round-trip note counts and hashes are in its `manifest.json` and `report.md`.
The ordinary production runs did not emit the optional Stage 4 accompaniment,
anticipation, or octave events, which is a valid outcome for these context
gates; forced-context tests separately prove the eligible score-writing paths.
MIDI structure checks are not a listening audition. No WAV/audio renderer was
available in this environment, so no listening validation is claimed.
