# Piano Engine Stage 1: note-level writing contract

Stage 1 adds a Composer-owned, internal score between the existing Piano
Composer and Realizer. It keeps the Analyzer → Composer → Realizer architecture
and the current `composeAllTracks` handoff. The score is ephemeral; it is not a
new project file format, track, MIDI part, or channel.

## Event contract

`PianoScoreEvent` records the actual MIDI pitch, absolute onset and duration,
left/right hand, stable voice ID, musical role, phrase and section, gesture and
technique intent, articulation, dynamic intensity and concrete velocity, and
one or more chord/harmonic contexts. `PianoScore` also carries explicit
per-voice rests. The initial Composer writes a compact four-voice texture
(bass and support in the left hand; inner voice and upper line in the right),
with sustained common tones where the chosen pitch continues through adjacent
harmony, and a score-level final landing. A specifically planned suspension
is an explicit held preparation plus a stepwise-resolution event.

The Composer receives the existing plan, eligible Piano target range, and
project end tick. It decides each note's MIDI pitch, timing, duration, hand,
voice, role, and expressive intent. It honors the existing template/range and
near-silence/explicit-leave-space gates. Stage 1 does not infer missing
harmony, timing, key, or project length. The Realizer converts score events to
the shared `Note` shape, applies the pre-existing hard octave policy, retains
an internal source-event/hand/voice association for audit, and invokes the
existing CC64 generator. Hand/voice annotations never leak into the persisted
project notes or MIDI. The Piano remains one project track and the UVI Grand
Model D remains on channel 16; `renderKeys`, Harp, the CC64 merge/provenance,
and the MIDI export path are unchanged.

## Stage 2: motif-to-score realization

`composePianoScore` now realizes the existing Composer plan rather than
selecting one motif pitch by harmonic-event index. Planned motif-cell positions
are placed from the phrase's four rhythmic weights, quantized to its grid, and
fit into the chord active at each onset. The note pitches follow the planned
semitone contour; sequencing, inversion/reframing, fragmentation, augmentation,
and cadence cells adapt that contour selectively rather than forcing every
operation into every phrase. The Composer keeps the right-hand line close to
its inner voice, sustains consonant common tones across supplied harmony, and
uses a planned chromatic neighbor only when a following chord-tone attack can
resolve it by step.

Phrase intent shapes the final cell: releases favor a settled downward close,
and an available final landing favors the final supplied chord. A planned
suspension takes precedence over a competing motif attack in its written span.
Bass, support, inner voice, suspension, and melody remain Composer-owned events
in the same Stage 1 score; the Realizer still only converts and applies its
existing policies. These are targeted note-writing improvements, not an
implementation of the complete 23-technique roadmap below.

## Report-only playability diagnostics

`validatePianoScorePlayability` is pure and non-mutating. Its report separates
warnings from hard violations and retains event IDs. The default advisory
thresholds are a hand span over 12 semitones (warning) and over 19 (hard), a
same-voice leap over an octave (warning) and over two octaves (hard), more than
four simultaneous pitches in one hand (warning) and more than five (hard), and
more than 12 attacks per hand per 4/4 bar (warning; over 24 is hard). It also
reports out-of-range/invalid events, simultaneous demands in both hands,
hand crossings, register-band discontinuities, a large move while a same-hand
note is sustained, and suspicious density.

These are review thresholds, not universal physiological laws. A wide span,
register crossing, dense figure, rolled chord, or voice transfer may be
intentional in a specific phrase/template. Callers can supply a tick window,
finding code, and explicit reason for such a contextual exception. The
validator keeps the finding visible and may soften its severity; it never
rewrites, revoices, shortens, or deletes notes. The existing template octave
policy remains a separate established realization safety rule, not a
playability-validator action.

## Demonstration and validation boundary

`tests/piano-score-stage1.test.ts` exercises Chamber score events from the
existing Dorian fixture: weighted motif-cell onsets, planned contour and
stepwise tension resolution, varied deterministic seeds, coordinated
bass/support and inner/upper voices, score identity, and phrase/final landings.
These are score-model and invariant checks, not a claim of musical success.
No UVI Grand Model D render or listening audition was performed for Stage 1 or
Stage 2; listening validation remains outstanding.

## Next stage: techniques enabled by the shared score

The note-level event/voice contract and report-only diagnostics are the common
substrate for the broader technique roadmap below. Stage 2 implements only a
bounded subset of motif identity, contour, phrase direction, and coordinated
voice writing; the inventory is not an implementation checklist or a claim
that every listed technique is present:

1. Arpeggiation/broken chords
2. Inner-voice movement
3. Octave doubling
4. Role-aware velocity/dynamics
5. Phrase swells, retreats, and shaping
6. Appoggiaturas and sigh gestures
7. Passing, neighbor, escape, and grace approaches
8. Anticipations/ghost notes
9. Suspensions/resolutions
10. Cascading chord gestures
11. Register spacing/space
12. Staccato/legato
13. Alberti bass
14. Walking bass
15. Tremolo/repeated notes
16. Rhythmic ostinatos
17. Context-sensitive accents/syncopation
18. Recognizable motifs
19. Motif transformation/development
20. Melodic contour/phrase direction
21. Counterpoint/dialogue
22. Coordinated independent hands
23. Beginning/development/climax/release

Further stages can add the remaining techniques as score-writing policies
over the same event and voice model, with the Analyzer still providing
read-only evidence, the Composer owning musical decisions, and the Realizer
continuing as a performer and converter rather than becoming a separate
technique engine.
