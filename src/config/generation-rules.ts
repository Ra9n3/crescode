/**
 * ============================================================================
 *  SCORCH GENERATION RULES — PLACEHOLDER EXAMPLES. REPLACE WITH YOUR OWN.
 * ============================================================================
 * These are deliberately simple rules so "Compose All" works straight away.
 * They are NOT the app's composition logic; the engine (src/engine/generate.ts)
 * is a generic interpreter and makes no musical decisions of its own.
 *
 * Schema: src/engine/rules-schema.ts  ·  Walkthrough: README.md → "Writing your own rules"
 *
 * Quick reference
 *  sections["Verse"].parts[] — each part targets tracks by role/family/name:
 *    match:     { roles: ['violins1'] } | { families: ['Brass'] } | { trackNames: ['Harp'] }
 *    role:      'bass' | 'pad' | 'harmony' | 'melody' | 'counterMelody' | 'accent' | 'percussion' | any string
 *    pitch:     { source: 'chord'|'chordUpper'|'root'|'bass'|'scale'|'fixed', voices, spread,
 *                 register: [0..1, 0..1], motion: 'block'|'arpeggioUp'|'arpeggioDown'|'arpeggioUpDown'|'stepwise'|'random',
 *                 degrees, maxLeap, chordToneOnStrongBeats, note, avoidLockedUnisons }
 *    rhythm:    a pattern name from `patterns`, or inline { type: 'sustain', per } / { type: 'pattern', unit, steps, cycle, anchor }
 *    velocity:  [min, max]   velocityCurve: 'flat'|'crescendo'|'diminuendo'
 *    density:   0..1 probability multiplier per step
 *    articulation: { legato: 0.05..1, minTicks }
 *    doubling:  [12] adds an octave copy (if in range)
 *    doubleOf:  { role: 'violins1', interval: -12 } copies another track's notes
 *    fill:      { when: 'lastBarOfSection'|'firstBarOfSection'|'everyNBars', n, rhythm, velocityOffset }
 *    occurrences: [2, 3] only plays on the 2nd/3rd time this section appears
 *    custom(pc) / transform(notes, pc): code hooks with full context (chords, scale, meter, locked notes)
 *  sections[...].variation — octaveShiftOnRepeat, densityScaleOnRepeat, velocityOffsetOnRepeat, reseedPerOccurrence
 *  "*" is the fallback for any section name without its own entry (custom sections).
 */
import type { GenerationRules, SectionRules } from '../engine/rules-schema';

const STRINGS_PAD: SectionRules['parts'] = [
  { label: 'Vln I sustained top', match: { roles: ['violins1'] }, role: 'pad', pitch: { source: 'chordUpper', register: [0.25, 0.5] }, rhythm: 'sustainChord', velocity: [60, 78] },
  { label: 'Vln II sustained', match: { roles: ['violins2'] }, role: 'pad', pitch: { source: 'chordUpper', register: [0.15, 0.4] }, rhythm: 'sustainChord', velocity: [58, 74] },
  { label: 'Violas sustained', match: { roles: ['violas'] }, role: 'harmony', pitch: { source: 'chordUpper', register: [0.25, 0.5] }, rhythm: 'sustainChord', velocity: [56, 72] },
  { label: 'Celli bass', match: { roles: ['cellosBasses'] }, role: 'bass', pitch: { source: 'bass', register: [0.05, 0.35] }, rhythm: 'sustainChord', velocity: [62, 80] },
  { label: 'Added tracks pad', match: { roles: ['strings', 'brass', 'woodwinds', 'keys'] }, role: 'pad', pitch: { source: 'chordUpper', register: [0.35, 0.6] }, rhythm: 'sustainChord', velocity: [56, 72] },
];

export const defaultRules: GenerationRules = {
  version: 1,
  description: 'Placeholder example rules — sustained chord tones in range. Replace with your own.',
  patterns: {
    sustainChord: { type: 'sustain', per: 'chord' },
    sustainBar: { type: 'sustain', per: 'chordOrBar' },
    downbeat: { type: 'pattern', unit: 'beat', steps: [{ at: 0, len: 1 }] },
    beats: { type: 'pattern', unit: 'beat', steps: [{ at: 0, len: 1, accent: 8 }, { at: 1, len: 1 }, { at: 2, len: 1 }, { at: 3, len: 1 }, { at: 4, len: 1 }, { at: 5, len: 1 }] },
    eighths: { type: 'pattern', unit: 'eighth', cycle: 2, steps: [{ at: 0, len: 1, accent: 6 }, { at: 1, len: 1 }] },
    backbeat: { type: 'pattern', unit: 'beat', cycle: 2, steps: [{ at: 1, len: 0.5, accent: 4 }] },
    rollFill: { type: 'pattern', unit: 'sixteenth', cycle: 1, steps: [{ at: 0, len: 1 }] },
  },
  sections: {
    Intro: {
      velocityScale: 0.85,
      parts: [
        ...STRINGS_PAD.filter((p) => p.match.roles?.[0] !== 'violins1'),
        { label: 'Harp arpeggio', match: { roles: ['harp'] }, role: 'accent', pitch: { source: 'chord', register: [0.35, 0.65], motion: 'arpeggioUp' }, rhythm: 'eighths', velocity: [50, 66], articulation: { legato: 0.9 } },
      ],
    },
    Verse: {
      parts: [
        ...STRINGS_PAD,
        { label: 'Horns pad', match: { roles: ['horns'] }, role: 'pad', pitch: { source: 'chordUpper', voices: 2, register: [0.3, 0.6] }, rhythm: 'sustainChord', velocity: [48, 62] },
        { label: 'Clarinet line', match: { roles: ['clarinets'] }, role: 'counterMelody', pitch: { source: 'scale', register: [0.35, 0.6], motion: 'stepwise', maxLeap: 4, chordToneOnStrongBeats: true }, rhythm: { type: 'pattern', unit: 'beat', steps: [{ at: 0, len: 2 }, { at: 2, len: 1 }, { at: 3, len: 1, prob: 0.6 }] }, velocity: [56, 72] },
        { label: 'Piano chords', match: { roles: ['piano'] }, role: 'harmony', pitch: { source: 'chord', voices: 3, register: [0.4, 0.6] }, rhythm: 'sustainBar', velocity: [52, 68], articulation: { legato: 0.9 } },
        { label: 'Timpani downbeat', match: { roles: ['timpani'] }, role: 'percussion', pitch: { source: 'root' }, rhythm: 'downbeat', velocity: [60, 76], density: 0.5, articulation: { legato: 0.5 } },
      ],
      variation: { velocityOffsetOnRepeat: 6 },
    },
    'Pre-Chorus': {
      parts: [
        ...STRINGS_PAD,
        { label: 'Violas pulse', match: { roles: ['violas'] }, role: 'harmony', pitch: { source: 'chordUpper', register: [0.3, 0.55] }, rhythm: 'eighths', velocity: [58, 80], velocityCurve: 'crescendo', articulation: { legato: 0.6 } },
        { label: 'Snare roll fill', match: { roles: ['snare'] }, role: 'percussion', pitch: { source: 'fixed' }, rhythm: 'backbeat', velocity: [60, 80], fill: { when: 'lastBarOfSection', rhythm: 'rollFill', velocityOffset: 10 } },
      ],
    },
    Chorus: {
      velocityScale: 1.1,
      parts: [
        ...STRINGS_PAD,
        { label: 'Vln I melody', match: { roles: ['violins1'] }, role: 'melody', pitch: { source: 'scale', register: [0.45, 0.7], motion: 'stepwise', maxLeap: 5, chordToneOnStrongBeats: true }, rhythm: { type: 'pattern', unit: 'beat', steps: [{ at: 0, len: 1.5, accent: 8 }, { at: 1.5, len: 0.5 }, { at: 2, len: 1 }, { at: 3, len: 1 }] }, velocity: [78, 98] },
        { label: 'Flutes double Vln I', match: { roles: ['flutes'] }, role: 'melody', pitch: { source: 'scale' }, rhythm: 'sustainChord', doubleOf: { role: 'violins1', interval: 12 } },
        { label: 'Horns pad', match: { roles: ['horns'] }, role: 'pad', pitch: { source: 'chordUpper', voices: 3, register: [0.35, 0.7] }, rhythm: 'sustainChord', velocity: [70, 88] },
        { label: 'Trumpets accents', match: { roles: ['trumpets'] }, role: 'accent', pitch: { source: 'chordUpper', voices: 2, register: [0.3, 0.6] }, rhythm: 'downbeat', velocity: [80, 100], articulation: { legato: 0.5 } },
        { label: 'Trombones', match: { roles: ['trombones'] }, role: 'harmony', pitch: { source: 'chord', voices: 2, register: [0.25, 0.55] }, rhythm: 'sustainBar', velocity: [68, 86] },
        { label: 'Tuba bass', match: { roles: ['tuba'] }, role: 'bass', pitch: { source: 'bass', register: [0.15, 0.45] }, rhythm: 'sustainChord', velocity: [70, 86] },
        { label: 'Oboes', match: { roles: ['oboes'] }, role: 'counterMelody', pitch: { source: 'chordUpper', register: [0.3, 0.55], motion: 'arpeggioUpDown' }, rhythm: 'beats', velocity: [60, 76], density: 0.7 },
        { label: 'Bassoons bass', match: { roles: ['bassoons'] }, role: 'bass', pitch: { source: 'root', register: [0.1, 0.4] }, rhythm: 'sustainChord', velocity: [62, 78] },
        { label: 'Piano', match: { roles: ['piano'] }, role: 'harmony', pitch: { source: 'chord', voices: 4, spread: 'open', register: [0.35, 0.65] }, rhythm: 'beats', velocity: [64, 84], articulation: { legato: 0.8 } },
        { label: 'Harp arp', match: { roles: ['harp'] }, role: 'accent', pitch: { source: 'chord', register: [0.4, 0.7], motion: 'arpeggioUp' }, rhythm: 'eighths', velocity: [56, 74] },
        { label: 'Timpani', match: { roles: ['timpani'] }, role: 'percussion', pitch: { source: 'root' }, rhythm: 'beats', velocity: [70, 90], density: 0.6, articulation: { legato: 0.5 } },
        { label: 'Snare', match: { roles: ['snare'] }, role: 'percussion', pitch: { source: 'fixed' }, rhythm: 'backbeat', velocity: [70, 90], fill: { when: 'lastBarOfSection', rhythm: 'rollFill', velocityOffset: 8 } },
        { label: 'Cymbal crash', match: { roles: ['cymbals'] }, role: 'accent', pitch: { source: 'fixed' }, rhythm: { type: 'pattern', unit: 'bar', steps: [{ at: 0, len: 1 }] }, velocity: [90, 110], occurrences: [1, 2, 3, 4], fill: undefined, density: 1 },
      ],
      variation: { octaveShiftOnRepeat: 0, velocityOffsetOnRepeat: 4 },
    },
    Bridge: {
      velocityScale: 0.9,
      parts: [
        ...STRINGS_PAD,
        { label: 'Oboe solo', match: { roles: ['oboes'] }, role: 'melody', pitch: { source: 'scale', register: [0.3, 0.6], motion: 'stepwise', chordToneOnStrongBeats: true }, rhythm: { type: 'pattern', unit: 'beat', steps: [{ at: 0, len: 2 }, { at: 2, len: 2 }] }, velocity: [60, 78] },
      ],
    },
    Outro: {
      velocityScale: 0.8,
      parts: [
        ...STRINGS_PAD.map((p) => ({ ...p, velocityCurve: 'diminuendo' as const })),
        { label: 'Harp final', match: { roles: ['harp'] }, role: 'accent', pitch: { source: 'chord', register: [0.3, 0.7], motion: 'arpeggioDown' }, rhythm: 'eighths', velocity: [40, 60], density: 0.8 },
      ],
    },
    '*': {
      parts: [
        ...STRINGS_PAD,
        { label: 'Keys sustain (any family Keys)', match: { families: ['Keys'] }, role: 'harmony', pitch: { source: 'chord', voices: 3 }, rhythm: 'sustainChord', velocity: [56, 70] },
      ],
    },
  },
  humanize: { maxVelocityDelta: 6, maxTimingMs: 12 },
};
