import { describe, expect, it } from 'vitest';
import threeChorus from '../fixtures/three-chorus-40bars.json';
import { composeAllTracks } from '../src/orchestrator/compose';
import { barTicks } from '../src/shared/schema/meter';
import { projectFromFixture, type Project } from '../src/shared/schema';

function chamber(take: number) {
  const project = projectFromFixture(JSON.parse(JSON.stringify(threeChorus)) as Project);
  project.ensemble = { templateId: 'ensemble.chamber', overrides: {}, pins: {} };
  project.orchestration = { take: take - 1 };
  const result = composeAllTracks(project, { seed: 11 });
  return { project: { ...project, tracks: result.tracks } as Project, result };
}

describe('Phase 11.4 chamber piano clearance', () => {
  it('raises the RH above sounding low violas/cellos, while allowing an LH-only strike', () => {
    const { project } = chamber(1);
    const piano = project.tracks.find((t) => t.role === 'piano')!;
    const bt = barTicks(project.timeSignature);
    for (const n of piano.notes) {
      const bar = Math.floor(n.startTick / bt) + 1;
      const start = (bar - 1) * bt;
      const end = bar * bt;
      const lowStrings = project.tracks
        .filter((t) => t.role === 'violas' || t.role === 'cellosBasses')
        .some((t) => t.notes.some((s) => s.pitch <= 71 && s.startTick < end && s.startTick + s.durationTicks > start));
      if (lowStrings && n.pitch >= 64) expect(n.pitch, `bar ${bar}: piano RH clears the strings`).toBeGreaterThanOrEqual(72);
    }
    expect(piano.notes.every((n) => ['anchor', 'lift', 'settle', 'bed', 'atmosphere', 'arrival', 'punctuation', 'power'].includes(n.roleTag ?? ''))).toBe(true);
    expect(piano.notes.some((n) => n.roleTag === 'anchor')).toBe(true);
  });
});
