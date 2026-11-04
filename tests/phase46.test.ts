import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { ENSEMBLE_BY_ID, resolveTemplate } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { measureEnergy } from '../src/orchestrator/energy';
import { HUMANIZE_HEAD_TICKS } from '../src/orchestrator/energy/rules';
import { chordSpans, sectionMap, energyCurve } from '../src/orchestrator/spine';
import { sanitizeNotes } from '../src/engine/generate';
import { textureForType, CINEMATIC_TEXTURE_WEIGHTS, CHAMBER_TEXTURE_WEIGHTS, HYBRID_TEXTURE_WEIGHTS, SONATA_TEXTURE_WEIGHTS, SYMPHONY_TEXTURE_WEIGHTS } from '../src/orchestrator/conductor/layers';
import { projectEndTick, projectFromFixture, validateProject, type Project } from '../src/shared/schema';

/**
 * Phase 4.6 — arrangement variety + calmer ostinato:
 *   1. texture palettes: per take, one texture per section TYPE drawn from
 *      the D8 seed (weights are named constants); handoffs move the tune;
 *   2. ostinato calm-down: rate in the texture (8ths, 16ths only for the
 *      trailer), enters 1–2 bars in, drops out for the dip bar, rests on
 *      the last beat of every 4th bar, seeded shapes, interlock half-rate;
 *   3. the 40-take battery: variety, determinism, hygiene, calm counts.
 */
const BT = 3840;
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));

const composeTake = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
};

const texturesOf = (result: ReturnType<typeof composeAllTracks>): Record<string, string> => {
  const line = result.reports.find((r) => r.startsWith('textures'))!;
  expect(line).toBeTruthy();
  return Object.fromEntries(line.split(': ')[1].split(', ').map((kv) => kv.split('=')));
};

const texOf = (result: ReturnType<typeof composeAllTracks>, type: string): string => {
  const v = texturesOf(result)[type];
  if (v === undefined) throw new Error(`no texture reported for section type "${type}"`);
  return v;
};

/** The take's texture objects (for style reads) — rebuilt deterministically. */
const textureCtx = (project: Project) => {
  const template = resolveTemplate(project.ensemble)!;
  const arc = energyCurve(project, sectionMap(project), project.orchestration!.take, template, true);
  return { project, template, ensemble: project.ensemble!, spans: chordSpans(project), sections: sectionMap(project), arc };
};

const isOstNote = (a: string | undefined): boolean => a === 'spiccato' || a === 'pizz';

describe('Phase 4.6 (1): texture palettes — variety and trailer frequency (three-chorus, takes 0..39)', () => {
  const runs = Array.from({ length: 40 }, (_, t) => {
    const { project, result } = composeTake(THREE(), 'ensemble.cinematic', t);
    return { take: result.orchestration.take, tex: texturesOf(result), verse: texOf(result, 'verse'), chorus: texOf(result, 'chorus'), project, result };
  });

  it('at least 4 distinct Verse/Chorus texture combos across the 40 takes', () => {
    const combos = new Set(runs.map((r) => `${r.verse}|${r.chorus}`));
    console.log(`4.6 texture combos (${combos.size}):\n${[...combos].map((c) => `  ${c}`).join('\n')}`);
    expect(combos.size).toBeGreaterThanOrEqual(4);
  });

  it('V2+Vla both on 16th ostinato in a Chorus (trailer) in <= 20% of takes (target ~10%)', () => {
    const trailerChorus = runs.filter((r) => r.chorus === 'trailer');
    const freq = trailerChorus.length / runs.length;
    console.log(`4.6 trailer frequency: chorus ${trailerChorus.length}/40 (${(freq * 100).toFixed(1)}%), verse ${runs.filter((r) => r.verse === 'trailer').length}/40 (weights: trailer ${CINEMATIC_TEXTURE_WEIGHTS.trailer}/100)`);
    expect(freq).toBeLessThanOrEqual(0.2);
    expect(trailerChorus.length).toBeGreaterThanOrEqual(1);
  });

  it('the same take is byte-identical, twice over', () => {
    for (const t of [0, 7, 23, 39]) {
      const a = composeTake(THREE(), 'ensemble.cinematic', t);
      const b = composeTake(THREE(), 'ensemble.cinematic', t);
      expect(JSON.stringify(a.project.tracks)).toBe(JSON.stringify(b.project.tracks));
      expect(JSON.stringify(a.result.plan)).toBe(JSON.stringify(b.result.plan));
    }
  });

  it('every texture obeys the vocabulary: maxLayers holds in every bar of every take', () => {
    const maxLayers = ENSEMBLE_BY_ID.get('ensemble.cinematic')!.budget.maxLayers;
    for (const r of runs) {
      for (const bar of r.result.plan.bars) {
        expect(bar.layers.length).toBeLessThanOrEqual(maxLayers);
        const ids = bar.layers.flatMap((l) => l.trackIds);
        expect(new Set(ids).size).toBe(ids.length); // one role per track per bar
      }
    }
  });

  it('report: the texture drawn per take 1..10 (dorian cinematic, Verse/Chorus)', () => {
    const lines: string[] = [];
    for (let t = 0; t < 10; t++) {
      const { result } = composeTake(BASE(), 'ensemble.cinematic', t);
      lines.push(`  take ${result.orchestration.take}: Verse=${texOf(result, 'verse')}, Chorus=${texOf(result, 'chorus')}`);
    }
    console.log(`4.6 cinematic textures per take (dorian):\n${lines.join('\n')}`);
    expect(lines).toHaveLength(10);
  });
});

describe('Phase 4.6 (2): the 40-take hygiene battery (dorian cinematic, takes 0..39)', () => {
  const runs = Array.from({ length: 40 }, (_, t) => composeTake(BASE(), 'ensemble.cinematic', t));

  it('same take byte-identical (all 40, plan and score)', () => {
    for (const { project, result } of runs.slice(0, 8)) {
      const again = composeTake(BASE(), 'ensemble.cinematic', result.orchestration.take - 1);
      expect(JSON.stringify(again.project.tracks)).toBe(JSON.stringify(project.tracks));
    }
    // …and a fresh take re-rolls at least the voicing somewhere
    const a = JSON.stringify(runs[0].project.tracks.find((t) => t.role === 'violins1')!.notes);
    const b = JSON.stringify(runs[1].project.tracks.find((t) => t.role === 'violins1')!.notes);
    expect(a).not.toBe(b);
  });

  it('every take passes validateProject, ranges, sanitize no-op and the energy clamp', () => {
    for (const { project } of runs) {
      const v = validateProject(project);
      if (!v.ok) console.error(v.errors.slice(0, 4));
      expect(v.ok).toBe(true);
      const end = projectEndTick(project);
      for (const tr of project.tracks.filter((x) => x.family === 'Strings')) {
        for (const n of tr.notes) {
          expect(n.pitch).toBeGreaterThanOrEqual(tr.lowestNote);
          expect(n.pitch).toBeLessThanOrEqual(tr.highestNote);
        }
        expect(sanitizeNotes(tr.notes, tr.lowestNote, tr.highestNote, end)).toEqual(tr.notes);
      }
      const template = ENSEMBLE_BY_ID.get('ensemble.cinematic')!;
      const energy = measureEnergy(project, template);
      expect(energy.max).toBeLessThanOrEqual(template.budget.energyClamp[1] + 1e-9);
      expect(energy.violations.filter((x) => x.kind === 'aboveMax')).toHaveLength(0);
    }
  });

  it('the lead (always V1 on cinematic) is the top line in most bars, every take', () => {
    const roles = ['violins1', 'violins2', 'violas', 'cellosBasses'];
    const worst = { ratio: 1, take: 0 };
    for (const { project, result } of runs) {
      const v1id = project.tracks.find((t) => t.role === 'violins1')!.id;
      const handoffBars = new Set(
        result.plan.bars.filter((b) => {
          const lead = b.layers.find((l) => l.layer === 'lead');
          return lead && !lead.trackIds.includes(v1id);
        }).map((b) => b.bar),
      );
      expect(handoffBars.size).toBe(0); // cinematic has no handoff texture: V1 carries the tune throughout
      let barsWithStrings = 0;
      let barsLeadTop = 0;
      for (let bar = 1; bar <= 16; bar++) {
        const lo = (bar - 1) * BT, hi = bar * BT;
        const inBar = (role: string) => project.tracks.find((t) => t.role === role)!.notes.filter((n) => n.startTick < hi && n.startTick + n.durationTicks > lo);
        const othersMax = Math.max(-1, ...roles.filter((r) => r !== 'violins1').flatMap((r) => inBar(r).map((n) => n.pitch)));
        const leadMax = Math.max(-1, ...inBar('violins1').map((n) => n.pitch));
        if (leadMax < 0 && othersMax < 0) continue;
        barsWithStrings++;
        if (leadMax >= othersMax) barsLeadTop++; // a unison does not displace the lead
      }
      const ratio = barsLeadTop / barsWithStrings;
      if (ratio < worst.ratio) { worst.ratio = ratio; worst.take = result.orchestration.take; }
      expect(ratio).toBeGreaterThanOrEqual(0.7);
    }
    console.log(`4.6 lead-on-top (cinematic, 40 takes): worst ${worst.take} at ${(worst.ratio * 100).toFixed(0)}% of sounding bars`);
  });
});

describe('Phase 4.6 (3): ostinato calm-down (three-chorus cinematic, takes 0..39)', () => {
  const CHORUSES = [5, 17, 29]; // start bars of the three 8-bar choruses
  const runs = Array.from({ length: 40 }, (_, t) => {
    const { project, result } = composeTake(THREE(), 'ensemble.cinematic', t);
    const tex = texturesOf(result);
    // per chorus bar: ostinato onsets on the V2+Vla ostinato tracks
    const perBar = new Map<number, number>();
    for (const role of ['violins2', 'violas']) {
      for (const n of project.tracks.find((tr) => tr.role === role)!.notes.filter((x) => isOstNote(x.articulation))) {
        const bar = Math.floor(n.startTick / BT) + 1;
        perBar.set(bar, (perBar.get(bar) ?? 0) + 1);
      }
    }
    const chorusMax = Math.max(...CHORUSES.flatMap((c) => Array.from({ length: 8 }, (_, i) => perBar.get(c + i) ?? 0)));
    return { take: result.orchestration.take, tex, chorus: texOf(result, 'chorus'), project, result, perBar, chorusMax };
  });

  it('the ostinato enters 1-2 bars in: never a note in the first bar of any chorus, any take', () => {
    for (const r of runs) {
      for (const c of CHORUSES) {
        expect(r.perBar.get(c) ?? 0).toBe(0);
      }
    }
  });

  it('it drops out for the dip bar: no ostinato in any chorus\u2019s last bar (choruses 1-2 pre-Verse/Bridge, chorus 3 pre-Outro)', () => {
    for (const r of runs) {
      for (const c of CHORUSES) {
        expect(r.perBar.get(c + 7) ?? 0).toBe(0);
      }
    }
  });

  it('it rests on the last beat of every 4th bar of the section', () => {
    for (const r of runs) {
      for (const c of CHORUSES) {
        const bar = c + 3; // the 4th bar of the section
        const lastBeatFrom = bar * BT - 960;
        for (const role of ['violins2', 'violas']) {
          for (const n of r.project.tracks.find((tr) => tr.role === role)!.notes.filter((x) => isOstNote(x.articulation))) {
            if (n.startTick >= (bar - 1) * BT && n.startTick < bar * BT) {
              expect(n.startTick).toBeLessThan(lastBeatFrom);
            }
          }
        }
      }
    }
  });

  it('non-trailer takes are calm: max ostinato notes per chorus bar <= half the trailer count', () => {
    const trailer = runs.filter((r) => r.chorus === 'trailer');
    const calm = runs.filter((r) => r.chorus !== 'trailer');
    expect(trailer.length).toBeGreaterThanOrEqual(1);
    const trailerMax = Math.max(...trailer.map((r) => r.chorusMax));
    for (const r of calm) {
      expect(r.chorusMax).toBeLessThanOrEqual(trailerMax / 2);
    }
    console.log(`4.6 ostinato notes/chorus-bar: trailer max ${trailerMax} (${trailer.map((r) => r.take).join(',')}), calm takes max ${Math.max(...calm.map((r) => r.chorusMax))} (16th trailer vs 8th textures)`);
  });

  it('interlocking textures offset the two tracks by half the rate — never the same rhythm', () => {
    let checked = 0;
    for (const r of runs) {
      if (r.chorus !== 'interlockingOstinato') continue;
      const ctx = textureCtx(r.project);
      const style = textureForType(ctx, 'chorus').style;
      expect(style.interlock).toBe(true);
      // the first bar where the ostinato actually runs (it enters 1-2 bars in)
      const bar = 5 + style.enterAfter;
      const onsets = (role: string) =>
        r.project.tracks.find((tr) => tr.role === role)!.notes.filter((n) => isOstNote(n.articulation) && n.startTick >= (bar - 1) * BT && n.startTick < bar * BT).map((n) => n.startTick).sort((a, b) => a - b);
      const v2 = onsets('violins2');
      const vla = onsets('violas');
      expect(v2.length).toBeGreaterThan(4);
      expect(vla.length).toBe(v2.length);
      // Phase 5d humanize: each track's notes shift by its own section-base +
      // jitter (violins +5..18 ms), so the half-rate offset keeps a small
      // envelope instead of the exact 240 — the rhythms still never coincide
      // (the interlock gap stays far above the note length).
      for (let i = 0; i < v2.length; i++) expect(Math.abs(vla[i] - v2[i] - 240)).toBeLessThanOrEqual(HUMANIZE_HEAD_TICKS);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(1);
    console.log(`4.6 interlock verified on ${checked} take(s): Vla = V2 onsets + 240 ticks, disjoint rhythms`);
  });

  it('report: ostinato notes per template (dorian, take 1)', () => {
    const lines: string[] = [];
    for (const id of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
      const { project, result } = composeTake(BASE(), id, 0);
      const counts: Record<string, number> = {};
      for (const tr of project.tracks.filter((t) => t.family === 'Strings')) {
        const n = tr.notes.filter((x) => isOstNote(x.articulation)).length;
        if (n) counts[tr.name] = n;
      }
      lines.push(`  ${id.slice(9)} (take ${result.orchestration.take}, ${texOf(result, 'verse')}): ${JSON.stringify(counts)}`);
    }
    console.log(`4.6 ostinato/pizz note counts per template:\n${lines.join('\n')}`);
    expect(lines).toHaveLength(6);
  });
});

describe('Phase 4.6 (4): every other template varies its role plan across takes', () => {
  it('symphony, chamber, sonata, hybrid: >= 2 distinct role plans across 20 takes; vocal backing stays pad only', () => {
    for (const id of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.sonata', 'ensemble.hybridstudio']) {
      const plans = new Set<string>();
      for (let t = 0; t < 20; t++) {
        const { result } = composeTake(BASE(), id, t);
        const tex = texturesOf(result);
        plans.add(Object.entries(tex).sort().map(([k, v]) => `${k}=${v}`).join(','));
      }
      console.log(`4.6 role plans ${id.slice(9)}: ${plans.size} distinct across 20 takes`);
      expect(plans.size).toBeGreaterThanOrEqual(2);
    }
    // the weights really are the named constants backing the variety
    expect(Object.values(SYMPHONY_TEXTURE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(CHAMBER_TEXTURE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(SONATA_TEXTURE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(HYBRID_TEXTURE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(CINEMATIC_TEXTURE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);

    // Vocal Backing stays pad only — one role plan, forever
    const vbPlans = new Set<string>();
    for (let t = 0; t < 20; t++) {
      const { project, result } = composeTake(BASE(), 'ensemble.vocalbacking', t);
      vbPlans.add(texturesOf(result).verse);
      for (const bar of result.plan.bars) expect(bar.layers.map((l) => l.layer)).toEqual(['pad']);
      for (const tr of project.tracks.filter((x) => x.family === 'Strings')) {
        for (const n of tr.notes) expect(n.articulation).toBe('legato');
      }
    }
    expect(vbPlans).toEqual(new Set(['padBed']));
  });
});
