import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { ENSEMBLE_BY_ID } from '../src/config/ensembles';
import { composeAllTracks } from '../src/orchestrator/compose';
import { checkTemplateRules, energyOf, governVelocity, maxMeanVelocity, measureEnergy } from '../src/orchestrator/energy';
import { projectBars, projectFromFixture, projectEndTick, type Project, type Track } from '../src/shared/schema';

const symphony = ENSEMBLE_BY_ID.get('ensemble.symphony')!;
const sonata = ENSEMBLE_BY_ID.get('ensemble.sonata')!;
const chamber = ENSEMBLE_BY_ID.get('ensemble.chamber')!;

const base = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));
const track = (p: Project, role: string): Track => p.tracks.find((t) => t.role === role)!;

/** A note that spans [start, start+len) entirely inside one beat window at 100 BPM 4/4 (beat = 960 ticks). */
const note = (pitch: number, startTick: number, velocity: number, durationTicks = 960) => ({ pitch, startTick, durationTicks, velocity });

describe('measureEnergy (spec §6, occupancy against the roster size — D3)', () => {
  it('one solo note: E = (1/17) × (v/127), windowed per beat', () => {
    const p = base();
    track(p, 'violins1').notes = [note(74, 0, 64)];
    const r = measureEnergy(p, symphony);
    expect(r.rosterSize).toBe(17);
    expect(r.windows.length).toBe(16 * 4); // 16 bars × 4 felt beats, 4/4
    const w0 = r.windows[0];
    expect(w0.soundingRoles).toEqual(['violins1']);
    expect(w0.energy).toBeCloseTo((1 / 17) * (64 / 127), 12);
    expect(r.max).toBeCloseTo((1 / 17) * (64 / 127), 12);
    expect(r.min).toBeCloseTo((1 / 17) * (64 / 127), 12); // min runs over sounding windows…
    expect(r.windows.filter((w) => w.noteCount === 0).length).toBe(63); // …silence is reported in windows[], energy 0
    expect(r.violations.some((v) => v.kind === 'belowFloor')).toBe(true); // soft report
    expect(r.violations.some((v) => v.kind === 'aboveMax')).toBe(false);
  });

  it('counts distinct roles, not notes, for occupancy; velocity is the note mean', () => {
    const p = base();
    track(p, 'violins1').notes = [note(72, 0, 60), note(76, 0, 90)]; // two notes, one role
    track(p, 'violas').notes = [note(60, 0, 60)];
    const r = measureEnergy(p, symphony);
    const w0 = r.windows[0];
    expect(w0.soundingRoles).toEqual(['violas', 'violins1']);
    expect(w0.noteCount).toBe(3);
    expect(w0.meanVelocity).toBeCloseTo(70, 9); // (60+90+60)/3
    expect(w0.energy).toBeCloseTo((2 / 17) * (70 / 127), 12);
  });

  it('is meter-aware: 3/4 gives 3 windows per bar, 6/8 gives 2 felt beats per bar', () => {
    const p3 = base();
    p3.timeSignature = { numerator: 3, denominator: 4 };
    track(p3, 'violins1').notes = [note(74, 0, 64, 3 * 960)];
    expect(measureEnergy(p3, symphony).windows.length).toBe(projectBars(p3) * 3);

    const p68 = base();
    p68.timeSignature = { numerator: 6, denominator: 8 };
    track(p68, 'violins1').notes = [note(74, 0, 64, 6 * 480)];
    const r = measureEnergy(p68, symphony);
    expect(r.windows.length).toBe(projectBars(p68) * 2); // compound: two dotted-quarter beats per bar
    expect(r.windows[0].endTick - r.windows[0].startTick).toBe(3 * 480);
  });

  it('only roster tracks count (a band outsider is invisible to energy)', () => {
    const p = base();
    // symphony rosters snare but NOT piano (17 = strings + woodwinds + brass + percussion + harp)
    track(p, 'piano').notes = [note(60, 0, 127, 960)];
    track(p, 'snare').notes = [note(38, 0, 127, 960)];
    const r1 = measureEnergy(p, symphony);
    expect(r1.windows[0].soundingRoles).toEqual(['snare']);
    expect(r1.windows[0].energy).toBeCloseTo((1 / 17) * (127 / 127), 12);

    // the same notes under chamber: piano is rostered, snare is not
    const r2 = measureEnergy(p, chamber);
    expect(r2.windows[0].soundingRoles).toEqual(['piano']);
    expect(r2.rosterSize).toBe(5);
  });

  it('flags hard above-max violations and never pads or fails on the soft floor', () => {
    const p = base();
    // all 17 symphony roles at velocity 127 for a bar: E = 1.0 > 0.85
    for (const r of symphony.roster) track(p, r.role).notes = [note(60, 0, 127, 3840)];
    const r = measureEnergy(p, symphony);
    expect(r.max).toBeCloseTo(1, 12);
    const hard = r.violations.filter((v) => v.kind === 'aboveMax');
    expect(hard.length).toBe(4);
    expect(hard.every((v) => v.severity === 'hard')).toBe(true);

    const q = base();
    track(q, 'violins1').notes = [note(74, 0, 8)];
    const soft = measureEnergy(q, symphony);
    expect(soft.violations.filter((v) => v.kind === 'belowFloor').length).toBe(1);
    expect(soft.violations.every((v) => v.severity === 'soft')).toBe(true);
  });
});

describe('velocity governor (spec §6)', () => {
  it('sonata: all three sounding caps the mean near 83 — floored to 82 so the hard clamp cannot breach', () => {
    expect(maxMeanVelocity(sonata, 3)).toBe(82); // floor(127 × 0.65) = floor(82.55)
    expect(82 / 127).toBeLessThanOrEqual(0.65);
    // a rounding up to 83 would cross the clamp — that is why floor wins
    expect(83 / 127).toBeGreaterThan(0.65);
  });

  it('fewer sounding tracks allow louder notes; more are capped harder', () => {
    // symphony N=17, max 0.85
    expect(maxMeanVelocity(symphony, 17)).toBe(107); // floor(127×0.85)
    expect(maxMeanVelocity(symphony, 4)).toBe(127); // 4 of 17 can never reach the clamp even at 127
    expect(maxMeanVelocity(symphony, 1)).toBe(127);
    expect(maxMeanVelocity(symphony, 0)).toBe(127); // nothing sounding, nothing to cap
  });

  it('matches the spec’s worked example: strings alone in Symphony cap E near 0.24', () => {
    // 4 of 17 tracks at full velocity: E = 4/17 × 127/127 = 0.235 (spec: "near 0.24")
    expect(energyOf(symphony, 4, 127)).toBeCloseTo(4 / 17, 12);
    expect(energyOf(symphony, 4, 127)).toBeGreaterThan(0.23);
    expect(energyOf(symphony, 4, 127)).toBeLessThan(0.24);
  });

  it('governVelocity clamps a single note and keeps valid ones untouched', () => {
    expect(governVelocity(sonata, 3, 120)).toBe(82);
    expect(governVelocity(sonata, 3, 64)).toBe(64);
    expect(governVelocity(sonata, 3, 0)).toBe(1); // velocity floor is 1
  });
});

describe('template rule checker (notes-only rules; the rest are explicit stubs)', () => {
  it('octaveDoubling forbidden: hard finding, deduped per pair', () => {
    const p = base();
    track(p, 'violins1').notes = [note(72, 0, 80, 1920)];
    track(p, 'cellosBasses').notes = [note(48, 0, 80, 1920)]; // octave below
    const findings = checkTemplateRules(p, sonata);
    const dbl = findings.filter((f) => f.rule === 'octaveDoubling');
    expect(dbl.length).toBe(1);
    expect(dbl[0].severity).toBe('hard');
  });

  it('octaveDoubling allowed: no findings for the same music', () => {
    const p = base();
    track(p, 'violins1').notes = [note(72, 0, 80, 1920)];
    track(p, 'cellosBasses').notes = [note(48, 0, 80, 1920)];
    expect(checkTemplateRules(p, symphony).filter((f) => f.rule === 'octaveDoubling')).toHaveLength(0);
  });

  it('octaveDoubling climaxOnly: allowed at/above the threshold energy, flagged below it', () => {
    // Four chamber roles sounding → occupancy 4/5. One genuine octave pair
    // (v1 84 + v2 72); the other pitches chosen so no other pair sits an
    // octave (or two) apart.
    const voices: [string, number][] = [['violins1', 84], ['violins2', 72], ['violas', 66], ['cellosBasses', 50]];
    const set = (p: Project, v: number) => {
      for (const [role, pitch] of voices) track(p, role).notes = [note(pitch, 0, v, 1920)];
    };

    const hot = base();
    set(hot, 88); // E = 4/5 × 88/127 ≈ 0.554 ≥ 0.55 → inside a climax
    expect(measureEnergy(hot, chamber).windows[0].energy).toBeGreaterThanOrEqual(0.55);
    expect(checkTemplateRules(hot, chamber).filter((f) => f.rule === 'octaveDoubling')).toHaveLength(0);

    const cold = base();
    set(cold, 40); // E ≈ 0.252 < 0.55 → the octave pair is flagged, exactly once
    const flagged = checkTemplateRules(cold, chamber).filter((f) => f.rule === 'octaveDoubling');
    expect(flagged.length).toBe(1);
    expect(flagged[0].severity).toBe('soft');
    expect(flagged[0].message).toMatch(/climax threshold/);
  });

  it('the cellosBasses internal octave counts too (D2 strict reading)', () => {
    const p = base();
    track(p, 'cellosBasses').notes = [note(48, 0, 80, 960), note(36, 0, 80, 960)]; // Vc + Cb one octave down, same track
    const dbl = checkTemplateRules(p, sonata).filter((f) => f.rule === 'octaveDoubling');
    expect(dbl.length).toBe(1);
  });

  it('D10: chamber audit on the composed dorian fixture reports ZERO octaveDoubling — every doubling there is forced', () => {
    const p = base();
    p.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
    const res = composeAllTracks(p, { seed: 11 });
    const composed = { ...p, tracks: res.tracks };
    const dbl = checkTemplateRules(composed, chamber).filter((f) => f.rule === 'octaveDoubling');
    expect(dbl).toHaveLength(0);
  });

  it('D10: a doubling forced by voices > distinct tones is exempt; the same double with voices == tones is still reported', () => {
    // Dm7 = D F A C (4 distinct tones). Five sounding voices double C at the
    // octave (v1 84 + v2 72): arithmetic necessity → exempt.
    const set = (p: Project, extraPiano: boolean) => {
      track(p, 'violins1').notes = [note(84, 0, 40, 1920)];
      track(p, 'violins2').notes = [note(72, 0, 40, 1920)];
      track(p, 'violas').notes = [note(57, 0, 40, 1920)];
      track(p, 'cellosBasses').notes = [note(50, 0, 40, 1920)];
      track(p, 'piano').notes = extraPiano ? [note(65, 0, 40, 1920)] : []; // F4, no new octave pairs
    };
    const forced = base();
    set(forced, true);
    expect(checkTemplateRules(forced, chamber).filter((f) => f.rule === 'octaveDoubling')).toHaveLength(0);

    // Drop one voice: 4 voices == 4 tones — the octave double is now a
    // deliberate layer choice below the climax threshold → still reported.
    const deliberate = base();
    set(deliberate, false);
    const flagged = checkTemplateRules(deliberate, chamber).filter((f) => f.rule === 'octaveDoubling');
    expect(flagged.length).toBe(1);
    expect(flagged[0].severity).toBe('soft');
  });

  it('D10: doubling a pitch class OUTSIDE the chord is never exempt, even with voices > tones', () => {
    // Same five voices, but the octave pair sits on F# (78/66) — not a Dm7 tone.
    const p = base();
    track(p, 'violins1').notes = [note(78, 0, 40, 1920)];
    track(p, 'violins2').notes = [note(66, 0, 40, 1920)];
    track(p, 'violas').notes = [note(57, 0, 40, 1920)];
    track(p, 'cellosBasses').notes = [note(50, 0, 40, 1920)];
    track(p, 'piano').notes = [note(65, 0, 40, 1920)];
    const flagged = checkTemplateRules(p, chamber).filter((f) => f.rule === 'octaveDoubling');
    expect(flagged.length).toBe(1);
  });

  it('overlapAvoid: entrances inside the window are flagged, distant ones are not', () => {
    const p = base();
    track(p, 'flutes').notes = [note(80, 1920, 90, 480)];
    track(p, 'trumpets').notes = [note(67, 2040, 90, 480)]; // 120 ticks later
    const near = checkTemplateRules(p, symphony).filter((f) => f.rule === 'overlapAvoid');
    expect(near.length).toBe(1);
    expect(near[0].severity).toBe('soft');
    expect(near[0].message).toMatch(/120 ticks/);

    const far = base();
    track(far, 'flutes').notes = [note(80, 1920, 90, 480)];
    track(far, 'trumpets').notes = [note(67, 3840, 90, 480)]; // a bar apart
    expect(checkTemplateRules(far, symphony).filter((f) => f.rule === 'overlapAvoid')).toHaveLength(0);
  });

  it('fillGating and maxLayers are explicit "not checkable yet" stubs', () => {
    const p = base();
    const stubs = checkTemplateRules(p, chamber).filter((f) => f.severity === 'stub');
    expect(stubs.map((f) => f.rule).sort()).toEqual(['fillGating', 'maxLayers']);
    expect(stubs.every((f) => f.message.includes('not checkable yet'))).toBe(true);
    // sonata also carries fillGating; vocalbacking has neither → only maxLayers
    expect(checkTemplateRules(p, sonata).filter((f) => f.severity === 'stub').map((f) => f.rule).sort()).toEqual(['fillGating', 'maxLayers']);
    expect(checkTemplateRules(p, ENSEMBLE_BY_ID.get('ensemble.vocalbacking')!).filter((f) => f.severity === 'stub').map((f) => f.rule)).toEqual(['maxLayers']);
  });
});

describe('calibration points (reported honestly — the formula is NOT bent to hit them)', () => {
  /**
   * Brief targets under the symphony roster (N=17):
   *   solo pizz pp   ~0.05–0.10
   *   section mf pad ~0.30–0.40
   *   tutti ff       ~0.85–0.95
   * With E = (roles/17) × (v/127) the first two bands are arithmetically
   * unreachable (they would need velocity ≈ 108–216 and ≈ 161–215): the tests
   * below assert what the formula ACTUALLY yields, and PHASE1_REPORT.md
   * carries the target-vs-actual table verbatim.
   */
  const CAL = {
    soloPizzPp: { v: 24, actual: (1 / 17) * (24 / 127) }, // ≈ 0.0111
    sectionMfPad: { v: 70, actual: (4 / 17) * (70 / 127) }, // ≈ 0.1297
    tuttiFf: { v: 127, actual: 1.0 }, // pre-governor; the governor caps output at 0.85
  };

  it('solo pizz pp measures ≈ 0.011 — below the 0.05–0.10 band (miss reported)', () => {
    const p = base();
    track(p, 'violins1').notes = [note(74, 0, CAL.soloPizzPp.v, 960)];
    const r = measureEnergy(p, symphony);
    expect(r.windows[0].energy).toBeCloseTo(CAL.soloPizzPp.actual, 12);
    expect(r.windows[0].energy).toBeLessThan(0.05); // target band unreachable at any velocity ≤ 127
  });

  it('a 4-string mf pad measures ≈ 0.13 — below the 0.30–0.40 band (miss reported)', () => {
    const p = base();
    for (const role of ['violins1', 'violins2', 'violas', 'cellosBasses']) track(p, role).notes = [note(60, 0, CAL.sectionMfPad.v, 960)];
    const r = measureEnergy(p, symphony);
    expect(r.windows[0].energy).toBeCloseTo(CAL.sectionMfPad.actual, 12);
    expect(r.windows[0].energy).toBeLessThan(0.3);
  });

  it('tutti ff is governed to exactly the clamp ceiling (bottom edge of the 0.85–0.95 band)', () => {
    const cap = maxMeanVelocity(symphony, 17);
    expect(energyOf(symphony, 17, cap)).toBeCloseTo(0.8425, 4); // 107/127
    expect(energyOf(symphony, 17, cap)).toBeLessThanOrEqual(0.85);
    // un-governed tutti ff would sit at 1.0 and be flagged hard:
    const p = base();
    for (const r of symphony.roster) track(p, r.role).notes = [note(60, 0, 127, 960)];
    expect(measureEnergy(p, symphony).violations.some((v) => v.kind === 'aboveMax')).toBe(true);
  });

  it('documents where the target bands WOULD land (so the numbers are checkable, not vibes)', () => {
    // Velocity each band would need at its occupancy:
    // solo 0.05–0.10 @ 1/17  → v = E×127×17 ≈ 108–216 (capped at 127 → max 0.0588)
    // pad   0.30–0.40 @ 4/17 → v ≈ 161–215 (unreachable)
    // The 0.05 solo band is only just reachable at v=127: E = 1/17 = 0.0588.
    expect((0.05 * 127 * 17) / 1).toBeCloseTo(107.95, 1);
    expect((0.3 * 127 * 17) / 4).toBeCloseTo(161.9, 1);
    expect(projectEndTick(base())).toBe(16 * 3840); // fixture shape sanity
  });
});
