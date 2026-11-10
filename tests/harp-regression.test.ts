import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import dorian from '../fixtures/dorian-16bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { projectEndTick, projectFromFixture, type Project, type Track } from '../src/shared/schema';
import { barTicks } from '../src/shared/schema/meter';

const TEMPLATES = [
  'ensemble.chamber',
  'ensemble.sonata',
  'ensemble.vocalbacking',
  'ensemble.cinematic',
  'ensemble.hybridstudio',
  'ensemble.symphony',
] as const;
const FIXTURES = { three: threeChorus as unknown as Project, dorian: dorian as unknown as Project };
type Fixture = keyof typeof FIXTURES;

const CASES: readonly { template: typeof TEMPLATES[number]; fixture: Fixture; take: number }[] = [
  { template: 'ensemble.chamber', fixture: 'three', take: 1 },
  { template: 'ensemble.vocalbacking', fixture: 'three', take: 3 },
  { template: 'ensemble.sonata', fixture: 'dorian', take: 2 },
  { template: 'ensemble.cinematic', fixture: 'three', take: 4 },
  { template: 'ensemble.hybridstudio', fixture: 'three', take: 5 },
  { template: 'ensemble.symphony', fixture: 'three', take: 6 },
];

const HARP_BASELINES: Record<string, { notes: number; notesHash: string; ccHash: string }> = {
  'ensemble.chamber': {
    notes: 0,
    notesHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    ccHash: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  },
  'ensemble.vocalbacking': {
    notes: 196,
    notesHash: '216c2572919104ce6e550e7d5f03b6b49876079135fd277189f35eec1543c922',
    ccHash: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  },
  'ensemble.sonata': {
    notes: 0,
    notesHash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    ccHash: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  },
  'ensemble.cinematic': {
    notes: 187,
    notesHash: '35ccb96d073303643bfd79e63999de2498e8eb17be14c035ae249bdb82e07179',
    ccHash: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  },
  'ensemble.hybridstudio': {
    notes: 173,
    notesHash: '1c54e8aa73482302e3cc8f623b5e2b4d220448e01739b7af4091a7332477591b',
    ccHash: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  },
  'ensemble.symphony': {
    notes: 203,
    notesHash: 'fb87a3a8da69dad65dea1694898122318d40410a96e196ffc9744ae58854a3b4',
    ccHash: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
  },
};

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function composeTake(fixture: Fixture, templateId: string, take: number) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(FIXTURES[fixture])) as Project);
  project.ensemble = { templateId, overrides: {}, pins: {} };
  project.orchestration = { take: take - 1 };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks, orchestration: result.orchestration } as Project, result };
}

function harpOf(tracks: readonly Track[]): Track {
  const harp = tracks.find((track) => track.role === 'harp');
  if (!harp) throw new Error('The fixture is missing its Harp track.');
  return harp;
}

describe('Harp compatibility and regression contract', () => {
  it('preserves the six-case pre-V2 Harp note and CC baselines', () => {
    for (const entry of CASES) {
      const { project } = composeTake(entry.fixture, entry.template, entry.take);
      const harp = harpOf(project.tracks);
      const baseline = HARP_BASELINES[entry.template];
      expect(harp.notes.length, `${entry.template} Harp note count`).toBe(baseline.notes);
      expect(hash(harp.notes), `${entry.template} Harp note events`).toBe(baseline.notesHash);
      expect(hash(harp.cc ?? null), `${entry.template} Harp CC`).toBe(baseline.ccHash);
    }
  });

  it('keeps Harp planning and rendering deterministic and within the written-track boundary', () => {
    for (const entry of CASES) {
      const a = composeTake(entry.fixture, entry.template, entry.take);
      const b = composeTake(entry.fixture, entry.template, entry.take);
      const harpA = harpOf(a.project.tracks);
      const harpB = harpOf(b.project.tracks);
      const endTick = projectEndTick(a.project);
      const ticksPerBar = barTicks(a.project.timeSignature);

      expect(a.result.plan.keys.harpFigures, `${entry.template} Harp figures`).toEqual(b.result.plan.keys.harpFigures);
      expect(a.result.plan.keys.glisses, `${entry.template} Harp glisses`).toEqual(b.result.plan.keys.glisses);
      expect(a.result.plan.keys.harpModeByType, `${entry.template} Harp modes`).toEqual(b.result.plan.keys.harpModeByType);
      expect(a.result.plan.keys.arpeggiatorOwnerByType, `${entry.template} arpeggiator owners`).toEqual(b.result.plan.keys.arpeggiatorOwnerByType);
      expect(harpA.notes, `${entry.template} Harp notes`).toEqual(harpB.notes);
      expect(harpA.cc ?? [], `${entry.template} Harp CC`).toEqual(harpB.cc ?? []);
      expect(a.result.plan.keys.glisses.every((gliss) => gliss.part === 'harp'), `${entry.template} glisses are Harp-owned`).toBe(true);
      expect(a.result.plan.keys.glisses.length, `${entry.template} gliss budget`).toBeLessThanOrEqual(2);

      for (const note of harpA.notes) {
        expect(note.pitch, `${entry.template} Harp range`).toBeGreaterThanOrEqual(harpA.lowestNote);
        expect(note.pitch, `${entry.template} Harp range`).toBeLessThanOrEqual(harpA.highestNote);
        expect(Number.isInteger(note.startTick) && note.startTick >= 0, `${entry.template} Harp onset`).toBe(true);
        expect(Number.isInteger(note.durationTicks) && note.durationTicks > 0, `${entry.template} Harp duration`).toBe(true);
        expect(note.durationTicks, `${entry.template} Harp note length`).toBeLessThanOrEqual(ticksPerBar);
        expect(note.startTick + note.durationTicks, `${entry.template} Harp project boundary`).toBeLessThanOrEqual(endTick);
      }
    }
  });
});
