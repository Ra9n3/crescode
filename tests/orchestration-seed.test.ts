import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { orchestrationInputs, orchestrationSeedFor } from '../src/orchestrator/spine';
import { projectFromFixture, type Project } from '../src/shared/schema';

const BASE = (): Project => projectFromFixture(JSON.parse(JSON.stringify(fixture)));

const SEED_OPTS = { seed: 11 };

describe('orchestrationSeed per D8: inputs = chords, structure, key, mode, tempo, template, band', () => {
  it('same musical inputs + same take → the same seed, even with different uids and different notes', () => {
    const a = BASE();
    const b = BASE();
    // different uids everywhere…
    b.chords = b.chords.map((c, i) => ({ ...c, id: `other_${i}` }));
    b.tracks = b.tracks.map((t, i) => ({ ...t, id: `trk_other_${i}` }));
    b.sections = b.sections.map((s, i) => ({ ...s, id: `sec_other_${i}` }));
    // …and different notes (notes are NEVER inputs)
    b.tracks = b.tracks.map((t) => (t.notes.length ? { ...t, notes: t.notes.map((n) => ({ ...n, velocity: 40 })) } : t));
    expect(orchestrationSeedFor(b, { take: 3 })).toBe(orchestrationSeedFor(a, { take: 3 }));
    // the canonical input strings agree too
    expect(orchestrationInputs(b)).toBe(orchestrationInputs(a));
  });

  it('editing only notes never moves the seed', () => {
    const a = BASE();
    const b = BASE();
    const t = b.tracks.find((x) => x.role === 'piano')!;
    t.notes = [...t.notes, { pitch: 60, startTick: 0, durationTicks: 960, velocity: 90 }];
    expect(orchestrationSeedFor(b, { take: 1 })).toBe(orchestrationSeedFor(a, { take: 1 }));
  });

  it('changing ONE chord changes the seed (symbol or window)', () => {
    const a = BASE();
    const b = BASE();
    b.chords = [...b.chords];
    b.chords[2] = { ...b.chords[2], symbol: 'Gm7' };
    expect(orchestrationSeedFor(b, { take: 1 })).not.toBe(orchestrationSeedFor(a, { take: 1 }));

    const c = BASE();
    c.chords = [...c.chords];
    c.chords[2] = { ...c.chords[2], startTick: c.chords[2].startTick + 120 };
    expect(orchestrationSeedFor(c, { take: 1 })).not.toBe(orchestrationSeedFor(a, { take: 1 }));
  });

  it('structure, key, mode, tempo, template id and band are all inputs', () => {
    const seedOf = (mutate: (p: Project) => void, take = 1): number => {
      const p = BASE();
      mutate(p);
      return orchestrationSeedFor(p, { take });
    };
    const baseSeed = seedOf(() => {});

    expect(seedOf((p) => { p.sections[1] = { ...p.sections[1], lengthBars: 7 }; })).not.toBe(baseSeed);
    expect(seedOf((p) => { p.sections[1] = { ...p.sections[1], name: 'Drop' }; })).not.toBe(baseSeed);
    expect(seedOf((p) => { p.key = 5; })).not.toBe(baseSeed);
    expect(seedOf((p) => { p.mode = 'Aeolian'; })).not.toBe(baseSeed);
    expect(seedOf((p) => { p.bpm = 96; })).not.toBe(baseSeed);
    expect(seedOf((p) => { p.tempoMap = [{ tick: 0, bpm: 100 }, { tick: 19200, bpm: 120 }]; })).not.toBe(baseSeed);
    expect(seedOf((p) => { p.ensemble = { templateId: 'ensemble.cinematic', overrides: {}, pins: {} }; })).not.toBe(baseSeed);
    expect(seedOf((p) => { p.ensemble = { templateId: 'ensemble.symphony', overrides: { violas: 'out' }, pins: {} }; })).not.toBe(baseSeed);
    expect(seedOf((p) => { p.ensemble = { templateId: 'ensemble.symphony', overrides: {}, pins: { harp: 'in' } }; })).not.toBe(baseSeed);
    // …but mutating orchestration state other than the take counters does not move the ALL seed
    expect(seedOf((p) => { p.orchestration = { take: 1, sectionLocks: ['sec_verse'] }; })).toBe(baseSeed);
  });

  it('the take (and the per-section take for section seeds) combines into a different stream', () => {
    const p = BASE();
    const all = (take: number) => orchestrationSeedFor(p, { take });
    expect(all(1)).not.toBe(all(2));
    expect(all(1)).toBe(all(1)); // same take → same seed

    const section = (st: number) => orchestrationSeedFor(p, { take: 1, sectionTakes: { sec_chorus: st } }, 'sec_chorus');
    expect(section(1)).not.toBe(section(2));
    // the ALL seed does not read per-section takes
    expect(orchestrationSeedFor(p, { take: 1, sectionTakes: { sec_chorus: 2 } })).toBe(all(1));
  });

  it('same inputs + same take compose byte-identical string tracks; a new take re-seeds', () => {
    const run = () => {
      const p = BASE();
      p.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
      const res = composeAllTracks(p, { ...SEED_OPTS });
      return res;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.tracks.filter((t) => t.family === 'Strings').map((t) => t.notes)))
      .toBe(JSON.stringify(b.tracks.filter((t) => t.family === 'Strings').map((t) => t.notes)));
    expect(a.orchestration.take).toBe(1); // each compose increments from 0
    // different take → different stream (the phrase mask alone guarantees it, but
    // the D8 seed must agree: take 4 vs take 5 produce different output)
    const c = { ...BASE(), ensemble: { templateId: 'ensemble.chamber' as const, overrides: {}, pins: {} }, orchestration: { take: 4 } };
    const d = { ...BASE(), ensemble: { templateId: 'ensemble.chamber' as const, overrides: {}, pins: {} }, orchestration: { take: 5 } };
    const rc = composeAllTracks(c, { ...SEED_OPTS });
    const rd = composeAllTracks(d, { ...SEED_OPTS });
    expect(JSON.stringify(rc.tracks.filter((t) => t.family === 'Strings').map((t) => t.notes)))
      .not.toBe(JSON.stringify(rd.tracks.filter((t) => t.family === 'Strings').map((t) => t.notes)));
  });
});
