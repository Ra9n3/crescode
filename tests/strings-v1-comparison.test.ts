/**
 * Strings V1 — the classic-versus-V1 comparison harness.
 * Stage 2 composed one voice; Stage 3 adds a second on the other violin, so the expected difference is exactly
 * that one string track and nothing downstream.
 * The harness is diagnostic only: it never alters a composition.
 */
import { describe, expect, it } from 'vitest';
import {
  compareResults, composeStringCell, fingerprintCells, fingerprintResult, formatComparisons, stringCellId, type StringCell,
} from './strings-v1-support';

describe('classic versus V1 comparison harness', () => {
  it('reports the composed voices (two violins, Viola, Cello, Double Bass) as the only difference on every fingerprint cell', { timeout: 600_000 }, () => {
    let written = 0;
    for (const cell of fingerprintCells()) {
      const classic = composeStringCell(cell, 'classic');
      const v1 = composeStringCell(cell, 'v1');
      const report = compareResults(stringCellId(cell), classic.project, classic.result, v1.result);
      const composition = v1.result.stringsDiagnostics.v1!.composition!;
      // 1. direct string differences: the composed violin(s), and only when a voice was written
      //    (Stage 3: the second voice sits on the other violin; it may also decide to stay silent throughout)
      const ensemble = v1.result.stringsDiagnostics.v1!.ensemble!;
      // (Stage 4: and the Viola's track, when the Viola was written)
      const third = v1.result.stringsDiagnostics.v1!.viola!;
      const composed = [...(composition.written ? [composition.trackId!] : []), ...(ensemble.written ? [ensemble.companion!.trackId] : []), ...(third.written ? [third.viola!.trackId] : []),
        // (Stage 5: and the Cello's track, when the Cello was written)
        ...(v1.result.stringsDiagnostics.v1!.cello?.written ? [v1.result.stringsDiagnostics.v1!.cello.cello!.trackId] : []),
        // (Stage 6: and the Double Bass desk, when the Double Bass was written)
        ...(v1.result.stringsDiagnostics.v1!.doubleBass?.written ? [v1.result.stringsDiagnostics.v1!.doubleBass.doubleBass!.trackId] : [])];
      const changed = report.strings.map((d) => d.trackId);
      expect([...changed].sort(), report.cell).toEqual([...composed].sort());
      // 2. the information other families consume is unchanged
      expect(report.consumed, report.cell).toEqual({ carrierBars: [], leadLineTracks: [], counterLineChanged: false, soliLineTracks: [], conductorLayerBars: {}, momentsChanged: false });
      // 3. no downstream behaviour changed
      expect(report.downstream, report.cell).toEqual({});
      expect(report.totals, report.cell).toEqual({ stringTracksChanged: composed.length, consumedChanged: false, downstreamTracksChanged: 0, identical: !composition.written });
      if (composition.written) written++;
    }
    expect(written).toBeGreaterThan(0);
  });

  it('separates direct string differences, consumed information and downstream behaviour when two compositions differ', { timeout: 120_000 }, () => {
    // two different takes of one project stand in for "classic" and "a V1 that composes differently"
    const cell: StringCell = { template: 'symphony', fixture: 'three-chorus-40bars', seed: 1, take: 0 };
    const a = composeStringCell(cell, 'classic');
    const b = composeStringCell({ ...cell, take: 3 }, 'classic');
    const report = compareResults('two-takes', a.project, a.result, b.result);
    expect(report.totals.identical).toBe(false);
    // 1. direct string differences hold string tracks only, with bars, register, velocity and controllers
    expect(report.strings.length).toBeGreaterThan(0);
    expect(report.strings.every((d) => d.family === 'Strings')).toBe(true);
    expect(report.strings.some((d) => d.changedBars.length > 0)).toBe(true);
    expect(report.strings.some((d) => d.changedControllers.length > 0)).toBe(true);
    for (const d of report.strings) expect(d.noteCount.delta).toBe(d.noteCount.v1 - d.noteCount.classic);
    // 2. the information other families consume is reported on its own
    expect(report.totals.consumedChanged).toBe(true);
    expect(report.consumed.leadLineTracks.length + report.consumed.carrierBars.length).toBeGreaterThan(0);
    // 3. downstream behaviour holds no string track and is grouped by family
    expect(report.totals.downstreamTracksChanged).toBeGreaterThan(0);
    for (const [family, list] of Object.entries(report.downstream)) {
      expect(family).not.toBe('Strings');
      expect(list.every((d) => d.family === family)).toBe(true);
    }
    const text = formatComparisons([report]);
    expect(text).toContain('1. direct string differences');
    expect(text).toContain('2. consumed by other families');
    expect(text).toContain('3. downstream behaviour');
  });

  it('never alters the compositions it compares', { timeout: 120_000 }, () => {
    const cell: StringCell = { template: 'cinematic', fixture: 'dorian-16bars', seed: 1, take: 0 };
    const classic = composeStringCell(cell, 'classic');
    const v1 = composeStringCell(cell, 'v1');
    const before = [JSON.stringify(classic.result.tracks), JSON.stringify(v1.result.tracks), JSON.stringify(classic.result.stringsDiagnostics.consumed)];
    const print = fingerprintResult(classic.project, classic.result);
    compareResults(stringCellId(cell), classic.project, classic.result, v1.result);
    expect([JSON.stringify(classic.result.tracks), JSON.stringify(v1.result.tracks), JSON.stringify(classic.result.stringsDiagnostics.consumed)]).toEqual(before);
    expect(fingerprintResult(classic.project, classic.result)).toEqual(print);
  });
});
