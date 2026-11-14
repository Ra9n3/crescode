/**
 * Strings V1 Stage 1 — the classic string regression fingerprint.
 *
 * tests/strings-classic-fingerprints.json was written from the classic
 * engine before any Strings V1 integration existed. This test only reads
 * it: classic output (the option omitted) must still match, cell by cell.
 */
import { describe, expect, it } from 'vitest';
import {
  STRING_FIXTURES, STRING_TEMPLATES, composeStringCell, fingerprintCells, fingerprintResult, loadFingerprintDocument, stringCellId,
} from './strings-v1-support';

const document = loadFingerprintDocument();
const cells = fingerprintCells();

describe('classic string fingerprints', () => {
  it('cover six templates, three fixtures, two takes and four further configurations per template', () => {
    expect(document.stringsComposition).toBe('classic');
    expect(Object.keys(document.cells).sort()).toEqual(cells.map(stringCellId).sort());
    expect(cells).toHaveLength(60);
    for (const template of STRING_TEMPLATES) {
      for (const fixture of STRING_FIXTURES) {
        expect(new Set(cells.filter((c) => c.template === template && c.fixture === fixture && c.seed === 1 && c.density === undefined).map((c) => c.take)).size).toBeGreaterThanOrEqual(2);
      }
      const own = cells.filter((c) => c.template === template);
      expect(own.some((c) => c.seed !== 1)).toBe(true);
      expect(own.some((c) => c.density !== undefined)).toBe(true);
      expect(own.some((c) => c.humanize === false)).toBe(true);
      expect(own.some((c) => c.moments === false)).toBe(true);
    }
  });

  it('record notes, timing, pitch, velocity, articulation, controller lanes and the exported file of every string track', () => {
    const symphony = document.cells['symphony__three-chorus-40bars__seed1__take0'];
    expect(Object.values(symphony.strings).map((t) => t.role).sort()).toEqual(['basses', 'cellosBasses', 'violas', 'violins1', 'violins2']);
    for (const track of Object.values(symphony.strings)) {
      expect(track.notes).toBeGreaterThan(0);
      expect(track.noteHash).toMatch(/^[0-9a-f]{20}$/);
      expect(track.ccHash).toMatch(/^[0-9a-f]{20}$/);
      expect(track.exportHash).toMatch(/^[0-9a-f]{20}$/);
      expect(track.ccLanes).toContain(1);
      expect(Object.keys(track.articulations).length).toBeGreaterThan(0);
    }
  });

  it('is sensitive to a one-unit change of pitch, timing, velocity, articulation or a controller point', () => {
    const cell = cells.find((c) => c.template === 'chamber')!;
    const { project, result } = composeStringCell(cell, undefined);
    const base = fingerprintResult(project, result);
    const id = Object.keys(base.strings).find((k) => base.strings[k].notes > 0)!;
    const mutate = (change: (track: (typeof result.tracks)[number]) => (typeof result.tracks)[number]) =>
      fingerprintResult(project, { ...result, tracks: result.tracks.map((t) => (t.id === id ? change(t) : t)), plan: result.plan } as typeof result).strings[id];
    const first = <T,>(list: T[], f: (x: T) => T): T[] => list.map((x, i) => (i === 0 ? f(x) : x));
    expect(mutate((t) => ({ ...t, notes: first(t.notes, (n) => ({ ...n, pitch: n.pitch + 1 })) })).noteHash).not.toBe(base.strings[id].noteHash);
    expect(mutate((t) => ({ ...t, notes: first(t.notes, (n) => ({ ...n, startTick: n.startTick + 1 })) })).noteHash).not.toBe(base.strings[id].noteHash);
    expect(mutate((t) => ({ ...t, notes: first(t.notes, (n) => ({ ...n, durationTicks: n.durationTicks + 1 })) })).noteHash).not.toBe(base.strings[id].noteHash);
    expect(mutate((t) => ({ ...t, notes: first(t.notes, (n) => ({ ...n, velocity: n.velocity + 1 })) })).noteHash).not.toBe(base.strings[id].noteHash);
    expect(mutate((t) => ({ ...t, notes: first(t.notes, (n) => ({ ...n, articulation: n.articulation === 'pizz' ? 'legato' : 'pizz' })) })).noteHash).not.toBe(base.strings[id].noteHash);
    expect(mutate((t) => ({ ...t, cc: first(t.cc ?? [], (l) => ({ ...l, points: first(l.points, (p) => ({ ...p, value: (p.value + 1) % 128 })) })) })).ccHash).not.toBe(base.strings[id].ccHash);
  });

  it('still match classic output for every cell', { timeout: 300_000 }, () => {
    for (const cell of cells) {
      const { project, result } = composeStringCell(cell, undefined);
      expect(result.stringsDiagnostics.mode).toBe('classic');
      expect(fingerprintResult(project, result), stringCellId(cell)).toEqual(document.cells[stringCellId(cell)]);
    }
  });
});
