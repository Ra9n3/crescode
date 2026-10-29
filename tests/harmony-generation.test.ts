/**
 * Chord progression generation tests (Phase 4, spec §17).
 *
 * The engine and its scope/coverage machinery are framework-free, so most
 * groups run as pure function tests; the undo/redo group drives the real
 * Zustand store through the Chords-track Generate action (runChordGenerate).
 * All numbers are ticks at 960 PPQ; bars use the shared meter utilities.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { generateChordProgression } from '../src/engine/harmony/generation';
import { resolveScopePlan } from '../src/engine/harmony/coverage';
import { parseChord } from '../src/shared/schema/chords';
import { barTicks } from '../src/shared/schema/meter';
import { runChordGenerate, __setChordGenerator } from '../src/lib/chordGenUi';
import { useStore } from '../src/store/store';
import {
  createDefaultProject, isChordLocked, projectFromFixture, validateProject,
  type Chord, type ModeName, type Project, type Section, type TimeSignature,
} from '../src/shared/schema';
import { generate } from '../src/engine/generate';

const BT = 960 * 4; // 4/4 bar

function makeProject(sections: Section[], chords: Chord[], opts: Partial<Project> = {}): Project {
  const base = projectFromFixture({ name: 'GenTest', tracks: [] });
  return { ...base, sections, chords, ...opts };
}
const sec = (id: string, name: string, startBar: number, lengthBars: number, energy?: number): Section =>
  ({ id, name, startBar, lengthBars, ...(energy !== undefined ? { energy } : {}) });
const chd = (id: string, startTick: number, durationTicks: number, symbol = 'C', locked?: boolean): Chord =>
  ({ id, symbol, startTick, durationTicks, ...(locked !== undefined ? { locked } : {}) });

/** Sort by start and verify the invariants every result must satisfy. */
function expectWellFormed(chords: Chord[], regionStart = 0, regionEnd?: number): void {
  const sorted = [...chords].sort((a, b) => a.startTick - b.startTick);
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

/** Exact coverage of [start, end) by merged chord intervals. */
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

beforeEach(() => { __setChordGenerator(null); });

/* ------------------------------------------------------------------ */

describe('Test 1 — empty song generation (spec §17.1)', () => {
  it('generates complete coverage across a sectioned empty arrangement', () => {
    const p = makeProject([sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)], []);
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 11 });
    expect(r.report.generatedChordCount).toBeGreaterThan(0);
    expect(r.report.preservedChordCount).toBe(0);
    expectWellFormed(r.chords, 0, 16 * BT);
    expect(coversExactly(r.chords, 0, 16 * BT)).toBe(true);
  });

  it('generates across the default 8-bar span for a project with no sections and no chords', () => {
    const p = createDefaultProject();
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 3 });
    expect(r.chords.length).toBeGreaterThan(0);
    expectWellFormed(r.chords, 0, 8 * BT);
    expect(coversExactly(r.chords, 0, 8 * BT)).toBe(true);
  });
});

describe('Test 2 — partial coverage fills only the gaps (spec §17.2)', () => {
  it('fills gaps before, between and after existing chords without touching them', () => {
    const existing = [
      chd('m1', 2 * BT, 2 * BT, 'Am'), // gap [0, 2BT) before
      chd('m2', 6 * BT, 2 * BT, 'F'),  // gap [4BT, 6BT) between
    ];
    const p = makeProject([sec('a', 'Verse', 1, 8)], existing); // span 8 bars
    const r = generateChordProgression(p, { scope: { type: 'empty' }, seed: 5 });
    // Every existing chord object survives by reference, byte for byte.
    for (const e of existing) {
      const kept = r.chords.find((c) => c.id === e.id);
      expect(kept).toBe(e);
    }
    expect(r.report.preservedChordCount).toBe(2);
    expect(r.report.generatedChordCount).toBeGreaterThan(0);
    expectWellFormed(r.chords, 0, 8 * BT);
    expect(coversExactly(r.chords, 0, 8 * BT)).toBe(true);
    // Nothing generated overlaps the preserved intervals.
    for (const g of r.chords) {
      if (existing.some((e) => e.id === g.id)) continue;
      for (const e of existing) {
        const gEnd = g.startTick + g.durationTicks;
        const eEnd = e.startTick + e.durationTicks;
        expect(g.startTick < eEnd && gEnd > e.startTick).toBe(false);
      }
    }
  });

  it('does not resize anchors to make generation easier (spec §5)', () => {
    const existing = [chd('x1', 0, 2 * BT, 'Dm'), chd('x2', 6 * BT, 2 * BT, 'G')];
    const p = makeProject([sec('a', 'Verse', 1, 8)], existing);
    const r = generateChordProgression(p, { scope: { type: 'empty' }, seed: 9 });
    expect(r.chords.find((c) => c.id === 'x1')?.durationTicks).toBe(2 * BT);
    expect(r.chords.find((c) => c.id === 'x2')?.startTick).toBe(6 * BT);
  });
});

describe('Test 3 — full regeneration preserves locked chords (spec §17.3)', () => {
  it('replaces every unlocked chord and keeps locked ones exactly', () => {
    const chords = [
      chd('l1', 0, BT, 'Dm', true),
      chd('u1', BT, BT, 'G'),
      chd('u2', 2 * BT, BT, 'C'),
      chd('l2', 3 * BT, BT, 'Am', true),
      chd('u3', 4 * BT, 4 * BT, 'F'),
    ];
    const p = makeProject([sec('a', 'Verse', 1, 8)], chords);
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 21 });
    expect(r.chords.find((c) => c.id === 'l1')).toBe(chords[0]);
    expect(r.chords.find((c) => c.id === 'l2')).toBe(chords[3]);
    for (const id of ['u1', 'u2', 'u3']) {
      expect(r.chords.some((c) => c.id === id)).toBe(false);
    }
    expect(r.report.preservedChordCount).toBe(2);
    expectWellFormed(r.chords, 0, 8 * BT);
    expect(coversExactly(r.chords, 0, 8 * BT)).toBe(true);
    // Generated events never overlap the locked anchors.
    for (const g of r.chords) {
      if (g.id === 'l1' || g.id === 'l2') continue;
      for (const l of [chords[0], chords[3]]) {
        expect(g.startTick < l.startTick + l.durationTicks
          && g.startTick + g.durationTicks > l.startTick).toBe(false);
      }
    }
  });
});

describe('Test 4 — section regeneration is isolated (spec §17.4)', () => {
  it('regenerates only the selected section and leaves everything else identical', () => {
    const chords = [
      chd('v1', 0, BT, 'Dm'), chd('v2', BT, BT, 'G'), chd('v3', 2 * BT, 2 * BT, 'Bb'),
      chd('c1', 4 * BT, BT, 'C'), chd('c2', 5 * BT, 3 * BT, 'Am'),
    ];
    const p = makeProject([sec('a', 'Verse', 1, 4), sec('b', 'Chorus', 5, 4)], chords);
    const before = [...p.chords];
    const r = generateChordProgression(p, { scope: { type: 'section', sectionId: 'b' }, seed: 2 });
    // Outside the section: identical objects, untouched.
    for (const c of before.slice(0, 3)) expect(r.chords.find((x) => x.id === c.id)).toBe(c);
    // Inside: replaced (both chorus chords were unlocked and fully inside).
    expect(r.chords.some((c) => c.id === 'c1' || c.id === 'c2')).toBe(false);
    expectWellFormed(r.chords, 0, 8 * BT);
    expect(coversExactly(r.chords, 0, 8 * BT)).toBe(true);
    expect(r.report.sectionsAffected).toEqual(['b']);
  });

  it('an empty selection result generates nothing and preserves everything', () => {
    const chords = [chd('l1', 4 * BT, 4 * BT, 'Dm', true)];
    const p = makeProject([sec('a', 'Verse', 1, 4), sec('b', 'Chorus', 5, 4)], chords);
    const r = generateChordProgression(p, { scope: { type: 'section', sectionId: 'b' }, seed: 2 });
    expect(r.report.generatedChordCount).toBe(0);
    expect(r.chords).toEqual(p.chords);
    expect(r.report.warnings.length).toBe(0);
  });
});

describe('Test 5 — manual chromatic anchors (spec §17.5, §11)', () => {
  it('fills around an unlocked manual chromatic chord without changing or rejecting it', () => {
    // Bbmaj7 is non-diatonic in D Dorian — an established manual anchor.
    const existing = [chd('a1', 2 * BT, 2 * BT, 'Bbmaj7'), chd('a2', 6 * BT, 2 * BT, 'G')];
    const p = makeProject([sec('a', 'Verse', 1, 8)], existing, { key: 2, mode: 'Dorian' });
    const r = generateChordProgression(p, { scope: { type: 'empty' }, seed: 4 });
    expect(r.chords.find((c) => c.id === 'a1')).toBe(existing[0]);
    expect(r.report.generatedChordCount).toBeGreaterThan(0);
    expectWellFormed(r.chords, 0, 8 * BT);
    expect(coversExactly(r.chords, 0, 8 * BT)).toBe(true);
  });

  it('keeps a locked chromatic chord through full regeneration and bridges into it', () => {
    const chords = [chd('c1', 0, BT, 'Dm'), chd('chroma', BT, 2 * BT, 'Bbmaj7', true), chd('c2', 3 * BT, BT, 'C')];
    const p = makeProject([sec('a', 'Verse', 1, 4)], chords, { key: 2, mode: 'Dorian' });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 6 });
    expect(r.chords.find((c) => c.id === 'chroma')).toBe(chords[1]);
    expectWellFormed(r.chords, 0, 4 * BT);
    expect(coversExactly(r.chords, 0, 4 * BT)).toBe(true);
  });
});

describe('Test 6 — all twelve modes (spec §17.6)', () => {
  const modes: ModeName[] = [
    'Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian',
    'Harmonic Minor', 'Melodic Minor', 'Whole Tone', 'Diminished (Half-Whole)', 'Diminished (Whole-Half)',
  ];
  for (const mode of modes) {
    it(`generates valid harmony in ${mode}`, () => {
      const p = makeProject([sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 4)], [], { key: 2, mode });
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 13 });
      expect(r.report.generatedChordCount).toBeGreaterThan(0);
      expect(r.chords.every((c) => parseChord(c.symbol).ok)).toBe(true);
      expectWellFormed(r.chords, 0, 12 * BT);
      expect(coversExactly(r.chords, 0, 12 * BT)).toBe(true);
    });
  }
});

describe('Test 7 — all 144 tonic/mode combinations (spec §17.7)', () => {
  const modes: ModeName[] = [
    'Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian',
    'Harmonic Minor', 'Melodic Minor', 'Whole Tone', 'Diminished (Half-Whole)', 'Diminished (Whole-Half)',
  ];
  it('completes with valid symbols and exact coverage everywhere', () => {
    let runs = 0;
    for (let key = 0; key < 12; key++) {
      for (const mode of modes) {
        const p = makeProject([sec('a', 'Verse', 1, 2), sec('b', 'Chorus', 3, 2)], [], { key, mode });
        const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 7 });
        runs++;
        expect(r.chords.length).toBeGreaterThan(0);
        for (const c of r.chords) expect(parseChord(c.symbol).ok).toBe(true);
        expectWellFormed(r.chords, 0, 4 * BT);
        expect(coversExactly(r.chords, 0, 4 * BT)).toBe(true);
      }
    }
    expect(runs).toBe(144);
  }, 30000);
});

describe('Test 8 — odd section lengths (spec §17.8)', () => {
  for (const bars of [1, 2, 3, 5, 7, 9, 11, 13]) {
    it(`covers a ${bars}-bar section exactly with valid durations`, () => {
      const p = makeProject([sec('a', 'Verse', 1, bars)], []);
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 17 });
      expect(r.chords.length).toBeGreaterThan(0);
      expectWellFormed(r.chords, 0, bars * BT);
      expect(coversExactly(r.chords, 0, bars * BT)).toBe(true);
    });
  }
});

describe('Test 9 — different meters (spec §17.9)', () => {
  const cases: Array<{ ts: TimeSignature; bars: number }> = [
    { ts: { numerator: 4, denominator: 4 }, bars: 8 },
    { ts: { numerator: 3, denominator: 4 }, bars: 6 },
    { ts: { numerator: 6, denominator: 8 }, bars: 4 },
  ];
  for (const { ts, bars } of cases) {
    it(`generates correct tick math in ${ts.numerator}/${ts.denominator}`, () => {
      const bt = barTicks(ts);
      const p = makeProject([sec('a', 'Verse', 1, bars), sec('b', 'Chorus', bars + 1, 2)], [], { timeSignature: ts });
      const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 19 });
      expectWellFormed(r.chords, 0, (bars + 2) * bt);
      expect(coversExactly(r.chords, 0, (bars + 2) * bt)).toBe(true);
      // Chord slots respect the pulse grid (duration is a multiple of the
      // denominator unit), except edge slots clipped to target boundaries.
      const pulse = (960 * 4) / ts.denominator;
      for (const c of r.chords) {
        const edgeStart = c.startTick === 0 || c.startTick === bars * bt;
        const edgeEnd = c.startTick + c.durationTicks === (bars + 2) * bt;
        expect(edgeStart || edgeEnd || c.durationTicks % pulse === 0).toBe(true);
      }
    });
  }
});

describe('Test 10 — repeated sections preserve recognizable identity (spec §17.10)', () => {
  const fourSections = [
    sec('v1', 'Verse', 1, 8), sec('c1', 'Chorus', 9, 4),
    sec('v2', 'Verse 2', 13, 8), sec('c2', 'Chorus 2', 21, 4),
  ];
  const overlapAt = (chords: Chord[], a: [number, number], b: [number, number]): number => {
    const inSpan = (c: Chord, s: number, e: number) => c.startTick >= s * BT && c.startTick < e * BT;
    const xa = chords.filter((c) => inSpan(c, a[0], a[1])).map((c) => c.symbol);
    const xb = chords.filter((c) => inSpan(c, b[0], b[1])).map((c) => c.symbol);
    if (!xa.length || !xb.length) return 0;
    let hits = 0;
    for (let i = 0; i < Math.min(xa.length, xb.length); i++) if (xa[i] === xb[i]) hits++;
    return hits / Math.min(xa.length, xb.length);
  };

  it('Verse 2 / Chorus 2 reuse Verse 1 / Chorus 1 material when preserveIdentity is on', () => {
    const base = projectFromFixture({ name: 'rep', tracks: [] });
    const p = makeProject(fourSections, [], {
      key: 2, mode: 'Dorian',
      chordGenSettings: { ...base.chordGenSettings!, preserveIdentity: true, variation: 0.15, seed: 5 },
    });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 5 });
    expectWellFormed(r.chords, 0, 24 * BT);
    expect(overlapAt(r.chords, [0, 8], [12, 20])).toBeGreaterThanOrEqual(0.8);
    expect(overlapAt(r.chords, [8, 12], [20, 24])).toBeGreaterThanOrEqual(0.8);
  });

  it('identity weakens into development when preserveIdentity is off', () => {
    const base = projectFromFixture({ name: 'rep', tracks: [] });
    const p = makeProject(fourSections, [], {
      key: 2, mode: 'Dorian',
      chordGenSettings: { ...base.chordGenSettings!, preserveIdentity: false, variation: 0.5, seed: 5 },
    });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 5 });
    expect(overlapAt(r.chords, [0, 8], [12, 20])).toBeLessThanOrEqual(0.4);
  });

  it('related sections of different lengths adapt shared material to valid timing', () => {
    const base = projectFromFixture({ name: 'rep', tracks: [] });
    const p = makeProject([sec('c1', 'Chorus', 1, 4), sec('c2', 'Chorus 2', 5, 6)], [], {
      key: 2, mode: 'Dorian',
      chordGenSettings: { ...base.chordGenSettings!, preserveIdentity: true, variation: 0.15, seed: 5 },
    });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 5 });
    expectWellFormed(r.chords, 0, 10 * BT);
    expect(coversExactly(r.chords, 0, 10 * BT)).toBe(true);
    const c1 = r.chords.filter((c) => c.startTick < 4 * BT).map((c) => c.symbol);
    const c2 = r.chords.filter((c) => c.startTick >= 4 * BT).map((c) => c.symbol);
    const shared = c2.filter((s) => c1.includes(s)).length;
    expect(shared / Math.max(1, c2.length)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('Test 11 — seed determinism and variation (spec §17.11, §13)', () => {
  const song = () => makeProject(
    [sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8), sec('c', 'Bridge', 17, 4), sec('d', 'Chorus 2', 21, 8)],
    [], { key: 9, mode: 'Aeolian' },
  );

  it('identical inputs and seed produce byte-identical results', () => {
    const a = generateChordProgression(song(), { scope: { type: 'all' }, seed: 777 });
    const b = generateChordProgression(song(), { scope: { type: 'all' }, seed: 777 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce valid variations when alternatives exist', () => {
    const distinct = new Set<string>();
    for (let s = 0; s < 8; s++) {
      const r = generateChordProgression(song(), { scope: { type: 'all' }, seed: s * 1000 });
      distinct.add(r.chords.map((c) => c.symbol).join('>'));
      expectWellFormed(r.chords, 0, 28 * BT);
    }
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  it('the engine never mutates the input project', () => {
    const p = song();
    const snapshot = JSON.stringify(p);
    generateChordProgression(p, { scope: { type: 'all' }, seed: 1 });
    generateChordProgression(p, { scope: { type: 'section', sectionId: 'b' }, seed: 2 });
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe('Test 12 — undo/redo through the Generate action (spec §17.12, §15)', () => {
  function resetStore(project: Project): void {
    useStore.setState({
      project, past: [], future: [], lastCoalesce: null, dirty: false, filePath: null,
      selectedTrackIds: [], selectedSectionId: null, selectedChordId: null,
      toasts: [], genHighlight: null, modal: null,
    });
  }

  beforeEach(() => {
    // Fully covered song → Generate detects the 'all' (regenerate) scope;
    // k1 is locked, k2/k3 are unlocked and eligible for replacement.
    resetStore(makeProject(
      [sec('a', 'Verse', 1, 4), sec('b', 'Chorus', 5, 4)],
      [chd('k1', 0, BT, 'Dm', true), chd('k2', BT, 3 * BT, 'G'), chd('k3', 4 * BT, 4 * BT, 'C')],
    ));
  });

  it('one Generate click = one history entry; undo restores chords + seed; redo restores both', () => {
    const before = useStore.getState().project;
    const seedBefore = before.chordGenSettings?.seed ?? 1;
    runChordGenerate();
    const after = useStore.getState();
    expect(after.past.length).toBe(1);
    expect(after.project.chords.find((c) => c.id === 'k1')).toBe(before.chords[0]);
    expect(after.project.chords.some((c) => c.id === 'k2')).toBe(false); // unlocked → replaced
    expect(after.project.chords.some((c) => c.id === 'k3')).toBe(false);
    expect(after.project.chordGenSettings?.seed).toBe((seedBefore + 1) >>> 0);

    useStore.getState().undo();
    const undone = useStore.getState();
    expect(undone.project.chords).toEqual(before.chords);
    expect(undone.project.chordGenSettings?.seed).toBe(seedBefore);

    useStore.getState().redo();
    const redone = useStore.getState();
    expect(redone.project.chords).toEqual(after.project.chords);
    expect(redone.project.chordGenSettings?.seed).toBe((seedBefore + 1) >>> 0);
    expect(redone.past.length).toBe(1);
  });

  it('section-scoped generation through the store also participates in undo', () => {
    const before = useStore.getState().project;
    useStore.getState().set({ selectedSectionId: 'b' });
    runChordGenerate();
    expect(useStore.getState().past.length).toBe(1);
    // Verse chords untouched; section selection intact after generation.
    expect(useStore.getState().project.chords.find((c) => c.id === 'k1')).toBe(before.chords[0]);
    expect(useStore.getState().selectedSectionId).toBe('b');
    useStore.getState().undo();
    expect(useStore.getState().project.chords).toEqual(before.chords);
  });

  it('a declined run (nothing eligible) leaves chords and seed untouched', () => {
    const locked = makeProject([sec('a', 'Verse', 1, 4)], [chd('L', 0, 4 * BT, 'Dm', true)]);
    resetStore(locked);
    const seedBefore = locked.chordGenSettings?.seed ?? 1;
    runChordGenerate(); // section fully locked → nothing eligible
    expect(useStore.getState().project).toBe(locked);
    expect(useStore.getState().project.chordGenSettings?.seed).toBe(seedBefore);
    expect(useStore.getState().toasts.some((t) => t.kind === 'info')).toBe(true);
  });
});

describe('Test 13 — parser compatibility sweep (spec §17.13)', () => {
  it('every emitted symbol across modes, complexities and borrowings parses', () => {
    const modes: ModeName[] = ['Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'Aeolian', 'Locrian', 'Harmonic Minor', 'Melodic Minor', 'Whole Tone', 'Diminished (Half-Whole)', 'Diminished (Whole-Half)'];
    const symbols = new Set<string>();
    for (const mode of modes) {
      for (const complexity of [1, 2, 3] as const) {
        for (const borrowing of ['none', 'some', 'more'] as const) {
          const base = projectFromFixture({ name: 'sweep', tracks: [] });
          const p = makeProject([sec('a', 'Verse', 1, 4), sec('b', 'Build-Up', 5, 4)], [], {
            key: 4, mode,
            chordGenSettings: { ...base.chordGenSettings!, complexity, borrowing, variation: 0.8, seed: 31 },
          });
          const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 31 });
          for (const c of r.chords) {
            const parsed = parseChord(c.symbol);
            expect(parsed.ok).toBe(true);
            if (parsed.ok) symbols.add(c.symbol);
          }
        }
      }
    }
    expect(symbols.size).toBeGreaterThan(10);
  });
});

describe('Test 14 — boundary safety (spec §17.14, §12)', () => {
  it('locked chord crossing the section start is preserved; generation fills around it', () => {
    const chords = [
      chd('cross', 2 * BT, 4 * BT, 'G', true), // bars 3-6, section b = bars 5-8
    ];
    const p = makeProject([sec('a', 'Verse', 1, 4), sec('b', 'Chorus', 5, 4)], chords);
    const r = generateChordProgression(p, { scope: { type: 'section', sectionId: 'b' }, seed: 3 });
    expect(r.chords.find((c) => c.id === 'cross')).toBe(chords[0]);
    expectWellFormed(r.chords, 0, 8 * BT);
    // No generated event overlaps the locked chord.
    for (const g of r.chords) {
      if (g.id === 'cross') continue;
      expect(g.startTick < 6 * BT && g.startTick + g.durationTicks > 2 * BT).toBe(false);
    }
    // The section's tail is filled; bars outside the scope stay untouched.
    expect(coversExactly(r.chords, 2 * BT, 8 * BT)).toBe(true);
  });

  it('unlocked chord crossing INTO the section is protected, not resized or deleted', () => {
    const chords = [chd('in', 3 * BT, 3 * BT, 'Am')]; // bars 4-6, unlocked, crosses in
    const p = makeProject([sec('a', 'Verse', 1, 4), sec('b', 'Chorus', 5, 4)], chords);
    const plan = resolveScopePlan(p, { type: 'section', sectionId: 'b' });
    expect(plan.removed).toEqual([]); // starts outside → not eligible
    expect(plan.keep[0]).toBe(chords[0]);
    const r = generateChordProgression(p, { scope: { type: 'section', sectionId: 'b' }, seed: 3 });
    expect(r.chords.find((c) => c.id === 'in')).toBe(chords[0]);
    expectWellFormed(r.chords, 0, 8 * BT);
  });

  it('unlocked chord starting inside but crossing OUT is preserved in full', () => {
    const chords = [chd('out', 4 * BT, 5 * BT, 'F')]; // bars 5-9, crosses section end (8 bars)
    const p = makeProject([sec('a', 'Verse', 1, 4), sec('b', 'Chorus', 5, 4)], chords);
    const plan = resolveScopePlan(p, { type: 'section', sectionId: 'b' });
    expect(plan.removed).toEqual([]);
    const r = generateChordProgression(p, { scope: { type: 'section', sectionId: 'b' }, seed: 3 });
    expect(r.chords.find((c) => c.id === 'out')).toBe(chords[0]);
    expect(r.report.generatedChordCount).toBe(0);
  });

  it('locked chords occupying partial generation intervals never produce overlaps', () => {
    const chords = [
      chd('l1', 0, 2 * BT, 'Dm', true),   // bars 1-2 locked
      chd('l2', 5 * BT, BT, 'G', true),   // bar 6 locked (middle of section b)
      chd('u1', BT, BT, 'C'),             // bar 2 unlocked → replaced
    ];
    const p = makeProject([sec('a', 'Verse', 1, 4), sec('b', 'Chorus', 5, 4)], chords);
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 8 });
    expect(r.chords.find((c) => c.id === 'l1')).toBe(chords[0]);
    expect(r.chords.find((c) => c.id === 'l2')).toBe(chords[1]);
    expectWellFormed(r.chords, 0, 8 * BT);
    expect(coversExactly(r.chords, 0, 8 * BT)).toBe(true);
  });
});

describe('Test 15 — regression: manual workflow, validation, orchestral generator (spec §17.15)', () => {
  it('a project with generated chords validates and drives the orchestral generator', () => {
    const p = makeProject([sec('a', 'Verse', 1, 8), sec('b', 'Chorus', 9, 8)], [], { key: 2, mode: 'Dorian' });
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 10 });
    const withChords = { ...p, chords: r.chords };
    const v = validateProject(withChords);
    expect(v.ok).toBe(true);
    // The orchestral generator consumes the progression without error.
    const tracks = generate(withChords, { seed: 4, density: 1, humanize: false });
    expect(tracks.length).toBe(withChords.tracks.length);
    const withNotes = tracks.filter((t) => t.notes.length > 0);
    expect(withNotes.length).toBeGreaterThan(0);
  });

  it('manual chord editing actions still work after a generation', () => {
    const p = makeProject([sec('a', 'Verse', 1, 8)], []);
    resetForManual(p);
    function resetForManual(project: Project): void {
      useStore.setState({
        project, past: [], future: [], lastCoalesce: null, dirty: false, filePath: null,
        selectedTrackIds: [], selectedSectionId: null, selectedChordId: null,
        toasts: [], genHighlight: null, modal: null,
      });
    }
    runChordGenerate();
    const s = useStore.getState();
    const id = s.addChord({ symbol: 'Bb7', startTick: 8 * BT, durationTicks: BT, locked: true });
    expect(useStore.getState().project.chords.some((c) => c.id === id && c.locked)).toBe(true);
    useStore.getState().updateChord(id, { symbol: 'A7' });
    expect(useStore.getState().project.chords.find((c) => c.id === id)?.symbol).toBe('A7');
    useStore.getState().deleteChord(id);
    expect(useStore.getState().project.chords.some((c) => c.id === id)).toBe(false);
    useStore.getState().undo();
    expect(useStore.getState().project.chords.some((c) => c.id === id)).toBe(true);
  });
});

describe('Performance (spec §18 — engineering targets, generous asserts)', () => {
  it('64-bar song: well under the interactive budget', () => {
    const sections = [
      sec('a', 'Verse', 1, 16), sec('b', 'Chorus', 17, 16),
      sec('c', 'Verse 2', 33, 16), sec('d', 'Chorus 2', 49, 16),
    ];
    const p = makeProject(sections, [], { key: 2, mode: 'Dorian' });
    const t0 = performance.now();
    generateChordProgression(p, { scope: { type: 'all' }, seed: 42 });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
  });

  it('200-bar project: completes comfortably', () => {
    const sections: Section[] = [];
    const names = ['Verse', 'Chorus', 'Bridge', 'Chorus'];
    for (let b = 0; b < 200;) {
      const len = 8;
      sections.push(sec(`s${b}`, names[sections.length % 4], b + 1, len));
      b += len;
    }
    const p = makeProject(sections, [], { key: 2, mode: 'Dorian' });
    const t0 = performance.now();
    const r = generateChordProgression(p, { scope: { type: 'all' }, seed: 42 });
    const ms = performance.now() - t0;
    expect(coversExactly(r.chords, 0, 200 * BT)).toBe(true);
    expect(ms).toBeLessThan(2000);
  });
});
