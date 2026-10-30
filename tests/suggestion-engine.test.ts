/**
 * Smart Chord Suggestion — background engine tests (feature spec §1–§6).
 *
 * Covers: the bounded candidate vocabulary (§2), every scoring rule with
 * hand-computed expected scores (§3), the exact color boundaries (§5),
 * ambiguous-neighbor handling with secondary rankings and context
 * sensitivity (§4), the output contract and determinism (§6), the
 * preferences (qualities / complexity / weights / caps), input validation,
 * and the read-only double-click entry point suggestChordsAt.
 */
import { describe, expect, it } from 'vitest';
import type { Chord as ChordEvent, TimeSignature } from '../src/shared/schema';
import {
  DEFAULT_SCORE_WEIGHTS, SuggestionError, chordClipOf, chordFromSymbol, chordPitchClasses, colorForScore,
  generateCandidateVocabulary, generateChordSuggestions, gridResolutionOf, isDiatonicInKey,
  nearDuplicateOf, pitchOf, rootDistance, roleOfChordRoot, scoreCandidate, suggestChordsAt,
  thirdsClash, validateSuggestion,
  type Chord, type ChordClip, type ChordTrackAPI, type DoubleClickHandler, type GridResolution,
  type MidiClip, type Pitch, type ProjectKey, type ScoreBreakdownEntry, type ScoringContext,
  type SuggestionEngineInput, type SuggestionNeighbor, type Unsubscribe, type UndoTransaction,
} from '../src/engine/suggestion';

// --- helpers ----------------------------------------------------------------

const TS44: TimeSignature = { numerator: 4, denominator: 4 };
const C_MAJOR: ProjectKey = { tonic: 0, mode: 'Ionian', spelling: 'mixed' };
const A_MINOR: ProjectKey = { tonic: 9, mode: 'Aeolian', spelling: 'mixed' };

const cand = (symbol: string): Chord => {
  const r = chordFromSymbol(symbol);
  if (!r.ok) throw r.error;
  return r.chord;
};

const neighbor = (symbol: string, alternatives?: string[]): SuggestionNeighbor =>
  ({ chord: cand(symbol), alternatives: alternatives?.map(cand) });

const run = (over: Partial<SuggestionEngineInput> = {}) =>
  generateChordSuggestions({
    projectKey: C_MAJOR,
    previousChord: null,
    nextChord: null,
    availableGapLength: 3840,
    currentGridResolution: 240,
    ...over,
  });

const ctx = (over: Partial<ScoringContext> = {}): ScoringContext => ({
  key: C_MAJOR, prev: null, next: null, weights: DEFAULT_SCORE_WEIGHTS, allowBorrowed: true,
  ...over,
});

function find(suggestions: ReturnType<typeof run>, symbol: string) {
  const hit = suggestions.find((s) => s.chord.spelling === symbol);
  if (hit === undefined) throw new Error(`no suggestion for ${symbol}`);
  return hit;
}

function ruleOf(
  s: { scoreBreakdown?: readonly ScoreBreakdownEntry[]; breakdown?: readonly ScoreBreakdownEntry[] },
  name: string,
): ScoreBreakdownEntry {
  const hit = (s.scoreBreakdown ?? s.breakdown ?? []).find((e) => e.rule === name);
  if (hit === undefined) throw new Error(`no breakdown rule "${name}"`);
  return hit;
}

// --- double-click API fake (reads real, writes refused and recorded) --------

class EngineApiFake implements ChordTrackAPI {
  readonly mutations: string[] = [];
  constructor(private readonly clips: ChordClip[]) {}
  getProjectKeySignature(): ProjectKey { return C_MAJOR; }
  getGridResolution(): GridResolution { return gridResolutionOf(TS44); }
  getChordClipsInRange(startTime: number, endTime: number): ChordClip[] {
    return this.clips.filter((c) => c.startTime < endTime && c.startTime + c.lengthTicks > startTime);
  }
  getChordClipAt(time: number): ChordClip | null {
    return this.clips.find((c) => time >= c.startTime && time < c.startTime + c.lengthTicks) ?? null;
  }
  getPreviousChordClip(time: number): ChordClip | null {
    return [...this.clips]
      .filter((c) => c.startTime + c.lengthTicks <= time)
      .sort((a, b) => b.startTime + b.lengthTicks - (a.startTime + a.lengthTicks))[0] ?? null;
  }
  getNextChordClip(time: number): ChordClip | null {
    return [...this.clips]
      .filter((c) => c.startTime >= time)
      .sort((a, b) => a.startTime - b.startTime)[0] ?? null;
  }
  getAvailableGapAt(time: number): { startTime: number; endTime: number } | null {
    if (this.getChordClipAt(time) !== null) return null;
    const prev = this.getPreviousChordClip(time);
    const next = this.getNextChordClip(time);
    return {
      startTime: prev !== null ? prev.startTime + prev.lengthTicks : 0,
      endTime: next !== null ? next.startTime : Number.POSITIVE_INFINITY,
    };
  }
  private refuse(op: string): never {
    this.mutations.push(op);
    throw new SuggestionError('no-transaction', `${op} must never be called by the engine (read-only)`);
  }
  createMidiClip(): MidiClip { return this.refuse('createMidiClip'); }
  getMidiNotes(clipId: string): Pitch[] {
    return this.clips.find((c) => c.id === clipId)?.rawMidiNotes ?? [];
  }
  replaceMidiNotes(): void { this.refuse('replaceMidiNotes'); }
  clearMidiNotes(): void { this.refuse('clearMidiNotes'); }
  renameChordClip(): void { this.refuse('renameChordClip'); }
  subscribeToDoubleClick(_trackId: string, _callback: DoubleClickHandler): Unsubscribe {
    return () => undefined;
  }
  beginUndoTransaction(label: string): UndoTransaction { return this.refuse(`beginUndoTransaction(${label})`); }
  commitUndoTransaction(): void { this.refuse('commitUndoTransaction'); }
  cancelUndoTransaction(): void { this.refuse('cancelUndoTransaction'); }
}

const event = (id: string, symbol: string, startTick: number, durationTicks: number): ChordEvent =>
  ({ id, symbol, startTick, durationTicks });

const typedClip = (id: string, symbol: string, startTick: number, durationTicks: number): ChordClip => {
  const r = chordClipOf(event(id, symbol, startTick, durationTicks));
  if (!r.ok) throw r.error;
  return r.clip;
};

const midiClip = (id: string, symbol: string, startTick: number, durationTicks: number, midis: number[]): ChordClip => {
  const r = chordClipOf(event(id, symbol, startTick, durationTicks), {
    rawMidiNotes: midis.map((m) => pitchOf({ pitch: m, startTick, durationTicks, velocity: 100 })),
    confidence: 0.72,
  });
  if (!r.ok) throw r.error;
  return r.clip;
};

// --- §2 candidate vocabulary --------------------------------------------------

describe('generateCandidateVocabulary (§2)', () => {
  it('is bounded: 12 roots × 20 shapes at rich, every root represented', () => {
    const vocab = generateCandidateVocabulary(C_MAJOR);
    expect(vocab).toHaveLength(240);
    for (let pc = 0; pc <= 11; pc++) {
      expect(vocab.filter((c) => c.rootPc === pc)).toHaveLength(20);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(generateCandidateVocabulary(C_MAJOR)))
      .toBe(JSON.stringify(generateCandidateVocabulary(C_MAJOR)));
  });

  it('complexity tiers: simple = triads only, moderate adds common sevenths, rich = full grammar', () => {
    const simple = generateCandidateVocabulary(C_MAJOR, { preferredComplexity: 'simple' });
    expect(simple).toHaveLength(72);
    const triads = ['major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4'];
    expect(simple.every((c) => triads.includes(c.quality))).toBe(true);

    const moderate = generateCandidateVocabulary(C_MAJOR, { preferredComplexity: 'moderate' });
    expect(moderate).toHaveLength(168);
    expect(moderate.some((c) => c.quality === 'maj7')).toBe(true);
    expect(moderate.some((c) => c.quality === '9')).toBe(false);
  });

  it('allowedQualities filters by exact quality name', () => {
    const vocab = generateCandidateVocabulary(C_MAJOR, { allowedQualities: ['major', 'minor'] });
    expect(vocab).toHaveLength(24);
    expect(vocab.every((c) => c.quality === 'major' || c.quality === 'minor')).toBe(true);
  });

  it('builds every candidate through the shared grammar (aug7 shape present)', () => {
    const aug7 = generateCandidateVocabulary(C_MAJOR).find((c) => c.quality === 'aug7');
    expect(aug7).toBeDefined();
    expect(chordPitchClasses(aug7!)).toEqual([0, 4, 8, 10]);
    expect(aug7!.spelling.startsWith('C')).toBe(true);
  });
});

// --- harmonic helpers ---------------------------------------------------------

describe('harmonic helpers', () => {
  it('rootDistance is the symmetric circle distance (6 = tritone)', () => {
    expect(rootDistance(0, 0)).toBe(0);
    expect(rootDistance(0, 7)).toBe(5);
    expect(rootDistance(7, 0)).toBe(5);
    expect(rootDistance(0, 6)).toBe(6);
    expect(rootDistance(0, 11)).toBe(1);
  });

  it('roleOfChordRoot maps scale degrees positionally in every mode', () => {
    expect(roleOfChordRoot(C_MAJOR, 0)).toBe('tonic');
    expect(roleOfChordRoot(C_MAJOR, 2)).toBe('predominant');
    expect(roleOfChordRoot(C_MAJOR, 7)).toBe('dominant');
    expect(roleOfChordRoot(C_MAJOR, 11)).toBe('leading');
    expect(roleOfChordRoot(C_MAJOR, 6)).toBe('chromatic');
    // Aeolian's bVII (G over A) behaves as the cadential degree
    expect(roleOfChordRoot(A_MINOR, 7)).toBe('leading');
    // non-heptatonic scales keep only the structural anchors
    const dimHW: ProjectKey = { tonic: 0, mode: 'Diminished (Half-Whole)', spelling: 'mixed' };
    expect(roleOfChordRoot(dimHW, 7)).toBe('dominant');   // pc 7 is inside the scale
    expect(roleOfChordRoot(dimHW, 2)).toBe('chromatic');  // pc 2 is not
  });

  it('isDiatonicInKey requires every chord tone inside the scale', () => {
    expect(isDiatonicInKey(C_MAJOR, [0, 4, 7])).toBe(true);
    expect(isDiatonicInKey(C_MAJOR, [0, 3, 7])).toBe(false);
  });

  it('thirdsClash detects opposing thirds over a shared root tone', () => {
    expect(thirdsClash([0, 3, 7], [0, 4, 7])).toBe(true);        // Cm vs C
    expect(thirdsClash([0, 4, 7, 11], [0, 4, 7, 10])).toBe(true); // Cmaj7 vs C7 (B vs Bb over G)
    expect(thirdsClash([0, 4, 7], [9, 0, 4])).toBe(false);        // C vs Am — same thirds
    expect(thirdsClash([0, 4, 7], [2, 6, 9])).toBe(false);        // C vs D — no shared root tone
  });

  it('nearDuplicateOf: identical sets, same-root subsets and same quality', () => {
    expect(nearDuplicateOf(cand('C'), cand('C6'))).toBe(true);     // subset
    expect(nearDuplicateOf(cand('Cmaj7'), cand('C'))).toBe(true);  // superset
    expect(nearDuplicateOf(cand('C7'), cand('C7'))).toBe(true);    // identical
    expect(nearDuplicateOf(cand('C'), cand('Cm'))).toBe(false);    // third clash territory
    expect(nearDuplicateOf(cand('C'), cand('G'))).toBe(false);
  });
});

// --- §3 scoring rules -----------------------------------------------------------

describe('scoreCandidate (§3 rules)', () => {
  it('key-only tonic: base 50 + diatonic 25 + key context 10 = 85, green-zone cadence of reasons', () => {
    const s = scoreCandidate(cand('C'), ctx());
    expect(s.score100).toBe(85);
    expect(s.keyContextBonus).toBe(10);
    expect(s.reasonCodes).toEqual(['DIATONIC', 'KEY_CONTEXT']);
    expect(s.colorCategory).toBe('tonic');
    expect(ruleOf(s, 'base').delta).toBe(50);
    expect(ruleOf(s, 'diatonicFit').delta).toBe(25);
    expect(ruleOf(s, 'keyContext').delta).toBe(10);
  });

  it('diatonic +25, key-context tiers 10/6/3', () => {
    expect(scoreCandidate(cand('C'), ctx()).score100).toBe(85);   // tonic, primary
    expect(scoreCandidate(cand('Dm'), ctx()).score100).toBe(81);  // predominant, secondary
    expect(scoreCandidate(cand('Em'), ctx()).score100).toBe(78);  // mediant, tertiary
    expect(scoreCandidate(cand('Bdim'), ctx()).score100).toBe(78); // leading, tertiary
  });

  it('strong functional relationship to the previous chord: +20', () => {
    const s = scoreCandidate(cand('C'), ctx({ prev: cand('G') }));
    expect(ruleOf(s, 'functionalRelation').delta).toBe(20);
    expect(s.reasonCodes).toContain('STRONG_FUNCTIONAL_RELATION');
    expect(s.score100).toBe(100); // 50+25+10+20+10(root motion)+10(cadential), clamped
  });

  it('strong resolution tendency toward the next chord: +25', () => {
    const s = scoreCandidate(cand('Dm'), ctx({ next: cand('G') }));
    expect(ruleOf(s, 'resolutionTendency').delta).toBe(25);
    expect(s.reasonCodes).toContain('STRONG_RESOLUTION');
    expect(s.reasonCodes).toContain('CADENTIAL');
    expect(s.reasonCodes).toContain('ROOT_MOTION_FIFTH');
    expect(s.score100).toBe(100);
  });

  it('common-tone retention: +10 at ≥2 shared tones, suppressed for near-duplicates', () => {
    const em = scoreCandidate(cand('Em'), ctx({ prev: cand('C') })); // shares E, G
    expect(ruleOf(em, 'commonTone').delta).toBe(10);
    expect(em.reasonCodes).toContain('COMMON_TONE');
    expect(em.score100).toBe(88);

    const dm = scoreCandidate(cand('Dm'), ctx({ prev: cand('C') })); // shares nothing
    expect(dm.breakdown.find((e) => e.rule === 'commonTone')).toBeUndefined();

    const same = scoreCandidate(cand('C'), ctx({ prev: cand('C') })); // identical — duplicate, not voice leading
    expect(same.breakdown.find((e) => e.rule === 'commonTone')).toBeUndefined();
    expect(ruleOf(same, 'duplicateAdjacent').delta).toBe(-10);
    expect(same.score100).toBe(75);
  });

  it('root motion by fourth/fifth: +10 once', () => {
    const f = scoreCandidate(cand('F'), ctx({ prev: cand('C') }));
    expect(ruleOf(f, 'rootMotion').delta).toBe(10);
    expect(f.reasonCodes).toContain('ROOT_MOTION_FIFTH');

    const b = scoreCandidate(cand('B'), ctx({ prev: cand('C') })); // distance 1
    expect(b.breakdown.find((e) => e.rule === 'rootMotion')).toBeUndefined();
  });

  it('borrowed chords: +15 classic mixture (chromatic root), +10 same-root mixture', () => {
    const bb = scoreCandidate(cand('Bb'), ctx());
    expect(ruleOf(bb, 'borrowedChord').delta).toBe(15);
    expect(bb.reasonCodes).toContain('BORROWED_CHORD');
    expect(bb.score100).toBe(65); // 50 + 15, no key role (chromatic root)

    const fm = scoreCandidate(cand('Fm'), ctx());
    expect(ruleOf(fm, 'borrowedChord').delta).toBe(10);
    expect(fm.score100).toBe(70); // 50 + 10 key context (subdominant root) + 10 borrowed
  });

  it('modal interchange: +10 fully diatonic to a sibling mode (D major via C Lydian)', () => {
    const d = scoreCandidate(cand('D'), ctx());
    const modal = ruleOf(d, 'modalInterchange');
    expect(modal.delta).toBe(10);
    expect(modal.detail).toContain('Lydian');
    expect(d.score100).toBe(66); // 50 + 6 key context (predominant root) + 10 modal
  });

  it('chromatic mediant: +10, never stacked with the other justifications', () => {
    const a = scoreCandidate(cand('A'), ctx({ prev: cand('C') })); // A major, a third below C
    expect(ruleOf(a, 'chromaticMediant').delta).toBe(10);
    expect(a.reasonCodes).toContain('CHROMATIC_MEDIANT');
    expect(a.score100).toBe(66); // 50 + 6 key context (submediant root) + 10 mediant
    expect(a.breakdown.find((e) => e.rule === 'borrowedChord')).toBeUndefined();
    expect(a.breakdown.find((e) => e.rule === 'modalInterchange')).toBeUndefined();
  });

  it('tritone clash with a neighbor: −20', () => {
    const s = scoreCandidate(cand('F#'), ctx({ prev: cand('C') }));
    expect(ruleOf(s, 'tritoneClash').delta).toBe(-20);
    expect(s.reasonCodes).toContain('POSSIBLE_CLASH');
    expect(s.score100).toBe(10); // 50 − 20 (tritone) − 20 (no justification)
  });

  it('major/minor third cross-relation with a neighbor: −15', () => {
    const s = scoreCandidate(cand('Cm'), ctx({ prev: cand('C') }));
    expect(ruleOf(s, 'thirdClash').delta).toBe(-15);
    expect(s.reasonCodes).toContain('POSSIBLE_CLASH');
    // 50 + 10 key context (tonic root) + 10 borrowed i + 10 common tones − 15
    expect(s.score100).toBe(65);
  });

  it('duplicate of an adjacent chord: −10 (C and Cmaj7 after C)', () => {
    expect(scoreCandidate(cand('C'), ctx({ prev: cand('C') })).score100).toBe(75);
    expect(scoreCandidate(cand('Cmaj7'), ctx({ prev: cand('C') })).score100).toBe(75);
    const cm = scoreCandidate(cand('Cm'), ctx({ prev: cand('C') }));
    expect(cm.breakdown.find((e) => e.rule === 'duplicateAdjacent')).toBeUndefined();
  });

  it('each penalty applies once even with two neighbors', () => {
    const s = scoreCandidate(cand('C'), ctx({ prev: cand('C'), next: cand('F#') }));
    expect(s.breakdown.filter((e) => e.rule === 'tritoneClash')).toHaveLength(1);
    expect(s.breakdown.filter((e) => e.rule === 'duplicateAdjacent')).toHaveLength(1);
    expect(s.score100).toBe(55); // 50+25+10 −20 −10
  });

  it('non-diatonic without justification: −20 and WEAK_CONTEXT', () => {
    const s = scoreCandidate(cand('F#'), ctx());
    expect(ruleOf(s, 'nonDiatonic').delta).toBe(-20);
    expect(s.reasonCodes).toEqual(['NON_DIATONIC', 'WEAK_CONTEXT']);
    expect(s.score100).toBe(30);
    expect(s.colorCategory).toBe('passing');
  });

  it('WEAK_CONTEXT with neighbors when nothing contextual supports the candidate', () => {
    const em = scoreCandidate(cand('Em'), ctx({ prev: cand('Dm') }));
    expect(em.reasonCodes).toContain('WEAK_CONTEXT');
    expect(em.score100).toBe(78);
  });

  it('contextual bonuses: prev V favors I/vi; next V favors ii/IV; prev IV favors V/I/ii/vi; prev ii favors V', () => {
    const afterV = scoreCandidate(cand('Am'), ctx({ prev: cand('G') }));
    expect(afterV.reasonCodes).toContain('CADENTIAL');
    expect(afterV.score100).toBe(100);

    const beforeV_ii = scoreCandidate(cand('Dm'), ctx({ next: cand('G') }));
    expect(beforeV_ii.reasonCodes).toContain('CADENTIAL');
    const beforeV_IV = scoreCandidate(cand('F'), ctx({ next: cand('G') }));
    expect(beforeV_IV.reasonCodes).toContain('CADENTIAL');

    const afterIV = scoreCandidate(cand('G'), ctx({ prev: cand('F') }));
    expect(afterIV.reasonCodes).toContain('CADENTIAL');
    expect(afterIV.score100).toBe(100);

    const afterii = scoreCandidate(cand('G'), ctx({ prev: cand('Dm') }));
    expect(afterii.reasonCodes).toContain('CADENTIAL');
    expect(afterii.score100).toBe(100);
  });

  it('allowBorrowedChords: false removes mixture justifications', () => {
    const s = scoreCandidate(cand('Bb'), ctx({ allowBorrowed: false }));
    expect(s.score100).toBe(30); // 50 − 20 non-diatonic
    expect(s.reasonCodes).toContain('NON_DIATONIC');
    expect(s.breakdown.find((e) => e.rule === 'borrowedChord')).toBeUndefined();
  });
});

// --- §5 color mapping -----------------------------------------------------------

describe('colorForScore (§5)', () => {
  it('maps the bands with exact boundaries', () => {
    expect(colorForScore(100)).toBe('green');
    expect(colorForScore(75)).toBe('green');
    expect(colorForScore(74)).toBe('yellow');
    expect(colorForScore(45)).toBe('yellow');
    expect(colorForScore(44)).toBe('red');
    expect(colorForScore(0)).toBe('red');
  });
});

// --- §1 + §6 engine behavior ----------------------------------------------------

describe('generateChordSuggestions (§1 key-only, §6 output)', () => {
  it('returns useful suggestions from the project key alone', () => {
    const out = run();
    expect(out.length).toBeGreaterThanOrEqual(12);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out[0]!.chord.spelling).toBe('C');
    expect(out[0]!.score100).toBe(85);
    expect(out[0]!.color).toBe('green');
    expect(out[0]!.colorCategory).toBe('tonic');
    expect(find(out, 'G').score100).toBe(85);
    expect(find(out, 'Dm').score100).toBe(81);
    expect(find(out, 'Am').score100).toBe(81);
    expect(find(out, 'Bdim').score100).toBe(78);
    const perRoot = new Map<number, number>();
    for (const s of out) perRoot.set(s.chord.rootPc, (perRoot.get(s.chord.rootPc) ?? 0) + 1);
    expect([...perRoot.values()].every((n) => n <= 3)).toBe(true);
    expect(perRoot.size).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.score100).toBeLessThanOrEqual(out[i - 1]!.score100);
    }
  });

  it('works with only one neighbor present (§1: either may be null)', () => {
    const prevOnly = run({ previousChord: neighbor('G') });
    expect(prevOnly.length).toBeGreaterThanOrEqual(12);
    const nextOnly = run({ nextChord: neighbor('G') });
    expect(nextOnly.length).toBeGreaterThanOrEqual(12);
  });

  it('prev V: I ranks first with cadential + functional + root-motion reasons', () => {
    const out = run({ previousChord: neighbor('G') });
    const c = find(out, 'C');
    expect(c.score100).toBe(100);
    expect(c.reasonCodes).toContain('CADENTIAL');
    expect(c.reasonCodes).toContain('STRONG_FUNCTIONAL_RELATION');
    expect(c.reasonCodes).toContain('ROOT_MOTION_FIFTH');
    expect(c.colorCategory).toBe('cadential');
    const am = find(out, 'Am');
    expect(am.score100).toBe(100);
    expect(am.reasonCodes).toContain('CADENTIAL');
  });

  it('next V: ii and IV carry strong-resolution + cadential reasons', () => {
    const out = run({ nextChord: neighbor('G') });
    expect(out[0]!.chord.spelling).toBe('C');
    expect(find(out, 'Dm').reasonCodes).toContain('STRONG_RESOLUTION');
    expect(find(out, 'Dm').reasonCodes).toContain('CADENTIAL');
    expect(find(out, 'F').reasonCodes).toContain('CADENTIAL');
  });

  it('prev IV favors V/I/ii/vi cadentially; prev ii favors V', () => {
    const afterIV = run({ previousChord: neighbor('F') });
    for (const symbol of ['G', 'C', 'Dm', 'Am']) {
      expect(find(afterIV, symbol).reasonCodes).toContain('CADENTIAL');
    }
    const afterii = run({ previousChord: neighbor('Dm') });
    const g = find(afterii, 'G');
    expect(g.reasonCodes).toContain('CADENTIAL');
    expect(g.reasonCodes).toContain('STRONG_FUNCTIONAL_RELATION');
    expect(g.reasonCodes).toContain('ROOT_MOTION_FIFTH');
    expect(g.score100).toBe(100);
  });

  it('§6: every suggestion satisfies the wire contract and its own invariants', () => {
    const out = run({ previousChord: neighbor('G'), nextChord: neighbor('Am') });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(validateSuggestion(s).ok).toBe(true);
      expect(s.score).toBeCloseTo(s.score100 / 100, 10);
      expect(s.color).toBe(colorForScore(s.score100));
      expect(s.contextExplanation.length).toBeGreaterThan(0);
      expect(s.reasonCodes.length).toBeGreaterThan(0);
      expect(s.scoreBreakdown[0]!.rule).toBe('base');
      expect(typeof s.contextSensitive).toBe('boolean');
    }
  });

  it('is deterministic and plain-JSON serializable', () => {
    const input: SuggestionEngineInput = {
      projectKey: C_MAJOR,
      previousChord: neighbor('C6', ['Am7']),
      nextChord: neighbor('Dm'),
      availableGapLength: 3840,
      currentGridResolution: 240,
    };
    const a = generateChordSuggestions(input);
    const b = generateChordSuggestions(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('rejects malformed numeric inputs with contract errors, accepts 0 and open-tail gaps', () => {
    expect(() => run({ availableGapLength: -1 })).toThrowError(SuggestionError);
    expect(() => run({ availableGapLength: Number.NaN })).toThrowError(SuggestionError);
    expect(() => run({ currentGridResolution: 0 })).toThrowError(SuggestionError);
    expect(() => run({ currentGridResolution: 240.5 })).toThrowError(/positive integer/);
    expect(() => run({ availableGapLength: Number.POSITIVE_INFINITY })).not.toThrow();
    expect(() => run({ availableGapLength: 0 })).not.toThrow();
  });
});

// --- preferences ------------------------------------------------------------------

describe('preferences', () => {
  it('maxSuggestions clamps into the 12–24 window (default 18)', () => {
    expect(run()).toHaveLength(18);
    expect(run({ preferences: { maxSuggestions: 5 } })).toHaveLength(12);
    expect(run({ preferences: { maxSuggestions: 100 } })).toHaveLength(24);
  });

  it('maxPerRoot is a selection rule, configurable down to one per root', () => {
    const out = run({ preferences: { maxPerRoot: 1, maxSuggestions: 12 } });
    const roots = out.map((s) => s.chord.rootPc);
    expect(new Set(roots).size).toBe(roots.length);
  });

  it('allowedQualities restricts what reaches the output', () => {
    const out = run({ preferences: { allowedQualities: ['major', 'minor'] } });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.chord.quality === 'major' || s.chord.quality === 'minor')).toBe(true);
  });

  it('preferredComplexity simple keeps triads and sus shapes only', () => {
    const out = run({ preferences: { preferredComplexity: 'simple' } });
    const triads = ['major', 'minor', 'diminished', 'augmented', 'sus2', 'sus4'];
    expect(out.every((s) => triads.includes(s.chord.quality))).toBe(true);
  });

  it('weights are configurable — the base is a rule like any other', () => {
    const out = run({ preferences: { weights: { base: 0, diatonicFit: 25 } } });
    const c = find(out, 'C');
    expect(c.score100).toBe(35); // 25 diatonic + 10 key context, no base
    expect(c.color).toBe('red');
  });
});

// --- §4 ambiguous MIDI ------------------------------------------------------------

describe('ambiguous MIDI handling (§4)', () => {
  it('primary context = highest-confidence reading; secondary ranking vs the top alternative', () => {
    const out = run({ previousChord: neighbor('C6', ['Am7']) });
    // never hidden: every suggestion states the ambiguity
    expect(out.every((s) => s.ambiguity?.length === 1)).toBe(true);
    expect(out[0]!.ambiguity![0]!.position).toBe('previous');
    expect(out[0]!.ambiguity![0]!.primary.displayName).toBe('C6');
    expect(out[0]!.ambiguity![0]!.alternative.displayName).toBe('Am7');

    // G7 after C6: strong tonic→dominant function (100). After Am7 the
    // function bonus disappears (submediant→dominant is not a strong
    // transition) and the score drops to 85 — a 15-point material shift.
    const g7 = find(out, 'G7');
    expect(g7.score100).toBe(100);
    expect(g7.alternativeContextResults).toBeDefined();
    expect(g7.alternativeContextResults).toHaveLength(1);
    expect(g7.alternativeContextResults![0]!.contextLabel).toBe('previous chord as Am7');
    expect(g7.alternativeContextResults![0]!.score100).toBe(85);
    expect(g7.contextSensitive).toBe(true);
  });

  it('an unambiguous neighbor produces no ambiguity data and no context sensitivity', () => {
    const out = run({ previousChord: neighbor('C6') });
    expect(out.every((s) => s.ambiguity === undefined)).toBe(true);
    expect(out.every((s) => s.contextSensitive === false)).toBe(true);
    expect(out.every((s) => s.alternativeContextResults === undefined)).toBe(true);
  });

  it('both neighbors ambiguous: two ambiguity notes, two alternative contexts', () => {
    const out = run({
      previousChord: neighbor('C6', ['Am7']),
      nextChord: neighbor('Dm', ['Bb']),
    });
    expect(out[0]!.ambiguity).toHaveLength(2);
    expect(out.every((s) => (s.alternativeContextResults ?? []).length === 2)).toBe(true);
  });
});

// --- the double-click entry point ---------------------------------------------------

describe('suggestChordsAt (double-click entry)', () => {
  it('reads the harmonic context off the API and never mutates anything', () => {
    const api = new EngineApiFake([
      typedClip('c1', 'C', 0, 3840),
      typedClip('c2', 'G', 3840, 3840),
    ]);
    const out = suggestChordsAt(api, 8000);
    expect(api.mutations).toEqual([]);
    const c = find(out, 'C');
    expect(c.reasonCodes).toContain('CADENTIAL');        // previous G is V
    expect(c.reasonCodes).toContain('ROOT_MOTION_FIFTH');
  });

  it('excludes the open Smart clip from the neighbor context', () => {
    const api = new EngineApiFake([
      typedClip('c1', 'C', 0, 3840),
      typedClip('sch1', 'C', 3840, 3840), // the fresh placeholder Smart clip
      typedClip('c3', 'F', 7680, 3840),
    ]);
    // Without exclusion the placeholder at the click boundary acts as the
    // next chord (V→I reads strong). A double-click floors to the grid, so
    // the click time equals the fresh clip's start.
    const withPlaceholder = suggestChordsAt(api, 3840);
    expect(find(withPlaceholder, 'G').reasonCodes).toContain('STRONG_RESOLUTION');
    // With exclusion the true next chord F appears — dominant→subdominant is
    // not a strong resolution, so the reason disappears.
    const excluded = suggestChordsAt(api, 3840, { excludeClipId: 'sch1' });
    expect(find(excluded, 'G').reasonCodes).not.toContain('STRONG_RESOLUTION');
  });

  it('MIDI-backed neighbors feed §4 from the fresh parse (C6 vs Am7 ambiguity)', () => {
    const api = new EngineApiFake([midiClip('c1', 'C6', 0, 3840, [60, 64, 67, 69])]);
    const out = suggestChordsAt(api, 5000); // click in the gap after the clip → C6 is the previous chord
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]!.ambiguity).toBeDefined();
    expect(out[0]!.ambiguity![0]!.primary.displayName).toBe('C6');
    // the parser's top alternative reading: the same four notes as Am7 over
    // the sounding C bass (the slash bass explains itself in the §1 parser)
    expect(out[0]!.ambiguity![0]!.alternative.displayName).toBe('Am7/C');
  });

  it('rejects invalid click positions with the contract error', () => {
    const api = new EngineApiFake([]);
    expect(() => suggestChordsAt(api, -1)).toThrowError(SuggestionError);
    expect(() => suggestChordsAt(api, 1.5)).toThrowError(/integer ≥ 0/);
  });
});
