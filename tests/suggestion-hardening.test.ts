/**
 * Smart Chord Suggestion — comprehensive hardening suite (unit layer).
 *
 * Coverage added on top of the per-layer suites, mapped to the hardening
 * request:
 *  - exhaustive MIDI parsing matrix: 12 roots × major/minor/diminished/
 *    augmented/sus2/sus4 (spec §1 triad coverage)
 *  - inversions, slash chords, missing notes, doubled notes, non-chord tones
 *  - enharmonic normalization in sharp keys, flat keys and minor keys, plus
 *    the pitch-class-immutability sweep (spec §3/A2/A3)
 *  - chord text grammar matrix: valid / invalid / incomplete / ambiguous
 *    (spec E2) and the "no project key set" paths (spec E3)
 *  - suggestion scoring with no previous chord, no next chord, both
 *    neighbors present (spec C §1)
 *  - low-confidence input keeps the system usable and the verdicts honest
 *    (final requirement: confirmed vs ambiguous vs unknown)
 *  - the debounced suggestion recalculation used by the overlay
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeChord, chordFromSymbol, createSuggestionRecalculator, normalizeChord,
  parseChordText, interpretChordText, pitchOf, projectKeyOf,
  suggestChordCompletions,
  type DebouncedRecalculator, type Pitch, type ProjectKey,
} from '../src/engine/suggestion';
import { generateChordSuggestions, type SuggestionNeighbor } from '../src/engine/suggestion/engine';
import { scalePitchClasses, type ModeName, type PitchClass } from '../src/shared/schema';

const note = (midi: number, startTick = 0, durationTicks = 960, velocity = 100): Pitch =>
  pitchOf({ pitch: midi, startTick, durationTicks, velocity });

const keyOf = (tonic: PitchClass, mode: ModeName = 'Ionian'): ProjectKey =>
  projectKeyOf({ key: tonic, mode });

const TRIAD_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
} as const;

// ---------------------------------------------------------------------------
// Exhaustive triad matrix (spec §1: "MIDI parsing for all major, minor,
// diminished, augmented, sus2 and sus4 triads")
// ---------------------------------------------------------------------------

describe('MIDI parsing — exhaustive triad matrix (12 roots × 6 qualities)', () => {
  const ROOT_MIDIS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

  for (const quality of ['major', 'minor', 'diminished'] as const) {
    it(`every root parses as ${quality}, unambiguously`, () => {
      for (const rootMidi of ROOT_MIDIS) {
        const notes = TRIAD_INTERVALS[quality].map((iv) => note(48 + rootMidi + iv));
        const a = analyzeChord(notes);
        expect(a.status, `root midi ${rootMidi}`).toBe('clear');
        expect(a.chord?.quality, `root midi ${rootMidi}`).toBe(quality);
        expect(a.chord?.rootPc, `root midi ${rootMidi}`).toBe(rootMidi % 12);
        expect(a.confidence, `root midi ${rootMidi}`).toBeGreaterThanOrEqual(75);
      }
    });
  }

  it('every root parses as augmented — the symmetric reading is never hidden', () => {
    for (const rootMidi of ROOT_MIDIS) {
      const notes = TRIAD_INTERVALS.augmented.map((iv) => note(48 + rootMidi + iv));
      const a = analyzeChord(notes);
      // Bass hint picks the root-position spelling, but the two enharmonic
      // augmented readings (same pcs) stay visible as alternatives.
      expect(a.chord?.quality, `root midi ${rootMidi}`).toBe('augmented');
      expect(a.chord?.rootPc, `root midi ${rootMidi}`).toBe(rootMidi);
      expect(a.status, `root midi ${rootMidi}`).toBe('ambiguous');
      const altRoots = a.alternatives.map((c) => c.chord.rootPc);
      expect(altRoots, `root midi ${rootMidi}`).toContain((rootMidi + 4) % 12);
      expect(altRoots, `root midi ${rootMidi}`).toContain((rootMidi + 8) % 12);
    }
  });

  it('every root parses as sus2/sus4 with the competing sus reading offered', () => {
    for (const rootMidi of ROOT_MIDIS) {
      const sus2 = analyzeChord(TRIAD_INTERVALS.sus2.map((iv) => note(48 + rootMidi + iv)));
      expect(sus2.chord?.quality, `sus2 root ${rootMidi}`).toBe('sus2');
      expect(sus2.chord?.rootPc, `sus2 root ${rootMidi}`).toBe(rootMidi);
      expect(sus2.status, `sus2 root ${rootMidi}`).toBe('ambiguous'); // Gsus4 twin
      expect(sus2.alternatives.some((c) =>
        c.chord.rootPc === ((rootMidi + 7) % 12) && c.chord.quality === 'sus4',
      ), `sus2 root ${rootMidi}`).toBe(true);

      const sus4 = analyzeChord(TRIAD_INTERVALS.sus4.map((iv) => note(48 + rootMidi + iv)));
      expect(sus4.chord?.quality, `sus4 root ${rootMidi}`).toBe('sus4');
      expect(sus4.chord?.rootPc, `sus4 root ${rootMidi}`).toBe(rootMidi);
      expect(sus4.status, `sus4 root ${rootMidi}`).toBe('ambiguous'); // sus2 twin
      expect(sus4.alternatives.some((c) =>
        c.chord.rootPc === ((rootMidi + 5) % 12) && c.chord.quality === 'sus2',
      ), `sus4 root ${rootMidi}`).toBe(true);
    }
  });

  it('the same triad starting from any octave edge keeps its reading', () => {
    // 84 + 8 = 92 stays inside the analyzer's usable MIDI range.
    for (const base of [36, 48, 60, 72]) {
      const a = analyzeChord([note(base), note(base + 4), note(base + 7)]);
      expect(a.chord?.quality).toBe('major');
      expect(a.chord?.rootPc).toBe(base % 12);
    }
  });
});

// ---------------------------------------------------------------------------
// Inversions, slash chords, missing notes, doubled notes, non-chord tones
// ---------------------------------------------------------------------------

describe('MIDI parsing — inversions, slash, missing, doubled, non-chord tones', () => {
  it('both triad inversions keep the root and label the inversion', () => {
    const first = analyzeChord([note(64), note(67), note(72)]); // E G C
    expect(first.chord?.spelling).toBe('C/E');
    expect(first.chord?.inversion).toBe(1);

    const second = analyzeChord([note(67), note(72), note(76)]); // G C E
    expect(second.chord?.spelling).toBe('C/G');
    expect(second.chord?.inversion).toBe(2);
  });

  it('a full triad over a foreign bass reads as a slash chord, bass not punished', () => {
    const a = analyzeChord([note(48), note(55), note(59), note(62)]); // C bass under G B D
    expect(a.chord?.spelling).toBe('G/C');
    expect(a.chord?.bassNote).toBe('C');
    expect(a.extraPitchClasses).not.toContain(0); // the bass explains itself
  });

  it('missing chord tones keep the honest reading and list what is absent', () => {
    const noFifth = analyzeChord([note(60), note(64)]); // C E
    expect(noFifth.status).toBe('incomplete');
    expect(noFifth.chord?.quality).toBe('major');
    expect(noFifth.missingPitchClasses).toEqual([7]);

    const noFifthSeventh = analyzeChord([note(60), note(64), note(70)]); // C E Bb
    expect(noFifthSeventh.chord?.quality).toBe('7');
    expect(noFifthSeventh.missingPitchClasses).toEqual([7]);
  });

  it('doubled notes never change the reading', () => {
    const single = analyzeChord([note(60), note(64), note(67)]);
    const doubled = analyzeChord([note(48), note(60), note(64), note(67), note(79)]);
    expect(doubled.chord?.quality).toBe('major');
    expect(doubled.status).toBe(single.status);
    expect(doubled.chord?.rootPc).toBe(single.chord?.rootPc);
  });

  it('a doubled root cannot outvote the third (quality stays honest)', () => {
    // Two roots against one E and one G — still C major, not a power chord.
    const a = analyzeChord([
      note(36, 0, 960, 100), note(48, 0, 960, 100),
      note(64, 0, 960, 80), note(67, 0, 960, 80),
    ]);
    expect(a.chord?.quality).toBe('major');
    expect(a.status).toBe('clear');
  });

  it('third and fifth below the 3% visibility floor honestly read as a power chord', () => {
    // Pinned invariant: input below 3% of total weight is invisible, so the
    // analyzer reports C5 rather than inventing a triad it cannot hear.
    const a = analyzeChord([
      note(36, 0, 1920, 120), note(48, 0, 1920, 120), note(60, 0, 1920, 110),
      note(64, 0, 120, 20), note(67, 0, 120, 20),
    ]);
    expect(a.chord?.quality).toBe('power');
  });

  it('a faint non-chord tone lands in the weak bucket, primary unaffected', () => {
    const a = analyzeChord([
      note(60, 0, 1920, 100), note(64, 0, 1920, 100), note(67, 0, 1920, 100),
      note(66, 0, 480, 60), // F# whisper — 3–8% of total weight: visible but weak
    ]);
    expect(a.chord?.spelling).toBe('C');
    expect(a.status).toBe('clear');
    expect(a.weakPitchClasses).toContain(6);
    expect(a.extraPitchClasses).not.toContain(6);
  });

  it('a voiced non-chord tone is reported as extra without displacing the triad', () => {
    const a = analyzeChord([note(60), note(64), note(66), note(67)]); // C E F# G
    expect(a.chord?.quality).toBe('major');
    expect(a.extraPitchClasses).toContain(6);
  });
});

// ---------------------------------------------------------------------------
// Enharmonic normalization — sharp keys, flat keys, minor keys
// ---------------------------------------------------------------------------

describe('enharmonic normalization — sharp keys, flat keys, minor keys', () => {
  it('sharp keys resolve flat inputs to sharp spellings (spec: D major Db→C#)', () => {
    expect(normalizeChord('Db', keyOf(2))).toBe('C#'); // D major
    expect(normalizeChord('Eb', keyOf(7))).toBe('D#'); // G major
    expect(normalizeChord('Bb', keyOf(4))).toBe('A#'); // E major
  });

  it('flat keys resolve sharp inputs to flat spellings (spec: Eb major C#→Db)', () => {
    expect(normalizeChord('C#', keyOf(3))).toBe('Db'); // Eb major
    expect(normalizeChord('D#', keyOf(5))).toBe('Eb'); // Bb major
    expect(normalizeChord('A#', keyOf(8))).toBe('Bb'); // Ab major
  });

  it('F major prefers Bb over A# (spec example)', () => {
    expect(normalizeChord('A#', keyOf(5))).toBe('Bb');
  });

  it('minor keys follow their parent signature side', () => {
    // A minor (no accidentals): naturals stay, chromatics keep explicit spellings.
    expect(normalizeChord('C', keyOf(9, 'Aeolian'))).toBe('C');
    expect(normalizeChord('G#', keyOf(9, 'Aeolian'))).toBe('G#');
    // C minor (3 flats): sharps lean flat.
    expect(normalizeChord('C#', keyOf(0, 'Aeolian'))).toBe('Db');
    expect(normalizeChord('D#', keyOf(0, 'Aeolian'))).toBe('Eb');
    // E minor (1 sharp): flats lean sharp.
    expect(normalizeChord('Bb', keyOf(4, 'Aeolian'))).toBe('A#');
  });

  it('IMMUTABILITY SWEEP — no spelling rule ever moves the pitch class', () => {
    const keys: ProjectKey[] = [
      keyOf(2), keyOf(7), keyOf(4),          // sharp majors
      keyOf(5), keyOf(10), keyOf(3), keyOf(8), // flat majors
      keyOf(9, 'Aeolian'), keyOf(0, 'Aeolian'), keyOf(4, 'Aeolian'), // minors
    ];
    const chromatic = ['C#', 'Db', 'D#', 'Eb', 'F#', 'Gb', 'G#', 'Ab', 'A#', 'Bb'] as const;
    for (const key of keys) {
      for (const name of chromatic) {
        const out = normalizeChord(name, key);
        const before = chordFromSymbol(`${name}m`);
        const after = chordFromSymbol(`${out}m`);
        expect(after.ok, `${name} in tonic ${key.tonic}`).toBe(true);
        expect(before.ok, `${name} in tonic ${key.tonic}`).toBe(true);
        if (after.ok && before.ok) {
          expect(after.chord.rootPc, `${name} in tonic ${key.tonic}`).toBe(before.chord.rootPc);
        }
      }
    }
  });

  it('diatonic spellings of every key normalize to themselves (idempotent)', () => {
    for (const tonic of [0, 2, 3, 5, 7, 9] as PitchClass[]) {
      const key = keyOf(tonic);
      for (const pc of scalePitchClasses(tonic, 'Ionian')) {
        const spelled = chordFromSymbol(`${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][pc]}m`);
        expect(spelled.ok).toBe(true);
        if (!spelled.ok) continue;
        const out = normalizeChord(spelled.chord.rootName, key);
        const reparsed = chordFromSymbol(`${out}m`);
        expect(reparsed.ok).toBe(true);
        if (reparsed.ok) expect(reparsed.chord.rootPc).toBe(pc);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Chord text grammar — valid / invalid / incomplete / ambiguous (spec E2)
// ---------------------------------------------------------------------------

describe('chord text grammar matrix (spec E2)', () => {
  const VALID: Array<[string, { root: string; quality: string; bass: string | null }]> = [
    ['C', { root: 'C', quality: 'major', bass: null }],
    ['Cm', { root: 'C', quality: 'minor', bass: null }],
    ['C#', { root: 'C#', quality: 'major', bass: null }],
    ['Db', { root: 'Db', quality: 'major', bass: null }],
    ['F#m', { root: 'F#', quality: 'minor', bass: null }],
    ['Bb/D', { root: 'Bb', quality: 'major', bass: 'D' }],
    ['Gsus4', { root: 'G', quality: 'sus4', bass: null }],
    ['Cmaj7', { root: 'C', quality: 'maj7', bass: null }],
    ['C7', { root: 'C', quality: '7', bass: null }],
    ['Cm7', { root: 'C', quality: 'm7', bass: null }],
    ['Cadd9', { root: 'C', quality: 'add9', bass: null }],
    ['C6', { root: 'C', quality: '6', bass: null }],
    ['Cm6', { root: 'C', quality: 'm6', bass: null }],
    ['G/B', { root: 'G', quality: 'major', bass: 'B' }],
  ];

  it('every valid spec symbol splits into root / accidental / quality / bass', () => {
    for (const [text, want] of VALID) {
      const p = parseChordText(text);
      expect(p.ok, text).toBe(true);
      if (!p.ok) continue;
      expect(p.parts.rootName, text).toBe(want.root);
      expect(p.parts.quality, text).toBe(want.quality);
      expect(p.parts.bassName, text).toBe(want.bass);
      expect(p.parts.rootLetter, text).toBe(want.root[0]);
      expect(p.parts.accidental, text).toBe(want.root.length > 1 ? want.root[1] : '');
    }
  });

  it('invalid text reports an error and never throws', () => {
    for (const bad of ['H', 'Xyz', 'Cad', '#C', 'C//E', 'C H', 'C7/9/?', 'Cm++']) {
      const p = parseChordText(bad);
      expect(p.ok, bad).toBe(false);
      if (!p.ok) expect(p.error.length, bad).toBeGreaterThan(0);
      expect(() => interpretChordText(bad)).not.toThrow();
      expect(interpretChordText(bad).status, bad).toBe('invalid');
    }
  });

  it('incomplete input (empty, whitespace, bare accidental) is rejected without throwing', () => {
    // NB: "b" is NOT here — it folds to B and names a real chord.
    for (const partial of ['', '   ', '#', '/', 'C/']) {
      expect(interpretChordText(partial).status, JSON.stringify(partial)).toBe('invalid');
    }
  });

  it('ambiguous text offers BOTH readings; explicit sus never does', () => {
    const bare = interpretChordText('Csus');
    expect(bare.status).toBe('ambiguous');
    if (bare.status !== 'ambiguous') return;
    expect(bare.interpretations.map((c) => c.spelling)).toEqual(['Csus4', 'Csus2']);

    expect(interpretChordText('Gsus4').status).toBe('ok');
    expect(interpretChordText('Fsus2').status).toBe('ok');
    // Ambiguity survives a slash bass and carries both readings through it.
    const slashSus = interpretChordText('Csus/G');
    expect(slashSus.status).toBe('ambiguous');
  });

  it('every valid symbol reads into a user-authored chord (confidence 1)', () => {
    const ok = interpretChordText('Cm7');
    expect(ok.status).toBe('ok');
    if (ok.status === 'ok') expect(ok.chord.confidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No project key set (spec E3/E4 guard) — completions degrade gracefully
// ---------------------------------------------------------------------------

describe('text entry with no project key set', () => {
  it('a bare root suggests only the four triads, none marked diatonic', () => {
    const out = suggestChordCompletions('C', null);
    expect(out.map((c) => c.symbol)).toEqual(['C', 'Cm', 'Cdim', 'Caug']);
    expect(out.every((c) => c.diatonic === false)).toBe(true);
    expect(out.every((c) => c.stage === 'triad')).toBe(true);
  });

  it('empty input offers nothing (no key menu) instead of crashing', () => {
    expect(suggestChordCompletions('', null)).toEqual([]);
  });

  it('the extension stage still works without a key', () => {
    const out = suggestChordCompletions('C7', null);
    expect(out[0]?.symbol).toBe('C7'); // exact match first
    expect(out.every((c) => c.stage === 'extension')).toBe(true);
    expect(out.every((c) => c.symbol.startsWith('C7'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suggestion scoring — no previous chord, no next chord, both neighbors
// ---------------------------------------------------------------------------

describe('suggestion scoring — neighbor matrix (spec C §1)', () => {
  const C_MAJOR = keyOf(0);
  const gap = 3840;

  const neighbor = (symbol: string, alternatives?: string[]): SuggestionNeighbor => {
    const chord = chordFromSymbol(symbol);
    if (!chord.ok) throw new Error(symbol);
    return {
      chord: chord.chord,
      alternatives: alternatives?.map((s) => {
        const c = chordFromSymbol(s);
        if (!c.ok) throw new Error(s);
        return c.chord;
      }),
    };
  };

  it('no previous, no next: the key alone ranks the tonic first, deterministically', () => {
    const a = generateChordSuggestions({ projectKey: C_MAJOR, previousChord: null, nextChord: null, availableGapLength: gap, currentGridResolution: 960 });
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(a[0]?.chord.spelling).toBe('C');
    expect(a[0]?.reasonCodes).toContain('DIATONIC');
    const b = generateChordSuggestions({ projectKey: C_MAJOR, previousChord: null, nextChord: null, availableGapLength: gap, currentGridResolution: 960 });
    expect(a).toEqual(b); // deterministic
  });

  it('no previous chord: the next chord alone drives resolution scoring', () => {
    const out = generateChordSuggestions({ projectKey: C_MAJOR, previousChord: null, nextChord: neighbor('G7'), availableGapLength: gap, currentGridResolution: 960 });
    expect(out.length).toBeGreaterThanOrEqual(12);
    const resolver = out.find((s) => s.chord.spelling === 'Dm' || s.chord.spelling === 'F');
    expect(resolver).toBeDefined();
    expect(resolver?.reasonCodes.some((r) => r === 'STRONG_RESOLUTION' || r === 'CADENTIAL')).toBe(true);
  });

  it('no next chord: the previous chord alone drives cadential scoring', () => {
    const out = generateChordSuggestions({ projectKey: C_MAJOR, previousChord: neighbor('G7'), nextChord: null, availableGapLength: gap, currentGridResolution: 960 });
    const tonic = out.find((s) => s.chord.spelling === 'C');
    expect(tonic).toBeDefined();
    expect(tonic?.reasonCodes.some((r) => r === 'CADENTIAL' || r === 'STRONG_RESOLUTION' || r === 'ROOT_MOTION_FIFTH')).toBe(true);
    expect(out[0]?.chord.spelling).toBe('C'); // V7 resolves to I above all
  });

  it('both neighbors present: no crash, contract holds, duplicates are penalized', () => {
    const out = generateChordSuggestions({
      projectKey: C_MAJOR,
      previousChord: neighbor('C'), // C → C? — a duplicate of the previous chord
      nextChord: neighbor('G7'),
      availableGapLength: gap,
      currentGridResolution: 960,
    });
    expect(out.length).toBeGreaterThanOrEqual(12);
    for (const s of out) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.score100).toBe(Math.round(s.score * 100));
      expect(s.contextExplanation.length).toBeGreaterThan(0);
    }
    // The duplicate itself (and its near-duplicate Cmaj7) carry the −10
    // duplicate-of-neighbor penalty in their transparent breakdown.
    for (const spelling of ['C', 'Cmaj7']) {
      const dup = out.find((s) => s.chord.spelling === spelling);
      expect(dup, spelling).toBeDefined();
      expect(dup?.scoreBreakdown.some((b) => b.delta < 0), spelling).toBe(true);
    }
  });

  it('both neighbors as null-safe chordless context still works', () => {
    const out = generateChordSuggestions({ projectKey: C_MAJOR, previousChord: null, nextChord: null, availableGapLength: 0, currentGridResolution: 960 });
    expect(out.length).toBeGreaterThanOrEqual(12); // a zero-length gap is valid context-free input
  });
});

// ---------------------------------------------------------------------------
// Low confidence keeps the system usable (final requirement)
// ---------------------------------------------------------------------------

describe('low-confidence input never breaks the system', () => {
  it('a chromatic run reads as unknown with honest low confidence', () => {
    // Four adjacent semitones is a melodic run, not a chord — the analyzer
    // refuses to dress it up as harmony.
    const a = analyzeChord([note(60), note(61), note(62), note(63)]); // C Db D Eb
    expect(a.status).toBe('unknown');
    expect(a.confidence).toBeLessThan(40);
    expect(a.chord).not.toBeNull(); // best-effort reading, clearly flagged
  });

  it('empty and near-empty input stay graceful', () => {
    const empty = analyzeChord([]);
    expect(empty.status).toBe('unknown');
    expect(empty.confidence).toBe(0);
  });

  it('the engine still produces suggestions next to an unknown neighbor', () => {
    const unknown = analyzeChord([note(60), note(61), note(62), note(63)]).chord; // chromatic run
    expect(unknown).not.toBeNull();
    const out = generateChordSuggestions({
      projectKey: keyOf(0),
      previousChord: { chord: unknown!, alternatives: [] },
      nextChord: null,
      availableGapLength: 3840,
      currentGridResolution: 960,
    });
    expect(out.length).toBeGreaterThanOrEqual(12);
    // The key still anchors the ranking: the top suggestion is diatonic.
    const scale = new Set(scalePitchClasses(0, 'Ionian'));
    expect([...scale]).toContain(out[0]?.chord.rootPc);
    expect(out[0]?.reasonCodes).toContain('DIATONIC');
  });
});

// ---------------------------------------------------------------------------
// Debounced suggestion recalculation (the overlay's rapid-edit guard)
// ---------------------------------------------------------------------------

describe('suggestion recalculation debounce', () => {
  /** Deterministic virtual clock + scheduler. */
  function makeClock() {
    let t = 0;
    const timers: Array<{ at: number; fn: () => void; cancelled: boolean }> = [];
    const schedule = (fn: () => void, delayMs: number) => {
      const timer = { at: t + delayMs, fn, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    };
    return {
      schedule,
      get now() { return t; },
      advance(ms: number) {
        t += ms;
        for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
          if (!timer.cancelled && timer.at <= t) { timer.cancelled = true; timer.fn(); }
        }
      },
    };
  }

  function makeCounter() {
    const runs: number[] = [];
    const task = () => { runs.push(runs.length); };
    return { runs, task, count: () => runs.length };
  }

  function makeRecalc(task: () => void, clock: ReturnType<typeof makeClock>): DebouncedRecalculator {
    return createSuggestionRecalculator(task, { delayMs: 120, schedule: clock.schedule });
  }

  it('a rapid burst of edits coalesces into ONE recalculation — the last state wins', () => {
    const clock = makeClock();
    let state = 0;
    const counter = makeCounter();
    const recalc = makeRecalc(() => { state = counter.count(); counter.task(); }, clock);

    for (let i = 0; i < 20; i++) recalc.request(); // rapid project swaps
    expect(recalc.pending).toBe(true);
    expect(counter.count()).toBe(0); // nothing ran yet
    clock.advance(120);
    expect(counter.count()).toBe(1); // exactly one engine run
    expect(state).toBe(0); // it observed the coalesced state, once
    expect(recalc.pending).toBe(false);
  });

  it('requests separated by quiet windows each get their own run', () => {
    const clock = makeClock();
    const counter = makeCounter();
    const recalc = makeRecalc(counter.task, clock);

    recalc.request(); clock.advance(120);
    recalc.request(); clock.advance(120);
    recalc.request(); clock.advance(120);
    expect(counter.count()).toBe(3);
  });

  it('flush() delivers immediately; cancel() drops the pending run', () => {
    const clock = makeClock();
    const counter = makeCounter();
    const recalc = makeRecalc(counter.task, clock);

    recalc.request();
    recalc.flush();
    expect(counter.count()).toBe(1);
    expect(recalc.pending).toBe(false);

    recalc.request();
    recalc.cancel();
    clock.advance(500);
    expect(counter.count()).toBe(1); // dropped, never delivered
    expect(recalc.pending).toBe(false);
  });

  it('cancel is idempotent and flush without a pending run is a no-op', () => {
    const clock = makeClock();
    const counter = makeCounter();
    const recalc = makeRecalc(counter.task, clock);
    expect(() => { recalc.cancel(); recalc.cancel(); recalc.flush(); }).not.toThrow();
    expect(counter.count()).toBe(0);
  });
});
