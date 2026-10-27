import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import {
  createDefaultProject, parseChord, projectFromFixture, validateProject, MODES, MODE_NAMES,
  barTicks, beatOffsets, scalePitchClasses, INSTRUMENTS, instrumentRange, type Project,
} from '../src/shared/schema';
import { FAMILY_COLORS } from '../src/theme/tokens';

const SYMBOLS: [string, number[]][] = [
  ['C', [0, 4, 7]], ['Cm', [0, 3, 7]], ['Cmin', [0, 3, 7]], ['C-', [0, 3, 7]], ['Cdim', [0, 3, 6]], ['C°', [0, 3, 6]],
  ['Caug', [0, 4, 8]], ['C+', [0, 4, 8]], ['Csus2', [0, 2, 7]], ['Csus4', [0, 5, 7]], ['Csus', [0, 5, 7]],
  ['C6', [0, 4, 7, 9]], ['Cm6', [0, 3, 7, 9]], ['C7', [0, 4, 7, 10]], ['Cmaj7', [0, 4, 7, 11]], ['CM7', [0, 4, 7, 11]],
  ['CΔ7', [0, 4, 7, 11]], ['Cm7', [0, 3, 7, 10]], ['Cm7b5', [0, 3, 6, 10]], ['Cø', [0, 3, 6, 10]], ['Cdim7', [0, 3, 6, 9]],
  ['CmMaj7', [0, 3, 7, 11]], ['C9', [0, 4, 7, 10, 2]], ['Cmaj9', [0, 4, 7, 11, 2]], ['Cm9', [0, 3, 7, 10, 2]],
  ['C11', [0, 4, 7, 10, 2, 5]], ['C13', [0, 4, 7, 10, 2, 9]], ['Cadd9', [0, 4, 7, 2]], ['Cmadd9', [0, 3, 7, 2]],
  ['C6/9', [0, 4, 7, 9, 2]], ['C7sus4', [0, 5, 7, 10]], ['C7b9', [0, 4, 7, 10, 1]], ['C7#9', [0, 4, 7, 10, 3]],
  ['C7#11', [0, 4, 7, 10, 6]], ['C7b13', [0, 4, 7, 10, 8]], ['C7b5', [0, 4, 6, 10]], ['C7#5', [0, 4, 8, 10]],
  ['C5', [0, 7]], ['Cm(maj7)', [0, 3, 7, 11]], ['C7(b9,#11)', [0, 4, 7, 10, 1, 6]],
  ['C/E', [4, 0, 7]], ['C/G', [7, 0, 4]], ['Am7/G', [7, 9, 0, 4]], ['D/F#', [6, 2, 9]], ['G7/B', [11, 7, 2, 5]],
  ['Bb', [10, 2, 5]], ['F#m7', [6, 9, 1, 4]], ['Ebmaj7', [3, 7, 10, 2]], ['Abadd9', [8, 0, 3, 10]], ['C#dim7', [1, 4, 7, 10]],
  ['Dbmaj7/F', [5, 1, 8, 0]], ['Esus2', [4, 6, 11]], ['Gb', [6, 10, 1]], ['Bm7b5', [11, 2, 5, 9]],
];

describe('chord parser', () => {
  it(`parses ${SYMBOLS.length} realistic chord symbols including slash chords`, () => {
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(40);
    for (const [sym, pcs] of SYMBOLS) {
      const r = parseChord(sym);
      if (!r.ok) throw new Error(`${sym}: ${r.error}`);
      expect(new Set(r.chord.pitchClasses), sym).toEqual(new Set(pcs));
      if (sym.includes('/') && sym !== 'C6/9') expect(r.chord.pitchClasses[0], `${sym} bass first`).toBe(pcs[0]);
    }
  });
  it('returns root, quality, extensions and bass', () => {
    const r = parseChord('Am7/G');
    expect(r.ok && r.chord.root).toBe(9);
    expect(r.ok && r.chord.quality).toBe('m7');
    expect(r.ok && r.chord.bass).toBe(7);
    const e = parseChord('C7b9');
    expect(e.ok && e.chord.extensions).toEqual(['b9']);
  });
  it('returns error values for invalid input and never throws', () => {
    for (const bad of ['', 'H7', 'Cxyz', '7', 'C/', 'Cmaj7/Q', 'C#m7b5zz', 'Cadd99']) {
      const r = parseChord(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
    expect(() => parseChord(undefined as unknown as string)).not.toThrow();
  });
});

describe('modes & meter', () => {
  it('has all modes as interval arrays', () => {
    expect(MODE_NAMES).toHaveLength(12);
    expect(scalePitchClasses(2, 'Dorian')).toEqual([2, 4, 5, 7, 9, 11, 0]);
    expect(MODES['Whole Tone']).toHaveLength(6);
    expect(MODES['Diminished (Half-Whole)']).toHaveLength(8);
  });
  it('computes bar and beat ticks for 4/4, 3/4, 6/8, 5/4', () => {
    expect(barTicks({ numerator: 4, denominator: 4 })).toBe(3840);
    expect(barTicks({ numerator: 3, denominator: 4 })).toBe(2880);
    expect(barTicks({ numerator: 6, denominator: 8 })).toBe(2880);
    expect(barTicks({ numerator: 5, denominator: 4 })).toBe(4800);
    expect(beatOffsets({ numerator: 6, denominator: 8 })).toEqual([0, 1440]);
    expect(beatOffsets({ numerator: 5, denominator: 4 })).toEqual([0, 960, 1920, 2880, 3840]);
  });
});

describe('factory', () => {
  it('creates the default tracks in order with family colors', () => {
    const p = createDefaultProject();
    expect(p.tracks.map((t) => t.name)).toEqual(INSTRUMENTS.map((i) => i.name));
    expect(p.tracks).toHaveLength(21);
    for (const t of p.tracks) expect(t.color).toBe(FAMILY_COLORS[t.family]);
    const v1 = p.tracks.find((t) => t.name === 'Violins I')!;
    expect([v1.lowestNote, v1.highestNote]).toEqual([55, 96]);
    expect(instrumentRange(INSTRUMENTS.find((i) => i.name === 'Harp')!)).toEqual([23, 104]);
    expect(p.tracks.find((t) => t.name === 'Snare')!.lowestNote).toBe(38);
    expect(validateProject(p).ok).toBe(true);
  });
});

describe('validation', () => {
  const base = (): Project => projectFromFixture(fixture as Partial<Project>);
  it('the fixture validates (raw and expanded)', () => {
    expect(validateProject(fixture).errors).toEqual([]);
    expect(validateProject(base()).errors).toEqual([]);
  });
  it('two tracks sharing one library group validate', () => {
    const p = base();
    p.libraryGroups.push({ id: 'g1', name: 'Strings', pluginId: null, pluginState: null });
    p.tracks[3].libraryGroupId = 'g1'; p.tracks[3].midiChannel = 1;
    p.tracks[4].libraryGroupId = 'g1'; p.tracks[4].midiChannel = 2;
    expect(validateProject(p).ok).toBe(true);
  });
  it('a missing library group fails with a clear message', () => {
    const p = base();
    p.tracks[3].libraryGroupId = 'nope';
    const r = validateProject(p);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/Violins I.*library group "nope".*does not exist/);
  });
  it('reports bad channels, ranges, notes outside range and past the end', () => {
    const p = base();
    p.tracks[3].midiChannel = 17;
    p.tracks[4].volume = 3;
    p.tracks[5].notes = [{ pitch: 20, startTick: 0, durationTicks: 100, velocity: 90 }];
    p.tracks[6].notes = [{ pitch: 40, startTick: 61000, durationTicks: 2000, velocity: 90 }];
    p.tracks[7].notes = [{ pitch: 50, startTick: 0, durationTicks: 0, velocity: 90 }];
    const msgs = validateProject(p).errors.map((e) => e.message).join('\n');
    expect(msgs).toMatch(/MIDI channel must be 1–16/);
    expect(msgs).toMatch(/volume must be/);
    expect(msgs).toMatch(/outside the track range/);
    expect(msgs).toMatch(/past the project end/);
    expect(msgs).toMatch(/zero or negative length/);
  });
});
