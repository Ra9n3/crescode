import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { CC1_ARC_RANGE, CC11_ARC_RANGE, CC_BASELINE_ARCH, CC_BASELINE_LIFT, barKindOf } from '../src/orchestrator/expression/cc';
import { humanizeHeadTicks } from '../src/orchestrator/expression/timing';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { MAX_CC_POINTS_PER_LANE, PPQ, type CcLane, type Project, type Track } from '../src/shared/schema/types';
import { projectFromFixture } from '../src/shared/schema';

/**
 * Phase 5c — CC generation on the composed score:
 *   - lanes valid (unique controllers, sorted ticks, ticks inside
 *     [0, project end], ≤ 1024 points per lane, values 0–127);
 *   - CC7 is ONE static point at tick 0 per track;
 *   - CC68 is 127 only over legato notes — and absent entirely from
 *     ostinato/pizz/tremolo-only tracks;
 *   - CC1/CC11 stay inside their arch ranges (CC11 slightly wider than CC1);
 *   - no CC on locked or out-of-band tracks;
 *   - determinism: the same take composes byte-identical lanes;
 *   - point counts reported per track per template (the cap is never hit).
 */
const BT = 3840; // 4/4 bar at 960 PPQ
const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const THREE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(threeChorus)));

const composeTake = (project: Project, templateId: string, take: number) => {
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take };
  const result = composeAllTracks(project, { seed: 11, moments: false });
  return { project: { ...project, tracks: result.tracks } as Project, result };
};

const laneOf = (t: Track, cc: number): CcLane | undefined => t.cc?.find((l) => l.cc === cc);

/** In-band string tracks that actually sound (out-of-roster tracks carry no notes and no CC). */
const soundingStrings = (project: Project): Track[] =>
  project.tracks.filter((x) => x.family === 'Strings' && x.notes.length > 0);

/** An S-curve cluster: this many consecutive CC11 points inside one ramp span. */
const S_CURVE_RUN = 5;

/** Any 5 consecutive CC11 points inside one S-curve span (≤ ~80 ms of ticks + slack). */
const hasSCluster = (lane: CcLane | undefined): boolean => {
  if (!lane) return false;
  const pts = lane.points;
  for (let i = 0; i + S_CURVE_RUN <= pts.length; i++) {
    if (pts[i + S_CURVE_RUN - 1].tick - pts[i].tick <= PPQ / 8) return true; // 120 ticks ≈ an 8th at 120 bpm
  }
  return false;
};

describe('Phase 5c (1): lane validity + CC7 + ranges (dorian, all six templates)', () => {
  const runs = ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']
    .map((id) => ({ id, ...composeTake(BASE(), id, 0) }));

  it('every CC lane is valid: unique controllers, sorted, in range, capped, values 0–127', () => {
    for (const { project } of runs) {
      const endTick = 16 * BT;
      for (const t of soundingStrings(project)) {
        expect(t.cc, t.name).toBeTruthy();
        const ccs = t.cc!.map((l) => l.cc);
        expect(new Set(ccs).size).toBe(ccs.length); // one lane per controller
        for (const lane of t.cc!) {
          expect(lane.points.length).toBeGreaterThan(0);
          expect(lane.points.length).toBeLessThanOrEqual(MAX_CC_POINTS_PER_LANE);
          for (const [i, p] of lane.points.entries()) {
            expect(Number.isInteger(p.tick)).toBe(true);
            expect(Number.isInteger(p.value)).toBe(true);
            expect(p.tick).toBeGreaterThanOrEqual(0);
            expect(p.tick).toBeLessThanOrEqual(endTick);
            expect(p.value).toBeGreaterThanOrEqual(0);
            expect(p.value).toBeLessThanOrEqual(127);
            if (i > 0) expect(p.tick).toBeGreaterThanOrEqual(lane.points[i - 1].tick);
          }
        }
      }
    }
  });

  it('CC7 is ONE static point at tick 0 on every CC track', () => {
    for (const { project } of runs) {
      for (const t of soundingStrings(project)) {
        const lane = laneOf(t, 7);
        expect(lane, t.name).toBeTruthy();
        expect(lane!.points).toEqual([{ tick: 0, value: 90 }]);
      }
    }
  });

  it('CC1/CC11 arcs stay inside their ranges; CC11 spans a wider range than CC1', () => {
    for (const { project } of runs) {
      for (const t of soundingStrings(project)) {
        for (const p of laneOf(t, 1)!.points) {
          expect(p.value).toBeGreaterThanOrEqual(CC1_ARC_RANGE[0]);
          expect(p.value).toBeLessThanOrEqual(CC1_ARC_RANGE[1]);
        }
        for (const p of laneOf(t, 11)!.points) {
          expect(p.value).toBeGreaterThanOrEqual(CC11_ARC_RANGE[0]);
          expect(p.value).toBeLessThanOrEqual(CC11_ARC_RANGE[1]);
        }
      }
    }
    expect(CC11_ARC_RANGE[1] - CC11_ARC_RANGE[0]).toBeGreaterThan(CC1_ARC_RANGE[1] - CC1_ARC_RANGE[0]);
  });

  it('5.1.1: the arch lifts line bars above the baseline band; pure texture stretches hold the flat baseline', () => {
    const bt = 3840;
    const valueAt = (lane: CcLane, tick: number): number => {
      let v = lane.points[0].value;
      for (const p of lane.points) { if (p.tick <= tick) v = p.value; else break; }
      return v;
    };
    for (const { id, project, result } of runs) {
      const clampMax = ENSEMBLE_BY_ID.get(id)!.budget.energyClamp[1];
      const baseline = (b: number, range: readonly [number, number], lift: number): number => {
        const e = Math.min(1, (result.plan.bars[b - 1]?.energyTarget ?? 0) / clampMax);
        return range[0] + (range[1] - range[0]) * CC_BASELINE_ARCH * (0.5 + 0.5 * e) + lift;
      };
      for (const t of soundingStrings(project)) {
        const l1 = laneOf(t, 1)!;
        const l11 = laneOf(t, 11)!;
        const lineBars: number[] = [];
        const otherBars: number[] = [];
        for (let b = 1; b <= 16; b++) {
          (barKindOf(t.notes, (b - 1) * bt, b * bt) === 'line' ? lineBars : otherBars).push(b);
        }
        if (lineBars.length) {
          // the phrase arch actually lifts: some line bar rides above every
          // baseline point on the lane (arch factor 1 vs the calm 0.5 share)
          const baseMax = Math.max(...[...lineBars, ...otherBars].map((b) => baseline(b, CC1_ARC_RANGE, 0)));
          const archMax = Math.max(...lineBars.map((b) => valueAt(l1, (b - 1) * bt)));
          expect(archMax, `${id} ${t.name}`).toBeGreaterThan(baseMax + 2);
        } else {
          // a pure texture stretch: the lane IS the flat baseline, energy-scaled,
          // and CC11 holds slightly above CC1 there
          for (let b = 1; b <= 16; b++) {
            const v1 = valueAt(l1, (b - 1) * bt);
            const v11 = valueAt(l11, (b - 1) * bt);
            expect(Math.abs(v1 - baseline(b, CC1_ARC_RANGE, 0)), `${id} ${t.name} bar ${b} CC1`).toBeLessThanOrEqual(1);
            expect(Math.abs(v11 - baseline(b, CC11_ARC_RANGE, CC_BASELINE_LIFT)), `${id} ${t.name} bar ${b} CC11`).toBeLessThanOrEqual(1);
            expect(v11, `${id} ${t.name} bar ${b} CC11 above CC1`).toBeGreaterThanOrEqual(v1);
          }
        }
      }
    }
  });
});

describe('Phase 5c (2): CC68 legato windows + no expressive CC on ostinato/pizz tracks', () => {
  it('CC68 is 127 exactly over legato runs and 0 elsewhere (dorian cinematic, take 1 = trailer)', () => {
    const { project } = composeTake(BASE(), 'ensemble.cinematic', 0); // take 1 draws the trailer texture
    const v1 = project.tracks.find((t) => t.role === 'violins1')!;
    const lane = laneOf(v1, 68)!;
    expect(lane).toBeTruthy();
    const endTick = 16 * BT;
    // every point in the lane must agree with the notes sounding there
    const valueAt = (tick: number): number => {
      // walk the lane: value holds from each point to the next
      let v = lane.points[0].value;
      for (const p of lane.points) { if (p.tick <= tick) v = p.value; else break; }
      return v;
    };
    let checkedHigh = 0;
    for (let tick = 0; tick < endTick; tick += 60) {
      const sounding = v1.notes.filter((n) => n.startTick <= tick && tick < n.startTick + n.durationTicks);
      const value = valueAt(tick);
      if (sounding.length === 0) {
        // over rests the lane may close a run (0) but must never read 127 —
        // except inside a humanize head before a legato note's (late) attack
        const imminentLegato = v1.notes.some((n) => n.articulation === 'legato'
          && n.startTick > tick && n.startTick - tick <= humanizeHeadTicks(project.tempoMap, tick));
        if (!imminentLegato) expect(value).toBeLessThan(127);
        continue;
      }
      if (value === 127) {
        // 127 only where legato notes sound
        expect(sounding.some((n) => n.articulation === 'legato')).toBe(true);
        checkedHigh++;
      } else if (sounding.every((n) => n.articulation === 'legato')) {
        expect(value).toBe(0); // legato passage not covered would be wrong — either 127 or a closed run
      }
    }
    expect(checkedHigh).toBeGreaterThan(10); // the pad/lead lines are mostly legato
  });

  it('trailer take: the spiccato ostinato tracks get NO CC68 and NO legato S-curves; tremolo carriers DO get arcs', () => {
    const { project } = composeTake(BASE(), 'ensemble.cinematic', 0);
    for (const role of ['violins2', 'violas']) {
      const t = project.tracks.find((x) => x.role === role)!;
      expect(t.notes.every((n) => n.articulation === 'spiccato')).toBe(true); // the texture is all-ostinato on this track
      expect(laneOf(t, 68), `${t.name} CC68`).toBeUndefined();
      expect(hasSCluster(laneOf(t, 11)), `${t.name} S-curve`).toBe(false);
      expect(laneOf(t, 1)).toBeTruthy(); // a defined CC1 lane still rides the pulses (the 5.1.1 baseline)
    }
    const v1 = project.tracks.find((t) => t.role === 'violins1')!;
    expect(v1.notes.some((n) => n.articulation === 'legato')).toBe(true);
    expect(laneOf(v1, 68)).toBeTruthy();
  });

  it('a tremolo-bed take: no CC68 window covers a tremolo passage; arcs still ride the track', () => {
    // find a take whose chorus texture is the tremolo bed
    let found = false;
    for (let take = 0; take < 24 && !found; take++) {
      const { project, result } = composeTake(BASE(), 'ensemble.cinematic', take);
      const line = result.reports.find((r) => r.startsWith('textures'))!;
      if (!/chorus=tremoloBed/.test(line)) continue;
      found = true;
      for (const role of ['violins2', 'violas']) {
        const t = project.tracks.find((x) => x.role === role)!;
        if (!t.notes.some((n) => n.articulation === 'tremolo')) continue;
        expect(laneOf(t, 1), `${t.name} CC1`).toBeTruthy();
        expect(laneOf(t, 11), `${t.name} CC11`).toBeTruthy();
        expect(hasSCluster(laneOf(t, 11))).toBe(false); // no legato S-curves on a tremolo bed
        // every CC68 127-window must be free of tremolo notes
        const lane = laneOf(t, 68);
        if (!lane) continue; // no legato anywhere on the track: no lane at all
        for (let i = 0; i < lane.points.length; i++) {
          if (lane.points[i].value !== 127) continue;
          const lo = lane.points[i].tick;
          const hi = lane.points[i + 1]?.tick ?? Number.POSITIVE_INFINITY;
          const tremoloInside = t.notes.some((n) => n.articulation === 'tremolo' && n.startTick < hi && n.startTick + n.durationTicks > lo);
          expect(tremoloInside, `CC68 127 over tremolo at [${lo},${hi})`).toBe(false);
        }
      }
    }
    expect(found).toBe(true);
  });
});

describe('Phase 5c (3): scope + determinism + point budget', () => {
  it('locked and out-of-band tracks get no CC; locked tracks keep their notes untouched', () => {
    const p = BASE();
    const v1 = p.tracks.find((t) => t.role === 'violins1')!;
    v1.locked = true;
    const v2 = p.tracks.find((t) => t.role === 'violins2')!;
    const { project } = composeTake(p, 'ensemble.cinematic', 0);
    const lockedAfter = project.tracks.find((t) => t.id === v1.id)!;
    expect(lockedAfter.cc).toBeUndefined();
    expect(lockedAfter.notes).toEqual(v1.notes);
    const outOfBand = project.tracks.find((t) => t.id === v2.id)!;
    // V2 pulled out of the band by an override: untouched, so no CC either
    const p2 = BASE();
    p2.ensemble = { templateId: 'ensemble.cinematic', overrides: { violins2: 'out' }, pins: {} };
    p2.orchestration = { take: 0 };
    const r2 = composeAllTracks(p2, { seed: 11, moments: false });
    const v2After = r2.tracks.find((t) => t.role === 'violins2')!;
    expect(v2After.notes).toEqual(v2.notes);
    expect(v2After.cc).toBeUndefined();
    void outOfBand;
  });

  it('the same take composes byte-identical CC lanes', () => {
    for (const take of [0, 5]) {
      const a = composeTake(BASE(), 'ensemble.cinematic', take);
      const b = composeTake(BASE(), 'ensemble.cinematic', take);
      expect(JSON.stringify(a.project.tracks.map((t) => t.cc))).toBe(JSON.stringify(b.project.tracks.map((t) => t.cc)));
    }
  });

  it('point counts per track per template on the 40-bar fixture — the 1024 cap is never approached', () => {
    const lines: string[] = [];
    let worst = 0;
    for (const id of ['ensemble.symphony', 'ensemble.chamber', 'ensemble.cinematic', 'ensemble.sonata', 'ensemble.vocalbacking', 'ensemble.hybridstudio']) {
      const { project } = composeTake(THREE(), id, 0);
      for (const t of project.tracks.filter((x) => x.family === 'Strings')) {
        const per = (t.cc ?? []).map((l) => `CC${l.cc}:${l.points.length}`).join(' ');
        const total = (t.cc ?? []).reduce((a, l) => a + l.points.length, 0);
        worst = Math.max(worst, ...(t.cc ?? []).map((l) => l.points.length));
        lines.push(`  ${id.slice(9).padEnd(13)} ${t.name.padEnd(15)} total ${String(total).padStart(3)}  ${per}`);
      }
    }
    console.log(`5c CC points per track (three-chorus 40-bar fixture, take 1; lane cap ${MAX_CC_POINTS_PER_LANE}):\n${lines.join('\n')}`);
    expect(worst).toBeLessThan(300); // far under the cap
  });
});
