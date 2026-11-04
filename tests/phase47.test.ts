import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { textureForType, CINEMATIC_TEXTURE_WEIGHTS } from '../src/orchestrator/conductor/layers';
import { resolveTemplate } from '../src/config/ensembles';
import { chordSpans, sectionMap, energyCurve } from '../src/orchestrator/spine';
import { projectFromFixture, type Project } from '../src/shared/schema';

/**
 * Phase 4.7 — the texture draw distribution, measured not assumed:
 *   1. 400 takes × dorian cinematic: per-texture frequency for Verse and
 *      Chorus against the named weights (chi-square goodness of fit);
 *   2. the tightened trailer window: Chorus trailer within 6–14%;
 *   3. Verse/Chorus draws are independent (chi-square independence, joint
 *      table reported);
 *   4. what a fresh project's FIRST Compose All draws (the take number and
 *      the textures, straight from the compose reports).
 *
 * Every number here is a constant: the draw is a pure function of
 * (musical inputs, take, section type), so these assertions pin the fixed
 * stream — they cannot flake, they can only fail when the draw changes.
 */
const N = 400;
const WEIGHTS = CINEMATIC_TEXTURE_WEIGHTS; // 25/20/15/15/15/10
const TEXTURES = Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[];

const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));

/** The texture ids drawn for one take — rebuilt deterministically (no compose). */
const drawOf = (take: number): { verse: string; chorus: string } => {
  const p = BASE();
  p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
  p.orchestration = { take };
  const template = resolveTemplate(p.ensemble)!;
  const ctx = { project: p, template, ensemble: p.ensemble, spans: chordSpans(p), sections: sectionMap(p), arc: energyCurve(p, sectionMap(p), take, template, true) };
  return { verse: textureForType(ctx, 'verse').id, chorus: textureForType(ctx, 'chorus').id };
};

/** Chi-square goodness of fit of the observed counts against the weights. */
const chiSquareVsWeights = (counts: Record<string, number>): number =>
  TEXTURES.reduce((acc, t) => {
    const expected = (WEIGHTS[t] / 100) * N;
    return acc + ((counts[t] ?? 0) - expected) ** 2 / expected;
  }, 0);

describe('Phase 4.7: the texture draw distribution (dorian cinematic, 400 takes)', () => {
  const draws = Array.from({ length: N }, (_, t) => drawOf(t));
  const counts = {
    verse: Object.fromEntries(TEXTURES.map((t) => [t, draws.filter((d) => d.verse === t).length])),
    chorus: Object.fromEntries(TEXTURES.map((t) => [t, draws.filter((d) => d.chorus === t).length])),
  } as Record<'verse' | 'chorus', Record<string, number>>;

  it('per-texture frequency matches the weights for Verse and Chorus (chi-square < 11.07, 5 df)', () => {
    const lines = [`  texture      weight  Verse            Chorus`];
    for (const t of TEXTURES) {
      const w = WEIGHTS[t];
      lines.push(`  ${t.padEnd(21)} ${String(w).padStart(3)}%   ${((counts.verse[t] / N) * 100).toFixed(1).padStart(5)}% (${counts.verse[t]})   ${((counts.chorus[t] / N) * 100).toFixed(1).padStart(5)}% (${counts.chorus[t]})`);
    }
    const chiVerse = chiSquareVsWeights(counts.verse);
    const chiChorus = chiSquareVsWeights(counts.chorus);
    console.log(`4.7 draw distribution over ${N} takes (weights 25/20/15/15/15/10):\n${lines.join('\n')}\n  chi-square: verse ${chiVerse.toFixed(2)}, chorus ${chiChorus.toFixed(2)} (95% critical 11.07, 5 df)`);
    // no significant skew in the hash or draw — both fits pass comfortably
    expect(chiVerse).toBeLessThan(11.07);
    expect(chiChorus).toBeLessThan(11.07);
    // every texture actually appears on both section types
    for (const t of TEXTURES) {
      expect(counts.verse[t]).toBeGreaterThan(0);
      expect(counts.chorus[t]).toBeGreaterThan(0);
    }
  });

  it('trailer in Chorus within 6–14% (tightened from <= 20%)', () => {
    const freq = counts.chorus.trailer / N;
    console.log(`4.7 trailer: chorus ${(freq * 100).toFixed(1)}% (${counts.chorus.trailer}/${N}), verse ${((counts.verse.trailer / N) * 100).toFixed(1)}% (${counts.verse.trailer}/${N}) — window 6–14%`);
    expect(freq).toBeGreaterThanOrEqual(0.06);
    expect(freq).toBeLessThanOrEqual(0.14);
  });

  it('Verse and Chorus draws are independent (chi-square independence < 37.65, 25 df; joint table reported)', () => {
    const rows = TEXTURES.map((v) =>
      `  ${v.padEnd(21)} ${TEXTURES.map((c) => String(jointCount(v, c)).padStart(4)).join(' ')}`,
    );
    function jointCount(v: string, c: string): number {
      return draws.filter((d) => d.verse === v && d.chorus === c).length;
    }
    const header = `  ${'verse \\ chorus'.padEnd(21)} ${TEXTURES.map((c) => c.slice(0, 4).padStart(4)).join(' ')}`;
    let chi = 0;
    const cells: string[] = [];
    for (const v of TEXTURES) {
      for (const c of TEXTURES) {
        const o = jointCount(v, c);
        const e = (counts.verse[v] * counts.chorus[c]) / N;
        chi += ((o - e) ** 2) / e;
        if (Math.abs(o - e) > e * 0.5 && e >= 3) cells.push(`${v}|${c} ${o} vs ${e.toFixed(1)}`);
      }
    }
    console.log(`4.7 joint table (verse rows, chorus cols, takes of ${N}):\n${[header, ...rows].join('\n')}\n  chi-square independence ${chi.toFixed(2)} (95% critical 37.65, 25 df)${cells.length ? `\n  largest cells: ${cells.slice(0, 4).join(', ')}` : ''}`);
    expect(chi).toBeLessThan(37.65);
  });

  it("a fresh project's first Compose All draws its textures at take 1 (reported)", () => {
    const p = BASE(); // no orchestration field at all: the fresh-project state
    p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} };
    const result = composeAllTracks(p, { seed: 11 });
    const line = result.reports.find((r) => r.startsWith('textures'))!;
    expect(line).toBeTruthy();
    expect(result.orchestration.take).toBe(1);
    console.log(`4.7 fresh project, first Compose All → ${line}`);
    // the reported draw equals the pure draw for take 1
    const drawn = drawOf(1);
    expect(line).toContain(`verse=${drawn.verse}`);
    expect(line).toContain(`chorus=${drawn.chorus}`);
  });
});
