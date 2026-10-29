/**
 * Structural harmony & musical movement tests (Phase 4.1, spec §18).
 *
 * These tests target the ARCHITECTURE, not tuning: harmonic foundations are
 * represented independently from chord color, structural selection happens
 * before extension selection, repetition is detected on foundation identity,
 * and seeds move whole harmonic trajectories. The motivating failure — an
 * E Aeolian generator oscillating D7 → D13 as a substitute for structural
 * movement — is structurally impossible once same-foundation events merge,
 * and Test 3 pins that regression.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { generateChordProgression } from '../src/engine/harmony/generation';
import {
  analyzeFoundationRelationship, foundationId, foundationOf, getHarmonicFoundation,
  isStructuralMovement, sameHarmonicFoundation,
} from '../src/engine/harmony/foundation';
import { parseChord } from '../src/shared/schema/chords';
import { barTicks } from '../src/shared/schema/meter';
import { MODE_NAMES, scalePitchClasses, type ModeName } from '../src/shared/schema/modes';
import { runChordGenerate, __setChordGenerator } from '../src/lib/chordGenUi';
import { useStore } from '../src/store/store';
import {
  createDefaultProject, projectFromFixture, validateProject,
  type Chord, type Project, type Section,
} from '../src/shared/schema';
import { generate } from '../src/engine/generate';

const BT = 960 * 4; // 4/4 bar

function makeProject(sections: Section[], chords: Chord[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'StructTest', tracks: [] });
  return { ...base, sections, chords, ...opts };
}
const sec = (id: string, name: string, startBar: number, lengthBars: number): Section =>
  ({ id, name, startBar, lengthBars });
const chd = (id: string, startTick: number, durationTicks: number, symbol = 'C', locked?: boolean): Chord =>
  ({ id, symbol, startTick, durationTicks, ...(locked !== undefined ? { locked } : {}) });

/** Foundation id of a chord symbol in a key/mode ('?' prefix when unparseable). */
const fid = (symbol: string, key: number, mode: ModeName): string => {
  const f = getHarmonicFoundation(symbol, { root: key, mode });
  return f ? foundationId(f) : `?${symbol}`;
};

/** Assert the invariants every generation result must satisfy. */
function expectWellFormed(r: { chords: Chord[] }, regionStart = 0, regionEnd?: number): void {
  const sorted = [...r.chords].sort((a, b) => a.startTick - b.startTick);
  for (const c of sorted) {
    expect(Number.isInteger(c.startTick)).toBe(true);
    expect(Number.isInteger(c.durationTicks)).toBe(true);
    expect(c.startTick).toBeGreaterThanOrEqual(regionStart);
    expect(c.durationTicks).toBeGreaterThanOrEqual(1);
    expect(parseChord(c.symbol).ok).toBe(true);
    if (regionEnd !== undefined) expect(c.startTick + c.durationTicks).toBeLessThanOrEqual(regionEnd);
  }
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i - 1].startTick + sorted[i - 1].durationTicks).toBeLessThanOrEqual(sorted[i].startTick);
  }
}

function coversExactly(chords: Chord[], start: number, end: number): boolean {
  const spans = chords
    .filter((c) => c.startTick + c.durationTicks > start && c.startTick < end)
    .map((c) => ({ s: Math.max(c.startTick, start), e: Math.min(c.startTick + c.durationTicks, end) }))
    .sort((a, b) => a.s - b.s);
  let cursor = start;
  for (const sp of spans) {
    if (sp.s > cursor) return false;
    cursor = Math.max(cursor, sp.e);
    if (cursor >= end) return true;
  }
  return cursor >= end;
}

const verseAndChorus = [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)];

/** Scale pitch classes of a mode at a tonic, as a set (schema data, not re-declared). */
const modeScale = (key: number, mode: ModeName): Set<number> => new Set(scalePitchClasses(key, mode));

beforeEach(() => { __setChordGenerator(null); });

/* ------------------------------------------------------------------ */

describe('Test 1 — harmonic foundation equivalence (spec §18.1, §4)', () => {
  it('groups Em, Em7, Em9 on one E minor foundation', () => {
    const key = 4; const mode: ModeName = 'Aeolian';
    const em = getHarmonicFoundation('Em', { root: key, mode })!;
    const em7 = getHarmonicFoundation('Em7', { root: key, mode })!;
    const em9 = getHarmonicFoundation('Em9', { root: key, mode })!;
    expect(em.quality).toBe('minor');
    expect(sameHarmonicFoundation(em, em7)).toBe(true);
    expect(sameHarmonicFoundation(em, em9)).toBe(true);
    expect(sameHarmonicFoundation(em7, em9)).toBe(true);
    expect(em.corePitchClasses).toEqual([4, 7, 11]); // E, G, B
  });

  it('groups D, D7, D9, D13 on one D major foundation', () => {
    const key = 2; const mode: ModeName = 'Mixolydian';
    const d = getHarmonicFoundation('D', { root: key, mode })!;
    const d7 = getHarmonicFoundation('D7', { root: key, mode })!;
    const d9 = getHarmonicFoundation('D9', { root: key, mode })!;
    const d13 = getHarmonicFoundation('D13', { root: key, mode })!;
    expect(d.quality).toBe('major');
    expect(sameHarmonicFoundation(d, d7)).toBe(true);
    expect(sameHarmonicFoundation(d, d9)).toBe(true);
    expect(sameHarmonicFoundation(d, d13)).toBe(true);
    expect(d.corePitchClasses).toEqual([2, 6, 9]); // D, F#, A
  });

  it('keeps genuinely different harmonies distinct: D vs Dm vs Ddim vs Daug vs Dsus4', () => {
    const key = 2; const mode: ModeName = 'Dorian';
    const d = getHarmonicFoundation('D', { root: key, mode })!;
    const dm = getHarmonicFoundation('Dm', { root: key, mode })!;
    const ddim = getHarmonicFoundation('Ddim', { root: key, mode })!;
    const daug = getHarmonicFoundation('Daug', { root: key, mode })!;
    const dsus4 = getHarmonicFoundation('Dsus4', { root: key, mode })!;
    expect(d.quality).toBe('major');
    expect(dm.quality).toBe('minor');
    expect(ddim.quality).toBe('diminished');
    expect(daug.quality).toBe('augmented');
    expect(dsus4.quality).toBe('suspended');
    for (const other of [dm, ddim, daug, dsus4]) {
      expect(sameHarmonicFoundation(d, other)).toBe(false);
    }
  });

  it('classifies Dm7b5 and Ddim7 with the diminished core, slash chords with their root harmony', () => {
    const key = 0; const mode: ModeName = 'Ionian';
    const dim = getHarmonicFoundation('Bdim', { root: key, mode })!;
    const m7b5 = getHarmonicFoundation('Bm7b5', { root: key, mode })!;
    const dim7 = getHarmonicFoundation('Bdim7', { root: key, mode })!;
    expect(sameHarmonicFoundation(dim, m7b5)).toBe(true);
    expect(sameHarmonicFoundation(dim, dim7)).toBe(true);
    // Inversions are color, not structure.
    const c = getHarmonicFoundation('C', { root: key, mode })!;
    const ce = getHarmonicFoundation('C/E', { root: key, mode })!;
    expect(sameHarmonicFoundation(c, ce)).toBe(true);
    // Altered fifths keep their own core.
    const d = getHarmonicFoundation('D7', { root: key, mode })!;
    const d7b5 = getHarmonicFoundation('D7b5', { root: key, mode })!;
    expect(sameHarmonicFoundation(d, d7b5)).toBe(false);
    expect(d7b5.quality).toBe('other');
  });
});

describe('Test 2 — structural movement recognition (spec §18.2, §10)', () => {
  it('recognizes D7 → D13 as color variation, not structural movement', () => {
    const d7 = foundationOf('D7')!;
    const d13 = foundationOf('D13')!;
    expect(sameHarmonicFoundation(d7, d13)).toBe(true);
    expect(isStructuralMovement(d7, d13)).toBe(false);
    const rel = analyzeFoundationRelationship(d7, d13);
    expect(rel.sameRoot).toBe(true);
  });

  it('recognizes Em → C as structural movement', () => {
    const em = foundationOf('Em')!;
    const c = foundationOf('C')!;
    expect(isStructuralMovement(em, c)).toBe(true);
    const rel = analyzeFoundationRelationship(em, c);
    expect(rel.sameRoot).toBe(false);
    expect(rel.intervalClass).toBe(4); // E→C: a major third away (folded)
    expect(rel.sharedCoreTones).toBe(2); // E and C share E, G — smooth yet moving
  });

  it('treats common tones and movement as independent facts (spec §10)', () => {
    // Em → C: smooth AND moving. D7 → D13: smooth and NOT moving.
    const smoothMoving = analyzeFoundationRelationship(foundationOf('Em')!, foundationOf('C')!);
    const smoothStatic = analyzeFoundationRelationship(foundationOf('D7')!, foundationOf('D13')!);
    expect(smoothMoving.sharedCoreTones).toBeGreaterThan(0);
    expect(smoothMoving.sameRoot).toBe(false);
    expect(smoothStatic.sameRoot).toBe(true);
    // Root motion direction is reported as a fact (shortest path), never a
    // preference: C→D is unambiguously upward.
    const rel = analyzeFoundationRelationship(foundationOf('C')!, foundationOf('D')!);
    expect(rel.rootInterval).toBe(2);
    expect(rel.rootDirection).toBe('up');
  });
});

describe('Test 3 — E Aeolian regression (spec §18.3)', () => {
  it('never oscillates between D7 and D13 — same-foundation events merge', () => {
    const p = makeProject(verseAndChorus, [], { key: 4, mode: 'Aeolian' });
    for (const seed of [1, 5, 42, 99, 777, 1234]) {
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed });
      expectWellFormed(r, 0, 16 * BT);
      const foundations = r.chords.map((c) => fid(c.symbol, 4, 'Aeolian'));
      // Within-phrase same-foundation runs merge, so a triple run is impossible;
      // even a pair can only survive at a planned phrase-boundary articulation.
      for (let i = 2; i < foundations.length; i++) {
        const a = foundations[i - 2]; const b = foundations[i - 1]; const c = foundations[i];
        const pairRepeats = (a === b && b === c) || (a === c && a !== b && i >= 3 && foundations[i - 3] === a);
        expect(pairRepeats).toBe(false);
      }
      // The reported failure shape: D-rooted events (the D7/D13 family) must not
      // dominate the progression — structural movement spreads the roots.
      const dRoot = r.chords.filter((c) => c.symbol.startsWith('D') && !c.symbol.startsWith('Db')).length;
      expect(dRoot / r.chords.length).toBeLessThan(0.5);
    }
  });

  it('does not repeat one dominant-family sonority as a pseudo-progression across seeds', () => {
    const p = makeProject(verseAndChorus, [], { key: 4, mode: 'Aeolian' });
    for (const seed of [2, 8, 21]) {
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed });
      const foundations = r.chords.map((c) => fid(c.symbol, 4, 'Aeolian'));
      // No A,B,A,B,A alternation on the same two foundations spanning ≥ 5 events.
      for (let i = 0; i + 4 < foundations.length; i++) {
        const [a, b, c, d, e] = foundations.slice(i, i + 5);
        expect(a === c && c === e && b === d && a !== b).toBe(false);
      }
    }
  });
});

describe('Test 4 — tonal-center coherence (spec §18.4, §7)', () => {
  it('communicates E as the tonal center without fixed bar requirements', () => {
    const p = makeProject(verseAndChorus, [], { key: 4, mode: 'Aeolian' });
    let runsWithCenter = 0;
    const runs = 8;
    for (let seed = 1; seed <= runs; seed++) {
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed });
      // Diagnostics: the E minor foundation is selected, and a substantial
      // share of events reinforce the tonic — inspected through the report,
      // not by demanding Em at fixed positions.
      expect(r.report.structuralFoundations).toContain('E minor');
      if (r.report.tonicReinforcementEvents / Math.max(1, r.report.generatedChordCount) >= 0.2) {
        runsWithCenter += 1;
      }
      // The tonal center also surfaces in the actual harmony: E-rooted or
      // E-minor-family events exist in every run.
      const hasTonicFamily = r.chords.some((c) => fid(c.symbol, 4, 'Aeolian').startsWith('4|'));
      expect(hasTonicFamily).toBe(true);
    }
    expect(runsWithCenter).toBeGreaterThanOrEqual(runs - 1);
  });

  it('opens on the mode\'s own tonic foundation in most established phrases', () => {
    const p = makeProject(verseAndChorus, [], { key: 4, mode: 'Aeolian' });
    let tonicOpenings = 0;
    const runs = 10;
    for (let seed = 1; seed <= runs; seed++) {
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed });
      const first = getHarmonicFoundation(r.chords[0].symbol, { root: 4, mode: 'Aeolian' })!;
      if (first.rootPc === 4) tonicOpenings += 1;
    }
    expect(tonicOpenings).toBeGreaterThanOrEqual(runs - 2);
  });
});

describe('Test 5 — modal integrity (spec §18.5, §7)', () => {
  const modes: ModeName[] = [
    'Ionian', 'Dorian', 'Phrygian', 'Locrian', 'Whole Tone',
    'Diminished (Half-Whole)', 'Diminished (Whole-Half)',
  ];

  it.each(modes)('generates coherent %s harmony without imposed functional clichés', (mode) => {
    const key = 2;
    const p = makeProject(verseAndChorus, [], { key, mode });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 42 });
    expectWellFormed(r, 0, 16 * BT);
    expect(coversExactly(r.chords, 0, 16 * BT)).toBe(true);
    for (const c of r.chords) expect(parseChord(c.symbol).ok).toBe(true);
    // Diatonic-only run: the mode's own harmony carries the progression —
    // every color tone of every event belongs to the mode's scale.
    const diatonic = makeProject(verseAndChorus, [], {
      key, mode,
      chordGenSettings: { ...createDefaultProject().chordGenSettings!, borrowing: 'none', seed: 42 },
    });
    const rd = generateChordProgression(diatonic, { scope: { type: 'all' }, seed: 42 });
    const scale = modeScale(key, mode);
    for (const c of rd.chords) {
      const f = getHarmonicFoundation(c.symbol, { root: key, mode })!;
      expect(f.diatonic).toBe(true);
      const parsed = parseChord(c.symbol);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        for (const pc of parsed.chord.pitchClasses) expect(scale.has(pc)).toBe(true);
      }
    }
    // Structural cadence realizations never claim functional-tonal language
    // where the environment cannot support it.
    if (mode === 'Whole Tone' || mode === 'Diminished (Half-Whole)' || mode === 'Diminished (Whole-Half)') {
      expect(rd.report.cadenceFamiliesUsed).not.toContain('functional-tonal');
      expect(rd.report.cadenceFamiliesUsed).not.toContain('plagal');
    }
    if (mode === 'Locrian') {
      expect(rd.report.cadenceFamiliesUsed).not.toContain('plagal');
    }
  });

  it('lets symmetrical modes resolve through pedal/coloristic families, not V–I', () => {
    const key = 0;
    for (const mode of ['Whole Tone', 'Diminished (Whole-Half)'] as ModeName[]) {
      const p = makeProject(verseAndChorus, [], {
        key, mode,
        chordGenSettings: { ...createDefaultProject().chordGenSettings!, borrowing: 'none', cadence: 'strong', seed: 3 },
      });
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 3 });
      for (const cad of r.report.structuralCadences) {
        if (cad.family === 'functional-tonal') {
          throw new Error(`${mode}: functional-tonal cadence realized where the environment lacks a dominant`);
        }
      }
    }
  });
});

describe('Test 6 — seed variation moves the harmony (spec §18.6, §11)', () => {
  it('different seeds produce different structural trajectories, deterministically', () => {
    const p = makeProject(verseAndChorus, [], { key: 4, mode: 'Aeolian' });
    const trajectories = new Map<number, string[]>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r1 = generateChordProgression(p, { scope: { type: 'all' }, seed });
      const r2 = generateChordProgression(p, { scope: { type: 'all' }, seed });
      // Determinism: same seed, byte-identical.
      expect(r1.chords).toEqual(r2.chords);
      trajectories.set(seed, r1.chords.map((c) => fid(c.symbol, 4, 'Aeolian')));
    }
    const distinct = new Set([...trajectories.values()].map((f) => f.join('>')));
    expect(distinct.size).toBeGreaterThanOrEqual(4);
    // Structural variation: some seeds change the ROOT sequence, not merely
    // extensions of the same roots.
    const rootSeqs = new Set([...trajectories.values()].map((f) =>
      f.map((id) => id.split('|')[0]).join(',')));
    expect(rootSeqs.size).toBeGreaterThanOrEqual(4);
  });
});

describe('Test 7 — repeated sections share structural identity (spec §18.7, §15)', () => {
  it('related sections reuse foundations while colors are re-treated', () => {
    const base = projectFromFixture({ name: 'struct', tracks: [] });
    const p = makeProject(
      [sec('v1', 'Verse', 1, 8), sec('c1', 'Chorus', 9, 4), sec('v2', 'Verse 2', 13, 8), sec('c2', 'Chorus 2', 21, 4)],
      [],
      { key: 4, mode: 'Aeolian', chordGenSettings: { ...base.chordGenSettings!, preserveIdentity: true, variation: 0.2, seed: 9 } },
    );
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 9 });
    expectWellFormed(r, 0, 24 * BT);
    // Identity is asserted the way §15 defines it: shared STRUCTURAL material.
    // Related sections may carry different rhythm realizations (independent
    // harmonic rhythm) and cadential variation, so the lens is the report's
    // foundation-set overlap plus the section-opening anchor — not a naive
    // position-aligned symbol diff.
    const byId = new Map(r.report.sectionFoundationOverlap.map((o) => [`${o.a}|${o.b}`, o.overlap]));
    expect(byId.get('v1|v2') ?? 0).toBeGreaterThanOrEqual(0.6);
    expect(byId.get('c1|c2') ?? 0).toBeGreaterThanOrEqual(0.6);
    // The section-opening anchor: Verse 2 starts on Verse 1's opening harmony.
    const firstOf = (loBars: number, hiBars: number) =>
      r.chords.find((c) => c.startTick >= loBars * BT && c.startTick < hiBars * BT);
    const v1First = firstOf(0, 8);
    const v2First = firstOf(12, 20);
    expect(v1First && v2First ? fid(v1First.symbol, 4, 'Aeolian') : 'x')
      .toBe(v1First && v2First ? fid(v2First.symbol, 4, 'Aeolian') : 'y');
    // Colors are NOT required to be copied (§15) — but foundations clearly are.
    expect(r.report.sectionFoundationOverlap.length).toBeGreaterThan(0);
    for (const o of r.report.sectionFoundationOverlap) expect(o.overlap).toBeGreaterThan(0);
  });
});

describe('Test 8 — locked anchors preserved exactly (spec §18.8, §14)', () => {
  it('keeps locked chords byte-for-byte, including chromatic ones', () => {
    // Bb7b5 and Dbm7 are both chromatic to E Aeolian — they are anchors, not errors.
    const locked = [
      chd('l1', 0, BT, 'F#m7b5', true),
      chd('l2', 3 * BT, 2 * BT, 'Bb7b5', true),
      chd('l3', 8 * BT, BT, 'Dbm7', true),
    ];
    const p = makeProject(verseAndChorus, [
      locked[0],
      chd('u1', BT, 2 * BT, 'Em'),
      locked[1],
      chd('u2', 5 * BT, 3 * BT, 'Am'),
      locked[2],
      chd('u3', 9 * BT, 7 * BT, 'C'),
    ], { key: 4, mode: 'Aeolian' });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 11 });
    for (const l of locked) {
      const kept = r.chords.find((c) => c.id === l.id);
      expect(kept).toBe(l);
      expect(kept?.symbol).toBe(l.symbol);
      expect(kept?.startTick).toBe(l.startTick);
      expect(kept?.durationTicks).toBe(l.durationTicks);
      expect(kept?.locked).toBe(true);
    }
    // Chromatic anchors are anchors, not errors: generation continued around them.
    expect(r.report.generatedChordCount).toBeGreaterThan(0);
    expectWellFormed(r, 0, 16 * BT);
    expect(coversExactly(r.chords, 0, 16 * BT)).toBe(true);
  });
});

describe('Test 9 — partial coverage changes nothing existing (spec §18.9)', () => {
  it('fill-gaps preserves every existing chord by reference', () => {
    const existing = [
      chd('m1', 0, 2 * BT, 'Em9'),
      chd('m2', 5 * BT, 3 * BT, 'Dbmaj7'),
      chd('m3', 12 * BT, 4 * BT, 'B7sus4'),
    ];
    const p = makeProject(verseAndChorus, existing, { key: 4, mode: 'Aeolian' });
    const r = generateChordProgression(p, { scope: { type: 'empty' }, seed: 13 });
    for (const e of existing) expect(r.chords.find((c) => c.id === e.id)).toBe(e);
    expect(r.report.preservedChordCount).toBe(3);
    expectWellFormed(r, 0, 16 * BT);
    expect(coversExactly(r.chords, 0, 16 * BT)).toBe(true);
    // The manual chromatic harmony (Dbmaj7 in E Aeolian) was treated as an
    // anchor, not rejected, and the surrounding gaps were still filled.
    expect(r.report.anchorConstraints.before !== null || r.report.anchorConstraints.after !== null).toBe(true);
  });
});

describe('Test 10 — parser compatibility (spec §18.10)', () => {
  it('every emitted symbol across modes, complexities and borrowings parses', () => {
    const modes = MODE_NAMES;
    let checked = 0;
    for (const mode of modes) {
      for (const complexity of [1, 2, 3] as const) {
        const p = makeProject(verseAndChorus, [], {
          key: 9, mode,
          chordGenSettings: { ...createDefaultProject().chordGenSettings!, complexity, borrowing: 'more', seed: 17 },
        });
        const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 17 });
        for (const c of r.chords) {
          expect(parseChord(c.symbol).ok).toBe(true);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('Test 11 — all 144 tonic/mode combinations (spec §18.11)', () => {
  it('completes with valid symbols and exact coverage everywhere', () => {
    let combos = 0;
    for (let key = 0; key < 12; key++) {
      for (const mode of MODE_NAMES) {
        const p = makeProject(verseAndChorus, [], { key, mode });
        const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 21 });
        expectWellFormed(r, 0, 16 * BT);
        expect(coversExactly(r.chords, 0, 16 * BT)).toBe(true);
        expect(r.report.generatedChordCount).toBeGreaterThan(0);
        combos += 1;
      }
    }
    expect(combos).toBe(144);
  });
});

describe('Test 12 — meter and timing (spec §18.12)', () => {
  it.each([
    [{ numerator: 4, denominator: 4 }],
    [{ numerator: 3, denominator: 4 }],
    [{ numerator: 6, denominator: 8 }],
  ])('covers the song exactly in %j', (ts) => {
    const p = makeProject(verseAndChorus, [], { key: 7, mode: 'Dorian', timeSignature: ts });
    const bt = barTicks(ts);
    const regionEnd = 16 * bt; // Verse 8 + Chorus 8 bars in THIS meter's ticks
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 23 });
    expectWellFormed(r, 0, regionEnd);
    expect(coversExactly(r.chords, 0, regionEnd)).toBe(true);
    // Events sit on real metrical positions of this meter.
    const pulse = 960 * (4 / ts.denominator);
    for (const c of r.chords) {
      const atEdge = c.startTick === 0 || c.startTick + c.durationTicks === regionEnd;
      expect(atEdge || c.durationTicks % pulse === 0).toBe(true);
    }
  });
});

describe('Test 13 — undo/redo stays one atomic action (spec §18.13)', () => {
  function resetStore(project: Project): void {
    useStore.setState({
      project, past: [], future: [], lastCoalesce: null, dirty: false, filePath: null,
      selectedTrackIds: [], selectedSectionId: null, selectedChordId: null,
      toasts: [], genHighlight: null, modal: null,
    });
  }

  it('one Generate click = one history entry restoring chords and seed', () => {
    resetStore(makeProject(verseAndChorus, [], { key: 4, mode: 'Aeolian' }));
    const before = useStore.getState().project;
    const seedBefore = before.chordGenSettings?.seed ?? 1;
    runChordGenerate();
    const after = useStore.getState();
    expect(after.past.length).toBe(1);
    expect(after.project.chords.length).toBeGreaterThan(0);
    expect(after.project.chordGenSettings?.seed).toBe((seedBefore + 1) >>> 0);
    useStore.getState().undo();
    const undone = useStore.getState();
    expect(undone.project.chords).toEqual(before.chords);
    expect(undone.project.chordGenSettings?.seed).toBe(seedBefore);
    useStore.getState().redo();
    expect(useStore.getState().project.chords).toEqual(after.project.chords);
    expect(useStore.getState().project.chordGenSettings?.seed).toBe((seedBefore + 1) >>> 0);
  });
});

describe('Test 14 — original workflow regression (spec §18.14)', () => {
  it('manual entry, validation and the orchestral Generate all keep working', () => {
    const p = makeProject(verseAndChorus, [chd('manual1', 0, 2 * BT, 'Em'), chd('manual2', 2 * BT, 2 * BT, 'Am')], { key: 4, mode: 'Aeolian' });
    expect(validateProject(p).ok).toBe(true);
    // A generated progression is itself a valid project that drives the
    // orchestral generator.
    const r = generateChordProgression(p, { scope: { type: 'empty' }, seed: 31 });
    const withChords: Project = { ...p, chords: r.chords };
    expect(validateProject(withChords).ok).toBe(true);
    const tracks = generate(withChords, { seed: 5, humanize: false, density: 1 });
    const noteCount = tracks.reduce((s, t) => s + t.notes.length, 0);
    expect(noteCount).toBeGreaterThan(0);
    // The manual chords are untouched by fill-gaps generation.
    expect(r.chords.find((c) => c.id === 'manual1')?.symbol).toBe('Em');
  });

  it('full regeneration keeps the manual editor functional on the result', () => {
    const p = makeProject(verseAndChorus, [], { key: 4, mode: 'Aeolian' });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 33 });
    const next = { ...p, chords: r.chords };
    // Section-scoped regeneration on top of generated material still respects
    // the section boundary and produces a valid project.
    const r2 = generateChordProgression(next, { scope: { type: 'section', sectionId: 'b' }, seed: 34 });
    expectWellFormed(r2, 0, 16 * BT);
    expect(coversExactly(r2.chords, 0, 16 * BT)).toBe(true);
    const outside = r.chords.filter((c) => c.startTick < 8 * BT);
    for (const c of outside) {
      const kept = r2.chords.find((x) => x.id === c.id);
      if (kept) {
        expect(kept.symbol).toBe(c.symbol);
        expect(kept.startTick).toBe(c.startTick);
      }
    }
    expect(validateProject({ ...next, chords: r2.chords }).ok).toBe(true);
  });
});

describe('Phase 4.1 structural diagnostics (spec §17)', () => {
  it('reports structural foundations, distinct roots per phrase and cadence realizations', () => {
    const p = makeProject(verseAndChorus, [], { key: 4, mode: 'Aeolian' });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 55 });
    expect(r.report.structuralFoundations.length).toBeGreaterThan(0);
    expect(r.report.structuralFoundations).toContain('E minor');
    expect(r.report.distinctRootsPerPhrase.length).toBeGreaterThan(0);
    for (const n of r.report.distinctRootsPerPhrase) expect(n).toBeGreaterThanOrEqual(1);
    expect(r.report.structuralCadences.length).toBeGreaterThan(0);
    for (const cad of r.report.structuralCadences) {
      expect(typeof cad.intention).toBe('string');
      expect(cad.family === null || typeof cad.family === 'string').toBe(true);
    }
    expect(r.report.sameFoundationRepetitions).toBeLessThan(r.report.generatedChordCount);
    expect(r.report.tonicReinforcementEvents).toBeGreaterThan(0);
    expect(r.report.colorOnlyChanges).toBeLessThanOrEqual(r.report.sameFoundationRepetitions);
  });

  it('merges same-foundation slot runs into sustained events (spec §9)', () => {
    const p = makeProject([sec('a', 'Intro', 1, 4)], [], {
      key: 0, mode: 'Ionian',
      chordGenSettings: { ...createDefaultProject().chordGenSettings!, density: 2, variation: 0, seed: 77 },
    });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 77 });
    const foundations = r.chords.map((c) => fid(c.symbol, 0, 'Ionian'));
    // With merging, consecutive events NEVER share a foundation within a
    // phrase; across a phrase boundary a rearticulation is possible but the
    // total must stay far below the event count.
    let sameAdj = 0;
    for (let i = 1; i < foundations.length; i++) if (foundations[i] === foundations[i - 1]) sameAdj += 1;
    expect(sameAdj).toBeLessThanOrEqual(Math.floor(foundations.length / 3));
    expect(r.report.sameFoundationRepetitions).toBe(sameAdj);
  });
});
