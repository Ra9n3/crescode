/** Production-default ensemble orchestration. Historical Stage 2–6 tests
 * retain their explicit legacy helper; these exercise the new handoff. */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeProject, run, orchestration, assertIsolation, assertRealized, assertPlanAndRejection, assertHistoricalMaterial, assertHistoricalHandoff, edgeProjects } from '../scripts/strings-orchestration-checks';
import type { ComposeResult } from '../src/orchestrator/compose';
let seeds: ComposeResult[];
beforeAll(() => { seeds = Array.from({ length: 8 }, (_, i) => run(makeProject(i + 1), i + 1)); }, 180000);

describe('ensemble orchestration identity V1', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: real production, immutable V2 material, exact repetition and adjacent isolation', (seed) => {
    const p = makeProject(seed), r = seeds[seed - 1];
    expect(orchestration(r).accepted).toBe(true);
    assertRealized(p, r); assertIsolation(p, r, seed); assertHistoricalMaterial(r, seed);
    const repeat = run(p, seed); expect(repeat).toEqual(r); expect(repeat.stringsDiagnostics).toEqual(r.stringsDiagnostics);
  }, 60000);

  it('plans openings, lower foreground and real takeovers rather than a mandatory Violin I hierarchy', () => {
    const openings = new Set<string | null>(seeds.map((r) => orchestration(r).plan!.opening.foreground));
    for (const r of ['violins1', 'violins2', 'violas', 'cellosBasses', null]) expect(openings.has(r)).toBe(true);
    expect(seeds.some((r) => new Set(orchestration(r).plan!.contributions.filter((c) => c.duty === 'foreground').map((c) => c.role)).size > 1)).toBe(true);
    expect(seeds.some((r) => orchestration(r).desks.some((d) => d.state === 'intentional-silence'))).toBe(true);
    expect(seeds.some((r) => orchestration(r).desks.some((d) => d.state === 'intentional-sparse'))).toBe(true);
  });

  it('checks plan reproducibility, impossible thematic register, support rejection, atomic fallback and immutable input', () => {
    assertPlanAndRejection(makeProject(), seeds[0]);
  });

  it('preserves explicit prior V2 and legacy writer handoffs, not just classic', () => {
    assertHistoricalHandoff(makeProject(), 1);
    assertHistoricalHandoff(makeProject(6), 6);
  }, 60000);

  it('retains source Violin II selection and realizes a Violin II foreground', () => {
    expect(seeds[5].stringsDiagnostics.v1!.composition!.selection!.chosen!.role).toBe('violins2');
    expect(orchestration(seeds[2]).plan!.opening.foreground).toBe('violins2');
  });

  it.each([1, 2, 3])('fixed displayed seed, stored take %i: deterministic but independently changing score', (take) => {
    const p = makeProject(1, take), r = run(p, 1);
    assertRealized(p, r); assertIsolation(p, r, 1);
    expect(run(p, 1)).toEqual(r);
    expect(r.tracks).not.toEqual(seeds[0].tracks);
  }, 60000);

  it.each(['chamber', 'cinematic', 'hybridstudio'] as const)('template %s: actual roster and capabilities, no created desk', (template) => {
    const p = makeProject(1, 0, template), r = run(p, 1);
    assertRealized(p, r); assertIsolation(p, r, 1);
  }, 60000);

  it('long 40-bar production form retains local silence and phrase coverage', () => {
    const p = makeProject(1, 0, 'symphony', 'three-chorus-40bars'), r = run(p, 1);
    expect(orchestration(r).accepted).toBe(true); assertRealized(p, r); assertIsolation(p, r, 1);
  }, 60000);

  for (const { tag, p, seed } of edgeProjects()) it(tag, () => {
    const r = run(p, seed), o = orchestration(r);
    assertIsolation(p, r, seed);
    const fallback = tag.startsWith('fallback-') || tag === 'meter-6-8';
    expect(o.accepted).toBe(!fallback);
    if (o.plan) assertRealized(p, r);
    if (fallback) expect(o.reason.length).toBeGreaterThan(5);
    if (tag === 'locked-violin1') expect(r.tracks.find((t) => t.role === 'violins1')).toEqual(p.tracks.find((t) => t.role === 'violins1'));
  }, 60000);
});
